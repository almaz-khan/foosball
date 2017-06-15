var Player = require('../api/player/playerModel');
var Game = require('../api/game/gameModel');
var _ = require('lodash');
var logger = require('./logger');

logger.log('Seeding the Database');

var players = [
  {firstName: 'Jimmylo', lastName: 'Xoko'},
  {firstName: 'Xoko', lastName: 'Jimmylo'},
  {firstName: 'katamon', lastName: 'Jameson'},
  {firstName: 'Jameson', lastName: 'katamon'}
];

var games = [{
  startDate: new Date(),
  endDate: new Date(),
  source: 'test',

  red: {
    score: 0,
    offense: null,
    defense: null
  },

  blue: {
    score: 3,
    offense: null,
    defense: null
  },

  metadata: {}
}, {
  startDate: new Date(),
  endDate: new Date(),
  source: 'test1',

  red: {
    score: 3,
    offense: null,
    defense: null
  },

  blue: {
    score: 2,
    offense: null,
    defense: null
  },

  metadata: {}
}]


var createDoc = function(model, doc) {
  return new Promise(function(resolve, reject) {
    new model(doc).save(function(err, saved) {
      return err ? reject(err) : resolve(saved);
    });
  });
};

var cleanDB = function() {
  logger.log('... cleaning the DB');
  var cleanPromises = [Player, Game]
    .map(function(model) {
      return model.remove().exec();
    });
  return Promise.all(cleanPromises);
}

var createPlayers = function(data) {

  var promises = players.map(function(player) {
    return createDoc(Player, player);
  });

  return Promise.all(promises)
    .then(function(players) {
      return _.merge({players: players}, data || {});
    });
};

var createGames = function(data) {
  var newGames = games.map(function(game, i) {
    game.blue.offense = data.players[0]._id
    game.blue.defense = data.players[1]._id
    game.red.offense = data.players[2]._id
    game.red.defense = data.players[3]._id

    return createDoc(Game, game);
  });

  return Promise.all(newGames)
    .then(function(games) {
      return _.merge({games: games}, data || {});
    })
    .then(function() {
      return 'Seeded DB with 4 Players, 2 Games';
    })
    .catch(error => console.log(error));
};

cleanDB()
  .then(createPlayers)
  .then(createGames)
  .then(logger.log.bind(logger))
  .catch(logger.log.bind(logger));
