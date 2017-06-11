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
      type: Number,
      required: true
    },
    red: {
      type: Number,
      required: true
    }
  },

  participants: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'user',
      required: true
    },
    team: {
      type: String,
      required: true
    },
    position: {
      type: String,
      required: true
    }
  }]

});

module.exports = mongoose.model('game', GameSchema);
