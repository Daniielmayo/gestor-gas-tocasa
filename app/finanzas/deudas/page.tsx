'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { UserEmailAutocomplete } from '@/components/ui/UserEmailAutocomplete';
import { ArrowLeft, Plus, Target, Trash2, ShieldAlert } from 'lucide-react';
import styles from './deudas.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, Timestamp, or, doc, setDoc, arrayUnion, getDocs, deleteDoc, updateDoc, increment } from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import { useUsersMap } from '@/lib/hooks/useUsersMap';

interface Debt {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  ownerId: string;
  sharedWith?: string[];
  linkedRecurringPaymentId?: string | null;
}

export default function Deudas() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [debts, setDebts] = useState<Debt[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'personal' | 'shared'>('all');

  const [financeSettings, setFinanceSettings] = useState<any>(null);
  const [recurringPayments, setRecurringPayments] = useState<any[]>([]);

  const [isNewDebtModalOpen, setIsNewDebtModalOpen] = useState(false);
  const [debtTitle, setDebtTitle] = useState('');
  const [debtTarget, setDebtTarget] = useState('');
  const [createShareEmail, setCreateShareEmail] = useState('');
  const [linkedRecurringPaymentId, setLinkedRecurringPaymentId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isEditDebtModalOpen, setIsEditDebtModalOpen] = useState(false);
  const [editDebtTitle, setEditDebtTitle] = useState('');
  const [editDebtTarget, setEditDebtTarget] = useState('');
  const [editCreateShareEmail, setEditCreateShareEmail] = useState('');
  const [editLinkedRecurringPaymentId, setEditLinkedRecurringPaymentId] = useState('');

  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<Debt | null>(null);
  const [payAmount, setPayAmount] = useState('');

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [debtToDelete, setDebtToDelete] = useState<Debt | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const settingsRef = doc(db, 'financeSettings', user.uid);
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setFinanceSettings(docSnap.data());
      } else {
        setFinanceSettings({ sharedWith: [] });
      }
    });

    const debtsRef = collection(db, 'debts');
    const qDebts = query(
      debtsRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );
    const unsubDebts = onSnapshot(qDebts, (snapshot) => {
      const data: Debt[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as Debt));
      setDebts(data);
      setIsReady(true);
    });

    const rpRef = collection(db, 'recurringPayments');
    const qRp = query(
      rpRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );
    const unsubRp = onSnapshot(qRp, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
      setRecurringPayments(data);
    });

    return () => {
      unsubSettings();
      unsubDebts();
      unsubRp();
    };
  }, [user]);

  const handleCreateDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debtTitle.trim() || !debtTarget || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      let currentSharedWith = financeSettings?.sharedWith || [];
      if (createShareEmail.trim()) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', createShareEmail.trim().toLowerCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const friendUid = snap.docs[0].data().uid;
          if (friendUid !== user.uid) {
            const settingsRef = doc(db, 'financeSettings', user.uid);
            await setDoc(settingsRef, { sharedWith: arrayUnion(friendUid) }, { merge: true });
            currentSharedWith = [...new Set([...currentSharedWith, friendUid])];
            if (!(financeSettings?.sharedWith || []).includes(friendUid)) {
              await addDoc(collection(db, 'notifications'), {
                userId: friendUid,
                title: 'Finanzas Compartidas',
                message: `${profile?.displayName || 'Alguien'} ha compartido sus deudas contigo.`,
                type: 'finance',
                link: '/finanzas/deudas',
                read: false,
                createdAt: Timestamp.now()
              });
            }
          }
        }
      }

      await addDoc(collection(db, 'debts'), {
        title: debtTitle.trim(),
        targetAmount: parseCOP(debtTarget),
        currentAmount: 0,
        ownerId: user.uid,
        sharedWith: currentSharedWith,
        linkedRecurringPaymentId: linkedRecurringPaymentId || null,
        createdAt: Timestamp.now()
      });
      setIsNewDebtModalOpen(false);
      setDebtTitle('');
      setDebtTarget('');
      setCreateShareEmail('');
      setLinkedRecurringPaymentId('');
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebt || !payAmount || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      const amt = parseCOP(payAmount);
      
      // Update debt amount
      await updateDoc(doc(db, 'debts', selectedDebt.id), {
        currentAmount: increment(amt)
      });
      
      // Add transaction (expense)
      await addDoc(collection(db, 'transactions'), {
        type: 'expense',
        amount: amt,
        category: `Abono a Deuda: ${selectedDebt.title}`,
        description: 'Pago registrado desde el módulo de Deudas',
        ownerId: user.uid,
        ownerName: profile?.displayName?.split(' ')[0] || 'Usuario',
        sharedWith: financeSettings?.sharedWith || [],
        createdAt: Timestamp.now(),
      });
      
      setIsPayModalOpen(false);
      setPayAmount('');
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

  const openEditModal = (d: Debt) => {
    setSelectedDebt(d);
    setEditDebtTitle(d.title);
    setEditDebtTarget(formatInputCOP(String(d.targetAmount)));
    setEditCreateShareEmail('');
    setEditLinkedRecurringPaymentId(d.linkedRecurringPaymentId || '');
    setIsEditDebtModalOpen(true);
  };

  const handleEditDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebt || !editDebtTitle.trim() || !editDebtTarget || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      let currentSharedWith = financeSettings?.sharedWith || [];
      if (editCreateShareEmail.trim()) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', editCreateShareEmail.trim().toLowerCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const friendUid = snap.docs[0].data().uid;
          if (friendUid !== user.uid) {
            const settingsRef = doc(db, 'financeSettings', user.uid);
            await setDoc(settingsRef, { sharedWith: arrayUnion(friendUid) }, { merge: true });
            currentSharedWith = [...new Set([...currentSharedWith, friendUid])];
          }
        }
      }

      await updateDoc(doc(db, 'debts', selectedDebt.id), {
        title: editDebtTitle.trim(),
        targetAmount: parseCOP(editDebtTarget),
        sharedWith: currentSharedWith,
        linkedRecurringPaymentId: editLinkedRecurringPaymentId || null,
      });

      setIsEditDebtModalOpen(false);
      setSelectedDebt(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || !user || !isReady) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando deudas..." />
      </main>
    );
  }

  const filteredDebts = debts.filter(d => {
    if (filterMode === 'personal') {
      return d.ownerId === user.uid && (!d.sharedWith || d.sharedWith.length === 0);
    } else if (filterMode === 'shared') {
      return d.ownerId !== user.uid || (d.sharedWith && d.sharedWith.length > 0);
    }
    return true;
  });

  const totalDebtTarget = filteredDebts.reduce((sum, d) => sum + d.targetAmount, 0);
  const totalDebtPaid = filteredDebts.reduce((sum, d) => sum + d.currentAmount, 0);
  const totalDebtRemaining = totalDebtTarget - totalDebtPaid;
  const overallProgressPercentage = totalDebtTarget > 0 ? Math.min(100, Math.round((totalDebtPaid / totalDebtTarget) * 100)) : 0;

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
            <h1 className="text-headline-md">Tus Deudas</h1>
            {(financeSettings?.sharedWith && financeSettings.sharedWith.length > 0) && (
              <AvatarGroup 
                users={[
                  usersMap[user?.uid || ''],
                  ...financeSettings.sharedWith.map((uid: string) => usersMap[uid])
                ].filter(Boolean) as any} 
                size="sm" 
              />
            )}
          </div>
        </div>
      </header>

      <section>
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
          <Button 
            variant={filterMode === 'all' ? 'primary' : 'secondary'} 
            onClick={() => setFilterMode('all')}
            style={{ borderRadius: '20px', padding: '4px 12px', fontSize: '14px', flex: '0 0 auto', minHeight: 'auto' }}
          >
            Todas
          </Button>
          <Button 
            variant={filterMode === 'personal' ? 'primary' : 'secondary'} 
            onClick={() => setFilterMode('personal')}
            style={{ borderRadius: '20px', padding: '4px 12px', fontSize: '14px', flex: '0 0 auto', minHeight: 'auto' }}
          >
            Personales
          </Button>
          <Button 
            variant={filterMode === 'shared' ? 'primary' : 'secondary'} 
            onClick={() => setFilterMode('shared')}
            style={{ borderRadius: '20px', padding: '4px 12px', fontSize: '14px', flex: '0 0 auto', minHeight: 'auto' }}
          >
            Compartidas
          </Button>
        </div>
      </section>

      {filteredDebts.length > 0 && (
        <Card style={{ marginTop: '16px', marginBottom: '8px', background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark, #0056b3) 100%)', color: '#fff', border: 'none' }}>
          <h2 className="text-label-md" style={{ color: 'rgba(255,255,255,0.8)', marginBottom: '8px' }}>
            Resumen de Deudas {filterMode === 'all' ? '' : filterMode === 'personal' ? 'Personales' : 'Compartidas'}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
            <div>
              <p className="text-label-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>Total Adeudado</p>
              <p className="text-headline-md" style={{ color: '#fff' }}>
                {formatCOP(totalDebtRemaining > 0 ? totalDebtRemaining : 0)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="text-label-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>Total Original</p>
              <p className="text-body-md" style={{ color: '#fff' }}>
                {formatCOP(totalDebtTarget)}
              </p>
            </div>
          </div>
          
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span className="text-label-sm" style={{ color: 'rgba(255,255,255,0.9)' }}>
                Pagado: {formatCOP(totalDebtPaid)}
              </span>
              <span className="text-label-sm" style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 'bold' }}>
                {overallProgressPercentage}%
              </span>
            </div>
            <div className={styles.debtProgressBg} style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
              <div 
                className={styles.debtProgressFill} 
                style={{ width: `${overallProgressPercentage}%`, backgroundColor: '#fff' }}
              />
            </div>
          </div>
        </Card>
      )}

      <section className={styles.debtsSection}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
          <h3 className={styles.sectionTitle}>Cuentas por pagar</h3>
          <Button variant="ghost" onClick={() => setIsNewDebtModalOpen(true)} className={styles.iconBtn} aria-label="Nueva Deuda">
            <Plus size={24} color="var(--color-primary)" />
          </Button>
        </div>

        {filteredDebts.length === 0 ? (
          <div className={styles.emptyDebts}>
            <ShieldAlert size={32} color="var(--color-on-surface-variant)" />
            <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>¡Todo en orden! No tienes deudas registradas.</p>
          </div>
        ) : (
          <div className={styles.debtsList}>
            {filteredDebts.map(d => {
              const progress = Math.min((d.currentAmount / d.targetAmount) * 100, 100);
              const isPaid = d.currentAmount >= d.targetAmount;
              return (
                <div key={d.id} className={styles.debtCard} onClick={() => { setSelectedDebt(d); setIsPayModalOpen(true); }}>
                  <div className={styles.debtHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Target size={20} color={isPaid ? "#10B981" : "var(--color-error)"} />
                      <span className="text-body-md" style={{ fontWeight: 600, textDecoration: isPaid ? 'line-through' : 'none' }}>{d.title}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                        {progress.toFixed(0)}%
                      </span>
                      {d.ownerId === user?.uid && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button 
                            onClick={(e) => { e.stopPropagation(); openEditModal(d); }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-on-surface-variant)', cursor: 'pointer', padding: '4px' }}
                            aria-label="Editar deuda"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setDebtToDelete(d); setIsDeleteModalOpen(true); }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-on-surface-variant)', cursor: 'pointer', padding: '4px' }}
                            aria-label="Eliminar deuda"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.debtProgressBg}>
                    <div className={`${styles.debtProgressFill} ${isPaid ? styles.debtProgressFillDone : ''}`} style={{ width: `${progress}%` }} />
                  </div>
                  <div className={styles.debtAmounts}>
                    <span className="text-label-sm" style={{ color: 'var(--color-on-surface)' }}>{formatCOP(d.currentAmount)} abonado</span>
                    <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>de {formatCOP(d.targetAmount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* New Debt Modal */}
      <Modal isOpen={isNewDebtModalOpen} onClose={() => setIsNewDebtModalOpen(false)} title="Nueva Deuda">
        <form onSubmit={handleCreateDebt} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <Input 
            label="¿A quién le debes o de qué es?" 
            placeholder="Ej. Tarjeta de Crédito, Préstamo coche..." 
            value={debtTitle}
            onChange={(e) => setDebtTitle(e.target.value)}
            required
            autoFocus
          />
          <Input 
            label="Monto Total a Pagar" 
            type="text"
            placeholder="Ej. 1.000.000" 
            value={debtTarget}
            onChange={(e) => setDebtTarget(formatInputCOP(e.target.value))}
            required
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className="text-label-md" style={{ color: 'var(--color-on-surface)' }}>
              Vincular a un Pago Programado (Opcional)
            </label>
            <select 
              value={linkedRecurringPaymentId} 
              onChange={(e) => setLinkedRecurringPaymentId(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '12px',
                border: '1px solid var(--color-outline-variant)',
                backgroundColor: 'var(--color-surface-container-lowest)',
                color: 'var(--color-on-surface)',
                fontFamily: 'inherit',
                fontSize: '16px',
                appearance: 'none',
              }}
            >
              <option value="">-- No vincular a ninguno --</option>
              {recurringPayments.map(rp => (
                <option key={rp.id} value={rp.id}>{rp.title} ({formatCOP(rp.amount)})</option>
              ))}
            </select>
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              Si vinculas a un pago programado, cuando lo pagues se abonará automáticamente a esta deuda.
            </p>
          </div>
          <div style={{ marginTop: '16px' }}>
            <UserEmailAutocomplete value={createShareEmail} onChange={setCreateShareEmail} />
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '8px' }}>
              Opcional: Comparte esta cuenta por pagar con alguien más.
            </p>
          </div>
          <Button type="submit" variant="primary" fullWidth disabled={!debtTitle || !debtTarget || isSubmitting}>
            {isSubmitting ? 'Guardando...' : 'Registrar Deuda'}
          </Button>
        </form>
      </Modal>

      {/* Pay Debt Modal */}
      <Modal isOpen={isPayModalOpen} onClose={() => { setIsPayModalOpen(false); setSelectedDebt(null); }} title={`Abonar a: ${selectedDebt?.title}`}>
        {selectedDebt && (
          <form onSubmit={handlePayDebt} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
            <Input 
              label="Monto del Abono" 
              type="text"
              placeholder="Ej. 50.000" 
              value={payAmount}
              onChange={(e) => setPayAmount(formatInputCOP(e.target.value))}
              required
              autoFocus
            />
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', textAlign: 'center' }}>
              El pago se descontará de tu balance como un Egreso automáticamente.
            </p>
            <Button type="submit" variant="primary" fullWidth disabled={!payAmount || isSubmitting}>
              {isSubmitting ? 'Procesando...' : 'Guardar Abono'}
            </Button>
          </form>
        )}
      </Modal>

      {/* Delete Debt Modal */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => !isSubmitting && setIsDeleteModalOpen(false)} title="Eliminar Deuda">
        <div style={{ marginBottom: '24px', marginTop: '8px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            ¿Estás seguro de que deseas eliminar <strong>{debtToDelete?.title}</strong>? Sólo se borrará de esta lista, los pagos realizados previamente seguirán en tu historial como egresos.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button type="button" variant="ghost" fullWidth onClick={() => setIsDeleteModalOpen(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" fullWidth onClick={handleDeleteDebt} disabled={isSubmitting}>
            {isSubmitting ? 'Eliminando...' : 'Sí, eliminar'}
          </Button>
        </div>
      </Modal>

      {/* Edit Debt Modal */}
      <Modal isOpen={isEditDebtModalOpen} onClose={() => setIsEditDebtModalOpen(false)} title="Editar Deuda">
        <form onSubmit={handleEditDebt} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <Input 
            label="¿A quién le debes o de qué es?" 
            placeholder="Ej. Tarjeta de Crédito, Préstamo coche..." 
            value={editDebtTitle}
            onChange={(e) => setEditDebtTitle(e.target.value)}
            required
          />
          <Input 
            label="Monto Total a Pagar" 
            type="text"
            placeholder="Ej. 1.000.000" 
            value={editDebtTarget}
            onChange={(e) => setEditDebtTarget(formatInputCOP(e.target.value))}
            required
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className="text-label-md" style={{ color: 'var(--color-on-surface)' }}>
              Vincular a un Pago Programado (Opcional)
            </label>
            <select 
              value={editLinkedRecurringPaymentId} 
              onChange={(e) => setEditLinkedRecurringPaymentId(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '12px',
                border: '1px solid var(--color-outline-variant)',
                backgroundColor: 'var(--color-surface-container-lowest)',
                color: 'var(--color-on-surface)',
                fontFamily: 'inherit',
                fontSize: '16px',
                appearance: 'none',
              }}
            >
              <option value="">-- No vincular a ninguno --</option>
              {recurringPayments.map(rp => (
                <option key={rp.id} value={rp.id}>{rp.title} ({formatCOP(rp.amount)})</option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: '16px' }}>
            <UserEmailAutocomplete value={editCreateShareEmail} onChange={setEditCreateShareEmail} />
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '8px' }}>
              Opcional: Comparte con alguien más (solo si deseas invitar a otra persona ahora).
            </p>
          </div>
          <Button type="submit" variant="primary" fullWidth disabled={!editDebtTitle || !editDebtTarget || isSubmitting}>
            {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
          </Button>
        </form>
      </Modal>
    </main>
  );
}
