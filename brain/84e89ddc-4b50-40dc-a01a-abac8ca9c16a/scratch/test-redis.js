// test-redis.js
import Redis from 'ioredis';

const redis = new Redis({ host: '127.0.0.1', port: 6379 });

redis.on('connect', () => {
  console.log('Connected to Redis!');
});

const topic = 'test-stream';

// Start subscriber
(async () => {
  console.log('Subscriber starting...');
  let lastSeenId = '$';
  
  // Read once from $ first to register the cursor
  const initial = await redis.xread('BLOCK', 100, 'STREAMS', topic, lastSeenId);
  console.log('Initial XREAD response:', initial);
  
  // Now listen in a loop
  for (let i = 0; i < 3; i++) {
    console.log(`Reading loop ${i}...`);
    const result = await redis.xread('BLOCK', 3000, 'STREAMS', topic, lastSeenId);
    console.log(`Loop ${i} result:`, JSON.stringify(result));
    if (result) {
      const messages = result[0][1];
      for (const msg of messages) {
        lastSeenId = msg[0];
        console.log('Parsed message:', msg[1]);
      }
    }
  }
})();

// Start publisher
setTimeout(async () => {
  console.log('Publishing message...');
  const id = await redis.xadd(topic, '*', 'payload', JSON.stringify({ hello: 'world' }));
  console.log('Published! Message ID:', id);
}, 1000);

setTimeout(() => {
  console.log('Done.');
  redis.disconnect();
  process.exit(0);
}, 6000);
