// src/app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useWebSockets } from '../hooks/useWebSockets';
import TVChart from '../components/TVChart';
import OrderBook from '../components/OrderBook';
import OrderForm from '../components/OrderForm';
import Positions from '../components/Positions';
import LedgerViewer, { LedgerEntry } from '../components/LedgerViewer';
import MetricsGrid from '../components/MetricsGrid';

export default function Home() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Selected Ticker State
  const [symbol, setSymbol] = useState<string>('BTCUSDT');

  // REST API States (Live Database)
  const [balances, setBalances] = useState([]);
  const [positions, setPositions] = useState([]);
  const [activeOrders, setActiveOrders] = useState([]);
  const [orderHistory, setOrderHistory] = useState([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [performance, setPerformance] = useState<any>(null);

  // Active Terminal View Tab: 'TERMINAL' | 'LEDGER_INSPECTOR'
  const [activeTab, setActiveTab] = useState<'TERMINAL' | 'LEDGER_INSPECTOR'>('TERMINAL');

  // Replay Engine States
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [replayState, setReplayState] = useState<any>({
    balances: [],
    positions: [],
    activeOrders: [],
    executions: [],
    ledgerEntries: [],
    orderBook: { bids: [], asks: [] },
    stats: null,
    indicators: null
  });

  // 1. Establish live WebSocket connections
  const { connected, tick, indicators, orderBook, executions, stats, refreshTrigger } = useWebSockets(symbol);

  // 2. Fetch authenticated session on boot
  useEffect(() => {
    checkSession();
  }, []);

  // 3. Refetch portfolio data for live sessions
  useEffect(() => {
    if (user && !isReplayMode) {
      fetchPortfolioData();
    }
  }, [user, symbol, refreshTrigger, isReplayMode]);

  const checkSession = async () => {
    try {
      const res = await fetch('http://localhost:8080/api/v1/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch (e) {
      // Not logged in
    }
  };

  const fetchPortfolioData = async () => {
    try {
      const balRes = await fetch('http://localhost:8080/api/v1/wallet/balances', { credentials: 'include' });
      if (balRes.ok) {
        const data = await balRes.json();
        setBalances(data.balances);
      }

      const posRes = await fetch('http://localhost:8080/api/v1/wallet/positions', { credentials: 'include' });
      if (posRes.ok) {
        const data = await posRes.json();
        setPositions(data.positions);
      }

      const ordRes = await fetch('http://localhost:8080/api/v1/orders', { credentials: 'include' });
      if (ordRes.ok) {
        const data = await ordRes.json();
        setActiveOrders(data.active);
        setOrderHistory(data.history);
      }

      const ledRes = await fetch('http://localhost:8080/api/v1/stats/ledger', { credentials: 'include' });
      if (ledRes.ok) {
        const data = await ledRes.json();
        setLedgerEntries(data.ledgerEntries);
      }

      const perfRes = await fetch('http://localhost:8080/api/v1/stats/performance', { credentials: 'include' });
      if (perfRes.ok) {
        const data = await perfRes.json();
        setPerformance(data.stats);
      }
    } catch (e) {
      console.error('❌ Failed to refetch database state:', e);
    }
  };

  // ── Authentication Submissions ──────────────────────────────
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    const endpoint = authMode === 'LOGIN' ? 'login' : 'register';

    try {
      const response = await fetch(`http://localhost:8080/api/v1/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failure');
      }

      if (authMode === 'REGISTER') {
        setAuthMode('LOGIN');
        setAuthError(null);
        alert('Account created and seeded with $100,000 USD! Please log in.');
      } else {
        setUser(data.user);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication request failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('http://localhost:8080/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setIsReplayMode(false);
  };

  // ── Cancel Order Action (Live REST vs Replay Escrow release) ───────
  const handleCancelOrder = async (orderId: string) => {
    if (isReplayMode) {
      // Simulated TX-RELEASE Escrow Release (restoring checking balances client-side!)
      setReplayState((prev: any) => {
        const order = prev.activeOrders.find((o: any) => o.id === orderId);
        if (!order) return prev;

        const isBuy = order.side === 'BUY';
        const currency = isBuy ? 'USD' : symbol.replace('USDT', '');
        const amount = isBuy ? order.price * order.quantity : order.quantity;

        const checking = prev.balances.find((b: any) => b.currency === currency && b.type === 'CHECKING');
        const escrow = prev.balances.find((b: any) => b.currency === currency && b.type === 'ESCROW');

        const balances = prev.balances.map((b: any) => {
          if (b.id === checking.id) {
            return { ...b, balance: (parseFloat(b.balance) + amount).toFixed(currency === 'USD' ? 2 : 4) };
          }
          if (b.id === escrow.id) {
            return { ...b, balance: (parseFloat(b.balance) - amount).toFixed(currency === 'USD' ? 2 : 4) };
          }
          return b;
        });

        const activeOrders = prev.activeOrders.filter((o: any) => o.id !== orderId);

        // Generate balanced Double-entry Legs for TX-RELEASE
        const txId = Math.random().toString(36).substr(2, 9).toUpperCase();
        const ledgerEntries = [...prev.ledgerEntries];

        ledgerEntries.unshift({
          id: `leg-r1-${txId}`,
          transactionId: `tx-r-${txId}`,
          entryType: 'DEBIT',
          amount,
          currency,
          description: `Debit escrow vault on canceled order release`,
          createdAt: new Date().toISOString(),
          accountNumber: escrow.accountNumber,
          accountType: 'ESCROW',
          reference: `TX-RELEASE-${txId}`,
          txDescription: `Release hold: Cancel LIMIT ${order.side} order on ${symbol}`
        }, {
          id: `leg-r2-${txId}`,
          transactionId: `tx-r-${txId}`,
          entryType: 'CREDIT',
          amount,
          currency,
          description: `Credit checking wallet on canceled order release`,
          createdAt: new Date().toISOString(),
          accountNumber: checking.accountNumber,
          accountType: 'CHECKING',
          reference: `TX-RELEASE-${txId}`,
          txDescription: `Release hold: Cancel LIMIT ${order.side} order on ${symbol}`
        });

        return {
          ...prev,
          balances,
          activeOrders,
          ledgerEntries
        };
      });

      return;
    }

    // Standard Live REST cancellation
    try {
      const res = await fetch(`http://localhost:8080/api/v1/orders/${orderId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        fetchPortfolioData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to cancel order');
      }
    } catch (err) {
      alert('Network error canceling order');
    }
  };

  // ── Render Authentication Gate ──────────────────────────────
  if (!user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--bg-canvas)' }}>
        <div style={{ width: '360px', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '24px' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h2 className="text-bright" style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '4px' }}>
              AETHERX CORE TERMINAL
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              Simulated Financial & Trading Infrastructure Platform
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>EMAIL ADDRESS</label>
              <input
                type="email"
                className="input-field"
                placeholder="developer@aetherx.internal"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>PASSWORD</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
              />
            </div>

            {authError && (
              <div style={{ color: 'var(--color-sell)', fontSize: '11px', padding: '6px', background: 'rgba(242, 54, 69, 0.04)', borderLeft: '3px solid var(--color-sell)', borderRadius: '2px' }}>
                ⚠️ {authError}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-buy"
              style={{ width: '100%', marginTop: '8px', padding: '10px', height: '32px' }}
              disabled={authLoading}
            >
              {authLoading ? 'ESTABLISHING SECURE HANDSHAKE...' : authMode === 'LOGIN' ? 'CONNECT TERMINAL' : 'INITIALIZE ACCOUNT & LEDGER'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '11px' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              {authMode === 'LOGIN' ? "First time using the platform?" : "Already registered?"}
            </span>{' '}
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: 'var(--color-system)', cursor: 'pointer', fontWeight: 700 }}
              onClick={() => {
                setAuthMode(authMode === 'LOGIN' ? 'REGISTER' : 'LOGIN');
                setAuthError(null);
              }}
            >
              {authMode === 'LOGIN' ? 'Initialize Ledger' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render Redesigned Institutional Terminal ─────────────────
  const basePrice = symbol === 'BTCUSDT' ? 76600.0 : symbol === 'ETHUSDT' ? 3740.0 : 165.0;
  
  // Set active price and tickers
  const spotPrice = isReplayMode
    ? (replayState.indicators?.candle?.close || basePrice)
    : (tick?.price || basePrice);

  const displayBalances = isReplayMode ? replayState.balances : balances;
  const displayPositions = isReplayMode ? replayState.positions : positions;
  const displayActiveOrders = isReplayMode ? replayState.activeOrders : activeOrders;
  const displayExecutions = isReplayMode ? replayState.executions : executions;
  const displayStats = isReplayMode ? replayState.stats : stats;
  const displayLedger = isReplayMode ? replayState.ledgerEntries : ledgerEntries;

  return (
    <div className="terminal-grid">
      
      {/* ── HEADER NAVIGATION BAR ──────────────────────────────── */}
      <header className="terminal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '13px', letterSpacing: '-0.02em' }}>
            AETHERX // CORE
          </span>
          <div style={{ height: '14px', width: '1px', background: 'var(--border-color)' }} />
          
          {/* Symbol Selectors */}
          <div style={{ display: 'flex', gap: '2px' }}>
            {['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map((sym) => (
              <button
                key={sym}
                className="btn"
                style={{
                  padding: '3px 8px',
                  fontSize: '10.5px',
                  background: symbol === sym ? '#171d24' : 'transparent',
                  borderColor: symbol === sym ? 'var(--border-hover)' : 'transparent',
                  color: symbol === sym ? 'var(--text-bright)' : 'var(--text-muted)'
                }}
                disabled={isReplayMode}
                onClick={() => setSymbol(sym)}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Dashboard Tabs Selector */}
        <div style={{ display: 'flex', gap: '1px', border: '1px solid var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
          <button
            style={{
              padding: '4px 12px',
              fontSize: '10.5px',
              fontWeight: 700,
              background: activeTab === 'TERMINAL' ? '#171d24' : 'var(--bg-panel)',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'TERMINAL' ? 'var(--text-bright)' : 'var(--text-muted)'
            }}
            onClick={() => setActiveTab('TERMINAL')}
          >
            TRADING TERMINAL
          </button>
          <button
            style={{
              padding: '4px 12px',
              fontSize: '10.5px',
              fontWeight: 700,
              background: activeTab === 'LEDGER_INSPECTOR' ? '#171d24' : 'var(--bg-panel)',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'LEDGER_INSPECTOR' ? 'var(--text-bright)' : 'var(--text-muted)'
            }}
            onClick={() => setActiveTab('LEDGER_INSPECTOR')}
          >
            LEDGER BOOK INSPECTOR
          </button>
        </div>

        {/* Connection status and Auth user profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: '10px' }} className="mono">
            {isReplayMode ? (
              <>
                <span className="ws-indicator" style={{ backgroundColor: '#ff9800' }} />
                <span style={{ color: '#ff9800', fontWeight: 700 }}>REPLAY_SANDBOX</span>
              </>
            ) : (
              <>
                <span className={`ws-indicator ${connected ? 'ws-connected' : 'ws-disconnected'}`} />
                <span style={{ color: connected ? 'var(--color-buy)' : 'var(--color-sell)', fontWeight: 700 }}>
                  {connected ? 'WS_LIVE' : 'WS_RETRY'}
                </span>
              </>
            )}
          </div>

          <div style={{ height: '14px', width: '1px', background: 'var(--border-color)' }} />
          
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }} className="mono">
            {user.email}
          </span>
          <button 
            type="button" 
            className="btn" 
            style={{ padding: '2px 6px', fontSize: '9.5px', height: '20px' }}
            onClick={handleLogout}
          >
            DISCONNECT
          </button>
        </div>
      </header>

      {/* ── LEFT HAND WORKSPACE PANEL: Order form & pending list ────── */}
      <aside style={{ borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Order Form Widget */}
        <div style={{ height: '330px', borderBottom: '1px solid var(--border-color)' }}>
          <OrderForm 
            symbol={symbol} 
            spotPrice={spotPrice} 
            onOrderSuccess={isReplayMode ? () => {} : fetchPortfolioData}
            isReplayMode={isReplayMode}
            replayState={replayState}
            setReplayState={setReplayState}
          />
        </div>
        
        {/* Pending Orders List */}
        <div className="panel" style={{ flex: 1, overflow: 'hidden' }}>
          <div className="panel-header" style={{ backgroundColor: '#0c0f13' }}>
            <span>Pending Book Orders</span>
            <span className="mono" style={{ fontSize: '9px' }}>({displayActiveOrders.length})</span>
          </div>
          <div className="panel-content" style={{ padding: '0', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr style={{ height: '20px' }}>
                  <th>Type</th>
                  <th>Side</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Size</th>
                  <th style={{ textAlign: 'center' }}>Cancel</th>
                </tr>
              </thead>
              <tbody>
                {displayActiveOrders.map((o: any) => (
                  <tr key={`ord-${o.id}`} style={{ height: '20px' }}>
                    <td className="mono" style={{ padding: '3px 6px' }}>{o.type}</td>
                    <td className={o.side === 'BUY' ? 'text-buy' : 'text-sell'} style={{ fontWeight: 700, padding: '3px 6px' }}>{o.side}</td>
                    <td style={{ textAlign: 'right', padding: '3px 6px' }} className="mono">{o.price.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', padding: '3px 6px' }} className="mono">
                      {o.filledQuantity.toFixed(2)} / {o.quantity.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '2px 0' }}>
                      <button 
                        className="btn text-sell"
                        style={{ padding: '0px 4px', fontSize: '9px', background: 'transparent', borderColor: 'var(--border-color)', height: '16px' }}
                        onClick={() => handleCancelOrder(o.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {displayActiveOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }} className="mono">
                      No active pending orders.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </aside>

      {/* ── CENTER WORKSPACE: Chart, positions, metrics/visualizer OR ledger ── */}
      <main style={{ background: 'var(--bg-canvas)', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
        {activeTab === 'TERMINAL' ? (
          <>
            {/* Synchronized Chart Container */}
            <div style={{ flex: '0 0 auto' }}>
              <TVChart 
                symbol={symbol} 
                indicators={isReplayMode ? replayState.indicators : indicators} 
                tick={isReplayMode ? null : tick}
                isReplayMode={isReplayMode}
                setIsReplayMode={setIsReplayMode}
                replayState={replayState}
                setReplayState={setReplayState}
              />
            </div>

            {/* Asset Allocation & Positions Panel */}
            <div style={{ flex: '1 1 auto' }}>
              <Positions 
                balances={displayBalances} 
                positions={displayPositions} 
              />
            </div>

            {/* Grafana Observability stats + Live topology Pipeline */}
            <div style={{ flex: '0 0 auto' }}>
              <MetricsGrid stats={displayStats} />
            </div>
          </>
        ) : (
          /* Ledger Inspector view */
          <div style={{ flex: 1 }}>
            <LedgerViewer ledgerEntries={displayLedger} />
          </div>
        )}
      </main>

      {/* ── RIGHT HAND PANEL: Order book & dynamic matches ────── */}
      <aside style={{ borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Dynamic Order Book widget */}
        <div style={{ flex: '1 1 60%', borderBottom: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <OrderBook 
            bids={isReplayMode ? replayState.orderBook.bids : orderBook.bids} 
            asks={isReplayMode ? replayState.orderBook.asks : orderBook.asks} 
            currentPrice={spotPrice} 
          />
        </div>

        {/* Live Executed Trades List */}
        <div className="panel" style={{ flex: '1 1 40%', overflow: 'hidden' }}>
          <div className="panel-header" style={{ backgroundColor: '#0c0f13' }}>
            <span>High-Speed Executions</span>
            <span className="mono" style={{ fontSize: '9px' }}>({displayExecutions.length})</span>
          </div>
          <div className="panel-content" style={{ padding: '0', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr style={{ height: '20px' }}>
                  <th>Price (USD)</th>
                  <th style={{ textAlign: 'right' }}>Size</th>
                  <th style={{ textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {displayExecutions.map((e: any, idx: number) => (
                  <tr key={`exec-${idx}`} style={{ height: '20px' }}>
                    <td className="mono text-bright" style={{ padding: '3px 6px', fontWeight: 600 }}>
                      {e.price.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '3px 6px' }} className="mono text-bright">
                      {e.quantity.toFixed(4)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--text-muted)' }} className="mono">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
                {displayExecutions.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }} className="mono">
                      Waiting for matches...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </aside>

    </div>
  );
}
