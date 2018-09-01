import mongoose from 'mongoose'
import bcrypt from 'bcrypt'

const Schema = mongoose.Schema

const UserSchema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  }
})

UserSchema.pre('save', function(next) {
  if (!this.isModified('password')) {
    return next()
  }

  this.password = this.encryptPassword(this.password)
  next()
})

UserSchema.methods = {
  authenticate(plainTextPword) {
    return bcrypt.compareSync(plainTextPword, this.password)
  },

  encryptPassword(plainTextPword) {
    if (!plainTextPword) {
      return ''
    } else {
      const salt = bcrypt.genSaltSync(10)
      return bcrypt.hashSync(plainTextPword, salt)
    }
  },

  toJson() {
    const obj = this.toObject()
    delete obj.password
    return obj
  }
}

export default mongoose.model('user', UserSchema)
