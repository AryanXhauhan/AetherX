// src/index.ts
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

import apiRouter from './routes/api.js';
import { MarketIngestionService } from './services/marketIngestion.js';
import { AruAlgoService } from './services/aruAlgoService.js';
import { MatchingEngine } from './services/matchingEngine.js';
import { EventBus } from './services/eventBus.js';
import { ObservabilityService } from './services/observability.js';
import { OMSEngine } from './services/omsEngine.js';
import { PositionEngine } from './services/positionEngine.js';
import { TriggerEngine } from './services/triggerEngine.js';
import { LedgerEngine } from './services/ledgerEngine.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// ── Middleware Configurations ───────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// REST Route Mounting
app.use('/api/v1', apiRouter);

// Standard API health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'AetherX Core Trading Backend',
    timestamp: new Date().toISOString()
  });
});

// Bind HTTP server
const httpServer = createServer(app);

// Mount real-time WebSocket Gateway optimized for extreme low latency
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true
  },
  transports: ['websocket'], // Enforce raw WebSocket transport immediately, eliminating polling handshakes
  perMessageDeflate: false,  // Disable compression to eliminate CPU serialization latency overhead
  pingInterval: 10000,
  pingTimeout: 5000
});

// ── WebSocket Gateway Routing ───────────────────────────────
io.on('connection', (socket) => {
  ObservabilityService.incrementSockets();
  console.log(`🔌 Gateway: Connected socket [${socket.id}]. Active client count: ${io.engine.clientsCount}`);

  // Channel Subscription
  socket.on('subscribe', (symbol: string) => {
    const symUpper = symbol.toUpperCase();
    socket.join(symUpper);
    console.log(`📊 Gateway: Socket [${socket.id}] subscribed to stream room [${symUpper}]`);

    // Dispatch initial market statistics instantly on join
    const spot = MarketIngestionService.getCurrentPrice(symUpper);
    const depth = MatchingEngine.getOrderBookDepth(symUpper);
    const indicators = AruAlgoService.getLatestIndicators(symUpper);

    socket.emit('market.initial', {
      symbol: symUpper,
      spot,
      depth,
      indicators: indicators?.ready ? indicators.indicators : null
    });
  });

  socket.on('unsubscribe', (symbol: string) => {
    const symUpper = symbol.toUpperCase();
    socket.leave(symUpper);
    console.log(`📊 Gateway: Socket [${socket.id}] detached from stream room [${symUpper}]`);
  });

  socket.on('disconnect', () => {
    ObservabilityService.decrementSockets();
    console.log(`🔌 Gateway: Client [${socket.id}] disconnected`);
  });
});

// ── Event Bus -> WebSockets Broadcast Bridge ─────────────────
// These subscribers pipe real-time matching-engine trade completions 
// and AruAlgo analytical closed-candle indicator updates straight to client rooms.

const wireEventBusBroadcasters = async () => {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

  // 1. Pipe price ticks and AruAlgo candle signals
  for (const sym of symbols) {
    const tickTopic = `market.ticks.${sym.toLowerCase()}`;
    const indicatorTopic = `market.indicators.${sym.toLowerCase()}`;

    // Stream raw ticks to specific room
    EventBus.subscribe(tickTopic, `ws-tick-broadcaster-${sym}`, (tick: any) => {
      io.to(sym).emit('market.tick', {
        symbol: sym,
        price: tick.price,
        quantity: tick.quantity,
        timestamp: tick.timestamp
      });
    });

    // Stream indicator aggregations to room
    EventBus.subscribe(indicatorTopic, `ws-indicator-broadcaster-${sym}`, (data: any) => {
      io.to(sym).emit('market.indicators', {
        symbol: sym,
        candle: data.candle,
        indicators: data.indicators
      });
    });
  }

  // 2. Pipe match completions and order book updates
  EventBus.subscribe('order.events', 'ws-order-broadcaster', (evt: any) => {
    if (evt.type === 'TRADE_EXECUTED') {
      // Broadcast execution logs to the symbol room
      io.to(evt.symbol).emit('trade.executed', {
        symbol: evt.symbol,
        price: evt.price,
        quantity: evt.quantity,
        buyerId: evt.buyerId,
        sellerId: evt.sellerId,
        timestamp: evt.timestamp
      });

      // Update active order books for all subscribers on depth change
      const depth = MatchingEngine.getOrderBookDepth(evt.symbol);
      io.to(evt.symbol).emit('orderbook.update', {
        symbol: evt.symbol,
        depth
      });

      // Direct client wallet refresh signals
      io.emit('wallet.refresh', {
        buyerId: evt.buyerId,
        sellerId: evt.sellerId
      });
    } else if (evt.type === 'ORDER_PLACED' || evt.type === 'ORDER_CANCELED') {
      const orderSym = evt.order?.symbol || evt.symbol;
      const depth = MatchingEngine.getOrderBookDepth(orderSym);
      
      io.to(orderSym).emit('orderbook.update', {
        symbol: orderSym,
        depth
      });

      io.emit('wallet.refresh', {
        userId: evt.order?.userId || evt.userId
      });
    }
  });
};

// ── Observability Metrics Tick Loop ─────────────────────────
// Every second, compile processing latencies and TPS load to draw real-time monitors
const startObservabilityTicker = () => {
  setInterval(async () => {
    const stats = await ObservabilityService.captureSnapshot();
    io.emit('observability.stats', stats);
  }, 1000);
};

// ── Server Boot Sequence ──────────────────────────────────
const bootSystem = async () => {
  try {
    console.log('⚡ AetherX: Beginning terminal backend boot sequence...');

    // 1. Initialize Event-Driven Architecture (OMS, Position, Trigger)
    await OMSEngine.init();
    await PositionEngine.init();
    await TriggerEngine.init();

    // 2. Start in-memory matching books worker
    await MatchingEngine.start();

    // 2. Start AruAlgo candle aggregation engine
    await AruAlgoService.start(10); // 10-second candle aggregations

    // 3. Mount WS Event Bus Bridges
    await wireEventBusBroadcasters();

    // 4. Start Observability
    ObservabilityService.init();
    startObservabilityTicker();

    // 5. Connect and start market feed ingestion pipeline
    await MarketIngestionService.start();

    // 6. Start background workers (Ledger Reconciliation & Invariant Checks)
    import('./services/reconciliationWorker.js').then(({ ReconciliationWorker }) => {
        ReconciliationWorker.start();
    });

    setInterval(async () => {
      await LedgerEngine.runReconciliationJob();
    }, 60000); // run every 60s

    // Boot HTTP/WS server
    httpServer.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║           🚀 AETHERX TRADING BACKEND 🚀               ║
║                                                       ║
║  Status:        ✅ Online                             ║
║  API Port:      ${PORT}                                      ║
║  REST endpoint: http://localhost:${PORT}/api/v1             ║
║  WebSocket:     ws://localhost:${PORT}                      ║
║  Node runtime:  ${process.version}                               ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('❌ Server startup failure:', error);
    process.exit(1);
  }
};

bootSystem();
export default app;
