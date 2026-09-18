import express from 'express';
import { 
  getCart, 
  addToCart, 
  updateCartItem, 
  removeFromCart, 
  clearCart 
} from '../controllers/cartController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All cart routes require the user to be authenticated
router.use(requireAuth);

router.get('/', getCart);
router.post('/', addToCart);
router.delete('/', clearCart); // Delete all
router.put('/:productId', updateCartItem);
router.delete('/:productId', removeFromCart);

export default router;
