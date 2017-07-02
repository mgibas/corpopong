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
exports.createMatch = functions.database.ref('/users/{userUid}/open-matches/{matchUid}')
  .onWrite(event => {
    if (event.auth.admin || event.data.previous.exists() || !event.data.exists())
      return;

    let match = event.data.val();
    if(match.player1Uid === match.player2Uid)
      return;

    match.createdDate = new Date().toISOString();
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
    ]);
  });
exports.rejectMatch = functions.database.ref('/open-match-details/{matchUid}/rejected')
  .onWrite(event => {
    if (event.auth.admin || !event.data.exists() || !event.data.val())
      return;

    return admin.database().ref(`/open-match-details/${event.params.matchUid}`)
      .once('value')
      .then((snap) => {
        let details = snap.val();
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
        ]);
      });
  });
exports.approvalsChanged = functions.database.ref('/open-match-details/{matchUid}/approvals')
  .onWrite((event) => {
    if (event.auth.admin || !event.data.exists() || !event.data.previous.exists())
      return;

    let approvals = event.data.val();
    if(!approvals.player1 || !approvals.player2)
      return;

    return admin.database().ref(`/open-match-details/${event.params.matchUid}`)
      .once('value')
      .then((snap) => {
        let details = snap.val();
        let closingApproval = `${details.scores.player1}|${details.scores.player2}`;
        console.log(details);
        console.log(closingApproval);
        if(closingApproval !== details.approvals.player1 ||
          closingApproval !== details.approvals.player2) {
            return;
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
        ]);
      });
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
      let kFactor = 32;
      let updateRating = (expected, actual, current) => Math.round(current+ kFactor*(actual-expected));
      let getExpected = (a, b) => 1/(1+Math.pow(10,((b-a)/400)));

      let player1Rating = playerRefs[0].val().rating;
      let player2Rating = playerRefs[1].val().rating;
      let player1Score = Number(match.scores.player1);
      let player2Score = Number(match.scores.player2);
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
