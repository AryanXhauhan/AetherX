// src/hooks/useWebSockets.ts
import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:8080';

export interface TickData {
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
}

export interface IndicatorData {
  symbol: string;
  candle: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  indicators: {
    smoothedAtrStop: number;
    trendEma: number;
    rsi: number | null;
    adx: number | null;
    buyCond: boolean;
    sellCond: boolean;
    lastSL: number | null;
    lastTP: number | null;
    signalLabels: any[];
    barColor: string | null;
  };
}

export interface OrderBookLevel {
  price: number;
  volume: number;
}

export interface OrderBookData {
  symbol: string;
  depth: {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
  };
}

export interface TradeExecutedData {
  symbol: string;
  price: number;
  quantity: number;
  buyerId: string;
  sellerId: string;
  timestamp: number;
}

export interface SystemStats {
  tps: number;
  matchingLatencyMs: number;
  queueLag: number;
  activeSockets: number;
  cpuLoad: number;
  memoryUsageMb: number;
  timestamp: number;
}

export const useWebSockets = (symbol: string) => {
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState<TickData | null>(null);
  const [indicators, setIndicators] = useState<IndicatorData | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookData['depth']>({ bids: [], asks: [] });
  const [executions, setExecutions] = useState<TradeExecutedData[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  
  // Refresh trigger for components to refetch REST endpoints (e.g. balances, positions, orders)
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // 1. Establish connection to WebSocket Gateway
    const socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket']
    });
    
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      console.log('🔌 Connected to AetherX WS Gateway');
      // Subscribe to active symbol
      socket.emit('subscribe', symbol);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('🔌 Disconnected from AetherX WS Gateway');
    });

    // ── 2. Bind Channel Event Observers ───────────────────────
    
    // Initial stats dump on subscription room join
    socket.on('market.initial', (data: any) => {
      if (data.symbol === symbol) {
        if (data.depth) setOrderBook(data.depth);
        if (data.indicators) {
          setIndicators({
            symbol,
            candle: { time: Date.now()/1000, open: data.spot, high: data.spot, low: data.spot, close: data.spot, volume: 0 },
            indicators: data.indicators
          });
        }
      }
    });

    // Stream live price ticker ticks
    socket.on('market.tick', (data: TickData) => {
      if (data.symbol === symbol) {
        setTick(data);
      }
    });

    // Stream technical indicators candle closures (AruAlgo calculations)
    socket.on('market.indicators', (data: IndicatorData) => {
      if (data.symbol === symbol) {
        setIndicators(data);
      }
    });

    // Stream real-time matching engine orderbook updates
    socket.on('orderbook.update', (data: OrderBookData) => {
      if (data.symbol === symbol) {
        setOrderBook(data.depth);
      }
    });

    // Stream matching engine trade matches (executions)
    socket.on('trade.executed', (data: TradeExecutedData) => {
      if (data.symbol === symbol) {
        setExecutions((prev) => [data, ...prev.slice(0, 49)]); // Maintain top 50 matches
      }
    });

    // Stream real-time Grafana observability stats (once per second)
    socket.on('observability.stats', (data: SystemStats) => {
      setStats(data);
    });

    // Handle database balance / positions refresh alerts (Debounced to prevent REST thrashing)
    let refreshTimeout: any = null;
    socket.on('wallet.refresh', (data: any) => {
       // Optimistic update: Here we would ideally calculate the balance changes locally based on `trade.executed`.
       // For now, we heavily debounce the REST refetch to avoid DDoSing the backend during a burst.
       if (refreshTimeout) clearTimeout(refreshTimeout);
       refreshTimeout = setTimeout(() => {
          setRefreshTrigger((prev) => prev + 1);
       }, 2000); // Wait 2s for execution bursts to settle
    });

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      socket.emit('unsubscribe', symbol);
      socket.disconnect();
    };
  }, [symbol]);

  // Handle room transition as the user swaps selected symbol
  useEffect(() => {
    const socket = socketRef.current;
    if (socket && connected) {
      // Unsubscribe from all rooms and join new symbol room
      socket.emit('subscribe', symbol);
    }
  }, [symbol, connected]);

  return {
    connected,
    tick,
    indicators,
    orderBook,
    executions,
    stats,
    refreshTrigger
  };
};
