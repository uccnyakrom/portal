/**
 * facilities.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACE THIS FILE AT: /js/facilities.js
 *
 * Handles all facilities-related features:
 *   • View facilities list (all roles)
 *   • Book/assign suites, staff rooms, NSP rooms (admin + staff)
 *   • Approve/reject bookings (admin only)
 *   • Report maintenance issues (all roles)
 *   • Manage maintenance requests (admin + staff)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase, showToast, logAudit } from "./supabaseClient.js";
import { getSession, getRole } from "./auth.js";

const SESSION = getSession();
const ROLE    = getRole(); // 'admin' | 'staff' | 'student'

// ─────────────────────────────────────────────────────────────────────────────
// FACILITIES LIST
// ─────────────────────────────────────────────────────────────────────────────

export async function loadFacilitiesList(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { data: facilities, error } = await supabase
    .from("facilities")
    .select("*")
    .order("block")
    .order("category");

  if (error) { showToast("Error loading facilities", "error"); return; }

  // Group by block
  const blocks = {};
  (facilities || []).forEach(f => {
    if (!blocks[f.block]) blocks[f.block] = [];
    blocks[f.block].push(f);
  });

  const statusColors = {
    available:   { bg: "#22c55e", label: "Available" },
    occupied:    { bg: "#ef4444", label: "Occupied"  },
    maintenance: { bg: "#f59e0b", label: "Maintenance"},
    closed:      { bg: "#9ca3af", label: "Closed"    },
  };

  // Category icons
  const icons = {
    "Laboratory":    "🔬",
    "Seminar Room":  "🎓",
    "Library":       "📚",
    "Auditorium":    "🎭",
    "Computer Lab":  "💻",
    "Office":        "🏢",
    "Store Room":    "📦",
    "Common Area":   "🏛️",
    "Other":         "📌",
  };

  // Summary counts
  const total     = facilities?.length || 0;
  const available = facilities?.filter(f => f.status === "available").length || 0;
  const inMaint   = facilities?.filter(f => f.status === "maintenance").length || 0;

  container.innerHTML = `
    <div class="fac-summary">
      <div class="fac-sum-card"><span class="fac-sum-num">${total}</span><span class="fac-sum-lbl">Total Facilities</span></div>
      <div class="fac-sum-card"><span class="fac-sum-num" style="color:var(--green)">${available}</span><span class="fac-sum-lbl">Available</span></div>
      <div class="fac-sum-card"><span class="fac-sum-num" style="color:var(--yellow)">${inMaint}</span><span class="fac-sum-lbl">In Maintenance</span></div>
    </div>

    <div class="fac-filter-bar">
      <input type="text" id="facSearch" placeholder="Search facilities…" style="max-width:220px">
      <select id="facFilterBlock">
        <option value="">All Blocks</option>
        ${Object.keys(blocks).map(b => `<option value="${b}">Block ${b}</option>`).join("")}
      </select>
      <select id="facFilterCategory">
        <option value="">All Categories</option>
        ${[...new Set((facilities||[]).map(f=>f.category))].map(c=>`<option>${c}</option>`).join("")}
      </select>
      <select id="facFilterStatus">
        <option value="">All Status</option>
        <option value="available">Available</option>
        <option value="occupied">Occupied</option>
        <option value="maintenance">Maintenance</option>
        <option value="closed">Closed</option>
      </select>
    </div>

    <div id="facGrid" class="fac-grid">
      ${(facilities||[]).map(f => `
        <div class="fac-card" data-block="${f.block}" data-category="${f.category}" data-status="${f.status}">
          <div class="fac-card-top">
            <span class="fac-icon">${icons[f.category] || "📌"}</span>
            <span class="fac-status-dot" style="background:${statusColors[f.status]?.bg || '#9ca3af'}" title="${statusColors[f.status]?.label}"></span>
          </div>
          <div class="fac-card-name">${f.room_number}</div>
          <div class="fac-card-cat">${f.category}</div>
          <div class="fac-card-block">Block ${f.block}</div>
          <div class="fac-card-status" style="color:${statusColors[f.status]?.bg}">${statusColors[f.status]?.label || f.status}</div>
          <div class="fac-card-actions">
            ${ROLE !== "student" ? `
              <button class="btn-sm btn-secondary" onclick="openMaintenanceModal('${f.id}','${f.room_number}','${f.block}','facility')">🔧 Report</button>
              <button class="btn-sm btn-primary" onclick="openFacStatusModal('${f.id}','${f.room_number}','${f.status}')">✏️ Status</button>
            ` : `
              <button class="btn-sm btn-secondary" onclick="openMaintenanceModal('${f.id}','${f.room_number}','${f.block}','facility')">🔧 Report Issue</button>
            `}
          </div>
        </div>`).join("")}
    </div>`;

  // Wire filters
  ["facSearch","facFilterBlock","facFilterCategory","facFilterStatus"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", filterFacilities);
  });
}

function filterFacilities() {
  const search   = (document.getElementById("facSearch")?.value || "").toLowerCase();
  const block    = document.getElementById("facFilterBlock")?.value || "";
  const category = document.getElementById("facFilterCategory")?.value || "";
  const status   = document.getElementById("facFilterStatus")?.value || "";

  document.querySelectorAll(".fac-card").forEach(card => {
    const matchBlock    = !block    || card.dataset.block    === block;
    const matchCategory = !category || card.dataset.category === category;
    const matchStatus   = !status   || card.dataset.status   === status;
    const matchSearch   = !search   || card.textContent.toLowerCase().includes(search);
    card.style.display  = (matchBlock && matchCategory && matchStatus && matchSearch) ? "" : "none";
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FACILITY STATUS UPDATE (admin + staff)
// ─────────────────────────────────────────────────────────────────────────────

window.openFacStatusModal = (id, name, currentStatus) => {
  const modal = document.getElementById("facStatusModal");
  if (!modal) return;
  document.getElementById("facStatusId").value       = id;
  document.getElementById("facStatusName").textContent = name;
  document.getElementById("facStatusSelect").value   = currentStatus;
  modal.classList.add("open");
};

export function initFacStatusModal() {
  document.getElementById("facStatusForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id     = document.getElementById("facStatusId").value;
    const status = document.getElementById("facStatusSelect").value;

    const { error } = await supabase.from("facilities").update({ status }).eq("id", id);
    if (error) { showToast("Update failed: " + error.message, "error"); return; }

    await logAudit(`Facility status updated to ${status}`, SESSION?.username || "admin");
    showToast("Facility status updated.", "success");
    document.getElementById("facStatusModal").classList.remove("open");
    loadFacilitiesList("facilitiesContainer");
  });

  document.getElementById("facStatusModalClose")?.addEventListener("click", () => {
    document.getElementById("facStatusModal").classList.remove("open");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — Suites, Staff Rooms, NSP Rooms
// ─────────────────────────────────────────────────────────────────────────────

export async function loadBookings(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { data, error } = await supabase
    .from("facility_bookings")
    .select("*, rooms(block, room_number, type), facilities(block, room_number, category)")
    .order("created_at", { ascending: false });

  if (error) { showToast("Error loading bookings", "error"); return; }

  const bookings = data || [];

  container.innerHTML = `
    <div class="table-card">
      <div class="table-card-header">
        <span class="table-card-title">Room & Facility Bookings</span>
        ${ROLE !== "student" ? `<button class="btn btn-primary" onclick="openNewBookingModal()">+ New Booking</button>` : ""}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Location</th><th>Type</th><th>Assignee</th><th>Department</th>
              <th>Purpose</th><th>Start</th><th>End</th><th>Status</th>
              ${ROLE === "admin" ? "<th>Actions</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${bookings.length === 0
              ? `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--gray-400)">No bookings yet</td></tr>`
              : bookings.map(b => {
                  const loc = b.rooms
                    ? `Block ${b.rooms.block} – ${b.rooms.room_number}`
                    : b.facilities
                    ? `Block ${b.facilities.block} – ${b.facilities.room_number}`
                    : "—";
                  return `<tr>
                    <td>${loc}</td>
                    <td><span class="badge badge-${b.booking_type}">${b.booking_type}</span></td>
                    <td>${b.assignee_name}</td>
                    <td>${b.department || "—"}</td>
                    <td>${b.purpose || "—"}</td>
                    <td>${b.start_date || "—"}</td>
                    <td>${b.end_date || "—"}</td>
                    <td><span class="badge badge-${b.status}">${b.status}</span></td>
                    ${ROLE === "admin" ? `
                    <td>
                      ${b.status === "pending" ? `
                        <button class="btn-sm btn-success" onclick="updateBooking('${b.id}','approved')">✓</button>
                        <button class="btn-sm btn-danger"  onclick="updateBooking('${b.id}','rejected')">✕</button>
                      ` : b.status === "approved" ? `
                        <button class="btn-sm btn-secondary" onclick="updateBooking('${b.id}','ended')">End</button>
                      ` : "—"}
                    </td>` : ""}
                  </tr>`;
                }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

window.updateBooking = async (id, status) => {
  const { error } = await supabase
    .from("facility_bookings")
    .update({ status, approved_by: SESSION?.username || "admin" })
    .eq("id", id);
  if (error) { showToast("Update failed.", "error"); return; }
  await logAudit(`Booking ${id} ${status}`, SESSION?.username || "admin");
  showToast(`Booking ${status}.`, "success");
  loadBookings("bookingsContainer");
};

window.openNewBookingModal = async () => {
  // Load rooms that can be booked (suite, staff, NSP)
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, block, room_number, type")
    .in("type", ["suite","staff","NSP"])
    .order("block").order("room_number");

  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, block, room_number, category")
    .eq("status", "available")
    .order("block").order("room_number");

  const roomOpts = (rooms||[]).map(r =>
    `<option value="room:${r.id}">Block ${r.block} – ${r.room_number} (${r.type})</option>`
  ).join("");
  const facOpts = (facilities||[]).map(f =>
    `<option value="fac:${f.id}">Block ${f.block} – ${f.room_number} (${f.category})</option>`
  ).join("");

  document.getElementById("bookingLocationSelect").innerHTML =
    `<option value="">— Select Location —</option>` + roomOpts + facOpts;

  document.getElementById("newBookingModal").classList.add("open");
};

export function initBookingModal() {
  document.getElementById("newBookingForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const locVal     = document.getElementById("bookingLocationSelect").value;
    const assignee   = document.getElementById("bookingAssignee").value;
    const department = document.getElementById("bookingDept").value;
    const purpose    = document.getElementById("bookingPurpose").value;
    const startDate  = document.getElementById("bookingStart").value;
    const endDate    = document.getElementById("bookingEnd").value;

    if (!locVal) { showToast("Please select a location.", "warning"); return; }

    const [locType, locId] = locVal.split(":");
    const isRoom = locType === "room";

    // Determine booking_type
    let bookingType = "facility";
    if (isRoom) {
      const { data: room } = await supabase.from("rooms").select("type").eq("id", locId).single();
      bookingType = room?.type === "NSP" ? "NSP" : room?.type === "staff" ? "staff_room" : "suite";
    }

    const payload = {
      facility_id:   isRoom ? null : locId,
      room_id:       isRoom ? locId : null,
      booking_type:  bookingType,
      assignee_name: assignee,
      department:    department,
      purpose:       purpose,
      start_date:    startDate,
      end_date:      endDate || null,
      status:        ROLE === "admin" ? "approved" : "pending",
      requested_by:  SESSION?.username || "unknown",
    };

    const { error } = await supabase.from("facility_bookings").insert([payload]);
    if (error) { showToast("Error: " + error.message, "error"); return; }

    await logAudit(`New booking: ${assignee} → ${locVal}`, SESSION?.username || "admin");
    showToast(
      ROLE === "admin" ? "Booking approved!" : "Booking request submitted for approval.",
      "success"
    );
    document.getElementById("newBookingModal").classList.remove("open");
    e.target.reset();
    loadBookings("bookingsContainer");
  });

  document.getElementById("newBookingModalClose")?.addEventListener("click", () => {
    document.getElementById("newBookingModal").classList.remove("open");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

export async function loadMaintenance(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) { showToast("Error loading maintenance requests", "error"); return; }

  const priorityColors = { urgent:"#ef4444", high:"#f59e0b", normal:"#3b82f6", low:"#22c55e" };
  const statusColors   = { open:"#ef4444", in_progress:"#f59e0b", resolved:"#22c55e", closed:"#9ca3af" };

  container.innerHTML = `
    <div class="table-card">
      <div class="table-card-header">
        <span class="table-card-title">Maintenance Requests</span>
        <button class="btn btn-primary" onclick="openMaintenanceModal(null,null,null,'manual')">+ Report Issue</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Location</th><th>Category</th><th>Description</th>
              <th>Priority</th><th>Status</th><th>Reported By</th><th>Date</th>
              ${ROLE === "admin" ? "<th>Actions</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${(data||[]).length === 0
              ? `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--gray-400)">No maintenance requests</td></tr>`
              : (data||[]).map(r => `
                <tr>
                  <td>Block ${r.block} – ${r.room_number}</td>
                  <td>${r.category}</td>
                  <td>${r.description}</td>
                  <td><span class="badge" style="background:${priorityColors[r.priority]}20;color:${priorityColors[r.priority]}">${r.priority}</span></td>
                  <td><span class="badge" style="background:${statusColors[r.status]}20;color:${statusColors[r.status]}">${r.status.replace("_"," ")}</span></td>
                  <td>${r.reported_by}</td>
                  <td>${new Date(r.created_at).toLocaleDateString()}</td>
                  ${ROLE === "admin" ? `
                  <td>
                    <select class="maint-status-select" data-id="${r.id}" style="width:auto;font-size:12px;padding:.2rem .4rem">
                      <option value="open"        ${r.status==="open"        ?"selected":""}>Open</option>
                      <option value="in_progress" ${r.status==="in_progress" ?"selected":""}>In Progress</option>
                      <option value="resolved"    ${r.status==="resolved"    ?"selected":""}>Resolved</option>
                      <option value="closed"      ${r.status==="closed"      ?"selected":""}>Closed</option>
                    </select>
                  </td>` : ""}
                </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  // Wire status dropdowns
  document.querySelectorAll(".maint-status-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      const { error } = await supabase
        .from("maintenance_requests")
        .update({ status: sel.value, updated_at: new Date().toISOString() })
        .eq("id", sel.dataset.id);
      if (error) showToast("Update failed.", "error");
      else {
        showToast("Status updated.", "success");
        await logAudit(`Maintenance ${sel.dataset.id} → ${sel.value}`, SESSION?.username || "admin");
      }
    });
  });
}

// Maintenance report modal (shared across admin, staff, student)
window.openMaintenanceModal = (facId, roomNum, block, source) => {
  const modal = document.getElementById("maintenanceModal");
  if (!modal) return;
  document.getElementById("maintFacId").value    = facId   || "";
  document.getElementById("maintRoomNum").value  = roomNum || "";
  document.getElementById("maintBlock").value    = block   || "";
  if (roomNum) document.getElementById("maintLocationDisplay").textContent = `Block ${block} – ${roomNum}`;
  else document.getElementById("maintLocationDisplay").textContent = "";
  modal.classList.add("open");
};

export function initMaintenanceModal() {
  document.getElementById("maintenanceForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const block      = document.getElementById("maintBlock").value     || document.getElementById("maintBlockInput")?.value;
    const roomNum    = document.getElementById("maintRoomNum").value   || document.getElementById("maintRoomInput")?.value;
    const category   = document.getElementById("maintCategory").value;
    const description= document.getElementById("maintDescription").value;
    const priority   = document.getElementById("maintPriority").value;

    if (!block || !roomNum) { showToast("Please specify the location.", "warning"); return; }

    const payload = {
      block,
      room_number:   roomNum,
      location:      `Block ${block} – ${roomNum}`,
      category,
      description,
      priority,
      status:        "open",
      reported_by:   SESSION?.name || SESSION?.username || "unknown",
      reporter_role: ROLE || "student",
    };

    const { error } = await supabase.from("maintenance_requests").insert([payload]);
    if (error) { showToast("Error: " + error.message, "error"); return; }

    showToast("Maintenance request submitted!", "success");
    document.getElementById("maintenanceModal").classList.remove("open");
    e.target.reset();

    // Refresh if on maintenance tab
    if (document.getElementById("maintenanceContainer")) {
      loadMaintenance("maintenanceContainer");
    }
  });

  document.getElementById("maintenanceModalClose")?.addEventListener("click", () => {
    document.getElementById("maintenanceModal").classList.remove("open");
  });
}
