'use client';
import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import styles from './SpeedDial.module.css';

export interface SpeedDialAction {
  name: string;
  icon: React.ReactNode;
  onClick: () => void;
  color?: string;
}

export interface SpeedDialProps {
  actions: SpeedDialAction[];
}

export function SpeedDial({ actions }: SpeedDialProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div 
        className={`${styles.overlay} ${isOpen ? styles.overlayOpen : ''}`} 
        onClick={() => setIsOpen(false)}
      />

      <div className={styles.container}>
        <div className={`${styles.actions} ${isOpen ? styles.actionsOpen : ''}`}>
          {actions.map((action, index) => (
            <div key={action.name} className={styles.actionItemWrapper} style={{ transitionDelay: `${(actions.length - index) * 50}ms` }}>
              <div className={styles.actionLabel}>
                {action.name}
              </div>
              <button 
                className={styles.actionBtn} 
                style={{ backgroundColor: action.color || 'var(--color-primary)' }}
                onClick={() => {
                  setIsOpen(false);
                  action.onClick();
                }}
              >
                {action.icon}
              </button>
            </div>
          ))}
        </div>

        <button 
          className={`${styles.fab} ${isOpen ? styles.fabOpen : ''}`}
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={24} /> : <Plus size={24} />}
        </button>
      </div>
    </>
  );
}
