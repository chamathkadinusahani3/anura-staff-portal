import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Calendar } from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || 'https://anuratyres-backend-emm1774.vercel.app/api')
  .replace(/\/api$/, '');

const GOLD = '#FFD700';

// ─── Types ────────────────────────────────────────────────────────────────────
type LeaveType = 'Annual Leave' | 'Sick Leave' | 'Break Request' | 'Tomorrow Off';
type LeaveStatus = 'Pending' | 'Approved' | 'Denied';

interface LeaveRequest {
  id: number;
  staffId: number;
  staffName: string;
  type: LeaveType;
  date: string;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
}

interface PauseLog { reason: string; pausedAt: string; resumedAt: string | null; }
interface TimerDoc { startedAt: string | null; stoppedAt: string | null; pauseLogs: PauseLog[]; }
interface Job {
  _id: string;
  service: string;
  vehiclePlate: string;
  customerName: string;
  customerPhone: string;
  timeSlot: string;
  allocatedMins: number;
  status: 'unassigned' | 'assigned' | 'in_progress' | 'paused' | 'done' | 'terminated';
  chainedFromJob: string | null;
  chainedToJob: string | null;
  timer: TimerDoc | null;
  bookingRef: string;
  source: string;
  staffId?: string;
}

// ─── Leave helpers ────────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().split('T')[0]; }
function tomorrowStr() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; }
function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function leaveTypeIcon(type: LeaveType) {
  if (type === 'Break Request') return '☕';
  if (type === 'Sick Leave')    return '🏥';
  if (type === 'Tomorrow Off')  return '⚠️';
  return '📅';
}

function leaveStatusStyle(status: LeaveStatus): React.CSSProperties {
  if (status === 'Approved') return { background: 'rgba(34,197,94,.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,.3)' };
  if (status === 'Denied')   return { background: 'rgba(239,68,68,.15)',  color: '#f87171', border: '1px solid rgba(239,68,68,.3)' };
  return { background: 'rgba(251,191,36,.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.3)' };
}

// ─── Job helpers ──────────────────────────────────────────────────────────────
const PAUSE_REASONS = [
  'Fetching tyres / tools', 'On break', 'Waiting for parts',
  'Customer query', 'Equipment issue', 'Supervisor needed', 'Other',
];

