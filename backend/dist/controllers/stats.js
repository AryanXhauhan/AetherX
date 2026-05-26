import { query } from '../config/db.js';
import { AnalyticsService } from '../services/analytics.js';
import { ObservabilityService } from '../services/observability.js';
/**
 * Retrieves the complete list of double-entry ledger entries (legs)
 * for the Ledger Bookkeeping Inspector
 */
export const getLedgerEntries = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        // Retrieve all legs of any transactions that the user participated in
        const dbRes = await query(`SELECT le.id, le.transaction_id as "transactionId", le.entry_type as "entryType", 
              le.amount, le.currency, le.description, le.created_at as "createdAt",
              a.account_number as "accountNumber", a.account_type as "accountType",
              t.reference, t.description as "txDescription"
       FROM ledger_entries le
       JOIN accounts a ON le.account_id = a.id
       JOIN transactions t ON le.transaction_id = t.id
       WHERE le.transaction_id IN (
         SELECT DISTINCT inner_le.transaction_id
         FROM ledger_entries inner_le
         JOIN accounts inner_a ON inner_le.account_id = inner_a.id
         WHERE inner_a.owner_id = $1
       )
       ORDER BY le.created_at DESC
       LIMIT 100`, [userId]);
        const formatted = dbRes.rows.map(r => ({
            ...r,
            amount: parseFloat(r.amount)
        }));
        res.json({ ledgerEntries: formatted });
    }
    catch (error) {
        console.error('❌ Failed to retrieve ledger audit trail:', error);
        res.status(500).json({ error: 'Failed to retrieve ledger entries' });
    }
};
/**
 * Retrieves portfolio performance parameters (Sharpe, win rate, allocations)
 */
export const getPerformanceStats = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const stats = await AnalyticsService.getPerformanceStats(userId);
        const allocations = await AnalyticsService.getAssetAllocation(userId);
        res.json({ stats, allocations });
    }
    catch (error) {
        console.error('❌ Failed to retrieve performance analytics:', error);
        res.status(500).json({ error: 'Failed to retrieve analytics' });
    }
};
/**
 * Retrieves the historical observability records on API boot
 */
export const getSystemMetrics = async (req, res) => {
    try {
        const history = ObservabilityService.getHistory();
        res.json({ history });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to retrieve observability history' });
    }
};
