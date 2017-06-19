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
      let creatorUid = event.params.userUid;
      let challengeUid = event.params.challengeUid;
      let challenge = event.data.val();
      if (event.data.previous.exists() || !event.data.exists() ||
        challenge.creatorUid || challenge.playerUid === creatorUid) {
        return;
      }

      challenge.createdDate = new Date();
      challenge.creatorUid = creatorUid;

      return Promise.all([
        admin.database()
          .ref(`/users/${challenge.playerUid}/challenges`)
          .child(challengeUid)
          .set(challenge),
        admin.database()
          .ref(`/users/${creatorUid}/challenges`)
          .child(challengeUid)
          .set(challenge)
      ]);
    });
