const express = require('express')
const cors = require('cors')({origin: true})
const uuid = require('uuid/v4')

class Api {
  constructor (admin) {
    this._admin = admin
    this.handler = express()
    this.handler.use(cors)
    this.handler.use((req, res, next) => this.validateToken(req, res, next))
    this._configureRoutes()
  }

  validateToken (req, res, next) {
    if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer '))) {
      return res.status(403).send('Unauthorized')
    }

    this._admin.auth()
      .verifyIdToken(req.headers.authorization.split('Bearer ')[1])
      .then(user => {
        req.user = user
        return next()
      })
      .catch(error => {
        console.error('Error while verifying Firebase ID token:', error)
        return res.status(403).send('Unauthorized')
      })
  }
  _configureRoutes () {
    let createPlayer = (email, displayName, photoUrl, admin) => {
      return {
        email: email,
        displayName: displayName,
        photoURL: photoUrl,
        rating: 750,
        rated: false,
        active: true,
        admin: admin || false
      }
    }
    this.handler.post('/orgs', (req, res) => {
      this._admin.database().ref(`/orgs/${req.body.name}`)
        .once('value')
        .then((snap) => {
          if (snap.val()) return res.status(400).send(`org ${req.body.name} already exists`)

          let newPlayer = createPlayer(
            req.user.email,
            req.user.name,
            req.user.picture,
            true
          )
          let newOrg = {
            name: req.body.name.toLowerCase(),
            admin: {
              invitationCode: uuid()
            },
            players: {}
          }
          let orgInfo = {
            name: newOrg.name
          }
          newOrg.players[req.user.uid] = newPlayer
          Promise.all([
            this._admin.database().ref(`/orgs/${req.body.name}`)
              .set(newOrg),
            this._admin.database().ref(`/org-infos/${req.body.name}`)
              .set(orgInfo),
            this._admin.database().ref(`/users/${req.user.uid}/orgs/${req.body.name}`)
              .set(true)
          ]).then(() => {
            res.status(200).send({
              name: newOrg.name,
              invitationCode: newOrg.admin.invitationCode
            })
          })
        })
    })
    this.handler.post('/orgs/:name/players', (req, res) => {
      this._admin.database().ref(`/orgs/${req.params.name}`)
        .once('value')
        .then((snap) => {
          let org = snap.val()
          if (!org) return res.status(400).send(`org ${req.params.name} does not exists`)
          if (org.players && org.players[req.user.uid]) return res.sendStatus(200)
          if (req.user.email.split('@')[1] !== org.admin.autoAcceptDomain &&
            (!req.body || !req.body.invitation || req.body.invitation.split('code=')[1] !== org.admin.invitationCode)) {
            return res.status(403).send({error: 'invitation_required'})
          }

          Promise.all([
            this._admin.database().ref(`/orgs/${org.name}/players/${req.user.uid}`)
              .set(createPlayer(req.user.email, req.user.name, req.user.picture)),
            this._admin.database().ref(`/users/${req.user.uid}/orgs/${org.name}`)
              .set(false)
          ]).then(() => {
            return res.sendStatus(200)
          })
        })
    })
    this.handler.get('/orgs/:org/oponents', (req, res) => {
      let orgRef = this._admin.database().ref(`/orgs/${req.params.org}`)
      let playersPromise = orgRef.child(`/players`).once('value')
      let matchesPromise = orgRef.child(`/users/${req.user.uid}/matches/`).once('value')
      let openMatchesPromise = orgRef.child('/open-match-details').once('value')
      let userOpenMatchesPromise = orgRef.child(`/users/${req.user.uid}/open-matches/`).once('value')

      return Promise.all([playersPromise, matchesPromise, openMatchesPromise, userOpenMatchesPromise])
        .then((snaps) => {
          let players = {}
          let playerRating = 0

          snaps[0].forEach((playerSnapshot) => {
            let player = playerSnapshot.val()
            player.matchesCount = 0
            player.openMatchesCount = 0
            player.uid = playerSnapshot.key
            players[playerSnapshot.key] = player
            if (playerSnapshot.key === req.user.uid) { playerRating = player.rating }
          })
          snaps[1].forEach((matchSnapshot) => {
            let match = matchSnapshot.val()
            if (match.player1Uid === req.user.uid) {
              players[match.player2Uid].matchesCount++
            } else {
              players[match.player1Uid].matchesCount++
            }
          })
          snaps[2].forEach((openMatchSnapshot) => {
            let openMatch = openMatchSnapshot.val()
            if (openMatch.player1Uid === req.user.uid) {
              players[openMatch.player2Uid].hasOpenMatch = true
            } else if (openMatch.player2Uid === req.user.uid) {
              players[openMatch.player1Uid].hasOpenMatch = true
            }
            players[openMatch.player1Uid].openMatchesCount++
            players[openMatch.player2Uid].openMatchesCount++
          })

          let all = Object.keys(players)
            .map(key => players[key])
            .filter((p) => p.active && p.rated && p.uid !== req.user.uid)

          let recommended = all
            .filter((p) => !p.hasOpenMatch && p.openMatchesCount < 5)
            .filter((p) => Math.abs(p.rating - playerRating) <= 300)
            .sort((a, b) => a.matchesCount - b.matchesCount ||
              Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating))

          res.status(200).send({all: all, recommended: recommended})
        })
    })
  }
}

module.exports = Api
