import { supabase } from "./supabaseClient.js";

window.loadStudents = async function () {
  const { data } = await supabase.from("students").select("*");

  const table = document.getElementById("studentsTable");
  table.innerHTML = "";

  data.forEach(student => {
    const row = `
<tr>
  <td>${student.name}</td>
  <td>${student.reg_number}</td>
  <td>${student.room_id || "None"}</td>
  <td>
    <button onclick="enrolStudent('${student.id}')">Enroll</button>
  </td>
  <td>
    <input id="room-${student.id}">
    <button onclick="assignRoom('${student.id}')">Assign</button>
  </td>
</tr>
`;
    table.innerHTML += row;
  });
};
window.loadStudents = async function () {
  ...
};

// ✅ ENROLL STUDENT
window.enrolStudent = async function (id) {
  await supabase
    .from("students")
    .update({ enrolled: true })
    .eq("id", id);

  alert("Student enrolled");
  loadStudents();
};

// 🔥 AUTO UPDATE ROOM COUNTS
async function updateRoomOccupancy(roomId) {
  const { data: students } = await supabase
    .from("students")
    .select("*")
    .eq("room_id", roomId);

  const count = students.length;

  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  let type = "vacant";
  if (count === 0) type = "vacant";
  else if (count < room.capacity) type = "partial";
  else type = "full";

  await supabase
    .from("rooms")
    .update({
      occupancy_count: count,
      type: type
    })
    .eq("id", roomId);
}

// ASSIGN ROOM
window.assignRoom = async function (studentId) {
  const roomId = document.getElementById(`room-${studentId}`).value;

  await supabase
    .from("students")
    .update({ room_id: roomId })
    .eq("id", studentId);

  await updateRoomOccupancy(roomId);

  alert("Room assigned & updated");
  loadStudents();
};

// REMOVE ROOM
window.removeRoom = async function (studentId) {
  const { data } = await supabase
    .from("students")
    .select("room_id")
    .eq("id", studentId)
    .single();

  await supabase
    .from("students")
    .update({ room_id: null })
    .eq("id", studentId);

  if (data.room_id) await updateRoomOccupancy(data.room_id);

  alert("Removed");
  loadStudents();
};

// 🔴 REAL-TIME LISTENER
supabase
  .channel("rooms")
  .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, () => {
    console.log("Room updated in real-time");
  })
  .subscribe();
