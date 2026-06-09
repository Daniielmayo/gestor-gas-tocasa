'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { SpeedDial } from '@/components/ui/SpeedDial';
import { ArrowLeft, ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Wallet, ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './finanzas.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, Timestamp, or } from 'firebase/firestore';

interface Transaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  createdAt: any;
  ownerId: string;
}

export default function Finanzas() {
  const { user, loading } = useAuth();
  const router = useRouter();

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

  const predefinedIncomeCategories = ['Sueldo', 'Venta', 'Transferencia', 'Otro'];
  const predefinedExpenseCategories = ['Supermercado', 'Servicios', 'Alquiler', 'Transporte', 'Ocio', 'Salud', 'Educación', 'Otro'];

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

    return () => unsubTx();
  }, [user]);

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = category === 'Otro' ? customCategory : category;
    if (!amount || !finalCategory || !transactionDate || isSubmitting || !user) return;

    setIsSubmitting(true);
    try {
      // Parse local date (adding time to avoid UTC previous day shift)
      const dateObj = new Date(`${transactionDate}T12:00:00`);
      
      await addDoc(collection(db, 'transactions'), {
        type: transactionType,
        amount: parseFloat(amount),
        category: finalCategory,
        description,
        ownerId: user.uid,
        sharedWith: [], // Can be updated if sharing finances
        createdAt: Timestamp.fromDate(dateObj)
      });
      setIsModalOpen(false);
      setAmount('');
      setCategory('');
      setCustomCategory('');
      setDescription('');
      setTransactionDate(new Date().toISOString().split('T')[0]);
    } catch (error) {
      console.error('Error adding transaction: ', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openModal = (type: 'income' | 'expense') => {
    setTransactionType(type);
    setCategory('');
    setCustomCategory('');
    setTransactionDate(new Date().toISOString().split('T')[0]);
    setIsModalOpen(true);
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
    return txDate.getMonth() === currentDate.getMonth() && txDate.getFullYear() === currentDate.getFullYear();
  });

  const totalIncome = filteredTransactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
  const totalExpense = filteredTransactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
  const balance = totalIncome - totalExpense;

  return (
    <main className={`container ${styles.main}`}>
      <header className={styles.header}>
        <Link href="/">
          <Button variant="ghost" className={styles.iconBtn}>
            <ArrowLeft size={24} />
          </Button>
        </Link>
        <h1 className="text-headline-md">Finanzas</h1>
        <div style={{ width: 40 }} /> {/* Spacer */}
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
          <span className={styles.balanceTitle}>Balance Total</span>
          <h2 className={`${styles.balanceAmount} ${balance >= 0 ? styles.balanceAmountPositive : styles.balanceAmountNegative}`}>
            ${balance.toFixed(2)}
          </h2>
        </div>
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
                    </span>
                  </div>
                </div>
                <div className={`${styles.transactionAmount} ${t.type === 'income' ? styles.amountIncome : styles.amountExpense}`}>
                  {t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}
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

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={`Nuevo ${transactionType === 'income' ? 'Ingreso' : 'Egreso'}`}>
        <form onSubmit={handleAddTransaction} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <Input 
            label="Monto ($)" 
            type="number"
            step="0.01"
            placeholder="Ej. 1500" 
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
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
              {(transactionType === 'income' ? predefinedIncomeCategories : predefinedExpenseCategories).map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
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
    </main>
  );
}
