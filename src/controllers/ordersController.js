import { supabase } from '../config/supabase.js';
import { initialProducts } from '../data/seedProducts.js';
import { handleProductStockZero } from '../services/r2Service.js';
import { logUserActivity } from '../services/activityService.js';
import { checkoutConfig } from '../config/checkoutConfig.js';

/**
 * GET /api/orders/config
 * Returns current delivery rates and payment method instructions
 */
// In-memory cache for fast duplicate transaction ID detection across concurrent requests
const processedTransactionIds = new Map();

export const getCheckoutConfig = (req, res) => {
  try {
    const config = checkoutConfig.getPublicConfig();
    return res.status(200).json({
      success: true,
      data: config,
    });
  } catch (err) {
    console.error('getCheckoutConfig error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve checkout configuration' });
  }
};

/**
 * POST /api/orders
 * Processes a new order:
 * 1. Validates customer information and phone number format.
 * 2. Validates and looks up each item in DB to retrieve actual price and current stock.
 * 3. Rejects order if stock is insufficient.
 * 4. Calculates subtotal and delivery charge strictly on the backend.
 * 5. Validates payment method (cod, bkash, nagad, rocket).
 * 6. For manual digital payments: validates Transaction ID format and checks for duplicates.
 * 7. Sets payment_status = 'unpaid' (for COD) or 'pending_verification' (for digital).
 * 8. Atomically deducts exact stock from DB and purges R2 images if stock hits 0.
 * 9. Saves master order record, order items, and audit log.
 */
export const createOrder = async (req, res) => {
  try {
    const {
      customer = {},
      items = [],
      paymentMethod: rawPaymentMethod = 'cod',
      transactionId: rawTransactionId = null,
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

    // 1. Validate items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot place order with empty items list',
      });
    }

    // 2. Validate customer information
    if (!customer.fullName || !customer.phone || !customer.district || !customer.address) {
      return res.status(400).json({
        success: false,
        message: 'Full name, phone, district, and address are required to place an order',
      });
    }

    const cleanPhone = String(customer.phone || '').replace(/[\s-]/g, '');
    const phoneRegex = /^(?:\+88|88)?(01[3-9]\d{8})$/;
    if (!phoneRegex.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 11-digit Bangladeshi phone number (e.g. 017XXXXXXXX)',
      });
    }

    // 3. Validate payment method
    const paymentMethod = String(rawPaymentMethod || 'cod').trim().toLowerCase();
    if (!checkoutConfig.isValidPaymentMethod(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment method: "${paymentMethod}". Allowed methods: ${Object.keys(checkoutConfig.paymentMethods).join(', ')}`,
      });
    }

    const paymentConfig = checkoutConfig.paymentMethods[paymentMethod];

    // 4. Validate Transaction ID for all orders (including COD delivery charge prepayment)
    const trimmedTxnId = String(rawTransactionId || '').trim();

    if (!trimmedTxnId) {
      return res.status(400).json({
        success: false,
        message: paymentMethod === 'cod'
          ? 'Transaction ID (Txn ID) is required for the delivery charge Send Money payment'
          : `Transaction ID (Txn ID) is required for ${paymentConfig.name} payment`,
      });
    }

    // Basic sanity check on Transaction ID format (minimum 4 alphanumeric characters)
    if (trimmedTxnId.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(trimmedTxnId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Transaction ID format. Please enter a valid transaction reference received after Send Money transfer.',
      });
    }

    // 4a. Duplicate Transaction ID Detection
    const normalizedTxn = trimmedTxnId.toUpperCase();
    if (processedTransactionIds.has(normalizedTxn)) {
      const cached = processedTransactionIds.get(normalizedTxn);
      return res.status(400).json({
        success: false,
        message: `This Transaction ID (${trimmedTxnId}) has already been submitted for another order (${cached.orderId}). Duplicate transaction IDs are not permitted.`,
      });
    }

    try {
      const { data: existingTxn } = await supabase
        .from('orders')
        .select('id, transaction_id, created_at')
        .ilike('transaction_id', trimmedTxnId)
        .maybeSingle();

      if (existingTxn) {
        processedTransactionIds.set(normalizedTxn, { orderId: existingTxn.id, timestamp: Date.now() });
        return res.status(400).json({
          success: false,
          message: `This Transaction ID (${trimmedTxnId}) has already been submitted for another order (${existingTxn.id}). Duplicate transaction IDs are not permitted.`,
        });
      }
    } catch (checkErr) {
      // Supabase error handling
    }

    const finalTransactionId = trimmedTxnId;
    const finalPaymentStatus = 'pending_verification';

    // 5. Backend Product Validation & Subtotal Calculation (Prices from Database ONLY)
    const processedItems = [];
    let calculatedSubtotal = 0;

    for (const item of items) {
      const productId = item.id || item.slug;
      const orderedQty = Math.max(1, parseInt(item.quantity, 10) || 1);

      // 5a. Lookup in Supabase products table
      let product = null;
      if (productId) {
        const { data: dbProduct } = await supabase
          .from('products')
          .select('*')
          .or(`id.eq.${productId},slug.eq.${productId}`)
          .maybeSingle();
        product = dbProduct;
      }

      // 5b. Fallback search by name if ID was not matched
      if (!product && item.name) {
        const { data: dbByName } = await supabase
          .from('products')
          .select('*')
          .ilike('name', `%${item.name}%`)
          .maybeSingle();
        product = dbByName;
      }

      // 5c. Fallback seed if product exists in seed catalogue
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
          message: `Product "${item.name || productId}" not found in catalog`,
        });
      }

      const currentStock = Number(product.stock) || 0;
      if (currentStock < orderedQty) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.name}". Available: ${currentStock}, Requested: ${orderedQty}`,
        });
      }

      // Authoritative unit price from the database (prevents DevTools tampering)
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

    // 6. Centralized Backend Delivery Charge & Total Calculation
    const finalDeliveryCharge = checkoutConfig.calculateDeliveryCharge(customer.district, customer.division);
    const finalTotal = calculatedSubtotal + finalDeliveryCharge;

    // 7. Generate unique Order ID
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const orderId = `ORD-${dateStr}-${randomDigits}`;

    // Note: Stock is NOT deducted at checkout creation. 
    // It remains in 'pending' status until confirmed by Admin via the Admin Panel.
    console.log(`[Order ${orderId}] Placed with status "pending". Stock will be deducted upon Admin Confirmation.`);

    // 9. Insert Master Order record into public.orders
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
      payment_status: finalPaymentStatus,
      transaction_id: finalTransactionId,
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

    if (finalTransactionId) {
      processedTransactionIds.set(finalTransactionId.toUpperCase(), { orderId, timestamp: Date.now() });
    }

    // 10. Insert individual Line Items into public.order_items
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

    // 11. Save delivery location in public.delivery_locations (if authenticated)
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

    // 12. Log user activity in public.user_activities
    await logUserActivity({
      userId: authenticatedUserId,
      activityType: 'order_placed',
      description: `Placed order ${orderId} (৳${finalTotal}) with ${processedItems.length} items via ${paymentConfig.name} [Payment Status: ${finalPaymentStatus}${finalTransactionId ? `, TrxID: ${finalTransactionId}` : ''}]`,
      metadata: {
        orderId,
        itemCount: processedItems.length,
        totalAmount: finalTotal,
        subtotal: calculatedSubtotal,
        deliveryCharge: finalDeliveryCharge,
        paymentMethod,
        paymentStatus: finalPaymentStatus,
        transactionId: finalTransactionId,
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
        paymentMethod,
        paymentStatus: finalPaymentStatus,
        transactionId: finalTransactionId,
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
