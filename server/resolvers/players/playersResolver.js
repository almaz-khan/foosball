import Player from './playerModel'

export const playersResolvers = {
  Query: {
    async players() {
      return await Player.find()
    }
  },
  Mutation: {
    async addPlayer(_, { input }) {
      return await Player.create(input)
    }
  }
}
