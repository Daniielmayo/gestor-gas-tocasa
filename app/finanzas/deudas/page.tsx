'use client';
import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ScopeFilterBar } from '@/components/ui/ScopeFilterBar';
import { HouseholdConfigModal } from '@/components/finanzas/HouseholdConfigModal';
import {
  ArrowLeft,
  Plus,
  CreditCard,
  Trash2,
  ShieldAlert,
  Pencil,
  CheckCircle2,
  History,
  Settings,
  ArrowDownRight,
} from 'lucide-react';
import styles from './deudas.module.css';
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
  deleteDoc,
  updateDoc,
  increment,
  arrayUnion,
} from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import { DebtAbonoLog, DebtChargeLog, DebtDoc, EnhancedTransaction, Scope } from '@/lib/models';

export default function Deudas() {
  const { user, profile, loading } = useAuth();
  const { household, partner, partnerUid, globalScope, paymentMethods } = useHousehold();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [debts, setDebts] = useState<DebtDoc[]>([]);
  const [transactions, setTransactions] = useState<EnhancedTransaction[]>([]);
  const [recurringPayments, setRecurringPayments] = useState<any[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Settings Modal (to add/manage credit cards directly if needed)
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // New / Edit Debt Modal
  const [isNewDebtModalOpen, setIsNewDebtModalOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [debtTitle, setDebtTitle] = useState('');
  const [debtTarget, setDebtTarget] = useState('');
  const [debtScope, setDebtScope] = useState<Scope>('personal');
  const [linkedRecurringPaymentId, setLinkedRecurringPaymentId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isEditDebtModalOpen, setIsEditDebtModalOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<DebtDoc | null>(null);
  const [editSelectedCardId, setEditSelectedCardId] = useState<string>('');
  const [editDebtTitle, setEditDebtTitle] = useState('');
  const [editDebtTarget, setEditDebtTarget] = useState('');
  const [editDebtScope, setEditDebtScope] = useState<Scope>('personal');
  const [editLinkedRecurringPaymentId, setEditLinkedRecurringPaymentId] = useState('');

  // Abono (Payment) Modal
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [payNote, setPayNote] = useState('');
  const [paySourceMethodId, setPaySourceMethodId] = useState<string>('');
  const [paidByUid, setPaidByUid] = useState<string>('');

  // Increase / New Purchase on Card Modal
  const [isAddChargeModalOpen, setIsAddChargeModalOpen] = useState(false);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDate, setChargeDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [chargeNote, setChargeNote] = useState('');

  // Delete Modal
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [debtToDelete, setDebtToDelete] = useState<DebtDoc | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user && !paidByUid) {
      setPaidByUid(user.uid);
    }
  }, [user, paidByUid]);

  useEffect(() => {
    if (!user) return;

    const debtsRef = collection(db, 'debts');
    const qDebts = query(
      debtsRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubDebts = onSnapshot(qDebts, (snapshot) => {
      const data: DebtDoc[] = [];
      snapshot.forEach((d) => data.push({ ...(d.data() as DebtDoc), id: d.id }));
      setDebts(data);
      setIsReady(true);
    });

    const txRef = collection(db, 'transactions');
    const qTx = query(
      txRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const list: EnhancedTransaction[] = [];
      snapshot.forEach((d) => {
        const raw = d.data() as EnhancedTransaction;
        if (!raw.deletedAt) list.push({ ...raw, id: d.id });
      });
      setTransactions(list);
    });

    const rpRef = collection(db, 'recurringPayments');
    const qRp = query(
      rpRef,
      or(where('ownerId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsubRp = onSnapshot(qRp, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() }));
      setRecurringPayments(data);
    });

    return () => {
      unsubDebts();
      unsubTx();
      unsubRp();
    };
  }, [user]);

  const creditCards = useMemo(
    () => paymentMethods.filter((pm) => pm.type === 'credito' && pm.active !== false),
    [paymentMethods]
  );

  const debitOrCashMethods = useMemo(
    () => paymentMethods.filter((pm) => pm.type !== 'credito' && pm.active !== false),
    [paymentMethods]
  );

  // Filter debts according to Global Scope ('mio' default, 'conjunto', 'pareja', 'todo')
  const filteredDebts = useMemo(() => {
    if (!user) return [];
    return debts.filter((d) => {
      const dScope: Scope =
        d.scope || (d.sharedWith && d.sharedWith.length > 0 ? 'conjunto' : 'personal');
      if (globalScope === 'mio') return d.ownerId === user.uid;
      if (globalScope === 'pareja' && partnerUid) return d.ownerId === partnerUid;
      if (globalScope === 'conjunto') return dScope === 'conjunto';
      return true;
    });
  }, [debts, globalScope, user, partnerUid]);

  // All abono transactions linked to debts (either via debtId or legacy "Abono a Deuda:" category)
  const debtAbonoTransactions = useMemo(() => {
    return transactions
      .filter(
        (t) =>
          t.type === 'expense' &&
          (Boolean(t.debtId) || (t.category && t.category.startsWith('Abono a Deuda')))
      )
      .filter((t) => {
        const payer = t.paidByUserId || t.ownerId;
        const txScope: Scope =
          t.scope || (t.sharedWith && t.sharedWith.length > 0 ? 'conjunto' : 'personal');
        if (globalScope === 'mio') return payer === user?.uid || t.ownerId === user?.uid;
        if (globalScope === 'pareja' && partnerUid)
          return payer === partnerUid || t.ownerId === partnerUid;
        if (globalScope === 'conjunto') return txScope === 'conjunto';
        return true;
      })
      .sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const dbTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return dbTime - da;
      });
  }, [transactions, globalScope, user?.uid, partnerUid]);

  const handleSelectCardInCreate = (cardId: string) => {
    setSelectedCardId(cardId);
    const card = creditCards.find((c) => c.id === cardId);
    if (card) {
      setDebtTitle(
        `${card.alias}${card.bank ? ` · ${card.bank}` : ''}${card.last4 ? ` (*${card.last4})` : ''}`
      );
    }
  };

  const handleCreateDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debtTitle.trim() || !debtTarget || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      const card = creditCards.find((c) => c.id === selectedCardId);
      const sharedWithArray =
        debtScope === 'conjunto' && partnerUid
          ? [partnerUid]
          : partnerUid
          ? [partnerUid] // share visibility with partner so consolidated household works
          : [];

      await addDoc(collection(db, 'debts'), {
        householdId: household?.id || 'default',
        title: debtTitle.trim(),
        targetAmount: parseCOP(debtTarget),
        currentAmount: 0,
        ownerId: user.uid,
        ownerName: profile?.displayName?.split(' ')[0] || 'Yo',
        scope: debtScope,
        sharedWith: sharedWithArray,
        paymentMethodId: card?.id || null,
        paymentMethodAlias: card?.alias || null,
        bank: card?.bank || '',
        last4: card?.last4 || '',
        cutDay: card?.cutDay || null,
        dueDay: card?.dueDay || null,
        linkedRecurringPaymentId: linkedRecurringPaymentId || null,
        abonos: [],
        charges: [],
        createdAt: Timestamp.now(),
      });

      setIsNewDebtModalOpen(false);
      setSelectedCardId('');
      setDebtTitle('');
      setDebtTarget('');
      setDebtScope('personal');
      setLinkedRecurringPaymentId('');
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openPayModal = (d: DebtDoc) => {
    setSelectedDebt(d);
    setPayAmount('');
    setPayDate(new Date().toISOString().split('T')[0]);
    setPayNote('');
    setPaidByUid(user?.uid || '');
    setPaySourceMethodId(debitOrCashMethods[0]?.id || '');
    setIsPayModalOpen(true);
  };

  const handlePayDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebt || !payAmount || isSubmitting || !user) return;
    const amt = parseCOP(payAmount);
    if (amt <= 0) return;

    setIsSubmitting(true);
    try {
      const payerIsPartner = partnerUid && paidByUid === partnerUid;
      const payerName = payerIsPartner
        ? partner?.displayName?.split(' ')[0] || 'Pareja'
        : profile?.displayName?.split(' ')[0] || 'Yo';
      const sourceMethod = paymentMethods.find((m) => m.id === paySourceMethodId);
      const dScope: Scope = selectedDebt.scope || 'personal';
      const sharedWithArray = partnerUid ? [partnerUid] : [];
      const paidDateObj = payDate ? new Date(`${payDate}T12:00:00`) : new Date();

      // 1. Create Expense Transaction so it immediately reflects in General Balance & Extracto
      const txDocRef = await addDoc(collection(db, 'transactions'), {
        householdId: household?.id || 'default',
        type: 'expense',
        amount: amt,
        category: 'Pago Deuda / Tarjeta',
        place: selectedDebt.title,
        title: `Abono TC: ${selectedDebt.title}`,
        description: payNote.trim() || `Abono a ${selectedDebt.title}`,
        note: payNote.trim() || `Abono a ${selectedDebt.title}`,
        scope: dScope,
        ownerId: selectedDebt.ownerId || user.uid,
        ownerName: selectedDebt.ownerName || payerName,
        paidByUserId: paidByUid || user.uid,
        paidByName: payerName,
        paymentMethodId: sourceMethod?.id || selectedDebt.paymentMethodId || null,
        paymentMethodAlias: sourceMethod?.alias || selectedDebt.paymentMethodAlias || null,
        debtId: selectedDebt.id,
        debtTitle: selectedDebt.title,
        tags: ['abono-tarjeta'],
        sharedWith: sharedWithArray,
        deletedAt: null,
        createdAt: Timestamp.fromDate(paidDateObj),
        spentAt: Timestamp.fromDate(paidDateObj),
      });

      // 2. Append to Debt's internal abonos log and increment currentAmount
      const abonoEntry: DebtAbonoLog = {
        id: `ab_${Date.now()}`,
        amount: amt,
        note: payNote.trim() || 'Abono a tarjeta / deuda',
        paidByUserId: paidByUid || user.uid,
        paidByName: payerName,
        paymentMethodId: sourceMethod?.id || null,
        paymentMethodAlias: sourceMethod?.alias || null,
        transactionId: txDocRef.id,
        paidAt: paidDateObj.toISOString(),
      };

      await updateDoc(doc(db, 'debts', selectedDebt.id), {
        currentAmount: increment(amt),
        abonos: arrayUnion(abonoEntry),
        updatedAt: Timestamp.now(),
      });

      setIsPayModalOpen(false);
      setPayAmount('');
      setPayNote('');
      setSelectedDebt(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add new consumption / increase debt balance on an existing card
  const handleAddCardCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebt || !chargeAmount || isSubmitting || !user) return;
    const amt = parseCOP(chargeAmount);
    if (amt <= 0) return;

    setIsSubmitting(true);
    try {
      const chargeDateObj = chargeDate ? new Date(`${chargeDate}T12:00:00`) : new Date();
      const spenderName = profile?.displayName?.split(' ')[0] || 'Yo';
      const chargeEntry: DebtChargeLog = {
        id: `ch_${Date.now()}`,
        amount: amt,
        note: chargeNote.trim() || 'Consumo con tarjeta',
        category: 'Consumo Tarjeta',
        place: chargeNote.trim() || selectedDebt.title,
        spentByUserId: user.uid,
        spentByName: spenderName,
        spentAt: chargeDateObj.toISOString(),
      };

      await updateDoc(doc(db, 'debts', selectedDebt.id), {
        targetAmount: increment(amt),
        charges: arrayUnion(chargeEntry),
        updatedAt: Timestamp.now(),
      });
      setIsAddChargeModalOpen(false);
      setChargeAmount('');
      setChargeNote('');
      setSelectedDebt(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (d: DebtDoc) => {
    setSelectedDebt(d);
    setEditSelectedCardId(d.paymentMethodId || '');
    setEditDebtTitle(d.title);
    setEditDebtTarget(formatInputCOP(String(d.targetAmount)));
    setEditDebtScope(
      d.scope || (d.sharedWith && d.sharedWith.length > 0 ? 'conjunto' : 'personal')
    );
    setEditLinkedRecurringPaymentId(d.linkedRecurringPaymentId || '');
    setIsEditDebtModalOpen(true);
  };

  const handleEditDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebt || !editDebtTitle.trim() || !editDebtTarget || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      const card = creditCards.find((c) => c.id === editSelectedCardId);
      await updateDoc(doc(db, 'debts', selectedDebt.id), {
        title: editDebtTitle.trim(),
        targetAmount: parseCOP(editDebtTarget),
        scope: editDebtScope,
        paymentMethodId: card?.id || null,
        paymentMethodAlias: card?.alias || null,
        bank: card?.bank || selectedDebt.bank || '',
        last4: card?.last4 || selectedDebt.last4 || '',
        cutDay: card?.cutDay || selectedDebt.cutDay || null,
        dueDay: card?.dueDay || selectedDebt.dueDay || null,
        linkedRecurringPaymentId: editLinkedRecurringPaymentId || null,
        updatedAt: Timestamp.now(),
      });

      setIsEditDebtModalOpen(false);
      setSelectedDebt(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteDebt = async () => {
    if (!debtToDelete) return;
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'debts', debtToDelete.id));
      setIsDeleteModalOpen(false);
      setDebtToDelete(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || !user || !isReady) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando tarjetas y deudas..." />
      </main>
    );
  }

  const totalDebtTarget = filteredDebts.reduce((sum, d) => sum + Number(d.targetAmount || 0), 0);
  const totalDebtPaid = filteredDebts.reduce((sum, d) => sum + Number(d.currentAmount || 0), 0);
  const totalDebtRemaining = Math.max(0, totalDebtTarget - totalDebtPaid);
  const overallProgressPercentage =
    totalDebtTarget > 0 ? Math.min(100, Math.round((totalDebtPaid / totalDebtTarget) * 100)) : 0;

  return (
    <main className={`container ${styles.main}`} style={{ paddingBottom: '100px' }}>
      <header className={styles.header}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link href="/finanzas">
              <Button variant="ghost" className={styles.iconBtn}>
                <ArrowLeft size={22} />
              </Button>
            </Link>
            <div>
              <h1 className="text-headline-sm" style={{ margin: 0 }}>
                Deudas de Tarjetas y Abonos
              </h1>
              <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Cada abono descuenta tu deuda e impacta el Balance General
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {partner && (
              <AvatarGroup
                users={[usersMap[user.uid], usersMap[partner.uid]].filter(Boolean) as any}
                size="sm"
              />
            )}
            <Button
              variant="ghost"
              className={styles.iconBtn}
              onClick={() => setIsConfigOpen(true)}
              title="Configurar Tarjetas"
            >
              <Settings size={20} />
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsNewDebtModalOpen(true)}
            >
              <Plus size={15} style={{ marginRight: '4px' }} /> + Deuda TC
            </Button>
          </div>
        </div>
      </header>

      {/* Filtro Global (Mío por defecto · Conjunto · Todo · Pareja) */}
      <div style={{ marginBottom: '12px' }}>
        <ScopeFilterBar />
      </div>

      {/* Tarjeta Resumen General de Deudas y Abonos */}
      <Card style={{ padding: '16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            CONSOLIDADO DE DEUDAS EN TARJETAS ({globalScope.toUpperCase()})
          </span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--color-primary)',
            }}
          >
            {overallProgressPercentage}% abonado
          </span>
        </div>

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
              Deuda Total
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                marginTop: '2px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatCOP(totalDebtTarget)}
            </div>
          </div>

          <div
            style={{
              borderLeft: '1px solid var(--color-outline-variant)',
              paddingLeft: '10px',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Total Abonado
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--color-success)',
                marginTop: '2px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatCOP(totalDebtPaid)}
            </div>
          </div>

          <div
            style={{
              borderLeft: '1px solid var(--color-outline-variant)',
              paddingLeft: '10px',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Saldo Pendiente
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: totalDebtRemaining > 0 ? 'var(--color-error)' : 'var(--color-success)',
                marginTop: '2px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatCOP(totalDebtRemaining)}
            </div>
          </div>
        </div>

        <div
          style={{
            width: '100%',
            height: '8px',
            borderRadius: '999px',
            backgroundColor: 'var(--color-surface-container)',
            overflow: 'hidden',
            marginTop: '12px',
          }}
        >
          <div
            style={{
              width: `${overallProgressPercentage}%`,
              height: '100%',
              backgroundColor:
                overallProgressPercentage >= 100
                  ? 'var(--color-success)'
                  : 'var(--color-primary)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </Card>

      {/* Lista de Deudas por Tarjeta de Crédito */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
            Mis Tarjetas y Deudas Activas
          </h3>
          <button
            type="button"
            onClick={() => setIsConfigOpen(true)}
            style={{
              fontSize: '12px',
              color: 'var(--color-primary)',
              fontWeight: 600,
            }}
          >
            Gestionar plásticos →
          </button>
        </div>

        {filteredDebts.length === 0 ? (
          <Card style={{ textAlign: 'center', padding: '32px 16px' }}>
            <CreditCard
              size={32}
              color="var(--color-on-surface-variant)"
              style={{ margin: '0 auto 8px' }}
            />
            <h4 className="text-body-lg" style={{ fontWeight: 600 }}>
              No tienes deudas de tarjetas registradas en esta vista
            </h4>
            <p
              className="text-body-sm"
              style={{ color: 'var(--color-on-surface-variant)', margin: '4px 0 14px' }}
            >
              Registra el saldo actual de cada tarjeta de crédito o genera un gasto con tarjeta para ver tus consumos y abonos reflejados aquí.
            </p>
            <Button variant="primary" size="sm" onClick={() => setIsNewDebtModalOpen(true)}>
              <Plus size={15} style={{ marginRight: '4px' }} /> Registrar Deuda de Tarjeta
            </Button>
          </Card>
        ) : (
          filteredDebts.map((d) => {
            const remaining = Math.max(0, Number(d.targetAmount || 0) - Number(d.currentAmount || 0));
            const progress =
              d.targetAmount > 0
                ? Math.min(100, Math.round((Number(d.currentAmount || 0) / d.targetAmount) * 100))
                : 0;
            const isPaid = remaining === 0 && d.targetAmount > 0;
            const cardAbons = d.abonos || [];
            const cardCharges = d.charges || [];

            // Also include any credit card expense transactions linked by paymentMethodId that aren't already in d.charges
            const recordedTxIds = new Set(cardCharges.map((c) => c.transactionId).filter(Boolean));
            const linkedTxCharges: DebtChargeLog[] = d.paymentMethodId
              ? transactions
                  .filter(
                    (t) =>
                      t.type === 'expense' &&
                      t.paymentMethodId === d.paymentMethodId &&
                      t.category !== 'Pago Deuda / Tarjeta' &&
                      !(t.category && t.category.startsWith('Abono a Deuda')) &&
                      !recordedTxIds.has(t.id)
                  )
                  .map((t) => ({
                    id: `tx_${t.id}`,
                    amount: Number(t.amount || 0),
                    note: t.note || t.description || t.place || t.category,
                    category: t.category,
                    place: t.place,
                    spentByUserId: t.paidByUserId || t.ownerId,
                    spentByName: t.paidByName || t.ownerName || 'Yo',
                    transactionId: t.id,
                    spentAt: t.createdAt?.toDate
                      ? t.createdAt.toDate().toISOString()
                      : new Date().toISOString(),
                  }))
              : [];

            const allCardCharges = [...cardCharges, ...linkedTxCharges].sort(
              (a, b) => new Date(b.spentAt).getTime() - new Date(a.spentAt).getTime()
            );

            return (
              <Card key={d.id} style={{ padding: '16px' }}>
                {/* Cabecera de la Tarjeta */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        backgroundColor: isPaid
                          ? 'rgba(16, 185, 129, 0.12)'
                          : 'var(--color-primary-container)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {isPaid ? (
                        <CheckCircle2 size={20} color="var(--color-success)" />
                      ) : (
                        <CreditCard size={20} color="var(--color-primary)" />
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <h4
                          style={{
                            fontSize: '15px',
                            fontWeight: 600,
                            margin: 0,
                            textDecoration: isPaid ? 'line-through' : 'none',
                          }}
                        >
                          {d.title}
                        </h4>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 7px',
                            borderRadius: '999px',
                            backgroundColor: 'var(--color-surface-container-low)',
                            color: 'var(--color-on-surface-variant)',
                            fontWeight: 600,
                          }}
                        >
                          {d.scope === 'conjunto' ? 'Conjunta' : d.ownerName || 'Personal'}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--color-on-surface-variant)',
                          marginTop: '2px',
                        }}
                      >
                        {d.bank ? `${d.bank} • ` : ''}
                        {d.cutDay ? `Corte día ${d.cutDay} • ` : ''}
                        {d.dueDay ? `Pago límite día ${d.dueDay}` : 'Tarjeta de Crédito / Deuda'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => openEditModal(d)}
                      style={{ padding: '6px', color: 'var(--color-on-surface-variant)' }}
                      title="Editar deuda"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDebtToDelete(d);
                        setIsDeleteModalOpen(true);
                      }}
                      style={{ padding: '6px', color: 'var(--color-error)' }}
                      title="Eliminar deuda"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Montos de la Tarjeta (Deuda Total | Abonado | Saldo Pendiente) */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '8px',
                    marginTop: '14px',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--color-surface-container-low)',
                    fontSize: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                      Total Gastado / Deuda
                    </div>
                    <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatCOP(d.targetAmount)}
                    </div>
                  </div>
                  <div
                    style={{
                      borderLeft: '1px solid var(--color-outline-variant)',
                      paddingLeft: '8px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                      Abonado ({progress}%)
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: 'var(--color-success)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatCOP(d.currentAmount)}
                    </div>
                  </div>
                  <div
                    style={{
                      borderLeft: '1px solid var(--color-outline-variant)',
                      paddingLeft: '8px',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                      Por Pagar
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: remaining > 0 ? 'var(--color-error)' : 'var(--color-success)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatCOP(remaining)}
                    </div>
                  </div>
                </div>

                {/* Barra de progreso */}
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--color-surface-container)',
                    overflow: 'hidden',
                    marginTop: '10px',
                  }}
                >
                  <div
                    style={{
                      width: `${progress}%`,
                      height: '100%',
                      backgroundColor: isPaid ? 'var(--color-success)' : 'var(--color-primary)',
                    }}
                  />
                </div>

                {/* Botones de Acción: + Registrar Abono y + Sumar Consumo */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    fullWidth
                    onClick={() => openPayModal(d)}
                  >
                    <ArrowDownRight size={15} style={{ marginRight: '4px' }} /> Registrar Abono
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSelectedDebt(d);
                      setChargeAmount('');
                      setChargeDate(new Date().toISOString().split('T')[0]);
                      setChargeNote('');
                      setIsAddChargeModalOpen(true);
                    }}
                  >
                    + Nuevo Consumo
                  </Button>
                </div>

                {/* Historial de Consumos / Gastos en esta Tarjeta */}
                {allCardCharges.length > 0 && (
                  <div
                    style={{
                      marginTop: '14px',
                      paddingTop: '12px',
                      borderTop: '1px solid var(--color-surface-container)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--color-on-surface-variant)',
                        marginBottom: '8px',
                      }}
                    >
                      <CreditCard size={13} />
                      <span>Gastos y consumos en esta tarjeta ({allCardCharges.length})</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {allCardCharges.slice(0, 5).map((ch) => (
                        <div
                          key={ch.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '12px',
                            padding: '6px 8px',
                            borderRadius: '8px',
                            backgroundColor: 'var(--color-surface-container-low)',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 500 }}>
                              {ch.note || ch.place || ch.category || 'Consumo TC'}
                            </span>
                            <span
                              style={{
                                fontSize: '11px',
                                color: 'var(--color-on-surface-variant)',
                                marginLeft: '6px',
                              }}
                            >
                              • {ch.spentByName} •{' '}
                              {new Date(ch.spentAt).toLocaleDateString('es-CO', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                          </div>
                          <span
                            style={{
                              fontWeight: 600,
                              color: 'var(--color-error)',
                              fontVariantNumeric: 'tabular-nums',
                              flexShrink: 0,
                            }}
                          >
                            +{formatCOP(ch.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Historial de Abonos dentro de la misma tarjeta */}
                {cardAbons.length > 0 && (
                  <div
                    style={{
                      marginTop: '12px',
                      paddingTop: '12px',
                      borderTop: '1px solid var(--color-surface-container)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--color-on-surface-variant)',
                        marginBottom: '8px',
                      }}
                    >
                      <History size={13} />
                      <span>Abonos realizados a esta tarjeta ({cardAbons.length})</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {[...cardAbons]
                        .reverse()
                        .slice(0, 5)
                        .map((ab) => (
                          <div
                            key={ab.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '12px',
                              padding: '6px 8px',
                              borderRadius: '8px',
                              backgroundColor: 'var(--color-surface-container-low)',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <span style={{ fontWeight: 500 }}>{ab.note || 'Abono'}</span>
                              <span
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--color-on-surface-variant)',
                                  marginLeft: '6px',
                                }}
                              >
                                • {ab.paidByName} •{' '}
                                {new Date(ab.paidAt).toLocaleDateString('es-CO', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </span>
                            </div>
                            <span
                              style={{
                                fontWeight: 600,
                                color: 'var(--color-success)',
                                fontVariantNumeric: 'tabular-nums',
                                flexShrink: 0,
                              }}
                            >
                              -{formatCOP(ab.amount)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </section>

      {/* Historial General de Abonos Reflejados en el Balance General */}
      {debtAbonoTransactions.length > 0 && (
        <section style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
            Abonos Reflejados en el Balance General
          </h3>
          <Card style={{ padding: '8px 16px' }}>
            {debtAbonoTransactions.slice(0, 10).map((tx, idx) => {
              const d = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date();
              const isLast = idx === Math.min(debtAbonoTransactions.length, 10) - 1;
              return (
                <div
                  key={tx.id}
                  style={{
                    padding: '10px 0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    borderBottom: isLast ? 'none' : '1px solid var(--color-surface-container)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                      {tx.debtTitle || tx.place || tx.title || tx.category}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                      {d.toLocaleDateString('es-CO', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      • {tx.description || tx.note || 'Abono'} • Pagó:{' '}
                      {tx.paidByName || tx.ownerName || 'Yo'}
                      {tx.paymentMethodAlias ? ` • Desde: ${tx.paymentMethodAlias}` : ''}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--color-error)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    -{formatCOP(tx.amount)}
                  </div>
                </div>
              );
            })}
          </Card>
        </section>
      )}

      {/* ================================================================= */}
      {/* POPUP: REGISTRAR NUEVA DEUDA DE TARJETA DE CRÉDITO                */}
      {/* ================================================================= */}
      <Modal
        isOpen={isNewDebtModalOpen}
        onClose={() => !isSubmitting && setIsNewDebtModalOpen(false)}
        title="Registrar Deuda de Tarjeta"
      >
        <form
          onSubmit={handleCreateDebt}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}
        >
          {/* Selección rápida de tus tarjetas de crédito configuradas */}
          {creditCards.length > 0 && (
            <div>
              <label className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Selecciona tu Tarjeta de Crédito (Opcional)
              </label>
              <select
                value={selectedCardId}
                onChange={(e) => handleSelectCardInCreate(e.target.value)}
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
                <option value="">-- Otra tarjeta o deuda manual --</option>
                {creditCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.alias} {c.bank ? `(${c.bank})` : ''} {c.last4 ? `*${c.last4}` : ''} -{' '}
                    {c.holderName || 'Hogar'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Input
            label="Nombre de la Tarjeta o Deuda"
            placeholder="Ej. Visa Bancolombia *4512, NuBank, Addi..."
            value={debtTitle}
            onChange={(e) => setDebtTitle(e.target.value)}
            required
          />

          <Input
            label="Saldo Total Adeudado a la Fecha ($)"
            type="text"
            placeholder="Ej. 2.400.000"
            value={debtTarget}
            onChange={(e) => setDebtTarget(formatInputCOP(e.target.value))}
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Ámbito de la deuda
              </label>
              <select
                value={debtScope}
                onChange={(e) => setDebtScope(e.target.value as Scope)}
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
                <option value="personal">Personal (Mía)</option>
                <option value="conjunto">Conjunta (Hogar)</option>
              </select>
            </div>

            <div>
              <label className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Vincular a Fijo Programado
              </label>
              <select
                value={linkedRecurringPaymentId}
                onChange={(e) => setLinkedRecurringPaymentId(e.target.value)}
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
                <option value="">-- Sin vínculo --</option>
                {recurringPayments.map((rp) => (
                  <option key={rp.id} value={rp.id}>
                    {rp.title} ({formatCOP(rp.amount)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              onClick={() => setIsNewDebtModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={!debtTitle || !debtTarget || isSubmitting}
            >
              {isSubmitting ? 'Guardando...' : 'Guardar Deuda'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ================================================================= */}
      {/* POPUP: REGISTRAR ABONO A LA TARJETA (IMPACTA BALANCE GENERAL)     */}
      {/* ================================================================= */}
      <Modal
        isOpen={isPayModalOpen}
        onClose={() => {
          if (!isSubmitting) {
            setIsPayModalOpen(false);
            setSelectedDebt(null);
          }
        }}
        title={`Abonar a ${selectedDebt?.title || 'Tarjeta'}`}
      >
        {selectedDebt && (
          <form
            onSubmit={handlePayDebt}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}
          >
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-surface-container-low)',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
              }}
            >
              <span>Saldo pendiente actual:</span>
              <strong style={{ color: 'var(--color-error)' }}>
                {formatCOP(Math.max(0, selectedDebt.targetAmount - selectedDebt.currentAmount))}
              </strong>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' }}>
              <Input
                label="Monto del Abono ($)"
                type="text"
                placeholder="Ej. 350.000"
                value={payAmount}
                onChange={(e) => setPayAmount(formatInputCOP(e.target.value))}
                required
                autoFocus
              />
              <Input
                label="Fecha del Abono"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label
                  className="text-label-sm"
                  style={{ color: 'var(--color-on-surface-variant)' }}
                >
                  ¿Quién realiza el abono?
                </label>
                <select
                  value={paidByUid}
                  onChange={(e) => setPaidByUid(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container-lowest)',
                    fontSize: '13px',
                    marginTop: '4px',
                  }}
                >
                  <option value={user.uid}>
                    {profile?.displayName?.split(' ')[0] || 'Yo'}
                  </option>
                  {partner && partnerUid && (
                    <option value={partnerUid}>
                      {partner.displayName?.split(' ')[0] || 'Pareja'}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label
                  className="text-label-sm"
                  style={{ color: 'var(--color-on-surface-variant)' }}
                >
                  Cuenta / Medio de origen
                </label>
                <select
                  value={paySourceMethodId}
                  onChange={(e) => setPaySourceMethodId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container-lowest)',
                    fontSize: '13px',
                    marginTop: '4px',
                  }}
                >
                  <option value="">Efectivo / Transferencia</option>
                  {debitOrCashMethods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.alias} ({m.holderName || 'Hogar'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Input
              label="Descripción (Opcional)"
              placeholder="Ej. Cuota quincena 15, Abono extra a capital..."
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
            />

            <p
              className="text-label-sm"
              style={{ color: 'var(--color-on-surface-variant)', textAlign: 'center' }}
            >
              Este abono reducirá la deuda de la tarjeta y se descontará automáticamente como salida en el Balance General.
            </p>

            <div style={{ display: 'flex', gap: '10px' }}>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                onClick={() => setIsPayModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                fullWidth
                disabled={!payAmount || isSubmitting}
              >
                {isSubmitting ? 'Procesando...' : 'Confirmar Abono'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ================================================================= */}
      {/* POPUP: SUMAR NUEVO CONSUMO / GASTO A LA TARJETA                   */}
      {/* ================================================================= */}
      <Modal
        isOpen={isAddChargeModalOpen}
        onClose={() => !isSubmitting && setIsAddChargeModalOpen(false)}
        title={`Registrar Gasto en ${selectedDebt?.title || 'Tarjeta'}`}
      >
        <form
          onSubmit={handleAddCardCharge}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' }}>
            <Input
              label="Valor del gasto / consumo ($)"
              type="text"
              placeholder="Ej. 180.000"
              value={chargeAmount}
              onChange={(e) => setChargeAmount(formatInputCOP(e.target.value))}
              required
              autoFocus
            />
            <Input
              label="Fecha del gasto"
              type="date"
              value={chargeDate}
              onChange={(e) => setChargeDate(e.target.value)}
              required
            />
          </div>
          <Input
            label="Descripción (Opcional)"
            placeholder="Ej. Compra supermercado, restaurante, cuotas..."
            value={chargeNote}
            onChange={(e) => setChargeNote(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              onClick={() => setIsAddChargeModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={!chargeAmount || isSubmitting}
            >
              {isSubmitting ? 'Guardando...' : 'Registrar Gasto en Tarjeta'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ================================================================= */}
      {/* POPUP: EDITAR DEUDA DE TARJETA                                    */}
      {/* ================================================================= */}
      <Modal
        isOpen={isEditDebtModalOpen}
        onClose={() => !isSubmitting && setIsEditDebtModalOpen(false)}
        title="Editar Deuda de Tarjeta"
      >
        <form
          onSubmit={handleEditDebt}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '8px' }}
        >
          {creditCards.length > 0 && (
            <div>
              <label className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Tarjeta vinculada
              </label>
              <select
                value={editSelectedCardId}
                onChange={(e) => setEditSelectedCardId(e.target.value)}
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
                <option value="">-- Sin tarjeta específica --</option>
                {creditCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.alias} {c.bank ? `(${c.bank})` : ''} {c.last4 ? `*${c.last4}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Input
            label="Nombre de la Tarjeta o Deuda"
            value={editDebtTitle}
            onChange={(e) => setEditDebtTitle(e.target.value)}
            required
          />

          <Input
            label="Monto Total Adeudado ($)"
            type="text"
            value={editDebtTarget}
            onChange={(e) => setEditDebtTarget(formatInputCOP(e.target.value))}
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Ámbito
              </label>
              <select
                value={editDebtScope}
                onChange={(e) => setEditDebtScope(e.target.value as Scope)}
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
                <option value="personal">Personal</option>
                <option value="conjunto">Conjunta (Hogar)</option>
              </select>
            </div>

            <div>
              <label className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Pago Fijo Vinculado
              </label>
              <select
                value={editLinkedRecurringPaymentId}
                onChange={(e) => setEditLinkedRecurringPaymentId(e.target.value)}
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
                <option value="">-- Ninguno --</option>
                {recurringPayments.map((rp) => (
                  <option key={rp.id} value={rp.id}>
                    {rp.title} ({formatCOP(rp.amount)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              onClick={() => setIsEditDebtModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={!editDebtTitle || !editDebtTarget || isSubmitting}
            >
              {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Debt Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => !isSubmitting && setIsDeleteModalOpen(false)}
        title="Eliminar Deuda de Tarjeta"
      >
        <div style={{ marginBottom: '20px', marginTop: '8px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            ¿Estás seguro de que deseas eliminar <strong>{debtToDelete?.title}</strong>? Los abonos realizados previamente seguirán reflejados en tu Balance General.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button
            type="button"
            variant="ghost"
            fullWidth
            onClick={() => setIsDeleteModalOpen(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            fullWidth
            onClick={handleDeleteDebt}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Eliminando...' : 'Sí, eliminar'}
          </Button>
        </div>
      </Modal>

      {/* Modal de Configuración de Tarjetas */}
      <HouseholdConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        initialTab="metodos"
      />
    </main>
  );
}
