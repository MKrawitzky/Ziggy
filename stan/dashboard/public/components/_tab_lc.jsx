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

      useEffect(() => { if (visibleGroups.pressure)  plotGroup(pressureRef, 'pressure',  'Pressure (bar)');    return () => { if (pressureRef.current  && window.Plotly) window.Plotly.purge(pressureRef.current);  }; }, [traces, visibleGroups.pressure, plotGroup]);
      useEffect(() => { if (visibleGroups.gradient)  plotGroup(gradientRef, 'gradient',  'Gradient B (%)');    return () => { if (gradientRef.current  && window.Plotly) window.Plotly.purge(gradientRef.current);  }; }, [traces, visibleGroups.gradient, plotGroup]);
      useEffect(() => { if (visibleGroups.flow)      plotGroup(flowRef,     'flow',      'Flow (µL/min)');     return () => { if (flowRef.current      && window.Plotly) window.Plotly.purge(flowRef.current);      }; }, [traces, visibleGroups.flow,     plotGroup]);
      useEffect(() => { if (visibleGroups.temp)      plotGroup(tempRef,     'temp',      'Temp (°C)');         return () => { if (tempRef.current      && window.Plotly) window.Plotly.purge(tempRef.current);      }; }, [traces, visibleGroups.temp,     plotGroup]);
      useEffect(() => { if (visibleGroups.counts)    plotGroup(countsRef,   'counts',    'Intensity (counts)'); return () => { if (countsRef.current    && window.Plotly) window.Plotly.purge(countsRef.current);    }; }, [traces, visibleGroups.counts,   plotGroup]);

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

