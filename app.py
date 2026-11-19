#!/usr/bin/env python3
"""
Smart Study AI Timetable Generator v3.0
========================================
Multi-Page Architecture with:
  - Email + Password only login (no Google OAuth)
  - Hardcoded Admin account (rock19yash2007@gmail.com / yash07)
  - Per-user dedicated SQL data files in user_data/ folder
  - User access logs recorded per-user
  - Admin panel with full user management
  - 6 distinct pages: Home, Planner, Saved Plans, My Account, Login, Register, Admin

Run:
    python app.py

Optional environment variables:
    GOOGLE_API_KEY / GEMINI_API_KEY   Server-side Gemini API key
    GEMINI_MODEL                      Default model (default: gemini-2.5-flash)
    HOST, PORT                        Listen address (default 127.0.0.1:8000)
    NO_BROWSER=1                      Do not auto-open browser
"""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import sys
import threading
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ============================================================================
# Configuration
# ============================================================================

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
SERVER_KEY = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""
API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_BODY = 300_000

# Admin credentials — only this account has admin privileges
ADMIN_EMAIL = "rock19yash2007@gmail.com"
ADMIN_PASSWORD = "yash07"

# File paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE_PATH = os.path.join(BASE_DIR, "user.db")
SQL_FILE_PATH = os.path.join(BASE_DIR, "user.sql")
USER_DATA_DIR = os.path.join(BASE_DIR, "user_data")
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

# Regex helpers
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
MODEL_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
SESSION_TYPES = ("learn", "revise", "practice", "mock-test")

TYPE_MAP = {
    "revise": "revise", "revision": "revise", "review": "revise", "recap": "revise",
    "practice": "practice", "problem-solving": "practice", "problems": "practice",
    "exercise": "practice", "exercises": "practice", "drill": "practice",
    "mock-test": "mock-test", "mock_test": "mock-test", "mock": "mock-test",
    "test": "mock-test", "exam": "mock-test", "quiz": "mock-test",
    "learn": "learn", "study": "learn", "reading": "learn",
    "lecture": "learn", "theory": "learn",
}

db_lock = threading.Lock()


# ============================================================================
# Custom Exceptions
# ============================================================================

class InputError(ValueError):
    """The request from the web page was invalid."""


class ApiError(Exception):
    """Something went wrong talking to Gemini."""
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


# ============================================================================
# Input Validation & Normalization Utilities
# ============================================================================

def clean_text(value, limit=300):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def parse_date(value):
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def num(value, default, lo, hi):
    try:
        n = float(value)
    except (TypeError, ValueError):
        n = default
    if not math.isfinite(n):
        n = default
    return max(lo, min(hi, n))


def norm_time(value):
    if not value:
        return None
    s = str(value).strip().upper()
    match_ampm = re.match(r"^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)$", s)
    if match_ampm:
        h = int(match_ampm.group(1))
        m = int(match_ampm.group(2) or 0)
        ampm = match_ampm.group(3)
        if ampm == "PM" and h < 12:
            h += 12
        elif ampm == "AM" and h == 12:
            h = 0
        if 0 <= h <= 23 and 0 <= m <= 59:
            return "%02d:%02d" % (h, m)
    match_24 = re.match(r"^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$", s)
    if match_24:
        return "%02d:%s" % (int(match_24.group(1)), match_24.group(2))
    return None


def norm_session_type(raw_type):
    k = str(raw_type or "").strip().lower().replace("_", "-")
    if k in TYPE_MAP:
        return TYPE_MAP[k]
    for key, mapped in TYPE_MAP.items():
        if key in k:
            return mapped
    return "learn"


def clean_request(data):
    if not isinstance(data, dict):
        raise InputError("Invalid request format.")
    start = parse_date(data.get("start_date")) or date.today()
    subjects = []
    raw_subjects = data.get("subjects")
    for item in (raw_subjects if isinstance(raw_subjects, list) else [])[:16]:
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get("name"), 80)
        if not name:
            continue
        exam = parse_date(item.get("exam_date")) if item.get("exam_date") else None
        if exam and exam < start:
            raise InputError("The exam date for '%s' is before the timetable start date." % name)
        difficulty = str(item.get("difficulty") or "medium").lower()
        if difficulty not in ("easy", "medium", "hard"):
            difficulty = "medium"
        subjects.append({
            "name": name, "exam_date": exam,
            "difficulty": difficulty,
            "topics": clean_text(item.get("topics"), 400),
        })
    if not subjects:
        raise InputError("Please add at least one subject with a name.")
    window_start = norm_time(data.get("window_start")) or "09:00"
    window_end = norm_time(data.get("window_end")) or "21:00"
    if window_end <= window_start:
        raise InputError("The daily study window end time must be after the start time.")
    requested_days = int(num(data.get("days"), 7, 1, 30))
    return {
        "subjects": subjects,
        "start_date": start,
        "days": requested_days,
        "weekday_hours": num(data.get("weekday_hours"), 3, 0.5, 14),
        "weekend_hours": num(data.get("weekend_hours"), 5, 0.5, 14),
        "window_start": window_start,
        "window_end": window_end,
        "session_minutes": int(num(data.get("session_minutes"), 50, 20, 150)),
        "break_minutes": int(num(data.get("break_minutes"), 10, 0, 45)),
        "notes": clean_text(data.get("notes"), 800),
    }


# ============================================================================
# Gemini API Caller
# ============================================================================

JSON_SHAPE = """{
  "summary": "1-2 sentence high-level overview of how the plan is balanced",
  "tips": ["actionable practical tip tailored to this student", "..."],
  "days": [
    {
      "date": "YYYY-MM-DD",
      "sessions": [
        {
          "start": "HH:MM",
          "end": "HH:MM",
          "subject": "exact subject name from the list",
          "topic": "specific subtopic or problem set to cover in this session",
          "type": "learn | revise | practice | mock-test"
        }
      ]
    }
  ]
}"""


