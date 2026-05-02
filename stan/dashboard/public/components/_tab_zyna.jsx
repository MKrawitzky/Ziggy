// ── Zyna — 4D Chimeric MS2 Deconvolution ──────────────────────────────────────
// The 4D advantage: Chimerys uses sequence patterns only.
// Zyna uses timsTOF ion mobility as a physical separation axis — fragment ions
// from co-isolated peptides cluster at different 1/K₀ values, allowing
// deconvolution without any ML model.

// ── Demo ion data for conceptual animation (module-level constants) ────────────
const _ZK0_A   = 0.875;   // Peptide A ion mobility center
const _ZK0_B   = 1.135;   // Peptide B ion mobility center
const _ZK0_MID = (_ZK0_A + _ZK0_B) / 2;
const _ZIONS_A = [
  {mz: 344, int: 0.65, dk0: -0.008}, {mz: 457, int: 0.82, dk0:  0.012},
  {mz: 586, int: 0.70, dk0: -0.005}, {mz: 685, int: 0.45, dk0:  0.018},
  {mz: 748, int: 0.90, dk0: -0.011}, {mz: 847, int: 0.55, dk0:  0.007},
  {mz: 960, int: 0.75, dk0: -0.014}, {mz: 1047, int: 0.60, dk0: 0.010},
];
const _ZIONS_B = [
  {mz: 398, int: 0.75, dk0:  0.009}, {mz: 512, int: 0.88, dk0: -0.013},
  {mz: 641, int: 0.62, dk0:  0.006}, {mz: 772, int: 0.80, dk0: -0.008},
  {mz: 885, int: 0.92, dk0:  0.015}, {mz: 978, int: 0.50, dk0: -0.010},
  {mz: 1067, int: 0.68, dk0:  0.004},
];
const _ZALL_IONS = [
  ..._ZIONS_A.map(ion => ({...ion, k0: _ZK0_A + ion.dk0, side: 'A'})),
  ..._ZIONS_B.map(ion => ({...ion, k0: _ZK0_B + ion.dk0, side: 'B'})),
];

