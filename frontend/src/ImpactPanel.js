import React, { useEffect, useState, useRef } from 'react';

function AnimatedNum({ target, decimals = 0, prefix = '', suffix = '' }) {
  const [val, setVal] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = target;
    if (Math.abs(start - end) < 0.01) return;
    const dur = 1200;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3); // ease-out-cubic
      setVal(start + (end - start) * e);
      if (p < 1) requestAnimationFrame(tick);
      else prevRef.current = end;
    };
    requestAnimationFrame(tick);
  }, [target]);

  const formatted = val >= 1000
    ? (val >= 100000
        ? `${(val / 100000).toFixed(1)}L`
        : val >= 1000
          ? `${(val / 1000).toFixed(1)}K`
          : val.toFixed(decimals))
    : val.toFixed(decimals);

  return <>{prefix}{formatted}{suffix}</>;
}

const SDG_COLORS = {
  'SDG 9: Industry & Infrastructure': '#f97316',
  'SDG 13: Climate Action': '#22c55e',
};

export default function ImpactPanel({ api }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchImpact = async () => {
    try {
      const res = await fetch(`${api}/impact`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError('Failed to load impact data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImpact();
    const interval = setInterval(fetchImpact, 15000);
    return () => clearInterval(interval);
  }, [api]);

  if (loading) return (
    <div className="impact-panel">
      <div className="impact-loading">
        <div className="impact-spinner" />
        <span>Calculating impact...</span>
      </div>
    </div>
  );

  if (error) return (
    <div className="impact-panel">
      <div className="impact-error">{error}</div>
    </div>
  );

  const s = data?.summary || {};

  return (
    <div className="impact-panel">
      {/* Header */}
      <div className="panel-header">
        <span className="panel-header-title">🌍 Impact Dashboard</span>
        <span className="panel-header-badge">AI-POWERED</span>
      </div>

      {/* SDG Tags */}
      <div className="sdg-tags">
        {(s.sdg_goals || []).map(g => (
          <div key={g} className="sdg-tag" style={{ borderColor: SDG_COLORS[g] + '60', color: SDG_COLORS[g] }}>
            <span className="sdg-dot" style={{ background: SDG_COLORS[g] }} />
            {g}
          </div>
        ))}
      </div>

      {/* Hero metrics */}
      <div className="impact-hero-grid">
        <div className="impact-hero-card green">
          <div className="ihc-icon">🌱</div>
          <div className="ihc-value">
            <AnimatedNum target={s.co2_saved_kg || 0} decimals={1} suffix=" kg" />
          </div>
          <div className="ihc-label">CO₂ Emissions Saved</div>
          <div className="ihc-sub">
            ≈ <AnimatedNum target={s.co2_saved_trees_equivalent || 0} decimals={1} /> trees/year
          </div>
        </div>

        <div className="impact-hero-card amber">
          <div className="ihc-icon">💰</div>
          <div className="ihc-value">
            <AnimatedNum target={s.cost_saved_inr || 0} prefix="₹" />
          </div>
          <div className="ihc-label">Logistics Cost Saved</div>
          <div className="ihc-sub">via optimized routing</div>
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="impact-stat-grid">
        <div className="impact-stat">
          <span className="is-icon">⚠️</span>
          <div className="is-right">
            <span className="is-val" style={{ color: '#f87171' }}>
              <AnimatedNum target={s.disruptions_caught || 0} />
            </span>
            <span className="is-label">Disruptions Caught</span>
          </div>
        </div>

        <div className="impact-stat">
          <span className="is-icon">⏱</span>
          <div className="is-right">
            <span className="is-val" style={{ color: '#fbbf24' }}>
              <AnimatedNum target={s.delay_hours_avoided || 0} suffix="h" />
            </span>
            <span className="is-label">Delay Hours Avoided</span>
          </div>
        </div>

        <div className="impact-stat">
          <span className="is-icon">📦</span>
          <div className="is-right">
            <span className="is-val" style={{ color: '#38bdf8' }}>
              <AnimatedNum target={s.cargo_value_protected_inr || 0} prefix="₹" />
            </span>
            <span className="is-label">Cargo Value Protected</span>
          </div>
        </div>
      </div>

      {/* Per-route breakdown */}
      <div>
        <div className="section-title" style={{ padding: '0 16px', marginBottom: 8 }}>Per Route Impact</div>
        <div className="route-impact-list">
          {(data?.by_route || []).map(r => (
            <div key={r.route_id} className="route-impact-row">
              <div className="rir-name">{r.name}</div>
              <div className="rir-stats">
                <span className="rir-stat">
                  <span style={{ color: '#4ade80' }}>{r.co2_saved_kg.toFixed(0)}kg</span>
                  <span className="rir-unit">CO₂</span>
                </span>
                <span className="rir-stat">
                  <span style={{ color: '#fbbf24' }}>₹{(r.cost_saved_inr / 1000).toFixed(0)}K</span>
                  <span className="rir-unit">saved</span>
                </span>
                <span className="rir-stat">
                  <span style={{ color: '#f87171' }}>{r.disruptions_caught}</span>
                  <span className="rir-unit">alerts</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gemini badge */}
      <div className="gemini-badge">
        <span className="gemini-logo">✦</span>
        <span>Alert summaries powered by <strong>Gemini AI</strong></span>
      </div>
    </div>
  );
}
