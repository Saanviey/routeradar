"""
gemini_service.py — Groq-powered alert summary generation for RouteRadar
Model: llama-3.1-8b-instant (free tier)
"""

import os
import json
import urllib.request
import urllib.error
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable not set")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"

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
    """Call Groq API and return alert text. Falls back to template if API fails."""

    prompt = build_prompt(route_id, snapshot, risk_score)

    payload = json.dumps({
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.4,
        "max_tokens": 120,
    }).encode("utf-8")

    req = urllib.request.Request(
        GROQ_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "User-Agent": "RouteRadar/1.0",
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            text = data["choices"][0]["message"]["content"].strip()
            print("[Groq] Success")
            return text

    except urllib.error.HTTPError as e:
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            error_body = "(unreadable)"
        print(f"[Groq] HTTP {e.code}: {error_body[:200]}")

    except Exception as e:
        print(f"[Groq] Error: {type(e).__name__}: {e}")

    print("[Groq] Using fallback message")
    return _fallback_message(route_id, snapshot, risk_score)


def _fallback_message(route_id: str, snapshot: dict, risk_score: float) -> str:
    """Deterministic fallback when Groq is unavailable."""
    ctx = ROUTE_CONTEXT.get(route_id, {})
    name = ctx.get("full_name", route_id)
    confidence = round(risk_score * 90 + 5)
    hours_ahead = max(1, round((1 - risk_score) * 20))

    return (
        f"High disruption risk detected on {name} ({ctx.get('highway', '')}) — "
        f"weather severity {snapshot['weather_severity']:.1f}/10 combined with "
        f"congestion index {snapshot['port_congestion_index']:.1f}/10 is expected to cause "
        f"significant delays within {hours_ahead} hours. "
        f"Risk score: {risk_score:.2f}. Confidence: {confidence}%. "
        f"Consider activating alternate routing protocols immediately."
    )


def debug_connection():
    """Test Groq connection."""
    print(f"[Debug] Groq key loaded: {'YES' if GROQ_API_KEY else 'NO'}")
    print(f"[Debug] Key prefix: {GROQ_API_KEY[:8]}...")
    print(f"[Debug] Model: {GROQ_MODEL}")

    payload = json.dumps({
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": "Say hello in one word."}],
        "max_tokens": 10,
    }).encode("utf-8")

    req = urllib.request.Request(
        GROQ_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "User-Agent": "RouteRadar/1.0",
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            reply = data["choices"][0]["message"]["content"].strip()
            print(f"[Debug] SUCCESS — Response: {reply}")
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
        except Exception:
            body = "(unreadable)"
        print(f"[Debug] HTTP ERROR {e.code}: {body}")
    except Exception as e:
        print(f"[Debug] EXCEPTION: {type(e).__name__}: {e}")


if __name__ == "__main__":
    debug_connection()