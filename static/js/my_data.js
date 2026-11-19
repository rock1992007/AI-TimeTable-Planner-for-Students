/* =============================================================================
   Smart Study AI - My Account / User SQL Viewer Controller
   SQL viewing and downloading is strictly restricted to Administrators.
   Normal users have clean account overview and activity history without SQL.
   ============================================================================= */

async function loadMyData() {
  const authNotice = $("myDataAuthNotice");
  const content = $("myDataContent");

  if (!currentUser) {
    if (authNotice) authNotice.style.display = "block";
    if (content) content.style.display = "none";
    return;
  }

  if (authNotice) authNotice.style.display = "none";
  if (content) content.style.display = "block";

  // Set profile info
  if ($("myProfileName")) $("myProfileName").textContent = currentUser.name || "-";
  if ($("myProfileEmail")) $("myProfileEmail").textContent = currentUser.email || "-";
  if ($("myProfileCreated")) {
    $("myProfileCreated").textContent = currentUser.created_at
      ? new Date(currentUser.created_at).toLocaleString()
      : "-";
  }
  if ($("myProfileLogin")) {
    $("myProfileLogin").textContent = currentUser.last_login
      ? new Date(currentUser.last_login).toLocaleString()
      : "-";
  }

  const isAdmin = Boolean(currentUser.is_admin);
  const roleBadge = $("myRoleBadge");
  if (roleBadge) {
    roleBadge.textContent = isAdmin ? "Administrator" : "Student";
    roleBadge.className = isAdmin ? "badge badge-admin" : "badge badge-student";
  }
  if ($("myProfileRole")) {
    $("myProfileRole").innerHTML = isAdmin
      ? `<span class="badge badge-admin">🛡️ Administrator</span>`
      : `<span class="badge badge-student">🎓 Student</span>`;
  }

  // Elements for Admin vs Normal User
  const pageTitle = $("myDataPageTitle");
  const pageSubtitle = $("myDataPageSubtitle");
  const adminSqlActions = $("adminSqlActions");
  const adminSqlViewerSection = $("adminSqlViewerSection");
  const adminSqlFilePathNotice = $("adminSqlFilePathNotice");
  const overviewTitle = $("accountOverviewTitle");
  const overviewDesc = $("accountOverviewDesc");
  const downloadBtn = $("btnDownloadSql");

  if (isAdmin) {
    // Admin user: Enable SQL view and download features
    if (pageTitle) pageTitle.textContent = "My Account & SQL Data";
    if (pageSubtitle) {
      pageSubtitle.textContent =
        "Review your account profile, project access history, and view/download your dedicated standalone SQL data file.";
    }
    if (adminSqlActions) adminSqlActions.style.display = "flex";
    if (adminSqlViewerSection) adminSqlViewerSection.style.display = "block";
    if (adminSqlFilePathNotice) adminSqlFilePathNotice.style.display = "block";
    if (overviewTitle) overviewTitle.textContent = "Separate User Data SQL Storage";
    if (overviewDesc) {
      overviewDesc.textContent =
        "Your data is isolated into your own dedicated SQL file. It contains your profile, access history, and saved study timetables.";
    }

    const emailSlug = (currentUser.email || "user").replace(/[@.]/g, "_");
    const sqlFilename = `user_data/${emailSlug}.sql`;
    if ($("mySqlFilename")) $("mySqlFilename").textContent = sqlFilename;
    if ($("mySqlHeaderFilename")) $("mySqlHeaderFilename").textContent = sqlFilename;

    if (downloadBtn) {
      const token = localStorage.getItem("sst.auth_token") || "";
      downloadBtn.href = token
        ? `/api/user/sql/download?token=${encodeURIComponent(token)}`
        : "/api/user/sql/download";
    }

    // Load full SQL dump and stats
    await loadUserSqlData();
  } else {
    // Normal user: REMOVE/HIDE all SQL view and download features
    if (pageTitle) pageTitle.textContent = "My Account";
    if (pageSubtitle) {
      pageSubtitle.textContent =
        "Review your personal account profile, saved study timetables summary, and project access history.";
    }
    if (adminSqlActions) adminSqlActions.style.display = "none";
    if (adminSqlViewerSection) adminSqlViewerSection.style.display = "none";
    if (adminSqlFilePathNotice) adminSqlFilePathNotice.style.display = "none";
    if (overviewTitle) overviewTitle.textContent = "Account & Activity Overview";
    if (overviewDesc) {
      overviewDesc.textContent =
        "Overview of your saved study timetables and account activity events.";
    }

    // Load only account stats without SQL
    await loadUserStatsOnly();
  }

  // Load activity logs for all users
  await loadMyActivityLogs();
}

