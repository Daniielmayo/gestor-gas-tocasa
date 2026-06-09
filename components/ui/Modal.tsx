import React from 'react';
import styles from './Modal.module.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div 
        className={styles.modal} 
        onClick={(e) => e.stopPropagation()} 
        role="dialog" 
        aria-modal="true"
      >
        <div className={styles.header}>
          <h2 className="text-headline-sm">{title}</h2>
        </div>
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
