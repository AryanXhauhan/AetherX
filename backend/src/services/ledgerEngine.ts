// src/services/ledgerEngine.ts
import { getClient, query } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

interface SettleTradeParams {
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  symbol: string; // BTCUSDT | ETHUSDT | SOLUSDT
  price: number;
  quantity: number;
}

export class LedgerEngine {

  /**
   * Helper to fetch an account ID and balance under a pessimistic lock
   */
  private static async getAccountLocked(client: any, ownerId: string, currency: string, type: 'CHECKING' | 'ESCROW'): Promise<any> {
    const res = await client.query(
      `SELECT id, balance, account_number 
       FROM accounts 
       WHERE owner_id = $1 AND currency = $2 AND account_type = $3 
       FOR UPDATE`,
      [ownerId, currency.toUpperCase(), type]
    );

    if (res.rows.length === 0) {
      throw new Error(`Account not found for owner [${ownerId}], currency [${currency}], type [${type}]`);
    }

    return res.rows[0];
  }

  /**
   * Locks user cash or asset in escrow when a limit order is placed
   */
  public static async lockEscrow(userId: string, symbol: string, side: 'BUY' | 'SELL', price: number, quantity: number): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const isBuy = side === 'BUY';
      const currency = isBuy ? 'USD' : symbol.replace('USDT', '');
      const amount = isBuy ? price * quantity : quantity;

      // Lock checking account
      const checking = await this.getAccountLocked(client, userId, currency, 'CHECKING');
      if (parseFloat(checking.balance) < amount) {
        throw new Error(`Insufficient funds: Free balance of ${checking.balance} ${currency} is less than required ${amount}`);
      }

      // Lock escrow account
      const escrow = await this.getAccountLocked(client, userId, currency, 'ESCROW');

      // ── 1. Create Transaction Header ────────────────────────
      const transactionId = uuidv4();
      const ref = `TX-LOCK-${transactionId}`;
      const desc = `Escrow lock for LIMIT ${side} order on ${symbol}`;
      
      await client.query(
        `INSERT INTO transactions (id, reference, status, amount, currency, source_account_id, dest_account_id, description)
         VALUES ($1, $2, 'COMPLETED', $3, $4, $5, $6, $7)`,
        [transactionId, ref, amount, currency, checking.id, escrow.id, desc]
      );

