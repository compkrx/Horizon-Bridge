CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    owner TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    target TEXT NOT NULL,
    ai INTEGER NOT NULL,
    state TEXT NOT NULL,
    stage TEXT NOT NULL,
    history TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    upload_key TEXT,
    upload_until INTEGER,
    lease_until INTEGER,
    error TEXT,
    metadata TEXT,
    result TEXT,
    advice TEXT,
    advice_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(owner, created);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state, created);
