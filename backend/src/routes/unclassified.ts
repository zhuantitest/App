// src/routes/unclassified.ts
import express from 'express'
const router = express.Router()

// TODO: 查詢未分類紀錄 API
router.get('/', (req, res) => {
  res.json({ message: 'Unclassified API Ready' })
})

export default router
