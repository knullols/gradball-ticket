import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

async function getUserRole(email: string): Promise<'admin' | 'staff'> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .ilike('email', email.trim())
      .maybeSingle(); // won't throw on 0 rows

    if (!error && data?.role === 'admin') return 'admin';
  } catch (_) {
    // ignore, fall through to default
  }
  return 'staff';
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const [sessionChecked, setSessionChecked] = useState(false);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  React.useEffect(() => {
    async function checkExisting() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) {
        const role = await getUserRole(session.user.email);
        setRedirectTo(role === 'admin' ? '/admin' : '/scan');
      }
      setSessionChecked(true);
    }
    checkExisting();
  }, []);

  if (!sessionChecked) return null;
  if (redirectTo) return <Navigate to={redirectTo} />;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: authError, data } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (data?.session?.user?.email) {
      const role = await getUserRole(data.session.user.email);
      navigate(role === 'admin' ? '/admin' : '/scan');
    }
  }

  return (
    <div className="app-shell" style={{ display: 'grid', placeItems: 'center', padding: '20px' }}>
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <div className="panel" style={{ width: '100%', maxWidth: '400px', zIndex: 10 }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ margin: 0, fontSize: '2rem', color: '#fff1cb', textTransform: 'uppercase', letterSpacing: '0.12em' }}>TICKETING APP</h1>
          <p style={{ marginTop: '8px', color: 'rgba(245, 232, 198, 0.7)' }}>Scanner</p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {error && (
            <div className="alert alert-error" style={{ marginBottom: '8px' }}>
              {error}
            </div>
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email Address"
            required
            style={{ width: '100%', padding: '14px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255, 214, 117, 0.2)', color: '#fff', fontSize: '1rem' }}
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            style={{ width: '100%', padding: '14px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255, 214, 117, 0.2)', color: '#fff', fontSize: '1rem' }}
          />

          <button type="submit" className="primary-button" disabled={loading} style={{ marginTop: '8px', height: '50px' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
