import { getMessaging, getToken } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { app, db } from './firebase';

export async function requestAndSaveNotificationPermission(userId: string) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.log('This browser does not support desktop notification');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const messaging = getMessaging(app);
      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
      
      if (!vapidKey) {
        console.warn("Falta NEXT_PUBLIC_FIREBASE_VAPID_KEY en .env.local para configurar FCM.");
        return;
      }

      const currentToken = await getToken(messaging, { vapidKey });

      if (currentToken) {
        // Guardar en Firestore
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
          fcmTokens: arrayUnion(currentToken)
        });
        console.log('FCM Token guardado con éxito.');
      } else {
        console.log('No registration token available. Request permission to generate one.');
      }
    } else {
      console.log('Notification permission denied.');
    }
  } catch (err) {
    console.error('An error occurred while retrieving token. ', err);
  }
}

export async function sendPushNotification(userIds: string[], title: string, message: string, link: string = '/', type: string = 'general') {
  try {
    const res = await fetch('/api/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userIds, title, message, link, type })
    });
    const data = await res.json();
    console.log("Push API Response:", data);
  } catch (error) {
    console.error("Error calling push API:", error);
  }
}
