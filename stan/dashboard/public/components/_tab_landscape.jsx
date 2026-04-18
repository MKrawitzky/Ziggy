    /* ── Landscape Viewer Tab ─────────────────────────────────────────── */
    /*
     * Sub-panels are TOP-LEVEL stable functions (not inline) so React never
     * unmounts them on parent re-render (ionsLoading state changes).
     */

    // ── Module-level style helpers ────────────────────────────────────────
    const _LS_SEL = {
      background:'var(--bg)', color:'var(--text)',
      border:'1px solid var(--border)', borderRadius:'0.35rem',
      padding:'0.3rem 0.6rem', fontSize:'0.8rem', minWidth:'220px',
    };
    const _LS_INP = {
      background:'var(--bg)', color:'var(--text)',
      border:'1px solid var(--border)', borderRadius:'0.3rem',
      padding:'0.3rem 0.5rem', fontSize:'0.8rem', width:'88px',
    };
    const _lsBtn = (active, col) => ({
      padding:'0.35rem 0.85rem', borderRadius:'0.35rem', cursor:'pointer',
      fontSize:'0.8rem', fontWeight: active ? 700 : 400,
      background: active ? `${col||'#1f6feb'}22` : 'transparent',
      border: `1px solid ${active ? (col||'var(--accent)') : 'var(--border)'}`,
      color: active ? (col||'var(--accent)') : 'var(--muted)',
      transition:'all 0.15s',
    });

    // Empirical 1/K₀ corridor formula: higher z → higher mobility at same m/z
    const _lsCcsExpected = (mz, z) => 0.3 + z * 0.12 + mz * (0.00015 + z * 0.00008);

    // ── Shared run selector card ──────────────────────────────────────────
    function LandscapeRunSelectors({ selA, setSelA, selB, setSelB, ionsRef, ionsLoading, runOpts }) {
      return (
        <div className="card" style={{marginBottom:'0.75rem',padding:'0.7rem 1rem'}}>
          <div style={{display:'flex',flexWrap:'wrap',gap:'1rem',alignItems:'flex-end'}}>
            {[['A','#58a6ff',selA,setSelA],['B','#f78166',selB,setSelB]].map(([k,col,val,set]) => (
              <div key={k} style={{display:'flex',flexDirection:'column',gap:'3px',borderLeft:`3px solid ${col}`,paddingLeft:'8px'}}>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>
                  Run {k}{k==='A'?' (required)':' (optional — compare)'}
                </div>
                <select value={val} onChange={e => { set(e.target.value); ionsRef.current[k]=null; }}
                  style={_LS_SEL}>
                  <option value="">{k==='A'?'— select run —':'— none —'}</option>
                  {runOpts}
                </select>
                {ionsLoading[k] && (
                  <div style={{fontSize:'0.68rem',color:'#f0883e',display:'flex',alignItems:'center',gap:'4px'}}>
                    <span style={{animation:'spin 1s linear infinite',display:'inline-block'}}>⟳</span> Loading ions…
                  </div>
                )}
              </div>
            ))}
            <div style={{fontSize:'0.72rem',color:'var(--muted)',maxWidth:'300px',lineHeight:1.5,alignSelf:'center'}}>
              Both runs must be timsTOF .d acquisitions.<br/>
              B is optional — used for run-to-run comparison.
            </div>
          </div>
        </div>
      );
    }

    // ── Guide panel ────────────────────────────────────────────────────────
    function LandscapeGuidePanel({ setMode }) {
      return (
        <div>
          <div className="card" style={{marginBottom:'0.75rem',background:'linear-gradient(135deg,rgba(1,26,58,0.95),rgba(2,40,81,0.7))'}}>
            <h3 style={{marginBottom:'0.4rem',color:'#60a5fa',fontSize:'1.1rem'}}>4D Ion Mobility Landscape Viewer</h3>
            <p style={{fontSize:'0.83rem',color:'var(--muted)',lineHeight:1.8,marginBottom:'0.75rem'}}>
              A timsTOF run contains up to <strong style={{color:'var(--text)'}}>10 million individual ions</strong>, each
              carrying four independent coordinates. Traditional viewers collapse this to a 2D TIC — discarding the
              mobility dimension entirely. Here, <strong style={{color:'var(--text)'}}>nothing is thrown away</strong>.
            </p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))',gap:'0.6rem'}}>
              {[
                {title:'Global Landscape',icon:'⛰',col:'#60a5fa',
                  desc:'The entire run as a 3D surface — m/z × 1/K₀ × intensity. Compare two runs side-by-side with a linked camera and compute a differential A − B map.',
                  badge:'3D surface · differential · camera sync',action:()=>setMode('global')},
                {title:'RT Slice',icon:'🔬',col:'#22c55e',
                  desc:'A 2D heatmap for any narrow RT window. Drag the slider through the gradient — watch peptides appear and dissolve as the LC column separates them.',
                  badge:'live heatmap · TIC tracker · charge corridors',action:()=>setMode('slice')},
                {title:'Peptide Focus',icon:'🎯',col:'#DAAA00',
                  desc:'Enter a precursor m/z. See its EIM (mobility peak), XIC (RT peak), and 2D spot map overlaid across two runs. CCS corridors show where each charge state should land.',
                  badge:'EIM · XIC · CCS prediction · Δ mobility',action:()=>setMode('peptide')},
              ].map(m => (
                <div key={m.title} onClick={m.action}
                  style={{background:`${m.col}0d`,border:`1px solid ${m.col}33`,borderRadius:'0.6rem',
                    padding:'0.85rem',cursor:'pointer',transition:'all 0.18s',position:'relative',overflow:'hidden'}}
                  onMouseEnter={e=>{e.currentTarget.style.background=`${m.col}1e`;e.currentTarget.style.borderColor=`${m.col}77`;}}
                  onMouseLeave={e=>{e.currentTarget.style.background=`${m.col}0d`;e.currentTarget.style.borderColor=`${m.col}33`;}}>
                  <div style={{fontSize:'1.6rem',marginBottom:'0.35rem'}}>{m.icon}</div>
                  <div style={{fontSize:'0.9rem',fontWeight:700,color:m.col,marginBottom:'0.3rem'}}>{m.title}</div>
                  <div style={{fontSize:'0.72rem',color:'var(--muted)',lineHeight:1.6,marginBottom:'0.5rem'}}>{m.desc}</div>
                  <div style={{fontSize:'0.62rem',color:`${m.col}aa`,fontFamily:'monospace',letterSpacing:'0.3px',marginBottom:'0.4rem'}}>{m.badge}</div>
                  <div style={{fontSize:'0.75rem',color:m.col,fontWeight:700}}>Open →</div>
                </div>
              ))}
            </div>
          </div>

          {/* Axis explainer */}
          <div className="card" style={{marginBottom:'0.75rem'}}>
            <h3 style={{marginBottom:'0.6rem',fontSize:'0.95rem'}}>The four coordinates of every ion</h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:'0.5rem'}}>
              {[
                {num:'1',axis:'Retention Time',unit:'min',col:'#94a3b8',
                  what:'When the peptide eluted from the LC column.',orbi:'✓',tims:'✓'},
                {num:'2',axis:'m/z',unit:'Thomson (Th)',col:'#a78bfa',
                  what:'Mass-to-charge ratio. Identifies the peptide and its charge state.',orbi:'✓',tims:'✓'},
                {num:'3',axis:'1/K₀',unit:'Vs/cm²',col:'#60a5fa',
                  what:"Ion mobility. How fast it drifts through N₂. Encodes the ion's 3D shape — a structural fingerprint unavailable on Orbitrap. Measured by TIMS (Bruker), DTIMS (Agilent), and TWIMS (Waters).",orbi:'✗',tims:'IMS platforms'},
                {num:'4',axis:'Intensity',unit:'log a.u.',col:'#DAAA00',
                  what:'Signal strength. How much of this ion was detected.',orbi:'✓',tims:'✓'},
              ].map(d=>(
                <div key={d.axis} style={{background:'rgba(255,255,255,0.025)',border:`1px solid ${d.col}2a`,borderRadius:'0.45rem',padding:'0.65rem',position:'relative'}}>
                  <div style={{position:'absolute',top:'0.5rem',right:'0.6rem',fontSize:'1.4rem',fontWeight:900,color:`${d.col}18`,fontFamily:'monospace'}}>{d.num}</div>
                  <div style={{fontSize:'0.78rem',fontWeight:700,color:d.col,marginBottom:'0.15rem'}}>{d.axis}</div>
                  <div style={{fontSize:'0.62rem',color:'#3a5060',marginBottom:'0.3rem',fontFamily:'monospace'}}>{d.unit}</div>
                  <div style={{fontSize:'0.7rem',color:'#64748b',lineHeight:1.55,marginBottom:'0.35rem'}}>{d.what}</div>
                  <div style={{fontSize:'0.65rem',display:'flex',gap:'0.6rem'}}>
                    <span><span style={{color:'#475569'}}>Orbitrap </span><span style={{color:d.orbi==='✓'?'#22c55e':'#ef4444',fontWeight:700}}>{d.orbi}</span></span>
                    <span><span style={{color:'#60a5fa'}}>timsTOF </span><span style={{color:'#22c55e',fontWeight:700}}>{d.tims}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* What you're looking at */}
          <div className="card">
            <h3 style={{marginBottom:'0.5rem',fontSize:'0.95rem'}}>Why this matters for proteomics</h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'0.5rem'}}>
              {[
                {col:'#a78bfa',title:'Peak Capacity × 10×',body:'Ion mobility adds an orthogonal separation dimension before mass analysis. Each TIMS accumulation cycle sorts ~1M ions by shape before releasing them — separating co-eluting isobaric peptides that would overlap in 2D LC-MS.'},
                {col:'#22c55e',title:'Charge State Corridors',body:'Higher-charge peptides are larger and have higher 1/K₀ at the same m/z. This creates predictable diagonal bands in the m/z × 1/K₀ space — visible in RT Slice mode as the dashed overlay lines.'},
                {col:'#f97316',title:'CCS as a Structural ID',body:'Collision Cross Section (CCS = 1/K₀ normalised) is reproducible across labs and instruments. Identical 1/K₀ peaks across two runs confirm you\'re looking at the same peptide conformation — not a different adduct or isomer.'},
              ].map(d=>(
                <div key={d.title} style={{background:`${d.col}08`,border:`1px solid ${d.col}22`,borderRadius:'0.45rem',padding:'0.65rem'}}>
                  <div style={{fontSize:'0.8rem',fontWeight:700,color:d.col,marginBottom:'0.3rem'}}>{d.title}</div>
                  <div style={{fontSize:'0.71rem',color:'#64748b',lineHeight:1.6}}>{d.body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Global 3D Landscape
    // ═══════════════════════════════════════════════════════════════════════
    function LandscapeGlobal({ selA, setSelA, selB, setSelB, ionsRef, loadIons, ionsLoading, runOpts }) {
      const [viewMode, setViewMode] = useState('landscape');
      const [res, setRes]     = useState('med');
      const [syncCam, setSyncCam] = useState(true);
      const [smooth, setSmooth]   = useState(true);
      const [mzLo, setMzLo] = useState(300);
      const [mzHi, setMzHi] = useState(1500);
      const [stats, setStats] = useState({A:'',B:'',diff:'',sim:null,peakMzA:null,peakMzB:null});
      const [rendered, setRendered] = useState(false);

      const plotARef = useRef(null);
      const plotBRef = useRef(null);
      const plotDRef = useRef(null);
      const cameraRef = useRef(null);
      const syncingRef = useRef(false);
      const gridsRef = useRef({A:null, B:null});

      const K0_LO = 0.48, K0_HI = 1.82;
      const RES_MAP = {fast:[80,50],med:[130,80],hi:[220,130]};
      const CS = {
        A:[[0,'#0d1117'],[0.15,'#1c4e80'],[0.45,'#1f6feb'],[0.75,'#58a6ff'],[1,'#cae8ff']],
        B:[[0,'#0d1117'],[0.15,'#5a1e0f'],[0.45,'#b03a2e'],[0.75,'#f78166'],[1,'#ffd3cc']],
        diff:[[0,'#f78166'],[0.35,'#8b1a0e'],[0.5,'#161b22'],[0.65,'#0a2e6e'],[1,'#58a6ff']],
      };

      useEffect(() => () => {
        [plotARef, plotBRef, plotDRef].forEach(r => {
          if (r.current && window.Plotly) window.Plotly.purge(r.current);
        });
      }, []);

      function linspace(lo,hi,n){return Array.from({length:n},(_,i)=>lo+(hi-lo)*i/(n-1));}

      function buildGrid(ions, W, H) {
        const mzStep=(mzHi-mzLo)/W, k0Step=(K0_HI-K0_LO)/H;
        const flat=new Float64Array(W*H); let kept=0;
        for(let i=0;i<ions.mz.length;i++){
          if(ions.mz[i]<mzLo||ions.mz[i]>mzHi)continue;
          if(ions.mobility[i]<K0_LO||ions.mobility[i]>K0_HI)continue;
          const xi=Math.min(W-1,Math.floor((ions.mz[i]-mzLo)/mzStep));
          const yi=Math.min(H-1,Math.floor((ions.mobility[i]-K0_LO)/k0Step));
          flat[yi*W+xi]+=ions.log_int[i]; kept++;
        }
        const grid=[];
        for(let y=0;y<H;y++){const row=Array(W);for(let x=0;x<W;x++)row[x]=flat[y*W+x];grid.push(row);}
        return {grid,kept};
      }

      function gaussBlur(grid,H,W){
        const K=[1,2,1,2,4,2,1,2,1];let g=grid;
        for(let p=0;p<2;p++){
          const out=Array.from({length:H},()=>Array(W).fill(0));
          for(let y=0;y<H;y++)for(let x=0;x<W;x++){
            let s=0;
            for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
              s+=g[Math.max(0,Math.min(H-1,y+dy))][Math.max(0,Math.min(W-1,x+dx))]*K[(dy+1)*3+(dx+1)];
            out[y][x]=s/16;
          }
          g=out;
        }
        return g;
      }

      function makeLayout(title){
        return {
          paper_bgcolor:'#0d1117',plot_bgcolor:'#0d1117',
          margin:{l:0,r:0,t:28,b:0},
          title:{text:title,font:{size:10,color:'#8b949e'},x:0.5},
          scene:{
            bgcolor:'#060b14',
            xaxis:{title:{text:'m/z',font:{size:9}},tickfont:{size:8,color:'#8b949e'},gridcolor:'#161b22',range:[mzLo,mzHi]},
            yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:9}},tickfont:{size:8,color:'#8b949e'},gridcolor:'#161b22',range:[K0_LO,K0_HI]},
            zaxis:{title:{text:''},tickfont:{size:8,color:'#8b949e'},showticklabels:false,gridcolor:'#161b22'},
            camera: cameraRef.current||{eye:{x:1.6,y:-1.6,z:0.9}},
            aspectmode:'manual',aspectratio:{x:2.0,y:1.2,z:0.65},
          },
        };
      }

      function renderSurface(el,grid,W,H,cs,title){
        if(!el||!window.Plotly)return;
        window.Plotly.react(el,[{
          type:'surface',x:linspace(mzLo,mzHi,W),y:linspace(K0_LO,K0_HI,H),z:grid,
          colorscale:cs,showscale:false,opacity:0.95,
          contours:{z:{show:true,usecolormap:true,project:{z:true}}},
          hovertemplate:'m/z: %{x:.1f}<br>1/K₀: %{y:.3f}<br>Int: %{z:.1f}<extra></extra>',
          lighting:{ambient:0.65,diffuse:0.4,specular:0.05,roughness:0.9},
        }],makeLayout(title),{displaylogo:false,responsive:true});
      }

      function attachSync(el, others) {
        if(!el||!el.on)return;
        el.on('plotly_relayout',ev=>{
          if(!syncCam||syncingRef.current)return;
          const cam=ev['scene.camera']; if(!cam)return;
          syncingRef.current=true; cameraRef.current=cam;
          others.forEach(o=>{if(o&&o._fullLayout)window.Plotly.relayout(o,{'scene.camera':cam}).catch(()=>{});});
          syncingRef.current=false;
        });
      }

      // Compute dominant m/z bin (highest total intensity)
      function peakMzBin(ions, W) {
        const mzStep=(mzHi-mzLo)/W;
        const bins=new Float64Array(W);
        for(let i=0;i<ions.mz.length;i++){
          if(ions.mz[i]<mzLo||ions.mz[i]>mzHi)continue;
          const xi=Math.min(W-1,Math.floor((ions.mz[i]-mzLo)/mzStep));
          bins[xi]+=ions.log_int[i];
        }
        let max=0,idx=0;
        for(let i=0;i<W;i++){if(bins[i]>max){max=bins[i];idx=i;}}
        return (mzLo + (idx+0.5)*mzStep).toFixed(1);
      }

      async function doRender() {
        await Promise.all([loadIons('A',selA), loadIons('B',selB)]);
        const [W,H]=RES_MAP[res];
        ['A','B'].forEach(k=>{
          const ions=ionsRef.current[k];
          if(!ions?.mz){gridsRef.current[k]=null;return;}
          const{grid,kept}=buildGrid(ions,W,H);
          gridsRef.current[k]=smooth?gaussBlur(grid,H,W):grid;
          const pmz=peakMzBin(ions,W);
          setStats(s=>({...s,[k]:`${kept.toLocaleString()} ions`, [`peakMz${k}`]:pmz}));
        });
        if(gridsRef.current.A) renderSurface(plotARef.current,gridsRef.current.A,W,H,CS.A,'Run A');
        if(gridsRef.current.B) renderSurface(plotBRef.current,gridsRef.current.B,W,H,CS.B,'Run B');
        if(viewMode==='diff'&&gridsRef.current.A&&gridsRef.current.B){
          const gA=gridsRef.current.A,gB=gridsRef.current.B;
          let maxA=0,maxB=0;
          for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(gA[y][x]>maxA)maxA=gA[y][x];if(gB[y][x]>maxB)maxB=gB[y][x];}
          const sA=maxA>0?1/maxA:1,sB=maxB>0?1/maxB:1;
          const diff=gA.map((row,y)=>row.map((v,x)=>v*sA-gB[y][x]*sB));
          let absMax=0; diff.forEach(row=>row.forEach(v=>{if(Math.abs(v)>absMax)absMax=Math.abs(v);}));
          // Pearson similarity
          const aN=gA.flat().map(v=>v*sA),bN=gB.flat().map(v=>v*sB);
          const n=aN.length,mA=aN.reduce((s,v)=>s+v,0)/n,mB=bN.reduce((s,v)=>s+v,0)/n;
          let cov=0,sAv=0,sBv=0;
          for(let i=0;i<n;i++){const da=aN[i]-mA,db=bN[i]-mB;cov+=da*db;sAv+=da*da;sBv+=db*db;}
          const r=(sAv>0&&sBv>0)?cov/Math.sqrt(sAv*sBv):0;
          setStats(s=>({...s,diff:'A − B differential',sim:Math.max(0,Math.min(1,r))}));
          window.Plotly.react(plotDRef.current,[{
            type:'surface',x:linspace(mzLo,mzHi,W),y:linspace(K0_LO,K0_HI,H),z:diff,
            colorscale:CS.diff,showscale:true,cmin:-absMax,cmax:absMax,
            colorbar:{thickness:8,len:0.5,x:1.01,tickfont:{size:8,color:'#8b949e'},
              title:{text:'A−B',font:{size:9,color:'#8b949e'},side:'right'}},
            contours:{z:{show:true,usecolormap:true,project:{z:true}}},
            hovertemplate:'m/z:%{x:.1f}<br>1/K₀:%{y:.3f}<br>A−B:%{z:.3f}<extra></extra>',
            lighting:{ambient:0.6,diffuse:0.4},
          }],makeLayout('Differential · A − B (normalised)'),{displaylogo:false,responsive:true});
        }
        setTimeout(()=>{
          attachSync(plotARef.current,[plotBRef.current,plotDRef.current]);
          attachSync(plotBRef.current,[plotARef.current,plotDRef.current]);
          attachSync(plotDRef.current,[plotARef.current,plotBRef.current]);
        },600);
        setRendered(true);
      }

      // SVG similarity dial
      const SimilarityDial = ({sim}) => {
        const pct = sim * 100;
        const r = 40, cx = 56, cy = 56;
        const angle = (sim * 180 - 90) * Math.PI / 180;
        const nx = cx + r * Math.cos(angle), ny = cy + r * Math.sin(angle);
        const col = pct > 90 ? '#22c55e' : pct > 70 ? '#eab308' : pct > 50 ? '#f97316' : '#ef4444';
        // Arc from -90° to angle
        const startX = cx, startY = cy - r;
        const largeArc = sim > 0.5 ? 1 : 0;
        return (
          <svg width="112" height="70" style={{display:'block',margin:'0 auto'}}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e3a5f" strokeWidth="8"/>
            <path d={`M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${nx} ${ny}`}
              fill="none" stroke={col} strokeWidth="8" strokeLinecap="round"/>
            <text x={cx} y={cy+8} textAnchor="middle" fontSize="16" fontWeight="900" fill={col}>{pct.toFixed(0)}%</text>
            <text x={cx} y={cy+22} textAnchor="middle" fontSize="9" fill="#475569">similarity</text>
          </svg>
        );
      };

      const nCols = viewMode==='diff' && selB ? 3 : (selA&&selB?2:1);

      return (
        <div>
          <div style={{fontSize:'0.78rem',color:'var(--muted)',marginBottom:'0.75rem',lineHeight:1.7}}>
            The entire run collapsed into a single surface: <strong>m/z</strong> × <strong>1/K₀</strong> × <strong>intensity</strong>.
            Each peak is a cloud of peptides co-eluting in that mass-mobility region.
            Two runs share a <strong>linked camera</strong> — rotate one, both follow.
            The <strong>A − B differential</strong> highlights what changed between injections.
          </div>
          <LandscapeRunSelectors selA={selA} setSelA={setSelA} selB={selB} setSelB={setSelB}
            ionsRef={ionsRef} ionsLoading={ionsLoading} runOpts={runOpts} />

          {/* Stats bar — shown after render */}
          {rendered && (
            <div className="card" style={{marginBottom:'0.75rem',padding:'0.6rem 1rem',background:'rgba(1,26,58,0.5)'}}>
              <div style={{display:'flex',flexWrap:'wrap',gap:'1.5rem',alignItems:'center'}}>
                {selA && stats.A && (
                  <div style={{borderLeft:'3px solid #58a6ff',paddingLeft:'8px'}}>
                    <div style={{fontSize:'0.65rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>Run A</div>
                    <div style={{fontSize:'0.9rem',fontWeight:700,color:'#58a6ff'}}>{stats.A}</div>
                    {stats.peakMzA && <div style={{fontSize:'0.68rem',color:'var(--muted)'}}>dominant m/z ≈ <strong style={{color:'#a0b4cc'}}>{stats.peakMzA}</strong></div>}
                  </div>
                )}
                {selB && stats.B && (
                  <div style={{borderLeft:'3px solid #f78166',paddingLeft:'8px'}}>
                    <div style={{fontSize:'0.65rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>Run B</div>
                    <div style={{fontSize:'0.9rem',fontWeight:700,color:'#f78166'}}>{stats.B}</div>
                    {stats.peakMzB && <div style={{fontSize:'0.68rem',color:'var(--muted)'}}>dominant m/z ≈ <strong style={{color:'#a0b4cc'}}>{stats.peakMzB}</strong></div>}
                  </div>
                )}
                {stats.sim !== null && stats.sim !== undefined && (
                  <div style={{marginLeft:'auto'}}>
                    <SimilarityDial sim={stats.sim}/>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.7rem 1rem'}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:'0.75rem',alignItems:'flex-end'}}>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>m/z range</div>
                <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                  <input type="number" value={mzLo} onChange={e=>setMzLo(+e.target.value)} style={_LS_INP}/>
                  <span style={{color:'var(--muted)'}}>–</span>
                  <input type="number" value={mzHi} onChange={e=>setMzHi(+e.target.value)} style={_LS_INP}/>
                  <button onClick={()=>{setMzLo(300);setMzHi(1500);}} style={_lsBtn(false)}>Full</button>
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>View</div>
                <div style={{display:'flex',gap:'4px'}}>
                  {[['landscape','Side-by-side'],['diff','A − B diff']].map(([m,lbl])=>(
                    <button key={m} onClick={()=>setViewMode(m)} style={_lsBtn(viewMode===m)}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>Resolution</div>
                <div style={{display:'flex',gap:'4px'}}>
                  {[['fast','Fast'],['med','Med'],['hi','Hi']].map(([r,lbl])=>(
                    <button key={r} onClick={()=>{setRes(r);gridsRef.current={A:null,B:null};}} style={_lsBtn(res===r)}>{lbl}</button>
                  ))}
                </div>
              </div>
              <label style={{display:'flex',gap:'5px',alignItems:'center',cursor:'pointer',fontSize:'0.8rem',alignSelf:'flex-end',marginBottom:'2px'}}>
                <input type="checkbox" checked={syncCam} onChange={e=>setSyncCam(e.target.checked)}/>Link cameras
              </label>
              <label style={{display:'flex',gap:'5px',alignItems:'center',cursor:'pointer',fontSize:'0.8rem',alignSelf:'flex-end',marginBottom:'2px'}}>
                <input type="checkbox" checked={smooth} onChange={e=>{setSmooth(e.target.checked);gridsRef.current={A:null,B:null};}}/>Smooth
              </label>
              <button onClick={doRender} disabled={!selA}
                style={{padding:'0.45rem 1.25rem',background:selA?'#1f6feb':'transparent',
                  border:`1px solid ${selA?'#388bfd':'var(--border)'}`,color:selA?'#fff':'var(--muted)',
                  borderRadius:'0.4rem',cursor:selA?'pointer':'not-allowed',fontWeight:700,fontSize:'0.85rem',alignSelf:'flex-end'}}>
                Render
              </button>
            </div>
          </div>
          {/* Plots */}
          <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(nCols,3)},1fr)`,gap:'0.5rem'}}>
            {selA&&(
              <div className="card" style={{padding:0,overflow:'hidden',background:'#0d1117'}}>
                <div style={{padding:'0.35rem 0.75rem',borderBottom:'1px solid #21262d',display:'flex',justifyContent:'space-between'}}>
                  <span style={{fontWeight:600,fontSize:'0.8rem',color:'#58a6ff'}}>Run A</span>
                  <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>{stats.A}</span>
                </div>
                <div ref={plotARef} style={{height:'420px'}}/>
              </div>
            )}
            {selA&&selB&&viewMode!=='diff'&&(
              <div className="card" style={{padding:0,overflow:'hidden',background:'#0d1117'}}>
                <div style={{padding:'0.35rem 0.75rem',borderBottom:'1px solid #21262d',display:'flex',justifyContent:'space-between'}}>
                  <span style={{fontWeight:600,fontSize:'0.8rem',color:'#f78166'}}>Run B</span>
                  <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>{stats.B}</span>
                </div>
                <div ref={plotBRef} style={{height:'420px'}}/>
              </div>
            )}
            {selA&&selB&&viewMode==='diff'&&(
              <>
                <div className="card" style={{padding:0,overflow:'hidden',background:'#0d1117'}}>
                  <div style={{padding:'0.35rem 0.75rem',borderBottom:'1px solid #21262d',display:'flex',justifyContent:'space-between'}}>
                    <span style={{fontWeight:600,fontSize:'0.8rem',color:'#f78166'}}>Run B</span>
                    <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>{stats.B}</span>
                  </div>
                  <div ref={plotBRef} style={{height:'420px'}}/>
                </div>
                <div className="card" style={{padding:0,overflow:'hidden',background:'#0d1117'}}>
                  <div style={{padding:'0.35rem 0.75rem',borderBottom:'1px solid #21262d',display:'flex',justifyContent:'space-between'}}>
                    <span style={{fontWeight:600,fontSize:'0.8rem',color:'var(--muted)'}}>Differential A − B</span>
                    <span style={{fontSize:'0.72rem',color:'var(--accent)'}}>{stats.diff}</span>
                  </div>
                  <div ref={plotDRef} style={{height:'420px'}}/>
                </div>
              </>
            )}
          </div>
          {!selA&&(
            <div className="card" style={{textAlign:'center',padding:'4rem',color:'var(--muted)'}}>
              Select Run A above and click Render
            </div>
          )}
        </div>
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RT Slice — 2D heatmap at a sliding RT window + TIC tracker
    // ═══════════════════════════════════════════════════════════════════════
    function LandscapeRtSlice({ selA, setSelA, selB, setSelB, ionsRef, loadIons, ionsLoading, runOpts }) {
      const [rtCenter, setRtCenter] = useState(30);
      const [rtWidth, setRtWidth]   = useState(3);
      const [mzLo, setMzLo] = useState(300);
      const [mzHi, setMzHi] = useState(1500);
      const [stats, setStats] = useState({A:'',B:''});
      const [chargeCounts, setChargeCounts] = useState({A:null, B:null});
      const canvasARef = useRef(null);
      const canvasBRef = useRef(null);
      const ticARef    = useRef(null);  // Plotly TIC sparkline A
      const ticBRef    = useRef(null);  // Plotly TIC sparkline B
      const gridsRef   = useRef({A:null,B:null});
      const ticDataRef = useRef({A:null,B:null}); // precomputed TIC {x,y} in minutes
      const K0_LO=0.48, K0_HI=1.82, W=160, H=100;

      useEffect(()=>()=>{
        [ticARef,ticBRef].forEach(r=>{if(r.current&&window.Plotly)window.Plotly.purge(r.current);});
      },[]);

      function buildTic(ions) {
        if(!ions?.rt) return null;
        const BINS=300;
        const rtMin=Math.min(...ions.rt)/60, rtMax=Math.max(...ions.rt)/60;
        const step=(rtMax-rtMin)/BINS;
        const y=new Float64Array(BINS);
        for(let i=0;i<ions.rt.length;i++){
          const b=Math.min(BINS-1,Math.floor((ions.rt[i]/60-rtMin)/step));
          y[b]+=ions.log_int[i];
        }
        const x=Array.from({length:BINS},(_,i)=>+(rtMin+(i+0.5)*step).toFixed(2));
        const yArr=Array.from(y);
        return {x,y:yArr,rtMin,rtMax,step};
      }

      function drawTic(el, ticData, rtLo, rtHi, color) {
        if(!el||!window.Plotly||!ticData) return;
        const col = color==='blue'?'#58a6ff':'#f78166';
        const fillCol = color==='blue'?'rgba(88,166,255,0.15)':'rgba(247,129,102,0.15)';
        window.Plotly.react(el, [
          // Area trace
          {type:'scatter',mode:'lines',x:ticData.x,y:ticData.y,
           fill:'tozeroy',fillcolor:fillCol,line:{color:col,width:1.5},
           hovertemplate:'RT: %{x:.1f} min<br>TIC: %{y:,.0f}<extra></extra>'},
          // Window highlight
          {type:'scatter',mode:'lines',
           x:[rtLo,rtLo,rtHi,rtHi,rtLo],
           y:[0,Math.max(...ticData.y)*1.05,Math.max(...ticData.y)*1.05,0,0],
           fill:'toself',fillcolor:`${col}1a`,
           line:{color:`${col}88`,width:1,dash:'dot'},
           hoverinfo:'skip',showlegend:false},
        ], {
          paper_bgcolor:'transparent',plot_bgcolor:'transparent',
          margin:{l:40,r:8,t:4,b:30},
          font:{color:'#64748b',size:9},
          xaxis:{title:{text:'RT (min)',font:{size:9}},gridcolor:'rgba(30,58,95,0.4)',
            tickfont:{size:8},range:[ticData.rtMin,ticData.rtMax]},
          yaxis:{showgrid:false,showticklabels:false,zeroline:false},
          showlegend:false,hovermode:'x unified',
        },{responsive:true,displayModeBar:false});
      }

      function buildSlice(ions, rtLo, rtHi) {
        if(!ions?.mz) return null;
        const mzStep=(mzHi-mzLo)/W, k0Step=(K0_HI-K0_LO)/H;
        const flat=new Float64Array(W*H); let kept=0;
        const rtLoS=rtLo*60, rtHiS=rtHi*60;
        const chargeMap={};
        for(let i=0;i<ions.mz.length;i++){
          if(ions.rt[i]<rtLoS||ions.rt[i]>rtHiS)continue;
          if(ions.mz[i]<mzLo||ions.mz[i]>mzHi)continue;
          if(ions.mobility[i]<K0_LO||ions.mobility[i]>K0_HI)continue;
          const xi=Math.min(W-1,Math.floor((ions.mz[i]-mzLo)/mzStep));
          const yi=Math.min(H-1,Math.floor((ions.mobility[i]-K0_LO)/k0Step));
          flat[yi*W+xi]+=ions.log_int[i]; kept++;
          const z=ions.charge[i]||0;
          chargeMap[z]=(chargeMap[z]||0)+1;
        }
        return {flat, kept, chargeMap};
      }

      function drawHeatmap(canvas, flat, color) {
        if(!canvas||!flat)return;
        const ctx=canvas.getContext('2d');
        const cw=canvas.width, ch=canvas.height;
        // Dark background
        ctx.fillStyle='#060b14';
        ctx.fillRect(0,0,cw,ch);
        let maxV=0;
        for(let i=0;i<flat.length;i++) if(flat[i]>maxV)maxV=flat[i];
        if(maxV===0) return;

        // Colour stops — deep space palette
        const stops = color==='blue'
          ? [[0,[2,8,24]],[0.2,[15,50,110]],[0.5,[28,78,180]],[0.8,[88,166,255]],[1,[200,230,255]]]
          : [[0,[20,4,4]],[0.2,[100,20,10]],[0.5,[180,50,30]],[0.8,[247,129,102]],[1,[255,210,200]]];

        function valToRgb(v) {
          const t=Math.pow(v,0.45);
          for(let i=0;i<stops.length-1;i++){
            const [t0,c0]=stops[i],[t1,c1]=stops[i+1];
            if(t>=t0&&t<=t1){const f=(t-t0)/(t1-t0);return[Math.round(c0[0]+f*(c1[0]-c0[0])),Math.round(c0[1]+f*(c1[1]-c0[1])),Math.round(c0[2]+f*(c1[2]-c0[2]))];}
          }
          return stops[stops.length-1][1];
        }

        const imgD=ctx.createImageData(cw,ch);
        const scaleX=cw/W, scaleY=ch/H;
        for(let y=0;y<H;y++) for(let x=0;x<W;x++){
          const v=flat[y*W+x]/maxV;
          if(v<=0.005) continue;
          const [pr,pg,pb]=valToRgb(v);
          const pa=Math.round(30+v*225);
          for(let py=Math.floor(y*scaleY);py<Math.ceil((y+1)*scaleY)&&py<ch;py++)
            for(let px=Math.floor(x*scaleX);px<Math.ceil((x+1)*scaleX)&&px<cw;px++){
              const idx=(py*cw+px)*4;
              imgD.data[idx]=pr; imgD.data[idx+1]=pg; imgD.data[idx+2]=pb; imgD.data[idx+3]=pa;
            }
        }
        ctx.putImageData(imgD,0,0);

        // Axis frame
        ctx.strokeStyle='rgba(30,58,95,0.5)'; ctx.lineWidth=1;
        ctx.strokeRect(0,0,cw,ch);

        // Charge corridor lines with gradient glow
        [[1,'rgba(45,212,191,0.5)',45,212,191],[2,'rgba(96,165,250,0.5)',96,165,250],
         [3,'rgba(34,197,94,0.5)',34,197,94],[4,'rgba(249,115,22,0.5)',249,115,22]].forEach(([z,c,r,g,b])=>{
          // Build corridor path
          const pts=[];
          for(let mx=mzLo;mx<=mzHi;mx+=8){
            const k0=_lsCcsExpected(mx,z);
            if(k0<K0_LO||k0>K0_HI)continue;
            pts.push([(mx-mzLo)/(mzHi-mzLo)*cw, ch-(k0-K0_LO)/(K0_HI-K0_LO)*ch]);
          }
          if(pts.length<2)return;
          // Glow pass
          ctx.strokeStyle=`rgba(${r},${g},${b},0.12)`; ctx.lineWidth=7; ctx.setLineDash([]);
          ctx.beginPath(); pts.forEach(([px,py],i)=>i===0?ctx.moveTo(px,py):ctx.lineTo(px,py)); ctx.stroke();
          // Main line
          ctx.strokeStyle=c; ctx.lineWidth=1.2; ctx.setLineDash([4,4]);
          ctx.beginPath(); pts.forEach(([px,py],i)=>i===0?ctx.moveTo(px,py):ctx.lineTo(px,py)); ctx.stroke();
          ctx.setLineDash([]);
          // Label
          const [lx,ly]=pts[Math.floor(pts.length*0.8)];
          ctx.fillStyle=`rgba(${r},${g},${b},0.85)`; ctx.font='bold 9.5px monospace'; ctx.textAlign='left';
          ctx.fillText(`z+${z}`,lx+4,ly-4);
        });

        // Axis labels
        ctx.fillStyle='rgba(100,130,160,0.7)'; ctx.font='10px -apple-system, sans-serif';
        ctx.textAlign='center';
        ctx.fillText(`m/z ${mzLo}`, 30, ch-5);
        ctx.fillText(`${mzHi}`, cw-25, ch-5);
        ctx.fillText('m/z →', cw/2, ch-3);
        ctx.save(); ctx.translate(11,ch/2); ctx.rotate(-Math.PI/2);
        ctx.fillText('1/K₀ →', 0, 0); ctx.restore();
        ctx.textAlign='left'; ctx.font='9px monospace';
        ctx.fillStyle='rgba(100,130,160,0.5)';
        ctx.fillText(`${K0_HI}`, 16, 13);
        ctx.fillText(`${K0_LO}`, 16, ch-14);
      }

      function redrawAll() {
        const lo=rtCenter-rtWidth/2, hi=rtCenter+rtWidth/2;
        ['A','B'].forEach(k=>{
          const ions=ionsRef.current[k]; if(!ions)return;
          const s=buildSlice(ions,lo,hi);
          gridsRef.current[k]=s?s.flat:null;
          setStats(p=>({...p,[k]:s?`${s.kept.toLocaleString()} ions`:'no data'}));
          if(s) setChargeCounts(cc=>({...cc,[k]:s.chargeMap}));
        });
        drawHeatmap(canvasARef.current,gridsRef.current.A,'blue');
        drawHeatmap(canvasBRef.current,gridsRef.current.B,'red');
        // Update TIC cursor
        const lo2=rtCenter-rtWidth/2, hi2=rtCenter+rtWidth/2;
        if(ticDataRef.current.A) drawTic(ticARef.current,ticDataRef.current.A,lo2,hi2,'blue');
        if(ticDataRef.current.B) drawTic(ticBRef.current,ticDataRef.current.B,lo2,hi2,'red');
      }

      useEffect(()=>{
        if(!ionsRef.current.A&&!ionsRef.current.B)return;
        redrawAll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      },[rtCenter,rtWidth,mzLo,mzHi]);

      async function renderSlice() {
        await Promise.all([loadIons('A',selA),loadIons('B',selB)]);
        // Precompute TICs
        ['A','B'].forEach(k=>{
          const ions=ionsRef.current[k];
          if(ions) ticDataRef.current[k]=buildTic(ions);
        });
        redrawAll();
      }

      // Charge bar chart (live)
      const ChargeBar = ({counts, col}) => {
        if(!counts) return null;
        const CHARGE_COL={1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',0:'#64748b'};
        const entries=Object.entries(counts).map(([z,n])=>({z:+z,n})).filter(e=>e.z>0).sort((a,b)=>a.z-b.z);
        if(!entries.length) return null;
        const maxN=Math.max(...entries.map(e=>e.n));
        return (
          <div style={{display:'flex',gap:'4px',alignItems:'flex-end',height:'36px',padding:'0 4px'}}>
            {entries.map(({z,n})=>{
              const pct=n/maxN;
              const c=CHARGE_COL[z]||'#94a3b8';
              return (
                <div key={z} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'1px'}}>
                  <div style={{width:'16px',background:c,height:`${Math.max(2,pct*28)}px`,borderRadius:'1px 1px 0 0',opacity:0.85,transition:'height 0.25s'}}/>
                  <div style={{fontSize:'8px',color:c,fontWeight:700}}>z+{z}</div>
                </div>
              );
            })}
          </div>
        );
      };

      return (
        <div>
          <div style={{fontSize:'0.78rem',color:'var(--muted)',marginBottom:'0.75rem',lineHeight:1.7}}>
            A <strong>2D heatmap</strong> showing m/z (horizontal) × 1/K₀ (vertical) for a narrow RT window.
            Drag the <strong>slider</strong> to sweep through the gradient — peptides appear and vanish as the LC
            column elutes them by hydrophobicity. The <strong>TIC sparkline</strong> below shows total ion current
            vs time; the highlighted band tracks your current window.
          </div>
          <LandscapeRunSelectors selA={selA} setSelA={setSelA} selB={selB} setSelB={setSelB}
            ionsRef={ionsRef} ionsLoading={ionsLoading} runOpts={runOpts} />

          {/* Controls */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.7rem 1rem'}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:'1rem',alignItems:'flex-end'}}>
              <div style={{flex:1,minWidth:'260px'}}>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'4px'}}>
                  RT window centre: <strong style={{color:'var(--text)'}}>{rtCenter} min</strong>
                  &nbsp;±&nbsp;{(rtWidth/2).toFixed(1)} min
                  &nbsp;→&nbsp; <span style={{color:'#22c55e',fontWeight:700}}>{(rtCenter-rtWidth/2).toFixed(1)}–{(rtCenter+rtWidth/2).toFixed(1)} min</span>
                </div>
                <input type="range" min="5" max="120" step="0.5" value={rtCenter}
                  onChange={e=>setRtCenter(+e.target.value)}
                  style={{width:'100%',accentColor:'#22c55e'}}/>
              </div>
              <div>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'4px'}}>Window width (min)</div>
                <div style={{display:'flex',gap:'4px'}}>
                  {[1,2,3,5,10].map(w=>(
                    <button key={w} onClick={()=>setRtWidth(w)} style={_lsBtn(rtWidth===w,'#22c55e')}>{w}</button>
                  ))}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>m/z range</div>
                <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                  <input type="number" value={mzLo} onChange={e=>setMzLo(+e.target.value)} style={{..._LS_INP,width:'70px'}}/>
                  <span style={{color:'var(--muted)'}}>–</span>
                  <input type="number" value={mzHi} onChange={e=>setMzHi(+e.target.value)} style={{..._LS_INP,width:'70px'}}/>
                </div>
              </div>
              <button onClick={renderSlice} disabled={!selA}
                style={{padding:'0.45rem 1.1rem',background:selA?'#166534':'transparent',
                  border:`1px solid ${selA?'#22c55e':'var(--border)'}`,color:selA?'#86efac':'var(--muted)',
                  borderRadius:'0.4rem',cursor:selA?'pointer':'not-allowed',fontWeight:700,alignSelf:'flex-end'}}>
                Load &amp; Slice
              </button>
            </div>
          </div>

          {/* Canvas pair + TIC */}
          <div style={{display:'grid',gridTemplateColumns:selB?'1fr 1fr':'1fr',gap:'0.5rem'}}>
            {['A','B'].filter(k=>k==='A'||selB).map(k=>(
              <div key={k} className="card" style={{padding:0,overflow:'hidden',background:'#060b14'}}>
                {/* Header */}
                <div style={{padding:'0.35rem 0.75rem',borderBottom:'1px solid #0f2040',display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(1,26,58,0.8)'}}>
                  <span style={{fontWeight:700,fontSize:'0.8rem',color:k==='A'?'#58a6ff':'#f78166',letterSpacing:'0.5px'}}>
                    RUN {k}
                  </span>
                  <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
                    <ChargeBar counts={chargeCounts[k]} col={k==='A'?'blue':'red'}/>
                    <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>{stats[k]}</span>
                  </div>
                </div>
                {/* Heatmap */}
                <div style={{position:'relative',padding:'0'}}>
                  <canvas ref={k==='A'?canvasARef:canvasBRef} width={640} height={300}
                    style={{width:'100%',display:'block'}}/>
                  {!gridsRef.current[k]&&(
                    <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                      color:'var(--muted)',fontSize:'0.82rem',gap:'0.4rem',background:'rgba(6,11,20,0.7)'}}>
                      <span style={{fontSize:'1.8rem',opacity:0.3}}>🔬</span>
                      {selA?'Click "Load & Slice" to render':'Select Run A first'}
                    </div>
                  )}
                </div>
                {/* TIC sparkline */}
                <div style={{borderTop:'1px solid #0f2040',background:'rgba(1,10,26,0.9)'}}>
                  <div style={{fontSize:'0.62rem',color:'#1e3a5f',textTransform:'uppercase',letterSpacing:'0.5px',padding:'3px 6px 0'}}>
                    Total Ion Current
                  </div>
                  <div ref={k==='A'?ticARef:ticBRef} style={{height:'55px'}}/>
                </div>
                {/* Corridor legend */}
                <div style={{padding:'0.3rem 0.75rem',borderTop:'1px solid #0f2040',display:'flex',gap:'0.9rem',flexWrap:'wrap',background:'rgba(1,10,26,0.7)'}}>
                  {[[1,'#2dd4bf'],[2,'#60a5fa'],[3,'#22c55e'],[4,'#f97316']].map(([z,c])=>(
                    <span key={z} style={{fontSize:'0.66rem',color:c,display:'flex',alignItems:'center',gap:'3px'}}>
                      <span style={{width:'14px',height:'1px',display:'inline-block',borderBottom:`1.5px dashed ${c}`}}/>
                      z=+{z}
                    </span>
                  ))}
                  <span style={{fontSize:'0.66rem',color:'#1e3a5f',marginLeft:'auto'}}>dashed lines = expected 1/K₀ corridors by charge state</span>
                </div>
              </div>
            ))}
          </div>
          {!selA&&(
            <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>
              <div style={{fontSize:'2rem',marginBottom:'0.5rem',opacity:0.3}}>🔬</div>
              Select Run A above and click "Load &amp; Slice"
            </div>
          )}
        </div>
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Peptide Focus — single m/z EIM + XIC + CCS prediction bands
    // ═══════════════════════════════════════════════════════════════════════
    function LandscapePeptideFocus({ selA, setSelA, selB, setSelB, ionsRef, loadIons, ionsLoading, runOpts }) {
      const [targetMz,  setTargetMz]  = useState('');
      const [tolPpm,    setTolPpm]    = useState(10);
      const [focusData, setFocusData] = useState({A:null, B:null});
      const [analysing, setAnalysing] = useState(false);
      const eimRef      = useRef(null);
      const xicRef      = useRef(null);
      const spotRef     = useRef(null);
      const trajCanvasRef = useRef(null);  // RT × 1/K₀ trajectory canvas

      useEffect(()=>()=>{
        [eimRef,xicRef,spotRef].forEach(r=>{if(r.current&&window.Plotly)window.Plotly.purge(r.current);});
      },[]);

      function computeFocus(ions, mz, ppm) {
        if(!ions?.mz) return null;
        const tolDa = mz * ppm / 1e6;
        const idx = ions.mz.reduce((a,v,i)=>{ if(Math.abs(v-mz)<=tolDa) a.push(i); return a; },[]);
        if(idx.length < 2) return null;

        // EIM
        const MB=120, mobMin=0.48, mobMax=1.82, mStep=(mobMax-mobMin)/MB;
        const eimBins=new Float64Array(MB);
        idx.forEach(i=>{ const b=Math.min(MB-1,Math.floor((ions.mobility[i]-mobMin)/mStep)); eimBins[b]+=ions.log_int[i]; });
        const eimX=Array.from({length:MB},(_,i)=>+(mobMin+(i+0.5)*mStep).toFixed(4));
        const eimMax=Math.max(...eimBins);
        const eimY=Array.from(eimBins).map(v=>eimMax>0?v/eimMax:0);
        const peakMobBin=eimY.indexOf(Math.max(...eimY));
        const peakMob=eimX[peakMobBin];

        // XIC
        const rtVals=idx.map(i=>ions.rt[i]/60);
        const rtMin=Math.min(...rtVals), rtMax=Math.max(...rtVals);
        const rtRange=Math.max(rtMax-rtMin,0.5);
        const XB=120; const xicBins=new Float64Array(XB);
        idx.forEach(i=>{ const b=Math.min(XB-1,Math.floor((ions.rt[i]/60-rtMin)/rtRange*XB)); xicBins[b]+=ions.log_int[i]; });
        const xicX=Array.from({length:XB},(_,i)=>+(rtMin+(i+0.5)*rtRange/XB).toFixed(3));
        const xicMax=Math.max(...xicBins);
        const xicY=Array.from(xicBins).map(v=>xicMax>0?v/xicMax:0);
        const peakRtBin=xicY.indexOf(Math.max(...xicY));
        const peakRt=xicX[peakRtBin];

        // Charge distribution
        const chargeMap={};
        idx.forEach(i=>{ const z=ions.charge[i]||0; chargeMap[z]=(chargeMap[z]||0)+1; });
        const dominantZ=+Object.entries(chargeMap).sort((a,b)=>b[1]-a[1])[0]?.[0]||2;

        // Scatter
        const scatMz=idx.map(i=>ions.mz[i]);
        const scatMob=idx.map(i=>ions.mobility[i]);
        const scatInt=idx.map(i=>ions.log_int[i]);
        const scatCharge=idx.map(i=>ions.charge[i]);
        const scatRt=idx.map(i=>ions.rt[i]/60);

        return { n:idx.length, eim:{x:eimX,y:eimY}, xic:{x:xicX,y:xicY},
                 peakMob, peakRt, dominantZ, chargeMap,
                 scatMz, scatMob, scatInt, scatCharge, scatRt };
      }

      // Draw RT × 1/K₀ trajectory canvas (coloured by intensity)
      function drawTrajectory(canvas, dA, dB, mz) {
        if(!canvas) return;
        const ctx=canvas.getContext('2d');
        const cw=canvas.width, ch=canvas.height;
        ctx.fillStyle='#060b14'; ctx.fillRect(0,0,cw,ch);

        const PAD=30;
        const allRt=[...(dA?.scatRt||[]),...(dB?.scatRt||[])];
        const allMob=[...(dA?.scatMob||[]),...(dB?.scatMob||[])];
        if(!allRt.length) return;
        const rtMin=Math.min(...allRt), rtMax=Math.max(...allRt);
        const mobMin=Math.min(...allMob)-0.05, mobMax=Math.max(...allMob)+0.05;
        const rtRange=Math.max(rtMax-rtMin,0.5), mobRange=mobMax-mobMin;

        const tx=rt=>PAD+(rt-rtMin)/rtRange*(cw-2*PAD);
        const ty=mob=>ch-PAD-(mob-mobMin)/mobRange*(ch-2*PAD);

        // Grid lines
        ctx.strokeStyle='rgba(20,40,70,0.6)'; ctx.lineWidth=0.5;
        for(let i=0;i<=4;i++){
          const y=PAD+i*(ch-2*PAD)/4;
          ctx.beginPath(); ctx.moveTo(PAD,y); ctx.lineTo(cw-PAD,y); ctx.stroke();
          const mob=(mobMax-i*(mobMax-mobMin)/4);
          ctx.fillStyle='#2a4060'; ctx.font='8px monospace'; ctx.textAlign='right';
          ctx.fillText(mob.toFixed(3),PAD-3,y+3);
        }
        for(let i=0;i<=5;i++){
          const x=PAD+i*(cw-2*PAD)/5;
          ctx.beginPath(); ctx.moveTo(x,PAD); ctx.lineTo(x,ch-PAD); ctx.stroke();
          const rt=rtMin+i*rtRange/5;
          ctx.fillStyle='#2a4060'; ctx.font='8px monospace'; ctx.textAlign='center';
          ctx.fillText(rt.toFixed(1),x,ch-PAD+10);
        }

        // Axis labels
        ctx.fillStyle='#3a6080'; ctx.font='9px -apple-system,sans-serif'; ctx.textAlign='center';
        ctx.fillText('Retention Time (min)', cw/2, ch-2);
        ctx.save(); ctx.translate(10,ch/2); ctx.rotate(-Math.PI/2);
        ctx.fillText('1/K₀ (Vs/cm²)',0,0); ctx.restore();

        // Expected CCS corridors for mz=targetMz
        if(mz>100){
          [[2,'rgba(96,165,250,0.2)'],[3,'rgba(34,197,94,0.2)'],[4,'rgba(249,115,22,0.2)']].forEach(([z,c])=>{
            const ek0=_lsCcsExpected(mz,z);
            if(ek0<mobMin||ek0>mobMax) return;
            const y0=ty(ek0);
            ctx.strokeStyle=c; ctx.lineWidth=1; ctx.setLineDash([3,3]);
            ctx.beginPath(); ctx.moveTo(PAD,y0); ctx.lineTo(cw-PAD,y0); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle=c; ctx.font='8px monospace'; ctx.textAlign='left';
            ctx.fillText(`z+${z} expected`,PAD+3,y0-3);
          });
        }

        // Scatter ions
        [{d:dA,col:'#58a6ff',k:'A'},{d:dB,col:'#f78166',k:'B'}].forEach(({d,col,k})=>{
          if(!d) return;
          const CHARGE_COL={1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',0:'#94a3b8'};
          for(let i=0;i<d.scatRt.length;i++){
            const x=tx(d.scatRt[i]), y=ty(d.scatMob[i]);
            const z=d.scatCharge[i];
            const c=CHARGE_COL[z]||col;
            ctx.beginPath();
            ctx.arc(x,y,2.5,0,2*Math.PI);
            ctx.fillStyle=`${c}bb`;
            ctx.fill();
          }
          // Peak marker
          const px=tx(d.peakRt), py=ty(d.peakMob);
          ctx.beginPath();
          ctx.arc(px,py,6,0,2*Math.PI);
          ctx.strokeStyle=col; ctx.lineWidth=2; ctx.stroke();
          ctx.beginPath();
          ctx.arc(px,py,2,0,2*Math.PI);
          ctx.fillStyle=col; ctx.fill();
          // Label
          ctx.fillStyle=col; ctx.font='bold 9px -apple-system,sans-serif'; ctx.textAlign='left';
          ctx.fillText(`Run ${k}`,px+8,py+3);
        });
      }

      async function doAnalyse() {
        const mz=parseFloat(targetMz);
        if(!mz||mz<100) return;
        setAnalysing(true);
        await Promise.all([loadIons('A',selA),loadIons('B',selB)]);
        const dA=computeFocus(ionsRef.current.A, mz, tolPpm);
        const dB=computeFocus(ionsRef.current.B, mz, tolPpm);
        setFocusData({A:dA,B:dB});
        setAnalysing(false);

        // Draw trajectory canvas
        setTimeout(()=>drawTrajectory(trajCanvasRef.current, dA, dB, mz), 50);

        // EIM with CCS prediction bands
        if(eimRef.current&&window.Plotly){
          const traces=[];
          // CCS prediction bands per charge state (vertical lines)
          [1,2,3,4].forEach(z=>{
            const ek0=_lsCcsExpected(mz,z);
            if(ek0<0.48||ek0>1.82) return;
            const CCOL={1:'rgba(45,212,191,0.2)',2:'rgba(96,165,250,0.2)',3:'rgba(34,197,94,0.2)',4:'rgba(249,115,22,0.2)'};
            // Shaded band ±0.015
            traces.push({type:'scatter',mode:'lines',name:`z+${z} expected`,
              x:[ek0-0.015,ek0-0.015,ek0+0.015,ek0+0.015,ek0-0.015],
              y:[0,1.05,1.05,0,0],
              fill:'toself',fillcolor:CCOL[z]||'rgba(150,150,150,0.1)',
              line:{width:0},hoverinfo:'skip',showlegend:false});
            // Center line
            const LCOL={1:'rgba(45,212,191,0.45)',2:'rgba(96,165,250,0.45)',3:'rgba(34,197,94,0.45)',4:'rgba(249,115,22,0.45)'};
            traces.push({type:'scatter',mode:'lines',
              x:[ek0,ek0],y:[0,1.05],
              line:{color:LCOL[z],width:1,dash:'dot'},
              hovertemplate:`z=+${z} expected CCS: 1/K₀ = ${ek0.toFixed(4)}<extra></extra>`,
              showlegend:false});
          });
          // Observed EIM A
          if(dA) traces.push({type:'scatter',mode:'lines',name:`Run A (n=${dA.n})`,x:dA.eim.x,y:dA.eim.y,
            fill:'tozeroy',fillcolor:'rgba(88,166,255,0.18)',line:{color:'#58a6ff',width:2.5},
            hovertemplate:'1/K₀: %{x:.4f}<br>Rel. intensity: %{y:.3f}<extra>Run A</extra>'});
          if(dB) traces.push({type:'scatter',mode:'lines',name:`Run B (n=${dB.n})`,x:dB.eim.x,y:dB.eim.y,
            fill:'tozeroy',fillcolor:'rgba(247,129,102,0.18)',line:{color:'#f78166',width:2.5},
            hovertemplate:'1/K₀: %{x:.4f}<br>Rel. intensity: %{y:.3f}<extra>Run B</extra>'});
          // Peak markers
          if(dA) traces.push({type:'scatter',mode:'markers',name:'A peak',x:[dA.peakMob],y:[1.04],
            marker:{symbol:'triangle-down',size:11,color:'#58a6ff',line:{width:1.5,color:'#fff'}},showlegend:false,
            hovertemplate:`Run A peak 1/K₀ = ${dA.peakMob.toFixed(4)}<extra></extra>`});
          if(dB) traces.push({type:'scatter',mode:'markers',name:'B peak',x:[dB.peakMob],y:[1.04],
            marker:{symbol:'triangle-down',size:11,color:'#f78166',line:{width:1.5,color:'#fff'}},showlegend:false,
            hovertemplate:`Run B peak 1/K₀ = ${dB.peakMob.toFixed(4)}<extra></extra>`});
          window.Plotly.react(eimRef.current, traces, {
            paper_bgcolor:'transparent',plot_bgcolor:'rgba(1,10,26,0.7)',
            font:{color:'#a0b4cc',size:11},margin:{l:52,r:12,t:10,b:48},
            xaxis:{title:'1/K₀ (Vs/cm²)',gridcolor:'rgba(20,40,80,0.8)',color:'#a0b4cc'},
            yaxis:{title:'Normalised intensity',range:[0,1.12],gridcolor:'rgba(20,40,80,0.8)',color:'#a0b4cc'},
            legend:{orientation:'h',y:-0.35,font:{size:10}},hovermode:'x unified',
            annotations: [1,2,3,4].map(z=>{
              const ek0=_lsCcsExpected(mz,z);
              if(ek0<0.48||ek0>1.82) return null;
              const ACOL={1:'rgba(45,212,191,0.7)',2:'rgba(96,165,250,0.7)',3:'rgba(34,197,94,0.7)',4:'rgba(249,115,22,0.7)'};
              return {x:ek0,y:1.08,text:`z+${z}`,showarrow:false,font:{size:8,color:ACOL[z]},xanchor:'center'};
            }).filter(Boolean),
          },{responsive:true,displayModeBar:false});
        }

        // XIC
        if(xicRef.current&&window.Plotly){
          const traces=[];
          if(dA) traces.push({type:'scatter',mode:'lines',name:'Run A',x:dA.xic.x,y:dA.xic.y,
            fill:'tozeroy',fillcolor:'rgba(88,166,255,0.18)',line:{color:'#58a6ff',width:2.5},
            hovertemplate:'RT: %{x:.2f} min<br>Rel. int: %{y:.3f}<extra>Run A</extra>'});
          if(dB) traces.push({type:'scatter',mode:'lines',name:'Run B',x:dB.xic.x,y:dB.xic.y,
            fill:'tozeroy',fillcolor:'rgba(247,129,102,0.18)',line:{color:'#f78166',width:2.5},
            hovertemplate:'RT: %{x:.2f} min<br>Rel. int: %{y:.3f}<extra>Run B</extra>'});
          if(dA) traces.push({type:'scatter',mode:'markers',name:'A RT',x:[dA.peakRt],y:[1.04],
            marker:{symbol:'triangle-down',size:11,color:'#58a6ff',line:{width:1.5,color:'#fff'}},showlegend:false,
            hovertemplate:`Run A peak RT = ${dA.peakRt.toFixed(2)} min<extra></extra>`});
          if(dB) traces.push({type:'scatter',mode:'markers',name:'B RT',x:[dB.peakRt],y:[1.04],
            marker:{symbol:'triangle-down',size:11,color:'#f78166',line:{width:1.5,color:'#fff'}},showlegend:false,
            hovertemplate:`Run B peak RT = ${dB.peakRt.toFixed(2)} min<extra></extra>`});
          window.Plotly.react(xicRef.current, traces, {
            paper_bgcolor:'transparent',plot_bgcolor:'rgba(1,10,26,0.7)',
            font:{color:'#a0b4cc',size:11},margin:{l:52,r:12,t:10,b:48},
            xaxis:{title:'Retention time (min)',gridcolor:'rgba(20,40,80,0.8)',color:'#a0b4cc'},
            yaxis:{title:'Normalised intensity',range:[0,1.12],gridcolor:'rgba(20,40,80,0.8)',color:'#a0b4cc'},
            legend:{orientation:'h',y:-0.35,font:{size:10}},hovermode:'x unified',
          },{responsive:true,displayModeBar:false});
        }

        // Spot scatter (m/z × 1/K₀)
        if(spotRef.current&&window.Plotly){
          const CMAP={1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',0:'#94a3b8'};
          const traces=[];
          [[dA,'A'],[dB,'B']].forEach(([d,k])=>{
            if(!d)return;
            traces.push({type:'scatter',mode:'markers',name:`Run ${k}`,
              x:d.scatMz, y:d.scatMob,
              marker:{size:d.scatInt.map(v=>3+v*0.25),
                color:d.scatCharge.map(z=>CMAP[z]||'#94a3b8'),
                opacity:0.8,line:{width:0}},
              text:d.scatMz.map((m,i)=>`Run ${k}<br>m/z ${m.toFixed(4)}<br>1/K₀ ${d.scatMob[i].toFixed(4)}<br>z=${d.scatCharge[i]}`),
              hovertemplate:'%{text}<extra></extra>',
            });
          });
          // Expected CCS lines
          [1,2,3,4].forEach(z=>{
            const ek0=_lsCcsExpected(parseFloat(targetMz)||0,z);
            if(ek0<0.48||ek0>1.82) return;
            const CCOL={1:'rgba(45,212,191,0.3)',2:'rgba(96,165,250,0.3)',3:'rgba(34,197,94,0.3)',4:'rgba(249,115,22,0.3)'};
            const xRange=[Math.min(...([...((dA?.scatMz)||[]),...((dB?.scatMz)||[])]))-1, Math.max(...([...((dA?.scatMz)||[]),...((dB?.scatMz)||[])]))+1];
            if(!isFinite(xRange[0])) return;
            traces.push({type:'scatter',mode:'lines',name:`z+${z} expected`,
              x:xRange,y:[ek0,ek0],line:{color:CCOL[z],width:1,dash:'dot'},
              hovertemplate:`z=+${z} expected 1/K₀ = ${ek0.toFixed(4)}<extra></extra>`,showlegend:false});
          });
          window.Plotly.react(spotRef.current, traces, {
            paper_bgcolor:'transparent',plot_bgcolor:'rgba(1,10,26,0.7)',
            font:{color:'#a0b4cc',size:11},margin:{l:52,r:12,t:10,b:48},
            xaxis:{title:'m/z',gridcolor:'rgba(20,40,80,0.8)',color:'#a0b4cc'},
            yaxis:{title:'1/K₀ (Vs/cm²)',gridcolor:'rgba(20,40,80,0.8)',color:'#a0b4cc'},
            legend:{orientation:'h',y:-0.35,font:{size:10}},hovermode:'closest',
          },{responsive:true,displayModeBar:false});
        }
      }

      const mobDelta = focusData.A&&focusData.B ? Math.abs(focusData.A.peakMob-focusData.B.peakMob) : null;
      const rtDelta  = focusData.A&&focusData.B ? Math.abs(focusData.A.peakRt -focusData.B.peakRt) : null;

      // SVG delta gauge
      const DeltaGauge = ({val, maxVal, col, label}) => {
        const pct=Math.min(1,val/maxVal);
        const barW=pct*80;
        return (
          <svg width="110" height="22">
            <rect x="0" y="4" width="80" height="14" rx="2" fill="rgba(20,40,80,0.6)"/>
            <rect x="0" y="4" width={barW} height="14" rx="2" fill={col} opacity="0.8"/>
            <text x="84" y="15" fontSize="9" fill={col} fontWeight="700">{val.toFixed(4)}</text>
            <text x="0" y="22" fontSize="7.5" fill="#3a5060">{label}</text>
          </svg>
        );
      };

      return (
        <div>
          <div style={{fontSize:'0.78rem',color:'var(--muted)',marginBottom:'0.75rem',lineHeight:1.7}}>
            Enter a <strong>precursor m/z</strong> to extract its full 4D profile from both runs.
            The <strong>EIM</strong> shows the ion's mobility peak (1/K₀ vs intensity) — overlaid with
            <span style={{color:'#60a5fa'}}> predicted CCS corridors</span> for each charge state.
            The <strong>XIC</strong> shows its chromatographic peak. The <strong>trajectory canvas</strong> shows
            where every matched ion sits in RT × 1/K₀ space.
          </div>
          <LandscapeRunSelectors selA={selA} setSelA={setSelA} selB={selB} setSelB={setSelB}
            ionsRef={ionsRef} ionsLoading={ionsLoading} runOpts={runOpts} />

          {/* Input */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.7rem 1rem'}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:'0.75rem',alignItems:'flex-end'}}>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>Precursor m/z</div>
                <input type="number" step="0.001" value={targetMz} onChange={e=>setTargetMz(e.target.value)}
                  placeholder="e.g. 748.9120" style={{..._LS_INP,width:'130px'}}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>Tolerance (ppm)</div>
                <div style={{display:'flex',gap:'4px'}}>
                  {[5,10,20,50].map(p=>(
                    <button key={p} onClick={()=>setTolPpm(p)} style={_lsBtn(tolPpm===p,'#DAAA00')}>{p}</button>
                  ))}
                </div>
              </div>
              <button onClick={doAnalyse} disabled={!selA||!targetMz||analysing}
                style={{padding:'0.45rem 1.2rem',
                  background:selA&&targetMz?'linear-gradient(135deg,#92400e,#b45309)':'transparent',
                  border:`1px solid ${selA&&targetMz?'#DAAA00':'var(--border)'}`,
                  color:selA&&targetMz?'#fef3c7':'var(--muted)',borderRadius:'0.4rem',
                  cursor:selA&&targetMz?'pointer':'not-allowed',fontWeight:700,alignSelf:'flex-end',
                  boxShadow:selA&&targetMz?'0 0 12px rgba(218,170,0,0.2)':'none'}}>
                {analysing ? '⟳ Analysing…' : '🎯 Analyse'}
              </button>
              <div style={{fontSize:'0.7rem',color:'var(--muted)',alignSelf:'flex-end',marginBottom:'3px',maxWidth:'220px',lineHeight:1.5}}>
                Tip: copy m/z from the Searches or Immunopeptidomics tab
              </div>
            </div>
          </div>

          {/* Summary + delta */}
          {(focusData.A||focusData.B) && (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'0.5rem',marginBottom:'0.75rem'}}>
              {['A','B'].map(k=>{
                const d=focusData[k];
                const col=k==='A'?'#58a6ff':'#f78166';
                const borderCol=k==='A'?'rgba(88,166,255,0.3)':'rgba(247,129,102,0.3)';
                return (
                  <div key={k} className="card" style={{border:`1px solid ${borderCol}`,background:`rgba(${k==='A'?'88,166,255':'247,129,102'},0.04)`}}>
                    <div style={{fontSize:'0.7rem',fontWeight:700,color:col,marginBottom:'0.3rem',textTransform:'uppercase',letterSpacing:'0.5px'}}>Run {k}</div>
                    {d ? (
                      <>
                        <div style={{fontSize:'0.88rem',fontWeight:700,color:'var(--text)'}}>{d.n.toLocaleString()} ions</div>
                        <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.25rem'}}>
                          Peak 1/K₀ <strong style={{color:col}}>{d.peakMob.toFixed(4)}</strong>
                        </div>
                        <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>
                          Peak RT <strong style={{color:col}}>{d.peakRt.toFixed(2)} min</strong>
                        </div>
                        <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>
                          Dominant z <strong style={{color:col}}>+{d.dominantZ}</strong>
                        </div>
                      </>
                    ) : (
                      <div style={{fontSize:'0.75rem',color:'#ef4444',marginTop:'0.2rem'}}>
                        {selB||k==='A'?'Not detected':'No Run B'}
                      </div>
                    )}
                  </div>
                );
              })}
              {mobDelta !== null && (
                <div className="card" style={{
                  border:`2px solid ${mobDelta<0.01?'rgba(34,197,94,0.5)':mobDelta<0.03?'rgba(234,179,8,0.5)':'rgba(239,68,68,0.5)'}`,
                  background:`rgba(${mobDelta<0.01?'34,197,94':mobDelta<0.03?'234,179,8':'239,68,68'},0.04)`,
                  gridColumn:'span 2',
                }}>
                  <div style={{fontSize:'0.7rem',fontWeight:700,color:'var(--muted)',marginBottom:'0.4rem',textTransform:'uppercase',letterSpacing:'0.5px'}}>
                    Run A vs B — Δ values
                  </div>
                  <div style={{display:'flex',gap:'1.5rem',flexWrap:'wrap',alignItems:'center'}}>
                    <div>
                      <div style={{fontSize:'0.65rem',color:'var(--muted)',marginBottom:'2px'}}>Δ 1/K₀</div>
                      <DeltaGauge val={mobDelta} maxVal={0.05} col={mobDelta<0.01?'#22c55e':mobDelta<0.03?'#eab308':'#ef4444'} label="Vs/cm²"/>
                    </div>
                    {rtDelta!==null&&(
                      <div>
                        <div style={{fontSize:'0.65rem',color:'var(--muted)',marginBottom:'2px'}}>Δ RT</div>
                        <DeltaGauge val={rtDelta} maxVal={2} col={rtDelta<0.3?'#22c55e':rtDelta<0.8?'#eab308':'#ef4444'} label="minutes"/>
                      </div>
                    )}
                    <div style={{fontSize:'0.72rem',color:`${mobDelta<0.01?'#22c55e':mobDelta<0.03?'#eab308':'#ef4444'}bb`,maxWidth:'200px',lineHeight:1.6}}>
                      {mobDelta<0.01?'✓ Identical conformation — same CCS, highly reproducible':
                       mobDelta<0.03?'⚠ Small shift — verify charge state or check for adduct':
                       '✗ Large shift — different species, co-isolation, or isomers'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Charts row 1: EIM + XIC */}
          {(focusData.A||focusData.B) && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem',marginBottom:'0.5rem'}}>
              <div className="card" style={{padding:'0.6rem',background:'rgba(1,10,26,0.6)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'0.15rem'}}>
                  <h3 style={{margin:0,fontSize:'0.88rem',color:'#60a5fa'}}>EIM — Extracted Ion Mobilogram</h3>
                  <span style={{fontSize:'0.62rem',color:'var(--muted)'}}>shaded bands = expected CCS per z</span>
                </div>
                <div style={{fontSize:'0.68rem',color:'#3a5060',marginBottom:'0.4rem'}}>
                  Ion shape in the mobility dimension — the 4th coordinate measured by IMS platforms (TIMS, DTIMS, TWIMS)
                </div>
                <div ref={eimRef} style={{height:'230px'}}/>
              </div>
              <div className="card" style={{padding:'0.6rem',background:'rgba(1,10,26,0.6)'}}>
                <h3 style={{margin:'0 0 0.15rem',fontSize:'0.88rem',color:'#22c55e'}}>XIC — Extracted Ion Chromatogram</h3>
                <div style={{fontSize:'0.68rem',color:'#3a5060',marginBottom:'0.4rem'}}>
                  Chromatographic elution profile — peptide concentration vs time on column
                </div>
                <div ref={xicRef} style={{height:'230px'}}/>
              </div>
            </div>
          )}

          {/* Charts row 2: spot + trajectory */}
          {(focusData.A||focusData.B) && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem',marginBottom:'0.5rem'}}>
              <div className="card" style={{padding:'0.6rem',background:'rgba(1,10,26,0.6)'}}>
                <h3 style={{margin:'0 0 0.15rem',fontSize:'0.88rem',color:'#a78bfa'}}>m/z × 1/K₀ Spot Map</h3>
                <div style={{fontSize:'0.68rem',color:'#3a5060',marginBottom:'0.4rem'}}>
                  Each dot = one matched ion · colored by charge · size = log intensity · dotted lines = expected CCS
                </div>
                <div ref={spotRef} style={{height:'230px'}}/>
              </div>
              <div className="card" style={{padding:'0.6rem',background:'rgba(1,10,26,0.6)'}}>
                <h3 style={{margin:'0 0 0.15rem',fontSize:'0.88rem',color:'#f97316'}}>RT × 1/K₀ Trajectory</h3>
                <div style={{fontSize:'0.68rem',color:'#3a5060',marginBottom:'0.4rem'}}>
                  Every matched ion plotted in time-mobility space · circle = peak apex · horizontal lines = expected z corridors
                </div>
                <div style={{background:'#060b14',borderRadius:'0.3rem',overflow:'hidden'}}>
                  <canvas ref={trajCanvasRef} width={560} height={230}
                    style={{width:'100%',display:'block'}}/>
                </div>
              </div>
            </div>
          )}

          {!focusData.A&&!focusData.B&&!analysing&&(
            <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)',background:'rgba(1,10,26,0.4)'}}>
              <div style={{fontSize:'2.5rem',marginBottom:'0.5rem',opacity:0.25}}>🎯</div>
              <div style={{fontWeight:700,marginBottom:'0.4rem',color:'var(--text)',fontSize:'0.95rem'}}>Enter an m/z and click Analyse</div>
              <div style={{fontSize:'0.8rem',maxWidth:'420px',margin:'0 auto',lineHeight:1.7,color:'#3a5070'}}>
                You'll see the full 4D fingerprint for that peptide: EIM with CCS prediction bands,
                XIC, m/z × 1/K₀ spot map, and an RT × mobility trajectory — overlaid for two runs
                so you can see reproducibility at a glance.
              </div>
            </div>
          )}
        </div>
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LandscapeViewerTab — orchestrator only
    // ═══════════════════════════════════════════════════════════════════════
    function LandscapeViewerTab() {
      const { data: allRuns } = useFetch('/api/runs?limit=300');
      const [mode, setMode] = useState('guide');
      const [selA, setSelA] = useState('');
      const [selB, setSelB] = useState('');
      const ionsRef = useRef({A: null, B: null});
      const [ionsLoading, setIonsLoading] = useState({A:false, B:false});

      const runs = Array.isArray(allRuns) ? allRuns : [];
      const runOpts = runs.map(r =>
        <option key={r.id} value={r.id}>{r.run_name || r.id} — {r.instrument || ''}</option>
      );

      async function loadIons(key, runId) {
        if (!runId) { ionsRef.current[key] = null; return; }
        if (ionsRef.current[key]?._runId === runId) return;
        setIonsLoading(l => ({...l, [key]: true}));
        try {
          const r = await fetch(`/api/runs/${runId}/mobility-3d?max_features=8000`);
          const d = await r.json();
          d._runId = runId;
          ionsRef.current[key] = d;
        } catch(e) {
          ionsRef.current[key] = null;
        }
        setIonsLoading(l => ({...l, [key]: false}));
      }

      const shared = { selA, setSelA, selB, setSelB, ionsRef, loadIons, ionsLoading, runOpts };

      return (
        <div style={{padding:'0.5rem'}}>
          {/* Mode selector */}
          <div style={{display:'flex',gap:'0.4rem',marginBottom:'0.75rem',flexWrap:'wrap'}}>
            {[
              ['guide',   '◎  Guide',            '#94a3b8'],
              ['global',  '⛰  Global Landscape', '#60a5fa'],
              ['slice',   '🔬  RT Slice',         '#22c55e'],
              ['peptide', '🎯  Peptide Focus',    '#DAAA00'],
            ].map(([m,lbl,col])=>(
              <button key={m} onClick={()=>setMode(m)} style={{
                ..._lsBtn(mode===m,col),
                padding:'0.4rem 1rem',fontSize:'0.83rem',
              }}>{lbl}</button>
            ))}
          </div>

          {mode==='guide'   && <LandscapeGuidePanel setMode={setMode} />}
          {mode==='global'  && <LandscapeGlobal    {...shared} />}
          {mode==='slice'   && <LandscapeRtSlice   {...shared} />}
          {mode==='peptide' && <LandscapePeptideFocus {...shared} />}
        </div>
      );
    }
