'use client';
import React from 'react';
import { useHousehold, GlobalScopeFilter } from '@/context/HouseholdContext';
import { User, Users, Eye, Layers } from 'lucide-react';

export function ScopeFilterBar({ compact = false }: { compact?: boolean }) {
  const { globalScope, setGlobalScope, partner } = useHousehold();

  const options: { id: GlobalScopeFilter; label: string; icon: React.ReactNode }[] = [
    { id: 'mio', label: 'Mío', icon: <User size={14} /> },
    { id: 'conjunto', label: 'Conjunto', icon: <Users size={14} /> },
    { id: 'todo', label: 'Todo', icon: <Layers size={14} /> },
  ];

  if (partner) {
    options.push({
      id: 'pareja',
      label: partner.displayName?.split(' ')[0] || 'Pareja',
      icon: <Eye size={14} />,
    });
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        background: 'var(--color-surface-container)',
        padding: '4px',
        borderRadius: '9999px',
        gap: '4px',
        width: compact ? 'auto' : '100%',
        justifyContent: 'space-between',
      }}
    >
      {options.map((opt) => {
        const active = globalScope === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setGlobalScope(opt.id)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: compact ? '6px 10px' : '8px 12px',
              borderRadius: '9999px',
              fontSize: '13px',
              fontWeight: active ? 600 : 500,
              color: active ? '#FFFFFF' : 'var(--color-on-surface-variant)',
              backgroundColor: active ? 'var(--color-primary)' : 'transparent',
              boxShadow: active ? '0 2px 6px rgba(59, 130, 246, 0.25)' : 'none',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
