import { supabase } from "./supabaseClient.js";

// STUDENT LOGIN
export async function studentLogin(regNumber, password) {
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .eq("reg_number", regNumber)
    .single();

  if (error || !data) {
    alert("Student not found");
    return;
  }

  const expectedPassword =
    regNumber.slice(0, 2) +
    regNumber.slice(-4) +
    data.name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toLowerCase();

  if (password !== expectedPassword) {
    alert("Wrong password");
    return;
  }

  localStorage.setItem("student", JSON.stringify(data));
  window.location.href = "student.html";
}

// ADMIN LOGIN
export async function adminLogin(username, password) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("username", username)
    .eq("password", password)
    .single();

  if (error || !data) {
    alert("Invalid admin credentials");
    return;
  }

  localStorage.setItem("admin", JSON.stringify(data));
  window.location.href = "admin.html";
}
