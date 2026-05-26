-- ============================================================
--  AETHERX MIGRATION 004 — Strategy DSL
--  Persistent storage for user-defined trading strategies,
--  their execution history, and backtest results.
-- ============================================================

-- ── Trading Strategies ───────────────────────────────────────
-- Each strategy is a DSL rule set that evaluates against live
-- or replay market data and triggers simulated orders when conditions are met.
CREATE TABLE IF NOT EXISTS strategies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    dsl_text        TEXT NOT NULL,                   -- Raw DSL source e.g. "WHEN EMA20 > EMA50 AND RSI < 40 THEN BUY BTCUSDT SIZE 0.2"
    parsed_ast      JSONB,                           -- Cached parsed AST for efficient evaluation
    symbol          VARCHAR(20) NOT NULL,            -- BTCUSDT | ETHUSDT | SOLUSDT
    is_active       BOOLEAN NOT NULL DEFAULT false,  -- Only active strategies are evaluated
    cooldown_sec    INTEGER NOT NULL DEFAULT 60,     -- Minimum seconds between signals from this strategy
    max_daily_trades INTEGER NOT NULL DEFAULT 10,    -- Safety circuit breaker: max trades per day
    last_fired_at   TIMESTAMPTZ,                     -- Last time this strategy produced a signal
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_user    ON strategies(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_strategies_symbol  ON strategies(symbol, is_active);

-- ── Strategy Execution Log ───────────────────────────────────
-- Records every time a strategy evaluated to true and triggered an action.
CREATE TABLE IF NOT EXISTS strategy_signals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id     UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    symbol          VARCHAR(20) NOT NULL,
    signal_type     VARCHAR(10) NOT NULL,            -- BUY | SELL
    triggered_price NUMERIC(20, 8) NOT NULL,        -- Market price when signal fired
    order_id        UUID REFERENCES orders(id),     -- The order created by this signal (null if simulation)
    context_snapshot JSONB NOT NULL DEFAULT '{}',   -- Snapshot of indicator values at trigger time
    executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_strategy   ON strategy_signals(strategy_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_user       ON strategy_signals(user_id, executed_at DESC);

-- ── Backtest Results ─────────────────────────────────────────
-- Stores results of backtesting a strategy against historical candle data.
CREATE TABLE IF NOT EXISTS backtest_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id     UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    symbol          VARCHAR(20) NOT NULL,
    from_time       TIMESTAMPTZ NOT NULL,
    to_time         TIMESTAMPTZ NOT NULL,
    candle_count    INTEGER NOT NULL,
    total_signals   INTEGER NOT NULL DEFAULT 0,
    total_trades    INTEGER NOT NULL DEFAULT 0,
    win_count       INTEGER NOT NULL DEFAULT 0,
    loss_count      INTEGER NOT NULL DEFAULT 0,
    win_rate        NUMERIC(5, 2),                  -- Percentage
    net_pnl_usd     NUMERIC(20, 8),
    max_drawdown    NUMERIC(20, 8),
    sharpe_ratio    NUMERIC(10, 4),
    trade_log       JSONB NOT NULL DEFAULT '[]',    -- Array of individual trade records
    run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_strategy  ON backtest_results(strategy_id, run_at DESC);

COMMENT ON TABLE strategies IS 
'User-defined trading strategies written in the AetherX Strategy DSL.
 DSL example: WHEN EMA20 > EMA50 AND RSI < 40 THEN BUY BTCUSDT SIZE 0.2
 Active strategies are evaluated on every new indicator candle close.
 cooldown_sec prevents signal flooding. max_daily_trades is a safety circuit breaker.';

COMMENT ON TABLE strategy_signals IS 
'Immutable execution log of every strategy signal. Enables auditing, debugging,
 and performance analysis. context_snapshot captures all indicator values at trigger time.';
