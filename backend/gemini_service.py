"""
gemini_service.py — Gemini-powered alert summary generation for RouteRadar
Uses gemini-2.5-flash-lite (1000 req/day free tier)
"""

import os
import json
import urllib.request
import urllib.error

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash-lite-preview-06-17"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

ROUTE_CONTEXT = {
    "MUM_DEL": {
        "full_name": "Mumbai to Delhi",
        "highway": "NH48",
        "distance_km": 1400,
        "key_hubs": "Jawaharlal Nehru Port Trust (JNPT), Surat industrial corridor, Vadodara logistics hub",
        "cargo_types": "automotive parts, textiles, electronics, FMCG",
    },
    "DEL_KOL": {
        "full_name": "Delhi to Kolkata",
        "highway": "NH19",
        "distance_km": 1500,
        "key_hubs": "Delhi NCR warehousing belt, Kanpur industrial zone, Varanasi distribution hub, Kolkata port",
        "cargo_types": "garments, steel, agricultural produce, consumer goods",
    },
    "MUM_CHE": {
        "full_name": "Mumbai to Chennai",
        "highway": "NH48",
        "distance_km": 1300,
        "key_hubs": "Pune auto cluster, Bangalore tech corridor, Chennai port",
        "cargo_types": "automobiles, pharma, IT equipment, perishables",
    },
}


def build_prompt(route_id: str, snapshot: dict, risk_score: float) -> str:
    ctx = ROUTE_CONTEXT.get(route_id, {})
    confidence = round(risk_score * 90 + 5)
    hours_ahead = max(1, round((1 - risk_score) * 20))

    weather_desc = (
        "severe weather conditions (heavy rain/storm activity)"
        if snapshot["weather_severity"] > 7
        else "moderate weather disruptions"
        if snapshot["weather_severity"] > 4
        else "mild weather conditions"
    )

    congestion_desc = (
        "critical port and highway congestion"
        if snapshot["port_congestion_index"] > 7
        else "elevated congestion levels"
        if snapshot["port_congestion_index"] > 4
        else "moderate traffic congestion"
    )

    return f"""You are an AI logistics analyst for an Indian supply chain monitoring system called RouteRadar.

Generate a concise, professional disruption alert (2-3 sentences max) for the following situation:

Route: {ctx.get('full_name', route_id)} ({ctx.get('highway', 'N/A')}, ~{ctx.get('distance_km', 0)} km)
Key hubs: {ctx.get('key_hubs', 'N/A')}
Primary cargo: {ctx.get('cargo_types', 'N/A')}

Current conditions:
- Weather severity: {snapshot['weather_severity']:.1f}/10 ({weather_desc})
- Port/highway congestion index: {snapshot['port_congestion_index']:.1f}/10 ({congestion_desc})
- Traffic speed ratio: {snapshot['traffic_speed_ratio']:.2f} (1.0 = normal, lower = slower)
- AI disruption risk score: {risk_score:.2%}
- Model confidence: {confidence}%
- Estimated disruption onset: {hours_ahead} hours

Write the alert in a factual, urgent tone. Mention the specific conditions, estimated impact window, and one actionable recommendation. Do not use bullet points. Keep it under 60 words.
"""


def generate_alert_message(route_id: str, snapshot: dict, risk_score: float) -> str:
    """Call Gemini API and return alert text. Falls back to template if API fails."""

    if not GEMINI_API_KEY:
        return _fallback_message(route_id, snapshot, risk_score)

    prompt = build_prompt(route_id, snapshot, risk_score)

    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 120,
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        GEMINI_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
            text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            return text
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        print(f"[Gemini] HTTP {e.code}: {error_body[:200]}")
        return _fallback_message(route_id, snapshot, risk_score)
    except Exception as e:
        print(f"[Gemini] Error: {e}")
        return _fallback_message(route_id, snapshot, risk_score)


def _fallback_message(route_id: str, snapshot: dict, risk_score: float) -> str:
    """Deterministic fallback when Gemini is unavailable."""
    ctx = ROUTE_CONTEXT.get(route_id, {})
    name = ctx.get("full_name", route_id)
    confidence = round(risk_score * 90 + 5)
    hours_ahead = max(1, round((1 - risk_score) * 20))

    weather_str = f"weather severity {snapshot['weather_severity']:.1f}/10"
    congestion_str = f"congestion index {snapshot['port_congestion_index']:.1f}/10"

    return (
        f"High disruption risk detected on {name} ({ctx.get('highway','')}) — "
        f"{weather_str} combined with {congestion_str} is expected to cause "
        f"significant delays within {hours_ahead} hours. "
        f"Risk score: {risk_score:.2f}. Confidence: {confidence}%. "
        f"Consider activating alternate routing protocols immediately."
    )
