'use client';
import React, { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { UserEmailAutocomplete } from '@/components/ui/UserEmailAutocomplete';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import { sendPushNotification } from '@/lib/pushUtils';
import { ArrowLeft, Calendar, Settings, UserPlus, Trash2, Lock, Users, Pencil } from 'lucide-react';
import styles from './recurrentes.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, or, doc, updateDoc, deleteDoc, getDocs, arrayUnion, setDoc, Timestamp } from 'firebase/firestore';
import { formatCOP, formatInputCOP, parseCOP } from '@/lib/currency';

interface Payment {
  id: string;
  title: string;
  amount: string;
  days: number[];
  ownerId: string;
  sharedWith?: string[];
  category?: string;
  description?: string;
}

const PAYMENT_CATEGORIES = [
  'Hogar / Casa',
  'Servicios Públicos',
  'Streaming / Suscripciones',
  'Salud / Médico',
  'Educación',
  'Transporte',
  'Tarjetas / Créditos',
];

interface CustomCategory {
  id: string;
  name: string;
  type: 'payment';
}

export default function RecurringPayments() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(PAYMENT_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  
  // Filter state
  const [filterDay, setFilterDay] = useState<number | 'all'>('all');
  const [filterVisibility, setFilterVisibility] = useState<'all' | 'personal' | 'shared'>('all');

  // Form state
  const [isShared, setIsShared] = useState(false);

  // Modals state
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState(PAYMENT_CATEGORIES[0]);
  const [editDescription, setEditDescription] = useState('');
  const [editSelectedDays, setEditSelectedDays] = useState<number[]>([]);
  const [editIsShared, setEditIsShared] = useState(true);
  const [editShareEmail, setEditShareEmail] = useState('');

  const [shareEmail, setShareEmail] = useState('');
  const [createShareEmail, setCreateShareEmail] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentsSettings, setPaymentsSettings] = useState<any>(null);
  const [paidPaymentIds, setPaidPaymentIds] = useState<Set<string>>(new Set());

  // Custom Categories state
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Custom Category Edit State
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');

  const combinedCategories = [...PAYMENT_CATEGORIES, ...customCategories.map(c => c.name), 'Otro'];

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

    const settingsRef = doc(db, 'paymentsSettings', user.uid);
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setPaymentsSettings(docSnap.data());
      } else {
        setPaymentsSettings({ sharedWith: [] });
      }
    });

    const txRef = collection(db, 'transactions');
    const qTx = query(
      txRef,
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const paidIds = new Set<string>();
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      snapshot.forEach(doc => {
        const t = doc.data();
        if (t.recurringPaymentId && t.createdAt) {
          const date = t.createdAt.toDate();
          if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
            paidIds.add(t.recurringPaymentId);
          }
        }
      });
      setPaidPaymentIds(paidIds);
    });

    const catRef = collection(db, 'financeCategories');
    const qCat = query(catRef, where('ownerId', '==', user.uid), where('type', '==', 'payment'));
    const unsubCat = onSnapshot(qCat, (snapshot) => {
      const data: CustomCategory[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as CustomCategory));
      setCustomCategories(data);
    });

    return () => {
      unsubscribe();
      unsubSettings();
      unsubTx();
      unsubCat();
    };
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

    if (isShared && !createShareEmail.trim() && (!paymentsSettings?.sharedWith || paymentsSettings.sharedWith.length === 0)) {
      alert("Al habilitar la opción de compartir, debes escribir el correo de la persona con la que deseas compartir, o desmarcar la casilla.");
      return;
    }

    try {
      let currentSharedWith = paymentsSettings?.sharedWith || [];
      if (createShareEmail.trim()) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', createShareEmail.trim().toLowerCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const friendUid = snap.docs[0].data().uid;
          if (friendUid !== user.uid) {
            const settingsRef = doc(db, 'paymentsSettings', user.uid);
            await setDoc(settingsRef, { sharedWith: arrayUnion(friendUid) }, { merge: true });
            currentSharedWith = [...new Set([...currentSharedWith, friendUid])];
            if (!(paymentsSettings?.sharedWith || []).includes(friendUid)) {
              await addDoc(collection(db, 'notifications'), {
                userId: friendUid,
                title: 'Pagos Compartidos',
                message: `${profile?.displayName || 'Alguien'} ha compartido sus pagos contigo al crear un pago recurrente.`,
                type: 'payment',
                link: '/pagos/recurrentes',
                read: false,
                createdAt: Timestamp.now()
              });
            }
          }
        }
      }

      const paymentData = {
        title: title.trim(),
        amount: parseCOP(amount),
        days: selectedDays.sort((a,b) => a - b),
        ownerId: user.uid,
        sharedWith: isShared && currentSharedWith ? currentSharedWith : [],
        category: category,
        description: description.trim(),
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'recurringPayments'), paymentData);
      
      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> programó el pago recurrente '${title.trim()}' por ${formatCOP(parseCOP(amount))}`, user.uid, []);
      });

      setTitle('');
      setAmount('');
      setSelectedDays([]);
      setCategory(combinedCategories[0] || PAYMENT_CATEGORIES[0]);
      setDescription('');
      setIsShared(true);
      setCreateShareEmail('');
    } catch (error) {
      console.error("Error al guardar pago:", error);
    }
  };

  const openShareModal = () => {
    setShareEmail('');
    setIsShareModalOpen(true);
  };

  const openDeleteModal = (payment: Payment) => {
    setSelectedPayment(payment);
    setIsDeleteModalOpen(true);
  };

  const openEditModal = (payment: Payment) => {
    setSelectedPayment(payment);
    setEditTitle(payment.title);
    setEditAmount(formatCOP(Number(payment.amount)));
    setEditCategory(payment.category || combinedCategories[0] || PAYMENT_CATEGORIES[0]);
    setEditDescription(payment.description || '');
    setEditSelectedDays(payment.days || []);
    setEditIsShared(payment.sharedWith && payment.sharedWith.length > 0 ? true : false);
    setEditShareEmail('');
    setIsEditModalOpen(true);
  };

  const toggleEditDay = (day: number) => {
    setEditSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleEditPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPayment || !user || !editTitle.trim() || !editAmount.trim() || editSelectedDays.length === 0) {
      alert("Por favor completa todos los campos y selecciona al menos un día.");
      return;
    }

    if (editIsShared && !editShareEmail.trim() && (!paymentsSettings?.sharedWith || paymentsSettings.sharedWith.length === 0)) {
      alert("Al habilitar la opción de compartir, debes escribir el correo de la persona con la que deseas compartir, o desmarcar la casilla.");
      return;
    }

    setIsProcessing(true);
    try {
      const currentSharedWith = paymentsSettings?.sharedWith || [];
      if (editShareEmail.trim()) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', editShareEmail.trim().toLowerCase()));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const friendUid = snap.docs[0].data().uid;
          if (friendUid !== user.uid) {
            const settingsRef = doc(db, 'paymentsSettings', user.uid);
            await setDoc(settingsRef, { sharedWith: arrayUnion(friendUid) }, { merge: true });
            currentSharedWith.push(friendUid);
            if (!(paymentsSettings?.sharedWith || []).includes(friendUid)) {
              await addDoc(collection(db, 'notifications'), {
                userId: friendUid,
                title: 'Pagos Compartidos',
                message: `${profile?.displayName || 'Alguien'} ha compartido sus pagos contigo al editar un pago recurrente.`,
                type: 'payment',
                link: '/pagos/recurrentes',
                read: false,
                createdAt: Timestamp.now()
              });
            }
          }
        }
      }

      const uniqueSharedWith = [...new Set(currentSharedWith)];

      const updatedData = {
        title: editTitle.trim(),
        amount: parseCOP(editAmount),
        days: editSelectedDays.sort((a,b) => a - b),
        category: editCategory,
        description: editDescription.trim(),
        sharedWith: editIsShared && uniqueSharedWith ? uniqueSharedWith : [],
      };

      await updateDoc(doc(db, 'recurringPayments', selectedPayment.id), updatedData);
      
      setIsEditModalOpen(false);
    } catch (error) {
      console.error(error);
      alert("Error al actualizar el pago");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSharePayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!shareEmail.trim() || !user || !profile) return;
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

      const friendDoc = snap.docs[0];
      const friendUid = friendDoc.data().uid;
      const friendName = friendDoc.data().displayName || shareEmail;

      if (friendUid === user.uid) {
        alert("No puedes invitarte a ti mismo.");
        setIsProcessing(false);
        return;
      }

      const settingsRef = doc(db, 'paymentsSettings', user.uid);
      await setDoc(settingsRef, {
        sharedWith: arrayUnion(friendUid)
      }, { merge: true });

      await addDoc(collection(db, 'notifications'), {
        userId: friendUid,
        title: 'Pagos Programados',
        message: `${profile.displayName || 'Alguien'} ha compartido sus pagos programados contigo.`,
        type: 'payment',
        link: '/pagos/recurrentes',
        read: false,
        createdAt: Timestamp.now()
      });

      alert(`¡Módulo de pagos compartido con éxito con ${friendName}!`);
      setIsShareModalOpen(false);
      setShareEmail('');
    } catch (error) {
      console.error(error);
      alert("Hubo un error al compartir.");
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

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim() || !user) return;
    try {
      await addDoc(collection(db, 'financeCategories'), {
        name: newCategoryName.trim(),
        type: 'payment',
        ownerId: user.uid
      });
      setNewCategoryName('');
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'financeCategories', id));
    } catch (error) {
      console.error(error);
    }
  };

  const handleEditCategory = async (id: string) => {
    if (!editCategoryName.trim()) return;
    try {
      await updateDoc(doc(db, 'financeCategories', id), {
        name: editCategoryName.trim()
      });
      setEditingCategoryId(null);
      setEditCategoryName('');
    } catch (error) {
      console.error(error);
    }
  };

  const startEditingCategory = (cat: CustomCategory) => {
    setEditingCategoryId(cat.id);
    setEditCategoryName(cat.name);
  };

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link href="/">
            <Button variant="ghost" className={styles.iconBtn}>
              <ArrowLeft size={24} />
            </Button>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 className="text-headline-sm">Pagos Programados</h1>
            {(paymentsSettings?.sharedWith && paymentsSettings.sharedWith.length > 0) && (
              <AvatarGroup 
                users={[
                  usersMap[user?.uid || ''],
                  ...paymentsSettings.sharedWith.map((uid: string) => usersMap[uid])
                ].filter(Boolean) as any} 
                size="sm" 
              />
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button variant="ghost" className={styles.iconBtn} onClick={openShareModal}>
            <UserPlus size={20} color="var(--color-primary)" />
          </Button>
        </div>
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
            label="Monto" 
            placeholder="Ej. 1.500.000" 
            type="text"
            value={amount}
            onChange={(e) => setAmount(formatInputCOP(e.target.value))}
            required
          />
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label className="text-label-md" style={{ color: 'var(--color-on-surface)' }}>Categoría</label>
              <select 
                value={category} 
                onChange={(e) => setCategory(e.target.value)}
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
                  marginTop: '4px'
                }}
              >
                {combinedCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <Button variant="secondary" className={styles.iconBtn} onClick={() => setIsCategoriesModalOpen(true)} type="button" aria-label="Gestionar categorías">
              <Settings size={20} />
            </Button>
          </div>

          <Input 
            label="Comentario (Opcional)" 
            placeholder="Ej. Transferir a la cuenta de ahorros..." 
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
            <input 
              type="checkbox" 
              id="sharePayment" 
              checked={isShared} 
              onChange={(e) => setIsShared(e.target.checked)} 
              style={{ width: '18px', height: '18px' }}
            />
            <label htmlFor="sharePayment" className="text-body-md" style={{ color: 'var(--color-on-surface)' }}>
              Compartir este pago
            </label>
          </div>

          {isShared && (
            <div style={{ marginTop: '8px', marginBottom: '8px' }}>
              <UserEmailAutocomplete value={createShareEmail} onChange={setCreateShareEmail} />
              {paymentsSettings?.sharedWith?.length > 0 ? (
                <p className="text-label-sm" style={{ color: 'var(--color-primary)', marginTop: '8px' }}>
                  Ya compartes pagos con {paymentsSettings.sharedWith.length} persona(s). Escribe un correo solo si quieres añadir a alguien nuevo.
                </p>
              ) : (
                <p className="text-label-sm" style={{ color: 'var(--color-warning)', marginTop: '8px' }}>
                  Requerido: Escribe el correo del usuario con quien deseas compartir.
                </p>
              )}
            </div>
          )}

          <Button type="submit" variant="primary" style={{ marginTop: '16px' }}>
            Guardar Pago Programado
          </Button>
        </form>
      </Card>

      {/* Lista de Obligaciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '16px' }}>
        <h2 className="text-headline-sm">Tus Obligaciones</h2>
        {payments.length > 0 && (
          <div style={{ textAlign: 'right' }}>
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>Total {filterVisibility === 'all' ? '' : filterVisibility === 'personal' ? 'Personal' : 'Compartido'}</p>
            <p className="text-headline-sm" style={{ color: 'var(--color-primary)' }}>
              {formatCOP(
                payments
                  .filter(p => {
                    if (filterVisibility === 'personal') return p.ownerId === user.uid && (!p.sharedWith || p.sharedWith.length === 0);
                    if (filterVisibility === 'shared') return p.ownerId !== user.uid || (p.sharedWith && p.sharedWith.length > 0);
                    return true;
                  })
                  .filter(p => filterDay === 'all' ? true : p.days.includes(filterDay))
                  .reduce((sum, p) => sum + (Number(p.amount) * (filterDay === 'all' ? p.days.length : 1)), 0)
              )}
            </p>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
        <Button 
          variant={filterVisibility === 'all' ? 'primary' : 'secondary'} 
          onClick={() => setFilterVisibility('all')}
          style={{ borderRadius: '20px', padding: '4px 12px', fontSize: '14px', flex: '0 0 auto', minHeight: 'auto' }}
        >
          Todos
        </Button>
        <Button 
          variant={filterVisibility === 'personal' ? 'primary' : 'secondary'} 
          onClick={() => setFilterVisibility('personal')}
          style={{ borderRadius: '20px', padding: '4px 12px', fontSize: '14px', flex: '0 0 auto', minHeight: 'auto' }}
        >
          Personales
        </Button>
        <Button 
          variant={filterVisibility === 'shared' ? 'primary' : 'secondary'} 
          onClick={() => setFilterVisibility('shared')}
          style={{ borderRadius: '20px', padding: '4px 12px', fontSize: '14px', flex: '0 0 auto', minHeight: 'auto' }}
        >
          Compartidos
        </Button>
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
          Object.entries(
            (filterDay === 'all' ? payments : payments.filter(p => p.days.includes(filterDay)))
              .filter(p => {
                if (filterVisibility === 'personal') return p.ownerId === user.uid && (!p.sharedWith || p.sharedWith.length === 0);
                if (filterVisibility === 'shared') return p.ownerId !== user.uid || (p.sharedWith && p.sharedWith.length > 0);
                return true;
              })
              .reduce((acc, p) => {
                const cat = p.category || 'Otros';
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(p);
                return acc;
              }, {} as Record<string, Payment[]>)
          ).sort(([a], [b]) => a.localeCompare(b)).map(([catName, groupPayments]) => (
            <div key={catName} style={{ marginBottom: '16px' }}>
              <h3 className="text-label-md" style={{ color: 'var(--color-primary)', marginBottom: '8px', paddingLeft: '4px' }}>
                {catName}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {groupPayments.map(payment => (
                  <Card key={payment.id} interactive className={styles.paymentCard} style={{ marginBottom: 0 }}>
                    <div className={styles.paymentIcon}>
                      <Calendar size={24} color="var(--color-primary)" />
                    </div>
                    <div className={styles.paymentInfo} style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <h3 className="text-body-lg" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {payment.title}
                          {(payment.sharedWith && payment.sharedWith.length > 0) || payment.ownerId !== user?.uid ? (
                            <div style={{ marginLeft: '4px' }}>
                              <AvatarGroup 
                                users={[
                                  usersMap[payment.ownerId],
                                  ...(payment.sharedWith || []).map((uid: string) => usersMap[uid])
                                ].filter(Boolean) as any} 
                                size="sm" 
                              />
                            </div>
                          ) : (
                            <Lock size={16} color="var(--color-on-surface-variant)" />
                          )}
                        </h3>
                        {paidPaymentIds.has(payment.id) && (
                          <span style={{ 
                            fontSize: '12px', 
                            backgroundColor: 'var(--color-success)', 
                            color: '#FFFFFF', 
                            padding: '2px 8px', 
                            borderRadius: '12px',
                            fontWeight: 500,
                            whiteSpace: 'nowrap'
                          }}>
                            ✅ Pagado
                          </span>
                        )}
                      </div>
                      <p className="text-label-sm" style={{ color: 'var(--color-warning)' }}>
                        Se cobra los días: {payment.days.sort((a,b) => a - b).join(', ')} de cada mes
                      </p>
                      {payment.description && (
                        <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                          {payment.description}
                        </p>
                      )}
                      <div style={{ marginTop: '4px' }}>
                        <span className="text-headline-sm" style={{ color: paidPaymentIds.has(payment.id) ? 'var(--color-success)' : 'inherit' }}>
                          {formatCOP(Number(payment.amount) * (filterDay === 'all' ? payment.days.length : 1))}
                        </span>
                        {filterDay === 'all' && payment.days.length > 1 && (
                          <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginLeft: '8px' }}>
                            ({formatCOP(Number(payment.amount))} c/u)
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
                      {(payment.ownerId === user?.uid || (payment.sharedWith && payment.sharedWith.includes(user?.uid || ''))) && (
                        <>
                          <Button variant="ghost" onClick={(e) => { e.stopPropagation(); openEditModal(payment); }} aria-label="Editar" style={{ padding: '8px', height: 'auto', minWidth: 'auto' }}>
                            <Pencil size={20} color="var(--color-primary)" />
                          </Button>
                          <Button variant="ghost" onClick={(e) => { e.stopPropagation(); openDeleteModal(payment); }} aria-label="Eliminar" style={{ padding: '8px', height: 'auto', minWidth: 'auto' }}>
                            <Trash2 size={20} color="var(--color-error)" />
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* Share Modal */}
      <Modal isOpen={isShareModalOpen} onClose={() => !isProcessing && setIsShareModalOpen(false)} title="Compartir Pagos">
        <div style={{ marginBottom: '16px', marginTop: '8px' }}>
          <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            Comparte todo el módulo de <strong>Pagos Programados</strong> con alguien más.
          </p>
        </div>
        <form onSubmit={handleSharePayment}>
          <div style={{ marginBottom: '24px' }}>
            <UserEmailAutocomplete 
              value={shareEmail}
              onChange={(val) => setShareEmail(val)}
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

      {/* Edit Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => !isProcessing && setIsEditModalOpen(false)} title="Editar Pago Programado">
        <form onSubmit={handleEditPayment} style={{ marginTop: '8px' }}>
          <div style={{ marginBottom: '16px' }}>
            <Input 
              label="Nombre del Pago" 
              placeholder="Ej. Arriendo, Servicios..." 
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <Input 
              label="Monto" 
              placeholder="Ej. 1.500.000" 
              type="text"
              value={editAmount}
              onChange={(e) => setEditAmount(formatInputCOP(e.target.value))}
              required
            />
          </div>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '16px' }}>
            <div style={{ flex: 1 }}>
              <label className="text-label-md" style={{ color: 'var(--color-on-surface)' }}>
                Categoría
              </label>
              <select 
                value={editCategory} 
                onChange={(e) => setEditCategory(e.target.value)}
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
                  marginTop: '4px'
                }}
              >
                {combinedCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <Button variant="secondary" className={styles.iconBtn} onClick={() => setIsCategoriesModalOpen(true)} type="button" aria-label="Gestionar categorías">
              <Settings size={20} />
            </Button>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <Input 
              label="Comentario (Opcional)" 
              placeholder="Ej. Transferir a la cuenta de ahorros..." 
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
            />
          </div>
          
          <div className={styles.frequencyGroup} style={{ marginBottom: '16px' }}>
            <label className="text-label-md" style={{ color: 'var(--color-on-surface)' }}>
              Días de Cobro (Se repetirá cada mes)
            </label>
            <div className={styles.dayGrid}>
              {days.map(day => (
                <button
                  key={day}
                  type="button"
                  className={`${styles.dayButton} ${editSelectedDays.includes(day) ? styles.daySelected : ''}`}
                  onClick={() => toggleEditDay(day)}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <input 
              type="checkbox" 
              id="editSharePayment" 
              checked={editIsShared} 
              onChange={(e) => setEditIsShared(e.target.checked)} 
              style={{ width: '18px', height: '18px' }}
            />
            <label htmlFor="editSharePayment" className="text-body-md" style={{ color: 'var(--color-on-surface)' }}>
              Compartir este pago
            </label>
          </div>

          {editIsShared && (
            <div style={{ marginTop: '8px', marginBottom: '24px' }}>
              <UserEmailAutocomplete value={editShareEmail} onChange={setEditShareEmail} />
              {paymentsSettings?.sharedWith?.length > 0 ? (
                <p className="text-label-sm" style={{ color: 'var(--color-primary)', marginTop: '8px' }}>
                  Ya compartes pagos con {paymentsSettings.sharedWith.length} persona(s). Escribe un correo solo si quieres añadir a alguien nuevo.
                </p>
              ) : (
                <p className="text-label-sm" style={{ color: 'var(--color-warning)', marginTop: '8px' }}>
                  Requerido: Escribe el correo del usuario con quien deseas compartir.
                </p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <Button type="button" variant="ghost" fullWidth onClick={() => setIsEditModalOpen(false)} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={isProcessing || !editTitle.trim() || !editAmount.trim()}>
              {isProcessing ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Categorías Modal */}
      <Modal isOpen={isCategoriesModalOpen} onClose={() => setIsCategoriesModalOpen(false)} title="Tus Categorías">
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto' }}>
          <div>
            <h4 className="text-label-md" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '8px' }}>Categorías Personalizadas</h4>
            {customCategories.length === 0 ? (
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)', fontStyle: 'italic' }}>
                No has creado categorías personalizadas aún.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {customCategories.map(cat => (
                  <div key={cat.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--color-surface-container-lowest)', borderRadius: '8px', border: '1px solid var(--color-outline-variant)' }}>
                    {editingCategoryId === cat.id ? (
                      <div style={{ display: 'flex', gap: '8px', flex: 1, alignItems: 'center' }}>
                        <input 
                          type="text" 
                          value={editCategoryName} 
                          onChange={(e) => setEditCategoryName(e.target.value)} 
                          autoFocus
                          style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--color-outline-variant)', background: 'var(--color-surface)', color: 'var(--color-on-surface)' }}
                        />
                        <button onClick={() => handleEditCategory(cat.id)} style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>Guardar</button>
                        <button onClick={() => setEditingCategoryId(null)} style={{ color: 'var(--color-on-surface-variant)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>Cancelar</button>
                      </div>
                    ) : (
                      <>
                        <span className="text-body-md">{cat.name}</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button 
                            onClick={() => startEditingCategory(cat)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-on-surface-variant)', cursor: 'pointer', padding: '4px' }}
                            aria-label="Editar categoría"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                          </button>
                          <button 
                            onClick={() => handleDeleteCategory(cat.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', padding: '4px' }}
                            aria-label="Eliminar categoría"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--color-outline-variant)' }}>
            <div style={{ flex: 1 }}>
              <Input 
                label="Nueva Categoría" 
                placeholder="Ej. Gimnasio..." 
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" style={{ alignSelf: 'flex-end', padding: '12px', height: '48px' }} disabled={!newCategoryName.trim()}>
              Agregar
            </Button>
          </form>
        </div>
      </Modal>
    </main>
  );
}


