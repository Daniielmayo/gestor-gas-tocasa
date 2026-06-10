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
import { SpeedDial } from '@/components/ui/SpeedDial';
import { ArrowLeft, ArrowRight, ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Wallet, ChevronLeft, ChevronRight, Settings, UserPlus, Trash2 } from 'lucide-react';
import styles from './finanzas.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, Timestamp, or, doc, setDoc, arrayUnion, getDocs, deleteDoc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';
import { PiggyBank, Plus, Target } from 'lucide-react';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import { sendPushNotification } from '@/lib/pushUtils';

interface Transaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  createdAt: any;
  ownerId: string;
  ownerName?: string;
  recurringPaymentId?: string;
  recurringPaymentTitle?: string;
}

interface CustomCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
}

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
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [transactionType, setTransactionType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [description, setDescription] = useState('');
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  // Sharing state
  const [financeSettings, setFinanceSettings] = useState<any>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [createShareEmail, setCreateShareEmail] = useState('');
  const [isSharing, setIsSharing] = useState(false);

  // Filter state
  const [filterMode, setFilterMode] = useState<'all' | 'personal' | 'shared'>('all');

  // Custom Categories state
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'income' | 'expense'>('expense');
  const [isAddingCat, setIsAddingCat] = useState(false);

  // Recurring payments state for linking
  const [recurringPayments, setRecurringPayments] = useState<any[]>([]);
  const [selectedRecurringPaymentId, setSelectedRecurringPaymentId] = useState('');

  // Savings state
  const [savings, setSavings] = useState<SavingGoal[]>([]);

  // Debts state
  const [debts, setDebts] = useState<Debt[]>([]);

  // Delete transaction state
  const [isDeleteTxModalOpen, setIsDeleteTxModalOpen] = useState(false);
  const [txToDelete, setTxToDelete] = useState<Transaction | null>(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);

  const predefinedIncomeCategories = ['Sueldo', 'Venta', 'Transferencia'];
  const predefinedExpenseCategories = ['Supermercado', 'Servicios', 'Alquiler', 'Transporte', 'Ocio', 'Salud', 'Educación'];

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
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );

    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const data: Transaction[] = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() } as Transaction);
      });
      data.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
        return timeB - timeA;
      });
      setTransactions(data);
      setIsReady(true);
    }, (error) => {
      console.error("Error fetching transactions:", error);
      setIsReady(true);
    });

    const settingsRef = doc(db, 'financeSettings', user.uid);
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setFinanceSettings(docSnap.data());
      } else {
        setFinanceSettings({ sharedWith: [] });
      }
    });

    const catRef = collection(db, 'financeCategories');
    const qCat = query(catRef, where('ownerId', '==', user.uid));
    const unsubCat = onSnapshot(qCat, (snapshot) => {
      const data: CustomCategory[] = [];
      snapshot.forEach(d => data.push({ id: d.id, ...d.data() } as CustomCategory));
      setCustomCategories(data);
    });

    const payRef = collection(db, 'recurringPayments');
    const qPay = query(
      payRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );
    const unsubPay = onSnapshot(qPay, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
      setRecurringPayments(data);
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
    });

    const debtRef = collection(db, 'debts');
    const qDebt = query(
      debtRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );
    const unsubDebt = onSnapshot(qDebt, (snapshot) => {
      const data: Debt[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as Debt));
      setDebts(data);
    });

    return () => {
      unsubTx();
      unsubSettings();
      unsubCat();
      unsubPay();
      unsubSav();
      unsubDebt();
    };
  }, [user]);

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = category === 'Otro' ? customCategory : category;
    if (!amount || !finalCategory || !transactionDate || isSubmitting || !user) return;

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
                message: `${profile?.displayName || 'Alguien'} ha compartido sus finanzas contigo al crear un movimiento.`,
                type: 'finance',
                link: '/finanzas',
                read: false,
                createdAt: Timestamp.now()
              });
            }
          }
        }
      }

      // Parse local date (adding time to avoid UTC previous day shift)
      const dateObj = new Date(`${transactionDate}T12:00:00`);
      
      const selectedPay = recurringPayments.find(p => p.id === selectedRecurringPaymentId);
      
      if (editingTxId) {
        await updateDoc(doc(db, 'transactions', editingTxId), {
          type: transactionType,
          amount: parseCOP(amount),
          category: finalCategory,
          description,
          createdAt: Timestamp.fromDate(dateObj),
          recurringPaymentId: selectedPay ? selectedPay.id : null,
          recurringPaymentTitle: selectedPay ? selectedPay.title : null
        });
      } else {
        await addDoc(collection(db, 'transactions'), {
          type: transactionType,
          amount: parseCOP(amount),
          category: finalCategory,
          description,
          ownerId: user.uid,
          ownerName: profile?.displayName?.split(' ')[0] || 'Usuario',
          sharedWith: currentSharedWith,
          createdAt: Timestamp.fromDate(dateObj),
          recurringPaymentId: selectedPay ? selectedPay.id : null,
          recurringPaymentTitle: selectedPay ? selectedPay.title : null
        });
      }
      setIsModalOpen(false);
      setEditingTxId(null);
      setAmount('');
      setCategory('');
      setCustomCategory('');
      setDescription('');
      setSelectedRecurringPaymentId('');
      setCreateShareEmail('');
      setTransactionDate(new Date().toISOString().split('T')[0]);
    } catch (error) {
      console.error('Error adding transaction: ', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openModal = (type: 'income' | 'expense') => {
    setEditingTxId(null);
    setTransactionType(type);
    setAmount('');
    setCategory('');
    setCustomCategory('');
    setDescription('');
    setSelectedRecurringPaymentId('');
    setCreateShareEmail('');
    setTransactionDate(new Date().toISOString().split('T')[0]);
    setIsModalOpen(true);
  };

  const openEditTxModal = (t: Transaction) => {
    setEditingTxId(t.id);
    setTransactionType(t.type);
    setAmount(formatInputCOP(String(t.amount)));
    
    const allCats = t.type === 'income' ? incomeCats : expenseCats;
    if (allCats.includes(t.category)) {
      setCategory(t.category);
      setCustomCategory('');
    } else {
      setCategory('Otro');
      setCustomCategory(t.category);
    }
    
    setDescription(t.description || '');
    if (t.createdAt) {
      setTransactionDate(new Date(t.createdAt.toDate()).toISOString().split('T')[0]);
    } else {
      setTransactionDate(new Date().toISOString().split('T')[0]);
    }
    setSelectedRecurringPaymentId(t.recurringPaymentId || '');
    setIsModalOpen(true);
  };

  const handleShareFinance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareEmail.trim() || !user || !profile) return;
    setIsSharing(true);

    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', shareEmail.trim().toLowerCase()));
      const snap = await getDocs(q);

      if (snap.empty) {
        alert("Ese correo electrónico no está registrado en la app.");
        setIsSharing(false);
        return;
      }

      const friendDoc = snap.docs[0];
      const friendUid = friendDoc.data().uid;
      const friendName = friendDoc.data().displayName || shareEmail;

      if (friendUid === user.uid) {
        alert("No puedes invitarte a ti mismo.");
        setIsSharing(false);
        return;
      }

      const settingsRef = doc(db, 'financeSettings', user.uid);
      await setDoc(settingsRef, {
        sharedWith: arrayUnion(friendUid)
      }, { merge: true });

      await addDoc(collection(db, 'notifications'), {
        userId: friendUid,
        title: 'Finanzas Compartidas',
        message: `${profile.displayName || 'Alguien'} ha compartido su módulo de finanzas contigo.`,
        type: 'finance',
        link: '/finanzas',
        read: false,
        createdAt: Timestamp.now()
      });

      alert(`¡Finanzas compartidas con éxito con ${friendName}!`);
      setIsShareModalOpen(false);
      setShareEmail('');
    } catch (error) {
      console.error(error);
      alert("Hubo un error al compartir.");
    } finally {
      setIsSharing(false);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim() || !user) return;
    setIsAddingCat(true);
    try {
      await addDoc(collection(db, 'financeCategories'), {
        name: newCatName.trim(),
        type: newCatType,
        ownerId: user.uid
      });
      setNewCatName('');
    } catch (error) {
      console.error(error);
    } finally {
      setIsAddingCat(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'financeCategories', id));
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteTransaction = async () => {
    if (!txToDelete) return;
    setIsDeletingTx(true);
    try {
      await deleteDoc(doc(db, 'transactions', txToDelete.id));
      setIsDeleteTxModalOpen(false);
      setTxToDelete(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsDeletingTx(false);
    }
  };



  if (loading || !user || !isReady) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando finanzas..." />
      </main>
    );
  }

  const getMonthName = (date: Date) => {
    return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const filteredTransactions = transactions.filter(t => {
    const txDate = t.createdAt ? t.createdAt.toDate() : new Date();
    const matchesMonth = txDate.getMonth() === currentDate.getMonth() && txDate.getFullYear() === currentDate.getFullYear();
    if (!matchesMonth) return false;

    if (filterMode === 'personal') {
      return t.ownerId === user.uid;
    } else if (filterMode === 'shared') {
      return t.ownerId !== user.uid;
    }
    return true; // 'all'
  });

  const totalIncome = filteredTransactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
  const totalExpense = filteredTransactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
  
  // Totals for debts
  const totalDebtTarget = debts.reduce((sum, d) => sum + d.targetAmount, 0);
  const totalDebtPaid = debts.reduce((sum, d) => sum + d.currentAmount, 0);
  const totalDebtRemaining = totalDebtTarget - totalDebtPaid > 0 ? totalDebtTarget - totalDebtPaid : 0;
  const overallDebtProgress = totalDebtTarget > 0 ? Math.min(100, Math.round((totalDebtPaid / totalDebtTarget) * 100)) : 0;
  const balance = totalIncome - totalExpense;

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

  const incomeCats = [...predefinedIncomeCategories, ...customCategories.filter(c => c.type === 'income').map(c => c.name), 'Otro'];
  const expenseCats = [...predefinedExpenseCategories, ...customCategories.filter(c => c.type === 'expense').map(c => c.name), 'Otro'];

  return (
    <main className={`container ${styles.main}`}>
      <header className={styles.header}>
        <Link href="/">
          <Button variant="ghost" className={styles.iconBtn}>
            <ArrowLeft size={24} />
          </Button>
        </Link>
        <div className={styles.titleContainer} style={{ flex: 1, overflow: 'hidden', marginLeft: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 className="text-headline-md">Finanzas</h1>
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
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button variant="ghost" className={styles.iconBtn} onClick={() => setIsShareModalOpen(true)}>
            <UserPlus size={20} color="var(--color-primary)" />
          </Button>
          <Button variant="ghost" className={styles.iconBtn} onClick={() => setIsCategoriesModalOpen(true)}>
            <Settings size={20} />
          </Button>
        </div>
      </header>

      <div className={styles.monthSelector}>
        <Button variant="ghost" className={styles.iconBtn} onClick={prevMonth}>
          <ChevronLeft size={24} />
        </Button>
        <span className={styles.monthText}>{getMonthName(currentDate)}</span>
        <Button 
          variant="ghost" 
          className={styles.iconBtn} 
          onClick={nextMonth} 
          disabled={currentDate.getMonth() === new Date().getMonth() && currentDate.getFullYear() === new Date().getFullYear()}
        >
          <ChevronRight size={24} />
        </Button>
      </div>

      <section>
        <div className={styles.balanceCard}>
          <span className={styles.balanceTitle}>Balance {filterMode === 'all' ? 'Total' : filterMode === 'personal' ? 'Personal' : 'Compartido'}</span>
          <h2 className={`${styles.balanceAmount} ${balance >= 0 ? styles.balanceAmountPositive : styles.balanceAmountNegative}`}>
            {formatCOP(balance)}
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
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

      {/* Access to Metas */}
      <section style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 className={styles.sectionTitle}>Metas de Ahorro</h3>
        </div>
        <Link href="/finanzas/metas" style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px',
            background: 'var(--color-surface-container-lowest)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-level-1)',
            cursor: 'pointer'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(15, 118, 110, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <PiggyBank size={20} color="var(--color-success)" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingRight: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span className="text-body-md" style={{ fontWeight: 600, color: 'var(--color-on-surface)' }}>Gestionar Metas</span>
                  {savings.length > 0 && (
                    <span className="text-label-sm" style={{ color: 'var(--color-success)', fontWeight: 600 }}>{formatCOP(totalSavingsCurrent)}</span>
                  )}
                </div>
                {savings.length > 0 ? (
                  <div style={{ width: '100%', marginTop: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px' }}>Progreso global</span>
                      <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px' }}>{overallSavingsProgress}%</span>
                    </div>
                    <div style={{ width: '100%', height: '4px', backgroundColor: 'rgba(15, 118, 110, 0.15)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${overallSavingsProgress}%`, height: '100%', backgroundColor: 'var(--color-success)', borderRadius: '2px' }} />
                    </div>
                  </div>
                ) : (
                  <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>Lleva el control de tus ahorros</span>
                )}
              </div>
            </div>
            <ArrowRight size={20} color="var(--color-on-surface-variant)" />
          </div>
        </Link>
      </section>

      {/* Access to Debts */}
      <section style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 className={styles.sectionTitle}>Cuentas por Pagar</h3>
        </div>
        <Link href="/finanzas/deudas" style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px',
            background: 'var(--color-surface-container-lowest)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-level-1)',
            cursor: 'pointer'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Target size={20} color="var(--color-error)" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingRight: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span className="text-body-md" style={{ fontWeight: 600, color: 'var(--color-on-surface)' }}>Gestionar Deudas</span>
                  {debts.length > 0 && (
                    <span className="text-label-sm" style={{ color: 'var(--color-error)', fontWeight: 600 }}>{formatCOP(totalDebtRemaining)}</span>
                  )}
                </div>
                {debts.length > 0 ? (
                  <div style={{ width: '100%', marginTop: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px' }}>Progreso global</span>
                      <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px' }}>{overallDebtProgress}%</span>
                    </div>
                    <div style={{ width: '100%', height: '4px', backgroundColor: 'rgba(239, 68, 68, 0.15)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${overallDebtProgress}%`, height: '100%', backgroundColor: 'var(--color-error)', borderRadius: '2px' }} />
                    </div>
                  </div>
                ) : (
                  <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>Lleva el control de tus deudas</span>
                )}
              </div>
            </div>
            <ArrowRight size={20} color="var(--color-on-surface-variant)" />
          </div>
        </Link>
      </section>


      <section className={styles.transactionsSection}>
        <h3 className={styles.sectionTitle}>Movimientos Recientes</h3>
        
        {filteredTransactions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--color-surface-container-high)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wallet size={32} color="var(--color-on-surface-variant)" />
            </div>
            <h4 className="text-headline-sm">Sin movimientos</h4>
            <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>Registra tu primer ingreso o egreso arriba.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filteredTransactions.map(t => (
              <div key={t.id} className={styles.transactionCard}>
                <div className={styles.transactionLeft}>
                  <div className={`${styles.iconWrapper} ${t.type === 'income' ? styles.iconIncome : styles.iconExpense}`}>
                    {t.type === 'income' ? <ArrowUpRight size={24} /> : <ArrowDownRight size={24} />}
                  </div>
                  <div className={styles.transactionInfo}>
                    <span className={styles.transactionTitle}>{t.category}</span>
                    <span className={styles.transactionDate}>
                      {t.createdAt ? new Date(t.createdAt.toDate()).toLocaleDateString() : 'Hoy'}
                      {t.description && ` • ${t.description}`}
                      {t.ownerId !== user.uid && t.ownerName && ` • Por ${t.ownerName}`}
                    </span>
                    {t.recurringPaymentTitle && (
                      <span style={{ fontSize: '12px', color: 'var(--color-primary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        🔗 Pago: {t.recurringPaymentTitle}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className={`${styles.transactionAmount} ${t.type === 'income' ? styles.amountIncome : styles.amountExpense}`}>
                    {t.type === 'income' ? '+' : '-'}{formatCOP(t.amount)}
                  </div>
                  {t.ownerId === user?.uid && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button 
                        onClick={() => openEditTxModal(t)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-on-surface-variant)' }}
                        aria-label="Editar transacción"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                      </button>
                      <button 
                        onClick={() => { setTxToDelete(t); setIsDeleteTxModalOpen(true); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-on-surface-variant)' }}
                        aria-label="Eliminar transacción"
                      >
                        <Trash2 size={18} color="var(--color-error)" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <SpeedDial actions={[
        {
          name: 'Nuevo Egreso',
          icon: <TrendingDown size={20} />,
          color: '#EF4444', // Red
          onClick: () => openModal('expense')
        },
        {
          name: 'Nuevo Ingreso',
          icon: <TrendingUp size={20} />,
          color: '#10B981', // Emerald/Green
          onClick: () => openModal('income')
        }
      ]} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingTxId(null); }} title={`${editingTxId ? 'Editar' : 'Nuevo'} ${transactionType === 'income' ? 'Ingreso' : 'Egreso'}`}>
        <form onSubmit={handleAddTransaction} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <Input 
            label="Monto" 
            type="text"
            placeholder="Ej. 1.500.000" 
            value={amount}
            onChange={(e) => setAmount(formatInputCOP(e.target.value))}
            required
            autoFocus
          />
          <Input 
            label="Fecha" 
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            required
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className="text-label-md" style={{ color: 'var(--color-on-surface-variant)' }}>Categoría</label>
            <select 
              value={category} 
              onChange={(e) => setCategory(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-outline)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-on-surface)',
                fontSize: '16px',
                outline: 'none',
                fontFamily: 'inherit'
              }}
            >
              <option value="" disabled>Selecciona una categoría</option>
              {(transactionType === 'income' ? incomeCats : expenseCats).map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          {transactionType === 'expense' && recurringPayments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label className="text-label-md" style={{ color: 'var(--color-on-surface-variant)' }}>Asociar a Pago Programado (Opcional)</label>
              <select 
                value={selectedRecurringPaymentId} 
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedRecurringPaymentId(val);
                  if (val) {
                    const pay = recurringPayments.find(p => p.id === val);
                    if (pay && pay.amount) {
                      setAmount(formatInputCOP(String(pay.amount)));
                    }
                  }
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-outline)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-on-surface)',
                  fontSize: '16px',
                  outline: 'none',
                  fontFamily: 'inherit'
                }}
              >
                <option value="">Ninguno</option>
                {recurringPayments.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
          )}
          {category === 'Otro' && (
            <Input 
              label="Escribe tu categoría" 
              placeholder="Ej. Regalo, Inversión..." 
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              required
            />
          )}
          <Input 
            label="Nota (Opcional)" 
            placeholder="Algún detalle extra..." 
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button 
            type="submit" 
            variant="primary" 
            fullWidth 
            disabled={!amount || !category || (category === 'Otro' && !customCategory) || isSubmitting}
            style={{ marginTop: '8px' }}
          >
            {isSubmitting ? 'Guardando...' : 'Guardar'}
          </Button>
        </form>
      </Modal>

      {/* Share Modal */}
      <Modal isOpen={isShareModalOpen} onClose={() => !isSharing && setIsShareModalOpen(false)} title="Compartir Finanzas">
        <div style={{ marginBottom: '16px', marginTop: '8px' }}>
          <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            Escribe el correo electrónico de la persona con la que quieres compartir este módulo. 
            <strong> Nota:</strong> Deben haber iniciado sesión en la app previamente.
          </p>
        </div>
        <form onSubmit={handleShareFinance}>
          <div style={{ marginBottom: '24px' }}>
            <UserEmailAutocomplete 
              value={shareEmail}
              onChange={(val) => setShareEmail(val)}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button type="button" variant="ghost" fullWidth onClick={() => setIsShareModalOpen(false)} disabled={isSharing}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={!shareEmail.trim() || isSharing}>
              {isSharing ? 'Buscando...' : 'Compartir'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Transaction Modal */}
      <Modal isOpen={isDeleteTxModalOpen} onClose={() => !isDeletingTx && setIsDeleteTxModalOpen(false)} title="Eliminar Movimiento">
        <div style={{ marginBottom: '24px', marginTop: '8px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            ¿Estás seguro de que deseas eliminar este movimiento? Se actualizará tu balance automáticamente.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button type="button" variant="ghost" fullWidth onClick={() => setIsDeleteTxModalOpen(false)} disabled={isDeletingTx}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" fullWidth onClick={handleDeleteTransaction} disabled={isDeletingTx}>
            {isDeletingTx ? 'Eliminando...' : 'Sí, eliminar'}
          </Button>
        </div>
      </Modal>



      {/* Category Management Modal */}
      <Modal isOpen={isCategoriesModalOpen} onClose={() => setIsCategoriesModalOpen(false)} title="Tus Categorías">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '16px' }}>
          <form onSubmit={handleAddCategory} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <Input 
                label="Nueva Categoría" 
                placeholder="Ej. Veterinaria" 
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-label-md" style={{ color: 'var(--color-on-surface-variant)' }}>Tipo</label>
              <select 
                value={newCatType} 
                onChange={(e) => setNewCatType(e.target.value as 'income' | 'expense')}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-outline)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-on-surface)',
                  fontSize: '16px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  marginTop: '4px'
                }}
              >
                <option value="expense">Egreso</option>
                <option value="income">Ingreso</option>
              </select>
            </div>
            <Button type="submit" variant="primary" fullWidth disabled={!newCatName.trim() || isAddingCat} style={{ padding: '12px' }}>
              {isAddingCat ? 'Agregando...' : 'Agregar Categoría'}
            </Button>
          </form>

          <div>
            <h4 className="text-label-lg" style={{ marginBottom: '8px', color: 'var(--color-on-surface-variant)' }}>Categorías Creadas</h4>
            {customCategories.length === 0 ? (
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>No has creado ninguna categoría extra.</p>
            ) : (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: '8px', listStyle: 'none', padding: 0 }}>
                {customCategories.map(cat => (
                  <li key={cat.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--color-surface-container-low)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="text-body-md" style={{ fontWeight: 500 }}>{cat.name}</span>
                      <span className="text-label-sm" style={{ color: cat.type === 'income' ? '#10B981' : '#EF4444', background: cat.type === 'income' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                        {cat.type === 'income' ? 'Ingreso' : 'Egreso'}
                      </span>
                    </div>
                    <button onClick={() => handleDeleteCategory(cat.id)} style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', padding: '4px' }}>
                      <Trash2 size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>

    </main>
  );
}
