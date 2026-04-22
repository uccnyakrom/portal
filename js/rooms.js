/**
 * rooms.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACE THIS FILE AT: /js/rooms.js
 *
 * Shared room-related helpers:
 *   • Fetch all rooms (with optional block filter)
 *   • Assign a student to a room
 *   • Remove a student from a room
 *   • Render the colour-coded room grid
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase, showToast, logAudit } from "./supabaseClient.js";

// ── Room type colour map ──────────────────────────────────────────────────────
export const ROOM_COLORS = {
  vacant:  { bg: "#22c55e", label: "Vacant"  },
  partial: { bg: "#f59e0b", label: "Partial" },
  full:    { bg: "#ef4444", label: "Full"    },
  staff:   { bg: "#3b82f6", label: "Staff"   },
  NSP:     { bg: "#a855f7", label: "NSP"     },
  suite:   { bg: "#6366f1", label: "Suite"   },
};

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch all rooms, optionally filtered by block */
export async function fetchRooms(block = null) {
  let query = supabase.from("rooms").select("*").order("block").order("room_number");
  if (block) query = query.eq("block", block);
  const { data, error } = await query;
  if (error) { console.error("fetchRooms:", error); return []; }
  return data || [];
}

/** Fetch available (not full, not staff, not NSP) rooms */
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

/** Get a single room by ID, including its current occupants */
export async function fetchRoomWithOccupants(roomId) {
  const [roomRes, occupantsRes] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", roomId).single(),
    supabase.from("students").select("id, name, reg_number, program, level, sex").eq("room_id", roomId)
  ]);
  return {
    room:      roomRes.data,
    occupants: occupantsRes.data || []
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOM ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * assignRoom(studentId, roomId, actorName)
 * Assigns a student to a room and updates the room's occupancy_count & type.
 */
export async function assignRoom(studentId, roomId, actorName = "admin") {
  // 1. Get the room
  const { data: room, error: rErr } = await supabase
    .from("rooms").select("*").eq("id", roomId).single();
  if (rErr || !room) return { success: false, error: "Room not found." };

  // 2. Check capacity
  if (room.occupancy_count >= room.capacity) {
    return { success: false, error: "Room is already at full capacity." };
  }

  // 3. Get student's current room (if any) to decrement that room's count
  const { data: student } = await supabase
    .from("students").select("room_id, name, reg_number").eq("id", studentId).single();

  if (student?.room_id) {
    await decrementRoom(student.room_id);
  }

  // 4. Update student record
  const { error: sErr } = await supabase
    .from("students")
    .update({ room_id: roomId })
    .eq("id", studentId);
  if (sErr) return { success: false, error: sErr.message };

  // 5. Update room occupancy
  const newCount = room.occupancy_count + 1;
  const newType  = determineRoomType(room, newCount);
  const { error: uErr } = await supabase
    .from("rooms")
    .update({ occupancy_count: newCount, type: newType })
    .eq("id", roomId);
  if (uErr) return { success: false, error: uErr.message };

  // 6. Log it
  await logAudit(
    `Assigned student ${student?.reg_number} to room ${room.block}-${room.room_number}`,
    actorName
  );

  return { success: true };
}

/**
 * removeRoomAssignment(studentId, actorName)
 * Removes a student's room assignment and decrements the old room.
 */
export async function removeRoomAssignment(studentId, actorName = "admin") {
  const { data: student } = await supabase
    .from("students").select("room_id, reg_number").eq("id", studentId).single();

  if (!student?.room_id) return { success: false, error: "Student has no room assigned." };

  await decrementRoom(student.room_id);

  const { error } = await supabase
    .from("students")
    .update({ room_id: null })
    .eq("id", studentId);

  if (error) return { success: false, error: error.message };

  await logAudit(`Removed room from student ${student.reg_number}`, actorName);
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
  // Preserve staff/NSP/suite types
  if (["staff", "NSP", "suite"].includes(room.type)) return room.type;
  if (count === 0)            return "vacant";
  if (count >= room.capacity) return "full";
  return "partial";
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOM GRID RENDERER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * renderRoomGrid(containerId, rooms, onClickCallback)
 * Renders a colour-coded grid of room cards into the given container element.
 * onClickCallback(room) is called when a card is clicked.
 */
export function renderRoomGrid(containerId, rooms, onClickCallback = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Group by block
  const blocks = {};
  rooms.forEach(r => {
    if (!blocks[r.block]) blocks[r.block] = [];
    blocks[r.block].push(r);
  });

  container.innerHTML = "";

  // Legend
  const legend = document.createElement("div");
  legend.className = "room-legend";
  Object.entries(ROOM_COLORS).forEach(([type, { bg, label }]) => {
    legend.innerHTML += `
      <span class="legend-dot" style="background:${bg}"></span>
      <span class="legend-label">${label}</span>
    `;
  });
  container.appendChild(legend);

  // Blocks
  Object.entries(blocks).forEach(([blockName, blockRooms]) => {
    const section = document.createElement("div");
    section.className = "block-section";
    section.innerHTML = `<h3 class="block-title">Block ${blockName}</h3>`;

    const grid = document.createElement("div");
    grid.className = "room-grid";

    blockRooms.forEach(room => {
      const color = ROOM_COLORS[room.type] || ROOM_COLORS.vacant;
      const pct   = room.capacity > 0
        ? Math.round((room.occupancy_count / room.capacity) * 100)
        : 0;

      const card = document.createElement("div");
      card.className = "room-card";
      card.style.setProperty("--room-color", color.bg);
      card.innerHTML = `
        <div class="room-card-header" style="background:${color.bg}">
          ${room.room_number}
        </div>
        <div class="room-card-body">
          <div class="room-stat">${room.occupancy_count}/${room.capacity}</div>
          <div class="room-type-label">${color.label}</div>
          <div class="room-bar-wrap">
            <div class="room-bar" style="width:${pct}%; background:${color.bg}"></div>
          </div>
        </div>
      `;

      if (onClickCallback) {
        card.classList.add("clickable");
        card.addEventListener("click", () => onClickCallback(room));
      }

      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}
