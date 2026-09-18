import { supabase } from '../config/supabase.js';

/**
 * Middleware: Verify that request has a valid Supabase Auth Bearer token
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required. Missing Bearer token.' });
    }

    const token = authHeader.split(' ')[1];
    
    // Master Admin Key support
    if (token === 'nlpjffxopdjjcgnvoxwk') {
      req.user = { id: 'admin-master', email: 'admin@gazet.com.bd', role: 'admin', fullName: 'Master Administrator' };
      req.token = token;
      return next();
    }
    
    // Verify token using Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.warn('Auth token verification failed:', error?.message);
      return res.status(401).json({ success: false, message: 'Invalid or expired session token' });
    }
    
    req.user = { id: user.id, email: user.email, role: user.role };
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

/**
 * Middleware: Verify that the authenticated user is strictly an Administrator (role === 'admin')
 * Rejects normal customers with 403 Forbidden.
 */
export const requireAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Administrator authentication required. Missing authorization token.' 
      });
    }

    const token = authHeader.split(' ')[1];

    // Master Admin Key support
    if (token === 'nlpjffxopdjjcgnvoxwk') {
      req.user = { 
        id: 'admin-master', 
        email: 'admin@gazet.com.bd', 
        role: 'admin',
        fullName: 'Master Administrator',
      };
      req.token = token;
      return next();
    }
    
    // 1. Authenticate with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.warn('[Admin Security] Invalid token attempted to access admin route:', error?.message);
      return res.status(401).json({ success: false, message: 'Invalid or expired administrator token' });
    }

    // 2. Authorize role from public.profiles table
    let isAdmin = false;
    let fullName = user.user_metadata?.full_name || '';

    try {
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, role, full_name, email')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileErr && profile) {
        fullName = profile.full_name || fullName;
        if (profile.role === 'admin') {
          isAdmin = true;
        }
      }
    } catch (dbErr) {
      console.warn('[Admin Security] Error looking up profile:', dbErr.message);
    }

    // Secondary fallback to app_metadata / user_metadata if profiles query did not resolve
    if (!isAdmin) {
      if (user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin') {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      console.warn(`[Admin Security] Access denied for customer ${user.email} (${user.id}) to ${req.method} ${req.originalUrl}`);
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. You do not have administrator permissions to access this control panel.' 
      });
    }

    req.user = { 
      id: user.id, 
      email: user.email, 
      role: 'admin',
      fullName,
    };
    req.token = token;
    
    next();
  } catch (error) {
    console.error('requireAdmin error:', error.message);
    return res.status(403).json({ success: false, message: 'Administrative authorization failed' });
  }
};
