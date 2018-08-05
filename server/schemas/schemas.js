import Players from './palyers/playersSchemas'
import { makeExecutableSchema } from 'graphql-tools'
import { resolvers } from '../resolvers/resolvers'

export const schema = makeExecutableSchema({
  typeDefs: [
    Players
  ],
  resolvers
});
