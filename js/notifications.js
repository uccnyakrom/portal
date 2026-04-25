/**
 * notifications.js — UCC Nyakrom Campus
 * Handles: Email notifications (#4), SMS via Arkesel (#15), system notifications
 */

import { supabase, logAudit } from "./supabaseClient.js";

// ─────────────────────────────────────────────────────────────────────────────
// LOG NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────
async function logNotification(recipient, type, message, status = "sent") {
  await supabase.from("notifications").insert([{
    recipient, type, message, status, sent_at: new Date().toISOString()
  }]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS VIA ARKESEL (#15)
// To use: Sign up at arkesel.com, get API key, add to Supabase meta tags
// ─────────────────────────────────────────────────────────────────────────────
export async function sendSMS(phone, message, senderName = "UCCNyakrom") {
  if (!phone) return { success: false, error: "No phone number" };

  // Format Ghana phone number
  let formatted = phone.replace(/\D/g, "");
  if (formatted.startsWith("0")) formatted = "233" + formatted.slice(1);
  if (!formatted.startsWith("233")) formatted = "233" + formatted;

  try {
    // Use Arkesel API — replace API_KEY with your actual key from arkesel.com
    const ARKESEL_API_KEY = "YOUR_ARKESEL_API_KEY"; // Replace with real key

    if (ARKESEL_API_KEY === "YOUR_ARKESEL_API_KEY") {
      // SMS not configured — log to notifications table instead
      await logNotification(phone, "sms", message, "pending");
      console.log(`SMS (not configured): To ${formatted}: ${message}`);
      return { success: true, note: "SMS logged — configure Arkesel API key to send real SMS" };
    }

    const response = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        "api-key": ARKESEL_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: senderName,
        message,
        recipients: [formatted]
      })
    });

    const result = await response.json();
    const success = result.status === "success";
    await logNotification(phone, "sms", message, success ? "sent" : "failed");
    return { success, result };

  } catch (err) {
    await logNotification(phone, "sms", message, "failed");
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFY STUDENT — application approved/rejected (#4)
// ─────────────────────────────────────────────────────────────────────────────
export async function notifyApplicationStatus(regNumber, status, roomLabel = "") {
  const { data: student } = await supabase
    .from("students")
    .select("full_name, phone")
    .eq("reg_number", regNumber)
    .single();

  if (!student?.phone) return;

  const messages = {
    approved: `Dear ${student.full_name}, your accommodation application at UCC Nyakrom Campus has been APPROVED. ${roomLabel ? `Room: ${roomLabel}.` : ""} Please visit the General Office to complete your check-in. - UCC Nyakrom`,
    rejected:  `Dear ${student.full_name}, your accommodation application at UCC Nyakrom Campus was not successful this time. Please visit the General Office for more information. - UCC Nyakrom`,
    pending:   `Dear ${student.full_name}, your accommodation application has been received and is under review. We will notify you of the outcome shortly. - UCC Nyakrom`
  };

  const msg = messages[status] || messages.pending;
  return await sendSMS(student.phone, msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFY MAINTENANCE UPDATE (#9)
// ─────────────────────────────────────────────────────────────────────────────
export async function notifyMaintenanceUpdate(regNumber, location, newStatus) {
  const { data: student } = await supabase
    .from("students")
    .select("full_name, phone")
    .eq("reg_number", regNumber)
    .single();

  if (!student?.phone) return;

  const statusText = {
    in_progress: "is now being worked on",
    resolved:    "has been resolved",
    closed:      "has been closed"
  }[newStatus] || "has been updated";

  const msg = `Dear ${student.full_name}, your maintenance report for ${location} ${statusText}. Thank you for reporting it. - UCC Nyakrom`;
  return await sendSMS(student.phone, msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEND ROOM CREDENTIALS TO STUDENT (#4, #15)
// ─────────────────────────────────────────────────────────────────────────────
export async function sendLoginCredentials(regNumber, fullName, phone, password) {
  const msg = `Dear ${fullName}, your UCC Nyakrom Accommodation Portal account is ready.\nURL: uccnyakrom.github.io/portal\nUsername: ${regNumber}\nPassword: ${password}\nPlease change your password after first login. - UCC Nyakrom`;
  return await sendSMS(phone, msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// WAITING LIST NOTIFICATION (#12)
// ─────────────────────────────────────────────────────────────────────────────
export async function notifyWaitingListUpdate(regNumber, fullName, phone, message) {
  const msg = `Dear ${fullName}, ${message} - UCC Nyakrom Accommodation Office`;
  return await sendSMS(phone, msg);
}
