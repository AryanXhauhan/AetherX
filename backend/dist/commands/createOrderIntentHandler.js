// src/commands/createOrderIntentHandler.ts
import { EventStore } from '../../services/eventStore';
import { EventBus } from '../../services/eventBus';
/**
 * Handles the intent to place a new order.
 * Validates, creates an ORDER_ACTIVATED event and publishes it.
 */
export async function handleCreateOrderIntent(intent) {
    const { idempotencyKey, userId, symbol, side, type, price, quantity, timeInForce, stopPrice, linkedOrders, } = intent;
    // Basic validation (could be moved to a dedicated validator)
    if (!userId || !symbol || !side || !type || quantity <= 0) {
        throw new Error('Invalid order intent payload');
    }
    // Persist the order aggregate (simplified – in a real system a separate Order aggregate would be created)
    const orderEvent = await EventStore.append({
        aggregateId: idempotencyKey,
        aggregateType: 'ORDER',
        eventType: 'ORDER_ACTIVATED',
        payload: {
            userId,
            symbol,
            side,
            type,
            price,
            quantity,
            timeInForce,
            stopPrice,
            linkedOrders,
        },
        idempotencyKey,
    });
    // Publish so MatchingEngine can consume
    if (orderEvent) {
        await EventBus.publish('order.events', orderEvent);
    }
    return orderEvent;
}
