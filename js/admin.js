/**
 * admin.js — UCC Nyakrom Campus Accommodation Portal
 * PLACE THIS FILE AT: /js/admin.js
 */

import { supabase, showToast, logAudit } from "./supabaseClient.js";
import { getPermissions, filterSidebarByRole, getRoleBadgeHTML } from "./roles.js";
import { loadStudents, initAddStudentModal, initEditStudentModal, initAssignRoomModal, bulkEnrolAll, initBulkUpload } from "./admin_students.js";
import { requireAuth, getSession, logout, hashPassword, initChangePasswordModal } from "./auth.js";
import { fetchRooms, fetchAvailableRooms, fetchRoomWithOccupants, assignRoom, removeRoomAssignment, renderRoomGrid, changeRoomType } from "./rooms.js";
import { loadFacilitiesList, loadBookings, loadMaintenance, initFacStatusModal, initBookingModal, initMaintenanceModal } from "./facilities.js";


// Stubs for features pending full deployment
async function generateOccupancyReport() { showToast("Upload reports.js to enable PDF reports.", "info"); }
async function loadWaitingList() { return []; }
async function addToWaitingList() { showToast("Upload reports.js to enable waiting list.", "info"); }
async function removeFromWaitingList() {}
async function loadAcademicYears() { return []; }
async function setActiveYear() {}
async function createNewYear() {}
async function recordRoomHistory() {}
async function loadRoomHistory() { return []; }
async function sendSMS(phone, message) {
  if (!phone) return;
  // Format Ghana number
  let num = phone.replace(/\D/g,"");
  if (num.startsWith("0")) num = "233" + num.slice(1);
  if (!num.startsWith("233")) num = "233" + num;

  // Store in notifications log regardless
  await supabase.from("notifications").insert([{
    recipient: phone, type: "sms", message,
    status: "pending", created_at: new Date().toISOString()
  }]);

  // Arkesel API — configure your key in Supabase
  try {
    const { data: config } = await supabase
      .from("users").select("password").eq("username","_arkesel_key").limit(1);
    const apiKey = config?.[0]?.password;
    if (!apiKey) {
      console.log("SMS pending (Arkesel not configured):", message);
      showToast("SMS logged. Configure Arkesel API to send real SMS.", "info");
      return;
    }
    await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "UCCNyakrom", message, recipients: [num] })
    });
    await supabase.from("notifications").update({ status:"sent", sent_at: new Date().toISOString() })
      .eq("recipient", phone).eq("status","pending");
    showToast("SMS sent!", "success");
  } catch(err) {
    console.error("SMS error:", err);
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

  // Assign room modal (local)
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
    const { error } = await supabase.from("users").insert([{ username, password, role }]);
    if (error) { showToast("Error: " + error.message, "error"); return; }
    await logAudit(`Created user: ${username} (${role})`, ADMIN.username);
    showToast(`User "${username}" created as ${role}.`, "success");
    e.target.reset();
    loadUserManagement();
  });

  // Enrol student form
  document.getElementById("enrolStudentForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const regNumber = document.getElementById("enrolReg").value.trim().toUpperCase();
    const { data: students } = await supabase.from("students").select("id, full_name").eq("reg_number", regNumber).limit(1);
    if (!students?.length) { showToast("Student not found.", "error"); return; }
    const { data: existing } = await supabase.from("users").select("id").eq("username", regNumber).limit(1);
    if (existing?.length) { showToast("Student already enrolled.", "warning"); return; }
    const { error } = await supabase.from("users").insert([{ username: regNumber, password: "auto", role: "student" }]);
    if (error) { showToast("Error: " + error.message, "error"); return; }
    await logAudit(`Enrolled student: ${regNumber}`, ADMIN.username);
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
    supabase.from("students").select("id, program, level, sex"),
    supabase.from("students").select("id", { count: "exact", head: true }).not("room_id", "is", null),
    supabase.from("students").select("id", { count: "exact", head: true })
  ]);

  const rooms = roomsRes.data || [], apps = appsRes.data || [], students = studentsRes.data || [];
  const totalStudents = totalRes.count || 0, housed = housedRes.count || 0;
  const totalBeds = rooms.reduce((a,r)=>a+r.capacity,0);
  const occupiedBeds = rooms.reduce((a,r)=>a+r.occupancy_count,0);

  setCard("statTotal",     totalStudents);
  setCard("statResidents", housed);
  setCard("statHoused",    housed);
  setCard("statUnhoused",  totalStudents - housed);
  setCard("statBeds",      totalBeds - occupiedBeds);
  setCard("statVacant",    rooms.filter(r=>r.type==="vacant").length + rooms.filter(r=>r.type==="partial").length);
  setCard("statPending",   apps.filter(a=>a.status==="pending").length);
  setCard("statOccRate",   totalBeds > 0 ? Math.round((occupiedBeds/totalBeds)*100)+"%" : "0%");

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
  drawBarChart(ctx, canvas, blocks,
    [{ label:"Occupied", data:blocks.map(b=>rooms.filter(r=>r.block===b).reduce((a,r)=>a+r.occupancy_count,0)), color:"#1e3a5f" },
     { label:"Capacity", data:blocks.map(b=>rooms.filter(r=>r.block===b).reduce((a,r)=>a+r.capacity,0)), color:"#c9a84c" }],
    "Occupancy by Block");
}

