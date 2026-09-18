import { 
  uploadBufferToR2, 
  deleteFromR2, 
  deleteFromR2ByUrl, 
  deleteImagesListFromR2, 
  migrateAllProductImages 
} from '../services/r2Service.js';
import { R2_CONFIG } from '../config/r2.js';

// Helper to determine file extension from mimetype or originalname
const getExtension = (mimetype, originalname) => {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  if (mimetype === 'image/gif') return 'gif';
  if (mimetype === 'image/svg+xml') return 'svg';
  if (mimetype === 'image/avif') return 'avif';
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') return 'jpg';
  
  const match = originalname?.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : 'jpg';
};

/**
 * POST /api/images/upload
 * Accepts multipart/form-data with file field 'image'
 * Body params (optional):
 * - productId (e.g. 'prod-001')
 * - imageIndex (e.g. 1, 2, 3...)
 * - folder (default: 'products')
 */
export const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided in multipart/form-data request under field "image"',
      });
    }

    const { productId, imageIndex, folder } = req.body;
    const ext = getExtension(req.file.mimetype, req.file.originalname);
    
    let key;
    if (productId) {
      const idx = imageIndex ? parseInt(imageIndex, 10) : 1;
      key = `products/${productId}/image-${idx}.${ext}`;
    } else {
      const sanitizedFolder = folder ? folder.replace(/^\/+|\/+$/g, '') : 'products/uploads';
      const timestamp = Date.now();
      const sanitizedName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      key = `${sanitizedFolder}/${timestamp}-${sanitizedName}`;
    }

    const publicUrl = await uploadBufferToR2(
      req.file.buffer,
      key,
      req.file.mimetype
    );

    return res.status(200).json({
      success: true,
      message: 'Image successfully uploaded to Cloudflare R2',
      data: {
        url: publicUrl,
        key,
        size: req.file.size,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
      },
    });
  } catch (err) {
    console.error('Image upload error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to upload image to Cloudflare R2',
    });
  }
};

/**
 * POST /api/images/upload-multiple
 * Accepts multipart/form-data with multiple files under field 'images'
 * Body params:
 * - productId (e.g. 'prod-001')
 */
export const uploadMultipleImages = async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No image files uploaded under field "images"',
      });
    }

    const { productId = `prod-${Date.now()}` } = req.body;
    const uploadResults = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = getExtension(file.mimetype, file.originalname);
      const key = `products/${productId}/image-${i + 1}.${ext}`;

      const publicUrl = await uploadBufferToR2(
        file.buffer,
        key,
        file.mimetype
      );

      uploadResults.push({
        url: publicUrl,
        key,
        size: file.size,
        mimetype: file.mimetype,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Successfully uploaded ${uploadResults.length} images to Cloudflare R2`,
      data: {
        productId,
        urls: uploadResults.map((r) => r.url),
        images: uploadResults,
      },
    });
  } catch (err) {
    console.error('Multiple image upload error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to upload images to Cloudflare R2',
    });
  }
};

/**
 * POST /api/images/delete
 * Secure internal / admin backend endpoint to delete an image by URL or key
 * Body: { url: 'https://...' } or { key: 'products/...' }
 */
export const deleteImage = async (req, res) => {
  try {
    const { url, key } = req.body;

    if (!url && !key) {
      return res.status(400).json({
        success: false,
        message: 'Either "url" or "key" is required in JSON request body',
      });
    }

    if (url) {
      await deleteFromR2ByUrl(url);
    } else if (key) {
      await deleteFromR2(key);
    }

    return res.status(200).json({
      success: true,
      message: 'Image successfully deleted from Cloudflare R2',
    });
  } catch (err) {
    console.error('Delete image error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to delete image from Cloudflare R2',
    });
  }
};

/**
 * POST /api/images/migrate-all
 * Migrates any remaining external image URLs in Supabase products table to Cloudflare R2
 */
export const migrateImages = async (req, res) => {
  try {
    if (!R2_CONFIG.accessKeyId || !R2_CONFIG.secretAccessKey) {
      return res.status(400).json({
        success: false,
        message: 'R2 credentials must be configured in backend/.env',
      });
    }

    const results = await migrateAllProductImages();

    return res.status(200).json({
      success: true,
      message: `Successfully verified and migrated ${results.length} products to Cloudflare R2`,
      data: results,
    });
  } catch (err) {
    console.error('Migration error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Image migration failed',
    });
  }
};
