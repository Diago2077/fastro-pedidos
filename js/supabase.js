// ============================================================
// CONFIGURACIÓN SUPABASE
// Reemplaza los valores con los de tu proyecto en:
// https://app.supabase.com → Settings → API
// ============================================================

const SUPABASE_URL = 'https://rsnhzmjqyiswdkfzizsm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbmh6bWpxeWlzd2RrZnppenNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MjczMjEsImV4cCI6MjA5NDEwMzMyMX0.6vf8nqh27eKevENDFqkQSv6NqRhqk8bAMwzDWFBZG_s';

const { createClient } = window.supabase;
export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
