"""
Train a simple XGBoost disruption predictor using simulated route data.
Saves model to route_model.pkl.
"""

import pickle
import numpy as np
from datetime import datetime, timedelta, timezone

from simulate_data import generate_snapshots


def build_training_data(snapshots):
    X, y = [], []
    for s in snapshots:
        features = [
            s["weather_severity"],
            s["port_congestion_index"],
            s["traffic_speed_ratio"],
            1 if s["is_holiday"] else 0,
            s["hour_of_day"],
            s["day_of_week"],
        ]
        label = 1 if s["is_disruption"] else 0
        X.append(features)
        y.append(label)
    return np.array(X, dtype=float), np.array(y, dtype=int)


def _add_synthetic_disruptions(snapshots):
    """Add synthetic high-risk samples to balance training data."""
    import random
    extras = []
    for _ in range(200):
        # High-risk samples
        weather = random.uniform(7.1, 10.0)
        congestion = random.uniform(7.1, 10.0)
        extras.append({
            "route_id": "SYNTH",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "weather_severity": weather,
            "port_congestion_index": congestion,
            "traffic_speed_ratio": random.uniform(0.1, 0.4),
            "is_holiday": random.choice([True, False]),
            "hour_of_day": random.randint(0, 23),
            "day_of_week": random.randint(0, 6),
            "is_disruption": True,
        })
        # Medium samples
        extras.append({
            "route_id": "SYNTH",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "weather_severity": random.uniform(4.0, 7.0),
            "port_congestion_index": random.uniform(4.0, 7.0),
            "traffic_speed_ratio": random.uniform(0.4, 0.7),
            "is_holiday": random.choice([True, False]),
            "hour_of_day": random.randint(0, 23),
            "day_of_week": random.randint(0, 6),
            "is_disruption": False,
        })
    return snapshots + extras


def train():
    try:
        from xgboost import XGBClassifier
    except ImportError:
        raise ImportError("xgboost not installed. Run: pip install xgboost")

    # Generate several days of simulated data for training variety
    all_snapshots = []
    base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=120)
    for day_offset in range(5):
        day_base = base + timedelta(hours=day_offset * 48)
        all_snapshots.extend(generate_snapshots(day_base))

    # Balance with synthetic disruption examples
    all_snapshots = _add_synthetic_disruptions(all_snapshots)

    X, y = build_training_data(all_snapshots)

    print(f"Training on {len(X)} samples | Disruption rate: {y.mean():.2%}")

    model = XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        use_label_encoder=False,
        eval_metric="logloss",
        random_state=42,
    )
    model.fit(X, y)

    # Quick accuracy check on training data
    preds = model.predict(X)
    accuracy = (preds == y).mean()
    print(f"Training accuracy: {accuracy:.2%}")

    with open("route_model.pkl", "wb") as f:
        pickle.dump(model, f)

    print("Model saved to route_model.pkl")
    return model


if __name__ == "__main__":
    train()
