// src/services/retryQueue.ts
// Redis sorted-set based retry queue with exponential backoff.
// Failed jobs are retried with increasing delay until they succeed
// or exhaust their attempt budget, after which they move to the Dead Letter Queue.

import { redis } from '../config/redis.js';
import { query } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

export type RetryJobType =
  | 'SETTLE_TRADE'
  | 'LOCK_ESCROW'
  | 'RELEASE_ESCROW'
  | 'PUBLISH_EVENT'
  | 'STRATEGY_EXECUTE'
  | 'RECONCILIATION_RUN';

export interface RetryJob {
  id: string;
  type: RetryJobType;
  payload: Record<string, any>;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number;  // Unix timestamp ms
  error?: string;
  createdAt: number;
}

// Handler registry — functions that process each job type
type JobHandler = (payload: Record<string, any>) => Promise<void>;

const RETRY_QUEUE_KEY = 'aetherx:retry:queue';
const DEAD_LETTER_KEY = 'aetherx:retry:dlq';

// Fibonacci-style backoff delays in ms: 1s, 2s, 3s, 5s, 8s, 13s, 21s...
const BACKOFF_DELAYS_MS = [1000, 2000, 3000, 5000, 8000, 13000, 21000, 30000];

export class RetryQueue {
  private static handlers: Map<RetryJobType, JobHandler> = new Map();
  private static workerRunning = false;
  private static workerInterval: NodeJS.Timeout | null = null;

  /**
   * Register a handler function for a job type.
   * Called during service boot to bind processing logic.
   */
  public static registerHandler(type: RetryJobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
    console.log(`🔄 RetryQueue: Handler registered for job type [${type}]`);
  }

  /**
   * Enqueues a job for retry processing.
   * If delayMs is 0, the job is eligible for immediate processing.
   */
  public static async enqueue(
    type: RetryJobType,
    payload: Record<string, any>,
    maxAttempts = 5,
    initialDelayMs = 0
  ): Promise<string> {
    const job: RetryJob = {
      id: uuidv4(),
      type,
      payload,
      attempts: 0,
      maxAttempts,
      nextRetryAt: Date.now() + initialDelayMs,
      createdAt: Date.now()
    };

    // Use Redis sorted set: score = nextRetryAt timestamp for time-based polling
    await redis.zadd(RETRY_QUEUE_KEY, job.nextRetryAt, JSON.stringify(job));
    console.log(`🔄 RetryQueue: Job enqueued [${type}] id=${job.id} delay=${initialDelayMs}ms`);
    return job.id;
  }

  /**
   * Starts the background worker that polls and processes due jobs every 500ms.
   * Uses Redis ZRANGEBYSCORE to atomically claim jobs due for processing.
   */
  public static startWorker(): void {
    if (this.workerRunning) return;
    this.workerRunning = true;

    console.log('🔄 RetryQueue: Worker started');

    this.workerInterval = setInterval(async () => {
      await this.processDueJobs();
    }, 500);
  }

  public static stopWorker(): void {
    this.workerRunning = false;
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
  }

  /**
   * Processes all jobs whose nextRetryAt has passed.
   * Uses ZPOPMIN to atomically dequeue and process.
   */
  private static async processDueJobs(): Promise<void> {
    const now = Date.now();

    // Get jobs due for processing (score <= now)
    const rawJobs = await redis.zrangebyscore(RETRY_QUEUE_KEY, 0, now, 'LIMIT', 0, 10);
    if (rawJobs.length === 0) return;

    for (const rawJob of rawJobs) {
      let job: RetryJob;
      try {
        job = JSON.parse(rawJob);
      } catch {
        await redis.zrem(RETRY_QUEUE_KEY, rawJob);
        continue;
      }

      // Atomically remove from queue before processing to prevent double-processing
      const removed = await redis.zrem(RETRY_QUEUE_KEY, rawJob);
      if (removed === 0) continue; // Another worker claimed this job

      await this.processJob(job);
    }
  }

  /**
   * Executes a single job, re-enqueuing with backoff on failure.
   */
  private static async processJob(job: RetryJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.error(`🔄 RetryQueue: No handler for job type [${job.type}], sending to DLQ`);
      await this.sendToDeadLetter(job, 'No handler registered for job type');
      return;
    }

    job.attempts += 1;
    console.log(`🔄 RetryQueue: Processing [${job.type}] attempt ${job.attempts}/${job.maxAttempts} id=${job.id}`);

    try {
      await handler(job.payload);
      console.log(`✅ RetryQueue: Job completed [${job.type}] id=${job.id} after ${job.attempts} attempts`);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      job.error = errorMsg;

      console.warn(`⚠️ RetryQueue: Job failed [${job.type}] attempt ${job.attempts} — ${errorMsg}`);

      if (job.attempts >= job.maxAttempts) {
        // Exhausted retry budget
        console.error(`❌ RetryQueue: Job [${job.type}] id=${job.id} exhausted ${job.maxAttempts} attempts. Moving to DLQ.`);
        await this.sendToDeadLetter(job, errorMsg);
      } else {
        // Re-enqueue with exponential backoff
        const backoffMs = BACKOFF_DELAYS_MS[Math.min(job.attempts - 1, BACKOFF_DELAYS_MS.length - 1)];
        job.nextRetryAt = Date.now() + backoffMs;
        await redis.zadd(RETRY_QUEUE_KEY, job.nextRetryAt, JSON.stringify(job));
        console.log(`🔄 RetryQueue: Re-enqueued [${job.type}] id=${job.id} next retry in ${backoffMs}ms`);
      }
    }
  }

  /**
   * Moves a permanently failed job to the Dead Letter Queue (both Redis and PostgreSQL).
   */
  private static async sendToDeadLetter(job: RetryJob, errorMessage: string): Promise<void> {
    const dlqEntry = { ...job, movedToDlqAt: Date.now() };
    
    // Redis DLQ for fast access
    await redis.lpush(DEAD_LETTER_KEY, JSON.stringify(dlqEntry));
    await redis.ltrim(DEAD_LETTER_KEY, 0, 999); // Keep last 1000 DLQ entries

    // PostgreSQL DLQ for persistence
    try {
      await query(
        `INSERT INTO dead_letter_events (job_type, payload, error_message, attempts)
         VALUES ($1, $2, $3, $4)`,
        [job.type, JSON.stringify(job.payload), errorMessage, job.attempts]
      );
    } catch (dbError: any) {
      console.error('❌ RetryQueue: Failed to persist DLQ entry to PostgreSQL:', dbError.message);
    }
  }

  /**
   * Returns current queue depth for observability metrics.
   */
  public static async getQueueDepth(): Promise<{ pending: number; dlq: number }> {
    const pending = await redis.zcard(RETRY_QUEUE_KEY);
    const dlq = await redis.llen(DEAD_LETTER_KEY);
    return { pending, dlq };
  }

  /**
   * Returns recent Dead Letter Queue entries for the observability UI.
   */
  public static async getDeadLetterEntries(limit = 20): Promise<RetryJob[]> {
    const entries = await redis.lrange(DEAD_LETTER_KEY, 0, limit - 1);
    return entries.map(e => {
      try { return JSON.parse(e); } catch { return null; }
    }).filter(Boolean);
  }
}

export default RetryQueue;
