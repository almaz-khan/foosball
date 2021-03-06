const router = require('express').Router()
const logger = require('../../util/logger')
const controller = require('./playerController')

// setup boilerplate route jsut to satisfy a request
// for building
router.param('id', controller.params)
router.route('/')

/**
 * @swagger
 * components:
 *   schemas:
 *     Players:
 *       required:
 *         - firstName
 *       properties:
 *         _id:
 *           type: string
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 */

/**
 * @swagger
 * tags:
 *   name: Players
 *   description: All about /players
 */

/**
 * @swagger
 * paths:
 *   /api/players:
 *     get:
 *       summary: Get Players
 *       description: Get All Players
 *       tags: [Players]
 *       produces:
 *         - application/json
 *       responses:
 *         200:
 *           description: Success get all players
 */

  .get(controller.get)

/**
 * @swagger
 * /api/players:
 *   post:
 *     summary: Add Player
 *     description: Add player with first name and surname
 *     tags: [Players]
 *     parameters:
 *       - name: firstName
 *         description: Player's name
 *         in: formData
 *         schema:
 *           type: string
 *         required: true
 *       - name: lastName
 *         description: Player's surname
 *         schema:
 *           type: string
 *         in: formData
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success add player
 */
  .post(controller.post)

router.route('/:id')
/**
 * @swagger
 * /api/players/{id}:
 *   get:
 *     summary: Get Player
 *     description: Get player by id
 *     tags: [Players]
 *     parameters:
 *       - name: id
 *         description: Player's id
 *         in: path
 *         schema:
 *           type: string
 *         required: true
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success get player by id
 *       400:
 *         description: Can't find player by id
 */

  .get(controller.getOne)

/**
 * @swagger
 * /api/players/{id}:
 *   put:
 *     summary: Update Player
 *     description: Update player by id
 *     tags: [Players]
 *     parameters:
 *       - name: id
 *         description: Player's id
 *         in: path
 *         schema:
 *           type: string
 *         required: true
 *       - name: firstName
 *         description: Name you want to edit
 *         in: formData
 *         schema:
 *           type: string
 *       - name: lastName
 *         description: Surname you want to edit
 *         in: formData
 *         schema:
 *           type: string
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success update player
 *       400:
 *         description: Can't find player by id
 */

  .put(controller.put)

/**
 * @swagger
 * /api/players/{id}:
 *   delete:
 *     summary: Delete Player
 *     description: Delete player by id
 *     tags: [Players]
 *     parameters:
 *       - name: id
 *         description: Player's id
 *         in: path
 *         schema:
 *           type: string
 *         required: true
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Success delete player
 *       400:
 *         description: Can't find player by id
 */

  .delete(controller.delete)

module.exports = router
