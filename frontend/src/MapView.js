import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const riskColor = (score) => {
  if (score < 0.4) return '#22c55e';
  if (score < 0.7) return '#f59e0b';
  return '#ef4444';
};

const riskWeight = (score) => {
  if (score > 0.7) return 5;
  if (score > 0.4) return 4;
  return 3;
};

export default function MapView({ routes, onRouteClick, selectedRouteId }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polylinesRef = useRef({});

  // Init map
  useEffect(() => {
    if (mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [22.5, 78.9],
      zoom: 5,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    mapInstanceRef.current = map;
  }, []);

  // Update polylines when routes change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || routes.length === 0) return;

    routes.forEach((route) => {
      const rid = route.route_id;
      const coords = route.geojson?.coordinates?.map(([lng, lat]) => [lat, lng]) || [];
      const color = riskColor(route.risk_score);
      const weight = riskWeight(route.risk_score);
      const isSelected = rid === selectedRouteId;

      // Remove old
      if (polylinesRef.current[rid]) {
        map.removeLayer(polylinesRef.current[rid]);
        // Also remove glow layer if present
        if (polylinesRef.current[`${rid}_glow`]) {
          map.removeLayer(polylinesRef.current[`${rid}_glow`]);
        }
      }

      // Glow layer (wider, lower opacity) for high-risk
      if (route.risk_score > 0.7) {
        const glow = L.polyline(coords, {
          color,
          weight: weight + 6,
          opacity: 0.2,
        }).addTo(map);
        polylinesRef.current[`${rid}_glow`] = glow;
      }

      const line = L.polyline(coords, {
        color,
        weight: isSelected ? weight + 2 : weight,
        opacity: isSelected ? 1 : 0.82,
        dashArray: route.risk_score > 0.7 ? '6,4' : null,
      });

      // Tooltip
      line.bindTooltip(
        `<div class="route-tooltip">
          <strong>${route.name}</strong><br/>
          RISK: ${(route.risk_score * 100).toFixed(1)}%
        </div>`,
        { sticky: true, className: 'route-tooltip' }
      );

      line.on('click', () => onRouteClick(route));

      line.addTo(map);
      polylinesRef.current[rid] = line;
    });
  }, [routes, selectedRouteId, onRouteClick]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        left: 16,
        zIndex: 1000,
        background: '#0d1426',
        border: '1px solid #1e293b',
        padding: '10px 14px',
        fontFamily: 'Courier New, monospace',
        fontSize: '10px',
        letterSpacing: '1px',
        color: '#64748b',
      }}>
        <div style={{ marginBottom: 6, color: '#00d4ff' }}>RISK LEVEL</div>
        {[['#22c55e', 'LOW  ( &lt; 0.4 )'],
          ['#f59e0b', 'MED  ( 0.4–0.7 )'],
          ['#ef4444', 'HIGH ( &gt; 0.7 )']].map(([c, l]) => (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 24, height: 3, background: c }} />
            <span dangerouslySetInnerHTML={{ __html: l }} />
          </div>
        ))}
      </div>
    </div>
  );
}
