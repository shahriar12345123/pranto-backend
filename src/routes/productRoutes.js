import { Router } from 'express';
import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  updateProductStock,
  deleteProduct,
  seedProducts,
} from '../controllers/productsController.js';

const router = Router();

// Public / client routes
router.get('/', getProducts);
router.get('/:slug', getProductBySlug);

// Product management routes (ready for future Admin Panel)
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.patch('/:id/stock', updateProductStock);
router.delete('/:id', deleteProduct);

// Seed catalog
router.post('/seed', seedProducts);

export default router;
