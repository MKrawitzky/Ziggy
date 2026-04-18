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

