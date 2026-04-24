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

  const { error: sErr } = await supabase
    .from("students")
    .update({ room_id: roomId })
    .eq("id", studentId);
  if (sErr) return { success: false, error: sErr.message };

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

  const { error } = await supabase
    .from("students").update({ room_id: null }).eq("id", studentId);

  if (error) return { success: false, error: error.message };

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

// ─────────────────────────────────────────────────────────────────────────────
// ROOM GRID RENDERER
// ─────────────────────────────────────────────────────────────────────────────

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

  // Summary counts
  const total   = rooms.length;
  const vacant  = rooms.filter(r => r.type === "vacant").length;
  const partial = rooms.filter(r => r.type === "partial").length;
  const full    = rooms.filter(r => r.type === "full").length;
  const staff   = rooms.filter(r => r.type === "staff").length;
  const nsp     = rooms.filter(r => r.type === "NSP").length;
  const suite   = rooms.filter(r => r.type === "suite").length;

  // Summary strip
  const summary = document.createElement("div");
  summary.className = "room-summary-strip";
  summary.innerHTML = `
    <div class="room-sum-item"><span style="color:#22c55e">●</span> Vacant: <strong>${vacant}</strong></div>
    <div class="room-sum-item"><span style="color:#f59e0b">●</span> Partial: <strong>${partial}</strong></div>
    <div class="room-sum-item"><span style="color:#ef4444">●</span> Full: <strong>${full}</strong></div>
    <div class="room-sum-item"><span style="color:#3b82f6">●</span> Staff: <strong>${staff}</strong></div>
    <div class="room-sum-item"><span style="color:#a855f7">●</span> NSP: <strong>${nsp}</strong></div>
    <div class="room-sum-item"><span style="color:#6366f1">●</span> Suite: <strong>${suite}</strong></div>
    <div class="room-sum-item">Total: <strong>${total}</strong></div>
  `;
  container.appendChild(summary);

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
          <div class="room-type-change">
            <select class="room-type-select" data-room-id="${room.id}" data-block="${room.block}" data-num="${room.room_number}" title="Change room type">
              <option value="vacant"  ${room.type==="vacant" ?"selected":""}>Student (Vacant)</option>
              <option value="partial" ${room.type==="partial"?"selected":""}>Student (Partial)</option>
              <option value="full"    ${room.type==="full"   ?"selected":""}>Student (Full)</option>
              <option value="staff"   ${room.type==="staff"  ?"selected":""}>Staff</option>
              <option value="NSP"     ${room.type==="NSP"    ?"selected":""}>NSP</option>
              <option value="suite"   ${room.type==="suite"  ?"selected":""}>Suite</option>
            </select>
          </div>
        </div>
      `;

      if (onClickCallback) {
        card.classList.add("clickable");
        card.querySelector(".room-card-header").addEventListener("click", () => onClickCallback(room));
      }

      // Wire type change dropdown
      card.querySelector(".room-type-select").addEventListener("change", async (e) => {
        e.stopPropagation();
        const newType  = e.target.value;
        const roomId   = e.target.dataset.roomId;
        const label    = `${e.target.dataset.block}-${e.target.dataset.num}`;
        const result   = await changeRoomType(roomId, newType);
        if (result.success) {
          showToast(`${label} changed to ${ROOM_COLORS[newType]?.label || newType}`, "success");
          // Update card header color immediately
          const header = card.querySelector(".room-card-header");
          const typeLabel = card.querySelector(".room-type-label");
          header.style.background = ROOM_COLORS[newType]?.bg || "#9ca3af";
          typeLabel.textContent   = ROOM_COLORS[newType]?.label || newType;
        } else {
          showToast("Failed to update: " + result.error, "error");
          e.target.value = room.type; // revert
        }
      });

      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}
