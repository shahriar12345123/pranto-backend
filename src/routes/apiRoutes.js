import { Router } from 'express';
import { getHealth } from '../controllers/healthController.js';
import productRoutes from './productRoutes.js';
import cartRoutes from './cartRoutes.js';
import imageRoutes from './imageRoutes.js';
import orderRoutes from './orderRoutes.js';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';

const router = Router();

router.get('/health', getHealth);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/cart', cartRoutes);
router.use('/images', imageRoutes);
router.use('/auth', authRoutes);
router.use('/user', userRoutes);

export default router;
