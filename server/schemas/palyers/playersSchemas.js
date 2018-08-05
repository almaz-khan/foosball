const Players = `
  type Player { _id: String, firstName: String, lastName: String }
  input PlayerInput { firstName: String, lastName: String }
`
export default () => [Players];
