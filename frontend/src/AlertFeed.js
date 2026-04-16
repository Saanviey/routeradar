import React from 'react';

const riskClass = (score) => {
  if (score < 0.4) return 'risk-green';
  if (score < 0.7) return 'risk-amber';
  return 'risk-red';
};

const formatTime = (isoStr) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export default function AlertFeed({ alerts, routes }) {
  return (
    <div className="alert-feed">
      <div className="panel-header">
        ◈ LIVE FEED — <span>ROUTE STATUS</span>
      </div>

      {/* Route summary rows */}
      <div className="route-summary">
        {routes.map((r) => (
          <div key={r.route_id} className="route-row">
            <span className="route-name-sm">{r.name}</span>
            <span className={`risk-badge ${riskClass(r.risk_score)}`}>
              {(r.risk_score * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      <div className="panel-header" style={{ borderTop: '1px solid #1e293b' }}>
        ⚠ ALERTS — <span>{alerts.length} received</span>
      </div>

      <div className="alerts-list">
        {alerts.length === 0 ? (
          <div className="alert-empty">
            NO ALERTS<br />
            System monitoring active.<br />
            Click "Advance Time" to simulate.
          </div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className="alert-card">
              <div className="alert-top">
                <span className="alert-route">{alert.route_name || alert.route_id}</span>
                <span className="alert-time">{formatTime(alert.triggered_at)}</span>
              </div>
              <div className="alert-msg">{alert.message}</div>
              <div className="alert-score">
                RISK SCORE: {(alert.risk_score * 100).toFixed(1)}%
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