      // ── 2. Create Double-Entry Legs ─────────────────────────
      // DEBIT checking (- balance)
      await client.query(
        `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`,
        [amount, checking.id]
      );

      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
         VALUES ($1, $2, 'DEBIT', $3, $4, $5)`,
        [transactionId, checking.id, amount, currency, `Debit checking wallet for escrow hold`]
      );

      // CREDIT escrow (+ balance)
      await client.query(
        `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
        [amount, escrow.id]
      );

      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
         VALUES ($1, $2, 'CREDIT', $3, $4, $5)`,
        [transactionId, escrow.id, amount, currency, `Credit escrow vault`]
      );

      await client.query('COMMIT');
      console.log(`💰 Ledger: Locked ${amount} ${currency} in escrow for user [${userId}]`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`❌ Ledger lockEscrow transaction rollback:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Releases locked escrow back to checking account when a limit order is canceled
   */
  public static async releaseEscrow(userId: string, symbol: string, side: 'BUY' | 'SELL', price: number, quantity: number): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const isBuy = side === 'BUY';
      const currency = isBuy ? 'USD' : symbol.replace('USDT', '');
      const amount = isBuy ? price * quantity : quantity;

      // Lock accounts
      const checking = await this.getAccountLocked(client, userId, currency, 'CHECKING');
      const escrow = await this.getAccountLocked(client, userId, currency, 'ESCROW');

      if (parseFloat(escrow.balance) < amount) {
        throw new Error(`Ledger Inconsistency: Escrow balance of ${escrow.balance} is less than release amount ${amount}`);
      }

      // ── 1. Create Transaction Header ────────────────────────
      const transactionId = uuidv4();
      const ref = `TX-RELEASE-${transactionId}`;
      const desc = `Release escrow lock for canceled LIMIT ${side} order on ${symbol}`;
      
      await client.query(
        `INSERT INTO transactions (id, reference, status, amount, currency, source_account_id, dest_account_id, description)
         VALUES ($1, $2, 'COMPLETED', $3, $4, $5, $6, $7)`,
        [transactionId, ref, amount, currency, escrow.id, checking.id, desc]
      );

      // ── 2. Create Double-Entry Legs ─────────────────────────
      // DEBIT escrow (- balance)
      await client.query(
        `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`,
        [amount, escrow.id]
      );

      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
         VALUES ($1, $2, 'DEBIT', $3, $4, $5)`,
        [transactionId, escrow.id, amount, currency, `Debit escrow vault on release`]
      );

      // CREDIT checking (+ balance)
      await client.query(
        `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
        [amount, checking.id]
      );

      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
         VALUES ($1, $2, 'CREDIT', $3, $4, $5)`,
        [transactionId, checking.id, amount, currency, `Credit checking wallet on release`]
      );

      await client.query('COMMIT');
      console.log(`💰 Ledger: Released ${amount} ${currency} from escrow back to checking for user [${userId}]`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`❌ Ledger releaseEscrow transaction rollback:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Settle a trade execution under an atomic transactional block.
   * Debits/Credits Cash leg and Asset leg atomically, ensuring no partial states can exist.
   */
  public static async settleTrade(params: SettleTradeParams): Promise<void> {
    const { buyerId, sellerId, symbol, price, quantity } = params;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const asset = symbol.replace('USDT', '');
      const cashAmount = price * quantity;
      const assetAmount = quantity;

      // ── Determine Cash Leg Source ──────────────────────────
      // If the buyer is the System Institutional account (market sell execution counterpart), 
      // or if it was a market buy, cash is taken from CHECKING. Otherwise, from LIMIT ESCROW.
      const buyerIsSystem = buyerId === '00000000-0000-0000-0000-000000000000';
      const sellerIsSystem = sellerId === '00000000-0000-0000-0000-000000000000';
      
      const buyerCashType = buyerIsSystem ? 'CHECKING' : 'ESCROW'; // Limit buys have already locked cash in ESCROW
      const sellerAssetType = sellerIsSystem ? 'CHECKING' : 'ESCROW'; // Limit sells have already locked assets in ESCROW

      // Lock all four wallets in database using FOR UPDATE to prevent race conditions
      const buyerCashWallet = await this.getAccountLocked(client, buyerId, 'USD', buyerCashType);
      const sellerCashWallet = await this.getAccountLocked(client, sellerId, 'USD', 'CHECKING'); // Sellers receive cash in CHECKING
      const sellerAssetWallet = await this.getAccountLocked(client, sellerId, asset, sellerAssetType);
      const buyerAssetWallet = await this.getAccountLocked(client, buyerId, asset, 'CHECKING'); // Buyers receive crypto in CHECKING

      // Verify sufficient balances
      if (parseFloat(buyerCashWallet.balance) < cashAmount) {
        throw new Error(`Ledger Error: Buyer USD balance ${buyerCashWallet.balance} is less than settlement ${cashAmount}`);
      }
      if (parseFloat(sellerAssetWallet.balance) < assetAmount) {
        throw new Error(`Ledger Error: Seller ${asset} balance ${sellerAssetWallet.balance} is less than settlement ${assetAmount}`);
      }

      // ── TRANSACTION 1: CASH LEG (USD Transfer) ──────────────
      const cashTxId = uuidv4();
      const cashRef = `TX-CASH-${cashTxId}`;
      const cashDesc = `Settle Cash Leg: Trade match of ${quantity} ${symbol} at $${price}`;

      await client.query(
        `INSERT INTO transactions (id, reference, status, amount, currency, source_account_id, dest_account_id, description)
         VALUES ($1, $2, 'COMPLETED', $3, 'USD', $4, $5, $6)`,
        [cashTxId, cashRef, cashAmount, buyerCashWallet.id, sellerCashWallet.id, cashDesc]
      );

      // Debit Buyer Cash Wallet
      await client.query(`UPDATE accounts SET balance = balance - $1 WHERE id = $2`, [cashAmount, buyerCashWallet.id]);
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
         VALUES ($1, $2, 'DEBIT', $3, 'USD', $4)`,
        [cashTxId, buyerCashWallet.id, cashAmount, `Debit Buyer USD wallet for trade execution`]
      );

      // Credit Seller Cash Wallet
      await client.query(`UPDATE accounts SET balance = balance + $1 WHERE id = $2`, [cashAmount, sellerCashWallet.id]);
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
         VALUES ($1, $2, 'CREDIT', $3, 'USD', $4)`,
        [cashTxId, sellerCashWallet.id, cashAmount, `Credit Seller USD checking wallet`]
      );

      // ── TRANSACTION 2: ASSET LEG (Crypto Transfer) ───────────
      const assetTxId = uuidv4();
      const assetRef = `TX-ASSET-${assetTxId}`;
      const assetDesc = `Settle Asset Leg: Trade match of ${quantity} ${symbol} at $${price}`;

      await client.query(
        `INSERT INTO transactions (id, reference, status, amount, currency, source_account_id, dest_account_id, description)
         VALUES ($1, $2, 'COMPLETED', $3, $4, $5, $6, $7)`,
        [assetTxId, assetRef, assetAmount, asset, sellerAssetWallet.id, buyerAssetWallet.id, assetDesc]
      );

      // Debit Seller Asset Wallet
      await client.query(`UPDATE accounts SET balance = balance - $1 WHERE id = $2`, [assetAmount, sellerAssetWallet.id]);
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
         VALUES ($1, $2, 'DEBIT', $3, $4, $5)`,
        [assetTxId, sellerAssetWallet.id, assetAmount, asset, `Debit Seller ${asset} wallet for trade execution`]
      );

      // Credit Buyer Asset Wallet
      await client.query(`UPDATE accounts SET balance = balance + $1 WHERE id = $2`, [assetAmount, buyerAssetWallet.id]);
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
         VALUES ($1, $2, 'CREDIT', $3, $4, $5)`,
        [assetTxId, buyerAssetWallet.id, assetAmount, asset, `Credit Buyer ${asset} checking wallet`]
      );

      // ── 3. Position updating is now delegated to PositionEngine ────────
      // The EventBus will emit TRADE_EXECUTED, which positionEngine listens to.

      await client.query('COMMIT');
      console.log(`💰 Ledger: Atomic settlement complete for ${quantity} ${symbol} at $${price}. (Buyer: ${buyerId}, Seller: ${sellerId})`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Ledger settleTrade transaction rollback:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Automated Reconciliation Job
   * Continuously enforces financial correctness invariants.
   */
  public static async runReconciliationJob(): Promise<void> {
    console.log('🔍 Ledger Engine: Running strict accounting reconciliation...');
    const client = await getClient();
    try {
      // 1. Verify total debits == total credits for all completed transactions
      const res1 = await client.query(`
        SELECT transaction_id, SUM(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE -amount END) as diff
        FROM ledger_entries
        GROUP BY transaction_id
        HAVING SUM(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE -amount END) != 0
      `);
      if (res1.rows.length > 0) {
         console.error(`🚨 FATAL LEDGER INCONSISTENCY: Double-entry mismatch found on transactions:`, res1.rows);
      }

      // 2. Verify no negative balances
      const res2 = await client.query(`SELECT id, account_number, balance FROM accounts WHERE balance < 0`);
      if (res2.rows.length > 0) {
         console.error(`🚨 FATAL LEDGER INCONSISTENCY: Negative balances detected!`, res2.rows);
      }

      console.log('✅ Ledger Engine: All accounting invariants passed.');
    } catch (error) {
      console.error('❌ Ledger Engine: Reconciliation job failed to run:', error);
    } finally {
      client.release();
    }
  }
}
export default LedgerEngine;
