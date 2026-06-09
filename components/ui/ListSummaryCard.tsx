import React, { useEffect, useState } from 'react';
import { Card } from './Card';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ChevronRight } from 'lucide-react';
import { AvatarGroup } from './AvatarGroup';
import { useUsersMap } from '@/lib/hooks/useUsersMap';

interface ListSummaryCardProps {
  list: { id: string; title: string; sharedWith?: string[]; ownerId?: string };
  styles: any;
}

export function ListSummaryCard({ list, styles }: ListSummaryCardProps) {
  const { usersMap } = useUsersMap();
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'listItems'), where('listId', '==', list.id));
    const unsub = onSnapshot(q, (snap) => {
      let tot = 0;
      let comp = 0;
      snap.forEach(doc => {
        tot++;
        if (doc.data().completed) comp++;
      });
      setTotal(tot);
      setCompleted(comp);
      setLoading(false);
    });
    return () => unsub();
  }, [list.id]);

  const progress = total === 0 ? 0 : (completed / total) * 100;

  return (
    <Card interactive className={styles.listItem} style={{ alignItems: 'center' }}>
      <div className={styles.listInfo} style={{ flex: 1 }}>
        <h4 className="text-body-lg" style={{ fontWeight: 600 }}>{list.title}</h4>
        
        {loading ? (
          <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>Cargando...</p>
        ) : total === 0 ? (
          <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>Lista vacía</p>
        ) : (
          <div style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                {completed} de {total} completados
              </span>
              <span className="text-label-sm" style={{ color: 'var(--color-primary)' }}>
                {Math.round(progress)}%
              </span>
            </div>
            <div style={{ width: '100%', height: '6px', background: 'var(--color-surface-container-highest)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}
      </div>
      <div className={styles.listAvatars} style={{ marginLeft: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {(list.sharedWith && list.sharedWith.length > 0) && (
          <AvatarGroup 
            users={[
              (list.ownerId ? usersMap[list.ownerId] : null),
              ...list.sharedWith.map((uid: string) => usersMap[uid])
            ].filter(Boolean) as any} 
            size="sm" 
          />
        )}
        <ChevronRight size={20} color="var(--color-outline)" />
      </div>
    </Card>
  );
}
