var router = require('express').Router();
var controller = require('./gameController');
var auth = require('../../auth/auth');

var checkUser = [auth.decodeToken(), auth.getFreshUser()];
// setup boilerplate route jsut to satisfy a request
// for building
router.param('id', controller.params);

router.route('/')

/**
 * @swagger
 * definitions:
 *   Games:
 *     required:
 *       - red/offense
 *       - red/defense
 *       - blue/offense
 *       - blue/defense
 *     properties:
 *       startDate:
 *         type: string
 *       endDate:
 *         type: string
 *       source:
 *         type: string
 *       metadata:
 *         type: object
 *       red:
 *         properties:
 *           score:
 *             type: number
 *           offense:
 *             $ref: "#/definitions/Players"
 *           defense:
 *             $ref: "#/definitions/Players"
 *       blue:
 *         properties:
 *           score:
 *             type: number
 *           offense:
 *             $ref: "#/definitions/Players"
 *           defense:
 *             $ref: "#/definitions/Players"
 *
 */

/**
 * @swagger
 * tags:
 *   name: Games
 *   description: All about /games
 */

/**
 * @swagger
 * /api/games:
 *   get:
 *     summary: Get Games
 *     description: Get All Games
 *     tags: [Games]
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success get all games
 */

  .get(controller.get)

  .post(controller.post)

router.route('/:id')
  .get(controller.getOne)
  .put(controller.put)
  .delete(controller.delete)

module.exports = router;
