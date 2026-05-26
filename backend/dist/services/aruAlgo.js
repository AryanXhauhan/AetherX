// src/services/aruAlgo.ts
// Pure TypeScript conversion of "AruAlgo v6.7 Elite"
// Maintains internal series state and evaluates one closed candle at a time.
export class AruAlgo {
    sensitivity;
    atrPeriod;
    trendEmaPeriod;
    rsiPeriod;
    rsiOverbought;
    rsiOversold;
    adxPeriod;
    adxThreshold;
    slMultiplier;
    tpMultiplier;
    _candles = [];
    _maxLen;
    // Previous historical state references
    atrStopPrev = null;
    lastSL = NaN;
    lastTP = NaN;
    _lastSmoothedAtrStop = null;
    // Memoized mathematical indicators caching
    _emaCache = {};
    _rsiCache = {
        prevAvgGain: null,
        prevAvgLoss: null
    };
    _plusDM_rma = null;
    _minusDM_rma = null;
    _tr_rma = null;
    _dx_rma = null;
    constructor(params = {}) {
        this.sensitivity = params.sensitivity ?? 8;
        this.atrPeriod = params.atrPeriod ?? 20;
        this.trendEmaPeriod = params.trendEmaPeriod ?? 50;
        this.rsiPeriod = params.rsiPeriod ?? 14;
        this.rsiOverbought = params.rsiOverbought ?? 60;
        this.rsiOversold = params.rsiOversold ?? 40;
        this.adxPeriod = params.adxPeriod ?? 14;
        this.adxThreshold = params.adxThreshold ?? 15;
        this.slMultiplier = params.slMultiplier ?? 1.5;
        this.tpMultiplier = params.tpMultiplier ?? 2.0;
        this._maxLen = Math.max(5000, this.atrPeriod * 10);
    }
    _pushCandle(c) {
        this._candles.push(c);
        if (this._candles.length > this._maxLen) {
            this._candles.shift();
        }
    }
    _ema(period, prevEma, value) {
        const k = 2 / (period + 1);
        if (prevEma === null || prevEma === undefined) {
            return value; // Seed first value
        }
        return (value - prevEma) * k + prevEma;
    }
    _rma(period, prevRma, value) {
        if (prevRma === null || prevRma === undefined) {
            return value;
        }
        return (prevRma * (period - 1) + value) / period;
    }
    _computeATRUsingRMA() {
        const p = this.atrPeriod;
        const n = this._candles.length;
        if (n < 2)
            return null;
        if (n === 2) {
            const tr = this._trueRange(this._candles[n - 2], this._candles[n - 1]);
            this._tr_rma = tr;
            return this._tr_rma;
        }
        else {
            const last = this._candles[n - 1];
            const prev = this._candles[n - 2];
            const tr = this._trueRange(prev, last);
            this._tr_rma = this._rma(p, this._tr_rma, tr);
            return this._tr_rma;
        }
    }
    _trueRange(prev, curr) {
        const a = curr.high - curr.low;
        const b = Math.abs(curr.high - prev.close);
        const c = Math.abs(curr.low - prev.close);
        return Math.max(a, b, c);
    }
    _updateRSI() {
        const p = this.rsiPeriod;
        const n = this._candles.length;
        if (n < 2)
            return null;
        const curr = this._candles[n - 1];
        const prev = this._candles[n - 2];
        const change = curr.close - prev.close;
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);
        if (this._rsiCache.prevAvgGain === null) {
            if (n >= p + 1) {
                let sumGain = 0;
                let sumLoss = 0;
                for (let i = n - p; i < n; i++) {
                    const d = this._candles[i].close - this._candles[i - 1].close;
                    sumGain += Math.max(d, 0);
                    sumLoss += Math.max(-d, 0);
                }
                this._rsiCache.prevAvgGain = sumGain / p;
                this._rsiCache.prevAvgLoss = sumLoss / p;
            }
            else {
                return null;
            }
        }
        else {
            this._rsiCache.prevAvgGain = ((this._rsiCache.prevAvgGain * (p - 1)) + gain) / p;
            this._rsiCache.prevAvgLoss = ((this._rsiCache.prevAvgLoss * (p - 1)) + loss) / p;
        }
        const avgGain = this._rsiCache.prevAvgGain;
        const avgLoss = this._rsiCache.prevAvgLoss;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
    _updateADX() {
        const n = this._candles.length;
        const p = this.adxPeriod;
        if (n < 2)
            return null;
        const curr = this._candles[n - 1];
        const prev = this._candles[n - 2];
        const up = curr.high - prev.high;
        const down = prev.low - curr.low;
        const plusDM = (up > down && up > 0) ? up : 0;
        const minusDM = (down > up && down > 0) ? down : 0;
        const tr = this._trueRange(prev, curr);
        this._plusDM_rma = this._rma(p, this._plusDM_rma, plusDM);
        this._minusDM_rma = this._rma(p, this._minusDM_rma, minusDM);
        this._tr_rma = this._rma(p, this._tr_rma, tr);
        if (!this._tr_rma || this._tr_rma === 0) {
            return 0;
        }
        const plusDI = 100 * (this._plusDM_rma / this._tr_rma);
        const minusDI = 100 * (this._minusDM_rma / this._tr_rma);
        const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1e-9);
        this._dx_rma = this._rma(p, this._dx_rma, dx);
        return this._dx_rma;
    }
    _updateEMA(period) {
        const n = this._candles.length;
        if (n < 1)
            return null;
        const val = this._candles[n - 1].close;
        const key = `ema_${period}`;
        const prev = this._emaCache[key] ?? null;
        const ema = this._ema(period, prev, val);
        this._emaCache[key] = ema;
        return ema;
    }
    processCandle(candle) {
        const timeSec = (typeof candle.time === 'number')
            ? candle.time
            : Math.floor(Date.parse(candle.time) / 1000);
        this._pushCandle({
            time: timeSec,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
            volume: candle.volume ?? 0
        });
        const n = this._candles.length;
        if (n < 2) {
            return { ready: false };
        }
        const src = this._candles[n - 1].close;
        const atr = this._computeATRUsingRMA();
        const trendEma = this._updateEMA(this.trendEmaPeriod);
        const rsi = this._updateRSI();
        const adx = this._updateADX();
        const prevAtrStop = (this.atrStopPrev === null)
            ? this._candles[n - 2].close
            : this.atrStopPrev;
        const prevSrc = this._candles[n - 2].close;
        const srcGreaterThanPrevAtrStop = src > prevAtrStop;
        const srcLessThanPrevAtrStop = src < prevAtrStop;
        const prevSrcGreaterThanPrevAtrStop = prevSrc > prevAtrStop;
        const prevSrcLessThanPrevAtrStop = prevSrc < prevAtrStop;
        const nLoss = this.sensitivity * (atr ?? 0);
        let atrStop;
        if (srcGreaterThanPrevAtrStop && prevSrcGreaterThanPrevAtrStop) {
            atrStop = Math.max(prevAtrStop, src - nLoss);
        }
        else if (srcLessThanPrevAtrStop && prevSrcLessThanPrevAtrStop) {
            atrStop = Math.min(prevAtrStop, src + nLoss);
        }
        else if (srcGreaterThanPrevAtrStop) {
            atrStop = src - nLoss;
        }
        else {
            atrStop = src + nLoss;
        }
        this.atrStopPrev = atrStop;
        const atrStopKey = 'atrstop_5';
        const prevAtrStopEma = this._emaCache[atrStopKey] ?? null;
        const smoothedAtrStop = this._ema(5, prevAtrStopEma, atrStop);
        this._emaCache[atrStopKey] = smoothedAtrStop;
        const rsiBuyConfirm = (rsi !== null) ? (rsi < this.rsiOversold) : false;
        const rsiSellConfirm = (rsi !== null) ? (rsi > this.rsiOverbought) : false;
        let trendDirection = 0;
        if (trendEma !== null) {
            trendDirection = (src > trendEma) ? 1 : (src < trendEma ? -1 : 0);
        }
        const emaLine = src;
        const adxFilter = (adx !== null) ? (adx > this.adxThreshold) : false;
        const buyCond = (src > smoothedAtrStop)
            && (emaLine > smoothedAtrStop && (this._wasCrossOver(emaLine, smoothedAtrStop)))
            && (trendDirection === 1 || trendDirection === 0)
            && rsiBuyConfirm
            && adxFilter;
        const sellCond = (src < smoothedAtrStop)
            && (smoothedAtrStop > emaLine && (this._wasCrossOver(smoothedAtrStop, emaLine)))
            && (trendDirection === -1 || trendDirection === 0)
            && rsiSellConfirm
            && adxFilter;
        const simpleBuyCond = this._wasCrossOver(src, smoothedAtrStop);
        const simpleSellCond = this._wasCrossOver(smoothedAtrStop, src);
        const xATR = atr ?? 0;
        const slDistance = xATR * this.slMultiplier;
        const tpDistance = xATR * this.tpMultiplier;
        let primaryBuySL = NaN, primaryBuyTP = NaN, primarySellSL = NaN, primarySellTP = NaN;
        if (buyCond) {
            primaryBuySL = src - slDistance;
            primaryBuyTP = src + tpDistance;
            this.lastSL = primaryBuySL;
            this.lastTP = primaryBuyTP;
        }
        if (sellCond) {
            primarySellSL = src + slDistance;
            primarySellTP = src - tpDistance;
            this.lastSL = primarySellSL;
            this.lastTP = primarySellTP;
        }
        let simpleBuySL = NaN, simpleBuyTP = NaN, simpleSellSL = NaN, simpleSellTP = NaN;
        if (simpleBuyCond) {
            simpleBuySL = src - slDistance;
            simpleBuyTP = src + tpDistance;
            this.lastSL = simpleBuySL;
            this.lastTP = simpleBuyTP;
        }
        if (simpleSellCond) {
            simpleSellSL = src + slDistance;
            simpleSellTP = src - tpDistance;
            this.lastSL = simpleSellSL;
            this.lastTP = simpleSellTP;
        }
        const barColor = buyCond ? 'buy' : sellCond ? 'sell' : null;
        const signalLabels = [];
        if (buyCond) {
            signalLabels.push({
                type: 'primaryBuy',
                time: this._candles[n - 1].time,
                price: src,
                sl: this._round(primaryBuySL),
                tp: this._round(primaryBuyTP),
                text: `🟢 BUY\nSL: ${this._round(primaryBuySL)}\nTP: ${this._round(primaryBuyTP)}`
            });
        }
        if (sellCond) {
            signalLabels.push({
                type: 'primarySell',
                time: this._candles[n - 1].time,
                price: src,
                sl: this._round(primarySellSL),
                tp: this._round(primarySellTP),
                text: `🔴 SELL\nSL: ${this._round(primarySellSL)}\nTP: ${this._round(primarySellTP)}`
            });
        }
        if (simpleBuyCond) {
            signalLabels.push({
                type: 'simpleBuy',
                time: this._candles[n - 1].time,
                price: src,
                sl: this._round(simpleBuySL),
                tp: this._round(simpleBuyTP),
                text: `⬆️\nSL: ${this._round(simpleBuySL)}\nTP: ${this._round(simpleBuyTP)}`
            });
        }
        if (simpleSellCond) {
            signalLabels.push({
                type: 'simpleSell',
                time: this._candles[n - 1].time,
                price: src,
                sl: this._round(simpleSellSL),
                tp: this._round(simpleSellTP),
                text: `⬇️\nSL: ${this._round(simpleSellSL)}\nTP: ${this._round(simpleSellTP)}`
            });
        }
        this._lastSmoothedAtrStop = smoothedAtrStop;
        return {
            ready: true,
            time: this._candles[n - 1].time,
            close: src,
            atr: xATR,
            smoothedAtrStop,
            trendEma: trendEma ?? undefined,
            rsi,
            adx,
            buyCond,
            sellCond,
            simpleBuyCond,
            simpleSellCond,
            lastSL: Number.isFinite(this.lastSL) ? this.lastSL : null,
            lastTP: Number.isFinite(this.lastTP) ? this.lastTP : null,
            signalLabels,
            barColor
        };
    }
    _wasCrossOver(aNow, bNow) {
        const n = this._candles.length;
        if (n < 2)
            return false;
        const prevClose = this._candles[n - 2].close;
        const prevSmoothed = this._lastSmoothedAtrStop ?? bNow;
        const prevA = prevClose;
        const prevB = prevSmoothed;
        return (prevA <= prevB) && (aNow > bNow);
    }
    _round(v) {
        if (!Number.isFinite(v))
            return null;
        return Math.round(v * 100) / 100;
    }
}
export default AruAlgo;
