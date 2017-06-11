import React, { Component } from 'react';
import './App.css';
import Team from './Team'
import { Alert, InputGroupAddon, InputGroup, Collapse, Form, FormGroup, Input, Button } from 'reactstrap';

class App extends Component {
  constructor() {
    super()
    this.state = {
      showLogin: false,
      users: [],
      startDate: '',
      endDate: '',
      redTeamScore: '',
      blueTeamScore: '',
      participants: [],
      alertType: '',
      alertMessage: ''
    }
  }

  componentWillMount() {
    this.getUsers();
  }

  saveGame() {
    const game = {
        startDate: this.state.startDate,
        endDate: new Date(),
        score: {
          red: this.state.redTeamScore,
          blue: this.state.blueTeamScore
        },

        participants: this.state.participants
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
          redTeamScore: '',
          blueTeamScore: ''
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
    fetch('/api/users/')
      .then(res => {
        return res.json()
      })
      .then(users => {
        this.setState({users: users})
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

  setParticipants(participants) {
    const oldParticipants = this.state.participants.filter(item => item.team !== participants[0].team)

    this.setState({
      participants: [
        ...oldParticipants,
        ...participants
      ]
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

  render() {

    return (
      <div className="app">
        <div className="app-header">
          <div className="login-button">
            <Button color="primary" onClick={this.toggleLogin.bind(this)}>Log in</Button>
          </div>

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
            <Team users={this.state.users} team="red" setParticipants={this.setParticipants.bind(this)} />
            <InputGroup>
              <InputGroupAddon>Red Team score</InputGroupAddon>
              <Input type="number" value={this.state.redTeamScore} onChange={this.setRedTeamScore.bind(this)} />
            </InputGroup>
          </div>
          <div className="team-blue">
            <Team users={this.state.users} team="blue"  setParticipants={this.setParticipants.bind(this)}/>
            <InputGroup>
              <InputGroupAddon>Blue Team score</InputGroupAddon>
              <Input type="number" value={this.state.blueTeamScore} onChange={this.setBlueTeamScore.bind(this)}/>
            </InputGroup>
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
