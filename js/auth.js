/**
 * auth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACE THIS FILE AT: /js/auth.js
 *
 * Handles:
 *   • Student login  (reg_number + auto-generated password)
 *   • Admin login    (username + password from users table)
 *   • Session storage & retrieval
 *   • Logout
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase, showToast, generateStudentPassword, logAudit } from "./supabaseClient.js";

// ── Session keys used in sessionStorage ──────────────────────────────────────
const SESSION_KEY  = "uccPortalSession";
const ROLE_KEY     = "uccPortalRole";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/** Save a session object after successful login */
export function saveSession(data, role) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  sessionStorage.setItem(ROLE_KEY, role);
}

/** Retrieve the current session (or null) */
export function getSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** Retrieve the current role ("admin" | "student" | null) */
export function getRole() {
  return sessionStorage.getItem(ROLE_KEY) || null;
}

/** Clear the session and redirect to index */
export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(ROLE_KEY);
  window.location.href = "index.html";
}

/** Guard: redirect to index if no session, or wrong role */
export function requireAuth(expectedRole) {
  const session = getSession();
  const role    = getRole();
  if (!session || (expectedRole && role !== expectedRole)) {
    window.location.href = "index.html";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT LOGIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * loginStudent(regNumber, password)
 * Looks up the student by reg_number, checks if they are enrolled (has a
 * corresponding users row with role='student'), then verifies the password
 * matches the auto-generated format.
 *
 * Returns { success: true, student } or { success: false, error }
 */
export async function loginStudent(regNumber, password) {
  try {
    // 1. Find the student record
    const { data: students, error: sErr } = await supabase
      .from("students")
      .select("*")
      .eq("reg_number", regNumber.trim().toUpperCase())
      .limit(1);

    if (sErr) throw sErr;
    if (!students || students.length === 0) {
      return { success: false, error: "Registration number not found." };
    }

    const student = students[0];

    // 2. Check the student is enrolled (has a users row)
    const { data: userRows, error: uErr } = await supabase
      .from("users")
      .select("id, role")
      .eq("username", regNumber.trim().toUpperCase())
      .eq("role", "student")
      .limit(1);

    if (uErr) throw uErr;
    if (!userRows || userRows.length === 0) {
      return {
        success: false,
        error: "Your account has not been enrolled yet. Please contact the accommodation office."
      };
    }

    // 3. Validate the auto-generated password
    const expectedPassword = generateStudentPassword(student.reg_number, student.name);
    if (password.trim() !== expectedPassword) {
      return { success: false, error: "Incorrect password. Check your student ID card or contact the office." };
    }

    // 4. All good — save session
    saveSession(student, "student");
    await logAudit(`Student login: ${student.reg_number}`, student.name);

    return { success: true, student };

  } catch (err) {
    console.error("loginStudent error:", err);
    return { success: false, error: "Login failed. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN LOGIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * loginAdmin(username, password)
 * Checks the users table for a matching admin account.
 * Passwords are stored hashed (SHA-256 hex) in the database.
 *
 * Returns { success: true, admin } or { success: false, error }
 */
export async function loginAdmin(username, password) {
  try {
    // Hash the incoming password with SHA-256
    const hashed = await hashPassword(password);

    const { data: admins, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username.trim())
      .eq("password", hashed)
      .eq("role", "admin")
      .limit(1);

    if (error) throw error;
    if (!admins || admins.length === 0) {
      return { success: false, error: "Invalid username or password." };
    }

    const admin = admins[0];
    saveSession(admin, "admin");
    await logAudit(`Admin login: ${admin.username}`, admin.username);

    return { success: true, admin };

  } catch (err) {
    console.error("loginAdmin error:", err);
    return { success: false, error: "Login failed. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** SHA-256 hash a string, return hex digest */
export async function hashPassword(plain) {
  const encoder = new TextEncoder();
  const data    = encoder.encode(plain);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN MODAL CONTROLLER  (used by index.html)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call initLoginModal() from index.html after the DOM is ready.
 * It wires up the modal's form, tab switching, and submit handler.
 */
export function initLoginModal() {
  const modal      = document.getElementById("loginModal");
  const openBtn    = document.getElementById("signInBtn");
  const closeBtn   = document.getElementById("modalClose");
  const tabs       = document.querySelectorAll(".tab-btn");
  const studentForm = document.getElementById("studentLoginForm");
  const adminForm   = document.getElementById("adminLoginForm");

  if (!modal) return; // Not on landing page

  // Open / close
  openBtn?.addEventListener("click", () => modal.classList.add("open"));
  closeBtn?.addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", e => {
    if (e.target === modal) modal.classList.remove("open");
  });

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(p => {
        p.classList.toggle("active", p.dataset.panel === target);
      });
    });
  });

  // Student form submit
  studentForm?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = studentForm.querySelector("button[type=submit]");
    const regNumber = document.getElementById("studentReg").value;
    const password  = document.getElementById("studentPass").value;

    btn.disabled = true;
    btn.textContent = "Signing in…";

    const result = await loginStudent(regNumber, password);
    if (result.success) {
      showToast(`Welcome, ${result.student.name}!`, "success");
      setTimeout(() => { window.location.href = "student.html"; }, 800);
    } else {
      showToast(result.error, "error");
      btn.disabled = false;
      btn.textContent = "Sign In";
    }
  });

  // Admin form submit
  adminForm?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = adminForm.querySelector("button[type=submit]");
    const username = document.getElementById("adminUser").value;
    const password = document.getElementById("adminPass").value;

    btn.disabled = true;
    btn.textContent = "Signing in…";

    const result = await loginAdmin(username, password);
    if (result.success) {
      showToast(`Welcome, ${result.admin.username}!`, "success");
      setTimeout(() => { window.location.href = "admin.html"; }, 800);
    } else {
      showToast(result.error, "error");
      btn.disabled = false;
      btn.textContent = "Sign In";
    }
  });
}
