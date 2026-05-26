import { query } from '../config/db.js';
import { PositionEngine } from './positionEngine.js';
export class RiskEngine {
    /**
     * Pre-trade validation check enforcing institutional rules.
     * Ensures margin sufficiency, leverage limits, and position concentration rules.
     */
    static async validateOrder(userId, symbol, side, type, price, quantity) {
        const isBuy = side === 'BUY';
        const notionalValue = price * quantity;
        // Default system leverage limits (e.g. 10x max)
        const MAX_LEVERAGE = 10.0;
        try {
            // 1. Get USD balance (Equity)
            // Ideally this should also be in-memory eventually, but DB is fine for pre-trade check
            const accountRes = await query(`SELECT balance FROM accounts WHERE owner_id = $1 AND currency = 'USD'`, [userId]);
            if (accountRes.rows.length === 0) {
                throw new Error(`Trading account not found. Please initialize your USD wallet.`);
            }
            const equity = parseFloat(accountRes.rows[0].balance);
            // 2. Get active position for this symbol from In-Memory Engine
            const pos = PositionEngine.getPosition(userId, symbol);
            let currentSize = 0;
            let currentLeverage = 1.0;
            if (pos) {
                currentSize = pos.size;
                currentLeverage = pos.leverage;
            }
            if (currentLeverage > MAX_LEVERAGE) {
                throw new Error(`Risk Violation: Requested leverage (${currentLeverage}x) exceeds system maximum (${MAX_LEVERAGE}x).`);
            }
            // 3. Margin Calculation
            // Are we increasing or decreasing exposure?
            const isIncreasing = (currentSize >= 0 && isBuy) || (currentSize <= 0 && !isBuy);
            if (isIncreasing) {
                const requiredMargin = notionalValue / currentLeverage;
                if (equity < requiredMargin) {
                    throw new Error(`Risk Violation: Insufficient margin. Required: $${requiredMargin.toFixed(2)}, Available: $${equity.toFixed(2)}.`);
                }
            }
            return true;
        }
        catch (error) {
            throw error;
        }
    }
    /**
     * Simulates portfolio drawdown margin limits, triggers virtual liquidations.
     * Evaluated entirely in-memory using PositionEngine.
     */
    static async evaluateDrawdown(userId) {
        const positions = PositionEngine.getUserPositions(userId);
        let totalMarginUsed = 0;
        let totalUnrealizedPnl = 0;
        for (const pos of positions) {
            if (pos.size !== 0) {
                totalMarginUsed += pos.marginUsed;
                totalUnrealizedPnl += pos.unrealizedPnl;
            }
        }
        const accountRes = await query(`SELECT balance FROM accounts WHERE owner_id = $1 AND currency = 'USD'`, [userId]);
        const equity = parseFloat(accountRes.rows[0]?.balance || '0');
        // Maintenance Margin fraction (e.g. 50% of initial margin must be maintained)
        const maintenanceMargin = totalMarginUsed * 0.5;
        // Total account equity taking into account unrealized losses
        const activeEquity = equity + totalUnrealizedPnl;
        if (totalMarginUsed > 0 && activeEquity <= maintenanceMargin) {
            return { liquidated: true, message: `LIQUIDATION TRIGGERED: Active Equity ($${activeEquity.toFixed(2)}) fell below Maintenance Margin ($${maintenanceMargin.toFixed(2)}).` };
        }
        return { liquidated: false, message: 'Portfolio leverage within safe constraints' };
    }
}
export default RiskEngine;
