'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ListTodo, CreditCard, Wallet } from 'lucide-react';
import styles from './BottomNav.module.css';

export function BottomNav() {
  const pathname = usePathname();

  // Hide on login page
  if (pathname === '/login') return null;

  const navItems = [
    { name: 'Inicio', path: '/', icon: Home },
    { name: 'Listas', path: '/listas', icon: ListTodo },
    { name: 'Pagos', path: '/pagos/recurrentes', icon: CreditCard },
    { name: 'Finanzas', path: '/finanzas', icon: Wallet },
  ];

  return (
    <nav className={styles.bottomNav}>
      <div className={styles.navContainer}>
        {navItems.map((item) => {
          let isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
          
          // Special case for Listas to remain active when inside an individual list
          if (item.name === 'Listas' && pathname.startsWith('/lista/')) {
            isActive = true;
          }
          
          const Icon = item.icon;
          
          return (
            <Link 
              key={item.name} 
              href={item.path}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <div className={styles.iconWrapper}>
                <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className={styles.navLabel}>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
