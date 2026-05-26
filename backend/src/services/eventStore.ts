import { query, getClient } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

export type AggregateType = 'ORDER' | 'ACCOUNT' | 'POSITION' | 'TRADE' | 'SYSTEM' | 'STRATEGY';
export type DomainEventType = string;

export interface DomainEvent {
  id: string;
  sequence: number;
  aggregateId: string;
  aggregateType: AggregateType;
  eventType: DomainEventType;
  payload: Record<string, any>;
  metadata: Record<string, any>;
  idempotencyKey?: string;
  occurredAt: Date;
}

export interface AppendEventParams {
  aggregateId: string;
  aggregateType: AggregateType;
  eventType: DomainEventType;
  payload: Record<string, any>;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export class EventStore {
  /**
   * Appends an immutable domain event to the event store.
   */
  public static async append(params: AppendEventParams): Promise<DomainEvent | null> {
    const { aggregateId, aggregateType, eventType, payload, metadata = {}, idempotencyKey } = params;
    const id = uuidv4();

    try {
      const result = await query(
        `INSERT INTO event_store 
           (id, aggregate_id, aggregate_type, event_type, payload, metadata, idempotency_key, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, sequence, aggregate_id as "aggregateId", aggregate_type as "aggregateType",
                   event_type as "eventType", payload, metadata, idempotency_key as "idempotencyKey",
                   occurred_at as "occurredAt"`,
        [id, aggregateId, aggregateType, eventType, JSON.stringify(payload), JSON.stringify(metadata), idempotencyKey || null]
      );

      if (result.rows.length === 0) {
        return null; // Duplicate idempotency key
      }
      return this.mapRow(result.rows[0]);
    } catch (error: any) {
      console.error(`❌ EventStore: Failed to append [${eventType}] for aggregate [${aggregateId}]:`, error.message);
      throw error;
    }
  }

  /**
   * Appends multiple events transactionally.
   * If any fail (or if any idempotency key is a duplicate), the whole batch rolls back (unless handled differently).
   * Here we assume we want all-or-nothing for a workflow (like placing order + TP/SL).
   */
  public static async appendBatch(events: AppendEventParams[]): Promise<DomainEvent[]> {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const appendedEvents: DomainEvent[] = [];

      for (const params of events) {
        const { aggregateId, aggregateType, eventType, payload, metadata = {}, idempotencyKey } = params;
        const id = uuidv4();

        const result = await client.query(
          `INSERT INTO event_store 
             (id, aggregate_id, aggregate_type, event_type, payload, metadata, idempotency_key, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id, sequence, aggregate_id as "aggregateId", aggregate_type as "aggregateType",
                     event_type as "eventType", payload, metadata, idempotency_key as "idempotencyKey",
                     occurred_at as "occurredAt"`,
          [id, aggregateId, aggregateType, eventType, JSON.stringify(payload), JSON.stringify(metadata), idempotencyKey || null]
        );

        if (result.rows.length > 0) {
          appendedEvents.push(this.mapRow(result.rows[0]));
        } else {
           // If idempotency hit, we skip appending but still commit the others?
           // Actually, if it's a batch of linked orders, idempotency hitting on one usually implies the whole batch was already processed.
           // For safety, let's roll back if any duplicate is found to prevent partial processing.
           throw new Error(`Duplicate idempotency_key [${idempotencyKey}] found in batch append.`);
        }
      }

      await client.query('COMMIT');
      return appendedEvents;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public static async getAggregateHistory(aggregateId: string): Promise<DomainEvent[]> {
    const result = await query(
      `SELECT * FROM event_store WHERE aggregate_id = $1 ORDER BY sequence ASC`,
      [aggregateId]
    );
    return result.rows.map(this.mapRow);
  }

  private static mapRow(row: any): DomainEvent {
    return {
      id: row.id,
      sequence: parseInt(row.sequence),
      aggregateId: row.aggregateId,
      aggregateType: row.aggregateType,
      eventType: row.eventType,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      idempotencyKey: row.idempotencyKey,
      occurredAt: new Date(row.occurred_at || row.occurredAt)
    };
  }
}
export default EventStore;
