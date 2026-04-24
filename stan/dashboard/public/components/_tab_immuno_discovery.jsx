    /* ── HLA Discovery Tab ───────────────────────────────────────────────
     *
     * Four-panel experience transforming the 111-peptide HLA Ligand Atlas
     * from a lookup table into a full visual immunology workstation:
     *
     *   1. Atlas Explorer   — browse all canonical antigens: treemap ×
     *                         disease hierarchy, allele × protein heatmap,
     *                         per-peptide sequence with biochemical coloring
     *
     *   2. TIMS Corridor    — every atlas peptide plotted in 1/K₀ × m/z space.
     *                         First time canonical HLA ligands have been shown
     *                         in ion mobility space. MHC-I and MHC-II corridor
     *                         bands overlaid. Hover for allele, protein, disease.
     *
     *   3. Mission Debrief  — select a run: which canonical antigens did your
     *                         sample present? Disease coverage radar, hit/miss
     *                         tables, novelty stats, identification rate.
     *
     *   4. Compare Runs     — cross-run discovery volcano, fold change A vs B,
     *                         atlas novelty overlay, 4D fingerprint.
     *
     * APIs:
     *   GET /api/hla-atlas/browse
     *   GET /api/hla-atlas/run-match?run_id=X&mhc_class=N
     *   GET /api/immuno/compare?run_a=X&run_b=Y&mhc_class=N
     * ──────────────────────────────────────────────────────────────────── */

    // ── Amino acid biochemical class → color ──────────────────────────
    const _AA_COLOR = (() => {
      const hydrophobic  = '#DAAA00';  // gold
      const charged_pos  = '#22d3ee';  // cyan
      const charged_neg  = '#f87171';  // red
      const polar        = '#a855f7';  // violet
      const aromatic     = '#f59e0b';  // amber
      const special      = '#94a3b8';  // slate
      return {
        A: hydrophobic, V: hydrophobic, I: hydrophobic,
        L: hydrophobic, M: hydrophobic, F: aromatic,
        W: aromatic,    Y: aromatic,
        K: charged_pos, R: charged_pos, H: charged_pos,
        D: charged_neg, E: charged_neg,
        S: polar, T: polar, N: polar, Q: polar,
        C: special, G: special, P: special,
      };
    })();

    // Per-residue colored sequence renderer
    function AaSeq({ seq, style }) {
      if (!seq) return null;
      return (
        <span style={{fontFamily:'monospace', letterSpacing:'0.08em', fontWeight:700, ...style}}>
          {seq.split('').map((aa, i) => (
            <span key={i} style={{color: _AA_COLOR[aa] || '#94a3b8'}}>{aa}</span>
          ))}
        </span>
      );
    }

    // Disease category pill
    const _DISEASE_COLORS = {
      viral:       '#22d3ee',
      cancer:      '#f472b6',
      autoimmune:  '#a855f7',
      control:     '#94a3b8',
    };
    function DiseasePill({ cat }) {
      const c = _DISEASE_COLORS[cat] || '#94a3b8';
      return (
        <span style={{
          display:'inline-block', padding:'0.1rem 0.5rem',
          borderRadius:'0.9rem', fontSize:'0.68rem', fontWeight:700,
          background:`${c}20`, color:c, border:`1px solid ${c}50`,
          whiteSpace:'nowrap', textTransform:'capitalize',
        }}>{cat || 'control'}</span>
      );
    }

    // ── 1. Atlas Explorer ─────────────────────────────────────────────
    function AtlasExplorer({ peptides, matrix }) {
      const [view, setView]           = useState('treemap');   // treemap | heatmap | browser
      const [diseaseFilter, setDF]    = useState('all');
      const [searchQ, setSearchQ]     = useState('');
      const [sortBy, setSortBy]       = useState('obs');
      const treemapRef  = useRef(null);
      const heatmapRef  = useRef(null);

      const diseases = useMemo(() => {
        if (!peptides) return [];
        return [...new Set(peptides.map(p => p.disease_category))];
      }, [peptides]);

      const filtered = useMemo(() => {
        if (!peptides) return [];
        let rows = peptides;
        if (diseaseFilter !== 'all') rows = rows.filter(p => p.disease_category === diseaseFilter);
        if (searchQ) {
          const q = searchQ.toUpperCase();
          rows = rows.filter(p =>
            p.sequence.includes(q) ||
            (p.protein||'').toUpperCase().includes(q) ||
            (p.allele||'').toUpperCase().includes(q)
          );
        }
        if (sortBy === 'obs')    rows = [...rows].sort((a,b) => b.total_obs - a.total_obs);
        if (sortBy === 'length') rows = [...rows].sort((a,b) => a.length - b.length);
        if (sortBy === 'tissue') rows = [...rows].sort((a,b) => b.n_tissues - a.n_tissues);
        return rows;
      }, [peptides, diseaseFilter, searchQ, sortBy]);

      // Treemap
      useEffect(() => {
        if (!treemapRef.current || view !== 'treemap' || !peptides?.length) return;

        const labels = ['Atlas'], parents = [''], values = [0], colors = ['#1a0030'];
        const textArr = [''];

        // disease nodes
        const byDisease = {};
        peptides.forEach(p => {
          const d = p.disease_category || 'control';
          if (!byDisease[d]) byDisease[d] = {};
          if (!byDisease[d][p.protein]) byDisease[d][p.protein] = { obs: 0, peps: 0 };
          byDisease[d][p.protein].obs  += (p.total_obs || 1);
          byDisease[d][p.protein].peps += 1;
        });

        Object.entries(byDisease).forEach(([disease, proteins]) => {
          labels.push(disease);
          parents.push('Atlas');
          const total = Object.values(proteins).reduce((s,v) => s + v.obs, 0);
          values.push(total);
          colors.push(_DISEASE_COLORS[disease] || '#94a3b8');
          textArr.push(`${Object.keys(proteins).length} proteins`);

          Object.entries(proteins).forEach(([protein, stats]) => {
            labels.push(protein);
            parents.push(disease);
            values.push(stats.obs);
            colors.push(`${_DISEASE_COLORS[disease] || '#94a3b8'}88`);
            textArr.push(`${stats.peps} peptides · ${stats.obs} obs`);
          });
        });

        const trace = [{
          type:'treemap', branchvalues:'total',
          labels, parents, values, text: textArr,
          hovertemplate:'<b>%{label}</b><br>%{text}<br>Observations: %{value}<extra></extra>',
          marker:{ colors, line:{ width:1, color:'#1a0030' } },
          textinfo:'label+text',
          insidetextfont:{ color:'#fff', size:11 },
        }];

        Plotly.react(treemapRef.current, trace, {
          paper_bgcolor:'transparent', margin:{t:8,l:0,r:0,b:0}, height:380,
          font:{color:'#e2e8f0', size:11},
        }, {responsive:true, displayModeBar:false});
      }, [peptides, view]);

      // Allele × Protein heatmap
      useEffect(() => {
        if (!heatmapRef.current || view !== 'heatmap' || !matrix) return;
        const alleles  = matrix.alleles  || [];
        const proteins = matrix.proteins || [];
        const z        = matrix.z        || [];
        if (!alleles.length) return;

        Plotly.react(heatmapRef.current, [{
          type:'heatmap', z, x:proteins, y:alleles,
          colorscale:[[0,'#1a0030'],[0.33,'#3d1060'],[0.66,'#d946ef'],[1,'#DAAA00']],
          showscale:true, colorbar:{thickness:10, len:0.8, title:{text:'Peptides', font:{size:10}}},
          hovertemplate:'%{y} × %{x}<br>%{z} peptides<extra></extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'#0e0018',
          font:{color:'#e2e8f0', size:10},
          margin:{l:110, r:80, t:12, b:120},
          height:390,
          xaxis:{color:'#a0b4cc', tickangle:-40, tickfont:{size:9}},
          yaxis:{color:'#a0b4cc', tickfont:{size:9}},
        }, {responsive:true, displayModeBar:false});
      }, [matrix, view]);

      const filterBar = (
        <div style={{display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.75rem'}}>
          <input
            value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Filter sequence / protein / allele…"
            style={{flex:1, minWidth:'160px', padding:'0.35rem 0.5rem',
                    background:'var(--bg)', border:'1px solid var(--border)',
                    borderRadius:'0.35rem', color:'var(--text)', fontSize:'0.78rem'}}
          />
          <select value={diseaseFilter} onChange={e => setDF(e.target.value)}
            style={{padding:'0.35rem 0.5rem', background:'var(--bg)', border:'1px solid var(--border)',
                    borderRadius:'0.35rem', color:'var(--text)', fontSize:'0.78rem'}}>
            <option value="all">All diseases</option>
            {diseases.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {view === 'browser' && (
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              style={{padding:'0.35rem 0.5rem', background:'var(--bg)', border:'1px solid var(--border)',
                      borderRadius:'0.35rem', color:'var(--text)', fontSize:'0.78rem'}}>
              <option value="obs">Sort: observations</option>
              <option value="length">Sort: length</option>
              <option value="tissue">Sort: tissues</option>
            </select>
          )}
          <span style={{fontSize:'0.72rem', color:'var(--muted)'}}>{filtered.length} peptides</span>
        </div>
      );

      return (
        <div>
          {/* Sub-tabs */}
          <div style={{display:'flex', gap:'0.35rem', marginBottom:'0.75rem'}}>
            {[['treemap','🗺 Disease Map'],['heatmap','⬡ Allele Matrix'],['browser','📋 Peptide Browser']].map(([k,l]) => (
              <button key={k} onClick={() => setView(k)} style={{
                padding:'0.3rem 0.75rem', fontSize:'0.78rem', borderRadius:'0.35rem', cursor:'pointer',
                background: view===k ? 'var(--violet)' : 'var(--surface)',
                color:      view===k ? '#fff'          : 'var(--text)',
                border:`1px solid ${view===k ? 'var(--violet)' : 'var(--border)'}`,
                fontWeight: view===k ? 700 : 400,
              }}>{l}</button>
            ))}
          </div>

          {view === 'treemap' && (
            <div className="card" style={{padding:'0.75rem'}}>
              <div style={{fontSize:'0.75rem', color:'var(--muted)', marginBottom:'0.5rem'}}>
                111 canonical HLA ligands · 18 alleles · disease hierarchy
              </div>
              <div ref={treemapRef} />
              <div style={{display:'flex', gap:'1rem', flexWrap:'wrap', marginTop:'0.5rem'}}>
                {Object.entries(_DISEASE_COLORS).map(([d, c]) => (
                  <span key={d} style={{fontSize:'0.7rem', color:c}}>
                    ■ {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {view === 'heatmap' && (
            <div className="card" style={{padding:'0.75rem'}}>
              <div style={{fontSize:'0.75rem', color:'var(--muted)', marginBottom:'0.5rem'}}>
                Allele × protein co-occurrence — which alleles present which antigens
              </div>
              <div ref={heatmapRef} />
            </div>
          )}

          {view === 'browser' && (
            <div className="card" style={{padding:'0.75rem'}}>
              {filterBar}
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.78rem'}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--border)'}}>
                      {['Sequence','L','Disease','Protein','Allele','Obs','Tissues','m/z z=2','1/K₀ z=2'].map(h => (
                        <th key={h} style={{textAlign:'left', padding:'0.3rem 0.5rem',
                                           color:'var(--muted)', fontWeight:600, fontSize:'0.7rem',
                                           whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => {
                      const maxObs = Math.max(...filtered.map(x => x.total_obs || 1));
                      return (
                        <tr key={p.sequence + i} style={{borderBottom:'1px solid #1e3a5f18',
                                                          background: i%2===0 ? 'transparent' : '#ffffff04'}}>
                          <td style={{padding:'0.25rem 0.5rem'}}><AaSeq seq={p.sequence} /></td>
                          <td style={{padding:'0.25rem 0.5rem', color:'var(--muted)', textAlign:'center'}}>{p.length}</td>
                          <td style={{padding:'0.25rem 0.5rem'}}><DiseasePill cat={p.disease_category} /></td>
                          <td style={{padding:'0.25rem 0.5rem', color:'var(--text)', maxWidth:'150px',
                                       overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.protein}</td>
                          <td style={{padding:'0.25rem 0.5rem', color:'#DAAA00', fontFamily:'monospace', fontSize:'0.72rem'}}>{p.allele}</td>
                          <td style={{padding:'0.25rem 0.5rem'}}>
                            <div style={{display:'flex', alignItems:'center', gap:'0.4rem'}}>
                              <div style={{
                                width:`${Math.round((p.total_obs||1)/maxObs*60)}px`,
                                height:'6px', background:'#DAAA00',
                                borderRadius:'3px', minWidth:'2px'
                              }} />
                              <span style={{color:'#DAAA00', fontSize:'0.72rem'}}>{p.total_obs}</span>
                            </div>
                          </td>
                          <td style={{padding:'0.25rem 0.5rem', textAlign:'center', color:'#22d3ee'}}>{p.n_tissues}</td>
                          <td style={{padding:'0.25rem 0.5rem', fontFamily:'monospace', color:'#a0b4cc', textAlign:'right'}}>{p.mz_z2?.toFixed(3)}</td>
                          <td style={{padding:'0.25rem 0.5rem', fontFamily:'monospace', color:'#22d3ee', textAlign:'right'}}>{p.im_z2?.toFixed(4)}</td>
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

    // ── 2. TIMS Corridor ──────────────────────────────────────────────
    function AtlasTIMSCorridor({ peptides }) {
      const plotRef   = useRef(null);
      const [colorBy, setColorBy] = useState('disease');   // disease | mhc | length
      const [showMHC2, setShowMHC2] = useState(true);

      useEffect(() => {
        if (!plotRef.current || !peptides?.length) return;

        const colorFn = (p) => {
          if (colorBy === 'disease')  return _DISEASE_COLORS[p.disease_category] || '#94a3b8';
          if (colorBy === 'mhc')      return p.mhc_class === 2 ? '#a855f7' : '#22d3ee';
          // length — gradient gold→pink
          const t = Math.max(0, Math.min(1, (p.length - 8) / (22 - 8)));
          const r = Math.round(218 + (244-218)*t);
          const g = Math.round(170 + (114-170)*t);
          const b = Math.round(0   + (182-0  )*t);
          return `rgb(${r},${g},${b})`;
        };

        const mhc1 = peptides.filter(p => p.mhc_class !== 2);
        const mhc2 = showMHC2 ? peptides.filter(p => p.mhc_class === 2) : [];

        const makeTrace = (pts, name, symbol) => ({
          x: pts.map(p => p.mz_z2),
          y: pts.map(p => p.im_z2),
          text: pts.map(p =>
            `<b><span>${p.sequence}</span></b><br>` +
            `Allele: ${p.allele}<br>` +
            `Protein: ${p.protein}<br>` +
            `Disease: ${p.disease_category}<br>` +
            `m/z (z=2): ${p.mz_z2?.toFixed(3)} Th<br>` +
            `1/K₀ (z=2): ${p.im_z2?.toFixed(4)} V·s/cm²<br>` +
            `MHC-${p.mhc_class}  ·  ${p.length}-mer  ·  ${p.total_obs} obs`
          ),
          type:'scatter', mode:'markers', name,
          marker:{
            color: pts.map(p => colorFn(p)),
            size: pts.map(p => 6 + (p.total_obs || 1) * 0.08),
            symbol,
            opacity: 0.85,
            line:{width:0.5, color:'rgba(255,255,255,0.3)'},
          },
          hovertemplate:'%{text}<extra></extra>',
        });

        const traces = [
          makeTrace(mhc1, 'MHC-I peptides',  'circle'),
          ...(mhc2.length ? [makeTrace(mhc2, 'MHC-II peptides', 'diamond')] : []),
        ];

        // MHC-I corridor band ~0.60–0.85 Vs/cm²
        // MHC-II corridor band ~0.80–1.10 Vs/cm²
        const shapes = [
          {
            type:'rect', xref:'paper', yref:'y',
            x0:0, x1:1, y0:0.60, y1:0.85,
            fillcolor:'rgba(34,211,238,0.07)',
            line:{color:'#22d3ee', width:1, dash:'dot'},
            layer:'below',
          },
        ];
        const annotations = [
          {
            xref:'paper', yref:'y', x:0.01, y:0.725,
            text:'← MHC-I corridor<br>z=+1, 8–11 aa<br>1/K₀ ~0.60–0.85',
            showarrow:false, font:{color:'#22d3ee', size:9},
            align:'left', bgcolor:'rgba(14,0,24,0.7)',
          },
        ];
        if (showMHC2) {
          shapes.push({
            type:'rect', xref:'paper', yref:'y',
            x0:0, x1:1, y0:0.80, y1:1.10,
            fillcolor:'rgba(168,85,247,0.06)',
            line:{color:'#a855f7', width:1, dash:'dot'},
            layer:'below',
          });
          annotations.push({
            xref:'paper', yref:'y', x:0.01, y:0.95,
            text:'← MHC-II corridor<br>z=+2, 13–25 aa<br>1/K₀ ~0.80–1.10',
            showarrow:false, font:{color:'#a855f7', size:9},
            align:'left', bgcolor:'rgba(14,0,24,0.7)',
          });
        }

        Plotly.react(plotRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'#011a3a',
          font:{color:'#e2e8f0', size:11},
          margin:{l:66, r:16, t:24, b:58},
          height:420,
          xaxis:{
            title:{text:'m/z (Th, z=2)', font:{size:11}},
            gridcolor:'#1e3a5f', color:'#a0b4cc',
          },
          yaxis:{
            title:{text:'1/K₀ (V·s/cm²)', font:{size:11}},
            gridcolor:'#1e3a5f', color:'#a0b4cc',
            range:[0.45, showMHC2 ? 1.2 : 0.95],
          },
          legend:{bgcolor:'transparent', font:{size:10}},
          hovermode:'closest',
          shapes, annotations,
        }, {responsive:true, displayModeBar:false});
      }, [peptides, colorBy, showMHC2]);

      const scienceCards = [
        {
          icon:'⬡', color:'#22d3ee',
          title:'Why ion mobility for HLA?',
          body:'MHC-I peptides (8–11 aa, z=+1) cluster in a narrow 1/K₀ band (~0.60–0.85 V·s/cm²). ' +
               'Isobaric sequences with identical m/z — Ile/Leu swaps, deamidated N→D, different allele conformations — ' +
               'are resolved by 1/K₀. This is invisible to Orbitrap or Astral.',
        },
        {
          icon:'🧬', color:'#f472b6',
          title:'Canonical antigens in TIMS space',
          body:'This is the first time canonical HLA Ligand Atlas peptides have been shown in ion mobility space. ' +
               'Dot size scales with community observations. Hover any point for sequence, allele, protein, and disease context.',
        },
        {
          icon:'📡', color:'#a855f7',
          title:'MHC-II in TIMS',
          body:'MHC-II peptides (13–25 aa, z=+2) occupy a higher and wider 1/K₀ corridor (~0.80–1.10). ' +
               'Their longer length gives more extended conformations detectable by TIMS — though PASEF is optimized for z=+2 ions.',
        },
        {
          icon:'🎯', color:'#DAAA00',
          title:'Disease separation by corridor',
          body:'Color by disease to see whether viral antigens, cancer neoantigens, and autoimmune targets ' +
               'occupy distinct regions of ion mobility space — or overlap. Separation = potential 4D enrichment.',
        },
      ];

      return (
        <div>
          <div style={{display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'0.75rem', flexWrap:'wrap'}}>
            <span style={{fontSize:'0.75rem', color:'var(--muted)'}}>Color by:</span>
            {[['disease','Disease'],['mhc','MHC class'],['length','Length']].map(([v,l]) => (
              <button key={v} onClick={() => setColorBy(v)} style={{
                padding:'0.25rem 0.65rem', fontSize:'0.75rem', borderRadius:'0.35rem', cursor:'pointer',
                background: colorBy===v ? 'var(--accent)' : 'var(--surface)',
                color:      colorBy===v ? 'var(--bg)'     : 'var(--text)',
                border:`1px solid ${colorBy===v ? 'var(--accent)' : 'var(--border)'}`,
                fontWeight: colorBy===v ? 700 : 400,
              }}>{l}</button>
            ))}
            <label style={{marginLeft:'0.5rem', display:'flex', alignItems:'center', gap:'0.35rem',
                           fontSize:'0.75rem', color:'var(--muted)', cursor:'pointer'}}>
              <input type="checkbox" checked={showMHC2} onChange={e => setShowMHC2(e.target.checked)} />
              Show MHC-II
            </label>
            {colorBy === 'disease' && (
              <div style={{display:'flex', gap:'0.75rem', marginLeft:'auto', flexWrap:'wrap'}}>
                {Object.entries(_DISEASE_COLORS).map(([d, c]) => (
                  <span key={d} style={{fontSize:'0.69rem', color:c}}>■ {d}</span>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{padding:'0.75rem', marginBottom:'0.75rem'}}>
            <div ref={plotRef} />
          </div>

          {/* Science cards */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:'0.65rem'}}>
            {scienceCards.map(({icon, color, title, body}) => (
              <div key={title} className="card" style={{
                padding:'0.75rem 0.85rem',
                borderLeft:`3px solid ${color}`,
              }}>
                <div style={{fontWeight:700, fontSize:'0.82rem', color, marginBottom:'0.35rem'}}>
                  {icon} {title}
                </div>
                <div style={{fontSize:'0.74rem', color:'var(--muted)', lineHeight:'1.6'}}>{body}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ── 3. Mission Debrief ────────────────────────────────────────────
    function MissionDebrief({ allRuns }) {
      const [selectedRun, setSelectedRun] = useState(null);
      const [mhcClass, setMhcClass]        = useState(0);
      const [data, setData]                = useState(null);
      const [loading, setLoading]          = useState(false);
      const [error, setError]              = useState('');
      const radarRef  = useRef(null);
      const barRef    = useRef(null);

      const searchedRuns = useMemo(() =>
        Array.isArray(allRuns) ? allRuns.filter(r => r.n_proteins != null) : []
      , [allRuns]);

      useEffect(() => {
        if (!selectedRun) { setData(null); return; }
        setLoading(true); setError(''); setData(null);
        fetch(API + `/api/hla-atlas/run-match?run_id=${selectedRun.id}&mhc_class=${mhcClass}`)
          .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Error')))
          .then(d => { setData(d); setLoading(false); })
          .catch(e => { setError(String(e)); setLoading(false); });
      }, [selectedRun?.id, mhcClass]);

      // Radar chart — disease coverage %
      useEffect(() => {
        if (!radarRef.current || !data?.disease_stats) return;
        const ds   = data.disease_stats;
        const cats = Object.keys(ds);
        if (!cats.length) return;
        const pcts = cats.map(c => {
          const s = ds[c];
          return s.total ? +(s.found / s.total * 100).toFixed(1) : 0;
        });
        Plotly.react(radarRef.current, [{
          type:'scatterpolar', r:[...pcts, pcts[0]], theta:[...cats, cats[0]],
          fill:'toself', fillcolor:'rgba(218,170,0,0.15)',
          line:{color:'#DAAA00', width:2},
          marker:{color:'#DAAA00', size:7},
          hovertemplate:'%{theta}<br>%{r:.1f}% covered<extra></extra>',
          name:'Coverage',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          margin:{t:30, b:30, l:40, r:40}, height:240,
          polar:{
            bgcolor:'#011a3a',
            radialaxis:{visible:true, range:[0,100], color:'#475569',
                        tickfont:{size:9, color:'#64748b'}, ticksuffix:'%'},
            angularaxis:{color:'#475569', tickfont:{size:10, color:'#a0b4cc'}},
          },
          showlegend:false,
          font:{color:'#e2e8f0', size:10},
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // Stacked bar — hits vs misses per disease
      useEffect(() => {
        if (!barRef.current || !data?.disease_stats) return;
        const ds   = data.disease_stats;
        const cats = Object.keys(ds);
        Plotly.react(barRef.current, [
          {
            name:'Found', type:'bar', x:cats,
            y: cats.map(c => ds[c].found),
            marker:{color:'#DAAA00'},
            hovertemplate:'%{x}: %{y} found<extra></extra>',
          },
          {
            name:'Missed', type:'bar', x:cats,
            y: cats.map(c => (ds[c].total||0) - (ds[c].found||0)),
            marker:{color:'#1e3a5f'},
            hovertemplate:'%{x}: %{y} not detected<extra></extra>',
          },
        ], {
          barmode:'stack',
          paper_bgcolor:'transparent', plot_bgcolor:'#011a3a',
          font:{color:'#e2e8f0', size:11},
          margin:{l:40, r:10, t:10, b:60},
          height:200,
          xaxis:{color:'#a0b4cc', tickangle:-20},
          yaxis:{color:'#a0b4cc', gridcolor:'#1e3a5f', title:{text:'Peptides', font:{size:10}}},
          legend:{bgcolor:'transparent', font:{size:10}, orientation:'h', y:-0.35},
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      const statCards = data && [
        {label:'Atlas peptides',  value:data.n_atlas,      color:'#94a3b8'},
        {label:'Found in run',    value:data.n_found,      color:'#DAAA00'},
        {label:'Coverage',        value:`${data.coverage_pct?.toFixed(1)}%`, color:'#34d399'},
        {label:'Run peptidome',   value:data.n_run_total,  color:'#60a5fa'},
        {label:'Novel peptides',  value:data.n_novel,      color:'#f472b6'},
        {label:'Diseases hit',    value:data.n_diseases_hit, color:'#22d3ee'},
      ];

      return (
        <div>
          {/* Run selector + MHC filter */}
          <div className="card" style={{padding:'0.75rem 1rem', marginBottom:'0.75rem',
                                        display:'flex', gap:'1rem', flexWrap:'wrap', alignItems:'flex-end'}}>
            <div style={{flex:1, minWidth:'200px'}}>
              <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.25rem', textTransform:'uppercase', letterSpacing:'0.06em'}}>
                Select run
              </div>
              <select
                value={selectedRun?.id || ''}
                onChange={e => setSelectedRun(searchedRuns.find(r => r.id === e.target.value) || null)}
                style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                        border:'1px solid var(--accent)', borderRadius:'0.4rem',
                        color:'var(--text)', fontSize:'0.8rem'}}
              >
                <option value="">— select a searched run —</option>
                {searchedRuns.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.run_name} ({r.n_proteins?.toLocaleString()} prot)
                  </option>
                ))}
              </select>
            </div>
            <div style={{display:'flex', gap:'0.35rem'}}>
              {[['0','All'], ['1','MHC-I'], ['2','MHC-II']].map(([v,l]) => (
                <button key={v} onClick={() => setMhcClass(+v)} style={{
                  padding:'0.3rem 0.6rem', fontSize:'0.75rem', borderRadius:'0.35rem', cursor:'pointer',
                  background: mhcClass===+v ? 'var(--accent)' : 'var(--surface)',
                  color:      mhcClass===+v ? 'var(--bg)'     : 'var(--text)',
                  border:`1px solid ${mhcClass===+v ? 'var(--accent)' : 'var(--border)'}`,
                }}>{l}</button>
              ))}
            </div>
          </div>

          {loading && <div className="empty">Matching run against HLA atlas…</div>}
          {error   && (
            <div style={{padding:'0.75rem', background:'rgba(239,68,68,0.1)',
                         border:'1px solid #ef4444', borderRadius:'0.4rem',
                         color:'#ef4444', fontSize:'0.82rem', marginBottom:'1rem'}}>
              {error}
            </div>
          )}

          {data && (
            <>
              {/* Stats bar */}
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:'0.5rem', marginBottom:'0.75rem'}}>
                {statCards.map(({label, value, color}) => (
                  <div key={label} style={{background:'var(--surface)', borderRadius:'0.5rem',
                                           padding:'0.5rem 0.7rem', borderLeft:`3px solid ${color}`}}>
                    <div style={{fontSize:'0.68rem', color:'var(--muted)', marginBottom:'0.1rem'}}>{label}</div>
                    <div style={{fontWeight:700, fontSize:'1.1rem', color}}>{String(value)}</div>
                  </div>
                ))}
              </div>

              {/* Radar + bar side by side */}
              <div style={{display:'grid', gridTemplateColumns:'240px 1fr', gap:'0.75rem', marginBottom:'0.75rem'}}>
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.25rem', textAlign:'center'}}>
                    Disease coverage
                  </div>
                  <div ref={radarRef} />
                </div>
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.25rem'}}>
                    Hits per disease category
                  </div>
                  <div ref={barRef} />
                </div>
              </div>

              {/* Hit table */}
              <div className="card" style={{padding:'0.75rem', marginBottom:'0.65rem'}}>
                <div style={{fontWeight:700, fontSize:'0.82rem', color:'#34d399', marginBottom:'0.5rem'}}>
                  ✓ Detected canonical antigens ({data.n_found})
                </div>
                {data.hits?.length ? (
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.77rem'}}>
                      <thead>
                        <tr style={{borderBottom:'1px solid var(--border)'}}>
                          {['Sequence','Disease','Protein','Allele','Length','Intensity'].map(h => (
                            <th key={h} style={{textAlign:'left', padding:'0.25rem 0.5rem',
                                               color:'var(--muted)', fontWeight:600, fontSize:'0.7rem'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.hits.slice(0, 60).map((h, i) => (
                          <tr key={h.sequence+i} style={{borderBottom:'1px solid #1e3a5f18',
                                                          background:i%2===0?'transparent':'#ffffff04'}}>
                            <td style={{padding:'0.22rem 0.5rem'}}><AaSeq seq={h.sequence} /></td>
                            <td style={{padding:'0.22rem 0.5rem'}}><DiseasePill cat={h.disease_category} /></td>
                            <td style={{padding:'0.22rem 0.5rem', color:'var(--text)', maxWidth:'130px',
                                         overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{h.protein}</td>
                            <td style={{padding:'0.22rem 0.5rem', color:'#DAAA00', fontFamily:'monospace', fontSize:'0.7rem'}}>{h.allele}</td>
                            <td style={{padding:'0.22rem 0.5rem', textAlign:'center', color:'var(--muted)'}}>{h.length}</td>
                            <td style={{padding:'0.22rem 0.5rem', textAlign:'right', color:'#a0b4cc', fontFamily:'monospace', fontSize:'0.7rem'}}>
                              {h.intensity ? (h.intensity/1e6).toFixed(1)+'M' : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.hits.length > 60 && (
                      <div style={{fontSize:'0.72rem', color:'var(--muted)', textAlign:'center', padding:'0.4rem'}}>
                        +{data.hits.length - 60} more
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{color:'var(--muted)', fontSize:'0.78rem'}}>No canonical atlas peptides detected in this run.</div>
                )}
              </div>

              {/* Miss table */}
              <div className="card" style={{padding:'0.75rem'}}>
                <div style={{fontWeight:700, fontSize:'0.82rem', color:'#f87171', marginBottom:'0.5rem'}}>
                  ✗ Not detected ({(data.n_atlas||0) - (data.n_found||0)})
                </div>
                {data.misses?.length ? (
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.77rem'}}>
                      <thead>
                        <tr style={{borderBottom:'1px solid var(--border)'}}>
                          {['Sequence','Disease','Protein','Allele','Expected m/z','Expected 1/K₀'].map(h => (
                            <th key={h} style={{textAlign:'left', padding:'0.25rem 0.5rem',
                                               color:'var(--muted)', fontWeight:600, fontSize:'0.7rem'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.misses.slice(0, 40).map((m, i) => (
                          <tr key={m.sequence+i} style={{borderBottom:'1px solid #1e3a5f18',
                                                          background:i%2===0?'transparent':'#ffffff04',
                                                          opacity:0.6}}>
                            <td style={{padding:'0.22rem 0.5rem'}}><AaSeq seq={m.sequence} /></td>
                            <td style={{padding:'0.22rem 0.5rem'}}><DiseasePill cat={m.disease_category} /></td>
                            <td style={{padding:'0.22rem 0.5rem', color:'var(--muted)', maxWidth:'130px',
                                         overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{m.protein}</td>
                            <td style={{padding:'0.22rem 0.5rem', color:'#DAAA00', fontFamily:'monospace', fontSize:'0.7rem'}}>{m.allele}</td>
                            <td style={{padding:'0.22rem 0.5rem', textAlign:'right', color:'#a0b4cc', fontFamily:'monospace', fontSize:'0.7rem'}}>{m.mz_z2?.toFixed(3)}</td>
                            <td style={{padding:'0.22rem 0.5rem', textAlign:'right', color:'#22d3ee', fontFamily:'monospace', fontSize:'0.7rem'}}>{m.im_z2?.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.misses.length > 40 && (
                      <div style={{fontSize:'0.72rem', color:'var(--muted)', textAlign:'center', padding:'0.4rem'}}>
                        +{data.misses.length - 40} more
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{color:'#34d399', fontSize:'0.78rem', fontWeight:600}}>
                    All canonical atlas peptides detected!
                  </div>
                )}
              </div>
            </>
          )}

          {!selectedRun && !loading && (
            <div className="card" style={{marginTop:'0.75rem', borderLeft:'3px solid #22d3ee', padding:'0.85rem 1rem'}}>
              <div style={{fontWeight:700, fontSize:'0.85rem', color:'#22d3ee', marginBottom:'0.5rem'}}>
                Mission Debrief — what canonical antigens did your sample present?
              </div>
              <div style={{fontSize:'0.78rem', color:'var(--muted)', lineHeight:'1.7'}}>
                Select any searched run. ZIGGY will match your detected immunopeptides against all 111
                canonical antigens in the HLA Ligand Atlas — HIV, MART-1, NY-ESO-1, HER2, MBP, and more.
                You'll see coverage by disease category, which alleles presented what, and which canonical
                targets you detected vs missed.
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── 4. Compare Runs (original discovery volcano) ─────────────────
    const _IMMUNO_COLORS = {
      known:         '#64748b',
      novel_shared:  '#DAAA00',
      novel_A:       '#f472b6',
      novel_B:       '#60a5fa',
    };
    const _STATUS_LABEL = {
      known:        'Atlas known',
      novel_shared: 'Novel (both)',
      novel_A:      'Novel — Run A only',
      novel_B:      'Novel — Run B only',
    };

    function CompareRunsPanel({ allRuns }) {
      const [runA, setRunA]         = useState(null);
      const [runB, setRunB]         = useState(null);
      const [mhcClass, setMhcClass] = useState(0);
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

      const searchedRuns = useMemo(() =>
        Array.isArray(allRuns) ? allRuns.filter(r => r.n_proteins != null) : []
      , [allRuns]);

      useEffect(() => {
        if (!runA || !runB || runA.id === runB.id) { setCmpData(null); return; }
        setCmpLoading(true); setCmpError(''); setCmpData(null);
        fetch(API + `/api/immuno/compare?run_a=${runA.id}&run_b=${runB.id}&mhc_class=${mhcClass}`)
          .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Error')))
          .then(d => { setCmpData(d); setCmpLoading(false); })
          .catch(e => { setCmpError(String(e)); setCmpLoading(false); });
      }, [runA?.id, runB?.id, mhcClass]);

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
          text: pts.map(p => `${p.seq}<br>${p.protein||''}<br>log2FC: ${p.log2fc.toFixed(2)}<br>${_STATUS_LABEL[status]}`),
          type:'scatter', mode:'markers', name:_STATUS_LABEL[status],
          marker:{
            color:_IMMUNO_COLORS[status], size:status==='known'?4:6,
            opacity:status==='known'?0.3:0.75,
            line:{width:status==='known'?0:0.5, color:'#fff'},
          },
          hovertemplate:'%{text}<extra></extra>',
        }));
        Plotly.react(volcanoRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'#011a3a',
          font:{color:'#e2e8f0', size:11}, margin:{l:58, r:16, t:40, b:52}, height:400,
          title:{text:'Discovery Volcano — Fold Change A vs B', font:{size:13, color:'#DAAA00'}},
          xaxis:{title:{text:'log₂(Intensity A / Intensity B)', font:{size:11}},
                 gridcolor:'#1e3a5f', color:'#a0b4cc', zeroline:true, zerolinecolor:'#3d5070'},
          yaxis:{title:{text:'log₁₀(max intensity)', font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          legend:{font:{size:10}, bgcolor:'transparent', orientation:'h', y:-0.18},
          hovermode:'closest',
          shapes:[
            {type:'line',x0:-1,x1:-1,y0:0,y1:8,line:{color:'#475569',dash:'dot',width:1}},
            {type:'line',x0:1, x1:1, y0:0,y1:8,line:{color:'#475569',dash:'dot',width:1}},
          ],
          annotations:[
            {x:-2.5,y:7.5,text:'←  Higher in B',showarrow:false,font:{color:'#60a5fa',size:10}},
            {x:2.5, y:7.5,text:'Higher in A  →',showarrow:false,font:{color:'#f472b6',size:10}},
          ],
        }, {responsive:true, displayModeBar:false});
        return () => { if (volcanoRef.current && window.Plotly) Plotly.purge(volcanoRef.current); };
      }, [cmpData, activePanel]);

      useEffect(() => {
        if (!atlasRef.current || !cmpData?.stats || activePanel !== 'atlas') return;
        const s = cmpData.stats;
        const total = s.n_total;
        const pct = v => total ? +(v/total*100).toFixed(1) : 0;
        Plotly.react(atlasRef.current, [{
          x:['Known (atlas)','Novel — both runs',`Novel — ${runA?.run_name?.slice(0,18)} only`,`Novel — ${runB?.run_name?.slice(0,18)} only`],
          y:[pct(s.n_atlas_known), pct(s.n_novel_shared), pct(s.n_novel_a), pct(s.n_novel_b)],
          text:[s.n_atlas_known, s.n_novel_shared, s.n_novel_a, s.n_novel_b].map(String),
          textposition:'outside', type:'bar',
          marker:{color:['#64748b','#DAAA00','#f472b6','#60a5fa']},
          hovertemplate:'%{x}<br>%{y:.1f}% (%{text} peptides)<extra></extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'#011a3a',
          font:{color:'#e2e8f0', size:11}, margin:{l:52, r:20, t:60, b:120}, height:340,
          title:{text:'Peptide Discovery Atlas — Known vs Novel Classification', font:{size:13, color:'#DAAA00'}},
          yaxis:{title:{text:'% of total immunopeptidome', font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          xaxis:{color:'#a0b4cc', tickangle:-15},
        }, {responsive:true, displayModeBar:false});
        return () => { if (atlasRef.current && window.Plotly) Plotly.purge(atlasRef.current); };
      }, [cmpData, activePanel]);

      useEffect(() => {
        if (!mobilityRef.current || !cmpData?.peptides || activePanel !== 'mobility') return;
        const peps = cmpData.peptides.filter(p => p.im_a != null || p.im_b != null);
        if (!peps.length) {
          mobilityRef.current.innerHTML = '<div style="color:var(--muted);padding:2rem;text-align:center">No ion mobility data — requires timsTOF run</div>';
          return;
        }
        const known = peps.filter(p => p.status === 'known');
        const novel = peps.filter(p => p.status !== 'known');
        const mkTrace = (pts, name, color, opacity) => ({
          x: pts.map(p => p.length),
          y: pts.map(p => p.im_a || p.im_b),
          text: pts.map(p => `${p.seq}<br>1/K₀: ${(p.im_a||p.im_b).toFixed(3)}<br>${_STATUS_LABEL[p.status]}`),
          type:'scatter', mode:'markers', name,
          marker:{color, size:5, opacity, line:{width:0}},
          hovertemplate:'%{text}<extra></extra>',
        });
        Plotly.react(mobilityRef.current, [mkTrace(known,'Atlas known','#64748b',0.25), mkTrace(novel,'Novel peptides','#DAAA00',0.8)], {
          paper_bgcolor:'transparent', plot_bgcolor:'#011a3a',
          font:{color:'#e2e8f0', size:11}, margin:{l:58, r:16, t:50, b:52}, height:380,
          title:{text:'4D Ion Mobility — Novel vs Known MHC Peptides', font:{size:13, color:'#DAAA00'}},
          xaxis:{title:{text:'Peptide length (aa)', font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc', dtick:1},
          yaxis:{title:{text:'1/K₀ (V·s/cm²)', font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          legend:{font:{size:10}, bgcolor:'transparent'}, hovermode:'closest',
        }, {responsive:true, displayModeBar:false});
        return () => { if (mobilityRef.current && window.Plotly) Plotly.purge(mobilityRef.current); };
      }, [cmpData, activePanel]);

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

      const RunSel = ({label, color, value, onChange}) => (
        <div style={{flex:1}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color, marginBottom:'0.25rem',
                       letterSpacing:'0.06em', textTransform:'uppercase'}}>{label}</div>
          <select value={value?.id||''} onChange={e => onChange(searchedRuns.find(r=>r.id===e.target.value)||null)}
            style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                    border:`1px solid ${color}60`, borderRadius:'0.4rem',
                    color:'var(--text)', fontSize:'0.8rem'}}>
            <option value="">— select run —</option>
            {searchedRuns.map(r => <option key={r.id} value={r.id}>{r.run_name} ({r.n_proteins?.toLocaleString()} prot)</option>)}
          </select>
        </div>
      );

      return (
        <div>
          <div className="card" style={{marginBottom:'1rem', padding:'0.75rem 1rem'}}>
            <div style={{display:'flex', gap:'1rem', flexWrap:'wrap', alignItems:'flex-end'}}>
              <RunSel label="Run A (condition 1)" color="#f472b6" value={runA} onChange={setRunA} />
              <div style={{alignSelf:'flex-end', color:'var(--muted)', paddingBottom:'0.4rem'}}>vs</div>
              <RunSel label="Run B (condition 2)" color="#60a5fa" value={runB} onChange={setRunB} />
              {runA && runB && runA.id !== runB.id && (
                <button onClick={() => { const t=runA; setRunA(runB); setRunB(t); }}
                  style={{padding:'0.35rem 0.65rem', background:'var(--surface)',
                          border:'1px solid var(--border)', borderRadius:'0.4rem',
                          color:'var(--muted)', cursor:'pointer', fontSize:'0.8rem',
                          alignSelf:'flex-end'}} title="Swap A and B">⇄</button>
              )}
              <div style={{display:'flex', gap:'0.35rem', alignSelf:'flex-end'}}>
                {[['0','All'],['1','MHC-I'],['2','MHC-II']].map(([v,l]) => (
                  <button key={v} onClick={() => setMhcClass(+v)} style={{
                    padding:'0.28rem 0.55rem', fontSize:'0.73rem', borderRadius:'0.35rem', cursor:'pointer',
                    background:mhcClass===+v?'var(--accent)':'var(--surface)',
                    color:mhcClass===+v?'var(--bg)':'var(--text)',
                    border:`1px solid ${mhcClass===+v?'var(--accent)':'var(--border)'}`,
                  }}>{l}</button>
                ))}
              </div>
            </div>
            {runA && runB && runA.id === runB.id && (
              <div style={{marginTop:'0.5rem', fontSize:'0.8rem', color:'#fbbf24'}}>
                ⚠ Same run selected — choose two different runs
              </div>
            )}
          </div>

          {cmpLoading && <div className="empty">Computing fold change and atlas novelty…</div>}
          {cmpError  && (
            <div style={{padding:'0.75rem', background:'rgba(239,68,68,0.1)', border:'1px solid #ef4444',
                         borderRadius:'0.4rem', color:'#ef4444', fontSize:'0.82rem', marginBottom:'1rem'}}>
              {cmpError}
            </div>
          )}

          {cmpData && (
            <>
              {/* Stats */}
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:'0.5rem', marginBottom:'0.75rem'}}>
                {[
                  {label:'Run A peptides',   value:cmpData.stats.n_a,           color:'#f472b6'},
                  {label:'Run B peptides',   value:cmpData.stats.n_b,           color:'#60a5fa'},
                  {label:'Shared',           value:cmpData.stats.n_shared,      color:'#34d399'},
                  {label:'Novel (both)',      value:cmpData.stats.n_novel_shared,color:'#DAAA00'},
                  {label:'Novel (A only)',    value:cmpData.stats.n_novel_a,     color:'#f472b6'},
                  {label:'Novel (B only)',    value:cmpData.stats.n_novel_b,     color:'#60a5fa'},
                  {label:'Atlas-known',       value:cmpData.stats.n_atlas_known, color:'#64748b'},
                ].map(({label, value, color}) => (
                  <div key={label} style={{background:'var(--surface)', borderRadius:'0.5rem',
                                           padding:'0.5rem 0.7rem', borderLeft:`3px solid ${color}`}}>
                    <div style={{fontSize:'0.68rem', color:'var(--muted)'}}>{label}</div>
                    <div style={{fontWeight:700, fontSize:'1.05rem', color}}>{value?.toLocaleString()}</div>
                  </div>
                ))}
              </div>

              {/* Sub-panel switcher */}
              <div style={{display:'flex', gap:'0.4rem', marginBottom:'0.75rem', flexWrap:'wrap', alignItems:'center'}}>
                {[['volcano','🌋 Volcano'],['atlas','📊 Discovery Atlas'],['mobility','📡 4D Fingerprint'],['table','📋 Table']].map(([k,l]) => (
                  <button key={k} onClick={() => setActivePanel(k)} style={{
                    padding:'0.3rem 0.75rem', fontSize:'0.77rem', borderRadius:'0.35rem', cursor:'pointer',
                    background:activePanel===k?'var(--accent)':'var(--surface)',
                    color:activePanel===k?'var(--bg)':'var(--text)',
                    border:`1px solid ${activePanel===k?'var(--accent)':'var(--border)'}`,
                    fontWeight:activePanel===k?700:400,
                  }}>{l}</button>
                ))}
                <span style={{marginLeft:'auto', fontSize:'0.7rem', color:'var(--muted)',
                              padding:'0.2rem 0.5rem', background:'var(--surface)',
                              borderRadius:'0.3rem', border:'1px solid var(--border)'}}>
                  norm ratio: {cmpData.stats.median_norm_ratio?.toFixed(3)}
                  {!cmpData.stats.atlas_available && <span style={{color:'#fbbf24',marginLeft:'0.4rem'}}>· HLA atlas offline</span>}
                </span>
              </div>

              {activePanel === 'volcano' && (
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{display:'flex', justifyContent:'flex-end', marginBottom:'0.4rem'}}>
                    <ExportBtn plotRef={volcanoRef} filename="immuno_volcano" />
                  </div>
                  <div ref={volcanoRef} />
                </div>
              )}
              {activePanel === 'atlas' && (
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{display:'flex', justifyContent:'flex-end', marginBottom:'0.3rem'}}>
                    <ExportBtn plotRef={atlasRef} filename="immuno_atlas" />
                  </div>
                  <div ref={atlasRef} />
                </div>
              )}
              {activePanel === 'mobility' && (
                <div className="card" style={{padding:'0.75rem'}}>
                  <div ref={mobilityRef} />
                </div>
              )}
              {activePanel === 'table' && (
                <div className="card" style={{padding:'0.75rem'}}>
                  <div style={{display:'flex', gap:'0.5rem', marginBottom:'0.75rem', flexWrap:'wrap', alignItems:'center'}}>
                    <input type="text" placeholder="Filter sequence / protein…" value={searchFilter}
                      onChange={e => setSearchFilter(e.target.value)}
                      style={{flex:1, minWidth:'150px', padding:'0.35rem 0.5rem', background:'var(--bg)',
                              border:'1px solid var(--border)', borderRadius:'0.35rem', color:'var(--text)', fontSize:'0.78rem'}} />
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                      style={{padding:'0.35rem 0.5rem', background:'var(--bg)', border:'1px solid var(--border)',
                              borderRadius:'0.35rem', color:'var(--text)', fontSize:'0.77rem'}}>
                      <option value="all">All statuses</option>
                      <option value="novel_A">Novel — A only</option>
                      <option value="novel_B">Novel — B only</option>
                      <option value="novel_shared">Novel — both</option>
                      <option value="known">Atlas known</option>
                    </select>
                    <span style={{fontSize:'0.74rem', color:'var(--muted)'}}>{tableData.length.toLocaleString()} peptides</span>
                  </div>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.77rem'}}>
                      <thead>
                        <tr style={{borderBottom:'1px solid var(--border)'}}>
                          {['Status','Sequence','L','log₂FC','Int A','Int B','1/K₀','Protein'].map(h => (
                            <th key={h} style={{textAlign:'left', padding:'0.28rem 0.5rem',
                                               color:'var(--muted)', fontWeight:600, fontSize:'0.7rem', whiteSpace:'nowrap'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.slice(0, showTop).map((p, i) => (
                          <tr key={p.seq+i} style={{borderBottom:'1px solid #1e3a5f18',
                                                     background:i%2===0?'transparent':'#ffffff04'}}>
                            <td style={{padding:'0.22rem 0.5rem'}}>
                              <span style={{display:'inline-block', padding:'0.08rem 0.4rem', borderRadius:'0.9rem',
                                            fontSize:'0.67rem', fontWeight:600,
                                            background:`${_IMMUNO_COLORS[p.status]}22`,
                                            color:_IMMUNO_COLORS[p.status],
                                            border:`1px solid ${_IMMUNO_COLORS[p.status]}50`,
                                            whiteSpace:'nowrap'}}>
                                {_STATUS_LABEL[p.status]}
                              </span>
                            </td>
                            <td style={{padding:'0.22rem 0.5rem'}}><AaSeq seq={p.seq} /></td>
                            <td style={{padding:'0.22rem 0.5rem', color:'var(--muted)', textAlign:'center'}}>{p.length}</td>
                            <td style={{padding:'0.22rem 0.5rem', fontWeight:600, textAlign:'right',
                                         color:p.log2fc>1?'#f472b6':p.log2fc<-1?'#60a5fa':'var(--muted)'}}>
                              {p.log2fc>5?'>5':p.log2fc<-5?'<-5':p.log2fc.toFixed(2)}
                            </td>
                            <td style={{padding:'0.22rem 0.5rem', textAlign:'right', color:'var(--text)'}}>
                              {p.intensity_a>0?(p.intensity_a/1e6).toFixed(1)+'M':'—'}
                            </td>
                            <td style={{padding:'0.22rem 0.5rem', textAlign:'right', color:'var(--text)'}}>
                              {p.intensity_b>0?(p.intensity_b/1e6).toFixed(1)+'M':'—'}
                            </td>
                            <td style={{padding:'0.22rem 0.5rem', textAlign:'right', color:'#22d3ee', fontFamily:'monospace'}}>
                              {p.im_a?p.im_a.toFixed(3):'—'}
                            </td>
                            <td style={{padding:'0.22rem 0.5rem', color:'var(--muted)', maxWidth:'160px',
                                         overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                              {p.protein||'—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {tableData.length > showTop && (
                    <div style={{textAlign:'center', marginTop:'0.5rem'}}>
                      <button onClick={() => setShowTop(v => v+100)}
                        style={{padding:'0.3rem 1rem', background:'var(--surface)',
                                border:'1px solid var(--border)', borderRadius:'0.4rem',
                                color:'var(--muted)', cursor:'pointer', fontSize:'0.77rem'}}>
                        Show more ({tableData.length - showTop} remaining)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!runA && !runB && !cmpLoading && (
            <div className="card" style={{marginTop:'0.75rem', borderLeft:'3px solid #22d3ee', padding:'0.85rem 1rem'}}>
              <div style={{fontWeight:700, fontSize:'0.85rem', color:'#22d3ee', marginBottom:'0.4rem'}}>
                Discovery Volcano — fold change + novelty
              </div>
              <div style={{fontSize:'0.78rem', color:'var(--muted)', lineHeight:'1.7'}}>
                Select two immunopeptidomics runs to compare their peptidomes.
                Each peptide is classified as atlas-known (gray) or novel (gold/pink/blue),
                with log₂ fold change on x-axis. Novel + upregulated = highest clinical priority.
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── Main: ImmunoDiscoveryTab ──────────────────────────────────────
    function ImmunoDiscoveryTab() {
      const { data: allRuns } = useFetch('/api/runs?limit=1000');
      const { data: atlasData, loading: atlasLoading } = useFetch('/api/hla-atlas/browse');
      const [activeTab, setActiveTab] = useState('explorer');

      const peptides = atlasData?.peptides || [];
      const matrix   = atlasData?.matrix   || null;
      const available = atlasData?.available !== false;

      const tabs = [
        {key:'explorer', icon:'🗺', label:'Atlas Explorer',  subtitle:'111 canonical HLA ligands · disease map · allele matrix · browser'},
        {key:'corridor', icon:'📡', label:'TIMS Corridor',   subtitle:'All atlas peptides in 1/K₀ × m/z space · MHC-I/II corridor bands'},
        {key:'debrief',  icon:'🎯', label:'Mission Debrief', subtitle:'Which canonical antigens did your run detect? · disease coverage radar'},
        {key:'compare',  icon:'🌋', label:'Compare Runs',    subtitle:'Discovery volcano · A vs B fold change · 4D fingerprint · novelty table'},
      ];

      return (
        <div>
          {/* Header */}
          <div style={{marginBottom:'1rem', display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem'}}>
            <div>
              <h2 style={{fontWeight:700, fontSize:'1.1rem', marginBottom:'0.2rem'}}>HLA Discovery</h2>
              <div style={{fontSize:'0.77rem', color:'var(--muted)'}}>
                {available
                  ? `HLA Ligand Atlas · ${peptides.length} canonical antigens · 18 alleles · 4 disease categories`
                  : 'HLA atlas not downloaded — download it in the Immunopeptidomics tab to unlock full features'}
              </div>
            </div>
            {atlasLoading && (
              <div style={{fontSize:'0.75rem', color:'var(--muted)', display:'flex', alignItems:'center', gap:'0.4rem'}}>
                <span style={{width:'8px', height:'8px', borderRadius:'50%', background:'var(--accent)',
                              display:'inline-block', animation:'pulse 1.5s infinite'}} />
                Loading atlas…
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div style={{display:'flex', gap:'0.5rem', marginBottom:'1rem', flexWrap:'wrap',
                       borderBottom:'1px solid var(--border)', paddingBottom:'0.65rem'}}>
            {tabs.map(({key, icon, label, subtitle}) => (
              <button key={key} onClick={() => setActiveTab(key)} style={{
                padding:'0.5rem 0.85rem', fontSize:'0.8rem', borderRadius:'0.45rem', cursor:'pointer',
                background: activeTab===key ? 'var(--accent)' : 'var(--surface)',
                color:      activeTab===key ? 'var(--bg)'     : 'var(--text)',
                border:`1px solid ${activeTab===key ? 'var(--accent)' : 'var(--border)'}`,
                fontWeight: activeTab===key ? 700 : 400,
                display:'flex', flexDirection:'column', alignItems:'flex-start', gap:'0.15rem',
              }}>
                <span>{icon} {label}</span>
                <span style={{fontSize:'0.65rem', opacity:0.65, fontWeight:400, lineHeight:1.2,
                              color: activeTab===key ? 'inherit' : 'var(--muted)'}}>
                  {subtitle}
                </span>
              </button>
            ))}
          </div>

          {/* Atlas not available overlay */}
          {!available && activeTab !== 'compare' && (
            <div style={{padding:'1rem', background:'rgba(251,191,36,0.08)',
                         border:'1px solid #fbbf24', borderRadius:'0.5rem',
                         marginBottom:'0.75rem', fontSize:'0.8rem', color:'#fbbf24'}}>
              ⚠ HLA Ligand Atlas not yet downloaded. Go to the{' '}
              <strong>Immunopeptidomics</strong> tab → HLA Atlas panel to download it.
              The Compare Runs panel works without the atlas (all peptides shown as "novel").
            </div>
          )}

          {/* Panel content */}
          {activeTab === 'explorer' && available && peptides.length > 0 && (
            <AtlasExplorer peptides={peptides} matrix={matrix} />
          )}
          {activeTab === 'explorer' && available && peptides.length === 0 && !atlasLoading && (
            <div className="empty">Atlas loaded but no peptides returned — check server logs.</div>
          )}

          {activeTab === 'corridor' && available && peptides.length > 0 && (
            <AtlasTIMSCorridor peptides={peptides} />
          )}
          {activeTab === 'corridor' && available && peptides.length === 0 && !atlasLoading && (
            <div className="empty">No atlas peptides to plot.</div>
          )}

          {activeTab === 'debrief' && (
            <MissionDebrief allRuns={allRuns} />
          )}

          {activeTab === 'compare' && (
            <CompareRunsPanel allRuns={allRuns} />
          )}
        </div>
      );
    }
