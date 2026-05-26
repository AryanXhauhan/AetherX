import { query } from '../config/db.js';
import { MarketIngestionService } from '../services/marketIngestion.js';
/**
 * Retrieves all checking and escrow balances for the logged-in user
 */
export const getBalances = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const dbRes = await query(`SELECT id, currency, balance, account_type as "type", account_number as "accountNumber"
       FROM accounts 
       WHERE owner_id = $1 
       ORDER BY currency, account_type`, [userId]);
        res.json({ balances: dbRes.rows });
    }
    catch (error) {
        console.error('❌ Failed to fetch user balances:', error);
        res.status(500).json({ error: 'Failed to fetch user balances' });
    }
};
/**
 * Retrieves active trading positions and calculates current valuation and unrealized PnL
 * using the matching engine's live spot prices
 */
export const getPositions = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const dbRes = await query(`SELECT id, symbol, size, average_entry_price as "averageEntryPrice"
       FROM positions 
       WHERE user_id = $1 AND size != 0.00000000`, [userId]);
        const positions = dbRes.rows.map(pos => {
            const symbol = pos.symbol;
            const size = parseFloat(pos.size);
            const avgPrice = parseFloat(pos.averageEntryPrice);
            // Get the current spot price
            const spotPrice = MarketIngestionService.getCurrentPrice(symbol) || avgPrice;
            // Unrealized PnL calculation:
            // For LONG positions (size > 0): (spot - avg) * size
            // For SHORT positions (size < 0): (avg - spot) * abs(size)
            const uPnL = (spotPrice - avgPrice) * size;
            return {
                id: pos.id,
                symbol,
                size,
                averageEntryPrice: avgPrice,
                currentPrice: spotPrice,
                unrealizedPnL: parseFloat(uPnL.toFixed(4)),
                value: parseFloat((spotPrice * Math.abs(size)).toFixed(2))
            };
        });
        res.json({ positions });
    }
    catch (error) {
        console.error('❌ Failed to fetch user positions:', error);
        res.status(500).json({ error: 'Failed to fetch user positions' });
    }
};
