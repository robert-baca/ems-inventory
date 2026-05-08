import { useState, useEffect, useRef } from 'react';

function resizeImage(base64, maxDim = 400) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.72).split(',')[1]);
    };
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

function parseExp(mmyyyy) {
  if (!mmyyyy || mmyyyy === 'NA') return null;
  const [m, y] = mmyyyy.split('/');
  if (!m || !y || isNaN(+m) || isNaN(+y)) return null;
  let year = +y;
  if (year < 100) year += 2000;
  return new Date(year, +m, 0);
}

function normalizeExp(v) {
  if (!v || v === 'NA') return v;
  const parts = v.split('/');
  if (parts.length !== 2) return v;
  let [m, y] = parts;
  if (!m || !y || isNaN(+m) || isNaN(+y)) return v;
  if (+m < 1 || +m > 12) return v;
  m = String(+m).padStart(2, '0');
  if (y.length === 2) y = '20' + y;
  if (y.length !== 4) return v;
  return `${m}/${y}`;
}

function getStatus(expiration) {
  if (!expiration || expiration === 'NA') return { label: 'NO EXP', type: 'none', days: null };
  const exp = parseExp(expiration);
  if (!exp) return { label: 'NO EXP', type: 'none', days: null };
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.ceil((exp - now) / 86400000);
  if (days < 0)   return { label: 'EXPIRED',    type: 'expired', days };
  if (days <= 31) return { label: 'THIS MONTH', type: 'soon',    days };
  if (days <= 90) return { label: 'EXP SOON',   type: 'watch',   days };
  return               { label: 'GOOD',         type: 'good',    days };
}

function worstStatus(entries) {
  const order = ['expired', 'soon', 'watch', 'none', 'good'];
  return entries.reduce((w, e) => {
    const t = getStatus(e.expiration).type;
    return order.indexOf(t) < order.indexOf(w) ? t : w;
  }, 'good');
}

function fifoMove(stock, libraryId, qty, fromLocId, toLocId) {
  const toMove = stock
    .filter(s => s.libraryId === libraryId && s.locationId === fromLocId && s.status === 'active')
    .sort((a, b) => {
      if (a.expiration === 'NA' && b.expiration === 'NA') return 0;
      if (a.expiration === 'NA') return 1;
      if (b.expiration === 'NA') return -1;
      const da = parseExp(a.expiration), db = parseExp(b.expiration);
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return da - db;
    })
    .slice(0, qty).map(s => s.id);
  return stock.map(s => toMove.includes(s.id) ? { ...s, locationId: toLocId } : s);
}

function generateOrderReport(library, stock, categories) {
  const active = stock.filter(s => s.status === 'active');
  return categories.map(cat => {
    const items = library
      .filter(item => item.category === cat.id && item.status !== 'inactive' && ((item.sfotPar||0)+(item.hhaPar||0)) > 0)
      .map(item => {
        const entries      = active.filter(s => s.libraryId === item.id);
        const expired      = entries.filter(s => getStatus(s.expiration).type === 'expired').length;
        const expiringSoon = entries.filter(s => getStatus(s.expiration).type === 'soon').length;
        const usable       = entries.filter(s => getStatus(s.expiration).type !== 'expired').length;
        const par          = (item.sfotPar||0) + (item.hhaPar||0);
        const needed       = Math.max(0, par - usable);
        return { item, total: entries.length, expired, expiringSoon, usable, par, needed };
      });
    return { category: cat, items };
  }).filter(s => s.items.length > 0);
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 900);
  useEffect(() => {
    const h = () => setIsDesktop(window.innerWidth >= 900);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return isDesktop;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

const SS = {
  expired: { bg: 'var(--color-danger-bg)',  text: 'var(--color-danger-text)',  border: 'var(--color-danger-border)' },
  soon:    { bg: 'var(--color-warning-bg)', text: 'var(--color-warning-text)', border: 'var(--color-warning-border)' },
  watch:   { bg: 'var(--color-watch-bg)',   text: 'var(--color-watch-text)',   border: 'var(--color-watch-border)' },
  good:    { bg: 'var(--color-success-bg)', text: 'var(--color-success-text)', border: 'var(--color-success-border)' },
  none:    { bg: 'var(--color-none-bg)',    text: 'var(--color-none-text)',     border: 'var(--color-none-border)' },
};

const PACKAGING = [
  { value: 'bulk_bottle', label: '🧴 Bulk bottle',      hint: 'ASA, Tylenol, Benadryl' },
  { value: 'unit_dose',   label: '💊 Unit dose',        hint: 'Zofran ODT, blister packs' },
  { value: 'vial',        label: '💉 Vial / syringe',   hint: 'Epi, Atropine, prefilled' },
  { value: 'multi_dose',  label: '🏥 Multi-dose / bag', hint: 'NS bags, multi-dose vials' },
  { value: 'each',        label: '📦 Each / unit',      hint: 'Equipment, devices' },
];

const DEFAULT_LOCATIONS = [
  { id: 'supply-room',  name: 'Supply Room',  type: 'supply_room', icon: '📦', templateId: null },
  { id: 'cart-1',       name: 'Cart 1',       type: 'cart',        icon: '🛒', templateId: null },
  { id: 'cart-2',       name: 'Cart 2',       type: 'cart',        icon: '🛒', templateId: null },
  ...Array.from({ length: 10 }, (_, i) => ({ id: `medic-bag-${i+1}`, name: `Medic Bag ${i+1}`, type: 'bag', icon: '🎒', templateId: null })),
  { id: 'airway-bag-1', name: 'Airway Bag 1', type: 'bag', icon: '🎒', templateId: null },
  { id: 'airway-bag-2', name: 'Airway Bag 2', type: 'bag', icon: '🎒', templateId: null },
  { id: 'als-bag-1',    name: 'ALS Bag 1',    type: 'bag', icon: '🎒', templateId: null },
  { id: 'als-bag-2',    name: 'ALS Bag 2',    type: 'bag', icon: '🎒', templateId: null },
];

const DEFAULT_CATEGORIES = [
  { id: 'drugs',       name: 'Drugs',       icon: '💊' },
  { id: 'disposables', name: 'Disposables', icon: '🩹' },
  { id: 'airway',      name: 'Airway',      icon: '🫁' },
  { id: 'trauma',      name: 'Trauma',      icon: '🩸' },
  { id: 'equipment',   name: 'Equipment',   icon: '🔧' },
];

const btnP = { padding: '12px 20px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'var(--font)' };
const btnS = { padding: '12px 20px', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font)' };
const btnG = { padding: '12px 20px', background: '#1d6b3a', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'var(--font)' };

const api = {
  get:           e      => fetch(`/api/${e}`).then(r => r.json()),
  post:          (e, d) => fetch(`/api/${e}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(r => r.json()),
  getLibrary:    ()     => api.get('library'),
  saveLibrary:   data   => api.post('library', data),
  getStock:      ()     => api.get('stock'),
  saveStock:     data   => api.post('stock', { replace: data }),
  appendStock:   entries => api.post('stock', { entries }),
  getLocations:  ()     => api.get('locations'),
  saveLocations: data   => api.post('locations', data),
  getCategories: ()     => api.get('categories'),
  saveCategories:data   => api.post('categories', data),
  getTemplates:  ()     => api.get('templates'),
  saveTemplates: data   => api.post('templates', data),
  getMap:        ()     => api.get('map'),
  saveMap:       data   => api.post('map', data),
  scan:      (images, spreadsheet) => fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images, spreadsheet: spreadsheet||[] }) }).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); return d; }),
  quickscan: (image, library) => fetch('/api/quickscan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, library }) }).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); return d; }),
  ndcLookup:        ndc  => fetch(`/api/ndc?ndc=${encodeURIComponent(ndc)}`).then(r => r.json()),
  getPending:        ()    => api.get('pending'),
  savePendingItem:   item  => api.post('pending', { item }),
  deletePending:     id    => api.post('pending', { deleteId: id }),
  getSpreadsheet:    ()    => api.get('spreadsheet'),
  saveSpreadsheet:   rows  => api.post('spreadsheet', { rows }),
  clearSpreadsheet:  ()    => api.post('spreadsheet', { clear: true }),
};

function Badge({ type, label }) {
  const s = SS[type] || SS.none;
  return <span style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}`, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{label}</span>;
}

function TopBar({ title, onBack, right, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 0', marginBottom: 16 }}>
      {onBack && <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 14, padding: '0 12px 0 0', fontFamily: 'var(--font)', flexShrink: 0 }}>← Back</button>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1 }}>{subtitle}</div>}
      </div>
      {right && <div style={{ marginLeft: 10, flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

function SectionHeader({ title, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '0.06em' }}>{title.toUpperCase()}</div>
      {right}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function EmptyState({ icon = '📋', title, subtitle, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>{subtitle}</div>}
      {action}
    </div>
  );
}

function Spinner() {
  return <div style={{ width: 40, height: 40, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-text)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />;
}

function ExpirationInput({ value, onChange, label }) {
  function handle(e) {
    let v = e.target.value.replace(/[^\d/]/g, '');
    if (v.length === 2 && value.length === 1 && !v.includes('/')) v = v + '/';
    if (v.length > 7) v = v.slice(0, 7);
    onChange(v);
  }
  function handleBlur() {
    if (value && value !== 'NA') { const n = normalizeExp(value); if (n !== value) onChange(n); }
  }
  return (
    <div>
      {label && <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{label}</label>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={value === 'NA' ? 'NA' : value} onChange={handle} onBlur={handleBlur} placeholder="MM/YYYY" maxLength={7} inputMode="numeric" disabled={value === 'NA'} style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 17, letterSpacing: '0.06em', opacity: value === 'NA' ? 0.5 : 1 }} />
        <button onClick={() => onChange(value === 'NA' ? '' : 'NA')} style={{ padding: '0 14px', borderRadius: 'var(--radius-sm)', border: `1px solid ${value === 'NA' ? '#1a1a1a' : 'var(--color-border)'}`, background: value === 'NA' ? '#1a1a1a' : 'var(--color-bg-secondary)', color: value === 'NA' ? '#fff' : 'var(--color-text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: 12, fontFamily: 'var(--font)', flexShrink: 0 }}>N/A</button>
      </div>
    </div>
  );
}

function PackagingSelector({ value, onChange }) {
  const colors = {
    bulk_bottle: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
    unit_dose:   { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
    vial:        { bg: '#fdf4ff', text: '#7e22ce', border: '#e9d5ff' },
    multi_dose:  { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
    each:        { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' },
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 8 }}>Packaging type</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {PACKAGING.map(opt => {
          const sel = value === opt.value; const c = colors[opt.value] || {};
          return (
            <button key={opt.value} onClick={() => onChange(opt.value)} style={{ padding: '9px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left', background: sel ? c.bg : 'var(--color-bg-secondary)', border: sel ? `2px solid ${c.border}` : '1px solid var(--color-border)', color: sel ? c.text : 'var(--color-text-secondary)' }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{opt.label}</div>
              <div style={{ fontSize: 10, marginTop: 1, opacity: 0.8 }}>{opt.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SmartCamera({ onPhotoCapture, onManual }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr]     = useState(null);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().then(() => setReady(true)).catch(() => {}); }
      }).catch(() => setErr('Camera unavailable — check permissions'));
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  function capturePhoto() {
    if (!videoRef.current || !ready) return;
    const c = document.createElement('canvas');
    c.width = videoRef.current.videoWidth; c.height = videoRef.current.videoHeight;
    c.getContext('2d').drawImage(videoRef.current, 0, 0);
    streamRef.current?.getTracks().forEach(t => t.stop());
    onPhotoCapture(c.toDataURL('image/jpeg', 0.88).split(',')[1]);
  }

  if (err) return (
    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)', fontSize: 13 }}>
      {err}
      {onManual && <><br/><br/><button onClick={onManual} style={{ ...btnS, padding: '10px 20px' }}>Enter manually</button></>}
    </div>
  );

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 12, background: '#000', minHeight: 260 }}>
        <video ref={videoRef} style={{ width: '100%', display: 'block', maxHeight: 360, objectFit: 'cover' }} playsInline muted />
        {ready && <>
          <div style={{ position: 'absolute', inset: '18%', border: '2px solid rgba(255,255,255,0.8)', borderRadius: 10, pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
          <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', fontSize: 12, color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '5px 16px', borderRadius: 20, whiteSpace: 'nowrap' }}>Aim at the label</div>
        </>}
        {!ready && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Starting camera...</span></div>}
      </div>
      <button onClick={capturePhoto} disabled={!ready} style={{ ...btnG, width: '100%', opacity: ready ? 1 : 0.5, fontSize: 15, marginBottom: 10 }}>📷 Capture Label</button>
      {onManual && <button onClick={onManual} style={{ ...btnS, width: '100%', fontSize: 13 }}>✏️ Enter manually</button>}
    </div>
  );
}

function LiveScanner({ library, onConfirm, onManual }) {
  const videoRef    = useRef(null);
  const streamRef   = useRef(null);
  const prevDataRef = useRef(null);
  const stableRef   = useRef(null);
  const readingRef  = useRef(false);
  const [ready,    setReady]   = useState(false);
  const [err,      setErr]     = useState(null);
  const [status,   setStatus]  = useState('aim'); // aim | stable | reading
  const [result,   setResult]  = useState(null);
  const [captured, setCaptured]= useState(null);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().then(() => setReady(true)).catch(() => {}); }
      }).catch(() => setErr('Camera unavailable — check permissions'));
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()); if (stableRef.current) clearTimeout(stableRef.current); };
  }, []);

  useEffect(() => {
    if (!ready || result) return;
    const dc = document.createElement('canvas'); dc.width = 160; dc.height = 90;
    const dctx = dc.getContext('2d');

    async function captureAndScan() {
      if (readingRef.current) return;
      readingRef.current = true;
      setStatus('reading');
      const video = videoRef.current;
      if (!video) { readingRef.current = false; return; }
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
      try {
        const data = await api.quickscan(b64, library);
        setCaptured(b64);
        setResult(data);
      } catch { setStatus('aim'); }
      readingRef.current = false;
    }

    const interval = setInterval(() => {
      if (readingRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      dctx.drawImage(video, 0, 0, 160, 90);
      const pixels = dctx.getImageData(0, 0, 160, 90).data;
      let moving = false;
      if (prevDataRef.current) {
        let diff = 0;
        for (let i = 0; i < pixels.length; i += 4)
          diff += Math.abs(pixels[i]-prevDataRef.current[i]) + Math.abs(pixels[i+1]-prevDataRef.current[i+1]) + Math.abs(pixels[i+2]-prevDataRef.current[i+2]);
        moving = diff / (160 * 90) > 15;
      }
      prevDataRef.current = new Uint8ClampedArray(pixels);
      if (moving) {
        if (stableRef.current) { clearTimeout(stableRef.current); stableRef.current = null; }
        setStatus('aim');
      } else if (!stableRef.current) {
        setStatus('stable');
        stableRef.current = setTimeout(() => { stableRef.current = null; captureAndScan(); }, 600);
      }
    }, 150);

    return () => { clearInterval(interval); if (stableRef.current) { clearTimeout(stableRef.current); stableRef.current = null; } };
  }, [ready, result, library]);

  function confirm() { streamRef.current?.getTracks().forEach(t => t.stop()); onConfirm(result, captured); }
  function rescan()  { setResult(null); setCaptured(null); setStatus('aim'); prevDataRef.current = null; }

  if (err) return (
    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)', fontSize: 13 }}>
      {err}{onManual && <><br/><br/><button onClick={onManual} style={{ ...btnS, padding: '10px 20px' }}>Enter manually</button></>}
    </div>
  );

  const hint = status === 'reading' ? '🤖 Reading...' : status === 'stable' ? '⏳ Hold steady...' : '🔍 Aim at the label';

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#000', minHeight: 320 }}>
        <video ref={videoRef} style={{ width: '100%', display: 'block', maxHeight: 420, objectFit: 'cover' }} playsInline muted />
        {ready && !result && (
          <>
            <div style={{ position: 'absolute', inset: '20% 10%', border: `2px solid ${status === 'stable' ? '#6ee7a0' : 'rgba(255,255,255,0.7)'}`, borderRadius: 10, pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)', transition: 'border-color 0.2s' }} />
            <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', fontSize: 13, color: '#fff', background: 'rgba(0,0,0,0.65)', padding: '6px 18px', borderRadius: 20, whiteSpace: 'nowrap' }}>{hint}</div>
          </>
        )}
        {!ready && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Starting camera...</span></div>}
        {result && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.88)', padding: '16px 16px 20px' }}>
            <div style={{ color: result.matchedId ? '#6ee7a0' : '#fbbf24', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{result.matchedId ? '✓ Found in library' : '⚠ Not in library'}</div>
            <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: result.expiration ? 4 : 12 }}>{result.matchedName || 'Unknown item'}</div>
            {result.expiration && <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginBottom: 12 }}>Exp: {result.expiration}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirm} style={{ flex: 2, padding: '11px', background: '#1d6b3a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font)' }}>✓ That's it</button>
              <button onClick={rescan}   style={{ flex: 1, padding: '11px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)' }}>↺ Rescan</button>
            </div>
          </div>
        )}
      </div>
      {onManual && !result && <button onClick={onManual} style={{ ...btnS, width: '100%', marginTop: 10, fontSize: 13 }}>✏️ Enter manually</button>}
    </div>
  );
}

function MultiPhotoScanner({ onPhotosCapture, initialPhotos = [] }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr]     = useState(null);
  const [photos, setPhotos] = useState(initialPhotos);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().then(() => setReady(true)); }
      }).catch(() => setErr('Camera unavailable'));
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  function capturePhoto() {
    if (!videoRef.current || !ready) return;
    const c = document.createElement('canvas');
    c.width = videoRef.current.videoWidth; c.height = videoRef.current.videoHeight;
    c.getContext('2d').drawImage(videoRef.current, 0, 0);
    setPhotos(prev => [...prev, c.toDataURL('image/jpeg', 0.88).split(',')[1]]);
  }

  function removePhoto(i) { setPhotos(prev => prev.filter((_, idx) => idx !== i)); }

  function submitPhotos() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    onPhotosCapture(photos);
  }

  if (err) return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)', fontSize: 13 }}>{err}</div>;

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 12, background: '#000', minHeight: 220 }}>
        <video ref={videoRef} style={{ width: '100%', display: 'block', maxHeight: 300, objectFit: 'cover' }} playsInline muted />
        {ready && <>
          <div style={{ position: 'absolute', inset: '15%', border: '2px solid rgba(255,255,255,0.8)', borderRadius: 10, pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
          <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '4px 14px', borderRadius: 20, whiteSpace: 'nowrap' }}>
            Photo {photos.length + 1} — {photos.length === 0 ? 'aim at drug name' : photos.length === 1 ? 'aim at expiration date' : 'any other detail'}
          </div>
        </>}
        {!ready && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Starting camera...</span></div>}
      </div>

      <button onClick={capturePhoto} disabled={!ready || photos.length >= 3} style={{ ...btnG, width: '100%', marginBottom: 10, opacity: ready && photos.length < 3 ? 1 : 0.5 }}>
        📷 Capture photo {photos.length + 1} {photos.length === 0 ? '— drug name' : photos.length === 1 ? '— expiration date' : '— any detail'}
      </button>
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
              <img src={`data:image/jpeg;base64,${p}`} alt="" style={{ width: 72, height: 72, objectFit: 'cover' }} />
              <button onClick={() => removePhoto(i)} style={{ position: 'absolute', top: 2, right: 2, background: '#dc2626', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11 }}>×</button>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, textAlign: 'center', padding: '2px' }}>
                {i === 0 ? 'Name' : i === 1 ? 'Exp date' : 'Detail'}
              </div>
            </div>
          ))}
          {photos.length < 3 && (
            <div style={{ width: 72, height: 72, borderRadius: 8, border: '2px dashed var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontSize: 22 }}>+</div>
          )}
        </div>
      )}
      {photos.length > 0 && (
        <button onClick={submitPhotos} style={{ ...btnP, width: '100%' }}>
          ✓ Read {photos.length} photo{photos.length !== 1 ? 's' : ''} with AI
        </button>
      )}
      {photos.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', marginTop: 6 }}>
          Take up to 3 photos — drug name, expiration date, any other detail
        </div>
      )}
    </div>
  );
}

