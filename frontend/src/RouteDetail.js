import React, { useState, useEffect, useRef } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Legend
} from 'recharts';

const riskClass = (s) => s < 0.4 ? 'green' : s < 0.7 ? 'amber' : 'red';
const riskLabel = (s) => s < 0.4 ? 'LOW RISK' : s < 0.7 ? 'MODERATE' : 'HIGH RISK ⚠';
const riskColor = (s) => s < 0.4 ? '#4ade80' : s < 0.7 ? '#fbbf24' : '#f87171';

const FACTOR_WEIGHTS = { weather: 0.45, congestion: 0.35, traffic: 0.20 };

function Skeleton({ h = 12, w = '100%', mb = 6 }) {
  return (
    <div style={{
      height: h, width: w, marginBottom: mb,
      background: 'linear-gradient(90deg, #0c1220 25%, #111828 50%, #0c1220 75%)',
      backgroundSize: '400% 100%',
      animation: 'shimmer 1.4s infinite',
      borderRadius: 4,
    }} />
  );
}

function FactorBar({ label, value, max = 10, color }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="factor-row">
      <span className="factor-label">{label}</span>
      <div className="factor-track">
        <div className="factor-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="factor-val" style={{ color }}>{value?.toFixed(1)}</span>
    </div>
  );
}

function PredictionTimeline({ history, currentRisk }) {
  // Generate simple next-6hr forecast by extrapolating trend
  const recent = history.slice(-6);
  const trend = recent.length > 1
    ? (recent[recent.length - 1].risk_score - recent[0].risk_score) / recent.length
    : 0;

  const forecast = Array.from({ length: 6 }, (_, i) => {
    const predicted = Math.max(0, Math.min(1, currentRisk + trend * (i + 1) * 0.7));
    return {
      label: `+${i + 1}h`,
      risk: predicted,
      color: riskColor(predicted),
    };
  });

  return (
    <div className="prediction-strip">
      {forecast.map((f, i) => (
        <div key={i} className="pred-cell">
          <div className="pred-bar-wrap">
            <div className="pred-bar-track">
              <div className="pred-bar-fill" style={{
                height: `${(f.risk * 100).toFixed(0)}%`,
                background: f.color,
                boxShadow: `0 0 6px ${f.color}`,
              }} />
            </div>
          </div>
          <span className="pred-val" style={{ color: f.color }}>{(f.risk * 100).toFixed(0)}%</span>
          <span className="pred-label">{f.label}</span>
        </div>
      ))}
    </div>
  );
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: 'rgba(8,13,26,0.97)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 6, padding: '8px 14px', fontFamily: "'Space Mono',monospace", fontSize: 10,
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>{d?.hour}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
};

