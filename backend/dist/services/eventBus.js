import Redis from 'ioredis';
import { redis } from '../config/redis.js';
export class EventBus {
    static activeSubscribers = new Map();
    static subscriberClients = new Map();
    /**
     * Publishes an event payload to a Redis Stream topic (simulating a Kafka topic)
     * @param topic Redis stream name (e.g. market.ticks.btcusdt)
     * @param data Payload object to serialize
     */
    static async publish(topic, data) {
        try {
            const payload = JSON.stringify({
                ...data,
                timestamp: data.timestamp || Date.now()
            });
            // XADD key ID field value [field value ...]
            // '*' generates an automated timestamp-sequence ID
            const messageId = await redis.xadd(topic, '*', 'payload', payload);
            return messageId || 'OK';
        }
        catch (error) {
            console.error(`❌ EventBus publish failure on topic [${topic}]:`, error);
            throw error;
        }
    }
    /**
     * Subscribes to a stream topic using a non-polling blocking XREAD loop
     * @param topic Stream name to listen to
     * @param subscriberId Unique consumer identifier (for debugging/logging)
     * @param callback Async function triggered on receipt of new messages
     */
    static async subscribe(topic, subscriberId, callback) {
        const subscriberKey = `${topic}:${subscriberId}`;
        if (this.activeSubscribers.get(subscriberKey)) {
            return; // Already actively subscribed
        }
        this.activeSubscribers.set(subscriberKey, true);
        console.log(`🔌 EventBus: Subscriber [${subscriberId}] attached to topic [${topic}]`);
        // Create a dedicated Redis client for this specific blocking subscription loop
        const subRedis = new Redis({
            host: process.env.REDIS_HOST || '127.0.0.1',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryStrategy: (times) => Math.min(times * 50, 2000)
        });
        this.subscriberClients.set(subscriberKey, subRedis);
        // We start listening from the tail of the stream ($) on initialization
        let lastSeenId = '$';
        // Spawn async background consumer loop
        (async () => {
            while (this.activeSubscribers.get(subscriberKey)) {
                try {
                    // XREAD BLOCK [ms] STREAMS [key] [ID]
                    // Block up to 2000ms waiting for new messages
                    const result = await subRedis.xread('BLOCK', 2000, 'STREAMS', topic, lastSeenId);
                    if (!result) {
                        continue; // Timeout with no new messages, loop again
                    }
                    // Parse result: [[streamName, [[messageId, [fieldName, fieldVal]]]]]
                    const streams = result;
                    for (const streamInfo of streams) {
                        const messages = streamInfo[1];
                        for (const msg of messages) {
                            const msgId = msg[0];
                            const fields = msg[1];
                            // Extract the payload field
                            const payloadIndex = fields.indexOf('payload');
                            if (payloadIndex !== -1 && fields[payloadIndex + 1]) {
                                try {
                                    const data = JSON.parse(fields[payloadIndex + 1]);
                                    await callback(data);
                                }
                                catch (parseError) {
                                    console.error(`❌ EventBus failed to parse stream message payload [${msgId}]:`, parseError);
                                }
                            }
                            // Advance the cursor
                            lastSeenId = msgId;
                        }
                    }
                }
                catch (error) {
                    // Don't log error if we intentionally disconnected this client
                    if (!this.activeSubscribers.get(subscriberKey)) {
                        break;
                    }
                    console.error(`❌ EventBus consumer loop error on topic [${topic}]:`, error);
                    // Wait 1s before retrying to prevent hot loop on connection drops
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        })();
    }
    /**
     * Disconnects a subscriber loop
     */
    static unsubscribe(topic, subscriberId) {
        const subscriberKey = `${topic}:${subscriberId}`;
        this.activeSubscribers.set(subscriberKey, false);
        const subRedis = this.subscriberClients.get(subscriberKey);
        if (subRedis) {
            subRedis.disconnect();
            this.subscriberClients.delete(subscriberKey);
        }
        console.log(`🔌 EventBus: Subscriber [${subscriberId}] detached from topic [${topic}]`);
    }
}
export default EventBus;
