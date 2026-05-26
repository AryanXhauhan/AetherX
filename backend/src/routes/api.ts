// src/routes/api.ts
import { Router, Request, Response, NextFunction } from 'express';
import { register, login, logout, me } from '../controllers/auth.js';
import { getBalances, getPositions } from '../controllers/wallet.js';
import { placeOrder, cancelOrder, getOrders } from '../controllers/order.js';
import { getLedgerEntries, getPerformanceStats, getSystemMetrics } from '../controllers/stats.js';
import { getMarketHistory } from '../controllers/market.js';

// Extend Express Request type declarations for session binding
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
    }
  }
}

const router = Router();

/**
 * Authentication Middleware: Extracts and parses user sessions from secure cookies
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const sessionCookie = req.cookies.userSession;
  
  if (!sessionCookie) {
    return res.status(401).json({ error: 'Authentication required. No session found.' });
  }

  try {
    const parsed = JSON.parse(sessionCookie);
    req.user = parsed;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Session expired or malformed cookie.' });
  }
};

// ── Authentication Endpoints ─────────────────────────────────
router.post('/auth/register', register);
router.post('/auth/login', login);
router.post('/auth/logout', logout);
router.get('/auth/me', me);

// ── Wallet / Portfolio Inventory (Protected) ────────────────
router.get('/wallet/balances', requireAuth, getBalances);
router.get('/wallet/positions', requireAuth, getPositions);

// ── Order Operations (Protected) ─────────────────────────────
router.post('/orders', requireAuth, placeOrder);
router.delete('/orders/:orderId', requireAuth, cancelOrder);
router.get('/orders', requireAuth, getOrders);

// ── Market Data Endpoints ────────────────────────────────────
router.get('/market/history', getMarketHistory);

// ── System Performance & Auditing (Protected) ────────────────
router.get('/stats/ledger', requireAuth, getLedgerEntries);
router.get('/stats/performance', requireAuth, getPerformanceStats);
router.get('/stats/metrics', requireAuth, getSystemMetrics);

export default router;
