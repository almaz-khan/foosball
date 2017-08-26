const Game = require('./gameModel')
const _ = require('lodash')
const logger = require('../../util/logger')
const flatten = require('../../util/flatten')
const csv = require('csv-express')

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
  const query = req.query && req.query.source ? {source: req.query.source} : {}

  Game.find(query)
    .populate({path: 'red.offense red.defense blue.offense blue.defense'})
    .exec()
    .then(function(games){

      if (req.query.csv) {
        const flatGames = games.map(item => {
          const objItem = item.toObject({
            transform: (doc, ret, options) => {
              delete ret._id
              return ret
            },
            versionKey: false
          })

          return flatten(objItem)
        })

        res.csv(flatGames, true)
      } else {
        res.json(games)
      }
    }, function(err){
      next(err)
    })
}

exports.getCsv = function(req, res, next) {
  res.json(game)
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

  delete newgame._id

  Game.create(newgame)
    .then(function(game) {
      Game.populate(game, {
        path: 'red.offense red.defense blue.offense blue.defense'
      }, (err, gameWhithPlayers) => res.json(gameWhithPlayers))
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
