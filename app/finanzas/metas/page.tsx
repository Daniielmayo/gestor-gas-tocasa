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
import { ArrowLeft, Plus, Target, Trash2, PiggyBank, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import styles from './metas.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, Timestamp, or, doc, setDoc, arrayUnion, getDocs, deleteDoc, updateDoc, increment } from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import { useUsersMap } from '@/lib/hooks/useUsersMap';

interface SavingGoal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  ownerId: string;
  sharedWith?: string[];
}

export default function MetasAhorro() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [isReady, setIsReady] = useState(false);
  const [savings, setSavings] = useState<SavingGoal[]>([]);
  
  // Modals state
  const [isNewSavingModalOpen, setIsNewSavingModalOpen] = useState(false);
  const [savingTitle, setSavingTitle] = useState('');
  const [savingTarget, setSavingTarget] = useState('');
  const [createShareEmail, setCreateShareEmail] = useState('');
  
  const [isContributeModalOpen, setIsContributeModalOpen] = useState(false);
  const [selectedSaving, setSelectedSaving] = useState<SavingGoal | null>(null);
  const [contributeType, setContributeType] = useState<'add' | 'withdraw'>('add');
  const [contributeAmount, setContributeAmount] = useState('');
  
  const [isDeleteSavingModalOpen, setIsDeleteSavingModalOpen] = useState(false);
  const [savingToDelete, setSavingToDelete] = useState<SavingGoal | null>(null);

  const [isEditSavingModalOpen, setIsEditSavingModalOpen] = useState(false);
  const [editSavingTitle, setEditSavingTitle] = useState('');
  const [editSavingTarget, setEditSavingTarget] = useState('');
  const [editCreateShareEmail, setEditCreateShareEmail] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'personal' | 'shared'>('all');
  const [financeSettings, setFinanceSettings] = useState<any>(null);

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

    const savRef = collection(db, 'savings');
    const qSav = query(
      savRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );
    const unsubSav = onSnapshot(qSav, (snapshot) => {
      const data: SavingGoal[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as SavingGoal));
      setSavings(data);
      setIsReady(true);
    });

    return () => {
      unsubSettings();
      unsubSav();
    };
  }, [user]);

  const handleCreateSaving = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!savingTitle.trim() || !savingTarget || isSubmitting || !user) return;
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
                message: `${profile?.displayName || 'Alguien'} ha compartido sus finanzas contigo al crear una meta de ahorro.`,
                type: 'finance',
                link: '/finanzas',
                read: false,
                createdAt: Timestamp.now()
              });
            }
          }
        }
      }

      await addDoc(collection(db, 'savings'), {
        title: savingTitle.trim(),
        targetAmount: parseCOP(savingTarget),
        currentAmount: 0,
        ownerId: user.uid,
        sharedWith: currentSharedWith,
        createdAt: Timestamp.now()
      });
      setIsNewSavingModalOpen(false);
      setSavingTitle('');
      setSavingTarget('');
      setCreateShareEmail('');
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
      
      await updateDoc(doc(db, 'savings', selectedSaving.id), {
        currentAmount: increment(isAdd ? amt : -amt)
      });
      
      await addDoc(collection(db, 'transactions'), {
        type: isAdd ? 'expense' : 'income',
        amount: amt,
        category: `Ahorro: ${selectedSaving.title}`,
        description: isAdd ? 'Aporte a ahorro' : 'Retiro de ahorro',
        ownerId: user.uid,
        ownerName: profile?.displayName?.split(' ')[0] || 'Usuario',
        sharedWith: financeSettings?.sharedWith || [],
        createdAt: Timestamp.now(),
      });
      
      setIsContributeModalOpen(false);
      setContributeAmount('');
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
    setEditSavingTarget(saving.targetAmount.toString());
    setEditCreateShareEmail('');
    setIsEditSavingModalOpen(true);
  };

  const handleEditSaving = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSaving || !editSavingTitle.trim() || !editSavingTarget || isSubmitting || !user) return;
    setIsSubmitting(true);
    try {
      let currentSharedWith = selectedSaving.sharedWith || [];
      if (editCreateShareEmail.trim()) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', editCreateShareEmail.trim().toLowerCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const friendUid = snap.docs[0].data().uid;
          if (friendUid !== user.uid) {
            currentSharedWith = [...new Set([...currentSharedWith, friendUid])];
          }
        }
      }

      await updateDoc(doc(db, 'savings', selectedSaving.id), {
        title: editSavingTitle.trim(),
        targetAmount: parseCOP(editSavingTarget),
        sharedWith: currentSharedWith,
      });

      setIsEditSavingModalOpen(false);
      setSelectedSaving(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || !user || !isReady) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando metas..." />
      </main>
    );
  }

  const filteredSavings = savings.filter(s => {
    if (filterMode === 'personal') {
      return s.ownerId === user.uid && (!s.sharedWith || s.sharedWith.length === 0);
    } else if (filterMode === 'shared') {
      return s.ownerId !== user.uid || (s.sharedWith && s.sharedWith.length > 0);
    }
    return true;
  });

  const totalSavingsTarget = filteredSavings.reduce((sum, s) => sum + s.targetAmount, 0);
  const totalSavingsCurrent = filteredSavings.reduce((sum, s) => sum + s.currentAmount, 0);
  const overallSavingsProgress = totalSavingsTarget > 0 ? Math.min(100, Math.round((totalSavingsCurrent / totalSavingsTarget) * 100)) : 0;

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

      {filteredSavings.length > 0 && (
        <Card style={{ marginTop: '16px', marginBottom: '8px', background: 'linear-gradient(135deg, var(--color-success) 0%, var(--color-success-dark, #0f766e) 100%)', color: '#fff', border: 'none' }}>
          <h2 className="text-label-md" style={{ color: 'rgba(255,255,255,0.8)', marginBottom: '8px' }}>
            Resumen de Ahorros {filterMode === 'all' ? '' : filterMode === 'personal' ? 'Personales' : 'Compartidos'}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
            <div>
              <p className="text-label-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>Total Ahorrado</p>
              <p className="text-headline-md" style={{ color: '#fff' }}>
                {formatCOP(totalSavingsCurrent)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="text-label-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>Meta Global</p>
              <p className="text-body-md" style={{ color: '#fff' }}>
                {formatCOP(totalSavingsTarget)}
              </p>
            </div>
          </div>
          
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span className="text-label-sm" style={{ color: 'rgba(255,255,255,0.9)' }}>
                Falta: {formatCOP(totalSavingsTarget - totalSavingsCurrent > 0 ? totalSavingsTarget - totalSavingsCurrent : 0)}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
          <h3 className={styles.sectionTitle}>Tus Metas</h3>
          <Button variant="ghost" onClick={() => setIsNewSavingModalOpen(true)} className={styles.iconBtn} aria-label="Nueva meta de ahorro">
            <Plus size={24} color="var(--color-primary)" />
          </Button>
        </div>

        {filteredSavings.length === 0 ? (
          <div className={styles.emptySavings}>
            <PiggyBank size={32} color="var(--color-on-surface-variant)" />
            <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>No tienes metas de ahorro.</p>
          </div>
        ) : (
          <div className={styles.savingsList}>
            {filteredSavings.map(s => {
              const progress = Math.min((s.currentAmount / s.targetAmount) * 100, 100);
              return (
                <div key={s.id} className={styles.savingCard} onClick={() => { setSelectedSaving(s); setIsContributeModalOpen(true); }}>
                  <div className={styles.savingHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Target size={20} color="var(--color-primary)" />
                      <span className="text-body-md" style={{ fontWeight: 600 }}>{s.title}</span>
                      {s.sharedWith && s.sharedWith.length > 0 && (
                        <div style={{ marginLeft: '4px' }}>
                          <AvatarGroup 
                            users={[
                              usersMap[s.ownerId],
                              ...s.sharedWith.map((uid: string) => usersMap[uid])
                            ].filter(Boolean) as any} 
                            size="sm" 
                          />
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                        {progress.toFixed(0)}%
                      </span>
                      {s.ownerId === user?.uid && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button 
                            onClick={(e) => { e.stopPropagation(); openEditModal(s); }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-on-surface-variant)', cursor: 'pointer', padding: '4px' }}
                            aria-label="Editar meta"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setSavingToDelete(s); setIsDeleteSavingModalOpen(true); }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-on-surface-variant)', cursor: 'pointer', padding: '4px' }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.savingProgressBg}>
                    <div className={styles.savingProgressFill} style={{ width: `${progress}%` }} />
                  </div>
                  <div className={styles.savingAmounts}>
                    <span className="text-label-sm" style={{ color: 'var(--color-on-surface)' }}>{formatCOP(s.currentAmount)} ahorrado</span>
                    <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>de {formatCOP(s.targetAmount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modals */}
      <Modal isOpen={isNewSavingModalOpen} onClose={() => setIsNewSavingModalOpen(false)} title="Nueva Meta de Ahorro">
        <form onSubmit={handleCreateSaving} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <Input 
            label="¿Qué quieres lograr?" 
            value={savingTitle} 
            onChange={(e) => setSavingTitle(e.target.value)} 
            placeholder="Ej: Viaje a Japón" 
            required 
          />
          <Input 
            label="¿Cuánto necesitas? ($)" 
            type="text" 
            inputMode="numeric"
            value={savingTarget} 
            onChange={(e) => setSavingTarget(formatInputCOP(e.target.value))} 
            placeholder="$ 0" 
            required 
          />
          <div style={{ marginTop: '16px' }}>
            <UserEmailAutocomplete value={createShareEmail} onChange={setCreateShareEmail} />
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '8px' }}>
              Opcional: Compartir con amigo.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsNewSavingModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting || !savingTitle || !savingTarget}>Crear Meta</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isContributeModalOpen} onClose={() => setIsContributeModalOpen(false)} title={selectedSaving?.title || ''}>
        <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            Llevas ahorrado: <span style={{ fontWeight: 600, color: 'var(--color-on-surface)' }}>{formatCOP(selectedSaving?.currentAmount || 0)}</span>
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button 
              type="button" 
              variant={contributeType === 'add' ? 'primary' : 'secondary'} 
              onClick={() => setContributeType('add')}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
            >
              <ArrowUpRight size={16} /> Abonar
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
        <form onSubmit={handleContributeSaving} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Input 
            label="Monto ($)" 
            type="text" 
            inputMode="numeric"
            value={contributeAmount} 
            onChange={(e) => setContributeAmount(formatInputCOP(e.target.value))} 
            placeholder="$ 0" 
            required 
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsContributeModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting || !contributeAmount}>
              {contributeType === 'add' ? 'Abonar' : 'Retirar'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isDeleteSavingModalOpen} onClose={() => setIsDeleteSavingModalOpen(false)} title="Eliminar Meta">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            ¿Estás seguro de que quieres eliminar la meta "{savingToDelete?.title}"? Esta acción no se puede deshacer.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button type="button" variant="ghost" onClick={() => setIsDeleteSavingModalOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={handleDeleteSaving} disabled={isSubmitting} style={{ backgroundColor: 'var(--color-error)', color: 'white' }}>
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isEditSavingModalOpen} onClose={() => setIsEditSavingModalOpen(false)} title="Editar Meta">
        <form onSubmit={handleEditSaving} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <Input 
            label="¿Qué quieres lograr?" 
            value={editSavingTitle} 
            onChange={(e) => setEditSavingTitle(e.target.value)} 
            placeholder="Ej: Viaje a Japón" 
            required 
          />
          <Input 
            label="¿Cuánto necesitas? ($)" 
            type="text" 
            inputMode="numeric"
            value={editSavingTarget} 
            onChange={(e) => setEditSavingTarget(formatInputCOP(e.target.value))} 
            placeholder="$ 0" 
            required 
          />
          <div style={{ marginTop: '16px' }}>
            <UserEmailAutocomplete value={editCreateShareEmail} onChange={setEditCreateShareEmail} />
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '8px' }}>
              Opcional: Compartir con amigo.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button type="button" variant="ghost" onClick={() => setIsEditSavingModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting || !editSavingTitle || !editSavingTarget}>Guardar</Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
