// src/services/eventStore.ts
// Append-only domain event log — the system of record for all state changes.
// All mutations to orders, balances, positions, and trades are recorded here
// before being reflected in mutable tables.
import { query } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
export class EventStore {
    /**
     * Appends an immutable domain event to the event store.
     * Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.
     * Returns null if the event was a duplicate (idempotency key already seen).
     */
    static async append(params) {
        const { aggregateId, aggregateType, eventType, payload, metadata = {}, idempotencyKey } = params;
        const id = uuidv4();
        try {
            const result = await query(`INSERT INTO event_store 
           (id, aggregate_id, aggregate_type, event_type, payload, metadata, idempotency_key, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, sequence, aggregate_id as "aggregateId", aggregate_type as "aggregateType",
                   event_type as "eventType", payload, metadata, idempotency_key as "idempotencyKey",
                   occurred_at as "occurredAt"`, [
                id,
                aggregateId,
                aggregateType,
                eventType,
                JSON.stringify(payload),
                JSON.stringify(metadata),
                idempotencyKey || null
            ]);
            if (result.rows.length === 0) {
                // Duplicate idempotency key — event was already recorded
                console.log(`📒 EventStore: Duplicate event skipped [${eventType}] key=${idempotencyKey}`);
                return null;
            }
            const row = result.rows[0];
            return {
                id: row.id,
                sequence: parseInt(row.sequence),
                aggregateId: row.aggregateId,
                aggregateType: row.aggregateType,
                eventType: row.eventType,
                payload: row.payload,
                metadata: row.metadata,
                idempotencyKey: row.idempotencyKey,
                occurredAt: row.occurredAt
            };
        }
        catch (error) {
            console.error(`❌ EventStore: Failed to append [${eventType}] for aggregate [${aggregateId}]:`, error.message);
            throw error;
        }
    }
    /**
     * Retrieves all events for a specific aggregate, ordered by sequence.
     * Use this to reconstruct the full history of an order, account, or position.
     */
    static async getAggregateHistory(aggregateId) {
        const result = await query(`SELECT id, sequence, aggregate_id as "aggregateId", aggregate_type as "aggregateType",
              event_type as "eventType", payload, metadata, idempotency_key as "idempotencyKey",
              occurred_at as "occurredAt"
       FROM event_store
       WHERE aggregate_id = $1
       ORDER BY sequence ASC`, [aggregateId]);
        return result.rows.map(this.mapRow);
    }
    /**
     * Reads all events from a global sequence number (inclusive).
     * Used by the ReplayEngine to reconstruct system state from any point.
     */
    static async readFromSequence(fromSequence, limit = 1000) {
        const result = await query(`SELECT id, sequence, aggregate_id as "aggregateId", aggregate_type as "aggregateType",
              event_type as "eventType", payload, metadata, idempotency_key as "idempotencyKey",
              occurred_at as "occurredAt"
       FROM event_store
       WHERE sequence >= $1
       ORDER BY sequence ASC
       LIMIT $2`, [fromSequence, limit]);
        return result.rows.map(this.mapRow);
    }
    /**
     * Queries events by type with optional time range filtering.
     * Used by the audit explorer and event inspector UI.
     */
    static async getEventsByType(eventType, options = {}) {
        const { limit = 100, from, to } = options;
        let sql = `SELECT id, sequence, aggregate_id as "aggregateId", aggregate_type as "aggregateType",
                       event_type as "eventType", payload, metadata, idempotency_key as "idempotencyKey",
                       occurred_at as "occurredAt"
               FROM event_store
               WHERE event_type = $1`;
        const params = [eventType];
        if (from) {
            params.push(from);
            sql += ` AND occurred_at >= $${params.length}`;
        }
        if (to) {
            params.push(to);
            sql += ` AND occurred_at <= $${params.length}`;
        }
        params.push(limit);
        sql += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;
        const result = await query(sql, params);
        return result.rows.map(this.mapRow);
    }
    /**
     * Paginated query for the event inspector UI.
     * Returns events with cursor-based pagination for efficiency.
     */
    static async queryEvents(options) {
        const { aggregateId, aggregateType, eventType, fromSeq, limit = 50, userId } = options;
        let whereClauses = [];
        const params = [];
        if (aggregateId) {
            params.push(aggregateId);
            whereClauses.push(`aggregate_id = $${params.length}`);
        }
        if (aggregateType) {
            params.push(aggregateType);
            whereClauses.push(`aggregate_type = $${params.length}`);
        }
        if (eventType) {
            params.push(eventType);
            whereClauses.push(`event_type = $${params.length}`);
        }
        if (fromSeq) {
            params.push(fromSeq);
            whereClauses.push(`sequence >= $${params.length}`);
        }
        if (userId) {
            params.push(userId);
            whereClauses.push(`metadata->>'userId' = $${params.length}`);
        }
        const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        // Total count for pagination
        const countRes = await query(`SELECT COUNT(*) as total FROM event_store ${whereStr}`, params);
        const total = parseInt(countRes.rows[0].total);
        // Fetch page
        params.push(limit + 1); // Fetch one extra to detect if there's a next page
        const result = await query(`SELECT id, sequence, aggregate_id as "aggregateId", aggregate_type as "aggregateType",
              event_type as "eventType", payload, metadata, idempotency_key as "idempotencyKey",
              occurred_at as "occurredAt"
       FROM event_store ${whereStr}
       ORDER BY sequence DESC
       LIMIT $${params.length}`, params);
        const rows = result.rows.map(this.mapRow);
        const hasNext = rows.length > limit;
        if (hasNext)
            rows.pop();
        const nextSeq = hasNext ? rows[rows.length - 1].sequence - 1 : null;
        return { events: rows, nextSeq, total };
    }
    /**
     * Returns the current highest sequence number.
     * Used by Observability to track total system event throughput.
     */
    static async getCurrentSequence() {
        const result = await query(`SELECT COALESCE(MAX(sequence), 0) as seq FROM event_store`);
        return parseInt(result.rows[0].seq);
    }
    /**
     * Saves an aggregate snapshot to avoid replaying all events from origin.
     * Called periodically by the ReplayEngine after processing N events.
     */
    static async saveSnapshot(aggregateId, aggregateType, snapshotData, snapshotSeq) {
        await query(`INSERT INTO event_snapshots (aggregate_id, aggregate_type, snapshot_data, snapshot_seq)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (aggregate_id, aggregate_type)
       DO UPDATE SET snapshot_data = $3, snapshot_seq = $4, created_at = NOW()`, [aggregateId, aggregateType, JSON.stringify(snapshotData), snapshotSeq]);
    }
    /**
     * Retrieves the most recent snapshot for an aggregate.
     * ReplayEngine starts replay from snapshot_seq + 1 instead of 0.
     */
    static async getSnapshot(aggregateId, aggregateType) {
        const result = await query(`SELECT snapshot_data as data, snapshot_seq as seq
       FROM event_snapshots
       WHERE aggregate_id = $1 AND aggregate_type = $2`, [aggregateId, aggregateType]);
        if (result.rows.length === 0)
            return null;
        return { data: result.rows[0].data, seq: parseInt(result.rows[0].seq) };
    }
    // ── Private helpers ───────────────────────────────────────
    static mapRow(row) {
        return {
            id: row.id,
            sequence: parseInt(row.sequence),
            aggregateId: row.aggregateId,
            aggregateType: row.aggregateType,
            eventType: row.eventType,
            payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
            idempotencyKey: row.idempotencyKey,
            occurredAt: new Date(row.occurredAt)
        };
    }
}
export default EventStore;
