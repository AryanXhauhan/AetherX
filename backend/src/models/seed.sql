-- ============================================================
--  AETHERX TRADING ENGINE  –  Database Seed DML
--  Seeding System accounts and initial static fixtures
-- ============================================================

-- ── 1. Create System Institutional User ──────────────────────
INSERT INTO users (id, email, password_hash)
VALUES ('00000000-0000-0000-0000-000000000000', 'system@aetherx.internal', '$2b$10$SystemUserPasswordHashNotForAuthSecurityReasonsDummy')
ON CONFLICT (email) DO NOTHING;

-- ── 2. Create System Balance Accounts ───────────────────────
-- These act as transaction counterparties, fee sinks, and escrow holding pools

-- SYSTEM USD ACCOUNT (Exchange Cash Inventory)
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000001', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-USD', 
    'System USD Liquidity Account', 
    'USD', 
    1000000000.00000000, 
    'CHECKING'
)
ON CONFLICT (account_number) DO NOTHING;

-- SYSTEM BTC ACCOUNT (Exchange BTC Asset Inventory)
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000002', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-BTC', 
    'System BTC Asset Account', 
    'BTC', 
    100000.00000000, 
    'CHECKING'
)
ON CONFLICT (account_number) DO NOTHING;

-- SYSTEM ETH ACCOUNT (Exchange ETH Asset Inventory)
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000003', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-ETH', 
    'System ETH Asset Account', 
    'ETH', 
    1000000.00000000, 
    'CHECKING'
)
ON CONFLICT (account_number) DO NOTHING;

-- SYSTEM SOL ACCOUNT (Exchange SOL Asset Inventory)
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000004', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-SOL', 
    'System SOL Asset Account', 
    'SOL', 
    10000000.00000000, 
    'CHECKING'
)
ON CONFLICT (account_number) DO NOTHING;

-- SYSTEM USD ESCROW ACCOUNT (Holds user cash during open BUY limit orders)
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000005', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-USD-ESCROW', 
    'System USD Escrow Vault', 
    'USD', 
    0.00000000, 
    'ESCROW'
)
ON CONFLICT (account_number) DO NOTHING;

-- SYSTEM BTC ESCROW ACCOUNT (Holds user BTC during open SELL limit orders)
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000006', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-BTC-ESCROW', 
    'System BTC Escrow Vault', 
    'BTC', 
    0.00000000, 
    'ESCROW'
)
ON CONFLICT (account_number) DO NOTHING;

-- SYSTEM ETH ESCROW ACCOUNT (Holds user ETH during open SELL limit orders)
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000007', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-ETH-ESCROW', 
    'System ETH Escrow Vault', 
    'ETH', 
    0.00000000, 
    'ESCROW'
)
ON CONFLICT (account_number) DO NOTHING;

-- SYSTEM SOL ESCROW ACCOUNT (Holds user SOL during open SELL limit orders)
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000008', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-SOL-ESCROW', 
    'System SOL Escrow Vault', 
    'SOL', 
    0.00000000, 
    'ESCROW'
)
ON CONFLICT (account_number) DO NOTHING;

-- SYSTEM TRADING FEE REVENUE ACCOUNT
INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
VALUES (
    '00000000-0000-0000-0000-000000000009', 
    '00000000-0000-0000-0000-000000000000', 
    'ACC-SYSTEM-USD-FEE', 
    'System Trading Fee Revenue', 
    'USD', 
    0.00000000, 
    'FEE'
)
ON CONFLICT (account_number) DO NOTHING;
