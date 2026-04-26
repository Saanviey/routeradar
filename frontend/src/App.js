import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import MapView from './MapView';
import AlertFeed from './AlertFeed';
import RouteDetail from './RouteDetail';
import StatsBar from './StatsBar';
import ImpactPanel from './ImpactPanel';
import Toast from './Toast';
import './App.css';

const API = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/ws/alerts';

function useAnimatedNumber(target, decimals = 1) {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const start = prev.current;
    const end = target;
    if (Math.abs(start - end) < 0.001) return;
    const duration = 600;
    const startTime = performance.now();
    const tick = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setDisplay(start + (end - start) * eased);
      if (t < 1) requestAnimationFrame(tick);
      else prev.current = end;
    };
    requestAnimationFrame(tick);
  }, [target]);
  return display.toFixed(decimals);
}

export default function App() {
  const [routes, setRoutes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [compareRoute, setCompareRoute] = useState(null);
  const [advancing, setAdvancing] = useState(false);
  const [simHour, setSimHour] = useState(0);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [mapKey, setMapKey] = useState(0);
  const [riskFilter, setRiskFilter] = useState(0);
  const [alertFilter, setAlertFilter] = useState('all');
  const [compareMode, setCompareMode] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [sidebarTab, setSidebarTab] = useState('feed'); // 'feed' | 'detail' | 'compare'
  const wsRef = useRef(null);

  const pushToast = useCallback((msg, type = 'alert') => {
    const id = Date.now();
    setToasts(prev => [...prev.slice(-2), { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetch(`${API}/routes`);
      const data = await res.json();
      setRoutes(data);
      // Only update risk_score + snapshot, not full object, to avoid re-render cascade
      if (selectedRoute) {
        const updated = data.find(r => r.route_id === selectedRoute.route_id);
        if (updated && updated.risk_score !== selectedRoute.risk_score) {
          setSelectedRoute(prev => ({
            ...prev,
            risk_score: updated.risk_score,
            latest_snapshot: updated.latest_snapshot,
          }));
        }
      }
      if (compareRoute) {
        const updated = data.find(r => r.route_id === compareRoute.route_id);
        if (updated && updated.risk_score !== compareRoute.risk_score) {
          setCompareRoute(prev => ({
            ...prev,
            risk_score: updated.risk_score,
            latest_snapshot: updated.latest_snapshot,
          }));
        }
      }
    } catch (e) { console.error('Failed to fetch routes', e); }
  }, [selectedRoute, compareRoute]);

  useEffect(() => {
    fetchRoutes();
    const interval = setInterval(fetchRoutes, 10000);
    return () => clearInterval(interval);
  }, [fetchRoutes]);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setWsStatus('connected');
      ws.onclose = () => { setWsStatus('disconnected'); setTimeout(connect, 3000); };
      ws.onerror = () => setWsStatus('error');
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'alert') {
            setAlerts(prev => [{ ...msg, id: Date.now() }, ...prev.slice(0, 49)]);
            pushToast(`⚠ ${msg.route_name}: Risk ${(msg.risk_score * 100).toFixed(0)}%`, 'alert');
          }
        } catch {}
      };
    }
    connect();
    return () => wsRef.current?.close();
  }, [pushToast]);

  const handleReset = async () => {
    setAdvancing(true);
    try {
      await fetch(`${API}/simulate/reset`, { method: 'POST' });
      setSimHour(0);
      setAlerts([]);
      setRoutes([]);
      setMapKey(k => k + 1);
      await fetchRoutes();
      pushToast('✓ Simulation reset to normal', 'ok');
    } catch (e) { console.error('Reset failed', e); }
    finally { setAdvancing(false); }
  };

  const handleTriggerDisruption = async () => {
    setAdvancing(true);
    try {
      await fetch(`${API}/simulate/trigger-disruption`, { method: 'POST' });
      setSimHour(30);
      await fetchRoutes();
      pushToast('⚠ Disruption injected on Mumbai→Delhi', 'alert');
    } catch (e) { console.error('Trigger failed', e); }
    finally { setAdvancing(false); }
  };

  const handleAdvance = async () => {
    setAdvancing(true);
    try {
      await fetch(`${API}/simulate/advance`, { method: 'POST' });
      setSimHour(h => h + 1);
      await fetchRoutes();
    } catch (e) { console.error('Advance failed', e); }
    finally { setAdvancing(false); }
  };

  const handleRouteClick = (route) => {
    if (compareMode) {
      if (!selectedRoute) { setSelectedRoute(route); return; }
      if (route.route_id === selectedRoute.route_id) return;
      setCompareRoute(route);
      setSidebarTab('compare');
    } else {
      setSelectedRoute(route);
      setSidebarTab('detail');
    }
  };

  const filteredRoutes = routes.filter(r => r.risk_score >= riskFilter / 100);
  const filteredAlerts = alertFilter === 'high'
    ? alerts.filter(a => a.risk_score > 0.7)
    : alerts;

  const avgRisk = routes.length ? routes.reduce((s, r) => s + r.risk_score, 0) / routes.length : 0;
  const highestRisk = routes.length ? routes.reduce((a, b) => a.risk_score > b.risk_score ? a : b, routes[0]) : null;

  return (
    <div className="app">
      {/* Toast layer */}
      <div className="toast-layer">
        {toasts.map(t => <Toast key={t.id} msg={t.msg} type={t.type} />)}
      </div>

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo"><span className="logo-dot" />ROUTERADAR</span>
          <span className="tagline">AI Supply Chain Disruption Predictor</span>
        </div>

        <div className="header-center">
          {/* Risk filter */}
          <div className="filter-group">
            <span className="filter-label">MIN RISK</span>
            <input
              type="range" min="0" max="90" step="10"
              value={riskFilter}
              onChange={e => setRiskFilter(Number(e.target.value))}
              className="risk-slider"
            />
            <span className="filter-val">{riskFilter}%</span>
          </div>

          {/* Compare toggle */}
          <button
            className={`compare-btn ${compareMode ? 'active' : ''}`}
            onClick={() => {
              setCompareMode(m => !m);
              setCompareRoute(null);
              if (!compareMode) setSidebarTab('feed');
            }}
          >
            ⇄ COMPARE
          </button>

          <div className={`ws-indicator ws-${wsStatus}`}>
            <span className="ws-dot" />
            {wsStatus === 'connected' ? 'LIVE' : wsStatus.toUpperCase()}
          </div>
          <span className="sim-clock">T+{simHour}h</span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="reset-btn"
            onClick={handleReset}
            disabled={advancing}
          >
            ↺ RESET
          </button>
          <button
            className="trigger-btn"
            onClick={handleTriggerDisruption}
            disabled={advancing}
          >
            ⚡ TRIGGER DISRUPTION
          </button>
          <button
            className={`advance-btn ${advancing ? 'loading' : ''}`}
            onClick={handleAdvance}
            disabled={advancing}
          >
            {advancing ? '⟳  Advancing...' : '⏩  Advance Time +1hr'}
          </button>
        </div>
      </header>

      {/* Stats bar */}
      <StatsBar
        routes={routes}
        alerts={alerts}
        avgRisk={avgRisk}
        highestRisk={highestRisk}
        simHour={simHour}
      />

      {/* Main */}
      <div className="main">
        <div className="map-container">
          <MapView
            key={mapKey}
            routes={filteredRoutes}
            allRoutes={routes}
            onRouteClick={handleRouteClick}
            selectedRouteId={selectedRoute?.route_id}
            compareRouteId={compareRoute?.route_id}
            compareMode={compareMode}
          />
          {compareMode && (
            <div className="compare-hint">
              {!selectedRoute
                ? '① Click a route to select it'
                : !compareRoute
                  ? '② Click another route to compare'
                  : '✓ Comparing — see sidebar'}
            </div>
          )}
        </div>

        <div className="sidebar">
          {/* Sidebar tabs */}
          <div className="sidebar-tabs">
            <button
              className={`stab ${sidebarTab === 'feed' ? 'active' : ''}`}
              onClick={() => setSidebarTab('feed')}
            >ALERTS</button>
            <button
              className={`stab ${sidebarTab === 'detail' ? 'active' : ''}`}
              onClick={() => selectedRoute && setSidebarTab('detail')}
              disabled={!selectedRoute}
            >DETAIL</button>
            <button
              className={`stab ${sidebarTab === 'compare' ? 'active' : ''}`}
              onClick={() => compareRoute && setSidebarTab('compare')}
              disabled={!compareRoute}
            >COMPARE</button>
            <button
              className={`stab ${sidebarTab === 'impact' ? 'active' : ''}`}
              onClick={() => setSidebarTab('impact')}
            >IMPACT</button>
          </div>

          {sidebarTab === 'feed' && (
            <AlertFeed
              alerts={filteredAlerts}
              routes={routes}
              alertFilter={alertFilter}
              onFilterChange={setAlertFilter}
              onRouteClick={(r) => { setSelectedRoute(r); setSidebarTab('detail'); }}
            />
          )}
          {sidebarTab === 'detail' && selectedRoute && (
            <RouteDetail
              route={selectedRoute}
              onClose={() => { setSelectedRoute(null); setSidebarTab('feed'); }}
              api={API}
            />
          )}
          {sidebarTab === 'compare' && selectedRoute && compareRoute && (
            <ComparePanel
              routeA={selectedRoute}
              routeB={compareRoute}
              onClose={() => { setCompareRoute(null); setSidebarTab('feed'); }}
              api={API}
            />
          )}
          {sidebarTab === 'impact' && (
            <ImpactPanel api={API} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Inline ComparePanel ─────────────────────────────── */
function ComparePanel({ routeA, routeB, onClose, api }) {
  const [histA, setHistA] = React.useState([]);
  const [histB, setHistB] = React.useState([]);

  React.useEffect(() => {
    Promise.all([
      fetch(`${api}/routes/${routeA.route_id}/history`).then(r => r.json()),
      fetch(`${api}/routes/${routeB.route_id}/history`).then(r => r.json()),
    ]).then(([a, b]) => {
      setHistA(a);
      setHistB(b);
    });
  }, [routeA.route_id, routeB.route_id, api]);

  const merged = histA.map((a, i) => ({
    hour: new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    [routeA.route_id]: a.risk_score,
    [routeB.route_id]: histB[i]?.risk_score ?? 0,
  }));

  const riskColor = (s) => s < 0.4 ? '#4ade80' : s < 0.7 ? '#fbbf24' : '#f87171';
  const diff = routeA.risk_score - routeB.risk_score;

  return (
    <div className="route-detail">
      <div className="detail-header">
        <span className="detail-title">ROUTE COMPARISON</span>
        <button className="close-btn" onClick={onClose}>✕ CLOSE</button>
      </div>
      <div className="detail-body">
        {/* Head to head */}
        <div className="compare-hth">
          <div className="compare-route-col">
            <div className="compare-route-name">{routeA.name}</div>
            <div className="compare-risk" style={{ color: riskColor(routeA.risk_score) }}>
              {(routeA.risk_score * 100).toFixed(1)}%
            </div>
          </div>
          <div className="compare-vs">
            <div className="vs-label">VS</div>
            <div className={`vs-diff ${diff > 0 ? 'worse' : 'better'}`}>
              {diff > 0 ? '▲' : '▼'} {Math.abs(diff * 100).toFixed(1)}pp
            </div>
          </div>
          <div className="compare-route-col right">
            <div className="compare-route-name">{routeB.name}</div>
            <div className="compare-risk" style={{ color: riskColor(routeB.risk_score) }}>
              {(routeB.risk_score * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Stat rows */}
        {[
          ['Weather Severity', routeA.latest_snapshot?.weather_severity, routeB.latest_snapshot?.weather_severity],
          ['Port Congestion', routeA.latest_snapshot?.port_congestion_index, routeB.latest_snapshot?.port_congestion_index],
          ['Speed Ratio', routeA.latest_snapshot?.traffic_speed_ratio, routeB.latest_snapshot?.traffic_speed_ratio],
        ].map(([label, a, b]) => (
          <div key={label} className="compare-stat-row">
            <span className="csr-val" style={{ color: a > b ? '#f87171' : '#4ade80' }}>{a?.toFixed(2) ?? '—'}</span>
            <span className="csr-label">{label}</span>
            <span className="csr-val right" style={{ color: b > a ? '#f87171' : '#4ade80' }}>{b?.toFixed(2) ?? '—'}</span>
          </div>
        ))}

        {/* Overlaid history chart */}
        <div>
          <div className="section-title">Risk History Overlay</div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={merged} margin={{ top: 6, right: 12, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="hour" tick={{ fill: '#475569', fontSize: 8, fontFamily: 'Space Mono' }} interval={4} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 1]} tick={{ fill: '#475569', fontSize: 8, fontFamily: 'Space Mono' }} tickLine={false} axisLine={false} tickFormatter={v => `${(v*100).toFixed(0)}`} />
                <Tooltip
                  contentStyle={{ background: 'rgba(8,13,26,0.97)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'Space Mono', fontSize: 10 }}
                  formatter={(v, name) => [`${(v*100).toFixed(1)}%`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 9, fontFamily: 'Space Mono', color: '#94a3b8' }} />
                <Line type="monotone" dataKey={routeA.route_id} stroke="#38bdf8" strokeWidth={2} dot={false} name={routeA.name} />
                <Line type="monotone" dataKey={routeB.route_id} stroke="#a78bfa" strokeWidth={2} dot={false} name={routeB.name} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="compare-verdict">
          <div className="verdict-label">RECOMMENDATION</div>
          <div className="verdict-text">
            {routeA.risk_score < routeB.risk_score
              ? `${routeA.name} has ${Math.abs(diff * 100).toFixed(0)}pp lower risk — prefer this route.`
              : routeB.risk_score < routeA.risk_score
                ? `${routeB.name} has ${Math.abs(diff * 100).toFixed(0)}pp lower risk — prefer this route.`
                : 'Both routes carry similar risk. Consider alternate options.'}
          </div>
        </div>
      </div>
    </div>
  );
}