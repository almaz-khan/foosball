import { makeExecutableSchema } from 'graphql-tools';

export const playerSchema = makeExecutableSchema({
  typeDefs: `
    type Player { _id: String, firstName: String, lastName: String }
    input PlayerInput { firstName: String, lastName: String }
    type Query {
      players: [Player]
      player(_id: String): Player
    }
    type Mutation {
      addPlayer(input: PlayerInput): Player
      updatePlayer(_id: String, input: PlayerInput): String
      removePlayer(_id: String): String
    }
  `
})
