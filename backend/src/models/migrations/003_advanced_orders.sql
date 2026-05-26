-- ============================================================
--  AETHERX MIGRATION 003 — Advanced Order Types
--  Extends orders table with IOC, FOK, Stop-Limit, Trailing Stop,
--  Iceberg support. Adds stop_orders queue table.
-- ============================================================

-- ── Extend Orders Table ──────────────────────────────────────
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS order_subtype  VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    -- STANDARD | IOC | FOK | STOP_LIMIT | TRAILING_STOP | ICEBERG

    ADD COLUMN IF NOT EXISTS time_in_force  VARCHAR(10) NOT NULL DEFAULT 'GTC',
    -- GTC (Good-Till-Canceled) | IOC (Immediate-or-Cancel) | FOK (Fill-or-Kill) | GTD (Good-Till-Date)

    ADD COLUMN IF NOT EXISTS stop_price     NUMERIC(20, 8),
    -- For STOP_LIMIT: trigger price at which order enters the book
    -- For TRAILING_STOP: current dynamic stop level (updated on each tick)

    ADD COLUMN IF NOT EXISTS trail_amount   NUMERIC(20, 8),
    -- For TRAILING_STOP: distance from market price the stop trails by

    ADD COLUMN IF NOT EXISTS display_qty    NUMERIC(20, 8),
    -- For ICEBERG: the visible quantity shown in the order book

    ADD COLUMN IF NOT EXISTS hidden_qty     NUMERIC(20, 8),
    -- For ICEBERG: the total hidden reserve behind the iceberg tip

    ADD COLUMN IF NOT EXISTS expires_at     TIMESTAMPTZ,
    -- For GTD orders: auto-cancel after this timestamp

    ADD COLUMN IF NOT EXISTS trigger_price  NUMERIC(20, 8);
    -- For STOP_LIMIT: the price at which the limit order triggers

-- ── Resting Stop Orders Queue ────────────────────────────────
-- Stop orders sit here waiting for their trigger price to be crossed.
-- On trigger, they are converted to LIMIT orders and enter the book.
CREATE TABLE IF NOT EXISTS stop_orders (
    id              UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    symbol          VARCHAR(20) NOT NULL,
    side            VARCHAR(10) NOT NULL,
    order_subtype   VARCHAR(20) NOT NULL,           -- STOP_LIMIT | TRAILING_STOP
    stop_price      NUMERIC(20, 8) NOT NULL,        -- Current trigger price
    limit_price     NUMERIC(20, 8),                 -- For STOP_LIMIT: limit price after trigger
    trail_amount    NUMERIC(20, 8),                 -- For TRAILING_STOP: trail distance
    quantity        NUMERIC(20, 8) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'WATCHING', -- WATCHING | TRIGGERED | CANCELED
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    triggered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stop_orders_symbol  ON stop_orders(symbol, status, stop_price);
CREATE INDEX IF NOT EXISTS idx_stop_orders_user    ON stop_orders(user_id, status);

-- ── Execution Quality Log ────────────────────────────────────
-- Records execution quality metrics for each fill. 
-- Enables slippage analysis and execution analytics.
CREATE TABLE IF NOT EXISTS execution_quality (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id        UUID NOT NULL REFERENCES trades(id),
    order_id        UUID NOT NULL REFERENCES orders(id),
    requested_price NUMERIC(20, 8) NOT NULL,        -- Price the user intended to trade at
    executed_price  NUMERIC(20, 8) NOT NULL,        -- Actual fill price
    slippage_bps    NUMERIC(10, 4) NOT NULL,        -- (|executed - requested| / requested) * 10000
    market_impact   NUMERIC(10, 4),                 -- Estimated price impact in bps
    execution_ms    NUMERIC(10, 4),                 -- Time from order submission to fill (ms)
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exec_quality_order  ON execution_quality(order_id);
CREATE INDEX IF NOT EXISTS idx_exec_quality_symbol ON execution_quality(trade_id);

COMMENT ON TABLE stop_orders IS 
'Resting stop orders watching the market. On tick-cross of stop_price, 
 the MatchingEngine converts these to active LIMIT orders.
 TRAILING_STOP: stop_price updates on each favorable tick by trail_amount.';

COMMENT ON TABLE execution_quality IS 
'Per-fill execution analytics. slippage_bps = abs(executed - requested) / requested * 10000.
 Zero slippage = perfect execution. Used in microstructure analytics and strategy evaluation.';
