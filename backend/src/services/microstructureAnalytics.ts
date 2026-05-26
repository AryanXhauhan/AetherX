// src/services/microstructureAnalytics.ts
// Real-time market microstructure metrics computed on every tick and orderbook update.
// Positions all analytics as decision-support tools, NOT predictive signals.
//
// Metrics computed:
//   - Bid-ask spread (absolute + basis points)
//   - Bid-ask imbalance (volume-weighted)
//   - Order flow pressure (composite directional metric)
//   - Market depth ratio (bid depth vs ask depth)
//   - Market impact estimate (slippage for a reference order size)
//   - Volatility state (expansion / compression vs ATR baseline)
//   - Liquidity score (0-100 composite)

import { EventBus } from './eventBus.js';
import { ServiceRegistry } from './serviceRegistry.js';

export interface SpreadMetrics {
  absolute: number;      // Best ask - best bid
  bps: number;           // (absolute / mid_price) * 10_000
  midPrice: number;
  bestBid: number;
  bestAsk: number;
}

export interface DepthMetrics {
  bidDepthTotal: number;    // Total volume across all bid levels (top 10)
  askDepthTotal: number;    // Total volume across all ask levels (top 10)
  depthRatio: number;       // bidDepth / askDepth — >1 means more bid pressure
  bidDepth5: number;        // Bid depth within 5 levels
  askDepth5: number;
}

export interface OrderFlowMetrics {
  imbalance: number;        // (bidVol - askVol) / (bidVol + askVol) — range: [-1, +1]
  pressure: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  pressureScore: number;    // 0-100 composite score (50 = neutral)
}

export interface MarketImpactEstimate {
  buyImpactBps: number;     // Estimated slippage for a 0.5 BTC equivalent market buy
  sellImpactBps: number;    // Estimated slippage for a 0.5 BTC equivalent market sell
  effectiveLiquidityUsd: number; // USD depth within 10bps of mid
}

export interface MicrostructureSnapshot {
  symbol: string;
  timestamp: number;
  spread: SpreadMetrics;
  depth: DepthMetrics;
  orderFlow: OrderFlowMetrics;
  impact: MarketImpactEstimate;
  liquidityScore: number;    // 0-100 composite score
  volatilityState: 'EXPANSION' | 'COMPRESSION' | 'NEUTRAL';
}

interface OrderBookLevel {
  price: number;
  volume: number;
}

export class MicrostructureAnalytics {
  // Rolling ATR history for volatility state detection (per symbol)
  private static atrHistory: Map<string, number[]> = new Map();
  private static latestSnapshots: Map<string, MicrostructureSnapshot> = new Map();

  /**
   * Compute all microstructure metrics from the current tick and order book state.
   * Called on every market tick from the ingestion pipeline.
   */
  public static compute(
    symbol: string,
    tickPrice: number,
    bids: OrderBookLevel[],
    asks: OrderBookLevel[],
    currentAtr?: number
  ): MicrostructureSnapshot {

    const spread = this.computeSpread(bids, asks, tickPrice);
    const depth = this.computeDepth(bids, asks);
    const orderFlow = this.computeOrderFlow(bids, asks);
    const impact = this.computeMarketImpact(bids, asks, spread.midPrice);
    const liquidityScore = this.computeLiquidityScore(spread, depth, impact);
    const volatilityState = this.computeVolatilityState(symbol, currentAtr);

    const snapshot: MicrostructureSnapshot = {
      symbol,
      timestamp: Date.now(),
      spread,
      depth,
      orderFlow,
      impact,
      liquidityScore,
      volatilityState
    };

    this.latestSnapshots.set(symbol, snapshot);
    return snapshot;
  }

  /**
   * Publish computed snapshot to the EventBus for WebSocket broadcast.
   */
  public static async publish(snapshot: MicrostructureSnapshot): Promise<void> {
    try {
      await EventBus.publish(`market.microstructure.${snapshot.symbol.toLowerCase()}`, snapshot);
    } catch {
      // Non-critical: microstructure publish failures are acceptable
    }
  }

  /**
   * Returns the latest snapshot for a symbol (for initial WS subscription data).
   */
  public static getLatest(symbol: string): MicrostructureSnapshot | null {
    return this.latestSnapshots.get(symbol.toUpperCase()) || null;
  }

  // ── Private computation methods ──────────────────────────

  private static computeSpread(
    bids: OrderBookLevel[],
    asks: OrderBookLevel[],
    tickPrice: number
  ): SpreadMetrics {
    const bestBid = bids.length > 0 ? bids[0].price : tickPrice * 0.9999;
    const bestAsk = asks.length > 0 ? asks[0].price : tickPrice * 1.0001;
    const midPrice = (bestBid + bestAsk) / 2;
    const absolute = bestAsk - bestBid;
    const bps = midPrice > 0 ? (absolute / midPrice) * 10_000 : 0;

    return {
      absolute: parseFloat(absolute.toFixed(2)),
      bps: parseFloat(bps.toFixed(3)),
      midPrice: parseFloat(midPrice.toFixed(2)),
      bestBid: parseFloat(bestBid.toFixed(2)),
      bestAsk: parseFloat(bestAsk.toFixed(2))
    };
  }

