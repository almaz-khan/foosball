import User from './userModel'

export const usersResolvers = {
  Query: {
    user(_, {_id}) {
      return {
        _id: _id,
        username: 'Pit'
      }
      // return await User.findById(_id)
    }
  },

  User: {
    username: parent => parent.username
  }
}
