/* =============================================================================
   Smart Study AI - Planner Controller
   Dynamic Timetables, Spaced Repetition, Checklists, Filters & PDF Export
   ============================================================================= */

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const STORE_STATE = "sst.state.v2";
const STORE_KEY = "sst.apikey";
const STORE_COMPLETED = "sst.completed_sessions";
const STORE_LAST_PLAN = "sst.last_plan";

const SUBJECT_COLORS = [
  "#c5a059", "#0d9488", "#b45309", "#4338ca",
  "#be123c", "#475569", "#15803d", "#7c3aed"
];

const PRESETS = {
  finals: [
    { name: "Mathematics", exam_days: 6, difficulty: "hard", topics: "Calculus, Linear Algebra, Probability" },
    { name: "Physics", exam_days: 9, difficulty: "hard", topics: "Thermodynamics, Electromagnetism, Optics" },
    { name: "Chemistry", exam_days: 12, difficulty: "medium", topics: "Organic Chemistry, Chemical Kinetics" },
    { name: "English Literature", exam_days: 15, difficulty: "easy", topics: "Essay Structuring, Poetry Analysis" }
  ],
  cs: [
    { name: "Algorithms & Data Structures", exam_days: 7, difficulty: "hard", topics: "Dynamic Programming, Trees, Graphs" },
    { name: "Operating Systems", exam_days: 11, difficulty: "medium", topics: "Process Scheduling, Concurrency, Virtual Memory" },
    { name: "Database Systems", exam_days: 14, difficulty: "medium", topics: "Indexing, Normalization, ACID Transactions" },
    { name: "Computer Networks", exam_days: 18, difficulty: "easy", topics: "TCP/IP, Routing Protocols, DNS & HTTP" }
  ],
  med: [
    { name: "Human Anatomy", exam_days: 5, difficulty: "hard", topics: "Cardiovascular System, Neuroanatomy, Musculoskeletal" },
    { name: "Biochemistry", exam_days: 8, difficulty: "hard", topics: "Metabolic Pathways, Enzymes, Molecular Genetics" },
    { name: "Physiology", exam_days: 12, difficulty: "medium", topics: "Renal Function, Endocrine System, Respiration" },
    { name: "Microbiology", exam_days: 16, difficulty: "medium", topics: "Bacterial Pathogens, Virology, Immunology" }
  ],
  highschool: [
    { name: "Algebra & Geometry", exam_days: 6, difficulty: "hard", topics: "Quadratic Equations, Coordinate Geometry, Trigonometry" },
    { name: "General Biology", exam_days: 10, difficulty: "medium", topics: "Cell Structure, Genetics, Ecology, Human Body" },
    { name: "World History", exam_days: 13, difficulty: "easy", topics: "Industrial Revolution, World Wars, Cold War" },
    { name: "Physics Fundamentals", exam_days: 17, difficulty: "hard", topics: "Kinematics, Forces, Work & Energy, Wave Motion" }
  ]
};

let currentPlan = null;
let currentView = "cards";
let selectedSubjectFilter = "all";
let selectedPdfFormat = "detailed";
let completedSessions = new Set();
let activeSavedPlanId = null;
let activeSavedPlanTitle = "";

function getSubjectColor(name, index) {
  if (!name) return SUBJECT_COLORS[(index || 0) % SUBJECT_COLORS.length];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % SUBJECT_COLORS.length;
  return SUBJECT_COLORS[h];
}

function createSubjectCard(values, index) {
  values = values || {};
  const card = document.createElement("div");
  card.className = "subject-card";
  const color = getSubjectColor(values.name || "", index);
  card.style.setProperty("--subj-color", color);

  card.innerHTML = `
    <div class="subject-top-row">
      <input class="s-name" type="text" maxlength="80" placeholder="Subject name (e.g. Mathematics)" value="${escapeHtml(values.name || '')}" aria-label="Subject name">
      <button type="button" class="btn-ghost btn-icon-only btn-del-subj" title="Remove Subject" aria-label="Remove subject">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>
    </div>
    <div class="subject-grid">
      <div>
        <label class="form-label" style="font-size:0.75rem;margin-bottom:2px">Exam Date</label>
        <input class="s-exam" type="date" value="${values.exam_date || ''}" aria-label="Exam date">
      </div>
      <div>
        <label class="form-label" style="font-size:0.75rem;margin-bottom:2px">Difficulty</label>
        <select class="s-diff" aria-label="Difficulty">
          <option value="easy" ${values.difficulty === 'easy' ? 'selected' : ''}>🟢 Easy</option>
          <option value="medium" ${values.difficulty !== 'easy' && values.difficulty !== 'hard' ? 'selected' : ''}>🟡 Medium</option>
          <option value="hard" ${values.difficulty === 'hard' ? 'selected' : ''}>🔴 Hard</option>
        </select>
      </div>
    </div>
    <div>
      <input class="s-topics" type="text" maxlength="400" placeholder="Topics / chapters (optional, e.g. Ch 1-5, Matrices)" value="${escapeHtml(values.topics || '')}" aria-label="Topics">
    </div>
    <div class="countdown-slot"></div>
  `;

  const examInput = card.querySelector(".s-exam");
  const nameInput = card.querySelector(".s-name");
  const countdownSlot = card.querySelector(".countdown-slot");

  function updateCountdown() {
    const val = examInput.value;
    countdownSlot.innerHTML = "";
    if (!val) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const examDate = new Date(val + "T00:00:00");
    const diffDays = Math.round((examDate - today) / (1000 * 60 * 60 * 24));

    const chip = document.createElement("span");
    chip.className = "countdown-chip" + (diffDays <= 3 ? " imminent" : "");
    if (diffDays < 0) {
      chip.textContent = "Exam passed";
    } else if (diffDays === 0) {
      chip.textContent = "⚠️ Exam Today!";
    } else if (diffDays === 1) {
      chip.textContent = "⚠️ Exam Tomorrow!";
    } else {
      chip.textContent = `⏳ Exam in ${diffDays} days`;
    }
    countdownSlot.appendChild(chip);
  }

  examInput.addEventListener("change", updateCountdown);
  nameInput.addEventListener("input", () => {
    card.style.setProperty("--subj-color", getSubjectColor(nameInput.value, index));
  });

  updateCountdown();

  card.querySelector(".btn-del-subj").addEventListener("click", () => {
    if (document.querySelectorAll(".subject-card").length > 1) {
      card.remove();
      updateSubjectCount();
    }
  });

  return card;
}

function updateSubjectCount() {
  const count = document.querySelectorAll(".subject-card").length;
  const badge = $("subjectCountBadge");
  if (badge) badge.textContent = `${count} subject${count === 1 ? '' : 's'}`;
}

function addSubjectCard(values) {
  const container = $("subjectsContainer");
  const count = container.querySelectorAll(".subject-card").length;
  if (count >= 16) return;
  const card = createSubjectCard(values, count);
  container.appendChild(card);
  updateSubjectCount();
}

function applyPreset(type) {
  const container = $("subjectsContainer");
  container.innerHTML = "";
  if (type === "clear") {
    addSubjectCard({ difficulty: "medium" });
    return;
  }
  const today = new Date();
  const list = PRESETS[type] || [];
  list.forEach((item) => {
    const exam = new Date(today);
    exam.setDate(today.getDate() + item.exam_days);
    addSubjectCard({
      name: item.name,
      exam_date: isoDate(exam),
      difficulty: item.difficulty,
      topics: item.topics
    });
  });
}

