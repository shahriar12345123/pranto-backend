import { Router } from 'express';
import { handleLoginEvent } from '../controllers/userController.js';

const router = Router();

router.post('/login-event', handleLoginEvent);

export default router;
