    /* ── Immunopeptidomics Discovery Tab ─────────────────────────────────
     *
     * Tools for novel peptide identification in HLA/MHC immunopeptidomics:
     *   1. Cross-run comparison volcano — fold change A vs B, atlas novelty overlay
     *   2. Discovery Atlas — state-of-the-field figure (known vs newly found)
     *   3. Novel peptide table — ranked by intensity × novelty
     *   4. 4D Fingerprint — ion mobility separation of novel vs known peptides
     *
     * Scientific context:
     *   Most immunopeptidomics papers report Venn diagrams (presence/absence).
     *   This tool adds quantitative fold change + atlas novelty scoring, enabling:
     *   - Upregulated presentation in condition A vs B (tumor vs normal, etc.)
     *   - Discovery of peptides not in the HLA Ligand Atlas (truly novel)
     *   - 4D separation using 1/K₀ to resolve isobaric MHC-I peptides
     *   - PeptideAtlas-style tracking of what the field has vs what you found
     * ──────────────────────────────────────────────────────────────────── */

    const _IMMUNO_COLORS = {
      known:         '#64748b',   // gray — in HLA atlas
      novel_shared:  '#DAAA00',   // gold — novel, in both runs
      novel_A:       '#f472b6',   // pink — novel, only in A (upregulated A)
      novel_B:       '#60a5fa',   // blue — novel, only in B (upregulated B)
    };

    const _STATUS_LABEL = {
      known:        'Atlas known',
      novel_shared: 'Novel (both)',
      novel_A:      'Novel — Run A only',
      novel_B:      'Novel — Run B only',
    };

    function ImmunoDiscoveryTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [runA, setRunA]   = useState(null);
      const [runB, setRunB]   = useState(null);
      const [mhcClass, setMhcClass] = useState(0);  // 0=all, 1=MHC-I, 2=MHC-II
      const [cmpData, setCmpData]   = useState(null);
      const [cmpLoading, setCmpLoading] = useState(false);
      const [cmpError, setCmpError]   = useState('');
      const [activePanel, setActivePanel] = useState('volcano');
      const [searchFilter, setSearchFilter] = useState('');
      const [statusFilter, setStatusFilter] = useState('all');
      const [showTop, setShowTop] = useState(50);

      const volcanoRef  = useRef(null);
      const atlasRef    = useRef(null);
      const mobilityRef = useRef(null);

      // Runs with any result_path (searched runs)
      const searchedRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.n_proteins != null);
      }, [allRuns]);

      // Load comparison
      useEffect(() => {
        if (!runA || !runB || runA.id === runB.id) { setCmpData(null); return; }
        setCmpLoading(true);
        setCmpError('');
        setCmpData(null);
        fetch(API + `/api/immuno/compare?run_a=${runA.id}&run_b=${runB.id}&mhc_class=${mhcClass}`)
          .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Error')))
          .then(d => { setCmpData(d); setCmpLoading(false); })
          .catch(e => { setCmpError(String(e)); setCmpLoading(false); });
      }, [runA?.id, runB?.id, mhcClass]);

      // ── Volcano plot ───────────────────────────────────────────────
      useEffect(() => {
        if (!volcanoRef.current || !cmpData?.peptides || activePanel !== 'volcano') return;
        const peps = cmpData.peptides;

        const byStatus = {
          known:        peps.filter(p => p.status === 'known'),
          novel_shared: peps.filter(p => p.status === 'novel_shared'),
          novel_A:      peps.filter(p => p.status === 'novel_A'),
          novel_B:      peps.filter(p => p.status === 'novel_B'),
        };

        const traces = Object.entries(byStatus).map(([status, pts]) => ({
          x: pts.map(p => p.log2fc),
          y: pts.map(p => Math.log10(Math.max(p.intensity_a, p.intensity_b) + 1)),
          text: pts.map(p => `${p.seq}<br>${p.protein}<br>log2FC: ${p.log2fc.toFixed(2)}<br>Status: ${_STATUS_LABEL[status]}`),
          type: 'scatter', mode: 'markers',
          name: _STATUS_LABEL[status],
          marker: {
            color: _IMMUNO_COLORS[status],
            size: status === 'known' ? 4 : 6,
            opacity: status === 'known' ? 0.3 : 0.75,
            line: { width: status === 'known' ? 0 : 0.5, color: '#fff' },
          },
          hovertemplate: '%{text}<extra></extra>',
        }));

        // Reference lines
        const shapes = [
          { type:'line', x0:-1, x1:-1, y0:0, y1:8, line:{color:'#475569', dash:'dot', width:1} },
          { type:'line', x0:1,  x1:1,  y0:0, y1:8, line:{color:'#475569', dash:'dot', width:1} },
        ];

        const layout = {
          paper_bgcolor:'transparent', plot_bgcolor:'#011a3a',
          font:{color:'#e2e8f0', size:11},
          margin:{l:58, r:16, t:40, b:52},
          height:400,
          title:{text:'Discovery Volcano — Fold Change A vs B', font:{size:13, color:'#DAAA00'}},
          xaxis:{
            title:{text:'log₂(Intensity A / Intensity B)', font:{size:11}},
            gridcolor:'#1e3a5f', color:'#a0b4cc', zeroline:true, zerolinecolor:'#3d5070',
          },
          yaxis:{
            title:{text:'log₁₀(max intensity)', font:{size:11}},
            gridcolor:'#1e3a5f', color:'#a0b4cc',
          },
          legend:{font:{size:10}, bgcolor:'transparent', orientation:'h', y:-0.18},
          hovermode:'closest',
          shapes,
          annotations:[
            {x:-2.5, y:7.5, text:'←  Higher in B', showarrow:false, font:{color:'#60a5fa', size:10}},
            {x:2.5,  y:7.5, text:'Higher in A  →', showarrow:false, font:{color:'#f472b6', size:10}},
          ],
        };

        Plotly.react(volcanoRef.current, traces, layout, {responsive:true, displayModeBar:false});
        return () => { if (volcanoRef.current && window.Plotly) Plotly.purge(volcanoRef.current); };
      }, [cmpData, activePanel]);

      // ── Discovery Atlas bar chart ─────────────────────────────────
      useEffect(() => {
        if (!atlasRef.current || !cmpData?.stats || activePanel !== 'atlas') return;
        const s = cmpData.stats;
        const total = s.n_total;
        const pct = v => total ? +(v / total * 100).toFixed(1) : 0;

        const traces = [
          {
            x: ['Known (atlas)', 'Novel — both runs', `Novel — ${runA?.run_name?.slice(0,20)} only`, `Novel — ${runB?.run_name?.slice(0,20)} only`],
            y: [pct(s.n_atlas_known), pct(s.n_novel_shared), pct(s.n_novel_a), pct(s.n_novel_b)],
            text: [s.n_atlas_known, s.n_novel_shared, s.n_novel_a, s.n_novel_b].map(v => String(v)),
            textposition: 'outside',
            type: 'bar',
            marker: {color: ['#64748b', '#DAAA00', '#f472b6', '#60a5fa']},
            hovertemplate: '%{x}<br>%{y:.1f}% (%{text} peptides)<extra></extra>',
          }
        ];

        const layout = {
          paper_bgcolor:'transparent', plot_bgcolor:'#011a3a',
          font:{color:'#e2e8f0', size:11},
          margin:{l:52, r:20, t:60, b:120},
          height:340,
          title:{text:'Peptide Discovery Atlas — Known vs Novel Classification', font:{size:13, color:'#DAAA00'}},
          yaxis:{title:{text:'% of total immunopeptidome', font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          xaxis:{color:'#a0b4cc', tickangle:-15},
        };

        Plotly.react(atlasRef.current, traces, layout, {responsive:true, displayModeBar:false});
        return () => { if (atlasRef.current && window.Plotly) Plotly.purge(atlasRef.current); };
      }, [cmpData, activePanel]);

      // ── 4D Ion Mobility fingerprint: novel vs known 1/K₀ distribution ──
      useEffect(() => {
        if (!mobilityRef.current || !cmpData?.peptides || activePanel !== 'mobility') return;
        const peps = cmpData.peptides.filter(p => p.im_a != null || p.im_b != null);
        if (!peps.length) { mobilityRef.current.innerHTML = '<div style="color:var(--muted);padding:2rem;text-align:center">No ion mobility data — requires timsTOF run</div>'; return; }

        const known  = peps.filter(p => p.status === 'known');
        const novel  = peps.filter(p => p.status !== 'known');

        const makeTrace = (pts, name, color, opacity) => ({
          x: pts.map(p => p.length),
          y: pts.map(p => p.im_a || p.im_b),
          text: pts.map(p => `${p.seq}<br>1/K₀: ${(p.im_a || p.im_b).toFixed(3)}<br>${_STATUS_LABEL[p.status]}`),
          type:'scatter', mode:'markers', name,
          marker:{color, size:5, opacity, line:{width:0}},
          hovertemplate:'%{text}<extra></extra>',
        });

        const traces = [
          makeTrace(known,  'Atlas known',  '#64748b', 0.25),
          makeTrace(novel,  'Novel peptides','#DAAA00', 0.8),
        ];

        const layout = {
          paper_bgcolor:'transparent', plot_bgcolor:'#011a3a',
          font:{color:'#e2e8f0', size:11},
          margin:{l:58, r:16, t:50, b:52},
          height:380,
          title:{text:'4D Ion Mobility Fingerprint — Novel vs Known MHC Peptides', font:{size:13, color:'#DAAA00'}},
          xaxis:{title:{text:'Peptide length (aa)', font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc', dtick:1},
          yaxis:{title:{text:'1/K₀ (V·s/cm²)', font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          legend:{font:{size:10}, bgcolor:'transparent'},
          hovermode:'closest',
          annotations:[{
            x:9, y:0.65, text:'MHC-I window', showarrow:false,
            font:{color:'#22d3ee', size:10},
            bgcolor:'#22d3ee20', bordercolor:'#22d3ee', borderwidth:1,
          }],
        };

        Plotly.react(mobilityRef.current, traces, layout, {responsive:true, displayModeBar:false});
        return () => { if (mobilityRef.current && window.Plotly) Plotly.purge(mobilityRef.current); };
      }, [cmpData, activePanel]);

      // ── Filtered table data ───────────────────────────────────────
      const tableData = useMemo(() => {
        if (!cmpData?.peptides) return [];
        let rows = cmpData.peptides;
        if (statusFilter !== 'all') rows = rows.filter(p => p.status === statusFilter);
        if (searchFilter) {
          const q = searchFilter.toUpperCase();
          rows = rows.filter(p => p.seq.includes(q) || (p.protein||'').toUpperCase().includes(q));
        }
        return rows;
      }, [cmpData, statusFilter, searchFilter]);

      // ── Stats cards ───────────────────────────────────────────────
      const statsCards = cmpData?.stats && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:'0.5rem', marginBottom:'1rem'}}>
          {[
            {label:'Run A peptides',   value: cmpData.stats.n_a,            color:'#f472b6'},
            {label:'Run B peptides',   value: cmpData.stats.n_b,            color:'#60a5fa'},
            {label:'Shared',           value: cmpData.stats.n_shared,       color:'#34d399'},
            {label:'Novel (both)',      value: cmpData.stats.n_novel_shared, color:'#DAAA00'},
            {label:'Novel (A only)',    value: cmpData.stats.n_novel_a,      color:'#f472b6'},
            {label:'Novel (B only)',    value: cmpData.stats.n_novel_b,      color:'#60a5fa'},
            {label:'Atlas-known',       value: cmpData.stats.n_atlas_known,  color:'#64748b'},
          ].map(({label, value, color}) => (
            <div key={label} style={{background:'var(--surface)', borderRadius:'0.5rem', padding:'0.6rem 0.75rem',
                                     borderLeft:`3px solid ${color}`}}>
              <div style={{fontSize:'0.7rem', color:'var(--muted)', marginBottom:'0.15rem'}}>{label}</div>
              <div style={{fontWeight:700, fontSize:'1.15rem', color}}>{value?.toLocaleString()}</div>
            </div>
          ))}
        </div>
      );

      // ── Run selector ──────────────────────────────────────────────
      const RunSelector = ({label, color, value, onChange}) => (
        <div style={{flex:1}}>
          <div style={{fontSize:'0.75rem', fontWeight:700, color, marginBottom:'0.3rem',
                       letterSpacing:'0.06em', textTransform:'uppercase'}}>
            {label}
          </div>
          <select
            value={value?.id || ''}
            onChange={e => {
              const r = searchedRuns.find(x => x.id === e.target.value);
              onChange(r || null);
            }}
            style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                    border:`1px solid ${color}60`, borderRadius:'0.4rem',
                    color:'var(--text)', fontSize:'0.8rem'}}
          >
            <option value="">— select run —</option>
            {searchedRuns.map(r => (
              <option key={r.id} value={r.id}>
                {r.run_name} ({r.n_proteins?.toLocaleString()} proteins)
              </option>
            ))}
          </select>
        </div>
      );

      const panelBtns = [
        {key:'volcano',  label:'🌋 Volcano',        title:'Fold Change vs Intensity'},
        {key:'atlas',    label:'📊 Discovery Atlas', title:'Known vs Novel Classification'},
        {key:'mobility', label:'📡 4D Fingerprint',  title:'Ion Mobility: Novel vs Known'},
        {key:'table',    label:'📋 Peptide Table',   title:'Full Peptide List'},
      ];

      // ── Science context card ──────────────────────────────────────
      const scienceCard = !runA && !runB && (
        <div className="card" style={{marginTop:'1rem', borderLeft:'3px solid #22d3ee'}}>
          <h3 style={{color:'#22d3ee', marginBottom:'0.5rem', fontSize:'0.92rem'}}>
            What gaps does this tool address?
          </h3>
          <div style={{fontSize:'0.8rem', color:'var(--muted)', lineHeight:'1.7'}}>
            <p style={{marginBottom:'0.5rem'}}>
              <strong style={{color:'var(--text)'}}>Most immunopeptidomics papers</strong> report presence/absence Venn diagrams.
              This tool adds <em>quantitative fold change</em> at the peptide level — identifying
              which HLA-presented peptides are <em>upregulated</em> in condition A vs B,
              not just present.
            </p>
            <p style={{marginBottom:'0.5rem'}}>
              <strong style={{color:'var(--text)'}}>Atlas-delta visualization</strong> classifies every peptide as
              atlas-known (seen before, gray) vs novel (gold/pink/blue). Novel + upregulated
              peptides are the most clinically interesting — potential neoantigens or
              disease-associated new presentations.
            </p>
            <p style={{marginBottom:'0.5rem'}}>
              <strong style={{color:'var(--text)'}}>4D Ion Mobility fingerprint</strong> — a timsTOF-specific advantage.
              Isobaric 9-mer peptides with identical m/z and RT but different sequences
              (e.g. Ile/Leu isomers, deamidated N→D) are separated by 1/K₀.
              This is largely unexplored in the immunopeptidomics literature.
            </p>
            <p>
              <strong style={{color:'var(--text)'}}>Novel directions often overlooked:</strong>{' '}
              Spliced peptides (proteasomal cis/trans splicing), cryptic ORF peptides,
              PTM-carrying MHC ligands (phospho, citrullination), and population-level
              immunopeptidome tracking across patient cohorts.
            </p>
          </div>
        </div>
      );

      return (
        <div>
          {/* Header */}
          <div style={{marginBottom:'1.2rem', display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem'}}>
            <div>
              <h2 style={{fontWeight:700, fontSize:'1.1rem', marginBottom:'0.2rem'}}>
                Immunopeptidomics Discovery
              </h2>
              <div style={{fontSize:'0.78rem', color:'var(--muted)'}}>
                Cross-run comparison · HLA atlas novelty · 4D separation · Fold change visualization
              </div>
            </div>
            <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
              <span style={{fontSize:'0.75rem', color:'var(--muted)'}}>MHC filter:</span>
              {[['0','All'], ['1','MHC-I'], ['2','MHC-II']].map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setMhcClass(+v)}
                  style={{
                    padding:'0.25rem 0.6rem', fontSize:'0.75rem',
                    background: mhcClass === +v ? 'var(--accent)' : 'var(--surface)',
                    color:      mhcClass === +v ? 'var(--bg)'     : 'var(--text)',
                    border:`1px solid ${mhcClass === +v ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius:'0.35rem', cursor:'pointer',
                  }}
                >{label}</button>
              ))}
            </div>
          </div>

          {/* Run A / B selectors */}
          <div className="card" style={{marginBottom:'1rem', padding:'0.75rem 1rem'}}>
            <div style={{display:'flex', gap:'1rem', flexWrap:'wrap', alignItems:'flex-end'}}>
              <RunSelector label="Run A (condition / patient 1)" color="#f472b6" value={runA} onChange={setRunA} />
              <div style={{display:'flex', alignItems:'center', paddingBottom:'0.3rem', color:'var(--muted)'}}>vs</div>
              <RunSelector label="Run B (condition / patient 2)" color="#60a5fa" value={runB} onChange={setRunB} />
              {runA && runB && runA.id !== runB.id && (
                <button
                  onClick={() => { const tmp = runA; setRunA(runB); setRunB(tmp); }}
                  style={{padding:'0.35rem 0.65rem', background:'var(--surface)',
                          border:'1px solid var(--border)', borderRadius:'0.4rem',
                          color:'var(--muted)', cursor:'pointer', fontSize:'0.8rem',
                          paddingBottom:'0.3rem'}}
                  title="Swap A and B"
                >⇄</button>
              )}
            </div>
            {runA && runB && runA.id === runB.id && (
              <div style={{marginTop:'0.5rem', fontSize:'0.8rem', color:'#fbbf24'}}>
                ⚠ Run A and Run B are the same — select two different runs
              </div>
            )}
          </div>

          {/* Loading / error */}
          {cmpLoading && (
            <div className="empty">Computing fold change and atlas novelty…</div>
          )}
          {cmpError && (
            <div style={{padding:'0.75rem', background:'rgba(239,68,68,0.1)',
                         border:'1px solid #ef4444', borderRadius:'0.4rem',
                         color:'#ef4444', fontSize:'0.82rem', marginBottom:'1rem'}}>
              {cmpError}
            </div>
          )}

          {/* Main content */}
          {cmpData && (
            <>
              {statsCards}

              {/* Panel switcher */}
              <div style={{display:'flex', gap:'0.4rem', marginBottom:'0.75rem', flexWrap:'wrap'}}>
                {panelBtns.map(({key, label, title}) => (
                  <button
                    key={key}
                    onClick={() => setActivePanel(key)}
                    title={title}
                    style={{
                      padding:'0.35rem 0.85rem', fontSize:'0.78rem',
                      background: activePanel === key ? 'var(--accent)' : 'var(--surface)',
                      color:      activePanel === key ? 'var(--bg)'     : 'var(--text)',
                      border:`1px solid ${activePanel === key ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius:'0.4rem', cursor:'pointer', fontWeight: activePanel === key ? 700 : 400,
                    }}
                  >{label}</button>
                ))}

                {/* Normalization badge */}
                <span style={{marginLeft:'auto', fontSize:'0.7rem', color:'var(--muted)',
                              alignSelf:'center', padding:'0.2rem 0.5rem',
                              background:'var(--surface)', borderRadius:'0.3rem',
                              border:'1px solid var(--border)'}}>
                  norm ratio: {cmpData.stats.median_norm_ratio?.toFixed(3)}
                  {!cmpData.stats.atlas_available && (
                    <span style={{color:'#fbbf24', marginLeft:'0.5rem'}}>
                      · HLA atlas offline
                    </span>
                  )}
                </span>
              </div>

              {/* Volcano */}
              {activePanel === 'volcano' && (
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.5rem', flexWrap:'wrap', gap:'0.4rem'}}>
                    <div style={{display:'flex', gap:'0.5rem', fontSize:'0.78rem', color:'var(--muted)', flexWrap:'wrap'}}>
                    <span>
                      <span style={{color:'#f472b6'}}>●</span> Novel Run-A-only ({cmpData.stats.n_novel_a})
                    </span>
                    <span>
                      <span style={{color:'#60a5fa'}}>●</span> Novel Run-B-only ({cmpData.stats.n_novel_b})
                    </span>
                    <span>
                      <span style={{color:'#DAAA00'}}>●</span> Novel shared ({cmpData.stats.n_novel_shared})
                    </span>
                    <span>
                      <span style={{color:'#64748b'}}>●</span> Atlas-known ({cmpData.stats.n_atlas_known})
                    </span>
                  </div>
                    <ExportBtn plotRef={volcanoRef} filename="immuno_discovery_volcano" />
                  </div>
                  <div ref={volcanoRef} />
                  <div style={{marginTop:'0.5rem', fontSize:'0.74rem', color:'var(--muted)', lineHeight:'1.5'}}>
                    Dashed lines at ±1 log₂FC (2× fold change). Peptides at extremes (|log₂FC| = 6.6)
                    are exclusive to one run (pseudo-count used for visualization).
                    Median-normalized using {cmpData.stats.n_shared} shared peptides.
                  </div>
                </div>
              )}

              {/* Atlas bar */}
              {activePanel === 'atlas' && (
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{display:'flex', justifyContent:'flex-end', marginBottom:'0.3rem'}}>
                    <ExportBtn plotRef={atlasRef} filename="immuno_discovery_atlas" />
                  </div>
                  <div ref={atlasRef} />
                  <div style={{marginTop:'0.75rem', fontSize:'0.78rem', color:'var(--muted)', lineHeight:'1.6'}}>
                    <strong style={{color:'var(--text)'}}>State of the field:</strong> Peptides classified against
                    the local HLA Ligand Atlas (download in the Immunopeptidomics tab).
                    Gold = novel to both runs — candidates for further validation.
                    Pink/blue = exclusive to one condition — upregulated presentation.{' '}
                    <strong style={{color:'var(--text)'}}>Novel + high intensity = highest clinical priority.</strong>
                    {!cmpData.stats.atlas_available && (
                      <span style={{color:'#fbbf24'}}>
                        {' '}HLA atlas not yet downloaded — all peptides shown as "novel".
                        Download it from the Immunopeptidomics tab to enable known/novel classification.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 4D mobility */}
              {activePanel === 'mobility' && (
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{display:'flex', justifyContent:'flex-end', marginBottom:'0.3rem'}}>
                    <ExportBtn plotRef={mobilityRef} filename="immuno_4d_fingerprint" />
                  </div>
                  <div ref={mobilityRef} />
                  <div style={{marginTop:'0.5rem', fontSize:'0.74rem', color:'var(--muted)', lineHeight:'1.5'}}>
                    <strong style={{color:'var(--text)'}}>Novel science:</strong> Ion mobility (1/K₀) separates
                    isobaric MHC-I peptides invisible to m/z alone — Ile/Leu isomers, deamidated N→D,
                    and different HLA allele-bound conformations. Each length class occupies a distinct
                    1/K₀ band. Novel peptides outside the expected band may represent post-translational
                    modifications or non-canonical binding modes.
                  </div>
                </div>
              )}

              {/* Peptide table */}
              {activePanel === 'table' && (
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{display:'flex', gap:'0.5rem', marginBottom:'0.75rem', flexWrap:'wrap', alignItems:'center'}}>
                    <input
                      type="text"
                      placeholder="Filter by sequence or protein…"
                      value={searchFilter}
                      onChange={e => setSearchFilter(e.target.value)}
                      style={{flex:1, minWidth:'160px', padding:'0.35rem 0.5rem',
                              background:'var(--bg)', border:'1px solid var(--border)',
                              borderRadius:'0.35rem', color:'var(--text)', fontSize:'0.8rem'}}
                    />
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      style={{padding:'0.35rem 0.5rem', background:'var(--bg)',
                              border:'1px solid var(--border)', borderRadius:'0.35rem',
                              color:'var(--text)', fontSize:'0.78rem'}}
                    >
                      <option value="all">All statuses</option>
                      <option value="novel_A">Novel — A only</option>
                      <option value="novel_B">Novel — B only</option>
                      <option value="novel_shared">Novel — both</option>
                      <option value="known">Atlas known</option>
                    </select>
                    <span style={{fontSize:'0.75rem', color:'var(--muted)'}}>
                      {tableData.length.toLocaleString()} peptides
                    </span>
                  </div>

                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.78rem'}}>
                      <thead>
                        <tr style={{borderBottom:'1px solid var(--border)'}}>
                          {['Status','Sequence','Length','log₂FC','Intensity A','Intensity B','1/K₀ A','Protein'].map(h => (
                            <th key={h} style={{textAlign:'left', padding:'0.3rem 0.5rem',
                                               color:'var(--muted)', fontWeight:600, fontSize:'0.72rem',
                                               whiteSpace:'nowrap'}}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.slice(0, showTop).map((p, i) => (
                          <tr key={p.seq + i} style={{borderBottom:'1px solid #1e3a5f20',
                                                       background: i % 2 === 0 ? 'transparent' : '#ffffff04'}}>
                            <td style={{padding:'0.25rem 0.5rem'}}>
                              <span style={{
                                display:'inline-block', padding:'0.1rem 0.45rem',
                                borderRadius:'0.9rem', fontSize:'0.68rem', fontWeight:600,
                                background: `${_IMMUNO_COLORS[p.status]}25`,
                                color: _IMMUNO_COLORS[p.status],
                                border: `1px solid ${_IMMUNO_COLORS[p.status]}50`,
                                whiteSpace:'nowrap',
                              }}>
                                {_STATUS_LABEL[p.status]}
                              </span>
                            </td>
                            <td style={{padding:'0.25rem 0.5rem', fontFamily:'monospace', letterSpacing:'0.05em',
                                         fontWeight:600, color: _IMMUNO_COLORS[p.status]}}>
                              {p.seq}
                            </td>
                            <td style={{padding:'0.25rem 0.5rem', color:'var(--muted)', textAlign:'center'}}>{p.length}</td>
                            <td style={{padding:'0.25rem 0.5rem', fontWeight:600, textAlign:'right',
                                         color: p.log2fc > 1 ? '#f472b6' : p.log2fc < -1 ? '#60a5fa' : 'var(--muted)'}}>
                              {p.log2fc > 5 ? '>5' : p.log2fc < -5 ? '<-5' : p.log2fc.toFixed(2)}
                            </td>
                            <td style={{padding:'0.25rem 0.5rem', textAlign:'right', color:'var(--text)'}}>
                              {p.intensity_a > 0 ? (p.intensity_a / 1e6).toFixed(1) + 'M' : '—'}
                            </td>
                            <td style={{padding:'0.25rem 0.5rem', textAlign:'right', color:'var(--text)'}}>
                              {p.intensity_b > 0 ? (p.intensity_b / 1e6).toFixed(1) + 'M' : '—'}
                            </td>
                            <td style={{padding:'0.25rem 0.5rem', textAlign:'right', color:'#22d3ee', fontFamily:'monospace'}}>
                              {p.im_a ? p.im_a.toFixed(3) : '—'}
                            </td>
                            <td style={{padding:'0.25rem 0.5rem', color:'var(--muted)', maxWidth:'180px',
                                         overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                              {p.protein || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {tableData.length > showTop && (
                    <div style={{textAlign:'center', marginTop:'0.5rem'}}>
                      <button
                        onClick={() => setShowTop(v => v + 100)}
                        style={{padding:'0.3rem 1rem', background:'var(--surface)',
                                border:'1px solid var(--border)', borderRadius:'0.4rem',
                                color:'var(--muted)', cursor:'pointer', fontSize:'0.78rem'}}
                      >
                        Show more ({tableData.length - showTop} remaining)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Empty state + science context */}
          {!runA && !runB && !cmpLoading && (
            <div className="empty">
              Select two runs to compare their immunopeptidomes
            </div>
          )}
          {scienceCard}
        </div>
      );
    }
