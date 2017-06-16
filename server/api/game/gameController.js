const Game = require('./gameModel')
const _ = require('lodash')
const logger = require('../../util/logger')

exports.params = function(req, res, next, id) {
  Game.findById(id)
    .populate('red.offense red.defense blue.offense blue.defense')
    .exec()
    .then(function(game) {
      if (!game) {
        next(new Error('No game with that id'))
      } else {
        req.game = game
        next()
      }
    }, function(err) {
      next(err)
    })
}

exports.get = function(req, res, next) {
  const query = req.query ? req.query : {}
  Game.find(query)
    .populate({path: 'red.offense red.defense blue.offense blue.defense'})
    .exec()
    .then(function(games){
      res.json(games)
    }, function(err){
      next(err)
    })
}

exports.getOne = function(req, res, next) {
  const game = req.game
  res.json(game)
}

exports.put = function(req, res, next) {
  const game = req.game

  const update = req.body

  _.merge(game, update)

  game.save(function(err, saved) {
    if (err) {
      next(err)
    } else {
      res.json(saved)
    }
  })
}

exports.post = function(req, res, next) {
  const newgame = req.body

  Game.create(newgame)
    .then(function(game) {
      res.json(game)
    }, function(err) {
      logger.error(err)
      next(err)
    })
}

exports.delete = function(req, res, next) {
  req.game.remove(function(err, removed) {
    if (err) {
      next(err)
    } else {
      res.json(removed)
    }
  })
}
