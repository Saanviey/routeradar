import React from 'react';

const riskClass = (s) => s < 0.4 ? 'risk-green' : s < 0.7 ? 'risk-amber' : 'risk-red';
const routeRowClass = (s) => s < 0.4 ? 'green-route' : s < 0.7 ? 'amber-route' : 'red-route';
const riskColor = (s) => s < 0.4 ? '#4ade80' : s < 0.7 ? '#fbbf24' : '#f87171';

const routeMeta = {
  MUM_DEL: { sub: 'NH48 · ~1400 km', weather: '🌧', congestion: 'HIGH' },
  DEL_KOL: { sub: 'NH19 · ~1500 km', weather: '⛅', congestion: 'MED' },
  MUM_CHE: { sub: 'NH48 · ~1300 km', weather: '☀', congestion: 'LOW' },
};

const formatTime = (iso) => iso
  ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : '';

export default function AlertFeed({ alerts, routes, alertFilter, onFilterChange, onRouteClick }) {
  return (
    <div className="alert-feed">
      {/* Route status */}
      <div className="panel-header">
        <span className="panel-header-title">Route Status</span>
        <span className="panel-header-badge">LIVE</span>
      </div>

      <div className="route-summary">
        {routes.map(r => {
          const meta = routeMeta[r.route_id] || {};
          return (
            <div
              key={r.route_id}
              className={`route-row ${routeRowClass(r.risk_score)}`}
              onClick={() => onRouteClick(r)}
            >
              <div className="route-row-left">
                <span className="route-name-sm">{r.name}</span>
                <div className="route-sub-row">
                  <span className="route-sub">{meta.sub}</span>
                  <span className="route-weather-tag">{meta.weather} {meta.congestion}</span>
                </div>
              </div>
              <div className="route-row-right">
                <span className={`risk-badge ${riskClass(r.risk_score)}`}>
                  {(r.risk_score * 100).toFixed(1)}%
                </span>
                <div className="mini-bar-track">
                  <div className="mini-bar-fill" style={{
                    width: `${(r.risk_score * 100).toFixed(0)}%`,
                    background: riskColor(r.risk_score),
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alert filter */}
      <div className="alerts-section-header">
        <span className="alerts-section-title">⚠ Disruption Alerts</span>
        <div className="alert-filter-btns">
          <button
            className={`afbtn ${alertFilter === 'all' ? 'active' : ''}`}
            onClick={() => onFilterChange('all')}
          >ALL</button>
          <button
            className={`afbtn ${alertFilter === 'high' ? 'active' : ''}`}
            onClick={() => onFilterChange('high')}
          >HIGH</button>
        </div>
      </div>

      <div className="alerts-list">
        {alerts.length === 0 ? (
          <div className="alert-empty">
            <div className="alert-empty-icon">🛰</div>
            <div className="alert-empty-text">
              NO ALERTS DETECTED<br />
              All routes nominal.<br />
              Click "Advance Time" to simulate disruption.
            </div>
          </div>
        ) : (
          alerts.map(alert => (
            <div key={alert.id} className="alert-card">
              <div className="alert-top">
                <span className="alert-route-tag">⚠ {alert.route_name || alert.route_id}{alert.ai_generated && <span className="alert-ai-tag">✦ AI</span>}</span>
                <span className="alert-time">{formatTime(alert.triggered_at)}</span>
              </div>
              <div className="alert-msg">{alert.message}</div>
              <div className="alert-score-bar-wrap">
                <div className="alert-score-bar-bg">
                  <div className="alert-score-bar-fill"
                    style={{ width: `${(alert.risk_score * 100).toFixed(0)}%` }} />
                </div>
                <span className="alert-score-label">{(alert.risk_score * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}