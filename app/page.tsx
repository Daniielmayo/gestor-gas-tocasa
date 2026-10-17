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
  CreditCard,
  PieChart,
  Tag,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import styles from './dashboard.module.css';
import { useAuth } from '@/context/AuthContext';
import { useHousehold, THEME_COLOR_PALETTES } from '@/context/HouseholdContext';
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
import { BudgetDoc, DebtDoc, EnhancedTransaction, Scope, SettlementDoc, ThemeColor } from '@/lib/models';
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
  const {
    household,
    partner,
    partnerUid,
    globalScope,
    categories,
    themeColor,
    setThemeColor,
    resetAllHouseholdDataExceptUsers,
  } = useHousehold();
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
  const [debts, setDebts] = useState<DebtDoc[]>([]);
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
  const [isResettingData, setIsResettingData] = useState(false);

  const [isQuickModalOpen, setIsQuickModalOpen] = useState(false);
  const [quickModalType, setQuickModalType] = useState<'expense' | 'income'>('expense');
  const [isHouseholdConfigOpen, setIsHouseholdConfigOpen] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<TriggeredBudgetAlert[]>([]);

  // Monthly Category / Tag Chart states
  const [chartMonthDate, setChartMonthDate] = useState<Date>(() => new Date());
  const [chartViewMode, setChartViewMode] = useState<'category' | 'tag'>('category');

  const prevChartMonth = () => {
    setChartMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const nextChartMonth = () => {
    setChartMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const chartMonthLabel = useMemo(() => {
    return chartMonthDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  }, [chartMonthDate]);

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

  // One-time automatic database clean (preserving users and household links)
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const flagKey = 'gastos_db_clean_20261017_v1';
    if (localStorage.getItem(flagKey) === 'done') return;

    localStorage.setItem(flagKey, 'done');
    resetAllHouseholdDataExceptUsers().then((res) => {
      if (res.ok && res.deletedCount > 0) {
        setSuccessModalMessage(res.message);
        setIsSuccessModalOpen(true);
      }
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const hhId = household?.id || '';

    const buildOwnerFilter = () => {
      const clauses: any[] = [
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid),
      ];
      if (partnerUid) {
        clauses.push(where('ownerId', '==', partnerUid));
      }
      if (hhId) {
        clauses.push(where('householdId', '==', hhId));
      }
      return or(...clauses);
    };

    // 1. Subscribe to lists
    const listsRef = collection(db, 'lists');
    const qLists = query(listsRef, buildOwnerFilter());

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
    const qPayments = query(paymentsRef, buildOwnerFilter());

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
    const qTx = query(txRef, buildOwnerFilter());
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
    const qBudget = query(budgetRef, buildOwnerFilter());
    const unsubBudgets = onSnapshot(qBudget, (snapshot) => {
      const bList: BudgetDoc[] = [];
      snapshot.forEach((d) => bList.push({ id: d.id, ...d.data() } as BudgetDoc));
      setBudgets(bList);
    });

    // 5. Subscribe to settlements
    const settleRef = collection(db, 'settlements');
    const qSettle = query(settleRef, buildOwnerFilter());
    const unsubSettle = onSnapshot(qSettle, (snapshot) => {
      const sList: SettlementDoc[] = [];
      snapshot.forEach((d) => sList.push({ id: d.id, ...d.data() } as SettlementDoc));
      setSettlements(sList);
    });

    // 6. Subscribe to savings goals
    const savRef = collection(db, 'savings');
    const qSav = query(savRef, buildOwnerFilter());
    const unsubSav = onSnapshot(qSav, (snapshot) => {
      const svList: any[] = [];
      snapshot.forEach((d) => svList.push({ id: d.id, ...d.data() }));
      setSavings(svList);
    });

    // 7. Subscribe to credit card debts
    const debtsRef = collection(db, 'debts');
    const qDebts = query(debtsRef, buildOwnerFilter());
    const unsubDebts = onSnapshot(qDebts, (snapshot) => {
      const dList: DebtDoc[] = [];
      snapshot.forEach((d) => dList.push({ ...(d.data() as DebtDoc), id: d.id }));
      setDebts(dList);
    });

    return () => {
      unsubLists();
      unsubPayments();
      unsubTx();
      unsubBudgets();
      unsubSettle();
      unsubSav();
      unsubDebts();
    };
  }, [user, partnerUid, household?.id]);

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

  const chartData = useMemo(() => {
    if (!user) return { totalExpenses: 0, items: [] as Array<{ label: string; amount: number; pct: number; color: string; count: number }>, conicGradient: '' };
    const targetMonth = chartMonthDate.getMonth();
    const targetYear = chartMonthDate.getFullYear();

    const palette = [
      '#3B82F6',
      '#10B981',
      '#F59E0B',
      '#EF4444',
      '#8B5CF6',
      '#EC4899',
      '#06B6D4',
      '#D97706',
      '#6366F1',
      '#14B8A6',
    ];

    const grouped = new Map<string, { amount: number; count: number; color?: string }>();
    let totalExpenses = 0;

    for (const t of transactions) {
      if (t.deletedAt || t.type !== 'expense') continue;
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
      if (txDate.getMonth() !== targetMonth || txDate.getFullYear() !== targetYear) continue;

      const amt = Number(t.amount || 0);
      if (amt <= 0) continue;

      if (chartViewMode === 'category') {
        const catName = (t.category || 'Otros Gastos').trim();
        const catDef = categories.find(
          (c) => c.name.toLowerCase() === catName.toLowerCase()
        );
        const prev = grouped.get(catName) || { amount: 0, count: 0, color: catDef?.color };
        grouped.set(catName, {
          amount: prev.amount + amt,
          count: prev.count + 1,
          color: prev.color || catDef?.color,
        });
        totalExpenses += amt;
      } else {
        const txTags = t.tags && t.tags.length > 0 ? t.tags : ['sin-tag'];
        for (const rawTag of txTags) {
          const cleanTag = `#${rawTag.replace(/^#/, '').toLowerCase()}`;
          const prev = grouped.get(cleanTag) || { amount: 0, count: 0 };
          grouped.set(cleanTag, {
            amount: prev.amount + amt,
            count: prev.count + 1,
          });
        }
        totalExpenses += amt;
      }
    }

    const sorted = Array.from(grouped.entries())
      .map(([label, info], idx) => ({
        label,
        amount: info.amount,
        count: info.count,
        pct: totalExpenses > 0 ? Math.min(100, Math.round((info.amount / totalExpenses) * 100)) : 0,
        color: info.color || palette[idx % palette.length],
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Build CSS conic-gradient for the donut chart from the top 5 items
    let currentDeg = 0;
    const stops: string[] = [];
    const totalSliceSum = sorted.reduce((acc, item) => acc + item.amount, 0);
    for (const item of sorted) {
      const deg = totalSliceSum > 0 ? (item.amount / totalSliceSum) * 360 : 0;
      const nextDeg = currentDeg + deg;
      stops.push(`${item.color} ${currentDeg.toFixed(1)}deg ${nextDeg.toFixed(1)}deg`);
      currentDeg = nextDeg;
    }

    return {
      totalExpenses,
      items: sorted,
      conicGradient:
        stops.length > 0
          ? `conic-gradient(${stops.join(', ')})`
          : 'conic-gradient(var(--color-surface-container) 0deg 360deg)',
    };
  }, [transactions, chartMonthDate, chartViewMode, globalScope, user, partnerUid, categories]);

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando tu hogar..." />
      </main>
    );
  }

  const scopedUpcomingPayments = upcomingPayments.filter((p) => {
    const pScope = p.scope || (p.sharedWith && p.sharedWith.length > 0 ? 'conjunto' : 'personal');
    if (globalScope === 'mio') return p.ownerId === user.uid;
    if (globalScope === 'pareja' && partnerUid) return p.ownerId === partnerUid;
    if (globalScope === 'conjunto') return pScope === 'conjunto';
    return true;
  });
  const topPayments = scopedUpcomingPayments.slice(0, 3);

  const scopedSavings = savings.filter((s) => {
    const sScope = s.scope || (s.sharedWith && s.sharedWith.length > 0 ? 'conjunto' : 'personal');
    if (globalScope === 'mio') return s.ownerId === user.uid;
    if (globalScope === 'pareja' && partnerUid) return s.ownerId === partnerUid;
    if (globalScope === 'conjunto') return sScope === 'conjunto';
    return true;
  });
  const totalSavingsTarget = scopedSavings.reduce((s, g) => s + Number(g.targetAmount || 0), 0);
  const totalSavingsCurrent = scopedSavings.reduce((s, g) => s + Number(g.currentAmount || 0), 0);
  const savingsPct =
    totalSavingsTarget > 0 ? Math.min(100, Math.round((totalSavingsCurrent / totalSavingsTarget) * 100)) : 0;

  const scopedDebts = debts.filter((d) => {
    const dScope = d.scope || (d.sharedWith && d.sharedWith.length > 0 ? 'conjunto' : 'personal');
    if (globalScope === 'mio') return d.ownerId === user.uid;
    if (globalScope === 'pareja' && partnerUid) return d.ownerId === partnerUid;
    if (globalScope === 'conjunto') return dScope === 'conjunto';
    return true;
  });
  const totalDebtTarget = scopedDebts.reduce((s, d) => s + Number(d.targetAmount || 0), 0);
  const totalDebtPaid = scopedDebts.reduce((s, d) => s + Number(d.currentAmount || 0), 0);
  const totalDebtRemaining = Math.max(0, totalDebtTarget - totalDebtPaid);
  const debtPaidPct =
    totalDebtTarget > 0 ? Math.min(100, Math.round((totalDebtPaid / totalDebtTarget) * 100)) : 0;

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

      {/* Main Balance Card + Credit Card Debt Highlight */}
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
              gap: '10px',
              padding: '8px 0 4px',
            }}
          >
            <span
              className="text-label-md"
              style={{ color: 'var(--color-primary-container)', opacity: 0.9 }}
            >
              Balance General del Mes ({globalScope.toUpperCase()})
            </span>
            <h2
              className="text-display-lg"
              style={{ color: '#FFF', margin: 0, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatCOP(currentMonthBalance)}
            </h2>

            <div
              style={{
                background: 'rgba(255,255,255,0.12)',
                padding: '4px 12px',
                borderRadius: '16px',
              }}
            >
              <span
                className="text-label-sm"
                style={{ color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}
              >
                Mes anterior: {formatCOP(prevMonthBalance)}
              </span>
            </div>

            {/* Bloque Destacado Rojo de Deudas de Tarjetas de Crédito dentro de la Card Principal */}
            <Link
              href="/finanzas/deudas"
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '14px 16px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #DC2626 0%, #991B1B 100%)',
                border: '1px solid rgba(254, 202, 202, 0.45)',
                boxShadow: '0 8px 20px rgba(153, 27, 27, 0.35)',
                textDecoration: 'none',
                color: '#FFFFFF',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.22)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CreditCard size={16} color="#FFFFFF" />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.3px' }}>
                    DEUDA EN TARJETAS DE CRÉDITO
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(255, 255, 255, 0.22)',
                  }}
                >
                  {debtPaidPct}% abonado →
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  textAlign: 'left',
                  paddingTop: '4px',
                }}
              >
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.85)' }}>
                    Por Pagar
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 800,
                      color: '#FFFFFF',
                      marginTop: '2px',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatCOP(totalDebtRemaining)}
                  </div>
                </div>

                <div
                  style={{
                    borderLeft: '1px solid rgba(255, 255, 255, 0.24)',
                    paddingLeft: '10px',
                  }}
                >
                  <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.85)' }}>
                    Total Abonado
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 800,
                      color: '#A7F3D0',
                      marginTop: '2px',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatCOP(totalDebtPaid)}
                  </div>
                </div>

                <div
                  style={{
                    borderLeft: '1px solid rgba(255, 255, 255, 0.24)',
                    paddingLeft: '10px',
                  }}
                >
                  <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.85)' }}>
                    Total Gastado
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 700,
                      color: '#FEE2E2',
                      marginTop: '2px',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatCOP(totalDebtTarget)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${debtPaidPct}%`,
                    height: '100%',
                    backgroundColor: '#34D399',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </Link>
          </div>
        )}
      </Card>

      {/* Gráfico Mensual de Categorías y Tags en el Home */}
      <Card style={{ padding: '14px', marginTop: '14px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {/* Selector de Mes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              onClick={prevChartMonth}
              style={{
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--color-surface-container-low)',
                color: 'var(--color-on-surface)',
              }}
              title="Mes anterior"
            >
              <ChevronLeft size={15} />
            </button>
            <span
              style={{
                fontWeight: 700,
                fontSize: '13px',
                textTransform: 'capitalize',
                minWidth: '108px',
                textAlign: 'center',
              }}
            >
              {chartMonthLabel}
            </span>
            <button
              type="button"
              onClick={nextChartMonth}
              style={{
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--color-surface-container-low)',
                color: 'var(--color-on-surface)',
              }}
              title="Mes siguiente"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Toggle Categorías vs Tags */}
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--color-surface-container)',
              padding: '3px',
              borderRadius: '9999px',
              gap: '2px',
            }}
          >
            <button
              type="button"
              onClick={() => setChartViewMode('category')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: chartViewMode === 'category' ? 700 : 500,
                backgroundColor:
                  chartViewMode === 'category'
                    ? 'var(--color-surface-container-lowest)'
                    : 'transparent',
                color:
                  chartViewMode === 'category'
                    ? 'var(--color-primary)'
                    : 'var(--color-on-surface-variant)',
                boxShadow: chartViewMode === 'category' ? 'var(--shadow-level-1)' : 'none',
              }}
            >
              <PieChart size={12} />
              Categorías
            </button>
            <button
              type="button"
              onClick={() => setChartViewMode('tag')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: chartViewMode === 'tag' ? 700 : 500,
                backgroundColor:
                  chartViewMode === 'tag'
                    ? 'var(--color-surface-container-lowest)'
                    : 'transparent',
                color:
                  chartViewMode === 'tag'
                    ? 'var(--color-primary)'
                    : 'var(--color-on-surface-variant)',
                boxShadow: chartViewMode === 'tag' ? 'var(--shadow-level-1)' : 'none',
              }}
            >
              <Tag size={12} />
              Tags
            </button>
          </div>
        </div>

        {chartData.items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '18px 8px' }}>
            <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              No hay gastos registrados en {chartMonthLabel} para esta vista.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '112px 1fr',
              gap: '14px',
              alignItems: 'center',
              marginTop: '14px',
            }}
          >
            {/* Donut visual */}
            <div
              style={{
                width: '112px',
                height: '112px',
                borderRadius: '50%',
                background: chartData.conicGradient,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)',
              }}
            >
              <div
                style={{
                  width: '74px',
                  height: '74px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4px',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: '9px', color: 'var(--color-on-surface-variant)' }}>
                  Total Mes
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    color: 'var(--color-on-surface)',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1.15,
                  }}
                >
                  {formatCOP(chartData.totalExpenses)}
                </span>
              </div>
            </div>

            {/* Barras y ranking de Categorías / Tags (Top 5 de mayor a menor) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              {chartData.items.slice(0, 5).map((item, idx) => (
                <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px',
                      gap: '6px',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontWeight: 600,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: item.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {idx + 1}. {item.label}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0,
                      }}
                    >
                      {formatCOP(item.amount)}{' '}
                      <span style={{ color: 'var(--color-on-surface-variant)', fontWeight: 500 }}>
                        ({item.pct}%)
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '5px',
                      borderRadius: '999px',
                      backgroundColor: 'var(--color-surface-container)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(4, item.pct)}%`,
                        height: '100%',
                        borderRadius: '999px',
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Dashboard Widgets: Detalle de Tarjetas de Crédito y Metas de Ahorro */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
        {/* Credit Card Debts & Abonos Widget */}
        <Link href="/finanzas/deudas" style={{ textDecoration: 'none' }}>
          <Card style={{ padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CreditCard size={18} color="var(--color-primary)" />
                <span style={{ fontWeight: 600, fontSize: '14px' }}>
                  Mis Tarjetas de Crédito y Abonos ({scopedDebts.length})
                </span>
              </div>
              <ArrowRight size={16} color="var(--color-on-surface-variant)" />
            </div>

            {scopedDebts.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                {scopedDebts.slice(0, 3).map((d) => {
                  const rem = Math.max(0, Number(d.targetAmount || 0) - Number(d.currentAmount || 0));
                  return (
                    <div
                      key={d.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--color-surface-container-low)',
                        fontSize: '12px',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{d.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                          Abonado: {formatCOP(d.currentAmount || 0)} de {formatCOP(d.targetAmount || 0)}
                        </div>
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          color: rem > 0 ? 'var(--color-error)' : 'var(--color-success)',
                          fontVariantNumeric: 'tabular-nums',
                          flexShrink: 0,
                        }}
                      >
                        {formatCOP(rem)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p
                className="text-body-sm"
                style={{ color: 'var(--color-on-surface-variant)', marginTop: '6px' }}
              >
                Toca aquí para registrar las deudas de tus tarjetas de crédito y llevar el control de tus abonos.
              </p>
            )}
          </Card>
        </Link>

        {/* Savings Goal Row */}
        <Link href="/finanzas/metas" style={{ textDecoration: 'none' }}>
          <Card style={{ padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PiggyBank size={18} color="var(--color-success)" />
                <span style={{ fontWeight: 600, fontSize: '14px' }}>
                  Metas de Ahorro ({savingsPct}%)
                </span>
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--color-success)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(totalSavingsCurrent)} / {formatCOP(totalSavingsTarget)}
              </div>
            </div>
          </Card>
        </Link>
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

      {/* SpeedDial with Direct Expense Modal */}
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

      {/* Profile Modal */}
      <Modal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        title="Tu Perfil y Hogar"
      >
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
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

        {/* Selector de Color del Layout */}
        <div
          style={{
            padding: '12px',
            borderRadius: '14px',
            backgroundColor: 'var(--color-surface-container-low)',
            border: '1px solid var(--color-outline-variant)',
            marginBottom: '16px',
          }}
        >
          <p
            className="text-label-sm"
            style={{
              fontWeight: 700,
              marginBottom: '10px',
              color: 'var(--color-on-surface)',
              textAlign: 'center',
            }}
          >
            🎨 Color del Tema (Layout)
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {(Object.keys(THEME_COLOR_PALETTES) as ThemeColor[]).map((colorKey) => {
              const palette = THEME_COLOR_PALETTES[colorKey];
              const isSelected = themeColor === colorKey;
              return (
                <button
                  key={colorKey}
                  type="button"
                  onClick={() => setThemeColor(colorKey)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 4px',
                    borderRadius: '12px',
                    border: isSelected
                      ? `2px solid ${palette.primary}`
                      : '1px solid var(--color-outline-variant)',
                    backgroundColor: isSelected
                      ? palette.primaryContainer
                      : 'var(--color-surface-container-lowest)',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: `linear-gradient(135deg, ${palette.primary}, ${palette.primaryDark})`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                    }}
                  >
                    {isSelected && <Check size={13} />}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? palette.primaryDark : 'var(--color-on-surface)',
                    }}
                  >
                    {palette.label}
                  </span>
                </button>
              );
            })}
          </div>
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
            variant="secondary"
            fullWidth
            disabled={isResettingData}
            onClick={async () => {
              if (
                !window.confirm(
                  '¿Seguro que deseas eliminar TODOS los movimientos, metas, deudas, listas y catálogos? Los usuarios y el vínculo del hogar NO se borrarán.'
                )
              ) {
                return;
              }
              setIsResettingData(true);
              const res = await resetAllHouseholdDataExceptUsers();
              setIsResettingData(false);
              setIsProfileModalOpen(false);
              setSuccessModalMessage(res.message);
              setIsSuccessModalOpen(true);
            }}
            style={{
              color: 'var(--color-error)',
              borderColor: 'rgba(239, 68, 68, 0.3)',
            }}
          >
            <Trash2 size={16} />{' '}
            {isResettingData
              ? 'Limpiando base de datos...'
              : 'Limpiar todos los datos (Conservar Usuarios)'}
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
