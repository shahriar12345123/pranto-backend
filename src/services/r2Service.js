import { PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { r2Client, R2_CONFIG } from '../config/r2.js';
import { supabase } from '../config/supabase.js';

/**
 * Upload a raw buffer to Cloudflare R2 bucket
 * @param {Buffer} buffer 
 * @param {string} key - R2 destination key (e.g. 'products/prod-001/image-1.jpg')
 * @param {string} contentType - MIME type (e.g. 'image/jpeg')
 * @returns {Promise<string>} Public URL of the uploaded image
 */
export const uploadBufferToR2 = async (buffer, key, contentType = 'image/jpeg') => {
  if (!R2_CONFIG.accessKeyId || !R2_CONFIG.secretAccessKey) {
    throw new Error('R2 credentials (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) are not configured in backend/.env');
  }

  const cleanKey = key.replace(/^\/+/, '');

  const command = new PutObjectCommand({
    Bucket: R2_CONFIG.bucketName,
    Key: cleanKey,
    Body: buffer,
    ContentType: contentType,
  });

  await r2Client.send(command);

  return `${R2_CONFIG.publicUrl}/${cleanKey}`;
};

/**
 * Delete an object from Cloudflare R2 bucket by its key
 * @param {string} key - Object key (e.g. 'products/prod-001/image-1.jpg')
 */
export const deleteFromR2 = async (key) => {
  if (!key) return;
  const cleanKey = key.replace(/^\/+/, '');
  
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_CONFIG.bucketName,
      Key: cleanKey,
    });

    await r2Client.send(command);
    console.log(`[R2] Deleted object: ${cleanKey}`);
  } catch (err) {
    console.warn(`[R2] Warning deleting key "${cleanKey}":`, err.message);
  }
};

/**
 * Extract R2 object key from a full public R2 URL
 * @param {string} url - Full URL e.g. 'https://pub-xxx.r2.dev/products/prod-001/image-1.jpg'
 * @returns {string|null} Key e.g. 'products/prod-001/image-1.jpg' or null if not an R2 URL
 */
export const extractKeyFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;

  // If it's already a relative key
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return url.replace(/^\/+/, '');
  }

  // If it starts with R2_PUBLIC_URL
  if (url.startsWith(R2_CONFIG.publicUrl)) {
    const relativePath = url.substring(R2_CONFIG.publicUrl.length);
    return relativePath.replace(/^\/+/, '');
  }

  // General URL fallback: extract pathname after domain
  try {
    const parsed = new URL(url);
    // Remove leading slash
    return parsed.pathname.replace(/^\/+/, '');
  } catch {
    return null;
  }
};

/**
 * Delete an image from R2 by its public URL
 * @param {string} url - Full R2 public URL
 */
export const deleteFromR2ByUrl = async (url) => {
  const key = extractKeyFromUrl(url);
  if (key) {
    await deleteFromR2(key);
  }
};

/**
 * Delete a list of image URLs or keys from Cloudflare R2
 * @param {string[]} imageUrls - Array of image URLs or keys
 */
export const deleteImagesListFromR2 = async (imageUrls) => {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) return;

  for (const item of imageUrls) {
    if (typeof item === 'string' && item.trim()) {
      await deleteFromR2ByUrl(item);
    }
  }
};

/**
 * Delete all images associated with a product ID from R2
 * @param {string} productId - Product ID (e.g. 'prod-001')
 */
