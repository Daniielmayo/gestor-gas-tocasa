import React from 'react';
import Link from 'next/link';
import styles from './FAB.module.css';

export interface FABProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  href?: string;
}

export function FAB({ icon, href, className, ...props }: FABProps) {
  const btnClass = [styles.fab, className || ''].filter(Boolean).join(' ');

  if (href) {
    return (
      <Link href={href} className={btnClass}>
        {icon}
      </Link>
    );
  }

  return (
    <button className={btnClass} {...props}>
      {icon}
    </button>
  );
}

