import { createSupabaseUserClient } from '../config/supabase.js';
import { logUserActivity } from '../services/activityService.js';

// Get user's cart items
export const getCart = async (req, res) => {
  try {
    const supabase = createSupabaseUserClient(req.token);
    const { data: cartItems, error } = await supabase
      .from('cart_items')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    
    // Map database cart format to frontend cart format
    const formattedCart = cartItems.map(item => ({
      ...item.product_data,
      quantity: item.quantity,
      db_id: item.id
    }));

    res.json({ success: true, data: formattedCart });
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch cart', error: error.message });
  }
};

// Add item to cart or increment quantity
export const addToCart = async (req, res) => {
  try {
    const { product, quantity = 1 } = req.body;
    const userId = req.user.id;
    const supabase = createSupabaseUserClient(req.token);

    if (!product || !product.id) {
      return res.status(400).json({ success: false, message: 'Product data is missing' });
    }

    const { data: existingItem, error: fetchError } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('product_id', product.id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      const { data, error } = await supabase
        .from('cart_items')
        .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq('id', existingItem.id)
        .select()
        .single();
        
      if (error) throw error;

      await logUserActivity({
        userId,
        activityType: 'cart_update',
        description: `Updated quantity of "${product.name}" to ${newQuantity} in cart`,
        metadata: { productId: product.id, quantity: newQuantity },
        req,
      });

      return res.json({ success: true, message: 'Cart updated', data: { ...product, quantity: data.quantity } });
    } else {
      const { data, error } = await supabase
        .from('cart_items')
        .insert({
          user_id: userId,
          product_id: product.id,
          product_data: product,
          quantity: quantity
        })
        .select()
        .single();

      if (error) throw error;

      await logUserActivity({
        userId,
        activityType: 'cart_add',
        description: `Added "${product.name}" (${quantity}×) to cart`,
        metadata: { productId: product.id, quantity },
        req,
      });

      return res.status(201).json({ success: true, message: 'Item added to cart', data: { ...data.product_data, quantity: data.quantity } });
    }
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ success: false, message: 'Failed to add item to cart', error: error.message });
  }
};

// Update item quantity
export const updateCartItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;
    const userId = req.user.id;
    const supabase = createSupabaseUserClient(req.token);

    if (quantity <= 0) {
      return removeFromCart(req, res);
    }

    const { data, error } = await supabase
      .from('cart_items')
      .update({ quantity: quantity, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('product_id', productId)
      .select()
      .single();

    if (error) throw error;

    await logUserActivity({
      userId,
      activityType: 'cart_update',
      description: `Changed item quantity in cart to ${quantity}`,
      metadata: { productId, quantity },
      req,
    });

    res.json({ success: true, message: 'Cart item updated', data: { ...data.product_data, quantity: data.quantity } });
  } catch (error) {
    console.error('Error updating cart item:', error);
    res.status(500).json({ success: false, message: 'Failed to update cart item', error: error.message });
  }
};

// Remove item from cart
export const removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.id;
    const supabase = createSupabaseUserClient(req.token);

    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);

    if (error) throw error;

    await logUserActivity({
      userId,
      activityType: 'cart_remove',
      description: `Removed item ${productId} from cart`,
      metadata: { productId },
      req,
    });

    res.json({ success: true, message: 'Item removed from cart' });
  } catch (error) {
    console.error('Error removing from cart:', error);
    res.status(500).json({ success: false, message: 'Failed to remove item from cart', error: error.message });
  }
};

// Clear entire cart
export const clearCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = createSupabaseUserClient(req.token);

    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    await logUserActivity({
      userId,
      activityType: 'cart_cleared',
      description: 'Cleared all items from cart',
      metadata: {},
      req,
    });

    res.json({ success: true, message: 'Cart cleared' });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({ success: false, message: 'Failed to clear cart', error: error.message });
  }
};