def build_prompt(req):
    start = req["start_date"]
    day_lines = []
    for i in range(req["days"]):
        d = start + timedelta(days=i)
        limit = req["weekend_hours"] if d.weekday() >= 5 else req["weekday_hours"]
        day_lines.append("- %s (%s): target up to %g study hours" % (
            d.isoformat(), d.strftime("%A"), limit))
    subject_lines = []
    for i, s in enumerate(req["subjects"], 1):
        parts = ["%d. %s" % (i, s["name"]), "difficulty: %s" % s["difficulty"]]
        if s["exam_date"]:
            gap = (s["exam_date"] - start).days
            parts.append("exam on %s (%d days from plan start)" % (s["exam_date"].isoformat(), gap))
        else:
            parts.append("no exam date specified")
        if s["topics"]:
            parts.append("topics/chapters: %s" % s["topics"])
        subject_lines.append(" | ".join(parts))
    notes = req["notes"] or "none"
    return (
        "You are an expert academic tutor and productivity coach. Create an optimal, day-by-day study timetable.\n\n"
        "PLAN DATES TO COVER (include an entry for each date):\n" + "\n".join(day_lines) + "\n\n"
        "DAILY STUDY WINDOW: %s to %s (24-hour HH:MM clock)\n"
        "TARGET SESSION LENGTH: approximately %d minutes, with %d minutes break between sessions "
        "(do NOT include breaks as sessions in the list)\n\n"
        "SUBJECTS:\n" % (req["window_start"], req["window_end"],
                         req["session_minutes"], req["break_minutes"])
        + "\n".join(subject_lines) + "\n\n"
        "STUDENT COMMITMENTS & PREFERENCES: " + notes + "\n\n"
        "SCHEDULING RULES:\n"
        "1. Every single session MUST use strict 24-hour HH:MM format (e.g. '09:00', '14:30').\n"
        "2. All sessions must fit inside the daily study window (%s to %s) and must not overlap.\n"
        "3. Total study time per day must respect that day's target study hours.\n"
        "4. Prioritize harder subjects and subjects with imminent exams.\n"
        "5. Do NOT schedule a subject after its exam date. Final 2-3 days: revision, practice, mock tests.\n"
        "6. Make every 'topic' concrete and actionable.\n"
        "7. 'type' MUST be one of: 'learn', 'revise', 'practice', 'mock-test'.\n"
        "8. 'subject' must exactly match one of the student's subject names.\n"
        "9. Provide 3-5 high-impact, motivational study tips tailored to this specific schedule.\n"
        "10. Return ONLY valid JSON in this exact structure, no markdown code fences and no preamble:\n"
        % (req["window_start"], req["window_end"])
        + JSON_SHAPE
    )


def explain_http_error(err):
    detail = ""
    try:
        body = json.loads(err.read().decode("utf-8", "replace"))
        detail = body.get("error", {}).get("message", "")
    except Exception:
        detail = ""
    detail = clean_text(detail, 300)
    if err.code in (400, 401, 403) and re.search(r"api key|permission|unauthenticated|denied", detail, re.I):
        return "Google rejected the API key. Please check that it was copied correctly from Google AI Studio and has the Gemini API enabled."
    if err.code == 404:
        return "The requested Gemini model was not found. Please choose 'gemini-2.5-flash' or another model."
    if err.code == 429:
        return "Google Gemini rate limit exceeded. Please wait a minute before generating another timetable."
    return "Google Gemini API error (%d): %s" % (err.code, detail or err.reason)


