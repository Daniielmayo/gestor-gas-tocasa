'use client';
import React, { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { FAB } from '@/components/ui/FAB';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ListSummaryCard } from '@/components/ui/ListSummaryCard';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import styles from './listas.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, or } from 'firebase/firestore';

interface SharedList {
  id: string;
  title: string;
  ownerId: string;
}

export default function Listas() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  
  const [lists, setLists] = useState<SharedList[]>([]);
  const [isLoadingLists, setIsLoadingLists] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
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
    const qLists = query(
      listsRef, 
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.uid)
      )
    );

    const unsubLists = onSnapshot(qLists, (snapshot) => {
      const data: any[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });
      // Client-side sort by updatedAt fallback to createdAt
      data.sort((a, b) => {
        const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
        const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
        return timeB - timeA; // Descending
      });
      
      setLists(data);
      setIsLoadingLists(false);
    });

    return () => unsubLists();
  }, [user]);

  const handleCreateList = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !profile) return;
    if (!newListName || newListName.trim() === '') return;

    setIsCreatingList(true);

    try {
      const docRef = await addDoc(collection(db, 'lists'), {
        title: newListName.trim(),
        ownerId: user.uid,
        sharedWith: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> creó la lista compartida '${newListName.trim()}'`, user.uid, []);
      });

      setIsModalOpen(false);
      router.push(`/lista/${docRef.id}`);
    } catch (error: any) {
      console.error("Error creating list:", error);
      alert(`Hubo un error al crear la lista: ${error.message || error}`);
      setIsCreatingList(false);
    }
  };

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando listas..." />
      </main>
    );
  }

  return (
    <main className={`container ${styles.main}`}>
      <header className={styles.appBar}>
        <Link href="/">
          <Button variant="ghost" className={styles.iconBtn}>
            <ArrowLeft size={26} />
          </Button>
        </Link>
        <h1 className="text-headline-md">Todas Tus Listas</h1>
        <Button variant="ghost" className={styles.iconBtn}>
          <Search size={26} />
        </Button>
      </header>

      <section className={styles.listSection}>
        {isLoadingLists ? (
          <div style={{ padding: '20px 0' }}><Spinner message="Cargando listas..." fullScreen={false} /></div>
        ) : lists.length === 0 ? (
          <Card style={{ textAlign: 'center', padding: '32px 16px', background: 'var(--color-surface-container-low)', marginTop: '24px' }}>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-primary-container)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus color="var(--color-primary)" size={24} />
              </div>
            </div>
            <h4 className="text-headline-sm" style={{ marginBottom: '8px' }}>Ninguna lista aún</h4>
            <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '24px' }}>
              Empieza a organizarte creando tu primera lista.
            </p>
            <Button onClick={() => setIsModalOpen(true)} variant="primary" style={{ margin: '0 auto' }}>
              Crear mi primera lista
            </Button>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
            {lists.map(list => (
              <Link key={list.id} href={`/lista/${list.id}`} style={{ textDecoration: 'none' }}>
                <ListSummaryCard list={list} styles={styles} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <FAB onClick={() => setIsModalOpen(true)} icon={<Plus size={24} />} aria-label="Nueva Lista" />

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
    </main>
  );
}
