'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ArrowLeft, Search, BellRing, AlertTriangle, Bell } from 'lucide-react';
import styles from '../historial/historial.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, or } from 'firebase/firestore';

interface Payment {
  id: string;
  title: string;
  amount: string;
  days: number[];
  ownerId: string;
}

interface Alert {
  id: string;
  message: string;
  daysUntil: number;
}

function getDaysUntil(targetDay: number): number {
  const today = new Date();
  const currentDay = today.getDate();
  if (targetDay === currentDay) return 0;
  if (targetDay > currentDay) return targetDay - currentDay;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return (daysInMonth - currentDay) + targetDay;
}

export default function Notificaciones() {
  const { user, loading } = useAuth();
  const router = useRouter();
  
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const paymentsRef = collection(db, 'recurringPayments');
    const qPayments = query(
      paymentsRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );

    const unsubPayments = onSnapshot(qPayments, (snapshot) => {
      const data: Payment[] = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() } as Payment);
      });

      const newAlerts: Alert[] = [];
      data.forEach(payment => {
        let minDaysUntil = 999;
        payment.days.forEach(day => {
          const diff = getDaysUntil(day);
          if (diff < minDaysUntil) minDaysUntil = diff;
        });

        if (minDaysUntil === 0) {
          newAlerts.push({ id: `alert-${payment.id}-0`, message: `El pago recurrente <strong>${payment.title}</strong> vence <strong>HOY</strong>.`, daysUntil: 0 });
        } else if (minDaysUntil === 1) {
          newAlerts.push({ id: `alert-${payment.id}-1`, message: `El pago recurrente <strong>${payment.title}</strong> vence <strong>MAÑANA</strong>.`, daysUntil: 1 });
        } else if (minDaysUntil === 3) {
          newAlerts.push({ id: `alert-${payment.id}-3`, message: `El pago recurrente <strong>${payment.title}</strong> vence en <strong>3 días</strong>.`, daysUntil: 3 });
        }
      });
      
      newAlerts.sort((a, b) => a.daysUntil - b.daysUntil);
      setAlerts(newAlerts);
      setIsReady(true);
    });

    return () => {
      unsubPayments();
    };
  }, [user]);

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
        <h1 className="text-headline-md">Notificaciones</h1>
        <Button variant="ghost" className={styles.iconBtn}>
          <Search size={24} />
        </Button>
      </header>

      <section className={styles.timeline}>
        {alerts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--color-surface-container-high)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bell size={32} color="var(--color-on-surface-variant)" />
            </div>
            <h2 className="text-headline-sm">Todo en orden</h2>
            <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>No tienes próximos vencimientos a la vista.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {alerts.map(alert => (
              <Card key={alert.id} interactive style={{ 
                background: alert.daysUntil === 0 ? 'var(--color-error-container)' : alert.daysUntil === 1 ? 'var(--color-warning-container)' : 'var(--color-secondary-container)',
                border: `1px solid ${alert.daysUntil === 0 ? 'var(--color-error)' : alert.daysUntil === 1 ? 'var(--color-warning)' : 'var(--color-secondary)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '16px'
              }}>
                {alert.daysUntil === 0 ? (
                  <AlertTriangle size={24} color="var(--color-error)" />
                ) : (
                  <BellRing size={24} color={alert.daysUntil === 1 ? 'var(--color-warning)' : 'var(--color-secondary)'} />
                )}
                <p className="text-body-md" style={{ 
                  color: alert.daysUntil === 0 ? 'var(--color-on-error-container)' : alert.daysUntil === 1 ? 'var(--color-on-warning-container)' : 'var(--color-on-secondary-container)'
                }} dangerouslySetInnerHTML={{ __html: alert.message }} />
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
