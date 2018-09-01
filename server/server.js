import express from 'express'
import appMiddlware from './middleware/appMiddlware'
import { schema } from './schemas/schemas'
import { ApolloServer } from 'apollo-server-express'
import mongoose from 'mongoose'
import config from './config/config'
import jwt from 'jsonwebtoken'

const app = express()
// db.url is different depending on NODE_ENV
mongoose.connect(config.db.url)

// if (config.seed) {
//   require('./util/seed')
// }
// setup the app middlware
appMiddlware(app)

const getMe = async req => {
  const token = req.headers['access_token'];

  if (token) {
    try {
      return await jwt.verify(token, config.secret)
    } catch (e) {
      throw new AuthenticationError('Your session expired. Sign in again.')
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

  // logger.error(err.stack)
  res.status(500).send('Oops')
})

// export the app for testing
export default app;
