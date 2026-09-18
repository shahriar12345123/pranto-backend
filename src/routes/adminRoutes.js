import { Router } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/authMiddleware.js';
import {
  getDashboardStats,
  getAdminProducts,
  createAdminProduct,
  updateAdminProduct,
  deleteAdminProduct,
  adjustProductStock,
  getAdminOrders,
  getAdminOrderById,
  updateOrderStatus,
  verifyPayment,
  getAdminCustomers,
  getAdminCustomerById,
  getAdminInventory,
  getAdminAuditLogs,
  getAdminSettings,
  updateAdminSettings,
} from '../controllers/adminController.js';

const router = Router();

// Multer memory storage for direct Cloudflare R2 uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per image
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WEBP, GIF, SVG, AVIF) are accepted!'), false);
    }
  },
});

// Protect all admin routes with requireAdmin middleware
router.use(requireAdmin);

// 1. Dashboard Analytics
router.get('/dashboard', getDashboardStats);

// 2. Product Management (CRUD + Cloudflare R2 file uploads)
router.get('/products', getAdminProducts);
router.post('/products', upload.array('images', 10), createAdminProduct);
router.put('/products/:id', upload.array('images', 10), updateAdminProduct);
router.delete('/products/:id', deleteAdminProduct);
router.patch('/products/:id/stock', adjustProductStock);

// 3. Order Management
router.get('/orders', getAdminOrders);
router.get('/orders/:id', getAdminOrderById);
router.patch('/orders/:id/status', updateOrderStatus);

// 4. Payment Verification Queue (Manual bKash, Nagad, Rocket, COD)
router.patch('/orders/:id/payment', verifyPayment);

// 5. Customer / User Management
router.get('/customers', getAdminCustomers);
router.get('/customers/:id', getAdminCustomerById);

// 6. Inventory Control
router.get('/inventory', getAdminInventory);

// 7. Activity & Admin Audit Logs
router.get('/activity-logs', getAdminAuditLogs);

// 8. Store Settings & Delivery Configuration
router.get('/settings', getAdminSettings);
router.put('/settings', updateAdminSettings);

export default router;
