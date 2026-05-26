import { EventBus } from './eventBus.js';
import { AruAlgo, AruAlgoResult, Candle } from './aruAlgo.js';

interface SymbolCandleState {
  currentCandle: Candle | null;
  algo: AruAlgo;
  intervalSec: number;
}

export class AruAlgoService {
  private static states: Map<string, SymbolCandleState> = new Map();
  private static subscribersActive = false;

  /**
   * Initializes the technical analysis processor
   * @param intervalSec Candle block size in seconds (default: 10s for fast live terminal plotting)
   */
  public static async start(intervalSec = 10): Promise<void> {
    console.log(`🤖 AruAlgoService: Starting indicators engine with ${intervalSec}s candles...`);

    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

    for (const symbol of symbols) {
      this.states.set(symbol, {
        currentCandle: null,
        algo: new AruAlgo({
          sensitivity: 8,       // ATR Sensitivity from Pine Script
          atrPeriod: 20,         // ATR Period
          trendEmaPeriod: 50,    // Trend EMA Period
          rsiPeriod: 14,         // RSI Period
          rsiOverbought: 60,     // RSI Overbought Threshold
          rsiOversold: 40,       // RSI Oversold Threshold
          adxPeriod: 14,         // ADX Period
          adxThreshold: 15,      // ADX Threshold
          slMultiplier: 1.5,     // SL ATR Multiplier
          tpMultiplier: 2.0      // TP ATR Multiplier
        }),
        intervalSec
      });
      
      // Seed initial candles to let technical indicators work instantly
      this.seedInitialCandles(symbol, intervalSec);
    }

    if (!this.subscribersActive) {
      this.subscribersActive = true;
      this.bindTickListeners();
    }
  }

  /**
   * Pre-populates the AruAlgo instance with mock historical candles 
   * so indicators (like 50 EMA and RSI) are warm and ready immediately
   */
  private static seedInitialCandles(symbol: string, intervalSec: number): void {
    const state = this.states.get(symbol);
    if (!state) return;

    let basePrice = symbol === 'BTCUSDT' ? 67200.0 : symbol === 'ETHUSDT' ? 3735.0 : 165.0;
    const nowSec = Math.floor(Date.now() / 1000);
    const count = 100; // Warmup with 100 bars

    // Loop backwards in time
    for (let i = count; i > 0; i--) {
      const time = nowSec - (i * intervalSec);
      
      // Simple random fluctuation to make realistic candles
      const change = (Math.random() - 0.5) * (basePrice * 0.0005);
      const open = basePrice;
      const close = basePrice + change;
      const high = Math.max(open, close) + (Math.random() * basePrice * 0.0002);
      const low = Math.min(open, close) - (Math.random() * basePrice * 0.0002);
      basePrice = close;

      state.algo.processCandle({
        time,
        open,
        high,
        low,
        close,
        volume: Math.random() * 50 + 10
      });
    }
    console.log(`🔥 AruAlgoService: Pre-warmed indicators for [${symbol}] with 100 historical intervals`);
  }

  /**
   * Binds streaming tick handlers to construct active candle blocks
   */
  private static bindTickListeners(): void {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

    for (const symbol of symbols) {
      const topic = `market.ticks.${symbol.toLowerCase()}`;
      
      EventBus.subscribe(topic, `arualgo-processor-${symbol}`, async (tick: any) => {
        const state = this.states.get(symbol);
        if (!state) return;

        const price = tick.price;
        const qty = tick.quantity;
        const tickTimeSec = Math.floor(tick.timestamp / 1000);

        // Align timestamp to the current interval interval block
        const candleTime = Math.floor(tickTimeSec / state.intervalSec) * state.intervalSec;

        let active = state.currentCandle;

        if (!active) {
          // Open new candle block
          state.currentCandle = {
            time: candleTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: qty
          };
        } else if (candleTime > active.time) {
          // The current block has expired! Close and process active candle
          try {
            const results = state.algo.processCandle(active);
            
            if (results.ready) {
              // Publish indicator metrics onto separate topic
              const outTopic = `market.indicators.${symbol.toLowerCase()}`;
              await EventBus.publish(outTopic, {
                symbol,
                candle: active,
                indicators: {
                  smoothedAtrStop: results.smoothedAtrStop,
                  trendEma: results.trendEma,
                  rsi: results.rsi,
                  adx: results.adx,
                  buyCond: results.buyCond,
                  sellCond: results.sellCond,
                  simpleBuyCond: results.simpleBuyCond,
                  simpleSellCond: results.simpleSellCond,
                  lastSL: results.lastSL,
                  lastTP: results.lastTP,
                  signalLabels: results.signalLabels,
                  barColor: results.barColor
                }
              });
            }
          } catch (err) {
            console.error(`❌ AruAlgoService: Error executing signal logic for [${symbol}]:`, err);
          }

          // Open the next candle block
          state.currentCandle = {
            time: candleTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: qty
          };
        } else {
          // Tick falls inside the current candle block, update OHLCV
          active.high = Math.max(active.high, price);
          active.low = Math.min(active.low, price);
          active.close = price;
          active.volume = (active.volume || 0) + qty;
        }
      });
    }
  }

  /**
   * Forces AruAlgo to process the currently open active candle 
   * to get the most up-to-date real-time metrics
   */
  public static getLatestIndicators(symbol: string): AruAlgoResult | null {
    const state = this.states.get(symbol);
    if (!state || !state.currentCandle) return null;

    // Clone state and run a temp dry-process of the unclosed candle
    const tempAlgo = Object.assign(Object.create(Object.getPrototypeOf(state.algo)), state.algo);
    return tempAlgo.processCandle(state.currentCandle);
  }
}
export default AruAlgoService;
