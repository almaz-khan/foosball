export default {
  // disbable logging for production
  logging: process.env.DEBUG_ON,
  db: {
    url: process.env.MONGODB_URI
  },
  secret: process.env.SECRET
}
