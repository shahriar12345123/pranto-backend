import { supabase } from '../config/supabase.js';
import { initialProducts } from '../data/seedProducts.js';
import { 
  deleteProductImages, 
  deleteImagesListFromR2, 
  handleProductStockZero 
} from '../services/r2Service.js';

// Helper to format database product records (snake_case) to client format (camelCase)
export const formatProduct = (p) => {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    category: p.category,
    brand: p.brand,
    price: Number(p.price),
    comparePrice: p.compare_price !== null && p.compare_price !== undefined ? Number(p.compare_price) : null,
    discount: p.discount,
    rating: Number(p.rating || 0),
    reviewCount: p.review_count || 0,
    stock: p.stock !== null && p.stock !== undefined ? Number(p.stock) : 0,
    featured: Boolean(p.featured),
    bestSelling: Boolean(p.best_selling),
    shortDescription: p.short_description,
    description: p.description,
    images: Array.isArray(p.images) ? p.images : [],
    specifications: Array.isArray(p.specifications) ? p.specifications : []
  };
};

// GET /api/products
export const getProducts = async (req, res) => {
  try {
    const { category, brand, search, featured, bestSelling, sort, limit } = req.query;

    let query = supabase.from('products').select('*').neq('category', 'archived');

    if (category) {
      query = query.eq('category', category);
    }

    if (brand) {
      query = query.eq('brand', brand);
    }

    if (featured === 'true') {
      query = query.eq('featured', true);
    }

    if (bestSelling === 'true') {
      query = query.eq('best_selling', true);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    if (sort === 'price-low-high') {
      query = query.order('price', { ascending: true });
    } else if (sort === 'price-high-low') {
      query = query.order('price', { ascending: false });
    } else if (sort === 'rating') {
      query = query.order('rating', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: true });
    }

    if (limit) {
      query = query.limit(parseInt(limit, 10));
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching products from Supabase:', error);
      return res.status(200).json({
        success: true,
        data: initialProducts.map(formatProduct)
      });
    }

    if (!data || data.length === 0) {
      return res.status(200).json({
        success: true,
        data: initialProducts.map(formatProduct)
      });
    }

    return res.status(200).json({
      success: true,
      data: data.map(formatProduct)
    });
  } catch (err) {
    console.error('getProducts error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve products'
    });
  }
};

// GET /api/products/:slug
export const getProductBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .or(`slug.eq.${slug},id.eq.${slug}`)
      .maybeSingle();

    if (error) {
      console.error('Error fetching product by slug/id:', error);
    }

    if (data) {
      return res.status(200).json({
        success: true,
        data: formatProduct(data)
      });
    }

    // Fallback in memory
    const fallbackProduct = initialProducts.find(
      (p) => p.slug === slug || p.id === slug
    );

    if (fallbackProduct) {
      return res.status(200).json({
        success: true,
        data: formatProduct(fallbackProduct)
      });
    }

    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  } catch (err) {
    console.error('getProductBySlug error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve product'
    });
  }
};

// POST /api/products (Create new product - for future Admin Panel)
export const createProduct = async (req, res) => {
  try {
    const p = req.body;
    
    if (!p.name || !p.price) {
      return res.status(400).json({
        success: false,
        message: 'Product name and price are required'
      });
    }

    const productId = p.id || `prod-${Date.now()}`;
    const slug = p.slug || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const record = {
      id: productId,
      name: p.name,
      slug: slug,
      sku: p.sku || `SKU-${Date.now()}`,
      category: p.category || 'gadgets',
      brand: p.brand || 'Gazet',
      price: Number(p.price),
      compare_price: p.comparePrice ? Number(p.comparePrice) : null,
      discount: p.discount || (p.comparePrice ? Math.round(((p.comparePrice - p.price) / p.comparePrice) * 100) : 0),
      rating: p.rating || 5.0,
      review_count: p.reviewCount || 0,
      stock: p.stock !== undefined ? Number(p.stock) : 10,
      featured: Boolean(p.featured),
      best_selling: Boolean(p.bestSelling),
      short_description: p.shortDescription || '',
      description: p.description || '',
      images: Array.isArray(p.images) ? p.images : [],
      specifications: Array.isArray(p.specifications) ? p.specifications : []
    };

    const { data, error } = await supabase
      .from('products')
      .insert(record)
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: formatProduct(data)
    });
  } catch (err) {
    console.error('createProduct error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to create product'
    });
  }
};

