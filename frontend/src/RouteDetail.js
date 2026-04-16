import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine
} from 'recharts';

const riskColorStr = (score) => {
  if (score < 0.4) return '#22c55e';
  if (score < 0.7) return '#f59e0b';
  return '#ef4444';
};

const riskClass = (score) => {
  if (score < 0.4) return 'green';
  if (score < 0.7) return 'amber';
  return 'red';
};

const riskLabel = (score) => {
  if (score < 0.4) return 'LOW RISK';
  if (score < 0.7) return 'MODERATE';
  return 'HIGH RISK';
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: '#0d1426',
      border: '1px solid #1e293b',
      padding: '6px 10px',
      fontFamily: 'Courier New, monospace',
      fontSize: '10px',
      color: '#e2e8f0',
    }}>
      <div style={{ color: '#00d4ff' }}>{d.hour}</div>
      <div>RISK: {(d.risk_score * 100).toFixed(1)}%</div>
      <div style={{ color: '#64748b' }}>W:{d.weather?.toFixed(1)} C:{d.congestion?.toFixed(1)}</div>
    </div>
  );
};

export default function RouteDetail({ route, onClose, api }) {
  const [history, setHistory] = useState([]);
  const [alternates, setAlternates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!route?.route_id) return;
    setLoading(true);

    Promise.all([
      fetch(`${api}/routes/${route.route_id}/history`).then(r => r.json()),
      fetch(`${api}/routes/${route.route_id}/alternates`).then(r => r.json()),
    ]).then(([hist, alts]) => {
      const formatted = hist.map((h, i) => ({
        hour: new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        risk_score: h.risk_score,
        weather: h.weather_severity,
        congestion: h.port_congestion_index,
        idx: i,
      }));
      setHistory(formatted);
      setAlternates(alts.alternates || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [route?.route_id, api]);

  const cls = riskClass(route.risk_score);

  return (
    <div className="route-detail">
      <div className="detail-header">
        <span className="detail-title">ROUTE ANALYSIS</span>
        <button className="close-btn" onClick={onClose}>✕ CLOSE</button>
      </div>

      <div className="detail-body">
        {/* Route name + risk hero */}
        <div>
          <div style={{ fontFamily: 'Courier New', fontSize: 13, letterSpacing: 1, marginBottom: 10 }}>
            {route.name}
          </div>
          <div className="risk-hero">
            <span className="risk-label">RISK SCORE</span>
            <span className={`risk-value ${cls}`}>
              {(route.risk_score * 100).toFixed(1)}%
            </span>
            <span className={`risk-status ${cls}`}>{riskLabel(route.risk_score)}</span>
          </div>
        </div>

        {/* Current metrics */}
        {route.latest_snapshot && (
          <div>
            <div className="section-title">CURRENT CONDITIONS</div>
            <div className="metrics-grid">
              <div className="metric-box">
                <div className="metric-label">WEATHER</div>
                <div className="metric-val">{route.latest_snapshot.weather_severity?.toFixed(1)}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">CONGESTION</div>
                <div className="metric-val">{route.latest_snapshot.port_congestion_index?.toFixed(1)}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">SPEED RATIO</div>
                <div className="metric-val">{route.latest_snapshot.traffic_speed_ratio?.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        {/* History chart */}
        <div>
          <div className="section-title">RISK HISTORY — LAST 24H</div>
          <div className="chart-wrap">
            {loading ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#334155', fontSize: 11 }}>
                LOADING...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={history} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <XAxis
                    dataKey="hour"
                    tick={{ fill: '#334155', fontSize: 8, fontFamily: 'Courier New' }}
                    interval={3}
                    tickLine={false}
                    axisLine={{ stroke: '#1e293b' }}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tick={{ fill: '#334155', fontSize: 8, fontFamily: 'Courier New' }}
                    tickLine={false}
                    axisLine={{ stroke: '#1e293b' }}
                    tickFormatter={(v) => `${(v * 100).toFixed(0)}`}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,212,255,0.05)' }} />
                  <ReferenceLine y={0.7} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
                  <ReferenceLine y={0.4} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
                  <Bar dataKey="risk_score" maxBarSize={18} radius={[2, 2, 0, 0]}>
                    {history.map((entry, index) => (
                      <Cell key={index} fill={riskColorStr(entry.risk_score)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Alternate routes */}
        <div>
          <div className="section-title">ALTERNATE ROUTES</div>
          <div className="alt-routes">
            {alternates.map((alt, i) => (
              <div key={i} className="alt-card">
                <div className="alt-name">{alt.name}</div>
                <div className="alt-stats">
                  <div className="alt-stat">
                    <span className="alt-stat-label">RISK</span>
                    <span className="alt-risk-val">{(alt.risk_score * 100).toFixed(0)}%</span>
                  </div>
                  <div className="alt-stat">
                    <span className="alt-stat-label">+TIME</span>
                    <span className="alt-stat-val">+{alt.extra_time_minutes}min</span>
                  </div>
                  <div className="alt-stat">
                    <span className="alt-stat-label">+DIST</span>
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
