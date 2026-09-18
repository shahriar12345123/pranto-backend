import { supabase } from '../config/supabase.js';

/**
 * Log a privileged administrative action to public.admin_audit_logs
 * @param {Object} params
 * @param {Object} params.adminUser - { id, email }
 * @param {string} params.action - e.g. 'PRODUCT_CREATED', 'PAYMENT_APPROVED'
 * @param {string} params.targetType - e.g. 'product', 'order', 'payment', 'settings'
 * @param {string} [params.targetId] - ID of the affected target
 * @param {string} params.description - Human-readable summary
 * @param {Object} [params.metadata] - Additional structured context
 * @param {Object} [params.req] - Express request object for IP and User Agent extraction
 */
export const logAdminAction = async ({
  adminUser = {},
  action,
  targetType,
  targetId = null,
  description,
  metadata = {},
  req = null,
}) => {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() : null;
    const userAgent = req ? req.headers['user-agent'] : null;

    const isValidUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    const auditEntry = {
      admin_id: isValidUuid(adminUser.id) ? adminUser.id : null,
      admin_email: adminUser.email || 'admin@gazet.com.bd',
      action,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      description,
      metadata: metadata || {},
      ip_address: ip,
      user_agent: userAgent,
      created_at: new Date().toISOString(),
    };

    console.log(`[Admin Audit] [${action}] by ${auditEntry.admin_email}: ${description}`);

    const { error } = await supabase.from('admin_audit_logs').insert(auditEntry);
    if (error) {
      console.warn('[Admin Audit] Notice inserting audit log (table may need migration):', error.message);
    }
  } catch (err) {
    console.warn('[Admin Audit] Non-fatal error recording audit log:', err.message);
  }
};
