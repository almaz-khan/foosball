import mongoose from 'mongoose'
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

export default mongoose.model('player', PlayerSchema)
