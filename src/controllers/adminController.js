import { supabase } from '../config/supabase.js';
import { uploadBufferToR2, deleteFromR2, deleteFromR2ByUrl, deleteImagesListFromR2, deleteProductImages, handleProductStockZero } from '../services/r2Service.js';
import { logAdminAction } from '../services/adminAuditService.js';
import { checkoutConfig } from '../config/checkoutConfig.js';
import { formatProduct } from './productsController.js';

// Helper to determine file extension
const getExtension = (mimetype, originalname) => {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  if (mimetype === 'image/gif') return 'gif';
  if (mimetype === 'image/svg+xml') return 'svg';
  if (mimetype === 'image/avif') return 'avif';
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') return 'jpg';
  const match = originalname?.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : 'webp';
};

// ==============================================================================
// 1. DASHBOARD ANALYTICS & STATS
// ==============================================================================

/**
 * GET /api/admin/dashboard
 * Aggregates real business metrics from Supabase database
 */
export const getDashboardStats = async (req, res) => {
  try {
    // 1. Fetch Products
    const { data: products = [], error: prodErr } = await supabase.from('products').select('*');
    if (prodErr) console.warn('Dashboard products error:', prodErr.message);

    const totalProducts = products.length;
    const inStockProducts = products.filter((p) => Number(p.stock) > 5).length;
    const lowStockProducts = products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= 5).length;
    const outOfStockProducts = products.filter((p) => Number(p.stock) <= 0).length;

    // 2. Fetch Orders
    const { data: orders = [], error: ordErr } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (ordErr) console.warn('Dashboard orders error:', ordErr.message);

    const totalOrders = orders.length;
    const pendingOrders = orders.filter((o) => o.order_status === 'pending').length;
    const confirmedOrders = orders.filter((o) => o.order_status === 'confirmed').length;
    const shippedOrders = orders.filter((o) => o.order_status === 'shipped').length;
    const deliveredOrders = orders.filter((o) => o.order_status === 'delivered').length;
    const cancelledOrders = orders.filter((o) => o.order_status === 'cancelled').length;

    // Payment statuses
    const pendingVerificationPayments = orders.filter((o) => o.payment_status === 'pending_verification').length;
    const paidOrders = orders.filter((o) => o.payment_status === 'paid').length;
    const unpaidOrders = orders.filter((o) => o.payment_status === 'unpaid').length;
    const rejectedPayments = orders.filter((o) => o.payment_status === 'rejected').length;

    // 3. Sales / Revenue Calculations (Monthly total sales & realized revenue only from delivered orders)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    let totalSales = 0;
    let todaySales = 0;
    let todayOrdersCount = 0;
    let weekSales = 0;
    let monthSales = 0;

    for (const order of orders) {
      const amt = Number(order.total_amount) || 0;

      // Count only completed/delivered orders towards sales totals
      if (order.order_status === 'delivered') {
        totalSales += amt;

        if (order.created_at >= todayStart) {
          todaySales += amt;
        }
        if (order.created_at >= weekStart) {
          weekSales += amt;
        }
        if (order.created_at >= monthStart) {
          monthSales += amt;
        }
      }

      if (order.created_at >= todayStart && order.order_status !== 'cancelled') {
        todayOrdersCount++;
      }
    }

    // 4. Fetch Customers count
    const { data: profiles = [], error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (profErr) console.warn('Dashboard profiles error:', profErr.message);

    const totalCustomers = profiles.length;

    // 5. Payment Methods Distribution
    const paymentMethodsDist = {
      cod: orders.filter((o) => o.payment_method === 'cod').length,
      bkash: orders.filter((o) => o.payment_method === 'bkash').length,
      nagad: orders.filter((o) => o.payment_method === 'nagad').length,
      rocket: orders.filter((o) => o.payment_method === 'rocket').length,
    };

    // 6. Recent Orders & Low Stock items
    const recentOrders = orders.slice(0, 8);
    const lowStockItems = products.filter((p) => Number(p.stock) <= 5);
    const recentCustomers = profiles.slice(0, 6);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalRevenue: totalSales,
          todayRevenue: todaySales,
          weekRevenue: weekSales,
          monthRevenue: monthSales,
          totalOrders,
          todayOrders: todayOrdersCount,
          totalProducts,
          totalCustomers,
          pendingVerificationCount: pendingVerificationPayments,
        },
        ordersByStatus: {
          pending: pendingOrders,
          confirmed: confirmedOrders,
          shipped: shippedOrders,
          delivered: deliveredOrders,
          cancelled: cancelledOrders,
        },
        paymentsByStatus: {
          unpaid: unpaidOrders,
          pending_verification: pendingVerificationPayments,
          paid: paidOrders,
          rejected: rejectedPayments,
        },
        inventorySummary: {
          inStock: inStockProducts,
          lowStock: lowStockProducts,
          outOfStock: outOfStockProducts,
        },
        paymentMethods: paymentMethodsDist,
        recentOrders,
        recentCustomers,
        lowStockItems: lowStockItems.map(formatProduct),
      },
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate dashboard statistics' });
  }
};

