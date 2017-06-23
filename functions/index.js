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

exports.syncScores = functions.database.ref('/users/{userUid}/matches/{matchUid}')
  .onWrite(event => {
    if (event.auth.admin || !event.data.previous.exists() || !event.data.exists())
      return;

    let match = event.data.val();
    let previousMatch = event.data.previous.val();

    if(match.final)
      return;
    if(match.player1Score === previousMatch.player1Score &&
      match.player2Score === previousMatch.player2Score)
      return;

    match.player1Accepted = match.player2Accepted = false;
    return Promise.all([
      admin.database()
        .ref(`/users/${match.player1Uid}/matches`)
        .child(event.params.matchUid)
        .set(match),
      admin.database()
        .ref(`/users/${match.player2Uid}/matches`)
        .child(event.params.matchUid)
        .set(match)]);
  });

exports.syncAcceptances = functions.database.ref('/users/{userUid}/matches/{matchUid}')
  .onWrite(event => {
    if (event.auth.admin || !event.data.previous.exists() || !event.data.exists())
      return;

    let match = event.data.val();
    let previousMatch = event.data.previous.val();

    if(match.final)
      return
    if(match.player1Accepted === previousMatch.player1Accepted &&
      match.player2Accepted === previousMatch.player2Accepted)
      return;

    if(match.player1Accepted && match.player2Accepted)
    {
      match.final = true;
      match.finalizedDate = new Date().toISOString();
      delete match.player1Accepted;
      delete match.player2Accepted;
    }

    return Promise.all([
      match.final ? admin.database().ref(`/matches/${event.params.matchUid}`).set(match) : Promise.resolve(),
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
      let player1Result = Number(match.player1Score) > Number(match.player2Score) ? 1 : 0;
      let player2Result = Number(match.player2Score) > Number(match.player1Score) ? 1 : 0;
      let player1ExpectedScore = elo.getExpected(player1Rating, player2Rating);
      let player2ExpectedScore = elo.getExpected(player2Rating, player1Rating);

      let player1NewRating = elo.updateRating(
        player1ExpectedScore,
        player1Result,
        player1Rating
      );
      let player2NewRating = elo.updateRating(
        player2ExpectedScore,
        player2Result,
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
