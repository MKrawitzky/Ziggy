
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

    // ── Calibrant QC Panel ───────────────────────────────────────────────────────
    // Reads Bruker's own reference 1/K₀ values from analysis.tdf and compares
    // to what the instrument actually measured post-calibration.
    // No DIA-NN result needed — works on any timsTOF run with a raw .d file.
    function MobCalCalibrant({ runId }) {
      const [data, setData] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState('');

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
      const cpds = data.compounds || [];
      const maxDrift = cpds.length ? Math.max(...cpds.map(c => Math.abs(c.drift || 0))) : 0;
      const calStatus = maxDrift < WARN ? 'PASS' : maxDrift < ALERT ? 'WARN' : 'ALERT';
      const calCol = calStatus === 'PASS' ? '#22c55e' : calStatus === 'WARN' ? '#f97316' : '#ef4444';

      return (
        <div>
          {/* Summary header */}
          <div style={{display:'flex', gap:'0.6rem', flexWrap:'wrap', marginBottom:'0.9rem', alignItems:'stretch'}}>
            {[
              {label:'Calibrant List', val: data.ref_list || 'Tuning Mix', col:'#94a3b8'},
              {label:'Calibration Time', val: data.calib_datetime ? new Date(data.calib_datetime).toLocaleString() : '—', col:'#94a3b8'},
              {label:'Std Dev (Bruker)', val: data.std_pct != null ? (data.std_pct * 100).toFixed(4) + ' %' : '—', col:'#22d3ee'},
              {label:'Max |Δ| vs Ref', val: maxDrift.toFixed(5) + ' Vs/cm²', col: calCol},
              {label:'Status', val: calStatus, col: calCol},
            ].map(s => (
              <div key={s.label} style={{background:'rgba(0,0,0,0.45)', border:`1px solid ${s.col}22`,
                borderRadius:'0.4rem', padding:'0.5rem 0.75rem', textAlign:'center', flex:'1 1 130px'}}>
                <div style={{fontSize:'1rem', fontWeight:800, color:s.col, lineHeight:1.1}}>{s.val}</div>
                <div style={{fontSize:'0.67rem', color:'#64748b', marginTop:'0.15rem'}}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Explainer */}
          <div style={{fontSize:'0.74rem', color:'#64748b', lineHeight:1.6, marginBottom:'0.75rem',
            padding:'0.5rem 0.75rem', background:'rgba(34,211,238,0.04)', borderRadius:'0.35rem',
            borderLeft:'3px solid rgba(34,211,238,0.3)'}}>
            <strong style={{color:'#22d3ee'}}>What this measures:</strong>{' '}
            Bruker stores reference 1/K₀ values for each calibrant compound in the TDF file
            (<code style={{color:'#a5b4fc'}}>ReferencePeakMobilities</code>). These are the
            instrument manufacturer's known values for the Agilent ESI-L tuning mix at STP.
            After calibration, the instrument measures these same compounds
            (<code style={{color:'#a5b4fc'}}>MobilitiesCorrectedCalibration</code>).
            The drift Δ = measured − reference shows how well the calibration succeeded.
            <strong style={{color:'#DAAA00'}}> This is independent of DIA-NN</strong> — it reflects
            the hardware calibration state at the time the run was acquired.
          </div>

          {/* Compound table */}
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.8rem'}}>
              <thead>
                <tr style={{background:'rgba(34,211,238,0.06)', borderBottom:'1px solid rgba(34,211,238,0.15)'}}>
                  {['Compound','Ref m/z','Bruker Ref 1/K₀','Measured 1/K₀','Pre-Cal 1/K₀','Δ (meas − ref)','% Dev','Intensity'].map(h => (
                    <th key={h} style={{padding:'0.4rem 0.6rem', textAlign:'left', color:'#94a3b8',
                      fontWeight:600, fontSize:'0.73rem', whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cpds.map((c, i) => {
                  const d = c.drift || 0;
                  const dCol = Math.abs(d) > ALERT ? '#ef4444' : Math.abs(d) > WARN ? '#f97316' : '#22c55e';
                  return (
                    <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)',
                      background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent'}}>
                      <td style={{padding:'0.4rem 0.6rem', color:'#e2e8f0', fontFamily:'monospace', fontSize:'0.75rem'}}>{c.compound}</td>
                      <td style={{padding:'0.4rem 0.6rem', color:'#94a3b8'}}>{c.ref_mz != null ? c.ref_mz.toFixed(3) : '—'}</td>
                      <td style={{padding:'0.4rem 0.6rem', color:'#22d3ee', fontFamily:'monospace'}}>{c.ref_k0.toFixed(6)}</td>
                      <td style={{padding:'0.4rem 0.6rem', color:'#e2e8f0', fontFamily:'monospace'}}>{c.meas_k0 != null ? c.meas_k0.toFixed(6) : '—'}</td>
                      <td style={{padding:'0.4rem 0.6rem', color:'#475569', fontFamily:'monospace', fontSize:'0.73rem'}}>{c.prev_k0 != null ? c.prev_k0.toFixed(6) : '—'}</td>
                      <td style={{padding:'0.4rem 0.6rem', fontFamily:'monospace', fontWeight:700, color:dCol}}>
                        {d >= 0 ? '+' : ''}{d.toFixed(6)}
                      </td>
                      <td style={{padding:'0.4rem 0.6rem', color:dCol, fontSize:'0.75rem'}}>
                        {c.pct_dev != null ? c.pct_dev.toFixed(4) + ' %' : '—'}
                      </td>
                      <td style={{padding:'0.4rem 0.6rem', color:'#64748b', fontSize:'0.73rem'}}>
                        {c.intensity != null ? c.intensity.toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mini bar chart of drifts */}
          {cpds.length > 0 && (() => {
            const maxAbs = Math.max(WARN * 1.5, ...cpds.map(c => Math.abs(c.drift || 0)));
            return (
              <div style={{marginTop:'0.9rem'}}>
                <div style={{fontSize:'0.73rem', color:'#64748b', marginBottom:'0.4rem'}}>Δ 1/K₀ per calibrant compound vs thresholds</div>
                {cpds.map((c, i) => {
                  const d = c.drift || 0;
                  const pct = Math.min(1, Math.abs(d) / maxAbs);
                  const dCol = Math.abs(d) > ALERT ? '#ef4444' : Math.abs(d) > WARN ? '#f97316' : '#22c55e';
                  return (
                    <div key={i} style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.3rem'}}>
                      <div style={{width:'180px', fontSize:'0.72rem', color:'#94a3b8', textAlign:'right',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{c.compound}</div>
                      <div style={{flex:1, height:'16px', background:'rgba(255,255,255,0.04)',
                        borderRadius:'2px', position:'relative'}}>
                        {/* Zero line */}
                        <div style={{position:'absolute', left:'50%', top:0, bottom:0,
                          width:'1px', background:'rgba(34,211,238,0.3)'}}/>
                        {/* Warn lines */}
                        {[-WARN, WARN].map(w => (
                          <div key={w} style={{position:'absolute',
                            left: (0.5 + w / maxAbs / 2 * 100).toFixed(1) + '%',
                            top:0, bottom:0, width:'1px', background:'rgba(249,115,22,0.35)'}}/>
                        ))}
                        {/* Bar */}
                        <div style={{
                          position:'absolute',
                          left: d < 0 ? ((0.5 - pct / 2) * 100).toFixed(1) + '%' : '50%',
                          width: (pct * 50).toFixed(1) + '%',
                          top:'2px', bottom:'2px',
                          background: dCol + 'cc', borderRadius:'2px'
                        }}/>
                      </div>
                      <div style={{width:'90px', fontSize:'0.72rem', fontFamily:'monospace', color:dCol}}>
                        {d >= 0 ? '+' : ''}{d.toFixed(5)}
                      </div>
                    </div>
                  );
                })}
                <div style={{fontSize:'0.68rem', color:'#475569', marginTop:'0.3rem', textAlign:'center'}}>
                  ± threshold lines: orange = 0.025 Vs/cm² (warn), red = 0.050 Vs/cm² (alert)
                </div>
              </div>
            );
          })()}
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
