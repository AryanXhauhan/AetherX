// src/services/idempotencyStore.ts
// Deduplication layer for order submissions and critical mutations.
// Clients send X-Idempotency-Key header; duplicate requests within the TTL
// window return the cached original response without re-executing side effects.

import { redis } from '../config/redis.js';
import { query } from '../config/db.js';

const REDIS_PREFIX = 'aetherx:idempotency:';
const DEFAULT_TTL_SECONDS = 86400; // 24 hours

export interface IdempotencyResult {
  status: number;
  body: Record<string, any>;
}

export class IdempotencyStore {

  /**
   * Check if a key has already been processed.
   * Returns the cached result if found, null otherwise.
   * Checks Redis first (fast path), then PostgreSQL (slow path for persistence).
   */
  public static async check(key: string): Promise<IdempotencyResult | null> {
    if (!key || key.length < 8 || key.length > 255) {
      throw new Error('Idempotency key must be between 8 and 255 characters');
    }

    // Fast path: Redis cache
    const redisResult = await redis.get(`${REDIS_PREFIX}${key}`);
    if (redisResult) {
      try {
        return JSON.parse(redisResult);
      } catch {
        // Corrupted cache entry — proceed as miss
      }
    }

    // Slow path: PostgreSQL for durability across Redis restarts
    try {
      const pgResult = await query(
        `SELECT result_status, result_body FROM idempotency_keys 
         WHERE key = $1 AND expires_at > NOW()`,
        [key]
      );
      if (pgResult.rows.length > 0) {
        const result: IdempotencyResult = {
          status: pgResult.rows[0].result_status,
          body: pgResult.rows[0].result_body
        };
        // Repopulate Redis cache
        await redis.setex(
          `${REDIS_PREFIX}${key}`,
          DEFAULT_TTL_SECONDS,
          JSON.stringify(result)
        );
        return result;
      }
    } catch (dbError: any) {
      console.warn('⚠️ IdempotencyStore: PostgreSQL lookup failed, proceeding without cache:', dbError.message);
    }

    return null;
  }

  /**
   * Records a result for a given idempotency key.
   * Called after a successful (or deterministically failed) operation.
   */
  public static async record(
    key: string,
    result: IdempotencyResult,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const serialized = JSON.stringify(result);

    // Write to both Redis (fast) and PostgreSQL (durable) in parallel
    await Promise.allSettled([
      redis.setex(`${REDIS_PREFIX}${key}`, ttlSeconds, serialized),
      query(
        `INSERT INTO idempotency_keys (key, result_status, result_body, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING`,
        [key, result.status, JSON.stringify(result.body), expiresAt]
      )
    ]);
  }

  /**
   * Cleanup expired idempotency keys from PostgreSQL.
   * Should be called periodically (e.g. daily) to prevent table bloat.
   */
  public static async cleanup(): Promise<number> {
    const result = await query(
      `DELETE FROM idempotency_keys WHERE expires_at <= NOW() RETURNING key`
    );
    const count = result.rows.length;
    if (count > 0) {
      console.log(`🧹 IdempotencyStore: Cleaned up ${count} expired keys`);
    }
    return count;
  }
}

export default IdempotencyStore;