export const deleteProductImages = async (productId) => {
  if (!productId) return;

  // 1. First fetch product from Supabase to get known image URLs
  try {
    const { data: product } = await supabase
      .from('products')
      .select('images')
      .eq('id', productId)
      .maybeSingle();

    if (product && Array.isArray(product.images) && product.images.length > 0) {
      await deleteImagesListFromR2(product.images);
    }
  } catch (err) {
    console.warn(`[R2] Error fetching product ${productId} images from DB:`, err.message);
  }

  // 2. Also attempt to list and delete any remaining objects under products/{productId}/ prefix in R2
  try {
    const prefix = `products/${productId}/`;
    const listCommand = new ListObjectsV2Command({
      Bucket: R2_CONFIG.bucketName,
      Prefix: prefix,
    });

    const listedObjects = await r2Client.send(listCommand);

    if (listedObjects.Contents && listedObjects.Contents.length > 0) {
      for (const obj of listedObjects.Contents) {
        if (obj.Key) {
          await deleteFromR2(obj.Key);
        }
      }
    }
  } catch (err) {
    console.warn(`[R2] Warning scanning prefix for product ${productId}:`, err.message);
  }
};

/**
 * Triggered when a product's stock reaches 0:
 * 1. Permanently deletes its product images from R2
 * 2. Clears product.images array in Supabase (sets to [])
 * @param {string} productId - Product ID
 * @param {string[]} existingImages - Optional list of images if already known
 */
export const handleProductStockZero = async (productId, existingImages = null) => {
  if (!productId) return;

  try {
    let imagesToDelete = existingImages;

    // If images not provided, fetch from Supabase
    if (!imagesToDelete) {
      const { data: product } = await supabase
        .from('products')
        .select('images')
        .eq('id', productId)
        .maybeSingle();

      imagesToDelete = product?.images || [];
    }

    if (Array.isArray(imagesToDelete) && imagesToDelete.length > 0) {
      console.log(`[Stock 0] Purging ${imagesToDelete.length} images from R2 for product ${productId}...`);
      await deleteImagesListFromR2(imagesToDelete);

      // Clear image array in Supabase
      const { error: updateError } = await supabase
        .from('products')
        .update({ images: [] })
        .eq('id', productId);

      if (updateError) {
        console.error(`[Stock 0] Error clearing images in Supabase for ${productId}:`, updateError.message);
      } else {
        console.log(`[Stock 0] Successfully cleared images in Supabase for product ${productId}.`);
      }
    } else {
      console.log(`[Stock 0] Product ${productId} already has no images.`);
    }
  } catch (err) {
    console.error(`[Stock 0] Failed to handle stock 0 image purge for product ${productId}:`, err);
  }
};

/**
 * Downloads a remote image and stores it in R2 bucket
 * @param {string} remoteUrl 
 * @param {string} destinationKey 
 * @returns {Promise<string>} Public R2 URL
 */
export const transferRemoteImageToR2 = async (remoteUrl, destinationKey) => {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch remote image from ${remoteUrl} (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || 'image/jpeg';

  return await uploadBufferToR2(buffer, destinationKey, contentType);
};

/**
 * Migrates all product images in the catalog to Cloudflare R2
 */
export const migrateAllProductImages = async () => {
  const { data: products, error } = await supabase.from('products').select('*');
  if (error) throw error;

  const results = [];

  for (const product of products || []) {
    const updatedImages = [];
    const images = Array.isArray(product.images) ? product.images : [];

    for (let i = 0; i < images.length; i++) {
      const imgUrl = images[i];

      // If already hosted on R2, keep it
      if (imgUrl.startsWith(R2_CONFIG.publicUrl)) {
        updatedImages.push(imgUrl);
        continue;
      }

      try {
        const destKey = `products/${product.id}/image-${i + 1}.jpg`;
        const newUrl = await transferRemoteImageToR2(imgUrl, destKey);
        updatedImages.push(newUrl);
      } catch (uploadErr) {
        console.error(`Failed to transfer image for product ${product.id} [${i}]:`, uploadErr.message);
        // Fallback to existing url if transfer fails
        updatedImages.push(imgUrl);
      }
    }

    // Update in Supabase
    await supabase
      .from('products')
      .update({ images: updatedImages })
      .eq('id', product.id);

    results.push({
      productId: product.id,
      name: product.name,
      images: updatedImages,
    });
  }

  return results;
};
