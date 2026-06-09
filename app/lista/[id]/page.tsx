'use client';
import React, { use, useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { UserEmailAutocomplete } from '@/components/ui/UserEmailAutocomplete';
import { useUsersMap } from '@/lib/hooks/useUsersMap';
import { AvatarGroup } from '@/components/ui/AvatarGroup';
import { Trash2, Plus, ArrowLeft, MoreVertical, Pencil, UserPlus, CheckCircle2, Send } from 'lucide-react';
import styles from './lista.module.css';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, addDoc, serverTimestamp, updateDoc, deleteDoc, getDocs, arrayUnion, Timestamp } from 'firebase/firestore';

interface ListItem {
  id: string;
  content: string;
  completed: boolean;
  createdBy: string;
  creatorName: string;
  createdAt: any;
}

export default function SharedList({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const listId = resolvedParams.id;
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { usersMap } = useUsersMap();

  const [listTitle, setListTitle] = useState('Cargando...');
  const [items, setItems] = useState<ListItem[]>([]);
  const [newItemContent, setNewItemContent] = useState('');

  // Estados para modales
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [isSharing, setIsSharing] = useState(false);

  const [listData, setListData] = useState<any>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || !listId) return;

    // Suscribirse al documento de la lista
    const listRef = doc(db, 'lists', listId);
    const unsubList = onSnapshot(listRef, (docSnap) => {
      if (docSnap.exists()) {
        setListTitle(docSnap.data().title);
        setListData(docSnap.data());
      } else {
        setListTitle('Lista no encontrada');
      }
    });

    // Suscribirse a los items de la lista
    const itemsRef = collection(db, 'listItems');
    // Removemos orderBy de la query de Firebase para evitar requerir un Índice Compuesto manual
    const q = query(itemsRef, where('listId', '==', listId));
    const unsubItems = onSnapshot(q, (snapshot) => {
      const data: ListItem[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as ListItem);
      });
      
      // Ordenamos en el cliente por fecha de creación
      data.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
        return timeA - timeB;
      });
      
      setItems(data);
    });

    return () => {
      unsubList();
      unsubItems();
    };
  }, [user, listId]);

  const handleAddItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!newItemContent.trim() || !user || !profile || !listData) return;

    const content = newItemContent.trim();
    setNewItemContent('');

    try {
      await addDoc(collection(db, 'listItems'), {
        listId,
        content,
        completed: false,
        createdBy: user.uid,
        creatorName: profile?.displayName?.split(' ')[0] || 'Usuario',
        createdAt: serverTimestamp()
      });
      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> añadió "${content}" a la lista '${listTitle}'`, listData.ownerId, listData.sharedWith || []);
      });
      // Bump updatedAt on parent list
      await updateDoc(doc(db, 'lists', listId), {
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error agregando item:", error);
    }
  };

  const toggleItem = async (itemId: string, currentStatus: boolean, content: string) => {
    if (!user || !profile || !listData) return;
    try {
      const itemRef = doc(db, 'listItems', itemId);
      await updateDoc(itemRef, {
        completed: !currentStatus
      });
      const actionStr = !currentStatus ? "completó" : "desmarcó";
      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> ${actionStr} "${content}" en la lista '${listTitle}'`, listData.ownerId, listData.sharedWith || []);
      });
      // Bump updatedAt on parent list
      await updateDoc(doc(db, 'lists', listId), {
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error al actualizar item:", error);
    }
  };

  const handleUpdateTitle = async (e: FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    setIsSavingTitle(true);
    try {
      await updateDoc(doc(db, 'lists', listId), { title: editTitle.trim() });
      setIsEditModalOpen(false);
    } catch (error) {
      console.error(error);
      alert("Error al actualizar el nombre");
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleDeleteList = async () => {
    if (!listData || !user || !profile) return;
    setIsDeleting(true);
    try {
      // Borrar primero los items
      const itemsRef = collection(db, 'listItems');
      const q = query(itemsRef, where('listId', '==', listId));
      const snap = await getDocs(q);
      const deletePromises = snap.docs.map(d => deleteDoc(doc(db, 'listItems', d.id)));
      await Promise.all(deletePromises);
      
      // Borrar lista
      await deleteDoc(doc(db, 'lists', listId));
      
      import('@/lib/history').then(({ logActivity }) => {
        logActivity(`<strong>${profile.displayName}</strong> eliminó la lista '${listTitle}'`, listData.ownerId, listData.sharedWith || []);
      });

      router.push('/');
    } catch(e) {
      console.error(e);
      alert("Error al eliminar la lista");
      setIsDeleting(false);
    }
  };

  const openEditModal = () => {
    setEditTitle(listTitle);
    setIsEditModalOpen(true);
  };

  const handleShareList = async (e: FormEvent) => {
    e.preventDefault();
    if (!shareEmail.trim() || !user || !profile || !listData) return;
    setIsSharing(true);

    try {
      // 1. Buscar usuario por email
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', shareEmail.trim().toLowerCase()));
      const snap = await getDocs(q);

      if (snap.empty) {
        alert("Ese correo electrónico no está registrado en la app. Pídele que inicie sesión primero.");
        setIsSharing(false);
        return;
      }

      const friendDoc = snap.docs[0];
      const friendUid = friendDoc.data().uid;
      const friendName = friendDoc.data().displayName || shareEmail;

      if (friendUid === user?.uid) {
        alert("No puedes invitarte a ti mismo.");
        setIsSharing(false);
        return;
      }

      // 2. Añadir UID al array sharedWith
      await updateDoc(doc(db, 'lists', listId), {
        sharedWith: arrayUnion(friendUid)
      });

      // 3. Crear notificación
      await addDoc(collection(db, 'notifications'), {
        userId: friendUid,
        title: 'Nueva Lista Compartida',
        message: `${profile.displayName || 'Alguien'} ha compartido la lista '${listData.title}' contigo.`,
        type: 'list',
        link: `/lista/${listId}`,
        read: false,
        createdAt: Timestamp.now()
      });

      import('@/lib/history').then(({ logActivity }) => {
        // Obtenemos los sharedWith actuales y añadimos al amigo para que también lo vea
        const newSharedWith = [...(listData.sharedWith || []), friendUid];
        logActivity(`<strong>${profile.displayName}</strong> compartió la lista '${listTitle}' con ${friendName}`, listData.ownerId, newSharedWith);
      });

      alert(`¡Lista compartida con éxito con ${friendName}!`);
      setIsShareModalOpen(false);
      setShareEmail('');
    } catch (error) {
      console.error(error);
      alert("Hubo un error al compartir la lista");
    } finally {
      setIsSharing(false);
    }
  };

  if (loading || !user) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Cargando tu lista..." />
      </main>
    );
  }

  return (
    <main className={`container ${styles.main}`}>
      {/* App Bar */}
      <header className={styles.appBar}>
        <Link href="/">
          <Button variant="ghost" className={styles.iconBtn} onClick={() => router.push('/listas')}>
            <ArrowLeft size={26} />
          </Button>
        </Link>
        <div className={styles.titleContainer} style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 className="text-headline-md capitalize" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listTitle}</h1>
          {(listData?.sharedWith && listData.sharedWith.length > 0) && (
            <AvatarGroup 
              users={[
                usersMap[listData.ownerId || ''],
                ...listData.sharedWith.map((uid: string) => usersMap[uid])
              ].filter(Boolean) as any} 
              size="sm" 
            />
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button variant="ghost" className={styles.iconBtn} onClick={() => setIsShareModalOpen(true)} aria-label="Compartir lista">
            <UserPlus size={20} color="var(--color-primary)" />
          </Button>
          <Button variant="ghost" className={styles.iconBtn} onClick={openEditModal} aria-label="Editar nombre">
            <Pencil size={20} />
          </Button>
          {listData?.ownerId === user?.uid && (
            <Button variant="ghost" className={styles.iconBtn} onClick={() => setIsDeleteModalOpen(true)} aria-label="Eliminar lista">
              <Trash2 size={20} color="var(--color-error)" />
            </Button>
          )}
        </div>
      </header>

      {/* Items List */}
      <section className={styles.itemsSection}>
        <Card className={styles.listCard}>
          {items.length === 0 ? (
            <p className="text-center text-body-sm" style={{ padding: '20px', color: 'var(--color-on-surface-variant)' }}>
              No hay ítems en esta lista.
            </p>
          ) : (
            items.map(item => (
              <div key={item.id} className={`${styles.listItem} ${item.completed ? styles.completedItem : ''}`}>
                <div className={styles.itemContent}>
                  <Checkbox 
                    label={item.content} 
                    checked={item.completed} 
                    onChange={() => toggleItem(item.id, item.completed, item.content)} 
                  />
                  <span className={styles.itemTag}>
                    {item.creatorName} • {item.createdAt ? new Date(item.createdAt.toDate()).toLocaleDateString() : 'Añadiendo...'}
                  </span>
                </div>
              </div>
            ))
          )}
        </Card>
      </section>

      {/* Fixed Bottom Input */}
      <div className={styles.bottomInputContainer}>
        <form className={styles.inputWrapper} onSubmit={handleAddItem}>
          <input 
            type="text" 
            placeholder="Añadir nuevo ítem..." 
            className={styles.bottomInput}
            value={newItemContent}
            onChange={(e) => setNewItemContent(e.target.value)}
          />
          <Button variant="primary" type="submit" className={styles.sendBtn} disabled={!newItemContent.trim()}>
            <Send size={18} />
          </Button>
        </form>
      </div>

      {/* Edit List Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => !isSavingTitle && setIsEditModalOpen(false)} title="Renombrar Lista">
        <form onSubmit={handleUpdateTitle}>
          <div style={{ marginBottom: '24px', marginTop: '16px' }}>
            <Input 
              label="Nuevo Nombre" 
              placeholder="Ej. Compras del mes" 
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button type="button" variant="ghost" fullWidth onClick={() => setIsEditModalOpen(false)} disabled={isSavingTitle}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" fullWidth disabled={!editTitle.trim() || isSavingTitle}>
              {isSavingTitle ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete List Modal */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => !isDeleting && setIsDeleteModalOpen(false)} title="Eliminar Lista">
        <div style={{ marginBottom: '24px', marginTop: '8px' }}>
          <p className="text-body-md" style={{ color: 'var(--color-on-surface-variant)' }}>
            ¿Estás seguro de que deseas eliminar la lista <strong>{listTitle}</strong>? Esta acción no se puede deshacer y borrará todos los ítems.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button type="button" variant="ghost" fullWidth onClick={() => setIsDeleteModalOpen(false)} disabled={isDeleting}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" fullWidth onClick={handleDeleteList} disabled={isDeleting}>
            {isDeleting ? 'Eliminando...' : 'Sí, eliminar'}
          </Button>
        </div>
      </Modal>

      {/* Share List Modal */}
      <Modal isOpen={isShareModalOpen} onClose={() => !isSharing && setIsShareModalOpen(false)} title="Compartir Lista">
        <div style={{ marginBottom: '16px', marginTop: '8px' }}>
          <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            Escribe el correo electrónico de la persona con la que quieres compartir esta lista. 
            <strong> Nota:</strong> Deben haber iniciado sesión en la app previamente.
          </p>
        </div>
        <form onSubmit={handleShareList}>
          <div style={{ marginBottom: '24px' }}>
            <UserEmailAutocomplete 
              value={shareEmail}
              onChange={(val: string) => setShareEmail(val)}
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
    </main>
  );
}


