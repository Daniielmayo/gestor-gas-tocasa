import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  initials?: string;
}

export function useUsersMap() {
  const [usersMap, setUsersMap] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const map: Record<string, UserProfile> = {};
        snap.forEach(doc => {
          const data = doc.data() as UserProfile;
          map[data.uid] = data;
        });
        setUsersMap(map);
      } catch (err) {
        console.error("Error fetching users map:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  return { usersMap, loading };
}
