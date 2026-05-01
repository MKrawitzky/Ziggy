    /* ── MIA — Mobility Ion Analysis ────────────────────────────────── */
    function MiaTab({ onSpectrumJump, navigateTo }) {
      const wfCtx = React.useContext(WorkflowContext);
      const { data: allRuns } = useFetch('/api/runs?limit=1000');
      const runs = Array.isArray(allRuns) ? allRuns : [];

      // ── State ──────────────────────────────────────────────────────────
      const [selectedRunIds, setSelectedRunIds] = useState(new Set());

      // Pre-select run jumped from Searches tab
      useEffect(() => {
        const j = wfCtx.jump;
        if (!j || j.workflow !== 'MIA') return;
        setSelectedRunIds(new Set([j.runId]));
      }, [wfCtx.jump]);
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
          <WorkflowRunPicker workflow="MIA"
            selectedRunId={selectedRunIds.size === 1 ? [...selectedRunIds][0] : null}
            onSelect={r => setSelectedRunIds(new Set([r.id]))} />

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
                                    {rd?.best_fr_mz && (
                                      <span
                                        title={`★ Best.Fr.Mz ${rd.best_fr_mz.toFixed(4)} Th — click to view spectrum`}
                                        onClick={e => {
                                          e.stopPropagation();
                                          if (onSpectrumJump) {
                                            onSpectrumJump({
                                              runId:    id,
                                              sequence: row.sequence,
                                              stripped: row.stripped,
                                              charge:   row.charge,
                                              mz:       row.mz,
                                              rt:       rd.rt,
                                              best_fr_mz: rd.best_fr_mz,
                                            });
                                          }
                                          if (navigateTo) navigateTo('spectra');
                                        }}
                                        style={{
                                          color: '#4ade80',
                                          fontSize: '0.7rem',
                                          marginLeft: '0.3rem',
                                          cursor: onSpectrumJump ? 'pointer' : 'default',
                                          fontWeight: 700,
                                          padding: '0 0.2rem',
                                          borderRadius: '0.2rem',
                                          border: onSpectrumJump ? '1px solid #4ade8055' : 'none',
                                          background: onSpectrumJump ? '#4ade8015' : 'transparent',
                                          transition: 'background 0.15s',
                                        }}
                                      >
                                        ★{rd.best_fr_mz.toFixed(3)}
                                      </span>
                                    )}
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

