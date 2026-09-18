import { Router } from 'express';
import { createOrder, getMyOrders, getOrderById } from '../controllers/ordersController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/', createOrder);
router.get('/my-orders', requireAuth, getMyOrders);
router.get('/:id', getOrderById);

export default router;
