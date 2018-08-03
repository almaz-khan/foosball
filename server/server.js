import express from 'express'
import appMiddlware from './middleware/appMiddlware'
import api from './api/api'
const app = express()
// db.url is different depending on NODE_ENV
// mongoose.connect(config.db.url)

// if (config.seed) {
//   require('./util/seed')
// }
// setup the app middlware
appMiddlware(app)

// setup the api
app.use('/api', api)
// app.use('/auth', auth)

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
