# RouteRadar — AI-Powered Supply Chain Disruption Predictor

A prototype web application that uses XGBoost to predict supply chain disruptions across Indian logistics routes in real-time.

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL 14+ (running locally)

---

## 1. Database Setup

Create the database:

```bash
psql -U postgres -c "CREATE DATABASE routeradar;"
```

> The app auto-creates all tables on startup. No manual schema setup needed.

---

## 2. Backend Setup

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# (Optional) Pre-train the model before starting the server
# The server will auto-train if route_model.pkl is missing
python train_model.py

# Start the server
uvicorn main:app --reload --port 8000
```

On startup the backend will:
1. Seed 48 hours of simulated route data into PostgreSQL
2. Train the XGBoost model (if not already trained)
3. Pre-compute risk scores for all snapshots
4. Start the WebSocket alert loop

---

## 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start React dev server
npm start
```

Open **http://localhost:3000** in your browser.

---

## Environment Variables (optional)

The backend uses these defaults — override via env vars if needed:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/routeradar
```

---

## Demo Scenario

1. App loads → map shows **3 green routes** (Mumbai→Delhi, Delhi→Kolkata, Mumbai→Chennai)
2. Click **"⏩ ADVANCE TIME +1HR"** repeatedly (each click = +1 simulated hour)
3. At **hour 30**, Mumbai→Delhi weather severity spikes to 8.5, congestion to 9.0
4. Route turns **red** on the map, alert fires to the right panel:
   > *"High disruption risk on Mumbai → Delhi in approximately 14 hours. Risk score: 0.87. Confidence: 78%"*
5. Click the red route → see risk history chart spike + 2 alternate routes
6. Demo complete ✓

---

## Architecture

```
backend/
├── main.py           # FastAPI app — all endpoints + WebSocket
├── simulate_data.py  # 48h fake route data generator + DB seeder
├── train_model.py    # XGBoost training script
├── route_model.pkl   # Trained model (auto-generated)
└── requirements.txt

frontend/
├── src/
│   ├── App.js        # Root component — layout, state, WebSocket client
│   ├── MapView.js    # Leaflet map with colored route polylines
│   ├── AlertFeed.js  # Live alert panel (WebSocket)
│   ├── RouteDetail.js # Route drill-down with Recharts history
│   └── App.css       # Dark industrial dashboard styles
└── public/
    └── index.html
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/routes` | All routes with current risk scores |
| GET | `/routes/{id}/history` | Last 24h risk history |
| GET | `/routes/{id}/alternates` | 2 alternate routes with stats |
| POST | `/simulate/advance` | Advance simulation clock +1 hour |
| WS | `/ws/alerts` | Real-time alert stream |

---

## Notes

- No external API calls — all data is simulated
- No authentication required
- OSRM is not used — routes use hardcoded GeoJSON coordinates
- Model targets ~70%+ accuracy on simulated training data