async function loadUserStatsOnly() {
  try {
    const res = await fetch("/api/user/stats", { headers: getAuthHeaders() });
    const data = await res.json();
    if (res.ok && data && data.stats) {
      if ($("statMyPlans")) $("statMyPlans").textContent = data.stats.plans_count || 0;
      if ($("statMyLogs")) $("statMyLogs").textContent = data.stats.logs_count || 0;
    }
  } catch (_) {}
}

async function loadUserSqlData() {
  const viewer = $("mySqlViewer");
  if (!viewer) return;
  viewer.textContent = "Loading your dedicated SQL data...";

  try {
    const res = await fetch("/api/user/sql", { headers: getAuthHeaders() });
    const data = await res.json();

    if (!res.ok) {
      viewer.textContent = `-- Error: ${data.error || "Failed to load SQL data"}`;
      return;
    }

    viewer.textContent = data.sql || "-- Your SQL data file is empty.";

    // Update stats
    if (data.stats) {
      if ($("statMyPlans")) $("statMyPlans").textContent = data.stats.plans_count || 0;
      if ($("statMyLogs")) $("statMyLogs").textContent = data.stats.logs_count || 0;
    }
  } catch (err) {
    viewer.textContent = `-- Error loading SQL: ${err.message}`;
  }
}

async function loadMyActivityLogs() {
  const tbody = $("myActivityTableBody");
  if (!tbody) return;

  try {
    const res = await fetch("/api/user/logs", { headers: getAuthHeaders() });
    const data = await res.json();

    if (!res.ok || !data.logs) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No activity logs found.</td></tr>`;
      return;
    }

    const logs = data.logs;
    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No activity logged yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    logs.slice(0, 50).forEach((log) => {
      const tr = document.createElement("tr");
      const tsStr = log.created_at ? new Date(log.created_at).toLocaleString() : "-";

      let actionColor = "var(--primary)";
      if (log.action === "login") actionColor = "var(--success)";
      if (log.action === "logout") actionColor = "var(--text-muted)";
      if (log.action === "generate") actionColor = "#f59e0b";

      tr.innerHTML = `
        <td><span style="color:${actionColor};font-weight:700;text-transform:capitalize">${escapeHtml(log.action)}</span></td>
        <td style="font-size:0.82rem;color:var(--text-secondary)">${escapeHtml(log.detail || "-")}</td>
        <td style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted)">${escapeHtml(log.ip_address || "-")}</td>
        <td style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted)">${tsStr}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--danger)">Error loading logs.</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = $("btnRefreshSql");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (currentUser && currentUser.is_admin) {
        loadUserSqlData();
        showToast("SQL data refreshed.");
      }
    });
  }

  const copyBtn = $("btnCopySql");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const viewer = $("mySqlViewer");
      if (!viewer) return;
      navigator.clipboard.writeText(viewer.textContent).then(() => {
        showToast("SQL copied to clipboard!");
      }).catch(() => {
        showToast("Could not copy SQL to clipboard.");
      });
    });
  }
});

window.onAuthLoaded = function(user) {
  loadMyData();
};
