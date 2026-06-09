'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ArrowLeft, Search } from 'lucide-react';
import styles from './historial.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, or } from 'firebase/firestore';

interface HistoryLog {
  id: string;
  message: string;
  ownerId: string;
  createdAt: any;
}

export default function Historial() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<HistoryLog[]>([]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const logsRef = collection(db, 'history');
    const q = query(
      logsRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      ),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: HistoryLog[] = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() } as HistoryLog);
      });
      setLogs(data);
    });

    return () => unsubscribe();
  }, [user]);

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando historial..." />
      </main>
    );
  }

  return (
    <main className={`container ${styles.main}`}>
      <header className={styles.appBar}>
        <Link href="/">
          <Button variant="ghost" className={styles.iconBtn}>
            <ArrowLeft size={24} />
          </Button>
        </Link>
        <h1 className="text-headline-md">Historial</h1>
        <Button variant="ghost" className={styles.iconBtn}>
          <Search size={24} />
        </Button>
      </header>

      <section className={styles.timeline}>
        {logs.length === 0 ? (
          <p className="text-body-sm text-center" style={{ color: 'var(--color-on-surface-variant)', marginTop: '16px' }}>No hay actividad reciente.</p>
        ) : (
          logs.map(log => (
            <Card key={log.id} className={styles.historyCard}>
              <p className="text-body-md" style={{ color: 'var(--color-on-surface)' }} dangerouslySetInnerHTML={{ __html: log.message }} />
            </Card>
          ))
        )}
      </section>
    </main>
  );
}


