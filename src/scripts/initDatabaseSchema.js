import { supabase } from '../config/supabase.js';

async function checkAndInit() {
  console.log('Checking Supabase tables and schema status...');

  // Test tables
  const tables = [
    'products',
    'profiles',
    'user_logins',
    'delivery_locations',
    'cart_items',
    'orders',
    'order_items',
    'user_activities',
  ];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.warn(`[Table Check] Table "${table}" query notice:`, error.message);
    } else {
      console.log(`[Table Check] Table "${table}" is accessible (Rows: ${data?.length})`);
    }
  }
}

checkAndInit();
