'use client';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import styles from './login.module.css';
import { Wallet } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { auth, googleProvider } from '@/lib/firebase';
import { signInWithPopup } from 'firebase/auth';

export default function Login() {
  const { user, profile, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && profile) {
      router.push('/');
    }
  }, [user, profile, loading, router]);

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      // Tras el popup, onAuthStateChanged en AuthContext detectará el usuario
      // y el useEffect de arriba nos redirigirá a '/'
    } catch (error: any) {
      console.error("Error signing in with Google:", error);
      alert(`Error al iniciar sesión: ${error.message || error}`);
    }
  };

  if (loading) {
    return (
      <main className={`container ${styles.main}`}>
        <Spinner message="Verificando sesión..." />
      </main>
    );
  }

  return (
    <main className={`container ${styles.main}`}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <Wallet size={48} color="var(--color-primary)" />
        </div>
        <h1 className="text-display-lg">Gestión de Gastos</h1>
        <p className={`text-body-md ${styles.subtitle}`}>
          Coordinación eficiente y transparente para el hogar
        </p>
      </div>

      <Card className={styles.loginCard}>
        {user && profile ? (
          <div className={styles.profileView} style={{ textAlign: 'center' }}>
            <h2 className={`text-headline-sm ${styles.cardTitle}`}>Tu Perfil</h2>
            <Avatar 
              src={profile.photoURL || undefined} 
              initials={profile.initials || 'US'} 
              size="lg" 
              style={{ margin: '0 auto 16px' }}
            />
            <p className="text-body-lg" style={{ fontWeight: 600 }}>{profile.displayName}</p>
            <p className="text-label-sm" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '24px' }}>
              {profile.email}
            </p>
            
            <Button variant="danger" fullWidth onClick={logout}>
              Cerrar Sesión
            </Button>
            <Button variant="ghost" fullWidth style={{ marginTop: '8px' }} onClick={() => router.push('/')}>
              Ir al Dashboard
            </Button>
          </div>
        ) : (
          <div className={styles.loginView}>
            <h2 className={`text-headline-sm ${styles.cardTitle}`}>
              Iniciar Sesión
            </h2>
            
            <Button variant="primary" fullWidth size="lg" onClick={handleGoogleLogin} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', backgroundColor: '#FFFFFF', color: '#757575', border: '1px solid #DFE1E5', boxShadow: '0 1px 2px 0 rgba(60,64,67,0.30), 0 1px 3px 1px rgba(60,64,67,0.15)' }}>
              <Image src="/google-icon-logo-svgrepo-com.svg" alt="Google" width={24} height={24} />
              <span style={{ fontWeight: 500, fontFamily: 'Roboto, sans-serif' }}>Continuar con Google</span>
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}


