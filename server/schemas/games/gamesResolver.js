import Game from './gameModel'
import { combineResolvers } from 'graphql-resolvers';

import { isAuthenticated } from '../authorization/authorizationResolver';

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
    addGame: combineResolvers(
      isAuthenticated,
      async (_, {input}) => {
        return await Game.create(input)
      }
    )
  }
}