  private static computeDepth(
    bids: OrderBookLevel[],
    asks: OrderBookLevel[]
  ): DepthMetrics {
    const top10Bids = bids.slice(0, 10);
    const top10Asks = asks.slice(0, 10);
    const top5Bids = bids.slice(0, 5);
    const top5Asks = asks.slice(0, 5);

    const bidDepthTotal = top10Bids.reduce((s, l) => s + l.volume, 0);
    const askDepthTotal = top10Asks.reduce((s, l) => s + l.volume, 0);
    const bidDepth5 = top5Bids.reduce((s, l) => s + l.volume, 0);
    const askDepth5 = top5Asks.reduce((s, l) => s + l.volume, 0);

    const depthRatio = askDepthTotal > 0
      ? parseFloat((bidDepthTotal / askDepthTotal).toFixed(3))
      : 1.0;

    return {
      bidDepthTotal: parseFloat(bidDepthTotal.toFixed(4)),
      askDepthTotal: parseFloat(askDepthTotal.toFixed(4)),
      depthRatio,
      bidDepth5: parseFloat(bidDepth5.toFixed(4)),
      askDepth5: parseFloat(askDepth5.toFixed(4))
    };
  }

  private static computeOrderFlow(
    bids: OrderBookLevel[],
    asks: OrderBookLevel[]
  ): OrderFlowMetrics {
    const bidVol = bids.slice(0, 5).reduce((s, l) => s + l.volume, 0);
    const askVol = asks.slice(0, 5).reduce((s, l) => s + l.volume, 0);
    const total = bidVol + askVol;

    const imbalance = total > 0
      ? parseFloat(((bidVol - askVol) / total).toFixed(4))
      : 0;

    // Pressure thresholds (empirically tuned)
    let pressure: OrderFlowMetrics['pressure'];
    if (imbalance > 0.40)       pressure = 'STRONG_BUY';
    else if (imbalance > 0.15)  pressure = 'BUY';
    else if (imbalance < -0.40) pressure = 'STRONG_SELL';
    else if (imbalance < -0.15) pressure = 'SELL';
    else                         pressure = 'NEUTRAL';

    // Normalize to 0-100 (50 = neutral)
    const pressureScore = Math.round(50 + imbalance * 50);

    return { imbalance, pressure, pressureScore };
  }

  private static computeMarketImpact(
    bids: OrderBookLevel[],
    asks: OrderBookLevel[],
    midPrice: number
  ): MarketImpactEstimate {
    // Reference order size: 0.5 units of base asset
    const referenceSize = 0.5;

    const estimateImpact = (levels: OrderBookLevel[], size: number, side: 'buy' | 'sell'): number => {
      let remaining = size;
      let totalCost = 0;
      let filledSize = 0;

      for (const level of levels) {
        if (remaining <= 0) break;
        const fill = Math.min(remaining, level.volume);
        totalCost += fill * level.price;
        filledSize += fill;
        remaining -= fill;
      }

      if (filledSize === 0) return 100; // No liquidity — maximum impact
      const avgFillPrice = totalCost / filledSize;
      if (midPrice === 0) return 0;

      const impact = Math.abs(avgFillPrice - midPrice) / midPrice * 10_000;
      return parseFloat(impact.toFixed(2));
    };

    // Compute effective liquidity within 10bps of mid
    const tenBps = midPrice * 0.001;
    const bidLiquidityNear = bids
      .filter(l => midPrice - l.price <= tenBps)
      .reduce((s, l) => s + l.volume * l.price, 0);
    const askLiquidityNear = asks
      .filter(l => l.price - midPrice <= tenBps)
      .reduce((s, l) => s + l.volume * l.price, 0);

    return {
      buyImpactBps: estimateImpact(asks, referenceSize, 'buy'),
      sellImpactBps: estimateImpact(bids, referenceSize, 'sell'),
      effectiveLiquidityUsd: parseFloat((bidLiquidityNear + askLiquidityNear).toFixed(2))
    };
  }

  private static computeLiquidityScore(
    spread: SpreadMetrics,
    depth: DepthMetrics,
    impact: MarketImpactEstimate
  ): number {
    // Spread component (0-40 points): tighter spread = higher score
    // BTC USDT typically 0.5-2bps, so normalize around 2bps
    const spreadScore = Math.max(0, 40 - spread.bps * 10);

    // Depth component (0-40 points): more depth = higher score
    const totalDepth = depth.bidDepthTotal + depth.askDepthTotal;
    const depthScore = Math.min(40, totalDepth * 4); // ~10 BTC depth = max score

    // Impact component (0-20 points): less impact = higher score
    const avgImpact = (impact.buyImpactBps + impact.sellImpactBps) / 2;
    const impactScore = Math.max(0, 20 - avgImpact * 2);

    return Math.round(Math.min(100, spreadScore + depthScore + impactScore));
  }

  private static computeVolatilityState(
    symbol: string,
    currentAtr?: number
  ): 'EXPANSION' | 'COMPRESSION' | 'NEUTRAL' {
    if (!currentAtr) return 'NEUTRAL';

    if (!this.atrHistory.has(symbol)) {
      this.atrHistory.set(symbol, []);
    }

    const history = this.atrHistory.get(symbol)!;
    history.push(currentAtr);
    if (history.length > 20) history.shift();

    if (history.length < 5) return 'NEUTRAL';

    const meanAtr = history.reduce((s, v) => s + v, 0) / history.length;
    const zScore = meanAtr > 0 ? (currentAtr - meanAtr) / meanAtr : 0;

    if (zScore > 0.25)       return 'EXPANSION';
    else if (zScore < -0.25) return 'COMPRESSION';
    else                     return 'NEUTRAL';
  }
}

export default MicrostructureAnalytics;
