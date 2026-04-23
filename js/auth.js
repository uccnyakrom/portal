/**

- auth.js — Plain text password version (no hashing)
- PLACE THIS FILE AT: /js/auth.js
  */

import { supabase, showToast, generateStudentPassword, logAudit } from “./supabaseClient.js”;

const SESSION_KEY = “uccPortalSession”;
const ROLE_KEY    = “uccPortalRole”;

export function saveSession(data, role) {
sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
sessionStorage.setItem(ROLE_KEY, role);
}

export function getSession() {
const raw = sessionStorage.getItem(SESSION_KEY);
return raw ? JSON.parse(raw) : null;
}

export function getRole() {
return sessionStorage.getItem(ROLE_KEY) || null;
}

export function logout() {
sessionStorage.removeItem(SESSION_KEY);
sessionStorage.removeItem(ROLE_KEY);
window.location.href = “index.html”;
}

export function requireAuth(expectedRole) {
const session = getSession();
const role    = getRole();
if (!session || (expectedRole && role !== expectedRole)) {
window.location.href = “index.html”;
}
}

export async function loginStudent(regNumber, password) {
try {
const { data: students, error: sErr } = await supabase
.from(“students”)
.select(”*”)
.eq(“reg_number”, regNumber.trim().toUpperCase())
.limit(1);

```
if (sErr) throw sErr;
if (!students || students.length === 0) {
  return { success: false, error: "Registration number not found." };
}

const student = students[0];

const { data: userRows, error: uErr } = await supabase
  .from("users")
  .select("id, role")
  .eq("username", regNumber.trim().toUpperCase())
  .eq("role", "student")
  .limit(1);

if (uErr) throw uErr;
if (!userRows || userRows.length === 0) {
  return { success: false, error: "Your account has not been enrolled yet. Please contact the accommodation office." };
}

const expectedPassword = generateStudentPassword(student.reg_number, student.name);
if (password.trim() !== expectedPassword) {
  return { success: false, error: "Incorrect password. Check your student ID card or contact the office." };
}

saveSession(student, "student");
await logAudit(`Student login: ${student.reg_number}`, student.name);
return { success: true, student };
```

} catch (err) {
console.error(“loginStudent error:”, err);
return { success: false, error: “Login failed. Please try again.” };
}
}

// ADMIN LOGIN — plain text, no hashing
export async function loginAdmin(username, password) {
try {
const { data: admins, error } = await supabase
.from(“users”)
.select(”*”)
.eq(“username”, username.trim())
.eq(“password”, password.trim())
.eq(“role”, “admin”)
.limit(1);

```
if (error) throw error;
if (!admins || admins.length === 0) {
  return { success: false, error: "Invalid username or password." };
}

const admin = admins[0];
saveSession(admin, "admin");
await logAudit(`Admin login: ${admin.username}`, admin.username);
return { success: true, admin };
```

} catch (err) {
console.error(“loginAdmin error:”, err);
return { success: false, error: “Login failed. Please try again.” };
}
}

export function initLoginModal() {
const modal       = document.getElementById(“loginModal”);
const openBtn     = document.getElementById(“signInBtn”);
const closeBtn    = document.getElementById(“modalClose”);
const tabs        = document.querySelectorAll(”.tab-btn”);
const studentForm = document.getElementById(“studentLoginForm”);
const adminForm   = document.getElementById(“adminLoginForm”);

if (!modal) return;

openBtn?.addEventListener(“click”, () => modal.classList.add(“open”));
closeBtn?.addEventListener(“click”, () => modal.classList.remove(“open”));
modal.addEventListener(“click”, e => { if (e.target === modal) modal.classList.remove(“open”); });

tabs.forEach(tab => {
tab.addEventListener(“click”, () => {
tabs.forEach(t => t.classList.remove(“active”));
tab.classList.add(“active”);
const target = tab.dataset.tab;
document.querySelectorAll(”.tab-panel”).forEach(p => {
p.classList.toggle(“active”, p.dataset.panel === target);
});
});
});

studentForm?.addEventListener(“submit”, async e => {
e.preventDefault();
const btn       = studentForm.querySelector(“button[type=submit]”);
const regNumber = document.getElementById(“studentReg”).value;
const password  = document.getElementById(“studentPass”).value;
btn.disabled = true; btn.textContent = “Signing in…”;
const result = await loginStudent(regNumber, password);
if (result.success) {
showToast(`Welcome, ${result.student.name}!`, “success”);
setTimeout(() => { window.location.href = “student.html”; }, 800);
} else {
showToast(result.error, “error”);
btn.disabled = false; btn.textContent = “Sign In”;
}
});

adminForm?.addEventListener(“submit”, async e => {
e.preventDefault();
const btn      = adminForm.querySelector(“button[type=submit]”);
const username = document.getElementById(“adminUser”).value;
const password = document.getElementById(“adminPass”).value;
btn.disabled = true; btn.textContent = “Signing in…”;
const result = await loginAdmin(username, password);
if (result.success) {
showToast(`Welcome, ${result.admin.username}!`, “success”);
setTimeout(() => { window.location.href = “admin.html”; }, 800);
} else {
showToast(result.error, “error”);
btn.disabled = false; btn.textContent = “Sign In”;
}
});
}

// Kept for compatibility with admin.js imports — just returns plain text now
export async function hashPassword(plain) {
return plain;
}
