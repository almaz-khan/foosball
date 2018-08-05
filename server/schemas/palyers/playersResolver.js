import Player from './playerModel'

export const playersResolvers = {
  Query: {
    async players() {
      return await Player.find()
    },
    async player(_, {_id}) {
      return await Player.findById(_id)
    }
  },
  Mutation: {
    async addPlayer(_, { input }) {
      return await Player.create(input)
    },
    async updatePlayer(_, { _id, input }) {
      const player = await Player.findById(_id).update(input);

      return player.n ? 'ok' : 'Cannot be modified';
    },
    async removePlayer(_, { _id }) {
      const resp = await Player.findById(_id).remove()

      return resp.n ? _id : 'Cannot be removed';
    }
  }
}
