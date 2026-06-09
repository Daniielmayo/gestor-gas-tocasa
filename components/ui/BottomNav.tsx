'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ListTodo, CreditCard, Clock } from 'lucide-react';
import styles from './BottomNav.module.css';

export function BottomNav() {
  const pathname = usePathname();

  // Hide on login page
  if (pathname === '/login') return null;

  const navItems = [
    { name: 'Inicio', path: '/', icon: Home },
    { name: 'Listas', path: '/lista/supermercado', icon: ListTodo },
    { name: 'Pagos', path: '/pagos/recurrentes', icon: CreditCard },
    { name: 'Historial', path: '/historial', icon: Clock },
  ];

  return (
    <nav className={styles.bottomNav}>
      <div className={styles.navContainer}>
        {navItems.map((item) => {
          const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
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
