import { EventBus } from './eventBus.js';
import { EventStore, AppendEventParams } from './eventStore.js';
import { query } from '../config/db.js';
import { RiskEngine } from './riskEngine.js';

export interface OrderIntent {
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT' | 'TAKE_PROFIT';
  price?: number;
  quantity: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  stopPrice?: number;
  linkedOrders?: {
    takeProfit?: { price: number; quantity: number };
    stopLoss?: { stopPrice: number; quantity: number };
  };
}

export class OMSEngine {
  public static async init() {
    console.log('🧠 OMS Engine: Initializing CQRS event-driven state machine...');

    // 1. Command Handlers (Intents -> Events)
    EventBus.subscribe('order.intents', 'oms-intent-processor', async (intent: any) => {
      await this.processIntent(intent);
    });
    
    // Command Handler for cancellations
    EventBus.subscribe('order.cancel_intents', 'oms-cancel-processor', async (intent: any) => {
      await this.processCancel(intent);
    });

    // 2. Event Projections (Events -> Read Models / State transitions)
    EventBus.subscribe('order.events', 'oms-state-projection', async (event: any) => {
      await this.projectEvent(event);
    });
  }

  /**
   * Command Handler: Validates intent and transactionally appends events.
   * Does NOT mutate database state directly.
   */
  private static async processIntent(intent: OrderIntent & { idempotencyKey: string }) {
    try {
      // 1. Pre-trade Risk Validation (Will check against in-memory position state)
      await RiskEngine.validateOrder(
        intent.userId,
        intent.symbol,
        intent.side,
        intent.type,
        intent.price || 0,
        intent.quantity
      );

      const eventsToAppend: AppendEventParams[] = [];

      // Parent Order Event
      eventsToAppend.push({
        aggregateId: intent.idempotencyKey,
        aggregateType: 'ORDER',
        eventType: 'ORDER_CREATED',
        payload: { ...intent, status: 'PENDING' },
        idempotencyKey: intent.idempotencyKey
      });

      // Child Linked Orders
      if (intent.linkedOrders) {
        if (intent.linkedOrders.takeProfit) {
          eventsToAppend.push({
            aggregateId: `${intent.idempotencyKey}-tp`,
            aggregateType: 'ORDER',
            eventType: 'ORDER_CREATED',
            payload: {
              ...intent,
              type: 'TAKE_PROFIT',
              price: intent.linkedOrders.takeProfit.price,
              quantity: intent.linkedOrders.takeProfit.quantity,
              side: intent.side === 'BUY' ? 'SELL' : 'BUY',
              status: 'PENDING',
              parentOrderId: intent.idempotencyKey
            },
            idempotencyKey: `${intent.idempotencyKey}-tp`
          });
        }

        if (intent.linkedOrders.stopLoss) {
          eventsToAppend.push({
            aggregateId: `${intent.idempotencyKey}-sl`,
            aggregateType: 'ORDER',
            eventType: 'ORDER_CREATED',
            payload: {
              ...intent,
              type: 'STOP',
              stopPrice: intent.linkedOrders.stopLoss.stopPrice,
              quantity: intent.linkedOrders.stopLoss.quantity,
              side: intent.side === 'BUY' ? 'SELL' : 'BUY',
              status: 'PENDING',
              parentOrderId: intent.idempotencyKey
            },
            idempotencyKey: `${intent.idempotencyKey}-sl`
          });
        }
      }

      // Transactionally append all events
      const appendedEvents = await EventStore.appendBatch(eventsToAppend);
      
      // Publish appended events to the bus to trigger projections & downstream engines
      for (const ev of appendedEvents) {
        await EventBus.publish('order.events', ev);
      }

    } catch (error: any) {
      console.warn(`🧠 OMS Engine: Intent rejected - ${error.message}`);
      const rejectedEvent = await EventStore.append({
        aggregateId: intent.idempotencyKey,
        aggregateType: 'ORDER',
        eventType: 'ORDER_REJECTED',
        payload: { reason: error.message },
        idempotencyKey: intent.idempotencyKey
      });
      if (rejectedEvent) {
        await EventBus.publish('order.events', rejectedEvent);
      }
    }
  }

