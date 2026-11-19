/* =============================================================================
   Smart Study AI - Admin Panel Controller
   Only accessible to rock19yash2007@gmail.com
   ============================================================================= */

let allUsers = [];

async function loadAdminPanel() {
  const denied = $("adminAccessDenied");
  const content = $("adminContent");

  if (!currentUser || !currentUser.is_admin) {
    denied.style.display = "block";
    content.style.display = "none";
    return;
  }

  denied.style.display = "none";
  content.style.display = "block";

  await loadAdminStats();
  await loadAllUsers();
  await loadMasterSql();
}

async function loadAdminStats() {
  try {
    const res = await fetch("/api/admin/stats", { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok) return;

    if ($("adminStatUsers")) $("adminStatUsers").textContent = data.users_count ?? "-";
    if ($("adminStatPlans")) $("adminStatPlans").textContent = data.plans_count ?? "-";
    if ($("adminStatSessions")) $("adminStatSessions").textContent = data.sessions_count ?? "-";
    if ($("adminStatLogs")) $("adminStatLogs").textContent = data.logs_count ?? "-";
  } catch (_) {}
}

async function loadAllUsers() {
  const tbody = $("adminUsersTableBody");

  try {
    const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
    const data = await res.json();

    if (!res.ok || !data.users) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--danger)">${escapeHtml(data.error || "Failed to load users.")}</td></tr>`;
      return;
    }

    allUsers = data.users;
    renderUsersTable(allUsers);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--danger)">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = $("adminUsersTableBody");
  tbody.innerHTML = "";

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No users found.</td></tr>`;
    return;
  }

  users.forEach((u) => {
    const tr = document.createElement("tr");
    const loginStr = u.last_login ? new Date(u.last_login).toLocaleString() : "-";
    const emailSlug = u.email.replace(/[@.]/g, "_");
    const sqlFile = `user_data/${emailSlug}.sql`;

    const token = localStorage.getItem("sst.auth_token") || "";
    const downloadUrl = token
      ? `/api/admin/user-sql/download?id=${u.id}&token=${encodeURIComponent(token)}`
      : `/api/admin/user-sql/download?id=${u.id}`;

    tr.innerHTML = `
      <td style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-muted)">#${u.id}</td>
      <td style="font-weight:700">${escapeHtml(u.name || "-")}</td>
      <td style="font-size:0.82rem;word-break:break-all">${escapeHtml(u.email)}</td>
      <td>
        ${u.is_admin
          ? `<span class="badge badge-admin">🛡️ Admin</span>`
          : `<span class="badge badge-student">🎓 Student</span>`
        }
      </td>
      <td style="text-align:center">${u.plans_count ?? 0}</td>
      <td style="font-size:0.78rem;color:var(--text-muted)">${loginStr}</td>
      <td style="font-family:var(--font-mono);font-size:0.72rem;color:var(--primary)">${escapeHtml(sqlFile)}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary btn-view-user-sql" data-id="${u.id}" data-email="${escapeHtml(u.email)}" data-name="${escapeHtml(u.name || u.email)}" style="padding:4px 10px;font-size:0.76rem">
            View SQL
          </button>
          <a href="${downloadUrl}" class="btn btn-primary" style="padding:4px 10px;font-size:0.76rem" title="Download SQL file">
            Download SQL
          </a>
          ${!u.is_admin ? `
          <button type="button" class="btn btn-danger btn-delete-user" data-id="${u.id}" data-email="${escapeHtml(u.email)}" style="padding:4px 10px;font-size:0.76rem">
            Delete
          </button>` : ''}
        </div>
      </td>
    `;

    // View SQL button
    tr.querySelector(".btn-view-user-sql").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      viewUserSqlData(Number(btn.dataset.id), btn.dataset.email, btn.dataset.name);
    });

    // Delete user button (only for non-admins)
    const delBtn = tr.querySelector(".btn-delete-user");
    if (delBtn) {
      delBtn.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        deleteUser(Number(btn.dataset.id), btn.dataset.email);
      });
    }

    tbody.appendChild(tr);
  });
}

async function viewUserSqlData(userId, email, name) {
  const card = $("adminUserSqlCard");
  const viewer = $("adminSqlViewer");
  const userLabel = $("adminViewingSqlUser");
  const fileLabel = $("adminViewingSqlFile");

  card.style.display = "block";
  card.scrollIntoView({ behavior: "smooth" });
  viewer.textContent = `Loading SQL data for ${name}...`;

  if (userLabel) userLabel.textContent = `${name} (${email})`;
  const emailSlug = email.replace(/[@.]/g, "_");
  const sqlFile = `user_data/${emailSlug}.sql`;
  if (fileLabel) fileLabel.textContent = sqlFile;

  const downloadBtn = $("btnAdminDownloadUserSql");
  if (downloadBtn) {
    const token = localStorage.getItem("sst.auth_token") || "";
    downloadBtn.href = token
      ? `/api/admin/user-sql/download?id=${userId}&token=${encodeURIComponent(token)}`
      : `/api/admin/user-sql/download?id=${userId}`;
  }

  try {
    const res = await fetch(`/api/admin/user-sql?id=${userId}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok) {
      viewer.textContent = `-- Error: ${data.error || "Failed to load user SQL."}`;
      return;
    }
    viewer.textContent = data.sql || "-- No SQL data found for this user.";
  } catch (err) {
    viewer.textContent = `-- Error: ${err.message}`;
  }
}

