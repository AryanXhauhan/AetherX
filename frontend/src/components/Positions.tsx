// src/components/Positions.tsx
import React from 'react';

interface Balance {
  id: string;
  currency: string;
  balance: string;
  type: 'CHECKING' | 'ESCROW';
  accountNumber: string;
}

interface Position {
  id: string;
  symbol: string;
  size: number;
  averageEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  value: number;
}

interface PositionsProps {
  balances: Balance[];
  positions: Position[];
}

export const Positions: React.FC<PositionsProps> = ({ balances, positions }) => {
  
  // Group balances by currency for easier reading
  const groupedBalances = balances.reduce<Record<string, { checking: number; escrow: number }>>((acc, val) => {
    const cur = val.currency;
    if (!acc[cur]) {
      acc[cur] = { checking: 0, escrow: 0 };
    }
    const balNum = parseFloat(val.balance);
    if (val.type === 'CHECKING') {
      acc[cur].checking = balNum;
    } else {
      acc[cur].escrow = balNum;
    }
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      {/* Portfolio Balance Sheet */}
      <div className="panel" style={{ flex: '0 0 auto' }}>
        <div className="panel-header">
          <span>Asset Inventory</span>
          <span style={{ fontSize: '10px' }}>USD / CRYPTO</span>
        </div>
        <div className="panel-content" style={{ padding: '0' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th style={{ textAlign: 'right' }}>Free Balance</th>
                <th style={{ textAlign: 'right' }}>Locked Escrow</th>
                <th style={{ textAlign: 'right' }}>Total Portfolio</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedBalances).map(([currency, bal]) => {
                const total = bal.checking + bal.escrow;
                return (
                  <tr key={`bal-${currency}`}>
                    <td style={{ fontWeight: 600 }} className="text-bright">{currency}</td>
                    <td style={{ textAlign: 'right' }} className="mono">{bal.checking.toFixed(currency === 'USD' ? 2 : 4)}</td>
                    <td style={{ textAlign: 'right', color: bal.escrow > 0 ? 'var(--color-system)' : 'inherit' }} className="mono">
                      {bal.escrow.toFixed(currency === 'USD' ? 2 : 4)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }} className="mono text-bright">
                      {total.toFixed(currency === 'USD' ? 2 : 4)}
                    </td>
                  </tr>
                );
              })}
              {Object.keys(groupedBalances).length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
                    No balances found. Please sign up or log in.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Position Ledger */}
      <div className="panel" style={{ flex: '1 1 auto' }}>
        <div className="panel-header">
          <span>Active Trading Positions</span>
          <span style={{ fontSize: '10px' }}>REALTIME EVALUATION</span>
        </div>
        <div className="panel-content" style={{ padding: '0' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th style={{ textAlign: 'right' }}>Size</th>
                <th style={{ textAlign: 'right' }}>Entry Price</th>
                <th style={{ textAlign: 'right' }}>Current Spot</th>
                <th style={{ textAlign: 'right' }}>Unrealized PnL</th>
                <th style={{ textAlign: 'right' }}>Valuation</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const isLong = pos.size > 0;
                const pnlClass = pos.unrealizedPnL >= 0 ? 'text-buy' : 'text-sell';
                const pnlSign = pos.unrealizedPnL >= 0 ? '+' : '';

                return (
                  <tr key={`pos-${pos.symbol}`}>
                    <td style={{ fontWeight: 600 }} className="text-bright">{pos.symbol}</td>
                    <td style={{ fontWeight: 600 }} className={isLong ? 'text-buy' : 'text-sell'}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono text-bright">
                      {Math.abs(pos.size).toFixed(4)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {pos.averageEntryPrice.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {pos.currentPrice.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }} className={`mono ${pnlClass}`}>
                      {pnlSign}{pos.unrealizedPnL.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {pos.value.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
              {positions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    No active trading positions. Submit BUY or SELL orders to open a trade.
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
export default Positions;
