-- FinPilot schema for Cloudflare D1 (SQLite).
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    ledger_id TEXT NOT NULL,
    -- Client-generated id for the draft, so a double-click can't save twice.
    draft_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
    amount REAL NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    merchant TEXT,
    payment_method TEXT,
    description TEXT,
    source_engine TEXT,
    source_note TEXT,          -- redacted copy of what the user said
    edited_fields TEXT,        -- JSON array of fields the user changed during review
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT,
    UNIQUE (ledger_id, draft_id)
);
CREATE INDEX IF NOT EXISTS idx_tx_ledger_date ON transactions (ledger_id, date DESC, created_at DESC);

-- Monthly limits per category. Spent totals are computed from transactions, so they can never drift.
CREATE TABLE IF NOT EXISTS budget_limits (
    ledger_id TEXT NOT NULL,
    month TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    limit_amount REAL NOT NULL CHECK (limit_amount >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (ledger_id, month, category, currency)
);
