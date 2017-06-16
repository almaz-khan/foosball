const router = require('express').Router()
const path = require('path')
const swaggerJSDoc = require('swagger-jsdoc')
const swaggerUi = require('swagger-ui-express')

const options = {
  swaggerDefinition: {
    info: {
      title: 'Foosbal', // Title (required)
      version: '0.0.1', // Version (required)
    },
  },
  apis: [path.join(__dirname, '../api/**/*.js')] // Path to the API docs
}

// Initialize swagger-jsdoc -> returns validated swagger spec in json format
const swaggerSpec = swaggerJSDoc(options)

router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

module.exports = router
