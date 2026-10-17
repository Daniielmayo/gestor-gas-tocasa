'use client';
import React, { useState, useEffect, useMemo, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ScopeFilterBar } from '@/components/ui/ScopeFilterBar';
import { FixedCashflowWorksheet } from '@/components/finanzas/FixedCashflowWorksheet';
import { QuickMovementModal } from '@/components/finanzas/QuickMovementModal';
import { BudgetManagerModal } from '@/components/finanzas/BudgetManagerModal';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import {
  ArrowLeft,
  Calendar,
  Trash2,
  Pencil,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Plus,
  Receipt,
  Layers,
  Table2,
  Target,
  CreditCard,
} from 'lucide-react';
import styles from './recurrentes.module.css';
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
  doc,
  updateDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import {
  BudgetDoc,
  EnhancedTransaction,
  Scope,
  UserPeriodWorksheet,
} from '@/lib/models';
import { evaluateBudgetStatus } from '@/lib/budgetEngine';

interface RecurringItem {
  id: string;
  flowType?: 'expense' | 'income';
  scope?: Scope;
  title: string;
  amount: number;
  days: number[];
  ownerId: string;
  sharedWith?: string[];
  category?: string;
  description?: string;
}

const EXPENSE_RECURRING_CATS = [
  'Hogar / Alquiler',
  'Servicios',
  'Streaming / Suscripciones',
  'Salud',
  'Educación',
  'Transporte',
  'Pago Deuda / Tarjeta',
];

const INCOME_RECURRING_CATS = [
  'Sueldo / Quincena',
  'Arriendo Recibido',
  'Freelance / Extra',
];

type PagosTab = 'planilla' | 'esporadicos' | 'unificado' | 'plantillas';

