import { EventBus } from './eventBus.js';

export class MarketIngestionService {
  private static ws: any = null;
  private static syntheticIntervals: Map<string, NodeJS.Timeout> = new Map();
  private static currentPrices: Map<string, number> = new Map([
    ['BTCUSDT', 67250.0],
    ['ETHUSDT', 3740.0],
    ['SOLUSDT', 165.5]
  ]);
  
  private static isSynthetic = false;
  private static heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Starts the ingestion pipeline
   */
  public static async start(): Promise<void> {
    console.log('📡 Market Ingestion: Initializing stream pipeline...');
    
    // Fetch live market spot prices on boot to align initial levels
    await this.fetchInitialSpotPrices();

    this.connectBinance();
  }

  /**
   * Fetches real-world ticker price feeds to seed starting levels
   */
  private static async fetchInitialSpotPrices(): Promise<void> {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    for (const sym of symbols) {
      try {
        const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (response.ok) {
          const data = await response.json();
          const price = parseFloat(data.price);
          if (!isNaN(price) && price > 0) {
            this.currentPrices.set(sym, price);
            console.log(`📡 Market Ingestion: Aligned starting price for [${sym}] to real market level: $${price}`);
          }
        }
      } catch (err: any) {
        console.warn(`⚠️ Market Ingestion: Failed to fetch initial spot price for [${sym}], using default.`, err.message || err);
      }
    }
  }

  /**
   * Establishes a native WebSocket connection to Binance's combined stream API
   */
  private static connectBinance(): void {
    const symbols = ['btcusdt', 'ethusdt', 'solusdt'];
    const streamNames = symbols.map(s => `${s}@aggTrade`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streamNames}`;

    let lastMessageTime = Date.now();

    try {
      console.log(`📡 Market Ingestion: Connecting to Binance live stream...`);
      
      // Node 22+ supports the global Web API standards-compliant WebSocket natively!
      this.ws = new (globalThis as any).WebSocket(url);

      this.ws.onopen = () => {
        console.log('✅ Market Ingestion: Connected to live Binance WebSocket stream');
        this.isSynthetic = false;
        this.stopSyntheticFeeds();

        // Resilient tick heartbeat: Fallback to synthetic if connection is open but silent (firewall/proxy blocking frames)
        lastMessageTime = Date.now();
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
          if (Date.now() - lastMessageTime > 5000) {
            if (!this.isSynthetic) {
              console.warn('⚠️ Market Ingestion: No ticks received from Binance live stream for 5 seconds. Activating synthetic backup.');
              this.startSyntheticFeeds();
            }
          }
        }, 2000);
      };

      this.ws.onmessage = async (event: any) => {
        lastMessageTime = Date.now();
        try {
          const payload = JSON.parse(event.data);
          const data = payload.data;
          
          if (!data || (data.e !== 'trade' && data.e !== 'aggTrade')) return;

          const symbol = data.s; // e.g. BTCUSDT
          const price = parseFloat(data.p);
          const quantity = parseFloat(data.q);
          const timestamp = data.T;

          // Track price internally
          this.currentPrices.set(symbol, price);

          // Route trade tick onto Event Bus topic: e.g. market.ticks.btcusdt
          const topic = `market.ticks.${symbol.toLowerCase()}`;
          await EventBus.publish(topic, {
            symbol,
            price,
            quantity,
            timestamp
          });
        } catch (err: any) {
          console.error('❌ Market Ingestion: Error processing message:', err.message || err);
        }
      };

      this.ws.onerror = (err: any) => {
        console.warn('⚠️ Market Ingestion: WebSocket connection encountered error. Defaulting to synthetic simulation.');
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }
        this.startSyntheticFeeds();
      };

      this.ws.onclose = () => {
        console.warn('⚠️ Market Ingestion: Binance WebSocket stream closed. Defaulting to synthetic simulation.');
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }
        this.startSyntheticFeeds();
        
        // Try to reconnect to live feeds in 15 seconds
        setTimeout(() => {
          if (this.isSynthetic) {
            console.log('📡 Market Ingestion: Attempting reconnection to Binance...');
            this.connectBinance();
          }
        }, 15000);
      };
    } catch (e) {
      console.error('❌ Market Ingestion: Unhandled exception in socket setup. Starting synthetic backup.');
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      this.startSyntheticFeeds();
    }
  }

  /**
   * Spawns randomized synthetic price generators to simulate live markets offline
   */
  public static startSyntheticFeeds(): void {
    if (this.isSynthetic) return; // Already running simulation
    this.isSynthetic = true;
    console.log('🤖 Market Ingestion: Synthetic Price Simulation activated');

    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    
    for (const symbol of symbols) {
      // Clean previous interval
      if (this.syntheticIntervals.has(symbol)) {
        clearInterval(this.syntheticIntervals.get(symbol)!);
      }

      // Volatility and drift parameters optimized for extreme low-latency high-frequency streaming
      const params: Record<string, { vol: number; tickMs: number }> = {
        'BTCUSDT': { vol: 5.0, tickMs: 100 }, // 10 price ticks per second!
        'ETHUSDT': { vol: 0.4, tickMs: 100 },
        'SOLUSDT': { vol: 0.03, tickMs: 100 }
      };

      const config = params[symbol] || { vol: 1.0, tickMs: 300 };

      const interval = setInterval(async () => {
        let currentPrice = this.currentPrices.get(symbol) || 100.0;
        
        // Random walk using Box-Muller transform for gaussian noise
        const u1 = Math.random() || 1e-9;
        const u2 = Math.random();
        const randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        
        const priceChange = randStdNormal * config.vol;
        currentPrice = Math.max(0.01, currentPrice + priceChange);
        
        this.currentPrices.set(symbol, currentPrice);

        const topic = `market.ticks.${symbol.toLowerCase()}`;
        try {
          await EventBus.publish(topic, {
            symbol,
            price: parseFloat(currentPrice.toFixed(4)),
            quantity: parseFloat((Math.random() * 2 + 0.05).toFixed(4)),
            timestamp: Date.now(),
            isSynthetic: true
          });
        } catch (e) {
          // Silent event bus publish warnings in server output
        }
      }, config.tickMs);

      this.syntheticIntervals.set(symbol, interval);
    }
  }

  /**
   * Tears down background intervals
   */
  private static stopSyntheticFeeds(): void {
    console.log('🔌 Market Ingestion: Stopping synthetic fallback streams');
    for (const [_, interval] of this.syntheticIntervals.entries()) {
      clearInterval(interval);
    }
    this.syntheticIntervals.clear();
  }

  /**
   * Safe getter for current spot prices
   */
  public static getCurrentPrice(symbol: string): number {
    return this.currentPrices.get(symbol.toUpperCase()) || 0;
  }
}
export default MarketIngestionService;
