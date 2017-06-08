import React, { Component } from 'react';
import { Table } from 'reactstrap';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';

class Team extends Component {
  constructor() {
    super()
    this.state = {
      defenseOpen: false,
      atackOpen: false,
      defense: {},
      attacker: {}
    }

    this.toggleAtack = this.toggleAtack.bind(this);
    this.toggleDefense = this.toggleDefense.bind(this);
  }

  toggleAtack() {
    this.setState({
      atackOpen: !this.state.atackOpen
    });
  }

  toggleDefense() {
    this.setState({
      defenseOpen: !this.state.defenseOpen
    });
  }

  getDefensePlayers() {
    const defensePlayers = this.props.users.filter(user => this.state.attacker._id !== user._id)

    return (
      <DropdownMenu>
        {defensePlayers.map( player => {
          const setDefensePlayer = () => {
            this.setState({
              defense: player
            })

            this.props.setParticipants([{
              team: this.props.team,
              position: 'defense',
              user: player._id
            }, {
              team: this.props.team,
              position: 'attaker',
              user: this.state.attacker._id
            }])
          }

          return <DropdownItem
            onClick={setDefensePlayer}
            key={player._id}
          >{player.username}</DropdownItem>
        })}
      </DropdownMenu>
    )
  }

  getAttackPlayers() {
    const atackPlayers = this.props.users
      .filter(user => this.state.defense._id !== user._id)

    return (
      <DropdownMenu>
        { atackPlayers.map( player => {
          const setAtackPlayer = () => {
            this.setState({
              attacker: player
            })

            this.props.setParticipants([{
              team: this.props.team,
              position: 'defense',
              user: this.state.defense._id
            }, {
              team: this.props.team,
              position: 'attaker',
              user: player._id
            }])
          }

          return <DropdownItem
            onClick={setAtackPlayer.bind(this)}
            key={player._id}
          >{player.username}</DropdownItem>
          })}
      </DropdownMenu>
    )
  }

  render() {

    return (
      <Table>
        <thead>
          <tr>
            <th>Defense player</th>
            <th>Attack player</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <Dropdown isOpen={this.state.defenseOpen} toggle={this.toggleDefense}>
                <DropdownToggle caret>
                  {this.state.defense.username || 'Dropdown'}
                </DropdownToggle>
                {this.getDefensePlayers()}
              </Dropdown>
            </td>

            <td>
              <Dropdown isOpen={this.state.atackOpen} toggle={this.toggleAtack}>
                <DropdownToggle caret>
                  {this.state.attacker.username || 'Dropdown'}
                </DropdownToggle>
                {this.getAttackPlayers()}
              </Dropdown>
            </td>
          </tr>
        </tbody>
      </Table>
    )
  }
}

export default Team;
