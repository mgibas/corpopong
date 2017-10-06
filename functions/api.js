const express = require('express')
const cors = require('cors')({origin: true})

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
    this.handler.post('/orgs', (req, res) => {
      this._admin.database().ref(`/orgs/${req.body.name}`)
        .once('value')
        .then((snap) => {
          if (snap.val()) return res.status(400).send(`org ${req.body.name} already exists`)
          let newPlayer = {
            email: req.user.email,
            displayName: req.user.name,
            photoURL: req.user.picture,
            rating: 750,
            rated: false,
            active: true,
            admin: true
          }
          let newOrg = {
            name: req.body.name,
            players: {}
          }
          let orgInfo = {
            name: req.body.name
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
            res.sendStatus(200)
          })
        })
    })
    this.handler.post('/orgs/:name/players', (req, res) => {
      res.sendStatus(200)
      // user domain == org-info.auto-accept-domain
      // body invitation url == org.invitation-url
      // user
    })
  }
}

module.exports = Api
