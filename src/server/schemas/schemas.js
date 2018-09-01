import { playerSchema } from './palyers/playersSchemas'
import { gameSchema } from './games/gamesSchemas'
import { userSchema } from './users/userSchemas'
import { playersResolvers } from './palyers/playersResolver'
import { gamesResolvers } from './games/gamesResolver'
import { usersResolvers } from './users/userResolver'
import { mergeSchemas } from 'graphql-tools'

const linkTypeDefs = `
  extend type Player {
    games: [Game!]
  }
  extend type Team {
    offense: Player,
    defense: Player
  }
`

export const schema = mergeSchemas({
  schemas: [
    playerSchema,
    userSchema,
    gameSchema,
    linkTypeDefs
  ],
  resolvers: [
    playersResolvers,
    gamesResolvers,
    usersResolvers
  ]
});
