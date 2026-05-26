// src/components/TVChart.tsx
import React, { useEffect, useRef, useState } from 'react';
import { 
  createChart, 
  IChartApi, 
  CandlestickData, 
  LineData, 
  CandlestickSeries, 
  LineSeries, 
  HistogramSeries, 
  createSeriesMarkers 
} from 'lightweight-charts';

interface TVChartProps {
  symbol: string;
  indicators: any;
  tick: any;
  isReplayMode: boolean;
  setIsReplayMode: (val: boolean) => void;
  replayState: any;
  setReplayState: React.Dispatch<React.SetStateAction<any>>;
}

// ── 1. Client-Side Indicator Math Engine ───────────────────────────

const computeEMA = (candles: any[], period: number): LineData[] => {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  let prevEma = candles[0].close;
  const emaData: LineData[] = [{ time: candles[0].time, value: prevEma }];
  
  for (let i = 1; i < candles.length; i++) {
    const emaVal = candles[i].close * k + prevEma * (1 - k);
    emaData.push({ time: candles[i].time, value: emaVal });
    prevEma = emaVal;
  }
  return emaData;
};

const computeVWAP = (candles: any[]): LineData[] => {
  if (candles.length === 0) return [];
  const vwapData: LineData[] = [];
  let cumTPVol = 0;
  let cumVol = 0;
  
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1.0;
    cumTPVol += typicalPrice * vol;
    cumVol += vol;
    vwapData.push({ time: c.time, value: cumTPVol / cumVol });
  }
  return vwapData;
};

const computeATRBands = (candles: any[], period: number = 14) => {
  if (candles.length === 0) return { upper: [], lower: [], atrValues: [] };
  
  const trs: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i].high - candles[i].low;
    const b = Math.abs(candles[i].high - candles[i - 1].close);
    const c = Math.abs(candles[i].low - candles[i - 1].close);
    trs.push(Math.max(a, b, c));
  }
  
  const atrValues: number[] = [];
  let rma = trs[0];
  atrValues.push(rma);
  
  for (let i = 1; i < trs.length; i++) {
    rma = (rma * (period - 1) + trs[i]) / period;
    atrValues.push(rma);
  }
  
  const upperData: LineData[] = [];
  const lowerData: LineData[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    const atr = atrValues[i];
    upperData.push({ time: candles[i].time, value: close + 1.5 * atr });
    lowerData.push({ time: candles[i].time, value: close - 1.5 * atr });
  }
  
  return { upper: upperData, lower: lowerData, atrValues };
};

const computeRSI = (candles: any[], period: number = 14): LineData[] => {
  if (candles.length < 2) return [];
  const rsiData: LineData[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  
  let avgGain = gains[0];
  let avgLoss = losses[0];
  
  if (gains.length >= period) {
    let sumGain = 0;
    let sumLoss = 0;
    for (let i = 0; i < period; i++) {
      sumGain += gains[i];
      sumLoss += losses[i];
    }
    avgGain = sumGain / period;
    avgLoss = sumLoss / period;
  }
  
  const initialRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const initialRSI = 100 - (100 / (1 + initialRS));
  
  for (let i = 0; i < Math.min(candles.length, period + 1); i++) {
    rsiData.push({ time: candles[i].time, value: 50 });
  }
  
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsiVal = 100 - (100 / (1 + rs));
    rsiData.push({ time: candles[i + 1].time, value: rsiVal });
  }
  
  return rsiData;
};

const computeADX = (candles: any[], period: number = 14): number[] => {
  if (candles.length < 2) return Array(candles.length).fill(15);
  const adxValues: number[] = Array(candles.length).fill(15);
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const trs: number[] = [candles[0].high - candles[0].low];
  
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const up = curr.high - prev.high;
    const down = prev.low - curr.low;
    plusDM.push((up > down && up > 0) ? up : 0);
    minusDM.push((down > up && down > 0) ? down : 0);
    const a = curr.high - curr.low;
    const b = Math.abs(curr.high - prev.close);
    const c = Math.abs(curr.low - prev.close);
    trs.push(Math.max(a, b, c));
  }
  
  let pDM_rma = plusDM[0];
  let mDM_rma = minusDM[0];
  let tr_rma = trs[0];
  const dx_list: number[] = [0];
  
  for (let i = 1; i < candles.length; i++) {
    pDM_rma = (pDM_rma * (period - 1) + plusDM[i]) / period;
    mDM_rma = (mDM_rma * (period - 1) + minusDM[i]) / period;
    tr_rma = (tr_rma * (period - 1) + trs[i]) / period;
    const pDI = tr_rma === 0 ? 0 : 100 * (pDM_rma / tr_rma);
    const mDI = tr_rma === 0 ? 0 : 100 * (mDM_rma / tr_rma);
    const dx = Math.abs(pDI - mDI) / (pDI + mDI || 1e-9) * 100;
    dx_list.push(dx);
  }
  
  let dx_rma = dx_list[0];
  for (let i = 1; i < candles.length; i++) {
    dx_rma = (dx_rma * (period - 1) + dx_list[i]) / period;
    adxValues[i] = dx_rma;
  }
  return adxValues;
};

// ── 2. Historical Candle Fetches ───────────────────────────────────

const fetchBinanceHistory = async (symbol: string, timeframeSec: number): Promise<any[] | null> => {
  try {
    let binanceInterval = '1m';
    if (timeframeSec === 1800) binanceInterval = '30m';
    else if (timeframeSec === 900) binanceInterval = '15m';
    else if (timeframeSec === 300) binanceInterval = '5m';
    else binanceInterval = '1m';

    const response = await fetch(`http://localhost:8080/api/v1/market/history?symbol=${symbol}&interval=${binanceInterval}`);
    if (!response.ok) throw new Error('Market history proxy response error');
    const data = await response.json();

    return data.map((d: any) => {
      const openTimeMs = d[0];
      const open = parseFloat(d[1]);
      const high = parseFloat(d[2]);
      const low = parseFloat(d[3]);
      const close = parseFloat(d[4]);
      const volume = parseFloat(d[5] || '100.0');
      const timeSec = Math.floor(openTimeMs / 1000);

      return {
        time: timeSec,
        open,
        high,
        low,
        close,
        volume
      };
    });
  } catch (e) {
    console.warn('⚠️ Fallback to synthetic candle warming:', e);
    return null;
  }
};

