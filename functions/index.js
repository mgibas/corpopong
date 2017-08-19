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
      rating: 750,
      rated: false
    })
})
exports.draftMatch = functions.database.ref('/users/{userUid}/draft-matches/{matchUid}')
  .onCreate(event => {
    if (event.auth.admin) { return }

    let playersPromise = admin.database().ref(`/players`).once('value')
    let matchesPromise = admin.database().ref(`/users/${event.params.userUid}/matches/`).once('value')
    let openMatchesPromise = admin.database().ref('/open-match-details').once('value')

    return Promise.all([playersPromise, matchesPromise, openMatchesPromise])
      .then((snaps) => {
        let players = {}
        let playerRating = 0

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

        let draft = {
          player1Uid: event.params.userUid,
          player1Probability: calcProbability(playerRating, oponents[0].rating),
          player2Uid: oponents[0].uid,
          player2Probability: calcProbability(oponents[0].rating, playerRating),
          createdDate: new Date().toISOString()
        }

        return admin.database()
          .ref(`/users/${event.params.userUid}/draft-matches/${event.params.matchUid}`)
          .set(draft)
      })
  })
exports.acceptDraftMatch = functions.database.ref('/users/{userUid}/draft-matches/{matchUid}/accept')
  .onWrite(event => {
    if (event.auth.admin || !event.data.exists()) { return }

    let accepted = event.data.val()
    if (!accepted) return

    return admin.database()
      .ref(`/users/${event.params.userUid}/draft-matches/${event.params.matchUid}`)
      .once('value')
      .then((snap) => {
        let draft = snap.val()
        let match = {
          player1Uid: draft.player1Uid,
          player2Uid: draft.player2Uid,
          createdDate: new Date().toISOString()
        }
        let details = Object.assign({
          approvals: {player1: '', player2: ''},
          scores: [{player1: 0, player2: 0}]
        }, match)

        return Promise.all([
          admin.database()
            .ref(`/users/${match.player1Uid}/open-matches/${event.params.matchUid}`)
            .set(match),
          admin.database()
            .ref(`/users/${match.player2Uid}/open-matches/${event.params.matchUid}`)
            .set(match),
          admin.database()
            .ref(`/open-match-details/${event.params.matchUid}`)
            .set(details),
          admin.database()
            .ref(`/users/${match.player1Uid}/draft-matches`)
            .set(null)
        ])
      })
  })
exports.approvalsChanged = functions.database.ref('/open-match-details/{matchUid}/approvals')
  .onUpdate((event) => {
    if (event.auth.admin) { return }

    let approvals = event.data.val()
    if (!approvals.player1 || !approvals.player2) { return }

    return admin.database().ref(`/open-match-details/${event.params.matchUid}`)
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
  .onCreate(event => {
    let match = event.data.val()
    return Promise.all([
      admin.database().ref(`/players/${match.player1Uid}`).once('value'),
      admin.database().ref(`/players/${match.player2Uid}`).once('value')
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
        admin.database().ref(`/players/${match.player1Uid}/rating`)
          .set(player1NewRating),
        admin.database().ref(`/players/${match.player2Uid}/rating`)
          .set(player2NewRating),
        admin.database().ref(`/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        admin.database().ref(`/users/${match.player1Uid}/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        admin.database().ref(`/users/${match.player2Uid}/matches/${event.params.matchUid}/ratings`)
          .set(ratings),
        admin.database().ref(`/players/${match.player1Uid}/rated`)
          .set(true),
        admin.database().ref(`/players/${match.player2Uid}/rated`)
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
