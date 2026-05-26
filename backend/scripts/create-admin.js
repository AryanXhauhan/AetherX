// backend/scripts/create-admin.js
import pg from 'pg';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const { Client } = pg;

const createAdmin = async () => {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    database: 'aetherx'
  });

  try {
    console.log('🔌 Database: Connecting to PostgreSQL...');
    await client.connect();

    const email = 'aether@123';
    const password = 'password123';

    // Check if user already exists
    const checkRes = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (checkRes.rows.length > 0) {
      console.log(`👤 Database: Account [${email}] already exists in PostgreSQL`);
      return;
    }

    console.log(`👤 Database: Creating account [${email}]...`);
    await client.query('BEGIN');

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create User
    const userId = uuidv4();
    await client.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
      [userId, email, passwordHash]
    );

    // Seed checking and escrow accounts for USD, BTC, ETH, SOL
    const currencies = ['USD', 'BTC', 'ETH', 'SOL'];
    for (const cur of currencies) {
      const isUsd = cur === 'USD';
      const initialCheckingBalance = isUsd ? 100000.00000000 : 0.00000000;

      // Checking Wallet
      const checkingId = uuidv4();
      const checkingAccNo = `ACC-${userId.substring(0, 8)}-${cur}`;
      await client.query(
        `INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'CHECKING')`,
        [checkingId, userId, checkingAccNo, `${cur} checking wallet`, cur, initialCheckingBalance]
      );

      // Escrow Vault
      const escrowId = uuidv4();
      const escrowAccNo = `ACC-${userId.substring(0, 8)}-${cur}-ESCROW`;
      await client.query(
        `INSERT INTO accounts (id, owner_id, account_number, account_name, currency, balance, account_type)
         VALUES ($1, $2, $3, $4, $5, 0.00000000, 'ESCROW')`,
        [escrowId, userId, escrowAccNo, `${cur} Escrow vault`, cur]
      );

      // Record double-entry capital seed logs for USD Checkings
      if (isUsd) {
        const seedTxId = uuidv4();
        const seedRef = `TX-SEED-${seedTxId}`;
        const seedDesc = `Initial portfolio seed of $${initialCheckingBalance} virtual USD`;

        // Transaction Summary
        await client.query(
          `INSERT INTO transactions (id, reference, status, amount, currency, source_account_id, dest_account_id, description)
           VALUES ($1, $2, 'COMPLETED', $3, 'USD', $4, $5, $6)`,
          [
            seedTxId, 
            seedRef, 
            initialCheckingBalance, 
            '00000000-0000-0000-0000-000000000001', // System USD checking account
            checkingId, 
            seedDesc
          ]
        );

        // Debit System USD
        await client.query(
          `UPDATE accounts SET balance = balance - $1 WHERE id = '00000000-0000-0000-0000-000000000001'`,
          [initialCheckingBalance]
        );
        await client.query(
          `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
           VALUES ($1, '00000000-0000-0000-0000-000000000001', 'DEBIT', $2, 'USD', $3)`,
          [seedTxId, initialCheckingBalance, `Debit system capital reservoir`]
        );

        // Credit User USD
        await client.query(
          `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
           VALUES ($1, $2, 'CREDIT', $3, 'USD', $4)`,
          [seedTxId, checkingId, initialCheckingBalance, `Credit user cash checking account`]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Database: Default user [${email}] successfully registered and seeded with $100,000 USD!`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', error);
  } finally {
    await client.end();
  }
};

createAdmin();
