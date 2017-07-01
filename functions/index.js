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
      rating: 750
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
  if (event.auth.admin || !event.data.exists())
    return;

  let score = event.data.val();
  if(event.data.previous.exists() && score === event.data.previous.val())
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
          .ref(`/users/${match.player1Uid}/matches/${event.params.matchUid}/player1Accepted`)
          .set(false),
        admin.database()
          .ref(`/users/${match.player1Uid}/matches/${event.params.matchUid}/player2Accepted`)
          .set(false),
        admin.database()
          .ref(`/users/${match.player2Uid}/matches/${event.params.matchUid}/player1Accepted`)
          .set(false),
        admin.database()
          .ref(`/users/${match.player2Uid}/matches/${event.params.matchUid}/player2Accepted`)
          .set(false),
      ]);
    });
}
exports.syncPlayer1Score = functions.database.ref('/users/{userUid}/matches/{matchUid}/player1Score')
  .onWrite((e) => syncScores(e, 'player1Score'));
exports.syncPlayer2Score = functions.database.ref('/users/{userUid}/matches/{matchUid}/player2Score')
  .onWrite((e) => syncScores(e, 'player2Score'));

let syncAcceptances = (event, propertyName) => {
  if (event.auth.admin || !event.data.exists())
    return;

  let accepted = event.data.val();
  if(event.data.previous.exists() && accepted === event.data.previous.val())
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
        match.final ? admin.database().ref(`/users/${match.player1Uid}/matches/${event.params.matchUid}/final`).set(true) : Promise.resolve(),
        match.final ? admin.database().ref(`/users/${match.player2Uid}/matches/${event.params.matchUid}/final`).set(true) : Promise.resolve(),
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
      let kFactor = 32;
      let updateRating = (expected, actual, current) => Math.round(current+ kFactor*(actual-expected));
      let getExpected = (a, b) => 1/(1+Math.pow(10,((b-a)/400)));

      let player1Rating = playerRefs[0].val().rating;
      let player2Rating = playerRefs[1].val().rating;
      let player1Score = Number(match.player1Score);
      let player2Score = Number(match.player2Score);
      let player1Expected = getExpected(player1Rating, player2Rating);
      let player2Expected = getExpected(player2Rating, player1Rating);

      let player1NewRating = updateRating(
        player1Expected,
        player1Score > player2Score ? 1 : player1Score < player2Score ? 0 : 0.5,
        player1Rating
      );
      let player2NewRating = updateRating(
        player2Expected,
        player2Score > player1Score ? 1 : player2Score < player1Score ? 0 : 0.5,
        player2Rating
      );

      return Promise.all([
        admin.database().ref(`/players/${match.player1Uid}/rating`)
          .set(player1NewRating),
        admin.database().ref(`/players/${match.player2Uid}/rating`)
          .set(player2NewRating)
      ]);
    });
  });
