const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp(functions.config().firebase);

exports.createPlayer = functions.auth.user().onCreate(event => {
  return admin.database()
    .ref('/players')
    .child(event.data.uid)
    .set({
      email: event.data.email,
      displayName: event.data.displayName,
      photoURL: event.data.photoURL,
      rating: 0
    })
});

exports.createMatch = functions.database.ref('/users/{userUid}/matches/{matchUid}')
  .onWrite(event => {
    if (event.auth.admin || event.data.previous.exists() || !event.data.exists())
      return;

    let match = event.data.val();
    if(match.final || match.player1Uid === match.player2Uid)
      return;

    match.createdDate = new Date().toISOString();
    match.final = false;

    return Promise.all([
      admin.database()
        .ref(`/users/${match.player1Uid}/matches`)
        .child(event.params.matchUid)
        .set(match),
      admin.database()
        .ref(`/users/${match.player2Uid}/matches`)
        .child(event.params.matchUid)
        .set(match)
    ]);

  });

exports.rejectMatch = functions.database.ref('/users/{userUid}/matches/{matchUid}')
  .onWrite(event => {
    if (event.data.exists())
      return;

    let deletedMatch = event.data.previous.val();

    return Promise.all([
      admin.database()
        .ref(`/users/${deletedMatch.player1Uid}/matches`)
        .child(event.params.matchUid)
        .set(null),
      admin.database()
        .ref(`/users/${deletedMatch.player2Uid}/matches`)
        .child(event.params.matchUid)
        .set(null)
    ]);
  });

let syncScores = (event, propertyName) => {
  if (event.auth.admin || !event.data.previous.exists() || !event.data.exists())
    return;

  let score = event.data.val();
  let previousScore = event.data.previous.val();

  if(score === previousScore)
    return;

  return admin.database().ref(`/users/${event.params.userUid}/matches/${event.params.matchUid}`)
    .once('value')
    .then((snap) => {
      let match = snap.val();
      let playerToUpdate = event.params.userUid === match.player1Uid ? match.player2Uid : match.player1Uid;
      return  Promise.all([
        admin.database()
          .ref(`/users/${playerToUpdate}/matches/${event.params.matchUid}`)
          .child(propertyName)
          .set(score),
        admin.database()
          .ref(`/users/${playerToUpdate}/matches/${event.params.matchUid}/player1Accepted`)
          .set(false),
        admin.database()
          .ref(`/users/${playerToUpdate}/matches/${event.params.matchUid}/player2Accepted`)
          .set(false),
      ]);
    });
}
exports.syncPlayer1Score = functions.database.ref('/users/{userUid}/matches/{matchUid}/player1Score')
  .onWrite((e) => syncScores(e, 'player1Score'));
exports.syncPlayer2Score = functions.database.ref('/users/{userUid}/matches/{matchUid}/player2Score')
  .onWrite((e) => syncScores(e, 'player2Score'));

let syncAcceptances = (event, propertyName) => {
  if (event.auth.admin || !event.data.previous.exists() || !event.data.exists())
    return;

  let accepted = event.data.val();
  let previousAccepted = event.data.previous.val();
  if(accepted === previousAccepted)
    return;

  return admin.database().ref(`/users/${event.params.userUid}/matches/${event.params.matchUid}`)
    .once('value')
    .then((snap) => {
      let match = snap.val();

      if(match.player1Accepted && match.player2Accepted) {
        match.final = true;
        match.finalizedDate = new Date().toISOString();
        delete match.player1Accepted;
        delete match.player2Accepted;
      }
      let playerToUpdate = event.params.userUid === match.player1Uid ? match.player2Uid : match.player1Uid;

      return Promise.all([
        match.final ? admin.database().ref(`/matches/${event.params.matchUid}`).set(match) : Promise.resolve(),
        admin.database()
          .ref(`/users/${playerToUpdate}/matches/${event.params.matchUid}`)
          .child(propertyName)
          .set(accepted)
      ]);
    });
};
exports.syncPlayer1Accepted = functions.database.ref('/users/{userUid}/matches/{matchUid}/player1Accepted')
  .onWrite((e) => syncAcceptances(e, 'player1Accepted'));
exports.syncPlayer2Accepted = functions.database.ref('/users/{userUid}/matches/{matchUid}/player2Accepted')
  .onWrite((e) => syncAcceptances(e, 'player2Accepted'));

exports.updateRating = functions.database.ref('/matches/{matchUid}')
  .onWrite(event => {
    if (event.data.previous.exists() || !event.data.exists())
      return;

    let match = event.data.val();
    return Promise.all([
      admin.database().ref(`/players/${match.player1Uid}`).once('value'),
      admin.database().ref(`/players/${match.player2Uid}`).once('value')
    ]).then((playerRefs)=>{
      let updateRating = (old, exp, score, k) => Math.round(old+k*(score-exp));
      let getExpected = (a, b) => 1/(1+Math.pow(10,((b-a)/400)));;

      let player1Rating = playerRefs[0].val().rating || 1000;
      let player2Rating = playerRefs[1].val().rating || 1000;
      let player1Result = Number(match.player1Score) || 0;
      let player2Result = Number(match.player2Score) || 0;
      let totalResult = player1Result + player2Result;

      let player1ExpectedScore = getExpected(player1Rating, player2Rating) * totalResult;
      let player2ExpectedScore = getExpected(player2Rating, player1Rating) * totalResult;

      let player1NewRating = updateRating(
        player1Rating,
        player1ExpectedScore,
        player1Result,
        totalResult/2
      );
      let player2NewRating = updateRating(
        player2Rating,
        player2ExpectedScore,
        player2Result,
        totalResult/2
      );

      return Promise.all([
        admin.database().ref(`/players/${match.player1Uid}/rating`)
          .set(player1NewRating),
        admin.database().ref(`/players/${match.player2Uid}/rating`)
          .set(player2NewRating)
      ]);
    });
  });
