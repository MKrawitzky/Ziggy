    /* ── Immunopeptidomics Tab ─────────────────────────────────────────── */

    function ImmunopeptidomicsTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [searchTerm, setSearchTerm] = useState('');
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(false);
      const [mhcClass, setMhcClass] = useState('all');   // 'all' | 'mhc1' | 'mhc2'
      const [chargeFilter, setChargeFilter] = useState('all');
      const [immunoWindowData, setImmunoWindowData] = useState(null);
      const [showImmunoWindowOverlay, setShowImmunoWindowOverlay] = useState(false);
      // View 3 — Raw MHC Ion Landscape (lazy-loaded on demand)
      const [landscape, setLandscape] = useState(null);
      const [landscapeLoading, setLandscapeLoading] = useState(false);
      const [showLandscape, setShowLandscape] = useState(false);
      const lenPlotRef    = useRef(null);
      const cloudRef      = useRef(null);
      const ridgeRef      = useRef(null);   // View 1: Length × Mobility Ridge
      const gravyRef      = useRef(null);   // View 2: GRAVY × Mobility
      const radarRef      = useRef(null);   // View 2b: Fingerprint Radar
      const landscapeRef  = useRef(null);   // View 3: Raw MHC Ion Landscape
      const motifRef      = useRef(null);   // Sequence Motif Heatmap
      const rtImRef       = useRef(null);   // New: RT × 1/K₀ 2D fingerprint
      const waterfallRef  = useRef(null);   // New: Dynamic range waterfall
      const lcHeatRef     = useRef(null);   // New: Length × Charge heatmap
      const [motifLen, setMotifLen] = useState('9');

      // ── HLA Atlas state ────────────────────────────────────────────────
      const [atlasStatus, setAtlasStatus] = useState(null);
      const [atlasCoverage, setAtlasCoverage] = useState(null);
      const [atlasDownloading, setAtlasDownloading] = useState(false);
      const [atlasSearchQ, setAtlasSearchQ] = useState('');
      const [atlasSearchResults, setAtlasSearchResults] = useState(null);
      const [atlasStandards, setAtlasStandards] = useState(null);
      const [showStandards, setShowStandards] = useState(false);

      useEffect(() => {
        fetch(API + '/api/hla-atlas/status').then(r => r.ok ? r.json() : null).then(setAtlasStatus).catch(() => {});
      }, []);

      // Poll download progress
      useEffect(() => {
        if (!atlasDownloading) return;
        const iv = setInterval(() => {
          fetch(API + '/api/hla-atlas/status').then(r => r.ok ? r.json() : null).then(s => {
            setAtlasStatus(s);
            if (s?.download_job?.status !== 'running') {
              setAtlasDownloading(false);
            }
          }).catch(() => {});
        }, 2000);
        return () => clearInterval(iv);
      }, [atlasDownloading]);

      // Fetch coverage when run + atlas both ready
      useEffect(() => {
        if (!selectedRun || !atlasStatus?.available) { setAtlasCoverage(null); return; }
        fetch(API + `/api/runs/${selectedRun.id}/hla-coverage`)
          .then(r => r.ok ? r.json() : null).then(setAtlasCoverage).catch(() => {});
      }, [selectedRun?.id, atlasStatus?.available]);

      const startAtlasSeed = () => {
        setAtlasDownloading(true);
        fetch(API + '/api/hla-atlas/seed', {method:'POST'}).catch(() => setAtlasDownloading(false));
      };
      const startAtlasDownload = () => {
        setAtlasDownloading(true);
        fetch(API + '/api/hla-atlas/download', {method:'POST'}).catch(() => setAtlasDownloading(false));
      };

      const doAtlasSearch = () => {
        if (!atlasSearchQ.trim()) return;
        fetch(API + `/api/hla-atlas/search?q=${encodeURIComponent(atlasSearchQ.trim())}&limit=100`)
          .then(r => r.ok ? r.json() : []).then(setAtlasSearchResults).catch(() => {});
      };

      const loadStandards = () => {
        if (atlasStandards) { setShowStandards(v => !v); return; }
        fetch(API + '/api/hla-atlas/standards?min_tissues=3&mhc_class=1&limit=80')
          .then(r => r.ok ? r.json() : []).then(s => { setAtlasStandards(s); setShowStandards(true); }).catch(() => {});
      };

      const WIN_PALETTE_I = ['#3b82f6','#22c55e','#f97316','#a855f7','#06b6d4','#f59e0b','#ec4899','#14b8a6'];
      const winColorI = (groupIdx) => WIN_PALETTE_I[groupIdx % WIN_PALETTE_I.length];

      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.result_path || (r.raw_path && r.raw_path.endsWith('.d')));
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
        if (!selectedRun) {
          setData(null); setImmunoWindowData(null); setShowImmunoWindowOverlay(false);
          setLandscape(null); setShowLandscape(false);
          return;
        }
        setLoading(true); setData(null); setImmunoWindowData(null);
        setShowImmunoWindowOverlay(false); setLandscape(null); setShowLandscape(false);
        Promise.all([
          fetch(API + `/api/runs/${selectedRun.id}/immunopeptidomics`).then(r => r.ok ? r.json() : {}),
          selectedRun.raw_path?.endsWith('.d')
            ? fetch(API + `/api/runs/${selectedRun.id}/dia-windows`).then(r => r.ok ? r.json() : {})
            : Promise.resolve({}),
        ]).then(([d, wins]) => {
          setData(Object.keys(d).length > 0 ? d : null);
          setImmunoWindowData(wins?.windows?.length > 0 ? wins : null);
          setLoading(false);
        }).catch(() => setLoading(false));
      }, [selectedRun?.id]);

      // Lazy-load raw ion landscape when user opens it
      useEffect(() => {
        if (!showLandscape || !selectedRun || landscape !== null) return;
        if (!selectedRun.raw_path?.endsWith('.d')) return;
        setLandscapeLoading(true);
        fetch(API + `/api/runs/${selectedRun.id}/immuno-landscape`)
          .then(r => r.ok ? r.json() : {})
          .then(d => { setLandscape(Object.keys(d).length > 0 ? d : null); setLandscapeLoading(false); })
          .catch(() => setLandscapeLoading(false));
      }, [showLandscape, selectedRun?.id]);

      // Length distribution bar chart
      useEffect(() => {
        if (!data?.length_dist || !lenPlotRef.current) return;
        const dist = data.length_dist;
        const allLens = Object.keys(dist).map(Number).sort((a,b)=>a-b);
        const mhc1Color = '#60a5fa', mhc2Color = '#a855f7', otherColor = '#4a6070';

        const colors = allLens.map(l =>
          (l >= 8 && l <= 14) ? mhc1Color :
          (l >= 13 && l <= 25) ? mhc2Color : otherColor
        );

        Plotly.react(lenPlotRef.current, [{
          type: 'bar',
          x: allLens,
          y: allLens.map(l => dist[l] || 0),
          marker: { color: colors },
          hovertemplate: 'Length %{x}aa: %{y} peptides<extra></extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font: {color:'#94a3b8', size:11},
          margin: {l:50,r:10,t:30,b:40},
          xaxis: {title:{text:'Peptide Length (aa)',font:{size:11}}, gridcolor:'#1e3a5f',
            tickmode:'linear', dtick:1, range:[5.5, Math.min(31, Math.max(...allLens)+1.5)]},
          yaxis: {title:{text:'Precursors @ 1% FDR',font:{size:11}}, gridcolor:'#1e3a5f'},
          shapes: [
            {type:'rect', x0:7.5, x1:14.5, y0:0, y1:1, yref:'paper', fillcolor:'rgba(96,165,250,0.06)', line:{width:0}},
            {type:'rect', x0:12.5, x1:25.5, y0:0, y1:1, yref:'paper', fillcolor:'rgba(168,85,247,0.06)', line:{width:0}},
          ],
          annotations: [
            {x:11, y:1.04, xref:'x', yref:'paper', text:'MHC-I (8-14aa)', showarrow:false, font:{color:'#60a5fa',size:10}},
            {x:19, y:1.04, xref:'x', yref:'paper', text:'MHC-II (13-25aa)', showarrow:false, font:{color:'#a855f7',size:10}},
          ],
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // m/z vs 1/K₀ ion cloud (Tenzer-style) — with optional diaPASEF window overlay
      useEffect(() => {
        if (!data?.top_peptides || !cloudRef.current) return;
        const peps = data.top_peptides;
        const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
        const charges = [...new Set(peps.map(p => p.charge))].sort((a,b)=>a-b);
        const traces = charges.map(z => {
          const pts = peps.filter(p => p.charge === z);
          return {
            type: 'scatter',
            mode: 'markers',
            name: z === 1 ? 'z=+1 (MHC-I)' : `z=${z}`,
            x: pts.map(p => p.mz),
            y: pts.map(p => p.mobility),
            marker: {size: z === 1 ? 7 : 5, color:CHARGE_COLORS[z]||'#94a3b8', opacity: z === 1 ? 0.8 : 0.65},
            hovertemplate: `%{customdata}<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>z=${z}<extra></extra>`,
            customdata: pts.map(p => p.sequence),
          };
        });

        // diaPASEF window overlay shapes
        const shapes = [];
        if (showImmunoWindowOverlay && immunoWindowData?.windows?.length) {
          const groups = [...new Set(immunoWindowData.windows.map(w => w.window_group))];
          immunoWindowData.windows.forEach(ww => {
            if (ww.oneoverk0_lower <= 0) return;
            const col = winColorI(groups.indexOf(ww.window_group));
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            shapes.push({
              type:'rect',
              x0: ww.mz_lower, x1: ww.mz_upper,
              y0: ww.oneoverk0_lower, y1: ww.oneoverk0_upper,
              fillcolor: `rgba(${r},${g},${b},0.10)`,
              line: { color: `rgba(${r},${g},${b},0.70)`, width: 1.2 },
            });
          });
        }

        Plotly.react(cloudRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font: {color:'#94a3b8', size:11},
          margin: {l:55,r:15,t:10,b:45},
          xaxis: {title:{text:'m/z (Th)',font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          yaxis: {title:{text:'1/K₀ (Vs/cm²)',font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          legend: {bgcolor:'rgba(0,0,0,0.3)', bordercolor:'#1e3a5f', borderwidth:1, font:{size:10}},
          hoverlabel: {bgcolor:'#0d1e36', font:{size:11}},
          shapes,
        }, {responsive:true, displayModeBar:false});
      }, [data, showImmunoWindowOverlay, immunoWindowData]);

      // ── View 1: Length × Mobility Ridge ────────────────────────────────
      useEffect(() => {
        const agg = data?.length_mobility_agg;
        if (!agg || !ridgeRef.current) return;
        const lengths = Object.keys(agg).map(Number).filter(l => l >= 6 && l <= 26).sort((a,b) => a-b);
        if (lengths.length === 0) return;
        const MHC1_COLOR = '#60a5fa', MHC2_COLOR = '#a855f7', OTHER = '#4a6070';
        const boxColor = l => (l >= 8 && l <= 14) ? MHC1_COLOR : (l > 14 && l <= 25) ? MHC2_COLOR : OTHER;
        const traces = [{
          type: 'box',
          q1:         lengths.map(l => agg[l].q25_im ?? agg[l].median_im),
          median:     lengths.map(l => agg[l].median_im),
          q3:         lengths.map(l => agg[l].q75_im ?? agg[l].median_im),
          mean:       lengths.map(l => agg[l].mean_im),
          lowerfence: lengths.map(l => Math.max(0.4, (agg[l].mean_im||0) - 2*(agg[l].std_im||0))),
          upperfence: lengths.map(l => (agg[l].mean_im||0) + 2*(agg[l].std_im||0)),
          x:          lengths.map(String),
          marker:     { color: lengths.map(boxColor), size: 4 },
          line:       { color: '#1e3a5f' },
          boxmean:    true,
          name:       '1/K₀',
          hovertemplate: 'Length %{x}aa<br>Median: %{median:.4f}<br>IQR: %{q1:.4f}–%{q3:.4f}<br>n=%{customdata}<extra></extra>',
          customdata: lengths.map(l => agg[l].n),
        }];
        Plotly.react(ridgeRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font: {color:'#94a3b8', size:11},
          margin: {l:55,r:15,t:30,b:40},
          xaxis: {title:{text:'Peptide Length (aa)',font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          yaxis: {title:{text:'1/K₀ (Vs/cm²)',font:{size:11}}, gridcolor:'#1e3a5f', color:'#a0b4cc'},
          annotations: [
            {x:'11', y:1.06, xref:'x', yref:'paper', text:'MHC-I (8–14aa)', showarrow:false, font:{color:'#60a5fa',size:10}},
            {x:'19', y:1.06, xref:'x', yref:'paper', text:'MHC-II (13–25aa)', showarrow:false, font:{color:'#a855f7',size:10}},
          ],
          shapes: [
            {type:'rect',x0:'7.5',x1:'14.5',y0:0,y1:1,xref:'x',yref:'paper',fillcolor:'rgba(96,165,250,0.05)',line:{width:0}},
            {type:'rect',x0:'12.5',x1:'25.5',y0:0,y1:1,xref:'x',yref:'paper',fillcolor:'rgba(168,85,247,0.05)',line:{width:0}},
          ],
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // ── View 2: GRAVY × Mobility Landscape ─────────────────────────────
      useEffect(() => {
        const cloud = data?.gravy_cloud;
        if (!cloud?.length || !gravyRef.current) return;
        const LEN_COLORS = {
          7:'#475569', 8:'#3b82f6', 9:'#22c55e', 10:'#84cc16', 11:'#fbbf24',
          12:'#f97316', 13:'#ef4444', 14:'#e879f9', 15:'#a855f7',
        };
        const colorOf = l => LEN_COLORS[l] || (l >= 16 ? '#7c3aed' : '#475569');
        const byLen = {};
        for (const pt of cloud) {
          (byLen[pt.length] = byLen[pt.length] || []).push(pt);
        }
        const sortedLens = Object.keys(byLen).map(Number).sort((a,b)=>a-b);
        const traces = sortedLens.map(l => {
          const pts = byLen[l];
          return {
            type:'scatter', mode:'markers',
            name:`${l}aa`,
            x: pts.map(p => p.gravy),
            y: pts.map(p => p.im),
            marker:{size:5, color:colorOf(l), opacity:0.75},
            hovertemplate:`%{customdata}<br>GRAVY %{x:.3f}<br>1/K₀ %{y:.4f}<extra>${l}aa</extra>`,
            customdata: pts.map(p => p.seq),
          };
        });
        Plotly.react(gravyRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:15,t:20,b:45},
          xaxis:{title:{text:'GRAVY Score (Kyte-Doolittle)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc',zeroline:true,zerolinecolor:'#334155'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.3)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes:[{type:'line',x0:0,x1:0,y0:0,y1:1,yref:'paper',line:{color:'#334155',width:1,dash:'dot'}}],
          annotations:[
            {x:-2,y:1.06,xref:'x',yref:'paper',text:'← Hydrophilic',showarrow:false,font:{color:'#64748b',size:9}},
            {x:2,y:1.06,xref:'x',yref:'paper',text:'Hydrophobic →',showarrow:false,font:{color:'#64748b',size:9}},
          ],
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // ── View 2b: Immunopeptidome Fingerprint Radar ──────────────────────
      useEffect(() => {
        const r = data?.radar;
        if (!r || !radarRef.current) return;
        const mhc1Score  = Math.min(100, (r.pct_mhc1 || 0) * 100/80);
        const z1Score    = Math.min(100, (r.pct_z1 || 0) * 100/65);
        const ninerScore = Math.min(100, (r.pct_9mer_mhc1 || 0) * 100/40);
        const mobScore   = r.mobility_cv != null ? Math.max(0, 100 - r.mobility_cv * 8) : 0;
        const dynScore   = r.dyn_range_db != null ? Math.min(100, r.dyn_range_db * 100/60) : 0;
        const scores = [mhc1Score, z1Score, ninerScore, mobScore, dynScore, mhc1Score];
        const AXES = ['MHC-I purity','z=+1 fraction','9-mer dominance','Mobility focus','Dynamic range'];
        const HOVER = [
          `MHC-I purity: ${(r.pct_mhc1||0).toFixed(1)}% (ideal >80%)`,
          `z=+1 fraction: ${(r.pct_z1||0).toFixed(1)}% (ideal >65%)`,
          `9-mer of MHC-I: ${(r.pct_9mer_mhc1||0).toFixed(1)}% (ideal >40%)`,
          `Mobility CV: ${r.mobility_cv != null ? r.mobility_cv.toFixed(1)+'%' : 'N/A'} (lower=tighter)`,
          `Dynamic range: ${r.dyn_range_db != null ? r.dyn_range_db.toFixed(0)+'dB' : 'N/A'}`,
        ];
        Plotly.react(radarRef.current, [{
          type:'scatterpolar', fill:'toself',
          r: scores,
          theta: [...AXES, AXES[0]],
          fillcolor:'rgba(96,165,250,0.15)',
          line:{color:'#60a5fa',width:2},
          marker:{size:6, color:'#60a5fa'},
          name:'This run',
          hovertemplate:'%{customdata}<extra></extra>',
          customdata:[...HOVER, HOVER[0]],
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:10},
          margin:{l:30,r:30,t:30,b:30},
          polar:{
            bgcolor:'transparent',
            radialaxis:{visible:true,range:[0,100],color:'#334155',gridcolor:'#1e3a5f',tickfont:{size:9}},
            angularaxis:{color:'#4a6070',gridcolor:'#1e3a5f',linecolor:'#334155',tickfont:{size:10}},
          },
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // ── View 3: Raw MHC Ion Landscape ───────────────────────────────────
      useEffect(() => {
        if (!landscape || !landscapeRef.current) return;
        const {grid, mz_centers, im_centers, identified, n_frames_sampled} = landscape;
        const MHC_LEN_COLORS = {1:'#fbbf24',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7'};
        const traces = [
          {
            type:'heatmap',
            z: grid,
            x: mz_centers,
            y: im_centers,
            colorscale:[
              [0,'rgba(0,0,0,0)'],[0.01,'#0c0c20'],[0.15,'#1e3a5f'],
              [0.4,'#1d4ed8'],[0.65,'#7c3aed'],[0.85,'#ec4899'],[1,'#fde68a'],
            ],
            zmin:0, zmax:1, showscale:false,
            hovertemplate:'m/z %{x:.1f}<br>1/K₀ %{y:.3f}<br>Intensity (norm.) %{z:.3f}<extra>Raw ions</extra>',
          },
        ];
        if (identified?.length) {
          const byCharge = {};
          for (const p of identified) {
            (byCharge[p.charge] = byCharge[p.charge] || []).push(p);
          }
          for (const [z, pts] of Object.entries(byCharge).sort((a,b)=>+a[0]-+b[0])) {
            traces.push({
              type:'scatter', mode:'markers',
              name:`Identified z=+${z}`,
              x: pts.map(p => p.mz),
              y: pts.map(p => p.im),
              marker:{
                size: +z === 1 ? 7 : 5,
                color: MHC_LEN_COLORS[+z] || '#94a3b8',
                opacity: 0.85,
                line:{color:'rgba(0,0,0,0.4)',width:0.5},
              },
              hovertemplate:`%{customdata}<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra>z=+${z}</extra>`,
              customdata: pts.map(p => `${p.seq} (${p.length}aa)`),
            });
          }
        }
        Plotly.react(landscapeRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:20,t:15,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'rgba(30,58,95,0.4)',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'rgba(30,58,95,0.4)',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.4)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{
            x:0.02,y:0.98,xref:'paper',yref:'paper',showarrow:false,
            text:`${n_frames_sampled} MS1 frames · mid-run`,
            font:{size:9,color:'#4a6070'},xanchor:'left',yanchor:'top',
          }],
        }, {responsive:true, displayModeBar:false});
      }, [landscape]);

      // ── Sequence Motif Heatmap ──────────────────────────────────────────
      useEffect(() => {
        const mm = data?.motif_matrix?.[motifLen];
        if (!mm || !motifRef.current) return;
        const length = parseInt(motifLen);
        const positions = Array.from({length}, (_, i) => `P${i+1}`);
        const annotations = [];
        for (let pos = 0; pos < length; pos++) {
          let bestAA = '', bestFreq = 0;
          mm.aas.forEach((aa, ai) => {
            if (mm.freq[ai][pos] > bestFreq) { bestFreq = mm.freq[ai][pos]; bestAA = aa; }
          });
          if (bestFreq >= 0.20) {
            annotations.push({
              x: `P${pos+1}`, y: bestAA,
              text: bestAA, showarrow: false,
              font: {size: 11, color: '#fff', family: 'monospace'},
              xref: 'x', yref: 'y',
            });
          }
        }
        Plotly.react(motifRef.current, [{
          type: 'heatmap',
          z: mm.freq,
          x: positions,
          y: mm.aas,
          colorscale: [
            [0, 'rgba(13,30,54,0)'],
            [0.05, '#071224'],
            [0.25, '#0f3460'],
            [0.5, '#1d4ed8'],
            [0.75, '#7c3aed'],
            [0.9, '#ec4899'],
            [1.0, '#fde68a'],
          ],
          showscale: true,
          hovertemplate: '%{y} at %{x}: %{z:.1%}<extra></extra>',
          colorbar: {
            thickness: 12, len: 0.9,
            tickformat: '.0%',
            tickfont: {size: 9, color: '#94a3b8'},
            title: {text: 'Freq', side: 'right', font: {size: 9, color: '#94a3b8'}},
            bgcolor: 'transparent', bordercolor: '#1e3a5f',
          },
        }], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'rgba(7,18,36,0.6)',
          font: {color: '#94a3b8', size: 10},
          margin: {l: 38, r: 70, t: 20, b: 45},
          xaxis: {
            title: {text: 'Position', font: {size: 11}},
            gridcolor: 'rgba(30,58,95,0.3)', color: '#a0b4cc', tickfont: {size: 10},
          },
          yaxis: {
            color: '#a0b4cc', tickfont: {size: 10},
            gridcolor: 'rgba(30,58,95,0.3)', autorange: 'reversed',
          },
          annotations,
        }, {responsive: true, displayModeBar: false});
      }, [data, motifLen]);

      // ── RT × 1/K₀ 2D Fingerprint ─────────────────────────────────────────
      useEffect(() => {
        const peps = data?.top_peptides?.filter(p => p.mobility > 0 && p.rt > 0);
        if (!peps?.length || !rtImRef.current) return;
        const mhc1 = peps.filter(p => p.length >= 8 && p.length <= 14);
        const mhc2 = peps.filter(p => p.length > 14 && p.length <= 25);
        const other = peps.filter(p => p.length < 8 || p.length > 25);
        Plotly.react(rtImRef.current, [
          {
            type: 'histogram2dcontour',
            x: peps.map(p => p.rt),
            y: peps.map(p => p.mobility),
            colorscale: [
              [0,'rgba(0,0,0,0)'],[0.08,'#060e1e'],[0.2,'#0c1d3d'],
              [0.4,'#1e3a5f'],[0.6,'#1d4ed8'],[0.8,'#7c3aed'],[0.93,'#ec4899'],[1,'#fde68a'],
            ],
            ncontours: 18,
            showscale: false,
            contours: {coloring:'fill'},
            hoverinfo: 'skip',
            name: 'density',
          },
          other.length ? {
            type:'scatter', mode:'markers', name:'Other',
            x: other.map(p => p.rt), y: other.map(p => p.mobility),
            marker:{size:3, color:'#334155', opacity:0.5},
            hovertemplate:'%{customdata}<br>RT %{x:.2f} min<br>1/K₀ %{y:.4f}<extra>other</extra>',
            customdata: other.map(p => `${p.sequence} (${p.length}aa)`),
          } : null,
          mhc2.length ? {
            type:'scatter', mode:'markers', name:'MHC-II (>14aa)',
            x: mhc2.map(p => p.rt), y: mhc2.map(p => p.mobility),
            marker:{size:4, color:'#a855f7', opacity:0.65},
            hovertemplate:'%{customdata}<br>RT %{x:.2f} min<br>1/K₀ %{y:.4f}<extra>MHC-II</extra>',
            customdata: mhc2.map(p => `${p.sequence} (${p.length}aa)`),
          } : null,
          mhc1.length ? {
            type:'scatter', mode:'markers', name:'MHC-I (8–14aa)',
            x: mhc1.map(p => p.rt), y: mhc1.map(p => p.mobility),
            marker:{size:4, color:'#60a5fa', opacity:0.75},
            hovertemplate:'%{customdata}<br>RT %{x:.2f} min<br>1/K₀ %{y:.4f}<extra>MHC-I</extra>',
            customdata: mhc1.map(p => `${p.sequence} (${p.length}aa)`),
          } : null,
        ].filter(Boolean), {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8', size:11},
          margin:{l:55,r:15,t:20,b:45},
          xaxis:{title:{text:'Retention Time (min)',font:{size:11}},gridcolor:'rgba(30,58,95,0.4)',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'rgba(30,58,95,0.4)',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // ── Dynamic Range Waterfall ────────────────────────────────────────────
      useEffect(() => {
        const peps = data?.top_peptides?.filter(p => p.intensity > 0);
        if (!peps?.length || !waterfallRef.current) return;
        const sorted = [...peps].sort((a,b) => b.intensity - a.intensity);
        const logInt = sorted.map(p => Math.log10(p.intensity));
        const colors = sorted.map(p =>
          (p.length >= 8 && p.length <= 14) ? '#60a5fa' :
          (p.length > 14 && p.length <= 25) ? '#a855f7' : '#475569'
        );
        Plotly.react(waterfallRef.current, [{
          type:'bar', orientation:'v',
          x: sorted.map((_,i) => i+1),
          y: logInt,
          marker:{color:colors, opacity:0.8},
          hovertemplate:'Rank %{x}<br>%{customdata}<br>log₁₀ intensity: %{y:.2f}<extra></extra>',
          customdata: sorted.map(p => `${p.sequence} (${p.length}aa, z=+${p.charge})`),
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:15,t:20,b:45},
          xaxis:{title:{text:'Precursor Rank (by intensity)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'log₁₀ Intensity',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          bargap: 0,
          annotations:[{
            x:0.02,y:0.97,xref:'paper',yref:'paper',showarrow:false,
            text:`${(logInt[0]-logInt[logInt.length-1]).toFixed(1)} decades dynamic range`,
            font:{size:10,color:'#64748b'},xanchor:'left',yanchor:'top',
          }],
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      // ── Length × Charge 2D Heatmap ────────────────────────────────────────
      useEffect(() => {
        const peps = data?.top_peptides;
        if (!peps?.length || !lcHeatRef.current) return;
        const charges = [1,2,3,4]; // focus on biologically relevant charges
        const lens = Array.from({length:20},(_, i)=>i+7); // 7–26
        const grid = charges.map(z => lens.map(l => peps.filter(p=>p.charge===z&&p.length===l).length));
        // Normalise rows to 0-1 for visibility
        const maxAll = Math.max(...grid.flat());
        if (maxAll === 0) return;
        const norm = grid.map(row => row.map(v => v / maxAll));
        Plotly.react(lcHeatRef.current, [{
          type:'heatmap',
          z: norm,
          x: lens.map(l => `${l}aa`),
          y: charges.map(z => `z=+${z}`),
          colorscale:[
            [0,'rgba(13,30,54,0)'],[0.02,'#071224'],[0.15,'#0f3460'],
            [0.4,'#1d4ed8'],[0.7,'#7c3aed'],[0.9,'#ec4899'],[1,'#fde68a'],
          ],
          showscale:false,
          hovertemplate:'Length %{x}<br>Charge %{y}<br>Count: %{customdata}<extra></extra>',
          customdata: grid,
          text: grid.map(row => row.map(v => v > 0 ? String(v) : '')),
          texttemplate:'%{text}',
          textfont:{size:9, color:'rgba(255,255,255,0.7)'},
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'rgba(7,18,36,0.5)',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:15,t:20,b:55},
          xaxis:{title:{text:'Peptide Length',font:{size:11}},color:'#a0b4cc',tickfont:{size:10},gridcolor:'rgba(30,58,95,0.3)'},
          yaxis:{title:{text:'Charge State',font:{size:11}},color:'#a0b4cc',tickfont:{size:10},gridcolor:'rgba(30,58,95,0.3)'},
          shapes:[
            {type:'rect',x0:'7.5aa',x1:'14.5aa',y0:-0.5,y1:1.5,
             fillcolor:'rgba(96,165,250,0.06)',line:{color:'rgba(96,165,250,0.3)',width:1}},
          ],
        }, {responsive:true, displayModeBar:false});
      }, [data]);

      const topPeps = useMemo(() => {
        if (!data?.top_peptides) return [];
        let peps = data.top_peptides;
        if (mhcClass === 'mhc1') peps = peps.filter(p => p.length >= 8 && p.length <= 14);
        if (mhcClass === 'mhc2') peps = peps.filter(p => p.length >= 13 && p.length <= 25);
        if (chargeFilter !== 'all') peps = peps.filter(p => p.charge === parseInt(chargeFilter));
        return peps;
      }, [data, mhcClass, chargeFilter]);

      // Derived anchor residue data from motif_matrix (9-mer P2 and PΩ anchor positions)
      const anchorData = useMemo(() => {
        const mm = data?.motif_matrix?.['9'];
        if (!mm) return null;
        const aas = mm.aas;  // 20 AAs
        const freq = mm.freq; // 20×9 matrix, row=AA, col=position
        // P2 = position index 1, P9 = position index 8
        const getPos = (posIdx) => {
          const vals = aas.map((aa, ai) => ({aa, freq: freq[ai][posIdx]}));
          return vals.sort((a,b) => b.freq - a.freq).slice(0,6);
        };
        const p2 = getPos(1);
        const p3 = getPos(2);
        const pOmega = getPos(8);  // C-terminal anchor
        // HLA supertype hint from P2 and PΩ
        const p2Top = p2[0]?.aa || '';
        const pOmegaTop = pOmega[0]?.aa || '';
        let supertypeHint = '';
        if (['L','M','I','V'].includes(p2Top) && ['L','V','I','A','T'].includes(pOmegaTop)) supertypeHint = 'A*02 (L/M at P2, aliphatic Ω)';
        else if (['R','K'].includes(p2Top)) supertypeHint = 'A*03/A*11 (R/K at P2)';
        else if (p2Top === 'P' || pOmegaTop === 'R') supertypeHint = 'B*07 (P at P2 or R at Ω)';
        else if (['D','E'].includes(p2Top)) supertypeHint = 'B*44 (D/E at P2)';
        else if (['F','Y'].includes(pOmegaTop)) supertypeHint = 'A*24 (aromatic Ω)';
        return {p2, p3, pOmega, supertypeHint, n: mm.n};
      }, [data]);

      if (runsLoading) return <div className="empty">Loading…</div>;

      return (
        <div>
          {/* Header */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1.25rem'}}>
            <div style={{display:'flex',gap:'1.5rem',alignItems:'center',flexWrap:'wrap',justifyContent:'space-between'}}>
              <div>
                <span style={{fontWeight:700,fontSize:'1.1rem'}}>Immunopeptidomics</span>
                <span style={{color:'var(--muted)',fontSize:'0.82rem',marginLeft:'0.75rem'}}>
                  MHC Class I (8–14aa) · MHC Class II (13–25aa) · 1% FDR
                </span>
              </div>
              <div style={{fontSize:'0.78rem',color:'var(--muted)'}}>
                Ensure DIA-NN was run with <code style={{color:'var(--accent)'}}>--min-pr-charge 1</code> for +1 ions
              </div>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'250px 1fr',gap:'1rem',alignItems:'start'}}>
            {/* Run list */}
            <div className="card" style={{padding:'0.75rem',position:'sticky',top:'1rem'}}>
              <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>Runs</div>
              <input type="text" placeholder="Filter…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.3rem 0.5rem',fontSize:'0.8rem',marginBottom:'0.5rem'}} />
              <div style={{maxHeight:'65vh',overflowY:'auto'}}>
                {filtered.map(r => {
                  const sel = selectedRun?.id === r.id;
                  return (
                    <div key={r.id} onClick={() => setSelectedRun(r)}
                      style={{padding:'0.4rem 0.5rem',borderRadius:'0.3rem',cursor:'pointer',marginBottom:'0.1rem',
                        background:sel?'rgba(218,170,0,0.1)':'transparent',borderLeft:sel?'2px solid var(--accent)':'2px solid transparent'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'0.35rem'}}>
                        <span title={r.result_path ? 'DIA-NN report.parquet available' : 'No search results — Raw MHC Landscape only'}
                          style={{flexShrink:0,width:'6px',height:'6px',borderRadius:'50%',
                            background: r.result_path ? '#22c55e' : '#334155',
                            boxShadow: r.result_path ? '0 0 4px #22c55e88' : 'none'}} />
                        <span style={{fontSize:'0.78rem',fontWeight:600,color:sel?'var(--accent)':'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.run_name}</span>
                      </div>
                      <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem',paddingLeft:'0.9rem'}}>
                        {new Date(r.run_date).toLocaleDateString([],{month:'short',day:'numeric',year:'2-digit'})} · {r.instrument}
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
                  <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.4}}>🧫</div>
                  <div style={{fontSize:'1rem',fontWeight:600,marginBottom:'0.4rem'}}>Select a run</div>
                  <div style={{fontSize:'0.85rem'}}>Peptide length distribution, MHC class analysis, and ion cloud</div>
                </div>
              )}
              {selectedRun && loading && <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>Loading…</div>}
              {selectedRun && !loading && !data && (
                <div className="card">
                  <p style={{color:'var(--muted)',fontSize:'0.85rem'}}>
                    No DIA-NN report.parquet found for <strong>{selectedRun.run_name}</strong>.
                  </p>
                </div>
              )}
              {selectedRun && !loading && data && (
                <div>
                  {/* DDA vs DIA acquisition mode notice */}
                  {data.acq_mode && (
                    <div style={{
                      marginBottom:'0.6rem',
                      padding:'0.45rem 0.8rem',
                      borderRadius:'0.4rem',
                      background: data.is_dia_immuno
                        ? 'rgba(251,191,36,0.08)'
                        : 'rgba(34,211,238,0.06)',
                      border: `1px solid ${data.is_dia_immuno ? 'rgba(251,191,36,0.3)' : 'rgba(34,211,238,0.2)'}`,
                      display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap',
                    }}>
                      <span style={{
                        fontWeight:700, fontSize:'0.75rem',
                        color: data.is_dia_immuno ? '#fbbf24' : '#22d3ee',
                        background: data.is_dia_immuno ? 'rgba(251,191,36,0.15)' : 'rgba(34,211,238,0.12)',
                        padding:'0.1rem 0.45rem', borderRadius:'0.25rem',
                      }}>
                        {data.acq_mode}
                      </span>
                      {data.is_dda_immuno && (
                        <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>
                          DDA immunopeptidomics — each spectrum is a single-precursor fragmentation event. High-confidence PSMs, sequence coverage limited by precursor selection.
                        </span>
                      )}
                      {data.is_dia_immuno && (
                        <span style={{fontSize:'0.72rem',color:'#fbbf24'}}>
                          ⚠ DIA immunopeptidomics — requires an MHC-specific spectral library (not tryptic). If searched with the HeLa tryptic library the peptide IDs here reflect tryptic contamination, not true ligandome.
                        </span>
                      )}
                    </div>
                  )}
                  {/* Summary metrics */}
                  <div className="card" style={{marginBottom:'0.75rem',padding:'0.65rem 1rem'}}>
                    <div style={{display:'flex',gap:'1.25rem',flexWrap:'wrap',alignItems:'center'}}>
                      {[
                        {label:'Total @ 1% FDR', value:(data.n_total||0).toLocaleString(), color:'var(--text)'},
                        {label:'MHC-I (8–14aa)', value:`${(data.n_mhc1||0).toLocaleString()} (${data.pct_mhc1||0}%)`, color:'#60a5fa'},
                        {label:'MHC-II (13–25aa)', value:`${(data.n_mhc2||0).toLocaleString()} (${data.pct_mhc2||0}%)`, color:'#a855f7'},
                        {label:'Short (<8aa)', value:(data.n_short||0).toLocaleString(), color:'var(--muted)'},
                        {label:'Long (>25aa)', value:(data.n_long||0).toLocaleString(), color:'var(--muted)'},
                        data.length_stats?.median ? {label:'Median length', value:`${data.length_stats.median}aa`, color:'var(--muted)'} : null,
                      ].filter(Boolean).map(m => (
                        <div key={m.label} style={{textAlign:'center'}}>
                          <div style={{fontWeight:700,fontSize:'1rem',color:m.color}}>{m.value}</div>
                          <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Charge note if no z=1 */}
                  {!(data.charge_dist?.[1]) && (
                    <div style={{background:'rgba(234,179,8,0.08)',border:'1px solid rgba(234,179,8,0.25)',borderRadius:'0.4rem',
                                 padding:'0.5rem 0.9rem',marginBottom:'0.75rem',fontSize:'0.82rem',color:'var(--warn)'}}>
                      No z=+1 ions detected. For immunopeptidomics/MHC-I, re-run DIA-NN with{' '}
                      <code style={{color:'var(--accent)'}}>--min-pr-charge 1 --max-pr-charge 3</code>.
                    </div>
                  )}

                  {/* Length distribution */}
                  <div className="card" style={{marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem'}}>
                      <h3 style={{margin:0}}>Peptide Length Distribution</h3>
                      <ExportBtn plotRef={lenPlotRef} filename={`${selectedRun?.run_name||'run'}-pep-length`} />
                    </div>
                    <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.4rem'}}>
                      Blue shading = MHC-I (8–14aa) &nbsp;·&nbsp; Purple shading = MHC-II (13–25aa)
                    </div>
                    <div ref={lenPlotRef} style={{height:'240px'}} />
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem',marginBottom:'0.75rem'}}>
                    {/* Charge distribution */}
                    <div className="card">
                      <h3 style={{marginBottom:'0.5rem'}}>Charge Distribution</h3>
                      {Object.keys(data.charge_dist||{}).length === 0
                        ? <div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No charge data</div>
                        : (
                          <div style={{display:'flex',flexDirection:'column',gap:'0.3rem'}}>
                            {Object.entries(data.charge_dist||{}).sort((a,b)=>+a[0]-+b[0]).map(([z, cnt]) => {
                              const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
                              const CHARGE_LBL    = {0:'?',1:'+1',2:'+2',3:'+3',4:'+4',5:'+5',6:'+6'};
                              const col = CHARGE_COLORS[+z] || '#94a3b8';
                              const maxCnt = Math.max(...Object.values(data.charge_dist));
                              return (
                                <div key={z} style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                                  <div style={{width:'28px',fontSize:'0.78rem',color:col,textAlign:'right',flexShrink:0,fontWeight:700}}>{CHARGE_LBL[+z]||`+${z}`}</div>
                                  <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:'3px',height:'14px',overflow:'hidden'}}>
                                    <div style={{width:`${(cnt/maxCnt*100)}%`,height:'100%',background:col,borderRadius:'3px'}} />
                                  </div>
                                  <div style={{fontSize:'0.76rem',color:'var(--text)',width:'90px',flexShrink:0}}>
                                    {cnt.toLocaleString()} <span style={{color:'var(--muted)'}}>({(cnt/data.n_total*100).toFixed(1)}%)</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      }
                    </div>

                    {/* Modifications */}
                    <div className="card">
                      <h3 style={{marginBottom:'0.5rem'}}>Modifications</h3>
                      {(data.modifications||[]).length === 0
                        ? <div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No variable modifications</div>
                        : (
                          <div style={{display:'flex',flexDirection:'column',gap:'0.25rem'}}>
                            {data.modifications.slice(0,8).map((m,i) => {
                              const modColors = ['#f97316','#a78bfa','#38bdf8','#fb7185','#4ade80','#fbbf24','#60a5fa','#22c55e'];
                              const maxPct = data.modifications[0]?.pct || 1;
                              return (
                                <div key={i} style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
                                  <div style={{width:'72px',fontSize:'0.74rem',color:'var(--text)',flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</div>
                                  <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:'2px',height:'10px',overflow:'hidden'}}>
                                    <div style={{width:`${m.pct/maxPct*100}%`,height:'100%',background:modColors[i%modColors.length]}} />
                                  </div>
                                  <div style={{fontSize:'0.72rem',color:'var(--muted)',width:'50px',textAlign:'right',flexShrink:0}}>{m.pct}%</div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      }
                    </div>
                  </div>

                  {/* Ion cloud: m/z vs 1/K₀ */}
                  {data.top_peptides?.some(p => p.mobility) && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Ion Cloud — m/z × 1/K₀</h3>
                          <div style={{fontSize:'0.73rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            Charge-state lanes · Tenzer/Gomez-Zepeda style · top 200 precursors ·
                            <span style={{color:'#fbbf24'}}> z=+1 = MHC-I candidates</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.4rem',alignItems:'center'}}>
                          {immunoWindowData?.windows?.length > 0 && (
                            <button
                              onClick={() => setShowImmunoWindowOverlay(v => !v)}
                              title={showImmunoWindowOverlay ? 'Hide diaPASEF windows' : 'Overlay diaPASEF isolation windows'}
                              style={{
                                display:'flex',alignItems:'center',gap:'0.3rem',
                                padding:'0.25rem 0.6rem', fontSize:'0.78rem', fontWeight: 600,
                                background: showImmunoWindowOverlay ? 'rgba(0,174,183,0.18)' : 'rgba(0,174,183,0.07)',
                                color: showImmunoWindowOverlay ? '#00d4e0' : '#4a8cbb',
                                border: `1px solid ${showImmunoWindowOverlay ? '#00d4e0' : 'rgba(0,174,183,0.3)'}`,
                                borderRadius:'0.4rem', cursor:'pointer', whiteSpace:'nowrap',
                              }}
                            >
                              <span>⊞</span>
                              {showImmunoWindowOverlay ? 'Windows ON' : 'Windows'}
                            </button>
                          )}
                          <ExportBtn plotRef={cloudRef} filename={`${selectedRun?.run_name||'run'}-immuno-cloud`} />
                        </div>
                      </div>
                      {showImmunoWindowOverlay && immunoWindowData?.windows?.length > 0 && (
                        <div style={{fontSize:'0.72rem',color:'#4a9ab0',marginBottom:'0.25rem',paddingLeft:'0.1rem'}}>
                          {immunoWindowData.windows.length} diaPASEF sub-windows shown ·
                          m/z {immunoWindowData.mz_range[0].toFixed(0)}–{immunoWindowData.mz_range[1].toFixed(0)} Da ·
                          {immunoWindowData.n_window_groups} groups · coloured by group · hover charts for details
                        </div>
                      )}
                      <div ref={cloudRef} style={{height:'320px'}} />
                    </div>
                  )}

                  {/* ── View 1: Length × Mobility Ridge ──────────────────── */}
                  {data?.length_mobility_agg && Object.keys(data.length_mobility_agg).some(l => data.length_mobility_agg[l]?.median_im) && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Length × Mobility Ridge</h3>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            Per-length 1/K₀ box: median, IQR, ±2σ whiskers · each box = all precursors at that length
                          </div>
                        </div>
                        <ExportBtn plotRef={ridgeRef} filename={`${selectedRun?.run_name||'run'}-len-mobility`} />
                      </div>
                      <div ref={ridgeRef} style={{height:'260px'}} />
                    </div>
                  )}

                  {/* ── View 2: GRAVY × Mobility + Fingerprint Radar ────────── */}
                  {data?.gravy_cloud?.length > 0 && (
                    <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:'0.75rem',marginBottom:'0.75rem'}}>
                      <div className="card">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem'}}>
                          <div>
                            <h3 style={{margin:0}}>Hydrophobicity × Mobility Landscape</h3>
                            <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                              GRAVY score (Kyte-Doolittle) vs 1/K₀ · colored by peptide length · reveals MHC anchor-residue clusters
                            </div>
                          </div>
                          <ExportBtn plotRef={gravyRef} filename={`${selectedRun?.run_name||'run'}-gravy-mobility`} />
                        </div>
                        <div ref={gravyRef} style={{height:'280px'}} />
                      </div>
                      <div className="card">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.15rem'}}>
                          <div>
                            <h3 style={{margin:0}}>Immunopeptidome Fingerprint</h3>
                            <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem'}}>5-axis quality radar</div>
                          </div>
                        </div>
                        <div ref={radarRef} style={{height:'265px'}} />
                        {data?.radar && (
                          <div style={{fontSize:'0.7rem',color:'var(--muted)',borderTop:'1px solid var(--border)',paddingTop:'0.4rem',marginTop:'0.25rem',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.15rem 0.5rem'}}>
                            <span>MHC-I: <strong style={{color:'var(--text)'}}>{(data.radar.pct_mhc1||0).toFixed(1)}%</strong></span>
                            <span>z=+1: <strong style={{color:'var(--text)'}}>{(data.radar.pct_z1||0).toFixed(1)}%</strong></span>
                            <span>9-mer: <strong style={{color:'var(--text)'}}>{(data.radar.pct_9mer_mhc1||0).toFixed(1)}%</strong></span>
                            <span>Mob CV: <strong style={{color:'var(--text)'}}>{data.radar.mobility_cv != null ? data.radar.mobility_cv.toFixed(1)+'%' : '—'}</strong></span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Sequence Motif Heatmap ───────────────────────────────── */}
                  {data?.motif_matrix && Object.keys(data.motif_matrix).length > 0 && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem',flexWrap:'wrap',gap:'0.5rem'}}>
                        <div>
                          <h3 style={{margin:0}}>HLA Binding Motif</h3>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            Per-position amino acid frequency · white label = anchor residue (≥20%) · n={data.motif_matrix[motifLen]?.n.toLocaleString() || '—'} peptides
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.35rem',alignItems:'center'}}>
                          {['8','9','10','11'].filter(l => data.motif_matrix[l]).map(l => (
                            <button key={l} onClick={() => setMotifLen(l)}
                              style={{
                                padding:'0.2rem 0.55rem',fontSize:'0.78rem',fontWeight:600,
                                background:motifLen===l?'rgba(96,165,250,0.2)':'rgba(96,165,250,0.06)',
                                color:motifLen===l?'#60a5fa':'var(--muted)',
                                border:`1px solid ${motifLen===l?'#60a5fa':'rgba(96,165,250,0.2)'}`,
                                borderRadius:'0.3rem',cursor:'pointer',
                              }}>
                              {l}-mer
                            </button>
                          ))}
                          <ExportBtn plotRef={motifRef} filename={`${selectedRun?.run_name||'run'}-motif-${motifLen}mer`} />
                        </div>
                      </div>
                      <div ref={motifRef} style={{height:'280px'}} />
                    </div>
                  )}

                  {/* ── View 3: Raw MHC Ion Landscape (timsdata) ─────────────── */}
                  {selectedRun?.raw_path?.endsWith('.d') && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Raw MHC Ion Landscape</h3>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            All ions from raw timsdata MS1 frames in the MHC region (m/z 400–950) · identified peptides overlaid
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.4rem',alignItems:'center'}}>
                          {!showLandscape && (
                            <button onClick={() => setShowLandscape(true)}
                              style={{padding:'0.25rem 0.7rem',fontSize:'0.78rem',fontWeight:600,
                                background:'rgba(96,165,250,0.1)',color:'#60a5fa',
                                border:'1px solid rgba(96,165,250,0.3)',borderRadius:'0.4rem',cursor:'pointer'}}>
                              Load raw data
                            </button>
                          )}
                          {showLandscape && <ExportBtn plotRef={landscapeRef} filename={`${selectedRun?.run_name||'run'}-mhc-landscape`} />}
                        </div>
                      </div>
                      {showLandscape && landscapeLoading && (
                        <div style={{textAlign:'center',color:'var(--muted)',padding:'2rem',fontSize:'0.85rem'}}>
                          Reading timsdata frames…
                        </div>
                      )}
                      {showLandscape && !landscapeLoading && !landscape && (
                        <div style={{color:'var(--muted)',fontSize:'0.82rem',padding:'0.5rem 0'}}>
                          timsdata DLL unavailable or no MS1 frames found in this .d file.
                        </div>
                      )}
                      {showLandscape && !landscapeLoading && landscape && (
                        <div ref={landscapeRef} style={{height:'340px'}} />
                      )}
                      {!showLandscape && (
                        <div style={{textAlign:'center',color:'var(--muted)',padding:'1.5rem',fontSize:'0.8rem',fontStyle:'italic'}}>
                          Reads directly from .d raw file — loads on demand
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── RT × 1/K₀ 2D Fingerprint ──────────────────────────────── */}
                  {data?.top_peptides?.some(p => p.mobility > 0 && p.rt > 0) && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem'}}>
                        <div>
                          <h3 style={{margin:0}}>RT × 1/K₀ 2D Fingerprint</h3>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                            Density contour of all precursors in retention-time × ion-mobility space · timsTOF-specific · MHC class overlay
                          </div>
                        </div>
                        <ExportBtn plotRef={rtImRef} filename={`${selectedRun?.run_name||'run'}-rt-im-fingerprint`} />
                      </div>
                      <div ref={rtImRef} style={{height:'300px'}} />
                    </div>
                  )}

                  {/* ── Anchor Residue Profile (9-mer P2 / C-terminal) ──────────── */}
                  {anchorData && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{marginBottom:'0.5rem'}}>
                        <h3 style={{margin:0}}>Anchor Residue Profile — 9-mer MHC-I</h3>
                        <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                          HLA anchor positions P2 and PΩ (C-terminal) · n={anchorData.n?.toLocaleString()} 9-mers
                          {anchorData.supertypeHint && (
                            <span style={{marginLeft:'0.6rem',color:'#fbbf24',fontWeight:600}}>
                              ↗ {anchorData.supertypeHint}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'1rem'}}>
                        {[
                          {label:'P2 (anchor)', pos: anchorData.p2, color:'#60a5fa'},
                          {label:'P3 (subanchor)', pos: anchorData.p3, color:'#38bdf8'},
                          {label:'PΩ / P9 (anchor)', pos: anchorData.pOmega, color:'#a78bfa'},
                        ].map(({label, pos, color}) => {
                          const maxF = pos[0]?.freq || 0.001;
                          return (
                            <div key={label}>
                              <div style={{fontSize:'0.77rem',fontWeight:700,color,marginBottom:'0.35rem'}}>{label}</div>
                              {pos.map((item,i) => (
                                <div key={item.aa} style={{display:'flex',alignItems:'center',gap:'0.4rem',marginBottom:'0.2rem'}}>
                                  <div style={{width:'18px',fontFamily:'monospace',fontWeight:700,fontSize:'0.8rem',
                                    color: i===0 ? '#fff' : '#94a3b8',flexShrink:0,textAlign:'center'}}>{item.aa}</div>
                                  <div style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:'2px',height:'12px',overflow:'hidden'}}>
                                    <div style={{
                                      width:`${(item.freq/maxF*100)}%`,height:'100%',
                                      background: i===0 ? color : `${color}55`,
                                      borderRadius:'2px',transition:'width 0.3s',
                                    }} />
                                  </div>
                                  <div style={{fontSize:'0.72rem',color:'var(--muted)',width:'32px',textAlign:'right',flexShrink:0}}>
                                    {(item.freq*100).toFixed(0)}%
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Dynamic Range Waterfall + Length×Charge Heatmap ─────────── */}
                  {data?.top_peptides?.some(p => p.intensity > 0) && (
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem',marginBottom:'0.75rem'}}>
                      <div className="card">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem'}}>
                          <div>
                            <h3 style={{margin:0}}>Dynamic Range Waterfall</h3>
                            <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                              Precursors ranked by intensity · blue=MHC-I · purple=MHC-II
                            </div>
                          </div>
                          <ExportBtn plotRef={waterfallRef} filename={`${selectedRun?.run_name||'run'}-dynamic-range`} />
                        </div>
                        <div ref={waterfallRef} style={{height:'240px'}} />
                      </div>
                      <div className="card">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem'}}>
                          <div>
                            <h3 style={{margin:0}}>Length × Charge Grid</h3>
                            <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                              2D count heatmap · blue highlight = MHC-I zone
                            </div>
                          </div>
                          <ExportBtn plotRef={lcHeatRef} filename={`${selectedRun?.run_name||'run'}-len-charge`} />
                        </div>
                        <div ref={lcHeatRef} style={{height:'240px'}} />
                      </div>
                    </div>
                  )}

                  {/* ── Source Protein Analysis ─────────────────────────────────── */}
                  {data?.top_source_proteins?.length > 0 && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <h3 style={{marginBottom:'0.5rem'}}>Source Protein Analysis</h3>
                      <div style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:'0.6rem'}}>
                        Top {data.top_source_proteins.length} proteins by unique peptide count presented in the immunopeptidome
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'0.25rem 1rem'}}>
                        {data.top_source_proteins.map((p,i) => {
                          const maxN = data.top_source_proteins[0].n_peptides;
                          const isHsp = /hsp|heat|stress/i.test(p.full_name || p.protein);
                          const isHistone = /hist|h2a|h2b|h3|h4/i.test(p.protein);
                          const isActin = /actin|tubulin/i.test(p.protein);
                          const col = isHsp ? '#f97316' : isHistone ? '#a855f7' : isActin ? '#22c55e' : '#60a5fa';
                          return (
                            <div key={i} style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                              <div style={{width:'70px',fontSize:'0.74rem',fontFamily:'monospace',fontWeight:700,
                                color:col,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                                title={p.full_name}>{p.protein}</div>
                              <div style={{flex:1,background:'rgba(255,255,255,0.04)',borderRadius:'3px',height:'12px',overflow:'hidden'}}>
                                <div style={{width:`${p.n_peptides/maxN*100}%`,height:'100%',background:col,opacity:0.8,borderRadius:'3px'}} />
                              </div>
                              <div style={{fontSize:'0.72rem',color:'var(--muted)',width:'55px',flexShrink:0,textAlign:'right'}}>
                                {p.n_peptides} <span style={{color:'#475569'}}>({p.pct}%)</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Top peptides table with MHC/charge filter */}
                  <div className="card">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.6rem',flexWrap:'wrap',gap:'0.5rem'}}>
                      <h3 style={{margin:0}}>Top Peptides</h3>
                      <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                        <select value={mhcClass} onChange={e => setMhcClass(e.target.value)}
                          style={{background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',padding:'0.25rem 0.4rem',fontSize:'0.78rem'}}>
                          <option value="all">All lengths</option>
                          <option value="mhc1">MHC-I (8–14aa)</option>
                          <option value="mhc2">MHC-II (13–25aa)</option>
                        </select>
                        <select value={chargeFilter} onChange={e => setChargeFilter(e.target.value)}
                          style={{background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',padding:'0.25rem 0.4rem',fontSize:'0.78rem'}}>
                          <option value="all">All charges</option>
                          <option value="0">z=0 (unassigned)</option>
                          {[1,2,3,4,5,6].map(z => <option key={z} value={z}>+{z}</option>)}
                        </select>
                        <span style={{fontSize:'0.75rem',color:'var(--muted)'}}>{topPeps.length} shown</span>
                      </div>
                    </div>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.78rem'}}>
                        <thead>
                          <tr style={{borderBottom:'1px solid var(--border)',color:'var(--muted)'}}>
                            {['Sequence','Len','z','m/z','RT (min)','1/K₀','Intensity'].map(h => (
                              <th key={h} style={{textAlign:'left',padding:'0.25rem 0.4rem',fontWeight:600}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {topPeps.map((p, i) => {
                            const isMhc1 = p.length >= 8 && p.length <= 14;
                            const isMhc2 = p.length >= 13 && p.length <= 25;
                            const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
                            return (
                              <tr key={i} style={{borderBottom:'1px solid rgba(30,58,95,0.5)',background: i%2===0?'transparent':'rgba(255,255,255,0.015)'}}>
                                <td style={{padding:'0.2rem 0.4rem',fontFamily:'monospace',fontSize:'0.76rem',color:'var(--accent)'}}>{p.sequence}</td>
                                <td style={{padding:'0.2rem 0.4rem',color: isMhc1&&isMhc2?'#a855f7':isMhc1?'#60a5fa':isMhc2?'#a855f7':'var(--muted)',fontWeight:600}}>{p.length}</td>
                                <td style={{padding:'0.2rem 0.4rem',color:CHARGE_COLORS[p.charge]||'var(--muted)',fontWeight:600}}>{p.charge===0?'?':`+${p.charge}`}</td>
                                <td style={{padding:'0.2rem 0.4rem'}}>{p.mz?.toFixed(4)}</td>
                                <td style={{padding:'0.2rem 0.4rem'}}>{p.rt?.toFixed(2)}</td>
                                <td style={{padding:'0.2rem 0.4rem'}}>{p.mobility?.toFixed(4) || '—'}</td>
                                <td style={{padding:'0.2rem 0.4rem',color:'var(--muted)'}}>{p.intensity ? p.intensity.toExponential(2) : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── HLA Reference Atlas ───────────────────────────────────────── */}
            <div style={{marginTop:'1.25rem'}}>
              <div className="card" style={{marginBottom:'0.75rem',background:'linear-gradient(135deg,rgba(168,85,247,0.07),rgba(96,165,250,0.04))'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'0.5rem'}}>
                  <div>
                    <h3 style={{margin:'0 0 0.2rem',color:'#c084fc'}}>HLA Reference Atlas</h3>
                    <div style={{fontSize:'0.72rem',color:'var(--muted)'}}>
                      {atlasStatus?.available
                        ? (atlasStatus.source?.includes('seed') || atlasStatus.source?.includes('built-in')
                          ? 'Built-in seed · well-characterised ligands from published benchmarks (SYFPEITHI / IEDB)'
                          : `${atlasStatus.source || 'Downloaded atlas'} · allele-annotated`)
                        : 'Known HLA ligands · allele + tissue annotated · used for peptide cross-reference'}
                    </div>
                  </div>
                  {atlasStatus?.available ? (
                    <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                      <span style={{fontSize:'0.75rem',color:'#22c55e',fontWeight:600}}>
                        ✓ {atlasStatus.n_total?.toLocaleString()} peptides
                      </span>
                      <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>
                        {atlasStatus.n_alleles} alleles · {atlasStatus.n_tissues} tissues
                      </span>
                      {(atlasStatus.source?.includes('seed') || atlasStatus.source?.includes('built-in')) && (
                        <button onClick={startAtlasDownload} disabled={atlasDownloading}
                          style={{fontSize:'0.72rem',padding:'0.2rem 0.6rem',background:'rgba(96,165,250,0.12)',
                            border:'1px solid rgba(96,165,250,0.3)',borderRadius:'0.3rem',color:'#60a5fa',cursor:'pointer',
                            opacity:atlasDownloading?0.7:1}}>
                          {atlasDownloading ? 'Expanding…' : '↑ Expand (full dataset)'}
                        </button>
                      )}
                      <button onClick={loadStandards}
                        style={{fontSize:'0.74rem',padding:'0.2rem 0.6rem',background:'rgba(168,85,247,0.15)',
                          border:'1px solid rgba(168,85,247,0.35)',borderRadius:'0.3rem',color:'#c084fc',cursor:'pointer'}}>
                        {showStandards ? 'Hide Standards' : 'Canonical Standards'}
                      </button>
                    </div>
                  ) : (
                    <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
                      <button onClick={startAtlasSeed} disabled={atlasDownloading}
                        style={{fontSize:'0.78rem',padding:'0.3rem 0.9rem',background:'rgba(34,197,94,0.15)',
                          border:'1px solid rgba(34,197,94,0.4)',borderRadius:'0.4rem',color:'#22c55e',cursor:'pointer',
                          opacity:atlasDownloading?0.7:1}}>
                        {atlasDownloading ? 'Installing…' : '⚡ Install Seed (instant)'}
                      </button>
                      <button onClick={startAtlasDownload} disabled={atlasDownloading}
                        style={{fontSize:'0.78rem',padding:'0.3rem 0.9rem',background:'rgba(168,85,247,0.15)',
                          border:'1px solid rgba(168,85,247,0.35)',borderRadius:'0.4rem',color:'#c084fc',cursor:'pointer',
                          opacity:atlasDownloading?0.7:1}}>
                        {atlasDownloading ? 'Downloading…' : '↓ Full Dataset'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Download progress log */}
                {atlasDownloading && atlasStatus?.download_job?.log?.length > 0 && (
                  <div style={{marginTop:'0.6rem',background:'rgba(0,0,0,0.3)',borderRadius:'0.3rem',
                    padding:'0.4rem 0.6rem',fontSize:'0.7rem',fontFamily:'monospace',color:'#94a3b8',
                    maxHeight:'6rem',overflowY:'auto'}}>
                    {atlasStatus.download_job.log.slice(-8).map((l,i) => <div key={i}>{l}</div>)}
                  </div>
                )}

                {/* Coverage for current run */}
                {atlasCoverage && (
                  <div style={{marginTop:'0.75rem',display:'flex',alignItems:'center',gap:'1.25rem',flexWrap:'wrap'}}>
                    <div style={{textAlign:'center'}}>
                      <div style={{fontSize:'1.7rem',fontWeight:900,color: atlasCoverage.pct > 50 ? '#22c55e' : atlasCoverage.pct > 20 ? '#f59e0b' : '#94a3b8'}}>
                        {atlasCoverage.pct}%
                      </div>
                      <div style={{fontSize:'0.68rem',color:'var(--muted)'}}>Atlas coverage</div>
                    </div>
                    <div style={{flex:1,minWidth:'180px'}}>
                      <div style={{height:'8px',background:'rgba(255,255,255,0.06)',borderRadius:'4px',overflow:'hidden',marginBottom:'0.25rem'}}>
                        <div style={{width:`${atlasCoverage.pct}%`,height:'100%',background:'linear-gradient(90deg,#a855f7,#60a5fa)',transition:'width 0.6s'}} />
                      </div>
                      <div style={{fontSize:'0.71rem',color:'var(--muted)'}}>
                        {atlasCoverage.n_hits} of {atlasCoverage.n_query} peptides confirmed in atlas
                      </div>
                    </div>
                    {atlasCoverage.pct < 5 && (
                      <div style={{fontSize:'0.71rem',color:'#f59e0b',maxWidth:'220px',lineHeight:1.5}}>
                        Low coverage is normal for non-HeLa / non-standard samples or novel alleles
                      </div>
                    )}
                  </div>
                )}

                {/* Canonical Standards panel */}
                {showStandards && atlasStandards?.length > 0 && (
                  <div style={{marginTop:'0.75rem'}}>
                    <div style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:'0.4rem'}}>
                      Peptides detected in ≥3 tissues — reliable as internal standards or DIA targets · top {atlasStandards.length} by tissue breadth
                    </div>
                    <div style={{overflowX:'auto',maxHeight:'220px',overflowY:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.74rem'}}>
                        <thead>
                          <tr style={{color:'var(--muted)',borderBottom:'1px solid var(--border)',position:'sticky',top:0,background:'var(--surface)'}}>
                            {['Sequence','Len','Allele','Protein','Tissues','Obs'].map(h => (
                              <th key={h} style={{textAlign:'left',padding:'0.2rem 0.4rem',fontWeight:600}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {atlasStandards.map((s,i) => (
                            <tr key={i} style={{borderBottom:'1px solid rgba(30,58,95,0.4)',background:i%2===0?'transparent':'rgba(255,255,255,0.012)'}}>
                              <td style={{padding:'0.18rem 0.4rem',fontFamily:'monospace',color:'#c084fc',fontWeight:600}}>{s.sequence}</td>
                              <td style={{padding:'0.18rem 0.4rem',color:'#60a5fa'}}>{s.length}</td>
                              <td style={{padding:'0.18rem 0.4rem',color:'var(--muted)',fontSize:'0.7rem'}}>{(s.allele||'').replace('HLA-','')}</td>
                              <td style={{padding:'0.18rem 0.4rem',color:'var(--muted)',fontSize:'0.7rem',maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.protein}</td>
                              <td style={{padding:'0.18rem 0.4rem',color:'#22c55e',fontWeight:700}}>{s.n_tissues}</td>
                              <td style={{padding:'0.18rem 0.4rem',color:'var(--muted)'}}>{s.total_obs}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button style={{marginTop:'0.5rem',fontSize:'0.72rem',padding:'0.2rem 0.7rem',
                      background:'rgba(96,165,250,0.1)',border:'1px solid rgba(96,165,250,0.25)',
                      borderRadius:'0.3rem',color:'#60a5fa',cursor:'pointer'}}
                      onClick={() => {
                        const rows = atlasStandards.map(s => `${s.sequence}\t${s.allele}\t${s.length}\t${s.n_tissues}\t${s.total_obs}`);
                        const tsv = 'sequence\tallele\tlength\tn_tissues\ttotal_obs\n' + rows.join('\n');
                        const a = document.createElement('a');
                        a.href = 'data:text/tab-separated-values;charset=utf-8,' + encodeURIComponent(tsv);
                        a.download = 'hla_canonical_standards.tsv';
                        a.click();
                      }}>
                      Export TSV (DIA-NN target list)
                    </button>
                  </div>
                )}

                {/* Atlas search bar */}
                {atlasStatus?.available && (
                  <div style={{marginTop:'0.75rem',display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                    <input value={atlasSearchQ} onChange={e => setAtlasSearchQ(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && doAtlasSearch()}
                      placeholder="Search atlas (sequence, e.g. GILGFVFTL)…"
                      style={{flex:1,minWidth:'200px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--border)',
                        borderRadius:'0.3rem',padding:'0.3rem 0.6rem',color:'var(--text)',fontSize:'0.78rem'}} />
                    <button onClick={doAtlasSearch}
                      style={{fontSize:'0.78rem',padding:'0.3rem 0.8rem',background:'rgba(168,85,247,0.15)',
                        border:'1px solid rgba(168,85,247,0.3)',borderRadius:'0.3rem',color:'#c084fc',cursor:'pointer'}}>
                      Search
                    </button>
                  </div>
                )}

                {/* Atlas search results */}
                {atlasSearchResults?.length > 0 && (
                  <div style={{marginTop:'0.5rem',overflowX:'auto',maxHeight:'200px',overflowY:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.74rem'}}>
                      <thead>
                        <tr style={{color:'var(--muted)',borderBottom:'1px solid var(--border)'}}>
                          {['Sequence','Allele','MHC','Protein','Tissues','Obs'].map(h => (
                            <th key={h} style={{textAlign:'left',padding:'0.2rem 0.4rem',fontWeight:600}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {atlasSearchResults.map((r,i) => (
                          <tr key={i} style={{borderBottom:'1px solid rgba(30,58,95,0.4)'}}>
                            <td style={{padding:'0.18rem 0.4rem',fontFamily:'monospace',color:'#c084fc'}}>{r.sequence}</td>
                            <td style={{padding:'0.18rem 0.4rem',color:'var(--muted)',fontSize:'0.7rem'}}>{(r.allele||'').replace('HLA-','')}</td>
                            <td style={{padding:'0.18rem 0.4rem',color: r.mhc_class===1?'#60a5fa':'#a855f7',fontWeight:700}}>
                              {r.mhc_class === 1 ? 'I' : 'II'}
                            </td>
                            <td style={{padding:'0.18rem 0.4rem',color:'var(--muted)',fontSize:'0.7rem',maxWidth:'130px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.protein}</td>
                            <td style={{padding:'0.18rem 0.4rem',color:'#22c55e'}}>{r.n_tissues}</td>
                            <td style={{padding:'0.18rem 0.4rem',color:'var(--muted)'}}>{r.total_obs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {atlasSearchResults?.length === 0 && (
                  <div style={{marginTop:'0.4rem',fontSize:'0.75rem',color:'var(--muted)'}}>
                    No atlas hits for "{atlasSearchQ}"
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      );
    }