// ==============================================================================
// 2. PRODUCT MANAGEMENT (CRUD + R2 FILE UPLOAD)
// ==============================================================================

/**
 * GET /api/admin/products
 * Fetch all products with search, filters, pagination
 */
export const getAdminProducts = async (req, res) => {
  try {
    const { search, category, stockStatus, page = 1, limit = 50 } = req.query;

    let query = supabase.from('products').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,brand.ilike.%${search}%`);
    }
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    if (stockStatus === 'in_stock') {
      query = query.gt('stock', 5);
    } else if (stockStatus === 'low_stock') {
      query = query.gt('stock', 0).lte('stock', 5);
    } else if (stockStatus === 'out_of_stock') {
      query = query.lte('stock', 0);
    }

    const from = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const to = from + parseInt(limit, 10) - 1;

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data: products, count, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: (products || []).map(formatProduct),
      pagination: {
        total: count || 0,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil((count || 0) / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    console.error('getAdminProducts error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch products' });
  }
};

/**
 * POST /api/admin/products
 * Creates a product by uploading image files to Cloudflare R2 and saving record to Supabase
 * Accepts multipart/form-data:
 * - fields: name, sku, category, brand, price, comparePrice, discount, stock, featured, bestSelling, shortDescription, description, specifications (JSON)
 * - files: images[]
 */
export const createAdminProduct = async (req, res) => {
  const uploadedR2Keys = [];
  const uploadedR2Urls = [];

  try {
    const {
      name,
      sku,
      category = 'wireless-earbuds',
      brand = 'Generic',
      price,
      comparePrice = null,
      discount = 0,
      stock = 0,
      featured = false,
      bestSelling = false,
      shortDescription = '',
      description = '',
      specifications = '[]',
    } = req.body;

    if (!name || price === undefined || price === null || price === '') {
      return res.status(400).json({ success: false, message: 'Product Name and Price are required' });
    }

    // Generate unique product ID and slug
    const timestamp = Date.now();
    const cleanSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const uniqueSlug = `${cleanSlug}-${timestamp.toString().slice(-4)}`;
    const productId = `prod-${timestamp.toString().slice(-6)}`;

    // 1. Upload files to Cloudflare R2
    const files = req.files || [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = getExtension(file.mimetype, file.originalname);
      const key = `products/${productId}/image-${i + 1}.${ext}`;

      const publicUrl = await uploadBufferToR2(file.buffer, key, file.mimetype);
      uploadedR2Keys.push(key);
      uploadedR2Urls.push(publicUrl);
    }

    // Parse specifications JSON
    let parsedSpecs = [];
    try {
      parsedSpecs = typeof specifications === 'string' ? JSON.parse(specifications) : specifications;
      if (!Array.isArray(parsedSpecs)) parsedSpecs = [];
    } catch {
      parsedSpecs = [];
    }

    // 2. Insert record into Supabase products table
    const productRecord = {
      id: productId,
      name: name.trim(),
      slug: uniqueSlug,
      sku: sku ? sku.trim() : `SKU-${productId.toUpperCase()}`,
      category: category.trim(),
      brand: brand.trim(),
      price: Number(price),
      compare_price: comparePrice ? Number(comparePrice) : null,
      discount: Number(discount) || 0,
      rating: 0,
      review_count: 0,
      stock: Math.max(0, parseInt(stock, 10) || 0),
      featured: String(featured) === 'true' || featured === true,
      best_selling: String(bestSelling) === 'true' || bestSelling === true,
      short_description: shortDescription ? shortDescription.trim() : '',
      description: description ? description.trim() : '',
      images: uploadedR2Urls,
      specifications: parsedSpecs,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: createdProduct, error: insertError } = await supabase
      .from('products')
      .insert(productRecord)
      .select()
      .single();

    if (insertError) {
      // Rollback: Purge uploaded R2 objects on DB failure to avoid orphaned files
      console.warn('[R2 Rollback] Supabase insert failed. Purging newly uploaded R2 files:', uploadedR2Keys);
      for (const key of uploadedR2Keys) {
        await deleteFromR2(key);
      }
      throw insertError;
    }

    // 3. Log admin action
    await logAdminAction({
      adminUser: req.user,
      action: 'PRODUCT_CREATED',
      targetType: 'product',
      targetId: productId,
      description: `Created product "${name}" (৳${price}, Stock: ${stock}) with ${uploadedR2Urls.length} R2 images`,
      metadata: { productId, name, price, stock, imageCount: uploadedR2Urls.length },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Product created successfully with Cloudflare R2 images',
      data: formatProduct(createdProduct),
    });
  } catch (err) {
    console.error('createAdminProduct error:', err);
    // Cleanup any uploaded images if error occurred
    if (uploadedR2Keys.length > 0) {
      for (const key of uploadedR2Keys) {
        await deleteFromR2(key).catch(() => {});
      }
    }
    return res.status(500).json({ success: false, message: err.message || 'Failed to create product' });
  }
};

/**
 * PUT /api/admin/products/:id
 * Updates product details and handles new image uploads + deletion of removed images from R2
 */
export const updateAdminProduct = async (req, res) => {
  const newUploadedKeys = [];
  const newUploadedUrls = [];

  try {
    const { id } = req.params;

    // 1. Fetch current product record
    const { data: currentProduct, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !currentProduct) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const {
      name,
      sku,
      category,
      brand,
      price,
      comparePrice,
      discount,
      stock,
      featured,
      bestSelling,
      shortDescription,
      description,
      specifications,
      existingImages = '[]', // List of previously stored URLs that the admin chose to keep
    } = req.body;

    // Parse kept image URLs
    let keptImageUrls = [];
    try {
      keptImageUrls = typeof existingImages === 'string' ? JSON.parse(existingImages) : existingImages;
      if (!Array.isArray(keptImageUrls)) keptImageUrls = [];
    } catch {
      keptImageUrls = Array.isArray(currentProduct.images) ? currentProduct.images : [];
    }

    // 2. Upload any new image files to R2
    const files = req.files || [];
    const startIndex = keptImageUrls.length;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = getExtension(file.mimetype, file.originalname);
      const key = `products/${id}/image-${startIndex + i + 1}-${Date.now()}.${ext}`;

      const publicUrl = await uploadBufferToR2(file.buffer, key, file.mimetype);
      newUploadedKeys.push(key);
      newUploadedUrls.push(publicUrl);
    }

    const finalImagesList = [...keptImageUrls, ...newUploadedUrls];

    // Parse specs
    let parsedSpecs = currentProduct.specifications || [];
    if (specifications !== undefined) {
      try {
        parsedSpecs = typeof specifications === 'string' ? JSON.parse(specifications) : specifications;
        if (!Array.isArray(parsedSpecs)) parsedSpecs = [];
      } catch {
        parsedSpecs = currentProduct.specifications || [];
      }
    }

    const newStockVal = stock !== undefined ? Math.max(0, parseInt(stock, 10)) : currentProduct.stock;

    // 3. Update Supabase record
    const updatePayload = {
      ...(name && { name: name.trim() }),
      ...(sku && { sku: sku.trim() }),
      ...(category && { category: category.trim() }),
      ...(brand && { brand: brand.trim() }),
      ...(price !== undefined && { price: Number(price) }),
      ...(comparePrice !== undefined && { compare_price: comparePrice ? Number(comparePrice) : null }),
      ...(discount !== undefined && { discount: Number(discount) || 0 }),
      stock: newStockVal,
      ...(featured !== undefined && { featured: String(featured) === 'true' || featured === true }),
      ...(bestSelling !== undefined && { best_selling: String(bestSelling) === 'true' || bestSelling === true }),
      ...(shortDescription !== undefined && { short_description: shortDescription.trim() }),
      ...(description !== undefined && { description: description.trim() }),
      images: finalImagesList,
      specifications: parsedSpecs,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedProduct, error: updateErr } = await supabase
      .from('products')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      // Rollback newly uploaded R2 files
      console.warn('[R2 Rollback] Supabase update failed. Cleaning up newly uploaded R2 files:', newUploadedKeys);
      for (const key of newUploadedKeys) {
        await deleteFromR2(key);
      }
      throw updateErr;
    }

    // 4. Safe post-update cleanup: Identify and purge deleted old images from Cloudflare R2
    const oldImages = Array.isArray(currentProduct.images) ? currentProduct.images : [];
    const imagesToDelete = oldImages.filter((oldUrl) => !keptImageUrls.includes(oldUrl));

    if (imagesToDelete.length > 0) {
      console.log(`[R2 Cleanup] Deleting ${imagesToDelete.length} removed images for product ${id}...`);
      await deleteImagesListFromR2(imagesToDelete);
    }

    // 5. Log admin action
    await logAdminAction({
      adminUser: req.user,
      action: 'PRODUCT_UPDATED',
      targetType: 'product',
      targetId: id,
      description: `Updated product "${updatedProduct.name}" (Price: ৳${updatedProduct.price}, Stock: ${updatedProduct.stock})`,
      metadata: { productId: id, changes: updatePayload },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: formatProduct(updatedProduct),
    });
  } catch (err) {
    console.error('updateAdminProduct error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update product' });
  }
};

/**
 * DELETE /api/admin/products/:id
 * Purges all images associated with the product from Cloudflare R2, then removes record from Supabase
 */
export const deleteAdminProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Fetch product to get name and images
    const { data: product, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // 2. Delete all Cloudflare R2 images first
    console.log(`[R2] Purging all images for product ${id}...`);
    await deleteProductImages(id);

    // 3. Delete from Supabase
    const { error: deleteErr } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (deleteErr) throw deleteErr;

    // 4. Log admin audit action
    await logAdminAction({
      adminUser: req.user,
      action: 'PRODUCT_DELETED',
      targetType: 'product',
      targetId: id,
      description: `Deleted product "${product.name}" (${id}) and purged all R2 image assets`,
      metadata: { productId: id, name: product.name, imageCount: product.images?.length || 0 },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Product "${product.name}" and all associated R2 images were deleted successfully`,
    });
  } catch (err) {
    console.error('deleteAdminProduct error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to delete product' });
  }
};

