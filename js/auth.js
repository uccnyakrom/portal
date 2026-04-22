import { supabase } from "./supabaseClient.js";

// STUDENT LOGIN (EMAIL = reg number)
export async function studentLogin(regNumber, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: regNumber + "@student.com",
    password: password
  });

  if (error) {
    alert(error.message);
    return;
  }

  localStorage.setItem("session", JSON.stringify(data.session));
  window.location.href = "student.html";
}

// ADMIN LOGIN
export async function adminLogin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert(error.message);
    return;
  }

  localStorage.setItem("session", JSON.stringify(data.session));
  window.location.href = "admin.html";
}