function ZynaTab() {
  const [runId, setRunId] = React.useState('');
  const { data: runs } = useFetch('/api/runs');
  const [tier3Data, setTier3Data] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [activeView, setActiveView] = React.useState('map');  // map | profile | scatter

  const runList = Array.isArray(runs) ? runs : [];

  // Auto-select first run
  React.useEffect(() => {
    if (!runId && runList.length > 0) setRunId(runList[0].id);
  }, [runList]);

  const loadTier3 = async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    setTier3Data(null);
    try {
      const r = await fetch(`/api/runs/${runId}/zyna/tier3`);
      const d = await r.json();
      if (d.error && !d.available) {
        setError(d.error);
      } else {
        setTier3Data(d);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const selectedRun = runList.find(r => r.id === runId);

  return (
    <div style={{ padding: '1.2rem', maxWidth: '1100px', margin: '0 auto' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <ZynaBanner stats={tier3Data?.stats} loading={loading} />

      {/* ── Run selector + Launch ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.7rem',
        padding: '0.75rem 1rem',
        background: 'rgba(217,70,239,0.06)',
        border: '1px solid rgba(217,70,239,0.22)',
        borderRadius: '0.6rem',
        marginBottom: '1.2rem',
      }}>
        <span style={{ color: '#d946ef', fontSize: '0.72rem', fontWeight: 700,
                        letterSpacing: '0.1em', textTransform: 'uppercase' }}>Run</span>
        <select
          value={runId}
          onChange={e => { setRunId(e.target.value); setTier3Data(null); }}
          style={{
            flex: 1, background: '#1a0030', border: '1px solid #3d1060',
            color: '#e2e8f0', borderRadius: '0.35rem', padding: '0.35rem 0.5rem',
            fontSize: '0.82rem',
          }}
        >
          {runList.map(r => (
            <option key={r.id} value={r.id}>{r.run_name || r.id}</option>
          ))}
        </select>
        <button
          onClick={loadTier3}
          disabled={!runId || loading}
          style={{
            background: loading ? '#3d1060' : 'linear-gradient(135deg,#d946ef,#a21caf)',
            color: '#fff', border: 'none', borderRadius: '0.4rem',
            padding: '0.4rem 1.1rem', fontSize: '0.8rem', fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.06em',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '⟳ Analysing…' : '⚡ Run Zyna'}
        </button>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          padding: '0.9rem 1rem', background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.5rem',
          color: '#fca5a5', fontSize: '0.83rem', marginBottom: '1.2rem',
        }}>
          <strong>⚠ Error:</strong> {error}
        </div>
      )}

      {/* ── Not yet run ────────────────────────────────────────────────────── */}
      {!tier3Data && !loading && !error && (
        <ZynaIntroPanel />
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {tier3Data?.available && (
        <>
          {/* Stats row */}
          <ZynaStatsRow stats={tier3Data.stats} />

          {/* View selector */}
          <div style={{ display: 'flex', gap: '0.45rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
            {[
              ['map',     '⬛ Collision Map'],
              ['profile', '📊 Profiles'],
              ['scatter', '✦ 4D Precursor Cloud'],
              ['compare', '⚡ Before vs After'],
            ].map(([k, label]) => (
              <button key={k} onClick={() => setActiveView(k)} style={{
                background: activeView === k
                  ? 'rgba(217,70,239,0.22)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${activeView === k ? '#d946ef' : '#3d1060'}`,
                color: activeView === k ? '#d946ef' : '#94a3b8',
                borderRadius: '0.35rem', padding: '0.35rem 0.8rem',
                fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                letterSpacing: '0.05em',
              }}>{label}</button>
            ))}
          </div>

          {activeView === 'map' && (
            <ZynaCollisionMap windows={tier3Data.window_cells} />
          )}
          {activeView === 'profile' && (
            <ZynaProfiles mzProfile={tier3Data.mz_profile}
                          k0Profile={tier3Data.k0_profile} />
          )}
          {activeView === 'scatter' && (
            <ZynaPrecursorScatter scatter={tier3Data.precursor_scatter} />
          )}
          {activeView === 'compare' && (() => {
            // Find the chimeric window whose two best precursors have the largest K0 gap
            let bestPair = null, bestGap = 0;
            for (const w of (tier3Data.window_cells || [])) {
              if (!w.chimeric) continue;
              const precs = (w.precursors || []).filter(p => p.im != null);
              for (let i = 0; i < precs.length; i++) {
                for (let j = i + 1; j < precs.length; j++) {
                  const gap = Math.abs(precs[i].im - precs[j].im);
                  if (gap > bestGap) {
                    bestGap = gap;
                    bestPair = { precA: precs[i], precB: precs[j], gap, window: w };
                  }
                }
              }
            }
            return (
              <>
                <ZynaBeforeAfter pairAnalysis={tier3Data.pair_analysis} chimericPair={bestPair} />
                <ZynaFlawsCard />
              </>
            );
          })()}

          {/* 4D Advantage callout */}
          <ZynaTimsRescueCard stats={tier3Data.stats} />
        </>
      )}
    </div>
  );
}


// ── Banner ────────────────────────────────────────────────────────────────────
function ZynaBanner({ stats, loading }) {
  const canvasRef = React.useRef(null);
  const phaseRef  = React.useRef(0);
  const rafRef    = React.useRef(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width = 1040;
    const H = canvas.height = 90;
    const ctx = canvas.getContext('2d');

    // Stars
    const stars = Array.from({length: 120}, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.2 + 0.3,
      tw: Math.random() * Math.PI * 2,
    }));

    // Ion clouds for animation
    const ions = Array.from({length: 28}, () => ({
      x: Math.random() * W,
      y: H * 0.2 + Math.random() * H * 0.6,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.15,
      r:  1.5 + Math.random() * 2.5,
      hue: Math.random() < 0.5 ? '#d946ef' : '#22d3ee',
    }));

    function draw() {
      phaseRef.current += 0.018;
      const ph = phaseRef.current;

      ctx.fillStyle = '#0e0018';
      ctx.fillRect(0, 0, W, H);

      // Stars
      stars.forEach(s => {
        s.tw += 0.03;
        const alpha = 0.25 + 0.25 * Math.sin(s.tw);
        ctx.fillStyle = `rgba(218,170,0,${alpha})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      });

      // Separation axis lines — the core concept visual
      const yA = H * 0.35 + Math.sin(ph * 0.7) * 3;
      const yB = H * 0.65 + Math.sin(ph * 0.7 + 1.2) * 3;

      ctx.strokeStyle = 'rgba(217,70,239,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(120, yA); ctx.lineTo(W - 20, yA); ctx.stroke();
      ctx.strokeStyle = 'rgba(34,211,238,0.35)';
      ctx.beginPath(); ctx.moveTo(120, yB); ctx.lineTo(W - 20, yB); ctx.stroke();
      ctx.setLineDash([]);

      // Ion clouds
      ions.forEach(ion => {
        ion.x += ion.vx;
        ion.y += ion.vy;
        if (ion.x < 0 || ion.x > W) ion.vx *= -1;
        if (ion.y < H * 0.15 || ion.y > H * 0.85) ion.vy *= -1;
        const alpha = 0.5 + 0.3 * Math.sin(ph + ion.x * 0.02);
        ctx.fillStyle = ion.hue.replace(')', `,${alpha})`).replace('rgb', 'rgba');
        ctx.beginPath(); ctx.arc(ion.x, ion.y, ion.r, 0, Math.PI * 2); ctx.fill();
      });

      // K0 axis label
      ctx.save();
      ctx.translate(10, H / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(148,163,184,0.5)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('1/K₀', 0, 4);
      ctx.restore();

      // Title
      const grad = ctx.createLinearGradient(120, 0, 600, 0);
      grad.addColorStop(0, '#d946ef');
      grad.addColorStop(0.5, '#22d3ee');
      grad.addColorStop(1, '#DAAA00');
      ctx.fillStyle = grad;
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('ZYNA', 120, H * 0.42);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px monospace';
      ctx.fillText('4D Chimeric MS² Deconvolution · timsTOF Ion Mobility Separation Engine', 120, H * 0.68);

      // Status pill
      let pillColor = '#3d1060', pillText = 'READY';
      if (loading) { pillColor = '#1e3a5f'; pillText = '⟳ SCANNING'; }
      else if (stats) {
        const rate = stats.chimeric_rate || 0;
        if (rate > 0.4)      { pillColor = '#7f1d1d'; pillText = 'HIGH CHIMERIC'; }
        else if (rate > 0.2) { pillColor = '#78350f'; pillText = 'MODERATE'; }
        else                 { pillColor = '#14532d'; pillText = 'CLEAN RUN'; }
      }
      ctx.fillStyle = pillColor;
      roundRect(ctx, W - 130, H * 0.28, 110, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(pillText, W - 75, H * 0.44);

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => { cancelAnimationFrame(rafRef.current); };
  }, [loading, stats]);

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <canvas ref={canvasRef}
              style={{ width: '100%', height: '90px', borderRadius: '0.5rem',
                       border: '1px solid rgba(217,70,239,0.2)', display: 'block' }} />
    </div>
  );
}


// ── Stats row ─────────────────────────────────────────────────────────────────
function ZynaStatsRow({ stats }) {
  if (!stats) return null;
  const rate    = (stats.chimeric_rate * 100).toFixed(1);
  const rescue  = (stats.tims_rescue_rate * 100).toFixed(1);
  const items = [
    { label: 'Isolation Windows', value: stats.n_windows?.toLocaleString() || '—', color: '#94a3b8' },
    { label: 'Chimeric Windows', value: stats.n_chimeric_windows?.toLocaleString() || '—', color: '#f59e0b' },
    { label: 'Chimeric Rate', value: `${rate}%`,
      color: stats.chimeric_rate > 0.4 ? '#ef4444' : stats.chimeric_rate > 0.2 ? '#f59e0b' : '#22c55e' },
    { label: 'TIMS-Rescued Pairs', value: stats.tims_rescued_count?.toLocaleString() || '0', color: '#22d3ee' },
    { label: 'TIMS Rescue Rate', value: `${rescue}%`, color: '#d946ef' },
    { label: 'Est. ID Gain', value: stats.est_id_gain != null ? `+${stats.est_id_gain}` : '—',
      color: (stats.est_id_gain || 0) > 0 ? '#22c55e' : '#94a3b8' },
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '0.5rem',
      marginBottom: '1rem',
    }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid #3d1060',
          borderRadius: '0.4rem', padding: '0.6rem 0.5rem', textAlign: 'center',
        }}>
          <div style={{ color, fontSize: '1.15rem', fontWeight: 700 }}>{value}</div>
          <div style={{ color: '#64748b', fontSize: '0.65rem', marginTop: '0.15rem' }}>{label}</div>
        </div>
      ))}
    </div>
  );
}


// ── Collision Map ─────────────────────────────────────────────────────────────
function ZynaCollisionMap({ windows }) {
  const canvasRef = React.useRef(null);
  const [tooltip, setTooltip] = React.useState(null);

  React.useEffect(() => {
    if (!windows || !windows.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = 900, H = 360;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const PAD = { l: 60, r: 20, t: 30, b: 50 };
    const pw = W - PAD.l - PAD.r;
    const ph = H - PAD.t - PAD.b;

    // Data extent — use mz_lower/upper for tight x bounds, k0 from windows with valid range
    const mzLoVals = windows.map(w => w.mz_lower);
    const mzHiVals = windows.map(w => w.mz_upper);
    const k0Vals   = windows
      .filter(w => w.k0_lower != null && w.k0_upper != null && w.k0_upper > w.k0_lower)
      .flatMap(w => [w.k0_lower, w.k0_upper]);

    const mzLo = Math.min(...mzLoVals);
    const mzHi = Math.max(...mzHiVals);
    const k0Lo = k0Vals.length ? Math.min(...k0Vals) - 0.02 : 0.6;
    const k0Hi = k0Vals.length ? Math.max(...k0Vals) + 0.02 : 1.6;

    // If no valid K0 data show message
    if (!k0Vals.length) {
      ctx.fillStyle = '#0e0018';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#475569';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('K₀ calibration unavailable — showing m/z-only window layout', W/2, H/2 - 12);
      ctx.font = '11px monospace';
      ctx.fillStyle = '#374151';
      ctx.fillText('Check that analysis.tdf has a Frames table with NumScans', W/2, H/2 + 12);
      return;
    }

    const sx = v => PAD.l + (v - mzLo) / (mzHi - mzLo) * pw;
    const sy = v => PAD.t + ph - (v - k0Lo) / (k0Hi - k0Lo) * ph;

    // Background
    ctx.fillStyle = '#0e0018';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(61,16,96,0.4)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const x = PAD.l + i * pw / 5;
      const y = PAD.t + i * ph / 5;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
    }

    // Draw windows as rectangles, colored by chimeric multiplicity
    windows.forEach(w => {
      if (w.k0_upper == null || w.k0_lower == null || w.k0_upper === w.k0_lower) return;
      const x1 = sx(w.mz_lower);
      const x2 = sx(w.mz_upper);
      const y1 = sy(w.k0_upper);
      const y2 = sy(w.k0_lower);
      const ww = Math.max(1, x2 - x1);
      const wh = Math.max(1, y2 - y1);

      const n = w.n_prec_4d || 0;
      let fill;
      if (n === 0)      fill = 'rgba(61,16,96,0.3)';
      else if (n === 1) fill = 'rgba(34,211,238,0.25)';
      else if (n === 2) fill = 'rgba(245,158,11,0.4)';
      else if (n === 3) fill = 'rgba(239,68,68,0.5)';
      else              fill = 'rgba(239,68,68,0.8)';

      ctx.fillStyle = fill;
      ctx.fillRect(x1, y1, ww, wh);

      if (n > 1) {
        ctx.strokeStyle = n >= 3 ? '#ef4444' : '#f59e0b';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x1, y1, ww, wh);
      }
    });

    // Axes
    ctx.strokeStyle = '#3d1060';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + ph); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t + ph); ctx.lineTo(PAD.l + pw, PAD.t + ph); ctx.stroke();

    // Labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      const v = mzLo + i * (mzHi - mzLo) / 5;
      ctx.fillText(v.toFixed(0), PAD.l + i * pw / 5, PAD.t + ph + 14);
    }
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const v = k0Lo + i * (k0Hi - k0Lo) / 5;
      ctx.fillText(v.toFixed(2), PAD.l - 4, sy(v) + 3);
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Precursor m/z', PAD.l + pw / 2, H - 8);
    ctx.save();
    ctx.translate(14, PAD.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('1/K₀ (V·s/cm²)', 0, 0);
    ctx.restore();

    // Legend
    const lgItems = [
      ['Empty', 'rgba(61,16,96,0.6)'],
      ['1 precursor', '#22d3ee'],
      ['2 precursors', '#f59e0b'],
      ['≥3 precursors', '#ef4444'],
    ];
    let lx = PAD.l + pw - 230;
    lgItems.forEach(([label, color]) => {
      ctx.fillStyle = color;
      ctx.fillRect(lx, PAD.t + 6, 12, 12);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 16, PAD.t + 16);
      lx += 65;
    });

    // Title
    ctx.fillStyle = '#d946ef';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('diaPASEF Isolation Windows — Chimeric Collision Map', PAD.l, PAD.t - 10);

  }, [windows]);

  return (
    <div style={{
      background: '#0e0018', border: '1px solid #3d1060',
      borderRadius: '0.5rem', padding: '0.6rem', marginBottom: '1rem',
      position: 'relative',
    }}>
      <canvas ref={canvasRef}
              style={{ width: '100%', height: '360px', display: 'block' }} />
      <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: '0.4rem', textAlign: 'center' }}>
        Each rectangle = one diaPASEF isolation window · Color = number of DIA-NN identified precursors within that m/z × 1/K₀ cell
      </div>
    </div>
  );
}


// ── Profiles ──────────────────────────────────────────────────────────────────
function ZynaProfiles({ mzProfile, k0Profile }) {
  const mzRef = React.useRef(null);
  const k0Ref = React.useRef(null);

  function drawProfile(canvas, data, xlabel, rgbaBar) {
    if (!canvas || !data?.length) return;
    const W = 420, H = 260;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const PAD = { l: 52, r: 15, t: 30, b: 50 };
    const pw = W - PAD.l - PAD.r;
    const ph = H - PAD.t - PAD.b;

    ctx.fillStyle = '#0e0018';
    ctx.fillRect(0, 0, W, H);

    const xs    = data.map(d => d.bin_center);
    const rates = data.map(d => d.rate);
    const tots  = data.map(d => d.n_total);
    const xLo   = Math.min(...xs), xHi = Math.max(...xs);
    const yHi   = Math.max(...rates, 0.05);
    const maxTot = Math.max(...tots, 1);

    const toX = v => PAD.l + (v - xLo) / (xHi - xLo || 1) * pw;
    const toY = v => PAD.t + ph - v / yHi * ph;

    const bw = pw / data.length * 0.82;

    // Draw bars
    data.forEach(d => {
      const x    = toX(d.bin_center) - bw / 2;
      const barH = Math.max(1, d.rate / yHi * ph);
      const r    = d.rate;
      const fill = r > 0.4 ? 'rgba(239,68,68,0.75)'
                 : r > 0.2 ? 'rgba(245,158,11,0.75)'
                 :            rgbaBar;
      ctx.fillStyle = fill;
      ctx.fillRect(x, PAD.t + ph - barH, bw, barH);
    });

    // Window count line (secondary y, dashed)
    if (maxTot > 0) {
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = toX(d.bin_center);
        const y = PAD.t + ph - (d.n_total / maxTot) * ph * 0.38;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axes
    ctx.strokeStyle = '#3d1060';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + ph);
    ctx.lineTo(PAD.l + pw, PAD.t + ph); ctx.stroke();

    // X tick labels
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const nTicks = Math.min(6, data.length);
    for (let i = 0; i <= nTicks; i++) {
      const v  = xLo + i * (xHi - xLo) / nTicks;
      const px = PAD.l + i * pw / nTicks;
      ctx.fillText(v.toFixed(v > 100 ? 0 : 2), px, PAD.t + ph + 13);
    }

    // Y tick labels
    ctx.textAlign = 'right';
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
      const y = toY(f * yHi);
      ctx.fillText(`${(f * yHi * 100).toFixed(0)}%`, PAD.l - 4, y + 3);
      ctx.strokeStyle = 'rgba(61,16,96,0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
    });

    // Axis labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(xlabel, PAD.l + pw / 2, H - 6);
    ctx.save();
    ctx.translate(13, PAD.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Chimeric Rate', 0, 0);
    ctx.restore();

    // Legend: dashed = window count
    ctx.strokeStyle = 'rgba(148,163,184,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(PAD.l + pw - 130, PAD.t + 8); ctx.lineTo(PAD.l + pw - 110, PAD.t + 8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#475569'; ctx.font = '8px monospace'; ctx.textAlign = 'left';
    ctx.fillText('window count (scaled)', PAD.l + pw - 107, PAD.t + 12);
  }

  React.useEffect(() => { drawProfile(mzRef.current, mzProfile, 'Precursor m/z (isolation window center)', 'rgba(217,70,239,0.55)'); }, [mzProfile]);
  React.useEffect(() => { drawProfile(k0Ref.current, k0Profile, '1/K₀ (V·s/cm²)',                          'rgba(34,211,238,0.55)'); }, [k0Profile]);

  const hasK0 = k0Profile && k0Profile.length > 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: hasK0 ? '1fr 1fr' : '1fr', gap: '0.8rem',
                  marginBottom: '1rem' }}>
      <div style={{ background: '#0e0018', border: '1px solid #3d1060',
                    borderRadius: '0.5rem', padding: '0.5rem' }}>
        <canvas ref={mzRef} style={{ width: '100%', height: '260px', display: 'block' }} />
        <div style={{ color: '#475569', fontSize: '0.68rem', padding: '0.3rem 0.2rem' }}>
          Source: diaPASEF isolation windows × DIA-NN identified precursors — real experimental data
        </div>
      </div>
      {hasK0 ? (
        <div style={{ background: '#0e0018', border: '1px solid #3d1060',
                      borderRadius: '0.5rem', padding: '0.5rem' }}>
          <canvas ref={k0Ref} style={{ width: '100%', height: '260px', display: 'block' }} />
          <div style={{ color: '#475569', fontSize: '0.68rem', padding: '0.3rem 0.2rem' }}>
            Source: TIMS calibration (TimsCalibration table) × isolation window scan range — real experimental data
          </div>
        </div>
      ) : (
        <div style={{
          background: '#0e0018', border: '1px solid #3d1060',
          borderRadius: '0.5rem', padding: '1.5rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '0.5rem', color: '#475569', fontSize: '0.8rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '1.5rem' }}>∿</div>
          <div style={{ color: '#64748b' }}>1/K₀ profile unavailable</div>
          <div style={{ fontSize: '0.72rem', color: '#374151', maxWidth: '200px', lineHeight: 1.6 }}>
            TIMS calibration not found in analysis.tdf — 1/K₀ could not be computed for this run's isolation windows.
          </div>
        </div>
      )}
    </div>
  );
}


// ── Precursor Scatter ─────────────────────────────────────────────────────────
function ZynaPrecursorScatter({ scatter }) {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    if (!scatter?.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = 900, H = 380;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const PAD = { l: 60, r: 20, t: 30, b: 50 };
    const pw = W - PAD.l - PAD.r;
    const ph = H - PAD.t - PAD.b;

    ctx.fillStyle = '#0e0018';
    ctx.fillRect(0, 0, W, H);

    // Only include points with valid mz AND im
    const valid = scatter.filter(p => p.mz > 0 && p.im != null && p.im > 0);
    if (!valid.length) {
      ctx.fillStyle = '#475569';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No precursors with ion mobility data', W / 2, H / 2);
      ctx.fillStyle = '#374151';
      ctx.font = '10px monospace';
      ctx.fillText('IM column not present in report.parquet', W / 2, H / 2 + 18);
      return;
    }

    // Use 2nd–98th percentile to avoid outlier stretch
    function pct(arr, p) {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.max(0, Math.floor(s.length * p / 100))];
    }
    const mzVals = valid.map(p => p.mz);
    const imVals = valid.map(p => p.im);
    const rtVals = valid.map(p => p.rt || 0);
    const mzLo = pct(mzVals, 1),  mzHi = pct(mzVals, 99);
    const imLo = pct(imVals, 1),  imHi = pct(imVals, 99);
    const rtLo = Math.min(...rtVals), rtHi = Math.max(...rtVals);
    const rtRange = rtHi - rtLo || 1;

    const sx = mz => PAD.l + Math.max(0, Math.min(1, (mz - mzLo) / (mzHi - mzLo || 1))) * pw;
    const sy = im => PAD.t + ph - Math.max(0, Math.min(1, (im - imLo) / (imHi - imLo || 1))) * ph;

    // Grid
    ctx.strokeStyle = 'rgba(61,16,96,0.3)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = PAD.l + i * pw / 4;
      const y = PAD.t + i * ph / 4;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
    }

    // Points colored by RT (cyan early → violet mid → gold late)
    valid.forEach(p => {
      const x = sx(p.mz);
      const y = sy(p.im);
      const t = Math.max(0, Math.min(1, (p.rt - rtLo) / rtRange));
      let r, g, b;
      if (t < 0.5) {
        const tt = t * 2;
        r = Math.round(34  + (217 - 34)  * tt);
        g = Math.round(211 + (70  - 211) * tt);
        b = Math.round(238 + (239 - 238) * tt);
      } else {
        const tt = (t - 0.5) * 2;
        r = Math.round(217 + (218 - 217) * tt);
        g = Math.round(70  + (170 - 70)  * tt);
        b = Math.round(239 + (0   - 239) * tt);
      }
      ctx.fillStyle = `rgba(${r},${g},${b},0.65)`;
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // Axes
    ctx.strokeStyle = '#3d1060';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + ph);
    ctx.lineTo(PAD.l + pw, PAD.t + ph); ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const v = mzLo + i * (mzHi - mzLo) / 4;
      ctx.fillText(v.toFixed(0), PAD.l + i * pw / 4, PAD.t + ph + 14);
    }
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = imLo + i * (imHi - imLo) / 4;
      ctx.fillText(v.toFixed(2), PAD.l - 4, sy(v) + 3);
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Precursor m/z', PAD.l + pw / 2, H - 8);
    ctx.save();
    ctx.translate(14, PAD.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('1/K₀ (V·s/cm²)', 0, 0);
    ctx.restore();

    // RT colorbar
    const cbX = PAD.l + pw - 160;
    const cbW = 140;
    const cbY = PAD.t + 8;
    const cbH = 10;
    for (let i = 0; i < cbW; i++) {
      const t = i / cbW;
      let r, g, b;
      if (t < 0.5) { const tt = t * 2; r = 34 + (217 - 34)*tt; g = 211 + (70-211)*tt; b = 238 + (239-238)*tt; }
      else { const tt = (t-0.5)*2; r = 217 + (218-217)*tt; g = 70 + (170-70)*tt; b = 239 + (0-239)*tt; }
      ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
      ctx.fillRect(cbX + i, cbY, 1, cbH);
    }
    ctx.strokeStyle = '#3d1060';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cbX, cbY, cbW, cbH);
    ctx.fillStyle = '#64748b';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`RT ${(rtLo/60).toFixed(1)}min`, cbX, cbY + cbH + 10);
    ctx.textAlign = 'right';
    ctx.fillText(`${(rtHi/60).toFixed(1)}min`, cbX + cbW, cbY + cbH + 10);

    ctx.fillStyle = '#d946ef';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Identified Precursors — m/z × 1/K₀ · ${scatter.length} shown · color = RT`, PAD.l, PAD.t - 10);

  }, [scatter]);

  return (
    <div style={{
      background: '#0e0018', border: '1px solid #3d1060',
      borderRadius: '0.5rem', padding: '0.6rem', marginBottom: '1rem',
    }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '380px', display: 'block' }} />
      <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: '0.4rem', textAlign: 'center' }}>
        DIA-NN identified precursors (Q ≤ 1%) in m/z × ion mobility space · color gradient = retention time (early cyan → late gold)
      </div>
    </div>
  );
}


// ── TIMS Rescue Card ──────────────────────────────────────────────────────────
function ZynaTimsRescueCard({ stats }) {
  if (!stats) return null;
  const rescued  = stats.tims_rescued_count || 0;
  const chimeric = stats.n_chimeric_windows || 0;
  const rescRate = stats.tims_rescue_rate || 0;
  const total    = rescued + chimeric;

  return (
    <div style={{
      border: '1px solid rgba(217,70,239,0.3)',
      borderRadius: '0.6rem',
      padding: '1rem 1.2rem',
      background: 'linear-gradient(135deg,rgba(217,70,239,0.05),rgba(34,211,238,0.05))',
      marginTop: '0.8rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{
          fontSize: '2.5rem', lineHeight: 1,
          background: 'linear-gradient(135deg,#d946ef,#22d3ee)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>4D</div>
        <div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.95rem' }}>
            The timsTOF Advantage
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.3rem', lineHeight: 1.6 }}>
            Of <strong style={{color:'#22d3ee'}}>{total.toLocaleString()}</strong> isolation
            windows with m/z-overlapping precursors,{' '}
            <strong style={{color:'#d946ef'}}>{rescued.toLocaleString()}</strong>{' '}
            ({(rescRate * 100).toFixed(1)}%) were <em>automatically separated</em> by TIMS ion
            mobility — no chimeric deconvolution needed.{' '}
            <strong style={{color:'#f59e0b'}}>{chimeric.toLocaleString()}</strong> windows
            remain truly chimeric and are candidates for Zyna Tier 1/2 deconvolution.
          </div>
          <div style={{
            marginTop: '0.7rem', color: '#475569', fontSize: '0.72rem',
            borderTop: '1px solid rgba(61,16,96,0.5)', paddingTop: '0.5rem',
          }}>
            ★ Chimerys (MSAID) operates on m/z + intensity only — it cannot see this TIMS separation.
            Zyna leverages the full 4D nature of timsTOF data, giving you a head start before
            any machine learning is applied.
          </div>
        </div>
      </div>

      {/* Mini progress bar */}
      <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
        <span style={{ color: '#64748b', fontSize: '0.7rem', width: '90px' }}>m/z collisions</span>
        <div style={{ flex: 1, height: '8px', background: '#1a0030', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: '4px',
            background: `linear-gradient(90deg,
              #22d3ee 0%,
              #22d3ee ${(rescRate * 100).toFixed(1)}%,
              #f59e0b ${(rescRate * 100).toFixed(1)}%,
              #f59e0b 100%)`,
          }} />
        </div>
        <span style={{ color: '#22d3ee', fontSize: '0.7rem', width: '100px', textAlign: 'right' }}>
          {(rescRate * 100).toFixed(0)}% TIMS-resolved
        </span>
      </div>
    </div>
  );
}


// ── Intro panel ───────────────────────────────────────────────────────────────
function ZynaIntroPanel() {
  return (
    <div style={{
      border: '1px solid #3d1060', borderRadius: '0.6rem',
      padding: '1.5rem', background: 'rgba(255,255,255,0.015)',
    }}>
      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1rem',
                    marginBottom: '0.8rem' }}>
        Why Zyna? The 4D Chimeric Problem.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem',
                    marginBottom: '1rem' }}>
        {[
          {
            tier: '3', color: '#22d3ee',
            title: 'PASEF Geometry',
            desc: 'Read diaPASEF isolation windows from analysis.tdf. No raw spectra needed. Computes chimeric rate and TIMS rescue fraction immediately.',
          },
          {
            tier: '1', color: '#d946ef',
            title: '4D Physics Deconvolution',
            desc: 'Read raw PASEF MS2 frames via TimsData. Assign each fragment ion to precursor A or B using Gaussian 1/K₀ proximity. Pure physics — no ML.',
          },
          {
            tier: '2', color: '#DAAA00',
            title: 'Prosit-Assisted',
            desc: 'Same 4D physics + Prosit fragment intensity predictions (Koina REST, internet required). Better scoring when precursors have similar 1/K₀.',
          },
        ].map(({ tier, color, title, desc }) => (
          <div key={tier} style={{
            border: `1px solid ${color}33`, borderRadius: '0.4rem',
            padding: '0.8rem', background: `${color}08`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                          marginBottom: '0.4rem' }}>
              <span style={{
                background: color, color: '#0e0018', borderRadius: '0.25rem',
                padding: '0.1rem 0.4rem', fontSize: '0.7rem', fontWeight: 800,
              }}>TIER {tier}</span>
              <span style={{ color: '#e2e8f0', fontSize: '0.82rem', fontWeight: 600 }}>{title}</span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.77rem', lineHeight: 1.5, margin: 0 }}>{desc}</p>
          </div>
        ))}
      </div>

      <div style={{
        background: 'rgba(218,170,0,0.06)', border: '1px solid rgba(218,170,0,0.2)',
        borderRadius: '0.4rem', padding: '0.7rem 0.9rem',
        color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.6,
      }}>
        <strong style={{color:'#DAAA00'}}>★ The timsTOF advantage over Chimerys:</strong>{' '}
        In diaPASEF, isolation windows span both m/z <em>and</em> 1/K₀. Precursors that overlap
        in m/z but differ in ion mobility are already separated before fragmentation — TIMS does
        the work for free. Zyna quantifies this separation, then deconvolves only the truly
        chimeric spectra where TIMS separation was insufficient.
        Select a run and click <strong style={{color:'#d946ef'}}>Run Zyna</strong> to begin.
      </div>
    </div>
  );
}


// ── Before vs After animated comparison ──────────────────────────────────────
function ZynaBeforeAfter({ pairAnalysis, chimericPair }) {
  const canvasRef = React.useRef(null);
  const phaseRef  = React.useRef(0);
  const rafRef    = React.useRef(null);

  // Real K0 centers from actual chimeric pair, fall back to demo if no IM data
  const K0_A   = chimericPair?.precA?.im  ?? _ZK0_A;
  const K0_B   = chimericPair?.precB?.im  ?? _ZK0_B;
  const K0_MID = (K0_A + K0_B) / 2;
  const isReal = chimericPair != null;

  // Build ion list with K0 positions anchored to the real (or demo) centers
  // dk0 offsets represent realistic TIMS peak spread — valid for any K0 center
  const allIons = [
    ..._ZIONS_A.map(ion => ({...ion, k0: K0_A + ion.dk0, side: 'A'})),
    ..._ZIONS_B.map(ion => ({...ion, k0: K0_B + ion.dk0, side: 'B'})),
  ];

  // Reasonable m/z display range around the real precursor m/z values
  const mzA  = chimericPair?.precA?.mz ?? 650;
  const mzB  = chimericPair?.precB?.mz ?? 780;
  const mzMid = (mzA + mzB) / 2;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 940, H = 390;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const HW = W / 2;
    const MZ_LO = 300, MZ_HI = 1100;
    // K0 display range: bracket both centers with padding
    const k0Pad  = Math.max(0.15, Math.abs(K0_B - K0_A) * 0.6);
    const K0_LO  = Math.min(K0_A, K0_B) - k0Pad;
    const K0_HI  = Math.max(K0_A, K0_B) + k0Pad;
    const SIGMA  = 0.03;

    function smoothstep(t) {
      const c = Math.max(0, Math.min(1, t));
      return c * c * (3 - 2 * c);
    }

    function draw() {
      phaseRef.current = (phaseRef.current + 0.014) % 8;
      const t8 = phaseRef.current;

      // sep: 0 = mixed, 1 = fully separated
      let sep;
      if      (t8 < 2.0) sep = 0;
      else if (t8 < 4.5) sep = smoothstep((t8 - 2.0) / 2.5);
      else if (t8 < 6.5) sep = 1;
      else               sep = 1 - smoothstep((t8 - 6.5) / 1.5);

      ctx.fillStyle = '#0e0018';
      ctx.fillRect(0, 0, W, H);

      // Divider
      ctx.strokeStyle = 'rgba(61,16,96,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(HW, 8); ctx.lineTo(HW, H - 8); ctx.stroke();
      ctx.setLineDash([]);

      // ── LEFT: Standard DIA / Chimerys ────────────────────────────────────
      const LP = {l: 48, r: 10, t: 54, b: 44};
      const LPW = HW - LP.l - LP.r;
      const LPH = H - LP.t - LP.b;
      const lsx = mz => LP.l + (mz - MZ_LO) / (MZ_HI - MZ_LO) * LPW;
      const lsy = v  => LP.t + LPH - v * LPH;

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('WITHOUT 4D — Chimerys approach', HW / 2, 18);
      ctx.fillStyle = '#374151';
      ctx.font = '9px monospace';
      ctx.fillText('m/z + intensity only  ·  1/K₀ dimension discarded', HW / 2, 31);

      // Axes
      ctx.strokeStyle = '#3d1060';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(LP.l, LP.t); ctx.lineTo(LP.l, LP.t + LPH);
      ctx.lineTo(LP.l + LPW, LP.t + LPH); ctx.stroke();

      // Grid + x-ticks
      [400, 600, 800, 1000].forEach(v => {
        const x = lsx(v);
        ctx.strokeStyle = 'rgba(61,16,96,0.18)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x, LP.t); ctx.lineTo(x, LP.t + LPH); ctx.stroke();
        ctx.fillStyle = '#374151'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
        ctx.fillText(v, x, LP.t + LPH + 13);
      });
      ctx.fillStyle = '#374151'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('m/z', LP.l + LPW / 2, H - 10);
      ctx.save(); ctx.translate(13, LP.t + LPH / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText('Intensity', 0, 0); ctx.restore();

      // All ions as GREY — Chimerys can't separate them
      allIons.forEach(ion => {
        const x = lsx(ion.mz);
        const y = lsy(ion.int);
        const pulse = 0.3 + 0.12 * Math.sin(phaseRef.current * 1.8 + ion.mz * 0.006);
        ctx.strokeStyle = `rgba(148,163,184,${pulse})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x, LP.t + LPH); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = `rgba(148,163,184,${pulse + 0.1})`;
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      });

      // Confusion markers (fade out as right panel shows resolution)
      const qa = Math.max(0, 0.85 - sep * 1.1);
      if (qa > 0) {
        ctx.fillStyle = `rgba(239,68,68,${qa * 0.55})`;
        ctx.font = 'bold 15px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('? ? ?', LP.l + LPW / 2, LP.t + LPH / 2 - 10);
        ctx.font = '9px monospace';
        ctx.fillStyle = `rgba(239,68,68,${qa * 0.45})`;
        ctx.fillText('2 peptides mixed — ambiguous identity', LP.l + LPW / 2, LP.t + LPH / 2 + 7);
      }
      ctx.fillStyle = 'rgba(239,68,68,0.7)';
      ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText('✗  Peptide B likely missed or wrong ID', HW / 2, H - 22);

      // ── RIGHT: Zyna 4D separation ─────────────────────────────────────────
      const rx = HW + 1;
      const RP = {l: 56, r: 10, t: 54, b: 44};
      const RPW = HW - RP.l - RP.r;
      const RPH = H - RP.t - RP.b;
      const rsx = mz => rx + RP.l + (mz - MZ_LO) / (MZ_HI - MZ_LO) * RPW;
      const rsy = k0  => RP.t + RPH - (k0 - K0_LO) / (K0_HI - K0_LO) * RPH;

      ctx.fillStyle = '#d946ef';
      ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('WITH ZYNA 4D SEPARATION', rx + RP.l + RPW / 2, 18);
      ctx.fillStyle = '#22d3ee'; ctx.font = '9px monospace';
      ctx.fillText('m/z × 1/K₀  ·  TIMS separates fragment ion clouds', rx + RP.l + RPW / 2, 31);

      // Axes
      ctx.strokeStyle = '#3d1060'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx + RP.l, RP.t); ctx.lineTo(rx + RP.l, RP.t + RPH);
      ctx.lineTo(rx + RP.l + RPW, RP.t + RPH); ctx.stroke();

      [400, 600, 800, 1000].forEach(v => {
        const x = rsx(v);
        ctx.strokeStyle = 'rgba(61,16,96,0.18)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x, RP.t); ctx.lineTo(x, RP.t + RPH); ctx.stroke();
        ctx.fillStyle = '#374151'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
        ctx.fillText(v, x, RP.t + RPH + 13);
      });
      ctx.fillStyle = '#374151'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('m/z', rx + RP.l + RPW / 2, H - 10);
      ctx.save(); ctx.translate(rx + 14, RP.t + RPH / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText('1/K₀ (V·s/cm²)', 0, 0); ctx.restore();

      // Y-axis ticks: use real K0 range
      ctx.textAlign = 'right';
      const k0Step = (K0_HI - K0_LO) / 4;
      for (let i = 0; i <= 4; i++) {
        const v = K0_LO + i * k0Step;
        const y = rsy(v);
        ctx.fillStyle = '#374151'; ctx.font = '9px monospace';
        ctx.fillText(v.toFixed(2), rx + RP.l - 4, y + 3);
        ctx.strokeStyle = 'rgba(61,16,96,0.15)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(rx + RP.l, y); ctx.lineTo(rx + RP.l + RPW, y); ctx.stroke();
      }

      // K0 separation bands (emerge as sep increases)
      const ba = Math.max(0, (sep - 0.25) / 0.75);
      if (ba > 0) {
        // Peptide A band (violet)
        const yAh = rsy(K0_A + 2 * SIGMA), yAl = rsy(K0_A - 2 * SIGMA);
        ctx.fillStyle = `rgba(217,70,239,${ba * 0.10})`;
        ctx.fillRect(rx + RP.l, yAh, RPW, yAl - yAh);
        ctx.strokeStyle = `rgba(217,70,239,${ba * 0.3})`; ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(rx + RP.l, rsy(K0_A));
        ctx.lineTo(rx + RP.l + RPW, rsy(K0_A)); ctx.stroke();

        // Peptide B band (cyan)
        const yBh = rsy(K0_B + 2 * SIGMA), yBl = rsy(K0_B - 2 * SIGMA);
        ctx.fillStyle = `rgba(34,211,238,${ba * 0.10})`;
        ctx.fillRect(rx + RP.l, yBh, RPW, yBl - yBh);
        ctx.strokeStyle = `rgba(34,211,238,${ba * 0.3})`;
        ctx.beginPath(); ctx.moveTo(rx + RP.l, rsy(K0_B));
        ctx.lineTo(rx + RP.l + RPW, rsy(K0_B)); ctx.stroke();
        ctx.setLineDash([]);

        // Band labels with real K0 values
        ctx.fillStyle = `rgba(217,70,239,${ba * 0.9})`; ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`Precursor A  1/K₀ = ${K0_A.toFixed(3)}`, rx + RP.l + RPW - 4, rsy(K0_A) - 4);
        ctx.fillStyle = `rgba(34,211,238,${ba * 0.9})`;
        ctx.fillText(`Precursor B  1/K₀ = ${K0_B.toFixed(3)}`, rx + RP.l + RPW - 4, rsy(K0_B) - 4);
      }

      // Animated ions: start at K0_MID, separate toward correct K0
      allIons.forEach(ion => {
        const x = rsx(ion.mz);
        const curK0 = K0_MID + (ion.k0 - K0_MID) * sep;
        const y = rsy(curK0);
        // Interpolate colour: grey → violet/cyan
        const [tr, tg, tb] = ion.side === 'A' ? [217, 70, 239] : [34, 211, 238];
        const cr = Math.round(148 + (tr - 148) * sep);
        const cg = Math.round(163 + (tg - 163) * sep);
        const cb = Math.round(184 + (tb - 184) * sep);
        const alpha = 0.45 + 0.45 * sep;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.5 + ion.int * 2.8, 0, Math.PI * 2);
        ctx.fill();
      });

      // Success annotation (appears when sep > 0.7)
      const sa = Math.max(0, (sep - 0.65) / 0.35);
      if (sa > 0) {
        ctx.fillStyle = `rgba(34,197,94,${sa * 0.9})`;
        ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
        ctx.fillText('✓  Both peptides identified  ·  +1 ID rescued by Zyna',
                     rx + RP.l + RPW / 2, H - 22);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [K0_A, K0_B]);

  const rescued  = pairAnalysis?.n_rescuable_ids    || 0;
  const partial  = pairAnalysis?.n_pairs_partial    || 0;
  const hard     = pairAnalysis?.n_pairs_overlapping || 0;
  const total    = pairAnalysis?.n_total_pairs      || 0;

  // Caption line describing data source
  const captionLine = isReal
    ? `Real precursor pair from your run — m/z ${chimericPair.precA.mz.toFixed(2)} (1/K₀ ${K0_A.toFixed(3)}) vs m/z ${chimericPair.precB.mz.toFixed(2)} (1/K₀ ${K0_B.toFixed(3)}) · ΔK₀ = ${chimericPair.gap.toFixed(3)} · fragment m/z positions are illustrative (raw MS2 frames need Tier 1)`
    : 'Demo K₀ values — no chimeric window with ion mobility data found in this run · run a diaPASEF file with DIA-NN report for real values';

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{
        background: '#0e0018',
        border: `1px solid ${isReal ? 'rgba(34,211,238,0.3)' : '#3d1060'}`,
        borderRadius: '0.5rem', padding: '0.6rem',
      }}>
        <canvas ref={canvasRef}
                style={{ width: '100%', height: '390px', display: 'block' }} />
        <div style={{
          color: isReal ? '#22d3ee' : '#374151',
          fontSize: '0.7rem', marginTop: '0.4rem',
          textAlign: 'center', fontStyle: 'italic',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
        }}>
          <span style={{ color: isReal ? '#22c55e' : '#475569', fontStyle: 'normal', fontWeight: 700 }}>
            {isReal ? '◈ REAL DATA' : '○ DEMO DATA'}
          </span>
          {captionLine}
        </div>
      </div>

      {/* Real-data ID gain summary */}
      {total > 0 && (
        <div style={{
          border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: '0.6rem', padding: '1rem 1.2rem', marginTop: '0.8rem',
          background: 'linear-gradient(135deg,rgba(34,197,94,0.04),rgba(34,211,238,0.04))',
        }}>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.7rem' }}>
            ✦ Estimated Zyna ID Gain — Based on Your Run
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem', marginBottom: '0.8rem' }}>
            {[
              { label: 'TIMS-Resolvable Pairs', value: rescued,
                sub: 'K₀ gap ≥ 2σ (0.06) — Tier 1 physically separates', color: '#22d3ee' },
              { label: 'Partially Separated', value: partial,
                sub: 'K₀ gap 1–2σ — Tier 2 Prosit assists scoring', color: '#DAAA00' },
              { label: 'Hard Chimeric', value: hard,
                sub: 'K₀ gap < 1σ (0.03) — genuinely overlapping', color: '#64748b' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} style={{
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}33`,
                borderRadius: '0.4rem', padding: '0.6rem',
              }}>
                <div style={{ color, fontSize: '1.4rem', fontWeight: 700 }}>{value}</div>
                <div style={{ color: '#e2e8f0', fontSize: '0.73rem', fontWeight: 600, margin: '0.2rem 0' }}>{label}</div>
                <div style={{ color: '#475569', fontSize: '0.66rem', lineHeight: 1.4 }}>{sub}</div>
              </div>
            ))}
          </div>
          <div style={{
            background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)',
            borderRadius: '0.4rem', padding: '0.6rem 0.8rem',
            color: '#94a3b8', fontSize: '0.77rem', lineHeight: 1.6,
          }}>
            <strong style={{ color: '#22c55e' }}>Estimated +{rescued} additional peptide IDs</strong>{' '}
            recoverable by Zyna Tier 1 (4D physics deconvolution). These are precursor pairs
            in chimeric windows where the TIMS dimension provides ≥2σ K₀ separation (≥0.06 V·s/cm²)
            — enough to cleanly assign each peptide's fragment ions independently.
            {partial > 0 && (
              <>{' '}An additional <strong style={{ color: '#DAAA00' }}>{partial} pairs</strong>{' '}
              have partial K₀ separation and benefit from Tier 2 Prosit-assisted scoring.</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Chimerys vs Zyna comparison table ─────────────────────────────────────────
function ZynaFlawsCard() {
  const rows = [
    {
      flaw: 'Ignores ion mobility entirely',
      fix:  'Uses 1/K₀ as a physical separation axis — every fragment ion carries a K₀ coordinate',
    },
    {
      flaw: 'Deep learning black box — opaque, unauditable scoring',
      fix:  'Physics-first Gaussian K₀ assignment: fully explainable, no ML needed for Tiers 1 & 3',
    },
    {
      flaw: 'Trained on HCD fragmentation spectra, not PASEF',
      fix:  'Reads actual PASEF MS2 raw frames via TimsData — uses real experimental 4D data',
    },
    {
      flaw: 'Cannot see TIMS pre-separation — wastes free information',
      fix:  'Quantifies the TIMS rescue fraction: windows already resolved before fragmentation',
    },
    {
      flaw: 'Scores the full mixed chimeric spectrum as a unit',
      fix:  'Scores K₀-separated sub-spectra — each peptide gets its own clean fragment evidence',
    },
    {
      flaw: 'No fragment K₀ consistency check — any sequence can match any ion',
      fix:  'Fragment K₀ must cluster at precursor charge-state expected CCS — hallucinations rejected',
    },
    {
      flaw: 'No co-isolation purity score — blind to mixing ratio',
      fix:  'NNLS mixing coefficients (α, β) quantify each precursor\'s contribution to the spectrum',
    },
    {
      flaw: 'Requires external server, license, and minutes of compute',
      fix:  'Tier 3 offline in seconds · Tier 1 offline in minutes · Tier 2 optionally uses Koina REST',
    },
  ];

  return (
    <div style={{
      border: '1px solid #3d1060', borderRadius: '0.6rem',
      overflow: 'hidden', marginTop: '0.8rem',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid #3d1060',
      }}>
        <div style={{ padding: '0.55rem 1rem', color: '#94a3b8', fontWeight: 700, fontSize: '0.8rem',
                      borderRight: '1px solid #3d1060' }}>
          ✗  Chimerys (MSAID) — Fundamental Limitations
        </div>
        <div style={{ padding: '0.55rem 1rem', color: '#22d3ee', fontWeight: 700, fontSize: '0.8rem' }}>
          ✦  Zyna — 4D timsTOF Solutions
        </div>
      </div>
      {rows.map(({ flaw, fix }, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          borderBottom: i < rows.length - 1 ? '1px solid rgba(61,16,96,0.35)' : 'none',
        }}>
          <div style={{
            padding: '0.45rem 1rem', color: '#ef4444', fontSize: '0.76rem',
            borderRight: '1px solid rgba(61,16,96,0.35)',
            background: 'rgba(239,68,68,0.025)', lineHeight: 1.5,
          }}>
            ✗  {flaw}
          </div>
          <div style={{
            padding: '0.45rem 1rem', color: '#22c55e', fontSize: '0.76rem',
            background: 'rgba(34,197,94,0.025)', lineHeight: 1.5,
          }}>
            ✓  {fix}
          </div>
        </div>
      ))}
    </div>
  );
}
