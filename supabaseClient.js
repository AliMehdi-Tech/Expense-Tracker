import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';

let hasValidUrl = false;
try {
  const parsedUrl = new URL(supabaseUrl);
  hasValidUrl = parsedUrl.protocol === 'https:' && Boolean(parsedUrl.hostname);
} catch {
  hasValidUrl = false;
}
const hasPublishableKey = /^sb_publishable_[A-Za-z0-9._-]+$/.test(supabasePublishableKey);

export const supabaseConfigError = !hasValidUrl || !hasPublishableKey
  ? 'Cloud sync is unavailable. Configure the Supabase URL and publishable key in your local environment.'
  : '';

export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      }
    });
