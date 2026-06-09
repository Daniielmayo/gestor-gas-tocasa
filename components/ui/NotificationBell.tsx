import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, Timestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import styles from './NotificationBell.module.css';

interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  link: string;
  read: boolean;
  createdAt: any;
}

export function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      where('read', '==', false)
    );

    const unsub = onSnapshot(q, (snap) => {
      const data: Notification[] = [];
      snap.forEach(doc => data.push({ id: doc.id, ...doc.data() } as Notification));
      data.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
        return timeB - timeA;
      });
      setNotifications(data);
    });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNotificationClick = async (notif: Notification) => {
    try {
      await updateDoc(doc(db, 'notifications', notif.id), { read: true });
    } catch (error) {
      console.error("Error updating notification:", error);
    }
    setIsOpen(false);
    if (notif.link) {
      router.push(notif.link);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const promises = notifications.map(notif => 
        updateDoc(doc(db, 'notifications', notif.id), { read: true })
      );
      await Promise.all(promises);
      setIsOpen(false);
    } catch (error) {
      console.error("Error marking all as read:", error);
    }
  };

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button 
        className={styles.bellButton} 
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notificaciones"
      >
        <Bell size={24} color="var(--color-on-surface)" />
        {notifications.length > 0 && (
          <span className={styles.badge}>{notifications.length}</span>
        )}
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <h4 className="text-label-lg">Notificaciones</h4>
            {notifications.length > 0 && (
              <button className={styles.markAllRead} onClick={handleMarkAllRead}>
                <Check size={16} /> Marcar leídas
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className={styles.emptyState}>
              <p className="text-body-sm">No tienes notificaciones nuevas.</p>
            </div>
          ) : (
            <ul className={styles.list}>
              {notifications.map(notif => (
                <li key={notif.id} className={styles.item} onClick={() => handleNotificationClick(notif)}>
                  <div className={styles.itemContent}>
                    <span className={styles.itemTitle}>{notif.title}</span>
                    <span className={styles.itemMessage}>{notif.message}</span>
                    {notif.createdAt && (
                      <span className={styles.itemTime}>
                        {new Date(notif.createdAt.toDate()).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
