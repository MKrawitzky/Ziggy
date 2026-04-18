
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

    // ── Global Plotly defaults — show download button on hover for every chart ──
    // Called once after Plotly is available. Sets 2× PNG as default download
    // format so every chart's modebar camera icon saves a print-quality image.
    (function _setPlotlyDefaults() {
      if (typeof Plotly !== 'undefined' && Plotly.setPlotConfig) {
        Plotly.setPlotConfig({
          displayModeBar: 'hover',
          displaylogo: false,
          toImageButtonOptions: {
            format: 'png',
            scale:  2,
            filename: 'ziggy-chart',
          },
          modeBarButtonsToRemove: ['select2d','lasso2d','autoScale2d'],
        });
      }
    })();

    // ── PlotCard — card wrapper with built-in export control ─────────────────
    // Drop-in replacement for <div className="card"> around any Plotly chart.
    // Props: title, plotRef, filename, children, style, headerStyle
    function PlotCard({ title, plotRef, filename, children, style = {}, headerStyle = {}, canvasRef }) {
      const exportRef = plotRef || canvasRef;
      const isCanvas  = !!canvasRef;
      return (
        <div className="card" style={{marginBottom:'0.75rem', padding:'0.75rem', ...style}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                       marginBottom:'0.4rem', ...headerStyle}}>
            {title && (
              <h3 style={{fontSize:'0.85rem', margin:0}}>{title}</h3>
            )}
            {exportRef && (
              <ExportBtn
                plotRef={exportRef}
                filename={filename || (title ? title.replace(/\s+/g,'_').toLowerCase() : 'ziggy-chart')}
                isCanvas={isCanvas}
                scale={2}
              />
            )}
          </div>
          {children}
        </div>
      );
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