def call_gemini(api_key, model, prompt):
    clean_model = model.strip()
    if clean_model.startswith("models/"):
        clean_model = clean_model[7:]
    body = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 16384,
            "responseMimeType": "application/json",
        },
    }).encode("utf-8")
    request = urllib.request.Request(
        API_URL.format(model=clean_model),
        data=body, method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raise ApiError(explain_http_error(err), err.code if err.code in (400, 401, 403, 404, 429) else 502)
    except urllib.error.URLError as err:
        raise ApiError("Could not reach Google Gemini API: %s" % err.reason, 502)
    except OSError:
        raise ApiError("The request to Gemini timed out. Try again or select a shorter plan duration.", 504)
    except ValueError:
        raise ApiError("Gemini returned an unreadable response format.", 502)

    candidates = payload.get("candidates") or []
    if not candidates:
        reason = (payload.get("promptFeedback") or {}).get("blockReason")
        raise ApiError("The AI model returned no content%s." % (" (reason: %s)" % reason if reason else ""), 502)
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    if not text.strip():
        finish = candidates[0].get("finishReason", "unknown")
        raise ApiError("The model returned an empty timetable (finish reason: %s)." % finish, 502)
    return text


def parse_plan_json(text):
    text = text.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence_match:
        text = fence_match.group(1).strip()
    else:
        first, last = text.find("{"), text.rfind("}")
        if first != -1 and last > first:
            text = text[first:last + 1]
    try:
        return json.loads(text)
    except ValueError:
        pass
    try:
        cleaned = re.sub(r",\s*([\]}])", r"\1", text)
        return json.loads(cleaned)
    except ValueError:
        pass
    raise ApiError(
        "The AI's answer was truncated or invalid JSON. Try generating a shorter plan (e.g. 7 days) or fewer subjects.",
        502,
    )


def sanitize_plan(raw, req):
    if not isinstance(raw, dict):
        raise ApiError("The AI response did not contain a valid timetable dictionary.", 502)
    by_date = {}
    valid_subjects = {s["name"].strip().lower(): s["name"] for s in req["subjects"]}
    fallback_subject = req["subjects"][0]["name"] if req["subjects"] else "Study"
    for day in raw.get("days") if isinstance(raw.get("days"), list) else []:
        if not isinstance(day, dict):
            continue
        d = parse_date(day.get("date"))
        if not d:
            continue
        for s in day.get("sessions") if isinstance(day.get("sessions"), list) else []:
            if not isinstance(s, dict):
                continue
            start, end = norm_time(s.get("start")), norm_time(s.get("end"))
            if not start or not end or end <= start:
                continue
            raw_subj = clean_text(s.get("subject"), 80)
            subj = valid_subjects.get(raw_subj.lower(), raw_subj or fallback_subject)
            topic = clean_text(s.get("topic"), 200)
            kind = norm_session_type(s.get("type"))
            by_date.setdefault(d.isoformat(), []).append({
                "start": start, "end": end, "subject": subj, "topic": topic, "type": kind,
            })
    days = []
    for i in range(req["days"]):
        d = req["start_date"] + timedelta(days=i)
        iso = d.isoformat()
        sessions = sorted(by_date.get(iso, []), key=lambda x: x["start"])
        days.append({
            "date": iso, "weekday": d.strftime("%a"),
            "full_date": d.strftime("%B %d, %Y"), "sessions": sessions,
        })
    if not any(day["sessions"] for day in days):
        raise ApiError("The AI did not generate any usable study sessions. Please try again.", 502)
    raw_tips = raw.get("tips")
    tips = []
    if isinstance(raw_tips, list):
        for t in raw_tips[:8]:
            ct = clean_text(t, 250)
            if ct:
                tips.append(ct)
    elif isinstance(raw_tips, str) and raw_tips.strip():
        tips = [clean_text(raw_tips, 250)]
    return {
        "summary": clean_text(raw.get("summary"), 600) or "Adaptive timetable balancing priority subjects and active recall sessions.",
        "tips": tips or [
            "Use active recall: spend 5 minutes testing yourself before checking notes.",
            "Take timed breaks away from your screen to sustain mental endurance.",
            "Keep an error log of tricky problems and review it before sleeping.",
        ],
        "days": days,
    }


def generate_sample_plan(req):
    start = req["start_date"]
    subjects = [s["name"] for s in req["subjects"]] or ["Mathematics", "Physics", "Chemistry", "Computer Science"]
    days_data = []
    types = ["learn", "revise", "practice", "mock-test"]
    topics_pool = {
        "mathematics": ["Calculus: Integration by Parts & Substitution", "Linear Algebra: Matrices & Eigenvalues",
                        "Probability Distributions & Bayes Theorem", "Trigonometric Functions & Identities",
                        "Differential Equations & Modeling"],
        "physics": ["Thermodynamics: Heat Engines & Entropy", "Electromagnetism: Faraday's Law & Induction",
                    "Optics: Interference & Diffraction Grating", "Classical Mechanics: Rotational Dynamics",
                    "Quantum Mechanics: Photoelectric Effect"],
        "chemistry": ["Organic Chemistry: Reaction Mechanisms", "Chemical Kinetics: Reaction Rates & Catalysis",
                      "Electrochemistry: Nernst Equation & Cells", "Coordination Chemistry: Isomerism & Bonding",
                      "Thermodynamics: Enthalpy & Free Energy"],
        "computer science": ["Data Structures: Trees, Graphs & Heaps", "Dynamic Programming: Memoization & Tabulation",
                              "Operating Systems: Concurrency & Deadlocks", "Database Systems: SQL & Normalization",
                              "Network Protocols: TCP/IP & HTTP/3"],
        "default": ["Core Concepts & Foundational Theory", "High-Yield Problem Solving Workshop",
                    "Formula Sheet & Summary Notes Review", "Past Exam Questions (Timed Drill)",
                    "Weak Area Diagnosis & Remediation"],
    }
    sess_len = req["session_minutes"]
    brk_len = req["break_minutes"]
    slot_len = sess_len + brk_len
    sh, sm = map(int, req["window_start"].split(":"))
    eh, em = map(int, req["window_end"].split(":"))
    window_max = eh * 60 + em
    for i in range(req["days"]):
        d = start + timedelta(days=i)
        is_weekend = d.weekday() >= 5
        target_hours = req["weekend_hours"] if is_weekend else req["weekday_hours"]
        curr_min = sh * 60 + sm
        sessions = []
        max_sess = max(1, int((target_hours * 60) / sess_len))
        for s_idx in range(max_sess):
            if curr_min + sess_len > window_max:
                break
            s_subj = subjects[(i + s_idx) % len(subjects)]
            s_type = types[(i + s_idx) % len(types)]
            pool = topics_pool.get(s_subj.lower(), topics_pool["default"])
            s_topic = pool[(i * 2 + s_idx) % len(pool)]
            st_str = "%02d:%02d" % (curr_min // 60, curr_min % 60)
            end_m = curr_min + sess_len
            end_str = "%02d:%02d" % (end_m // 60, end_m % 60)
            sessions.append({"start": st_str, "end": end_str, "subject": s_subj, "topic": s_topic, "type": s_type})
            curr_min += slot_len
        days_data.append({"date": d.isoformat(), "weekday": d.strftime("%a"),
                          "full_date": d.strftime("%B %d, %Y"), "sessions": sessions})
    return {
        "summary": "Sample high-yield study timetable balancing conceptual learning, problem practice, and spaced revision.",
        "tips": [
            "Active Recall: Quiz yourself on key formulas at the start of each session.",
            "Take scheduled breaks away from screens to maintain peak mental focus.",
            "Review mistakes immediately after finishing practice problem sets.",
            "Keep hydrated and maintain consistent sleep timing throughout the exam period.",
        ],
        "days": days_data,
    }


# ============================================================================
# Database Management — Master DB + Per-User SQL Files
# ============================================================================

os.makedirs(USER_DATA_DIR, exist_ok=True)


def get_user_sql_path(email: str) -> str:
    """Returns the path to this user's dedicated SQL file."""
    slug = re.sub(r"[^a-zA-Z0-9]", "_", email.lower())
    return os.path.join(USER_DATA_DIR, f"{slug}.sql")


def get_db():
    conn = sqlite3.connect(DB_FILE_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def dump_master_to_sql():
    """Synchronize entire DB to user.sql (master dump)."""
    try:
        lines = [
            "-- =====================================================================",
            "-- Smart Study AI - Master SQL Database Dump",
            "-- Automatically synchronized with backend SQLite engine",
            f"-- Last updated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            "-- =====================================================================\n",
        ]
        with db_lock:
            conn = get_db()
            for line in conn.iterdump():
                lines.append(line)
            conn.close()
        with open(SQL_FILE_PATH, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except Exception as exc:
        print(f"[DB] Error writing master SQL: {exc}")


def dump_user_sql(user_id: int):
    """
    Dump a single user's data (profile, plans, logs) into their own SQL file.
    This is the 'separate user data SQL' file for each user.
    """
    try:
        with db_lock:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("SELECT email, name, auth_provider, created_at, last_login FROM users WHERE id = ?", (user_id,))
            user_row = cur.fetchone()
            if not user_row:
                conn.close()
                return
            email = user_row["email"]

            cur.execute("""
                SELECT id, title, subject_count, total_days, plan_json, form_state_json,
                       completed_sessions_json, created_at, updated_at
                FROM timetables WHERE user_id = ? ORDER BY created_at
            """, (user_id,))
            plans = cur.fetchall()

            cur.execute("""
                SELECT action, detail, ip_address, created_at
                FROM access_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 500
            """, (user_id,))
            logs = cur.fetchall()

            conn.close()

        lines = [
            "-- =====================================================================",
            f"-- Smart Study AI - User Data SQL: {email}",
            f"-- This file contains only data belonging to: {email}",
            f"-- Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            "-- =====================================================================",
            "",
            "-- User Profile Record",
            "CREATE TABLE IF NOT EXISTS user_profile (",
            "    email TEXT, name TEXT, auth_provider TEXT, created_at TEXT, last_login TEXT",
            ");",
            "DELETE FROM user_profile;",
            f"INSERT INTO user_profile VALUES({_sqlval(email)}, {_sqlval(user_row['name'])}, "
            f"{_sqlval(user_row['auth_provider'])}, {_sqlval(user_row['created_at'])}, "
            f"{_sqlval(user_row['last_login'])});",
            "",
            "-- Study Timetables",
            "CREATE TABLE IF NOT EXISTS timetables (",
            "    id INTEGER, title TEXT, subject_count INTEGER, total_days INTEGER,",
            "    plan_json TEXT, form_state_json TEXT, completed_sessions_json TEXT,",
            "    created_at TEXT, updated_at TEXT",
            ");",
            "DELETE FROM timetables;",
        ]

        for p in plans:
            lines.append(
                f"INSERT INTO timetables VALUES({p['id']}, {_sqlval(p['title'])}, "
                f"{p['subject_count']}, {p['total_days']}, "
                f"{_sqlval(p['plan_json'])}, {_sqlval(p['form_state_json'] or '')}, "
                f"{_sqlval(p['completed_sessions_json'] or '[]')}, "
                f"{_sqlval(p['created_at'])}, {_sqlval(p['updated_at'])});"
            )

        lines.extend([
            "",
            "-- Project Access & Usage Logs",
            "CREATE TABLE IF NOT EXISTS access_logs (",
            "    action TEXT, detail TEXT, ip_address TEXT, created_at TEXT",
            ");",
            "DELETE FROM access_logs;",
        ])

        for log in logs:
            lines.append(
                f"INSERT INTO access_logs VALUES({_sqlval(log['action'])}, "
                f"{_sqlval(log['detail'] or '')}, {_sqlval(log['ip_address'] or '')}, "
                f"{_sqlval(log['created_at'])});"
            )

        lines.append("")
        sql_path = get_user_sql_path(email)
        with open(sql_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    except Exception as exc:
        print(f"[DB] Error writing user SQL for user_id={user_id}: {exc}")


def _sqlval(val) -> str:
    """Safely escape a string value for inline SQL literal."""
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def init_db():
    """Initialize all database tables and ensure admin account exists."""
    with db_lock:
        conn = get_db()
        cur = conn.cursor()

        cur.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT,
            password_salt TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_login TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS timetables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            subject_count INTEGER DEFAULT 0,
            total_days INTEGER DEFAULT 7,
            plan_json TEXT NOT NULL,
            form_state_json TEXT,
            completed_sessions_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS access_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            detail TEXT,
            ip_address TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_timetables_user ON timetables(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_logs_user ON access_logs(user_id);
        """)

        # Ensure admin account exists and is correct
        now = datetime.utcnow().isoformat()
        admin_hash, admin_salt = hash_password(ADMIN_PASSWORD)
        cur.execute("SELECT id, password_hash, password_salt FROM users WHERE email = ?", (ADMIN_EMAIL,))
        existing = cur.fetchone()
        if not existing:
            cur.execute("""
                INSERT INTO users (email, name, password_hash, password_salt, is_admin, created_at, last_login)
                VALUES (?, ?, ?, ?, 1, ?, ?)
            """, (ADMIN_EMAIL, "Administrator", admin_hash, admin_salt, now, now))
            print(f"[DB] Admin account created: {ADMIN_EMAIL}")
        else:
            # Always ensure admin has correct credentials & is flagged as admin
            cur.execute("""
                UPDATE users SET password_hash = ?, password_salt = ?, is_admin = 1
                WHERE email = ?
            """, (admin_hash, admin_salt, ADMIN_EMAIL))

        conn.commit()
        conn.close()

    dump_master_to_sql()
    # Dump admin's SQL file
    with db_lock:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email = ?", (ADMIN_EMAIL,))
        admin_row = cur.fetchone()
        conn.close()
    if admin_row:
        dump_user_sql(admin_row["id"])
    print(f"[DB] Database initialized at {DB_FILE_PATH}")


def hash_password(password: str, salt: str = None):
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return hashed.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    if not password or not password_hash or not salt:
        return False
    hashed, _ = hash_password(password, salt)
    return hmac.compare_digest(hashed, password_hash)


def create_session(user_id: int) -> str:
    token = secrets.token_hex(32)
    created_at = datetime.utcnow().isoformat()
    expires_at = (datetime.utcnow() + timedelta(days=30)).isoformat()
    with db_lock:
        conn = get_db()
        conn.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                     (token, user_id, created_at, expires_at))
        conn.commit()
        conn.close()
    return token


def get_user_from_token(token: str):
    if not token:
        return None
    with db_lock:
        conn = get_db()
        cur = conn.cursor()
        now = datetime.utcnow().isoformat()
        cur.execute("""
            SELECT u.id, u.email, u.name, u.is_admin, u.created_at, u.last_login
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?
        """, (token, now))
        row = cur.fetchone()
        conn.close()
        if row:
            return dict(row)
        return None


def delete_session(token: str):
    if not token:
        return
    with db_lock:
        conn = get_db()
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()


def log_access(user_id: int, action: str, detail: str = "", ip_address: str = ""):
    """Record a user action in the access_logs table and re-sync the user's SQL file."""
    now = datetime.utcnow().isoformat()
    with db_lock:
        conn = get_db()
        conn.execute(
            "INSERT INTO access_logs (user_id, action, detail, ip_address, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, action, detail[:500], ip_address[:50], now)
        )
        conn.commit()
        conn.close()
    # Async sync the user's SQL file
    t = threading.Thread(target=dump_user_sql, args=(user_id,), daemon=True)
    t.start()


def get_client_ip(handler) -> str:
    """Extract client IP from handler."""
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45]
    return handler.client_address[0] if handler.client_address else ""


# ============================================================================
# Template / HTML Helpers
# ============================================================================

def read_template(name: str) -> str:
    path = os.path.join(TEMPLATES_DIR, name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return f"<p>Template '{name}' not found.</p>"


def read_static(path: str) -> bytes:
    full = os.path.join(BASE_DIR, path.lstrip("/"))
    try:
        with open(full, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None


def build_page(title: str, body_html: str, extra_head: str = "", extra_scripts: str = "") -> str:
    """Compose a full HTML page using base header + body content + base footer."""
    header = read_template("base_header.html")
    footer = read_template("base_footer.html")
    header = header.replace("{{TITLE}}", title)
    header = header.replace("{{EXTRA_HEAD}}", extra_head)
    footer = footer.replace("{{EXTRA_SCRIPTS}}", extra_scripts)
    return header + "\n" + body_html + "\n" + footer


# ============================================================================
# HTTP Request Handler
# ============================================================================

class Handler(BaseHTTPRequestHandler):
    server_version = "SmartStudyAI/3.0"

    def log_message(self, format, *args):
        # Suppress default access log spam; keep error messages
        pass

    def _send(self, status, body, content_type, set_token=None, clear_token=False, extra_headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        if set_token:
            self.send_header("Set-Cookie",
                f"session_token={set_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000")
        elif clear_token:
            self.send_header("Set-Cookie",
                "session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _html(self, status, html_content, **kwargs):
        self._send(status, html_content, "text/html; charset=utf-8", **kwargs)

    def _json(self, status, obj, set_token=None, clear_token=False):
        self._send(status, json.dumps(obj).encode("utf-8"),
                   "application/json; charset=utf-8",
                   set_token=set_token, clear_token=clear_token)

    def _get_auth_user(self):
        token = ""
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        if not token:
            cookie_header = self.headers.get("Cookie", "")
            if cookie_header:
                for piece in cookie_header.split(";"):
                    piece = piece.strip()
                    if piece.startswith("session_token="):
                        token = piece.split("=", 1)[1].strip()
                        break
        if not token and "?" in self.path:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1])
            if "token" in qs:
                token = qs["token"][0].strip()
        user = get_user_from_token(token) if token else None
        return user, token

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length > MAX_BODY:
            return None, "Request payload too large."
        if length == 0:
            return {}, None
        try:
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8")), None
        except Exception:
            return None, "Malformed JSON request."

    # ------------------------------------------------------------------
    # GET dispatcher
    # ------------------------------------------------------------------
    def do_GET(self):
        path = self.path.split("?", 1)[0]

        # Static files
        if path.startswith("/static/"):
            data = read_static(path)
            if data is None:
                return self._json(404, {"error": "File not found."})
            if path.endswith(".css"):
                ct = "text/css; charset=utf-8"
            elif path.endswith(".js"):
                ct = "application/javascript; charset=utf-8"
            elif path.endswith(".png"):
                ct = "image/png"
            elif path.endswith(".ico"):
                ct = "image/x-icon"
            else:
                ct = "application/octet-stream"
            return self._send(200, data, ct)

        # Pages
        if path in ("/", "/index.html"):
            return self._html(200, build_page("Home", read_template("home.html")))

        if path in ("/login", "/login.html"):
            return self._html(200, build_page("Sign In", read_template("login.html")))

        if path in ("/register", "/register.html"):
            return self._html(200, build_page("Create Account", read_template("register.html")))

        if path in ("/planner", "/planner.html"):
            return self._html(200, build_page("AI Timetable Planner", read_template("planner.html")))

        if path in ("/plans", "/plans.html"):
            return self._html(200, build_page("Saved Plans", read_template("plans.html")))

        if path in ("/my-data", "/my-data.html", "/my-account", "/my-account.html"):
            return self._html(200, build_page("My Account", read_template("my_data.html")))

        if path in ("/admin", "/admin.html"):
            return self._html(200, build_page("Admin Panel", read_template("admin.html")))

        # --- API GET routes ---
        if path == "/api/config":
            return self._json(200, {
                "has_server_key": bool(SERVER_KEY),
                "model": DEFAULT_MODEL,
                "models": [
                    {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash (Recommended — Fast & Smart)"},
                    {"id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash (Ultra Fast)"},
                    {"id": "gemini-1.5-flash", "label": "Gemini 1.5 Flash (Standard)"},
                    {"id": "gemini-2.5-pro",   "label": "Gemini 2.5 Pro (Deep Reasoning)"},
                    {"id": "gemini-1.5-pro",   "label": "Gemini 1.5 Pro (Comprehensive)"},
                ],
            })

        if path == "/api/auth/me":
            user, _ = self._get_auth_user()
            if user:
                return self._json(200, {"user": {
                    "id": user["id"], "email": user["email"],
                    "name": user["name"], "is_admin": bool(user["is_admin"]),
                    "created_at": user["created_at"], "last_login": user["last_login"],
                }})
            return self._json(200, {"user": None})

        if path == "/api/plans":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required to view stored plans."})
            plan_id = None
            if "?" in self.path:
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1])
                if "id" in qs:
                    try:
                        plan_id = int(qs["id"][0])
                    except ValueError:
                        plan_id = None
            if plan_id is not None:
                with db_lock:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("""
                        SELECT id, title, subject_count, total_days, plan_json,
                               form_state_json, completed_sessions_json, created_at, updated_at
                        FROM timetables WHERE id = ? AND user_id = ?
                    """, (plan_id, user["id"]))
                    row = cur.fetchone()
                    conn.close()
                if not row:
                    return self._json(404, {"error": "Stored plan not found."})
                try:
                    plan_data = json.loads(row["plan_json"])
                except Exception:
                    plan_data = {}
                try:
                    form_state = json.loads(row["form_state_json"] or "{}")
                except Exception:
                    form_state = {}
                try:
                    completed_sessions = json.loads(row["completed_sessions_json"] or "[]")
                except Exception:
                    completed_sessions = []
                return self._json(200, {"ok": True, "plan": {
                    "id": row["id"], "title": row["title"],
                    "subject_count": row["subject_count"], "total_days": row["total_days"],
                    "plan_data": plan_data, "form_state": form_state,
                    "completed_sessions": completed_sessions,
                    "created_at": row["created_at"], "updated_at": row["updated_at"],
                }})
            else:
                with db_lock:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("""
                        SELECT id, title, subject_count, total_days, created_at, updated_at, completed_sessions_json
                        FROM timetables WHERE user_id = ? ORDER BY updated_at DESC
                    """, (user["id"],))
                    rows = cur.fetchall()
                    conn.close()
                plans = []
                for r in rows:
                    try:
                        comps = json.loads(r["completed_sessions_json"] or "[]")
                    except Exception:
                        comps = []
                    plans.append({
                        "id": r["id"], "title": r["title"],
                        "subject_count": r["subject_count"], "total_days": r["total_days"],
                        "created_at": r["created_at"], "updated_at": r["updated_at"],
                        "completed_count": len(comps),
                    })
                return self._json(200, {"plans": plans})

        # User's dedicated SQL file (ADMIN ONLY)
        if path == "/api/user/sql":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required."})
            if not user["is_admin"]:
                return self._json(403, {"error": "SQL access is restricted to administrators only."})
            sql_path = get_user_sql_path(user["email"])
            try:
                with open(sql_path, "r", encoding="utf-8") as f:
                    sql_text = f.read()
            except FileNotFoundError:
                sql_text = f"-- SQL file for {user['email']} not yet generated."
            # Count stats
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) as cnt FROM timetables WHERE user_id = ?", (user["id"],))
                plans_count = cur.fetchone()["cnt"]
                cur.execute("SELECT COUNT(*) as cnt FROM access_logs WHERE user_id = ?", (user["id"],))
                logs_count = cur.fetchone()["cnt"]
                conn.close()
            return self._json(200, {"sql": sql_text, "stats": {
                "plans_count": plans_count, "logs_count": logs_count,
            }})

        # User SQL file download (ADMIN ONLY)
        if path == "/api/user/sql/download":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required."})
            if not user["is_admin"]:
                return self._json(403, {"error": "SQL download is restricted to administrators only."})
            sql_path = get_user_sql_path(user["email"])
            try:
                with open(sql_path, "rb") as f:
                    data = f.read()
            except FileNotFoundError:
                data = b"-- No SQL data found."
            slug = re.sub(r"[^a-zA-Z0-9]", "_", user["email"].lower())
            fname = f"{slug}_data.sql"
            return self._send(200, data, "text/plain; charset=utf-8",
                extra_headers={"Content-Disposition": f'attachment; filename="{fname}"'})

        # User summary stats (plans & activity count - accessible to all authenticated users)
        if path == "/api/user/stats":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required."})
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) as cnt FROM timetables WHERE user_id = ?", (user["id"],))
                plans_count = cur.fetchone()["cnt"]
                cur.execute("SELECT COUNT(*) as cnt FROM access_logs WHERE user_id = ?", (user["id"],))
                logs_count = cur.fetchone()["cnt"]
                conn.close()
            return self._json(200, {"stats": {
                "plans_count": plans_count, "logs_count": logs_count,
            }})

        # User activity logs
        if path == "/api/user/logs":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required."})
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("""
                    SELECT action, detail, ip_address, created_at
                    FROM access_logs WHERE user_id = ?
                    ORDER BY created_at DESC LIMIT 100
                """, (user["id"],))
                logs = [dict(r) for r in cur.fetchall()]
                conn.close()
            return self._json(200, {"logs": logs})

        # Admin: Stats
        if path == "/api/admin/stats":
            user, _ = self._get_auth_user()
            if not user or not user["is_admin"]:
                return self._json(403, {"error": "Admin access required."})
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                stats = {}
                for table, key in [
                    ("users", "users_count"), ("timetables", "plans_count"),
                    ("sessions", "sessions_count"), ("access_logs", "logs_count"),
                ]:
                    cur.execute(f"SELECT COUNT(*) as cnt FROM {table}")
                    stats[key] = cur.fetchone()["cnt"]
                conn.close()
            return self._json(200, stats)

        # Admin: All users list
        if path == "/api/admin/users":
            user, _ = self._get_auth_user()
            if not user or not user["is_admin"]:
                return self._json(403, {"error": "Admin access required."})
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("""
                    SELECT u.id, u.email, u.name, u.is_admin, u.created_at, u.last_login,
                           COUNT(t.id) as plans_count
                    FROM users u
                    LEFT JOIN timetables t ON t.user_id = u.id
                    GROUP BY u.id
                    ORDER BY u.created_at ASC
                """)
                users = []
                for r in cur.fetchall():
                    users.append({
                        "id": r["id"], "email": r["email"], "name": r["name"],
                        "is_admin": bool(r["is_admin"]),
                        "plans_count": r["plans_count"],
                        "created_at": r["created_at"], "last_login": r["last_login"],
                    })
                conn.close()
            return self._json(200, {"users": users})

        # Admin: Individual user SQL dump
        if path == "/api/admin/user-sql":
            user, _ = self._get_auth_user()
            if not user or not user["is_admin"]:
                return self._json(403, {"error": "Admin access required."})
            if "?" not in self.path:
                return self._json(400, {"error": "Missing user id."})
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1])
            try:
                target_id = int(qs.get("id", [0])[0])
            except (ValueError, IndexError):
                return self._json(400, {"error": "Invalid user id."})
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT email FROM users WHERE id = ?", (target_id,))
                row = cur.fetchone()
                conn.close()
            if not row:
                return self._json(404, {"error": "User not found."})
            sql_path = get_user_sql_path(row["email"])
            try:
                with open(sql_path, "r", encoding="utf-8") as f:
                    sql_text = f.read()
            except FileNotFoundError:
                sql_text = f"-- No SQL data file found for {row['email']} yet."
            return self._json(200, {"sql": sql_text})

        # Admin: Individual user SQL download
        if path == "/api/admin/user-sql/download":
            user, _ = self._get_auth_user()
            if not user or not user["is_admin"]:
                return self._json(403, {"error": "Admin access required."})
            if "?" not in self.path:
                return self._json(400, {"error": "Missing user id."})
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1])
            try:
                target_id = int(qs.get("id", [0])[0])
            except (ValueError, IndexError):
                return self._json(400, {"error": "Invalid user id."})
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT email FROM users WHERE id = ?", (target_id,))
                row = cur.fetchone()
                conn.close()
            if not row:
                return self._json(404, {"error": "User not found."})
            sql_path = get_user_sql_path(row["email"])
            try:
                with open(sql_path, "rb") as f:
                    data = f.read()
            except FileNotFoundError:
                data = b"-- No SQL data file found for user."
            slug = re.sub(r"[^a-zA-Z0-9]", "_", row["email"].lower())
            fname = f"{slug}_data.sql"
            return self._send(200, data, "text/plain; charset=utf-8",
                extra_headers={"Content-Disposition": f'attachment; filename="{fname}"'})

        # Admin: Master SQL dump
        if path == "/api/admin/master-sql":
            user, _ = self._get_auth_user()
            if not user or not user["is_admin"]:
                return self._json(403, {"error": "Admin access required."})
            try:
                with open(SQL_FILE_PATH, "r", encoding="utf-8") as f:
                    sql_text = f.read()
            except FileNotFoundError:
                sql_text = "-- Master SQL file not found."
            return self._json(200, {"sql": sql_text})

        # Admin: Master SQL download
        if path == "/api/admin/master-sql/download":
            user, _ = self._get_auth_user()
            if not user or not user["is_admin"]:
                return self._json(403, {"error": "Admin access required."})
            try:
                with open(SQL_FILE_PATH, "rb") as f:
                    data = f.read()
            except FileNotFoundError:
                data = b"-- Master SQL file not found."
            return self._send(200, data, "text/plain; charset=utf-8",
                extra_headers={"Content-Disposition": 'attachment; filename="master_user.sql"'})

        # 404
        return self._json(404, {"error": "Endpoint not found."})

    # ------------------------------------------------------------------
    # POST dispatcher
    # ------------------------------------------------------------------
    def do_POST(self):
        path = self.path.split("?", 1)[0]
        data, err = self._read_body()
        if data is None:
            return self._json(400, {"error": err})

        client_ip = get_client_ip(self)

        # --- Auth ---
        if path == "/api/auth/register":
            name = clean_text(data.get("name"), 80)
            email = clean_text(data.get("email"), 120).lower()
            password = str(data.get("password") or "")

            if not name:
                return self._json(400, {"error": "Please enter your full name."})
            if not email or "@" not in email or "." not in email:
                return self._json(400, {"error": "Please enter a valid email address."})
            if len(password) < 6:
                return self._json(400, {"error": "Password must be at least 6 characters long."})

            # Block registering as the reserved admin email
            if email == ADMIN_EMAIL.lower():
                return self._json(400, {"error": "This email address is reserved. Please use a different email."})

            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT id FROM users WHERE email = ?", (email,))
                if cur.fetchone():
                    conn.close()
                    return self._json(400, {"error": "An account with this email already exists. Please log in."})
                pwd_hash, salt = hash_password(password)
                now = datetime.utcnow().isoformat()
                cur.execute("""
                    INSERT INTO users (email, name, password_hash, password_salt, is_admin, created_at, last_login)
                    VALUES (?, ?, ?, ?, 0, ?, ?)
                """, (email, name, pwd_hash, salt, now, now))
                user_id = cur.lastrowid
                conn.commit()
                conn.close()

            token = create_session(user_id)
            user_info = {
                "id": user_id, "email": email, "name": name,
                "is_admin": False, "created_at": now, "last_login": now,
            }
            log_access(user_id, "register", f"New account created: {email}", client_ip)
            dump_user_sql(user_id)
            dump_master_to_sql()
            return self._json(200, {"ok": True, "user": user_info, "token": token}, set_token=token)

        elif path == "/api/auth/login":
            email = clean_text(data.get("email"), 120).lower()
            password = str(data.get("password") or "")

            if not email or not password:
                return self._json(400, {"error": "Please provide both email and password."})

            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("""
                    SELECT id, email, name, password_hash, password_salt, is_admin, created_at
                    FROM users WHERE email = ?
                """, (email,))
                row = cur.fetchone()
                if not row:
                    conn.close()
                    return self._json(400, {"error": "Invalid email or password."})
                if not verify_password(password, row["password_hash"], row["password_salt"]):
                    conn.close()
                    return self._json(400, {"error": "Invalid email or password."})
                now = datetime.utcnow().isoformat()
                cur.execute("UPDATE users SET last_login = ? WHERE id = ?", (now, row["id"]))
                conn.commit()
                user_id = row["id"]
                user_info = {
                    "id": row["id"], "email": row["email"], "name": row["name"],
                    "is_admin": bool(row["is_admin"]),
                    "created_at": row["created_at"], "last_login": now,
                }
                conn.close()

            token = create_session(user_id)
            log_access(user_id, "login", f"Logged in from {client_ip}", client_ip)
            dump_user_sql(user_id)
            return self._json(200, {"ok": True, "user": user_info, "token": token}, set_token=token)

        elif path == "/api/auth/logout":
            user, token = self._get_auth_user()
            if token:
                if user:
                    log_access(user["id"], "logout", "Session ended", client_ip)
                delete_session(token)
            return self._json(200, {"ok": True}, clear_token=True)

        # --- Study Plans ---
        elif path == "/api/plans":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Please sign in to save your study timetable."})
            title = clean_text(data.get("title") or "Study Timetable", 100)
            plan_data = data.get("plan_data") or {}
            form_state = data.get("form_state") or {}
            completed_sessions = data.get("completed_sessions") or []
            subj_count = len(form_state.get("subjects") or [])
            if subj_count == 0:
                s_set = set()
                for d in plan_data.get("days", []):
                    for s in d.get("sessions", []):
                        if s.get("subject"):
                            s_set.add(s["subject"])
                subj_count = len(s_set)
            total_days = len(plan_data.get("days") or []) or int(form_state.get("days") or 7)
            now = datetime.utcnow().isoformat()
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO timetables (user_id, title, subject_count, total_days, plan_json,
                        form_state_json, completed_sessions_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (user["id"], title, subj_count, total_days, json.dumps(plan_data),
                      json.dumps(form_state), json.dumps(completed_sessions), now, now))
                new_id = cur.lastrowid
                conn.commit()
                conn.close()
            log_access(user["id"], "save_plan", f"Saved plan: '{title}' (ID:{new_id})", client_ip)
            dump_user_sql(user["id"])
            dump_master_to_sql()
            return self._json(200, {"ok": True, "id": new_id, "title": title})

        elif path == "/api/plans/update":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required."})
            plan_id = int(data.get("id") or 0)
            if not plan_id:
                return self._json(400, {"error": "Missing plan id."})
            title = clean_text(data.get("title"), 100)
            plan_data = data.get("plan_data")
            form_state = data.get("form_state")
            completed_sessions = data.get("completed_sessions")
            now = datetime.utcnow().isoformat()
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT id FROM timetables WHERE id = ? AND user_id = ?", (plan_id, user["id"]))
                if not cur.fetchone():
                    conn.close()
                    return self._json(404, {"error": "Stored plan not found."})
                updates = ["updated_at = ?"]
                params = [now]
                if title:
                    updates.append("title = ?")
                    params.append(title)
                if plan_data is not None:
                    updates.append("plan_json = ?")
                    params.append(json.dumps(plan_data))
                    updates.append("total_days = ?")
                    params.append(len(plan_data.get("days") or []))
                if form_state is not None:
                    updates.append("form_state_json = ?")
                    params.append(json.dumps(form_state))
                    updates.append("subject_count = ?")
                    params.append(len(form_state.get("subjects") or []))
                if completed_sessions is not None:
                    updates.append("completed_sessions_json = ?")
                    params.append(json.dumps(completed_sessions))
                params.extend([plan_id, user["id"]])
                cur.execute(f"UPDATE timetables SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params)
                conn.commit()
                conn.close()
            log_access(user["id"], "update_plan", f"Updated plan ID:{plan_id}", client_ip)
            dump_user_sql(user["id"])
            dump_master_to_sql()
            return self._json(200, {"ok": True, "id": plan_id})

        elif path == "/api/plans/rename":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required."})
            plan_id = int(data.get("id") or 0)
            title = clean_text(data.get("title") or "Study Timetable", 100)
            now = datetime.utcnow().isoformat()
            with db_lock:
                conn = get_db()
                conn.execute("UPDATE timetables SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                             (title, now, plan_id, user["id"]))
                conn.commit()
                conn.close()
            log_access(user["id"], "rename_plan", f"Renamed plan ID:{plan_id} to '{title}'", client_ip)
            dump_user_sql(user["id"])
            dump_master_to_sql()
            return self._json(200, {"ok": True})

        elif path == "/api/plans/delete":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required."})
            plan_id = int(data.get("id") or 0)
            with db_lock:
                conn = get_db()
                conn.execute("DELETE FROM timetables WHERE id = ? AND user_id = ?", (plan_id, user["id"]))
                conn.commit()
                conn.close()
            log_access(user["id"], "delete_plan", f"Deleted plan ID:{plan_id}", client_ip)
            dump_user_sql(user["id"])
            dump_master_to_sql()
            return self._json(200, {"ok": True})

        elif path == "/api/plans/progress":
            user, _ = self._get_auth_user()
            if not user:
                return self._json(401, {"error": "Authentication required."})
            plan_id = int(data.get("id") or 0)
            completed_sessions = data.get("completed_sessions") or []
            now = datetime.utcnow().isoformat()
            with db_lock:
                conn = get_db()
                conn.execute("UPDATE timetables SET completed_sessions_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                             (json.dumps(completed_sessions), now, plan_id, user["id"]))
                conn.commit()
                conn.close()
            log_access(user["id"], "update_progress", f"Updated progress for plan ID:{plan_id}", client_ip)
            dump_user_sql(user["id"])
            return self._json(200, {"ok": True})

        # --- Admin: Delete User ---
        elif path == "/api/admin/delete-user":
            user, _ = self._get_auth_user()
            if not user or not user["is_admin"]:
                return self._json(403, {"error": "Admin access required."})
            target_id = int(data.get("id") or 0)
            if not target_id:
                return self._json(400, {"error": "Missing user id."})
            with db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT email FROM users WHERE id = ?", (target_id,))
                row = cur.fetchone()
                if not row:
                    conn.close()
                    return self._json(404, {"error": "User not found."})
                target_email = row["email"]
                if target_email.lower() == ADMIN_EMAIL.lower():
                    conn.close()
                    return self._json(400, {"error": "Cannot delete the administrator account."})
                conn.execute("DELETE FROM users WHERE id = ?", (target_id,))
                conn.commit()
                conn.close()
            # Remove user's SQL file
            sql_path = get_user_sql_path(target_email)
            try:
                os.remove(sql_path)
            except FileNotFoundError:
                pass
            dump_master_to_sql()
            log_access(user["id"], "admin_delete_user", f"Admin deleted user: {target_email}", client_ip)
            return self._json(200, {"ok": True})

        # --- Timetable Generation ---
        elif path in ("/api/generate", "/api/sample"):
            try:
                req = clean_request(data)
                if path == "/api/sample":
                    sample_plan = generate_sample_plan(req)
                    user_obj, _ = self._get_auth_user()
                    if user_obj:
                        log_access(user_obj["id"], "demo_plan", "Generated demo plan", client_ip)
                    return self._json(200, sample_plan)

                api_key = clean_text(data.get("api_key"), 200) or SERVER_KEY
                if not api_key:
                    raise InputError(
                        "Please enter your Google Gemini API key, or click 'Demo Plan' to test the app."
                    )
                model = str(data.get("model") or DEFAULT_MODEL).strip()
                if model.startswith("models/"):
                    model = model[7:]
                if not MODEL_RE.match(model):
                    raise InputError("The specified Gemini model name is invalid.")

                text = call_gemini(api_key, model, build_prompt(req))
                plan = sanitize_plan(parse_plan_json(text), req)

                user_obj, _ = self._get_auth_user()
                if user_obj:
                    subjects_str = ", ".join(s["name"] for s in req["subjects"])
                    log_access(user_obj["id"], "generate", f"AI plan ({req['days']} days): {subjects_str}", client_ip)

                self._json(200, plan)

            except InputError as err:
                self._json(400, {"error": str(err)})
            except ApiError as err:
                self._json(err.status, {"error": str(err)})
            except (ValueError, UnicodeDecodeError):
                self._json(400, {"error": "Malformed JSON request."})
            except Exception as exc:
                traceback.print_exc()
                self._json(500, {"error": "Server error: %s" % clean_text(str(exc), 120)})

        else:
            return self._json(404, {"error": "Endpoint not found."})


# ============================================================================
# Main Server Runner
# ============================================================================

def main():
    init_db()
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as err:
        sys.exit(
            f"Could not start server on {HOST}:{PORT} ({err}).\n"
            f"Try another port, e.g.: PORT=8080 python app.py"
        )

    url = f"http://{HOST}:{PORT}"
    print("=" * 60)
    print("  Smart Study AI — Adaptive Timetable Generator v3.0")
    print("=" * 60)
    print(f"  Server running at:  {url}")
    print(f"  Pages available:")
    print(f"    Home:          {url}/")
    print(f"    AI Planner:    {url}/planner")
    print(f"    Saved Plans:   {url}/plans")
    print(f"    My Account:    {url}/my-data")
    print(f"    Login:         {url}/login")
    print(f"    Register:      {url}/register")
    print(f"    Admin Panel:   {url}/admin")
    print(f"  Admin Login:")
    print(f"    Email:    {ADMIN_EMAIL}")
    print(f"    Password: {ADMIN_PASSWORD}")
    print(f"  User SQL files stored in: user_data/")
    print(f"  Press Ctrl+C to stop the server.")
    print("=" * 60)

    if not os.environ.get("NO_BROWSER"):
        def _open():
            import time
            time.sleep(0.8)
            webbrowser.open(url)
        threading.Thread(target=_open, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] Shutting down. Goodbye!")
        server.shutdown()


if __name__ == "__main__":
    main()
