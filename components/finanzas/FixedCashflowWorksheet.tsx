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
  Users,
  User,
  CheckCircle2,
  Circle,
  Sparkles,
  Wallet,
  Calendar,
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
  onChangeQuincenaFilter,
  periodTransactions,
  recurringPayments,
}: FixedCashflowWorksheetProps) {
  const { user, profile } = useAuth();
  const { household, partner, partnerUid, incomeSources } = useHousehold();

  const [worksheets, setWorksheets] = useState<UserPeriodWorksheet[]>([]);
  const [selectedView, setSelectedView] = useState<'me' | 'partner' | 'consolidated'>('me');

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

  const periodLabel = useMemo(() => {
    const monthName = currentDate.toLocaleDateString('es-CO', { month: 'short' }).toUpperCase();
    if (quincenaFilter === 'q1') return `15 ${monthName} (1ª Quincena)`;
    if (quincenaFilter === 'q2') return `30 ${monthName} (2ª Quincena)`;
    return `Mes Completo (${monthName})`;
  }, [currentDate, quincenaFilter]);

  useEffect(() => {
    if (!user) return;
    const wsRef = collection(db, 'periodWorksheets');
    const qWs = query(
      wsRef,
      or(where('userId', '==', user.uid), where('sharedWith', 'array-contains', user.uid))
    );
    const unsub = onSnapshot(qWs, (snap) => {
      const list: UserPeriodWorksheet[] = [];
      snap.forEach((d) => list.push({ ...(d.data() as UserPeriodWorksheet), id: d.id }));
      setWorksheets(list);
    });
    return () => unsub();
  }, [user]);

  const myName = profile?.displayName?.split(' ')[0] || 'Mío';
  const partnerName = partner?.displayName?.split(' ')[0] || 'Pareja';

  const activeTargetUid =
    selectedView === 'partner' && partnerUid ? partnerUid : user?.uid || '';
  const activeTargetName = selectedView === 'partner' ? partnerName : myName;

  const getUserPeriodDocs = (uid: string) => {
    const wsQ1 =
      worksheets.find((w) => w.userId === uid && w.periodKey === `${yearMonthPrefix}-Q1`) || null;
    const wsQ2 =
      worksheets.find((w) => w.userId === uid && w.periodKey === `${yearMonthPrefix}-Q2`) || null;
    const wsMonth =
      worksheets.find((w) => w.userId === uid && w.periodKey === yearMonthPrefix) || null;
    return { wsQ1, wsQ2, wsMonth };
  };

  // Compute Quincenal (Q1 & Q2) and Monthly Weighted (Ponderado Mensual) Fixed Income & Obligations per user
  const computeMonthlyQuincenaWeighted = (uid: string) => {
    const { wsQ1, wsQ2, wsMonth } = getUserPeriodDocs(uid);

    const userFixedSources = incomeSources.filter((s) => s.type === 'fijo' && s.ownerId === uid);
    const defaultQuincenaBase = userFixedSources.reduce(
      (acc, s) => acc + Number(s.defaultAmount || 0),
      0
    );

    const q1Salary =
      wsQ1?.fixedSalary ?? (wsMonth ? Math.round(wsMonth.fixedSalary / 2) : defaultQuincenaBase);
    const q2Salary =
      wsQ2?.fixedSalary ?? (wsMonth ? Math.round(wsMonth.fixedSalary / 2) : defaultQuincenaBase);
    const monthlyTotalSalary =
      wsQ1 || wsQ2
        ? (wsQ1?.fixedSalary || 0) + (wsQ2?.fixedSalary || 0)
        : wsMonth?.fixedSalary || defaultQuincenaBase * 2;
    const quincenalAverage = Math.round(monthlyTotalSalary / 2);

    const q1Debt = (wsQ1?.obligations || []).reduce((s, o) => s + Number(o.amount || 0), 0);
    const q2Debt = (wsQ2?.obligations || []).reduce((s, o) => s + Number(o.amount || 0), 0);
    const monthDebt = (wsMonth?.obligations || []).reduce((s, o) => s + Number(o.amount || 0), 0);
    const monthlyTotalDebt = wsQ1 || wsQ2 || wsMonth ? q1Debt + q2Debt + monthDebt : 0;

    return {
      q1Salary,
      q2Salary,
      monthlyTotalSalary,
      quincenalAverage,
      q1Debt,
      q2Debt,
      monthlyTotalDebt,
      monthlyRemaining: monthlyTotalSalary - monthlyTotalDebt,
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

  const householdMonthlyWeighted = useMemo(() => {
    return {
      q1Salary: myMonthlyWeighted.q1Salary + partnerMonthlyWeighted.q1Salary,
      q2Salary: myMonthlyWeighted.q2Salary + partnerMonthlyWeighted.q2Salary,
      monthlyTotalSalary:
        myMonthlyWeighted.monthlyTotalSalary + partnerMonthlyWeighted.monthlyTotalSalary,
      quincenalAverage:
        myMonthlyWeighted.quincenalAverage + partnerMonthlyWeighted.quincenalAverage,
      monthlyTotalDebt:
        myMonthlyWeighted.monthlyTotalDebt + partnerMonthlyWeighted.monthlyTotalDebt,
      monthlyRemaining:
        myMonthlyWeighted.monthlyRemaining + partnerMonthlyWeighted.monthlyRemaining,
    };
  }, [myMonthlyWeighted, partnerMonthlyWeighted]);

  const activeWeighted =
    selectedView === 'partner' ? partnerMonthlyWeighted : myMonthlyWeighted;

  // Compute user metrics for the active filter ('all' shows Q1 + Q2 combined; 'q1' shows Q1; 'q2' shows Q2)
  const computeUserMetrics = (uid: string) => {
    const { wsQ1, wsQ2, wsMonth } = getUserPeriodDocs(uid);
    const weighted = uid === partnerUid ? partnerMonthlyWeighted : myMonthlyWeighted;

    let fixedSalary = 0;
    let obligations: Array<
      WorksheetObligationItem & { sourcePeriodKey: string; quincenaTag: string }
    > = [];

    if (quincenaFilter === 'q1') {
      fixedSalary = wsQ1?.fixedSalary ?? weighted.q1Salary;
      obligations = (wsQ1?.obligations || []).map((o) => ({
        ...o,
        sourcePeriodKey: `${yearMonthPrefix}-Q1`,
        quincenaTag: '1ª Qna (15)',
      }));
    } else if (quincenaFilter === 'q2') {
      fixedSalary = wsQ2?.fixedSalary ?? weighted.q2Salary;
      obligations = (wsQ2?.obligations || []).map((o) => ({
        ...o,
        sourcePeriodKey: `${yearMonthPrefix}-Q2`,
        quincenaTag: '2ª Qna (30)',
      }));
    } else {
      fixedSalary = weighted.monthlyTotalSalary;
      const listQ1 = (wsQ1?.obligations || []).map((o) => ({
        ...o,
        sourcePeriodKey: `${yearMonthPrefix}-Q1`,
        quincenaTag: '1ª Qna (15)',
      }));
      const listQ2 = (wsQ2?.obligations || []).map((o) => ({
        ...o,
        sourcePeriodKey: `${yearMonthPrefix}-Q2`,
        quincenaTag: '2ª Qna (30)',
      }));
      const listMonth = (wsMonth?.obligations || []).map((o) => ({
        ...o,
        sourcePeriodKey: yearMonthPrefix,
        quincenaTag: 'Mensual',
      }));
      obligations = [...listQ1, ...listQ2, ...listMonth];
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
      .filter((t) => t.type === 'income' && t.incomeType === 'variable')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const extraExpenses = userTxs
      .filter((t) => t.type === 'expense' && !t.recurringPaymentId)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const totalAvailableForExtras = fixedRemaining + variableIncome;
    const finalNetAvailable = totalAvailableForExtras - extraExpenses;

    return {
      fixedSalary,
      obligations,
      totalFixedObligations,
      fixedRemaining,
      variableIncome,
      extraExpenses,
      totalAvailableForExtras,
      finalNetAvailable,
    };
  };

  const myMetrics = useMemo(
    () => computeUserMetrics(user?.uid || ''),
    [worksheets, periodTransactions, user?.uid, quincenaFilter, yearMonthPrefix, myMonthlyWeighted]
  );

  const partnerMetrics = useMemo(
    () => computeUserMetrics(partnerUid || 'partner'),
    [
      worksheets,
      periodTransactions,
      partnerUid,
      quincenaFilter,
      yearMonthPrefix,
      partnerMonthlyWeighted,
    ]
  );

  const consolidatedMetrics = useMemo(() => {
    const fixedSalary = myMetrics.fixedSalary + partnerMetrics.fixedSalary;
    const totalFixedObligations =
      myMetrics.totalFixedObligations + partnerMetrics.totalFixedObligations;
    const fixedRemaining = fixedSalary - totalFixedObligations;
    const variableIncome = myMetrics.variableIncome + partnerMetrics.variableIncome;
    const extraExpenses = myMetrics.extraExpenses + partnerMetrics.extraExpenses;
    const totalAvailableForExtras = fixedRemaining + variableIncome;
    const finalNetAvailable = totalAvailableForExtras - extraExpenses;

    return {
      fixedSalary,
      totalFixedObligations,
      fixedRemaining,
      variableIncome,
      extraExpenses,
      totalAvailableForExtras,
      finalNetAvailable,
    };
  }, [myMetrics, partnerMetrics]);

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
      const { wsQ1, wsQ2 } = getUserPeriodDocs(activeTargetUid);
      const existingVal =
        quincenaFilter === 'q2'
          ? wsQ2?.fixedSalary || activeWeighted.q2Salary
          : wsQ1?.fixedSalary || activeWeighted.q1Salary;
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
      const { wsQ1, wsQ2 } = getUserPeriodDocs(activeTargetUid);
      const q1Key = `${yearMonthPrefix}-Q1`;
      const q2Key = `${yearMonthPrefix}-Q2`;

      if (modalMode === 'income') {
        if (targetQuincena === 'q1' || targetQuincena === 'both') {
          await saveWorksheetDoc(
            activeTargetUid,
            activeTargetName,
            q1Key,
            rawAmt,
            wsQ1?.obligations || []
          );
        }
        if (targetQuincena === 'q2' || targetQuincena === 'both') {
          await saveWorksheetDoc(
            activeTargetUid,
            activeTargetName,
            q2Key,
            rawAmt,
            wsQ2?.obligations || []
          );
        }
      } else {
        if (!newConcept.trim()) return;
        const signedAmount = isDiscountRow ? -rawAmt : rawAmt;

        if (targetQuincena === 'q1' || targetQuincena === 'both') {
          const currentQ1Obs = wsQ1?.obligations || [];
          const baseSalaryQ1 = wsQ1?.fixedSalary ?? activeWeighted.q1Salary;
          await saveWorksheetDoc(activeTargetUid, activeTargetName, q1Key, baseSalaryQ1, [
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
          const currentQ2Obs = wsQ2?.obligations || [];
          const baseSalaryQ2 = wsQ2?.fixedSalary ?? activeWeighted.q2Salary;
          await saveWorksheetDoc(activeTargetUid, activeTargetName, q2Key, baseSalaryQ2, [
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

  const handleTogglePaid = async (itemId: string, sourcePeriodKey: string) => {
    if (!activeTargetUid) return;
    const targetWs = worksheets.find(
      (w) => w.userId === activeTargetUid && w.periodKey === sourcePeriodKey
    );
    if (!targetWs) return;
    const updated = targetWs.obligations.map((ob) =>
      ob.id === itemId ? { ...ob, paid: !ob.paid } : ob
    );
    await saveWorksheetDoc(
      activeTargetUid,
      activeTargetName,
      sourcePeriodKey,
      targetWs.fixedSalary,
      updated
    );
  };

  const handleDeleteObligation = async (itemId: string, sourcePeriodKey: string) => {
    if (!activeTargetUid) return;
    const targetWs = worksheets.find(
      (w) => w.userId === activeTargetUid && w.periodKey === sourcePeriodKey
    );
    if (!targetWs) return;
    const updated = targetWs.obligations.filter((ob) => ob.id !== itemId);
    await saveWorksheetDoc(
      activeTargetUid,
      activeTargetName,
      sourcePeriodKey,
      targetWs.fixedSalary,
      updated
    );
  };

  const handleAutoLoadFixedTemplate = async () => {
    if (!activeTargetUid) return;
    const { wsQ1, wsQ2 } = getUserPeriodDocs(activeTargetUid);
    const q1Key = `${yearMonthPrefix}-Q1`;
    const q2Key = `${yearMonthPrefix}-Q2`;

    const userFixedSources = incomeSources.filter(
      (s) => s.type === 'fijo' && s.ownerId === activeTargetUid
    );
    const fallbackRecInc = recurringPayments
      .filter((p) => p.flowType === 'income' && p.ownerId === activeTargetUid)
      .reduce((s, x) => s + Number(x.amount || 0), 0);

    const detectedQuincenaSalary =
      userFixedSources.length > 0
        ? userFixedSources.reduce((s, x) => s + Number(x.defaultAmount || 0), 0)
        : fallbackRecInc;

    const existingQ1 = new Set((wsQ1?.obligations || []).map((o) => o.concept.toLowerCase()));
    const existingQ2 = new Set((wsQ2?.obligations || []).map((o) => o.concept.toLowerCase()));
    const importedQ1: WorksheetObligationItem[] = [...(wsQ1?.obligations || [])];
    const importedQ2: WorksheetObligationItem[] = [...(wsQ2?.obligations || [])];

    for (const rp of recurringPayments) {
      if (rp.flowType === 'income') continue;
      if (rp.ownerId !== activeTargetUid) continue;
      const days: number[] = rp.days || [];

      if (days.some((d) => d <= 15) && !existingQ1.has(rp.title.toLowerCase())) {
        importedQ1.push({
          id: `ob_rp_${rp.id}_q1`,
          concept: rp.title,
          amount: Number(rp.amount || 0),
          paid: false,
        });
      }
      if (days.some((d) => d > 15) && !existingQ2.has(rp.title.toLowerCase())) {
        importedQ2.push({
          id: `ob_rp_${rp.id}_q2`,
          concept: rp.title,
          amount: Number(rp.amount || 0),
          paid: false,
        });
      }
    }

    await saveWorksheetDoc(
      activeTargetUid,
      activeTargetName,
      q1Key,
      wsQ1?.fixedSalary || detectedQuincenaSalary,
      importedQ1
    );
    await saveWorksheetDoc(
      activeTargetUid,
      activeTargetName,
      q2Key,
      wsQ2?.fixedSalary || detectedQuincenaSalary,
      importedQ2
    );
  };

  const currentUserMetrics = selectedView === 'partner' ? partnerMetrics : myMetrics;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Selector Limpio de Miembro / Consolidado */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: partner ? '1fr 1fr 1.2fr' : '1fr 1fr',
          backgroundColor: 'var(--color-surface-container)',
          padding: '4px',
          borderRadius: '12px',
          gap: '4px',
        }}
      >
        <button
          type="button"
          onClick={() => setSelectedView('me')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '10px 8px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: selectedView === 'me' ? 600 : 500,
            backgroundColor:
              selectedView === 'me' ? 'var(--color-surface-container-lowest)' : 'transparent',
            color:
              selectedView === 'me' ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
            boxShadow: selectedView === 'me' ? 'var(--shadow-level-1)' : 'none',
          }}
        >
          <User size={15} />
          <span>{myName}</span>
        </button>

        {partner && (
          <button
            type="button"
            onClick={() => setSelectedView('partner')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '10px 8px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: selectedView === 'partner' ? 600 : 500,
              backgroundColor:
                selectedView === 'partner'
                  ? 'var(--color-surface-container-lowest)'
                  : 'transparent',
              color:
                selectedView === 'partner'
                  ? 'var(--color-primary)'
                  : 'var(--color-on-surface-variant)',
              boxShadow: selectedView === 'partner' ? 'var(--shadow-level-1)' : 'none',
            }}
          >
            <User size={15} />
            <span>{partnerName}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setSelectedView('consolidated')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '10px 8px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: selectedView === 'consolidated' ? 600 : 500,
            backgroundColor:
              selectedView === 'consolidated'
                ? 'var(--color-surface-container-lowest)'
                : 'transparent',
            color:
              selectedView === 'consolidated'
                ? 'var(--color-primary)'
                : 'var(--color-on-surface-variant)',
            boxShadow: selectedView === 'consolidated' ? 'var(--shadow-level-1)' : 'none',
          }}
        >
          <Users size={15} />
          <span>Consolidado Hogar</span>
        </button>
      </div>

      {/* ================================================================= */}
      {/* PONDERADO MENSUAL Y QUINCENAL DE INGRESOS FIJOS                   */}
      {/* ================================================================= */}
      <Card style={{ padding: '16px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={18} color="var(--color-primary)" />
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>
                Ingresos Fijos Quincenales y Ponderado Mensual
              </h3>
              <p
                style={{
                  fontSize: '11px',
                  color: 'var(--color-on-surface-variant)',
                  margin: 0,
                }}
              >
                Toca una quincena para filtrar o &quot;Total Mensual&quot; para ver todos
              </p>
            </div>
          </div>

          {selectedView !== 'consolidated' && (
            <button
              type="button"
              onClick={() => openAddPopup('income')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: 'var(--color-primary-container)',
                color: 'var(--color-primary-dark)',
              }}
            >
              <Pencil size={12} /> Sueldo Fijo
            </button>
          )}
        </div>

        {selectedView !== 'consolidated' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
            }}
          >
            <div
              onClick={() => onChangeQuincenaFilter?.('q1')}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor:
                  quincenaFilter === 'q1'
                    ? 'var(--color-primary-container)'
                    : 'var(--color-surface-container-low)',
                border:
                  quincenaFilter === 'q1'
                    ? '1.5px solid var(--color-primary)'
                    : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                1ª Quincena (Día 15)
              </div>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  marginTop: '2px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(activeWeighted.q1Salary)}
              </div>
            </div>

            <div
              onClick={() => onChangeQuincenaFilter?.('q2')}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor:
                  quincenaFilter === 'q2'
                    ? 'var(--color-primary-container)'
                    : 'var(--color-surface-container-low)',
                border:
                  quincenaFilter === 'q2'
                    ? '1.5px solid var(--color-primary)'
                    : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                2ª Quincena (Día 30)
              </div>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  marginTop: '2px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(activeWeighted.q2Salary)}
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-surface-container-low)',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                Ponderado Quincenal
              </div>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  marginTop: '2px',
                  color: 'var(--color-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(activeWeighted.quincenalAverage)}
              </div>
            </div>

            <div
              onClick={() => onChangeQuincenaFilter?.('all')}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor:
                  quincenaFilter === 'all'
                    ? 'var(--color-primary-container)'
                    : 'var(--color-surface-container-low)',
                border:
                  quincenaFilter === 'all'
                    ? '1.5px solid var(--color-primary)'
                    : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--color-primary-dark)', fontWeight: 600 }}>
                Total Mensual (Todos)
              </div>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  marginTop: '2px',
                  color: 'var(--color-primary-dark)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(activeWeighted.monthlyTotalSalary)}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-surface-container-low)',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                {myName} (Mensual)
              </div>
              <div style={{ fontSize: '15px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatCOP(myMonthlyWeighted.monthlyTotalSalary)}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
                Q1: {formatCOP(myMonthlyWeighted.q1Salary)} · Q2: {formatCOP(myMonthlyWeighted.q2Salary)}
              </div>
            </div>

            {partner && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-container-low)',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  {partnerName} (Mensual)
                </div>
                <div
                  style={{ fontSize: '15px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatCOP(partnerMonthlyWeighted.monthlyTotalSalary)}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--color-on-surface-variant)',
                    marginTop: '2px',
                  }}
                >
                  Q1: {formatCOP(partnerMonthlyWeighted.q1Salary)} · Q2:{' '}
                  {formatCOP(partnerMonthlyWeighted.q2Salary)}
                </div>
              </div>
            )}

            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-surface-container-low)',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                Ponderado Quincenal Hogar
              </div>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(householdMonthlyWeighted.quincenalAverage)}
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-primary-container)',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--color-primary-dark)', fontWeight: 600 }}>
                Total Mensual Hogar
              </div>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: 'var(--color-primary-dark)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCOP(householdMonthlyWeighted.monthlyTotalSalary)}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* ================================================================= */}
      {/* VISTA INDIVIDUAL LIMPIA (SUELDO FIJO - GASTOS FIJOS = RESTANTE)   */}
      {/* ================================================================= */}
      {selectedView !== 'consolidated' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Card style={{ padding: '16px' }}>
            {/* Cabecera Limpia con Botón de Popup */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '14px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
                  Gastos Fijos · {activeTargetName}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  {periodLabel}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAutoLoadFixedTemplate}
                  title="Importar fijos programados"
                >
                  <Sparkles size={14} style={{ marginRight: '4px' }} /> Plantillas
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => openAddPopup('expense')}
                >
                  <Plus size={15} style={{ marginRight: '4px' }} /> + Gasto Fijo
                </Button>
              </div>
            </div>

            {/* 3 KPIs Alineados (Sueldo Fijo | Gastos Fijos | Restante Fijo) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                padding: '12px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-surface-container-low)',
                marginBottom: '16px',
              }}
            >
              <div
                onClick={() => openAddPopup('income')}
                style={{ cursor: 'pointer' }}
                title="Toca para editar tu sueldo fijo"
              >
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Sueldo Fijo
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: 'var(--color-on-surface)',
                    marginTop: '2px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(currentUserMetrics.fixedSalary)}
                </div>
              </div>

              <div
                style={{
                  borderLeft: '1px solid var(--color-outline-variant)',
                  paddingLeft: '10px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Total Fijos
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
                  {formatCOP(currentUserMetrics.totalFixedObligations)}
                </div>
              </div>

              <div
                style={{
                  borderLeft: '1px solid var(--color-outline-variant)',
                  paddingLeft: '10px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Restante
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color:
                      currentUserMetrics.fixedRemaining >= 0
                        ? 'var(--color-success)'
                        : 'var(--color-error)',
                    marginTop: '2px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(currentUserMetrics.fixedRemaining)}
                </div>
              </div>
            </div>

            {/* Lista de Gastos Fijos Perfectamente Alineada */}
            {currentUserMetrics.obligations.length === 0 ? (
              <div
                style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                  borderRadius: '12px',
                  border: '1px dashed var(--color-outline-variant)',
                }}
              >
                <p
                  style={{
                    fontSize: '13px',
                    color: 'var(--color-on-surface-variant)',
                    marginBottom: '12px',
                  }}
                >
                  No tienes gastos fijos registrados en esta vista ({periodLabel}).
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => openAddPopup('expense')}
                >
                  <Plus size={15} style={{ marginRight: '4px' }} /> Ingresar Gasto Fijo
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {currentUserMetrics.obligations.map((ob, index) => {
                  const isNegative = ob.amount < 0;
                  const isLast = index === currentUserMetrics.obligations.length - 1;
                  return (
                    <div
                      key={`${ob.sourcePeriodKey}_${ob.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '12px 4px',
                        borderBottom: isLast
                          ? 'none'
                          : '1px solid var(--color-surface-container)',
                      }}
                    >
                      {/* Columna Izquierda: Check + Concepto + Etiqueta de Quincena */}
                      <div
                        onClick={() => handleTogglePaid(ob.id, ob.sourcePeriodKey)}
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
                          <Circle
                            size={18}
                            color="var(--color-outline)"
                            style={{ flexShrink: 0 }}
                          />
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
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              marginTop: '2px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '11px',
                                color: 'var(--color-on-surface-variant)',
                              }}
                            >
                              {ob.quincenaTag}
                            </span>
                            {isNegative && (
                              <span
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                  borderRadius: '999px',
                                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                                  color: 'var(--color-success)',
                                  fontWeight: 600,
                                }}
                              >
                                Ahorro a favor
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Columna Derecha: Monto Tabular + Botón Eliminar */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums',
                            color: isNegative
                              ? 'var(--color-success)'
                              : 'var(--color-on-surface)',
                          }}
                        >
                          {formatCOP(ob.amount)}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleDeleteObligation(ob.id, ob.sourcePeriodKey)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            color: 'var(--color-outline)',
                          }}
                          title="Eliminar gasto fijo"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* =============================================================== */}
          {/* BOLSILLO DE VARIABLES Y PAGOS ESPORÁDICOS DEL USUARIO           */}
          {/* =============================================================== */}
          <Card style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h4 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
                  Disponible para Pagos Esporádicos ({activeTargetName})
                </h4>
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--color-on-surface-variant)',
                    marginTop: '2px',
                  }}
                >
                  Restante de sueldo fijo + ingresos variables menos gastos extras
                </p>
              </div>
              <Wallet size={18} color="var(--color-primary)" />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginTop: '14px',
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-container-low)',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Restante Sueldo Fijo
                </span>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    marginTop: '2px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(currentUserMetrics.fixedRemaining)}
                </div>
              </div>

              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-container-low)',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  + Ingresos Variables
                </span>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    marginTop: '2px',
                    color: 'var(--color-success)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  +{formatCOP(currentUserMetrics.variableIncome)}
                </div>
              </div>

              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-container-low)',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Cupo para Extras
                </span>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    marginTop: '2px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(currentUserMetrics.totalAvailableForExtras)}
                </div>
              </div>

              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-container-low)',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  - Pagos Esporádicos
                </span>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    marginTop: '2px',
                    color: 'var(--color-error)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  -{formatCOP(currentUserMetrics.extraExpenses)}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: '12px',
                padding: '12px 14px',
                borderRadius: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor:
                  currentUserMetrics.finalNetAvailable >= 0
                    ? 'rgba(16, 185, 129, 0.1)'
                    : 'rgba(239, 68, 68, 0.1)',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '13px' }}>
                Libre Real después de Extras
              </span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '16px',
                  fontVariantNumeric: 'tabular-nums',
                  color:
                    currentUserMetrics.finalNetAvailable >= 0
                      ? 'var(--color-success)'
                      : 'var(--color-error)',
                }}
              >
                {formatCOP(currentUserMetrics.finalNetAvailable)}
              </span>
            </div>
          </Card>
        </div>
      ) : (
        /* ================================================================= */
        /* VISTA CONSOLIDADO GENERAL DEL HOGAR LIMPIA Y ALINEADA             */
        /* ================================================================= */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Card style={{ padding: '16px' }}>
            <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              CONSOLIDADO GENERAL DEL HOGAR · {periodLabel}
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
                  Sueldos Fijos
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    marginTop: '2px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(consolidatedMetrics.fixedSalary)}
                </div>
              </div>
              <div
                style={{
                  borderLeft: '1px solid var(--color-outline-variant)',
                  paddingLeft: '10px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Total Fijos
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
                  {formatCOP(consolidatedMetrics.totalFixedObligations)}
                </div>
              </div>
              <div
                style={{
                  borderLeft: '1px solid var(--color-outline-variant)',
                  paddingLeft: '10px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Restante Fijos
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
                  {formatCOP(consolidatedMetrics.fixedRemaining)}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: '12px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                fontSize: '12px',
                padding: '0 4px',
              }}
            >
              <div>
                <div style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px' }}>
                  + Ingresos Variables
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--color-success)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  +{formatCOP(consolidatedMetrics.variableIncome)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px' }}>
                  - Pagos Esporádicos
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--color-error)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  -{formatCOP(consolidatedMetrics.extraExpenses)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px' }}>
                  Libre Neto Hogar
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    color: 'var(--color-primary)',
                    fontSize: '14px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCOP(consolidatedMetrics.finalNetAvailable)}
                </div>
              </div>
            </div>
          </Card>

          {/* Resumen Individual Lado a Lado */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: partner ? '1fr 1fr' : '1fr',
              gap: '10px',
            }}
          >
            {[
              { name: myName, metrics: myMetrics, viewKey: 'me' as const },
              ...(partner
                ? [{ name: partnerName, metrics: partnerMetrics, viewKey: 'partner' as const }]
                : []),
            ].map((u) => (
              <Card
                key={u.name}
                style={{ padding: '14px', cursor: 'pointer' }}
                onClick={() => setSelectedView(u.viewKey)}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: '8px',
                    marginBottom: '10px',
                    borderBottom: '1px solid var(--color-surface-container)',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{u.name}</span>
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--color-primary)',
                      fontWeight: 600,
                    }}
                  >
                    Ver detalle →
                  </span>
                </div>

                <div
                  style={{
                    fontSize: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-on-surface-variant)' }}>Sueldo Fijo</span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCOP(u.metrics.fixedSalary)}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-on-surface-variant)' }}>Gastos Fijos</span>
                    <strong
                      style={{ color: 'var(--color-error)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatCOP(u.metrics.totalFixedObligations)}
                    </strong>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--color-surface-container-low)',
                      fontWeight: 600,
                    }}
                  >
                    <span>Restante Fijo</span>
                    <span
                      style={{
                        color:
                          u.metrics.fixedRemaining >= 0
                            ? 'var(--color-success)'
                            : 'var(--color-error)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatCOP(u.metrics.fixedRemaining)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '2px',
                    }}
                  >
                    <span style={{ color: 'var(--color-on-surface-variant)' }}>+ Variables</span>
                    <span
                      style={{
                        color: 'var(--color-success)',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      +{formatCOP(u.metrics.variableIncome)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-on-surface-variant)' }}>- Esporádicos</span>
                    <span
                      style={{
                        color: 'var(--color-error)',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      -{formatCOP(u.metrics.extraExpenses)}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

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
          style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}
        >
          {/* Selector Tipo: Gasto Fijo vs Ingreso Fijo */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              backgroundColor: 'var(--color-surface-container)',
              padding: '4px',
              borderRadius: '10px',
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
                padding: '9px',
                borderRadius: '8px',
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
                padding: '9px',
                borderRadius: '8px',
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

          {/* Selector de Quincena */}
          <div>
            <label className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              Quincena en la que aplica
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
                      padding: '9px 6px',
                      borderRadius: '8px',
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
