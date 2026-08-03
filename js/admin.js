/**
 * admin.js — UCC Nyakrom Campus Accommodation Portal
 * PLACE THIS FILE AT: /js/admin.js
 */

import { supabase, showToast, logAudit, sendApplicationEmail, callEdgeFunction, appConfirm, appPrompt } from "./supabaseClient.js";
import { fetchActiveProgrammes, fetchAllProgrammes, clearProgrammeCache, populateProgramSelect, programmePillHTML } from "./programmes.js";
import { getPermissions, filterSidebarByRole, getRoleBadgeHTML } from "./roles.js";
import { loadStudents, initAddStudentModal, initEditStudentModal, initAssignRoomModal, bulkEnrolAll, initBulkUpload } from "./admin_students.js";
import { requireAuth, getSession, logout, initChangePasswordModal, initIdleTimeout } from "./auth.js";
import { fetchRooms, fetchAvailableRooms, fetchRoomWithOccupants, assignRoom, removeRoomAssignment, renderRoomGrid, changeRoomType } from "./rooms.js";
import { loadFacilitiesList, loadBookings, loadMaintenance, initFacStatusModal, initBookingModal, initMaintenanceModal } from "./facilities.js";
import { generateOccupancyReport, recordRoomHistory, loadRoomHistory,
         loadAcademicYears, setActiveYear, createNewYear,
         loadWaitingList, addToWaitingList, removeFromWaitingList } from "./reports.js";
async function sendSMS(phone, message) {
  if (!phone) return;

  const result = await callEdgeFunction("account-manager", {
    action: "send_sms",
    token: ADMIN?.token,
    phone,
    message,
  });

  if (!result.success) {
    showToast(result.error || "Failed to send SMS.", "error");
    return;
  }
  if (result.sent) {
    showToast("SMS sent!", "success");
  } else {
    console.log("SMS pending (Arkesel not configured):", message);
    showToast(result.note || "SMS logged. Configure Arkesel API to send real SMS.", "info");
  }
}

async function notifyApplicationStatus(regNumber, status) {
  const { data: s } = await supabase.from("students")
    .select("full_name, phone").eq("reg_number", regNumber).single();
  if (!s?.phone) return;
  const msg = status === "approved"
    ? `Dear ${s.full_name}, your accommodation application at UCC Nyakrom has been APPROVED. Visit the General Office to complete check-in. - UCC Nyakrom`
    : `Dear ${s.full_name}, your accommodation application was not successful. Visit the General Office for more info. - UCC Nyakrom`;
  await sendSMS(s.phone, msg);
}

async function sendLoginCredentials(regNumber, fullName, phone, password) {
  const msg = `Dear ${fullName}, your UCC Nyakrom portal account is ready.
URL: uccnyakrom.github.io/portal
Username: ${regNumber}
Password: ${password}
Change password after first login. - UCC Nyakrom`;
  await sendSMS(phone, msg);
}

requireAuth("admin");
const ADMIN = getSession();
window.bulkEnrolAll = bulkEnrolAll;

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE BOOT — one DOMContentLoaded
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("adminName").textContent = ADMIN.username || "Admin";
  document.getElementById("logoutBtn").addEventListener("click", logout);

  const roleEl = document.getElementById("adminRoleBadge");
  if (roleEl) roleEl.innerHTML = getRoleBadgeHTML(ADMIN.role || "admin");

  const userRole = ADMIN.role || "admin";
  filterSidebarByRole(userRole);
  window._canEnrol = ["admin","superadmin"].includes(userRole);
  if (!window._canEnrol) {
    const b = document.getElementById("bulkEnrolBtn");
    if (b) b.style.display = "none";
  }

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", e => {
      const href = link.getAttribute("href");
      if (href && href !== "#" && !href.startsWith("#")) {
        return; // Let browser navigate to real pages
      }
      e.preventDefault();
      navigateTo(link.dataset.section);
    });
  });

  // Init modals
  initAddStudentModal();
  initEditStudentModal();
  initAssignRoomModal();
  initChangePasswordModal();
  initBulkUpload();
  initFacStatusModal();
  initBookingModal();
  initMaintenanceModal();
  initIdleTimeout(); // Auto-logout after 10 minutes of inactivity

  // Assign room modal — handler lives in admin_students.js (initAssignRoomModal),
  // which also sends the room-assignment email. Do not bind a second handler here.
  document.getElementById("assignModalClose")?.addEventListener("click", () => {
    document.getElementById("assignModal").classList.remove("open");
  });

  // Notice form
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

  // Create admin form
  document.getElementById("createAdminForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const username = document.getElementById("newAdminUser").value.trim();
    const password = document.getElementById("newAdminPass").value.trim();
    const role     = document.getElementById("newAdminRole")?.value || "admin";
    const result = await callEdgeFunction("account-manager", {
      action: "create_staff_user",
      token: ADMIN?.token,
      username, password, role,
    });
    if (!result.success) { showToast(result.error || "Could not create user.", "error"); return; }
    showToast(`User "${username}" created as ${role}.`, "success");
    e.target.reset();
    loadUserManagement();
  });

  // Enrol student form
  document.getElementById("enrolStudentForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const regNumber = document.getElementById("enrolReg").value.trim().toUpperCase();
    const result = await callEdgeFunction("account-manager", {
      action: "enrol_student",
      token: ADMIN?.token,
      regNumber,
    });
    if (!result.success) { showToast(result.error || "Enrolment failed.", "error"); return; }
    showToast(`Student ${regNumber} enrolled successfully.`, "success");
    e.target.reset();
    loadUserManagement();
  });

  // Add room form
  document.getElementById("addRoomForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const block    = document.getElementById("newRoomBlock").value;
    const roomNum  = document.getElementById("newRoomNumber").value.trim();
    const capacity = parseInt(document.getElementById("newRoomCapacity").value);
    const type     = document.getElementById("newRoomType").value;
    const floor    = document.getElementById("newRoomFloor")?.value || null;
    const { error } = await supabase.from("rooms").insert([{ block, room_number: roomNum, capacity, occupancy_count: 0, type, floor }]);
    if (error) { showToast("Error: " + error.message, "error"); return; }
    await logAudit(`Added room: Block ${block} ${roomNum}`, ADMIN.username);
    showToast(`Room ${block}-${roomNum} added!`, "success");
    e.target.reset();
    loadManageRooms();
  });

  document.getElementById("filterRoomBlock")?.addEventListener("change", loadManageRooms);

  // Edit room modal close
  document.getElementById("editRoomModalClose")?.addEventListener("click", () => {
    document.getElementById("editRoomModal").classList.remove("open");
  });

  // Edit room form
  document.getElementById("editRoomForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id       = document.getElementById("editRoomId").value;
    const roomNum  = document.getElementById("editRoomNumber").value.trim();
    const capacity = parseInt(document.getElementById("editRoomCapacity").value);
    const type     = document.getElementById("editRoomType").value;
    const floor    = document.getElementById("editRoomFloor")?.value || null;
    const { error } = await supabase.from("rooms").update({ room_number: roomNum, capacity, type, floor }).eq("id", id);
    if (error) { showToast("Error: " + error.message, "error"); return; }
    showToast("Room updated!", "success");
    document.getElementById("editRoomModal").classList.remove("open");
    loadManageRooms();
  });
  document.getElementById("editRoomModal")?.querySelector(".modal-close")?.addEventListener("click", () => {
    document.getElementById("editRoomModal").classList.remove("open");
  });

  // Live clock
  const clockEl = document.getElementById("liveTime");
  if (clockEl) {
    const tick = () => clockEl.textContent = new Date().toLocaleTimeString();
    tick(); setInterval(tick, 1000);
  }

  // Real-time
  supabase.channel("rooms-rt").on("postgres_changes",
    { event: "*", schema: "public", table: "rooms" },
    () => showToast("Room data updated.", "info")
  ).subscribe();

  supabase.channel("apps-rt").on("postgres_changes",
    { event: "INSERT", schema: "public", table: "applications" },
    () => showToast("New application received!", "warning")
  ).subscribe();

  navigateTo("overview");
});

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
function navigateTo(section) {
  document.querySelectorAll(".nav-link").forEach(l =>
    l.classList.toggle("active", l.dataset.section === section));
  document.querySelectorAll(".dash-section").forEach(s =>
    s.classList.toggle("hidden", s.id !== `section-${section}`));

  const loaders = {
    overview:     loadOverview,
    students:     () => loadStudents(),
    rooms:        loadRoomMap,
    allocations:  loadAllocations,
    roomchanges:  loadRoomChanges,
    applications: loadApplications,
    publicapps:   loadPublicApps,
    managerooms:  loadManageRooms,
    reports:      loadReports,
    users:        loadUserManagement,
    notices:      loadNotices,
    export:       () => {},
    audit:        loadAuditLog,
    facilities:   () => loadFacilitiesList("facilitiesContainer"),
    bookings:     () => loadBookings("bookingsContainer"),
    maintenance:  () => loadMaintenance("maintenanceContainer"),
    waiting:      loadWaitingListSection,
    academicyear: loadAcademicYearSection,
    history:      () => {},
    statistics:   loadStatistics,
    programmes:   loadProgrammesList,
    emergency:    loadEmergencySection,
  };
  if (loaders[section]) loaders[section]();
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
async function loadOverview() {
  const [roomsRes, appsRes, studentsRes, housedRes, totalRes] = await Promise.all([
    supabase.from("rooms").select("*"),
    supabase.from("applications").select("id, status"),
    supabase.from("students").select("id, program, level, sex, room, room_id"),
    supabase.from("students").select("id", { count: "exact", head: true }).not("room_id", "is", null),
    supabase.from("students").select("id", { count: "exact", head: true })
  ]);

  const rooms = roomsRes.data || [], apps = appsRes.data || [], students = studentsRes.data || [];
  const totalStudents = totalRes.count || 0, residential = housedRes.count || 0;

  // Non-student rooms (staff/NSP/suite) are excluded from bed/vacancy/occupancy
  // calculations — they're not part of the pool available to students.
  const NON_STUDENT_TYPES = ["staff", "NSP", "suite"];
  const studentRooms = rooms.filter(r => !NON_STUDENT_TYPES.includes(r.type));

  const totalBeds    = studentRooms.reduce((a,r)=>a+r.capacity,0);
  const occupiedBeds = studentRooms.reduce((a,r)=>a+r.occupancy_count,0);

  // Residential = room assigned · Non-Residential = declared "NR" · rest = Not Decided
  const nonResidential = students.filter(s => !s.room_id && (s.room || "").toUpperCase() === "NR").length;
  const notDecided     = Math.max(0, totalStudents - residential - nonResidential);

  setCard("statTotal",     totalStudents);
  setCard("statResidents", residential);
  setCard("statHoused",    nonResidential);                       // Non-Residential Students
  setCard("statUndecided", notDecided);                           // Not Decided
  setCard("statUnhoused",  studentRooms.length);                  // Student Rooms (total)
  setCard("statBeds",      totalBeds - occupiedBeds);             // Available Beds
  setCard("statVacant",    studentRooms.filter(r=>r.occupancy_count===0).length); // Vacant Rooms
  setCard("statPending",   apps.filter(a=>a.status==="pending").length);
  setCard("statOccRate",   totalBeds > 0 ? Math.round((occupiedBeds/totalBeds)*100)+"%" : "0%");

  drawBlockChart(rooms);
  await drawProgramChart(students);
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
  drawBarChart(ctx, canvas, blocks,
    [{ label:"Occupied", data:blocks.map(b=>rooms.filter(r=>r.block===b).reduce((a,r)=>a+r.occupancy_count,0)), color:"#1e3a5f" },
     { label:"Capacity", data:blocks.map(b=>rooms.filter(r=>r.block===b).reduce((a,r)=>a+r.capacity,0)), color:"#c9a84c" }],
    "Occupancy by Block");
}

async function drawProgramChart(students) {
  const canvas = document.getElementById("programChart");
  if (!canvas) return;

  const programmes = await fetchActiveProgrammes();
  const counts = {};
  students.forEach(s => {
    const name = (s.program || "Unspecified").trim();
    counts[name] = (counts[name] || 0) + 1;
  });

  const labels = [], data = [], colors = [];
  Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(name => {
    const match = programmes.find(p => p.name === name);
    labels.push(`${match?.short_label || name} (${counts[name]})`);
    data.push(counts[name]);
    colors.push(match?.color || "#9ca3af");
  });

  drawPieChart(canvas.getContext("2d"), canvas, labels, data, colors);
}

function drawSexChart(students) {
  const canvas = document.getElementById("sexChart");
  if (!canvas) return;
  const male = students.filter(s=>["M","Male"].includes(s.sex)).length;
  const female = students.filter(s=>["F","Female"].includes(s.sex)).length;
  drawPieChart(canvas.getContext("2d"), canvas, [`Male (${male})`,`Female (${female})`], [male,female], ["#3b82f6","#ec4899"]);
}

function drawBarChart(ctx, canvas, labels, datasets, title) {
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const pad={top:40,right:20,bottom:50,left:50}, cW=W-pad.left-pad.right, cH=H-pad.top-pad.bottom;
  const maxVal=Math.max(...datasets.flatMap(d=>d.data),1);
  const barW=(cW/labels.length)/(datasets.length+1);
  ctx.font="bold 13px Georgia,serif"; ctx.fillStyle="#1e3a5f"; ctx.textAlign="center";
  ctx.fillText(title,W/2,22);
  ctx.strokeStyle="#e5e7eb"; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.top+cH-(i/4)*cH;
    ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
    ctx.fillStyle="#9ca3af"; ctx.font="10px sans-serif"; ctx.textAlign="right";
    ctx.fillText(Math.round((i/4)*maxVal),pad.left-4,y+3);
  }
  labels.forEach((label,i)=>{
    const groupX=pad.left+i*(cW/labels.length)+barW/2;
    datasets.forEach((ds,j)=>{
      const barH=(ds.data[i]/maxVal)*cH;
      ctx.fillStyle=ds.color;
      ctx.fillRect(groupX+j*(barW+2),pad.top+cH-barH,barW,barH);
    });
    ctx.fillStyle="#374151"; ctx.font="11px sans-serif"; ctx.textAlign="center";
    ctx.fillText(label,groupX+((datasets.length-1)*(barW+2))/2,H-pad.bottom+15);
  });
  datasets.forEach((ds,i)=>{
    ctx.fillStyle=ds.color; ctx.fillRect(pad.left+i*90,H-16,12,10);
    ctx.fillStyle="#374151"; ctx.font="10px sans-serif"; ctx.textAlign="left";
    ctx.fillText(ds.label,pad.left+i*90+16,H-7);
  });
}

