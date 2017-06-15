module.exports = {
  // disbable logging for production
  logging: true,
  db: {
    url: process.env.MONGODB_URI
  }
};
