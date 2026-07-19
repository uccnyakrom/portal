/**
 * emergency-modal.js — UCC Nyakrom Smart Campus Portal
 * PLACE THIS FILE AT: /js/emergency-modal.js
 *
 * Injects a fixed 🆘 SOS button on any page that imports this module and
 * shows an emergency-contacts modal. Works logged-out (national + campus
 * numbers); adds the student's personal ICE contact when a student is
 * logged in.
 *
 * Usage (in <head>):   <link rel="stylesheet" href="css/emergency.css">
 * Usage (end of body): <script type="module" src="js/emergency-modal.js"></script>
 */

import { supabase } from "./supabaseClient.js";
import { getSession } from "./auth.js";

// ── In-memory cache ──────────────────────────────────────────────────────────
let _contacts = null;   // emergency_contacts rows (active only)
let _iceCache = null;   // student's ICE row (fetched once per page load)
let _iceFetched = false;

// Hard fallback so the modal is never empty even if the fetch fails
const FALLBACK_CONTACTS = [
  { label: "National Emergency Line",   phone: "112",          category: "national", location_note: null, display_order: 3 },
  { label: "Ghana Fire Service",        phone: "192",          category: "national", location_note: null, display_order: 4 },
  { label: "Agona Nsaba Fire Service",  phone: "050-632-5205", category: "national", location_note: "Nearest fire station", display_order: 5 },
  { label: "Agona Swedru Fire Service", phone: "020-538-8670", category: "national", location_note: null, display_order: 6 },
  { label: "Police",                    phone: "191",          category: "national", location_note: null, display_order: 7 },
  { label: "Ambulance Service",         phone: "193",          category: "national", location_note: null, display_order: 8 },
];

// Strip everything except digits and leading + for tel: hrefs
function telHref(phone) {
  return "tel:" + String(phone ?? "").replace(/(?!^\+)[^\d]/g, "");
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Data ─────────────────────────────────────────────────────────────────────
async function fetchContacts() {
  try {
    const { data, error } = await supabase
      .from("emergency_contacts")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    _contacts = (data && data.length) ? data : FALLBACK_CONTACTS;
  } catch (err) {
    console.error("emergency-modal: could not load contacts:", err);
    _contacts = FALLBACK_CONTACTS;
  }
}

async function fetchIce(studentId) {
  if (_iceFetched) return _iceCache;
  _iceFetched = true;
  try {
    const { data, error } = await supabase
      .from("ice_contacts")
      .select("contact_name, relationship, phone, alt_phone")
      .eq("student_id", studentId)
      .maybeSingle();
    if (error) throw error;
    _iceCache = data || null;
  } catch (err) {
    console.error("emergency-modal: could not load ICE contact:", err);
    _iceCache = undefined; // undefined = load error (vs null = none set)
  }
  return _iceCache;
}

// ── Rendering ────────────────────────────────────────────────────────────────
function contactIcon(c) {
  const l = (c.label || "").toLowerCase();
  if (l.includes("fire"))                       return "🚒";
  if (l.includes("police"))                     return "🚓";
  if (l.includes("infirmary") || l.includes("clinic") || l.includes("ambulance")) return "🏥";
  if (l.includes("security"))                   return "🛡️";
  return "📞";
}

function callButtonsHTML(contacts) {
  // Hide contacts without a real dialable number (e.g. "[REPLACE]" placeholders)
  contacts = contacts.filter(c => /\d/.test(String(c.phone)));

  // Campus contacts first, then national — each group by display_order
  const sorted = [...contacts].sort((a, b) =>
    (a.category === b.category)
      ? (a.display_order ?? 99) - (b.display_order ?? 99)
      : (a.category === "campus" ? -1 : 1));

  return sorted.map(c => `
    <a class="em-call-btn" href="${telHref(c.phone)}">
      <span class="em-call-left">
        <span class="em-call-icon">${contactIcon(c)}</span>
        <span>
          <span class="em-call-label">${esc(c.label)}</span>
          ${c.location_note ? `<span class="em-call-note">${esc(c.location_note)}</span>` : ""}
        </span>
      </span>
      <span class="em-call-phone">${esc(c.phone)}</span>
    </a>`).join("");
}

function iceSectionHTML(ice) {
  if (ice === undefined) {
    return `<p class="em-ice-empty">Could not load your ICE contact. Please try again.</p>`;
  }
  if (!ice) {
    return `<p class="em-ice-empty">You have not set an ICE contact yet. Please set one in your profile.</p>`;
  }
  return `
    <div class="em-ice-card">
      <div class="em-ice-name">${esc(ice.contact_name)}</div>
      <div class="em-ice-rel">${esc(ice.relationship)}</div>
      <a class="em-ice-phone" href="${telHref(ice.phone)}">📞 ${esc(ice.phone)}</a>
      ${ice.alt_phone ? `<a class="em-ice-phone" href="${telHref(ice.alt_phone)}">📞 ${esc(ice.alt_phone)} (alt)</a>` : ""}
    </div>`;
}

function buildModal() {
  const overlay = document.createElement("div");
  overlay.id = "emergencyModal";
  overlay.className = "em-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Emergency contacts");
  overlay.innerHTML = `
    <div class="em-card">
      <button class="em-close" id="emClose" aria-label="Close">×</button>
      <h2 class="em-title">🆘 Emergency</h2>
      <div class="em-section-head">Call Now</div>
      <div id="emCallList"></div>
      <div id="emIceWrap" style="display:none">
        <div class="em-section-head">My ICE Contact</div>
        <div id="emIceBody"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#emClose").addEventListener("click", closeEmergencyModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeEmergencyModal(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeEmergencyModal();
  });
  return overlay;
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function openEmergencyModal() {
  const overlay = document.getElementById("emergencyModal") || buildModal();

  // Instant open using cached data (fallbacks if the initial fetch failed)
  document.getElementById("emCallList").innerHTML =
    callButtonsHTML(_contacts || FALLBACK_CONTACTS);
  overlay.classList.add("open");

  // ICE section — students only, lazily fetched then cached
  const session = getSession();
  const iceWrap = document.getElementById("emIceWrap");
  if (session?.role === "student" && session?.id) {
    iceWrap.style.display = "";
    document.getElementById("emIceBody").innerHTML =
      `<p class="em-ice-empty">Loading…</p>`;
    const ice = await fetchIce(session.id);
    document.getElementById("emIceBody").innerHTML = iceSectionHTML(ice);
  } else {
    iceWrap.style.display = "none";
  }
}

export function closeEmergencyModal() {
  document.getElementById("emergencyModal")?.classList.remove("open");
}

// Allow non-module scripts (e.g. inline onclick) to trigger it too
window.openEmergencyModal = openEmergencyModal;

// ── Boot: SOS button + contact prefetch ──────────────────────────────────────
function injectSosButton() {
  if (document.getElementById("sosBtn")) return;
  const btn = document.createElement("button");
  btn.id = "sosBtn";
  btn.className = "sos-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Emergency — call for help");
  btn.textContent = "🆘 SOS";
  btn.addEventListener("click", openEmergencyModal);
  document.body.appendChild(btn);
}

function boot() {
  injectSosButton();
  fetchContacts(); // prefetch + cache so the modal opens instantly
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
