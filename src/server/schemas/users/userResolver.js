import User from './userModel'
import jwt from 'jsonwebtoken'
import { combineResolvers } from 'graphql-resolvers'
import bcrypt from 'bcrypt'
import { isAuthenticated } from '../authorization/authorizationResolver';

const createToken = async (user, secret, expiresIn) => {
  const { id, email, username } = user

  return await jwt.sign({ id, email, username }, secret, { expiresIn })
}

export const usersResolvers = {
  Query: {
    getUser: combineResolvers(
      isAuthenticated,
      (_, args, { me }) => {
        return me;
      }
    )
  },

  Mutation: {
    async signUp(_, { username, email, password }, { secret }) {
      const user = await User.create({username, email, password})

      return {
        token: await createToken(user, secret, '1000h')
      }
    },
    async signIn(_, { email, password }, { models, secret }) {
        const user = await User.findOne({email: email});

        if (!user) {
          throw new UserInputError(
            'No user found with this login credentials.',
          );
        }

        const isValid = bcrypt.compareSync(password, user.password);

        if (!isValid) {
          throw new AuthenticationError('Invalid password.');
        }

        return { token: createToken(user, secret, '1000h') };
      }
  }
}
