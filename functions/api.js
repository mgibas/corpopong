const functions = require('firebase-functions')
const admin = require('firebase-admin')
const express = require('express')
const cors = require('cors')({origin: true})
const api = express()
admin.initializeApp(functions.config().firebase)

// const validateFirebaseIdToken = (req, res, next) => {
//   if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer '))) {
//     return res.status(403).send('Unauthorized')
//   }
//
//   let idToken = req.headers.authorization.split('Bearer ')[1]
//
//   admin.auth().verifyIdToken(idToken).then(decodedIdToken => {
//     req.user = decodedIdToken
//     next()
//   }).catch(error => {
//     console.error('Error while verifying Firebase ID token:', error)
//     return res.status(403).send('Unauthorized')
//   })
// }
api.use(cors)
// api.use(validateFirebaseIdToken)

api.post('/corpos', (req, res) => {
  res.status(200).send(`Hello Maciej`)
})

exports.api = functions.https.onRequest(api)
