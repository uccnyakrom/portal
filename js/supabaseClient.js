/**
 * supabaseClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACE THIS FILE AT: /js/supabaseClient.js
 *
 * This file initialises the Supabase client ONCE and exports it so every other
 * script can import it without creating duplicate connections.
 *
 * ⚠️  CONFIGURATION INSTRUCTIONS:
 *   1. Open this file.
 *   2. Replace the placeholder strings below with your real Supabase values.
 *   3. Your Project URL lives in: Supabase Dashboard → Settings → API
 *   4. Your Anon Key lives in:    Supabase Dashboard → Settings → API
 *
 * 🔒  SECURITY NOTE:
 *   The anon key is safe to expose in a browser (it is public by design).
 *   Protect your data with Supabase Row Level Security (RLS) policies instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── 1. Pull credentials from meta tags injected by the HTML host page ─────────
//      Each HTML page has two <meta> tags at the top:
//        <meta name="sb-url"  content="YOUR_PROJECT_URL">
//        <meta name="sb-key"  content="YOUR_ANON_KEY">
//      This keeps secrets out of JavaScript source files tracked by git.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = document
  .querySelector('meta[name="sb-url"]')
  ?.getAttribute("content") || "";

const SUPABASE_ANON_KEY = document
  .querySelector('meta[name="sb-key"]')
  ?.getAttribute("content") || "";

// ── 2. Validate that we actually have values before trying to connect ─────────
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "❌ Supabase credentials missing!\n" +
    "Add <meta name='sb-url'> and <meta name='sb-key'> to your HTML <head>."
  );
}

// ── 3. Load the Supabase JS library (loaded via CDN in each HTML page) ────────
const { createClient } = window.supabase;

// ── 4. Create and export the single shared client instance ───────────────────
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── 4b. Send an application status email via the Edge Function ───────────────
//   Calls the "send-application-email" Edge Function which sends through Resend.
//   Also logs every attempt to the email_log table for your records.
//   Never throws — email failure must not block enrolment.
export async function sendApplicationEmail({ to, applicantName, status, roomNumber = "", regNumber = "" }) {
  if (!to) {
    console.warn("sendApplicationEmail: no recipient email, skipping.");
    return { success: false, error: "No email address on file." };
  }

  try {
    const url = `${SUPABASE_URL}/functions/v1/send-application-email`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ to, applicantName, status, roomNumber, regNumber }),
    });

    const result = await res.json().catch(() => ({}));

    // Log the attempt (fire-and-forget)
    supabase.from("email_log").insert([{
      recipient:  to,
      subject:    `Application ${status}`,
      body:       roomNumber ? `Room: ${roomNumber}` : status,
      status:     res.ok ? "sent" : "failed",
      related_to: regNumber || null,
    }]).then(() => {}).catch(() => {});

    if (!res.ok) {
      console.error("sendApplicationEmail failed:", result);
      return { success: false, error: result.error || "Email send failed." };
    }
    return { success: true, id: result.id };

  } catch (err) {
    console.error("sendApplicationEmail exception:", err);
    return { success: false, error: err.message };
  }
}

// ── 5. Helper: log an audit event to the audit_logs table ────────────────────
export async function logAudit(action, user = "system") {
  try {
    await supabase.from("audit_logs").insert([{
      action,
      user,
      timestamp: new Date().toISOString()
    }]);
  } catch (err) {
    // Audit logging should never crash the app
    console.warn("Audit log failed:", err.message);
  }
}

// ── 6. Helper: show a toast notification ─────────────────────────────────────
export function showToast(message, type = "info") {
  // type can be "info" | "success" | "error" | "warning"
  const existing = document.querySelector(".toast-container");
  const container = existing || (() => {
    const c = document.createElement("div");
    c.className = "toast-container";
    document.body.appendChild(c);
    return c;
  })();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${
      type === "success" ? "✓" :
      type === "error"   ? "✕" :
      type === "warning" ? "⚠" : "ℹ"
    }</span>
    <span class="toast-msg">${message}</span>
  `;
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add("toast-show"));

  // Auto-remove after 4 s
  setTimeout(() => {
    toast.classList.remove("toast-show");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 4000);
}

// ── 7. Helper: generate a student's auto-password ────────────────────────────
//   Format: first 2 chars of reg_number + last 4 chars of reg_number + initials
//   Example: reg "SN/NSU/25/001", name "Ama Kumi" → "SN001AK"
export function generateStudentPassword(regNumber, fullName) {
  const reg = regNumber.replace(/\//g, ""); // strip slashes
  const prefix = reg.substring(0, 2).toUpperCase();
  const suffix = reg.slice(-4).toUpperCase();
  const initials = fullName
    .trim()
    .split(/\s+/)
    .map(w => w[0].toUpperCase())
    .join("");
  return `${prefix}${suffix}${initials}`;
}
