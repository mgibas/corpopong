self.importScripts('/bower_components/firebase/firebase-app.js', '/bower_components/firebase/firebase-messaging.js')

self.firebase.initializeApp({
  'messagingSenderId': '414017409980'
})

const messaging = self.firebase.messaging()

messaging.setBackgroundMessageHandler((payload) => {
  let options = Object.assign({
    icon: 'https://corpopong.com/images/icon128.png'
  }, payload.notification)

  return self.registration.showNotification(payload.notification.title, options)
})
