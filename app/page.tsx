'use client';
import React, { useEffect, useState, FormEvent, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
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
import { ScopeFilterBar } from '@/components/ui/ScopeFilterBar';
import { QuickMovementModal } from '@/components/finanzas/QuickMovementModal';
import { HouseholdConfigModal } from '@/components/finanzas/HouseholdConfigModal';
import { requestAndSaveNotificationPermission, sendPushNotification } from '@/lib/pushUtils';
import {
  Plus,
  Receipt,
  Calendar,
  Check,
  TrendingDown,
  TrendingUp,
  Target,
  PiggyBank,
  Scale,
  Users,
  ArrowRight,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import styles from './dashboard.module.css';
import { useAuth } from '@/context/AuthContext';
import { useHousehold } from '@/context/HouseholdContext';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  serverTimestamp,
  or,
  getDocs,
  updateDoc,
  doc,
  increment,
} from 'firebase/firestore';
import { formatCOP } from '@/lib/currency';
import { BudgetDoc, EnhancedTransaction, Scope, SettlementDoc } from '@/lib/models';
import { evaluateBudgetStatus, getPeriodKey, TriggeredBudgetAlert } from '@/lib/budgetEngine';
import { calculatePartnerBalance } from '@/lib/balanceEngine';

function getDaysUntil(targetDay: number): number {
  const today = new Date();
  const currentDay = today.getDate();
  if (targetDay === currentDay) return 0;
  if (targetDay > currentDay) return targetDay - currentDay;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return daysInMonth - currentDay + targetDay;
}

export default function Dashboard() {
  const { user, profile, loading, logout } = useAuth();
  const { household, partner, partnerUid, globalScope } = useHousehold();
  const router = useRouter();

  const [lists, setLists] = useState<any[]>([]);
  const [isLoadingLists, setIsLoadingLists] = useState(true);

  const [upcomingPayments, setUpcomingPayments] = useState<any[]>([]);
  const [recurringPaymentsRaw, setRecurringPaymentsRaw] = useState<any[]>([]);
  const [isLoadingPayment, setIsLoadingPayment] = useState(true);

  const [transactions, setTransactions] = useState<EnhancedTransaction[]>([]);
  const [budgets, setBudgets] = useState<BudgetDoc[]>([]);
  const [settlements, setSettlements] = useState<SettlementDoc[]>([]);
  const [savings, setSavings] = useState<any[]>([]);
  const [isLoadingFinances, setIsLoadingFinances] = useState(true);
  const [paidPaymentIds, setPaidPaymentIds] = useState<Set<string>>(new Set());

  // Modals
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [successModalMessage, setSuccessModalMessage] = useState('');
  const [newListName, setNewListName] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [isCreatingList, setIsCreatingList] = useState(false);

  const [isQuickModalOpen, setIsQuickModalOpen] = useState(false);
  const [quickModalType, setQuickModalType] = useState<'expense' | 'income'>('expense');
  const [isHouseholdConfigOpen, setIsHouseholdConfigOpen] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<TriggeredBudgetAlert[]>([]);

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
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );

    const unsubLists = onSnapshot(qLists, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() }));
      data.sort((a, b) => {
        const timeA = a.updatedAt?.toMillis
          ? a.updatedAt.toMillis()
          : a.createdAt?.toMillis
          ? a.createdAt.toMillis()
          : 0;
        const timeB = b.updatedAt?.toMillis
          ? b.updatedAt.toMillis()
          : b.createdAt?.toMillis
          ? b.createdAt.toMillis()
          : 0;
        return timeB - timeA;
      });
      setLists(data);
      setIsLoadingLists(false);
    });

    // 2. Subscribe to recurring payments
    const paymentsRef = collection(db, 'recurringPayments');
    const qPayments = query(
      paymentsRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );

    const unsubPayments = onSnapshot(qPayments, (snapshot) => {
      const allUpcoming: any[] = [];
      const rawList: any[] = [];
      snapshot.forEach((d) => {
        const p = d.data();
        rawList.push({ id: d.id, ...p });
        (p.days || []).forEach((day: number) => {
          const diff = getDaysUntil(day);
          allUpcoming.push({ id: `${d.id}-${day}`, originalId: d.id, ...p, daysUntil: diff });
        });
      });
      allUpcoming.sort((a, b) => a.daysUntil - b.daysUntil);
      setRecurringPaymentsRaw(rawList);
      setUpcomingPayments(allUpcoming);
      setIsLoadingPayment(false);
    });

    // 3. Subscribe to transactions
    const txRef = collection(db, 'transactions');
    const qTx = query(
      txRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const list: EnhancedTransaction[] = [];
      const paidIds = new Set<string>();
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      snapshot.forEach((d) => {
        const t = d.data() as EnhancedTransaction;
        if (t.deletedAt) return;
        list.push({ ...t, id: d.id });
        if (t.recurringPaymentId && t.createdAt) {
          const date = t.createdAt.toDate ? t.createdAt.toDate() : new Date();
          if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
            paidIds.add(t.recurringPaymentId);
          }
        }
      });

      setTransactions(list);
      setPaidPaymentIds(paidIds);
      setIsLoadingFinances(false);
    });

    // 4. Subscribe to budgets
    const budgetRef = collection(db, 'budgets');
    const qBudget = query(
      budgetRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubBudgets = onSnapshot(qBudget, (snapshot) => {
      const bList: BudgetDoc[] = [];
      snapshot.forEach((d) => bList.push({ id: d.id, ...d.data() } as BudgetDoc));
      setBudgets(bList);
    });

    // 5. Subscribe to settlements
    const settleRef = collection(db, 'settlements');
    const qSettle = query(
      settleRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubSettle = onSnapshot(qSettle, (snapshot) => {
      const sList: SettlementDoc[] = [];
      snapshot.forEach((d) => sList.push({ id: d.id, ...d.data() } as SettlementDoc));
      setSettlements(sList);
    });

    // 6. Subscribe to savings goals
    const savRef = collection(db, 'savings');
    const qSav = query(
      savRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubSav = onSnapshot(qSav, (snapshot) => {
      const svList: any[] = [];
      snapshot.forEach((d) => svList.push({ id: d.id, ...d.data() }));
      setSavings(svList);
    });

    return () => {
      unsubLists();
      unsubPayments();
      unsubTx();
      unsubBudgets();
      unsubSettle();
      unsubSav();
    };
  }, [user]);

  const resolveTxScope = (t: EnhancedTransaction): Scope => {
    if (t.scope === 'personal' || t.scope === 'conjunto') return t.scope;
    return t.sharedWith && t.sharedWith.length > 0 ? 'conjunto' : 'personal';
  };

  // Filtered balances according to Global Scope Selector (Section 7)
  const { currentMonthBalance, prevMonthBalance, currentMonthTxs } = useMemo(() => {
    if (!user) return { currentMonthBalance: 0, prevMonthBalance: 0, currentMonthTxs: [] };
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const prevDate = new Date(currentYear, currentMonth - 1, 1);
    const prevMonth = prevDate.getMonth();
    const prevYear = prevDate.getFullYear();

    let curr = 0;
    let prev = 0;
    const currTxs: EnhancedTransaction[] = [];

    for (const t of transactions) {
      const scope = resolveTxScope(t);
      const payer = t.paidByUserId || t.ownerId;

      if (globalScope === 'mio') {
        if (!(scope === 'personal' && t.ownerId === user.uid) && payer !== user.uid) continue;
      } else if (globalScope === 'conjunto') {
        if (scope !== 'conjunto') continue;
      } else if (globalScope === 'pareja' && partnerUid) {
        if (payer !== partnerUid && t.ownerId !== partnerUid) continue;
      }

      const txDate = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
      const m = txDate.getMonth();
      const y = txDate.getFullYear();
      const signed = t.type === 'income' ? Number(t.amount) : -Number(t.amount);

      if (m === currentMonth && y === currentYear) {
        curr += signed;
        currTxs.push(t);
      } else if (m === prevMonth && y === prevYear) {
        prev += signed;
      }
    }

    return { currentMonthBalance: curr, prevMonthBalance: prev, currentMonthTxs: currTxs };
  }, [transactions, globalScope, user, partnerUid]);

  // Active budget summary for Dashboard (Section 7)
  const activeBudgetStatus = useMemo(() => {
    if (!user || budgets.length === 0) return null;
    const now = new Date();
    const mKey = getPeriodKey(now, 'mensual');
    const qKey = getPeriodKey(now, 'quincenal');
    const docMatch =
      budgets.find((b) => b.periodKey === qKey) ||
      budgets.find((b) => b.periodKey === mKey) ||
      budgets[0];
    return evaluateBudgetStatus(docMatch, transactions, user.uid);
  }, [budgets, transactions, user]);

  // Partner balance summary for Dashboard
  const partnerBalance = useMemo(() => {
    if (!user) return null;
    return calculatePartnerBalance({
      userAId: user.uid,
      userAName: profile?.displayName?.split(' ')[0] || 'Yo',
      userBId: partnerUid || 'partner_pending',
      userBName: partner?.displayName?.split(' ')[0] || 'Pareja',
      transactions: currentMonthTxs,
      settlements,
      splitRule: household?.splitRule || '50_50',
    });
  }, [user, profile, partner, partnerUid, currentMonthTxs, settlements, household?.splitRule]);

  const handlePayUpcoming = async (payment: any) => {
    if (!user || !profile) return;
    try {
      const originalId = payment.originalId || payment.id.split('-')[0];
      const isExpectedIncome = payment.flowType === 'income';
      await addDoc(collection(db, 'transactions'), {
        type: isExpectedIncome ? 'income' : 'expense',
        amount: Number(payment.amount),
        category: payment.category || (isExpectedIncome ? 'Sueldo / Quincena' : 'Servicios'),
        title: payment.title,
        place: payment.title,
        description: payment.description || payment.title,
        scope: payment.scope || 'conjunto',
        paidByUserId: user.uid,
        paidByName: profile.displayName?.split(' ')[0] || 'Yo',
        recurringPaymentId: originalId,
        recurringPaymentTitle: payment.title,
        ownerId: user.uid,
        ownerName: profile.displayName?.split(' ')[0] || 'Yo',
        sharedWith: payment.sharedWith || (partnerUid ? [partnerUid] : []),
        deletedAt: null,
        createdAt: serverTimestamp(),
      });

      // Check if there's a debt linked to this recurring payment
      const debtsRef = collection(db, 'debts');
      const qDebts = query(debtsRef, where('linkedRecurringPaymentId', '==', originalId));
      const debtSnap = await getDocs(qDebts);

      if (!debtSnap.empty) {
        const updatePromises = debtSnap.docs.map((debtDoc) =>
          updateDoc(doc(db, 'debts', debtDoc.id), {
            currentAmount: increment(Number(payment.amount)),
          })
        );
        await Promise.all(updatePromises);
        setSuccessModalMessage(
          'Pago registrado con éxito y deducido automáticamente de tu deuda ligada.'
        );
      } else {
        setSuccessModalMessage(
          isExpectedIncome
            ? 'Ingreso recurrente confirmado con éxito.'
            : 'Pago registrado con éxito como gasto del hogar.'
        );
      }

      setIsSuccessModalOpen(true);
    } catch (error) {
      console.error(error);
      alert('Hubo un error al registrar el movimiento');
    }
  };

  const handleCreateList = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !profile || !newListName.trim()) return;
    setIsCreatingList(true);

    try {
      let sharedWithUids: string[] = partnerUid ? [partnerUid] : [];

      if (shareEmail.trim()) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', shareEmail.trim().toLowerCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const friendUid = snap.docs[0].data().uid;
          if (friendUid !== user.uid) {
            sharedWithUids = Array.from(new Set([...sharedWithUids, friendUid]));
          }
        }
      }

      const docRef = await addDoc(collection(db, 'lists'), {
        title: newListName.trim(),
        ownerId: user.uid,
        sharedWith: sharedWithUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (sharedWithUids.length > 0) {
        await sendPushNotification(
          sharedWithUids,
          'Nueva Lista Compartida',
          `${profile.displayName || 'Alguien'} ha compartido la lista "${newListName}" contigo.`,
          `/lista/${docRef.id}`,
          'list_shared'
        );
      }

      setNewListName('');
      setShareEmail('');
      setIsListModalOpen(false);
      router.push(`/lista/${docRef.id}`);
    } catch (error: any) {
      console.error('Error creating list:', error);
      alert(`Hubo un error al crear la lista: ${error.message || error}`);
    } finally {
      setIsCreatingList(false);
    }
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
  const totalSavingsTarget = savings.reduce((s, g) => s + Number(g.targetAmount || 0), 0);
  const totalSavingsCurrent = savings.reduce((s, g) => s + Number(g.currentAmount || 0), 0);
  const savingsPct =
    totalSavingsTarget > 0 ? Math.min(100, Math.round((totalSavingsCurrent / totalSavingsTarget) * 100)) : 0;

  return (
    <main className={`container ${styles.main}`}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className="text-headline-md">
            Hola, {profile?.displayName?.split(' ')[0] || 'Usuario'}
          </h1>
          <p
            className="text-body-md"
            style={{
              color: 'var(--color-on-surface-variant)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{household?.name || 'Nuestro Hogar'}</span>
            {partner ? (
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  backgroundColor: 'var(--color-primary-container)',
                  color: 'var(--color-primary-dark)',
                  fontWeight: 600,
                }}
              >
                Con {partner.displayName?.split(' ')[0] || 'Pareja'}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setIsHouseholdConfigOpen(true)}
                style={{
                  fontSize: '11px',
                  color: 'var(--color-primary)',
                  fontWeight: 600,
                  textDecoration: 'underline',
                }}
              >
                + Vincular pareja
              </button>
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            onClick={() => setIsHouseholdConfigOpen(true)}
            style={{ padding: '6px', minWidth: 'auto', height: 'auto' }}
            title="Configuraciones (Tarjetas, Categorías, Comercios, Ingresos)"
          >
            <Settings size={20} color="var(--color-on-surface-variant)" />
          </Button>
          <NotificationBell />
          <div onClick={() => setIsProfileModalOpen(true)} style={{ cursor: 'pointer' }}>
            <Avatar
              initials={profile?.initials || 'US'}
              src={profile?.photoURL || undefined}
              size="sm"
            />
          </div>
        </div>
      </header>

      {/* Global Scope Selector visible on Dashboard (Section 7) */}
      <div style={{ marginBottom: '14px' }}>
        <ScopeFilterBar />
      </div>

      {/* Triggered Budget Alerts Banner (RF-08) */}
      {recentAlerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          {recentAlerts.map((al) => (
            <div
              key={al.alertKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: '12px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid var(--color-error)',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={16} color="var(--color-error)" />
                <span>
                  <strong>{al.title}:</strong> {al.message}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRecentAlerts((p) => p.filter((x) => x.alertKey !== al.alertKey))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Balance Card + One-Tap Quick Expense CTA */}
      <Card className={styles.balanceCard}>
        {isLoadingFinances ? (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <Spinner fullScreen={false} message="Calculando finanzas..." />
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 0',
            }}
          >
            <span
              className="text-label-md"
              style={{ color: 'var(--color-primary-container)', opacity: 0.9 }}
            >
              Balance del Mes ({globalScope.toUpperCase()})
            </span>
            <h2 className="text-display-lg" style={{ color: '#FFF' }}>
              {formatCOP(currentMonthBalance)}
            </h2>
            <div
              style={{
                background: 'rgba(255,255,255,0.12)',
                padding: '4px 12px',
                borderRadius: '16px',
              }}
            >
              <span className="text-label-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
                Mes anterior: {formatCOP(prevMonthBalance)}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', width: '100%' }}>
              <button
                type="button"
                onClick={() => {
                  setQuickModalType('expense');
                  setIsQuickModalOpen(true);
                }}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '12px',
                  backgroundColor: '#FFFFFF',
                  color: 'var(--color-primary-dark)',
                  fontWeight: 700,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <Plus size={16} /> Registrar Gasto
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuickModalType('income');
                  setIsQuickModalOpen(true);
                }}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <TrendingUp size={16} /> + Ingreso
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Dashboard Widgets: Budget Progress + Partner Balance + Savings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
        {/* Budget Summary Widget (RF-07 / RF-08) */}
        <Link href="/finanzas" style={{ textDecoration: 'none' }}>
          <Card style={{ padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Target size={18} color="var(--color-primary)" />
                <span style={{ fontWeight: 700, fontSize: '14px' }}>Presupuesto del Periodo</span>
              </div>
              <ArrowRight size={16} color="var(--color-on-surface-variant)" />
            </div>

            {activeBudgetStatus ? (
              <div style={{ marginTop: '10px' }}>
                <div
                  style={{
                    width: '100%',
                    height: '8px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--color-surface-container)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, activeBudgetStatus.totalPercentage)}%`,
                      height: '100%',
                      backgroundColor:
                        activeBudgetStatus.statusColor === 'red'
                          ? 'var(--color-error)'
                          : activeBudgetStatus.statusColor === 'yellow'
                          ? 'var(--color-warning)'
                          : 'var(--color-success)',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    marginTop: '6px',
                    color: 'var(--color-on-surface-variant)',
                  }}
                >
                  <span>
                    Gastado: <strong>{formatCOP(activeBudgetStatus.totalSpent)}</strong> de{' '}
                    {formatCOP(activeBudgetStatus.totalBudgeted)}
                  </span>
                  <span style={{ fontWeight: 700 }}>{activeBudgetStatus.totalPercentage}%</span>
                </div>
                {activeBudgetStatus.totalExceededBy > 0 && (
                  <div
                    style={{
                      marginTop: '4px',
                      fontSize: '11px',
                      color: 'var(--color-error)',
                      fontWeight: 600,
                    }}
                  >
                    Excedido por {formatCOP(activeBudgetStatus.totalExceededBy)}
                  </div>
                )}
              </div>
            ) : (
              <p
                className="text-body-sm"
                style={{ color: 'var(--color-on-surface-variant)', marginTop: '6px' }}
              >
                Toca aquí para configurar tu presupuesto mensual o quincenal.
              </p>
            )}
          </Card>
        </Link>

        {/* Partner Balance & Savings Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Link href="/finanzas" style={{ textDecoration: 'none' }}>
            <Card style={{ padding: '14px', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Scale size={16} color="var(--color-primary)" />
                <span style={{ fontWeight: 700, fontSize: '13px' }}>Cuentas Pareja</span>
              </div>
              {partnerBalance && partnerBalance.netAmountOwed > 0 ? (
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                    {partnerBalance.debtorName} debe a {partnerBalance.creditorName}
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 800,
                      color: 'var(--color-primary-dark)',
                      marginTop: '2px',
                    }}
                  >
                    {formatCOP(partnerBalance.netAmountOwed)}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--color-success)', fontWeight: 600 }}>
                  Al día (Paz y salvo)
                </div>
              )}
            </Card>
          </Link>

          <Link href="/finanzas/metas" style={{ textDecoration: 'none' }}>
            <Card style={{ padding: '14px', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <PiggyBank size={16} color="var(--color-success)" />
                <span style={{ fontWeight: 700, fontSize: '13px' }}>Metas ({savingsPct}%)</span>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-success)' }}>
                {formatCOP(totalSavingsCurrent)}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                Meta: {formatCOP(totalSavingsTarget)}
              </div>
            </Card>
          </Link>
        </div>
      </div>

      {/* Próximos Pagos e Ingresos Fijos Carousel */}
      {topPayments.length > 0 && (
        <section className={styles.section} style={{ marginTop: '24px' }}>
          <div
            className={styles.sectionHeader}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <h3
              className="text-headline-sm"
              style={{
                textTransform: 'uppercase',
                fontSize: '12px',
                letterSpacing: '1px',
                color: 'var(--color-on-surface-variant)',
              }}
            >
              PRÓXIMOS VENCIMIENTOS Y QUINCENAS
            </h3>
            <Link href="/pagos/recurrentes">
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--color-primary)',
                  cursor: 'pointer',
                }}
              >
                Ver todos
              </span>
            </Link>
          </div>

          <div className={styles.carouselContainer}>
            {topPayments.map((payment, i) => {
              const originalId = payment.originalId || payment.id.split('-')[0];
              const isPaid = paidPaymentIds.has(originalId);
              return (
                <UpcomingPaymentCard
                  key={payment.id || i}
                  payment={payment}
                  onPay={handlePayUpcoming}
                  isPaid={isPaid}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Shared Lists */}
      <section className={styles.section}>
        <div
          className={styles.sectionHeader}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <h3 className="text-headline-sm">Listas del Hogar</h3>
          <Link href="/listas">
            <Button variant="ghost" size="sm" style={{ color: 'var(--color-primary)' }}>
              Ver todas
            </Button>
          </Link>
        </div>

        <div className={styles.listContainer}>
          {isLoadingLists ? (
            <div style={{ padding: '20px 0' }}>
              <Spinner message="Cargando listas..." fullScreen={false} />
            </div>
          ) : lists.length === 0 ? (
            <Card
              style={{
                textAlign: 'center',
                padding: '28px 16px',
                background: 'var(--color-surface-container-low)',
              }}
            >
              <h4 className="text-headline-sm" style={{ marginBottom: '8px' }}>
                Ninguna lista aún
              </h4>
              <p
                className="text-body-sm"
                style={{ color: 'var(--color-on-surface-variant)', marginBottom: '16px' }}
              >
                Organiza las compras del mercado o pendientes en pareja.
              </p>
              <Button
                onClick={() => setIsListModalOpen(true)}
                variant="primary"
                style={{ margin: '0 auto' }}
              >
                Crear primera lista
              </Button>
            </Card>
          ) : (
            topLists.map((list) => (
              <Link key={list.id} href={`/lista/${list.id}`} style={{ textDecoration: 'none' }}>
                <ListSummaryCard list={list} styles={styles} />
              </Link>
            ))
          )}
        </div>
      </section>

      {/* SpeedDial with Direct Expense Modal (Section 7) */}
      <SpeedDial
        actions={[
          {
            name: 'Registrar Gasto',
            icon: <TrendingDown size={20} />,
            color: '#EF4444',
            onClick: () => {
              setQuickModalType('expense');
              setIsQuickModalOpen(true);
            },
          },
          {
            name: 'Registrar Ingreso',
            icon: <TrendingUp size={20} />,
            color: '#10B981',
            onClick: () => {
              setQuickModalType('income');
              setIsQuickModalOpen(true);
            },
          },
          {
            name: 'Nueva Lista',
            icon: <Receipt size={20} />,
            color: '#3B82F6',
            onClick: () => setIsListModalOpen(true),
          },
        ]}
      />

      {/* Quick Movement Modal */}
      <QuickMovementModal
        isOpen={isQuickModalOpen}
        onClose={() => setIsQuickModalOpen(false)}
        initialType={quickModalType}
        knownTransactions={transactions}
        recurringPayments={recurringPaymentsRaw}
        activeBudgets={budgets}
        onAlertsTriggered={(alerts) => setRecentAlerts(alerts)}
      />

      {/* Household Configuration Modal */}
      <HouseholdConfigModal
        isOpen={isHouseholdConfigOpen}
        onClose={() => setIsHouseholdConfigOpen(false)}
        initialTab="hogar"
      />

      {/* Create List Modal */}
      <Modal
        isOpen={isListModalOpen}
        onClose={() => !isCreatingList && setIsListModalOpen(false)}
        title="Nueva Lista"
      >
        <form onSubmit={handleCreateList}>
          <div style={{ marginBottom: '20px', marginTop: '12px' }}>
            <Input
              label="Nombre de la Lista"
              placeholder="Ej. Supermercado, Dolarcity, Viaje..."
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <UserEmailAutocomplete value={shareEmail} onChange={setShareEmail} />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              onClick={() => setIsListModalOpen(false)}
              disabled={isCreatingList}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={!newListName.trim() || isCreatingList}
            >
              {isCreatingList ? 'Creando...' : 'Crear Lista'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Profile Modal */}
      <Modal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        title="Tu Perfil y Hogar"
      >
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <Avatar
            src={profile?.photoURL || undefined}
            initials={profile?.initials || 'US'}
            size="lg"
            style={{ margin: '0 auto 12px' }}
          />
          <h3 className="text-body-lg" style={{ fontWeight: 600 }}>
            {profile?.displayName}
          </h3>
          <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            {profile?.email}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              setIsProfileModalOpen(false);
              setIsHouseholdConfigOpen(true);
            }}
          >
            Configurar Hogar, Pareja y Tarjetas
          </Button>
          <Button
            variant="danger"
            fullWidth
            onClick={async () => {
              setIsProfileModalOpen(false);
              await logout();
              router.push('/login');
            }}
          >
            Cerrar Sesión
          </Button>
        </div>
      </Modal>

      {/* Success Modal */}
      <Modal
        isOpen={isSuccessModalOpen}
        onClose={() => setIsSuccessModalOpen(false)}
        title="Éxito"
      >
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'var(--color-success)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Check size={32} />
          </div>
          <h3 className="text-headline-sm" style={{ marginBottom: '8px' }}>
            ¡Operación exitosa!
          </h3>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            {successModalMessage}
          </p>
          <Button
            variant="primary"
            fullWidth
            onClick={() => setIsSuccessModalOpen(false)}
            style={{ marginTop: '24px' }}
          >
            Aceptar
          </Button>
        </div>
      </Modal>
    </main>
  );
}
