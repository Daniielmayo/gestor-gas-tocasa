import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function logActivity(
  message: string,
  ownerId: string,
  sharedWith: string[] = []
) {
  try {
    await addDoc(collection(db, 'history'), {
      message,
      ownerId,
      sharedWith,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}
