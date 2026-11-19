Smart Study AI Timetable Generator (v2.0)
===========================================

An intelligent study timetable generator powered by Google's Gemini AI.
Enter your subjects, exam dates, daily study hours, and study window; Gemini builds
an adaptive, day-by-day study schedule with exam countdowns, spaced repetition,
and interactive study progress tracking.

Zero dependencies: Uses only Python's standard library (Python 3.8+).

---------------------------------------------------------------------------
1. Quick Start
---------------------------------------------------------------------------
Option A: Run with an API key
  Windows (PowerShell):
    $env:GOOGLE_API_KEY = "your-key-here"
    python app.py

  Mac / Linux:
    export GOOGLE_API_KEY="your-key-here"
    python3 app.py

Option B: Run directly
    python app.py

Your browser will automatically open at:
    http://localhost:8000

If you don't have an API key yet, click "Demo Plan" or "Instant Preview with Demo Plan"
to test all features immediately! You can get a free Gemini API key at:
https://aistudio.google.com/apikey

Stop the application anytime with Ctrl+C.

---------------------------------------------------------------------------
2. Features & Capabilities
---------------------------------------------------------------------------
- User Accounts & Authentication:
    - Sign in with Google Account (1-click quick demo or custom Google email).
    - Sign in with Email & User Custom Password (secure salted PBKDF2 hashing).
    - Persistent sessions across browser refreshes with logout support.
- Backend Database Synchronization & Admin SQL Access:
    - Automatically writes all users, passwords, sessions, and study timetables
      into human-readable SQL transactions in `user.sql` and `user_data/<email>.sql`.
    - SQL database access, viewing, and downloading is restricted exclusively to
      administrators for full privacy and security.
    - Normal users manage their profile, saved plans, and activity history without SQL exposure.
- Watch Stored Data in Front End:
    - "Saved Plans" drawer with 1-click "Watch Plan" loading.
    - Restores timetable, completed progress, checklist, and input parameters.
    - Live auto-syncing of checked study sessions to user.sql backend.
    - Rename and delete saved study plans.
- Modern UI & UX: Sleek dark/light theme switcher, fluid responsive design,
  and ambient glassmorphism styling.
- Quick Presets: 1-click loading for Finals Week, CS & Engineering, and Pre-Med.
- Smart Exam Countdowns: Live badges showing "Exam in X days" and urgency highlights.
- Focus Presets: Quick Pomodoro (25/5), Deep Work (50/10), or Extended (90/15) intervals.
- 3 Interactive Views:
    1. Day Cards Grid: Clean day-by-day responsive study blocks.
    2. Timeline View: Chronological vertical day stream with breaks.
    3. Checklist View: To-do agenda with checkboxes and strike-throughs.
- Progress Tracker: Live progress bar showing completed study sessions.
- Subject Time Allocation: Segmented visual bar displaying study time distribution.
- Complete Export Suite:
    - Add to Calendar (.ics): Standard iCalendar events with 15-minute reminders.
    - Download CSV: Clean spreadsheet for Excel / Google Sheets.
    - Copy Markdown: Formatted tables ready for Notion, Obsidian, or WhatsApp.
    - Print / Save as PDF: Clean layout formatted specifically for printers.

---------------------------------------------------------------------------
3. Configuration (Optional Environment Variables)
---------------------------------------------------------------------------
Variable          Meaning                                      Default
---------------------------------------------------------------------------
GOOGLE_API_KEY    Server-side Google API key                   AQ.Ab8RN6Kl-REcRMsJY3AFFWQ3xfvlDQHEgM_DROQAE7hBQ3ftig
GEMINI_API_KEY    Alternative server-side key variable         AQ.Ab8RN6KE_HnHDX5gUTY4OLNfKMbAhRWmyMRNPfpMy7GOzbZdFw
GEMINI_MODEL      Default Gemini model                         gemini-2.5-flash
PORT              Port to listen on                            8000
HOST              Address to listen on                         127.0.0.1
NO_BROWSER        Set to 1 to disable auto-opening browser     0

---------------------------------------------------------------------------
4. Supported Models
---------------------------------------------------------------------------
- gemini-2.5-flash (Default & Recommended - Fast, smart, high quality)
- gemini-2.0-flash (Next-Gen Ultra Fast)
- gemini-1.5-flash (Standard Stable)
- gemini-2.5-pro   (Deep Reasoning & Complex Planning)
- gemini-1.5-pro   (Comprehensive)
