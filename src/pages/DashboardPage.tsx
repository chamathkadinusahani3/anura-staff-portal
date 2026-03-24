import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

const API = (import.meta.env.VITE_API_URL || 'https://anuratyres-backend-emm1774.vercel.app/api')
  .replace(/\/api$/, '');

const GOLD = '#FFD700';
const s = (base: React.CSSProperties) => base; // style helper

interface PauseLog { reason: string; pausedAt: string; resumedAt: string | null; }
interface TimerDoc { startedAt: string | null; stoppedAt: string | null; pauseLogs: PauseLog[]; }
interface Job {
  _id: string; service: string; vehiclePlate: string; customerName: string;
  customerPhone: string; timeSlot: string; allocatedMins: number;
  status: 'unassigned'|'assigned'|'in_progress'|'paused'|'done';
  chainedFromJob: string|null; chainedToJob: string|null;
  timer: TimerDoc|null; bookingRef: string; source: string;
}

const PAUSE_REASONS = [
  'Fetching tyres / tools','On break','Waiting for parts',
  'Customer query','Equipment issue','Supervisor needed','Other',
];

function fmtCountdown(secs: number) {
  const abs = Math.abs(secs);
  const m = String(Math.floor(abs/60)).padStart(2,'0');
  const sc = String(abs%60).padStart(2,'0');
  return `${secs<0?'-':''}${m}:${sc}`;
}

function computeRemaining(timer: TimerDoc|null, allocatedMins: number, nowMs: number) {
  if (!timer?.startedAt) return allocatedMins*60;
  if (timer.stoppedAt) return 0;
  const elapsed = Math.floor((nowMs - new Date(timer.startedAt).getTime())/1000);
  let paused = 0;
  for (const p of timer.pauseLogs) {
    const end = p.resumedAt ? new Date(p.resumedAt).getTime() : nowMs;
    paused += Math.floor((end - new Date(p.pausedAt).getTime())/1000);
  }
  return allocatedMins*60 - (elapsed - paused);
}

function minsUntilSlot(timeSlot: string): number|null {
  if (!timeSlot) return null;
  const [h,m] = timeSlot.split(':').map(Number);
  const slot = new Date(); slot.setHours(h,m,0,0);
  return Math.round((slot.getTime() - Date.now())/60000);
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(id); },[]);
  return now;
}

