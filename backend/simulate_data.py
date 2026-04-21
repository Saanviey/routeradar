import random
import math
from datetime import datetime, timedelta, timezone
from typing import List, Dict

ROUTES = [
    {"route_id": "MUM_DEL", "name": "Mumbai → Delhi"},
    {"route_id": "DEL_KOL", "name": "Delhi → Kolkata"},
    {"route_id": "MUM_CHE", "name": "Mumbai → Chennai"},
]

ROUTE_GEOJSON = {
    "MUM_DEL": {
        "type": "LineString",
        "coordinates": [
            [72.8777, 19.0760],
            [73.8567, 20.0059],
            [74.6018, 21.1458],
            [75.3433, 22.7196],
            [75.8577, 23.2599],
            [76.4318, 23.8388],
            [77.1025, 24.5800],
            [77.4126, 25.4358],
            [77.6729, 26.4499],
            [77.2090, 28.6139],
        ]
    },
    "DEL_KOL": {
        "type": "LineString",
        "coordinates": [
            [77.2090, 28.6139],
            [78.0081, 27.1767],
            [79.0193, 26.8467],
            [80.9462, 26.8467],
            [82.9739, 25.3176],
            [83.9956, 25.3176],
            [85.1376, 25.5941],
            [86.9415, 23.6850],
            [87.8550, 23.2237],
            [88.3639, 22.5726],
        ]
    },
    "MUM_CHE": {
        "type": "LineString",
        "coordinates": [
            [72.8777, 19.0760],
            [73.3120, 17.6868],
            [74.0479, 16.7050],
            [74.4977, 15.3647],
            [76.6394, 14.4426],
            [77.5946, 12.9716],
            [78.1198, 11.6643],
            [79.1288, 10.7905],
            [79.8083, 10.1632],
            [80.2707, 13.0827],
        ]
    }
}

ROUTE_CONTEXT = {
    "MUM_DEL": {
        "full_name": "Mumbai to Delhi",
        "highway": "NH48",
        "distance_km": 1400,
    },
    "DEL_KOL": {
        "full_name": "Delhi to Kolkata",
        "highway": "NH19",
        "distance_km": 1500,
    },
    "MUM_CHE": {
        "full_name": "Mumbai to Chennai",
        "highway": "NH48",
        "distance_km": 1300,
    },
}


def generate_snapshots(base_time: datetime) -> List[Dict]:
    snapshots = []
    for hour in range(48):
        ts = base_time + timedelta(hours=hour)
        hour_of_day = ts.hour
        day_of_week = ts.weekday()

        for route in ROUTES:
            rid = route["route_id"]

            # Base values with mild random variation
            weather = round(random.uniform(1.0, 3.5), 2)
            congestion = round(random.uniform(1.5, 4.0), 2)
            speed_ratio = round(random.uniform(0.6, 0.95), 3)
            is_holiday = day_of_week >= 5

            # Rush hour traffic effect
            if 8 <= hour_of_day <= 10 or 17 <= hour_of_day <= 20:
                speed_ratio = round(speed_ratio * 0.75, 3)
                congestion = round(congestion + random.uniform(0.5, 1.5), 2)

            # Night calm
            if 0 <= hour_of_day <= 5:
                weather = round(weather * 0.8, 2)
                congestion = round(congestion * 0.7, 2)
                speed_ratio = round(min(speed_ratio * 1.1, 1.0), 3)

            # HARDCODED DISRUPTION: at hour 30, MUM_DEL spikes
            if hour == 30 and rid == "MUM_DEL":
                weather = 8.5
                congestion = 9.0
                speed_ratio = 0.25

            is_disruption = weather > 7 or congestion > 7

            snapshots.append({
                "route_id": rid,
                "timestamp": ts.isoformat(),
                "weather_severity": weather,
                "port_congestion_index": congestion,
                "traffic_speed_ratio": speed_ratio,
                "is_holiday": is_holiday,
                "hour_of_day": hour_of_day,
                "day_of_week": day_of_week,
                "is_disruption": is_disruption,
            })

    return snapshots


def seed_database(db_url: str = None):
    """Seed the database with simulated data. Returns snapshots for use by caller."""
    import psycopg2
    import json
    import os

    db_url = db_url or os.getenv(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/routeradar"
    )

    base_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=24)
    snapshots = generate_snapshots(base_time)

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Create tables
    cur.execute("""
        CREATE TABLE IF NOT EXISTS routes (
            id SERIAL PRIMARY KEY,
            route_id VARCHAR(50) UNIQUE,
            name VARCHAR(100),
            geojson TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS route_snapshots (
            id SERIAL PRIMARY KEY,
            route_id VARCHAR(50),
            timestamp TIMESTAMPTZ,
            weather_severity FLOAT,
            port_congestion_index FLOAT,
            traffic_speed_ratio FLOAT,
            is_holiday BOOLEAN,
            hour_of_day INT,
            day_of_week INT,
            risk_score FLOAT DEFAULT 0,
            is_disruption BOOLEAN
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id SERIAL PRIMARY KEY,
            route_id VARCHAR(50),
            triggered_at TIMESTAMPTZ,
            risk_score FLOAT,
            message TEXT
        )
    """)

    # Clear existing data
    cur.execute("DELETE FROM route_snapshots")
    cur.execute("DELETE FROM routes")
    cur.execute("DELETE FROM alerts")

    # Insert routes
    for route in ROUTES:
        cur.execute(
            "INSERT INTO routes (route_id, name, geojson) VALUES (%s, %s, %s) ON CONFLICT (route_id) DO UPDATE SET name=EXCLUDED.name, geojson=EXCLUDED.geojson",
            (route["route_id"], route["name"], json.dumps(ROUTE_GEOJSON[route["route_id"]]))
        )

    # Insert snapshots
    for s in snapshots:
        cur.execute("""
            INSERT INTO route_snapshots
            (route_id, timestamp, weather_severity, port_congestion_index,
             traffic_speed_ratio, is_holiday, hour_of_day, day_of_week, is_disruption)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            s["route_id"], s["timestamp"], s["weather_severity"],
            s["port_congestion_index"], s["traffic_speed_ratio"],
            s["is_holiday"], s["hour_of_day"], s["day_of_week"],
            s["is_disruption"]
        ))

    conn.commit()
    cur.close()
    conn.close()
    print(f"Seeded {len(snapshots)} snapshots across {len(ROUTES)} routes.")
    return snapshots


if __name__ == "__main__":
    seed_database()