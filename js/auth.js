/**
 * auth.js — UCC Nyakrom Campus Accommodation Portal
 * PLACE THIS FILE AT: /js/auth.js
 * Features: SHA-256 password hashing, session management, login/logout
 */

import { supabase, showToast, logAudit, generateStudentPassword } from "./supabaseClient.js";

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD HASHING — SHA-256 via Web Crypto API
// ─────────────────────────────────────────────────────────────────────────────
export async function hashPassword(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (stored === "auto") return true;
  // If stored looks like SHA-256 hash (64 hex chars) — use hash comparison
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const hashed = await hashPassword(plain);
    return hashed === stored;
  }
  // Plain text comparison (legacy passwords)
  return plain.trim() === stored.trim();
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

    // Get student record
    const { data: student, error: sErr } = await supabase
      .from("students")
      .select("id, full_name, reg_number, program, level, sex, room, room_id")
      .eq("reg_number", reg)
      .single();

    if (sErr || !student) {
      return { success: false, error: "Student not found. Please contact the General Office." };
    }

    // Get user record
    const { data: userRows, error: uErr } = await supabase
      .from("users")
      .select("id, role, password, password_hash")
      .eq("username", reg)
      .limit(1);

    if (uErr || !userRows?.length) {
      return { success: false, error: "Your account has not been enrolled yet. Please contact the General Office." };
    }

    const user = userRows[0];
    if (user.role !== "student") {
      return { success: false, error: "Please use the Admin tab to log in." };
    }

    // Generate expected auto password
    const autoPwd = generateStudentPassword(student.reg_number, student.full_name || "");

    // Verify password
    let valid = false;
    if (user.password_hash) {
      // Has hashed password — verify against hash
      valid = await verifyPassword(password, user.password_hash);
      // Also allow auto password if no custom password set
      if (!valid && user.password === "auto") {
        valid = password.trim() === autoPwd;
      }
    } else if (user.password === "auto") {
      valid = password.trim() === autoPwd;
    } else {
      valid = await verifyPassword(password, user.password);
    }

    if (!valid) {
      return { success: false, error: `Incorrect password. Your default password is your reg number initials. Contact the General Office if you need help.` };
    }

    saveSession({ ...student, ...user, username: reg }, "student");
    logAudit(`Student login: ${reg}`, reg); // fire-and-forget
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
    const { data: users, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username.trim())
      .not("role", "eq", "student")
      .limit(1);

    if (error) throw error;
    if (!users?.length) return { success: false, error: "Invalid username or password." };

    const user = users[0];

    // Verify password (hashed or plain)
    let valid = false;
    if (user.password_hash) {
      valid = await verifyPassword(password, user.password_hash);
    } else {
      valid = await verifyPassword(password, user.password);
    }

    if (!valid) return { success: false, error: "Invalid username or password." };

    saveSession(user, "admin");
    logAudit(`Admin login: ${user.username} (${user.role})`, user.username); // fire-and-forget
    return { success: true, admin: user };

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
      // If we're on the landing page (index.html), stay and unlock admin features
      // rather than redirecting away to admin.html
      const path = window.location.pathname;
      const onLandingPage = path.endsWith("index.html") ||
                            path.endsWith("/portal/") ||
                            path.endsWith("/portal") ||
                            path === "/";
      if (onLandingPage) {
        modal.classList.remove("open");
        showToast(`Welcome, ${result.admin?.username || "Admin"}! Admin features unlocked.`, "success");
        window.dispatchEvent(new Event("ucc:adminLoggedIn"));
      } else {
        window.location.href = "admin.html";
      }
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

      const { data: userRows } = await supabase
        .from("users").select("id, password, password_hash").eq("username", username).limit(1);

      if (!userRows?.length) { showToast("Could not verify account.", "error"); return; }

      const user = userRows[0];
      const autoPwd = role === "student"
        ? generateStudentPassword(session.reg_number, session.full_name || "")
        : null;

      // Verify current password
      let valid = false;
      if (user.password_hash) {
        valid = await verifyPassword(currentPwd, user.password_hash);
      }
      if (!valid && user.password) {
        valid = await verifyPassword(currentPwd, user.password);
      }
      if (!valid && autoPwd) {
        valid = currentPwd === autoPwd || user.password === "auto";
      }

      if (!valid) { showToast("Current password is incorrect.", "error"); return; }

      // Hash new password and save
      const newHash = await hashPassword(newPwd);
      const { error } = await supabase
        .from("users")
        .update({ password_hash: newHash, password: newPwd })
        .eq("username", username);

      if (error) { showToast("Error: " + error.message, "error"); return; }

      await logAudit(`Password changed for: ${username}`, username);
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
