import bcrypt from 'bcrypt';
import { getClient, query } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
/**
 * Handles simulated user registration and atomically seeds their double-entry wallet accounts
 */
export const register = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    const dbClient = await getClient();
    try {
        await dbClient.query('BEGIN');
        // 1. Check if user already exists
        const checkUser = await dbClient.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (checkUser.rows.length > 0) {
            await dbClient.query('ROLLBACK');
            return res.status(409).json({ error: 'Email already registered' });
        }
        // 2. Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        // 3. Create User
        const userId = uuidv4();
        await dbClient.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, [userId, email.toLowerCase(), passwordHash]);
        // ── 4. Atomic Seeding of User Wallet Checking/Escrow Accounts ──
        // Every user starts with 4 checking accounts (USD, BTC, ETH, SOL) 
        // and 4 escrow lock vaults (USD, BTC, ETH, SOL).
        // Seed USD checking with a free virtual $100,000.00 USD balance!
        const currencies = ['USD', 'BTC', 'ETH', 'SOL'];
        for (const cur of currencies) {
            const isUsd = cur === 'USD';
            const initialCheckingBalance = isUsd ? 100000.00000000 : 0.00000000;
            // Create Checking Wallet
            const checkingId = uuidv4();
            const checkingAccNo = `ACC-${userId.substring(0, 8)}-${cur}`;
            await dbClient.query(`INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'CHECKING')`, [checkingId, userId, checkingAccNo, `${cur} checking wallet`, cur, initialCheckingBalance]);
            // Create Escrow Lock Wallet
            const escrowId = uuidv4();
            const escrowAccNo = `ACC-${userId.substring(0, 8)}-${cur}-ESCROW`;
            await dbClient.query(`INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
         VALUES ($1, $2, $3, $4, $5, 0.00000000, 'ESCROW')`, [escrowId, userId, escrowAccNo, `${cur} Escrow vault`, cur]);
            // ── 5. Record double-entry seed legs for USD Checking Wallet ──
            if (isUsd) {
                const seedTxId = uuidv4();
                const seedRef = `TX-SEED-${seedTxId}`;
                const seedDesc = `Initial portfolio seed of $${initialCheckingBalance} virtual USD`;
                // Transaction Summary
                await dbClient.query(`INSERT INTO transactions (id, reference, status, amount, currency, source_account_id, dest_account_id, description)
           VALUES ($1, $2, 'COMPLETED', $3, 'USD', $4, $5, $6)`, [
                    seedTxId,
                    seedRef,
                    initialCheckingBalance,
                    '00000000-0000-0000-0000-000000000001', // System USD checking account acts as source
                    checkingId,
                    seedDesc
                ]);
                // Debit System Cash Checking Account
                await dbClient.query(`UPDATE accounts SET balance = balance - $1 WHERE id = '00000000-0000-0000-0000-000000000001'`, [initialCheckingBalance]);
                await dbClient.query(`INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
           VALUES ($1, '00000000-0000-0000-0000-000000000001', 'DEBIT', $2, 'USD', $3)`, [seedTxId, initialCheckingBalance, `Debit system capital reservoir`]);
                // Credit User Checking USD Wallet
                await dbClient.query(`INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
           VALUES ($1, $2, 'CREDIT', $3, 'USD', $4)`, [seedTxId, checkingId, initialCheckingBalance, `Credit user cash checking account`]);
            }
        }
        await dbClient.query('COMMIT');
        console.log(`👤 Auth: Registered user [${email}] and seeded $100k USD with ledger integrity`);
        res.status(201).json({
            message: 'User registered and seeded successfully',
            user: { id: userId, email }
        });
    }
    catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('❌ Registration atomic database rollback:', error);
        res.status(500).json({ error: 'Internal server error during seeding' });
    }
    finally {
        dbClient.release();
    }
};
/**
 * Validates credentials and yields a session token
 */
export const login = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    try {
        const userRes = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [email.toLowerCase()]);
        if (userRes.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const user = userRes.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Yield simple session cookie
        res.cookie('userSession', JSON.stringify({ id: user.id, email: user.email }), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
        res.json({
            message: 'Login successful',
            user: { id: user.id, email: user.email }
        });
    }
    catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
/**
 * Destroys session cookie
 */
export const logout = async (req, res) => {
    res.clearCookie('userSession');
    res.json({ message: 'Logout successful' });
};
/**
 * Returns currently authenticated session
 */
export const me = async (req, res) => {
    const sessionCookie = req.cookies.userSession;
    if (!sessionCookie) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
        const parsed = JSON.parse(sessionCookie);
        res.json({ user: parsed });
    }
    catch (e) {
        res.status(401).json({ error: 'Invalid session cookie' });
    }
};
