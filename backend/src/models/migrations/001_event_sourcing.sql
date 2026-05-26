-- ============================================================
--  AETHERX MIGRATION 001 — Event Sourcing Architecture
--  Append-only domain event log. All system actions produce
--  an immutable, sequenced event record here.
-- ============================================================

-- ── Global Domain Event Store ────────────────────────────────
-- Every significant state change in the system is recorded here.
-- Consumers can replay from any sequence number to reconstruct state.
CREATE TABLE IF NOT EXISTS event_store (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence        BIGSERIAL NOT NULL,              -- Global monotonic ordering key
    aggregate_id    VARCHAR(255) NOT NULL,            -- e.g. order-UUID, user-UUID, account-UUID
    aggregate_type  VARCHAR(100) NOT NULL,            -- ORDER | ACCOUNT | POSITION | TRADE
    event_type      VARCHAR(100) NOT NULL,            -- ORDER_PLACED | TRADE_SETTLED | ESCROW_LOCKED etc.
    payload         JSONB NOT NULL DEFAULT '{}',     -- Full event data snapshot
    metadata        JSONB NOT NULL DEFAULT '{}',     -- Correlation IDs, causation IDs, source service
    idempotency_key VARCHAR(255) UNIQUE,              -- Prevents duplicate event processing
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying patterns
CREATE INDEX IF NOT EXISTS idx_event_store_aggregate    ON event_store(aggregate_id, sequence ASC);
CREATE INDEX IF NOT EXISTS idx_event_store_type         ON event_store(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_store_sequence     ON event_store(sequence ASC);
CREATE INDEX IF NOT EXISTS idx_event_store_occurred     ON event_store(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_store_agg_type     ON event_store(aggregate_type, occurred_at DESC);

-- ── Event Snapshots (Performance Optimization) ──────────────
-- Periodic snapshots of aggregate state to avoid replaying all events
-- from origin on every read. Not required for correctness, only performance.
CREATE TABLE IF NOT EXISTS event_snapshots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aggregate_id    VARCHAR(255) NOT NULL,
    aggregate_type  VARCHAR(100) NOT NULL,
    snapshot_data   JSONB NOT NULL,                  -- Full serialized state at snapshot_seq
    snapshot_seq    BIGINT NOT NULL,                 -- The event_store sequence this snapshot was taken at
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_snapshot_aggregate UNIQUE(aggregate_id, aggregate_type)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_aggregate ON event_snapshots(aggregate_id);

-- ── Comments documenting event taxonomy ─────────────────────
COMMENT ON TABLE event_store IS 
'Immutable append-only log of all domain events. This is the system of record — 
 the source of truth for all state. Every mutation to orders, balances, positions, 
 and trades is recorded here before being reflected in mutable tables.';

COMMENT ON COLUMN event_store.sequence IS 
'Global monotonically increasing sequence. Used for ordering events across aggregates 
 and for checkpointing consumers. Never gaps, never reused.';

COMMENT ON COLUMN event_store.aggregate_id IS 
'The entity this event belongs to (order ID, user ID, account ID). Enables querying 
 all events for a specific entity to reconstruct its history.';

COMMENT ON COLUMN event_store.idempotency_key IS 
'Unique key preventing duplicate event recording. Format: {source_service}:{correlation_id}. 
 INSERT ... ON CONFLICT DO NOTHING ensures at-most-once recording.';
