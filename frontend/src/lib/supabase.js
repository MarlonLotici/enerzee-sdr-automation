import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            flowType: 'pkce',
        },
        global: {
            fetch: (url, options) => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                return fetch(url, { ...options, signal: controller.signal })
                    .finally(() => clearTimeout(timeout));
            }
        }
    }
)
