const functions = require('firebase-functions');
const admin = require('firebase-admin');
const EloRank = require('elo-rank');

admin.initializeApp(functions.config().firebase);

exports.createPlayer = functions.auth.user().onCreate(event => {
  return admin.database()
    .ref('/players')
    .child(event.data.uid)
    .set({
      email: event.data.email,
      displayName: event.data.displayName,
      photoURL: event.data.photoURL
    })
});

exports.createChallenge = functions.database.ref('/users/{userUid}/challenges/{challengeUid}')
    .onWrite(event => {
      if(event.auth.admin) return;

      let challenge = event.data.val();
      if (event.data.previous.exists() || !event.data.exists() ||
        challenge.player1Uid === challenge.player2Uid) {
        return;
      }

      challenge.createdDate = new Date();
      return admin.database()
          .ref(`/users/${challenge.player2Uid}/challenges`)
          .child(event.params.challengeUid)
          .set(challenge);
    });

exports.syncScores = functions.database.ref('/users/{userUid}/challenges/{challengeUid}')
    .onWrite(event => {
      if (event.auth.admin || !event.data.previous.exists() || !event.data.exists())
        return;

      let challenge = event.data.val();
      let previousChallenge = event.data.previous.val();

      if(challenge.player1Score === previousChallenge.player1Score &&
        challenge.player2Score === previousChallenge.player2Score)
        return;

      challenge.player1Accepted = challenge.player2Accepted = false;
      return Promise.all([
        admin.database()
          .ref(`/users/${challenge.player1Uid}/challenges`)
          .child(event.params.challengeUid)
          .set(challenge),
        admin.database()
          .ref(`/users/${challenge.player2Uid}/challenges`)
          .child(event.params.challengeUid)
          .set(challenge)]);
    });

exports.syncAcceptances = functions.database.ref('/users/{userUid}/challenges/{challengeUid}')
  .onWrite(event => {
    if (event.auth.admin || !event.data.previous.exists() || !event.data.exists())
      return;

    let challenge = event.data.val();
    let previousChallenge = event.data.previous.val();

    if(challenge.player1Accepted === previousChallenge.player1Accepted &&
      challenge.player2Accepted === previousChallenge.player2Accepted)
      return;

    return Promise.all([
      admin.database()
        .ref(`/users/${challenge.player1Uid}/challenges`)
        .child(event.params.challengeUid)
        .set(challenge),
      admin.database()
        .ref(`/users/${challenge.player2Uid}/challenges`)
        .child(event.params.challengeUid)
        .set(challenge)]);
  });

exports.closeChallenge = functions.database.ref('/users/{userUid}/challenges/{challengeUid}')
  .onWrite(event => {
    if (event.auth.admin || !event.data.previous.exists() || !event.data.exists())
      return;

    let challenge = event.data.val();
    if(!challenge.player1Accepted || !challenge.player2Accepted)
      return;

    let match = {
      createdDate: new Date(),
      player1Uid: challenge.player1Uid,
      player2Uid: challenge.player2Uid,
      player1Score: challenge.player1Score,
      player2Score: challenge.player2Score,
    }

    return Promise.all([
      admin.database().ref(`/matches`).push(match),
      admin.database()
        .ref(`/users/${challenge.player1Uid}/challenges`)
        .child(event.params.challengeUid)
        .remove(),
      admin.database()
        .ref(`/users/${challenge.player2Uid}/challenges`)
        .child(event.params.challengeUid)
        .remove(),
    ]);
  });

exports.syncMatches = functions.database.ref('/matches/{matchUid}')
  .onWrite(event => {
    if (event.data.previous.exists() || !event.data.exists())
      return;

    let match = event.data.val();
    return Promise.all([
      admin.database()
        .ref(`/users/${match.player1Uid}/matches/${event.params.matchUid}`)
        .push(match),
      admin.database()
        .ref(`/users/${match.player2Uid}/matches/${event.params.matchUid}`)
        .push(match)
    ]);
  });

exports.updateRating = functions.database.ref('/matches/{matchUid}')
  .onWrite(event => {
    if (event.data.previous.exists() || !event.data.exists())
      return;

    let match = event.data.val();
    return Promise.all([
      admin.database().ref(`/players/${match.player1Uid}`).once('value'),
      admin.database().ref(`/players/${match.player2Uid}`).once('value')
    ]).then((playerRefs)=>{
      let elo = new EloRank();
      let player1Rating = playerRefs[0].val().rating || 0;
      let player2Rating = playerRefs[1].val().rating || 0;
      let player1ExpectedScore = elo.getExpected(player1Rating, player2Rating);
      let player2ExpectedScore = elo.getExpected(player2Rating, player1Rating);
      let player1NewRating = elo.updateRating(
        player1ExpectedScore,
        (match.player1Score > match.player2Score) * 1,
        player1Rating
      );
      let player2NewRating = elo.updateRating(
        player2ExpectedScore,
        (match.player2Score > match.player1Score) * 1,
        player2Rating
      );
      player1NewRating = player1NewRating > 0 ? player1NewRating : 0;
      player2NewRating = player2NewRating > 0 ? player2NewRating : 0;

      return Promise.all([
        admin.database().ref(`/players/${match.player1Uid}/rating`)
          .set(player1NewRating),
        admin.database().ref(`/players/${match.player2Uid}/rating`)
          .set(player2NewRating)
      ]);
    });
  });
