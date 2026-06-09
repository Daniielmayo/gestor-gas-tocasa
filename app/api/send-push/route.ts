import { NextResponse } from 'next/server';
import { adminDb, adminMessaging } from '@/lib/firebase-admin';

export async function POST(req: Request) {
  try {
    const { userIds, title, message, link, type } = await req.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'Missing userIds' }, { status: 400 });
    }

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
      return NextResponse.json({ 
        error: 'Backend is not configured with Firebase Admin credentials yet.' 
      }, { status: 503 });
    }

    const tokens: string[] = [];

    // Fetch tokens for all target users
    for (const uid of userIds) {
      const userDoc = await adminDb.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        if (data?.fcmTokens && Array.isArray(data.fcmTokens)) {
          tokens.push(...data.fcmTokens);
        }
      }
    }

    if (tokens.length === 0) {
      return NextResponse.json({ success: true, message: 'No registered tokens for users' });
    }

    // Prepare FCM Payload
    const payload = {
      notification: {
        title,
        body: message,
      },
      data: {
        title,
        body: message,
        link: link || '/',
        type: type || 'general'
      },
      tokens: [...new Set(tokens)], // unique tokens
    };

    const response = await adminMessaging.sendEachForMulticast(payload);
    
    // Optionally clean up invalid tokens here if response.responses has errors (like token-not-registered)

    return NextResponse.json({ success: true, responses: response });
  } catch (error: any) {
    console.error("Error sending push notification:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
