import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

// Create a single supabase client for system-level actions (if RLS is disabled or service role is used)
export const supabase = createClient(supabaseUrl, supabaseKey);

// Create a user-specific client that passes the user's JWT to bypass RLS properly
export const createSupabaseUserClient = (token) => {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
};
