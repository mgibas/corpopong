
const functions = require('firebase-functions')
const admin = require('firebase-admin')
const Api = require('./api')

admin.initializeApp(functions.config().firebase)

exports.api = functions.https.onRequest((new Api(admin)).handler)
exports.createUser = functions.auth.user().onCreate(event => {
  return admin.database()
    .ref('/users')
    .child(event.data.uid)
    .set({
      uid: event.data.uid,
      email: event.data.email,
      displayName: event.data.displayName,
      photoURL: event.data.photoURL
    })
})
exports.openMatchDetailsCreated = functions.database.ref('/orgs/{org}/open-match-details/{matchUid}')
  .onCreate(event => {
    let match = event.data.val()
    let orgRef = admin.database().ref(`/orgs/${event.params.org}`)

    return Promise.all([
      orgRef.child(`/players/${match.player1Uid}`).once('value'),
      orgRef.child(`/messaging/${match.player2Uid}`).once('value')
    ]).then((snaps) => {
      let player1 = snaps[0].val()
      let player2Messaging = snaps[1].val()
      if (!player2Messaging || !player2Messaging.token) return

      let notificationPayload = {
        notification: {
          title: 'Match Created!',
          body: `${player1.displayName} created ranked match with you. Go and win!`
        }
      }

      return admin.messaging().sendToDevice([player2Messaging.token], notificationPayload)
    })
  })
exports.approvalsChanged = functions.database.ref('/orgs/{org}/open-match-details/{matchUid}/approvals')
  .onUpdate((event) => {
    if (event.auth.admin) { return }
    let orgRef = admin.database().ref(`/orgs/${event.params.org}`)

    let approvals = event.data.val()
    if (!approvals.player1 || !approvals.player2) { return }

    return orgRef.child(`/open-match-details/${event.params.matchUid}`)
      .once('value')
      .then((snap) => {
        let details = snap.val()
        let closingApproval = details.scores.reduce((approval, score) => {
          return approval + `|${score.player1}|${score.player2}`
        }, '')
        if (closingApproval !== details.approvals.player1 ||
          closingApproval !== details.approvals.player2) {
          return
        }

        let player1Games = details.scores.filter((s) => Number(s.player1) > Number(s.player2)).length
        let player2Games = details.scores.length - player1Games

        let finalMatch = {
          finalizedDate: new Date().toISOString(),
          createdDate: details.createdDate,
          player1Uid: details.player1Uid,
          player2Uid: details.player2Uid,
          scores: details.scores,
          player1Games: player1Games,
          player2Games: player2Games,
          winnerUid: player1Games > player2Games ? details.player1Uid : details.player2Uid
        }
        return Promise.all([
          orgRef.child(`/matches/${event.params.matchUid}`).set(finalMatch),
          orgRef.child(`/player-matches/${details.player1Uid}/${event.params.matchUid}`).set(finalMatch),
          orgRef.child(`/player-matches/${details.player2Uid}/${event.params.matchUid}`).set(finalMatch),
          orgRef.child(`/player-open-matches/${details.player1Uid}/${event.params.matchUid}`).set(null),
          orgRef.child(`/player-open-matches/${details.player2Uid}/${event.params.matchUid}`).set(null),
          orgRef.child(`/open-match-details/${event.params.matchUid}`).set(null)
        ])
      })
  })
exports.updateRating = functions.database.ref('/orgs/{org}/matches/{matchUid}')
  .onCreate(event => {
    let orgRef = admin.database().ref(`/orgs/${event.params.org}`)
    let match = event.data.val()
    return Promise.all([
      orgRef.child(`/players/${match.player1Uid}`).once('value'),
      orgRef.child(`/players/${match.player2Uid}`).once('value')
    ]).then((playerRefs) => {
      let p1Rating = playerRefs[0].val().rating
      let p2Rating = playerRefs[1].val().rating
      let p1Score = match.scores.reduce((total, i) => total + Number(i.player1), 0)
      let p2Score = match.scores.reduce((total, i) => total + Number(i.player2), 0)
      let p1Prob = calcProbability(p1Rating, p2Rating)
      let p2Prob = calcProbability(p2Rating, p1Rating)
      let kFactor = 50 * calcKFactorMultiplier(p1Score, p2Score, p1Rating, p2Rating)
      let p1Result = match.player1Games > match.player2Games ? 1 : match.player1Games < match.player2Games ? 0 : 0.5
      let p2Result = 1 - p1Result
      let player1NewRating = calcNewRating(p1Prob, p1Result, p1Rating, kFactor)
      let player2NewRating = calcNewRating(p2Prob, p2Result, p2Rating, kFactor)
      let ratings = {
        player1Prev: p1Rating,
        player2Prev: p2Rating,
        player1New: player1NewRating,
        player2New: player2NewRating
      }

      return Promise.all([
        orgRef.child(`/players/${match.player1Uid}/rating`)
          .set(player1NewRating),
        orgRef.child(`/players/${match.player2Uid}/rating`)
          .set(player2NewRating),
        orgRef.child(`/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        orgRef.child(`/player-matches/${match.player1Uid}/${event.params.matchUid}/ratings`)
          .set(ratings),
        orgRef.child(`/player-matches/${match.player2Uid}/${event.params.matchUid}/ratings`)
          .set(ratings),
        orgRef.child(`/players/${match.player1Uid}/rated`)
          .set(true),
        orgRef.child(`/players/${match.player2Uid}/rated`)
          .set(true)
      ])
    })
  })
let calcKFactorMultiplier = (score1, score2, rating1, rating2) => {
  let diff = Math.log(Math.abs(score1 - score2) + 1)
  let ratingDiff = score1 > score2 ? rating1 - rating2 : rating2 - rating1
  return diff * (2.2 / (ratingDiff * 0.001 + 2.2))
}
let calcNewRating = (expected, actual, current, kFactor) => {
  return Math.round(current + kFactor * (actual - expected))
}
let calcProbability = (rating1, rating2) => {
  return 1 / (1 + Math.pow(10, ((rating2 - rating1) / 400)))
}
