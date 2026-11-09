import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


MAX_UPLOAD = 32 * 1024 * 1024
RETENTION = int(os.environ.get('HB_RETENTION_HOURS', '12'))
MAX_ATTEMPTS = 2
JOB_TIMEOUT = int(os.environ.get('HB_JOB_TIMEOUT', '1200'))
UPLOAD_TIMEOUT = 180


def now():
    return int(time.time())


def iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


class JobError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Store:
    def __init__(self, root=None):
        self.root = Path(root or os.environ.get('HB_DATA_DIR', '.horizonbridge')).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript((Path(__file__).parent / 'migrations/001.sql').read_text())

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.root / 'jobs.sqlite3', timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            if write:
                db.commit()
        except BaseException:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    def directory(self, job_id):
        return self.root / job_id

    def create(self, owner, filename, size, target, ai):
        job_id, token = secrets.token_hex(16), secrets.token_urlsafe(32)
        stamp = now()
        history = json.dumps([{'stage': 'awaiting_upload', 'at': iso(stamp)}])
        with self.connect(write=True) as db:
            recent, active = db.execute('''SELECT COUNT(*), COALESCE(SUM(state IN
                ('awaiting_upload','queued','running')), 0) FROM jobs WHERE owner=? AND created>?''',
                (owner, stamp - 3600)).fetchone()
            total = db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('awaiting_upload','queued','running')").fetchone()[0]
            disk = db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]
            if recent >= 12 or active >= 3:
                raise JobError(429, 'Job quota reached for this network. Try again later.')
            if total >= 30 or disk >= 150:
                raise JobError(503, 'The conversion queue is full. Try again later.')
            db.execute('''INSERT INTO jobs(id,token_hash,owner,filename,size,target,ai,state,stage,
                history,created,expires) VALUES (?,?,?,?,?,?,?,'awaiting_upload','awaiting_upload',?,?,?)''',
                (job_id, digest(token), owner, filename, size, target, ai, history, stamp, stamp + RETENTION * 3600))
        return job_id, token

    def get(self, job_id, token=None):
        with self.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not row or (token is not None and not secrets.compare_digest(digest(token), row['token_hash'])):
            raise JobError(404, 'Job not found or its access token is invalid.')
        if row['expires'] <= now():
            raise JobError(410, 'This job has expired.')
        return row

    def transition(self, db, row, state, stage, error=None):
        history = json.loads(row['history'])
        if row['stage'] != stage:
            history.append({'stage': stage, 'at': iso(now())})
        db.execute('UPDATE jobs SET state=?,stage=?,history=?,error=? WHERE id=?',
                   (state, stage, json.dumps(history), error, row['id']))

    def claim_upload(self, job_id):
        key = secrets.token_hex(16)
        with self.connect(write=True) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['expires'] <= now():
                raise JobError(410, 'This job has expired.')
            if row['state'] != 'awaiting_upload' or (row['upload_until'] or 0) > now():
                raise JobError(409, 'This job is no longer accepting an upload.')
            self.directory(job_id).mkdir(exist_ok=True)
            db.execute('UPDATE jobs SET upload_key=?,upload_until=? WHERE id=?',
                       (key, now() + UPLOAD_TIMEOUT, job_id))
            self.transition(db, row, 'awaiting_upload', 'uploading')
        return key

    def release_upload(self, job_id, key):
        with self.connect(write=True) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=? AND upload_key=?', (job_id, key)).fetchone()
            if row:
                db.execute('UPDATE jobs SET upload_key=NULL,upload_until=NULL WHERE id=?', (job_id,))
                if row['state'] == 'awaiting_upload':
                    self.transition(db, row, 'awaiting_upload', 'awaiting_upload')

    def queue_upload(self, job_id, key, temporary):
        with self.connect(write=True) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=? AND upload_key=?', (job_id, key)).fetchone()
            if not row or row['state'] != 'awaiting_upload' or min(row['expires'], row['upload_until']) <= now():
                raise JobError(409, 'Upload authorization has ended.')
            temporary.replace(self.directory(job_id) / 'input.jar')
            db.execute('UPDATE jobs SET upload_key=NULL,upload_until=NULL WHERE id=?', (job_id,))
            self.transition(db, row, 'queued', 'queued')

    def action(self, job_id, action):
        with self.connect(write=True) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['expires'] <= now():
                raise JobError(410, 'This job has expired.')
            if action == 'cancel' and row['state'] in {'awaiting_upload', 'queued', 'running'}:
                self.transition(db, row, 'cancelled', 'cancelled')
                return
            if action == 'retry' and self.retryable(row):
                db.execute('UPDATE jobs SET result=NULL,metadata=NULL,lease_until=NULL WHERE id=?', (job_id,))
                self.transition(db, row, 'queued', 'queued')
                return
            raise JobError(409, f'This job cannot {action} in its current state.')

    def retryable(self, row):
        return (row['state'] == 'failed' and row['attempt'] < MAX_ATTEMPTS
                and not (row['error'] or '').startswith('Invalid JAR')
                and (self.directory(row['id']) / 'input.jar').is_file())

    def claim(self):
        with self.connect(write=True) as db:
            for row in db.execute("SELECT * FROM jobs WHERE state='running' AND lease_until<=?", (now(),)).fetchall():
                if row['attempt'] < MAX_ATTEMPTS:
                    self.transition(db, row, 'queued', 'queued')
                else:
                    self.transition(db, row, 'failed', 'failed', 'The processing service was interrupted.')
            row = db.execute("SELECT * FROM jobs WHERE state='queued' AND expires>? ORDER BY created LIMIT 1", (now(),)).fetchone()
            if row:
                db.execute('UPDATE jobs SET attempt=attempt+1,lease_until=?,metadata=NULL WHERE id=?', (now() + 30, row['id']))
                self.transition(db, row, 'running', 'inspecting')
                return row['id'], row['attempt'] + 1
        return None

    def active(self, job_id, attempt):
        with self.connect(write=True) as db:
            return db.execute('''UPDATE jobs SET lease_until=? WHERE id=? AND attempt=?
                AND state='running' AND expires>?''', (now() + 30, job_id, attempt, now())).rowcount == 1

    def progress(self, job_id, attempt, stage, metadata=None):
        with self.connect(write=True) as db:
            row = db.execute("SELECT * FROM jobs WHERE id=? AND attempt=? AND state='running' AND expires>?",
                             (job_id, attempt, now())).fetchone()
            if not row:
                raise JobError(409, 'The worker lease ended.')
            self.transition(db, row, 'running', stage)
            if metadata is not None:
                db.execute('UPDATE jobs SET metadata=? WHERE id=?', (json.dumps(metadata), job_id))

    def complete(self, job_id, attempt, result=None, error=None):
        with self.connect(write=True) as db:
            row = db.execute("SELECT * FROM jobs WHERE id=? AND attempt=? AND state='running' AND expires>?",
                             (job_id, attempt, now())).fetchone()
            if row:
                self.transition(db, row, 'failed' if error else 'succeeded', 'failed' if error else 'ready', error)
                db.execute('UPDATE jobs SET result=?,lease_until=NULL WHERE id=?',
                           (json.dumps(result) if result else None, job_id))

    def snapshot(self, row):
        result = json.loads(row['result']) if row['result'] else {}
        return {'id': row['id'], 'filename': row['filename'], 'size': row['size'], 'target': row['target'],
                'state': row['state'], 'stage': row['stage'], 'history': json.loads(row['history']),
                'createdAt': iso(row['created']), 'expiresAt': iso(row['expires']), 'attempt': row['attempt'],
                'error': row['error'], 'retryable': self.retryable(row), 'ai': bool(row['ai']),
                'metadata': json.loads(row['metadata']) if row['metadata'] else None,
                'report': result.get('report'), 'artifacts': result.get('artifacts', []), 'files': result.get('files', [])}

    def cleanup(self):
        with self.connect(write=True) as db:
            db.execute("UPDATE jobs SET upload_until=NULL,upload_key=NULL WHERE upload_until<=?", (now(),))
            expired = db.execute('SELECT id FROM jobs WHERE expires<=? AND COALESCE(lease_until,0)<=?', (now(), now())).fetchall()
            for row in expired:
                path = self.directory(row['id'])
                try:
                    if path.exists():
                        shutil.rmtree(path)
                except OSError:
                    continue
                db.execute('DELETE FROM jobs WHERE id=?', (row['id'],))
