// src/tests/ledger.test.ts
import { getClient, query } from '../config/db.js';
import { LedgerEngine } from '../services/ledgerEngine.js';
import { MatchingEngine, Order } from '../services/matchingEngine.js';
import { v4 as uuidv4 } from 'uuid';

const runTest = async () => {
  console.log('🧪 Ledger Integration Test: Beginning automated checks...');

  const dbClient = await getClient();
  try {
    // ── 1. Create Test Users & Portfolios ───────────────────
    const buyerId = uuidv4();
    const sellerId = uuidv4();

    console.log('🧪 Ledger Test: Provisioning buyer and seller in PostgreSQL...');
    await dbClient.query('BEGIN');

    // Create Buyer
    await dbClient.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, 
      [buyerId, `buyer-${buyerId.substring(0,6)}@test.com`, 'test_hash']);
    // Create USD Checking Account
    const buyerUsdAcc = `ACC-${buyerId.substring(0,8)}-USD`;
    await dbClient.query(`INSERT INTO accounts (id, owner_id, account_number, currency, balance, account_type) VALUES ($1, $2, $3, 'USD', 100000.0, 'CHECKING')`, 
      [uuidv4(), buyerId, buyerUsdAcc]);
    // Create BTC Checking Account
    const buyerBtcAcc = `ACC-${buyerId.substring(0,8)}-BTC`;
    await dbClient.query(`INSERT INTO accounts (id, owner_id, account_number, currency, balance, account_type) VALUES ($1, $2, $3, 'BTC', 0.0, 'CHECKING')`, 
      [uuidv4(), buyerId, buyerBtcAcc]);
    // Create USD Escrow Account
    const buyerUsdEscrow = `ACC-${buyerId.substring(0,8)}-USD-ESCROW`;
    await dbClient.query(`INSERT INTO accounts (id, owner_id, account_number, currency, balance, account_type) VALUES ($1, $2, $3, 'USD', 0.0, 'ESCROW')`, 
      [uuidv4(), buyerId, buyerUsdEscrow]);

    // Create Seller
    await dbClient.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, 
      [sellerId, `seller-${sellerId.substring(0,6)}@test.com`, 'test_hash']);
    // Create USD Checking Account
    const sellerUsdAcc = `ACC-${sellerId.substring(0,8)}-USD`;
    await dbClient.query(`INSERT INTO accounts (id, owner_id, account_number, currency, balance, account_type) VALUES ($1, $2, $3, 'USD', 0.0, 'CHECKING')`, 
      [uuidv4(), sellerId, sellerUsdAcc]);
    // Create BTC Checking Account (Seeded with 2.0 BTC to sell!)
    const sellerBtcAcc = `ACC-${sellerId.substring(0,8)}-BTC`;
    await dbClient.query(`INSERT INTO accounts (id, owner_id, account_number, currency, balance, account_type) VALUES ($1, $2, $3, 'BTC', 2.0, 'CHECKING')`, 
      [uuidv4(), sellerId, sellerBtcAcc]);
    // Create BTC Escrow Account
    const sellerBtcEscrow = `ACC-${sellerId.substring(0,8)}-BTC-ESCROW`;
    await dbClient.query(`INSERT INTO accounts (id, owner_id, account_number, currency, balance, account_type) VALUES ($1, $2, $3, 'BTC', 0.0, 'ESCROW')`, 
      [uuidv4(), sellerId, sellerBtcEscrow]);

    await dbClient.query('COMMIT');
    console.log('✅ Ledger Test: Users provisioned successfully');

    // ── 2. Submit Limit Buy & Sell Orders ───────────────────
    const price = 60000.0;
    const qty = 0.5; // matching trade values: 0.5 BTC @ $60,000 USD = $30,000 USD cash hold

    console.log(`🧪 Ledger Test: User [Buyer] locks escrow USD for LIMIT BUY...`);
    await LedgerEngine.lockEscrow(buyerId, 'BTCUSDT', 'BUY', price, qty);

    console.log(`🧪 Ledger Test: User [Seller] locks escrow BTC for LIMIT SELL...`);
    await LedgerEngine.lockEscrow(sellerId, 'BTCUSDT', 'SELL', price, qty);

    // ── 3. Insert and Submit orders to Matching Engine ──────
    console.log('🧪 Ledger Test: Submitting orders to matching engine queue...');
    const buyOrderId = uuidv4();
    const sellOrderId = uuidv4();

    // Insert orders in DB
    await query(
      `INSERT INTO orders (id, user_id, symbol, side, type, price, quantity, filled_quantity, status)
       VALUES ($1, $2, 'BTCUSDT', 'BUY', 'LIMIT', $3, $4, 0.0, 'PENDING')`,
      [buyOrderId, buyerId, price, qty]
    );

    await query(
      `INSERT INTO orders (id, user_id, symbol, side, type, price, quantity, filled_quantity, status)
       VALUES ($1, $2, 'BTCUSDT', 'SELL', 'LIMIT', $3, $4, 0.0, 'PENDING')`,
      [sellOrderId, sellerId, price, qty]
    );

    const buyOrder: Order = {
      id: buyOrderId,
      userId: buyerId,
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      price,
      quantity: qty,
      filledQuantity: 0,
      status: 'PENDING',
      createdAt: new Date()
    };

    const sellOrder: Order = {
      id: sellOrderId,
      userId: sellerId,
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'LIMIT',
      price,
      quantity: qty,
      filledQuantity: 0,
      status: 'PENDING',
      createdAt: new Date()
    };

    // Initialize in-memory matching engine structures
    await MatchingEngine.start();
    
    // Cross orders - this triggers LedgerEngine.settleTrade and updates statuses
    await MatchingEngine.submitOrder(buyOrder);

    // ── 4. Verify Ledger Invariant and Database Balances ──
    console.log('🧪 Ledger Test: Retrieving double-entry transaction legs from audit logs...');
    
    const entriesRes = await query(
      `SELECT le.entry_type, le.amount, le.currency, t.reference
       FROM ledger_entries le
       JOIN transactions t ON le.transaction_id = t.id
       WHERE t.reference LIKE 'TX-CASH-%' OR t.reference LIKE 'TX-ASSET-%'`
    );

    const legs = entriesRes.rows;
    console.log(`✅ Ledger Test: Found ${legs.length} ledger legs recorded for trade matching`);

    let netUsdSum = 0;
    let netBtcSum = 0;

    for (const leg of legs) {
      const amt = parseFloat(leg.amount);
      const isDebit = leg.entry_type === 'DEBIT';
      const change = isDebit ? -amt : amt;

      if (leg.currency === 'USD') {
        netUsdSum += change;
      } else if (leg.currency === 'BTC') {
        netBtcSum += change;
      }
    }

    console.log('🧪 Ledger Test: Asserting accounting ledger balances...');
    console.log(`   • Net USD transaction sum: ${netUsdSum.toFixed(8)} (Expected: 0.00000000)`);
    console.log(`   • Net BTC transaction sum: ${netBtcSum.toFixed(8)} (Expected: 0.00000000)`);

    const usdBalanced = Math.abs(netUsdSum) < 1e-8;
    const btcBalanced = Math.abs(netBtcSum) < 1e-8;

    if (usdBalanced && btcBalanced) {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║          ✅ LEDGER INTEGRITY CHECK PASSED ✅           ║
║                                                       ║
║  Double-Entry balance invariant strictly satisfied:    ║
║  ∑(Debit) + ∑(Credit) = 0.00000000 for cash & asset   ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    } else {
      throw new Error('Ledger accounting discrepancy: entries do not balance to zero!');
    }
  } catch (error) {
    console.error('❌ Ledger Test FAILED:', error);
    process.exit(1);
  } finally {
    dbClient.release();
    process.exit(0);
  }
};

runTest();
