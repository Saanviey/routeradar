"""
RouteRadar — AI-powered supply chain disruption predictor
FastAPI backend: main.py
"""

import asyncio
import json
import os
import pickle
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Try to import PostgreSQL libraries, but fallback gracefully
try:
    import psycopg2
    import psycopg2.extras
    POSTGRES_AVAILABLE = True
except ImportError:
    POSTGRES_AVAILABLE = False
    print("PostgreSQL not available, using SQLite")

from gemini_service import generate_alert_message

load_dotenv()

print("STARTING MAIN.PY")

# Database configuration - use SQLite for Hugging Face
DATABASE_URL = os.getenv("DATABASE_URL", "")

# If no PostgreSQL URL, use SQLite
if not DATABASE_URL or "localhost" in DATABASE_URL:
    DATABASE_URL = "sqlite:///./routeradar.db"
    USE_SQLITE = True
    print("Using SQLite database")
else:
    USE_SQLITE = False
    print("Using PostgreSQL database")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "route_model.pkl")

# ─── Alternate routes (hardcoded per spec) ─────────────────────────────────────
ALTERNATES = {
    "MUM_DEL": [
        {
            "name": "Via Rajkot–Ahmedabad corridor",
            "risk_score": 0.22,
            "extra_time_minutes": 95,
            "extra_distance_km": 210,
        },
        {
            "name": "Via Surat–Vadodara bypass",
            "risk_score": 0.31,
            "extra_time_minutes": 60,
            "extra_distance_km": 145,
        },
    ],
    "DEL_KOL": [
        {
            "name": "Via Varanasi–Patna NH route",
            "risk_score": 0.18,
            "extra_time_minutes": 70,
            "extra_distance_km": 130,
        },
        {
            "name": "Via Lucknow–Gorakhpur corridor",
            "risk_score": 0.29,
            "extra_time_minutes": 45,
            "extra_distance_km": 90,
        },
    ],
    "MUM_CHE": [
        {
            "name": "Via Pune–Solapur highway",
            "risk_score": 0.20,
            "extra_time_minutes": 55,
            "extra_distance_km": 120,
        },
        {
            "name": "Via Goa coastal route",
            "risk_score": 0.35,
            "extra_time_minutes": 110,
            "extra_distance_km": 185,
        },
    ],
}

# ─── Globals ────────────────────────────────────────────────────────────────────
model = None
sim_hour_offset = 0
connected_clients: List[WebSocket] = []


# ─── DB helpers ─────────────────────────────────────────────────────────────────
def get_conn():
    """Get database connection - works with both PostgreSQL and SQLite"""
    if USE_SQLITE or not POSTGRES_AVAILABLE:
        # SQLite connection
        conn = sqlite3.connect('routeradar.db')
        conn.row_factory = sqlite3.Row
        return conn
    else:
        # PostgreSQL connection
        return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def init_sqlite_db():
    """Initialize SQLite database tables if they don't exist"""
    if USE_SQLITE or not POSTGRES_AVAILABLE:
        conn = sqlite3.connect('routeradar.db')
        cursor = conn.cursor()
        
        # Create route_snapshots table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS route_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                route_id TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                weather_severity REAL,
                port_congestion_index REAL,
                traffic_speed_ratio REAL,
                is_holiday BOOLEAN,
                hour_of_day INTEGER,
                day_of_week INTEGER,
                risk_score REAL,
                is_disruption BOOLEAN
            )
        ''')
        
        # Create alerts table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                route_id TEXT NOT NULL,
                triggered_at TIMESTAMP NOT NULL,
                risk_score REAL,
                message TEXT
            )
        ''')
        
        conn.commit()
        conn.close()
        print("SQLite database initialized")


def predict_risk(features: dict) -> float:
    """Run the loaded XGBoost model and return a probability."""
    if model is None:
        return 0.0
    X = np.array([[
        features["weather_severity"],
        features["port_congestion_index"],
        features["traffic_speed_ratio"],
        1 if features["is_holiday"] else 0,
        features["hour_of_day"],
        features["day_of_week"],
    ]], dtype=float)
    prob = float(model.predict_proba(X)[0][1])
    return round(prob, 4)


