import playersSchemas from '../palyers/playersSchemas'

const Game = `
  input TeamInput {
    score: Int,
    offense: String,
    defense: String
  }
  type Team {
    score: Int,
    offense: Player,
    defense: Player
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
`
export default () => [Game, playersSchemas];