async function deleteUser(userId, email) {
  if (!confirm(`Are you sure you want to permanently delete user: ${email}?\n\nThis will also delete ALL their saved plans and progress. This CANNOT be undone.`)) return;

  try {
    const res = await fetch("/api/admin/delete-user", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ id: userId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to delete user.");
    showToast(`User ${email} and all their data have been deleted.`);
    await loadAdminStats();
    await loadAllUsers();
    $("adminUserSqlCard").style.display = "none";
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function loadMasterSql() {
  const viewer = $("adminMasterSqlViewer");
  if (!viewer) return;
  viewer.textContent = "Loading master database...";

  try {
    const res = await fetch("/api/admin/master-sql", { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok) {
      viewer.textContent = `-- Error: ${data.error || "Failed to load master SQL."}`;
      return;
    }
    viewer.textContent = data.sql || "-- Master database is empty.";
  } catch (err) {
    viewer.textContent = `-- Error: ${err.message}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = $("btnRefreshAdmin");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadAllUsers();
      loadAdminStats();
      showToast("Admin panel refreshed.");
    });
  }

  const searchInput = $("adminUserSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q
        ? allUsers.filter((u) => u.email.includes(q) || (u.name || "").toLowerCase().includes(q))
        : allUsers;
      renderUsersTable(filtered);
    });
  }

  const copySqlBtn = $("btnAdminCopySql");
  if (copySqlBtn) {
    copySqlBtn.addEventListener("click", () => {
      const viewer = $("adminSqlViewer");
      navigator.clipboard.writeText(viewer.textContent).then(() => {
        showToast("User SQL copied to clipboard!");
      }).catch(() => {
        showToast("Could not copy.");
      });
    });
  }

  const copyMasterSqlBtn = $("btnAdminCopyMasterSql");
  if (copyMasterSqlBtn) {
    copyMasterSqlBtn.addEventListener("click", () => {
      const viewer = $("adminMasterSqlViewer");
      if (!viewer) return;
      navigator.clipboard.writeText(viewer.textContent).then(() => {
        showToast("Master SQL copied to clipboard!");
      }).catch(() => {
        showToast("Could not copy Master SQL.");
      });
    });
  }

  const downloadMasterBtn = $("btnAdminDownloadMasterSql");
  if (downloadMasterBtn) {
    downloadMasterBtn.addEventListener("click", () => {
      const token = localStorage.getItem("sst.auth_token") || "";
      if (token) {
        downloadMasterBtn.href = `/api/admin/master-sql/download?token=${encodeURIComponent(token)}`;
      }
    });
  }

  const refreshMasterBtn = $("btnRefreshMasterSql");
  if (refreshMasterBtn) {
    refreshMasterBtn.addEventListener("click", () => {
      loadMasterSql();
      showToast("Master SQL refreshed.");
    });
  }
});

window.onAuthLoaded = function(user) {
  loadAdminPanel();
};

