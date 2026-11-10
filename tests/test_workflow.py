import io
import json
import os
import shutil
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.pipeline import check_translated
from api.store import JobError, Store
from api.worker import process_job


def jar_bytes(traversal=False):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as jar:
        jar.writestr('fabric.mod.json', json.dumps({'schemaVersion': 1, 'id': 'bridge_recipe',
                     'name': 'Bridge Recipe', 'version': '1.0.0', 'license': 'CC0-1.0',
                     'depends': {'minecraft': '26.3'}}))
        jar.writestr('data/bridge_recipe/recipe/torch.json', json.dumps({'type': 'minecraft:crafting_shapeless',
                     'ingredients': ['minecraft:coal', 'minecraft:stick'], 'result': {'id': 'minecraft:torch'}}))
        if traversal:
            jar.writestr('../escape.txt', 'rejected')
    return output.getvalue()


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv('HB_DATA_DIR', str(tmp_path / 'state'))
    monkeypatch.delenv('HB_VINEFLOWER_JAR', raising=False)
    monkeypatch.delenv('HORIZONBRIDGE_ENABLE_ASSETS', raising=False)
    monkeypatch.delenv('HORIZONBRIDGE_ENABLE_NATIVE', raising=False)
    with TestClient(app) as client:
        yield client, app.state.store


def create(client, data, authorized=True):
    config = client.get('/api/config').json()
    return client.post('/api/jobs', json={'filename': 'recipe.jar', 'size': len(data),
                       'target': config['targets'][0]['id'], 'authorized': authorized})


def submit(client, data):
    response = create(client, data)
    assert response.status_code == 201, response.text
    job = response.json()
    auth = {'Authorization': f"Bearer {job['token']}"}
    upload = client.put(job['uploadUrl'], content=data, headers=auth)
    assert upload.status_code == 202, upload.text
    return job, auth


def test_upload_to_download(api):
    client, store = api
    data = jar_bytes()
    assert create(client, data, authorized=False).status_code == 422
    job, auth = submit(client, data)
    base = f"/api/jobs/{job['id']}"
    assert client.get(base).status_code == 404
    assert client.put(job['uploadUrl'], content=data, headers=auth).status_code == 409
    process_job(store, *store.claim())
    result = client.get(base, headers=auth).json()
    assert result['state'] == 'succeeded', result
    assert result['report']['metadata']['id'] == 'bridge_recipe'
    assert 'bytecode' in {item['stage'] for item in result['history']}
    assert result['report']['classification'] in {'partial', 'unsupported'}
    assert {item['kind'] for item in result['artifacts']} == {'source', 'report'}
    assert client.get(base + '/files', params={'path': '../jobs.sqlite3'}, headers=auth).status_code == 404
    assert client.get(base + '/files', params={'path': 'PORTING.md'}, headers=auth).text.startswith('# Porting notes')
    report = client.get(base + '/artifacts/conversion-report.json', headers=auth)
    assert report.json() == result['report']
    assert report.headers['cache-control'] == 'no-store, private'
    source = client.get(base + '/artifacts/horizonrelay-source.zip', headers=auth)
    with zipfile.ZipFile(io.BytesIO(source.content)) as archive:
        assert {'conversion-report.json', 'PORTING.md'}.issubset(archive.namelist())


@pytest.mark.parametrize('data', [b'PK\x03\x04bad', jar_bytes(traversal=True)])
def test_invalid_archive_rejected_after_upload(api, data):
    client, store = api
    job, auth = submit(client, data)
    process_job(store, *store.claim())
    result = client.get(f"/api/jobs/{job['id']}", headers=auth).json()
    assert result['state'] == 'failed'
    assert result['error'].startswith('Invalid JAR:')
    assert not result['retryable']
    assert not result['artifacts']


def test_cancel_retry_and_expire(api):
    client, store = api
    first, auth = submit(client, jar_bytes())
    base = f"/api/jobs/{first['id']}"
    assert client.post(base + '/cancel', headers=auth).json()['state'] == 'cancelled'
    assert not store.claim()
    assert client.post(base + '/retry', headers=auth).status_code == 409
    job, auth = submit(client, jar_bytes())
    base = f"/api/jobs/{job['id']}"
    claimed = store.claim()
    store.complete(*claimed, error='Temporary tool failure')
    assert client.post(base + '/retry', headers=auth).json()['state'] == 'queued'
    job_id, attempt = store.claim()
    assert attempt == 2
    store.complete(job_id, attempt, error='Temporary tool failure')
    assert client.post(base + '/retry', headers=auth).status_code == 409
    with store.connect(write=True) as db:
        db.execute('UPDATE jobs SET expires=0 WHERE id=?', (job_id,))
    assert client.get(base, headers=auth).status_code == 410
    store.cleanup()
    assert not store.directory(job_id).exists()


def test_quota_is_atomic(tmp_path):
    store = Store(tmp_path)
    for _ in range(3):
        store.create('one network', 'a.jar', 100, '26.3', False)
    with pytest.raises(JobError, match='quota'):
        store.create('one network', 'a.jar', 100, '26.3', False)


def test_rust_compilation_failure_is_reported(tmp_path, monkeypatch):
    compiler = os.environ.get('HB_RUSTC') or shutil.which('rustc')
    if not compiler:
        pytest.skip('Set HB_RUSTC or install Rust to run compiler diagnostics tests.')
    monkeypatch.setenv('PATH', str(Path(compiler).parent) + os.pathsep + os.environ['PATH'])
    source = tmp_path / 'source'
    validation, diagnostics, stages = [], [], []
    check_translated({'src/translated.rs': 'pub fn broken() -> i32 { "a string" }\n'}, source,
                     stages.append, validation, diagnostics)
    assert 'checking' in stages
    assert validation[-1]['status'] == 'failed'
    assert 'mismatched types' in diagnostics[-1]
    assert not (tmp_path / 'standalone.rlib').exists()
