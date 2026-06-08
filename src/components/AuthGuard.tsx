import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

async function getUserRole(email: string): Promise<'admin' | 'staff'> {
  try {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .ilike('email', email.trim())
      .maybeSingle();
    if (data?.role === 'admin') return 'admin';
  } catch (_) { /* default to staff */ }
  return 'staff';
}

export default function AuthGuard({ children, requireAdmin = false }: { children: React.ReactNode, requireAdmin?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function checkSession() {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);

      if (session?.user?.email) {
        const role = await getUserRole(session.user.email);
        setIsAdmin(role === 'admin');
      }

      // Only mark loading done AFTER both session AND role are resolved
      setLoading(false);
    }

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setSession(null);
        setIsAdmin(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', backgroundColor: '#0a0a0a', color: 'rgba(255,255,255,0.4)', fontFamily: 'sans-serif' }}>
        Loading...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" />;
  }

  // Only redirect away from admin AFTER we're sure they're not admin
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/scan" />;
  }

  return <>{children}</>;
}