  /**
   * Command Handler: Cancel an order
   */
  private static async processCancel(intent: { orderId: string, userId: string, symbol: string }) {
    try {
       // Append cancel event
       const cancelEvent = await EventStore.append({
         aggregateId: intent.orderId,
         aggregateType: 'ORDER',
         eventType: 'ORDER_CANCELED',
         payload: { symbol: intent.symbol, userId: intent.userId },
         // No idempotency key here to allow multiple tries or we can hash orderId + 'cancel'
         idempotencyKey: `${intent.orderId}-cancel`
       });
       
       if (cancelEvent) {
         await EventBus.publish('order.events', cancelEvent);
       }
    } catch (e) {
      console.error(`❌ OMS Engine: Cancel failed for ${intent.orderId}`);
    }
  }

  /**
   * Projection Handler: Translates events into PostgreSQL read models.
   * This ensures the DB is strictly a projection of the EventStore.
   */
  private static async projectEvent(event: any) {
    const { aggregateId, eventType, payload } = event;

    try {
      switch (eventType) {
        case 'ORDER_CREATED':
          await query(
            `INSERT INTO orders (id, user_id, symbol, side, type, price, quantity, status, order_subtype, time_in_force, stop_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO NOTHING`,
            [
              aggregateId, payload.userId, payload.symbol, payload.side, payload.type,
              payload.price || 0, payload.quantity, payload.status, 'STANDARD', payload.timeInForce || 'GTC', payload.stopPrice || null
            ]
          );
          if (payload.parentOrderId) {
            await query(
              `INSERT INTO order_relationships (parent_order_id, child_order_id, relation_type)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [payload.parentOrderId, aggregateId, payload.type]
            );
          }
          
          // Determine Activation Events (If parent, or if market/limit vs stop/tp)
          if (!payload.parentOrderId) {
            if (['MARKET', 'LIMIT'].includes(payload.type)) {
              // Command -> Event. We emit an internal activation command/event.
              const activatedEvent = await EventStore.append({
                aggregateId, aggregateType: 'ORDER', eventType: 'ORDER_ACTIVATED',
                payload: { ...payload, status: 'ACTIVE' }
              });
              if (activatedEvent) await EventBus.publish('order.events', activatedEvent);
            } else {
               const waitEvent = await EventStore.append({
                 aggregateId, aggregateType: 'ORDER', eventType: 'ORDER_ACTIVATED',
                 payload: { ...payload, status: 'TRIGGER_WAITING' }
               });
               if (waitEvent) await EventBus.publish('order.events', waitEvent);
            }
          }
          break;

        case 'ORDER_ACTIVATED':
          await query(`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`, [payload.status, aggregateId]);
          break;

        case 'ORDER_TRIGGERED':
          await query(`UPDATE orders SET status = 'ACTIVE', updated_at = NOW() WHERE id = $1`, [aggregateId]);
          // Once triggered, it's active.
          const triggeredActive = await EventStore.append({
             aggregateId, aggregateType: 'ORDER', eventType: 'ORDER_ACTIVATED',
             payload: { ...payload, status: 'ACTIVE' }
          });
          if (triggeredActive) await EventBus.publish('order.events', triggeredActive);
          break;

        case 'ORDER_FILLED':
          // We project the filled state (matching engine also writes this right now, we need to consolidate in phase 3)
          // For now, project child order triggers
          const res = await query(`SELECT child_order_id FROM order_relationships WHERE parent_order_id = $1`, [aggregateId]);
          for (const row of res.rows) {
            const childId = row.child_order_id;
            const childTrigger = await EventStore.append({
              aggregateId: childId, aggregateType: 'ORDER', eventType: 'ORDER_TRIGGERED',
              payload: { status: 'TRIGGERED' }
            });
            if (childTrigger) await EventBus.publish('order.events', childTrigger);
          }
          break;
          
        case 'ORDER_CANCELED':
          await query(`UPDATE orders SET status = 'CANCELED', updated_at = NOW() WHERE id = $1`, [aggregateId]);
          break;
      }
    } catch (e: any) {
      console.error(`❌ OMS Projection Error on ${eventType}:`, e.message);
    }
  }
}
