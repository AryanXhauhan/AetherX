import { EventBus } from './eventBus.js';
import { query } from '../config/db.js';
export class PositionEngine {
    static positions = new Map();
    /**
     * Initialize Position Engine and load state from DB
     */
    static async init() {
        console.log('📈 Position Engine: Initializing In-Memory State...');
        // Load active positions from Postgres to memory
        const res = await query(`SELECT * FROM positions WHERE size != 0`);
        for (const row of res.rows) {
            const key = `${row.user_id}-${row.symbol}`;
            this.positions.set(key, {
                userId: row.user_id,
                symbol: row.symbol,
                size: parseFloat(row.size),
                averageEntryPrice: parseFloat(row.average_entry_price),
                realizedPnl: parseFloat(row.realized_pnl),
                unrealizedPnl: parseFloat(row.unrealized_pnl),
                marginUsed: parseFloat(row.margin_used),
                liquidationPrice: row.liquidation_price ? parseFloat(row.liquidation_price) : null,
                leverage: parseFloat(row.leverage),
                isDirty: false
            });
        }
        // Subscribe to trade executions
        await EventBus.subscribe('order.events', 'position-engine-trades', async (event) => {
            if (event.eventType === 'TRADE_EXECUTED') {
                this.handleTradeExecution(event.payload);
            }
        });
        // High frequency MTM entirely in-memory
        await EventBus.subscribe('market.ticks', 'position-engine-mtm', async (tick) => {
            this.markToMarket(tick.symbol, tick.price);
        });
        // Start background flush to database
        setInterval(() => this.flushToDB(), 5000);
    }
    static getPosition(userId, symbol) {
        return this.positions.get(`${userId}-${symbol}`);
    }
    static getUserPositions(userId) {
        return Array.from(this.positions.values()).filter(p => p.userId === userId);
    }
    /**
     * Adjusts position size, entry price, and realized PnL based on a new trade IN-MEMORY
     */
    static handleTradeExecution(trade) {
        // trade has buyerId and sellerId. We must process for both.
        const symbol = trade.symbol;
        const price = parseFloat(trade.price);
        const quantity = parseFloat(trade.quantity);
        this.processSide(trade.buyerId, symbol, price, quantity, 'BUY');
        this.processSide(trade.sellerId, symbol, price, quantity, 'SELL');
    }
    static processSide(userId, symbol, price, quantity, side) {
        const key = `${userId}-${symbol}`;
        let pos = this.positions.get(key);
        if (!pos) {
            pos = {
                userId,
                symbol,
                size: 0,
                averageEntryPrice: 0,
                realizedPnl: 0,
                unrealizedPnl: 0,
                marginUsed: 0,
                liquidationPrice: null,
                leverage: 1.0,
                isDirty: false
            };
            this.positions.set(key, pos);
        }
        const currentSize = pos.size;
        const avgEntry = pos.averageEntryPrice;
        let realizedPnl = pos.realizedPnl;
        const leverage = pos.leverage;
        const isBuy = side === 'BUY';
        const tradeQty = isBuy ? quantity : -quantity;
        let newSize = currentSize + tradeQty;
        let newAvgEntry = avgEntry;
        // Scaling in
        if (Math.sign(currentSize) === Math.sign(tradeQty) || currentSize === 0) {
            const currentNotional = Math.abs(currentSize) * avgEntry;
            const tradeNotional = quantity * price;
            newAvgEntry = (currentNotional + tradeNotional) / Math.abs(newSize);
        }
        // Scaling out (reducing position or flipping)
        else {
            const reducedQty = Math.min(Math.abs(currentSize), quantity);
            const pnlPerUnit = isBuy ? (avgEntry - price) : (price - avgEntry);
            realizedPnl += reducedQty * pnlPerUnit;
            if (Math.abs(tradeQty) > Math.abs(currentSize)) {
                newAvgEntry = price;
            }
            else if (newSize === 0) {
                newAvgEntry = 0;
            }
        }
        const newMarginUsed = newSize === 0 ? 0 : (Math.abs(newSize) * newAvgEntry) / leverage;
        let liqPrice = null;
        if (newSize > 0)
            liqPrice = newAvgEntry * (1 - 1 / leverage);
        if (newSize < 0)
            liqPrice = newAvgEntry * (1 + 1 / leverage);
        pos.size = newSize;
        pos.averageEntryPrice = newAvgEntry;
        pos.realizedPnl = realizedPnl;
        pos.marginUsed = newMarginUsed;
        pos.liquidationPrice = liqPrice;
        pos.isDirty = true;
        // We can emit an event here for event sourcing pureness, 
        // but positions are technically read-models derived from trades.
        EventBus.publish('position.updated', pos);
    }
    /**
     * Updates Unrealized PnL IN MEMORY
     */
    static markToMarket(symbol, currentPrice) {
        for (const pos of this.positions.values()) {
            if (pos.symbol === symbol && pos.size !== 0) {
                let newUnrealized = 0;
                if (pos.size > 0) {
                    newUnrealized = pos.size * (currentPrice - pos.averageEntryPrice);
                }
                else if (pos.size < 0) {
                    newUnrealized = Math.abs(pos.size) * (pos.averageEntryPrice - currentPrice);
                }
                if (Math.abs(pos.unrealizedPnl - newUnrealized) > 0.01) {
                    pos.unrealizedPnl = newUnrealized;
                    pos.isDirty = true;
                }
            }
        }
    }
    /**
     * Background flush of dirty positions to Postgres
     */
    static async flushToDB() {
        const dirtyPositions = Array.from(this.positions.values()).filter(p => p.isDirty);
        if (dirtyPositions.length === 0)
            return;
        try {
            await query('BEGIN');
            for (const pos of dirtyPositions) {
                await query(`INSERT INTO positions (user_id, symbol, size, average_entry_price, realized_pnl, unrealized_pnl, margin_used, liquidation_price, leverage, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (user_id, symbol) DO UPDATE SET
             size = EXCLUDED.size,
             average_entry_price = EXCLUDED.average_entry_price,
             realized_pnl = EXCLUDED.realized_pnl,
             unrealized_pnl = EXCLUDED.unrealized_pnl,
             margin_used = EXCLUDED.margin_used,
             liquidation_price = EXCLUDED.liquidation_price,
             updated_at = NOW()`, [pos.userId, pos.symbol, pos.size, pos.averageEntryPrice, pos.realizedPnl, pos.unrealizedPnl, pos.marginUsed, pos.liquidationPrice, pos.leverage]);
                pos.isDirty = false;
            }
            await query('COMMIT');
        }
        catch (e) {
            await query('ROLLBACK');
            console.error('❌ PositionEngine flush error:', e);
        }
    }
}
