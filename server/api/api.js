var router = require('express').Router();

// api router will mount other routers
// for all our resources
router.use('/players', require('./player/playerRoutes'));
router.use('/games', require('./game/gameRoutes'));

module.exports = router;
