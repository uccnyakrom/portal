/**
 * auth.js — UCC Nyakrom Campus Accommodation Portal
 * PLACE THIS FILE AT: /js/auth.js
 * Features: SHA-256 password hashing, session management, login/logout
 */

import { showToast, generateStudentPassword, callEdgeFunction } from "./supabaseClient.js";

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD HASHING
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: As of the security hardening update, password verification and
// hashing happen SERVER-SIDE inside the user-login and account-manager Edge
// Functions — the browser never reads password fields from the `users` table.
// hashPassword() is kept here ONLY because generateStudentPassword() (used to
// show students their default password hint) is unaffected and still runs
// client-side.
export async function hashPassword(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION
// ─────────────────────────────────────────────────────────────────────────────
export function saveSession(user, type) {
  sessionStorage.setItem("portalUser", JSON.stringify({ ...user, type }));
}

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem("portalUser")) || null;
  } catch { return null; }
}

export function getRole() {
  return getSession()?.role || null;
}

export function clearSession() {
  sessionStorage.removeItem("portalUser");
}

export function requireAuth(type = "admin") {
  const session = getSession();
  if (!session) {
    window.location.href = "index.html";
    return;
  }
  if (type === "admin" && session.role === "student") {
    window.location.href = "student.html";
    return;
  }
  if (type === "student" && session.role !== "student") {
    window.location.href = "admin.html";
    return;
  }
}

export function logout() {
  clearSession();
  window.location.href = "index.html";
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT LOGIN
// ─────────────────────────────────────────────────────────────────────────────
export async function loginStudent(regNumber, password) {
  try {
    const reg = regNumber.trim().toUpperCase();

    const result = await callEdgeFunction("user-login", {
      username: reg,
      password,
      loginType: "student",
    });

    if (!result.success) {
      return { success: false, error: result.error || "Login failed. Please try again." };
    }

    saveSession(result.user, "student");
    return { success: true };

  } catch (err) {
    console.error("loginStudent error:", err);
    return { success: false, error: "Login failed. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN LOGIN
// ─────────────────────────────────────────────────────────────────────────────
export async function loginAdmin(username, password) {
  try {
    const result = await callEdgeFunction("user-login", {
      username: username.trim(),
      password,
      loginType: "admin",
    });

    if (!result.success) {
      return { success: false, error: result.error || "Invalid username or password." };
    }

    // result.user = { id, username, role }; result.token = staff session token
    saveSession({ ...result.user, token: result.token }, "admin");
    return { success: true, admin: result.user };

  } catch (err) {
    console.error("loginAdmin error:", err);
    return { success: false, error: "Login failed. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN MODAL
// ─────────────────────────────────────────────────────────────────────────────
export function initLoginModal() {
  const modal = document.getElementById("loginModal");
  if (!modal) return;

  document.getElementById("loginModalClose")?.addEventListener("click", () => {
    modal.classList.remove("open");
  });

  modal.addEventListener("click", e => {
    if (e.target === modal) modal.classList.remove("open");
  });

  // Tab switching — supports both .login-tab and .tab-btn class names
  const tabs = modal.querySelectorAll(".login-tab, .tab-btn");
  const panels = modal.querySelectorAll(".login-panel, .tab-panel");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      // Deactivate all tabs
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.dataset.tab;

      // Show matching panel, hide others
      panels.forEach(p => {
        const panelName = p.dataset.panel || p.id?.replace("LoginPanel","");
        const isMatch = panelName === target;
        p.classList.toggle("active", isMatch);
        p.classList.toggle("hidden", !isMatch);
        p.style.display = isMatch ? "" : "none";
      });
    });
  });

  // Student login
  document.getElementById("studentLoginForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Signing in…";
    const regNumber = document.getElementById("studentReg").value;
    const password  = document.getElementById("studentPass").value;
    const result = await loginStudent(regNumber, password);
    if (result.success) {
      window.location.href = "student.html";
    } else {
      showToast(result.error, "error");
      btn.disabled = false; btn.textContent = "Sign In";
    }
  });

  // Admin login
  document.getElementById("adminLoginForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Signing in…";
    const username = document.getElementById("adminUser").value;
    const password = document.getElementById("adminPass").value;
    const result = await loginAdmin(username, password);
    if (result.success) {
      // Always redirect to the admin dashboard after successful login
      window.location.href = "admin.html";
    } else {
      showToast(result.error, "error");
      btn.disabled = false; btn.textContent = "Sign In";
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE PASSWORD
// ─────────────────────────────────────────────────────────────────────────────
export function initChangePasswordModal() {
  const role    = getRole();
  const session = getSession();

  if (role === "student") {
    const hint = document.getElementById("currentAutoPassword");
    if (hint && session) {
      hint.textContent = generateStudentPassword(session.reg_number, session.full_name || "");
    }
  }

  window.openChangePasswordModal = () => {
    document.getElementById("changePasswordModal")?.classList.add("open");
  };

  document.getElementById("changePwdModalClose")?.addEventListener("click", () => {
    document.getElementById("changePasswordModal")?.classList.remove("open");
    document.getElementById("changePasswordForm")?.reset();
  });

  document.getElementById("changePasswordForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn        = e.target.querySelector("button[type=submit]");
    const currentPwd = document.getElementById("currentPwd").value.trim();
    const newPwd     = document.getElementById("newPwd").value.trim();
    const confirmPwd = document.getElementById("confirmPwd").value.trim();

    if (newPwd !== confirmPwd) { showToast("New passwords do not match.", "error"); return; }
    if (newPwd.length < 6)    { showToast("Password must be at least 6 characters.", "error"); return; }

    btn.disabled = true; btn.textContent = "Updating…";

    try {
      const username = role === "student" ? session.reg_number : session.username;

      const result = await callEdgeFunction("account-manager", {
        action: "change_password",
        username,
        currentPassword: currentPwd,
        newPassword: newPwd,
      });

      if (!result.success) {
        showToast(result.error || "Current password is incorrect.", "error");
        return;
      }

      showToast("Password updated successfully!", "success");
      document.getElementById("changePasswordModal")?.classList.remove("open");
      document.getElementById("changePasswordForm")?.reset();

    } catch (err) {
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      btn.disabled = false; btn.textContent = "Update Password";
    }
  });
}
