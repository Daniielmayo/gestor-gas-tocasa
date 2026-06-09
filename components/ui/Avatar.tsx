import React from 'react';
import styles from './Avatar.module.css';

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  initials?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar({ src, initials, size = 'md', className, ...props }: AvatarProps) {
  const avatarClass = [
    styles.avatar,
    styles[`size-${size}`],
    className || ''
  ].filter(Boolean).join(' ');

  return (
    <div className={avatarClass} {...props}>
      {src ? (
        <img src={src} alt="Avatar" className={styles.image} />
      ) : (
        <span className={styles.initials}>{initials?.substring(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}
