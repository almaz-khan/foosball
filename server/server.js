const express = require('express')
const app = express()
const api = require('./api/api')
const config = require('./config/config')
const logger = require('./util/logger')
const auth = require('./auth/routes')
const swagger = require('./swagger')
const path = require('path')
// db.url is different depending on NODE_ENV
require('mongoose').connect(config.db.url)

if (config.seed) {
  require('./util/seed')
}
// setup the app middlware
require('./middleware/appMiddlware')(app)

// setup the api
app.use('/api', api)
app.use('/auth', auth)
app.use('/swagger', swagger)

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
module.exports = app
