-- ============================================================
--  AETHERX TRADING ENGINE  –  Database Schema DDL
--  Double-Entry Bookkeeping Ledger + Active Trade Tracking
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Accounts ────────────────────────────────────────────────
-- Holds wallet balances for cash (USD) and assets (BTC, ETH, SOL)
-- Strict CHECK constraint secures no overdrafts (balance >= 0)
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_number  VARCHAR(50) NOT NULL UNIQUE,           -- Format: ACC-USERID-[CURRENCY]
    account_name    VARCHAR(255),
    currency        VARCHAR(10) NOT NULL,                  -- USD | BTC | ETH | SOL
    balance         NUMERIC(20, 8) NOT NULL DEFAULT 0.00000000,
    account_type    VARCHAR(50) NOT NULL DEFAULT 'CHECKING',-- CHECKING | ESCROW | FEE
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | FROZEN
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT chk_balance_non_negative CHECK (balance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_id);
CREATE INDEX IF NOT EXISTS idx_accounts_currency ON accounts(currency);
CREATE INDEX IF NOT EXISTS idx_accounts_number ON accounts(account_number);

-- ── Transactions Ledger (Summary Records) ───────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference           VARCHAR(255) NOT NULL UNIQUE,   -- E.g. TX-MATCH-[UUID] | TX-SEED-[UUID]
    status              VARCHAR(20) NOT NULL DEFAULT 'COMPLETED', -- COMPLETED | FAILED
    amount              NUMERIC(20, 8) NOT NULL,
    currency            VARCHAR(10) NOT NULL,
    source_account_id   UUID REFERENCES accounts(id),
    dest_account_id     UUID REFERENCES accounts(id),
    description         VARCHAR(500),
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

-- ── Ledger Entries (Bookkeeping Legs) ───────────────────────
-- Every financial movement writes exactly two matching legs (1 Debit, 1 Credit).
-- Sum of amounts grouped by transaction_id MUST always balance to exactly zero.
CREATE TABLE IF NOT EXISTS ledger_entries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    entry_type      VARCHAR(6) NOT NULL,                -- DEBIT | CREDIT
    amount          NUMERIC(20, 8) NOT NULL,            -- Positive value representing size of leg
    currency        VARCHAR(10) NOT NULL,
    description     VARCHAR(500),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT chk_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_entries_txn ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_entries_account ON ledger_entries(account_id);

-- ── Orders ───────────────────────────────────────────────────
-- Holds orders submitted to the system
CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol          VARCHAR(20) NOT NULL,                  -- BTCUSDT | ETHUSDT | SOLUSDT
    side            VARCHAR(10) NOT NULL,                  -- BUY | SELL
    type            VARCHAR(10) NOT NULL,                  -- LIMIT | MARKET
    price           NUMERIC(20, 8) NOT NULL,
    quantity        NUMERIC(20, 8) NOT NULL,
    filled_quantity NUMERIC(20, 8) NOT NULL DEFAULT 0.00000000,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',-- PENDING | FILLED | PARTIALLY_FILLED | CANCELED
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- ── Executed Trades ──────────────────────────────────────────
-- Holds individual order executions matching buyers and sellers
CREATE TABLE IF NOT EXISTS trades (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    matching_order_id   UUID REFERENCES orders(id) ON DELETE SET NULL,
    symbol              VARCHAR(20) NOT NULL,
    price               NUMERIC(20, 8) NOT NULL,
    quantity            NUMERIC(20, 8) NOT NULL,
    side                VARCHAR(10) NOT NULL,                  -- BUY | SELL
    executed_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_order ON trades(order_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_executed ON trades(executed_at DESC);

-- ── Positions ───────────────────────────────────────────────
-- Holds current consolidated asset inventories and cost basis
CREATE TABLE IF NOT EXISTS positions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol              VARCHAR(20) NOT NULL,                  -- BTCUSDT | ETHUSDT | SOLUSDT
    size                NUMERIC(20, 8) NOT NULL DEFAULT 0.00000000, -- Size in units of base asset
    average_entry_price NUMERIC(20, 8) NOT NULL DEFAULT 0.00000000, -- Weighted cost basis
    unrealized_pnl      NUMERIC(20, 8) NOT NULL DEFAULT 0.00000000, -- Realtime PnL relative to ticker
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_user_symbol UNIQUE(user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
