import React, { Component } from 'react';
import './App.css';
//import Team from './Team'
import { Alert, InputGroupAddon, InputGroup, Collapse, Form, FormGroup, Input, Button } from 'reactstrap';

class App extends Component {
  constructor() {
    super()
    this.state = {
      showLogin: false,
      users: [],
      startDate: '',
      endDate: '',
      redTeamScore: 0,
      blueTeamScore: 0,
      participants: [],
      alertType: '',
      alertMessage: '',
      blueDefense: '',
      blueOffense: '',
      redDefense: '',
      redOffense: ''
    }
  }

  componentWillMount() {
    this.getUsers();
  }

  saveGame() {
    const game = {
      startDate: this.state.startDate,
      endDate: new Date(),
      red:{
        score: this.state.redTeamScore,
        defense: this.state.redDefense,
        offense: this.state.redOffense
      },

      blue: {
        score: this.state.blueTeamScore,
        defense: this.state.blueDefense,
        offense: this.state.blueOffense
      }
    }
    const token = localStorage.getItem('token') || ''

    fetch('/api/games', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(game)
      })
      .then(resp => resp.json())
      .then(game => {
        this.setState({
          startDate: '',
          endDate: '',
          redTeamScore: 0,
          blueTeamScore: 0
        });
        this.setState({
          alertType: 'success',
          alertMessage: 'Game was saved'
        })
      })
      .catch(err => {
        this.setState({
          alertType: 'danger',
          alertMessage: 'Game was not saved'
        })
      });

  }

  getUsers() {
    fetch('/api/players/')
      .then(res => {
        return res.json()
      })
      .then(players => {
        this.setState({users: players})
      })
      .catch(err => console.error(err))
  }

  setRedTeamScore(event) {
    this.setState({
      redTeamScore: event.target.value
    });
  }

  setBlueTeamScore(event) {
    this.setState({
      blueTeamScore: event.target.value
    });
  }

  startGame() {
    this.setState({
      startDate: new Date()
    })
  }

  auth(event, form) {

    fetch('/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
          username: this.state.username,
          password: this.state.password
        })
      })
      .then(resp => resp.json())
      .then(response => {
        localStorage.setItem('token', response.token);

        this.setState({
          password: '',
          username: ''
        })
        this.toggleLogin();
        this.setState({
          alertMessage: 'You are logged in',
          alertType: 'success'
        })
      })
      .catch(err => {
        this.setState({
          alertMessage: 'You are not logged in',
          alertType: 'danger'
        })
      })
    event.preventDefault()
    return
  }

  setParticipants(player) {
    const playersList = [
      'redDefense',
      'redOffense',
      'blueDefense',
      'blueOffense',
    ]
    let unsettedPlayers = playersList.find(player => {
      return !this.state[player]
    })

    this.setState({
      [unsettedPlayers]: player
    })
  }

  setUserName(event) {
    this.setState({
      username: event.target.value
    })
  }

  setPassword(event) {
    this.setState({
      password: event.target.value
    })
  }

  toggleLogin() {
    this.setState({
      showLogin: !this.state.showLogin
    })
  }

  showButton() {
    if (this.state.startDate) {
      return <Button color="secondary" onClick={this.saveGame.bind(this)}>Finish game</Button>
    } else {
      return <Button color="primary" onClick={this.startGame.bind(this)}>Start game</Button>
    }
  }

  onDismiss() {
    this.setState({
      alertMessage: ''
    })
  }

  showPlayers() {
    const playersList = [
      'redDefense',
      'redOffense',
      'blueDefense',
      'blueOffense'
    ]
    let settedPlayers = []
    playersList.forEach(player => {
      if (this.state[player]) {
        settedPlayers.push(this.state[player])
      }
    })

    const players = this.state.users.filter(user => {
      return settedPlayers.findIndex(settedP => settedP._id === user._id) <= -1
    })

    return players.map(player => {
      const setPlayer = () => {
        this.setParticipants(player)
      }
      return <div className="player" key={player._id} onClick={setPlayer.bind(this)} >{player.firstName} {player.secondName}</div>
    })
  }

  addBlueScore() {
  this.setState({
      blueTeamScore: this.state.blueTeamScore + 1
    })
  }

  addRedScore() {
    this.setState({
      redTeamScore: this.state.redTeamScore + 1
    })
  }

  render() {

    return (
      <div className="app">
        <div className="app-header">

          <div className="alert-message">
            <Alert color={this.state.alertType || 'success'} isOpen={this.state.alertMessage} toggle={this.onDismiss.bind(this)}>
              {this.state.alertMessage}
            </Alert>
          </div>

          <div className="login-form">
            <Collapse isOpen={this.state.showLogin}>
              <Form onSubmit={this.auth.bind(this)} id="myForm">
                <FormGroup>
                  <Input placeholder="username" name="username" id="username" type="text" onChange={this.setUserName.bind(this)} />
                </FormGroup>
                <FormGroup>
                  <Input placeholder="password"  name="password" id="password" type="password" onChange={this.setPassword.bind(this)}/>
                </FormGroup>
                <Button color="primary" type="submit">Submit</Button>
              </Form>
            </Collapse>
          </div>
        </div>

        <div className="content">
          <div className="team-red">
            <div className="defense">Defense: {this.state.redDefense.firstName} {this.state.redDefense.secondName}</div>
            <div className="offense">Offense: {this.state.redOffense.firstName} {this.state.redOffense.secondName}</div>
            <InputGroup>
              <InputGroupAddon>Red Team score</InputGroupAddon>
              <Input type="number" value={this.state.redTeamScore} onChange={this.setRedTeamScore.bind(this)} />
              <Button color="primary" onClick={this.addRedScore.bind(this)}>+</Button>
            </InputGroup>
          </div>
          <div className="team-blue">
            <div className="defense">Defense: {this.state.blueDefense.firstName} {this.state.blueDefense.secondName}</div>
            <div className="offense">Offense: {this.state.blueOffense.firstName} {this.state.blueOffense.secondName}</div>
            <InputGroup>
              <InputGroupAddon>Blue Team score</InputGroupAddon>
              <Input type="number" value={this.state.blueTeamScore} onChange={this.setBlueTeamScore.bind(this)}/>
              <Button color="primary" onClick={this.addBlueScore.bind(this)}>+</Button>
            </InputGroup>
          </div>

          <div className="players">
            {this.showPlayers()}
          </div>
          <div className="buttons-container">
            {this.showButton()}
          </div>
        </div>
      </div>
    );
  }
}

export default App;
