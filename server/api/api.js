import express from 'express'
import playerRoutes from './player/playerRoutes'
const router = express.Router()

// api router will mount other routers
// for all our resources
router.use('/players', playerRoutes)
// router.use('/games', require('./game/gameRoutes'))

export default router
