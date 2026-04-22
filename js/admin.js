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
          <input id="room-${student.id}" placeholder="Room ID">
          <button onclick="assignRoom('${student.id}')">Assign</button>
        </td>
      </tr>
    `;
    table.innerHTML += row;
  });
};

window.assignRoom = async function (studentId) {
  const roomId = document.getElementById(`room-${studentId}`).value;

  await supabase
    .from("students")
    .update({ room_id: roomId })
    .eq("id", studentId);

  alert("Room assigned");
  loadStudents();
};
