import { Router } from 'express';
import { createOrder, getMyOrders, getOrderById, getCheckoutConfig } from '../controllers/ordersController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/config', getCheckoutConfig);
router.post('/', requireAuth, createOrder);
router.get('/my-orders', requireAuth, getMyOrders);
router.get('/:id', getOrderById);

export default router;
