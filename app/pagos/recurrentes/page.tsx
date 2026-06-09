'use client';
import React, { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ArrowLeft, Calendar, Settings, UserPlus, Trash2 } from 'lucide-react';
import styles from './recurrentes.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, or, doc, updateDoc, deleteDoc, getDocs, arrayUnion } from 'firebase/firestore';

interface Payment {
  id: string;
  title: string;
  amount: string;
  days: number[];
  ownerId: string;
}

export default function RecurringPayments() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  
  // Filter state
  const [filterDay, setFilterDay] = useState<number | 'all'>('all');

  // Modals state
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const paymentsRef = collection(db, 'recurringPayments');
    const q = query(
      paymentsRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Payment[] = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() } as Payment);
      });
      setPayments(data);
    });

    return () => unsubscribe();
  }, [user]);

  const toggleDay = (day: number) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSavePayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !title.trim() || !amount.trim() || selectedDays.length === 0) {
      alert("Por favor completa todos los campos y selecciona al menos un día.");
      return;
    }

    try {
      await addDoc(collection(db, 'recurringPayments'), {
        title: title.trim(),
        amount: amount.trim(),
        days: selectedDays,
        ownerId: user.uid,
        sharedWith: [],
        createdAt: serverTimestamp()
      });
      
      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> programó el pago recurrente '${title.trim()}' por $${amount.trim()}`, user.uid, []);
      });

      setTitle('');
      setAmount('');
      setSelectedDays([]);
    } catch (error) {
      console.error("Error al guardar pago:", error);
    }
  };

  const openShareModal = (payment: Payment) => {
    setSelectedPayment(payment);
    setShareEmail('');
    setIsShareModalOpen(true);
  };

  const openDeleteModal = (payment: Payment) => {
    setSelectedPayment(payment);
    setIsDeleteModalOpen(true);
  };

  const handleSharePayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!shareEmail.trim() || !selectedPayment || !user || !profile) return;
    setIsProcessing(true);

    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', shareEmail.trim().toLowerCase()));
      const snap = await getDocs(q);

      if (snap.empty) {
        alert("Ese correo electrónico no está registrado en la app.");
        setIsProcessing(false);
        return;
      }

      const friendUid = snap.docs[0].data().uid;
      const friendName = snap.docs[0].data().displayName || shareEmail;

      if (friendUid === user?.uid) {
        alert("No puedes invitarte a ti mismo.");
        setIsProcessing(false);
        return;
      }

      await updateDoc(doc(db, 'recurringPayments', selectedPayment.id), {
        sharedWith: arrayUnion(friendUid)
      });
      
      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> compartió el pago '${selectedPayment.title}' con ${friendName}`, selectedPayment.ownerId, [...(selectedPayment as any).sharedWith || [], friendUid]);
      });

      alert(`¡Pago compartido con éxito!`);
      setIsShareModalOpen(false);
      setShareEmail('');
    } catch (error) {
      console.error(error);
      alert("Hubo un error al compartir el pago");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeletePayment = async () => {
    if (!selectedPayment || !profile) return;
    setIsProcessing(true);
    try {
      await deleteDoc(doc(db, 'recurringPayments', selectedPayment.id));
      
      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> eliminó el pago recurrente '${selectedPayment.title}'`, selectedPayment.ownerId, (selectedPayment as any).sharedWith || []);
      });

      setIsDeleteModalOpen(false);
    } catch (error) {
      console.error(error);
      alert("Error al eliminar el pago");
    } finally {
      setIsProcessing(false);
    }
  };

  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando pagos..." />
      </main>
    );
  }

  return (
    <main className={`container ${styles.main}`}>
      <header className={styles.appBar}>
        <Link href="/">
          <Button variant="ghost" className={styles.iconBtn}>
            <ArrowLeft size={24} />
          </Button>
        </Link>
        <h1 className="text-headline-md">Pagos Recurrentes</h1>
        <Button variant="ghost" className={styles.iconBtn}>
          <Settings size={24} />
        </Button>
      </header>

      {/* Formulario de Nuevo Pago */}
      <Card className={styles.formCard}>
        <h2 className="text-headline-sm" style={{ marginBottom: '16px' }}>Programar Pago</h2>
        <form className={styles.formGroup} onSubmit={handleSavePayment}>
          <Input 
            label="Nombre del Pago" 
            placeholder="Ej. Arriendo, Servicios..." 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input 
            label="Monto Estimado" 
            placeholder="$0.00" 
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          
          <div className={styles.frequencyGroup}>
            <label className="text-label-md" style={{ color: 'var(--color-on-surface)' }}>
              Días de Cobro (Se repetirá cada mes)
            </label>
            <div className={styles.dayGrid}>
              {days.map(day => (
                <button
                  key={day}
                  type="button"
                  className={`${styles.dayButton} ${selectedDays.includes(day) ? styles.daySelected : ''}`}
                  onClick={() => toggleDay(day)}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" fullWidth className={styles.saveBtn}>Guardar Pago</Button>
        </form>
      </Card>

      {/* Lista de Obligaciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
        <h2 className="text-headline-sm">Tus Obligaciones</h2>
      </div>

      {payments.length > 0 && (
        <div className={styles.filterBar}>
          <button 
            className={`${styles.filterPill} ${filterDay === 'all' ? styles.filterPillActive : ''}`}
            onClick={() => setFilterDay('all')}
          >
            Todos
          </button>
          {Array.from(new Set(payments.flatMap(p => p.days))).sort((a,b) => a - b).map(day => (
            <button 
              key={day}
              className={`${styles.filterPill} ${filterDay === day ? styles.filterPillActive : ''}`}
              onClick={() => setFilterDay(day)}
            >
              Día {day}
            </button>
          ))}
        </div>
      )}

      <section className={styles.listSection}>
        {payments.length === 0 ? (
          <p className="text-body-sm text-center" style={{ color: 'var(--color-on-surface-variant)', marginTop: '16px' }}>No tienes pagos programados.</p>
        ) : (
          (filterDay === 'all' ? payments : payments.filter(p => p.days.includes(filterDay))).map(payment => (
            <Card key={payment.id} interactive className={styles.paymentCard}>
              <div className={styles.paymentIcon}>
                <Calendar size={24} color="var(--color-primary)" />
              </div>
              <div className={styles.paymentInfo} style={{ flex: 1 }}>
                <h3 className="text-body-lg" style={{ fontWeight: 600 }}>{payment.title}</h3>
                <p className="text-label-sm" style={{ color: 'var(--color-warning)' }}>
                  Se cobra los días: {payment.days.sort((a,b) => a - b).join(', ')} de cada mes
                </p>
                <div style={{ marginTop: '4px' }}>
                  <span className="text-headline-sm">${payment.amount}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button variant="ghost" onClick={() => openShareModal(payment)} aria-label="Compartir" style={{ padding: '8px', height: 'auto', minWidth: 'auto' }}>
                  <UserPlus size={20} color="var(--color-primary)" />
                </Button>
                <Button variant="ghost" onClick={() => openDeleteModal(payment)} aria-label="Eliminar" style={{ padding: '8px', height: 'auto', minWidth: 'auto' }}>
                  <Trash2 size={20} color="var(--color-error)" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      {/* Share Modal */}
      <Modal isOpen={isShareModalOpen} onClose={() => !isProcessing && setIsShareModalOpen(false)} title="Compartir Pago">
        <div style={{ marginBottom: '16px', marginTop: '8px' }}>
          <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            Comparte la obligación <strong>{selectedPayment?.title}</strong> con alguien más.
          </p>
        </div>
        <form onSubmit={handleSharePayment}>
          <div style={{ marginBottom: '24px' }}>
            <Input 
              label="Correo Electrónico" 
              placeholder="ejemplo@gmail.com" 
              type="email"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button type="button" variant="ghost" fullWidth onClick={() => setIsShareModalOpen(false)} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={!shareEmail.trim() || isProcessing}>
              {isProcessing ? 'Buscando...' : 'Compartir'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Modal */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => !isProcessing && setIsDeleteModalOpen(false)} title="Eliminar Pago">
        <div style={{ marginBottom: '24px', marginTop: '8px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            ¿Estás seguro de que deseas eliminar el pago recurrente <strong>{selectedPayment?.title}</strong>?
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button type="button" variant="ghost" fullWidth onClick={() => setIsDeleteModalOpen(false)} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" fullWidth onClick={handleDeletePayment} disabled={isProcessing}>
            {isProcessing ? 'Eliminando...' : 'Sí, eliminar'}
          </Button>
        </div>
      </Modal>
    </main>
  );
}


