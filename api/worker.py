import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from .store import JOB_TIMEOUT, JobError, Store


LOG = logging.getLogger('horizonbridge.worker')
STOPPING = False


def stop(_sig, _frame):
    global STOPPING
    STOPPING = True


def kill_group(process):
    if os.name == 'nt':
        if process.poll() is None:
            subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'], capture_output=True, check=False)
            if process.poll() is None:
                process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=15)


def read_json(path, max_bytes=2 * 1024 * 1024):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > max_bytes:
        raise ValueError('Invalid processor output.')
    return json.loads(path.read_text(encoding='utf-8'))


def transfer(workspace, destination, result):
    destination.mkdir()
    total = 0
    for folder, items, key in [('artifacts', result['artifacts'], 'name'), ('source', result['files'], 'path')]:
        root = workspace / folder
        if root.is_symlink():
            raise ValueError('Invalid processor output directory.')
        for item in items:
            name = item[key]
            if not isinstance(name, str) or '\\' in name or ':' in name or len(name) > 400:
                raise ValueError('Invalid processor output filename.')
            parts = name.split('/')
            if any(part in {'', '.', '..'} for part in parts) or (folder == 'artifacts' and len(parts) != 1):
                raise ValueError('Invalid processor output filename.')
            source = root.joinpath(*parts)
            if not source.is_file() or source.resolve() != source or source.stat().st_size != item['size']:
                raise ValueError('Processor output does not match its manifest.')
            total += item['size']
            if total > 160 * 1024 * 1024:
                raise ValueError('Processor output exceeded its storage budget.')
            output = destination.joinpath(folder, *parts)
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, output)


def process_job(store, job_id, attempt):
    job_dir = store.directory(job_id)
    with tempfile.TemporaryDirectory(prefix='hb-', dir=os.environ.get('HB_SCRATCH_DIR')) as scratch:
        workspace = Path(scratch).resolve()
        shutil.copyfile(job_dir / 'input.jar', workspace / 'input.jar')
        env = {name: value for name, value in os.environ.items() if name in {
            'PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
            'LOCALAPPDATA', 'USERPROFILE', 'CARGO_HOME', 'RUSTUP_HOME', 'LD_LIBRARY_PATH', 'JAVA_HOME',
            'LIBCLANG_PATH', 'PKG_CONFIG_PATH', 'INCLUDE', 'LIB', 'LIBPATH', 'RUSTUP_TOOLCHAIN',
        } or name.startswith('HORIZONBRIDGE_')}
        for name in ('HB_REQUIRE_SANDBOX', 'HB_VINEFLOWER_JAR'):
            if name in os.environ:
                env[name] = os.environ[name]
        for name in ('temp', 'home'):
            (workspace / name).mkdir()
        env.update(TMPDIR=str(workspace / 'temp'), TEMP=str(workspace / 'temp'), TMP=str(workspace / 'temp'),
                   HOME=str(workspace / 'home'), CARGO_NET_OFFLINE='true', PYTHONDONTWRITEBYTECODE='1',
                   LANG='C.UTF-8', LC_ALL='C.UTF-8')
        process = subprocess.Popen([sys.executable, '-m', 'api.pipeline', str(workspace)], env=env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   start_new_session=os.name != 'nt')
        deadline = time.monotonic() + JOB_TIMEOUT
        seen = 0

        def update_progress():
            nonlocal seen
            path = workspace / 'progress.json'
            if path.exists():
                entries = read_json(path, 256 * 1024)
                for event in entries[seen:]:
                    store.progress(job_id, attempt, event['stage'], event.get('metadata'))
                seen = len(entries)

        try:
            while process.poll() is None:
                if STOPPING or not store.active(job_id, attempt):
                    return
                if time.monotonic() > deadline:
                    store.complete(job_id, attempt, error='Conversion exceeded its time budget.')
                    return
                update_progress()
                time.sleep(0.35)
        finally:
            kill_group(process)
        if not store.active(job_id, attempt):
            return
        update_progress()
        if process.returncode:
            raise RuntimeError('Conversion subprocess failed.')
        result = read_json(workspace / 'outcome.json')
        if 'error' in result:
            store.complete(job_id, attempt, error=result['error'])
            return
        transfer(workspace, job_dir / f'attempt-{attempt}', result)
        store.complete(job_id, attempt, result=result)


def main():
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    if os.environ.get('HB_REQUIRE_SANDBOX') == '1':
        from .sandbox import process_private, restrict

        process_private()
        # A separate process tests the actual kernel policy without limiting the queue worker.
        with tempfile.TemporaryDirectory(dir=os.environ.get('HB_SCRATCH_DIR')) as scratch:
            subprocess.run([sys.executable, '-c', 'from pathlib import Path; from api.sandbox import restrict; '
                            'import sys; restrict(Path(sys.argv[1]))', scratch], check=True)
    store = Store()
    next_cleanup = 0
    LOG.info('Processing queue is ready')
    while not STOPPING:
        if time.monotonic() >= next_cleanup:
            store.cleanup()
            next_cleanup = time.monotonic() + 30
        job = store.claim()
        if not job:
            time.sleep(0.4)
            continue
        job_id, attempt = job
        try:
            process_job(store, job_id, attempt)
        except JobError:
            continue
        except Exception:
            LOG.exception('Processing job %s attempt %s failed', job_id, attempt)
            store.complete(job_id, attempt, error='The processing service could not finish this conversion.')


if __name__ == '__main__':
    main()
