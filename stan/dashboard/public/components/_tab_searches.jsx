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

