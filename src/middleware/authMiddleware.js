import { supabase } from '../config/supabase.js';

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token using Supabase client directly
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Auth verification error:', error?.message);
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    
    req.user = { id: user.id, email: user.email, role: user.role };
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};
