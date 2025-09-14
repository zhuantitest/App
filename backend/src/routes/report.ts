import { Router } from 'express'
import { exportReport } from '../controllers/reportController'
import authMiddleware from '../middlewares/authMiddleware'

const router = Router()
router.get('/export', authMiddleware, exportReport)
export default router
