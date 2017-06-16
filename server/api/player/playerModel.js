const mongoose = require('mongoose')
const Schema = mongoose.Schema

const PlayerSchema = new Schema({
  firstName: {
    type: String,
    required: true
  },

  lastName: {
    type: String
  }
})

module.exports = mongoose.model('player', PlayerSchema)
