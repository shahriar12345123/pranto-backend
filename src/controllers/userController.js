import { supabase } from '../config/supabase.js';
import { recordUserLogin, logUserActivity } from '../services/activityService.js';

/**
 * POST /api/auth/login-event
 * Records a user login timestamp and audit trail
 */
export const handleLoginEvent = async (req, res) => {
  try {
    const { userId, email, authProvider = 'email', fullName, phone } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    // Upsert profile if info provided
    if (fullName || phone || email) {
      await supabase.from('profiles').upsert(
        {
          id: userId,
          email,
          ...(fullName ? { full_name: fullName } : {}),
          ...(phone ? { phone } : {}),
          last_login_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    }

    await recordUserLogin({
      userId,
      email,
      authProvider,
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Login event recorded successfully',
    });
  } catch (err) {
    console.error('handleLoginEvent error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/user/profile
 * Get authenticated user's profile details, order count, and last login
 */
export const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Fetch profile
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    // 2. Fetch order count
    const { count: orderCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // 3. Fetch default address if any
    const { data: defaultAddress } = await supabase
      .from('delivery_locations')
      .select('*')
      .eq('user_id', userId)
      .eq('is_default', true)
      .maybeSingle();

    return res.status(200).json({
      success: true,
      data: {
        ...(profile || { id: userId, email: req.user.email }),
        orderCount: orderCount || 0,
        defaultAddress: defaultAddress || null,
      },
    });
  } catch (err) {
    console.error('getUserProfile error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/user/profile
 * Update authenticated user's profile
 */
export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fullName, phone, avatarUrl } = req.body;

    const payload = {
      id: userId,
      email: req.user.email,
      updated_at: new Date().toISOString(),
    };

    if (fullName !== undefined) payload.full_name = fullName;
    if (phone !== undefined) payload.phone = phone;
    if (avatarUrl !== undefined) payload.avatar_url = avatarUrl;

    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    await logUserActivity({
      userId,
      activityType: 'profile_updated',
      description: 'User updated personal profile details',
      metadata: { fields: Object.keys(req.body) },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data,
    });
  } catch (err) {
    console.error('updateUserProfile error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/user/addresses
 * Retrieve all saved delivery locations for the user
 */
export const getUserAddresses = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('delivery_locations')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || [],
    });
  } catch (err) {
    console.error('getUserAddresses error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/user/addresses
 * Add a new delivery location for the user
 */
export const addUserAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fullName, phone, division, district, area, address, postalCode, isDefault = false } = req.body;

    if (!fullName || !phone || !division || !district || !address) {
      return res.status(400).json({
        success: false,
        message: 'Full name, phone, division, district, and address are required',
      });
    }

    // If setting as default, unset previous default
    if (isDefault) {
      await supabase
        .from('delivery_locations')
        .update({ is_default: false })
        .eq('user_id', userId);
    }

    const { data, error } = await supabase
      .from('delivery_locations')
      .insert({
        user_id: userId,
        full_name: fullName,
        phone: phone,
        division: division,
        district: district,
        area: area || '',
        address: address,
        postal_code: postalCode || '',
        is_default: Boolean(isDefault),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    await logUserActivity({
      userId,
      activityType: 'address_added',
      description: `Added new delivery address: ${district}, ${division}`,
      metadata: { addressId: data.id, district, division },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Delivery address added successfully',
      data,
    });
  } catch (err) {
    console.error('addUserAddress error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/user/activities
 * Retrieve user's activity log timeline
 */
export const getUserActivities = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit, 10) || 20;

    const { data, error } = await supabase
      .from('user_activities')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || [],
    });
  } catch (err) {
    console.error('getUserActivities error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
