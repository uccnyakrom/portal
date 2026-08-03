/**
 * admin_students.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACE THIS FILE AT: /js/admin_students.js
 *
 * Handles all student management in the admin dashboard:
 *   • Add new student
 *   • Edit student details
 *   • Delete student
 *   • Enrol student for portal access
 *   • Bulk enrol all students
 *   • Assign / change / remove room
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase, showToast, logAudit, generateStudentPassword, sendApplicationEmail, callEdgeFunction, appConfirm } from "./supabaseClient.js";
import { populateProgramSelect, programmePillHTML, fetchActiveProgrammes } from "./programmes.js";
import { getSession } from "./auth.js";
import { fetchAvailableRooms, assignRoom, removeRoomAssignment } from "./rooms.js";

const ADMIN = getSession();

// ─────────────────────────────────────────────────────────────────────────────
// VIEW AS STUDENT (admin preview / impersonation)
// Clicking a student's name opens their portal in a new tab. The new tab
// inherits a copy of sessionStorage, so we briefly swap in a student session,
// open the tab, then restore the admin session in this tab.
// ─────────────────────────────────────────────────────────────────────────────
window.viewAsStudent = async (studentId) => {
  const { data: s, error } = await supabase
    .from("students").select("*").eq("id", studentId).single();
  if (error || !s) { showToast("Could not load student record.", "error"); return; }

  const adminSessionRaw = sessionStorage.getItem("portalUser");

  const studentSession = JSON.stringify({
    ...s,
    role: "student",
    type: "student",
    impersonated_by: ADMIN?.username || "admin",
  });

  sessionStorage.setItem("portalUser", studentSession);
  const win = window.open("student.html", "_blank");
  // Restore the admin session in THIS tab (the new tab keeps its copy)
  if (adminSessionRaw) sessionStorage.setItem("portalUser", adminSessionRaw);
  else sessionStorage.removeItem("portalUser");

  if (!win) {
    showToast("Pop-up blocked — please allow pop-ups for this site.", "warning");
    return;
  }
  logAudit(`Opened student portal preview for ${s.reg_number}`, ADMIN?.username || "admin");
};

// ─────────────────────────────────────────────────────────────────────────────
// LOAD STUDENTS TABLE
// ─────────────────────────────────────────────────────────────────────────────

let _programmesForPills = [];

export async function loadStudents() {
  const { data, error } = await supabase
    .from("students")
    .select("*, rooms(block, room_number)")
    .order("full_name");

  if (error) { showToast("Error loading students: " + error.message, "error"); return; }

  _programmesForPills = await fetchActiveProgrammes();
  const filterProgEl = document.getElementById("filterProgram");
  const currentFilterProg = filterProgEl?.value || "";
  populateProgramSelect(filterProgEl, { includeBlank: true, blankLabel: "All Programmes", selectedValue: currentFilterProg });
  window._allStudents = data || [];
  renderStudentTable(window._allStudents);
  bindStudentFilters();
}

function renderStudentTable(students) {
  const tbody = document.getElementById("studentTableBody");
  const footer = document.getElementById("studentTableFooter");
  if (!tbody) return;

  if (students.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="table-empty">
          <div class="table-empty-icon">🎓</div>
          <h4>No students found</h4>
          <p>Try adjusting your filters or add a new student.</p>
        </div>
      </td></tr>`;
    if (footer) footer.textContent = "0 students";
    return;
  }

  tbody.innerHTML = students.map(s => {
    const name     = s.full_name || s.name || "—";
    const initials = name.split(" ").map(w => w[0]).join("").substring(0,2).toUpperCase();
    const isFemale = (s.sex || "").toUpperCase() === "F";
    const roomAssigned = s.rooms ? `${s.rooms.block}-${s.rooms.room_number}` : null;

    return `
    <tr>
      <td>
        <div class="student-name-cell">
          <div class="student-avatar ${isFemale ? "female" : ""}">${initials}</div>
          <div>
            <div class="student-name-text student-name-link" onclick="viewAsStudent('${s.id}')"
                 title="Open this student's portal (admin preview)">${name}</div>
            <div class="student-reg-text">${s.reg_number}</div>
          </div>
        </div>
      </td>
      <td>${programmePillHTML(s.program, _programmesForPills)}</td>
      <td><span class="level-badge">Level ${s.level || "—"}</span></td>
      <td>
        <span class="sex-indicator ${isFemale ? "female" : "male"}">
          ${isFemale ? "♀ Female" : "♂ Male"}
        </span>
      </td>
      <td>
        ${roomAssigned
          ? `<span class="room-cell assigned">🏠 ${roomAssigned}</span>`
          : `<span class="room-cell unassigned">Not assigned</span>`}
      </td>
      <td>
        <span class="enrol-badge not-enrolled" id="enrol-${s.id}">
          ⏳ Checking
        </span>
      </td>
      <td>
        <div class="table-actions">
          <button class="btn-sm btn-primary"   onclick="openEditStudentModal('${s.id}')">✏️ Edit</button>
          <button class="btn-sm btn-secondary" onclick="openAssignRoomModal('${s.id}','${escHtml(name)}')">🏠 Room</button>
          ${window._canEnrol !== false ? `<button class="btn-sm btn-gold" onclick="enrolStudent('${s.id}','${s.reg_number}','${escHtml(name)}')">🔑 Enrol</button>` : ""}
          <button class="btn-sm btn-danger"    onclick="deleteStudent('${s.id}','${escHtml(name)}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  if (footer) footer.textContent = `${students.length} student${students.length !== 1 ? "s" : ""}`;
  checkEnrolmentStatus(students);
}

async function checkEnrolmentStatus(students) {
  const regNumbers = students.map(s => s.reg_number);
  const result = await callEdgeFunction("account-manager", {
    action: "list_enrolled_usernames",
    regNumbers,
  });

  const enrolledSet = new Set(result.usernames || []);

  students.forEach(s => {
    const el = document.getElementById(`enrol-${s.id}`);
    if (!el) return;
    if (enrolledSet.has(s.reg_number)) {
      el.className = "enrol-badge enrolled";
      el.innerHTML = "✓ Enrolled";
    } else {
      el.className = "enrol-badge not-enrolled";
      el.innerHTML = "✕ Not Enrolled";
    }
  });
}

function bindStudentFilters() {
  const applyFilter = () => {
    const prog   = document.getElementById("filterProgram")?.value || "";
    const level  = document.getElementById("filterLevel")?.value   || "";
    const sex    = document.getElementById("filterSex")?.value     || "";
    const room   = document.getElementById("filterRoomStatus")?.value || "";
    const search = (document.getElementById("filterSearch")?.value || "").toLowerCase().trim();

    const filtered = (window._allStudents || []).filter(s => {
      const name = (s.full_name || s.name || "").toLowerCase();
      const reg  = (s.reg_number || "").toLowerCase();
      const prog_val = (s.program || "").toLowerCase();
      const room_label = s.rooms ? `${s.rooms.block}-${s.rooms.room_number}`.toLowerCase() : "";

      const matchSearch = !search || 
        name.includes(search) || 
        reg.includes(search) ||
        prog_val.includes(search) ||
        room_label.includes(search);

      const matchProg  = !prog  || s.program === prog;
      const matchLevel = !level || String(s.level) === level;
      const matchSex   = !sex   || s.sex === sex;
      const matchRoom  = !room  || 
        (room === "assigned"   &&  s.room_id) ||
        (room === "unassigned" && !s.room_id);

      return matchSearch && matchProg && matchLevel && matchSex && matchRoom;
    });

    // Update count
    const footer = document.getElementById("studentTableFooter");
    if (footer) footer.textContent = `${filtered.length} of ${(window._allStudents||[]).length} students`;

    renderStudentTable(filtered);
  };

  ["filterProgram","filterLevel","filterSex","filterSearch","filterRoomStatus"]
    .forEach(id => document.getElementById(id)?.addEventListener("input", applyFilter));

  // Clear filters button
  document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
    ["filterProgram","filterLevel","filterSex","filterSearch","filterRoomStatus"]
      .forEach(id => { const el = document.getElementById(id); if(el) el.value=""; });
    applyFilter();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD STUDENT
// ─────────────────────────────────────────────────────────────────────────────

export function initAddStudentModal() {
  document.getElementById("addStudentForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Adding…";

    const payload = {
      full_name:  document.getElementById("addName").value.trim(),
      reg_number: document.getElementById("addReg").value.trim().toUpperCase(),
      program:    document.getElementById("addProgram").value,
      level:      parseInt(document.getElementById("addLevel").value),
      sex:        document.getElementById("addSex").value,
      room:       document.getElementById("addRoom").value.trim() || null,
      email:      document.getElementById("addEmail")?.value.trim() || null,
    };

    // Check reg_number doesn't already exist
    const { data: existing } = await supabase
      .from("students")
      .select("id")
      .eq("reg_number", payload.reg_number)
      .limit(1);

    if (existing?.length > 0) {
      showToast("A student with this registration number already exists.", "error");
      btn.disabled = false; btn.textContent = "Add Student";
      return;
    }

    const { error } = await supabase.from("students").insert([payload]);
    if (error) {
      showToast("Error: " + error.message, "error");
      btn.disabled = false; btn.textContent = "Add Student";
      return;
    }

    await logAudit(`Added student: ${payload.reg_number}`, ADMIN?.username);
    showToast(`Student ${payload.full_name} added successfully!`, "success");
    document.getElementById("addStudentModal").classList.remove("open");
    e.target.reset();
    btn.disabled = false; btn.textContent = "Add Student";
    loadStudents();
  });

  document.getElementById("addStudentModalClose")?.addEventListener("click", () => {
    document.getElementById("addStudentModal").classList.remove("open");
  });

  document.getElementById("openAddStudentBtn")?.addEventListener("click", () => {
    populateProgramSelect(document.getElementById("addProgram"), { includeBlank: true, blankLabel: "Select…" });
    document.getElementById("addStudentModal").classList.add("open");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT STUDENT
// ─────────────────────────────────────────────────────────────────────────────

window.openEditStudentModal = async (studentId) => {
  const { data: s } = await supabase
    .from("students").select("*").eq("id", studentId).single();
  if (!s) { showToast("Student not found.", "error"); return; }

  document.getElementById("editStudentId").value        = s.id;
  document.getElementById("editName").value             = s.full_name || s.name || "";
  document.getElementById("editReg").value              = s.reg_number;
  await populateProgramSelect(document.getElementById("editProgram"), { selectedValue: s.program || "" });
  document.getElementById("editLevel").value            = s.level || "";
  document.getElementById("editSex").value              = s.sex || "";
  document.getElementById("editRoom").value             = s.room || "";
  document.getElementById("editEmail").value            = s.email || "";

  // Show auto-generated password
  const pwd = generateStudentPassword(s.reg_number, s.full_name || s.name || "");
  document.getElementById("editPasswordDisplay").textContent = pwd;

  document.getElementById("editStudentModal").classList.add("open");
};

export function initEditStudentModal() {
  document.getElementById("editStudentForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";

    const id = document.getElementById("editStudentId").value;
    const payload = {
      full_name:  document.getElementById("editName").value.trim(),
      reg_number: document.getElementById("editReg").value.trim().toUpperCase(),
      program:    document.getElementById("editProgram").value,
      level:      parseInt(document.getElementById("editLevel").value),
      sex:        document.getElementById("editSex").value,
      room:       document.getElementById("editRoom").value.trim() || null,
      email:      document.getElementById("editEmail").value.trim() || null,
    };

    const { error } = await supabase.from("students").update(payload).eq("id", id);
    if (error) {
      showToast("Error: " + error.message, "error");
      btn.disabled = false; btn.textContent = "Save Changes";
      return;
    }

    await logAudit(`Edited student: ${payload.reg_number}`, ADMIN?.username);
    showToast("Student updated successfully!", "success");
    document.getElementById("editStudentModal").classList.remove("open");
    btn.disabled = false; btn.textContent = "Save Changes";
    loadStudents();
  });

  document.getElementById("editStudentModalClose")?.addEventListener("click", () => {
    document.getElementById("editStudentModal").classList.remove("open");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE STUDENT
// ─────────────────────────────────────────────────────────────────────────────

window.deleteStudent = async (studentId, name) => {
  if (!await appConfirm(`Are you sure you want to delete ${name}? This cannot be undone.`)) return;

  const { error } = await supabase.from("students").delete().eq("id", studentId);
  if (error) { showToast("Error: " + error.message, "error"); return; }

  await logAudit(`Deleted student: ${name}`, ADMIN?.username);
  showToast(`${name} deleted.`, "success");
  loadStudents();
};

// ─────────────────────────────────────────────────────────────────────────────
// ENROL STUDENT (grant portal access)
// ─────────────────────────────────────────────────────────────────────────────

window.enrolStudent = async (studentId, regNumber, name) => {
  // Check enrolment permission
  if (window._canEnrol === false) {
    showToast("You do not have permission to enrol students. Please contact the Administrator.", "error");
    return;
  }

  const result = await callEdgeFunction("account-manager", {
    action: "enrol_student",
    token: ADMIN?.token,
    regNumber,
  });

  if (!result.success) { showToast(result.error || "Enrolment failed.", "error"); return; }

  showToast(`${name} enrolled successfully! They can now log in.`, "success");
  loadStudents(); // Refresh to update enrolment status
};

// ─────────────────────────────────────────────────────────────────────────────
// BULK ENROL ALL STUDENTS
// ─────────────────────────────────────────────────────────────────────────────

export async function bulkEnrolAll() {
  if (!await appConfirm("This will enrol ALL students who are not yet enrolled. Continue?")) return;

  const result = await callEdgeFunction("account-manager", {
    action: "bulk_enrol",
    token: ADMIN?.token,
  });

  if (!result.success) { showToast(result.error || "Bulk enrolment failed.", "error"); return; }

  if (result.count === 0) {
    showToast("All students are already enrolled!", "info");
    return;
  }

  showToast(`${result.count} students enrolled successfully!`, "success");
  loadStudents();
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGN ROOM MODAL
// ─────────────────────────────────────────────────────────────────────────────

window.openAssignRoomModal = async (studentId, studentName) => {
  const rooms = await fetchAvailableRooms();
  const select = document.getElementById("assignRoomSelect");
  select.innerHTML = `<option value="">— Select Room —</option>` +
    rooms.map(r =>
      `<option value="${r.id}">Block ${r.block} – ${r.room_number} (${r.occupancy_count}/${r.capacity} – ${r.type})</option>`
    ).join("");

  document.getElementById("assignStudentId").value          = studentId;
  document.getElementById("assignStudentName").textContent  = studentName;
  document.getElementById("assignModal").classList.add("open");
};

export function initAssignRoomModal() {
  document.getElementById("assignForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const studentId = document.getElementById("assignStudentId").value;
    const roomId    = document.getElementById("assignRoomSelect").value;
    if (!roomId) { showToast("Please select a room.", "warning"); return; }

    const result = await assignRoom(studentId, roomId, ADMIN?.username);
    if (result.success) {
      showToast("Room assigned successfully!", "success");
      document.getElementById("assignModal").classList.remove("open");
      loadStudents();

      // ── Notify the student by email that a room has been assigned ──
      try {
        const [{ data: student }, { data: room }] = await Promise.all([
          supabase.from("students").select("full_name, reg_number, email").eq("id", studentId).single(),
          supabase.from("rooms").select("block, room_number").eq("id", roomId).single(),
        ]);
        if (student?.email) {
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
        } else {
          showToast("Room assigned. No email on file for this student.", "info");
        }
      } catch (err) { console.error("Assign email error:", err); }

    } else {
      showToast(result.error, "error");
    }
  });

  document.getElementById("assignModalClose")?.addEventListener("click", () => {
    document.getElementById("assignModal").classList.remove("open");
  });
}

window.removeRoom = async (studentId) => {
  if (!await appConfirm("Remove this student's room assignment?")) return;
  const result = await removeRoomAssignment(studentId, ADMIN?.username);
  if (result.success) { showToast("Room removed.", "success"); loadStudents(); }
  else showToast(result.error, "error");
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK UPLOAD STUDENTS (#2)
// ─────────────────────────────────────────────────────────────────────────────

export async function initBulkUpload() {
  const input = document.getElementById("bulkUploadInput");
  const btn   = document.getElementById("bulkUploadBtn");
  if (!btn || !input) return;

  btn.addEventListener("click", () => input.click());

  input.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.split("\n").filter(l => l.trim());
    const headers = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/"/g,""));

    const getCol = (row, name) => {
      const idx = headers.findIndex(h => h.includes(name));
      return idx >= 0 ? (row[idx]||"").trim().replace(/"/g,"") : "";
    };

    let added = 0, skipped = 0, errors = [];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(",");
      const reg_number = getCol(row, "reg").toUpperCase();
      const full_name  = getCol(row, "name");
      const program    = getCol(row, "program") || getCol(row, "programme");
      const level      = parseInt(getCol(row, "level")) || 100;
      const sex        = getCol(row, "sex").toUpperCase().startsWith("M") ? "M" : "F";
      const phone      = getCol(row, "phone");

      if (!reg_number || !full_name) { skipped++; continue; }

      const { data: existing } = await supabase
        .from("students").select("id").eq("reg_number", reg_number).limit(1);

      if (existing?.length) { skipped++; continue; }

      const { error } = await supabase.from("students").insert([{
        full_name, reg_number, program, level, sex, phone
      }]);

      if (error) { errors.push(`${reg_number}: ${error.message}`); }
      else added++;
    }

    showToast(`Bulk upload: ${added} added, ${skipped} skipped.`, added > 0 ? "success" : "warning");
    if (errors.length) console.error("Bulk upload errors:", errors);
    await logAudit(`Bulk uploaded ${added} students`, "admin");
    input.value = "";
    loadStudents();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK ROOM ASSIGN from student row (#3)
// ─────────────────────────────────────────────────────────────────────────────
window.quickAssignRoom = async (studentId, name) => {
  await openAssignRoomModal(studentId, name);
};

// ─────────────────────────────────────────────────────────────────────────────
// ROOMMATE PREFERENCE (#13)
// ─────────────────────────────────────────────────────────────────────────────
window.saveRoommatePreference = async (studentId, pref) => {
  const { error } = await supabase
    .from("students")
    .update({ roommate_preference: pref })
    .eq("id", studentId);
  if (error) showToast("Error saving preference.", "error");
  else showToast("Roommate preference saved!", "success");
};
