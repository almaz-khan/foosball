import Game from './gameModel'
import { combineResolvers } from 'graphql-resolvers';

import { isAuthenticated } from '../authorization/authorizationResolver';

export const gamesResolvers = {
  Query: {
    async games(_, { skip, limit, query = {} }) {
      return await Game
      .find(getFilter(query), null, { skip: +skip, limit: +limit })
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

function getFilter (query) {
  const {
    startDate,
    endDate,
    ...rest
  } = query;

  const filter = {
    ...rest
  };

  if (startDate) {
    filter.startDate = {};
    if (startDate.gte) {
      filter.startDate.$gte = startDate.gte
    }
    if (startDate.lte) {
      filter.startDate.$lte = startDate.lte
    }
  }

  if (endDate) {
    filter.endDate = {};
    if (endDate.gte) {
      filter.endDate.$gte = endDate.gte
    }
    if (endDate.lte) {
      filter.endDate.$lte = endDate.lte
    }
  }

  return filter;
}
