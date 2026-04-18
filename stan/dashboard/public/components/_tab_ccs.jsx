
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

