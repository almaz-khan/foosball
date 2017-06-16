const mongoose = require('mongoose')
const Schema = mongoose.Schema

const GameSchema = new Schema({
  startDate: {
    type: Date
  },

  endDate: {
    type: Date
  },

  source: {
    type: String
  },

  red: {
    score: {
      type: Number,
      required: true
    },

    offense: {
      type: Schema.Types.ObjectId,
      ref: 'player',
      required: true
    },

    defense: {
      type: Schema.Types.ObjectId,
      ref: 'player',
      required: true
    }
  },

  blue: {
    score: {
      type: Number,
      required: true
    },

    offense: {
      type: Schema.Types.ObjectId,
      ref: 'player',
      required: true
    },
    defense: {
      type: Schema.Types.ObjectId,
      ref: 'player',
      required: true
    }
  },

  metadata: {
    type: Object
  }

})

module.exports = mongoose.model('game', GameSchema)
