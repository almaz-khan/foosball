import React, { Component } from 'react';
import './App.css';
import Team from './Team'
import { Form, FormGroup, Input, Button } from 'reactstrap';

class App extends Component {
  constructor() {
    super()
    this.state = {
      users: [],
      startDate: '',
      endDate: '',
      redTeamScore: '',
      blueTeamScore: '',
      participants: []
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
      .then(resp => {
        resp.json()
      })
      .then(game => {
        console.log(game)
        this.setState({
          startDate: '',
          endDate: '',
          redTeamScore: '',
          blueTeamScore: ''
        });
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
  render() {

    return (
      <div className="app">
        <div className="app-header">
          <Form onSubmit={this.auth.bind(this)} id="myForm">
            <FormGroup>
              <Input name="username" id="username" type="text" onChange={this.setUserName.bind(this)} />
            </FormGroup>
            <FormGroup>
              <Input name="password" id="password" type="password" onChange={this.setPassword.bind(this)}/>
            </FormGroup>
            <Button color="primary" type="submit">Submit</Button>
          </Form>
        </div>
        <div className="team-red">
          <Team users={this.state.users} team="red" setParticipants={this.setParticipants.bind(this)} />
          <Input type="number" value={this.state.redTeamScore} onChange={this.setRedTeamScore.bind(this)} />
        </div>
        <div className="team-blue">
          <Team users={this.state.users} team="blue"  setParticipants={this.setParticipants.bind(this)}/>
          <Input type="number" value={this.state.blueTeamScore} onChange={this.setBlueTeamScore.bind(this)}/>
        </div>

        <Button color="primary" onClick={this.startGame.bind(this)}>Start game</Button>
        <Button color="secondary" onClick={this.saveGame.bind(this)}>Finish game</Button>
      </div>
    );
  }
}

export default App;
