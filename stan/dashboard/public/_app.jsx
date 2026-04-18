
    const { useState, useEffect, useCallback, useMemo, useRef } = React;

    const API = '';

    // Mode helpers — Bruker files use diaPASEF/ddaPASEF; older baseline runs
    // may have DIA/DDA.  Always use these helpers so both labels are handled.
    const isDia = (mode) => mode === 'DIA' || mode === 'diaPASEF';
    const isDda = (mode) => mode === 'DDA' || mode === 'ddaPASEF';

    // Shared formatting helpers — module scope so all components can use them
    const EM_DASH = '\u2014';
    const fmtNum  = (n) => (n != null && n > 0) ? n.toLocaleString() : EM_DASH;
    const fmtSig  = (n) => {
      if (n == null || n === 0) return EM_DASH;
      if (n >= 1e12) return (n/1e12).toFixed(1) + 'T';
      if (n >= 1e9)  return (n/1e9).toFixed(1)  + 'B';
      if (n >= 1e6)  return (n/1e6).toFixed(1)  + 'M';
      return n.toFixed(0);
    };
    const fmtSigned  = (n, d=2) => {
      if (n == null) return EM_DASH;
      const sign = n >= 0 ? '+' : '';
      return sign + n.toFixed(d);
    };
    const fmtFwhmSec = (n) => (n != null && n > 0) ? (n * 60).toFixed(1) : EM_DASH;

    function useFetch(url, deps = []) {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const reload = useCallback(() => {
        setLoading(true);
        fetch(API + url)
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .then(d => { setData(d); setError(null); setLoading(false); })
          .catch(e => { setError(e.message || String(e)); setLoading(false); });
      }, [url]);
      useEffect(() => { reload(); }, deps);
      return { data, loading, error, reload };
    }

    /* Catch any unhandled React render error and show a readable message
       instead of a blank page. Dashboard bugs don't take down the whole
       page — only the failing panel. */
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { err: null };
      }
      static getDerivedStateFromError(err) {
        return { err };
      }
      componentDidCatch(err, info) {
        console.error('Dashboard render error:', err, info);
      }
      render() {
        if (this.state.err) {
          return (
            <div className="card" style={{borderColor:'var(--fail)', color:'var(--fail)'}}>
              <strong>Dashboard error</strong>
              <div style={{fontSize:'0.85rem', marginTop:'0.3rem', fontFamily:'monospace', whiteSpace:'pre-wrap'}}>
                {String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err))}
              </div>
              <button
                style={{marginTop:'0.5rem'}}
                onClick={() => this.setState({err: null})}
              >
                Dismiss
              </button>
            </div>
          );
        }
        return this.props.children;
      }
    }

    // ── ExportBtn — reusable image export for Plotly charts and canvas ──────────
    // format: 'png' | 'jpeg' | 'svg'
    // isCanvas: true for <canvas> elements (e.g. RT×1/K₀ heatmap)
    // scale: pixel multiplier for raster exports (default 2 = 2× for retina/publication)
    function ExportBtn({ plotRef, filename = 'stan-chart', isCanvas = false, scale = 2 }) {
      const [fmt, setFmt] = useState('png');
      const [busy, setBusy] = useState(false);

      const doExport = async () => {
        const el = plotRef?.current;
        if (!el) return;
        setBusy(true);
        try {
          if (isCanvas) {
            // For <canvas>: use built-in toDataURL
            const mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
            const url = el.toDataURL(mime, 0.95);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.${fmt === 'jpeg' ? 'jpg' : 'png'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } else {
            // For Plotly: captures current view including 3D camera angle
            const w = el.clientWidth || 900;
            const h = el.clientHeight || 600;
            await window.Plotly.downloadImage(el, {
              format: fmt,
              filename,
              width:  Math.round(w * scale),
              height: Math.round(h * scale),
            });
          }
        } catch (e) {
          console.error('Export failed:', e);
        }
        setBusy(false);
      };

      const btnStyle = {
        background: 'transparent',
        border: '1px solid var(--border)',
        color: busy ? 'var(--muted)' : 'var(--accent)',
        borderRadius: '0.3rem',
        padding: '0.15rem 0.5rem',
        cursor: busy ? 'default' : 'pointer',
        fontSize: '0.72rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: '0.2rem',
      };

      return (
        <div style={{display:'flex',alignItems:'center',gap:'0.25rem',flexShrink:0}}>
          <select value={fmt} onChange={e => setFmt(e.target.value)} disabled={busy}
            style={{background:'var(--bg)',color:'var(--muted)',border:'1px solid var(--border)',
              borderRadius:'0.25rem',padding:'0.15rem 0.25rem',fontSize:'0.7rem',cursor:'pointer'}}>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            {!isCanvas && <option value="svg">SVG</option>}
          </select>
          <button onClick={doExport} disabled={busy} style={btnStyle}
            title={`Save as ${fmt.toUpperCase()} — captures current view`}>
            {busy ? '…' : '⬇'} Save
          </button>
        </div>
      );
    }

    function GrsBadge({ score }) {
      if (score == null) return null;
      return <span className="badge badge-grs">GRS {score}</span>;
    }

    function GateBadge({ result }) {
      if (!result) return null;
      const cls = result === 'pass' ? 'badge-pass' : result === 'warn' ? 'badge-warn' : 'badge-fail';
      return <span className={`badge ${cls}`}>{result.toUpperCase()}</span>;
    }

    /* ── Gas Gauge: 3-second instrument health at a glance ──────── */

    function GasGauge({ value, min, max, mean, sd, label }) {
      // SVG inline gauge: 200 x 28. Shows a bar from min→max with zone
      // coloring (green near mean, amber ±2σ, red beyond) and a white
      // triangle pointer at `value`.
      const W = 200, H = 28, BAR_Y = 8, BAR_H = 12;
      const range = max - min || 1;
      const pct = v => Math.max(0, Math.min(1, (v - min) / range));

      // Zone boundaries as fractions of the bar
      const meanPct = pct(mean);
      const lo1 = pct(mean - sd),   hi1 = pct(mean + sd);
      const lo2 = pct(mean - 2*sd), hi2 = pct(mean + 2*sd);
      const valPct = pct(value);

      // Decide overall color for the label badge
      const z = Math.abs(value - mean) / (sd || 1);
      const statusColor = z < 1 ? 'var(--pass)' : z < 2 ? 'var(--warn)' : 'var(--fail)';

      // Triangle x position
      const tx = 4 + valPct * (W - 8);
      // Mean line x
      const mx = 4 + meanPct * (W - 8);

      return (
        <div style={{display:'inline-flex', alignItems:'center', gap:'0.4rem'}}>
          <span style={{color:'var(--muted)', fontSize:'0.72rem', width:'52px', textAlign:'right', flexShrink:0}}>{label}</span>
          <svg width={W} height={H} style={{display:'block'}}>
            {/* Full range background */}
            <rect x={4} y={BAR_Y} width={W-8} height={BAR_H} rx={3} fill="#1e293b" />
            {/* Red zones (beyond 2σ) */}
            <rect x={4} y={BAR_Y} width={(lo2)*(W-8)} height={BAR_H} rx={3} fill="rgba(239,68,68,0.25)" />
            <rect x={4 + hi2*(W-8)} y={BAR_Y} width={(1-hi2)*(W-8)} height={BAR_H} rx={3} fill="rgba(239,68,68,0.25)" />
            {/* Amber zones (1-2σ) */}
            <rect x={4 + lo2*(W-8)} y={BAR_Y} width={(lo1-lo2)*(W-8)} height={BAR_H} fill="rgba(234,179,8,0.2)" />
            <rect x={4 + hi1*(W-8)} y={BAR_Y} width={(hi2-hi1)*(W-8)} height={BAR_H} fill="rgba(234,179,8,0.2)" />
            {/* Green zone (within 1σ) */}
            <rect x={4 + lo1*(W-8)} y={BAR_Y} width={(hi1-lo1)*(W-8)} height={BAR_H} fill="rgba(34,197,94,0.2)" />
            {/* Mean dashed line */}
            <line x1={mx} x2={mx} y1={BAR_Y-1} y2={BAR_Y+BAR_H+1} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2,2" />
            {/* Value triangle pointer */}
            <polygon points={`${tx-5},${BAR_Y-1} ${tx+5},${BAR_Y-1} ${tx},${BAR_Y+4}`} fill={statusColor} />
            <polygon points={`${tx-5},${BAR_Y+BAR_H+1} ${tx+5},${BAR_Y+BAR_H+1} ${tx},${BAR_Y+BAR_H-4}`} fill={statusColor} />
          </svg>
          <span style={{color:statusColor, fontSize:'0.75rem', fontWeight:700, width:'50px', fontVariantNumeric:'tabular-nums'}}>
            {value >= 1e6 ? (value/1e6).toFixed(1)+'M' : value >= 1000 ? (value/1000).toFixed(1)+'k' : value?.toFixed?.(0) || '—'}
          </span>
        </div>
      );
    }

    function QuickStatus({ runs }) {
      // Show the most recent 5 runs with gas gauges for 3 key metrics.
      // Stats (min/max/mean/sd) are computed from ALL runs for the same
      // instrument so the gauge reflects that instrument's own history.
      if (!runs || runs.length === 0) return null;

      // Build per-instrument stats from all available runs
      const byInst = {};
      for (const r of runs) {
        if (!byInst[r.instrument]) byInst[r.instrument] = [];
        byInst[r.instrument].push(r);
      }
      function stats(arr) {
        if (!arr.length) return { min:0, max:1, mean:0.5, sd:0.1 };
        const min = Math.min(...arr), max = Math.max(...arr);
        const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
        const sd = Math.sqrt(arr.reduce((a,v)=>a+(v-mean)**2,0)/Math.max(1,arr.length-1));
        return { min, max, mean, sd: sd || mean*0.1 || 1 };
      }
      const instStats = {};
      for (const [inst, instRuns] of Object.entries(byInst)) {
        instStats[inst] = {
          peptides: stats(instRuns.map(r => r.n_peptides || r.n_peptides_dda || 0).filter(v=>v>0)),
          proteins: stats(instRuns.map(r => r.n_proteins || 0).filter(v=>v>0)),
          precursors: stats(instRuns.map(r => r.n_precursors || r.n_psms || 0).filter(v=>v>0)),
        };
      }

      // Most recent 5 runs
      const recent = runs.slice(0, 5);

      return (
        <div className="card" style={{marginBottom:'1.5rem'}}>
          <h3 style={{marginBottom:'0.75rem'}}>
            Quick Health Check
            <span style={{fontWeight:400, fontSize:'0.8rem', color:'var(--muted)', marginLeft:'0.75rem'}}>
              Last {recent.length} runs vs. instrument history
            </span>
          </h3>
          <div style={{display:'flex', flexDirection:'column', gap:'0.5rem'}}>
            {recent.map((r, i) => {
              const s = instStats[r.instrument] || {};
              const depth = r.n_precursors || r.n_psms || 0;
              const pep = r.n_peptides || r.n_peptides_dda || 0;
              const pro = r.n_proteins || 0;
              const depthLabel = r.n_precursors ? 'Prec' : 'PSMs';
              const z_depth = s.precursors ? Math.abs(depth - s.precursors.mean) / (s.precursors.sd || 1) : 0;
              const z_pep = s.peptides ? Math.abs(pep - s.peptides.mean) / (s.peptides.sd || 1) : 0;
              const z_pro = s.proteins ? Math.abs(pro - s.proteins.mean) / (s.proteins.sd || 1) : 0;
              const worst = Math.max(z_depth, z_pep, z_pro);
              const rowColor = worst < 1 ? 'rgba(34,197,94,0.06)' : worst < 2 ? 'rgba(234,179,8,0.06)' : 'rgba(239,68,68,0.08)';

              return (
                <div key={i} style={{
                  display:'flex', flexDirection:'column', gap:'0.3rem', padding:'0.5rem 0.75rem',
                  background: rowColor, borderRadius:'0.5rem',
                }}>
                  <div style={{display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap'}}>
                    <GateBadge result={r.gate_result} />
                    <span title={r.run_name} style={{fontSize:'0.85rem', fontWeight:500, flex:'1 1 auto', wordBreak:'break-all'}}>
                      {r.run_name}
                    </span>
                    <span title={new Date(r.run_date).toLocaleString()} style={{fontSize:'0.7rem', color:'var(--muted)', whiteSpace:'nowrap'}}>
                      {r.instrument} &middot; {new Date(r.run_date).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                  <div style={{display:'flex', gap:'1.5rem', flexWrap:'wrap', alignItems:'flex-start'}}>
                    {s.precursors && (
                      <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'0.2rem'}}>
                        <GasGauge value={depth} {...s.precursors} label={depthLabel} />
                        <span style={{fontSize:'0.75rem', fontWeight:600}}>{depth.toLocaleString()}</span>
                      </div>
                    )}
                    {s.peptides && (
                      <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'0.2rem'}}>
                        <GasGauge value={pep} {...s.peptides} label="Pep" />
                        <span style={{fontSize:'0.75rem', fontWeight:600}}>{pep.toLocaleString()}</span>
                      </div>
                    )}
                    {s.proteins && (
                      <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'0.2rem'}}>
                        <GasGauge value={pro} {...s.proteins} label="Pro" />
                        <span style={{fontSize:'0.75rem', fontWeight:600}}>{pro.toLocaleString()}</span>
                      </div>
                    )}
                    {r.ips_score != null && (
                      <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'0.2rem', marginLeft:'auto'}}>
                        <span style={{fontSize:'0.7rem', color:'var(--muted)'}}>IPS</span>
                        <span style={{fontSize:'1.1rem', fontWeight:700, color:'var(--accent)'}}>{r.ips_score}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{marginTop:'0.5rem', fontSize:'0.72rem', color:'var(--muted)'}}>
            Gauges: green = within 1&sigma; of instrument mean &middot; amber = 1-2&sigma; &middot; red = &gt;2&sigma;
            &nbsp;&middot;&nbsp; Dashed line = mean &nbsp;&middot;&nbsp; Triangles = this run
          </div>
        </div>
      );
    }

    /* ── Last QC Badge ─────────────────────────────────────────────── */

    function LastQcBadge({ instrument }) {
      const { data } = useFetch(`/api/instruments/${encodeURIComponent(instrument)}/last-qc`, [instrument]);
      if (!data || data.hours_ago == null) return <span style={{fontSize:'0.75rem', color:'var(--muted)'}}>No QC data</span>;

      const h = data.hours_ago;
      let label, color, suffix;
      if (h < 24) {
        label = h < 1 ? '<1h ago' : `${Math.round(h)}h ago`;
        color = 'var(--pass)';
        suffix = '';
      } else if (h < 72) {
        label = `${Math.round(h)}h ago`;
        color = 'var(--warn)';
        suffix = ' — OVERDUE';
      } else {
        const days = Math.round(h / 24);
        label = `${days} days ago`;
        color = 'var(--fail)';
        suffix = ' — CRITICAL';
      }

      return (
        <span style={{
          display:'inline-block', padding:'0.15rem 0.5rem', borderRadius:'999px',
          fontSize:'0.72rem', fontWeight:700, background:color,
          color: color === 'var(--pass)' ? '#052e16' : color === 'var(--warn)' ? '#422006' : '#450a0a',
        }}>
          {label}{suffix}
        </span>
      );
    }

    /* ── Column Lifetime Badge ─────────────────────────────────────── */

    function ColumnLifeBadge({ instrument }) {
      const { data } = useFetch(`/api/instruments/${encodeURIComponent(instrument)}/column-life`, [instrument]);
      if (!data || (!data.days_on_column && !data.total_injections_on_column && !data.qc_runs_since_change))
        return <span style={{fontSize:'0.75rem', color:'var(--muted)'}}>No column data</span>;

      const parts = [];
      // Bruker-style: show injection count
      if (data.total_injections_on_column != null) {
        parts.push(`${data.total_injections_on_column.toLocaleString()} injections`);
      }
      if (data.days_on_column > 0) {
        parts.push(`${data.days_on_column} days`);
      }
      // Thermo-style: show trend if available
      let trendStr = '';
      if (data.depth_trend_pct_per_week != null) {
        const sign = data.depth_trend_pct_per_week >= 0 ? '+' : '';
        trendStr = `, trend: ${sign}${data.depth_trend_pct_per_week.toFixed(1)}%/week`;
      }

      const label = parts.length ? parts.join(' (') + (parts.length > 1 ? ')' : '') : `${data.qc_runs_since_change} QC runs`;
      const trendColor = data.depth_trend_pct_per_week != null && data.depth_trend_pct_per_week < -3
        ? 'var(--warn)' : 'var(--muted)';

      return (
        <div style={{fontSize:'0.75rem', color:'var(--muted)'}}>
          <span style={{fontWeight:600, color:'var(--accent)'}}>Column:</span>{' '}
          {label}{trendStr && <span style={{color:trendColor}}>{trendStr}</span>}
          {data.column_model && <span style={{marginLeft:'0.3rem'}}>({data.column_model})</span>}
        </div>
      );
    }

    /* ── Maintenance Event Log Button ──────────────────────────────── */

    function LogEventButton({ instrument }) {
      const [open, setOpen] = useState(false);
      const [eventType, setEventType] = useState('column_change');
      const [notes, setNotes] = useState('');
      const [operator, setOperator] = useState('');
      const [colVendor, setColVendor] = useState('');
      const [colModel, setColModel] = useState('');
      const [status, setStatus] = useState('');

      const eventTypes = [
        { value: 'column_change', label: 'Column change' },
        { value: 'source_clean', label: 'Source clean' },
        { value: 'calibration', label: 'Calibration' },
        { value: 'pm', label: 'Preventive maintenance' },
        { value: 'lc_service', label: 'LC service' },
        { value: 'other', label: 'Other' },
      ];

      async function submit() {
        setStatus('Saving...');
        const payload = { event_type: eventType, notes, operator };
        if (eventType === 'column_change') {
          payload.column_vendor = colVendor || null;
          payload.column_model = colModel || null;
        }
        try {
          const r = await fetch(API + `/api/instruments/${encodeURIComponent(instrument)}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            setStatus('Logged.');
            setNotes('');
            setOperator('');
            setColVendor('');
            setColModel('');
            setTimeout(() => { setStatus(''); setOpen(false); }, 1500);
          } else {
            const err = await r.json();
            setStatus(`Error: ${err.detail || 'Unknown error'}`);
          }
        } catch (e) {
          setStatus(`Error: ${e.message}`);
        }
      }

      const inputStyle = {
        width: '100%', padding: '0.35rem 0.5rem', background: 'var(--bg)',
        color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '0.35rem',
        fontSize: '0.8rem', marginTop: '0.25rem',
      };
      const selectStyle = { ...inputStyle, cursor: 'pointer' };

      return (
        <div style={{marginTop:'0.5rem'}}>
          <button onClick={() => setOpen(!open)} style={{
            padding:'0.25rem 0.6rem', fontSize:'0.72rem', background:'var(--surface)',
            color:'var(--accent)', border:'1px solid var(--border)', borderRadius:'0.35rem',
            cursor:'pointer', fontWeight:600,
          }}>
            {open ? 'Cancel' : 'Log event'}
          </button>
          {open && (
            <div style={{marginTop:'0.5rem', padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)'}}>
              <div style={{marginBottom:'0.4rem'}}>
                <label style={{fontSize:'0.75rem', color:'var(--muted)'}}>Event type</label>
                <select value={eventType} onChange={e => setEventType(e.target.value)} style={selectStyle}>
                  {eventTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {eventType === 'column_change' && (
                <div style={{display:'flex', gap:'0.4rem', marginBottom:'0.4rem'}}>
                  <div style={{flex:1}}>
                    <label style={{fontSize:'0.75rem', color:'var(--muted)'}}>Column vendor</label>
                    <input value={colVendor} onChange={e => setColVendor(e.target.value)} placeholder="e.g. IonOpticks" style={inputStyle} />
                  </div>
                  <div style={{flex:1}}>
                    <label style={{fontSize:'0.75rem', color:'var(--muted)'}}>Column model</label>
                    <input value={colModel} onChange={e => setColModel(e.target.value)} placeholder="e.g. Aurora 25cm" style={inputStyle} />
                  </div>
                </div>
              )}
              <div style={{marginBottom:'0.4rem'}}>
                <label style={{fontSize:'0.75rem', color:'var(--muted)'}}>Operator</label>
                <input value={operator} onChange={e => setOperator(e.target.value)} placeholder="Your name" style={inputStyle} />
              </div>
              <div style={{marginBottom:'0.5rem'}}>
                <label style={{fontSize:'0.75rem', color:'var(--muted)'}}>Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Details..." style={inputStyle} />
              </div>
              <button onClick={submit} style={{padding:'0.3rem 0.75rem', fontSize:'0.8rem'}}>Save</button>
              {status && <span style={{marginLeft:'0.5rem', fontSize:'0.8rem', color: status.startsWith('Error') ? 'var(--fail)' : 'var(--pass)'}}>{status}</span>}
            </div>
          )}
        </div>
      );
    }

    /* ── Mini sparkline: last N runs of the primary metric for an instrument ── */
    function MiniSparkline({ allRuns, instrument, currentMode, n = 30 }) {
      if (!Array.isArray(allRuns)) return null;
      const metricKey = currentMode === 'DDA' ? 'n_psms' : 'n_precursors';
      const metricLabel = currentMode === 'DDA' ? 'PSMs' : 'Precursors';
      // Most recent N runs for this instrument, ordered ascending for plotting
      const instRuns = allRuns
        .filter(r => r.instrument === instrument && (r[metricKey] || 0) > 0)
        .slice(0, n)
        .reverse();
      if (instRuns.length < 2) {
        return (
          <div style={{fontSize:'0.7rem', color:'var(--muted)', marginTop:'0.5rem'}}>
            Not enough history for trend
          </div>
        );
      }
      const values = instRuns.map(r => r[metricKey] || 0);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      const W = 240, H = 36, PAD = 3;
      const w = W - 2*PAD, h = H - 2*PAD;
      const points = values.map((v, i) => {
        const x = PAD + (values.length === 1 ? w/2 : (i / (values.length - 1)) * w);
        const y = PAD + h - ((v - min) / range) * h;
        return [x, y];
      });
      const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      const last = values[values.length - 1];
      const first = values[0];
      const delta = first > 0 ? ((last - first) / first) * 100 : 0;
      const trendColor = delta > 5 ? 'var(--pass)' : delta < -5 ? 'var(--fail)' : 'var(--muted)';
      const sign = delta >= 0 ? '+' : '';
      return (
        <div style={{marginTop:'0.5rem', paddingTop:'0.5rem', borderTop:'1px solid var(--border)'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', fontSize:'0.7rem', color:'var(--muted)', marginBottom:'0.2rem'}}>
            <span>{metricLabel} · last {values.length}</span>
            <span style={{color: trendColor, fontWeight:600}}>{sign}{delta.toFixed(1)}%</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%', height:`${H}px`, display:'block'}}>
            <path d={pathD} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
            {points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="1.5" fill="#60a5fa">
                <title>{instRuns[i].run_name}: {values[i].toLocaleString()}</title>
              </circle>
            ))}
          </svg>
        </div>
      );
    }

    function daysSince(dateStr) {
      if (!dateStr) return null;
      const then = new Date(dateStr);
      if (isNaN(then)) return null;
      const diffMs = Date.now() - then.getTime();
      return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    function DaysSinceBadge({ days }) {
      if (days === null) return null;
      let label, bg, color;
      if (days === 0)      { label = 'Today';           bg = 'rgba(34,197,94,0.15)';  color = '#22c55e'; }
      else if (days === 1) { label = 'Yesterday';       bg = 'rgba(34,197,94,0.08)';  color = '#4ade80'; }
      else if (days <= 3)  { label = `${days} days ago`; bg = 'rgba(234,179,8,0.12)';  color = '#facc15'; }
      else if (days <= 7)  { label = `${days} days ago`; bg = 'rgba(234,179,8,0.08)';  color = '#fbbf24'; }
      else                 { label = `${days} days ago`; bg = 'rgba(239,68,68,0.12)';  color = '#f87171'; }
      return (
        <span style={{padding:'0.15rem 0.55rem', borderRadius:'0.35rem',
                      background:bg, color, fontSize:'0.75rem', fontWeight:700,
                      border:`1px solid ${color}44`, whiteSpace:'nowrap'}}>
          {label}
        </span>
      );
    }

    function LiveRuns() {
      const { data: allRuns, loading, reload } = useFetch('/api/runs?limit=200');
      useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
      const [fixingNames, setFixingNames] = useState(false);
      const [fixResult, setFixResult] = useState(null);

      const doFixNames = async () => {
        setFixingNames(true);
        setFixResult(null);
        try {
          const r = await fetch('/api/fix-instrument-names', { method: 'POST' });
          const d = await r.json();
          setFixResult(d);
          if (d.updated > 0) reload();
        } catch(e) {
          setFixResult({ error: String(e) });
        } finally {
          setFixingNames(false);
        }
      };

      if (loading && !allRuns) return <div className="empty">Loading...</div>;
      if (!Array.isArray(allRuns) || allRuns.length === 0) {
        return <div className="empty">No QC runs yet. Start the watcher to begin monitoring.</div>;
      }

      // Filter to runs from today only
      const today = new Date().toDateString();
      const runs = allRuns.filter(r => new Date(r.run_date).toDateString() === today);

      // Most recent per instrument (always shown)
      const byInstrument = {};
      for (const r of allRuns) {
        if (!byInstrument[r.instrument]) byInstrument[r.instrument] = r;
      }

      // Most recent upload across all instruments
      const mostRecentDate = allRuns.reduce((best, r) =>
        (!best || new Date(r.run_date) > new Date(best)) ? r.run_date : best, null);
      const overallDays = daysSince(mostRecentDate);

      return (
        <div>
          {/* Last upload banner */}
          <div style={{display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1rem',
                       padding:'0.65rem 1rem', borderRadius:'0.5rem',
                       background: overallDays === 0 ? 'rgba(34,197,94,0.07)' : overallDays <= 3 ? 'rgba(234,179,8,0.07)' : 'rgba(239,68,68,0.07)',
                       border: `1px solid ${overallDays === 0 ? 'rgba(34,197,94,0.2)' : overallDays <= 3 ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)'}`}}>
            <div style={{fontSize:'2rem', lineHeight:1}}>
              {overallDays === 0 ? '🟢' : overallDays <= 3 ? '🟡' : '🔴'}
            </div>
            <div>
              <div style={{display:'flex', alignItems:'baseline', gap:'0.5rem'}}>
                <span style={{fontSize:'1.5rem', fontWeight:900,
                              color: overallDays === 0 ? '#22c55e' : overallDays <= 3 ? '#facc15' : '#f87171'}}>
                  {overallDays === 0 ? 'Today' : overallDays === 1 ? '1 day' : `${overallDays} days`}
                </span>
                <span style={{color:'var(--muted)', fontSize:'0.85rem'}}>
                  {overallDays === 0 ? 'data was uploaded' : 'since last file was uploaded'}
                </span>
              </div>
              {mostRecentDate && (
                <div style={{color:'var(--muted)', fontSize:'0.75rem', marginTop:'0.1rem'}}>
                  Last upload: {new Date(mostRecentDate).toLocaleString([], {weekday:'short', month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'})}
                </div>
              )}
            </div>
          </div>

          {runs.length > 0 ? (
            <QuickStatus runs={runs} />
          ) : (
            <div className="card" style={{marginBottom:'1.5rem'}}>
              <div style={{color:'var(--muted)'}}>No runs today yet. Showing most recent per instrument below.</div>
            </div>
          )}

          {/* Auto-name fix button — only shown when 'auto' names exist */}
          {Array.isArray(allRuns) && allRuns.some(r => r.instrument === 'auto') && (
            <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1rem',
                         padding:'0.5rem 0.85rem', borderRadius:'0.4rem',
                         background:'rgba(234,179,8,0.06)', border:'1px solid rgba(234,179,8,0.2)'}}>
              <span style={{color:'#facc15', fontSize:'0.9rem'}}>
                Some runs show as <strong>auto</strong>. Click to read instrument names from .d files.
              </span>
              <button onClick={doFixNames} disabled={fixingNames}
                      style={{padding:'0.25rem 0.7rem', fontSize:'0.8rem', borderRadius:'0.3rem',
                              background:'rgba(234,179,8,0.15)', border:'1px solid rgba(234,179,8,0.35)',
                              color:'#facc15', cursor:'pointer'}}>
                {fixingNames ? 'Fixing...' : 'Fix Names'}
              </button>
              {fixResult && !fixResult.error && (
                <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>
                  Updated {fixResult.updated}, skipped {fixResult.skipped}
                </span>
              )}
              {fixResult?.error && (
                <span style={{color:'#f87171', fontSize:'0.8rem'}}>{fixResult.error}</span>
              )}
            </div>
          )}

          <div className="grid">
            {Object.entries(byInstrument).map(([name, run]) => {
              const days = daysSince(run.run_date);
              return (
                <div className="card" key={name}>
                  <h3 style={{display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap'}}>
                    {name}
                    <DaysSinceBadge days={days} />
                    <LastQcBadge instrument={name} />
                  </h3>
                  <ColumnLifeBadge instrument={name} />
                  <div className="metric"><span className="metric-label">Last run</span><span className="metric-value" title={run.run_name} style={{maxWidth:'60%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{run.run_name}</span></div>
                  <div className="metric"><span className="metric-label">Mode</span><span className="metric-value">{run.mode}</span></div>
                  <div className="metric"><span className="metric-label">Gate</span><GateBadge result={run.gate_result} /></div>
                  <div className="metric"><span className="metric-label">IPS</span><span className="badge badge-grs">IPS {run.ips_score || '—'}</span></div>
                  {isDia(run.mode) && <div className="metric"><span className="metric-label">Precursors</span><span className="metric-value">{run.n_precursors?.toLocaleString()}</span></div>}
                  {isDda(run.mode) && <div className="metric"><span className="metric-label">PSMs</span><span className="metric-value">{run.n_psms?.toLocaleString()}</span></div>}
                  <div className="metric"><span className="metric-label">Time</span><span className="metric-value" title={new Date(run.run_date).toLocaleString()}>{new Date(run.run_date).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span></div>
                  <MiniSparkline allRuns={allRuns} instrument={name} currentMode={run.mode} />
                  {run.diagnosis && <div className="diagnosis">{run.diagnosis}</div>}
                  <LogEventButton instrument={name} />
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    function RunHistory({ pinnedRunIds, setPinnedRunIds, navigateTo }) {
      const { data: runs, loading, reload: reloadRuns } = useFetch('/api/runs?limit=1000');
      const [sortKey, setSortKey] = useState('run_date');
      const [sortDir, setSortDir] = useState('desc');
      const [dateFilter, setDateFilter] = useState('all');
      const [searchTerm, setSearchTerm] = useState('');
      const [selectedRun, setSelectedRun] = useState(null);
      const [mobRun, setMobRun] = useState(null);
      const [rawRun, setRawRun] = useState(null);
      // Scan-for-new-runs state
      const [scanning, setScanning] = useState(false);
      const [scanResults, setScanResults] = useState(null); // null=not scanned yet
      const [importing, setImporting] = useState(new Set());
      const [importedPaths, setImportedPaths] = useState(new Set());
      const [searchJobs, setSearchJobs] = useState({}); // rawPath → {run_id?, status, message}
      const [jobStatus, setJobStatus] = useState({}); // run_id → {status, message}

      const doScan = async () => {
        setScanning(true);
        setScanResults(null);
        try {
          const r = await fetch(API + '/api/scan-new-runs');
          const data = r.ok ? await r.json() : {};
          setScanResults(data.found || []);
        } catch (e) {
          setScanResults([]);
        }
        setScanning(false);
      };

      const doImport = async (rawPath, instrument) => {
        setImporting(prev => new Set([...prev, rawPath]));
        try {
          const r = await fetch(API + '/api/scan-new-runs/import', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({raw_path: rawPath, instrument}),
          });
          if (r.ok) {
            setImportedPaths(prev => new Set([...prev, rawPath]));
            reloadRuns();
          }
        } catch (e) {}
        setImporting(prev => { const s = new Set(prev); s.delete(rawPath); return s; });
      };

      const doImportAll = async () => {
        const pending = (scanResults || []).filter(f => !importedPaths.has(f.raw_path));
        for (const f of pending) {
          await doImport(f.raw_path, f.instrument);
        }
      };

      // Import a file and immediately queue it for DIA-NN / Sage search
      const doImportAndSearch = async (rawPath, instrument) => {
        if (searchJobs[rawPath]) return; // already in flight
        setImporting(prev => new Set([...prev, rawPath]));
        setSearchJobs(prev => ({...prev, [rawPath]: {status: 'importing', message: 'Importing…'}}));
        try {
          const r = await fetch(API + '/api/scan-new-runs/import', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({raw_path: rawPath, instrument}),
          });
          if (r.ok) {
            const data = await r.json();
            const runId = String(data.run_id);
            setImportedPaths(prev => new Set([...prev, rawPath]));
            reloadRuns();
            setSearchJobs(prev => ({...prev, [rawPath]: {run_id: runId, status: 'queued', message: 'Queued…'}}));
            try {
              const pr = await fetch(API + `/api/runs/${runId}/process`, {method: 'POST'});
              const pd = pr.ok ? await pr.json() : {status: 'failed', message: 'Server error'};
              setSearchJobs(prev => ({...prev, [rawPath]: {run_id: runId, ...pd}}));
              setJobStatus(prev => ({...prev, [runId]: pd}));
            } catch {
              setSearchJobs(prev => ({...prev, [rawPath]: {run_id: runId, status: 'failed', message: 'Network error'}}));
            }
          } else {
            setSearchJobs(prev => ({...prev, [rawPath]: {status: 'failed', message: 'Import failed'}}));
          }
        } catch {
          setSearchJobs(prev => ({...prev, [rawPath]: {status: 'failed', message: 'Network error'}}));
        }
        setImporting(prev => { const s = new Set(prev); s.delete(rawPath); return s; });
      };

      // Search all pending scan results (import + process each)
      const doSearchAll = async () => {
        const pending = (scanResults || []).filter(f => !importedPaths.has(f.raw_path) && !searchJobs[f.raw_path]);
        for (const f of pending) {
          await doImportAndSearch(f.raw_path, f.instrument);
        }
      };

      const primaryIds = (r) => isDda(r.mode) ? r.n_psms : r.n_precursors;

      // Pin helpers
      const togglePin = (id) => {
        const sid = String(id);
        setPinnedRunIds(prev => {
          const s = new Set(prev);
          s.has(sid) ? s.delete(sid) : s.add(sid);
          return s;
        });
      };
      const pinAll = (ids) => setPinnedRunIds(prev => new Set([...prev, ...ids.map(String)]));
      const unpinAll = (ids) => setPinnedRunIds(prev => {
        const s = new Set(prev);
        ids.forEach(id => s.delete(String(id)));
        return s;
      });
      const clearPins = () => setPinnedRunIds(new Set());

      const handleSort = (key) => {
        if (sortKey === key) {
          setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
          setSortKey(key);
          setSortDir('desc');
        }
      };

      const SortHeader = ({col, label}) => (
        <th onClick={() => handleSort(col)} style={{cursor: 'pointer', userSelect: 'none'}}>
          {label}{sortKey === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
        </th>
      );

      // Filter + sort (safe even when runs is null/empty)
      const runsArr = Array.isArray(runs) ? runs : [];
      const now = new Date();
      const filterDate = (runDate) => {
        const d = new Date(runDate);
        if (dateFilter === 'all') return true;
        if (dateFilter === 'today') return d.toDateString() === now.toDateString();
        if (dateFilter === 'week') return d >= new Date(now.getTime() - 7 * 86400000);
        if (dateFilter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (dateFilter === 'year') return d.getFullYear() === now.getFullYear();
        if (dateFilter === 'past') return d.getFullYear() < now.getFullYear();
        return true;
      };
      let filtered = runsArr.filter(r => filterDate(r.run_date));
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(r =>
          (r.run_name || '').toLowerCase().includes(term) ||
          (r.instrument || '').toLowerCase().includes(term)
        );
      }
      const getSortVal = (r) => {
        if (sortKey === 'primary_ids') return (isDda(r.mode) ? r.n_psms : r.n_precursors) || 0;
        return r[sortKey];
      };
      filtered.sort((a, b) => {
        let va = getSortVal(a);
        let vb = getSortVal(b);
        if (va == null) va = sortKey === 'run_date' ? '' : 0;
        if (vb == null) vb = sortKey === 'run_date' ? '' : 0;
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        return sortDir === 'asc' ? va - vb : vb - va;
      });

      // Pending scan items (not yet imported and not already queued for search)
      const pendingScan = (scanResults || []).filter(f => !importedPaths.has(f.raw_path) && !searchJobs[f.raw_path]);

      // ── Search processing (DIA-NN / Sage) ──────────────────────────

      const [processAllState, setProcessAllState] = useState(null); // null | {queued, run_ids}

      const doProcessAllNew = async () => {
        setProcessAllState({queued: 0, run_ids: [], loading: true});
        try {
          const r = await fetch(API + '/api/process-all-new', {method: 'POST'});
          const d = r.ok ? await r.json() : {queued: 0, run_ids: []};
          setProcessAllState({...d, loading: false});
          // Seed jobStatus so the polling effect picks them up
          if (d.run_ids && d.run_ids.length > 0) {
            setJobStatus(prev => {
              const next = {...prev};
              for (const id of d.run_ids) next[String(id)] = {status: 'queued', message: 'Queued…'};
              return next;
            });
          }
        } catch {
          setProcessAllState({queued: 0, run_ids: [], loading: false, error: 'Network error'});
        }
      };

      const startProcess = async (runId, e) => {
        e.stopPropagation();
        setJobStatus(prev => ({...prev, [runId]: {status:'queued', message:'Queued…'}}));
        try {
          const r = await fetch(API + `/api/runs/${runId}/process`, {method:'POST'});
          const d = r.ok ? await r.json() : {status:'failed', message:'Server error'};
          setJobStatus(prev => ({...prev, [runId]: d}));
        } catch {
          setJobStatus(prev => ({...prev, [runId]: {status:'failed', message:'Network error'}}));
        }
      };

      // Poll running jobs every 4 seconds
      useEffect(() => {
        const running = Object.entries(jobStatus).filter(([,v]) => v.status === 'queued' || v.status === 'running');
        if (running.length === 0) return;
        const timer = setTimeout(async () => {
          const updates = {};
          for (const [id] of running) {
            try {
              const r = await fetch(API + `/api/runs/${id}/process-status`);
              if (r.ok) updates[id] = await r.json();
            } catch {}
          }
          if (Object.keys(updates).length) {
            setJobStatus(prev => ({...prev, ...updates}));
            // Reload run list if any jobs finished
            const anyDone = Object.values(updates).some(v => v.status === 'done' || v.status === 'failed');
            if (anyDone) reloadRuns();
          }
        }, 4000);
        return () => clearTimeout(timer);
      }, [jobStatus]);

      // Poll scan-panel search jobs (rawPath-keyed) every 4 seconds
      useEffect(() => {
        const active = Object.entries(searchJobs).filter(([, v]) =>
          (v.status === 'queued' || v.status === 'running') && v.run_id
        );
        if (active.length === 0) return;
        const timer = setTimeout(async () => {
          const updates = {};
          for (const [rawPath, sj] of active) {
            try {
              const r = await fetch(API + `/api/runs/${sj.run_id}/process-status`);
              if (r.ok) {
                const d = await r.json();
                updates[rawPath] = {...sj, ...d};
              }
            } catch {}
          }
          if (Object.keys(updates).length) {
            setSearchJobs(prev => ({...prev, ...updates}));
            const anyDone = Object.values(updates).some(v => v.status === 'done' || v.status === 'failed');
            if (anyDone) reloadRuns();
          }
        }, 4000);
        return () => clearTimeout(timer);
      }, [searchJobs]);

      return (
        <div className="card">
          {/* ── Toolbar ── */}
          <div style={{display:'flex', gap:'0.75rem', marginBottom:'0.75rem', flexWrap:'wrap', alignItems:'center'}}>
            <input
              type="text"
              placeholder="Search run name or instrument..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{flex:'1 1 250px', padding:'0.4rem 0.6rem', background:'var(--bg)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'0.3rem'}}
            />
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              style={{padding:'0.4rem 0.6rem', background:'var(--bg)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'0.3rem'}}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
              <option value="past">Past years</option>
            </select>
            <span style={{color:'var(--muted)', fontSize:'0.85rem'}}>
              {loading ? '…' : `${filtered.length} / ${runsArr.length} runs`}
            </span>
            <button
              onClick={doScan}
              disabled={scanning}
              title="Scan watch directories for .d runs not yet in the database"
              style={{padding:'0.35rem 0.75rem', fontSize:'0.85rem', background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'0.4rem', fontWeight:600, cursor:'pointer', flexShrink:0}}
            >
              {scanning ? 'Scanning…' : 'Scan for new runs'}
            </button>
            {(() => {
              // Count runs with no metrics (eligible for "process all new")
              const newCount = runsArr.filter(r => {
                const id = String(r.id);
                const job = jobStatus[id] || {};
                return (r.n_precursors == null && r.n_psms == null)
                  && job.status !== 'queued' && job.status !== 'running' && job.status !== 'done';
              }).length;
              const isRunning = processAllState && processAllState.loading;
              const activeJobs = Object.values(jobStatus).filter(v => v.status === 'queued' || v.status === 'running').length;
              return (
                <button
                  onClick={doProcessAllNew}
                  disabled={isRunning || newCount === 0}
                  title={newCount === 0 ? 'All runs already processed' : `Run DIA-NN/Sage on all ${newCount} unprocessed runs`}
                  style={{
                    padding:'0.35rem 0.75rem', fontSize:'0.85rem', fontWeight:700, flexShrink:0,
                    background: newCount > 0 ? '#d97706' : 'var(--surface)',
                    color: newCount > 0 ? '#fff' : 'var(--muted)',
                    border: newCount > 0 ? 'none' : '1px solid var(--border)',
                    borderRadius:'0.4rem', cursor: newCount > 0 ? 'pointer' : 'not-allowed',
                    opacity: isRunning ? 0.6 : 1,
                  }}
                >
                  {isRunning ? 'Queuing…'
                    : activeJobs > 0 ? `▶ Processing (${activeJobs} running)`
                    : newCount > 0 ? `▶ Process all new (${newCount})`
                    : '✓ All processed'}
                </button>
              );
            })()}
          </div>

          {/* ── Selection / pin bar ── */}
          {pinnedRunIds.size > 0 && (
            <div style={{display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap', padding:'0.45rem 0.7rem', marginBottom:'0.75rem', background:'rgba(218,170,0,0.08)', border:'1px solid rgba(218,170,0,0.35)', borderRadius:'0.45rem', fontSize:'0.84rem'}}>
              <span style={{color:'#DAAA00', fontWeight:700}}>{pinnedRunIds.size} run{pinnedRunIds.size !== 1 ? 's' : ''} selected</span>
              <span style={{color:'var(--muted)'}}>—</span>
              <button onClick={() => navigateTo && navigateTo('trends')} style={{padding:'0.2rem 0.55rem', fontSize:'0.8rem', background:'var(--accent)', color:'var(--bg)', border:'none', borderRadius:'0.3rem', fontWeight:700, cursor:'pointer'}}>→ Trends</button>
              <button onClick={() => navigateTo && navigateTo('health')} style={{padding:'0.2rem 0.55rem', fontSize:'0.8rem', background:'var(--accent)', color:'var(--bg)', border:'none', borderRadius:'0.3rem', fontWeight:700, cursor:'pointer'}}>→ Health</button>
              <button onClick={clearPins} style={{padding:'0.2rem 0.55rem', fontSize:'0.8rem', background:'transparent', color:'var(--muted)', border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer'}}>Clear selection</button>
            </div>
          )}

          {/* ── Scan results panel ── */}
          {scanResults !== null && (
            <div style={{background:'rgba(0,0,0,0.25)', border:'1px solid var(--border)', borderRadius:'0.5rem', padding:'0.75rem', marginBottom:'1rem'}}>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.5rem', gap:'0.5rem', flexWrap:'wrap'}}>
                <span style={{fontWeight:700, fontSize:'0.9rem'}}>
                  {pendingScan.length === 0 && Object.keys(searchJobs).length === 0
                    ? 'No new .d runs found — all runs already in database'
                    : pendingScan.length === 0
                    ? 'All found runs queued for search'
                    : `${pendingScan.length} new run${pendingScan.length !== 1 ? 's' : ''} found — import only, or import + search`}
                </span>
                <div style={{display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap'}}>
                  {pendingScan.length > 1 && (
                    <>
                      <button
                        onClick={doSearchAll}
                        title="Import all found runs and immediately queue each for DIA-NN / Sage search"
                        style={{padding:'0.25rem 0.6rem', fontSize:'0.8rem', background:'#d97706', color:'#fff', border:'none', borderRadius:'0.35rem', fontWeight:700, cursor:'pointer'}}
                      >
                        ▶ Search all ({pendingScan.length})
                      </button>
                      <button
                        onClick={doImportAll}
                        title="Import all found runs as stubs (no search)"
                        style={{padding:'0.25rem 0.6rem', fontSize:'0.8rem', background:'var(--accent)', color:'var(--bg)', border:'none', borderRadius:'0.35rem', fontWeight:700, cursor:'pointer'}}
                      >
                        Import all ({pendingScan.length})
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setScanResults(null)}
                    style={{padding:'0.25rem 0.5rem', fontSize:'0.8rem', background:'transparent', color:'var(--muted)', border:'1px solid var(--border)', borderRadius:'0.35rem', cursor:'pointer'}}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {(pendingScan.length > 0 || Object.keys(searchJobs).length > 0) && (
                <div style={{overflowX:'auto'}}>
                  <table>
                    <thead><tr>
                      <th>Run</th>
                      <th>Instrument</th>
                      <th>Acquired</th>
                      <th style={{minWidth:'180px'}}>Action / Status</th>
                    </tr></thead>
                    <tbody>
                      {scanResults.map(f => {
                        const imported = importedPaths.has(f.raw_path);
                        const busy = importing.has(f.raw_path);
                        const sj = searchJobs[f.raw_path];
                        // Hide rows that were plain-imported (no search) and not active
                        if (imported && !sj) return null;
                        const sjStatusBadge = sj ? (() => {
                          if (sj.status === 'importing') return <span style={{color:'var(--muted)',fontSize:'0.75rem'}}>⏳ Importing…</span>;
                          if (sj.status === 'queued')    return <span style={{color:'var(--warn)',fontSize:'0.75rem'}}>⏳ Queued</span>;
                          if (sj.status === 'running')   return <span style={{color:'var(--warn)',fontSize:'0.75rem'}}>⚙ Running…</span>;
                          if (sj.status === 'done')      return <span style={{color:'var(--pass)',fontSize:'0.75rem',fontWeight:700}}>✓ Done</span>;
                          if (sj.status === 'failed')    return <span title={sj.message} style={{color:'var(--fail)',fontSize:'0.75rem',fontWeight:700,cursor:'help'}}>✗ Failed</span>;
                          return null;
                        })() : null;
                        return (
                          <tr key={f.raw_path}>
                            <td style={{fontFamily:'monospace', fontSize:'0.8rem', maxWidth:'340px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={f.raw_path}>
                              {f.run_name}
                            </td>
                            <td style={{fontSize:'0.85rem'}}>{f.instrument}</td>
                            <td style={{fontSize:'0.8rem', color:'var(--muted)'}}>
                              {f.mtime ? new Date(f.mtime).toLocaleString([], {year:'2-digit', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '—'}
                            </td>
                            <td style={{whiteSpace:'nowrap'}}>
                              {sj ? sjStatusBadge : (
                                <div style={{display:'flex', gap:'0.3rem'}}>
                                  <button
                                    onClick={() => doImportAndSearch(f.raw_path, f.instrument)}
                                    disabled={busy}
                                    title="Import and immediately run DIA-NN / Sage search"
                                    style={{padding:'0.2rem 0.55rem', fontSize:'0.78rem', background:'#d97706', color:'#fff', border:'none', borderRadius:'0.3rem', fontWeight:700, cursor:'pointer'}}
                                  >
                                    {busy ? '…' : '▶ Search'}
                                  </button>
                                  <button
                                    onClick={() => doImport(f.raw_path, f.instrument)}
                                    disabled={busy}
                                    title="Import metadata stub only (no search)"
                                    style={{padding:'0.2rem 0.55rem', fontSize:'0.78rem', background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer'}}
                                  >
                                    Import
                                  </button>
                                </div>
                              )}
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

          {/* ── Runs table ── */}
          {loading ? (
            <div className="empty">Loading…</div>
          ) : runsArr.length === 0 ? (
            <div className="empty" style={{padding:'2rem'}}>
              No runs recorded yet. Use <strong>Scan for new runs</strong> to import existing .d files, or wait for the watcher to process new acquisitions.
            </div>
          ) : (
            <div style={{overflowX: 'auto'}}>
              <table>
                <thead><tr>
                  <th style={{width:'2rem', textAlign:'center', cursor:'pointer', userSelect:'none'}}
                      title={filtered.every(r => pinnedRunIds.has(String(r.id))) ? 'Deselect all visible' : 'Select all visible'}
                      onClick={() => {
                        const allSel = filtered.every(r => pinnedRunIds.has(String(r.id)));
                        allSel ? unpinAll(filtered.map(r => r.id)) : pinAll(filtered.map(r => r.id));
                      }}>
                    <input type="checkbox" readOnly style={{cursor:'pointer'}}
                      checked={filtered.length > 0 && filtered.every(r => pinnedRunIds.has(String(r.id)))}
                      ref={el => { if (el) el.indeterminate = filtered.some(r => pinnedRunIds.has(String(r.id))) && !filtered.every(r => pinnedRunIds.has(String(r.id))); }}
                    />
                  </th>
                  <SortHeader col="run_name" label="Run" />
                  <SortHeader col="instrument" label="Instrument" />
                  <SortHeader col="mode" label="Mode" />
                  <SortHeader col="gate_result" label="Gate" />
                  <SortHeader col="ips_score" label="IPS" />
                  <SortHeader col="primary_ids" label="Precursors / PSMs" />
                  <SortHeader col="n_peptides" label="Peptides" />
                  <SortHeader col="n_proteins" label="Proteins" />
                  <SortHeader col="ms1_signal" label="MS1 Signal" />
                  <SortHeader col="fwhm_rt_min" label="FWHM (s)" />
                  <SortHeader col="median_mass_acc_ms1_ppm" label="Mass Acc ppm" />
                  <SortHeader col="run_date" label="Date" />
                  <th>Search</th>
                </tr></thead>
                <tbody>
                  {filtered.map(r => {
                    const ids = primaryIds(r);
                    const idsLabel = isDda(r.mode) ? 'PSMs' : 'Prec';
                    const job = jobStatus[r.id] || {};
                    const isRunning = job.status === 'queued' || job.status === 'running';
                    const noMetrics = ids == null;
                    const isPinned = pinnedRunIds.has(String(r.id));
                    return (
                      <tr key={r.id} onClick={() => setSelectedRun(r)} style={{cursor:'pointer', background: isPinned ? 'rgba(218,170,0,0.07)' : undefined}}>
                        <td style={{textAlign:'center', width:'2rem'}} onClick={e => { e.stopPropagation(); togglePin(r.id); }}>
                          <input type="checkbox" readOnly checked={isPinned} style={{cursor:'pointer'}} />
                        </td>
                        <td style={{maxWidth:'280px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                          <span title={r.run_name + ' (click for TIC viewer)'}>{r.run_name}</span>
                          {r.raw_path && r.raw_path.endsWith('.d') && (
                            <span
                              onClick={e => { e.stopPropagation(); setMobRun(r); }}
                              title="Ion Mobility Viewer (4DFF feature map + diaPASEF windows)"
                              style={{marginLeft:'0.4rem', padding:'0.1rem 0.3rem', fontSize:'0.65rem', background:'#1e40af', color:'#bfdbfe', borderRadius:'0.2rem', cursor:'pointer', verticalAlign:'middle', fontWeight:700}}
                            >4D</span>
                          )}
                          {r.carafe_library && (
                            <span
                              title={`Carafe library built from this run:\n${r.carafe_library}`}
                              style={{marginLeft:'0.3rem', padding:'0.1rem 0.3rem', fontSize:'0.65rem', background:'#14532d', color:'#86efac', borderRadius:'0.2rem', verticalAlign:'middle', fontWeight:700}}
                            >LIB</span>
                          )}
                          {r.raw_path && r.raw_path.endsWith('.d') && (
                            <span
                              onClick={e => { e.stopPropagation(); setRawRun(r); }}
                              title="RawMeat-style identification-free QC (reads .d directly)"
                              style={{marginLeft:'0.3rem', padding:'0.1rem 0.3rem', fontSize:'0.65rem', background:'#7c2d12', color:'#fed7aa', borderRadius:'0.2rem', cursor:'pointer', verticalAlign:'middle', fontWeight:700}}
                            >RAW</span>
                          )}
                        </td>
                        <td>{r.instrument}</td>
                        <td>{r.mode}</td>
                        <td><GateBadge result={r.gate_result} /></td>
                        <td>{r.ips_score != null ? r.ips_score : EM_DASH}</td>
                        <td title={`${idsLabel}: ${ids != null ? ids.toLocaleString() : EM_DASH}`}>
                          {fmtNum(ids)} <span style={{color:'var(--muted)', fontSize:'0.7rem'}}>{ids > 0 ? idsLabel : ''}</span>
                        </td>
                        <td>{fmtNum(r.n_peptides)}</td>
                        <td>{fmtNum(r.n_proteins)}</td>
                        <td>{fmtSig(r.ms1_signal)}</td>
                        <td>{fmtFwhmSec(r.fwhm_rt_min)}</td>
                        <td>{fmtSigned(r.median_mass_acc_ms1_ppm, 2)}</td>
                        <td>{new Date(r.run_date).toLocaleString([], {year:'2-digit', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</td>
                        <td onClick={e => e.stopPropagation()} style={{whiteSpace:'nowrap'}}>
                          {job.status === 'done' ? (
                            <span style={{color:'var(--pass)',fontSize:'0.75rem',fontWeight:700}}>✓ Done</span>
                          ) : job.status === 'failed' ? (
                            <span title={job.message} style={{color:'var(--fail)',fontSize:'0.75rem',fontWeight:700,cursor:'help'}}>✗ Failed</span>
                          ) : isRunning ? (
                            <span style={{color:'var(--warn)',fontSize:'0.75rem'}} title={job.message}>⏳ {job.status === 'queued' ? 'Queued' : 'Running…'}</span>
                          ) : r.raw_path ? (
                            <button
                              onClick={e => startProcess(r.id, e)}
                              title={noMetrics ? `Run DIA-NN on ${r.run_name}` : `Re-run search on ${r.run_name}`}
                              style={{padding:'0.15rem 0.5rem',fontSize:'0.72rem',background: noMetrics ? 'var(--accent)' : 'var(--surface)',color: noMetrics ? 'var(--bg)' : 'var(--muted)',border:'1px solid var(--border)',borderRadius:'0.3rem',cursor:'pointer',fontWeight: noMetrics ? 700 : 400}}
                            >{noMetrics ? '▶ Process' : '↻ Re-run'}</button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selectedRun && (
            <TicViewer
              runId={selectedRun.id}
              runName={selectedRun.run_name}
              instrument={selectedRun.instrument}
              spd={selectedRun.spd}
              onClose={() => setSelectedRun(null)}
            />
          )}
          {mobRun && (
            <MobilityViewer
              runId={mobRun.id}
              runName={mobRun.run_name}
              instrument={mobRun.instrument}
              onClose={() => setMobRun(null)}
            />
          )}
          {rawRun && (
            <RawMeatViewer
              runId={rawRun.id}
              runName={rawRun.run_name}
              instrument={rawRun.instrument}
              onClose={() => setRawRun(null)}
            />
          )}
        </div>
      );
    }

    /* ── TIC Viewer Modal ──────────────────────────────────────────── */

    function TicViewer({ runId, runName, instrument, spd, onClose }) {
      const [tic, setTic] = useState(null);
      const [communityTic, setCommunityTic] = useState(null);
      const [loading, setLoading] = useState(true);
      const [showCommunity, setShowCommunity] = useState(true);

      useEffect(() => {
        fetch(API + `/api/runs/${runId}/tic`)
          .then(r => r.ok ? r.json() : null)
          .then(setTic)
          .catch(() => setTic(null))
          .finally(() => setLoading(false));
      }, [runId]);

      useEffect(() => {
        if (!instrument || !spd) return;
        // Infer instrument family
        const family = instrument.toLowerCase().includes('tims') ? 'timsTOF' :
                       instrument.toLowerCase().includes('astral') ? 'Astral' :
                       instrument.toLowerCase().includes('exploris') ? 'Exploris' :
                       instrument.toLowerCase().includes('lumos') || instrument.toLowerCase().includes('fusion') ? 'Fusion Lumos' :
                       'Orbitrap';
        // Try common cohort ID patterns
        const cohortIds = [
          `${family}_${spd}spd_low`,
          `${family}_${spd}spd`,
        ];
        (async () => {
          for (const cid of cohortIds) {
            try {
              const r = await fetch(`https://brettsp-stan.hf.space/api/cohorts/${encodeURIComponent(cid)}/tic`);
              if (r.ok) {
                const data = await r.json();
                if (data && data.median_tic) {
                  setCommunityTic(data);
                  return;
                }
              }
            } catch (e) {}
          }
        })();
      }, [instrument, spd]);

      if (loading) {
        return (
          <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}}>
            <div className="card">Loading TIC...</div>
          </div>
        );
      }
      if (!tic) {
        return (
          <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}} onClick={onClose}>
            <div className="card" style={{maxWidth:'500px'}}>
              <h3>No TIC data for this run</h3>
              <p>Re-run baseline with 0.2.40+ to extract TIC data.</p>
              <button onClick={onClose} style={{padding:'0.5rem 1rem', marginTop:'0.5rem'}}>Close</button>
            </div>
          </div>
        );
      }

      // Build SVG TIC plot
      const width = 900, height = 400, pad = 50;
      const rt = tic.rt_min;
      const intensity = tic.intensity;
      const rtMin = Math.min(...rt);
      const rtMax = Math.max(...rt);
      const maxInt = Math.max(...intensity);

      // Normalize run's TIC
      const runPoints = rt.map((r, i) => {
        const x = pad + ((r - rtMin) / (rtMax - rtMin)) * (width - 2*pad);
        const y = height - pad - (intensity[i] / maxInt) * (height - 2*pad);
        return [x, y];
      });
      const runPath = runPoints.map(([x,y],i) => `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

      // Community median trace (if available and toggle on)
      let commPath = null;
      if (showCommunity && communityTic && communityTic.median_tic) {
        const cRt = communityTic.median_tic.rt;
        const cInt = communityTic.median_tic.intensity;
        const cMax = Math.max(...cInt);
        if (cMax > 0 && cRt.length > 1) {
          const cPoints = cRt.map((r, i) => {
            const x = pad + ((r - rtMin) / (rtMax - rtMin)) * (width - 2*pad);
            const y = height - pad - (cInt[i] / cMax) * (height - 2*pad);
            return [x, y];
          });
          commPath = cPoints.map(([x,y],i) => `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        }
      }

      return (
        <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'1rem'}} onClick={onClose}>
          <div className="card" style={{maxWidth:'1000px', width:'100%', maxHeight:'90vh', overflow:'auto'}} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem'}}>
              <div>
                <h3 style={{margin:0, wordBreak:'break-all'}}>{runName}</h3>
                <div style={{color:'var(--muted)', fontSize:'0.85rem', marginTop:'0.25rem'}}>
                  {instrument} · SPD {spd || '?'}
                </div>
              </div>
              <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
                <a href="https://github.com/zack-kirsch/timsplot" target="_blank" title="timsplot — external R/Shiny app, see About tab for setup"
                   style={{padding:'0.4rem 0.8rem', background:'#1e3a5f', color:'var(--accent)', border:'1px solid var(--border)', borderRadius:'0.3rem', fontSize:'0.8rem', fontWeight:600, textDecoration:'none', whiteSpace:'nowrap'}}>
                  timsplot →
                </a>
                <button onClick={onClose} style={{padding:'0.4rem 0.8rem', background:'var(--bg)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer'}}>✕ Close</button>
              </div>
            </div>
            {communityTic && (
              <label style={{display:'inline-flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.5rem', fontSize:'0.85rem', cursor:'pointer'}}>
                <input type="checkbox" checked={showCommunity} onChange={e => setShowCommunity(e.target.checked)} />
                Show community median ({communityTic.n_traces || 0} traces)
              </label>
            )}
            <svg viewBox={`0 0 ${width} ${height}`} style={{width:'100%', height:'auto', background:'var(--bg)', borderRadius:'0.3rem'}}>
              {/* Axes */}
              <line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} stroke="var(--muted)" strokeWidth="1" />
              <line x1={pad} y1={pad} x2={pad} y2={height-pad} stroke="var(--muted)" strokeWidth="1" />
              {/* Community median (dashed orange) */}
              {commPath && <path d={commPath} fill="none" stroke="#ff6b35" strokeWidth="2.5" strokeDasharray="6,4" />}
              {/* Run TIC (solid blue) */}
              <path d={runPath} fill="none" stroke="#60a5fa" strokeWidth="2" />
              {/* Labels */}
              <text x={width/2} y={height-10} fill="var(--muted)" fontSize="12" textAnchor="middle">Retention Time (min)</text>
              <text x={15} y={height/2} fill="var(--muted)" fontSize="12" textAnchor="middle" transform={`rotate(-90, 15, ${height/2})`}>Intensity</text>
              <text x={pad} y={pad+15} fill="#60a5fa" fontSize="11">━ This run</text>
              {commPath && <text x={pad} y={pad+30} fill="#ff6b35" fontSize="11">┅ Community median</text>}
              <text x={width-pad} y={pad+15} fill="var(--muted)" fontSize="11" textAnchor="end">
                RT: {rtMin.toFixed(1)} - {rtMax.toFixed(1)} min · {rt.length} bins
              </text>
            </svg>
          </div>
        </div>
      );
    }

    /* ── RawMeat Viewer Modal ──────────────────────────────────────── */

    function RawMeatViewer({ runId, runName, instrument, onClose }) {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);

      useEffect(() => {
        fetch(API + `/api/runs/${runId}/rawmeat`)
          .then(r => r.ok ? r.json() : {})
          .then(d => { setData(Object.keys(d).length ? d : null); setLoading(false); })
          .catch(() => setLoading(false));
      }, [runId]);

      if (loading) return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div className="card">Loading raw QC data…</div>
        </div>
      );

      if (!data) return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={onClose}>
          <div className="card" style={{maxWidth:'480px'}}>
            <h3>No raw QC data available</h3>
            <p style={{color:'var(--muted)',marginTop:'0.5rem'}}>The .d directory for this run was not found on this machine.</p>
            <button onClick={onClose} style={{marginTop:'0.75rem'}}>Close</button>
          </div>
        </div>
      );

      const { tic, spray, accumulation, pressure, summary, metadata } = data;
      const EM = '—';

      // ── SVG line chart helper ──────────────────────────────────────
      function LineChart({ series, xLabel, yLabel, width=860, height=180, logY=false }) {
        const padL=52, padB=36, padT=14, padR=16;
        const W = width - padL - padR, H = height - padT - padB;
        if (!series || series.length === 0) return null;

        const allX = series.flatMap(s => s.x);
        const allY = series.flatMap(s => s.y).filter(v => v > 0);
        if (!allX.length || !allY.length) return null;

        const xMin = Math.min(...allX), xMax = Math.max(...allX);
        const yMin = logY ? Math.log10(Math.max(1, Math.min(...allY))) : 0;
        const yMax = logY ? Math.log10(Math.max(...allY)) : Math.max(...allY);
        const xRange = xMax - xMin || 1, yRange = yMax - yMin || 1;

        const px = v => padL + ((v - xMin) / xRange) * W;
        const py = v => {
          const yv = logY ? Math.log10(Math.max(1, v)) : v;
          return padT + H - ((yv - yMin) / yRange) * H;
        };

        const yTicks = 4;
        const xTicks = 6;

        return (
          <svg viewBox={`0 0 ${width} ${height}`} style={{width:'100%',height:'auto'}}>
            {/* Grid */}
            {Array.from({length:yTicks+1},(_,i)=>{
              const yv = yMin + i*(yRange/yTicks);
              const y = padT + H - (i/yTicks)*H;
              return <line key={i} x1={padL} y1={y} x2={padL+W} y2={y} stroke="var(--border)" strokeWidth="0.5"/>;
            })}
            {/* Series */}
            {series.map((s,si) => {
              if (!s.x.length) return null;
              const pts = s.x.map((x,i) => `${px(x).toFixed(1)},${py(s.y[i]).toFixed(1)}`).join(' ');
              return <polyline key={si} points={pts} fill="none" stroke={s.color} strokeWidth={s.width||1.5} opacity={s.opacity||1}/>;
            })}
            {/* Dropout markers */}
            {spray.dropout_rts && spray.dropout_rts.map((rt,i) => (
              <line key={i} x1={px(rt)} y1={padT} x2={px(rt)} y2={padT+H} stroke="var(--fail)" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.7"/>
            ))}
            {/* Axes */}
            <line x1={padL} y1={padT} x2={padL} y2={padT+H} stroke="var(--muted)" strokeWidth="1"/>
            <line x1={padL} y1={padT+H} x2={padL+W} y2={padT+H} stroke="var(--muted)" strokeWidth="1"/>
            {/* Y ticks */}
            {Array.from({length:yTicks+1},(_,i)=>{
              const yv = yMin + i*(yRange/yTicks);
              const y = padT + H - (i/yTicks)*H;
              const label = logY ? `10^${yv.toFixed(1)}` : yv>=1e9?(yv/1e9).toFixed(1)+'B':yv>=1e6?(yv/1e6).toFixed(1)+'M':yv>=1e3?(yv/1e3).toFixed(0)+'k':yv.toFixed(0);
              return <text key={i} x={padL-4} y={y+3} fill="var(--muted)" fontSize="9" textAnchor="end">{label}</text>;
            })}
            {/* X ticks */}
            {Array.from({length:xTicks+1},(_,i)=>{
              const xv = xMin + i*(xRange/xTicks);
              const x = px(xv);
              return <text key={i} x={x} y={padT+H+12} fill="var(--muted)" fontSize="9" textAnchor="middle">{(xv/60).toFixed(1)}</text>;
            })}
            {xLabel && <text x={padL+W/2} y={height-2} fill="var(--muted)" fontSize="9" textAnchor="middle">{xLabel}</text>}
            {yLabel && <text x={10} y={padT+H/2} fill="var(--muted)" fontSize="9" textAnchor="middle" transform={`rotate(-90,10,${padT+H/2})`}>{yLabel}</text>}
            {/* Legend */}
            {series.map((s,i) => s.label && (
              <g key={i}>
                <line x1={padL+10+i*90} y1={padT+8} x2={padL+25+i*90} y2={padT+8} stroke={s.color} strokeWidth="2"/>
                <text x={padL+28+i*90} y={padT+11} fill="var(--muted)" fontSize="9">{s.label}</text>
              </g>
            ))}
          </svg>
        );
      }

      // ── Stability score gauge ──────────────────────────────────────
      function StabilityGauge({ score }) {
        const color = score >= 80 ? 'var(--pass)' : score >= 50 ? 'var(--warn)' : 'var(--fail)';
        const label = score >= 80 ? 'Stable' : score >= 50 ? 'Watch' : 'Unstable';
        return (
          <div style={{textAlign:'center',padding:'0.5rem'}}>
            <div style={{fontSize:'2.5rem',fontWeight:800,color,fontVariantNumeric:'tabular-nums'}}>{score}</div>
            <div style={{fontSize:'0.75rem',color,fontWeight:700}}>{label}</div>
            <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.2rem'}}>Spray stability</div>
            {spray.n_dropouts > 0 && (
              <div style={{fontSize:'0.7rem',color:'var(--fail)',marginTop:'0.2rem'}}>
                {spray.n_dropouts} dropout{spray.n_dropouts>1?'s':''} detected
              </div>
            )}
          </div>
        );
      }

      const fmtInt = n => n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'k':String(n);

      return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'1rem'}} onClick={onClose}>
          <div className="card" style={{maxWidth:'1100px',width:'100%',maxHeight:'93vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>

            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1rem'}}>
              <div>
                <h3 style={{margin:0,wordBreak:'break-all'}}>
                  {runName}{' '}
                  <span style={{fontSize:'0.75rem',background:'#7c2d12',color:'#fed7aa',padding:'0.1rem 0.4rem',borderRadius:'0.2rem',verticalAlign:'middle'}}>RAW QC</span>
                </h3>
                <div style={{color:'var(--muted)',fontSize:'0.8rem',marginTop:'0.25rem'}}>
                  {metadata.instrument || instrument}
                  {metadata.software && ` · ${metadata.software} ${metadata.software_version}`}
                  {metadata.acquisition_date && ` · ${new Date(metadata.acquisition_date).toLocaleString()}`}
                </div>
              </div>
              <button onClick={onClose} style={{padding:'0.4rem 0.8rem',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',cursor:'pointer'}}>✕ Close</button>
            </div>

            {/* Top row: summary metrics + stability */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr auto',gap:'0.75rem',marginBottom:'1rem'}}>
              {[
                ['MS1 frames', summary.n_ms1_frames?.toLocaleString()],
                ['MS2 frames', summary.n_ms2_frames?.toLocaleString()],
                ['Duration', summary.rt_duration_min ? summary.rt_duration_min.toFixed(1)+' min' : EM],
                ['Max intensity', summary.ms1_max_intensity ? fmtInt(summary.ms1_max_intensity) : EM],
              ].map(([label, val]) => (
                <div key={label} style={{background:'var(--bg)',borderRadius:'0.4rem',padding:'0.6rem',border:'1px solid var(--border)',textAlign:'center'}}>
                  <div style={{fontSize:'1.2rem',fontWeight:700}}>{val || EM}</div>
                  <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem'}}>{label}</div>
                </div>
              ))}
              <div style={{background:'var(--bg)',borderRadius:'0.4rem',border:'1px solid var(--border)',minWidth:'100px'}}>
                <StabilityGauge score={spray.stability_score} />
              </div>
            </div>

            {/* TIC — MS1 + MS2 */}
            <div style={{marginBottom:'1rem'}}>
              <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>
                Total Ion Chromatogram
                {spray.n_dropouts > 0 && <span style={{color:'var(--fail)',marginLeft:'0.75rem'}}>▎ = spray dropout ({spray.n_dropouts} events)</span>}
              </div>
              <div style={{background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)',padding:'0.25rem'}}>
                <LineChart
                  series={[
                    {x: tic.ms1_rt, y: tic.ms1_int, color:'#60a5fa', label:'MS1', width:1.5},
                    {x: tic.ms2_rt, y: tic.ms2_int, color:'rgba(163,230,53,0.4)', label:'MS2/PASEF', width:1},
                  ]}
                  xLabel="Retention Time (min)" yLabel="Intensity"
                />
              </div>
            </div>

            {/* Accumulation time + pressure side by side */}
            <div style={{display:'grid',gridTemplateColumns: pressure.rt ? '1fr 1fr' : '1fr',gap:'0.75rem',marginBottom:'1rem'}}>
              {accumulation.ms1_rt && accumulation.ms1_rt.length > 0 && (
                <div>
                  <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>
                    Accumulation Time (ms)
                    {accumulation.median_ms1_acc && <span style={{marginLeft:'0.5rem',color:'var(--accent)'}}>MS1 median: {accumulation.median_ms1_acc} ms</span>}
                  </div>
                  <div style={{background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)',padding:'0.25rem'}}>
                    <LineChart
                      series={[
                        {x: accumulation.ms1_rt, y: accumulation.ms1_acc, color:'#f59e0b', label:'MS1 acc.', width:1},
                        {x: accumulation.ms2_rt||[], y: accumulation.ms2_acc||[], color:'#a78bfa', label:'MS2 acc.', width:1, opacity:0.6},
                      ]}
                      xLabel="Retention Time (min)" yLabel="Acc. time (ms)" height={150}
                    />
                  </div>
                </div>
              )}
              {pressure.rt && pressure.rt.length > 0 && (
                <div>
                  <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>
                    Source Pressure (mbar)
                    <span style={{marginLeft:'0.5rem',color:'var(--accent)'}}>mean: {pressure.mean} · range: {pressure.min}–{pressure.max}</span>
                  </div>
                  <div style={{background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)',padding:'0.25rem'}}>
                    <LineChart
                      series={[{x: pressure.rt, y: pressure.mbar, color:'#f87171', label:'Pressure', width:1}]}
                      xLabel="Retention Time (min)" yLabel="mbar" height={150}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Frame type breakdown + extra stats */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
              <div style={{background:'var(--bg)',borderRadius:'0.4rem',padding:'0.75rem',border:'1px solid var(--border)'}}>
                <div style={{fontSize:'0.8rem',fontWeight:600,marginBottom:'0.5rem',color:'var(--accent)'}}>Frame breakdown</div>
                {Object.entries(summary.frame_types||{}).map(([t,n]) => (
                  <div key={t} className="metric">
                    <span className="metric-label">{t}</span>
                    <span className="metric-value">{n.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div style={{background:'var(--bg)',borderRadius:'0.4rem',padding:'0.75rem',border:'1px solid var(--border)'}}>
                <div style={{fontSize:'0.8rem',fontWeight:600,marginBottom:'0.5rem',color:'var(--accent)'}}>Signal quality</div>
                {[
                  ['Dynamic range (log₁₀)', summary.dynamic_range_log10 ?? EM],
                  ['Spray CV', spray.cv_pct != null ? spray.cv_pct.toFixed(1)+'%' : EM],
                  ['Total TIC', summary.ms1_total_tic ? fmtInt(summary.ms1_total_tic) : EM],
                  ['Dropouts detected', spray.n_dropouts ?? 0],
                ].map(([l,v]) => (
                  <div key={l} className="metric">
                    <span className="metric-label">{l}</span>
                    <span className="metric-value">{v}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      );
    }

    /* ── Shared mobility chart helpers (used by viewer modal + tab) ── */

    function BarChart({ edges, counts, color = '#60a5fa', xLabel, yLabel, markerVal, markerLabel }) {
      if (!edges || !counts || counts.length === 0) return <div style={{color:'var(--muted)',fontSize:'0.8rem',padding:'0.5rem'}}>No data</div>;
      const W = 380, H = 150, padL = 42, padB = 36, padT = 18, padR = 12;
      const w = W - padL - padR, h = H - padT - padB;
      const maxC = Math.max(...counts);
      const bw = w / counts.length;
      const yTicks = [0, Math.round(maxC / 2), maxC];
      const xIdxStep = Math.max(1, Math.floor(edges.length / 5));
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto'}}>
          {counts.map((c, i) => {
            const bh = maxC > 0 ? (c / maxC) * h : 0;
            return <rect key={i} x={padL + i * bw} y={padT + h - bh} width={Math.max(bw - 0.5, 0.5)} height={bh} fill={color} opacity={0.8} />;
          })}
          <line x1={padL} y1={padT} x2={padL} y2={padT + h} stroke="var(--muted)" strokeWidth="1"/>
          <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h} stroke="var(--muted)" strokeWidth="1"/>
          {yTicks.map((v, i) => {
            const vy = padT + h - (maxC > 0 ? (v / maxC) * h : 0);
            return <g key={i}>
              <line x1={padL - 3} y1={vy} x2={padL} y2={vy} stroke="var(--muted)" strokeWidth="1"/>
              <text x={padL - 5} y={vy + 3} fill="var(--muted)" fontSize="8" textAnchor="end">{v > 999 ? (v / 1000).toFixed(0) + 'k' : v}</text>
            </g>;
          })}
          {edges.filter((_, i) => i % xIdxStep === 0).map((v, i) => {
            const idx = edges.indexOf(v);
            const x = padL + idx * bw + bw / 2;
            return <text key={i} x={x} y={padT + h + 12} fill="var(--muted)" fontSize="8" textAnchor="middle">{typeof v === 'number' ? (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(1)) : v}</text>;
          })}
          {xLabel && <text x={padL + w / 2} y={H - 3} fill="var(--muted)" fontSize="9" textAnchor="middle">{xLabel}</text>}
          {yLabel && <text x={10} y={padT + h / 2} fill="var(--muted)" fontSize="9" textAnchor="middle" transform={`rotate(-90,10,${padT + h / 2})`}>{yLabel}</text>}
          {markerVal != null && (() => {
            const mi = edges.findIndex(e => e >= markerVal);
            const x = padL + (mi >= 0 ? mi : counts.length) * bw;
            return <g>
              <line x1={x} y1={padT} x2={x} y2={padT + h} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4,3"/>
              {markerLabel && <text x={x + 3} y={padT + 11} fill="var(--accent)" fontSize="8">{markerLabel}</text>}
            </g>;
          })()}
        </svg>
      );
    }

    function ChargeChart({ data }) {
      if (!data || !data.charges) return <div style={{color:'var(--muted)',fontSize:'0.8rem',padding:'0.5rem'}}>No data</div>;
      const { charges, fractions, total } = data;
      const W = 280, H = 150, padL = 42, padB = 36, padT = 18, padR = 12;
      const w = W - padL - padR, h = H - padT - padB;
      const maxFrac = Math.max(...fractions);
      const bw = w / charges.length;
      const palette = ['#6366f1','#60a5fa','#22c55e','#eab308','#f97316','#ef4444'];
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto'}}>
          {charges.map((z, i) => {
            const bh = maxFrac > 0 ? (fractions[i] / maxFrac) * h : 0;
            return <g key={z}>
              <rect x={padL + i * bw + 2} y={padT + h - bh} width={bw - 4} height={bh} fill={palette[i % palette.length]} opacity={0.85}/>
              <text x={padL + i * bw + bw / 2} y={padT + h + 12} fill="var(--muted)" fontSize="9" textAnchor="middle">z={z}</text>
              <text x={padL + i * bw + bw / 2} y={padT + h - bh - 3} fill="var(--text)" fontSize="8" textAnchor="middle">{fractions[i].toFixed(0)}%</text>
            </g>;
          })}
          <line x1={padL} y1={padT} x2={padL} y2={padT + h} stroke="var(--muted)" strokeWidth="1"/>
          <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h} stroke="var(--muted)" strokeWidth="1"/>
          <text x={padL + w / 2} y={H - 3} fill="var(--muted)" fontSize="9" textAnchor="middle">Charge State</text>
          <text x={10} y={padT + h / 2} fill="var(--muted)" fontSize="9" textAnchor="middle" transform={`rotate(-90,10,${padT + h / 2})`}>% Features</text>
          <text x={padL + w} y={padT + 10} fill="var(--muted)" fontSize="8" textAnchor="end">n={total?.toLocaleString()}</text>
        </svg>
      );
    }

    function DiaWindowChart({ data }) {
      if (!data || !data.windows || data.windows.length === 0) return null;
      const W = 560, H = 220, padL = 50, padB = 38, padT = 22, padR = 20;
      const w = W - padL - padR, h = H - padT - padB;
      const mzMin = data.mz_range[0], mzMax = data.mz_range[1];
      const mobMin = (data.mobility_range[0] > 0 ? data.mobility_range[0] : 0.6);
      const mobMax = (data.mobility_range[1] > 0 ? data.mobility_range[1] : 1.6);
      const toX = mz  => padL + ((mz  - mzMin) / (mzMax - mzMin)) * w;
      const toY = mob => padT + h - ((mob - mobMin) / (mobMax - mobMin)) * h;
      const groups = [...new Set(data.windows.map(ww => ww.window_group))];
      const palette = ['#3b82f6','#22c55e','#f97316','#a855f7','#06b6d4','#f59e0b','#ec4899','#14b8a6'];
      const colorOf = g => palette[groups.indexOf(g) % palette.length];
      const mzSpan = mzMax - mzMin;
      const xStep = mzSpan > 600 ? 200 : mzSpan > 300 ? 100 : 50;
      const xTicks = [];
      for (let v = Math.ceil(mzMin / xStep) * xStep; v <= mzMax; v += xStep) xTicks.push(v);
      const yTicks = [0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5,1.6].filter(v => v >= mobMin - 0.05 && v <= mobMax + 0.05);
      const hasK0 = data.windows.some(ww => ww.oneoverk0_lower > 0 || ww.oneoverk0_upper > 0);
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto'}}>
          {hasK0 ? data.windows.map((ww, i) => {
            if (ww.oneoverk0_lower <= 0 && ww.oneoverk0_upper <= 0) return null;
            const x1 = toX(ww.mz_lower), x2 = toX(ww.mz_upper);
            const y1 = toY(ww.oneoverk0_upper), y2 = toY(ww.oneoverk0_lower);
            const color = colorOf(ww.window_group);
            return (
              <g key={i}>
                <rect x={x1} y={y1} width={Math.max(x2-x1,1)} height={Math.max(y2-y1,1)} fill={color} stroke={color} strokeWidth="0.8" opacity="0.35"/>
                <rect x={x1} y={y1} width={Math.max(x2-x1,1)} height={Math.max(y2-y1,1)} fill="none" stroke={color} strokeWidth="0.8" opacity="0.9"/>
              </g>
            );
          }) : data.windows.map((ww, i) => (
            <rect key={i} x={toX(ww.mz_lower)} y={padT} width={Math.max(toX(ww.mz_upper)-toX(ww.mz_lower),1)} height={h} fill={colorOf(ww.window_group)} opacity="0.25"/>
          ))}
          <line x1={padL} y1={padT} x2={padL} y2={padT+h} stroke="var(--muted)" strokeWidth="1"/>
          <line x1={padL} y1={padT+h} x2={padL+w} y2={padT+h} stroke="var(--muted)" strokeWidth="1"/>
          {xTicks.map(v => (
            <g key={v}>
              <line x1={toX(v)} y1={padT+h} x2={toX(v)} y2={padT+h+4} stroke="var(--muted)" strokeWidth="1"/>
              <text x={toX(v)} y={padT+h+14} fill="var(--muted)" fontSize="9" textAnchor="middle">{v}</text>
            </g>
          ))}
          {hasK0 && yTicks.map(v => (
            <g key={v}>
              <line x1={padL-4} y1={toY(v)} x2={padL} y2={toY(v)} stroke="var(--muted)" strokeWidth="1"/>
              <text x={padL-6} y={toY(v)+3} fill="var(--muted)" fontSize="9" textAnchor="end">{v.toFixed(1)}</text>
            </g>
          ))}
          <text x={padL+w/2} y={H-3} fill="var(--muted)" fontSize="9" textAnchor="middle">m/z (Da)</text>
          {hasK0 && <text x={10} y={padT+h/2} fill="var(--muted)" fontSize="9" textAnchor="middle" transform={`rotate(-90,10,${padT+h/2})`}>1/K₀ (Vs/cm²)</text>}
          <text x={padL+w} y={padT+12} fill="var(--muted)" fontSize="8" textAnchor="end">
            {data.n_window_groups} group{data.n_window_groups !== 1 ? 's' : ''} · {data.windows.length} windows
          </text>
          {!hasK0 && (
            <text x={padL+w/2} y={padT+h/2} fill="var(--warn)" fontSize="9" textAnchor="middle">
              1/K₀ not calibrated — showing m/z coverage only
            </text>
          )}
        </svg>
      );
    }

    /* ── Ion Mobility Viewer Modal ─────────────────────────────────── */

    function MobilityViewer({ runId, runName, instrument, onClose }) {
      const [mapData, setMapData] = useState(null);
      const [statsData, setStatsData] = useState(null);
      const [windowData, setWindowData] = useState(null);
      const [loading, setLoading] = useState(true);
      const canvasRef = useRef(null);

      useEffect(() => {
        Promise.all([
          fetch(API + `/api/runs/${runId}/mobility-map`).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${runId}/mobility-stats`).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${runId}/dia-windows`).then(r => r.ok ? r.json() : {}),
        ]).then(([map, stats, wins]) => {
          setMapData(map && map.grid ? map : null);
          setStatsData(stats && Object.keys(stats).length > 0 ? stats : null);
          setWindowData(wins && wins.windows && wins.windows.length > 0 ? wins : null);
          setLoading(false);
        }).catch(() => setLoading(false));
      }, [runId]);

      // Draw canvas heatmap whenever mapData arrives
      useEffect(() => {
        if (!mapData || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const grid = mapData.grid;
        const rtBins = grid.length;
        const mobBins = grid[0].length;
        let maxVal = 0;
        for (const row of grid) for (const v of row) if (v > maxVal) maxVal = v;
        if (maxVal === 0) return;
        const cw = canvas.width / mobBins;
        const ch = canvas.height / rtBins;
        // Viridis-like colormap: dark blue → blue → teal → green → accent yellow
        const stops = [
          [0,    [9,   9,   121]],
          [0.25, [0,   108, 180]],
          [0.5,  [0,   173, 183]],
          [0.75, [100, 200, 100]],
          [1.0,  [218, 170, 0  ]],
        ];
        function valToRgb(v) {
          const t = v / maxVal;
          for (let i = 0; i < stops.length - 1; i++) {
            const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
            if (t >= t0 && t <= t1) {
              const f = (t - t0) / (t1 - t0);
              return [
                Math.round(c0[0] + f * (c1[0] - c0[0])),
                Math.round(c0[1] + f * (c1[1] - c0[1])),
                Math.round(c0[2] + f * (c1[2] - c0[2])),
              ];
            }
          }
          return stops[stops.length - 1][1];
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let ri = 0; ri < rtBins; ri++) {
          for (let mi = 0; mi < mobBins; mi++) {
            const v = grid[ri][mi];
            if (v < 0.001) continue; // empty bin — leave as canvas bg
            const [r, g, b] = valToRgb(v);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            // RT=0 is bottom, so flip y-axis
            ctx.fillRect(mi * cw, (rtBins - 1 - ri) * ch, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
          }
        }
      }, [mapData]);

      if (loading) {
        return (
          <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
            <div className="card">Loading ion mobility data…</div>
          </div>
        );
      }
      if (!mapData && !statsData && !windowData) {
        return (
          <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={onClose}>
            <div className="card" style={{maxWidth:'500px'}}>
              <h3>No 4D ion mobility data</h3>
              <p style={{color:'var(--muted)',marginTop:'0.5rem'}}>No 4DFF .features file and no diaPASEF windows found for this run. Run 4DFF feature finding on your .d file to populate the feature map view. The diaPASEF window layout requires a DIA acquisition with DiaFrameMsMsWindows in analysis.tdf.</p>
              <button onClick={onClose} style={{marginTop:'0.75rem'}}>Close</button>
            </div>
          </div>
        );
      }

      // ── SVG histogram bar chart ── (module-level copies above; these shadow within MobilityViewer)
      function BarChart({ edges, counts, color = '#60a5fa', xLabel, yLabel, markerVal, markerLabel }) {
        if (!edges || !counts || counts.length === 0) return <div style={{color:'var(--muted)',fontSize:'0.8rem',padding:'0.5rem'}}>No data</div>;
        const W = 380, H = 150, padL = 42, padB = 36, padT = 18, padR = 12;
        const w = W - padL - padR, h = H - padT - padB;
        const maxC = Math.max(...counts);
        const bw = w / counts.length;
        const yTicks = [0, Math.round(maxC / 2), maxC];
        const xIdxStep = Math.max(1, Math.floor(edges.length / 5));
        return (
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto'}}>
            {counts.map((c, i) => {
              const bh = maxC > 0 ? (c / maxC) * h : 0;
              return <rect key={i} x={padL + i * bw} y={padT + h - bh} width={Math.max(bw - 0.5, 0.5)} height={bh} fill={color} opacity={0.8} />;
            })}
            <line x1={padL} y1={padT} x2={padL} y2={padT + h} stroke="var(--muted)" strokeWidth="1"/>
            <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h} stroke="var(--muted)" strokeWidth="1"/>
            {yTicks.map((v, i) => {
              const vy = padT + h - (maxC > 0 ? (v / maxC) * h : 0);
              return <g key={i}>
                <line x1={padL - 3} y1={vy} x2={padL} y2={vy} stroke="var(--muted)" strokeWidth="1"/>
                <text x={padL - 5} y={vy + 3} fill="var(--muted)" fontSize="8" textAnchor="end">{v > 999 ? (v / 1000).toFixed(0) + 'k' : v}</text>
              </g>;
            })}
            {edges.filter((_, i) => i % xIdxStep === 0).map((v, i) => {
              const idx = edges.indexOf(v);
              const x = padL + idx * bw + bw / 2;
              return <text key={i} x={x} y={padT + h + 12} fill="var(--muted)" fontSize="8" textAnchor="middle">{typeof v === 'number' ? (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(1)) : v}</text>;
            })}
            {xLabel && <text x={padL + w / 2} y={H - 3} fill="var(--muted)" fontSize="9" textAnchor="middle">{xLabel}</text>}
            {yLabel && <text x={10} y={padT + h / 2} fill="var(--muted)" fontSize="9" textAnchor="middle" transform={`rotate(-90,10,${padT + h / 2})`}>{yLabel}</text>}
            {markerVal != null && (() => {
              const mi = edges.findIndex(e => e >= markerVal);
              const x = padL + (mi >= 0 ? mi : counts.length) * bw;
              return <g>
                <line x1={x} y1={padT} x2={x} y2={padT + h} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4,3"/>
                {markerLabel && <text x={x + 3} y={padT + 11} fill="var(--accent)" fontSize="8">{markerLabel}</text>}
              </g>;
            })()}
          </svg>
        );
      }

      // ── SVG charge-state bar chart ──
      function ChargeChart({ data }) {
        if (!data || !data.charges) return <div style={{color:'var(--muted)',fontSize:'0.8rem',padding:'0.5rem'}}>No data</div>;
        const { charges, fractions, total } = data;
        const W = 280, H = 150, padL = 42, padB = 36, padT = 18, padR = 12;
        const w = W - padL - padR, h = H - padT - padB;
        const maxFrac = Math.max(...fractions);
        const bw = w / charges.length;
        // Same colours as MobilityTab — keyed by charge number, not position
        const MODAL_CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
        const MODAL_CHARGE_LABEL  = {0:'?',1:'+1',2:'+2',3:'+3',4:'+4',5:'+5',6:'+6'};
        return (
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto'}}>
            {charges.map((z, i) => {
              const bh = maxFrac > 0 ? (fractions[i] / maxFrac) * h : 0;
              const col = MODAL_CHARGE_COLORS[z] || '#94a3b8';
              const lbl = MODAL_CHARGE_LABEL[z] || `+${z}`;
              return <g key={z}>
                <rect x={padL + i * bw + 2} y={padT + h - bh} width={bw - 4} height={bh} fill={col} opacity={0.85}/>
                <text x={padL + i * bw + bw / 2} y={padT + h + 12} fill={col} fontSize="9" textAnchor="middle">{lbl}</text>
                <text x={padL + i * bw + bw / 2} y={padT + h - bh - 3} fill="var(--text)" fontSize="8" textAnchor="middle">{fractions[i].toFixed(0)}%</text>
              </g>;
            })}
            <line x1={padL} y1={padT} x2={padL} y2={padT + h} stroke="var(--muted)" strokeWidth="1"/>
            <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h} stroke="var(--muted)" strokeWidth="1"/>
            <text x={padL + w / 2} y={H - 3} fill="var(--muted)" fontSize="9" textAnchor="middle">Charge State</text>
            <text x={10} y={padT + h / 2} fill="var(--muted)" fontSize="9" textAnchor="middle" transform={`rotate(-90,10,${padT + h / 2})`}>% Features</text>
            <text x={padL + w} y={padT + 10} fill="var(--muted)" fontSize="8" textAnchor="end">n={total?.toLocaleString()}</text>
          </svg>
        );
      }

      // ── diaPASEF window layout chart ──
      function DiaWindowChart({ data }) {
        if (!data || !data.windows || data.windows.length === 0) return null;
        const W = 560, H = 220, padL = 50, padB = 38, padT = 22, padR = 20;
        const w = W - padL - padR, h = H - padT - padB;
        const mzMin = data.mz_range[0], mzMax = data.mz_range[1];
        // Use reported mobility range; fall back to sensible timsTOF defaults
        const mobMin = (data.mobility_range[0] > 0 ? data.mobility_range[0] : 0.6);
        const mobMax = (data.mobility_range[1] > 0 ? data.mobility_range[1] : 1.6);
        const toX = mz  => padL + ((mz  - mzMin) / (mzMax - mzMin)) * w;
        const toY = mob => padT + h - ((mob - mobMin) / (mobMax - mobMin)) * h;
        // Colour windows by window group (cycles through palette)
        const groups = [...new Set(data.windows.map(ww => ww.window_group))];
        const palette = ['#3b82f6','#22c55e','#f97316','#a855f7','#06b6d4','#f59e0b','#ec4899','#14b8a6'];
        const colorOf = g => palette[groups.indexOf(g) % palette.length];
        // x-axis ticks
        const mzSpan = mzMax - mzMin;
        const xStep = mzSpan > 600 ? 200 : mzSpan > 300 ? 100 : 50;
        const xTicks = [];
        for (let v = Math.ceil(mzMin / xStep) * xStep; v <= mzMax; v += xStep) xTicks.push(v);
        // y-axis ticks
        const yTicks = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]
          .filter(v => v >= mobMin - 0.05 && v <= mobMax + 0.05);
        const hasK0 = data.windows.some(ww => ww.oneoverk0_lower > 0 || ww.oneoverk0_upper > 0);
        return (
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto'}}>
            {/* Window rectangles */}
            {hasK0 ? data.windows.map((ww, i) => {
              if (ww.oneoverk0_lower <= 0 && ww.oneoverk0_upper <= 0) return null;
              const x1 = toX(ww.mz_lower), x2 = toX(ww.mz_upper);
              const y1 = toY(ww.oneoverk0_upper), y2 = toY(ww.oneoverk0_lower);
              const color = colorOf(ww.window_group);
              return (
                <g key={i}>
                  <rect x={x1} y={y1} width={Math.max(x2-x1,1)} height={Math.max(y2-y1,1)} fill={color} stroke={color} strokeWidth="0.8" opacity="0.35"/>
                  <rect x={x1} y={y1} width={Math.max(x2-x1,1)} height={Math.max(y2-y1,1)} fill="none" stroke={color} strokeWidth="0.8" opacity="0.9"/>
                </g>
              );
            }) : (
              /* No 1/K0 calibration — show mz spans as vertical stripes with note */
              data.windows.map((ww, i) => (
                <rect key={i} x={toX(ww.mz_lower)} y={padT} width={Math.max(toX(ww.mz_upper)-toX(ww.mz_lower),1)} height={h} fill={colorOf(ww.window_group)} opacity="0.25"/>
              ))
            )}
            {/* Axes */}
            <line x1={padL} y1={padT} x2={padL} y2={padT+h} stroke="var(--muted)" strokeWidth="1"/>
            <line x1={padL} y1={padT+h} x2={padL+w} y2={padT+h} stroke="var(--muted)" strokeWidth="1"/>
            {xTicks.map(v => (
              <g key={v}>
                <line x1={toX(v)} y1={padT+h} x2={toX(v)} y2={padT+h+4} stroke="var(--muted)" strokeWidth="1"/>
                <text x={toX(v)} y={padT+h+14} fill="var(--muted)" fontSize="9" textAnchor="middle">{v}</text>
              </g>
            ))}
            {hasK0 && yTicks.map(v => (
              <g key={v}>
                <line x1={padL-4} y1={toY(v)} x2={padL} y2={toY(v)} stroke="var(--muted)" strokeWidth="1"/>
                <text x={padL-6} y={toY(v)+3} fill="var(--muted)" fontSize="9" textAnchor="end">{v.toFixed(1)}</text>
              </g>
            ))}
            <text x={padL+w/2} y={H-3} fill="var(--muted)" fontSize="9" textAnchor="middle">m/z (Da)</text>
            {hasK0 && <text x={10} y={padT+h/2} fill="var(--muted)" fontSize="9" textAnchor="middle" transform={`rotate(-90,10,${padT+h/2})`}>1/K₀ (Vs/cm²)</text>}
            <text x={padL+w} y={padT+12} fill="var(--muted)" fontSize="8" textAnchor="end">
              {data.n_window_groups} group{data.n_window_groups !== 1 ? 's' : ''} · {data.windows.length} windows
            </text>
            {!hasK0 && (
              <text x={padL+w/2} y={padT+h/2} fill="var(--warn)" fontSize="9" textAnchor="middle">
                1/K₀ not calibrated — showing m/z coverage only
              </text>
            )}
          </svg>
        );
      }

      const fwhm = statsData?.fwhm_hist;
      const charge = statsData?.charge_dist;
      const intHist = statsData?.intensity_hist;

      return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'1rem'}} onClick={onClose}>
          <div className="card" style={{maxWidth:'1100px',width:'100%',maxHeight:'92vh',overflowY:'auto'}} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1rem'}}>
              <div>
                <h3 style={{margin:0,wordBreak:'break-all'}}>
                  {runName}{' '}
                  <span style={{fontSize:'0.75rem',background:'#1e40af',color:'#bfdbfe',padding:'0.1rem 0.4rem',borderRadius:'0.2rem',verticalAlign:'middle'}}>4D Ion Mobility</span>
                </h3>
                <div style={{color:'var(--muted)',fontSize:'0.85rem',marginTop:'0.25rem'}}>{instrument}</div>
              </div>
              <button onClick={onClose} style={{padding:'0.4rem 0.8rem',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',cursor:'pointer'}}>✕ Close</button>
            </div>

            {/* Heatmap row */}
            {mapData && (
              <div style={{marginBottom:'1rem'}}>
                <div style={{color:'var(--muted)',fontSize:'0.8rem',marginBottom:'0.3rem'}}>
                  RT × 1/K₀ Density Map — log₁₀(Σ intensity) · {mapData.n_features?.toLocaleString()} features
                  <span style={{marginLeft:'1rem'}}>RT {mapData.rt_range[0]}–{mapData.rt_range[1]} s · 1/K₀ {mapData.mobility_range[0]}–{mapData.mobility_range[1]} Vs/cm²</span>
                </div>
                <div style={{position:'relative',background:'var(--bg)',borderRadius:'0.3rem',overflow:'hidden',border:'1px solid var(--border)'}}>
                  <canvas ref={canvasRef} width={600} height={300} style={{width:'100%',height:'auto',display:'block'}}/>
                  {/* Axis label overlays */}
                  <div style={{position:'absolute',bottom:'2px',left:0,right:0,textAlign:'center',color:'rgba(160,180,204,0.7)',fontSize:'0.65rem',pointerEvents:'none'}}>
                    Retention Time →
                  </div>
                  <div style={{position:'absolute',top:0,bottom:0,left:'2px',display:'flex',alignItems:'center',writingMode:'vertical-lr',transform:'rotate(180deg)',color:'rgba(160,180,204,0.7)',fontSize:'0.65rem',pointerEvents:'none'}}>
                    1/K₀ (Vs/cm²) →
                  </div>
                </div>
              </div>
            )}

            {/* Histograms row */}
            {statsData && (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1.4fr 1.4fr',gap:'1rem'}}>
                <div>
                  <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>Charge State Distribution</div>
                  <ChargeChart data={charge} />
                </div>
                <div>
                  <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>1/K₀ FWHM Distribution</div>
                  <BarChart
                    edges={fwhm?.edges} counts={fwhm?.counts}
                    color="#38bdf8" xLabel="1/K₀ FWHM (Vs/cm²)" yLabel="Features"
                    markerVal={fwhm?.median_fwhm}
                    markerLabel={fwhm?.median_fwhm != null ? `med=${fwhm.median_fwhm.toFixed(4)}` : null}
                  />
                </div>
                <div>
                  <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>Feature Intensity (log₁₀)</div>
                  <BarChart
                    edges={intHist?.edges} counts={intHist?.counts}
                    color="#a78bfa" xLabel="log₁₀(Intensity)" yLabel="Features"
                  />
                </div>
              </div>
            )}

            {/* diaPASEF window layout */}
            {windowData && (
              <div style={{marginTop:'1rem'}}>
                <div style={{color:'var(--muted)',fontSize:'0.8rem',marginBottom:'0.3rem'}}>
                  diaPASEF Window Layout — m/z × 1/K₀ isolation grid
                  <span style={{marginLeft:'1rem'}}>
                    m/z {windowData.mz_range[0].toFixed(0)}–{windowData.mz_range[1].toFixed(0)} Da
                    {windowData.mobility_range[0] > 0 && ` · 1/K₀ ${windowData.mobility_range[0].toFixed(2)}–${windowData.mobility_range[1].toFixed(2)} Vs/cm²`}
                  </span>
                </div>
                <div style={{background:'var(--bg)',borderRadius:'0.3rem',padding:'0.25rem',border:'1px solid var(--border)'}}>
                  <DiaWindowChart data={windowData} />
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    /* ── Maintenance Event Marker ──────────────────────────────────── */

    function EventMarker({ event }) {
      const [hover, setHover] = useState(false);
      const typeLabels = {
        column_change: 'Column change',
        source_clean: 'Source clean',
        calibration: 'Calibration',
        pm: 'PM',
        lc_service: 'LC service',
        other: 'Other',
      };
      const typeColors = {
        column_change: 'var(--accent)',
        source_clean: 'var(--pass)',
        calibration: 'var(--warn)',
        pm: '#a78bfa',
        lc_service: '#f472b6',
        other: 'var(--muted)',
      };
      const color = typeColors[event.event_type] || 'var(--muted)';
      const label = typeLabels[event.event_type] || event.event_type;
      const dateStr = new Date(event.event_date).toLocaleDateString();

      return (
        <div
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{position:'relative', display:'inline-block'}}
        >
          <div style={{
            width:'2px', height:'100%', minHeight:'1.6rem',
            borderLeft:`2px dashed ${color}`, display:'inline-block', verticalAlign:'middle',
          }} />
          <span style={{
            fontSize:'0.65rem', color, fontWeight:700, marginLeft:'0.2rem',
            verticalAlign:'middle', cursor:'default',
          }}>
            {label}
          </span>
          {hover && (
            <div style={{
              position:'absolute', bottom:'100%', left:0, zIndex:10,
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:'0.4rem', padding:'0.4rem 0.6rem', fontSize:'0.75rem',
              whiteSpace:'nowrap', boxShadow:'0 4px 12px rgba(0,0,0,0.4)',
            }}>
              <div style={{fontWeight:700, color}}>{label}</div>
              <div style={{color:'var(--muted)'}}>{dateStr}</div>
              {event.operator && <div style={{color:'var(--muted)'}}>By: {event.operator}</div>}
              {event.notes && <div style={{color:'var(--text)', marginTop:'0.2rem'}}>{event.notes}</div>}
            </div>
          )}
        </div>
      );
    }

    /* ── LC Traces Tab ──────────────────────────────────────────────── */

    // Colour palette for the traces — same order as _TRACE_MAP in chromatography_lc.py
    const LC_TRACE_STYLES = {
      'Pump Pressure A': { color: '#60a5fa', yaxis: 'pressure' },
      'Pump Pressure B': { color: '#93c5fd', yaxis: 'pressure' },
      'Gradient B':      { color: '#a78bfa', yaxis: 'gradient' },
      'Flow Rate A':     { color: '#34d399', yaxis: 'flow' },
      'Flow Rate B':     { color: '#6ee7b7', yaxis: 'flow' },
      'Column Temp':     { color: '#fbbf24', yaxis: 'temp' },
      'TIC MS1':         { color: '#f472b6', yaxis: 'counts' },
      'TIC MS/MS':       { color: '#fb923c', yaxis: 'counts' },
      'BPC':             { color: '#DAAA00', yaxis: 'counts' },
    };

    function LcTracesTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [traces, setTraces]           = useState(null);
      const [tracesLoading, setTracesLoading] = useState(false);
      const [searchTerm, setSearchTerm]   = useState('');
      const [visibleGroups, setVisibleGroups] = useState({
        pressure: true, gradient: true, flow: false, temp: false, counts: true,
      });

      const pressureRef = useRef(null);
      const gradientRef = useRef(null);
      const flowRef     = useRef(null);
      const tempRef     = useRef(null);
      const countsRef   = useRef(null);

      // Only show .d runs (nanoElute traces live inside .d directories)
      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.raw_path && r.raw_path.endsWith('.d'));
      }, [allRuns]);

      const filtered = useMemo(() => {
        if (!searchTerm) return dRuns;
        const q = searchTerm.toLowerCase();
        return dRuns.filter(r =>
          (r.run_name || '').toLowerCase().includes(q) ||
          (r.instrument || '').toLowerCase().includes(q)
        );
      }, [dRuns, searchTerm]);

      useEffect(() => {
        if (!selectedRun) return;
        setTraces(null);
        setTracesLoading(true);
        fetch(API + `/api/runs/${selectedRun.id}/lc-traces`)
          .then(r => r.ok ? r.json() : {})
          .then(d => { setTraces(Object.keys(d).length ? d : null); setTracesLoading(false); })
          .catch(() => { setTraces(null); setTracesLoading(false); });
      }, [selectedRun?.id]);

      // ── Plotly chart per group ──────────────────────────────────────
      const plotGroup = useCallback((ref, groupKey, yLabel) => {
        if (!ref.current || !traces) return;
        const groupTraces = Object.entries(traces).filter(
          ([name]) => LC_TRACE_STYLES[name]?.yaxis === groupKey
        );
        if (!groupTraces.length) { ref.current.innerHTML = ''; return; }

        const plotData = groupTraces.map(([name, tr]) => ({
          x: tr.times.map(t => +(t / 60).toFixed(2)),  // seconds → minutes
          y: tr.values,
          type: 'scatter',
          mode: 'lines',
          name: `${name} (${tr.unit})`,
          line: { color: LC_TRACE_STYLES[name]?.color || '#a0b4cc', width: 1.5 },
          hovertemplate: `%{y:.3g} ${tr.unit} @ %{x:.2f} min<extra>${name}</extra>`,
        }));

        const layout = {
          paper_bgcolor: 'transparent', plot_bgcolor: '#011a3a',
          font: { color: '#e2e8f0', size: 11 },
          margin: { l: 58, r: 12, t: 12, b: 38 },
          height: 180,
          xaxis: { title: { text: 'RT (min)', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc', zeroline: false },
          yaxis: { title: { text: yLabel, font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc', zeroline: false },
          legend: { font: { size: 10 }, bgcolor: 'transparent', orientation: 'h', y: -0.25 },
          hovermode: 'x unified',
        };

        Plotly.react(ref.current, plotData, layout, { responsive: true, displayModeBar: false });
      }, [traces]);

      useEffect(() => { if (visibleGroups.pressure)  plotGroup(pressureRef, 'pressure',  'Pressure (bar)'); }, [traces, visibleGroups.pressure, plotGroup]);
      useEffect(() => { if (visibleGroups.gradient)  plotGroup(gradientRef, 'gradient',  'Gradient B (%)');  }, [traces, visibleGroups.gradient, plotGroup]);
      useEffect(() => { if (visibleGroups.flow)      plotGroup(flowRef,     'flow',      'Flow (µL/min)');   }, [traces, visibleGroups.flow,     plotGroup]);
      useEffect(() => { if (visibleGroups.temp)      plotGroup(tempRef,     'temp',      'Temp (°C)');       }, [traces, visibleGroups.temp,     plotGroup]);
      useEffect(() => { if (visibleGroups.counts)    plotGroup(countsRef,   'counts',    'Intensity (counts)'); }, [traces, visibleGroups.counts, plotGroup]);

      const toggleGroup = key => setVisibleGroups(v => ({ ...v, [key]: !v[key] }));

      const GROUP_BTNS = [
        { key: 'pressure', label: 'Pressure' },
        { key: 'gradient', label: 'Gradient' },
        { key: 'flow',     label: 'Flow' },
        { key: 'temp',     label: 'Temp' },
        { key: 'counts',   label: 'TIC / BPC' },
      ];

      const hasGroup = key =>
        traces && Object.keys(traces).some(n => LC_TRACE_STYLES[n]?.yaxis === key);

      return (
        <div style={{display:'grid',gridTemplateColumns:'260px 1fr',gap:'1rem',alignItems:'start'}}>

          {/* ── Run selector ── */}
          <div className="card" style={{maxHeight:'80vh',overflowY:'auto'}}>
            <h3 style={{marginBottom:'0.5rem'}}>Run</h3>
            <input
              placeholder="Search runs…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{width:'100%',padding:'0.35rem 0.5rem',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'0.4rem',color:'var(--text)',marginBottom:'0.5rem',fontSize:'0.8rem'}}
            />
            {runsLoading
              ? <div style={{color:'var(--muted)',fontSize:'0.8rem'}}>Loading…</div>
              : filtered.length === 0
                ? <div style={{color:'var(--muted)',fontSize:'0.8rem'}}>No .d runs found</div>
                : filtered.map(r => (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRun(r)}
                      style={{padding:'0.4rem 0.5rem',borderRadius:'0.4rem',cursor:'pointer',fontSize:'0.8rem',
                              background: selectedRun?.id === r.id ? 'var(--accent)' : 'transparent',
                              color:      selectedRun?.id === r.id ? 'var(--bg)'     : 'var(--text)',
                              marginBottom:'0.15rem'}}
                    >
                      <div style={{fontWeight:600}}>{r.run_name || r.id}</div>
                      <div style={{opacity:0.7,fontSize:'0.75rem'}}>{r.instrument} · {(r.run_date||'').slice(0,10)}</div>
                    </div>
                  ))
            }
          </div>

          {/* ── Chart area ── */}
          <div>
            {!selectedRun && (
              <div className="empty">Select a run to view LC system traces</div>
            )}
            {selectedRun && tracesLoading && (
              <div className="empty">Loading traces…</div>
            )}
            {selectedRun && !tracesLoading && !traces && (
              <div className="empty" style={{textAlign:'center'}}>
                <div style={{fontSize:'1.1rem',marginBottom:'0.5rem'}}>No LC trace data</div>
                <div style={{color:'var(--muted)',fontSize:'0.85rem'}}>
                  chromatography-data.sqlite was not found in the .d directory.<br/>
                  Traces are recorded by HyStar / nanoElute — older acquisitions may not have this file.
                </div>
              </div>
            )}
            {selectedRun && !tracesLoading && traces && (
              <>
                <div style={{marginBottom:'0.75rem',display:'flex',gap:'0.5rem',flexWrap:'wrap',alignItems:'center'}}>
                  <span style={{color:'var(--muted)',fontSize:'0.8rem',marginRight:'0.25rem'}}>Show:</span>
                  {GROUP_BTNS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => toggleGroup(key)}
                      disabled={!hasGroup(key)}
                      style={{
                        padding:'0.25rem 0.65rem',
                        fontSize:'0.78rem',
                        background: !hasGroup(key) ? 'var(--border)' : visibleGroups[key] ? 'var(--accent)' : 'var(--surface)',
                        color:      !hasGroup(key) ? 'var(--muted)'  : visibleGroups[key] ? 'var(--bg)'     : 'var(--text)',
                        border: `1px solid ${visibleGroups[key] && hasGroup(key) ? 'var(--accent)' : 'var(--border)'}`,
                        cursor: hasGroup(key) ? 'pointer' : 'default',
                        opacity: hasGroup(key) ? 1 : 0.4,
                      }}
                    >{label}</button>
                  ))}
                  <span style={{marginLeft:'auto',color:'var(--muted)',fontSize:'0.78rem'}}>
                    {selectedRun.run_name}
                  </span>
                </div>

                {visibleGroups.pressure && hasGroup('pressure') && (
                  <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem'}}>
                    <h3 style={{fontSize:'0.85rem',marginBottom:'0.4rem'}}>Pump Pressure</h3>
                    <div ref={pressureRef} />
                  </div>
                )}
                {visibleGroups.gradient && hasGroup('gradient') && (
                  <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem'}}>
                    <h3 style={{fontSize:'0.85rem',marginBottom:'0.4rem'}}>Gradient Profile</h3>
                    <div ref={gradientRef} />
                  </div>
                )}
                {visibleGroups.flow && hasGroup('flow') && (
                  <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem'}}>
                    <h3 style={{fontSize:'0.85rem',marginBottom:'0.4rem'}}>Flow Rate</h3>
                    <div ref={flowRef} />
                  </div>
                )}
                {visibleGroups.temp && hasGroup('temp') && (
                  <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem'}}>
                    <h3 style={{fontSize:'0.85rem',marginBottom:'0.4rem'}}>Column Temperature</h3>
                    <div ref={tempRef} />
                  </div>
                )}
                {visibleGroups.counts && hasGroup('counts') && (
                  <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem'}}>
                    <h3 style={{fontSize:'0.85rem',marginBottom:'0.4rem'}}>TIC / BPC</h3>
                    <div ref={countsRef} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      );
    }

    function TrendCharts({ pinnedRunIds, setPinnedRunIds }) {
      // Pull instruments from actual runs in the DB, not from instruments.yml config
      const { data: allRuns } = useFetch('/api/runs?limit=1000');
      const [selected, setSelected] = useState(null);
      const [trends, setTrends] = useState(null);
      const [events, setEvents] = useState([]);
      const [timeFilter, setTimeFilter] = useState('all');

      const PINNED_KEY = '__pinned__';
      const hasPins = pinnedRunIds && pinnedRunIds.size > 0;

      const names = useMemo(() => {
        if (!allRuns) return [];
        return [...new Set(allRuns.map(r => r.instrument).filter(Boolean))];
      }, [allRuns]);

      // Auto-select "Pinned" when pins arrive; fall back to first instrument otherwise
      useEffect(() => {
        if (hasPins && selected !== PINNED_KEY) setSelected(PINNED_KEY);
        else if (!hasPins && selected === PINNED_KEY) setSelected(names[0] || null);
        else if (names.length && !selected) setSelected(names[0]);
      }, [hasPins, names]);

      // Fetch instrument trends (skip when in pinned mode)
      useEffect(() => {
        if (!selected || selected === PINNED_KEY) return;
        fetch(API + `/api/trends/${encodeURIComponent(selected)}?limit=500`).then(r => r.json()).then(setTrends);
        fetch(API + `/api/instruments/${encodeURIComponent(selected)}/events?limit=50`).then(r => r.json()).then(d => setEvents(d || []));
      }, [selected]);

      // In pinned mode, derive trends from allRuns filtered to pinned IDs
      const pinnedTrends = useMemo(() => {
        if (!hasPins || !allRuns) return null;
        return [...allRuns]
          .filter(r => pinnedRunIds.has(String(r.id)))
          .sort((a, b) => (a.run_date || '').localeCompare(b.run_date || ''));
      }, [hasPins, allRuns, pinnedRunIds]);

      // Filter trends by time range
      const filteredTrends = useMemo(() => {
        const source = selected === PINNED_KEY ? pinnedTrends : trends;
        if (!source) return null;
        if (timeFilter === 'all') return source;
        const now = new Date();
        const cutoffs = { week: 7, month: 30, '3month': 90, '6month': 180, year: 365 };
        const days = cutoffs[timeFilter] || 0;
        if (!days) return source;
        const cutoff = new Date(now.getTime() - days * 86400000);
        return source.filter(r => new Date(r.run_date) >= cutoff);
      }, [trends, pinnedTrends, selected, timeFilter]);

      // Merge events into trend data by finding the nearest run date for each event
      function findEventsBetween(runs, idx) {
        if (!events.length || !runs || !runs.length) return [];
        const runDate = new Date(runs[idx]?.run_date);
        const prevDate = idx > 0 ? new Date(runs[idx - 1]?.run_date) : new Date(0);
        return events.filter(e => {
          const ed = new Date(e.event_date);
          return ed > prevDate && ed <= runDate;
        });
      }

      return (
        <div>
          {/* Instrument selector tabs (+ Pinned virtual tab) */}
          <div className="tabs" style={{marginBottom:'0.6rem'}}>
            {hasPins && (
              <div
                className={`tab ${selected === PINNED_KEY ? 'active' : ''}`}
                onClick={() => setSelected(PINNED_KEY)}
                style={{borderColor: selected === PINNED_KEY ? '#DAAA00' : undefined, color: selected === PINNED_KEY ? '#DAAA00' : '#DAAA00', opacity: selected === PINNED_KEY ? 1 : 0.7}}
              >
                ☆ Pinned ({pinnedRunIds.size})
              </div>
            )}
            {names.length === 0 && !hasPins ? (
              <div style={{color:'var(--muted)'}}>No runs in database yet. Run a baseline first.</div>
            ) : names.map(n => <div key={n} className={`tab ${n === selected ? 'active' : ''}`} onClick={() => setSelected(n)}>{n}</div>)}
          </div>

          {/* Pin-mode banner */}
          {selected === PINNED_KEY && hasPins && (
            <div style={{display:'flex', gap:'0.5rem', alignItems:'center', padding:'0.4rem 0.7rem', marginBottom:'0.75rem', background:'rgba(218,170,0,0.08)', border:'1px solid rgba(218,170,0,0.3)', borderRadius:'0.4rem', fontSize:'0.83rem', flexWrap:'wrap'}}>
              <span style={{color:'#DAAA00', fontWeight:700}}>Pinned view — {pinnedRunIds.size} runs selected in Run History</span>
              <button onClick={() => setPinnedRunIds(new Set())} style={{padding:'0.15rem 0.45rem', fontSize:'0.78rem', background:'transparent', color:'var(--muted)', border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer'}}>Clear pins</button>
            </div>
          )}

          <div style={{display:'flex', gap:'0.5rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'center'}}>
            <span style={{fontSize:'0.85rem', color:'var(--muted)'}}>Time range:</span>
            {[['week','Week'], ['month','Month'], ['3month','3 Months'], ['6month','6 Months'], ['year','Year'], ['all','All']].map(([k, label]) => (
              <button key={k}
                onClick={() => setTimeFilter(k)}
                style={{
                  padding:'0.3rem 0.7rem',
                  background: timeFilter === k ? 'var(--accent)' : 'var(--bg)',
                  color: timeFilter === k ? '#000' : 'var(--text)',
                  border:'1px solid var(--border)',
                  borderRadius:'0.3rem',
                  cursor:'pointer',
                  fontSize:'0.8rem',
                }}>{label}</button>
            ))}
            {filteredTrends && <span style={{fontSize:'0.85rem', color:'var(--muted)', marginLeft:'auto'}}>{filteredTrends.length} runs</span>}
          </div>
          {!filteredTrends || filteredTrends.length === 0
            ? <div className="empty">No trend data for {selected === PINNED_KEY ? 'pinned runs' : (selected || 'this instrument')}.</div>
            : <TrendGraphs runs={filteredTrends} events={selected === PINNED_KEY ? [] : events} />
          }
        </div>
      );
    }

    // Simple SVG sparkline trend component
    function Sparkline({ values, maintEvents, runs, label, color='#60a5fa', height=120 }) {
      if (!values || values.length < 2) {
        return <div style={{color:'var(--muted)', fontSize:'0.8rem'}}>Not enough data</div>;
      }
      const validValues = values.map(v => v == null || isNaN(v) ? 0 : v);
      const min = Math.min(...validValues);
      const max = Math.max(...validValues);
      const range = max - min || 1;
      const width = 800;
      const padding = 10;
      const w = width - padding * 2;
      const h = height - padding * 2;
      const points = validValues.map((v, i) => {
        const x = padding + (validValues.length === 1 ? w/2 : (i / (validValues.length - 1)) * w);
        const y = padding + h - ((v - min) / range) * h;
        return [x, y];
      });
      const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

      // Compute mean for the reference line
      const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;
      const meanY = padding + h - ((mean - min) / range) * h;

      // Find maintenance event positions
      const eventMarks = [];
      if (maintEvents && runs) {
        for (const ev of maintEvents) {
          const evDate = new Date(ev.event_date).getTime();
          // Find the run closest to this event
          let closestIdx = -1;
          let minDist = Infinity;
          runs.forEach((r, i) => {
            const rd = new Date(r.run_date).getTime();
            const dist = Math.abs(rd - evDate);
            if (dist < minDist) { minDist = dist; closestIdx = i; }
          });
          if (closestIdx >= 0 && runs.length > 1) {
            const x = padding + (closestIdx / (runs.length - 1)) * w;
            eventMarks.push({ x, event: ev });
          }
        }
      }

      return (
        <svg viewBox={`0 0 ${width} ${height}`} style={{width:'100%', height:`${height}px`}}>
          {/* Mean reference line */}
          <line x1={padding} y1={meanY} x2={width-padding} y2={meanY} stroke="var(--muted)" strokeDasharray="4,4" strokeWidth="1" opacity="0.4" />
          {/* Event markers */}
          {eventMarks.map((em, i) => {
            const colors = {column_change:'#60a5fa', source_clean:'#22c55e', calibration:'#eab308', pm:'#a78bfa', lc_service:'#f472b6', other:'#94a3b8'};
            const c = colors[em.event.event_type] || '#94a3b8';
            return (
              <g key={i}>
                <line x1={em.x} y1={padding} x2={em.x} y2={height-padding} stroke={c} strokeDasharray="3,3" strokeWidth="2" opacity="0.7">
                  <title>{em.event.event_type}: {em.event.notes || em.event.event_date}</title>
                </line>
              </g>
            );
          })}
          {/* Trend line */}
          <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
          {/* Points */}
          {points.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3" fill={color}>
              <title>{runs?.[i]?.run_name}: {validValues[i].toLocaleString()}</title>
            </circle>
          ))}
          {/* Label */}
          <text x={padding} y={padding+4} fill="var(--muted)" fontSize="11">{label}</text>
          <text x={width-padding} y={padding+4} fill="var(--muted)" fontSize="11" textAnchor="end">
            min: {min.toLocaleString()} · max: {max.toLocaleString()}
          </text>
        </svg>
      );
    }

    function TrendGraphs({ runs, events }) {
      // Sort runs by date ascending for trend plotting
      const sorted = [...runs].sort((a, b) => new Date(a.run_date) - new Date(b.run_date));
      return (
        <div className="grid" style={{gridTemplateColumns:'1fr'}}>
          <div className="card">
            <h3>Precursors / PSMs over time</h3>
            <Sparkline
              values={sorted.map(r => r.n_precursors || r.n_psms || 0)}
              maintEvents={events}
              runs={sorted}
              label="Identifications"
              color="#60a5fa"
            />
          </div>
          <div className="card">
            <h3>IPS Score over time</h3>
            <Sparkline
              values={sorted.map(r => r.ips_score || 0)}
              maintEvents={events}
              runs={sorted}
              label="IPS (0-100)"
              color="#22c55e"
            />
          </div>
          <div className="card">
            <h3>MS1 Signal over time</h3>
            <Sparkline
              values={sorted.map(r => r.ms1_signal || 0)}
              maintEvents={events}
              runs={sorted}
              label="Total MS1 ion current"
              color="#a78bfa"
            />
          </div>
          <div className="card">
            <h3>Peak Width (FWHM) over time</h3>
            <Sparkline
              values={sorted.map(r => r.fwhm_rt_min || 0)}
              maintEvents={events}
              runs={sorted}
              label="FWHM in minutes"
              color="#eab308"
            />
          </div>
          <div style={{fontSize:'0.75rem', color:'var(--muted)', padding:'0.5rem'}}>
            Dashed vertical lines = maintenance events. Hover for details.
          </div>
        </div>
      );
    }

    // ── Shared file-upload helpers ─────────────────────────────────────────
    function fmtBytes(mb) {
      if (mb == null) return '';
      if (mb < 0.1)  return '<0.1 MB';
      if (mb >= 1000) return (mb/1024).toFixed(1) + ' GB';
      return mb.toFixed(1) + ' MB';
    }
    function fmtUploadDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleDateString([], {year:'numeric',month:'short',day:'numeric'}) +
             ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }

    // ── FASTA + Library Manager card ───────────────────────────────────────
    function LibraryManager({ instruments, onAssigned }) {
      const [fastas,       setFastas]       = useState([]);
      const [libs,         setLibs]         = useState([]);
      const [presets,      setPresets]      = useState([]);
      const [organisms,    setOrganisms]    = useState({});
      const [uploading,    setUploading]    = useState({});   // {fasta|lib: true}
      const [dlJobs,       setDlJobs]       = useState({});   // {organism → {status,progress,filename,error}}
      const [showDl,       setShowDl]       = useState(false);
      const [showLibSrc,   setShowLibSrc]   = useState(false);
      const [reviewedOnly, setReviewedOnly] = useState(true);
      const [libMsg,       setLibMsg]       = useState('');
      const [selInst,      setSelInst]      = useState(0);

      const instList = instruments?.instruments || [];

      function loadFastas() {
        fetch(API + '/api/fasta').then(r => r.ok ? r.json() : []).then(setFastas).catch(() => {});
      }
      function loadLibs() {
        fetch(API + '/api/libraries').then(r => r.ok ? r.json() : []).then(setLibs).catch(() => {});
      }
      useEffect(() => {
        loadFastas(); loadLibs();
        fetch(API + '/api/fasta/organisms').then(r => r.ok ? r.json() : {}).then(setOrganisms).catch(() => {});
        fetch(API + '/api/libraries/presets').then(r => r.ok ? r.json() : []).then(setPresets).catch(() => {});
      }, []);

      // Poll any in-progress download jobs every 2 s
      useEffect(() => {
        const running = Object.values(dlJobs).filter(j => j.status === 'queued' || j.status === 'downloading' || j.status === 'adding_decoys' || j.status === 'saving');
        if (!running.length) return;
        const t = setInterval(() => {
          Object.entries(dlJobs).forEach(([org, j]) => {
            if (!j.job_id || j.status === 'done' || j.status === 'failed') return;
            fetch(API + `/api/fasta/download/${j.job_id}`)
              .then(r => r.ok ? r.json() : null)
              .then(d => {
                if (!d) return;
                setDlJobs(prev => ({...prev, [org]: {...prev[org], ...d}}));
                if (d.status === 'done') loadFastas();
              })
              .catch(() => {});
          });
        }, 2000);
        return () => clearInterval(t);
      }, [dlJobs]);

      async function startDownload(organism) {
        setDlJobs(prev => ({...prev, [organism]: {status:'queued', progress:0}}));
        const r = await fetch(API + '/api/fasta/download', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({organism, reviewed_only: reviewedOnly}),
        });
        if (r.ok) {
          const d = await r.json();
          setDlJobs(prev => ({...prev, [organism]: {job_id: d.job_id, status:'queued', progress:0}}));
        } else {
          const err = await r.json().catch(() => ({}));
          setDlJobs(prev => ({...prev, [organism]: {status:'failed', error: err.detail || 'start failed'}}));
        }
      }

      async function handleUpload(e, kind) {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        setUploading(u => ({...u, [kind]: true}));
        setLibMsg('Uploading…');
        const fd = new FormData();
        fd.append('file', file);
        const endpoint = kind === 'fasta' ? '/api/fasta' : '/api/libraries';
        const r = await fetch(API + endpoint, { method: 'POST', body: fd });
        setUploading(u => ({...u, [kind]: false}));
        if (r.ok) {
          setLibMsg(`${file.name} uploaded.`);
          kind === 'fasta' ? loadFastas() : loadLibs();
        } else {
          const err = await r.json().catch(() => ({}));
          setLibMsg(`Upload failed: ${err.detail || r.status}`);
        }
      }

      async function handleDelete(name, kind) {
        if (!confirm(`Delete ${name}?\n\nInstruments using this file will need to be reassigned.`)) return;
        const endpoint = kind === 'fasta' ? `/api/fasta/${encodeURIComponent(name)}` : `/api/libraries/${encodeURIComponent(name)}`;
        const r = await fetch(API + endpoint, { method: 'DELETE' });
        if (r.ok) {
          setLibMsg(`${name} deleted.`);
          kind === 'fasta' ? loadFastas() : loadLibs();
          if (onAssigned) onAssigned();
        } else setLibMsg('Delete failed.');
      }

      async function assignToInstrument(fastaName, libName) {
        if (instList.length === 0) { setLibMsg('No instruments configured.'); return; }
        setLibMsg('Assigning…');
        const body = { instrument_index: selInst };
        if (fastaName !== undefined) body.fasta_path = fastaName || '';
        if (libName   !== undefined) body.lib_path   = libName   || '';
        const r = await fetch(API + '/api/config/assign', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body),
        });
        if (r.ok) {
          const d = await r.json();
          setLibMsg(`Assigned to ${d.instrument}. Takes effect on next search.`);
          if (onAssigned) onAssigned();
        } else {
          const err = await r.json().catch(() => ({}));
          setLibMsg(`Assign failed: ${err.detail || r.status}`);
        }
      }

      const selStyle = {padding:'0.3rem 0.5rem',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'0.4rem',color:'var(--text)',fontSize:'0.82rem'};
      const curInst  = instList[selInst] || {};
      const curFasta = curInst.fasta_path ? curInst.fasta_path.split(/[/\\]/).pop() : null;
      const curLib   = curInst.lib_path   ? curInst.lib_path.split(/[/\\]/).pop()   : null;

      // ── sub-components ────────────────────────────────────────────────────

      function FileRow({ entry, kind }) {
        const isActive = kind === 'fasta' ? entry.name === curFasta : entry.name === curLib;
        return (
          <tr style={{borderBottom:'1px solid var(--border)', background: isActive ? 'rgba(218,170,0,0.06)' : 'transparent'}}>
            <td style={{padding:'0.4rem 0.5rem', maxWidth:'260px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              <span title={entry.name} style={{fontFamily:'monospace', fontSize:'0.8rem', color: isActive ? 'var(--accent)' : 'var(--text)'}}>
                {entry.name}
              </span>
              {isActive && <span style={{marginLeft:'0.4rem',fontSize:'0.65rem',background:'rgba(218,170,0,0.2)',color:'var(--accent)',padding:'0.05rem 0.3rem',borderRadius:'999px',fontWeight:700}}>active</span>}
            </td>
            <td style={{padding:'0.4rem 0.5rem',color:'var(--muted)',fontSize:'0.75rem',whiteSpace:'nowrap'}}>{fmtBytes(entry.size_mb)}</td>
            <td style={{padding:'0.4rem 0.5rem',color:'var(--muted)',fontSize:'0.75rem',whiteSpace:'nowrap'}}>{fmtUploadDate(entry.uploaded)}</td>
            <td style={{padding:'0.4rem 0.5rem',whiteSpace:'nowrap'}}>
              {instList.length > 0 && (
                <button
                  onClick={() => kind === 'fasta' ? assignToInstrument(entry.name, undefined) : assignToInstrument(undefined, entry.name)}
                  title={`Assign to ${curInst.name || 'instrument'}`}
                  style={{padding:'0.15rem 0.45rem',fontSize:'0.72rem',borderRadius:'0.25rem',cursor:'pointer',marginRight:'0.3rem',
                          background: isActive ? 'rgba(218,170,0,0.15)' : 'var(--surface)',
                          color: isActive ? 'var(--accent)' : 'var(--muted)',
                          border:`1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`}}>
                  {isActive ? '✓ Active' : 'Use'}
                </button>
              )}
              <button onClick={() => handleDelete(entry.name, kind)}
                style={{padding:'0.15rem 0.4rem',fontSize:'0.72rem',borderRadius:'0.25rem',cursor:'pointer',
                        background:'none',color:'var(--fail)',border:'1px solid var(--fail)'}}>✕</button>
            </td>
          </tr>
        );
      }

      function DlStatusBadge({ job }) {
        if (!job) return null;
        if (job.status === 'done') return <span style={{color:'var(--pass)',fontSize:'0.7rem'}}>✓ saved</span>;
        if (job.status === 'failed') return <span style={{color:'var(--fail)',fontSize:'0.7rem'}} title={job.error}>✗ failed</span>;
        const label = {queued:'queued',downloading:'↓ downloading',adding_decoys:'building decoys',saving:'saving'}[job.status] || job.status;
        return (
          <span style={{color:'#60a5fa',fontSize:'0.7rem'}}>
            <span style={{display:'inline-block',animation:'spin 1.2s linear infinite',marginRight:'0.2rem'}}>↻</span>
            {label}{job.progress > 0 ? ` ${job.progress}%` : ''}
          </span>
        );
      }

      const ORGANISM_ORDER = ['human','mouse','yeast','ecoli','plasma','zebrafish','celegans','arabidopsis'];

      return (
        <div className="card" style={{marginBottom:'1rem'}}>
          <h3>FASTA Databases &amp; Spectral Libraries</h3>

          {/* Engine compatibility legend */}
          <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',fontSize:'0.75rem',color:'var(--muted)',marginBottom:'1rem',
                       padding:'0.6rem 0.75rem',background:'var(--bg)',borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
            <span style={{fontWeight:600,color:'var(--text)'}}>Used by each engine:</span>
            {[
              {e:'DIA-NN',   fasta:true,  lib:true,  note:'FASTA + library required'},
              {e:'Sage',     fasta:true,  lib:false, note:'FASTA only'},
              {e:'MSFragger',fasta:true,  lib:false, note:'FASTA only'},
              {e:'X!Tandem', fasta:true,  lib:false, note:'FASTA only'},
            ].map(({e,fasta,lib,note}) => (
              <span key={e} title={note}>
                <span style={{color:'var(--text)',fontWeight:500}}>{e}:</span>{' '}
                <span style={{color: fasta ? 'var(--pass)' : 'var(--muted)'}}>FASTA</span>{' '}
                <span style={{color: lib   ? 'var(--pass)' : 'var(--border)'}}>Library</span>
              </span>
            ))}
          </div>

          {/* Instrument selector */}
          {instList.length > 0 && (
            <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.85rem',flexWrap:'wrap'}}>
              <span style={{color:'var(--muted)',fontSize:'0.82rem'}}>Active instrument:</span>
              <select value={selInst} onChange={e => setSelInst(Number(e.target.value))} style={selStyle}>
                {instList.map((inst, i) => <option key={i} value={i}>{inst.name || `Instrument ${i+1}`}</option>)}
              </select>
              <span style={{fontSize:'0.75rem',color:'var(--muted)'}}>
                FASTA: <span style={{color:curFasta?'var(--accent)':'var(--muted)'}}>{curFasta || 'none'}</span>
                {' · '}
                Library: <span style={{color:curLib?'var(--accent)':'var(--muted)'}}>{curLib || 'none'}</span>
              </span>
            </div>
          )}

          {/* ── FASTA section ─────────────────────────────────────────────── */}
          <div style={{marginBottom:'1.25rem'}}>
            <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.6rem',flexWrap:'wrap'}}>
              <span style={{fontWeight:600,fontSize:'0.92rem',color:'var(--text)'}}>FASTA Databases</span>
              {/* UniProt download accordion toggle */}
              <button onClick={() => setShowDl(v => !v)}
                style={{padding:'0.2rem 0.65rem',fontSize:'0.78rem',borderRadius:'0.35rem',cursor:'pointer',
                        background: showDl ? 'rgba(218,170,0,0.15)' : 'var(--surface)',
                        color: showDl ? 'var(--accent)' : 'var(--muted)',
                        border:`1px solid ${showDl ? 'var(--accent)' : 'var(--border)'}`}}>
                {showDl ? '▼' : '▶'} Download from UniProt
              </button>
              <label style={{display:'inline-flex',alignItems:'center',gap:'0.35rem',padding:'0.2rem 0.65rem',
                             background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'0.35rem',
                             cursor:'pointer',fontSize:'0.78rem',color:'var(--muted)'}}>
                {uploading.fasta ? '↻ Uploading…' : '+ Upload .fasta'}
                <input type="file" accept=".fasta,.fa,.fas,.faa" style={{display:'none'}}
                       onChange={e => handleUpload(e, 'fasta')} disabled={!!uploading.fasta} />
              </label>
            </div>

            {/* UniProt download panel */}
            {showDl && (
              <div style={{marginBottom:'0.75rem',padding:'0.75rem',background:'var(--bg)',
                           borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.6rem',flexWrap:'wrap'}}>
                  <span style={{fontSize:'0.8rem',color:'var(--muted)'}}>
                    Downloads reviewed (Swiss-Prot) sequences from UniProt and appends{' '}
                    <code style={{color:'var(--accent)'}}>rev_</code> decoys automatically.
                    Human covers plasma proteome analysis.
                  </span>
                  <label style={{display:'flex',alignItems:'center',gap:'0.3rem',cursor:'pointer',fontSize:'0.78rem',color:'var(--muted)',marginLeft:'auto'}}>
                    <input type="checkbox" checked={reviewedOnly} onChange={e => setReviewedOnly(e.target.checked)}
                           style={{accentColor:'var(--accent)'}} />
                    Reviewed only (recommended)
                  </label>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:'0.4rem'}}>
                  {ORGANISM_ORDER.filter(k => organisms[k]).map(key => {
                    const org = organisms[key];
                    const job = dlJobs[key];
                    const busy = job && (job.status === 'queued' || job.status === 'downloading' || job.status === 'adding_decoys' || job.status === 'saving');
                    // Check if already downloaded today (file exists in fastas list)
                    const alreadyHave = fastas.some(f => f.name.startsWith(key + '_'));
                    return (
                      <div key={key} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.5rem 0.6rem'}}>
                        <div style={{fontWeight:600,fontSize:'0.82rem',color:'var(--text)',marginBottom:'0.1rem'}}>{org.label}</div>
                        <div style={{fontSize:'0.7rem',color:'var(--muted)',marginBottom:'0.35rem',fontStyle:'italic'}}>{org.taxon}</div>
                        <div style={{fontSize:'0.68rem',color:'var(--muted)',marginBottom:'0.4rem'}}>~{(org.n_reviewed/1000).toFixed(0)}k proteins</div>
                        {job ? <DlStatusBadge job={job} /> : alreadyHave ? (
                          <span style={{fontSize:'0.7rem',color:'var(--pass)'}}>✓ have file</span>
                        ) : null}
                        <button disabled={!!busy} onClick={() => startDownload(key)}
                          style={{marginTop:'0.3rem',display:'block',width:'100%',padding:'0.25rem 0',fontSize:'0.75rem',
                                  borderRadius:'0.3rem',cursor:busy?'wait':'pointer',fontWeight:600,
                                  background: busy ? 'var(--border)' : alreadyHave ? 'var(--surface)' : 'rgba(218,170,0,0.2)',
                                  color: busy ? 'var(--muted)' : 'var(--accent)',
                                  border:`1px solid ${busy ? 'var(--border)' : 'var(--accent)'}`,opacity: busy?0.6:1}}>
                          {busy ? 'Downloading…' : alreadyHave ? 'Re-download' : 'Download'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* FASTA file table */}
            {fastas.length === 0 ? (
              <div style={{color:'var(--muted)',fontSize:'0.82rem',padding:'0.4rem 0'}}>No FASTA databases yet — download one above or upload your own.</div>
            ) : (
              <div style={{overflowX:'auto',borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
                <table style={{width:'100%',fontSize:'0.82rem',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'rgba(2,40,81,0.8)'}}>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>File</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Size</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Downloaded / Uploaded</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Action</th>
                    </tr>
                  </thead>
                  <tbody>{fastas.map(f => <FileRow key={f.name} entry={f} kind="fasta" />)}</tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Spectral Library section ───────────────────────────────────── */}
          <div>
            <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.6rem',flexWrap:'wrap'}}>
              <span style={{fontWeight:600,fontSize:'0.92rem',color:'var(--text)'}}>Spectral Libraries</span>
              <button onClick={() => setShowLibSrc(v => !v)}
                style={{padding:'0.2rem 0.65rem',fontSize:'0.78rem',borderRadius:'0.35rem',cursor:'pointer',
                        background: showLibSrc ? 'rgba(218,170,0,0.15)' : 'var(--surface)',
                        color: showLibSrc ? 'var(--accent)' : 'var(--muted)',
                        border:`1px solid ${showLibSrc ? 'var(--accent)' : 'var(--border)'}`}}>
                {showLibSrc ? '▼' : '▶'} Where to get libraries
              </button>
              <label style={{display:'inline-flex',alignItems:'center',gap:'0.35rem',padding:'0.2rem 0.65rem',
                             background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'0.35rem',
                             cursor:'pointer',fontSize:'0.78rem',color:'var(--muted)'}}>
                {uploading.lib ? '↻ Uploading…' : '+ Upload library'}
                <input type="file" accept=".parquet,.speclib,.tsv,.csv,.txt" style={{display:'none'}}
                       onChange={e => handleUpload(e, 'lib')} disabled={!!uploading.lib} />
              </label>
              <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>
                .parquet · .speclib · .tsv · .csv — used by DIA-NN only
              </span>
            </div>

            {/* Library sources panel */}
            {showLibSrc && presets.length > 0 && (
              <div style={{marginBottom:'0.75rem',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'0.5rem'}}>
                {presets.map((p, i) => (
                  <div key={i} style={{padding:'0.65rem 0.75rem',background:'var(--bg)',borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
                    <div style={{fontWeight:600,fontSize:'0.82rem',color:'var(--accent)',marginBottom:'0.25rem'}}>{p.source}</div>
                    <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.35rem',lineHeight:1.4}}>{p.description}</div>
                    <div style={{fontSize:'0.7rem',color:'var(--muted)',marginBottom:'0.3rem'}}>
                      Format: <code style={{color:'var(--text)'}}>{p.format}</code>
                      {' · '}Instrument: <span style={{color:'var(--text)'}}>{p.instrument}</span>
                    </div>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                         style={{fontSize:'0.75rem',color:'#60a5fa',textDecoration:'none'}}>
                        ↗ {p.url_label}
                      </a>
                    ) : (
                      <span style={{fontSize:'0.75rem',color:'var(--pass)'}}>{p.url_label}</span>
                    )}
                    {p.how_to_get === 'browser_download' && (
                      <div style={{fontSize:'0.68rem',color:'var(--muted)',marginTop:'0.25rem'}}>
                        Download in browser → upload with button above
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {libs.length === 0 ? (
              <div style={{color:'var(--muted)',fontSize:'0.82rem',padding:'0.4rem 0'}}>No spectral libraries yet — download from one of the sources above and upload.</div>
            ) : (
              <div style={{overflowX:'auto',borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
                <table style={{width:'100%',fontSize:'0.82rem',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'rgba(2,40,81,0.8)'}}>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>File</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Size</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Downloaded / Uploaded</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Action</th>
                    </tr>
                  </thead>
                  <tbody>{libs.map(l => <FileRow key={l.name} entry={l} kind="lib" />)}</tbody>
                </table>
              </div>
            )}
          </div>

          {libMsg && (
            <div style={{marginTop:'0.75rem',fontSize:'0.82rem',
                         color: libMsg.includes('fail') || libMsg.includes('Error') ? 'var(--fail)' : 'var(--pass)'}}>
              {libMsg}
            </div>
          )}
        </div>
      );
    }

    function ConfigEditor() {
      const { data: instruments, reload: reloadInst } = useFetch('/api/instruments');
      const { data: thresholds, reload: reloadThr } = useFetch('/api/thresholds');
      const [instYaml, setInstYaml] = useState('');
      const [thrYaml, setThrYaml] = useState('');
      const [msg, setMsg] = useState('');
      const [showAdvanced, setShowAdvanced] = useState(false);

      useEffect(() => { if (instruments) setInstYaml(jsyaml(instruments)); }, [instruments]);
      useEffect(() => { if (thresholds) setThrYaml(jsyaml(thresholds)); }, [thresholds]);

      function jsyaml(obj) { return JSON.stringify(obj, null, 2); }

      async function saveInstruments() {
        setMsg('Saving...');
        const r = await fetch(API + '/api/instruments', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ yaml_content: instYaml }) });
        setMsg(r.ok ? 'Instruments saved.' : 'Error saving instruments.');
        reloadInst();
      }
      async function saveThresholds() {
        setMsg('Saving...');
        const r = await fetch(API + '/api/thresholds', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ yaml_content: thrYaml }) });
        setMsg(r.ok ? 'Thresholds saved.' : 'Error saving thresholds.');
        reloadThr();
      }

      // Parse instruments for a friendly summary
      const instList = instruments?.instruments || [];

      return (
        <div>
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Your Instruments</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              STAN auto-detects most settings from your raw files. The only things you configure
              are the watch directory, LC column, and HeLa amount. To change these, edit the
              values below or re-run <code style={{color:'var(--accent)'}}>stan setup</code>.
            </p>
            {instList.length === 0 ? (
              <p style={{color:'var(--warn)'}}>No instruments configured. Run <code>stan setup</code> to add one.</p>
            ) : (
              <div className="grid">
                {instList.map((inst, i) => (
                  <div key={i} style={{padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', position:'relative'}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem'}}>
                      <div style={{fontWeight:700, color:'var(--accent)'}}>
                        {inst.name || 'auto'}
                        {inst.model && <span style={{fontWeight:400, color:'var(--muted)'}}> ({inst.model})</span>}
                      </div>
                      {instList.length > 1 && (
                        <button onClick={async () => {
                          if (!confirm('Remove this instrument from config?')) return;
                          const r = await fetch(API + '/api/instruments/' + i, { method: 'DELETE' });
                          if (r.ok) { setMsg('Instrument removed.'); reloadInst(); }
                          else setMsg('Error removing instrument.');
                        }} style={{background:'none', border:'1px solid var(--fail)', color:'var(--fail)', borderRadius:'0.25rem', padding:'0.15rem 0.5rem', cursor:'pointer', fontSize:'0.75rem'}} title="Remove this instrument">Remove</button>
                      )}
                    </div>
                    <div className="metric"><span className="metric-label">Watch directory</span><span className="metric-value" style={{fontSize:'0.8rem', wordBreak:'break-all'}}>{inst.watch_dir || '(not set)'}</span></div>
                    <div className="metric"><span className="metric-label">LC Column</span><span className="metric-value">{[inst.column_vendor, inst.column_model].filter(Boolean).join(' ') || '(not set)'}</span></div>
                    <div className="metric"><span className="metric-label">HeLa amount</span><span className="metric-value">{inst.hela_amount_ng || 50} ng</span></div>
                    <div className="metric"><span className="metric-label">Community</span><span className="metric-value">{inst.community_submit ? 'Yes' : 'No'}</span></div>
                    {inst.spd && <div className="metric"><span className="metric-label">SPD</span><span className="metric-value">{inst.spd}</span></div>}
                    <div className="metric"><span className="metric-label">Status</span><span className="metric-value" style={{color: inst.enabled !== false ? 'var(--pass)' : 'var(--fail)'}}>{inst.enabled !== false ? 'Enabled' : 'Disabled'}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <LibraryManager instruments={instruments} onAssigned={reloadInst} />

          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Quick Actions</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              Run these commands in a terminal on this machine.
            </p>
            <div style={{display:'flex', gap:'0.5rem', flexWrap:'wrap'}}>
              <div style={{padding:'0.5rem 0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', fontSize:'0.85rem'}}>
                <code style={{color:'var(--accent)'}}>stan setup</code>
                <span style={{color:'var(--muted)', marginLeft:'0.5rem'}}>- reconfigure instrument</span>
              </div>
              <div style={{padding:'0.5rem 0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', fontSize:'0.85rem'}}>
                <code style={{color:'var(--accent)'}}>stan baseline</code>
                <span style={{color:'var(--muted)', marginLeft:'0.5rem'}}>- build QC history from existing files</span>
              </div>
              <div style={{padding:'0.5rem 0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', fontSize:'0.85rem'}}>
                <code style={{color:'var(--accent)'}}>stan log Exploris column-change</code>
                <span style={{color:'var(--muted)', marginLeft:'0.5rem'}}>- record maintenance event</span>
              </div>
              <div style={{padding:'0.5rem 0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', fontSize:'0.85rem'}}>
                <code style={{color:'var(--accent)'}}>stan email-report --test</code>
                <span style={{color:'var(--muted)', marginLeft:'0.5rem'}}>- send a test QC email</span>
              </div>
            </div>
          </div>

          <div style={{marginBottom:'0.5rem'}}>
            <span onClick={() => setShowAdvanced(!showAdvanced)} style={{cursor:'pointer', color:'var(--muted)', fontSize:'0.85rem'}}>
              {showAdvanced ? '▼' : '▶'} Advanced: edit raw YAML config files
            </span>
          </div>
          {showAdvanced && (
            <div className="grid">
              <div className="card">
                <h3>instruments.yml</h3>
                <p style={{color:'var(--muted)', fontSize:'0.75rem', marginBottom:'0.5rem'}}>Instrument watch directories and settings. Hot-reloaded every 30 seconds.</p>
                <textarea value={instYaml} onChange={e => setInstYaml(e.target.value)} />
                <button onClick={saveInstruments} style={{marginTop: '0.5rem'}}>Save Instruments</button>
              </div>
              <div className="card">
                <h3>thresholds.yml</h3>
                <p style={{color:'var(--muted)', fontSize:'0.75rem', marginBottom:'0.5rem'}}>QC pass/warn/fail thresholds per instrument model.</p>
                <textarea value={thrYaml} onChange={e => setThrYaml(e.target.value)} />
                <button onClick={saveThresholds} style={{marginTop: '0.5rem'}}>Save Thresholds</button>
              </div>
              {msg && <div className="status-msg">{msg}</div>}
            </div>
          )}
        </div>
      );
    }

    /* ── CCS Tab ────────────────────────────────────────────────────── */

    function CCSTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [searchTerm, setSearchTerm]   = useState('');
      const [ccsData, setCcsData]         = useState(null);
      const [panelLoading, setPanelLoading] = useState(false);
      const [filterCcs, setFilterCcs]     = useState({min:'', max:''});
      const [filterRt,  setFilterRt]      = useState({min:'', max:''});
      const [hiddenCcsCharges, setHiddenCcsCharges] = useState(new Set());
      const scatterRef    = useRef(null);
      const rtCcsRef      = useRef(null);
      const histRef       = useRef(null);
      const mzCcsHeatRef  = useRef(null);
      const rtCcsHeatRef  = useRef(null);

      const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
      const CHARGE_FILLS  = {0:'rgba(234,179,8,0.12)',1:'rgba(45,212,191,0.12)',2:'rgba(96,165,250,0.12)',3:'rgba(34,197,94,0.12)',4:'rgba(249,115,22,0.12)',5:'rgba(168,85,247,0.12)',6:'rgba(239,68,68,0.12)'};
      const CHARGE_LABEL  = {0:'? unassigned',1:'+1',2:'+2',3:'+3',4:'+4',5:'+5',6:'+6'};

      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.raw_path && r.raw_path.endsWith('.d'));
      }, [allRuns]);

      const filtered = useMemo(() => {
        if (!searchTerm) return dRuns;
        const q = searchTerm.toLowerCase();
        return dRuns.filter(r =>
          (r.run_name || '').toLowerCase().includes(q) ||
          (r.instrument || '').toLowerCase().includes(q)
        );
      }, [dRuns, searchTerm]);

      useEffect(() => {
        if (!selectedRun) { setCcsData(null); return; }
        setPanelLoading(true);
        setCcsData(null);
        setFilterCcs({min:'', max:''});
        setFilterRt({min:'', max:''});
        fetch(API + `/api/runs/${selectedRun.id}/ccs`)
          .then(r => r.ok ? r.json() : {})
          .then(d => { setCcsData(d && d.scatter ? d : null); setPanelLoading(false); })
          .catch(() => setPanelLoading(false));
      }, [selectedRun?.id]);

      // true when server confirmed CCS conversion succeeded; false = show 1/K₀ fallback
      const ccsAvail = ccsData?.ccs_available !== false;

      // Actual data range (used as placeholder hints in filter inputs)
      const dataRange = useMemo(() => {
        if (!ccsData?.scatter) return null;
        const useCcs = ccsData.ccs_available !== false;
        let ccsLo=Infinity, ccsHi=-Infinity, rtLo=Infinity, rtHi=-Infinity;
        for (const pts of Object.values(ccsData.scatter)) {
          const yArr = useCcs ? pts.ccs : pts.im;
          (yArr||[]).forEach(v => { if(v<ccsLo) ccsLo=v; if(v>ccsHi) ccsHi=v; });
          (pts.rt||[]).forEach(v => { if(v<rtLo) rtLo=v; if(v>rtHi) rtHi=v; });
        }
        return {
          ccs: [isFinite(ccsLo)?ccsLo:0, isFinite(ccsHi)?ccsHi:1000],
          rt:  [isFinite(rtLo)?rtLo:0,   isFinite(rtHi)?rtHi:60],
        };
      }, [ccsData]);

      // Apply CCS + RT + charge filters to scatter data (client-side, no re-fetch)
      const filteredScatter = useMemo(() => {
        if (!ccsData?.scatter) return null;
        const useCcs = ccsData.ccs_available !== false;
        const ccsLo = filterCcs.min !== '' ? Number(filterCcs.min) : -Infinity;
        const ccsHi = filterCcs.max !== '' ? Number(filterCcs.max) :  Infinity;
        const rtLo  = filterRt.min  !== '' ? Number(filterRt.min)  : -Infinity;
        const rtHi  = filterRt.max  !== '' ? Number(filterRt.max)  :  Infinity;
        const noRangeFilter = !isFinite(ccsLo) && !isFinite(ccsHi) && !isFinite(rtLo) && !isFinite(rtHi);
        const result = {};
        for (const [z, pts] of Object.entries(ccsData.scatter)) {
          if (hiddenCcsCharges.has(Number(z))) continue;  // charge toggled off
          if (noRangeFilter) { result[z] = pts; continue; }
          const yArr = useCcs ? pts.ccs : pts.im;
          const mzF=[], imF=[], rtF=[], ccsF=[];
          for (let i=0; i<(pts.mz||[]).length; i++) {
            const y = yArr?.[i], r = pts.rt?.[i];
            if (y==null || r==null) continue;
            if (y >= ccsLo && y <= ccsHi && r >= rtLo && r <= rtHi) {
              mzF.push(pts.mz[i]); imF.push(pts.im[i]); rtF.push(r);
              if (pts.ccs) ccsF.push(pts.ccs[i]);
            }
          }
          result[z] = {mz:mzF, im:imF, rt:rtF, ...(pts.ccs?{ccs:ccsF}:{})};
        }
        return result;
      }, [ccsData, filterCcs, filterRt, hiddenCcsCharges]);

      // Recompute histograms client-side from filtered scatter
      const filteredHistograms = useMemo(() => {
        if (!filteredScatter || !ccsData) return null;
        const useCcs = ccsData.ccs_available !== false;
        const BINS = 50;
        const result = {};
        for (const [z, pts] of Object.entries(filteredScatter)) {
          const yArr = useCcs ? pts.ccs : pts.im;
          if (!yArr || yArr.length < 2) continue;
          const vals = [...yArr].sort((a,b)=>a-b);
          const lo=vals[0], hi=vals[vals.length-1];
          if (hi <= lo) continue;
          const step = (hi-lo)/BINS;
          const counts = new Array(BINS).fill(0);
          for (const v of vals) counts[Math.min(Math.floor((v-lo)/step), BINS-1)]++;
          const dp = useCcs ? 1 : 4;
          const edges = Array.from({length:BINS+1}, (_,i) => +(lo+i*step).toFixed(dp));
          result[z] = {edges, counts, median:vals[Math.floor(vals.length/2)], n:vals.length};
        }
        return result;
      }, [filteredScatter, ccsData]);

      const filteredN = useMemo(() => {
        if (!filteredScatter) return 0;
        return Object.values(filteredScatter).reduce((s,pts)=>s+(pts.mz||[]).length, 0);
      }, [filteredScatter]);

      const isFiltered = filterCcs.min!==''||filterCcs.max!==''||filterRt.min!==''||filterRt.max!=='';

      // CCS vs m/z scatter (Plotly)
      useEffect(() => {
        if (!scatterRef.current || !window.Plotly) return;
        if (!filteredScatter) { window.Plotly.purge(scatterRef.current); return; }
        const useCcs = ccsData?.ccs_available !== false;
        const yl = useCcs ? 'CCS (Å²)' : '1/K₀ (Vs/cm²)';
        const yf = useCcs ? '.1f' : '.4f';
        const yu = useCcs ? ' Å²' : '';
        const traces = Object.entries(filteredScatter)
          .sort(([a],[b]) => Number(a)-Number(b))
          .map(([z, pts]) => ({
            type: 'scatter', mode: 'markers',
            name: CHARGE_LABEL[Number(z)] || `z=${z}`,
            x: pts.mz, y: useCcs ? pts.ccs : pts.im,
            marker: { size: 2, color: CHARGE_COLORS[Number(z)] || '#94a3b8', opacity: 0.6, line: {width:0} },
            hovertemplate: `${CHARGE_LABEL[Number(z)]||`z=${z}`}<br>m/z %{x:.3f}<br>${yl.replace(' (Å²)','').replace(' (Vs/cm²)','')} %{y:${yf}}${yu}<extra></extra>`,
          }));
        window.Plotly.react(scatterRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:10,t:10,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:yl,font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.4)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
        }, {responsive:true, displayModeBar:false});
      }, [filteredScatter]);

      // RT vs CCS / RT vs 1/K₀ scatter (Plotly)
      useEffect(() => {
        if (!rtCcsRef.current || !window.Plotly) return;
        if (!filteredScatter) { window.Plotly.purge(rtCcsRef.current); return; }
        const useCcs = ccsData?.ccs_available !== false;
        const yl = useCcs ? 'CCS (Å²)' : '1/K₀ (Vs/cm²)';
        const yf = useCcs ? '.1f' : '.4f';
        const yu = useCcs ? ' Å²' : '';
        const traces = Object.entries(filteredScatter)
          .sort(([a],[b]) => Number(a)-Number(b))
          .filter(([, pts]) => pts.rt && pts.rt.length > 0)
          .map(([z, pts]) => ({
            type: 'scatter', mode: 'markers',
            name: CHARGE_LABEL[Number(z)] || `z=${z}`,
            x: pts.rt, y: useCcs ? pts.ccs : pts.im,
            marker: { size: 2, color: CHARGE_COLORS[Number(z)] || '#94a3b8', opacity: 0.55, line: {width:0} },
            hovertemplate: `${CHARGE_LABEL[Number(z)]||`z=${z}`}<br>RT %{x:.2f} min<br>${yl.replace(' (Å²)','').replace(' (Vs/cm²)','')} %{y:${yf}}${yu}<extra></extra>`,
          }));
        window.Plotly.react(rtCcsRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:10,t:10,b:50},
          xaxis:{title:{text:'RT (min)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:yl,font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.4)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
        }, {responsive:true, displayModeBar:false});
      }, [filteredScatter]);

      // CCS / 1/K₀ distribution histograms (Plotly) — recomputed from filtered scatter
      useEffect(() => {
        if (!histRef.current || !window.Plotly) return;
        if (!filteredHistograms) { window.Plotly.purge(histRef.current); return; }
        const useCcs = ccsData?.ccs_available !== false;
        const yl = useCcs ? 'CCS (Å²)' : '1/K₀ (Vs/cm²)';
        const yf = useCcs ? '.0f' : '.4f';
        const yu = useCcs ? ' Å²' : '';
        const traces = Object.entries(filteredHistograms)
          .sort(([a],[b]) => Number(a)-Number(b))
          .map(([z, h]) => ({
            type: 'scatter', mode: 'lines',
            name: CHARGE_LABEL[Number(z)] || `z=${z}`,
            x: h.edges.slice(0,-1).map((v,i) => (v + h.edges[i+1]) / 2),
            y: h.counts,
            line: { color: CHARGE_COLORS[Number(z)] || '#94a3b8', width: 2 },
            fill: 'tozeroy', fillcolor: CHARGE_FILLS[Number(z)] || 'rgba(148,163,184,0.12)',
            hovertemplate: `${CHARGE_LABEL[Number(z)]||`z=${z}`}<br>${yl.replace(' (Å²)','').replace(' (Vs/cm²)','')} %{x:${yf}}${yu}<br>Count %{y}<extra></extra>`,
          }));
        window.Plotly.react(histRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:50},
          xaxis:{title:{text:yl,font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'Count',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          barmode:'overlay',
          legend:{bgcolor:'rgba(0,0,0,0.4)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
        }, {responsive:true, displayModeBar:false});
      }, [filteredHistograms]);

      // CCS vs m/z density heatmap (all charge states combined) — filtered
      useEffect(() => {
        if (!mzCcsHeatRef.current || !window.Plotly) return;
        if (!filteredScatter) { window.Plotly.purge(mzCcsHeatRef.current); return; }
        const useCcs = ccsData?.ccs_available !== false;
        const yl = useCcs ? 'CCS (Å²)' : '1/K₀ (Vs/cm²)';
        const xAll = [], yAll = [];
        Object.values(filteredScatter).forEach(pts => {
          const ys = useCcs ? pts.ccs : pts.im;
          (pts.mz || []).forEach((v, i) => {
            if (v != null && ys && ys[i] != null) { xAll.push(v); yAll.push(ys[i]); }
          });
        });
        const trace = {
          type: 'histogram2d', x: xAll, y: yAll,
          colorscale: 'Viridis', reversescale: false,
          autobinx: true, autobiny: true,
          colorbar: { thickness: 10, len: 0.75, tickfont: { size: 9, color: '#a0b4cc' }, outlinewidth: 0 },
          hovertemplate: 'm/z %{x:.1f}<br>' + (useCcs ? 'CCS' : '1/K₀') + ' %{y:.2f}<br>Count %{z}<extra></extra>',
        };
        window.Plotly.react(mzCcsHeatRef.current, [trace], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          font: { color: '#94a3b8', size: 11 },
          margin: { l: 60, r: 40, t: 10, b: 50 },
          xaxis: { title: { text: 'm/z (Th)', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          yaxis: { title: { text: yl, font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          hoverlabel: { bgcolor: '#0d1e36', font: { size: 11 } },
        }, { responsive: true, displayModeBar: false });
      }, [filteredScatter]);

      // CCS vs RT density heatmap (all charge states combined) — filtered
      useEffect(() => {
        if (!rtCcsHeatRef.current || !window.Plotly) return;
        if (!filteredScatter) { window.Plotly.purge(rtCcsHeatRef.current); return; }
        const useCcs = ccsData?.ccs_available !== false;
        const yl = useCcs ? 'CCS (Å²)' : '1/K₀ (Vs/cm²)';
        const xAll = [], yAll = [];
        Object.values(filteredScatter).forEach(pts => {
          const ys = useCcs ? pts.ccs : pts.im;
          (pts.rt || []).forEach((v, i) => {
            if (v != null && ys && ys[i] != null) { xAll.push(v); yAll.push(ys[i]); }
          });
        });
        const trace = {
          type: 'histogram2d', x: xAll, y: yAll,
          colorscale: 'Viridis', reversescale: false,
          autobinx: true, autobiny: true,
          colorbar: { thickness: 10, len: 0.75, tickfont: { size: 9, color: '#a0b4cc' }, outlinewidth: 0 },
          hovertemplate: 'RT %{x:.2f} min<br>' + (useCcs ? 'CCS' : '1/K₀') + ' %{y:.2f}<br>Count %{z}<extra></extra>',
        };
        window.Plotly.react(rtCcsHeatRef.current, [trace], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          font: { color: '#94a3b8', size: 11 },
          margin: { l: 60, r: 40, t: 10, b: 50 },
          xaxis: { title: { text: 'RT (min)', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          yaxis: { title: { text: yl, font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          hoverlabel: { bgcolor: '#0d1e36', font: { size: 11 } },
        }, { responsive: true, displayModeBar: false });
      }, [filteredScatter]);

      const medianTable = useMemo(() => {
        if (!filteredHistograms) return null;
        return Object.entries(filteredHistograms)
          .sort(([a],[b]) => Number(a)-Number(b))
          .map(([z, h]) => ({ z: Number(z), median: h.median, n: h.n }));
      }, [filteredHistograms]);

      if (runsLoading) return <div className="empty">Loading runs…</div>;
      if (dRuns.length === 0) return (
        <div className="card">
          <h3>CCS Distribution</h3>
          <p style={{color:'var(--muted)',marginTop:'0.5rem'}}>
            No Bruker .d runs found. CCS values are only available for timsTOF acquisitions.
          </p>
        </div>
      );

      return (
        <div>
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1.25rem'}}>
            <div style={{display:'flex',gap:'2rem',alignItems:'center',flexWrap:'wrap'}}>
              <div>
                <span style={{color:'var(--accent)',fontWeight:700,fontSize:'1.1rem'}}>{dRuns.length}</span>
                {' '}<span style={{color:'var(--muted)',fontSize:'0.85rem'}}>timsTOF run{dRuns.length!==1?'s':''}</span>
              </div>
              <div style={{color:'var(--muted)',fontSize:'0.8rem'}}>
                Ion mobility analytics for timsTOF acquisitions ·
                CCS values computed via Bruker timsdata SDK when available, otherwise 1/K₀ shown directly ·
                select a run to view scatter and per-charge distributions
              </div>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'270px 1fr',gap:'1rem',alignItems:'start'}}>
            {/* Run selector */}
            <div className="card" style={{padding:'0.75rem',position:'sticky',top:'1rem'}}>
              <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>timsTOF Runs</div>
              <input
                type="text" placeholder="Filter by name or instrument…"
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.3rem 0.5rem',fontSize:'0.8rem',marginBottom:'0.5rem'}}
              />
              <div style={{maxHeight:'68vh',overflowY:'auto'}}>
                {filtered.length === 0 && <div style={{color:'var(--muted)',fontSize:'0.8rem',textAlign:'center',padding:'1rem'}}>No matching runs</div>}
                {filtered.map(r => {
                  const sel = selectedRun?.id === r.id;
                  return (
                    <div key={r.id} onClick={() => setSelectedRun(r)}
                      style={{padding:'0.4rem 0.5rem',borderRadius:'0.3rem',cursor:'pointer',marginBottom:'0.1rem',
                              background:sel?'rgba(218,170,0,0.1)':'transparent',
                              borderLeft:sel?'2px solid var(--accent)':'2px solid transparent'}}>
                      <div style={{fontSize:'0.78rem',fontWeight:600,color:sel?'var(--accent)':'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={r.run_name}>
                        {r.run_name}
                      </div>
                      <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem',display:'flex',gap:'0.35rem',alignItems:'center'}}>
                        <span style={{padding:'0.05rem 0.22rem',background:isDia(r.mode)?'#1e3a5f':'#3b1f1f',color:isDia(r.mode)?'#93c5fd':'#fca5a5',borderRadius:'0.2rem',fontSize:'0.65rem',fontWeight:700}}>{r.mode||'?'}</span>
                        <span>{new Date(r.run_date).toLocaleDateString([],{month:'short',day:'numeric',year:'2-digit'})}</span>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'100px'}}>{r.instrument}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Charts */}
            <div>
              {!selectedRun && (
                <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>
                  Select a run to view CCS data
                </div>
              )}
              {selectedRun && panelLoading && (
                <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>
                  Computing CCS values…
                </div>
              )}
              {selectedRun && !panelLoading && !ccsData && (
                <div className="card" style={{padding:'1.5rem',color:'var(--muted)'}}>
                  No CCS data available for this run. The timsdata SDK must be installed and the run must have a DIA-NN report with ion mobility data.
                </div>
              )}
              {ccsData && (
                <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
                  {/* Filter bar */}
                  {dataRange && (() => {
                    const inputSt = {width:'70px',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',padding:'0.2rem 0.4rem',fontSize:'0.78rem',textAlign:'center'};
                    return (
                      <div className="card" style={{padding:'0.6rem 1rem',display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{color:'var(--accent)',fontWeight:600,fontSize:'0.82rem',whiteSpace:'nowrap'}}>Filter</span>
                        <div style={{display:'flex',gap:'0.35rem',alignItems:'center',fontSize:'0.8rem',color:'var(--muted)'}}>
                          <span>{ccsAvail ? 'CCS (Å²)' : '1/K₀'}</span>
                          <input type="number" placeholder={dataRange.ccs[0].toFixed(ccsAvail?0:3)} value={filterCcs.min}
                            onChange={e=>setFilterCcs(f=>({...f,min:e.target.value}))} style={inputSt} />
                          <span>–</span>
                          <input type="number" placeholder={dataRange.ccs[1].toFixed(ccsAvail?0:3)} value={filterCcs.max}
                            onChange={e=>setFilterCcs(f=>({...f,max:e.target.value}))} style={inputSt} />
                        </div>
                        <div style={{display:'flex',gap:'0.35rem',alignItems:'center',fontSize:'0.8rem',color:'var(--muted)'}}>
                          <span>RT (min)</span>
                          <input type="number" placeholder={dataRange.rt[0].toFixed(1)} value={filterRt.min}
                            onChange={e=>setFilterRt(f=>({...f,min:e.target.value}))} style={inputSt} />
                          <span>–</span>
                          <input type="number" placeholder={dataRange.rt[1].toFixed(1)} value={filterRt.max}
                            onChange={e=>setFilterRt(f=>({...f,max:e.target.value}))} style={inputSt} />
                        </div>
                        <div style={{display:'flex',gap:'0.25rem',alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontSize:'0.75rem',color:'var(--muted)',marginRight:'0.1rem'}}>Charge:</span>
                          {(() => {
                            const dataCharges = new Set(Object.keys(ccsData.scatter).map(Number));
                            return [0,1,2,3,4,5,6].filter(z => dataCharges.has(z)).map(z => {
                              const active = !hiddenCcsCharges.has(z);
                              const col = CHARGE_COLORS[z] || '#94a3b8';
                              return (
                                <button key={z}
                                  onClick={() => setHiddenCcsCharges(prev => {
                                    const next = new Set(prev);
                                    if (next.has(z)) next.delete(z); else next.add(z);
                                    return next;
                                  })}
                                  title={active ? `Hide ${CHARGE_LABEL[z]||`z=${z}`}` : `Show ${CHARGE_LABEL[z]||`z=${z}`}`}
                                  style={{
                                    padding:'0.15rem 0.45rem', borderRadius:'0.25rem', cursor:'pointer',
                                    fontSize:'0.75rem', fontWeight:700,
                                    background: active ? col+'33' : 'transparent',
                                    color: active ? col : '#3a4a5a',
                                    border:`1px solid ${active ? col+'88' : '#1e3a5f'}`,
                                    transition:'all 0.12s',
                                  }}>
                                  {CHARGE_LABEL[z]||`z=${z}`}
                                </button>
                              );
                            });
                          })()}
                          {hiddenCcsCharges.size > 0 && (
                            <button onClick={() => setHiddenCcsCharges(new Set())}
                              style={{padding:'0.15rem 0.45rem',fontSize:'0.72rem',background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:'0.25rem',cursor:'pointer'}}>
                              show all
                            </button>
                          )}
                        </div>
                        {(isFiltered || hiddenCcsCharges.size > 0) && (
                          <button onClick={()=>{setFilterCcs({min:'',max:''});setFilterRt({min:'',max:''});setHiddenCcsCharges(new Set());}}
                            style={{padding:'0.2rem 0.6rem',fontSize:'0.75rem',background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:'0.3rem',cursor:'pointer'}}>
                            Reset all
                          </button>
                        )}
                        <span style={{fontSize:'0.75rem',color:(isFiltered||hiddenCcsCharges.size>0)?'var(--warn)':'var(--muted)',marginLeft:'auto',whiteSpace:'nowrap'}}>
                          {(isFiltered||hiddenCcsCharges.size>0) ? `${filteredN.toLocaleString()} / ${ccsData.n_total?.toLocaleString()} precursors` : `${ccsData.n_total?.toLocaleString()} precursors`}
                        </span>
                      </div>
                    );
                  })()}
                  {/* CCS vs m/z scatter */}
                  <div className="card" style={{padding:'1rem'}}>
                    <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>
                      {ccsAvail ? 'CCS vs m/z' : '1/K₀ vs m/z'}
                      {ccsData.n_total && <span style={{fontWeight:400,color:'var(--muted)',fontSize:'0.75rem',marginLeft:'0.5rem'}}>{ccsData.n_total.toLocaleString()} precursors</span>}
                      {!ccsAvail && <span style={{fontWeight:400,color:'#f59e0b',fontSize:'0.72rem',marginLeft:'0.5rem'}}>timsdata SDK unavailable — showing raw 1/K₀</span>}
                    </div>
                    <div ref={scatterRef} style={{height:'380px'}} />
                  </div>

                  {/* RT vs CCS / RT vs 1/K₀ scatter */}
                  <div className="card" style={{padding:'1rem'}}>
                    <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>
                      {ccsAvail ? 'RT vs CCS' : 'RT vs 1/K₀'}
                      <span style={{fontWeight:400,color:'var(--muted)',fontSize:'0.75rem',marginLeft:'0.5rem'}}>
                        {ccsAvail ? 'retention time × collision cross-section' : 'retention time × ion mobility'} · colored by charge
                      </span>
                    </div>
                    <div ref={rtCcsRef} style={{height:'320px'}} />
                  </div>

                  {/* CCS / 1/K₀ distribution */}
                  <div className="card" style={{padding:'1rem'}}>
                    <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>
                      {ccsAvail ? 'CCS Distribution by Charge State' : '1/K₀ Distribution by Charge State'}
                    </div>
                    <div ref={histRef} style={{height:'280px'}} />
                  </div>

                  {/* Density heatmaps — CCS vs m/z and CCS vs RT side by side */}
                  <div className="card" style={{padding:'1rem'}}>
                    <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.75rem'}}>
                      {ccsAvail ? 'CCS' : '1/K₀'} Density Maps
                      <span style={{fontWeight:400,color:'var(--muted)',fontSize:'0.75rem',marginLeft:'0.5rem'}}>
                        all charge states · color = precursor count per bin
                      </span>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
                      <div>
                        <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.25rem',textAlign:'center'}}>
                          {ccsAvail ? 'CCS' : '1/K₀'} vs m/z
                        </div>
                        <div ref={mzCcsHeatRef} style={{height:'300px'}} />
                      </div>
                      <div>
                        <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.25rem',textAlign:'center'}}>
                          {ccsAvail ? 'CCS' : '1/K₀'} vs RT
                        </div>
                        <div ref={rtCcsHeatRef} style={{height:'300px'}} />
                      </div>
                    </div>
                  </div>

                  {/* Median CCS / 1/K₀ table */}
                  {medianTable && (
                    <div className="card" style={{padding:'1rem'}}>
                      <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.75rem'}}>
                        {ccsAvail ? 'Median CCS per Charge State' : 'Median 1/K₀ per Charge State'}
                      </div>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.85rem'}}>
                        <thead>
                          <tr style={{borderBottom:'1px solid var(--border)'}}>
                            <th style={{textAlign:'left',padding:'0.3rem 0.5rem',color:'var(--muted)',fontWeight:500}}>Charge</th>
                            <th style={{textAlign:'right',padding:'0.3rem 0.5rem',color:'var(--muted)',fontWeight:500}}>{ccsAvail ? 'Median CCS (Å²)' : 'Median 1/K₀'}</th>
                            <th style={{textAlign:'right',padding:'0.3rem 0.5rem',color:'var(--muted)',fontWeight:500}}>Precursors</th>
                          </tr>
                        </thead>
                        <tbody>
                          {medianTable.map(row => (
                            <tr key={row.z} style={{borderBottom:'1px solid rgba(30,58,95,0.4)'}}>
                              <td style={{padding:'0.35rem 0.5rem',display:'flex',alignItems:'center',gap:'0.4rem'}}>
                                <span style={{display:'inline-block',width:'10px',height:'10px',borderRadius:'50%',background:CHARGE_COLORS[row.z]||'#94a3b8'}} />
                                <span style={{fontWeight:600}}>z={row.z}</span>
                              </td>
                              <td style={{textAlign:'right',padding:'0.35rem 0.5rem',fontVariantNumeric:'tabular-nums'}}>{ccsAvail ? row.median.toFixed(1) : row.median.toFixed(4)}</td>
                              <td style={{textAlign:'right',padding:'0.35rem 0.5rem',color:'var(--muted)',fontVariantNumeric:'tabular-nums'}}>{row.n.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    /* ── Searches Tab ───────────────────────────────────────────────── */

    function SearchesTab() {
      const [view, setView] = useState('compare');   // 'compare' | 'details'
      const [searches, setSearches] = useState(null);
      const [loading, setLoading]   = useState(true);

      // Fetch + auto-refresh when any comparison is in-flight
      const fetchData = React.useCallback(() => {
        fetch(API + '/api/searches?limit=2000')
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setSearches(d); setLoading(false); })
          .catch(() => setLoading(false));
      }, []);

      React.useEffect(() => { fetchData(); }, [fetchData]);

      React.useEffect(() => {
        const hasInFlight = (searches||[]).some(s => {
          const c = s.comparisons || {};
          return Object.values(c).some(v => v.status === 'running' || v.status === 'pending');
        });
        if (!hasInFlight) return;
        const t = setInterval(fetchData, 8000);
        return () => clearInterval(t);
      }, [searches, fetchData]);

      // ── comparison view state ─────────────────────────────────────────
      const [sortCol, setSortCol]   = useState('run_date');
      const [sortDir, setSortDir]   = useState(-1);
      const [filterMode, setFilterMode] = useState('all');
      const [filterInst, setFilterInst] = useState('all');
      const [search, setSearch]         = useState('');

      // ── details view state ────────────────────────────────────────────
      const [sortColD, setSortColD] = useState('run_date');
      const [sortDirD, setSortDirD] = useState(-1);
      const [showCols, setShowCols] = useState({
        engine:true, version:true, library:true, threads:false,
        precursors:true, peptides:true, proteins:true,
        ms1acc:true, ms2acc:false, fwhm:true,
        ms1sig:false, ms2sig:false, charge:false, mc:false, gate:true, date:true,
      });

      const modes = useMemo(() => [...new Set((searches||[]).map(s=>s.mode).filter(Boolean))], [searches]);
      const insts = useMemo(() => [...new Set((searches||[]).map(s=>s.instrument).filter(Boolean))], [searches]);

      const selStyle = {padding:'0.3rem 0.5rem',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'0.4rem',color:'var(--text)',fontSize:'0.82rem'};
      const MODE_COLOR = { DIA:'#00d4e0', diaPASEF:'#a78bfa', DDA:'#fbbf24', ddaPASEF:'#fb923c' };

      function fmtN(v)    { return v != null ? (+v).toLocaleString() : EM_DASH; }
      function fmtPpm(v)  { return v != null ? (v>=0?'+':'')+v.toFixed(2)+' ppm' : EM_DASH; }
      function fmtFwhm(v) { return v != null ? (v*60).toFixed(0)+' s' : EM_DASH; }
      function fmtSig(v)  {
        if (v==null) return EM_DASH;
        if (v>=1e12) return (v/1e12).toFixed(2)+'T';
        if (v>=1e9)  return (v/1e9).toFixed(2)+'G';
        if (v>=1e6)  return (v/1e6).toFixed(1)+'M';
        return (+v).toLocaleString();
      }
      function libShort(s) {
        if (!s) return EM_DASH;
        return s.replace(/\.(parquet|speclib|tsv)$/,'').replace('hela_','').replace('timstof_','timsTOF ').replace('orbitrap_','Orbitrap ');
      }

      // ── shared filter + sort ──────────────────────────────────────────
      const filtered = useMemo(() => {
        if (!Array.isArray(searches)) return [];
        let r = searches;
        if (filterMode !== 'all') r = r.filter(s => (s.mode||'') === filterMode);
        if (filterInst !== 'all') r = r.filter(s => (s.instrument||'') === filterInst);
        if (search) {
          const q = search.toLowerCase();
          r = r.filter(s => (s.run_name||'').toLowerCase().includes(q) ||
                            (s.instrument||'').toLowerCase().includes(q));
        }
        return r;
      }, [searches, filterMode, filterInst, search]);

      const compareRows = useMemo(() => {
        return [...filtered].sort((a,b) => {
          const av = a[sortCol] ?? (sortDir===-1 ? -Infinity : Infinity);
          const bv = b[sortCol] ?? (sortDir===-1 ? -Infinity : Infinity);
          return sortDir * (av < bv ? -1 : av > bv ? 1 : 0);
        });
      }, [filtered, sortCol, sortDir]);

      const detailRows = useMemo(() => {
        return [...filtered].sort((a,b) => {
          const av = a[sortColD] ?? (sortDirD===-1 ? -Infinity : Infinity);
          const bv = b[sortColD] ?? (sortDirD===-1 ? -Infinity : Infinity);
          return sortDirD * (av < bv ? -1 : av > bv ? 1 : 0);
        });
      }, [filtered, sortColD, sortDirD]);

      function makeTh(col, label, title, activeCol, setActive, dir, setDir) {
        const active = activeCol === col;
        return (
          <th key={col} onClick={() => { if(active) setDir(d=>-d); else{setActive(col);setDir(-1);} }}
            title={title} style={{cursor:'pointer',whiteSpace:'nowrap',userSelect:'none',paddingRight:'0.9rem',
              color: active ? 'var(--accent)' : 'var(--muted)',
              background: active ? 'rgba(218,170,0,0.07)' : 'transparent'}}>
            {label}{active ? (dir===-1?' ▼':' ▲') : ''}
          </th>
        );
      }

      // ── comparison cell ───────────────────────────────────────────────
      function CompCell({ entry, metric, color }) {
        if (!entry) return <td style={{textAlign:'right',color:'var(--border)',fontSize:'0.78rem'}}>—</td>;
        const {status, n_psms, n_peptides, n_proteins, n_precursors, error_msg} = entry;
        // primary ID count: precursors for DIA engines, PSMs for DDA
        const primary = metric === 'precursors' ? (n_precursors ?? n_psms) : n_psms;

        if (status === 'pending') return (
          <td style={{textAlign:'right',color:'var(--muted)',fontSize:'0.75rem'}}>
            <span title="queued — will run automatically after primary search">⋯</span>
          </td>
        );
        if (status === 'running') return (
          <td style={{textAlign:'right'}}>
            <span style={{display:'inline-block',animation:'spin 1.2s linear infinite',
                          color:'#60a5fa',fontSize:'0.85rem'}} title="running comparison search…">↻</span>
          </td>
        );
        if (status === 'failed') return (
          <td style={{textAlign:'right',color:'#ef4444',fontSize:'0.78rem'}}
              title={error_msg||'failed'}>✗ {error_msg ? error_msg.slice(0,30) : 'failed'}</td>
        );
        if (status === 'done') return (
          <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:600,color:color||'var(--text)'}}>
            <div title={`Primary: ${primary??0}  Peptides: ${n_peptides??0}  Protein groups: ${n_proteins??0}`}>
              {fmtN(primary)}
            </div>
            <div style={{fontSize:'0.67rem',color:'var(--muted)',fontWeight:400,lineHeight:1.3}}>
              {n_peptides != null && <span>{fmtN(n_peptides)} pep</span>}
              {n_proteins != null && <span> · {fmtN(n_proteins)} pg</span>}
            </div>
          </td>
        );
        return <td style={{textAlign:'right',color:'var(--border)'}}>—</td>;
      }

      const ColBtn = ({k, label}) => (
        <button onClick={() => setShowCols(c=>({...c,[k]:!c[k]}))}
          style={{padding:'0.15rem 0.45rem',fontSize:'0.71rem',borderRadius:'0.25rem',cursor:'pointer',
                  background: showCols[k] ? 'var(--accent)' : 'var(--surface)',
                  color: showCols[k] ? 'var(--bg)' : 'var(--muted)',
                  border:`1px solid ${showCols[k] ? 'var(--accent)' : 'var(--border)'}`}}>
          {label}
        </button>
      );

      if (loading) return <div className="empty">Loading searches…</div>;
      if (!searches?.length) return <div className="empty">No search results in database yet</div>;

      // count in-flight comparisons for status indicator
      const inFlight = (searches||[]).reduce((n,s) => {
        const c = s.comparisons || {};
        return n + Object.values(c).filter(v=>v.status==='running'||v.status==='pending').length;
      }, 0);
      const done = (searches||[]).reduce((n,s) => {
        const c = s.comparisons || {};
        return n + Object.values(c).filter(v=>v.status==='done').length;
      }, 0);

      return (
        <div>
          {/* view toggle + status bar */}
          <div style={{display:'flex',gap:'0.5rem',alignItems:'center',marginBottom:'0.75rem',flexWrap:'wrap'}}>
            {['compare','details'].map(v => (
              <button key={v} onClick={()=>setView(v)}
                style={{padding:'0.3rem 0.9rem',borderRadius:'0.4rem',cursor:'pointer',fontSize:'0.82rem',fontWeight:600,
                        background: view===v ? 'var(--accent)' : 'var(--surface)',
                        color: view===v ? 'var(--bg)' : 'var(--muted)',
                        border:`1px solid ${view===v ? 'var(--accent)' : 'var(--border)'}`}}>
                {v === 'compare' ? 'Engine Comparison' : 'Primary Search Details'}
              </button>
            ))}
            <span style={{marginLeft:'auto',fontSize:'0.75rem',color:'var(--muted)'}}>
              {done > 0 && <span style={{color:'#34d399',marginRight:'0.5rem'}}>{done} comparisons done</span>}
              {inFlight > 0 && (
                <span style={{color:'#60a5fa'}}>
                  <span style={{display:'inline-block',animation:'spin 1.2s linear infinite'}}>↻</span>
                  {' '}{inFlight} running…
                </span>
              )}
            </span>
          </div>

          {/* shared filter bar */}
          <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',alignItems:'center',marginBottom:'0.75rem'}}>
            <input placeholder="Search runs…" value={search} onChange={e=>setSearch(e.target.value)}
              style={{...selStyle, width:'180px'}} />
            <select value={filterMode} onChange={e=>setFilterMode(e.target.value)} style={selStyle}>
              <option value="all">All modes</option>
              {modes.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterInst} onChange={e=>setFilterInst(e.target.value)} style={selStyle}>
              <option value="all">All instruments</option>
              {insts.map(i=><option key={i} value={i}>{i}</option>)}
            </select>
            <span style={{marginLeft:'auto',fontSize:'0.75rem',color:'var(--muted)'}}>
              {filtered.length} of {searches.length} runs
            </span>
          </div>

          {/* ── Engine Comparison View ─────────────────────────────────── */}
          {view === 'compare' && (
            <div>
              <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.5rem',lineHeight:1.4}}>
                Comparison searches fire automatically after every primary search completes — no action needed.
                Each cell shows the primary ID count (precursors or PSMs) with peptides and protein groups below.
                MSFragger uses E-value &lt; 0.01; X!Tandem uses E-value &lt; 0.01; DIA-NN and Sage use 1% FDR.
                MSFragger requires FragPipe; X!Tandem requires tandem.exe on PATH or a common install location
                (timsconvert auto-converts Bruker .d files).
              </div>
              <div style={{overflowX:'auto',borderRadius:'0.5rem',border:'1px solid var(--border)'}}>
                <table style={{fontSize:'0.8rem',minWidth:'800px'}}>
                  <thead>
                    <tr style={{background:'rgba(2,40,81,0.8)'}}>
                      {makeTh('run_name','Run','Run name',sortCol,setSortCol,sortDir,setSortDir)}
                      {makeTh('instrument','Instrument','Instrument',sortCol,setSortCol,sortDir,setSortDir)}
                      <th style={{color:'var(--muted)',paddingRight:'0.5rem',whiteSpace:'nowrap'}}>Mode</th>
                      {/* DIA primary */}
                      <th style={{textAlign:'right',color:'#60a5fa',paddingRight:'0.75rem',whiteSpace:'nowrap'}}
                          title="DIA-NN primary search — precursors @ 1% FDR · peptides · protein groups">
                        DIA-NN<br/><span style={{fontSize:'0.68rem',fontWeight:400}}>prec · pep · pg</span>
                      </th>
                      <th style={{textAlign:'right',color:'#a78bfa',paddingRight:'0.75rem',whiteSpace:'nowrap'}}
                          title="MSFragger DIA mode — auto after primary · precursors · peptides · protein groups">
                        MSFragger-DIA<br/><span style={{fontSize:'0.68rem',fontWeight:400}}>prec · pep · pg</span>
                      </th>
                      {/* DDA primary */}
                      <th style={{textAlign:'right',color:'#34d399',paddingRight:'0.75rem',whiteSpace:'nowrap'}}
                          title="Sage primary DDA search — PSMs @ 1% FDR · peptides · protein groups">
                        Sage<br/><span style={{fontSize:'0.68rem',fontWeight:400}}>PSMs · pep · pg</span>
                      </th>
                      <th style={{textAlign:'right',color:'#fb923c',paddingRight:'0.75rem',whiteSpace:'nowrap'}}
                          title="MSFragger DDA mode — auto after primary · PSMs · peptides · protein groups">
                        MSFragger-DDA<br/><span style={{fontSize:'0.68rem',fontWeight:400}}>PSMs · pep · pg</span>
                      </th>
                      {/* X!Tandem — runs on any file (DDA mode, DIA data treated as DDA) */}
                      <th style={{textAlign:'right',color:'#e879f9',paddingRight:'0.75rem',whiteSpace:'nowrap'}}
                          title="X!Tandem DDA search — auto after primary · PSMs · peptides · protein groups. Bruker .d files auto-converted via timsconvert.">
                        X!Tandem<br/><span style={{fontSize:'0.68rem',fontWeight:400}}>PSMs · pep · pg</span>
                      </th>
                      {makeTh('gate_result','Gate','QC gate',sortCol,setSortCol,sortDir,setSortDir)}
                      {makeTh('run_date','Date','Acquisition date',sortCol,setSortCol,sortDir,setSortDir)}
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map(s => {
                      const comp = s.comparisons || {};
                      const isRowDia = isDia(s.mode);
                      const prec  = s.stats_precursors ?? s.n_precursors;
                      const psms  = s.n_psms;
                      return (
                        <tr key={s.id} style={{borderBottom:'1px solid var(--border)'}}>
                          <td style={{maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:'0.75rem'}}
                              title={s.run_name}>{s.run_name}</td>
                          <td style={{color:'var(--muted)',fontSize:'0.72rem',whiteSpace:'nowrap',paddingRight:'0.5rem'}}>{s.instrument}</td>
                          <td style={{whiteSpace:'nowrap',paddingRight:'0.5rem'}}>
                            <span style={{padding:'0.08rem 0.35rem',borderRadius:'0.2rem',fontSize:'0.68rem',fontWeight:700,
                                background:(MODE_COLOR[s.mode]||'#a0b4cc')+'22',
                                color:MODE_COLOR[s.mode]||'#a0b4cc'}}>
                              {s.mode||'?'}
                            </span>
                          </td>
                          {/* DIA-NN primary — prec + pep + protein groups */}
                          <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums',
                                      color: isRowDia ? '#60a5fa' : 'var(--muted)',
                                      fontWeight: isRowDia ? 600 : 400, paddingRight:'0.75rem'}}>
                            {isRowDia ? (
                              <>
                                <div>{fmtN(prec)}</div>
                                <div style={{fontSize:'0.67rem',color:'var(--muted)',fontWeight:400,lineHeight:1.3}}>
                                  {s.n_peptides != null && <span>{fmtN(s.n_peptides)} pep</span>}
                                  {s.n_proteins != null && <span> · {fmtN(s.n_proteins)} pg</span>}
                                </div>
                              </>
                            ) : EM_DASH}
                          </td>
                          {/* MSFragger-DIA — auto comparison */}
                          {isRowDia
                            ? <CompCell entry={comp.msfragger_dia} metric="precursors" color="#a78bfa" />
                            : <td style={{textAlign:'right',color:'var(--border)'}}>—</td>
                          }
                          {/* Sage primary — PSMs + pep + protein groups */}
                          <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums',
                                      color: !isRowDia ? '#34d399' : 'var(--muted)',
                                      fontWeight: !isRowDia ? 600 : 400, paddingRight:'0.75rem'}}>
                            {!isRowDia ? (
                              <>
                                <div>{fmtN(psms)}</div>
                                <div style={{fontSize:'0.67rem',color:'var(--muted)',fontWeight:400,lineHeight:1.3}}>
                                  {s.n_peptides_dda != null && <span>{fmtN(s.n_peptides_dda)} pep</span>}
                                  {s.n_proteins != null && <span> · {fmtN(s.n_proteins)} pg</span>}
                                </div>
                              </>
                            ) : EM_DASH}
                          </td>
                          {/* MSFragger-DDA — auto comparison, runs on every file */}
                          <CompCell entry={comp.msfragger_dda} metric="psms" color="#fb923c" />
                          {/* X!Tandem — DDA search on any file; .d auto-converted via timsconvert */}
                          <CompCell entry={comp.xtandem} metric="psms" color="#e879f9" />
                          <td><GateBadge result={s.gate_result} /></td>
                          <td style={{color:'var(--muted)',fontSize:'0.72rem',whiteSpace:'nowrap'}}>
                            {new Date(s.run_date).toLocaleString([],{month:'short',day:'numeric',year:'2-digit',hour:'2-digit',minute:'2-digit'})}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{marginTop:'0.4rem',fontSize:'0.7rem',color:'var(--muted)'}}>
                Comparison searches start automatically after each primary search completes. Cells fill in as results arrive.
                "pg" = protein groups (unique co-identified protein sets).
                MSFragger requires FragPipe · X!Tandem requires tandem.exe (Bruker .d files auto-converted via timsconvert).
              </div>
            </div>
          )}

          {/* ── Primary Search Details View ────────────────────────────── */}
          {view === 'details' && (
            <div>
              {/* column toggles */}
              <div style={{display:'flex',gap:'0.25rem',flexWrap:'wrap',alignItems:'center',marginBottom:'0.5rem'}}>
                <span style={{color:'var(--muted)',fontSize:'0.71rem',marginRight:'0.2rem'}}>Columns:</span>
                {[['engine','Engine'],['version','Version'],['library','Library'],['threads','Threads'],
                  ['precursors','Precursors'],['peptides','Peptides'],['proteins','Proteins'],
                  ['ms1acc','MS1 Acc'],['ms2acc','MS2 Acc'],['fwhm','FWHM'],
                  ['ms1sig','MS1 Sig'],['ms2sig','MS2 Sig'],
                  ['charge','Avg z'],['mc','Missed Clv'],['gate','Gate'],['date','Date'],
                ].map(([k,l])=><ColBtn key={k} k={k} label={l} />)}
              </div>

              <div style={{overflowX:'auto',borderRadius:'0.5rem',border:'1px solid var(--border)'}}>
                <table style={{fontSize:'0.8rem',minWidth:'600px'}}>
                  <thead>
                    <tr style={{background:'rgba(2,40,81,0.8)'}}>
                      {makeTh('run_name','Run','Run name',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {makeTh('instrument','Instrument','Instrument',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.engine    && <th style={{color:'var(--muted)'}}>Engine</th>}
                      {showCols.version   && makeTh('diann_version','Version','Engine version',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.library   && <th style={{color:'var(--muted)'}}>Library</th>}
                      {showCols.threads   && makeTh('diann_threads','Threads','CPU threads',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.precursors && makeTh('stats_precursors','Precursors','Precursors @ 1% FDR',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.peptides  && makeTh('n_peptides','Peptides','Unique peptides',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.proteins  && makeTh('n_proteins','Proteins','Protein groups',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.ms1acc    && makeTh('stats_mass_acc_ms1','MS1 Acc','MS1 mass accuracy',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.ms2acc    && makeTh('stats_mass_acc_ms2','MS2 Acc','MS2 mass accuracy',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.fwhm      && makeTh('stats_fwhm_rt','FWHM','Peak FWHM',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.ms1sig    && makeTh('stats_ms1_signal','MS1 Sig','Total MS1 signal',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.ms2sig    && makeTh('stats_ms2_signal','MS2 Sig','Total MS2 signal',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.charge    && makeTh('stats_avg_charge','Avg z','Avg charge',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.mc        && makeTh('stats_missed_cleavages','MC','Missed cleavages',sortColD,setSortColD,sortDirD,setSortDirD)}
                      {showCols.gate      && <th style={{color:'var(--muted)'}}>Gate</th>}
                      {showCols.date      && makeTh('run_date','Date','Acquisition date',sortColD,setSortColD,sortDirD,setSortDirD)}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map(s => {
                      const prec   = s.stats_precursors ?? s.n_precursors;
                      const ms1acc = s.stats_mass_acc_ms1 ?? s.median_mass_acc_ms1_ppm;
                      const ms2acc = s.stats_mass_acc_ms2 ?? s.median_mass_acc_ms2_ppm;
                      const fwhm   = s.stats_fwhm_rt ?? s.fwhm_rt_min;
                      const ENGINE_COLOR = { diann:'#60a5fa', sage:'#34d399', unknown:'#a0b4cc' };
                      return (
                        <tr key={s.id} style={{borderBottom:'1px solid var(--border)'}}>
                          <td style={{maxWidth:'220px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:'1rem'}}
                              title={s.run_name}>{s.run_name}</td>
                          <td style={{color:'var(--muted)',fontSize:'0.75rem',whiteSpace:'nowrap',paddingRight:'0.75rem'}}>{s.instrument}</td>
                          {showCols.engine && (
                            <td style={{whiteSpace:'nowrap'}}>
                              <span style={{padding:'0.1rem 0.4rem',borderRadius:'0.25rem',fontSize:'0.71rem',fontWeight:700,
                                  background:(ENGINE_COLOR[s.search_engine]||'#a0b4cc')+'22',
                                  color:ENGINE_COLOR[s.search_engine]||'#a0b4cc',
                                  border:`1px solid ${(ENGINE_COLOR[s.search_engine]||'#a0b4cc')}44`}}>
                                {(s.search_engine||'?').toUpperCase()}
                              </span>
                              {s.mode && <span style={{marginLeft:'0.25rem',padding:'0.1rem 0.3rem',borderRadius:'0.2rem',
                                  fontSize:'0.68rem',fontWeight:700,
                                  background:(MODE_COLOR[s.mode]||'#a0b4cc')+'22',
                                  color:MODE_COLOR[s.mode]||'#a0b4cc'}}>
                                {s.mode}
                              </span>}
                            </td>
                          )}
                          {showCols.version  && <td style={{color:'var(--muted)',fontSize:'0.75rem'}}>{s.diann_version||EM_DASH}</td>}
                          {showCols.library  && (
                            <td style={{maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',
                                        whiteSpace:'nowrap',fontSize:'0.72rem',color:'var(--muted)'}}
                                title={s.diann_library}>{libShort(s.diann_library)}</td>
                          )}
                          {showCols.threads  && <td style={{textAlign:'right',color:'var(--muted)'}}>{s.diann_threads??EM_DASH}</td>}
                          {showCols.precursors && <td style={{textAlign:'right',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{fmtN(prec)}</td>}
                          {showCols.peptides  && <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmtN(s.n_peptides)}</td>}
                          {showCols.proteins  && <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmtN(s.n_proteins)}</td>}
                          {showCols.ms1acc   && (
                            <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums',
                                color: ms1acc!=null && Math.abs(ms1acc)>5 ? 'var(--warn)' : 'inherit'}}>
                              {fmtPpm(ms1acc)}
                            </td>
                          )}
                          {showCols.ms2acc   && <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmtPpm(ms2acc)}</td>}
                          {showCols.fwhm     && <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmtFwhm(fwhm)}</td>}
                          {showCols.ms1sig   && <td style={{textAlign:'right',fontSize:'0.75rem',fontVariantNumeric:'tabular-nums'}}>{fmtSig(s.stats_ms1_signal??s.ms1_signal)}</td>}
                          {showCols.ms2sig   && <td style={{textAlign:'right',fontSize:'0.75rem',fontVariantNumeric:'tabular-nums'}}>{fmtSig(s.stats_ms2_signal??s.ms2_signal)}</td>}
                          {showCols.charge   && <td style={{textAlign:'right',color:'var(--muted)'}}>{s.stats_avg_charge?.toFixed(2)??EM_DASH}</td>}
                          {showCols.mc       && <td style={{textAlign:'right',color:'var(--muted)'}}>{s.stats_missed_cleavages?.toFixed(3)??EM_DASH}</td>}
                          {showCols.gate     && <td><GateBadge result={s.gate_result} /></td>}
                          {showCols.date     && <td style={{color:'var(--muted)',fontSize:'0.75rem',whiteSpace:'nowrap'}}>
                            {new Date(s.run_date).toLocaleString([],{year:'2-digit',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                          </td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    }

    function CommunityTab() {
      const { data: submissions, mutate: refetchSubs } = useFetch('/api/community/submissions');
      const [withdrawing, setWithdrawing] = useState(null);   // run_id being confirmed
      const [withdrawMsg, setWithdrawMsg] = useState(null);   // success/info message
      const [sampleFilter, setSampleFilter] = useState('all');
      const [columnFilter, setColumnFilter] = useState('all');

      const SAMPLE_TYPES = ['all','HeLa','K562','HEK293','Jurkat','Yeast','E. coli','Other'];
      const COLUMN_TYPES  = ['all','PepSep Ultra','PepSep Advance','Aurora Series','Evosep EV-1106','Evosep EV-1107','Evosep EV-1108','nanoViper','Other'];

      async function doWithdraw(runId) {
        setWithdrawing(null);
        try {
          const r = await fetch(API + `/api/community/withdraw/${runId}`, {method:'POST'});
          const d = await r.json();
          setWithdrawMsg(d.message || 'Withdrawn.');
          if (typeof refetchSubs === 'function') refetchSubs();
        } catch {
          setWithdrawMsg('Error withdrawing — check server logs.');
        }
      }

      return (
        <div>
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Community Benchmark</h3>
            <p style={{marginBottom:'0.75rem'}}>
              Compare your instrument against labs worldwide. The community dashboard
              is live at:
            </p>
            <a href="https://community.stan-proteomics.org" target="_blank"
               style={{display:'inline-block', padding:'0.6rem 1.2rem', background:'var(--accent)',
                       color:'var(--bg)', borderRadius:'0.5rem', fontWeight:700, fontSize:'1rem',
                       textDecoration:'none', marginBottom:'0.75rem'}}>
              community.stan-proteomics.org
            </a>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginTop:'0.5rem'}}>
              For valid cross-lab comparisons, filter by the same sample type and column —
              comparing HeLa on an Evosep column vs K562 on a PepSep column is not meaningful.
            </p>
          </div>

          {/* Column + Sample filter for benchmark context */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Benchmark Filter Context</h3>
            <p style={{color:'var(--muted)', fontSize:'0.82rem', marginBottom:'0.75rem'}}>
              Select your sample type and column so your data is compared against equivalent setups.
              Mixing sample types or column chemistries will skew rankings.
            </p>
            <div style={{display:'flex', gap:'1rem', flexWrap:'wrap', alignItems:'center'}}>
              <div>
                <label style={{fontSize:'0.8rem', color:'var(--muted)', display:'block', marginBottom:'0.25rem'}}>Sample Type</label>
                <select value={sampleFilter} onChange={e => setSampleFilter(e.target.value)}
                  style={{background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)',
                          borderRadius:'0.4rem', padding:'0.35rem 0.6rem', fontSize:'0.85rem', cursor:'pointer'}}>
                  {SAMPLE_TYPES.map(s => <option key={s} value={s}>{s === 'all' ? 'All Samples' : s}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:'0.8rem', color:'var(--muted)', display:'block', marginBottom:'0.25rem'}}>Column</label>
                <select value={columnFilter} onChange={e => setColumnFilter(e.target.value)}
                  style={{background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)',
                          borderRadius:'0.4rem', padding:'0.35rem 0.6rem', fontSize:'0.85rem', cursor:'pointer'}}>
                  {COLUMN_TYPES.map(c => <option key={c} value={c}>{c === 'all' ? 'All Columns' : c}</option>)}
                </select>
              </div>
              {(sampleFilter !== 'all' || columnFilter !== 'all') && (
                <div style={{fontSize:'0.78rem', color:'var(--accent)', marginTop:'1rem'}}>
                  Filtering: {sampleFilter !== 'all' ? sampleFilter : 'any sample'} · {columnFilter !== 'all' ? columnFilter : 'any column'}
                </div>
              )}
            </div>
          </div>

          {/* Shared runs + withdraw */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem'}}>
              <h3 style={{margin:0}}>Your Shared Runs</h3>
              <span style={{fontSize:'0.8rem', color:'var(--muted)'}}>
                {Array.isArray(submissions) ? submissions.length : 0} submitted
              </span>
            </div>

            {withdrawMsg && (
              <div style={{background:'rgba(234,179,8,0.1)', border:'1px solid rgba(234,179,8,0.3)', borderRadius:'0.4rem',
                           padding:'0.6rem 0.9rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'var(--warn)'}}>
                {withdrawMsg}
                <button onClick={() => setWithdrawMsg(null)}
                  style={{marginLeft:'0.75rem', background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:'0.8rem'}}>
                  Dismiss
                </button>
              </div>
            )}

            {!Array.isArray(submissions) || submissions.length === 0 ? (
              <div style={{color:'var(--muted)', fontSize:'0.85rem', padding:'1rem 0'}}>
                No runs submitted yet. Run <code style={{color:'var(--accent)'}}>stan baseline</code> to share your first run.
              </div>
            ) : (
              <div style={{display:'flex', flexDirection:'column', gap:'0.4rem'}}>
                {submissions.map(run => (
                  <div key={run.id} style={{display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.5rem 0.75rem',
                       background:'var(--bg)', borderRadius:'0.4rem', border:'1px solid var(--border)'}}>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:'0.82rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{run.run_name}</div>
                      <div style={{fontSize:'0.72rem', color:'var(--muted)', marginTop:'0.1rem'}}>
                        {run.instrument} · {new Date(run.run_date).toLocaleDateString([],{month:'short',day:'numeric',year:'2-digit'})}
                        {run.n_precursors ? ` · ${run.n_precursors.toLocaleString()} precursors` : run.n_psms ? ` · ${run.n_psms.toLocaleString()} PSMs` : ''}
                      </div>
                    </div>
                    {run.submission_id && (
                      <div style={{fontSize:'0.7rem', color:'var(--muted)', fontFamily:'monospace', flexShrink:0}}>
                        {run.submission_id.slice(0,8)}
                      </div>
                    )}
                    {withdrawing === run.id ? (
                      <div style={{display:'flex', gap:'0.4rem', alignItems:'center', flexShrink:0}}>
                        <span style={{fontSize:'0.75rem', color:'var(--warn)'}}>Stop sharing?</span>
                        <button onClick={() => doWithdraw(run.id)}
                          style={{padding:'0.25rem 0.6rem', background:'rgba(239,68,68,0.15)', color:'#ef4444',
                                  border:'1px solid rgba(239,68,68,0.4)', borderRadius:'0.3rem', cursor:'pointer', fontSize:'0.75rem', fontWeight:600}}>
                          Confirm
                        </button>
                        <button onClick={() => setWithdrawing(null)}
                          style={{padding:'0.25rem 0.5rem', background:'var(--surface)', color:'var(--muted)',
                                  border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer', fontSize:'0.75rem'}}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setWithdrawing(run.id)}
                        style={{padding:'0.25rem 0.6rem', background:'rgba(234,179,8,0.08)', color:'var(--warn)',
                                border:'1px solid rgba(234,179,8,0.3)', borderRadius:'0.3rem', cursor:'pointer',
                                fontSize:'0.75rem', fontWeight:600, flexShrink:0, whiteSpace:'nowrap'}}>
                        Stop sharing
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{marginTop:'0.75rem', fontSize:'0.75rem', color:'var(--muted)', borderTop:'1px solid var(--border)', paddingTop:'0.6rem'}}>
              "Stop sharing" removes the run from your local list immediately. To permanently delete it from the
              public dataset, email <a href="mailto:bsphinney@ucdavis.edu" style={{color:'var(--accent)'}}>bsphinney@ucdavis.edu</a> with the submission ID.
            </div>
          </div>

          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Learn Proteomics</h3>
            <p style={{marginBottom:'0.5rem'}}>
              Want hands-on training with the instruments and techniques behind STAN?
            </p>
            <a href="https://proteomics.ucdavis.edu/events/hands-proteomics-short-course" target="_blank"
               style={{color:'var(--accent)', textDecoration:'none', fontWeight:600}}>
              UC Davis Hands-on Proteomics Short Course →
            </a>
            <p style={{color:'var(--muted)', fontSize:'0.8rem', marginTop:'0.3rem'}}>
              Annual course covering sample prep, LC-MS, DIA, data analysis, and more.
            </p>
          </div>
        </div>
      );
    }

    /* ── Immunopeptidomics Tab ─────────────────────────────────────────── */

    function ImmunopeptidomicsTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [searchTerm, setSearchTerm] = useState('');
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(false);
      const [mhcClass, setMhcClass] = useState('all');   // 'all' | 'mhc1' | 'mhc2'
      const [chargeFilter, setChargeFilter] = useState('all');
      const [immunoWindowData, setImmunoWindowData] = useState(null);
      const [showImmunoWindowOverlay, setShowImmunoWindowOverlay] = useState(false);
      // View 3 — Raw MHC Ion Landscape (lazy-loaded on demand)
      const [landscape, setLandscape] = useState(null);
      const [landscapeLoading, setLandscapeLoading] = useState(false);
      const [showLandscape, setShowLandscape] = useState(false);
      const lenPlotRef    = useRef(null);
      const cloudRef      = useRef(null);
      const ridgeRef      = useRef(null);   // View 1: Length × Mobility Ridge
      const gravyRef      = useRef(null);   // View 2: GRAVY × Mobility
      const radarRef      = useRef(null);   // View 2b: Fingerprint Radar
      const landscapeRef  = useRef(null);   // View 3: Raw MHC Ion Landscape
      const motifRef      = useRef(null);   // Sequence Motif Heatmap
      const [motifLen, setMotifLen] = useState('9');

      const WIN_PALETTE_I = ['#3b82f6','#22c55e','#f97316','#a855f7','#06b6d4','#f59e0b','#ec4899','#14b8a6'];
      const winColorI = (groupIdx) => WIN_PALETTE_I[groupIdx % WIN_PALETTE_I.length];

      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.result_path || (r.raw_path && r.raw_path.endsWith('.d')));
      }, [allRuns]);

      const filtered = useMemo(() => {
        if (!searchTerm) return dRuns;
        const q = searchTerm.toLowerCase();
        return dRuns.filter(r =>
          (r.run_name || '').toLowerCase().includes(q) ||
          (r.instrument || '').toLowerCase().includes(q)
        );
      }, [dRuns, searchTerm]);

      useEffect(() => {
        if (!selectedRun) {
          setData(null); setImmunoWindowData(null); setShowImmunoWindowOverlay(false);
          setLandscape(null); setShowLandscape(false);
          return;
        }
        setLoading(true); setData(null); setImmunoWindowData(null);
        setShowImmunoWindowOverlay(false); setLandscape(null); setShowLandscape(false);
        Promise.all([
          fetch(API + `/api/runs/${selectedRun.id}/immunopeptidomics`).then(r => r.ok ? r.json() : {}),
          selectedRun.raw_path?.endsWith('.d')
            ? fetch(API + `/api/runs/${selectedRun.id}/dia-windows`).then(r => r.ok ? r.json() : {})
            : Promise.resolve({}),
        ]).then(([d, wins]) => {
          setData(Object.keys(d).length > 0 ? d : null);
          setImmunoWindowData(wins?.windows?.length > 0 ? wins : null);
          setLoading(false);
        }).catch(() => setLoading(false));
      }, [selectedRun?.id]);

      // Lazy-load raw ion landscape when user opens it
      useEffect(() => {
        if (!showLandscape || !selectedRun || landscape !== null) return;
        if (!selectedRun.raw_path?.endsWith('.d')) return;
        setLandscapeLoading(true);
        fetch(API + `/api/runs/${selectedRun.id}/immuno-landscape`)
          .then(r => r.ok ? r.json() : {})
          .then(d => { setLandscape(Object.keys(d).length > 0 ? d : null); setLandscapeLoading(false); })
          .catch(() => setLandscapeLoading(false));
      }, [showLandscape, selectedRun?.id]);

      // Length distribution bar chart
      useEffect(() => {
        if (!data?.length_dist || !lenPlotRef.current) return;
        const dist = data.length_dist;
        const allLens = Object.keys(dist).map(Number).sort((a,b)=>a-b);
        const mhc1Color = '#60a5fa', mhc2Color = '#a855f7', otherColor = '#4a6070';

        const colors = allLens.map(l =>
          (l >= 8 && l <= 14) ? mhc1Color :
          (l >= 13 && l <= 25) ? mhc2Color : otherColor
        );

        Plotly.react(lenPlotRef.current, [{
          type: 'bar',
          x: allLens,
          y: allLens.map(l => dist[l] || 0),
          marker: { color: colors },
          hovertemplate: 'Length %{x}aa: %{y} peptides<extra></extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font: {color:'#94a3b8', size:11},
          margin: {l:50,r:10,t:30,b:40},
          xaxis: {title:{text:'Peptide Length (aa)',font:{size:11}}, gridcolor:'#1e3a5f',
            tickmode:'linear', dtick:1, range:[5.5, Math.min(31, Math.max(...allLens)+1.5)]},
          yaxis: {title:{text:'Precursors @ 1% FDR',font:{size:11}}, gridcolor:'#1e3a5f'},
          shapes: [
            {type:'rect', x0:7.5, x1:14.5, y0:0, y1:1, yref:'paper', fillcolor:'rgba(96,165,250,0.06)', line:{width:0}},
            {type:'rect', x0:12.5, x1:25.5, y0:0, y1:1, yref:'paper', fillcolor:'rgba(168,85,247,0.06)', line:{width:0}},
          ],
          annotations: [
            {x:11, y:1.04, xref:'x', yref:'paper', text:'MHC-I (8-14aa)', showarrow:false, font:{color:'#60a5fa',size:10}},
            {x:19, y:1.04, xref:'x', yref:'paper', text:'MHC-II (13-25aa)', showarrow:false, font:{color:'#a855f7',size:10}},
          ],
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // m/z vs 1/K₀ ion cloud (Tenzer-style) — with optional diaPASEF window overlay
      useEffect(() => {
        if (!data?.top_peptides || !cloudRef.current) return;
        const peps = data.top_peptides;
        const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
        const charges = [...new Set(peps.map(p => p.charge))].sort((a,b)=>a-b);
        const traces = charges.map(z => {
          const pts = peps.filter(p => p.charge === z);
          return {
            type: 'scatter',
            mode: 'markers',
            name: z === 1 ? 'z=+1 (MHC-I)' : `z=${z}`,
            x: pts.map(p => p.mz),
            y: pts.map(p => p.mobility),
            marker: {size: z === 1 ? 7 : 5, color:CHARGE_COLORS[z]||'#94a3b8', opacity: z === 1 ? 0.8 : 0.65},
            hovertemplate: `%{customdata}<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>z=${z}<extra></extra>`,
            customdata: pts.map(p => p.sequence),
          };
        });

        // diaPASEF window overlay shapes
        const shapes = [];
        if (showImmunoWindowOverlay && immunoWindowData?.windows?.length) {
          const groups = [...new Set(immunoWindowData.windows.map(w => w.window_group))];
          immunoWindowData.windows.forEach(ww => {
            if (ww.oneoverk0_lower <= 0) return;
            const col = winColorI(groups.indexOf(ww.window_group));
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            shapes.push({
              type:'rect',
              x0: ww.mz_lower, x1: ww.mz_upper,
              y0: ww.oneoverk0_lower, y1: ww.oneoverk0_upper,
              fillcolor: `rgba(${r},${g},${b},0.10)`,
              line: { color: `rgba(${r},${g},${b},0.70)`, width: 1.2 },
            });
          });
        }

        Plotly.react(cloudRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font: {color:'#94a3b8', size:11},
          margin: {l:55,r:15,t:10,b:45},
          xaxis: {title:{text:'m/z (Th)',font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          yaxis: {title:{text:'1/K₀ (Vs/cm²)',font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          legend: {bgcolor:'rgba(0,0,0,0.3)', bordercolor:'#1e3a5f', borderwidth:1, font:{size:10}},
          hoverlabel: {bgcolor:'#0d1e36', font:{size:11}},
          shapes,
        }, {responsive:true, displayModeBar:false});
      }, [data, showImmunoWindowOverlay, immunoWindowData]);

      // ── View 1: Length × Mobility Ridge ────────────────────────────────
      useEffect(() => {
        const agg = data?.length_mobility_agg;
        if (!agg || !ridgeRef.current) return;
        const lengths = Object.keys(agg).map(Number).filter(l => l >= 6 && l <= 26).sort((a,b) => a-b);
        if (lengths.length === 0) return;
        const MHC1_COLOR = '#60a5fa', MHC2_COLOR = '#a855f7', OTHER = '#4a6070';
        const boxColor = l => (l >= 8 && l <= 14) ? MHC1_COLOR : (l > 14 && l <= 25) ? MHC2_COLOR : OTHER;
        const traces = [{
          type: 'box',
          q1:         lengths.map(l => agg[l].q25_im ?? agg[l].median_im),
          median:     lengths.map(l => agg[l].median_im),
          q3:         lengths.map(l => agg[l].q75_im ?? agg[l].median_im),
          mean:       lengths.map(l => agg[l].mean_im),
          lowerfence: lengths.map(l => Math.max(0.4, (agg[l].mean_im||0) - 2*(agg[l].std_im||0))),
          upperfence: lengths.map(l => (agg[l].mean_im||0) + 2*(agg[l].std_im||0)),
          x:          lengths.map(String),
          marker:     { color: lengths.map(boxColor), size: 4 },
          line:       { color: '#1e3a5f' },
          boxmean:    true,
          name:       '1/K₀',
          hovertemplate: 'Length %{x}aa<br>Median: %{median:.4f}<br>IQR: %{q1:.4f}–%{q3:.4f}<br>n=%{customdata}<extra></extra>',
          customdata: lengths.map(l => agg[l].n),
        }];
        Plotly.react(ridgeRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font: {color:'#94a3b8', size:11},
          margin: {l:55,r:15,t:30,b:40},
          xaxis: {title:{text:'Peptide Length (aa)',font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          yaxis: {title:{text:'1/K₀ (Vs/cm²)',font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          annotations: [
            {x:'11', y:1.06, xref:'x', yref:'paper', text:'MHC-I (8–14aa)', showarrow:false, font:{color:'#60a5fa',size:10}},
            {x:'19', y:1.06, xref:'x', yref:'paper', text:'MHC-II (13–25aa)', showarrow:false, font:{color:'#a855f7',size:10}},
          ],
          shapes: [
            {type:'rect',x0:'7.5',x1:'14.5',y0:0,y1:1,xref:'x',yref:'paper',fillcolor:'rgba(96,165,250,0.05)',line:{width:0}},
            {type:'rect',x0:'12.5',x1:'25.5',y0:0,y1:1,xref:'x',yref:'paper',fillcolor:'rgba(168,85,247,0.05)',line:{width:0}},
          ],
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // ── View 2: GRAVY × Mobility Landscape ─────────────────────────────
      useEffect(() => {
        const cloud = data?.gravy_cloud;
        if (!cloud?.length || !gravyRef.current) return;
        const LEN_COLORS = {
          7:'#475569', 8:'#3b82f6', 9:'#22c55e', 10:'#84cc16', 11:'#fbbf24',
          12:'#f97316', 13:'#ef4444', 14:'#e879f9', 15:'#a855f7',
        };
        const colorOf = l => LEN_COLORS[l] || (l >= 16 ? '#7c3aed' : '#475569');
        const byLen = {};
        for (const pt of cloud) {
          (byLen[pt.length] = byLen[pt.length] || []).push(pt);
        }
        const sortedLens = Object.keys(byLen).map(Number).sort((a,b)=>a-b);
        const traces = sortedLens.map(l => {
          const pts = byLen[l];
          return {
            type:'scatter', mode:'markers',
            name:`${l}aa`,
            x: pts.map(p => p.gravy),
            y: pts.map(p => p.im),
            marker:{size:5, color:colorOf(l), opacity:0.75},
            hovertemplate:`%{customdata}<br>GRAVY %{x:.3f}<br>1/K₀ %{y:.4f}<extra>${l}aa</extra>`,
            customdata: pts.map(p => p.seq),
          };
        });
        Plotly.react(gravyRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:15,t:20,b:45},
          xaxis:{title:{text:'GRAVY Score (Kyte-Doolittle)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc',zeroline:true,zerolinecolor:'#334155'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.3)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes:[{type:'line',x0:0,x1:0,y0:0,y1:1,yref:'paper',line:{color:'#334155',width:1,dash:'dot'}}],
          annotations:[
            {x:-2,y:1.06,xref:'x',yref:'paper',text:'← Hydrophilic',showarrow:false,font:{color:'#64748b',size:9}},
            {x:2,y:1.06,xref:'x',yref:'paper',text:'Hydrophobic →',showarrow:false,font:{color:'#64748b',size:9}},
          ],
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // ── View 2b: Immunopeptidome Fingerprint Radar ──────────────────────
      useEffect(() => {
        const r = data?.radar;
        if (!r || !radarRef.current) return;
        const mhc1Score  = Math.min(100, (r.pct_mhc1 || 0) * 100/80);
        const z1Score    = Math.min(100, (r.pct_z1 || 0) * 100/65);
        const ninerScore = Math.min(100, (r.pct_9mer_mhc1 || 0) * 100/40);
        const mobScore   = r.mobility_cv != null ? Math.max(0, 100 - r.mobility_cv * 8) : 0;
        const dynScore   = r.dyn_range_db != null ? Math.min(100, r.dyn_range_db * 100/60) : 0;
        const scores = [mhc1Score, z1Score, ninerScore, mobScore, dynScore, mhc1Score];
        const AXES = ['MHC-I purity','z=+1 fraction','9-mer dominance','Mobility focus','Dynamic range'];
        const HOVER = [
          `MHC-I purity: ${(r.pct_mhc1||0).toFixed(1)}% (ideal >80%)`,
          `z=+1 fraction: ${(r.pct_z1||0).toFixed(1)}% (ideal >65%)`,
          `9-mer of MHC-I: ${(r.pct_9mer_mhc1||0).toFixed(1)}% (ideal >40%)`,
          `Mobility CV: ${r.mobility_cv != null ? r.mobility_cv.toFixed(1)+'%' : 'N/A'} (lower=tighter)`,
          `Dynamic range: ${r.dyn_range_db != null ? r.dyn_range_db.toFixed(0)+'dB' : 'N/A'}`,
        ];
        Plotly.react(radarRef.current, [{
          type:'scatterpolar', fill:'toself',
          r: scores,
          theta: [...AXES, AXES[0]],
          fillcolor:'rgba(96,165,250,0.15)',
          line:{color:'#60a5fa',width:2},
          marker:{size:6, color:'#60a5fa'},
          name:'This run',
          hovertemplate:'%{customdata}<extra></extra>',
          customdata:[...HOVER, HOVER[0]],
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:10},
          margin:{l:30,r:30,t:30,b:30},
          polar:{
            bgcolor:'transparent',
            radialaxis:{visible:true,range:[0,100],color:'#334155',gridcolor:'#1e3a5f',tickfont:{size:9}},
            angularaxis:{color:'#4a6070',gridcolor:'#1e3a5f',linecolor:'#334155',tickfont:{size:10}},
          },
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // ── View 3: Raw MHC Ion Landscape ───────────────────────────────────
      useEffect(() => {
        if (!landscape || !landscapeRef.current) return;
        const {grid, mz_centers, im_centers, identified, n_frames_sampled} = landscape;
        const MHC_LEN_COLORS = {1:'#fbbf24',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7'};
        const traces = [
          {
            type:'heatmap',
            z: grid,
            x: mz_centers,
            y: im_centers,
            colorscale:[
              [0,'rgba(0,0,0,0)'],[0.01,'#0c0c20'],[0.15,'#1e3a5f'],
              [0.4,'#1d4ed8'],[0.65,'#7c3aed'],[0.85,'#ec4899'],[1,'#fde68a'],
            ],
            zmin:0, zmax:1, showscale:false,
            hovertemplate:'m/z %{x:.1f}<br>1/K₀ %{y:.3f}<br>Intensity (norm.) %{z:.3f}<extra>Raw ions</extra>',
          },
        ];
        if (identified?.length) {
          const byCharge = {};
          for (const p of identified) {
            (byCharge[p.charge] = byCharge[p.charge] || []).push(p);
          }
          for (const [z, pts] of Object.entries(byCharge).sort((a,b)=>+a[0]-+b[0])) {
            traces.push({
              type:'scatter', mode:'markers',
              name:`Identified z=+${z}`,
              x: pts.map(p => p.mz),
              y: pts.map(p => p.im),
              marker:{
                size: +z === 1 ? 7 : 5,
                color: MHC_LEN_COLORS[+z] || '#94a3b8',
                opacity: 0.85,
                line:{color:'rgba(0,0,0,0.4)',width:0.5},
              },
              hovertemplate:`%{customdata}<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra>z=+${z}</extra>`,
              customdata: pts.map(p => `${p.seq} (${p.length}aa)`),
            });
          }
        }
        Plotly.react(landscapeRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:20,t:15,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'rgba(30,58,95,0.4)',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'rgba(30,58,95,0.4)',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.4)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{
            x:0.02,y:0.98,xref:'paper',yref:'paper',showarrow:false,
            text:`${n_frames_sampled} MS1 frames · mid-run`,
            font:{size:9,color:'#4a6070'},xanchor:'left',yanchor:'top',
          }],
        }, {responsive:true, displayModeBar:false});
      }, [landscape]);

      // ── Sequence Motif Heatmap ──────────────────────────────────────────
      useEffect(() => {
        const mm = data?.motif_matrix?.[motifLen];
        if (!mm || !motifRef.current) return;
        const length = parseInt(motifLen);
        const positions = Array.from({length}, (_, i) => `P${i+1}`);
        const annotations = [];
        for (let pos = 0; pos < length; pos++) {
          let bestAA = '', bestFreq = 0;
          mm.aas.forEach((aa, ai) => {
            if (mm.freq[ai][pos] > bestFreq) { bestFreq = mm.freq[ai][pos]; bestAA = aa; }
          });
          if (bestFreq >= 0.20) {
            annotations.push({
              x: `P${pos+1}`, y: bestAA,
              text: bestAA, showarrow: false,
              font: {size: 11, color: '#fff', family: 'monospace'},
              xref: 'x', yref: 'y',
            });
          }
        }
        Plotly.react(motifRef.current, [{
          type: 'heatmap',
          z: mm.freq,
          x: positions,
          y: mm.aas,
          colorscale: [
            [0, 'rgba(13,30,54,0)'],
            [0.05, '#071224'],
            [0.25, '#0f3460'],
            [0.5, '#1d4ed8'],
            [0.75, '#7c3aed'],
            [0.9, '#ec4899'],
            [1.0, '#fde68a'],
          ],
          showscale: true,
          hovertemplate: '%{y} at %{x}: %{z:.1%}<extra></extra>',
          colorbar: {
            thickness: 12, len: 0.9,
            tickformat: '.0%',
            tickfont: {size: 9, color: '#94a3b8'},
            title: {text: 'Freq', side: 'right', font: {size: 9, color: '#94a3b8'}},
            bgcolor: 'transparent', bordercolor: '#1e3a5f',
          },
        }], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'rgba(7,18,36,0.6)',
          font: {color: '#94a3b8', size: 10},
          margin: {l: 38, r: 70, t: 20, b: 45},
          xaxis: {
            title: {text: 'Position', font: {size: 11}},
            gridcolor: 'rgba(30,58,95,0.3)', color: '#a0b4cc', tickfont: {size: 10},
          },
          yaxis: {
            color: '#a0b4cc', tickfont: {size: 10},
            gridcolor: 'rgba(30,58,95,0.3)', autorange: 'reversed',
          },
          annotations,
        }, {responsive: true, displayModeBar: false});
      }, [data, motifLen]);

      const topPeps = useMemo(() => {
        if (!data?.top_peptides) return [];
        let peps = data.top_peptides;
        if (mhcClass === 'mhc1') peps = peps.filter(p => p.length >= 8 && p.length <= 14);
        if (mhcClass === 'mhc2') peps = peps.filter(p => p.length >= 13 && p.length <= 25);
        if (chargeFilter !== 'all') peps = peps.filter(p => p.charge === parseInt(chargeFilter));
        return peps;
      }, [data, mhcClass, chargeFilter]);

      if (runsLoading) return <div className="empty">Loading…</div>;

      return (
        <div>
          {/* Header */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1.25rem'}}>
            <div style={{display:'flex',gap:'1.5rem',alignItems:'center',flexWrap:'wrap',justifyContent:'space-between'}}>
              <div>
                <span style={{fontWeight:700,fontSize:'1.1rem'}}>Immunopeptidomics</span>
                <span style={{color:'var(--muted)',fontSize:'0.82rem',marginLeft:'0.75rem'}}>
                  MHC Class I (8–14aa) · MHC Class II (13–25aa) · 1% FDR
                </span>
              </div>
              <div style={{fontSize:'0.78rem',color:'var(--muted)'}}>
                Ensure DIA-NN was run with <code style={{color:'var(--accent)'}}>--min-pr-charge 1</code> for +1 ions
              </div>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'250px 1fr',gap:'1rem',alignItems:'start'}}>
            {/* Run list */}
            <div className="card" style={{padding:'0.75rem',position:'sticky',top:'1rem'}}>
              <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>Runs</div>
              <input type="text" placeholder="Filter…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.3rem 0.5rem',fontSize:'0.8rem',marginBottom:'0.5rem'}} />
              <div style={{maxHeight:'65vh',overflowY:'auto'}}>
                {filtered.map(r => {
                  const sel = selectedRun?.id === r.id;
                  return (
                    <div key={r.id} onClick={() => setSelectedRun(r)}
                      style={{padding:'0.4rem 0.5rem',borderRadius:'0.3rem',cursor:'pointer',marginBottom:'0.1rem',
                        background:sel?'rgba(218,170,0,0.1)':'transparent',borderLeft:sel?'2px solid var(--accent)':'2px solid transparent'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'0.35rem'}}>
                        <span title={r.result_path ? 'DIA-NN report.parquet available' : 'No search results — Raw MHC Landscape only'}
                          style={{flexShrink:0,width:'6px',height:'6px',borderRadius:'50%',
                            background: r.result_path ? '#22c55e' : '#334155',
                            boxShadow: r.result_path ? '0 0 4px #22c55e88' : 'none'}} />
                        <span style={{fontSize:'0.78rem',fontWeight:600,color:sel?'var(--accent)':'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.run_name}</span>
                      </div>
                      <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem',paddingLeft:'0.9rem'}}>
                        {new Date(r.run_date).toLocaleDateString([],{month:'short',day:'numeric',year:'2-digit'})} · {r.instrument}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right panel */}
            <div>
              {!selectedRun && (
                <div className="card" style={{textAlign:'center',padding:'5rem 2rem',color:'var(--muted)'}}>
                  <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.4}}>🧫</div>
                  <div style={{fontSize:'1rem',fontWeight:600,marginBottom:'0.4rem'}}>Select a run</div>
                  <div style={{fontSize:'0.85rem'}}>Peptide length distribution, MHC class analysis, and ion cloud</div>
                </div>
              )}
              {selectedRun && loading && <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>Loading…</div>}
              {selectedRun && !loading && !data && (
                <div className="card">
                  <p style={{color:'var(--muted)',fontSize:'0.85rem'}}>
                    No DIA-NN report.parquet found for <strong>{selectedRun.run_name}</strong>.
                  </p>
                </div>
              )}
              {selectedRun && !loading && data && (
                <div>
                  {/* Summary metrics */}
                  <div className="card" style={{marginBottom:'0.75rem',padding:'0.65rem 1rem'}}>
                    <div style={{display:'flex',gap:'1.25rem',flexWrap:'wrap',alignItems:'center'}}>
                      {[
                        {label:'Total @ 1% FDR', value:(data.n_total||0).toLocaleString(), color:'var(--text)'},
                        {label:'MHC-I (8–14aa)', value:`${(data.n_mhc1||0).toLocaleString()} (${data.pct_mhc1||0}%)`, color:'#60a5fa'},
                        {label:'MHC-II (13–25aa)', value:`${(data.n_mhc2||0).toLocaleString()} (${data.pct_mhc2||0}%)`, color:'#a855f7'},
                        {label:'Short (<8aa)', value:(data.n_short||0).toLocaleString(), color:'var(--muted)'},
                        {label:'Long (>25aa)', value:(data.n_long||0).toLocaleString(), color:'var(--muted)'},
                        data.length_stats?.median ? {label:'Median length', value:`${data.length_stats.median}aa`, color:'var(--muted)'} : null,
                      ].filter(Boolean).map(m => (
                        <div key={m.label} style={{textAlign:'center'}}>
                          <div style={{fontWeight:700,fontSize:'1rem',color:m.color}}>{m.value}</div>
                          <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Charge note if no z=1 */}
                  {!(data.charge_dist?.[1]) && (
                    <div style={{background:'rgba(234,179,8,0.08)',border:'1px solid rgba(234,179,8,0.25)',borderRadius:'0.4rem',
                                 padding:'0.5rem 0.9rem',marginBottom:'0.75rem',fontSize:'0.82rem',color:'var(--warn)'}}>
                      No z=+1 ions detected. For immunopeptidomics/MHC-I, re-run DIA-NN with{' '}
                      <code style={{color:'var(--accent)'}}>--min-pr-charge 1 --max-pr-charge 3</code>.
                    </div>
                  )}

                  {/* Length distribution */}
                  <div className="card" style={{marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem'}}>
                      <h3 style={{margin:0}}>Peptide Length Distribution</h3>
                      <ExportBtn plotRef={lenPlotRef} filename={`${selectedRun?.run_name||'run'}-pep-length`} />
                    </div>
                    <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.4rem'}}>
                      Blue shading = MHC-I (8–14aa) &nbsp;·&nbsp; Purple shading = MHC-II (13–25aa)
                    </div>
                    <div ref={lenPlotRef} style={{height:'240px'}} />
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem',marginBottom:'0.75rem'}}>
                    {/* Charge distribution */}
                    <div className="card">
                      <h3 style={{marginBottom:'0.5rem'}}>Charge Distribution</h3>
                      {Object.keys(data.charge_dist||{}).length === 0
                        ? <div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No charge data</div>
                        : (
                          <div style={{display:'flex',flexDirection:'column',gap:'0.3rem'}}>
                            {Object.entries(data.charge_dist||{}).sort((a,b)=>+a[0]-+b[0]).map(([z, cnt]) => {
                              const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
                              const CHARGE_LBL    = {0:'?',1:'+1',2:'+2',3:'+3',4:'+4',5:'+5',6:'+6'};
                              const col = CHARGE_COLORS[+z] || '#94a3b8';
                              const maxCnt = Math.max(...Object.values(data.charge_dist));
                              return (
                                <div key={z} style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                                  <div style={{width:'28px',fontSize:'0.78rem',color:col,textAlign:'right',flexShrink:0,fontWeight:700}}>{CHARGE_LBL[+z]||`+${z}`}</div>
                                  <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:'3px',height:'14px',overflow:'hidden'}}>
                                    <div style={{width:`${(cnt/maxCnt*100)}%`,height:'100%',background:col,borderRadius:'3px'}} />
                                  </div>
                                  <div style={{fontSize:'0.76rem',color:'var(--text)',width:'90px',flexShrink:0}}>
                                    {cnt.toLocaleString()} <span style={{color:'var(--muted)'}}>({(cnt/data.n_total*100).toFixed(1)}%)</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      }
                    </div>

                    {/* Modifications */}
                    <div className="card">
                      <h3 style={{marginBottom:'0.5rem'}}>Modifications</h3>
                      {(data.modifications||[]).length === 0
                        ? <div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No variable modifications</div>
                        : (
                          <div style={{display:'flex',flexDirection:'column',gap:'0.25rem'}}>
                            {data.modifications.slice(0,8).map((m,i) => {
                              const modColors = ['#f97316','#a78bfa','#38bdf8','#fb7185','#4ade80','#fbbf24','#60a5fa','#22c55e'];
                              const maxPct = data.modifications[0]?.pct || 1;
                              return (
                                <div key={i} style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
                                  <div style={{width:'72px',fontSize:'0.74rem',color:'var(--text)',flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</div>
                                  <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:'2px',height:'10px',overflow:'hidden'}}>
                                    <div style={{width:`${m.pct/maxPct*100}%`,height:'100%',background:modColors[i%modColors.length]}} />
                                  </div>
                                  <div style={{fontSize:'0.72rem',color:'var(--muted)',width:'50px',textAlign:'right',flexShrink:0}}>{m.pct}%</div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      }
                    </div>
                  </div>

                  {/* Ion cloud: m/z vs 1/K₀ */}
                  {data.top_peptides?.some(p => p.mobility) && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Ion Cloud — m/z × 1/K₀</h3>
                          <div style={{fontSize:'0.73rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            Charge-state lanes · Tenzer/Gomez-Zepeda style · top 200 precursors ·
                            <span style={{color:'#fbbf24'}}> z=+1 = MHC-I candidates</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.4rem',alignItems:'center'}}>
                          {immunoWindowData?.windows?.length > 0 && (
                            <button
                              onClick={() => setShowImmunoWindowOverlay(v => !v)}
                              title={showImmunoWindowOverlay ? 'Hide diaPASEF windows' : 'Overlay diaPASEF isolation windows'}
                              style={{
                                display:'flex',alignItems:'center',gap:'0.3rem',
                                padding:'0.25rem 0.6rem', fontSize:'0.78rem', fontWeight: 600,
                                background: showImmunoWindowOverlay ? 'rgba(0,174,183,0.18)' : 'rgba(0,174,183,0.07)',
                                color: showImmunoWindowOverlay ? '#00d4e0' : '#4a8cbb',
                                border: `1px solid ${showImmunoWindowOverlay ? '#00d4e0' : 'rgba(0,174,183,0.3)'}`,
                                borderRadius:'0.4rem', cursor:'pointer', whiteSpace:'nowrap',
                              }}
                            >
                              <span>⊞</span>
                              {showImmunoWindowOverlay ? 'Windows ON' : 'Windows'}
                            </button>
                          )}
                          <ExportBtn plotRef={cloudRef} filename={`${selectedRun?.run_name||'run'}-immuno-cloud`} />
                        </div>
                      </div>
                      {showImmunoWindowOverlay && immunoWindowData?.windows?.length > 0 && (
                        <div style={{fontSize:'0.72rem',color:'#4a9ab0',marginBottom:'0.25rem',paddingLeft:'0.1rem'}}>
                          {immunoWindowData.windows.length} diaPASEF sub-windows shown ·
                          m/z {immunoWindowData.mz_range[0].toFixed(0)}–{immunoWindowData.mz_range[1].toFixed(0)} Da ·
                          {immunoWindowData.n_window_groups} groups · coloured by group · hover charts for details
                        </div>
                      )}
                      <div ref={cloudRef} style={{height:'320px'}} />
                    </div>
                  )}

                  {/* ── View 1: Length × Mobility Ridge ──────────────────── */}
                  {data?.length_mobility_agg && Object.keys(data.length_mobility_agg).some(l => data.length_mobility_agg[l]?.median_im) && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Length × Mobility Ridge</h3>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            Per-length 1/K₀ box: median, IQR, ±2σ whiskers · each box = all precursors at that length
                          </div>
                        </div>
                        <ExportBtn plotRef={ridgeRef} filename={`${selectedRun?.run_name||'run'}-len-mobility`} />
                      </div>
                      <div ref={ridgeRef} style={{height:'260px'}} />
                    </div>
                  )}

                  {/* ── View 2: GRAVY × Mobility + Fingerprint Radar ────────── */}
                  {data?.gravy_cloud?.length > 0 && (
                    <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:'0.75rem',marginBottom:'0.75rem'}}>
                      <div className="card">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem'}}>
                          <div>
                            <h3 style={{margin:0}}>Hydrophobicity × Mobility Landscape</h3>
                            <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                              GRAVY score (Kyte-Doolittle) vs 1/K₀ · colored by peptide length · reveals MHC anchor-residue clusters
                            </div>
                          </div>
                          <ExportBtn plotRef={gravyRef} filename={`${selectedRun?.run_name||'run'}-gravy-mobility`} />
                        </div>
                        <div ref={gravyRef} style={{height:'280px'}} />
                      </div>
                      <div className="card">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.15rem'}}>
                          <div>
                            <h3 style={{margin:0}}>Immunopeptidome Fingerprint</h3>
                            <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem'}}>5-axis quality radar</div>
                          </div>
                        </div>
                        <div ref={radarRef} style={{height:'265px'}} />
                        {data?.radar && (
                          <div style={{fontSize:'0.7rem',color:'var(--muted)',borderTop:'1px solid var(--border)',paddingTop:'0.4rem',marginTop:'0.25rem',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.15rem 0.5rem'}}>
                            <span>MHC-I: <strong style={{color:'var(--text)'}}>{(data.radar.pct_mhc1||0).toFixed(1)}%</strong></span>
                            <span>z=+1: <strong style={{color:'var(--text)'}}>{(data.radar.pct_z1||0).toFixed(1)}%</strong></span>
                            <span>9-mer: <strong style={{color:'var(--text)'}}>{(data.radar.pct_9mer_mhc1||0).toFixed(1)}%</strong></span>
                            <span>Mob CV: <strong style={{color:'var(--text)'}}>{data.radar.mobility_cv != null ? data.radar.mobility_cv.toFixed(1)+'%' : '—'}</strong></span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Sequence Motif Heatmap ───────────────────────────────── */}
                  {data?.motif_matrix && Object.keys(data.motif_matrix).length > 0 && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem',flexWrap:'wrap',gap:'0.5rem'}}>
                        <div>
                          <h3 style={{margin:0}}>HLA Binding Motif</h3>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            Per-position amino acid frequency · white label = anchor residue (≥20%) · n={data.motif_matrix[motifLen]?.n.toLocaleString() || '—'} peptides
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.35rem',alignItems:'center'}}>
                          {['8','9','10','11'].filter(l => data.motif_matrix[l]).map(l => (
                            <button key={l} onClick={() => setMotifLen(l)}
                              style={{
                                padding:'0.2rem 0.55rem',fontSize:'0.78rem',fontWeight:600,
                                background:motifLen===l?'rgba(96,165,250,0.2)':'rgba(96,165,250,0.06)',
                                color:motifLen===l?'#60a5fa':'var(--muted)',
                                border:`1px solid ${motifLen===l?'#60a5fa':'rgba(96,165,250,0.2)'}`,
                                borderRadius:'0.3rem',cursor:'pointer',
                              }}>
                              {l}-mer
                            </button>
                          ))}
                          <ExportBtn plotRef={motifRef} filename={`${selectedRun?.run_name||'run'}-motif-${motifLen}mer`} />
                        </div>
                      </div>
                      <div ref={motifRef} style={{height:'280px'}} />
                    </div>
                  )}

                  {/* ── View 3: Raw MHC Ion Landscape (timsdata) ─────────────── */}
                  {selectedRun?.raw_path?.endsWith('.d') && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Raw MHC Ion Landscape</h3>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            All ions from raw timsdata MS1 frames in the MHC region (m/z 400–950) · identified peptides overlaid
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.4rem',alignItems:'center'}}>
                          {!showLandscape && (
                            <button onClick={() => setShowLandscape(true)}
                              style={{padding:'0.25rem 0.7rem',fontSize:'0.78rem',fontWeight:600,
                                background:'rgba(96,165,250,0.1)',color:'#60a5fa',
                                border:'1px solid rgba(96,165,250,0.3)',borderRadius:'0.4rem',cursor:'pointer'}}>
                              Load raw data
                            </button>
                          )}
                          {showLandscape && <ExportBtn plotRef={landscapeRef} filename={`${selectedRun?.run_name||'run'}-mhc-landscape`} />}
                        </div>
                      </div>
                      {showLandscape && landscapeLoading && (
                        <div style={{textAlign:'center',color:'var(--muted)',padding:'2rem',fontSize:'0.85rem'}}>
                          Reading timsdata frames…
                        </div>
                      )}
                      {showLandscape && !landscapeLoading && !landscape && (
                        <div style={{color:'var(--muted)',fontSize:'0.82rem',padding:'0.5rem 0'}}>
                          timsdata DLL unavailable or no MS1 frames found in this .d file.
                        </div>
                      )}
                      {showLandscape && !landscapeLoading && landscape && (
                        <div ref={landscapeRef} style={{height:'340px'}} />
                      )}
                      {!showLandscape && (
                        <div style={{textAlign:'center',color:'var(--muted)',padding:'1.5rem',fontSize:'0.8rem',fontStyle:'italic'}}>
                          Reads directly from .d raw file — loads on demand
                        </div>
                      )}
                    </div>
                  )}

                  {/* Top peptides table with MHC/charge filter */}
                  <div className="card">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.6rem',flexWrap:'wrap',gap:'0.5rem'}}>
                      <h3 style={{margin:0}}>Top Peptides</h3>
                      <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                        <select value={mhcClass} onChange={e => setMhcClass(e.target.value)}
                          style={{background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',padding:'0.25rem 0.4rem',fontSize:'0.78rem'}}>
                          <option value="all">All lengths</option>
                          <option value="mhc1">MHC-I (8–14aa)</option>
                          <option value="mhc2">MHC-II (13–25aa)</option>
                        </select>
                        <select value={chargeFilter} onChange={e => setChargeFilter(e.target.value)}
                          style={{background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',padding:'0.25rem 0.4rem',fontSize:'0.78rem'}}>
                          <option value="all">All charges</option>
                          <option value="0">z=0 (unassigned)</option>
                          {[1,2,3,4,5,6].map(z => <option key={z} value={z}>+{z}</option>)}
                        </select>
                        <span style={{fontSize:'0.75rem',color:'var(--muted)'}}>{topPeps.length} shown</span>
                      </div>
                    </div>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.78rem'}}>
                        <thead>
                          <tr style={{borderBottom:'1px solid var(--border)',color:'var(--muted)'}}>
                            {['Sequence','Len','z','m/z','RT (min)','1/K₀','Intensity'].map(h => (
                              <th key={h} style={{textAlign:'left',padding:'0.25rem 0.4rem',fontWeight:600}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {topPeps.map((p, i) => {
                            const isMhc1 = p.length >= 8 && p.length <= 14;
                            const isMhc2 = p.length >= 13 && p.length <= 25;
                            const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
                            return (
                              <tr key={i} style={{borderBottom:'1px solid rgba(30,58,95,0.5)',background: i%2===0?'transparent':'rgba(255,255,255,0.015)'}}>
                                <td style={{padding:'0.2rem 0.4rem',fontFamily:'monospace',fontSize:'0.76rem',color:'var(--accent)'}}>{p.sequence}</td>
                                <td style={{padding:'0.2rem 0.4rem',color: isMhc1&&isMhc2?'#a855f7':isMhc1?'#60a5fa':isMhc2?'#a855f7':'var(--muted)',fontWeight:600}}>{p.length}</td>
                                <td style={{padding:'0.2rem 0.4rem',color:CHARGE_COLORS[p.charge]||'var(--muted)',fontWeight:600}}>{p.charge===0?'?':`+${p.charge}`}</td>
                                <td style={{padding:'0.2rem 0.4rem'}}>{p.mz?.toFixed(4)}</td>
                                <td style={{padding:'0.2rem 0.4rem'}}>{p.rt?.toFixed(2)}</td>
                                <td style={{padding:'0.2rem 0.4rem'}}>{p.mobility?.toFixed(4) || '—'}</td>
                                <td style={{padding:'0.2rem 0.4rem',color:'var(--muted)'}}>{p.intensity ? p.intensity.toExponential(2) : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    function AboutTab() {
      const { data: ver } = useFetch('/api/version');
      const [factIdx, setFactIdx] = React.useState(0);
      const [ziggyClix, setZiggyClix] = React.useState(0);
      const [konamiActive, setKonamiActive] = React.useState(false);
      const konamiSeq = React.useRef([]);
      const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

      const FACTS = [
        "The average tryptic peptide is 8–15 amino acids. Your instrument sees thousands of them per second.",
        "1/K₀, inverse reduced ion mobility, separates things that weigh the same but are shaped differently.",
        "HeLa cells have been dividing in labs since 1951. They will outlast us all.",
        "A timsTOF Pro accumulates ions in ~100ms TIMS steps. That's 10 full 4D scans per second.",
        "Charge state z is the Z in ZIGGY. Every ion carries it. Every ion is it.",
        "The first mass spectrum was recorded in 1912. J.J. Thomson measured neon isotopes.",
        "DIA-NN can identify >10,000 proteins from a single 30-minute gradient. In 2015, that was a year's work.",
        "A CCS value is reproducible across labs, instruments, and time. It is a fingerprint that does not age.",
        "The human proteome has ~20,000 genes. With PTMs and isoforms: probably 1 million+ unique proteoforms.",
        "PASEF stands for Parallel Accumulation Serial Fragmentation. It's why timsTOF sees so much, so fast.",
        "The first peptide sequenced by mass spec was insulin B-chain in 1958. Sixty-six residues. Revolutionary.",
        "Stardust is literally true. The carbon in your peptides was forged in dying stars.",
        "Ion mobility separates in microseconds. Chromatography in minutes. The timsTOF does both simultaneously.",
        "A fragment ion carries the sequence. A charge state carries the story. Together they tell you everything.",
      ];

      React.useEffect(() => {
        console.log('%c\u{1F9AC} ZIGGY \u2014 The Proteomics Rockstar', 'font-size:22px;font-weight:900;color:#a855f7;letter-spacing:0.05em;');
        console.log('%c Hey. You opened dev tools. We respect that energy entirely. \u{1F44B}', 'font-size:13px;color:#60a5fa;');
        console.log('%c The ion endpoint lives at: /api/runs/{id}/mobility-3d', 'font-size:12px;color:#22c55e;font-family:monospace;');
        console.log('%c z = charge state. Z = ZIGGY. Both are real.', 'font-size:12px;color:#DAAA00;font-style:italic;');
        console.log('%c Try the Konami code on this page. \u2191\u2191\u2193\u2193\u2190\u2192\u2190\u2192 B A', 'font-size:11px;color:#f78166;');
        const iv = setInterval(() => setFactIdx(i => (i + 1) % FACTS.length), 5000);
        return () => clearInterval(iv);
      }, []);

      React.useEffect(() => {
        const handler = (e) => {
          konamiSeq.current = [...konamiSeq.current, e.key].slice(-10);
          if (konamiSeq.current.join(',') === KONAMI.join(',')) {
            setKonamiActive(true);
            konamiSeq.current = [];
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, []);

      const handleZiggyClick = () => {
        const n = ziggyClix + 1;
        setZiggyClix(n);
        if (n === 5) alert('\u26A1 Five clicks. The Starman approves.\n\n\u201CZiggy played guitar, jamming good with Weird and Gilly\nAnd the spiders from Mars\u2026\u201D\n\nYou played peptides. Keep going.');
        if (n === 10) alert('\u{1F31F} Ten clicks. You found the ion mobility easter egg.\n\nm/z is where you are.\n1/K\u2080 is who you are.\nRT is when you are.\nIntensity is how much you care.');
        if (n === 42) alert('\u{1F52C} 42 clicks.\n\nThe answer to life, the universe, and proteomics\nis still: run more replicates.');
      };

      return (
        <div>
          {/* Konami overlay */}
          {konamiActive && (
            <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.93)',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'1.5rem'}}
                 onClick={() => setKonamiActive(false)}>
              <div style={{fontSize:'2.8rem',letterSpacing:'0.12em',fontWeight:900,background:'linear-gradient(135deg,#DAAA00,#f78166,#a855f7,#60a5fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',textAlign:'center'}}>
                STARMAN MODE
              </div>
              <div style={{color:'#e2e8f0',fontSize:'1.05rem',textAlign:'center',maxWidth:'500px',lineHeight:1.9,fontStyle:'italic'}}>
                "There's a starman waiting in the sky<br/>
                He'd like to come and meet us<br/>
                But he thinks he'd blow our minds"
              </div>
              <div style={{color:'#a855f7',fontSize:'0.88rem'}}>David Bowie, 1972</div>
              <div style={{color:'#94a3b8',fontSize:'0.85rem',marginTop:'0.5rem',maxWidth:'440px',textAlign:'center',lineHeight:1.75}}>
                You found the Konami code. In proteomics that's the equivalent of finding a +6 charge state
                on a 40 kDa intact protein, theoretically possible, breathtaking in practice.
              </div>
              <div style={{color:'#60a5fa',fontSize:'0.8rem',marginTop:'0.25rem'}}>click anywhere to return to your ions</div>
            </div>
          )}

          {/* Project info */}
          <div className="card" style={{marginBottom:'1rem', background:'linear-gradient(135deg, rgba(2,40,81,0.95) 0%, rgba(31,6,107,0.4) 100%)', border:'1px solid #3b1f8f55'}}>
            <div style={{display:'flex', alignItems:'baseline', gap:'0.75rem', marginBottom:'0.5rem'}}>
              <h2 onClick={handleZiggyClick} title="Try clicking this a few times." style={{fontSize:'1.8rem',fontWeight:900,letterSpacing:'0.05em',background:'linear-gradient(135deg, #DAAA00, #f78166, #a855f7)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',cursor:'pointer',userSelect:'none'}}>ZIGGY</h2>
              <span style={{color:'var(--muted)', fontSize:'0.85rem'}}>The Proteomics Rockstar</span>
              {ver && <span style={{color:'var(--muted)', fontSize:'0.8rem', marginLeft:'auto'}}>v{ver.version}</span>}
            </div>
            <p style={{marginBottom:'0.75rem', lineHeight:1.7}}>
              <strong style={{color:'var(--accent)'}}>ZIGGY</strong> is Michael Krawitzky's 4D ion mobility visualization and analysis platform,
              built on the <strong>STAN</strong> QC engine but reaching far beyond pass/fail metrics
              into novel territory: rotatable ion landscapes, differential ion cloud comparison,
              breathing proteome animation, CCS corridor analysis, and interactive educational tools
              that make ion mobility understood by everyone.
            </p>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', lineHeight:1.6}}>
              Named after Ziggy Stardust. Because proteomics should be as exciting as a Bowie album.
              The <em>Z</em> is not a coincidence: <em>z</em> is charge state. Every ion has it.
            </p>
          </div>

          {/* Rotating facts ticker */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.65rem 1rem',background:'rgba(96,165,250,0.06)',border:'1px solid rgba(96,165,250,0.2)',display:'flex',alignItems:'center',gap:'0.75rem',minHeight:'3rem'}}>
            <span style={{color:'#60a5fa',fontSize:'0.72rem',fontWeight:700,flexShrink:0,letterSpacing:'0.1em'}}>DID YOU KNOW</span>
            <span style={{color:'var(--muted)',fontSize:'0.85rem',lineHeight:1.5,fontStyle:'italic'}}>{FACTS[factIdx]}</span>
          </div>

          {/* Manifesto */}
          <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(160deg,rgba(2,40,81,0.7) 0%,rgba(31,6,107,0.2) 60%,rgba(15,23,42,0.9) 100%)',border:'1px solid rgba(168,85,247,0.25)'}}>
            <h3 style={{marginBottom:'0.85rem',background:'linear-gradient(90deg,#a855f7,#60a5fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>A Letter to the Unsung</h3>
            <div style={{fontSize:'0.9rem',lineHeight:2.05,color:'#cbd5e1'}}>
              <p style={{marginBottom:'1.1rem'}}>
                Some of us didn't choose science.<br/>
                Science chose us, in the quiet of a dark room, watching a spectrum unfold,
                understanding for one electric second that we were measuring the weight of life itself.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                We showed up early and stayed late, not for the salary line, not for the tenure clock,
                but because the gradient was still running and the data didn't care what time it was.
                We named our columns with love. We argued about FDR cutoffs at midnight.
                We celebrated a 4% improvement in precursor IDs like it was a moon landing.
                Because it was.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                This software is for the people who shared their code without being asked.
                Who wrote the README at 11pm after a twelve-hour instrument day.
                Who answered the forum post from a grad student in a country they've never visited.
                Who published the tool, the library, the algorithm, and asked for nothing back
                but a citation they'll never see in their inbox.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                Science is not a job.<br/>
                It is a calling that doesn't pay enough, doesn't sleep enough, and doesn't stop.<br/>
                It is a love language spoken in peptide sequences and charge states and fragmentation patterns
                that only a few hundred humans on earth can read fluently.
              </p>
              <p style={{marginBottom:'0'}}>
                If you are one of those humans:<br/>
                <strong style={{color:'#a855f7'}}>you are not alone. you are seen. this software is yours.</strong>
              </p>
            </div>
          </div>

          {/* Feature highlights */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Feature Highlights</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginTop:'0.5rem'}}>
              {[
                {
                  icon:'📊', title:'QC Dashboard',
                  items:['Precursor, peptide & protein counts @ 1% FDR','Pass / Warn / Fail gating with HOLD flag',
                         'Longitudinal trend charts','Column lifetime & maintenance log'],
                },
                {
                  icon:'🔵', title:'Ion Mobility (timsTOF)',
                  items:['4D feature map: m/z × 1/K₀ × RT × intensity','PEAKS-style waterfall (m/z × 1/K₀ × intensity)',
                         'RT × 1/K₀ heatmap with axis ticks','Charge-state filter & m/z / RT sliders',
                         'Immunopeptidomics & peptidomics z=+1 support'],
                },
                {
                  icon:'🔬', title:'Spectrum Viewer',
                  items:['Theoretical b/y ion series from DIA-NN Modified.Sequence','UniMod annotation (Oxidation, Phospho, CAM, …)',
                         'Head-to-head mirror comparison across ≤ 3 runs','Peptide search within any DIA-NN report'],
                },
                {
                  icon:'🧬', title:'Enzyme & PTM Tab',
                  items:['Missed cleavage distribution (0 / 1 / 2 / 3+)','Modification frequency table per run',
                         'Peptide & unique precursor counts','Pulls live from DIA-NN report.parquet'],
                },
                {
                  icon:'🤖', title:'Automated Search',
                  items:['DIA-NN for DIA (timsTOF diaPASEF + Orbitrap)','Sage for DDA (timsTOF ddaPASEF + Orbitrap)',
                         'Auto mode-detection from raw metadata','SLURM submission on Hive HPC'],
                },
                {
                  icon:'🌐', title:'Community Benchmark',
                  items:['HeLa community leaderboard (Track A DDA + Track B DIA)','Radar fingerprint when both tracks submitted',
                         'No HF token required, relay handles auth','CC BY 4.0 community dataset'],
                },
              ].map(({icon, title, items}) => (
                <div key={title} style={{padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)'}}>
                  <div style={{fontWeight:700, fontSize:'0.95rem', marginBottom:'0.4rem'}}>{icon} {title}</div>
                  <ul style={{color:'var(--muted)', fontSize:'0.8rem', paddingLeft:'1.1rem', lineHeight:1.75, margin:0}}>
                    {items.map(it => <li key={it}>{it}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* What's New */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>What's New · ZIGGY · April 2026</h3>
            <div style={{display:'flex', flexDirection:'column', gap:'0.5rem', marginTop:'0.4rem'}}>
              {[
                {tag:'ZIGGY', color:'#a855f7', text:'🗻 Landscape Viewer: compare 2–3 runs as Melanie-style rotatable 3D surfaces (m/z × 1/K₀ × intensity); linked cameras, differential A−B surface with Pearson similarity, peak inspector'},
                {tag:'ZIGGY', color:'#a855f7', text:'🔍 Sneaky Peaky: automated differential ion comparison, spatial-hash matching, exclusive/shifted/enriched ion categories, QC metrics table with Δ%, m/z target finder, sortable differences table'},
                {tag:'ZIGGY', color:'#a855f7', text:'⬡ 4D Advantage tab: 5 live-data visualizations, Mobility Corridor (per-charge R²), Chimera Probability Map, Breathing Proteome animation, Orthogonality Index, 4D Run Fingerprint'},
                {tag:'ZIGGY', color:'#a855f7', text:'+1 & unassigned ions everywhere: charge toggles in CCS tab now include z=0 (?) and z=+1; immunopeptidomics dropdown extended to z=0–6'},
                {tag:'NEW', color:'var(--pass)', text:'Spectrum Viewer: experimental frame spectra from raw .d data, Best.Fr.Mz marked, PEAKS-style mirror comparison across 3 runs'},
                {tag:'NEW', color:'var(--pass)', text:'Ion Mobility waterfall (PEAKS Studio-style) · m/z × 1/K₀ intensity landscape · CCS corridor plots'},
                {tag:'NEW', color:'var(--pass)', text:'Enzyme / PTM tab · Immunopeptidomics tab · Searches tab'},
                {tag:'UPD', color:'var(--accent)', text:'Ion Mobility 3D filter: charge toggles, m/z, RT & 1/K₀ range; scroll-zoom + box-select on ion cloud charts'},
              ].map(({tag, color, text}) => (
                <div key={text} style={{display:'flex', gap:'0.6rem', alignItems:'flex-start', fontSize:'0.85rem'}}>
                  <span style={{flexShrink:0, padding:'0.15rem 0.45rem', borderRadius:'0.3rem',
                                background: tag === 'ZIGGY' ? 'rgba(168,85,247,0.15)' : tag === 'NEW' ? 'rgba(34,197,94,0.12)' : 'rgba(96,165,250,0.12)',
                                color, fontWeight:700, fontSize:'0.75rem', marginTop:'0.05rem'}}>{tag}</span>
                  <span style={{color:'var(--muted)'}}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Authors */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Authors</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginTop:'0.25rem'}}>
              <div style={{padding:'0.75rem', background:'linear-gradient(135deg,rgba(2,40,81,0.8),rgba(31,6,107,0.3))', borderRadius:'0.5rem', border:'1px solid #a855f755'}}>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem'}}>
                  <span style={{fontSize:'1.4rem'}}>⚡</span>
                  <div style={{fontWeight:800, fontSize:'1rem', background:'linear-gradient(135deg, #DAAA00, #a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}
                       title="He measures things smaller than thought. The Peptide Wizard.">Michael Krawitzky</div>
                </div>
                <div style={{color:'var(--muted)', fontSize:'0.82rem', marginBottom:'0.2rem'}}>The Peptide Wizard · Bruker Daltonics</div>
                <div style={{color:'#a855f7', fontSize:'0.8rem', marginBottom:'0.5rem', fontStyle:'italic'}}>Creator of ZIGGY</div>
                <a href="https://github.com/MKrawitzky/Nats" target="_blank"
                   style={{color:'var(--accent)', fontSize:'0.82rem', textDecoration:'none'}}>
                  github.com/MKrawitzky/Nats →
                </a>
              </div>
              <div style={{padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)'}}>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem'}}>
                  <span style={{fontSize:'1.2rem'}}>🔬</span>
                  <div style={{fontWeight:700, fontSize:'1rem'}}
                       title="Stayed up until 3am once fixing a DIA-NN flag. It was a tab character. We've all been there.">Brett Stanley Phinney</div>
                </div>
                <div style={{color:'var(--muted)', fontSize:'0.82rem', marginBottom:'0.2rem'}}>UC Davis Proteomics Core</div>
                <div style={{color:'var(--accent)', fontSize:'0.8rem', marginBottom:'0.5rem', fontStyle:'italic'}}>Creator of STAN (QC engine)</div>
                <a href="https://github.com/bsphinney/stan" target="_blank"
                   style={{color:'var(--muted)', fontSize:'0.82rem', textDecoration:'none'}}>
                  github.com/bsphinney/stan →
                </a>
                <div style={{color:'var(--muted)', fontSize:'0.78rem', marginTop:'0.2rem'}}>bsphinney@ucdavis.edu</div>
              </div>
            </div>
            <div style={{marginTop:'0.75rem',padding:'0.65rem 0.85rem',background:'rgba(168,85,247,0.07)',borderRadius:'0.4rem',border:'1px solid rgba(168,85,247,0.15)',fontSize:'0.82rem',color:'var(--muted)',lineHeight:1.75}}>
              <strong style={{color:'#a855f7'}}>Standing on shoulders:</strong>{' '}
              ZIGGY exists because of the open-source proteomics community, the people who built
              DIA-NN, Sage, timsrust, timsplot, Carafe, MsBackendTimsTof, and thousands of R packages
              and Python wheels without ever asking for anything back but a citation.
              They are the unsung. They are the whole song.
            </div>
          </div>

          {/* License */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>License</h3>
            <div style={{marginBottom:'0.75rem'}}>
              <span style={{fontWeight:600}}>ZIGGY / STAN Academic License</span>
              <span style={{color:'var(--muted)', marginLeft:'0.75rem', fontSize:'0.85rem'}}>
                Copyright &copy; 2024&#8211;2026 Brett Stanley Phinney &amp; The Peptide Wizard
              </span>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', fontSize:'0.85rem'}}>
              <div style={{padding:'0.6rem', background:'rgba(34,197,94,0.08)', borderRadius:'0.4rem', border:'1px solid rgba(34,197,94,0.2)'}}>
                <div style={{color:'var(--pass)', fontWeight:600, marginBottom:'0.3rem'}}>Free to use</div>
                <ul style={{color:'var(--muted)', paddingLeft:'1.1rem', lineHeight:1.7}}>
                  <li>Academic research</li>
                  <li>Non-profit organizations</li>
                  <li>Educational purposes</li>
                  <li>Government-funded research</li>
                  <li>Core facility internal QC</li>
                </ul>
              </div>
              <div style={{padding:'0.6rem', background:'rgba(234,179,8,0.08)', borderRadius:'0.4rem', border:'1px solid rgba(234,179,8,0.2)'}}>
                <div style={{color:'var(--warn)', fontWeight:600, marginBottom:'0.3rem'}}>Commercial use requires a license</div>
                <ul style={{color:'var(--muted)', paddingLeft:'1.1rem', lineHeight:1.7}}>
                  <li>For-profit companies</li>
                  <li>CROs &amp; pharma</li>
                  <li>Fee-for-service work</li>
                  <li>Commercial products</li>
                </ul>
                <div style={{marginTop:'0.4rem', color:'var(--muted)', fontSize:'0.8rem'}}>
                  Contact: <a href="mailto:bsphinney@ucdavis.edu" style={{color:'var(--accent)'}}>bsphinney@ucdavis.edu</a>
                </div>
              </div>
            </div>
            <div style={{marginTop:'0.75rem', color:'var(--muted)', fontSize:'0.8rem'}}>
              Community benchmark data is separately licensed under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" style={{color:'var(--accent)'}}>CC BY 4.0</a>.
              Full license text at{' '}
              <a href="https://github.com/MKrawitzky/Nats/blob/main/LICENSE" target="_blank" style={{color:'var(--accent)'}}>github.com/MKrawitzky/Nats</a>.
            </div>
          </div>

          {/* Carafe */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Carafe2: Experiment-Specific Spectral Libraries</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              Carafe2 trains deep-learning models (RT, fragment intensity, ion mobility) directly on
              your DIA data and outputs a DIA-NN-compatible TSV spectral library tuned to your
              instrument and sample prep, improving precursor IDs on future runs.
              Published in <em>Nature Communications</em> 2025.
            </p>
            <div style={{background:'var(--bg)', borderRadius:'0.4rem', padding:'0.6rem 0.9rem', fontFamily:'monospace', fontSize:'0.8rem', marginBottom:'0.75rem', border:'1px solid var(--border)'}}>
              <div style={{color:'var(--muted)', marginBottom:'0.2rem'}}># Download Carafe v2.0.0 (207 MB, requires Java 21+)</div>
              <div style={{color:'var(--accent)'}}>stan carafe --install</div>
              <div style={{color:'var(--muted)', marginTop:'0.4rem', marginBottom:'0.2rem'}}># Build experiment-specific library for a run</div>
              <div style={{color:'var(--accent)'}}>stan carafe --run &lt;RUN_ID&gt; --fasta proteome.fasta</div>
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/Noble-Lab/Carafe" target="_blank"
                 style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                         borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem', fontWeight:600}}>
                GitHub →
              </a>
              <a href="https://github.com/Noble-Lab/Carafe/releases/tag/v2.0.0" target="_blank"
                 style={{color:'var(--accent)', fontSize:'0.85rem', textDecoration:'none'}}>
                Download v2.0.0 →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>Requires Java 21+</span>
            </div>
          </div>

          {/* MsBackendTimsTof */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>MsBackendTimsTof: Raw Spectrum Access (R)</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              A Bioconductor/R backend that reads Bruker TimsTOF <code style={{color:'var(--accent)'}}>.d</code> directories
              directly as <code style={{color:'var(--accent)'}}>Spectra</code> objects, giving access to raw spectra,
              ion mobility dimensions, and peak-level data for deep MS analysis, custom filtering, and export.
            </p>
            <div style={{background:'var(--bg)', borderRadius:'0.4rem', padding:'0.6rem 0.9rem', fontFamily:'monospace', fontSize:'0.8rem', marginBottom:'0.75rem', border:'1px solid var(--border)'}}>
              <div style={{color:'var(--muted)', marginBottom:'0.2rem'}}># Install R dependencies (once)</div>
              <div style={{color:'var(--accent)'}}>stan msbackend --install</div>
              <div style={{color:'var(--muted)', marginTop:'0.4rem', marginBottom:'0.2rem'}}># Generate analysis script pre-filled with your .d paths</div>
              <div style={{color:'var(--accent)'}}>stan msbackend</div>
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/rformassspectrometry/MsBackendTimsTof" target="_blank"
                 style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                         borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem', fontWeight:600}}>
                GitHub →
              </a>
              <a href="https://rformassspectrometry.github.io/MsBackendTimsTof/" target="_blank"
                 style={{color:'var(--accent)', fontSize:'0.85rem', textDecoration:'none'}}>
                Documentation →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>Requires R ≥ 4.1 + Bruker SDK</span>
            </div>
          </div>

          {/* timsplot */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>timsplot: Publication-Ready Proteomics Figures</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              timsplot is an external interactive Shiny web app for proteomics figure generation.
              Load DIA-NN <code style={{color:'var(--accent)'}}>report.parquet</code>, Spectronaut exports,
              Sage results, or FragPipe PSMs to produce publication-ready plots: charge distributions,
              volcano plots, PCA, ion mobility, PTM heatmaps, and more.
            </p>
            <div style={{background:'rgba(234,179,8,0.08)', border:'1px solid rgba(234,179,8,0.25)', borderRadius:'0.4rem',
                         padding:'0.6rem 0.9rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'var(--muted)'}}>
              <strong style={{color:'var(--warn)'}}>External app, requires separate setup.</strong>{' '}
              timsplot needs R ≥ 4.1 + the <code style={{color:'var(--accent)'}}>shiny</code> package.
              On instrument PCs running Bruker ProteoScape, use the R version bundled with ProteoScape
              or install R separately to avoid Python version conflicts.
              Once running it serves on <code style={{color:'var(--accent)'}}>localhost:8422</code>.
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/zack-kirsch/timsplot" target="_blank"
                 style={{padding:'0.5rem 1.1rem', background:'var(--accent)', color:'var(--bg)',
                         borderRadius:'0.4rem', fontWeight:700, textDecoration:'none', fontSize:'0.9rem'}}>
                timsplot on GitHub →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>
                Install: <code style={{color:'var(--accent)'}}>Rscript -e "shiny::runGitHub('timsplot','zack-kirsch')"</code>
              </span>
            </div>
          </div>

          {/* Links */}
          <div className="card">
            <h3>Resources</h3>
            <div style={{display:'flex', flexWrap:'wrap', gap:'0.5rem', marginTop:'0.25rem'}}>
              {[
                ['GitHub', 'https://github.com/MKrawitzky/Nats'],
                ['Community Dashboard', 'https://community.stan-proteomics.org'],
                ['HF Dataset', 'https://huggingface.co/datasets/brettsp/stan-benchmark'],
                ['timsplot', 'https://github.com/zack-kirsch/timsplot'],
                ['MsBackendTimsTof', 'https://github.com/rformassspectrometry/MsBackendTimsTof'],
                ['Carafe2', 'https://github.com/Noble-Lab/Carafe'],
                ['API Docs', '/docs'],
                ['4D Landscape Viewer', '/static/landscape_viewer.html'],
                ['Ion Mobility Explainer', '/static/ion_mobility_explainer.html'],
                ['Beyond IDs', '/static/beyond_ids.html'],
              ].map(([label, href]) => (
                <a key={label} href={href} target={href.startsWith('http') ? '_blank' : '_self'}
                   style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                           borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem',
                           fontWeight:600}}>
                  {label} →
                </a>
              ))}
            </div>
          </div>
        </div>
      );
    }

    /* ── 4D Advantage Tab ──────────────────────────────────────────── */

    function AdvantageTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [searchTerm, setSearchTerm]   = useState('');
      const [data3d, setData3d]           = useState(null);
      const [windowData, setWindowData]   = useState(null);
      const [pasefData, setPasefData]     = useState(null);
      const [loading, setLoading]         = useState(false);

      const corridorRef  = useRef(null);
      const congLeftRef  = useRef(null);
      const congRightRef = useRef(null);
      const coverageRef  = useRef(null);
      const chimeraRef   = useRef(null);
      const breatheRef   = useRef(null);
      const fpARef       = useRef(null);
      const fpBRef       = useRef(null);
      const fpDiffRef    = useRef(null);
      const playAnimRef  = useRef(null);
      const playLastRef  = useRef(0);

      // ── Novel-viz state ─────────────────────────────────────────────
      const [rtSliderPct, setRtSliderPct]   = useState(50);
      const [playing, setPlaying]           = useState(false);
      const [selectedRun2, setSelectedRun2] = useState(null);
      const [searchTerm2, setSearchTerm2]   = useState('');
      const [data3d2, setData3d2]           = useState(null);
      const [loadingCompare, setLoadingCompare] = useState(false);

      const Z_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};

      // ── Only .d runs have ion mobility ──────────────────────────────
      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.raw_path && r.raw_path.endsWith('.d'));
      }, [allRuns]);

      const filteredRuns = useMemo(() => {
        if (!searchTerm) return dRuns;
        const q = searchTerm.toLowerCase();
        return dRuns.filter(r => (r.run_name||'').toLowerCase().includes(q) || (r.instrument||'').toLowerCase().includes(q));
      }, [dRuns, searchTerm]);

      // Auto-select first run when list loads
      useEffect(() => {
        if (dRuns.length > 0 && !selectedRun) setSelectedRun(dRuns[0]);
      }, [dRuns]);

      // ── Purge all Plotly charts when this tab unmounts ───────────────
      useEffect(() => {
        return () => {
          [corridorRef, congLeftRef, congRightRef, coverageRef, chimeraRef, breatheRef, fpARef, fpBRef].forEach(r => {
            if (r.current && window.Plotly) window.Plotly.purge(r.current);
          });
        };
      }, []);

      // ── Fetch data when run changes ──────────────────────────────────
      useEffect(() => {
        if (!selectedRun) return;
        const ac = new AbortController();
        setLoading(true);
        setData3d(null); setWindowData(null); setPasefData(null);
        Promise.all([
          fetch(API + `/api/runs/${selectedRun.id}/mobility-3d?max_features=5000`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/dia-windows`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/pasef-windows`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
        ]).then(([d3, wins, pasef]) => {
          setData3d(d3?.rt?.length ? d3 : null);
          setWindowData(wins?.windows?.length ? wins : null);
          setPasefData(pasef?.events?.length ? pasef : null);
          setLoading(false);
        }).catch(e => { if (e.name !== 'AbortError') setLoading(false); });
        return () => ac.abort();
      }, [selectedRun?.id]);

      // ── Derived: linear corridor fit per charge state ─────────────────
      const corridorFits = useMemo(() => {
        if (!data3d?.mz?.length) return {};
        const fits = {};
        [...new Set(data3d.charge)].filter(z => z > 0).forEach(z => {
          const idx = data3d.mz.map((_, i) => data3d.charge[i] === z ? i : -1).filter(i => i >= 0);
          if (idx.length < 15) return;
          const mzArr = idx.map(i => data3d.mz[i]);
          const k0Arr = idx.map(i => data3d.mobility[i]);
          const n = mzArr.length;
          const mx = mzArr.reduce((a,v)=>a+v,0)/n, my = k0Arr.reduce((a,v)=>a+v,0)/n;
          let sxx=0, sxy=0, syy=0;
          for (let i=0;i<n;i++){const dx=mzArr[i]-mx,dy=k0Arr[i]-my;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy;}
          const slope = sxy/sxx, intercept = my - slope*mx;
          const r2 = sxx>0&&syy>0 ? (sxy*sxy)/(sxx*syy) : 0;
          let rv=0; for(let i=0;i<n;i++) rv+=(k0Arr[i]-(slope*mzArr[i]+intercept))**2;
          const resStd = Math.sqrt(rv/n);
          fits[z] = { slope, intercept, r2, resStd, mzMin:Math.min(...mzArr), mzMax:Math.max(...mzArr), n };
        });
        return fits;
      }, [data3d]);

      // ── Derived: most congested m/z window (the "isolation challenge") ─
      const congestedWindow = useMemo(() => {
        if (!data3d?.mz?.length) return null;
        const bins = {};
        data3d.mz.forEach(m => { const b = Math.floor(m); bins[b] = (bins[b]||0)+1; });
        let topBin=null, topCount=0;
        for (const [b,c] of Object.entries(bins)) { if(c>topCount){topCount=c;topBin=+b;} }
        if (topBin===null) return null;
        const mzLo = topBin - 2, mzHi = topBin + 3;
        const idx = data3d.mz.map((m,i) => m>=mzLo&&m<=mzHi ? i : -1).filter(i=>i>=0);
        if (idx.length < 5) return null;
        // Cap at 400 ions for pairwise calc
        const sample = idx.length > 400 ? idx.slice(0,400) : idx;
        const ions = sample.map(i => ({ mz:data3d.mz[i], ook0:data3d.mobility[i], charge:data3d.charge[i] }));
        let coIso1D=0, coIso2D=0;
        for (let i=0;i<ions.length;i++){
          let n1=false,n2=false;
          for (let j=0;j<ions.length;j++){
            if(i===j) continue;
            if(Math.abs(ions[i].mz-ions[j].mz)<0.5){
              n1=true;
              if(Math.abs(ions[i].ook0-ions[j].ook0)<0.07){n2=true;break;}
            }
          }
          if(n1) coIso1D++; if(n2) coIso2D++;
        }
        const resolved = coIso1D > 0 ? Math.round((coIso1D-coIso2D)/coIso1D*100) : 0;
        return { mzLo, mzHi, ions, n:idx.length, coIso1D, coIso2D, resolved };
      }, [data3d]);

      // ── CHART 1: Corridor ─────────────────────────────────────────────
      useEffect(() => {
        if (!corridorRef.current || !window.Plotly) return;
        if (!data3d || !Object.keys(corridorFits).length) { window.Plotly.purge(corridorRef.current); return; }
        const traces = [];
        // Ion scatter per charge state
        const charges = [...new Set(data3d.charge)].sort((a,b)=>a-b);
        charges.forEach(z => {
          const idx = data3d.mz.map((_,i)=>data3d.charge[i]===z?i:-1).filter(i=>i>=0);
          traces.push({
            type:'scatter', mode:'markers',
            name: z===0?'Unassigned':'z = +'+z,
            x: idx.map(i=>data3d.mz[i]),
            y: idx.map(i=>data3d.mobility[i]),
            marker:{ size:2.5, color:Z_COLORS[z]||'#94a3b8', opacity:0.55 },
            hovertemplate:`m/z %{x:.2f}<br>1/K₀ %{y:.4f}<br>${z===0?'Unassigned':'z=+'+z}<extra></extra>`,
          });
        });
        // Fitted corridor lines per charge state
        Object.entries(corridorFits).forEach(([z, fit]) => {
          const col = Z_COLORS[+z] || '#94a3b8';
          const xs = [fit.mzMin, fit.mzMax];
          const ys = xs.map(m => fit.slope*m + fit.intercept);
          traces.push({
            type:'scatter', mode:'lines',
            name:`z=+${z} fit (R²=${fit.r2.toFixed(3)})`,
            x: xs, y: ys,
            line:{ color:col, width:2.5, dash:'dot' },
            hoverinfo:'skip',
          });
          // ±2σ band as a filled area (upper + lower)
          const nPts = 60;
          const mzStep = (fit.mzMax - fit.mzMin) / (nPts - 1);
          const bx = Array.from({length:nPts*2+2}, (_,i)=>{
            if(i<nPts) return fit.mzMin + i*mzStep;
            if(i===nPts) return fit.mzMax;
            if(i===nPts+1) return fit.mzMax;
            return fit.mzMin + (nPts*2+1-i)*mzStep;
          });
          const by = bx.map((m,i) => {
            const base = fit.slope*m + fit.intercept;
            return i < nPts+1 ? base + 2*fit.resStd : base - 2*fit.resStd;
          });
          const [r,g,b2] = [parseInt((Z_COLORS[+z]||'#94a3b8').slice(1,3),16), parseInt((Z_COLORS[+z]||'#94a3b8').slice(3,5),16), parseInt((Z_COLORS[+z]||'#94a3b8').slice(5,7),16)];
          traces.push({
            type:'scatter', mode:'lines', name:`z=+${z} ±2σ`,
            x:bx, y:by,
            fill:'toself', fillcolor:`rgba(${r},${g},${b2},0.07)`,
            line:{ color:'transparent' }, showlegend:false, hoverinfo:'skip',
          });
        });
        window.Plotly.react(corridorRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:20,t:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:9},x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage']});
      }, [data3d, corridorFits]);

      // ── CHART 2A: Congestion — 1D histogram ───────────────────────────
      useEffect(() => {
        if (!congLeftRef.current || !window.Plotly) return;
        if (!congestedWindow) { window.Plotly.purge(congLeftRef.current); return; }
        const { ions, mzLo, mzHi } = congestedWindow;
        const binW = 0.1, bins = {};
        ions.forEach(ion => {
          const b = +(Math.floor(ion.mz/binW)*binW).toFixed(2);
          bins[b] = (bins[b]||0)+1;
        });
        const bKeys = Object.keys(bins).map(Number).sort((a,b)=>a-b);
        window.Plotly.react(congLeftRef.current, [{
          type:'bar', x:bKeys, y:bKeys.map(k=>bins[k]),
          marker:{color:'rgba(248,113,113,0.7)', line:{color:'#ef4444',width:1}},
          hovertemplate:'m/z %{x:.2f}<br>%{y} ions<extra></extra>',
          name:'Ions per 0.1 Th bin',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:50,r:10,t:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc',range:[mzLo-0.2,mzHi+0.2]},
          yaxis:{title:{text:'Ion count',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{x:(mzLo+mzHi)/2, yref:'paper', y:0.96,
            text:`${congestedWindow.n} ions in ${(mzHi-mzLo).toFixed(0)} Th window`,
            showarrow:false, font:{color:'#f87171',size:10}}],
          showlegend:false,
        }, {responsive:true, displayModeBar:false});
      }, [congestedWindow]);

      // ── CHART 2B: Congestion — m/z × 1/K₀ scatter ────────────────────
      useEffect(() => {
        if (!congRightRef.current || !window.Plotly) return;
        if (!congestedWindow) { window.Plotly.purge(congRightRef.current); return; }
        const { ions } = congestedWindow;
        const charges = [...new Set(ions.map(p=>p.charge))].sort((a,b)=>a-b);
        const traces = charges.map(z => {
          const pts = ions.filter(p=>p.charge===z);
          return {
            type:'scatter', mode:'markers',
            name: z===0?'Unassigned':'z = +'+z,
            x:pts.map(p=>p.mz), y:pts.map(p=>p.ook0),
            marker:{size:5, color:Z_COLORS[z]||'#94a3b8', opacity:0.75},
            hovertemplate:`m/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>${z===0?'?':'z=+'+z}<extra></extra>`,
          };
        });
        window.Plotly.react(congRightRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:60,r:10,t:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',font:{size:9},x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{x:'0.5',y:0.97,xref:'paper',yref:'paper',
            text:`${congestedWindow.resolved}% resolved by mobility`,
            showarrow:false,font:{color:'#22c55e',size:10}}],
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage']});
      }, [congestedWindow]);

      // ── CHART 3: Coverage — ion cloud + actual windows ────────────────
      useEffect(() => {
        if (!coverageRef.current || !window.Plotly) return;
        if (!data3d) { window.Plotly.purge(coverageRef.current); return; }
        const hasWindows = windowData?.windows?.length || pasefData?.events?.length;
        const charges = [...new Set(data3d.charge)].sort((a,b)=>a-b);
        const traces = charges.map(z => {
          const idx = data3d.mz.map((_,i)=>data3d.charge[i]===z?i:-1).filter(i=>i>=0);
          return {
            type:'scatter', mode:'markers',
            name:z===0?'Unassigned':'z = +'+z,
            x:idx.map(i=>data3d.mz[i]), y:idx.map(i=>data3d.mobility[i]),
            marker:{size:2.5, color:Z_COLORS[z]||'#94a3b8', opacity:0.5},
            hovertemplate:`m/z %{x:.2f}<br>1/K₀ %{y:.4f}<extra>${z===0?'?':'z=+'+z}</extra>`,
          };
        });
        const shapes = [];
        const winColor = (gi, total) => {
          const h = Math.round((gi / Math.max(total,1)) * 300);
          return `hsl(${h},70%,55%)`;
        };
        if (windowData?.windows?.length) {
          const groups = [...new Set(windowData.windows.map(w=>w.window_group))];
          windowData.windows.forEach(w => {
            const col = winColor(groups.indexOf(w.window_group), groups.length);
            const hasK0 = w.oneoverk0_lower > 0 && w.oneoverk0_upper > 0;
            shapes.push({ type:'rect', x0:w.mz_lower, x1:w.mz_upper,
              y0:hasK0?w.oneoverk0_lower:0.55, y1:hasK0?w.oneoverk0_upper:1.65,
              fillcolor:`rgba(56,189,248,0.06)`, line:{color:'rgba(56,189,248,0.55)',width:1} });
          });
        }
        if (pasefData?.events?.length) {
          pasefData.events.forEach(e => {
            shapes.push({ type:'rect', x0:e.mz_lower, x1:e.mz_upper,
              y0:e.oneoverk0_lower>0?e.oneoverk0_lower:0.6, y1:e.oneoverk0_upper>0?e.oneoverk0_upper:1.6,
              fillcolor:'rgba(251,191,36,0.05)', line:{color:'rgba(251,191,36,0.50)',width:0.8} });
          });
        }
        let coveragePct = null;
        if (hasWindows && data3d.mz.length) {
          let inside = 0;
          for (let i = 0; i < data3d.mz.length; i++) {
            const m = data3d.mz[i], k = data3d.mobility[i];
            let hit = false;
            if (windowData?.windows) for (const w of windowData.windows) {
              if (m>=w.mz_lower&&m<=w.mz_upper&&(!w.oneoverk0_lower||k>=w.oneoverk0_lower&&k<=w.oneoverk0_upper)){hit=true;break;}
            }
            if (!hit && pasefData?.events) for (const e of pasefData.events) {
              if (m>=e.mz_lower&&m<=e.mz_upper&&k>=e.oneoverk0_lower&&k<=e.oneoverk0_upper){hit=true;break;}
            }
            if (hit) inside++;
          }
          coveragePct = Math.round(inside/data3d.mz.length*100);
        }
        window.Plotly.react(coverageRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:60,r:15,t:hasWindows?30:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:9},x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes,
          ...(coveragePct!==null ? {annotations:[{xref:'paper',yref:'paper',x:0.99,y:0.99,
            text:`<b>${coveragePct}%</b> of ions within a window`,
            showarrow:false,font:{color:'#38bdf8',size:11},xanchor:'right'}]} : {}),
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage']});
      }, [data3d, windowData, pasefData]);

      // ── Corridor stats summary ─────────────────────────────────────────
      const corridorSummary = useMemo(() => {
        const entries = Object.entries(corridorFits);
        if (!entries.length) return null;
        const avgR2 = entries.reduce((a,[,f])=>a+f.r2,0)/entries.length;
        const totalIons = data3d?.mz?.length || 0;
        const charges = entries.map(([z])=>'+'+z).join(', ');
        return { avgR2, totalIons, charges };
      }, [corridorFits, data3d]);

      // ── NOVEL 1: Chimera counts via spatial hash ────────────────────────
      // For each ion: how many neighbors within ±0.5 Th (1D) vs ±0.5 Th × ±0.06 Vs/cm² (2D)
      const chimeraCounts = useMemo(() => {
        if (!data3d?.mz?.length) return null;
        const n = data3d.mz.length;
        const BIN = 0.5, MOB = 0.06;
        const hash = {};
        for (let i = 0; i < n; i++) {
          const b = Math.floor(data3d.mz[i] / BIN);
          if (!hash[b]) hash[b] = [];
          hash[b].push(i);
        }
        const n1D = new Int16Array(n);
        const n2D = new Int16Array(n);
        for (let i = 0; i < n; i++) {
          const bC = Math.floor(data3d.mz[i] / BIN);
          for (const b of [bC-1, bC, bC+1]) {
            const bucket = hash[b]; if (!bucket) continue;
            for (const j of bucket) {
              if (j === i) continue;
              if (Math.abs(data3d.mz[j] - data3d.mz[i]) < BIN) {
                n1D[i]++;
                if (Math.abs(data3d.mobility[j] - data3d.mobility[i]) < MOB) n2D[i]++;
              }
            }
          }
        }
        const max1D = Math.max(...n1D), max2D = Math.max(...n2D);
        // overall stats
        let chimeric1D = 0, chimeric2D = 0;
        for (let i = 0; i < n; i++) { if(n1D[i]>0) chimeric1D++; if(n2D[i]>0) chimeric2D++; }
        const resolvedPct = chimeric1D > 0 ? Math.round((chimeric1D-chimeric2D)/chimeric1D*100) : 0;
        return { n1D, n2D, max1D, max2D, chimeric1D, chimeric2D, resolvedPct, n };
      }, [data3d]);

      // ── NOVEL 2: Breathing Proteome — RT-sliced ion cloud ─────────────
      const rtRunRange = useMemo(() => {
        if (!data3d?.rt?.length) return [0, 3600];
        return [Math.min(...data3d.rt), Math.max(...data3d.rt)];
      }, [data3d]);

      const breatheIons = useMemo(() => {
        if (!data3d?.rt?.length) return null;
        const [rtLo, rtHi] = rtRunRange;
        const rtCenter = rtLo + (rtHi - rtLo) * rtSliderPct / 100;
        const halfWin = (rtHi - rtLo) * 0.04;  // ±4% of run = typical 5–10 min window
        const idx = [];
        for (let i = 0; i < data3d.rt.length; i++) {
          if (Math.abs(data3d.rt[i] - rtCenter) <= halfWin) idx.push(i);
        }
        return {
          mz:       idx.map(i => data3d.mz[i]),
          mobility: idx.map(i => data3d.mobility[i]),
          charge:   idx.map(i => data3d.charge[i]),
          logInt:   idx.map(i => data3d.log_int[i]),
          rtCenter, halfWin, n: idx.length,
        };
      }, [data3d, rtSliderPct, rtRunRange]);

      // ── NOVEL 3: Orthogonality index ───────────────────────────────────
      const orthoScore = useMemo(() => {
        if (!data3d?.mz?.length || !chimeraCounts) return null;
        // Disambiguation rate: fraction of 1D-chimeric ions resolved by mobility
        const { chimeric1D, chimeric2D, resolvedPct } = chimeraCounts;
        // Per-charge corridor tightness (median |residual| / charge mobility range)
        const perCharge = {};
        Object.entries(corridorFits).forEach(([z, fit]) => {
          const idx = data3d.mz.map((_,i)=>data3d.charge[i]===+z?i:-1).filter(i=>i>=0);
          const k0Arr = idx.map(i => data3d.mobility[i]);
          const k0Range = Math.max(...k0Arr) - Math.min(...k0Arr);
          // "Mobility lanes": how many FWHM-resolved bands fit in the charge state's k0 range
          const fwhm = fit.resStd * 2.355;
          const lanes = k0Range / fwhm;
          perCharge[z] = { lanes: lanes.toFixed(1), fwhm: fwhm.toFixed(4), k0Range: k0Range.toFixed(3) };
        });
        const avgLanes = Object.values(perCharge).reduce((a,v)=>a+parseFloat(v.lanes),0) / Math.max(Object.keys(perCharge).length,1);
        return { resolvedPct, chimeric1D, chimeric2D, perCharge, avgLanes: avgLanes.toFixed(1) };
      }, [chimeraCounts, corridorFits, data3d]);

      // ── NOVEL 4: Density fingerprint grid ─────────────────────────────
      function buildDensityGrid(mzArr, k0Arr, W=80, H=60) {
        const MZ_LO=300, MZ_HI=1500, K0_LO=0.5, K0_HI=1.78;
        // Regular arrays (not TypedArrays) so .flat() works for Pearson correlation
        const grid = Array.from({length:H}, ()=>Array(W).fill(0));
        const mzS = (MZ_HI-MZ_LO), k0S = (K0_HI-K0_LO);
        for (let i=0;i<mzArr.length;i++){
          const gx=Math.min(W-1,Math.max(0,Math.floor((mzArr[i]-MZ_LO)/mzS*W)));
          const gy=Math.min(H-1,Math.max(0,Math.floor((k0Arr[i]-K0_LO)/k0S*H)));
          grid[gy][gx]++;
        }
        let maxV=0; for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(grid[y][x]>maxV) maxV=grid[y][x];
        if(maxV>0) for(let y=0;y<H;y++) for(let x=0;x<W;x++) grid[y][x]/=maxV;
        return {grid, W, H, MZ_LO, MZ_HI, K0_LO, K0_HI};
      }

      const densityA = useMemo(() => {
        if (!data3d?.mz?.length) return null;
        return buildDensityGrid(data3d.mz, data3d.mobility);
      }, [data3d]);

      const densityB = useMemo(() => {
        if (!data3d2?.mz?.length) return null;
        return buildDensityGrid(data3d2.mz, data3d2.mobility);
      }, [data3d2]);

      // ── Fetch second run for comparison ───────────────────────────────
      useEffect(() => {
        if (!selectedRun2) return;
        const ac = new AbortController();
        setLoadingCompare(true); setData3d2(null);
        fetch(API + `/api/runs/${selectedRun2.id}/mobility-3d?max_features=5000`, {signal:ac.signal})
          .then(r => r.ok ? r.json() : {})
          .then(d => { setData3d2(d?.rt?.length ? d : null); setLoadingCompare(false); })
          .catch(e => { if (e.name !== 'AbortError') setLoadingCompare(false); });
        return () => ac.abort();
      }, [selectedRun2?.id]);

      // ── Animation RAF for breathing ────────────────────────────────────
      useEffect(() => {
        if (!playing) { if (playAnimRef.current) cancelAnimationFrame(playAnimRef.current); return; }
        const FPS = 14;
        const step = ts => {
          if (ts - playLastRef.current >= 1000/FPS) {
            setRtSliderPct(p => { const n = +(p + 1.2).toFixed(1); if(n>100){setPlaying(false);return 0;} return n; });
            playLastRef.current = ts;
          }
          playAnimRef.current = requestAnimationFrame(step);
        };
        playAnimRef.current = requestAnimationFrame(step);
        return () => { if(playAnimRef.current) cancelAnimationFrame(playAnimRef.current); };
      }, [playing]);

      // ── CHART: Chimera Probability Map ────────────────────────────────
      useEffect(() => {
        if (!chimeraRef.current || !window.Plotly) return;
        if (!data3d || !chimeraCounts) { window.Plotly.purge(chimeraRef.current); return; }
        const { n1D, max1D } = chimeraCounts;
        const n = data3d.mz.length;
        // Use a continuous color scale: green (0 neighbors) → yellow → red (many neighbors)
        const colors = [];
        for (let i = 0; i < n; i++) {
          const t = max1D > 0 ? Math.min(1, n1D[i] / Math.max(max1D * 0.5, 1)) : 0;
          // Green → Yellow → Red
          if (t < 0.5) { const f=t*2; colors.push(`rgb(${Math.round(34+f*(255-34))},${Math.round(197+f*(215-197))},${Math.round(94+f*0)})`); }
          else { const f=(t-0.5)*2; colors.push(`rgb(255,${Math.round(215-f*215)},0)`); }
        }
        window.Plotly.react(chimeraRef.current, [{
          type:'scatter', mode:'markers',
          x: data3d.mz, y: data3d.mobility,
          marker:{ size:2.5, color:colors, opacity:0.65 },
          hovertemplate:'m/z %{x:.2f}<br>1/K₀ %{y:.4f}<br>%{text}<extra></extra>',
          text: Array.from(n1D).map(v => v===0?'clean — no m/z neighbors':`${v} neighbor${v>1?'s':''} in 1D isolation window`),
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:60,r:20,t:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          showlegend:false,
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage']});
      }, [data3d, chimeraCounts]);

      // ── CHART: Breathing Proteome ──────────────────────────────────────
      useEffect(() => {
        if (!breatheRef.current || !window.Plotly) return;
        if (!breatheIons) { window.Plotly.purge(breatheRef.current); return; }
        const charges = [...new Set(breatheIons.charge)].sort((a,b)=>a-b);
        const traces = charges.map(z => {
          const idx = breatheIons.charge.map((_,i)=>breatheIons.charge[i]===z?i:-1).filter(i=>i>=0);
          const li = idx.map(i=>breatheIons.logInt[i]);
          const liMax = Math.max(...li)||1;
          return {
            type:'scatter', mode:'markers',
            name: z===0?'Unassigned':'z = +'+z,
            x: idx.map(i=>breatheIons.mz[i]),
            y: idx.map(i=>breatheIons.mobility[i]),
            marker:{ size:idx.map(i=>2+breatheIons.logInt[i]/liMax*4), color:Z_COLORS[z]||'#94a3b8', opacity:0.65 },
            hovertemplate:`m/z %{x:.2f}<br>1/K₀ %{y:.4f}<extra>${z===0?'?':'z=+'+z}</extra>`,
          };
        });
        const rtMin = breatheIons.rtCenter - breatheIons.halfWin;
        const rtMax = breatheIons.rtCenter + breatheIons.halfWin;
        window.Plotly.react(breatheRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:60,r:20,t:30,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',font:{size:9},x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{xref:'paper',yref:'paper',x:0.5,y:1.04,
            text:`RT ${(breatheIons.rtCenter/60).toFixed(2)} min  ·  ±${(breatheIons.halfWin/60).toFixed(2)} min window  ·  ${breatheIons.n.toLocaleString()} ions`,
            showarrow:false,font:{color:'#38bdf8',size:10},xanchor:'center'}],
        }, {responsive:true, displayModeBar:false});
      }, [breatheIons]);

      // ── CHART: Fingerprint heatmaps ────────────────────────────────────
      useEffect(() => {
        if (!fpARef.current || !window.Plotly || !densityA) return;
        const { grid, W, H, MZ_LO, MZ_HI, K0_LO, K0_HI } = densityA;
        const mzTicks = Array.from({length:W},(_,i)=>+(MZ_LO+i*(MZ_HI-MZ_LO)/W).toFixed(0));
        const k0Ticks = Array.from({length:H},(_,i)=>+(K0_LO+i*(K0_HI-K0_LO)/H).toFixed(3));
        const plotLayout = {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:10}, margin:{l:60,r:15,t:30,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},color:'#a0b4cc',tickfont:{size:9}},
          yaxis:{title:{text:'1/K₀',font:{size:11}},color:'#a0b4cc',tickfont:{size:9}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:10}},
        };
        window.Plotly.react(fpARef.current, [{
          type:'heatmap', x:mzTicks, y:k0Ticks, z:grid,
          colorscale:'Viridis', showscale:false,
          hovertemplate:'m/z %{x}<br>1/K₀ %{y}<br>density %{z:.3f}<extra>Run A</extra>',
        }], {...plotLayout, title:{text:'Run A',font:{color:'#38bdf8',size:11}}},
        {responsive:true, displayModeBar:false});
      }, [densityA]);

      useEffect(() => {
        if (!fpBRef.current || !window.Plotly) return;
        if (!densityB) { window.Plotly.purge(fpBRef.current); return; }
        const { grid, W, H, MZ_LO, MZ_HI, K0_LO, K0_HI } = densityB;
        const mzTicks = Array.from({length:W},(_,i)=>+(MZ_LO+i*(MZ_HI-MZ_LO)/W).toFixed(0));
        const k0Ticks = Array.from({length:H},(_,i)=>+(K0_LO+i*(K0_HI-K0_LO)/H).toFixed(3));
        window.Plotly.react(fpBRef.current, [{
          type:'heatmap', x:mzTicks, y:k0Ticks, z:grid,
          colorscale:'Viridis', showscale:false,
          hovertemplate:'m/z %{x}<br>1/K₀ %{y}<br>density %{z:.3f}<extra>Run B</extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:10}, margin:{l:60,r:15,t:30,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀',font:{size:11}},color:'#a0b4cc'},
          title:{text:'Run B',font:{color:'#22c55e',size:11}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:10}},
        }, {responsive:true, displayModeBar:false});
      }, [densityB]);

      useEffect(() => {
        if (!fpDiffRef.current || !window.Plotly || !densityA || !densityB) return;
        const { W, H, MZ_LO, MZ_HI, K0_LO, K0_HI } = densityA;
        const diffGrid = densityA.grid.map((row, y) =>
          Array.from(row).map((v, x) => v - densityB.grid[y][x])
        );
        const mzTicks = Array.from({length:W},(_,i)=>+(MZ_LO+i*(MZ_HI-MZ_LO)/W).toFixed(0));
        const k0Ticks = Array.from({length:H},(_,i)=>+(K0_LO+i*(K0_HI-K0_LO)/H).toFixed(3));
        // Pearson r of flattened grids
        const a = densityA.grid.flat(), b2 = densityB.grid.map(r=>Array.from(r)).flat();
        const n = a.length;
        const ma = a.reduce((s,v)=>s+v,0)/n, mb = b2.reduce((s,v)=>s+v,0)/n;
        let num=0, sa=0, sb=0;
        for(let i=0;i<n;i++){const da=a[i]-ma,db=b2[i]-mb;num+=da*db;sa+=da*da;sb+=db*db;}
        const similarity = sa>0&&sb>0 ? (num/Math.sqrt(sa*sb)*100).toFixed(1) : 'N/A';
        window.Plotly.react(fpDiffRef.current, [{
          type:'heatmap', x:mzTicks, y:k0Ticks, z:diffGrid,
          colorscale:[['0','#ef4444'],['0.5','#1e3a5f'],['1','#22c55e']],
          zmid:0, showscale:true, colorbar:{tickfont:{size:9},len:0.7},
          hovertemplate:'m/z %{x}<br>1/K₀ %{y}<br>A−B %{z:.3f}<extra>Difference</extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:10}, margin:{l:60,r:55,t:30,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀',font:{size:11}},color:'#a0b4cc'},
          title:{text:`A − B  ·  similarity ${similarity}%`,font:{color:'#f59e0b',size:11}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:10}},
        }, {responsive:true, displayModeBar:false});
      }, [densityA, densityB]);

      // ── Render ─────────────────────────────────────────────────────────
      const hasData = data3d && data3d.mz?.length;
      const hasWindows = windowData?.windows?.length || pasefData?.events?.length;

      return (
        <div style={{maxWidth:'1200px',margin:'0 auto',padding:'1rem 0.5rem 2rem'}}>

          {/* ── Run Selector ── */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1rem'}}>
            <div style={{display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
              <div>
                <div style={{color:'var(--accent)',fontWeight:700,fontSize:'0.82rem',marginBottom:'0.2rem'}}>4D Advantage</div>
                <div style={{color:'var(--muted)',fontSize:'0.75rem'}}>How ion mobility transforms YOUR data — computed live from each run</div>
              </div>
              <div style={{flex:1,minWidth:'200px',maxWidth:'380px'}}>
                <input placeholder="Search runs…" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                  style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.35rem',padding:'0.35rem 0.6rem',fontSize:'0.82rem'}} />
              </div>
              <select value={selectedRun?.id||''} onChange={e=>{const r=dRuns.find(r=>String(r.id)===e.target.value);if(r)setSelectedRun(r);}}
                style={{flex:1,minWidth:'200px',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.35rem',padding:'0.35rem 0.6rem',fontSize:'0.82rem'}}>
                {filteredRuns.map(r=><option key={r.id} value={r.id}>{r.run_name||r.id} · {r.instrument||''}</option>)}
              </select>
            </div>
          </div>

          {(loading || runsLoading) && <div style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>Loading ion data…</div>}
          {!loading && !runsLoading && dRuns.length === 0 && (
            <div style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>No Bruker .d runs found. Ion mobility data requires timsTOF acquisitions.</div>
          )}

          {hasData && !loading && (() => {
            return (
              <>
                {/* ═══════════ SECTION 1: THE CORRIDOR ═══════════════════════ */}
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <h3 style={{margin:0,fontSize:'1.05rem'}}>
                          Your Peptide Corridor
                          <span style={{marginLeft:'0.6rem',background:'rgba(56,189,248,0.1)',border:'1px solid rgba(56,189,248,0.3)',color:'var(--accent)',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>
                            LIVE DATA
                          </span>
                        </h3>
                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                          Each charge state forms a predictable diagonal lane in m/z × 1/K₀ space.
                          Dashed lines = fitted corridor · shaded band = ±2σ · tighter = better instrument health.
                        </div>
                      </div>
                      {corridorSummary && (
                        <div style={{display:'flex',gap:'1.2rem',flexWrap:'wrap'}}>
                          {Object.entries(corridorFits).map(([z,f])=>(
                            <div key={z} style={{textAlign:'center'}}>
                              <div style={{color:Z_COLORS[+z]||'#94a3b8',fontWeight:700,fontSize:'1.1rem'}}>R²={f.r2.toFixed(3)}</div>
                              <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>z=+{z} corridor</div>
                            </div>
                          ))}
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'var(--accent)',fontWeight:700,fontSize:'1.1rem'}}>{corridorSummary.totalIons.toLocaleString()}</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>total ions</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div ref={corridorRef} style={{height:'440px'}} />
                  <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                    <span style={{color:'var(--accent)',fontWeight:600}}>Why this matters: </span>
                    Peptides of each charge state fall along a predictable CCS–mass law. Chemical noise (lipids, matrix, contaminants) falls outside these lanes and is filtered automatically by the TIMS funnel — before fragmentation.
                    A high R² (close to 1.000) means ions are tightly confined to their corridor, indicating excellent ionization and accumulation conditions.
                  </div>
                </div>

                {/* ═══════════ SECTION 2: THE ISOLATION CHALLENGE ════════════ */}
                {congestedWindow && (
                  <div className="card" style={{marginBottom:'1rem'}}>
                    <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                        <div style={{flex:1}}>
                          <h3 style={{margin:0,fontSize:'1.05rem'}}>
                            The Isolation Challenge — Your Most Crowded m/z Window
                            <span style={{marginLeft:'0.6rem',background:'rgba(56,189,248,0.1)',border:'1px solid rgba(56,189,248,0.3)',color:'var(--accent)',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>
                              AUTO-DETECTED
                            </span>
                          </h3>
                          <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                            Auto-detected: densest {(congestedWindow.mzHi-congestedWindow.mzLo).toFixed(0)} Th window = m/z {congestedWindow.mzLo.toFixed(0)}–{congestedWindow.mzHi.toFixed(0)} ·
                            left = what a traditional mass spectrometer sees · right = what ion mobility reveals
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'1.2rem'}}>
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'#f87171',fontWeight:700,fontSize:'1.3rem'}}>{congestedWindow.coIso1D}</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>ions co-isolated in 1D</div>
                          </div>
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'#22c55e',fontWeight:700,fontSize:'1.3rem'}}>{congestedWindow.resolved}%</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>resolved by mobility</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0'}}>
                      <div style={{borderRight:'1px solid var(--border)'}}>
                        <div style={{padding:'0.4rem 0.8rem',background:'rgba(248,113,113,0.05)',fontSize:'0.75rem',color:'#f87171',fontWeight:600,borderBottom:'1px solid var(--border)'}}>
                          Without ion mobility — all overlapping
                        </div>
                        <div ref={congLeftRef} style={{height:'300px'}} />
                      </div>
                      <div>
                        <div style={{padding:'0.4rem 0.8rem',background:'rgba(34,197,94,0.05)',fontSize:'0.75rem',color:'#22c55e',fontWeight:600,borderBottom:'1px solid var(--border)'}}>
                          With ion mobility — separated by CCS
                        </div>
                        <div ref={congRightRef} style={{height:'300px'}} />
                      </div>
                    </div>
                    <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                      <span style={{color:'var(--accent)',fontWeight:600}}>Why this matters: </span>
                      In a 5 Th isolation window, {congestedWindow.coIso1D} ions are co-isolated — their fragment spectra mix together, creating chimeric MS2 that database search engines struggle to interpret.
                      Ion mobility resolves {congestedWindow.resolved}% of these before fragmentation, producing cleaner spectra and more confident peptide identifications.
                    </div>
                  </div>
                )}

                {/* ═══════════ SECTION 3: WINDOW COVERAGE ════════════════════ */}
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                    <h3 style={{margin:0,fontSize:'1.05rem'}}>
                      {hasWindows ? 'Your Method Coverage — Isolation Windows vs Ion Cloud' : 'Ion Cloud — Charge State Separation'}
                    </h3>
                    <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                      {hasWindows
                        ? (windowData ? 'diaPASEF windows (blue) overlaid on your actual ion cloud — each box captures only ions within that m/z × 1/K₀ region'
                                      : 'PASEF events (amber) overlaid on your actual ion cloud — each box = one ddaPASEF precursor isolation event')
                        : 'Ion cloud colored by charge state — visible separation between charge lanes demonstrates mobility resolving power'
                      }
                    </div>
                  </div>
                  <div ref={coverageRef} style={{height:'440px'}} />
                  <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                    <span style={{color:'var(--accent)',fontWeight:600}}>Why this matters: </span>
                    {hasWindows
                      ? 'Each isolation window in m/z × 1/K₀ space captures far fewer co-isolated precursors than a traditional DIA window of the same m/z range alone. The TIMS dimension multiplies the effective resolution of every isolation event.'
                      : 'Even without method windows, the charge state lanes are clearly separated in mobility — enabling Bruker\'s TIMS-based charge state assignment and making fragment spectra dramatically cleaner by pre-separating charge states.'
                    }
                  </div>
                </div>

                {/* ═══════ NOVEL 1: CHIMERA PROBABILITY MAP ══════════════════ */}
                {chimeraCounts && (
                  <div className="card" style={{marginBottom:'1rem'}}>
                    <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                        <div style={{flex:1}}>
                          <h3 style={{margin:0,fontSize:'1.05rem'}}>
                            Chimera Probability Map
                            <span style={{marginLeft:'0.6rem',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.35)',color:'#f87171',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>NOVEL</span>
                          </h3>
                          <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                            Every ion colored by how many co-isolation neighbors it would have in a traditional ±0.5 Th window.
                            <span style={{color:'#22c55e'}}> Green = clean isolation.</span>
                            <span style={{color:'#f87171'}}> Red = guaranteed chimeric MS2.</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'1.5rem',flexShrink:0}}>
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'#f87171',fontWeight:800,fontSize:'1.5rem'}}>{Math.round(chimeraCounts.chimeric1D/chimeraCounts.n*100)}%</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>chimeric in 1D</div>
                          </div>
                          <div style={{textAlign:'center',fontSize:'1.5rem',color:'var(--muted)',fontWeight:300,lineHeight:'1.8rem'}}>→</div>
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'#22c55e',fontWeight:800,fontSize:'1.5rem'}}>{Math.round(chimeraCounts.chimeric2D/chimeraCounts.n*100)}%</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>still chimeric with IM</div>
                          </div>
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'var(--accent)',fontWeight:800,fontSize:'1.5rem'}}>{chimeraCounts.resolvedPct}%</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>resolved by mobility</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div ref={chimeraRef} style={{height:'420px'}} />
                    <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                      <span style={{color:'var(--accent)',fontWeight:600}}>First-ever per-ion chimera risk map: </span>
                      Red clusters reveal the "danger zones" in m/z × 1/K₀ space where traditional DIA produces the most contaminated MS2 spectra.
                      These are the exact regions where diaPASEF and TIMS-based isolation provide the largest benefit — visible directly in your data.
                    </div>
                  </div>
                )}

                {/* ═══════ NOVEL 2: BREATHING PROTEOME ══════════════════════ */}
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <h3 style={{margin:0,fontSize:'1.05rem'}}>
                          The Breathing Proteome
                          <span style={{marginLeft:'0.6rem',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.35)',color:'#f87171',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>NOVEL</span>
                        </h3>
                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                          Watch the ion cloud evolve as the LC gradient progresses — scrub the timeline or press Play.
                          Early gradient: small, basic peptides. Mid: tryptic bulk. Late: large hydrophobic peptides shift the cloud.
                          Size = intensity.
                        </div>
                      </div>
                      <div style={{display:'flex',gap:'0.6rem',alignItems:'center',flexShrink:0}}>
                        <button onClick={()=>{setPlaying(p=>!p);}}
                          style={{padding:'0.3rem 0.9rem',background:playing?'#f59e0b':'rgba(56,189,248,0.12)',color:playing?'#000':'var(--accent)',border:`1px solid ${playing?'#f59e0b':'rgba(56,189,248,0.4)'}`,borderRadius:'0.4rem',cursor:'pointer',fontWeight:700,fontSize:'0.82rem',whiteSpace:'nowrap'}}>
                          {playing ? '⏸ Pause' : '▶ Play'}
                        </button>
                        <button onClick={()=>{setPlaying(false);setRtSliderPct(0);}}
                          style={{padding:'0.3rem 0.6rem',background:'transparent',color:'var(--muted)',border:'1px solid var(--border)',borderRadius:'0.4rem',cursor:'pointer',fontSize:'0.78rem'}}>
                          ↺ Reset
                        </button>
                        <span style={{color:'var(--accent)',fontWeight:700,fontSize:'0.88rem',whiteSpace:'nowrap'}}>
                          {breatheIons ? (breatheIons.rtCenter/60).toFixed(2) : '—'} min
                        </span>
                      </div>
                    </div>
                    <div style={{padding:'0.5rem 0 0'}}>
                      <input type="range" min="0" max="100" step="0.5" value={rtSliderPct}
                        onChange={e=>{setPlaying(false);setRtSliderPct(+e.target.value);}}
                        style={{width:'100%',accentColor:'var(--accent)',cursor:'pointer'}} />
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem'}}>
                        <span>{(rtRunRange[0]/60).toFixed(1)} min</span>
                        <span style={{color:'var(--accent)'}}>← drag to scrub timeline →</span>
                        <span>{(rtRunRange[1]/60).toFixed(1)} min</span>
                      </div>
                    </div>
                  </div>
                  <div ref={breatheRef} style={{height:'400px'}} />
                  <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                    <span style={{color:'var(--accent)',fontWeight:600}}>What you're seeing: </span>
                    The proteome literally "breathes" through mobility space over the gradient. Early peptides cluster in lower m/z, higher mobility regions.
                    As the gradient progresses, larger hydrophobic peptides elute — shifting the cloud toward higher m/z and mobility.
                    This animation cannot be shown in any static 2D plot — it requires the 4th (RT) dimension.
                  </div>
                </div>

                {/* ═══════ NOVEL 3: ORTHOGONALITY INDEX ════════════════════ */}
                {orthoScore && (
                  <div className="card" style={{marginBottom:'1rem'}}>
                    <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                      <h3 style={{margin:0,fontSize:'1.05rem'}}>
                        Mobility Orthogonality Index
                        <span style={{marginLeft:'0.6rem',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.35)',color:'#f87171',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>NOVEL METRIC</span>
                      </h3>
                      <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                        How much new, independent information does ion mobility add to this run beyond m/z alone?
                        Measured as: fraction of would-be chimeric ion pairs that mobility resolves + resolvable mobility bands per charge lane.
                      </div>
                    </div>
                    <div style={{padding:'1.2rem',display:'flex',gap:'1.5rem',flexWrap:'wrap',alignItems:'flex-start'}}>
                      {/* Big donut-style metric */}
                      <div style={{textAlign:'center',minWidth:'140px'}}>
                        <div style={{fontSize:'3.2rem',fontWeight:900,lineHeight:1,
                          background:`linear-gradient(135deg, #22c55e, #38bdf8)`,
                          WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text'}}>
                          {orthoScore.resolvedPct}%
                        </div>
                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>chimeric ions resolved<br/>by mobility</div>
                      </div>
                      <div style={{flex:1,minWidth:'200px'}}>
                        <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.5rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em'}}>Resolvable Mobility Bands per Charge Lane</div>
                        {Object.entries(orthoScore.perCharge).map(([z, info]) => (
                          <div key={z} style={{display:'flex',alignItems:'center',gap:'0.8rem',marginBottom:'0.5rem'}}>
                            <div style={{width:'30px',fontWeight:700,color:Z_COLORS[+z]||'#94a3b8',fontSize:'0.82rem'}}>z=+{z}</div>
                            <div style={{flex:1,height:'14px',background:'rgba(255,255,255,0.05)',borderRadius:'2px',overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${Math.min(100,parseFloat(info.lanes)/20*100)}%`,
                                background:`linear-gradient(90deg, ${Z_COLORS[+z]||'#94a3b8'}88, ${Z_COLORS[+z]||'#94a3b8'})`,
                                borderRadius:'2px',transition:'width 0.4s'}} />
                            </div>
                            <div style={{width:'80px',fontSize:'0.78rem',color:'var(--text)',textAlign:'right'}}>{info.lanes} bands</div>
                            <div style={{width:'90px',fontSize:'0.72rem',color:'var(--muted)'}}>FWHM {info.fwhm} Vs/cm²</div>
                          </div>
                        ))}
                        <div style={{marginTop:'0.6rem',fontSize:'0.75rem',color:'var(--muted)'}}>
                          Average across charge states: <span style={{color:'var(--accent)',fontWeight:700}}>{orthoScore.avgLanes} resolvable bands</span>
                          &nbsp;·&nbsp; each band = a distinct mobility position that IM can uniquely isolate
                        </div>
                      </div>
                      <div style={{minWidth:'180px',background:'rgba(255,255,255,0.03)',border:'1px solid var(--border)',borderRadius:'0.5rem',padding:'0.8rem'}}>
                        <div style={{color:'var(--muted)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'0.5rem'}}>Isolation Stats</div>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'0.3rem'}}>
                          <span style={{color:'var(--muted)',fontSize:'0.78rem'}}>1D chimeric ions</span>
                          <span style={{color:'#f87171',fontWeight:700}}>{orthoScore.chimeric1D.toLocaleString()}</span>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'0.3rem'}}>
                          <span style={{color:'var(--muted)',fontSize:'0.78rem'}}>2D chimeric ions</span>
                          <span style={{color:'#f59e0b',fontWeight:700}}>{orthoScore.chimeric2D.toLocaleString()}</span>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between'}}>
                          <span style={{color:'var(--muted)',fontSize:'0.78rem'}}>Resolved by IM</span>
                          <span style={{color:'#22c55e',fontWeight:700}}>{(orthoScore.chimeric1D-orthoScore.chimeric2D).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                      <span style={{color:'var(--accent)',fontWeight:600}}>Novel instrument QC metric: </span>
                      The Mobility Orthogonality Index quantifies exactly how much analytical value ion mobility adds to this specific experiment.
                      High scores ({'>'}70%) indicate the TIMS dimension is operating at full resolving power and dramatically reducing co-isolation.
                      This metric does not exist in any other proteomics QC software.
                    </div>
                  </div>
                )}

                {/* ═══════ NOVEL 4: 4D RUN FINGERPRINT ═════════════════════ */}
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <h3 style={{margin:0,fontSize:'1.05rem'}}>
                          4D Run Fingerprint — Density Comparison
                          <span style={{marginLeft:'0.6rem',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.35)',color:'#f87171',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>NOVEL</span>
                        </h3>
                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                          Each run leaves a unique 2D density signature in m/z × 1/K₀ space — a "fingerprint" that captures proteome composition, instrument condition, and sample prep quality.
                          Compare any two runs to see exactly where they differ.
                        </div>
                      </div>
                      <div style={{display:'flex',gap:'0.6rem',alignItems:'center',flexShrink:0,flexWrap:'wrap'}}>
                        <span style={{color:'var(--muted)',fontSize:'0.78rem'}}>Compare with:</span>
                        <select value={selectedRun2?.id||''} onChange={e=>{const r=dRuns.find(r=>String(r.id)===e.target.value);setSelectedRun2(r||null);}}
                          style={{background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.35rem',padding:'0.3rem 0.5rem',fontSize:'0.78rem',maxWidth:'260px'}}>
                          <option value="">— select run B —</option>
                          {dRuns.filter(r=>r.id!==selectedRun?.id).map(r=><option key={r.id} value={r.id}>{r.run_name||r.id}</option>)}
                        </select>
                        {loadingCompare && <span style={{color:'var(--muted)',fontSize:'0.75rem'}}>loading…</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:`1fr ${densityB?'1fr 1fr':''}`,gap:'0',borderTop:'none'}}>
                    <div style={{borderRight: densityB ? '1px solid var(--border)' : 'none'}}>
                      <div ref={fpARef} style={{height:'280px'}} />
                    </div>
                    {densityB && (<>
                      <div style={{borderRight:'1px solid var(--border)'}}>
                        <div ref={fpBRef} style={{height:'280px'}} />
                      </div>
                      <div>
                        <div ref={fpDiffRef} style={{height:'280px'}} />
                      </div>
                    </>)}
                  </div>
                  {!densityB && (
                    <div style={{padding:'1.5rem',textAlign:'center',color:'var(--muted)',fontSize:'0.85rem',borderTop:'1px solid var(--border)'}}>
                      Select a second run above to see the density difference map and similarity score
                    </div>
                  )}
                  <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                    <span style={{color:'var(--accent)',fontWeight:600}}>Novel run comparison: </span>
                    The difference map (A−B) reveals structural changes invisible to peptide-list comparison: green regions = ions present in run A but absent in B (e.g. sample prep loss, column degradation at specific m/z × mobility coordinates).
                    Red regions = ions gained. A similarity score near 100% indicates identical proteome composition and instrument state.
                  </div>
                </div>

              </>
            );
          })()}
        </div>
      );
    }

    /* ── Ion Mobility Tab ───────────────────────────────────────────── */

    function MobilityTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [searchTerm, setSearchTerm] = useState('');
      const [mapData, setMapData] = useState(null);
      const [statsData, setStatsData] = useState(null);
      const [windowData, setWindowData] = useState(null);
      const [data3d, setData3d] = useState(null);
      const [pasefData, setPasefData] = useState(null);
      const [panelLoading, setPanelLoading] = useState(false);
      const [showWindowOverlay, setShowWindowOverlay] = useState(false);
      const [showPasefOverlay, setShowPasefOverlay] = useState(false);
      const canvasRef       = useRef(null);
      const plot3dRef       = useRef(null);
      const mzLandscapeRef  = useRef(null);
      const waterfallRef    = useRef(null);
      const cloudMzRef      = useRef(null);   // m/z vs 1/K₀ (Tenzer style)
      const cloudRtRef      = useRef(null);   // RT vs 1/K₀ (Kulej style)
      const coverageRef     = useRef(null);   // coverage: inside vs outside windows
      const pasefPolygonRef = useRef(null);   // PASEF polygon view

      // Ion detail panel (click-to-inspect)
      const [ionTarget, setIonTarget]       = useState(null);  // {mz, rt, ook0, charge}
      const [ionDetail, setIonDetail]       = useState(null);
      const [ionLoading, setIonLoading]     = useState(false);
      const xicRef                          = useRef(null);
      const mobilogramRef                   = useRef(null);
      const frameHeatmapRef                 = useRef(null);
      const frameSpectrumRef                = useRef(null);
      const [frameHeatmap, setFrameHeatmap] = useState(null);
      const [frameSpectrum, setFrameSpectrum] = useState(null);
      // Refs that let Plotly event handlers read latest React state without stale closures
      const filteredData3dRef               = useRef(null);
      const selectedRunRef                  = useRef(null);

      // Window group → colour (cycles through palette)
      const WIN_PALETTE = ['#3b82f6','#22c55e','#f97316','#a855f7','#06b6d4','#f59e0b','#ec4899','#14b8a6'];
      const winColor = (groupIdx) => WIN_PALETTE[groupIdx % WIN_PALETTE.length];

      // Charge colours — 0=unassigned (gold), 1=teal, 2=blue, 3=green, 4=orange, 5=purple, 6=red
      const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
      const CHARGE_LABEL  = {0:'?',1:'+1',2:'+2',3:'+3',4:'+4',5:'+5',6:'+6'};
      const CHARGE_TITLE  = {0:'Unassigned — charge state could not be determined during acquisition',1:'+1 singly-charged',2:'+2',3:'+3',4:'+4',5:'+5',6:'+6'};

      // ── 3D filter state ──────────────────────────────────────────────
      const [filterCharges, setFilterCharges] = useState(new Set()); // empty = all
      const [filterMzMin, setFilterMzMin] = useState('');
      const [filterMzMax, setFilterMzMax] = useState('');
      const [filterRtMin, setFilterRtMin] = useState('');
      const [filterRtMax, setFilterRtMax] = useState('');
      const [filterOok0Min, setFilterOok0Min] = useState('');
      const [filterOok0Max, setFilterOok0Max] = useState('');
      const [showFilters, setShowFilters] = useState(false);
      const [autoRotate, setAutoRotate]   = useState(true);
      const rotateAnimRef     = useRef(null);
      const rotateAngleRef    = useRef(0);
      const rotateLastTimeRef = useRef(0);

      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.raw_path && r.raw_path.endsWith('.d'));
      }, [allRuns]);

      const filtered = useMemo(() => {
        if (!searchTerm) return dRuns;
        const q = searchTerm.toLowerCase();
        return dRuns.filter(r =>
          (r.run_name || '').toLowerCase().includes(q) ||
          (r.instrument || '').toLowerCase().includes(q)
        );
      }, [dRuns, searchTerm]);

      // ── Purge all Plotly charts when this tab unmounts ───────────────
      useEffect(() => {
        return () => {
          [plot3dRef, mzLandscapeRef, waterfallRef, cloudMzRef, cloudRtRef, coverageRef, pasefPolygonRef,
           xicRef, mobilogramRef, frameHeatmapRef, frameSpectrumRef].forEach(r => {
            if (r.current && window.Plotly) window.Plotly.purge(r.current);
          });
          if (rotateAnimRef.current) cancelAnimationFrame(rotateAnimRef.current);
        };
      }, []);

      // Derived: reset filters + overlays when run changes
      useEffect(() => {
        setFilterCharges(new Set());
        setFilterMzMin(''); setFilterMzMax('');
        setFilterRtMin(''); setFilterRtMax('');
        setFilterOok0Min(''); setFilterOok0Max('');
        setShowWindowOverlay(false);
        setShowPasefOverlay(false);
        setAutoRotate(true);
        rotateAngleRef.current = 0;
        rotateLastTimeRef.current = 0;
      }, [selectedRun?.id]);

      // Filtered 3D data (client-side, no re-fetch needed)
      // filterCharges = set of HIDDEN charge states (empty = show all)
      const filteredData3d = useMemo(() => {
        if (!data3d) return null;
        const mzMin = filterMzMin !== '' ? parseFloat(filterMzMin) : -Infinity;
        const mzMax = filterMzMax !== '' ? parseFloat(filterMzMax) : Infinity;
        // RT filter inputs are in minutes; data3d.rt is in seconds → multiply by 60
        const rtMinSec = filterRtMin !== '' ? parseFloat(filterRtMin) * 60 : -Infinity;
        const rtMaxSec = filterRtMax !== '' ? parseFloat(filterRtMax) * 60 : Infinity;
        const ook0Min = filterOok0Min !== '' ? parseFloat(filterOok0Min) : -Infinity;
        const ook0Max = filterOok0Max !== '' ? parseFloat(filterOok0Max) : Infinity;

        const keep = data3d.rt.map((_, i) => {
          if (filterCharges.has(data3d.charge[i])) return false;
          if (data3d.mz[i] < mzMin || data3d.mz[i] > mzMax) return false;
          if (data3d.rt[i] < rtMinSec || data3d.rt[i] > rtMaxSec) return false;
          if (data3d.mobility[i] < ook0Min || data3d.mobility[i] > ook0Max) return false;
          return true;
        });
        const idxs = keep.reduce((a, v, i) => { if (v) a.push(i); return a; }, []);
        if (idxs.length === 0) return null;
        return {
          ...data3d,
          rt:       idxs.map(i => data3d.rt[i]),
          mz:       idxs.map(i => data3d.mz[i]),
          mobility: idxs.map(i => data3d.mobility[i]),
          log_int:  idxs.map(i => data3d.log_int[i]),
          charge:   idxs.map(i => data3d.charge[i]),
          n_shown:  idxs.length,
        };
      }, [data3d, filterCharges, filterMzMin, filterMzMax, filterRtMin, filterRtMax, filterOok0Min, filterOok0Max]);

      // ── Per-feature coverage: is each ion inside any isolation window? ────────
      const windowCoverage = useMemo(() => {
        if (!filteredData3d) return null;
        const diaWins = (windowData?.windows || []).filter(w => w.oneoverk0_lower > 0 && w.oneoverk0_upper > 0);
        const pasefEvts = (pasefData?.events || []).filter(e => e.oneoverk0_lower > 0 && e.oneoverk0_upper > 0);
        if (!diaWins.length && !pasefEvts.length) return null;
        const n = filteredData3d.mz.length;
        const flags = new Uint8Array(n); // 0=outside, 1=inside DIA, 2=inside PASEF
        for (let i = 0; i < n; i++) {
          const mz = filteredData3d.mz[i], k0 = filteredData3d.mobility[i];
          for (const w of diaWins) {
            if (mz >= w.mz_lower && mz <= w.mz_upper && k0 >= w.oneoverk0_lower && k0 <= w.oneoverk0_upper) {
              flags[i] = 1; break;
            }
          }
          if (flags[i] === 0) {
            for (const e of pasefEvts) {
              if (mz >= e.mz_lower && mz <= e.mz_upper && k0 >= e.oneoverk0_lower && k0 <= e.oneoverk0_upper) {
                flags[i] = 2; break;
              }
            }
          }
        }
        let nDia = 0, nPasef = 0;
        for (let i = 0; i < n; i++) { if (flags[i] === 1) nDia++; else if (flags[i] === 2) nPasef++; }
        return { flags, n_dia: nDia, n_pasef: nPasef, n_out: n - nDia - nPasef, n_total: n };
      }, [filteredData3d, windowData, pasefData]);

      // ── Auto-rotate animation for 4D Feature Map ────────────────────────
      useEffect(() => {
        if (!autoRotate || !plot3dRef.current || !window.Plotly || !filteredData3d) {
          if (rotateAnimRef.current) { cancelAnimationFrame(rotateAnimRef.current); rotateAnimRef.current = null; }
          return;
        }
        const FPS = 24, r = 2.3;
        const step = (ts) => {
          if (ts - rotateLastTimeRef.current >= 1000 / FPS) {
            rotateAngleRef.current += 0.7;
            const rad = rotateAngleRef.current * Math.PI / 180;
            window.Plotly.relayout(plot3dRef.current, {
              'scene.camera.eye': { x: r * Math.cos(rad), y: r * Math.sin(rad), z: 0.8 },
            });
            rotateLastTimeRef.current = ts;
          }
          rotateAnimRef.current = requestAnimationFrame(step);
        };
        rotateAnimRef.current = requestAnimationFrame(step);
        return () => { if (rotateAnimRef.current) { cancelAnimationFrame(rotateAnimRef.current); rotateAnimRef.current = null; } };
      }, [autoRotate, filteredData3d]);

      useEffect(() => {
        if (!selectedRun) {
          setMapData(null); setStatsData(null); setWindowData(null); setData3d(null);
          if (plot3dRef.current && window.Plotly) window.Plotly.purge(plot3dRef.current);
          return;
        }
        const ac = new AbortController();
        setPanelLoading(true);
        setMapData(null); setStatsData(null); setWindowData(null); setData3d(null); setPasefData(null);
        Promise.all([
          fetch(API + `/api/runs/${selectedRun.id}/mobility-map`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/mobility-stats`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/dia-windows`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/mobility-3d?max_features=5000`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/pasef-windows`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
        ]).then(([map, stats, wins, d3, pasef]) => {
          setMapData(map && map.grid ? map : null);
          setStatsData(stats && Object.keys(stats).length > 0 ? stats : null);
          setWindowData(wins && wins.windows && wins.windows.length > 0 ? wins : null);
          setData3d(d3 && d3.rt && d3.rt.length > 0 ? d3 : null);
          setPasefData(pasef && pasef.events && pasef.events.length > 0 ? pasef : null);
          setPanelLoading(false);
        }).catch(e => { if (e.name !== 'AbortError') setPanelLoading(false); });
        return () => ac.abort();
      }, [selectedRun?.id]);

      useEffect(() => {
        if (!mapData || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        // Margins for axes
        const PAD_L = 58, PAD_B = 38, PAD_T = 10, PAD_R = 10;
        const plotW = W - PAD_L - PAD_R;
        const plotH = H - PAD_T - PAD_B;

        const grid = mapData.grid;
        const rtBins = grid.length, mobBins = grid[0].length;
        let maxVal = 0;
        for (const row of grid) for (const v of row) if (v > maxVal) maxVal = v;

        const stops = [[0,[9,9,121]],[0.25,[0,108,180]],[0.5,[0,173,183]],[0.75,[100,200,100]],[1.0,[218,170,0]]];
        function valToRgb(v) {
          const t = maxVal > 0 ? v / maxVal : 0;
          for (let i = 0; i < stops.length - 1; i++) {
            const [t0,c0] = stops[i], [t1,c1] = stops[i+1];
            if (t >= t0 && t <= t1) {
              const f = (t-t0)/(t1-t0);
              return [Math.round(c0[0]+f*(c1[0]-c0[0])),Math.round(c0[1]+f*(c1[1]-c0[1])),Math.round(c0[2]+f*(c1[2]-c0[2]))];
            }
          }
          return stops[stops.length-1][1];
        }

        // Clear background
        ctx.fillStyle = '#011a3a';
        ctx.fillRect(0, 0, W, H);

        // Draw grid cells
        const cw = plotW / mobBins, ch = plotH / rtBins;
        for (let ri = 0; ri < rtBins; ri++) {
          for (let mi = 0; mi < mobBins; mi++) {
            const v = grid[ri][mi];
            if (v < 0.001) continue;
            const [r,g,b] = valToRgb(v);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            // ri=0 is lowest RT → bottom of plot; flip so low RT is left
            const px = PAD_L + mi * cw;
            const py = PAD_T + (rtBins - 1 - ri) * ch;
            ctx.fillRect(px, py, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
          }
        }

        // ── Axes ─────────────────────────────────────────────────────
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_L, PAD_T); ctx.lineTo(PAD_L, PAD_T + plotH);
        ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
        ctx.stroke();

        ctx.fillStyle = '#a0b4cc';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';

        // X-axis ticks (RT) — use rt_edges
        const rtEdges = mapData.rt_edges || [];
        const nXTicks = 7;
        const xStep = Math.max(1, Math.floor(rtEdges.length / nXTicks));
        for (let i = 0; i <= rtBins; i += xStep) {
          const px = PAD_L + (i / rtBins) * plotW;
          const py = PAD_T + plotH;
          ctx.strokeStyle = 'rgba(30,58,95,0.7)';
          ctx.beginPath(); ctx.moveTo(px, PAD_T); ctx.lineTo(px, py + 4); ctx.stroke();
          if (rtEdges[i] != null) {
            const label = `${(rtEdges[i] / 60).toFixed(1)}`;
            ctx.fillStyle = '#a0b4cc';
            ctx.fillText(label, px, py + 14);
          }
        }
        // X-axis label
        ctx.fillStyle = '#7090a8';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('Retention Time (min)', PAD_L + plotW / 2, H - 4);

        // Y-axis ticks (1/K₀) — use mobility_edges
        const mobEdges = mapData.mobility_edges || [];
        const nYTicks = 5;
        const yStep = Math.max(1, Math.floor(mobEdges.length / nYTicks));
        ctx.textAlign = 'right';
        for (let i = 0; i <= mobBins; i += yStep) {
          // i=0 → bottom of plot (low mobility), i=mobBins → top (high mobility)
          const py = PAD_T + plotH - (i / mobBins) * plotH;
          ctx.strokeStyle = 'rgba(30,58,95,0.7)';
          ctx.beginPath(); ctx.moveTo(PAD_L - 4, py); ctx.lineTo(PAD_L + plotW, py); ctx.stroke();
          if (mobEdges[i] != null) {
            ctx.fillStyle = '#a0b4cc';
            ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillText(mobEdges[i].toFixed(3), PAD_L - 6, py + 3);
          }
        }
        // Y-axis label (rotated)
        ctx.save();
        ctx.translate(12, PAD_T + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7090a8';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('1/K₀ (Vs/cm²)', 0, 0);
        ctx.restore();
      }, [mapData]);

      // Render Plotly 3D scatter when filteredData3d changes
      useEffect(() => {
        if (!plot3dRef.current || !window.Plotly) return;
        if (!filteredData3d) { window.Plotly.purge(plot3dRef.current); return; }

        const charges = [...new Set(filteredData3d.charge)].sort((a,b) => a-b);
        const hasCoverage = windowCoverage && (showWindowOverlay || showPasefOverlay);

        let traces;
        if (hasCoverage) {
          // Coverage mode: colour by inside/outside window instead of charge
          const { flags } = windowCoverage;
          const n = filteredData3d.mz.length;
          const insideIdx = [], outsideIdx = [];
          for (let i = 0; i < n; i++) { if (flags[i] > 0) insideIdx.push(i); else outsideIdx.push(i); }
          const li = filteredData3d.log_int;
          const liAll = [...li]; const liMin = Math.min(...liAll), liMax = Math.max(...liAll);
          const norm = i => liMax > liMin ? (li[i]-liMin)/(liMax-liMin) : 0.5;
          traces = [];
          // Outside ions: split z=1 so they're never lost in the dark background
          const outsideZ1   = outsideIdx.filter(i => filteredData3d.charge[i] === 1);
          const outsideRest = outsideIdx.filter(i => filteredData3d.charge[i] !== 1);
          if (outsideRest.length) traces.push({
            type:'scatter3d', mode:'markers', name:'Outside window',
            x:outsideRest.map(i=>+(filteredData3d.rt[i]/60).toFixed(3)),
            y:outsideRest.map(i=>filteredData3d.mz[i]),
            z:outsideRest.map(i=>filteredData3d.mobility[i]),
            marker:{size:outsideRest.map(i=>1+norm(i)*2), color:'#1e3a5f', opacity:0.45, line:{width:0}},
            hovertemplate:'Outside<br>m/z %{y:.3f}<br>RT %{x:.2f}min<br>1/K₀ %{z:.4f}<extra></extra>',
          });
          if (outsideZ1.length) traces.push({
            type:'scatter3d', mode:'markers', name:'Outside · z=+1',
            x:outsideZ1.map(i=>+(filteredData3d.rt[i]/60).toFixed(3)),
            y:outsideZ1.map(i=>filteredData3d.mz[i]),
            z:outsideZ1.map(i=>filteredData3d.mobility[i]),
            marker:{size:outsideZ1.map(i=>2+norm(i)*2.5), color:'#2dd4bf', opacity:0.75, line:{width:0}},
            hovertemplate:'Outside · z=+1<br>m/z %{y:.3f}<br>RT %{x:.2f}min<br>1/K₀ %{z:.4f}<extra></extra>',
          });
          // Inside — split by window type
          const diaInside = insideIdx.filter(i => flags[i] === 1);
          const pasefInside = insideIdx.filter(i => flags[i] === 2);
          if (diaInside.length) {
            const chargesIn = [...new Set(diaInside.map(i=>filteredData3d.charge[i]))].sort((a,b)=>a-b);
            chargesIn.forEach(z => {
              const zIdx = diaInside.filter(i=>filteredData3d.charge[i]===z);
              traces.push({
                type:'scatter3d', mode:'markers', name: z===0?'Inside DIA · ?':`Inside DIA · z=${z}`,
                x:zIdx.map(i=>+(filteredData3d.rt[i]/60).toFixed(3)),
                y:zIdx.map(i=>filteredData3d.mz[i]),
                z:zIdx.map(i=>filteredData3d.mobility[i]),
                marker:{size:zIdx.map(i=>1.8+norm(i)*3.2), color:CHARGE_COLORS[z]||'#94a3b8', opacity:0.85, line:{width:0}},
                text:zIdx.map(i=>`INSIDE window · z=${z}<br>m/z ${filteredData3d.mz[i].toFixed(4)}<br>RT ${(filteredData3d.rt[i]/60).toFixed(2)} min<br>1/K₀ ${filteredData3d.mobility[i].toFixed(4)}`),
                hovertemplate:'%{text}<extra></extra>',
              });
            });
          }
          if (pasefInside.length) traces.push({
            type:'scatter3d', mode:'markers', name:'Inside PASEF',
            x:pasefInside.map(i=>+(filteredData3d.rt[i]/60).toFixed(3)),
            y:pasefInside.map(i=>filteredData3d.mz[i]),
            z:pasefInside.map(i=>filteredData3d.mobility[i]),
            marker:{size:pasefInside.map(i=>1.8+norm(i)*3), color:'#fbbf24', opacity:0.85, line:{width:0}},
            hovertemplate:'INSIDE PASEF<br>m/z %{y:.3f}<br>RT %{x:.2f}min<br>1/K₀ %{z:.4f}<extra></extra>',
          });
        } else {
          // Default: colour by charge
          traces = charges.map(z => {
            const idx = filteredData3d.charge.reduce((acc,c,i) => { if (c===z) acc.push(i); return acc; }, []);
            const li = idx.map(i => filteredData3d.log_int[i]);
            const liMin = Math.min(...li), liMax = Math.max(...li);
            const norm = liMax > liMin ? li.map(v => (v-liMin)/(liMax-liMin)) : li.map(()=>0.5);
            return {
              type: 'scatter3d', mode: 'markers',
              name: z === 0 ? 'Unassigned (?)' : `z = ${z}`,
              x: idx.map(i => +(filteredData3d.rt[i] / 60).toFixed(3)),
              y: idx.map(i => filteredData3d.mz[i]),
              z: idx.map(i => filteredData3d.mobility[i]),
              marker: {
                size: norm.map(v => (z === 0 ? 1.2 : 1.5) + v * 3.5),
                color: CHARGE_COLORS[z] || '#eab308',
                opacity: 0.72,
                line: { width: 0 },
              },
              text: idx.map(i =>
                `${z === 0 ? 'Unassigned' : `z=${z}`}  m/z ${filteredData3d.mz[i].toFixed(4)}<br>` +
                `RT ${(filteredData3d.rt[i] / 60).toFixed(2)} min<br>` +
                `1/K₀ ${filteredData3d.mobility[i].toFixed(4)} Vs/cm²<br>` +
                `log₁₀I ${filteredData3d.log_int[i].toFixed(2)}`
              ),
              hovertemplate: '%{text}<extra></extra>',
            };
          });
        }

        // ── diaPASEF 3D window boxes ─────────────────────────────────────────
        if (showWindowOverlay && windowData?.windows?.length) {
          const groups = [...new Set(windowData.windows.map(w => w.window_group))];
          const rtMin = filteredData3d ? Math.min(...filteredData3d.rt) / 60 : 0;
          const rtMax = filteredData3d ? Math.max(...filteredData3d.rt) / 60 : 60;

          windowData.windows.forEach(ww => {
            const col = winColor(groups.indexOf(ww.window_group));
            // Use per-window RT if available, else fall back to full run span
            const rt0 = ww.rt_begin_sec > 0 ? ww.rt_begin_sec / 60 : rtMin;
            const rt1 = ww.rt_end_sec   > 0 ? ww.rt_end_sec   / 60 : rtMax;
            const mz0 = ww.mz_lower, mz1 = ww.mz_upper;
            const k0  = ww.oneoverk0_lower, k1 = ww.oneoverk0_upper;
            if (k0 <= 0 || k1 <= 0) return;

            // 8 box vertices: x=RT, y=m/z, z=1/K₀
            const bx = [rt0,rt1,rt1,rt0, rt0,rt1,rt1,rt0];
            const by = [mz0,mz0,mz1,mz1, mz0,mz0,mz1,mz1];
            const bz = [k0, k0, k0, k0,  k1, k1, k1, k1 ];

            // Semi-transparent filled box (mesh3d)
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            traces.push({
              type: 'mesh3d',
              x: bx, y: by, z: bz,
              // 12 triangles covering all 6 faces
              i: [0,0, 4,4, 0,0, 2,2, 0,0, 1,1],
              j: [1,3, 5,7, 1,5, 3,7, 3,7, 2,5],
              k: [2,2, 6,6, 5,4, 7,6, 7,4, 6,6],
              color: col,
              opacity: 0.10,
              name: `Group ${ww.window_group}`,
              showlegend: false,
              hoverinfo: 'none',
            });

            // Wireframe edges (scatter3d lines)
            const ex = [], ey = [], ez = [];
            [[0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4], [0,4],[1,5],[2,6],[3,7]].forEach(([a,bb]) => {
              ex.push(bx[a], bx[bb], null);
              ey.push(by[a], by[bb], null);
              ez.push(bz[a], bz[bb], null);
            });
            traces.push({
              type: 'scatter3d', mode: 'lines',
              name: `Group ${ww.window_group}`,
              x: ex, y: ey, z: ez,
              line: { color: `rgba(${r},${g},${b},0.70)`, width: 1.5 },
              showlegend: false,
              hovertemplate:
                `<b>diaPASEF group ${ww.window_group}</b><br>` +
                `m/z ${mz0.toFixed(1)}–${mz1.toFixed(1)} Da<br>` +
                `1/K₀ ${k0.toFixed(3)}–${k1.toFixed(3)} Vs/cm²<br>` +
                `RT ${rt0.toFixed(1)}–${rt1.toFixed(1)} min<extra></extra>`,
            });
          });
        }

        // ── ddaPASEF event boxes (PASEF overlay) ─────────────────────────────
        if (showPasefOverlay && pasefData?.events?.length) {
          const xs = [], ys = [], zs = [];
          pasefData.events.forEach(ev => {
            const rt = ev.rt_sec / 60;
            if (ev.oneoverk0_lower <= 0) return;
            // Thin box: RT dimension is essentially a line (no RT width per event)
            // Show as a vertical line segment at the event RT
            xs.push(rt, rt, null);
            ys.push((ev.mz_lower + ev.mz_upper) / 2, (ev.mz_lower + ev.mz_upper) / 2, null);
            zs.push(ev.oneoverk0_lower, ev.oneoverk0_upper, null);
          });
          traces.push({
            type: 'scatter3d', mode: 'lines',
            name: 'PASEF events',
            x: xs, y: ys, z: zs,
            line: { color: 'rgba(251,191,36,0.45)', width: 1.0 },
            showlegend: true,
            hoverinfo: 'none',
          });
        }

        const darkBg = '#011a3a', axisColor = '#a0b4cc', gridColor = '#1e3a5f';
        const axisStyle = {
          color: axisColor, gridcolor: gridColor, zerolinecolor: gridColor,
          backgroundcolor: '#022851', showbackground: true,
        };
        const layout = {
          paper_bgcolor: darkBg,
          plot_bgcolor: darkBg,
          font: { color: axisColor, size: 11, family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' },
          margin: { l: 0, r: 0, t: 0, b: 0 },
          legend: { bgcolor: 'rgba(1,26,58,0.8)', bordercolor: gridColor, borderwidth: 1, font: { size: 11 } },
          scene: {
            xaxis: { ...axisStyle, title: { text: 'RT (min)', font: { color: axisColor } } },
            yaxis: { ...axisStyle, title: { text: 'm/z (Th)', font: { color: axisColor } } },
            zaxis: { ...axisStyle, title: { text: '1/K₀ (Vs/cm²)', font: { color: axisColor } } },
            camera: { eye: { x: 1.5, y: -1.5, z: 0.8 } },
          },
        };
        const config = { displayModeBar: true, modeBarButtonsToRemove: ['toImage'], responsive: true };
        window.Plotly.react(plot3dRef.current, traces, layout, config);

        // ── Click-to-inspect on 3D scatter ──────────────────────────────────
        // pt.x = RT (min), pt.y = m/z, pt.z = 1/K₀ (as set in trace arrays)
        const div3d = plot3dRef.current;
        div3d.removeAllListeners?.('plotly_click');
        div3d.on('plotly_click', (evt) => {
          if (!evt.points?.length) return;
          const pt = evt.points[0];
          const rtSec = pt.x * 60;
          const mz    = pt.y;
          const ook0  = pt.z;
          // Parse charge from trace name "z = 2" or "Unassigned (?)"
          const nameMatch = (pt.data?.name || '').match(/z\s*=\s*(\d+)/);
          const charge = nameMatch ? Number(nameMatch[1]) : 0;
          setIonTarget({ mz, rt: rtSec, ook0, charge });
          setAutoRotate(false);   // pause rotation so detail panel is easy to use
        });

        // Stop auto-rotation when user drags (mousedown on the plot div)
        const onPlot3dMouseDown = () => setAutoRotate(false);
        div3d.addEventListener('mousedown', onPlot3dMouseDown);
        return () => {
          div3d.removeAllListeners?.('plotly_click');
          div3d.removeEventListener('mousedown', onPlot3dMouseDown);
        };
      }, [filteredData3d, showWindowOverlay, windowData, showPasefOverlay, pasefData]);

      // ── m/z × 1/K₀ landscape (PEAKS-style surface) ──────────────────
      useEffect(() => {
        if (!mzLandscapeRef.current || !window.Plotly) return;
        if (!filteredData3d) { window.Plotly.purge(mzLandscapeRef.current); return; }

        const MZ_BINS = 70, MOB_BINS = 55;
        const mzArr = filteredData3d.mz, mobArr = filteredData3d.mobility;
        const liArr = filteredData3d.log_int, chArr = filteredData3d.charge;

        const mzMin = Math.min(...mzArr), mzMax = Math.max(...mzArr);
        const mobMin = Math.min(...mobArr), mobMax = Math.max(...mobArr);
        if (mzMax <= mzMin || mobMax <= mobMin) return;

        const mzStep  = (mzMax  - mzMin)  / MZ_BINS;
        const mobStep = (mobMax - mobMin) / MOB_BINS;

        // Build intensity surface grid (max log_int per bin)
        const grid = Array.from({length: MOB_BINS}, () => new Array(MZ_BINS).fill(0));
        mzArr.forEach((mz, i) => {
          const mi = Math.min(Math.floor((mz       - mzMin)  / mzStep),  MZ_BINS  - 1);
          const ki = Math.min(Math.floor((mobArr[i] - mobMin) / mobStep), MOB_BINS - 1);
          grid[ki][mi] = Math.max(grid[ki][mi], liArr[i]);
        });

        const xLabels = Array.from({length: MZ_BINS},  (_, i) => +(mzMin  + (i + 0.5) * mzStep).toFixed(1));
        const yLabels = Array.from({length: MOB_BINS}, (_, i) => +(mobMin + (i + 0.5) * mobStep).toFixed(4));

        // Surface trace — intensity landscape
        const surface = {
          type: 'surface',
          x: xLabels, y: yLabels, z: grid,
          colorscale: [
            [0.00, '#011a3a'], [0.12, '#062d6e'], [0.30, '#0d6ea8'],
            [0.50, '#00b4b4'], [0.70, '#7dda58'], [0.88, '#daa900'], [1.00, '#ff5500'],
          ],
          showscale: true,
          colorbar: {
            title: { text: 'log₁₀(I)', font: { color: '#a0b4cc', size: 10 } },
            thickness: 12, len: 0.65,
            tickfont: { color: '#a0b4cc', size: 9 },
          },
          lighting: { ambient: 0.6, diffuse: 0.85, specular: 0.15, roughness: 0.6, fresnel: 0.1 },
          hovertemplate: 'm/z %{x:.1f} Th<br>1/K₀ %{y:.4f} Vs/cm²<br>log₁₀I %{z:.2f}<extra></extra>',
          opacity: 0.92,
        };

        // Scatter overlay — charge-coloured points on the surface
        const chargeOverlay = [...new Set(chArr)].sort((a,b)=>a-b).map(z => {
          const idx = chArr.reduce((a,c,i) => { if(c===z) a.push(i); return a; }, []);
          return {
            type: 'scatter3d', mode: 'markers',
            name: z === 0 ? 'Unassigned (?)' : `z = ${z}`,
            x: idx.map(i => mzArr[i]),
            y: idx.map(i => mobArr[i]),
            z: idx.map(i => liArr[i] + 0.05),  // slightly above surface
            marker: { size: 1.8, color: CHARGE_COLORS[z] || '#94a3b8', opacity: z === 0 ? 0.3 : 0.55, line:{width:0} },
            hovertemplate: `${z === 0 ? 'Unassigned' : `z=${z}`}  m/z %{x:.4f}<br>1/K₀ %{y:.4f}<br>log₁₀I %{z:.2f}<extra></extra>`,
            showlegend: true,
          };
        });

        const darkBg = '#011a3a', axisColor = '#a0b4cc', gridColor = '#1e3a5f';
        const axisStyle = {
          color: axisColor, gridcolor: gridColor, zerolinecolor: gridColor,
          backgroundcolor: '#022851', showbackground: true,
        };
        const layout = {
          paper_bgcolor: darkBg, plot_bgcolor: darkBg,
          font: { color: axisColor, size: 11, family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' },
          margin: { l: 0, r: 0, t: 0, b: 0 },
          legend: { bgcolor: 'rgba(1,26,58,0.8)', bordercolor: gridColor, borderwidth: 1, font:{size:10} },
          scene: {
            xaxis: { ...axisStyle, title: { text: 'm/z (Th)',        font:{color:axisColor} } },
            yaxis: { ...axisStyle, title: { text: '1/K₀ (Vs/cm²)',   font:{color:axisColor} } },
            zaxis: { ...axisStyle, title: { text: 'log₁₀(Intensity)', font:{color:axisColor} } },
            camera: { eye: { x: 1.6, y: -1.8, z: 1.1 } },
            aspectmode: 'manual',
            aspectratio: { x: 1.4, y: 0.9, z: 0.65 },
          },
        };
        const config = { displayModeBar: true, modeBarButtonsToRemove: ['toImage'], responsive: true };
        window.Plotly.react(mzLandscapeRef.current, [surface, ...chargeOverlay], layout, config);
      }, [filteredData3d]);

      // ── Waterfall spectrum (PEAKS-style: vertical spikes stacked by mobility) ──
      useEffect(() => {
        if (!waterfallRef.current || !window.Plotly) return;
        if (!filteredData3d) { window.Plotly.purge(waterfallRef.current); return; }

        const { mz: mzArr, mobility: mobArr, log_int: liArr, charge: chArr } = filteredData3d;

        // Normalise intensities to 0-100 within each mobility layer so
        // every layer has comparable spike heights (like PEAKS)
        const MOB_LAYERS = 60;
        const mobMin = Math.min(...mobArr), mobMax = Math.max(...mobArr);
        if (mobMax <= mobMin) return;
        const mobStep = (mobMax - mobMin) / MOB_LAYERS;

        // Group by layer
        const layers = Array.from({length: MOB_LAYERS}, () => []);
        mzArr.forEach((mz, i) => {
          const li = Math.min(Math.floor((mobArr[i] - mobMin) / mobStep), MOB_LAYERS - 1);
          layers[li].push(i);
        });

        // Build one scatter3d per charge state (so legend/colours work)
        const charges = [...new Set(chArr)].sort((a,b) => a-b);

        const traces = charges.map(z => {
          const xs = [], ys = [], zs = [];
          layers.forEach((idxs, li) => {
            const layerIdxs = idxs.filter(i => chArr[i] === z);
            if (!layerIdxs.length) return;
            const layerMob = mobMin + (li + 0.5) * mobStep;
            // Max intensity in this layer (for normalisation)
            const layerMax = Math.max(...layerIdxs.map(i => liArr[i]));
            // Sort by m/z so spikes are in order
            layerIdxs.sort((a,b) => mzArr[a] - mzArr[b]);
            layerIdxs.forEach(i => {
              const normH = layerMax > 0 ? (liArr[i] / layerMax) * 100 : 0;
              xs.push(mzArr[i], mzArr[i], null);
              ys.push(layerMob,  layerMob,  null);
              zs.push(0,         normH,     null);
            });
          });
          return {
            type: 'scatter3d', mode: 'lines',
            name: z === 0 ? 'Unassigned (?)' : `z = ${z}`,
            x: xs, y: ys, z: zs,
            line: { color: CHARGE_COLORS[z] || '#94a3b8', width: z === 0 ? 1.0 : 1.5 },
            opacity: z === 0 ? 0.45 : 1,
            hoverinfo: 'skip',
          };
        });

        // Flat base-plane outline at z=0 (gives the PEAKS "floor" look)
        const mzMin2 = Math.min(...mzArr), mzMax2 = Math.max(...mzArr);
        const floorTrace = {
          type: 'scatter3d', mode: 'lines',
          name: 'base', showlegend: false,
          x: [mzMin2, mzMax2, mzMax2, mzMin2, mzMin2],
          y: [mobMin,  mobMin,  mobMax,  mobMax,  mobMin],
          z: [0,       0,       0,       0,       0],
          line: { color: 'rgba(100,140,180,0.25)', width: 1 },
          hoverinfo: 'skip',
        };

        // Mobility "wall" lines — faint grid lines along Y at fixed mz positions
        const gridMz = Array.from({length: 7}, (_, i) => mzMin2 + (i/(6)) * (mzMax2-mzMin2));
        const gridTraces = gridMz.map(gMz => ({
          type: 'scatter3d', mode: 'lines', showlegend: false,
          x: [gMz, gMz], y: [mobMin, mobMax], z: [0, 0],
          line: { color: 'rgba(100,140,180,0.12)', width: 1 },
          hoverinfo: 'skip',
        }));

        const darkBg = '#011a3a', axisColor = '#a0b4cc', gridColor = '#0d2b5e';
        const axisStyle = {
          color: axisColor, gridcolor: gridColor, zerolinecolor: gridColor,
          backgroundcolor: '#011f4a', showbackground: true,
        };
        const layout = {
          paper_bgcolor: darkBg, plot_bgcolor: darkBg,
          font: { color: axisColor, size: 11, family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' },
          margin: { l: 0, r: 0, t: 0, b: 0 },
          legend: { bgcolor: 'rgba(1,26,58,0.85)', bordercolor: '#1e3a5f', borderwidth: 1, font:{size:10} },
          scene: {
            xaxis: { ...axisStyle, title: { text: 'm/z (Th)',          font:{color:axisColor} } },
            yaxis: { ...axisStyle, title: { text: '1/K₀ (Vs/cm²)',     font:{color:axisColor} } },
            zaxis: { ...axisStyle, title: { text: 'Relative intensity', font:{color:axisColor} },
                     range: [0, 110] },
            camera: { eye: { x: 2.0, y: -2.2, z: 0.85 },
                      up:  { x: 0,   y: 0,    z: 1   } },
            aspectmode: 'manual',
            aspectratio: { x: 1.6, y: 1.0, z: 0.55 },
          },
        };
        const config = { displayModeBar: true, modeBarButtonsToRemove: ['toImage'], responsive: true };
        window.Plotly.react(waterfallRef.current, [floorTrace, ...gridTraces, ...traces], layout, config);
      }, [filteredData3d]);

      // ── Ion cloud: m/z vs 1/K₀ (Tenzer / Gomez-Zepeda style) ────────────
      useEffect(() => {
        if (!cloudMzRef.current || !window.Plotly) return;
        if (!filteredData3d || filteredData3d.n_shown === 0) { window.Plotly.purge(cloudMzRef.current); return; }
        const { mz, mobility, charge: chArr, n_shown } = filteredData3d;
        const idx = Array.from({length:n_shown}, (_,i)=>i);
        const chargeSet = [...new Set(chArr)].sort((a,b)=>a-b);
        const traces = chargeSet.map(z => {
          const ii = idx.filter(i => chArr[i] === z);
          return {
            type:'scatter', mode:'markers', name: z === 0 ? 'Unassigned (?)' : `z=${z}`,
            x: ii.map(i => mz[i]),
            y: ii.map(i => mobility[i]),
            marker:{size: z === 0 ? 2 : 2.5, color:CHARGE_COLORS[z]||'#eab308', opacity:0.55},
            hovertemplate:`m/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>${z===0?'Unassigned':`z=${z}`}<extra></extra>`,
          };
        });

        // ── Method overlay ────────────────────────────────────────────────────
        // Invisible scatter trace at window centres → hover shows window info
        if (showWindowOverlay && windowData?.windows?.length) {
          traces.push({
            type:'scatter', mode:'markers',
            name:'diaPASEF windows',
            x: windowData.windows.map(ww => (ww.mz_lower + ww.mz_upper) / 2),
            y: windowData.windows.map(ww =>
              ww.oneoverk0_lower > 0
                ? (ww.oneoverk0_lower + ww.oneoverk0_upper) / 2
                : 1.1
            ),
            marker:{ size:14, opacity:0, color:'transparent' },
            hovertemplate: windowData.windows.map(ww => {
              const k0str = ww.oneoverk0_lower > 0
                ? `1/K₀ ${ww.oneoverk0_lower.toFixed(3)}–${ww.oneoverk0_upper.toFixed(3)} Vs/cm²<br>`
                : '';
              return `<b>Window group ${ww.window_group}</b><br>m/z ${ww.mz_lower.toFixed(1)}–${ww.mz_upper.toFixed(1)} Da<br>${k0str}<extra>diaPASEF</extra>`;
            }),
            showlegend: true,
          });
        }

        // Rectangle shapes — one per diaPASEF window, coloured by window group
        const cleanShapes = [];
        if (showWindowOverlay && windowData?.windows?.length) {
          const groups = [...new Set(windowData.windows.map(w => w.window_group))];
          windowData.windows.forEach(ww => {
            const col = winColor(groups.indexOf(ww.window_group));
            const hasK0 = ww.oneoverk0_lower > 0 || ww.oneoverk0_upper > 0;
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            cleanShapes.push({
              type:'rect',
              x0: ww.mz_lower, x1: ww.mz_upper,
              y0: hasK0 ? ww.oneoverk0_lower : 0.55,
              y1: hasK0 ? ww.oneoverk0_upper : 1.65,
              fillcolor: `rgba(${r},${g},${b},0.10)`,
              line:{ color: `rgba(${r},${g},${b},0.75)`, width: 1.2 },
            });
          });
        }

        // PASEF event rectangles — each precursor isolation box in m/z × 1/K₀
        if (showPasefOverlay && pasefData?.events?.length) {
          pasefData.events.forEach(ev => {
            cleanShapes.push({
              type:'rect',
              x0: ev.mz_lower, x1: ev.mz_upper,
              y0: ev.oneoverk0_lower > 0 ? ev.oneoverk0_lower : 0.6,
              y1: ev.oneoverk0_upper > 0 ? ev.oneoverk0_upper : 1.6,
              fillcolor: 'rgba(251,191,36,0.04)',
              line:{ color: 'rgba(251,191,36,0.50)', width: 0.8 },
            });
          });
        }

        Plotly.react(cloudMzRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.3)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes: cleanShapes,
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage','sendDataToCloud','editInChartStudio']});

        // ── Click-to-inspect: attach after every Plotly.react so handler is fresh ──
        // (useEffect deps on ref.current are not reactive — must wire here)
        const div = cloudMzRef.current;
        div.removeAllListeners?.('plotly_click');
        div.removeAllListeners?.('plotly_selected');
        div.on('plotly_click', (evt) => {
          if (!evt.points?.length) return;
          const pt = evt.points[0];
          // pt.x = m/z, pt.y = 1/K₀ from the scatter trace
          const clickMz  = pt.x;
          const clickOok0 = pt.y;
          const d3  = filteredData3dRef.current;
          let rt = 0, charge = 2;
          if (d3?.mz?.length) {
            let best = Infinity;
            for (let i = 0; i < d3.mz.length; i++) {
              // normalised distance: ppm on m/z + scaled distance on 1/K₀
              const dm = Math.abs(d3.mz[i] - clickMz) / clickMz;
              const dk = Math.abs(d3.mobility[i] - clickOok0) * 3;
              const dist = dm + dk;
              if (dist < best) { best = dist; rt = d3.rt[i]; charge = d3.charge ? d3.charge[i] : 2; }
            }
          }
          setIonTarget({ mz: clickMz, rt, ook0: clickOok0, charge });
        });
        // Box-select to filter: drag a selection rectangle → update m/z + 1/K₀ filter state
        div.on('plotly_selected', (evt) => {
          if (!evt?.range) return;
          const [x0, x1] = evt.range.x.map(v => +v.toFixed(2));
          const [y0, y1] = evt.range.y.map(v => +v.toFixed(4));
          setFilterMzMin(String(Math.min(x0, x1)));
          setFilterMzMax(String(Math.max(x0, x1)));
          setFilterOok0Min(String(Math.min(y0, y1)));
          setFilterOok0Max(String(Math.max(y0, y1)));
          setShowFilters(true);
        });
      }, [filteredData3d, showWindowOverlay, windowData, showPasefOverlay, pasefData]);

      // ── Ion cloud: RT vs 1/K₀ (Kulej / MSKCC style) ─────────────────────
      useEffect(() => {
        if (!cloudRtRef.current || !window.Plotly) return;
        if (!filteredData3d || filteredData3d.n_shown === 0) { window.Plotly.purge(cloudRtRef.current); return; }
        const { rt, mobility, charge: chArr, n_shown } = filteredData3d;
        const idx = Array.from({length:n_shown}, (_,i)=>i);
        const chargeSet = [...new Set(chArr)].sort((a,b)=>a-b);
        const traces = chargeSet.map(z => {
          const ii = idx.filter(i => chArr[i] === z);
          return {
            type:'scatter', mode:'markers', name: z === 0 ? 'Unassigned (?)' : `z=${z}`,
            x: ii.map(i => +(rt[i] / 60).toFixed(3)),
            y: ii.map(i => mobility[i]),
            marker:{size:2.5, color:CHARGE_COLORS[z]||'#94a3b8', opacity: z === 0 ? 0.35 : 0.55},
            hovertemplate:`RT %{x:.2f} min<br>1/K₀ %{y:.4f}<br>${z===0?'Unassigned':`z=${z}`}<extra></extra>`,
          };
        });

        // ── Window overlay: horizontal bands (1/K₀ range) per window group ──
        // In RT×1/K₀ space, diaPASEF windows appear as horizontal strips
        const rtShapes = [];
        if (showWindowOverlay && windowData?.windows?.length) {
          const groups = [...new Set(windowData.windows.map(w => w.window_group))];
          windowData.windows.forEach(ww => {
            if (ww.oneoverk0_lower <= 0) return;
            const col = winColor(groups.indexOf(ww.window_group));
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            const hasRt = ww.rt_begin_sec > 0 && ww.rt_end_sec > 0;
            rtShapes.push({
              type: 'rect',
              xref: hasRt ? 'x' : 'paper',
              x0: hasRt ? ww.rt_begin_sec / 60 : 0,
              x1: hasRt ? ww.rt_end_sec   / 60 : 1,
              yref: 'y',
              y0: ww.oneoverk0_lower, y1: ww.oneoverk0_upper,
              fillcolor: `rgba(${r},${g},${b},0.09)`,
              line: { color: `rgba(${r},${g},${b},0.55)`, width: 1 },
            });
          });
        }

        // ── PASEF overlay: event dots in RT×1/K₀ space ───────────────────────
        if (showPasefOverlay && pasefData?.events?.length) {
          traces.push({
            type:'scatter', mode:'markers',
            name:'PASEF events',
            x: pasefData.events.map(e => e.rt_sec / 60),
            y: pasefData.events.map(e => (e.oneoverk0_lower + e.oneoverk0_upper) / 2),
            marker:{ size:3, color:'rgba(251,191,36,0.45)', symbol:'line-ns', line:{color:'rgba(251,191,36,0.70)',width:1} },
            hovertemplate:'RT %{x:.2f} min<br>1/K₀ %{y:.3f}<br>PASEF event<extra></extra>',
          });
        }

        Plotly.react(cloudRtRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:45},
          xaxis:{title:{text:'RT (min)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.3)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes: rtShapes,
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage','sendDataToCloud','editInChartStudio']});

        // ── Click-to-inspect on RT × 1/K₀ chart ────────────────────────────────
        const divRt = cloudRtRef.current;
        divRt.removeAllListeners?.('plotly_click');
        divRt.removeAllListeners?.('plotly_selected');
        divRt.on('plotly_click', (evt) => {
          if (!evt.points?.length) return;
          const pt = evt.points[0];
          const clickRtSec = pt.x * 60;   // x axis is RT in minutes
          const clickOok0  = pt.y;
          const d3 = filteredData3dRef.current;
          let mz = 800, charge = 2;
          if (d3?.rt?.length) {
            let best = Infinity;
            for (let i = 0; i < d3.rt.length; i++) {
              const dr = Math.abs(d3.rt[i] - clickRtSec) / (d3.rt[d3.rt.length-1] || 3600);
              const dk = Math.abs(d3.mobility[i] - clickOok0) * 3;
              const dist = dr + dk;
              if (dist < best) { best = dist; mz = d3.mz[i]; charge = d3.charge ? d3.charge[i] : 2; }
            }
          }
          setIonTarget({ mz, rt: clickRtSec, ook0: clickOok0, charge });
        });
        // Box-select to filter: drag a selection rectangle → update RT + 1/K₀ filter state
        divRt.on('plotly_selected', (evt) => {
          if (!evt?.range) return;
          const [x0, x1] = evt.range.x.map(v => +v.toFixed(2));  // RT in min
          const [y0, y1] = evt.range.y.map(v => +v.toFixed(4));
          setFilterRtMin(String(Math.min(x0, x1)));
          setFilterRtMax(String(Math.max(x0, x1)));
          setFilterOok0Min(String(Math.min(y0, y1)));
          setFilterOok0Max(String(Math.max(y0, y1)));
          setShowFilters(true);
        });
      }, [filteredData3d, showWindowOverlay, windowData, showPasefOverlay, pasefData]);

      // ── Coverage chart: inside vs outside windows in m/z × 1/K₀ ─────────────
      useEffect(() => {
        if (!coverageRef.current || !window.Plotly) return;
        if (!filteredData3d || !windowCoverage) { window.Plotly.purge(coverageRef.current); return; }
        const { flags, n_total } = windowCoverage;
        const diaIdx = [], pasefIdx = [], outIdx = [];
        for (let i = 0; i < n_total; i++) {
          if (flags[i] === 1) diaIdx.push(i);
          else if (flags[i] === 2) pasefIdx.push(i);
          else outIdx.push(i);
        }
        const { mz, mobility, charge: chArr } = filteredData3d;

        const traces = [];
        // Outside ions — dim gray behind, but z=1 always shown in teal so they're never lost
        const outZ1  = outIdx.filter(i => chArr[i] === 1);
        const outRest = outIdx.filter(i => chArr[i] !== 1);
        if (outRest.length) traces.push({
          type:'scatter', mode:'markers', name:'Outside window',
          x: outRest.map(i => mz[i]), y: outRest.map(i => mobility[i]),
          marker:{ size:2, color:'#2a3a4a', opacity:0.5, line:{width:0} },
          hovertemplate:'Outside<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra></extra>',
        });
        // +1 ions outside window — always visible in teal regardless of window coverage
        if (outZ1.length) traces.push({
          type:'scatter', mode:'markers', name:'Outside · z=+1',
          x: outZ1.map(i => mz[i]), y: outZ1.map(i => mobility[i]),
          marker:{ size:4, color:'#2dd4bf', opacity:0.75, line:{width:0} },
          hovertemplate:'Outside window · z=+1<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra></extra>',
        });
        // DIA inside — teal, by charge
        if (diaIdx.length) {
          const chargesPresent = [...new Set(diaIdx.map(i => chArr[i]))].sort((a,b)=>a-b);
          chargesPresent.forEach(z => {
            const ii = diaIdx.filter(i => chArr[i] === z);
            const col = CHARGE_COLORS[z] || '#94a3b8';
            traces.push({
              type:'scatter', mode:'markers', name: z===0?'Inside · Unassigned':`Inside · z=${z}`,
              x: ii.map(i=>mz[i]), y: ii.map(i=>mobility[i]),
              marker:{ size: z===1?4:3, color:col, opacity:0.8, line:{width:0} },
              hovertemplate:`Inside window<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>${z===0?'z=?':`z=${z}`}<extra></extra>`,
            });
          });
        }
        // PASEF inside — amber
        if (pasefIdx.length) traces.push({
          type:'scatter', mode:'markers', name:'Inside PASEF event',
          x: pasefIdx.map(i=>mz[i]), y: pasefIdx.map(i=>mobility[i]),
          marker:{ size:3, color:'#fbbf24', opacity:0.8, line:{width:0} },
          hovertemplate:'Inside PASEF<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra></extra>',
        });

        // Window rectangles as shapes
        const shapes = [];
        const hasWins = windowData?.windows?.length > 0;
        if (hasWins) {
          const groups = [...new Set(windowData.windows.map(w => w.window_group))];
          windowData.windows.forEach(ww => {
            if (ww.oneoverk0_lower <= 0) return;
            const col = winColor(groups.indexOf(ww.window_group));
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            shapes.push({
              type:'rect', x0:ww.mz_lower, x1:ww.mz_upper, y0:ww.oneoverk0_lower, y1:ww.oneoverk0_upper,
              fillcolor:`rgba(${r},${g},${b},0.08)`, line:{color:`rgba(${r},${g},${b},0.90)`,width:1.5},
            });
          });
        }
        // PASEF event shapes
        if (pasefData?.events?.length) {
          pasefData.events.forEach(ev => {
            if (ev.oneoverk0_lower <= 0) return;
            shapes.push({
              type:'rect', x0:ev.mz_lower, x1:ev.mz_upper, y0:ev.oneoverk0_lower, y1:ev.oneoverk0_upper,
              fillcolor:'rgba(251,191,36,0.03)', line:{color:'rgba(251,191,36,0.55)',width:0.7},
            });
          });
        }

        window.Plotly.react(coverageRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.4)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes,
        }, {responsive:true, displayModeBar:false});

        // ── Click-to-inspect on coverage m/z × 1/K₀ chart ──────────────────────
        const divCov = coverageRef.current;
        divCov.removeAllListeners?.('plotly_click');
        divCov.on('plotly_click', (evt) => {
          if (!evt.points?.length) return;
          const pt = evt.points[0];
          const clickMz   = pt.x;
          const clickOok0 = pt.y;
          const d3 = filteredData3dRef.current;
          let rt = 0, charge = 2;
          if (d3?.mz?.length) {
            let best = Infinity;
            for (let i = 0; i < d3.mz.length; i++) {
              const dm = Math.abs(d3.mz[i] - clickMz) / clickMz;
              const dk = Math.abs(d3.mobility[i] - clickOok0) * 3;
              const dist = dm + dk;
              if (dist < best) { best = dist; rt = d3.rt[i]; charge = d3.charge ? d3.charge[i] : 2; }
            }
          }
          setIonTarget({ mz: clickMz, rt, ook0: clickOok0, charge });
        });
      }, [filteredData3d, windowCoverage, windowData, pasefData]);

      // ── PASEF polygon view: all events in 1/K₀ × m/z space ──────────────────
      useEffect(() => {
        if (!pasefPolygonRef.current || !window.Plotly) return;
        if (!pasefData?.events?.length) { window.Plotly.purge(pasefPolygonRef.current); return; }
        const evts = pasefData.events;
        // Each event: point at (isolation_mz, k0_centre) — forms the characteristic diagonal band
        const polygon = {
          type:'scatter', mode:'markers', name:'PASEF events',
          x: evts.map(e => e.isolation_mz),
          y: evts.map(e => (e.oneoverk0_lower + e.oneoverk0_upper) / 2),
          marker:{ size:3, color:evts.map(e => e.rt_sec / 60),
                   colorscale:[[0,'#062d6e'],[0.33,'#0d6ea8'],[0.66,'#00b4b4'],[1,'#daa900']],
                   showscale:true, colorbar:{title:{text:'RT (min)',font:{color:'#94a3b8',size:9}},
                   thickness:10,len:0.7,tickfont:{color:'#94a3b8',size:9}}, opacity:0.65 },
          hovertemplate:'m/z %{x:.1f}<br>1/K₀ %{y:.4f}<br>RT %{customdata:.1f} min<extra>PASEF</extra>',
          customdata: evts.map(e => e.rt_sec / 60),
        };
        // Also show isolation width as error bars in x
        const rectangles = evts.map(ev => ({
          type:'rect', x0:ev.mz_lower, x1:ev.mz_upper,
          y0:ev.oneoverk0_lower, y1:ev.oneoverk0_upper,
          fillcolor:'rgba(251,191,36,0.04)', line:{color:'rgba(251,191,36,0.30)',width:0.6},
        }));
        window.Plotly.react(pasefPolygonRef.current, [polygon], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:60,t:10,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes: rectangles,
        }, {responsive:true, displayModeBar:false});
      }, [pasefData]);

      // ── Keep refs in sync with latest React state (for Plotly event handlers) ──
      useEffect(() => { filteredData3dRef.current = filteredData3d; }, [filteredData3d]);
      useEffect(() => { selectedRunRef.current    = selectedRun;    }, [selectedRun]);

      // ── Fetch ion detail whenever ionTarget changes ───────────────────────────
      useEffect(() => {
        if (!ionTarget) return;
        const run = selectedRunRef.current;
        if (!run) return;
        setIonLoading(true);
        setIonDetail(null);
        setFrameHeatmap(null);
        setFrameSpectrum(null);
        const { mz, rt, ook0 } = ionTarget;
        const id = run.id;
        Promise.all([
          fetch(API + `/api/runs/${id}/ion-detail?mz=${mz}&rt=${rt}&ook0=${ook0}`).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${id}/frame-heatmap?rt=${rt}`).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${id}/frame-spectrum?rt=${rt}`).then(r => r.ok ? r.json() : {}),
        ]).then(([detail, heatmap, spectrum]) => {
          setIonDetail(detail?.xic   ? detail   : null);
          setFrameHeatmap(heatmap?.grid ? heatmap : null);
          setFrameSpectrum(spectrum?.mz ? spectrum : null);
          setIonLoading(false);
        }).catch(() => setIonLoading(false));
      }, [ionTarget]);

      // Clear ion detail when run changes
      useEffect(() => {
        setIonTarget(null); setIonDetail(null);
        setFrameHeatmap(null); setFrameSpectrum(null);
      }, [selectedRun?.id]);

      // ── Draw XIC ─────────────────────────────────────────────────────────────
      useEffect(() => {
        const el = xicRef.current;
        if (!el || !window.Plotly) return;
        if (!ionDetail?.xic?.rt_sec?.length) { window.Plotly.purge(el); return; }
        const { rt_sec, intensity } = ionDetail.xic;
        const rtMin = rt_sec.map(v => v / 60);
        const peakRtMin = (ionDetail.peak_rt || 0) / 60;
        window.Plotly.react(el, [{
          x: rtMin, y: intensity,
          type: 'scatter', mode: 'lines',
          line: { color: '#60a5fa', width: 1.5 },
          fill: 'tozeroy', fillcolor: 'rgba(96,165,250,0.10)',
          hovertemplate: 'RT %{x:.2f} min<br>Intensity %{y:,.0f}<extra>XIC</extra>',
        }], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          font: { color: '#94a3b8', size: 11 },
          margin: { l: 60, r: 10, t: 8, b: 45 },
          xaxis: { title: { text: 'RT (min)', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          yaxis: { title: { text: 'Intensity', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          hoverlabel: { bgcolor: '#0d1e36', font: { size: 11 } },
          shapes: [{
            type: 'line', x0: peakRtMin, x1: peakRtMin, y0: 0, y1: 1, yref: 'paper',
            line: { color: '#fbbf24', width: 1.5, dash: 'dash' },
          }],
        }, { responsive: true, displayModeBar: false });
      }, [ionDetail]);

      // ── Draw mobilogram ───────────────────────────────────────────────────────
      useEffect(() => {
        const el = mobilogramRef.current;
        if (!el || !window.Plotly) return;
        if (!ionDetail?.mobilogram?.ook0?.length) { window.Plotly.purge(el); return; }
        const { ook0, intensity } = ionDetail.mobilogram;
        const peakOok0 = ionDetail.peak_ook0 || 0;
        window.Plotly.react(el, [{
          x: ook0, y: intensity,
          type: 'scatter', mode: 'lines',
          line: { color: '#22c55e', width: 1.5 },
          fill: 'tozeroy', fillcolor: 'rgba(34,197,94,0.10)',
          hovertemplate: '1/K₀ %{x:.4f}<br>Intensity %{y:,.0f}<extra>Mobilogram</extra>',
        }], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          font: { color: '#94a3b8', size: 11 },
          margin: { l: 60, r: 10, t: 8, b: 45 },
          xaxis: { title: { text: '1/K₀ (Vs/cm²)', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          yaxis: { title: { text: 'Intensity', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          hoverlabel: { bgcolor: '#0d1e36', font: { size: 11 } },
          shapes: [{
            type: 'line', x0: peakOok0, x1: peakOok0, y0: 0, y1: 1, yref: 'paper',
            line: { color: '#fbbf24', width: 1.5, dash: 'dash' },
          }],
        }, { responsive: true, displayModeBar: false });
      }, [ionDetail]);

      // ── Draw frame heatmap (mzmine panel 5) ──────────────────────────────────
      useEffect(() => {
        const el = frameHeatmapRef.current;
        if (!el || !window.Plotly) return;
        if (!frameHeatmap?.grid) { window.Plotly.purge(el); return; }
        const { mz_edges, ook0_edges, grid } = frameHeatmap;
        const mzCentres  = mz_edges.slice(0,-1).map((v,i)  => (v+mz_edges[i+1])/2);
        const ook0Centres = ook0_edges.slice(0,-1).map((v,i) => (v+ook0_edges[i+1])/2);
        // Shapes: crosshairs at the clicked ion position
        const shapes = [];
        if (ionTarget) {
          shapes.push(
            { type:'line', x0:ionTarget.mz, x1:ionTarget.mz, y0:ook0_edges[0], y1:ook0_edges[ook0_edges.length-1],
              line:{color:'rgba(251,191,36,0.7)',width:1,dash:'dot'} },
            { type:'line', x0:mz_edges[0], x1:mz_edges[mz_edges.length-1], y0:ionTarget.ook0, y1:ionTarget.ook0,
              line:{color:'rgba(251,191,36,0.7)',width:1,dash:'dot'} },
          );
        }
        window.Plotly.react(el, [{
          type: 'heatmap',
          x: mzCentres, y: ook0Centres, z: grid,
          colorscale: [
            [0,    '#020c1b'],
            [0.15, '#06204a'],
            [0.35, '#0d6ea8'],
            [0.55, '#00b4b4'],
            [0.75, '#64c832'],
            [0.88, '#daa900'],
            [1.0,  '#ffffff'],
          ],
          showscale: true,
          colorbar: { title:{text:'log₁₀(I)',font:{color:'#94a3b8',size:9}}, thickness:10, len:0.85,
                      tickfont:{color:'#94a3b8',size:9}, outlinewidth:0 },
          hovertemplate: 'm/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>log(I) %{z:.2f}<extra>Frame</extra>',
          zsmooth: false,
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:55,t:8,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes,
        }, {responsive:true, displayModeBar:false});
      }, [frameHeatmap, ionTarget]);

      // ── Draw frame spectrum (mzmine panel 1) ─────────────────────────────────
      useEffect(() => {
        const el = frameSpectrumRef.current;
        if (!el || !window.Plotly) return;
        if (!frameSpectrum?.mz?.length) { window.Plotly.purge(el); return; }
        const { mz, intensity } = frameSpectrum;
        const shapes = ionTarget ? [{
          type:'line', x0:ionTarget.mz, x1:ionTarget.mz, y0:0, y1:1, yref:'paper',
          line:{color:'rgba(251,191,36,0.7)',width:1.5,dash:'dash'},
        }] : [];
        window.Plotly.react(el, [{
          x: mz, y: intensity,
          type: 'bar', marker: { color:'#a78bfa', line:{width:0} },
          hovertemplate: 'm/z %{x:.3f}<br>%{y:,.0f}<extra>Σ Frame</extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:10,t:8,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'Intensity',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          bargap:0, hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes,
        }, {responsive:true, displayModeBar:false});
      }, [frameSpectrum, ionTarget]);

      const nInstruments = useMemo(() => new Set(dRuns.map(r => r.instrument)).size, [dRuns]);
      const fwhm = statsData?.fwhm_hist;
      const charge = statsData?.charge_dist;
      const intHist = statsData?.intensity_hist;

      if (runsLoading) return <div className="empty">Loading runs…</div>;

      if (dRuns.length === 0) return (
        <div className="card">
          <h3>Ion Mobility</h3>
          <p style={{color:'var(--muted)',marginTop:'0.5rem'}}>
            No Bruker .d runs found in the database yet. This tab shows ion mobility data for
            timsTOF acquisitions — it will populate automatically once runs are processed.
          </p>
        </div>
      );

      return (
        <div>
          {/* Summary bar */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1.25rem'}}>
            <div style={{display:'flex',gap:'2.5rem',alignItems:'center',flexWrap:'wrap'}}>
              <div>
                <span style={{color:'var(--accent)',fontWeight:700,fontSize:'1.2rem'}}>{dRuns.length}</span>
                {' '}<span style={{color:'var(--muted)',fontSize:'0.85rem'}}>timsTOF run{dRuns.length !== 1 ? 's' : ''}</span>
              </div>
              <div>
                <span style={{color:'var(--accent)',fontWeight:700,fontSize:'1.2rem'}}>{nInstruments}</span>
                {' '}<span style={{color:'var(--muted)',fontSize:'0.85rem'}}>instrument{nInstruments !== 1 ? 's' : ''}</span>
              </div>
              <div style={{color:'var(--muted)',fontSize:'0.8rem',flexShrink:1}}>
                Select a run · all panels auto-populate from DIA-NN <code style={{background:'rgba(255,255,255,0.07)',padding:'0 0.2rem',borderRadius:'0.2rem'}}>report.parquet</code> &nbsp;·&nbsp;
                4DFF <code style={{background:'rgba(255,255,255,0.07)',padding:'0 0.2rem',borderRadius:'0.2rem'}}>.features</code> used when available &nbsp;·&nbsp;
                all charge states z=1–6 shown · click a charge button to hide/show
              </div>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'270px 1fr',gap:'1rem',alignItems:'start'}}>
            {/* Run list */}
            <div className="card" style={{padding:'0.75rem',position:'sticky',top:'1rem'}}>
              <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>timsTOF Runs</div>
              <input
                type="text"
                placeholder="Filter by name or instrument…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.3rem 0.5rem',fontSize:'0.8rem',marginBottom:'0.5rem'}}
              />
              <div style={{maxHeight:'68vh',overflowY:'auto'}}>
                {filtered.length === 0 && (
                  <div style={{color:'var(--muted)',fontSize:'0.8rem',textAlign:'center',padding:'1rem'}}>No matching runs</div>
                )}
                {filtered.map(r => {
                  const sel = selectedRun?.id === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRun(r)}
                      style={{
                        padding:'0.4rem 0.5rem',borderRadius:'0.3rem',cursor:'pointer',marginBottom:'0.1rem',
                        background: sel ? 'rgba(218,170,0,0.1)' : 'transparent',
                        borderLeft: sel ? '2px solid var(--accent)' : '2px solid transparent',
                      }}
                    >
                      <div style={{fontSize:'0.78rem',fontWeight:600,color:sel?'var(--accent)':'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={r.run_name}>
                        {r.run_name}
                      </div>
                      <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem',display:'flex',gap:'0.35rem',alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{padding:'0.05rem 0.22rem',background:isDia(r.mode)?'#1e3a5f':'#3b1f1f',color:isDia(r.mode)?'#93c5fd':'#fca5a5',borderRadius:'0.2rem',fontSize:'0.65rem',fontWeight:700}}>{r.mode||'?'}</span>
                        <span>{new Date(r.run_date).toLocaleDateString([],{month:'short',day:'numeric',year:'2-digit'})}</span>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'100px'}}>{r.instrument}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right panel */}
            <div>
              {!selectedRun && (
                <div className="card" style={{textAlign:'center',padding:'5rem 2rem',color:'var(--muted)'}}>
                  <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.4}}>⬡</div>
                  <div style={{fontSize:'1rem',fontWeight:600,marginBottom:'0.4rem'}}>Select a run</div>
                  <div style={{fontSize:'0.85rem'}}>Choose a timsTOF run from the list to view its ion mobility data</div>
                </div>
              )}

              {selectedRun && panelLoading && (
                <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>
                  Loading ion mobility data…
                </div>
              )}

              {selectedRun && !panelLoading && !mapData && !statsData && !windowData && (
                <div className="card">
                  <h3>No ion mobility data</h3>
                  <p style={{color:'var(--muted)',marginTop:'0.5rem',fontSize:'0.85rem',lineHeight:'1.6'}}>
                    No 4DFF .features file found and no diaPASEF windows in analysis.tdf for <strong>{selectedRun.run_name}</strong>.<br/>
                    Run 4DFF feature finding on the .d directory to populate the feature map and histograms.
                    DIA acquisitions show the window layout automatically without needing 4DFF.
                  </p>
                </div>
              )}

              {selectedRun && !panelLoading && (mapData || statsData || windowData) && (
                <div>
                  {/* Run header card */}
                  <div className="card" style={{padding:'0.6rem 1rem',marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'0.5rem'}}>
                      <div>
                        <span style={{fontWeight:700,fontSize:'0.95rem'}}>{selectedRun.run_name}</span>
                        <span style={{color:'var(--muted)',fontSize:'0.8rem',marginLeft:'0.75rem'}}>{selectedRun.instrument}</span>
                        <span style={{color:'var(--muted)',fontSize:'0.8rem',marginLeft:'0.5rem'}}>
                          {new Date(selectedRun.run_date).toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'})}
                        </span>
                      </div>
                      <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                        {/* Prominent overlay toggles — always visible when data available */}
                        {windowData?.windows?.length > 0 && (
                          <button
                            onClick={() => setShowWindowOverlay(v => !v)}
                            title={showWindowOverlay ? 'Hide diaPASEF window overlay on all charts' : 'Show diaPASEF isolation windows on all charts'}
                            style={{
                              display:'flex',alignItems:'center',gap:'0.3rem',
                              padding:'0.28rem 0.7rem', fontSize:'0.8rem', fontWeight: 600,
                              background: showWindowOverlay ? 'rgba(0,174,183,0.18)' : 'rgba(0,174,183,0.07)',
                              color: showWindowOverlay ? '#00d4e0' : '#4a8cbb',
                              border: `1px solid ${showWindowOverlay ? '#00d4e0' : 'rgba(0,174,183,0.3)'}`,
                              borderRadius:'0.4rem', cursor:'pointer',
                              transition:'all 0.15s',
                            }}
                          >
                            <span style={{fontSize:'0.9rem'}}>⊞</span>
                            {showWindowOverlay ? 'Windows ON' : 'Windows'}
                            <span style={{fontSize:'0.68rem',opacity:0.75,marginLeft:'0.1rem'}}>
                              {windowData.windows.length}w·{windowData.n_window_groups}g
                            </span>
                          </button>
                        )}
                        {pasefData?.events?.length > 0 && (
                          <button
                            onClick={() => setShowPasefOverlay(v => !v)}
                            title={showPasefOverlay ? 'Hide PASEF events' : 'Show ddaPASEF precursor isolation events'}
                            style={{
                              display:'flex',alignItems:'center',gap:'0.3rem',
                              padding:'0.28rem 0.7rem', fontSize:'0.8rem', fontWeight: 600,
                              background: showPasefOverlay ? 'rgba(217,119,6,0.18)' : 'rgba(217,119,6,0.07)',
                              color: showPasefOverlay ? '#fbbf24' : '#a07020',
                              border: `1px solid ${showPasefOverlay ? '#fbbf24' : 'rgba(217,119,6,0.3)'}`,
                              borderRadius:'0.4rem', cursor:'pointer',
                            }}
                          >
                            <span style={{fontSize:'0.9rem'}}>◈</span>
                            {showPasefOverlay ? 'PASEF ON' : 'PASEF'}
                          </button>
                        )}
                        <div style={{display:'flex',gap:'0.3rem',alignItems:'center',marginLeft:'0.2rem'}}>
                          {mapData && mapData.source !== 'diann' && <span style={{padding:'0.1rem 0.45rem',background:'#1e3a5f',color:'#bfdbfe',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>4DFF ✓</span>}
                          {mapData && mapData.source === 'diann' && <span style={{padding:'0.1rem 0.45rem',background:'#1a2e3a',color:'#93c5fd',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>DIA-NN ✓</span>}
                          {windowData && <span style={{padding:'0.1rem 0.45rem',background:'#1a2e1a',color:'#86efac',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>diaPASEF ✓</span>}
                          {pasefData && <span style={{padding:'0.1rem 0.45rem',background:'#2d1f0a',color:'#fcd34d',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>ddaPASEF ✓</span>}
                          {selectedRun.gate_result && <GateBadge result={selectedRun.gate_result} />}
                        </div>
                      </div>
                    </div>
                    {/* Window overlay summary strip */}
                    {showWindowOverlay && windowData?.windows?.length > 0 && (
                      <div style={{marginTop:'0.4rem',padding:'0.25rem 0.4rem',background:'rgba(0,174,183,0.07)',borderRadius:'0.3rem',fontSize:'0.73rem',color:'#4a9ab0',display:'flex',gap:'1rem',flexWrap:'wrap'}}>
                        <span>⊞ diaPASEF overlay active</span>
                        <span>m/z {windowData.mz_range[0].toFixed(0)}–{windowData.mz_range[1].toFixed(0)} Da</span>
                        {windowData.mobility_range[0] > 0 && <span>1/K₀ {windowData.mobility_range[0].toFixed(2)}–{windowData.mobility_range[1].toFixed(2)} Vs/cm²</span>}
                        {windowData.rt_range?.[1] > 0 && <span>RT {(windowData.rt_range[0]/60).toFixed(1)}–{(windowData.rt_range[1]/60).toFixed(1)} min</span>}
                        <span style={{color:'var(--muted)'}}>Overlay shown on all 2D and 3D charts below</span>
                      </div>
                    )}
                  </div>

                  {/* 3D scatter — RT × m/z × 1/K0 coloured by charge */}
                  {data3d && (() => {
                    // Always show z=1–6 buttons so immunopeptidomics +1 ions are always accessible
                    // even if current run was searched with min-pr-charge 2
                    const dataCharges = new Set(data3d.charge);
                    const allCharges = [0,1,2,3,4,5,6];
                    const rtRange = data3d.rt.length ? [Math.min(...data3d.rt), Math.max(...data3d.rt)] : [0,1];
                    const mzRange = data3d.mz.length ? [Math.min(...data3d.mz), Math.max(...data3d.mz)] : [0,1];
                    return (
                      <div className="card" style={{marginBottom:'0.75rem'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem',gap:'0.5rem',flexWrap:'wrap'}}>
                          <h3 style={{margin:0}}>4D Feature Map — RT × m/z × 1/K₀</h3>
                          <div style={{display:'flex',alignItems:'center',gap:'0.4rem',flexWrap:'wrap'}}>
                            {windowData?.windows?.length > 0 && (
                              <button
                                onClick={() => setShowWindowOverlay(v => !v)}
                                title={showWindowOverlay ? 'Hide diaPASEF window boxes' : 'Overlay diaPASEF isolation windows as 3D boxes'}
                                style={{
                                  padding:'0.2rem 0.55rem', fontSize:'0.78rem',
                                  background: showWindowOverlay ? '#0d6ea8' : 'var(--surface)',
                                  color: showWindowOverlay ? '#fff' : 'var(--muted)',
                                  border:`1px solid ${showWindowOverlay ? '#0d6ea8' : 'var(--border)'}`,
                                  borderRadius:'0.35rem', cursor:'pointer', fontWeight: showWindowOverlay ? 700 : 400,
                                }}
                              >{showWindowOverlay ? '⬡ DIA ON' : '⬡ DIA'}</button>
                            )}
                            {pasefData?.events?.length > 0 && (
                              <button
                                onClick={() => setShowPasefOverlay(v => !v)}
                                title={showPasefOverlay ? 'Hide PASEF events' : 'Overlay ddaPASEF precursor selection events'}
                                style={{
                                  padding:'0.2rem 0.55rem', fontSize:'0.78rem',
                                  background: showPasefOverlay ? '#d97706' : 'var(--surface)',
                                  color: showPasefOverlay ? '#fff' : 'var(--muted)',
                                  border:`1px solid ${showPasefOverlay ? '#d97706' : 'var(--border)'}`,
                                  borderRadius:'0.35rem', cursor:'pointer', fontWeight: showPasefOverlay ? 700 : 400,
                                }}
                              >{showPasefOverlay ? '◈ PASEF ON' : '◈ PASEF'}</button>
                            )}
                            <ExportBtn plotRef={plot3dRef} filename={`${selectedRun?.run_name||'run'}-4d-scatter`} />
                            <button
                              onClick={() => setAutoRotate(v => !v)}
                              title={autoRotate ? 'Stop auto-rotation (or drag the plot)' : 'Start auto-rotation'}
                              style={{
                                padding:'0.2rem 0.55rem', fontSize:'0.78rem',
                                background: autoRotate ? 'rgba(96,165,250,0.18)' : 'var(--surface)',
                                color: autoRotate ? '#60a5fa' : 'var(--muted)',
                                border:`1px solid ${autoRotate ? '#60a5fa66' : 'var(--border)'}`,
                                borderRadius:'0.35rem', cursor:'pointer', fontWeight: autoRotate ? 700 : 400,
                              }}
                            >{autoRotate ? '⏸ Rotate ON' : '▶ Auto Rotate'}</button>
                            <button
                              onClick={() => setShowFilters(f => !f)}
                              style={{background:'transparent',border:'1px solid var(--border)',color:'var(--accent)',borderRadius:'0.3rem',padding:'0.2rem 0.6rem',cursor:'pointer',fontSize:'0.78rem'}}
                            >
                              {showFilters ? '▲ Hide filters' : '▼ m/z, RT & 1/K₀ filters'}
                            </button>
                          </div>
                        </div>

                        {/* Charge state toggles — always visible */}
                        <div style={{display:'flex',gap:'0.3rem',flexWrap:'wrap',alignItems:'center',marginBottom:'0.5rem'}}>
                          <span style={{color:'var(--muted)',fontSize:'0.72rem',marginRight:'0.1rem'}}>Charge:</span>
                          {allCharges.map(z => {
                            const active = !filterCharges.has(z);
                            const inData = dataCharges.has(z);
                            const col = CHARGE_COLORS[z] || '#94a3b8';
                            const lbl = CHARGE_LABEL[z] || `+${z}`;
                            const tip = inData
                              ? `${CHARGE_TITLE[z]||`z=${z}`}: click to hide`
                              : `${CHARGE_TITLE[z]||`z=${z}`}: not present in this dataset`;
                            return (
                              <button key={z}
                                onClick={() => setFilterCharges(prev => {
                                  const next = new Set(prev);
                                  if (next.has(z)) next.delete(z); else next.add(z);
                                  if (next.size >= allCharges.length) return new Set();
                                  return next;
                                })}
                                title={tip}
                                style={{
                                  padding:'0.2rem 0.55rem',borderRadius:'0.3rem',cursor:'pointer',fontSize:'0.82rem',fontWeight:700,
                                  background: active && inData ? col+'33' : active && !inData ? col+'0d' : 'transparent',
                                  color: active ? (inData ? col : col+'66') : '#3a4a5a',
                                  border:`1px solid ${active && inData ? col+'88' : active && !inData ? col+'33' : '#1e3a5f'}`,
                                  opacity: inData ? 1 : 0.45,
                                  transition:'all 0.12s',
                                }}
                              >{lbl}{!inData ? ' ·' : ''}</button>
                            );
                          })}
                          {filterCharges.size > 0 && (
                            <button onClick={() => setFilterCharges(new Set())}
                              style={{padding:'0.2rem 0.5rem',borderRadius:'0.3rem',cursor:'pointer',fontSize:'0.72rem',background:'transparent',color:'var(--muted)',border:'1px solid var(--border)'}}>
                              show all
                            </button>
                          )}
                        </div>

                        {/* m/z, RT, and 1/K₀ range filters — collapsible */}
                        {showFilters && (() => {
                          const ook0Range = data3d?.mobility?.length ? [Math.min(...data3d.mobility), Math.max(...data3d.mobility)] : [0.6, 1.6];
                          const inpSt = {width:'70px',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',padding:'0.2rem 0.3rem',fontSize:'0.78rem'};
                          const hasAnyRange = filterMzMin || filterMzMax || filterRtMin || filterRtMax || filterOok0Min || filterOok0Max;
                          return (
                            <div style={{background:'rgba(1,26,58,0.6)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.75rem',marginBottom:'0.6rem',display:'flex',flexWrap:'wrap',gap:'1.25rem',alignItems:'flex-end'}}>
                              {/* m/z range */}
                              <div>
                                <div style={{color:'var(--muted)',fontSize:'0.72rem',marginBottom:'0.3rem'}}>m/z range (Th)</div>
                                <div style={{display:'flex',gap:'0.3rem',alignItems:'center'}}>
                                  <input type="number" placeholder={mzRange[0].toFixed(0)} value={filterMzMin}
                                    onChange={e => setFilterMzMin(e.target.value)} step="1" style={inpSt} />
                                  <span style={{color:'var(--muted)'}}>–</span>
                                  <input type="number" placeholder={mzRange[1].toFixed(0)} value={filterMzMax}
                                    onChange={e => setFilterMzMax(e.target.value)} step="1" style={inpSt} />
                                </div>
                              </div>
                              {/* RT range */}
                              <div>
                                <div style={{color:'var(--muted)',fontSize:'0.72rem',marginBottom:'0.3rem'}}>RT range (min)</div>
                                <div style={{display:'flex',gap:'0.3rem',alignItems:'center'}}>
                                  <input type="number" placeholder={(rtRange[0]/60).toFixed(1)} value={filterRtMin}
                                    onChange={e => setFilterRtMin(e.target.value)} step="0.5" style={inpSt} />
                                  <span style={{color:'var(--muted)'}}>–</span>
                                  <input type="number" placeholder={(rtRange[1]/60).toFixed(1)} value={filterRtMax}
                                    onChange={e => setFilterRtMax(e.target.value)} step="0.5" style={inpSt} />
                                </div>
                              </div>
                              {/* 1/K₀ range */}
                              <div>
                                <div style={{color:'var(--muted)',fontSize:'0.72rem',marginBottom:'0.3rem'}}>1/K₀ range (Vs/cm²)</div>
                                <div style={{display:'flex',gap:'0.3rem',alignItems:'center'}}>
                                  <input type="number" placeholder={ook0Range[0].toFixed(3)} value={filterOok0Min}
                                    onChange={e => setFilterOok0Min(e.target.value)} step="0.01" style={inpSt} />
                                  <span style={{color:'var(--muted)'}}>–</span>
                                  <input type="number" placeholder={ook0Range[1].toFixed(3)} value={filterOok0Max}
                                    onChange={e => setFilterOok0Max(e.target.value)} step="0.01" style={inpSt} />
                                </div>
                              </div>
                              {hasAnyRange && (
                                <button onClick={() => { setFilterMzMin(''); setFilterMzMax(''); setFilterRtMin(''); setFilterRtMax(''); setFilterOok0Min(''); setFilterOok0Max(''); }}
                                  style={{alignSelf:'flex-end',padding:'0.2rem 0.5rem',background:'transparent',color:'var(--muted)',border:'1px solid var(--border)',borderRadius:'0.3rem',cursor:'pointer',fontSize:'0.72rem'}}>
                                  Clear ranges
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.5rem'}}>
                          {filteredData3d
                            ? <>{filteredData3d.n_shown.toLocaleString()} of {data3d.n_total.toLocaleString()} features</>
                            : <span style={{color:'#f97316'}}>No features match the current filters</span>
                          }
                          &nbsp;·&nbsp; colour = charge &nbsp;·&nbsp; size = intensity &nbsp;·&nbsp;
                          <span style={{color:'var(--accent)'}}>drag to rotate · scroll to zoom</span>
                        </div>
                        <div ref={plot3dRef} style={{width:'100%',height:'520px',borderRadius:'0.4rem',overflow:'hidden',border:'1px solid var(--border)',background:'var(--bg)'}} />
                      </div>
                    );
                  })()}

                  {/* m/z × 1/K₀ intensity landscape (PEAKS-style surface) */}
                  {data3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.3rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>m/z × 1/K₀ Intensity Landscape</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.2rem'}}>
                            Surface height = log₁₀(intensity) &nbsp;·&nbsp; scatter overlay coloured by charge &nbsp;·&nbsp;
                            <span style={{color:'var(--accent)'}}>drag to rotate · scroll to zoom</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.4rem',alignItems:'center',flexWrap:'wrap'}}>
                          <ExportBtn plotRef={mzLandscapeRef} filename={`${selectedRun?.run_name||'run'}-landscape`} />
                          {[...new Set(data3d.charge)].sort((a,b)=>a-b).map(z => (
                            <span key={z} title={CHARGE_TITLE[z]||`z=${z}`} style={{
                              padding:'0.1rem 0.4rem',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700,
                              background: (CHARGE_COLORS[z]||'#94a3b8')+'22',
                              color: CHARGE_COLORS[z]||'#94a3b8',
                              border:`1px solid ${(CHARGE_COLORS[z]||'#94a3b8')}55`,
                            }}>{CHARGE_LABEL[z]||`+${z}`}</span>
                          ))}
                        </div>
                      </div>
                      <div ref={mzLandscapeRef} style={{width:'100%',height:'500px',borderRadius:'0.4rem',overflow:'hidden',border:'1px solid var(--border)',background:'var(--bg)'}} />
                    </div>
                  )}

                  {/* Waterfall spectrum — PEAKS Studio style */}
                  {data3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.3rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Waterfall Spectrum — m/z × 1/K₀</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.2rem'}}>
                            Vertical spikes = relative intensity per mobility layer &nbsp;·&nbsp;
                            {filteredData3d?.n_shown?.toLocaleString()} ions across {60} mobility layers &nbsp;·&nbsp;
                            <span style={{color:'var(--accent)'}}>drag to rotate · scroll to zoom</span>
                          </div>
                        </div>
                        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'0.3rem'}}>
                          <ExportBtn plotRef={waterfallRef} filename={`${selectedRun?.run_name||'run'}-waterfall`} />
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',textAlign:'right'}}>
                            <div>normalised per layer</div>
                            <div style={{color:'#4a8cbb'}}>like PEAKS Studio</div>
                          </div>
                        </div>
                      </div>
                      <div ref={waterfallRef} style={{width:'100%',height:'500px',borderRadius:'0.4rem',overflow:'hidden',border:'1px solid var(--border)',background:'var(--bg)'}} />
                    </div>
                  )}

                  {/* Ion cloud — m/z vs 1/K₀ (Tenzer / Gomez-Zepeda style) */}
                  {filteredData3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.35rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Ion Cloud — m/z × 1/K₀</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.15rem'}}>
                            Charge-state lanes in m/z × ion mobility space · Tenzer / Gomez-Zepeda style (PMC10937930) · filters above apply
                            &nbsp;·&nbsp; <span style={{color:'#60a5fa'}}>click → inspect · box select → filter · scroll to zoom</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                          {windowData?.windows?.length > 0 && (
                            <button
                              onClick={() => setShowWindowOverlay(v => !v)}
                              title={showWindowOverlay ? 'Hide diaPASEF isolation windows' : 'Overlay diaPASEF isolation windows from method'}
                              style={{
                                padding:'0.25rem 0.65rem',
                                fontSize:'0.78rem',
                                background: showWindowOverlay ? 'var(--accent)' : 'var(--surface)',
                                color:      showWindowOverlay ? 'var(--bg)'     : 'var(--muted)',
                                border:`1px solid ${showWindowOverlay ? 'var(--accent)' : 'var(--border)'}`,
                                borderRadius:'0.4rem',
                                cursor:'pointer',
                                fontWeight: showWindowOverlay ? 700 : 400,
                                whiteSpace:'nowrap',
                              }}
                            >
                              {showWindowOverlay ? '⊞ Method ON' : '⊞ Method'}
                            </button>
                          )}
                          {pasefData?.events?.length > 0 && (
                            <button
                              onClick={() => setShowPasefOverlay(v => !v)}
                              title={showPasefOverlay ? 'Hide PASEF events' : 'Overlay ddaPASEF precursor selection events'}
                              style={{
                                padding:'0.25rem 0.65rem', fontSize:'0.78rem',
                                background: showPasefOverlay ? '#d97706' : 'var(--surface)',
                                color: showPasefOverlay ? '#fff' : 'var(--muted)',
                                border:`1px solid ${showPasefOverlay ? '#d97706' : 'var(--border)'}`,
                                borderRadius:'0.4rem', cursor:'pointer',
                                fontWeight: showPasefOverlay ? 700 : 400, whiteSpace:'nowrap',
                              }}
                            >
                              {showPasefOverlay ? '◈ PASEF ON' : '◈ PASEF'}
                            </button>
                          )}
                          <ExportBtn plotRef={cloudMzRef} filename={`${selectedRun?.run_name||'run'}-cloud-mz`} />
                        </div>
                      </div>
                      {(showWindowOverlay && windowData?.windows?.length > 0) && (
                        <div style={{fontSize:'0.73rem',color:'var(--muted)',marginBottom:'0.2rem',paddingLeft:'0.1rem'}}>
                          {windowData.windows.length} diaPASEF windows
                          · m/z {windowData.mz_range[0].toFixed(0)}–{windowData.mz_range[1].toFixed(0)} Da
                          {windowData.mobility_range[0] > 0 && ` · 1/K₀ ${windowData.mobility_range[0].toFixed(2)}–${windowData.mobility_range[1].toFixed(2)} Vs/cm²`}
                          · {windowData.n_window_groups} group{windowData.n_window_groups !== 1 ? 's' : ''}
                          &nbsp;·&nbsp; hover for details · coloured by group
                        </div>
                      )}
                      {(showPasefOverlay && pasefData?.events?.length > 0) && (
                        <div style={{fontSize:'0.73rem',color:'#fbbf24',marginBottom:'0.2rem',paddingLeft:'0.1rem'}}>
                          {pasefData.n_events.toLocaleString()} PASEF events · rectangles show precursor isolation boxes in m/z × 1/K₀
                        </div>
                      )}
                      <div ref={cloudMzRef} style={{height:'340px'}} />
                    </div>
                  )}

                  {/* Ion cloud — RT vs 1/K₀ (Kulej / MSKCC style) */}
                  {filteredData3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.35rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Ion Cloud — RT × 1/K₀</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.15rem'}}>
                            Retention time × ion mobility coloured by charge · Kulej / MSKCC style (biorxiv 2025.08.23) · filters above apply
                            &nbsp;·&nbsp; <span style={{color:'#60a5fa'}}>click → inspect · box select → filter · scroll to zoom</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
                          {(windowData?.windows?.length > 0 || pasefData?.events?.length > 0) && (
                            <div style={{display:'flex',gap:'0.35rem'}}>
                              {windowData?.windows?.length > 0 && (
                                <button onClick={() => setShowWindowOverlay(v => !v)}
                                  style={{padding:'0.2rem 0.5rem',fontSize:'0.76rem',
                                    background:showWindowOverlay?'var(--accent)':'var(--surface)',
                                    color:showWindowOverlay?'var(--bg)':'var(--muted)',
                                    border:`1px solid ${showWindowOverlay?'var(--accent)':'var(--border)'}`,
                                    borderRadius:'0.35rem',cursor:'pointer',fontWeight:showWindowOverlay?700:400}}>
                                  {showWindowOverlay ? '⊞ ON' : '⊞'}
                                </button>
                              )}
                              {pasefData?.events?.length > 0 && (
                                <button onClick={() => setShowPasefOverlay(v => !v)}
                                  style={{padding:'0.2rem 0.5rem',fontSize:'0.76rem',
                                    background:showPasefOverlay?'#d97706':'var(--surface)',
                                    color:showPasefOverlay?'#fff':'var(--muted)',
                                    border:`1px solid ${showPasefOverlay?'#d97706':'var(--border)'}`,
                                    borderRadius:'0.35rem',cursor:'pointer',fontWeight:showPasefOverlay?700:400}}>
                                  {showPasefOverlay ? '◈ ON' : '◈'}
                                </button>
                              )}
                            </div>
                          )}
                          <ExportBtn plotRef={cloudRtRef} filename={`${selectedRun?.run_name||'run'}-cloud-rt`} />
                        </div>
                      </div>
                      <div ref={cloudRtRef} style={{height:'320px'}} />
                    </div>
                  )}

                  {/* ── Ion Detail Panel ─────────────────────────────────────── */}
                  {ionTarget && (
                    <div className="card" style={{marginBottom:'0.75rem',borderColor:'rgba(96,165,250,0.35)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.75rem'}}>
                        <div>
                          <div style={{display:'flex',alignItems:'center',gap:'0.75rem',flexWrap:'wrap'}}>
                            <span style={{fontWeight:700,fontSize:'0.9rem',color:'var(--accent)'}}>Ion Detail</span>
                            <span style={{fontFamily:'monospace',fontSize:'0.85rem',color:'#e2e8f0'}}>m/z {ionTarget.mz.toFixed(4)}</span>
                            <span style={{fontSize:'0.8rem',color:'var(--muted)'}}>RT {(ionTarget.rt/60).toFixed(2)} min</span>
                            <span style={{fontSize:'0.8rem',color:'var(--muted)'}}>1/K₀ {ionTarget.ook0.toFixed(4)} Vs/cm²</span>
                            {ionTarget.charge > 0 && (
                              <span style={{padding:'0.1rem 0.35rem',background:({'1':'rgba(251,191,36,0.15)','2':'rgba(96,165,250,0.15)','3':'rgba(34,197,94,0.15)','4':'rgba(249,115,22,0.15)'}[ionTarget.charge]||'rgba(148,163,184,0.1)'),color:({'1':'#fbbf24','2':'#60a5fa','3':'#22c55e','4':'#f97316'}[ionTarget.charge]||'#94a3b8'),borderRadius:'0.25rem',fontSize:'0.75rem',fontWeight:700}}>
                                z={ionTarget.charge}
                              </span>
                            )}
                            <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>± 10 ppm · dashed line = reported value</span>
                          </div>
                          {ionLoading && <div style={{fontSize:'0.75rem',color:'var(--muted)',marginTop:'0.3rem'}}>Extracting from raw .d data…</div>}
                          {!ionLoading && !ionDetail && !frameHeatmap && !frameSpectrum && (
                            <div style={{fontSize:'0.75rem',color:'#f97316',marginTop:'0.3rem'}}>
                              No raw signal found — the timsdata DLL may be unavailable, or this run has no MS1 frames at this m/z. Check that timsdata.dll is present in stan/tools/timsdata/libs/.
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setIonTarget(null); setIonDetail(null);
                            setFrameHeatmap(null); setFrameSpectrum(null);
                          }}
                          style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:'0.3rem',padding:'0.2rem 0.5rem',cursor:'pointer',fontSize:'0.8rem',flexShrink:0}}
                        >
                          ✕ Close
                        </button>
                      </div>

                      {(ionDetail || frameHeatmap || frameSpectrum) && (
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>

                          {/* Row 1 — left: XIC · right: Summed Frame Spectrum */}
                          <div>
                            <div style={{fontSize:'0.78rem',color:'#60a5fa',fontWeight:600,marginBottom:'0.3rem'}}>
                              Extracted Ion Chromatogram (XIC)
                              <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'0.4rem',fontSize:'0.72rem'}}>full run · dashed = reported RT</span>
                            </div>
                            <div ref={xicRef} style={{height:'220px',background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)'}} />
                          </div>
                          <div>
                            <div style={{fontSize:'0.78rem',color:'#a78bfa',fontWeight:600,marginBottom:'0.3rem'}}>
                              Summed Frame Spectrum
                              {frameSpectrum && <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'0.4rem',fontSize:'0.72rem'}}>RT {(frameSpectrum.rt_sec/60).toFixed(2)} min · all mobility scans summed</span>}
                            </div>
                            <div ref={frameSpectrumRef} style={{height:'220px',background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)'}} />
                          </div>

                          {/* Row 2 — left: EIM mobilogram · right: Frame Heatmap */}
                          <div>
                            <div style={{fontSize:'0.78rem',color:'#22c55e',fontWeight:600,marginBottom:'0.3rem'}}>
                              Extracted Ion Mobilogram (EIM)
                              <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'0.4rem',fontSize:'0.72rem'}}>±20 s RT window · dashed = reported 1/K₀</span>
                            </div>
                            <div ref={mobilogramRef} style={{height:'280px',background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)'}} />
                          </div>
                          <div>
                            <div style={{fontSize:'0.78rem',color:'#38bdf8',fontWeight:600,marginBottom:'0.3rem'}}>
                              Frame Heatmap — raw m/z × 1/K₀
                              {frameHeatmap && <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'0.4rem',fontSize:'0.72rem'}}>{frameHeatmap.n_peaks?.toLocaleString()} peaks · crosshairs = clicked ion</span>}
                            </div>
                            <div ref={frameHeatmapRef} style={{height:'280px',background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)'}} />
                          </div>

                        </div>
                      )}
                    </div>
                  )}

                  {/* RT × 1/K0 feature density heatmap */}
                  {mapData && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.4rem'}}>
                        <h3 style={{margin:0}}>RT × 1/K₀ Feature Density Map</h3>
                        <ExportBtn plotRef={canvasRef} filename={`${selectedRun?.run_name||'run'}-mobility-heatmap`} isCanvas={true} />
                      </div>
                      <div style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.5rem'}}>
                        log₁₀(Σ intensity) &nbsp;·&nbsp; {mapData.n_features?.toLocaleString()} features &nbsp;·&nbsp;
                        RT {(mapData.rt_range[0]/60).toFixed(1)}–{(mapData.rt_range[1]/60).toFixed(1)} min &nbsp;·&nbsp;
                        1/K₀ {mapData.mobility_range[0]}–{mapData.mobility_range[1]} Vs/cm²
                      </div>
                      <div style={{background:'var(--bg)',borderRadius:'0.4rem',overflow:'hidden',border:'1px solid var(--border)'}}>
                        <canvas ref={canvasRef} width={760} height={320} style={{width:'100%',height:'auto',display:'block'}}/>
                      </div>
                    </div>
                  )}

                  {/* Feature statistics histograms */}
                  {statsData && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <h3 style={{marginBottom:'0.6rem'}}>Feature Statistics</h3>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1.4fr 1.4fr',gap:'1rem'}}>
                        <div>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>Charge State Distribution</div>
                          <ChargeChart data={charge} />
                        </div>
                        <div>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>1/K₀ FWHM Distribution</div>
                          <BarChart
                            edges={fwhm?.edges} counts={fwhm?.counts}
                            color="#38bdf8" xLabel="1/K₀ FWHM (Vs/cm²)" yLabel="Features"
                            markerVal={fwhm?.median_fwhm}
                            markerLabel={fwhm?.median_fwhm != null ? `med=${fwhm.median_fwhm.toFixed(4)}` : null}
                          />
                        </div>
                        <div>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>Feature Intensity (log₁₀)</div>
                          <BarChart
                            edges={intHist?.edges} counts={intHist?.counts}
                            color="#a78bfa" xLabel="log₁₀(Intensity)" yLabel="Features"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Method Coverage — ions inside vs outside windows ── */}
                  {windowCoverage && filteredData3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.5rem',flexWrap:'wrap',gap:'0.5rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Method Coverage — m/z × 1/K₀</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.2rem'}}>
                            Which ions fall inside the isolation windows?
                            {windowData?.windows?.length > 0 && ' · diaPASEF windows'}
                            {pasefData?.events?.length > 0 && ' · ddaPASEF events'}
                            &nbsp;·&nbsp; <span style={{color:'#60a5fa'}}>click any point → XIC + mobilogram</span>
                          </div>
                        </div>
                        {/* Coverage stats badges */}
                        <div style={{display:'flex',gap:'0.6rem',alignItems:'center',flexWrap:'wrap'}}>
                          {windowCoverage.n_dia > 0 && (
                            <div style={{textAlign:'center',background:'rgba(0,174,183,0.1)',border:'1px solid rgba(0,174,183,0.3)',borderRadius:'0.4rem',padding:'0.25rem 0.6rem'}}>
                              <div style={{fontWeight:700,fontSize:'1rem',color:'#00d4e0'}}>{windowCoverage.n_dia.toLocaleString()}</div>
                              <div style={{fontSize:'0.65rem',color:'var(--muted)'}}>inside DIA ({(windowCoverage.n_dia/windowCoverage.n_total*100).toFixed(1)}%)</div>
                            </div>
                          )}
                          {windowCoverage.n_pasef > 0 && (
                            <div style={{textAlign:'center',background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.3)',borderRadius:'0.4rem',padding:'0.25rem 0.6rem'}}>
                              <div style={{fontWeight:700,fontSize:'1rem',color:'#fbbf24'}}>{windowCoverage.n_pasef.toLocaleString()}</div>
                              <div style={{fontSize:'0.65rem',color:'var(--muted)'}}>inside PASEF ({(windowCoverage.n_pasef/windowCoverage.n_total*100).toFixed(1)}%)</div>
                            </div>
                          )}
                          <div style={{textAlign:'center',background:'rgba(148,163,184,0.07)',border:'1px solid rgba(148,163,184,0.15)',borderRadius:'0.4rem',padding:'0.25rem 0.6rem'}}>
                            <div style={{fontWeight:700,fontSize:'1rem',color:'#94a3b8'}}>{windowCoverage.n_out.toLocaleString()}</div>
                            <div style={{fontSize:'0.65rem',color:'var(--muted)'}}>outside ({(windowCoverage.n_out/windowCoverage.n_total*100).toFixed(1)}%)</div>
                          </div>
                        </div>
                      </div>
                      <div ref={coverageRef} style={{height:'380px'}} />
                      <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.3rem',paddingLeft:'0.2rem'}}>
                        Coloured ions = inside window (by charge) · Gray = outside · Rectangles = isolation windows
                        {pasefData?.events?.length > 0 && ' · Amber outlines = individual PASEF events'}
                      </div>
                    </div>
                  )}

                  {/* ── PASEF Polygon — ddaPASEF event coverage in m/z × 1/K₀ ── */}
                  {pasefData?.events?.length > 0 && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.35rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>PASEF Polygon — ddaPASEF Coverage</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.15rem'}}>
                            {pasefData.n_events.toLocaleString()} precursor isolation events · each point = one MS2 frame event
                            · colour = retention time · diagonal band = ion mobility–m/z correlation
                          </div>
                        </div>
                        <div style={{fontSize:'0.72rem',color:'var(--muted)',textAlign:'right',lineHeight:'1.5'}}>
                          <div>y: 1/K₀ centre of scan range</div>
                          <div style={{color:'#fbbf24'}}>like Bruker timsControl</div>
                        </div>
                      </div>
                      <div ref={pasefPolygonRef} style={{height:'320px'}} />
                    </div>
                  )}

                  {/* diaPASEF window layout */}
                  {windowData && (
                    <div className="card">
                      <h3 style={{marginBottom:'0.4rem'}}>diaPASEF Window Layout</h3>
                      <div style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.5rem'}}>
                        m/z × 1/K₀ isolation grid &nbsp;·&nbsp;
                        m/z {windowData.mz_range[0].toFixed(0)}–{windowData.mz_range[1].toFixed(0)} Da
                        {windowData.mobility_range[0] > 0 && ` · 1/K₀ ${windowData.mobility_range[0].toFixed(2)}–${windowData.mobility_range[1].toFixed(2)} Vs/cm²`}
                        &nbsp;·&nbsp; {windowData.n_window_groups} group{windowData.n_window_groups !== 1 ? 's' : ''}
                        &nbsp;·&nbsp; {windowData.windows.length} sub-window{windowData.windows.length !== 1 ? 's' : ''}
                      </div>
                      <div style={{background:'var(--bg)',borderRadius:'0.4rem',padding:'0.25rem',border:'1px solid var(--border)'}}>
                        <DiaWindowChart data={windowData} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      );
    }

    /* ── Enzyme / PTM Efficiency Tab ───────────────────────────────── */

    /* ── Spectra Tab ────────────────────────────────────────────────── */

    // Sequence display with boxed residues + mod badges (like PEAKS header)
    function SequenceDisplay({ sequence, residues }) {
      if (!residues || residues.length === 0) {
        return <span style={{fontFamily:'monospace',fontSize:'0.85rem',color:'var(--text)'}}>{sequence}</span>;
      }
      return (
        <div style={{display:'flex',flexWrap:'wrap',gap:'1px',alignItems:'flex-end'}}>
          {residues.map((r, i) => (
            <div key={i} style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
              {r.mods.length > 0 && (
                <div style={{display:'flex',gap:'1px',marginBottom:'1px'}}>
                  {r.mods.map(([label, isFixed], j) => (
                    <span key={j} style={{
                      fontSize:'0.52rem',padding:'0 2px',borderRadius:'2px',lineHeight:'1.3',
                      background: isFixed ? 'rgba(100,120,140,0.3)' : 'rgba(249,115,22,0.25)',
                      color: isFixed ? '#7090a8' : '#fb923c',
                      border: `1px solid ${isFixed ? 'rgba(100,120,140,0.3)' : 'rgba(249,115,22,0.4)'}`,
                    }}>{label}</span>
                  ))}
                </div>
              )}
              <div style={{
                width:'20px',height:'22px',display:'flex',alignItems:'center',justifyContent:'center',
                border:'1px solid var(--border)',borderRadius:'3px',fontSize:'0.78rem',fontWeight:700,
                color:'var(--text)',background:'rgba(255,255,255,0.04)',fontFamily:'monospace',
              }}>{r.aa}</div>
            </div>
          ))}
        </div>
      );
    }

    // Stick (stem) spectrum plot via Plotly
    function SpectrumPlot({ specData, mirror = false, height = 280, label = '', bestFrMz = null }) {
      const ref = useRef(null);
      useEffect(() => {
        if (!ref.current || !window.Plotly || !specData) return;
        const { b_ions, y_ions } = specData;
        const sign = mirror ? -1 : 1;

        function makeTrace(ions, color, name) {
          const xs = [], ys = [];
          ions.forEach(ion => {
            if (ion.charge > 1) return; // only singly-charged for clarity
            xs.push(ion.mz, ion.mz, null);
            ys.push(0, sign * 100, null);
          });
          // labels (text scatter)
          const lx = ions.filter(i => i.charge === 1).map(i => i.mz);
          const ly = ions.filter(i => i.charge === 1).map(() => sign * 103);
          const lt = ions.filter(i => i.charge === 1).map(i => i.label);
          return [
            { type:'scatter', mode:'lines', name, x:xs, y:ys,
              line:{color, width:1.5}, hovertemplate:`%{x:.4f} Th<extra>${name}</extra>` },
            { type:'scatter', mode:'text', name, showlegend:false,
              x:lx, y:ly, text:lt,
              textfont:{size:7.5, color},
              textposition: mirror ? 'bottom center' : 'top center',
              hoverinfo:'skip' },
          ];
        }

        const bTraces = makeTrace(b_ions, '#60a5fa', 'b ions');
        const yTraces = makeTrace(y_ions, '#f87171', 'y ions');

        // Best.Fr.Mz star marker (experimental observed fragment)
        const expTraces = [];
        if (bestFrMz) {
          expTraces.push({
            type:'scatter', mode:'markers+text',
            name:'Best obs. fragment',
            x:[bestFrMz], y:[sign * 90],
            marker:{symbol:'star', size:14, color:'#4ade80', line:{color:'#16a34a',width:1}},
            text:['★ obs.'], textposition: mirror ? 'bottom center' : 'top center',
            textfont:{size:9, color:'#4ade80'},
            hovertemplate:`Best.Fr.Mz: ${bestFrMz.toFixed(4)} Th<extra>DIA-NN observed</extra>`,
          });
        }

        const yRange = mirror ? [-120, 10] : [-10, 120];
        const bg = '#011a3a', axCol = '#a0b4cc', gridCol = '#0d2b5e';
        const layout = {
          paper_bgcolor: bg, plot_bgcolor: bg,
          font:{color:axCol, size:10},
          margin:{l:45, r:10, t:label ? 24 : 8, b:36},
          height,
          showlegend: !mirror,
          legend:{x:0.01, y:0.99, bgcolor:'rgba(1,26,58,0.8)', font:{size:9}},
          xaxis:{color:axCol, gridcolor:gridCol, zerolinecolor:gridCol, title:{text:'m/z (Th)', font:{size:9}}},
          yaxis:{color:axCol, gridcolor:gridCol, zerolinecolor:gridCol, range:yRange,
                 title:{text:'Rel. intensity (%)', font:{size:9}},
                 tickvals: mirror ? [-100,-50,0] : [0,50,100],
                 ticktext: mirror ? ['100','50','0'] : ['0','50','100'] },
          title: label ? {text:label, font:{size:10, color:axCol}, x:0} : undefined,
          shapes:[{type:'line', x0:0, x1:1, xref:'paper', y0:0, y1:0,
                   line:{color:axCol, width:1}}],
        };
        const config = {responsive:true, displayModeBar:false};
        window.Plotly.react(ref.current, [...bTraces, ...yTraces, ...expTraces], layout, config);
      }, [specData, mirror, height, label]);

      if (!specData) return null;
      return (
        <div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'0.2rem'}}>
            <ExportBtn plotRef={ref} filename={`spectrum-${label||'chart'}`} scale={2} />
          </div>
          <div ref={ref} style={{width:'100%'}} />
        </div>
      );
    }

    // One run slot: run picker + peptide search
    function RunSlot({ slotIdx, allRuns, value, onChange, showAllRuns = false }) {
      const [peptSearch, setPeptSearch] = useState('');
      const [peptides, setPeptides] = useState([]);
      const [pLoading, setPLoading] = useState(false);
      const { runId, peptide } = value;

      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        if (showAllRuns) return allRuns;
        return allRuns.filter(r => r.raw_path && r.raw_path.endsWith('.d'));
      }, [allRuns, showAllRuns]);

      // Debounced peptide search
      useEffect(() => {
        if (!runId) { setPeptides([]); return; }
        const t = setTimeout(() => {
          setPLoading(true);
          fetch(API + `/api/runs/${runId}/peptides?q=${encodeURIComponent(peptSearch)}&limit=60`)
            .then(r => r.ok ? r.json() : [])
            .then(d => { setPeptides(Array.isArray(d) ? d : []); setPLoading(false); })
            .catch(() => setPLoading(false));
        }, 300);
        return () => clearTimeout(t);
      }, [runId, peptSearch]);

      const slotColors = ['#60a5fa','#f97316','#a78bfa'];
      const col = slotColors[slotIdx];

      return (
        <div style={{flex:'1 1 0',minWidth:0,border:`1px solid ${col}33`,borderRadius:'0.5rem',padding:'0.6rem',background:'rgba(1,26,58,0.4)'}}>
          <div style={{fontSize:'0.72rem',fontWeight:700,color:col,marginBottom:'0.4rem'}}>
            Run {slotIdx + 1}
          </div>
          {/* Run selector */}
          <select
            value={runId || ''}
            onChange={e => onChange({runId: e.target.value || null, peptide: null})}
            style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',
                    borderRadius:'0.3rem',padding:'0.25rem 0.3rem',fontSize:'0.75rem',marginBottom:'0.4rem'}}
          >
            <option value=''>— select run —</option>
            {dRuns.map(r => (
              <option key={r.id} value={r.id}>{r.run_name}</option>
            ))}
          </select>

          {runId && (
            <>
              <input
                type='text' placeholder='Search peptide…' value={peptSearch}
                onChange={e => setPeptSearch(e.target.value)}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',
                        borderRadius:'0.3rem',padding:'0.25rem 0.3rem',fontSize:'0.75rem',marginBottom:'0.3rem'}}
              />
              <div style={{maxHeight:'180px',overflowY:'auto',fontSize:'0.72rem'}}>
                {pLoading && <div style={{color:'var(--muted)',padding:'0.25rem'}}>Searching…</div>}
                {!pLoading && peptides.length === 0 && (
                  <div style={{color:'var(--muted)',padding:'0.25rem'}}>No peptides found</div>
                )}
                {peptides.map((p, i) => {
                  const sel = peptide?.sequence === p.sequence && peptide?.charge === p.charge;
                  return (
                    <div key={i} onClick={() => onChange({runId, peptide: p})}
                      style={{padding:'0.2rem 0.35rem',borderRadius:'0.25rem',cursor:'pointer',marginBottom:'1px',
                              background: sel ? col+'22' : 'transparent',
                              borderLeft:`2px solid ${sel ? col : 'transparent'}`,
                              whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      <span style={{color: sel ? col : 'var(--text)',fontFamily:'monospace',fontWeight: sel ? 700 : 400}}>
                        {p.stripped || p.sequence}
                      </span>
                      <span style={{color:'var(--muted)',marginLeft:'0.4rem'}}>
                        z={p.charge} · {p.mz.toFixed(3)} · {p.rt.toFixed(2)}min
                        {p.mobility ? ` · 1/K₀=${p.mobility.toFixed(3)}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {peptide && (
            <div style={{marginTop:'0.4rem',padding:'0.3rem 0.4rem',background:col+'11',borderRadius:'0.3rem',
                         border:`1px solid ${col}33`}}>
              <div style={{fontSize:'0.7rem',color:col,fontWeight:700,marginBottom:'0.15rem'}}>Selected</div>
              <div style={{fontFamily:'monospace',fontSize:'0.72rem',color:'var(--text)',wordBreak:'break-all'}}>
                {peptide.stripped || peptide.sequence}
              </div>
              <div style={{fontSize:'0.68rem',color:'var(--muted)',marginTop:'0.1rem'}}>
                z={peptide.charge} · {peptide.mz.toFixed(4)} Th · RT {peptide.rt.toFixed(2)} min
              </div>
              <button onClick={() => onChange({runId, peptide:null})}
                style={{marginTop:'0.3rem',fontSize:'0.65rem',color:'var(--muted)',background:'transparent',
                        border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}>
                clear
              </button>
            </div>
          )}
        </div>
      );
    }

    function ExperimentalPanel({ expData, col }) {
      if (!expData?.available) return (
        <div style={{fontSize:'0.73rem',color:'var(--muted)',padding:'0.35rem 0.5rem',
                     background:'rgba(255,255,255,0.02)',borderRadius:'0.3rem',marginTop:'0.4rem',
                     border:'1px solid var(--border)'}}>
          Experimental: {expData?.message || 'No data'}
        </div>
      );
      const rows = [
        expData.precursor_mz   && {k:'Precursor m/z', v:`${expData.precursor_mz?.toFixed(4)} Th`},
        expData.best_fr_mz     && {k:'Best fragment m/z', v:`${expData.best_fr_mz?.toFixed(4)} Th`, note:`Δ${expData.best_fr_mz_delta?.toFixed(4)}`},
        expData.rt             && {k:'Measured RT', v:`${expData.rt?.toFixed(3)} min`, sub:`window ${expData.rt_start?.toFixed(2)}–${expData.rt_stop?.toFixed(2)} min`},
        expData.mobility       && {k:'Measured 1/K₀', v:`${expData.mobility?.toFixed(4)} Vs/cm²`, sub:`predicted ${expData.predicted_im?.toFixed(4)??'—'}`},
        expData.intensity      && {k:'Precursor intensity', v:expData.intensity?.toExponential(2)},
        expData.n_obs > 1      && {k:'Observations', v:`${expData.n_obs} in report`},
      ].filter(Boolean);

      return (
        <div style={{marginTop:'0.5rem',padding:'0.4rem 0.6rem',background:`${col}08`,border:`1px solid ${col}22`,borderRadius:'0.35rem'}}>
          <div style={{fontSize:'0.7rem',fontWeight:700,color:col,marginBottom:'0.3rem'}}>
            Experimental (DIA-NN 2.x) — Best.Fr.Mz shown as ★ on spectrum
          </div>
          <div style={{display:'flex',gap:'1.25rem',flexWrap:'wrap'}}>
            {rows.map(({k,v,note,sub}) => (
              <div key={k}>
                <span style={{fontSize:'0.68rem',color:'var(--muted)'}}>{k}: </span>
                <span style={{fontSize:'0.72rem',color:'var(--text)',fontWeight:600}}>{v}</span>
                {note && <span style={{fontSize:'0.66rem',color:'var(--muted)',marginLeft:'0.2rem'}}>{note}</span>}
                {sub  && <div style={{fontSize:'0.65rem',color:'var(--muted)'}}>{sub}</div>}
              </div>
            ))}
          </div>
          <div style={{fontSize:'0.66rem',color:'var(--muted)',marginTop:'0.3rem',fontStyle:'italic'}}>
            Full fragment intensities require Bruker TDF SDK (timsrust). Theoretical b/y ions shown at equal height.
          </div>
        </div>
      );
    }

    // ── Frame Spectrum Plot — real measured data from .d file ──────────────────
    function FrameSpectrumPlot({ frameData, expData, height = 300, label = '', col = '#60a5fa', mirror = false }) {
      const ref = useRef(null);
      useEffect(() => {
        if (!ref.current || !window.Plotly) return;
        if (!frameData?.mz?.length) {
          // No raw data — show Best.Fr.Mz only if available
          if (!expData?.available || !expData?.best_fr_mz) {
            window.Plotly.purge(ref.current);
            return;
          }
          const sign = mirror ? -1 : 1;
          window.Plotly.react(ref.current, [{
            type:'bar', x:[expData.best_fr_mz], y:[sign * 100],
            marker:{color:col+'cc'},
            name:'Best fragment (DIA-NN)',
            hovertemplate:`Best.Fr.Mz: ${expData.best_fr_mz.toFixed(4)} Th<extra></extra>`,
          }], {
            paper_bgcolor:'#011a3a', plot_bgcolor:'#011a3a',
            font:{color:'#a0b4cc',size:10},
            margin:{l:45,r:10,t:label?24:8,b:36}, height,
            xaxis:{color:'#a0b4cc',gridcolor:'#0d2b5e',title:{text:'m/z (Th)',font:{size:9}}},
            yaxis:{color:'#a0b4cc',gridcolor:'#0d2b5e',range:mirror?[-120,10]:[-10,120],
                   title:{text:'Rel. intensity (%)',font:{size:9}}},
            title: label ? {text:label,font:{size:10,color:'#a0b4cc'},x:0} : undefined,
          }, {responsive:true,displayModeBar:false});
          return;
        }

        const sign = mirror ? -1 : 1;
        const maxInt = Math.max(...frameData.intensity);
        const relInt = frameData.intensity.map(v => sign * (v / maxInt) * 100);

        // Stick traces — build x,y with null separators for vertical lines
        const xs = [], ys = [];
        for (let i = 0; i < frameData.mz.length; i++) {
          xs.push(frameData.mz[i], frameData.mz[i], null);
          ys.push(0, relInt[i], null);
        }

        const traces = [{
          type:'scatter', mode:'lines', name:'Frame spectrum',
          x:xs, y:ys,
          line:{color:col+'99', width:1},
          hoverinfo:'skip',
        }];

        // Best.Fr.Mz star marker
        if (expData?.available && expData?.best_fr_mz) {
          traces.push({
            type:'scatter', mode:'markers+text',
            name:'Best.Fr.Mz (DIA-NN)',
            x:[expData.best_fr_mz], y:[sign * 95],
            marker:{symbol:'star',size:14,color:'#4ade80',line:{color:'#16a34a',width:1}},
            text:['★'], textposition: mirror?'bottom center':'top center',
            textfont:{size:10,color:'#4ade80'},
            hovertemplate:`Best.Fr.Mz: ${expData.best_fr_mz.toFixed(4)} Th<extra>DIA-NN identified</extra>`,
          });
        }

        const bg='#011a3a', axCol='#a0b4cc', gridCol='#0d2b5e';
        window.Plotly.react(ref.current, traces, {
          paper_bgcolor:bg, plot_bgcolor:bg,
          font:{color:axCol,size:10},
          margin:{l:45,r:10,t:label?24:8,b:36}, height,
          showlegend:true,
          legend:{x:0.01,y:mirror?0.05:0.99,bgcolor:'rgba(1,26,58,0.85)',font:{size:9}},
          xaxis:{color:axCol,gridcolor:gridCol,title:{text:'m/z (Th)',font:{size:9}}},
          yaxis:{color:axCol,gridcolor:gridCol,
                 range:mirror?[-115,10]:[-5,115],
                 title:{text:'Rel. intensity (%)',font:{size:9}},
                 tickvals:mirror?[-100,-50,0]:[0,50,100],
                 ticktext:mirror?['100','50','0']:['0','50','100']},
          title: label?{text:label,font:{size:10,color:axCol},x:0}:undefined,
          shapes:[{type:'line',x0:0,x1:1,xref:'paper',y0:0,y1:0,line:{color:axCol,width:1}}],
        }, {responsive:true,displayModeBar:false});
      }, [frameData, expData, height, mirror, label, col]);

      return (
        <div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'0.2rem'}}>
            <ExportBtn plotRef={ref} filename={`spectrum-${label||'frame'}`} scale={2} />
          </div>
          <div ref={ref} style={{width:'100%'}} />
        </div>
      );
    }

    // ── Frame mirror plot — two real spectra, mirrored ─────────────────────────
    function FrameMirrorPlot({ frameA, frameB, expA, expB, colA, colB }) {
      const ref = useRef(null);
      useEffect(() => {
        if (!ref.current || !window.Plotly) return;

        function makeSticks(frame, sign, color, name) {
          if (!frame?.mz?.length) return [];
          const maxInt = Math.max(...frame.intensity);
          const xs=[], ys=[];
          for (let i=0; i<frame.mz.length; i++) {
            xs.push(frame.mz[i], frame.mz[i], null);
            ys.push(0, sign * (frame.intensity[i]/maxInt) * 100, null);
          }
          return [{type:'scatter',mode:'lines',name,x:xs,y:ys,
                   line:{color:color+'99',width:1},hoverinfo:'skip'}];
        }

        const traces = [
          ...makeSticks(frameA,  1, colA, 'Run A'),
          ...makeSticks(frameB, -1, colB, 'Run B (mirrored)'),
        ];

        // Best.Fr.Mz markers
        if (expA?.available && expA?.best_fr_mz)
          traces.push({type:'scatter',mode:'markers',name:'A Best.Fr.Mz',
            x:[expA.best_fr_mz],y:[92],marker:{symbol:'star',size:12,color:'#4ade80'},
            hovertemplate:`A Best.Fr.Mz: ${expA.best_fr_mz.toFixed(4)} Th<extra></extra>`});
        if (expB?.available && expB?.best_fr_mz)
          traces.push({type:'scatter',mode:'markers',name:'B Best.Fr.Mz',
            x:[expB.best_fr_mz],y:[-92],marker:{symbol:'star',size:12,color:'#fb923c'},
            hovertemplate:`B Best.Fr.Mz: ${expB.best_fr_mz.toFixed(4)} Th<extra></extra>`});

        const bg='#011a3a', axCol='#a0b4cc', gridCol='#0d2b5e';
        window.Plotly.react(ref.current, traces, {
          paper_bgcolor:bg, plot_bgcolor:bg,
          font:{color:axCol,size:10},
          margin:{l:50,r:10,t:8,b:40}, height:380,
          showlegend:true,
          legend:{x:0.01,y:0.99,bgcolor:'rgba(1,26,58,0.85)',font:{size:9}},
          xaxis:{color:axCol,gridcolor:gridCol,title:{text:'m/z (Th)',font:{size:9}}},
          yaxis:{color:axCol,gridcolor:gridCol,range:[-115,115],
                 title:{text:'Rel. intensity (%)',font:{size:9}},
                 tickvals:[-100,-50,0,50,100],ticktext:['100','50','0','50','100']},
          shapes:[{type:'line',x0:0,x1:1,xref:'paper',y0:0,y1:0,line:{color:axCol,width:1.5}}],
        }, {responsive:true,displayModeBar:false});
      }, [frameA, frameB, expA, expB, colA, colB]);

      return <div ref={ref} style={{width:'100%'}} />;
    }

    function SpectraTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [slots, setSlots] = useState([
        {runId:null, peptide:null},
        {runId:null, peptide:null},
        {runId:null, peptide:null},
      ]);
      const [frameSpectra, setFrameSpectra] = useState([null, null, null]);
      const [expData,      setExpData]      = useState([null, null, null]);
      const [loading,      setLoading]      = useState([false, false, false]);

      // When a peptide is selected: fetch experimental data, then frame spectrum
      useEffect(() => {
        slots.forEach((slot, i) => {
          if (!slot.runId || !slot.peptide) {
            setFrameSpectra(prev => { const n=[...prev]; n[i]=null; return n; });
            setExpData(prev => { const n=[...prev]; n[i]=null; return n; });
            return;
          }
          setLoading(prev => { const n=[...prev]; n[i]=true; return n; });
          const seq = encodeURIComponent(slot.peptide.sequence);
          fetch(API + `/api/runs/${slot.runId}/spectrum-experimental?sequence=${seq}&charge=${slot.peptide.charge}`)
            .then(r => r.ok ? r.json() : null).catch(() => null)
            .then(exp => {
              setExpData(prev => { const n=[...prev]; n[i]=exp; return n; });
              // Fetch frame spectrum if we have a measured RT
              const rt = exp?.rt ?? slot.peptide?.rt;
              if (!rt) {
                setFrameSpectra(prev => { const n=[...prev]; n[i]=null; return n; });
                setLoading(prev => { const n=[...prev]; n[i]=false; return n; });
                return;
              }
              const rtSec = rt * 60;
              fetch(API + `/api/runs/${slot.runId}/frame-spectrum?rt=${rtSec}`)
                .then(r => r.ok ? r.json() : null).catch(() => null)
                .then(frame => {
                  setFrameSpectra(prev => { const n=[...prev]; n[i]=frame?.mz?.length ? frame : null; return n; });
                  setLoading(prev => { const n=[...prev]; n[i]=false; return n; });
                });
            });
        });
      }, [slots[0].peptide, slots[1].peptide, slots[2].peptide, slots[0].runId, slots[1].runId, slots[2].runId]);

      const activeCount = [0,1,2].filter(i => slots[i].peptide && (frameSpectra[i] || expData[i]?.available)).length;
      const slotColors = ['#60a5fa','#f97316','#a78bfa'];

      if (runsLoading) return <div className="empty">Loading…</div>;

      return (
        <div>
          {/* Header */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1.25rem'}}>
            <div style={{display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
              <div>
                <span style={{color:'var(--accent)',fontWeight:700,fontSize:'1.1rem'}}>Spectrum Viewer</span>
                <span style={{color:'var(--muted)',fontSize:'0.82rem',marginLeft:'0.75rem'}}>
                  Experimental frame spectra from raw .d data · Best.Fr.Mz from DIA-NN · up to 3-way comparison
                </span>
              </div>
              <div style={{color:'var(--muted)',fontSize:'0.78rem',marginLeft:'auto',lineHeight:1.5}}>
                <span style={{color:'#4ade80',fontWeight:600}}>★ Best.Fr.Mz</span>
                <span style={{marginLeft:'0.75rem'}}>highest-scoring fragment identified by DIA-NN</span>
              </div>
            </div>
          </div>

          {/* Run slot selectors */}
          <div style={{display:'flex',gap:'0.75rem',marginBottom:'1rem',alignItems:'stretch'}}>
            {slots.map((slot, i) => (
              <RunSlot key={i} slotIdx={i} allRuns={allRuns} value={slot} showAllRuns
                onChange={v => setSlots(prev => { const n=[...prev]; n[i]=v; return n; })} />
            ))}
          </div>

          {/* No data placeholder */}
          {activeCount === 0 && (
            <div className="card" style={{textAlign:'center',padding:'4rem 2rem',color:'var(--muted)'}}>
              <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.35}}>⚛</div>
              <div style={{fontWeight:600,marginBottom:'0.4rem',color:'var(--text)'}}>Select a run and peptide above</div>
              <div style={{fontSize:'0.85rem',lineHeight:1.6,maxWidth:'480px',margin:'0 auto'}}>
                Shows the actual measured frame spectrum from the raw .d file at the peptide's retention time,
                with the DIA-NN Best.Fr.Mz marked as ★.<br/>
                Load 2 or 3 peptides for mirror comparison.
              </div>
            </div>
          )}

          {/* Single spectrum */}
          {activeCount === 1 && [0,1,2].map(i => {
            if (!slots[i].peptide || (!frameSpectra[i] && !expData[i]?.available)) return null;
            const p   = slots[i].peptide;
            const col = slotColors[i];
            const exp = expData[i];
            const frame = frameSpectra[i];
            const runObj = Array.isArray(allRuns) ? allRuns.find(r=>String(r.id)===String(slots[i].runId)) : null;
            return (
              <div key={i} className="card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.6rem',flexWrap:'wrap',gap:'0.5rem'}}>
                  <div>
                    <div style={{fontFamily:'monospace',fontSize:'0.9rem',fontWeight:600,color:col,marginBottom:'0.3rem',wordBreak:'break-all'}}>
                      {p.stripped || p.sequence}
                    </div>
                    <div style={{fontSize:'0.78rem',color:'var(--muted)',display:'flex',gap:'1.5rem',flexWrap:'wrap'}}>
                      <span>m/z <span style={{color:'var(--text)',fontWeight:600}}>{p.mz.toFixed(4)}</span> Th</span>
                      <span>z = <span style={{color:'var(--text)',fontWeight:600}}>{p.charge}</span></span>
                      <span>RT <span style={{color:'var(--text)',fontWeight:600}}>{(exp?.rt ?? p.rt).toFixed(2)}</span> min</span>
                      {(exp?.mobility ?? p.mobility) && <span>1/K₀ <span style={{color:'var(--text)',fontWeight:600}}>{(exp?.mobility ?? p.mobility).toFixed(4)}</span></span>}
                      {runObj && <span style={{color:col}}>{runObj.run_name}</span>}
                    </div>
                  </div>
                  {loading[i] && <span style={{color:'var(--muted)',fontSize:'0.8rem'}}>Loading…</span>}
                  {frame && <span style={{padding:'0.15rem 0.5rem',background:col+'22',color:col,borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>
                    {frame.mz.length} peaks · RT {frame.rt_sec?.toFixed(1)}s
                  </span>}
                </div>
                {(frame || exp?.available) && (
                  <FrameSpectrumPlot frameData={frame} expData={exp} height={300} col={col} />
                )}
                {!frame && exp?.available && (
                  <div style={{fontSize:'0.75rem',color:'var(--muted)',padding:'0.4rem 0.6rem',
                               background:'rgba(255,255,255,0.02)',borderRadius:'0.3rem',
                               border:'1px solid var(--border)',marginTop:'0.4rem'}}>
                    Raw .d file unavailable for this run — frame spectrum cannot be rendered.
                    Best.Fr.Mz and measured metadata shown below.
                  </div>
                )}
                <MeasuredMetaPanel expData={exp} col={col} />
              </div>
            );
          })}

          {/* 2-way mirror */}
          {activeCount === 2 && (() => {
            const active = [0,1,2]
              .filter(i => slots[i].peptide && (frameSpectra[i] || expData[i]?.available))
              .map(i => ({idx:i, frame:frameSpectra[i], exp:expData[i], slot:slots[i], col:slotColors[i]}));
            if (active.length < 2) return null;
            const [A, B] = active;
            return (
              <div className="card">
                <h3 style={{marginBottom:'0.6rem'}}>Mirror Comparison — Experimental Spectra</h3>
                <div style={{display:'flex',gap:'1rem',marginBottom:'0.6rem',flexWrap:'wrap'}}>
                  {[A,B].map(({slot, exp, col}, j) => {
                    const p = slot.peptide;
                    const runObj = Array.isArray(allRuns) ? allRuns.find(r=>String(r.id)===String(slot.runId)) : null;
                    return (
                      <div key={j} style={{flex:'1 1 0',minWidth:'200px'}}>
                        <div style={{fontSize:'0.7rem',color:col,fontWeight:700,marginBottom:'0.15rem'}}>
                          {j===0?'▲ Run A (top)':'▼ Run B (mirrored)'}
                        </div>
                        <div style={{fontFamily:'monospace',fontSize:'0.78rem',fontWeight:600,color:col}}>{p.stripped||p.sequence}</div>
                        <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.1rem'}}>
                          {p.mz.toFixed(4)} Th · z={p.charge} · RT {(exp?.rt??p.rt).toFixed(2)} min
                          {(exp?.mobility??p.mobility) ? ` · 1/K₀ ${(exp?.mobility??p.mobility).toFixed(4)}` : ''}
                          {runObj ? ` · ${runObj.run_name}` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <FrameMirrorPlot frameA={A.frame} frameB={B.frame} expA={A.exp} expB={B.exp} colA={A.col} colB={B.col} />
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem',marginTop:'0.5rem'}}>
                  <MeasuredMetaPanel expData={A.exp} col={A.col} compact />
                  <MeasuredMetaPanel expData={B.exp} col={B.col} compact />
                </div>
              </div>
            );
          })()}

          {/* 3-way stacked */}
          {activeCount === 3 && (() => {
            const active = [0,1,2]
              .filter(i => slots[i].peptide && (frameSpectra[i] || expData[i]?.available))
              .map(i => ({idx:i, frame:frameSpectra[i], exp:expData[i], slot:slots[i], col:slotColors[i]}));
            return (
              <div>
                {active.map(({idx, frame, exp, slot, col}) => {
                  const p = slot.peptide;
                  const runObj = Array.isArray(allRuns) ? allRuns.find(r=>String(r.id)===String(slot.runId)) : null;
                  return (
                    <div key={idx} className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',alignItems:'baseline',gap:'0.75rem',marginBottom:'0.4rem',flexWrap:'wrap'}}>
                        <span style={{fontSize:'0.7rem',fontWeight:700,color:col}}>Run {['A','B','C'][idx]}</span>
                        <span style={{fontFamily:'monospace',fontSize:'0.8rem',fontWeight:600,color:col}}>{p.stripped||p.sequence}</span>
                        <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>
                          {p.mz.toFixed(4)} Th · z={p.charge} · RT {(exp?.rt??p.rt).toFixed(2)} min
                          {runObj ? ` · ${runObj.run_name}` : ''}
                        </span>
                      </div>
                      <FrameSpectrumPlot frameData={frame} expData={exp} height={220} col={col} />
                      <MeasuredMetaPanel expData={exp} col={col} compact />
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      );
    }

    // Measured metadata panel — replaces the old ExperimentalPanel
    function MeasuredMetaPanel({ expData, col, compact = false }) {
      if (!expData?.available) return (
        <div style={{fontSize:'0.73rem',color:'var(--muted)',padding:'0.35rem 0.5rem',
                     background:'rgba(255,255,255,0.02)',borderRadius:'0.3rem',marginTop:'0.4rem',
                     border:'1px solid var(--border)'}}>
          {expData?.message || 'Experimental data unavailable'}
        </div>
      );
      const rows = [
        expData.precursor_mz   && {k:'Precursor m/z',    v:`${expData.precursor_mz?.toFixed(4)} Th`},
        expData.best_fr_mz     && {k:'Best.Fr.Mz ★',    v:`${expData.best_fr_mz?.toFixed(4)} Th`, note:expData.best_fr_mz_delta ? `Δ${expData.best_fr_mz_delta?.toFixed(4)}` : null},
        expData.rt             && {k:'RT',               v:`${expData.rt?.toFixed(3)} min`, sub:`window ${expData.rt_start?.toFixed(2)}–${expData.rt_stop?.toFixed(2)} min`},
        expData.mobility       && {k:'1/K₀ (measured)',  v:`${expData.mobility?.toFixed(4)} Vs/cm²`, sub:expData.predicted_im ? `predicted ${expData.predicted_im?.toFixed(4)}` : null},
        expData.intensity      && {k:'Precursor qty',    v:expData.intensity?.toExponential(2)},
        expData.n_obs > 1      && {k:'Observations',     v:`${expData.n_obs} in report`},
      ].filter(Boolean);

      return (
        <div style={{marginTop:'0.4rem',padding:'0.35rem 0.6rem',background:`${col}08`,border:`1px solid ${col}22`,borderRadius:'0.35rem'}}>
          <div style={{display:'flex',gap:'1.25rem',flexWrap:'wrap'}}>
            {rows.map(({k,v,note,sub}) => (
              <div key={k}>
                <span style={{fontSize:'0.67rem',color:'var(--muted)'}}>{k}: </span>
                <span style={{fontSize:'0.72rem',color:'var(--text)',fontWeight:600}}>{v}</span>
                {note && <span style={{fontSize:'0.65rem',color:'var(--muted)',marginLeft:'0.2rem'}}>{note}</span>}
                {sub  && <div style={{fontSize:'0.64rem',color:'var(--muted)'}}>{sub}</div>}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Mirror plot component — A above zero, B mirrored below
    function MirrorPlot({ specA, specB, colA, colB }) {
      const ref = useRef(null);
      useEffect(() => {
        if (!ref.current || !window.Plotly || !specA || !specB) return;

        function makeStems(ions, sign, color, name) {
          const xs=[], ys=[];
          ions.forEach(ion => {
            if (ion.charge > 1) return;
            xs.push(ion.mz, ion.mz, null);
            ys.push(0, sign * 100, null);
          });
          const lx = ions.filter(i=>i.charge===1).map(i=>i.mz);
          const ly = ions.filter(i=>i.charge===1).map(()=> sign * 105);
          const lt = ions.filter(i=>i.charge===1).map(i=>i.label);
          return [
            {type:'scatter', mode:'lines', name, x:xs, y:ys,
             line:{color, width:1.5}, hovertemplate:`%{x:.4f} Th<extra>${name}</extra>`},
            {type:'scatter', mode:'text', name, showlegend:false,
             x:lx, y:ly, text:lt,
             textfont:{size:7, color},
             textposition: sign>0 ? 'top center' : 'bottom center',
             hoverinfo:'skip'},
          ];
        }

        const bA = makeStems(specA.b_ions,  1, '#60a5fa', 'b (top)');
        const yA = makeStems(specA.y_ions,  1, '#f87171', 'y (top)');
        const bB = makeStems(specB.b_ions, -1, colB+'bb', 'b (bottom)');
        const yB = makeStems(specB.y_ions, -1, '#fcd34d', 'y (bottom)');

        const bg='#011a3a', axCol='#a0b4cc', gridCol='#0d2b5e';
        const layout = {
          paper_bgcolor:bg, plot_bgcolor:bg,
          font:{color:axCol, size:10},
          margin:{l:50, r:10, t:8, b:40},
          height: 380,
          showlegend:true,
          legend:{x:0.01, y:0.99, bgcolor:'rgba(1,26,58,0.85)', font:{size:9}},
          xaxis:{color:axCol, gridcolor:gridCol, zerolinecolor:gridCol,
                 title:{text:'m/z (Th)', font:{size:9}}},
          yaxis:{color:axCol, gridcolor:gridCol, zerolinecolor:gridCol,
                 range:[-120, 120],
                 title:{text:'Rel. intensity (%)', font:{size:9}},
                 tickvals:[-100,-50,0,50,100],
                 ticktext:['100','50','0','50','100']},
          shapes:[{type:'line', x0:0, x1:1, xref:'paper', y0:0, y1:0,
                   line:{color:axCol, width:1.5}}],
        };
        window.Plotly.react(ref.current, [...bA,...yA,...bB,...yB], layout,
          {responsive:true, displayModeBar:false});
      }, [specA, specB, colA, colB]);

      return <div ref={ref} style={{width:'100%'}} />;
    }

    const ENZYME_OPTIONS = [
      {value:'trypsin',      label:'Trypsin',           sites:'K/R (not before P)'},
      {value:'trypsin_lysc', label:'Trypsin/Lys-C',     sites:'K/R (not before P)'},
      {value:'lysc',         label:'Lys-C',              sites:'K'},
      {value:'argc',         label:'Arg-C',              sites:'R'},
      {value:'chymotrypsin', label:'Chymotrypsin',       sites:'F/W/Y (not before P)'},
      {value:'rchymoselect', label:'RChymoSelect',       sites:'R/F/W/Y'},
      {value:'krakatoa',     label:'Krakatoa',           sites:'K/R (all)'},
      {value:'vesuvius',     label:'Vesuvius',           sites:'F/W/Y (all)'},
      {value:'aspn',         label:'Asp-N',              sites:'before D'},
      {value:'proalanase',   label:'ProAlanase',         sites:'P/A'},
      {value:'pepsin',       label:'Pepsin',             sites:'F/L'},
      {value:'nonspecific',  label:'Non-specific',       sites:'N/A'},
    ];

    function EnzymeTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [searchTerm, setSearchTerm] = useState('');
      const [enzymeData, setEnzymeData] = useState(null);
      const [loading, setLoading] = useState(false);
      const [selectedEnzyme, setSelectedEnzyme] = useState('trypsin');

      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        // Show all runs that might have enzyme data (those with result_path set)
        return allRuns.filter(r => r.raw_path && r.raw_path.endsWith('.d'));
      }, [allRuns]);

      const filtered = useMemo(() => {
        if (!searchTerm) return dRuns;
        const q = searchTerm.toLowerCase();
        return dRuns.filter(r =>
          (r.run_name || '').toLowerCase().includes(q) ||
          (r.instrument || '').toLowerCase().includes(q)
        );
      }, [dRuns, searchTerm]);

      useEffect(() => {
        if (!selectedRun) { setEnzymeData(null); return; }
        setLoading(true);
        setEnzymeData(null);
        fetch(API + `/api/runs/${selectedRun.id}/enzyme-stats?enzyme=${selectedEnzyme}`)
          .then(r => r.ok ? r.json() : {})
          .then(d => { setEnzymeData(Object.keys(d).length > 0 ? d : null); setLoading(false); })
          .catch(() => setLoading(false));
      }, [selectedRun?.id, selectedEnzyme]);

      if (runsLoading) return <div className="empty">Loading…</div>;
      if (dRuns.length === 0) return (
        <div className="card">
          <h3>Enzyme Efficiency</h3>
          <p style={{color:'var(--muted)',marginTop:'0.5rem'}}>No Bruker .d runs found yet.</p>
        </div>
      );

      const mc = enzymeData?.missed_cleavages;
      const mcPct = enzymeData?.missed_cleavages_pct;
      const mods = enzymeData?.modifications || [];

      // Missed cleavage bar chart (inline SVG-like bars using divs)
      function McBar() {
        if (!mc) return null;
        const keys = ['0','1','2','3+'];
        const maxCnt = Math.max(...keys.map(k => mc[k] || 0));
        const colors = ['#22c55e','#60a5fa','#f97316','#ef4444'];
        return (
          <div style={{display:'flex',flexDirection:'column',gap:'0.35rem',marginTop:'0.25rem'}}>
            {keys.map((k, i) => {
              const cnt = mc[k] || 0;
              const pct = mcPct?.[k] || 0;
              const w = maxCnt > 0 ? (cnt / maxCnt * 100) : 0;
              return (
                <div key={k} style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                  <div style={{width:'22px',color:'var(--muted)',fontSize:'0.78rem',textAlign:'right',flexShrink:0}}>{k}</div>
                  <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:'3px',height:'16px',position:'relative',overflow:'hidden'}}>
                    <div style={{width:`${w}%`,height:'100%',background:colors[i],borderRadius:'3px',transition:'width 0.4s ease'}} />
                  </div>
                  <div style={{width:'80px',fontSize:'0.78rem',color:'var(--text)'}}>
                    {cnt.toLocaleString()} <span style={{color:'var(--muted)'}}>({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      return (
        <div>
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1.25rem'}}>
            <div style={{display:'flex',gap:'1.5rem',alignItems:'center',flexWrap:'wrap',justifyContent:'space-between'}}>
              <div style={{display:'flex',gap:'2rem',alignItems:'center',flexWrap:'wrap'}}>
                <div>
                  <span style={{color:'var(--accent)',fontWeight:700,fontSize:'1.2rem'}}>{dRuns.length}</span>
                  {' '}<span style={{color:'var(--muted)',fontSize:'0.85rem'}}>timsTOF run{dRuns.length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{color:'var(--muted)',fontSize:'0.8rem'}}>
                  Enzyme efficiency from DIA-NN <code style={{background:'rgba(255,255,255,0.08)',padding:'0 0.25rem',borderRadius:'0.2rem'}}>report.parquet</code> at 1% FDR
                </div>
              </div>
              {/* Enzyme selector */}
              <div style={{display:'flex',alignItems:'center',gap:'0.6rem'}}>
                <label style={{fontSize:'0.8rem',color:'var(--muted)',whiteSpace:'nowrap'}}>Enzyme:</label>
                <select
                  value={selectedEnzyme}
                  onChange={e => setSelectedEnzyme(e.target.value)}
                  style={{background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',
                          borderRadius:'0.4rem',padding:'0.3rem 0.6rem',fontSize:'0.82rem',cursor:'pointer'}}>
                  {ENZYME_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span style={{fontSize:'0.72rem',color:'var(--muted)',whiteSpace:'nowrap'}}>
                  Cuts: {ENZYME_OPTIONS.find(o=>o.value===selectedEnzyme)?.sites}
                </span>
              </div>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'270px 1fr',gap:'1rem',alignItems:'start'}}>
            {/* Run list */}
            <div className="card" style={{padding:'0.75rem',position:'sticky',top:'1rem'}}>
              <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>timsTOF Runs</div>
              <input
                type="text"
                placeholder="Filter…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.3rem 0.5rem',fontSize:'0.8rem',marginBottom:'0.5rem'}}
              />
              <div style={{maxHeight:'68vh',overflowY:'auto'}}>
                {filtered.length === 0 && <div style={{color:'var(--muted)',fontSize:'0.8rem',textAlign:'center',padding:'1rem'}}>No runs</div>}
                {filtered.map(r => {
                  const sel = selectedRun?.id === r.id;
                  return (
                    <div key={r.id} onClick={() => setSelectedRun(r)}
                      style={{padding:'0.4rem 0.5rem',borderRadius:'0.3rem',cursor:'pointer',marginBottom:'0.1rem',
                        background: sel ? 'rgba(218,170,0,0.1)' : 'transparent',
                        borderLeft: sel ? '2px solid var(--accent)' : '2px solid transparent'}}>
                      <div style={{fontSize:'0.78rem',fontWeight:600,color:sel?'var(--accent)':'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.run_name}</div>
                      <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem'}}>
                        {new Date(r.run_date).toLocaleDateString([],{month:'short',day:'numeric',year:'2-digit'})}
                        {' · '}{r.instrument}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right panel */}
            <div>
              {!selectedRun && (
                <div className="card" style={{textAlign:'center',padding:'5rem 2rem',color:'var(--muted)'}}>
                  <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.4}}>🧬</div>
                  <div style={{fontSize:'1rem',fontWeight:600,marginBottom:'0.4rem'}}>Select a run</div>
                  <div style={{fontSize:'0.85rem'}}>View enzyme efficiency and PTM statistics</div>
                </div>
              )}
              {selectedRun && loading && <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>Loading…</div>}
              {selectedRun && !loading && !enzymeData && (
                <div className="card">
                  <h3>No enzyme data</h3>
                  <p style={{color:'var(--muted)',marginTop:'0.5rem',fontSize:'0.85rem'}}>
                    No DIA-NN report.parquet found for <strong>{selectedRun.run_name}</strong>.<br/>
                    The result_path is required — it is set automatically by the watcher after each search.
                  </p>
                </div>
              )}
              {selectedRun && !loading && enzymeData && (
                <div>
                  {/* Run header */}
                  <div className="card" style={{padding:'0.6rem 1rem',marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'0.5rem'}}>
                      <div>
                        <span style={{fontWeight:700,fontSize:'0.95rem'}}>{selectedRun.run_name}</span>
                        <span style={{color:'var(--muted)',fontSize:'0.8rem',marginLeft:'0.75rem'}}>{selectedRun.instrument}</span>
                      </div>
                      <div style={{display:'flex',gap:'0.75rem',flexWrap:'wrap'}}>
                        <div style={{textAlign:'center'}}>
                          <div style={{fontWeight:700,fontSize:'1.1rem',color:'var(--accent)'}}>{(enzymeData.n_precursors||0).toLocaleString()}</div>
                          <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>precursors @ 1%FDR</div>
                        </div>
                        <div style={{textAlign:'center'}}>
                          <div style={{fontWeight:700,fontSize:'1.1rem',color:'#93c5fd'}}>{(enzymeData.n_unique_peptides||0).toLocaleString()}</div>
                          <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>unique peptides</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem',marginBottom:'0.75rem'}}>
                    {/* Missed cleavages */}
                    <div className="card">
                      <h3 style={{marginBottom:'0.15rem'}}>Missed Cleavages</h3>
                      <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.6rem'}}>
                        {ENZYME_OPTIONS.find(o=>o.value===selectedEnzyme)?.label} — cuts {ENZYME_OPTIONS.find(o=>o.value===selectedEnzyme)?.sites}
                        {selectedEnzyme !== 'nonspecific' && (
                          <span> &nbsp;·&nbsp; <span style={{color: (mcPct?.['0']||0) >= 70 ? '#22c55e' : '#f97316'}}>
                            {mcPct?.['0']||0}% fully specific
                          </span></span>
                        )}
                      </div>
                      <McBar />
                    </div>

                    {/* PTM summary */}
                    <div className="card">
                      <h3 style={{marginBottom:'0.5rem'}}>Modifications</h3>
                      {mods.length === 0
                        ? <div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No variable modifications detected</div>
                        : (
                          <div style={{display:'flex',flexDirection:'column',gap:'0.3rem'}}>
                            {mods.map((m, i) => {
                              const barW = mods[0].pct > 0 ? (m.pct / mods[0].pct * 100) : 0;
                              const modColors = ['#f97316','#a78bfa','#38bdf8','#fb7185','#4ade80','#fbbf24'];
                              return (
                                <div key={i} style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                                  <div style={{flex:1,minWidth:0}}>
                                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'2px'}}>
                                      <span style={{fontSize:'0.75rem',color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</span>
                                      <span style={{fontSize:'0.72rem',color:'var(--muted)',flexShrink:0,marginLeft:'0.3rem'}}>{m.pct}%</span>
                                    </div>
                                    <div style={{background:'rgba(255,255,255,0.05)',borderRadius:'2px',height:'10px',overflow:'hidden'}}>
                                      <div style={{width:`${barW}%`,height:'100%',background:modColors[i % modColors.length],borderRadius:'2px'}} />
                                    </div>
                                  </div>
                                  <div style={{fontSize:'0.72rem',color:'var(--muted)',width:'55px',textAlign:'right',flexShrink:0}}>
                                    {m.count.toLocaleString()}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      }
                    </div>
                  </div>

                  {/* Enzyme health summary */}
                  <div className="card">
                    <h3 style={{marginBottom:'0.6rem'}}>Enzyme Health Summary</h3>
                    <div style={{display:'flex',gap:'1.5rem',flexWrap:'wrap'}}>
                      {[
                        {
                          label: 'Specificity (MC=0)',
                          value: `${mcPct?.['0']||0}%`,
                          ok: (mcPct?.['0']||0) >= 70,
                          tip: `≥70% fully specific (${ENZYME_OPTIONS.find(o=>o.value===selectedEnzyme)?.label}) is healthy`,
                        },
                        {
                          label: '≥2 Missed Cleavages',
                          value: `${((mcPct?.['2']||0) + (mcPct?.['3+']||0)).toFixed(1)}%`,
                          ok: ((mcPct?.['2']||0) + (mcPct?.['3+']||0)) < 10,
                          tip: '<10% is healthy',
                        },
                        {
                          label: 'Oxidation (M)',
                          value: (() => {
                            const ox = mods.find(m => m.name === 'Oxidation (M)');
                            return ox ? `${ox.pct}%` : '0%';
                          })(),
                          ok: (() => {
                            const ox = mods.find(m => m.name === 'Oxidation (M)');
                            return !ox || ox.pct < 5;
                          })(),
                          tip: '<5% is healthy; high oxidation may indicate sample quality issues',
                        },
                      ].map(({ label, value, ok, tip }) => (
                        <div key={label} title={tip} style={{
                          background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(249,115,22,0.08)',
                          border: `1px solid ${ok ? 'rgba(34,197,94,0.25)' : 'rgba(249,115,22,0.25)'}`,
                          borderRadius:'0.4rem',padding:'0.5rem 0.85rem',cursor:'help',
                        }}>
                          <div style={{fontWeight:700,fontSize:'1.15rem',color: ok ? '#22c55e' : '#f97316'}}>{value}</div>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.1rem'}}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // ── Health / Analytics Tab ──────────────────────────────────────────────────
    const HEALTH_METRICS = [
      { key: 'n_precursors',              label: 'Precursors',      unit: '',      higher: true,  altKey: 'n_psms',   altLabel: 'PSMs (DDA)' },
      { key: 'peak_capacity',             label: 'Peak Capacity',   unit: '',      higher: true  },
      { key: 'median_mass_acc_ms1_ppm',   label: 'Mass Accuracy',   unit: 'ppm',   higher: false },
      { key: 'ms1_signal',                label: 'MS1 Signal',      unit: '',      higher: true  },
      { key: 'dynamic_range_log10',       label: 'Dynamic Range',   unit: 'log₁₀', higher: true  },
      { key: 'median_points_across_peak', label: 'Points/Peak',     unit: '',      higher: true  },
    ];

    const METRIC_EXPLAINERS = [
      { key: 'n_precursors', title: 'Precursor / PSM Count', color: '#60a5fa',
        body: 'The number of unique peptide precursors identified at 1% FDR (DIA) or PSMs (DDA). This is the primary sensitivity metric — it reflects the combined performance of the LC separation, ionisation, MS acquisition, and database search. Higher is better. Instrument-to-instrument comparisons are only valid when gradient length and injection amount are matched.' },
      { key: 'peak_capacity', title: 'Peak Capacity', color: '#a78bfa',
        body: 'Peak capacity (n) estimates how many peaks of average width could fit across the gradient, calculated as gradient time ÷ median LC peak width (FWHM). It reflects the resolving power of the chromatographic separation. Typical values: 100–400 for nano-LC, 50–200 for Evosep. Declining peak capacity often signals a degrading column or void volume.' },
      { key: 'median_mass_acc_ms1_ppm', title: 'Mass Accuracy (MS1)', color: '#34d399',
        body: 'Median mass error of identified precursor ions in parts-per-million (ppm). Well-calibrated Orbitrap instruments should be ≤2 ppm; TimsTOF typically ≤5 ppm. A drifting or biased error indicates the need for recalibration. Values above 10 ppm cause missed identifications and degraded quantification accuracy.' },
      { key: 'ms1_signal', title: 'MS1 Signal', color: '#f59e0b',
        body: 'Median precursor intensity (log₁₀) of identified peptides. Reflects overall signal yield from ionisation, ion transfer, and detection. Lower signal may indicate source contamination, poor spray, ion suppression, or degraded columns. Compare across runs of the same sample type and amount to catch instrument drift.' },
      { key: 'dynamic_range_log10', title: 'Dynamic Range', color: '#fb923c',
        body: 'The ratio (log₁₀) between the highest and lowest quantified precursor intensities. A wider dynamic range means the instrument is detecting both abundant and trace peptides effectively. Typical values: 3–5 log₁₀ orders. Compression of dynamic range can indicate AGC overfilling, ion space charge, or detector saturation.' },
      { key: 'median_points_across_peak', title: 'Data Points Across Peak', color: '#f472b6',
        body: 'Median number of MS2 acquisitions (data points) within the elution window of a peptide peak. More points enable better peak shape reconstruction and quantification. At least 6–10 points per peak is generally recommended for DIA. Fewer points suggest the cycle time is too long relative to peak width — consider adjusting scan parameters or gradient.' },
    ];

    function HealthTab({ pinnedRunIds, setPinnedRunIds }) {
      const { data: allRuns, loading } = useFetch('/api/runs?limit=1000');
      const [instrFilter, setInstrFilter] = useState('All');
      const [lcFilter, setLcFilter] = useState('All');
      const hasPins = pinnedRunIds && pinnedRunIds.size > 0;
      const [openMetric, setOpenMetric] = useState(null);

      const radarRef = useRef(null);
      const ljRefs = useRef([null, null, null, null, null, null]);

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
        const pctPass = total ? Math.round(pass / total * 100) : 0;
        const precs = filteredRuns.map(r => r.n_precursors || r.n_psms).filter(v => v > 0);
        const bestPrec = precs.length ? Math.max(...precs) : null;
        const meanPrec = precs.length ? Math.round(precs.reduce((a, b) => a + b, 0) / precs.length) : null;
        const lastRun = filteredRuns[filteredRuns.length - 1];
        return { total, pass, warn, fail, pctPass, bestPrec, meanPrec, lastRun };
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
      }, [filteredRuns]);

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
          {/* Pin banner */}
          {hasPins && (
            <div style={{display:'flex', gap:'0.5rem', alignItems:'center', padding:'0.4rem 0.75rem', marginBottom:'0.75rem', background:'rgba(218,170,0,0.08)', border:'1px solid rgba(218,170,0,0.3)', borderRadius:'0.45rem', fontSize:'0.83rem', flexWrap:'wrap'}}>
              <span style={{color:'#DAAA00', fontWeight:700}}>Pinned view — showing {pinnedRunIds.size} run{pinnedRunIds.size !== 1 ? 's' : ''} selected in Run History</span>
              <button onClick={() => setPinnedRunIds(new Set())} style={{padding:'0.15rem 0.45rem', fontSize:'0.78rem', background:'transparent', color:'var(--muted)', border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer'}}>Clear pins</button>
            </div>
          )}

          {/* Filter bar */}
          <div className="card" style={{marginBottom:'1rem',display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
            <strong style={{color:'var(--accent)'}}>Instrument Health</strong>
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

          {/* Your Lab Summary Cards */}
          {summary && (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'0.75rem',marginBottom:'1rem'}}>
              {[
                { label: 'Total Runs',  value: summary.total,                    color: '#60a5fa' },
                { label: 'Pass Rate',   value: `${summary.pctPass}%`,            color: summary.pctPass >= 80 ? '#22c55e' : summary.pctPass >= 60 ? '#eab308' : '#ef4444' },
                { label: '✓ Pass',      value: summary.pass,                     color: '#22c55e' },
                { label: '⚠ Warn',      value: summary.warn,                     color: '#eab308' },
                { label: '✗ Fail',      value: summary.fail,                     color: '#ef4444' },
                { label: 'Best Run',    value: summary.bestPrec ? summary.bestPrec.toLocaleString() : 'N/A', color: '#DAAA00' },
                { label: 'Mean Prec.',  value: summary.meanPrec ? summary.meanPrec.toLocaleString() : 'N/A', color: '#a78bfa' },
                { label: 'Last Run',    value: summary.lastRun ? summary.lastRun.run_date.substring(0,10) : 'N/A', color: '#a0b4cc' },
              ].map(({ label, value, color }) => (
                <div key={label} className="card" style={{textAlign:'center',padding:'0.75rem',margin:0}}>
                  <div style={{fontSize:'1.4rem',fontWeight:700,color,fontVariantNumeric:'tabular-nums'}}>{value}</div>
                  <div style={{fontSize:'0.75rem',color:'var(--muted)',marginTop:'0.25rem'}}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Two-column layout: Radar + LC health */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem'}}>
            {/* Instrument Health Fingerprint */}
            <div className="card" style={{margin:0}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem'}}>
                <h3 style={{margin:0}}>Instrument Health Fingerprint</h3>
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
              <h3 style={{marginBottom:'0.5rem'}}>LC System Breakdown</h3>
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
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3 style={{marginBottom:'0.25rem'}}>QC Control Charts (Levey-Jennings)</h3>
            <p style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.75rem'}}>
              Green band = ±1σ, yellow = ±2σ, red = ±3σ from your long-run mean.
              Points outside ±2σ (yellow/red) warrant investigation.
            </p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.75rem'}}>
              {HEALTH_METRICS.map((m, i) => {
                const ljRef = { current: null };
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

          {/* Understanding the Metrics — expandable accordion */}
          <div className="card">
            <h3 style={{marginBottom:'0.75rem'}}>Understanding the Metrics</h3>
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

    /* ── Landscape Viewer Tab ─────────────────────────────────────────── */

    function LandscapeViewerTab() {
      const { data: allRuns } = useFetch('/api/runs?limit=300');

      // ── State ─────────────────────────────────────────────────────────
      const [selA, setSelA] = useState('');
      const [selB, setSelB] = useState('');
      const [selC, setSelC] = useState('');
      const [rtLo, setRtLo] = useState(0);
      const [rtHi, setRtHi] = useState(999);
      const [mzLo, setMzLo] = useState(300);
      const [mzHi, setMzHi] = useState(1500);
      const [viewMode, setViewMode] = useState('landscape'); // landscape | diff | overlay
      const [res, setRes]     = useState('med');             // fast | med | hi
      const [syncCam, setSyncCam]   = useState(true);
      const [smooth, setSmooth]     = useState(true);
      const [loading, setLoading]   = useState({A:false,B:false,C:false});
      const [stats, setStats]       = useState({A:'',B:'',C:'',diff:''});
      const [inspData, setInspData] = useState(null); // {mz,k0,vals}

      // Cached ion data and grids (useRef so changes don't trigger re-render)
      const ionsRef  = useRef({A:null,B:null,C:null});
      const gridsRef = useRef({A:null,B:null,C:null});
      const cameraRef = useRef(null);
      const syncingRef = useRef(false);

      const plotARef = useRef(null);
      const plotBRef = useRef(null);
      const plotCRef = useRef(null);
      const plotDRef = useRef(null); // diff

      const K0_LO = 0.48, K0_HI = 1.82;
      const RES_MAP = { fast:[80,50], med:[130,80], hi:[220,130] };

      const COLOR_SCALES = {
        A: [[0,'#0d1117'],[0.15,'#1c4e80'],[0.45,'#1f6feb'],[0.75,'#58a6ff'],[1,'#cae8ff']],
        B: [[0,'#0d1117'],[0.15,'#5a1e0f'],[0.45,'#b03a2e'],[0.75,'#f78166'],[1,'#ffd3cc']],
        C: [[0,'#0d1117'],[0.15,'#0f3322'],[0.45,'#1a7f37'],[0.75,'#3fb950'],[1,'#ceefce']],
        diff: [[0,'#f78166'],[0.35,'#8b1a0e'],[0.5,'#161b22'],[0.65,'#0a2e6e'],[1,'#58a6ff']],
      };
      const COLORS = {A:'#58a6ff', B:'#f78166', C:'#3fb950'};

      // ── Helpers ───────────────────────────────────────────────────────
      function linspace(lo, hi, n) {
        return Array.from({length:n}, (_,i) => lo + (hi - lo) * i / (n - 1));
      }

      function buildGrid(ions, rtLoMin, rtHiMin, mzLo, mzHi, W, H) {
        const rtLo = rtLoMin * 60, rtHi = rtHiMin * 60;
        const mzStep = (mzHi - mzLo) / W;
        const k0Step = (K0_HI - K0_LO) / H;
        const flat = new Float64Array(W * H);
        let kept = 0;
        for (let i = 0; i < ions.mz.length; i++) {
          if (ions.rt[i] < rtLo || ions.rt[i] > rtHi) continue;
          if (ions.mz[i] < mzLo || ions.mz[i] > mzHi) continue;
          if (ions.mobility[i] < K0_LO || ions.mobility[i] > K0_HI) continue;
          const xi = Math.min(W-1, Math.floor((ions.mz[i] - mzLo) / mzStep));
          const yi = Math.min(H-1, Math.floor((ions.mobility[i] - K0_LO) / k0Step));
          flat[yi * W + xi] += ions.log_int[i];
          kept++;
        }
        const grid = [];
        for (let y = 0; y < H; y++) {
          const row = Array(W);
          for (let x = 0; x < W; x++) row[x] = flat[y * W + x];
          grid.push(row);
        }
        return { grid, kept };
      }

      function gaussBlur(grid, H, W) {
        const K = [1,2,1,2,4,2,1,2,1];
        let g = grid;
        for (let p = 0; p < 2; p++) {
          const out = Array.from({length:H}, () => Array(W).fill(0));
          for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
              let s = 0;
              for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                  s += g[Math.max(0,Math.min(H-1,y+dy))][Math.max(0,Math.min(W-1,x+dx))]
                       * K[(dy+1)*3+(dx+1)];
                }
              out[y][x] = s / 16;
            }
          g = out;
        }
        return g;
      }

      function makeSurfaceLayout(title, mzLo, mzHi, cam) {
        return {
          paper_bgcolor:'#161b22', plot_bgcolor:'#161b22',
          margin:{l:0,r:0,t:24,b:0},
          title:{text:title,font:{size:10,color:'#8b949e'},x:0.5},
          scene:{
            bgcolor:'#0d1117',
            xaxis:{title:{text:'m/z',font:{size:9,color:'#8b949e'}},tickfont:{size:8,color:'#8b949e'},gridcolor:'#21262d',range:[mzLo,mzHi]},
            yaxis:{title:{text:'1/K₀',font:{size:9,color:'#8b949e'}},tickfont:{size:8,color:'#8b949e'},gridcolor:'#21262d',range:[K0_LO,K0_HI]},
            zaxis:{title:{text:'',font:{size:9}},tickfont:{size:8,color:'#8b949e'},showticklabels:false,gridcolor:'#21262d'},
            camera: cam || {eye:{x:1.6,y:-1.6,z:0.9}},
            aspectmode:'manual', aspectratio:{x:2.0,y:1.2,z:0.65},
          },
          modebar:{bgcolor:'transparent',color:'#8b949e',activecolor:'#58a6ff'},
        };
      }

      function renderSurface(el, grid, W, H, cs, title) {
        if (!el || !window.Plotly) return;
        const mzV = linspace(mzLo, mzHi, W);
        const k0V = linspace(K0_LO, K0_HI, H);
        window.Plotly.react(el, [{
          type:'surface', x:mzV, y:k0V, z:grid, colorscale:cs,
          showscale:false, opacity:0.95,
          contours:{z:{show:true,usecolormap:true,project:{z:true}}},
          hovertemplate:'m/z: %{x:.1f}<br>1/K₀: %{y:.3f}<br>Intensity: %{z:.1f}<extra></extra>',
          lighting:{ambient:0.65,diffuse:0.4,specular:0.05,roughness:0.9},
        }], makeSurfaceLayout(title, mzLo, mzHi, cameraRef.current),
        {displaylogo:false, responsive:true, modeBarButtonsToRemove:['toImage']});
      }

      function renderOverlaySurface(el) {
        if (!el || !window.Plotly) return;
        const [W, H] = RES_MAP[res];
        const mzV = linspace(mzLo, mzHi, W);
        const k0V = linspace(K0_LO, K0_HI, H);
        const traces = ['A','B','C'].filter(k => gridsRef.current[k]).map(k => ({
          type:'surface', x:mzV, y:k0V, z:gridsRef.current[k],
          colorscale:COLOR_SCALES[k], showscale:false, opacity:0.7,
          contours:{z:{show:false}},
          hovertemplate:`${k} m/z:%{x:.1f} 1/K₀:%{y:.3f}<extra></extra>`,
          lighting:{ambient:0.7,diffuse:0.3},
        }));
        window.Plotly.react(el, traces,
          makeSurfaceLayout('Overlay · A + B + C', mzLo, mzHi, cameraRef.current),
          {displaylogo:false, responsive:true});
      }

      function renderDiffSurface(el) {
        if (!el || !window.Plotly) return;
        const gA = gridsRef.current.A, gB = gridsRef.current.B;
        if (!gA || !gB) return;
        const [W, H] = RES_MAP[res];
        let maxA = 0, maxB = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (gA[y][x] > maxA) maxA = gA[y][x];
          if (gB[y][x] > maxB) maxB = gB[y][x];
        }
        const sA = maxA > 0 ? 1/maxA : 1, sB = maxB > 0 ? 1/maxB : 1;
        const diff = gA.map((row, y) => row.map((v, x) => v*sA - gB[y][x]*sB));
        let absMax = 0;
        diff.forEach(row => row.forEach(v => { if (Math.abs(v) > absMax) absMax = Math.abs(v); }));
        // Pearson similarity
        const aN = gA.flat().map(v => v*sA), bN = gB.flat().map(v => v*sB);
        const n = aN.length;
        const mA = aN.reduce((s,v)=>s+v,0)/n, mB = bN.reduce((s,v)=>s+v,0)/n;
        let cov=0,sAv=0,sBv=0;
        for (let i=0;i<n;i++){const da=aN[i]-mA,db=bN[i]-mB;cov+=da*db;sAv+=da*da;sBv+=db*db;}
        const r = (sAv>0&&sBv>0) ? cov/Math.sqrt(sAv*sBv) : 0;
        setStats(s => ({...s, diff:`Similarity: ${(r*100).toFixed(1)}%`}));
        const mzV = linspace(mzLo, mzHi, W);
        const k0V = linspace(K0_LO, K0_HI, H);
        window.Plotly.react(el, [{
          type:'surface', x:mzV, y:k0V, z:diff,
          colorscale:COLOR_SCALES.diff, showscale:true,
          cmin:-absMax, cmax:absMax,
          colorbar:{thickness:8,len:0.5,x:1.01,tickfont:{size:8,color:'#8b949e'},
            title:{text:'A−B',font:{size:9,color:'#8b949e'},side:'right'}},
          contours:{z:{show:true,usecolormap:true,project:{z:true}}},
          hovertemplate:'m/z:%{x:.1f}<br>1/K₀:%{y:.3f}<br>A−B:%{z:.3f}<extra></extra>',
          lighting:{ambient:0.6,diffuse:0.4},
        }], makeSurfaceLayout('Differential · A − B', mzLo, mzHi, cameraRef.current),
        {displaylogo:false, responsive:true});
      }

      // ── Camera sync ───────────────────────────────────────────────────
      function attachSync(el, others) {
        if (!el || !el.on) return;
        el.on('plotly_relayout', ev => {
          if (!syncCam || syncingRef.current) return;
          const cam = ev['scene.camera'];
          if (!cam) return;
          syncingRef.current = true;
          cameraRef.current = cam;
          others.forEach(o => {
            if (o && o._fullLayout)
              window.Plotly.relayout(o, {'scene.camera': cam}).catch(()=>{});
          });
          syncingRef.current = false;
        });
      }

      // ── Click inspector ───────────────────────────────────────────────
      function attachClick(el) {
        if (!el || !el.on) return;
        el.on('plotly_click', data => {
          if (!data.points?.length) return;
          const {x: mz, y: k0} = data.points[0];
          const [W, H] = RES_MAP[res];
          const mzStep = (mzHi - mzLo) / W;
          const k0Step = (K0_HI - K0_LO) / H;
          const xi = Math.max(0, Math.min(W-1, Math.floor((mz - mzLo) / mzStep)));
          const yi = Math.max(0, Math.min(H-1, Math.floor((k0 - K0_LO) / k0Step)));
          const vals = {};
          ['A','B','C'].forEach(k => {
            if (gridsRef.current[k]) vals[k] = gridsRef.current[k][yi][xi];
          });
          setInspData({mz, k0, vals});
        });
      }

      // ── Fetch ions for a key ──────────────────────────────────────────
      async function fetchKey(key, runId) {
        setLoading(l => ({...l, [key]:true}));
        try {
          const res = await fetch(`/api/runs/${runId}/mobility-3d?max_features=5000`);
          const data = await res.json();
          data._runId = runId;
          ionsRef.current[key] = data;
        } catch(e) {
          ionsRef.current[key] = null;
        }
        setLoading(l => ({...l, [key]:false}));
      }

      // ── Main render action ────────────────────────────────────────────
      async function doRender() {
        const ids = {A: selA, B: selB, C: selC};
        if (!ids.A) return;
        const [W, H] = RES_MAP[res];

        // Fetch any missing/changed ion data
        const fetches = [];
        ['A','B','C'].forEach(k => {
          const id = ids[k];
          if (!id) { ionsRef.current[k] = null; gridsRef.current[k] = null; return; }
          if (!ionsRef.current[k] || ionsRef.current[k]._runId !== id)
            fetches.push(fetchKey(k, id));
        });
        if (fetches.length) await Promise.all(fetches);

        // Build grids
        ['A','B','C'].forEach(k => {
          const ions = ionsRef.current[k];
          if (!ions?.mz) { gridsRef.current[k] = null; return; }
          const { grid, kept } = buildGrid(ions, rtLo, rtHi, mzLo, mzHi, W, H);
          gridsRef.current[k] = smooth ? gaussBlur(grid, H, W) : grid;
          setStats(s => ({...s, [k]: `${kept.toLocaleString()} ions`}));
        });

        // Render surfaces
        if (viewMode === 'overlay') {
          renderOverlaySurface(plotARef.current);
        } else {
          const runName = k => {
            const sel = allRuns?.find(r => String(r.id) === ids[k]);
            return sel?.run_name || `Run ${k}`;
          };
          if (gridsRef.current.A) renderSurface(plotARef.current, gridsRef.current.A, W, H, COLOR_SCALES.A, runName('A'));
          if (gridsRef.current.B) renderSurface(plotBRef.current, gridsRef.current.B, W, H, COLOR_SCALES.B, runName('B'));
          if (gridsRef.current.C) renderSurface(plotCRef.current, gridsRef.current.C, W, H, COLOR_SCALES.C, runName('C'));
          if (viewMode === 'diff') renderDiffSurface(plotDRef.current);
        }

        // Wire up sync + click after Plotly settles
        setTimeout(() => {
          const els = [plotARef.current, plotBRef.current, plotCRef.current, plotDRef.current];
          els.forEach((el, i) => {
            const others = els.filter((_, j) => j !== i);
            attachSync(el, others);
            attachClick(el);
          });
        }, 600);
      }

      // ── Derived visibility ────────────────────────────────────────────
      const showB    = !!selB && viewMode !== 'overlay';
      const showC    = !!selC && viewMode === 'landscape';
      const showDiff = viewMode === 'diff' && !!selB;

      // ── Shared input style ────────────────────────────────────────────
      const inpSt = {
        background:'var(--bg)', color:'var(--text)',
        border:'1px solid var(--border)', borderRadius:'0.3rem',
        padding:'0.3rem 0.5rem', fontSize:'0.8rem', width:'72px',
      };
      const selSt = {
        background:'var(--bg)', color:'var(--text)',
        border:'1px solid var(--border)', borderRadius:'0.35rem',
        padding:'0.3rem 0.6rem', fontSize:'0.8rem', minWidth:'220px',
      };
      const btnSt = (active) => ({
        padding:'0.3rem 0.75rem', borderRadius:'0.3rem', cursor:'pointer',
        fontSize:'0.78rem', fontWeight: active ? 700 : 400,
        background: active ? '#1f6feb33' : 'transparent',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        color: active ? 'var(--accent)' : 'var(--muted)',
      });

      const runs = Array.isArray(allRuns) ? allRuns : [];
      const runOpts = runs.map(r =>
        <option key={r.id} value={r.id}>{r.run_name} — {r.instrument}</option>
      );

      // ── Plot area layout ──────────────────────────────────────────────
      const nVisible = (viewMode === 'overlay' ? 1 : [selA, selB, selC].filter(Boolean).length)
                     + (showDiff ? 1 : 0);
      const plotH = '440px';

      return (
        <div style={{padding:'0.5rem'}}>

          {/* ── Controls card ── */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem 1rem'}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:'1rem',alignItems:'flex-end'}}>

              {/* Run selectors */}
              {[['A','#58a6ff',selA,setSelA],['B','#f78166',selB,setSelB],['C','#3fb950',selC,setSelC]].map(([k,col,val,set]) => (
                <div key={k} style={{display:'flex',flexDirection:'column',gap:'3px',borderLeft:`3px solid ${col}`,paddingLeft:'8px'}}>
                  <div style={{fontSize:'0.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>
                    Run {k}{k==='A'?' (required)':' (optional)'}
                  </div>
                  <select value={val} onChange={e => { set(e.target.value); gridsRef.current[k]=null; ionsRef.current[k]=null; }}
                    style={selSt}>
                    <option value="">{k==='A'?'— select run —':'— none —'}</option>
                    {runOpts}
                  </select>
                </div>
              ))}

              <div style={{width:'1px',height:'36px',background:'var(--border)'}} />

              {/* RT window */}
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>RT window (min)</div>
                <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                  <input type="number" value={rtLo} onChange={e=>setRtLo(+e.target.value)} style={inpSt} placeholder="0" />
                  <span style={{color:'var(--muted)'}}>–</span>
                  <input type="number" value={rtHi} onChange={e=>setRtHi(+e.target.value)} style={inpSt} placeholder="999" />
                  <button onClick={()=>{setRtLo(0);setRtHi(999);}} style={{...btnSt(false),padding:'0.3rem 0.5rem',fontSize:'0.72rem'}}>All</button>
                </div>
              </div>

              {/* m/z range */}
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>m/z range</div>
                <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                  <input type="number" value={mzLo} onChange={e=>setMzLo(+e.target.value)} style={inpSt} />
                  <span style={{color:'var(--muted)'}}>–</span>
                  <input type="number" value={mzHi} onChange={e=>setMzHi(+e.target.value)} style={inpSt} />
                  <button onClick={()=>{setMzLo(300);setMzHi(1500);}} style={{...btnSt(false),padding:'0.3rem 0.5rem',fontSize:'0.72rem'}}>Full</button>
                </div>
              </div>

              <div style={{width:'1px',height:'36px',background:'var(--border)'}} />

              {/* View mode */}
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>View</div>
                <div style={{display:'flex',gap:'4px'}}>
                  {[['landscape','Side by side'],['diff','A − B diff'],['overlay','Overlay']].map(([m,label]) => (
                    <button key={m} onClick={()=>setViewMode(m)} style={btnSt(viewMode===m)}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Resolution */}
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>Resolution</div>
                <div style={{display:'flex',gap:'4px'}}>
                  {[['fast','Fast'],['med','Med'],['hi','Hi']].map(([r,label]) => (
                    <button key={r} onClick={()=>{setRes(r);gridsRef.current={A:null,B:null,C:null};}} style={btnSt(res===r)}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>Options</div>
                <label style={{display:'flex',gap:'5px',alignItems:'center',cursor:'pointer',fontSize:'0.8rem'}}>
                  <input type="checkbox" checked={syncCam} onChange={e=>setSyncCam(e.target.checked)} />
                  Link cameras
                </label>
                <label style={{display:'flex',gap:'5px',alignItems:'center',cursor:'pointer',fontSize:'0.8rem'}}>
                  <input type="checkbox" checked={smooth} onChange={e=>{setSmooth(e.target.checked);gridsRef.current={A:null,B:null,C:null};}} />
                  Smooth
                </label>
              </div>

              {/* Render button */}
              <button
                onClick={doRender}
                disabled={!selA}
                style={{padding:'0.45rem 1.25rem',background:'#1f6feb',border:'1px solid #388bfd',color:'#fff',
                        borderRadius:'0.4rem',cursor: selA ? 'pointer' : 'not-allowed',
                        fontWeight:700,fontSize:'0.85rem',alignSelf:'flex-end',
                        opacity: selA ? 1 : 0.5}}>
                Render
              </button>
            </div>

            {/* Status row */}
            {Object.values(loading).some(Boolean) && (
              <div style={{marginTop:'0.5rem',fontSize:'0.78rem',color:'#f0883e'}}>
                Loading ion data…
              </div>
            )}
          </div>

          {/* ── Plot grid ── */}
          <div style={{display:'grid', gridTemplateColumns:`repeat(${Math.min(nVisible,3)},1fr)`, gap:'0.5rem'}}>

            {/* Run A */}
            {selA && (
              <div className="card" style={{padding:'0',overflow:'hidden'}}>
                <div style={{padding:'0.4rem 0.75rem',borderBottom:'1px solid var(--border)',
                             display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontWeight:600,fontSize:'0.8rem',display:'flex',alignItems:'center',gap:'6px'}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:'#58a6ff',display:'inline-block'}} />
                    Run A
                  </span>
                  <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>{stats.A}</span>
                </div>
                <div ref={plotARef} style={{height:plotH}} />
              </div>
            )}

            {/* Run B */}
            {showB && selB && (
              <div className="card" style={{padding:'0',overflow:'hidden'}}>
                <div style={{padding:'0.4rem 0.75rem',borderBottom:'1px solid var(--border)',
                             display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontWeight:600,fontSize:'0.8rem',display:'flex',alignItems:'center',gap:'6px'}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:'#f78166',display:'inline-block'}} />
                    Run B
                  </span>
                  <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>{stats.B}</span>
                </div>
                <div ref={plotBRef} style={{height:plotH}} />
              </div>
            )}

            {/* Run C */}
            {showC && selC && (
              <div className="card" style={{padding:'0',overflow:'hidden'}}>
                <div style={{padding:'0.4rem 0.75rem',borderBottom:'1px solid var(--border)',
                             display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontWeight:600,fontSize:'0.8rem',display:'flex',alignItems:'center',gap:'6px'}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:'#3fb950',display:'inline-block'}} />
                    Run C
                  </span>
                  <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>{stats.C}</span>
                </div>
                <div ref={plotCRef} style={{height:plotH}} />
              </div>
            )}

            {/* Differential */}
            {showDiff && (
              <div className="card" style={{padding:'0',overflow:'hidden'}}>
                <div style={{padding:'0.4rem 0.75rem',borderBottom:'1px solid var(--border)',
                             display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontWeight:600,fontSize:'0.8rem',color:'var(--muted)'}}>Differential · A − B</span>
                  <span style={{fontSize:'0.72rem',color:'var(--accent)'}}>{stats.diff}</span>
                </div>
                <div ref={plotDRef} style={{height:plotH}} />
              </div>
            )}
          </div>

          {/* ── Inspector ── */}
          {inspData && (
            <div className="card" style={{marginTop:'0.75rem',padding:'0.75rem 1rem'}}>
              <div style={{display:'flex',gap:'2rem',alignItems:'flex-start',flexWrap:'wrap'}}>
                <div>
                  <div style={{fontWeight:600,fontSize:'0.82rem',marginBottom:'0.4rem',color:'var(--accent)'}}>Peak Inspector</div>
                  <div style={{display:'flex',gap:'1.5rem',fontSize:'0.82rem'}}>
                    <div><span style={{color:'var(--muted)'}}>m/z </span><strong>{inspData.mz.toFixed(2)}</strong></div>
                    <div><span style={{color:'var(--muted)'}}>1/K₀ </span><strong>{inspData.k0.toFixed(4)}</strong></div>
                  </div>
                </div>
                <div style={{display:'flex',gap:'1.25rem',flexWrap:'wrap'}}>
                  {Object.entries(inspData.vals).map(([k,v]) => {
                    const maxV = Math.max(...Object.values(inspData.vals));
                    const pct = maxV > 0 ? (v / maxV) * 100 : 0;
                    return (
                      <div key={k} style={{display:'flex',flexDirection:'column',gap:'3px',minWidth:'120px'}}>
                        <div style={{fontSize:'0.72rem',color:COLORS[k],fontWeight:700}}>Run {k}</div>
                        <div style={{height:'6px',background:'var(--border)',borderRadius:'3px',overflow:'hidden'}}>
                          <div style={{width:`${pct.toFixed(1)}%`,height:'100%',background:COLORS[k],borderRadius:'3px'}} />
                        </div>
                        <div style={{fontSize:'0.72rem',color:'var(--muted)'}}>{v.toFixed(1)}</div>
                      </div>
                    );
                  })}
                  {inspData.vals.A !== undefined && inspData.vals.B !== undefined && inspData.vals.B > 0 && (
                    <div style={{display:'flex',flexDirection:'column',gap:'3px',justifyContent:'flex-end'}}>
                      <div style={{fontSize:'0.72rem',color:'var(--muted)'}}>A/B ratio</div>
                      <div style={{fontSize:'1rem',fontWeight:700,
                                   color: inspData.vals.A/inspData.vals.B > 1.2 ? 'var(--accent)' :
                                          inspData.vals.A/inspData.vals.B < 0.8 ? '#f78166' : 'var(--text)'}}>
                        {(inspData.vals.A/inspData.vals.B).toFixed(2)}×
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={()=>setInspData(null)}
                  style={{marginLeft:'auto',background:'transparent',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:'1rem'}}>
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* ── Empty state ── */}
          {!selA && (
            <div className="card" style={{textAlign:'center',padding:'5rem 2rem',color:'var(--muted)'}}>
              <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.35}}>⬡</div>
              <div style={{fontSize:'1rem',fontWeight:600,marginBottom:'0.4rem',color:'var(--text)'}}>
                4D Ion Mobility Landscape Viewer
              </div>
              <div style={{fontSize:'0.85rem',maxWidth:'480px',margin:'0 auto',lineHeight:1.6}}>
                Select two or three timsTOF runs to compare their ion mobility landscapes as
                rotatable 3D surfaces — inspired by Melanie 2D gel comparison software.
                <br/><br/>
                <span style={{color:'var(--accent)'}}>m/z × 1/K₀ × Intensity</span> &nbsp;·&nbsp; linked camera sync &nbsp;·&nbsp; differential view &nbsp;·&nbsp; click-to-compare
              </div>
            </div>
          )}

        </div>
      );
    }

    /* ── Sneaky Peaky Tab ─────────────────────────────────────────────── */

    function SneakyPeakyTab() {
      const { data: allRuns } = useFetch('/api/runs?limit=300');

      // ── State ──────────────────────────────────────────────────────────
      const [selA, setSelA]   = useState('');
      const [selB, setSelB]   = useState('');
      const [selC, setSelC]   = useState('');
      const [mzTarget, setMzTarget] = useState('');
      const [mzTolPpm, setMzTolPpm] = useState(10);
      const [busy, setBusy]   = useState(false);
      const [runData, setRunData]   = useState({A:null,B:null,C:null});  // run metadata
      const [ions,    setIons]      = useState({A:null,B:null,C:null});  // ion cloud
      const [diffResult, setDiffResult] = useState(null);  // computed diff
      const [mzResult,   setMzResult]   = useState(null);  // m/z target hit
      const [sortCol,    setSortCol]    = useState('type');
      const [sortDir,    setSortDir]    = useState(1);
      const diffScatterRef = useRef(null);
      const intensCorRef   = useRef(null);

      const COLORS  = {A:'#58a6ff', B:'#f78166', C:'#3fb950'};
      const DIFF_COLORS = {
        'Only in A':   '#58a6ff',
        'Only in B':   '#f78166',
        'Only in C':   '#3fb950',
        'Higher in A': '#93c5fd',
        'Higher in B': '#fca5a5',
        'RT shifted':  '#fde68a',
        'IM shifted':  '#c4b5fd',
        'Similar':     '#374151',
      };

      const runs   = Array.isArray(allRuns) ? allRuns : [];
      const selMap = {A: selA, B: selB, C: selC};

      // ── Ion matching (spatial hash on m/z) ────────────────────────────
      function matchIons(ionsA, ionsB, ppmTol = 10, imTol = 0.025, rtTolMin = 1.0) {
        const BIN = 0.015;   // ~10ppm at 1500 Da
        const buildHash = (ions) => {
          const h = {};
          for (let i = 0; i < ions.mz.length; i++) {
            const b = Math.floor(ions.mz[i] / BIN);
            (h[b] = h[b] || []).push(i);
          }
          return h;
        };
        const hashB = buildHash(ionsB);
        const onlyA=[], onlyB=[], shared=[];
        const matchedB = new Uint8Array(ionsB.mz.length);

        for (let i = 0; i < ionsA.mz.length; i++) {
          const mz = ionsA.mz[i];
          const bC = Math.floor(mz / BIN);
          let bestJ = -1, bestDmz = Infinity;
          for (const b of [bC-1, bC, bC+1]) {
            const bucket = hashB[b]; if (!bucket) continue;
            for (const j of bucket) {
              const dmzPpm = Math.abs(ionsB.mz[j] - mz) / mz * 1e6;
              if (dmzPpm < ppmTol && dmzPpm < bestDmz) {
                bestDmz = dmzPpm; bestJ = j;
              }
            }
          }
          if (bestJ >= 0) {
            matchedB[bestJ] = 1;
            const rtDiff  = Math.abs(ionsA.rt[i]/60 - ionsB.rt[bestJ]/60);
            const imDiff  = Math.abs(ionsA.mobility[i] - ionsB.mobility[bestJ]);
            const logRatio = ionsA.log_int[i] - ionsB.log_int[bestJ];
            let type = 'Similar';
            if (Math.abs(logRatio) > 0.7) type = logRatio > 0 ? 'Higher in A' : 'Higher in B';
            if (rtDiff > rtTolMin) type = 'RT shifted';
            if (imDiff > imTol)    type = 'IM shifted';
            shared.push({
              mz, k0: ionsA.mobility[i], rt: ionsA.rt[i]/60,
              logIntA: ionsA.log_int[i], logIntB: ionsB.log_int[bestJ],
              rtA: ionsA.rt[i]/60, rtB: ionsB.rt[bestJ]/60,
              k0A: ionsA.mobility[i], k0B: ionsB.mobility[bestJ],
              logRatio, rtDiff, imDiff, charge: ionsA.charge[i], type,
            });
          } else {
            onlyA.push({
              mz, k0: ionsA.mobility[i], rt: ionsA.rt[i]/60,
              logInt: ionsA.log_int[i], charge: ionsA.charge[i], type:'Only in A',
            });
          }
        }
        for (let j = 0; j < ionsB.mz.length; j++) {
          if (!matchedB[j]) onlyB.push({
            mz: ionsB.mz[j], k0: ionsB.mobility[j], rt: ionsB.rt[j]/60,
            logInt: ionsB.log_int[j], charge: ionsB.charge[j], type:'Only in B',
          });
        }
        return { onlyA, onlyB, shared };
      }

      // ── m/z target search ─────────────────────────────────────────────
      function searchMz(mzVal, ppm) {
        const tol = mzVal * ppm / 1e6;
        const result = {};
        ['A','B','C'].forEach(k => {
          const ion = ions[k];
          if (!ion) return;
          const hits = [];
          for (let i = 0; i < ion.mz.length; i++) {
            if (Math.abs(ion.mz[i] - mzVal) <= tol)
              hits.push({ mz:ion.mz[i], rt:ion.rt[i]/60, k0:ion.mobility[i],
                          logInt:ion.log_int[i], charge:ion.charge[i] });
          }
          hits.sort((a,b) => b.logInt - a.logInt);
          result[k] = hits.slice(0, 10);
        });
        return result;
      }

      // ── Main compare action ───────────────────────────────────────────
      async function doCompare() {
        if (!selA || !selB) return;
        setBusy(true); setDiffResult(null); setMzResult(null);

        // Fetch run metadata
        const rdNew = {A:null,B:null,C:null};
        await Promise.all(['A','B','C'].map(async k => {
          const id = selMap[k];
          if (!id) return;
          try {
            const r = await fetch(`/api/runs/${id}`);
            rdNew[k] = await r.json();
          } catch(e) {}
        }));
        setRunData(rdNew);

        // Fetch ion clouds
        const ionNew = {...ions};
        await Promise.all(['A','B','C'].map(async k => {
          const id = selMap[k];
          if (!id) { ionNew[k] = null; return; }
          if (ionNew[k]?._runId === id) return;  // cached
          try {
            const r = await fetch(`/api/runs/${id}/mobility-3d?max_features=5000`);
            const d = await r.json();
            d._runId = id; ionNew[k] = d;
          } catch(e) { ionNew[k] = null; }
        }));
        setIons(ionNew);

        // Compute diff — charts rendered via useEffect watching diffResult
        if (ionNew.A && ionNew.B) {
          setDiffResult(matchIons(ionNew.A, ionNew.B));
        }

        // m/z search if target set
        if (mzTarget) {
          const mz = parseFloat(mzTarget);
          if (!isNaN(mz)) setMzResult(searchMz(mz, mzTolPpm));
        }
        setBusy(false);
      }

      // ── Run m/z search live (doesn't re-fetch) ────────────────────────
      function doMzSearch() {
        const mz = parseFloat(mzTarget);
        if (isNaN(mz) || !ions.A) return;
        setMzResult(searchMz(mz, mzTolPpm));
      }

      // ── Diff scatter + intensity correlation — rendered via useEffect ──
      useEffect(() => {
        if (!diffResult) return;
        const el = diffScatterRef.current;
        if (!el || !window.Plotly) return;
        const cats = ['Only in A','Only in B','Higher in A','Higher in B','RT shifted','IM shifted','Similar'];
        const traces = cats.map(cat => {
          const pts = cat === 'Only in A' ? diffResult.onlyA
                    : cat === 'Only in B' ? diffResult.onlyB
                    : diffResult.shared.filter(p => p.type === cat);
          return {
            type:'scatter', mode:'markers', name:cat,
            x: pts.map(p => p.mz),
            y: pts.map(p => p.k0),
            marker:{
              size: cat === 'Similar' ? 2 : 4,
              color: DIFF_COLORS[cat],
              opacity: cat === 'Similar' ? 0.25 : 0.85,
              line:{width:0},
            },
            hovertemplate: `${cat}<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra></extra>`,
            visible: cat === 'Similar' ? 'legendonly' : true,
          };
        });
        window.Plotly.react(el, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.5)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
        }, {responsive:true, displayModeBar:false});
      }, [diffResult]);

      useEffect(() => {
        if (!diffResult) return;
        const el = intensCorRef.current;
        if (!el || !window.Plotly) return;
        const pts = diffResult.shared.filter(p => p.type !== 'Similar' || Math.random() < 0.3);
        if (pts.length === 0) return;
        const CHARGE_COL = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
        const xs = pts.map(p => p.logIntB);
        const diag = [Math.min(...xs), Math.max(...xs)];
        window.Plotly.react(el, [
          { type:'scatter', mode:'lines', x:diag, y:diag, line:{color:'#374151',dash:'dot',width:1},
            showlegend:false, hoverinfo:'skip' },
          { type:'scatter', mode:'markers', name:'Shared ions',
            x: xs, y: pts.map(p => p.logIntA),
            marker:{size:3, color:pts.map(p=>CHARGE_COL[p.charge]||'#94a3b8'), opacity:0.7, line:{width:0}},
            hovertemplate:'m/z %{customdata:.3f}<br>A log(I): %{y:.2f}<br>B log(I): %{x:.2f}<extra></extra>',
            customdata: pts.map(p => p.mz),
          },
        ], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:50},
          xaxis:{title:{text:'Run B log(Intensity)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'Run A log(Intensity)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
        }, {responsive:true, displayModeBar:false});
      }, [diffResult]);

      // ── QC metric cards ───────────────────────────────────────────────
      const METRIC_DEFS = [
        { key:'n_precursors',            label:'Precursors',        fmt: v => v?.toLocaleString(),           higher:'good' },
        { key:'n_peptides',              label:'Peptides',          fmt: v => v?.toLocaleString(),           higher:'good' },
        { key:'n_proteins',              label:'Proteins',          fmt: v => v?.toLocaleString(),           higher:'good' },
        { key:'median_cv_precursor',     label:'Median CV%',        fmt: v => v?.toFixed(1)+'%',             higher:'bad'  },
        { key:'missed_cleavage_rate',    label:'Missed Cleavage',   fmt: v => v?.toFixed(1)+'%',             higher:'bad'  },
        { key:'median_peak_width_sec',   label:'Peak Width (s)',    fmt: v => v?.toFixed(1),                 higher:'bad'  },
        { key:'median_points_across_peak', label:'Points/Peak',    fmt: v => v?.toFixed(1),                 higher:'good' },
        { key:'irt_max_deviation_min',   label:'iRT Deviation',     fmt: v => v != null ? v.toFixed(3)+'min' : null, higher:'bad' },
        { key:'pct_charge_1',            label:'%+1',               fmt: v => v?.toFixed(1)+'%',             higher:'neutral' },
        { key:'pct_charge_2',            label:'%+2',               fmt: v => v?.toFixed(1)+'%',             higher:'neutral' },
        { key:'gate_result',             label:'Gate',              fmt: v => v,                             higher:'neutral' },
      ];

      function deltaColor(delta, def) {
        if (def.higher === 'neutral' || delta === 0) return 'var(--muted)';
        const good = (def.higher === 'good' && delta > 0) || (def.higher === 'bad' && delta < 0);
        return good ? '#3fb950' : '#f78166';
      }

      function pctDelta(a, b) {
        if (a == null || b == null || b === 0) return null;
        return ((a - b) / Math.abs(b)) * 100;
      }

      // ── Sorted diff table rows ────────────────────────────────────────
      const tableRows = useMemo(() => {
        if (!diffResult) return [];
        const all = [
          ...diffResult.onlyA,
          ...diffResult.onlyB,
          ...diffResult.shared.filter(p => p.type !== 'Similar'),
        ];
        const col = sortCol;
        return [...all].sort((a,b) => {
          const av = a[col] ?? a.logInt ?? 0;
          const bv = b[col] ?? b.logInt ?? 0;
          return sortDir * (bv - av);
        }).slice(0, 200);
      }, [diffResult, sortCol, sortDir]);

      function toggleSort(col) {
        if (sortCol === col) setSortDir(d => -d);
        else { setSortCol(col); setSortDir(1); }
      }

      const thSt = (col) => ({
        padding:'0.3rem 0.5rem', textAlign:'left', cursor:'pointer',
        color: sortCol===col ? 'var(--accent)' : 'var(--muted)',
        fontSize:'0.72rem', fontWeight:600, whiteSpace:'nowrap',
        borderBottom:'1px solid var(--border)', userSelect:'none',
      });
      const tdSt = { padding:'0.25rem 0.5rem', fontSize:'0.78rem' };

      // ── Summary counts ────────────────────────────────────────────────
      const summary = useMemo(() => {
        if (!diffResult) return null;
        const { onlyA, onlyB, shared } = diffResult;
        return {
          onlyA: onlyA.length,
          onlyB: onlyB.length,
          shared: shared.length,
          higherA: shared.filter(p => p.type==='Higher in A').length,
          higherB: shared.filter(p => p.type==='Higher in B').length,
          rtShift: shared.filter(p => p.type==='RT shifted').length,
          imShift: shared.filter(p => p.type==='IM shifted').length,
          similar: shared.filter(p => p.type==='Similar').length,
        };
      }, [diffResult]);

      const inpSt = {
        background:'var(--bg)', color:'var(--text)',
        border:'1px solid var(--border)', borderRadius:'0.35rem',
        padding:'0.3rem 0.6rem', fontSize:'0.8rem',
      };
      const selSt = { ...inpSt, minWidth:'220px' };
      const btnPrimary = (disabled) => ({
        padding:'0.4rem 1.1rem', background: disabled ? '#1f2937':'#1f6feb',
        border:`1px solid ${disabled?'var(--border)':'#388bfd'}`,
        color: disabled ? 'var(--muted)':'#fff',
        borderRadius:'0.4rem', cursor: disabled?'not-allowed':'pointer',
        fontWeight:700, fontSize:'0.85rem', opacity: disabled?0.6:1,
      });

      const runOpts = runs.map(r =>
        <option key={r.id} value={r.id}>{r.run_name} — {r.instrument}</option>
      );

      return (
        <div style={{padding:'0.5rem'}}>

          {/* ── Header + selectors ── */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem 1rem'}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:'1rem',alignItems:'flex-end'}}>
              <div>
                <div style={{fontWeight:700,fontSize:'1rem',marginBottom:'0.2rem'}}>
                  🔍 Sneaky Peaky
                </div>
                <div style={{color:'var(--muted)',fontSize:'0.78rem'}}>
                  Compare runs · find exclusive, shifted and changed ions
                </div>
              </div>

              {[['A','#58a6ff',selA,setSelA],['B','#f78166',selB,setSelB],['C','#3fb950',selC,setSelC]].map(([k,col,val,set]) => (
                <div key={k} style={{display:'flex',flexDirection:'column',gap:'3px',borderLeft:`3px solid ${col}`,paddingLeft:'8px'}}>
                  <div style={{fontSize:'0.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>
                    Run {k}{k==='A'||k==='B'?' (required)':' (optional)'}
                  </div>
                  <select value={val} onChange={e=>{set(e.target.value);setDiffResult(null);setMzResult(null);}} style={selSt}>
                    <option value="">{k==='C'?'— none —':'— select —'}</option>
                    {runOpts}
                  </select>
                </div>
              ))}

              <button onClick={doCompare} disabled={!selA||!selB||busy}
                style={btnPrimary(!selA||!selB||busy)}>
                {busy ? 'Comparing…' : 'Compare'}
              </button>
            </div>
          </div>

          {/* ── Empty state ── */}
          {!selA && !selB && (
            <div className="card" style={{textAlign:'center',padding:'5rem 2rem',color:'var(--muted)'}}>
              <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.35}}>🔍</div>
              <div style={{fontSize:'1rem',fontWeight:600,marginBottom:'0.4rem',color:'var(--text)'}}>
                Select two runs to compare
              </div>
              <div style={{fontSize:'0.85rem',maxWidth:'500px',margin:'0 auto',lineHeight:1.6}}>
                Sneaky Peaky finds ions that are <strong style={{color:'#58a6ff'}}>exclusive to Run A</strong>,&nbsp;
                <strong style={{color:'#f78166'}}>exclusive to Run B</strong>, or <strong style={{color:'#fde68a'}}>shifted in RT / ion mobility</strong>
                between runs — plus a full QC metric comparison and m/z target finder.
              </div>
            </div>
          )}

          {/* ── QC Metric comparison ── */}
          {(runData.A || runData.B) && (
            <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem 1rem'}}>
              <h3 style={{marginBottom:'0.6rem'}}>QC Metrics Comparison</h3>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--border)'}}>
                      <th style={{...tdSt,color:'var(--muted)',fontWeight:600,textAlign:'left',width:'140px'}}>Metric</th>
                      {['A','B','C'].filter(k=>runData[k]).map(k => (
                        <th key={k} style={{...tdSt,color:COLORS[k],fontWeight:700,textAlign:'right'}}>
                          Run {k}<div style={{fontWeight:400,color:'var(--muted)',fontSize:'0.7rem',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {runData[k]?.run_name}
                          </div>
                        </th>
                      ))}
                      {runData.A && runData.B && (
                        <th style={{...tdSt,color:'var(--muted)',fontWeight:600,textAlign:'right'}}>A vs B Δ</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {METRIC_DEFS.map(def => {
                      const vals = {};
                      ['A','B','C'].forEach(k => { if(runData[k]) vals[k] = runData[k][def.key]; });
                      const anyVal = Object.values(vals).some(v => v != null);
                      if (!anyVal) return null;
                      const delta = pctDelta(vals.A, vals.B);
                      return (
                        <tr key={def.key} style={{borderBottom:'1px solid rgba(30,58,95,0.4)'}}>
                          <td style={{...tdSt,color:'var(--muted)',fontWeight:500}}>{def.label}</td>
                          {['A','B','C'].filter(k=>runData[k]).map(k => (
                            <td key={k} style={{...tdSt,textAlign:'right',color:'var(--text)',fontWeight:600}}>
                              {vals[k] != null ? def.fmt(vals[k]) : <span style={{color:'var(--border)'}}>—</span>}
                            </td>
                          ))}
                          {runData.A && runData.B && (
                            <td style={{...tdSt,textAlign:'right',fontWeight:700,
                              color: delta != null ? deltaColor(delta, def) : 'var(--border)'}}>
                              {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Summary badges ── */}
          {summary && (
            <div className="card" style={{marginBottom:'0.75rem',padding:'0.65rem 1rem'}}>
              <h3 style={{marginBottom:'0.5rem'}}>Ion Cloud Summary — A vs B</h3>
              <div style={{display:'flex',flexWrap:'wrap',gap:'0.5rem'}}>
                {[
                  {label:'Only in A',  val:summary.onlyA,   col:'#58a6ff'},
                  {label:'Only in B',  val:summary.onlyB,   col:'#f78166'},
                  {label:'Shared',     val:summary.shared,  col:'#94a3b8'},
                  {label:'Higher in A',val:summary.higherA, col:'#93c5fd'},
                  {label:'Higher in B',val:summary.higherB, col:'#fca5a5'},
                  {label:'RT shifted', val:summary.rtShift, col:'#fde68a'},
                  {label:'IM shifted', val:summary.imShift, col:'#c4b5fd'},
                  {label:'Similar',    val:summary.similar, col:'#374151'},
                ].map(({label,val,col}) => (
                  <div key={label} style={{
                    padding:'0.35rem 0.75rem', borderRadius:'0.4rem',
                    background:`${col}22`, border:`1px solid ${col}55`,
                    display:'flex',flexDirection:'column',alignItems:'center',minWidth:'80px',
                  }}>
                    <span style={{fontSize:'1.1rem',fontWeight:700,color:col}}>{val.toLocaleString()}</span>
                    <span style={{fontSize:'0.68rem',color:'var(--muted)',textAlign:'center',lineHeight:1.2}}>{label}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:'0.5rem',fontSize:'0.75rem',color:'var(--muted)'}}>
                Matching: ±{mzTolPpm}ppm m/z · ±0.025 1/K₀ · ±1.0 min RT &nbsp;·&nbsp;
                Intensity ratio &gt;2× = enriched · RT diff &gt;1min = shifted · IM diff &gt;0.025 = shifted
              </div>
            </div>
          )}

          {/* ── Diff scatter + intensity correlation ── */}
          {diffResult && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem',marginBottom:'0.75rem'}}>
              <div className="card" style={{padding:'0.75rem'}}>
                <h3 style={{marginBottom:'0.4rem'}}>Ion Positions — A vs B</h3>
                <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.4rem'}}>
                  m/z × 1/K₀ · colour = ion category · "Similar" hidden by default
                </div>
                <div ref={diffScatterRef} style={{height:'340px'}} />
              </div>
              <div className="card" style={{padding:'0.75rem'}}>
                <h3 style={{marginBottom:'0.4rem'}}>Intensity Correlation — Shared Ions</h3>
                <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.4rem'}}>
                  log(Intensity) A vs B · above diagonal = higher in A · colour = charge
                </div>
                <div ref={intensCorRef} style={{height:'340px'}} />
              </div>
            </div>
          )}

          {/* ── m/z Target Finder ── */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem 1rem'}}>
            <h3 style={{marginBottom:'0.5rem'}}>m/z Target Finder</h3>
            <div style={{display:'flex',gap:'0.75rem',alignItems:'flex-end',flexWrap:'wrap',marginBottom:'0.75rem'}}>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.72rem',color:'var(--muted)'}}>Precursor m/z (Th)</div>
                <input type="number" step="0.001" placeholder="e.g. 564.345"
                  value={mzTarget} onChange={e=>setMzTarget(e.target.value)}
                  style={{...inpSt,width:'140px'}}
                  onKeyDown={e=>{if(e.key==='Enter')doMzSearch();}}
                />
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.72rem',color:'var(--muted)'}}>Tolerance (ppm)</div>
                <input type="number" min="1" max="50" value={mzTolPpm}
                  onChange={e=>setMzTolPpm(+e.target.value)}
                  style={{...inpSt,width:'75px'}} />
              </div>
              <button onClick={doMzSearch} disabled={!mzTarget||!ions.A}
                style={{...btnPrimary(!mzTarget||!ions.A),padding:'0.35rem 0.9rem',fontWeight:600}}>
                Search
              </button>
              {(!ions.A) && (
                <span style={{fontSize:'0.75rem',color:'var(--muted)'}}>
                  Run Compare first to load ion data
                </span>
              )}
            </div>

            {mzResult && (
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.8rem'}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--border)',color:'var(--muted)'}}>
                      {['Run','m/z','Charge','RT (min)','1/K₀','log(I)','Δ m/z (ppm)'].map(h => (
                        <th key={h} style={{padding:'0.25rem 0.5rem',textAlign:'left',fontWeight:600,fontSize:'0.72rem'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {['A','B','C'].flatMap(k => {
                      const hits = mzResult[k] || [];
                      if (!hits.length) return selMap[k] ? [{
                        _runKey:k, _empty:true,
                      }] : [];
                      return hits.map((h,i) => ({...h, _runKey:k, _rank:i}));
                    }).map((row, i) => {
                      const col = COLORS[row._runKey];
                      if (row._empty) return (
                        <tr key={`${row._runKey}-empty`} style={{borderBottom:'1px solid rgba(30,58,95,0.3)'}}>
                          <td style={{padding:'0.25rem 0.5rem',color:col,fontWeight:700}}>Run {row._runKey}</td>
                          <td colSpan={6} style={{padding:'0.25rem 0.5rem',color:'var(--muted)',fontSize:'0.75rem',fontStyle:'italic'}}>
                            Not detected within ±{mzTolPpm} ppm
                          </td>
                        </tr>
                      );
                      const dmzPpm = ((row.mz - parseFloat(mzTarget)) / parseFloat(mzTarget) * 1e6).toFixed(2);
                      return (
                        <tr key={`${row._runKey}-${i}`} style={{borderBottom:'1px solid rgba(30,58,95,0.3)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                          {row._rank === 0
                            ? <td style={{padding:'0.25rem 0.5rem',color:col,fontWeight:700}}>Run {row._runKey}</td>
                            : <td style={{padding:'0.25rem 0.5rem',color:'transparent'}}>·</td>
                          }
                          <td style={{padding:'0.25rem 0.5rem',fontFamily:'monospace'}}>{row.mz.toFixed(4)}</td>
                          <td style={{padding:'0.25rem 0.5rem',color:({0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'})[row.charge]||'var(--muted)',fontWeight:700}}>
                            {row.charge===0?'?':`+${row.charge}`}
                          </td>
                          <td style={{padding:'0.25rem 0.5rem'}}>{row.rt.toFixed(2)}</td>
                          <td style={{padding:'0.25rem 0.5rem'}}>{row.k0.toFixed(4)}</td>
                          <td style={{padding:'0.25rem 0.5rem'}}>{row.logInt.toFixed(2)}</td>
                          <td style={{padding:'0.25rem 0.5rem',color:Math.abs(+dmzPpm)<5?'#3fb950':'#f59e0b'}}>{dmzPpm > 0 ? '+':''}{dmzPpm}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Differences table ── */}
          {tableRows.length > 0 && (
            <div className="card" style={{padding:'0.75rem 1rem'}}>
              <h3 style={{marginBottom:'0.5rem'}}>
                Differential Ions — top {tableRows.length}
                <span style={{fontWeight:400,color:'var(--muted)',fontSize:'0.78rem',marginLeft:'0.5rem'}}>
                  click column header to sort
                </span>
              </h3>
              <div style={{overflowX:'auto',maxHeight:'440px',overflowY:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.78rem'}}>
                  <thead style={{position:'sticky',top:0,background:'var(--surface)',zIndex:1}}>
                    <tr>
                      <th style={thSt('type')} onClick={()=>toggleSort('type')}>Category</th>
                      <th style={thSt('mz')} onClick={()=>toggleSort('mz')}>m/z {sortCol==='mz'?sortDir>0?'↑':'↓':''}</th>
                      <th style={thSt('k0')} onClick={()=>toggleSort('k0')}>1/K₀</th>
                      <th style={thSt('rt')} onClick={()=>toggleSort('rt')}>RT (min)</th>
                      <th style={thSt('charge')} onClick={()=>toggleSort('charge')}>z</th>
                      <th style={thSt('logRatio')} onClick={()=>toggleSort('logRatio')}>log₂(A/B) {sortCol==='logRatio'?sortDir>0?'↑':'↓':''}</th>
                      <th style={thSt('rtDiff')} onClick={()=>toggleSort('rtDiff')}>ΔRT (min)</th>
                      <th style={thSt('imDiff')} onClick={()=>toggleSort('imDiff')}>Δ1/K₀</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => {
                      const col = DIFF_COLORS[row.type] || '#94a3b8';
                      const CHARGE_COL = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
                      return (
                        <tr key={i} style={{borderBottom:'1px solid rgba(30,58,95,0.3)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                          <td style={{padding:'0.25rem 0.5rem'}}>
                            <span style={{padding:'0.1rem 0.4rem',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700,
                                          background:`${col}22`,color:col,border:`1px solid ${col}44`}}>
                              {row.type}
                            </span>
                          </td>
                          <td style={{padding:'0.25rem 0.5rem',fontFamily:'monospace'}}>{row.mz.toFixed(4)}</td>
                          <td style={{padding:'0.25rem 0.5rem',fontFamily:'monospace'}}>{row.k0.toFixed(4)}</td>
                          <td style={{padding:'0.25rem 0.5rem'}}>{row.rt.toFixed(2)}</td>
                          <td style={{padding:'0.25rem 0.5rem',color:CHARGE_COL[row.charge]||'var(--muted)',fontWeight:700}}>
                            {row.charge===0?'?':`+${row.charge}`}
                          </td>
                          <td style={{padding:'0.25rem 0.5rem',fontFamily:'monospace',
                              color:row.logRatio==null?'var(--muted)':row.logRatio>0?'#58a6ff':'#f78166',fontWeight:600}}>
                            {row.logRatio != null ? `${row.logRatio>0?'+':''}${(row.logRatio/Math.LN2).toFixed(2)}` : '—'}
                          </td>
                          <td style={{padding:'0.25rem 0.5rem',color:row.rtDiff>1?'#fde68a':'var(--muted)'}}>
                            {row.rtDiff != null ? row.rtDiff.toFixed(2) : '—'}
                          </td>
                          <td style={{padding:'0.25rem 0.5rem',color:row.imDiff>0.025?'#c4b5fd':'var(--muted)'}}>
                            {row.imDiff != null ? row.imDiff.toFixed(4) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      );
    }

    /* ── MIA — Mobility Ion Analysis ────────────────────────────────── */
    function MiaTab() {
      const { data: allRuns } = useFetch('/api/runs?limit=1000');
      const runs = Array.isArray(allRuns) ? allRuns : [];

      // ── State ──────────────────────────────────────────────────────────
      const [selectedRunIds, setSelectedRunIds] = useState(new Set());
      const [seqQuery, setSeqQuery]   = useState('');
      const [mzQuery,  setMzQuery]    = useState('');
      const [mzPpm,    setMzPpm]      = useState(10);
      const [busy,     setBusy]       = useState(false);
      const [results,  setResults]    = useState(null);   // {runId: {run_name, peptides}}
      const [selRow,   setSelRow]     = useState(null);   // selected merged row for IM chart
      const [sortCol,  setSortCol]    = useState('stripped');
      const [sortDir,  setSortDir]    = useState(1);
      const miaChartRef = useRef(null);

      const RUN_COLORS = ['#60a5fa','#f97316','#a78bfa','#4ade80','#f472b6','#facc15','#38bdf8','#fb7185'];

      const toggleRun = (id) => {
        setSelectedRunIds(prev => {
          const n = new Set(prev);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        });
      };

      // ── Search ─────────────────────────────────────────────────────────
      async function doSearch() {
        if (selectedRunIds.size === 0) return;
        setBusy(true); setResults(null); setSelRow(null);
        const runIds = [...selectedRunIds].join(',');
        const mz  = parseFloat(mzQuery) || 0;
        const url = `/api/mia/compare?run_ids=${runIds}&q=${encodeURIComponent(seqQuery)}&mz=${mz}&mz_ppm=${mzPpm}&limit=200`;
        try {
          const r = await fetch(url);
          const d = await r.json();
          setResults(d);
        } catch(e) {}
        setBusy(false);
      }

      // ── Merge results by (stripped, charge) ────────────────────────────
      const orderedRunIds = useMemo(() => {
        if (!results) return [];
        return [...selectedRunIds].filter(id => results[id]);
      }, [results, selectedRunIds]);

      const mergedRows = useMemo(() => {
        if (!results) return [];
        const map = {};
        orderedRunIds.forEach(id => {
          const { peptides } = results[id];
          peptides.forEach(p => {
            const key = `${p.stripped||p.sequence}__z${p.charge}`;
            if (!map[key]) {
              map[key] = { stripped: p.stripped||p.sequence, sequence: p.sequence,
                           charge: p.charge, mz: p.mz, runs: {} };
            }
            map[key].runs[id] = {
              mobility: p.mobility, rt: p.rt, intensity: p.intensity,
              best_fr_mz: p.best_fr_mz, predicted_im: p.predicted_im,
              mz_ppm_delta: p.mz_ppm_delta,
            };
          });
        });
        return Object.values(map);
      }, [results, orderedRunIds]);

      const sortedRows = useMemo(() => {
        return [...mergedRows].sort((a, b) => {
          if (sortCol === 'stripped') return sortDir * a.stripped.localeCompare(b.stripped);
          if (sortCol === 'mz')       return sortDir * (a.mz - b.mz);
          if (sortCol === 'charge')   return sortDir * (a.charge - b.charge);
          // For per-run IM sorts: sortCol = "im_{runId}"
          if (sortCol.startsWith('im_')) {
            const rid = sortCol.slice(3);
            return sortDir * ((a.runs[rid]?.mobility??-1) - (b.runs[rid]?.mobility??-1));
          }
          return 0;
        });
      }, [mergedRows, sortCol, sortDir]);

      function toggleSort(col) {
        if (sortCol === col) setSortDir(d => -d);
        else { setSortCol(col); setSortDir(1); }
      }

      // ── IM comparison bar chart for selected row ───────────────────────
      useEffect(() => {
        if (!miaChartRef.current || !window.Plotly || !selRow) return;
        const labels=[], measured=[], predicted=[];
        orderedRunIds.forEach((id, ci) => {
          const rd = selRow.runs[id];
          if (!rd) return;
          const rname = (results[id]?.run_name || `Run ${id}`).replace(/\.d$/, '').slice(-30);
          labels.push(rname);
          measured.push(rd.mobility ?? null);
          predicted.push(rd.predicted_im ?? null);
        });

        const traces = [{
          type:'bar', name:'Measured 1/K₀', x:labels, y:measured,
          marker:{color:orderedRunIds.map((_,i)=>RUN_COLORS[i%RUN_COLORS.length])},
          hovertemplate:'%{x}<br>1/K₀: %{y:.4f}<extra>measured</extra>',
        }];
        if (predicted.some(v => v != null)) {
          traces.push({
            type:'scatter', mode:'markers', name:'Predicted 1/K₀',
            x:labels, y:predicted,
            marker:{symbol:'diamond',size:10,color:'#fde68a',line:{color:'#b45309',width:1.5}},
            hovertemplate:'%{x}<br>Predicted: %{y:.4f}<extra></extra>',
          });
        }
        window.Plotly.react(miaChartRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:10,t:30,b:80},
          height:260,
          title:{text:`1/K₀ — ${selRow.stripped} z=${selRow.charge}`, font:{size:12,color:'#e2e8f0'}, x:0},
          xaxis:{color:'#a0b4cc',gridcolor:'#1e3a5f',tickangle:-30,automargin:true},
          yaxis:{color:'#a0b4cc',gridcolor:'#1e3a5f',title:{text:'1/K₀ (Vs/cm²)',font:{size:10}}},
          legend:{x:0.01,y:0.99,bgcolor:'rgba(0,0,0,0.4)',font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          barmode:'group',
        }, {responsive:true,displayModeBar:false});
      }, [selRow, orderedRunIds, results]);

      const inpSt = {
        background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',
        borderRadius:'0.35rem',padding:'0.3rem 0.6rem',fontSize:'0.8rem',
      };
      const thSt = (col) => ({
        padding:'0.25rem 0.5rem',textAlign:'left',cursor:'pointer',fontSize:'0.72rem',fontWeight:600,
        color:sortCol===col?'var(--accent)':'var(--muted)',whiteSpace:'nowrap',
        borderBottom:'1px solid var(--border)',userSelect:'none',
      });
      const CHARGE_COL = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};

      return (
        <div style={{padding:'0.5rem'}}>

          {/* Header */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem 1rem',
               background:'linear-gradient(135deg,rgba(2,40,81,0.8),rgba(31,6,107,0.2))',
               border:'1px solid rgba(96,165,250,0.2)'}}>
            <div style={{display:'flex',alignItems:'baseline',gap:'0.75rem',marginBottom:'0.25rem'}}>
              <span style={{fontSize:'1.1rem',fontWeight:900,background:'linear-gradient(90deg,#60a5fa,#a855f7)',
                            WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>MIA</span>
              <span style={{color:'var(--muted)',fontSize:'0.8rem'}}>Mobility Ion Analysis</span>
              <span style={{color:'rgba(96,165,250,0.4)',fontSize:'0.75rem',fontStyle:'italic',marginLeft:'auto'}}>
                named for Mia — every ion has a charge; every name has a story
              </span>
            </div>
            <div style={{color:'var(--muted)',fontSize:'0.82rem',lineHeight:1.6}}>
              Search your DIA-NN results like a spectral library — compare identified
              ion mobilities (1/K₀), retention times, and intensities across multiple runs.
              Select any peptide row to see its mobility chart.
            </div>
          </div>

          {/* Run selector */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem 1rem'}}>
            <div style={{fontWeight:600,fontSize:'0.85rem',marginBottom:'0.5rem',color:'var(--muted)'}}>
              Select runs to compare (up to 8)
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'0.4rem',marginBottom:'0.75rem'}}>
              {runs.slice(0,50).map((r,i) => {
                const sel = selectedRunIds.has(String(r.id));
                const col = RUN_COLORS[i % RUN_COLORS.length];
                return (
                  <button key={r.id} onClick={() => toggleRun(String(r.id))}
                    style={{padding:'0.3rem 0.6rem',fontSize:'0.75rem',borderRadius:'0.35rem',cursor:'pointer',
                            fontWeight: sel?700:400,
                            background: sel ? `${col}22` : 'var(--bg)',
                            border:`1px solid ${sel ? col : 'var(--border)'}`,
                            color: sel ? col : 'var(--muted)'}}>
                    {r.run_name?.replace(/\.d$/,'').slice(-35)}
                  </button>
                );
              })}
              {runs.length === 0 && <span style={{color:'var(--muted)',fontSize:'0.8rem'}}>No runs available</span>}
            </div>

            {/* Search controls */}
            <div style={{display:'flex',gap:'0.6rem',alignItems:'flex-end',flexWrap:'wrap'}}>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>Sequence (substring)</div>
                <input value={seqQuery} onChange={e=>setSeqQuery(e.target.value)}
                  placeholder="e.g. PEPTIDE or ACDEF…"
                  onKeyDown={e=>{if(e.key==='Enter')doSearch();}}
                  style={{...inpSt,width:'220px'}} />
              </div>
              <div style={{color:'var(--muted)',fontSize:'0.8rem',paddingBottom:'0.3rem'}}>or</div>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>Precursor m/z (Th)</div>
                <input type="number" step="0.001" value={mzQuery} onChange={e=>setMzQuery(e.target.value)}
                  placeholder="e.g. 564.345"
                  onKeyDown={e=>{if(e.key==='Enter')doSearch();}}
                  style={{...inpSt,width:'130px'}} />
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>Tolerance (ppm)</div>
                <input type="number" min="1" max="50" value={mzPpm}
                  onChange={e=>setMzPpm(+e.target.value)} style={{...inpSt,width:'70px'}} />
              </div>
              <button onClick={doSearch}
                disabled={selectedRunIds.size===0||(!seqQuery&&!mzQuery)||busy}
                style={{padding:'0.4rem 1rem',background:selectedRunIds.size>0&&(seqQuery||mzQuery)?'#1f6feb':'#1f2937',
                        border:`1px solid ${selectedRunIds.size>0&&(seqQuery||mzQuery)?'#388bfd':'var(--border)'}`,
                        color:selectedRunIds.size>0&&(seqQuery||mzQuery)?'#fff':'var(--muted)',
                        borderRadius:'0.4rem',cursor:'pointer',fontWeight:700,fontSize:'0.85rem'}}>
                {busy ? 'Searching…' : 'Search'}
              </button>
              {selectedRunIds.size === 0 && (
                <span style={{fontSize:'0.75rem',color:'var(--muted)',paddingBottom:'0.1rem'}}>Select at least one run</span>
              )}
            </div>
          </div>

          {/* Empty state */}
          {!results && !busy && (
            <div className="card" style={{textAlign:'center',padding:'4rem 2rem',color:'var(--muted)'}}>
              <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.35}}>🧬</div>
              <div style={{fontWeight:600,color:'var(--text)',marginBottom:'0.4rem'}}>Ion Mobility Library</div>
              <div style={{fontSize:'0.85rem',lineHeight:1.6,maxWidth:'480px',margin:'0 auto'}}>
                Select runs above, enter a peptide sequence or precursor m/z,
                and click Search to compare measured 1/K₀ values across your data.
              </div>
            </div>
          )}

          {/* Results */}
          {results && sortedRows.length === 0 && (
            <div className="card" style={{textAlign:'center',padding:'3rem 2rem',color:'var(--muted)'}}>
              No peptides found matching your search in the selected runs.
            </div>
          )}

          {sortedRows.length > 0 && (
            <>
              {/* IM chart for selected row */}
              {selRow && (
                <div className="card" style={{marginBottom:'0.75rem',padding:'0.75rem 1rem'}}>
                  <div ref={miaChartRef} style={{width:'100%'}} />
                  {selRow && (
                    <div style={{marginTop:'0.4rem',display:'flex',gap:'1.5rem',flexWrap:'wrap',fontSize:'0.78rem',color:'var(--muted)'}}>
                      {orderedRunIds.map((id,ci) => {
                        const rd = selRow.runs[id];
                        if (!rd?.mobility) return null;
                        const col = RUN_COLORS[ci%RUN_COLORS.length];
                        const rname = (results[id]?.run_name||`Run ${id}`).replace(/\.d$/,'');
                        return (
                          <span key={id}>
                            <span style={{color:col,fontWeight:600}}>{rname.slice(-25)}: </span>
                            <span style={{color:'var(--text)',fontFamily:'monospace'}}>{rd.mobility.toFixed(4)}</span>
                            {rd.predicted_im && <span style={{color:'var(--muted)',marginLeft:'0.3rem'}}>
                              (pred {rd.predicted_im.toFixed(4)}, Δ{(rd.mobility-rd.predicted_im).toFixed(4)})
                            </span>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="card" style={{padding:'0.75rem 1rem'}}>
                <div style={{display:'flex',alignItems:'baseline',gap:'1rem',marginBottom:'0.5rem'}}>
                  <h3 style={{margin:0}}>Results — {sortedRows.length} peptides</h3>
                  <span style={{fontSize:'0.75rem',color:'var(--muted)'}}>click row to see IM chart · click header to sort</span>
                </div>
                <div style={{overflowX:'auto',maxHeight:'520px',overflowY:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.78rem'}}>
                    <thead style={{position:'sticky',top:0,background:'var(--surface)',zIndex:1}}>
                      <tr>
                        <th style={thSt('stripped')} onClick={()=>toggleSort('stripped')}>
                          Sequence {sortCol==='stripped'?sortDir>0?'↑':'↓':''}
                        </th>
                        <th style={thSt('charge')} onClick={()=>toggleSort('charge')}>z</th>
                        <th style={thSt('mz')} onClick={()=>toggleSort('mz')}>m/z (Th)</th>
                        {orderedRunIds.map((id,ci) => {
                          const col = RUN_COLORS[ci%RUN_COLORS.length];
                          const rname = (results[id]?.run_name||`Run ${id}`).replace(/\.d$/,'');
                          return (
                            <React.Fragment key={id}>
                              <th style={{...thSt(`im_${id}`),color:sortCol===`im_${id}`?col:'var(--muted)'}}
                                  onClick={()=>toggleSort(`im_${id}`)}>
                                <span style={{color:col}}>1/K₀</span> {rname.slice(-20)} {sortCol===`im_${id}`?sortDir>0?'↑':'↓':''}
                              </th>
                              <th style={{padding:'0.25rem 0.5rem',fontSize:'0.68rem',color:'var(--muted)',
                                          borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>
                                RT
                              </th>
                            </React.Fragment>
                          );
                        })}
                        {orderedRunIds.length > 1 && (
                          <th style={{padding:'0.25rem 0.5rem',fontSize:'0.72rem',color:'#c4b5fd',
                                      borderBottom:'1px solid var(--border)',whiteSpace:'nowrap',fontWeight:600}}>
                            Δ1/K₀ (max−min)
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row, ri) => {
                        const isSel = selRow === row;
                        const mobVals = orderedRunIds.map(id => row.runs[id]?.mobility).filter(v => v != null);
                        const imSpread = mobVals.length > 1 ? Math.max(...mobVals) - Math.min(...mobVals) : null;
                        return (
                          <tr key={ri} onClick={() => setSelRow(isSel ? null : row)}
                            style={{borderBottom:'1px solid rgba(30,58,95,0.3)',
                                    background:isSel?'rgba(96,165,250,0.08)':ri%2===0?'transparent':'rgba(255,255,255,0.01)',
                                    cursor:'pointer'}}>
                            <td style={{padding:'0.25rem 0.5rem',fontFamily:'monospace',
                                        color:isSel?'var(--accent)':'var(--text)',fontWeight:isSel?700:400}}>
                              {row.stripped}
                            </td>
                            <td style={{padding:'0.25rem 0.5rem',color:CHARGE_COL[row.charge]||'var(--muted)',fontWeight:700}}>
                              {row.charge===0?'?':`+${row.charge}`}
                            </td>
                            <td style={{padding:'0.25rem 0.5rem',fontFamily:'monospace'}}>{row.mz.toFixed(4)}</td>
                            {orderedRunIds.map((id,ci) => {
                              const rd = row.runs[id];
                              const col = RUN_COLORS[ci%RUN_COLORS.length];
                              const isMin = rd?.mobility != null && mobVals.length > 1 && rd.mobility === Math.min(...mobVals);
                              const isMax = rd?.mobility != null && mobVals.length > 1 && rd.mobility === Math.max(...mobVals);
                              return (
                                <React.Fragment key={id}>
                                  <td style={{padding:'0.25rem 0.5rem',fontFamily:'monospace',
                                              color:rd?.mobility!=null?col:'var(--border)',fontWeight:600,
                                              background: isMin?'rgba(96,165,250,0.06)': isMax?'rgba(168,85,247,0.06)':'transparent'}}>
                                    {rd?.mobility != null ? rd.mobility.toFixed(4) : '—'}
                                    {rd?.best_fr_mz && <span style={{color:'var(--muted)',fontSize:'0.65rem',marginLeft:'0.2rem'}}>
                                      ★{rd.best_fr_mz.toFixed(3)}
                                    </span>}
                                  </td>
                                  <td style={{padding:'0.25rem 0.5rem',color:'var(--muted)',fontSize:'0.72rem'}}>
                                    {rd?.rt != null ? rd.rt.toFixed(2) : '—'}
                                  </td>
                                </React.Fragment>
                              );
                            })}
                            {orderedRunIds.length > 1 && (
                              <td style={{padding:'0.25rem 0.5rem',fontFamily:'monospace',fontWeight:600,
                                          color: imSpread != null ? (imSpread > 0.025 ? '#c4b5fd' : '#4ade80') : 'var(--border)'}}>
                                {imSpread != null ? imSpread.toFixed(4) : '—'}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      );
    }

    function App() {
      const [tab, setTab] = useState('live');
      const { data: ver } = useFetch('/api/version');
      // Pinned run IDs — persists across tab switches, shared between RunHistory/Trends/Health
      const [pinnedRunIds, setPinnedRunIds] = useState(new Set());

      const pinCount = pinnedRunIds.size;

      // Tab label badges when pins are active
      const trendLabel  = pinCount > 0 ? `Trends [${pinCount}]` : 'Trends';
      const healthLabel = pinCount > 0 ? `Health [${pinCount}]` : 'Health';

      return (
        <div className="container">
          <header>
            <h1><span>ZIGGY</span> &mdash; The Proteomics Rockstar</h1>
            <span className="version">{ver ? `v${ver.version}` : ''}</span>
          </header>
          <div className="tabs">
            <div className="tab-row">
              {[['live', "Today's Runs"], ['history', 'Run History'], ['trends', trendLabel], ['health', healthLabel], ['config', 'Config'], ['community', 'Community'], ['about', 'About']].map(([k, label]) =>
                <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
              )}
            </div>
            <div className="tab-row">
              {[['mobility', 'Ion Mobility'], ['landscape', '🗻 Landscape'], ['advantage', '4D Advantage'], ['ccs', 'CCS'], ['lc', 'LC Traces'], ['spectra', 'Spectra'], ['enzyme', 'Enzyme'], ['immuno', 'Immunopeptidomics'], ['searches', 'Searches']].map(([k, label]) =>
                <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
              )}
            </div>
            <div className="tab-row">
              {[['sneaky', '🔍 Sneaky Peaky'], ['mia', '🧬 MIA']].map(([k, label]) =>
                <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
              )}
            </div>
          </div>
          <ErrorBoundary key={tab}>
            {tab === 'live' && <LiveRuns />}
            {tab === 'history' && <RunHistory pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} navigateTo={setTab} />}
            {tab === 'trends' && <TrendCharts pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} />}
            {tab === 'health' && <HealthTab pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} />}
            {tab === 'mobility' && <MobilityTab />}
            {tab === 'landscape' && <LandscapeViewerTab />}
            {tab === 'advantage' && <AdvantageTab />}
            {tab === 'ccs' && <CCSTab />}
            {tab === 'lc' && <LcTracesTab />}
            {tab === 'spectra' && <SpectraTab />}
            {tab === 'enzyme' && <EnzymeTab />}
            {tab === 'immuno' && <ImmunopeptidomicsTab />}
            {tab === 'searches' && <SearchesTab />}
            {tab === 'sneaky' && <SneakyPeakyTab />}
            {tab === 'mia'    && <MiaTab />}
            {tab === 'config' && <ConfigEditor />}
            {tab === 'community' && <CommunityTab />}
            {tab === 'about' && <AboutTab />}
          </ErrorBoundary>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  