// src/components/OrderBook.tsx
import React from 'react';

interface Level {
  price: number;
  volume: number;
}

interface OrderBookProps {
  bids: Level[];
  asks: Level[];
  currentPrice: number;
}

export const OrderBook: React.FC<OrderBookProps> = ({ bids, asks, currentPrice }) => {
  // 1. Calculate cumulative volumes for TradingView/Binance Pro styled depth bars
  const asksWithCumulative = asks
    .map((level, i) => {
      const sum = asks.slice(0, i + 1).reduce((s, l) => s + l.volume, 0);
      return { ...level, cumulative: sum };
    })
    .reverse() // Sort highest price top for asks depth chart
    .slice(-10); // Keep top 10 closest asks

  const bidsWithCumulative = bids
    .map((level, i) => {
      const sum = bids.slice(0, i + 1).reduce((s, l) => s + l.volume, 0);
      return { ...level, cumulative: sum };
    })
    .slice(0, 10); // Keep top 10 closest bids

  const maxCumulative = Math.max(
    asksWithCumulative.length > 0 ? asksWithCumulative[0].cumulative : 1,
    bidsWithCumulative.length > 0 ? bidsWithCumulative[bidsWithCumulative.length - 1].cumulative : 1
  );

  // Calculate live spread size metrics
  const bestBid = bids.length > 0 ? bids[0].price : 0;
  const bestAsk = asks.length > 0 ? asks[0].price : 0;
  
  const spreadUsd = (bestAsk > 0 && bestBid > 0) ? Math.max(0, bestAsk - bestBid) : 0.01;
  const spreadPercent = bestBid > 0 ? (spreadUsd / bestBid) * 100 : 0.0001;

  // Calculate liquidity pressure ratio
  const totalBidVol = bids.slice(0, 10).reduce((sum, b) => sum + b.volume, 0);
  const totalAskVol = asks.slice(0, 10).reduce((sum, a) => sum + a.volume, 0);
  const pressureRatio = totalAskVol > 0 ? (totalBidVol / totalAskVol) : 1.0;
  
  const pressureLabel = pressureRatio > 1.05 
    ? 'BID PRESSURE' 
    : pressureRatio < 0.95 
      ? 'ASK PRESSURE' 
      : 'BALANCED';

  return (
    <div className="panel" style={{ height: '100%' }}>
      {/* Dense Professional Panel Header */}
      <div className="panel-header" style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: '#0c0f13' }}>
        <span>Realtime Orderbook Depth</span>
        <div style={{ display: 'flex', gap: '6px', fontSize: '9px' }}>
          <span className="mono" style={{ color: 'var(--text-muted)' }}>USD</span>
          <span style={{ color: '#1c2126' }}>|</span>
          <span className={pressureRatio > 1.05 ? 'text-buy' : pressureRatio < 0.95 ? 'text-sell' : 'text-bright'} style={{ fontWeight: 700 }}>
            {pressureRatio.toFixed(2)}x {pressureLabel}
          </span>
        </div>
      </div>

      <div className="panel-content" style={{ padding: '2px', display: 'flex', flexDirection: 'column', height: 'calc(100% - 24px)', overflow: 'hidden' }}>
        
        {/* Asks (Sells) Block */}
        <div style={{ flex: '1 1 50%', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', height: '18px' }}>
                <th style={{ textAlign: 'left', fontSize: '9px', padding: '2px 4px' }}>Price</th>
                <th style={{ textAlign: 'right', fontSize: '9px', padding: '2px 4px' }}>Size</th>
                <th style={{ textAlign: 'right', fontSize: '9px', padding: '2px 4px' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {asksWithCumulative.map((level, i) => {
                const percentage = Math.min(100, (level.cumulative / maxCumulative) * 100);
                return (
                  <tr 
                    key={`ask-${i}`} 
                    style={{ 
                      height: '16px',
                      position: 'relative',
                      background: `linear-gradient(to left, var(--color-sell-muted) ${percentage}%, transparent ${percentage}%)`
                    }}
                  >
                    <td className="text-sell mono" style={{ padding: '2px 4px', fontWeight: 600 }}>
                      {level.price.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '2px 4px' }} className="mono text-bright">
                      {level.volume.toFixed(4)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '2px 4px', color: 'var(--text-muted)' }} className="mono">
                      {level.cumulative.toFixed(4)}
                    </td>
                  </tr>
                );
              })}
              {asksWithCumulative.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted)' }}>
                    No resting ask depth
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Dynamic Spread & Mid-Market Pricing Monitor */}
        <div 
          style={{ 
            borderTop: '1px solid var(--border-color)', 
            borderBottom: '1px solid var(--border-color)',
            margin: '4px 0',
            padding: '4px 8px',
            backgroundColor: '#0c0f13',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            height: '24px'
          }}
        >
          <span 
            className="mono" 
            style={{ 
              fontWeight: 700, 
              fontSize: '13px',
              color: bestBid > 0 && currentPrice >= bestBid ? 'var(--color-buy)' : 'var(--color-sell)'
            }}
          >
            {currentPrice > 0 ? currentPrice.toFixed(2) : '---.--'}
          </span>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '9px', lineHeight: '1.1' }}>
            <span className="mono text-bright" style={{ fontWeight: 600 }}>
              Spread: {spreadUsd.toFixed(2)}
            </span>
            <span className="mono text-muted">
              {spreadPercent.toFixed(4)}% ({Math.round(spreadPercent * 100)} bps)
            </span>
          </div>
        </div>

        {/* Bids (Buys) Block */}
        <div style={{ flex: '1 1 50%', overflow: 'hidden' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <tbody>
              {bidsWithCumulative.map((level, i) => {
                const percentage = Math.min(100, (level.cumulative / maxCumulative) * 100);
                return (
                  <tr 
                    key={`bid-${i}`} 
                    style={{ 
                      height: '16px',
                      position: 'relative',
                      background: `linear-gradient(to left, var(--color-buy-muted) ${percentage}%, transparent ${percentage}%)`
                    }}
                  >
                    <td className="text-buy mono" style={{ padding: '2px 4px', fontWeight: 600 }}>
                      {level.price.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '2px 4px' }} className="mono text-bright">
                      {level.volume.toFixed(4)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '2px 4px', color: 'var(--text-muted)' }} className="mono">
                      {level.cumulative.toFixed(4)}
                    </td>
                  </tr>
                );
              })}
              {bidsWithCumulative.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted)' }}>
                    No resting bid depth
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
};

export default OrderBook;
