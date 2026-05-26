import { query } from '../config/db.js';

export class ReconciliationWorker {
  
  public static start() {
    console.log('🕵️  Reconciliation Worker: Started background invariant checks');
    
    // Run every 60 seconds
    setInterval(() => {
      this.verifyInvariants();
    }, 60000);
  }

  private static async verifyInvariants() {
    try {
      const issues: string[] = [];

      // 1. Check for negative balances
      const negBalances = await query(`SELECT owner_id, currency, balance FROM accounts WHERE balance < 0`);
      if (negBalances.rows.length > 0) {
        issues.push(`Found ${negBalances.rows.length} negative balances!`);
      }

      // 2. Check Double-Entry Sum (Total assets must equal total liabilities/equity)
      const ledgerSum = await query(`
        SELECT currency, SUM(amount) as net 
        FROM ledger_entries 
        GROUP BY currency 
        HAVING SUM(amount) != 0
      `);
      if (ledgerSum.rows.length > 0) {
        issues.push(`Ledger imbalance detected for currencies: ${ledgerSum.rows.map(r => r.currency).join(', ')}`);
      }

      if (issues.length > 0) {
        console.error('🚨 RECONCILIATION FAILURE:', issues);
      }
    } catch (error) {
      console.error('❌ ReconciliationWorker failed:', error);
    }
  }
}
