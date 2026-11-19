/* =============================================================================
   Smart Study AI - Saved Plans Controller
   ============================================================================= */

async function loadSavedPlans() {
  const grid = $("plansGrid");
  const emptyState = $("plansEmptyState");
  const authNotice = $("plansAuthNotice");
  const badge = $("plansCountBadge");

  if (!currentUser) {
    grid.style.display = "none";
    emptyState.style.display = "none";
    authNotice.style.display = "block";
    badge.textContent = "0 plans";
    return;
  }

  authNotice.style.display = "none";
  grid.style.display = "grid";
  grid.innerHTML = `
    <div class="glass-card" style="padding:20px;text-align:center">
      <div style="font-size:0.9rem;color:var(--text-secondary)">Loading your timetables...</div>
    </div>
  `;

  try {
    const res = await fetch("/api/plans", { headers: getAuthHeaders() });
    const data = await res.json();

    if (!res.ok) {
      grid.innerHTML = `<div class="alert alert-error">${escapeHtml(data.error || "Failed to load plans.")}</div>`;
      return;
    }

    const plans = data.plans || [];
    badge.textContent = `${plans.length} plan${plans.length === 1 ? '' : 's'}`;

    if (!plans.length) {
      grid.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    emptyState.style.display = "none";
    grid.innerHTML = "";

    plans.forEach((p) => {
      const card = document.createElement("div");
      card.className = "glass-card";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.justifyContent = "space-between";
      card.style.gap = "16px";

      const updatedStr = p.updated_at
        ? new Date(p.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "";

      card.innerHTML = `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
            <h3 style="font-size:1.15rem;font-weight:800;margin:0;line-height:1.3">
              ${escapeHtml(p.title)}
            </h3>
            <span class="badge badge-student" style="font-size:0.7rem">ID: #${p.id}</span>
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px">
            Last updated: ${updatedStr}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span class="badge" style="background:var(--bg-subtle);border:1px solid var(--border)">
              📚 ${p.subject_count || 0} subjects
            </span>
            <span class="badge" style="background:var(--bg-subtle);border:1px solid var(--border)">
              📅 ${p.total_days || 7} days
            </span>
            <span class="badge badge-success">
              ✅ ${p.completed_count || 0} sessions done
            </span>
          </div>
        </div>

        <div style="display:flex;gap:8px;border-top:1px solid var(--border);padding-top:14px">
          <a href="/planner?watch=${p.id}" class="btn btn-primary" style="flex:1;padding:8px 12px;font-size:0.82rem">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>Open Plan</span>
          </a>
          <button type="button" class="btn btn-secondary btn-pdf" data-id="${p.id}" data-title="${escapeHtml(p.title)}" style="padding:8px 12px;font-size:0.82rem" title="Download PDF">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="18"/><line x1="15" y1="15" x2="12" y2="18"/></svg>
            <span>PDF</span>
          </button>
          <button type="button" class="btn btn-secondary btn-rename" data-id="${p.id}" data-title="${escapeHtml(p.title)}" style="padding:8px;font-size:0.82rem" title="Rename plan">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          </button>
          <button type="button" class="btn btn-danger btn-delete" data-id="${p.id}" data-title="${escapeHtml(p.title)}" style="padding:8px;font-size:0.82rem" title="Delete plan">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;

      card.querySelector(".btn-pdf").addEventListener("click", (e) => {
        const btn = e.currentTarget;
        downloadSavedPlanPdf(Number(btn.dataset.id), btn.dataset.title);
      });

      card.querySelector(".btn-rename").addEventListener("click", (e) => {
        const btn = e.currentTarget;
        renamePlan(Number(btn.dataset.id), btn.dataset.title);
      });

      card.querySelector(".btn-delete").addEventListener("click", (e) => {
        const btn = e.currentTarget;
        deletePlan(Number(btn.dataset.id), btn.dataset.title);
      });

      grid.appendChild(card);
    });

  } catch (err) {
    grid.innerHTML = `<div class="alert alert-error">Unable to connect to server.</div>`;
  }
}

async function renamePlan(planId, currentTitle) {
  const newTitle = prompt("Enter new title for this timetable:", currentTitle);
  if (!newTitle || newTitle.trim() === currentTitle) return;

  try {
    const res = await fetch("/api/plans/rename", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ id: planId, title: newTitle.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to rename plan.");
    showToast("Timetable renamed!");
    loadSavedPlans();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function deletePlan(planId, title) {
  if (!confirm(`Are you sure you want to delete "${title}"? This cannot be undone.`)) return;

  try {
    const res = await fetch("/api/plans/delete", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ id: planId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to delete plan.");
    showToast("Timetable deleted.");
    loadSavedPlans();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function downloadSavedPlanPdf(planId, title) {
  try {
    showToast("Loading saved plan for PDF export...");
    const res = await fetch(`/api/plans?id=${planId}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.plan) throw new Error(data.error || "Could not retrieve plan.");

    const p = data.plan;
    const plan = p.plan_data;
    if (!plan || !plan.days) throw new Error("Plan contains no schedule data.");

    showToast("⏳ Generating PDF...");
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "790px";
    container.style.backgroundColor = "#ffffff";
    container.style.color = "#0f172a";
    container.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
    container.style.padding = "24px";
    container.style.boxSizing = "border-box";

    const completedSet = new Set(Array.isArray(p.completed_sessions) ? p.completed_sessions : []);
    const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const studentName = currentUser ? (currentUser.name || currentUser.email.split("@")[0]) : "Student";

    let sessRows = "";
    let totalSessions = 0;
    for (const day of plan.days || []) {
      for (const s of day.sessions || []) {
        totalSessions++;
        const sessionId = `${day.date}-${s.start}-${s.subject}`;
        const isDone = completedSet.has(sessionId);
        sessRows += `
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:8px 10px;text-align:center">${isDone ? "&check;" : "&#9633;"}</td>
            <td style="padding:8px 10px;font-weight:700">${day.weekday}, ${day.date}</td>
            <td style="padding:8px 10px;color:#64748b">${s.start}&ndash;${s.end}</td>
            <td style="padding:8px 10px;font-weight:700">${escapeHtml(s.subject)}</td>
            <td style="padding:8px 10px;text-transform:uppercase;font-size:0.75rem;color:#64748b">${escapeHtml(s.type || 'learn')}</td>
            <td style="padding:8px 10px">${escapeHtml(s.topic || 'Review session')}</td>
          </tr>
        `;
      }
    }

    container.innerHTML = `
      <div style="font-family:'Plus Jakarta Sans',sans-serif;color:#0f172a;line-height:1.4">
        <div style="border-bottom:2px solid #4f46e5;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h1 style="font-size:1.4rem;font-weight:800;color:#4f46e5;margin:0 0 4px">Smart Study AI &bull; Study Timetable</h1>
            <div style="font-size:0.85rem;color:#64748b">Plan: <strong>${escapeHtml(p.title)}</strong> &bull; Total ${totalSessions} Sessions across ${p.total_days || 7} Days</div>
          </div>
          <div style="text-align:right;font-size:0.8rem;color:#64748b">
            <div>Student: <strong>${escapeHtml(studentName)}</strong></div>
            <div>Date: ${dateStr}</div>
            <div style="font-weight:700;color:#10b981">Completed: ${completedSet.size}/${totalSessions}</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-bottom:16px">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;text-align:left">
              <th style="padding:8px 10px;width:30px;text-align:center">Status</th>
              <th style="padding:8px 10px">Date</th>
              <th style="padding:8px 10px">Time</th>
              <th style="padding:8px 10px">Subject</th>
              <th style="padding:8px 10px">Type</th>
              <th style="padding:8px 10px">Topic / Focus</th>
            </tr>
          </thead>
          <tbody>${sessRows}</tbody>
        </table>
        ${plan.summary ? `<div style="background:#eef2ff;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;font-size:0.82rem;margin-bottom:12px"><strong>Summary:</strong> ${escapeHtml(plan.summary)}</div>` : ''}
        <div style="border-top:1px solid #e2e8f0;padding-top:8px;font-size:0.75rem;color:#64748b;display:flex;justify-content:space-between">
          <span>Smart Study AI</span>
          <span>${dateStr}</span>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const cleanTitle = (p.title || "Study_Plan").replace(/[^a-zA-Z0-9_-]/g, "_");
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `${cleanTitle}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    };

    if (typeof html2pdf !== "undefined") {
      await html2pdf().set(opt).from(container).save();
      showToast("✅ PDF downloaded successfully!");
    } else {
      window.print();
    }
    document.body.removeChild(container);
  } catch (err) {
    showToast(`PDF Error: ${err.message}`);
  }
}

window.onAuthLoaded = function(user) {
  loadSavedPlans();
};