function HomeView({ library, stock, locations, categories, navigate, onSaveStock }) {
  const [alertModal, setAlertModal] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const active      = stock.filter(s => s.status === 'active');
  const validActive = active.filter(s => library.find(d => d.id === s.libraryId));
  const expired     = validActive.filter(s => getStatus(s.expiration).type === 'expired');
  const thisMonth   = validActive.filter(s => getStatus(s.expiration).type === 'soon');
  const soon90      = validActive.filter(s => getStatus(s.expiration).type === 'watch');
  const belowPar    = library.filter(item => {
    const totalPar = (item.sfotPar||0) + (item.hhaPar||0);
    if (item.status === 'inactive' || !totalPar) return false;
    const usable = validActive.filter(s => s.libraryId === item.id && getStatus(s.expiration).type !== 'expired').length;
    return usable < totalPar;
  });
  const needsAttention = library.filter(d => d.status !== 'inactive').map(drug => {
    const ds = validActive.filter(s => s.libraryId === drug.id);
    const expiredCount = ds.filter(s => getStatus(s.expiration).type === 'expired').length;
    const soonCount    = ds.filter(s => getStatus(s.expiration).type === 'soon').length;
    return { drug, expiredCount, soonCount };
  }).filter(({ expiredCount, soonCount }) => expiredCount > 0 || soonCount > 0)
    .sort((a, b) => b.expiredCount - a.expiredCount);

  function getAlertItems(type) {
    const entries = type === 'expired' ? expired : type === 'soon' ? thisMonth : soon90;
    const grouped = {};
    entries.forEach(s => {
      const item = library.find(d => d.id === s.libraryId); if (!item) return;
      if (!grouped[item.id]) grouped[item.id] = { item, entries: [] };
      grouped[item.id].entries.push(s);
    });
    return Object.values(grouped);
  }

  const alertLabels = {
    expired: { title: 'Expired Items',          color: 'var(--color-danger-text)',  border: 'var(--color-danger-border)',  bg: 'var(--color-danger-bg)' },
    soon:    { title: 'Expiring This Month',     color: 'var(--color-warning-text)', border: 'var(--color-warning-border)', bg: 'var(--color-warning-bg)' },
    watch:   { title: 'Expiring Within 90 Days', color: 'var(--color-watch-text)',   border: 'var(--color-watch-border)',   bg: 'var(--color-watch-bg)' },
  };

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ padding: '20px 20px 0', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 3 }}>🚑 EMS Inventory</h1>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{library.filter(d => d.status !== 'inactive').length} items · {validActive.length} units tracked</div>
          </div>
          <button onClick={() => navigate('settings')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--color-text-secondary)' }}>⚙️</button>
        </div>
      </div>

      <div style={{ padding: '0 20px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'Expired',        count: new Set(expired.map(s => s.libraryId)).size,  units: expired.length,   type: 'expired' },
          { label: 'This month',     count: new Set(thisMonth.map(s => s.libraryId)).size, units: thisMonth.length, type: 'soon' },
          { label: 'Within 90 days', count: new Set(soon90.map(s => s.libraryId)).size,   units: soon90.length,    type: 'watch' },
        ].map(({ label, count, units, type }) => {
          const s = SS[type]; const hasAny = count > 0;
          return (
            <div key={type} onClick={() => hasAny && setAlertModal(type)} style={{ background: hasAny ? s.bg : 'var(--color-bg-secondary)', border: hasAny ? `1.5px solid ${s.border}` : '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 8px', textAlign: 'center', cursor: hasAny ? 'pointer' : 'default' }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: hasAny ? s.text : 'var(--color-text)', marginBottom: 1 }}>{count}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: hasAny ? s.text : 'var(--color-text-tertiary)', marginBottom: 1 }}>{label}</div>
              <div style={{ fontSize: 10, color: hasAny ? s.text : 'var(--color-text-tertiary)', opacity: 0.75 }}>{units} unit{units !== 1 ? 's' : ''}</div>
              {hasAny && <div style={{ fontSize: 9, color: s.text, marginTop: 3, opacity: 0.7 }}>tap to view ↗</div>}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '0 20px' }}>
        {belowPar.length > 0 && (
          <div style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)', borderRadius: 'var(--radius-lg)', padding: '12px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-warning-text)' }}>📦 {belowPar.length} item{belowPar.length !== 1 ? 's' : ''} below par</div>
              <div style={{ fontSize: 11, color: 'var(--color-warning-text)', opacity: 0.8, marginTop: 2 }}>Order report recommended</div>
            </div>
            <button onClick={() => navigate('orderreport')} style={{ ...btnS, padding: '7px 12px', fontSize: 12 }}>View report</button>
          </div>
        )}
        <button onClick={() => navigate('orderreport')} style={{ ...btnS, width: '100%', marginBottom: 20 }}>📋 Generate Order Report</button>
        {needsAttention.length > 0 ? (
          <>
            <SectionHeader title="Needs Attention" />
            {needsAttention.map(({ drug, expiredCount, soonCount }) => {
              const cat = categories.find(c => c.id === drug.category);
              return (
                <div key={drug.id} onClick={() => navigate('drugdetail', { libraryId: drug.id })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', marginBottom: 8, cursor: 'pointer' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {drug.profilePhoto ? <img src={`data:image/jpeg;base64,${drug.profilePhoto}`} alt="" style={{ width: 44, height: 44, objectFit: 'cover' }} /> : <span style={{ fontSize: 22 }}>{cat?.icon || '📦'}</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{drug.name}</div>
                    <div style={{ fontSize: 12 }}>
                      {expiredCount > 0 && <span style={{ color: 'var(--color-danger-text)', fontWeight: 500 }}>{expiredCount} expired</span>}
                      {expiredCount > 0 && soonCount > 0 && <span style={{ color: 'var(--color-text-tertiary)' }}> · </span>}
                      {soonCount > 0 && <span style={{ color: 'var(--color-warning-text)', fontWeight: 500 }}>{soonCount} expiring this month</span>}
                    </div>
                  </div>
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: 18 }}>›</span>
                </div>
              );
            })}
          </>
        ) : library.filter(d => d.status !== 'inactive').length > 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-success-text)' }}>All stock is good</div>
          </div>
        ) : (
          <EmptyState icon="💊" title="No items yet" subtitle="Use Quick Receive to scan your first item" action={<button onClick={() => navigate('quickreceive')} style={{ ...btnG, padding: '10px 20px' }}>Quick Receive</button>} />
        )}
      </div>

      {alertModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ width: '100%', maxWidth: 680, margin: '0 auto', background: 'var(--color-bg)', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: alertLabels[alertModal].color }}>{alertLabels[alertModal].title}</div>
              <button onClick={() => setAlertModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, color: 'var(--color-text-tertiary)' }}>×</button>
            </div>
            {getAlertItems(alertModal).map(({ item, entries }) => {
              const cat    = categories.find(c => c.id === item.category);
              const sorted = [...entries].sort((a, b) => { const da = parseExp(a.expiration), db = parseExp(b.expiration); if (!da && !db) return 0; if (!da) return 1; if (!db) return -1; return da - db; });
              return (
                <div key={item.id} style={{ marginBottom: 12 }}>
                  <div onClick={() => { setAlertModal(null); navigate('drugdetail', { libraryId: item.id }); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: alertLabels[alertModal].bg, border: `1px solid ${alertLabels[alertModal].border}`, borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', borderBottom: 'none', cursor: 'pointer' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {item.profilePhoto ? <img src={`data:image/jpeg;base64,${item.profilePhoto}`} alt="" style={{ width: 36, height: 36, objectFit: 'cover' }} /> : <span style={{ fontSize: 18 }}>{cat?.icon || '📦'}</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                      <div style={{ fontSize: 12, color: alertLabels[alertModal].color }}>{entries.length} unit{entries.length !== 1 ? 's' : ''} affected</div>
                    </div>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>›</span>
                  </div>
                  {sorted.map((entry, i) => {
                    const st = getStatus(entry.expiration); const es = SS[st.type];
                    const loc = locations.find(l => l.id === entry.locationId);
                    return (
                      <div key={entry.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', background: 'var(--color-bg)', border: `1px solid ${es.border}`, borderTop: 'none', borderRadius: i === sorted.length - 1 ? '0 0 var(--radius-lg) var(--radius-lg)' : '0' }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{entry.expiration === 'NA' ? 'N/A' : entry.expiration || '—'}</span>
                          {loc && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>📍 {loc.name}</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Badge type={st.type} label={st.label} />
                          <button onClick={() => setEditingEntry(entry)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: 14, lineHeight: 1 }}>✏️</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {editingEntry && (
        <EditExpirationModal
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSave={exp => { onSaveStock(stock.map(s => s.id === editingEntry.id ? { ...s, expiration: exp || 'NA' } : s)); setEditingEntry(null); }}
        />
      )}
    </div>
  );
}

function LocationsView({ locations, library, stock, categories, navigate }) {
  const active = stock.filter(s => s.status === 'active');
  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ padding: '16px 20px 0', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Locations</h2>
        <button onClick={() => navigate('settings')} style={{ ...btnP, padding: '7px 14px', fontSize: 13 }}>+ Add</button>
      </div>
      <div style={{ padding: '0 20px' }}>
        {locations.map(loc => {
          const locStock  = active.filter(s => s.locationId === loc.id);
          const worst     = worstStatus(locStock); const ws = SS[worst];
          const hasIssue  = worst === 'expired' || worst === 'soon';
          const expCount  = locStock.filter(s => getStatus(s.expiration).type === 'expired').length;
          const soonCount = locStock.filter(s => getStatus(s.expiration).type === 'soon').length;
          return (
            <div key={loc.id} onClick={() => navigate('locationdetail', { locationId: loc.id })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', background: 'var(--color-bg)', border: hasIssue ? `1.5px solid ${ws.border}` : '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', marginBottom: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 24 }}>{loc.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>{loc.name}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  <span style={{ fontWeight: 600, color: hasIssue ? ws.text : 'var(--color-text)' }}>{locStock.length} unit{locStock.length !== 1 ? 's' : ''}</span>
                  {expCount > 0 && <span style={{ color: 'var(--color-danger-text)', fontWeight: 500 }}> · {expCount} expired</span>}
                  {soonCount > 0 && <span style={{ color: 'var(--color-warning-text)', fontWeight: 500 }}> · {soonCount} this month</span>}
                  {locStock.length === 0 && <span style={{ color: 'var(--color-text-tertiary)' }}> · empty</span>}
                </div>
              </div>
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: 18 }}>›</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LocationDetailView({ locationId, locations, library, stock, categories, navigate, onSaveStock }) {
  const loc = locations.find(l => l.id === locationId);
  const [activeTab, setActiveTab] = useState(null);
  const [movingItem, setMovingItem] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [moveQty, setMoveQty]     = useState(1);
  const [moveTo, setMoveTo]       = useState('');
  if (!loc) return null;
  const active     = stock.filter(s => s.status === 'active' && s.locationId === locationId);
  const tabs       = categories.filter(cat => active.some(s => { const item = library.find(i => i.id === s.libraryId); return item?.category === cat.id; }));
  const displayTab = activeTab || tabs[0]?.id;
  const grouped    = {};
  active.forEach(s => {
    const item = library.find(i => i.id === s.libraryId); if (!item) return;
    if (!grouped[item.id]) grouped[item.id] = { item, entries: [] };
    grouped[item.id].entries.push(s);
  });
  function handleMove() {
    if (!moveTo || !movingItem) return;
    onSaveStock(fifoMove(stock, movingItem.id, moveQty, locationId, moveTo));
    setMovingItem(null);
  }
  return (
    <div style={{ paddingBottom: 20 }}>
      <TopBar title={loc.name} subtitle={`${active.length} units`} onBack={() => navigate('locations')} right={<button onClick={() => navigate('addstock', { locationId })} style={{ ...btnG, padding: '7px 14px', fontSize: 13 }}>+ Add stock</button>} />
      {tabs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '0 20px', overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
          {tabs.map(cat => <button key={cat.id} onClick={() => setActiveTab(cat.id)} style={{ flexShrink: 0, padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', fontWeight: displayTab === cat.id ? 600 : 400, background: displayTab === cat.id ? 'var(--color-text)' : 'transparent', color: displayTab === cat.id ? 'var(--color-bg)' : 'var(--color-text-secondary)', border: displayTab === cat.id ? 'none' : '1px solid var(--color-border)', fontFamily: 'var(--font)' }}>{cat.icon} {cat.name}</button>)}
        </div>
      )}
      <div style={{ padding: '0 20px' }}>
        {active.length === 0 && <EmptyState icon="📦" title="No stock here" subtitle="Add stock or move items from another location" />}
        {Object.values(grouped).filter(({ item }) => !displayTab || item.category === displayTab).map(({ item, entries }) => {
          const worst = worstStatus(entries); const ws = SS[worst]; const hasIssue = worst === 'expired' || worst === 'soon';
          const cat   = categories.find(c => c.id === item.category);
          const sorted = [...entries].sort((a, b) => { const da = parseExp(a.expiration), db = parseExp(b.expiration); if (!da && !db) return 0; if (!da) return 1; if (!db) return -1; return da - db; });
          return (
            <div key={item.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'var(--color-bg)', border: hasIssue ? `1.5px solid ${ws.border}` : '1px solid var(--color-border)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', borderBottom: 'none' }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.profilePhoto ? <img src={`data:image/jpeg;base64,${item.profilePhoto}`} alt="" style={{ width: 36, height: 36, objectFit: 'cover' }} /> : <span style={{ fontSize: 18 }}>{cat?.icon || '📦'}</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{entries.length} unit{entries.length !== 1 ? 's' : ''}</div>
                </div>
                <button onClick={() => setMovingItem(item)} style={{ ...btnS, padding: '5px 12px', fontSize: 12 }}>Move</button>
              </div>
              {sorted.map((entry, i) => {
                const st = getStatus(entry.expiration); const es = SS[st.type];
                return (
                  <div key={entry.id} style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', background: 'var(--color-bg)', border: `1px solid ${es.border}`, borderTop: 'none', borderRadius: i === entries.length - 1 ? '0 0 var(--radius-lg) var(--radius-lg)' : '0' }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{entry.expiration === 'NA' ? 'N/A' : entry.expiration || '—'}</span>
                      {entry.lot && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>Lot: {entry.lot}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Badge type={st.type} label={st.label} />
                      <button onClick={() => setEditingEntry(entry)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: 14, lineHeight: 1 }}>✏️</button>
                      <button onClick={() => { if (window.confirm('Pull this unit?')) onSaveStock(stock.map(s => s.id === entry.id ? { ...s, status: 'pulled', pulledAt: new Date().toISOString() } : s)); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: 18, lineHeight: 1 }}>×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {editingEntry && (
        <EditExpirationModal
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSave={exp => { onSaveStock(stock.map(s => s.id === editingEntry.id ? { ...s, expiration: exp || 'NA' } : s)); setEditingEntry(null); }}
        />
      )}
      {movingItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ width: '100%', maxWidth: 680, margin: '0 auto', background: 'var(--color-bg)', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Move {movingItem.name}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>FIFO — oldest expiration moves first</div>
            <Field label="How many?">
              <div style={{ display: 'flex', gap: 8 }}>
                {[1,2,3,4,5].map(n => <button key={n} onClick={() => setMoveQty(n)} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-md)', border: moveQty === n ? 'none' : '1px solid var(--color-border)', background: moveQty === n ? '#1a1a1a' : 'var(--color-bg-secondary)', color: moveQty === n ? '#fff' : 'var(--color-text)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>{n}</button>)}
              </div>
            </Field>
            <Field label="Move to">
              <select value={moveTo} onChange={e => setMoveTo(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 15, fontFamily: 'var(--font)' }}>
                <option value="">Select location...</option>
                {locations.filter(l => l.id !== locationId).map(l => <option key={l.id} value={l.id}>{l.icon} {l.name}</option>)}
              </select>
            </Field>
            <button onClick={handleMove} disabled={!moveTo} style={{ ...btnP, width: '100%', marginBottom: 10, opacity: moveTo ? 1 : 0.45 }}>Move {moveQty} unit{moveQty !== 1 ? 's' : ''} (FIFO)</button>
            <button onClick={() => setMovingItem(null)} style={{ ...btnS, width: '100%' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MapView({ locations, library, stock, categories, mapData, navigate, onSaveMap, onSaveLocations }) {
  const [editing, setEditing]           = useState(false);
  const [map, setMap]                   = useState(mapData || { rooms: [], pins: [], lines: [], doors: [], bgImage: null });
  const [dragItem, setDragItem]         = useState(null);
  const [selectedPin, setSelectedPin]   = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedLine, setSelectedLine] = useState(null);
  const [selectedDoor, setSelectedDoor] = useState(null);
  const [history, setHistory]           = useState([]);
  const [tool, setTool]                 = useState('select');
  const [drawingLine, setDrawingLine]   = useState(null);
  const [addLocModal, setAddLocModal]   = useState(false);
  const [newLocName, setNewLocName]     = useState('');
  const [newLocIcon, setNewLocIcon]     = useState('📦');
  const LOC_ICONS = ['📦','🎒','🛒','🚑','🏥','💊','🧰','🗄️','🚪','⬜'];
  const canvasRef = useRef(null);
  const fileRef   = useRef(null);
  const active    = stock.filter(s => s.status === 'active');

  useEffect(() => { if (mapData) setMap(m => ({ rooms:[], pins:[], lines:[], doors:[], ...mapData })); }, []);
  function pushHistory(m) { setHistory(prev => [...prev.slice(-29), JSON.stringify(m)]); }
  function updateMap(updated) { pushHistory(map); setMap(updated); onSaveMap(updated); }
  function undo() { if (!history.length) return; const prev = JSON.parse(history[history.length-1]); setHistory(h=>h.slice(0,-1)); setMap(prev); onSaveMap(prev); }
  function clearAll() { if (!window.confirm('Clear the entire map?')) return; const c={rooms:[],pins:[],lines:[],doors:[],bgImage:null}; setHistory([]); setMap(c); onSaveMap(c); setSelectedRoom(null); setSelectedPin(null); setSelectedLine(null); setSelectedDoor(null); }
  function addRoom() { const r={id:uid(),name:'New Room',x:60,y:60,w:220,h:160,color:'#e2e8f0'}; updateMap({...map,rooms:[...(map.rooms||[]),r]}); setSelectedRoom(r.id); setTool('select'); }
  function addPin(locId) { const pins=map.pins||[]; if(pins.find(p=>p.locationId===locId))return; updateMap({...map,pins:[...pins,{id:uid(),locationId:locId,x:150,y:150}]}); }
  function deleteSelected() { if(selectedRoom){updateMap({...map,rooms:(map.rooms||[]).filter(r=>r.id!==selectedRoom)});setSelectedRoom(null);} if(selectedLine){updateMap({...map,lines:(map.lines||[]).filter(l=>l.id!==selectedLine)});setSelectedLine(null);} if(selectedDoor){updateMap({...map,doors:(map.doors||[]).filter(d=>d.id!==selectedDoor)});setSelectedDoor(null);} }
  function getCanvasPos(e) { const rect=canvasRef.current.getBoundingClientRect(); return {x:e.clientX-rect.left,y:e.clientY-rect.top}; }
  function handleCanvasMouseDown(e) {
    if (!editing) return;
    const pos=getCanvasPos(e);
    if(tool==='line'){setDrawingLine({x1:pos.x,y1:pos.y,x2:pos.x,y2:pos.y});return;}
    if(tool==='door'){updateMap({...map,doors:[...(map.doors||[]),{id:uid(),x:pos.x,y:pos.y,rotation:0,size:40}]});setTool('select');return;}
    if(e.target===canvasRef.current||e.target.tagName==='IMG'){setSelectedRoom(null);setSelectedLine(null);setSelectedDoor(null);}
  }
  function handleCanvasMouseMove(e) {
    if (!editing) return;
    const pos=getCanvasPos(e);
    if(drawingLine){setDrawingLine(l=>({...l,x2:pos.x,y2:pos.y}));return;}
    if(!dragItem)return;
    const dx=e.clientX-dragItem.startMouseX;const dy=e.clientY-dragItem.startMouseY;
    if(dragItem.type==='room-move') setMap(m=>({...m,rooms:(m.rooms||[]).map(r=>r.id===dragItem.id?{...r,x:Math.max(0,dragItem.startX+dx),y:Math.max(0,dragItem.startY+dy)}:r)}));
    else if(dragItem.type==='room-resize') setMap(m=>({...m,rooms:(m.rooms||[]).map(r=>r.id===dragItem.id?{...r,w:Math.max(80,dragItem.startW+dx),h:Math.max(60,dragItem.startH+dy)}:r)}));
    else if(dragItem.type==='pin') setMap(m=>({...m,pins:(m.pins||[]).map(p=>p.id===dragItem.id?{...p,x:Math.max(0,dragItem.startX+dx),y:Math.max(0,dragItem.startY+dy)}:p)}));
    else if(dragItem.type==='door') setMap(m=>({...m,doors:(m.doors||[]).map(d=>d.id===dragItem.id?{...d,x:Math.max(0,dragItem.startX+dx),y:Math.max(0,dragItem.startY+dy)}:d)}));
    else if(dragItem.type==='line-p1') setMap(m=>({...m,lines:(m.lines||[]).map(l=>l.id===dragItem.id?{...l,x1:pos.x,y1:pos.y}:l)}));
    else if(dragItem.type==='line-p2') setMap(m=>({...m,lines:(m.lines||[]).map(l=>l.id===dragItem.id?{...l,x2:pos.x,y2:pos.y}:l)}));
  }
  function handleCanvasMouseUp() {
    if(drawingLine){const len=Math.hypot(drawingLine.x2-drawingLine.x1,drawingLine.y2-drawingLine.y1);if(len>10)updateMap({...map,lines:[...(map.lines||[]),{id:uid(),...drawingLine,thickness:6,color:'#334155'}]});setDrawingLine(null);return;}
    if(dragItem){pushHistory(mapData||{rooms:[],pins:[],lines:[],doors:[],bgImage:null});onSaveMap(map);setDragItem(null);}
  }
  function startDrag(e,type,id) { if(!editing)return;e.preventDefault();e.stopPropagation();const item=type.startsWith('room')?(map.rooms||[]).find(r=>r.id===id):type==='pin'?(map.pins||[]).find(p=>p.id===id):(map.doors||[]).find(d=>d.id===id);setDragItem({type,id,startMouseX:e.clientX,startMouseY:e.clientY,startX:item?.x||0,startY:item?.y||0,startW:item?.w||0,startH:item?.h||0}); }
  function startLineDrag(e,type,id) { if(!editing)return;e.preventDefault();e.stopPropagation();setDragItem({type,id,startMouseX:e.clientX,startMouseY:e.clientY}); }

  useEffect(() => {
    function handleKey(e) {
      if(!editing)return;
      if((e.key==='Delete'||e.key==='Backspace')&&e.target.tagName!=='INPUT')deleteSelected();
      if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();undo();}
      if(e.key==='Escape'){setTool('select');setDrawingLine(null);setSelectedRoom(null);setSelectedLine(null);setSelectedDoor(null);}
    }
    window.addEventListener('keydown',handleKey);
    return ()=>window.removeEventListener('keydown',handleKey);
  },[editing,selectedRoom,selectedLine,selectedDoor,history,map]);

  async function handleBgUpload(e) { const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async ev=>{const resized=await resizeImage(ev.target.result.split(',')[1],1400);updateMap({...map,bgImage:resized});};reader.readAsDataURL(file); }

  const selectedLocObj=selectedPin?locations.find(l=>l.id===selectedPin):null;
  const selectedStock=selectedLocObj?active.filter(s=>s.locationId===selectedLocObj.id):[];
  const selectedGrouped={};
  selectedStock.forEach(s=>{const item=library.find(i=>i.id===s.libraryId);if(!item)return;if(!selectedGrouped[item.id])selectedGrouped[item.id]={item,entries:[]};selectedGrouped[item.id].entries.push(s);});

  const ROOM_COLORS=['#e2e8f0','#dbeafe','#dcfce7','#fef9c3','#fce7f3','#ede9fe','#ffedd5','#fee2e2'];
  const SVG_W=2000;const SVG_H=1400;

  return (
    <div style={{display:'flex',height:'calc(100vh - 60px)',overflow:'hidden',flexDirection:'column'}}>
      <div style={{background:'var(--color-bg)',borderBottom:'1px solid var(--color-border)',padding:'8px 14px',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',flexShrink:0}}>
        <button onClick={()=>{setEditing(e=>!e);setTool('select');setSelectedRoom(null);setSelectedLine(null);setSelectedDoor(null);setDrawingLine(null);}} style={{...editing?btnP:btnS,padding:'7px 14px',fontSize:12}}>{editing?'✓ Done':'✏️ Edit map'}</button>
        {editing&&<>
          <div style={{width:1,height:28,background:'var(--color-border)',margin:'0 4px'}}/>
          {[['select','↖ Select'],['line','📏 Line'],['door','🚪 Door']].map(([t,l])=><button key={t} onClick={()=>setTool(t)} style={{...tool===t?btnP:btnS,padding:'7px 12px',fontSize:12}}>{l}</button>)}
          <button onClick={addRoom} style={{...btnS,padding:'7px 12px',fontSize:12}}>🟦 Room</button>
          <select onChange={e=>{if(e.target.value){addPin(e.target.value);e.target.value='';}}} style={{padding:'7px 12px',borderRadius:'var(--radius-sm)',border:'1px solid var(--color-border)',background:'var(--color-bg)',color:'var(--color-text)',fontSize:12,fontFamily:'var(--font)'}}>
            <option value="">📍 Add pin...</option>
            {locations.filter(l=>!(map.pins||[]).find(p=>p.locationId===l.id)).map(l=><option key={l.id} value={l.id}>{l.icon} {l.name}</option>)}
          </select>
          <button onClick={()=>{setNewLocName('');setNewLocIcon('📦');setAddLocModal(true);}} style={{...btnS,padding:'7px 12px',fontSize:12}}>➕ New location</button>
          <button onClick={()=>fileRef.current?.click()} style={{...btnS,padding:'7px 12px',fontSize:12}}>🖼 Floor plan</button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleBgUpload} style={{display:'none'}}/>
          <div style={{width:1,height:28,background:'var(--color-border)',margin:'0 4px'}}/>
          {history.length>0&&<button onClick={undo} style={{...btnS,padding:'7px 12px',fontSize:12}}>↩ Undo</button>}
          {(selectedRoom||selectedLine||selectedDoor)&&<button onClick={deleteSelected} style={{...btnS,padding:'7px 12px',fontSize:12,color:'var(--color-danger-text)',borderColor:'var(--color-danger-border)'}}>🗑 Delete</button>}
          {(map.rooms?.length>0||map.pins?.length>0||map.lines?.length>0||map.doors?.length>0)&&<button onClick={clearAll} style={{...btnS,padding:'7px 12px',fontSize:12,color:'var(--color-danger-text)',borderColor:'var(--color-danger-border)'}}>✕ Clear all</button>}
        </>}
      </div>
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        <div ref={canvasRef} style={{flex:1,overflow:'auto',position:'relative',background:'var(--color-bg)',cursor:tool==='line'?'crosshair':tool==='door'?'copy':'default'}}
          onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMouseMove} onMouseUp={handleCanvasMouseUp}>
          <svg width={SVG_W} height={SVG_H} style={{position:'absolute',top:0,left:0,pointerEvents:'none'}}>
            {map.bgImage&&<image href={`data:image/jpeg;base64,${map.bgImage}`} x={0} y={0} width={SVG_W} height={SVG_H} preserveAspectRatio="xMidYMid meet" opacity={0.5}/>}
            {editing&&<g opacity={0.08}>{Array.from({length:Math.ceil(SVG_W/40)},(_,i)=><line key={`v${i}`} x1={i*40} y1={0} x2={i*40} y2={SVG_H} stroke="#94a3b8" strokeWidth={0.5}/>)}{Array.from({length:Math.ceil(SVG_H/40)},(_,i)=><line key={`h${i}`} x1={0} y1={i*40} x2={SVG_W} y2={i*40} stroke="#94a3b8" strokeWidth={0.5}/>)}</g>}
            {(map.lines||[]).map(line=>{const isSel=selectedLine===line.id;return<g key={line.id}><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={isSel?'#1a1a1a':line.color||'#334155'} strokeWidth={line.thickness||6} strokeLinecap="round" style={{cursor:editing?'pointer':'default',pointerEvents:'stroke'}} onClick={e=>{if(editing){e.stopPropagation();setSelectedLine(line.id);setSelectedRoom(null);setSelectedDoor(null);}}} />{editing&&isSel&&<><circle cx={line.x1} cy={line.y1} r={8} fill="#1a1a1a" stroke="#fff" strokeWidth={2} style={{cursor:'move',pointerEvents:'all'}} onMouseDown={e=>{e.stopPropagation();startLineDrag(e,'line-p1',line.id);}}/><circle cx={line.x2} cy={line.y2} r={8} fill="#1a1a1a" stroke="#fff" strokeWidth={2} style={{cursor:'move',pointerEvents:'all'}} onMouseDown={e=>{e.stopPropagation();startLineDrag(e,'line-p2',line.id);}}/></>}</g>;})}
            {drawingLine&&<line x1={drawingLine.x1} y1={drawingLine.y1} x2={drawingLine.x2} y2={drawingLine.y2} stroke="#1a1a1a" strokeWidth={6} strokeLinecap="round" strokeDasharray="8 4" opacity={0.6}/>}
            {(map.doors||[]).map(door=>{const isSel=selectedDoor===door.id;const s=door.size||40;return<g key={door.id} transform={`translate(${door.x},${door.y}) rotate(${door.rotation||0})`} style={{cursor:editing?'move':'default',pointerEvents:'all'}} onMouseDown={e=>{e.stopPropagation();startDrag(e,'door',door.id);setSelectedDoor(door.id);setSelectedRoom(null);setSelectedLine(null);}} onClick={e=>{if(editing){e.stopPropagation();setSelectedDoor(door.id);setSelectedRoom(null);setSelectedLine(null);}}}><rect x={-2} y={-2} width={s+4} height={8} fill={isSel?'#1a1a1a':'#475569'} rx={2}/><path d={`M 0 6 Q ${s/2} 6 ${s} ${s+6}`} fill="none" stroke={isSel?'#1a1a1a':'#475569'} strokeWidth={2} strokeDasharray="4 3"/><line x1={0} y1={6} x2={s} y2={6} stroke={isSel?'#1a1a1a':'#475569'} strokeWidth={3} strokeLinecap="round"/></g>;})}
          </svg>
          <div style={{position:'absolute',top:0,left:0,width:SVG_W,height:SVG_H}}>
            {(map.rooms||[]).map(room=>{const isSel=selectedRoom===room.id;return<div key={room.id} style={{position:'absolute',left:room.x,top:room.y,width:room.w,height:room.h,background:room.color+'bb',border:`${isSel?3:2}px solid ${isSel?'#1a1a1a':room.color}`,borderRadius:10,boxShadow:isSel?'0 0 0 3px rgba(0,0,0,0.18)':'none',userSelect:'none',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,cursor:editing?'move':'default'}} onMouseDown={e=>{if(editing){e.stopPropagation();setSelectedRoom(room.id);setSelectedLine(null);setSelectedDoor(null);startDrag(e,'room-move',room.id);}}} onClick={e=>{if(editing){e.stopPropagation();setSelectedRoom(room.id);}}}>
              {isSel&&editing?(<><input value={room.name} onChange={e=>setMap(m=>({...m,rooms:(m.rooms||[]).map(r=>r.id===room.id?{...r,name:e.target.value}:r)}))} onBlur={()=>onSaveMap(map)} onClick={e=>e.stopPropagation()} style={{background:'transparent',border:'none',textAlign:'center',fontWeight:700,fontSize:15,color:'#1e293b',outline:'none',width:'85%'}} autoFocus/><div style={{display:'flex',gap:4,flexWrap:'wrap',justifyContent:'center',padding:'0 8px'}}>{ROOM_COLORS.map(c=><div key={c} onClick={e=>{e.stopPropagation();updateMap({...map,rooms:(map.rooms||[]).map(r=>r.id===room.id?{...r,color:c}:r)});}} style={{width:16,height:16,borderRadius:'50%',background:c,border:`2px solid ${room.color===c?'#1a1a1a':'rgba(0,0,0,0.15)'}`,cursor:'pointer'}}/>)}</div></>):<span style={{fontWeight:700,fontSize:14,color:'#1e293b',textAlign:'center',padding:'0 8px'}}>{room.name}</span>}
              {editing&&<div onMouseDown={e=>{e.stopPropagation();startDrag(e,'room-resize',room.id);}} style={{position:'absolute',right:0,bottom:0,width:20,height:20,cursor:'se-resize',display:'flex',alignItems:'center',justifyContent:'center'}}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 10 L10 10 L10 2" stroke="#64748b" strokeWidth="2" fill="none" strokeLinecap="round"/><path d="M5 10 L10 10 L10 5" stroke="#64748b" strokeWidth="2" fill="none" strokeLinecap="round"/></svg></div>}
            </div>;})}
            {(map.pins||[]).map(pin=>{const loc=locations.find(l=>l.id===pin.locationId);if(!loc)return null;const locStock=active.filter(s=>s.locationId===loc.id);const worst=worstStatus(locStock);const ws=SS[worst];const hasIssue=worst==='expired'||worst==='soon';const isPanelOpen=selectedPin===loc.id;return<div key={pin.id} style={{position:'absolute',left:pin.x,top:pin.y,userSelect:'none',zIndex:20}} onMouseDown={e=>{if(editing){e.stopPropagation();startDrag(e,'pin',pin.id);}}} onClick={e=>{e.stopPropagation();if(!editing)setSelectedPin(loc.id===selectedPin?null:loc.id);}}>
              <div style={{background:hasIssue?ws.bg:'var(--color-bg)',border:`2px solid ${hasIssue?ws.border:isPanelOpen?'#1a1a1a':'var(--color-border)'}`,borderRadius:10,padding:'6px 10px',fontSize:12,fontWeight:600,whiteSpace:'nowrap',boxShadow:'0 2px 8px rgba(0,0,0,0.15)',display:'flex',alignItems:'center',gap:6,color:hasIssue?ws.text:'var(--color-text)',cursor:editing?'move':'pointer'}}>
                <span>{loc.icon}</span><span>{loc.name}</span><span style={{fontSize:11,opacity:0.75}}>({locStock.length})</span>
                {editing&&<button onClick={e=>{e.stopPropagation();updateMap({...map,pins:(map.pins||[]).filter(p=>p.id!==pin.id)});}} style={{background:'#dc2626',border:'none',color:'#fff',borderRadius:'50%',width:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontSize:11,marginLeft:2,flexShrink:0}}>×</button>}
              </div>
            </div>;})}
          </div>
          {!map.bgImage&&(map.rooms||[]).length===0&&(map.lines||[]).length===0&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10,color:'var(--color-text-tertiary)',pointerEvents:'none'}}><div style={{fontSize:48}}>🏗️</div><div style={{fontSize:14,fontWeight:500}}>{editing?'Use tools above to build your station map':'Click "Edit map" to get started'}</div></div>}
        </div>
        {editing&&selectedLine&&<div style={{width:220,background:'var(--color-bg)',borderLeft:'1px solid var(--color-border)',padding:16,flexShrink:0}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>Line / Wall</div>
          <div style={{marginBottom:12}}><label style={{display:'block',fontSize:12,color:'var(--color-text-secondary)',marginBottom:5}}>Thickness</label><input type="range" min={2} max={24} value={(map.lines||[]).find(l=>l.id===selectedLine)?.thickness||6} onChange={e=>{setMap(m=>({...m,lines:(m.lines||[]).map(l=>l.id===selectedLine?{...l,thickness:+e.target.value}:l)}));onSaveMap(map);}} style={{width:'100%'}}/></div>
          <div style={{marginBottom:12}}><label style={{display:'block',fontSize:12,color:'var(--color-text-secondary)',marginBottom:5}}>Color</label><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{['#334155','#1e40af','#166534','#991b1b','#92400e','#6b21a8'].map(c=><div key={c} onClick={()=>updateMap({...map,lines:(map.lines||[]).map(l=>l.id===selectedLine?{...l,color:c}:l)})} style={{width:24,height:24,borderRadius:6,background:c,border:`3px solid ${(map.lines||[]).find(l=>l.id===selectedLine)?.color===c?'#fff':'transparent'}`,cursor:'pointer',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}/>)}</div></div>
          <button onClick={deleteSelected} style={{...btnS,width:'100%',fontSize:12,color:'var(--color-danger-text)',borderColor:'var(--color-danger-border)'}}>🗑 Delete</button>
        </div>}
        {editing&&selectedDoor&&<div style={{width:220,background:'var(--color-bg)',borderLeft:'1px solid var(--color-border)',padding:16,flexShrink:0}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>Door</div>
          <div style={{marginBottom:12}}><label style={{display:'block',fontSize:12,color:'var(--color-text-secondary)',marginBottom:5}}>Rotation</label><input type="range" min={0} max={360} step={15} value={(map.doors||[]).find(d=>d.id===selectedDoor)?.rotation||0} onChange={e=>{setMap(m=>({...m,doors:(m.doors||[]).map(d=>d.id===selectedDoor?{...d,rotation:+e.target.value}:d)}));onSaveMap(map);}} style={{width:'100%'}}/><div style={{fontSize:11,color:'var(--color-text-tertiary)',textAlign:'center'}}>{(map.doors||[]).find(d=>d.id===selectedDoor)?.rotation||0}°</div></div>
          <div style={{marginBottom:12}}><label style={{display:'block',fontSize:12,color:'var(--color-text-secondary)',marginBottom:5}}>Size</label><input type="range" min={24} max={80} value={(map.doors||[]).find(d=>d.id===selectedDoor)?.size||40} onChange={e=>{setMap(m=>({...m,doors:(m.doors||[]).map(d=>d.id===selectedDoor?{...d,size:+e.target.value}:d)}));onSaveMap(map);}} style={{width:'100%'}}/></div>
          <button onClick={deleteSelected} style={{...btnS,width:'100%',fontSize:12,color:'var(--color-danger-text)',borderColor:'var(--color-danger-border)'}}>🗑 Delete</button>
        </div>}
        {!editing&&selectedLocObj&&<div style={{width:320,background:'var(--color-bg)',borderLeft:'1px solid var(--color-border)',overflow:'auto',padding:20,flexShrink:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <div><div style={{fontSize:17,fontWeight:700}}>{selectedLocObj.icon} {selectedLocObj.name}</div><div style={{fontSize:12,color:'var(--color-text-secondary)',marginTop:2}}>{selectedStock.length} units</div></div>
            <button onClick={()=>setSelectedPin(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:22,color:'var(--color-text-tertiary)'}}>×</button>
          </div>
          {Object.values(selectedGrouped).map(({item,entries})=>{const worst=worstStatus(entries);const ws=SS[worst];const hasIssue=worst==='expired'||worst==='soon';return<div key={item.id} onClick={()=>navigate('drugdetail',{libraryId:item.id})} style={{marginBottom:10,padding:'10px 12px',background:'var(--color-bg-secondary)',border:hasIssue?`1.5px solid ${ws.border}`:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',cursor:'pointer'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}><div style={{fontWeight:600,fontSize:13}}>{item.name}</div><Badge type={worst} label={`${entries.length} units`}/></div>
            {[...entries].sort((a,b)=>{const da=parseExp(a.expiration),db=parseExp(b.expiration);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return da-db;}).slice(0,3).map(e=>{const st=getStatus(e.expiration);return<div key={e.id} style={{fontSize:12,display:'flex',justifyContent:'space-between',padding:'3px 0',borderTop:'1px solid var(--color-border)'}}><span style={{fontFamily:'var(--font-mono)',fontWeight:600}}>{e.expiration==='NA'?'N/A':e.expiration||'—'}</span><Badge type={st.type} label={st.label}/></div>;})}
            {entries.length>3&&<div style={{fontSize:11,color:'var(--color-text-tertiary)',marginTop:4}}>+{entries.length-3} more</div>}
          </div>;})}
          {selectedStock.length===0&&<div style={{textAlign:'center',padding:'2rem',color:'var(--color-text-secondary)',fontSize:13}}>No stock in this location</div>}
        </div>}
      </div>
      {addLocModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:20}}>
          <div style={{background:'var(--color-bg)',borderRadius:'var(--radius-lg)',padding:'24px',width:'100%',maxWidth:340}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:16}}>New Location</div>
            <div style={{marginBottom:14}}>
              <label style={{display:'block',fontSize:12,fontWeight:500,color:'var(--color-text-secondary)',marginBottom:5}}>Name</label>
              <input value={newLocName} onChange={e=>setNewLocName(e.target.value)} placeholder="e.g. ALS Bag 3, Unit 7 Cabinet..." autoFocus onKeyDown={e=>{if(e.key==='Enter'&&newLocName.trim()){const loc={id:uid(),name:newLocName.trim(),icon:newLocIcon,type:'bag',templateId:null};onSaveLocations([...locations,loc]);const pins=map.pins||[];const updated={...map,pins:[...pins,{id:uid(),locationId:loc.id,x:150,y:150}]};updateMap(updated);setAddLocModal(false);}}}/>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{display:'block',fontSize:12,fontWeight:500,color:'var(--color-text-secondary)',marginBottom:8}}>Icon</label>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {LOC_ICONS.map(icon=>(
                  <button key={icon} onClick={()=>setNewLocIcon(icon)} style={{width:38,height:38,borderRadius:8,border:newLocIcon===icon?'2px solid #1a1a1a':'1px solid var(--color-border)',background:newLocIcon===icon?'var(--color-bg-secondary)':'transparent',fontSize:20,cursor:'pointer'}}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setAddLocModal(false)} style={{...btnS,flex:1}}>Cancel</button>
              <button onClick={()=>{if(!newLocName.trim())return;const loc={id:uid(),name:newLocName.trim(),icon:newLocIcon,type:'bag',templateId:null};onSaveLocations([...locations,loc]);const pins=map.pins||[];const updated={...map,pins:[...pins,{id:uid(),locationId:loc.id,x:150,y:150}]};updateMap(updated);setAddLocModal(false);}} disabled={!newLocName.trim()} style={{...btnP,flex:1,opacity:newLocName.trim()?1:0.45}}>Add to map</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryView({ library, stock, locations, categories, navigate, onSaveCategories, onSaveStock }) {
  const [activeTab, setActiveTab]   = useState('all');
  const [filter, setFilter]         = useState('all');
  const [parView, setParView]       = useState('both');
  const [search, setSearch]         = useState('');
  const [movingItem, setMovingItem] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [moveQty, setMoveQty]       = useState('');
  const [moveFrom, setMoveFrom]     = useState('supply-room');
  const [moveTo, setMoveTo]         = useState('');
  const [moveStep, setMoveStep]     = useState('form');
  const active = stock.filter(s => s.status === 'active');
  const q = search.trim().toLowerCase();
  const items = library
    .filter(item => item.status !== 'inactive')
    .filter(item => activeTab === 'all' || item.category === activeTab)
    .filter(item => !q || item.name.toLowerCase().includes(q))
    .filter(item => parView==='sfot'?(item.sfotPar||0)>0 : parView==='hha'?(item.hhaPar||0)>0 : true)
    .map(item => { const entries=active.filter(s=>s.libraryId===item.id); const worst=worstStatus(entries); return {item,entries,worst}; })
    .filter(({entries}) => entries.length > 0)
    .filter(({worst}) => { if(filter==='issues')return worst==='expired'||worst==='soon'; if(filter==='watch')return worst==='watch'; if(filter==='good')return worst==='good'||worst==='none'; return true; })
    .sort((a,b) => ['expired','soon','watch','none','good'].indexOf(a.worst)-['expired','soon','watch','none','good'].indexOf(b.worst));

  function getAvailableUnits(libItem,locId) { return active.filter(s=>s.libraryId===libItem?.id&&s.locationId===locId).sort((a,b)=>{if(a.expiration==='NA'&&b.expiration==='NA')return 0;if(a.expiration==='NA')return 1;if(b.expiration==='NA')return -1;const da=parseExp(a.expiration),db=parseExp(b.expiration);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return da-db;}); }
  const availableUnits=movingItem?getAvailableUnits(movingItem,moveFrom):[];
  const qty=parseInt(moveQty)||0;
  const unitsToMove=availableUnits.slice(0,qty);
  const canMove=qty>0&&qty<=availableUnits.length&&moveTo&&moveTo!==moveFrom;
  function openMove(item){setMovingItem(item);setMoveQty('');setMoveFrom('supply-room');setMoveTo('');setMoveStep('form');}
  function closeMove(){setMovingItem(null);setMoveQty('');setMoveTo('');setMoveStep('form');}
  function confirmMove(){const ids=unitsToMove.map(s=>s.id);onSaveStock(stock.map(s=>ids.includes(s.id)?{...s,locationId:moveTo}:s));closeMove();}
  const fromLoc=locations.find(l=>l.id===moveFrom);
  const toLoc=locations.find(l=>l.id===moveTo);

  return (
    <div style={{paddingBottom:20}}>
      <div style={{padding:'16px 20px 0',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h2 style={{fontSize:20,fontWeight:700}}>Inventory</h2>
        <button onClick={()=>navigate('addstock',{})} style={{...btnG,padding:'7px 14px',fontSize:13}}>+ Add Stock</button>
      </div>
      <div style={{display:'flex',gap:0,padding:'0 20px',overflowX:'auto',marginBottom:12,borderBottom:'1px solid var(--color-border)'}}>
        <button onClick={()=>setActiveTab('all')} style={{flexShrink:0,padding:'8px 14px',border:'none',borderBottom:activeTab==='all'?'2px solid var(--color-text)':'2px solid transparent',background:'transparent',color:activeTab==='all'?'var(--color-text)':'var(--color-text-secondary)',fontWeight:activeTab==='all'?700:400,fontSize:14,cursor:'pointer',fontFamily:'var(--font)',marginBottom:-1}}>All</button>
        {categories.map(cat=><button key={cat.id} onClick={()=>setActiveTab(cat.id)} style={{flexShrink:0,padding:'8px 14px',border:'none',borderBottom:activeTab===cat.id?'2px solid var(--color-text)':'2px solid transparent',background:'transparent',color:activeTab===cat.id?'var(--color-text)':'var(--color-text-secondary)',fontWeight:activeTab===cat.id?700:400,fontSize:14,cursor:'pointer',fontFamily:'var(--font)',marginBottom:-1}}>{cat.icon} {cat.name}</button>)}
        <button onClick={()=>{const name=prompt('Category name?');if(!name)return;const icon=prompt('Emoji icon?')||'📦';onSaveCategories([...categories,{id:uid(),name,icon}]);}} style={{flexShrink:0,padding:'8px 12px',border:'none',borderBottom:'2px solid transparent',background:'transparent',color:'var(--color-text-tertiary)',fontSize:14,cursor:'pointer',fontFamily:'var(--font)',marginBottom:-1}}>+</button>
      </div>
      <div style={{padding:'0 20px'}}>
        <div style={{position:'relative',marginBottom:10}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--color-text-tertiary)',pointerEvents:'none'}}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{paddingLeft:30,paddingRight:search?30:10}}/>
          {search&&<button onClick={()=>setSearch('')} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--color-text-tertiary)',fontSize:18,lineHeight:1,padding:0}}>×</button>}
        </div>
        <div style={{display:'flex',gap:6,marginBottom:8,overflowX:'auto'}}>
          {[['all','All'],['issues','Issues'],['watch','Watch'],['good','Good']].map(([val,label])=><button key={val} onClick={()=>setFilter(val)} style={{flexShrink:0,padding:'5px 14px',borderRadius:20,fontSize:12,cursor:'pointer',fontWeight:filter===val?600:400,background:filter===val?'var(--color-text)':'transparent',color:filter===val?'var(--color-bg)':'var(--color-text-secondary)',border:filter===val?'none':'1px solid var(--color-border)',fontFamily:'var(--font)'}}>{label}</button>)}
        </div>
        <div style={{display:'flex',gap:6,marginBottom:14,overflowX:'auto'}}>
          <span style={{fontSize:11,color:'var(--color-text-tertiary)',alignSelf:'center',flexShrink:0}}>Par:</span>
          {[['both','Both'],['sfot','SFOT'],['hha','HHA']].map(([val,label])=><button key={val} onClick={()=>setParView(val)} style={{flexShrink:0,padding:'5px 14px',borderRadius:20,fontSize:12,cursor:'pointer',fontWeight:parView===val?600:400,background:parView===val?'#1d6b3a':'transparent',color:parView===val?'#fff':'var(--color-text-secondary)',border:parView===val?'none':'1px solid var(--color-border)',fontFamily:'var(--font)'}}>{label}</button>)}
        </div>
        {items.length>0&&<div style={{fontSize:12,color:'var(--color-text-tertiary)',marginBottom:10}}>{items.length} item{items.length!==1?'s':''} · {items.reduce((s,{entries})=>s+entries.length,0)} total units</div>}
        {items.length===0&&<EmptyState icon="📋" title="No stock found" subtitle={q?`No results for "${q}"`:active.length===0?'No stock added yet — use Quick Receive or Add Stock':'No stock matches this filter'} action={active.length===0?<button onClick={()=>navigate('addstock',{})} style={{...btnG,padding:'10px 20px'}}>+ Add Stock</button>:null}/>}
        {items.map(({item,entries,worst})=>{
          const ws=SS[worst];const hasIssue=worst==='expired'||worst==='soon';
          const sfot=item.sfotPar||0;const hha=item.hhaPar||0;const par=parView==='sfot'?sfot:parView==='hha'?hha:sfot+hha;const parLabel=parView==='sfot'?'SFOT':parView==='hha'?'HHA':'par';const usable=entries.filter(s=>getStatus(s.expiration).type!=='expired').length;const belowPar=par>0&&usable<par;
          const cat=categories.find(c=>c.id===item.category);
          const byLocation={};entries.forEach(s=>{const loc=locations.find(l=>l.id===s.locationId);const key=loc?.name||'Unknown';byLocation[key]=(byLocation[key]||0)+1;});
          const locationSummary=Object.entries(byLocation).map(([name,count])=>`${count} @ ${name}`).join(' · ');
          const sortedEntries=[...entries].sort((a,b)=>{const da=parseExp(a.expiration),db=parseExp(b.expiration);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return da-db;});
          const earliest=sortedEntries[0];const earliestSt=earliest?getStatus(earliest.expiration):null;
          return(
            <div key={item.id} style={{background:'var(--color-bg)',border:hasIssue?`1.5px solid ${ws.border}`:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',marginBottom:8,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px'}}>
                <div onClick={()=>navigate('drugdetail',{libraryId:item.id})} style={{width:44,height:44,borderRadius:10,overflow:'hidden',flexShrink:0,background:'var(--color-bg-secondary)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
                  {item.profilePhoto?<img src={`data:image/jpeg;base64,${item.profilePhoto}`} alt="" style={{width:44,height:44,objectFit:'cover'}}/>:<span style={{fontSize:22}}>{cat?.icon||'📦'}</span>}
                </div>
                <div style={{flex:1,minWidth:0,cursor:'pointer'}} onClick={()=>navigate('drugdetail',{libraryId:item.id})}>
                  <div style={{fontWeight:600,fontSize:14,marginBottom:2}}>{item.name}</div>
                  <div style={{fontSize:12,color:'var(--color-text-secondary)',display:'flex',gap:8,flexWrap:'wrap',marginBottom:2}}>
                    <span style={{fontWeight:600,color:hasIssue?ws.text:'var(--color-text)'}}>{entries.length} unit{entries.length!==1?'s':''}</span>
                    {par>0&&<span style={{color:belowPar?'var(--color-danger-text)':'var(--color-text-tertiary)',fontWeight:belowPar?600:400}}>{parLabel} {par}{belowPar?` ⚠ need ${par-usable}`:' ✓'}</span>}
                    {earliest&&earliestSt&&earliestSt.type!=='none'&&<span style={{color:earliestSt.type==='expired'?'var(--color-danger-text)':earliestSt.type==='soon'?'var(--color-warning-text)':'var(--color-text-tertiary)'}}>earliest: {earliest.expiration}</span>}
                  </div>
                  {locationSummary&&<div style={{fontSize:11,color:'var(--color-text-tertiary)'}}>📍 {locationSummary}</div>}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end',flexShrink:0}}>
                  {hasIssue&&<Badge type={worst} label={worst==='expired'?'EXPIRED':'EXP SOON'}/>}
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={()=>setExpandedId(expandedId===item.id?null:item.id)} style={{...btnS,padding:'5px 10px',fontSize:12}}>{expandedId===item.id?'▲':'▼'}</button>
                    <button onClick={()=>openMove(item)} style={{...btnS,padding:'5px 12px',fontSize:12}}>Move</button>
                    <button onClick={()=>{if(!window.confirm(`Remove all ${item.name} stock?`))return;onSaveStock(stock.filter(s=>s.libraryId!==item.id));}} style={{...btnS,padding:'5px 12px',fontSize:12,color:'var(--color-danger-text)',borderColor:'var(--color-danger-border)'}}>Delete</button>
                  </div>
                </div>
              </div>
              {expandedId===item.id&&(
                <div style={{borderTop:'1px solid var(--color-border)'}}>
                  {sortedEntries.map((entry,i)=>{
                    const st=getStatus(entry.expiration);const es=SS[st.type];
                    const loc=locations.find(l=>l.id===entry.locationId);
                    return(
                      <div key={entry.id} style={{display:'flex',alignItems:'center',padding:'8px 14px',borderTop:i>0?'1px solid var(--color-border)':'none'}}>
                        <div style={{flex:1}}>
                          <span style={{fontSize:14,fontWeight:700,fontFamily:'var(--font-mono)'}}>{entry.expiration==='NA'?'N/A':entry.expiration||'—'}</span>
                          {loc&&<span style={{fontSize:11,color:'var(--color-text-tertiary)',marginLeft:8}}>📍 {loc.name}</span>}
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <Badge type={st.type} label={st.label}/>
                          <button onClick={()=>setEditingEntry(entry)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-tertiary)',fontSize:14,lineHeight:1}}>✏️</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {editingEntry&&(
        <EditExpirationModal
          entry={editingEntry}
          onClose={()=>setEditingEntry(null)}
          onSave={exp=>{onSaveStock(stock.map(s=>s.id===editingEntry.id?{...s,expiration:exp||'NA'}:s));setEditingEntry(null);}}
        />
      )}
      {movingItem&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'flex-end',zIndex:200}}>
          <div style={{width:'100%',maxWidth:680,margin:'0 auto',background:'var(--color-bg)',borderRadius:'20px 20px 0 0',padding:'24px 20px 36px',maxHeight:'85vh',overflow:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div><div style={{fontSize:16,fontWeight:700}}>Move {movingItem.name}</div><div style={{fontSize:12,color:'var(--color-text-secondary)',marginTop:2}}>FIFO — oldest expiration moves first</div></div>
              <button onClick={closeMove} style={{background:'none',border:'none',cursor:'pointer',fontSize:24,color:'var(--color-text-tertiary)'}}>×</button>
            </div>
            {moveStep==='form'&&<>
              <Field label="From location">
                <select value={moveFrom} onChange={e=>{setMoveFrom(e.target.value);setMoveQty('');}} style={{width:'100%',padding:'9px 12px',borderRadius:'var(--radius-sm)',border:'1px solid var(--color-border)',background:'var(--color-bg)',color:'var(--color-text)',fontSize:15,fontFamily:'var(--font)'}}>
                  {locations.map(l=>{const count=active.filter(s=>s.libraryId===movingItem.id&&s.locationId===l.id).length;return<option key={l.id} value={l.id}>{l.icon} {l.name} ({count} units)</option>;})}
                </select>
              </Field>
              <div style={{background:'var(--color-bg-secondary)',borderRadius:'var(--radius-md)',padding:'10px 14px',marginBottom:14,fontSize:13}}>
                {availableUnits.length===0?<span style={{color:'var(--color-danger-text)'}}>No units in {fromLoc?.name}</span>:<span><strong>{availableUnits.length}</strong> units available in {fromLoc?.name}</span>}
              </div>
              <Field label="How many to move?">
                <div style={{display:'flex',gap:8,marginBottom:8}}>{[1,2,3,4,5].filter(n=>n<=availableUnits.length).map(n=><button key={n} onClick={()=>setMoveQty(String(n))} style={{flex:1,padding:'10px',borderRadius:'var(--radius-md)',border:moveQty===String(n)?'none':'1px solid var(--color-border)',background:moveQty===String(n)?'#1a1a1a':'var(--color-bg-secondary)',color:moveQty===String(n)?'#fff':'var(--color-text)',fontWeight:700,cursor:'pointer',fontFamily:'var(--font)'}}>{n}</button>)}</div>
                <input value={moveQty} onChange={e=>setMoveQty(e.target.value)} type="number" min="1" max={availableUnits.length} placeholder={`Max ${availableUnits.length}`} style={{textAlign:'center',fontWeight:600,fontSize:16}}/>
              </Field>
              <Field label="To location">
                <select value={moveTo} onChange={e=>setMoveTo(e.target.value)} style={{width:'100%',padding:'9px 12px',borderRadius:'var(--radius-sm)',border:'1px solid var(--color-border)',background:'var(--color-bg)',color:'var(--color-text)',fontSize:15,fontFamily:'var(--font)'}}>
                  <option value="">Select destination...</option>
                  {locations.filter(l=>l.id!==moveFrom).map(l=><option key={l.id} value={l.id}>{l.icon} {l.name}</option>)}
                </select>
              </Field>
              <button onClick={()=>canMove&&setMoveStep('confirm')} disabled={!canMove} style={{...btnP,width:'100%',opacity:canMove?1:0.4}}>Review move →</button>
            </>}
            {moveStep==='confirm'&&<>
              <div style={{background:'var(--color-bg-secondary)',borderRadius:'var(--radius-lg)',padding:'16px',marginBottom:20}}>
                <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{movingItem.name}</div>
                <div style={{fontSize:13,color:'var(--color-text-secondary)',marginBottom:16}}>{fromLoc?.icon} {fromLoc?.name} → {toLoc?.icon} {toLoc?.name}</div>
                <div style={{borderTop:'1px solid var(--color-border)',paddingTop:12}}>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--color-text-secondary)',marginBottom:8}}>{unitsToMove.length} unit{unitsToMove.length!==1?'s':''} moving:</div>
                  {unitsToMove.map((entry,i)=>{const st=getStatus(entry.expiration);const es=SS[st.type];return<div key={entry.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 10px',background:'var(--color-bg)',border:`1px solid ${es.border}`,borderRadius:8,marginBottom:6}}><span style={{fontSize:14,fontWeight:700,fontFamily:'var(--font-mono)'}}>Unit {i+1} — {entry.expiration==='NA'?'N/A':entry.expiration||'No date'}</span><Badge type={st.type} label={st.label}/></div>;})}
                </div>
              </div>
              <button onClick={confirmMove} style={{...btnG,width:'100%',marginBottom:10}}>✓ Confirm — move {unitsToMove.length} to {toLoc?.name}</button>
              <button onClick={()=>setMoveStep('form')} style={{...btnS,width:'100%'}}>← Back</button>
            </>}
          </div>
        </div>
      )}
    </div>
  );
}

function EditExpirationModal({ entry, onSave, onClose }) {
  const [exp, setExp] = useState(entry.expiration || '');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 680, margin: '0 auto', background: 'var(--color-bg)', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Edit expiration date</div>
        <ExpirationInput value={exp} onChange={setExp} />
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ ...btnS, flex: 1 }}>Cancel</button>
          <button onClick={() => onSave(exp)} style={{ ...btnP, flex: 2 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function DrugDetailView({ libraryId, library, stock, locations, categories, navigate, onSaveStock, onSaveLibrary }) {
  const item = library.find(d => d.id === libraryId);
  const [showPulled, setShowPulled] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  if (!item) return (
    <div style={{padding:20}}>
      <TopBar title="Item Detail" onBack={()=>navigate(-1)}/>
      <EmptyState icon="💊" title="Item not found" subtitle="It may have been deleted" action={<button onClick={()=>navigate('library')} style={{...btnP,padding:'10px 20px'}}>Go to Library</button>}/>
    </div>
  );
  const active=stock.filter(s=>s.libraryId===libraryId&&s.status==='active');
  const pulled=stock.filter(s=>s.libraryId===libraryId&&s.status==='pulled');
  const cat=categories.find(c=>c.id===item.category);
  const par=(item.sfotPar||0)+(item.hhaPar||0);
  const usable=active.filter(s=>getStatus(s.expiration).type!=='expired').length;
  const worst=worstStatus(active);const ws=SS[worst];
  const sorted=[...active].sort((a,b)=>{if(a.expiration==='NA'&&b.expiration==='NA')return 0;if(a.expiration==='NA')return 1;if(b.expiration==='NA')return -1;const da=parseExp(a.expiration),db=parseExp(b.expiration);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return da-db;});
  return (
    <div style={{paddingBottom:20}}>
      <TopBar title="" onBack={()=>navigate(-1)} right={
        <div style={{display:'flex',gap:12}}>
          <button onClick={()=>navigate('edititem',{libraryId})} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-secondary)',fontSize:14,fontFamily:'var(--font)'}}>Edit</button>
          <button onClick={()=>{if(!window.confirm(`Delete ${item.name} and all its stock?`))return;onSaveLibrary(library.filter(d=>d.id!==libraryId));onSaveStock(stock.filter(s=>s.libraryId!==libraryId));navigate('library');}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-danger-text)',fontSize:14,fontFamily:'var(--font)'}}>Delete</button>
        </div>
      }/>
      <div style={{padding:'0 20px'}}>
        <div style={{display:'flex',gap:14,alignItems:'center',padding:16,background:'var(--color-bg-secondary)',borderRadius:'var(--radius-lg)',marginBottom:16}}>
          <div style={{width:64,height:64,borderRadius:12,overflow:'hidden',flexShrink:0,background:'var(--color-bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {item.profilePhoto?<img src={`data:image/jpeg;base64,${item.profilePhoto}`} alt="" style={{width:64,height:64,objectFit:'cover'}}/>:<span style={{fontSize:32}}>{cat?.icon||'📦'}</span>}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>{item.name}</div>
            <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:4}}>
              <span style={{fontSize:24,fontWeight:700,color:(worst==='expired'||worst==='soon')?ws.text:'var(--color-text)'}}>{active.length}</span>
              <span style={{fontSize:13,color:'var(--color-text-secondary)'}}>units in stock</span>
              {par>0&&<span style={{fontSize:12,color:usable<par?'var(--color-danger-text)':'var(--color-text-tertiary)',fontWeight:usable<par?600:400}}>/ {par} par{usable<par?` ⚠ need ${par-usable}`:' ✓'}</span>}
            </div>
            {item.notes&&<div style={{fontSize:12,color:'var(--color-text-secondary)',fontStyle:'italic'}}>{item.notes}</div>}
          </div>
        </div>
        <button onClick={()=>navigate('addstock',{libraryId})} style={{...btnG,width:'100%',marginBottom:16}}>+ Add stock</button>
        {sorted.length===0&&<EmptyState icon={cat?.icon||'📦'} title="No stock" subtitle="Tap Add stock above"/>}
        {sorted.map(entry=>{
          const st=getStatus(entry.expiration);const es=SS[st.type];
          const loc=locations.find(l=>l.id===entry.locationId);
          return(
            <div key={entry.id} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 14px',background:'var(--color-bg)',border:`1px solid ${es.border}`,borderRadius:'var(--radius-lg)',marginBottom:8}}>
              <div style={{flex:1}}>
                <div style={{fontSize:18,fontWeight:700,fontFamily:'var(--font-mono)',marginBottom:3}}>{entry.expiration==='NA'?'N/A':entry.expiration||'—'}</div>
                <div style={{fontSize:12,color:'var(--color-text-secondary)',display:'flex',gap:8,flexWrap:'wrap'}}>
                  {loc&&<span>📍 {loc.name}</span>}
                  {entry.lot&&<span>Lot: {entry.lot}</span>}
                  <span>{new Date(entry.addedAt).toLocaleDateString()}</span>
                </div>
                {st.days!==null&&st.days<=90&&<div style={{fontSize:11,color:es.text,marginTop:4,fontWeight:500}}>{st.days<0?`Expired ${Math.abs(st.days)} days ago`:st.days===0?'Expires today':`Expires in ${st.days} days`}</div>}
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6}}>
                <Badge type={st.type} label={st.label}/>
                <div style={{display:'flex',gap:6}}>
                  <button onClick={()=>setEditingEntry(entry)} style={{background:'none',border:'1px solid var(--color-border)',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,color:'var(--color-text-secondary)',fontFamily:'var(--font)'}}>Edit exp</button>
                  <button onClick={()=>{if(window.confirm('Pull this unit?'))onSaveStock(stock.map(s=>s.id===entry.id?{...s,status:'pulled',pulledAt:new Date().toISOString()}:s));}} style={{background:'none',border:'1px solid var(--color-border)',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,color:'var(--color-text-secondary)',fontFamily:'var(--font)'}}>Pull</button>
                </div>
              </div>
            </div>
          );
        })}
        {pulled.length>0&&(
          <div style={{marginTop:12}}>
            <button onClick={()=>setShowPulled(p=>!p)} style={{...btnS,width:'100%',fontSize:12,marginBottom:8}}>{showPulled?'Hide':'Show'} {pulled.length} pulled / disposed</button>
            {showPulled&&pulled.sort((a,b)=>new Date(b.pulledAt||0)-new Date(a.pulledAt||0)).map(entry=>(
              <div key={entry.id} style={{display:'flex',alignItems:'center',padding:'9px 14px',background:'var(--color-bg-secondary)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',marginBottom:6,opacity:0.55}}>
                <div style={{flex:1}}><span style={{fontSize:13,fontWeight:600,textDecoration:'line-through',fontFamily:'var(--font-mono)'}}>{entry.expiration}</span><span style={{fontSize:11,color:'var(--color-text-tertiary)',marginLeft:8}}>Pulled {entry.pulledAt?new Date(entry.pulledAt).toLocaleDateString():''}</span></div>
                <span style={{fontSize:10,fontWeight:700,color:'var(--color-text-tertiary)'}}>PULLED</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {editingEntry && (
        <EditExpirationModal
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSave={exp => { onSaveStock(stock.map(s => s.id === editingEntry.id ? { ...s, expiration: exp || 'NA' } : s)); setEditingEntry(null); }}
        />
      )}
    </div>
  );
}

function AddStockView({ libraryId, locationId, library, stock, locations, navigate, onSaveStock }) {
  const item=libraryId?library.find(d=>d.id===libraryId):null;
  const [selectedItem,setSelectedItem]=useState(item||null);
  const [selectedLocation,setSelectedLocation]=useState(locationId||'supply-room');
  const [step,setStep]=useState(libraryId&&locationId?'count':libraryId?'location':'selectitem');
  const [count,setCount]=useState('');
  const [expirations,setExpirations]=useState([]);
  const [saving,setSaving]=useState(false);
  const [search,setSearch]=useState('');
  const quick=[1,2,3,4,5,6,10,12];
  const q=search.trim().toLowerCase();
  function handleCountNext(){const n=parseInt(count);if(!n||n<1)return;setExpirations(Array(n).fill(''));setStep('expirations');}
  function handleSave(){setSaving(true);const newEntries=expirations.map(exp=>({id:uid(),libraryId:selectedItem.id,locationId:selectedLocation,expiration:exp||'NA',status:'active',addedAt:new Date().toISOString(),lot:''}));onSaveStock([...stock,...newEntries]);setSaving(false);if(locationId)navigate('locationdetail',{locationId});else if(libraryId)navigate('drugdetail',{libraryId});else navigate('inventory');}
  if(step==='selectitem')return(<div><TopBar title="Add Stock" onBack={()=>navigate(-1)}/><div style={{padding:'0 20px'}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search library..." style={{marginBottom:12}}/>{library.filter(i=>i.status!=='inactive').filter(i=>!q||i.name.toLowerCase().includes(q)).map(item=><div key={item.id} onClick={()=>{setSelectedItem(item);setStep('location');}} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 14px',background:'var(--color-bg)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',marginBottom:8,cursor:'pointer'}}><span style={{fontSize:13,fontWeight:600}}>{item.name}</span></div>)}</div></div>);
  if(step==='location')return(<div><TopBar title={selectedItem?.name} onBack={()=>libraryId&&!locationId?navigate(-1):setStep('selectitem')}/><div style={{padding:'0 20px'}}><div style={{fontSize:13,color:'var(--color-text-secondary)',marginBottom:14}}>Where is this stock going?</div>{locations.map(loc=><div key={loc.id} onClick={()=>{setSelectedLocation(loc.id);setStep('count');}} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:selectedLocation===loc.id?'var(--color-bg-secondary)':'var(--color-bg)',border:selectedLocation===loc.id?'2px solid var(--color-border-strong)':'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',marginBottom:8,cursor:'pointer'}}><span style={{fontSize:20}}>{loc.icon}</span><span style={{fontWeight:600,fontSize:14}}>{loc.name}</span></div>)}</div></div>);
  if(step==='count')return(<div><TopBar title={selectedItem?.name} onBack={()=>setStep('location')}/><div style={{padding:'0 20px'}}><div style={{background:'var(--color-bg-secondary)',borderRadius:'var(--radius-md)',padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--color-text-secondary)',textAlign:'center'}}>→ {locations.find(l=>l.id===selectedLocation)?.name}<br/>How many units?</div><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>{quick.map(n=><button key={n} onClick={()=>setCount(String(n))} style={{padding:'13px 8px',borderRadius:'var(--radius-md)',border:count===String(n)?'none':'1px solid var(--color-border)',background:count===String(n)?'#1a1a1a':'var(--color-bg-secondary)',color:count===String(n)?'#fff':'var(--color-text)',fontWeight:700,fontSize:16,cursor:'pointer',fontFamily:'var(--font)'}}>{n}</button>)}</div><input value={count} onChange={e=>setCount(e.target.value)} type="number" min="1" placeholder="Other amount" style={{textAlign:'center',fontWeight:600,fontSize:16,marginBottom:16}}/><button onClick={handleCountNext} disabled={!parseInt(count)||parseInt(count)<1} style={{...btnG,width:'100%',opacity:parseInt(count)>0?1:0.45}}>Next → expiration dates</button></div></div>);
  if(step==='expirations')return(<div><TopBar title={selectedItem?.name} onBack={()=>setStep('count')}/><div style={{padding:'0 20px'}}><div style={{background:'var(--color-bg-secondary)',borderRadius:'var(--radius-md)',padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--color-text-secondary)',textAlign:'center'}}>{expirations.length} unit{expirations.length!==1?'s':''} → {locations.find(l=>l.id===selectedLocation)?.name}<br/>Enter expiration — tap N/A if none</div>{expirations.map((exp,i)=><div key={i} style={{marginBottom:16}}><ExpirationInput label={`Unit ${i+1} of ${expirations.length}`} value={exp} onChange={v=>{const next=[...expirations];next[i]=v;setExpirations(next);}}/></div>)}<button onClick={handleSave} disabled={saving} style={{...btnG,width:'100%',marginTop:8,opacity:saving?0.5:1}}>{saving?'Saving...':`✓ Save ${expirations.length} unit${expirations.length!==1?'s':''}`}</button></div></div>);
  return null;
}

function LibraryView({ library, stock, categories, navigate, pending }) {
  const [search,setSearch]=useState('');
  const [showInactive,setShowInactive]=useState(false);
  const active=stock.filter(s=>s.status==='active');
  const q=search.trim().toLowerCase();
  const visible=library.filter(d=>showInactive||d.status!=='inactive').filter(d=>!q||d.name.toLowerCase().includes(q)).sort((a,b)=>{const order=['expired','soon','watch','none','good'];const wa=worstStatus(active.filter(s=>s.libraryId===a.id));const wb=worstStatus(active.filter(s=>s.libraryId===b.id));if(wa!==wb)return order.indexOf(wa)-order.indexOf(wb);return a.name.localeCompare(b.name);});
  const inactiveCount=library.filter(d=>d.status==='inactive').length;
  const pendingCount=(pending||[]).filter(p=>p.status==='pending').length;
  return(
    <div style={{paddingBottom:20}}>
      <div style={{padding:'16px 20px 0',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h2 style={{fontSize:20,fontWeight:700}}>Library</h2>
        <button onClick={()=>navigate('additem')} style={{...btnP,padding:'7px 14px',fontSize:13}}>+ Add</button>
      </div>
      <div style={{padding:'0 20px'}}>
        {pendingCount>0&&(
          <div onClick={()=>navigate('pendingqueue')} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:'var(--color-warning-bg)',border:'1px solid var(--color-warning-border)',borderRadius:'var(--radius-lg)',marginBottom:16,cursor:'pointer'}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--color-warning-text)'}}>📥 {pendingCount} item{pendingCount!==1?'s':''} waiting for review</div>
              <div style={{fontSize:12,color:'var(--color-warning-text)',opacity:0.8,marginTop:2}}>Tap to open the upload queue</div>
            </div>
            <span style={{fontSize:20,color:'var(--color-warning-text)'}}>›</span>
          </div>
        )}
        <div style={{position:'relative',marginBottom:14}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--color-text-tertiary)',pointerEvents:'none'}}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{paddingLeft:30,paddingRight:search?30:10}}/>
          {search&&<button onClick={()=>setSearch('')} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--color-text-tertiary)',fontSize:18,lineHeight:1,padding:0}}>×</button>}
        </div>
        {visible.map(item=>{
          const ds=active.filter(s=>s.libraryId===item.id);const worst=worstStatus(ds);const ws=SS[worst];const hasIssue=worst==='expired'||worst==='soon';
          const cat=categories.find(c=>c.id===item.category);const par=(item.sfotPar||0)+(item.hhaPar||0);const usable=ds.filter(s=>getStatus(s.expiration).type!=='expired').length;const belowPar=par>0&&usable<par;
          return(
            <div key={item.id} onClick={()=>navigate('drugdetail',{libraryId:item.id})} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:item.status==='inactive'?'var(--color-bg-secondary)':'var(--color-bg)',border:hasIssue?`1.5px solid ${ws.border}`:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',marginBottom:8,cursor:'pointer',opacity:item.status==='inactive'?0.6:1}}>
              <div style={{width:44,height:44,borderRadius:10,overflow:'hidden',flexShrink:0,background:'var(--color-bg-secondary)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                {item.profilePhoto?<img src={`data:image/jpeg;base64,${item.profilePhoto}`} alt="" style={{width:44,height:44,objectFit:'cover'}}/>:<span style={{fontSize:22}}>{cat?.icon||'📦'}</span>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:14,marginBottom:2}}>{item.name}{item.status==='inactive'&&<span style={{fontSize:11,color:'var(--color-text-tertiary)',marginLeft:8,fontWeight:400}}>inactive</span>}</div>
                <div style={{fontSize:12,color:'var(--color-text-secondary)',display:'flex',gap:8}}>
                  <span style={{fontWeight:600,color:hasIssue?ws.text:'var(--color-text)'}}>{ds.length} units</span>
                  {par>0&&<span style={{color:belowPar?'var(--color-danger-text)':'var(--color-text-tertiary)',fontWeight:belowPar?600:400}}>par {par}{belowPar?' ⚠':' ✓'}</span>}
                </div>
              </div>
              <span style={{color:'var(--color-text-tertiary)',fontSize:18}}>›</span>
            </div>
          );
        })}
        {inactiveCount>0&&<button onClick={()=>setShowInactive(s=>!s)} style={{...btnS,width:'100%',marginTop:8,fontSize:13}}>{showInactive?'Hide':'Show'} {inactiveCount} inactive</button>}
        {visible.length===0&&<EmptyState icon="📦" title="No items" subtitle="Scan an item to add it to your library" action={<button onClick={()=>navigate('additem')} style={{...btnG,padding:'10px 20px'}}>+ Add item</button>}/>}
      </div>
    </div>
  );
}

function AddItemView({ libraryId, scanData, capturedPhoto, library, stock, locations, categories, navigate, onSaveLibrary, onSaveStock }) {
  const existing=libraryId?library.find(d=>d.id===libraryId):null;
  const fileRef=useRef(null);
  const [form,setForm]=useState({name:existing?.name||scanData?.name||'',category:existing?.category||scanData?.category||categories[0]?.id||'',packagingType:existing?.packagingType||scanData?.packagingType||'vial',unit:existing?.unit||scanData?.unit||'',size:existing?.size||scanData?.size||'',notes:existing?.notes||scanData?.notes||'',sfotPar:existing?.sfotPar??'',hhaPar:existing?.hhaPar??'',status:existing?.status||'active',vendor:existing?.vendor||''});
  const [photo,setPhoto]=useState(existing?.profilePhoto||capturedPhoto||null);
  const [scanning,setScanning]=useState(false);
  const [scanError,setScanError]=useState(null);
  const [capturedPhotos,setCapturedPhotos]=useState([]);
  const [scanned,setScanned]=useState(!!(scanData&&Object.values(scanData).some(v=>v)));
  const [saving,setSaving]=useState(false);
  const [addStockPrompt,setAddStockPrompt]=useState(null);
  const set=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  const isEdit=!!existing;

  async function handleSave(){setSaving(true);const id=existing?.id||uid();const updated={id,...form,profilePhoto:photo,sfotPar:parseInt(form.sfotPar)||0,hhaPar:parseInt(form.hhaPar)||0,addedAt:existing?.addedAt||new Date().toISOString()};await onSaveLibrary(existing?library.map(d=>d.id===id?updated:d):[updated,...library]);setSaving(false);if(!existing){setAddStockPrompt(id);}else{navigate('library');}}
  async function handlePhotoChange(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async ev=>setPhoto(await resizeImage(ev.target.result.split(',')[1],400));reader.readAsDataURL(file);}

  return(
    <div style={{paddingBottom:20}}>
      <TopBar
        title={isEdit?'Edit Item':'New Item'}
        onBack={()=>navigate(isEdit?'drugdetail':'library',isEdit?{libraryId}:{})}
        right={isEdit?<div style={{display:'flex',gap:12}}>
          <button onClick={()=>{onSaveLibrary(library.map(d=>d.id===libraryId?{...d,status:d.status==='inactive'?'active':'inactive'}:d));navigate('library');}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-secondary)',fontSize:13,fontFamily:'var(--font)'}}>{existing?.status==='inactive'?'Reactivate':'Deactivate'}</button>
          <button onClick={()=>{if(!window.confirm(`Delete ${existing?.name}?`))return;onSaveLibrary(library.filter(d=>d.id!==libraryId));onSaveStock(stock.filter(s=>s.libraryId!==libraryId));navigate('library');}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-danger-text)',fontSize:13,fontFamily:'var(--font)'}}>Delete</button>
        </div>:null}
      />
      <div style={{padding:'0 20px'}}>
        {!isEdit&&!scanned&&(
          <div style={{marginBottom:16}}>
            {!scanning?(
              <MultiPhotoScanner
                initialPhotos={capturedPhotos}
                onPhotosCapture={async photos => {
  setCapturedPhotos(photos);
  setScanning(true); setScanError(null);
  try {
    const result = await api.scan(photos);
    setForm(f => ({
      ...f,
      name:          result.name          || f.name,
      category:      categories.find(c => c.id === result.category)?.id || result.category || f.category,
      packagingType: result.packagingType || f.packagingType,
      unit:          result.unit          || f.unit,
      size:          result.size          || f.size,
      notes:         result.notes         || f.notes,
    }));
    if (!photo && photos[0]) setPhoto(await resizeImage(photos[0], 400));
    setCapturedPhotos([]);
    setScanned(true);
    setScanning(false);
  } catch (e) {
    setScanError('Could not read label — fill in manually below');
    setScanning(false);
  }
}}
              />
            ):(
              <div style={{textAlign:'center',padding:'2rem'}}><Spinner/><div style={{fontSize:13,color:'var(--color-text-secondary)',marginTop:16}}>Reading label...</div></div>
            )}
            {scanError&&<div style={{fontSize:12,color:'var(--color-danger-text)',marginTop:8,textAlign:'center'}}>{scanError}</div>}
          </div>
        )}
        {scanned&&<div style={{background:'var(--color-success-bg)',color:'var(--color-success-text)',border:'1px solid var(--color-success-border)',padding:'10px 14px',borderRadius:'var(--radius-md)',marginBottom:16,fontSize:13,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>✓ Scanned — review below</span>
          <button onClick={()=>{setScanned(false);setForm(f=>({...f,name:'',packagingType:'vial',unit:'',size:'',notes:''}));}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-success-text)',fontSize:12,fontFamily:'var(--font)',textDecoration:'underline'}}>Rescan</button>
        </div>}
        <div style={{display:'flex',gap:14,marginBottom:16,alignItems:'center'}}>
          <div onClick={()=>fileRef.current?.click()} style={{width:64,height:64,borderRadius:12,overflow:'hidden',background:'var(--color-bg-secondary)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,border:'2px dashed var(--color-border)'}}>
            {photo?<img src={`data:image/jpeg;base64,${photo}`} alt="" style={{width:64,height:64,objectFit:'cover'}}/>:<span style={{fontSize:28}}>📷</span>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} style={{display:'none'}}/>
          <div style={{fontSize:12,color:'var(--color-text-tertiary)'}}>Tap to {photo?'replace':'add'} photo</div>
        </div>
        <Field label="Item name *"><input value={form.name} onChange={set('name')} placeholder="e.g. Aspirin 325mg, NPA 28fr, Tourniquet"/></Field>
        <Field label="Category">
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {categories.map(cat=><button key={cat.id} onClick={()=>setForm(f=>({...f,category:cat.id}))} style={{padding:'6px 12px',borderRadius:20,border:form.category===cat.id?'none':'1px solid var(--color-border)',background:form.category===cat.id?'#1a1a1a':'var(--color-bg-secondary)',color:form.category===cat.id?'#fff':'var(--color-text-secondary)',fontSize:13,cursor:'pointer',fontWeight:form.category===cat.id?600:400,fontFamily:'var(--font)'}}>{cat.icon} {cat.name}</button>)}
          </div>
        </Field>
        <PackagingSelector value={form.packagingType} onChange={v=>setForm(f=>({...f,packagingType:v}))}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <Field label="Unit"><input value={form.unit} onChange={set('unit')} placeholder="mL, mg, tablet..."/></Field>
          <Field label="Size / gauge"><input value={form.size} onChange={set('size')} placeholder="28fr, Large, 18ga..."/></Field>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <Field label="SFOT Par"><input value={form.sfotPar} onChange={set('sfotPar')} type="number" min="0" placeholder="0"/></Field>
          <Field label="HHA Par"><input value={form.hhaPar} onChange={set('hhaPar')} type="number" min="0" placeholder="0"/></Field>
        </div>
        <Field label="Notes"><input value={form.notes} onChange={set('notes')} placeholder="Route, storage, controlled substance schedule..."/></Field>
        <Field label="Vendor / supplier">
          <div style={{display:'flex',gap:8}}>
            {['mckesson','boundtree'].map(v=>(
              <button key={v} onClick={()=>setForm(f=>({...f,vendor:f.vendor===v?'':v}))} style={{flex:1,padding:'9px 12px',borderRadius:'var(--radius-md)',border:form.vendor===v?'none':'1px solid var(--color-border)',background:form.vendor===v?'#1a1a1a':'var(--color-bg-secondary)',color:form.vendor===v?'#fff':'var(--color-text-secondary)',fontSize:14,fontWeight:form.vendor===v?600:400,cursor:'pointer',fontFamily:'var(--font)'}}>
                {v==='mckesson'?'McKesson':'Bound Tree'}
              </button>
            ))}
          </div>
        </Field>
        <button onClick={handleSave} disabled={!form.name.trim()||saving} style={{...btnP,width:'100%',marginTop:8,opacity:form.name.trim()&&!saving?1:0.45}}>{saving?'Saving...':isEdit?'Save changes':'Save to library'}</button>
      </div>
      {addStockPrompt&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'20px'}}>
          <div style={{background:'var(--color-bg)',borderRadius:'var(--radius-lg)',padding:'28px 24px',width:'100%',maxWidth:360,textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:10}}>✓</div>
            <div style={{fontSize:17,fontWeight:700,marginBottom:8}}>Item saved!</div>
            <div style={{fontSize:14,color:'var(--color-text-secondary)',marginBottom:24}}>Do you want to add stock for this item now?</div>
            <button onClick={()=>navigate('addstock',{libraryId:addStockPrompt})} style={{...btnP,width:'100%',marginBottom:10}}>Yes, add stock</button>
            <button onClick={()=>navigate('library')} style={{...btnS,width:'100%'}}>No, done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickReceiveView({ library, stock, locations, categories, navigate, onSaveStock, onAppendStock, onSaveLibrary }) {
  const [phase,setPhase]=useState('camera');
  const [scanResult,setScanResult]=useState(null);
  const [matchedItem,setMatchedItem]=useState(null);
  const [capturedPhoto,setCapturedPhoto]=useState(null);
  const [selectedLocation,setSelectedLocation]=useState('supply-room');
  const [count,setCount]=useState('');
  const [expirations,setExpirations]=useState([]);
  const [sessionCount,setSessionCount]=useState(0);
  const [vendor,setVendor]=useState('');
  const quick=[1,2,3,4,5,6];

  function handleScanConfirm(result, photo){const matched=result.matchedId?library.find(d=>d.id===result.matchedId)||null:null;setCapturedPhoto(photo);setScanResult(result);setMatchedItem(matched);setVendor(matched?.vendor||'');setPhase('location');}
  function handleCountNext(){const n=parseInt(count);if(!n||n<1)return;setExpirations(Array(n).fill(scanResult?.expiration||''));setPhase('expirations');}
  async function handleSave(){const newEntries=expirations.map(exp=>({id:uid(),libraryId:matchedItem.id,locationId:selectedLocation,expiration:exp||'NA',status:'active',addedAt:new Date().toISOString(),lot:scanResult?.lot||'',barcode:scanResult?.barcode||''}));if(matchedItem&&vendor!==(matchedItem.vendor||'')){await onSaveLibrary(library.map(d=>d.id===matchedItem.id?{...d,vendor}:d));}if(onAppendStock){await onAppendStock(newEntries);}else{onSaveStock([...stock,...newEntries]);}setSessionCount(c=>c+parseInt(count));setPhase('camera');setScanResult(null);setMatchedItem(null);setCapturedPhoto(null);setCount('');setExpirations([]);setVendor('');}
  function reset(){setPhase('camera');setScanResult(null);setMatchedItem(null);setCapturedPhoto(null);setCount('');setExpirations([]);setVendor('');}

  if(phase==='camera')return(
    <div>
      <div style={{display:'flex',alignItems:'center',padding:'16px 20px 0',marginBottom:12}}>
        <button onClick={()=>navigate(-1)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-secondary)',fontSize:14,fontFamily:'var(--font)'}}>← Back</button>
        <span style={{flex:1,textAlign:'center',fontSize:17,fontWeight:700}}>Quick Receive</span>
        {sessionCount>0&&<span style={{fontSize:13,color:'var(--color-success-text)',fontWeight:600}}>{sessionCount} added</span>}
      </div>
      <div style={{padding:'0 20px'}}>
        <LiveScanner library={library.filter(d=>d.status!=='inactive')} onConfirm={handleScanConfirm} onManual={()=>{setScanResult({});setPhase('location');}}/>
      </div>
    </div>
  );

  if(phase==='location')return(
    <div>
      <TopBar title="Quick Receive" onBack={reset}/>
      <div style={{padding:'0 20px'}}>
        {matchedItem?(
          <div style={{background:'var(--color-success-bg)',border:'1px solid var(--color-success-border)',borderRadius:'var(--radius-lg)',padding:'12px 14px',marginBottom:16,display:'flex',alignItems:'center',gap:12}}>
            {matchedItem.profilePhoto&&<img src={`data:image/jpeg;base64,${matchedItem.profilePhoto}`} alt="" style={{width:44,height:44,objectFit:'cover',borderRadius:8,flexShrink:0}}/>}
            <div><div style={{fontSize:12,color:'var(--color-success-text)',fontWeight:700}}>✓ Found in library</div><div style={{fontSize:15,fontWeight:700}}>{matchedItem.name}</div>{scanResult?.expiration&&<div style={{fontSize:12,color:'var(--color-text-secondary)',marginTop:2}}>Exp: {scanResult.expiration}</div>}</div>
          </div>
        ):(
          <div style={{background:'var(--color-warning-bg)',border:'1px solid var(--color-warning-border)',borderRadius:'var(--radius-lg)',padding:'12px 14px',marginBottom:16}}>
            <div style={{fontSize:12,color:'var(--color-warning-text)',fontWeight:700,marginBottom:4}}>⚠ Not in library</div>
            <div style={{fontSize:15,fontWeight:700}}>{scanResult?.matchedName||'Unknown'}</div>
          </div>
        )}
        {matchedItem&&(
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:600,color:'var(--color-text-secondary)',marginBottom:8}}>Vendor / supplier</div>
            <div style={{display:'flex',gap:8}}>
              {['mckesson','boundtree'].map(v=>(
                <button key={v} onClick={()=>setVendor(vendor===v?'':v)} style={{flex:1,padding:'9px',borderRadius:'var(--radius-md)',border:vendor===v?'none':'1px solid var(--color-border)',background:vendor===v?'#1a1a1a':'var(--color-bg-secondary)',color:vendor===v?'#fff':'var(--color-text-secondary)',fontSize:13,fontWeight:vendor===v?600:400,cursor:'pointer',fontFamily:'var(--font)'}}>
                  {v==='mckesson'?'McKesson':'Bound Tree'}
                </button>
              ))}
            </div>
          </div>
        )}
        {!matchedItem?(
          <><button onClick={()=>navigate('additem',{scanData:{name:scanResult?.matchedName||'',notes:[scanResult?.route,scanResult?.dosageForm].filter(Boolean).join(', '),barcode:scanResult?.barcode||''},capturedPhoto})} style={{...btnP,width:'100%',marginBottom:10}}>Add to library</button><button onClick={()=>navigate('quickupload',{prePhoto:capturedPhoto||undefined})} style={{...btnS,width:'100%',marginBottom:10}}>📤 Quick Upload — review later</button><button onClick={reset} style={{...btnS,width:'100%'}}>Skip — scan next</button></>
        ):(
          <><div style={{fontSize:13,fontWeight:600,marginBottom:10}}>Where is this going?</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16,maxHeight:280,overflowY:'auto'}}>
            {locations.map(loc=><button key={loc.id} onClick={()=>setSelectedLocation(loc.id)} style={{padding:'10px',borderRadius:'var(--radius-md)',border:selectedLocation===loc.id?'2px solid #1a1a1a':'1px solid var(--color-border)',background:selectedLocation===loc.id?'var(--color-bg-secondary)':'var(--color-bg)',fontWeight:selectedLocation===loc.id?700:400,fontSize:12,cursor:'pointer',fontFamily:'var(--font)',textAlign:'left',display:'flex',alignItems:'center',gap:6}}><span>{loc.icon}</span><span>{loc.name}</span></button>)}
          </div>
          <button onClick={()=>setPhase('count')} style={{...btnG,width:'100%'}}>Next → how many?</button></>
        )}
      </div>
    </div>
  );

  if(phase==='count')return(<div><TopBar title={matchedItem?.name} onBack={()=>setPhase('location')}/><div style={{padding:'0 20px'}}><div style={{background:'var(--color-bg-secondary)',borderRadius:'var(--radius-md)',padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--color-text-secondary)',textAlign:'center'}}>→ {locations.find(l=>l.id===selectedLocation)?.name}<br/>How many units?</div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>{quick.map(n=><button key={n} onClick={()=>setCount(String(n))} style={{padding:'14px',borderRadius:'var(--radius-md)',border:count===String(n)?'none':'1px solid var(--color-border)',background:count===String(n)?'#1a1a1a':'var(--color-bg-secondary)',color:count===String(n)?'#fff':'var(--color-text)',fontWeight:700,fontSize:18,cursor:'pointer',fontFamily:'var(--font)'}}>{n}</button>)}</div><input value={count} onChange={e=>setCount(e.target.value)} type="number" min="1" placeholder="Other amount" style={{textAlign:'center',fontWeight:600,fontSize:16,marginBottom:16}}/><button onClick={handleCountNext} disabled={!parseInt(count)||parseInt(count)<1} style={{...btnG,width:'100%',opacity:parseInt(count)>0?1:0.45}}>Next → expiration dates</button></div></div>);

  if(phase==='expirations')return(<div><TopBar title={matchedItem?.name} onBack={()=>setPhase('count')}/><div style={{padding:'0 20px'}}><div style={{background:'var(--color-bg-secondary)',borderRadius:'var(--radius-md)',padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--color-text-secondary)',textAlign:'center'}}>{expirations.length} unit{expirations.length!==1?'s':''} → {locations.find(l=>l.id===selectedLocation)?.name}<br/>Confirm expiration — tap N/A if none</div>{expirations.map((exp,i)=><div key={i} style={{marginBottom:16}}><ExpirationInput label={`Unit ${i+1} of ${expirations.length}`} value={exp} onChange={v=>{const next=[...expirations];next[i]=v;setExpirations(next);}}/></div>)}<button onClick={handleSave} style={{...btnG,width:'100%',marginTop:8}}>✓ Confirm — save {expirations.length} unit{expirations.length!==1?'s':''}</button></div></div>);

  return null;
}

function OrderReportView({ library, stock, categories, navigate }) {
  const [vendorFilter,setVendorFilter]=useState('all');
  const report=generateOrderReport(library,stock,categories);
  const date=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const active=stock.filter(s=>s.status==='active');

  const vendorItems=vendorFilter==='all'?null:library
    .filter(d=>d.status!=='inactive'&&d.vendor===vendorFilter)
    .map(item=>{
      const entries=active.filter(s=>s.libraryId===item.id);
      const expired=entries.filter(s=>getStatus(s.expiration).type==='expired').length;
      const expiringSoon=entries.filter(s=>getStatus(s.expiration).type==='soon').length;
      const usable=entries.filter(s=>getStatus(s.expiration).type!=='expired').length;
      const par=(item.sfotPar||0)+(item.hhaPar||0);
      const needed=Math.max(0,par-usable);
      return{item,total:entries.length,expired,expiringSoon,usable,par,needed};
    })
    .filter(({expired,expiringSoon,needed,total})=>expired>0||expiringSoon>0||needed>0||total>0)
    .sort((a,b)=>{
      const scoreA=(a.needed>0?3:0)+(a.expired>0?2:0)+(a.expiringSoon>0?1:0);
      const scoreB=(b.needed>0?3:0)+(b.expired>0?2:0)+(b.expiringSoon>0?1:0);
      return scoreB-scoreA;
    });

  const allItems=report.flatMap(s=>s.items);
  const toOrder=allItems.filter(i=>i.needed>0);
  const belowPar=allItems.filter(i=>i.usable<i.par);
  function exportCSV(){const rows=[['Category','Item','SFOT Par','HHA Par','Total Par','Total Stock','Expired','Expiring This Month','Usable Stock','Order Qty','Status']];report.forEach(({category,items})=>{items.forEach(({item,total,expired,expiringSoon,usable,par,needed})=>{rows.push([category.name,item.name,item.sfotPar||0,item.hhaPar||0,par,total,expired,expiringSoon,usable,needed,needed>0?'ORDER':'OK']);});});const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`ems-order-report-${new Date().toISOString().slice(0,10)}.csv`;a.click();}
  const vendorLabel=vendorFilter==='mckesson'?'McKesson':vendorFilter==='boundtree'?'Bound Tree':'All';
  function exportVendorCSV(){
    const rows=[['Vendor','Item','Category','Total Stock','Expired','Expiring This Month','Usable Stock','SFOT Par','HHA Par','Total Par','Need to Order','Status']];
    (vendorItems||[]).forEach(({item,total,expired,expiringSoon,usable,par,needed})=>{
      const cat=categories.find(c=>c.id===item.category);
      rows.push([vendorLabel,item.name,cat?.name||'',total,expired,expiringSoon,usable,item.sfotPar||0,item.hhaPar||0,par,needed,needed>0?'ORDER':expired>0?'EXPIRED':expiringSoon>0?'EXP SOON':'OK']);
    });
    const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`${vendorFilter}-report-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }
  return(
    <div style={{paddingBottom:40}}>
      <TopBar title="Order Report" subtitle={date} onBack={()=>navigate(-1)} right={<button onClick={vendorFilter==='all'?exportCSV:exportVendorCSV} style={{...btnS,padding:'7px 14px',fontSize:12}}>Export CSV</button>}/>
      <div style={{padding:'0 20px'}}>
        <div style={{display:'flex',gap:0,marginBottom:16,borderBottom:'1px solid var(--color-border)'}}>
          {[['all','All'],['mckesson','McKesson'],['boundtree','Bound Tree']].map(([id,label])=>(
            <button key={id} onClick={()=>setVendorFilter(id)} style={{flex:1,padding:'10px',border:'none',borderBottom:vendorFilter===id?'2px solid var(--color-text)':'2px solid transparent',background:'transparent',color:vendorFilter===id?'var(--color-text)':'var(--color-text-secondary)',fontWeight:vendorFilter===id?600:400,fontSize:13,cursor:'pointer',fontFamily:'var(--font)',marginBottom:-1}}>{label}</button>
          ))}
        </div>

        {vendorFilter==='all'?(
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:20}}>
              {[{label:'Items to order',value:toOrder.length,type:'expired'},{label:'Below par',value:belowPar.length,type:'soon'},{label:'Total items',value:allItems.length,type:'none'}].map(({label,value,type})=>{const s=SS[type];const hasAny=value>0&&type!=='none';return<div key={label} style={{background:hasAny?s.bg:'var(--color-bg-secondary)',border:hasAny?`1px solid ${s.border}`:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',padding:'12px 8px',textAlign:'center'}}><div style={{fontSize:24,fontWeight:700,color:hasAny?s.text:'var(--color-text)',marginBottom:2}}>{value}</div><div style={{fontSize:11,color:hasAny?s.text:'var(--color-text-tertiary)'}}>{label}</div></div>;})}
            </div>
            {report.map(({category,items})=>(
              <div key={category.id} style={{marginBottom:24}}>
                <SectionHeader title={`${category.icon} ${category.name}`}/>
                {items.map(({item,total,expired,expiringSoon,usable,par,needed})=>{const isUrgent=needed>0&&expired>0;const isNeeded=needed>0;const sfot=item.sfotPar||0;const hha=item.hhaPar||0;return<div key={item.id} style={{padding:'13px 14px',background:isUrgent?'var(--color-danger-bg)':isNeeded?'var(--color-warning-bg)':'var(--color-bg)',border:`1px solid ${isUrgent?'var(--color-danger-border)':isNeeded?'var(--color-warning-border)':'var(--color-border)'}`,borderRadius:'var(--radius-lg)',marginBottom:8}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}><div style={{fontWeight:700,fontSize:14}}>{item.name}</div>{isNeeded?<span style={{background:isUrgent?'var(--color-danger-text)':'var(--color-warning-text)',color:'#fff',fontSize:12,fontWeight:700,padding:'3px 10px',borderRadius:20}}>ORDER {needed}{isUrgent?' ⚠':''}</span>:<span style={{fontSize:12,fontWeight:700,color:'var(--color-success-text)'}}>✓ OK</span>}</div><div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:4}}>{[['SFOT par',sfot],['HHA par',hha],['Total stock',total],['Expired',expired,expired>0?'var(--color-danger-text)':null],['Expiring this month',expiringSoon,expiringSoon>0?'var(--color-warning-text)':null],['Usable stock',usable,usable<par?'var(--color-danger-text)':null],['Total par',par],['Need to order',needed,needed>0?'var(--color-warning-text)':null]].map(([label,value,color])=><div key={label} style={{fontSize:12}}><span style={{color:'var(--color-text-secondary)'}}>{label}: </span><span style={{fontWeight:600,color:color||'var(--color-text)'}}>{value}</span></div>)}</div></div>;})}
              </div>
            ))}
            {allItems.length===0&&<EmptyState icon="📋" title="No items with par set" subtitle="Set station par on library items to generate order reports" action={<button onClick={()=>navigate('library')} style={{...btnP,padding:'10px 20px'}}>Go to Library</button>}/>}
          </>
        ):(
          <>
            <div style={{fontSize:13,color:'var(--color-text-secondary)',marginBottom:16}}>
              Items from <strong>{vendorLabel}</strong> that are low, expired, or expiring soon
            </div>
            {!vendorItems||vendorItems.length===0?(
              <EmptyState icon="✅" title={`No issues for ${vendorLabel}`} subtitle="All items from this vendor are stocked and current"/>
            ):(
              vendorItems.map(({item,total,expired,expiringSoon,usable,par,needed})=>{
                const isUrgent=needed>0&&expired>0;const isNeeded=needed>0;const hasExpiry=expired>0||expiringSoon>0;
                const cat=categories.find(c=>c.id===item.category);
                return(
                  <div key={item.id} onClick={()=>navigate('drugdetail',{libraryId:item.id})} style={{padding:'13px 14px',background:isUrgent?'var(--color-danger-bg)':isNeeded?'var(--color-warning-bg)':hasExpiry?'var(--color-warning-bg)':'var(--color-bg)',border:`1px solid ${isUrgent?'var(--color-danger-border)':hasExpiry?'var(--color-warning-border)':'var(--color-border)'}`,borderRadius:'var(--radius-lg)',marginBottom:8,cursor:'pointer'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:16}}>{cat?.icon||'📦'}</span>
                        <span style={{fontWeight:700,fontSize:14}}>{item.name}</span>
                      </div>
                      <div style={{display:'flex',gap:6,flexShrink:0}}>
                        {isNeeded&&<span style={{background:isUrgent?'var(--color-danger-text)':'var(--color-warning-text)',color:'#fff',fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:20}}>ORDER {needed}</span>}
                        {expired>0&&<span style={{background:'var(--color-danger-text)',color:'#fff',fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:20}}>{expired} EXPIRED</span>}
                        {expiringSoon>0&&!isNeeded&&<span style={{background:'var(--color-warning-text)',color:'#fff',fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:20}}>{expiringSoon} EXP SOON</span>}
                      </div>
                    </div>
                    <div style={{display:'flex',gap:12,fontSize:12,color:'var(--color-text-secondary)'}}>
                      <span>Stock: <strong style={{color:'var(--color-text)'}}>{total}</strong></span>
                      {par>0&&<span>Par: <strong style={{color:'var(--color-text)'}}>{par}</strong></span>}
                      {expired>0&&<span style={{color:'var(--color-danger-text)',fontWeight:600}}>{expired} expired</span>}
                      {expiringSoon>0&&<span style={{color:'var(--color-warning-text)',fontWeight:600}}>{expiringSoon} exp soon</span>}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SettingsView({ library, stock, locations, categories, templates, navigate, onSaveLocations, onSaveCategories, onSaveTemplates, onSaveStock }) {
  const [tab,setTab]=useState('locations');
  return(
    <div style={{paddingBottom:40}}>
      <TopBar title="Settings" onBack={()=>navigate(-1)}/>
      <div style={{padding:'0 20px'}}>
        <div style={{display:'flex',gap:0,marginBottom:16,borderBottom:'1px solid var(--color-border)'}}>
          {[['locations','Locations'],['categories','Categories'],['templates','Templates']].map(([id,label])=><button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:'10px',border:'none',borderBottom:tab===id?'2px solid var(--color-text)':'2px solid transparent',background:'transparent',color:tab===id?'var(--color-text)':'var(--color-text-secondary)',fontWeight:tab===id?600:400,fontSize:13,cursor:'pointer',fontFamily:'var(--font)',marginBottom:-1}}>{label}</button>)}
        </div>
        {tab==='locations'&&<>
          {locations.map(loc=><div key={loc.id} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 14px',background:'var(--color-bg)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',marginBottom:8}}>
            <span style={{fontSize:20}}>{loc.icon}</span>
            <span style={{flex:1,fontWeight:500,fontSize:14}}>{loc.name}</span>
            <button onClick={()=>{const name=prompt('Rename:',loc.name);if(name)onSaveLocations(locations.map(l=>l.id===loc.id?{...l,name}:l));}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-tertiary)',fontSize:13,fontFamily:'var(--font)'}}>Rename</button>
            <button onClick={()=>{if(!window.confirm(`Delete ${loc.name}? Stock moves to Supply Room.`))return;onSaveLocations(locations.filter(l=>l.id!==loc.id));onSaveStock(stock.map(s=>s.locationId===loc.id?{...s,locationId:'supply-room'}:s));}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-danger-text)',fontSize:13,fontFamily:'var(--font)'}}>Delete</button>
          </div>)}
          <button onClick={()=>{const name=prompt('Location name:');if(!name)return;const icon=prompt('Icon (emoji):')||'📦';onSaveLocations([...locations,{id:uid(),name,icon,type:'bag',templateId:null}]);}} style={{...btnS,width:'100%',marginTop:8}}>+ Add location</button>
        </>}
        {tab==='categories'&&<>
          {categories.map(cat=><div key={cat.id} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 14px',background:'var(--color-bg)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',marginBottom:8}}>
            <span style={{fontSize:20}}>{cat.icon}</span>
            <span style={{flex:1,fontWeight:500,fontSize:14}}>{cat.name}</span>
            <button onClick={()=>{const name=prompt('Rename:',cat.name);if(name)onSaveCategories(categories.map(c=>c.id===cat.id?{...c,name}:c));}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-text-tertiary)',fontSize:13,fontFamily:'var(--font)'}}>Rename</button>
          </div>)}
          <button onClick={()=>{const name=prompt('Category name:');if(!name)return;const icon=prompt('Emoji icon:')||'📦';onSaveCategories([...categories,{id:uid(),name,icon}]);}} style={{...btnS,width:'100%',marginTop:8}}>+ Add category</button>
        </>}
        {tab==='templates'&&<>
          {templates.length===0&&<EmptyState icon="📋" title="No templates yet" subtitle="Create a template to quickly populate new bags"/>}
          {templates.map(tmpl=><div key={tmpl.id} onClick={()=>navigate('edittemplate',{templateId:tmpl.id})} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:'var(--color-bg)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',marginBottom:8,cursor:'pointer'}}><div style={{flex:1}}><div style={{fontWeight:600,fontSize:14}}>{tmpl.name}</div><div style={{fontSize:12,color:'var(--color-text-secondary)',marginTop:2}}>{tmpl.items?.length||0} items</div></div><span style={{color:'var(--color-text-tertiary)',fontSize:18}}>›</span></div>)}
          <button onClick={()=>{const name=prompt('Template name:');if(!name)return;onSaveTemplates([...templates,{id:uid(),name,items:[]}]);}} style={{...btnS,width:'100%',marginTop:8}}>+ Add template</button>
        </>}
      </div>
    </div>
  );
}

function TemplateEditorView({ templateId, templates, library, categories, navigate, onSaveTemplates }) {
  const tmpl=templates.find(t=>t.id===templateId);
  const [items,setItems]=useState(tmpl?.items||[]);
  const [search,setSearch]=useState('');
  if(!tmpl)return null;
  const q=search.trim().toLowerCase();
  function save(){onSaveTemplates(templates.map(t=>t.id===templateId?{...t,items}:t));navigate('settings');}
  return(
    <div style={{paddingBottom:40}}>
      <TopBar title={tmpl.name} onBack={()=>navigate('settings')} right={<button onClick={save} style={{...btnG,padding:'7px 14px',fontSize:13}}>Save</button>}/>
      <div style={{padding:'0 20px'}}>
        <SectionHeader title={`Items in template (${items.length})`}/>
        {items.length===0&&<div style={{fontSize:13,color:'var(--color-text-tertiary)',textAlign:'center',padding:'1rem'}}>No items yet</div>}
        {items.map(({libraryId,bagPar})=>{const item=library.find(d=>d.id===libraryId);if(!item)return null;const cat=categories.find(c=>c.id===item.category);return<div key={libraryId} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:'var(--color-bg)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',marginBottom:6}}><span style={{fontSize:16}}>{cat?.icon||'📦'}</span><span style={{flex:1,fontSize:13,fontWeight:500}}>{item.name}</span><div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:11,color:'var(--color-text-tertiary)'}}>par:</span><input value={bagPar} onChange={e=>setItems(prev=>prev.map(i=>i.libraryId===libraryId?{...i,bagPar:parseInt(e.target.value)||1}:i))} type="number" min="1" style={{width:48,textAlign:'center',padding:'4px',fontSize:13}}/></div><button onClick={()=>setItems(prev=>prev.filter(i=>i.libraryId!==libraryId))} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-danger-text)',fontSize:18,lineHeight:1}}>×</button></div>;})}
        <div style={{marginTop:16}}>
          <SectionHeader title="Add from library"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search library..." style={{marginBottom:10}}/>
          {library.filter(i=>i.status!=='inactive').filter(i=>!q||i.name.toLowerCase().includes(q)).filter(i=>!items.find(t=>t.libraryId===i.id)).map(item=>{const cat=categories.find(c=>c.id===item.category);return<div key={item.id} onClick={()=>setItems(prev=>[...prev,{libraryId:item.id,bagPar:1}])} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:'var(--color-bg-secondary)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',marginBottom:6,cursor:'pointer'}}><span style={{fontSize:16}}>{cat?.icon||'📦'}</span><span style={{flex:1,fontSize:13}}>{item.name}</span><span style={{fontSize:18,color:'var(--color-text-tertiary)'}}>+</span></div>;})}
        </div>
      </div>
    </div>
  );
}

function QuickUploadView({ navigate, onSavePendingItem, prePhoto }) {
  const [photos,setPhotos]=useState(prePhoto?[prePhoto]:[]);
  const [notes,setNotes]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const [toast,setToast]=useState(false);
  const [cameraKey,setCameraKey]=useState(0);
  const videoRef=useRef(null);
  const streamRef=useRef(null);
  const [ready,setReady]=useState(false);
  const [err,setErr]=useState(null);

  useEffect(()=>{
    let active=true;
    navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}})
      .then(stream=>{if(!active){stream.getTracks().forEach(t=>t.stop());return;}streamRef.current=stream;if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play().then(()=>setReady(true)).catch(()=>{});}})
      .catch(()=>setErr('Camera unavailable — check permissions'));
    return()=>{active=false;streamRef.current?.getTracks().forEach(t=>t.stop());};
  },[cameraKey]);

  function capture(){
    if(!videoRef.current||!ready||photos.length>=4)return;
    const c=document.createElement('canvas');c.width=videoRef.current.videoWidth;c.height=videoRef.current.videoHeight;
    c.getContext('2d').drawImage(videoRef.current,0,0);
    setPhotos(prev=>[...prev,c.toDataURL('image/jpeg',0.88).split(',')[1]]);
  }

  async function submit(){
    if(photos.length===0)return;
    setSubmitting(true);
    const item={id:uid(),photos,notes:notes.trim(),status:'pending',submittedAt:new Date().toISOString()};
    await onSavePendingItem(item);
    setPhotos([]);setNotes('');setSubmitting(false);
    setToast(true);setTimeout(()=>setToast(false),1800);
    setReady(false);setCameraKey(k=>k+1);
  }

  return(
    <div style={{paddingBottom:20}}>
      <TopBar title="Quick Upload" onBack={()=>navigate(-1)}/>
      {toast&&<div style={{margin:'0 20px 8px',background:'var(--color-success-bg)',color:'var(--color-success-text)',border:'1px solid var(--color-success-border)',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:13,fontWeight:600,textAlign:'center'}}>✓ Submitted — ready for next</div>}
      <div style={{padding:'0 20px'}}>
        {err?(
          <div style={{textAlign:'center',padding:'2rem',color:'var(--color-text-secondary)',fontSize:13}}>{err}</div>
        ):(
          <>
            <div style={{position:'relative',borderRadius:'var(--radius-lg)',overflow:'hidden',marginBottom:12,background:'#000',minHeight:240}}>
              <video ref={videoRef} style={{width:'100%',display:'block',maxHeight:320,objectFit:'cover'}} playsInline muted/>
              {ready&&<>
                <div style={{position:'absolute',inset:'15%',border:'2px solid rgba(255,255,255,0.8)',borderRadius:10,pointerEvents:'none',boxShadow:'0 0 0 9999px rgba(0,0,0,0.45)'}}/>
                <div style={{position:'absolute',bottom:10,left:'50%',transform:'translateX(-50%)',fontSize:11,color:'#fff',background:'rgba(0,0,0,0.6)',padding:'4px 14px',borderRadius:20,whiteSpace:'nowrap'}}>
                  {photos.length===0?'Aim at drug name / label':photos.length===1?'Aim at expiration date':'Any other detail (optional)'}
                </div>
              </>}
              {!ready&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{color:'rgba(255,255,255,0.5)',fontSize:13}}>Starting camera...</span></div>}
            </div>
            <button onClick={capture} disabled={!ready||photos.length>=4} style={{...btnG,width:'100%',marginBottom:10,opacity:ready&&photos.length<4?1:0.5}}>
              📷 Capture photo {photos.length+1}{photos.length===0?' — drug name':photos.length===1?' — expiration date':''}
            </button>
            {photos.length>0&&(
              <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                {photos.map((p,i)=>(
                  <div key={i} style={{position:'relative',width:72,height:72,borderRadius:8,overflow:'hidden',flexShrink:0}}>
                    <img src={`data:image/jpeg;base64,${p}`} alt="" style={{width:72,height:72,objectFit:'cover'}}/>
                    <button onClick={()=>setPhotos(prev=>prev.filter((_,idx)=>idx!==i))} style={{position:'absolute',top:2,right:2,background:'#dc2626',border:'none',color:'#fff',borderRadius:'50%',width:18,height:18,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontSize:11}}>×</button>
                    <div style={{position:'absolute',bottom:0,left:0,right:0,background:'rgba(0,0,0,0.6)',color:'#fff',fontSize:9,textAlign:'center',padding:'2px'}}>{i===0?'Name':i===1?'Exp':'Detail'}</div>
                  </div>
                ))}
                {photos.length<4&&<div style={{width:72,height:72,borderRadius:8,border:'2px dashed var(--color-border)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--color-text-tertiary)',fontSize:22}}>+</div>}
              </div>
            )}
            <div style={{marginBottom:14}}>
              <label style={{display:'block',fontSize:12,fontWeight:500,color:'var(--color-text-secondary)',marginBottom:5}}>Notes (optional)</label>
              <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. from narcotics bag, McKesson box..."/>
            </div>
            <button onClick={submit} disabled={photos.length===0||submitting} style={{...btnP,width:'100%',opacity:photos.length>0&&!submitting?1:0.45}}>
              {submitting?'Submitting...':`Submit ${photos.length} photo${photos.length!==1?'s':''} for review`}
            </button>
            {photos.length===0&&<div style={{fontSize:11,color:'var(--color-text-tertiary)',textAlign:'center',marginTop:8}}>Take at least 1 photo to submit</div>}
          </>
        )}
      </div>
    </div>
  );
}

function PendingQueueView({ pending, spreadsheet, navigate, onSaveSpreadsheet, onSavePendingItem }) {
  const [showComplete,setShowComplete]=useState(false);
  const [rematching,setRematching]=useState(false);
  const [rematchStatus,setRematchStatus]=useState('');
  const [uploadInfo,setUploadInfo]=useState(null);
  const fileRef=useRef(null);
  const pendingItems=pending.filter(p=>p.status==='pending');
  const completeItems=pending.filter(p=>p.status==='complete');
  const shown=showComplete?completeItems:pendingItems;

  function parseCSV(text){
    text=text.replace(/^﻿/,''); // strip UTF-8 BOM
    function splitLine(line){
      const cols=[];let i=0;
      while(i<=line.length){
        if(i===line.length){cols.push('');break;}
        if(line[i]==='"'){
          let j=i+1,val='';
          while(j<line.length){
            if(line[j]==='"'&&line[j+1]==='"'){val+='"';j+=2;}
            else if(line[j]==='"'){j++;break;}
            else{val+=line[j++];}
          }
          cols.push(val.trim());
          while(j<line.length&&line[j]!==',')j++;
          i=j+1;
        }else{
          const end=line.indexOf(',',i);
          if(end<0){cols.push(line.slice(i).trim());break;}
          cols.push(line.slice(i,end).trim());i=end+1;
        }
      }
      return cols;
    }
    const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim().split('\n');
    if(lines.length<2)return{rows:[],itemIdx:-1,sfotIdx:-1,hhaIdx:-1,header:[]};
    // Step 1: find the row containing "Item" column (up to row 10)
    let itemRowIdx=-1,itemIdx=-1;
    for(let r=0;r<Math.min(10,lines.length);r++){
      const cols=splitLine(lines[r]).map(x=>x.trim());
      const idx=cols.findIndex(h=>/^item$/i.test(h));
      if(idx>=0){itemRowIdx=r;itemIdx=idx;break;}
    }
    if(itemRowIdx<0)return{rows:[],itemIdx:-1,sfotIdx:-1,hhaIdx:-1,header:[]};
    // Step 2: scan only the Item row + next 3 rows for SFOT and HHA sub-headers
    let sfotIdx=-1,hhaIdx=-1,lastHeaderRow=itemRowIdx;
    const displayHeader=[];
    for(let r=itemRowIdx;r<Math.min(itemRowIdx+4,lines.length);r++){
      const cols=splitLine(lines[r]).map(x=>x.trim());
      let found=false;
      cols.forEach((h,i)=>{
        if(h)displayHeader[i]=displayHeader[i]||h;
        if(/sfot/i.test(h)){sfotIdx=i;found=true;}
        if(/hha/i.test(h)){hhaIdx=i;found=true;}
      });
      if(found)lastHeaderRow=r;
    }
    return{rows:lines.slice(lastHeaderRow+1).map(line=>{
      const clean=splitLine(line);
      return{item:clean[itemIdx]||'',sfotPar:sfotIdx>=0?parseInt(clean[sfotIdx])||0:0,hhaPar:hhaIdx>=0?parseInt(clean[hhaIdx])||0:0};
    }).filter(r=>r.item),itemIdx,sfotIdx,hhaIdx,header:displayHeader};
  }

  async function handleFileUpload(e){
    const file=e.target.files?.[0];if(!file)return;
    const text=await file.text();
    const {rows,itemIdx,sfotIdx,hhaIdx,header}=parseCSV(text);
    if(itemIdx<0){
      const cols=header.slice(0,8).join(', ');
      alert(`Could not find "Item" column.\n\nDetected headers: ${cols||'(none)'}\n\nMake sure column A is titled "Item"`);
      e.target.value='';return;
    }
    if(!rows.length){alert('Found the Item column but no data rows');e.target.value='';return;}
    await onSaveSpreadsheet(rows);
    const colLetter=i=>i>=0?`col ${String.fromCharCode(65+i)} "${header[i]}"`:null;
    setUploadInfo({count:rows.length,sfot:colLetter(sfotIdx),hha:colLetter(hhaIdx),allHeaders:header});
    setRematchStatus('');
    e.target.value='';
  }

  async function rematchAll(){
    if(!spreadsheet?.length){alert('Upload a spreadsheet first');return;}
    const toRematch=pendingItems.filter(p=>p.photos?.length);
    if(!toRematch.length){setRematchStatus('No pending items to match');return;}
    setRematching(true);setRematchStatus(`Matching 0 / ${toRematch.length}...`);
    let done=0;
    for(const item of toRematch){
      try{
        const result=await api.scan(item.photos,spreadsheet);
        if(result.sfotPar!=null||result.hhaPar!=null||result.spreadsheetMatch){
          await onSavePendingItem({...item,prefilled:{...item.prefilled,sfotPar:result.sfotPar,hhaPar:result.hhaPar,spreadsheetMatch:result.spreadsheetMatch,name:result.name||item.prefilled?.name}});
        }
      }catch{}
      done++;setRematchStatus(`Matching ${done} / ${toRematch.length}...`);
    }
    setRematching(false);setRematchStatus(`✓ Matched ${done} items`);
    setTimeout(()=>setRematchStatus(''),4000);
  }

  return(
    <div style={{paddingBottom:40}}>
      <TopBar title="Upload Queue" onBack={()=>navigate(-1)} subtitle={`${pendingItems.length} waiting for review`}/>
      <div style={{padding:'0 20px'}}>
        <div style={{background:'var(--color-bg-secondary)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',padding:'14px',marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:600,color:'var(--color-text-secondary)',marginBottom:10}}>PAR SPREADSHEET</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFileUpload} style={{display:'none'}}/>
            <button onClick={()=>{setUploadInfo(null);fileRef.current?.click();}} style={{...btnS,padding:'8px 14px',fontSize:12,flexShrink:0}}>
              📋 Upload new CSV
            </button>
            {spreadsheet?.length>0&&(
              <button onClick={rematchAll} disabled={rematching} style={{...btnP,padding:'8px 14px',fontSize:12,flexShrink:0,opacity:rematching?0.6:1}}>
                {rematching?'Matching...':'🔄 Re-match all pending'}
              </button>
            )}
          </div>
          {spreadsheet?.length>0&&!uploadInfo&&<div style={{fontSize:11,color:'var(--color-text-tertiary)',marginTop:8}}>{spreadsheet.length} items loaded</div>}
          {rematchStatus&&<div style={{fontSize:12,color:'var(--color-success-text)',marginTop:8}}>{rematchStatus}</div>}
          {uploadInfo&&(
            <div style={{marginTop:10,fontSize:12,lineHeight:1.6}}>
              <div style={{color:'var(--color-success-text)',fontWeight:600}}>✓ {uploadInfo.count} items loaded</div>
              <div style={{color:uploadInfo.sfot?'var(--color-text-secondary)':'var(--color-danger-text)'}}>SFOT: {uploadInfo.sfot||'not in file'}</div>
              <div style={{color:uploadInfo.hha?'var(--color-text-secondary)':'var(--color-warning-text)'}}>HHA: {uploadInfo.hha||'not detected'}</div>
              {(!uploadInfo.sfot||!uploadInfo.hha)&&(
                <div style={{marginTop:6,padding:'8px 10px',background:'var(--color-bg)',borderRadius:'var(--radius-sm)',border:'1px solid var(--color-border)'}}>
                  <div style={{fontWeight:600,fontSize:11,color:'var(--color-text-secondary)',marginBottom:4}}>COLUMNS DETECTED IN YOUR CSV:</div>
                  {uploadInfo.allHeaders.map((h,i)=>(
                    <div key={i} style={{fontSize:11,color:'var(--color-text)',fontFamily:'var(--font-mono)'}}>{String.fromCharCode(65+i)}: {h||'(blank)'}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!spreadsheet?.length&&!uploadInfo&&<div style={{fontSize:11,color:'var(--color-text-tertiary)',marginTop:8}}>CSV needs columns: Item, SFOT Par count, HHA Par count</div>}
        </div>
        <div style={{display:'flex',gap:0,marginBottom:16,borderBottom:'1px solid var(--color-border)'}}>
          {[['pending',`Pending (${pendingItems.length})`],['complete',`Complete (${completeItems.length})`]].map(([id,label])=>(
            <button key={id} onClick={()=>setShowComplete(id==='complete')} style={{flex:1,padding:'10px',border:'none',borderBottom:(showComplete?id==='complete':id==='pending')?'2px solid var(--color-text)':'2px solid transparent',background:'transparent',color:(showComplete?id==='complete':id==='pending')?'var(--color-text)':'var(--color-text-secondary)',fontWeight:(showComplete?id==='complete':id==='pending')?600:400,fontSize:13,cursor:'pointer',fontFamily:'var(--font)',marginBottom:-1}}>{label}</button>
          ))}
        </div>
        {shown.length===0?(
          <EmptyState icon={showComplete?'✅':'📭'} title={showComplete?'No completed items yet':'Queue is empty'} subtitle={showComplete?'Items added to library appear here':'Mobile photo uploads will appear here for review'}/>
        ):(
          shown.map(item=>(
            <div key={item.id} onClick={()=>!showComplete&&navigate('reviewpending',{pendingId:item.id})} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:'var(--color-bg)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',marginBottom:8,cursor:showComplete?'default':'pointer'}}>
              {item.photos?.[0]&&<img src={`data:image/jpeg;base64,${item.photos[0]}`} alt="" style={{width:56,height:56,objectFit:'cover',borderRadius:8,flexShrink:0}}/>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{item.prefilled?.name||item.notes||`${item.photos?.length||0} photo${item.photos?.length!==1?'s':''}`}</div>
                {item.prefilled?.spreadsheetMatch&&<div style={{fontSize:11,color:'#1d4ed8',marginBottom:1}}>📋 {item.prefilled.spreadsheetMatch}</div>}
                <div style={{fontSize:11,color:'var(--color-text-tertiary)',marginTop:2}}>{new Date(item.submittedAt).toLocaleString()}</div>
              </div>
              {!showComplete&&<span style={{color:'var(--color-text-tertiary)',fontSize:18}}>›</span>}
              {showComplete&&<span style={{fontSize:11,color:'var(--color-success-text)',fontWeight:600}}>✓ Done</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReviewPendingItemView({ pendingId, pending, library, stock, locations, categories, spreadsheet, navigate, onSaveLibrary, onSaveStock, onSavePendingItem }) {
  const item=pending.find(p=>p.id===pendingId);
  const pre=item?.prefilled||{};
  const [form,setForm]=useState({name:pre.name||'',category:categories[0]?.id||'',packagingType:'vial',unit:'',size:'',notes:'',sfotPar:pre.sfotPar!=null?String(pre.sfotPar):'',hhaPar:pre.hhaPar!=null?String(pre.hhaPar):'',status:'active',vendor:''});
  const [filling,setFilling]=useState(false);
  const [filled,setFilled]=useState(false);
  const [fillError,setFillError]=useState(null);
  const [spreadsheetMatch,setSpreadsheetMatch]=useState(pre.spreadsheetMatch||null);
  const [saving,setSaving]=useState(false);
  const [addStockPrompt,setAddStockPrompt]=useState(null);
  const [showSheet,setShowSheet]=useState(false);
  const [sheetSearch,setSheetSearch]=useState('');
  const set=k=>e=>setForm(f=>({...f,[k]:e.target.value}));

  if(!item)return null;

  async function aiFill(){
    setFilling(true);setFillError(null);setSpreadsheetMatch(null);
    try{
      const result=await api.scan(item.photos, spreadsheet);
      setForm(f=>({...f,name:result.name||f.name,category:categories.find(c=>c.id===result.category)?.id||result.category||f.category,packagingType:result.packagingType||f.packagingType,unit:result.unit||f.unit,size:result.size||f.size,notes:result.notes||f.notes,sfotPar:result.sfotPar!=null?String(result.sfotPar):f.sfotPar,hhaPar:result.hhaPar!=null?String(result.hhaPar):f.hhaPar}));
      if(result.spreadsheetMatch)setSpreadsheetMatch(result.spreadsheetMatch);
      setFilled(true);
    }catch{setFillError('Could not read label — fill in manually below');}
    setFilling(false);
  }

  async function handleSave(){
    setSaving(true);
    const newId=uid();
    const newItem={id:newId,...form,profilePhoto:item.photos?.[0]||null,sfotPar:parseInt(form.sfotPar)||0,hhaPar:parseInt(form.hhaPar)||0,addedAt:new Date().toISOString()};
    await onSaveLibrary([newItem,...library]);
    await onSavePendingItem({...item,status:'complete'});
    setSaving(false);
    setAddStockPrompt(newId);
  }

  return(
    <div style={{paddingBottom:20}}>
      <TopBar title="Review Upload" onBack={()=>navigate('pendingqueue')} subtitle={new Date(item.submittedAt).toLocaleString()}/>
      <div style={{padding:'0 20px'}}>
        <div style={{display:'flex',gap:8,marginBottom:14,overflowX:'auto',paddingBottom:4}}>
          {item.photos?.map((p,i)=>(
            <img key={i} src={`data:image/jpeg;base64,${p}`} alt="" style={{width:130,height:130,objectFit:'cover',borderRadius:10,flexShrink:0}}/>
          ))}
        </div>
        {item.notes&&<div style={{background:'var(--color-bg-secondary)',border:'1px solid var(--color-border)',borderRadius:'var(--radius-md)',padding:'10px 14px',marginBottom:14,fontSize:13,color:'var(--color-text-secondary)'}}>Note: {item.notes}</div>}
        {spreadsheet?.length>0&&(
          <div style={{marginBottom:14,border:'1px solid var(--color-border)',borderRadius:'var(--radius-lg)',overflow:'hidden'}}>
            <button onClick={()=>setShowSheet(s=>!s)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:'var(--color-bg-secondary)',border:'none',cursor:'pointer',fontFamily:'var(--font)',fontSize:13,fontWeight:600,color:'var(--color-text)'}}>
              <span>📋 PAR reference ({spreadsheet.length} items)</span>
              <span style={{color:'var(--color-text-tertiary)',fontSize:16}}>{showSheet?'▲':'▼'}</span>
            </button>
            {showSheet&&(
              <div>
                <div style={{padding:'8px 10px',borderTop:'1px solid var(--color-border)',background:'var(--color-bg)'}}>
                  <input value={sheetSearch} onChange={e=>setSheetSearch(e.target.value)} placeholder="Search spreadsheet..." style={{fontSize:12,padding:'6px 10px'}}/>
                </div>
                <div style={{maxHeight:220,overflowY:'auto'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:0,fontSize:11,fontWeight:700,color:'var(--color-text-tertiary)',padding:'4px 12px',borderBottom:'1px solid var(--color-border)',background:'var(--color-bg-secondary)'}}>
                    <span>ITEM</span><span style={{textAlign:'right',paddingRight:12}}>SFOT</span><span style={{textAlign:'right'}}>HHA</span>
                  </div>
                  {spreadsheet.filter(r=>!sheetSearch||r.item.toLowerCase().includes(sheetSearch.toLowerCase())).map((row,i)=>(
                    <button key={i} onClick={()=>{setForm(f=>({...f,sfotPar:String(row.sfotPar),hhaPar:String(row.hhaPar),name:f.name||row.item}));setSpreadsheetMatch(row.item);setShowSheet(false);}} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:0,width:'100%',padding:'8px 12px',background:'none',border:'none',borderBottom:'1px solid var(--color-border)',cursor:'pointer',fontFamily:'var(--font)',textAlign:'left',fontSize:12,color:'var(--color-text)'}}>
                      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8,color:'var(--color-text)'}}>{row.item}</span>
                      <span style={{fontWeight:700,color:'var(--color-success-text)',textAlign:'right',paddingRight:12}}>{row.sfotPar||'—'}</span>
                      <span style={{fontWeight:700,color:'var(--color-warning-text)',textAlign:'right'}}>{row.hhaPar||'—'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {!filled?(
          <button onClick={aiFill} disabled={filling} style={{...btnP,width:'100%',marginBottom:16,opacity:filling?0.7:1}}>
            {filling?'Reading label photos...':'🤖 AI Fill — read label photos'}
          </button>
        ):(
          <div style={{background:'var(--color-success-bg)',color:'var(--color-success-text)',border:'1px solid var(--color-success-border)',padding:'10px 14px',borderRadius:'var(--radius-md)',marginBottom:spreadsheetMatch?0:16,fontSize:13,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>✓ AI filled — review and adjust below</span>
            <button onClick={aiFill} style={{background:'none',border:'none',cursor:'pointer',color:'var(--color-success-text)',fontSize:12,fontFamily:'var(--font)',textDecoration:'underline'}}>Refill</button>
          </div>
        )}
        {spreadsheetMatch&&<div style={{background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',padding:'8px 14px',borderRadius:'0 0 var(--radius-md) var(--radius-md)',marginBottom:16,fontSize:12}}>📋 Matched spreadsheet: <strong>{spreadsheetMatch}</strong></div>}
        {fillError&&<div style={{fontSize:12,color:'var(--color-danger-text)',marginBottom:12}}>{fillError}</div>}
        <Field label="Item name *"><input value={form.name} onChange={set('name')} placeholder="e.g. Aspirin 325mg, NPA 28fr, Tourniquet"/></Field>
        <Field label="Category">
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {categories.map(cat=><button key={cat.id} onClick={()=>setForm(f=>({...f,category:cat.id}))} style={{padding:'6px 12px',borderRadius:20,border:form.category===cat.id?'none':'1px solid var(--color-border)',background:form.category===cat.id?'#1a1a1a':'var(--color-bg-secondary)',color:form.category===cat.id?'#fff':'var(--color-text-secondary)',fontSize:13,cursor:'pointer',fontWeight:form.category===cat.id?600:400,fontFamily:'var(--font)'}}>{cat.icon} {cat.name}</button>)}
          </div>
        </Field>
        <PackagingSelector value={form.packagingType} onChange={v=>setForm(f=>({...f,packagingType:v}))}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <Field label="Unit"><input value={form.unit} onChange={set('unit')} placeholder="mL, mg, tablet..."/></Field>
          <Field label="Size / gauge"><input value={form.size} onChange={set('size')} placeholder="28fr, Large, 18ga..."/></Field>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <Field label="SFOT Par"><input value={form.sfotPar} onChange={set('sfotPar')} type="number" min="0" placeholder="0"/></Field>
          <Field label="HHA Par"><input value={form.hhaPar} onChange={set('hhaPar')} type="number" min="0" placeholder="0"/></Field>
        </div>
        <Field label="Notes"><input value={form.notes} onChange={set('notes')} placeholder="Route, storage, controlled substance schedule..."/></Field>
        <Field label="Vendor / supplier">
          <div style={{display:'flex',gap:8}}>
            {['mckesson','boundtree'].map(v=>(
              <button key={v} onClick={()=>setForm(f=>({...f,vendor:f.vendor===v?'':v}))} style={{flex:1,padding:'9px 12px',borderRadius:'var(--radius-md)',border:form.vendor===v?'none':'1px solid var(--color-border)',background:form.vendor===v?'#1a1a1a':'var(--color-bg-secondary)',color:form.vendor===v?'#fff':'var(--color-text-secondary)',fontSize:14,fontWeight:form.vendor===v?600:400,cursor:'pointer',fontFamily:'var(--font)'}}>
                {v==='mckesson'?'McKesson':'Bound Tree'}
              </button>
            ))}
          </div>
        </Field>
        <button onClick={handleSave} disabled={!form.name.trim()||saving} style={{...btnG,width:'100%',marginTop:8,opacity:form.name.trim()&&!saving?1:0.45}}>
          {saving?'Saving...':'✓ Save to library'}
        </button>
      </div>
      {addStockPrompt&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'20px'}}>
          <div style={{background:'var(--color-bg)',borderRadius:'var(--radius-lg)',padding:'28px 24px',width:'100%',maxWidth:360,textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:10}}>✓</div>
            <div style={{fontSize:17,fontWeight:700,marginBottom:8}}>Added to library!</div>
            <div style={{fontSize:14,color:'var(--color-text-secondary)',marginBottom:24}}>Do you want to add stock for this item now?</div>
            <button onClick={()=>navigate('addstock',{libraryId:addStockPrompt})} style={{...btnP,width:'100%',marginBottom:10}}>Yes, add stock</button>
            <button onClick={()=>navigate('pendingqueue')} style={{...btnS,width:'100%'}}>No, back to queue</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BottomNav({ view, navigate, isDesktop, pendingCount }) {
  const tabs=[{id:'home',icon:'🏠',label:'Home'},{id:isDesktop?'map':'locations',icon:'📍',label:'Locations'},{id:'inventory',icon:'📋',label:'Inventory'},{id:'library',icon:'📦',label:'Library'}];
  return(
    <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:680,background:'var(--color-bg)',borderTop:'1px solid var(--color-border)',display:'flex',zIndex:50}}>
      {tabs.map(tab=>(
        <button key={tab.id} onClick={()=>navigate(tab.id)} style={{flex:1,padding:'10px 8px 14px',background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font)',color:view===tab.id?'var(--color-text)':'var(--color-text-tertiary)',fontWeight:view===tab.id?700:400,fontSize:10,display:'flex',flexDirection:'column',alignItems:'center',gap:2,position:'relative'}}>
          <span style={{fontSize:20}}>{tab.icon}</span>{tab.label}
          {tab.id==='library'&&isDesktop&&pendingCount>0&&<span style={{position:'absolute',top:6,right:'calc(50% - 16px)',background:'#dc2626',color:'#fff',borderRadius:'50%',width:16,height:16,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{pendingCount}</span>}
        </button>
      ))}
      {!isDesktop&&(
        <button onClick={()=>navigate('quickupload')} style={{flex:1,padding:'10px 8px 14px',background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font)',color:view==='quickupload'?'var(--color-text)':'var(--color-text-tertiary)',fontWeight:view==='quickupload'?700:400,fontSize:10,display:'flex',flexDirection:'column',alignItems:'center',gap:2,position:'relative'}}>
          <span style={{fontSize:20}}>📤</span>Upload
          {pendingCount>0&&<span style={{position:'absolute',top:6,right:'calc(50% - 16px)',background:'#dc2626',color:'#fff',borderRadius:'50%',width:16,height:16,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{pendingCount}</span>}
        </button>
      )}
      <button onClick={()=>navigate('quickreceive')} style={{flex:1.5,padding:'8px 8px 12px',background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}>
        <div style={{background:'#1d6b3a',borderRadius:10,padding:'5px 10px',color:'#fff',fontWeight:700,fontSize:11}}>Quick<br/>Receive</div>
      </button>
    </div>
  );
}

export default function App() {
  const [library,setLibrary]=useState([]);
  const [stock,setStock]=useState([]);
  const [locations,setLocations]=useState([]);
  const [categories,setCategories]=useState([]);
  const [templates,setTemplates]=useState([]);
  const [mapData,setMapData]=useState(null);
  const [pending,setPending]=useState([]);
  const [spreadsheet,setSpreadsheet]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saveStatus,setSaveStatus]=useState('');
  const [navStack,setNavStack]=useState([{view:'home',params:{}}]);
  const isDesktop=useIsDesktop();
  const {view,params}=navStack[navStack.length-1];

  useEffect(()=>{
    window.history.pushState({idx:0},'');
    const handler=()=>{setNavStack(prev=>{if(prev.length>1){window.history.pushState({idx:prev.length-1},'');return prev.slice(0,-1);}window.history.pushState({idx:0},'');return prev;});};
    window.addEventListener('popstate',handler);
    return()=>window.removeEventListener('popstate',handler);
  },[]);

  function navigate(view,params={}){if(view===-1){setNavStack(prev=>prev.length>1?prev.slice(0,-1):prev);return;}window.history.pushState({idx:navStack.length},'');setNavStack(prev=>[...prev,{view,params}]);}

  useEffect(()=>{
    Promise.all([api.getLibrary(),api.getStock(),api.getLocations(),api.getCategories(),api.getTemplates(),api.getMap(),api.getPending(),api.getSpreadsheet()])
      .then(([lib,stk,locs,cats,tmpls,map,pend,sheet])=>{setLibrary(Array.isArray(lib)?lib:[]);setStock(Array.isArray(stk)?stk:[]);setLocations(Array.isArray(locs)&&locs.length?locs:DEFAULT_LOCATIONS);setCategories(Array.isArray(cats)&&cats.length?cats:DEFAULT_CATEGORIES);setTemplates(Array.isArray(tmpls)?tmpls:[]);setMapData(map&&!Array.isArray(map)&&typeof map==='object'&&'rooms'in map?map:{rooms:[],pins:[],lines:[],doors:[],bgImage:null});setPending(Array.isArray(pend)?pend:[]);setSpreadsheet(Array.isArray(sheet)?sheet:[]);setLoading(false);})
      .catch(()=>{setLocations(DEFAULT_LOCATIONS);setCategories(DEFAULT_CATEGORIES);setLoading(false);});
  },[]);

  async function persist(setter,data,saveFn){setter(data);setSaveStatus('Saving...');try{await saveFn(data);setSaveStatus('Saved ✓');setTimeout(()=>setSaveStatus(''),2000);}catch{setSaveStatus('Save failed');}}

  // Concurrent-safe library save: sends per-item upsert/delete, re-fetches after
  const saveLibrary = async (newData) => {
    setLibrary(newData);
    setSaveStatus('Saving...');
    try {
      const toUpsert = newData.filter(item => {
        const orig = library.find(c => c.id === item.id);
        return !orig || JSON.stringify(orig) !== JSON.stringify(item);
      });
      const toDelete = library.filter(item => !newData.find(n => n.id === item.id));
      for (const item of toUpsert) await api.post('library', { item });
      for (const item of toDelete) await api.post('library', { deleteId: item.id });
      const fresh = await api.getLibrary();
      if (Array.isArray(fresh)) setLibrary(fresh);
      setSaveStatus('Saved ✓');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch { setSaveStatus('Save failed'); }
  };

  // Concurrent-safe stock save: sends per-item operations, re-fetches after
  const saveStock = async (newData) => {
    setStock(newData);
    setSaveStatus('Saving...');
    try {
      const toAdd    = newData.filter(s => !stock.find(c => c.id === s.id));
      const toDelete = stock.filter(s => !newData.find(n => n.id === s.id));
      const toUpdate = newData.filter(s => {
        const orig = stock.find(c => c.id === s.id);
        return orig && JSON.stringify(orig) !== JSON.stringify(s);
      });
      if (toAdd.length)    await api.post('stock', { entries:   toAdd });
      if (toUpdate.length) await api.post('stock', { upsert:    toUpdate });
      if (toDelete.length) await api.post('stock', { deleteIds: toDelete.map(s => s.id) });
      const fresh = await api.getStock();
      if (Array.isArray(fresh)) setStock(fresh);
      setSaveStatus('Saved ✓');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch { setSaveStatus('Save failed'); }
  };

  const saveLocations =data=>persist(setLocations, data,api.saveLocations);
  const saveCategories=data=>persist(setCategories,data,api.saveCategories);
  const saveTemplates =data=>persist(setTemplates, data,api.saveTemplates);
  const saveMap       =data=>persist(setMapData,   data,api.saveMap);

  const appendStock=async entries=>{try{await api.post('stock',{entries});const updated=await api.getStock();if(Array.isArray(updated))setStock(updated);setSaveStatus('Saved ✓');setTimeout(()=>setSaveStatus(''),2000);}catch{setSaveStatus('Save failed');}};

  const savePendingItem=async item=>{setPending(prev=>{const idx=prev.findIndex(p=>p.id===item.id);if(idx>=0){const n=[...prev];n[idx]=item;return n;}return[item,...prev];});try{await api.savePendingItem(item);}catch{}};
  const deletePendingItem=async id=>{setPending(prev=>prev.filter(p=>p.id!==id));try{await api.deletePending(id);}catch{}};
  const saveSpreadsheet=async rows=>{setSpreadsheet(rows);try{await api.saveSpreadsheet(rows);}catch{}};

  // Poll for remote changes every 30 s so concurrent users stay in sync
  useEffect(()=>{
    const id=setInterval(async()=>{
      try{
        const[lib,stk,pend]=await Promise.all([api.getLibrary(),api.getStock(),api.getPending()]);
        if(Array.isArray(lib))setLibrary(lib);
        if(Array.isArray(stk))setStock(stk);
        if(Array.isArray(pend))setPending(pend);
      }catch{}
    },30000);
    return()=>clearInterval(id);
  },[]);

  if(loading)return(<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:16}}><Spinner/><div style={{fontSize:14,color:'var(--color-text-secondary)'}}>Loading EMS Inventory...</div></div>);

  const pendingCount=pending.filter(p=>p.status==='pending').length;
  const sharedProps={library,stock,locations,categories,templates,navigate,pending,spreadsheet};

  return(
    <div style={{width:'100%',maxWidth:isDesktop&&view==='map'?'100%':680,paddingBottom:72,background:'var(--color-bg)',minHeight:'100vh',margin:'0 auto',boxShadow:isDesktop?'0 0 0 1px rgba(0,0,0,0.06)':undefined}}>
      {saveStatus&&<div style={{position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',background:'var(--color-text)',color:'var(--color-bg)',padding:'6px 18px',borderRadius:20,fontSize:12,fontWeight:500,zIndex:400,whiteSpace:'nowrap',boxShadow:'0 2px 8px rgba(0,0,0,0.2)'}}>{saveStatus}</div>}
      {view==='home'           &&<HomeView {...sharedProps} onSaveStock={saveStock}/>}
      {view==='locations'      &&!isDesktop&&<LocationsView {...sharedProps} onSaveLocations={saveLocations}/>}
      {view==='map'            &&<MapView {...sharedProps} mapData={mapData} onSaveMap={saveMap} onSaveLocations={saveLocations}/>}
      {view==='locationdetail' &&<LocationDetailView {...sharedProps} locationId={params.locationId} onSaveStock={saveStock}/>}
      {view==='inventory'      &&<InventoryView {...sharedProps} onSaveCategories={saveCategories} onSaveStock={saveStock}/>}
      {view==='library'        &&<LibraryView {...sharedProps}/>}
      {view==='drugdetail'     &&<DrugDetailView {...sharedProps} libraryId={params.libraryId} onSaveStock={saveStock} onSaveLibrary={saveLibrary}/>}
      {view==='addstock'       &&<AddStockView {...sharedProps} libraryId={params.libraryId} locationId={params.locationId} onSaveStock={saveStock}/>}
      {view==='additem'        &&<AddItemView {...sharedProps} libraryId={null} scanData={params.scanData} capturedPhoto={params.capturedPhoto} onSaveLibrary={saveLibrary} onSaveStock={saveStock}/>}
      {view==='edititem'       &&<AddItemView {...sharedProps} libraryId={params.libraryId} scanData={null} capturedPhoto={null} onSaveLibrary={saveLibrary} onSaveStock={saveStock}/>}
      {view==='quickreceive'   &&<QuickReceiveView {...sharedProps} onSaveStock={saveStock} onAppendStock={appendStock} onSaveLibrary={saveLibrary}/>}
      {view==='quickupload'    &&<QuickUploadView {...sharedProps} prePhoto={params.prePhoto} onSavePendingItem={savePendingItem}/>}
      {view==='pendingqueue'   &&<PendingQueueView {...sharedProps} onSaveSpreadsheet={saveSpreadsheet} onSavePendingItem={savePendingItem}/>}
      {view==='reviewpending'  &&<ReviewPendingItemView {...sharedProps} pendingId={params.pendingId} onSaveLibrary={saveLibrary} onSaveStock={saveStock} onSavePendingItem={savePendingItem}/>}
      {view==='orderreport'    &&<OrderReportView {...sharedProps}/>}
      {view==='settings'       &&<SettingsView {...sharedProps} onSaveLocations={saveLocations} onSaveCategories={saveCategories} onSaveTemplates={saveTemplates} onSaveStock={saveStock}/>}
      {view==='edittemplate'   &&<TemplateEditorView {...sharedProps} templateId={params.templateId} onSaveTemplates={saveTemplates}/>}
      <BottomNav view={view} navigate={navigate} isDesktop={isDesktop} pendingCount={pendingCount}/>
    </div>
  );
}