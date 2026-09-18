import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  getUserProfile,
  updateUserProfile,
  getUserAddresses,
  addUserAddress,
  getUserActivities,
} from '../controllers/userController.js';

const router = Router();

router.use(requireAuth);

router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);
router.get('/addresses', getUserAddresses);
router.post('/addresses', addUserAddress);
router.get('/activities', getUserActivities);

export default router;
