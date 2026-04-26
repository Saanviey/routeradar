import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const riskColor = (score) => {
  if (score < 0.4) return '#4ade80';
  if (score < 0.7) return '#fbbf24';
  return '#f87171';
};

// Inject pulse keyframes once into the document
const injectStyles = () => {
  if (document.getElementById('routeradar-map-styles')) return;
  const style = document.createElement('style');
  style.id = 'routeradar-map-styles';
  style.textContent = `
    @keyframes pulse-glow {
      0%   { stroke-opacity: 0.15; stroke-width: 18px; }
      50%  { stroke-opacity: 0.38; stroke-width: 26px; }
      100% { stroke-opacity: 0.15; stroke-width: 18px; }
    }
    @keyframes pulse-mid {
      0%   { stroke-opacity: 0.25; stroke-width: 10px; }
      50%  { stroke-opacity: 0.55; stroke-width: 14px; }
      100% { stroke-opacity: 0.25; stroke-width: 10px; }
    }
    @keyframes dash-flow {
      0%   { stroke-dashoffset: 0; }
      100% { stroke-dashoffset: -32; }
    }
    @keyframes pulse-amber {
      0%   { stroke-opacity: 0.12; stroke-width: 14px; }
      50%  { stroke-opacity: 0.28; stroke-width: 20px; }
      100% { stroke-opacity: 0.12; stroke-width: 14px; }
    }
    .rr-pulse-outer {
      animation: pulse-glow 1.6s ease-in-out infinite;
    }
    .rr-pulse-mid {
      animation: pulse-mid 1.6s ease-in-out infinite;
      animation-delay: 0.15s;
    }
    .rr-dash-flow {
      stroke-dasharray: 16, 10;
      animation: dash-flow 0.9s linear infinite;
    }
    .rr-amber-pulse {
      animation: pulse-amber 2.4s ease-in-out infinite;
    }
    .rr-dot-pulse {
      animation: pulse-glow 1.6s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
};

// Apply CSS animation classes directly to Leaflet's SVG path element
const animatePath = (polyline, className) => {
  const el = polyline.getElement?.();
  if (el) {
    el.classList.add(className);
    // Ensure SVG element is visible and not clipped
    el.style.pointerEvents = 'none';
  } else {
    console.warn('[RouteRadar] animatePath: SVG element not found for', className);
  }
};

export default function MapView({ routes, allRoutes, onRouteClick, selectedRouteId, compareRouteId, compareMode }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layersRef = useRef({});

  useEffect(() => {
    injectStyles();
    if (mapInstanceRef.current) return;
    const map = L.map(mapRef.current, {
      center: [22.5, 78.9],
      zoom: 5,
      zoomControl: true,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
    mapInstanceRef.current = map;
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || routes.length === 0) return;

    routes.forEach((route) => {
      const rid = route.route_id;
      const coords = route.geojson?.coordinates?.map(([lng, lat]) => [lat, lng]) || [];
      const color = riskColor(route.risk_score);
      const isSelected = rid === selectedRouteId;
      const isCompare = rid === compareRouteId;
      const isHigh = route.risk_score > 0.7;
      const isAmber = route.risk_score >= 0.4 && route.risk_score <= 0.7;

      // Remove all old layers for this route
      ['outer', 'mid', 'main', 'dot'].forEach(k => {
        const key = `${rid}_${k}`;
        if (layersRef.current[key]) {
          map.removeLayer(layersRef.current[key]);
          delete layersRef.current[key];
        }
      });

      if (isHigh) {
        // ── HIGH RISK: 3-layer animated pulse ──────────────────────

        // Layer 1: wide outer pulse (animated via CSS on SVG path)
        const outer = L.polyline(coords, {
          color: '#f87171',
          weight: 18,
          opacity: 0.15,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(map);
        // Wait one frame so Leaflet has rendered the SVG element
        setTimeout(() => animatePath(outer, 'rr-pulse-outer'), 150);
        layersRef.current[`${rid}_outer`] = outer;

        // Layer 2: mid glow pulse
        const mid = L.polyline(coords, {
          color: '#f87171',
          weight: 10,
          opacity: 0.25,
          lineCap: 'round',
          interactive: false,
        }).addTo(map);
        setTimeout(() => animatePath(mid, 'rr-pulse-mid'), 150);
        layersRef.current[`${rid}_mid`] = mid;

        // Layer 3: main dashed flowing line
        const main = L.polyline(coords, {
          color: '#f87171',
          weight: isSelected ? 5 : 3.5,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
        });
        setTimeout(() => animatePath(main, 'rr-dash-flow'), 150);

        main.bindTooltip(tooltipHTML(route, color), { sticky: true, className: 'route-tooltip' });
        main.on('click', () => onRouteClick(route));
        main.addTo(map);
        layersRef.current[`${rid}_main`] = main;

      } else if (isAmber) {
        // ── AMBER: gentle slow pulse ────────────────────────────────

        const outer = L.polyline(coords, {
          color: '#fbbf24',
          weight: 14,
          opacity: 0.12,
          interactive: false,
        }).addTo(map);
        setTimeout(() => animatePath(outer, 'rr-amber-pulse'), 150);
        layersRef.current[`${rid}_outer`] = outer;

        const main = L.polyline(coords, {
          color: '#fbbf24',
          weight: isSelected ? 4.5 : 3,
          opacity: 0.88,
          lineCap: 'round',
        });
        main.bindTooltip(tooltipHTML(route, color), { sticky: true, className: 'route-tooltip' });
        main.on('click', () => onRouteClick(route));
        main.addTo(map);
        layersRef.current[`${rid}_main`] = main;

      } else {
        // ── GREEN: static clean line ────────────────────────────────

        // Subtle static glow
        const outer = L.polyline(coords, {
          color: '#4ade80',
          weight: 8,
          opacity: isSelected ? 0.14 : 0.07,
          interactive: false,
        }).addTo(map);
        layersRef.current[`${rid}_outer`] = outer;

        const main = L.polyline(coords, {
          color: '#4ade80',
          weight: isSelected ? 4 : 2.5,
          opacity: isSelected ? 1 : 0.82,
          lineCap: 'round',
        });
        main.bindTooltip(tooltipHTML(route, color), { sticky: true, className: 'route-tooltip' });
        main.on('click', () => onRouteClick(route));
        main.addTo(map);
        layersRef.current[`${rid}_main`] = main;
      }

      // ── Midpoint marker dot ──────────────────────────────────────
      const midIdx = Math.floor(coords.length / 2);
      if (coords[midIdx]) {
        const dotColor = isCompare ? '#a78bfa' : color;
        const dot = L.circleMarker(coords[midIdx], {
          radius: isSelected ? 8 : isHigh ? 7 : 5,
          fillColor: dotColor,
          color: '#050810',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.95,
        });
        if (isHigh) {
          setTimeout(() => {
            const el = dot.getElement?.();
            if (el) el.style.filter = `drop-shadow(0 0 6px ${dotColor})`;
          }, 150);
        }
        dot.on('click', () => onRouteClick(route));
        dot.addTo(map);
        layersRef.current[`${rid}_dot`] = dot;
      }

      // Compare mode: purple tint on selected compare route
      if (isCompare) {
        setTimeout(() => {
          const el = layersRef.current[`${rid}_main`]?.getElement?.();
          if (el) { el.style.stroke = '#a78bfa'; }
        }, 150);
      }
    });
  }, [routes, selectedRouteId, compareRouteId, onRouteClick]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 24, left: 16, zIndex: 1000,
        background: 'rgba(8,13,26,0.92)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8, padding: '12px 16px',
        backdropFilter: 'blur(12px)',
        fontFamily: "'Space Mono', monospace",
      }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: '#38bdf8', marginBottom: 10 }}>RISK LEVEL</div>
        {[
          ['#4ade80', 'rgba(74,222,128,0.12)', 'LOW',  '< 0.4',   'static'],
          ['#fbbf24', 'rgba(251,191,36,0.12)',  'MED',  '0.4–0.7', 'slow pulse'],
          ['#f87171', 'rgba(248,113,113,0.12)', 'HIGH', '> 0.7',   'animated ●'],
        ].map(([c, bg, label, range, hint]) => (
          <div key={c} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 7, padding: '5px 8px',
            background: bg, borderRadius: 4,
          }}>
            <div style={{
              width: 28, height: 4, background: c, borderRadius: 2,
              boxShadow: `0 0 8px ${c}`,
            }} />
            <span style={{ fontSize: 9, color: c }}>{label}</span>
            <span style={{ fontSize: 9, color: '#475569' }}>{range}</span>
            <span style={{ fontSize: 8, color: '#334155', marginLeft: 'auto' }}>{hint}</span>
          </div>
        ))}
      </div>

      {/* Click hint */}
      <div style={{
        position: 'absolute', bottom: 24, right: 16, zIndex: 1000,
        background: 'rgba(8,13,26,0.85)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 6, padding: '8px 14px',
        fontFamily: "'Space Mono', monospace",
        fontSize: 9, color: '#475569', letterSpacing: 1,
        backdropFilter: 'blur(8px)',
      }}>
        {compareMode ? '⇄ COMPARE MODE — CLICK TWO ROUTES' : 'CLICK ROUTE TO INSPECT'}
      </div>
    </div>
  );
}

function tooltipHTML(route, color) {
  const isHigh = route.risk_score > 0.7;
  return `
    <div style="font-family:'DM Sans',sans-serif;min-width:140px">
      <strong style="font-size:13px;color:#f0f4f8">${route.name}</strong>
      <div style="margin-top:6px;display:flex;align-items:center;gap:8px">
        <div style="
          font-family:'Space Mono',monospace;font-size:12px;font-weight:700;color:${color};
          ${isHigh ? `text-shadow:0 0 12px ${color}` : ''}
        ">
          ${(route.risk_score * 100).toFixed(1)}%
        </div>
        ${isHigh ? `<span style="font-size:9px;color:#f87171;letter-spacing:1px;background:rgba(248,113,113,0.15);padding:1px 6px;border-radius:3px">⚠ HIGH RISK</span>` : ''}
      </div>
      <div style="font-size:10px;color:#64748b;margin-top:4px">Click to inspect →</div>
    </div>
  `;
}