/**
 * PATCH /api/admin/products/:id/stock
 * Directly sets or adjusts stock quantity for a product
 */
export const adjustProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock, delta } = req.body;

    const { data: product, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    let newStock = Number(product.stock) || 0;
    if (stock !== undefined && stock !== null) {
      newStock = Math.max(0, parseInt(stock, 10));
    } else if (delta !== undefined && delta !== null) {
      newStock = Math.max(0, newStock + parseInt(delta, 10));
    }

    const { data: updated, error: updateErr } = await supabase
      .from('products')
      .update({ stock: newStock, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Log action
    await logAdminAction({
      adminUser: req.user,
      action: 'STOCK_CHANGED',
      targetType: 'product',
      targetId: id,
      description: `Adjusted stock for "${product.name}": ${product.stock} -> ${newStock}`,
      metadata: { productId: id, oldStock: product.stock, newStock },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Stock updated for "${product.name}"`,
      data: formatProduct(updated),
    });
  } catch (err) {
    console.error('adjustProductStock error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to adjust stock' });
  }
};

// ==============================================================================
// 3. ORDER MANAGEMENT & STATUS FLOW
// ==============================================================================

/**
 * GET /api/admin/orders
 * List orders with advanced filtering (status, payment_status, payment_method, search, date range)
 */
export const getAdminOrders = async (req, res) => {
  try {
    const {
      search,
      orderStatus,
      paymentStatus,
      paymentMethod,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = req.query;

    let query = supabase
      .from('orders')
      .select('*, order_items (*)', { count: 'exact' });

    if (search) {
      query = query.or(`id.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,transaction_id.ilike.%${search}%`);
    }
    if (orderStatus && orderStatus !== 'all') {
      query = query.eq('order_status', orderStatus);
    }
    if (paymentStatus && paymentStatus !== 'all') {
      query = query.eq('payment_status', paymentStatus);
    }
    if (paymentMethod && paymentMethod !== 'all') {
      query = query.eq('payment_method', paymentMethod);
    }
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const from = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const to = from + parseInt(limit, 10) - 1;

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data: orders, count, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: orders || [],
      pagination: {
        total: count || 0,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil((count || 0) / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    console.error('getAdminOrders error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch orders' });
  }
};

/**
 * GET /api/admin/orders/:id
 * Retrieve full order details including line items and customer info
 */
export const getAdminOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (err) {
    console.error('getAdminOrderById error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/admin/orders/:id/status
 * Updates order status: pending -> confirmed -> shipped -> delivered or cancelled.
 * If cancelled: atomically restores product stock without double-restoring.
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid order status. Allowed: ${validStatuses.join(', ')}`,
      });
    }

    // 1. Fetch current order with line items
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const previousStatus = order.order_status;
    if (previousStatus === status) {
      return res.status(200).json({ success: true, message: `Order status is already "${status}"`, data: order });
    }

    const items = order.order_items || [];

    // 2. Stock Deduction when Order is Officially Confirmed (pending -> confirmed)
    if (status === 'confirmed' && previousStatus === 'pending') {
      console.log(`[Order Confirmed] Deducting stock for items in order ${id}...`);
      for (const item of items) {
        if (item.product_id && item.quantity > 0) {
          const { data: prod } = await supabase
            .from('products')
            .select('*')
            .eq('id', item.product_id)
            .maybeSingle();

          if (prod) {
            const currentStock = Number(prod.stock || 0);
            const newStock = Math.max(0, currentStock - item.quantity);

            if (newStock === 0 && currentStock > 0) {
              console.log(`[Order Confirmed] Product ${prod.id} stock reached 0. Purging R2 images.`);
              await handleProductStockZero(prod.id, prod.images);
              await supabase
                .from('products')
                .update({ stock: 0, images: [], updated_at: new Date().toISOString() })
                .eq('id', prod.id);
            } else {
              await supabase
                .from('products')
                .update({ stock: newStock, updated_at: new Date().toISOString() })
                .eq('id', prod.id);
            }
            console.log(`[Order Confirmed] Product ${item.product_id} stock: ${currentStock} -> ${newStock} (-${item.quantity})`);
          }
        }
      }
    }

    // 3. Idempotent stock restoration on cancellation (only if was previously confirmed/shipped)
    if (status === 'cancelled' && (previousStatus === 'confirmed' || previousStatus === 'shipped')) {
      console.log(`[Order Cancelled] Restoring stock for items in order ${id}...`);
      for (const item of items) {
        if (item.product_id && item.quantity > 0) {
          const { data: prod } = await supabase
            .from('products')
            .select('stock')
            .eq('id', item.product_id)
            .maybeSingle();

          if (prod) {
            const restoredStock = Number(prod.stock || 0) + item.quantity;
            await supabase
              .from('products')
              .update({ stock: restoredStock, updated_at: new Date().toISOString() })
              .eq('id', item.product_id);
            console.log(`[Order Cancelled] Product ${item.product_id} stock restored: ${prod.stock} -> ${restoredStock} (+${item.quantity})`);
          }
        }
      }
    }

    // 4. If status is 'cancelled' or 'delivered', delete from database automatically
    if (status === 'cancelled' || status === 'delivered') {
      console.log(`[Order ${status.toUpperCase()}] Deleting order ${id} from database...`);
      // Delete order items first
      await supabase.from('order_items').delete().eq('order_id', id);

      // Delete order from orders table
      const { error: deleteOrderErr } = await supabase.from('orders').delete().eq('id', id);
      if (deleteOrderErr) throw deleteOrderErr;

      // Log admin audit action
      await logAdminAction({
        adminUser: req.user,
        action: status === 'cancelled' ? 'ORDER_CANCELLED_AND_DELETED' : 'ORDER_DELIVERED_AND_DELETED',
        targetType: 'order',
        targetId: id,
        description: `Order ${id} was marked as "${status}" and automatically deleted from database`,
        metadata: { orderId: id, previousStatus, newStatus: status, deleted: true },
        req,
      });

      return res.status(200).json({
        success: true,
        deleted: true,
        message: `Order ${id} marked as "${status}" and removed from database`,
        data: { id, order_status: status, deleted: true },
      });
    }

    // 5. Otherwise update order status in Supabase (for pending, confirmed, shipped)
    const { data: updatedOrder, error: updateErr } = await supabase
      .from('orders')
      .update({
        order_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*, order_items (*)')
      .single();

    if (updateErr) throw updateErr;

    // 6. Log admin audit action
    await logAdminAction({
      adminUser: req.user,
      action: status === 'confirmed' ? 'ORDER_CONFIRMED' : 'ORDER_STATUS_CHANGED',
      targetType: 'order',
      targetId: id,
      description: `Changed order ${id} status: ${previousStatus} -> ${status}${status === 'confirmed' ? ' (Stock Deducted & Order Confirmed)' : ''}`,
      metadata: { orderId: id, previousStatus, newStatus: status },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Order status updated to "${status}"`,
      data: updatedOrder,
    });
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update order status' });
  }
};

// ==============================================================================
// 4. MANUAL PAYMENT VERIFICATION QUEUE (bKash / Nagad / Rocket / COD)
// ==============================================================================

/**
 * PATCH /api/admin/orders/:id/payment
 * Manually confirms ('paid') or rejects ('rejected') a payment after admin reviews statement
 */
export const verifyPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus, autoConfirmOrder = true } = req.body; // 'paid' or 'rejected' or 'unpaid'

    const validPaymentStatuses = ['paid', 'rejected', 'unpaid', 'pending_verification'];
    if (!validPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment status. Allowed values: ${validPaymentStatuses.join(', ')}`,
      });
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const previousPaymentStatus = order.payment_status;
    const updatePayload = {
      payment_status: paymentStatus,
      updated_at: new Date().toISOString(),
    };

    // If payment is marked as paid and order was pending, confirm order and deduct stock
    if (paymentStatus === 'paid' && order.order_status === 'pending' && autoConfirmOrder) {
      updatePayload.order_status = 'confirmed';
      const items = order.order_items || [];
      console.log(`[Payment Approved] Auto-confirming order ${id} and deducting stock...`);
      for (const item of items) {
        if (item.product_id && item.quantity > 0) {
          const { data: prod } = await supabase
            .from('products')
            .select('*')
            .eq('id', item.product_id)
            .maybeSingle();

          if (prod) {
            const currentStock = Number(prod.stock || 0);
            const newStock = Math.max(0, currentStock - item.quantity);

            if (newStock === 0 && currentStock > 0) {
              await handleProductStockZero(prod.id, prod.images);
              await supabase
                .from('products')
                .update({ stock: 0, images: [], updated_at: new Date().toISOString() })
                .eq('id', prod.id);
            } else {
              await supabase
                .from('products')
                .update({ stock: newStock, updated_at: new Date().toISOString() })
                .eq('id', prod.id);
            }
          }
        }
      }
    }

    // Update in Supabase
    const { data: updatedOrder, error: updateErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', id)
      .select('*, order_items (*)')
      .single();

    if (updateErr) throw updateErr;

    // Log admin audit action
    const actionName = paymentStatus === 'paid' ? 'PAYMENT_APPROVED' : paymentStatus === 'rejected' ? 'PAYMENT_REJECTED' : 'PAYMENT_STATUS_UPDATED';

    await logAdminAction({
      adminUser: req.user,
      action: actionName,
      targetType: 'payment',
      targetId: id,
      description: `${actionName}: Order ${id} (${order.payment_method?.toUpperCase()}, TrxID: ${order.transaction_id || 'N/A'}) changed from ${previousPaymentStatus} to ${paymentStatus}`,
      metadata: {
        orderId: id,
        paymentMethod: order.payment_method,
        transactionId: order.transaction_id,
        amount: order.total_amount,
        previousPaymentStatus,
        newPaymentStatus: paymentStatus,
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Payment status updated to "${paymentStatus}"`,
      data: updatedOrder,
    });
  } catch (err) {
    console.error('verifyPayment error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to verify payment' });
  }
};

// ==============================================================================
// 5. CUSTOMER & USER MANAGEMENT
// ==============================================================================

/**
 * GET /api/admin/customers
 * Lists all registered users with aggregated order metrics
 */
export const getAdminCustomers = async (req, res) => {
  try {
    const { search } = req.query;

    let query = supabase.from('profiles').select('*').order('created_at', { ascending: false });

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data: profiles, error: profErr } = await query;
    if (profErr) throw profErr;

    // Fetch orders to aggregate customer lifetime spend
    const { data: orders = [] } = await supabase.from('orders').select('id, user_id, customer_email, total_amount, order_status, created_at');

    const customerList = (profiles || []).map((prof) => {
      const userOrders = orders.filter((o) => o.user_id === prof.id || (prof.email && o.customer_email === prof.email));
      const totalSpent = userOrders
        .filter((o) => o.order_status !== 'cancelled')
        .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

      return {
        id: prof.id,
        fullName: prof.full_name || 'Anonymous User',
        email: prof.email,
        phone: prof.phone || 'N/A',
        role: prof.role || 'customer',
        avatarUrl: prof.avatar_url,
        createdAt: prof.created_at,
        lastLoginAt: prof.last_login_at,
        orderCount: userOrders.length,
        totalSpent,
      };
    });

    return res.status(200).json({
      success: true,
      data: customerList,
    });
  } catch (err) {
    console.error('getAdminCustomers error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch customers' });
  }
};

/**
 * GET /api/admin/customers/:id
 * Fetches single customer details, saved addresses, and complete order history
 */
export const getAdminCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (profErr || !profile) {
      return res.status(404).json({ success: false, message: 'Customer profile not found' });
    }

    // Orders for this user
    const { data: orders = [] } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .or(`user_id.eq.${id},customer_email.eq.${profile.email}`)
      .order('created_at', { ascending: false });

    // Saved delivery locations
    const { data: addresses = [] } = await supabase
      .from('delivery_locations')
      .select('*')
      .eq('user_id', id);

    // Login activity
    const { data: logins = [] } = await supabase
      .from('user_logins')
      .select('*')
      .eq('user_id', id)
      .order('login_timestamp', { ascending: false })
      .limit(10);

    const totalSpent = orders
      .filter((o) => o.order_status !== 'cancelled')
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        profile,
        orders,
        addresses,
        logins,
        summary: {
          totalOrders: orders.length,
          totalSpent,
        },
      },
    });
  } catch (err) {
    console.error('getAdminCustomerById error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ==============================================================================
// 6. INVENTORY MANAGEMENT
// ==============================================================================

/**
 * GET /api/admin/inventory
 * Inventory list with stock classification and filter
 */
export const getAdminInventory = async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .order('stock', { ascending: true });

    if (error) throw error;

    const inventory = (products || []).map((p) => {
      const stock = Number(p.stock) || 0;
      let status = 'in_stock';
      if (stock === 0) status = 'out_of_stock';
      else if (stock <= 5) status = 'low_stock';

      return {
        ...formatProduct(p),
        stockStatus: status,
      };
    });

    return res.status(200).json({
      success: true,
      data: inventory,
    });
  } catch (err) {
    console.error('getAdminInventory error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ==============================================================================
// 7. ACTIVITY & ADMIN AUDIT LOGS
// ==============================================================================

/**
 * GET /api/admin/activity-logs
 * Fetch administrative audit trail and user timeline logs
 */
export const getAdminAuditLogs = async (req, res) => {
  try {
    const { action, limit = 100 } = req.query;

    let query = supabase
      .from('admin_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10));

    if (action) {
      query = query.eq('action', action);
    }

    const { data: auditLogs = [], error: auditErr } = await query;
    if (auditErr) console.warn('Audit logs fetch warning:', auditErr.message);

    // Also get recent user activities
    const { data: userActivities = [] } = await supabase
      .from('user_activities')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    return res.status(200).json({
      success: true,
      data: {
        adminAuditLogs: auditLogs || [],
        userActivities: userActivities || [],
      },
    });
  } catch (err) {
    console.error('getAdminAuditLogs error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ==============================================================================
// 8. STORE SETTINGS & CONFIGURATION
// ==============================================================================

/**
 * GET /api/admin/settings
 * Fetch current store settings (delivery fees, low stock threshold, payment numbers)
 */
export const getAdminSettings = async (req, res) => {
  try {
    const { data: settingsList = [], error } = await supabase.from('store_settings').select('*');
    if (error) console.warn('Store settings fetch notice:', error.message);

    const settingsMap = {};
    for (const item of settingsList || []) {
      settingsMap[item.key] = item.value;
    }

    // Merge with defaults
    const finalSettings = {
      delivery: settingsMap.delivery || {
        insideDhaka: checkoutConfig.delivery.insideDhaka,
        outsideDhaka: checkoutConfig.delivery.outsideDhaka,
      },
      paymentAccounts: settingsMap.payment_accounts || {
        bkash: process.env.BKASH_NUMBER || '01611521209',
        nagad: process.env.NAGAD_NUMBER || '01342250023',
        rocket: process.env.ROCKET_NUMBER || '016115212098',
      },
      inventory: settingsMap.inventory || {
        lowStockThreshold: 5,
      },
      storeInfo: settingsMap.store_info || {
        storeName: 'Gazet',
        supportPhone: '+880 1700-000000',
        supportEmail: 'support@gazet.com.bd',
        currencySymbol: '৳',
      },
    };

    return res.status(200).json({
      success: true,
      data: finalSettings,
    });
  } catch (err) {
    console.error('getAdminSettings error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/admin/settings
 * Updates store configuration in Supabase store_settings table
 */
export const updateAdminSettings = async (req, res) => {
  try {
    const { delivery, paymentAccounts, inventory, storeInfo } = req.body;

    const updates = [];

    if (delivery) {
      updates.push(
        supabase.from('store_settings').upsert({
          key: 'delivery',
          value: delivery,
          description: 'Standard delivery charges across Bangladesh',
          updated_by: req.user.id,
          updated_at: new Date().toISOString(),
        })
      );
      // Synchronize in-memory config
      if (delivery.insideDhaka !== undefined) checkoutConfig.delivery.insideDhaka = Number(delivery.insideDhaka);
      if (delivery.outsideDhaka !== undefined) checkoutConfig.delivery.outsideDhaka = Number(delivery.outsideDhaka);
    }

    if (paymentAccounts) {
      updates.push(
        supabase.from('store_settings').upsert({
          key: 'payment_accounts',
          value: paymentAccounts,
          description: 'Personal payment account numbers',
          updated_by: req.user.id,
          updated_at: new Date().toISOString(),
        })
      );
      if (paymentAccounts.bkash && checkoutConfig.paymentMethods.bkash) checkoutConfig.paymentMethods.bkash.accountNumber = paymentAccounts.bkash;
      if (paymentAccounts.nagad && checkoutConfig.paymentMethods.nagad) checkoutConfig.paymentMethods.nagad.accountNumber = paymentAccounts.nagad;
      if (paymentAccounts.rocket && checkoutConfig.paymentMethods.rocket) checkoutConfig.paymentMethods.rocket.accountNumber = paymentAccounts.rocket;
    }

    if (inventory) {
      updates.push(
        supabase.from('store_settings').upsert({
          key: 'inventory',
          value: inventory,
          description: 'Inventory thresholds',
          updated_by: req.user.id,
          updated_at: new Date().toISOString(),
        })
      );
    }

    if (storeInfo) {
      updates.push(
        supabase.from('store_settings').upsert({
          key: 'store_info',
          value: storeInfo,
          description: 'General store contact & branding information',
          updated_by: req.user.id,
          updated_at: new Date().toISOString(),
        })
      );
    }

    await Promise.all(updates);

    // Log admin audit action
    await logAdminAction({
      adminUser: req.user,
      action: 'SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: 'global',
      description: 'Updated store configuration (delivery rates, payment numbers, or store info)',
      metadata: req.body,
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Store settings updated successfully',
    });
  } catch (err) {
    console.error('updateAdminSettings error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
