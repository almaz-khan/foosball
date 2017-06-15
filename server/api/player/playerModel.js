var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var PlayerSchema = new Schema({
  firstName: {
    type: String,
    required: true
  },

  lastName: {
    type: String
  }
});

module.exports = mongoose.model('player', PlayerSchema);