function setFocusPreset(sessMin, brkMin) {
  $("sessionMin").value = sessMin;
  $("breakMin").value = brkMin;
}

function collectForm() {
  const subjects = [...document.querySelectorAll(".subject-card")].map((card) => ({
    name: card.querySelector(".s-name").value.trim(),
    exam_date: card.querySelector(".s-exam").value,
    difficulty: card.querySelector(".s-diff").value,
    topics: card.querySelector(".s-topics").value.trim()
  })).filter((s) => s.name);

  return {
    subjects,
    start_date: $("startDate").value,
    days: Number($("daysInput").value) || 7,
    weekday_hours: Number($("weekdayHours").value),
    weekend_hours: Number($("weekendHours").value),
    window_start: $("winStart").value,
    window_end: $("winEnd").value,
    session_minutes: Number($("sessionMin").value),
    break_minutes: Number($("breakMin").value),
    notes: $("notes").value.trim(),
    model: $("modelSelect").value,
    api_key: $("apiKey") ? $("apiKey").value.trim() : ""
  };
}

function saveState(data) {
  try {
    const toSave = Object.assign({}, data);
    delete toSave.api_key;
    localStorage.setItem(STORE_STATE, JSON.stringify(toSave));
    if ($("rememberKey") && $("apiKey") && $("rememberKey").checked && data.api_key) {
      localStorage.setItem(STORE_KEY, data.api_key);
    } else if ($("rememberKey") && !$("rememberKey").checked) {
      localStorage.removeItem(STORE_KEY);
    }
  } catch (_) {}
}

function loadState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_STATE) || "null"); } catch (_) {}

  const today = isoDate(new Date());
  $("startDate").value = today;

  if (saved && Array.isArray(saved.subjects) && saved.subjects.length) {
    $("subjectsContainer").innerHTML = "";
    saved.subjects.forEach((s) => addSubjectCard(s));
  } else {
    applyPreset("finals");
  }

  if (saved) {
    if (saved.days) {
      $("daysInput").value = saved.days;
      document.querySelectorAll(".duration-pill").forEach((p) => {
        p.classList.toggle("active", p.dataset.days == saved.days);
      });
    }
    if (saved.weekday_hours) $("weekdayHours").value = saved.weekday_hours;
    if (saved.weekend_hours) $("weekendHours").value = saved.weekend_hours;
    if (saved.window_start) $("winStart").value = saved.window_start;
    if (saved.window_end) $("winEnd").value = saved.window_end;
    if (saved.session_minutes) $("sessionMin").value = saved.session_minutes;
    if (saved.break_minutes) $("breakMin").value = saved.break_minutes;
    if (saved.notes) $("notes").value = saved.notes;
    if (saved.model) $("modelSelect").value = saved.model;
  }

  try {
    const key = localStorage.getItem(STORE_KEY);
    if (key && $("apiKey") && $("rememberKey")) {
      $("apiKey").value = key;
      $("rememberKey").checked = true;
    }
    const comps = JSON.parse(localStorage.getItem(STORE_COMPLETED) || "[]");
    completedSessions = new Set(comps);
  } catch (_) {}

  // Restore last plan if exists and not explicitly watching a stored plan
  try {
    const lastPlan = JSON.parse(localStorage.getItem(STORE_LAST_PLAN) || "null");
    if (lastPlan && lastPlan.days && lastPlan.days.length && !activeSavedPlanId) {
      renderTimetable(lastPlan);
    }
  } catch (_) {}
}

