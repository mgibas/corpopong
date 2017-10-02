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
    this.handler.get('/orgs/:name/exists', (req, res) => {
      this._admin.database()
        .ref(`/orgs/${req.params.name}`)
        .once('value', (snap) => {
          return res.send({exists: !!snap.val()})
        })
    })
    this.handler.post('/orgs', (req, res) => {
      console.log(req.body)
    })
  }
}

module.exports = Api
