import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/supabase.js';

let clientPromise;

export async function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error('Configure the Supabase project URL and anon key in js/config/supabase.js.');
  }
  clientPromise ??= import('../vendor/supabase.js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  );
  return clientPromise;
}