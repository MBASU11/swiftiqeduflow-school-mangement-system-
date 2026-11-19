// The project URL and anon/publishable key are public client configuration.
// Never put a service-role key or database password in this file.
export const SUPABASE_URL = 'https://qkztjbytfjhocvzcrmlr.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_VzBh-erXv6Yy8NRkzzXTgw_P6w2dRj3';

export function isSupabaseConfigured() {
  return typeof globalThis.process === 'undefined'
    && typeof window !== 'undefined'
    && Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}