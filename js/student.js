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
import { requireAuth, getSession, logout } from "./auth.js";
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

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", e => {
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
    profile:    loadProfile,
    room:       loadRoom,
    apply:      loadApply,
    notices:    loadNotices,
    facilities: loadFacilities,
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

  if (!STUDENT.room) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏠</div>
        <h3>No Room Assigned</h3>
        <p>You have not been assigned a room yet. Please visit the <strong>Apply</strong> section to submit a request.</p>
      </div>`;
    return;
  }

  const { room, occupants } = await fetchRoomWithOccupants(STUDENT.room);
  if (!room) { panel.innerHTML = "<p>Room details unavailable.</p>"; return; }

  const pct = room.capacity > 0
    ? Math.round((room.occupancy_count / room.capacity) * 100)
    : 0;

  const roommates = occupants.filter(o => o.id !== STUDENT.id);

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
                <div class="roommate-avatar">${r.full_name.split(" ").map(w=>w[0]).join("").substring(0,2)}</div>
                <div>
                  <div class="roommate-name">${r.full_name}</div>
                  <div class="roommate-info">${r.program} · Level ${r.level}</div>
                </div>
              </div>`).join("")}
          </div>`}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: APPLY FOR ROOM
// ─────────────────────────────────────────────────────────────────────────────

async function loadApply() {
  const container = document.getElementById("applySection");
  if (!container) return;

  // Check existing application
  const { data: existing } = await supabase
    .from("applications")
    .select("status, created_at")
    .eq("student_id", STUDENT.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const app = existing?.[0];

  if (app) {
    const statusColors = { pending: "#f59e0b", approved: "#22c55e", rejected: "#ef4444" };
    container.innerHTML = `
      <div class="apply-status-card">
        <div class="apply-icon">${app.status === "approved" ? "✓" : app.status === "rejected" ? "✕" : "⏳"}</div>
        <h3>Application Status</h3>
        <div class="apply-badge" style="background:${statusColors[app.status]}">
          ${app.status.toUpperCase()}
        </div>
        <p>Submitted on ${new Date(app.created_at).toLocaleDateString()}</p>
        ${app.status === "pending" ? "<p class='apply-note'>Your application is under review. You will be notified once a decision is made.</p>" : ""}
        ${app.status === "rejected" ? "<p class='apply-note'>Your application was not approved this cycle. Please contact the accommodation office for more information.</p>" : ""}
      </div>`;
    return;
  }

  // No existing application — show form
  if (STUDENT.room) {
    container.innerHTML = `
      <div class="apply-status-card">
        <div class="apply-icon">🏠</div>
        <h3>You already have a room assigned.</h3>
        <p>Visit the <strong>My Room</strong> tab to see your room details.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="apply-form-card">
      <h3>Apply for Campus Accommodation</h3>
      <p>Submit your application below. Applications are reviewed by the accommodation office.</p>
      <form id="applyForm">
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" value="${STUDENT.full_name}" readonly class="input-readonly">
        </div>
        <div class="form-group">
          <label>Registration Number</label>
          <input type="text" value="${STUDENT.reg_number}" readonly class="input-readonly">
        </div>
        <div class="form-group">
          <label>Programme</label>
          <input type="text" value="${STUDENT.program}" readonly class="input-readonly">
        </div>
        <div class="form-group">
          <label>Level</label>
          <input type="text" value="Level ${STUDENT.level}" readonly class="input-readonly">
        </div>
        <div class="form-group">
          <label>Any special requests or notes (optional)</label>
          <textarea id="applyNotes" rows="3" placeholder="E.g. medical needs, preferred block..."></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-full">Submit Application</button>
      </form>
    </div>`;

  document.getElementById("applyForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    const { error } = await supabase.from("applications").insert([{
      student_id: STUDENT.id,
      status:     "pending",
      created_at: new Date().toISOString()
    }]);

    if (error) {
      showToast("Submission failed: " + error.message, "error");
      btn.disabled = false;
      btn.textContent = "Submit Application";
    } else {
      showToast("Application submitted successfully!", "success");
      loadApply(); // Refresh to show status
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

function loadFacilities() {
  const container = document.getElementById("facilitiesContent");
  if (!container) return;

  container.innerHTML = `
    <div class="facilities-grid">
      <div class="facility-card">
        <div class="facility-icon">🍽️</div>
        <h3>Dining Hall</h3>
        <p>Breakfast: 6:30 – 8:00 AM<br>Lunch: 12:00 – 1:30 PM<br>Dinner: 6:00 – 7:30 PM</p>
      </div>
      <div class="facility-card">
        <div class="facility-icon">📚</div>
        <h3>Library</h3>
        <p>Mon – Fri: 7:00 AM – 10:00 PM<br>Sat: 8:00 AM – 6:00 PM<br>Sun: Closed</p>
      </div>
      <div class="facility-card">
        <div class="facility-icon">💊</div>
        <h3>Clinic</h3>
        <p>Mon – Fri: 8:00 AM – 5:00 PM<br>Emergency: 24/7<br>Tel: +233-xxx-xxxx</p>
      </div>
      <div class="facility-card">
        <div class="facility-icon">⚽</div>
        <h3>Sports Complex</h3>
        <p>Daily: 5:00 AM – 9:00 PM<br>Includes football, basketball, tennis, and gym.</p>
      </div>
      <div class="facility-card">
        <div class="facility-icon">🌐</div>
        <h3>Computer Lab</h3>
        <p>Mon – Sat: 8:00 AM – 8:00 PM<br>Free Wi-Fi in all blocks<br>Printing available</p>
      </div>
      <div class="facility-card">
        <div class="facility-icon">🚌</div>
        <h3>Transport</h3>
        <p>Shuttle to main campus: 7:00, 9:00, 12:00, 3:00, 5:00 PM<br>See notice board for updates.</p>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERRIDE: Replace static facilities with real data + maintenance reporting
// ─────────────────────────────────────────────────────────────────────────────
import {
  loadFacilitiesList, initMaintenanceModal
} from "./facilities.js";

// Re-wire facilities section to use real data
document.addEventListener("DOMContentLoaded", () => {
  initMaintenanceModal();
});

// Override the static loadFacilities function defined earlier
window._loadRealFacilities = () => {
  loadFacilitiesList("facilitiesContent");
};
