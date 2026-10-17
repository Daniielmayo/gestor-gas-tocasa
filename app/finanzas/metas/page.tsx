'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ScopeFilterBar } from '@/components/ui/ScopeFilterBar';
import {
  ArrowLeft,
  Plus,
  Target,
  Trash2,
  PiggyBank,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
} from 'lucide-react';
import styles from './metas.module.css';
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
import { Scope } from '@/lib/models';

interface ContributionItem {
  id: string;
  userId: string;
  userName: string;
  amount: number;
  type: 'add' | 'withdraw';
  dateIso: string;
}

interface SavingGoal {
  id: string;
  householdId?: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  ownerId: string;
  sharedWith?: string[];
  scope?: Scope;
  targetDate?: string | null;
  status?: 'activa' | 'completada' | 'pausada';
  contributions?: ContributionItem[];
}

export default function MetasAhorro() {
  const { user, profile, loading } = useAuth();
  const { household, partner, partnerUid, globalScope, paymentMethods } = useHousehold();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [isReady, setIsReady] = useState(false);
  const [savings, setSavings] = useState<SavingGoal[]>([]);

  // Modals state
  const [isNewSavingModalOpen, setIsNewSavingModalOpen] = useState(false);
  const [savingTitle, setSavingTitle] = useState('');
  const [savingTarget, setSavingTarget] = useState('');
  const [savingInitialAmount, setSavingInitialAmount] = useState('');
  const [savingTargetDate, setSavingTargetDate] = useState('');
  const [savingScope, setSavingScope] = useState<Scope>('conjunto');
  const [savingPaymentMethodId, setSavingPaymentMethodId] = useState('');

  const [isContributeModalOpen, setIsContributeModalOpen] = useState(false);
  const [selectedSaving, setSelectedSaving] = useState<SavingGoal | null>(null);
  const [contributeType, setContributeType] = useState<'add' | 'withdraw'>('add');
  const [contributeAmount, setContributeAmount] = useState('');
  const [contributorUid, setContributorUid] = useState('');
  const [contributePaymentMethodId, setContributePaymentMethodId] = useState('');

  const [isDeleteSavingModalOpen, setIsDeleteSavingModalOpen] = useState(false);
  const [savingToDelete, setSavingToDelete] = useState<SavingGoal | null>(null);

  const [isEditSavingModalOpen, setIsEditSavingModalOpen] = useState(false);
  const [editSavingTitle, setEditSavingTitle] = useState('');
  const [editSavingTarget, setEditSavingTarget] = useState('');
  const [editSavingTargetDate, setEditSavingTargetDate] = useState('');
  const [editSavingStatus, setEditSavingStatus] = useState<'activa' | 'completada' | 'pausada'>('activa');

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setContributorUid(user.uid);
    const hhId = household?.id || '';

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

    const savRef = collection(db, 'savings');
    const qSav = query(savRef, or(...clauses));
    const unsubSav = onSnapshot(qSav, (snapshot) => {
      const data: SavingGoal[] = [];
      snapshot.forEach((d) => data.push({ id: d.id, ...d.data() } as SavingGoal));
      setSavings(data);
      setIsReady(true);
    });

    return () => {
      unsubSav();
    };
  }, [user, partnerUid, household?.id]);

  const handleCreateSaving = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!savingTitle.trim() || !savingTarget || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      const sharedArray = partnerUid ? [partnerUid] : [];
      const initAmt = parseCOP(savingInitialAmount || '0');
      const targetAmt = parseCOP(savingTarget);
      const isCompleted = initAmt >= targetAmt && targetAmt > 0;

      const contributionsList: ContributionItem[] = [];
      if (initAmt > 0) {
        contributionsList.push({
          id: `c_${Date.now()}`,
          userId: user.uid,
          userName: profile?.displayName?.split(' ')[0] || 'Yo',
          amount: initAmt,
          type: 'add',
          dateIso: new Date().toISOString(),
        });
      }

      const savingDocRef = await addDoc(collection(db, 'savings'), {
        householdId: household?.id || 'default',
        title: savingTitle.trim(),
        targetAmount: targetAmt,
        currentAmount: initAmt,
        scope: savingScope,
        targetDate: savingTargetDate || null,
        status: isCompleted ? 'completada' : 'activa',
        contributions: contributionsList,
        ownerId: user.uid,
        sharedWith: sharedArray,
        createdAt: Timestamp.now(),
      });

      // If created with an initial amount, immediately deduct it from general balance as an expense/pocket
      if (initAmt > 0) {
        await addDoc(collection(db, 'transactions'), {
          type: 'expense',
          amount: initAmt,
          category: 'Ahorro / Meta',
          place: `Bolsillo: ${savingTitle.trim()}`,
          description: `Aporte inicial a meta: ${savingTitle.trim()}`,
          title: `Meta: ${savingTitle.trim()}`,
          scope: savingScope,
          paidByUserId: user.uid,
          paidByName: profile?.displayName?.split(' ')[0] || 'Yo',
          paymentMethodId: savingPaymentMethodId || null,
          householdId: household?.id || '',
          tags: ['ahorro', 'bolsillo'],
          ownerId: user.uid,
          ownerName: profile?.displayName?.split(' ')[0] || 'Usuario',
          sharedWith: sharedArray,
          deletedAt: null,
          createdAt: Timestamp.now(),
        });
      }

      setIsNewSavingModalOpen(false);
      setSavingTitle('');
      setSavingTarget('');
      setSavingInitialAmount('');
      setSavingTargetDate('');
      setSavingScope('conjunto');
      setSavingPaymentMethodId('');
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContributeSaving = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSaving || !contributeAmount || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      const amt = parseCOP(contributeAmount);
      const isAdd = contributeType === 'add';
      const chosenUid = contributorUid || user.uid;
      const chosenName =
        chosenUid === user.uid
          ? profile?.displayName?.split(' ')[0] || 'Yo'
          : partner?.displayName?.split(' ')[0] || 'Pareja';

      const newCurrent = Math.max(0, (selectedSaving.currentAmount || 0) + (isAdd ? amt : -amt));
      const newStatus =
        newCurrent >= selectedSaving.targetAmount ? 'completada' : selectedSaving.status || 'activa';

      const contributionEntry: ContributionItem = {
        id: `c_${Date.now()}`,
        userId: chosenUid,
        userName: chosenName,
        amount: amt,
        type: contributeType,
        dateIso: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'savings', selectedSaving.id), {
        currentAmount: increment(isAdd ? amt : -amt),
        status: newStatus,
        contributions: arrayUnion(contributionEntry),
      });

      const goalScope: Scope =
        selectedSaving.scope ||
        (selectedSaving.sharedWith && selectedSaving.sharedWith.length > 0 ? 'conjunto' : 'personal');

      const sharedArray = partnerUid ? [partnerUid] : [];

      // Aporte descontando del saldo general (expense) o Retiro reintegrando al saldo general (income)
      await addDoc(collection(db, 'transactions'), {
        type: isAdd ? 'expense' : 'income',
        amount: amt,
        category: 'Ahorro / Meta',
        place: `Bolsillo: ${selectedSaving.title}`,
        description: `${isAdd ? 'Aporte a bolsillo de ahorro' : 'Retiro de bolsillo de ahorro'}: ${selectedSaving.title}`,
        title: `Meta: ${selectedSaving.title}`,
        scope: goalScope,
        paidByUserId: chosenUid,
        paidByName: chosenName,
        paymentMethodId: contributePaymentMethodId || null,
        householdId: household?.id || selectedSaving.householdId || '',
        tags: ['ahorro', 'bolsillo'],
        ownerId: user.uid,
        ownerName: profile?.displayName?.split(' ')[0] || 'Usuario',
        sharedWith: sharedArray,
        deletedAt: null,
        createdAt: Timestamp.now(),
      });

      setIsContributeModalOpen(false);
      setContributeAmount('');
      setContributePaymentMethodId('');
      setSelectedSaving(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSaving = async () => {
    if (!savingToDelete) return;
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'savings', savingToDelete.id));
      setIsDeleteSavingModalOpen(false);
      setSavingToDelete(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (saving: SavingGoal) => {
    setSelectedSaving(saving);
    setEditSavingTitle(saving.title);
    setEditSavingTarget(formatInputCOP(String(saving.targetAmount)));
    setEditSavingTargetDate(saving.targetDate || '');
    setEditSavingStatus(saving.status || 'activa');
    setIsEditSavingModalOpen(true);
  };

  const handleEditSaving = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSaving || !editSavingTitle.trim() || !editSavingTarget || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'savings', selectedSaving.id), {
        title: editSavingTitle.trim(),
        targetAmount: parseCOP(editSavingTarget),
        targetDate: editSavingTargetDate || null,
        status: editSavingStatus,
      });

      setIsEditSavingModalOpen(false);
      setSelectedSaving(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateSuggestedMonthly = (goal: SavingGoal): number | null => {
    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    if (remaining <= 0 || !goal.targetDate) return null;
    const now = new Date();
    const target = new Date(`${goal.targetDate}T12:00:00`);
    const monthsDiff =
      (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
    const monthsLeft = Math.max(1, monthsDiff);
    return Math.ceil(remaining / monthsLeft);
  };

  if (loading || !user || !isReady) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando metas..." />
      </main>
    );
  }

  const filteredSavings = savings.filter((s) => {
    const scope: Scope =
      s.scope || (s.sharedWith && s.sharedWith.length > 0 ? 'conjunto' : 'personal');
    if (globalScope === 'mio') {
      return scope === 'personal' && s.ownerId === user.uid;
    }
    if (globalScope === 'conjunto') {
      return scope === 'conjunto';
    }
    if (globalScope === 'pareja' && partnerUid) {
      return s.ownerId === partnerUid;
    }
    return true;
  });

  const totalSavingsTarget = filteredSavings.reduce((sum, s) => sum + s.targetAmount, 0);
  const totalSavingsCurrent = filteredSavings.reduce((sum, s) => sum + s.currentAmount, 0);
  const overallSavingsProgress =
    totalSavingsTarget > 0 ? Math.min(100, Math.round((totalSavingsCurrent / totalSavingsTarget) * 100)) : 0;

  return (
    <main className={`container ${styles.main}`}>
      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link href="/finanzas">
            <Button variant="ghost" className={styles.iconBtn}>
              <ArrowLeft size={24} />
            </Button>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 className="text-headline-md">Metas de Ahorro</h1>
            {partner && (
              <AvatarGroup
                users={[usersMap[user.uid], usersMap[partner.uid]].filter(Boolean) as any}
                size="sm"
              />
            )}
          </div>
        </div>
      </header>

      <div style={{ marginBottom: '12px' }}>
        <ScopeFilterBar />
      </div>

      {filteredSavings.length > 0 && (
        <Card
          style={{
            marginTop: '8px',
            marginBottom: '8px',
            background:
              'linear-gradient(135deg, var(--color-success) 0%, var(--color-success-dark, #0f766e) 100%)',
            color: '#fff',
            border: 'none',
          }}
        >
          <h2 className="text-label-md" style={{ color: 'rgba(255,255,255,0.8)', marginBottom: '8px' }}>
            Resumen de Ahorros ({globalScope.toUpperCase()})
          </h2>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              marginBottom: '16px',
            }}
          >
            <div>
              <p className="text-label-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
                Total Ahorrado
              </p>
              <p className="text-headline-md" style={{ color: '#fff' }}>
                {formatCOP(totalSavingsCurrent)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="text-label-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
                Meta Global
              </p>
              <p className="text-body-md" style={{ color: '#fff' }}>
                {formatCOP(totalSavingsTarget)}
              </p>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span className="text-label-sm" style={{ color: 'rgba(255,255,255,0.9)' }}>
                Faltante: {formatCOP(Math.max(0, totalSavingsTarget - totalSavingsCurrent))}
              </span>
              <span className="text-label-sm" style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 'bold' }}>
                {overallSavingsProgress}%
              </span>
            </div>
            <div className={styles.savingProgressBg} style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
              <div
                className={styles.savingProgressFill}
                style={{ width: `${overallSavingsProgress}%`, backgroundColor: '#fff' }}
              />
            </div>
          </div>
        </Card>
      )}

      <section className={styles.savingsSection}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '16px',
          }}
        >
          <h3 className={styles.sectionTitle}>Tus Metas</h3>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsNewSavingModalOpen(true)}
            aria-label="Nueva meta de ahorro"
          >
            <Plus size={16} /> Nueva Meta
          </Button>
        </div>

        {filteredSavings.length === 0 ? (
          <div className={styles.emptySavings}>
            <PiggyBank size={32} color="var(--color-on-surface-variant)" />
            <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              No tienes metas de ahorro en esta vista.
            </p>
          </div>
        ) : (
          <div className={styles.savingsList}>
            {filteredSavings.map((s) => {
              const progress = Math.min((s.currentAmount / s.targetAmount) * 100, 100);
              const remaining = Math.max(0, s.targetAmount - s.currentAmount);
              const suggestedMonthly = calculateSuggestedMonthly(s);
              const status = s.status || (progress >= 100 ? 'completada' : 'activa');

              return (
                <div
                  key={s.id}
                  className={styles.savingCard}
                  onClick={() => {
                    setSelectedSaving(s);
                    setIsContributeModalOpen(true);
                  }}
                >
                  <div className={styles.savingHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Target size={20} color="var(--color-primary)" />
                      <span className="text-body-md" style={{ fontWeight: 600 }}>
                        {s.title}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontWeight: 600,
                          backgroundColor:
                            status === 'completada'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : status === 'pausada'
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'var(--color-primary-container)',
                          color:
                            status === 'completada'
                              ? 'var(--color-success)'
                              : status === 'pausada'
                              ? 'var(--color-warning)'
                              : 'var(--color-primary-dark)',
                        }}
                      >
                        {status.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                        {progress.toFixed(0)}%
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(s);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-on-surface-variant)',
                            cursor: 'pointer',
                            padding: '4px',
                          }}
                          aria-label="Editar meta"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSavingToDelete(s);
                            setIsDeleteSavingModalOpen(true);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-on-surface-variant)',
                            cursor: 'pointer',
                            padding: '4px',
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className={styles.savingProgressBg}>
                    <div className={styles.savingProgressFill} style={{ width: `${progress}%` }} />
                  </div>

                  <div className={styles.savingAmounts}>
                    <span className="text-label-sm" style={{ color: 'var(--color-on-surface)' }}>
                      {formatCOP(s.currentAmount)} ahorrado
                    </span>
                    <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                      Faltan {formatCOP(remaining)} (Meta: {formatCOP(s.targetAmount)})
                    </span>
                  </div>

                  {(s.targetDate || suggestedMonthly) && (
                    <div
                      style={{
                        marginTop: '8px',
                        paddingTop: '8px',
                        borderTop: '1px solid var(--color-surface-container)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: 'var(--color-on-surface-variant)',
                      }}
                    >
                      {s.targetDate && <span>Fecha objetivo: {s.targetDate}</span>}
                      {suggestedMonthly && (
                        <span style={{ color: 'var(--color-primary-dark)', fontWeight: 600 }}>
                          Sugerido: {formatCOP(suggestedMonthly)} / mes
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Create Goal Modal */}
      <Modal
        isOpen={isNewSavingModalOpen}
        onClose={() => setIsNewSavingModalOpen(false)}
        title="Nueva Meta de Ahorro (RF-10)"
      >
        <form
          onSubmit={handleCreateSaving}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}
        >
          <Input
            label="Nombre de la meta"
            value={savingTitle}
            onChange={(e) => setSavingTitle(e.target.value)}
            placeholder="Ej: Viaje a Europa, Fondo de Emergencia"
            required
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input
              label="Monto objetivo ($)"
              type="text"
              inputMode="numeric"
              value={savingTarget}
              onChange={(e) => setSavingTarget(formatInputCOP(e.target.value))}
              placeholder="Ej. 5.000.000"
              required
            />
            <Input
              label="Aporte inicial (Bolsillo)"
              type="text"
              inputMode="numeric"
              value={savingInitialAmount}
              onChange={(e) => setSavingInitialAmount(formatInputCOP(e.target.value))}
              placeholder="Ej. 100.000 (Opcional)"
            />
          </div>

          {paymentMethods.length > 0 && savingInitialAmount && parseCOP(savingInitialAmount) > 0 && (
            <div>
              <label className="text-label-sm" style={{ display: 'block', marginBottom: '6px' }}>
                Cuenta o medio de donde sale el dinero (Bolsillo)
              </label>
              <select
                value={savingPaymentMethodId}
                onChange={(e) => setSavingPaymentMethodId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '11px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                }}
              >
                <option value="">Selecciona cuenta / método (Opcional)</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.alias} ({pm.holderName || 'Titular'})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input
              label="Fecha objetivo (Opcional)"
              type="date"
              value={savingTargetDate}
              onChange={(e) => setSavingTargetDate(e.target.value)}
            />
            <div>
              <label className="text-label-sm" style={{ display: 'block', marginBottom: '6px' }}>
                Ámbito
              </label>
              <select
                value={savingScope}
                onChange={(e) => setSavingScope(e.target.value as Scope)}
                style={{
                  width: '100%',
                  padding: '11px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                }}
              >
                <option value="conjunto">Conjunta (Pareja)</option>
                <option value="personal">Personal (Solo mía)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsNewSavingModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || !savingTitle || !savingTarget}>
              Crear Meta
            </Button>
          </div>
        </form>
      </Modal>

      {/* Contribute / Inspect History Modal */}
      <Modal
        isOpen={isContributeModalOpen}
        onClose={() => setIsContributeModalOpen(false)}
        title={selectedSaving?.title || ''}
      >
        <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            Ahorrado:{' '}
            <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>
              {formatCOP(selectedSaving?.currentAmount || 0)}
            </span>{' '}
            de {formatCOP(selectedSaving?.targetAmount || 0)}
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              type="button"
              variant={contributeType === 'add' ? 'primary' : 'secondary'}
              onClick={() => setContributeType('add')}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
            >
              <ArrowUpRight size={16} /> Aportar
            </Button>
            <Button
              type="button"
              variant={contributeType === 'withdraw' ? 'primary' : 'secondary'}
              onClick={() => setContributeType('withdraw')}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
            >
              <ArrowDownRight size={16} /> Retirar
            </Button>
          </div>
        </div>

        <form onSubmit={handleContributeSaving} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input
            label="Monto ($)"
            type="text"
            inputMode="numeric"
            value={contributeAmount}
            onChange={(e) => setContributeAmount(formatInputCOP(e.target.value))}
            placeholder="$ 0"
            required
          />

          {partner && (
            <div>
              <label className="text-label-sm">
                {contributeType === 'add' ? '¿Quién aporta?' : '¿Quién recibe el retiro?'}
              </label>
              <select
                value={contributorUid || user.uid}
                onChange={(e) => setContributorUid(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                  marginTop: '4px',
                }}
              >
                <option value={user.uid}>{profile?.displayName?.split(' ')[0] || 'Yo'}</option>
                <option value={partner.uid}>{partner.displayName?.split(' ')[0] || 'Pareja'}</option>
              </select>
            </div>
          )}

          {paymentMethods.length > 0 && (
            <div>
              <label className="text-label-sm">
                {contributeType === 'add'
                  ? 'Cuenta o medio de origen (Bolsillo)'
                  : 'Cuenta o medio de destino (Reintegro)'}
              </label>
              <select
                value={contributePaymentMethodId}
                onChange={(e) => setContributePaymentMethodId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                  backgroundColor: 'var(--color-surface-container-lowest)',
                  marginTop: '4px',
                }}
              >
                <option value="">Selecciona cuenta / método (Opcional)</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.alias} ({pm.holderName || 'Titular'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Historial de aportes a la meta */}
          {selectedSaving?.contributions && selectedSaving.contributions.length > 0 && (
            <div
              style={{
                maxHeight: '140px',
                overflowY: 'auto',
                padding: '10px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-surface-container-low)',
              }}
            >
              <span className="text-label-sm">Últimos movimientos de esta meta:</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                {[...selectedSaving.contributions].reverse().map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                    }}
                  >
                    <span>
                      <strong>{c.userName}</strong> • {new Date(c.dateIso).toLocaleDateString()}
                    </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: c.type === 'add' ? 'var(--color-success)' : 'var(--color-error)',
                      }}
                    >
                      {c.type === 'add' ? '+' : '-'}
                      {formatCOP(c.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsContributeModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || !contributeAmount}>
              {contributeType === 'add' ? 'Registrar Aporte' : 'Registrar Retiro'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isDeleteSavingModalOpen}
        onClose={() => setIsDeleteSavingModalOpen(false)}
        title="Eliminar Meta"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            ¿Estás seguro de que quieres eliminar la meta "{savingToDelete?.title}"?
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button type="button" variant="ghost" onClick={() => setIsDeleteSavingModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleDeleteSaving}
              disabled={isSubmitting}
              style={{ backgroundColor: 'var(--color-error)', color: 'white' }}
            >
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isEditSavingModalOpen}
        onClose={() => setIsEditSavingModalOpen(false)}
        title="Editar Meta"
      >
        <form
          onSubmit={handleEditSaving}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}
        >
          <Input
            label="Nombre de la meta"
            value={editSavingTitle}
            onChange={(e) => setEditSavingTitle(e.target.value)}
            required
          />
          <Input
            label="Monto objetivo ($)"
            type="text"
            inputMode="numeric"
            value={editSavingTarget}
            onChange={(e) => setEditSavingTarget(formatInputCOP(e.target.value))}
            required
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input
              label="Fecha objetivo"
              type="date"
              value={editSavingTargetDate}
              onChange={(e) => setEditSavingTargetDate(e.target.value)}
            />
            <div>
              <label className="text-label-sm" style={{ display: 'block', marginBottom: '6px' }}>
                Estado
              </label>
              <select
                value={editSavingStatus}
                onChange={(e) =>
                  setEditSavingStatus(e.target.value as 'activa' | 'completada' | 'pausada')
                }
                style={{
                  width: '100%',
                  padding: '11px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-outline-variant)',
                }}
              >
                <option value="activa">Activa</option>
                <option value="pausada">Pausada</option>
                <option value="completada">Completada</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsEditSavingModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || !editSavingTitle || !editSavingTarget}>
              Guardar Cambios
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
