'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { useHousehold } from '@/context/HouseholdContext';
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  or,
  serverTimestamp,
} from 'firebase/firestore';
import {
  EnhancedTransaction,
  UserPeriodWorksheet,
  WorksheetObligationItem,
} from '@/lib/models';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  TrendingUp,
  TrendingDown,
  Pencil,
} from 'lucide-react';

interface FixedCashflowWorksheetProps {
  currentDate: Date;
  quincenaFilter: 'all' | 'q1' | 'q2';
  onChangeQuincenaFilter?: (q: 'all' | 'q1' | 'q2') => void;
  periodTransactions: EnhancedTransaction[];
  recurringPayments: any[];
}

export function FixedCashflowWorksheet({
  currentDate,
  quincenaFilter,
  periodTransactions,
}: FixedCashflowWorksheetProps) {
  const { user, profile } = useAuth();
  const { household, partner, partnerUid, globalScope, incomeSources } = useHousehold();

  const [worksheets, setWorksheets] = useState<UserPeriodWorksheet[]>([]);

  // Popup Modal states for adding Fixed Income or Fixed Expense
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'expense' | 'income'>('expense');
  const [targetQuincena, setTargetQuincena] = useState<'q1' | 'q2' | 'both'>('q1');
  const [newConcept, setNewConcept] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [isDiscountRow, setIsDiscountRow] = useState(false);
  const [isSavingModal, setIsSavingModal] = useState(false);

  const yearMonthPrefix = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }, [currentDate]);

  useEffect(() => {
    if (!user) return;
    const hhId = household?.id || '';
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

    const wsRef = collection(db, 'periodWorksheets');
    const qWs = query(wsRef, or(...clauses));
    const unsub = onSnapshot(qWs, (snap) => {
      const list: UserPeriodWorksheet[] = [];
      snap.forEach((d) => list.push({ ...(d.data() as UserPeriodWorksheet), id: d.id }));
      setWorksheets(list);
    });
    return () => unsub();
  }, [user, partnerUid, household?.id]);

  const myName = profile?.displayName?.split(' ')[0] || 'Mío';
  const partnerName = partner?.displayName?.split(' ')[0] || 'Pareja';

  // Sync automatically with globalScope ('mio', 'pareja', 'conjunto', 'todo')
  const isConsolidatedView = globalScope === 'conjunto' || globalScope === 'todo';
  const activeTargetUid =
    globalScope === 'pareja' && partnerUid ? partnerUid : user?.uid || '';
  const activeTargetName = globalScope === 'pareja' ? partnerName : myName;

  const getUserPeriodDocs = (uid: string) => {
    const wsBaseQ1 =
      worksheets.find((w) => w.userId === uid && w.periodKey === 'BASE-Q1') || null;
    const wsBaseQ2 =
      worksheets.find((w) => w.userId === uid && w.periodKey === 'BASE-Q2') || null;
    const wsQ1 =
      worksheets.find((w) => w.userId === uid && w.periodKey === `${yearMonthPrefix}-Q1`) || null;
    const wsQ2 =
      worksheets.find((w) => w.userId === uid && w.periodKey === `${yearMonthPrefix}-Q2`) || null;
    const wsMonth =
      worksheets.find((w) => w.userId === uid && w.periodKey === yearMonthPrefix) || null;

    // Fallback to the latest existing Q1/Q2 doc if BASE-Q1/BASE-Q2 has not been written yet
    const latestLegacyQ1 =
      wsBaseQ1 ||
      wsQ1 ||
      worksheets
        .filter((w) => w.userId === uid && w.periodKey.endsWith('-Q1'))
        .sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0] ||
      null;

    const latestLegacyQ2 =
      wsBaseQ2 ||
      wsQ2 ||
      worksheets
        .filter((w) => w.userId === uid && w.periodKey.endsWith('-Q2'))
        .sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0] ||
      null;

    return {
      wsBaseQ1,
      wsBaseQ2,
      wsQ1,
      wsQ2,
      wsMonth,
      effectiveQ1: wsBaseQ1 || latestLegacyQ1,
      effectiveQ2: wsBaseQ2 || latestLegacyQ2,
    };
  };

  const computeMonthlyQuincenaWeighted = (uid: string) => {
    const { effectiveQ1, effectiveQ2, wsMonth } = getUserPeriodDocs(uid);

    const userFixedSources = incomeSources.filter((s) => s.type === 'fijo' && s.ownerId === uid);
    const defaultQuincenaBase = userFixedSources.reduce(
      (acc, s) => acc + Number(s.defaultAmount || 0),
      0
    );

    const q1Salary =
      effectiveQ1?.fixedSalary ??
      (wsMonth ? Math.round(wsMonth.fixedSalary / 2) : defaultQuincenaBase);
    const q2Salary =
      effectiveQ2?.fixedSalary ??
      (wsMonth ? Math.round(wsMonth.fixedSalary / 2) : defaultQuincenaBase);
    const monthlyTotalSalary =
      effectiveQ1 || effectiveQ2
        ? q1Salary + q2Salary
        : wsMonth?.fixedSalary || defaultQuincenaBase * 2;
    const quincenalAverage = Math.round(monthlyTotalSalary / 2);

    return {
      q1Salary,
      q2Salary,
      monthlyTotalSalary,
      quincenalAverage,
    };
  };

  const myMonthlyWeighted = useMemo(
    () => computeMonthlyQuincenaWeighted(user?.uid || ''),
    [worksheets, incomeSources, user?.uid, yearMonthPrefix]
  );

  const partnerMonthlyWeighted = useMemo(
    () => computeMonthlyQuincenaWeighted(partnerUid || 'partner'),
    [worksheets, incomeSources, partnerUid, yearMonthPrefix]
  );

  const computeUserMetrics = (uid: string, ownerLabel: string) => {
    const { effectiveQ1, effectiveQ2, wsQ1, wsQ2, wsMonth } = getUserPeriodDocs(uid);
    const weighted = uid === partnerUid ? partnerMonthlyWeighted : myMonthlyWeighted;

    // Merge permanent template obligations with per-month paid checkmarks if present
    const resolvedQ1Obligations = (effectiveQ1?.obligations || []).map((o) => {
      const monthMatch = (wsQ1?.obligations || []).find(
        (m) => m.id === o.id || m.concept === o.concept
      );
      return {
        ...o,
        paid: monthMatch ? Boolean(monthMatch.paid) : Boolean(o.paid),
        sourcePeriodKey: 'BASE-Q1',
        quincenaTag: '1ª Qna (15)',
        ownerUid: uid,
        ownerLabel,
      };
    });

    const resolvedQ2Obligations = (effectiveQ2?.obligations || []).map((o) => {
      const monthMatch = (wsQ2?.obligations || []).find(
        (m) => m.id === o.id || m.concept === o.concept
      );
      return {
        ...o,
        paid: monthMatch ? Boolean(monthMatch.paid) : Boolean(o.paid),
        sourcePeriodKey: 'BASE-Q2',
        quincenaTag: '2ª Qna (30)',
        ownerUid: uid,
        ownerLabel,
      };
    });

    let fixedSalary = 0;
    let obligations: Array<
      WorksheetObligationItem & {
        sourcePeriodKey: string;
        quincenaTag: string;
        ownerUid: string;
        ownerLabel: string;
      }
    > = [];

    if (quincenaFilter === 'q1') {
      fixedSalary = weighted.q1Salary;
      obligations = resolvedQ1Obligations;
    } else if (quincenaFilter === 'q2') {
      fixedSalary = weighted.q2Salary;
      obligations = resolvedQ2Obligations;
    } else {
      fixedSalary = weighted.monthlyTotalSalary;
      const listMonth = (wsMonth?.obligations || []).map((o) => ({
        ...o,
        sourcePeriodKey: yearMonthPrefix,
        quincenaTag: 'Mensual',
        ownerUid: uid,
        ownerLabel,
      }));
      obligations = [...resolvedQ1Obligations, ...resolvedQ2Obligations, ...listMonth];
    }

    const totalFixedObligations = obligations.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );
    const fixedRemaining = fixedSalary - totalFixedObligations;

    const userTxs = periodTransactions.filter(
      (t) => !t.deletedAt && (t.paidByUserId || t.ownerId) === uid
    );

    const variableIncome = userTxs
      .filter((t) => t.type === 'income' && t.incomeType !== 'fijo')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const extraExpenses = userTxs
      .filter((t) => t.type === 'expense' && !t.recurringPaymentId)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const finalNetAvailable = fixedRemaining + variableIncome - extraExpenses;

    return {
      fixedSalary,
      obligations,
      totalFixedObligations,
      fixedRemaining,
      variableIncome,
      extraExpenses,
      finalNetAvailable,
      q1Salary: weighted.q1Salary,
      q2Salary: weighted.q2Salary,
      quincenalAverage: weighted.quincenalAverage,
      monthlyTotalSalary: weighted.monthlyTotalSalary,
    };
  };

  const myMetrics = useMemo(
    () => computeUserMetrics(user?.uid || '', myName),
    [worksheets, periodTransactions, user?.uid, quincenaFilter, yearMonthPrefix, myMonthlyWeighted, myName]
  );

  const partnerMetrics = useMemo(
    () => computeUserMetrics(partnerUid || 'partner', partnerName),
    [
      worksheets,
      periodTransactions,
      partnerUid,
      quincenaFilter,
      yearMonthPrefix,
      partnerMonthlyWeighted,
      partnerName,
    ]
  );

  const activeMetrics = useMemo(() => {
    if (!isConsolidatedView) {
      return globalScope === 'pareja' ? partnerMetrics : myMetrics;
    }
    const fixedSalary = myMetrics.fixedSalary + (partner ? partnerMetrics.fixedSalary : 0);
    const obligations = [
      ...myMetrics.obligations,
      ...(partner ? partnerMetrics.obligations : []),
    ];
    const totalFixedObligations =
      myMetrics.totalFixedObligations + (partner ? partnerMetrics.totalFixedObligations : 0);
    const fixedRemaining = fixedSalary - totalFixedObligations;
    const variableIncome =
      myMetrics.variableIncome + (partner ? partnerMetrics.variableIncome : 0);
    const extraExpenses =
      myMetrics.extraExpenses + (partner ? partnerMetrics.extraExpenses : 0);
    const finalNetAvailable = fixedRemaining + variableIncome - extraExpenses;

    return {
      fixedSalary,
      obligations,
      totalFixedObligations,
      fixedRemaining,
      variableIncome,
      extraExpenses,
      finalNetAvailable,
      q1Salary: myMetrics.q1Salary + (partner ? partnerMetrics.q1Salary : 0),
      q2Salary: myMetrics.q2Salary + (partner ? partnerMetrics.q2Salary : 0),
      quincenalAverage:
        myMetrics.quincenalAverage + (partner ? partnerMetrics.quincenalAverage : 0),
      monthlyTotalSalary:
        myMetrics.monthlyTotalSalary + (partner ? partnerMetrics.monthlyTotalSalary : 0),
    };
  }, [isConsolidatedView, globalScope, myMetrics, partnerMetrics, partner]);

  const saveWorksheetDoc = async (
    targetUid: string,
    targetName: string,
    specificPeriodKey: string,
    newSalary: number,
    newObligations: WorksheetObligationItem[]
  ) => {
    if (!user) return;
    const docId = `ws_${targetUid}_${specificPeriodKey}`;
    const sharedArray = partnerUid
      ? Array.from(new Set([user.uid, partnerUid].filter((id) => id !== targetUid)))
      : [];

    await setDoc(
      doc(db, 'periodWorksheets', docId),
      {
        id: docId,
        householdId: household?.id || 'default',
        userId: targetUid,
        userName: targetName,
        sharedWith: sharedArray,
        periodKey: specificPeriodKey,
        fixedSalary: newSalary,
        obligations: newObligations,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const openAddPopup = (mode: 'expense' | 'income') => {
    setModalMode(mode);
    const defaultQ = quincenaFilter === 'q2' ? 'q2' : quincenaFilter === 'q1' ? 'q1' : 'both';
    setTargetQuincena(mode === 'income' ? 'both' : defaultQ === 'both' ? 'q1' : defaultQ);
    setNewConcept('');
    setNewAmount('');
    setIsDiscountRow(false);

    if (mode === 'income') {
      const targetW = activeTargetUid === partnerUid ? partnerMonthlyWeighted : myMonthlyWeighted;
      const existingVal =
        quincenaFilter === 'q2' ? targetW.q2Salary : targetW.q1Salary;
      if (existingVal > 0) {
        setNewAmount(formatInputCOP(String(existingVal)));
      }
    }

    setIsAddModalOpen(true);
  };

  const handleSavePopup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTargetUid || !newAmount || isSavingModal) return;
    const rawAmt = parseCOP(newAmount);
    if (rawAmt <= 0) return;

    setIsSavingModal(true);
    try {
      const { effectiveQ1, effectiveQ2 } = getUserPeriodDocs(activeTargetUid);
      const targetW = activeTargetUid === partnerUid ? partnerMonthlyWeighted : myMonthlyWeighted;

      // Save permanently into BASE-Q1 / BASE-Q2 so fixed salary & obligations apply to ALL months unless edited
      if (modalMode === 'income') {
        if (targetQuincena === 'q1' || targetQuincena === 'both') {
          await saveWorksheetDoc(
            activeTargetUid,
            activeTargetName,
            'BASE-Q1',
            rawAmt,
            effectiveQ1?.obligations || []
          );
        }
        if (targetQuincena === 'q2' || targetQuincena === 'both') {
          await saveWorksheetDoc(
            activeTargetUid,
            activeTargetName,
            'BASE-Q2',
            rawAmt,
            effectiveQ2?.obligations || []
          );
        }
      } else {
        if (!newConcept.trim()) return;
        const signedAmount = isDiscountRow ? -rawAmt : rawAmt;

        if (targetQuincena === 'q1' || targetQuincena === 'both') {
          const currentQ1Obs = effectiveQ1?.obligations || [];
          const baseSalaryQ1 = effectiveQ1?.fixedSalary ?? targetW.q1Salary;
          await saveWorksheetDoc(activeTargetUid, activeTargetName, 'BASE-Q1', baseSalaryQ1, [
            ...currentQ1Obs,
            {
              id: `ob_${Date.now()}_q1`,
              concept: newConcept.trim(),
              amount: signedAmount,
              paid: false,
            },
          ]);
        }

        if (targetQuincena === 'q2' || targetQuincena === 'both') {
          const currentQ2Obs = effectiveQ2?.obligations || [];
          const baseSalaryQ2 = effectiveQ2?.fixedSalary ?? targetW.q2Salary;
          await saveWorksheetDoc(activeTargetUid, activeTargetName, 'BASE-Q2', baseSalaryQ2, [
            ...currentQ2Obs,
            {
              id: `ob_${Date.now()}_q2`,
              concept: newConcept.trim(),
              amount: signedAmount,
              paid: false,
            },
          ]);
        }
      }

      setIsAddModalOpen(false);
      setNewConcept('');
      setNewAmount('');
      setIsDiscountRow(false);
    } finally {
      setIsSavingModal(false);
    }
  };

  const handleTogglePaid = async (itemId: string, sourcePeriodKey: string, ownerUid: string) => {
    const { effectiveQ1, effectiveQ2 } = getUserPeriodDocs(ownerUid);
    const targetDoc =
      sourcePeriodKey === 'BASE-Q1'
        ? effectiveQ1
        : sourcePeriodKey === 'BASE-Q2'
        ? effectiveQ2
        : worksheets.find((w) => w.userId === ownerUid && w.periodKey === sourcePeriodKey);

    if (!targetDoc) return;
    const updated = targetDoc.obligations.map((ob) =>
      ob.id === itemId ? { ...ob, paid: !ob.paid } : ob
    );
    await saveWorksheetDoc(
      ownerUid,
      targetDoc.userName || (ownerUid === partnerUid ? partnerName : myName),
      sourcePeriodKey,
      targetDoc.fixedSalary,
      updated
    );
  };

  const handleDeleteObligation = async (
    itemId: string,
    sourcePeriodKey: string,
    ownerUid: string
  ) => {
    const { effectiveQ1, effectiveQ2 } = getUserPeriodDocs(ownerUid);
    const targetDoc =
      sourcePeriodKey === 'BASE-Q1'
        ? effectiveQ1
        : sourcePeriodKey === 'BASE-Q2'
        ? effectiveQ2
        : worksheets.find((w) => w.userId === ownerUid && w.periodKey === sourcePeriodKey);

    if (!targetDoc) return;
    const updated = targetDoc.obligations.filter((ob) => ob.id !== itemId);
    await saveWorksheetDoc(
      ownerUid,
      targetDoc.userName || (ownerUid === partnerUid ? partnerName : myName),
      sourcePeriodKey,
      targetDoc.fixedSalary,
      updated
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* ================================================================= */}
      {/* CARD 1: RESUMEN EJECUTIVO DE PRESUPUESTO FIJO Y DISPONIBLE        */}
      {/* ================================================================= */}
      <Card style={{ padding: '12px 14px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div>
            <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              PRESUPUESTO FIJO PERMANENTE ({globalScope.toUpperCase()})
            </span>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
              Q1: {formatCOP(activeMetrics.q1Salary)} · Q2: {formatCOP(activeMetrics.q2Salary)} · Promedio Qna:{' '}
              <strong>{formatCOP(activeMetrics.quincenalAverage)}</strong>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openAddPopup('income')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: 'var(--color-primary-container)',
              color: 'var(--color-primary-dark)',
              flexShrink: 0,
            }}
          >
            <Pencil size={12} /> Sueldo Fijo
          </button>
        </div>

        {/* 3 KPIs Principales: Sueldo Fijo | Gastos Fijos | Disponible Libre */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
            marginTop: '8px',
            padding: '10px 12px',
            borderRadius: '12px',
            backgroundColor: 'var(--color-surface-container-low)',
          }}
        >
          <div
            onClick={() => openAddPopup('income')}
            style={{ cursor: 'pointer' }}
            title="Editar sueldo fijo permanente"
          >
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Sueldo Fijo
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                marginTop: '2px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatCOP(activeMetrics.fixedSalary)}
            </div>
          </div>

          <div
            style={{
              borderLeft: '1px solid var(--color-outline-variant)',
              paddingLeft: '10px',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Gastos Fijos
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--color-error)',
                marginTop: '2px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatCOP(activeMetrics.totalFixedObligations)}
            </div>
          </div>

          <div
            style={{
              borderLeft: '1px solid var(--color-outline-variant)',
              paddingLeft: '10px',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Restante Fijo
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color:
                  activeMetrics.fixedRemaining >= 0
                    ? 'var(--color-success)'
                    : 'var(--color-error)',
                marginTop: '2px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatCOP(activeMetrics.fixedRemaining)}
            </div>
          </div>
        </div>

        {/* Barra compacta de Variables y Esporádicos */}
        <div
          style={{
            marginTop: '8px',
            padding: '8px 12px',
            borderRadius: '10px',
            backgroundColor:
              activeMetrics.finalNetAvailable >= 0
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(239, 68, 68, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            fontSize: '12px',
          }}
        >
          <div style={{ color: 'var(--color-on-surface-variant)', fontVariantNumeric: 'tabular-nums' }}>
            Variables:{' '}
            <strong style={{ color: 'var(--color-success)' }}>
              +{formatCOP(activeMetrics.variableIncome)}
            </strong>{' '}
            • Extras:{' '}
            <strong style={{ color: 'var(--color-error)' }}>
              -{formatCOP(activeMetrics.extraExpenses)}
            </strong>
          </div>
          <div style={{ fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: 'var(--color-on-surface-variant)', marginRight: '6px' }}>
              Libre Real:
            </span>
            <strong
              style={{
                fontSize: '14px',
                color:
                  activeMetrics.finalNetAvailable >= 0
                    ? 'var(--color-success)'
                    : 'var(--color-error)',
              }}
            >
              {formatCOP(activeMetrics.finalNetAvailable)}
            </strong>
          </div>
        </div>
      </Card>

      {/* ================================================================= */}
      {/* CARD 2: LISTA LIMPIA DE OBLIGACIONES FIJAS                        */}
      {/* ================================================================= */}
      <Card style={{ padding: '12px 14px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
          }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>
            Obligaciones Fijas ({activeMetrics.obligations.length})
          </h3>

          <Button variant="primary" size="sm" onClick={() => openAddPopup('expense')}>
            <Plus size={14} style={{ marginRight: '2px' }} /> Gasto Fijo
          </Button>
        </div>

        {activeMetrics.obligations.length === 0 ? (
          <div
            style={{
              padding: '16px 12px',
              textAlign: 'center',
              borderRadius: '10px',
              backgroundColor: 'var(--color-surface-container-low)',
            }}
          >
            <p
              style={{
                fontSize: '12px',
                color: 'var(--color-on-surface-variant)',
                margin: 0,
              }}
            >
              No hay gastos fijos configurados. Usa el botón &quot;+ Gasto Fijo&quot; para dejarlos fijos todos los meses.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activeMetrics.obligations.map((ob, index) => {
              const isNegative = ob.amount < 0;
              const isLast = index === activeMetrics.obligations.length - 1;
              return (
                <div
                  key={`${ob.ownerUid}_${ob.sourcePeriodKey}_${ob.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    padding: '8px 2px',
                    borderBottom: isLast ? 'none' : '1px solid var(--color-surface-container)',
                  }}
                >
                  <div
                    onClick={() => handleTogglePaid(ob.id, ob.sourcePeriodKey, ob.ownerUid)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      flex: 1,
                      minWidth: 0,
                      cursor: 'pointer',
                    }}
                  >
                    {ob.paid ? (
                      <CheckCircle2
                        size={18}
                        color="var(--color-success)"
                        style={{ flexShrink: 0 }}
                      />
                    ) : (
                      <Circle size={18} color="var(--color-outline)" style={{ flexShrink: 0 }} />
                    )}

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 500,
                          color: 'var(--color-on-surface)',
                          textDecoration: ob.paid ? 'line-through' : 'none',
                          opacity: ob.paid ? 0.6 : 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {ob.concept}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--color-on-surface-variant)',
                          marginTop: '1px',
                        }}
                      >
                        {ob.quincenaTag}
                        {isConsolidatedView ? ` • ${ob.ownerLabel}` : ''}
                        {isNegative ? ' • Ahorro a favor' : ''}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color: isNegative ? 'var(--color-success)' : 'var(--color-on-surface)',
                      }}
                    >
                      {formatCOP(ob.amount)}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleDeleteObligation(ob.id, ob.sourcePeriodKey, ob.ownerUid)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '26px',
                        height: '26px',
                        borderRadius: '9999px',
                        color: 'var(--color-outline)',
                      }}
                      title="Eliminar gasto fijo"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ================================================================= */}
      {/* POPUP MODAL LIMPIO PARA INGRESAR GASTO FIJO O SUELDO FIJO         */}
      {/* ================================================================= */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => !isSavingModal && setIsAddModalOpen(false)}
        title={
          modalMode === 'expense'
            ? `Nuevo Gasto Fijo (${activeTargetName})`
            : `Sueldo / Ingreso Fijo (${activeTargetName})`
        }
      >
        <form
          onSubmit={handleSavePopup}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              backgroundColor: 'var(--color-surface-container)',
              padding: '4px',
              borderRadius: '9999px',
              gap: '4px',
            }}
          >
            <button
              type="button"
              onClick={() => setModalMode('expense')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '8px',
                borderRadius: '9999px',
                fontWeight: 600,
                fontSize: '12px',
                backgroundColor:
                  modalMode === 'expense'
                    ? 'var(--color-surface-container-lowest)'
                    : 'transparent',
                color:
                  modalMode === 'expense'
                    ? 'var(--color-on-surface)'
                    : 'var(--color-on-surface-variant)',
                boxShadow: modalMode === 'expense' ? 'var(--shadow-level-1)' : 'none',
              }}
            >
              <TrendingDown size={15} color="var(--color-error)" /> Gasto Fijo
            </button>
            <button
              type="button"
              onClick={() => setModalMode('income')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '8px',
                borderRadius: '9999px',
                fontWeight: 600,
                fontSize: '12px',
                backgroundColor:
                  modalMode === 'income'
                    ? 'var(--color-surface-container-lowest)'
                    : 'transparent',
                color:
                  modalMode === 'income'
                    ? 'var(--color-on-surface)'
                    : 'var(--color-on-surface-variant)',
                boxShadow: modalMode === 'income' ? 'var(--shadow-level-1)' : 'none',
              }}
            >
              <TrendingUp size={15} color="var(--color-success)" /> Ingreso Fijo
            </button>
          </div>

          <div>
            <label className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              Quincena permanente (aplica a todos los meses)
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginTop: '6px',
              }}
            >
              {[
                { id: 'q1', label: '1ª Qna (15)' },
                { id: 'q2', label: '2ª Qna (30)' },
                { id: 'both', label: 'Ambas (15 y 30)' },
              ].map((opt) => {
                const active = targetQuincena === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTargetQuincena(opt.id as 'q1' | 'q2' | 'both')}
                    style={{
                      padding: '8px 6px',
                      borderRadius: '9999px',
                      fontSize: '12px',
                      fontWeight: active ? 600 : 500,
                      border: active
                        ? '1.5px solid var(--color-primary)'
                        : '1px solid var(--color-outline-variant)',
                      backgroundColor: active
                        ? 'var(--color-primary-container)'
                        : 'var(--color-surface-container-lowest)',
                      color: active
                        ? 'var(--color-primary-dark)'
                        : 'var(--color-on-surface-variant)',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {modalMode === 'expense' && (
            <Input
              label="Concepto del Gasto Fijo"
              placeholder="Ej. Arriendo, Mercado, Addi, Pasajes..."
              value={newConcept}
              onChange={(e) => setNewConcept(e.target.value)}
              required
            />
          )}

          <Input
            label={
              modalMode === 'income'
                ? 'Monto del Sueldo / Ingreso por Quincena ($)'
                : 'Valor del Gasto Fijo ($)'
            }
            placeholder="Ej. 1.750.000"
            value={newAmount}
            onChange={(e) => setNewAmount(formatInputCOP(e.target.value))}
            required
          />

          {modalMode === 'expense' && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                color: 'var(--color-on-surface-variant)',
                cursor: 'pointer',
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-surface-container-low)',
              }}
            >
              <input
                type="checkbox"
                checked={isDiscountRow}
                onChange={(e) => setIsDiscountRow(e.target.checked)}
              />
              <span>
                Es un saldo ya ahorrado / descuento a favor (ej.{' '}
                <em>-$320.000 ahorrado arriendo</em>)
              </span>
            </label>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              onClick={() => setIsAddModalOpen(false)}
              disabled={isSavingModal}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={isSavingModal}>
              {isSavingModal
                ? 'Guardando...'
                : modalMode === 'income'
                ? 'Guardar Ingreso'
                : 'Guardar Gasto Fijo'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
