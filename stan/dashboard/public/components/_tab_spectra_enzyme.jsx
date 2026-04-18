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

