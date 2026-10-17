'use client';
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { ScopeFilterBar } from '@/components/ui/ScopeFilterBar';
import { QuickMovementModal } from '@/components/finanzas/QuickMovementModal';
import { FixedCashflowWorksheet } from '@/components/finanzas/FixedCashflowWorksheet';
import {
  ArrowLeft,
  Receipt,
  CreditCard,
  Plus,
  Table2,
  Layers,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import styles from './recurrentes.module.css';
import { useAuth } from '@/context/AuthContext';
import { useHousehold } from '@/context/HouseholdContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, or } from 'firebase/firestore';
import { formatCOP } from '@/lib/currency';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import {
  BudgetDoc,
  EnhancedTransaction,
  Scope,
  UserPeriodWorksheet,
} from '@/lib/models';

type PagosTab = 'planilla' | 'esporadicos' | 'unificado';

export default function PagosRecurrentes() {
  const { user, loading } = useAuth();
  const { household, partner, partnerUid, globalScope, paymentMethods } = useHousehold();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [activeTab, setActiveTab] = useState<PagosTab>('planilla');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [quincenaFilter, setQuincenaFilter] = useState<'all' | 'q1' | 'q2'>('all');

  const [payments, setPayments] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<EnhancedTransaction[]>([]);
  const [worksheets, setWorksheets] = useState<UserPeriodWorksheet[]>([]);
  const [budgets, setBudgets] = useState<BudgetDoc[]>([]);

  const [isQuickSporadicOpen, setIsQuickSporadicOpen] = useState(false);
  const [editingSporadicTx, setEditingSporadicTx] = useState<EnhancedTransaction | null>(null);

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

    const buildWsFilter = () => {
      const clauses: any[] = [
        where('userId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid),
      ];
      if (partnerUid) {
        clauses.push(where('userId', '==', partnerUid));
      }
      if (hhId) {
        clauses.push(where('householdId', '==', hhId));
      }
      return or(...clauses);
    };

    const paymentsRef = collection(db, 'recurringPayments');
    const q = query(paymentsRef, buildOwnerFilter());
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() }));
      setPayments(data);
    });

    const txRef = collection(db, 'transactions');
    const qTx = query(txRef, buildOwnerFilter());
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const tList: EnhancedTransaction[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as EnhancedTransaction;
        if (data.deletedAt) return;
        tList.push({ ...data, id: d.id });
      });
      setTransactions(tList);
    });

    const wsRef = collection(db, 'periodWorksheets');
    const qWs = query(wsRef, buildWsFilter());
    const unsubWs = onSnapshot(qWs, (snap) => {
      const list: UserPeriodWorksheet[] = [];
      snap.forEach((d) => list.push({ ...(d.data() as UserPeriodWorksheet), id: d.id }));
      setWorksheets(list);
    });

    const bRef = collection(db, 'budgets');
    const qB = query(bRef, buildOwnerFilter());
    const unsubB = onSnapshot(qB, (snap) => {
      const list: BudgetDoc[] = [];
      snap.forEach((d) => list.push({ ...(d.data() as BudgetDoc), id: d.id }));
      setBudgets(list);
    });

    return () => {
      unsubscribe();
      unsubTx();
      unsubWs();
      unsubB();
    };
  }, [user, partnerUid, household?.id]);

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

    const targetUids: string[] = [];
    if (globalScope === 'mio' && user?.uid) {
      targetUids.push(user.uid);
    } else if (globalScope === 'pareja' && partnerUid) {
      targetUids.push(partnerUid);
    } else {
      if (user?.uid) targetUids.push(user.uid);
      if (partnerUid) targetUids.push(partnerUid);
    }

    for (const uid of targetUids) {
      const wsBaseQ1 =
        worksheets.find((w) => w.userId === uid && w.periodKey === 'BASE-Q1') ||
        worksheets
          .filter((w) => w.userId === uid && w.periodKey.endsWith('-Q1'))
          .sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0] ||
        null;

      const wsBaseQ2 =
        worksheets.find((w) => w.userId === uid && w.periodKey === 'BASE-Q2') ||
        worksheets
          .filter((w) => w.userId === uid && w.periodKey.endsWith('-Q2'))
          .sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0] ||
        null;

      const docsToInclude: Array<{ doc: UserPeriodWorksheet | null; label: string }> = [];
      if (quincenaFilter === 'q1' || quincenaFilter === 'all') {
        docsToInclude.push({ doc: wsBaseQ1, label: '1ª Qna (15)' });
      }
      if (quincenaFilter === 'q2' || quincenaFilter === 'all') {
        docsToInclude.push({ doc: wsBaseQ2, label: '2ª Qna (30)' });
      }

      for (const entry of docsToInclude) {
        if (!entry.doc) continue;
        for (const ob of entry.doc.obligations || []) {
          items.push({
            id: `ws_${entry.doc.periodKey}_${entry.doc.userId}_${ob.id}`,
            kind: 'fijo',
            title: ob.concept,
            amount: Number(ob.amount || 0),
            ownerName: entry.doc.userName || 'Hogar',
            ownerId: entry.doc.userId,
            categoryOrStatus: ob.paid ? 'Pagado' : 'Fijo mensual',
            paid: Boolean(ob.paid),
            dateLabel: entry.label,
          });
        }
      }
    }

    for (const tx of sporadicExpenses) {
      const d = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date();
      items.push({
        id: `tx_${tx.id}`,
        kind: 'esporadico',
        title: tx.place || tx.title || tx.description || tx.category,
        amount: Number(tx.amount || 0),
        ownerName: tx.paidByName || tx.ownerName || 'Yo',
        ownerId: tx.paidByUserId || tx.ownerId,
        categoryOrStatus: tx.category || 'Extra',
        paid: true,
        dateLabel: d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }),
        rawTx: tx,
      });
    }

    return items;
  }, [worksheets, sporadicExpenses, quincenaFilter, globalScope, user?.uid, partnerUid]);

  const totalUnifiedFixed = useMemo(
    () =>
      unifiedItems
        .filter((i) => i.kind === 'fijo')
        .reduce((acc, i) => acc + i.amount, 0),
    [unifiedItems]
  );

  const totalUnifiedSporadic = useMemo(
    () =>
      unifiedItems
        .filter((i) => i.kind === 'esporadico')
        .reduce((acc, i) => acc + i.amount, 0),
    [unifiedItems]
  );

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando Pagos y Presupuesto..." />
      </main>
    );
  }

  return (
    <main className={`container ${styles.main}`} style={{ paddingBottom: '90px' }}>
      {/* Cabecera Limpia */}
      <header className={styles.appBar}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link href="/">
              <Button variant="ghost" className={styles.iconBtn}>
                <ArrowLeft size={20} />
              </Button>
            </Link>
            <h1 className="text-headline-sm" style={{ margin: 0, fontSize: '18px' }}>
              Pagos y Presupuesto
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {partner && (
              <AvatarGroup
                users={[usersMap[user.uid], usersMap[partner.uid]].filter(Boolean) as any}
                size="sm"
              />
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingSporadicTx(null);
                setIsQuickSporadicOpen(true);
              }}
            >
              <Plus size={14} style={{ marginRight: '2px' }} /> Pago Extra
            </Button>
          </div>
        </div>
      </header>

      {/* Filtro Global (Mío por defecto · Conjunto · Todo · Pareja) */}
      <div>
        <ScopeFilterBar compact />
      </div>

      {/* Selector Compacto de Mes y Quincena */}
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
            {monthLabel}
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
                  padding: '4px 10px',
                  borderRadius: '9999px',
                  fontSize: '11px',
                  fontWeight: active ? 600 : 500,
                  backgroundColor: active
                    ? 'var(--color-surface-container-lowest)'
                    : 'transparent',
                  color: active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
                }}
              >
                {q.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3 Pestañas Limpias Horizontales (Presupuesto Fijo · Pagos Extras · Unificado) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '4px',
          backgroundColor: 'var(--color-surface-container)',
          padding: '3px',
          borderRadius: '9999px',
        }}
      >
        {[
          { id: 'planilla', label: 'Presupuesto Fijo', icon: <Table2 size={13} /> },
          { id: 'esporadicos', label: 'Pagos Extras', icon: <Receipt size={13} /> },
          { id: 'unificado', label: 'Unificado', icon: <Layers size={13} /> },
        ].map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as PagosTab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '7px 6px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: active ? 600 : 500,
                backgroundColor: active
                  ? 'var(--color-surface-container-lowest)'
                  : 'transparent',
                color: active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
                boxShadow: active ? 'var(--shadow-level-1)' : 'none',
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* =================================================================== */}
      {/* TAB 1: PRESUPUESTO FIJO (LIMPIO Y CONCISO)                          */}
      {/* =================================================================== */}
      {activeTab === 'planilla' && (
        <section>
          <FixedCashflowWorksheet
            currentDate={currentDate}
            quincenaFilter={quincenaFilter}
            onChangeQuincenaFilter={setQuincenaFilter}
            periodTransactions={periodTransactions}
            recurringPayments={payments}
          />
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 2: LISTA GENERAL DE PAGOS ESPORÁDICOS / EXTRAS                  */}
      {/* =================================================================== */}
      {activeTab === 'esporadicos' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Card
            style={{
              padding: '12px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                Total Pagos Extras ({globalScope.toUpperCase()})
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
                {sporadicExpenses.length} pagos fuera de los gastos fijos
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
            <Card style={{ textAlign: 'center', padding: '28px 16px' }}>
              <Receipt
                size={28}
                color="var(--color-on-surface-variant)"
                style={{ margin: '0 auto 8px' }}
              />
              <h4 className="text-body-lg" style={{ fontWeight: 600 }}>
                Sin pagos extras en este corte
              </h4>
              <p
                className="text-body-sm"
                style={{ color: 'var(--color-on-surface-variant)', marginTop: '4px' }}
              >
                Aquí verás todos los gastos esporádicos fuera de tus obligaciones fijas.
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
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
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
                            padding: '2px 7px',
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
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--color-on-surface-variant)',
                          display: 'flex',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>{d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</span>
                        <span>• {tx.paidByName || tx.ownerName || 'Yo'}</span>
                        {(pm || tx.paymentMethodAlias) && (
                          <span>• {pm?.alias || tx.paymentMethodAlias}</span>
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
      {/* TAB 3: VISTA GENERAL UNIFICADA (FIJOS + PAGOS EXTRAS)               */}
      {/* =================================================================== */}
      {activeTab === 'unificado' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Card style={{ padding: '16px' }}>
            <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              RESUMEN UNIFICADO ({globalScope.toUpperCase()})
            </span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginTop: '10px',
                padding: '12px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-surface-container-low)',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Fijos
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
                  Extras
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
                  Total General
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
            <Card style={{ textAlign: 'center', padding: '24px 16px' }}>
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                No hay gastos fijos ni pagos extras registrados en este corte.
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
                      padding: '10px 0',
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
                            padding: '2px 7px',
                            borderRadius: '999px',
                            backgroundColor: isFijo
                              ? 'var(--color-primary-container)'
                              : 'rgba(239, 68, 68, 0.1)',
                            color: isFijo ? 'var(--color-primary-dark)' : 'var(--color-error)',
                            flexShrink: 0,
                          }}
                        >
                          {isFijo ? 'Fijo' : 'Extra'}
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
    </main>
  );
}
