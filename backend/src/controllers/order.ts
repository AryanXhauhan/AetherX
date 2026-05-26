// src/controllers/order.ts
import { Request, Response } from 'express';
import { query } from '../config/db.js';
import { RiskEngine } from '../services/riskEngine.js';
import { LedgerEngine } from '../services/ledgerEngine.js';
import { MatchingEngine, Order } from '../services/matchingEngine.js';
import { EventBus } from '../services/eventBus.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Handles BUY/SELL LIMIT/MARKET order submissions
 */
export const placeOrder = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { symbol, side, type, price, quantity } = req.body;

  // Validate inputs
  if (!symbol || !side || !type || !quantity) {
    return res.status(400).json({ error: 'Missing required order fields: symbol, side, type, quantity' });
  }

  const numPrice = parseFloat(price || '0');
  const numQty = parseFloat(quantity);

  if (type === 'LIMIT' && numPrice <= 0) {
    return res.status(400).json({ error: 'Limit orders require a price greater than zero' });
  }
  if (numQty <= 0) {
    return res.status(400).json({ error: 'Quantity must be greater than zero' });
  }
  if (!['BUY', 'SELL'].includes(side.toUpperCase())) {
    return res.status(400).json({ error: 'Order side must be BUY or SELL' });
  }
  if (!['LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT', 'TAKE_PROFIT'].includes(type.toUpperCase())) {
    return res.status(400).json({ error: 'Invalid order type' });
  }

  try {
    const symUpper = symbol.toUpperCase();
    const sideUpper = side.toUpperCase() as 'BUY' | 'SELL';
    const typeUpper = type.toUpperCase() as 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT' | 'TAKE_PROFIT';

    const idempotencyKey = req.body.idempotencyKey || uuidv4();

    // ── 1. Dispatch Intent to OMS Engine ──────────────
    const intent = {
      idempotencyKey,
      userId,
      symbol: symUpper,
      side: sideUpper,
      type: typeUpper,
      price: numPrice,
      quantity: numQty,
      timeInForce: req.body.timeInForce || 'GTC',
      stopPrice: req.body.stopPrice ? parseFloat(req.body.stopPrice) : undefined,
      linkedOrders: req.body.linkedOrders,
      timestamp: Date.now()
    };

    // OMS Engine listens to this and performs risk checks, DB writes, and lifecycle events
    await EventBus.publish('order.intents', intent);

    res.status(202).json({
      message: 'Order intent accepted by OMS',
      orderId: idempotencyKey, // Used for tracking via WebSocket
    });
  } catch (error: any) {
    console.error('❌ Order intent submission failed:', error.message);
    res.status(500).json({ error: 'Order intent submission failed' });
  }
};

/**
 * Cancels a pending or partially filled limit order and unlocks escrow
 */
export const cancelOrder = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { orderId } = req.params;

  try {
    // 1. Fetch order details from DB to validate ownership
    const orderRes = await query(
      `SELECT symbol, status 
       FROM orders 
       WHERE id = $1 AND user_id = $2`,
      [orderId, userId]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderRes.rows[0];
    if (!['PENDING', 'PARTIALLY_FILLED', 'TRIGGER_WAITING', 'ACTIVE'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot cancel order with status [${order.status}]` });
    }

    // ── 2. Dispatch Cancel Intent to OMS ────────────────
    const intent = {
      orderId,
      userId,
      symbol: order.symbol
    };

    await EventBus.publish('order.cancel_intents', intent);

    res.json({ message: 'Order cancellation intent submitted', orderId });
  } catch (error: any) {
    console.error('❌ Failed to submit cancel intent:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel order' });
  }
};

/**
 * Returns active pending orders and historical orders
 */
export const getOrders = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const activeRes = await query(
      `SELECT id, symbol, side, type, price, quantity, filled_quantity as "filledQuantity", status, created_at as "createdAt"
       FROM orders 
       WHERE user_id = $1 AND status IN ('PENDING', 'PARTIALLY_FILLED', 'TRIGGER_WAITING')
       ORDER BY created_at DESC`,
      [userId]
    );

    const historyRes = await query(
      `SELECT id, symbol, side, type, price, quantity, filled_quantity as "filledQuantity", status, created_at as "createdAt"
       FROM orders 
       WHERE user_id = $1 AND status IN ('FILLED', 'CANCELED')
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    const format = (rows: any[]) => rows.map(r => ({
      ...r,
      price: parseFloat(r.price),
      quantity: parseFloat(r.quantity),
      filledQuantity: parseFloat(r.filledQuantity)
    }));

    res.json({
      active: format(activeRes.rows),
      history: format(historyRes.rows)
    });
  } catch (error) {
    console.error('❌ Failed to fetch orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};
