import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

const API = (import.meta.env.VITE_API_URL || 'https://anuratyres-backend-emm1774.vercel.app/api')
  .replace(/\/api$/, '');

const GOLD = '#fef104';

interface PauseLog { reason: string; pausedAt: string; resumedAt: string|null; }
interface Job {
  _id: string; service: string; vehiclePlate: string; customerName: string;
  timeSlot: string; allocatedMins: number; staffId: string|null; staffName: string|null;
  status: string;
  timer: { startedAt: string; pauseLogs: PauseLog[]; }|null;
}

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}
function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}

// ApprovalCard component
function ApprovalCard({ job, onApprove, onDeny, busy }: {
  job: Job; onApprove:(id:string)=>Promise<void>; onDeny:(id:string)=>Promise<void>; busy:string|null;
}) {
  const isBusy = busy === job._id;
  const activePause = job.timer?.pauseLogs.find((p: PauseLog) => !p.resumedAt);
  const pauseCount = job.timer?.pauseLogs.length ?? 0;

  return (
    <div style={{ background:'#161616', border:'1px solid rgba(234,179,8,0.25)', borderRadius:'20px', overflow:'hidden', marginBottom:'16px' }}>
      {/* Banner */}
      <div style={{ background:'rgba(234,179,8,0.08)', borderBottom:'1px solid rgba(234,179,8,0.15)', padding:'12px 18px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ fontSize:'16px' }}>⏸</span>
          <span style={{ color:'#fbbf24', fontSize:'13px', fontWeight:700 }}>{activePause?.reason ?? 'Paused'}</span>
        </div>
        <span style={{ color:'#92400e', fontSize:'11px' }}>{activePause?.pausedAt ? timeAgo(activePause.pausedAt) : ''}</span>
      </div>

      <div style={{ padding:'18px' }}>
        {/* Job info */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'14px' }}>
          <div>
            <div style={{ color:'#fff', fontWeight:700, fontSize:'16px' }}>{job.service}</div>
            {job.staffName && <div style={{ color:'#666', fontSize:'12px', marginTop:'3px' }}>👤 {job.staffName}</div>}
          </div>
          {pauseCount > 1 && (
            <span style={{ background:'rgba(249,115,22,0.15)', border:'1px solid rgba(249,115,22,0.3)', color:'#fb923c', borderRadius:'999px', padding:'4px 10px', fontSize:'11px', fontWeight:700 }}>
              {pauseCount}× paused
            </span>
          )}
        </div>

        {/* Details */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'16px' }}>
          <div style={{ color:'#666', fontSize:'13px' }}>🚗 <span style={{ fontFamily:'monospace', color:'#ccc' }}>{job.vehiclePlate||'—'}</span></div>
          {job.timeSlot && <div style={{ color:'#666', fontSize:'13px' }}>🕐 {job.timeSlot}</div>}
          {job.customerName && <div style={{ color:'#666', fontSize:'13px', gridColumn:'1/-1' }}>👤 {job.customerName}</div>}
        </div>

        {/* Pause history */}
        {pauseCount > 0 && (
          <div style={{ marginBottom:'16px' }}>
            <div style={{ color:'#444', fontSize:'10px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'8px' }}>Pause History</div>
            {job.timer!.pauseLogs.map((p: PauseLog, i: number) => (
              <div key={i} style={{
                display:'flex', justifyContent:'space-between', alignItems:'center',
                background: !p.resumedAt?'rgba(234,179,8,0.06)':'#1e1e1e',
                border: `1px solid ${!p.resumedAt?'rgba(234,179,8,0.15)':'#2a2a2a'}`,
                borderRadius:'10px', padding:'10px 14px', marginBottom:'6px', fontSize:'12px',
              }}>
                <div>
                  <span style={{ color: !p.resumedAt?'#fbbf24':'#888' }}>{p.reason}</span>
                  <span style={{ color:'#444', marginLeft:'8px' }}>{fmtTime(p.pausedAt)}</span>
                </div>
                <span style={{ color: p.resumedAt?'#4ade80':'#fbbf24', fontWeight:700 }}>
                  {p.resumedAt ? `✓ ${fmtTime(p.resumedAt)}` : '⏸ Active'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
          <button disabled={isBusy} onClick={() => onDeny(job._id)} style={{
            padding:'14px', borderRadius:'12px', border:'1px solid #2a2a2a', cursor:isBusy?'not-allowed':'pointer',
            background:'#1a1a1a', color:'#f87171', fontSize:'14px', fontWeight:700,
          }}>
            {isBusy ? '⏳' : '✕'} Deny
          </button>
          <button disabled={isBusy} onClick={() => onApprove(job._id)} style={{
            padding:'14px', borderRadius:'12px', border:'none', cursor:isBusy?'not-allowed':'pointer',
            background:GOLD, color:'#000', fontSize:'14px', fontWeight:900,
          }}>
            {isBusy ? '⏳' : '✓'} Approve
          </button>
        </div>
      </div>
    </div>
  );
}

export function SupervisorPage() {
  const { user, logout } = useAuth();
  const today = new Date().toISOString().split('T')[0];

  const [tab, setTab] = useState<'approvals'|'all'>('approvals');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [actionLoading, setActionLoading] = useState<string|null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [deniedIds, setDeniedIds] = useState<Set<string>>(new Set());

  const fetchJobs = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const res = await fetch(`${API}/api/jobs?branch=${encodeURIComponent(user.branch)}&date=${today}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Failed to fetch');
      setJobs(Array.isArray(data)?data:[]);
    } catch(err:any) { setError(err.message); }
    finally { setLoading(false); }
  }, [user, today]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => { const id = setInterval(fetchJobs,15000); return ()=>clearInterval(id); }, [fetchJobs]);

  const handleApprove = useCallback(async (jobId:string) => {
    if (!user) return;
    setActionLoading(jobId); setError(null);
    try {
      const res = await fetch(`${API}/api/jobs?resource=timer`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ jobId, action:'approve_resume', supervisorId:user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Approval failed');
      setApprovedIds((prev: Set<string>) => new Set([...prev, jobId]));
      await fetchJobs();
    } catch(err:any) { setError(err.message); }
    finally { setActionLoading(null); }
  }, [user, fetchJobs]);

  const handleDeny = useCallback(async (jobId:string) => {
    setActionLoading(jobId); setError(null);
    try {
      const res = await fetch(`${API}/api/jobs?resource=timer`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ jobId, action:'stop' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Deny failed');
      setDeniedIds((prev: Set<string>) => new Set([...prev, jobId]));
      await fetchJobs();
    } catch(err:any) { setError(err.message); }
    finally { setActionLoading(null); }
  }, [fetchJobs]);

  const pendingApprovals = jobs.filter((j: Job) => j.status==='paused' && !approvedIds.has(j._id) && !deniedIds.has(j._id));
  const inProgress = jobs.filter((j: Job)=>j.status==='in_progress').length;
  const paused = jobs.filter((j: Job)=>j.status==='paused').length;
  const done = jobs.filter((j: Job)=>j.status==='done').length;



  return (
    <div style={{ minHeight:'100vh', background:'#0a0a0a', fontFamily:'system-ui,-apple-system,sans-serif' }}>

      {/* Header */}
      <header style={{ position:'sticky', top:0, zIndex:100, background:'#111', borderBottom:'1px solid #1e1e1e', padding:'0 20px' }}>
        <div style={{ maxWidth:'600px', margin:'0 auto', height:'64px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
            <div style={{ position:'relative' }}>
              <div style={{ width:'40px', height:'40px', borderRadius:'50%', background:'rgba(254,241,4,0.1)', border:'1px solid rgba(254,241,4,0.25)', display:'flex', alignItems:'center', justifyContent:'center', color:GOLD, fontWeight:900, fontSize:'13px' }}>
                {user?.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
              </div>
              {pendingApprovals.length > 0 && (
                <span style={{ position:'absolute', top:'-4px', right:'-4px', width:'18px', height:'18px', borderRadius:'50%', background:'#ef4444', border:'2px solid #0a0a0a', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'9px', fontWeight:900, color:'#fff' }}>
                  {pendingApprovals.length}
                </span>
              )}
            </div>
            <div>
              <div style={{ color:'#fff', fontWeight:700, fontSize:'15px', lineHeight:1.2 }}>{user?.name}</div>
              <div style={{ color:GOLD, fontSize:'11px', fontWeight:700 }}>{user?.role==='super_admin'?'Super Admin':'Supervisor'} · {user?.branch}</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={fetchJobs} style={{ background:'none', border:'none', cursor:'pointer', color:'#555', padding:'8px' }}>🔄</button>
            <button onClick={logout} style={{ background:'none', border:'none', cursor:'pointer', color:'#555', padding:'8px', fontSize:'13px' }}>Sign out</button>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div style={{ background:'#111', borderBottom:'1px solid #1a1a1a', padding:'14px 20px' }}>
        <div style={{ maxWidth:'600px', margin:'0 auto' }}>
          <div style={{ color:'#555', fontSize:'12px', marginBottom:'10px' }}>
            {new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})} · {user?.branch}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px' }}>
            {[
              {label:'Total', value:jobs.length, color:'#fff'},
              {label:'Active', value:inProgress, color:'#4ade80'},
              {label:'Paused', value:paused, color:paused>0?'#fbbf24':'#555'},
              {label:'Done', value:done, color:'#555'},
            ].map(s => (
              <div key={s.label} style={{ background:'#1a1a1a', borderRadius:'14px', padding:'12px', textAlign:'center' }}>
                <div style={{ color:s.color, fontSize:'22px', fontWeight:900 }}>{s.value}</div>
                <div style={{ color:'#444', fontSize:'11px', marginTop:'2px' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#111', borderBottom:'1px solid #1a1a1a' }}>
        <div style={{ maxWidth:'600px', margin:'0 auto', display:'flex' }}>
          {(['approvals','all'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex:1, padding:'14px', border:'none', borderBottom: tab===t?`2px solid ${GOLD}`:'2px solid transparent',
              background:'none', color: tab===t?GOLD:'#555', fontWeight:700, fontSize:'14px', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
            }}>
              {t==='approvals' ? '🛡 Approvals' : '🔧 All Jobs'}
              {t==='approvals' && pendingApprovals.length>0 && (
                <span style={{ background:'#ef4444', color:'#fff', borderRadius:'999px', padding:'1px 7px', fontSize:'11px', fontWeight:900 }}>
                  {pendingApprovals.length}
                </span>
              )}
              {t==='all' && <span style={{ color:'#444', fontSize:'12px' }}>{jobs.length}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main style={{ maxWidth:'600px', margin:'0 auto', padding:'20px 16px 40px' }}>

        {error && (
          <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:'14px', padding:'14px', color:'#f87171', fontSize:'13px', marginBottom:'16px' }}>
            ⚠ {error}
          </div>
        )}

        {loading && <div style={{ textAlign:'center', padding:'60px 0', color:GOLD }}>⏳ Loading…</div>}

        {/* Approvals tab */}
        {!loading && tab==='approvals' && (
          pendingApprovals.length === 0 ? (
            <div style={{ textAlign:'center', padding:'60px 20px' }}>
              <div style={{ fontSize:'48px', marginBottom:'16px' }}>✅</div>
              <div style={{ color:'#fff', fontWeight:700, fontSize:'18px', marginBottom:'8px' }}>No pending approvals</div>
              <div style={{ color:'#555', fontSize:'14px' }}>All staff are actively working</div>
            </div>
          ) : (
            <div>
              <div style={{ color:'#666', fontSize:'13px', marginBottom:'16px' }}>
                {pendingApprovals.length} job{pendingApprovals.length>1?'s':''} waiting for approval
              </div>
              {pendingApprovals.map(job => (
                <ApprovalCard key={job._id} job={job} onApprove={handleApprove} onDeny={handleDeny} busy={actionLoading} />
              ))}
            </div>
          )
        )}

        {/* All jobs tab */}
        {!loading && tab==='all' && (
          jobs.filter(j=>j.status!=='unassigned').length === 0 ? (
            <div style={{ textAlign:'center', padding:'60px 20px' }}>
              <div style={{ fontSize:'48px', marginBottom:'16px' }}>🔧</div>
              <div style={{ color:'#555', fontSize:'16px' }}>No jobs today yet</div>
            </div>
          ) : (
            <div>
              {jobs.filter(j=>j.status!=='unassigned').map(job => {
                const isPaused = job.status==='paused';
                const isDone = job.status==='done';
                const isActive = job.status==='in_progress';
                const activePause = job.timer?.pauseLogs.find(p=>!p.resumedAt);
                return (
                  <div key={job._id} style={{
                    background:'#161616',
                    border:`1px solid ${isPaused?'rgba(234,179,8,0.25)':'#222'}`,
                    borderRadius:'16px', padding:'16px', marginBottom:'12px',
                    opacity: isDone?0.6:1,
                  }}>
                    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px' }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ color:'#fff', fontWeight:700, fontSize:'15px' }}>{job.service}</div>
                        <div style={{ display:'flex', gap:'12px', marginTop:'6px', color:'#555', fontSize:'12px' }}>
                          <span style={{ fontFamily:'monospace' }}>{job.vehiclePlate||'—'}</span>
                          {job.timeSlot && <span>🕐 {job.timeSlot}</span>}
                        </div>
                        {job.staffName && <div style={{ color:'#444', fontSize:'11px', marginTop:'4px' }}>👤 {job.staffName}</div>}
                        {isPaused && activePause && (
                          <div style={{ color:'#fbbf24', fontSize:'12px', fontWeight:600, marginTop:'8px' }}>
                            ⏸ {activePause.reason} · {timeAgo(activePause.pausedAt)}
                          </div>
                        )}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'8px', flexShrink:0 }}>
                        <span style={{
                          padding:'4px 10px', borderRadius:'999px', fontSize:'11px', fontWeight:700,
                          background: isPaused?'rgba(234,179,8,0.15)' : isDone?'#1e1e1e' : isActive?'rgba(34,197,94,0.15)':'rgba(59,130,246,0.15)',
                          color: isPaused?'#fbbf24' : isDone?'#444' : isActive?'#4ade80':'#60a5fa',
                          border:`1px solid ${isPaused?'rgba(234,179,8,0.3)':isDone?'#2a2a2a':isActive?'rgba(34,197,94,0.3)':'rgba(59,130,246,0.3)'}`,
                        }}>
                          {isDone?'Done':isPaused?'Paused':isActive?'In Progress':'Assigned'}
                        </span>
                        {isPaused && (
                          <button disabled={actionLoading===job._id} onClick={() => handleApprove(job._id)} style={{
                            background:'rgba(254,241,4,0.1)', border:'1px solid rgba(254,241,4,0.3)', color:GOLD,
                            borderRadius:'10px', padding:'6px 12px', fontSize:'12px', fontWeight:700, cursor:'pointer',
                          }}>
                            {actionLoading===job._id?'⏳':'✓ Approve'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </main>
    </div>
  );
}