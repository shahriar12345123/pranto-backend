import { Router } from 'express';
import { getHealth } from '../controllers/healthController.js';
import productRoutes from './productRoutes.js';
import cartRoutes from './cartRoutes.js';
import imageRoutes from './imageRoutes.js';
import orderRoutes from './orderRoutes.js';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import adminRoutes from './adminRoutes.js';
import { handleChat } from '../controllers/chatController.js';

const router = Router();

router.get('/health', getHealth);
router.post('/chat', handleChat);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/cart', cartRoutes);
router.use('/images', imageRoutes);
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/admin', adminRoutes);

export default router;
