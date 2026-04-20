import React, { useEffect, useRef, useState } from 'react';

function AnimatedNum({ target, decimals = 1, suffix = '' }) {
  const [val, setVal] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    const start = prevRef.current;
    const end = target;
    if (Math.abs(start - end) < 0.0001) return;
    const dur = 700;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      setVal(start + (end - start) * e);
      if (p < 1) requestAnimationFrame(tick);
      else prevRef.current = end;
    };
    requestAnimationFrame(tick);
  }, [target]);

  return <>{val.toFixed(decimals)}{suffix}</>;
}

const riskColor = (s) => s < 0.4 ? '#4ade80' : s < 0.7 ? '#fbbf24' : '#f87171';

export default function StatsBar({ routes, alerts, avgRisk, highestRisk, simHour }) {
  const disruptions = alerts.filter(a => a.risk_score > 0.7).length;
  const networkHealth = Math.max(0, 100 - avgRisk * 100);

  return (
    <div className="stats-bar">
      <div className="stat-item">
        <span className="stat-label">NETWORK HEALTH</span>
        <div className="stat-health-wrap">
          <div className="stat-health-track">
            <div
              className="stat-health-fill"
              style={{
                width: `${networkHealth.toFixed(0)}%`,
                background: avgRisk < 0.4
                  ? 'linear-gradient(90deg,#166534,#4ade80)'
                  : avgRisk < 0.7
                    ? 'linear-gradient(90deg,#92400e,#fbbf24)'
                    : 'linear-gradient(90deg,#991b1b,#f87171)',
              }}
            />
          </div>
          <span className="stat-health-pct" style={{ color: riskColor(avgRisk) }}>
            <AnimatedNum target={networkHealth} decimals={0} suffix="%" />
          </span>
        </div>
      </div>

      <div className="stat-divider" />

      <div className="stat-item">
        <span className="stat-label">AVG RISK</span>
        <span className="stat-val" style={{ color: riskColor(avgRisk) }}>
          <AnimatedNum target={avgRisk * 100} decimals={1} suffix="%" />
        </span>
      </div>

      <div className="stat-divider" />

      <div className="stat-item">
        <span className="stat-label">HIGHEST RISK</span>
        <span className="stat-val" style={{ color: riskColor(highestRisk?.risk_score ?? 0) }}>
          {highestRisk ? (
            <><AnimatedNum target={(highestRisk.risk_score ?? 0) * 100} decimals={1} suffix="%" />
            <span className="stat-route-tag">{highestRisk.name?.split('→')[0]?.trim()}</span></>
          ) : '—'}
        </span>
      </div>

      <div className="stat-divider" />

      <div className="stat-item">
        <span className="stat-label">ALERTS FIRED</span>
        <span className="stat-val" style={{ color: disruptions > 0 ? '#f87171' : '#94a3b8' }}>
          {disruptions}
          {disruptions > 0 && <span className="stat-alert-dot" />}
        </span>
      </div>

      <div className="stat-divider" />

      <div className="stat-item">
        <span className="stat-label">ROUTES ACTIVE</span>
        <span className="stat-val" style={{ color: '#38bdf8' }}>{routes.length}</span>
      </div>

      <div className="stat-divider" />

      <div className="stat-item">
        <span className="stat-label">SIM ELAPSED</span>
        <span className="stat-val mono" style={{ color: '#94a3b8' }}>{simHour}h 00m</span>
      </div>

      {/* Mini route risk pills */}
      <div className="stat-divider" />
      <div className="stat-item routes-pill-group">
        {routes.map(r => (
          <div key={r.route_id} className="route-pill" style={{ borderColor: riskColor(r.risk_score) }}>
            <span className="pill-dot" style={{ background: riskColor(r.risk_score), boxShadow: `0 0 5px ${riskColor(r.risk_score)}` }} />
            <span className="pill-name">{r.name.split('→')[0].trim()}</span>
            <span className="pill-val" style={{ color: riskColor(r.risk_score) }}>
              {(r.risk_score * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