function JobCard({ job, now, onAction, busy }: {
  job: Job; now: number;
  onAction: (id:string, action:string, extra?:Record<string,string>) => Promise<void>;
  busy: string|null;
}) {
  const [showReasons, setShowReasons] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isBusy = busy === job._id;
  const isRunning  = job.status === 'in_progress';
  const isPaused   = job.status === 'paused';
  const isAssigned = job.status === 'assigned';
  const isDone     = job.status === 'done';
  const isWorking  = isRunning || isPaused;
  const remaining  = computeRemaining(job.timer, job.allocatedMins, now);
  const isOvertime = isRunning && remaining < 0;
  const minsAway   = isAssigned ? minsUntilSlot(job.timeSlot) : null;
  const alertSoon  = minsAway !== null && minsAway >= 1 && minsAway <= 10;
  const alertNow   = minsAway !== null && minsAway <= 0 && minsAway > -30 && isAssigned;
  const activePause = job.timer?.pauseLogs.find(p => !p.resumedAt);

  const borderColor = isDone ? '#222' : isOvertime ? '#7f1d1d' : isPaused ? '#78350f' : isRunning ? '#14532d' : alertNow ? '#7c2d12' : alertSoon ? '#713f12' : '#222';
  const bgColor = isDone ? '#111' : isOvertime ? 'rgba(239,68,68,0.04)' : isPaused ? 'rgba(234,179,8,0.04)' : isRunning ? 'rgba(34,197,94,0.04)' : '#161616';

  return (
    <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: '20px', overflow: 'hidden', marginBottom: '16px', opacity: isDone ? 0.65 : 1 }}>

      {/* Alert banners */}
      {alertSoon && !alertNow && (
        <div style={{ background: 'rgba(255,215,0,0.1)', borderBottom: '1px solid rgba(255,215,0,0.2)', padding: '10px 16px', display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ fontSize:'16px' }}>🔔</span>
          <span style={{ color: GOLD, fontSize:'13px', fontWeight:700 }}>Starting in {minsAway} min — get ready</span>
        </div>
      )}
      {alertNow && (
        <div style={{ background: 'rgba(249,115,22,0.12)', borderBottom: '1px solid rgba(249,115,22,0.3)', padding: '10px 16px', display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ fontSize:'16px' }}>⚠️</span>
          <span style={{ color: '#fb923c', fontSize:'13px', fontWeight:700 }}>This job should be starting now!</span>
        </div>
      )}

      {/* Chained */}
      {job.chainedFromJob && (
        <div style={{ background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid rgba(59,130,246,0.15)', padding: '8px 16px' }}>
          <span style={{ color:'#60a5fa', fontSize:'11px', fontWeight:700 }}>🔗 Continues from previous job</span>
        </div>
      )}

      <div style={{ padding: '20px' }}>

        {/* Header row */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', marginBottom:'16px' }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ color:'#fff', fontSize:'18px', fontWeight:900, lineHeight:1.2, marginBottom:'4px' }}>{job.service}</div>
            {job.bookingRef && <div style={{ color:'rgba(255,215,0,0.5)', fontSize:'11px', fontFamily:'monospace' }}>{job.bookingRef}</div>}
          </div>
          <div style={{
            padding: '5px 12px', borderRadius:'999px', fontSize:'11px', fontWeight:800, flexShrink:0,
            background: isDone?'#1e1e1e' : isOvertime?'rgba(239,68,68,0.15)' : isPaused?'rgba(234,179,8,0.15)' : isRunning?'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
            color: isDone?'#555' : isOvertime?'#f87171' : isPaused?'#fbbf24' : isRunning?'#4ade80' : '#60a5fa',
            border: `1px solid ${isDone?'#2a2a2a' : isOvertime?'rgba(239,68,68,0.3)' : isPaused?'rgba(234,179,8,0.3)' : isRunning?'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`,
          }}>
            {isDone?'Done' : isOvertime?'Overtime' : isPaused?'Paused' : isRunning?'In Progress' : 'Assigned'}
          </div>
        </div>

        {/* Details */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'6px', color:'#888', fontSize:'13px' }}>
            <span>🚗</span> <span style={{ fontFamily:'monospace', fontWeight:600, color:'#ccc' }}>{job.vehiclePlate||'—'}</span>
          </div>
          {job.timeSlot && (
            <div style={{ display:'flex', alignItems:'center', gap:'6px', color:'#888', fontSize:'13px' }}>
              <span>🕐</span> <span>{job.timeSlot}</span>
            </div>
          )}
          {job.customerName && (
            <div style={{ display:'flex', alignItems:'center', gap:'6px', color:'#888', fontSize:'13px', gridColumn:'1/-1' }}>
              <span>👤</span> <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{job.customerName}</span>
            </div>
          )}
        </div>

        {/* Countdown */}
        {isWorking && (
          <div style={{
            borderRadius:'16px', padding:'20px', textAlign:'center', marginBottom:'16px',
            background: isOvertime?'rgba(239,68,68,0.08)' : isPaused?'rgba(234,179,8,0.08)' : 'rgba(34,197,94,0.08)',
            border: `1px solid ${isOvertime?'rgba(239,68,68,0.2)' : isPaused?'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)'}`,
          }}>
            <div style={{
              fontSize:'52px', fontWeight:900, fontFamily:'monospace', lineHeight:1,
              color: isOvertime?'#f87171' : isPaused?'#fbbf24' : '#4ade80',
            }}>
              {fmtCountdown(remaining)}
            </div>
            <div style={{ color:'#666', fontSize:'12px', marginTop:'6px' }}>
              {isOvertime?'⚠ Overtime' : isPaused?'⏸ Paused — awaiting approval' : 'remaining'}
            </div>
            <div style={{ color:'#444', fontSize:'11px', marginTop:'2px' }}>{job.allocatedMins} min allocated</div>
          </div>
        )}

        {/* Allocated time when just assigned */}
        {isAssigned && (
          <div style={{ display:'flex', alignItems:'center', gap:'6px', color:'#555', fontSize:'13px', marginBottom:'16px' }}>
            ⏱ {job.allocatedMins} min allocated
          </div>
        )}

        {/* Paused warning */}
        {isPaused && activePause && (
          <div style={{ background:'rgba(234,179,8,0.08)', border:'1px solid rgba(234,179,8,0.2)', borderRadius:'12px', padding:'12px 14px', marginBottom:'16px' }}>
            <div style={{ color:'#fbbf24', fontWeight:700, fontSize:'13px' }}>⏸ Waiting for supervisor approval</div>
            <div style={{ color:'#92400e', fontSize:'12px', marginTop:'3px' }}>Reason: {activePause.reason}</div>
          </div>
        )}

        {/* Done */}
        {isDone && (
          <div style={{ display:'flex', alignItems:'center', gap:'8px', color:'#4ade80', fontSize:'14px', fontWeight:700 }}>
            ✅ Job complete
          </div>
        )}

        {/* Controls */}
        {!isDone && !showReasons && (
          <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            {isAssigned && (
              <button disabled={isBusy} onClick={() => onAction(job._id,'start')} style={{
                width:'100%', padding:'16px', borderRadius:'14px', border:'none', cursor:isBusy?'not-allowed':'pointer',
                background: isBusy?'rgba(34,197,94,0.5)':'#22c55e', color:'#000', fontSize:'15px', fontWeight:900,
                display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
              }}>
                {isBusy ? '⏳ Starting…' : '▶ Start Job'}
              </button>
            )}
            {isRunning && (
              <button disabled={isBusy} onClick={() => setShowReasons(true)} style={{
                width:'100%', padding:'14px', borderRadius:'14px', border:'1px solid rgba(234,179,8,0.3)', cursor:'pointer',
                background:'rgba(234,179,8,0.1)', color:'#fbbf24', fontSize:'15px', fontWeight:700,
              }}>
                ⏸ Pause
              </button>
            )}
            {isWorking && (
              <button disabled={isBusy} onClick={() => onAction(job._id,'stop')} style={{
                width:'100%', padding:'14px', borderRadius:'14px', border:'1px solid #2a2a2a', cursor:'pointer',
                background:'#1a1a1a', color:'#f87171', fontSize:'15px', fontWeight:700,
              }}>
                {isBusy ? '⏳ Stopping…' : '⏹ Stop Job'}
              </button>
            )}
          </div>
        )}

        {/* Pause reasons */}
        {showReasons && (
          <div>
            <div style={{ color:'#888', fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'10px' }}>
              Why are you pausing?
            </div>
            {PAUSE_REASONS.map(r => (
              <button key={r} disabled={isBusy} onClick={async () => { setShowReasons(false); await onAction(job._id,'pause',{reason:r}); }} style={{
                width:'100%', padding:'14px 16px', borderRadius:'12px', border:'1px solid #2a2a2a',
                background:'#1e1e1e', color:'#ccc', fontSize:'14px', cursor:'pointer', textAlign:'left',
                marginBottom:'8px', display:'block',
              }}>
                {r}
              </button>
            ))}
            <button onClick={() => setShowReasons(false)} style={{ color:'#444', fontSize:'13px', background:'none', border:'none', cursor:'pointer', width:'100%', padding:'8px' }}>
              Cancel
            </button>
          </div>
        )}

        {/* Pause history */}
        {(job.timer?.pauseLogs?.length ?? 0) > 0 && (
          <div style={{ marginTop:'16px', paddingTop:'16px', borderTop:'1px solid #1e1e1e' }}>
            <button onClick={() => setExpanded(v=>!v)} style={{ background:'none', border:'none', cursor:'pointer', color:'#444', fontSize:'12px', display:'flex', alignItems:'center', gap:'6px' }}>
              {expanded ? '▲' : '▼'} {job.timer!.pauseLogs.length} pause{job.timer!.pauseLogs.length>1?'s':''} recorded
            </button>
            {expanded && (
              <div style={{ marginTop:'10px', display:'flex', flexDirection:'column', gap:'6px' }}>
                {job.timer!.pauseLogs.map((p,i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', background:'#1e1e1e', borderRadius:'10px', padding:'10px 14px', fontSize:'12px' }}>
                    <span style={{ color:'#888' }}>{p.reason}</span>
                    <span style={{ color: p.resumedAt?'#4ade80':'#fbbf24' }}>{p.resumedAt?'✓ Resumed':'⏸ Active'}</span>
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

export function DashboardPage() {
  const { user, logout } = useAuth();
  const today = new Date().toISOString().split('T')[0];
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [actionLoading, setActionLoading] = useState<string|null>(null);
  const now = useNow();
  const alertedRef = useRef<Set<string>>(new Set());

  const fetchJobs = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const res = await fetch(`${API}/api/jobs?branch=${encodeURIComponent(user.branch)}&date=${today}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Failed to fetch jobs');
      // Only show jobs assigned to this logged-in staff member
      const mine = (Array.isArray(data)?data:[]).filter((j:Job) => {
        if (j.status === 'unassigned') return false;
        // Match by staffId — MongoDB returns it as object with $oid or as string
        const jStaffId = j.staffId?.toString() || j.staffId;
        const myId     = user?.id?.toString()  || user?.id;
        return jStaffId && myId && jStaffId === myId;
      });
      setJobs(mine);
    } catch(err:any) { setError(err.message); }
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
        if ('vibrate' in navigator) navigator.vibrate([200,100,200]);
        if (Notification.permission === 'granted') new Notification('Job starting soon', { body: `${job.service} in ~10 min` });
        else if (Notification.permission === 'default') Notification.requestPermission();
      }
    }
  }, [jobs, now]);

  const handleTimerAction = useCallback(async (jobId:string, action:string, extra:Record<string,string>={}) => {
    if (!user) return;
    setActionLoading(jobId);
    try {
      const res = await fetch(`${API}/api/jobs?resource=timer`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ jobId, staffId: user.id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Action failed');
      await fetchJobs();
    } catch(err:any) { setError(err.message); }
    finally { setActionLoading(null); }
  }, [user, fetchJobs]);

  const activeJobs = jobs.filter(j => j.status !== 'done');
  const doneJobs   = jobs.filter(j => j.status === 'done');
  const hasAlert   = jobs.some(j => { const m = minsUntilSlot(j.timeSlot); return j.status==='assigned'&&m!==null&&m<=10&&m>=0; });

  return (
    <div style={{ minHeight:'100vh', background:'#0a0a0a', fontFamily:'system-ui,-apple-system,sans-serif' }}>

      {/* Header */}
      <header style={{ position:'sticky', top:0, zIndex:100, background:'#111', borderBottom:'1px solid #1e1e1e', padding:'0 20px' }}>
        <div style={{ maxWidth:'600px', margin:'0 auto', height:'64px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
            <div style={{ position:'relative' }}>
              <div style={{
                width:'40px', height:'40px', borderRadius:'50%',
                background:'rgba(255,215,0,0.1)', border:'1px solid rgba(255,215,0,0.25)',
                display:'flex', alignItems:'center', justifyContent:'center',
                color:GOLD, fontWeight:900, fontSize:'13px',
              }}>
                {user?.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
              </div>
              {hasAlert && <span style={{ position:'absolute', top:'-2px', right:'-2px', width:'12px', height:'12px', borderRadius:'50%', background:'#f97316', border:'2px solid #0a0a0a' }} />}
            </div>
            <div>
              <div style={{ color:'#fff', fontWeight:700, fontSize:'15px', lineHeight:1.2 }}>{user?.name}</div>
              <div style={{ color:'#555', fontSize:'12px' }}>{user?.role} · 📍 {user?.branch}</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <button onClick={fetchJobs} style={{ background:'none', border:'none', cursor:'pointer', color:'#555', padding:'8px', borderRadius:'8px' }}>
              🔄
            </button>
            <button onClick={logout} style={{ background:'none', border:'none', cursor:'pointer', color:'#555', padding:'8px', borderRadius:'8px', fontSize:'13px' }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Date bar */}
      <div style={{ background:'#111', borderBottom:'1px solid #1a1a1a', padding:'10px 20px', textAlign:'center' }}>
        <span style={{ color:'#555', fontSize:'13px' }}>
          {new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
        </span>
      </div>

      {/* Content */}
      <main style={{ maxWidth:'600px', margin:'0 auto', padding:'20px 16px 40px' }}>

        {error && (
          <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:'14px', padding:'14px 16px', marginBottom:'20px', color:'#f87171', fontSize:'13px' }}>
            ⚠ {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign:'center', padding:'60px 0', color:GOLD, fontSize:'14px' }}>
            ⏳ Loading your jobs…
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:'48px', marginBottom:'16px' }}>🔧</div>
            <div style={{ color:'#fff', fontWeight:700, fontSize:'18px', marginBottom:'8px' }}>No jobs assigned yet</div>
            <div style={{ color:'#555', fontSize:'14px', marginBottom:'24px' }}>Your supervisor will assign jobs from the admin dashboard</div>
            <button onClick={fetchJobs} style={{ background:GOLD, border:'none', borderRadius:'12px', padding:'12px 24px', color:'#000', fontWeight:700, fontSize:'14px', cursor:'pointer' }}>
              Refresh
            </button>
          </div>
        )}

        {/* Active jobs */}
        {!loading && activeJobs.length > 0 && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
              <span style={{ color:'#555', fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em' }}>Today's Jobs</span>
              <span style={{ color:'#444', fontSize:'12px' }}>{doneJobs.length}/{jobs.length} done</span>
            </div>
            {activeJobs.map(job => (
              <JobCard key={job._id} job={job} now={now} onAction={handleTimerAction} busy={actionLoading} />
            ))}
          </div>
        )}

        {/* Completed */}
        {!loading && doneJobs.length > 0 && (
          <div style={{ marginTop:'8px' }}>
            <div style={{ color:'#444', fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'12px' }}>
              Completed ({doneJobs.length})
            </div>
            {doneJobs.map(job => (
              <JobCard key={job._id} job={job} now={now} onAction={handleTimerAction} busy={actionLoading} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}