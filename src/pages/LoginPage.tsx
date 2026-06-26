import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff } from 'lucide-react';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return setError('Please enter your username');
    if (!password)        return setError('Please enter your password');
    setLoading(true); setError('');
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #111 50%, #0a0a0a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '20px',
            background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fef104" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
          </div>
          <h1 style={{ color: '#fff', fontSize: '26px', fontWeight: 900, margin: 0, letterSpacing: '-0.5px' }}>
            Staff Portal
          </h1>
          <p style={{ color: '#555', fontSize: '14px', margin: '6px 0 0' }}>
            Anura Tyres (Pvt) Ltd
          </p>
        </div>

        {/* Card  */}
        <div style={{
          background: '#161616', border: '1px solid #242424',
          borderRadius: '20px', padding: '32px', boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}>

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '12px', padding: '12px 16px', marginBottom: '20px',
              color: '#f87171', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <span style={{ fontSize: '16px' }}>⚠</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>

            {/* Username */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. saman.p"
                autoFocus
                autoComplete="username"
                style={{
                  width: '100%', padding: '14px 16px', boxSizing: 'border-box',
                  background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: '12px',
                  color: '#fff', fontSize: '15px', outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(254,241,4,0.5)'}
                onBlur={e => e.target.style.borderColor = '#2a2a2a'}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{
                    width: '100%', padding: '14px 48px 14px 16px', boxSizing: 'border-box',
                    background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: '12px',
                    color: '#fff', fontSize: '15px', outline: 'none',
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(254,241,4,0.5)'}
                  onBlur={e => e.target.style.borderColor = '#2a2a2a'}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} style={{
                  position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: '4px',
                }}>
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '16px', borderRadius: '12px', border: 'none',
              background: loading ? 'rgba(254,241,4,0.6)' : '#fef104',
              color: '#000', fontSize: '15px', fontWeight: 900, cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'background 0.2s',
            }}>
              {loading ? (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeLinecap="round"/>
                  </svg>
                  Signing in…
                </>
              ) : '🔐 Sign In'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', color: '#333', fontSize: '12px', marginTop: '24px' }}>
          Contact your supervisor if you cannot log in
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}