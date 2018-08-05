const Players = `
  type Player { _id: String, firstName: String, lastName: String }
  input PlayerInput { firstName: String, lastName: String }
  type Query {
    players: [Player]
  }
  type Mutation {
    addPlayer(input: PlayerInput): Player
  }
`
export default () => [Players];
