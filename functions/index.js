const functions = require('firebase-functions')
const admin = require('firebase-admin')
admin.initializeApp(functions.config().firebase)

exports.createPlayer = functions.auth.user().onCreate(event => {
  return admin.database()
    .ref('/players')
    .child(event.data.uid)
    .set({
      email: event.data.email,
      displayName: event.data.displayName,
      photoURL: event.data.photoURL,
      rating: 750
    })
})
exports.createMatch = functions.database.ref('/users/{userUid}/open-matches/{matchUid}')
  .onWrite(event => {
    if (event.auth.admin || event.data.previous.exists() || !event.data.exists()) { return }

    let match = event.data.val()
    if (match.player1Uid === match.player2Uid) { return }

    match.createdDate = new Date().toISOString()
    let details = {
      player1Uid: match.player1Uid,
      player2Uid: match.player2Uid,
      createdDate: match.createdDate,
      approvals: {player1: '', player2: ''},
      scores: {player1: 0, player2: 0}
    }

    return Promise.all([
      admin.database()
        .ref(`/users/${match.player1Uid}/open-matches`)
        .child(event.params.matchUid)
        .set(match),
      admin.database()
        .ref(`/users/${match.player2Uid}/open-matches`)
        .child(event.params.matchUid)
        .set(match),
      admin.database()
        .ref(`/open-match-details/${event.params.matchUid}`)
        .set(details)
    ])
  })
exports.rejectMatch = functions.database.ref('/open-match-details/{matchUid}/removed')
  .onWrite(event => {
    if (event.auth.admin || !event.data.exists() || !event.data.val()) { return }

    return admin.database().ref(`/open-match-details/${event.params.matchUid}`)
      .once('value')
      .then((snap) => {
        let details = snap.val()
        return Promise.all([
          admin.database()
            .ref(`/users/${details.player1Uid}/open-matches/${event.params.matchUid}`)
            .set(null),
          admin.database()
            .ref(`/users/${details.player2Uid}/open-matches/${event.params.matchUid}`)
            .set(null),
          admin.database()
            .ref(`/open-match-details/${event.params.matchUid}`)
            .set(null)
        ])
      })
  })
exports.approvalsChanged = functions.database.ref('/open-match-details/{matchUid}/approvals')
  .onWrite((event) => {
    if (event.auth.admin || !event.data.exists() || !event.data.previous.exists()) { return }

    let approvals = event.data.val()
    if (!approvals.player1 || !approvals.player2) { return }

    return admin.database().ref(`/open-match-details/${event.params.matchUid}`)
      .once('value')
      .then((snap) => {
        let details = snap.val()
        let closingApproval = `${details.scores.player1}|${details.scores.player2}`
        if (closingApproval !== details.approvals.player1 ||
          closingApproval !== details.approvals.player2) {
          return
        }

        let finalMatch = {
          finalizedDate: new Date().toISOString(),
          createdDate: details.createdDate,
          player1Uid: details.player1Uid,
          player2Uid: details.player2Uid,
          scores: details.scores
        }
        return Promise.all([
          admin.database().ref(`/matches/${event.params.matchUid}`).set(finalMatch),
          admin.database().ref(`/users/${details.player1Uid}/matches/${event.params.matchUid}`).set(finalMatch),
          admin.database().ref(`/users/${details.player2Uid}/matches/${event.params.matchUid}`).set(finalMatch),
          admin.database().ref(`/users/${details.player1Uid}/open-matches/${event.params.matchUid}`).set(null),
          admin.database().ref(`/users/${details.player2Uid}/open-matches/${event.params.matchUid}`).set(null),
          admin.database().ref(`/open-match-details/${event.params.matchUid}`).set(null)
        ])
      })
  })
exports.updateRating = functions.database.ref('/matches/{matchUid}')
  .onWrite(event => {
    if (event.data.previous.exists() || !event.data.exists()) { return }

    let match = event.data.val()
    return Promise.all([
      admin.database().ref(`/players/${match.player1Uid}`).once('value'),
      admin.database().ref(`/players/${match.player2Uid}`).once('value')
    ]).then((playerRefs) => {
      let p1Rating = playerRefs[0].val().rating
      let p2Rating = playerRefs[1].val().rating
      let p1Score = Number(match.scores.player1)
      let p2Score = Number(match.scores.player2)
      let p1Prob = calcProbability(p1Rating, p2Rating)
      let p2Prob = calcProbability(p2Rating, p1Rating)
      let kFactor = 50 * calcKFactorMultiplier(p1Score, p2Score, p1Rating, p2Rating)

      let player1NewRating = calcNewRating(
        p1Prob, p1Score > p2Score ? 1 : p1Score < p2Score ? 0 : 0.5,
        p1Rating, kFactor
      )
      let player2NewRating = calcNewRating(
        p2Prob, p2Score > p1Score ? 1 : p2Score < p1Score ? 0 : 0.5,
        p2Rating, kFactor
      )
      let ratings = {
        player1Prev: p1Rating,
        player2Prev: p2Rating,
        player1New: player1NewRating,
        player2New: player2NewRating
      }

      return Promise.all([
        admin.database().ref(`/players/${match.player1Uid}/rating`)
          .set(player1NewRating),
        admin.database().ref(`/players/${match.player2Uid}/rating`)
          .set(player2NewRating),
        admin.database().ref(`/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        admin.database().ref(`/users/${match.player1Uid}/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        admin.database().ref(`/users/${match.player2Uid}/matches/${event.params.matchUid}/ratings`)
          .set(ratings)
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