export default function RouteDetail({ route, onClose, api }) {
  const [history, setHistory] = useState([]);
  const [alternates, setAlternates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartMode, setChartMode] = useState('risk');
  const loadedRouteId = useRef(null);

  // Depend ONLY on route_id — not the full route object.
  // This prevents the 10s poll from re-triggering a loading flash
  // every time risk_score or latest_snapshot updates in the parent.
  useEffect(() => {
    if (!route?.route_id) return;
    if (route.route_id === loadedRouteId.current) return;
    loadedRouteId.current = route.route_id;

    setLoading(true);
    setHistory([]);
    setAlternates([]);

    Promise.all([
      fetch(`${api}/routes/${route.route_id}/history`).then(r => r.json()),
      fetch(`${api}/routes/${route.route_id}/alternates`).then(r => r.json()),
    ]).then(([hist, alts]) => {
      setHistory(hist.map(h => ({
        hour: new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        risk_score: h.risk_score,
        weather: h.weather_severity,
        congestion: h.port_congestion_index,
      })));
      setAlternates(alts.alternates || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [route?.route_id, api]);

  const cls = riskClass(route.risk_score);
  const color = riskColor(route.risk_score);
  const pct = (route.risk_score * 100).toFixed(1);
  const snap = route.latest_snapshot;

  // Contribution breakdown
  const wContrib = snap ? (snap.weather_severity / 10) * FACTOR_WEIGHTS.weather * 100 : 0;
  const cContrib = snap ? (snap.port_congestion_index / 10) * FACTOR_WEIGHTS.congestion * 100 : 0;
  const tContrib = snap ? ((1 - snap.traffic_speed_ratio)) * FACTOR_WEIGHTS.traffic * 100 : 0;

  return (
    <div className="route-detail">
      <div className="detail-header">
        <span className="detail-title">ROUTE ANALYSIS</span>
        <button className="close-btn" onClick={onClose}>✕ CLOSE</button>
      </div>

      <div className="detail-body">
        <div className="detail-route-name">{route.name}</div>

        {/* Risk hero with gauge */}
        <div className={`risk-hero ${cls}`}>
          <div className="risk-hero-left">
            <span className="risk-label">DISRUPTION RISK</span>
            <span className={`risk-value ${cls}`}>{pct}%</span>
            <div className="gauge-wrap">
              <div className="gauge-track">
                <div className={`gauge-fill ${cls}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="gauge-labels">
                <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
              </div>
            </div>
          </div>
          <span className={`risk-status-pill ${cls}`}>{riskLabel(route.risk_score)}</span>
        </div>

        {/* Factor contribution breakdown */}
        {snap && (
          <div>
            <div className="section-title">Disruption Factors</div>
            <div className="factor-breakdown">
              <FactorBar label="Weather" value={snap.weather_severity} color="#38bdf8" />
              <FactorBar label="Port Congestion" value={snap.port_congestion_index} color="#a78bfa" />
              <FactorBar label="Traffic Impact" value={(1 - snap.traffic_speed_ratio) * 10} color="#fb923c" />
            </div>
            <div className="contribution-row">
              {[
                { label: 'Weather', val: wContrib, color: '#38bdf8' },
                { label: 'Congestion', val: cContrib, color: '#a78bfa' },
                { label: 'Traffic', val: tContrib, color: '#fb923c' },
              ].map(f => (
                <div key={f.label} className="contrib-chip" style={{ borderColor: f.color + '44' }}>
                  <span style={{ color: f.color }}>{f.val.toFixed(0)}%</span>
                  <span className="contrib-label">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conditions */}
        {snap && (
          <div>
            <div className="section-title">Current Conditions</div>
            <div className="metrics-grid">
              <div className="metric-box">
                <div className="metric-label">WEATHER</div>
                <div className="metric-val">{snap.weather_severity?.toFixed(1)}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">CONGESTION</div>
                <div className="metric-val">{snap.port_congestion_index?.toFixed(1)}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">SPEED RATIO</div>
                <div className="metric-val">{snap.traffic_speed_ratio?.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Forecast timeline */}
        {!loading && history.length > 0 && (
          <div>
            <div className="section-title">6-Hour Risk Forecast</div>
            <PredictionTimeline history={history} currentRisk={route.risk_score} />
          </div>
        )}

        {/* History chart with toggle */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>History — Last 24h</div>
            <div className="chart-toggle">
              <button className={`ctbtn ${chartMode === 'risk' ? 'active' : ''}`} onClick={() => setChartMode('risk')}>RISK</button>
              <button className={`ctbtn ${chartMode === 'multi' ? 'active' : ''}`} onClick={() => setChartMode('multi')}>MULTI</button>
            </div>
          </div>
          <div className="chart-wrap">
            {loading ? (
              <div style={{ padding: '16px' }}>
                <Skeleton h={8} w="60%" /><Skeleton h={80} /><Skeleton h={8} w="80%" />
              </div>
            ) : chartMode === 'risk' ? (
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={history} margin={{ top: 6, right: 12, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="hour" tick={{ fill: '#475569', fontSize: 8, fontFamily: 'Space Mono' }} interval={4} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 1]} tick={{ fill: '#475569', fontSize: 8, fontFamily: 'Space Mono' }} tickLine={false} axisLine={false} tickFormatter={v => `${(v*100).toFixed(0)}`} />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <ReferenceLine y={0.7} stroke="#f87171" strokeDasharray="4 3" strokeOpacity={0.5} />
                  <ReferenceLine y={0.4} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.5} />
                  <Area type="monotone" dataKey="risk_score" stroke={color} strokeWidth={2} fill="url(#rg)" dot={false} activeDot={{ r: 4, fill: color, strokeWidth: 2 }} name="Risk" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={history} margin={{ top: 6, right: 12, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="hour" tick={{ fill: '#475569', fontSize: 8, fontFamily: 'Space Mono' }} interval={4} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 8, fontFamily: 'Space Mono' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 9, fontFamily: 'Space Mono' }} />
                  <Line type="monotone" dataKey="weather" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Weather" />
                  <Line type="monotone" dataKey="congestion" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="Congestion" />
                  <Line type="monotone" dataKey="risk_score" stroke={color} strokeWidth={2} dot={false} name="Risk" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Alternates */}
        <div>
          <div className="section-title">Alternate Routes</div>
          <div className="alt-routes">
            {alternates.map((alt, i) => (
              <div key={i} className="alt-card">
                <div className="alt-header">
                  <span className="alt-name">{alt.name}</span>
                  <span className="alt-risk-chip">{(alt.risk_score * 100).toFixed(0)}% risk</span>
                </div>
                <div className="alt-stats">
                  <div className="alt-stat">
                    <span className="alt-stat-label">EXTRA TIME</span>
                    <span className="alt-stat-val">+{alt.extra_time_minutes}min</span>
                  </div>
                  <div className="alt-stat">
                    <span className="alt-stat-label">EXTRA DIST</span>
                    <span className="alt-stat-val">+{alt.extra_distance_km}km</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}