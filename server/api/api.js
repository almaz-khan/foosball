var router = require('express').Router();

// api router will mount other routers
// for all our resources
router.use('/users', require('./user/userRoutes'));
router.use('/games', require('./game/gameRoutes'));

module.exports = router;
