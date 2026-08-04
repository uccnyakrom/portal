/**
 * rooms.js
 * PLACE THIS FILE AT: /js/rooms.js
 */

import { supabase, showToast, logAudit } from "./supabaseClient.js";

// ── Room type colour map ──────────────────────────────────────────────────────
export const ROOM_COLORS = {
  vacant:  { bg: "#22c55e", label: "Vacant"      },
  partial: { bg: "#f59e0b", label: "Partial"     },
  full:    { bg: "#ef4444", label: "Full"         },
  staff:   { bg: "#3b82f6", label: "Full (Staff)" },
  NSP:     { bg: "#a855f7", label: "Full (NSP)"   },
  suite:   { bg: "#6366f1", label: "Suite"        },
};

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchRooms(block = null) {
  let query = supabase.from("rooms").select("*").order("block").order("room_number");
  if (block) query = query.eq("block", block);
  const { data, error } = await query;
  if (error) { console.error("fetchRooms:", error); return []; }
  return data || [];
}

export async function fetchAvailableRooms() {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .not("type", "in", '("full","staff","NSP")')
    .order("block")
    .order("room_number");
  if (error) { console.error("fetchAvailableRooms:", error); return []; }
  return data || [];
}

export async function fetchRoomWithOccupants(roomId) {
  const [roomRes, occupantsRes] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", roomId).single(),
    supabase.from("students").select("id, full_name, reg_number, program, level, sex").eq("room_id", roomId)
  ]);
  return {
    room:      roomRes.data,
    occupants: occupantsRes.data || []
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOM ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

export async function assignRoom(studentId, roomId, actorName = "admin") {
  const { data: room, error: rErr } = await supabase
    .from("rooms").select("*").eq("id", roomId).single();
  if (rErr || !room) return { success: false, error: "Room not found." };

  if (room.occupancy_count >= room.capacity) {
    return { success: false, error: "Room is already at full capacity." };
  }

  const { data: student } = await supabase
    .from("students").select("room_id, full_name, reg_number").eq("id", studentId).single();

  if (student?.room_id) {
    await decrementRoom(student.room_id);
  }

  const { data: updatedStudent, error: sErr } = await supabase
    .from("students")
    .update({ room_id: roomId })
    .eq("id", studentId)
    .select("id")
    .maybeSingle();
  if (sErr) return { success: false, error: sErr.message };
  if (!updatedStudent) {
    // Supabase returned no error but no row came back either — almost always
    // a Row Level Security policy silently blocking the UPDATE (0 rows
    // affected). Fail loudly instead of reporting a false "success".
    return { success: false, error: "Assignment did not save (blocked by database permissions). Check RLS policies on the students table." };
  }

  const newCount = room.occupancy_count + 1;
  const newType  = determineRoomType(room, newCount);
  await supabase.from("rooms")
    .update({ occupancy_count: newCount, type: newType })
    .eq("id", roomId);

  await logAudit(
    `Assigned student ${student?.reg_number} to room ${room.block}-${room.room_number}`,
    actorName
  );
  return { success: true };
}

export async function removeRoomAssignment(studentId, actorName = "admin") {
  const { data: student } = await supabase
    .from("students").select("room_id, reg_number").eq("id", studentId).single();

  if (!student?.room_id) return { success: false, error: "Student has no room assigned." };

  await decrementRoom(student.room_id);

  const { data: updatedStudent, error } = await supabase
    .from("students").update({ room_id: null }).eq("id", studentId)
    .select("id").maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!updatedStudent) {
    return { success: false, error: "Removal did not save (blocked by database permissions). Check RLS policies on the students table." };
  }

  await logAudit(`Removed room from student ${student.reg_number}`, actorName);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE ROOM TYPE (admin only)
// ─────────────────────────────────────────────────────────────────────────────

export async function changeRoomType(roomId, newType, actorName = "admin") {
  const { error } = await supabase
    .from("rooms")
    .update({ type: newType })
    .eq("id", roomId);

  if (error) return { success: false, error: error.message };

  await logAudit(`Changed room ${roomId} type to ${newType}`, actorName);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function decrementRoom(roomId) {
  const { data: room } = await supabase
    .from("rooms").select("*").eq("id", roomId).single();
  if (!room) return;
  const newCount = Math.max(0, room.occupancy_count - 1);
  const newType  = determineRoomType(room, newCount);
  await supabase.from("rooms")
    .update({ occupancy_count: newCount, type: newType })
    .eq("id", roomId);
}

function determineRoomType(room, count) {
  if (["staff", "NSP", "suite"].includes(room.type)) return room.type;
  if (count === 0)            return "vacant";
  if (count >= room.capacity) return "full";
  return "partial";
}

/**
 * Recount actual occupants from the students table and repair the room's
 * occupancy_count + type when the stored counter has drifted out of sync.
 */
export async function syncRoomOccupancy(roomId, actorName = "admin") {
  const [{ count, error: cErr }, { data: room, error: rErr }] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }).eq("room_id", roomId),
    supabase.from("rooms").select("*").eq("id", roomId).single(),
  ]);
  if (cErr)          return { success: false, error: cErr.message };
  if (rErr || !room) return { success: false, error: "Room not found." };

  const realCount = count ?? 0;
  const newType   = determineRoomType(room, realCount);

  const { error: uErr } = await supabase.from("rooms")
    .update({ occupancy_count: realCount, type: newType })
    .eq("id", roomId);
  if (uErr) return { success: false, error: uErr.message };

  await logAudit(`Synced occupancy for room ${room.block}-${room.room_number} (${room.occupancy_count} → ${realCount})`, actorName);
  return { success: true, count: realCount, type: newType };
}

