'use client';
import React, { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { FAB } from '@/components/ui/FAB';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ListSummaryCard } from '@/components/ui/ListSummaryCard';
import { UpcomingPaymentCard } from '@/components/ui/UpcomingPaymentCard';
import { SpeedDial } from '@/components/ui/SpeedDial';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { UserEmailAutocomplete } from '@/components/ui/UserEmailAutocomplete';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import { requestAndSaveNotificationPermission, sendPushNotification } from '@/lib/pushUtils';
import { Plus, Receipt, Calendar, Check } from 'lucide-react';
import styles from './dashboard.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, limit, addDoc, serverTimestamp, or, getDocs, Timestamp } from 'firebase/firestore';
import { formatCOP } from '@/lib/currency';

interface Transaction {
  id: string;
  type: 'ingreso' | 'egreso';
  amount: number;
  category: string;
  date: any;
  title?: string;
}

interface Payment {
  id: string;
  title: string;
  amount: number;
  dueDate: any;
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

export default function Dashboard() {
  const { user, profile, loading, logout } = useAuth();
  const router = useRouter();

  const [lists, setLists] = useState<any[]>([]);
  const [isLoadingLists, setIsLoadingLists] = useState(true);

  const [upcomingPayments, setUpcomingPayments] = useState<any[]>([]);
  const [isLoadingPayment, setIsLoadingPayment] = useState(true);

  const [currentMonthBalance, setCurrentMonthBalance] = useState(0);
  const [prevMonthBalance, setPrevMonthBalance] = useState(0);
  const [isLoadingFinances, setIsLoadingFinances] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [successModalMessage, setSuccessModalMessage] = useState('');
  const [newListName, setNewListName] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [paidPaymentIds, setPaidPaymentIds] = useState<Set<string>>(new Set());

  const actions = [
    { icon: <Receipt size={20} />, label: 'Nuevo Pago', onClick: () => router.push('/pagos/nuevo') },
    { icon: <Plus size={20} />, label: 'Nueva Lista', onClick: () => setIsModalOpen(true) },
  ];

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      requestAndSaveNotificationPermission(user.uid);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // 1. Subscribe to lists
    const listsRef = collection(db, 'lists');
    const qLists = query(
      listsRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );

    const unsubLists = onSnapshot(qLists, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });
      // Client-side sort by updatedAt fallback to createdAt
      data.sort((a, b) => {
        const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
        const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
        return timeB - timeA; // Descending
      });

