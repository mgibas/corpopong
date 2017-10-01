const functions = require('firebase-functions')

exports.createCorpo = functions.https.onRequest((req, res) => {
  res.sendStatus(200)
})
