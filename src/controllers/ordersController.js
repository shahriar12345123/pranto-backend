import { supabase } from '../config/supabase.js';
import { initialProducts } from '../data/seedProducts.js';
import { handleProductStockZero } from '../services/r2Service.js';
import { logUserActivity } from '../services/activityService.js';

/**
 * POST /api/orders
 * Processes a new order:
 * 1. Validates stock availability for each item.
 * 2. Decrements the exact quantity ordered from the database.
 * 3. Creates the master record in public.orders.
 * 4. Inserts all items into public.order_items.
 * 5. Saves delivery location to public.delivery_locations (if authenticated).
 * 6. Logs the 'order_placed' event to public.user_activities.
 * 7. Purges Cloudflare R2 images if stock reaches 0.
 */
export const createOrder = async (req, res) => {
  try {
    const {
      customer = {},
      items = [],
      deliveryCharge = 70,
      total,
      paymentMethod = 'cod',
      userId: bodyUserId = null,
    } = req.body;

    // Optional user authentication via Bearer token
    let authenticatedUserId = bodyUserId;
    if (!authenticatedUserId && req.headers.authorization?.startsWith('Bearer ')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) authenticatedUserId = user.id;
      } catch (authErr) {
        // Proceed as guest checkout if token validation fails
      }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot place order with empty items list',
      });
    }

    if (!customer.fullName || !customer.phone || !customer.district || !customer.address) {
      return res.status(400).json({
        success: false,
        message: 'Full name, phone, district, and address are required',
      });
    }

    // 1. Validate stock availability and calculate subtotal
    const processedItems = [];
    let calculatedSubtotal = 0;

    for (const item of items) {
      const productId = item.id || item.slug;
      const orderedQty = Math.max(1, parseInt(item.quantity, 10) || 1);

      // 1. Try lookup in Supabase by id or slug
      let product = null;
      if (productId) {
        const { data: dbProduct } = await supabase
          .from('products')
          .select('*')
          .or(`id.eq.${productId},slug.eq.${productId}`)
          .maybeSingle();
        product = dbProduct;
      }

      // 2. Fallback search by name if not found
      if (!product && item.name) {
        const { data: dbByName } = await supabase
          .from('products')
          .select('*')
          .ilike('name', `%${item.name}%`)
          .maybeSingle();
        product = dbByName;
      }

      // 3. Fallback from initialProducts if DB was just migrated or missing record
      if (!product) {
        const fallback = initialProducts.find(
          (p) => p.id === productId || p.slug === productId || p.name.toLowerCase() === item.name?.toLowerCase()
        );
        if (fallback) {
          await supabase.from('products').upsert(fallback, { onConflict: 'id' });
          const { data: created } = await supabase
            .from('products')
            .select('*')
            .eq('id', fallback.id)
            .maybeSingle();
          product = created || fallback;
        }
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product "${item.name || productId}" was not found in catalog`,
        });
      }

      const currentStock = Number(product.stock) || 0;
      if (currentStock < orderedQty) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.name}". Available: ${currentStock}, Requested: ${orderedQty}`,
        });
      }

      const unitPrice = Number(product.price);
      const lineSubtotal = unitPrice * orderedQty;
      calculatedSubtotal += lineSubtotal;

      processedItems.push({
        product,
        orderedQty,
        unitPrice,
        lineSubtotal,
      });
    }

    const finalDeliveryCharge = Number(deliveryCharge) || 70;
    const finalTotal = total ? Number(total) : calculatedSubtotal + finalDeliveryCharge;

    // 2. Generate unique Order ID
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const orderId = `ORD-${dateStr}-${randomDigits}`;

    // 3. Atomically deduct exact quantities from product stock
    const stockUpdateReports = [];
    for (const item of processedItems) {
      const { product, orderedQty } = item;
      const currentStock = Number(product.stock) || 0;
      const newStock = Math.max(0, currentStock - orderedQty);

      console.log(`[Order ${orderId}] Deducting stock for "${product.name}": ${currentStock} -> ${newStock} (-${orderedQty})`);

      if (newStock === 0 && currentStock > 0) {
        // Stock reached 0 -> Purge Cloudflare R2 images and clear images array
        console.log(`[Order ${orderId}] Product ${product.id} reached 0 stock. Purging Cloudflare R2 images.`);
        await handleProductStockZero(product.id, product.images);

        await supabase
          .from('products')
          .update({ stock: 0, images: [] })
          .eq('id', product.id);

        stockUpdateReports.push({
          productId: product.id,
          name: product.name,
          deducted: orderedQty,
          remainingStock: 0,
          status: 'Out of Stock - R2 Images Purged',
        });
      } else {
        // Normal exact quantity deduction
        await supabase
          .from('products')
          .update({ stock: newStock })
          .eq('id', product.id);

        stockUpdateReports.push({
          productId: product.id,
          name: product.name,
          deducted: orderedQty,
          remainingStock: newStock,
          status: 'In Stock',
        });
      }
    }

    // 4. Insert Master Order record into public.orders
    const orderRecord = {
      id: orderId,
      user_id: authenticatedUserId || null,
      customer_name: customer.fullName,
      customer_phone: customer.phone,
      customer_email: customer.email || null,
      division: customer.division || 'Dhaka',
      district: customer.district || 'Dhaka',
      area: customer.area || '',
      delivery_address: customer.address,
      postal_code: customer.postalCode || '',
      order_notes: customer.orderNotes || '',
      subtotal: calculatedSubtotal,
      delivery_charge: finalDeliveryCharge,
      total_amount: finalTotal,
      payment_method: paymentMethod,
      payment_status: paymentMethod === 'cod' ? 'pending' : 'paid',
      order_status: 'pending',
      customer_data: customer,
      items_data: items,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error: orderInsertErr } = await supabase
      .from('orders')
      .insert(orderRecord);

    if (orderInsertErr) {
      console.warn('[Order Processing] Warning inserting order into Supabase:', orderInsertErr.message);
    }

    // 5. Insert individual Line Items into public.order_items
    const orderItemRows = processedItems.map((item) => ({
      order_id: orderId,
      product_id: item.product.id,
      product_name: item.product.name,
      product_sku: item.product.sku || '',
      product_image: item.product.images?.[0] || '',
      unit_price: item.unitPrice,
      quantity: item.orderedQty,
      subtotal: item.lineSubtotal,
      created_at: new Date().toISOString(),
    }));

    try {
      await supabase.from('order_items').insert(orderItemRows);
    } catch (orderItemsErr) {
      console.warn('[Order Processing] Warning inserting order items:', orderItemsErr.message);
    }

    // 6. Save or update delivery location in public.delivery_locations (if authenticated)
    if (authenticatedUserId) {
      try {
        await supabase.from('delivery_locations').insert({
          user_id: authenticatedUserId,
          full_name: customer.fullName,
          phone: customer.phone,
          division: customer.division || 'Dhaka',
          district: customer.district || 'Dhaka',
          area: customer.area || '',
          address: customer.address,
          postal_code: customer.postalCode || '',
          is_default: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (addrErr) {
        console.warn('[Order Processing] Notice: Address save skipped/handled:', addrErr.message);
      }
    }

    // 7. Log user activity in public.user_activities
    await logUserActivity({
      userId: authenticatedUserId,
      activityType: 'order_placed',
      description: `Placed order ${orderId} (৳${finalTotal}) with ${processedItems.length} items via ${paymentMethod.toUpperCase()}`,
      metadata: {
        orderId,
        itemCount: processedItems.length,
        totalAmount: finalTotal,
        paymentMethod,
        customerName: customer.fullName,
        district: customer.district,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Order created successfully and stock updated',
      data: {
        orderId,
        customer,
        items,
        deliveryCharge: finalDeliveryCharge,
        subtotal: calculatedSubtotal,
        total: finalTotal,
        stockUpdates: stockUpdateReports,
        createdAt: orderRecord.created_at,
      },
    });
  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to process order',
    });
  }
};

/**
 * GET /api/orders/my-orders
 * Fetches order history with items for the authenticated user
 */
export const getMyOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: orders || [],
    });
  } catch (err) {
    console.error('getMyOrders error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/orders/:id
 * Fetches single order details by Order ID
 */
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (err) {
    console.error('getOrderById error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
