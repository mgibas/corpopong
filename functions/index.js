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
      photoURL: event.data.photoURL
    })
});

exports.createChallenge = functions.database.ref('/users/{userUid}/challenges/{challengeUid}')
    .onWrite(event => {
      let challenge = event.data.val();
      if (event.data.previous.exists() || !event.data.exists() ||
        challenge.createdDate || challenge.player1Uid === challenge.player2Uid) {
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
      if (!event.data.previous.exists() || !event.data.exists())
        return;
        
      let challenge = event.data.val();
      let previousChallenge = event.data.previous.val();

      if(challenge.player1Score === previousChallenge.player1Score &&
        challenge.player2Score === previousChallenge.player2Score)
        return;

      return admin.database()
          .ref('/users')
          .child(event.params.userUid === challenge.player1Uid ? challenge.player2Uid : challenge.player1Uid)
          .child(`/challenges/${event.params.challengeUid}`)
          .set(challenge);
    });