const toMin = (t) => {
  const [h, m] = (t || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fmtDur = (m) => {
  const h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
};

function renderTimetable(plan) {
  currentPlan = plan;
  localStorage.setItem(STORE_LAST_PLAN, JSON.stringify(plan));

  $("emptyHero").hidden = true;
  $("activePlanView").hidden = false;

  $("planSummary").textContent = plan.summary || "Balanced day-by-day plan.";

  let totalMinutes = 0;
  let totalSessions = 0;
  const subjMinutes = {};

  for (const day of plan.days || []) {
    for (const s of day.sessions || []) {
      const dur = toMin(s.end) - toMin(s.start);
      if (dur > 0) {
        totalMinutes += dur;
        totalSessions++;
        subjMinutes[s.subject] = (subjMinutes[s.subject] || 0) + dur;
      }
    }
  }

  const daysCount = (plan.days || []).length || 1;
  const totalHours = (totalMinutes / 60).toFixed(1);
  const dailyAvg = (totalMinutes / 60 / daysCount).toFixed(1);

  $("statTotalTime").textContent = `${totalHours} hrs`;
  $("statPlanDays").textContent = `Across ${daysCount} days`;
  $("statTotalSessions").textContent = totalSessions;
  $("statDailyAvg").textContent = `${dailyAvg} hrs/day`;

  renderDistributionBar(subjMinutes, totalMinutes);
  updateSubjectFilterOptions(plan);
  updateProgressUI(totalSessions);

  const tipsList = $("tipsList");
  tipsList.innerHTML = "";
  (plan.tips || []).forEach((tip) => {
    const li = document.createElement("li");
    li.textContent = tip;
    tipsList.appendChild(li);
  });

  renderActiveView();
  $("activePlanView").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateSubjectFilterOptions(plan) {
  const select = $("filterSubjectSelect");
  if (!select) return;
  const currentVal = select.value || "all";
  select.innerHTML = `<option value="all">All Subjects</option>`;
  const subjects = new Set();
  for (const day of (plan.days || [])) {
    for (const s of (day.sessions || [])) {
      if (s.subject) subjects.add(s.subject);
    }
  }
  [...subjects].sort().forEach(subj => {
    const opt = document.createElement("option");
    opt.value = subj;
    opt.textContent = subj;
    if (subj === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderDistributionBar(subjMinutes, totalMinutes) {
  const bar = $("subjectDistBar");
  const legend = $("subjectDistLegend");
  bar.innerHTML = "";
  legend.innerHTML = "";

  if (!totalMinutes) return;

  const entries = Object.entries(subjMinutes).sort((a, b) => b[1] - a[1]);
  entries.forEach(([subj, mins], idx) => {
    const pct = ((mins / totalMinutes) * 100).toFixed(1);
    const color = getSubjectColor(subj, idx);

    const seg = document.createElement("div");
    seg.className = "dist-segment";
    seg.style.width = `${pct}%`;
    seg.style.backgroundColor = color;
    seg.title = `${subj}: ${fmtDur(mins)} (${pct}%)`;
    bar.appendChild(seg);

    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-dot" style="background:${color}"></span>
      <span>${escapeHtml(subj)} (${fmtDur(mins)})</span>
    `;
    legend.appendChild(item);
  });
}

function updateProgressUI(totalSessions) {
  if (!totalSessions && currentPlan) {
    totalSessions = (currentPlan.days || []).reduce((acc, d) => acc + (d.sessions || []).length, 0);
  }
  if (!totalSessions) return;

  let completedCount = 0;
  for (const id of completedSessions) {
    if (sessionExistsInPlan(id)) completedCount++;
  }

  const pct = Math.round((completedCount / totalSessions) * 100);
  $("statProgressVal").textContent = `${pct}%`;
  $("statProgressSub").textContent = `${completedCount} of ${totalSessions} done`;
  $("progressPercent").textContent = `${pct}% (${completedCount}/${totalSessions})`;
  $("progressBarFill").style.width = `${pct}%`;

  // Handle Plan Completed State (100% Progress)
  const isCompleted = (totalSessions > 0 && completedCount === totalSessions);
  const compCard = $("planCompletedCard");
  if (compCard) {
    compCard.style.display = isCompleted ? "block" : "none";
    if (isCompleted) {
      if ($("compSessionsCount")) $("compSessionsCount").textContent = `${completedCount} of ${totalSessions} sessions`;
      if ($("compTotalHours")) $("compTotalHours").textContent = $("statTotalTime").textContent;
      const subjectsSet = new Set((currentPlan.days || []).flatMap(d => (d.sessions || []).map(s => s.subject)));
      if ($("compSubjectCount")) $("compSubjectCount").textContent = `${subjectsSet.size} subject${subjectsSet.size === 1 ? '' : 's'}`;
    }
  }

  const btnToggleAll = $("btnToggleAllSessions");
  if (btnToggleAll) {
    btnToggleAll.innerHTML = isCompleted ? "<span>↩️ Reset Checklist</span>" : "<span>☑️ Mark All Done</span>";
  }
}

function sessionExistsInPlan(sessionId) {
  if (!currentPlan) return false;
  for (const day of currentPlan.days || []) {
    for (const s of day.sessions || []) {
      if (`${day.date}-${s.start}-${s.subject}` === sessionId) return true;
    }
  }
  return false;
}

function toggleSessionComplete(sessionId) {
  if (completedSessions.has(sessionId)) {
    completedSessions.delete(sessionId);
  } else {
    completedSessions.add(sessionId);
  }
  localStorage.setItem(STORE_COMPLETED, JSON.stringify([...completedSessions]));
  updateProgressUI();

  document.querySelectorAll(`[data-session-id="${sessionId}"]`).forEach((el) => {
    el.classList.toggle("completed", completedSessions.has(sessionId));
    const chk = el.querySelector(".session-checkbox");
    if (chk) chk.checked = completedSessions.has(sessionId);
  });

  if (activeSavedPlanId && currentUser) {
    syncPlanProgress(activeSavedPlanId, [...completedSessions]);
  }
}

function toggleAllPlanSessions() {
  if (!currentPlan) return;
  const allIds = [];
  for (const day of currentPlan.days || []) {
    for (const s of day.sessions || []) {
      allIds.push(`${day.date}-${s.start}-${s.subject}`);
    }
  }
  if (!allIds.length) return;

  const allDone = allIds.every(id => completedSessions.has(id));
  if (allDone) {
    // Uncheck all
    allIds.forEach(id => completedSessions.delete(id));
    showToast("Checklist reset: sessions marked as pending.");
  } else {
    // Check all
    allIds.forEach(id => completedSessions.add(id));
    showToast("🎉 All sessions marked as completed! Download your PDF certificate below.");
  }

  localStorage.setItem(STORE_COMPLETED, JSON.stringify([...completedSessions]));
  updateProgressUI();
  renderActiveView();

  if (activeSavedPlanId && currentUser) {
    syncPlanProgress(activeSavedPlanId, [...completedSessions]);
  }
}

async function syncPlanProgress(planId, completedList) {
  try {
    await fetch("/api/plans/progress", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ id: planId, completed_sessions: completedList })
    });
  } catch (_) {}
}

function renderActiveView() {
  const container = $("viewContainer");
  container.innerHTML = "";
  if (!currentPlan) return;

  if (currentView === "cards") {
    container.appendChild(renderCardsView(currentPlan));
  } else if (currentView === "timeline") {
    container.appendChild(renderTimelineView(currentPlan));
  } else if (currentView === "checklist") {
    container.appendChild(renderChecklistView(currentPlan));
  }
}

function filterPlanSessions(sessions) {
  if (!sessions) return [];
  if (selectedSubjectFilter === "all") return sessions;
  return sessions.filter(s => s.subject === selectedSubjectFilter);
}

function buildSessionItem(s, dateStr) {
  const sessionId = `${dateStr}-${s.start}-${s.subject}`;
  const isDone = completedSessions.has(sessionId);
  const durMin = toMin(s.end) - toMin(s.start);
  const color = getSubjectColor(s.subject);

  const item = document.createElement("div");
  item.className = "session-item" + (isDone ? " completed" : "");
  item.setAttribute("data-session-id", sessionId);
  item.style.setProperty("--subj-color", color);

  item.innerHTML = `
    <div class="session-header">
      <div class="session-check-wrap">
        <input type="checkbox" class="session-checkbox" ${isDone ? "checked" : ""} aria-label="Mark completed">
        <span class="session-subj-name">${escapeHtml(s.subject)}</span>
      </div>
      <span class="session-time-pill">${s.start}&ndash;${s.end} &bull; ${fmtDur(durMin)}</span>
    </div>
    <p class="session-topic">${escapeHtml(s.topic || "Core review & active recall")}</p>
    <div>
      <span class="session-type-badge type-${s.type || 'learn'}">${(s.type || 'learn').replace('-', ' ')}</span>
    </div>
  `;

  item.querySelector(".session-checkbox").addEventListener("change", () => {
    toggleSessionComplete(sessionId);
  });

  return item;
}

function renderCardsView(plan) {
  const grid = document.createElement("div");
  grid.className = "days-grid";

  for (const day of plan.days || []) {
    const matchingSessions = filterPlanSessions(day.sessions || []);
    if (selectedSubjectFilter !== "all" && !matchingSessions.length) continue;

    const card = document.createElement("div");
    card.className = "day-card";
    const sessCount = matchingSessions.length;

    card.innerHTML = `
      <div class="day-card-header">
        <div>
          <div class="day-title">${day.weekday || ''}, ${day.date || ''}</div>
          <div class="day-meta">${day.full_date || ''}</div>
        </div>
        <span class="badge badge-student" style="font-size:0.7rem">${sessCount} session${sessCount === 1 ? '' : 's'}</span>
      </div>
      <div class="sessions-list"></div>
    `;

    const list = card.querySelector(".sessions-list");
    for (const s of matchingSessions) {
      list.appendChild(buildSessionItem(s, day.date));
    }
    grid.appendChild(card);
  }

  if (selectedSubjectFilter !== "all" && !grid.children.length) {
    grid.innerHTML = `<div class="glass-card" style="padding:24px;text-align:center;color:var(--text-secondary)">No scheduled sessions found for "${escapeHtml(selectedSubjectFilter)}".</div>`;
  }

  return grid;
}

function renderTimelineView(plan) {
  const wrap = document.createElement("div");
  wrap.className = "glass-card";
  wrap.style.padding = "20px";

  let totalVisible = 0;
  for (const day of plan.days || []) {
    const matchingSessions = filterPlanSessions(day.sessions || []);
    if (selectedSubjectFilter !== "all" && !matchingSessions.length) continue;
    totalVisible += matchingSessions.length;

    const sec = document.createElement("div");
    sec.style.marginBottom = "24px";
    sec.innerHTML = `
      <div style="font-weight:800;font-size:1.05rem;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
        <span>${day.weekday || ''}, ${day.full_date || day.date}</span>
        <span style="font-size:0.8rem;color:var(--text-muted)">${matchingSessions.length} sessions</span>
      </div>
      <div class="sessions-list"></div>
    `;
    const list = sec.querySelector(".sessions-list");
    for (const s of matchingSessions) {
      list.appendChild(buildSessionItem(s, day.date));
    }
    wrap.appendChild(sec);
  }

  if (!totalVisible) {
    wrap.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-secondary)">No sessions match the current filter.</div>`;
  }
  return wrap;
}

function renderChecklistView(plan) {
  const wrap = document.createElement("div");
  wrap.className = "glass-card";
  wrap.style.padding = "20px";

  let totalVisible = 0;
  for (const day of plan.days || []) {
    const matchingSessions = filterPlanSessions(day.sessions || []);
    if (selectedSubjectFilter !== "all" && !matchingSessions.length) continue;
    totalVisible += matchingSessions.length;

    const sec = document.createElement("div");
    sec.style.marginBottom = "20px";
    sec.innerHTML = `
      <div style="font-weight:800;font-size:0.95rem;margin-bottom:10px;color:var(--primary)">
        📅 ${day.weekday || ''} &bull; ${day.full_date || day.date} (${matchingSessions.length} sessions)
      </div>
      <div class="sessions-list"></div>
    `;
    const list = sec.querySelector(".sessions-list");
    for (const s of matchingSessions) {
      list.appendChild(buildSessionItem(s, day.date));
    }
    wrap.appendChild(sec);
  }

  if (!totalVisible) {
    wrap.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-secondary)">No sessions match the current filter.</div>`;
  }
  return wrap;
}

// Request Handler for Gemini / Sample Demo
async function requestTimetable(endpoint, payload) {
  const alertEl = $("plannerAlert");
  alertEl.style.display = "none";
  const btn = endpoint.includes("sample") ? $("btnSampleDemo") : $("btnGenerateAI");
  const origHtml = btn.innerHTML;
  btn.disabled = true;

  const genBox = $("plannerGeneratingBox");
  const genTitle = $("generatingStatusTitle");
  const genDesc = $("generatingStatusDesc");
  if (genBox) genBox.style.display = "block";

  let step = 0;
  const steps = [
    { title: "Analyzing subjects & exam proximity...", desc: "Weighting difficulties and spacing high-yield sessions" },
    { title: "Balancing daily study intervals...", desc: "Structuring Pomodoro intervals and active recall drills" },
    { title: "Finalizing personalized schedule...", desc: "Synthesizing day-by-day timetable & AI coaching tips" }
  ];
  const stepTimer = setInterval(() => {
    step = (step + 1) % steps.length;
    if (genTitle) genTitle.textContent = steps[step].title;
    if (genDesc) genDesc.textContent = steps[step].desc;
  }, 1600);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    clearInterval(stepTimer);
    if (genBox) genBox.style.display = "none";
    btn.disabled = false;
    btn.innerHTML = origHtml;

    if (!res.ok) {
      alertEl.textContent = data.error || "Failed to generate timetable.";
      alertEl.style.display = "block";
      alertEl.scrollIntoView({ behavior: "smooth" });
      return;
    }

    renderTimetable(data);
    showToast("✨ Timetable generated successfully! Ready for PDF download.");
  } catch (err) {
    clearInterval(stepTimer);
    if (genBox) genBox.style.display = "none";
    btn.disabled = false;
    btn.innerHTML = origHtml;
    alertEl.textContent = "Server connection error. Please try again.";
    alertEl.style.display = "block";
  }
}

// File Download Helper
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Calendar Export (.ics)
function toICS(plan) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart Study AI//Adaptive Timetable Generator//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];

  for (const day of plan.days || []) {
    const dateClean = (day.date || "").replace(/-/g, "");
    for (const s of day.sessions || []) {
      const sStart = (s.start || "").replace(":", "");
      const sEnd = (s.end || "").replace(":", "");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${dateClean}-${sStart}-${Math.random().toString(36).slice(2)}@smartstudyai`,
        `DTSTAMP:${dateClean}T${sStart}00`,
        `DTSTART:${dateClean}T${sStart}00`,
        `DTEND:${dateClean}T${sEnd}00`,
        `SUMMARY:Study: ${s.subject} [${(s.type || 'learn').toUpperCase()}]`,
        `DESCRIPTION:Topic: ${s.topic || 'Review'}\\nType: ${s.type || 'learn'}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Study Session Starting in 15 Minutes",
        "TRIGGER:-PT15M",
        "END:VALARM",
        "END:VEVENT"
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// CSV Export
function toCSV(plan) {
  const rows = [["Date", "Weekday", "Start Time", "End Time", "Subject", "Type", "Topic"]];
  for (const day of plan.days || []) {
    for (const s of day.sessions || []) {
      rows.push([
        day.date,
        day.weekday,
        s.start,
        s.end,
        `"${(s.subject || "").replace(/"/g, '""')}"`,
        s.type,
        `"${(s.topic || "").replace(/"/g, '""')}"`
      ]);
    }
  }
  return rows.map((r) => r.join(",")).join("\n");
}

/* =============================================================================
   PDF Generation & Export Engine (via html2pdf.js)
   Supports: Detailed Timetable, Action Checklist, Executive Summary & Certificate
   ============================================================================= */

function openPdfOptionsModal(preselectedFormat) {
  if (!currentPlan) {
    showToast("Please generate or load a timetable first!");
    return;
  }
  if (preselectedFormat) {
    selectedPdfFormat = preselectedFormat;
    document.querySelectorAll(".pdf-format-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.format === preselectedFormat);
    });
    if (preselectedFormat === "certificate") {
      $("pdfOrientation").value = "landscape";
    }
  }
  const modal = $("pdfOptionsModal");
  if (modal) modal.style.display = "flex";
}

function closePdfModal() {
  const modal = $("pdfOptionsModal");
  if (modal) modal.style.display = "none";
}

function buildPdfHtml(plan, options) {
  const isMono = options.theme === "mono";
  const studentName = currentUser ? (currentUser.name || currentUser.email.split("@")[0]) : "Dedicated Scholar";
  const planTitle = activeSavedPlanTitle || "Adaptive Exam Study Timetable";
  const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  let totalMinutes = 0;
  let totalSessions = 0;
  const subjMinutes = {};
  for (const day of plan.days || []) {
    for (const s of day.sessions || []) {
      const dur = toMin(s.end) - toMin(s.start);
      if (dur > 0) {
        totalMinutes += dur;
        totalSessions++;
        subjMinutes[s.subject] = (subjMinutes[s.subject] || 0) + dur;
      }
    }
  }
  const daysCount = (plan.days || []).length || 1;
  const totalHours = (totalMinutes / 60).toFixed(1);
  const dailyAvg = (totalMinutes / 60 / daysCount).toFixed(1);

  let completedCount = 0;
  for (const id of completedSessions) {
    if (sessionExistsInPlan(id)) completedCount++;
  }
  const completionPct = totalSessions ? Math.round((completedCount / totalSessions) * 100) : 0;

  // Colors based on theme
  const primaryColor = isMono ? "#000000" : "#4f46e5";
  const secondaryColor = isMono ? "#333333" : "#64748b";
  const borderColor = isMono ? "#cccccc" : "#e2e8f0";
  const bgLight = isMono ? "#ffffff" : "#f8fafc";
  const accentBox = isMono ? "#f5f5f5" : "#eef2ff";

  // Option 4: Study Completion Certificate Layout
  if (options.layout === "certificate") {
    return `
      <div style="padding:40px 30px;text-align:center;background:#fff;border:8px double ${isMono ? '#000' : '#4f46e5'};border-radius:12px;font-family:'Plus Jakarta Sans',sans-serif">
        <div style="font-size:3rem;margin-bottom:8px">🎓</div>
        <div style="font-size:0.85rem;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;color:${secondaryColor};margin-bottom:6px">
          SMART STUDY AI &bull; ACADEMIC EXCELLENCE
        </div>
        <h1 style="font-size:2.4rem;font-weight:800;color:${primaryColor};margin:0 0 16px;text-transform:uppercase;letter-spacing:-0.02em">
          Certificate of Completion
        </h1>
        <p style="font-size:1.05rem;color:${secondaryColor};margin:0 0 12px">
          This certifies that
        </p>
        <div style="font-size:2rem;font-weight:800;color:#0f172a;border-bottom:2px solid ${isMono ? '#333' : '#6366f1'};display:inline-block;padding:0 30px 6px;margin-bottom:16px">
          ${escapeHtml(studentName)}
        </div>
        <p style="font-size:1.05rem;color:${secondaryColor};max-width:620px;margin:0 auto 20px;line-height:1.6">
          has successfully organized, tracked, and mastered their study timetable for:
          <br><strong style="font-size:1.25rem;color:${primaryColor}">"${escapeHtml(planTitle)}"</strong>
        </p>
        <div style="display:flex;justify-content:center;gap:20px;margin:24px 0">
          <div style="background:${bgLight};border:1px solid ${borderColor};padding:12px 24px;border-radius:8px">
            <div style="font-size:1.4rem;font-weight:800;color:${primaryColor}">${totalHours} hrs</div>
            <div style="font-size:0.75rem;text-transform:uppercase;color:${secondaryColor}">Total Study Time</div>
          </div>
          <div style="background:${bgLight};border:1px solid ${borderColor};padding:12px 24px;border-radius:8px">
            <div style="font-size:1.4rem;font-weight:800;color:${primaryColor}">${totalSessions}</div>
            <div style="font-size:0.75rem;text-transform:uppercase;color:${secondaryColor}">Sessions Mastered</div>
          </div>
          <div style="background:${bgLight};border:1px solid ${borderColor};padding:12px 24px;border-radius:8px">
            <div style="font-size:1.4rem;font-weight:800;color:#10b981">${completionPct}%</div>
            <div style="font-size:0.75rem;text-transform:uppercase;color:${secondaryColor}">Verified Progress</div>
          </div>
        </div>
        <div style="margin-top:36px;display:flex;justify-content:space-between;align-items:flex-end;padding:0 40px">
          <div style="text-align:left">
            <div style="font-size:0.8rem;color:${secondaryColor}">Date Issued:</div>
            <div style="font-weight:700;font-size:0.95rem">${dateStr}</div>
          </div>
          <div style="text-align:center">
            <div style="display:inline-block;border:2px solid ${isMono ? '#333' : '#10b981'};color:${isMono ? '#333' : '#10b981'};padding:4px 14px;border-radius:999px;font-weight:800;font-size:0.75rem;text-transform:uppercase">
              &check; Verified Achievement
            </div>
          </div>
          <div style="text-align:right">
            <div style="border-bottom:1px solid #94a3b8;width:160px;margin-bottom:4px"></div>
            <div style="font-size:0.8rem;color:${secondaryColor};font-weight:600">Smart Study AI Tutor</div>
          </div>
        </div>
      </div>
    `;
  }

  // Option 2: Action Checklist Layout
  if (options.layout === "checklist") {
    let rowsHtml = "";
    for (const day of plan.days || []) {
      for (const s of day.sessions || []) {
        const sessionId = `${day.date}-${s.start}-${s.subject}`;
        const isDone = completedSessions.has(sessionId);
        const checkIcon = (options.includeProgress && isDone) ? "&check;" : "&nbsp;";
        const checkBg = (options.includeProgress && isDone) ? (isMono ? "#ddd" : "#dcfce7") : "#fff";
        const dur = fmtDur(toMin(s.end) - toMin(s.start));
        rowsHtml += `
          <tr style="border-bottom:1px solid ${borderColor}">
            <td style="padding:8px 10px;text-align:center;width:40px">
              <div style="width:18px;height:18px;border:1.5px solid #475569;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;background:${checkBg};font-weight:bold;font-size:12px">
                ${checkIcon}
              </div>
            </td>
            <td style="padding:8px 10px;font-weight:700;font-size:0.82rem;white-space:nowrap">${day.weekday}, ${day.date}</td>
            <td style="padding:8px 10px;font-size:0.8rem;color:${secondaryColor};white-space:nowrap">${s.start}&ndash;${s.end} (${dur})</td>
            <td style="padding:8px 10px;font-weight:700;font-size:0.85rem">${escapeHtml(s.subject)}</td>
            <td style="padding:8px 10px;font-size:0.75rem;text-transform:uppercase;color:${secondaryColor}">${escapeHtml(s.type || 'learn')}</td>
            <td style="padding:8px 10px;font-size:0.82rem;line-height:1.4">${escapeHtml(s.topic || 'Review session')}</td>
            <td style="padding:8px 10px;border-left:1px dashed ${borderColor};width:90px">&nbsp;</td>
          </tr>
        `;
      }
    }

    return `
      <div style="font-family:'Plus Jakarta Sans',sans-serif;color:#0f172a;line-height:1.4">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${primaryColor};padding-bottom:12px;margin-bottom:14px">
          <div>
            <h1 style="font-size:1.4rem;font-weight:800;color:${primaryColor};margin:0 0 4px">
              Study Plan Checklist & Progress Tracker
            </h1>
            <div style="font-size:0.85rem;color:${secondaryColor}">
              Timetable: <strong>${escapeHtml(planTitle)}</strong> &bull; Total ${totalSessions} Sessions across ${daysCount} Days
            </div>
          </div>
          <div style="text-align:right;font-size:0.8rem;color:${secondaryColor}">
            ${options.includeStudentInfo ? `<div>Student: <strong>${escapeHtml(studentName)}</strong></div>` : ''}
            <div>Generated: ${dateStr}</div>
            <div style="margin-top:2px;font-weight:700;color:${isMono ? '#000' : '#10b981'}">Completed: ${completedCount}/${totalSessions} (${completionPct}%)</div>
          </div>
        </div>

        <!-- Table -->
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-bottom:18px">
          <thead>
            <tr style="background:${bgLight};border-bottom:2px solid ${borderColor};text-align:left">
              <th style="padding:8px 10px;text-align:center;width:40px">Done</th>
              <th style="padding:8px 10px">Day / Date</th>
              <th style="padding:8px 10px">Time Window</th>
              <th style="padding:8px 10px">Subject</th>
              <th style="padding:8px 10px">Type</th>
              <th style="padding:8px 10px">Specific Topic & Goals</th>
              <th style="padding:8px 10px;width:90px">Notes / Score</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        ${options.includeTips && plan.tips && plan.tips.length ? `
          <div style="background:${accentBox};border:1px solid ${borderColor};border-radius:6px;padding:12px 16px;margin-top:14px">
            <strong style="font-size:0.82rem;color:${primaryColor};display:block;margin-bottom:6px">💡 Study Execution Tips:</strong>
            <ul style="margin:0;padding-left:18px;font-size:0.78rem;color:${secondaryColor};line-height:1.4">
              ${plan.tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")}
            </ul>
          </div>
        ` : ''}

        <div style="margin-top:16px;border-top:1px solid ${borderColor};padding-top:8px;font-size:0.72rem;color:${secondaryColor};display:flex;justify-content:space-between">
          <span>Smart Study AI &bull; Printable Study Tracker</span>
          <span>Tip: Check off items as you complete them to maintain study momentum!</span>
        </div>
      </div>
    `;
  }

  // Option 3: Executive Summary & Analytics Layout
  if (options.layout === "summary") {
    let subjRows = "";
    Object.entries(subjMinutes).sort((a,b) => b[1] - a[1]).forEach(([subj, mins]) => {
      const hours = (mins / 60).toFixed(1);
      const pct = totalMinutes ? ((mins / totalMinutes) * 100).toFixed(1) : 0;
      subjRows += `
        <tr style="border-bottom:1px solid ${borderColor}">
          <td style="padding:8px 12px;font-weight:700">${escapeHtml(subj)}</td>
          <td style="padding:8px 12px">${hours} hrs</td>
          <td style="padding:8px 12px">${pct}%</td>
          <td style="padding:8px 12px">
            <div style="background:${borderColor};border-radius:999px;height:6px;width:100%;overflow:hidden">
              <div style="background:${primaryColor};height:100%;width:${pct}%"></div>
            </div>
          </td>
        </tr>
      `;
    });

    let dayRows = "";
    (plan.days || []).forEach(day => {
      const sess = day.sessions || [];
      const dayMins = sess.reduce((sum, s) => sum + (toMin(s.end) - toMin(s.start)), 0);
      const subjsList = [...new Set(sess.map(s => s.subject))].join(", ");
      dayRows += `
        <tr style="border-bottom:1px solid ${borderColor}">
          <td style="padding:8px 12px;font-weight:700">${day.weekday}, ${day.date}</td>
          <td style="padding:8px 12px">${sess.length} sessions</td>
          <td style="padding:8px 12px">${fmtDur(dayMins)}</td>
          <td style="padding:8px 12px;color:${secondaryColor}">${escapeHtml(subjsList || "Rest/Flexible")}</td>
        </tr>
      `;
    });

    return `
      <div style="font-family:'Plus Jakarta Sans',sans-serif;color:#0f172a">
        <!-- Header -->
        <div style="border-bottom:2px solid ${primaryColor};padding-bottom:14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h1 style="font-size:1.5rem;font-weight:800;color:${primaryColor};margin:0 0 4px">
              Executive Study Plan & Exam Strategy Overview
            </h1>
            <div style="font-size:0.88rem;color:${secondaryColor}">
              Timetable: <strong>${escapeHtml(planTitle)}</strong> &bull; Generated: ${dateStr}
            </div>
          </div>
          ${options.includeStudentInfo ? `
            <div style="text-align:right;font-size:0.85rem;color:${secondaryColor}">
              <div>Student: <strong>${escapeHtml(studentName)}</strong></div>
              <div>Progress: <strong style="color:${isMono ? '#000' : '#10b981'}">${completionPct}% Completed</strong></div>
            </div>
          ` : ''}
        </div>

        <!-- Strategy Box -->
        <div style="background:${accentBox};border:1px solid ${borderColor};border-radius:8px;padding:14px 18px;margin-bottom:18px">
          <strong style="font-size:0.9rem;color:${primaryColor};display:block;margin-bottom:4px">🎯 AI Optimization Summary:</strong>
          <p style="margin:0;font-size:0.85rem;color:#1e293b;line-height:1.5">
            ${escapeHtml(plan.summary || "Balanced timetable prioritizing imminent exams and active cognitive recall intervals.")}
          </p>
        </div>

        <!-- Metric Grid -->
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;margin-bottom:20px">
          <div style="background:${bgLight};border:1px solid ${borderColor};border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:1.35rem;font-weight:800;color:${primaryColor}">${totalHours} hrs</div>
            <div style="font-size:0.72rem;text-transform:uppercase;color:${secondaryColor}">Total Study Hours</div>
          </div>
          <div style="background:${bgLight};border:1px solid ${borderColor};border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:1.35rem;font-weight:800;color:${primaryColor}">${totalSessions}</div>
            <div style="font-size:0.72rem;text-transform:uppercase;color:${secondaryColor}">Study Sessions</div>
          </div>
          <div style="background:${bgLight};border:1px solid ${borderColor};border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:1.35rem;font-weight:800;color:${primaryColor}">${daysCount} Days</div>
            <div style="font-size:0.72rem;text-transform:uppercase;color:${secondaryColor}">Duration</div>
          </div>
          <div style="background:${bgLight};border:1px solid ${borderColor};border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:1.35rem;font-weight:800;color:${primaryColor}">${dailyAvg} hrs</div>
            <div style="font-size:0.72rem;text-transform:uppercase;color:${secondaryColor}">Daily Average</div>
          </div>
        </div>

        <!-- Subject Allocation Table -->
        <div style="margin-bottom:20px">
          <h3 style="font-size:1rem;font-weight:800;margin:0 0 8px;color:${primaryColor}">Subject Time Distribution</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
            <thead>
              <tr style="background:${bgLight};border-bottom:1.5px solid ${borderColor};text-align:left">
                <th style="padding:8px 12px">Subject</th>
                <th style="padding:8px 12px">Allocated Time</th>
                <th style="padding:8px 12px">Share</th>
                <th style="padding:8px 12px;width:180px">Proportion</th>
              </tr>
            </thead>
            <tbody>${subjRows}</tbody>
          </table>
        </div>

        <!-- Day Breakdown Table -->
        <div style="margin-bottom:20px">
          <h3 style="font-size:1rem;font-weight:800;margin:0 0 8px;color:${primaryColor}">Daily Schedule Breakdown</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.83rem">
            <thead>
              <tr style="background:${bgLight};border-bottom:1.5px solid ${borderColor};text-align:left">
                <th style="padding:8px 12px">Day & Date</th>
                <th style="padding:8px 12px">Sessions</th>
                <th style="padding:8px 12px">Hours</th>
                <th style="padding:8px 12px">Subjects Covered</th>
              </tr>
            </thead>
            <tbody>${dayRows}</tbody>
          </table>
        </div>

        ${options.includeTips && plan.tips && plan.tips.length ? `
          <div style="background:${accentBox};border:1px solid ${borderColor};border-radius:8px;padding:12px 16px;margin-top:14px">
            <strong style="font-size:0.85rem;color:${primaryColor};display:block;margin-bottom:6px">💡 Tactical Recommendations:</strong>
            <ul style="margin:0;padding-left:18px;font-size:0.8rem;color:${secondaryColor};line-height:1.4">
              ${plan.tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Option 1: Full Detailed Timetable Layout (Default)
  let daysCardsHtml = "";
  for (const day of plan.days || []) {
    let sessHtml = "";
    for (const s of day.sessions || []) {
      const dur = fmtDur(toMin(s.end) - toMin(s.start));
      const sessionId = `${day.date}-${s.start}-${s.subject}`;
      const isDone = completedSessions.has(sessionId);
      const doneCheck = (options.includeProgress && isDone) ? `<span style="color:#10b981;font-weight:800;margin-left:6px">&check; Done</span>` : '';
      sessHtml += `
        <div style="padding:8px 10px;border-bottom:1px solid ${borderColor};display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div>
            <div style="font-weight:700;font-size:0.86rem;color:#0f172a">
              ${escapeHtml(s.subject)}
              <span style="font-size:0.68rem;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:${isMono ? '#eee' : '#e0e7ff'};color:${primaryColor};margin-left:6px;font-weight:600">
                ${escapeHtml(s.type || 'learn')}
              </span>
              ${doneCheck}
            </div>
            <div style="font-size:0.78rem;color:${secondaryColor};margin-top:2px">
              ${escapeHtml(s.topic || 'Core review')}
            </div>
          </div>
          <div style="font-family:monospace;font-size:0.78rem;color:${secondaryColor};white-space:nowrap;text-align:right">
            ${s.start}&ndash;${s.end}<br><span style="font-size:0.72rem">${dur}</span>
          </div>
        </div>
      `;
    }

    daysCardsHtml += `
      <div style="page-break-inside:avoid;border:1px solid ${borderColor};border-radius:8px;background:${bgLight};margin-bottom:14px;overflow:hidden">
        <div style="background:${isMono ? '#f0f0f0' : '#f1f5f9'};padding:8px 12px;border-bottom:1px solid ${borderColor};display:flex;justify-content:space-between;align-items:center">
          <strong style="font-size:0.9rem;color:#0f172a">${day.weekday}, ${day.full_date || day.date}</strong>
          <span style="font-size:0.75rem;color:${secondaryColor}">${(day.sessions || []).length} sessions</span>
        </div>
        <div>${sessHtml || '<div style="padding:10px;font-size:0.8rem;color:#94a3b8">Rest / Flexible day</div>'}</div>
      </div>
    `;
  }

  return `
    <div style="font-family:'Plus Jakarta Sans',sans-serif;color:#0f172a;line-height:1.4">
      <!-- Title Header -->
      <div style="border-bottom:2px solid ${primaryColor};padding-bottom:12px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <h1 style="font-size:1.5rem;font-weight:800;color:${primaryColor};margin:0 0 4px">
            Smart Study AI &bull; Complete Study Timetable
          </h1>
          <div style="font-size:0.85rem;color:${secondaryColor}">
            Plan: <strong>${escapeHtml(planTitle)}</strong> &bull; ${daysCount} Days &bull; ${totalHours} Total Hours &bull; ${totalSessions} Study Sessions
          </div>
        </div>
        <div style="text-align:right;font-size:0.8rem;color:${secondaryColor}">
          ${options.includeStudentInfo ? `<div>Student: <strong>${escapeHtml(studentName)}</strong></div>` : ''}
          <div>Date: ${dateStr}</div>
          ${options.includeProgress ? `<div style="font-weight:700;color:${isMono ? '#000' : '#10b981'}">Progress: ${completedCount}/${totalSessions} (${completionPct}%)</div>` : ''}
        </div>
      </div>

      <!-- Summary box -->
      <div style="background:${accentBox};border:1px solid ${borderColor};border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:0.85rem">
        <strong>Overview:</strong> ${escapeHtml(plan.summary || "Optimized study schedule spacing revisions and prioritizing key exam topics.")}
      </div>

      <!-- Schedule Cards -->
      <div style="display:grid;grid-template-columns:${options.orientation === 'landscape' ? '1fr 1fr' : '1fr'};gap:12px;margin-bottom:16px">
        ${daysCardsHtml}
      </div>

      <!-- AI Tips -->
      ${options.includeTips && plan.tips && plan.tips.length ? `
        <div style="page-break-inside:avoid;background:${accentBox};border:1px solid ${borderColor};border-radius:6px;padding:12px 14px;margin-top:14px">
          <strong style="font-size:0.84rem;color:${primaryColor};display:block;margin-bottom:6px">💡 Personalized AI Coaching Tips:</strong>
          <ul style="margin:0;padding-left:18px;font-size:0.78rem;color:${secondaryColor};line-height:1.4">
            ${plan.tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")}
          </ul>
        </div>
      ` : ''}

      <div style="margin-top:14px;border-top:1px solid ${borderColor};padding-top:8px;font-size:0.72rem;color:${secondaryColor};display:flex;justify-content:space-between">
        <span>Generated by Smart Study AI</span>
        <span>${dateStr}</span>
      </div>
    </div>
  `;
}

async function exportPlanAsPdf(options) {
  if (!currentPlan) {
    showToast("No active timetable to export. Generate a plan first!");
    return;
  }

  options = Object.assign({
    layout: selectedPdfFormat || "detailed",
    orientation: $("pdfOrientation") ? $("pdfOrientation").value : "portrait",
    paperSize: $("pdfPaperSize") ? $("pdfPaperSize").value : "a4",
    theme: $("pdfTheme") ? $("pdfTheme").value : "color",
    includeTips: $("pdfIncludeTips") ? $("pdfIncludeTips").checked : true,
    includeDistribution: $("pdfIncludeDistribution") ? $("pdfIncludeDistribution").checked : true,
    includeProgress: $("pdfIncludeProgress") ? $("pdfIncludeProgress").checked : true,
    includeStudentInfo: $("pdfIncludeStudentInfo") ? $("pdfIncludeStudentInfo").checked : true
  }, options || {});

  closePdfModal();
  showToast("⏳ Generating high-quality PDF...");

  const isLandscape = options.orientation === "landscape";
  const widthPx = isLandscape ? "1060px" : "790px";

  // Use fixed positioning so html2canvas can accurately measure and render the DOM
  const container = document.createElement("div");
  container.id = "pdfRenderContainer";
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = widthPx;
  container.style.minHeight = "100vh";
  container.style.zIndex = "-99999";
  container.style.opacity = "0.01";
  container.style.pointerEvents = "none";
  container.style.backgroundColor = "#ffffff";
  container.style.color = "#0f172a";
  container.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
  container.style.padding = "24px";
  container.style.boxSizing = "border-box";

  container.innerHTML = buildPdfHtml(currentPlan, options);
  document.body.appendChild(container);

  const rawTitle = activeSavedPlanTitle || (currentPlan.summary ? currentPlan.summary.slice(0, 24) : "Study_Timetable");
  const cleanTitle = rawTitle.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
  const filename = `${cleanTitle}_${options.layout}.pdf`;

  const opt = {
    margin: isLandscape ? [8, 10, 8, 10] : [10, 10, 10, 10],
    filename: filename,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: "mm", format: options.paperSize || "a4", orientation: options.orientation || "portrait" }
  };

  try {
    if (typeof ensureHtml2Pdf === "function") {
      await ensureHtml2Pdf();
    }
    if (typeof html2pdf === "undefined") {
      throw new Error("html2pdf library could not be loaded.");
    }
    const worker = html2pdf().set(opt).from(container);
    // Explicitly generate PDF blob and trigger clean download with fallback
    try {
      const pdfBlob = await worker.outputPdf("blob");
      if (pdfBlob && pdfBlob.size > 0) {
        downloadFile(filename, pdfBlob, "application/pdf");
      } else {
        await worker.save();
      }
    } catch (_saveErr) {
      await worker.save();
    }
    showToast("✅ PDF downloaded successfully!");
  } catch (err) {
    console.error("PDF export error:", err);
    showToast("PDF generation failed: " + (err.message || "Opening print fallback..."));
    setTimeout(() => window.print(), 800);
  } finally {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

// Save Plan Functions
function promptSavePlan() {
  if (!currentPlan) {
    showToast("No active timetable generated yet. Click Demo Plan first!");
    return;
  }
  if (!currentUser) {
    showToast("Please log in to save timetables to your account.");
    setTimeout(() => {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }, 1200);
    return;
  }

  if (activeSavedPlanId) {
    updateStoredPlan(activeSavedPlanId);
    return;
  }

  const defaultTitle = $("notes").value.slice(0, 30) || `${(currentPlan.days || []).length || 7}-Day Study Timetable`;
  $("planTitleInput").value = defaultTitle;
  $("savePlanModal").style.display = "flex";
  $("planTitleInput").focus();
}

async function createStoredPlan(title) {
  try {
    const payload = {
      title: title,
      plan_data: currentPlan,
      form_state: collectForm(),
      completed_sessions: [...completedSessions]
    };
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save plan.");

    activeSavedPlanId = data.id;
    activeSavedPlanTitle = data.title;
    $("activeStoredPlanBadge").style.display = "inline-flex";
    $("activePlanTitleText").textContent = data.title;
    $("savePlanBtnText").textContent = "Update Stored Plan";

    showToast(`Timetable saved successfully!`);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function updateStoredPlan(planId) {
  try {
    const payload = {
      id: planId,
      title: activeSavedPlanTitle,
      plan_data: currentPlan,
      form_state: collectForm(),
      completed_sessions: [...completedSessions]
    };
    const res = await fetch("/api/plans/update", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed to update plan.");
    showToast(`Stored plan "${activeSavedPlanTitle}" updated!`);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

// Watch / Load Stored Plan by ID (e.g. from /plans?watch=1)
async function loadStoredPlanById(planId) {
  try {
    const res = await fetch(`/api/plans?id=${planId}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not load stored plan.");

    const p = data.plan;
    activeSavedPlanId = p.id;
    activeSavedPlanTitle = p.title;

    completedSessions = new Set(Array.isArray(p.completed_sessions) ? p.completed_sessions : []);
    localStorage.setItem(STORE_COMPLETED, JSON.stringify([...completedSessions]));

    if (p.form_state && typeof p.form_state === "object") {
      const fs = p.form_state;
      if (Array.isArray(fs.subjects) && fs.subjects.length) {
        $("subjectsContainer").innerHTML = "";
        fs.subjects.forEach((s) => addSubjectCard(s));
      }
      if (fs.days) {
        $("daysInput").value = fs.days;
        document.querySelectorAll(".duration-pill").forEach((pill) => {
          pill.classList.toggle("active", pill.dataset.days == fs.days);
        });
      }
      if (fs.weekday_hours) $("weekdayHours").value = fs.weekday_hours;
      if (fs.weekend_hours) $("weekendHours").value = fs.weekend_hours;
      if (fs.window_start) $("winStart").value = fs.window_start;
      if (fs.window_end) $("winEnd").value = fs.window_end;
      if (fs.session_minutes) $("sessionMin").value = fs.session_minutes;
      if (fs.break_minutes) $("breakMin").value = fs.break_minutes;
      if (fs.notes) $("notes").value = fs.notes;
      if (fs.model) $("modelSelect").value = fs.model;
    }

    renderTimetable(p.plan_data);

    $("activeStoredPlanBadge").style.display = "inline-flex";
    $("activePlanTitleText").textContent = p.title;
    $("savePlanBtnText").textContent = "Update Stored Plan";

    showToast(`Loaded stored plan: "${p.title}"`);
  } catch (err) {
    showToast(`Error loading plan: ${err.message}`);
  }
}

// Event Listeners Initialization
document.addEventListener("DOMContentLoaded", () => {
  loadState();

  $("btnAddSubject").addEventListener("click", () => addSubjectCard());

  document.querySelectorAll(".preset-chip").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  document.querySelectorAll(".duration-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".duration-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      $("daysInput").value = pill.dataset.days;
    });
  });

  if ($("toggleKeyVis") && $("apiKey")) {
    $("toggleKeyVis").addEventListener("click", () => {
      const inp = $("apiKey");
      inp.type = inp.type === "password" ? "text" : "password";
      $("toggleKeyVis").textContent = inp.type === "password" ? "Show Key" : "Hide Key";
    });
  }

  $("btnSampleDemo").addEventListener("click", () => {
    const payload = collectForm();
    saveState(payload);
    requestTimetable("/api/sample", payload);
  });

  $("btnGenerateAI").addEventListener("click", () => {
    const payload = collectForm();
    saveState(payload);
    requestTimetable("/api/generate", payload);
  });

  // View switchers
  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".view-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentView = tab.dataset.view;
      renderActiveView();
    });
  });

  // Subject Filter Change
  const filterSelect = $("filterSubjectSelect");
  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      selectedSubjectFilter = e.target.value;
      renderActiveView();
    });
  }

  // Toggle All Sessions
  const btnToggleAll = $("btnToggleAllSessions");
  if (btnToggleAll) {
    btnToggleAll.addEventListener("click", toggleAllPlanSessions);
  }

  // Action Buttons
  $("btnSavePlan").addEventListener("click", promptSavePlan);

  $("savePlanForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("planTitleInput").value.trim() || "My Study Timetable";
    $("savePlanModal").style.display = "none";
    await createStoredPlan(title);
  });

  $("btnExitPlanWatch").addEventListener("click", () => {
    activeSavedPlanId = null;
    activeSavedPlanTitle = "";
    $("activeStoredPlanBadge").style.display = "none";
    $("savePlanBtnText").textContent = "Save Plan";
    showToast("Switched to fresh plan mode.");
  });

  // PDF Buttons
  const btnOpenPdf = $("btnOpenPdfModal");
  if (btnOpenPdf) {
    btnOpenPdf.addEventListener("click", () => openPdfOptionsModal("detailed"));
  }

  const btnQuickPdf = $("btnQuickPdfTop");
  if (btnQuickPdf) {
    btnQuickPdf.addEventListener("click", () => openPdfOptionsModal("detailed"));
  }

  // Completion Card PDF Buttons
  const btnCert = $("btnDownloadCertificate");
  if (btnCert) {
    btnCert.addEventListener("click", () => {
      exportPlanAsPdf({ layout: "certificate", orientation: "landscape", paperSize: "a4", theme: "color" });
    });
  }

  const btnFinalPlan = $("btnDownloadFinalPlanPdf");
  if (btnFinalPlan) {
    btnFinalPlan.addEventListener("click", () => {
      exportPlanAsPdf({ layout: "detailed", orientation: "portrait", paperSize: "a4", theme: "color", includeProgress: true });
    });
  }

  const btnCompMore = $("btnCompletedMoreOptions");
  if (btnCompMore) {
    btnCompMore.addEventListener("click", () => openPdfOptionsModal("detailed"));
  }

  // PDF Modal Format Selector Cards
  document.querySelectorAll(".pdf-format-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".pdf-format-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      selectedPdfFormat = card.dataset.format;
      if (selectedPdfFormat === "certificate") {
        $("pdfOrientation").value = "landscape";
      } else if (selectedPdfFormat === "checklist") {
        $("pdfOrientation").value = "portrait";
      }
    });
  });

  // PDF Modal Action Buttons
  const btnClosePdf = $("btnClosePdfModal");
  if (btnClosePdf) btnClosePdf.addEventListener("click", closePdfModal);

  const btnCancelPdf = $("btnCancelPdfModal");
  if (btnCancelPdf) btnCancelPdf.addEventListener("click", closePdfModal);

  const btnExecPdf = $("btnExecuteDownloadPdf");
  if (btnExecPdf) {
    btnExecPdf.addEventListener("click", () => {
      exportPlanAsPdf();
    });
  }

  const btnBrowserFallback = $("btnBrowserPrintFallback");
  if (btnBrowserFallback) {
    btnBrowserFallback.addEventListener("click", () => {
      closePdfModal();
      window.print();
    });
  }

  $("btnExportICS").addEventListener("click", () => {
    if (!currentPlan) return;
    const icsContent = toICS(currentPlan);
    downloadFile("study_timetable.ics", icsContent, "text/calendar;charset=utf-8");
    showToast("Downloaded .ics calendar file!");
  });

  $("btnExportCSV").addEventListener("click", () => {
    if (!currentPlan) return;
    const csvContent = toCSV(currentPlan);
    downloadFile("study_timetable.csv", csvContent, "text/csv;charset=utf-8");
    showToast("Downloaded CSV file!");
  });

  $("btnPrintPDF").addEventListener("click", () => {
    window.print();
  });

  // Check URL query parameters for ?watch=<id>
  const params = new URLSearchParams(window.location.search);
  const watchId = params.get("watch");
  if (watchId) {
    loadStoredPlanById(watchId);
  }
});
