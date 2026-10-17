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
import { useHousehold } from '@/context/HouseholdContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, or } from 'firebase/firestore';

interface HistoryLog {
  id: string;
  message: string;
  ownerId: string;
  createdAt: any;
}

// Removed Alerts and Payments interfaces and getDaysUntil as they moved to Notificaciones

export default function Historial() {
  const { user, loading } = useAuth();
  const { household, partnerUid } = useHousehold();
  const router = useRouter();
  
  const [logs, setLogs] = useState<HistoryLog[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    // 1. Suscribirse al Historial
    const logsRef = collection(db, 'history');
    const clauses: any[] = [
      where('ownerId', '==', user.uid),
      where('sharedWith', 'array-contains', user.uid),
    ];
    if (partnerUid) {
      clauses.push(where('ownerId', '==', partnerUid));
    }
    if (household?.id) {
      clauses.push(where('householdId', '==', household.id));
    }
    const qLogs = query(logsRef, or(...clauses));

    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      const data: HistoryLog[] = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() } as HistoryLog);
      });
      data.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      });
      setLogs(data);
      setIsReady(true);
    });

    return () => {
      unsubLogs();
    };
  }, [user, partnerUid, household?.id]);

  if (loading || !user || !isReady) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando notificaciones..." />
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
        <h1 className="text-headline-md">Historial de Actividad</h1>
        <Button variant="ghost" className={styles.iconBtn}>
          <Search size={24} />
        </Button>
      </header>

      <section className={styles.timeline}>
        
        {/* Normal History */}
        <div>
          <h2 className="text-label-md" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '12px', paddingLeft: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>Actividad Reciente</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {logs.length === 0 ? (
              <p className="text-body-sm text-center" style={{ color: 'var(--color-on-surface-variant)', marginTop: '16px' }}>No hay actividad reciente.</p>
            ) : (
              logs.map(log => (
                <Card key={log.id} className={styles.historyCard}>
                  <p className="text-body-md" style={{ color: 'var(--color-on-surface)' }} dangerouslySetInnerHTML={{ __html: log.message }} />
                  {log.createdAt && (
                    <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '8px' }}>
                      {new Date(log.createdAt.toDate()).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </Card>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}


