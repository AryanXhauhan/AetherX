import crypto from 'crypto';
import { EventBus } from '../backend/src/services/eventBus.js';

const API_URL = 'http://localhost:8080/api/v1';

async function runTest() {
  console.log('🧪 Starting full OMS integration test');
  // 1. Register user
  const email = `trader_${crypto.randomBytes(4).toString('hex')}@test.local`;
  const password = 'password123';
  console.log(`Registering ${email}`);
  const regRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!regRes.ok) throw new Error('Registration failed');

  // 2. Login to obtain session cookie
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!loginRes.ok) throw new Error('Login failed');
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';

  // 3. Place bracket order (LIMIT BUY with TP/SL)
  const orderRes = await fetch(`${API_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      price: '50000',
      quantity: '1',
      linkedOrders: {
        takeProfit: { price: 60000, quantity: 1 },
        stopLoss: { stopPrice: 45000, quantity: 1 }
      }
    })
  });
  const orderData = await orderRes.json();
  console.log('Order intent response:', orderData);
  const orderId = orderData.orderId;

  // Give OMS a moment to process intent
  await new Promise(r => setTimeout(r, 2000));

  // 4. Simulate market tick below stop price to trigger stop loss
  console.log('Publishing market tick price 44000 (below stop)');
  await EventBus.publish('market.ticks', {
    symbol: 'BTCUSDT',
    price: 44000,
    timestamp: Date.now()
  });

  // Wait for trigger processing
  await new Promise(r => setTimeout(r, 2000));

  // 5. Fetch order status
  const ordersRes = await fetch(`${API_URL}/orders`, {
    headers: { 'Cookie': cookie }
  });
  const orders = await ordersRes.json();
  console.log('Active orders after trigger:', orders.active);
  console.log('History orders after trigger:', orders.history);
}

runTest().catch(err => console.error('Test failed:', err));