def get_latest_snapshot(route_id: str) -> Optional[dict]:
    with get_conn() as conn:
        cursor = conn.cursor()
        if USE_SQLITE or not POSTGRES_AVAILABLE:
            cursor.execute("""
                SELECT * FROM route_snapshots
                WHERE route_id = ?
                ORDER BY id DESC
                LIMIT 1
            """, (route_id,))
        else:
            cursor.execute("""
                SELECT * FROM route_snapshots
                WHERE route_id = %s
                ORDER BY id DESC
                LIMIT 1
            """, (route_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def update_risk_score(snapshot_id: int, risk_score: float):
    with get_conn() as conn:
        cursor = conn.cursor()
        if USE_SQLITE or not POSTGRES_AVAILABLE:
            cursor.execute(
                "UPDATE route_snapshots SET risk_score = ? WHERE id = ?",
                (risk_score, snapshot_id)
            )
        else:
            cursor.execute(
                "UPDATE route_snapshots SET risk_score = %s WHERE id = %s",
                (risk_score, snapshot_id)
            )
        conn.commit()


# ─── WebSocket broadcast ─────────────────────────────────────────────────────────
async def broadcast(message: dict):
    dead = []
    for ws in connected_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        connected_clients.remove(ws)


# ─── Alert loop ─────────────────────────────────────────────────────────────────
async def alert_loop():
    """Every 30s check all routes; push alert if risk > 0.7."""
    try:
        from simulate_data import ROUTES
    except ImportError:
        print("simulate_data not available")
        return
    
    while True:
        await asyncio.sleep(30)
        try:
            for route in ROUTES:
                rid = route["route_id"]
                snap = get_latest_snapshot(rid)
                if not snap:
                    continue
                risk = predict_risk(snap)
                if risk > 0.7:
                    alert_text = generate_alert_message(rid, snap, risk)
                    msg = {
                        "type": "alert",
                        "route_id": rid,
                        "route_name": route["name"],
                        "risk_score": risk,
                        "message": alert_text,
                        "triggered_at": datetime.now(timezone.utc).isoformat(),
                        "ai_generated": True,
                    }
                    await broadcast(msg)
                    # Persist alert
                    with get_conn() as conn:
                        cursor = conn.cursor()
                        if USE_SQLITE or not POSTGRES_AVAILABLE:
                            cursor.execute("""
                                INSERT INTO alerts (route_id, triggered_at, risk_score, message)
                                VALUES (?, ?, ?, ?)
                            """, (rid, datetime.now(timezone.utc), risk, msg["message"]))
                        else:
                            cursor.execute("""
                                INSERT INTO alerts (route_id, triggered_at, risk_score, message)
                                VALUES (%s, %s, %s, %s)
                            """, (rid, datetime.now(timezone.utc), risk, msg["message"]))
                        conn.commit()
        except Exception as e:
            print(f"[alert_loop] error: {e}")


# ─── Lifespan ────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global model

    # Initialize SQLite database
    init_sqlite_db()

    # 1. Seed database
    print("Seeding database...")
    try:
        from simulate_data import seed_database
        if not USE_SQLITE:
            seed_database(DATABASE_URL)
        else:
            print("Using SQLite - seeding may be handled by simulate_data")
    except Exception as e:
        print(f"DB startup skipped or failed: {e}")

    # 2. Train model if not present, else load
    if not os.path.exists(MODEL_PATH):
        print("Training model...")
        try:
            from train_model import train
            train()
        except Exception as e:
            print(f"Model training failed: {e}")

    print("Loading model...")
    try:
        with open(MODEL_PATH, "rb") as f:
            model = pickle.load(f)
        print("Model loaded.")
    except Exception as e:
        print(f"Model loading failed: {e}")
        model = None

    # 3. Pre-compute and store risk scores for all snapshots
    try:
        from simulate_data import ROUTES
        with get_conn() as conn:
            cursor = conn.cursor()
            for route in ROUTES:
                if USE_SQLITE or not POSTGRES_AVAILABLE:
                    cursor.execute(
                        "SELECT id, weather_severity, port_congestion_index, traffic_speed_ratio, is_holiday, hour_of_day, day_of_week FROM route_snapshots WHERE route_id = ?",
                        (route["route_id"],)
                    )
                else:
                    cursor.execute(
                        "SELECT id, weather_severity, port_congestion_index, traffic_speed_ratio, is_holiday, hour_of_day, day_of_week FROM route_snapshots WHERE route_id = %s",
                        (route["route_id"],)
                    )
                rows = cursor.fetchall()
                for row in rows:
                    risk = predict_risk(dict(row))
                    if USE_SQLITE or not POSTGRES_AVAILABLE:
                        cursor.execute("UPDATE route_snapshots SET risk_score = ? WHERE id = ?", (risk, row["id"]))
                    else:
                        cursor.execute("UPDATE route_snapshots SET risk_score = %s WHERE id = %s", (risk, row["id"]))
            conn.commit()
    except Exception as e:
        print(f"Risk score precomputation failed: {e}")

    # 4. Start alert loop
    asyncio.create_task(alert_loop())
    print("RouteRadar backend ready.")

    yield  # app runs here


# ─── App ─────────────────────────────────────────────────────────────────────────
app = FastAPI(title="RouteRadar", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health Check Endpoint ──────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "status": "healthy",
        "service": "RouteRadar API",
        "version": "1.0.0",
        "database": "SQLite" if USE_SQLITE else "PostgreSQL",
        "model_loaded": model is not None,
        "endpoints": [
            "/routes",
            "/routes/{id}/history",
            "/routes/{id}/alternates",
            "/simulate/advance",
            "/simulate/reset",
            "/simulate/trigger-disruption",
            "/impact",
            "/ws/alerts"
        ]
    }


# ─── Endpoints ───────────────────────────────────────────────────────────────────
@app.get("/routes")
async def list_routes():
    try:
        from simulate_data import ROUTES, ROUTE_GEOJSON
    except ImportError:
        return {"error": "simulate_data module not available"}
    
    result = []
    for route in ROUTES:
        rid = route["route_id"]
        snap = get_latest_snapshot(rid)
        if snap:
            risk = predict_risk(snap)
            update_risk_score(snap["id"], risk)
        else:
            risk = 0.0
        result.append({
            "route_id": rid,
            "name": route["name"],
            "risk_score": risk,
            "geojson": ROUTE_GEOJSON.get(rid, {}),
            "latest_snapshot": {
                "weather_severity": snap["weather_severity"] if snap else 0,
                "port_congestion_index": snap["port_congestion_index"] if snap else 0,
                "traffic_speed_ratio": snap["traffic_speed_ratio"] if snap else 1,
            } if snap else None
        })
    return result


@app.get("/routes/{route_id}/history")
async def route_history(route_id: str):
    with get_conn() as conn:
        cursor = conn.cursor()
        if USE_SQLITE or not POSTGRES_AVAILABLE:
            cursor.execute("""
                SELECT timestamp, risk_score, weather_severity, port_congestion_index
                FROM route_snapshots
                WHERE route_id = ?
                ORDER BY timestamp DESC
                LIMIT 24
            """, (route_id,))
        else:
            cursor.execute("""
                SELECT timestamp, risk_score, weather_severity, port_congestion_index
                FROM route_snapshots
                WHERE route_id = %s
                ORDER BY timestamp DESC
                LIMIT 24
            """, (route_id,))
        rows = cursor.fetchall()
    return [dict(r) for r in reversed(rows)]


@app.get("/routes/{route_id}/alternates")
async def route_alternates(route_id: str):
    alts = ALTERNATES.get(route_id, [])
    return {"route_id": route_id, "alternates": alts}


@app.post("/simulate/advance")
async def advance_simulation():
    """Advance sim clock by 1 hour — insert a new snapshot for each route."""
    global sim_hour_offset
    sim_hour_offset += 1

    try:
        from simulate_data import ROUTES, generate_snapshots
    except ImportError:
        return {"error": "simulate_data module not available"}

    base_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    all_snaps = generate_snapshots(base_time)

    n_routes = len(ROUTES)
    hour_idx = min(sim_hour_offset, 47)

    route_snaps = {}
    for i, s in enumerate(all_snaps):
        if i // n_routes == hour_idx:
            route_snaps[s["route_id"]] = s

    now = datetime.now(timezone.utc)
    inserted = []
    with get_conn() as conn:
        cursor = conn.cursor()
        for route in ROUTES:
            rid = route["route_id"]
            snap = route_snaps.get(rid)
            if not snap:
                continue
            risk = predict_risk(snap)
            
            if USE_SQLITE or not POSTGRES_AVAILABLE:
                cursor.execute("""
                    INSERT INTO route_snapshots
                    (route_id, timestamp, weather_severity, port_congestion_index,
                     traffic_speed_ratio, is_holiday, hour_of_day, day_of_week,
                     risk_score, is_disruption)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    rid, now,
                    snap["weather_severity"], snap["port_congestion_index"],
                    snap["traffic_speed_ratio"], snap["is_holiday"],
                    snap["hour_of_day"], snap["day_of_week"],
                    risk, snap["is_disruption"]
                ))
            else:
                cursor.execute("""
                    INSERT INTO route_snapshots
                    (route_id, timestamp, weather_severity, port_congestion_index,
                     traffic_speed_ratio, is_holiday, hour_of_day, day_of_week,
                     risk_score, is_disruption)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    rid, now,
                    snap["weather_severity"], snap["port_congestion_index"],
                    snap["traffic_speed_ratio"], snap["is_holiday"],
                    snap["hour_of_day"], snap["day_of_week"],
                    risk, snap["is_disruption"]
                ))
            
            inserted.append({
                "route_id": rid,
                "risk_score": risk,
                "weather_severity": snap["weather_severity"],
                "port_congestion_index": snap["port_congestion_index"],
                "is_disruption": snap["is_disruption"],
            })

            # Immediately send alert if risk > 0.7
            if risk > 0.7:
                alert_text = generate_alert_message(rid, snap, risk)
                msg = {
                    "type": "alert",
                    "route_id": rid,
                    "route_name": route["name"],
                    "risk_score": risk,
                    "message": alert_text,
                    "triggered_at": now.isoformat(),
                    "ai_generated": True,
                }
                asyncio.create_task(broadcast(msg))
                
                if USE_SQLITE or not POSTGRES_AVAILABLE:
                    cursor.execute("""
                        INSERT INTO alerts (route_id, triggered_at, risk_score, message)
                        VALUES (?, ?, ?, ?)
                    """, (rid, now, risk, msg["message"]))
                else:
                    cursor.execute("""
                        INSERT INTO alerts (route_id, triggered_at, risk_score, message)
                        VALUES (%s, %s, %s, %s)
                    """, (rid, now, risk, msg["message"]))

        conn.commit()

    return {
        "advanced_to_hour": sim_hour_offset,
        "hour_index_used": hour_idx,
        "snapshots": inserted,
    }


@app.get("/impact")
async def get_impact():
    """Return impact metrics: CO2 saved, cost savings, disruptions caught."""
    try:
        from simulate_data import ROUTES, ROUTE_CONTEXT
    except ImportError:
        return {"error": "simulate_data module not available"}

    CO2_PER_KM_TRUCK = 0.9
    COST_PER_KM_INR = 45
    DISRUPTION_DELAY_HOURS = 6
    HOURLY_CARGO_VALUE_INR = 85000

    with get_conn() as conn:
        cursor = conn.cursor()
        if USE_SQLITE or not POSTGRES_AVAILABLE:
            cursor.execute("SELECT COUNT(*) as cnt FROM alerts WHERE risk_score > 0.7")
        else:
            cursor.execute("SELECT COUNT(*) as cnt FROM alerts WHERE risk_score > 0.7")
        disruptions_caught = cursor.fetchone()["cnt"]

        route_stats = []
        for route in ROUTES:
            rid = route["route_id"]
            ctx = ROUTE_CONTEXT.get(rid, {})
            dist = ctx.get("distance_km", 1300)

            alt_dist_saved = dist * 0.15
            co2_saved = round(alt_dist_saved * CO2_PER_KM_TRUCK, 1)
            cost_saved = round(alt_dist_saved * COST_PER_KM_INR)

            if USE_SQLITE or not POSTGRES_AVAILABLE:
                cursor.execute(
                    "SELECT COUNT(*) as cnt FROM alerts WHERE route_id=? AND risk_score > 0.7",
                    (rid,)
                )
            else:
                cursor.execute(
                    "SELECT COUNT(*) as cnt FROM alerts WHERE route_id=%s AND risk_score > 0.7",
                    (rid,)
                )
            route_disruptions = cursor.fetchone()["cnt"]

            route_stats.append({
                "route_id": rid,
                "name": route["name"],
                "disruptions_caught": route_disruptions,
                "co2_saved_kg": co2_saved * route_disruptions if route_disruptions else 0,
                "cost_saved_inr": cost_saved * route_disruptions if route_disruptions else 0,
            })

    total_co2 = sum(r["co2_saved_kg"] for r in route_stats)
    total_cost = sum(r["cost_saved_inr"] for r in route_stats)
    delay_hours_avoided = disruptions_caught * DISRUPTION_DELAY_HOURS
    cargo_value_protected = disruptions_caught * DISRUPTION_DELAY_HOURS * HOURLY_CARGO_VALUE_INR

    return {
        "summary": {
            "disruptions_caught": disruptions_caught,
            "co2_saved_kg": round(total_co2, 1),
            "co2_saved_trees_equivalent": round(total_co2 / 21, 1),
            "cost_saved_inr": total_cost,
            "delay_hours_avoided": delay_hours_avoided,
            "cargo_value_protected_inr": cargo_value_protected,
            "sdg_goals": ["SDG 9: Industry & Infrastructure", "SDG 13: Climate Action"],
        },
        "by_route": route_stats,
    }


@app.post("/simulate/reset")
async def reset_simulation():
    """Re-seed the DB back to normal starting state."""
    global sim_hour_offset
    sim_hour_offset = 0

    try:
        from simulate_data import seed_database
        if not USE_SQLITE:
            seed_database(DATABASE_URL)
    except Exception as e:
        print(f"Reset skipped: {e}")

    # Re-compute risk scores
    try:
        from simulate_data import ROUTES
        with get_conn() as conn:
            cursor = conn.cursor()
            for route in ROUTES:
                if USE_SQLITE or not POSTGRES_AVAILABLE:
                    cursor.execute(
                        "SELECT id, weather_severity, port_congestion_index, traffic_speed_ratio, is_holiday, hour_of_day, day_of_week FROM route_snapshots WHERE route_id = ?",
                        (route["route_id"],)
                    )
                else:
                    cursor.execute(
                        "SELECT id, weather_severity, port_congestion_index, traffic_speed_ratio, is_holiday, hour_of_day, day_of_week FROM route_snapshots WHERE route_id = %s",
                        (route["route_id"],)
                    )
                rows = cursor.fetchall()
                for row in rows:
                    risk = predict_risk(dict(row))
                    if USE_SQLITE or not POSTGRES_AVAILABLE:
                        cursor.execute("UPDATE route_snapshots SET risk_score = ? WHERE id = ?", (risk, row["id"]))
                    else:
                        cursor.execute("UPDATE route_snapshots SET risk_score = %s WHERE id = %s", (risk, row["id"]))
            conn.commit()
    except Exception as e:
        print(f"Risk recomputation failed: {e}")

    return {"status": "reset complete", "sim_hour": 0}


@app.post("/simulate/trigger-disruption")
async def trigger_disruption():
    """Directly inject the hour-30 disruption snapshot for demo purposes."""
    global sim_hour_offset
    sim_hour_offset = 30

    try:
        from simulate_data import ROUTES
    except ImportError:
        return {"error": "simulate_data module not available"}

    disruption_snaps = {
        "MUM_DEL": {
            "weather_severity": 8.5,
            "port_congestion_index": 9.0,
            "traffic_speed_ratio": 0.25,
            "is_holiday": False,
            "hour_of_day": 6,
            "day_of_week": 2,
            "is_disruption": True,
        },
        "DEL_KOL": {
            "weather_severity": 1.8,
            "port_congestion_index": 3.2,
            "traffic_speed_ratio": 0.82,
            "is_holiday": False,
            "hour_of_day": 6,
            "day_of_week": 2,
            "is_disruption": False,
        },
        "MUM_CHE": {
            "weather_severity": 2.1,
            "port_congestion_index": 2.8,
            "traffic_speed_ratio": 0.78,
            "is_holiday": False,
            "hour_of_day": 6,
            "day_of_week": 2,
            "is_disruption": False,
        },
    }

    now = datetime.now(timezone.utc)
    inserted = []
    with get_conn() as conn:
        cursor = conn.cursor()
        for route in ROUTES:
            rid = route["route_id"]
            snap = disruption_snaps[rid]
            risk = predict_risk(snap)
            
            if USE_SQLITE or not POSTGRES_AVAILABLE:
                cursor.execute("""
                    INSERT INTO route_snapshots
                    (route_id, timestamp, weather_severity, port_congestion_index,
                     traffic_speed_ratio, is_holiday, hour_of_day, day_of_week,
                     risk_score, is_disruption)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    rid, now,
                    snap["weather_severity"], snap["port_congestion_index"],
                    snap["traffic_speed_ratio"], snap["is_holiday"],
                    snap["hour_of_day"], snap["day_of_week"],
                    risk, snap["is_disruption"]
                ))
            else:
                cursor.execute("""
                    INSERT INTO route_snapshots
                    (route_id, timestamp, weather_severity, port_congestion_index,
                     traffic_speed_ratio, is_holiday, hour_of_day, day_of_week,
                     risk_score, is_disruption)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    rid, now,
                    snap["weather_severity"], snap["port_congestion_index"],
                    snap["traffic_speed_ratio"], snap["is_holiday"],
                    snap["hour_of_day"], snap["day_of_week"],
                    risk, snap["is_disruption"]
                ))
            
            inserted.append({"route_id": rid, "risk_score": risk})

            if risk > 0.7:
                alert_text = generate_alert_message(rid, snap, risk)
                msg = {
                    "type": "alert",
                    "route_id": rid,
                    "route_name": route["name"],
                    "risk_score": risk,
                    "message": alert_text,
                    "triggered_at": now.isoformat(),
                    "ai_generated": True,
                }
                asyncio.create_task(broadcast(msg))
                
                if USE_SQLITE or not POSTGRES_AVAILABLE:
                    cursor.execute("""
                        INSERT INTO alerts (route_id, triggered_at, risk_score, message)
                        VALUES (?, ?, ?, ?)
                    """, (rid, now, risk, msg["message"]))
                else:
                    cursor.execute("""
                        INSERT INTO alerts (route_id, triggered_at, risk_score, message)
                        VALUES (%s, %s, %s, %s)
                    """, (rid, now, risk, msg["message"]))

        conn.commit()

    return {"status": "disruption injected", "snapshots": inserted}


@app.websocket("/ws/alerts")
async def ws_alerts(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in connected_clients:
            connected_clients.remove(websocket)