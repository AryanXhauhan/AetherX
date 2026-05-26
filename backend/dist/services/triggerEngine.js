import { EventBus } from './eventBus.js';
import { EventStore } from './eventStore.js';
import { query } from '../config/db.js';
export class TriggerEngine {
    // Symbol-partitioned trigger registries
    static stopBuckets = new Map();
    static takeProfitBuckets = new Map();
    static async init() {
        console.log('⚡ Trigger Engine: Initializing partitioned registries...');
        // Load active triggers from DB
        await this.loadActiveTriggers();
        // Listen to market ticks to evaluate triggers
        await EventBus.subscribe('market.ticks', 'trigger-engine-evaluator', async (tick) => {
            await this.evaluateTriggers(tick.symbol, tick.price);
        });
        // Listen to order events to dynamically add/remove triggers
        await EventBus.subscribe('order.events', 'trigger-engine-manager', async (event) => {
            if (event.payload.status === 'TRIGGER_WAITING') {
                this.addTrigger(event.payload);
            }
            if (['ORDER_CANCELED', 'ORDER_FILLED', 'ORDER_REJECTED'].includes(event.eventType)) {
                this.removeTrigger(event.aggregateId, event.payload.symbol);
            }
        });
    }
    static async loadActiveTriggers() {
        const res = await query(`SELECT id, symbol, side, type, stop_price as "triggerPrice"
       FROM orders
       WHERE status = 'TRIGGER_WAITING'`);
        for (const row of res.rows) {
            this.addTrigger(row);
        }
        console.log(`⚡ Trigger Engine: Loaded ${res.rows.length} waiting triggers into memory.`);
    }
    static addTrigger(order) {
        if (!order.triggerPrice && !order.stopPrice)
            return;
        const trigger = {
            id: order.id || order.aggregateId,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            triggerPrice: parseFloat(order.triggerPrice || order.stopPrice),
        };
        if (order.type === 'STOP' || order.type === 'STOP_LIMIT') {
            const bucket = this.stopBuckets.get(order.symbol) || [];
            bucket.push(trigger);
            this.stopBuckets.set(order.symbol, bucket);
        }
        else if (order.type === 'TAKE_PROFIT') {
            const bucket = this.takeProfitBuckets.get(order.symbol) || [];
            bucket.push(trigger);
            this.takeProfitBuckets.set(order.symbol, bucket);
        }
    }
    static removeTrigger(orderId, symbol) {
        if (this.stopBuckets.has(symbol)) {
            this.stopBuckets.set(symbol, this.stopBuckets.get(symbol).filter(t => t.id !== orderId));
        }
        if (this.takeProfitBuckets.has(symbol)) {
            this.takeProfitBuckets.set(symbol, this.takeProfitBuckets.get(symbol).filter(t => t.id !== orderId));
        }
    }
    static async evaluateTriggers(symbol, currentPrice) {
        const stops = this.stopBuckets.get(symbol) || [];
        const takeProfits = this.takeProfitBuckets.get(symbol) || [];
        const triggered = [];
        // Evaluate Stops
        for (const stop of stops) {
            if (stop.side === 'SELL' && currentPrice <= stop.triggerPrice) {
                triggered.push(stop);
            }
            else if (stop.side === 'BUY' && currentPrice >= stop.triggerPrice) {
                triggered.push(stop);
            }
        }
        // Evaluate Take Profits
        for (const tp of takeProfits) {
            if (tp.side === 'SELL' && currentPrice >= tp.triggerPrice) {
                triggered.push(tp);
            }
            else if (tp.side === 'BUY' && currentPrice <= tp.triggerPrice) {
                triggered.push(tp);
            }
        }
        // Fire triggered events
        for (const order of triggered) {
            this.removeTrigger(order.id, order.symbol);
            const event = await EventStore.append({
                aggregateId: order.id,
                aggregateType: 'ORDER',
                eventType: 'ORDER_TRIGGERED',
                payload: { ...order, status: 'TRIGGERED' }
            });
            if (event) {
                await EventBus.publish('order.events', event);
            }
        }
    }
}
