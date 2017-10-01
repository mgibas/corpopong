const express = require('express')
const cors = require('cors')({origin: true})

class Api {
  constructor (admin) {
    this._admin = admin
    this.handler = express()
    this.handler.use(cors)
    this.handler.use(this.validateToken)
    this._configureRoutes()
  }

  validateToken (req, res, next) {
  //   if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer '))) {
  //     return res.status(403).send('Unauthorized')
  //   }
  //
  //   let idToken = req.headers.authorization.split('Bearer ')[1]
  //
  //   admin.auth().verifyIdToken(idToken).then(decodedIdToken => {
  //     req.user = decodedIdToken
    next()
  //   }).catch(error => {
  //     console.error('Error while verifying Firebase ID token:', error)
  //     return res.status(403).send('Unauthorized')
  //   })
  }
  _configureRoutes () {
    this.handler.post('/corpos', (req, res) => {
      res.status(200).send(`Hello Maciej`)
    })
  }
}

exports = Api
