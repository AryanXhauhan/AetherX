import { Worker } from 'worker_threads';
import { EventBus } from './eventBus.js';
import { EventStore } from './eventStore.js';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class MatchingEngine {
    static worker = null;
    static orderBookCache = new Map();
    static async start() {
        console.log('⚡ Matching Engine: Booting Thread-Isolated Worker...');
        // Determine extension to support both direct ts-node execution and compiled js
        const extension = __filename.endsWith('.ts') ? '.ts' : '.js';
        let workerPath = path.join(__dirname, `matchingWorker${extension}`);
        // In ts-node, we might need a wrapper or just passing it to standard worker. 
        // Assuming standard loader handles it or compiled:
        if (extension === '.ts') {
            // Special ts-node worker initialization
            this.worker = new Worker(`
            const path = require('path');
            require('ts-node').register();
            require(path.resolve(__dirname, 'matchingWorker.ts'));
        `, { eval: true, __dirname });
        }
        else {
            this.worker = new Worker(workerPath);
        }
        this.worker.on('message', async (msg) => {
            if (msg.type === 'TRADE_EXECUTED') {
                const payload = msg.payload;
                // Append fill event transactionally (or fire and forget internally)
                const event = await EventStore.append({
                    aggregateId: payload.takerOrderId,
                    aggregateType: 'ORDER',
                    eventType: 'TRADE_EXECUTED',
                    payload,
                    idempotencyKey: `${payload.takerOrderId}-${payload.makerOrderId}`
                });
                if (event) {
                    await EventBus.publish('order.events', event);
                }
            }
            else if (msg.type === 'DEPTH_UPDATE') {
                this.orderBookCache.set(msg.payload.symbol, msg.payload);
                EventBus.publish('orderbook.update', msg.payload);
            }
        });
        this.worker.on('error', (err) => {
            console.error('❌ Matching Engine Worker crashed:', err);
        });
        this.worker.on('exit', (code) => {
            console.warn(`Matching Engine Worker exited with code ${code}`);
        });
        // Listen to incoming OMS events
        EventBus.subscribe('order.events', 'matching-engine', async (event) => {
            if (!this.worker)
                return;
            if (event.eventType === 'ORDER_ACTIVATED') {
                this.worker.postMessage({
                    type: 'ADD_ORDER',
                    payload: {
                        id: event.aggregateId,
                        userId: event.payload.userId,
                        symbol: event.payload.symbol,
                        side: event.payload.side,
                        price: event.payload.price || 0,
                        quantity: event.payload.quantity
                    }
                });
            }
            else if (event.eventType === 'ORDER_CANCELED') {
                this.worker.postMessage({
                    type: 'CANCEL_ORDER',
                    payload: {
                        id: event.aggregateId,
                        symbol: event.payload.symbol
                    }
                });
            }
        });
    }
    static getOrderBookDepth(symbol) {
        return this.orderBookCache.get(symbol) || { bids: [], asks: [] };
    }
}
