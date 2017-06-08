var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var GameSchema = new Schema({
  startDate: {
    type: Date,
    required: true
  },

  endDate: {
    type: Date
  },

  score: {
    blue: {
      type: Number
    },
    red: {
      type: Number
    }
  },

  participants: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'user'
    },
    team: {
      type: String
    },
    position: {
      type: String
    }
  }]

});

module.exports = mongoose.model('game', GameSchema);
