'use client';
import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { SpeedDial } from '@/components/ui/SpeedDial';
import { ScopeFilterBar } from '@/components/ui/ScopeFilterBar';
import { QuickMovementModal } from '@/components/finanzas/QuickMovementModal';
import { HouseholdConfigModal } from '@/components/finanzas/HouseholdConfigModal';
import { BudgetManagerModal } from '@/components/finanzas/BudgetManagerModal';
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Settings,
  UserPlus,
  PiggyBank,
  AlertTriangle,
  Search,
  CreditCard,
  Image as ImageIcon,
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
  or,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { formatCOP } from '@/lib/currency';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import {
  BudgetDoc,
  EnhancedTransaction,
  Scope,
} from '@/lib/models';
import {
  getPeriodKey,
  TriggeredBudgetAlert,
} from '@/lib/budgetEngine';
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

export default function Finanzas() {
  const { user, loading } = useAuth();
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
  const [recurringPayments, setRecurringPayments] = useState<any[]>([]);
  const [savings, setSavings] = useState<SavingGoal[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Period navigation (Month + Quincena filter)
  const [currentDate, setCurrentDate] = useState(new Date());
  const [quincenaFilter, setQuincenaFilter] = useState<'all' | 'q1' | 'q2'>('all');

  // Ledger search & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [selectedMethodFilter, setSelectedMethodFilter] = useState('');
  const [showRunningBalance, setShowRunningBalance] = useState(false);
  const [visibleDaysLimit, setVisibleDaysLimit] = useState(15);

  // Modals state
  const [isQuickModalOpen, setIsQuickModalOpen] = useState(false);
  const [quickModalType, setQuickModalType] = useState<'expense' | 'income'>('expense');
  const [editingTx, setEditingTx] = useState<EnhancedTransaction | null>(null);

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configInitialTab, setConfigInitialTab] = useState<
    'hogar' | 'metodos' | 'catalogo' | 'lugares' | 'ingresos'
  >('metodos');

  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);

  // Alert banner state
  const [recentAlerts, setRecentAlerts] = useState<TriggeredBudgetAlert[]>([]);

  // Soft delete & receipt inspection modals
  const [txToDelete, setTxToDelete] = useState<EnhancedTransaction | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);
  const [inspectingTx, setInspectingTx] = useState<EnhancedTransaction | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

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

    const txRef = collection(db, 'transactions');
    const qTx = query(txRef, buildOwnerFilter());

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
    const qBudget = query(budgetRef, buildOwnerFilter());
    const unsubBudgets = onSnapshot(qBudget, (snapshot) => {
      const list: BudgetDoc[] = [];
      snapshot.forEach((d) => list.push({ id: d.id, ...d.data() } as BudgetDoc));
      setBudgets(list);
    });

    const payRef = collection(db, 'recurringPayments');
    const qPay = query(payRef, buildOwnerFilter());
    const unsubPay = onSnapshot(qPay, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() }));
      setRecurringPayments(data);
    });

    const savRef = collection(db, 'savings');
    const qSav = query(savRef, buildOwnerFilter());
    const unsubSav = onSnapshot(qSav, (snapshot) => {
      const data: SavingGoal[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() } as SavingGoal));
      setSavings(data);
    });

    const debtRef = collection(db, 'debts');
    const qDebt = query(debtRef, buildOwnerFilter());
    const unsubDebt = onSnapshot(qDebt, (snapshot) => {
      const data: Debt[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() } as Debt));
      setDebts(data);
    });

    return () => {
      unsubTx();
      unsubBudgets();
      unsubPay();
      unsubSav();
      unsubDebt();
    };
  }, [user, partnerUid, household?.id]);

  const getMonthName = (date: Date) =>
    date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const nextMonth = () =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const prevMonth = () =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

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
    selectedMethodFilter,
    searchQuery,
    user,
    partnerUid,
  ]);

  const totalIncome = periodTransactions
    .filter((t) => t.type === 'income')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const totalExpense = periodTransactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const balance = totalIncome - totalExpense;

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

  // Group ledger movements by day with daily total and optional running balance
  const groupedLedgerDays = useMemo(() => {
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

  if (loading || !user || !isReady) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando centro financiero..." />
      </main>
    );
  }

  const scopedSavings = savings.filter((s: any) => {
    const sScope = s.scope || (s.sharedWith && s.sharedWith.length > 0 ? 'conjunto' : 'personal');
    if (globalScope === 'mio') return s.ownerId === user.uid;
    if (globalScope === 'pareja' && partnerUid) return s.ownerId === partnerUid;
    if (globalScope === 'conjunto') return sScope === 'conjunto';
    return true;
  });

  const totalSavingsTarget = scopedSavings.reduce((sum, s) => sum + Number(s.targetAmount || 0), 0);
  const totalSavingsCurrent = scopedSavings.reduce((sum, s) => sum + Number(s.currentAmount || 0), 0);
  const overallSavingsProgress =
    totalSavingsTarget > 0
      ? Math.min(100, Math.round((totalSavingsCurrent / totalSavingsTarget) * 100))
      : 0;

  const scopedDebts = debts.filter((d: any) => {
    const dScope = d.scope || (d.sharedWith && d.sharedWith.length > 0 ? 'conjunto' : 'personal');
    if (globalScope === 'mio') return d.ownerId === user.uid;
    if (globalScope === 'pareja' && partnerUid) return d.ownerId === partnerUid;
    if (globalScope === 'conjunto') return dScope === 'conjunto';
    return true;
  });
  const totalDebtTarget = scopedDebts.reduce((sum, d) => sum + Number(d.targetAmount || 0), 0);
  const totalDebtPaid = scopedDebts.reduce((sum, d) => sum + Number(d.currentAmount || 0), 0);
  const totalDebtRemaining = Math.max(0, totalDebtTarget - totalDebtPaid);

  return (
    <main className={`container ${styles.main}`}>
      {/* TOP HEADER */}
      <header className={styles.header}>
        <Link href="/">
          <Button variant="ghost" className={styles.iconBtn}>
            <ArrowLeft size={20} />
          </Button>
        </Link>
        <div
          className={styles.titleContainer}
          style={{
            flex: 1,
            overflow: 'hidden',
            marginLeft: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <h1 className="text-headline-sm" style={{ margin: 0, fontSize: '18px' }}>
            Finanzas
          </h1>
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
            <UserPlus size={19} color="var(--color-primary)" />
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
            <CreditCard size={19} />
          </Button>
          <Button
            variant="ghost"
            className={styles.iconBtn}
            onClick={() => {
              setConfigInitialTab('catalogo');
              setIsConfigModalOpen(true);
            }}
            title="Categorías, Tags y Comercios"
          >
            <Settings size={19} />
          </Button>
        </div>
      </header>

      {/* GLOBAL SCOPE SELECTOR (Mío · Conjunto · Todo · Pareja) */}
      <div>
        <ScopeFilterBar compact />
      </div>

      {/* MONTH + QUINCENA SELECTOR COMPACTO */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
          backgroundColor: 'var(--color-surface-container-lowest)',
          padding: '4px 8px',
          borderRadius: '9999px',
          border: '1px solid var(--color-surface-container)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <Button variant="ghost" className={styles.iconBtn} onClick={prevMonth}>
            <ChevronLeft size={16} />
          </Button>
          <span
            style={{
              fontWeight: 600,
              fontSize: '12px',
              textTransform: 'capitalize',
              minWidth: '100px',
              textAlign: 'center',
            }}
          >
            {getMonthName(currentDate)}
          </span>
          <Button variant="ghost" className={styles.iconBtn} onClick={nextMonth}>
            <ChevronRight size={16} />
          </Button>
        </div>

        <div
          style={{
            display: 'inline-flex',
            background: 'var(--color-surface-container)',
            borderRadius: '9999px',
            padding: '2px',
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
                padding: '4px 10px',
                borderRadius: '9999px',
                fontSize: '11px',
                fontWeight: quincenaFilter === q.id ? 600 : 500,
                backgroundColor:
                  quincenaFilter === q.id ? 'var(--color-surface-container-lowest)' : 'transparent',
                color:
                  quincenaFilter === q.id
                    ? 'var(--color-primary)'
                    : 'var(--color-on-surface-variant)',
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* DISPARO DE ALERTAS DE PRESUPUESTO RECIENTES */}
      {recentAlerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {recentAlerts.map((al) => (
            <div
              key={al.alertKey}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: '12px',
                backgroundColor:
                  al.severity === 'danger'
                    ? 'rgba(239, 68, 68, 0.12)'
                    : 'rgba(245, 158, 11, 0.14)',
                border: `1px solid ${
                  al.severity === 'danger' ? 'var(--color-error)' : 'var(--color-warning)'
                }`,
                color: 'var(--color-on-surface)',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <AlertTriangle
                  size={16}
                  color={al.severity === 'danger' ? 'var(--color-error)' : 'var(--color-warning)'}
                  style={{ flexShrink: 0, marginTop: '2px' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '12px' }}>{al.title}</div>
                  <div style={{ fontSize: '11px' }}>{al.message}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setRecentAlerts((prev) => prev.filter((x) => x.alertKey !== al.alertKey))
                }
                style={{ fontSize: '14px', fontWeight: 700, padding: '0 4px' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* SUMMARY BALANCE CARD COMPACTA */}
      <section>
        <div className={styles.balanceCard}>
          <span className={styles.balanceTitle}>
            Balance General ({globalScope.toUpperCase()})
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
              gap: '10px',
              width: '100%',
              marginTop: '6px',
              paddingTop: '8px',
              borderTop: '1px solid var(--color-outline-variant)',
              textAlign: 'center',
            }}
          >
            <div>
              <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Ingresos (+)
              </span>
              <div
                style={{
                  fontWeight: 700,
                  color: 'var(--color-success)',
                  fontSize: '14px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(totalIncome)}
              </div>
            </div>
            <div style={{ borderLeft: '1px solid var(--color-outline-variant)' }}>
              <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Gastos y Abonos (-)
              </span>
              <div
                style={{
                  fontWeight: 700,
                  color: 'var(--color-error)',
                  fontSize: '14px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(totalExpense)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BLOQUES PRINCIPALES DESTACADOS: METAS DE AHORRO Y DEUDAS DE TARJETAS */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Link href="/finanzas/metas" style={{ textDecoration: 'none' }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
              color: '#FFFFFF',
              boxShadow: '0 6px 16px rgba(5, 150, 105, 0.22)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: '92px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  opacity: 0.92,
                }}
              >
                Metas Ahorro
              </span>
              <PiggyBank size={16} color="#FFFFFF" />
            </div>
            <div
              style={{
                fontSize: '16px',
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                marginTop: '4px',
              }}
            >
              {formatCOP(totalSavingsCurrent)}
            </div>
            <div style={{ fontSize: '11px', opacity: 0.9, marginTop: '2px' }}>
              Avance: <strong>{overallSavingsProgress}%</strong> ({scopedSavings.length} metas) →
            </div>
          </div>
        </Link>

        <Link href="/finanzas/deudas" style={{ textDecoration: 'none' }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #DC2626 0%, #991B1B 100%)',
              color: '#FFFFFF',
              boxShadow: '0 6px 16px rgba(220, 38, 38, 0.24)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: '92px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  opacity: 0.92,
                }}
              >
                Deudas Tarjetas
              </span>
              <CreditCard size={16} color="#FFFFFF" />
            </div>
            <div
              style={{
                fontSize: '16px',
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                marginTop: '4px',
              }}
            >
              {formatCOP(totalDebtRemaining)}
            </div>
            <div style={{ fontSize: '11px', opacity: 0.9, marginTop: '2px' }}>
              Abonado: <strong>{formatCOP(totalDebtPaid)}</strong> →
            </div>
          </div>
        </Link>
      </section>

      {/* EXTRACTO DE MOVIMIENTOS COMPACTO */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Quick Search & Filter Row */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '10px 12px',
            borderRadius: '12px',
            backgroundColor: 'var(--color-surface-container-lowest)',
            boxShadow: 'var(--shadow-level-1)',
          }}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: '9999px',
                backgroundColor: 'var(--color-surface-container-low)',
              }}
            >
              <Search size={15} color="var(--color-on-surface-variant)" />
              <input
                type="text"
                placeholder="Buscar comercio, categoría, #tag o nota..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  width: '100%',
                  fontSize: '12px',
                  outline: 'none',
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowRunningBalance(!showRunningBalance)}
              style={{
                padding: '6px 10px',
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '9999px',
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
                padding: '6px 10px',
                borderRadius: '9999px',
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
          <Card style={{ textAlign: 'center', padding: '24px 16px' }}>
            <Wallet
              size={28}
              color="var(--color-on-surface-variant)"
              style={{ margin: '0 auto 6px' }}
            />
            <h4 className="text-body-lg" style={{ fontWeight: 600 }}>
              Sin movimientos en este corte
            </h4>
            <p
              className="text-body-sm"
              style={{ color: 'var(--color-on-surface-variant)', marginTop: '2px' }}
            >
              Usa el botón &quot;+&quot; para registrar un gasto o ingreso rápidamente.
            </p>
          </Card>
        ) : (
          groupedLedgerDays.slice(0, visibleDaysLimit).map((dayGroup) => (
            <div
              key={dayGroup.dateKey}
              style={{
                backgroundColor: 'var(--color-surface-container-lowest)',
                borderRadius: '12px',
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
                  padding: '8px 12px',
                  backgroundColor: 'var(--color-surface-container-low)',
                  borderBottom: '1px solid var(--color-outline-variant)',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                }}
              >
                <span>{dayGroup.dateLabel}</span>
                <span
                  style={{
                    color:
                      dayGroup.dailyNet >= 0
                        ? 'var(--color-success)'
                        : 'var(--color-on-surface-variant)',
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
                    (t.ownerId === user.uid
                      ? 'Yo'
                      : t.ownerName || partner?.displayName || 'Pareja');
                  return (
                    <div
                      key={t.id}
                      onClick={() => setInspectingTx(t)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 12px',
                        borderBottom: '1px solid var(--color-surface-container)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                        <div
                          className={`${styles.iconWrapper} ${
                            t.type === 'income' ? styles.iconIncome : styles.iconExpense
                          }`}
                          style={{ width: '34px', height: '34px', flexShrink: 0 }}
                        >
                          {t.type === 'income' ? (
                            <ArrowUpRight size={18} />
                          ) : (
                            <ArrowDownRight size={18} />
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span style={{ fontWeight: 600, fontSize: '13px' }}>
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
                              <ImageIcon size={12} color="var(--color-primary)" />
                            )}
                          </div>

                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--color-on-surface-variant)',
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '4px',
                            }}
                          >
                            <span>{t.category}</span>
                            <span>• {payerName}</span>
                            {t.paymentMethodAlias && <span>• {t.paymentMethodAlias}</span>}
                          </div>

                          {t.tags && t.tags.length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                gap: '4px',
                                flexWrap: 'wrap',
                                marginTop: '2px',
                              }}
                            >
                              {t.tags.map((tg) => (
                                <span
                                  key={tg}
                                  style={{
                                    fontSize: '10px',
                                    color: 'var(--color-primary)',
                                    backgroundColor: 'var(--color-primary-container)',
                                    padding: '1px 6px',
                                    borderRadius: '999px',
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
                            fontSize: '13px',
                            fontVariantNumeric: 'tabular-nums',
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
      </section>

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
        <p
          className="text-body-md"
          style={{ margin: '12px 0 20px', color: 'var(--color-on-surface-variant)' }}
        >
          ¿Confirmas eliminar este movimiento? Se aplicará eliminación lógica (soft delete) y se
          actualizará el balance del hogar.
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
    </main>
  );
}
