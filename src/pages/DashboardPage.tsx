/**
 * DashboardPage.tsx
 * Self-contained staff portal — no external context needed.
 * Drop this anywhere and render <StaffPortal />.
 *
 * Backend: https://anuratyres-backend-emm1774.vercel.app/api
 *   POST /api/staff?action=login          → { token, staff }
 *   GET  /api/jobs?branch=X&date=Y        → Job[]
 *   POST /api/jobs?resource=timer         → { jobId, staffId, action, ...extra }
 *   GET  /api/staff?resource=leave&staffId=X   → Leave[]
 *   GET  /api/staff?resource=leave&branch=X    → Leave[]
 *   POST /api/staff?resource=leave&action=submit  → Leave
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { StaffDamageInspectionPage } from './StaffDamageInspectionPage';
import { useAuth } from '../context/AuthContext';

// ─── Config ──────────────────────────────────────────────────────────────────
const API = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) ||
  'https://anuratyres-backend-emm1774.vercel.app/api'
).replace(/\/api$/, '');

const G = '#FFD700'; // gold

// ─── Types ────────────────────────────────────────────────────────────────────
interface AuthUser { id: string; name: string; role: string; branch: string; username: string; token: string; }

type LeaveType   = 'Annual Leave' | 'Sick Leave' | 'Break Request' | 'Tomorrow Off';
type LeaveStatus = 'Pending' | 'Approved' | 'Denied';
interface Leave { id: string; staffId: string; staffName: string; type: LeaveType; date: string; reason: string; status: LeaveStatus; createdAt: string; }

interface PauseLog   { reason: string; pausedAt: string; resumedAt: string | null; }
interface TimerDoc   { startedAt: string | null; stoppedAt: string | null; pauseLogs: PauseLog[]; }
interface Job {
  _id: string; service: string; vehiclePlate: string; customerName: string;
  customerPhone: string; timeSlot: string; allocatedMins: number;
  status: 'unassigned' | 'assigned' | 'in_progress' | 'paused' | 'done' | 'terminated';
  timer: TimerDoc | null; bookingRef: string; source: string; staffId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const todayStr    = () => new Date().toISOString().split('T')[0];
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; };
const fmtDate     = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime     = (d: string) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';

function computeRemaining(timer: TimerDoc | null, allocMins: number, nowMs: number) {
  if (!timer?.startedAt) return allocMins * 60;
  if (timer.stoppedAt)   return 0;
  const elapsed = Math.floor((nowMs - new Date(timer.startedAt).getTime()) / 1000);
  let paused = 0;
  for (const p of timer.pauseLogs) {
    const end = p.resumedAt ? new Date(p.resumedAt).getTime() : nowMs;
    paused += Math.floor((end - new Date(p.pausedAt).getTime()) / 1000);
  }
  return allocMins * 60 - (elapsed - paused);
}

function fmtCountdown(s: number) {
  const abs = Math.abs(s);
  const m   = String(Math.floor(abs / 60)).padStart(2, '0');
  const sc  = String(abs % 60).padStart(2, '0');
  return `${s < 0 ? '-' : ''}${m}:${sc}`;
}

function minsUntilSlot(slot: string): number | null {
  if (!slot) return null;
  const [h, m] = slot.split(':').map(Number);
  const t = new Date(); t.setHours(h, m, 0, 0);
  return Math.round((t.getTime() - Date.now()) / 60000);
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return now;
}

async function apiFetch(path: string, opts?: RequestInit, token?: string) {
  const res  = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);
  return data;
}

// ─── Storage ──────────────────────────────────────────────────────────────────
const LS_KEY = 'anurat_staff_auth';
function saveAuth(u: AuthUser) { try { localStorage.setItem(LS_KEY, JSON.stringify(u)); } catch {} }
function loadAuth(): AuthUser | null { try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
function clearAuth() { try { localStorage.removeItem(LS_KEY); } catch {} }

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError('Enter your username and password');
    setError(''); setLoading(true);
    try {
      const data: any = await apiFetch('/api/staff?action=login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      const user: AuthUser = {
        id:       String(data.staff?.id || data.staff?._id),
        name:     data.staff?.name     || '',
        role:     data.staff?.role     || '',
        branch:   data.staff?.branch   || '',
        username: data.staff?.username || username.trim().toLowerCase(),
        token:    data.token,
      };
      saveAuth(user);
      onLogin(user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh', background: '#080808',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '20px', fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{
        position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
        width: '600px', height: '300px', borderRadius: '0 0 300px 300px',
        background: 'radial-gradient(ellipse, rgba(255,215,0,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: '380px', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '64px', height: '64px', borderRadius: '20px',
            background: 'linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,215,0,0.05))',
            border: '1px solid rgba(255,215,0,0.2)', marginBottom: '16px',
            boxShadow: '0 0 40px rgba(255,215,0,0.08)',
          }}>
            <span style={{ fontSize: '28px' }}>🔧</span>
          </div>
          <div style={{ color: '#fff', fontSize: '22px', fontWeight: 900, letterSpacing: '-0.02em' }}>Anurat Tyres</div>
          <div style={{ color: '#444', fontSize: '13px', marginTop: '4px', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>Staff Portal</div>
        </div>

        <div style={{
          background: '#111', border: '1px solid #1e1e1e', borderRadius: '24px',
          padding: '32px 28px', boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>
          <div style={{ color: '#fff', fontSize: '17px', fontWeight: 800, marginBottom: '6px' }}>Welcome back</div>
          <div style={{ color: '#444', fontSize: '13px', marginBottom: '28px' }}>Sign in with your staff credentials</div>

          {error && (
            <div style={{
              padding: '12px 14px', marginBottom: '18px',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '12px', color: '#f87171', fontSize: '13px', fontWeight: 600,
            }}>⚠ {error}</div>
          )}

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', color: '#555', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Username</label>
              <input
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="e.g. saman.p" autoCapitalize="none" autoComplete="username"
                style={{
                  width: '100%', padding: '13px 14px', borderRadius: '12px', boxSizing: 'border-box',
                  background: '#0d0d0d', border: '1px solid #2a2a2a', color: '#fff',
                  fontSize: '15px', outline: 'none', transition: 'border-color 0.15s', fontFamily: 'inherit',
                }}
                onFocus={e => (e.target.style.borderColor = G)}
                onBlur={e  => (e.target.style.borderColor = '#2a2a2a')}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#555', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" autoComplete="current-password"
                  style={{
                    width: '100%', padding: '13px 44px 13px 14px', borderRadius: '12px', boxSizing: 'border-box',
                    background: '#0d0d0d', border: '1px solid #2a2a2a', color: '#fff',
                    fontSize: '15px', outline: 'none', transition: 'border-color 0.15s', fontFamily: 'inherit',
                  }}
                  onFocus={e => (e.target.style.borderColor = G)}
                  onBlur={e  => (e.target.style.borderColor = '#2a2a2a')}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} style={{
                  position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#444',
                  fontSize: '16px', lineHeight: 1, padding: '4px',
                }}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} style={{
              marginTop: '8px', width: '100%', padding: '15px',
              borderRadius: '14px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? 'rgba(255,215,0,0.4)' : G,
              color: '#000', fontSize: '15px', fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'all 0.15s', fontFamily: 'inherit',
            }}>
              {loading
                ? <><div style={{ width: '16px', height: '16px', border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Signing in…</>
                : '→ Sign In'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px', color: '#2a2a2a', fontSize: '12px' }}>
          Contact your manager if you've forgotten your credentials
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE / STOP REASONS
// ─────────────────────────────────────────────────────────────────────────────
const PAUSE_REASONS = [
  'Fetching tyres / tools', 'On break', 'Waiting for parts',
  'Customer query', 'Equipment issue', 'Supervisor needed', 'Other',
];
const STOP_REASONS = [
  { label: 'Completed',      icon: '✅', col: '#4ade80', bg: 'rgba(34,197,94,0.12)',  bd: 'rgba(34,197,94,0.4)' },
  { label: 'Terminate',      icon: '⏹', col: '#f87171', bg: 'rgba(239,68,68,0.12)',  bd: 'rgba(239,68,68,0.4)' },
  { label: 'Stock issue',    icon: '📦', col: '#fbbf24', bg: 'rgba(251,191,36,0.10)', bd: 'rgba(251,191,36,0.4)' },
  { label: 'Price disagree', icon: '💬', col: '#60a5fa', bg: 'rgba(96,165,250,0.08)', bd: 'rgba(96,165,250,0.35)' },
];

// ─────────────────────────────────────────────────────────────────────────────
// JOB CARD
// ─────────────────────────────────────────────────────────────────────────────
function JobCard({ job, now, onAction, busy, onRequestStop }: {
  job: Job; now: number;
  onAction: (id: string, action: string, extra?: Record<string, string>) => Promise<void>;
  busy: string | null;
  onRequestStop: (id: string) => void;
}) {
  const [showPause, setShowPause] = useState(false);
  const [showLog,   setShowLog]   = useState(false);

  const isBusy     = busy === job._id;
  const isRunning  = job.status === 'in_progress';
  const isPaused   = job.status === 'paused';
  const isAssigned = job.status === 'assigned';
  const isDone     = job.status === 'done' || job.status === 'terminated';
  const isWorking  = isRunning || isPaused;
  const remaining  = computeRemaining(job.timer, job.allocatedMins, now);
  const isOvertime = isRunning && remaining < 0;
  const minsAway   = isAssigned ? minsUntilSlot(job.timeSlot) : null;
  const alertSoon  = minsAway !== null && minsAway >= 1 && minsAway <= 10;
  const alertNow   = minsAway !== null && minsAway <= 0 && minsAway > -30 && isAssigned;
  const activePause = job.timer?.pauseLogs.find(p => !p.resumedAt);

  const borderCol = isDone ? '#1a1a1a' : isOvertime ? '#7f1d1d' : isPaused ? '#78350f' : isRunning ? '#14532d' : alertNow ? '#7c2d12' : alertSoon ? '#713f12' : '#1e1e1e';
  const bgCol     = isDone ? '#0d0d0d' : isOvertime ? 'rgba(239,68,68,0.04)' : isPaused ? 'rgba(234,179,8,0.04)' : isRunning ? 'rgba(34,197,94,0.04)' : '#111';

  const statusLabel = isDone ? (job.status === 'terminated' ? 'Terminated' : 'Done')
    : isOvertime ? 'Overtime' : isPaused ? 'Paused' : isRunning ? 'In Progress' : 'Assigned';
  const statusColor = isDone ? '#555' : isOvertime ? '#f87171' : isPaused ? '#fbbf24' : isRunning ? '#4ade80' : '#60a5fa';
  const statusBg    = isDone ? 'rgba(255,255,255,0.04)' : isOvertime ? 'rgba(239,68,68,0.12)' : isPaused ? 'rgba(234,179,8,0.12)' : isRunning ? 'rgba(34,197,94,0.12)' : 'rgba(96,165,250,0.12)';

  return (
    <div style={{ background: bgCol, border: `1px solid ${borderCol}`, borderRadius: '20px', marginBottom: '14px', overflow: 'hidden', opacity: isDone ? 0.65 : 1, transition: 'all 0.2s' }}>
      {alertSoon && !alertNow && (
        <div style={{ background: 'rgba(255,215,0,0.08)', borderBottom: '1px solid rgba(255,215,0,0.15)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🔔</span>
          <span style={{ color: G, fontSize: '13px', fontWeight: 700 }}>Starting in {minsAway} min — get ready</span>
        </div>
      )}
      {alertNow && (
        <div style={{ background: 'rgba(249,115,22,0.1)', borderBottom: '1px solid rgba(249,115,22,0.25)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>⚠️</span>
          <span style={{ color: '#fb923c', fontSize: '13px', fontWeight: 700 }}>Job should be starting now!</span>
        </div>
      )}

      <div style={{ padding: '18px 18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: '#fff', fontSize: '17px', fontWeight: 900, lineHeight: 1.25 }}>{job.service}</div>
            {job.bookingRef && <div style={{ color: 'rgba(255,215,0,0.4)', fontSize: '10px', fontFamily: 'monospace', marginTop: '3px' }}>{job.bookingRef}</div>}
          </div>
          <span style={{ padding: '4px 11px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, flexShrink: 0, background: statusBg, color: statusColor, border: `1px solid ${statusColor}30` }}>
            {statusLabel}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#777', fontSize: '13px' }}>
            🚗 <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#ccc' }}>{job.vehiclePlate || '—'}</span>
          </div>
          {job.timeSlot && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#777', fontSize: '13px' }}>🕐 {job.timeSlot}</div>
          )}
          {job.customerName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#777', fontSize: '13px', gridColumn: '1/-1', overflow: 'hidden' }}>
              👤 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#aaa' }}>{job.customerName}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#777', fontSize: '13px' }}>⏱ {job.allocatedMins} min allocated</div>
          {job.timer?.startedAt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#777', fontSize: '13px' }}>🟢 Started {fmtTime(job.timer.startedAt)}</div>
          )}
        </div>

        {isWorking && (
          <div style={{
            borderRadius: '16px', padding: '20px 16px', textAlign: 'center', marginBottom: '16px',
            background: isOvertime ? 'rgba(239,68,68,0.07)' : isPaused ? 'rgba(234,179,8,0.07)' : 'rgba(34,197,94,0.07)',
            border: `1px solid ${isOvertime ? 'rgba(239,68,68,0.2)' : isPaused ? 'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)'}`,
          }}>
            <div style={{ fontSize: '54px', fontWeight: 900, fontFamily: 'monospace', lineHeight: 1, letterSpacing: '-2px', color: isOvertime ? '#f87171' : isPaused ? '#fbbf24' : '#4ade80' }}>
              {fmtCountdown(remaining)}
            </div>
            <div style={{ color: '#555', fontSize: '12px', marginTop: '6px' }}>
              {isOvertime ? '⚠ Overtime running' : isPaused ? '⏸ Paused — timer stopped' : 'remaining'}
            </div>
          </div>
        )}

        {isPaused && activePause && (
          <div style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.18)', borderRadius: '12px', padding: '12px 14px', marginBottom: '16px' }}>
            <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: '13px' }}>⏸ Paused — Reason:</div>
            <div style={{ color: '#92400e', fontSize: '12px', marginTop: '3px' }}>{activePause.reason}</div>
          </div>
        )}

        {isDone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700, color: job.status === 'terminated' ? '#f87171' : '#4ade80' }}>
            {job.status === 'terminated' ? '🛑 Job terminated' : '✅ Job complete'}
            {job.timer?.stoppedAt && <span style={{ color: '#444', fontWeight: 400, fontSize: '12px' }}>at {fmtTime(job.timer.stoppedAt)}</span>}
          </div>
        )}

        {!isDone && !showPause && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {isAssigned && (
              <button disabled={isBusy} onClick={() => onAction(job._id, 'start')} style={{
                width: '100%', padding: '15px', borderRadius: '14px', border: 'none',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                background: isBusy ? 'rgba(34,197,94,0.4)' : '#22c55e',
                color: '#000', fontSize: '15px', fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}>
                {isBusy ? <><Spinner /> Starting…</> : '▶  Start Job'}
              </button>
            )}
            {isRunning && (
              <button disabled={isBusy} onClick={() => setShowPause(true)} style={{
                width: '100%', padding: '13px', borderRadius: '14px',
                border: '1px solid rgba(234,179,8,0.3)', cursor: 'pointer',
                background: 'rgba(234,179,8,0.08)', color: '#fbbf24', fontSize: '15px', fontWeight: 700,
              }}>
                ⏸  Pause
              </button>
            )}
            {isWorking && (
              <button disabled={isBusy} onClick={() => onRequestStop(job._id)} style={{
                width: '100%', padding: '13px', borderRadius: '14px',
                border: '1px solid #2a2a2a', cursor: isBusy ? 'not-allowed' : 'pointer',
                background: '#151515', color: '#f87171', fontSize: '15px', fontWeight: 700,
              }}>
                ⏹  Stop Job
              </button>
            )}
          </div>
        )}

        {showPause && (
          <div>
            <div style={{ color: '#555', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>Why are you pausing?</div>
            {PAUSE_REASONS.map(r => (
              <button key={r} disabled={isBusy} onClick={async () => { setShowPause(false); await onAction(job._id, 'pause', { reason: r }); }} style={{
                width: '100%', padding: '13px 16px', borderRadius: '12px', border: '1px solid #222',
                background: '#181818', color: '#ccc', fontSize: '14px', cursor: 'pointer',
                textAlign: 'left', marginBottom: '7px', display: 'block', fontFamily: 'inherit',
              }}>
                {r}
              </button>
            ))}
            <button onClick={() => setShowPause(false)} style={{ color: '#444', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '8px', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </div>
        )}

        {(job.timer?.pauseLogs?.length ?? 0) > 0 && !showPause && (
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #1a1a1a' }}>
            <button onClick={() => setShowLog(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3a3a3a', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'inherit' }}>
              {showLog ? '▲' : '▼'} {job.timer!.pauseLogs.length} pause{job.timer!.pauseLogs.length !== 1 ? 's' : ''}
            </button>
            {showLog && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {job.timer!.pauseLogs.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: '#181818', borderRadius: '9px', padding: '9px 12px', fontSize: '12px' }}>
                    <span style={{ color: '#666' }}>{p.reason}</span>
                    <span style={{ color: p.resumedAt ? '#4ade80' : '#fbbf24' }}>{p.resumedAt ? '✓' : '⏸'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return <div style={{ width: '14px', height: '14px', border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE BOTTOM SHEET
// ─────────────────────────────────────────────────────────────────────────────
function LeaveSheet({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const [tab,        setTab]        = useState<'request' | 'mine' | 'all'>('request');
  const [type,       setType]       = useState<LeaveType>('Break Request');
  const [date,       setDate]       = useState(todayStr());
  const [reason,     setReason]     = useState('');
  const [submitted,  setSubmitted]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState('');

  const [myLeaves,    setMyLeaves]    = useState<Leave[]>([]);
  const [allLeaves,   setAllLeaves]   = useState<Leave[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [loadingAll,  setLoadingAll]  = useState(false);

  const mapLeave = (d: any): Leave => ({
    id:        String(d.id || d._id),
    staffId:   d.staffId,
    staffName: d.staffName,
    type:      d.type as LeaveType,
    date:      d.date,
    reason:    d.reason || '',
    status:    d.status as LeaveStatus,
    createdAt: d.createdAt,
  });

  const fetchMyLeaves = useCallback(async () => {
    setLoadingMine(true);
    try {
      const data: any[] = await apiFetch(
        `/api/staff?resource=leave&staffId=${encodeURIComponent(user.id)}`,
        undefined, user.token
      );
      setMyLeaves(data.map(mapLeave));
    } catch {}
    finally { setLoadingMine(false); }
  }, [user]);

  const fetchAllLeaves = useCallback(async () => {
    setLoadingAll(true);
    try {
      const data: any[] = await apiFetch(
        `/api/staff?resource=leave&branch=${encodeURIComponent(user.branch)}`,
        undefined, user.token
      );
      setAllLeaves(data.map(mapLeave));
    } catch {}
    finally { setLoadingAll(false); }
  }, [user]);

  useEffect(() => {
    if (tab === 'mine') fetchMyLeaves();
    if (tab === 'all')  fetchAllLeaves();
  }, [tab]);

  const selectType = (t: LeaveType) => {
    setType(t);
    if (t === 'Tomorrow Off')       setDate(tomorrowStr());
    else if (t !== 'Break Request') setDate(todayStr());
  };

  const submit = async () => {
    setSubmitErr(''); setSubmitting(true);
    try {
      await apiFetch('/api/staff?resource=leave&action=submit', {
        method: 'POST',
        body: JSON.stringify({
          staffId:   user.id,
          staffName: user.name,
          branch:    user.branch,
          type,
          date: type === 'Break Request' ? todayStr() : date,
          reason: reason.trim(),
        }),
      }, user.token);
      setReason('');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3500);
    } catch (err: any) {
      setSubmitErr(err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const statusStyle = (s: LeaveStatus) =>
    s === 'Approved'
      ? { background: 'rgba(34,197,94,0.12)',  color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }
      : s === 'Denied'
      ? { background: 'rgba(239,68,68,0.12)',  color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }
      : { background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' };

  const typeIcons: Record<LeaveType, string> = {
    'Break Request': '☕', 'Annual Leave': '📅', 'Sick Leave': '🏥', 'Tomorrow Off': '⚠️',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#111', border: '1px solid #1e1e1e', borderRadius: '24px 24px 0 0',
        padding: '0 0 env(safe-area-inset-bottom, 16px)', width: '100%', maxWidth: '600px',
        maxHeight: '88dvh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Handle */}
        <div style={{ padding: '12px 0 6px', flexShrink: 0 }}>
          <div style={{ width: '36px', height: '4px', background: '#2a2a2a', borderRadius: '2px', margin: '0 auto' }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 20px 0', flexShrink: 0 }}>
          <div style={{ fontSize: '16px', fontWeight: 900, color: '#fff' }}>Leave & Breaks</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', fontSize: '18px', lineHeight: 1 }}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '4px', margin: '16px 20px 0', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '12px', padding: '4px', flexShrink: 0 }}>
          {(['request', 'mine', 'all'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '8px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              fontSize: '12px', fontWeight: 700, transition: 'all 0.15s',
              background: tab === t ? G : 'transparent',
              color:      tab === t ? '#000' : '#555',
              fontFamily: 'inherit',
            }}>
              {t === 'request' ? 'New Request' : t === 'mine' ? 'My History' : 'All Leaves'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* ── REQUEST TAB ── */}
          {tab === 'request' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                {(['Break Request', 'Sick Leave', 'Annual Leave', 'Tomorrow Off'] as LeaveType[]).map(t => (
                  <button key={t} onClick={() => selectType(t)} style={{
                    padding: '14px 12px', borderRadius: '14px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700,
                    background: type === t ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.03)',
                    border:     type === t ? '2px solid rgba(255,215,0,0.4)' : '2px solid #1e1e1e',
                    color:      type === t ? G : '#555',
                    transition: 'all 0.15s', fontFamily: 'inherit',
                  }}>
                    <span style={{ fontSize: '18px' }}>{typeIcons[t]}</span> {t}
                  </button>
                ))}
              </div>

              {type !== 'Break Request' && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', color: '#444', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px' }}>Date</label>
                  <input type="date" value={date} readOnly={type === 'Tomorrow Off'} onChange={e => setDate(e.target.value)} style={{
                    width: '100%', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '12px',
                    color: '#fff', padding: '11px 14px', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
                  }} />
                  {type === 'Tomorrow Off' && <div style={{ color: '#333', fontSize: '11px', marginTop: '4px' }}>Auto-set to {fmtDate(tomorrowStr())}</div>}
                </div>
              )}

              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', color: '#444', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px' }}>
                  Reason <span style={{ color: '#2a2a2a', textTransform: 'none', fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                  placeholder={type === 'Break Request' ? 'e.g. Lunch break…' : type === 'Sick Leave' ? 'e.g. Fever…' : 'e.g. Family event…'}
                  style={{
                    width: '100%', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '12px',
                    color: '#fff', padding: '11px 14px', fontSize: '14px', outline: 'none', resize: 'none',
                    fontFamily: 'inherit', boxSizing: 'border-box',
                  }} />
              </div>

              {submitErr && (
                <div style={{ marginBottom: '12px', padding: '12px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', color: '#f87171', fontSize: '13px', fontWeight: 600 }}>
                  ⚠ {submitErr}
                </div>
              )}

              <button onClick={submit} disabled={submitting} style={{
                width: '100%', padding: '15px', borderRadius: '14px', border: 'none',
                background: submitting ? 'rgba(255,215,0,0.5)' : G,
                color: '#000', fontSize: '15px', fontWeight: 900,
                cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}>
                {submitting
                  ? <><div style={{ width: '16px', height: '16px', border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Submitting…</>
                  : 'Submit Request'}
              </button>

              {submitted && (
                <div style={{ marginTop: '12px', padding: '12px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '12px', color: '#4ade80', fontSize: '13px', fontWeight: 700 }}>
                  ✓ Request submitted — awaiting manager approval
                </div>
              )}
            </div>
          )}

          {/* ── MY HISTORY TAB ── */}
          {tab === 'mine' && (
            loadingMine
              ? <div style={{ textAlign: 'center', padding: '48px 0', color: G }}>Loading…</div>
              : myLeaves.length === 0
              ? <div style={{ textAlign: 'center', padding: '48px 0', color: '#333', fontSize: '14px' }}>No requests yet</div>
              : myLeaves.map(r => (
                <div key={r.id} style={{ background: '#171717', border: '1px solid #1e1e1e', borderRadius: '14px', padding: '13px 15px', marginBottom: '9px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: '#fff', fontSize: '14px', fontWeight: 700 }}>
                      <span style={{ fontSize: '15px' }}>{typeIcons[r.type]}</span> {r.type}
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, ...statusStyle(r.status) }}>{r.status}</span>
                  </div>
                  {r.type !== 'Break Request' && <div style={{ color: '#444', fontSize: '12px' }}>📅 {fmtDate(r.date)}</div>}
                  <div style={{ color: '#333', fontSize: '11px', marginTop: '3px' }}>Submitted {fmtDate(r.createdAt)}</div>
                  {r.reason && <div style={{ color: '#555', fontSize: '12px', marginTop: '7px', fontStyle: 'italic' }}>"{r.reason}"</div>}
                </div>
              ))
          )}

          {/* ── ALL LEAVES TAB ── */}
          {tab === 'all' && (
            loadingAll
              ? <div style={{ textAlign: 'center', padding: '48px 0', color: G }}>Loading…</div>
              : allLeaves.length === 0
              ? <div style={{ textAlign: 'center', padding: '48px 0', color: '#333', fontSize: '14px' }}>No leave records</div>
              : allLeaves.map(r => (
                <div key={r.id} style={{ background: '#171717', border: '1px solid #1e1e1e', borderRadius: '14px', padding: '13px 15px', marginBottom: '9px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: G, fontSize: '10px', fontWeight: 900, flexShrink: 0 }}>
                        {r.staffName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <div style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{r.staffName}</div>
                        <div style={{ color: '#444', fontSize: '11px' }}>{r.type}{r.type !== 'Break Request' ? ` · ${fmtDate(r.date)}` : ''}</div>
                      </div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, flexShrink: 0, ...statusStyle(r.status) }}>{r.status}</span>
                  </div>
                  {r.reason && <div style={{ color: '#444', fontSize: '12px', marginTop: '6px', fontStyle: 'italic' }}>"{r.reason}"</div>}
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STOP MODAL
// ─────────────────────────────────────────────────────────────────────────────
function StopModal({ jobId, onConfirm, onClose }: { jobId: string; onConfirm: (id: string, reason: string) => void; onClose: () => void; }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '24px', padding: '24px', width: '100%', maxWidth: '480px' }}>
        <div style={{ width: '36px', height: '4px', background: '#2a2a2a', borderRadius: '2px', margin: '0 auto 20px' }} />
        <div style={{ color: '#fff', fontSize: '17px', fontWeight: 900, textAlign: 'center', marginBottom: '4px' }}>Stop this job?</div>
        <div style={{ color: '#444', fontSize: '13px', textAlign: 'center', marginBottom: '22px' }}>Choose a reason to continue</div>

        {STOP_REASONS.map(({ label, icon, col, bg, bd }) => {
          const sel = selected === label;
          return (
            <button key={label} onClick={() => setSelected(label)} style={{
              width: '100%', padding: '14px 16px', borderRadius: '14px', cursor: 'pointer',
              fontSize: '14px', fontWeight: 800, marginBottom: '9px', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: '12px',
              background:  sel ? bg  : 'rgba(255,255,255,0.03)',
              border:      sel ? `2px solid ${bd}` : '2px solid #1e1e1e',
              color:       sel ? col : '#555', transition: 'all 0.15s',
            }}>
              <span style={{ width: '18px', height: '18px', borderRadius: '50%', border: sel ? `2px solid ${col}` : '2px solid #2a2a2a', background: sel ? col : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#000', fontWeight: 900, flexShrink: 0, transition: 'all 0.15s' }}>
                {sel ? '✓' : ''}
              </span>
              <span style={{ fontSize: '16px' }}>{icon}</span>
              <span>{label}</span>
            </button>
          );
        })}

        <button disabled={!selected} onClick={() => selected && onConfirm(jobId, selected)} style={{
          width: '100%', padding: '16px', borderRadius: '14px', border: 'none',
          cursor: selected ? 'pointer' : 'not-allowed', marginTop: '4px', marginBottom: '6px', fontFamily: 'inherit',
          background: selected ? '#ef4444' : '#181818',
          color:      selected ? '#fff'    : '#2a2a2a',
          fontSize: '15px', fontWeight: 900, transition: 'all 0.2s',
        }}>
          {selected ? `⏹  Stop — ${selected}` : 'Select a reason above'}
        </button>

        <button onClick={onClose} style={{ color: '#333', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '8px', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLOCK BAR — shift attendance buttons
// ─────────────────────────────────────────────────────────────────────────────
function ClockBar({ user, now }: { user: AuthUser; now: number }) {
  type ClockStatus = 'off' | 'active' | 'on_break';
  const [status,     setStatus]     = useState<ClockStatus | null>(null);
  const [clockInAt,  setClockInAt]  = useState<string | null>(null);
  const [busy,       setBusy]       = useState(false);

  const today = todayStr();

  const fetchStatus = useCallback(async () => {
    try {
      const data: any[] = await apiFetch(
        `/api/staff?branch=${encodeURIComponent(user.branch)}&date=${today}`,
        undefined, user.token
      );
      const me = (Array.isArray(data) ? data : []).find(
        (s: any) => String(s.id || s._id) === String(user.id)
      );
      if (me) {
        setStatus((me.dayStatus?.status as ClockStatus) || 'off');
        setClockInAt(me.dayStatus?.clockInAt || null);
      } else {
        setStatus('off');
      }
    } catch {}
  }, [user, today]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  // Refresh every 30 s in case admin changes it remotely
  useEffect(() => { const id = setInterval(fetchStatus, 30000); return () => clearInterval(id); }, [fetchStatus]);

  const doAction = async (action: 'clock_in' | 'start_break' | 'end_break' | 'clock_out') => {
    setBusy(true);
    try {
      await apiFetch(`/api/staff?resource=status&id=${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, branch: user.branch, date: today }),
      }, user.token);
      await fetchStatus();
    } catch {}
    finally { setBusy(false); }
  };

  // Elapsed shift time
  const shiftSecs = clockInAt && status !== 'off'
    ? Math.floor((now - new Date(clockInAt).getTime()) / 1000)
    : 0;
  const shiftHH = String(Math.floor(shiftSecs / 3600)).padStart(2, '0');
  const shiftMM = String(Math.floor((shiftSecs % 3600) / 60)).padStart(2, '0');

  const statusLabel = status === 'active' ? 'On Shift' : status === 'on_break' ? 'On Break' : 'Not Clocked In';
  const statusDot   = status === 'active' ? '#4ade80' : status === 'on_break' ? '#fbbf24' : '#3a3a3a';

  return (
    <div style={{ background: '#0d0d0d', borderBottom: '1px solid #161616', padding: '12px 16px' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusDot, flexShrink: 0, boxShadow: status === 'active' ? `0 0 6px ${statusDot}` : 'none' }} />
            <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{statusLabel}</span>
          </div>
          {status !== 'off' && clockInAt && (
            <span style={{ color: '#444', fontSize: '12px', fontFamily: 'monospace' }}>
              {shiftHH}:{shiftMM} elapsed
            </span>
          )}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {(status === null || status === 'off') && (
            <button
              disabled={busy || status === null}
              onClick={() => doAction('clock_in')}
              style={{
                flex: 1, padding: '13px', borderRadius: '14px', border: 'none',
                background: busy ? 'rgba(34,197,94,0.4)' : '#22c55e',
                color: '#000', fontSize: '14px', fontWeight: 900,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                fontFamily: 'inherit',
              }}
            >
              {busy ? <><Spinner /> Clocking in…</> : '🟢  Clock In'}
            </button>
          )}

          {status === 'active' && (
            <>
              <button
                disabled={busy}
                onClick={() => doAction('start_break')}
                style={{
                  flex: 1, padding: '13px', borderRadius: '14px',
                  border: '1px solid rgba(234,179,8,0.3)', cursor: busy ? 'not-allowed' : 'pointer',
                  background: 'rgba(234,179,8,0.08)', color: '#fbbf24',
                  fontSize: '14px', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                  fontFamily: 'inherit',
                }}
              >
                {busy ? <Spinner /> : '⏸'}&nbsp; Break
              </button>
              <button
                disabled={busy}
                onClick={() => doAction('clock_out')}
                style={{
                  padding: '13px 16px', borderRadius: '14px',
                  border: '1px solid #1e1e1e', cursor: busy ? 'not-allowed' : 'pointer',
                  background: '#111', color: '#555',
                  fontSize: '13px', fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              >
                Clock Out
              </button>
            </>
          )}

          {status === 'on_break' && (
            <>
              <button
                disabled={busy}
                onClick={() => doAction('end_break')}
                style={{
                  flex: 1, padding: '13px', borderRadius: '14px', border: 'none',
                  background: busy ? 'rgba(34,197,94,0.4)' : '#22c55e',
                  color: '#000', fontSize: '14px', fontWeight: 900,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                  fontFamily: 'inherit',
                }}
              >
                {busy ? <><Spinner /> Resuming…</> : '▶  Resume'}
              </button>
              <button
                disabled={busy}
                onClick={() => doAction('clock_out')}
                style={{
                  padding: '13px 16px', borderRadius: '14px',
                  border: '1px solid #1e1e1e', cursor: busy ? 'not-allowed' : 'pointer',
                  background: '#111', color: '#555',
                  fontSize: '13px', fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              >
                Clock Out
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ user, onLogout, onShowLeaveExternal }: { user: AuthUser; onLogout: () => void; onShowLeaveExternal?: () => void }) {
  const today = todayStr();
  const now   = useNow();

  const [jobs,       setJobs]       = useState<Job[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [stopJobId,  setStopJobId]  = useState<string | null>(null);

  const alertedRef = useRef<Set<string>>(new Set());

  const fetchJobs = useCallback(async () => {
    setError(null);
    try {
      const data: any[] = await apiFetch(
        `/api/jobs?branch=${encodeURIComponent(user.branch)}&date=${today}`,
        undefined, user.token
      );
      const mine = (Array.isArray(data) ? data : []).filter((j: any) => {
        if (j.status === 'unassigned') return false;
        return String(j.staffId) === String(user.id);
      });
      setJobs(mine);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, today]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => { const id = setInterval(fetchJobs, 20000); return () => clearInterval(id); }, [fetchJobs]);

  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== 'assigned' || !job.timeSlot) continue;
      const m   = minsUntilSlot(job.timeSlot);
      if (m === null) continue;
      const key = `${job._id}-10`;
      if (m <= 10 && m >= 9 && !alertedRef.current.has(key)) {
        alertedRef.current.add(key);
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
        if (Notification.permission === 'granted')
          new Notification('Job starting soon', { body: `${job.service} in ~10 min` });
        else if (Notification.permission === 'default')
          Notification.requestPermission();
      }
    }
  }, [jobs, now]);

  const handleAction = useCallback(async (jobId: string, action: string, extra: Record<string, string> = {}) => {
    setActionBusy(jobId);
    try {
      await apiFetch('/api/jobs?resource=timer', {
        method: 'POST',
        body: JSON.stringify({ jobId, staffId: user.id, action, ...extra }),
      }, user.token);
      await fetchJobs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionBusy(null);
    }
  }, [user, fetchJobs]);

  const handleStopConfirm = useCallback(async (jobId: string, reason: string) => {
    setStopJobId(null);
    await handleAction(jobId, 'stop', { stopReason: reason });
  }, [handleAction]);

  const activeJobs = jobs.filter(j => j.status !== 'done' && j.status !== 'terminated');
  const doneJobs   = jobs.filter(j => j.status === 'done' || j.status === 'terminated');
  const hasAlert   = jobs.some(j => { const m = minsUntilSlot(j.timeSlot); return j.status === 'assigned' && m !== null && m <= 10 && m >= 0; });
  const initials   = user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a0a', fontFamily: "'DM Sans', system-ui, sans-serif", color: '#fff' }}>
      {stopJobId && <StopModal jobId={stopJobId} onConfirm={handleStopConfirm} onClose={() => setStopJobId(null)} />}

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(12,12,12,0.95)', borderBottom: '1px solid #1a1a1a', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', height: '62px', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,215,0,0.1)', border: '2px solid rgba(255,215,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: G, fontWeight: 900, fontSize: '13px', letterSpacing: '0.02em' }}>
                {initials}
              </div>
              {hasAlert && <span style={{ position: 'absolute', top: '-2px', right: '-2px', width: '11px', height: '11px', borderRadius: '50%', background: '#f97316', border: '2px solid #0a0a0a', animation: 'pulse 1.5s infinite' }} />}
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '14px', lineHeight: 1.2 }}>{user.name}</div>
              <div style={{ color: '#444', fontSize: '11px' }}>{user.role} · {user.branch}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button onClick={fetchJobs} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #1e1e1e', borderRadius: '10px', cursor: 'pointer', color: '#555', padding: '8px 10px', fontSize: '14px' }}>🔄</button>
            <button onClick={onLogout} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #1e1e1e', borderRadius: '10px', cursor: 'pointer', color: '#444', padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit' }}>Exit</button>
          </div>
        </div>
      </header>

      {/* Date strip */}
      <div style={{ background: '#0d0d0d', borderBottom: '1px solid #161616', padding: '8px 16px', textAlign: 'center' }}>
        <span style={{ color: '#333', fontSize: '12px', letterSpacing: '0.04em' }}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>

      {/* Clock In / Break / Resume bar */}
      <ClockBar user={user} now={now} />

      {/* Stats bar */}
      <div style={{ background: '#0d0d0d', borderBottom: '1px solid #161616', padding: '10px 16px' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', gap: '12px', justifyContent: 'center' }}>
          {[
            { label: 'Total',  value: jobs.length,        col: '#fff' },
            { label: 'Active', value: activeJobs.length,  col: '#4ade80' },
            { label: 'Done',   value: doneJobs.length,    col: '#555' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center', padding: '0 16px' }}>
              <div style={{ fontSize: '20px', fontWeight: 900, color: s.col }}>{s.value}</div>
              <div style={{ fontSize: '10px', color: '#333', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <main style={{ maxWidth: '640px', margin: '0 auto', padding: '20px 14px 60px' }}>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: '14px', padding: '13px 16px', marginBottom: '18px', color: '#f87171', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚠ {error}</span>
            <button onClick={fetchJobs} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', textDecoration: 'underline', fontSize: '12px', fontFamily: 'inherit' }}>Retry</button>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '64px 0', color: G, fontSize: '14px' }}>
            <div style={{ marginBottom: '12px', fontSize: '32px' }}>⚙️</div>Loading your jobs…
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔧</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: '18px', marginBottom: '8px' }}>No jobs assigned yet</div>
            <div style={{ color: '#333', fontSize: '14px', marginBottom: '24px', lineHeight: 1.6 }}>Your supervisor will assign jobs from the admin dashboard.</div>
            <button onClick={fetchJobs} style={{ background: G, border: 'none', borderRadius: '14px', padding: '13px 28px', color: '#000', fontWeight: 900, fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}>Refresh</button>
          </div>
        )}

        {!loading && activeJobs.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ color: '#2a2a2a', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Today's Jobs</span>
              <span style={{ color: '#333', fontSize: '12px' }}>{doneJobs.length} / {jobs.length} done</span>
            </div>
            {activeJobs.map(j => (
              <JobCard key={j._id} job={j} now={now} onAction={handleAction} busy={actionBusy} onRequestStop={id => setStopJobId(id)} />
            ))}
          </div>
        )}

        {!loading && doneJobs.length > 0 && (
          <div>
            <div style={{ color: '#2a2a2a', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
              Completed ({doneJobs.length})
            </div>
            {doneJobs.map(j => (
              <JobCard key={j._id} job={j} now={now} onAction={handleAction} busy={actionBusy} onRequestStop={id => setStopJobId(id)} />
            ))}
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
type Tab = 'jobs' | 'damage' | 'leave';

export default function StaffPortal() {
  const { user: ctxUser, token: ctxToken, logout: ctxLogout } = useAuth();
  const [tab, setTab] = useState<Tab>('jobs');
  const [showLeave, setShowLeave] = useState(false);

  const user: AuthUser | null = ctxUser && ctxToken
    ? { id: ctxUser.id, name: ctxUser.name, role: ctxUser.role, branch: ctxUser.branch, username: ctxUser.username, token: ctxToken }
    : null;

  const handleLogout = () => { clearAuth(); ctxLogout(); setTab('jobs'); };

  if (!user) return <LoginScreen onLogin={(u) => { saveAuth(u); }} />;

  const FONT = "'DM Sans', system-ui, sans-serif";
  const TABS: { key: Tab; icon: string; label: string }[] = [
    { key: 'jobs',   icon: '🔧', label: 'Jobs' },
    { key: 'damage', icon: '🔍', label: 'Inspect' },
    { key: 'leave',  icon: '📋', label: 'Leave' },
  ];

  const handleTabClick = (key: Tab) => {
    if (key === 'leave') { setShowLeave(true); return; }
    setTab(key);
  };

  return (
    <div style={{ paddingBottom: '64px' }}>
      {showLeave && <LeaveSheet user={user} onClose={() => setShowLeave(false)} />}

      {tab === 'damage'
        ? <StaffDamageInspectionPage user={user} onBack={() => setTab('jobs')} />
        : <Dashboard user={user} onLogout={handleLogout} />
      }

      {/* Bottom Tab Navigation */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        background: 'rgba(8,8,8,0.97)', borderTop: '1px solid #1a1a1a',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        display: 'flex', height: '64px',
        fontFamily: FONT,
      }}>
        {TABS.map(t => {
          const isActive = t.key !== 'leave' && tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => handleTabClick(t.key)}
              style={{
                flex: 1, border: 'none', background: 'none', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: '4px', fontFamily: FONT,
                color: isActive ? G : '#3a3a3a',
                position: 'relative', transition: 'color 0.15s',
              }}
            >
              {isActive && (
                <span style={{
                  position: 'absolute', top: 0, left: '20%', right: '20%',
                  height: '2px', background: G, borderRadius: '0 0 2px 2px',
                }} />
              )}
              <span style={{ fontSize: '22px', lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}