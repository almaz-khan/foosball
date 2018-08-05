import Game from './gameModel'

export const gamesResolvers = {
  Query: {
    async games() {
      return await Game
      .find()
      .populate({path: 'red.offense red.defense blue.offense blue.defense'})
      .exec()
    }
  },
  Mutation: {
    async addGame(_, {input}) {
      return await Game.create(input)
    }
  }
}
