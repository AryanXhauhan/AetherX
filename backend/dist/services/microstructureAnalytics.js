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
export class MicrostructureAnalytics {
    // Rolling ATR history for volatility state detection (per symbol)
    static atrHistory = new Map();
    static latestSnapshots = new Map();
    /**
     * Compute all microstructure metrics from the current tick and order book state.
     * Called on every market tick from the ingestion pipeline.
     */
    static compute(symbol, tickPrice, bids, asks, currentAtr) {
        const spread = this.computeSpread(bids, asks, tickPrice);
        const depth = this.computeDepth(bids, asks);
        const orderFlow = this.computeOrderFlow(bids, asks);
        const impact = this.computeMarketImpact(bids, asks, spread.midPrice);
        const liquidityScore = this.computeLiquidityScore(spread, depth, impact);
        const volatilityState = this.computeVolatilityState(symbol, currentAtr);
        const snapshot = {
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
    static async publish(snapshot) {
        try {
            await EventBus.publish(`market.microstructure.${snapshot.symbol.toLowerCase()}`, snapshot);
        }
        catch {
            // Non-critical: microstructure publish failures are acceptable
        }
    }
    /**
     * Returns the latest snapshot for a symbol (for initial WS subscription data).
     */
    static getLatest(symbol) {
        return this.latestSnapshots.get(symbol.toUpperCase()) || null;
    }
    // ── Private computation methods ──────────────────────────
    static computeSpread(bids, asks, tickPrice) {
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
    static computeDepth(bids, asks) {
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
    static computeOrderFlow(bids, asks) {
        const bidVol = bids.slice(0, 5).reduce((s, l) => s + l.volume, 0);
        const askVol = asks.slice(0, 5).reduce((s, l) => s + l.volume, 0);
        const total = bidVol + askVol;
        const imbalance = total > 0
            ? parseFloat(((bidVol - askVol) / total).toFixed(4))
            : 0;
        // Pressure thresholds (empirically tuned)
        let pressure;
        if (imbalance > 0.40)
            pressure = 'STRONG_BUY';
        else if (imbalance > 0.15)
            pressure = 'BUY';
        else if (imbalance < -0.40)
            pressure = 'STRONG_SELL';
        else if (imbalance < -0.15)
            pressure = 'SELL';
        else
            pressure = 'NEUTRAL';
        // Normalize to 0-100 (50 = neutral)
        const pressureScore = Math.round(50 + imbalance * 50);
        return { imbalance, pressure, pressureScore };
    }
    static computeMarketImpact(bids, asks, midPrice) {
        // Reference order size: 0.5 units of base asset
        const referenceSize = 0.5;
        const estimateImpact = (levels, size, side) => {
            let remaining = size;
            let totalCost = 0;
            let filledSize = 0;
            for (const level of levels) {
                if (remaining <= 0)
                    break;
                const fill = Math.min(remaining, level.volume);
                totalCost += fill * level.price;
                filledSize += fill;
                remaining -= fill;
            }
            if (filledSize === 0)
                return 100; // No liquidity — maximum impact
            const avgFillPrice = totalCost / filledSize;
            if (midPrice === 0)
                return 0;
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
    static computeLiquidityScore(spread, depth, impact) {
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
    static computeVolatilityState(symbol, currentAtr) {
        if (!currentAtr)
            return 'NEUTRAL';
        if (!this.atrHistory.has(symbol)) {
            this.atrHistory.set(symbol, []);
        }
        const history = this.atrHistory.get(symbol);
        history.push(currentAtr);
        if (history.length > 20)
            history.shift();
        if (history.length < 5)
            return 'NEUTRAL';
        const meanAtr = history.reduce((s, v) => s + v, 0) / history.length;
        const zScore = meanAtr > 0 ? (currentAtr - meanAtr) / meanAtr : 0;
        if (zScore > 0.25)
            return 'EXPANSION';
        else if (zScore < -0.25)
            return 'COMPRESSION';
        else
            return 'NEUTRAL';
    }
}
export default MicrostructureAnalytics;
