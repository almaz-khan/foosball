const router = require('express').Router()
const controller = require('./gameController')
const auth = require('../../auth/auth')

const checkUser = [auth.decodeToken(), auth.getFreshUser()]
// setup boilerplate route jsut to satisfy a request
// for building
router.param('id', controller.params)

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
 *         type: date
 *       endDate:
 *         type: date
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
 *     parameters:
 *       - in: query
 *         name: source
 *         type: string
 *         required: false
 *         description: Filter games by source
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success get all games
 */

  .get(controller.get)

/**
 * @swagger
 * /api/games:
 *   post:
 *     summary: Add Game
 *     description: Add game
 *     tags: [Games]
 *     parameters:
 *     - in: "body"
 *       name: "body"
 *       description: "Game obj"
 *       required: true
 *       schema:
 *         $ref: "#/definitions/Games"
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success add game
 */

  .post(controller.post)

router.route('/:id')

/**
 * @swagger
 * /api/games/{id}:
 *   get:
 *     summary: Get Game
 *     description: Get game by id
 *     tags: [Games]
 *     parameters:
 *       - name: id
 *         description: Game's id
 *         in: path
 *         type: string
 *         required: true
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success get game by id
 *       400:
 *         description: Can't find game by id
 */

  .get(controller.getOne)

/**
 * @swagger
 * /api/games/{id}:
 *   put:
 *     summary: Update Game
 *     description: Update game by id
 *     tags: [Games]
 *     parameters:
 *       - name: id
 *         description: Game's id
 *         in: path
 *         type: string
 *         required: true
 *       - in: "body"
 *         name: "body"
 *         description: "Game obj"
 *         required: true
 *         schema:
 *           $ref: "#/definitions/Games"
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success update game
 *       400:
 *         description: Can't find game by id
 */

  .put(controller.put)

/**
 * @swagger
 * /api/games/{id}:
 *   delete:
 *     summary: Delete Game
 *     description: Delete game by id
 *     tags: [Games]
 *     parameters:
 *       - name: id
 *         description: Game's id
 *         in: path
 *         type: string
 *         required: true
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success delete game
 *       400:
 *         description: Can't find game by id
 */

  .delete(controller.delete)

module.exports = router