// ─────────────────────────────────────────────────────────────────────────────
// VACATION-STAY ELIGIBILITY RULES
//   Doctor of Pharmacy            → D floor (Third Floor)
//   Medicine & Surgery (MBChB)    → C floor (Second Floor)
//   BSc Nursing                   → B floor (B1–B28) + A floor (A13–A24)
//   Other programmes              → no floor restriction
// Gender: males and females are steered to different blocks (a block's gender
// is inferred from its current occupants; empty blocks are open to anyone).
// If no same-gender rooms remain, the gender rule is relaxed per policy.
// ─────────────────────────────────────────────────────────────────────────────

const FLOOR_RULES = [
  {
    test:   p => /pharm/i.test(p),
    label:  "Doctor of Pharmacy students are housed on the D Floor (Third Floor).",
    floors: [{ letter: "D" }],
  },
  {
    test:   p => /(medicine|surgery|mbchb)/i.test(p),
    label:  "Medicine & Surgery students are housed on the C Floor (Second Floor).",
    floors: [{ letter: "C" }],
  },
  {
    test:   p => /nursing/i.test(p),
    label:  "BSc Nursing students are housed on the B Floor (B1–B28) and A Floor (A13–A24).",
    floors: [{ letter: "B", min: 1, max: 28 }, { letter: "A", min: 13, max: 24 }],
  },
];

export function getFloorRule(program) {
  return FLOOR_RULES.find(r => r.test(String(program || ""))) || null;
}

function parseRoomNumber(rn) {
  const m = String(rn || "").trim().match(/^([A-Za-z])\s*-?\s*(\d+)$/);
  return m ? { letter: m[1].toUpperCase(), num: parseInt(m[2], 10) } : null;
}

export function roomMatchesFloorRule(room, rule) {
  if (!rule) return true;
  const p = parseRoomNumber(room.room_number);
  if (!p) return false; // unparseable numbers (e.g. "Suite A1") never match a floor rule
  return rule.floors.some(f =>
    p.letter === f.letter &&
    (f.min === undefined || p.num >= f.min) &&
    (f.max === undefined || p.num <= f.max));
}

/**
 * Rooms a given student may select, applying programme floor rules and
 * gender-by-block separation. Returns { rooms, rule, genderRelaxed }.
 */
