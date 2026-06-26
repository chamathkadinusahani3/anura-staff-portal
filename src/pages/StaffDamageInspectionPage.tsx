/**
 * StaffDamageInspectionPage.tsx
 * Full damage inspection & customer approval module for the staff portal.
 * Inline styles — matches portal dark theme (#0a0a0a / #fef104).
 *
 * API:
 *   GET  /api/jobs?branch=X&date=Y              → Job[]
 *   GET  /api/crm?resource=inspections&jobId=X  → Inspection | null
 *   POST /api/crm?resource=inspections          → create inspection
 *   PATCH /api/crm?resource=inspections&id=X   → save all fields
 */

import { useState, useEffect, useRef, useCallback, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

const API = 'https://anuratyres-backend-emm1774.vercel.app/api';
const G   = '#fef104';

// ─── Error Boundary ───────────────────────────────────────────────────────────
class InspectionErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[InspectionPage] render error', error, info);
  }
  render() {
    if (this.state.error) {
      const msg = (this.state.error as Error).message;
      return (
        <div style={{ minHeight: '100dvh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ textAlign: 'center', maxWidth: '340px' }}>
            <div style={{ fontSize: '36px', marginBottom: '14px' }}>⚠️</div>
            <div style={{ color: '#ef4444', fontWeight: 800, fontSize: '15px', marginBottom: '8px' }}>Something went wrong</div>
            <div style={{ color: '#555', fontSize: '12px', marginBottom: '24px', fontFamily: 'monospace', background: '#111', borderRadius: '10px', padding: '10px', textAlign: 'left', wordBreak: 'break-all' }}>{msg}</div>
            <button onClick={() => { this.setState({ error: null }); this.props.onReset(); }}
              style={{ background: G, color: '#000', border: 'none', borderRadius: '12px', padding: '12px 28px', fontWeight: 900, cursor: 'pointer' }}>
              Back to Job List
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface AuthUser { id: string; name: string; role: string; branch: string; token: string; }

type Severity       = 'Low' | 'Medium' | 'High' | 'Critical';
type ApprovalStatus = 'not_sent' | 'sent' | 'viewed' | 'approved' | 'rejected';

interface DamageReport {
  id: string; title: string; category: string; severity: Severity;
  description: string; recommendedRepair: string; additionalCost: number;
  createdAt: string; createdBy: string;
}
interface MediaFile {
  id: string; type: 'image' | 'video'; url: string; name: string;
  size: number; duration?: number; uploadedAt: string; uploadedBy: string;
}
interface QuotationItem {
  id: string; item: string; qty: number; unitPrice: number; labourCost: number;
}
interface TimelineEvent {
  id: string; label: string; user: string; timestamp: string;
  status: 'done' | 'active' | 'pending'; color: string;
}
interface AuditEntry {
  id: string; user: string; action: string; date: string; time: string;
}
interface JobSummary {
  jobNumber: string; customerName: string; vehicleReg: string;
  vehicleMake: string; vehicleModel: string; currentService: string;
  originalCost: number; status: string; technician: string; branch: string; createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid()          { return Math.random().toString(36).slice(2, 10); }
function fmtCur(n: number) { return `Rs. ${(n || 0).toLocaleString()}`; }
function fmtDT(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtDateStr(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTimeStr(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function todayStr() { return new Date().toISOString().split('T')[0]; }

const DAMAGE_CATEGORIES = [
  'Brake System', 'Suspension', 'Tyres & Wheels', 'Engine', 'Transmission',
  'Electrical', 'Body & Chassis', 'Exhaust System', 'Fuel System', 'AC System', 'Other',
];
const SEVERITY_COLOR: Record<Severity, string> = {
  Low: '#4ade80', Medium: G, High: '#fb923c', Critical: '#f87171',
};
const APPROVAL_STEPS: { key: ApprovalStatus; label: string }[] = [
  { key: 'not_sent', label: 'Not Sent' },
  { key: 'sent',     label: 'Sent' },
  { key: 'viewed',   label: 'Viewed' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

async function compressImage(file: File): Promise<string> {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    const img    = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      const ratio   = Math.min(1, 800 / img.width);
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(blobUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(''); };
    img.src = blobUrl;
  });
}

function buildTimeline(techName: string, createdAt: string): TimelineEvent[] {
  const n = new Date().toISOString();
  return [
    { id: uid(), label: 'Vehicle Received',    user: 'System',          timestamp: createdAt || n, status: 'done',    color: '#4ade80' },
    { id: uid(), label: 'Inspection Started',  user: techName || 'You', timestamp: n,              status: 'active',  color: G },
    { id: uid(), label: 'Damage Found',        user: '', timestamp: '', status: 'pending', color: '#2a2a2a' },
    { id: uid(), label: 'Media Uploaded',      user: '', timestamp: '', status: 'pending', color: '#2a2a2a' },
    { id: uid(), label: 'Quotation Generated', user: '', timestamp: '', status: 'pending', color: '#2a2a2a' },
    { id: uid(), label: 'Approval Sent',       user: '', timestamp: '', status: 'pending', color: '#2a2a2a' },
    { id: uid(), label: 'Customer Viewed',     user: '', timestamp: '', status: 'pending', color: '#2a2a2a' },
    { id: uid(), label: 'Customer Decision',   user: '', timestamp: '', status: 'pending', color: '#2a2a2a' },
    { id: uid(), label: 'Repair Continued',    user: '', timestamp: '', status: 'pending', color: '#2a2a2a' },
  ];
}

// ─── Shared card wrapper ──────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '20px', overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}
function CardHead({ emoji, title, right }: { emoji: string; title: string; right?: React.ReactNode }) {
  return (
    <div style={{ background: '#161616', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '13px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <span style={{ fontSize: '16px' }}>{emoji}</span>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: '14px' }}>{title}</span>
      </div>
      {right}
    </div>
  );
}

// ─── DAMAGE REPORT FORM ───────────────────────────────────────────────────────
function DamageForm({ initial, onSave, onCancel }: {
  initial?: Partial<DamageReport>;
  onSave: (d: Omit<DamageReport, 'id' | 'createdAt' | 'createdBy'>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: '', category: DAMAGE_CATEGORIES[0], severity: 'Medium' as Severity,
    description: '', recommendedRepair: '', additionalCost: 0, ...initial,
  });
  const f = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const inp = (k: string, v: any) => ({
    value: (form as any)[k], onChange: (e: any) => f(k, v(e)),
    style: { width: '100%', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '12px', color: '#fff', padding: '11px 13px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  });

  return (
    <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '16px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <label style={LBL}>Damage Title *</label>
        <input placeholder="e.g. Excessive brake disc wear" {...inp('title', (e: any) => e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <label style={LBL}>Category</label>
          <select {...inp('category', (e: any) => e.target.value)} style={{ ...inp('category', (e: any) => e.target.value).style, appearance: 'none' as const }}>
            {DAMAGE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Severity</label>
          <select {...inp('severity', (e: any) => e.target.value)} style={{ ...inp('severity', (e: any) => e.target.value).style, appearance: 'none' as const }}>
            {(['Low', 'Medium', 'High', 'Critical'] as Severity[]).map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={LBL}>Description</label>
        <textarea rows={3} placeholder="Describe the damage…" {...inp('description', (e: any) => e.target.value)} style={{ ...inp('description', (e: any) => e.target.value).style, resize: 'none', lineHeight: 1.5 }} />
      </div>
      <div>
        <label style={LBL}>Recommended Repair</label>
        <textarea rows={2} placeholder="What should be done?" {...inp('recommendedRepair', (e: any) => e.target.value)} style={{ ...inp('recommendedRepair', (e: any) => e.target.value).style, resize: 'none', lineHeight: 1.5 }} />
      </div>
      <div>
        <label style={LBL}>Additional Cost (Rs.)</label>
        <input type="number" min="0" {...inp('additionalCost', (e: any) => Number(e.target.value))} />
      </div>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={GHOST_BTN}>Cancel</button>
        <button disabled={!form.title} onClick={() => form.title && onSave({ ...form })}
          style={{ ...GOLD_BTN, opacity: form.title ? 1 : 0.4 }}>
          Save Report
        </button>
      </div>
    </div>
  );
}

// ─── Shared button styles ─────────────────────────────────────────────────────
const GOLD_BTN: React.CSSProperties = {
  background: G, color: '#000', border: 'none', borderRadius: '12px',
  padding: '11px 20px', fontWeight: 900, fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit',
};
const GHOST_BTN: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', color: '#888', border: '1px solid #2a2a2a', borderRadius: '12px',
  padding: '11px 20px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit',
};
const LBL: React.CSSProperties = {
  display: 'block', color: '#444', fontSize: '11px', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
function InspectionInner({ user, onBack }: { user: AuthUser; onBack: () => void }) {

  // ── Job selector state ──────────────────────────────────────────────────────
  const [jobs,        setJobs]        = useState<any[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobSearch,   setJobSearch]   = useState('');
  const [jobDate,     setJobDate]     = useState(todayStr());
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // ── Inspection state ────────────────────────────────────────────────────────
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [loadError,    setLoadError]    = useState<string | null>(null);
  const [retryKey,     setRetryKey]     = useState(0);
  const [saving,       setSaving]       = useState(false);
  const [dataReady,    setDataReady]    = useState(false);
  const [job,          setJob]          = useState<JobSummary | null>(null);

  const [damageReports, setDamage]   = useState<DamageReport[]>([]);
  const [mediaFiles,    setMedia]    = useState<MediaFile[]>([]);
  const [techNotes,     setNotes]    = useState('');
  const [quotationItems, setQuote]   = useState<QuotationItem[]>([
    { id: uid(), item: '', qty: 1, unitPrice: 0, labourCost: 0 },
  ]);
  const [approvalStatus,     setApproval] = useState<ApprovalStatus>('not_sent');
  const [approvalTimestamps, setTs]       = useState<Partial<Record<ApprovalStatus, string>>>({});
  const [timeline,           setTimeline] = useState<TimelineEvent[]>([]);
  const [auditTrail,         setAudit]   = useState<AuditEntry[]>([]);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showAddDamage,  setShowAdd]  = useState(false);
  const [editingDamage,  setEditing]  = useState<DamageReport | null>(null);
  const [lightbox,       setLightbox] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [copiedLink,     setCopied]   = useState(false);
  const [sendingApproval, setSending] = useState(false);
  const [showTL,         setShowTL]   = useState(false);
  const [showAudit,      setShowAudit]= useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const addlFromReports = damageReports.reduce((s, r) => s + r.additionalCost, 0);
  const quoteAddl       = quotationItems.reduce((s, i) => s + i.qty * i.unitPrice + i.labourCost, 0);
  const additionalTotal = quoteAddl || addlFromReports;
  const grandTotal      = (job?.originalCost || 0) + additionalTotal;
  const approvalLink    = inspectionId ? `https://anuratyres.lk/#/approve/${inspectionId}` : '';
  const approvalIdx     = APPROVAL_STEPS.findIndex(s => s.key === approvalStatus);

  // ── Fetch jobs for this branch on the selected date ───────────────────────
  useEffect(() => {
    if (selectedJobId) return;
    setJobsLoading(true);
    fetch(`${API}/jobs?branch=${encodeURIComponent(user.branch)}&date=${jobDate}`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(r => r.json())
      .then(data => {
        setJobs(Array.isArray(data) ? data : []);
      })
      .catch(() => setJobs([]))
      .finally(() => setJobsLoading(false));
  }, [selectedJobId, user.branch, user.token, jobDate]);

  // ── Load / create inspection when job selected ─────────────────────────────
  useEffect(() => {
    if (!selectedJobId) return;
    let cancelled = false;

    const rawJob = jobs.find(j => (j._id?.toString() || j.id) === selectedJobId);

    const buildSummary = (j: any): JobSummary => ({
      jobNumber:      j.bookingRef || `JOB-${j._id?.toString().slice(-6).toUpperCase()}`,
      customerName:   j.customerName || 'Unknown',
      vehicleReg:     j.vehiclePlate || '',
      vehicleMake:    '', vehicleModel: '',
      currentService: j.service || '',
      originalCost:   0,
      status:         j.status || 'pending',
      technician:     j.staffName || user.name,
      branch:         j.branch || user.branch,
      createdAt:      j.createdAt || new Date().toISOString(),
    });
    if (rawJob) setJob(buildSummary(rawJob));

    setLoading(true); setDataReady(false); setLoadError(null);
    setInspectionId(null); setDamage([]); setNotes(''); setApproval('not_sent');
    setTs({}); setTimeline([]); setAudit([]); setMedia([]);
    setQuote([{ id: uid(), item: '', qty: 1, unitPrice: 0, labourCost: 0 }]);

    fetch(`${API}/crm?resource=inspections&jobId=${encodeURIComponent(selectedJobId)}`)
      .then(r => r.json())
      .then(async data => {
        if (cancelled) return;
        if (data?.id) {
          setInspectionId(data.id);
          if (data.jobSummary?.jobNumber) setJob((p: JobSummary | null) => p ? { ...p, ...data.jobSummary } : data.jobSummary);
          if (data.damageReports?.length)  setDamage(data.damageReports);
          if (data.techNotes)              setNotes(data.techNotes);
          if (data.quotationItems?.length) setQuote(data.quotationItems);
          if (data.approvalStatus)         setApproval(data.approvalStatus);
          if (data.approvalTimestamps)     setTs(data.approvalTimestamps);
          if (data.timeline?.length)       setTimeline(data.timeline);
          if (data.auditTrail?.length)     setAudit(data.auditTrail);
          if (data.mediaFiles?.length)
            setMedia(data.mediaFiles.map((m: any) => ({ ...m, url: m.data || m.url || '' })));
        } else {
          const summary = rawJob ? buildSummary(rawJob) : null;
          const initTL  = buildTimeline(summary?.technician || user.name, summary?.createdAt || '');
          const initAudit: AuditEntry[] = [{
            id: uid(), user: user.name, action: 'Inspection created',
            date: fmtDateStr(new Date().toISOString()), time: fmtTimeStr(new Date().toISOString()),
          }];
          const resp = await fetch(`${API}/crm?resource=inspections`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: selectedJobId, jobSummary: summary || {} }),
          });
          if (cancelled) return;
          const created = await resp.json();
          setInspectionId(created.id || null);
          setTimeline(initTL); setAudit(initAudit);
        }
      })
      .catch(e => {
        if (cancelled) return;
        console.error('[inspection] load failed', e);
        setLoadError('Failed to load inspection. Check your connection and try again.');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false); setDataReady(true);
      });

    return () => { cancelled = true; };
  }, [selectedJobId, retryKey]);

  // ── Autosave (2 s debounce) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!inspectionId || !dataReady) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      const mediaToSave = mediaFiles.map(m => ({
        id: m.id, type: m.type, name: m.name, size: m.size, duration: m.duration,
        uploadedAt: m.uploadedAt, uploadedBy: m.uploadedBy,
        data: m.url.startsWith('data:') ? m.url : undefined,
      }));
      try {
        await fetch(`${API}/crm?resource=inspections&id=${inspectionId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobSummary: job, damageReports, techNotes, quotationItems,
            approvalStatus, approvalTimestamps, timeline, auditTrail, mediaFiles: mediaToSave,
          }),
        });
      } catch {}
      finally { setSaving(false); }
    }, 2000);
  }, [inspectionId, dataReady, damageReports, techNotes, quotationItems,
      approvalStatus, approvalTimestamps, timeline, auditTrail, mediaFiles]);

  // ── Audit + timeline helpers ────────────────────────────────────────────────
  const logAudit = useCallback((action: string) => {
    const now = new Date();
    setAudit(a => [{ id: uid(), user: user.name, action, date: fmtDateStr(now.toISOString()), time: fmtTimeStr(now.toISOString()) }, ...a]);
  }, [user.name]);

  const advanceTL = useCallback((fragment: string) => {
    setTimeline(t => t.map(e => {
      if (e.status === 'pending' && e.label.toLowerCase().includes(fragment.toLowerCase()))
        return { ...e, status: 'done', user: user.name, timestamp: new Date().toISOString(), color: '#4ade80' };
      return e;
    }));
  }, [user.name]);

  // ── Damage handlers ─────────────────────────────────────────────────────────
  const addDamage = (d: Omit<DamageReport, 'id' | 'createdAt' | 'createdBy'>) => {
    setDamage(prev => [...prev, { ...d, id: uid(), createdAt: new Date().toISOString(), createdBy: user.name }]);
    setShowAdd(false); logAudit(`Added damage: "${d.title}"`); advanceTL('Damage Found');
  };
  const editDamage = (id: string, d: Omit<DamageReport, 'id' | 'createdAt' | 'createdBy'>) => {
    setDamage(prev => prev.map(r => r.id === id ? { ...r, ...d } : r));
    setEditing(null); logAudit(`Updated damage: "${d.title}"`);
  };
  const delDamage = (id: string) => {
    const r = damageReports.find(x => x.id === id);
    setDamage(prev => prev.filter(x => x.id !== id)); logAudit(`Deleted damage: "${r?.title}"`);
  };

  // ── Media handlers ──────────────────────────────────────────────────────────
  const processFiles = async (files: FileList | File[]) => {
    logAudit(`Uploaded ${files.length} file(s)`); advanceTL('Media Uploaded');
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const data = await compressImage(file);
        setMedia(m => [...m, { id: uid(), type: 'image', url: data, name: file.name, size: file.size, uploadedAt: new Date().toISOString(), uploadedBy: user.name }]);
      } else if (file.type.startsWith('video/')) {
        const MAX_MB = 20;
        if (file.size > MAX_MB * 1024 * 1024) {
          alert(`"${file.name}" is too large (>${MAX_MB}MB). Please use a shorter or lower-quality clip.`);
          continue;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const mf: MediaFile = { id: uid(), type: 'video', url: dataUrl, name: file.name, size: file.size, uploadedAt: new Date().toISOString(), uploadedBy: user.name };
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.src = dataUrl;
        vid.onloadedmetadata = () => setMedia(m => m.map(x => x.id === mf.id ? { ...x, duration: Math.round(vid.duration) } : x));
        setMedia(m => [...m, mf]);
      }
    }
  };

  // ── Quotation helpers ────────────────────────────────────────────────────────
  const addRow    = () => setQuote(q => [...q, { id: uid(), item: '', qty: 1, unitPrice: 0, labourCost: 0 }]);
  const updRow    = (id: string, k: keyof QuotationItem, v: any) => setQuote(q => q.map(r => r.id === id ? { ...r, [k]: v } : r));
  const delRow    = (id: string) => setQuote(q => q.filter(r => r.id !== id));

  // ── Approval ─────────────────────────────────────────────────────────────────
  const sendApproval = async (channel: 'link' | 'whatsapp') => {
    setSending(true);
    await new Promise(r => setTimeout(r, 700));
    setSending(false);
    const ts = new Date().toISOString();
    setApproval('sent'); setTs(t => ({ ...t, sent: ts })); advanceTL('Approval Sent');
    logAudit(`Sent approval via ${channel === 'whatsapp' ? 'WhatsApp' : 'link'}`);
    if (channel === 'whatsapp') {
      const msg = encodeURIComponent(`Hi ${job?.customerName}, additional issues were found on your vehicle ${job?.vehicleReg}. Please review and approve: ${approvalLink}`);
      window.open(`https://wa.me/?text=${msg}`, '_blank');
    }
  };
  const simulateView = () => {
    if (approvalStatus === 'sent') { const ts = new Date().toISOString(); setApproval('viewed'); setTs(t => ({ ...t, viewed: ts })); advanceTL('Customer Viewed'); logAudit('Simulated: customer viewed approval'); }
  };
  const copyLink = () => {
    navigator.clipboard.writeText(approvalLink).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => { if (quoteAddl > 0 && dataReady) advanceTL('Quotation Generated'); }, [quoteAddl]);

  const FONT = "'Inter', system-ui, sans-serif";
  const S = { minHeight: '100dvh', background: '#0a0a0a', fontFamily: FONT, color: '#fff' };

  // ─────────────────────────────────────────────────────────────────────────────
  // JOB SELECTOR SCREEN
  // ─────────────────────────────────────────────────────────────────────────────
  if (!selectedJobId) {
    const filtered = jobs.filter(j => {
      if (!jobSearch) return true;
      const q = jobSearch.toLowerCase();
      return (j.vehiclePlate || '').toLowerCase().includes(q) ||
             (j.customerName || '').toLowerCase().includes(q) ||
             (j.service || '').toLowerCase().includes(q);
    });

    return (
      <div style={S}>
        <header style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(13,13,13,0.97)', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
          <div style={{ maxWidth: '640px', margin: '0 auto', height: '62px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid #222', borderRadius: '10px', color: '#888', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', fontFamily: FONT, fontWeight: 700 }}>
              ← Jobs
            </button>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: '14px' }}>Damage Inspection</div>
              <div style={{ color: '#333', fontSize: '11px' }}>Select a job to inspect</div>
            </div>
          </div>
        </header>

        <div style={{ maxWidth: '640px', margin: '0 auto', padding: '20px 14px' }}>
          {/* Date filter */}
          <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px', pointerEvents: 'none' }}>📅</span>
              <input
                type="date"
                value={jobDate}
                onChange={e => setJobDate(e.target.value)}
                style={{ width: '100%', background: '#161616', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '14px', color: '#fff', padding: '12px 16px 12px 40px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT, colorScheme: 'dark' }}
              />
            </div>
            {jobDate !== todayStr() && (
              <button
                onClick={() => setJobDate(todayStr())}
                style={{ background: 'rgba(254,241,4,0.08)', border: '1px solid rgba(254,241,4,0.2)', borderRadius: '12px', color: '#fef104', padding: '12px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}
              >
                Today
              </button>
            )}
          </div>

          {/* Search */}
          <div style={{ marginBottom: '16px' }}>
            <input
              value={jobSearch} onChange={e => setJobSearch(e.target.value)}
              placeholder="🔍  Search vehicle, customer, service…"
              style={{ width: '100%', background: '#161616', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', color: '#fff', padding: '13px 16px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT }}
            />
          </div>

          {jobsLoading && <div style={{ textAlign: 'center', padding: '60px 0', color: G, fontSize: '14px' }}>⚙️ Loading jobs…</div>}

          {!jobsLoading && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</div>
              <div style={{ color: '#555', fontSize: '14px' }}>
                No jobs found for {jobDate === todayStr() ? 'today' : new Date(jobDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
          )}

          {!jobsLoading && filtered.map(j => {
            const jid = j._id?.toString() || j.id;
            const statusColors: Record<string, string> = { in_progress: '#4ade80', paused: G, done: '#555', terminated: '#555', assigned: '#60a5fa', unassigned: '#333' };
            const sc = statusColors[j.status] || '#888';
            return (
              <div
                key={jid}
                onClick={() => { setLoading(true); setDataReady(false); setLoadError(null); setSelectedJobId(jid); }}
                style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '18px', padding: '16px 18px', marginBottom: '12px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(254,241,4,0.2)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: 'rgba(254,241,4,0.08)', border: '1px solid rgba(254,241,4,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🚗</div>
                    <div>
                      <div style={{ color: '#fff', fontWeight: 900, fontFamily: 'monospace', fontSize: '15px' }}>{j.vehiclePlate || '—'}</div>
                      <div style={{ color: '#444', fontSize: '11px' }}>{j.branch}</div>
                    </div>
                  </div>
                  <span style={{ padding: '4px 11px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, color: sc, background: `${sc}18`, border: `1px solid ${sc}30`, flexShrink: 0 }}>
                    {j.status?.replace(/_/g, ' ')}
                  </span>
                </div>
                <div style={{ color: '#ccc', fontSize: '14px', fontWeight: 600, marginBottom: '3px' }}>{j.customerName || '—'}</div>
                <div style={{ color: 'rgba(254,241,4,0.6)', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>{j.service}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#333', fontSize: '11px' }}>👤 {j.staffName || 'Unassigned'}</span>
                  <span style={{ color: G, fontSize: '12px', fontWeight: 800 }}>Inspect →</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LOADING  (only reached when selectedJobId is set)
  // ─────────────────────────────────────────────────────────────────────────────
  if (loading || !dataReady) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚙️</div>
          <div style={{ color: G, fontSize: '14px' }}>Loading inspection record…</div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ERROR
  // ─────────────────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div style={{ ...S, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '0 24px' }}>
          <div style={{ fontSize: '36px', marginBottom: '14px' }}>⚠️</div>
          <div style={{ color: '#ef4444', fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>Load Failed</div>
          <div style={{ color: '#555', fontSize: '13px', marginBottom: '24px', lineHeight: 1.5 }}>{loadError}</div>
          <button
            onClick={() => { setLoadError(null); setLoading(true); setDataReady(false); setRetryKey(k => k + 1); }}
            style={{ background: G, color: '#000', border: 'none', borderRadius: '12px', padding: '12px 28px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', fontFamily: FONT, marginBottom: '12px' }}
          >
            Retry
          </button>
          <br />
          <button
            onClick={() => { setLoadError(null); setSelectedJobId(null); }}
            style={{ background: 'none', border: '1px solid #222', borderRadius: '12px', padding: '10px 24px', fontSize: '13px', color: '#555', cursor: 'pointer', fontFamily: FONT }}
          >
            ← Back to Jobs
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INSPECTION VIEW
  // ─────────────────────────────────────────────────────────────────────────────
  const safeJob = job || { jobNumber: '—', customerName: '—', vehicleReg: '—', vehicleMake: '', vehicleModel: '', currentService: '—', originalCost: 0, status: '—', technician: user.name, branch: user.branch, createdAt: new Date().toISOString() };

  return (
    <div style={S}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }`}</style>

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(13,13,13,0.97)', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', height: '62px', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setSelectedJobId(null)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid #222', borderRadius: '10px', color: '#888', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', fontFamily: FONT, fontWeight: 700 }}>
              ← Back
            </button>
            <div>
              <div style={{ color: '#ccc', fontSize: '11px', fontFamily: 'monospace' }}>{safeJob.jobNumber}</div>
              <div style={{ color: G, fontSize: '13px', fontWeight: 800 }}>Damage Inspection</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {saving && <span style={{ color: '#444', fontSize: '11px' }}>Saving…</span>}
            <span style={{ padding: '4px 11px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, color: '#60a5fa', background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.2)' }}>
              {safeJob.status?.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '640px', margin: '0 auto', padding: '20px 14px 60px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {/* ── SECTION 1: Job Summary ─────────────────────────────────────── */}
        <Card>
          <CardHead emoji="🔧" title="Job Summary" />
          <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[
              { label: 'Job Ref',    value: safeJob.jobNumber,       mono: true },
              { label: 'Customer',   value: safeJob.customerName },
              { label: 'Vehicle',    value: safeJob.vehicleReg,      mono: true },
              { label: 'Branch',     value: safeJob.branch },
              { label: 'Service',    value: safeJob.currentService,  full: true },
              { label: 'Technician', value: safeJob.technician || user.name },
              { label: 'Estimate',   value: fmtCur(safeJob.originalCost), gold: true },
            ].map(({ label, value, mono, full, gold }) => (
              <div key={label} style={{ gridColumn: full ? '1 / -1' : undefined, background: '#161616', borderRadius: '12px', padding: '10px 12px', border: gold ? `1px solid rgba(254,241,4,0.2)` : '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ color: '#333', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
                <div style={{ color: gold ? G : '#fff', fontSize: '14px', fontWeight: 800, fontFamily: mono ? 'monospace' : FONT }}>{value}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* ── SECTION 2: Damage Reports ─────────────────────────────────── */}
        <Card>
          <CardHead
            emoji="⚠️"
            title={`Damage Reports${damageReports.length > 0 ? ` (${damageReports.length})` : ''}`}
            right={
              !showAddDamage && !editingDamage
                ? <button onClick={() => setShowAdd(true)} style={GOLD_BTN}>+ Add</button>
                : null
            }
          />
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {showAddDamage && (
              <DamageForm onSave={addDamage} onCancel={() => setShowAdd(false)} />
            )}

            {damageReports.length === 0 && !showAddDamage && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ fontSize: '36px', marginBottom: '10px' }}>⚠️</div>
                <div style={{ color: '#333', fontSize: '14px' }}>No damage reports yet</div>
                <div style={{ color: '#222', fontSize: '12px', marginTop: '4px' }}>Tap "Add" to document a fault found during inspection</div>
              </div>
            )}

            {damageReports.map(r => (
              <div key={r.id}>
                {editingDamage?.id === r.id ? (
                  <DamageForm initial={r} onSave={d => editDamage(r.id, d)} onCancel={() => setEditing(null)} />
                ) : (
                  <div style={{ background: '#161616', border: `1px solid ${SEVERITY_COLOR[r.severity]}22`, borderLeft: `3px solid ${SEVERITY_COLOR[r.severity]}`, borderRadius: '14px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#fff', fontWeight: 800, fontSize: '15px', marginBottom: '3px' }}>{r.title}</div>
                        <span style={{ background: `${SEVERITY_COLOR[r.severity]}20`, color: SEVERITY_COLOR[r.severity], border: `1px solid ${SEVERITY_COLOR[r.severity]}40`, borderRadius: '999px', padding: '2px 10px', fontSize: '11px', fontWeight: 700 }}>{r.severity}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginLeft: '10px', flexShrink: 0 }}>
                        <button onClick={() => setEditing(r)} style={{ background: 'rgba(254,241,4,0.08)', border: '1px solid rgba(254,241,4,0.15)', borderRadius: '8px', color: G, cursor: 'pointer', padding: '6px 10px', fontSize: '12px' }}>✏️</button>
                        <button onClick={() => delDamage(r.id)} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '8px', color: '#f87171', cursor: 'pointer', padding: '6px 10px', fontSize: '12px' }}>🗑</button>
                      </div>
                    </div>
                    <div style={{ color: '#444', fontSize: '11px', marginBottom: '6px' }}>{r.category}</div>
                    {r.description && <div style={{ color: '#888', fontSize: '13px', marginBottom: '6px', lineHeight: 1.5 }}>{r.description}</div>}
                    {r.recommendedRepair && <div style={{ color: '#666', fontSize: '12px' }}><span style={{ color: '#888', fontWeight: 700 }}>Rec: </span>{r.recommendedRepair}</div>}
                    {r.additionalCost > 0 && <div style={{ color: '#fff', fontWeight: 900, fontSize: '15px', marginTop: '10px' }}>{fmtCur(r.additionalCost)}</div>}
                  </div>
                )}
              </div>
            ))}

            {damageReports.length > 0 && (
              <div style={{ background: 'rgba(254,241,4,0.04)', border: '1px solid rgba(254,241,4,0.15)', borderRadius: '14px', padding: '14px 16px', textAlign: 'right' }}>
                <div style={{ color: '#444', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Total Additional</div>
                <div style={{ color: G, fontWeight: 900, fontSize: '22px' }}>{fmtCur(addlFromReports)}</div>
              </div>
            )}
          </div>
        </Card>

        {/* ── SECTION 3: Media Evidence ─────────────────────────────────── */}
        <Card>
          <CardHead
            emoji="📷"
            title={`Media Evidence${mediaFiles.length > 0 ? ` (${mediaFiles.length})` : ''}`}
            right={
              <button onClick={() => fileInputRef.current?.click()} style={GOLD_BTN}>Upload</button>
            }
          />
          <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" style={{ display: 'none' }}
            onChange={e => e.target.files && processFiles(e.target.files)} />
          <div style={{ padding: '16px' }}>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); processFiles(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              style={{ border: '2px dashed #222', borderRadius: '14px', padding: '24px', textAlign: 'center', cursor: 'pointer', marginBottom: '14px', transition: 'border-color 0.15s' }}
            >
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>📷 🎥</div>
              <div style={{ color: '#555', fontSize: '14px' }}>Drop files or tap to upload</div>
              <div style={{ color: '#333', fontSize: '12px', marginTop: '4px' }}>Images saved to cloud · Videos local only</div>
            </div>

            {mediaFiles.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {mediaFiles.map(m => (
                  <div key={m.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: '10px', overflow: 'hidden', background: '#1a1a1a', cursor: 'pointer' }}
                    onClick={() => m.url && setLightbox({ url: m.url, type: m.type })}>
                    {m.type === 'image' && m.url
                      ? <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : m.type === 'video' && m.url
                      ? <video src={m.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>▶️</div>
                    }
                    {m.type === 'video' && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: '14px', marginLeft: '3px' }}>▶</span>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); setMedia(prev => prev.filter(x => x.id !== m.id)); logAudit('Deleted media file'); }}
                      style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '6px', color: '#f87171', cursor: 'pointer', width: '22px', height: '22px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    <span style={{ position: 'absolute', bottom: '4px', left: '4px', background: m.type === 'video' ? 'rgba(96,165,250,0.8)' : 'rgba(254,241,4,0.8)', color: '#000', borderRadius: '4px', padding: '1px 5px', fontSize: '9px', fontWeight: 900 }}>
                      {m.type === 'video' ? 'VID' : 'IMG'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {mediaFiles.length === 0 && <div style={{ color: '#222', fontSize: '12px', textAlign: 'center', marginTop: '-4px' }}>No media uploaded yet</div>}
          </div>
        </Card>

        {/* ── SECTION 4: Technician Findings ────────────────────────────── */}
        <Card>
          <CardHead emoji="📝" title="Technician Findings" />
          <div style={{ padding: '16px' }}>
            <textarea
              rows={6} value={techNotes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe the full inspection findings in detail…"
              style={{ width: '100%', background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', color: '#fff', padding: '13px 15px', fontSize: '14px', outline: 'none', resize: 'none', fontFamily: FONT, lineHeight: 1.6, boxSizing: 'border-box' }}
            />
            <div style={{ color: '#333', fontSize: '11px', textAlign: 'right', marginTop: '5px' }}>{techNotes.length} characters</div>
          </div>
        </Card>

        {/* ── SECTION 5: Quotation Builder ──────────────────────────────── */}
        <Card>
          <CardHead emoji="💰" title="Additional Quotation" right={
            <button onClick={addRow} style={GHOST_BTN}>+ Line</button>
          } />
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {quotationItems.map(row => {
              const rowTotal = row.qty * row.unitPrice + row.labourCost;
              return (
                <div key={row.id} style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input value={row.item} onChange={e => updRow(row.id, 'item', e.target.value)}
                      placeholder="Item / Part description" style={{ flex: 1, background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '10px', color: '#fff', padding: '9px 12px', fontSize: '14px', outline: 'none', fontFamily: FONT }} />
                    <button onClick={() => delRow(row.id)} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '10px', color: '#f87171', cursor: 'pointer', padding: '9px 12px', fontSize: '13px' }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    {[
                      { label: 'Qty',          k: 'qty',       val: row.qty },
                      { label: 'Unit Price',    k: 'unitPrice', val: row.unitPrice },
                      { label: 'Labour (Rs.)',  k: 'labourCost',val: row.labourCost },
                    ].map(({ label, k, val }) => (
                      <div key={k}>
                        <div style={{ color: '#333', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>{label}</div>
                        <input type="number" min="0" value={val} onChange={e => updRow(row.id, k as keyof QuotationItem, Number(e.target.value))}
                          style={{ width: '100%', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '10px', color: '#fff', padding: '8px 10px', fontSize: '14px', outline: 'none', textAlign: 'right', boxSizing: 'border-box' as const, fontFamily: FONT }} />
                      </div>
                    ))}
                  </div>
                  {rowTotal > 0 && <div style={{ textAlign: 'right', color: '#fff', fontWeight: 900, fontSize: '16px' }}>{fmtCur(rowTotal)}</div>}
                </div>
              );
            })}

            {/* Cost summary */}
            <div style={{ background: 'rgba(254,241,4,0.04)', border: '1px solid rgba(254,241,4,0.12)', borderRadius: '14px', padding: '14px 16px' }}>
              {[
                { label: 'Original Estimate', value: safeJob.originalCost, col: '#fff' },
                { label: 'Additional Parts',  value: quotationItems.reduce((s, i) => s + i.qty * i.unitPrice, 0), col: '#fb923c' },
                { label: 'Additional Labour', value: quotationItems.reduce((s, i) => s + i.labourCost, 0), col: '#fb923c' },
              ].map(({ label, value, col }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                  <span style={{ color: '#555' }}>{label}</span>
                  <span style={{ color: col, fontWeight: 700 }}>{fmtCur(value)}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid rgba(254,241,4,0.15)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#fff', fontWeight: 900, fontSize: '15px' }}>Grand Total</span>
                <span style={{ color: G, fontWeight: 900, fontSize: '22px' }}>{fmtCur(grandTotal)}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* ── SECTION 6: Approval Status ────────────────────────────────── */}
        <Card>
          <CardHead emoji="🛡️" title="Customer Approval Status" />
          <div style={{ padding: '16px' }}>
            {/* Stepper */}
            <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', marginBottom: '16px' }}>
              <div style={{ position: 'absolute', top: '15px', left: '10%', right: '10%', height: '2px', background: 'rgba(255,255,255,0.07)', zIndex: 0 }} />
              {APPROVAL_STEPS.filter(s => s.key !== 'rejected' || approvalStatus === 'rejected').map((step, i) => {
                const done    = i < approvalIdx;
                const active  = approvalStatus === step.key;
                const isRej   = step.key === 'rejected';
                const dotCol  = active && isRej ? '#f87171' : active ? G : done ? '#4ade80' : '#2a2a2a';
                const textCol = active && isRej ? '#f87171' : active ? G : done ? '#4ade80' : '#333';
                return (
                  <div key={step.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative', zIndex: 1 }}>
                    <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: done ? dotCol : '#111', border: `2px solid ${dotCol}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 900, color: done ? '#000' : dotCol, transition: 'all 0.2s' }}>
                      {done ? '✓' : active ? '●' : '○'}
                    </div>
                    <div style={{ color: textCol, fontSize: '10px', fontWeight: 700, marginTop: '6px', textAlign: 'center', lineHeight: 1.2 }}>{step.label}</div>
                    {approvalTimestamps[step.key] && <div style={{ color: '#333', fontSize: '9px', marginTop: '2px', textAlign: 'center' }}>{fmtDT(approvalTimestamps[step.key]!)}</div>}
                  </div>
                );
              })}
            </div>

            {approvalStatus === 'approved' && (
              <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '12px', padding: '12px 14px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontSize: '18px' }}>✅</span>
                <div>
                  <div style={{ color: '#4ade80', fontWeight: 800, fontSize: '14px' }}>Customer Approved</div>
                  <div style={{ color: '#166534', fontSize: '12px' }}>Proceed with additional repairs</div>
                </div>
              </div>
            )}
            {approvalStatus === 'rejected' && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '12px 14px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontSize: '18px' }}>❌</span>
                <div>
                  <div style={{ color: '#f87171', fontWeight: 800, fontSize: '14px' }}>Customer Rejected</div>
                  <div style={{ color: '#7f1d1d', fontSize: '12px' }}>Do not proceed with additional repairs</div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* ── SECTION 7: Approval Actions ───────────────────────────────── */}
        <Card>
          <CardHead emoji="📤" title="Send Approval Request" />
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Approval link */}
            {inspectionId && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1, background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '11px 13px', overflow: 'hidden' }}>
                  <div style={{ color: '#333', fontFamily: 'monospace', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{approvalLink}</div>
                </div>
                <button onClick={copyLink} style={{ ...GHOST_BTN, padding: '11px 14px', flexShrink: 0, color: copiedLink ? '#4ade80' : '#888', borderColor: copiedLink ? 'rgba(34,197,94,0.3)' : '#2a2a2a', background: copiedLink ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.05)' }}>
                  {copiedLink ? '✓' : '📋'}
                </button>
              </div>
            )}

            <button
              onClick={() => sendApproval('link')} disabled={sendingApproval}
              style={{ ...GOLD_BTN, padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: sendingApproval ? 0.6 : 1 }}>
              {sendingApproval
                ? <><div style={{ width: '16px', height: '16px', border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Sending…</>
                : '📤 Send Approval Request'}
            </button>

            <button
              onClick={() => sendApproval('whatsapp')} disabled={sendingApproval}
              style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px 20px', fontWeight: 900, fontSize: '14px', cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: sendingApproval ? 0.6 : 1 }}>
              💬 Send via WhatsApp
            </button>

            {approvalStatus === 'sent' && (
              <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '12px', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: '#60a5fa', fontSize: '13px', fontWeight: 700 }}>ℹ Waiting for customer response</div>
                <button onClick={simulateView} style={{ color: '#60a5fa', background: 'none', border: '1px solid rgba(96,165,250,0.3)', borderRadius: '8px', padding: '5px 10px', fontSize: '11px', cursor: 'pointer', fontFamily: FONT }}>Sim. View</button>
              </div>
            )}

            {!inspectionId && (
              <div style={{ color: '#333', fontSize: '12px', textAlign: 'center' }}>Save some data first to generate the approval link</div>
            )}
          </div>
        </Card>

        {/* ── TIMELINE (collapsible) ────────────────────────────────────── */}
        <Card>
          <button
            onClick={() => setShowTL(p => !p)}
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT }}
          >
            <CardHead emoji="📍" title={`Activity Timeline (${timeline.length})`} right={
              <span style={{ color: '#333', fontSize: '14px' }}>{showTL ? '▲' : '▼'}</span>
            } />
          </button>
          {showTL && (
            <div style={{ padding: '16px' }}>
              {timeline.length === 0 && <div style={{ color: '#333', fontSize: '13px', textAlign: 'center' }}>No events yet</div>}
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: '14px', top: '4px', bottom: '4px', width: '2px', background: 'rgba(255,255,255,0.07)' }} />
                {timeline.map(e => (
                  <div key={e.id} style={{ display: 'flex', gap: '14px', paddingLeft: '36px', marginBottom: '14px', position: 'relative', opacity: e.status === 'pending' ? 0.35 : 1 }}>
                    <div style={{ position: 'absolute', left: '0', top: '2px', width: '28px', height: '28px', borderRadius: '50%', background: e.status === 'done' ? e.color : e.status === 'active' ? '#111' : '#111', border: e.status === 'active' ? `2px solid ${G}` : e.status === 'done' ? 'none' : '2px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: e.status === 'done' ? '#000' : e.status === 'active' ? G : '#333' }}>
                      {e.status === 'done' ? '✓' : e.status === 'active' ? '●' : '○'}
                    </div>
                    <div>
                      <div style={{ color: e.status === 'active' ? G : e.status === 'done' ? '#fff' : '#555', fontWeight: 700, fontSize: '13px' }}>{e.label}</div>
                      {e.status !== 'pending' && e.user && <div style={{ color: '#333', fontSize: '11px' }}>{e.user}</div>}
                      {e.timestamp && <div style={{ color: '#2a2a2a', fontSize: '11px' }}>{fmtDT(e.timestamp)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* ── AUDIT TRAIL (collapsible) ─────────────────────────────────── */}
        <Card>
          <button
            onClick={() => setShowAudit(p => !p)}
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT }}
          >
            <CardHead emoji="🛡️" title={`Audit Trail (${auditTrail.length})`} right={
              <span style={{ color: '#333', fontSize: '14px' }}>{showAudit ? '▲' : '▼'}</span>
            } />
          </button>
          {showAudit && (
            <div style={{ padding: '8px 16px 16px' }}>
              {auditTrail.length === 0 && <div style={{ color: '#333', fontSize: '13px', textAlign: 'center', padding: '16px 0' }}>No entries yet</div>}
              {auditTrail.map(entry => (
                <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid #161616', gap: '10px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#ccc', fontSize: '13px', fontWeight: 600 }}>{entry.action}</div>
                    <div style={{ color: '#333', fontSize: '11px', marginTop: '2px' }}>👤 {entry.user}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ color: '#333', fontSize: '11px' }}>{entry.date}</div>
                    <div style={{ color: '#222', fontSize: '10px', fontFamily: 'monospace' }}>{entry.time}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

      </main>

      {/* Lightbox */}
      {lightbox && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={() => setLightbox(null)}>
          {lightbox.type === 'video'
            ? <video
                src={lightbox.url}
                controls
                autoPlay
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: '12px', outline: 'none' }}
              />
            : <img src={lightbox.url} style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: '12px', objectFit: 'contain' }} />
          }
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: '16px', right: '16px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', color: '#fff', fontSize: '16px', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}

export function StaffDamageInspectionPage({ user, onBack }: { user: AuthUser; onBack: () => void }) {
  return (
    <InspectionErrorBoundary onReset={onBack}>
      <InspectionInner user={user} onBack={onBack} />
    </InspectionErrorBoundary>
  );
}
