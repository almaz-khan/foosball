import express from 'express'
import appMiddlware from './middleware/appMiddlware'
import { schema } from './schemas/schemas'
import { ApolloServer } from 'apollo-server-express'
import mongoose from 'mongoose'
import config from './config/config'

const app = express()
// db.url is different depending on NODE_ENV
mongoose.connect(config.db.url)

// if (config.seed) {
//   require('./util/seed')
// }
// setup the app middlware
appMiddlware(app)
const server = new ApolloServer({ schema })
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
