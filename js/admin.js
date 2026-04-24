/**
 * admin.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACE THIS FILE AT: /js/admin.js
 *
 * Drives the entire Admin Dashboard (admin.html).
 * Sections: Overview · Students · Room Map · Allocations ·
 *           Applications · Reports · User Management · Export · Audit Log · Notices
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase, showToast, logAudit } from "./supabaseClient.js";
import {
  loadStudents, initAddStudentModal, initEditStudentModal,
  initAssignRoomModal, bulkEnrolAll
} from "./admin_students.js";

// Export bulkEnrolAll to window for HTML onclick
window.bulkEnrolAll = bulkEnrolAll;


import { requireAuth, getSession, logout, hashPassword, initChangePasswordModal } from "./auth.js";
import {
  fetchRooms, fetchAvailableRooms, fetchRoomWithOccupants,
  assignRoom, removeRoomAssignment, renderRoomGrid
} from "./rooms.js";

// ── Guard: only admins may enter ──────────────────────────────────────────────
requireAuth("admin");
const ADMIN = getSession();

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("adminName").textContent = ADMIN.username || "Admin";
  document.getElementById("logoutBtn").addEventListener("click", logout);
  initAddStudentModal();
  initEditStudentModal();
  initAssignRoomModal();
  initChangePasswordModal();

  // Sidebar navigation
  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const section = link.dataset.section;
      navigateTo(section);
    });
  });

  // Load default section
  navigateTo("overview");

  // Real-time subscriptions
  setupRealtimeSubscriptions();
});

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

function navigateTo(section) {
  // Update sidebar highlight
  document.querySelectorAll(".nav-link").forEach(l => {
    l.classList.toggle("active", l.dataset.section === section);
  });

  // Show/hide sections
  document.querySelectorAll(".dash-section").forEach(s => {
    s.classList.toggle("hidden", s.id !== `section-${section}`);
  });

  // Load section content
  const loaders = {
    overview:    loadOverview,
    students:    () => loadStudents(),
    rooms:       loadRoomMap,
    allocations: loadAllocations,
    applications:loadApplications,
    reports:     loadReports,
    users:       loadUserManagement,
    export:      loadExport,
    audit:       loadAuditLog,
    notices:     loadNotices,
  };

  if (loaders[section]) loaders[section]();
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL-TIME SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────────────────

function setupRealtimeSubscriptions() {
  // Listen for room changes → refresh current view if on room-related sections
  supabase
    .channel("rooms-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, () => {
      showToast("Room data updated in real time.", "info");
    })
    .subscribe();

  supabase
    .channel("applications-changes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "applications" }, payload => {
      showToast("New accommodation application received!", "warning");
    })
    .subscribe();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

async function loadOverview() {
  // Fetch all data in parallel
  const [roomsRes, appsRes, studentsRes, housedRes, totalRes] = await Promise.all([
    supabase.from("rooms").select("*"),
    supabase.from("applications").select("id, status"),
    supabase.from("students").select("id, program, level, sex"),
    // Count students WITH room_id (housed)
    supabase.from("students").select("id", { count: "exact", head: true }).not("room_id", "is", null),
    // Count ALL students
    supabase.from("students").select("id", { count: "exact", head: true })
  ]);

  const rooms    = roomsRes.data    || [];
  const apps     = appsRes.data     || [];
  const students = studentsRes.data || [];

  const totalStudents = totalRes.count  || 0;
  const housed        = housedRes.count || 0;
  const unhoused      = totalStudents - housed;

  const totalBeds    = rooms.reduce((a, r) => a + r.capacity, 0);
  const occupiedBeds = rooms.reduce((a, r) => a + r.occupancy_count, 0);
  const availableBeds = totalBeds - occupiedBeds;
  const vacantRooms  = rooms.filter(r => r.type === "vacant").length;
  const partialRooms = rooms.filter(r => r.type === "partial").length;
  const pendingApps  = apps.filter(a => a.status === "pending").length;
  const occRate      = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  // Stat cards
  setCard("statTotal",     totalStudents);
  setCard("statResidents", housed);
  setCard("statHoused",    housed);
  setCard("statUnhoused",  unhoused);
  setCard("statBeds",      availableBeds);
  setCard("statVacant",    vacantRooms + partialRooms);
  setCard("statPending",   pendingApps);
  setCard("statOccRate",   occRate + "%");

  // Charts
  drawBlockChart(rooms);
  drawProgramChart(students);
  drawSexChart(students);
}

function setCard(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function drawBlockChart(rooms) {
  const canvas = document.getElementById("blockChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const blocks = ["NE","N","NW","ADM","S"];
  const occ    = blocks.map(b => rooms.filter(r=>r.block===b).reduce((a,r)=>a+r.occupancy_count,0));
  const cap    = blocks.map(b => rooms.filter(r=>r.block===b).reduce((a,r)=>a+r.capacity,0));

  drawBarChart(ctx, canvas, blocks, [
    { label: "Occupied", data: occ, color: "#1e3a5f" },
    { label: "Capacity", data: cap, color: "#c9a84c" }
  ], "Occupancy by Block");
}

function drawProgramChart(students) {
  const canvas = document.getElementById("programChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const nursing   = students.filter(s => (s.program||"").toLowerCase().includes("nurs")).length;
  const nutrition = students.filter(s => (s.program||"").toLowerCase().includes("nutr")).length;
  drawPieChart(ctx, canvas, [`Nursing (${nursing})`,`Nutrition (${nutrition})`], [nursing, nutrition], ["#1e3a5f","#c9a84c"]);
}

function drawSexChart(students) {
  const canvas = document.getElementById("sexChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const male   = students.filter(s => ["M","Male","male"].includes(s.sex)).length;
  const female = students.filter(s => ["F","Female","female"].includes(s.sex)).length;
  drawPieChart(ctx, canvas, [`Male (${male})`,`Female (${female})`], [male, female], ["#3b82f6","#ec4899"]);
}

// ── Lightweight canvas bar chart (no library dependency) ─────────────────────
function drawBarChart(ctx, canvas, labels, datasets, title) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const pad   = { top: 40, right: 20, bottom: 50, left: 50 };
  const cW    = W - pad.left - pad.right;
  const cH    = H - pad.top  - pad.bottom;
  const maxVal = Math.max(...datasets.flatMap(d => d.data), 1);
  const barW   = (cW / labels.length) / (datasets.length + 1);

  // Title
  ctx.font = "bold 13px Georgia, serif";
  ctx.fillStyle = "#1e3a5f";
  ctx.textAlign = "center";
  ctx.fillText(title, W/2, 22);

  // Grid lines
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + cH - (i/4) * cH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#9ca3af"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
    ctx.fillText(Math.round((i/4)*maxVal), pad.left - 4, y + 3);
  }

  // Bars
  labels.forEach((label, i) => {
    const groupX = pad.left + i * (cW / labels.length) + barW / 2;
    datasets.forEach((ds, j) => {
      const barH = (ds.data[i] / maxVal) * cH;
      const x = groupX + j * (barW + 2);
      const y = pad.top + cH - barH;
      ctx.fillStyle = ds.color;
      ctx.fillRect(x, y, barW, barH);
    });
    // Label
    ctx.fillStyle = "#374151"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(label, groupX + ((datasets.length - 1) * (barW + 2)) / 2, H - pad.bottom + 15);
  });

  // Legend
  datasets.forEach((ds, i) => {
    ctx.fillStyle = ds.color;
    ctx.fillRect(pad.left + i * 90, H - 16, 12, 10);
    ctx.fillStyle = "#374151"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(ds.label, pad.left + i * 90 + 16, H - 7);
  });
}

function drawPieChart(ctx, canvas, labels, data, colors) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W/2, cy = H/2 - 15, r = Math.min(W, H)/2 - 40;
  const total = data.reduce((a,v)=>a+v, 0) || 1;
  let start = -Math.PI/2;
  data.forEach((val, i) => {
    const angle = (val/total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    // Label on slice
    const mid = start + angle / 2;
    const lx  = cx + (r * 0.6) * Math.cos(mid);
    const ly  = cy + (r * 0.6) * Math.sin(mid);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(Math.round((val/total)*100)+"%", lx, ly);
    start += angle;
  });
  // Legend
  labels.forEach((l, i) => {
    ctx.fillStyle = colors[i];
    ctx.fillRect(10 + i * 100, H - 18, 12, 10);
    ctx.fillStyle = "#374151"; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(`${l} (${data[i]})`, 26 + i * 100, H - 9);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: ALL STUDENTS
// ─────────────────────────────────────────────────────────────────────────────

// Expose to HTML onclick
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("assignForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const studentId = document.getElementById("assignStudentId").value;
    const roomId    = document.getElementById("assignRoomSelect").value;
    if (!roomId) { showToast("Select a room.", "warning"); return; }

    const result = await assignRoom(studentId, roomId, ADMIN.username);
    if (result.success) {
      showToast("Room assigned!", "success");
      document.getElementById("assignModal").classList.remove("open");
      loadStudents();
    } else showToast(result.error, "error");
  });

  document.getElementById("assignModalClose")?.addEventListener("click", () => {
    document.getElementById("assignModal").classList.remove("open");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: ROOM MAP
// ─────────────────────────────────────────────────────────────────────────────

async function loadRoomMap() {
  const rooms = await fetchRooms();
  renderRoomGrid("roomMapGrid", rooms, async (room) => {
    const { room: r, occupants } = await fetchRoomWithOccupants(room.id);
    const info = document.getElementById("roomInfoPanel");
    if (!info) return;
    info.innerHTML = `
      <h3>Block ${r.block} – Room ${r.room_number}</h3>
      <p><strong>Capacity:</strong> ${r.capacity} &nbsp; <strong>Occupied:</strong> ${r.occupancy_count}</p>
      <p><strong>Status:</strong> <span class="badge badge-${r.type}">${r.type}</span></p>
      <h4>Occupants</h4>
      ${occupants.length === 0
        ? "<p style='color:#9ca3af'>No occupants</p>"
        : `<ul>${occupants.map(o=>`<li>${o.full_name} (${o.reg_number}) – ${o.program}</li>`).join("")}</ul>`}
    `;
    info.classList.add("open");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: ALLOCATIONS
// ─────────────────────────────────────────────────────────────────────────────

async function loadAllocations() {
  const { data: students } = await supabase
    .from("students")
    .select("id, full_name, reg_number, program, level, room, rooms(block, room_number)")
    .not("room", "is", null)
    .order("name");

  const tbody = document.getElementById("allocTableBody");
  if (!tbody) return;

  tbody.innerHTML = (students || []).map(s => `
    <tr>
      <td>${s.full_name}</td>
      <td>${s.reg_number}</td>
      <td>${s.program}</td>
      <td>${s.level}</td>
      <td>${s.rooms?.block}-${s.rooms?.room_number}</td>
      <td>
        <button class="btn-sm btn-warning" onclick="openAssignModal('${s.id}','${escHtml(s.full_name)}')">Change</button>
        <button class="btn-sm btn-danger"  onclick="removeRoom('${s.id}')">Remove</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center">No allocations found</td></tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: APPLICATIONS
// ─────────────────────────────────────────────────────────────────────────────

async function loadApplications() {
  const { data, error } = await supabase
    .from("applications")
    .select("*, students(name, reg_number, program)")
    .order("created_at", { ascending: false });

  const tbody = document.getElementById("appTableBody");
  if (!tbody) return;

  tbody.innerHTML = (data || []).map(a => `
    <tr>
      <td>${a.students?.full_name || "—"}</td>
      <td>${a.students?.reg_number || "—"}</td>
      <td>${a.students?.program || "—"}</td>
      <td>${new Date(a.created_at).toLocaleDateString()}</td>
      <td><span class="badge badge-${a.status}">${a.status}</span></td>
      <td>
        ${a.status === "pending" ? `
          <button class="btn-sm btn-success" onclick="updateApp('${a.id}','approved')">Approve</button>
          <button class="btn-sm btn-danger"  onclick="updateApp('${a.id}','rejected')">Reject</button>
        ` : "—"}
      </td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center">No applications</td></tr>`;
}

window.updateApp = async (appId, status) => {
  const { error } = await supabase.from("applications").update({ status }).eq("id", appId);
  if (error) { showToast("Update failed.", "error"); return; }
  await logAudit(`Application ${appId} ${status}`, ADMIN.username);
  showToast(`Application ${status}.`, "success");
  loadApplications();
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: REPORTS
// ─────────────────────────────────────────────────────────────────────────────

async function loadReports() {
  const [studRes, roomRes] = await Promise.all([
    supabase.from("students").select("program, level, sex, room"),
    supabase.from("rooms").select("*")
  ]);

  const students = studRes.data || [];
  const rooms    = roomRes.data || [];

  // Utilisation table
  const tableBody = document.getElementById("utilTableBody");
  if (tableBody) {
    const blocks = ["NE","N","NW","ADM","S"];
    tableBody.innerHTML = blocks.map(b => {
      const bRooms = rooms.filter(r=>r.block===b);
      const cap    = bRooms.reduce((a,r)=>a+r.capacity,0);
      const occ    = bRooms.reduce((a,r)=>a+r.occupancy_count,0);
      const pct    = cap > 0 ? Math.round((occ/cap)*100) : 0;
      return `<tr>
        <td>Block ${b}</td>
        <td>${bRooms.length}</td>
        <td>${cap}</td>
        <td>${occ}</td>
        <td>${cap - occ}</td>
        <td>
          <div class="util-bar-wrap">
            <div class="util-bar" style="width:${pct}%"></div>
          </div>
          ${pct}%
        </td>
      </tr>`;
    }).join("");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

async function loadUserManagement() {
  const { data: users } = await supabase.from("users").select("id, username, role").order("role");
  const tbody = document.getElementById("usersTableBody");
  if (tbody) {
    tbody.innerHTML = (users || []).map(u => `
      <tr>
        <td>${u.username}</td>
        <td><span class="badge badge-${u.role}">${u.role}</span></td>
        <td>
          ${u.id !== ADMIN.id ? `<button class="btn-sm btn-danger" onclick="deleteUser('${u.id}','${escHtml(u.username)}')">Delete</button>` : "—"}
        </td>
      </tr>`).join("");
  }
}

window.deleteUser = async (userId, username) => {
  if (!confirm(`Delete user "${username}"?`)) return;
  await supabase.from("users").delete().eq("id", userId);
  await logAudit(`Deleted user: ${username}`, ADMIN.username);
  showToast("User deleted.", "success");
  loadUserManagement();
};

document.addEventListener("DOMContentLoaded", () => {
  // Create admin user
  document.getElementById("createAdminForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const username = document.getElementById("newAdminUser").value;
    const password = document.getElementById("newAdminPass").value;
    const hashed   = await hashPassword(password);

    const { error } = await supabase.from("users").insert([{ username, password: hashed, role: "admin" }]);
    if (error) { showToast("Error: " + error.message, "error"); return; }
    await logAudit(`Created admin user: ${username}`, ADMIN.username);
    showToast("Admin user created.", "success");
    e.target.reset();
    loadUserManagement();
  });

  // Enrol student
  document.getElementById("enrolStudentForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const regNumber = document.getElementById("enrolReg").value.trim().toUpperCase();

    // Check student exists
    const { data: students } = await supabase.from("students").select("id, name").eq("reg_number", regNumber).limit(1);
    if (!students?.length) { showToast("Student not found.", "error"); return; }

    // Check not already enrolled
    const { data: existing } = await supabase.from("users").select("id").eq("username", regNumber).limit(1);
    if (existing?.length) { showToast("Student already enrolled.", "warning"); return; }

    // Create student user (password managed via auto-generate, no hash stored)
    const { error } = await supabase.from("users").insert([{ username: regNumber, password: "auto", role: "student" }]);
    if (error) { showToast("Error: " + error.message, "error"); return; }
    await logAudit(`Enrolled student: ${regNumber}`, ADMIN.username);
    showToast(`Student ${regNumber} enrolled successfully.`, "success");
    e.target.reset();
    loadUserManagement();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: EXPORT
// ─────────────────────────────────────────────────────────────────────────────

async function loadExport() {
  // Just render static UI — buttons are wired via HTML onclick
}

window.exportData = async (type, format) => {
  const confirmPass = prompt("Enter your admin password to confirm export:");
  if (!confirmPass) return;
  const hashed = await hashPassword(confirmPass);

  const { data: check } = await supabase.from("users")
    .select("id").eq("username", ADMIN.username).eq("password", hashed).limit(1);
  if (!check?.length) { showToast("Invalid password.", "error"); return; }

  let data, filename;
  if (type === "students") {
    const res = await supabase.from("students").select("*");
    data = res.data; filename = "students";
  } else if (type === "rooms") {
    const res = await supabase.from("rooms").select("*");
    data = res.data; filename = "rooms";
  } else if (type === "applications") {
    const res = await supabase.from("applications").select("*");
    data = res.data; filename = "applications";
  } else if (type === "audit") {
    const res = await supabase.from("audit_logs").select("*");
    data = res.data; filename = "audit_logs";
  }

  if (!data) { showToast("No data to export.", "warning"); return; }

  if (format === "csv")  downloadCSV(data, filename);
  if (format === "json") downloadJSON(data, filename);

  await logAudit(`Exported ${type} as ${format}`, ADMIN.username);
  showToast(`Exported ${type} as ${format.toUpperCase()}.`, "success");
};

function downloadCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(",");
  const rows    = data.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(","));
  const csv     = [headers, ...rows].join("\n");
  downloadFile(csv, `${filename}.csv`, "text/csv");
}

function downloadJSON(data, filename) {
  downloadFile(JSON.stringify(data, null, 2), `${filename}.json`, "application/json");
}

function downloadFile(content, filename, mimeType) {
  const a = document.createElement("a");
  a.href  = URL.createObjectURL(new Blob([content], { type: mimeType }));
  a.download = filename;
  a.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────

async function loadAuditLog() {
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(200);

  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;
  tbody.innerHTML = (data || []).map(log => `
    <tr>
      <td>${new Date(log.timestamp).toLocaleString()}</td>
      <td>${log.user}</td>
      <td>${log.action}</td>
    </tr>`).join("") || `<tr><td colspan="3" style="text-align:center">No logs</td></tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: NOTICES
// ─────────────────────────────────────────────────────────────────────────────

async function loadNotices() {
  const { data: notices } = await supabase
    .from("notices")
    .select("*")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  const list = document.getElementById("noticeAdminList");
  if (!list) return;

  const now = new Date();
  list.innerHTML = (notices || []).map(n => {
    const expired = n.expiry_date && new Date(n.expiry_date) < now;
    return `
    <div class="notice-card priority-${n.priority} ${expired ? 'notice-expired' : ''}">
      <div class="notice-header">
        <span class="notice-title">${n.pinned ? "📌 " : ""}${n.title}</span>
        <span class="notice-priority">${n.priority.toUpperCase()}</span>
      </div>
      <p class="notice-msg">${n.message}</p>
      <div class="notice-meta">
        By ${n.author} · ${new Date(n.created_at).toLocaleDateString()}
        ${n.expiry_date ? `· Expires ${new Date(n.expiry_date).toLocaleDateString()}` : ""}
        ${expired ? "<span class='expired-tag'>EXPIRED</span>" : ""}
      </div>
      <div class="notice-actions">
        <button class="btn-sm btn-danger" onclick="deleteNotice('${n.id}')">Delete</button>
        <button class="btn-sm btn-secondary" onclick="togglePin('${n.id}',${!n.pinned})">${n.pinned?"Unpin":"Pin"}</button>
      </div>
    </div>`;
  }).join("") || "<p>No notices yet.</p>";
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("noticeForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const notice = {
      title:       document.getElementById("noticeTitle").value,
      message:     document.getElementById("noticeMsg").value,
      priority:    document.getElementById("noticePriority").value,
      audience:    document.getElementById("noticeAudience").value,
      expiry_date: document.getElementById("noticeExpiry").value || null,
      pinned:      document.getElementById("noticePinned").checked,
      author:      ADMIN.username,
      created_at:  new Date().toISOString()
    };
    const { error } = await supabase.from("notices").insert([notice]);
    if (error) { showToast("Error: " + error.message, "error"); return; }
    showToast("Notice published!", "success");
    e.target.reset();
    loadNotices();
  });
});

window.deleteNotice = async (id) => {
  if (!confirm("Delete this notice?")) return;
  await supabase.from("notices").delete().eq("id", id);
  showToast("Notice deleted.", "success");
  loadNotices();
};

window.togglePin = async (id, pinned) => {
  await supabase.from("notices").update({ pinned }).eq("id", id);
  loadNotices();
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// FACILITIES SECTIONS (injected into admin navigation)
// ─────────────────────────────────────────────────────────────────────────────
import {
  loadFacilitiesList, loadBookings, loadMaintenance,
  initFacStatusModal, initBookingModal, initMaintenanceModal
} from "./facilities.js";

document.addEventListener("DOMContentLoaded", () => {
  initFacStatusModal();
  initBookingModal();
  initMaintenanceModal();
});

// Extend navigateTo loaders
const _origLoaders = {
  facilities:  () => loadFacilitiesList("facilitiesContainer"),
  bookings:    () => loadBookings("bookingsContainer"),
  maintenance: () => loadMaintenance("maintenanceContainer"),
};

// Patch into existing navigateTo by re-registering via event
document.querySelectorAll(".nav-link").forEach(link => {
  if (["facilities","bookings","maintenance"].includes(link.dataset.section)) {
    link.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".nav-link").forEach(l => l.classList.toggle("active", l === link));
      document.querySelectorAll(".dash-section").forEach(s =>
        s.classList.toggle("hidden", s.id !== `section-${link.dataset.section}`));
      _origLoaders[link.dataset.section]?.();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADD ROOM
// ─────────────────────────────────────────────────────────────────────────────

window.openAddRoomModal = () => {
  document.getElementById("addRoomModal")?.classList.add("open");
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("addRoomModalClose")?.addEventListener("click", () => {
    document.getElementById("addRoomModal")?.classList.remove("open");
  });

  document.getElementById("addRoomForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Adding…";

    const block     = document.getElementById("addRoomBlock").value;
    const roomNum   = document.getElementById("addRoomNumber").value.trim();
    const capacity  = parseInt(document.getElementById("addRoomCapacity").value);
    const occupancy = parseInt(document.getElementById("addRoomOccupancy").value) || 0;
    const type      = document.getElementById("addRoomType").value;

    // Check if room already exists
    const { data: existing } = await supabase
      .from("rooms")
      .select("id")
      .eq("block", block)
      .eq("room_number", roomNum)
      .limit(1);

    if (existing?.length > 0) {
      showToast(`Room ${block}-${roomNum} already exists.`, "error");
      btn.disabled = false;
      btn.textContent = "Add Room";
      return;
    }

    const { error } = await supabase.from("rooms").insert([{
      block,
      room_number:     roomNum,
      capacity,
      occupancy_count: Math.min(occupancy, capacity),
      type
    }]);

    if (error) {
      showToast("Error: " + error.message, "error");
      btn.disabled = false;
      btn.textContent = "Add Room";
      return;
    }

    await logAudit(`Added room: ${block}-${roomNum} (${type}, cap:${capacity})`, ADMIN?.username);
    showToast(`Room ${block}-${roomNum} added successfully!`, "success");
    document.getElementById("addRoomModal")?.classList.remove("open");
    e.target.reset();
    btn.disabled = false;
    btn.textContent = "Add Room";
    loadRoomMap(); // Refresh the room map
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MANAGE ROOMS SECTION
// ─────────────────────────────────────────────────────────────────────────────

async function loadManageRooms() {
  const block  = document.getElementById("manageRoomBlockFilter")?.value || "";
  const search = (document.getElementById("manageRoomSearch")?.value || "").toLowerCase();

  let query = supabase.from("rooms").select("*").order("block").order("room_number");
  if (block) query = query.eq("block", block);

  const { data: rooms, error } = await query;
  if (error) { showToast("Error loading rooms", "error"); return; }

  const filtered = (rooms || []).filter(r =>
    !search || r.room_number.toLowerCase().includes(search)
  );

  const tbody = document.getElementById("manageRoomsTableBody");
  const footer = document.getElementById("manageRoomsCount");
  if (!tbody) return;

  const typeColors = {
    vacant:  "#22c55e", partial: "#f59e0b",
    full:    "#ef4444", staff:   "#3b82f6",
    NSP:     "#a855f7", suite:   "#6366f1"
  };
  const typeLabels = {
    vacant: "Vacant", partial: "Partial", full: "Full",
    staff: "Staff", NSP: "NSP", suite: "Suite"
  };

  tbody.innerHTML = filtered.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400)">No rooms found</td></tr>`
    : filtered.map(r => `
      <tr>
        <td><span class="level-badge">Block ${r.block}</span></td>
        <td><strong>${r.room_number}</strong></td>
        <td>${r.capacity}</td>
        <td>${r.occupancy_count}</td>
        <td>
          <span style="background:${typeColors[r.type]}20;color:${typeColors[r.type]};
            padding:.2rem .6rem;border-radius:999px;font-size:11px;font-weight:700">
            ${typeLabels[r.type] || r.type}
          </span>
        </td>
        <td>
          <div class="table-actions">
            <button class="btn-sm btn-warning" onclick="openEditRoomModal('${r.id}','${r.block}','${r.room_number}',${r.capacity},'${r.type}')">✏️</button>
            <button class="btn-sm btn-danger"  onclick="deleteRoom('${r.id}','${r.block}-${r.room_number}')">🗑</button>
          </div>
        </td>
      </tr>`).join("");

  if (footer) footer.textContent = `${filtered.length} room${filtered.length !== 1 ? "s" : ""}`;
}

// Wire filters
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("manageRoomBlockFilter")?.addEventListener("change", loadManageRooms);
  document.getElementById("manageRoomSearch")?.addEventListener("input", loadManageRooms);

  // Add Room form
  document.getElementById("addRoomForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Adding…";

    const block  = document.getElementById("newRoomBlock").value;
    const number = document.getElementById("newRoomNumber").value.trim();
    const cap    = parseInt(document.getElementById("newRoomCapacity").value);
    const type   = document.getElementById("newRoomType").value;

    const { error } = await supabase.from("rooms").insert([{
      block, room_number: number, capacity: cap, occupancy_count: 0, type
    }]);

    if (error) {
      showToast("Error: " + error.message, "error");
    } else {
      showToast(`Room ${block}-${number} added!`, "success");
      await logAudit(`Added room: ${block}-${number}`, ADMIN?.username);
      e.target.reset();
      loadManageRooms();
    }
    btn.disabled = false; btn.textContent = "Add Room";
  });
});

// Edit Room
window.openEditRoomModal = (id, block, number, capacity, type) => {
  document.getElementById("editRoomId").value       = id;
  document.getElementById("editRoomBlock").value    = block;
  document.getElementById("editRoomNumber").value   = number;
  document.getElementById("editRoomCapacity").value = capacity;
  document.getElementById("editRoomType").value     = type;
  document.getElementById("editRoomModal").classList.add("open");
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("editRoomForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id  = document.getElementById("editRoomId").value;
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";

    const payload = {
      block:       document.getElementById("editRoomBlock").value,
      room_number: document.getElementById("editRoomNumber").value.trim(),
      capacity:    parseInt(document.getElementById("editRoomCapacity").value),
      type:        document.getElementById("editRoomType").value,
    };

    const { error } = await supabase.from("rooms").update(payload).eq("id", id);
    if (error) {
      showToast("Error: " + error.message, "error");
    } else {
      showToast("Room updated!", "success");
      await logAudit(`Updated room: ${payload.block}-${payload.room_number}`, ADMIN?.username);
      document.getElementById("editRoomModal").classList.remove("open");
      loadManageRooms();
    }
    btn.disabled = false; btn.textContent = "Save Changes";
  });

  document.getElementById("editRoomModalClose")?.addEventListener("click", () => {
    document.getElementById("editRoomModal").classList.remove("open");
  });
});

// Delete Room
window.deleteRoom = async (roomId, label) => {
  if (!confirm(`Delete room ${label}? This cannot be undone.`)) return;

  // Check if any students are assigned
  const { data: assigned } = await supabase
    .from("students").select("id").eq("room_id", roomId).limit(1);

  if (assigned?.length > 0) {
    showToast("Cannot delete — students are assigned to this room. Remove assignments first.", "error");
    return;
  }

  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) { showToast("Error: " + error.message, "error"); return; }
  await logAudit(`Deleted room: ${label}`, ADMIN?.username);
  showToast(`Room ${label} deleted.`, "success");
  loadManageRooms();
};

// Register manage rooms in navigation
document.querySelectorAll(".nav-link").forEach(link => {
  if (link.dataset.section === "managerooms") {
    link.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".nav-link").forEach(l => l.classList.toggle("active", l === link));
      document.querySelectorAll(".dash-section").forEach(s =>
        s.classList.toggle("hidden", s.id !== "section-managerooms"));
      loadManageRooms();
    });
  }
});
