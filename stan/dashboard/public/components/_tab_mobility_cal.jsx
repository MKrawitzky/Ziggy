
    // ─── Mobility Calibration QC Tab ─────────────────────────────────────────────
    // Based on: "Impact of Local Air Pressure on Ion Mobilities and Data
    // Consistency in diaPASEF-Based High Throughput Proteomics"
    // J. Proteome Res. 2025, doi:10.1021/acs.jproteome.4c00932
    //
    // Key finding: 15 mbar air-pressure change → 0.025 Vs/cm² systematic 1/K₀ shift.
    // This shifts ALL peptides together (systematic bias), affecting diaPASEF
    // window coverage and peptide ID rates.

    // ── Scatter: Observed vs Predicted 1/K₀ ─────────────────────────────────────
    function MobCalScatter({ data }) {
      const cvRef = React.useRef(null);
      const [hov, setHov] = React.useState(null);
      const ptsRef = React.useRef([]);

      React.useEffect(() => {
        if (!data || !data.scatter) return;
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const PAD = {l:62, r:18, t:32, b:52};

        const { mz, im, pred_im, charge, delta } = data.scatter;
        const n = mz.length;
        if (!n) return;

        // Axis ranges: find min/max of both axes together
        const allIm = [...im, ...pred_im];
        const IM_MIN = Math.max(0.3, Math.min(...allIm) - 0.05);
        const IM_MAX = Math.min(2.2, Math.max(...allIm) + 0.05);
        const toX = v => PAD.l + (v - IM_MIN) / (IM_MAX - IM_MIN) * (W - PAD.l - PAD.r);
        const toY = v => H - PAD.b - (v - IM_MIN) / (IM_MAX - IM_MIN) * (H - PAD.t - PAD.b);

        ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
        const step = 0.1;
        for (let v = Math.ceil(IM_MIN * 10) / 10; v <= IM_MAX + 0.001; v = Math.round((v + step) * 100) / 100) {
          ctx.beginPath(); ctx.moveTo(toX(v), PAD.t); ctx.lineTo(toX(v), H - PAD.b); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(PAD.l, toY(v)); ctx.lineTo(W - PAD.r, toY(v)); ctx.stroke();
          ctx.fillStyle = '#475569'; ctx.font = '8.5px system-ui';
          ctx.textAlign = 'center'; ctx.fillText(v.toFixed(1), toX(v), H - PAD.b + 13);
          ctx.textAlign = 'right';  ctx.fillText(v.toFixed(1), PAD.l - 5, toY(v) + 3);
        }

        // Perfect calibration diagonal (y = x)
        ctx.strokeStyle = 'rgba(34,211,238,0.45)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(IM_MIN), toY(IM_MIN));
        ctx.lineTo(toX(IM_MAX), toY(IM_MAX));
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#22d3ee88'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'left';
        ctx.fillText('Perfect (Δ=0)', toX(IM_MIN + 0.05), toY(IM_MIN + 0.05) - 5);

        // Warn/alert offset lines
        const medShift = data.stats.median_shift;
        const WARN = data.thresholds?.warn || 0.025;
        const ALERT = data.thresholds?.alert || 0.050;
        [[medShift, '#DAAA00', 'Median shift'], [WARN, '#f97316aa', '±warn'], [-WARN, '#f97316aa', '']].forEach(([off, col, lbl]) => {
          if (Math.abs(off) < 0.002) return;
          ctx.strokeStyle = col; ctx.lineWidth = off === medShift ? 2 : 0.8;
          ctx.setLineDash(off === medShift ? [] : [3, 4]);
          ctx.beginPath();
          ctx.moveTo(toX(IM_MIN), toY(IM_MIN + off));
          ctx.lineTo(toX(IM_MAX - off), toY(IM_MAX));
          ctx.stroke(); ctx.setLineDash([]);
          if (lbl && off > 0) {
            ctx.fillStyle = col; ctx.font = `${off === medShift ? 'bold ' : ''}8px system-ui`;
            ctx.textAlign = 'left';
            ctx.fillText(lbl + ' ' + (off > 0 ? '+' : '') + off.toFixed(4), toX(IM_MIN + 0.02), toY(IM_MIN + off + 0.01) - 4);
          }
        });

        // Charge color map
        const CHARGE_COL = { 1:'#60a5fa', 2:'#22d3ee', 3:'#DAAA00', 4:'#d946ef', 5:'#f97316' };
        const pts = [];
        for (let i = 0; i < n; i++) {
          const x = toX(pred_im[i]);
          const y = toY(im[i]);
          if (x < PAD.l || x > W - PAD.r || y < PAD.t || y > H - PAD.b) continue;
          const col = CHARGE_COL[charge[i]] || '#94a3b8';
          const isHov = hov === i;
          const alpha = isHov ? 1.0 : 0.45;
          ctx.beginPath(); ctx.arc(x, y, isHov ? 4.5 : 2.2, 0, Math.PI * 2);
          ctx.fillStyle = col + Math.round(alpha * 255).toString(16).padStart(2, '0');
          ctx.fill();
          pts.push({ i, x, y });
        }
        ptsRef.current = pts;

        // Hover tooltip
        if (hov !== null) {
          const pt = pts.find(p => p.i === hov);
          if (pt) {
            const { x, y } = pt;
            const d = delta[hov];
            const col = CHARGE_COL[charge[hov]] || '#94a3b8';
            const tw = 175, th = 68;
            const tx = Math.min(x + 8, W - tw - 4);
            const ty = Math.max(y - th - 4, PAD.t + 2);
            ctx.fillStyle = 'rgba(14,0,24,0.95)';
            ctx.strokeStyle = col + '88'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 5); ctx.fill(); ctx.stroke();
            ctx.fillStyle = col; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'left';
            ctx.fillText(`z+${charge[hov]}  m/z ${mz[hov].toFixed(2)}`, tx + 6, ty + 14);
            ctx.fillStyle = '#e2e8f0'; ctx.font = '8.5px system-ui';
            ctx.fillText(`Observed  1/K₀: ${im[hov].toFixed(4)} Vs/cm²`,     tx + 6, ty + 28);
            ctx.fillText(`Predicted 1/K₀: ${pred_im[hov].toFixed(4)} Vs/cm²`, tx + 6, ty + 40);
            ctx.fillStyle = Math.abs(d) > WARN ? '#f97316' : '#22c55e';
            ctx.font = 'bold 8.5px system-ui';
            ctx.fillText(`Δ = ${d >= 0 ? '+' : ''}${d.toFixed(4)} Vs/cm²`, tx + 6, ty + 56);
          }
        }

        // Axis labels
        ctx.fillStyle = '#64748b'; ctx.font = '9.5px system-ui';
        ctx.textAlign = 'center'; ctx.fillText('Predicted 1/K₀ (Vs/cm²)', W / 2, H - 4);
        ctx.save(); ctx.translate(13, H / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Observed 1/K₀ (Vs/cm²)', 0, 0); ctx.restore();

        // Legend
        const CHARGES = [1, 2, 3, 4];
        CHARGES.forEach((z, i) => {
          const lx = PAD.l + i * 70;
          ctx.beginPath(); ctx.arc(lx + 5, PAD.t + 12, 4, 0, Math.PI * 2);
          ctx.fillStyle = CHARGE_COL[z] || '#94a3b8'; ctx.fill();
          ctx.fillStyle = '#94a3b8'; ctx.font = '8px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(`z = ${z}`, lx + 12, PAD.t + 16);
        });
      }, [data, hov]);

      const handleMove = e => {
        const cv = cvRef.current; if (!cv || !ptsRef.current.length) return;
        const rect = cv.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (cv.width / rect.width);
        const my = (e.clientY - rect.top) * (cv.height / rect.height);
        let best = null, bestD = 14;
        ptsRef.current.forEach(pt => {
          const d = Math.hypot(mx - pt.x, my - pt.y);
          if (d < bestD) { bestD = d; best = pt.i; }
        });
        setHov(best);
      };

      return (
        <canvas ref={cvRef} width={860} height={440}
          onMouseMove={handleMove} onMouseLeave={() => setHov(null)}
          style={{width:'100%', display:'block', borderRadius:'0.4rem', cursor:'crosshair'}}/>
      );
    }

    // ── Shift Histogram ──────────────────────────────────────────────────────────
    function MobCalHistogram({ data }) {
      const cvRef = React.useRef(null);
      React.useEffect(() => {
        if (!data?.histogram) return;
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const { edges, counts } = data.histogram;
        const PAD = {l:50, r:14, t:20, b:40};
        const maxC = Math.max(...counts, 1);
        const WARN = data.thresholds?.warn || 0.025;

        ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

        const n = edges.length - 1;
        const toX = i => PAD.l + i / n * (W - PAD.l - PAD.r);
        const toY = c => H - PAD.b - c / maxC * (H - PAD.t - PAD.b);

        // Zero line
        const zeroIdx = edges.findIndex(e => e >= -0.001 && e <= 0.001);
        const zeroX = zeroIdx >= 0 ? toX(zeroIdx) : (W / 2);
        ctx.strokeStyle = 'rgba(34,211,238,0.4)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(zeroX, PAD.t); ctx.lineTo(zeroX, H - PAD.b); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#22d3ee55'; ctx.font = '8px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Δ=0', zeroX, PAD.t - 4);

        // Warn threshold lines
        [-WARN, WARN].forEach(w => {
          const wi = edges.findIndex(e => Math.abs(e - w) < 0.012);
          if (wi < 0) return;
          const wx = toX(wi);
          ctx.strokeStyle = '#f9731688'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(wx, PAD.t); ctx.lineTo(wx, H - PAD.b); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#f9731688'; ctx.font = 'bold 7px system-ui'; ctx.textAlign = 'center';
          ctx.fillText((w > 0 ? '+' : '') + w.toFixed(3), wx, H - PAD.b + 11);
        });

        // Bars
        counts.forEach((c, i) => {
          const x1 = toX(i), x2 = toX(i + 1), y = toY(c);
          const midEdge = (edges[i] + edges[i + 1]) / 2;
          const isWarn = Math.abs(midEdge) > WARN;
          const barCol = isWarn ? '#ef4444' : (midEdge < 0 ? '#60a5fa' : '#DAAA00');
          ctx.fillStyle = barCol + 'aa';
          ctx.fillRect(x1, y, x2 - x1 - 0.5, H - PAD.b - y);
        });

        // Median line
        const ms = data.stats.median_shift;
        const msIdx = edges.findIndex(e => e >= ms);
        if (msIdx >= 0) {
          const msx = toX(msIdx);
          ctx.strokeStyle = '#DAAA00'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(msx, PAD.t); ctx.lineTo(msx, H - PAD.b); ctx.stroke();
          ctx.fillStyle = '#DAAA00'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('median', msx, PAD.t + 10);
          ctx.fillText((ms >= 0 ? '+' : '') + ms.toFixed(4), msx, PAD.t + 20);
        }

        // Axis labels
        [-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08].forEach(v => {
          const vi = edges.findIndex(e => Math.abs(e - v) < 0.009);
          if (vi < 0) return;
          const vx = toX(vi);
          ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(vx, PAD.t); ctx.lineTo(vx, H - PAD.b); ctx.stroke();
          ctx.fillStyle = '#64748b'; ctx.font = '8px system-ui'; ctx.textAlign = 'center';
          ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(2), vx, H - PAD.b + 24);
        });
        ctx.fillStyle = '#64748b'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Δ 1/K₀ = Observed − Predicted (Vs/cm²)', W / 2, H - 2);
        ctx.save(); ctx.translate(12, H / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Precursor count', 0, 0); ctx.restore();
      }, [data]);

      return (
        <canvas ref={cvRef} width={860} height={200}
          style={{width:'100%', display:'block', borderRadius:'0.4rem'}}/>
      );
    }

    // ── Run History Shift Trend ──────────────────────────────────────────────────
    function MobCalTrend({ runs, currentRunId }) {
      const cvRef = React.useRef(null);
      const [shiftData, setShiftData] = React.useState({}); // run_id → stats|'loading'|'error'
      const [fetching, setFetching] = React.useState(false);

      const dRuns = (Array.isArray(runs) ? runs : [])
        .filter(r => r.raw_path && (r.raw_path.endsWith('.d') || r.raw_path.endsWith('.d/')))
        .sort((a, b) => (a.run_date || '').localeCompare(b.run_date || ''))
        .slice(-30); // last 30 timsTOF runs

      const loadAll = async () => {
        setFetching(true);
        for (const r of dRuns) {
          const sid = String(r.id);
          if (shiftData[sid] && shiftData[sid] !== 'error') continue;
          setShiftData(prev => ({...prev, [sid]: 'loading'}));
          try {
            const res = await fetch(API + `/api/runs/${sid}/mobility-calibration?max_points=500`);
            const d = res.ok ? await res.json() : null;
            setShiftData(prev => ({...prev, [sid]: (d && d.stats) ? d : 'error'}));
          } catch {
            setShiftData(prev => ({...prev, [sid]: 'error'}));
          }
        }
        setFetching(false);
      };

      React.useEffect(() => {
        if (!dRuns.length) return;
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const PAD = {l:58, r:14, t:24, b:60};
        const WARN = 0.025, ALERT = 0.050;

        ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

        const dataRuns = dRuns.filter(r => {
          const d = shiftData[String(r.id)];
          return d && d !== 'loading' && d !== 'error' && d.stats;
        });

        if (!dataRuns.length) {
          ctx.fillStyle = '#334155'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('Click "Load shift history" to fetch calibration data for recent runs', W / 2, H / 2);
          ctx.fillStyle = '#1e293b'; ctx.font = '10px system-ui';
          ctx.fillText(`(${dRuns.length} timsTOF runs available)`, W / 2, H / 2 + 20);
          return;
        }

        const shifts = dataRuns.map(r => shiftData[String(r.id)].stats.median_shift);
        const SHIFT_MIN = Math.min(-ALERT - 0.005, ...shifts) - 0.01;
        const SHIFT_MAX = Math.max(ALERT + 0.005, ...shifts) + 0.01;

        const toX = i => PAD.l + (i / (dataRuns.length - 1 || 1)) * (W - PAD.l - PAD.r);
        const toY = v => H - PAD.b - (v - SHIFT_MIN) / (SHIFT_MAX - SHIFT_MIN) * (H - PAD.t - PAD.b);

        // Colored zone backgrounds
        [[SHIFT_MIN, -ALERT, 'rgba(239,68,68,0.10)'],
         [-ALERT, -WARN,    'rgba(249,115,22,0.06)'],
         [-WARN, WARN,      'rgba(34,197,94,0.05)'],
         [WARN, ALERT,      'rgba(249,115,22,0.06)'],
         [ALERT, SHIFT_MAX, 'rgba(239,68,68,0.10)']].forEach(([lo, hi, col]) => {
          const y1 = toY(hi), y2 = toY(lo);
          ctx.fillStyle = col; ctx.fillRect(PAD.l, y1, W - PAD.l - PAD.r, y2 - y1);
        });

        // Zero and threshold lines
        [0, WARN, -WARN, ALERT, -ALERT].forEach(v => {
          const vy = toY(v);
          ctx.strokeStyle = v === 0 ? 'rgba(34,211,238,0.4)' : v === WARN || v === -WARN ? 'rgba(249,115,22,0.5)' : 'rgba(239,68,68,0.5)';
          ctx.lineWidth = v === 0 ? 1.5 : 0.8; ctx.setLineDash(v === 0 ? [5, 4] : [3, 3]);
          ctx.beginPath(); ctx.moveTo(PAD.l, vy); ctx.lineTo(W - PAD.r, vy); ctx.stroke();
          ctx.setLineDash([]);
          if (v >= 0) {
            const lbl = v === 0 ? 'Δ=0 (perfect)' : v === WARN ? `+${WARN} warn` : `+${ALERT} alert`;
            ctx.fillStyle = v === 0 ? '#22d3ee55' : v === WARN ? '#f9731655' : '#ef444455';
            ctx.font = '7.5px system-ui'; ctx.textAlign = 'left';
            ctx.fillText(lbl, PAD.l + 3, vy - 2);
          }
        });

        // Area fill
        if (dataRuns.length > 1) {
          ctx.beginPath();
          ctx.moveTo(toX(0), toY(0));
          dataRuns.forEach((_, i) => { i === 0 ? ctx.moveTo(toX(i), toY(shifts[i])) : ctx.lineTo(toX(i), toY(shifts[i])); });
          ctx.lineTo(toX(dataRuns.length - 1), toY(0));
          ctx.closePath();
          ctx.fillStyle = 'rgba(218,170,0,0.08)'; ctx.fill();
        }

        // Line
        ctx.strokeStyle = '#DAAA00'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
        ctx.beginPath();
        dataRuns.forEach((_, i) => { i === 0 ? ctx.moveTo(toX(i), toY(shifts[i])) : ctx.lineTo(toX(i), toY(shifts[i])); });
        ctx.stroke();

        // Dots
        dataRuns.forEach((r, i) => {
          const v = shifts[i];
          const col = Math.abs(v) > ALERT ? '#ef4444' : Math.abs(v) > WARN ? '#f97316' : '#22c55e';
          const isCurrent = String(r.id) === String(currentRunId);
          ctx.beginPath(); ctx.arc(toX(i), toY(v), isCurrent ? 5.5 : 3.5, 0, Math.PI * 2);
          ctx.fillStyle = col; ctx.fill();
          if (isCurrent) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
        });

        // X-axis date labels (every ~5 runs)
        const step = Math.max(1, Math.floor(dataRuns.length / 8));
        dataRuns.forEach((r, i) => {
          if (i % step !== 0 && i !== dataRuns.length - 1) return;
          const d = new Date(r.run_date);
          const lbl = d.toLocaleDateString([], {month:'short', day:'numeric'});
          ctx.fillStyle = '#475569'; ctx.font = '7.5px system-ui'; ctx.textAlign = 'center';
          ctx.save(); ctx.translate(toX(i), H - PAD.b + 8); ctx.rotate(-Math.PI / 4);
          ctx.fillText(lbl, 0, 0); ctx.restore();
        });

        // Y-axis ticks
        [-0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06].filter(v => v >= SHIFT_MIN && v <= SHIFT_MAX).forEach(v => {
          ctx.fillStyle = '#475569'; ctx.font = '8px system-ui'; ctx.textAlign = 'right';
          ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(3), PAD.l - 4, toY(v) + 3);
        });
        ctx.fillStyle = '#64748b'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
        ctx.save(); ctx.translate(12, H / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Median Δ 1/K₀ (Vs/cm²)', 0, 0); ctx.restore();

      }, [shiftData, dRuns, currentRunId]);

      return (
        <div>
          <div style={{display:'flex', gap:'0.5rem', marginBottom:'0.5rem', alignItems:'center'}}>
            <button onClick={loadAll} disabled={fetching || !dRuns.length}
              style={{padding:'0.3rem 0.75rem', fontSize:'0.8rem', fontWeight:600,
                background: dRuns.length ? 'rgba(218,170,0,0.15)' : 'var(--surface)',
                color: dRuns.length ? '#DAAA00' : 'var(--muted)',
                border:'1px solid rgba(218,170,0,0.3)', borderRadius:'0.35rem', cursor:'pointer'}}>
              {fetching ? 'Loading…' : `Load shift history (${dRuns.length} timsTOF runs)`}
            </button>
            <span style={{fontSize:'0.72rem', color:'#64748b'}}>Last 30 timsTOF runs · fetches calibration data from each report.parquet</span>
          </div>
          <canvas ref={cvRef} width={860} height={260}
            style={{width:'100%', display:'block', borderRadius:'0.4rem'}}/>
        </div>
      );
    }

    // ── Mass Drift Panel ─────────────────────────────────────────────────────────
    // Fits a linear calibration line through the 3 CCS compendium anchor points
    // (m/z 622, 922, 1221 → their reference 1/K₀ from analysis.tdf CalibrationInfo).
    // Then plots Δ(1/K₀) = actual − predicted for EVERY detected ion in the run.
    // The 3 calibrant ions appear as labelled anchors; all other ions are coloured by charge.
    // Requires: calibrant-drift (TDF, no DIA-NN) + mobility-3d (4DFF or DIA-NN).
    function MobCalMassDrift({ runId }) {
      const cvRef   = React.useRef(null);
      const ptsRef  = React.useRef([]);
      const [hov,   setHov]     = React.useState(null);
      const [calib, setCalib]   = React.useState(null);   // calibrant-drift response
      const [ions,  setIons]    = React.useState(null);   // mobility-3d response
      const [loading, setLoading] = React.useState(false);
      const [error,   setError]   = React.useState('');

      React.useEffect(() => {
        if (!runId) { setCalib(null); setIons(null); setError(''); return; }
        setLoading(true); setError(''); setCalib(null); setIons(null);
        Promise.all([
          fetch(API + `/api/runs/${runId}/calibrant-drift`).then(r => r.json()).catch(() => null),
          fetch(API + `/api/runs/${runId}/mobility-3d?max_features=8000`).then(r => r.json()).catch(() => null),
        ]).then(([cDrift, m3d]) => {
          if (!cDrift || cDrift.error) { setError(cDrift?.message || 'No TDF calibration data.'); return; }
          if (!m3d || !m3d.mz || !m3d.mz.length) { setError('No ion data (needs 4DFF features or DIA-NN report).'); return; }
          setCalib(cDrift);
          setIons(m3d);
        }).finally(() => setLoading(false));
      }, [runId]);

      React.useEffect(() => {
        if (!calib || !ions) return;
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const PAD = { l: 70, r: 28, t: 36, b: 58 };

        // ── Linear fit through the 3 CCS compendium anchor ions (622, 922, 1221) ──
        // Fall back to all compounds if none are tagged is_target (TDF may lack ReferencePeakMasses)
        let anchors = (calib.compounds || []).filter(c => c.is_target && c.ref_mz != null && c.ref_k0 != null);
        if (anchors.length < 2) {
          anchors = (calib.compounds || [])
            .filter(c => c.ref_mz != null && c.ref_k0 != null)
            .sort((a, b) => a.ref_mz - b.ref_mz);
        }
        if (anchors.length < 2) {
          ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#64748b'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('Not enough calibrant data to fit a calibration line.', W/2, H/2 - 12);
          ctx.fillText(`TDF returned ${(calib.compounds||[]).length} compound(s) — need ≥ 2 with m/z values.`, W/2, H/2 + 12);
          return;
        }
        const ax = anchors.map(a => a.ref_mz);
        const ay = anchors.map(a => a.ref_k0);
        const n  = ax.length;
        let sx=0, sy=0, sxy=0, sx2=0;
        for (let i=0;i<n;i++) { sx+=ax[i]; sy+=ay[i]; sxy+=ax[i]*ay[i]; sx2+=ax[i]*ax[i]; }
        const fitA = (n*sxy - sx*sy) / (n*sx2 - sx*sx);
        const fitB = (sy - fitA*sx) / n;
        const predicted = mz => fitA * mz + fitB;

        // ── Ion data → compute Δ per ion ──────────────────────────────────────
        const mzArr     = ions.mz     || [];
        const ook0Arr   = ions.ook0   || [];
        const chargeArr = ions.charge || [];
        const N = mzArr.length;

        // Axis extents
        let mzMin = Infinity, mzMax = -Infinity;
        let dMin = Infinity,  dMax = -Infinity;
        for (let i=0;i<N;i++) {
          const mz = mzArr[i], k0 = ook0Arr[i];
          if (mz == null || k0 == null) continue;
          const delta = k0 - predicted(mz);
          if (mz < mzMin) mzMin = mz;
          if (mz > mzMax) mzMax = mz;
          if (delta < dMin) dMin = delta;
          if (delta > dMax) dMax = delta;
        }
        // Symmetrise Y and add margin
        const dAbs   = Math.max(0.06, Math.abs(dMin), Math.abs(dMax)) * 1.15;
        const yLo    = -dAbs, yHi = dAbs;
        mzMin = Math.max(200, mzMin - 50);
        mzMax = Math.min(1600, mzMax + 50);

        const toX = mz  => PAD.l + (mz - mzMin)  / (mzMax - mzMin)  * (W - PAD.l - PAD.r);
        const toY = val => H - PAD.b - (val - yLo) / (yHi - yLo) * (H - PAD.t - PAD.b);

        ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

        // ── Grid ─────────────────────────────────────────────────────────────
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
        [300,400,500,600,700,800,900,1000,1100,1200,1300,1400,1500].forEach(v => {
          const x = toX(v); if (x < PAD.l || x > W - PAD.r) return;
          ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
          ctx.fillStyle = '#475569'; ctx.font = '8.5px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(v, x, H - PAD.b + 13);
        });
        const yTicks = [-0.08,-0.06,-0.04,-0.02,0,0.02,0.04,0.06,0.08].filter(v => v >= yLo && v <= yHi);
        yTicks.forEach(v => {
          const y = toY(v);
          ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
          ctx.fillStyle = '#475569'; ctx.font = '8.5px system-ui'; ctx.textAlign = 'right';
          ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(2), PAD.l - 5, y + 3);
        });

        // ── Threshold lines ───────────────────────────────────────────────────
        const WARN = 0.025, ALERT = 0.050;
        [
          [0,      '#22d3ee', 1.5, [6,4],  'Perfect (Δ=0)'],
          [WARN,   '#f97316', 0.9, [4,5],  '+warn'],
          [-WARN,  '#f97316', 0.9, [4,5],  '-warn'],
          [ALERT,  '#ef4444', 0.7, [2,5],  ''],
          [-ALERT, '#ef4444', 0.7, [2,5],  ''],
        ].forEach(([v, col, lw, dash, lbl]) => {
          if (v < yLo || v > yHi) return;
          const y = toY(v);
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash);
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
          ctx.setLineDash([]);
          if (lbl) {
            ctx.fillStyle = col + 'cc'; ctx.font = '8px system-ui'; ctx.textAlign = 'left';
            ctx.fillText(lbl, W - PAD.r + 2, y + 3);
          }
        });

        // ── Ion dots (charge-coloured) ────────────────────────────────────────
        const CHARGE_COL = {1:'#2dd4bf', 2:'#60a5fa', 3:'#22c55e', 4:'#f97316', 5:'#a855f7'};
        const pts = [];
        for (let i=0;i<N;i++) {
          const mz = mzArr[i], k0 = ook0Arr[i];
          if (mz == null || k0 == null) continue;
          const delta = k0 - predicted(mz);
          const x = toX(mz), y = toY(delta);
          if (x < PAD.l - 1 || x > W - PAD.r + 1 || y < PAD.t - 1 || y > H - PAD.b + 1) continue;
          const z = chargeArr[i] || 0;
          const col = CHARGE_COL[z] || '#94a3b8';
          ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI*2);
          ctx.fillStyle = col + '55'; ctx.fill();
          pts.push({ i, x, y, mz, k0, delta, z, col });
        }
        ptsRef.current = pts;

        // ── Calibrant anchors ────────────────────────────────────────────────
        anchors.forEach((a, ai) => {
          const anchorDelta = (a.meas_k0 || a.ref_k0) - predicted(a.ref_mz);
          const x = toX(a.ref_mz);
          const y = toY(anchorDelta);
          // Glow ring
          const dCol = Math.abs(anchorDelta) > ALERT ? '#ef4444'
                     : Math.abs(anchorDelta) > WARN  ? '#f97316' : '#22c55e';
          ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI*2);
          ctx.strokeStyle = dCol + '55'; ctx.lineWidth = 4; ctx.stroke();
          // Filled circle
          ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI*2);
          ctx.fillStyle = dCol; ctx.fill();
          // Label: m/z value above dot
          const label = a.ref_mz ? Math.round(a.ref_mz) + '' : (a.compound || `C${ai+1}`);
          ctx.fillStyle = '#f0e8ff'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('m/z ' + label, x, y - 16);
          // Δ value below dot
          ctx.fillStyle = dCol; ctx.font = '8px monospace';
          ctx.fillText((anchorDelta >= 0 ? '+' : '') + anchorDelta.toFixed(4), x, y + 22);
        });

        // ── Hover tooltip ────────────────────────────────────────────────────
        if (hov !== null) {
          const pt = pts.find(p => p.i === hov);
          if (pt) {
            const { x, y, mz, k0, delta, z, col } = pt;
            const tw = 190, th = 72;
            const tx = Math.min(x + 10, W - tw - 4);
            const ty = Math.max(y - th - 4, PAD.t + 2);
            ctx.fillStyle = 'rgba(6,0,15,0.95)';
            ctx.strokeStyle = col + '88'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 5); ctx.fill(); ctx.stroke();
            ctx.fillStyle = col; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'left';
            ctx.fillText(`z+${z}  m/z ${mz.toFixed(3)}`, tx + 6, ty + 14);
            ctx.fillStyle = '#e2e8f0'; ctx.font = '8.5px system-ui';
            ctx.fillText(`Actual  1/K₀: ${k0.toFixed(4)} Vs/cm²`,     tx + 6, ty + 28);
            ctx.fillText(`Predicted 1/K₀: ${predicted(mz).toFixed(4)} Vs/cm²`, tx + 6, ty + 40);
            ctx.fillStyle = Math.abs(delta) > WARN ? '#f97316' : '#22c55e';
            ctx.font = 'bold 8.5px system-ui';
            ctx.fillText(`Δ = ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} Vs/cm²`, tx + 6, ty + 58);
          }
        }

        // ── Axis labels ───────────────────────────────────────────────────────
        ctx.fillStyle = '#64748b'; ctx.font = '9.5px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('m/z', W / 2, H - 2);
        ctx.save(); ctx.translate(13, H / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Δ 1/K₀ (actual − calibration line)  Vs/cm²', 0, 0); ctx.restore();

        // ── Title ─────────────────────────────────────────────────────────────
        ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'left';
        ctx.fillText(`Linear fit through ${anchors.length} calibrant anchors · ${N.toLocaleString()} ions`, PAD.l + 4, PAD.t - 8);

        // ── Charge legend ─────────────────────────────────────────────────────
        [1,2,3,4,5].forEach((z, i) => {
          const lx = W - PAD.r - 220 + i * 44;
          ctx.beginPath(); ctx.arc(lx + 5, PAD.t - 14, 4, 0, Math.PI*2);
          ctx.fillStyle = (CHARGE_COL[z] || '#94a3b8'); ctx.fill();
          ctx.fillStyle = '#94a3b8'; ctx.font = '8px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(`+${z}`, lx + 12, PAD.t - 10);
        });
      }, [calib, ions, hov]);

      const handleMove = e => {
        const cv = cvRef.current; if (!cv || !ptsRef.current.length) return;
        const rect = cv.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (cv.width  / rect.width);
        const my = (e.clientY - rect.top)  * (cv.height / rect.height);
        let best = null, bestD = 14;
        ptsRef.current.forEach(pt => {
          const d = Math.hypot(mx - pt.x, my - pt.y);
          if (d < bestD) { bestD = d; best = pt.i; }
        });
        setHov(best);
      };

      if (!runId) return (
        <div style={{padding:'2rem', textAlign:'center', color:'#64748b', fontSize:'0.85rem'}}>
          Select a timsTOF run above to view mass drift
        </div>
      );
      if (loading) return <div style={{padding:'2rem', textAlign:'center', color:'#22d3ee'}}>Loading calibrant + ion data…</div>;
      if (error) return (
        <div style={{padding:'0.75rem', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.3)',
          borderRadius:'0.4rem', color:'#fca5a5', fontSize:'0.78rem'}}>{error}</div>
      );
      if (!calib || !ions) return null;

      // Summary stats — target ions first, fall back to all if none tagged
      let anchors = (calib.compounds || []).filter(c => c.is_target && c.ref_mz != null && c.ref_k0 != null);
      if (anchors.length < 2) anchors = (calib.compounds || []).filter(c => c.ref_mz != null && c.ref_k0 != null).sort((a,b) => a.ref_mz - b.ref_mz);
      const ax = anchors.map(a => a.ref_mz);
      const ay = anchors.map(a => a.ref_k0);
      const nA = ax.length;
      let sx=0,sy=0,sxy=0,sx2=0;
      for(let i=0;i<nA;i++){sx+=ax[i];sy+=ay[i];sxy+=ax[i]*ay[i];sx2+=ax[i]*ax[i];}
      const fitA = (nA*sxy-sx*sy)/(nA*sx2-sx*sx);
      const fitB = (sy-fitA*sx)/nA;
      const anchorDeltas = anchors.map(a => ((a.meas_k0||a.ref_k0) - (fitA*a.ref_mz+fitB)));
      const maxAnchorDrift = Math.max(...anchorDeltas.map(Math.abs));
      const overallStatus = maxAnchorDrift < 0.025 ? 'PASS' : maxAnchorDrift < 0.050 ? 'WARN' : 'ALERT';
      const statusCol = overallStatus === 'PASS' ? '#22c55e' : overallStatus === 'WARN' ? '#f97316' : '#ef4444';

      return (
        <div>
          <div style={{display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'0.75rem', alignItems:'stretch'}}>
            {[
              {label:'Calibrant anchors', val: `${anchors.length} ions`,   col:'#22d3ee'},
              {label:'Fit slope',         val: `${fitA >= 0 ? '+' : ''}${fitA.toFixed(5)} Vs·cm⁻²/Th`, col:'#94a3b8'},
              {label:'Fit intercept',     val: `${fitB >= 0 ? '+' : ''}${fitB.toFixed(4)} Vs/cm²`, col:'#94a3b8'},
              {label:'Max anchor |Δ|',    val: `${maxAnchorDrift.toFixed(5)} Vs/cm²`, col: statusCol},
              {label:'Status',            val: overallStatus, col: statusCol},
              {label:'Total ions shown',  val: (ions.mz||[]).length.toLocaleString(), col:'#64748b'},
            ].map(s => (
              <div key={s.label} style={{background:'rgba(0,0,0,0.45)', border:`1px solid ${s.col}22`,
                borderRadius:'0.4rem', padding:'0.45rem 0.65rem', textAlign:'center', flex:'1 1 120px'}}>
                <div style={{fontSize:'0.95rem', fontWeight:800, color:s.col, lineHeight:1.1}}>{s.val}</div>
                <div style={{fontSize:'0.67rem', color:'#64748b', marginTop:'0.15rem'}}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{fontSize:'0.73rem', color:'#64748b', lineHeight:1.6, marginBottom:'0.65rem',
            padding:'0.45rem 0.7rem', background:'rgba(34,211,238,0.04)', borderRadius:'0.35rem',
            borderLeft:'3px solid rgba(34,211,238,0.3)'}}>
            <strong style={{color:'#22d3ee'}}>How to read this:</strong>{' '}
            A linear calibration line is fitted through the 3 Agilent ESI-L calibrant reference 1/K₀ values
            (m/z 622 · 922 · 1221).
            Every detected ion is then plotted as its residual{' '}
            <strong style={{color:'#DAAA00'}}>Δ(1/K₀) = actual − predicted</strong> vs its m/z.
            A flat cloud centred on Δ=0 means the calibration holds uniformly across the mass range.
            A tilt or systematic offset indicates mass-dependent drift.
            The labelled anchor circles show where the 3 calibrant ions landed vs the fitted line.
          </div>

          <canvas ref={cvRef} width={900} height={460}
            onMouseMove={handleMove} onMouseLeave={() => setHov(null)}
            style={{width:'100%', display:'block', borderRadius:'0.4rem', cursor:'crosshair'}}/>

          {/* Per-anchor detail row */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:'0.4rem', marginTop:'0.65rem'}}>
            {anchors.map((a, i) => {
              const d = (a.meas_k0||a.ref_k0) - (fitA*a.ref_mz+fitB);
              const dCol = Math.abs(d) > 0.050 ? '#ef4444' : Math.abs(d) > 0.025 ? '#f97316' : '#22c55e';
              return (
                <div key={i} style={{background:'rgba(0,0,0,0.4)', border:`1px solid ${dCol}33`,
                  borderRadius:'0.4rem', padding:'0.45rem 0.65rem', fontSize:'0.78rem'}}>
                  <div style={{fontWeight:700, color:'#e2e8f0', marginBottom:'0.2rem'}}>
                    {a.compound || `Calibrant ${i+1}`}
                    <span style={{color:'#64748b', fontWeight:400, marginLeft:'0.4rem', fontSize:'0.7rem'}}>
                      m/z {a.ref_mz?.toFixed(2)}
                    </span>
                  </div>
                  <div style={{display:'flex', gap:'1rem'}}>
                    <span style={{color:'#94a3b8'}}>Ref 1/K₀: <strong style={{color:'#22d3ee'}}>{a.ref_k0?.toFixed(5)}</strong></span>
                    <span style={{color:'#94a3b8'}}>Meas: <strong style={{color:'#e2e8f0'}}>{(a.meas_k0||a.ref_k0)?.toFixed(5)}</strong></span>
                    <span style={{color:'#94a3b8'}}>Δ calib line: <strong style={{color:dCol}}>{d >= 0 ? '+' : ''}{d.toFixed(5)}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Intra-run RT Drift Panel ─────────────────────────────────────────────────
    // Shows how Δ1/K₀ (IM − Predicted.IM) evolves through a run's retention time.
    // flat = uniform environmental shift  •  slope = drift mid-run  •  step = event
    function MobCalRtDrift({ runId }) {
      const cvRef     = React.useRef(null);
      const animRef   = React.useRef(null);
      const phaseRef  = React.useRef(0);
      const [data,    setData]    = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [error,   setError]   = React.useState('');
      const [hovBin,  setHovBin]  = React.useState(null);

      React.useEffect(() => {
        if (!runId) return;
        setLoading(true); setError(''); setData(null);
        fetch(API + `/api/runs/${runId}/mobility-rt-drift?n_bins=50`)
          .then(r => r.json())
          .then(d => { if (d.error) setError(d.message || d.error); else setData(d); })
          .catch(e => setError('Network error: ' + e.message))
          .finally(() => setLoading(false));
      }, [runId]);

      // Animation loop — redraw at 30 fps for scan + pulse effects
      React.useEffect(() => {
        if (!data) return;
        let running = true;
        const loop = (ts) => {
          if (!running) return;
          phaseRef.current = ts / 1000;
          draw();
          animRef.current = requestAnimationFrame(loop);
        };
        animRef.current = requestAnimationFrame(loop);
        return () => { running = false; cancelAnimationFrame(animRef.current); };
      }, [data, hovBin]);

      const draw = () => {
        const cv = cvRef.current;
        if (!cv || !data) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const phase = phaseRef.current;

        const PAD = {l:70, r:90, t:48, b:106};
        const PH = 32; // histogram strip height at bottom
        const plotH = H - PAD.t - PAD.b - PH - 8;
        const plotW = W - PAD.l - PAD.r;
        const plotY0 = PAD.t;           // top of main plot
        const histY0 = plotY0 + plotH + 8 + PH - PH; // start of histogram strip
        const histActualY = plotY0 + plotH + 8;

        const { rt_bins_min: rtBins, median_delta: med, p05_delta: p05,
                p95_delta: p95, n_per_bin: nBins, charge_medians: cm,
                run_rt_max: rtMax, run_rt_min: rtMin,
                drift_slope_vs_per_cm2_per_min: slope,
                intra_run_range_vs_per_cm2: drange } = data;
        const N = rtBins.length;

        // Y axis range
        const validMeds = med.filter(v => v != null);
        const validAll  = [...(p05.filter(Boolean)), ...(p95.filter(Boolean))];
        const WARN = 0.025, ALERT = 0.050;
        let yLo = Math.min(-WARN * 1.3, ...validAll) - 0.005;
        let yHi = Math.max( WARN * 1.3, ...validAll) + 0.005;
        const yRange = yHi - yLo;
        yLo -= yRange * 0.05; yHi += yRange * 0.05;

        const toX = rt  => PAD.l + (rt  - rtMin) / (rtMax - rtMin) * plotW;
        const toY = val => plotY0 + plotH - (val - yLo) / (yHi - yLo) * plotH;

        // ── Background ──────────────────────────────────────────────────────────
        ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

        // Outer glow frame
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, 'rgba(34,211,238,0.06)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(34,211,238,0.03)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

        // ── Grid ────────────────────────────────────────────────────────────────
        ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 0.5;
        const yTicks = [-0.08,-0.06,-0.04,-0.02,0,0.02,0.04,0.06,0.08].filter(v => v>=yLo && v<=yHi);
        yTicks.forEach(v => {
          const y = toY(v);
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W-PAD.r, y); ctx.stroke();
          ctx.fillStyle = '#475569'; ctx.font = '8px system-ui'; ctx.textAlign = 'right';
          ctx.fillText((v>=0?'+':'')+v.toFixed(2), PAD.l-5, y+3);
          // Right axis — pressure estimate
          const mbar = Math.round(Math.abs(v) / 0.025 * 15);
          ctx.fillStyle = '#334155'; ctx.textAlign = 'left';
          ctx.fillText(v===0?'0 mb':(v>0?'+':'-')+mbar+' mb', W-PAD.r+4, y+3);
        });
        // RT grid
        const rtSpan = rtMax - rtMin;
        const rtStep = rtSpan > 80 ? 20 : rtSpan > 40 ? 10 : rtSpan > 20 ? 5 : 2;
        for (let rt = Math.ceil(rtMin/rtStep)*rtStep; rt <= rtMax; rt += rtStep) {
          const x = toX(rt);
          ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(x, plotY0); ctx.lineTo(x, plotY0+plotH); ctx.stroke();
          ctx.fillStyle = '#475569'; ctx.font = '8.5px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(rt + ' min', x, plotY0 + plotH + 13);
        }

        // ── WARN / ALERT bands ───────────────────────────────────────────────────
        const bandPairs = [
          [ALERT,  '#ef444415'],
          [-ALERT, '#ef444415'],
          [WARN,   '#f9731612'],
          [-WARN,  '#f9731612'],
        ];
        // Draw full-width bands between threshold lines
        ctx.fillStyle = '#ef444410';
        const yAlert = toY(ALERT), yNAlert = toY(-ALERT);
        if (yNAlert > plotY0 && yAlert < plotY0+plotH) {
          ctx.fillRect(PAD.l, Math.max(plotY0, yAlert), plotW, Math.min(plotH, yNAlert - yAlert));
        }
        // Warn band above alert
        ctx.fillStyle = '#f9731608';
        const yWarn = toY(WARN), yNWarn = toY(-WARN);
        if (yNWarn > plotY0 && yNAlert > plotY0) {
          ctx.fillRect(PAD.l, Math.max(plotY0, yAlert), plotW, Math.min(plotH, yWarn - yAlert));
          ctx.fillRect(PAD.l, Math.max(plotY0, yNWarn), plotW, Math.min(plotH, yNAlert - yNWarn));
        }

        // Threshold dashed lines
        [[0, '#22d3ee', 1.5, [6,4]], [WARN,'#f97316',0.8,[4,5]], [-WARN,'#f97316',0.8,[4,5]],
         [ALERT,'#ef4444',0.7,[2,5]], [-ALERT,'#ef4444',0.7,[2,5]]].forEach(([v, col, lw, dash]) => {
          if (v < yLo || v > yHi) return;
          const y = toY(v);
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash);
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W-PAD.r, y); ctx.stroke();
          ctx.setLineDash([]);
        });

        // ── Confidence band (p05–p95) ────────────────────────────────────────────
        const bandPath = new Path2D();
        let started = false;
        for (let i = 0; i < N; i++) {
          if (p95[i] == null) { started = false; continue; }
          const x = toX(rtBins[i]), y = toY(p95[i]);
          started ? bandPath.lineTo(x, y) : (bandPath.moveTo(x, y), started = true);
        }
        for (let i = N-1; i >= 0; i--) {
          if (p05[i] == null) continue;
          bandPath.lineTo(toX(rtBins[i]), toY(p05[i]));
        }
        bandPath.closePath();
        ctx.fillStyle = 'rgba(34,211,238,0.08)'; ctx.fill(bandPath);
        ctx.strokeStyle = 'rgba(34,211,238,0.15)'; ctx.lineWidth = 0.7; ctx.setLineDash([2,3]);
        ctx.stroke(bandPath); ctx.setLineDash([]);

        // ── Charge-state lines ───────────────────────────────────────────────────
        const CHARGE_COLS = { '2':'#60a5fa', '3':'#4ade80', '4':'#fb923c' };
        ['4','3','2'].forEach(z => {
          const cmed = cm[z];
          ctx.strokeStyle = CHARGE_COLS[z] + '55'; ctx.lineWidth = 1.2; ctx.setLineDash([3,4]);
          ctx.beginPath(); let s2 = false;
          for (let i=0;i<N;i++) {
            if (cmed[i]==null) { s2=false; continue; }
            const x=toX(rtBins[i]), y=toY(cmed[i]);
            s2 ? ctx.lineTo(x,y) : (ctx.moveTo(x,y), s2=true);
          }
          ctx.stroke(); ctx.setLineDash([]);
        });

        // ── Main median line — glow layers ───────────────────────────────────────
        const drawMedianLine = (lineWidth, alpha) => {
          ctx.lineWidth = lineWidth;
          ctx.beginPath(); let started3 = false;
          for (let i=0;i<N;i++) {
            if (med[i]==null) { started3=false; continue; }
            const severity = Math.min(1, Math.abs(med[i]) / ALERT);
            const r = Math.round(34  + (239-34)  * severity);
            const g = Math.round(211 + (68-211)  * severity);
            const b = Math.round(238 + (68-238)  * severity);
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            const x = toX(rtBins[i]), y = toY(med[i]);
            if (!started3) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y); started3=true; }
            else { ctx.lineTo(x,y); }
          }
          ctx.stroke();
        };
        drawMedianLine(8, 0.07);
        drawMedianLine(4, 0.15);
        drawMedianLine(1.8, 0.9);

        // ── Hover bin highlight ──────────────────────────────────────────────────
        if (hovBin != null && hovBin >= 0 && hovBin < N && med[hovBin] != null) {
          const x = toX(rtBins[hovBin]);
          const severity = Math.min(1, Math.abs(med[hovBin]) / ALERT);
          const r = Math.round(34  + (239-34)  * severity);
          const g = Math.round(211 + (68-211)  * severity);
          const b = Math.round(238 + (68-238)  * severity);
          ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`; ctx.lineWidth=1; ctx.setLineDash([3,3]);
          ctx.beginPath(); ctx.moveTo(x, plotY0); ctx.lineTo(x, plotY0+plotH); ctx.stroke();
          ctx.setLineDash([]);
          // Dot
          ctx.beginPath(); ctx.arc(x, toY(med[hovBin]), 5, 0, Math.PI*2);
          ctx.fillStyle = `rgba(${r},${g},${b},0.9)`; ctx.fill();
          // Tooltip
          const tw=210, th=88;
          const tx = Math.min(x+10, W-PAD.r-tw-4);
          const ty = Math.max(plotY0+4, toY(med[hovBin])-th-8);
          ctx.fillStyle='rgba(6,0,15,0.96)'; ctx.strokeStyle=`rgba(${r},${g},${b},0.5)`; ctx.lineWidth=1;
          ctx.beginPath(); ctx.roundRect(tx,ty,tw,th,5); ctx.fill(); ctx.stroke();
          ctx.fillStyle=`rgb(${r},${g},${b})`; ctx.font='bold 9px system-ui'; ctx.textAlign='left';
          ctx.fillText(`RT ${rtBins[hovBin].toFixed(1)} min`, tx+7, ty+14);
          ctx.fillStyle='#e2e8f0'; ctx.font='8.5px system-ui';
          ctx.fillText(`Median Δ1/K₀: ${med[hovBin]>=0?'+':''}${med[hovBin].toFixed(5)} Vs/cm²`, tx+7, ty+28);
          if (p05[hovBin]!=null) ctx.fillText(`5th–95th: ${p05[hovBin].toFixed(4)} → ${p95[hovBin].toFixed(4)}`, tx+7, ty+42);
          ctx.fillText(`Precursors in bin: ${nBins[hovBin].toLocaleString()}`, tx+7, ty+56);
          const mbarEst = Math.round(Math.abs(med[hovBin]) / 0.025 * 15);
          ctx.fillStyle=`rgb(${r},${g},${b})`; ctx.font='bold 8px monospace';
          ctx.fillText(`Est. ΔP: ~${mbarEst} mbar`, tx+7, ty+74);
        }

        // ── Animated scan line ───────────────────────────────────────────────────
        const scanFrac = (phase * 0.12) % 1;
        const scanX2 = PAD.l + scanFrac * plotW;
        const scanGrad = ctx.createLinearGradient(scanX2-40, 0, scanX2+2, 0);
        scanGrad.addColorStop(0, 'rgba(34,211,238,0)');
        scanGrad.addColorStop(1, 'rgba(34,211,238,0.12)');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(scanX2-40, plotY0, 42, plotH);
        ctx.strokeStyle = 'rgba(34,211,238,0.25)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(scanX2, plotY0); ctx.lineTo(scanX2, plotY0+plotH); ctx.stroke();

        // Pulsing dot at last valid median
        let lastI = N-1;
        while (lastI > 0 && med[lastI] == null) lastI--;
        if (med[lastI] != null) {
          const px = toX(rtBins[lastI]), py = toY(med[lastI]);
          const pulse = 0.5 + 0.5 * Math.sin(phase * 4);
          const severity = Math.min(1, Math.abs(med[lastI]) / ALERT);
          const r=Math.round(34+(239-34)*severity), g=Math.round(211+(68-211)*severity), b=Math.round(238+(68-238)*severity);
          ctx.beginPath(); ctx.arc(px, py, 6 + pulse*4, 0, Math.PI*2);
          ctx.strokeStyle = `rgba(${r},${g},${b},${0.4*pulse})`; ctx.lineWidth=1.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI*2);
          ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fill();
        }

        // ── Precursor histogram strip ────────────────────────────────────────────
        const maxN = Math.max(...nBins);
        const hStrip = PH - 4;
        const hY0 = histActualY;
        ctx.fillStyle='rgba(34,211,238,0.05)'; ctx.fillRect(PAD.l, hY0, plotW, hStrip);
        for (let i=0;i<N;i++) {
          if (!nBins[i]) continue;
          const bx = toX(rtBins[i]);
          const bw = plotW / N - 0.5;
          const bh = (nBins[i] / maxN) * hStrip;
          const severity = med[i]!=null ? Math.min(1, Math.abs(med[i]) / ALERT) : 0;
          const r=Math.round(34+(249-34)*severity), g=Math.round(211+(115-211)*severity), b=Math.round(238+(22-238)*severity);
          ctx.fillStyle = `rgba(${r},${g},${b},0.55)`;
          ctx.fillRect(bx - bw/2, hY0 + hStrip - bh, bw, bh);
        }
        // histogram label
        ctx.fillStyle='#334155'; ctx.font='7.5px system-ui'; ctx.textAlign='left';
        ctx.fillText('Precursors/bin', PAD.l+2, hY0+9);

        // ── Axes ─────────────────────────────────────────────────────────────────
        ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(PAD.l, plotY0); ctx.lineTo(PAD.l, plotY0+plotH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(PAD.l, plotY0+plotH); ctx.lineTo(W-PAD.r, plotY0+plotH); ctx.stroke();

        ctx.fillStyle='#64748b'; ctx.font='9.5px system-ui'; ctx.textAlign='center';
        ctx.fillText('Retention Time (min)', PAD.l + plotW/2, plotY0+plotH+26);
        ctx.save(); ctx.translate(14, plotY0+plotH/2); ctx.rotate(-Math.PI/2);
        ctx.fillText('Δ 1/K₀  Vs/cm²', 0, 0); ctx.restore();
        ctx.save(); ctx.translate(W-12, plotY0+plotH/2); ctx.rotate(Math.PI/2);
        ctx.fillStyle='#334155'; ctx.font='9px system-ui'; ctx.textAlign='center';
        ctx.fillText('ΔP estimate', 0, 0); ctx.restore();

        // ── Title & stability stats ───────────────────────────────────────────────
        ctx.fillStyle='#94a3b8'; ctx.font='bold 9.5px system-ui'; ctx.textAlign='left';
        ctx.fillText('Intra-run Ion Mobility Drift  ·  binned by retention time', PAD.l, 18);

        // Slope badge
        if (slope != null) {
          const slopeMbarMin = (slope / 0.025 * 15);
          const sCol = Math.abs(slope) < 0.0002 ? '#22c55e' : Math.abs(slope) < 0.0005 ? '#f97316' : '#ef4444';
          ctx.fillStyle = sCol + '22';
          ctx.beginPath(); ctx.roundRect(W-PAD.r-160, 6, 155, 20, 4); ctx.fill();
          ctx.fillStyle = sCol; ctx.font = '8px monospace'; ctx.textAlign = 'right';
          ctx.fillText(`Slope: ${slope>=0?'+':''}${slope.toFixed(6)} Vs/cm²/min`, W-PAD.r-5, 19);
        }

        // Charge legend
        ['2','3','4'].forEach((z, i) => {
          const col = CHARGE_COLS[z];
          const lx = PAD.l + 4 + i*62;
          ctx.beginPath(); ctx.moveTo(lx, plotY0-8); ctx.lineTo(lx+18, plotY0-8);
          ctx.strokeStyle=col+'88'; ctx.lineWidth=1.4; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle='#64748b'; ctx.font='8px system-ui'; ctx.textAlign='left';
          ctx.fillText(`z+${z}`, lx+22, plotY0-5);
        });
        ctx.fillStyle='#94a3b8'; ctx.font='8px system-ui';
        const lx3 = PAD.l + 4 + 3*62;
        ctx.beginPath(); ctx.moveTo(lx3, plotY0-8); ctx.lineTo(lx3+18, plotY0-8);
        ctx.strokeStyle='#22d3ee99'; ctx.lineWidth=2; ctx.stroke();
        ctx.fillStyle='#94a3b8'; ctx.textAlign='left';
        ctx.fillText('median', lx3+22, plotY0-5);
      };

      const handleMouseMove = e => {
        const cv = cvRef.current; if (!cv || !data) return;
        const rect = cv.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (cv.width / rect.width);
        const { rt_bins_min: rtBins, run_rt_min: rtMin, run_rt_max: rtMax } = data;
        const PAD_L = 70, PAD_R = 90;
        const plotW = cv.width - PAD_L - PAD_R;
        const fracX = (mx - PAD_L) / plotW;
        if (fracX < 0 || fracX > 1) { setHovBin(null); return; }
        const hovRt = rtMin + fracX * (rtMax - rtMin);
        // Find nearest bin
        let best = null, bestD = Infinity;
        rtBins.forEach((rt, i) => {
          const d = Math.abs(rt - hovRt);
          if (d < bestD) { bestD = d; best = i; }
        });
        setHovBin(best);
      };

      if (!runId) return (
        <div style={{padding:'2rem', textAlign:'center', color:'#64748b', fontSize:'0.85rem'}}>
          Select a timsTOF run above to view intra-run drift
        </div>
      );
      if (loading) return <div style={{padding:'2rem', textAlign:'center', color:'#22d3ee'}}>Loading RT drift data…</div>;
      if (error) return (
        <div style={{padding:'0.75rem', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.3)',
          borderRadius:'0.4rem', color:'#fca5a5', fontSize:'0.78rem'}}>{error}</div>
      );
      if (!data) return null;

      const { drift_slope_vs_per_cm2_per_min: slope, intra_run_range_vs_per_cm2: drange,
              run_rt_max: rtMax, run_rt_min: rtMin, median_delta: med } = data;
      const validMeds = med.filter(v => v != null);
      const overallMed = validMeds.length
        ? validMeds.slice().sort((a,b)=>a-b)[Math.floor(validMeds.length/2)] : null;
      const WARN=0.025, ALERT=0.050;
      const mbarSlope = slope != null ? Math.abs(slope)/0.025*15 : null;
      const slopeLabel = mbarSlope == null ? '—'
        : mbarSlope < 1 ? 'Stable' : mbarSlope < 3 ? 'Slight' : 'Drifting';
      const slopeCol = mbarSlope == null ? '#64748b'
        : mbarSlope < 1 ? '#22c55e' : mbarSlope < 3 ? '#f97316' : '#ef4444';

      return (
        <div>
          <div style={{display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'0.75rem', alignItems:'stretch'}}>
            {[
              {label:'Run duration',     val: `${(rtMax-rtMin).toFixed(1)} min`, col:'#94a3b8'},
              {label:'Overall median Δ', val: overallMed!=null ? (overallMed>=0?'+':'')+overallMed.toFixed(4)+' Vs/cm²' : '—',
               col: overallMed==null?'#64748b': Math.abs(overallMed)>ALERT?'#ef4444': Math.abs(overallMed)>WARN?'#f97316':'#22c55e'},
              {label:'Intra-run range',  val: drange!=null ? drange.toFixed(4)+' Vs/cm²' : '—',
               col: drange==null?'#64748b': drange>WARN?'#f97316':'#22c55e'},
              {label:'Drift rate',       val: slope!=null ? (slope>=0?'+':'')+slope.toFixed(6)+' Vs/cm²/min' : '—', col: slopeCol},
              {label:'Drift character',  val: slopeLabel, col: slopeCol},
              {label:'Est. ΔP rate',     val: mbarSlope!=null ? `~${mbarSlope.toFixed(1)} mbar/min` : '—', col: slopeCol},
            ].map(s => (
              <div key={s.label} style={{background:'rgba(0,0,0,0.45)', border:`1px solid ${s.col}22`,
                borderRadius:'0.4rem', padding:'0.45rem 0.65rem', textAlign:'center', flex:'1 1 120px'}}>
                <div style={{fontSize:'0.92rem', fontWeight:800, color:s.col, lineHeight:1.1}}>{s.val}</div>
                <div style={{fontSize:'0.67rem', color:'#64748b', marginTop:'0.15rem'}}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{fontSize:'0.72rem', color:'#64748b', lineHeight:1.6, marginBottom:'0.6rem',
            padding:'0.4rem 0.7rem', background:'rgba(34,211,238,0.04)', borderRadius:'0.35rem',
            borderLeft:'3px solid rgba(34,211,238,0.3)'}}>
            <strong style={{color:'#22d3ee'}}>How to read this:</strong>{' '}
            Each point = median Δ1/K₀ (observed − predicted ion mobility) for all precursors in a ~1-min RT bin.
            The shaded band = 5th–95th percentile spread.
            Dashed lines = z+2/z+3/z+4 charge-state medians — should all track together if drift is pressure-driven.
            The animated bar on the right estimates the barometric pressure change from the calibration baseline.{' '}
            <strong style={{color:'#DAAA00'}}>A flat line = stable instrument.
            A slope = your instrument breathing through a pressure front.</strong>
          </div>

          <canvas ref={cvRef} width={900} height={440}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHovBin(null)}
            style={{width:'100%', display:'block', borderRadius:'0.5rem',
              boxShadow:'0 0 24px rgba(34,211,238,0.08)', cursor:'crosshair'}}/>
        </div>
      );
    }


    // ── Calibrant QC Panel ───────────────────────────────────────────────────────
    // Reads Bruker's own reference 1/K₀ values from analysis.tdf and compares
    // to what the instrument actually measured post-calibration.
    // Focuses on the 3 CCS compendium anchor ions: m/z 622, 922, 1221.
    function MobCalCalibrant({ runId }) {
      const [data, setData] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState('');
      const [showAll, setShowAll] = React.useState(false);

      React.useEffect(() => {
        if (!runId) return;
        setLoading(true); setError(''); setData(null);
        fetch(API + `/api/runs/${runId}/calibrant-drift`)
          .then(r => r.json())
          .then(d => { if (d.error) setError(d.message); else setData(d); })
          .catch(e => setError('Network error: ' + e.message))
          .finally(() => setLoading(false));
      }, [runId]);

      if (!runId) return (
        <div style={{padding:'2rem', textAlign:'center', color:'#64748b', fontSize:'0.85rem'}}>
          Select a timsTOF run above to inspect its Bruker calibrant QC
        </div>
      );
      if (loading) return <div style={{padding:'2rem', textAlign:'center', color:'#22d3ee'}}>Reading calibration from TDF…</div>;
      if (error) return (
        <div style={{padding:'0.75rem', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.3)',
          borderRadius:'0.4rem', color:'#fca5a5', fontSize:'0.78rem'}}>{error}</div>
      );
      if (!data) return null;

      const WARN = 0.025, ALERT = 0.050;
      const allCpds = data.compounds || [];

      // Separate the 3 target anchors from the rest
      const TARGET_NOMINAL = [622, 922, 1221];
      const targets = TARGET_NOMINAL.map(nom => allCpds.find(c => c.is_target && c.ref_mz != null && Math.abs(c.ref_mz - nom) <= 5) || null);
      const otherCpds = allCpds.filter(c => !c.is_target);

      // Status based on the 3 targets only (or all if targets missing)
      const statusCpds = targets.filter(Boolean).length > 0 ? targets.filter(Boolean) : allCpds;
      const maxDrift = statusCpds.length ? Math.max(...statusCpds.map(c => Math.abs(c.drift || 0))) : 0;
      const calStatus = maxDrift < WARN ? 'PASS' : maxDrift < ALERT ? 'WARN' : 'ALERT';
      const calCol = calStatus === 'PASS' ? '#22c55e' : calStatus === 'WARN' ? '#f97316' : '#ef4444';
      const foundCount = targets.filter(Boolean).length;

      return (
        <div>
          {/* Summary header */}
          <div style={{display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'0.85rem', alignItems:'stretch'}}>
            {[
              {label:'Calibrant list',   val: data.ref_list || 'Agilent ESI-L', col:'#94a3b8'},
              {label:'Calibration time', val: data.calib_datetime ? new Date(data.calib_datetime).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—', col:'#94a3b8'},
              {label:'Std Dev (Bruker)', val: data.std_pct != null ? (data.std_pct * 100).toFixed(4) + ' %' : '—', col:'#22d3ee'},
              {label:'Anchors found',    val: `${foundCount} / 3`, col: foundCount === 3 ? '#22c55e' : '#f97316'},
              {label:'Max |Δ| anchors',  val: maxDrift.toFixed(5) + ' Vs/cm²', col: calCol},
              {label:'Status',           val: calStatus, col: calCol},
            ].map(s => (
              <div key={s.label} style={{background:'rgba(0,0,0,0.45)', border:`1px solid ${s.col}22`,
                borderRadius:'0.4rem', padding:'0.45rem 0.7rem', textAlign:'center', flex:'1 1 110px'}}>
                <div style={{fontSize:'0.95rem', fontWeight:800, color:s.col, lineHeight:1.1}}>{s.val}</div>
                <div style={{fontSize:'0.67rem', color:'#64748b', marginTop:'0.15rem'}}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* 3 target anchor cards */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.55rem', marginBottom:'0.85rem'}}>
            {targets.map((c, ti) => {
              if (!c) return null;
              const d = c.drift || 0;
              const dCol = Math.abs(d) > ALERT ? '#ef4444' : Math.abs(d) > WARN ? '#f97316' : '#22c55e';
              const maxAbs = Math.max(ALERT * 1.5, Math.abs(d));
              const barPct = Math.min(50, Math.abs(d) / maxAbs * 50);
              return (
                <div key={ti} style={{background:'rgba(0,0,0,0.5)', border:`1.5px solid ${dCol}44`,
                  borderRadius:'0.5rem', padding:'0.7rem 0.85rem'}}>
                  {/* Title row */}
                  <div style={{display:'flex', alignItems:'baseline', gap:'0.4rem', marginBottom:'0.45rem'}}>
                    <span style={{fontSize:'1.15rem', fontWeight:900, color:'#f0e8ff', fontVariantNumeric:'tabular-nums'}}>
                      m/z {Math.round(c.ref_mz)}
                    </span>
                    <span style={{fontSize:'0.68rem', color:'#64748b'}}>({c.ref_mz?.toFixed(3)})</span>
                  </div>
                  {/* Metrics */}
                  {[
                    {lbl:'Ref 1/K₀',   val: c.ref_k0?.toFixed(6),  col:'#22d3ee'},
                    {lbl:'Meas 1/K₀',  val: c.meas_k0?.toFixed(6) || '—', col:'#f0e8ff'},
                    {lbl:'Pre-cal 1/K₀', val: c.prev_k0?.toFixed(6) || '—', col:'#475569'},
                    {lbl:'Intensity',   val: c.intensity != null ? c.intensity.toLocaleString() : '—', col:'#64748b'},
                  ].map(m => (
                    <div key={m.lbl} style={{display:'flex', justifyContent:'space-between',
                      fontSize:'0.72rem', marginBottom:'0.15rem'}}>
                      <span style={{color:'#64748b'}}>{m.lbl}</span>
                      <span style={{fontFamily:'monospace', color:m.col}}>{m.val}</span>
                    </div>
                  ))}
                  {/* Drift value */}
                  <div style={{marginTop:'0.45rem', paddingTop:'0.4rem', borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'0.3rem'}}>
                      <span style={{fontSize:'0.72rem', color:'#94a3b8'}}>Δ (meas − ref)</span>
                      <span style={{fontFamily:'monospace', fontWeight:700, fontSize:'0.82rem', color:dCol}}>
                        {d >= 0 ? '+' : ''}{d.toFixed(6)}
                      </span>
                    </div>
                    {/* Drift bar */}
                    <div style={{height:'10px', background:'rgba(255,255,255,0.05)', borderRadius:'2px', position:'relative'}}>
                      <div style={{position:'absolute', left:'50%', top:0, bottom:0, width:'1px', background:'rgba(34,211,238,0.4)'}}/>
                      <div style={{position:'absolute',
                        left: d < 0 ? (50 - barPct).toFixed(1) + '%' : '50%',
                        width: barPct.toFixed(1) + '%',
                        top:'1px', bottom:'1px',
                        background: dCol + 'cc', borderRadius:'2px'}}/>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.67rem', color:'#475569', marginTop:'0.2rem'}}>
                      <span>{c.pct_dev != null ? c.pct_dev.toFixed(4) + ' %' : ''}</span>
                      <span style={{color: dCol, fontWeight:600}}>
                        {Math.abs(d) > ALERT ? '⚠ ALERT' : Math.abs(d) > WARN ? '⚑ WARN' : '✓ PASS'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Other compounds (collapsed by default) */}
          {otherCpds.length > 0 && (
            <div style={{marginBottom:'0.75rem'}}>
              <button onClick={() => setShowAll(v => !v)}
                style={{background:'none', border:'none', color:'#64748b', cursor:'pointer',
                  fontSize:'0.73rem', padding:'0.2rem 0', fontWeight:600}}>
                {showAll ? '▾' : '▸'} {otherCpds.length} other calibrant {otherCpds.length === 1 ? 'compound' : 'compounds'} in TDF
              </button>
              {showAll && (
                <div style={{overflowX:'auto', marginTop:'0.4rem'}}>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.76rem'}}>
                    <thead>
                      <tr style={{borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
                        {['Compound','Ref m/z','Ref 1/K₀','Meas 1/K₀','Δ','% Dev'].map(h => (
                          <th key={h} style={{padding:'0.3rem 0.5rem', textAlign:'left',
                            color:'#64748b', fontWeight:600, fontSize:'0.7rem', whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {otherCpds.map((c, i) => {
                        const d = c.drift || 0;
                        const dCol = Math.abs(d) > ALERT ? '#ef4444' : Math.abs(d) > WARN ? '#f97316' : '#4ade80';
                        return (
                          <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                            <td style={{padding:'0.3rem 0.5rem', color:'#94a3b8', fontFamily:'monospace', fontSize:'0.7rem'}}>{c.compound}</td>
                            <td style={{padding:'0.3rem 0.5rem', color:'#64748b'}}>{c.ref_mz?.toFixed(3) ?? '—'}</td>
                            <td style={{padding:'0.3rem 0.5rem', color:'#22d3ee', fontFamily:'monospace'}}>{c.ref_k0?.toFixed(6)}</td>
                            <td style={{padding:'0.3rem 0.5rem', color:'#e2e8f0', fontFamily:'monospace'}}>{c.meas_k0?.toFixed(6) ?? '—'}</td>
                            <td style={{padding:'0.3rem 0.5rem', fontFamily:'monospace', fontWeight:600, color:dCol}}>
                              {d >= 0 ? '+' : ''}{d.toFixed(6)}
                            </td>
                            <td style={{padding:'0.3rem 0.5rem', color:dCol, fontSize:'0.7rem'}}>
                              {c.pct_dev?.toFixed(4) ?? '—'} %
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Footer note */}
          <div style={{fontSize:'0.7rem', color:'#475569', lineHeight:1.5}}>
            Δ = MobilitiesCorrectedCalibration − ReferencePeakMobilities (Bruker TDF) ·{' '}
            <span style={{color:'#f97316'}}>warn ≥ 0.025</span> ·{' '}
            <span style={{color:'#ef4444'}}>alert ≥ 0.050 Vs/cm²</span> ·{' '}
            independent of DIA-NN — reflects hardware calibration state at acquisition time
          </div>
        </div>
      );
    }

    // ── Method Config Panel ──────────────────────────────────────────────────────
    // Reads microTOFQImpacTemAcquisition.method from the .d/.m folder.
    // Shows IMS calibration, TOF calibration, TOF hardware, source, and general info.
    function MobCalMethod({ runId }) {
      const [data, setData]     = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [error, setError]   = React.useState('');

      React.useEffect(() => {
        if (!runId) { setData(null); setError(''); return; }
        setLoading(true); setError(''); setData(null);
        fetch(API + `/api/runs/${runId}/method-config`)
          .then(r => r.json())
          .then(d => { if (d.error) setError(d.message || d.error); else setData(d); })
          .catch(e => setError('Network error: ' + e.message))
          .finally(() => setLoading(false));
      }, [runId]);

      if (!runId) return (
        <div style={{padding:'2rem', textAlign:'center', color:'#64748b', fontSize:'0.85rem'}}>
          Select a timsTOF run above to read its acquisition method
        </div>
      );
      if (loading) return <div style={{padding:'2rem', textAlign:'center', color:'#22d3ee'}}>Reading .m method file…</div>;
      if (error) return (
        <div style={{padding:'0.75rem', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.3)',
          borderRadius:'0.4rem', color:'#fca5a5', fontSize:'0.78rem'}}>{error}</div>
      );
      if (!data) return null;

      const { general: g, ims_calib: ims, tof_calib: tof, tof_hw: hw, source: src, acquisition: acq } = data;

      const fmtDate = iso => {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
        catch { return iso; }
      };
      const fmtF = (v, dp=4) => v != null ? Number(v).toFixed(dp) : '—';
      const scoreCol = s => s == null ? '#64748b' : s >= 0.99 ? '#22c55e' : s >= 0.95 ? '#f97316' : '#ef4444';

      // Reusable row renderer
      const KV = ({label, val, col, mono=false}) => (
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline',
          padding:'0.25rem 0', borderBottom:'1px solid rgba(255,255,255,0.04)', gap:'0.5rem'}}>
          <span style={{fontSize:'0.72rem', color:'#64748b', flexShrink:0}}>{label}</span>
          <span style={{fontSize:'0.78rem', color: col || '#e2e8f0', fontFamily: mono ? 'monospace' : 'inherit',
            textAlign:'right', wordBreak:'break-all'}}>{val ?? '—'}</span>
        </div>
      );

      const Section = ({title, col, children}) => (
        <div style={{background:'rgba(0,0,0,0.45)', border:`1px solid ${col}22`,
          borderRadius:'0.5rem', padding:'0.65rem 0.8rem'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color: col, letterSpacing:'0.06em',
            textTransform:'uppercase', marginBottom:'0.45rem'}}>{title}</div>
          {children}
        </div>
      );

      return (
        <div>
          {/* General header */}
          <div style={{display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'0.85rem', alignItems:'stretch'}}>
            {[
              {label:'Model',       val: g.model,           col:'#f0e8ff'},
              {label:'Host',        val: g.hostname,         col:'#94a3b8'},
              {label:'Author',      val: g.author,           col:'#94a3b8'},
              {label:'timsControl', val: g.timstof_version,  col:'#22d3ee'},
              {label:'Created',     val: fmtDate(g.created), col:'#64748b'},
            ].map(s => (
              <div key={s.label} style={{background:'rgba(0,0,0,0.45)', border:'1px solid rgba(255,255,255,0.06)',
                borderRadius:'0.4rem', padding:'0.4rem 0.65rem', textAlign:'center', flex:'1 1 100px'}}>
                <div style={{fontSize:'0.88rem', fontWeight:700, color:s.col, lineHeight:1.2}}>{s.val || '—'}</div>
                <div style={{fontSize:'0.65rem', color:'#475569', marginTop:'0.1rem'}}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'0.6rem'}}>

            {/* IMS Calibration */}
            <Section title="IMS Calibration" col="#22d3ee">
              <KV label="Date"              val={fmtDate(ims.date)} />
              <KV label="Reference masses"  val={ims.reference_mass_list} col="#ffe600" />
              <KV label="Score"             val={fmtF(ims.score, 6)}  col={scoreCol(ims.score)} mono />
              <KV label="Std dev (1/K₀)"   val={fmtF(ims.std_dev, 6)} col={ims.std_dev != null && ims.std_dev < 0.001 ? '#22c55e' : '#f97316'} mono />
              <KV label="Mobility range"    val={ims.mobility_start != null ? `${fmtF(ims.mobility_start,3)} – ${fmtF(ims.mobility_end,3)} Vs/cm²` : null} />
              <KV label="Ramp velocity"     val={ims.ramp_velocity != null ? fmtF(ims.ramp_velocity,6) + ' Vs/cm²/ms' : null} mono />
              <KV label="Funnel pressure"   val={ims.funnel_pressure != null ? fmtF(ims.funnel_pressure,4) + ' mbar' : null} col="#a5b4fc" />
              <KV label="Pressure comp"     val={ims.pressure_compensation ? `On (factor ${ims.pressure_comp_factor})` : 'Off'} />
              <KV label="Transit time"      val={ims.transit_time != null ? fmtF(ims.transit_time,2) + ' ms' : null} />
              <KV label="Ramp cycles"       val={ims.n_cycles} />
            </Section>

            {/* TOF (mass) calibration */}
            <Section title="TOF Mass Calibration" col="#DAAA00">
              <KV label="Date"             val={fmtDate(tof.date)} />
              <KV label="Reference masses" val={tof.reference_mass_list} col="#ffe600" />
              <KV label="Score"            val={fmtF(tof.score, 6)} col={scoreCol(tof.score)} mono />
              <KV label="Std dev (mDa)"    val={fmtF(tof.std_dev, 6)} col={tof.std_dev != null && tof.std_dev < 0.001 ? '#22c55e' : '#f97316'} mono />
              <KV label="Std dev (ppm)"    val={tof.std_dev_ppm != null ? fmtF(tof.std_dev_ppm, 4) + ' ppm' : null} mono />
              <KV label="Scan range"       val={tof.scan_begin != null ? `${fmtF(tof.scan_begin,1)} – ${fmtF(tof.scan_end,1)} m/z` : null} />
              <KV label="Tof2 C0"          val={fmtF(tof.tof2_c0, 4)} mono />
              <KV label="Tof2 C1"          val={fmtF(tof.tof2_c1, 2)} mono />
              <KV label="Tof2 std dev"     val={fmtF(tof.tof2_std_dev, 6)} mono />
            </Section>

            {/* TOF hardware */}
            <Section title="TOF Hardware" col="#a855f7">
              <KV label="Flight tube"    val={hw.flight_tube_v != null ? hw.flight_tube_v + ' V' : null} mono />
              <KV label="Detector"       val={hw.detector_v != null ? hw.detector_v + ' V' : null} mono />
              <KV label="Pulser lens"    val={hw.pulser_lens_v != null ? fmtF(hw.pulser_lens_v, 2) + ' V' : null} mono />
              <KV label="Reflector"      val={hw.reflector_v != null ? hw.reflector_v + ' V' : null} mono />
              <KV label="Corrector fill" val={hw.corrector_fill != null ? fmtF(hw.corrector_fill, 2) + ' V' : null} mono />
              <KV label="Corrector ext"  val={hw.corrector_extract != null ? fmtF(hw.corrector_extract, 2) + ' V' : null} mono />
              <KV label="Temp sensor 1"  val={hw.temp_1 != null ? fmtF(hw.temp_1, 3) + ' °C' : null} col="#f97316" />
              <KV label="Temp sensor 2"  val={hw.temp_2 != null ? fmtF(hw.temp_2, 3) + ' °C' : null} col="#f97316" />
              <KV label="Temp comp"      val={hw.temp_compensation ? 'On' : 'Off'} />
            </Section>

            {/* Source */}
            <Section title="Source" col="#f97316">
              <KV label="Capillary exit"   val={src.capillary_exit_v != null ? src.capillary_exit_v + ' V' : null} mono />
              <KV label="Capillary V"      val={src.capillary_v != null ? src.capillary_v + ' V' : null} mono />
              <KV label="End plate offset" val={src.end_plate_offset != null ? src.end_plate_offset + ' V' : null} mono />
              <KV label="Dry gas flow"     val={src.dry_gas_flow != null ? fmtF(src.dry_gas_flow, 1) + ' L/min' : null} />
              <KV label="Dry gas temp"     val={src.dry_gas_temp != null ? fmtF(src.dry_gas_temp, 0) + ' °C' : null} />
              <KV label="Nebulizer"        val={src.nebulizer_bar != null ? fmtF(src.nebulizer_bar, 2) + ' bar' : null} />
            </Section>

            {/* Acquisition */}
            <Section title="Acquisition / PASEF" col="#e879f9">
              <KV label="PASEF m/z width"   val={acq.pasef_mz_width != null ? acq.pasef_mz_width + ' Th' : null} />
              <KV label="PASEF m/z overlap" val={acq.pasef_mz_overlap != null ? acq.pasef_mz_overlap + ' Th' : null} />
              <KV label="TOF resolution"    val={acq.tof_resolution != null ? Number(acq.tof_resolution).toLocaleString() : null} />
              <KV label="Collision gas"     val={acq.collision_gas != null ? acq.collision_gas + ' %' : null} />
            </Section>

          </div>

          <div style={{marginTop:'0.6rem', fontSize:'0.68rem', color:'#334155'}}>
            {data.method_file}
          </div>
        </div>
      );
    }

    // ── Main Mobility Calibration Tab ────────────────────────────────────────────
    function MobilityCalibrationTab() {
      const { data: allRuns } = useFetch('/api/runs?limit=500');
      const runs = Array.isArray(allRuns) ? allRuns : [];
      const [selectedRunId, setSelectedRunId] = React.useState('');
      const [calData, setCalData] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState('');
      const [view, setView] = React.useState('calibrant');

      const VIEWS = [
        ['calibrant',  '★ Calibrant QC'],
        ['massdrift',  '◬ Mass Drift'],
        ['rtdrift',   '⚡ RT Drift'],
        ['method',    '⚙ Method'],
        ['scatter',   '◎ Obs vs Pred'],
        ['histogram', '▦ Shift Dist'],
        ['trend',     '∿ Run History'],
        ['guide',     '⚑ Reference'],
      ];

      const load = async (runId) => {
        if (!runId) return;
        setLoading(true); setError(''); setCalData(null);
        try {
          const r = await fetch(API + `/api/runs/${runId}/mobility-calibration?max_points=4000`);
          const d = r.ok ? await r.json() : null;
          if (!d || d.error) {
            setError(d?.message || 'Failed to load calibration data. Run must have a DIA-NN report.parquet with Predicted.IM column (DIA-NN ≥ 1.9).');
          } else {
            setCalData(d);
          }
        } catch (e) {
          setError('Network error: ' + e.message);
        }
        setLoading(false);
      };

      React.useEffect(() => { if (selectedRunId) load(selectedRunId); }, [selectedRunId]);

      const WARN = calData?.thresholds?.warn || 0.025;
      const ALERT = calData?.thresholds?.alert || 0.050;
      const medShift = calData?.stats?.median_shift;
      const shiftOk = medShift != null && Math.abs(medShift) < WARN;
      const shiftWarn = medShift != null && Math.abs(medShift) >= WARN && Math.abs(medShift) < ALERT;
      const shiftAlert = medShift != null && Math.abs(medShift) >= ALERT;

      const estPressureMbar = medShift != null ? Math.round(Math.abs(medShift) / 0.025 * 15) : null;

      // Find timsTOF runs for the selector
      const timsTofRuns = runs.filter(r => r.raw_path && (r.raw_path.endsWith('.d') || r.raw_path.endsWith('.d/')));

      return (
        <div>
          {/* Header */}
          <div className="card" style={{marginBottom:'1rem', background:'linear-gradient(135deg,rgba(14,0,24,0.98),rgba(1,15,35,0.92))', border:'1px solid rgba(34,211,238,0.2)'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'0.5rem'}}>
              <div>
                <h3 style={{marginBottom:'0.25rem', background:'linear-gradient(90deg,#22d3ee,#DAAA00)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>
                  Ion Mobility Calibration QC
                </h3>
                <p style={{color:'#94a3b8', fontSize:'0.76rem', lineHeight:1.5, maxWidth:'680px'}}>
                  Two complementary layers: <span style={{color:'#DAAA00'}}>★ Calibrant QC</span> reads
                  Bruker's reference 1/K₀ values directly from the TDF — no search result needed, measures
                  hardware calibration state at acquisition time. <span style={{color:'#22d3ee'}}>◎ Obs vs Pred</span>{' '}
                  compares DIA-NN measured vs predicted 1/K₀ across peptides, detecting environmental drift.{' '}
                  <span style={{color:'#DAAA00'}}>15 mbar pressure change → ±0.025 Vs/cm²</span> (Müller et al. J. Proteome Res. 2025).
                </p>
              </div>
              <a href="https://pubs.acs.org/doi/10.1021/acs.jproteome.4c00932" target="_blank" rel="noreferrer"
                style={{fontSize:'0.7rem', color:'#22d3ee', whiteSpace:'nowrap', alignSelf:'flex-start'}}>
                📄 Müller et al. JPR 2025
              </a>
            </div>

            {/* Run selector */}
            <div style={{display:'flex', gap:'0.5rem', alignItems:'center', marginTop:'0.75rem', flexWrap:'wrap'}}>
              <select value={selectedRunId} onChange={e => setSelectedRunId(e.target.value)}
                style={{flex:1, maxWidth:'480px', padding:'0.35rem 0.55rem', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'0.35rem', color:'#e2e8f0', fontSize:'0.82rem'}}>
                <option value="">— select a timsTOF run (.d) —</option>
                {timsTofRuns.map(r => <option key={r.id} value={r.id}>{r.run_name}</option>)}
              </select>
              {loading && <span style={{color:'#22d3ee', fontSize:'0.8rem'}}>Computing…</span>}
              {!loading && timsTofRuns.length === 0 && (
                <span style={{color:'#64748b', fontSize:'0.78rem', fontStyle:'italic'}}>No timsTOF (.d) runs found in database.</span>
              )}
            </div>
          </div>

          {/* Stats banner */}
          {calData && (
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:'0.45rem', marginBottom:'1rem'}}>
              {[
                {label:'Median Δ 1/K₀', val: (medShift >= 0 ? '+' : '') + medShift.toFixed(4) + ' Vs/cm²',
                  col: shiftAlert ? '#ef4444' : shiftWarn ? '#f97316' : '#22c55e'},
                {label:'Std deviation', val: '±' + calData.stats.std_shift.toFixed(4), col:'#22d3ee'},
                {label:'5th–95th pct', val: (calData.stats.p05_shift >= 0 ? '+' : '') + calData.stats.p05_shift.toFixed(3) + ' to ' + (calData.stats.p95_shift >= 0 ? '+' : '') + calData.stats.p95_shift.toFixed(3), col:'#94a3b8'},
                {label:'Precursors', val: calData.n_precursors?.toLocaleString(), col:'#94a3b8'},
                {label:'Est. ΔP', val: estPressureMbar != null ? `~${estPressureMbar} mbar` : '—',
                  col: estPressureMbar > 30 ? '#ef4444' : estPressureMbar > 15 ? '#f97316' : '#22c55e'},
                {label:'Status', val: shiftAlert ? '⚠ ALERT' : shiftWarn ? '⚑ WARNING' : '✓ PASS',
                  col: shiftAlert ? '#ef4444' : shiftWarn ? '#f97316' : '#22c55e'},
              ].map(s => (
                <div key={s.label} style={{background:'rgba(0,0,0,0.45)', border:`1px solid ${s.col}22`, borderRadius:'0.4rem', padding:'0.5rem 0.65rem', textAlign:'center'}}>
                  <div style={{fontSize:'1.05rem', fontWeight:800, color:s.col, lineHeight:1.1}}>{s.val}</div>
                  <div style={{fontSize:'0.67rem', color:'#64748b', marginTop:'0.15rem'}}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Alert banner */}
          {calData && (shiftWarn || shiftAlert) && (
            <div style={{padding:'0.55rem 0.9rem', marginBottom:'0.8rem', borderRadius:'0.4rem',
              background: shiftAlert ? 'rgba(239,68,68,0.1)' : 'rgba(249,115,22,0.08)',
              border: `1px solid ${shiftAlert ? 'rgba(239,68,68,0.4)' : 'rgba(249,115,22,0.35)'}`,
              fontSize:'0.78rem', lineHeight:1.6}}>
              <strong style={{color: shiftAlert ? '#ef4444' : '#f97316'}}>
                {shiftAlert ? '⚠ Significant mobility shift detected' : '⚑ Moderate mobility shift detected'}
              </strong>
              <span style={{color:'#94a3b8', marginLeft:'0.5rem'}}>
                Median Δ = {(medShift >= 0 ? '+' : '') + medShift.toFixed(4)} Vs/cm²
                {estPressureMbar != null && ` · estimated air pressure change: ~${estPressureMbar} mbar`}.{' '}
                {shiftAlert
                  ? 'At this level, diaPASEF isolation windows may miss peptides outside the calibrated mobility range, reducing identification rates. Consider recalibrating the TIMS analyzer or checking environmental conditions.'
                  : 'Mild shift — most identifications unaffected, but longitudinal comparison may be impacted. Monitor over consecutive runs.'}
              </span>
            </div>
          )}

          {error && (
            <div style={{padding:'0.6rem 0.9rem', marginBottom:'0.8rem', borderRadius:'0.4rem',
              background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.3)',
              color:'#fca5a5', fontSize:'0.78rem'}}>{error}</div>
          )}

          {/* Sub-view selector */}
          <div style={{display:'flex', gap:'0.35rem', marginBottom:'0.75rem', flexWrap:'wrap'}}>
            {VIEWS.map(([k, lbl]) => (
              <button key={k} onClick={() => setView(k)}
                style={{padding:'0.3rem 0.75rem', borderRadius:'0.35rem', border:'none', cursor:'pointer',
                  fontWeight:600, fontSize:'0.8rem',
                  background: view === k ? 'var(--accent)' : 'var(--surface)',
                  color: view === k ? 'var(--bg)' : 'var(--muted)'}}>
                {lbl}
              </button>
            ))}
            <span style={{marginLeft:'auto', alignSelf:'center', fontSize:'0.72rem', color:'#64748b', fontStyle:'italic'}}>
              Warn ≥ 0.025 · Alert ≥ 0.050 Vs/cm²
            </span>
          </div>

          {/* Calibrant QC — primary, no DIA-NN required */}
          {view === 'calibrant' && (
            <div className="card" style={{padding:'0.75rem', background:'rgba(0,0,0,0.5)'}}>
              <MobCalCalibrant runId={selectedRunId}/>
            </div>
          )}

          {/* Mass Drift — calibration line from 3 anchors, all-ion residual scatter */}
          {view === 'massdrift' && (
            <div className="card" style={{padding:'0.75rem', background:'rgba(0,0,0,0.5)'}}>
              <div style={{fontSize:'0.76rem', color:'#64748b', marginBottom:'0.5rem'}}>
                Δ(1/K₀) residuals vs m/z · linear fit through m/z 622 · 922 · 1221 CCS compendium anchors ·{' '}
                <span style={{color:'#22d3ee'}}>cyan = Δ=0</span> ·{' '}
                <span style={{color:'#f97316'}}>orange = ±0.025 warn</span> ·{' '}
                labelled circles = calibrant ions
              </div>
              <MobCalMassDrift runId={selectedRunId}/>
            </div>
          )}

          {/* Intra-run RT drift */}
          {view === 'rtdrift' && (
            <div className="card" style={{padding:'0.75rem', background:'rgba(0,0,0,0.5)'}}>
              <MobCalRtDrift runId={selectedRunId}/>
            </div>
          )}

          {/* Method config */}
          {view === 'method' && (
            <div className="card" style={{padding:'0.75rem', background:'rgba(0,0,0,0.5)'}}>
              <MobCalMethod runId={selectedRunId}/>
            </div>
          )}

          {/* Scatter */}
          {view === 'scatter' && (
            <div className="card" style={{padding:'0.75rem', background:'rgba(0,0,0,0.5)'}}>
              <div style={{fontSize:'0.76rem', color:'#64748b', marginBottom:'0.4rem'}}>
                Each point = one precursor · x = predicted 1/K₀ · y = observed 1/K₀ ·{' '}
                <span style={{color:'#22d3ee'}}>cyan diagonal = perfect calibration</span> ·{' '}
                <span style={{color:'#DAAA00'}}>gold line = median shift</span> · hover for details
              </div>
              {calData
                ? <MobCalScatter data={calData}/>
                : <div style={{height:'440px', display:'flex', alignItems:'center', justifyContent:'center',
                    color:'#64748b', fontSize:'0.85rem'}}>
                    Select a timsTOF run above to load calibration data
                  </div>}
            </div>
          )}

          {/* Histogram */}
          {view === 'histogram' && (
            <div className="card" style={{padding:'0.75rem', background:'rgba(0,0,0,0.5)'}}>
              <div style={{fontSize:'0.76rem', color:'#64748b', marginBottom:'0.4rem'}}>
                Distribution of Δ 1/K₀ per precursor ·{' '}
                <span style={{color:'#22c55e'}}>green = Δ within ±0.025</span> ·{' '}
                <span style={{color:'#ef4444'}}>red = outside threshold</span> ·{' '}
                <span style={{color:'#DAAA00'}}>gold = median shift</span>
              </div>
              {calData
                ? <MobCalHistogram data={calData}/>
                : <div style={{height:'200px', display:'flex', alignItems:'center', justifyContent:'center', color:'#64748b', fontSize:'0.85rem'}}>
                    Select a timsTOF run first
                  </div>}
            </div>
          )}

          {/* Trend */}
          {view === 'trend' && (
            <div className="card" style={{padding:'0.75rem', background:'rgba(0,0,0,0.5)'}}>
              <div style={{fontSize:'0.76rem', color:'#64748b', marginBottom:'0.4rem'}}>
                Median 1/K₀ shift over time · colored dots = pass/warn/alert ·{' '}
                <span style={{color:'#f97316'}}>orange band = ±0.025 warn</span> ·{' '}
                <span style={{color:'#ef4444'}}>red band = ±0.050 alert</span>
              </div>
              <MobCalTrend runs={runs} currentRunId={selectedRunId}/>
            </div>
          )}

          {/* Reference guide */}
          {view === 'guide' && (
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem'}}>
              <div className="card" style={{borderColor:'rgba(34,211,238,0.25)'}}>
                <div style={{fontWeight:700, color:'#22d3ee', fontSize:'0.82rem', marginBottom:'0.5rem'}}>Mechanism</div>
                <div style={{fontSize:'0.76rem', color:'#94a3b8', lineHeight:1.7}}>
                  The TIMS analyzer separates ions by balancing an electric field against a nitrogen gas flow.
                  The gas density — and therefore the separation — depends on local air pressure. When barometric
                  pressure drops (storm approaching), the TIMS vacuum gets slightly less dense, and 1/K₀ values
                  shift systematically for <em>all</em> ions together.
                  <br/><br/>
                  <strong style={{color:'#e2e8f0'}}>15 mbar change → 0.025 Vs/cm² shift.</strong>{' '}
                  Typical weather systems cause 5–20 mbar swings over days.
                </div>
              </div>
              <div className="card" style={{borderColor:'rgba(218,170,0,0.25)'}}>
                <div style={{fontWeight:700, color:'#DAAA00', fontSize:'0.82rem', marginBottom:'0.5rem'}}>Impact on diaPASEF</div>
                <div style={{fontSize:'0.76rem', color:'#94a3b8', lineHeight:1.7}}>
                  diaPASEF isolation windows are defined in both m/z and 1/K₀ space. A mobility shift
                  moves peptides outside their expected 1/K₀ window, reducing MS2 fragmentation events
                  and decreasing ID rates — even though the peptides are present in the sample.
                  <br/><br/>
                  <strong style={{color:'#e2e8f0'}}>Shifts &gt;0.025 Vs/cm²</strong> begin to meaningfully
                  reduce coverage. Shifts &gt;0.05 can cause &gt;10% ID rate drop at window edges.
                </div>
              </div>
              <div className="card" style={{borderColor:'rgba(34,197,94,0.25)'}}>
                <div style={{fontWeight:700, color:'#22c55e', fontSize:'0.82rem', marginBottom:'0.5rem'}}>Thresholds used here</div>
                <table style={{width:'100%', fontSize:'0.76rem', borderCollapse:'collapse'}}>
                  {[
                    ['|Δ| &lt; 0.025', 'PASS', '#22c55e', '&lt;15 mbar', 'Normal operation'],
                    ['0.025–0.050', 'WARN', '#f97316', '15–30 mbar', 'Monitor; compare to adjacent runs'],
                    ['|Δ| &gt; 0.050', 'ALERT', '#ef4444', '&gt;30 mbar', 'Check weather data; consider recalibration'],
                  ].map(([range, status, col, press, note]) => (
                    <tr key={range} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                      <td style={{padding:'0.25rem 0.4rem', color:'#e2e8f0', fontFamily:'monospace'}} dangerouslySetInnerHTML={{__html:range}}/>
                      <td style={{padding:'0.25rem 0.4rem', color:col, fontWeight:700}}>{status}</td>
                      <td style={{padding:'0.25rem 0.4rem', color:'#64748b'}}>{press}</td>
                      <td style={{padding:'0.25rem 0.4rem', color:'#64748b', fontSize:'0.72rem'}}>{note}</td>
                    </tr>
                  ))}
                </table>
              </div>
              <div className="card" style={{borderColor:'rgba(168,85,247,0.25)'}}>
                <div style={{fontWeight:700, color:'#a855f7', fontSize:'0.82rem', marginBottom:'0.5rem'}}>Interpretation tips</div>
                <div style={{fontSize:'0.76rem', color:'#94a3b8', lineHeight:1.7}}>
                  <strong style={{color:'#e2e8f0'}}>All precursors shift together</strong> — if only a subset shifts,
                  suspect sample contamination or a mixed database issue, not pressure drift.<br/><br/>
                  <strong style={{color:'#e2e8f0'}}>Positive Δ</strong> (observed &gt; predicted) = lower air pressure than when the spectral library was acquired.<br/>
                  <strong style={{color:'#e2e8f0'}}>Negative Δ</strong> = higher pressure than library conditions.<br/><br/>
                  <strong style={{color:'#DAAA00'}}>Trend view</strong> is most powerful: a gradual drift over days
                  tracks a pressure front. A sudden jump suggests instrument intervention (source clean, PM, gas tank change).
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
