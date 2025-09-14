// src/routes/analysis.ts
import { Router } from 'express'
import authMiddleware from '../middlewares/authMiddleware'
import { getAnalysisOverview, getBudgetSetting, notifyIfOver, upsertBucketMap, upsertBudgetSetting } from '../controllers/analysisController'

const router = Router()
router.use(authMiddleware)

router.get('/overview', getAnalysisOverview)
router.get('/budget-setting', getBudgetSetting)
router.post('/budget-setting', upsertBudgetSetting)
router.post('/bucket-map', upsertBucketMap)
router.post('/notify-over', notifyIfOver)

export default router
