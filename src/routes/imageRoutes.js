import { Router } from 'express';
import multer from 'multer';
import { 
  uploadImage, 
  uploadMultipleImages, 
  deleteImage, 
  migrateImages 
} from '../controllers/imageController.js';

const router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 10, // Max 10 files at once
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WEBP, GIF, SVG, AVIF) are allowed!'), false);
    }
  },
});

// Single image file upload (multipart/form-data with field name 'image')
router.post('/upload', upload.single('image'), uploadImage);

// Multiple image files upload (multipart/form-data with field name 'images')
router.post('/upload-multiple', upload.array('images', 10), uploadMultipleImages);

// Delete image from R2 by key or URL
router.post('/delete', deleteImage);

// Migrate catalog images to R2
router.post('/migrate-all', migrateImages);

export default router;