const STOP_REASONS = [
  { label: 'Completed',      icon: '✅', accent: { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.5)',   color: '#4ade80' } },
  { label: 'Terminate',      icon: '⏹', accent: { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.5)',   color: '#f87171' } },
  { label: 'Stock issue',    icon: '📦', accent: { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.45)', color: '#fbbf24' } },
  { label: 'Price disagree', icon: '💬', accent: { bg: 'rgba(96,165,250,0.10)', border: 'rgba(96,165,250,0.4)',  color: '#60a5fa' } },
];

function fmtCountdown(secs: number) {
  const abs = Math.abs(secs);
  const m   = String(Math.floor(abs / 60)).padStart(2, '0');
  const sc  = String(abs % 60).padStart(2, '0');
  return `${secs < 0 ? '-' : ''}${m}:${sc}`;
}

function computeRemaining(timer: TimerDoc | null, allocatedMins: number, nowMs: number) {
  if (!timer?.startedAt) return allocatedMins * 60;
  if (timer.stoppedAt)   return 0;
  const elapsed = Math.floor((nowMs - new Date(timer.startedAt).getTime()) / 1000);
  let paused = 0;
  for (const p of timer.pauseLogs) {
    const end = p.resumedAt ? new Date(p.resumedAt).getTime() : nowMs;
    paused += Math.floor((end - new Date(p.pausedAt).getTime()) / 1000);
  }
  return allocatedMins * 60 - (elapsed - paused);
}

function minsUntilSlot(timeSlot: string): number | null {
  if (!timeSlot) return null;
  const [h, m] = timeSlot.split(':').map(Number);
  const slot = new Date(); slot.setHours(h, m, 0, 0);
  return Math.round((slot.getTime() - Date.now()) / 60000);
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return now;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE / BREAK SHEET
// ─────────────────────────────────────────────────────────────────────────────
function LeaveSheet({ onClose, myLeaves, allLeaves, onSubmit }: {
  onClose: () => void;
  myLeaves: LeaveRequest[];
  allLeaves: LeaveRequest[];
  onSubmit: (req: Omit<LeaveRequest, 'id' | 'createdAt'>) => void;
}) {
  const { user } = useAuth();
  const [tab,        setTab]        = useState<'request' | 'history' | 'all'>('request');
  const [leaveType,  setLeaveType]  = useState<LeaveType>('Break Request');
  const [leaveDate,  setLeaveDate]  = useState(todayStr());
  const [leaveReason,setLeaveReason]= useState('');
  const [submitted,  setSubmitted]  = useState(false);
  const [allFilter,  setAllFilter]  = useState<'all' | 'sick' | 'leave'>('all');

  const selectType = (t: LeaveType) => {
    setLeaveType(t);
    if (t === 'Tomorrow Off') setLeaveDate(tomorrowStr());
    else if (t !== 'Break Request') setLeaveDate(todayStr());
  };

  const submit = () => {
    onSubmit({
      staffId: Number(user?.id ?? 0),
      staffName: user?.name ?? '',
      type: leaveType,
      date: leaveType === 'Break Request' ? todayStr() : leaveDate,
      reason: leaveReason.trim(),
      status: 'Pending',
    });
    setLeaveReason('');
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  const filteredAll = allLeaves.filter(r =>
    allFilter === 'all' ||
    (allFilter === 'sick'  && r.type === 'Sick Leave') ||
    (allFilter === 'leave' && (r.type === 'Annual Leave' || r.type === 'Tomorrow Off'))
  );

  const tabStyle = (k: string): React.CSSProperties => ({
    flex: 1, padding: '7px', borderRadius: 10, border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 700,
    background: tab === k ? GOLD : 'none',
    color: tab === k ? '#000' : '#555',
    transition: 'all .15s',
  });

  const typeBtn = (t: LeaveType): React.CSSProperties => ({
    width: '100%', padding: '13px 14px', borderRadius: 12, cursor: 'pointer',
    fontSize: 14, fontWeight: 700, marginBottom: 8, textAlign: 'left',
    display: 'flex', alignItems: 'center', gap: 10,
    background: leaveType === t ? 'rgba(255,215,0,.08)' : 'rgba(255,255,255,.03)',
    border: leaveType === t ? '2px solid rgba(255,215,0,.5)' : '2px solid #2a2a2a',
    color: leaveType === t ? GOLD : '#666',
    transition: 'all .15s',
  });

  const filterBtn = (f: string): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 8,
    border: `1px solid ${allFilter === f ? GOLD : '#2a2a2a'}`,
    background: 'none',
    color: allFilter === f ? GOLD : '#666',
    fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
  });

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 300,
               display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: '24px 24px 0 0',
                 padding: '24px 20px', width: '100%', maxWidth: 600,
                 maxHeight: '85vh', overflowY: 'auto' }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, background: '#2a2a2a', borderRadius: 2, margin: '0 auto 20px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>My Leave &amp; Breaks</div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, background: '#111', border: '1px solid #1e1e1e',
                      borderRadius: 12, padding: 4, marginBottom: 18 }}>
          <button style={tabStyle('request')} onClick={() => setTab('request')}>Request</button>
          <button style={tabStyle('history')} onClick={() => setTab('history')}>My History</button>
          <button style={tabStyle('all')}     onClick={() => setTab('all')}>All Leaves</button>
        </div>

        {/* ── REQUEST ── */}
        {tab === 'request' && (
          <div>
            {(['Break Request', 'Annual Leave', 'Sick Leave', 'Tomorrow Off'] as LeaveType[]).map(t => (
              <button key={t} style={typeBtn(t)} onClick={() => selectType(t)}>
                <span style={{ fontSize: 16 }}>{leaveTypeIcon(t)}</span> {t}
              </button>
            ))}

            {leaveType !== 'Break Request' && (
              <div style={{ margin: '8px 0 14px' }}>
                <div style={{ color: '#555', fontSize: 11, fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                  Date
                </div>
                <input type="date" value={leaveDate}
                  readOnly={leaveType === 'Tomorrow Off'}
                  onChange={e => setLeaveDate(e.target.value)}
                  style={{ width: '100%', background: '#111', border: '1px solid #2a2a2a',
                           borderRadius: 10, color: '#fff', padding: '8px 12px', fontSize: 13 }} />
                {leaveType === 'Tomorrow Off' && (
                  <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>Auto-set to tomorrow ({fmtDate(tomorrowStr())})</div>
                )}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#555', fontSize: 11, fontWeight: 700,
                            textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                Reason <span style={{ color: '#333', fontWeight: 400, textTransform: 'none' }}>(optional)</span>
              </div>
              <textarea value={leaveReason} onChange={e => setLeaveReason(e.target.value)} rows={2}
                placeholder={
                  leaveType === 'Sick Leave'    ? 'e.g. Fever and cold…' :
                  leaveType === 'Break Request' ? 'e.g. 30 min lunch break…' :
                  leaveType === 'Tomorrow Off'  ? 'e.g. Family commitment…' :
                  'e.g. Annual vacation…'
                }
                style={{ width: '100%', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10,
                         color: '#fff', padding: '8px 12px', fontSize: 13, resize: 'none', fontFamily: 'inherit' }} />
            </div>

            <button onClick={submit}
              style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer',
                       background: GOLD, color: '#000', fontSize: 15, fontWeight: 900 }}>
              Submit Request
            </button>

            {submitted && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(34,197,94,.08)',
                            border: '1px solid rgba(34,197,94,.2)', borderRadius: 10,
                            color: '#4ade80', fontSize: 13, fontWeight: 700 }}>
                ✓ Request submitted — awaiting approval
              </div>
            )}
          </div>
        )}

        {/* ── MY HISTORY ── */}
        {tab === 'history' && (
          <div>
            {myLeaves.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#444', fontSize: 13 }}>No requests yet</div>
            ) : myLeaves.map(r => (
              <div key={r.id} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a',
                                       borderRadius: 14, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: '#fff' }}>
                    <span style={{ fontSize: 15 }}>{leaveTypeIcon(r.type)}</span> {r.type}
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                                 ...leaveStatusStyle(r.status) }}>
                    {r.status}
                  </span>
                </div>
                {r.type !== 'Break Request' && (
                  <div style={{ color: '#555', fontSize: 11 }}>📅 {fmtDate(r.date)}</div>
                )}
                <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>
                  Submitted {fmtDate(r.createdAt)}
                </div>
                {r.reason && (
                  <div style={{ color: '#666', fontSize: 12, marginTop: 5, fontStyle: 'italic' }}>"{r.reason}"</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── ALL LEAVES ── */}
        {tab === 'all' && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['all', 'sick', 'leave'] as const).map(f => (
                <button key={f} onClick={() => setAllFilter(f)} style={filterBtn(f)}>
                  {f === 'all' ? 'All' : f === 'sick' ? 'Sick Leave' : 'Annual / Tomorrow'}
                </button>
              ))}
            </div>
            {filteredAll.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#444', fontSize: 13 }}>No records found</div>
            ) : filteredAll.map(r => (
              <div key={r.id} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a',
                                       borderRadius: 14, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%',
                                  background: 'rgba(255,215,0,.1)', border: '1px solid rgba(255,215,0,.2)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  color: GOLD, fontSize: 10, fontWeight: 700 }}>
                      {r.staffName.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{r.staffName}</div>
                      <div style={{ fontSize: 11, color: '#555' }}>
                        {r.type} {r.type !== 'Break Request' ? `· ${fmtDate(r.date)}` : ''}
                      </div>
                    </div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                                 ...leaveStatusStyle(r.status) }}>
                    {r.status}
                  </span>
                </div>
                {r.reason && (
                  <div style={{ color: '#555', fontSize: 12, marginTop: 8, paddingTop: 8,
                                borderTop: '1px solid #1e1e1e', fontStyle: 'italic' }}>
                    "{r.reason}"
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB CARD
// ─────────────────────────────────────────────────────────────────────────────
function JobCard({ job, now, onAction, busy, onRequestStop }: {
  job: Job; now: number;
  onAction: (id: string, action: string, extra?: Record<string, string>) => Promise<void>;
  busy: string | null;
  onRequestStop: (jobId: string) => void;
}) {
  const [showReasons, setShowReasons] = useState(false);
  const [expanded,    setExpanded]    = useState(false);

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

  const borderColor = isDone ? '#222' : isOvertime ? '#7f1d1d' : isPaused ? '#78350f' : isRunning ? '#14532d' : alertNow ? '#7c2d12' : alertSoon ? '#713f12' : '#222';
  const bgColor     = isDone ? '#111' : isOvertime ? 'rgba(239,68,68,0.04)' : isPaused ? 'rgba(234,179,8,0.04)' : isRunning ? 'rgba(34,197,94,0.04)' : '#161616';

  return (
    <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: '20px', marginBottom: '16px', opacity: isDone ? 0.65 : 1 }}>
      {alertSoon && !alertNow && (
        <div style={{ background: 'rgba(255,215,0,0.1)', borderBottom: '1px solid rgba(255,215,0,0.2)', padding: '10px 16px', borderRadius: '20px 20px 0 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🔔</span>
          <span style={{ color: GOLD, fontSize: '13px', fontWeight: 700 }}>Starting in {minsAway} min — get ready</span>
        </div>
      )}
      {alertNow && (
        <div style={{ background: 'rgba(249,115,22,0.12)', borderBottom: '1px solid rgba(249,115,22,0.3)', padding: '10px 16px', borderRadius: '20px 20px 0 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>⚠️</span>
          <span style={{ color: '#fb923c', fontSize: '13px', fontWeight: 700 }}>This job should be starting now!</span>
        </div>
      )}
      {job.chainedFromJob && (
        <div style={{ background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid rgba(59,130,246,0.15)', padding: '8px 16px' }}>
          <span style={{ color: '#60a5fa', fontSize: '11px', fontWeight: 700 }}>🔗 Continues from previous job</span>
        </div>
      )}

      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: '#fff', fontSize: '18px', fontWeight: 900, lineHeight: 1.2, marginBottom: '4px' }}>{job.service}</div>
            {job.bookingRef && <div style={{ color: 'rgba(255,215,0,0.5)', fontSize: '11px', fontFamily: 'monospace' }}>{job.bookingRef}</div>}
          </div>
          <div style={{
            padding: '5px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, flexShrink: 0,
            background: isDone ? '#1e1e1e' : isOvertime ? 'rgba(239,68,68,0.15)' : isPaused ? 'rgba(234,179,8,0.15)' : isRunning ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
            color: isDone ? '#555' : isOvertime ? '#f87171' : isPaused ? '#fbbf24' : isRunning ? '#4ade80' : '#60a5fa',
            border: `1px solid ${isDone ? '#2a2a2a' : isOvertime ? 'rgba(239,68,68,0.3)' : isPaused ? 'rgba(234,179,8,0.3)' : isRunning ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`,
          }}>
            {isDone ? (job.status === 'terminated' ? 'Terminated' : 'Done') : isOvertime ? 'Overtime' : isPaused ? 'Paused' : isRunning ? 'In Progress' : 'Assigned'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#888', fontSize: '13px' }}>
            <span>🚗</span> <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#ccc' }}>{job.vehiclePlate || '—'}</span>
          </div>
          {job.timeSlot && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#888', fontSize: '13px' }}>
              <span>🕐</span> <span>{job.timeSlot}</span>
            </div>
          )}
          {job.customerName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#888', fontSize: '13px', gridColumn: '1/-1' }}>
              <span>👤</span> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.customerName}</span>
            </div>
          )}
        </div>

        {isWorking && (
          <div style={{
            borderRadius: '16px', padding: '20px', textAlign: 'center', marginBottom: '16px',
            background: isOvertime ? 'rgba(239,68,68,0.08)' : isPaused ? 'rgba(234,179,8,0.08)' : 'rgba(34,197,94,0.08)',
            border: `1px solid ${isOvertime ? 'rgba(239,68,68,0.2)' : isPaused ? 'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)'}`,
          }}>
            <div style={{ fontSize: '52px', fontWeight: 900, fontFamily: 'monospace', lineHeight: 1, color: isOvertime ? '#f87171' : isPaused ? '#fbbf24' : '#4ade80' }}>
              {fmtCountdown(remaining)}
            </div>
            <div style={{ color: '#666', fontSize: '12px', marginTop: '6px' }}>
              {isOvertime ? '⚠ Overtime' : isPaused ? '⏸ Paused — awaiting approval' : 'remaining'}
            </div>
            <div style={{ color: '#444', fontSize: '11px', marginTop: '2px' }}>{job.allocatedMins} min allocated</div>
          </div>
        )}

        {isAssigned && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#555', fontSize: '13px', marginBottom: '16px' }}>
            ⏱ {job.allocatedMins} min allocated
          </div>
        )}

        {isPaused && activePause && (
          <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '12px', padding: '12px 14px', marginBottom: '16px' }}>
            <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: '13px' }}>⏸ Waiting for supervisor approval</div>
            <div style={{ color: '#92400e', fontSize: '12px', marginTop: '3px' }}>Reason: {activePause.reason}</div>
          </div>
        )}

        {isDone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700, color: job.status === 'terminated' ? '#f87171' : '#4ade80' }}>
            {job.status === 'terminated' ? '🛑 Job terminated' : '✅ Job complete'}
          </div>
        )}

        {!isDone && !showReasons && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {isAssigned && (
              <button disabled={isBusy} onClick={() => onAction(job._id, 'start')} style={{
                width: '100%', padding: '16px', borderRadius: '14px', border: 'none', cursor: isBusy ? 'not-allowed' : 'pointer',
                background: isBusy ? 'rgba(34,197,94,0.5)' : '#22c55e', color: '#000', fontSize: '15px', fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}>
                {isBusy ? '⏳ Starting…' : '▶ Start Job'}
              </button>
            )}
            {isRunning && (
              <button disabled={isBusy} onClick={() => setShowReasons(true)} style={{
                width: '100%', padding: '14px', borderRadius: '14px', border: '1px solid rgba(234,179,8,0.3)', cursor: 'pointer',
                background: 'rgba(234,179,8,0.1)', color: '#fbbf24', fontSize: '15px', fontWeight: 700,
              }}>
                ⏸ Pause
              </button>
            )}
            {isWorking && (
              <button disabled={isBusy} onClick={() => onRequestStop(job._id)} style={{
                width: '100%', padding: '14px', borderRadius: '14px', border: '1px solid #2a2a2a',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                background: '#1a1a1a', color: '#f87171', fontSize: '15px', fontWeight: 700,
              }}>
                ⏹ Stop Job
              </button>
            )}
          </div>
        )}

        {showReasons && (
          <div>
            <div style={{ color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
              Why are you pausing?
            </div>
            {PAUSE_REASONS.map(r => (
              <button key={r} disabled={isBusy} onClick={async () => { setShowReasons(false); await onAction(job._id, 'pause', { reason: r }); }} style={{
                width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid #2a2a2a',
                background: '#1e1e1e', color: '#ccc', fontSize: '14px', cursor: 'pointer', textAlign: 'left',
                marginBottom: '8px', display: 'block',
              }}>
                {r}
              </button>
            ))}
            <button onClick={() => setShowReasons(false)} style={{ color: '#444', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '8px' }}>
              Cancel
            </button>
          </div>
        )}

        {(job.timer?.pauseLogs?.length ?? 0) > 0 && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #1e1e1e' }}>
            <button onClick={() => setExpanded(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {expanded ? '▲' : '▼'} {job.timer!.pauseLogs.length} pause{job.timer!.pauseLogs.length > 1 ? 's' : ''} recorded
            </button>
            {expanded && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {job.timer!.pauseLogs.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: '#1e1e1e', borderRadius: '10px', padding: '10px 14px', fontSize: '12px' }}>
                    <span style={{ color: '#888' }}>{p.reason}</span>
                    <span style={{ color: p.resumedAt ? '#4ade80' : '#fbbf24' }}>{p.resumedAt ? '✓ Resumed' : '⏸ Active'}</span>
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

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD PAGE
// ─────────────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { user, logout } = useAuth();
  const today = new Date().toISOString().split('T')[0];

  const [jobs,          setJobs]          = useState<Job[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [stopJobId,     setStopJobId]     = useState<string | null>(null);
  const [stopReason,    setStopReason]    = useState<string | null>(null);

  // ── Leave sheet state ──────────────────────────────────────────────────────
  const [leaveSheetOpen, setLeaveSheetOpen] = useState(false);
  const [myLeaves,       setMyLeaves]       = useState<LeaveRequest[]>([]);
  const [allLeaves,      setAllLeaves]      = useState<LeaveRequest[]>([
    // Demo seed — replace with real API fetch below
    { id: 1, staffId: 0, staffName: 'Nuwan Kumara',  type: 'Annual Leave', date: tomorrowStr(), reason: 'Family event',        status: 'Pending',  createdAt: new Date().toISOString() },
    { id: 2, staffId: 0, staffName: 'Kasun Silva',   type: 'Sick Leave',   date: todayStr(),    reason: 'Doctor appointment',  status: 'Approved', createdAt: new Date().toISOString() },
    { id: 3, staffId: 0, staffName: 'Malith Ranga',  type: 'Sick Leave',   date: todayStr(),    reason: 'Fever',               status: 'Approved', createdAt: new Date().toISOString() },
    { id: 4, staffId: 0, staffName: 'Dilan Perera',  type: 'Annual Leave', date: tomorrowStr(), reason: 'Wedding',             status: 'Pending',  createdAt: new Date().toISOString() },
  ]);

  const now = useNow();
  const alertedRef = useRef<Set<string>>(new Set());

  const handleLeaveSubmit = (req: Omit<LeaveRequest, 'id' | 'createdAt'>) => {
    const newReq: LeaveRequest = { ...req, id: Date.now(), createdAt: new Date().toISOString() };
    setMyLeaves(prev => [newReq, ...prev]);
    setAllLeaves(prev => [newReq, ...prev]);
    // TODO: POST to backend  →  fetch(`${API}/api/leave-requests`, { method:'POST', ... })
  };

  const fetchJobs = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const res  = await fetch(`${API}/api/jobs?branch=${encodeURIComponent(user.branch)}&date=${today}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch jobs');
      const mine = (Array.isArray(data) ? data : []).filter((j: Job) => {
        if (j.status === 'unassigned') return false;
        const jStaffId = j.staffId?.toString() || j.staffId;
        const myId     = user?.id?.toString()  || user?.id;
        return jStaffId && myId && jStaffId === myId;
      });
      setJobs(mine);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, [user, today]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => { const id = setInterval(fetchJobs, 20000); return () => clearInterval(id); }, [fetchJobs]);

  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== 'assigned' || !job.timeSlot) continue;
      const m = minsUntilSlot(job.timeSlot);
      if (m === null) continue;
      const key = `${job._id}-10min`;
      if (m <= 10 && m >= 9 && !alertedRef.current.has(key)) {
        alertedRef.current.add(key);
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
        if (Notification.permission === 'granted') new Notification('Job starting soon', { body: `${job.service} in ~10 min` });
        else if (Notification.permission === 'default') Notification.requestPermission();
      }
    }
  }, [jobs, now]);

  const handleTimerAction = useCallback(async (jobId: string, action: string, extra: Record<string, string> = {}) => {
    if (!user) return;
    setActionLoading(jobId);
    try {
      const res = await fetch(`${API}/api/jobs?resource=timer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, staffId: user.id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      await fetchJobs();
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(null); }
  }, [user, fetchJobs]);

  const handleRequestStop  = useCallback((jobId: string) => { setStopReason(null); setStopJobId(jobId); }, []);
  const handleStopConfirm  = useCallback(async (jobId: string, reason: string) => {
    setStopJobId(null); setStopReason(null);
    await handleTimerAction(jobId, 'stop', { stopReason: reason });
  }, [handleTimerAction]);
  const closeStopModal = useCallback(() => { setStopJobId(null); setStopReason(null); }, []);

  const activeJobs = jobs.filter(j => j.status !== 'done' && j.status !== 'terminated');
  const doneJobs   = jobs.filter(j => j.status === 'done' || j.status === 'terminated');
  const hasAlert   = jobs.some(j => { const m = minsUntilSlot(j.timeSlot); return j.status === 'assigned' && m !== null && m <= 10 && m >= 0; });

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', fontFamily: 'system-ui,-apple-system,sans-serif' }}>

      {/* ── STOP MODAL ─────────────────────────────────────────────────────── */}
      <div
        onClick={closeStopModal}
        style={{
          display: stopJobId ? 'flex' : 'none',
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)',
          zIndex: 500, alignItems: 'flex-end', justifyContent: 'center', padding: '16px',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: '#161616', border: '1px solid #2a2a2a',
            borderRadius: '24px', padding: '24px', width: '100%', maxWidth: '480px',
            marginBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <div style={{ width: '36px', height: '4px', background: '#2a2a2a', borderRadius: '2px', margin: '0 auto 20px' }} />
          <div style={{ color: '#fff', fontSize: '17px', fontWeight: 900, textAlign: 'center', marginBottom: '4px' }}>Stop this job?</div>
          <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', marginBottom: '22px' }}>Select a reason to continue</div>

          {STOP_REASONS.map(({ label, icon, accent }) => {
            const isSelected = stopReason === label;
            return (
              <button key={label} onClick={() => setStopReason(label)} style={{
                width: '100%', padding: '15px 16px', borderRadius: '14px',
                cursor: 'pointer', fontSize: '15px', fontWeight: 800, marginBottom: '10px',
                display: 'flex', alignItems: 'center', gap: '12px',
                background:  isSelected ? accent.bg    : 'rgba(255,255,255,0.03)',
                border:      isSelected ? `2px solid ${accent.border}` : '2px solid #2a2a2a',
                color:       isSelected ? accent.color : '#666',
                transition:  'all 0.15s ease',
              }}>
                <span style={{
                  width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                  border: isSelected ? `2px solid ${accent.color}` : '2px solid #333',
                  background: isSelected ? accent.color : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', color: '#000', fontWeight: 900, transition: 'all 0.15s ease',
                }}>
                  {isSelected ? '✓' : ''}
                </span>
                <span style={{ fontSize: '18px' }}>{icon}</span>
                <span>{label}</span>
              </button>
            );
          })}

          <button
            onClick={() => { if (stopJobId && stopReason) handleStopConfirm(stopJobId, stopReason); }}
            disabled={!stopReason}
            style={{
              width: '100%', padding: '17px', borderRadius: '14px',
              fontSize: '15px', fontWeight: 900, marginTop: '4px', marginBottom: '6px', border: 'none',
              cursor: stopReason ? 'pointer' : 'not-allowed',
              background: stopReason ? '#ef4444' : '#1e1e1e',
              color:      stopReason ? '#fff'    : '#3a3a3a',
              transition: 'all 0.2s ease',
            }}
          >
            {stopReason ? `⏹ Stop Job · ${stopReason}` : 'Select a reason above'}
          </button>

          <button onClick={closeStopModal}
            style={{ color: '#444', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '8px' }}>
            Cancel
          </button>
        </div>
      </div>

      {/* ── LEAVE SHEET ────────────────────────────────────────────────────── */}
      {leaveSheetOpen && (
        <LeaveSheet
          onClose={() => setLeaveSheetOpen(false)}
          myLeaves={myLeaves}
          allLeaves={allLeaves}
          onSubmit={handleLeaveSubmit}
        />
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 100, background: '#111', borderBottom: '1px solid #1e1e1e', padding: '0 20px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: GOLD, fontWeight: 900, fontSize: '13px',
              }}>
                {user?.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              {hasAlert && <span style={{ position: 'absolute', top: '-2px', right: '-2px', width: '12px', height: '12px', borderRadius: '50%', background: '#f97316', border: '2px solid #0a0a0a' }} />}
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '15px', lineHeight: 1.2 }}>{user?.name}</div>
              <div style={{ color: '#555', fontSize: '12px' }}>{user?.role} · 📍 {user?.branch}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* ── MY LEAVE BUTTON ── */}
            <button
              onClick={() => setLeaveSheetOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'rgba(255,255,255,0.05)', border: '1px solid #2a2a2a',
                borderRadius: 10, color: '#aaa', padding: '8px 12px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              📋 My Leave
            </button>
            <button onClick={fetchJobs} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: '8px', borderRadius: '8px' }}>🔄</button>
            <button onClick={logout}    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: '8px', borderRadius: '8px', fontSize: '13px' }}>Sign out</button>
          </div>
        </div>
      </header>

      {/* ── DATE BAR ───────────────────────────────────────────────────────── */}
      <div style={{ background: '#111', borderBottom: '1px solid #1a1a1a', padding: '10px 20px', textAlign: 'center' }}>
        <span style={{ color: '#555', fontSize: '13px' }}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>

      {/* ── CONTENT ────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: '600px', margin: '0 auto', padding: '20px 16px 40px' }}>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '14px', padding: '14px 16px', marginBottom: '20px', color: '#f87171', fontSize: '13px' }}>
            ⚠ {error}
          </div>
        )}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: GOLD, fontSize: '14px' }}>
            ⏳ Loading your jobs…
          </div>
        )}
        {!loading && jobs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔧</div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: '18px', marginBottom: '8px' }}>No jobs assigned yet</div>
            <div style={{ color: '#555', fontSize: '14px', marginBottom: '24px' }}>Your supervisor will assign jobs from the admin dashboard</div>
            <button onClick={fetchJobs} style={{ background: GOLD, border: 'none', borderRadius: '12px', padding: '12px 24px', color: '#000', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>
              Refresh
            </button>
          </div>
        )}
        {!loading && activeJobs.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ color: '#555', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Today's Jobs</span>
              <span style={{ color: '#444', fontSize: '12px' }}>{doneJobs.length}/{jobs.length} done</span>
            </div>
            {activeJobs.map(job => (
              <JobCard key={job._id} job={job} now={now} onAction={handleTimerAction} busy={actionLoading} onRequestStop={handleRequestStop} />
            ))}
          </div>
        )}
        {!loading && doneJobs.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ color: '#444', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
              Completed ({doneJobs.length})
            </div>
            {doneJobs.map(job => (
              <JobCard key={job._id} job={job} now={now} onAction={handleTimerAction} busy={actionLoading} onRequestStop={handleRequestStop} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}