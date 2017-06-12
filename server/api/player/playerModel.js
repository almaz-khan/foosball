var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var PlayerSchema = new Schema({
  firstName: {
    type: String,
    required: true,
    unique: true
  },

  secondName: {
    type: String,
    required: true,
    unique: true
  },
});

module.exports = mongoose.model('player', PlayerSchema);
