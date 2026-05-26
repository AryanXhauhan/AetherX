// src/components/OrderForm.tsx
import React, { useState, useEffect } from 'react';

interface OrderFormProps {
  symbol: string;
  spotPrice: number;
  onOrderSuccess: () => void;
  isReplayMode?: boolean;
}

export const OrderForm: React.FC<OrderFormProps> = ({ 
  symbol, 
  spotPrice, 
  onOrderSuccess,
  isReplayMode = false
}) => {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'LIMIT' | 'MARKET' | 'STOP'>('LIMIT');
  const [price, setPrice] = useState<string>('');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  
  // Advanced Settings
  const [timeInForce, setTimeInForce] = useState<'GTC' | 'IOC' | 'FOK'>('GTC');
  const [postOnly, setPostOnly] = useState(false);
  const [useBracket, setUseBracket] = useState(false);
  const [tpPrice, setTpPrice] = useState<string>('');
  const [slPrice, setSlPrice] = useState<string>('');
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Prefill price field with spot price on load or symbol transition
  useEffect(() => {
    if (spotPrice > 0 && type === 'LIMIT' && !price) {
      setPrice(spotPrice.toFixed(2));
    }
  }, [symbol, spotPrice, type]);

  const estimatedTotal = type === 'LIMIT' 
    ? (parseFloat(price || '0') * parseFloat(quantity || '0')).toFixed(2)
    : (spotPrice * parseFloat(quantity || '0')).toFixed(2);
    
  // Estimate margin assuming 10x leverage for derivatives simulation
  const marginRequired = (parseFloat(estimatedTotal) / 10).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const numQty = parseFloat(quantity);
    const numPrice = type === 'MARKET' ? spotPrice : parseFloat(price);

    if (isNaN(numQty) || numQty <= 0) {
      setError('Please input a valid quantity');
      return;
    }
    if ((type === 'LIMIT' || type === 'STOP') && (isNaN(numPrice) || numPrice <= 0)) {
      setError('Please input a valid price');
      return;
    }
    if (type === 'STOP' && (isNaN(parseFloat(stopPrice)) || parseFloat(stopPrice) <= 0)) {
      setError('Please input a valid stop trigger price');
      return;
    }

    const payload: any = {
      symbol,
      side,
      type,
      price: numPrice.toString(),
      quantity: numQty.toString(),
      timeInForce: postOnly ? 'GTC' : timeInForce,
    };
    
    if (type === 'STOP') {
      payload.stopPrice = stopPrice;
    }

    if (useBracket) {
      payload.linkedOrders = {};
      if (tpPrice) payload.linkedOrders.takeProfit = { price: parseFloat(tpPrice), quantity: numQty };
      if (slPrice) payload.linkedOrders.stopLoss = { stopPrice: parseFloat(slPrice), quantity: numQty };
    }

    setLoading(true);

    try {
      const response = await fetch('http://localhost:8080/api/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to place order');
      }

      setSuccessMsg(`Order Intent Placed [${type}]`);
      setQuantity('');
      setUseBracket(false);
      onOrderSuccess(); 
    } catch (err: any) {
      setError(err.message || 'Network error occurred');
    } finally {
      setLoading(false);
      setTimeout(() => setSuccessMsg(null), 3000);
    }
  };

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ backgroundColor: '#0a0d10' }}>
        <span>Place Order</span>
        <span className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
          {isReplayMode ? `[SIM] ${symbol}` : symbol}
        </span>
      </div>

      <div className="panel-content" style={{ flex: 1, overflowY: 'auto' }}>
        {/* BUY/SELL Toggle Buttons */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          <button 
            type="button"
            className="btn"
            style={{ 
              flex: 1, 
              backgroundColor: side === 'BUY' ? 'rgba(8, 153, 129, 0.15)' : 'var(--bg-input)',
              color: side === 'BUY' ? 'var(--color-buy)' : 'var(--text-muted)',
              border: `1px solid ${side === 'BUY' ? 'var(--color-buy)' : 'var(--border-color)'}`,
              height: '28px',
              fontWeight: 700
            }}
            onClick={() => setSide('BUY')}
          >
            BUY / LONG
          </button>
          <button 
            type="button"
            className="btn"
            style={{ 
              flex: 1, 
              backgroundColor: side === 'SELL' ? 'rgba(242, 54, 69, 0.15)' : 'var(--bg-input)',
              color: side === 'SELL' ? 'var(--color-sell)' : 'var(--text-muted)',
              border: `1px solid ${side === 'SELL' ? 'var(--color-sell)' : 'var(--border-color)'}`,
              height: '28px',
              fontWeight: 700
            }}
            onClick={() => setSide('SELL')}
          >
            SELL / SHORT
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Order Type Toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
            {['LIMIT', 'MARKET', 'STOP'].map((t) => (
              <button
                key={t}
                type="button"
                style={{
                  flex: 1, padding: '4px', border: 'none', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                  background: type === t ? '#1c2126' : 'var(--bg-input)',
                  color: type === t ? 'var(--text-bright)' : 'var(--text-muted)'
                }}
                onClick={() => setType(t as any)}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Trigger Price */}
          {type === 'STOP' && (
            <div>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px', fontWeight: 700 }}>TRIGGER PRICE</label>
              <input
                type="number"
                step="0.01"
                className="input-field mono"
                placeholder="0.00"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                required
              />
            </div>
          )}

          {/* Price Field */}
          {type !== 'MARKET' && (
            <div>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px', fontWeight: 700 }}>PRICE (USD)</label>
              <input
                type="number"
                step="0.01"
                className="input-field mono"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
          )}

          {/* Quantity Field */}
          <div>
            <label style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px', fontWeight: 700 }}>SIZE ({symbol.replace('USDT', '')})</label>
            <input
              type="number"
              step="0.0001"
              className="input-field mono"
              placeholder="0.0000"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>

          {/* Bracket Orders (TP/SL) */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '4px' }}>
             <label style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={useBracket} 
                  onChange={(e) => setUseBracket(e.target.checked)} 
                  style={{ accentColor: 'var(--accent-color)' }}
                />
                <span style={{ color: useBracket ? 'var(--text-bright)' : 'var(--text-muted)' }}>Take Profit / Stop Loss</span>
             </label>

             {useBracket && (
               <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                 <div style={{ flex: 1 }}>
                    <input type="number" step="0.01" className="input-field mono" placeholder="TP Price" value={tpPrice} onChange={e => setTpPrice(e.target.value)} />
                 </div>
                 <div style={{ flex: 1 }}>
                    <input type="number" step="0.01" className="input-field mono" placeholder="SL Price" value={slPrice} onChange={e => setSlPrice(e.target.value)} />
                 </div>
               </div>
             )}
          </div>

          {/* TIF & Post Only */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
            <select 
              value={timeInForce} 
              onChange={(e) => setTimeInForce(e.target.value as any)}
              className="input-field mono"
              style={{ width: '48%', height: '22px', fontSize: '9px', padding: '0 4px', color: 'var(--text-muted)' }}
            >
              <option value="GTC">Good Till Cancel (GTC)</option>
              <option value="IOC">Immediate or Cancel (IOC)</option>
              <option value="FOK">Fill or Kill (FOK)</option>
            </select>
            <label style={{ fontSize: '9px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}>
               <input type="checkbox" checked={postOnly} onChange={e => setPostOnly(e.target.checked)} />
               Post Only
            </label>
          </div>

          {/* Risk Summary Preview */}
          <div style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px', fontSize: '10px', marginTop: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Cost</span>
              <span className="mono">{estimatedTotal} USD</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Est. Margin (10x)</span>
              <span className="mono" style={{ color: 'var(--text-bright)' }}>~{marginRequired} USD</span>
            </div>
          </div>

          {/* Alerts rendering */}
          {error && (
            <div style={{ color: 'var(--color-sell)', fontSize: '10px', padding: '4px 6px', background: 'rgba(242, 54, 69, 0.08)', borderRadius: '2px' }}>
              ⚠️ {error}
            </div>
          )}
          {successMsg && (
            <div style={{ color: 'var(--color-buy)', fontSize: '10px', padding: '4px 6px', background: 'rgba(8, 153, 129, 0.08)', borderRadius: '2px' }}>
              ✓ {successMsg}
            </div>
          )}

          <button
            type="submit"
            className={`btn`}
            style={{ 
              width: '100%', 
              marginTop: '4px', 
              padding: '10px', 
              border: 'none', 
              background: side === 'BUY' ? 'var(--color-buy)' : 'var(--color-sell)',
              color: '#000',
              fontWeight: 800,
              letterSpacing: '0.5px'
            }}
            disabled={loading}
          >
            {loading ? 'ROUTING...' : `${side} ${symbol.replace('USDT', '')}`}
          </button>
        </form>
      </div>
    </div>
  );
};

export default OrderForm;
