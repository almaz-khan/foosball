import { makeExecutableSchema } from 'graphql-tools';

export const userSchema = makeExecutableSchema({
  typeDefs: `
      type User { username: String!, _id: ID! }
      type Query {
        user(_id: ID!): User
    }
  `
  });
