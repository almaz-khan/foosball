import express from 'express'
import auth from './auth'
import controller from './controller'

const verifyUser = auth.verifyUser
const router = express.Router()
// before we send back a jwt, lets check
// the password and username match what is in the DB
router.post('/signin', verifyUser(), controller.signin)

export default router;
