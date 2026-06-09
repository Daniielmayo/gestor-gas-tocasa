import React from 'react';
import styles from './Card.module.css';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({ children, interactive = false, className, ...props }: CardProps) {
  const cardClass = [
    styles.card,
    interactive ? styles.interactive : '',
    className || ''
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass} {...props}>
      {children}
    </div>
  );
}
