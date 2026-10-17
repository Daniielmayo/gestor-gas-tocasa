'use client';
import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { SpeedDial } from '@/components/ui/SpeedDial';
import { ScopeFilterBar } from '@/components/ui/ScopeFilterBar';
import { QuickMovementModal } from '@/components/finanzas/QuickMovementModal';
import { HouseholdConfigModal } from '@/components/finanzas/HouseholdConfigModal';
import { BudgetManagerModal } from '@/components/finanzas/BudgetManagerModal';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Settings,
  UserPlus,
  Trash2,
  PiggyBank,
  Target,
  BarChart3,
  Scale,
  Receipt,
  AlertTriangle,
  Search,
  Filter,
  CreditCard,
  Image as ImageIcon,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import styles from './finanzas.module.css';
import { useAuth } from '@/context/AuthContext';
import { useHousehold } from '@/context/HouseholdContext';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  Timestamp,
  or,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import {
  BudgetDoc,
  EnhancedTransaction,
  Scope,
  SettlementDoc,
} from '@/lib/models';
import {
  evaluateBudgetStatus,
  getPeriodKey,
  TriggeredBudgetAlert,
} from '@/lib/budgetEngine';
import { calculatePartnerBalance } from '@/lib/balanceEngine';
import { deleteReceiptAttachment } from '@/lib/cloudinaryClient';

interface SavingGoal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  ownerId: string;
  sharedWith?: string[];
}

interface Debt {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  ownerId: string;
  sharedWith?: string[];
}

type FinanzasSubTab = 'extracto' | 'reportes' | 'pareja';

