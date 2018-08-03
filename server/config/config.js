import _ from 'lodash'

const config = {
  dev: 'development',
  test: 'testing',
  prod: 'production',
  port: process.env.PORT || 3000,
  // 10 days in seconds
  expireTime: 24 * 60 * 10 * 60,
  secrets: {
    jwt: process.env.JWT || 'gumball'
  }
}

process.env.NODE_ENV = process.env.NODE_ENV || config.dev
config.env = process.env.NODE_ENV

if (process.env.MONGODB_URI) {
  config.db = {
    url: process.env.MONGODB_URI
  }
}

let envConfig
// require could error out if
// the file don't exist so lets try this statement
// and fallback to an empty object if it does error out
try {
  envConfig = require('./' + config.env)
  // just making sure the require actually
  // got something back :)
  envConfig = envConfig || {}
} catch(e) {
  envConfig = {}
}

// merge the two config files together
// the envConfig file will overwrite properties
// on the config object
export default _.merge(config, envConfig)
