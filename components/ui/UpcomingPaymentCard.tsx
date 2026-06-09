import React from 'react';
import { Card } from './Card';
import { Button } from './Button';
import { AlertCircle, Clock } from 'lucide-react';
import { AvatarGroup } from './AvatarGroup';
import { useUsersMap } from '@/lib/hooks/useUsersMap';

interface UpcomingPaymentCardProps {
  payment: any;
}

export function UpcomingPaymentCard({ payment }: UpcomingPaymentCardProps) {
  const { usersMap } = useUsersMap();
  const isUrgent = payment.daysUntil <= 3;
  
  return (
    <Card style={{ 
      minWidth: '280px', 
      maxWidth: '280px', 
      flexShrink: 0, 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '16px',
      border: '1px solid var(--color-outline-variant)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      scrollSnapAlign: 'start'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          padding: '4px 8px',
          borderRadius: '4px',
          backgroundColor: isUrgent ? '#FEE2E2' : '#F3F4F6',
          color: isUrgent ? '#B91C1C' : '#4B5563',
          fontSize: '12px',
          fontWeight: 600
        }}>
          {isUrgent ? <AlertCircle size={14} /> : <Clock size={14} />}
          <span>
            {payment.daysUntil === 0 
              ? 'Vence hoy' 
              : payment.daysUntil === 1 
                ? 'Vence mañana' 
                : `Vence en ${payment.daysUntil} días`}
          </span>
        </div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
          ${payment.amount}
        </div>
      </div>
      
      <div>
        <h4 className="text-body-lg" style={{ fontWeight: 600, color: 'var(--color-on-surface)' }}>{payment.title}</h4>
        <p className="text-body-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
          {payment.sharedWith && payment.sharedWith.length > 0 
            ? `Compartido con ${payment.sharedWith.length + 1} personas` 
            : 'Solo tú'}
        </p>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
        <div style={{ display: 'flex', marginLeft: '8px' }}>
          <AvatarGroup 
            users={[
              { uid: payment.ownerId, email: 'tú', initials: 'TÚ' },
              ...(payment.sharedWith || []).map((uid: string) => usersMap[uid]).filter(Boolean)
            ]} 
            size="sm" 
          />
        </div>
        
        <Button variant="primary" size="sm" style={{ padding: '8px 16px', borderRadius: '24px' }}>
          Pagar ahora
        </Button>
      </div>
    </Card>
  );
}
