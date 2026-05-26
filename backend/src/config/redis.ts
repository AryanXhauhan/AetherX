import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  retryStrategy: (times: number) => {
    return Math.min(times * 50, 2000); // Backoff retry delay capped at 2s
  }
};

// Client for general commands and Streams (ticks, order books)
export const redis = new Redis(redisConfig);

// Client reserved exclusively for WebSocket gateway Pub/Sub subscriptions
export const redisPubSub = new Redis(redisConfig);

redis.on('connect', () => {
  console.log('✅ Redis core connection active');
});

redis.on('error', (err) => {
  console.error('❌ Redis core client connection error:', err.message);
});

redisPubSub.on('connect', () => {
  console.log('✅ Redis Pub/Sub subscriber connection active');
});

redisPubSub.on('error', (err) => {
  console.error('❌ Redis Pub/Sub client connection error:', err.message);
});
