const functions = require('firebase-functions')
const admin = require('firebase-admin')
admin.initializeApp(functions.config().firebase)

exports.createCorpo = functions.https.onRequest((req, res) => {
  res.sendStatus(200)
})

exports.createUser = functions.auth.user().onCreate(event => {
  return admin.database()
    .ref('/users')
    .child(event.data.uid)
    .set({
      email: event.data.email,
      displayName: event.data.displayName,
      photoURL: event.data.photoURL
      // rating: 750,
      // rated: false,
      // active: true
    })
})
exports.draftMatch = functions.database.ref('/orgs/{org}/users/{userUid}/draft-matches/{matchUid}')
  .onCreate(event => {
    if (event.auth.admin) { return }
    let orgRef = admin.database().ref(`/orgs/${event.params.org}`)
    let playersPromise = orgRef.ref(`/players`).once('value')
    let matchesPromise = orgRef.ref(`/users/${event.params.userUid}/matches/`).once('value')
    let openMatchesPromise = orgRef.ref('/open-match-details').once('value')
    let userOpenMatchesPromise = orgRef.ref(`/users/${event.params.userUid}/open-matches/`).once('value')

    return Promise.all([playersPromise, matchesPromise, openMatchesPromise, userOpenMatchesPromise])
      .then((snaps) => {
        let players = {}
        let playerRating = 0

        if (snaps[3].numChildren() >= 5) {
          return orgRef
            .ref(`/users/${event.params.userUid}/draft-matches/${event.params.matchUid}`)
            .set(null)
        }

        snaps[0].forEach((playerSnapshot) => {
          let player = playerSnapshot.val()
          player.matchesCount = 0
          player.openMatchesCount = 0
          player.uid = playerSnapshot.key
          players[playerSnapshot.key] = player
          if (playerSnapshot.key === event.params.userUid) { playerRating = player.rating }
        })
        snaps[1].forEach((matchSnapshot) => {
          let match = matchSnapshot.val()
          if (match.player1Uid === event.params.userUid) {
            players[match.player2Uid].matchesCount++
          } else {
            players[match.player1Uid].matchesCount++
          }
        })
        snaps[2].forEach((openMatchSnapshot) => {
          let openMatch = openMatchSnapshot.val()
          if (openMatch.player1Uid === event.params.userUid) {
            players[openMatch.player2Uid].hasOpenMatch = true
          } else if (openMatch.player2Uid === event.params.userUid) {
            players[openMatch.player1Uid].hasOpenMatch = true
          }
          players[openMatch.player1Uid].openMatchesCount++
          players[openMatch.player2Uid].openMatchesCount++
        })

        let oponents = Object.keys(players)
          .map(key => players[key])
          .filter((p) => p.active && p.rated && p.uid !== event.params.userUid)
          .filter((p) => !p.hasOpenMatch && p.openMatchesCount < 5)
          .filter((p) => Math.abs(p.rating - playerRating) <= 300)
          .sort((a, b) => a.matchesCount - b.matchesCount ||
            Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating))

        if (oponents.length === 0) {
          return orgRef
            .ref(`/users/${event.params.userUid}/draft-match-details/${event.params.matchUid}/noOponents`)
            .set(true)
        }

        let details = {
          player1Uid: event.params.userUid,
          player1Probability: calcProbability(playerRating, oponents[0].rating),
          player2Uid: oponents[0].uid,
          player2Probability: calcProbability(oponents[0].rating, playerRating),
          timestamp: admin.database.ServerValue.TIMESTAMP
        }

        return orgRef
          .ref(`/users/${event.params.userUid}/draft-match-details/${event.params.matchUid}`)
          .set(details)
      })
  })
exports.acceptDraftMatch = functions.database.ref('/orgs/{org}/users/{userUid}/draft-matches/{matchUid}/accept')
  .onCreate(event => {
    if (event.auth.admin) { return }
    let orgRef = admin.database().ref(`/orgs/${event.params.org}`)

    return orgRef
      .ref(`/users/${event.params.userUid}/draft-match-details/${event.params.matchUid}`)
      .once('value')
      .then((snap) => {
        let draftDetails = snap.val()
        let match = {
          player1Uid: draftDetails.player1Uid,
          player2Uid: draftDetails.player2Uid,
          createdDate: new Date().toISOString()
        }
        let details = Object.assign({
          approvals: {player1: '', player2: ''},
          scores: [{player1: 0, player2: 0}]
        }, match)

        return Promise.all([
          orgRef
            .ref(`/users/${match.player1Uid}/open-matches/${event.params.matchUid}`)
            .set(match),
          orgRef
            .ref(`/users/${match.player2Uid}/open-matches/${event.params.matchUid}`)
            .set(match),
          orgRef
            .ref(`/open-match-details/${event.params.matchUid}`)
            .set(details),
          orgRef
            .ref(`/players/${match.player1Uid}/active`)
            .set(true),
          orgRef
            .ref(`/users/${match.player1Uid}/draft-matches`)
            .set(null),
          orgRef
            .ref(`/users/${match.player1Uid}/draft-match-details`)
            .set(null)
        ])
      })
  })
exports.openMatchDetailsCreated = functions.database.ref('/orgs/{org}/open-match-details/{matchUid}')
  .onCreate(event => {
    let match = event.data.val()
    let orgRef = admin.database().ref(`/orgs/${event.params.org}`)

    return Promise.all([
      orgRef.ref(`/players/${match.player1Uid}`).once('value'),
      orgRef.ref(`/messaging/${match.player2Uid}`).once('value')
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

    return orgRef.ref(`/open-match-details/${event.params.matchUid}`)
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
          orgRef.ref(`/matches/${event.params.matchUid}`).set(finalMatch),
          orgRef.ref(`/users/${details.player1Uid}/matches/${event.params.matchUid}`).set(finalMatch),
          orgRef.ref(`/users/${details.player2Uid}/matches/${event.params.matchUid}`).set(finalMatch),
          orgRef.ref(`/users/${details.player1Uid}/open-matches/${event.params.matchUid}`).set(null),
          orgRef.ref(`/users/${details.player2Uid}/open-matches/${event.params.matchUid}`).set(null),
          orgRef.ref(`/open-match-details/${event.params.matchUid}`).set(null)
        ])
      })
  })
exports.updateRating = functions.database.ref('/orgs/{org}/matches/{matchUid}')
  .onCreate(event => {
    let orgRef = admin.database().ref(`/orgs/${event.params.org}`)
    let match = event.data.val()
    return Promise.all([
      orgRef.ref(`/players/${match.player1Uid}`).once('value'),
      orgRef.ref(`/players/${match.player2Uid}`).once('value')
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
        orgRef.ref(`/players/${match.player1Uid}/rating`)
          .set(player1NewRating),
        orgRef.ref(`/players/${match.player2Uid}/rating`)
          .set(player2NewRating),
        orgRef.ref(`/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        orgRef.ref(`/users/${match.player1Uid}/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        orgRef.ref(`/users/${match.player2Uid}/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        orgRef.ref(`/players/${match.player1Uid}/rated`)
          .set(true),
        orgRef.ref(`/players/${match.player2Uid}/rated`)
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
