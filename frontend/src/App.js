import React, { useState, useEffect, useRef, useCallback } from 'react';
import MapView from './MapView';
import AlertFeed from './AlertFeed';
import RouteDetail from './RouteDetail';
import './App.css';

const API = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/ws/alerts';

export default function App() {
  const [routes, setRoutes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [advancing, setAdvancing] = useState(false);
  const [simHour, setSimHour] = useState(0);
  const [wsStatus, setWsStatus] = useState('connecting');
  const wsRef = useRef(null);

  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetch(`${API}/routes`);
      const data = await res.json();
      setRoutes(data);
      // Update selected route details if open
      if (selectedRoute) {
        const updated = data.find(r => r.route_id === selectedRoute.route_id);
        if (updated) setSelectedRoute(prev => ({ ...prev, ...updated }));
      }
    } catch (e) {
      console.error('Failed to fetch routes', e);
    }
  }, [selectedRoute]);

  // Initial load + polling
  useEffect(() => {
    fetchRoutes();
    const interval = setInterval(fetchRoutes, 10000);
    return () => clearInterval(interval);
  }, [fetchRoutes]);

  // WebSocket
  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus('connected');
      ws.onclose = () => {
        setWsStatus('disconnected');
        setTimeout(connect, 3000);
      };
      ws.onerror = () => setWsStatus('error');
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'alert') {
            setAlerts(prev => [
              { ...msg, id: Date.now() },
              ...prev.slice(0, 49)
            ]);
          }
        } catch {}
      };
    }
    connect();
    return () => wsRef.current?.close();
  }, []);

  const handleAdvance = async () => {
    setAdvancing(true);
    try {
      await fetch(`${API}/simulate/advance`, { method: 'POST' });
      setSimHour(h => h + 1);
      await fetchRoutes();
    } catch (e) {
      console.error('Advance failed', e);
    } finally {
      setAdvancing(false);
    }
  };

  const handleRouteClick = (route) => {
    setSelectedRoute(route);
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo">◈ ROUTERADAR</span>
          <span className="tagline">AI SUPPLY CHAIN DISRUPTION PREDICTOR</span>
        </div>
        <div className="header-center">
          <div className={`ws-indicator ws-${wsStatus}`}>
            <span className="ws-dot" />
            {wsStatus.toUpperCase()}
          </div>
          <span className="sim-clock">SIM HOUR +{simHour}</span>
        </div>
        <div className="header-right">
          <button
            className={`advance-btn ${advancing ? 'loading' : ''}`}
            onClick={handleAdvance}
            disabled={advancing}
          >
            {advancing ? '⟳ ADVANCING...' : '⏩ ADVANCE TIME +1HR'}
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="main">
        <div className="map-container">
          <MapView routes={routes} onRouteClick={handleRouteClick} selectedRouteId={selectedRoute?.route_id} />
        </div>

        <div className="sidebar">
          {selectedRoute ? (
            <RouteDetail
              route={selectedRoute}
              onClose={() => setSelectedRoute(null)}
              api={API}
            />
          ) : (
            <AlertFeed alerts={alerts} routes={routes} />
          )}
        </div>
      </div>
    </div>
  );
}