function drawPieChart(ctx, canvas, labels, data, colors) {
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const cx=W/2, cy=H/2-15, r=Math.min(W,H)/2-40;
  const total=data.reduce((a,v)=>a+v,0)||1;
  let start=-Math.PI/2;
  data.forEach((val,i)=>{
    const angle=(val/total)*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,start,start+angle);
    ctx.closePath(); ctx.fillStyle=colors[i]; ctx.fill();
    const mid=start+angle/2;
    ctx.fillStyle="#fff"; ctx.font="bold 11px sans-serif"; ctx.textAlign="center";
    ctx.fillText(Math.round((val/total)*100)+"%",cx+(r*0.6)*Math.cos(mid),cy+(r*0.6)*Math.sin(mid));
    start+=angle;
  });
  labels.forEach((l,i)=>{
    ctx.fillStyle=colors[i]; ctx.fillRect(10+i*120,H-18,12,10);
    ctx.fillStyle="#374151"; ctx.font="11px sans-serif"; ctx.textAlign="left";
    ctx.fillText(l,26+i*120,H-9);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOM MAP
// ─────────────────────────────────────────────────────────────────────────────
async function loadRoomMap() {
  const [rooms, occRes] = await Promise.all([
    fetchRooms(),
    supabase.from("students")
      .select("id, full_name, reg_number, program, level, sex, room_id")
      .not("room_id", "is", null),
  ]);

  const occupantsByRoom = {};
  (occRes.data || []).forEach(s => (occupantsByRoom[s.room_id] ||= []).push(s));

  renderRoomGrid("roomMapGrid", rooms, openRoomPanel, {
    occupantsByRoom,
    showTypeSelect: true,
    showFilters: true,
  });
}

// ── Room info panel: occupants + assign / remove without leaving the map ─────
async function openRoomPanel(room) {
  const info = document.getElementById("roomInfoPanel");
  if (!info) return;
  info.innerHTML = `<p style="color:var(--gray-400);margin-top:2rem">Loading room…</p>`;
  info.classList.add("open");

  const [{ room: r, occupants }, unassignedRes] = await Promise.all([
    fetchRoomWithOccupants(room.id),
    supabase.from("students")
      .select("id, full_name, reg_number, sex")
      .is("room_id", null)
      .order("full_name"),
  ]);
  if (!r) { info.innerHTML = `<p style="color:#ef4444;margin-top:2rem">Room not found.</p>`; return; }

  const unassigned = unassignedRes.data || [];
  const hasSpace   = r.occupancy_count < r.capacity;
  const canManage  = getPermissions(ADMIN?.role).canAssignRooms;
  const esc = s => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  info.innerHTML = `
    <button class="panel-close" id="roomPanelClose">×</button>
    <h3>Block ${esc(r.block)} – Room ${esc(r.room_number)}</h3>
    <div class="panel-meta">
      <span><strong>Capacity:</strong> ${r.capacity}</span>
      <span><strong>Occupied:</strong> ${r.occupancy_count}</span>
      <span class="badge badge-${r.type}">${r.type}</span>
    </div>

    <h4 class="panel-subhead">Occupants (${occupants.length})</h4>
    ${occupants.length === 0
      ? `<p class="panel-empty">No occupants</p>`
      : `<ul class="panel-occupants">${occupants.map(o => `
          <li>
            <div class="occ-details">
              <span class="occ-name">${(o.sex||"").toUpperCase()==="F"?"♀":"♂"} ${esc(o.full_name || "—")}</span>
              <span class="occ-sub">${esc(o.reg_number)} · ${esc(o.program || "")}</span>
            </div>
            ${canManage ? `<button class="btn-sm btn-danger occ-remove" data-sid="${o.id}" data-name="${esc(o.full_name || o.reg_number)}" title="Remove from room">✕</button>` : ""}
          </li>`).join("")}
        </ul>`}

    ${canManage ? `
    <h4 class="panel-subhead">Assign a Student</h4>
    ${!hasSpace
      ? `<p class="panel-empty">Room is at full capacity.</p>`
      : unassigned.length === 0
        ? `<p class="panel-empty">No unassigned students.</p>`
        : `<div class="panel-assign">
            <select id="panelAssignSelect">
              <option value="">— Select student —</option>
              ${unassigned.map(s => `<option value="${s.id}">${esc(s.full_name || s.reg_number)} (${esc(s.reg_number)}) ${(s.sex||"").toUpperCase()==="F"?"♀":"♂"}</option>`).join("")}
            </select>
            <button class="btn-sm btn-gold" id="panelAssignBtn">➕ Assign</button>
          </div>`}` : ""}
  `;

  // ── Wire actions ──
  document.getElementById("roomPanelClose").addEventListener("click", () => info.classList.remove("open"));

  info.querySelectorAll(".occ-remove").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!await appConfirm(`Remove ${btn.dataset.name} from Room ${r.block}-${r.room_number}?`)) return;
      btn.disabled = true;
      const result = await removeRoomAssignment(btn.dataset.sid, ADMIN?.username || "admin");
      if (result.success) {
        showToast("Occupant removed.", "success");
        await loadRoomMap();
        openRoomPanel({ id: r.id });
      } else {
        showToast(result.error || "Failed to remove occupant.", "error");
        btn.disabled = false;
      }
    });
  });

  document.getElementById("panelAssignBtn")?.addEventListener("click", async () => {
    const sel = document.getElementById("panelAssignSelect");
    const studentId = sel?.value;
    if (!studentId) { showToast("Select a student first.", "warning"); return; }
    const btn = document.getElementById("panelAssignBtn");
    btn.disabled = true; btn.textContent = "Assigning…";
    const result = await assignRoom(studentId, r.id, ADMIN?.username || "admin");
    if (result.success) {
      showToast(`Student assigned to ${r.block}-${r.room_number}.`, "success");
      await loadRoomMap();
      openRoomPanel({ id: r.id });
    } else {
      showToast(result.error || "Failed to assign.", "error");
      btn.disabled = false; btn.textContent = "➕ Assign";
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ALLOCATIONS
// ─────────────────────────────────────────────────────────────────────────────
async function loadAllocations() {
  const { data: students } = await supabase
    .from("students")
    .select("id, full_name, reg_number, program, level, sex, room_id, rooms:room_id(block, room_number)")
    .not("room_id", "is", null)
    .order("full_name");

  const programmes = await fetchActiveProgrammes();
  const tbody = document.getElementById("allocTableBody");
  const footer = document.getElementById("allocTableFooter");
  if (!tbody) return;
  const list = students || [];
  if (footer) footer.textContent = `${list.length} allocation${list.length!==1?"s":""}`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="table-empty"><div class="table-empty-icon">🏠</div><h4>No allocations yet</h4></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => {
    const name = s.full_name || "—";
    const initials = name.split(" ").map(w=>w[0]).join("").substring(0,2).toUpperCase();
    const isFemale = (s.sex||"").toUpperCase()==="F";
    const roomLabel = s.rooms ? `${s.rooms.block}-${s.rooms.room_number}` : "—";
    return `<tr>
      <td><div class="student-name-cell">
        <div class="student-avatar ${isFemale?"female":""}">${initials}</div>
        <div><div class="student-name-text">${name}</div><div class="student-reg-text">${s.reg_number}</div></div>
      </div></td>
      <td>${programmePillHTML(s.program, programmes)}</td>
      <td><span class="level-badge">Level ${s.level||"—"}</span></td>
      <td><span class="sex-indicator ${isFemale?"female":"male"}">${isFemale?"♀ Female":"♂ Male"}</span></td>
      <td><span class="room-cell assigned">🏠 ${roomLabel}</span></td>
      <td><div class="table-actions">
        <button class="btn-sm btn-warning" onclick="openAssignRoomModal('${s.id}','${escHtml(name)}')">🔄 Change</button>
        <button class="btn-sm btn-danger"  onclick="removeRoom('${s.id}')">✕ Remove</button>
      </div></td>
    </tr>`;
  }).join("");
}

window.removeRoom = async (studentId) => {
  if (!await appConfirm("Remove this student's room assignment?")) return;
  const result = await removeRoomAssignment(studentId, ADMIN.username);
  if (result.success) { showToast("Room removed.", "success"); loadAllocations(); loadStudents(); }
  else showToast(result.error, "error");
};

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATIONS
// ─────────────────────────────────────────────────────────────────────────────
async function loadApplications() {
  // Applications table uses reg_number directly
  const { data: apps } = await supabase
    .from("applications")
    .select("id, reg_number, preferred_block, notes, status, submitted_at, reviewed_by, reviewed_at")
    .order("submitted_at", { ascending: false });

  // Look up student details by reg_number
  const regNumbers = (apps||[]).map(a => a.reg_number).filter(Boolean);
  let studentMap = {};
  if (regNumbers.length > 0) {
    const { data: students } = await supabase
      .from("students")
      .select("reg_number, full_name, program")
      .in("reg_number", regNumbers);
    (students||[]).forEach(s => studentMap[s.reg_number] = s);
  }

  const tbody = document.getElementById("appTableBody");
  if (!tbody) return;
  tbody.innerHTML = (apps||[]).map(a => {
    const student = studentMap[a.reg_number] || {};
    const date = a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "—";
    return `<tr>
      <td>${student.full_name || a.reg_number || "—"}</td>
      <td>${a.reg_number || "—"}</td>
      <td>${student.program || "—"}</td>
      <td>${date}</td>
      <td><span class="badge badge-${a.status}">${a.status}</span></td>
      <td>${a.status==="pending"?`
        <button class="btn-sm btn-success" onclick="updateApp('${a.id}','approved')">Approve</button>
        <button class="btn-sm btn-danger"  onclick="updateApp('${a.id}','rejected')">Reject</button>
      `:"—"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400)">No applications</td></tr>`;
}

window.updateApp = async (appId, status) => {
  const { error } = await supabase.from("applications").update({ status, reviewed_by: ADMIN.username, reviewed_at: new Date().toISOString() }).eq("id", appId);
  if (error) { showToast("Update failed.", "error"); return; }
  await logAudit(`Application ${appId} ${status}`, ADMIN.username);
  showToast(`Application ${status}.`, "success");
  loadApplications();
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC APPLICATIONS
// ─────────────────────────────────────────────────────────────────────────────

// Currently selected status tab — defaults to "pending"
window._publicAppsTab = window._publicAppsTab || "pending";

window.setPublicAppsTab = function(status) {
  window._publicAppsTab = status;
  document.querySelectorAll("#publicAppsTabs .papp-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.status === status);
  });
  loadPublicApps();
};

async function loadPublicApps() {
  const { data } = await supabase
    .from("public_applications")
    .select("*")
    .order("created_at", { ascending: false });

  const tbody  = document.getElementById("publicAppsBody");
  const footer = document.getElementById("publicAppsFooter");
  if (!tbody) return;

  const allList = data || [];

  // Update tab counts
  const counts = { pending: 0, enrolled: 0, rejected: 0, all: allList.length };
  allList.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });
  const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  setCount("paCountPending",  counts.pending);
  setCount("paCountEnrolled", counts.enrolled);
  setCount("paCountRejected", counts.rejected);
  setCount("paCountAll",      counts.all);

  // Filter by active tab
  const activeTab = window._publicAppsTab || "pending";
  const list = activeTab === "all" ? allList : allList.filter(a => a.status === activeTab);

  if (footer) footer.textContent = `${list.length} application${list.length!==1?"s":""}`;

  if (list.length === 0) {
    const emptyMessages = {
      pending:  "No pending applications — all caught up!",
      enrolled: "No enrolled applications yet.",
      rejected: "No rejected applications.",
      all:      "No public applications yet.",
    };
    tbody.innerHTML = `<tr><td colspan="11"><div class="table-empty">
      <div class="table-empty-icon">📩</div>
      <h4>${emptyMessages[activeTab] || "No applications"}</h4>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(a => {
    const prefRoom = a.preferred_room || "No preference";
    const isEnrolled = a.status === "enrolled";

    return `<tr>
      <td><strong>${a.full_name}</strong></td>
      <td style="font-size:11px">${a.reg_number}</td>
      <td>${a.program || "—"}</td>
      <td>Level ${a.level}</td>
      <td>${a.sex==="M"?"♂ Male":"♀ Female"}</td>
      <td>${a.phone||"—"}</td>
      <td style="font-size:11px">${a.email||"—"}</td>
      <td>
        ${a.preferred_room
          ? `<span class="room-cell assigned" style="font-size:11px">🏠 ${a.preferred_room}</span>`
          : `<span style="color:var(--gray-400);font-size:11px">No preference</span>`}
      </td>
      <td><span class="badge badge-${a.status}">${a.status}</span></td>
      <td style="font-size:11px">${a.created_at ? new Date(a.created_at).toLocaleDateString() : "—"}</td>
      <td>
        <div class="table-actions">
          ${a.status === "pending" ? `
            <button class="btn-sm btn-success"
              onclick="enrollPublicApplicant('${a.id}','${escHtml(a.full_name)}','${a.reg_number}','${escHtml(a.program||"")}',${a.level||100},'${a.sex||"M"}','${escHtml(a.preferred_room||"")}','${a.email||""}')">
              ✓ Enrol
            </button>
            <button class="btn-sm btn-danger" onclick="rejectPublicApp('${a.id}','${escHtml(a.full_name)}','${a.email||""}')">✕ Reject</button>
          ` : ""}
          ${isEnrolled && a.preferred_room ? `
            <button class="btn-sm btn-primary"
              onclick="assignPreferredRoom('${a.reg_number}','${escHtml(a.preferred_room)}','${escHtml(a.full_name)}')">
              🏠 Assign Room
            </button>
          ` : ""}
        </div>
      </td>
    </tr>`;
  }).join("");
}

window.enrollPublicApplicant = async (appId, name, regNumber, program, level, sex, preferredRoom="", email="") => {
  if (!await appConfirm(`Enrol ${name} (${regNumber}) as a student?`)) return;

  // Check not already enrolled
  const { data: existing } = await supabase
    .from("students").select("id").eq("reg_number", regNumber).limit(1);
  if (existing?.length) {
    showToast(`${regNumber} is already in the students table.`, "warning");
    // Still update application status
    await supabase.from("public_applications").update({ status: "enrolled" }).eq("id", appId);
    loadPublicApps();
    return;
  }

  // Insert student — level must be a number
  const lvl = parseInt(level) || 100;
  const s = sex === "M" || sex === "Male" || sex === "male" ? "M" : "F";

  const { error: sErr } = await supabase.from("students").insert([{
    full_name:  name,
    reg_number: regNumber,
    program:    program || "BSc Nursing",
    level:      lvl,
    sex:        s,
    email:      email || null
  }]);

  if (sErr) {
    showToast("Error adding student: " + sErr.message, "error");
    console.error("Enrol error:", sErr);
    return;
  }

  // Create portal account
  const userResult = await callEdgeFunction("account-manager", {
    action: "enrol_student",
    token: ADMIN?.token,
    regNumber,
  });
  if (!userResult.success) console.warn("User account error:", userResult.error);

  // Update application status
  await supabase.from("public_applications").update({ status: "enrolled" }).eq("id", appId);
  await logAudit(`Enrolled public applicant: ${regNumber}`, ADMIN.username);

  showToast(`${name} enrolled successfully! Find them in All Students to assign a room.`, "success");
  loadPublicApps();
  // Also refresh students cache so they appear immediately in All Students
  window._allStudents = null;
};

window.rejectPublicApp = async (appId, name="", email="") => {
  if (!await appConfirm("Reject this application?")) return;
  await supabase.from("public_applications").update({ status: "rejected" }).eq("id", appId);

  // Send rejection email (applicant was not approved for a room)
  if (email) {
    sendApplicationEmail({
      to: email, applicantName: name || "Applicant", status: "rejected"
    }).then(r => {
      if (r.success) showToast(`Notification email sent to ${email}`, "info");
      else showToast(`Rejected, but email failed: ${r.error}`, "warning");
    });
  }

  showToast("Application rejected.", "info");
  loadPublicApps();
};

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────────────────────────────────────
async function loadReports() {
  const { data: rooms } = await supabase.from("rooms").select("*");
  const tableBody = document.getElementById("utilTableBody");
  if (!tableBody || !rooms) return;
  const blocks = ["NE","N","NW","ADM","S"];
  tableBody.innerHTML = blocks.map(b => {
    const bRooms = rooms.filter(r=>r.block===b);
    const cap = bRooms.reduce((a,r)=>a+r.capacity,0);
    const occ = bRooms.reduce((a,r)=>a+r.occupancy_count,0);
    const pct = cap>0 ? Math.round((occ/cap)*100) : 0;
    return `<tr>
      <td>Block ${b}</td><td>${bRooms.length}</td><td>${cap}</td><td>${occ}</td><td>${cap-occ}</td>
      <td><div class="util-bar-wrap"><div class="util-bar" style="width:${pct}%"></div></div>${pct}%</td>
    </tr>`;
  }).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
async function loadUserManagement() {
  const result = await callEdgeFunction("account-manager", {
    action: "list_staff_users",
    token: ADMIN?.token,
  });
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;
  if (!result.success) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--gray-400)">${escHtml(result.error || "Could not load users.")}</td></tr>`;
    return;
  }
  const users = result.users || [];
  tbody.innerHTML = users.map(u => `<tr>
    <td>${u.username}</td>
    <td>${getRoleBadgeHTML(u.role)}</td>
    <td>${u.id!==ADMIN.id?`<button class="btn-sm btn-danger" onclick="deleteUser('${u.id}','${escHtml(u.username)}')">Delete</button>`:"—"}</td>
  </tr>`).join("");
}

window.deleteUser = async (userId, username) => {
  if (!await appConfirm(`Delete user "${username}"?`)) return;
  const result = await callEdgeFunction("account-manager", {
    action: "delete_staff_user",
    token: ADMIN?.token,
    userId,
  });
  if (!result.success) { showToast(result.error || "Could not delete user.", "error"); return; }
  showToast("User deleted.", "success");
  loadUserManagement();
};

// ─────────────────────────────────────────────────────────────────────────────
// NOTICES
// ─────────────────────────────────────────────────────────────────────────────
async function loadNotices() {
  const { data: notices } = await supabase.from("notices").select("*")
    .order("pinned", { ascending: false }).order("created_at", { ascending: false });
  const list = document.getElementById("noticeAdminList");
  if (!list) return;
  const now = new Date();
  list.innerHTML = (notices||[]).map(n => {
    const expired = n.expiry_date && new Date(n.expiry_date) < now;
    return `<div class="notice-card priority-${n.priority} ${expired?"notice-expired":""}">
      <div class="notice-header">
        <span class="notice-title">${n.pinned?"📌 ":""}${n.title}</span>
        <span class="notice-priority">${n.priority.toUpperCase()}</span>
      </div>
      <p class="notice-msg">${n.message}</p>
      <div class="notice-meta">By ${n.author} · ${new Date(n.created_at).toLocaleDateString()}
        ${n.expiry_date?`· Expires ${new Date(n.expiry_date).toLocaleDateString()}`:""}
        ${expired?"<span class='expired-tag'>EXPIRED</span>":""}
      </div>
      <div class="notice-actions">
        <button class="btn-sm btn-danger"    onclick="deleteNotice('${n.id}')">Delete</button>
        <button class="btn-sm btn-secondary" onclick="togglePin('${n.id}',${!n.pinned})">${n.pinned?"Unpin":"Pin"}</button>
      </div>
    </div>`;
  }).join("") || "<p>No notices yet.</p>";
}

window.deleteNotice = async (id) => {
  if (!await appConfirm("Delete this notice?")) return;
  await supabase.from("notices").delete().eq("id", id);
  showToast("Notice deleted.", "success");
  loadNotices();
};

window.togglePin = async (id, pinned) => {
  await supabase.from("notices").update({ pinned }).eq("id", id);
  loadNotices();
};

// ─────────────────────────────────────────────────────────────────────────────
// STATISTICS — residential / non-residential, by level, by programme
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAMMES MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

window.loadProgrammesList = async function() {
  const tbody = document.getElementById("programmesListBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400)">Loading…</td></tr>`;

  const programmes = await fetchAllProgrammes();

  if (!programmes.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gray-400)">No programmes yet. Add one using the form.</td></tr>`;
    return;
  }

  tbody.innerHTML = programmes.map(p => `
    <tr style="${p.is_active ? "" : "opacity:.5"}">
      <td>${programmePillHTML(p.name, [p])}</td>
      <td><strong>${escHtml(p.name)}</strong></td>
      <td>${escHtml(p.short_label || "—")}</td>
      <td>${p.sort_order}</td>
      <td>
        <span style="font-size:11px;font-weight:700;padding:.2rem .6rem;border-radius:999px;
              background:${p.is_active ? "rgba(5,150,105,.12)" : "rgba(107,114,128,.12)"};
              color:${p.is_active ? "#065f46" : "#6b7280"}">
          ${p.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td>
        <div class="table-actions">
          <button class="btn-sm" style="background:var(--navy);color:#fff;border:none;padding:.3rem .7rem;border-radius:6px;cursor:pointer;font-size:.72rem"
            onclick="editProgramme('${p.id}')">Edit</button>
          <button class="btn-sm btn-secondary" style="padding:.3rem .7rem;font-size:.72rem"
            onclick="toggleProgrammeActive('${p.id}', ${!p.is_active})">${p.is_active ? "Deactivate" : "Activate"}</button>
          <button class="btn-sm btn-danger" style="padding:.3rem .7rem;font-size:.72rem"
            onclick="deleteProgramme('${p.id}','${escHtml(p.name)}')">🗑</button>
        </div>
      </td>
    </tr>
  `).join("");
};

document.getElementById("programmeForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const btn    = document.getElementById("progSubmitBtn");
  const msgEl  = document.getElementById("progFormMsg");
  const editId = document.getElementById("progEditId").value;
  btn.disabled = true; btn.textContent = "Saving…";

  const payload = {
    name:        document.getElementById("progName").value.trim(),
    short_label: document.getElementById("progShortLabel").value.trim() || null,
    icon:        document.getElementById("progIcon").value.trim() || "🎓",
    color:       document.getElementById("progColor").value || "#6b7280",
    sort_order:  parseInt(document.getElementById("progSortOrder").value) || 0,
    is_active:   document.getElementById("progActive").checked,
  };

  let error;
  if (editId) {
    ({ error } = await supabase.from("programmes").update(payload).eq("id", editId));
  } else {
    ({ error } = await supabase.from("programmes").insert([payload]));
  }

  btn.disabled = false;
  if (error) {
    msgEl.style.display = "block";
    msgEl.style.background = "#fee2e2"; msgEl.style.color = "#991b1b";
    msgEl.textContent = "Error: " + error.message;
    btn.textContent = editId ? "Update Programme" : "Add Programme";
    return;
  }

  msgEl.style.display = "block";
  msgEl.style.background = "#d1fae5"; msgEl.style.color = "#065f46";
  msgEl.textContent = editId ? "Programme updated!" : "Programme added!";
  btn.textContent = editId ? "Update Programme" : "Add Programme";

  clearProgrammeCache();
  logAudit(`${editId ? "Updated" : "Added"} programme: ${payload.name}`, ADMIN?.username || "admin");
  resetProgrammeForm();
  loadProgrammesList();
  setTimeout(() => { msgEl.style.display = "none"; }, 3000);
});

window.resetProgrammeForm = function() {
  document.getElementById("programmeForm")?.reset();
  document.getElementById("progEditId").value = "";
  document.getElementById("progFormTitle").textContent = "➕ Add Programme";
  document.getElementById("progSubmitBtn").textContent = "Add Programme";
  document.getElementById("progColor").value = "#6b7280";
  document.getElementById("progSortOrder").value = "10";
  document.getElementById("progActive").checked = true;
  document.getElementById("progFormMsg").style.display = "none";
};

window.editProgramme = async function(id) {
  const programmes = await fetchAllProgrammes();
  const p = programmes.find(x => x.id === id);
  if (!p) { showToast("Could not find programme.", "error"); return; }

  document.getElementById("progEditId").value      = p.id;
  document.getElementById("progName").value        = p.name;
  document.getElementById("progShortLabel").value  = p.short_label || "";
  document.getElementById("progIcon").value        = p.icon || "🎓";
  document.getElementById("progColor").value       = p.color || "#6b7280";
  document.getElementById("progSortOrder").value   = p.sort_order ?? 10;
  document.getElementById("progActive").checked    = !!p.is_active;
  document.getElementById("progFormTitle").textContent = "✏️ Edit Programme";
  document.getElementById("progSubmitBtn").textContent = "Update Programme";
  document.getElementById("programmeForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.toggleProgrammeActive = async function(id, newActive) {
  const { error } = await supabase.from("programmes").update({ is_active: newActive }).eq("id", id);
  if (error) { showToast("Error: " + error.message, "error"); return; }
  clearProgrammeCache();
  showToast(newActive ? "Programme activated." : "Programme deactivated.", "success");
  loadProgrammesList();
};

window.deleteProgramme = async function(id, name) {
  if (!await appConfirm(`Delete "${name}"? This only removes it from the programmes list — any students already recorded under this programme name are unaffected, but it will stop appearing as a coloured pill (shown in grey instead). Consider deactivating instead if you might need it again.`)) return;
  const { error } = await supabase.from("programmes").delete().eq("id", id);
  if (error) { showToast("Delete failed: " + error.message, "error"); return; }
  clearProgrammeCache();
  logAudit(`Deleted programme: ${name}`, ADMIN?.username || "admin");
  showToast("Programme deleted.", "success");
  loadProgrammesList();
};

// Normalise a programme name for grouping: trim whitespace, use the exact
// value as stored on the student record (programmes are now a managed list,
// so values are consistent — no more hardcoded "and Dietetics" guessing).
function normaliseProgramme(program) {
  const p = (program || "").trim();
  return p || "Unspecified";
}

// Cache of the most recently computed stats, used by exportStatistics()
window._lastStats = null;

window.loadStatistics = async function() {
  const { data, error } = await supabase
    .from("students")
    .select("id, program, level, room_id");

  if (error) {
    showToast("Error loading statistics: " + error.message, "error");
    return;
  }

  const students = data || [];
  const programmes = await fetchActiveProgrammes();
  const total           = students.length;
  const residential     = students.filter(s => s.room_id).length;
  const nonResidential  = total - residential;
  const pct             = total > 0 ? Math.round((residential / total) * 100) : 0;

  // ── Summary cards ──────────────────────────────────────────────────────
  document.getElementById("statTotalStudents").textContent  = total;
  document.getElementById("statResidential").textContent     = residential;
  document.getElementById("statNonResidential").textContent  = nonResidential;
  document.getElementById("statPctResidential").textContent  = `${pct}%`;

  // ── By Level ────────────────────────────────────────────────────────────
  const levelMap = {};
  students.forEach(s => {
    const lvl = s.level || "Unspecified";
    if (!levelMap[lvl]) levelMap[lvl] = { res: 0, non: 0 };
    s.room_id ? levelMap[lvl].res++ : levelMap[lvl].non++;
  });
  const levelKeys = Object.keys(levelMap).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });

  const levelBody = document.getElementById("statsLevelBody");
  levelBody.innerHTML = levelKeys.map(lvl => {
    const row = levelMap[lvl];
    const rowTotal = row.res + row.non;
    return `<tr>
      <td><span class="level-badge">Level ${lvl}</span></td>
      <td>${row.res}</td>
      <td>${row.non}</td>
      <td><strong>${rowTotal}</strong></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--gray-400)">No data</td></tr>`;

  // Totals row — By Level
  {
    const totalRes = levelKeys.reduce((sum, lvl) => sum + levelMap[lvl].res, 0);
    const totalNon = levelKeys.reduce((sum, lvl) => sum + levelMap[lvl].non, 0);
    document.getElementById("statsLevelTotalRes").textContent = totalRes;
    document.getElementById("statsLevelTotalNon").textContent = totalNon;
    document.getElementById("statsLevelTotalAll").textContent = totalRes + totalNon;
  }

  // ── By Programme ────────────────────────────────────────────────────────
  const progMap = {};
  students.forEach(s => {
    const prog = normaliseProgramme(s.program);
    if (!progMap[prog]) progMap[prog] = { res: 0, non: 0 };
    s.room_id ? progMap[prog].res++ : progMap[prog].non++;
  });
  const progKeys = Object.keys(progMap).sort();

  const progBody = document.getElementById("statsProgramBody");
  progBody.innerHTML = progKeys.map(prog => {
    const row = progMap[prog];
    const rowTotal = row.res + row.non;
    return `<tr>
      <td>${programmePillHTML(prog, programmes)}</td>
      <td>${row.res}</td>
      <td>${row.non}</td>
      <td><strong>${rowTotal}</strong></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--gray-400)">No data</td></tr>`;

  // Totals row — By Programme
  {
    const totalRes = progKeys.reduce((sum, prog) => sum + progMap[prog].res, 0);
    const totalNon = progKeys.reduce((sum, prog) => sum + progMap[prog].non, 0);
    document.getElementById("statsProgramTotalRes").textContent = totalRes;
    document.getElementById("statsProgramTotalNon").textContent = totalNon;
    document.getElementById("statsProgramTotalAll").textContent = totalRes + totalNon;
  }

  // ── By Programme & Level combined ──────────────────────────────────────
  const combinedMap = {};
  students.forEach(s => {
    const prog = normaliseProgramme(s.program);
    const lvl  = s.level || "Unspecified";
    const key  = `${prog}|||${lvl}`;
    if (!combinedMap[key]) combinedMap[key] = { prog, lvl, res: 0, non: 0 };
    s.room_id ? combinedMap[key].res++ : combinedMap[key].non++;
  });
  const combinedRows = Object.values(combinedMap).sort((a, b) => {
    if (a.prog !== b.prog) return a.prog.localeCompare(b.prog);
    const na = Number(a.lvl), nb = Number(b.lvl);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a.lvl).localeCompare(String(b.lvl));
  });

  const combinedBody = document.getElementById("statsCombinedBody");
  combinedBody.innerHTML = combinedRows.map(row => {
    const rowTotal = row.res + row.non;
    return `<tr>
      <td>${programmePillHTML(row.prog, programmes)}</td>
      <td><span class="level-badge">Level ${row.lvl}</span></td>
      <td>${row.res}</td>
      <td>${row.non}</td>
      <td><strong>${rowTotal}</strong></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--gray-400)">No data</td></tr>`;

  // Totals row — By Programme & Level
  {
    const totalRes = combinedRows.reduce((sum, r) => sum + r.res, 0);
    const totalNon = combinedRows.reduce((sum, r) => sum + r.non, 0);
    document.getElementById("statsCombinedTotalRes").textContent = totalRes;
    document.getElementById("statsCombinedTotalNon").textContent = totalNon;
    document.getElementById("statsCombinedTotalAll").textContent = totalRes + totalNon;
  }

  // Timestamp
  document.getElementById("statsUpdatedAt").textContent =
    `Last updated: ${new Date().toLocaleString()}`;

  // Cache for export
  window._lastStats = {
    total, residential, nonResidential, pct,
    byLevel: levelKeys.map(lvl => ({ level: lvl, residential: levelMap[lvl].res, nonResidential: levelMap[lvl].non, total: levelMap[lvl].res + levelMap[lvl].non })),
    byProgramme: progKeys.map(prog => ({ programme: prog, residential: progMap[prog].res, nonResidential: progMap[prog].non, total: progMap[prog].res + progMap[prog].non })),
    combined: combinedRows.map(r => ({ programme: r.prog, level: r.lvl, residential: r.res, nonResidential: r.non, total: r.res + r.non })),
  };
};

// Export the cached statistics to CSV (multiple tables in one file)
window.exportStatistics = function(format = "csv") {
  if (!window._lastStats) {
    showToast("Load the Statistics section first.", "warning");
    return;
  }
  const s = window._lastStats;
  const lines = [];

  lines.push("UCC Nyakrom Smart Campus Portal — Student Statistics");
  lines.push(`Generated,${new Date().toLocaleString()}`);
  lines.push("");
  lines.push("SUMMARY");
  lines.push("Metric,Value");
  lines.push(`Total Students,${s.total}`);
  lines.push(`Residential,${s.residential}`);
  lines.push(`Non-Residential,${s.nonResidential}`);
  lines.push(`Percent Residential,${s.pct}%`);
  lines.push("");

  lines.push("BY LEVEL");
  lines.push("Level,Residential,Non-Residential,Total");
  s.byLevel.forEach(r => lines.push(`${r.level},${r.residential},${r.nonResidential},${r.total}`));
  lines.push("");

  lines.push("BY PROGRAMME");
  lines.push("Programme,Residential,Non-Residential,Total");
  s.byProgramme.forEach(r => lines.push(`"${r.programme}",${r.residential},${r.nonResidential},${r.total}`));
  lines.push("");

  lines.push("BY PROGRAMME AND LEVEL");
  lines.push("Programme,Level,Residential,Non-Residential,Total");
  s.combined.forEach(r => lines.push(`"${r.programme}",${r.level},${r.residential},${r.nonResidential},${r.total}`));

  const csv = lines.join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `student_statistics_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();

  logAudit("Exported student statistics (CSV)", ADMIN?.username || "admin");
  showToast("Statistics exported as CSV.", "success");
};


window.exportData = async (type, format) => {
  const confirmPass = await appPrompt("Enter your admin password to confirm export:");
  if (!confirmPass) return;
  const check = await callEdgeFunction("account-manager", {
    action: "verify_staff_password",
    username: ADMIN.username,
    password: confirmPass,
  });
  if (!check.success) { showToast("Invalid password.", "error"); return; }
  let data, filename;
  if (type==="students")     { const r=await supabase.from("students").select("*");     data=r.data; filename="students"; }
  if (type==="rooms")        { const r=await supabase.from("rooms").select("*");        data=r.data; filename="rooms"; }
  if (type==="applications") { const r=await supabase.from("applications").select("*"); data=r.data; filename="applications"; }
  if (type==="audit")        { const r=await supabase.from("audit_logs").select("*");   data=r.data; filename="audit_logs"; }
  if (!data) { showToast("No data to export.", "warning"); return; }
  if (format==="csv")  downloadCSV(data, filename);
  if (format==="json") downloadJSON(data, filename);
  await logAudit(`Exported ${type} as ${format}`, ADMIN.username);
  showToast(`Exported ${type} as ${format.toUpperCase()}.`, "success");
};

function downloadCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(",");
  const rows = data.map(r=>Object.values(r).map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(","));
  downloadFile([headers,...rows].join("\n"), `${filename}.csv`, "text/csv");
}
function downloadJSON(data, filename) { downloadFile(JSON.stringify(data,null,2), `${filename}.json`, "application/json"); }
function downloadFile(content, filename, mimeType) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content],{type:mimeType}));
  a.download = filename; a.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────
async function loadAuditLog() {
  const { data } = await supabase.from("audit_logs").select("*")
    .order("timestamp", { ascending: false }).limit(200);
  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;
  tbody.innerHTML = (data||[]).map(log => `<tr>
    <td>${new Date(log.timestamp).toLocaleString()}</td>
    <td>${log.user}</td><td>${log.action}</td>
  </tr>`).join("") || `<tr><td colspan="3" style="text-align:center">No logs</td></tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MANAGE ROOMS
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// FLOOR/BLOCK MANAGEMENT (#11)
// ─────────────────────────────────────────────────────────────────────────────
async function loadManageRooms() {
  const block = document.getElementById("filterRoomBlock")?.value || "";
  let query = supabase.from("rooms").select("*").order("block").order("floor").order("room_number");
  if (block) query = query.eq("block", block);
  const { data } = await query;
  const tbody  = document.getElementById("manageRoomsBody");
  const footer = document.getElementById("manageRoomsFooter");
  if (!tbody) return;
  const list = data || [];
  if (footer) footer.textContent = `${list.length} room${list.length!==1?"s":""}`;
  const typeColors = { vacant:"#22c55e", partial:"#f59e0b", full:"#ef4444", staff:"#3b82f6", NSP:"#a855f7", suite:"#6366f1" };
  tbody.innerHTML = list.map(r => `<tr>
    <td><strong>Block ${r.block}</strong></td>
    <td>${r.floor ? `Floor ${r.floor}` : "—"}</td>
    <td>${r.room_number}</td><td>${r.capacity}</td>
    <td><div style="display:flex;align-items:center;gap:.4rem">
      <div style="flex:1;height:6px;background:var(--gray-100);border-radius:3px;overflow:hidden">
        <div style="width:${r.capacity>0?Math.round(r.occupancy_count/r.capacity*100):0}%;height:100%;background:${typeColors[r.type]||"#9ca3af"}"></div>
      </div>${r.occupancy_count}/${r.capacity}
    </div></td>
    <td><span class="badge" style="background:${typeColors[r.type]||"#9ca3af"}20;color:${typeColors[r.type]||"#9ca3af"}">${r.type}</span></td>
    <td><div class="table-actions">
      <button class="btn-sm btn-warning" onclick="openEditRoomModal('${r.id}','${r.block}','${r.room_number}',${r.capacity},'${r.type}','${r.floor||""}')">✏️</button>
      <button class="btn-sm btn-danger"  onclick="deleteRoom('${r.id}','${r.block}','${r.room_number}')">🗑</button>
    </div></td>
  </tr>`).join("") || `<tr><td colspan="7" style="text-align:center;padding:2rem">No rooms found</td></tr>`;
}

window.openEditRoomModal = (id, block, roomNum, capacity, type, floor="") => {
  document.getElementById("editRoomId").value       = id;
  document.getElementById("editRoomBlock").value    = block;
  document.getElementById("editRoomNumber").value   = roomNum;
  document.getElementById("editRoomCapacity").value = capacity;
  document.getElementById("editRoomType").value     = type;
  const floorEl = document.getElementById("editRoomFloor");
  if (floorEl) floorEl.value = floor;
  document.getElementById("editRoomModal").classList.add("open");
};

window.deleteRoom = async (roomId, block, roomNum) => {
  if (!await appConfirm(`Delete Room ${block}-${roomNum}?`)) return;
  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) { showToast("Error: " + error.message, "error"); return; }
  await logAudit(`Deleted room: ${block}-${roomNum}`, ADMIN.username);
  showToast("Room deleted.", "success");
  loadManageRooms();
};

window.openEditRoomModal = (id, block, roomNum, capacity, type) => {
  document.getElementById("editRoomId").value       = id;
  document.getElementById("editRoomBlock").value    = block;
  document.getElementById("editRoomNumber").value   = roomNum;
  document.getElementById("editRoomCapacity").value = capacity;
  document.getElementById("editRoomType").value     = type;
  document.getElementById("editRoomModal").classList.add("open");
};

window.openAssignRoomModal = async (studentId, studentName, preferredRoom = "") => {
  // No preferred room passed in? Look it up from the student's latest
  // application — portal applications store it in preferred_block, public
  // (landing-page) applications in preferred_room.
  if (!preferredRoom) {
    try {
      const { data: st } = await supabase
        .from("students").select("reg_number").eq("id", studentId).single();
      if (st?.reg_number) {
        const [appRes, pubRes] = await Promise.all([
          supabase.from("applications")
            .select("preferred_block")
            .eq("reg_number", st.reg_number)
            .in("status", ["pending", "approved"])
            .order("submitted_at", { ascending: false })
            .limit(1),
          supabase.from("public_applications")
            .select("preferred_room")
            .eq("reg_number", st.reg_number)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        preferredRoom =
          appRes.data?.[0]?.preferred_block ||
          pubRes.data?.[0]?.preferred_room  || "";
      }
    } catch (e) { /* lookup is best-effort — modal still works without it */ }
  }

  const rooms = await fetchAvailableRooms();
  const select = document.getElementById("assignRoomSelect");

  select.innerHTML = `<option value="">— Select Room —</option>` +
    rooms.map(r => {
      // Check if this matches the preferred room (e.g. "N-A23" matches block N room A23)
      const label = `Block ${r.block} – ${r.room_number} (${r.occupancy_count}/${r.capacity})`;
      const matchesPref = preferredRoom &&
        (preferredRoom.includes(r.room_number) || preferredRoom === `${r.block}-${r.room_number}`);
      return `<option value="${r.id}" ${matchesPref ? "selected" : ""}>${label}${matchesPref ? " ← Preferred" : ""}</option>`;
    }).join("");

  document.getElementById("assignStudentId").value         = studentId;
  document.getElementById("assignStudentName").textContent = studentName;

  // Show preferred room hint
  const hint = document.getElementById("assignPreferredHint");
  if (hint) {
    hint.textContent = preferredRoom && preferredRoom !== "No preference"
      ? `Student's preferred room: ${preferredRoom}`
      : "";
    hint.style.display = preferredRoom && preferredRoom !== "No preference" ? "block" : "none";
  }

  document.getElementById("assignModal").classList.add("open");
};

// ─────────────────────────────────────────────────────────────────────────────
// ROOM CHANGE REQUESTS (admin review)
// ─────────────────────────────────────────────────────────────────────────────
let _rcrInitDone = false;

async function loadRoomChanges() {
  const tbody = document.getElementById("rcrTableBody");
  if (!tbody) return;

  if (!_rcrInitDone) {
    document.getElementById("rcrFilterStatus")?.addEventListener("change", loadRoomChanges);
    _rcrInitDone = true;
  }

  const statusFilter = document.getElementById("rcrFilterStatus")?.value ?? "pending";

  let query = supabase
    .from("room_change_requests")
    .select(`*,
      students:student_id(full_name, reg_number, program, level, sex, phone),
      cur:current_room_id(block, room_number),
      req:requested_room_id(block, room_number, capacity, occupancy_count, type)`)
    .order("requested_at", { ascending: false })
    .limit(100);
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  const footer = document.getElementById("rcrTableFooter");

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:#ef4444">Could not load requests: ${error.message}<br>
      <small>Have you run room-change-setup.sql in Supabase?</small></td></tr>`;
    return;
  }
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty"><div class="table-empty-icon">🔁</div><h4>No ${statusFilter || ""} requests</h4></div></td></tr>`;
    if (footer) footer.textContent = "0 requests";
    return;
  }
  if (footer) footer.textContent = `${data.length} request${data.length !== 1 ? "s" : ""}`;

  const canAct = getPermissions(ADMIN?.role).canAssignRooms;
  const badge = s => ({
    pending:  `<span class="badge badge-in_progress">Pending</span>`,
    approved: `<span class="badge badge-resolved">Approved</span>`,
    rejected: `<span class="badge badge-open">Rejected</span>`,
    cancelled:`<span class="badge badge-closed">Cancelled</span>`,
    expired:  `<span class="badge badge-closed">Expired</span>`,
  }[s] || s);

  tbody.innerHTML = data.map(r => {
    const st       = r.students || {};
    const curLabel = r.cur ? `${r.cur.block}-${r.cur.room_number}` : "—";
    const reqRoom  = r.req;
    const reqLabel = reqRoom ? `${reqRoom.block}-${reqRoom.room_number}` : "—";
    const reqFull  = reqRoom && reqRoom.occupancy_count >= reqRoom.capacity;
    return `<tr>
      <td><strong>${st.full_name || "—"}</strong><br><small style="color:var(--gray-400)">${st.reg_number || ""} · ${st.program || ""}</small></td>
      <td>${curLabel}</td>
      <td>${reqLabel}${reqRoom ? `<br><small style="color:${reqFull ? "#ef4444" : "var(--gray-400)"}">${reqRoom.occupancy_count}/${reqRoom.capacity}${reqFull ? " — now full" : ""}</small>` : ""}</td>
      <td style="max-width:220px;font-size:12px">${(r.reason || "").slice(0, 200)}</td>
      <td>${new Date(r.requested_at).toLocaleDateString()}</td>
      <td>${badge(r.status)}${r.reviewed_by ? `<br><small style="color:var(--gray-400)">by ${r.reviewed_by}</small>` : ""}</td>
      <td>${r.status === "pending" && canAct ? `<div class="table-actions">
        <button class="btn-sm btn-primary" onclick="approveRoomChange('${r.id}')" ${reqFull ? "disabled title='Requested room is full'" : ""}>✓ Approve</button>
        <button class="btn-sm btn-danger" onclick="rejectRoomChange('${r.id}')">✕ Reject</button>
      </div>` : "—"}</td>
    </tr>`;
  }).join("");
}

window.approveRoomChange = async (requestId) => {
  const { data: r } = await supabase
    .from("room_change_requests")
    .select("*, students:student_id(full_name, reg_number), req:requested_room_id(block, room_number)")
    .eq("id", requestId).single();
  if (!r || r.status !== "pending") { showToast("Request not found or already handled.", "warning"); loadRoomChanges(); return; }

  const label = r.req ? `${r.req.block}-${r.req.room_number}` : "the requested room";
  if (!await appConfirm(`Move ${r.students?.full_name || "student"} to Room ${label}?`)) return;

  // assignRoom handles capacity check, old-room decrement, counts and audit
  const result = await assignRoom(r.student_id, r.requested_room_id, ADMIN?.username || "admin");
  if (!result.success) { showToast("Could not move student: " + result.error, "error"); return; }

  await recordRoomHistory(r.student_id, r.requested_room_id, r.req?.block, r.req?.room_number, ADMIN?.username || "admin");
  await supabase.from("room_change_requests").update({
    status: "approved",
    reviewed_by: ADMIN?.username || "admin",
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId);

  showToast(`Approved — ${r.students?.reg_number || "student"} moved to ${label}.`, "success");
  loadRoomChanges();
};

window.rejectRoomChange = async (requestId) => {
  const note = await appPrompt("Reason for rejection (shown to the student, optional):");
  if (note === null) return; // cancelled — don't reject
  const { error } = await supabase.from("room_change_requests").update({
    status: "rejected",
    review_note: note.trim() || null,
    reviewed_by: ADMIN?.username || "admin",
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId).eq("status", "pending");
  if (error) { showToast("Could not reject: " + error.message, "error"); return; }
  await logAudit(`Rejected room change request ${requestId}`, ADMIN?.username || "admin");
  showToast("Request rejected.", "info");
  loadRoomChanges();
};

// ─────────────────────────────────────────────────────────────────────────────
// EMERGENCY SERVICES
// ─────────────────────────────────────────────────────────────────────────────
const escT = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let _emInitDone = false;

async function loadEmergencySection() {
  const role      = ADMIN?.role || "";
  const canManage = ["admin", "superadmin"].includes(role);
  const canLookup = ["admin", "superadmin", "security"].includes(role);

  document.getElementById("emContactsCard").style.display = canManage ? "" : "none";
  document.getElementById("emIceCard").style.display      = canLookup ? "" : "none";

  if (!_emInitDone) { initEmergencyHandlers(); _emInitDone = true; }
  if (canManage) await loadEmergencyContacts();
}

async function loadEmergencyContacts() {
  const tbody = document.getElementById("emContactsBody");
  if (!tbody) return;

  const { data, error } = await supabase
    .from("emergency_contacts").select("*")
    .order("display_order").order("label");

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:#ef4444">Could not load contacts: ${escT(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--gray-400)">No emergency contacts yet. Add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(c => emContactRowHTML(c)).join("");
}

function emContactRowHTML(c) {
  return `<tr data-id="${c.id}">
    <td><strong>${escT(c.label)}</strong></td>
    <td><a href="tel:${escT(c.phone)}" style="color:var(--navy);font-weight:600">${escT(c.phone)}</a></td>
    <td><span class="badge ${c.category === "campus" ? "badge-facility" : "badge-open"}">${escT(c.category)}</span></td>
    <td>${escT(c.location_note) || "—"}</td>
    <td>${c.display_order}</td>
    <td>${c.is_active
      ? `<span class="badge badge-resolved">Active</span>`
      : `<span class="badge badge-closed">Hidden</span>`}</td>
    <td><div class="table-actions">
      <button class="btn-sm btn-warning em-edit">✏️ Edit</button>
      <button class="btn-sm btn-secondary em-toggle">${c.is_active ? "🙈 Hide" : "👁 Show"}</button>
    </div></td>
  </tr>`;
}

function emContactEditRowHTML(c) {
  return `<tr data-id="${c.id}" class="em-editing">
    <td><input type="text"  class="em-f-label" value="${escT(c.label)}" style="width:100%;min-width:130px"></td>
    <td><input type="tel"   class="em-f-phone" value="${escT(c.phone)}" style="width:100%;min-width:100px"></td>
    <td><select class="em-f-category">
      <option value="campus"   ${c.category === "campus"   ? "selected" : ""}>campus</option>
      <option value="national" ${c.category === "national" ? "selected" : ""}>national</option>
    </select></td>
    <td><input type="text"   class="em-f-note"  value="${escT(c.location_note || "")}" style="width:100%;min-width:130px"></td>
    <td><input type="number" class="em-f-order" value="${c.display_order}" min="1" style="width:64px"></td>
    <td>${c.is_active
      ? `<span class="badge badge-resolved">Active</span>`
      : `<span class="badge badge-closed">Hidden</span>`}</td>
    <td><div class="table-actions">
      <button class="btn-sm btn-gold em-save">💾 Save</button>
      <button class="btn-sm btn-secondary em-cancel">Cancel</button>
    </div></td>
  </tr>`;
}

function initEmergencyHandlers() {
  // ── Add-contact form show/hide + submit ──
  const addWrap = document.getElementById("emAddFormWrap");
  document.getElementById("emAddContactBtn")?.addEventListener("click", () => {
    addWrap.style.display = addWrap.style.display === "none" ? "" : "none";
  });
  document.getElementById("emAddCancel")?.addEventListener("click", () => {
    addWrap.style.display = "none";
    document.getElementById("emAddForm").reset();
  });

  document.getElementById("emAddForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const payload = {
      label:         document.getElementById("emNewLabel").value.trim(),
      phone:         document.getElementById("emNewPhone").value.trim(),
      category:      document.getElementById("emNewCategory").value,
      location_note: document.getElementById("emNewNote").value.trim() || null,
      display_order: parseInt(document.getElementById("emNewOrder").value, 10) || 1,
      is_active:     true,
    };
    const { error } = await supabase.from("emergency_contacts").insert([payload]);
    if (error) { showToast("Could not save contact: " + error.message, "error"); return; }
    showToast("Emergency contact added.", "success");
    logAudit(`Added emergency contact "${payload.label}"`, ADMIN?.username || "admin");
    e.target.reset();
    addWrap.style.display = "none";
    loadEmergencyContacts();
  });

  // ── Row actions via delegation (Edit / Toggle / Save / Cancel) ──
  document.getElementById("emContactsBody")?.addEventListener("click", async e => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const id = row.dataset.id;

    const fetchRow = async () => {
      const { data } = await supabase.from("emergency_contacts").select("*").eq("id", id).single();
      return data;
    };

    if (e.target.closest(".em-edit")) {
      const c = await fetchRow();
      if (!c) { showToast("Contact not found.", "error"); return; }
      row.outerHTML = emContactEditRowHTML(c);
      return;
    }

    if (e.target.closest(".em-cancel")) { loadEmergencyContacts(); return; }

    if (e.target.closest(".em-save")) {
      const payload = {
        label:         row.querySelector(".em-f-label").value.trim(),
        phone:         row.querySelector(".em-f-phone").value.trim(),
        category:      row.querySelector(".em-f-category").value,
        location_note: row.querySelector(".em-f-note").value.trim() || null,
        display_order: parseInt(row.querySelector(".em-f-order").value, 10) || 1,
      };
      if (!payload.label || !payload.phone) { showToast("Label and phone are required.", "warning"); return; }
      const { error } = await supabase.from("emergency_contacts").update(payload).eq("id", id);
      if (error) { showToast("Update failed: " + error.message, "error"); return; }
      showToast("Contact updated.", "success");
      logAudit(`Updated emergency contact "${payload.label}"`, ADMIN?.username || "admin");
      loadEmergencyContacts();
      return;
    }

    if (e.target.closest(".em-toggle")) {
      const c = await fetchRow();
      if (!c) { showToast("Contact not found.", "error"); return; }
      const { error } = await supabase.from("emergency_contacts")
        .update({ is_active: !c.is_active }).eq("id", id);
      if (error) { showToast("Toggle failed: " + error.message, "error"); return; }
      showToast(`"${c.label}" is now ${c.is_active ? "hidden" : "active"}.`, "success");
      logAudit(`${c.is_active ? "Hid" : "Activated"} emergency contact "${c.label}"`, ADMIN?.username || "admin");
      loadEmergencyContacts();
    }
  });

  // ── ICE lookup ──
  const runIceSearch = async () => {
    const q = document.getElementById("emIceSearch").value.trim();
    const tbody = document.getElementById("emIceLookupBody");
    if (!q) { showToast("Type a name or reg number first.", "warning"); return; }
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400)">Searching…</td></tr>`;

    const { data, error } = await supabase
      .from("students")
      .select("id, full_name, reg_number, ice_contacts(contact_name, relationship, phone, alt_phone)")
      .or(`full_name.ilike.%${q}%,reg_number.ilike.%${q}%`)
      .order("full_name")
      .limit(25);

    if (error) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:#ef4444">Search failed: ${escT(error.message)}</td></tr>`;
      return;
    }
    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400)">No students match "${escT(q)}".</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(s => {
      const ice = Array.isArray(s.ice_contacts) ? s.ice_contacts[0] : s.ice_contacts;
      return `<tr>
        <td><strong>${escT(s.full_name)}</strong></td>
        <td>${escT(s.reg_number)}</td>
        ${ice ? `
          <td>${escT(ice.contact_name)}</td>
          <td>${escT(ice.relationship)}</td>
          <td><a href="tel:${escT(ice.phone)}" style="color:var(--navy);font-weight:700">📞 ${escT(ice.phone)}</a></td>
          <td>${ice.alt_phone ? `<a href="tel:${escT(ice.alt_phone)}" style="color:var(--navy)">📞 ${escT(ice.alt_phone)}</a>` : "—"}</td>
        ` : `
          <td colspan="4" style="color:var(--gray-400);font-style:italic">No ICE contact set</td>
        `}
      </tr>`;
    }).join("");
  };

  document.getElementById("emIceSearchBtn")?.addEventListener("click", runIceSearch);
  document.getElementById("emIceSearch")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); runIceSearch(); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str||"").replace(/'/g,"\\'").replace(/"/g,"&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// WAITING LIST (#12)
// ─────────────────────────────────────────────────────────────────────────────
async function loadWaitingListSection() {
  const tbody = document.getElementById("waitingListBody");
  const footer = document.getElementById("waitingListFooter");
  if (!tbody) return;

  const list = await loadWaitingList();
  if (footer) footer.textContent = `${list.length} student${list.length !== 1 ? "s" : ""} waiting`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty"><div class="table-empty-icon">⏳</div><h4>Waiting list is empty</h4></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => `<tr>
    <td><strong>${s.full_name}</strong></td>
    <td>${s.reg_number}</td>
    <td>${s.program || "—"}</td>
    <td>Level ${s.level || "—"}</td>
    <td>${s.sex === "M" ? "♂ Male" : "♀ Female"}</td>
    <td>${new Date(s.created_at).toLocaleDateString()}</td>
    <td>
      <button class="btn-sm btn-success" onclick="assignFromWaiting('${s.id}','${s.student_id}','${escHtml(s.full_name)}')">🏠 Assign Room</button>
      <button class="btn-sm btn-danger"  onclick="removeWaiting('${s.id}','${escHtml(s.full_name)}')">✕ Remove</button>
    </td>
  </tr>`).join("");
}

window.assignFromWaiting = async (waitingId, studentId, name) => {
  await openAssignRoomModal(studentId, name);
  // Remove from waiting list after assignment
  window._pendingWaitingRemoval = waitingId;
};

window.removeWaiting = async (id, name) => {
  if (!await appConfirm(`Remove ${name} from waiting list?`)) return;
  await removeFromWaitingList(id, "cancelled");
  showToast(`${name} removed from waiting list.`, "success");
  loadWaitingListSection();
};

// ─────────────────────────────────────────────────────────────────────────────
// ACADEMIC YEAR (#10)
// ─────────────────────────────────────────────────────────────────────────────
async function loadAcademicYearSection() {
  const container = document.getElementById("academicYearContainer");
  if (!container) return;

  const years = await loadAcademicYears();

  container.innerHTML = `
    <div class="form-card" style="margin-bottom:1.5rem">
      <h3>Create New Academic Year</h3>
      <form id="newYearForm">
        <div class="form-row">
          <div class="form-group">
            <label>Year</label>
            <input type="text" id="newYearValue" placeholder="e.g. 2025/2026" required>
          </div>
          <div class="form-group">
            <label>Semester</label>
            <select id="newSemesterValue" required>
              <option value="Semester 1">Semester 1</option>
              <option value="Semester 2">Semester 2</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Create Year</button>
      </form>
    </div>
    <div class="table-card">
      <div class="table-card-header"><span class="table-card-title">📅 Academic Years</span></div>
      <div class="table-wrap">
        <table class="beautiful-table">
          <thead><tr><th>Year</th><th>Semester</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${years.map(y => `<tr>
              <td>${y.year}</td>
              <td>${y.semester}</td>
              <td><span style="background:${y.is_active?'#d1fae5':'#f3f4f6'};color:${y.is_active?'#065f46':'#6b7280'};padding:.2rem .6rem;border-radius:999px;font-size:11px;font-weight:700">${y.is_active?"● Active":"Inactive"}</span></td>
              <td>${!y.is_active ? `<button class="btn-sm btn-primary" onclick="activateYear('${y.id}')">Set Active</button>` : "Current"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="form-card" style="margin-top:1.5rem;border:2px solid #fca5a5">
      <h3 style="color:#b91c1c">🔄 End-of-Year Rollover</h3>
      <p style="font-size:13px;color:var(--gray-500);margin-bottom:1rem">
        Closes the current academic year: archives every allocation to room history,
        vacates <strong>all</strong> students, resets student rooms to vacant
        (staff/NSP/suite rooms untouched), archives pending applications, expires the
        waiting list, and activates the new year — all in a single transaction.
        <strong>Export your data first.</strong>
      </p>
      <form id="rolloverForm">
        <div class="form-row">
          <div class="form-group">
            <label>New Academic Year</label>
            <input type="text" id="rolloverYear" placeholder="e.g. 2026/2027" required>
          </div>
          <div class="form-group">
            <label>Semester</label>
            <select id="rolloverSemester">
              <option value="Semester 1">Semester 1</option>
              <option value="Semester 2">Semester 2</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:.5rem">
          <input type="checkbox" id="rolloverPromote" style="width:auto">
          <label for="rolloverPromote" style="margin:0;font-size:13px">Promote all students one level up (100→200, 200→300, 300→400)</label>
        </div>
        <button type="submit" class="btn btn-primary" id="rolloverBtn"
          style="background:#b91c1c">🔄 Run Rollover</button>
      </form>
      <div id="rolloverResult" style="display:none;margin-top:1rem;padding:1rem;background:#d1fae5;border-radius:8px;font-size:13px;color:#065f46"></div>
    </div>
  `;

  document.getElementById("newYearForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const year = document.getElementById("newYearValue").value.trim();
    const sem  = document.getElementById("newSemesterValue").value;
    await createNewYear(year, sem);
    loadAcademicYearSection();
  });

  document.getElementById("rolloverForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const newYear = document.getElementById("rolloverYear").value.trim();
    const newSem  = document.getElementById("rolloverSemester").value;
    const promote = document.getElementById("rolloverPromote").checked;

    if (!/^\d{4}\/\d{4}$/.test(newYear)) {
      showToast("Year must look like 2026/2027.", "warning"); return;
    }
    const typed = await appPrompt(
      `⚠️ This will vacate ALL students and activate ${newYear} ${newSem}.\n` +
      `It cannot be undone from the portal.\n\nType ROLLOVER to confirm:`
    );
    if (typed !== "ROLLOVER") { showToast("Rollover cancelled.", "info"); return; }

    const btn = document.getElementById("rolloverBtn");
    btn.disabled = true; btn.textContent = "Running…";

    const { data, error } = await supabase.rpc("perform_year_rollover", {
      p_new_year:     newYear,
      p_new_semester: newSem,
      p_promote:      promote,
      p_actor:        ADMIN?.username || "admin",
    });

    btn.disabled = false; btn.textContent = "🔄 Run Rollover";

    if (error) {
      showToast("Rollover failed — nothing was changed: " + error.message, "error");
      return;
    }

    const box = document.getElementById("rolloverResult");
    box.style.display = "";
    box.innerHTML = `✅ <strong>${data.old_year}</strong> closed → <strong>${data.new_year}</strong> active.<br>
      Students vacated: <strong>${data.vacated}</strong> ·
      Rooms reset: <strong>${data.rooms_reset}</strong> ·
      Promoted: <strong>${data.promoted}</strong> ·
      Applications archived: <strong>${data.apps_archived}</strong> ·
      Waiting list expired: <strong>${data.waitlist_expired}</strong>`;
    showToast("Year rollover completed successfully.", "success");
    loadAcademicYearSection();
  });
}

window.activateYear = async (yearId) => {
  await setActiveYear(yearId);
  loadAcademicYearSection();
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF REPORT (#5)
// ─────────────────────────────────────────────────────────────────────────────
window.generatePDFReport = async () => {
  showToast("Generating report…", "info");
  await generateOccupancyReport();
  await logAudit("Generated PDF occupancy report", ADMIN.username);
};

// ─────────────────────────────────────────────────────────────────────────────
// ROOM HISTORY (#7)
// ─────────────────────────────────────────────────────────────────────────────
window.viewRoomHistory = async (studentId, name) => {
  const history = await loadRoomHistory(studentId);
  const modal = document.getElementById("roomHistoryModal");
  const body  = document.getElementById("roomHistoryBody");
  if (!modal || !body) return;

  document.getElementById("roomHistoryTitle").textContent = `Room History — ${name}`;

  body.innerHTML = history.length === 0
    ? "<p style='color:var(--gray-400)'>No room history recorded.</p>"
    : history.map(h => `
      <div style="padding:.7rem;background:var(--gray-50);border-radius:6px;margin-bottom:.5rem">
        <strong>Block ${h.block} – Room ${h.room_number}</strong>
        <br><small style="color:var(--gray-400)">
          In: ${new Date(h.moved_in).toLocaleDateString()}
          ${h.moved_out ? ` · Out: ${new Date(h.moved_out).toLocaleDateString()}` : " · Current"}
          ${h.academic_year ? ` · ${h.academic_year}` : ""}
        </small>
      </div>`).join("");

  modal.classList.add("open");
};

// Application notification
window.notifyStudent = async (regNumber, status) => {
  const result = await notifyApplicationStatus(regNumber, status);
  if (result?.success) showToast("Student notified via SMS!", "success");
  else showToast("SMS not configured. Check notifications.js for Arkesel setup.", "warning");
};

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGN PREFERRED ROOM to enrolled public applicant
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// SEND ROOM-ASSIGNMENT EMAIL
// Called after any successful room assignment. Looks up the student's email
// and the room label, then emails them that a room has been assigned/approved.
// ─────────────────────────────────────────────────────────────────────────────
async function emailRoomAssigned(studentId, roomId) {
  try {
    const [{ data: student }, { data: room }] = await Promise.all([
      supabase.from("students").select("full_name, reg_number, email").eq("id", studentId).single(),
      supabase.from("rooms").select("block, room_number").eq("id", roomId).single(),
    ]);

    if (!student?.email) {
      showToast("Room assigned. No email on file for this student, so no notification sent.", "info");
      return;
    }

    const roomLabel = room ? `Block ${room.block} – Room ${room.room_number}` : "your assigned room";

    const r = await sendApplicationEmail({
      to: student.email,
      applicantName: student.full_name || "Student",
      status: "approved",
      roomNumber: roomLabel,
      regNumber: student.reg_number || "",
    });

    if (r.success) showToast(`📧 Room notification emailed to ${student.email}`, "success");
    else showToast(`Room assigned, but email failed: ${r.error}`, "warning");
  } catch (err) {
    console.error("emailRoomAssigned error:", err);
  }
}

window.assignPreferredRoom = async (regNumber, preferredRoom, studentName) => {
  // Find student by reg number
  const { data: students } = await supabase
    .from("students")
    .select("id, full_name")
    .eq("reg_number", regNumber)
    .limit(1);

  if (!students?.length) {
    showToast("Student not found in system. Please enrol first.", "error");
    return;
  }

  const studentId = students[0].id;

  // Try to find the preferred room
  // preferred_room is stored as "Block-RoomNumber" e.g. "N-A23"
  let roomQuery;
  if (preferredRoom.includes("-")) {
    const parts = preferredRoom.split("-");
    const block  = parts[0];
    const roomNum = parts.slice(1).join("-");
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, block, room_number, capacity, occupancy_count, type")
      .eq("block", block)
      .eq("room_number", roomNum)
      .limit(1);
    roomQuery = rooms;
  }

  if (roomQuery?.length) {
    const room = roomQuery[0];
    if (room.occupancy_count >= room.capacity) {
      showToast(`Room ${preferredRoom} is full. Please select a different room.`, "warning");
      // Open assign modal to pick another room
      await openAssignRoomModal(studentId, studentName);
      return;
    }
    // Confirm and assign
    if (await appConfirm(`Assign ${studentName} to Block ${room.block} – Room ${room.room_number}?`)) {
      const result = await assignRoom(studentId, room.id, ADMIN.username);
      if (result.success) {
        showToast(`${studentName} assigned to ${room.block}-${room.room_number}!`, "success");
        loadPublicApps();
        emailRoomAssigned(studentId, room.id); // notify student by email
      } else {
        showToast(result.error, "error");
      }
    }
  } else {
    // Room not found — open assign modal
    showToast(`Room "${preferredRoom}" not found. Please select manually.`, "warning");
    await openAssignRoomModal(studentId, studentName);
  }
};
