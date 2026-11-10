import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from fastapi.testclient import TestClient

from api.main import app
from api.worker import process_job
from engine.horizonrelay.browser import convert_browser
from make_fixtures import build


def test_rules_only_modes_and_rewrite_evidence(tmp_path):
    build(tmp_path)
    basic = convert_browser(tmp_path / 'logic.jar', tmp_path / 'basic', mode='basic')
    assert 'src/translated.rs' in basic['files']
    assert any('idiv' in item['text'] for item in basic['rewriteSources'])
    assets = convert_browser(tmp_path / 'asset.jar', tmp_path / 'inspect', mode='inspect')
    assert assets['report']['mode'] == 'inspect'
    assert {item['kind'] for item in assets['artifacts']} == {'report', 'source'}
    startup = convert_browser(tmp_path / 'startup.jar', tmp_path / 'startup', mode='basic')
    assert not any(path.startswith('native/') for path in startup['files'])


def test_job_can_rewrite_selected_method_via_local_model(tmp_path, monkeypatch):
    captured = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            captured.append((self.path, json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
            answer = json.dumps({'rust': 'pub fn divide(a: i32, b: i32) -> i32 { a.wrapping_div(b) }',
                                 'notes': ['Verify division by zero.']})
            body = json.dumps({'message': {'content': answer}}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        monkeypatch.setenv('HB_DATA_DIR', str(tmp_path / 'jobs'))
        monkeypatch.setenv('HB_AI_PROVIDER', 'ollama')
        monkeypatch.setenv('HB_AI_URL', f'http://127.0.0.1:{server.server_port}')
        monkeypatch.setenv('HB_AI_MODEL', 'local-fixture')
        build(tmp_path)
        data = (tmp_path / 'logic.jar').read_bytes()
        with TestClient(app) as client:
            config = client.get('/api/config').json()
            job = client.post('/api/jobs', json={'filename': 'logic.jar', 'size': len(data),
                              'target': config['targets'][0]['id'], 'authorized': True, 'ai': True}).json()
            auth = {'Authorization': f"Bearer {job['token']}"}
            assert client.put(job['uploadUrl'], content=data, headers=auth).status_code == 202
            process_job(app.state.store, job['id'], app.state.store.claim()[1])
            url = f"/api/jobs/{job['id']}/rewrite"
            assert client.get(url).status_code == 404
            options = client.get(url, headers=auth).json()['sources']
            assert captured == []
            choice = next(item for item in options if '.unsupported(' in item['label'])
            assert 'text' not in choice
            response = client.post(url, params={'source': choice['id']}, headers=auth)
            assert response.status_code == 200, response.text
            assert 'pub fn divide' in response.json()['rust']
            assert captured[0][0] == '/api/chat'
            assert 'idiv' in captured[0][1]['messages'][-1]['content']
            assert client.post(url, params={'source': choice['id']}, headers=auth).json() == response.json()
            assert len(captured) == 1
            assert not any(item['name'].startswith('ai-') for item in client.get(f"/api/jobs/{job['id']}", headers=auth).json()['artifacts'])
    finally:
        server.shutdown()
        server.server_close()
