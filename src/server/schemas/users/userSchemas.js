import { makeExecutableSchema } from 'graphql-tools';

export const userSchema = makeExecutableSchema({
  typeDefs: `
    type User {
      username: String!
      email: String!
      password: String!
    }
    type Query {
      user(_id: ID!): User
    }
    type Mutation {
      signUp(
        username: String!
        email: String!
        password: String!
      ): Token!

      signIn(email: String!, password: String!): Token!
    }

    type Token {
      token: String!
    }
  `
  });