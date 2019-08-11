import express from 'express'
import appMiddlware from './middleware/appMiddlware'
import { schema } from './schemas/schemas'
import { ApolloServer } from 'apollo-server-express'
import { AuthenticationError } from 'apollo-server'
import mongoose from 'mongoose'
import config from './config/config'
import jwt from 'jsonwebtoken'
import seed from './util/seed'
import logger from './util/logger'

const app = express()
// db.url is different depending on NODE_ENV
mongoose.connect(config.db.url, { useNewUrlParser: true })

if (config.seed) {
  seed()
}
// setup the app middlware
appMiddlware(app)

const getMe = async req => {
  let token = req.headers['authorization'];

  if (token) {
    try {
      token = token.replace('Bearer ', '')
      return await jwt.verify(token, config.secret)
    } catch (e) {
      return new AuthenticationError('Your session expired. Sign in again.')
    }
  }
}
const server = new ApolloServer({
  schema,
  context: async ({req}) => {
    const me = await getMe(req);

    return {
      me,
      secret: config.secret
    }

  }
})
server.applyMiddleware({ app })

// set up global error handling
app.use(function(err, req, res, next) {
  // if error thrown from jwt validation check
  if (err.name === 'UnauthorizedError') {
    res.status(401).send('Invalid token')
    return
  }

  logger.error(err.stack)
  res.status(500).send('Oops')
})

// export the app for testing
export default app;
