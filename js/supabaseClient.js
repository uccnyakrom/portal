import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://rgjaceihgcvhvqrisxew.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnamFjZWloZ2N2aHZxcmlzeGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MzMwNzQsImV4cCI6MjA5MjQwOTA3NH0.sBkNWbxqQgAAcaqI86qVD7d0KLChQigbUmq4-C1diFE"; // paste yours

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
