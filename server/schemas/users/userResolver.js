import User from './userModel'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

const createToken = async (user, secret, expiresIn) => {
  const { id, email, username } = user

  return await jwt.sign({ id, email, username }, secret, { expiresIn })
}

export const usersResolvers = {
  Query: {
    async user(_, {_id}) {
      return await User.findById(_id)
    }
  },

  Mutation: {
    async signUp(_, { username, email, password }, { secret }) {
      const user = await User.create({username, email, password})

      return {
        token: await createToken(user, secret, '30m')
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

        return { token: createToken(user, secret, '30m') };
      }
  }
}