function drawProgramChart(students) {
  const canvas = document.getElementById("programChart");
  if (!canvas) return;
  const nursing = students.filter(s=>(s.program||"").toLowerCase().includes("nurs")).length;
  const nutrition = students.filter(s=>(s.program||"").toLowerCase().includes("nutr")).length;
  drawPieChart(canvas.getContext("2d"), canvas, [`Nursing (${nursing})`,`Nutrition (${nutrition})`], [nursing,nutrition], ["#1e3a5f","#c9a84c"]);
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
  const rooms = await fetchRooms();
  renderRoomGrid("roomMapGrid", rooms, async (room) => {
    const { room: r, occupants } = await fetchRoomWithOccupants(room.id);
    const info = document.getElementById("roomInfoPanel");
    if (!info) return;
    info.innerHTML = `
      <button onclick="document.getElementById('roomInfoPanel').classList.remove('open')"
        style="float:right;background:none;border:none;font-size:20px;cursor:pointer;color:var(--gray-400)">×</button>
      <h3>Block ${r.block} – Room ${r.room_number}</h3>
      <p><strong>Capacity:</strong> ${r.capacity} &nbsp; <strong>Occupied:</strong> ${r.occupancy_count}</p>
      <p><strong>Status:</strong> <span class="badge badge-${r.type}">${r.type}</span></p>
      <h4 style="margin-top:1rem">Occupants</h4>
      ${occupants.length===0
        ? "<p style='color:#9ca3af'>No occupants</p>"
        : `<ul>${occupants.map(o=>`<li>${o.full_name||o.name||"—"} (${o.reg_number}) – ${o.program}</li>`).join("")}</ul>`}
    `;
    info.classList.add("open");
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
    const isNursing = (s.program||"").toLowerCase().includes("nurs");
    const roomLabel = s.rooms ? `${s.rooms.block}-${s.rooms.room_number}` : "—";
    return `<tr>
      <td><div class="student-name-cell">
        <div class="student-avatar ${isFemale?"female":""}">${initials}</div>
        <div><div class="student-name-text">${name}</div><div class="student-reg-text">${s.reg_number}</div></div>
      </div></td>
      <td><span class="prog-pill ${isNursing?"nursing":"nutrition"}">${isNursing?"🏥":"🥗"} ${s.program||"—"}</span></td>
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
  if (!confirm("Remove this student's room assignment?")) return;
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
async function loadPublicApps() {
  const { data } = await supabase
    .from("public_applications")
    .select("*")
    .order("created_at", { ascending: false });

  const tbody  = document.getElementById("publicAppsBody");
  const footer = document.getElementById("publicAppsFooter");
  if (!tbody) return;

  const list = data || [];
  if (footer) footer.textContent = `${list.length} application${list.length!==1?"s":""}`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="table-empty">
      <div class="table-empty-icon">📩</div>
      <h4>No public applications yet</h4>
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
              onclick="enrollPublicApplicant('${a.id}','${escHtml(a.full_name)}','${a.reg_number}','${escHtml(a.program||"")}',${a.level||100},'${a.sex||"M"}','${escHtml(a.preferred_room||"")}')">
              ✓ Enrol
            </button>
            <button class="btn-sm btn-danger" onclick="rejectPublicApp('${a.id}')">✕ Reject</button>
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

window.enrollPublicApplicant = async (appId, name, regNumber, program, level, sex, preferredRoom="") => {
  if (!confirm(`Enrol ${name} (${regNumber}) as a student?`)) return;

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
    sex:        s
  }]);

  if (sErr) {
    showToast("Error adding student: " + sErr.message, "error");
    console.error("Enrol error:", sErr);
    return;
  }

  // Create portal account
  const { error: uErr } = await supabase.from("users").insert([{
    username: regNumber, password: "auto", role: "student"
  }]);
  if (uErr) console.warn("User account error:", uErr.message);

  // Update application status
  await supabase.from("public_applications").update({ status: "enrolled" }).eq("id", appId);
  await logAudit(`Enrolled public applicant: ${regNumber}`, ADMIN.username);
  showToast(`${name} enrolled successfully! Find them in All Students to assign a room.`, "success");
  loadPublicApps();
  // Also refresh students cache so they appear immediately in All Students
  window._allStudents = null;
};

window.rejectPublicApp = async (appId) => {
  if (!confirm("Reject this application?")) return;
  await supabase.from("public_applications").update({ status: "rejected" }).eq("id", appId);
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
  const { data: users } = await supabase.from("users").select("id, username, role").order("role");
  const tbody = document.getElementById("usersTableBody");
  if (tbody) {
    tbody.innerHTML = (users||[]).map(u => `<tr>
      <td>${u.username}</td>
      <td>${getRoleBadgeHTML(u.role)}</td>
      <td>${u.id!==ADMIN.id?`<button class="btn-sm btn-danger" onclick="deleteUser('${u.id}','${escHtml(u.username)}')">Delete</button>`:"—"}</td>
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
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────
window.exportData = async (type, format) => {
  const confirmPass = prompt("Enter your admin password to confirm export:");
  if (!confirmPass) return;
  const { data: check } = await supabase.from("users")
    .select("id").eq("username", ADMIN.username).eq("password", confirmPass).limit(1);
  if (!check?.length) { showToast("Invalid password.", "error"); return; }
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
  if (!confirm(`Delete Room ${block}-${roomNum}?`)) return;
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
  if (!confirm(`Remove ${name} from waiting list?`)) return;
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
  `;

  document.getElementById("newYearForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const year = document.getElementById("newYearValue").value.trim();
    const sem  = document.getElementById("newSemesterValue").value;
    await createNewYear(year, sem);
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
    if (confirm(`Assign ${studentName} to Block ${room.block} – Room ${room.room_number}?`)) {
      const result = await assignRoom(studentId, room.id, ADMIN.username);
      if (result.success) {
        showToast(`${studentName} assigned to ${room.block}-${room.room_number}!`, "success");
        loadPublicApps();
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
