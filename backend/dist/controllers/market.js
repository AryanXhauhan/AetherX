import { MarketIngestionService } from '../services/marketIngestion.js';
/**
 * Proxies historical candle kline requests from the frontend to Binance REST API
 * to prevent CORS blocks and ensure absolute price alignment between backend streams and charts.
 *
 * If Binance REST fetch fails, it automatically falls back to generating synthetic candles
 * that align perfectly with the backend's current live spot price, preventing pricing gaps.
 */
export const getMarketHistory = async (req, res) => {
    const { symbol, interval } = req.query;
    if (!symbol || !interval) {
        return res.status(400).json({ error: 'Missing symbol or interval parameter' });
    }
    const symUpper = symbol.toUpperCase();
    const intervalStr = interval;
    try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symUpper}&interval=${intervalStr}&limit=120`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (!response.ok) {
            throw new Error(`Binance API response error: ${response.status}`);
        }
        const data = await response.json();
        return res.json(data);
    }
    catch (error) {
        console.warn(`⚠️ marketHistoryProxy: Binance fetch failed for [${symUpper}], using real-time spot price to seed synthetic history.`, error.message || error);
        // Fallback: Generate realistic synthetic candles starting from the backend's current spot price
        const currentPrice = MarketIngestionService.getCurrentPrice(symUpper) ||
            (symUpper === 'BTCUSDT' ? 76650.0 : symUpper === 'ETHUSDT' ? 2090.0 : 84.0);
        const timeframeSec = intervalStr === '30m' ? 1800 : intervalStr === '15m' ? 900 : intervalStr === '5m' ? 300 : 60;
        const nowSec = Math.floor(Date.now() / 1000);
        const mockData = [];
        let price = currentPrice;
        // Generate backwards so the final candle close aligns with our current price
        for (let i = 120; i > 0; i--) {
            const openTimeMs = (nowSec - i * timeframeSec) * 1000;
            const change = (Math.random() - 0.5) * (price * 0.0006);
            const open = price - change;
            const close = price;
            const high = Math.max(open, close) + (Math.random() * price * 0.0002);
            const low = Math.min(open, close) - (Math.random() * price * 0.0002);
            // Update price for the previous candle (backwards walk)
            price = open;
            mockData.push([
                openTimeMs, // Open time
                open.toString(), // Open
                high.toString(), // High
                low.toString(), // Low
                close.toString(), // Close
                "100.0", // Volume
                openTimeMs + timeframeSec * 1000 - 1, // Close time
                "1000.0", // Quote asset volume
                100, // Number of trades
                "50.0", // Taker buy base asset volume
                "500.0", // Taker buy quote asset volume
                "0"
            ]);
        }
        return res.json(mockData);
    }
};
