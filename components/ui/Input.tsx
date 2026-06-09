import React from 'react';
import styles from './Input.module.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className={[styles.container, className || ''].filter(Boolean).join(' ')}>
        {label && <label className={styles.label}>{label}</label>}
        <input
          ref={ref}
          className={[styles.input, error ? styles.inputError : ''].filter(Boolean).join(' ')}
          {...props}
        />
        {error && <span className={styles.errorText}>{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