      setLists(data);
      setIsLoadingLists(false);
    });

    // 2. Subscribe to recurring payments to find the next ones
    const paymentsRef = collection(db, 'recurringPayments');
    const qPayments = query(
      paymentsRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );

    const unsubPayments = onSnapshot(qPayments, (snapshot) => {
      const allUpcoming: any[] = [];
      snapshot.forEach((doc) => {
        const p = doc.data();
        p.days.forEach((day: number) => {
          const diff = getDaysUntil(day);
          allUpcoming.push({ id: `${doc.id}-${day}`, ...p, daysUntil: diff });
        });
      });
      // Sort by soonest
      allUpcoming.sort((a, b) => a.daysUntil - b.daysUntil);

      setUpcomingPayments(allUpcoming);
      setIsLoadingPayment(false);
    });

    // 3. Subscribe to transactions for balances
    const txRef = collection(db, 'transactions');
    const qTx = query(
      txRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      let currBalance = 0;
      let prevBalance = 0;
      const paidIds = new Set<string>();
      
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      
      const prevDate = new Date(currentYear, currentMonth - 1, 1);
      const prevMonth = prevDate.getMonth();
      const prevYear = prevDate.getFullYear();

      snapshot.forEach(doc => {
        const t = doc.data();
        const txDate = t.createdAt ? t.createdAt.toDate() : new Date();
        const m = txDate.getMonth();
        const y = txDate.getFullYear();
        
        if (m === currentMonth && y === currentYear) {
          currBalance += (t.type === 'income' ? t.amount : -t.amount);
        } else if (m === prevMonth && y === prevYear) {
          prevBalance += (t.type === 'income' ? t.amount : -t.amount);
        }

        if (t.recurringPaymentId && t.createdAt) {
          const date = t.createdAt.toDate();
          if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
            paidIds.add(t.recurringPaymentId);
          }
        }
      });
      
      setCurrentMonthBalance(currBalance);
      setPrevMonthBalance(prevBalance);
      setPaidPaymentIds(paidIds);
      setIsLoadingFinances(false);
    });

    return () => {
      unsubLists();
      unsubPayments();
      unsubTx();
    };
  }, [user]);

  const handlePayUpcoming = async (payment: any) => {
    if (!user || !profile) return;
    try {
      const originalId = payment.originalId || payment.id.split('-')[0];
      await addDoc(collection(db, 'transactions'), {
        type: 'expense',
        amount: Number(payment.amount),
        category: payment.category || 'Otros',
        title: payment.title,
        recurringPaymentId: originalId,
        ownerId: user.uid,
        sharedWith: payment.sharedWith || [],
        createdAt: serverTimestamp()
      });

      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> pagó la obligación '${payment.title}' por ${formatCOP(Number(payment.amount))}`, user.uid, payment.sharedWith || []);
      });

      setSuccessModalMessage('Pago registrado con éxito como egreso.');
      setIsSuccessModalOpen(true);
    } catch (error) {
      console.error(error);
      alert('Hubo un error al registrar el pago');
    }
  };

  const handleCreateList = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !profile) return;
    if (!newListName || newListName.trim() === '') return;

    setIsCreatingList(true);

    try {
      let sharedWithUids: string[] = [];
      
      if (shareEmail.trim()) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', shareEmail.trim().toLowerCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const friendUid = snap.docs[0].data().uid;
          if (friendUid !== user.uid) {
            sharedWithUids = [friendUid];
          }
        } else {
          alert("El correo a compartir no está registrado. La lista se creará sin compartir.");
        }
      }

      const docRef = await addDoc(collection(db, 'lists'), {
        title: newListName.trim(),
        ownerId: user.uid,
        sharedWith: sharedWithUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      if (sharedWithUids.length > 0) {
        await sendPushNotification(
          sharedWithUids, 
          'Nueva Lista Compartida', 
          `${profile.displayName || 'Alguien'} ha compartido la lista "${newListName}" contigo.`,
          `/lista/${docRef.id}`,
          'list_shared'
        );
        await addDoc(collection(db, 'notifications'), {
          userId: sharedWithUids[0],
          title: 'Nueva Lista Compartida',
          message: `${profile.displayName || 'Alguien'} ha compartido la lista "${newListName}" contigo.`,
          type: 'list_shared',
          read: false,
          link: `/lista/${docRef.id}`,
          createdAt: serverTimestamp()
        });
      }

      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> creó la lista compartida '${newListName.trim()}'`, user.uid, []);
      });

      setNewListName('');
      setShareEmail('');
      setIsModalOpen(false);
      router.push(`/lista/${docRef.id}`);
    } catch (error: any) {
      console.error("Error creating list:", error);
      alert(`Hubo un error al crear la lista: ${error.message || error}`);
      setIsCreatingList(false);
    }
  };

  const openModal = () => {
    setNewListName('');
    setIsModalOpen(true);
  };

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando tu hogar..." />
      </main>
    );
  }

  const topLists = lists.slice(0, 3);
  const topPayments = upcomingPayments.slice(0, 3);

  return (
    <main className={`container ${styles.main}`}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className="text-headline-md">Hola, {profile?.displayName?.split(' ')[0] || 'Usuario'}</h1>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            Resumen de tu hogar
          </p>
        </div>
        <div className={styles.headerActions}>
          <NotificationBell />
          <div onClick={() => setIsProfileModalOpen(true)} style={{ cursor: 'pointer' }}>
            <Avatar initials={profile?.initials || 'US'} src={profile?.photoURL || undefined} size="sm" />
          </div>
        </div>
      </header>

      {/* Balance/Pending Card */}
      <Card className={styles.balanceCard}>
        {isLoadingFinances ? (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <Spinner fullScreen={false} message="Calculando finanzas..." />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px 0' }}>
            <span className="text-label-md" style={{ color: 'var(--color-primary-container)', opacity: 0.9 }}>
              Balance Actual
            </span>
            <h2 className="text-display-lg" style={{ color: '#FFF' }}>
              {formatCOP(currentMonthBalance)}
            </h2>
            <div style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 12px', borderRadius: '16px', marginTop: '8px' }}>
              <span className="text-label-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Mes anterior: {formatCOP(prevMonthBalance)}
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Quick Actions */}
      {/* <div className={styles.quickActions}>
        <Link href="/pagos/recurrentes" className={styles.actionItem}>
          <div className={styles.actionIcon}>
            <CreditCard size={24} color="var(--color-primary)" />
          </div>
          <span className="text-label-sm">Recurrentes</span>
        </Link>
        <Link href="/historial" className={styles.actionItem}>
          <div className={styles.actionIcon}>
            <Receipt size={24} color="var(--color-primary)" />
          </div>
          <span className="text-label-sm">Historial</span>
        </Link>
        <div className={styles.actionItem} onClick={() => setIsProfileModalOpen(true)} style={{ cursor: 'pointer' }}>
          <div className={styles.actionIcon}>
            <Settings size={24} color="var(--color-primary)" />
          </div>
          <span className="text-label-sm">Ajustes</span>
        </div>
      </div> */}

      {/* Próximos Pagos Carousel */}
      {topPayments.length > 0 && (
        <section className={styles.section} style={{ marginTop: '24px' }}>
          <div className={styles.sectionHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="text-headline-sm" style={{ textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', color: 'var(--color-on-surface-variant)' }}>PRÓXIMOS PAGOS</h3>
            <Link href="/pagos/recurrentes">
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}>Ver todos</span>
            </Link>
          </div>

          <div className={styles.carouselContainer}>
            {topPayments.map((payment, i) => {
              const originalId = payment.originalId || payment.id.split('-')[0];
              const isPaid = paidPaymentIds.has(originalId);
              return (
                <UpcomingPaymentCard key={payment.id || i} payment={payment} onPay={handlePayUpcoming} isPaid={isPaid} />
              )
            })}
          </div>
        </section>
      )}

      {/* Shared Lists */}
      <section className={styles.section}>
        <div className={styles.sectionHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="text-headline-sm">Actividad Reciente</h3>
          {lists.length > 3 && (
            <Link href="/listas">
              <Button variant="ghost" size="sm" style={{ color: 'var(--color-primary)' }}>
                Ver todas
              </Button>
            </Link>
          )}
        </div>

        <div className={styles.listContainer}>
          {isLoadingLists ? (
            <div style={{ padding: '20px 0' }}><Spinner message="Cargando listas..." fullScreen={false} /></div>
          ) : lists.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '32px 16px', background: 'var(--color-surface-container-low)' }}>
              <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-primary-container)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Plus color="var(--color-primary)" size={24} />
                </div>
              </div>
              <h4 className="text-headline-sm" style={{ marginBottom: '8px' }}>Ninguna lista aún</h4>
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '24px' }}>
                Empieza a organizarte creando tu primera lista compartida.
              </p>
              <Button onClick={() => openModal()} variant="primary" style={{ margin: '0 auto' }}>
                Crear mi primera lista
              </Button>
            </Card>
          ) : (
            topLists.map(list => (
              <Link key={list.id} href={`/lista/${list.id}`} style={{ textDecoration: 'none' }}>
                <ListSummaryCard list={list} styles={styles} />
              </Link>
            ))
          )}
        </div>
      </section>

      {/* SpeedDial to Add New List/Payment */}
      <SpeedDial actions={[
        {
          name: 'Programar Pago',
          icon: <Calendar size={20} />,
          color: '#D97706', // Orange
          onClick: () => router.push('/pagos/recurrentes')
        },
        {
          name: 'Nueva Lista',
          icon: <Receipt size={20} />,
          color: '#3B82F6', // Blue
          onClick: openModal
        }
      ]} />

      {/* Create List Modal */}
      <Modal isOpen={isModalOpen} onClose={() => !isCreatingList && setIsModalOpen(false)} title="Nueva Lista">
        <form onSubmit={handleCreateList}>
          <div style={{ marginBottom: '24px', marginTop: '16px' }}>
            <Input
              label="Nombre de la Lista"
              placeholder="Ej. Supermercado, Viaje, etc."
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <UserEmailAutocomplete value={shareEmail} onChange={setShareEmail} />
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '8px' }}>
              Opcional: Comparte esta lista inmediatamente.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button type="button" variant="ghost" fullWidth onClick={() => setIsModalOpen(false)} disabled={isCreatingList}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={!newListName.trim() || isCreatingList}>
              {isCreatingList ? 'Creando...' : 'Crear Lista'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Profile Modal */}
      <Modal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} title="Tu Perfil">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <Avatar
            src={profile?.photoURL || undefined}
            initials={profile?.initials || 'US'}
            size="lg"
            style={{ margin: '0 auto 16px' }}
          />
          <h3 className="text-body-lg" style={{ fontWeight: 600 }}>{profile?.displayName}</h3>
          <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>{profile?.email}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Button variant="danger" fullWidth onClick={async () => {
            setIsProfileModalOpen(false);
            await logout();
            router.push('/login');
          }}>
            Cerrar Sesión
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setIsProfileModalOpen(false)}>
            Cerrar
          </Button>
        </div>
      </Modal>

      {/* Success Modal */}
      <Modal isOpen={isSuccessModalOpen} onClose={() => setIsSuccessModalOpen(false)} title="Éxito">
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--color-success)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Check size={32} />
          </div>
          <h3 className="text-headline-sm" style={{ marginBottom: '8px' }}>¡Operación exitosa!</h3>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>{successModalMessage}</p>
          <Button variant="primary" fullWidth onClick={() => setIsSuccessModalOpen(false)} style={{ marginTop: '24px' }}>
            Aceptar
          </Button>
        </div>
      </Modal>
    </main>
  );
}

