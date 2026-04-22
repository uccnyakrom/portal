import { supabase } from "./supabaseClient.js";

// LOAD NOTICES (STUDENT VIEW)
export async function loadNotices(containerId) {
  const { data } = await supabase
    .from("notices")
    .select("*")
    .order("pinned", { ascending: false });

  const container = document.getElementById(containerId);
  container.innerHTML = "";

  data.forEach(n => {
    const color =
      n.priority === "urgent" ? "red" :
      n.priority === "info" ? "blue" : "green";

    container.innerHTML += `
      <div style="border-left:5px solid ${color}; padding:10px; margin:10px;">
        <h4>${n.title}</h4>
        <p>${n.message}</p>
        <small>${n.priority.toUpperCase()}</small>
      </div>
    `;
  });
}

// ADMIN CREATE NOTICE
export async function createNotice(form) {
  const formData = new FormData(form);

  await supabase.from("notices").insert({
    title: formData.get("title"),
    message: formData.get("message"),
    priority: formData.get("priority"),
    audience: formData.get("audience"),
    author: "Admin",
    expiry_date: formData.get("expiry")
  });

  alert("Notice posted");
}
