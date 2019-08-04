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
 * components:
 *   schemas:
 *     Games:
 *       required:
 *         - red/offense
 *         - red/defense
 *         - blue/offense
 *         - blue/defense
 *       properties:
 *         startDate:
 *           type: date
 *         endDate:
 *           type: date
 *         source:
 *           type: string
 *         metadata:
 *           type: object
 *         red:
 *           properties:
 *             score:
 *               type: number
 *             offense:
 *               $ref: "#/components/schemas/Players"
 *             defense:
 *               $ref: "#/components/schemas/Players"
 *         blue:
 *           properties:
 *             score:
 *               type: number
 *             offense:
 *               $ref: "#/components/schemas/Players"
 *             defense:
 *               $ref: "#/components/schemas/Players"
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
 * paths:
 *   /api/games:
 *     get:
 *       summary: Get Games
 *       description: Get All Games
 *       tags: [Games]
 *       parameters:
 *         - in: query
 *           name: source
 *           schema:
 *             type: string
 *           required: false
 *           description: Filter games by source
 *         - in: query
 *           style: deepObject
 *           explode: false
 *           name: startDate
 *           schema:
 *             type: object
 *           required: false
 *           properties:
 *             gte:
 *               type: string
 *               pattern: '^\d{4}-\d{2}-\d{2}$'
 *             lte:
 *               type: string
 *               pattern: '^\d{4}-\d{2}-\d{2}$'
 *           description: filter by start date
 *           example:
 *             lte: '2019-12-28'
 *         - in: query
 *           name: skip
 *           schema:
 *             type: number
 *           required: false
 *           description: skip first n items
 *         - in: query
 *           name: limit
 *           schema:
 *             type: number
 *           required: false
 *           description: return limit items
 *       produces:
 *         - application/json
 *       responses:
 *         200:
 *           description: Success get all games
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
 *         $ref: "#/components/schemas/Games"
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
 *         schema:
 *           type: string
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
 *         schema:
 *           type: string
 *         required: true
 *       - in: "body"
 *         name: "body"
 *         description: "Game obj"
 *         required: true
 *         schema:
 *           $ref: "#/components/schemas/Games"
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
 *         schema:
 *           type: string
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
