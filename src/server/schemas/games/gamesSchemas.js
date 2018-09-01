import { makeExecutableSchema } from 'graphql-tools';

export const gameSchema = makeExecutableSchema({
  typeDefs: `
    input TeamInput {
      score: Int,
      offense: String,
      defense: String
    }
    type Team {
      score: Int
    }
    type Game {
      _id: String,
      startDate: String,
      endDate: String,
      source: String,
      red: Team,
      blue: Team,
      metadata: String
    }
    input GameInput {
      startDate: String,
      endDate: String,
      source: String,
      metadata: String
      red: TeamInput,
      blue: TeamInput,
    }
    type Query {
      games: [Game]
    }
    type Mutation {
      addGame(input: GameInput): Game
    }
  `
});
