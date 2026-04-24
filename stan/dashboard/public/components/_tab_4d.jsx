    /* ── 4D Advantage Tab ──────────────────────────────────────────── */

    function AdvantageTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [searchTerm, setSearchTerm]   = useState('');
      const [data3d, setData3d]           = useState(null);
      const [windowData, setWindowData]   = useState(null);
      const [pasefData, setPasefData]     = useState(null);
      const [loading, setLoading]         = useState(false);

      const corridorRef  = useRef(null);
      const congLeftRef  = useRef(null);
      const congRightRef = useRef(null);
      const coverageRef  = useRef(null);
      const chimeraRef   = useRef(null);
      const breatheRef   = useRef(null);
      const fpARef       = useRef(null);
      const fpBRef       = useRef(null);
      const fpDiffRef    = useRef(null);
      const playAnimRef  = useRef(null);
      const playLastRef  = useRef(0);

      // ── Novel-viz state ─────────────────────────────────────────────
      const [rtSliderPct, setRtSliderPct]   = useState(50);
      const [playing, setPlaying]           = useState(false);
      const [selectedRun2, setSelectedRun2] = useState(null);
      const [searchTerm2, setSearchTerm2]   = useState('');
      const [data3d2, setData3d2]           = useState(null);
      const [loadingCompare, setLoadingCompare] = useState(false);

      const Z_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};

      // ── Only .d runs have ion mobility ──────────────────────────────
      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.raw_path && r.raw_path.endsWith('.d'));
      }, [allRuns]);

      const filteredRuns = useMemo(() => {
        if (!searchTerm) return dRuns;
        const q = searchTerm.toLowerCase();
        return dRuns.filter(r => (r.run_name||'').toLowerCase().includes(q) || (r.instrument||'').toLowerCase().includes(q));
      }, [dRuns, searchTerm]);

      // Auto-select first run when list loads
      useEffect(() => {
        if (dRuns.length > 0 && !selectedRun) setSelectedRun(dRuns[0]);
      }, [dRuns]);

      // ── Purge all Plotly charts when this tab unmounts ───────────────
      useEffect(() => {
        return () => {
          [corridorRef, congLeftRef, congRightRef, coverageRef, chimeraRef, breatheRef, fpARef, fpBRef].forEach(r => {
            if (r.current && window.Plotly) window.Plotly.purge(r.current);
          });
        };
      }, []);

      // ── Fetch data when run changes ──────────────────────────────────
      useEffect(() => {
        if (!selectedRun) return;
        const ac = new AbortController();
        setLoading(true);
        setData3d(null); setWindowData(null); setPasefData(null);
        Promise.all([
          fetch(API + `/api/runs/${selectedRun.id}/mobility-3d?max_features=5000`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/dia-windows`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/pasef-windows`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
        ]).then(([d3, wins, pasef]) => {
          setData3d(d3?.rt?.length ? d3 : null);
          setWindowData(wins?.windows?.length ? wins : null);
          setPasefData(pasef?.events?.length ? pasef : null);
          setLoading(false);
        }).catch(e => { if (e.name !== 'AbortError') setLoading(false); });
        return () => ac.abort();
      }, [selectedRun?.id]);

      // ── Derived: linear corridor fit per charge state ─────────────────
      const corridorFits = useMemo(() => {
        if (!data3d?.mz?.length) return {};
        const fits = {};
        [...new Set(data3d.charge)].filter(z => z > 0).forEach(z => {
          const idx = data3d.mz.map((_, i) => data3d.charge[i] === z ? i : -1).filter(i => i >= 0);
          if (idx.length < 15) return;
          const mzArr = idx.map(i => data3d.mz[i]);
          const k0Arr = idx.map(i => data3d.mobility[i]);
          const n = mzArr.length;
          const mx = mzArr.reduce((a,v)=>a+v,0)/n, my = k0Arr.reduce((a,v)=>a+v,0)/n;
          let sxx=0, sxy=0, syy=0;
          for (let i=0;i<n;i++){const dx=mzArr[i]-mx,dy=k0Arr[i]-my;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy;}
          const slope = sxy/sxx, intercept = my - slope*mx;
          const r2 = sxx>0&&syy>0 ? (sxy*sxy)/(sxx*syy) : 0;
          let rv=0; for(let i=0;i<n;i++) rv+=(k0Arr[i]-(slope*mzArr[i]+intercept))**2;
          const resStd = Math.sqrt(rv/n);
          fits[z] = { slope, intercept, r2, resStd, mzMin:Math.min(...mzArr), mzMax:Math.max(...mzArr), n };
        });
        return fits;
      }, [data3d]);

      // ── Derived: most congested m/z window (the "isolation challenge") ─
      const congestedWindow = useMemo(() => {
        if (!data3d?.mz?.length) return null;
        const bins = {};
        data3d.mz.forEach(m => { const b = Math.floor(m); bins[b] = (bins[b]||0)+1; });
        let topBin=null, topCount=0;
        for (const [b,c] of Object.entries(bins)) { if(c>topCount){topCount=c;topBin=+b;} }
        if (topBin===null) return null;
        const mzLo = topBin - 2, mzHi = topBin + 3;
        const idx = data3d.mz.map((m,i) => m>=mzLo&&m<=mzHi ? i : -1).filter(i=>i>=0);
        if (idx.length < 5) return null;
        // Cap at 400 ions for pairwise calc
        const sample = idx.length > 400 ? idx.slice(0,400) : idx;
        const ions = sample.map(i => ({ mz:data3d.mz[i], ook0:data3d.mobility[i], charge:data3d.charge[i] }));
        let coIso1D=0, coIso2D=0;
        for (let i=0;i<ions.length;i++){
          let n1=false,n2=false;
          for (let j=0;j<ions.length;j++){
            if(i===j) continue;
            if(Math.abs(ions[i].mz-ions[j].mz)<0.5){
              n1=true;
              if(Math.abs(ions[i].ook0-ions[j].ook0)<0.07){n2=true;break;}
            }
          }
          if(n1) coIso1D++; if(n2) coIso2D++;
        }
        const resolved = coIso1D > 0 ? Math.round((coIso1D-coIso2D)/coIso1D*100) : 0;
        return { mzLo, mzHi, ions, n:idx.length, coIso1D, coIso2D, resolved };
      }, [data3d]);

      // ── CHART 1: Corridor ─────────────────────────────────────────────
      useEffect(() => {
        if (!corridorRef.current || !window.Plotly) return;
        if (!data3d || !Object.keys(corridorFits).length) { window.Plotly.purge(corridorRef.current); return; }
        const traces = [];
        // Ion scatter per charge state
        const charges = [...new Set(data3d.charge)].sort((a,b)=>a-b);
        charges.forEach(z => {
          const idx = data3d.mz.map((_,i)=>data3d.charge[i]===z?i:-1).filter(i=>i>=0);
          traces.push({
            type:'scatter', mode:'markers',
            name: z===0?'Unassigned':'z = +'+z,
            x: idx.map(i=>data3d.mz[i]),
            y: idx.map(i=>data3d.mobility[i]),
            marker:{ size:2.5, color:Z_COLORS[z]||'#94a3b8', opacity:0.55 },
            hovertemplate:`m/z %{x:.2f}<br>1/K₀ %{y:.4f}<br>${z===0?'Unassigned':'z=+'+z}<extra></extra>`,
          });
        });
        // Fitted corridor lines per charge state
        Object.entries(corridorFits).forEach(([z, fit]) => {
          const col = Z_COLORS[+z] || '#94a3b8';
          const xs = [fit.mzMin, fit.mzMax];
          const ys = xs.map(m => fit.slope*m + fit.intercept);
          traces.push({
            type:'scatter', mode:'lines',
            name:`z=+${z} fit (R²=${fit.r2.toFixed(3)})`,
            x: xs, y: ys,
            line:{ color:col, width:2.5, dash:'dot' },
            hoverinfo:'skip',
          });
          // ±2σ band as a filled area (upper + lower)
          const nPts = 60;
          const mzStep = (fit.mzMax - fit.mzMin) / (nPts - 1);
          const bx = Array.from({length:nPts*2+2}, (_,i)=>{
            if(i<nPts) return fit.mzMin + i*mzStep;
            if(i===nPts) return fit.mzMax;
            if(i===nPts+1) return fit.mzMax;
            return fit.mzMin + (nPts*2+1-i)*mzStep;
          });
          const by = bx.map((m,i) => {
            const base = fit.slope*m + fit.intercept;
            return i < nPts+1 ? base + 2*fit.resStd : base - 2*fit.resStd;
          });
          const [r,g,b2] = [parseInt((Z_COLORS[+z]||'#94a3b8').slice(1,3),16), parseInt((Z_COLORS[+z]||'#94a3b8').slice(3,5),16), parseInt((Z_COLORS[+z]||'#94a3b8').slice(5,7),16)];
          traces.push({
            type:'scatter', mode:'lines', name:`z=+${z} ±2σ`,
            x:bx, y:by,
            fill:'toself', fillcolor:`rgba(${r},${g},${b2},0.07)`,
            line:{ color:'transparent' }, showlegend:false, hoverinfo:'skip',
          });
        });
        window.Plotly.react(corridorRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:20,t:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:9},x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage']});
      }, [data3d, corridorFits]);

      // ── CHART 2A: Congestion — 1D histogram ───────────────────────────
      useEffect(() => {
        if (!congLeftRef.current || !window.Plotly) return;
        if (!congestedWindow) { window.Plotly.purge(congLeftRef.current); return; }
        const { ions, mzLo, mzHi } = congestedWindow;
        const binW = 0.1, bins = {};
        ions.forEach(ion => {
          const b = +(Math.floor(ion.mz/binW)*binW).toFixed(2);
          bins[b] = (bins[b]||0)+1;
        });
        const bKeys = Object.keys(bins).map(Number).sort((a,b)=>a-b);
        window.Plotly.react(congLeftRef.current, [{
          type:'bar', x:bKeys, y:bKeys.map(k=>bins[k]),
          marker:{color:'rgba(248,113,113,0.7)', line:{color:'#ef4444',width:1}},
          hovertemplate:'m/z %{x:.2f}<br>%{y} ions<extra></extra>',
          name:'Ions per 0.1 Th bin',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:50,r:10,t:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc',range:[mzLo-0.2,mzHi+0.2]},
          yaxis:{title:{text:'Ion count',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{x:(mzLo+mzHi)/2, yref:'paper', y:0.96,
            text:`${congestedWindow.n} ions in ${(mzHi-mzLo).toFixed(0)} Th window`,
            showarrow:false, font:{color:'#f87171',size:10}}],
          showlegend:false,
        }, {responsive:true, displayModeBar:false});
      }, [congestedWindow]);

      // ── CHART 2B: Congestion — m/z × 1/K₀ scatter ────────────────────
      useEffect(() => {
        if (!congRightRef.current || !window.Plotly) return;
        if (!congestedWindow) { window.Plotly.purge(congRightRef.current); return; }
        const { ions } = congestedWindow;
        const charges = [...new Set(ions.map(p=>p.charge))].sort((a,b)=>a-b);
        const traces = charges.map(z => {
          const pts = ions.filter(p=>p.charge===z);
          return {
            type:'scatter', mode:'markers',
            name: z===0?'Unassigned':'z = +'+z,
            x:pts.map(p=>p.mz), y:pts.map(p=>p.ook0),
            marker:{size:5, color:Z_COLORS[z]||'#94a3b8', opacity:0.75},
            hovertemplate:`m/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>${z===0?'?':'z=+'+z}<extra></extra>`,
          };
        });
        window.Plotly.react(congRightRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:60,r:10,t:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',font:{size:9},x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{x:'0.5',y:0.97,xref:'paper',yref:'paper',
            text:`${congestedWindow.resolved}% resolved by mobility`,
            showarrow:false,font:{color:'#22c55e',size:10}}],
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage']});
      }, [congestedWindow]);

      // ── CHART 3: Coverage — ion cloud + actual windows ────────────────
      useEffect(() => {
        if (!coverageRef.current || !window.Plotly) return;
        if (!data3d) { window.Plotly.purge(coverageRef.current); return; }
        const hasWindows = windowData?.windows?.length || pasefData?.events?.length;
        const charges = [...new Set(data3d.charge)].sort((a,b)=>a-b);
        const traces = charges.map(z => {
          const idx = data3d.mz.map((_,i)=>data3d.charge[i]===z?i:-1).filter(i=>i>=0);
          return {
            type:'scatter', mode:'markers',
            name:z===0?'Unassigned':'z = +'+z,
            x:idx.map(i=>data3d.mz[i]), y:idx.map(i=>data3d.mobility[i]),
            marker:{size:2.5, color:Z_COLORS[z]||'#94a3b8', opacity:0.5},
            hovertemplate:`m/z %{x:.2f}<br>1/K₀ %{y:.4f}<extra>${z===0?'?':'z=+'+z}</extra>`,
          };
        });
        const shapes = [];
        const winColor = (gi, total) => {
          const h = Math.round((gi / Math.max(total,1)) * 300);
          return `hsl(${h},70%,55%)`;
        };
        if (windowData?.windows?.length) {
          const groups = [...new Set(windowData.windows.map(w=>w.window_group))];
          windowData.windows.forEach(w => {
            const col = winColor(groups.indexOf(w.window_group), groups.length);
            const hasK0 = w.oneoverk0_lower > 0 && w.oneoverk0_upper > 0;
            shapes.push({ type:'rect', x0:w.mz_lower, x1:w.mz_upper,
              y0:hasK0?w.oneoverk0_lower:0.55, y1:hasK0?w.oneoverk0_upper:1.65,
              fillcolor:`rgba(56,189,248,0.06)`, line:{color:'rgba(56,189,248,0.55)',width:1} });
          });
        }
        if (pasefData?.events?.length) {
          pasefData.events.forEach(e => {
            shapes.push({ type:'rect', x0:e.mz_lower, x1:e.mz_upper,
              y0:e.oneoverk0_lower>0?e.oneoverk0_lower:0.6, y1:e.oneoverk0_upper>0?e.oneoverk0_upper:1.6,
              fillcolor:'rgba(251,191,36,0.05)', line:{color:'rgba(251,191,36,0.50)',width:0.8} });
          });
        }
        let coveragePct = null;
        if (hasWindows && data3d.mz.length) {
          let inside = 0;
          for (let i = 0; i < data3d.mz.length; i++) {
            const m = data3d.mz[i], k = data3d.mobility[i];
            let hit = false;
            if (windowData?.windows) for (const w of windowData.windows) {
              if (m>=w.mz_lower&&m<=w.mz_upper&&(!w.oneoverk0_lower||k>=w.oneoverk0_lower&&k<=w.oneoverk0_upper)){hit=true;break;}
            }
            if (!hit && pasefData?.events) for (const e of pasefData.events) {
              if (m>=e.mz_lower&&m<=e.mz_upper&&k>=e.oneoverk0_lower&&k<=e.oneoverk0_upper){hit=true;break;}
            }
            if (hit) inside++;
          }
          coveragePct = Math.round(inside/data3d.mz.length*100);
        }
        window.Plotly.react(coverageRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:60,r:15,t:hasWindows?30:15,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:9},x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes,
          ...(coveragePct!==null ? {annotations:[{xref:'paper',yref:'paper',x:0.99,y:0.99,
            text:`<b>${coveragePct}%</b> of ions within a window`,
            showarrow:false,font:{color:'#38bdf8',size:11},xanchor:'right'}]} : {}),
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage']});
      }, [data3d, windowData, pasefData]);

      // ── Corridor stats summary ─────────────────────────────────────────
      const corridorSummary = useMemo(() => {
        const entries = Object.entries(corridorFits);
        if (!entries.length) return null;
        const avgR2 = entries.reduce((a,[,f])=>a+f.r2,0)/entries.length;
        const totalIons = data3d?.mz?.length || 0;
        const charges = entries.map(([z])=>'+'+z).join(', ');
        return { avgR2, totalIons, charges };
      }, [corridorFits, data3d]);

      // ── NOVEL 1: Chimera counts via spatial hash ────────────────────────
      // For each ion: how many neighbors within ±0.5 Th (1D) vs ±0.5 Th × ±0.06 Vs/cm² (2D)
      const chimeraCounts = useMemo(() => {
        if (!data3d?.mz?.length) return null;
        const n = data3d.mz.length;
        const BIN = 0.5, MOB = 0.06;
        const hash = {};
        for (let i = 0; i < n; i++) {
          const b = Math.floor(data3d.mz[i] / BIN);
          if (!hash[b]) hash[b] = [];
          hash[b].push(i);
        }
        const n1D = new Int16Array(n);
        const n2D = new Int16Array(n);
        for (let i = 0; i < n; i++) {
          const bC = Math.floor(data3d.mz[i] / BIN);
          for (const b of [bC-1, bC, bC+1]) {
            const bucket = hash[b]; if (!bucket) continue;
            for (const j of bucket) {
              if (j === i) continue;
              if (Math.abs(data3d.mz[j] - data3d.mz[i]) < BIN) {
                n1D[i]++;
                if (Math.abs(data3d.mobility[j] - data3d.mobility[i]) < MOB) n2D[i]++;
              }
            }
          }
        }
        const max1D = Math.max(...n1D), max2D = Math.max(...n2D);
        // overall stats
        let chimeric1D = 0, chimeric2D = 0;
        for (let i = 0; i < n; i++) { if(n1D[i]>0) chimeric1D++; if(n2D[i]>0) chimeric2D++; }
        const resolvedPct = chimeric1D > 0 ? Math.round((chimeric1D-chimeric2D)/chimeric1D*100) : 0;
        return { n1D, n2D, max1D, max2D, chimeric1D, chimeric2D, resolvedPct, n };
      }, [data3d]);

      // ── NOVEL 2: Breathing Proteome — RT-sliced ion cloud ─────────────
      const rtRunRange = useMemo(() => {
        if (!data3d?.rt?.length) return [0, 3600];
        return [Math.min(...data3d.rt), Math.max(...data3d.rt)];
      }, [data3d]);

      const breatheIons = useMemo(() => {
        if (!data3d?.rt?.length) return null;
        const [rtLo, rtHi] = rtRunRange;
        const rtCenter = rtLo + (rtHi - rtLo) * rtSliderPct / 100;
        const halfWin = (rtHi - rtLo) * 0.04;  // ±4% of run = typical 5–10 min window
        const idx = [];
        for (let i = 0; i < data3d.rt.length; i++) {
          if (Math.abs(data3d.rt[i] - rtCenter) <= halfWin) idx.push(i);
        }
        return {
          mz:       idx.map(i => data3d.mz[i]),
          mobility: idx.map(i => data3d.mobility[i]),
          charge:   idx.map(i => data3d.charge[i]),
          logInt:   idx.map(i => data3d.log_int[i]),
          rtCenter, halfWin, n: idx.length,
        };
      }, [data3d, rtSliderPct, rtRunRange]);

      // ── NOVEL 3: Orthogonality index ───────────────────────────────────
      const orthoScore = useMemo(() => {
        if (!data3d?.mz?.length || !chimeraCounts) return null;
        // Disambiguation rate: fraction of 1D-chimeric ions resolved by mobility
        const { chimeric1D, chimeric2D, resolvedPct } = chimeraCounts;
        // Per-charge corridor tightness (median |residual| / charge mobility range)
        const perCharge = {};
        Object.entries(corridorFits).forEach(([z, fit]) => {
          const idx = data3d.mz.map((_,i)=>data3d.charge[i]===+z?i:-1).filter(i=>i>=0);
          const k0Arr = idx.map(i => data3d.mobility[i]);
          const k0Range = Math.max(...k0Arr) - Math.min(...k0Arr);
          // "Mobility lanes": how many FWHM-resolved bands fit in the charge state's k0 range
          const fwhm = fit.resStd * 2.355;
          const lanes = k0Range / fwhm;
          perCharge[z] = { lanes: lanes.toFixed(1), fwhm: fwhm.toFixed(4), k0Range: k0Range.toFixed(3) };
        });
        const avgLanes = Object.values(perCharge).reduce((a,v)=>a+parseFloat(v.lanes),0) / Math.max(Object.keys(perCharge).length,1);
        return { resolvedPct, chimeric1D, chimeric2D, perCharge, avgLanes: avgLanes.toFixed(1) };
      }, [chimeraCounts, corridorFits, data3d]);

      // ── NOVEL 4: Density fingerprint grid ─────────────────────────────
      function buildDensityGrid(mzArr, k0Arr, W=80, H=60) {
        const MZ_LO=300, MZ_HI=1500, K0_LO=0.5, K0_HI=1.78;
        // Regular arrays (not TypedArrays) so .flat() works for Pearson correlation
        const grid = Array.from({length:H}, ()=>Array(W).fill(0));
        const mzS = (MZ_HI-MZ_LO), k0S = (K0_HI-K0_LO);
        for (let i=0;i<mzArr.length;i++){
          const gx=Math.min(W-1,Math.max(0,Math.floor((mzArr[i]-MZ_LO)/mzS*W)));
          const gy=Math.min(H-1,Math.max(0,Math.floor((k0Arr[i]-K0_LO)/k0S*H)));
          grid[gy][gx]++;
        }
        let maxV=0; for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(grid[y][x]>maxV) maxV=grid[y][x];
        if(maxV>0) for(let y=0;y<H;y++) for(let x=0;x<W;x++) grid[y][x]/=maxV;
        return {grid, W, H, MZ_LO, MZ_HI, K0_LO, K0_HI};
      }

      const densityA = useMemo(() => {
        if (!data3d?.mz?.length) return null;
        return buildDensityGrid(data3d.mz, data3d.mobility);
      }, [data3d]);

      const densityB = useMemo(() => {
        if (!data3d2?.mz?.length) return null;
        return buildDensityGrid(data3d2.mz, data3d2.mobility);
      }, [data3d2]);

      // ── Fetch second run for comparison ───────────────────────────────
      useEffect(() => {
        if (!selectedRun2) return;
        const ac = new AbortController();
        setLoadingCompare(true); setData3d2(null);
        fetch(API + `/api/runs/${selectedRun2.id}/mobility-3d?max_features=5000`, {signal:ac.signal})
          .then(r => r.ok ? r.json() : {})
          .then(d => { setData3d2(d?.rt?.length ? d : null); setLoadingCompare(false); })
          .catch(e => { if (e.name !== 'AbortError') setLoadingCompare(false); });
        return () => ac.abort();
      }, [selectedRun2?.id]);

      // ── Animation RAF for breathing ────────────────────────────────────
      useEffect(() => {
        if (!playing) { if (playAnimRef.current) cancelAnimationFrame(playAnimRef.current); return; }
        const FPS = 14;
        const step = ts => {
          if (ts - playLastRef.current >= 1000/FPS) {
            setRtSliderPct(p => { const n = +(p + 1.2).toFixed(1); if(n>100){setPlaying(false);return 0;} return n; });
            playLastRef.current = ts;
          }
          playAnimRef.current = requestAnimationFrame(step);
        };
        playAnimRef.current = requestAnimationFrame(step);
        return () => { if(playAnimRef.current) cancelAnimationFrame(playAnimRef.current); };
      }, [playing]);

      // ── CHART: Chimera Probability Map ────────────────────────────────
      // Three categories per ion:
      //   Clean      — no m/z neighbours within ±0.5 Th (never a chimera problem)
      //   IM-rescued — had m/z neighbours BUT mobility separated them by > MOB threshold
      //                i.e. would have been chimeric without TIMS, but isn't
      //   Still chimeric — has BOTH an m/z neighbour AND a mobility neighbour
      //                    (isolation window still picks up an interfering co-precursor)
      useEffect(() => {
        if (!chimeraRef.current || !window.Plotly) return;
        if (!data3d || !chimeraCounts) { window.Plotly.purge(chimeraRef.current); return; }
        const { n1D, n2D } = chimeraCounts;
        const n = data3d.mz.length;

        // Partition into three buckets
        const cleanIdx    = [], rescuedIdx = [], chimeraIdx = [];
        for (let i = 0; i < n; i++) {
          if      (n1D[i] === 0)                      cleanIdx.push(i);
          else if (n1D[i] > 0 && n2D[i] === 0)        rescuedIdx.push(i);
          else                                         chimeraIdx.push(i);
        }

        const pick = (arr, key) => arr.map(i => data3d[key][i]);
        const hoverText = (arr) => arr.map(i =>
          n1D[i]===0 ? 'No m/z neighbours — clean precursor'
          : n2D[i]===0 ? `${n1D[i]} m/z neighbour${n1D[i]>1?'s':''} — resolved by ion mobility`
          : `${n2D[i]} co-isolated neighbour${n2D[i]>1?'s':''} despite IM (chimeric)`
        );

        const traces = [
          {
            name: `Clean (${cleanIdx.length.toLocaleString()})`,
            x: pick(cleanIdx,'mz'), y: pick(cleanIdx,'mobility'),
            mode:'markers', type:'scatter',
            marker:{ size:2, color:'#22c55e', opacity:0.35 },
            text: hoverText(cleanIdx),
            hovertemplate:'m/z %{x:.2f}  1/K₀ %{y:.4f}<br>%{text}<extra>Clean</extra>',
          },
          {
            name: `IM-rescued (${rescuedIdx.length.toLocaleString()})`,
            x: pick(rescuedIdx,'mz'), y: pick(rescuedIdx,'mobility'),
            mode:'markers', type:'scatter',
            marker:{ size:2.5, color:'#DAAA00', opacity:0.75 },
            text: hoverText(rescuedIdx),
            hovertemplate:'m/z %{x:.2f}  1/K₀ %{y:.4f}<br>%{text}<extra>IM-rescued</extra>',
          },
          {
            name: `Still chimeric (${chimeraIdx.length.toLocaleString()})`,
            x: pick(chimeraIdx,'mz'), y: pick(chimeraIdx,'mobility'),
            mode:'markers', type:'scatter',
            marker:{ size:2.5, color:'#f87171', opacity:0.75 },
            text: hoverText(chimeraIdx),
            hovertemplate:'m/z %{x:.2f}  1/K₀ %{y:.4f}<br>%{text}<extra>Chimeric</extra>',
          },
        ].filter(t => t.x.length > 0);

        const resolvedPctDisplay = chimeraCounts.chimeric1D > 0
          ? Math.round(rescuedIdx.length / chimeraCounts.chimeric1D * 100) : 0;

        window.Plotly.react(chimeraRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:60,r:20,t:28,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10},
                  x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{
            xref:'paper',yref:'paper',x:0.99,y:0.99,xanchor:'right',yanchor:'top',
            text:`<b>${resolvedPctDisplay}%</b> of would-be chimeras rescued by IM`,
            showarrow:false,font:{color:'#DAAA00',size:11},
            bgcolor:'rgba(0,0,0,0.4)',bordercolor:'rgba(218,170,0,0.3)',borderwidth:1,borderpad:4,
          }],
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage']});
      }, [data3d, chimeraCounts]);

      // ── CHART: Breathing Proteome ──────────────────────────────────────
      useEffect(() => {
        if (!breatheRef.current || !window.Plotly) return;
        if (!breatheIons) { window.Plotly.purge(breatheRef.current); return; }
        const charges = [...new Set(breatheIons.charge)].sort((a,b)=>a-b);
        const traces = charges.map(z => {
          const idx = breatheIons.charge.map((_,i)=>breatheIons.charge[i]===z?i:-1).filter(i=>i>=0);
          const li = idx.map(i=>breatheIons.logInt[i]);
          const liMax = Math.max(...li)||1;
          return {
            type:'scatter', mode:'markers',
            name: z===0?'Unassigned':'z = +'+z,
            x: idx.map(i=>breatheIons.mz[i]),
            y: idx.map(i=>breatheIons.mobility[i]),
            marker:{ size:idx.map(i=>2+breatheIons.logInt[i]/liMax*4), color:Z_COLORS[z]||'#94a3b8', opacity:0.65 },
            hovertemplate:`m/z %{x:.2f}<br>1/K₀ %{y:.4f}<extra>${z===0?'?':'z=+'+z}</extra>`,
          };
        });
        const rtMin = breatheIons.rtCenter - breatheIons.halfWin;
        const rtMax = breatheIons.rtCenter + breatheIons.halfWin;
        window.Plotly.react(breatheRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11}, margin:{l:60,r:20,t:30,b:50},
          xaxis:{title:{text:'m/z (Th)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:12}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.35)',bordercolor:'#1e3a5f',font:{size:9},x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          annotations:[{xref:'paper',yref:'paper',x:0.5,y:1.04,
            text:`RT ${(breatheIons.rtCenter/60).toFixed(2)} min  ·  ±${(breatheIons.halfWin/60).toFixed(2)} min window  ·  ${breatheIons.n.toLocaleString()} ions`,
            showarrow:false,font:{color:'#38bdf8',size:10},xanchor:'center'}],
        }, {responsive:true, displayModeBar:false});
      }, [breatheIons]);

      // ── CHART: Fingerprint heatmaps ────────────────────────────────────
      useEffect(() => {
        if (!fpARef.current || !window.Plotly || !densityA) return;
        const { grid, W, H, MZ_LO, MZ_HI, K0_LO, K0_HI } = densityA;
        const mzTicks = Array.from({length:W},(_,i)=>+(MZ_LO+i*(MZ_HI-MZ_LO)/W).toFixed(0));
        const k0Ticks = Array.from({length:H},(_,i)=>+(K0_LO+i*(K0_HI-K0_LO)/H).toFixed(3));
        const plotLayout = {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:10}, margin:{l:60,r:15,t:30,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},color:'#a0b4cc',tickfont:{size:9}},
          yaxis:{title:{text:'1/K₀',font:{size:11}},color:'#a0b4cc',tickfont:{size:9}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:10}},
        };
        window.Plotly.react(fpARef.current, [{
          type:'heatmap', x:mzTicks, y:k0Ticks, z:grid,
          colorscale:'Viridis', showscale:false,
          hovertemplate:'m/z %{x}<br>1/K₀ %{y}<br>density %{z:.3f}<extra>Run A</extra>',
        }], {...plotLayout, title:{text:'Run A',font:{color:'#38bdf8',size:11}}},
        {responsive:true, displayModeBar:false});
      }, [densityA]);

      useEffect(() => {
        if (!fpBRef.current || !window.Plotly) return;
        if (!densityB) { window.Plotly.purge(fpBRef.current); return; }
        const { grid, W, H, MZ_LO, MZ_HI, K0_LO, K0_HI } = densityB;
        const mzTicks = Array.from({length:W},(_,i)=>+(MZ_LO+i*(MZ_HI-MZ_LO)/W).toFixed(0));
        const k0Ticks = Array.from({length:H},(_,i)=>+(K0_LO+i*(K0_HI-K0_LO)/H).toFixed(3));
        window.Plotly.react(fpBRef.current, [{
          type:'heatmap', x:mzTicks, y:k0Ticks, z:grid,
          colorscale:'Viridis', showscale:false,
          hovertemplate:'m/z %{x}<br>1/K₀ %{y}<br>density %{z:.3f}<extra>Run B</extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:10}, margin:{l:60,r:15,t:30,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀',font:{size:11}},color:'#a0b4cc'},
          title:{text:'Run B',font:{color:'#22c55e',size:11}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:10}},
        }, {responsive:true, displayModeBar:false});
      }, [densityB]);

      useEffect(() => {
        if (!fpDiffRef.current || !window.Plotly || !densityA || !densityB) return;
        const { W, H, MZ_LO, MZ_HI, K0_LO, K0_HI } = densityA;
        const diffGrid = densityA.grid.map((row, y) =>
          Array.from(row).map((v, x) => v - densityB.grid[y][x])
        );
        const mzTicks = Array.from({length:W},(_,i)=>+(MZ_LO+i*(MZ_HI-MZ_LO)/W).toFixed(0));
        const k0Ticks = Array.from({length:H},(_,i)=>+(K0_LO+i*(K0_HI-K0_LO)/H).toFixed(3));
        // Pearson r of flattened grids
        const a = densityA.grid.flat(), b2 = densityB.grid.map(r=>Array.from(r)).flat();
        const n = a.length;
        const ma = a.reduce((s,v)=>s+v,0)/n, mb = b2.reduce((s,v)=>s+v,0)/n;
        let num=0, sa=0, sb=0;
        for(let i=0;i<n;i++){const da=a[i]-ma,db=b2[i]-mb;num+=da*db;sa+=da*da;sb+=db*db;}
        const similarity = sa>0&&sb>0 ? (num/Math.sqrt(sa*sb)*100).toFixed(1) : 'N/A';
        window.Plotly.react(fpDiffRef.current, [{
          type:'heatmap', x:mzTicks, y:k0Ticks, z:diffGrid,
          colorscale:[['0','#ef4444'],['0.5','#1e3a5f'],['1','#22c55e']],
          zmid:0, showscale:true, colorbar:{tickfont:{size:9},len:0.7},
          hovertemplate:'m/z %{x}<br>1/K₀ %{y}<br>A−B %{z:.3f}<extra>Difference</extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:10}, margin:{l:60,r:55,t:30,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀',font:{size:11}},color:'#a0b4cc'},
          title:{text:`A − B  ·  similarity ${similarity}%`,font:{color:'#f59e0b',size:11}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:10}},
        }, {responsive:true, displayModeBar:false});
      }, [densityA, densityB]);

      // ── Render ─────────────────────────────────────────────────────────
      const hasData = data3d && data3d.mz?.length;
      const hasWindows = windowData?.windows?.length || pasefData?.events?.length;

      return (
        <div style={{maxWidth:'1200px',margin:'0 auto',padding:'1rem 0.5rem 2rem'}}>

          {/* ── Run Selector ── */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1rem'}}>
            <div style={{display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
              <div>
                <div style={{color:'var(--accent)',fontWeight:700,fontSize:'0.82rem',marginBottom:'0.2rem'}}>4D Advantage</div>
                <div style={{color:'var(--muted)',fontSize:'0.75rem'}}>How ion mobility transforms YOUR data — computed live from each run</div>
              </div>
              <div style={{flex:1,minWidth:'200px',maxWidth:'380px'}}>
                <input placeholder="Search runs…" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                  style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.35rem',padding:'0.35rem 0.6rem',fontSize:'0.82rem'}} />
              </div>
              <select value={selectedRun?.id||''} onChange={e=>{const r=dRuns.find(r=>String(r.id)===e.target.value);if(r)setSelectedRun(r);}}
                style={{flex:1,minWidth:'200px',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.35rem',padding:'0.35rem 0.6rem',fontSize:'0.82rem'}}>
                {filteredRuns.map(r=><option key={r.id} value={r.id}>{r.run_name||r.id} · {r.instrument||''}</option>)}
              </select>
            </div>
          </div>

          {/* ── Why 4D-Omics ── */}
          {(() => {
            const [showWhy, setShowWhy] = useState(false);
            return (
              <div className="card" style={{marginBottom:'1rem', border:'1px solid rgba(218,170,0,0.22)'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', padding:'0.1rem 0'}}
                  onClick={() => setShowWhy(v => !v)}>
                  <div>
                    <span style={{fontWeight:700, color:'#DAAA00', fontSize:'0.88rem'}}>
                      4 Reasons for 4D-Omics on the timsTOF Pro
                    </span>
                    <span style={{marginLeft:'0.7rem', fontSize:'0.73rem', color:'#64748b'}}>
                      From Bruker's capabilities statement — gas-phase structure as a 4th analytical dimension
                    </span>
                  </div>
                  <span style={{color:'#DAAA00', fontSize:'1rem', marginLeft:'0.5rem'}}>{showWhy ? '▲' : '▼'}</span>
                </div>
                {showWhy && (
                  <div style={{marginTop:'0.9rem', display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))', gap:'0.7rem'}}>
                    {[
                      {
                        num:'1', color:'#22d3ee', title:'CCS-Aware — A 4th Analytical Dimension',
                        body:`Just as retention time anchors analytes in the liquid phase, collision cross-section (CCS) anchors them in the gas phase. CCS is reproducible and intrinsic — measured for every ion on every run. It improves identification fidelity, helps decipher isomeric species, and enables CCS-based database pre-filtering.

The TIMS device accumulates ions by balancing an electric field against N₂ gas flow. When the field ramps, ions of different 1/K₀ are released sequentially — a physical sieve operating in microseconds.`,
                      },
                      {
                        num:'2', color:'#DAAA00', title:'CCS-Aware MBR — Complete Quantitative Datasets',
                        body:`Match Between Runs with only m/z + RT has long been error-prone. Adding CCS as a third coordinate makes each feature uniquely specifiable.

In clinical plasma digests (11-min gradients), CCS-aware MBR increases identified proteins from ~100 to ~200 per run — a 100% gain. Across 20 samples the average improvement was 90%. CCS-aware MBR is especially powerful for low-abundance proteins that are sampled stochastically in DDA.`,
                      },
                      {
                        num:'3', color:'#a855f7', title:'MOMA — Resolving Isobaric Co-Eluters',
                        body:`Proteolytic digestion generates hundreds of thousands of peptides. Co-eluting near-isobaric precursors produce chimeric MS2 spectra that confuse database searching.

MOMA (Mobility Offset Mass Aligned): when two ions share m/z but differ in 1/K₀, TIMS separates them before TOF analysis. Each receives a clean MS2 spectrum. MOMA is uniquely powerful for PTM positional isomers — phospho-peptide pairs that differ only in modification site are routinely resolved by TIMS where no other platform can.`,
                      },
                      {
                        num:'4', color:'#22c55e', title:'Robustness + Ease of Use',
                        body:`The orthogonal off-axis glass capillary design admits only ions — neutral contamination is deflected. This means lower sample loads, less fouling of LC/source/optics, and stable performance over months without deep cleaning.

Calibration (mass + IMS) takes under 5 min — vs 45+ min on other platforms. Bruker's longitudinal QC shows consistent performance across 40+ weeks of continuous operation. Low sample requirements (≥1 µg) protect both column longevity and proteome depth.`,
                      },
                    ].map(p => (
                      <div key={p.num} style={{background:'rgba(0,0,0,0.35)',
                        border:`1px solid ${p.color}22`, borderRadius:'0.45rem', padding:'0.7rem 0.85rem'}}>
                        <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.5rem'}}>
                          <span style={{width:'22px', height:'22px', borderRadius:'50%',
                            background:`${p.color}22`, border:`1px solid ${p.color}44`,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:'0.72rem', fontWeight:800, color:p.color, flexShrink:0}}>{p.num}</span>
                          <span style={{fontWeight:700, color:p.color, fontSize:'0.8rem'}}>{p.title}</span>
                        </div>
                        <div style={{fontSize:'0.74rem', color:'#94a3b8', lineHeight:1.65,
                          whiteSpace:'pre-line'}}>{p.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {(loading || runsLoading) && <div style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>Loading ion data…</div>}
          {!loading && !runsLoading && dRuns.length === 0 && (
            <div style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>No Bruker .d runs found. Ion mobility data requires timsTOF acquisitions.</div>
          )}

          {hasData && !loading && (() => {
            return (
              <>
                {/* ═══════════ SECTION 1: THE CORRIDOR ═══════════════════════ */}
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <h3 style={{margin:0,fontSize:'1.05rem'}}>
                          Your Peptide Corridor
                          <span style={{marginLeft:'0.6rem',background:'rgba(56,189,248,0.1)',border:'1px solid rgba(56,189,248,0.3)',color:'var(--accent)',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>
                            LIVE DATA
                          </span>
                        </h3>
                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                          Each charge state forms a predictable diagonal lane in m/z × 1/K₀ space.
                          Dashed lines = fitted corridor · shaded band = ±2σ · tighter = better instrument health.
                        </div>
                      </div>
                      {corridorSummary && (
                        <div style={{display:'flex',gap:'1.2rem',flexWrap:'wrap'}}>
                          {Object.entries(corridorFits).map(([z,f])=>(
                            <div key={z} style={{textAlign:'center'}}>
                              <div style={{color:Z_COLORS[+z]||'#94a3b8',fontWeight:700,fontSize:'1.1rem'}}>R²={f.r2.toFixed(3)}</div>
                              <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>z=+{z} corridor</div>
                            </div>
                          ))}
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'var(--accent)',fontWeight:700,fontSize:'1.1rem'}}>{corridorSummary.totalIons.toLocaleString()}</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>total ions</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div ref={corridorRef} style={{height:'440px'}} />
                  <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                    <span style={{color:'var(--accent)',fontWeight:600}}>Why this matters: </span>
                    Peptides of each charge state fall along a predictable CCS–mass law. Chemical noise (lipids, matrix, contaminants) falls outside these lanes and is filtered automatically by the TIMS funnel — before fragmentation.
                    A high R² (close to 1.000) means ions are tightly confined to their corridor, indicating excellent ionization and accumulation conditions.
                  </div>
                </div>

                {/* ═══════════ SECTION 2: THE ISOLATION CHALLENGE ════════════ */}
                {congestedWindow && (
                  <div className="card" style={{marginBottom:'1rem'}}>
                    <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                        <div style={{flex:1}}>
                          <h3 style={{margin:0,fontSize:'1.05rem'}}>
                            The Isolation Challenge — Your Most Crowded m/z Window
                            <span style={{marginLeft:'0.6rem',background:'rgba(56,189,248,0.1)',border:'1px solid rgba(56,189,248,0.3)',color:'var(--accent)',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>
                              AUTO-DETECTED
                            </span>
                          </h3>
                          <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                            Auto-detected: densest {(congestedWindow.mzHi-congestedWindow.mzLo).toFixed(0)} Th window = m/z {congestedWindow.mzLo.toFixed(0)}–{congestedWindow.mzHi.toFixed(0)} ·
                            left = what a traditional mass spectrometer sees · right = what ion mobility reveals
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'1.2rem'}}>
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'#f87171',fontWeight:700,fontSize:'1.3rem'}}>{congestedWindow.coIso1D}</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>ions co-isolated in 1D</div>
                          </div>
                          <div style={{textAlign:'center'}}>
                            <div style={{color:'#22c55e',fontWeight:700,fontSize:'1.3rem'}}>{congestedWindow.resolved}%</div>
                            <div style={{color:'var(--muted)',fontSize:'0.7rem'}}>resolved by mobility</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0'}}>
                      <div style={{borderRight:'1px solid var(--border)'}}>
                        <div style={{padding:'0.4rem 0.8rem',background:'rgba(248,113,113,0.05)',fontSize:'0.75rem',color:'#f87171',fontWeight:600,borderBottom:'1px solid var(--border)'}}>
                          Without ion mobility — all overlapping
                        </div>
                        <div ref={congLeftRef} style={{height:'300px'}} />
                      </div>
                      <div>
                        <div style={{padding:'0.4rem 0.8rem',background:'rgba(34,197,94,0.05)',fontSize:'0.75rem',color:'#22c55e',fontWeight:600,borderBottom:'1px solid var(--border)'}}>
                          With ion mobility — separated by CCS
                        </div>
                        <div ref={congRightRef} style={{height:'300px'}} />
                      </div>
                    </div>
                    <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                      <span style={{color:'var(--accent)',fontWeight:600}}>Why this matters: </span>
                      In a 5 Th isolation window, {congestedWindow.coIso1D} ions are co-isolated — their fragment spectra mix together, creating chimeric MS2 that database search engines struggle to interpret.
                      Ion mobility resolves {congestedWindow.resolved}% of these before fragmentation, producing cleaner spectra and more confident peptide identifications.
                    </div>
                  </div>
                )}

                {/* ═══════════ SECTION 3: WINDOW COVERAGE ════════════════════ */}
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                    <h3 style={{margin:0,fontSize:'1.05rem'}}>
                      {hasWindows ? 'Your Method Coverage — Isolation Windows vs Ion Cloud' : 'Ion Cloud — Charge State Separation'}
                    </h3>
                    <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem',lineHeight:'1.5'}}>
                      {hasWindows
                        ? (windowData
                            ? 'diaPASEF windows (blue) overlaid on your actual ion cloud. Each box is an m/z × 1/K₀ acquisition region from one PASEF cycle.'
                            : 'PASEF events (amber) overlaid on your ion cloud. Each box = one ddaPASEF precursor isolation event in m/z × 1/K₀ space.')
                        : 'Ion cloud colored by charge state. Even without method windows, the visible charge lanes confirm TIMS is separating by conformation.'
                      }
                      {hasWindows && (
                        <span style={{color:'#38bdf8',marginLeft:'0.4rem'}}>
                          The <b>% within a window</b> counts how many of the loaded 3D features fall inside any window box.
                          Ions outside boxes are simply features not targeted for MS2 in this run — not a measurement error.
                          Low-abundance or out-of-range ions typically account for the remainder.
                        </span>
                      )}
                    </div>
                  </div>
                  <div ref={coverageRef} style={{height:'440px'}} />
                  <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)',lineHeight:'1.6'}}>
                    <span style={{color:'var(--accent)',fontWeight:600}}>Why this matters: </span>
                    {hasWindows
                      ? 'Each window in m/z × 1/K₀ captures far fewer co-eluting precursors than a traditional DIA window of the same m/z width alone — because TIMS adds the vertical (mobility) dimension. A 25 Th × 0.3 Vs/cm² diaPASEF box covers roughly 1/5 the precursor density of a flat 25 Th DIA window.'
                      : 'Even without method windows, charge lanes are clearly separated in mobility — enabling TIMS-based charge state deconvolution and cleaner MS2 spectra.'
                    }
                  </div>
                </div>

                {/* ═══════ NOVEL 1: CHIMERA PROBABILITY MAP ══════════════════ */}
                {chimeraCounts && (
                  <div className="card" style={{marginBottom:'1rem'}}>
                    <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                        <div style={{flex:1}}>
                          <h3 style={{margin:0,fontSize:'1.05rem'}}>
                            Chimera Map — Ion Mobility Rescue
                            <span style={{marginLeft:'0.6rem',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.35)',color:'#f87171',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>NOVEL</span>
                          </h3>
                          <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem',lineHeight:'1.5'}}>
                            Each ion classified by its co-isolation fate. Criterion: ±0.5 Th m/z neighbour = would-be chimera;
                            if that neighbour is also within ±0.06 Vs/cm² in 1/K₀, TIMS cannot separate them.
                            <br/>
                            <span style={{color:'#22c55e'}}>● Green = clean</span>
                            {'  '}
                            <span style={{color:'#DAAA00'}}>● Gold = had m/z conflict, IM rescued it</span>
                            {'  '}
                            <span style={{color:'#f87171'}}>● Red = still chimeric even with IM</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'1.2rem',flexShrink:0,flexWrap:'wrap'}}>
                          <div style={{textAlign:'center',padding:'0.4rem 0.7rem',background:'rgba(239,68,68,0.08)',borderRadius:'0.4rem',border:'1px solid rgba(239,68,68,0.2)'}}>
                            <div style={{color:'#f87171',fontWeight:800,fontSize:'1.4rem',lineHeight:1}}>{Math.round(chimeraCounts.chimeric1D/chimeraCounts.n*100)}%</div>
                            <div style={{color:'var(--muted)',fontSize:'0.68rem',marginTop:'0.15rem'}}>would-be chimeras</div>
                            <div style={{color:'#64748b',fontSize:'0.62rem'}}>(m/z ±0.5 Th conflict)</div>
                          </div>
                          <div style={{display:'flex',alignItems:'center',color:'var(--muted)',fontSize:'1.2rem'}}>→</div>
                          <div style={{textAlign:'center',padding:'0.4rem 0.7rem',background:'rgba(218,170,0,0.08)',borderRadius:'0.4rem',border:'1px solid rgba(218,170,0,0.2)'}}>
                            <div style={{color:'#DAAA00',fontWeight:800,fontSize:'1.4rem',lineHeight:1}}>
                              {chimeraCounts.chimeric1D > 0 ? Math.round((chimeraCounts.chimeric1D-chimeraCounts.chimeric2D)/chimeraCounts.chimeric1D*100) : 0}%
                            </div>
                            <div style={{color:'var(--muted)',fontSize:'0.68rem',marginTop:'0.15rem'}}>rescued by IM</div>
                            <div style={{color:'#64748b',fontSize:'0.62rem'}}>(m/z conflict, Δ1/K₀{'>'} 0.06)</div>
                          </div>
                          <div style={{textAlign:'center',padding:'0.4rem 0.7rem',background:'rgba(239,68,68,0.05)',borderRadius:'0.4rem',border:'1px solid rgba(239,68,68,0.15)'}}>
                            <div style={{color:'#f87171',fontWeight:800,fontSize:'1.4rem',lineHeight:1}}>{Math.round(chimeraCounts.chimeric2D/chimeraCounts.n*100)}%</div>
                            <div style={{color:'var(--muted)',fontSize:'0.68rem',marginTop:'0.15rem'}}>still chimeric</div>
                            <div style={{color:'#64748b',fontSize:'0.62rem'}}>(both m/z AND IM conflict)</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div ref={chimeraRef} style={{height:'420px'}} />
                    <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)',lineHeight:'1.6'}}>
                      <span style={{color:'#DAAA00',fontWeight:600}}>How to read this: </span>
                      Gold ions are your most informative data point — they prove IM is actively separating co-eluting precursors that mass alone would confuse.
                      The higher the gold fraction, the more diaPASEF is earning its keep on this sample.
                      Red ions represent the remaining hard cases where both m/z AND mobility overlap within the thresholds used (±0.5 Th, ±0.06 Vs/cm²).
                      Hover any dot for its exact chimera status.
                    </div>
                  </div>
                )}

                {/* ═══════ NOVEL 2: BREATHING PROTEOME ══════════════════════ */}
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <h3 style={{margin:0,fontSize:'1.05rem'}}>
                          The Breathing Proteome
                          <span style={{marginLeft:'0.6rem',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.35)',color:'#f87171',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>NOVEL</span>
                        </h3>
                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                          Watch the ion cloud evolve as the LC gradient progresses — scrub the timeline or press Play.
                          Early gradient: small, basic peptides. Mid: tryptic bulk. Late: large hydrophobic peptides shift the cloud.
                          Size = intensity.
                        </div>
                      </div>
                      <div style={{display:'flex',gap:'0.6rem',alignItems:'center',flexShrink:0}}>
                        <button onClick={()=>{setPlaying(p=>!p);}}
                          style={{padding:'0.3rem 0.9rem',background:playing?'#f59e0b':'rgba(56,189,248,0.12)',color:playing?'#000':'var(--accent)',border:`1px solid ${playing?'#f59e0b':'rgba(56,189,248,0.4)'}`,borderRadius:'0.4rem',cursor:'pointer',fontWeight:700,fontSize:'0.82rem',whiteSpace:'nowrap'}}>
                          {playing ? '⏸ Pause' : '▶ Play'}
                        </button>
                        <button onClick={()=>{setPlaying(false);setRtSliderPct(0);}}
                          style={{padding:'0.3rem 0.6rem',background:'transparent',color:'var(--muted)',border:'1px solid var(--border)',borderRadius:'0.4rem',cursor:'pointer',fontSize:'0.78rem'}}>
                          ↺ Reset
                        </button>
                        <span style={{color:'var(--accent)',fontWeight:700,fontSize:'0.88rem',whiteSpace:'nowrap'}}>
                          {breatheIons ? (breatheIons.rtCenter/60).toFixed(2) : '—'} min
                        </span>
                      </div>
                    </div>
                    <div style={{padding:'0.5rem 0 0'}}>
                      <input type="range" min="0" max="100" step="0.5" value={rtSliderPct}
                        onChange={e=>{setPlaying(false);setRtSliderPct(+e.target.value);}}
                        style={{width:'100%',accentColor:'var(--accent)',cursor:'pointer'}} />
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem'}}>
                        <span>{(rtRunRange[0]/60).toFixed(1)} min</span>
                        <span style={{color:'var(--accent)'}}>← drag to scrub timeline →</span>
                        <span>{(rtRunRange[1]/60).toFixed(1)} min</span>
                      </div>
                    </div>
                  </div>
                  <div ref={breatheRef} style={{height:'400px'}} />
                  <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                    <span style={{color:'var(--accent)',fontWeight:600}}>What you're seeing: </span>
                    The proteome literally "breathes" through mobility space over the gradient. Early peptides cluster in lower m/z, higher mobility regions.
                    As the gradient progresses, larger hydrophobic peptides elute — shifting the cloud toward higher m/z and mobility.
                    This animation cannot be shown in any static 2D plot — it requires the 4th (RT) dimension.
                  </div>
                </div>

                {/* ═══════ NOVEL 3: ORTHOGONALITY INDEX ════════════════════ */}
                {orthoScore && (
                  <div className="card" style={{marginBottom:'1rem'}}>
                    <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                      <h3 style={{margin:0,fontSize:'1.05rem'}}>
                        Mobility Orthogonality Index
                        <span style={{marginLeft:'0.6rem',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.35)',color:'#f87171',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>NOVEL METRIC</span>
                      </h3>
                      <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                        How much new, independent information does ion mobility add to this run beyond m/z alone?
                        Measured as: fraction of would-be chimeric ion pairs that mobility resolves + resolvable mobility bands per charge lane.
                      </div>
                    </div>
                    <div style={{padding:'1.2rem',display:'flex',gap:'1.5rem',flexWrap:'wrap',alignItems:'flex-start'}}>
                      {/* Big donut-style metric */}
                      <div style={{textAlign:'center',minWidth:'140px'}}>
                        <div style={{fontSize:'3.2rem',fontWeight:900,lineHeight:1,
                          background:`linear-gradient(135deg, #22c55e, #38bdf8)`,
                          WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text'}}>
                          {orthoScore.resolvedPct}%
                        </div>
                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>chimeric ions resolved<br/>by mobility</div>
                      </div>
                      <div style={{flex:1,minWidth:'200px'}}>
                        <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.5rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em'}}>Resolvable Mobility Bands per Charge Lane</div>
                        {Object.entries(orthoScore.perCharge).map(([z, info]) => (
                          <div key={z} style={{display:'flex',alignItems:'center',gap:'0.8rem',marginBottom:'0.5rem'}}>
                            <div style={{width:'30px',fontWeight:700,color:Z_COLORS[+z]||'#94a3b8',fontSize:'0.82rem'}}>z=+{z}</div>
                            <div style={{flex:1,height:'14px',background:'rgba(255,255,255,0.05)',borderRadius:'2px',overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${Math.min(100,parseFloat(info.lanes)/20*100)}%`,
                                background:`linear-gradient(90deg, ${Z_COLORS[+z]||'#94a3b8'}88, ${Z_COLORS[+z]||'#94a3b8'})`,
                                borderRadius:'2px',transition:'width 0.4s'}} />
                            </div>
                            <div style={{width:'80px',fontSize:'0.78rem',color:'var(--text)',textAlign:'right'}}>{info.lanes} bands</div>
                            <div style={{width:'90px',fontSize:'0.72rem',color:'var(--muted)'}}>FWHM {info.fwhm} Vs/cm²</div>
                          </div>
                        ))}
                        <div style={{marginTop:'0.6rem',fontSize:'0.75rem',color:'var(--muted)'}}>
                          Average across charge states: <span style={{color:'var(--accent)',fontWeight:700}}>{orthoScore.avgLanes} resolvable bands</span>
                          &nbsp;·&nbsp; each band = a distinct mobility position that IM can uniquely isolate
                        </div>
                      </div>
                      <div style={{minWidth:'180px',background:'rgba(255,255,255,0.03)',border:'1px solid var(--border)',borderRadius:'0.5rem',padding:'0.8rem'}}>
                        <div style={{color:'var(--muted)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'0.5rem'}}>Isolation Stats</div>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'0.3rem'}}>
                          <span style={{color:'var(--muted)',fontSize:'0.78rem'}}>1D chimeric ions</span>
                          <span style={{color:'#f87171',fontWeight:700}}>{orthoScore.chimeric1D.toLocaleString()}</span>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'0.3rem'}}>
                          <span style={{color:'var(--muted)',fontSize:'0.78rem'}}>2D chimeric ions</span>
                          <span style={{color:'#f59e0b',fontWeight:700}}>{orthoScore.chimeric2D.toLocaleString()}</span>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between'}}>
                          <span style={{color:'var(--muted)',fontSize:'0.78rem'}}>Resolved by IM</span>
                          <span style={{color:'#22c55e',fontWeight:700}}>{(orthoScore.chimeric1D-orthoScore.chimeric2D).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                      <span style={{color:'var(--accent)',fontWeight:600}}>Novel instrument QC metric: </span>
                      The Mobility Orthogonality Index quantifies exactly how much analytical value ion mobility adds to this specific experiment.
                      High scores ({'>'}70%) indicate the TIMS dimension is operating at full resolving power and dramatically reducing co-isolation.
                      This metric does not exist in any other proteomics QC software.
                    </div>
                  </div>
                )}

                {/* ═══════ NOVEL 4: 4D RUN FINGERPRINT ═════════════════════ */}
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{padding:'0.9rem 1.2rem 0.5rem',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <h3 style={{margin:0,fontSize:'1.05rem'}}>
                          4D Run Fingerprint — Density Comparison
                          <span style={{marginLeft:'0.6rem',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.35)',color:'#f87171',fontSize:'0.7rem',padding:'0.1rem 0.45rem',borderRadius:'0.25rem',verticalAlign:'middle',fontWeight:700}}>NOVEL</span>
                        </h3>
                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginTop:'0.3rem'}}>
                          Each run leaves a unique 2D density signature in m/z × 1/K₀ space — a "fingerprint" that captures proteome composition, instrument condition, and sample prep quality.
                          Compare any two runs to see exactly where they differ.
                        </div>
                      </div>
                      <div style={{display:'flex',gap:'0.6rem',alignItems:'center',flexShrink:0,flexWrap:'wrap'}}>
                        <span style={{color:'var(--muted)',fontSize:'0.78rem'}}>Compare with:</span>
                        <select value={selectedRun2?.id||''} onChange={e=>{const r=dRuns.find(r=>String(r.id)===e.target.value);setSelectedRun2(r||null);}}
                          style={{background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.35rem',padding:'0.3rem 0.5rem',fontSize:'0.78rem',maxWidth:'260px'}}>
                          <option value="">— select run B —</option>
                          {dRuns.filter(r=>r.id!==selectedRun?.id).map(r=><option key={r.id} value={r.id}>{r.run_name||r.id}</option>)}
                        </select>
                        {loadingCompare && <span style={{color:'var(--muted)',fontSize:'0.75rem'}}>loading…</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:`1fr ${densityB?'1fr 1fr':''}`,gap:'0',borderTop:'none'}}>
                    <div style={{borderRight: densityB ? '1px solid var(--border)' : 'none'}}>
                      <div ref={fpARef} style={{height:'280px'}} />
                    </div>
                    {densityB && (<>
                      <div style={{borderRight:'1px solid var(--border)'}}>
                        <div ref={fpBRef} style={{height:'280px'}} />
                      </div>
                      <div>
                        <div ref={fpDiffRef} style={{height:'280px'}} />
                      </div>
                    </>)}
                  </div>
                  {!densityB && (
                    <div style={{padding:'1.5rem',textAlign:'center',color:'var(--muted)',fontSize:'0.85rem',borderTop:'1px solid var(--border)'}}>
                      Select a second run above to see the density difference map and similarity score
                    </div>
                  )}
                  <div style={{padding:'0.6rem 1.2rem',borderTop:'1px solid var(--border)',background:'rgba(1,26,58,0.4)',fontSize:'0.78rem',color:'var(--muted)'}}>
                    <span style={{color:'var(--accent)',fontWeight:600}}>Novel run comparison: </span>
                    The difference map (A−B) reveals structural changes invisible to peptide-list comparison: green regions = ions present in run A but absent in B (e.g. sample prep loss, column degradation at specific m/z × mobility coordinates).
                    Red regions = ions gained. A similarity score near 100% indicates identical proteome composition and instrument state.
                  </div>
                </div>

              </>
            );
          })()}

          {/* ══════════════════════════════════════════════════════════════
              EDUCATIONAL SECTION — How timsTOF/TIMS works vs Orbitrap
              Static infographics, no run selection needed.
          ════════════════════════════════════════════════════════════════ */}
          <div style={{marginTop:'1.5rem'}}>

            {/* Peak Capacity Comparison */}
            <div className="card" style={{marginBottom:'0.75rem'}}>
              <h3 style={{marginBottom:'0.25rem'}}>Peak Capacity: 2D vs 4D Mass Spectrometry</h3>
              <div style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:'0.9rem'}}>
                Peak capacity = number of distinct analytes a method can resolve simultaneously.
                Each dimension multiplies the total — timsTOF stacks <em>four</em>.
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'0.6rem'}}>
                {[
                  {label:'Traditional LC-MS (Orbitrap 2D)',   dims:['LC retention time ~400','m/z resolution ~100K'],   total:'~400',   color:'#475569',   pct:4},
                  {label:'LC-MS/MS DDA (data-dep acq.)',      dims:['LC ~400','m/z ~100K','top-N MS2 selection'],        total:'~2,000',  color:'#1e40af',   pct:15},
                  {label:'timsTOF PASEF DDA',                 dims:['LC ~400','m/z ~35K','TIMS mobility ~40','PASEF ×10'],total:'~160,000', color:'#0369a1',  pct:55},
                  {label:'timsTOF diaPASEF',                  dims:['LC ~400','m/z ~35K','TIMS ~40','DIA comprehensive'],total:'~600,000+', color:'#DAAA00',  pct:100},
                ].map((item,i) => (
                  <div key={i} style={{background:'rgba(255,255,255,0.03)',borderRadius:'0.5rem',padding:'0.65rem 0.75rem',border:`1px solid ${item.color}44`}}>
                    <div style={{fontSize:'0.72rem',fontWeight:700,color:item.color,marginBottom:'0.35rem',lineHeight:1.3}}>{item.label}</div>
                    {item.dims.map((d,j)=>(
                      <div key={j} style={{fontSize:'0.68rem',color:'var(--muted)',marginBottom:'0.1rem'}}>· {d}</div>
                    ))}
                    <div style={{marginTop:'0.45rem',height:'8px',background:'rgba(255,255,255,0.06)',borderRadius:'4px',overflow:'hidden'}}>
                      <div style={{width:`${item.pct}%`,height:'100%',background:item.color,borderRadius:'4px',transition:'width 1s ease'}}/>
                    </div>
                    <div style={{fontSize:'0.78rem',fontWeight:900,color:item.color,marginTop:'0.25rem'}}>{item.total}</div>
                  </div>
                ))}
              </div>
              <div style={{fontSize:'0.68rem',color:'#3a5570',marginTop:'0.6rem',fontStyle:'italic'}}>
                Peak capacity values are illustrative order-of-magnitude estimates. Actual values depend on gradient length, sample complexity, and search settings.
              </div>
            </div>

            {/* TIMS Principle Diagram */}
            <div className="card" style={{marginBottom:'0.75rem'}}>
              <h3 style={{marginBottom:'0.2rem'}}>How TIMS Works: Trapped Ion Mobility Spectrometry</h3>
              <div style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:'0.8rem'}}>
                TIMS is an ion mobility separator built into the Bruker timsTOF source. It separates ions by their
                shape/charge — a dimension orthogonal to m/z and RT that Orbitrap instruments do not have.
              </div>
              {/* SVG TIMS diagram */}
              <svg viewBox="0 0 820 210" style={{width:'100%',maxWidth:'820px',display:'block'}}>
                <defs>
                  <linearGradient id="funnel-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1e3a5f"/>
                    <stop offset="100%" stopColor="#0f2040"/>
                  </linearGradient>
                  <marker id="arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#60a5fa"/>
                  </marker>
                  <marker id="arr-gold" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#DAAA00"/>
                  </marker>
                  <marker id="arr-gas" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#94a3b8"/>
                  </marker>
                </defs>

                {/* Phase labels */}
                {[['ACCUMULATE',80,'#22c55e'],['TRAP & SEPARATE',310,'#DAAA00'],['ELUTE (scan)',560,'#f97316']].map(([t,x,c])=>(
                  <text key={t} x={x} y={18} textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="1.5" fill={c} opacity="0.85">{t}</text>
                ))}
                <line x1="178" y1="6" x2="178" y2="200" stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
                <line x1="430" y1="6" x2="430" y2="200" stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>

                {/* TIMS funnel body */}
                <path d="M 178,38 L 430,50 L 430,165 L 178,175 Z" fill="url(#funnel-grad)" stroke="#1e3a5f" strokeWidth="1.5"/>

                {/* Electrodes (thin vertical lines inside funnel) */}
                {Array.from({length:14},(_,i)=>{
                  const x = 192 + i*17;
                  const yTop = 39 + i*0.85, yBot = 174 - i*0.62;
                  return <line key={i} x1={x} y1={yTop} x2={x} y2={yBot}
                    stroke={`hsl(${210+i*4},60%,${30+i*2}%)`} strokeWidth="1.2" opacity="0.7"/>;
                })}

                {/* Gas flow arrows (left-pointing, counter to ion movement) */}
                {[65,95,125].map(y=>(
                  <line key={y} x1="165" y1={y} x2="30" y2={y}
                    stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4 3"
                    markerEnd="url(#arr-gas)"/>
                ))}
                <text x="15" y="102" fontSize="9" fill="#94a3b8" textAnchor="middle">N₂ gas</text>
                <text x="15" y="113" fontSize="9" fill="#94a3b8" textAnchor="middle">→ left</text>

                {/* Ions entering (right side, mixed) */}
                {[[455,65,'#2dd4bf','+2'],[455,95,'#f97316','+3'],[455,125,'#a855f7','+4'],[455,150,'#60a5fa','+2']].map(([x,y,c,z])=>(
                  <g key={y}>
                    <circle cx={x} cy={y} r={7} fill={c} opacity="0.8"/>
                    <text x={x} y={y+4} textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">{z}</text>
                  </g>
                ))}
                <text x="480" y="108" fontSize="9" fill="#94a3b8">ions in</text>
                <line x1="475" y1="100" x2="445" y2="100" stroke="#94a3b8" strokeWidth="1" markerEnd="url(#arr-gas)"/>

                {/* Trapped ions (separated by 1/K₀ inside funnel) */}
                {[
                  [290,58,'#2dd4bf','z=+2','high 1/K₀'],
                  [310,82,'#2dd4bf','z=+2',''],
                  [295,107,'#f97316','z=+3','mid 1/K₀'],
                  [320,132,'#f97316','z=+3',''],
                  [300,155,'#a855f7','z=+4','low 1/K₀'],
                ].map(([x,y,c,z,lbl])=>(
                  <g key={`${x}${y}`}>
                    <circle cx={x} cy={y} r={7} fill={c} opacity="0.85"/>
                    <text x={x} y={y+4} textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">{z.split('=')[1]}</text>
                    {lbl && <text x={x+12} y={y+4} fontSize="8" fill={c} opacity="0.8">{lbl}</text>}
                  </g>
                ))}

                {/* Voltage ramp arrow */}
                <line x1="182" y1="192" x2="428" y2="192" stroke="#DAAA00" strokeWidth="1.5" markerEnd="url(#arr-gold)"/>
                <text x="305" y="205" textAnchor="middle" fontSize="9" fill="#DAAA00">voltage ramp (elution field) →</text>

                {/* Elution: separated ions exiting left */}
                {[[130,62,'#a855f7','z=+4 exits first'],[130,100,'#f97316','z=+3'],[130,140,'#2dd4bf','z=+2 exits last']].map(([x,y,c,lbl])=>(
                  <g key={y}>
                    <circle cx={x} cy={y} r={7} fill={c} opacity="0.9"/>
                    <line x1={x-8} y1={y} x2={x-40} y2={y} stroke={c} strokeWidth="1.5" markerEnd="url(#arr)"/>
                    <text x={x-52} y={y+4} textAnchor="end" fontSize="9" fill={c} opacity="0.85">{lbl}</text>
                  </g>
                ))}

                {/* 1/K₀ axis on far left */}
                <line x1="20" y1="55" x2="20" y2="150" stroke="#60a5fa" strokeWidth="1.5" markerEnd="url(#arr)"/>
                <text x="8" y="160" fontSize="9" fill="#60a5fa" textAnchor="middle">1/K₀</text>
                <text x="8" y="171" fontSize="8" fill="#60a5fa" opacity="0.6" textAnchor="middle">high</text>
                <text x="8" y="62" fontSize="8" fill="#60a5fa" opacity="0.6" textAnchor="middle">low</text>

                {/* MS detector label */}
                <rect x="555" y="65" width="90" height="80" rx="6" fill="rgba(30,58,95,0.6)" stroke="#1e3a5f" strokeWidth="1.5"/>
                <text x="600" y="99" textAnchor="middle" fontSize="10" fill="#60a5fa" fontWeight="700">MS</text>
                <text x="600" y="113" textAnchor="middle" fontSize="9" fill="#a0b4cc">detector</text>
                <text x="600" y="127" textAnchor="middle" fontSize="8" fill="#64748b">(Orbitrap or TOF)</text>
                <line x1="430" y1="105" x2="555" y2="105" stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="5 3" markerEnd="url(#arr)"/>

                {/* Result annotation */}
                <rect x="648" y="40" width="165" height="130" rx="6" fill="rgba(218,170,0,0.06)" stroke="rgba(218,170,0,0.25)" strokeWidth="1"/>
                <text x="730" y="62" textAnchor="middle" fontSize="9" fontWeight="700" fill="#DAAA00">Result: 4D data point</text>
                {[['RT (retention time)','#94a3b8'],['m/z (mass-to-charge)','#94a3b8'],['1/K₀ (ion mobility)','#60a5fa'],['Intensity','#94a3b8']].map(([t,c],i)=>(
                  <text key={t} x="657" y={82+i*17} fontSize="9" fill={c}>
                    {i===2 ? '★ ' : '· '}{t}
                  </text>
                ))}
                <text x="730" y="158" textAnchor="middle" fontSize="8" fill="#DAAA00" opacity="0.7">★ = IMS platforms (TIMS / DTIMS / TWIMS)</text>
              </svg>
            </div>

            {/* Timeline */}
            <div className="card">
              <h3 style={{marginBottom:'0.6rem'}}>Mass Spectrometry Timeline: From 2D to 4D</h3>
              <div style={{position:'relative',paddingLeft:'1rem'}}>
                {/* Vertical spine */}
                <div style={{position:'absolute',left:'1.5rem',top:'4px',bottom:'4px',width:'2px',background:'linear-gradient(180deg,#1e3a5f,#DAAA00 60%,#22c55e)'}}/>
                {[
                  {year:'1989',label:'ESI & MALDI — proteins by mass spec',sub:'Fenn (ESI, Science 1989) + Karas & Hillenkamp (MALDI, 1988) · Nobel Prize 2002 · for the first time intact proteins could be ionized and weighed — proteomics becomes possible',color:'#334155'},
                  {year:'2001',label:'Shotgun proteomics / MudPIT',sub:'Washburn, Wolters & Yates · Nature Biotechnology · 2D LC-MS/MS maps entire proteomes from complex mixtures · the 2D era (RT × m/z) begins in earnest',color:'#475569'},
                  {year:'2002',label:'Orbitrap invented',sub:'Makarov, Thermo Fisher · ultra-high mass accuracy (< 5 ppm) without a magnetic field · defines the 3D era (RT × m/z × intensity)',color:'#475569'},
                  {year:'2005',label:'LTQ-Orbitrap first commercial',sub:'Orbitrap enters proteomics labs worldwide · 2D LC-MS/MS becomes the gold standard · 1 µg HeLa = benchmark input',color:'#64748b'},
                  {year:'2011',label:'Q Exactive launched',sub:'Thermo Fisher · quadrupole isolation + HCD + Orbitrap · high-throughput DDA defined for a decade · benchmarks routinely use 1 µg HeLa',color:'#6b7280'},
                  {year:'2015',label:'PASEF concept published',sub:'Meier, Beck & Mann · Mol. Cell. Proteomics · ion mobility-aware fragmentation triggers — the theoretical foundation for 4D proteomics',color:'#334155'},
                  {year:'2017',label:'timsTOF prototype + PASEF demonstrated',sub:'Bruker & Mann lab · ASMS 2017 · trapped ion mobility + PASEF shown on prototype hardware · 4D dimension (CCS) enters the picture',color:'#3b82f6',is4D:true},
                  {year:'2018',label:'timsTOF commercial launch + PASEF paper',sub:'Bruker timsTOF released · Meier et al., JASMS · ddaPASEF: 5,000+ proteins from 200 ng HeLa in 60 min · 100% ion utilization via TIMS',color:'#60a5fa',is4D:true},
                  {year:'2020',label:'timsTOF Pro released',sub:'Bruker · improved TIMS resolution + dual TIMS · ~6,000 proteins from 200 ng HeLa · single-cell feasibility first demonstrated with carrier approach',color:'#38bdf8',is4D:true},
                  {year:'2021',label:'diaPASEF published + timsTOF SCP launched',sub:'Meier et al., Nature Methods · >8,000 proteins from 200 ng HeLa in 60 min · timsTOF SCP debuts at ASMS — first instrument purpose-built for single-cell proteomics',color:'#22c55e',is4D:true},
                  {year:'2022',label:'timsTOF Pro 2 + TIMScore + diaPASEF expansion',sub:'Bruker · >8,000 proteins in 35-min gradients · TIMScore ML CCS prediction: +25% phosphopeptides, 19% isobaric pair separation · PaSER GPU real-time streaming · Pro 2 / SCP / fleX all DIA-capable',color:'#06b6d4',is4D:true},
                  {year:'2023',label:'timsTOF Ultra + Thermo Astral launched',sub:'Bruker Ultra: 300 Hz PASEF, CaptiveSpray Ultra 2, Vista Scan dia-PASEF, MOMA isobaric separation · Thermo Astral: no IMS, ~200 Hz MS2 — competing design philosophies',color:'#a855f7',is4D:true},
                  {year:'2024',label:'timsTOF Ultra 2 · carrier-free single cell',sub:'Bruker (ASMS June 2024) · Athena Ion Processor (AIP) · up to 4,000 proteins/single HEK-293T — no carrier, no MBR · +50% protein groups, +100% peptides at 25 pg vs. Ultra · OmniScape + GlycoScape · field-upgradeable from Ultra/SCP',color:'#DAAA00',is4D:true},
                ].map((ev,i)=>(
                  <div key={i} style={{display:'flex',gap:'0.75rem',marginBottom:'0.55rem',alignItems:'flex-start'}}>
                    <div style={{width:'2.8rem',minWidth:'2.8rem',marginLeft:'0.5rem',zIndex:1,background:'var(--bg)',textAlign:'right',paddingRight:'0.4rem'}}>
                      <span style={{fontSize:'0.72rem',fontWeight:700,color:ev.color}}>{ev.year}</span>
                    </div>
                    <div style={{flex:1,background:ev.is4D?'rgba(96,165,250,0.04)':'rgba(255,255,255,0.01)',
                      borderLeft:`2px solid ${ev.color}55`,paddingLeft:'0.6rem',borderRadius:'0 0.3rem 0.3rem 0'}}>
                      <div style={{fontSize:'0.8rem',fontWeight:600,color:ev.is4D?ev.color:'#94a3b8'}}>
                        {ev.label} {ev.is4D && <span style={{fontSize:'0.65rem',background:'rgba(96,165,250,0.15)',color:'#60a5fa',padding:'0.05rem 0.3rem',borderRadius:'0.2rem',marginLeft:'0.3rem',verticalAlign:'middle'}}>4D</span>}
                      </div>
                      <div style={{fontSize:'0.7rem',color:'#4a6070',marginTop:'0.05rem'}}>{ev.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      );
    }

