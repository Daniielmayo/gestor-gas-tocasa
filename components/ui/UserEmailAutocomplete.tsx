import React, { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Input } from './Input';
import { Avatar } from './Avatar';
import styles from './UserEmailAutocomplete.module.css';

interface UserEmailAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

export function UserEmailAutocomplete({ value, onChange, autoFocus }: UserEmailAutocompleteProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch all users for client-side filtering (suitable for small apps)
    const fetchUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setUsers(data);
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    };
    fetchUsers();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredUsers = users.filter(u => {
    if (!value.trim()) return false;
    const search = value.toLowerCase();
    return (u.email?.toLowerCase().includes(search) || u.displayName?.toLowerCase().includes(search));
  });

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <Input
        label="Correo Electrónico o Nombre"
        placeholder="Escribe para buscar..."
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => setShowDropdown(true)}
        autoFocus={autoFocus}
      />
      {showDropdown && filteredUsers.length > 0 && (
        <ul className={styles.dropdown}>
          {filteredUsers.map(u => (
            <li 
              key={u.id} 
              className={styles.dropdownItem}
              onClick={() => {
                onChange(u.email);
                setShowDropdown(false);
              }}
            >
              <Avatar src={u.photoURL} initials={u.initials || 'US'} size="sm" />
              <div className={styles.userInfo}>
                <span className={styles.userName}>{u.displayName}</span>
                <span className={styles.userEmail}>{u.email}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
