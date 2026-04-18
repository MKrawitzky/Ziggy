    function DeNovoTab() {
      const { data: allRuns } = useFetch('/api/runs?limit=1000');
      const { data: engines } = useFetch('/api/denovo/engines');
      const [selectedRun, setSelectedRun] = useState(null);
      const [engine, setEngine] = useState('auto');
      const [immunoMode, setImmunoMode] = useState(false);
      const [maxSpectra, setMaxSpectra] = useState(2000);
      const [jobId, setJobId] = useState(null);
      const [job, setJob] = useState(null);
      const [polling, setPolling] = useState(false);
      const [minScore, setMinScore] = useState(0.5);
      const [filterLen, setFilterLen] = useState('');
      const [filterCharge, setFilterCharge] = useState('');
      const [selectedPeptide, setSelectedPeptide] = useState(null);
      const pollRef = useRef(null);

      // Poll job status while running
      useEffect(() => {
        if (!jobId || !polling) return;
        pollRef.current = setInterval(async () => {
          try {
            const r = await fetch(API + `/api/denovo/${jobId}`);
            if (!r.ok) return;
            const d = await r.json();
            setJob(d);
            if (d.status === 'done' || d.status === 'error') {
              setPolling(false);
              clearInterval(pollRef.current);
            }
          } catch {}
        }, 1500);
        return () => clearInterval(pollRef.current);
      }, [jobId, polling]);

      const runDeNovo = async () => {
        if (!selectedRun) return;
        setJob({ status: 'queued' });
        setSelectedPeptide(null);
        try {
          const params = new URLSearchParams({
            engine,
            max_spectra: maxSpectra,
            immuno_mode: immunoMode,
          });
          const r = await fetch(API + `/api/runs/${selectedRun.id}/denovo?${params}`, { method: 'POST' });
          const d = await r.json();
          if (d.job_id) {
            setJobId(d.job_id);
            setPolling(true);
          } else {
            setJob({ status: 'error', error: d.detail || 'Unknown error' });
          }
        } catch (e) {
          setJob({ status: 'error', error: String(e) });
        }
      };

      const exportCsv = () => {
        if (!job?.results?.length) return;
        const cols = ['sequence', 'sequence_clean', 'score', 'length', 'charge', 'precursor_mz', 'rt_sec', 'one_over_k0', 'engine'];
        const rows = [cols.join(',')];
        for (const r of job.results) {
          rows.push(cols.map(c => JSON.stringify(r[c] ?? '')).join(','));
        }
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `denovo_${selectedRun?.run_name || 'results'}.csv`;
        a.click();
      };

      // Filtered results
      const results = (job?.results || []).filter(r => {
        if (r.score < minScore) return false;
        if (filterLen) {
          const [lo, hi] = filterLen.split('-').map(Number);
          if (hi ? (r.length < lo || r.length > hi) : r.length !== lo) return false;
        }
        if (filterCharge && r.charge !== parseInt(filterCharge)) return false;
        return true;
      });

      // Score histogram data
      const scoreBins = Array(10).fill(0);
      (job?.results || []).forEach(r => {
        const b = Math.min(9, Math.floor(r.score * 10));
        scoreBins[b]++;
      });
      const maxBin = Math.max(...scoreBins, 1);

      // Length distribution
      const lenDist = {};
      (job?.results || []).forEach(r => {
        lenDist[r.length] = (lenDist[r.length] || 0) + 1;
      });

      // B/Y ion ladder for selected peptide
      const AAs = {A:71.037,R:156.101,N:114.043,D:115.027,C:103.009,E:129.043,Q:128.058,G:57.021,H:137.058,I:113.084,L:113.084,K:128.094,M:131.040,F:147.068,P:97.052,S:87.032,T:101.047,W:186.079,Y:163.063,V:99.068};
      const computeIons = (seq) => {
        const clean = seq.replace(/[^A-Z]/g, '');
        const bions = [], yions = [];
        let b = 1.00728; // H+
        let y = 18.010 + 1.00728; // H2O + H+
        for (let i = 0; i < clean.length - 1; i++) {
          b += AAs[clean[i]] || 0;
          bions.push({ pos: i + 1, mz: b, label: `b${i + 1}` });
        }
        for (let i = clean.length - 1; i > 0; i--) {
          y += AAs[clean[i]] || 0;
          yions.push({ pos: clean.length - i, mz: y, label: `y${clean.length - i}` });
        }
        return { bions, yions, seq: clean };
      };

      const ionData = selectedPeptide ? computeIons(selectedPeptide.sequence_clean || selectedPeptide.sequence) : null;

      const ddaRuns = (allRuns || []).filter(r => r.raw_path?.endsWith('.d'));
      const avEngines = engines?.available || [];
      const noEngines = avEngines.length === 0;

      const STATUS_COLOR = { queued: '#94a3b8', extracting: '#60a5fa', sequencing: '#a78bfa', done: '#22c55e', error: '#ef4444' };
      const STATUS_LABEL = { queued: 'Queued', extracting: 'Extracting spectra (Novor path)…', sequencing: 'Sequencing peptides…', done: 'Done', error: 'Error' };

      return (
        <div style={{display:'flex',gap:'1rem',height:'calc(100vh - 160px)'}}>
          {/* Left panel — run list + settings */}
          <div style={{width:'260px',flexShrink:0,display:'flex',flexDirection:'column',gap:'0.75rem'}}>
            <div style={{background:'#1e293b',borderRadius:'8px',padding:'0.75rem',fontSize:'0.78rem',color:'#94a3b8'}}>
              <div style={{fontWeight:700,color:'#e2e8f0',marginBottom:'0.5rem'}}>Engine</div>
              {noEngines ? (
                <div style={{color:'#ef4444',fontSize:'0.72rem'}}>
                  No engine installed.<br/>
                  Casanovo: <code style={{fontSize:'0.68rem'}}>see ZIGGY docs</code><br/>
                  Novor: place novor.jar in<br/><code style={{fontSize:'0.68rem'}}>E:\ziggy\tools\novor\</code>
                </div>
              ) : (
                <>
                  <select value={engine} onChange={e => setEngine(e.target.value)}
                    style={{width:'100%',background:'#0f172a',color:'#e2e8f0',border:'1px solid #334155',borderRadius:'4px',padding:'0.3rem',marginBottom:'0.4rem'}}>
                    <option value="auto">Auto ({avEngines[0] || '?'})</option>
                    {avEngines.includes('casanovo') && <option value="casanovo">Casanovo (GPU)</option>}
                    {avEngines.includes('novor') && <option value="novor">Novor (Java)</option>}
                  </select>
                  <label style={{display:'flex',alignItems:'center',gap:'0.4rem',cursor:'pointer'}}>
                    <input type="checkbox" checked={immunoMode} onChange={e => setImmunoMode(e.target.checked)} />
                    <span>Immunopeptidomics mode<br/><span style={{color:'#64748b',fontSize:'0.7rem'}}>non-tryptic, z=1-3, 8-25aa</span></span>
                  </label>
                  <div style={{marginTop:'0.5rem'}}>
                    Max spectra: <input type="number" value={maxSpectra} onChange={e => setMaxSpectra(parseInt(e.target.value)||2000)}
                      min="100" max="10000" step="500"
                      style={{width:'70px',background:'#0f172a',color:'#e2e8f0',border:'1px solid #334155',borderRadius:'4px',padding:'0.2rem 0.4rem'}} />
                  </div>
                </>
              )}
            </div>

            <div style={{background:'#1e293b',borderRadius:'8px',padding:'0.75rem',fontSize:'0.78rem',color:'#94a3b8',flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
              <div style={{fontWeight:700,color:'#e2e8f0',marginBottom:'0.5rem'}}>.d Runs ({ddaRuns.length})</div>
              <div style={{overflowY:'auto',flex:1}}>
                {ddaRuns.map(r => (
                  <div key={r.id}
                    onClick={() => { setSelectedRun(r); setJob(null); setJobId(null); setSelectedPeptide(null); }}
                    style={{padding:'0.35rem 0.5rem',marginBottom:'2px',borderRadius:'4px',cursor:'pointer',
                      background: selectedRun?.id === r.id ? '#334155' : 'transparent',
                      color: selectedRun?.id === r.id ? '#e2e8f0' : '#94a3b8'}}>
                    <div style={{fontSize:'0.72rem',fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.run_name}</div>
                    <div style={{fontSize:'0.65rem',color:'#475569'}}>{r.run_date?.slice(0,10)} · {r.mode || '?'}</div>
                  </div>
                ))}
                {ddaRuns.length === 0 && <div style={{color:'#475569',fontSize:'0.72rem'}}>No .d runs in database</div>}
              </div>
            </div>

            <button onClick={runDeNovo}
              disabled={!selectedRun || noEngines || (job && ['queued','extracting','sequencing'].includes(job.status))}
              style={{padding:'0.6rem',background: (!selectedRun || noEngines) ? '#1e293b' : '#6d28d9',color: (!selectedRun || noEngines) ? '#475569' : '#fff',border:'none',borderRadius:'8px',fontWeight:700,cursor: (!selectedRun||noEngines)?'not-allowed':'pointer',fontSize:'0.85rem'}}>
              {job && ['queued','extracting','sequencing'].includes(job.status) ? 'Running…' : 'Run De Novo'}
            </button>
          </div>

          {/* Main content */}
          <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column',gap:'0.75rem'}}>
            {!selectedRun && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'#475569',fontSize:'1rem'}}>
                Select a .d run and click Run De Novo
              </div>
            )}

            {selectedRun && !job && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:'0.5rem',color:'#64748b'}}>
                <div style={{fontSize:'1.1rem',fontWeight:600,color:'#94a3b8'}}>{selectedRun.run_name}</div>
                <div style={{fontSize:'0.8rem'}}>{selectedRun.mode || 'unknown mode'} · {selectedRun.run_date?.slice(0,10)}</div>
                {selectedRun.mode?.includes('dia') && (
                  <div style={{background:'#292524',border:'1px solid #78350f',borderRadius:'6px',padding:'0.5rem 0.75rem',marginTop:'0.5rem',fontSize:'0.75rem',color:'#fbbf24',maxWidth:'400px',textAlign:'center'}}>
                    This is a DIA run — de novo works best on ddaPASEF data where each spectrum contains a single isolated precursor. DIA spectra are chimeric and will give lower-confidence results.
                  </div>
                )}
                <div style={{fontSize:'0.78rem',color:'#475569',marginTop:'0.25rem'}}>Configure settings and click Run De Novo →</div>
              </div>
            )}

            {job && (
              <>
                {/* Status bar */}
                <div style={{background:'#1e293b',borderRadius:'8px',padding:'0.6rem 1rem',display:'flex',alignItems:'center',gap:'1rem',fontSize:'0.82rem'}}>
                  <span style={{width:'10px',height:'10px',borderRadius:'50%',background:STATUS_COLOR[job.status]||'#94a3b8',flexShrink:0,boxShadow:`0 0 6px ${STATUS_COLOR[job.status]||'#94a3b8'}66`}} />
                  <span style={{color:'#e2e8f0',fontWeight:600}}>{STATUS_LABEL[job.status]||job.status}</span>
                  {job.n_spectra > 0 && <span style={{color:'#64748b'}}>{job.n_spectra.toLocaleString()} spectra extracted</span>}
                  {job.n_results > 0 && <span style={{color:'#64748b'}}>{job.n_results.toLocaleString()} sequences found</span>}
                  {job.engine_used && <span style={{color:'#6d28d9',fontWeight:600}}>{job.engine_used}</span>}
                  {job.acq_mode && <span style={{color:'#475569'}}>{job.acq_mode}</span>}
                  {job.warning && <span style={{color:'#fbbf24',fontSize:'0.75rem'}}>{job.warning}</span>}
                  {job.error && <span style={{color:'#ef4444'}}>{job.error}</span>}
                  {job.status === 'done' && job.results?.length > 0 && (
                    <button onClick={exportCsv} style={{marginLeft:'auto',padding:'0.25rem 0.7rem',background:'#334155',color:'#e2e8f0',border:'none',borderRadius:'4px',cursor:'pointer',fontSize:'0.75rem'}}>
                      Export CSV
                    </button>
                  )}
                </div>

                {/* Running spinner */}
                {['queued','extracting','sequencing'].includes(job.status) && (
                  <div style={{display:'flex',alignItems:'center',justifyContent:'center',flex:1,color:'#64748b',flexDirection:'column',gap:'0.75rem'}}>
                    <div style={{width:'36px',height:'36px',border:'3px solid #334155',borderTopColor:'#a78bfa',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />
                    <div>{STATUS_LABEL[job.status]}</div>
                  </div>
                )}

                {job.status === 'done' && job.results?.length > 0 && (
                  <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column',gap:'0.6rem'}}>
                    {/* Summary stats + score histogram */}
                    <div style={{display:'flex',gap:'0.75rem'}}>
                      {/* Score distribution mini histogram */}
                      <div style={{background:'#1e293b',borderRadius:'8px',padding:'0.6rem',flex:1}}>
                        <div style={{fontSize:'0.72rem',color:'#94a3b8',marginBottom:'0.4rem',fontWeight:600}}>Score distribution ({job.results.length.toLocaleString()} total)</div>
                        <div style={{display:'flex',alignItems:'flex-end',gap:'2px',height:'40px'}}>
                          {scoreBins.map((n, i) => (
                            <div key={i} title={`${i/10}–${(i+1)/10}: ${n}`}
                              style={{flex:1,background: i >= minScore*10 ? '#a78bfa' : '#334155',height:`${Math.round(n/maxBin*100)}%`,minHeight:'2px',borderRadius:'2px 2px 0 0',transition:'height 0.2s'}} />
                          ))}
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.62rem',color:'#475569',marginTop:'2px'}}>
                          <span>0</span><span>0.5</span><span>1.0</span>
                        </div>
                      </div>
                      {/* Length distribution */}
                      <div style={{background:'#1e293b',borderRadius:'8px',padding:'0.6rem',flex:1}}>
                        <div style={{fontSize:'0.72rem',color:'#94a3b8',marginBottom:'0.4rem',fontWeight:600}}>Length distribution</div>
                        <div style={{display:'flex',alignItems:'flex-end',gap:'1px',height:'40px',overflowX:'auto'}}>
                          {Object.entries(lenDist).sort((a,b)=>+a[0]-+b[0]).map(([len, n]) => {
                            const maxN = Math.max(...Object.values(lenDist), 1);
                            return (
                              <div key={len} title={`${len}aa: ${n}`}
                                style={{width:'14px',flexShrink:0,background: (+len>=8 && +len<=14) ? '#22c55e' : (+len>=15&&+len<=25) ? '#60a5fa' : '#475569',
                                  height:`${Math.round(n/maxN*100)}%`,minHeight:'2px',borderRadius:'2px 2px 0 0'}} />
                            );
                          })}
                        </div>
                        <div style={{fontSize:'0.62rem',color:'#475569',marginTop:'2px',display:'flex',gap:'0.5rem'}}>
                          <span style={{color:'#22c55e'}}>■ MHC-I (8-14)</span>
                          <span style={{color:'#60a5fa'}}>■ MHC-II (15-25)</span>
                        </div>
                      </div>
                      {/* Filter controls */}
                      <div style={{background:'#1e293b',borderRadius:'8px',padding:'0.6rem',fontSize:'0.75rem',color:'#94a3b8',minWidth:'150px'}}>
                        <div style={{fontWeight:600,color:'#e2e8f0',marginBottom:'0.4rem'}}>Filters</div>
                        <div style={{display:'flex',flexDirection:'column',gap:'0.3rem'}}>
                          <label>Min score
                            <input type="range" min="0" max="1" step="0.05" value={minScore} onChange={e => setMinScore(+e.target.value)}
                              style={{width:'100%',accentColor:'#a78bfa'}} />
                            <span style={{color:'#e2e8f0'}}>{minScore.toFixed(2)}</span>
                          </label>
                          <label>Length (e.g. 8-14)
                            <input type="text" value={filterLen} onChange={e => setFilterLen(e.target.value)} placeholder="any"
                              style={{width:'100%',background:'#0f172a',color:'#e2e8f0',border:'1px solid #334155',borderRadius:'4px',padding:'0.2rem 0.4rem'}} />
                          </label>
                          <label>Charge
                            <input type="text" value={filterCharge} onChange={e => setFilterCharge(e.target.value)} placeholder="any"
                              style={{width:'100%',background:'#0f172a',color:'#e2e8f0',border:'1px solid #334155',borderRadius:'4px',padding:'0.2rem 0.4rem'}} />
                          </label>
                          <div style={{color:'#64748b',fontSize:'0.68rem'}}>Showing {results.length.toLocaleString()} / {job.results.length.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>

                    {/* Results table + ion ladder side by side */}
                    <div style={{flex:1,overflow:'hidden',display:'flex',gap:'0.6rem'}}>
                      {/* Table */}
                      <div style={{flex:1,overflowY:'auto',background:'#1e293b',borderRadius:'8px'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.75rem'}}>
                          <thead style={{position:'sticky',top:0,background:'#0f172a',zIndex:1}}>
                            <tr>
                              {['Score','Sequence','Len','z','m/z','RT (s)','1/K₀'].map(h => (
                                <th key={h} style={{padding:'0.4rem 0.5rem',textAlign:'left',color:'#94a3b8',fontWeight:600,borderBottom:'1px solid #334155'}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {results.slice(0, 500).map((r, i) => {
                              const mhc1 = r.length >= 8 && r.length <= 14;
                              const mhc2 = r.length >= 15 && r.length <= 25;
                              const isSelected = selectedPeptide === r;
                              return (
                                <tr key={i} onClick={() => setSelectedPeptide(isSelected ? null : r)}
                                  style={{cursor:'pointer',background: isSelected ? '#2d1f63' : i%2===0?'#1e293b':'#162032',
                                    borderLeft: isSelected ? '3px solid #a78bfa' : '3px solid transparent'}}>
                                  <td style={{padding:'0.3rem 0.5rem'}}>
                                    <div style={{width:`${Math.round(r.score*60)}px`,height:'6px',background: r.score>=0.9?'#22c55e':r.score>=0.7?'#60a5fa':'#a78bfa',borderRadius:'3px',minWidth:'4px'}} />
                                    <span style={{color:'#e2e8f0'}}>{r.score.toFixed(3)}</span>
                                  </td>
                                  <td style={{padding:'0.3rem 0.5rem',fontFamily:'monospace',color: mhc1?'#22c55e':mhc2?'#60a5fa':'#e2e8f0',letterSpacing:'0.05em'}}>
                                    {r.sequence}
                                  </td>
                                  <td style={{padding:'0.3rem 0.5rem',color:'#94a3b8'}}>{r.length}</td>
                                  <td style={{padding:'0.3rem 0.5rem',color:'#94a3b8'}}>{r.charge}+</td>
                                  <td style={{padding:'0.3rem 0.5rem',color:'#94a3b8'}}>{r.precursor_mz?.toFixed(4)}</td>
                                  <td style={{padding:'0.3rem 0.5rem',color:'#94a3b8'}}>{r.rt_sec?.toFixed(1)}</td>
                                  <td style={{padding:'0.3rem 0.5rem',color:'#94a3b8'}}>{r.one_over_k0 > 0 ? r.one_over_k0.toFixed(4) : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Ion ladder panel */}
                      {selectedPeptide && ionData && (
                        <div style={{width:'300px',flexShrink:0,background:'#1e293b',borderRadius:'8px',padding:'0.75rem',overflowY:'auto'}}>
                          <div style={{fontFamily:'monospace',fontSize:'0.95rem',color:'#e2e8f0',letterSpacing:'0.08em',marginBottom:'0.5rem',wordBreak:'break-all'}}>
                            {ionData.seq}
                          </div>
                          <div style={{fontSize:'0.72rem',color:'#64748b',marginBottom:'0.75rem'}}>
                            score {selectedPeptide.score.toFixed(3)} · {selectedPeptide.length}aa · z={selectedPeptide.charge}+ · m/z {selectedPeptide.precursor_mz?.toFixed(4)}
                            {selectedPeptide.one_over_k0 > 0 && ` · 1/K₀ ${selectedPeptide.one_over_k0.toFixed(4)}`}
                          </div>
                          {/* Sequence ladder */}
                          <div style={{fontFamily:'monospace',fontSize:'0.78rem',marginBottom:'0.75rem'}}>
                            {ionData.seq.split('').map((aa, i) => (
                              <div key={i} style={{display:'flex',gap:'0.5rem',alignItems:'center',padding:'1px 0',borderBottom:'1px solid #1e293b'}}>
                                <span style={{color:'#60a5fa',width:'55px',textAlign:'right',fontSize:'0.7rem'}}>
                                  {ionData.bions[i] ? `b${i+1} ${ionData.bions[i].mz.toFixed(2)}` : ''}
                                </span>
                                <span style={{color:'#e2e8f0',fontWeight:700,fontSize:'0.9rem',width:'16px',textAlign:'center'}}>{aa}</span>
                                <span style={{color:'#f87171',width:'55px',fontSize:'0.7rem'}}>
                                  {ionData.yions[ionData.seq.length-2-i] ? `y${ionData.seq.length-1-i} ${ionData.yions[ionData.seq.length-2-i].mz.toFixed(2)}` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div style={{fontSize:'0.68rem',color:'#475569',display:'flex',gap:'0.75rem'}}>
                            <span style={{color:'#60a5fa'}}>■ b-ions</span>
                            <span style={{color:'#f87171'}}>■ y-ions</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {job.status === 'done' && (!job.results || job.results.length === 0) && (
                  <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#64748b',flexDirection:'column',gap:'0.5rem'}}>
                    <div>No de novo sequences returned.</div>
                    <div style={{fontSize:'0.78rem'}}>{job.warning || 'Check that the .d file is accessible and contains ddaPASEF MS2 data.'}</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      );
    }