// PUT /api/products/:id (Update product - for future Admin Panel)
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Fetch existing product first
    const { data: existing, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.slug !== undefined) payload.slug = updates.slug;
    if (updates.sku !== undefined) payload.sku = updates.sku;
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.brand !== undefined) payload.brand = updates.brand;
    if (updates.price !== undefined) payload.price = Number(updates.price);
    if (updates.comparePrice !== undefined) payload.compare_price = Number(updates.comparePrice);
    if (updates.discount !== undefined) payload.discount = Number(updates.discount);
    if (updates.rating !== undefined) payload.rating = Number(updates.rating);
    if (updates.reviewCount !== undefined) payload.review_count = Number(updates.reviewCount);
    if (updates.stock !== undefined) payload.stock = Number(updates.stock);
    if (updates.featured !== undefined) payload.featured = Boolean(updates.featured);
    if (updates.bestSelling !== undefined) payload.best_selling = Boolean(updates.bestSelling);
    if (updates.shortDescription !== undefined) payload.short_description = updates.shortDescription;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.images !== undefined) payload.images = updates.images;
    if (updates.specifications !== undefined) payload.specifications = updates.specifications;

    // Check if stock is being set to 0
    if (payload.stock === 0 && existing.stock > 0) {
      console.log(`[Product Update] Stock reduced to 0 for ${id}. Triggering R2 image purge.`);
      await handleProductStockZero(id, existing.images);
      payload.images = []; // Clear image array
    }

    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: formatProduct(data)
    });
  } catch (err) {
    console.error('updateProduct error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update product'
    });
  }
};

// PATCH /api/products/:id/stock (Update stock independently)
export const updateProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;

    if (stock === undefined || isNaN(Number(stock))) {
      return res.status(400).json({ success: false, message: 'Valid numerical "stock" value required' });
    }

    const newStock = Math.max(0, Number(stock));

    const { data: existing, error: fetchErr } = await supabase
      .from('products')
      .select('id, name, stock, images')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // If stock became 0, purge R2 images
    if (newStock === 0 && existing.stock > 0) {
      console.log(`[Stock Update] Stock reached 0 for product ${id}. Purging R2 images.`);
      await handleProductStockZero(id, existing.images);
    }

    const updatePayload = {
      stock: newStock,
      ...(newStock === 0 ? { images: [] } : {})
    };

    const { data, error } = await supabase
      .from('products')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: newStock === 0 
        ? 'Stock updated to 0 and product images permanently purged from R2' 
        : `Stock updated to ${newStock}`,
      data: formatProduct(data)
    });
  } catch (err) {
    console.error('updateProductStock error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update product stock'
    });
  }
};

// DELETE /api/products/:id (Delete product and all its R2 images)
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Read product from Supabase to retrieve image URLs
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      console.error(`Error fetching product ${id} before deletion:`, fetchError);
    }

    // 2. Delete associated image files from Cloudflare R2
    if (product) {
      if (Array.isArray(product.images) && product.images.length > 0) {
        console.log(`[Product Delete] Deleting ${product.images.length} images from R2 for product ${id}...`);
        await deleteImagesListFromR2(product.images);
      }
      // Also scan and clean up any remaining objects in products/${id}/ folder
      await deleteProductImages(id);
    }

    // 3. Delete product record from Supabase
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    return res.status(200).json({
      success: true,
      message: `Product ${id} and all associated Cloudflare R2 images were permanently deleted.`,
    });
  } catch (err) {
    console.error('deleteProduct error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to delete product',
    });
  }
};

// POST /api/products/seed
export const seedProducts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .upsert(initialProducts, { onConflict: 'id' })
      .select();

    if (error) {
      console.error('Seed products error:', error);
      return res.status(500).json({
        success: false,
        message: error.message,
        error
      });
    }

    return res.status(200).json({
      success: true,
      message: `Successfully seeded ${data.length} products to Supabase!`,
      data
    });
  } catch (err) {
    console.error('seedProducts error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to seed products'
    });
  }
};
