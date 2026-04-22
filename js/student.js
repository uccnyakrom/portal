import { supabase } from "./supabaseClient.js";
import { loadNotices } from "./notices.js";

const student = JSON.parse(localStorage.getItem("student"));

// 🔒 BLOCK UNENROLLED USERS
if (!student.enrolled) {
  alert("You are not enrolled by admin");
  window.location.href = "index.html";
}

document.getElementById("profile").innerHTML = `
  <h3>${student.name}</h3>
`;

async function loadRoom() {
  if (!student.room_id) return;

  const { data } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", student.room_id)
    .single();

  document.getElementById("room").innerHTML = `
    Room: ${data.room_number} (${data.block})
  `;

  loadRoommates();
}

async function loadRoommates() {
  const { data } = await supabase
    .from("students")
    .select("*")
    .eq("room_id", student.room_id);

  document.getElementById("roommates").innerHTML =
    data.map(s => `<p>${s.name}</p>`).join("");
}

// APPLY
window.apply = async function () {
  await supabase.from("applications").insert({
    student_id: student.id,
    status: "pending"
  });

  alert("Application sent");
};

// LOAD NOTICES
loadNotices("notices");

loadRoom();
