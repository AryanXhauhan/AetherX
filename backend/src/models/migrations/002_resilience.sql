-- ============================================================
--  AETHERX MIGRATION 002 — Resilience & Recovery
--  Dead-letter queue, idempotency keys, retry job tracking.
-- ============================================================

-- ── Dead Letter Queue ────────────────────────────────────────
-- Jobs that have exhausted all retry attempts are persisted here
-- for manual inspection and potential re-queuing.
CREATE TABLE IF NOT EXISTS dead_letter_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type        VARCHAR(100) NOT NULL,            -- SETTLE_TRADE | LOCK_ESCROW | PUBLISH_EVENT
    payload         JSONB NOT NULL,
    error_message   TEXT,
    error_stack     TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_attempted  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_type    ON dead_letter_events(job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_created ON dead_letter_events(created_at DESC);

-- ── Idempotency Keys ─────────────────────────────────────────
-- Stores results of processed operations keyed by idempotency token.
-- Allows clients to safely retry requests without duplicate side effects.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             VARCHAR(255) PRIMARY KEY,
    result_status   INTEGER NOT NULL,                -- HTTP status code of original response
    result_body     JSONB NOT NULL,                  -- Response body snapshot
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL             -- TTL: typically NOW() + 24h
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- ── Ledger Reconciliation Log ────────────────────────────────
-- Records the output of each reconciliation worker run.
-- If a discrepancy is found, it is logged here for audit.
CREATE TABLE IF NOT EXISTS reconciliation_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          VARCHAR(20) NOT NULL DEFAULT 'BALANCED', -- BALANCED | DISCREPANCY
    currency        VARCHAR(10) NOT NULL,
    debit_sum       NUMERIC(30, 8) NOT NULL,
    credit_sum      NUMERIC(30, 8) NOT NULL,
    net_delta       NUMERIC(30, 8) NOT NULL,         -- Should be 0.00000000 always
    entry_count     INTEGER NOT NULL,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_run ON reconciliation_log(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON reconciliation_log(status, run_at DESC);

COMMENT ON TABLE dead_letter_events IS 
'Permanently failed jobs after exhausting retry budget. Manual inspection required.
 Use RetryQueue.requeueFromDLQ(id) to attempt re-processing.';

COMMENT ON TABLE idempotency_keys IS 
'Order submission deduplication. Clients send X-Idempotency-Key header. 
 Duplicate requests within TTL window receive cached original response.';

COMMENT ON TABLE reconciliation_log IS 
'Output of periodic double-entry balance verification runs.
 DISCREPANCY status indicates a critical accounting error requiring immediate investigation.
 Invariant: net_delta MUST be 0.00000000 for all currencies at all times.';
