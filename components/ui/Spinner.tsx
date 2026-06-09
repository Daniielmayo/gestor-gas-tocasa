import React from 'react';
import styles from './Spinner.module.css';
import { Wallet } from 'lucide-react';

interface SpinnerProps {
  fullScreen?: boolean;
  message?: string;
}

export function Spinner({ fullScreen = true, message = "Cargando..." }: SpinnerProps) {
  return (
    <div className={`${styles.container} ${fullScreen ? styles.fullScreen : ''}`}>
      <div className={styles.iconWrapper}>
        <Wallet size={40} className={styles.icon} color="var(--color-primary)" />
        <div className={styles.rings}></div>
      </div>
      <p className="text-body-lg" style={{ color: 'var(--color-on-surface-variant)', fontWeight: 500, marginTop: '24px' }}>
        {message}
      </p>
    </div>
  );
}
