import { EventStore } from '../../services/eventStore.js';
import { EventBus } from '../../services/eventBus.js';
/**
 * Handles the intent to cancel an existing order.
 * Emits an ORDER_CANCEL_INTENT event which later resolves to ORDER_CANCELED.
 */
export async function handleCancelOrderIntent(intent) {
    const { orderId, userId, symbol } = intent;
    if (!orderId || !userId) {
        throw new Error('Invalid cancel intent payload');
    }
    // Record intent event – allows idempotent cancellation
    const cancelEvent = await EventStore.append({
        aggregateId: orderId,
        aggregateType: 'ORDER',
        eventType: 'ORDER_CANCEL_INTENT',
        payload: { userId, symbol },
        idempotencyKey: `cancel-${orderId}-${userId}`
    });
    if (cancelEvent) {
        await EventBus.publish('order.events', cancelEvent);
    }
    return cancelEvent;
}