export async function fetchEligibleRooms(student = {}) {
  const [roomsRes, occRes] = await Promise.all([
    supabase.from("rooms").select("*").order("block").order("room_number"),
    supabase.from("students").select("room_id, sex").not("room_id", "is", null),
  ]);

  const allRooms = roomsRes.data || [];
  const rule     = getFloorRule(student.program);

  // Student-bookable + space left + floor rule
  let list = allRooms.filter(r =>
    ["vacant", "partial"].includes(r.type) &&
    r.occupancy_count < r.capacity &&
    roomMatchesFloorRule(r, rule));

  // Gender-by-block: infer each block's gender from current occupants
  const sex = String(student.sex || "").toUpperCase();
  let genderRelaxed = false;

  if (sex === "M" || sex === "F") {
    const blockOf = {};
    allRooms.forEach(r => blockOf[r.id] = r.block);

    const blockSex = {};
    (occRes.data || []).forEach(o => {
      const b = blockOf[o.room_id];
      if (!b) return;
      const s = (blockSex[b] ||= { M: 0, F: 0 });
      s[(o.sex || "").toUpperCase() === "F" ? "F" : "M"]++;
    });

    const blockAllows = b => {
      const s = blockSex[b];
      if (!s || (s.M > 0 && s.F > 0)) return true;  // empty or already mixed
      return sex === "F" ? s.F > 0 : s.M > 0;        // single-gender block
    };

    const sameGender = list.filter(r => blockAllows(r.block));
    if (sameGender.length) {
      list = sameGender;
    } else if (list.length) {
      genderRelaxed = true;  // "unless there are no rooms left"
    }
  }

  return { rooms: list, rule, genderRelaxed };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOM GRID RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function escH(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Floor helpers: friendly labels + physical ordering ───────────────────────
const FLOOR_ORDER = { ground: 0, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

function floorLabel(f) {
  if (f === "" || f === null || f === undefined) return "Unspecified floor";
  return /^\d+$/.test(String(f)) ? `Floor ${f}` : `${f} Floor`;
}

function floorSort(a, b) {
  const ra = FLOOR_ORDER[String(a).toLowerCase()] ?? (/^\d+$/.test(String(a)) ? Number(a) : 99);
  const rb = FLOOR_ORDER[String(b).toLowerCase()] ?? (/^\d+$/.test(String(b)) ? Number(b) : 99);
  return ra - rb || String(a).localeCompare(String(b));
}

/**
 * renderRoomGrid(containerId, rooms, onClickCallback, opts)
 *   opts.occupantsByRoom  { roomId: [{full_name, reg_number, sex, ...}] }
 *   opts.showTypeSelect   render the type-change dropdown on each card (admin)
 *   opts.showFilters      render the filter/search toolbar (admin)
 */
export function renderRoomGrid(containerId, rooms, onClickCallback = null, opts = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const occupantsByRoom = opts.occupantsByRoom || {};
  const showTypeSelect  = !!opts.showTypeSelect;
  const showFilters     = !!opts.showFilters;

  // ── Filter state ──
  const state = { search: "", block: "", floor: "", status: "", gender: "" };

  container.innerHTML = "";

  // ── Summary strip: clickable status chips (double as the legend) ──
  const counts = {};
  Object.keys(ROOM_COLORS).forEach(t => counts[t] = rooms.filter(r => r.type === t).length);

  const summary = document.createElement("div");
  summary.className = "room-summary-strip";
  summary.innerHTML =
    Object.entries(ROOM_COLORS).map(([type, { bg, label }]) => `
      <button class="room-sum-chip" data-status="${type}" title="Click to filter">
        <span class="legend-dot" style="background:${bg}"></span>
        ${label}: <strong>${counts[type]}</strong>
      </button>`).join("") +
    `<div class="room-sum-item room-sum-total">Total: <strong>${rooms.length}</strong></div>`;
  container.appendChild(summary);

  // ── Filter toolbar ──
  let toolbar = null;
  if (showFilters) {
    const blocks = [...new Set(rooms.map(r => r.block))].sort();
    const floors = [...new Set(rooms.map(r => r.floor).filter(f => f !== null && f !== undefined && f !== ""))].sort(floorSort);

    toolbar = document.createElement("div");
    toolbar.className = "table-filter-bar room-filter-bar";
    toolbar.innerHTML = `
      <input id="rmSearch" type="text" placeholder="🔍 Room no. or student name…" style="min-width:200px">
      <select id="rmBlock"><option value="">All Blocks</option>
        ${blocks.map(b => `<option value="${escH(b)}">Block ${escH(b)}</option>`).join("")}
      </select>
      ${floors.length ? `<select id="rmFloor"><option value="">All Floors</option>
        ${floors.map(f => `<option value="${escH(f)}">${escH(floorLabel(f))}</option>`).join("")}
      </select>` : ""}
      <select id="rmStatus"><option value="">All Statuses</option>
        ${Object.entries(ROOM_COLORS).map(([t, { label }]) => `<option value="${t}">${label}</option>`).join("")}
      </select>
      <select id="rmGender"><option value="">Any Occupants</option>
        <option value="M">Male occupants</option>
        <option value="F">Female occupants</option>
        <option value="empty">Empty rooms</option>
      </select>
      <button class="btn-sm btn-secondary" id="rmClear">Clear</button>
      <span class="room-filter-count" id="rmCount"></span>
    `;
    container.appendChild(toolbar);
  }

  // ── Grid host (re-rendered on every filter change) ──
  const gridHost = document.createElement("div");
  container.appendChild(gridHost);

  const occSearchText = {};
  rooms.forEach(r => {
    occSearchText[r.id] = (occupantsByRoom[r.id] || [])
      .map(o => `${o.full_name || ""} ${o.reg_number || ""}`).join(" ").toLowerCase();
  });

  function matches(room) {
    if (state.block  && String(room.block) !== state.block) return false;
    if (state.floor  && String(room.floor ?? "") !== state.floor) return false;
    if (state.status && room.type !== state.status) return false;
    if (state.gender) {
      const occ = occupantsByRoom[room.id] || [];
      if (state.gender === "empty") {
        if (occ.length > 0 || room.occupancy_count > 0) return false;
      } else if (!occ.some(o => (o.sex || "").toUpperCase() === state.gender)) return false;
    }
    if (state.search) {
      const q = state.search.toLowerCase();
      const code = `${room.block}-${room.room_number}`.toLowerCase();
      if (!code.includes(q) &&
          !String(room.room_number).toLowerCase().includes(q) &&
          !occSearchText[room.id].includes(q)) return false;
    }
    return true;
  }

  const hasOccData = "occupantsByRoom" in opts;

  function buildCard(room) {
    const color = ROOM_COLORS[room.type] || ROOM_COLORS.vacant;
    const occ   = occupantsByRoom[room.id] || [];
    const males   = occ.filter(o => (o.sex || "").toUpperCase() === "M").length;
    const females = occ.filter(o => (o.sex || "").toUpperCase() === "F").length;

    // Real occupant list is the source of truth when we have it;
    // the stored counter can drift out of sync.
    const bedCount = hasOccData ? occ.length : (room.occupancy_count || 0);
    const mismatch = hasOccData && occ.length !== (room.occupancy_count || 0);
    const pct      = room.capacity > 0 ? Math.round((bedCount / room.capacity) * 100) : 0;

    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `
      <div class="room-card-header room-banner" style="background:${color.bg}" title="View room details">
        ${escH(room.block)}-${escH(room.room_number)}
      </div>
      <div class="room-card-body">
        <div class="room-stat">🛏 ${bedCount}/${room.capacity}${
          mismatch && showTypeSelect
            ? ` <button class="room-sync-warn" title="Stored count is ${room.occupancy_count} but ${occ.length} student(s) actually assigned. Click to fix.">⚠</button>`
            : ""
        }</div>
        <div class="room-gender-mix">${
          occ.length === 0
            ? `<span class="gm-empty">${hasOccData ? "no occupants" : "&nbsp;"}</span>`
            : `${males ? `<span class="gm-male">♂ ${males}</span>` : ""}${females ? `<span class="gm-female">♀ ${females}</span>` : ""}`
        }</div>
        <div class="room-type-label">${color.label}</div>
        <div class="room-bar-wrap">
          <div class="room-bar" style="width:${pct}%; background:${color.bg}"></div>
        </div>
        ${showTypeSelect ? `
        <div class="room-type-change">
          <select class="room-type-select" title="Change room type">
            <option value="vacant"  ${room.type==="vacant" ?"selected":""}>Vacant</option>
            <option value="partial" ${room.type==="partial"?"selected":""}>Partial</option>
            <option value="full"    ${room.type==="full"   ?"selected":""}>Full</option>
            <option value="staff"   ${room.type==="staff"  ?"selected":""}>Staff</option>
            <option value="NSP"     ${room.type==="NSP"    ?"selected":""}>NSP</option>
            <option value="suite"   ${room.type==="suite"  ?"selected":""}>Suite</option>
          </select>
        </div>` : ""}
      </div>
    `;

    if (onClickCallback) {
      card.classList.add("clickable");
      card.querySelector(".room-card-header").addEventListener("click", () => onClickCallback(room));
    }

    // One-click repair of a drifted occupancy counter
    card.querySelector(".room-sync-warn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const btn = e.target;
      btn.disabled = true; btn.textContent = "…";
      const result = await syncRoomOccupancy(room.id);
      if (result.success) {
        room.occupancy_count = result.count;
        room.type = result.type;
        showToast(`${room.block}-${room.room_number} occupancy fixed (${result.count}/${room.capacity}).`, "success");
        const c = ROOM_COLORS[room.type] || ROOM_COLORS.vacant;
        card.querySelector(".room-card-header").style.background = c.bg;
        card.querySelector(".room-type-label").textContent = c.label;
        card.querySelector(".room-bar").style.background = c.bg;
        const sel = card.querySelector(".room-type-select");
        if (sel) sel.value = room.type;
        btn.remove();
      } else {
        showToast("Sync failed: " + result.error, "error");
        btn.disabled = false; btn.textContent = "⚠";
      }
    });

    card.querySelector(".room-type-select")?.addEventListener("change", async (e) => {
      e.stopPropagation();
      const newType = e.target.value;
      const label   = `${room.block}-${room.room_number}`;
      const result  = await changeRoomType(room.id, newType);
      if (result.success) {
        showToast(`${label} changed to ${ROOM_COLORS[newType]?.label || newType}`, "success");
        room.type = newType;
        const header = card.querySelector(".room-card-header");
        header.style.background = ROOM_COLORS[newType]?.bg || "#9ca3af";
        card.querySelector(".room-type-label").textContent = ROOM_COLORS[newType]?.label || newType;
      } else {
        showToast("Failed to update: " + result.error, "error");
        e.target.value = room.type; // revert
      }
    });

    return card;
  }

  function drawGrid() {
    const visible = rooms.filter(matches);
    gridHost.innerHTML = "";

    const countEl = toolbar?.querySelector("#rmCount");
    if (countEl) countEl.textContent = `Showing ${visible.length} of ${rooms.length} rooms`;

    // Sync chip highlight with active status filter
    summary.querySelectorAll(".room-sum-chip").forEach(chip => {
      chip.classList.toggle("active", chip.dataset.status === state.status);
    });

    if (visible.length === 0) {
      gridHost.innerHTML = `<div class="room-grid-empty">🔍 No rooms match your filters.</div>`;
      return;
    }

    // Group by block, then by floor within block
    const byBlock = {};
    visible.forEach(r => (byBlock[r.block] ||= []).push(r));

    Object.entries(byBlock).forEach(([blockName, blockRooms]) => {
      const section = document.createElement("div");
      section.className = "block-section";
      section.innerHTML = `<h3 class="block-title">Block ${escH(blockName)}</h3>`;

      const floors = [...new Set(blockRooms.map(r => r.floor ?? ""))];
      const groupByFloor = floors.length > 1 || (floors.length === 1 && floors[0] !== "");

      const renderGroup = (groupRooms, floorValue = null) => {
        if (floorValue !== null) {
          const fl = document.createElement("h4");
          fl.className = "floor-title";
          fl.textContent = floorValue === "" ? "Unspecified floor" : floorLabel(floorValue);
          section.appendChild(fl);
        }
        const grid = document.createElement("div");
        grid.className = "room-grid";
        groupRooms.forEach(room => grid.appendChild(buildCard(room)));
        section.appendChild(grid);
      };

      if (groupByFloor) {
        floors.sort(floorSort).forEach(f => renderGroup(blockRooms.filter(r => (r.floor ?? "") === f), f));
      } else {
        renderGroup(blockRooms);
      }

      gridHost.appendChild(section);
    });
  }

  // ── Wire filters ──
  summary.querySelectorAll(".room-sum-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      state.status = state.status === chip.dataset.status ? "" : chip.dataset.status;
      const sel = toolbar?.querySelector("#rmStatus");
      if (sel) sel.value = state.status;
      drawGrid();
    });
  });

  if (toolbar) {
    toolbar.querySelector("#rmSearch").addEventListener("input", e => { state.search = e.target.value.trim(); drawGrid(); });
    toolbar.querySelector("#rmBlock").addEventListener("change", e => { state.block = e.target.value; drawGrid(); });
    toolbar.querySelector("#rmFloor")?.addEventListener("change", e => { state.floor = e.target.value; drawGrid(); });
    toolbar.querySelector("#rmStatus").addEventListener("change", e => { state.status = e.target.value; drawGrid(); });
    toolbar.querySelector("#rmGender").addEventListener("change", e => { state.gender = e.target.value; drawGrid(); });
    toolbar.querySelector("#rmClear").addEventListener("click", () => {
      Object.assign(state, { search: "", block: "", floor: "", status: "", gender: "" });
      toolbar.querySelectorAll("input, select").forEach(el => el.value = "");
      drawGrid();
    });
  }

  drawGrid();
}
