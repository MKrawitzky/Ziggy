    // ── Ground Control Mission Banner ─────────────────────────────────────────
    function HealthMissionBanner({ summary }) {
      const canvasRef = useRef(null);
      const phaseRef  = useRef(0);
      const rafRef    = useRef(null);
      const frameRef  = useRef(0);

      useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const W = canvas.offsetWidth || 1040;
        const H = 108;
        canvas.width  = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        const stars = Array.from({length: 90}, () => ({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.random() * 0.9 + 0.2, tw: Math.random() * Math.PI * 2,
        }));

        const blips = Array.from({length: 14}, (_, i) => ({
          x: 22 + i * Math.floor((W - 44) / 14),
          y: H * 0.72 + (Math.random() - 0.5) * 14,
          on: Math.random() > 0.4,
          timer: Math.floor(Math.random() * 80),
        }));

        // Small oscilloscope data for right side
        const wavePoints = Array.from({length: 60}, (_, i) => ({
          phase: i * 0.22, amp: 0.4 + Math.random() * 0.3,
        }));

        function draw() {
          phaseRef.current += 0.018;
          frameRef.current++;
          const ph  = phaseRef.current;
          const frm = frameRef.current;

          ctx.fillStyle = '#020b04';
          ctx.fillRect(0, 0, W, H);

          // Grid
          ctx.strokeStyle = 'rgba(0,255,65,0.055)';
          ctx.lineWidth = 0.5;
          for (let x = 0; x < W; x += 55) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
          for (let y = 0; y < H; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

          // Stars
          stars.forEach(s => {
            s.tw += 0.022;
            const a = 0.15 + 0.12 * Math.sin(s.tw);
            ctx.fillStyle = `rgba(160,255,180,${a})`;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
          });

          // Oscilloscope trace (right side)
          const oscX = W - 220, oscW = 200, oscY = H * 0.3, oscH = H * 0.42;
          ctx.strokeStyle = 'rgba(0,255,65,0.18)'; ctx.lineWidth = 1;
          ctx.strokeRect(oscX - 1, oscY - oscH/2 - 1, oscW + 2, oscH + 2);
          ctx.strokeStyle = 'rgba(0,255,65,0.55)'; ctx.lineWidth = 1.2;
          ctx.beginPath();
          wavePoints.forEach((wp, i) => {
            const x = oscX + (i / (wavePoints.length - 1)) * oscW;
            const y = oscY + Math.sin(wp.phase + ph * 2.5) * wp.amp * oscH * 0.45;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.fillStyle = 'rgba(0,255,65,0.3)'; ctx.font = '7px monospace'; ctx.textAlign = 'left';
          ctx.fillText('TIMS SIGNAL', oscX + 2, oscY - oscH/2 - 4);

          // Title area
          ctx.fillStyle = '#00ff41';
          ctx.font = 'bold 22px monospace';
          ctx.textAlign = 'left';
          ctx.fillText('GROUND CONTROL', 22, H * 0.41);

          ctx.fillStyle = '#f59e0b';
          ctx.font = '10px monospace';
          ctx.fillText('TO MAJOR TOM  ·  INSTRUMENT HEALTH MISSION SYSTEMS MONITOR', 22, H * 0.63);

          // Blinking status indicator
          const pct = summary?.pctPass;
          let stText = 'AWAITING TELEMETRY…', stColor = '#475569';
          if (pct != null) {
            if (pct >= 80)  { stText = 'ALL SYSTEMS NOMINAL';      stColor = '#00ff41'; }
            else if (pct >= 60) { stText = 'CAUTION — CHECK SYSTEMS'; stColor = '#f59e0b'; }
            else                { stText = 'CRITICAL — ANOMALY DETECTED'; stColor = '#ef4444'; }
          }
          const blink = Math.sin(ph * 4.5) > 0;
          ctx.fillStyle = blink ? stColor : stColor + '55';
          ctx.font = 'bold 10px monospace'; ctx.textAlign = 'right';
          ctx.fillText((blink ? '◈ ' : '◇ ') + stText, W - 230, H * 0.43);

          if (summary?.total) {
            ctx.fillStyle = 'rgba(0,255,65,0.5)'; ctx.font = '9px monospace';
            ctx.fillText(`MISSIONS LOGGED: ${summary.total}`, W - 230, H * 0.62);
          }

          // Scrolling telemetry ticker
          ctx.strokeStyle = 'rgba(0,255,65,0.1)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, H - 18); ctx.lineTo(W, H - 18); ctx.stroke();
          const scrollX = W - ((frm * 0.55) % (W + 620));
          ctx.fillStyle = 'rgba(0,255,65,0.3)'; ctx.font = '8px monospace'; ctx.textAlign = 'left';
          ctx.fillText(
            '▶  LEVEY-JENNINGS TELEMETRY  ·  TIMS ION MOBILITY  ·  LC SYSTEM HEALTH  ·  RADAR SIGNAL PROFILE  ·  QC GATE STATUS  ·  ANOMALY DETECTION  ·  CCS DRIFT MONITOR  ·  ',
            scrollX, H - 5
          );

          // Blips
          blips.forEach(blip => {
            blip.timer++;
            if (blip.timer > 55 + Math.random() * 70) { blip.on = !blip.on; blip.timer = 0; }
            if (blip.x < W - 230) {
              ctx.fillStyle = `rgba(0,255,65,${blip.on ? 0.75 : 0.12})`;
              ctx.font = '8px monospace'; ctx.textAlign = 'center';
              ctx.fillText(blip.on ? '◈' : '◇', blip.x, blip.y);
            }
          });

          rafRef.current = requestAnimationFrame(draw);
        }

        draw();
        return () => cancelAnimationFrame(rafRef.current);
      }, [summary?.pctPass, summary?.total]);

      return (
        <div style={{ marginBottom: '1rem' }}>
          <canvas
            ref={canvasRef}
            style={{
              width: '100%', height: '108px', display: 'block',
              borderRadius: '0.5rem',
              border: '1px solid rgba(0,255,65,0.18)',
              boxShadow: '0 0 24px rgba(0,255,65,0.04) inset, 0 0 8px rgba(0,255,65,0.06)',
            }}
          />
        </div>
      );
    }

    function HealthTab({ pinnedRunIds, setPinnedRunIds }) {
      const { data: allRuns, loading } = useFetch('/api/runs?limit=1000');
      const [instrFilter, setInstrFilter] = useState('All');
      const [lcFilter, setLcFilter] = useState('All');
      const hasPins = pinnedRunIds && pinnedRunIds.size > 0;
      const [openMetric, setOpenMetric] = useState(null);

      const radarRef = useRef(null);
      const ljRefs = useRef([null, null, null, null, null, null, null]);
      const mobFwhmRef  = useRef(null);
      const mobChargeRef = useRef(null);
      const [mobStats, setMobStats] = useState(null);
      const [mobRun, setMobRun] = useState(null);

      const instruments = useMemo(() => {
        if (!Array.isArray(allRuns)) return ['All'];
        return ['All', ...new Set(allRuns.map(r => r.instrument).filter(Boolean))];
      }, [allRuns]);

      const lcSystems = useMemo(() => {
        if (!Array.isArray(allRuns)) return ['All'];
        const s = [...new Set(allRuns.map(r => r.lc_system || '').filter(Boolean))];
        return ['All', ...s];
      }, [allRuns]);

      const filteredRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        let r = allRuns;
        if (hasPins) r = r.filter(x => pinnedRunIds.has(String(x.id)));
        if (instrFilter !== 'All') r = r.filter(x => x.instrument === instrFilter);
        if (lcFilter !== 'All') r = r.filter(x => (x.lc_system || '') === lcFilter);
        return [...r].sort((a, b) => (a.run_date || '').localeCompare(b.run_date || ''));
      }, [allRuns, instrFilter, lcFilter, hasPins, pinnedRunIds]);

      // Summary stats for "Your Lab" cards
      const summary = useMemo(() => {
        if (!filteredRuns.length) return null;
        const total = filteredRuns.length;
        const pass = filteredRuns.filter(r => r.gate_result === 'pass').length;
        const warn = filteredRuns.filter(r => r.gate_result === 'warn').length;
        const fail = filteredRuns.filter(r => r.gate_result === 'fail').length;
        // Unrated = no gate_result stored (processed before thresholds were configured,
        // or thresholds.yml not yet set up). Don't count them against the pass rate.
        const unrated = total - pass - warn - fail;
        const rated = total - unrated;
        const pctPass = rated > 0 ? Math.round(pass / rated * 100) : null;
        const precs = filteredRuns.map(r => r.n_precursors || r.n_psms).filter(v => v > 0);
        const bestPrec = precs.length ? Math.max(...precs) : null;
        const meanPrec = precs.length ? Math.round(precs.reduce((a, b) => a + b, 0) / precs.length) : null;
        const lastRun = filteredRuns[filteredRuns.length - 1];
        return { total, pass, warn, fail, unrated, rated, pctPass, bestPrec, meanPrec, lastRun };
      }, [filteredRuns]);

      // Compute Levey-Jennings statistics
      function ljStats(vals) {
        const valid = vals.filter(v => v !== null && v !== undefined && !isNaN(Number(v))).map(Number);
        if (valid.length < 2) return null;
        const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
        const sd = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length);
        return { mean, sd, n: valid.length };
      }

      // Radar chart
      useEffect(() => {
        if (!radarRef.current || filteredRuns.length < 2) return;
        const all = filteredRuns;
        const recent = all.slice(-30);
        // Compute mean of recent vs all-time for each metric
        function pctScore(key, higher) {
          const allVals = all.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(Number(v))).map(Number);
          if (!allVals.length) return 50;
          const recentVals = recent.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(Number(v))).map(Number);
          if (!recentVals.length) return 50;
          const recentMean = recentVals.reduce((a, b) => a + b, 0) / recentVals.length;
          const sortedAll = [...allVals].sort((a, b) => a - b);
          let rank = sortedAll.filter(v => higher ? v <= recentMean : v >= recentMean).length;
          return Math.round(rank / sortedAll.length * 100);
        }
        const labels = HEALTH_METRICS.map(m => m.label);
        const scores = HEALTH_METRICS.map(m => pctScore(m.key, m.higher));
        const theta = [...labels, labels[0]];
        const r = [...scores, scores[0]];
        Plotly.react(radarRef.current, [{
          type: 'scatterpolar', r, theta, fill: 'toself', mode: 'lines+markers',
          fillcolor: 'rgba(218,170,0,0.18)', line: { color: '#DAAA00', width: 2.5 },
          marker: { color: '#DAAA00', size: 6 }, name: 'Your Lab (recent avg)',
        }], {
          polar: {
            radialaxis: { range: [0, 100], tickvals: [25, 50, 75, 100],
              tickfont: { color: '#a0b4cc', size: 9 }, gridcolor: '#1e3a5f' },
            angularaxis: { tickfont: { color: '#e2e8f0', size: 11 }, gridcolor: '#1e3a5f' },
            bgcolor: 'rgba(2,40,81,0.6)',
          },
          paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          margin: { l: 70, r: 70, t: 30, b: 30 }, showlegend: false,
          annotations: [{ text: 'Percentile within local history', x: 0.5, y: -0.12, xref: 'paper', yref: 'paper', showarrow: false, font: { color: '#a0b4cc', size: 10 } }],
        }, { responsive: true, displayModeBar: false });
        return () => { if (radarRef.current && window.Plotly) window.Plotly.purge(radarRef.current); };
      }, [filteredRuns]);

      // Levey-Jennings charts
      useEffect(() => {
        if (filteredRuns.length < 2) return;
        HEALTH_METRICS.forEach((m, i) => {
          const el = ljRefs.current[i];
          if (!el) return;
          const rawVals = filteredRuns.map(r => {
            const v = r[m.key] ?? (m.altKey ? r[m.altKey] : null);
            return (v !== null && v !== undefined && !isNaN(Number(v))) ? Number(v) : null;
          });
          const dates = filteredRuns.map(r => (r.run_date || '').substring(0, 10));
          const stats = ljStats(rawVals);
          if (!stats) { Plotly.purge(el); return; }
          const { mean, sd } = stats;
          const colors = rawVals.map(v => {
            if (v === null) return '#4a5568';
            const z = Math.abs((m.higher ? v - mean : mean - v)) / (sd || 1);
            return z > 3 ? '#ef4444' : z > 2 ? '#eab308' : '#22c55e';
          });
          const shapes = [
            { type:'rect', xref:'paper', x0:0, x1:1, y0:mean-sd,   y1:mean+sd,   fillcolor:'rgba(34,197,94,0.08)',  line:{width:0} },
            { type:'rect', xref:'paper', x0:0, x1:1, y0:mean-2*sd, y1:mean+2*sd, fillcolor:'rgba(234,179,8,0.06)',  line:{width:0} },
            { type:'rect', xref:'paper', x0:0, x1:1, y0:mean-3*sd, y1:mean+3*sd, fillcolor:'rgba(239,68,68,0.04)',  line:{width:0} },
            { type:'line', xref:'paper', x0:0, x1:1, y0:mean, y1:mean, line:{color:'rgba(34,197,94,0.7)',width:1.5,dash:'dash'} },
            { type:'line', xref:'paper', x0:0, x1:1, y0:mean+2*sd, y1:mean+2*sd, line:{color:'rgba(234,179,8,0.5)',width:1,dash:'dot'} },
            { type:'line', xref:'paper', x0:0, x1:1, y0:mean-2*sd, y1:mean-2*sd, line:{color:'rgba(234,179,8,0.5)',width:1,dash:'dot'} },
          ];
          Plotly.react(el, [{
            type:'scatter', mode:'lines+markers',
            x: dates, y: rawVals,
            marker: { color: colors, size: 6 },
            line: { color:'rgba(160,180,204,0.3)', width:1 },
            text: filteredRuns.map(r => r.run_name || r.id),
            hovertemplate: `<b>%{text}</b><br>${m.label}: %{y:.3g}${m.unit ? ' ' + m.unit : ''}<extra></extra>`,
          }], {
            paper_bgcolor:'transparent', plot_bgcolor:'rgba(2,40,81,0.25)',
            shapes,
            xaxis: { tickfont:{color:'#a0b4cc',size:8}, gridcolor:'#1e3a5f', tickangle:-40, showgrid:true },
            yaxis: { tickfont:{color:'#a0b4cc',size:9}, gridcolor:'#1e3a5f', title:{text:m.unit,font:{color:'#a0b4cc',size:9}}, showgrid:true },
            margin: { l:52, r:12, t:10, b:55 },
            showlegend: false,
          }, { responsive:true, displayModeBar:false });
        });
        return () => { ljRefs.current.forEach(el => { if (el && window.Plotly) window.Plotly.purge(el); }); };
      }, [filteredRuns]);

      // Ion mobility fingerprint — fetch stats for most recent .d run in filteredRuns
      useEffect(() => {
        const dRun = [...filteredRuns].reverse().find(r => r.raw_path && r.raw_path.endsWith('.d'));
        if (!dRun) { setMobStats(null); setMobRun(null); return; }
        if (mobRun && mobRun.id === dRun.id) return;
        setMobRun(dRun);
        const ac = new AbortController();
        fetch(API + `/api/runs/${dRun.id}/mobility-stats`, { signal: ac.signal })
          .then(r => r.ok ? r.json() : {})
          .then(d => setMobStats(d && Object.keys(d).length ? d : null))
          .catch(e => { if (e.name !== 'AbortError') setMobStats(null); });
        return () => ac.abort();
      }, [filteredRuns]);

      // Render mobility FWHM histogram
      useEffect(() => {
        const el = mobFwhmRef.current;
        if (!el || !window.Plotly) return;
        const hist = mobStats?.fwhm_hist;
        if (!hist || !hist.edges || !hist.counts) { window.Plotly.purge(el); return; }
        const edges = hist.edges;
        const x = edges.slice(0, -1).map((e, i) => (e + edges[i + 1]) / 2);
        window.Plotly.react(el, [{
          type: 'bar', x, y: hist.counts,
          marker: { color: x.map(v => v < hist.median_fwhm * 1.5 ? '#22d3ee' : '#ef4444'), opacity: 0.85 },
          hovertemplate: `%{x:.3f} ${hist.label || 'FWHM'}<br>%{y} ions<extra></extra>`,
        }], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'rgba(2,40,81,0.25)',
          xaxis: { title: { text: hist.label || 'FWHM', font: { color: '#a0b4cc', size: 10 } }, tickfont: { color: '#a0b4cc', size: 9 }, gridcolor: '#1e3a5f' },
          yaxis: { title: { text: 'count', font: { color: '#a0b4cc', size: 9 } }, tickfont: { color: '#a0b4cc', size: 9 }, gridcolor: '#1e3a5f' },
          margin: { l: 48, r: 12, t: 10, b: 44 },
          shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: hist.median_fwhm, x1: hist.median_fwhm, y0: 0, y1: 1, line: { color: '#DAAA00', width: 1.5, dash: 'dash' } }],
          annotations: [{ x: hist.median_fwhm, y: 0.97, xref: 'x', yref: 'paper', text: `med ${hist.median_fwhm?.toFixed ? hist.median_fwhm.toFixed(2) : hist.median_fwhm}`, showarrow: false, font: { color: '#DAAA00', size: 9 }, xanchor: 'left' }],
          showlegend: false,
        }, { responsive: true, displayModeBar: false });
      }, [mobStats]);

      // Render charge distribution horizontal bar
      useEffect(() => {
        const el = mobChargeRef.current;
        if (!el || !window.Plotly) return;
        const cd = mobStats?.charge_dist;
        if (!cd || !cd.charges || !cd.fractions) { window.Plotly.purge(el); return; }
        const CHARGE_COLORS = { 1: '#2dd4bf', 2: '#60a5fa', 3: '#22c55e', 4: '#f97316', 5: '#a855f7', 6: '#ef4444' };
        const traces = cd.charges.map((z, i) => ({
          type: 'bar', orientation: 'h',
          name: `+${z}`,
          x: [cd.fractions[i]],
          y: [''],
          marker: { color: CHARGE_COLORS[z] || '#94a3b8' },
          hovertemplate: `+${z}: ${cd.fractions[i]}% (${cd.counts[i].toLocaleString()})<extra></extra>`,
        }));
        window.Plotly.react(el, traces, {
          barmode: 'stack',
          paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          xaxis: { range: [0, 100], ticksuffix: '%', tickfont: { color: '#a0b4cc', size: 9 }, gridcolor: '#1e3a5f', fixedrange: true },
          yaxis: { showticklabels: false, fixedrange: true },
          margin: { l: 8, r: 12, t: 4, b: 28 },
          legend: { orientation: 'h', y: -0.5, font: { color: '#a0b4cc', size: 9 } },
          showlegend: true,
          height: 70,
        }, { responsive: true, displayModeBar: false });
      }, [mobStats]);

      // LC health per-system
      const lcStats = useMemo(() => {
        if (!Array.isArray(allRuns) || instrFilter === 'All' && lcFilter === 'All') {
          // group by lc_system across all
          const groups = {};
          (allRuns || []).forEach(r => {
            const sys = r.lc_system || 'Unknown';
            if (!groups[sys]) groups[sys] = [];
            groups[sys].push(r);
          });
          return groups;
        }
        return null;
      }, [allRuns, instrFilter, lcFilter]);

      if (loading) return <div className="empty">Loading analytics…</div>;
      if (!Array.isArray(allRuns) || allRuns.length === 0) return (
        <div className="card"><h3>Instrument Health</h3>
          <p style={{color:'var(--muted)',marginTop:'0.5rem'}}>No runs in the database yet. Process some files to see analytics.</p>
        </div>
      );

      return (
        <div>
          {/* Ground Control Mission Banner */}
          <HealthMissionBanner summary={summary} />

          {/* Pin banner */}
          {hasPins && (
            <div style={{display:'flex', gap:'0.5rem', alignItems:'center', padding:'0.4rem 0.75rem', marginBottom:'0.75rem', background:'rgba(218,170,0,0.08)', border:'1px solid rgba(218,170,0,0.3)', borderRadius:'0.45rem', fontSize:'0.83rem', flexWrap:'wrap'}}>
              <span style={{color:'#DAAA00', fontWeight:700}}>Pinned view — showing {pinnedRunIds.size} run{pinnedRunIds.size !== 1 ? 's' : ''} selected in Run History</span>
              <button onClick={() => setPinnedRunIds(new Set())} style={{padding:'0.15rem 0.45rem', fontSize:'0.78rem', background:'transparent', color:'var(--muted)', border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer'}}>Clear pins</button>
            </div>
          )}

          {/* Filter bar */}
          <div className="card" style={{marginBottom:'1rem',display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap',borderColor:'rgba(0,255,65,0.18)'}}>
            <strong style={{color:'#00ff41',fontFamily:'monospace',letterSpacing:'0.08em',fontSize:'0.88rem'}}>◈ MISSION SYSTEMS</strong>
            <label style={{color:'var(--muted)',fontSize:'0.85rem',display:'flex',alignItems:'center',gap:'0.4rem'}}>
              Instrument:
              <select value={instrFilter} onChange={e => setInstrFilter(e.target.value)}
                style={{background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.35rem',padding:'0.25rem 0.5rem',fontSize:'0.85rem'}}>
                {instruments.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
            {lcSystems.length > 1 && (
              <label style={{color:'var(--muted)',fontSize:'0.85rem',display:'flex',alignItems:'center',gap:'0.4rem'}}>
                LC System:
                <select value={lcFilter} onChange={e => setLcFilter(e.target.value)}
                  style={{background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.35rem',padding:'0.25rem 0.5rem',fontSize:'0.85rem'}}>
                  {lcSystems.map(s => <option key={s} value={s}>{s || 'Unknown'}</option>)}
                </select>
              </label>
            )}
            <span style={{marginLeft:'auto',color:'var(--muted)',fontSize:'0.8rem'}}>{filteredRuns.length} runs</span>
          </div>

          {/* Mission Status Board */}
          {summary && (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'0.75rem',marginBottom:'1rem'}}>
              {[
                { label: 'MISSIONS LOGGED', value: summary.total,                    color: '#00ff41' },
                {
                  label: summary.rated > 0 ? `NOMINAL RATE (${summary.rated})` : 'NOMINAL RATE',
                  value: summary.pctPass != null ? `${summary.pctPass}%` : '—',
                  color: summary.pctPass == null ? '#4a5568' : summary.pctPass >= 80 ? '#00ff41' : summary.pctPass >= 60 ? '#f59e0b' : '#ef4444',
                  title: summary.unrated > 0 ? `${summary.unrated} run${summary.unrated !== 1 ? 's' : ''} have no gate result (processed before thresholds were configured)` : null,
                },
                { label: '◈ NOMINAL',    value: summary.pass, color: '#00ff41' },
                { label: '⚠ CAUTION',    value: summary.warn, color: '#f59e0b' },
                { label: '✗ CRITICAL',   value: summary.fail, color: '#ef4444' },
                ...(summary.unrated > 0 ? [{ label: '○ UNRATED', value: summary.unrated, color: '#4a5568', title: 'Runs processed before thresholds.yml was configured. Set up thresholds and re-run to rate these.' }] : []),
                { label: 'PEAK SIGNAL',  value: summary.bestPrec ? summary.bestPrec.toLocaleString() : 'N/A', color: '#DAAA00' },
                { label: 'AVG SIGNAL',   value: summary.meanPrec ? summary.meanPrec.toLocaleString() : 'N/A', color: '#a78bfa' },
                { label: 'LAST CONTACT', value: summary.lastRun ? summary.lastRun.run_date.substring(0,10) : 'N/A', color: '#a0b4cc' },
              ].map(({ label, value, color, title }) => (
                <div key={label} className="card" style={{textAlign:'center',padding:'0.75rem',margin:0,
                  borderColor: color === '#00ff41' ? 'rgba(0,255,65,0.2)' : undefined,
                  background: color === '#00ff41' ? 'rgba(0,255,65,0.025)' : undefined,
                }} title={title || ''}>
                  <div style={{fontSize:'1.4rem',fontWeight:700,color,fontVariantNumeric:'tabular-nums',fontFamily:'monospace'}}>{value}</div>
                  <div style={{fontSize:'0.68rem',color:'var(--muted)',marginTop:'0.25rem',fontFamily:'monospace',letterSpacing:'0.06em'}}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Two-column layout: Radar + LC health */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem'}}>
            {/* Instrument Health Fingerprint */}
            <div className="card" style={{margin:0}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem'}}>
                <h3 style={{margin:0,color:'#00ff41',fontFamily:'monospace',letterSpacing:'0.05em',fontSize:'0.9rem'}}>◈ SIGNAL PROFILE RADAR</h3>
                {filteredRuns.length >= 2 && <ExportBtn plotRef={radarRef} filename={`${instrFilter}-health-fingerprint`} />}
              </div>
              <p style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.5rem'}}>
                Radar shows your recent average vs. all-time local percentile rank (100 = top of your own history).
                Shape indicates relative strengths and weaknesses.
              </p>
              {filteredRuns.length >= 2
                ? <div ref={radarRef} style={{height:'320px'}} />
                : <div className="empty" style={{padding:'2rem'}}>Need ≥2 runs to draw fingerprint</div>
              }
            </div>

            {/* LC / System breakdown */}
            <div className="card" style={{margin:0}}>
              <h3 style={{marginBottom:'0.5rem',color:'#f59e0b',fontFamily:'monospace',letterSpacing:'0.05em',fontSize:'0.9rem'}}>⊛ FLIGHT SYSTEMS ANALYSIS</h3>
              {(() => {
                const groups = {};
                (allRuns || []).forEach(r => {
                  const sys = r.lc_system || 'Custom / Unknown';
                  if (!groups[sys]) groups[sys] = [];
                  groups[sys].push(r);
                });
                const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
                if (!entries.length) return <p style={{color:'var(--muted)',fontSize:'0.85rem'}}>No LC system data detected yet.</p>;
                return (
                  <table style={{marginTop:'0.25rem'}}>
                    <thead>
                      <tr>
                        <th>LC System</th>
                        <th style={{textAlign:'right'}}>Runs</th>
                        <th style={{textAlign:'right'}}>Pass %</th>
                        <th style={{textAlign:'right'}}>Mean Precursors</th>
                        <th style={{textAlign:'right'}}>Mean Peak Cap.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map(([sys, rns]) => {
                        const pPct = Math.round(rns.filter(r => r.gate_result === 'pass').length / rns.length * 100);
                        const precs = rns.map(r => r.n_precursors || r.n_psms).filter(v => v > 0);
                        const meanP = precs.length ? Math.round(precs.reduce((a,b)=>a+b,0)/precs.length) : null;
                        const caps = rns.map(r => r.peak_capacity).filter(v => v > 0);
                        const meanC = caps.length ? Math.round(caps.reduce((a,b)=>a+b,0)/caps.length) : null;
                        return (
                          <tr key={sys}>
                            <td style={{fontWeight:500}}>{sys}</td>
                            <td style={{textAlign:'right'}}>{rns.length}</td>
                            <td style={{textAlign:'right',color: pPct>=80?'#22c55e':pPct>=60?'#eab308':'#ef4444'}}>{pPct}%</td>
                            <td style={{textAlign:'right'}}>{meanP ? meanP.toLocaleString() : '—'}</td>
                            <td style={{textAlign:'right'}}>{meanC ? meanC.toFixed(0) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>

          {/* Levey-Jennings Control Charts */}
          <div className="card" style={{marginBottom:'1rem', borderColor:'rgba(0,255,65,0.12)'}}>
            <h3 style={{marginBottom:'0.25rem',color:'#00ff41',fontFamily:'monospace',letterSpacing:'0.05em',fontSize:'0.9rem'}}>◈ MISSION TELEMETRY — LEVEY-JENNINGS CONTROL FEEDS</h3>
            <p style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.75rem'}}>
              Green band = ±1σ · yellow = ±2σ · red = ±3σ from long-run mean.
              Points outside ±2σ trigger CAUTION · outside ±3σ trigger CRITICAL alert.
            </p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.75rem'}}>
              {HEALTH_METRICS.map((m, i) => {
                return (
                  <div key={m.key}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.2rem'}}>
                      <div style={{fontSize:'0.82rem',fontWeight:600,color:'var(--muted)'}}>
                        {m.label}{m.unit ? ` (${m.unit})` : ''}
                      </div>
                      {filteredRuns.length >= 3 && (
                        <ExportBtn plotRef={{current: ljRefs.current[i]}} filename={`lj-${m.key}`} scale={3} />
                      )}
                    </div>
                    {filteredRuns.length >= 3
                      ? <div ref={el => { ljRefs.current[i] = el; }} style={{height:'160px'}} />
                      : <div className="empty" style={{height:'160px',fontSize:'0.8rem',padding:'2rem 1rem'}}>Need ≥3 runs</div>
                    }
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ion Mobility Fingerprint — timsTOF only */}
          {(mobStats || filteredRuns.some(r => r.raw_path && r.raw_path.endsWith('.d'))) && (
            <div className="card" style={{marginBottom:'1rem'}}>
              <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.5rem',flexWrap:'wrap'}}>
                <h3 style={{margin:0,color:'#22d3ee',fontFamily:'monospace',letterSpacing:'0.05em',fontSize:'0.9rem'}}>∿ 4D TIMS SENSOR ARRAY</h3>
                {mobRun && <span style={{fontSize:'0.78rem',color:'var(--muted)',fontStyle:'italic'}}>{mobRun.run_name}</span>}
                <span style={{marginLeft:'auto',fontSize:'0.75rem',padding:'0.15rem 0.5rem',background:'rgba(34,211,238,0.12)',color:'#22d3ee',borderRadius:'0.3rem',border:'1px solid rgba(34,211,238,0.25)'}}>timsTOF · TIMS</span>
              </div>
              <p style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.75rem'}}>
                Per-run ion mobility health from the most recent .d file. Charge distribution and peak width in the mobility dimension are orthogonal to LC — they reveal TIMS calibration drift and resolution changes before protein counts drop.
              </p>
              {!mobStats ? (
                <div className="empty" style={{padding:'1.5rem'}}>No mobility stats available — ensure a .d run has been processed.</div>
              ) : (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
                  {/* Left: KPI badges + charge bar */}
                  <div>
                    <div style={{display:'flex',gap:'0.6rem',flexWrap:'wrap',marginBottom:'0.6rem'}}>
                      {mobRun?.mobility_cv != null && (
                        <div style={{textAlign:'center',padding:'0.5rem 0.8rem',background:'rgba(34,211,238,0.08)',border:'1px solid rgba(34,211,238,0.25)',borderRadius:'0.4rem'}}>
                          <div style={{fontSize:'1.3rem',fontWeight:700,color:'#22d3ee',fontVariantNumeric:'tabular-nums'}}>{mobRun.mobility_cv.toFixed(1)}%</div>
                          <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>Mobility CV</div>
                        </div>
                      )}
                      {mobStats.fwhm_hist?.median_fwhm != null && (
                        <div style={{textAlign:'center',padding:'0.5rem 0.8rem',background:'rgba(34,211,238,0.06)',border:'1px solid rgba(34,211,238,0.2)',borderRadius:'0.4rem'}}>
                          <div style={{fontSize:'1.3rem',fontWeight:700,color:'#22d3ee',fontVariantNumeric:'tabular-nums'}}>{Number(mobStats.fwhm_hist.median_fwhm).toFixed(2)}</div>
                          <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>Median FWHM{mobStats.fwhm_hist.label ? ` (${mobStats.fwhm_hist.label.replace('RT ','')}` : ''}{mobStats.fwhm_hist.label ? ')' : ''}</div>
                        </div>
                      )}
                      {mobStats.charge_dist?.total != null && (
                        <div style={{textAlign:'center',padding:'0.5rem 0.8rem',background:'rgba(34,211,238,0.06)',border:'1px solid rgba(34,211,238,0.2)',borderRadius:'0.4rem'}}>
                          <div style={{fontSize:'1.3rem',fontWeight:700,color:'#22d3ee',fontVariantNumeric:'tabular-nums'}}>{mobStats.charge_dist.total.toLocaleString()}</div>
                          <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>Total Precursors</div>
                        </div>
                      )}
                    </div>
                    <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.3rem',fontWeight:600}}>Charge State Distribution</div>
                    <div ref={mobChargeRef} style={{height:'70px'}} />
                    {mobStats.charge_dist?.charges && (
                      <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',marginTop:'0.4rem'}}>
                        {mobStats.charge_dist.charges.map((z, i) => {
                          const CHARGE_COLORS = {1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
                          const f = mobStats.charge_dist.fractions[i];
                          // Expected ranges for tryptic bottom-up digests
                          const EXPECTED = {1:[1,8], 2:[50,75], 3:[15,40], 4:[2,12]};
                          const range = EXPECTED[z];
                          const inRange = !range || (f >= range[0] && f <= range[1]);
                          const borderColor = inRange ? '#22c55e' : '#eab308';
                          const tip = range
                            ? (inRange
                                ? `+${z}: within expected tryptic range (${range[0]}–${range[1]}%)`
                                : `+${z}: outside expected range (${range[0]}–${range[1]}%) — may indicate missed cleavages, charge-state bias, or contamination`)
                            : `+${z}: ${f}%`;
                          return (
                            <span key={z} title={tip} style={{fontSize:'0.72rem',padding:'0.1rem 0.4rem',borderRadius:'0.25rem',cursor:'help',
                              background:`${CHARGE_COLORS[z] || '#94a3b8'}18`,
                              color: CHARGE_COLORS[z] || '#94a3b8',
                              border:`1px solid ${borderColor}88`}}>
                              +{z}: {f}% {inRange ? '✓' : '⚠'}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Right: FWHM histogram */}
                  <div>
                    <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.3rem',fontWeight:600}}>
                      Peak Width Distribution · <span style={{color:'#DAAA00',fontWeight:400}}>dashed = median</span>
                    </div>
                    <div ref={mobFwhmRef} style={{height:'180px'}} />
                    <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.3rem',lineHeight:'1.5'}}>
                      Narrower peaks = better TIMS resolving power. Drift rightward over successive runs = TIMS degradation or calibration shift.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Understanding the Metrics — expandable accordion */}
          <div className="card">
            <h3 style={{marginBottom:'0.75rem',color:'#f59e0b',fontFamily:'monospace',letterSpacing:'0.05em',fontSize:'0.9rem'}}>⊛ MISSION BRIEFING — METRIC DECODER</h3>
            <div style={{display:'flex',flexDirection:'column',gap:'0.4rem'}}>
              {METRIC_EXPLAINERS.map(({ key, title, color, body }) => {
                const isOpen = openMetric === key;
                return (
                  <div key={key} style={{border:'1px solid var(--border)',borderRadius:'0.5rem',overflow:'hidden'}}>
                    <div onClick={() => setOpenMetric(isOpen ? null : key)}
                      style={{display:'flex',alignItems:'center',gap:'0.75rem',padding:'0.6rem 0.85rem',cursor:'pointer',
                        background: isOpen ? 'rgba(218,170,0,0.06)' : 'transparent',
                        transition:'background 0.15s',userSelect:'none'}}>
                      <div style={{width:'10px',height:'10px',borderRadius:'50%',background:color,flexShrink:0}} />
                      <span style={{fontWeight:600,fontSize:'0.9rem'}}>{title}</span>
                      <span style={{marginLeft:'auto',color:'var(--muted)',fontSize:'1rem'}}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                    {isOpen && (
                      <div style={{padding:'0.5rem 1rem 0.85rem 2.5rem',color:'var(--muted)',fontSize:'0.85rem',lineHeight:'1.6',borderTop:'1px solid var(--border)'}}>
                        {body}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

