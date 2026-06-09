'use client';
import React, { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { FAB } from '@/components/ui/FAB';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Plus, Bell, Settings, Receipt, CreditCard, ChevronRight } from 'lucide-react';
import styles from './dashboard.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, or } from 'firebase/firestore';

interface SharedList {
  id: string;
  title: string;
  ownerId: string;
}

export default function Dashboard() {
  const { user, profile, loading, logout } = useAuth();
  const router = useRouter();
  
  const [lists, setLists] = useState<SharedList[]>([]);
  const [isLoadingLists, setIsLoadingLists] = useState(true);
  
  const [isCreationMenuOpen, setIsCreationMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [isCreatingList, setIsCreatingList] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const listsRef = collection(db, 'lists');
    // For simplicity, we just look at lists owned by the user or shared with them
    const q = query(
      listsRef, 
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: SharedList[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as SharedList);
      });
      setLists(data);
      setIsLoadingLists(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleCreateList = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!user) return;
    if (!newListName || newListName.trim() === '') return;

    setIsCreatingList(true);

    try {
      const docRef = await addDoc(collection(db, 'lists'), {
        title: newListName.trim(),
        ownerId: user.uid,
        sharedWith: [],
        createdAt: serverTimestamp()
      });
      setIsModalOpen(false);
      router.push(`/lista/${docRef.id}`);
    } catch (error: any) {
      console.error("Error creating list:", error);
      alert(`Hubo un error al crear la lista: ${error.message || error}`);
      setIsCreatingList(false);
    }
  };

  const openModal = () => {
    setNewListName('');
    setIsModalOpen(true);
  };

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando tu hogar..." />
      </main>
    );
  }

  return (
    <main className={`container ${styles.main}`}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className="text-headline-md">Hola, {profile?.displayName?.split(' ')[0] || 'Usuario'}</h1>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            Resumen de tu hogar
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/historial">
            <Button variant="ghost" className={styles.iconBtn}>
              <Bell size={24} />
            </Button>
          </Link>
          <div onClick={() => setIsProfileModalOpen(true)} style={{ cursor: 'pointer' }}>
            <Avatar initials={profile?.initials || 'US'} src={profile?.photoURL || undefined} size="sm" />
          </div>
        </div>
      </header>

      {/* Balance/Pending Card */}
      <Card className={styles.balanceCard}>
        <div className={styles.balanceHeader}>
          <span className="text-label-md" style={{ color: 'var(--color-primary-container)' }}>
            Pendiente a Pagar
          </span>
          <Receipt size={20} color="var(--color-primary-container)" />
        </div>
        <h2 className="text-display-lg" style={{ color: '#FFF' }}>$450.00</h2>
        <div className={styles.balanceFooter}>
          <span className="text-label-sm">Vence en 2 días</span>
          <Button variant="secondary" size="sm" style={{ color: 'var(--color-primary)' }}>
            Pagar Ahora
          </Button>
        </div>
      </Card>

      {/* Quick Actions */}
      <div className={styles.quickActions}>
        <Link href="/pagos/recurrentes" className={styles.actionItem}>
          <div className={styles.actionIcon}>
            <CreditCard size={24} color="var(--color-primary)" />
          </div>
          <span className="text-label-sm">Recurrentes</span>
        </Link>
        <Link href="/historial" className={styles.actionItem}>
          <div className={styles.actionIcon}>
            <Receipt size={24} color="var(--color-primary)" />
          </div>
          <span className="text-label-sm">Historial</span>
        </Link>
        <div className={styles.actionItem} onClick={() => setIsProfileModalOpen(true)} style={{ cursor: 'pointer' }}>
          <div className={styles.actionIcon}>
            <Settings size={24} color="var(--color-primary)" />
          </div>
          <span className="text-label-sm">Ajustes</span>
        </div>
      </div>

      {/* Shared Lists */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className="text-headline-sm">Tus Listas Compartidas</h3>
        </div>
        
        <div className={styles.listContainer}>
          {isLoadingLists ? (
            <div style={{ padding: '20px 0' }}><Spinner message="Cargando listas..." fullScreen={false} /></div>
          ) : lists.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '32px 16px', background: 'var(--color-surface-container-low)' }}>
              <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-primary-container)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Plus color="var(--color-primary)" size={24} />
                </div>
              </div>
              <h4 className="text-headline-sm" style={{ marginBottom: '8px' }}>Ninguna lista aún</h4>
              <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '24px' }}>
                Empieza a organizarte creando tu primera lista compartida.
              </p>
              <Button onClick={() => setIsCreationMenuOpen(true)} variant="primary" style={{ margin: '0 auto' }}>
                Crear mi primera lista
              </Button>
            </Card>
          ) : (
            lists.map(list => (
              <Link key={list.id} href={`/lista/${list.id}`} style={{ textDecoration: 'none' }}>
                <Card interactive className={styles.listItem}>
                  <div className={styles.listInfo}>
                    <h4 className="text-body-lg" style={{ fontWeight: 600 }}>{list.title}</h4>
                  </div>
                  <div className={styles.listAvatars}>
                    <ChevronRight size={20} color="var(--color-outline)" />
                  </div>
                </Card>
              </Link>
            ))
          )}
        </div>
      </section>

      {/* FAB to Add New List/Payment */}
      <FAB onClick={() => setIsCreationMenuOpen(true)} icon={<Plus size={24} />} aria-label="Nueva Lista o Pago" />

      {/* Creation Menu Modal */}
      <Modal isOpen={isCreationMenuOpen} onClose={() => setIsCreationMenuOpen(false)} title="¿Qué deseas crear?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
          <Button variant="primary" fullWidth onClick={() => {
            setIsCreationMenuOpen(false);
            openModal();
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Receipt size={20} />
              <span>Nueva Lista Compartida</span>
            </div>
          </Button>
          <Button variant="secondary" fullWidth onClick={() => {
            setIsCreationMenuOpen(false);
            router.push('/pagos/recurrentes');
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <CreditCard size={20} />
              <span>Nuevo Pago Recurrente</span>
            </div>
          </Button>
        </div>
      </Modal>

      {/* Create List Modal */}
      <Modal isOpen={isModalOpen} onClose={() => !isCreatingList && setIsModalOpen(false)} title="Nueva Lista">
        <form onSubmit={handleCreateList}>
          <div style={{ marginBottom: '24px', marginTop: '16px' }}>
            <Input 
              label="Nombre de la Lista" 
              placeholder="Ej. Supermercado, Viaje, etc." 
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button type="button" variant="ghost" fullWidth onClick={() => setIsModalOpen(false)} disabled={isCreatingList}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={!newListName.trim() || isCreatingList}>
              {isCreatingList ? 'Creando...' : 'Crear Lista'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Profile Modal */}
      <Modal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} title="Tu Perfil">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <Avatar 
            src={profile?.photoURL || undefined} 
            initials={profile?.initials || 'US'} 
            size="lg" 
            style={{ margin: '0 auto 16px' }}
          />
          <h3 className="text-body-lg" style={{ fontWeight: 600 }}>{profile?.displayName}</h3>
          <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>{profile?.email}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Button variant="danger" fullWidth onClick={async () => {
            setIsProfileModalOpen(false);
            await logout();
            router.push('/login');
          }}>
            Cerrar Sesión
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setIsProfileModalOpen(false)}>
            Cerrar
          </Button>
        </div>
      </Modal>
    </main>
  );
}

