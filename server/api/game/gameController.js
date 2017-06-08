var Game = require('./gameModel');
var _ = require('lodash');
var logger = require('../../util/logger');

exports.params = function(req, res, next, id) {
  Game.findById(id)
    .populate('team', 'username')
    .exec()
    .then(function(game) {
      if (!game) {
        next(new Error('No game with that id'));
      } else {
        req.game = game;
        next();
      }
    }, function(err) {
      next(err);
    });
};

exports.get = function(req, res, next) {
  Game.find({})
    .populate({path: 'redTeam.team blueTeam.team', populate: {path: 'defensePlayer attackPlayer', select: '-password'}})
    .exec()
    .then(function(games){
      res.json(games);
    }, function(err){
      next(err);
    });
};

exports.getOne = function(req, res, next) {
  var game = req.game;
  res.json(game);
};

exports.put = function(req, res, next) {
  var game = req.game;

  var update = req.body;

  _.merge(game, update);

  game.save(function(err, saved) {
    if (err) {
      next(err);
    } else {
      res.json(saved);
    }
  })
};

exports.post = function(req, res, next) {
  var newgame = req.body;
  newgame.author = req.user._id;

  Game.create(newgame)
    .then(function(game) {
      res.json(game);
    }, function(err) {
      logger.error(err);
      next(err);
    });
};

exports.delete = function(req, res, next) {
  req.game.remove(function(err, removed) {
    if (err) {
      next(err);
    } else {
      res.json(removed);
    }
  });
};
