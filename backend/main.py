"""
RouteRadar — AI-powered supply chain disruption predictor
FastAPI backend: main.py
"""

import asyncio
import json
import os
import pickle
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import numpy as np
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from gemini_service import generate_alert_message
from fastapi.middleware.cors import CORSMiddleware

import os
from dotenv import load_dotenv

load_dotenv()

print("STARTING MAIN.PY")

DATABASE_URL = os.getenv("DATABASE_URL", "")

print("DATABASE_URL =", DATABASE_URL if DATABASE_URL else "NOT SET")

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
sim_hour_offset = 0          # how many hours we've "advanced" past seeded data
connected_clients: List[WebSocket] = []


# ─── DB helpers ─────────────────────────────────────────────────────────────────
def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


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
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM route_snapshots
                WHERE route_id = %s
                ORDER BY id DESC
                LIMIT 1
            """, (route_id,))
            row = cur.fetchone()
            return dict(row) if row else None


def update_risk_score(snapshot_id: int, risk_score: float):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
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
    from simulate_data import ROUTES
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
                        with conn.cursor() as cur:
                            cur.execute("""
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

    # 1. Seed database
    print("Seeding database...")
    from simulate_data import seed_database
    try:
        if DATABASE_URL and "localhost" not in DATABASE_URL:
          seed_database(DATABASE_URL)
        else:
         print("Skipping DB seed on startup")
    except Exception as e:
       print("DB startup skipped:", e)

    # 2. Train model if not present, else load
    if not os.path.exists(MODEL_PATH):
        print("Training model...")
        from train_model import train
        train()

    print("Loading model...")
    with open(MODEL_PATH, "rb") as f:
        model = pickle.load(f)
    print("Model loaded.")

    # 3. Pre-compute and store risk scores for all snapshots
    from simulate_data import ROUTES
    with get_conn() as conn:
        with conn.cursor() as cur:
            for route in ROUTES:
                cur.execute(
                    "SELECT id, weather_severity, port_congestion_index, traffic_speed_ratio, is_holiday, hour_of_day, day_of_week FROM route_snapshots WHERE route_id = %s",
                    (route["route_id"],)
                )
                rows = cur.fetchall()
                for row in rows:
                    risk = predict_risk(dict(row))
                    cur.execute("UPDATE route_snapshots SET risk_score = %s WHERE id = %s", (risk, row["id"]))
        conn.commit()

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


# ─── Endpoints ───────────────────────────────────────────────────────────────────

@app.get("/routes")
async def list_routes():
    from simulate_data import ROUTES, ROUTE_GEOJSON
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
            "geojson": ROUTE_GEOJSON[rid],
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
        with conn.cursor() as cur:
            cur.execute("""
                SELECT timestamp, risk_score, weather_severity, port_congestion_index
                FROM route_snapshots
                WHERE route_id = %s
                ORDER BY timestamp DESC
                LIMIT 24
            """, (route_id,))
            rows = cur.fetchall()
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

    from simulate_data import ROUTES, generate_snapshots
    from datetime import timezone

    # Generate full 48h dataset. Snapshots are ordered:
    # hour0_route0, hour0_route1, hour0_route2, hour1_route0, ...
    # So hour N = indices N*3 .. N*3+2
    # The hardcoded disruption is at hour index 30 in simulate_data.py
    base_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    all_snaps = generate_snapshots(base_time)

    n_routes = len(ROUTES)
    hour_idx = min(sim_hour_offset, 47)  # advance 30 times -> hour_idx = 30 -> hits disruption

    route_snaps = {}
    for i, s in enumerate(all_snaps):
        if i // n_routes == hour_idx:
            route_snaps[s["route_id"]] = s

    now = datetime.now(timezone.utc)
    inserted = []
    with get_conn() as conn:
        with conn.cursor() as cur:
            for route in ROUTES:
                rid = route["route_id"]
                snap = route_snaps.get(rid)
                if not snap:
                    continue
                risk = predict_risk(snap)
                cur.execute("""
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
                    cur.execute("""
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
    from simulate_data import ROUTES, ROUTE_CONTEXT

    # Constants for impact calculation
    CO2_PER_KM_TRUCK = 0.9          # kg CO2 per km (avg Indian heavy truck)
    COST_PER_KM_INR = 45            # INR per km logistics cost
    DISRUPTION_DELAY_HOURS = 6      # avg hours lost per unmitigated disruption
    HOURLY_CARGO_VALUE_INR = 85000  # avg cargo value per hour of delay

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Total disruptions detected
            cur.execute("SELECT COUNT(*) as cnt FROM alerts WHERE risk_score > 0.7")
            disruptions_caught = cur.fetchone()["cnt"]

            # Per route stats
            route_stats = []
            for route in ROUTES:
                rid = route["route_id"]
                ctx = ROUTE_CONTEXT.get(rid, {})
                dist = ctx.get("distance_km", 1300)

                # Alt route is ~15% longer on average
                alt_dist_saved = dist * 0.15
                co2_saved = round(alt_dist_saved * CO2_PER_KM_TRUCK, 1)
                cost_saved = round(alt_dist_saved * COST_PER_KM_INR)

                cur.execute(
                    "SELECT COUNT(*) as cnt FROM alerts WHERE route_id=%s AND risk_score > 0.7",
                    (rid,)
                )
                route_disruptions = cur.fetchone()["cnt"]

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
            "co2_saved_trees_equivalent": round(total_co2 / 21, 1),  # avg tree absorbs 21kg/yr
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

    from simulate_data import seed_database

    try:
        if DATABASE_URL and "localhost" not in DATABASE_URL:
            seed_database(DATABASE_URL)
        else:
            print("Skipping DB seed")
    except Exception as e:
        print("DB startup skipped:", e)

    return {"message": "Simulation reset complete"}
    # Re-compute risk scores
    from simulate_data import ROUTES
    with get_conn() as conn:
        with conn.cursor() as cur:
            for route in ROUTES:
                cur.execute(
                    "SELECT id, weather_severity, port_congestion_index, traffic_speed_ratio, is_holiday, hour_of_day, day_of_week FROM route_snapshots WHERE route_id = %s",
                    (route["route_id"],)
                )
                rows = cur.fetchall()
                for row in rows:
                    risk = predict_risk(dict(row))
                    cur.execute("UPDATE route_snapshots SET risk_score = %s WHERE id = %s", (risk, row["id"]))
        conn.commit()
    return {"status": "reset complete", "sim_hour": 0}

@app.post("/simulate/trigger-disruption")
async def trigger_disruption():
    """Directly inject the hour-30 disruption snapshot for demo purposes."""
    global sim_hour_offset
    sim_hour_offset = 30

    from simulate_data import ROUTES
    from datetime import timezone

    # Hardcode the exact disruption values instead of relying on index math
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
        with conn.cursor() as cur:
            for route in ROUTES:
                rid = route["route_id"]
                snap = disruption_snaps[rid]
                risk = predict_risk(snap)
                cur.execute("""
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
                    cur.execute("""
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
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        if websocket in connected_clients:
            connected_clients.remove(websocket)