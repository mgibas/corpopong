importScripts('/bower_components/firebase/firebase-app.js')
importScripts('/bower_components/firebase/firebase-messaging.js')

firebase.initializeApp({
  'messagingSenderId': '414017409980'
})

const messaging = firebase.messaging()

messaging.setBackgroundMessageHandler((payload) => {
  let options = Object.assign({
    icon: 'https://corpopong.com/images/icon128.png'
  }, payload.notification)

  return messaging.registration.showNotification(payload.notification.title, options)
})
