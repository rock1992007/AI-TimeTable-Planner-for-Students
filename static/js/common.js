/* =============================================================================
   Smart Study AI - Common Client JavaScript
   Handles Navigation, Themes, Auth State, and Utilities
   ============================================================================= */

const $ = (id) => document.getElementById(id);
const STORE_THEME = "sst.theme";
const STORE_AUTH_TOKEN = "sst.auth_token";

let currentUser = null;

// HTML Escaping Utility
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Toast Notifications
function showToast(msg) {
  let toast = $("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

// Global File Download Helper
function downloadFile(filename, content, mime) {
  const blob = (content instanceof Blob) ? content : new Blob([content], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Ensure html2pdf library is dynamically loaded with fallback CDN
function ensureHtml2Pdf() {
  if (typeof html2pdf !== "undefined") {
    return Promise.resolve(window.html2pdf);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="html2pdf"]');
    if (existing && !existing.dataset.failed) {
      existing.addEventListener("load", () => {
        if (typeof html2pdf !== "undefined") resolve(window.html2pdf);
        else reject(new Error("html2pdf failed to initialize."));
      });
      existing.addEventListener("error", () => {
        existing.dataset.failed = "true";
        loadFromCdn();
      });
      // Safety timeout in case script was already attached or stalled
      setTimeout(() => {
        if (typeof html2pdf !== "undefined") resolve(window.html2pdf);
        else loadFromCdn();
      }, 1500);
      return;
    }
    loadFromCdn();

    function loadFromCdn() {
      const cdnScript = document.createElement("script");
      cdnScript.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
      cdnScript.onload = () => {
        if (typeof html2pdf !== "undefined") resolve(window.html2pdf);
        else reject(new Error("html2pdf failed to load from CDN."));
      };
      cdnScript.onerror = () => reject(new Error("Unable to load html2pdf script."));
      document.head.appendChild(cdnScript);
    }
  });
}

// Theme Management
function initTheme() {
  const saved = localStorage.getItem(STORE_THEME);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  setTheme(theme);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORE_THEME, theme);
  const sun = $("themeIconSun");
  const moon = $("themeIconMoon");
  if (sun && moon) {
    sun.hidden = theme !== "dark";
    moon.hidden = theme === "dark";
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(current === "dark" ? "light" : "dark");
}

// Auth Headers & State
function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem(STORE_AUTH_TOKEN);
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function checkAuthStatus() {
  try {
    const res = await fetch("/api/auth/me", { headers: getAuthHeaders() });
    const data = await res.json();
    if (res.ok && data && data.user) {
      setLoggedInUser(data.user);
    } else {
      setLoggedOutUser();
    }
  } catch (_) {
    setLoggedOutUser();
  }
}

function setLoggedInUser(user) {
  currentUser = user;
  const authBtns = $("navAuthButtons");
  const userMenu = $("navUserMenu");
  const adminLinks = document.querySelectorAll(".admin-nav-link");

  if (authBtns) authBtns.hidden = true;
  if (userMenu) userMenu.hidden = false;

  const navName = $("navUserName");
  const navAvatar = $("navUserAvatar");
  const dropName = $("dropdownName");
  const dropEmail = $("dropdownEmail");
  const dropRole = $("dropdownRole");

  const displayName = user.name || user.email.split("@")[0];
  if (navName) navName.textContent = displayName;
  if (navAvatar) navAvatar.textContent = displayName.charAt(0).toUpperCase();
  if (dropName) dropName.textContent = displayName;
  if (dropEmail) dropEmail.textContent = user.email;

  if (dropRole) {
    if (user.is_admin) {
      dropRole.innerHTML = `<span class="badge badge-admin">🛡️ Administrator</span>`;
    } else {
      dropRole.innerHTML = `<span class="badge badge-student">🎓 Student</span>`;
    }
  }

  // Surface admin link in navbar if user is admin
  adminLinks.forEach((el) => {
    el.hidden = !user.is_admin;
  });

  const navMyData = $("navMyData");
  const dropdownMyDataLabel = $("dropdownMyDataLabel");
  if (navMyData) {
    navMyData.textContent = user.is_admin ? "My Account & SQL" : "My Account";
  }
  if (dropdownMyDataLabel) {
    dropdownMyDataLabel.textContent = user.is_admin ? "My Account & SQL" : "My Account";
  }

  if (typeof window.onAuthLoaded === "function") {
    window.onAuthLoaded(user);
  }
}

function setLoggedOutUser() {
  currentUser = null;
  const authBtns = $("navAuthButtons");
  const userMenu = $("navUserMenu");
  const adminLinks = document.querySelectorAll(".admin-nav-link");

  if (authBtns) authBtns.hidden = false;
  if (userMenu) userMenu.hidden = true;
  adminLinks.forEach((el) => {
    el.hidden = true;
  });

  const navMyData = $("navMyData");
  const dropdownMyDataLabel = $("dropdownMyDataLabel");
  if (navMyData) navMyData.textContent = "My Account";
  if (dropdownMyDataLabel) dropdownMyDataLabel.textContent = "My Account";

  if (typeof window.onAuthLoaded === "function") {
    window.onAuthLoaded(null);
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", headers: getAuthHeaders() });
  } catch (_) {}
  localStorage.removeItem(STORE_AUTH_TOKEN);
  setLoggedOutUser();
  showToast("Logged out successfully.");
  setTimeout(() => {
    window.location.href = "/";
  }, 500);
}

// User Menu Dropdown Interactions
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  const themeBtn = $("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", toggleTheme);
  }

  const userBtn = $("btnUserDropdown");
  const userDropdown = $("userDropdown");
  if (userBtn && userDropdown) {
    userBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      userDropdown.hidden = !userDropdown.hidden;
    });
    document.addEventListener("click", (e) => {
      if (!userBtn.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.hidden = true;
      }
    });
  }

  const logoutBtn = $("btnLogout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  // Highlight active link
  const currentPath = window.location.pathname;
  document.querySelectorAll(".nav-link").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === currentPath || (href !== "/" && currentPath.startsWith(href))) {
      link.classList.add("active");
    }
  });

  checkAuthStatus();
});