export default function RecurringPayments() {
  const { user, profile, loading } = useAuth();
  const { household, partner, partnerUid, globalScope, paymentMethods } = useHousehold();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  // Main navigation inside Pagos (default 'all' = Todos, filterable by Quincena)
  const [activeTab, setActiveTab] = useState<PagosTab>('planilla');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [quincenaFilter, setQuincenaFilter] = useState<'all' | 'q1' | 'q2'>('all');

  // Data collections
  const [payments, setPayments] = useState<RecurringItem[]>([]);
  const [transactions, setTransactions] = useState<EnhancedTransaction[]>([]);
  const [worksheets, setWorksheets] = useState<UserPeriodWorksheet[]>([]);
  const [budgets, setBudgets] = useState<BudgetDoc[]>([]);
  const [paidPaymentIds, setPaidPaymentIds] = useState<Set<string>>(new Set());

  // Quick Sporadic Payment Modal
  const [isQuickSporadicOpen, setIsQuickSporadicOpen] = useState(false);
  const [editingSporadicTx, setEditingSporadicTx] = useState<EnhancedTransaction | null>(null);

  // Category/Tag Budget Modal (moved here from Finanzas)
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);

  // Recurring template form state
  const [flowType, setFlowType] = useState<'expense' | 'income'>('expense');
  const [scope, setScope] = useState<Scope>('personal');
  const [selectedDays, setSelectedDays] = useState<number[]>([15, 30]);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(EXPENSE_RECURRING_CATS[0]);
  const [description, setDescription] = useState('');
  const [filterDay, setFilterDay] = useState<number | 'all'>('all');

  // Modals for templates
  const [selectedPayment, setSelectedPayment] = useState<RecurringItem | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState(EXPENSE_RECURRING_CATS[0]);
  const [editDescription, setEditDescription] = useState('');
  const [editSelectedDays, setEditSelectedDays] = useState<number[]>([]);
  const [editScope, setEditScope] = useState<Scope>('personal');

  // Confirm / Adjust occurrence modal
  const [confirmingItem, setConfirmingItem] = useState<RecurringItem | null>(null);
  const [confirmAdjustedAmount, setConfirmAdjustedAmount] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    // 1. Recurring Templates
    const paymentsRef = collection(db, 'recurringPayments');
    const qRec = query(
      paymentsRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubRec = onSnapshot(qRec, (snapshot) => {
      const data: RecurringItem[] = [];
      snapshot.forEach((d) => {
        data.push({ id: d.id, ...d.data() } as RecurringItem);
      });
      setPayments(data);
    });

    // 2. Transactions (Sporadic payments & incomes)
    const txRef = collection(db, 'transactions');
    const qTx = query(
      txRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const paidIds = new Set<string>();
      const txList: EnhancedTransaction[] = [];
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      snapshot.forEach((d) => {
        const raw = d.data() as EnhancedTransaction;
        txList.push({ ...raw, id: d.id });
        if (raw.deletedAt) return;
        if (raw.recurringPaymentId && raw.createdAt) {
          const date = raw.createdAt.toDate ? raw.createdAt.toDate() : new Date();
          if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
            paidIds.add(raw.recurringPaymentId);
          }
        }
      });
      setTransactions(txList);
      setPaidPaymentIds(paidIds);
    });

    // 3. Period Worksheets (for Unified view)
    const wsRef = collection(db, 'periodWorksheets');
    const qWs = query(
      wsRef,
      or(where('userId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubWs = onSnapshot(qWs, (snap) => {
      const list: UserPeriodWorksheet[] = [];
      snap.forEach((d) => list.push({ ...(d.data() as UserPeriodWorksheet), id: d.id }));
      setWorksheets(list);
    });

    // 4. Category/Tag Budgets
    const bRef = collection(db, 'budgets');
    const qB = query(
      bRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubB = onSnapshot(qB, (snap) => {
      const list: BudgetDoc[] = [];
      snap.forEach((d) => list.push({ ...(d.data() as BudgetDoc), id: d.id }));
      setBudgets(list);
    });

    return () => {
      unsubRec();
      unsubTx();
      unsubWs();
      unsubB();
    };
  }, [user]);

  const prevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const monthLabel = useMemo(() => {
    return currentDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  }, [currentDate]);

  const periodKey = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, '0');
    if (quincenaFilter === 'q1') return `${y}-${m}-Q1`;
    if (quincenaFilter === 'q2') return `${y}-${m}-Q2`;
    return `${y}-${m}`;
  }, [currentDate, quincenaFilter]);

  // Transactions in selected month & quincena
  const periodTransactions = useMemo(() => {
    const m = currentDate.getMonth();
    const y = currentDate.getFullYear();

    return transactions.filter((t) => {
      if (t.deletedAt) return false;
      const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
      if (d.getMonth() !== m || d.getFullYear() !== y) return false;
      const day = d.getDate();
      if (quincenaFilter === 'q1' && day > 15) return false;
      if (quincenaFilter === 'q2' && day <= 15) return false;
      return true;
    });
  }, [transactions, currentDate, quincenaFilter]);

  // Scope-filtered Sporadic / Extra Payments (outside fixed worksheet)
  const sporadicExpenses = useMemo(() => {
    return periodTransactions
      .filter((t) => t.type === 'expense' && !t.recurringPaymentId)
      .filter((t) => {
        const txScope: Scope =
          t.scope || (t.sharedWith && t.sharedWith.length > 0 ? 'conjunto' : 'personal');
        const payer = t.paidByUserId || t.ownerId;
        if (globalScope === 'mio') return payer === user?.uid;
        if (globalScope === 'pareja' && partnerUid) return payer === partnerUid;
        if (globalScope === 'conjunto') return txScope === 'conjunto';
        return true;
      })
      .sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const dbTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return dbTime - da;
      });
  }, [periodTransactions, globalScope, user?.uid, partnerUid]);

  // Unified items (Fixed Worksheet Obligations + Sporadic Payments)
  const unifiedItems = useMemo(() => {
    const items: Array<{
      id: string;
      kind: 'fijo' | 'esporadico';
      title: string;
      amount: number;
      ownerName: string;
      ownerId: string;
      categoryOrStatus: string;
      paid: boolean;
      dateLabel: string;
      rawTx?: EnhancedTransaction;
    }> = [];

    // 1. Add Fixed Obligations from Worksheets matching current periodKey (or Q1+Q2 when 'all') and scope
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, '0');
    const ymPrefix = `${y}-${m}`;

    const relevantWorksheets = worksheets.filter((w) => {
      const matchesPeriod =
        quincenaFilter === 'all'
          ? w.periodKey === `${ymPrefix}-Q1` ||
            w.periodKey === `${ymPrefix}-Q2` ||
            w.periodKey === ymPrefix
          : w.periodKey === periodKey;
      if (!matchesPeriod) return false;
      if (globalScope === 'mio') return w.userId === user?.uid;
      if (globalScope === 'pareja' && partnerUid) return w.userId === partnerUid;
      return true;
    });

    for (const ws of relevantWorksheets) {
      const qLabel = ws.periodKey.endsWith('-Q1')
        ? '1ª Quincena (15)'
        : ws.periodKey.endsWith('-Q2')
        ? '2ª Quincena (30)'
        : ws.periodKey;
      for (const ob of ws.obligations || []) {
        items.push({
          id: `ws_${ws.periodKey}_${ws.userId}_${ob.id}`,
          kind: 'fijo',
          title: ob.concept,
          amount: Number(ob.amount || 0),
          ownerName: ws.userName || (ws.userId === user?.uid ? 'Mío' : 'Pareja'),
          ownerId: ws.userId,
          categoryOrStatus: ob.amount < 0 ? 'Ahorro / Descuento Fijo' : 'Presupuesto Fijo',
          paid: Boolean(ob.paid),
          dateLabel: qLabel,
        });
      }
    }

    // 2. Add Sporadic / Extra Payments
    for (const tx of sporadicExpenses) {
      const d = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date();
      items.push({
        id: tx.id,
        kind: 'esporadico',
        title: tx.place || tx.title || tx.description || tx.category,
        amount: Number(tx.amount || 0),
        ownerName: tx.paidByName || tx.ownerName || 'Miembro',
        ownerId: tx.paidByUserId || tx.ownerId,
        categoryOrStatus: tx.category || 'Gasto Esporádico',
        paid: true,
        dateLabel: d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }),
        rawTx: tx,
      });
    }

    return items;
  }, [worksheets, periodKey, globalScope, user?.uid, partnerUid, sporadicExpenses]);

  const totalUnifiedFixed = useMemo(
    () =>
      unifiedItems
        .filter((i) => i.kind === 'fijo')
        .reduce((sum, i) => sum + i.amount, 0),
    [unifiedItems]
  );

  const totalUnifiedSporadic = useMemo(
    () =>
      unifiedItems
        .filter((i) => i.kind === 'esporadico')
        .reduce((sum, i) => sum + i.amount, 0),
    [unifiedItems]
  );

  // Category/Tag Budget Status (optional complement inside Planilla)
  const currentBudgetDoc = useMemo(() => {
    const targetScope: Scope = globalScope === 'mio' || globalScope === 'pareja' ? 'personal' : 'conjunto';
    return (
      budgets.find((b) => b.periodKey === periodKey && b.scope === targetScope) ||
      budgets.find((b) => b.periodKey === periodKey) ||
      null
    );
  }, [budgets, periodKey, globalScope]);

  const currentBudgetStatus = useMemo(() => {
    if (!currentBudgetDoc || !user) return null;
    return evaluateBudgetStatus(currentBudgetDoc, periodTransactions, user.uid);
  }, [currentBudgetDoc, periodTransactions, user]);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const applyQuickQuincena = () => {
    setSelectedDays([15, 30]);
  };

  const handleSavePayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !title.trim() || !amount.trim() || selectedDays.length === 0) {
      alert('Por favor completa el nombre, monto y selecciona al menos un día del mes.');
      return;
    }

    try {
      const sharedWithArray = scope === 'conjunto' && partnerUid ? [partnerUid] : [];
      const paymentData = {
        householdId: household?.id || 'default',
        flowType,
        scope,
        title: title.trim(),
        amount: parseCOP(amount),
        days: selectedDays.sort((a, b) => a - b),
        ownerId: user.uid,
        sharedWith: sharedWithArray,
        category,
        description: description.trim(),
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'recurringPayments'), paymentData);

      setTitle('');
      setAmount('');
      setSelectedDays([15, 30]);
      setDescription('');
    } catch (error) {
      console.error('Error al guardar programación:', error);
    }
  };

  const handleConfirmOccurrence = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !confirmingItem || isConfirming) return;
    const finalAmt = parseCOP(confirmAdjustedAmount);
    if (finalAmt <= 0) return;

    setIsConfirming(true);
    try {
      const isIncome = confirmingItem.flowType === 'income';
      const itemScope: Scope =
        confirmingItem.scope ||
        (confirmingItem.sharedWith && confirmingItem.sharedWith.length > 0
          ? 'conjunto'
          : 'personal');

      await addDoc(collection(db, 'transactions'), {
        type: isIncome ? 'income' : 'expense',
        amount: finalAmt,
        category: confirmingItem.category || (isIncome ? 'Sueldo / Quincena' : 'Servicios'),
        place: confirmingItem.title,
        title: confirmingItem.title,
        description: confirmingItem.description || confirmingItem.title,
        scope: itemScope,
        incomeType: isIncome ? 'fijo' : undefined,
        paidByUserId: user.uid,
        paidByName: profile.displayName?.split(' ')[0] || 'Yo',
        recurringPaymentId: confirmingItem.id,
        recurringPaymentTitle: confirmingItem.title,
        ownerId: user.uid,
        ownerName: profile.displayName?.split(' ')[0] || 'Usuario',
        sharedWith: itemScope === 'conjunto' && partnerUid ? [partnerUid] : [],
        deletedAt: null,
        createdAt: Timestamp.now(),
      });

      setConfirmingItem(null);
      setConfirmAdjustedAmount('');
    } catch (err) {
      console.error('Error confirming recurring occurrence:', err);
    } finally {
      setIsConfirming(false);
    }
  };

  const openEditModal = (payment: RecurringItem) => {
    setSelectedPayment(payment);
    setEditTitle(payment.title);
    setEditAmount(formatInputCOP(String(payment.amount)));
    setEditCategory(payment.category || EXPENSE_RECURRING_CATS[0]);
    setEditDescription(payment.description || '');
    setEditSelectedDays(payment.days || []);
    setEditScope(
      payment.scope || (payment.sharedWith && payment.sharedWith.length > 0 ? 'conjunto' : 'personal')
    );
    setIsEditModalOpen(true);
  };

  const handleEditPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !selectedPayment ||
      !user ||
      !editTitle.trim() ||
      !editAmount.trim() ||
      editSelectedDays.length === 0
    ) {
      return;
    }

    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'recurringPayments', selectedPayment.id), {
        title: editTitle.trim(),
        amount: parseCOP(editAmount),
        days: editSelectedDays.sort((a, b) => a - b),
        category: editCategory,
        description: editDescription.trim(),
        scope: editScope,
        sharedWith: editScope === 'conjunto' && partnerUid ? [partnerUid] : [],
      });
      setIsEditModalOpen(false);
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeletePayment = async () => {
    if (!selectedPayment) return;
    setIsProcessing(true);
    try {
      await deleteDoc(doc(db, 'recurringPayments', selectedPayment.id));
      setIsDeleteModalOpen(false);
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando Pagos y Presupuesto..." />
      </main>
    );
  }

  const filteredPayments = payments
    .filter((p) => (filterDay === 'all' ? true : p.days.includes(filterDay)))
    .filter((p) => {
      const pScope: Scope =
        p.scope || (p.sharedWith && p.sharedWith.length > 0 ? 'conjunto' : 'personal');
      if (globalScope === 'mio') return p.ownerId === user.uid;
      if (globalScope === 'conjunto') return pScope === 'conjunto';
      if (globalScope === 'pareja' && partnerUid) return p.ownerId === partnerUid;
      return true;
    });

  return (
    <main className={`container ${styles.main}`} style={{ paddingBottom: '100px' }}>
      <header className={styles.appBar}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link href="/">
              <Button variant="ghost" className={styles.iconBtn}>
                <ArrowLeft size={24} />
              </Button>
            </Link>
            <div>
              <h1 className="text-headline-sm" style={{ margin: 0 }}>
                Pagos y Presupuesto
              </h1>
              <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Planilla Fijos · Pagos Esporádicos · Unificado
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {partner && (
              <AvatarGroup
                users={[usersMap[user.uid], usersMap[partner.uid]].filter(Boolean) as any}
                size="sm"
              />
            )}
            <Link href="/finanzas/deudas">
              <Button variant="secondary" size="sm" title="Deudas de Tarjetas y Abonos">
                <CreditCard size={15} style={{ marginRight: '4px' }} /> Deudas TC
              </Button>
            </Link>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingSporadicTx(null);
                setIsQuickSporadicOpen(true);
              }}
            >
              <Plus size={15} style={{ marginRight: '4px' }} /> Pago Extra
            </Button>
          </div>
        </div>
      </header>

      {/* Filtro Global (Mío por defecto · Conjunto · Todo · Pareja) */}
      <div style={{ marginBottom: '12px' }}>
        <ScopeFilterBar />
      </div>

      {/* Selector de Mes y Corte Quincenal */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '14px',
          flexWrap: 'wrap',
          backgroundColor: 'var(--color-surface-container-lowest)',
          padding: '8px 12px',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-level-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Button variant="ghost" className={styles.iconBtn} onClick={prevMonth}>
            <ChevronLeft size={20} />
          </Button>
          <span
            style={{
              fontWeight: 700,
              fontSize: '14px',
              textTransform: 'capitalize',
              minWidth: '120px',
              textAlign: 'center',
            }}
          >
            {monthLabel}
          </span>
          <Button variant="ghost" className={styles.iconBtn} onClick={nextMonth}>
            <ChevronRight size={20} />
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
            { id: 'all', label: 'Todos (Mes)' },
            { id: 'q1', label: '1ª Qna (15)' },
            { id: 'q2', label: '2ª Qna (30)' },
          ].map((q) => {
            const active = quincenaFilter === q.id;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setQuincenaFilter(q.id as 'all' | 'q1' | 'q2')}
                style={{
                  padding: '6px 10px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: active ? 600 : 500,
                  backgroundColor: active
                    ? 'var(--color-surface-container-lowest)'
                    : 'transparent',
                  color: active
                    ? 'var(--color-primary)'
                    : 'var(--color-on-surface-variant)',
                  boxShadow: active ? 'var(--shadow-level-1)' : 'none',
                }}
              >
                {q.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pestañas principales de Pagos */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '6px',
          marginBottom: '16px',
        }}
      >
        {[
          { id: 'planilla', label: 'Presupuesto Fijo', icon: <Table2 size={15} /> },
          { id: 'esporadicos', label: 'Pagos Extras', icon: <Receipt size={15} /> },
          { id: 'unificado', label: 'Unificado', icon: <Layers size={15} /> },
          { id: 'plantillas', label: 'Programar Fijos', icon: <Calendar size={15} /> },
        ].map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as PagosTab)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '10px 4px',
                borderRadius: '12px',
                fontSize: '11px',
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
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* =================================================================== */}
      {/* TAB 1: PLANILLA DE PRESUPUESTO FIJO VS VARIABLES (LIMPIA)           */}
      {/* =================================================================== */}
      {activeTab === 'planilla' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FixedCashflowWorksheet
            currentDate={currentDate}
            quincenaFilter={quincenaFilter}
            onChangeQuincenaFilter={setQuincenaFilter}
            periodTransactions={periodTransactions}
            recurringPayments={payments}
          />

          {/* Topes opcionales por Categoría / #Tag */}
          <Card style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Target size={18} color="var(--color-primary)" />
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>
                    Topes de Alerta por Categoría / #Tag
                  </h4>
                  <p style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', margin: 0 }}>
                    Alertas automáticas al 80% y 100% en tus pagos esporádicos
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setIsBudgetModalOpen(true)}>
                {currentBudgetDoc ? 'Editar Topes' : '+ Configurar'}
              </Button>
            </div>

            {currentBudgetStatus && currentBudgetStatus.lineStatuses.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                {currentBudgetStatus.lineStatuses.map((line) => (
                  <div
                    key={line.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--color-surface-container-low)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}
                    >
                      <span>{line.targetType === 'tag' ? `#${line.targetName}` : line.targetName}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatCOP(line.spent)} / {formatCOP(line.budgeted)} ({line.percentage}%)
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '6px',
                        borderRadius: '999px',
                        backgroundColor: 'var(--color-surface-container)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, line.percentage)}%`,
                          height: '100%',
                          backgroundColor:
                            line.statusColor === 'red'
                              ? 'var(--color-error)'
                              : line.statusColor === 'yellow'
                              ? 'var(--color-warning)'
                              : 'var(--color-success)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 2: LISTA GENERAL DE PAGOS ESPORÁDICOS / EXTRAS (FUERA DE FIJOS) */}
      {/* =================================================================== */}
      {activeTab === 'esporadicos' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Card
            style={{
              padding: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Total Pagos Esporádicos / Extras ({globalScope.toUpperCase()})
              </span>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: 'var(--color-error)',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: '2px',
                }}
              >
                {formatCOP(totalUnifiedSporadic)}
              </div>
              <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                {sporadicExpenses.length} pagos fuera de la planilla fija en este periodo
              </span>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingSporadicTx(null);
                setIsQuickSporadicOpen(true);
              }}
            >
              + Registrar Pago
            </Button>
          </Card>

          {sporadicExpenses.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '32px 16px' }}>
              <Receipt size={32} color="var(--color-on-surface-variant)" style={{ margin: '0 auto 8px' }} />
              <h4 className="text-body-lg" style={{ fontWeight: 600 }}>
                Sin pagos esporádicos en este corte
              </h4>
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                Aquí verás todos los gastos o pagos extras que hagas por fuera de las obligaciones fijas del presupuesto.
              </p>
            </Card>
          ) : (
            <Card style={{ padding: '8px 16px' }}>
              {sporadicExpenses.map((tx, idx) => {
                const d = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date();
                const pm = paymentMethods.find((m) => m.id === tx.paymentMethodId);
                const isLast = idx === sporadicExpenses.length - 1;
                return (
                  <div
                    key={tx.id}
                    style={{
                      padding: '12px 0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      borderBottom: isLast ? 'none' : '1px solid var(--color-surface-container)',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setEditingSporadicTx(tx);
                      setIsQuickSporadicOpen(true);
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontWeight: 500,
                            fontSize: '14px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {tx.place || tx.title || tx.description || tx.category}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: 'var(--color-surface-container-low)',
                            color: 'var(--color-on-surface-variant)',
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          {tx.category}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span>{d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</span>
                        <span>• {tx.paidByName || tx.ownerName || 'Yo'}</span>
                        {(pm || tx.paymentMethodAlias) && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <CreditCard size={11} /> {pm?.alias || tx.paymentMethodAlias}
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        textAlign: 'right',
                        fontWeight: 600,
                        color: 'var(--color-error)',
                        fontSize: '14px',
                        fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0,
                      }}
                    >
                      -{formatCOP(Number(tx.amount || 0))}
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 3: VISTA GENERAL UNIFICADA (PRESUPUESTO FIJO + PAGOS EXTRAS)    */}
      {/* =================================================================== */}
      {activeTab === 'unificado' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Card style={{ padding: '16px' }}>
            <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              RESUMEN UNIFICADO: FIJOS + PAGOS ESPORÁDICOS ({globalScope.toUpperCase()})
            </span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginTop: '12px',
                padding: '12px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-surface-container-low)',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Presupuesto Fijo
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    marginTop: '2px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(totalUnifiedFixed)}
                </div>
              </div>
              <div
                style={{
                  borderLeft: '1px solid var(--color-outline-variant)',
                  paddingLeft: '10px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Esporádicos
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    marginTop: '2px',
                    color: 'var(--color-error)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(totalUnifiedSporadic)}
                </div>
              </div>
              <div
                style={{
                  borderLeft: '1px solid var(--color-outline-variant)',
                  paddingLeft: '10px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Gran Total
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    marginTop: '2px',
                    color: 'var(--color-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(totalUnifiedFixed + totalUnifiedSporadic)}
                </div>
              </div>
            </div>
          </Card>

          {unifiedItems.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '28px 16px' }}>
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                No hay obligaciones fijas ni pagos esporádicos registrados en este corte.
              </p>
            </Card>
          ) : (
            <Card style={{ padding: '8px 16px' }}>
              {unifiedItems.map((item, idx) => {
                const isFijo = item.kind === 'fijo';
                const isDiscount = item.amount < 0;
                const isLast = idx === unifiedItems.length - 1;
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '12px 0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      borderBottom: isLast ? 'none' : '1px solid var(--color-surface-container)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: isFijo
                              ? 'var(--color-primary-container)'
                              : 'rgba(239, 68, 68, 0.1)',
                            color: isFijo ? 'var(--color-primary-dark)' : 'var(--color-error)',
                            flexShrink: 0,
                          }}
                        >
                          {isFijo ? 'Fijo' : 'Esporádico'}
                        </span>
                        <span
                          style={{
                            fontWeight: 500,
                            fontSize: '14px',
                            textDecoration: isFijo && item.paid ? 'line-through' : 'none',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.title}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--color-on-surface-variant)',
                          marginTop: '2px',
                        }}
                      >
                        {item.ownerName} • {item.categoryOrStatus} • {item.dateLabel}
                      </div>
                    </div>

                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '14px',
                        fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0,
                        color: isDiscount
                          ? 'var(--color-success)'
                          : isFijo
                          ? 'var(--color-on-surface)'
                          : 'var(--color-error)',
                      }}
                    >
                      {formatCOP(item.amount)}
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 4: PLANTILLAS DE PROGRAMACIÓN QUINCENAL / MENSUAL               */}
      {/* =================================================================== */}
      {activeTab === 'plantillas' && (
        <section>
          <Card className={styles.formCard}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                background: 'var(--color-surface-container)',
                padding: '4px',
                borderRadius: '10px',
                marginBottom: '14px',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setFlowType('expense');
                  setCategory(EXPENSE_RECURRING_CATS[0]);
                }}
                style={{
                  padding: '8px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  backgroundColor: flowType === 'expense' ? 'var(--color-error)' : 'transparent',
                  color: flowType === 'expense' ? '#FFF' : 'var(--color-on-surface-variant)',
                }}
              >
                Obligación / Gasto Fijo
              </button>
              <button
                type="button"
                onClick={() => {
                  setFlowType('income');
                  setCategory(INCOME_RECURRING_CATS[0]);
                }}
                style={{
                  padding: '8px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  backgroundColor: flowType === 'income' ? 'var(--color-success)' : 'transparent',
                  color: flowType === 'income' ? '#FFF' : 'var(--color-on-surface-variant)',
                }}
              >
                Ingreso Fijo Quincenal
              </button>
            </div>

            <form className={styles.formGroup} onSubmit={handleSavePayment}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '10px' }}>
                <Input
                  label={flowType === 'income' ? 'Concepto (Ej. Quincena)' : 'Nombre Obligación'}
                  placeholder={flowType === 'income' ? 'Ej. Sueldo Quincenal' : 'Ej. Arriendo, Addi'}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
                <Input
                  label="Valor por Corte ($)"
                  placeholder="Ej. 1.500.000"
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(formatInputCOP(e.target.value))}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="text-label-sm">Categoría</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--color-outline-variant)',
                      backgroundColor: 'var(--color-surface-container-lowest)',
                      fontSize: '14px',
                      marginTop: '4px',
                    }}
                  >
                    {(flowType === 'income' ? INCOME_RECURRING_CATS : EXPENSE_RECURRING_CATS).map(
                      (cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="text-label-sm">Ámbito</label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as Scope)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--color-outline-variant)',
                      backgroundColor: 'var(--color-surface-container-lowest)',
                      fontSize: '14px',
                      marginTop: '4px',
                    }}
                  >
                    <option value="personal">Personal (Mío)</option>
                    <option value="conjunto">Conjunto (Hogar)</option>
                  </select>
                </div>
              </div>

              <div className={styles.frequencyGroup}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                  }}
                >
                  <label className="text-label-sm" style={{ color: 'var(--color-on-surface)' }}>
                    Días de corte (15 y 30 para Quincenal)
                  </label>
                  <button
                    type="button"
                    onClick={applyQuickQuincena}
                    style={{
                      fontSize: '11px',
                      color: 'var(--color-primary)',
                      fontWeight: 600,
                    }}
                  >
                    Marcar Quincena (15 y 30)
                  </button>
                </div>
                <div className={styles.dayGrid}>
                  {days.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={`${styles.dayButton} ${
                        selectedDays.includes(day) ? styles.daySelected : ''
                      }`}
                      onClick={() => toggleDay(day)}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="submit" variant="primary" style={{ marginTop: '12px' }}>
                Guardar Plantilla {flowType === 'income' ? 'de Ingreso' : 'de Obligación'}
              </Button>
            </form>
          </Card>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              marginTop: '20px',
            }}
          >
            <h2 className="text-headline-sm">Plantillas Fijas Configuradas</h2>
          </div>

          <section className={styles.listSection} style={{ marginTop: '12px' }}>
            {filteredPayments.length === 0 ? (
              <p
                className="text-body-sm text-center"
                style={{ color: 'var(--color-on-surface-variant)', marginTop: '16px' }}
              >
                No tienes plantillas programadas en esta vista.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {filteredPayments.map((payment) => {
                  const isIncome = payment.flowType === 'income';
                  const isConfirmed = paidPaymentIds.has(payment.id);
                  const occurrencesCount = Math.max(1, payment.days?.length || 1);
                  const monthlyWeighted = Number(payment.amount || 0) * occurrencesCount;

                  return (
                    <Card key={payment.id} className={styles.paymentCard} style={{ marginBottom: 0 }}>
                      <div className={styles.paymentIcon}>
                        {isIncome ? (
                          <TrendingUp size={22} color="var(--color-success)" />
                        ) : (
                          <Calendar size={22} color="var(--color-primary)" />
                        )}
                      </div>
                      <div className={styles.paymentInfo} style={{ flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <h3 className="text-body-lg" style={{ fontWeight: 600 }}>
                            {payment.title}
                          </h3>
                          {isConfirmed && (
                            <span
                              style={{
                                fontSize: '11px',
                                backgroundColor: 'var(--color-success)',
                                color: '#FFFFFF',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontWeight: 600,
                              }}
                            >
                              Confirmado este mes
                            </span>
                          )}
                        </div>
                        <p
                          className="text-label-sm"
                          style={{ color: 'var(--color-on-surface-variant)' }}
                        >
                          {isIncome ? 'Ingreso Fijo' : 'Gasto Fijo'} • Días:{' '}
                          {payment.days.sort((a, b) => a - b).join(', ')} • Ponderado Mes:{' '}
                          <strong>{formatCOP(monthlyWeighted)}</strong>
                        </p>
                        <div
                          style={{
                            marginTop: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <span
                            className="text-headline-sm"
                            style={{ color: isIncome ? 'var(--color-success)' : 'inherit' }}
                          >
                            {isIncome ? '+' : ''}
                            {formatCOP(Number(payment.amount))}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmingItem(payment);
                              setConfirmAdjustedAmount(formatInputCOP(String(payment.amount)));
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              backgroundColor: 'var(--color-primary-container)',
                              color: 'var(--color-primary-dark)',
                            }}
                          >
                            Confirmar / Ajustar
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <Button
                          variant="ghost"
                          onClick={() => openEditModal(payment)}
                          aria-label="Editar"
                          style={{ padding: '6px', height: 'auto', minWidth: 'auto' }}
                        >
                          <Pencil size={18} color="var(--color-primary)" />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setSelectedPayment(payment);
                            setIsDeleteModalOpen(true);
                          }}
                          aria-label="Eliminar"
                          style={{ padding: '6px', height: 'auto', minWidth: 'auto' }}
                        >
                          <Trash2 size={18} color="var(--color-error)" />
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      )}

      {/* Modal Rápido para Registrar Pago Esporádico / Extra */}
      <QuickMovementModal
        isOpen={isQuickSporadicOpen}
        onClose={() => {
          setIsQuickSporadicOpen(false);
          setEditingSporadicTx(null);
        }}
        initialType="expense"
        editingTransaction={editingSporadicTx}
        knownTransactions={transactions}
        recurringPayments={payments}
        activeBudgets={budgets}
      />

      {/* Modal de Topes por Categoría / #Tag */}
      <BudgetManagerModal
        isOpen={isBudgetModalOpen}
        onClose={() => setIsBudgetModalOpen(false)}
        currentDate={currentDate}
        existingBudget={currentBudgetDoc}
        allBudgets={budgets}
      />

      {/* Confirm & Adjust Modal (RF-05) */}
      <Modal
        isOpen={Boolean(confirmingItem)}
        onClose={() => setConfirmingItem(null)}
        title={`Confirmar ${confirmingItem?.title || ''}`}
      >
        <form
          onSubmit={handleConfirmOccurrence}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}
        >
          <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            Si este corte llegó por un valor distinto al habitual, ajústalo antes de registrarlo.
          </p>
          <Input
            label="Monto real recibido / pagado ($)"
            value={confirmAdjustedAmount}
            onChange={(e) => setConfirmAdjustedAmount(formatInputCOP(e.target.value))}
            required
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button type="button" variant="ghost" fullWidth onClick={() => setConfirmingItem(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={isConfirming}>
              {isConfirming ? 'Registrando...' : 'Confirmar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => !isProcessing && setIsDeleteModalOpen(false)}
        title="Eliminar Plantilla"
      >
        <div style={{ marginBottom: '20px', marginTop: '8px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            ¿Deseas eliminar <strong>{selectedPayment?.title}</strong>?
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button
            type="button"
            variant="ghost"
            fullWidth
            onClick={() => setIsDeleteModalOpen(false)}
            disabled={isProcessing}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            fullWidth
            onClick={handleDeletePayment}
            disabled={isProcessing}
          >
            {isProcessing ? 'Eliminando...' : 'Sí, eliminar'}
          </Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => !isProcessing && setIsEditModalOpen(false)}
        title="Editar Plantilla"
      >
        <form
          onSubmit={handleEditPayment}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}
        >
          <Input
            label="Nombre"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            required
          />
          <Input
            label="Monto ($)"
            value={editAmount}
            onChange={(e) => setEditAmount(formatInputCOP(e.target.value))}
            required
          />
          <div className={styles.dayGrid}>
            {days.map((day) => (
              <button
                key={day}
                type="button"
                className={`${styles.dayButton} ${
                  editSelectedDays.includes(day) ? styles.daySelected : ''
                }`}
                onClick={() =>
                  setEditSelectedDays((prev) =>
                    prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                  )
                }
              >
                {day}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              onClick={() => setIsEditModalOpen(false)}
              disabled={isProcessing}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={isProcessing}>
              Guardar Cambios
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
