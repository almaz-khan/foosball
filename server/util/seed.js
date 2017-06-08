var User = require('../api/user/userModel');
var Game = require('../api/game/gameModel');
var _ = require('lodash');
var logger = require('./logger');

logger.log('Seeding the Database');

var users = [
  {username: 'Jimmylo', password: 'test'},
  {username: 'Xoko', password: 'test'},
  {username: 'katamon', password: 'test'},
  {username: 'Jameson', password: 'test'}
];

var games = [{
  startDate: new Date(),
  endDate: '',
  score: {
    blue: 3,
    red: 2
  },

  participants: [{
    team: 'blue',
    position: 'defender'
  }, {
    team: 'blue',
    position: 'attacker'
  }, {
    team: 'red',
    position: 'attacker'
  }, {
    team: 'red',
    position: 'defender'
  }]

}, {

  startDate: new Date(),
  endDate: '',
  score: {
    blue: 0,
    red: 3
  },

  participants: [{
      team: 'blue',
      position: 'attacker'
    }, {
    team: 'blue',
    position: 'defender'
  }, {
    team: 'red',
    position: 'attacker'
  }, {
    team: 'red',
    position: 'defender'
  }]

}];

var createDoc = function(model, doc) {
  return new Promise(function(resolve, reject) {
    new model(doc).save(function(err, saved) {
      return err ? reject(err) : resolve(saved);
    });
  });
};

var cleanDB = function() {
  logger.log('... cleaning the DB');
  var cleanPromises = [User, Game]
    .map(function(model) {
      return model.remove().exec();
    });
  return Promise.all(cleanPromises);
}

var createUsers = function(data) {

  var promises = users.map(function(user) {
    return createDoc(User, user);
  });

  return Promise.all(promises)
    .then(function(users) {
      return _.merge({users: users}, data || {});
    });
};

var createGames = function(data) {
  var newGames = games.map(function(game, i) {
    game.participants = game.participants.map(participant => {
      return _.merge(participant, {user: data.users[i]._id})
    })
    return createDoc(Game, game);
  });

  return Promise.all(newGames)
    .then(function(games) {
      return _.merge({games: games}, data || {});
    })
    .then(function() {
      return 'Seeded DB with 4 Users, 2 Games';
    })
    .catch(error => console.log(error));
};

cleanDB()
  .then(createUsers)
  .then(createGames)
  .then(logger.log.bind(logger))
  .catch(logger.log.bind(logger));
