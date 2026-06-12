/**
 * programmes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACE THIS FILE AT: /js/programmes.js
 *
 * Shared helper module for the dynamic Programmes list. Used by:
 *   - admin.html (Add/Edit Student forms, filter dropdown, Programmes management)
 *   - index.html (public application form)
 *   - admin.js / admin_students.js (rendering coloured "pills" for each student)
 *
 * Programmes are stored in the `programmes` table in Supabase and can be
 * added, edited, or deactivated from the admin Programmes section.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase } from "./supabaseClient.js";

// In-memory cache so we don't re-fetch on every render
let _cache = null;

// ── Fetch all active programmes, ordered for display ─────────────────────────
export async function fetchActiveProgrammes(forceRefresh = false) {
  if (_cache && !forceRefresh) return _cache;
  const { data, error } = await supabase
    .from("programmes")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error("fetchActiveProgrammes:", error);
    return [];
  }
  _cache = data || [];
  return _cache;
}

// ── Fetch ALL programmes (including inactive), for the management screen ─────
export async function fetchAllProgrammes() {
  const { data, error } = await supabase
    .from("programmes")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error("fetchAllProgrammes:", error);
    return [];
  }
  return data || [];
}

// Invalidate the cache (call after add/edit/delete in the management screen)
export function clearProgrammeCache() {
  _cache = null;
}

// ── Populate a <select> element with active programmes ───────────────────────
// opts: { includeBlank: bool, blankLabel: string, selectedValue: string }
export async function populateProgramSelect(selectEl, opts = {}) {
  if (!selectEl) return;
  const programmes = await fetchActiveProgrammes();
  const { includeBlank = false, blankLabel = "Select programme", selectedValue = "" } = opts;

  let html = "";
  if (includeBlank) html += `<option value="">${blankLabel}</option>`;

  if (!programmes.length) {
    // Fallback so the form is never empty, even before Supabase setup is run
    html += `<option value="BSc Nursing">BSc Nursing</option>`;
    html += `<option value="BSc Nutrition">BSc Nutrition</option>`;
  } else {
    programmes.forEach(p => {
      html += `<option value="${escAttr(p.name)}">${escAttr(p.name)}</option>`;
    });
  }

  selectEl.innerHTML = html;
  if (selectedValue) selectEl.value = selectedValue;
}

// ── Look up display style (icon, colour, short label) for a programme name ───
// Falls back to a sensible default for unknown / legacy programme names
// (e.g. old "MBChB-COBES" records that no longer have an active entry).
export async function getProgrammeStyle(programName) {
  const programmes = await fetchActiveProgrammes();
  const match = programmes.find(p => p.name === programName);
  if (match) {
    return { icon: match.icon || "🎓", color: match.color || "#6b7280", short_label: match.short_label || match.name };
  }
  // Legacy/unknown programme — neutral grey pill
  return { icon: "🎓", color: "#6b7280", short_label: programName || "Unspecified" };
}

// ── Build the HTML for a coloured "pill" for a given programme name ──────────
// Synchronous version using a pre-fetched programmes list (avoids async calls
// inside render loops). Call fetchActiveProgrammes() once before rendering a
// list, then pass the result here for each row.
export function programmePillHTML(programName, programmesList) {
  const list = programmesList || _cache || [];
  const match = list.find(p => p.name === programName);
  const icon  = match?.icon  || "🎓";
  const color = match?.color || "#6b7280";
  const label = programName || "Unspecified";
  const bg = hexToLightBg(color);
  return `<span class="prog-pill" style="background:${bg};color:${color}">${icon} ${escAttr(label)}</span>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function hexToLightBg(hex) {
  // Convert a hex colour to a very light tint for the pill background
  hex = (hex || "#6b7280").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const r = parseInt(hex.substring(0, 2), 16) || 107;
  const g = parseInt(hex.substring(2, 4), 16) || 114;
  const b = parseInt(hex.substring(4, 6), 16) || 128;
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

function escAttr(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
