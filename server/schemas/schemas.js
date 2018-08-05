import Players from './palyers/playersSchemas'
import Games from './games/gamesSchemas'
import { playersResolvers } from './palyers/playersResolver'
import { gamesResolvers } from './games/gamesResolver'

import { makeExecutableSchema } from 'graphql-tools'

const RootQuery = `
  type Query {
    players: [Player]
    player(_id: String): Player
    games: [Game]
  }
  type Mutation {
    addPlayer(input: PlayerInput): Player
    updatePlayer(_id: String, input: PlayerInput): String
    removePlayer(_id: String): String
    addGame(input: GameInput): Game
  }
`;

const SchemaDefinition = `
  schema {
    query: Query
    mutation: Mutation
  }
`;

export const schema = makeExecutableSchema({
  typeDefs: [
    RootQuery,
    SchemaDefinition,
    Players,
    Games
  ],
  resolvers: [
    playersResolvers,
    gamesResolvers
  ]
});
