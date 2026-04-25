/**
 * reports.js — UCC Nyakrom Campus
 * Features: PDF Reports (#5), Room History (#7), Academic Year (#10)
 */

import { supabase, showToast, logAudit } from "./supabaseClient.js";

// ─────────────────────────────────────────────────────────────────────────────
// PDF REPORT GENERATION (#5) — using browser print
// ─────────────────────────────────────────────────────────────────────────────
export async function generateOccupancyReport() {
  const [roomsRes, studentsRes, yearRes] = await Promise.all([
    supabase.from("rooms").select("*"),
    supabase.from("students").select("id, full_name, reg_number, program, level, sex, room_id, rooms:room_id(block, room_number)"),
    supabase.from("academic_years").select("*").eq("is_active", true).single()
  ]);

  const rooms    = roomsRes.data    || [];
  const students = studentsRes.data || [];
  const year     = yearRes.data;

  const blocks = ["NE","N","NW","ADM","S"];
  const now    = new Date().toLocaleDateString("en-GH", { dateStyle: "full" });

  const blockRows = blocks.map(b => {
    const bRooms = rooms.filter(r => r.block === b);
    const cap    = bRooms.reduce((a,r) => a+r.capacity, 0);
    const occ    = bRooms.reduce((a,r) => a+r.occupancy_count, 0);
    const pct    = cap > 0 ? Math.round((occ/cap)*100) : 0;
    return `<tr>
      <td>Block ${b}</td>
      <td>${bRooms.length}</td>
      <td>${cap}</td>
      <td>${occ}</td>
      <td>${cap - occ}</td>
      <td>${pct}%</td>
    </tr>`;
  }).join("");

  const totalCap = rooms.reduce((a,r) => a+r.capacity, 0);
  const totalOcc = rooms.reduce((a,r) => a+r.occupancy_count, 0);
  const nursing  = students.filter(s => (s.program||"").toLowerCase().includes("nurs")).length;
  const nutrition= students.filter(s => (s.program||"").toLowerCase().includes("nutr")).length;
  const cobes    = students.filter(s => (s.program||"").toLowerCase().includes("mbchb")).length;
  const male     = students.filter(s => s.sex === "M").length;
  const female   = students.filter(s => s.sex === "F").length;
  const housed   = students.filter(s => s.room_id).length;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Accommodation Report — UCC Nyakrom Campus</title>
      <style>
        body { font-family: Georgia, serif; color: #1e3a5f; margin: 2cm; font-size: 13px; }
        h1 { text-align: center; font-size: 18px; margin-bottom: 4px; }
        h2 { font-size: 14px; border-bottom: 2px solid #c9a84c; padding-bottom: 4px; margin-top: 20px; }
        .subtitle { text-align: center; color: #666; font-size: 12px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th { background: #1e3a5f; color: white; padding: 8px; text-align: left; font-size: 12px; }
        td { padding: 7px 8px; border-bottom: 1px solid #eee; font-size: 12px; }
        tr:nth-child(even) { background: #f9f9f9; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 15px 0; }
        .stat-box { border: 1px solid #ddd; border-radius: 6px; padding: 12px; text-align: center; }
        .stat-num { font-size: 24px; font-weight: bold; color: #1e3a5f; }
        .stat-lbl { font-size: 11px; color: #666; margin-top: 4px; }
        .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 11px; color: #888; display: flex; justify-content: space-between; }
        @media print { body { margin: 1cm; } }
      </style>
    </head>
    <body>
      <h1>🏛️ UCC Nyakrom Campus — Accommodation Report</h1>
      <div class="subtitle">
        ${year ? `${year.year} — ${year.semester}` : "Current Period"} &nbsp;|&nbsp; 
        Generated: ${now} &nbsp;|&nbsp;
        Centre for African and International Studies
      </div>

      <h2>📊 Summary Statistics</h2>
      <div class="stats-grid">
        <div class="stat-box"><div class="stat-num">${students.length}</div><div class="stat-lbl">Total Students</div></div>
        <div class="stat-box"><div class="stat-num">${housed}</div><div class="stat-lbl">Room Assigned</div></div>
        <div class="stat-box"><div class="stat-num">${students.length - housed}</div><div class="stat-lbl">No Room Yet</div></div>
        <div class="stat-box"><div class="stat-num">${totalCap}</div><div class="stat-lbl">Total Beds</div></div>
        <div class="stat-box"><div class="stat-num">${totalCap - totalOcc}</div><div class="stat-lbl">Available Beds</div></div>
        <div class="stat-box"><div class="stat-num">${totalCap > 0 ? Math.round((totalOcc/totalCap)*100) : 0}%</div><div class="stat-lbl">Occupancy Rate</div></div>
      </div>

      <h2>🏠 Occupancy by Block</h2>
      <table>
        <thead><tr><th>Block</th><th>Rooms</th><th>Capacity</th><th>Occupied</th><th>Available</th><th>Rate</th></tr></thead>
        <tbody>${blockRows}</tbody>
        <tfoot><tr style="font-weight:bold;background:#f0f4f8">
          <td>TOTAL</td><td>${rooms.length}</td><td>${totalCap}</td><td>${totalOcc}</td><td>${totalCap-totalOcc}</td>
          <td>${totalCap > 0 ? Math.round((totalOcc/totalCap)*100) : 0}%</td>
        </tr></tfoot>
      </table>

      <h2>🎓 Student Distribution</h2>
      <table>
        <thead><tr><th>Category</th><th>Count</th><th>Percentage</th></tr></thead>
        <tbody>
          <tr><td>BSc Nursing</td><td>${nursing}</td><td>${students.length > 0 ? Math.round((nursing/students.length)*100) : 0}%</td></tr>
          <tr><td>BSc Nutrition</td><td>${nutrition}</td><td>${students.length > 0 ? Math.round((nutrition/students.length)*100) : 0}%</td></tr>
          <tr><td>MBChB-COBES</td><td>${cobes}</td><td>${students.length > 0 ? Math.round((cobes/students.length)*100) : 0}%</td></tr>
          <tr><td>Male</td><td>${male}</td><td>${students.length > 0 ? Math.round((male/students.length)*100) : 0}%</td></tr>
          <tr><td>Female</td><td>${female}</td><td>${students.length > 0 ? Math.round((female/students.length)*100) : 0}%</td></tr>
        </tbody>
      </table>

      <div class="footer">
        <span>UCC Nyakrom Campus — Centre for African and International Studies</span>
        <span>Developed by Mr Emmanuel Aidoo, Senior Assistant Registrar</span>
      </div>
    </body>
    </html>
  `;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);

  await logAudit("Generated occupancy PDF report", "admin");
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOM HISTORY (#7)
// ─────────────────────────────────────────────────────────────────────────────
export async function recordRoomHistory(studentId, roomId, block, roomNumber, actorName) {
  // Close any existing open history
  await supabase
    .from("room_history")
    .update({ moved_out: new Date().toISOString() })
    .eq("student_id", studentId)
    .is("moved_out", null);

  // Create new history record
  if (roomId) {
    const { data: year } = await supabase
      .from("academic_years").select("year, semester").eq("is_active", true).single();

    await supabase.from("room_history").insert([{
      student_id:    studentId,
      room_id:       roomId,
      block,
      room_number:   roomNumber,
      moved_in:      new Date().toISOString(),
      academic_year: year ? `${year.year} ${year.semester}` : "Unknown",
      recorded_by:   actorName
    }]);
  }
}

export async function loadRoomHistory(studentId) {
  const { data, error } = await supabase
    .from("room_history")
    .select("*")
    .eq("student_id", studentId)
    .order("moved_in", { ascending: false });

  return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ACADEMIC YEAR (#10)
// ─────────────────────────────────────────────────────────────────────────────
export async function getActiveYear() {
  const { data } = await supabase
    .from("academic_years").select("*").eq("is_active", true).single();
  return data;
}

export async function loadAcademicYears() {
  const { data } = await supabase
    .from("academic_years").select("*").order("created_at", { ascending: false });
  return data || [];
}

export async function setActiveYear(yearId) {
  await supabase.from("academic_years").update({ is_active: false }).neq("id", yearId);
  await supabase.from("academic_years").update({ is_active: true }).eq("id", yearId);
  showToast("Academic year updated!", "success");
}

export async function createNewYear(year, semester) {
  const { error } = await supabase.from("academic_years").insert([{ year, semester, is_active: false }]);
  if (error) { showToast("Error: " + error.message, "error"); return; }
  showToast(`${year} ${semester} created!`, "success");
}

// ─────────────────────────────────────────────────────────────────────────────
// WAITING LIST (#12)
// ─────────────────────────────────────────────────────────────────────────────
export async function addToWaitingList(studentId, regNumber, fullName, program, level, sex, notes) {
  // Check if already on list
  const { data: existing } = await supabase
    .from("waiting_list").select("id").eq("reg_number", regNumber).eq("status","waiting").limit(1);
  if (existing?.length) {
    showToast("Student is already on the waiting list.", "warning");
    return;
  }

  const { error } = await supabase.from("waiting_list").insert([{
    student_id: studentId, reg_number: regNumber, full_name: fullName,
    program, level, sex, notes, status: "waiting"
  }]);

  if (error) { showToast("Error: " + error.message, "error"); return; }
  showToast(`${fullName} added to waiting list.`, "success");
  await logAudit(`Added ${regNumber} to waiting list`, "admin");
}

export async function loadWaitingList() {
  const { data } = await supabase
    .from("waiting_list").select("*")
    .eq("status", "waiting")
    .order("created_at");
  return data || [];
}

export async function removeFromWaitingList(id, reason = "assigned") {
  await supabase.from("waiting_list").update({ status: reason }).eq("id", id);
}