export default function Finanzas() {
  const { user, profile, loading } = useAuth();
  const {
    household,
    partner,
    partnerUid,
    globalScope,
    paymentMethods,
    categories,
  } = useHousehold();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [transactions, setTransactions] = useState<EnhancedTransaction[]>([]);
  const [budgets, setBudgets] = useState<BudgetDoc[]>([]);
  const [settlements, setSettlements] = useState<SettlementDoc[]>([]);
  const [recurringPayments, setRecurringPayments] = useState<any[]>([]);
  const [savings, setSavings] = useState<SavingGoal[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Period navigation (Month + Quincena filter RF-07 / RF-09)
  const [currentDate, setCurrentDate] = useState(new Date());
  const [quincenaFilter, setQuincenaFilter] = useState<'all' | 'q1' | 'q2'>('all');
  const [activeSubTab, setActiveSubTab] = useState<FinanzasSubTab>('extracto');

  // Ledger search & filters (RF-11)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [selectedTagFilter, setSelectedTagFilter] = useState('');
  const [selectedMethodFilter, setSelectedMethodFilter] = useState('');
  const [showRunningBalance, setShowRunningBalance] = useState(false);
  const [visibleDaysLimit, setVisibleDaysLimit] = useState(15);

  // Modals state
  const [isQuickModalOpen, setIsQuickModalOpen] = useState(false);
  const [quickModalType, setQuickModalType] = useState<'expense' | 'income'>('expense');
  const [editingTx, setEditingTx] = useState<EnhancedTransaction | null>(null);

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configInitialTab, setConfigInitialTab] = useState<'hogar' | 'metodos' | 'catalogo' | 'lugares' | 'ingresos'>('metodos');

  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);

  // Alert banner state (RF-08)
  const [recentAlerts, setRecentAlerts] = useState<TriggeredBudgetAlert[]>([]);

  // Soft delete & receipt inspection modals
  const [txToDelete, setTxToDelete] = useState<EnhancedTransaction | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);
  const [inspectingTx, setInspectingTx] = useState<EnhancedTransaction | null>(null);

  // Settlement modal state (RF-12)
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementNote, setSettlementNote] = useState('');
  const [isSavingSettlement, setIsSavingSettlement] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const txRef = collection(db, 'transactions');
    const qTx = query(
      txRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );

    const unsubTx = onSnapshot(
      qTx,
      (snapshot) => {
        const data: EnhancedTransaction[] = [];
        snapshot.forEach((d) => {
          const raw = d.data() as EnhancedTransaction;
          if (!raw.deletedAt) {
            data.push({ ...raw, id: d.id });
          }
        });
        data.sort((a, b) => {
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
          return timeB - timeA;
        });
        setTransactions(data);
        setIsReady(true);
      },
      (error) => {
        console.error('Error fetching transactions:', error);
        setIsReady(true);
      }
    );

    const budgetRef = collection(db, 'budgets');
    const qBudget = query(
      budgetRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubBudgets = onSnapshot(qBudget, (snapshot) => {
      const list: BudgetDoc[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...d.data() } as BudgetDoc));
      setBudgets(list);
    });

    const settleRef = collection(db, 'settlements');
    const qSettle = query(
      settleRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubSettle = onSnapshot(qSettle, (snapshot) => {
      const list: SettlementDoc[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...d.data() } as SettlementDoc));
      list.sort((a, b) => {
        const tA = a.settledAt?.toMillis ? a.settledAt.toMillis() : 0;
        const tB = b.settledAt?.toMillis ? b.settledAt.toMillis() : 0;
        return tB - tA;
      });
      setSettlements(list);
    });

    const payRef = collection(db, 'recurringPayments');
    const qPay = query(
      payRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubPay = onSnapshot(qPay, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() }));
      setRecurringPayments(data);
    });

    const savRef = collection(db, 'savings');
    const qSav = query(
      savRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubSav = onSnapshot(qSav, (snapshot) => {
      const data: SavingGoal[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() } as SavingGoal));
      setSavings(data);
    });

    const debtRef = collection(db, 'debts');
    const qDebt = query(
      debtRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubDebt = onSnapshot(qDebt, (snapshot) => {
      const data: Debt[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() } as Debt));
      setDebts(data);
    });

    return () => {
      unsubTx();
      unsubBudgets();
      unsubSettle();
      unsubPay();
      unsubSav();
      unsubDebt();
    };
  }, [user]);

  const getMonthName = (date: Date) =>
    date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const nextMonth = () =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const prevMonth = () =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

  // Helper to resolve transaction scope with legacy fallback (Section 0 Rule 3)
  const resolveTxScope = (t: EnhancedTransaction): Scope => {
    if (t.scope === 'personal' || t.scope === 'conjunto') return t.scope;
    return t.sharedWith && t.sharedWith.length > 0 ? 'conjunto' : 'personal';
  };

  // Transactions matching selected month + quincena + global scope + search/filters
  const periodTransactions = useMemo(() => {
    if (!user) return [];
    return transactions.filter((t) => {
      const txDate = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
      const matchesMonth =
        txDate.getMonth() === currentDate.getMonth() &&
        txDate.getFullYear() === currentDate.getFullYear();
      if (!matchesMonth) return false;

      if (quincenaFilter === 'q1' && txDate.getDate() > 15) return false;
      if (quincenaFilter === 'q2' && txDate.getDate() <= 15) return false;

      const scope = resolveTxScope(t);
      const payer = t.paidByUserId || t.ownerId;

      if (globalScope === 'mio') {
        if (!(scope === 'personal' && t.ownerId === user.uid) && payer !== user.uid) return false;
      } else if (globalScope === 'conjunto') {
        if (scope !== 'conjunto') return false;
      } else if (globalScope === 'pareja' && partnerUid) {
        if (payer !== partnerUid && t.ownerId !== partnerUid) return false;
      }

      if (selectedCategoryFilter && t.category !== selectedCategoryFilter) return false;
      if (
        selectedTagFilter &&
        !(t.tags || []).some((tg) => tg.toLowerCase() === selectedTagFilter.toLowerCase())
      ) {
        return false;
      }
      if (selectedMethodFilter && t.paymentMethodId !== selectedMethodFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${t.place || ''} ${t.description || ''} ${t.title || ''} ${t.category || ''} ${
          t.note || ''
        } ${(t.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    transactions,
    currentDate,
    quincenaFilter,
    globalScope,
    selectedCategoryFilter,
    selectedTagFilter,
    selectedMethodFilter,
    searchQuery,
    user,
    partnerUid,
  ]);

  // Previous month transactions for comparative reporting (RF-09)
  const prevMonthTransactions = useMemo(() => {
    const prevDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    return transactions.filter((t) => {
      const txDate = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
      return (
        txDate.getMonth() === prevDate.getMonth() &&
        txDate.getFullYear() === prevDate.getFullYear()
      );
    });
  }, [transactions, currentDate]);

  const totalIncome = periodTransactions
    .filter((t) => t.type === 'income')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const totalExpense = periodTransactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const balance = totalIncome - totalExpense;

  const prevMonthExpense = prevMonthTransactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);

  // Active budget for current period (RF-07)
  const currentBudgetDoc = useMemo(() => {
    const monthlyKey = getPeriodKey(currentDate, 'mensual');
    const qKey =
      quincenaFilter === 'q1'
        ? `${monthlyKey}-Q1`
        : quincenaFilter === 'q2'
        ? `${monthlyKey}-Q2`
        : getPeriodKey(new Date(), 'quincenal');

    return (
      budgets.find((b) => b.periodKey === qKey) ||
      budgets.find((b) => b.periodKey === monthlyKey) ||
      budgets[0] ||
      null
    );
  }, [budgets, currentDate, quincenaFilter]);

  const currentBudgetStatus = useMemo(() => {
    if (!currentBudgetDoc || !user) return null;
    return evaluateBudgetStatus(currentBudgetDoc, transactions, user.uid);
  }, [currentBudgetDoc, transactions, user]);

  // Partner Balance & Settlements calculation (RF-12)
  const partnerBalance = useMemo(() => {
    if (!user) return null;
    const myName = profile?.displayName?.split(' ')[0] || 'Yo';
    const theirName = partner?.displayName?.split(' ')[0] || 'Pareja';
    const theirUid = partnerUid || 'partner_pending';

    return calculatePartnerBalance({
      userAId: user.uid,
      userAName: myName,
      userBId: theirUid,
      userBName: theirName,
      transactions: periodTransactions,
      settlements,
      splitRule: household?.splitRule || '50_50',
    });
  }, [user, profile, partner, partnerUid, periodTransactions, settlements, household?.splitRule]);

  // Group ledger movements by day with daily total and optional running balance (RF-11)
  const groupedLedgerDays = useMemo(() => {
    // Compute running balance chronologically first
    const asc = [...periodTransactions].reverse();
    let running = 0;
    const runningMap = new Map<string, number>();
    for (const tx of asc) {
      running += tx.type === 'income' ? Number(tx.amount) : -Number(tx.amount);
      runningMap.set(tx.id, running);
    }

    const groups: {
      dateKey: string;
      dateLabel: string;
      dailyNet: number;
      items: (EnhancedTransaction & { runningBalance: number })[];
    }[] = [];

    for (const tx of periodTransactions) {
      const d = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date();
      const dateKey = d.toISOString().split('T')[0];
      const dateLabel = d.toLocaleDateString('es-CO', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });

      let group = groups.find((g) => g.dateKey === dateKey);
      if (!group) {
        group = { dateKey, dateLabel, dailyNet: 0, items: [] };
        groups.push(group);
      }
      const signed = tx.type === 'income' ? Number(tx.amount) : -Number(tx.amount);
      group.dailyNet += signed;
      group.items.push({
        ...tx,
        runningBalance: runningMap.get(tx.id) || 0,
      });
    }

    return groups;
  }, [periodTransactions]);

  // Reports aggregations (by category & by tag RF-09)
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; color: string }>();
    const expenses = periodTransactions.filter((t) => t.type === 'expense');
    for (const exp of expenses) {
      const catName = exp.category || 'Otros';
      const catDef = categories.find((c) => c.name.toLowerCase() === catName.toLowerCase());
      const curr = map.get(catName) || {
        name: catName,
        amount: 0,
        color: catDef?.color || '#3B82F6',
      };
      curr.amount += Number(exp.amount || 0);
      map.set(catName, curr);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [periodTransactions, categories]);

  const tagBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    const expenses = periodTransactions.filter((t) => t.type === 'expense');
    for (const exp of expenses) {
      for (const tg of exp.tags || []) {
        const clean = tg.toLowerCase();
        map.set(clean, (map.get(clean) || 0) + Number(exp.amount || 0));
      }
    }
    return Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [periodTransactions]);

  // Soft delete implementation (RF-03 + RF-06 Cloudinary cleanup)
  const handleSoftDeleteTransaction = async () => {
    if (!txToDelete || !user) return;
    setIsDeletingTx(true);
    try {
      await updateDoc(doc(db, 'transactions', txToDelete.id), {
        deletedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      if (txToDelete.attachments?.length) {
        for (const att of txToDelete.attachments) {
          await deleteReceiptAttachment(att.publicId);
        }
      }
      setTxToDelete(null);
    } catch (error) {
      console.error('Error soft-deleting transaction:', error);
    } finally {
      setIsDeletingTx(false);
    }
  };

  const handleRecordSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !partnerBalance || !partnerBalance.debtorId || !partnerBalance.creditorId) return;
    const amt = parseCOP(settlementAmount);
    if (amt <= 0) return;

    setIsSavingSettlement(true);
    try {
      await addDoc(collection(db, 'settlements'), {
        householdId: household?.id || 'default',
        ownerId: user.uid,
        sharedWith: partnerUid ? [partnerUid] : [],
        fromUserId: partnerBalance.debtorId,
        fromUserName: partnerBalance.debtorName || 'Deudor',
        toUserId: partnerBalance.creditorId,
        toUserName: partnerBalance.creditorName || 'Acreedor',
        amount: amt,
        note: settlementNote.trim() || 'Liquidación de gastos conjuntos',
        settledAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      });
      setIsSettlementModalOpen(false);
      setSettlementAmount('');
      setSettlementNote('');
    } catch (err) {
      console.error('Error recording settlement:', err);
    } finally {
      setIsSavingSettlement(false);
    }
  };

  if (loading || !user || !isReady) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando centro financiero..." />
      </main>
    );
  }

  const totalSavingsTarget = savings.reduce((sum, s) => sum + s.targetAmount, 0);
  const totalSavingsCurrent = savings.reduce((sum, s) => sum + s.currentAmount, 0);
  const overallSavingsProgress =
    totalSavingsTarget > 0 ? Math.min(100, Math.round((totalSavingsCurrent / totalSavingsTarget) * 100)) : 0;

  const totalDebtTarget = debts.reduce((sum, d) => sum + d.targetAmount, 0);
  const totalDebtPaid = debts.reduce((sum, d) => sum + d.currentAmount, 0);
  const totalDebtRemaining = Math.max(0, totalDebtTarget - totalDebtPaid);

  return (
    <main className={`container ${styles.main}`} style={{ paddingBottom: '100px' }}>
      {/* TOP HEADER */}
      <header className={styles.header}>
        <Link href="/">
          <Button variant="ghost" className={styles.iconBtn}>
            <ArrowLeft size={22} />
          </Button>
        </Link>
        <div
          className={styles.titleContainer}
          style={{
            flex: 1,
            overflow: 'hidden',
            marginLeft: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <h1 className="text-headline-md">Finanzas</h1>
          {partner && (
            <AvatarGroup
              users={[usersMap[user.uid], usersMap[partner.uid]].filter(Boolean) as any}
              size="sm"
            />
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button
            variant="ghost"
            className={styles.iconBtn}
            onClick={() => {
              setConfigInitialTab('hogar');
              setIsConfigModalOpen(true);
            }}
            title="Vincular pareja"
          >
            <UserPlus size={20} color="var(--color-primary)" />
          </Button>
          <Button
            variant="ghost"
            className={styles.iconBtn}
            onClick={() => {
              setConfigInitialTab('metodos');
              setIsConfigModalOpen(true);
            }}
            title="Tarjetas y Métodos de Pago"
          >
            <CreditCard size={20} />
          </Button>
          <Button
            variant="ghost"
            className={styles.iconBtn}
            onClick={() => {
              setConfigInitialTab('catalogo');
              setIsConfigModalOpen(true);
            }}
            title="Categorías y Tags"
          >
            <Settings size={20} />
          </Button>
        </div>
      </header>

      {/* GLOBAL SCOPE SELECTOR (Mío · Conjunto · Pareja · Todo) */}
      <div style={{ marginBottom: '12px' }}>
        <ScopeFilterBar />
      </div>

      {/* MONTH + QUINCENA SELECTOR */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div className={styles.monthSelector} style={{ margin: 0, flex: 1 }}>
          <Button variant="ghost" className={styles.iconBtn} onClick={prevMonth}>
            <ChevronLeft size={22} />
          </Button>
          <span className={styles.monthText} style={{ textTransform: 'capitalize' }}>
            {getMonthName(currentDate)}
          </span>
          <Button variant="ghost" className={styles.iconBtn} onClick={nextMonth}>
            <ChevronRight size={22} />
          </Button>
        </div>

        <div
          style={{
            display: 'inline-flex',
            background: 'var(--color-surface-container)',
            borderRadius: '10px',
            padding: '3px',
            gap: '2px',
          }}
        >
          {[
            { id: 'all', label: 'Mes' },
            { id: 'q1', label: '1ª Q (1-15)' },
            { id: 'q2', label: '2ª Q (16+)' },
          ].map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setQuincenaFilter(q.id as any)}
              style={{
                padding: '5px 8px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: quincenaFilter === q.id ? 600 : 500,
                backgroundColor: quincenaFilter === q.id ? 'var(--color-surface-container-lowest)' : 'transparent',
                color: quincenaFilter === q.id ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* DISPARO DE ALERTAS DE PRESUPUESTO RECIENTES (RF-08) */}
      {recentAlerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          {recentAlerts.map((al) => (
            <div
              key={al.alertKey}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '12px 14px',
                borderRadius: '12px',
                backgroundColor:
                  al.severity === 'danger' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.14)',
                border: `1px solid ${al.severity === 'danger' ? 'var(--color-error)' : 'var(--color-warning)'}`,
                color: 'var(--color-on-surface)',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <AlertTriangle
                  size={18}
                  color={al.severity === 'danger' ? 'var(--color-error)' : 'var(--color-warning)'}
                  style={{ flexShrink: 0, marginTop: '2px' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px' }}>{al.title}</div>
                  <div style={{ fontSize: '12px' }}>{al.message}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecentAlerts((prev) => prev.filter((x) => x.alertKey !== al.alertKey))}
                style={{ fontSize: '14px', fontWeight: 700, padding: '0 4px' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* SUMMARY BALANCE CARD */}
      <section>
        <div className={styles.balanceCard} style={{ padding: '18px' }}>
          <span className={styles.balanceTitle}>
            Disponible del Periodo ({globalScope.toUpperCase()})
          </span>
          <h2
            className={`${styles.balanceAmount} ${
              balance >= 0 ? styles.balanceAmountPositive : styles.balanceAmountNegative
            }`}
          >
            {formatCOP(balance)}
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid var(--color-outline-variant)',
            }}
          >
            <div>
              <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Ingresos (+)
              </span>
              <div style={{ fontWeight: 700, color: 'var(--color-success)', fontSize: '15px' }}>
                {formatCOP(totalIncome)}
              </div>
            </div>
            <div>
              <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Gastos (-)
              </span>
              <div style={{ fontWeight: 700, color: 'var(--color-error)', fontSize: '15px' }}>
                {formatCOP(totalExpense)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SUB-NAVIGATION PILLS (Extracto · Reportes · Pareja) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '6px',
          marginTop: '14px',
          marginBottom: '16px',
        }}
      >
        {[
          { id: 'extracto', label: 'Extracto', icon: <Receipt size={15} /> },
          { id: 'reportes', label: 'Gráficos', icon: <BarChart3 size={15} /> },
          { id: 'pareja', label: 'Liquidación', icon: <Scale size={15} /> },
        ].map((tab) => {
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id as FinanzasSubTab)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '10px 6px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: active ? 700 : 500,
                backgroundColor: active
                  ? 'var(--color-primary-container)'
                  : 'var(--color-surface-container-lowest)',
                color: active ? 'var(--color-primary-dark)' : 'var(--color-on-surface-variant)',
                border: active
                  ? '1.5px solid var(--color-primary)'
                  : '1px solid var(--color-outline-variant)',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* =================================================================== */}
      {/* TAB 1: EXTRACTO TIPO BANCO (RF-11)                                  */}
      {/* =================================================================== */}
      {activeSubTab === 'extracto' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Quick Search & Filter Row */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '12px',
              borderRadius: '12px',
              backgroundColor: 'var(--color-surface-container-lowest)',
              boxShadow: 'var(--shadow-level-1)',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-container-low)',
                }}
              >
                <Search size={16} color="var(--color-on-surface-variant)" />
                <input
                  type="text"
                  placeholder="Buscar comercio, categoría, #tag o nota..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    width: '100%',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowRunningBalance(!showRunningBalance)}
                style={{
                  padding: '8px 10px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: showRunningBalance
                    ? 'var(--color-primary-container)'
                    : 'var(--color-surface-container-low)',
                  color: showRunningBalance
                    ? 'var(--color-primary-dark)'
                    : 'var(--color-on-surface-variant)',
                }}
              >
                Saldo Acum.
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                style={{
                  padding: '7px 10px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-outline-variant)',
                  fontSize: '12px',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                <option value="">Todas las categorías</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={selectedMethodFilter}
                onChange={(e) => setSelectedMethodFilter(e.target.value)}
                style={{
                  padding: '7px 10px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-outline-variant)',
                  fontSize: '12px',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                <option value="">Todos los métodos</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.alias} ({pm.holderName || 'Hogar'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Grouped Daily Bank Ledger */}
          {groupedLedgerDays.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '40px 16px' }}>
              <Wallet size={32} color="var(--color-on-surface-variant)" style={{ margin: '0 auto 8px' }} />
              <h4 className="text-headline-sm">Sin movimientos en este filtro</h4>
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                Usa el botón "+" para registrar un gasto o ingreso en menos de 15 segundos.
              </p>
            </Card>
          ) : (
            groupedLedgerDays.slice(0, visibleDaysLimit).map((dayGroup) => (
              <div
                key={dayGroup.dateKey}
                style={{
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  borderRadius: '14px',
                  boxShadow: 'var(--shadow-level-1)',
                  overflow: 'hidden',
                }}
              >
                {/* Day Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    backgroundColor: 'var(--color-surface-container-low)',
                    borderBottom: '1px solid var(--color-outline-variant)',
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                  }}
                >
                  <span>{dayGroup.dateLabel}</span>
                  <span
                    style={{
                      color:
                        dayGroup.dailyNet >= 0 ? 'var(--color-success)' : 'var(--color-on-surface-variant)',
                    }}
                  >
                    Total día: {dayGroup.dailyNet >= 0 ? '+' : ''}
                    {formatCOP(dayGroup.dailyNet)}
                  </span>
                </div>

                {/* Day Transactions */}
                <div>
                  {dayGroup.items.map((t) => {
                    const scope = resolveTxScope(t);
                    const payerName =
                      t.paidByName ||
                      (t.ownerId === user.uid ? 'Yo' : t.ownerName || partner?.displayName || 'Pareja');
                    return (
                      <div
                        key={t.id}
                        onClick={() => setInspectingTx(t)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 14px',
                          borderBottom: '1px solid var(--color-surface-container)',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                          <div
                            className={`${styles.iconWrapper} ${
                              t.type === 'income' ? styles.iconIncome : styles.iconExpense
                            }`}
                            style={{ width: '38px', height: '38px', flexShrink: 0 }}
                          >
                            {t.type === 'income' ? (
                              <ArrowUpRight size={20} />
                            ) : (
                              <ArrowDownRight size={20} />
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, fontSize: '14px' }}>
                                {t.place || t.description || t.title || t.category}
                              </span>
                              <span
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                  borderRadius: '999px',
                                  backgroundColor:
                                    scope === 'conjunto'
                                      ? 'rgba(59, 130, 246, 0.12)'
                                      : 'var(--color-surface-container)',
                                  color:
                                    scope === 'conjunto'
                                      ? 'var(--color-primary-dark)'
                                      : 'var(--color-on-surface-variant)',
                                  fontWeight: 600,
                                }}
                              >
                                {scope === 'conjunto' ? 'Conjunto' : 'Personal'}
                              </span>
                              {t.attachments && t.attachments.length > 0 && (
                                <ImageIcon size={13} color="var(--color-primary)" />
                              )}
                            </div>

                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--color-on-surface-variant)',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '4px',
                              }}
                            >
                              <span>{t.category}</span>
                              <span>• Pagó: {payerName}</span>
                              {t.paymentMethodAlias && <span>• {t.paymentMethodAlias}</span>}
                            </div>

                            {t.tags && t.tags.length > 0 && (
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                                {t.tags.map((tg) => (
                                  <span
                                    key={tg}
                                    style={{
                                      fontSize: '10px',
                                      color: 'var(--color-primary)',
                                      backgroundColor: 'var(--color-primary-container)',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                    }}
                                  >
                                    #{tg}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', marginLeft: '8px' }}>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: '14px',
                              color:
                                t.type === 'income' ? 'var(--color-success)' : 'var(--color-error)',
                            }}
                          >
                            {t.type === 'income' ? '+' : '-'}
                            {formatCOP(t.amount)}
                          </div>
                          {showRunningBalance && (
                            <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>
                              Saldo: {formatCOP(t.runningBalance)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {groupedLedgerDays.length > visibleDaysLimit && (
            <Button
              variant="secondary"
              fullWidth
              onClick={() => setVisibleDaysLimit((prev) => prev + 15)}
            >
              Ver más días del historial
            </Button>
          )}

          {/* Quick Links to Savings & Debts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '8px' }}>
            <Link href="/finanzas/metas" style={{ textDecoration: 'none' }}>
              <Card style={{ padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <PiggyBank size={18} color="var(--color-success)" />
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>Metas Ahorro</span>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-success)' }}>
                  {formatCOP(totalSavingsCurrent)} ({overallSavingsProgress}%)
                </div>
              </Card>
            </Link>
            <Link href="/finanzas/deudas" style={{ textDecoration: 'none' }}>
              <Card style={{ padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Target size={18} color="var(--color-error)" />
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>Deudas Externas</span>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-error)' }}>
                  {formatCOP(totalDebtRemaining)}
                </div>
              </Card>
            </Link>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 2: GRÁFICOS Y REPORTES COMPARATIVOS (RF-09)                     */}
      {/* =================================================================== */}
      {activeSubTab === 'reportes' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Comparativo con el mes anterior */}
          <Card style={{ padding: '16px' }}>
            <h4 className="text-body-lg" style={{ fontWeight: 700, marginBottom: '8px' }}>
              Comparativo vs. Mes Anterior
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                  Gasto Mes Actual
                </span>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-error)' }}>
                  {formatCOP(totalExpense)}
                </div>
              </div>
              <div>
                <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                  Gasto Mes Anterior
                </span>
                <div style={{ fontSize: '18px', fontWeight: 700 }}>
                  {formatCOP(prevMonthExpense)}
                </div>
              </div>
            </div>
            {prevMonthExpense > 0 && (
              <p style={{ fontSize: '12px', marginTop: '8px', color: 'var(--color-on-surface-variant)' }}>
                Variación:{' '}
                <strong>
                  {Math.round(((totalExpense - prevMonthExpense) / prevMonthExpense) * 100)}%
                </strong>{' '}
                respecto al periodo anterior.
              </p>
            )}
          </Card>

          {/* Gráfico de Gastos por Categoría */}
          <Card style={{ padding: '16px' }}>
            <h4 className="text-body-lg" style={{ fontWeight: 700, marginBottom: '12px' }}>
              Distribución por Categoría
            </h4>
            {categoryBreakdown.length === 0 ? (
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                No hay gastos registrados en este periodo.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {categoryBreakdown.map((item) => {
                  const pct = totalExpense > 0 ? Math.round((item.amount / totalExpense) * 100) : 0;
                  return (
                    <div key={item.name}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '13px',
                          marginBottom: '4px',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{item.name}</span>
                        <span>
                          {formatCOP(item.amount)} ({pct}%)
                        </span>
                      </div>
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
                            width: `${pct}%`,
                            height: '100%',
                            backgroundColor: item.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Gráfico de Gastos por Tag */}
          <Card style={{ padding: '16px' }}>
            <h4 className="text-body-lg" style={{ fontWeight: 700, marginBottom: '12px' }}>
              Gastos por #Tag Transversal
            </h4>
            {tagBreakdown.length === 0 ? (
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Agrega tags como #mercado o #dolarcity a tus gastos para ver esta métrica.
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {tagBreakdown.map((tg) => (
                  <div
                    key={tg.name}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--color-surface-container-low)',
                      fontSize: '13px',
                    }}
                  >
                    <strong style={{ color: 'var(--color-primary-dark)' }}>#{tg.name}</strong>:{' '}
                    {formatCOP(tg.amount)}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 4: BALANCE Y LIQUIDACIÓN ENTRE LA PAREJA (RF-12)                */}
      {/* =================================================================== */}
      {activeSubTab === 'pareja' && partnerBalance && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Card style={{ padding: '18px', textAlign: 'center' }}>
            <span className="text-label-md" style={{ color: 'var(--color-on-surface-variant)' }}>
              Estado de Cuentas en Gastos Conjuntos (
              {partnerBalance.splitRule === '50_50' ? 'Reparto 50/50' : 'Reparto Proporcional'})
            </span>

            {partnerBalance.netAmountOwed === 0 ? (
              <div style={{ margin: '16px 0' }}>
                <CheckCircle2
                  size={36}
                  color="var(--color-success)"
                  style={{ margin: '0 auto 8px' }}
                />
                <h3 className="text-headline-sm">¡Están a paz y salvo!</h3>
                <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                  No hay saldo pendiente por liquidar en este periodo.
                </p>
              </div>
            ) : (
              <div style={{ margin: '16px 0' }}>
                <h3 className="text-headline-md" style={{ color: 'var(--color-primary-dark)' }}>
                  {partnerBalance.debtorName} le debe a {partnerBalance.creditorName}
                </h3>
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 800,
                    color: 'var(--color-on-surface)',
                    margin: '6px 0 14px',
                  }}
                >
                  {formatCOP(partnerBalance.netAmountOwed)}
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    setSettlementAmount(formatInputCOP(String(partnerBalance.netAmountOwed)));
                    setIsSettlementModalOpen(true);
                  }}
                >
                  Registrar Liquidación (Saldar Deuda)
                </Button>
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                paddingTop: '12px',
                borderTop: '1px solid var(--color-outline-variant)',
                textAlign: 'left',
                fontSize: '12px',
              }}
            >
              <div>
                <div style={{ color: 'var(--color-on-surface-variant)' }}>
                  Pagado por {partnerBalance.userAName}
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>
                  {formatCOP(partnerBalance.paidByA)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Le corresponde: {formatCOP(partnerBalance.shouldPayA)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--color-on-surface-variant)' }}>
                  Pagado por {partnerBalance.userBName}
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>
                  {formatCOP(partnerBalance.paidByB)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Le corresponde: {formatCOP(partnerBalance.shouldPayB)}
                </div>
              </div>
            </div>
          </Card>

          {settlements.length > 0 && (
            <Card style={{ padding: '16px' }}>
              <h4 className="text-body-md" style={{ fontWeight: 700, marginBottom: '10px' }}>
                Historial de Liquidaciones entre Ustedes
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {settlements.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--color-surface-container-low)',
                      fontSize: '13px',
                    }}
                  >
                    <div>
                      <strong>{s.fromUserName}</strong> pagó a <strong>{s.toUserName}</strong>
                      {s.note && (
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                          {s.note}
                        </div>
                      )}
                    </div>
                    <strong style={{ color: 'var(--color-success)' }}>{formatCOP(s.amount)}</strong>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>
      )}

      {/* FLOATING SPEED DIAL */}
      <SpeedDial
        actions={[
          {
            name: 'Nuevo Gasto',
            icon: <TrendingDown size={20} />,
            color: '#EF4444',
            onClick: () => {
              setEditingTx(null);
              setQuickModalType('expense');
              setIsQuickModalOpen(true);
            },
          },
          {
            name: 'Nuevo Ingreso',
            icon: <TrendingUp size={20} />,
            color: '#10B981',
            onClick: () => {
              setEditingTx(null);
              setQuickModalType('income');
              setIsQuickModalOpen(true);
            },
          },
        ]}
      />

      {/* ONE-STEP QUICK MOVEMENT MODAL */}
      <QuickMovementModal
        isOpen={isQuickModalOpen}
        onClose={() => {
          setIsQuickModalOpen(false);
          setEditingTx(null);
        }}
        initialType={quickModalType}
        editingTransaction={editingTx}
        knownTransactions={transactions}
        recurringPayments={recurringPayments}
        activeBudgets={budgets}
        onAlertsTriggered={(alerts) => setRecentAlerts(alerts)}
      />

      {/* HOUSEHOLD, CARDS & CATEGORIES CONFIG MODAL */}
      <HouseholdConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        initialTab={configInitialTab}
      />

      {/* BUDGET MANAGER MODAL */}
      <BudgetManagerModal
        isOpen={isBudgetModalOpen}
        onClose={() => setIsBudgetModalOpen(false)}
        currentDate={currentDate}
        existingBudget={currentBudgetDoc}
        allBudgets={budgets}
      />

      {/* TRANSACTION DETAIL & RECEIPT INSPECTION MODAL */}
      <Modal
        isOpen={Boolean(inspectingTx)}
        onClose={() => setInspectingTx(null)}
        title="Detalle del Movimiento"
      >
        {inspectingTx && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div
                style={{
                  fontSize: '26px',
                  fontWeight: 800,
                  color:
                    inspectingTx.type === 'income' ? 'var(--color-success)' : 'var(--color-error)',
                }}
              >
                {inspectingTx.type === 'income' ? '+' : '-'}
                {formatCOP(inspectingTx.amount)}
              </div>
              <div style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px' }}>
                {inspectingTx.place || inspectingTx.description || inspectingTx.category}
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-surface-container-low)',
                fontSize: '13px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div>
                <strong>Categoría:</strong> {inspectingTx.category}
              </div>
              <div>
                <strong>Ámbito:</strong>{' '}
                {resolveTxScope(inspectingTx) === 'conjunto' ? 'Conjunto (Hogar)' : 'Personal'}
              </div>
              <div>
                <strong>Pagado / Registrado por:</strong>{' '}
                {inspectingTx.paidByName || inspectingTx.ownerName || 'Miembro del hogar'}
              </div>
              {inspectingTx.paymentMethodAlias && (
                <div>
                  <strong>Método de pago:</strong> {inspectingTx.paymentMethodAlias}
                </div>
              )}
              {inspectingTx.note && (
                <div>
                  <strong>Nota:</strong> {inspectingTx.note}
                </div>
              )}
            </div>

            {inspectingTx.attachments && inspectingTx.attachments.length > 0 && (
              <div>
                <span className="text-label-sm">Comprobante(s) adjuntos:</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                  {inspectingTx.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.secureUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'block', borderRadius: '12px', overflow: 'hidden' }}
                    >
                      <img
                        src={att.secureUrl}
                        alt="Comprobante"
                        style={{ width: '100%', maxHeight: '300px', objectFit: 'contain' }}
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <Button
                type="button"
                variant="secondary"
                fullWidth
                onClick={() => {
                  const tx = inspectingTx;
                  setInspectingTx(null);
                  setEditingTx(tx);
                  setIsQuickModalOpen(true);
                }}
              >
                Editar
              </Button>
              <Button
                type="button"
                variant="danger"
                fullWidth
                onClick={() => {
                  const tx = inspectingTx;
                  setInspectingTx(null);
                  setTxToDelete(tx);
                }}
              >
                Eliminar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* SOFT DELETE CONFIRMATION MODAL */}
      <Modal
        isOpen={Boolean(txToDelete)}
        onClose={() => !isDeletingTx && setTxToDelete(null)}
        title="Eliminar Movimiento"
      >
        <p className="text-body-md" style={{ margin: '12px 0 20px', color: 'var(--color-on-surface-variant)' }}>
          ¿Confirmas eliminar este movimiento? Se aplicará eliminación lógica (soft delete) y se actualizará el balance del hogar.
        </p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Button type="button" variant="ghost" fullWidth onClick={() => setTxToDelete(null)}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            fullWidth
            onClick={handleSoftDeleteTransaction}
            disabled={isDeletingTx}
          >
            {isDeletingTx ? 'Eliminando...' : 'Sí, eliminar'}
          </Button>
        </div>
      </Modal>

      {/* SETTLEMENT MODAL (RF-12) */}
      <Modal
        isOpen={isSettlementModalOpen}
        onClose={() => setIsSettlementModalOpen(false)}
        title="Registrar Liquidación en Pareja"
      >
        <form
          onSubmit={handleRecordSettlement}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}
        >
          <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            Registra el pago entre <strong>{partnerBalance?.debtorName}</strong> y{' '}
            <strong>{partnerBalance?.creditorName}</strong> para saldar los gastos conjuntos.
          </p>
          <Input
            label="Monto a liquidar ($)"
            value={settlementAmount}
            onChange={(e) => setSettlementAmount(formatInputCOP(e.target.value))}
            required
          />
          <Input
            label="Nota (Ej. Transferencia Nequi)"
            placeholder="Opcional..."
            value={settlementNote}
            onChange={(e) => setSettlementNote(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              onClick={() => setIsSettlementModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={isSavingSettlement}>
              {isSavingSettlement ? 'Guardando...' : 'Confirmar Pago'}
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
