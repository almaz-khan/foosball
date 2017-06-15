var router = require('express').Router();
var path = require('path');
var swaggerJSDoc = require('swagger-jsdoc');
var swaggerUi = require('swagger-ui-express');

var options = {
  swaggerDefinition: {
    info: {
      title: 'Foosbal', // Title (required)
      version: '0.0.1', // Version (required)
    },
  },
  apis: [path.join(__dirname, '../api/**/*.js')], // Path to the API docs
};

// Initialize swagger-jsdoc -> returns validated swagger spec in json format
var swaggerSpec = swaggerJSDoc(options);

router.get('/api-docs.json', function(req, res) {
  console.log(path.join(__dirname, './api/**/*.js'));
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

module.exports = router;
