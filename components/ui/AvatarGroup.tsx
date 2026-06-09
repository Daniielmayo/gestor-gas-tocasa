import React from 'react';
import { Avatar } from './Avatar';
import styles from './AvatarGroup.module.css';

export interface AvatarGroupProps {
  users: Array<{
    uid: string;
    email: string;
    photoURL?: string;
    initials?: string;
  }>;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
}

export function AvatarGroup({ users, max = 3, size = 'sm' }: AvatarGroupProps) {
  if (!users || users.length === 0) return null;

  const visibleUsers = users.slice(0, max);
  const excess = users.length - max;

  return (
    <div className={styles.avatarGroup}>
      {visibleUsers.map((user, index) => (
        <div key={user.uid || index} className={styles.avatarItem} style={{ zIndex: visibleUsers.length - index }}>
          <Avatar 
            src={user.photoURL} 
            initials={user.initials || user.email.substring(0, 2).toUpperCase()} 
            size={size} 
          />
        </div>
      ))}
      {excess > 0 && (
        <div className={styles.avatarItem} style={{ zIndex: 0 }}>
          <Avatar 
            initials={`+${excess}`} 
            size={size} 
            className={styles.moreAvatar} 
          />
        </div>
      )}
    </div>
  );
}
