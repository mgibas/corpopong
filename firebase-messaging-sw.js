self.importScripts('https://www.gstatic.com/firebasejs/3.9.0/firebase-app.js')
self.importScripts('https://www.gstatic.com/firebasejs/3.9.0/firebase-messaging.js')

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
