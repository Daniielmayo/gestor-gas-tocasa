import React from 'react';
import styles from './Checkbox.module.css';
import { Check } from 'lucide-react';

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label className={[styles.container, className || ''].filter(Boolean).join(' ')}>
      <div className={styles.checkboxWrapper}>
        <input type="checkbox" className={styles.input} {...props} />
        <div className={styles.checkbox}>
          <Check className={styles.icon} size={14} strokeWidth={3} />
        </div>
      </div>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  );
}
