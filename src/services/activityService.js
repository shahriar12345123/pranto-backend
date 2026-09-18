import { supabase } from '../config/supabase.js';

/**
 * Log a user activity event in public.user_activities
 * @param {Object} params
 * @param {string|null} params.userId - User ID if authenticated
 * @param {string} params.activityType - e.g. 'login', 'signup', 'cart_add', 'cart_remove', 'order_placed', 'view_product'
 * @param {string} params.description - Human readable summary
 * @param {Object} [params.metadata] - Extra context (product_id, order_id, quantity, etc.)
 * @param {Object} [params.req] - Express request object for IP & User Agent
 */
export const logUserActivity = async ({ userId = null, activityType, description = '', metadata = {}, req = null }) => {
  try {
    const ipAddress = req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || null;
    const userAgent = req?.headers['user-agent'] || null;

    const payload = {
      user_id: userId,
      activity_type: activityType,
      description: description,
      ip_address: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : null,
      user_agent: userAgent,
      metadata: metadata || {},
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('user_activities').insert(payload);
    if (error) {
      console.warn('[ActivityLogger] Warning inserting activity log:', error.message);
    }
  } catch (err) {
    console.warn('[ActivityLogger] Exception logging activity:', err.message);
  }
};

/**
 * Record a user login timestamp and authentication metadata
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.email
 * @param {string} [params.authProvider='email']
 * @param {Object} [params.req]
 */
export const recordUserLogin = async ({ userId, email, authProvider = 'email', req = null }) => {
  if (!userId) return;

  const now = new Date().toISOString();
  const ipAddress = req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || null;
  const userAgent = req?.headers['user-agent'] || null;

  try {
    // 1. Insert into user_logins
    await supabase.from('user_logins').insert({
      user_id: userId,
      email: email,
      login_timestamp: now,
      ip_address: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : null,
      user_agent: userAgent,
      auth_provider: authProvider,
    });

    // 2. Update profiles table last_login_at
    await supabase.from('profiles').upsert(
      {
        id: userId,
        email: email,
        last_login_at: now,
        updated_at: now,
      },
      { onConflict: 'id' }
    );

    // 3. Log user activity
    await logUserActivity({
      userId,
      activityType: 'login',
      description: `User logged in via ${authProvider}`,
      metadata: { email, timestamp: now },
      req,
    });
  } catch (err) {
    console.warn('[ActivityLogger] Exception recording user login:', err.message);
  }
};
