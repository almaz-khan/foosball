var Player = require('./playerModel');
var _ = require('lodash');

exports.params = function(req, res, next, id) {
  Player.findById(id)
    .then(function(player) {
      if (!player) {
        next(new Error('No player with that id'));
      } else {
        req.player = player;
        next();
      }
    }, function(err) {
      next(err);
    });
};

exports.get = function(req, res, next) {
  Player.find({})
    .then(function(players){
      res.json(players);
    }, function(err){
      next(err);
    });
};

exports.getOne = function(req, res, next) {
  var player = req.player.toJson();
  res.json(player.toJson());
};

exports.put = function(req, res, next) {
  var player = req.player;

  var update = req.body;

  _.merge(player, update);

  player.save(function(err, saved) {
    if (err) {
      next(err);
    } else {
      res.json(saved.toJson());
    }
  })
};

exports.post = function(req, res, next) {
  var newPlayer = new Player(req.body);

  newPlayer.save(function(err, player) {
    if(err) { return next(err);}

    res.json(player);
  });
};

exports.delete = function(req, res, next) {
  req.player.remove(function(err, removed) {
    if (err) {
      next(err);
    } else {
      res.json(removed.toJson());
    }
  });
};
