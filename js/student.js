/**
 * student.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACE THIS FILE AT: /js/student.js
 *
 * Drives the Student Dashboard (student.html).
 * Sections: My Profile · My Room · Apply · Notices · Facilities
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase, showToast, generateStudentPassword } from "./supabaseClient.js";
import { requireAuth, getSession, logout, initChangePasswordModal } from "./auth.js";
import { fetchRoomWithOccupants } from "./rooms.js";

// ── Guard ─────────────────────────────────────────────────────────────────────
requireAuth("student");
const STUDENT = getSession();

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("studentWelcome").textContent = `Welcome, ${STUDENT.full_name.split(" ")[0]}!`;
  document.getElementById("logoutBtn").addEventListener("click", logout);
  initChangePasswordModal();
  initReportModal();

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", e => {
      // Skip links that go to real pages (href not "#")
      const href = link.getAttribute("href");
      if (href && href !== "#" && !href.startsWith("#")) {
        return; // Let browser navigate normally
      }
      e.preventDefault();
      navigateTo(link.dataset.section);
    });
  });

  navigateTo("profile");

  // Real-time: listen for notice changes
  supabase.channel("notices-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "notices" }, () => {
      const activeSection = document.querySelector(".dash-section:not(.hidden)")?.id;
      if (activeSection === "section-notices") loadNotices();
    })
    .subscribe();
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
    profile:     loadProfile,
    room:        loadRoom,
    apply:       loadApply,
    notices:     loadNotices,
    facilities:  loadFacilities,
    maintenance: loadMyMaintenance,
  };
  if (loaders[section]) loaders[section]();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: MY PROFILE
// ─────────────────────────────────────────────────────────────────────────────

function loadProfile() {
  const fields = {
    "profileName":    STUDENT.full_name,
    "profileReg":     STUDENT.reg_number,
    "profileProgram": STUDENT.program,
    "profileLevel":   `Level ${STUDENT.level}`,
    "profileSex":     STUDENT.sex,
    "profileStatus":  STUDENT.program,
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });

  // Show auto-generated password hint
  const pwHint = document.getElementById("passwordHint");
  if (pwHint) {
    pwHint.textContent = generateStudentPassword(STUDENT.reg_number, STUDENT.full_name);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: MY ROOM
// ─────────────────────────────────────────────────────────────────────────────

async function loadRoom() {
  const panel = document.getElementById("roomPanel");
  if (!panel) return;

  panel.innerHTML = `<p style="color:var(--gray-400);padding:1rem">Loading room details…</p>`;

  try {
    // Always fetch by reg_number — most reliable identifier
    const regNum = STUDENT.reg_number || STUDENT.username;
    let s = null;

    // Try reg_number first
    const { data: byReg } = await supabase
      .from("students")
      .select("id, full_name, room, room_id, rooms:room_id(id, block, room_number, capacity, occupancy_count, type)")
      .eq("reg_number", regNum)
      .single();

    s = byReg;

    // Fallback: try by id if reg_number failed
    if (!s && STUDENT.id) {
      const { data: byId } = await supabase
        .from("students")
        .select("id, full_name, room, room_id, rooms:room_id(id, block, room_number, capacity, occupancy_count, type)")
        .eq("id", STUDENT.id)
        .single();
      s = byId;
    }

    if (!s) throw new Error("Student record not found");

    // Treat NR (Non-Residential) as no room assigned
    const isNR = !s.room_id && (!s.room || s.room === "NR" || s.room === "nr");
    if (isNR) {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏠</div>
          <h3>No Room Assigned</h3>
          <p>You have not been assigned a room yet. Please visit <strong>Apply for Room</strong> to submit a request.</p>
        </div>`;
      return;
    }

    // Has room_id with full room data
    if (s.room_id && s.rooms) {
      const room = s.rooms;

      // Get occupants
      const { data: occupants } = await supabase
        .from("students")
        .select("id, full_name, reg_number, program, level, sex")
        .eq("room_id", s.room_id);

      const roommates = (occupants || []).filter(o => o.id !== s.id && o.id !== STUDENT.id);
      const pct = room.capacity > 0
        ? Math.round((room.occupancy_count / room.capacity) * 100)
        : 0;

      panel.innerHTML = `
        <div class="room-detail-card">
          <div class="room-badge">Block ${room.block}</div>
          <h2 class="room-number-big">Room ${room.room_number}</h2>
          <div class="room-detail-stats">
            <div class="detail-stat">
              <span class="stat-num">${room.occupancy_count}</span>
              <span class="stat-lbl">Occupants</span>
            </div>
            <div class="detail-stat">
              <span class="stat-num">${room.capacity}</span>
              <span class="stat-lbl">Capacity</span>
            </div>
            <div class="detail-stat">
              <span class="stat-num">${pct}%</span>
              <span class="stat-lbl">Full</span>
            </div>
          </div>
          <div class="occupancy-bar-full">
            <div class="occupancy-bar-fill" style="width:${pct}%"></div>
          </div>
          <h3 class="roommates-title">Your Roommates</h3>
          ${roommates.length === 0
            ? `<p class="no-roommates">You are the only occupant in this room.</p>`
            : `<div class="roommate-list">
                ${roommates.map(r => `
                  <div class="roommate-card">
                    <div class="roommate-avatar ${(r.sex||"").toUpperCase()==="F"?"female":""}">
                      ${(r.full_name||"").split(" ").map(w=>w[0]).join("").substring(0,2)}
                    </div>
                    <div>
                      <div class="roommate-name">${r.full_name}</div>
                      <div class="roommate-info">${r.program} · Level ${r.level}</div>
                    </div>
                  </div>`).join("")}
              </div>`}
        </div>`;
      return;
    }

    // Has text room but no room_id — show basic info
    panel.innerHTML = `
      <div class="room-detail-card">
        <div class="room-badge">Assigned Room</div>
        <h2 class="room-number-big">Room ${s.room}</h2>
        <p style="color:var(--gray-400);font-size:14px;margin-top:.5rem">
          Your room number is <strong>${s.room}</strong>. 
          Full room details will appear once your assignment is fully set up.
          Please contact the General Office if you need assistance.
        </p>
      </div>`;

  } catch (err) {
    console.error("loadRoom error:", err);
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Could not load room details</h3>
        <p>Please try refreshing the page or contact the General Office.</p>
      </div>`;
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE REPORTING
// ─────────────────────────────────────────────────────────────────────────────

async function loadMyReports() {
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("*")
    .eq("reported_by", STUDENT.full_name || STUDENT.name)
    .order("created_at", { ascending: false });

  const container = document.getElementById("myReportsList");
  if (!container) return;

  const priorityColors = { urgent: "#ef4444", high: "#f59e0b", normal: "#3b82f6", low: "#22c55e" };
  const statusColors   = { open: "#ef4444", in_progress: "#f59e0b", resolved: "#22c55e", closed: "#9ca3af" };

  if (!data || data.length === 0) {
    container.innerHTML = `<p style="color:var(--gray-400);font-size:13px">You have not reported any issues yet.</p>`;
    return;
  }

  container.innerHTML = data.map(r => `
    <div class="my-report-card">
      <div class="my-report-header">
        <span class="my-report-category">${r.category}</span>
        <span class="my-report-priority" style="color:${priorityColors[r.priority]}">${r.priority.toUpperCase()}</span>
        <span class="my-report-status" style="background:${statusColors[r.status]}20;color:${statusColors[r.status]}">${r.status.replace("_"," ")}</span>
      </div>
      <p class="my-report-desc">${r.description}</p>
      <div class="my-report-meta">
        Reported ${new Date(r.created_at).toLocaleDateString()}
        ${r.assigned_to ? `· Assigned to: ${r.assigned_to}` : ""}
      </div>
    </div>
  `).join("");
}

function initReportModal() {
  const modal = document.getElementById("reportModal");
  if (!modal) return;

  document.getElementById("reportModalClose")?.addEventListener("click", () => {
    modal.classList.remove("open");
  });
  modal.addEventListener("click", e => {
    if (e.target === modal) modal.classList.remove("open");
  });

  document.getElementById("reportForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Submitting…";

    const category    = document.getElementById("reportCategory").value;
    const description = document.getElementById("reportDescription").value;
    const priority    = document.getElementById("reportPriority").value;

    const block     = STUDENT.rooms?.block || (STUDENT.room || "Unknown");
    const roomNum   = STUDENT.rooms?.room_number || (STUDENT.room || "Unknown");

    const payload = {
      block,
      room_number:   roomNum,
      location:      `Block ${block} – ${roomNum}`,
      category,
      description,
      priority,
      status:        "open",
      reported_by:   STUDENT.full_name || STUDENT.name,
      reporter_role: "student",
    };

    const { error } = await supabase.from("maintenance_requests").insert([payload]);

    if (error) {
      showToast("Failed to submit: " + error.message, "error");
      btn.disabled = false; btn.textContent = "Submit Report";
      return;
    }

    showToast("Issue reported successfully! The admin team will review it.", "success");
    modal.classList.remove("open");
    e.target.reset();
    btn.disabled = false; btn.textContent = "Submit Report";
    loadMyReports();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: APPLY FOR ROOM
// ─────────────────────────────────────────────────────────────────────────────

async function loadApply() {
  const container = document.getElementById("applySection");
  if (!container) return;

  // Fetch fresh student data to get latest room_id
  const { data: freshStudent } = await supabase
    .from("students")
    .select("id, full_name, reg_number, program, level, sex, room, room_id")
    .eq("id", STUDENT.id)
    .single();

  const student = freshStudent || STUDENT;

  // Check existing application using reg_number
  const { data: existing } = await supabase
    .from("applications")
    .select("status, submitted_at, preferred_block, notes")
    .eq("reg_number", student.reg_number)
    .order("submitted_at", { ascending: false })
    .limit(1);

  const app = existing?.[0];

  if (app) {
    const statusColors = { pending: "#f59e0b", approved: "#22c55e", rejected: "#ef4444" };
    container.innerHTML = `
      <div class="apply-status-card">
        <div class="apply-icon">${app.status === "approved" ? "✅" : app.status === "rejected" ? "❌" : "⏳"}</div>
        <h3>Application Status</h3>
        <div class="apply-badge" style="background:${statusColors[app.status]};color:#fff;padding:.4rem 1.2rem;border-radius:999px;display:inline-block;font-weight:700;margin:.5rem 0">
          ${app.status.toUpperCase()}
        </div>
        <p style="color:var(--gray-600);margin:.5rem 0">
          Submitted on ${app.submitted_at ? new Date(app.submitted_at).toLocaleDateString() : "—"}
        </p>
        ${app.preferred_block ? `<p style="color:var(--gray-600);font-size:13px">Notes: ${app.preferred_block}</p>` : ""}
        ${app.status === "pending" ? "<p class='apply-note' style='color:#92400e;background:#fef3c7;padding:.7rem 1rem;border-radius:6px;margin-top:.8rem'>⏳ Your application is under review. The General Office will contact you with further instructions.</p>" : ""}
        ${app.status === "approved" ? "<p class='apply-note' style='color:#065f46;background:#d1fae5;padding:.7rem 1rem;border-radius:6px;margin-top:.8rem'>✅ Your application has been approved! Visit the General Office to complete your room assignment.</p>" : ""}
        ${app.status === "rejected" ? "<p class='apply-note' style='color:#991b1b;background:#fee2e2;padding:.7rem 1rem;border-radius:6px;margin-top:.8rem'>❌ Your application was not approved this cycle. Please contact the General Office for more information.</p>" : ""}
      </div>`;
    return;
  }

  // Treat NR as no room — NR students can apply
  const hasRoom = student.room_id || (student.room && student.room !== "NR" && student.room !== "nr");
  if (hasRoom) {
    container.innerHTML = `
      <div class="apply-status-card">
        <div class="apply-icon">🏠</div>
        <h3>You already have a room assigned.</h3>
        <p>Visit the <strong>My Room</strong> tab to see your room details and roommates.</p>
      </div>`;
    return;
  }

  // Load available rooms for preferred room dropdown
  const { data: availRooms } = await supabase
    .from("rooms")
    .select("id, block, room_number, capacity, occupancy_count")
    .not("type", "in", '("full","staff","NSP")')
    .order("block").order("room_number");

  const roomOptions = (availRooms || []).map(r =>
    `<option value="${r.block}-${r.room_number}">Block ${r.block} – Room ${r.room_number} (${r.occupancy_count}/${r.capacity})</option>`
  ).join("");

  container.innerHTML = `
    <div class="apply-form-card">
      <h3>Apply for Campus Accommodation</h3>
      <p style="color:var(--gray-600);margin-bottom:1rem">Fill in the form below. Your application will be reviewed by the General Office.</p>
      <form id="applyForm">
        <div class="form-row">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" value="${student.full_name || ""}" readonly class="input-readonly">
          </div>
          <div class="form-group">
            <label>Registration Number</label>
            <input type="text" value="${student.reg_number || ""}" readonly class="input-readonly">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Programme</label>
            <select id="applyProgram">
              <option value="${student.program || ""}" selected>${student.program || "Select Programme"}</option>
              ${!student.program ? `
              <option value="BSc Nursing">BSc Nursing</option>
              <option value="BSc Nutrition">BSc Nutrition</option>
              <option value="MBChB-COBES">MBChB-COBES</option>
              ` : ""}
            </select>
          </div>
          <div class="form-group">
            <label>Level</label>
            <input type="text" value="Level ${student.level || ""}" readonly class="input-readonly">
          </div>
        </div>
        <div class="form-group">
          <label>Preferred Room (optional)</label>
          <select id="applyPreferredRoom">
            <option value="">No preference</option>
            ${roomOptions}
          </select>
          <small style="color:var(--gray-400)">Subject to availability and admin approval.</small>
        </div>
        <div class="form-group">
          <label>Any special requests or notes (optional)</label>
          <textarea id="applyNotes" rows="3" placeholder="E.g. medical needs, disability requirements…"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-full" style="font-size:15px;padding:.8rem">
          Submit Application
        </button>
      </form>
    </div>`;

  document.getElementById("applyForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    const payload = {
      reg_number:      student.reg_number,
      status:          "pending",
      preferred_block: document.getElementById("applyPreferredRoom")?.value || "",
      notes:           document.getElementById("applyNotes")?.value || "",
      submitted_at:    new Date().toISOString()
    };

    const { error } = await supabase.from("applications").insert([payload]);

    if (error) {
      showToast("Submission failed: " + error.message, "error");
      btn.disabled = false;
      btn.textContent = "Submit Application";
    } else {
      showToast("Application submitted successfully!", "success");
      loadApply();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: NOTICES
// ─────────────────────────────────────────────────────────────────────────────

async function loadNotices() {
  const { data: notices } = await supabase
    .from("notices")
    .select("*")
    .or(`audience.eq.all,audience.eq.${STUDENT.program.toLowerCase()}`)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  const container = document.getElementById("noticesFeed");
  if (!container) return;

  const now = new Date();
  const activeNotices  = (notices || []).filter(n => !n.expiry_date || new Date(n.expiry_date) >= now);
  const expiredNotices = (notices || []).filter(n => n.expiry_date && new Date(n.expiry_date) < now);

  // Filter UI
  const filterVal = document.getElementById("noticeFilter")?.value || "all";

  const renderList = (list) => list
    .filter(n => filterVal === "all" || n.priority === filterVal)
    .map(n => {
      const expired = n.expiry_date && new Date(n.expiry_date) < now;
      return `
      <div class="notice-card priority-${n.priority} ${expired ? 'notice-expired' : ''}">
        <div class="notice-header">
          <span class="notice-title">${n.pinned ? "📌 " : ""}${n.title}</span>
          <span class="notice-badge priority-badge-${n.priority}">${n.priority.toUpperCase()}</span>
        </div>
        <p class="notice-msg">${n.message}</p>
        <div class="notice-meta">
          Posted by ${n.author} · ${new Date(n.created_at).toLocaleDateString()}
          ${n.expiry_date ? `· Expires ${new Date(n.expiry_date).toLocaleDateString()}` : ""}
          ${expired ? "<span class='expired-tag'>EXPIRED</span>" : ""}
        </div>
      </div>`;
    }).join("");

  container.innerHTML = activeNotices.length === 0 && expiredNotices.length === 0
    ? `<div class="empty-state"><div class="empty-icon">📢</div><h3>No notices yet</h3><p>Check back later for updates from the accommodation office.</p></div>`
    : renderList(activeNotices) + (expiredNotices.length > 0 ? `
        <div class="expired-divider">— Expired Notices —</div>
        ${renderList(expiredNotices)}` : "");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("noticeFilter")?.addEventListener("change", () => {
    const activeSection = document.querySelector(".dash-section:not(.hidden)")?.id;
    if (activeSection === "section-notices") loadNotices();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: FACILITIES
// ─────────────────────────────────────────────────────────────────────────────

async function loadFacilities() {
  const container = document.getElementById("facilitiesContent");
  if (!container) return;

  container.innerHTML = `<p style="color:var(--gray-400);padding:1rem">Loading facilities…</p>`;

  const { data: facilities, error } = await supabase
    .from("facilities")
    .select("*")
    .order("block")
    .order("category");

  if (error || !facilities?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏛️</div>
        <h3>No facilities listed yet</h3>
        <p>Check back later or contact the General Office.</p>
      </div>`;
    return;
  }

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

  const statusColors = {
    available:   { color: "#22c55e", label: "Available"   },
    occupied:    { color: "#ef4444", label: "Occupied"    },
    maintenance: { color: "#f59e0b", label: "Maintenance" },
    closed:      { color: "#9ca3af", label: "Closed"      },
  };

  // Group by category
  const grouped = {};
  facilities.forEach(f => {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  });

  container.innerHTML = `
    <div style="margin-bottom:1.2rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
      <p style="color:var(--gray-600);font-size:13px">
        Showing <strong>${facilities.length}</strong> facilities across all blocks.
        Use the portal to report any issues.
      </p>
    </div>
    ${Object.entries(grouped).map(([category, items]) => `
      <div style="margin-bottom:1.5rem">
        <h3 style="font-family:var(--font-display);color:var(--navy);font-size:1rem;margin-bottom:.8rem;padding-bottom:.3rem;border-bottom:2px solid var(--gold);display:inline-block">
          ${icons[category] || "📌"} ${category}
        </h3>
        <div class="facilities-grid">
          ${items.map(f => {
            const sc = statusColors[f.status] || statusColors.available;
            return `
            <div class="facility-card" style="position:relative">
              <div style="position:absolute;top:.7rem;right:.7rem;width:8px;height:8px;border-radius:50%;background:${sc.color}" title="${sc.label}"></div>
              <div class="facility-icon">${icons[f.category] || "📌"}</div>
              <h3>${f.room_number}</h3>
              <p style="color:var(--gray-400);font-size:11px;margin-bottom:.3rem">Block ${f.block}</p>
              <p style="font-size:12px;color:${sc.color};font-weight:700">${sc.label}</p>
              <button class="btn-sm btn-secondary" style="margin-top:.5rem;width:100%"
                onclick="openMaintenanceModal('${f.id}','${f.room_number}','${f.block}','facility')">
                🔧 Report Issue
              </button>
            </div>`;
          }).join("")}
        </div>
      </div>
    `).join("")}
  `;
}





// ─────────────────────────────────────────────────────────────────────────────
// SECTION: REPORT & TRACK MAINTENANCE ISSUES
// ─────────────────────────────────────────────────────────────────────────────

async function loadMyMaintenance() {
  const container = document.getElementById("maintenanceStudentSection");
  if (!container) return;

  // Load student's own reports
  const { data: myReports } = await supabase
    .from("maintenance_requests")
    .select("*")
    .eq("reported_by", STUDENT.full_name || STUDENT.name)
    .order("created_at", { ascending: false });

  const priorityColors = {
    urgent: { bg: "#fee2e2", color: "#991b1b", icon: "🔴" },
    high:   { bg: "#fef3c7", color: "#92400e", icon: "🟠" },
    normal: { bg: "#dbeafe", color: "#1e40af", icon: "🔵" },
    low:    { bg: "#d1fae5", color: "#065f46", icon: "🟢" },
  };

  const statusColors = {
    open:        { bg: "#fee2e2", color: "#991b1b", label: "Open"        },
    in_progress: { bg: "#fef3c7", color: "#92400e", label: "In Progress" },
    resolved:    { bg: "#d1fae5", color: "#065f46", label: "Resolved"    },
    closed:      { bg: "#f3f4f6", color: "#6b7280", label: "Closed"      },
  };

  const reports = myReports || [];

  container.innerHTML = `
    <!-- Report Form -->
    <div class="maint-form-card">
      <h3>🔧 Report a Room or Facility Issue</h3>
      <p>Use this form to report any problems in your room or common areas. Your report will be reviewed by the accommodation office.</p>

      <form id="studentMaintenanceForm">
        <div class="form-row">
          <div class="form-group">
            <label>Location / Area</label>
            <input type="text" id="smLocation" placeholder="e.g. Block NE – Room A3, Common bathroom" required
              value="${STUDENT.room ? `Block – Room ${STUDENT.room}` : ""}">
          </div>
          <div class="form-group">
            <label>Block</label>
            <select id="smBlock" required>
              <option value="">Select block…</option>
              <option value="NE">Block NE</option>
              <option value="N">Block N</option>
              <option value="NW">Block NW</option>
              <option value="ADM">Block ADM</option>
              <option value="S">Block S</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Room / Area Number</label>
            <input type="text" id="smRoomNum" placeholder="e.g. A3, Library, Corridor"
              value="${STUDENT.room || ""}">
          </div>
          <div class="form-group">
            <label>Issue Category</label>
            <select id="smCategory" required>
              <option value="">Select category…</option>
              <option value="electrical">⚡ Electrical</option>
              <option value="plumbing">🚿 Plumbing</option>
              <option value="furniture">🪑 Furniture</option>
              <option value="cleaning">🧹 Cleaning</option>
              <option value="structural">🏗️ Structural</option>
              <option value="other">📌 Other</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Priority</label>
            <select id="smPriority">
              <option value="normal">🔵 Normal</option>
              <option value="high">🟠 High</option>
              <option value="urgent">🔴 Urgent</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>
          <div class="form-group">
            <!-- spacer -->
          </div>
        </div>

        <div class="form-group">
          <label>Description of Issue</label>
          <textarea id="smDescription" rows="4"
            placeholder="Please describe the issue in detail. The more information you provide, the faster it can be resolved…"
            required></textarea>
        </div>

        <button type="submit" class="btn btn-primary btn-full">Submit Report</button>
      </form>
    </div>

    <!-- My Reports -->
    <div class="maint-history-card">
      <h3>📋 My Reported Issues (${reports.length})</h3>
      ${reports.length === 0
        ? `<div class="empty-state">
             <div class="empty-icon">✅</div>
             <h3>No issues reported yet</h3>
             <p>Use the form above to report any problems.</p>
           </div>`
        : reports.map(r => {
            const p = priorityColors[r.priority] || priorityColors.normal;
            const s = statusColors[r.status]   || statusColors.open;
            return `
            <div class="maint-report-card">
              <div class="maint-report-header">
                <div class="maint-report-title">
                  <span class="maint-category-icon">${getCategoryIcon(r.category)}</span>
                  <span>${r.category.charAt(0).toUpperCase() + r.category.slice(1)} Issue</span>
                </div>
                <div style="display:flex;gap:.4rem;align-items:center">
                  <span class="maint-badge" style="background:${p.bg};color:${p.color}">
                    ${p.icon} ${r.priority}
                  </span>
                  <span class="maint-badge" style="background:${s.bg};color:${s.color}">
                    ${s.label}
                  </span>
                </div>
              </div>
              <div class="maint-report-location">📍 Block ${r.block} – ${r.room_number}</div>
              <div class="maint-report-desc">${r.description}</div>
              <div class="maint-report-footer">
                Reported on ${new Date(r.created_at).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric"
                })}
                ${r.assigned_to ? `· Assigned to: <strong>${r.assigned_to}</strong>` : ""}
              </div>
            </div>`;
          }).join("")}
    </div>`;

  // Wire form submit
  document.getElementById("studentMaintenanceForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Submitting…";

    const block   = document.getElementById("smBlock").value;
    const roomNum = document.getElementById("smRoomNum").value.trim() || STUDENT.room || "—";
    const payload = {
      location:     document.getElementById("smLocation").value.trim(),
      block,
      room_number:  roomNum,
      category:     document.getElementById("smCategory").value,
      priority:     document.getElementById("smPriority").value,
      description:  document.getElementById("smDescription").value.trim(),
      status:       "open",
      reported_by:  STUDENT.full_name || STUDENT.name || "Student",
      reporter_role:"student",
    };

    const { error } = await supabase.from("maintenance_requests").insert([payload]);
    if (error) {
      showToast("Failed to submit: " + error.message, "error");
      btn.disabled = false; btn.textContent = "Submit Report";
      return;
    }

    showToast("Issue reported successfully! The accommodation office will review it.", "success");
    e.target.reset();
    btn.disabled = false; btn.textContent = "Submit Report";
    loadMyMaintenance(); // Refresh to show new report
  });
}

function getCategoryIcon(cat) {
  const icons = {
    electrical: "⚡", plumbing: "🚿", furniture: "🪑",
    cleaning: "🧹", structural: "🏗️", other: "📌"
  };
  return icons[cat] || "📌";
}

async function loadNoticeCount() {
  const { count } = await supabase
    .from("notices")
    .select("*", { count: "exact", head: true })
    .or("audience.eq.all,audience.eq." + (STUDENT.program || "").toLowerCase());
  
  const badge = document.getElementById("noticeBadge");
  if (badge && count > 0) {
    badge.textContent = count;
    badge.style.display = "inline-block";
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION: REPORT ISSUE (Student Maintenance)
// ─────────────────────────────────────────────────────────────────────────────

async function loadMaintenanceStudent() {
  const container = document.getElementById("maintenanceStudentSection");
  if (!container) return;

  // Fetch student's own reports
  const { data: reports } = await supabase
    .from("maintenance_requests")
    .select("*")
    .eq("reported_by", STUDENT.full_name || STUDENT.name)
    .order("created_at", { ascending: false });

  const priorityColors = {
    urgent: { bg: "#fee2e2", color: "#991b1b", label: "🔴 Urgent" },
    high:   { bg: "#fef3c7", color: "#92400e", label: "🟡 High"   },
    normal: { bg: "#dbeafe", color: "#1e40af", label: "🔵 Normal" },
    low:    { bg: "#d1fae5", color: "#065f46", label: "🟢 Low"    },
  };
  const statusColors = {
    open:        { bg: "#fee2e2", color: "#991b1b", label: "Open"        },
    in_progress: { bg: "#fef3c7", color: "#92400e", label: "In Progress" },
    resolved:    { bg: "#d1fae5", color: "#065f46", label: "Resolved"    },
    closed:      { bg: "#f3f4f6", color: "#6b7280", label: "Closed"      },
  };

  container.innerHTML = `
    <!-- Report Form -->
    <div class="maint-form-card">
      <h3>🔧 Report a Room or Facility Issue</h3>
      <p>Use this form to report any maintenance issues in your room or around the campus.</p>

      <form id="studentMaintenanceForm">
        <div class="form-row">
          <div class="form-group">
            <label>Block</label>
            <select id="smBlock" required>
              <option value="">Select Block</option>
              <option value="NE">Block NE</option>
              <option value="N">Block N</option>
              <option value="NW">Block NW</option>
              <option value="ADM">Block ADM</option>
              <option value="S">Block S</option>
            </select>
          </div>
          <div class="form-group">
            <label>Room / Area</label>
            <input type="text" id="smRoom" placeholder="e.g. A3, Library, Corridor" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Issue Category</label>
            <select id="smCategory" required>
              <option value="">Select Category</option>
              <option value="electrical">⚡ Electrical</option>
              <option value="plumbing">🚿 Plumbing</option>
              <option value="furniture">🪑 Furniture</option>
              <option value="cleaning">🧹 Cleaning</option>
              <option value="structural">🏗️ Structural</option>
              <option value="other">📌 Other</option>
            </select>
          </div>
          <div class="form-group">
            <label>Priority</label>
            <select id="smPriority" required>
              <option value="normal">🔵 Normal</option>
              <option value="high">🟡 High</option>
              <option value="urgent">🔴 Urgent</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="smDescription" rows="4" 
            placeholder="Describe the issue in detail — what is wrong, where exactly, how long it has been happening…" 
            required></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-full">Submit Report</button>
      </form>
    </div>

    <!-- My Reports -->
    <div class="maint-reports-card">
      <h3>📋 My Submitted Reports</h3>
      ${!reports || reports.length === 0
        ? `<div class="empty-state">
             <div class="empty-icon">✅</div>
             <h3>No reports yet</h3>
             <p>You have not submitted any maintenance reports.</p>
           </div>`
        : reports.map(r => `
          <div class="maint-report-item">
            <div class="maint-report-header">
              <span class="maint-report-location">📍 Block ${r.block} – ${r.room_number}</span>
              <div style="display:flex;gap:.4rem">
                <span class="mini-badge" style="background:${priorityColors[r.priority]?.bg};color:${priorityColors[r.priority]?.color}">
                  ${priorityColors[r.priority]?.label || r.priority}
                </span>
                <span class="mini-badge" style="background:${statusColors[r.status]?.bg};color:${statusColors[r.status]?.color}">
                  ${statusColors[r.status]?.label || r.status}
                </span>
              </div>
            </div>
            <div class="maint-report-cat">Category: <strong>${r.category}</strong></div>
            <div class="maint-report-desc">${r.description}</div>
            <div class="maint-report-date">Submitted: ${new Date(r.created_at).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}</div>
            ${r.status === "resolved" ? `<div class="maint-resolved-note">✅ This issue has been resolved by the maintenance team.</div>` : ""}
          </div>`).join("")}
    </div>`;

  // Wire form submit
  document.getElementById("studentMaintenanceForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    const block       = document.getElementById("smBlock").value;
    const room        = document.getElementById("smRoom").value;
    const category    = document.getElementById("smCategory").value;
    const priority    = document.getElementById("smPriority").value;
    const description = document.getElementById("smDescription").value;

    const { error } = await supabase.from("maintenance_requests").insert([{
      block,
      room_number:   room,
      location:      `Block ${block} – ${room}`,
      category,
      priority,
      description,
      status:        "open",
      reported_by:   STUDENT.full_name || STUDENT.name || STUDENT.reg_number,
      reporter_role: "student",
    }]);

    if (error) {
      showToast("Failed to submit: " + error.message, "error");
      btn.disabled = false;
      btn.textContent = "Submit Report";
      return;
    }

    showToast("Report submitted successfully! The maintenance team will attend to it.", "success");
    e.target.reset();
    btn.disabled = false;
    btn.textContent = "Submit Report";
    loadMaintenanceStudent(); // Refresh to show new report
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT DASHBOARD HOME (#14)
// ─────────────────────────────────────────────────────────────────────────────
async function loadStudentDashboard() {
  const panel = document.getElementById("studentDashboard");
  if (!panel) return;

  const [roomRes, appsRes, noticesRes, mainRes] = await Promise.all([
    supabase.from("students").select("room, room_id, rooms:room_id(block, room_number)").eq("id", STUDENT.id).single(),
    supabase.from("applications").select("status, submitted_at").eq("reg_number", STUDENT.reg_number).order("submitted_at", {ascending:false}).limit(1),
    supabase.from("notices").select("id, title, priority, created_at").order("pinned", {ascending:false}).order("created_at", {ascending:false}).limit(3),
    supabase.from("maintenance_requests").select("id, category, status, created_at").eq("reported_by", STUDENT.reg_number).order("created_at", {ascending:false}).limit(3)
  ]);

  const s       = roomRes.data;
  const app     = appsRes.data?.[0];
  const notices = noticesRes.data || [];
  const issues  = mainRes.data || [];

  const roomLabel = s?.rooms ? `Block ${s.rooms.block} – Room ${s.rooms.room_number}` : (s?.room || "Not assigned");
  const appStatus = app ? `<span style="color:${app.status==='approved'?'#22c55e':app.status==='rejected'?'#ef4444':'#f59e0b'};font-weight:700">${app.status.toUpperCase()}</span>` : "No application";

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem">
      <div class="stat-card" style="border-left:4px solid var(--navy)">
        <div class="stat-card-icon">🏠</div>
        <div class="stat-card-value" style="font-size:1rem">${roomLabel}</div>
        <div class="stat-card-label">Your Room</div>
      </div>
      <div class="stat-card" style="border-left:4px solid var(--gold)">
        <div class="stat-card-icon">📋</div>
        <div class="stat-card-value" style="font-size:1rem">${appStatus}</div>
        <div class="stat-card-label">Application Status</div>
      </div>
      <div class="stat-card" style="border-left:4px solid #22c55e">
        <div class="stat-card-icon">📢</div>
        <div class="stat-card-value">${notices.length}</div>
        <div class="stat-card-label">New Notices</div>
      </div>
      <div class="stat-card" style="border-left:4px solid #ef4444">
        <div class="stat-card-icon">🔧</div>
        <div class="stat-card-value">${issues.filter(i=>i.status==='open').length}</div>
        <div class="stat-card-label">Open Issues</div>
      </div>
    </div>

    ${notices.length ? `
    <div style="margin-bottom:1.5rem">
      <h3 style="font-family:var(--font-display);color:var(--navy);margin-bottom:.7rem">📢 Latest Notices</h3>
      ${notices.map(n => `
        <div style="padding:.7rem 1rem;background:var(--white);border-radius:6px;border-left:3px solid ${n.priority==='urgent'?'#ef4444':n.priority==='info'?'#3b82f6':'#c9a84c'};margin-bottom:.5rem;box-shadow:var(--shadow-sm)">
          <strong style="font-size:13px">${n.title}</strong>
          <span style="font-size:11px;color:var(--gray-400);float:right">${new Date(n.created_at).toLocaleDateString()}</span>
        </div>
      `).join("")}
    </div>` : ""}

    ${issues.length ? `
    <div>
      <h3 style="font-family:var(--font-display);color:var(--navy);margin-bottom:.7rem">🔧 Your Maintenance Reports</h3>
      ${issues.map(i => `
        <div style="padding:.7rem 1rem;background:var(--white);border-radius:6px;margin-bottom:.5rem;box-shadow:var(--shadow-sm);display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;text-transform:capitalize">${i.category}</span>
          <span style="font-size:11px;padding:.2rem .6rem;border-radius:999px;background:${i.status==='resolved'?'#d1fae5':i.status==='in_progress'?'#fef3c7':'#fee2e2'};color:${i.status==='resolved'?'#065f46':i.status==='in_progress'?'#92400e':'#991b1b'}">${i.status.replace("_"," ")}</span>
        </div>
      `).join("")}
    </div>` : ""}
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE STATUS TRACKING (#9)
// ─────────────────────────────────────────────────────────────────────────────
async function loadMyIssues() {
  const panel = document.getElementById("myIssuesPanel");
  if (!panel) return;

  const { data: issues } = await supabase
    .from("maintenance_requests")
    .select("id, category, description, status, priority, created_at, location")
    .eq("reported_by", STUDENT.reg_number)
    .order("created_at", { ascending: false });

  if (!issues?.length) {
    panel.innerHTML = `<div class="table-empty"><div class="table-empty-icon">🔧</div><h4>No issues reported yet</h4><p>Use the Report Issue button to report problems in your room.</p></div>`;
    return;
  }

  const statusColors = {
    open:        { bg: "#fee2e2", color: "#991b1b", label: "Open" },
    in_progress: { bg: "#fef3c7", color: "#92400e", label: "In Progress" },
    resolved:    { bg: "#d1fae5", color: "#065f46", label: "Resolved" },
    closed:      { bg: "#f3f4f6", color: "#6b7280", label: "Closed" }
  };

  panel.innerHTML = issues.map(i => {
    const sc = statusColors[i.status] || statusColors.open;
    return `
    <div style="background:var(--white);border-radius:var(--radius);padding:1rem;margin-bottom:.8rem;box-shadow:var(--shadow-sm);border-left:4px solid ${sc.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <strong style="text-transform:capitalize;color:var(--navy)">${i.category} Issue</strong>
          <p style="color:var(--gray-600);font-size:13px;margin:.3rem 0">${i.description}</p>
          <small style="color:var(--gray-400)">${i.location} · ${new Date(i.created_at).toLocaleDateString()}</small>
        </div>
        <span style="background:${sc.bg};color:${sc.color};padding:.2rem .7rem;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;margin-left:1rem">${sc.label}</span>
      </div>
    </div>`;
  }).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// WAITING LIST — student join (#12)
// ─────────────────────────────────────────────────────────────────────────────
async function joinWaitingList() {
  const { data: existing } = await supabase
    .from("waiting_list")
    .select("id, status")
    .eq("reg_number", STUDENT.reg_number)
    .eq("status", "waiting")
    .limit(1);

  if (existing?.length) {
    showToast("You are already on the waiting list!", "info");
    return;
  }

  const { error } = await supabase.from("waiting_list").insert([{
    student_id: STUDENT.id,
    reg_number: STUDENT.reg_number,
    full_name:  STUDENT.full_name || STUDENT.name,
    program:    STUDENT.program,
    level:      STUDENT.level,
    sex:        STUDENT.sex,
    notes:      "Student requested to join waiting list via portal",
    status:     "waiting"
  }]);

  if (error) { showToast("Error: " + error.message, "error"); return; }
  showToast("You have been added to the waiting list! We will notify you when a room becomes available.", "success");
}
