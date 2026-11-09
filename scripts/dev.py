"""Start the local-only API, queue processor, and Vite UI in one terminal."""

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if npm is None or not (root / 'frontend/node_modules/vite').is_dir():
        sys.exit('Install Node dependencies first with npm --prefix frontend ci.')
    env = {**os.environ, 'HB_PROXY_SECRET': '', 'PYTHONDONTWRITEBYTECODE': '1'}
    commands = [
        ([sys.executable, '-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', '8788',
          '--no-access-log', '--no-proxy-headers'], root),
        ([sys.executable, '-m', 'api.worker'], root),
        ([npm, 'run', 'dev', '--', '--host', '127.0.0.1', '--strictPort'], root / 'frontend'),
    ]
    processes = []
    try:
        for command, cwd in commands:
            processes.append(subprocess.Popen(command, cwd=cwd, env=env))
        print('HorizonBridge local UI: http://127.0.0.1:5173', flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                if os.name == 'nt':
                    subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                else:
                    process.terminate()
        for process in processes:
            process.wait(timeout=20)


if __name__ == '__main__':
    main()
