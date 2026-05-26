-- ============================================================
--  AETHERX MIGRATION 005 — Institutional OMS & Positions
--  Adds relational order relationships and extends positions
--  for robust margin and lifecycle tracking.
-- ============================================================

-- ── 1. Order Relationships ──────────────────────────────────
CREATE TABLE IF NOT EXISTS order_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    child_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    relation_type VARCHAR(30) NOT NULL, -- TAKE_PROFIT | STOP_LOSS | OCO_PAIR | TRAILING_STOP
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_parent_child UNIQUE (parent_order_id, child_order_id)
);

CREATE INDEX IF NOT EXISTS idx_order_rel_parent ON order_relationships(parent_order_id);
CREATE INDEX IF NOT EXISTS idx_order_rel_child ON order_relationships(child_order_id);

-- ── 2. Extend Positions ──────────────────────────────────────
ALTER TABLE positions
    ADD COLUMN IF NOT EXISTS leverage NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    ADD COLUMN IF NOT EXISTS liquidation_price NUMERIC(20, 8),
    ADD COLUMN IF NOT EXISTS margin_used NUMERIC(20, 8) NOT NULL DEFAULT 0.00000000,
    ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC(20, 8) NOT NULL DEFAULT 0.00000000;

-- ── 3. Extend Orders (Optional missing states) ────────────────
-- Ensure we can store new states. Since `status` is a VARCHAR(20), no enum alter is needed.
-- Typical new states: TRIGGER_WAITING, EXPIRED, REJECTED.

COMMENT ON TABLE order_relationships IS 'Tracks parent-child order relationships like OCO and Bracket orders for synchronized lifecycle management.';
