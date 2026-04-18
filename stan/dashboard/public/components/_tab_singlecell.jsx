    // ══════════════════════════════════════════════════════════════════════════
    // Single-Cell Proteomics Explorer  ·  Powered by real K562 dilution series
    // Panels: Sensitivity Curve · Charge Signature · 4D Ion Cloud ·
    //         Peak Quality · Coverage Model · Surfaceome Atlas
    // ══════════════════════════════════════════════════════════════════════════

    // ── Constants ────────────────────────────────────────────────────────────
    const _SC = {
      gold:    '#DAAA00',
      violet:  '#d946ef',
      cyan:    '#22d3ee',
      green:   '#4ade80',
      orange:  '#f97316',
      purple:  '#a855f7',
      indigo:  '#818cf8',
      rose:    '#f43f5e',
      bg:      '#0e0018',
      surface: '#1a0030',
      border:  '#3d1060',
      text:    '#f0e6ff',
      muted:   '#b899d4',
    };

    // ── Parse input amount from K562 run name → picograms ────────────────────
    function _scParseAmountPg(runName) {
      const m = runName && runName.match(/K562_([0-9.]+)(ng|pg)/i);
      if (!m) return null;
      const val = parseFloat(m[1]);
      return m[2].toLowerCase() === 'ng' ? val * 1000 : val;
    }

    // ── Format pg/ng amounts nicely ──────────────────────────────────────────
    function _scFmtAmt(pg) {
      if (pg >= 1000) return `${(pg/1000).toFixed(pg>=10000?0:1)}ng`;
      if (pg >= 1)    return `${pg >= 10 ? Math.round(pg) : pg.toFixed(1)}pg`;
      return `${pg.toFixed(2)}pg`;
    }

    // ── Seeded LCG for reproducible synthetic overlays ───────────────────────
    function _scRand(seed) {
      let s = (seed >>> 0) || 1;
      const r  = () => { s = Math.imul(s,1664525)+1013904223|0; return (s>>>0)/4294967296; };
      const rN = () => { const u=Math.max(1e-10,r()),v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
      return { r, rN };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 1 — Sensitivity Curve (real data)
    // Log-log plot: proteins & precursors vs input amount
    // ═══════════════════════════════════════════════════════════════════════════
    function SCSensitivityCurve({ runs }) {
      const ref = useRef(null);

      useEffect(() => {
        if (!ref.current || !runs.length) return;

        // Group replicates by input amount
        const byAmt = {};
        runs.forEach(r => {
          if (!r.inputPg) return;
          const k = r.inputPg;
          if (!byAmt[k]) byAmt[k] = { prot:[], prec:[], pw:[], pts:[] };
          if (r.n_proteins)  byAmt[k].prot.push(r.n_proteins);
          if (r.n_precursors) byAmt[k].prec.push(r.n_precursors);
          if (r.median_peak_width_sec) byAmt[k].pw.push(r.median_peak_width_sec);
          if (r.median_points_across_peak) byAmt[k].pts.push(r.median_points_across_peak);
        });

        const amts = Object.keys(byAmt).map(Number).sort((a,b)=>a-b);
        const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
        const std  = arr => {
          if (arr.length < 2) return 0;
          const m = mean(arr);
          return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/(arr.length-1));
        };

        const xs = amts;
        const protMean  = amts.map(a => mean(byAmt[a].prot));
        const protStd   = amts.map(a => std(byAmt[a].prot));
        const precMean  = amts.map(a => mean(byAmt[a].prec));
        const precStd   = amts.map(a => std(byAmt[a].prec));

        // Filter out nulls
        const validIdx = xs.map((_,i) => protMean[i] !== null ? i : null).filter(i => i !== null);
        const xV  = validIdx.map(i => xs[i]);
        const pyV = validIdx.map(i => protMean[i]);
        const plyV = validIdx.map(i => Math.max(0, protMean[i] - protStd[i]));
        const phyV = validIdx.map(i => protMean[i] + protStd[i]);
        const ryV = validIdx.map(i => precMean[i]);

        // Single cell reference: K562 ~150pg protein/cell
        const cellPg = 150;

        const traces = [
          // Error band — proteins
          { x:[...xV,...[...xV].reverse()], y:[...phyV,...[...plyV].reverse()],
            fill:'toself', fillcolor:'rgba(217,70,239,0.15)', line:{color:'transparent'},
            hoverinfo:'skip', showlegend:false, type:'scatter' },
          // Proteins line
          { x:xV, y:pyV, mode:'lines+markers',
            name:'Proteins', line:{color:_SC.violet,width:2.5},
            marker:{size:8,color:_SC.violet,symbol:'circle'},
            hovertemplate:'%{x:.0f}pg → %{y:,} proteins<extra></extra>' },
          // Precursors line
          { x:xV, y:ryV, mode:'lines+markers',
            name:'Precursors', line:{color:_SC.cyan,width:2,dash:'dot'},
            marker:{size:7,color:_SC.cyan,symbol:'diamond'},
            hovertemplate:'%{x:.0f}pg → %{y:,} precursors<extra></extra>' },
        ];

        const layout = {
          paper_bgcolor: _SC.bg, plot_bgcolor: _SC.surface,
          margin:{t:40,r:20,b:60,l:70},
          title:{ text:'Detection Sensitivity · K562 Dilution Series',
                  font:{color:_SC.text,size:13}, x:0.5 },
          xaxis:{ title:{text:'Input Amount (pg)',font:{color:_SC.muted,size:11}},
                  type:'log', tickfont:{color:_SC.muted}, gridcolor:_SC.border,
                  tickvals:[1,8,10,40,100,200,500,1000,5000,25000,125000],
                  ticktext:['1pg','8pg','10pg','40pg','100pg','200pg','500pg','1ng','5ng','25ng','125ng'] },
          yaxis:{ title:{text:'Count',font:{color:_SC.muted,size:11}},
                  type:'log', tickfont:{color:_SC.muted}, gridcolor:_SC.border },
          legend:{ font:{color:_SC.text}, bgcolor:'transparent', x:0.05, y:0.95 },
          shapes:[
            // Single cell reference line
            { type:'line', x0:cellPg, x1:cellPg, y0:0, y1:1, yref:'paper',
              line:{color:_SC.gold,width:1.5,dash:'dashdot'} },
          ],
          annotations:[
            { x:Math.log10(cellPg), y:0.97, xref:'x', yref:'paper',
              text:'≈1 cell (150pg)', showarrow:false,
              font:{color:_SC.gold,size:10}, xanchor:'left', xshift:5 }
          ],
        };

        window.Plotly.react(ref.current, traces, layout, {responsive:true,displayModeBar:false});
      }, [runs]);

      if (!runs.length) return React.createElement('div',{style:{color:_SC.muted,padding:40,textAlign:'center'}},'Loading K562 data…');
      return React.createElement('div',{ref,style:{height:400}});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 2 — Charge State Signature (real data)
    // Stacked bar: %charge 1/2/3/4+ across the dilution series
    // ═══════════════════════════════════════════════════════════════════════════
    function SCChargeSignature({ runs }) {
      const ref = useRef(null);

      useEffect(() => {
        if (!ref.current || !runs.length) return;

        // Group by input, take first rep with charge data
        const byAmt = {};
        runs.forEach(r => {
          if (!r.inputPg) return;
          const k = r.inputPg;
          if (!byAmt[k]) byAmt[k] = [];
          if (r.pct_charge_2 != null) byAmt[k].push(r);
        });

        const amts = Object.keys(byAmt).map(Number).sort((a,b)=>a-b);
        const mean = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
        const labels = amts.map(_scFmtAmt);

        const c1 = amts.map(a => {
          const reps = byAmt[a]; if (!reps.length) return 0;
          return mean(reps.map(r => (r.pct_charge_1||0)*100));
        });
        const c2 = amts.map(a => {
          const reps = byAmt[a]; if (!reps.length) return 0;
          return mean(reps.map(r => (r.pct_charge_2||0)*100));
        });
        const c3 = amts.map(a => {
          const reps = byAmt[a]; if (!reps.length) return 0;
          return mean(reps.map(r => (r.pct_charge_3||0)*100));
        });
        const c4 = amts.map(a => {
          const reps = byAmt[a]; if (!reps.length) return 0;
          const pc2 = mean(reps.map(r => (r.pct_charge_2||0)));
          const pc3 = mean(reps.map(r => (r.pct_charge_3||0)));
          const pc1 = mean(reps.map(r => (r.pct_charge_1||0)));
          return Math.max(0, (1 - pc1 - pc2 - pc3)*100);
        });

        const traces = [
          { name:'z=1', x:labels, y:c1, type:'bar', marker:{color:'rgba(218,170,0,0.7)'} },
          { name:'z=2', x:labels, y:c2, type:'bar', marker:{color:_SC.violet} },
          { name:'z=3', x:labels, y:c3, type:'bar', marker:{color:_SC.cyan} },
          { name:'z≥4', x:labels, y:c4, type:'bar', marker:{color:_SC.orange} },
        ];

        const layout = {
          barmode:'stack',
          paper_bgcolor:_SC.bg, plot_bgcolor:_SC.surface,
          margin:{t:40,r:20,b:60,l:60},
          title:{text:'Charge State Distribution vs Input · Lower Input = Simpler Sample',
                 font:{color:_SC.text,size:13},x:0.5},
          xaxis:{title:{text:'Input Amount',font:{color:_SC.muted,size:11}},
                 tickfont:{color:_SC.muted},gridcolor:_SC.border},
          yaxis:{title:{text:'% of Precursors',font:{color:_SC.muted,size:11}},
                 tickfont:{color:_SC.muted},gridcolor:_SC.border,range:[0,100]},
          legend:{font:{color:_SC.text},bgcolor:'transparent',orientation:'h',y:-0.15},
        };

        window.Plotly.react(ref.current, traces, layout, {responsive:true,displayModeBar:false});
      }, [runs]);

      return React.createElement('div',{ref,style:{height:400}});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 3 — 4D Ion Cloud (real API data from selected K562 run)
    // m/z × 1/K₀ × RT scatter, colored by charge state
    // ═══════════════════════════════════════════════════════════════════════════
    function SCIonCloud({ runs }) {
      const [selId, setSelId] = useState(null);
      const [ions, setIons] = useState(null);
      const [loading, setLoading] = useState(false);
      const ref = useRef(null);

      // Pick default: highest input run with full data
      useEffect(() => {
        if (runs.length && !selId) {
          const best = [...runs].sort((a,b)=>(b.n_proteins||0)-(a.n_proteins||0))[0];
          if (best) setSelId(best.id);
        }
      }, [runs]);

      useEffect(() => {
        if (!selId) return;
        setLoading(true);
        fetch(`/api/runs/${selId}/mobility-3d?max_features=6000`)
          .then(r=>r.json())
          .then(d=>{ setIons(d); setLoading(false); })
          .catch(()=>setLoading(false));
      }, [selId]);

      useEffect(() => {
        if (!ref.current || !ions || !ions.mz) return;

        const charges = [...new Set(ions.charge)].sort();
        const chargeColors = { 1:_SC.gold, 2:_SC.violet, 3:_SC.cyan, 4:_SC.orange, 5:_SC.rose };

        const traces = charges.map(z => {
          const idx = ions.charge.map((c,i)=>c===z?i:-1).filter(i=>i>=0);
          return {
            type:'scatter3d', mode:'markers', name:`z=${z}`,
            x: idx.map(i=>ions.mz[i]),
            y: idx.map(i=>ions.mobility[i]),
            z: idx.map(i=>ions.rt[i]/60),
            marker:{ size:1.8, color:chargeColors[z]||_SC.muted, opacity:0.7 },
            hovertemplate:`m/z: %{x:.2f}<br>1/K₀: %{y:.3f}<br>RT: %{z:.2f} min<extra>z=${z}</extra>`,
          };
        });

        const run = runs.find(r=>r.id===selId);
        const amtStr = run ? ` · ${_scFmtAmt(run.inputPg)}` : '';

        const layout = {
          paper_bgcolor:_SC.bg,
          margin:{t:40,r:0,b:0,l:0},
          title:{text:`4D Ion Space · K562${amtStr} · ${(ions.n_shown||0).toLocaleString()} ions`,
                 font:{color:_SC.text,size:13},x:0.5},
          scene:{
            xaxis:{title:'m/z',color:_SC.muted,gridcolor:_SC.border,backgroundcolor:_SC.surface},
            yaxis:{title:'1/K₀ (Vs/cm²)',color:_SC.muted,gridcolor:_SC.border,backgroundcolor:_SC.surface},
            zaxis:{title:'RT (min)',color:_SC.muted,gridcolor:_SC.border,backgroundcolor:_SC.surface},
            camera:{eye:{x:1.5,y:-1.5,z:0.8}},
          },
          legend:{font:{color:_SC.text},bgcolor:'transparent'},
        };

        window.Plotly.react(ref.current, traces, layout, {responsive:true,displayModeBar:false});
      }, [ions, selId]);

      const selRun = runs.find(r=>r.id===selId);

      return React.createElement('div', {style:{display:'flex',flexDirection:'column',gap:8}},
        // Run selector
        React.createElement('div', {style:{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}},
          React.createElement('span',{style:{color:_SC.muted,fontSize:12}},'Select run:'),
          ...runs.filter(r=>r.n_proteins).sort((a,b)=>a.inputPg-b.inputPg).map(r =>
            React.createElement('button', {
              key: r.id,
              onClick: ()=>setSelId(r.id),
              style:{
                padding:'3px 10px', borderRadius:4, fontSize:11, cursor:'pointer',
                background: selId===r.id ? _SC.violet : _SC.surface,
                color: selId===r.id ? '#fff' : _SC.muted,
                border: `1px solid ${selId===r.id ? _SC.violet : _SC.border}`,
              }
            }, _scFmtAmt(r.inputPg))
          ),
          loading && React.createElement('span',{style:{color:_SC.gold,fontSize:11}},'Loading ions…'),
        ),
        // 3D plot
        React.createElement('div', {ref, style:{height:440}}),
        // Stats bar
        ions && React.createElement('div', {style:{display:'flex',gap:24,padding:'8px 16px',background:_SC.surface,borderRadius:6,fontSize:11,color:_SC.muted}},
          React.createElement('span',null,`Total features: ${(ions.n_total||0).toLocaleString()}`),
          React.createElement('span',null,`Shown: ${(ions.n_shown||0).toLocaleString()}`),
          selRun && React.createElement('span',null,`Proteins: ${(selRun.n_proteins||0).toLocaleString()}`),
          selRun && React.createElement('span',null,`Peak width: ${selRun.median_peak_width_sec?.toFixed(1)||'—'}s`),
          selRun && React.createElement('span',null,`Points/peak: ${selRun.median_points_across_peak?.toFixed(0)||'—'}`),
        ),
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 4 — Peak Quality Metrics (real data)
    // Peak width (s) and sampling points vs input amount
    // ═══════════════════════════════════════════════════════════════════════════
    function SCPeakQuality({ runs }) {
      const ref = useRef(null);

      useEffect(() => {
        if (!ref.current || !runs.length) return;

        const withPeak = runs.filter(r=>r.median_peak_width_sec && r.inputPg);
        if (!withPeak.length) {
          window.Plotly.react(ref.current,
            [{type:'scatter',x:[],y:[]}],
            {paper_bgcolor:_SC.bg,plot_bgcolor:_SC.surface,
             margin:{t:60,r:20,b:60,l:60},
             annotations:[{x:0.5,y:0.5,xref:'paper',yref:'paper',
               text:'Peak width data not available for these runs',
               font:{color:_SC.muted,size:13},showarrow:false}]},
            {responsive:true,displayModeBar:false});
          return;
        }

        const amtLabels = withPeak.map(r => _scFmtAmt(r.inputPg));

        const traces = [
          { name:'Peak Width (s)', x:amtLabels, y:withPeak.map(r=>r.median_peak_width_sec),
            mode:'markers', marker:{color:_SC.violet,size:10,symbol:'circle'},
            type:'scatter', yaxis:'y',
            hovertemplate:'%{x}: %{y:.2f}s peak width<extra></extra>' },
          { name:'Points Across Peak', x:amtLabels, y:withPeak.map(r=>r.median_points_across_peak),
            mode:'markers', marker:{color:_SC.cyan,size:10,symbol:'diamond'},
            type:'scatter', yaxis:'y2',
            hovertemplate:'%{x}: %{y:.0f} points/peak<extra></extra>' },
        ];

        const layout = {
          paper_bgcolor:_SC.bg, plot_bgcolor:_SC.surface,
          margin:{t:40,r:70,b:70,l:60},
          title:{text:'Peak Quality vs Input · Sampling Density at Single-Cell Scale',
                 font:{color:_SC.text,size:13},x:0.5},
          xaxis:{title:{text:'Input Amount',font:{color:_SC.muted,size:11}},
                 tickfont:{color:_SC.muted},gridcolor:_SC.border,type:'category'},
          yaxis:{title:{text:'Peak Width (s)',font:{color:_SC.muted,size:11},standoff:10},
                 tickfont:{color:_SC.muted},gridcolor:_SC.border,color:_SC.violet},
          yaxis2:{title:{text:'Points Across Peak',font:{color:_SC.muted,size:11}},
                  tickfont:{color:_SC.muted},overlaying:'y',side:'right',color:_SC.cyan},
          legend:{font:{color:_SC.text},bgcolor:'transparent',x:0.05,y:0.95},
          shapes:[
            // Single cell zone
            { type:'rect',x0:-0.5,x1:withPeak.length-0.5,y0:0,y1:7,yref:'y',
              fillcolor:'rgba(218,170,0,0.05)',line:{color:'transparent'} }
          ],
        };

        window.Plotly.react(ref.current, traces, layout, {responsive:true,displayModeBar:false});
      }, [runs]);

      return React.createElement('div',{ref,style:{height:380}});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 5 — Coverage Model (fit real data → project single cell)
    // Michaelis-Menten fit to protein vs input, extrapolate to single cell
    // ═══════════════════════════════════════════════════════════════════════════
    function SCCoverageModel({ runs }) {
      const ref = useRef(null);

      useEffect(() => {
        if (!ref.current || !runs.length) return;

        const pts = runs.filter(r=>r.n_proteins&&r.inputPg).sort((a,b)=>a.inputPg-b.inputPg);
        if (pts.length < 2) return;

        // Simple Michaelis-Menten fit: y = Vmax * x / (Km + x)
        // Linearize: 1/y = 1/Vmax + Km/(Vmax * x)
        const inv_y = pts.map(r=>1/r.n_proteins);
        const inv_x = pts.map(r=>1/r.inputPg);
        // Linear regression on 1/y vs 1/x
        const n = pts.length;
        const sumX = inv_x.reduce((a,b)=>a+b,0);
        const sumY = inv_y.reduce((a,b)=>a+b,0);
        const sumXY = inv_x.reduce((s,v,i)=>s+v*inv_y[i],0);
        const sumX2 = inv_x.reduce((s,v)=>s+v*v,0);
        const slope  = (n*sumXY - sumX*sumY)/(n*sumX2 - sumX**2);
        const intercept = (sumY - slope*sumX)/n;
        const Vmax = 1/intercept;
        const Km   = slope * Vmax;

        // Extrapolate curve
        const logMin = -1, logMax = 5.5;
        const xCurve = [];
        for (let lx=logMin; lx<=logMax; lx+=0.05) xCurve.push(Math.pow(10,lx));
        const yCurve = xCurve.map(x => Vmax*x/(Km+x));

        // Confidence annotation at 150pg (single cell)
        const cellPg = 150;
        const cellProt = Math.round(Vmax*cellPg/(Km+cellPg));

        // Scatter of actual data points (all runs)
        const allRuns = runs.filter(r=>r.n_proteins&&r.inputPg);

        const traces = [
          // Fit curve
          { x:xCurve, y:yCurve, type:'scatter', mode:'lines', name:'MM fit',
            line:{color:_SC.gold,width:2}, hoverinfo:'skip' },
          // Single-cell projection vertical
          { x:[cellPg,cellPg], y:[0,cellProt], type:'scatter', mode:'lines',
            line:{color:_SC.gold,width:1,dash:'dot'}, showlegend:false, hoverinfo:'skip' },
          { x:[0.1,cellPg], y:[cellProt,cellProt], type:'scatter', mode:'lines',
            line:{color:_SC.gold,width:1,dash:'dot'}, showlegend:false, hoverinfo:'skip' },
          // Data points
          { x:allRuns.map(r=>r.inputPg), y:allRuns.map(r=>r.n_proteins),
            type:'scatter', mode:'markers', name:'Observed',
            marker:{color:_SC.violet,size:10,line:{color:'#fff',width:1}},
            hovertemplate:'%{x:.0f}pg → %{y:,} proteins<extra></extra>' },
        ];

        const layout = {
          paper_bgcolor:_SC.bg, plot_bgcolor:_SC.surface,
          margin:{t:40,r:20,b:60,l:70},
          title:{text:`Coverage Model · Projected single-cell depth: ~${cellProt.toLocaleString()} proteins`,
                 font:{color:_SC.text,size:13},x:0.5},
          xaxis:{title:{text:'Input Amount (pg)',font:{color:_SC.muted,size:11}},
                 type:'log',tickfont:{color:_SC.muted},gridcolor:_SC.border,
                 tickvals:[1,8,40,150,500,1000,5000,25000,125000],
                 ticktext:['1pg','8pg','40pg','150pg','500pg','1ng','5ng','25ng','125ng']},
          yaxis:{title:{text:'Proteins Identified',font:{color:_SC.muted,size:11}},
                 tickfont:{color:_SC.muted},gridcolor:_SC.border},
          legend:{font:{color:_SC.text},bgcolor:'transparent',x:0.6,y:0.15},
          annotations:[
            { x:Math.log10(cellPg), y:cellProt, xref:'x',yref:'y',
              text:`  ← 1 cell: ~${cellProt.toLocaleString()} proteins`,
              font:{color:_SC.gold,size:11},showarrow:false,xanchor:'left' }
          ],
        };

        window.Plotly.react(ref.current, traces, layout, {responsive:true,displayModeBar:false});
      }, [runs]);

      return React.createElement('div',{ref,style:{height:400}});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 6 — Surfaceome Atlas (synthetic, modeled on real K562 charge/mob)
    // Ion mobility atlas of canonical K562 surface markers
    // ═══════════════════════════════════════════════════════════════════════════
    const _SC_SURFACE_MARKERS = [
      // [name, mz, k0, logAbund, pathway]
      // K562 is a CML cell line — BCR-ABL, myeloid surface
      ['CD34',  490, 0.78, 6.8, 'Stem/Progenitor'],
      ['CD43',  720, 0.88, 7.1, 'Stem/Progenitor'],
      ['CD117', 960, 1.02, 6.5, 'Stem/Progenitor'],
      ['CD33',  820, 0.82, 7.4, 'Myeloid'],
      ['CD13',  680, 0.80, 7.2, 'Myeloid'],
      ['CD15',  540, 0.70, 6.9, 'Myeloid'],
      ['CD66',  890, 0.95, 6.7, 'Myeloid'],
      ['CD71',  750, 0.91, 7.6, 'Transferrin R'],
      ['TfR1',  840, 0.97, 7.5, 'Transferrin R'],
      ['CD29',  680, 0.83, 7.0, 'Integrin'],
      ['CD49e', 920, 1.05, 6.6, 'Integrin'],
      ['ITGAV', 870, 0.99, 6.8, 'Integrin'],
      ['HLA-A', 900, 0.93, 7.3, 'MHC-I'],
      ['HLA-B', 910, 0.94, 7.2, 'MHC-I'],
      ['β2M',   610, 0.64, 7.8, 'MHC-I'],
      ['CD45',  1080,1.12, 7.5, 'Pan-leukocyte'],
      ['CD44',  930, 1.01, 7.3, 'Pan-leukocyte'],
      ['CD47',  830, 0.88, 7.6, 'Pan-leukocyte'],
      ['CD58',  760, 0.86, 7.0, 'Adhesion'],
      ['ICAM1', 940, 1.04, 6.8, 'Adhesion'],
      ['CD2',   680, 0.73, 6.5, 'Adhesion'],
      ['ABL1',  560, 0.76, 6.2, 'BCR-ABL'],
      ['BCR',   780, 0.90, 6.3, 'BCR-ABL'],
    ];

    const _SC_PATHWAY_COLORS = {
      'Stem/Progenitor': _SC.gold,
      'Myeloid':         _SC.violet,
      'Transferrin R':   _SC.cyan,
      'Integrin':        _SC.green,
      'MHC-I':           _SC.orange,
      'Pan-leukocyte':   _SC.indigo,
      'Adhesion':        _SC.rose,
      'BCR-ABL':         '#ff6b6b',
    };

    function SCSurfaceomeAtlas({ runs }) {
      const ref = useRef(null);
      const [selId, setSelId] = useState(null);
      const [ions, setIons] = useState(null);

      useEffect(()=>{
        if (runs.length && !selId) {
          const best = [...runs].sort((a,b)=>(b.n_proteins||0)-(a.n_proteins||0))[0];
          if (best) setSelId(best.id);
        }
      },[runs]);

      useEffect(()=>{
        if (!selId) return;
        fetch(`/api/runs/${selId}/mobility-3d?max_features=5000`)
          .then(r=>r.json()).then(setIons).catch(()=>{});
      },[selId]);

      useEffect(()=>{
        if (!ref.current) return;

        const { r, rN } = _scRand(9001);
        const pathways = [...new Set(_SC_SURFACE_MARKERS.map(m=>m[4]))];

        const traces = [];

        // Background cloud from real ions (if available)
        if (ions?.mz) {
          traces.push({
            type:'scatter', mode:'markers',
            x: ions.mz, y: ions.mobility,
            marker:{ size:2, color:'rgba(180,100,255,0.12)', symbol:'circle' },
            hoverinfo:'skip', showlegend:false, name:'background',
          });
        }

        // Surface marker overlays by pathway
        pathways.forEach(pw => {
          const markers = _SC_SURFACE_MARKERS.filter(m=>m[4]===pw);
          const c = _SC_PATHWAY_COLORS[pw] || _SC.muted;
          traces.push({
            type:'scatter', mode:'markers+text',
            name: pw,
            x: markers.map(m => m[1] + rN()*12),
            y: markers.map(m => m[2] + rN()*0.02),
            text: markers.map(m => m[0]),
            textposition: 'top center',
            textfont: { color:c, size:9 },
            marker:{ size:markers.map(m=>4+m[3]-4), color:c,
                     symbol:'circle', opacity:0.9,
                     line:{color:c,width:1} },
            hovertemplate: markers.map(m =>
              `<b>${m[0]}</b><br>m/z: ${m[1]}<br>1/K₀: ${m[2]}<br>Pathway: ${pw}<extra></extra>`
            ),
          });
        });

        // CCS corridors
        const corridorShapes = [2,3,4].map(z => {
          const mzArr=[], y0Arr=[], y1Arr=[];
          for(let mz=400;mz<=1200;mz+=50){
            const k0 = _lsCcsExpected(mz,z);
            mzArr.push(mz); y0Arr.push(k0-0.04); y1Arr.push(k0+0.04);
          }
          return null; // skip shapes for simplicity, use scatter instead
        }).filter(Boolean);

        [2,3,4].forEach(z=>{
          const mzArr=[], k0Arr=[];
          for(let mz=400;mz<=1200;mz+=20){
            mzArr.push(mz); k0Arr.push(_lsCcsExpected(mz,z));
          }
          traces.push({
            type:'scatter', mode:'lines', name:`CCS corridor z=${z}`,
            x:mzArr, y:k0Arr,
            line:{color:`rgba(255,255,255,0.12)`,width:1,dash:'dot'},
            hoverinfo:'skip', showlegend:false,
          });
        });

        const run = runs.find(r=>r.id===selId);
        const layout = {
          paper_bgcolor:_SC.bg, plot_bgcolor:_SC.surface,
          margin:{t:40,r:20,b:60,l:70},
          title:{text:`K562 Surfaceome Atlas · m/z × Ion Mobility Space${run?' · '+_scFmtAmt(run.inputPg):''}`,
                 font:{color:_SC.text,size:13},x:0.5},
          xaxis:{title:{text:'m/z',font:{color:_SC.muted,size:11}},
                 tickfont:{color:_SC.muted},gridcolor:_SC.border,range:[400,1250]},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{color:_SC.muted,size:11}},
                 tickfont:{color:_SC.muted},gridcolor:_SC.border,range:[0.45,1.45]},
          legend:{font:{color:_SC.text,size:10},bgcolor:'rgba(14,0,24,0.8)',
                  x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
        };

        window.Plotly.react(ref.current, traces, layout, {responsive:true,displayModeBar:false});
      },[ions, runs, selId]);

      return React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:8}},
        React.createElement('div',{style:{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}},
          React.createElement('span',{style:{color:_SC.muted,fontSize:12}},'Background ions:'),
          ...runs.filter(r=>r.n_proteins).sort((a,b)=>a.inputPg-b.inputPg).map(r=>
            React.createElement('button',{
              key:r.id, onClick:()=>setSelId(r.id),
              style:{padding:'3px 10px',borderRadius:4,fontSize:11,cursor:'pointer',
                     background:selId===r.id?_SC.purple:_SC.surface,
                     color:selId===r.id?'#fff':_SC.muted,
                     border:`1px solid ${selId===r.id?_SC.purple:_SC.border}`}
            }, _scFmtAmt(r.inputPg))
          ),
        ),
        React.createElement('div',{ref,style:{height:480}}),
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 7 — Depth-vs-Gradient  (real data scatter: gradient_length_min or
    //           median_peak_width_sec as proxy)
    // Jitter plot showing protein count stratified by dilution group
    // ═══════════════════════════════════════════════════════════════════════════
    function SCJitterPlot({ runs }) {
      const ref = useRef(null);

      useEffect(()=>{
        if (!ref.current || !runs.length) return;

        const { r } = _scRand(42);
        const withData = runs.filter(x=>x.n_proteins&&x.inputPg);
        if (!withData.length) return;

        // Group by amount label
        const groups = {};
        withData.forEach(run=>{
          const lbl = _scFmtAmt(run.inputPg);
          if(!groups[lbl]) groups[lbl]={runs:[],pg:run.inputPg};
          groups[lbl].runs.push(run);
        });
        const labels = Object.keys(groups).sort((a,b)=>groups[a].pg-groups[b].pg);

        const getColor = pg => {
          if (pg <= 10)   return _SC.gold;
          if (pg <= 50)   return _SC.orange;
          if (pg <= 200)  return _SC.violet;
          if (pg <= 2000) return _SC.cyan;
          return _SC.green;
        };

        const traces = labels.map(lbl=>{
          const grp = groups[lbl];
          const jitter = grp.runs.map(()=>(r()-0.5)*0.4);
          const xi = labels.indexOf(lbl);
          return {
            type:'scatter', mode:'markers', name:lbl,
            x: grp.runs.map((_,i)=>xi+jitter[i]),
            y: grp.runs.map(run=>run.n_proteins),
            marker:{
              size:grp.runs.map(run=>6+Math.sqrt(run.n_precursors||1)/100),
              color:getColor(grp.pg),
              opacity:0.85,
              line:{color:'rgba(255,255,255,0.3)',width:1},
            },
            hovertemplate: grp.runs.map(run=>
              `<b>${lbl}</b><br>` +
              `Proteins: ${run.n_proteins?.toLocaleString()}<br>` +
              `Precursors: ${run.n_precursors?.toLocaleString()}<br>` +
              `Peak width: ${run.median_peak_width_sec?.toFixed(1)}s<extra></extra>`
            ),
          };
        });

        const layout = {
          paper_bgcolor:_SC.bg, plot_bgcolor:_SC.surface,
          margin:{t:40,r:20,b:60,l:70},
          title:{text:'Replicate Depth · All K562 Runs (size ∝ precursor count)',
                 font:{color:_SC.text,size:13},x:0.5},
          xaxis:{tickvals:labels.map((_,i)=>i),ticktext:labels,
                 tickfont:{color:_SC.muted},gridcolor:_SC.border,
                 title:{text:'Input Amount',font:{color:_SC.muted,size:11}}},
          yaxis:{title:{text:'Proteins Identified',font:{color:_SC.muted,size:11}},
                 tickfont:{color:_SC.muted},gridcolor:_SC.border},
          showlegend:false,
          shapes:[
            { type:'rect', x0:-0.5, x1:labels.length-0.5,
              y0:2500, y1:4000, yref:'y',
              fillcolor:'rgba(218,170,0,0.06)', line:{color:_SC.gold,width:1,dash:'dot'} }
          ],
          annotations:[{
            x:labels.length*0.6, y:3200, xref:'x', yref:'y',
            text:'← Single-cell depth range', showarrow:false,
            font:{color:_SC.gold,size:10}
          }],
        };

        window.Plotly.react(ref.current, traces, layout, {responsive:true,displayModeBar:false});
      },[runs]);

      return React.createElement('div',{ref,style:{height:380}});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Main Tab
    // ═══════════════════════════════════════════════════════════════════════════
    function SingleCellTab() {
      const [panel, setPanel] = useState('sensitivity');
      const { data: allRuns } = useFetch('/api/runs');

      // Parse and filter K562 runs
      const k562Runs = useMemo(()=>{
        if (!allRuns) return [];
        return allRuns
          .filter(r=>r.run_name&&r.run_name.includes('K562'))
          .map(r=>({...r, inputPg:_scParseAmountPg(r.run_name)}))
          .filter(r=>r.inputPg!==null);
      },[allRuns]);

      const withData = k562Runs.filter(r=>r.n_proteins);
      const amtGroups = [...new Set(withData.map(r=>r.inputPg))].sort((a,b)=>a-b);
      const maxProt   = Math.max(...withData.map(r=>r.n_proteins||0));
      const cellProt  = (() => {
        // MM estimate at 150pg
        const pts = withData.sort((a,b)=>a.inputPg-b.inputPg);
        if (pts.length < 2) return '—';
        const inv_y = pts.map(r=>1/r.n_proteins), inv_x = pts.map(r=>1/r.inputPg);
        const n=pts.length,sX=inv_x.reduce((a,b)=>a+b,0),sY=inv_y.reduce((a,b)=>a+b,0);
        const sXY=inv_x.reduce((s,v,i)=>s+v*inv_y[i],0),sX2=inv_x.reduce((s,v)=>s+v*v,0);
        const sl=(n*sXY-sX*sY)/(n*sX2-sX**2),ic=(sY-sl*sX)/n;
        if(!ic||ic<=0) return '—';
        const Vmax=1/ic,Km=sl*Vmax;
        const cellPg=150;
        return Math.round(Vmax*cellPg/(Km+cellPg)).toLocaleString();
      })();

      const PANELS = [
        { id:'sensitivity', label:'Sensitivity Curve'  },
        { id:'charge',      label:'Charge Signature'   },
        { id:'ioncloud',    label:'4D Ion Cloud'        },
        { id:'peaks',       label:'Peak Quality'        },
        { id:'model',       label:'Coverage Model'      },
        { id:'surfaceome',  label:'Surfaceome Atlas'    },
        { id:'jitter',      label:'Run Replicates'      },
      ];

      return React.createElement('div', {style:{padding:16,display:'flex',flexDirection:'column',gap:16}},

        // ── Header ──────────────────────────────────────────────────────────
        React.createElement('div', {style:{
          background:`linear-gradient(135deg,#1a0030 0%,#2d0060 50%,#1a0030 100%)`,
          border:`1px solid ${_SC.border}`,borderRadius:10,padding:'16px 24px',
          display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12,
        }},
          React.createElement('div', null,
            React.createElement('div',{style:{
              fontSize:22,fontWeight:700,letterSpacing:4,
              background:`linear-gradient(90deg,${_SC.gold},${_SC.violet},${_SC.cyan})`,
              WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',
            }},'SINGLE CELL PROTEOMICS'),
            React.createElement('div',{style:{color:_SC.muted,fontSize:12,marginTop:3}},
              `K562 CML Cell Line · ${k562Runs.length} runs · ${amtGroups.length} input levels · real timsTOF Ultra data`
            ),
          ),
          // Summary badges
          React.createElement('div',{style:{display:'flex',gap:12,flexWrap:'wrap'}},
            [
              ['Runs w/ Data', withData.length],
              ['Max Proteins', maxProt.toLocaleString()],
              ['~1 Cell Depth', cellProt],
              ['Input Range', `${_scFmtAmt(amtGroups[0]||1)}–${_scFmtAmt(amtGroups[amtGroups.length-1]||1)}`],
            ].map(([label,val])=>
              React.createElement('div',{key:label,style:{
                background:_SC.surface,border:`1px solid ${_SC.border}`,
                borderRadius:8,padding:'8px 14px',textAlign:'center',
              }},
                React.createElement('div',{style:{color:_SC.violet,fontWeight:700,fontSize:16}},val),
                React.createElement('div',{style:{color:_SC.muted,fontSize:10}},label),
              )
            ),
          ),
        ),

        // ── Panel nav ────────────────────────────────────────────────────────
        React.createElement('div', {style:{display:'flex',gap:6,flexWrap:'wrap'}},
          PANELS.map(p=>
            React.createElement('button',{
              key:p.id, onClick:()=>setPanel(p.id),
              style:{
                padding:'6px 14px',borderRadius:6,fontSize:12,cursor:'pointer',
                background:panel===p.id?_SC.violet:_SC.surface,
                color:panel===p.id?'#fff':_SC.muted,
                border:`1px solid ${panel===p.id?_SC.violet:_SC.border}`,
                transition:'all 0.15s',
              }
            }, p.label)
          ),
        ),

        // ── No K562 runs warning ─────────────────────────────────────────────
        !allRuns && React.createElement('div',{style:{color:_SC.muted,textAlign:'center',padding:40}},
          'Loading runs…'),

        allRuns && !k562Runs.length && React.createElement('div',{
          style:{background:_SC.surface,border:`1px solid ${_SC.border}`,borderRadius:8,
                 padding:40,textAlign:'center',color:_SC.muted}},
          React.createElement('div',{style:{fontSize:32,marginBottom:12}},'🔬'),
          React.createElement('div',{style:{fontSize:16,color:_SC.text}},'No K562 runs found'),
          React.createElement('div',{style:{fontSize:12,marginTop:8}},
            'Single Cell tab uses K562 dilution series runs (run name must contain "K562")'),
        ),

        // ── Active panel ─────────────────────────────────────────────────────
        k562Runs.length > 0 && React.createElement('div', {
          style:{background:_SC.surface,border:`1px solid ${_SC.border}`,borderRadius:10,padding:20}
        },
          panel==='sensitivity' && React.createElement(SCSensitivityCurve,{runs:k562Runs}),
          panel==='charge'      && React.createElement(SCChargeSignature,{runs:k562Runs}),
          panel==='ioncloud'    && React.createElement(SCIonCloud,{runs:k562Runs}),
          panel==='peaks'       && React.createElement(SCPeakQuality,{runs:k562Runs}),
          panel==='model'       && React.createElement(SCCoverageModel,{runs:k562Runs}),
          panel==='surfaceome'  && React.createElement(SCSurfaceomeAtlas,{runs:k562Runs}),
          panel==='jitter'      && React.createElement(SCJitterPlot,{runs:k562Runs}),
        ),
      );
    }