// ── 3. Dynamic OrderBook Generator ───────────────────────────────

const generateSimulatedOrderBook = (centerPrice: number) => {
  const bids = [];
  const asks = [];
  
  for (let i = 1; i <= 8; i++) {
    const price = centerPrice + i * 0.05 + (Math.random() - 0.5) * 0.01;
    const volume = Math.random() * 1.8 + 0.15;
    asks.push({ price, volume });
  }
  
  for (let i = 1; i <= 8; i++) {
    const price = centerPrice - i * 0.05 + (Math.random() - 0.5) * 0.01;
    const volume = Math.random() * 1.8 + 0.15;
    bids.push({ price, volume });
  }
  
  return { bids, asks };
};

export const TVChart: React.FC<TVChartProps> = ({ 
  symbol, 
  indicators, 
  tick, 
  isReplayMode, 
  setIsReplayMode, 
  replayState, 
  setReplayState 
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  
  // Lightweight series references
  const candleSeriesRef = useRef<any | null>(null);
  const ema20SeriesRef = useRef<any | null>(null);
  const ema50SeriesRef = useRef<any | null>(null);
  const vwapSeriesRef = useRef<any | null>(null);
  const atrUpperSeriesRef = useRef<any | null>(null);
  const atrLowerSeriesRef = useRef<any | null>(null);
  const rsiSeriesRef = useRef<any | null>(null);
  const volumeSeriesRef = useRef<any | null>(null);
  
  // Dynamic tick/history references
  const activeCandleRef = useRef<CandlestickData | null>(null);
  const markersRef = useRef<any[]>([]);
  const maxTimeRef = useRef<number>(0);
  const rawHistoryRef = useRef<any[]>([]);

  // Timeframe and playback states
  const [timeframe, setTimeframe] = useState<number>(60);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  
  // Replay Core States
  const [replayIndex, setReplayIndex] = useState<number>(20);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1000); // ms per step

  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const [showIndicators, setShowIndicators] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const toggleFullscreen = () => {
    if (!chartWrapperRef.current) return;
    if (!document.fullscreenElement) {
      chartWrapperRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error('Error enabling fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Update chart layout bounds on fullscreen change
  useEffect(() => {
    if (!chartRef.current || !chartContainerRef.current) return;
    if (isFullscreen) {
      chartRef.current.applyOptions({
        width: window.innerWidth,
        height: window.innerHeight - 38
      });
    } else {
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: 440
      });
    }
  }, [isFullscreen]);

  // Toggle visible technical lines in one click
  useEffect(() => {
    const seriesList = [
      ema20SeriesRef.current,
      ema50SeriesRef.current,
      vwapSeriesRef.current,
      atrUpperSeriesRef.current,
      atrLowerSeriesRef.current,
      rsiSeriesRef.current
    ];

    seriesList.forEach(series => {
      if (series) {
        series.applyOptions({
          visible: showIndicators
        });
      }
    });

    if (candleSeriesRef.current) {
      if (showIndicators) {
        const activeCandle = isReplayMode 
          ? rawHistoryRef.current[Math.min(replayIndex, rawHistoryRef.current.length - 1)]
          : activeCandleRef.current;
        const timeLimit = activeCandle ? activeCandle.time : 0;
        const activeMarkers = isReplayMode
          ? markersRef.current.filter(m => m.time <= timeLimit)
          : markersRef.current;
        createSeriesMarkers(candleSeriesRef.current, activeMarkers);
      } else {
        createSeriesMarkers(candleSeriesRef.current, []);
      }
    }
  }, [showIndicators, isReplayMode, replayIndex]);

  // ── Candle Countdown Timer Tick Loop (Live Only) ───────────────
  useEffect(() => {
    if (isReplayMode) return;
    const updateCountdown = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const alignedTime = Math.floor(nowSec / timeframe) * timeframe;
      const nextCandleTime = alignedTime + timeframe;
      const left = Math.max(0, nextCandleTime - nowSec);
      setSecondsLeft(left);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [timeframe, isReplayMode]);

  const formatCountdown = (secs: number) => {
    const minutes = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  // ── 4. Main Chart Canvas Setup (Synchronized RSI & Volume) ───────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Create Chart Canvas with solid, matte slate styling rules
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 440,
      layout: {
        background: { color: '#101418' },
        textColor: '#909bb0',
        fontFamily: "'Inter', sans-serif",
        attributionLogo: false
      },
      grid: {
        vertLines: { color: '#1c2126' },
        horzLines: { color: '#1c2126' }
      },
      rightPriceScale: {
        borderVisible: false,
        textColor: '#909bb0'
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false
      }
    });

    chartRef.current = chart;

    // 2. Add Candlestick Series (Main)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#089981',
      downColor: '#f23645',
      borderUpColor: '#089981',
      borderDownColor: '#f23645',
      wickUpColor: '#089981',
      wickDownColor: '#f23645'
    });
    candleSeriesRef.current = candleSeries;

    // 3. Add Volumetric Histogram Series (Overlaid bottom)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(90, 101, 120, 0.08)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume'
    });
    volumeSeriesRef.current = volumeSeries;

    // 4. Add Muted Overlay Lines (EMA 20, EMA 50, VWAP, ATR bands)
    const ema20Series = chart.addSeries(LineSeries, {
      color: '#2962ff', // Muted blue
      lineWidth: 1.0,
      title: 'EMA 20'
    });
    ema20SeriesRef.current = ema20Series;

    const ema50Series = chart.addSeries(LineSeries, {
      color: '#5a6578', // Muted steel
      lineWidth: 1.0,
      title: 'EMA 50'
    });
    ema50SeriesRef.current = ema50Series;

    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#e040fb', // Muted purple
      lineWidth: 1.0,
      title: 'VWAP'
    });
    vwapSeriesRef.current = vwapSeries;

    const atrUpperSeries = chart.addSeries(LineSeries, {
      color: '#ff9800', // Dashed orange
      lineWidth: 1.0,
      lineStyle: 2,
      title: 'ATR Upper'
    });
    atrUpperSeriesRef.current = atrUpperSeries;

    const atrLowerSeries = chart.addSeries(LineSeries, {
      color: '#ff9800',
      lineWidth: 1.0,
      lineStyle: 2,
      title: 'ATR Lower'
    });
    atrLowerSeriesRef.current = atrLowerSeries;

    // 5. Add Synchronized RSI Series (Overlaid in bottom third)
    const rsiSeries = chart.addSeries(LineSeries, {
      color: '#2962ff',
      lineWidth: 1,
      title: 'RSI (14)',
      priceScaleId: 'rsi'
    });
    
    // Add professional static horizontal guidelines inside RSI scale
    rsiSeries.createPriceLine({
      price: 60,
      color: 'rgba(242, 54, 69, 0.15)',
      lineWidth: 1,
      lineStyle: 2,
      title: 'OB (60)'
    });
    
    rsiSeries.createPriceLine({
      price: 40,
      color: 'rgba(8, 153, 129, 0.15)',
      lineWidth: 1,
      lineStyle: 2,
      title: 'OS (40)'
    });
    
    rsiSeriesRef.current = rsiSeries;

    // 🎚️ Configure custom overlay scales & vertical margins
    chart.priceScale('right').applyOptions({
      scaleMargins: {
        top: 0.05,
        bottom: 0.38 // Keep bottom 38% empty for volume & RSI scales!
      }
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0
      },
      visible: false // Hide price numbers on the axis for volume
    });

    chart.priceScale('rsi').applyOptions({
      scaleMargins: {
        top: 0.65,
        bottom: 0.05
      },
      borderVisible: false
    });

    // ── 5. Seed Initial/Historical Data ──────────────────────────────
    const loadChartData = async () => {
      let candles = await fetchBinanceHistory(symbol, timeframe);

      if (!candles || candles.length === 0) {
        // Fallback synthetic warm candles
        const basePrice = symbol === 'BTCUSDT' ? 76600.0 : symbol === 'ETHUSDT' ? 3740.0 : 165.0;
        const nowSec = Math.floor(Date.now() / 1000);
        candles = [];
        let price = basePrice;
        for (let i = 120; i > 0; i--) {
          const time = nowSec - (i * timeframe);
          const change = (Math.random() - 0.5) * (price * 0.0006);
          const open = price;
          const close = price + change;
          candles.push({
            time,
            open,
            high: Math.max(open, close) + Math.random() * price * 0.0002,
            low: Math.min(open, close) - Math.random() * price * 0.0002,
            close,
            volume: Math.random() * 80 + 20
          });
          price = close;
        }
      }

      rawHistoryRef.current = candles;

      // Calculate initial indicators for entire historical set
      const ema20 = computeEMA(candles, 20);
      const ema50 = computeEMA(candles, 50);
      const vwap = computeVWAP(candles);
      const atrBands = computeATRBands(candles, 14);
      const rsi = computeRSI(candles, 14);

      // Volume histogram styling
      const volumeData = candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(8, 153, 129, 0.08)' : 'rgba(242, 54, 69, 0.08)'
      }));

      // Bind data arrays
      candleSeries.setData(candles);
      ema20Series.setData(ema20);
      ema50Series.setData(ema50);
      vwapSeries.setData(vwap);
      atrUpperSeries.setData(atrBands.upper);
      atrLowerSeries.setData(atrBands.lower);
      rsiSeries.setData(rsi);
      volumeSeries.setData(volumeData);

      if (candles.length > 0) {
        maxTimeRef.current = candles[candles.length - 1].time;
        activeCandleRef.current = { ...candles[candles.length - 1] };
      }

      // Subtle candlestick markers without text clutter
      const initialMarkers: any[] = [];
      for (let i = 30; i < candles.length; i++) {
        if (i % 28 === 0) {
          const isBuy = Math.random() > 0.5;
          initialMarkers.push({
            time: candles[i].time,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: isBuy ? '#089981' : '#f23645',
            shape: isBuy ? 'triangleUp' : 'triangleDown'
          });
        }
      }
      markersRef.current = initialMarkers;
      createSeriesMarkers(candleSeries, initialMarkers);

      // Zoom to visible view range (last 48 candles)
      setTimeout(() => {
        if (chartRef.current) {
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: (candles.length - 48) as any,
            to: (candles.length + 2) as any
          });
        }
      }, 50);
    };

    loadChartData();

    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [symbol, timeframe]);

  // ── 5. Replay Playback Control Timer Loop ────────────────────────
  useEffect(() => {
    if (!isReplayMode || !isPlaying) return;

    const interval = setInterval(() => {
      setReplayIndex(prev => {
        if (prev >= rawHistoryRef.current.length - 1) {
          setIsPlaying(false);
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, playbackSpeed);

    return () => clearInterval(interval);
  }, [isReplayMode, isPlaying, playbackSpeed]);

  // ── 6. Replay Index Slicing, Recalculations, & Mock Engine ──────────
  useEffect(() => {
    if (!isReplayMode || rawHistoryRef.current.length === 0) return;

    const index = Math.min(replayIndex, rawHistoryRef.current.length - 1);
    const sliced = rawHistoryRef.current.slice(0, index + 1);
    const activeCandle = sliced[sliced.length - 1];

    // Compute indicators on active sliced subset
    const ema20 = computeEMA(sliced, 20);
    const ema50 = computeEMA(sliced, 50);
    const vwap = computeVWAP(sliced);
    const atrBands = computeATRBands(sliced, 14);
    const rsi = computeRSI(sliced, 14);
    const adxList = computeADX(sliced, 14);

    const activeAtr = atrBands.atrValues[atrBands.atrValues.length - 1] || 10.0;
    const activeRsi = rsi.length > 0 ? rsi[rsi.length - 1].value : 50.0;
    const activeAdx = adxList[adxList.length - 1] || 15.0;

    // Update lines on Lightweight chart
    if (candleSeriesRef.current) candleSeriesRef.current.setData(sliced);
    if (ema20SeriesRef.current) ema20SeriesRef.current.setData(ema20);
    if (ema50SeriesRef.current) ema50SeriesRef.current.setData(ema50);
    if (vwapSeriesRef.current) vwapSeriesRef.current.setData(vwap);
    if (atrUpperSeriesRef.current) atrUpperSeriesRef.current.setData(atrBands.upper);
    if (atrLowerSeriesRef.current) atrLowerSeriesRef.current.setData(atrBands.lower);
    if (rsiSeriesRef.current) rsiSeriesRef.current.setData(rsi);
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(sliced.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(8, 153, 129, 0.08)' : 'rgba(242, 54, 69, 0.08)'
      })));
    }

    // Set matching signals markers
    const replayMarkers = markersRef.current.filter(m => m.time <= activeCandle.time);
    if (candleSeriesRef.current) createSeriesMarkers(candleSeriesRef.current, replayMarkers);

    // Dynamic simulated Orderbook
    const simOrderBook = generateSimulatedOrderBook(activeCandle.close);
    
    // Bid / Ask volume pressure ratio
    const bidVolSum = simOrderBook.bids.reduce((sum, b) => sum + b.volume, 0);
    const askVolSum = simOrderBook.asks.reduce((sum, a) => sum + a.volume, 0);
    const ratio = bidVolSum / askVolSum;

    // Technical calculations
    const isBullishTrend = activeCandle.close > (ema50.length > 0 ? ema50[ema50.length - 1].value : activeCandle.close);
    const volumeImbalance = activeCandle.volume > 50 ? (activeCandle.close >= activeCandle.open ? 'BULLISH IMBALANCE' : 'BEARISH IMBALANCE') : 'NEUTRAL';

    // ⚡ 7. Simulated Sandboxed Paper Matching Engine
    setReplayState((prev: any) => {
      const activeOrders = [...prev.activeOrders];
      const executions = [...prev.executions];
      const ledgerEntries = [...prev.ledgerEntries];
      const balances = [...prev.balances];
      const positions = [...prev.positions];

      const executedIndices: number[] = [];

      activeOrders.forEach((order, ordIdx) => {
        // Limit matching: check if candle's low-high range crosses limit price
        const isMatched = order.side === 'BUY'
          ? activeCandle.low <= order.price
          : activeCandle.high >= order.price;

        if (isMatched) {
          executedIndices.push(ordIdx);
          const fillPrice = order.price;
          const fillQty = order.quantity;
          const cost = fillPrice * fillQty;

          // Push execution matching item
          executions.unshift({
            symbol,
            price: fillPrice,
            quantity: fillQty,
            buyerId: order.side === 'BUY' ? 'sim-user' : 'sim-matching',
            sellerId: order.side === 'SELL' ? 'sim-user' : 'sim-matching',
            timestamp: activeCandle.time * 1000
          });

          // Debit Escrow and settle checkout wallets (Double-entry Cash & Asset legs!)
          const usdChecking = balances.find(b => b.currency === 'USD' && b.type === 'CHECKING');
          const usdEscrow = balances.find(b => b.currency === 'USD' && b.type === 'ESCROW');
          const assetChecking = balances.find(b => b.currency === symbol.replace('USDT', '') && b.type === 'CHECKING');
          const assetEscrow = balances.find(b => b.currency === symbol.replace('USDT', '') && b.type === 'ESCROW');

          const txId = Math.random().toString(36).substr(2, 9).toUpperCase();

          if (order.side === 'BUY') {
            // Settle Cash Leg: Debit USD Escrow (-), Credit counter checking
            if (usdEscrow) usdEscrow.balance = (parseFloat(usdEscrow.balance) - cost).toFixed(2);
            
            // Settle Asset Leg: Credit asset checking (+)
            if (assetChecking) assetChecking.balance = (parseFloat(assetChecking.balance) + fillQty).toFixed(4);

            // Double Entry ledger entries for Cash Leg
            ledgerEntries.unshift({
              id: `leg-c1-${txId}`,
              transactionId: `tx-c-${txId}`,
              entryType: 'DEBIT',
              amount: cost,
              currency: 'USD',
              description: `Debit USD Escrow for BTC execution`,
              createdAt: new Date(activeCandle.time * 1000).toISOString(),
              accountNumber: usdEscrow?.accountNumber || 'ACC-SIM-USD-ESCROW',
              accountType: 'ESCROW',
              reference: `TX-CASH-${txId}`,
              txDescription: `Settle Cash Leg: Trade match on ${symbol} at $${fillPrice}`
            }, {
              id: `leg-c2-${txId}`,
              transactionId: `tx-c-${txId}`,
              entryType: 'CREDIT',
              amount: cost,
              currency: 'USD',
              description: `Credit matching counterparty cash checking`,
              createdAt: new Date(activeCandle.time * 1000).toISOString(),
              accountNumber: 'ACC-SIM-COUNTERPARTY-USD',
              accountType: 'CHECKING',
              reference: `TX-CASH-${txId}`,
              txDescription: `Settle Cash Leg: Trade match on ${symbol} at $${fillPrice}`
            });

            // Double Entry ledger entries for Asset Leg
            ledgerEntries.unshift({
              id: `leg-a1-${txId}`,
              transactionId: `tx-a-${txId}`,
              entryType: 'DEBIT',
              amount: fillQty,
              currency: symbol.replace('USDT', ''),
              description: `Debit matching counterparty asset checking`,
              createdAt: new Date(activeCandle.time * 1000).toISOString(),
              accountNumber: `ACC-SIM-COUNTERPARTY-${symbol.replace('USDT', '')}`,
              accountType: 'CHECKING',
              reference: `TX-ASSET-${txId}`,
              txDescription: `Settle Asset Leg: Trade match on ${symbol} at $${fillPrice}`
            }, {
              id: `leg-a2-${txId}`,
              transactionId: `tx-a-${txId}`,
              entryType: 'CREDIT',
              amount: fillQty,
              currency: symbol.replace('USDT', ''),
              description: `Credit Buyer Checking with BTC asset`,
              createdAt: new Date(activeCandle.time * 1000).toISOString(),
              accountNumber: assetChecking?.accountNumber || `ACC-SIM-${symbol.replace('USDT', '')}-CHECKING`,
              accountType: 'CHECKING',
              reference: `TX-ASSET-${txId}`,
              txDescription: `Settle Asset Leg: Trade match on ${symbol} at $${fillPrice}`
            });

            // Update user position
            const pos = positions.find(p => p.symbol === symbol);
            if (pos) {
              const oldSize = pos.size;
              pos.size = oldSize + fillQty;
              pos.averageEntryPrice = ((oldSize * pos.averageEntryPrice) + (fillQty * fillPrice)) / pos.size;
              pos.currentPrice = activeCandle.close;
              pos.unrealizedPnL = (pos.currentPrice - pos.averageEntryPrice) * pos.size;
              pos.value = pos.size * pos.currentPrice;
            } else {
              positions.push({
                id: `pos-${symbol}`,
                symbol,
                size: fillQty,
                averageEntryPrice: fillPrice,
                currentPrice: activeCandle.close,
                unrealizedPnL: 0.0,
                value: fillQty * activeCandle.close
              });
            }

          } else {
            // Settle Asset Leg: Debit crypto Escrow (-)
            if (assetEscrow) assetEscrow.balance = (parseFloat(assetEscrow.balance) - fillQty).toFixed(4);

            // Settle Cash Leg: Credit USD checking (+)
            if (usdChecking) usdChecking.balance = (parseFloat(usdChecking.balance) + cost).toFixed(2);

            // Double Entry ledger entries for Asset Leg
            ledgerEntries.unshift({
              id: `leg-a1-${txId}`,
              transactionId: `tx-a-${txId}`,
              entryType: 'DEBIT',
              amount: fillQty,
              currency: symbol.replace('USDT', ''),
              description: `Debit crypto Escrow vault on sell`,
              createdAt: new Date(activeCandle.time * 1000).toISOString(),
              accountNumber: assetEscrow?.accountNumber || `ACC-SIM-${symbol.replace('USDT', '')}-ESCROW`,
              accountType: 'ESCROW',
              reference: `TX-ASSET-${txId}`,
              txDescription: `Settle Asset Leg: Trade match on ${symbol} at $${fillPrice}`
            }, {
              id: `leg-a2-${txId}`,
              transactionId: `tx-a-${txId}`,
              entryType: 'CREDIT',
              amount: fillQty,
              currency: symbol.replace('USDT', ''),
              description: `Credit matching counterparty asset checking`,
              createdAt: new Date(activeCandle.time * 1000).toISOString(),
              accountNumber: 'ACC-SIM-COUNTERPARTY-BTC',
              accountType: 'CHECKING',
              reference: `TX-ASSET-${txId}`,
              txDescription: `Settle Asset Leg: Trade match on ${symbol} at $${fillPrice}`
            });

            // Double Entry ledger entries for Cash Leg
            ledgerEntries.unshift({
              id: `leg-c1-${txId}`,
              transactionId: `tx-c-${txId}`,
              entryType: 'DEBIT',
              amount: cost,
              currency: 'USD',
              description: `Debit counterparty cash checking`,
              createdAt: new Date(activeCandle.time * 1000).toISOString(),
              accountNumber: 'ACC-SIM-COUNTERPARTY-USD',
              accountType: 'CHECKING',
              reference: `TX-CASH-${txId}`,
              txDescription: `Settle Cash Leg: Trade match on ${symbol} at $${fillPrice}`
            }, {
              id: `leg-c2-${txId}`,
              transactionId: `tx-c-${txId}`,
              entryType: 'CREDIT',
              amount: cost,
              currency: 'USD',
              description: `Credit Seller USD Checking with cash`,
              createdAt: new Date(activeCandle.time * 1000).toISOString(),
              accountNumber: usdChecking?.accountNumber || 'ACC-SIM-USD-CHECKING',
              accountType: 'CHECKING',
              reference: `TX-CASH-${txId}`,
              txDescription: `Settle Cash Leg: Trade match on ${symbol} at $${fillPrice}`
            });

            // Update user position (selling reduces size)
            const pos = positions.find(p => p.symbol === symbol);
            if (pos) {
              const oldSize = pos.size;
              pos.size = oldSize - fillQty;
              if (pos.size <= 0) {
                // Liquidation / position closed
                positions.splice(positions.indexOf(pos), 1);
              } else {
                pos.unrealizedPnL = (activeCandle.close - pos.averageEntryPrice) * pos.size;
                pos.value = pos.size * activeCandle.close;
              }
            }
          }
        }
      });

      // Remove filled orders
      const remainingOrders = activeOrders.filter((_, idx) => !executedIndices.includes(idx));

      // Calculate position unrealized PnL based on latest spot close
      positions.forEach(pos => {
        pos.currentPrice = activeCandle.close;
        pos.unrealizedPnL = (pos.currentPrice - pos.averageEntryPrice) * pos.size;
        pos.value = pos.size * pos.currentPrice;
      });

      // Update system metrics
      const stats = {
        tps: isPlaying ? Math.floor(Math.random() * 400 + 800) : 0,
        matchingLatencyMs: 0.0400 + Math.random() * 0.015,
        queueLag: 0,
        activeSockets: 1,
        cpuLoad: 3.5 + Math.random() * 1.5,
        memoryUsageMb: 14.8
      };

      // Mock indicator output
      const indicatorMetrics = {
        smoothedAtrStop: atrBands.lower.length > 0 ? atrBands.lower[atrBands.lower.length - 1].value : activeCandle.close - 50,
        trendEma: ema50.length > 0 ? ema50[ema50.length - 1].value : activeCandle.close,
        rsi: activeRsi,
        adx: activeAdx,
        buyCond: activeRsi < 40 && isBullishTrend,
        sellCond: activeRsi > 60 && !isBullishTrend,
        lastSL: activeCandle.close - 1.5 * activeAtr,
        lastTP: activeCandle.close + 2.0 * activeAtr,
        signalLabels: [],
        barColor: null
      };

      return {
        balances,
        positions,
        activeOrders: remainingOrders,
        executions,
        ledgerEntries,
        orderBook: simOrderBook,
        stats,
        indicators: {
          symbol,
          candle: activeCandle,
          indicators: indicatorMetrics
        }
      };
    });

  }, [isReplayMode, replayIndex]);

  // ── 8. Live Realtime Tick Socket Updates (Live Only) ──────────────
  useEffect(() => {
    if (isReplayMode || !tick || !candleSeriesRef.current) return;

    const timeSec = Math.floor(tick.timestamp / 1000);
    const alignedTime = Math.floor(timeSec / timeframe) * timeframe;

    if (alignedTime < maxTimeRef.current) return;
    maxTimeRef.current = Math.max(maxTimeRef.current, alignedTime);

    const price = tick.price;

    if (activeCandleRef.current && activeCandleRef.current.time === alignedTime) {
      const active = activeCandleRef.current;
      active.high = Math.max(active.high, price);
      active.low = Math.min(active.low, price);
      active.close = price;
      candleSeriesRef.current.update(active);
    } else {
      let openPrice = price;
      if (activeCandleRef.current) {
        openPrice = activeCandleRef.current.close;
      }
      const newCandle = {
        time: alignedTime as any,
        open: openPrice,
        high: Math.max(openPrice, price),
        low: Math.min(openPrice, price),
        close: price,
        volume: tick.quantity
      };
      activeCandleRef.current = newCandle as any;
      candleSeriesRef.current.update(newCandle);
    }
  }, [tick, timeframe, isReplayMode]);

  // ── 9. Live Indicators Socket Updates (Live Only) ──────────────────
  useEffect(() => {
    if (isReplayMode || !indicators || !candleSeriesRef.current) return;

    const candle = indicators.candle;
    const ind = indicators.indicators;
    if (!candle) return;

    const alignedTime = Math.floor(candle.time / timeframe) * timeframe;
    if (alignedTime < maxTimeRef.current) return;
    maxTimeRef.current = Math.max(maxTimeRef.current, alignedTime);

    // Live indicators calculated from backend
    if (ind.trendEma && ema50SeriesRef.current) {
      ema50SeriesRef.current.update({
        time: alignedTime as any,
        value: ind.trendEma
      });
    }

    if (ind.smoothedAtrStop && atrUpperSeriesRef.current) {
      atrUpperSeriesRef.current.update({
        time: alignedTime as any,
        value: ind.smoothedAtrStop
      });
    }

    // RSI Live overlays
    if (ind.rsi && rsiSeriesRef.current) {
      rsiSeriesRef.current.update({
        time: alignedTime as any,
        value: ind.rsi
      });
    }

    // Simple signal markers processing
    if (ind.signalLabels && ind.signalLabels.length > 0) {
      const label = ind.signalLabels[0];
      const isBuy = label.type.includes('Buy');
      
      const newMarker = {
        time: alignedTime as any,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#089981' : '#f23645',
        shape: isBuy ? 'triangleUp' : 'triangleDown'
      };

      const exists = markersRef.current.some(m => m.time === alignedTime);
      if (!exists) {
        markersRef.current.push(newMarker);
        if (markersRef.current.length > 60) {
          markersRef.current.shift();
        }
        createSeriesMarkers(candleSeriesRef.current, [...markersRef.current]);
      }
    }
  }, [indicators, timeframe, isReplayMode]);

  // ── 10. Playback Toggle Ingestion Inits ──────────────────────
  const toggleReplayMode = () => {
    if (!isReplayMode) {
      // 1. Initialize Replay Mode sandboxed states (Seeding initial checking wallets)
      const usdAsset = 'USD';
      const cryptoAsset = symbol.replace('USDT', '');
      
      setIsPlaying(false);
      setReplayIndex(20);
      setIsReplayMode(true);

      setReplayState({
        balances: [
          { id: 'sim-bal-usd', currency: usdAsset, balance: '100000.00', type: 'CHECKING', accountNumber: 'ACC-SIM-USD-CHECKING' },
          { id: 'sim-bal-usd-escrow', currency: usdAsset, balance: '0.00', type: 'ESCROW', accountNumber: 'ACC-SIM-USD-ESCROW' },
          { id: 'sim-bal-crypto', currency: cryptoAsset, balance: '0.0000', type: 'CHECKING', accountNumber: `ACC-SIM-${cryptoAsset}-CHECKING` },
          { id: 'sim-bal-crypto-escrow', currency: cryptoAsset, balance: '0.0000', type: 'ESCROW', accountNumber: `ACC-SIM-${cryptoAsset}-ESCROW` }
        ],
        positions: [],
        activeOrders: [],
        executions: [],
        ledgerEntries: [],
        orderBook: { bids: [], asks: [] },
        stats: {
          tps: 0,
          matchingLatencyMs: 0.0450,
          queueLag: 0,
          activeSockets: 1,
          cpuLoad: 2.1,
          memoryUsageMb: 12.8
        },
        indicators: null
      });

    } else {
      // Restore standard live feeds
      setIsPlaying(false);
      setIsReplayMode(false);
      setReplayState(null);
    }
  };

  // Get active indicator reference
  const currentInd = isReplayMode
    ? replayState.indicators?.indicators
    : indicators?.indicators;

  const currentCandle = isReplayMode
    ? replayState.indicators?.candle
    : indicators?.candle;

  // Calculate liquidity pressure
  let bidVolSum = 0;
  let askVolSum = 0;
  if (isReplayMode && replayState.orderBook) {
    bidVolSum = replayState.orderBook.bids.reduce((sum: number, b: any) => sum + b.volume, 0);
    askVolSum = replayState.orderBook.asks.reduce((sum: number, a: any) => sum + a.volume, 0);
  }

  const bidAskRatio = askVolSum > 0 ? (bidVolSum / askVolSum) : 1.0;

  // Calculate execution confidence
  let confidenceScore = 50;
  let biasLabel = 'NEUTRAL BIAS';
  if (currentInd) {
    const isRsiBullish = currentInd.rsi < 45;
    const isRsiBearish = currentInd.rsi > 55;
    const isAtrHigh = currentInd.atr > 45;

    if (isRsiBullish) confidenceScore += 20;
    if (isRsiBearish) confidenceScore -= 20;
    if (isAtrHigh) confidenceScore += 15;
    
    confidenceScore = Math.max(10, Math.min(98, confidenceScore));
    biasLabel = confidenceScore > 65 ? 'STRONG BULLISH ALIGNMENT' : confidenceScore < 35 ? 'STRONG BEARISH ALIGNMENT' : 'NEUTRAL NO_BIAS';
  }

  return (
    <div ref={chartWrapperRef} style={{ position: 'relative', width: '100%', backgroundColor: '#101418', borderRadius: '4px', overflow: 'hidden', border: '1px solid #1c2126', display: 'flex', flexDirection: 'column' }}>
      
      {/* 📊 Slate-Themed Timeframe & Replay Controls Selector Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #1c2126', backgroundColor: '#0c0f13' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '11px', letterSpacing: '0.04em' }}>
            {symbol.replace('USDT', ' / USDT')}
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', padding: '1px 4px', background: '#171d24', border: '1px solid #1c2126', borderRadius: '2px', fontWeight: 700 }} className="mono">
            {timeframe === 60 ? '1M' : timeframe === 300 ? '5M' : timeframe === 900 ? '15M' : '30M'}
          </span>
          
          {/* Playback mode indicators */}
          {!isReplayMode ? (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '4px', 
              padding: '1px 5px', 
              background: 'rgba(8, 153, 129, 0.05)', 
              border: '1px solid rgba(8, 153, 129, 0.15)', 
              borderRadius: '2px' 
            }}>
              <span style={{ width: '4px', height: '4px', backgroundColor: '#089981', borderRadius: '50%', display: 'inline-block' }} />
              <span style={{ fontSize: '9px', color: '#089981', fontWeight: 700, fontFamily: 'monospace' }}>
                CANDLE CLOSE: {formatCountdown(secondsLeft)}
              </span>
            </div>
          ) : (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '4px', 
              padding: '1px 5px', 
              background: 'rgba(255, 152, 0, 0.05)', 
              border: '1px solid rgba(255, 152, 0, 0.15)', 
              borderRadius: '2px' 
            }}>
              <span style={{ width: '4px', height: '4px', backgroundColor: '#ff9800', borderRadius: '50%', display: 'inline-block' }} />
              <span style={{ fontSize: '9px', color: '#ff9800', fontWeight: 700, fontFamily: 'monospace' }}>
                REPLAYING: BAR {replayIndex + 1} / 120
              </span>
            </div>
          )}
        </div>
        
        {/* Playback Controls & Mode Switches */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          
          {/* Replay Controls Panel */}
          {isReplayMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: '#07090b', padding: '2px 4px', border: '1px solid #1c2126', borderRadius: '3px' }}>
              <button 
                title="Restart Session"
                onClick={() => { setReplayIndex(20); setIsPlaying(false); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-normal)', fontSize: '10px', cursor: 'pointer', padding: '1px 3px' }}
              >
                ⏮
              </button>
              <button 
                title={isPlaying ? "Pause Playback" : "Start Playback"}
                onClick={() => setIsPlaying(!isPlaying)}
                style={{ background: 'none', border: 'none', color: '#ff9800', fontSize: '10px', cursor: 'pointer', padding: '1px 3px', fontWeight: 'bold' }}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button 
                title="Step Forward"
                onClick={() => {
                  setIsPlaying(false);
                  setReplayIndex(prev => Math.min(prev + 1, rawHistoryRef.current.length - 1));
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-normal)', fontSize: '10px', cursor: 'pointer', padding: '1px 3px' }}
              >
                ⏭
              </button>
              
              <div style={{ width: '1px', height: '10px', background: '#1c2126', margin: '0 2px' }} />
              
              <select 
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-normal)',
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  outline: 'none',
                  paddingRight: '2px'
                }}
              >
                <option value={1000} style={{ background: '#101418' }}>1x</option>
                <option value={500} style={{ background: '#101418' }}>2x</option>
                <option value={200} style={{ background: '#101418' }}>5x</option>
                <option value={100} style={{ background: '#101418' }}>10x</option>
              </select>
            </div>
          )}

          {/* Replay vs Live Toggle Button */}
          <button
            onClick={toggleReplayMode}
            style={{
              padding: '2px 6px',
              fontSize: '9px',
              fontWeight: 700,
              backgroundColor: isReplayMode ? '#ff9800' : '#171d24',
              color: isReplayMode ? '#000' : 'var(--text-bright)',
              border: '1px solid #1c2126',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            {isReplayMode ? 'DISCONNECT REPLAY' : 'REPLAY ENGINE'}
          </button>

          <div style={{ width: '1px', height: '12px', background: '#1c2126' }} />

          {/* Timeframe Selectors */}
          <div style={{ display: 'flex', gap: '2px' }}>
            {[
              { label: '1m', val: 60 },
              { label: '5m', val: 300 },
              { label: '15m', val: 900 },
              { label: '30m', val: 1800 }
            ].map((tf) => (
              <button
                key={tf.val}
                onClick={() => setTimeframe(tf.val)}
                disabled={isReplayMode}
                style={{
                  padding: '2px 5px',
                  fontSize: '9px',
                  fontWeight: 600,
                  background: timeframe === tf.val ? '#1c2126' : 'transparent',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: isReplayMode ? 'not-allowed' : 'pointer',
                  color: timeframe === tf.val ? 'var(--text-bright)' : 'var(--text-muted)',
                  opacity: isReplayMode ? 0.3 : 1
                }}
              >
                {tf.label.toUpperCase()}
              </button>
            ))}
          </div>

          <div style={{ width: '1px', height: '12px', background: '#1c2126' }} />

          {/* Hide/Show Indicators Toggle */}
          <button
            title={showIndicators ? 'Hide all indicators' : 'Show all indicators'}
            onClick={() => setShowIndicators(!showIndicators)}
            style={{
              padding: '2px 6px',
              fontSize: '9px',
              fontWeight: 700,
              backgroundColor: showIndicators ? 'transparent' : '#171d24',
              color: showIndicators ? 'var(--text-muted)' : 'var(--text-bright)',
              border: '1px solid #1c2126',
              borderRadius: '2px',
              cursor: 'pointer',
              letterSpacing: '0.03em'
            }}
          >
            {showIndicators ? 'HIDE IND.' : 'SHOW IND.'}
          </button>

          {/* Fullscreen Toggle */}
          <button
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={toggleFullscreen}
            style={{
              padding: '2px 6px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: isFullscreen ? '#171d24' : 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid #1c2126',
              borderRadius: '2px',
              cursor: 'pointer',
              lineHeight: 1
            }}
          >
            {isFullscreen ? '⛶' : '⛶'}
          </button>
        </div>
      </div>

      <div ref={chartContainerRef} style={{ width: '100%', flex: 1, borderBottom: '1px solid #1c2126' }} />

      {/* 🔮 Real-time Market Structure & Technical Analysis Engine (Floating Card — Left Side) */}
      {currentInd && (
        <div style={{
          position: 'absolute',
          top: '46px',
          left: '12px',
          zIndex: 8,
          background: 'rgba(12, 15, 19, 0.94)',
          border: '1px solid #1c2126',
          borderRadius: '4px',
          width: '185px',
          overflow: 'hidden',
          boxShadow: '0 3px 12px rgba(0,0,0,0.65)',
          fontFamily: "'Inter', sans-serif",
          pointerEvents: 'none'
        }}>
          {/* Solid Flat Muted Header */}
          <div style={{
            background: '#171d24',
            borderBottom: '1px solid #1c2126',
            padding: '5px 8px',
            fontSize: '9px',
            fontWeight: 700,
            color: 'var(--text-bright)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            letterSpacing: '0.04em'
          }}>
            <span style={{ width: '5px', height: '5px', backgroundColor: '#2962ff', borderRadius: '50%' }} />
            MARKET STRUCTURE ENGINE
          </div>
          
          {/* Dense, Clean Text Grid */}
          <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '9.5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #14191f', paddingBottom: '3px' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>TREND STRENGTH:</span>
              <span className="mono" style={{
                fontWeight: 700,
                color: currentInd.adx > 20 ? 'var(--color-buy)' : 'var(--text-normal)'
              }}>
                {currentInd.adx !== null ? `${Number(currentInd.adx).toFixed(1)} (${currentInd.adx > 20 ? 'STRONG' : 'WEAK'})` : 'N/A'}
              </span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #14191f', paddingBottom: '3px' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>VOLATILITY STATE:</span>
              <span className="mono" style={{ color: '#ff9800', fontWeight: 700 }}>
                {currentInd.lastSL ? 'EXPANSION' : 'COMPRESSION'}
              </span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #14191f', paddingBottom: '3px' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>MOMENTUM SCORE:</span>
              <span className="mono" style={{
                fontWeight: 700,
                color: currentInd.rsi > 60 ? 'var(--color-sell)' : currentInd.rsi < 40 ? 'var(--color-buy)' : 'var(--text-normal)'
              }}>
                {currentInd.rsi !== null ? `${Number(currentInd.rsi).toFixed(1)}` : 'N/A'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #14191f', paddingBottom: '3px' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>LIQUIDITY PRESSURE:</span>
              <span className="mono" style={{
                fontWeight: 700,
                color: bidAskRatio > 1.05 ? 'var(--color-buy)' : bidAskRatio < 0.95 ? 'var(--color-sell)' : 'var(--text-normal)'
              }}>
                {isReplayMode ? `${bidAskRatio.toFixed(2)}x (${bidAskRatio > 1.05 ? 'BUY' : bidAskRatio < 0.95 ? 'SELL' : 'NEUTRAL'})` : '1.02x (NEUTRAL)'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>EXECUTION CONFIDENCE:</span>
              <span className="mono" style={{ color: 'var(--text-bright)', fontWeight: 700 }}>
                {confidenceScore}%
              </span>
            </div>

            {/* Bias Banner */}
            <div style={{
              marginTop: '4px',
              padding: '3px',
              backgroundColor: confidenceScore > 65 ? 'rgba(8, 153, 129, 0.08)' : confidenceScore < 35 ? 'rgba(242, 54, 69, 0.08)' : '#171d24',
              borderRadius: '2px',
              textAlign: 'center',
              fontSize: '8px',
              fontWeight: 700,
              color: confidenceScore > 65 ? 'var(--color-buy)' : confidenceScore < 35 ? 'var(--color-sell)' : 'var(--text-normal)',
              border: `1px solid ${confidenceScore > 65 ? 'rgba(8, 153, 129, 0.15)' : confidenceScore < 35 ? 'rgba(242, 54, 69, 0.15)' : '#1c2126'}`
            }}>
              {biasLabel}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TVChart;
