    /* ── Sneaky Peaky Tab ─────────────────────────────────────────────── */

    /* ── Ziggy Ion Portrait Hero ──────────────────────────────────────── */
    function ZiggyIonHero({ allRuns }) {
      const cvRef      = useRef(null);
      const rafRef     = useRef(null);
      const partsRef   = useRef(null);
      const modeRef    = useRef('portrait');
      const transRef   = useRef(0);
      const [mode,     setMode]     = useState('portrait');
      const [selRun,   setSelRun]   = useState('');
      const [heroIons, setHeroIons] = useState(null);
      const [loading,  setLoading]  = useState(false);
      const runs = Array.isArray(allRuns) ? allRuns : [];

      const loadRun = async (id) => {
        if (!id) { setHeroIons(null); return; }
        setLoading(true);
        try {
          const r = await fetch(`/api/runs/${id}/mobility-3d?max_features=6000`);
          const d = await r.json();
          d._runId = id;
          setHeroIons(d);
          // auto-switch to scatter when data loads
          modeRef.current = 'scatter';
          setMode('scatter');
        } catch(e) { setHeroIons(null); }
        finally { setLoading(false); }
      };

      useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.offsetWidth || 900, H = 400;
        cv.width = W; cv.height = H;

        // Seeded RNG (xorshift32)
        let s = 0xCAFEBABE;
        const rng = () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 4294967295; };

        // Face geometry
        const cx = W * 0.5, cy = H * 0.52;
        const fw = Math.min(W * 0.13, 110);
        const fh = Math.min(H * 0.42, 155);

        // Bolt (same proportions as welcome drawBolt)
        const bs = fh * 0.90;
        const bpoly = [
          [cx + bs*-.18, cy + bs*-.50], [cx + bs* .14, cy + bs*-.50],
          [cx + bs* .05, cy + bs*-.02], [cx + bs* .22, cy + bs*  .00],
          [cx + bs*-.05, cy + bs*  .50], [cx + bs*-.22, cy + bs*  .50],
          [cx + bs*-.10, cy + bs*  .04], [cx + bs*-.28, cy + bs*  .00],
        ];
        const pip = (px, py, poly) => {
          let inside = false;
          for (let i=0, j=poly.length-1; i<poly.length; j=i++) {
            const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
            if ((yi>py)!==(yj>py) && px<(xj-xi)*(py-yi)/(yj-yi)+xi) inside=!inside;
          }
          return inside;
        };
        const boltSplitX = (py) => {
          const fy = (py-cy)/bs;
          if (fy < -0.02) { const tt=(fy+0.5)/0.48; return cx+bs*(-0.18+tt*0.23); }
          return cx + bs * (-0.10 + Math.max(0,(fy-0.04)/0.46)*0.05);
        };
        const inHair = (px, py) => {
          const dx=(px-cx)/(fw*1.3), dy=(py-(cy-fh*1.0))/(fh*0.5);
          return dx*dx+dy*dy < 1.0;
        };
        const eyes = [
          { cx:cx-fw*.37, cy:cy-fh*.23, r:fw*.13 },
          { cx:cx+fw*.38, cy:cy-fh*.21, r:fw*.12 },
        ];
        const lip = { cx, cy:cy+fh*.63, rx:fw*.30, ry:fh*.075 };

        const mk = (px,py,col,size,alpha,region,ex={}) => ({
          px,py,sx:0,sy:0,col,size,alpha,
          phase:rng()*Math.PI*2, speed:.7+rng()*1.5, wSpeed:.25+rng()*.65,
          w:rng()*2-1, region, vx:0,vy:0, ...ex,
        });

        const parts = [];

        // Face fill
        for (let att=0,cnt=0; cnt<2400 && att<300000; att++) {
          const px=cx+(rng()*2-1)*fw, py=cy+(rng()*2-1)*fh;
          if ((px-cx)**2/fw**2+(py-cy)**2/fh**2>=1) continue;
          if (eyes.some(e=>Math.hypot(px-e.cx,py-e.cy)<e.r)) continue;
          const inB=pip(px,py,bpoly);
          const col=inB?'#DAAA00':(px<boltSplitX(py)?'#22d3ee':'#f97316');
          parts.push(mk(px,py,col,inB?.6+rng()*.9:.3+rng()*.65,inB?.45+rng()*.45:.12+rng()*.28,inB?'bolt':'face'));
          cnt++;
        }
        // Hair
        for (let att=0,cnt=0; cnt<650 && att<150000; att++) {
          const px=cx+(rng()*2-1)*fw*1.6, py=cy-fh*.55-rng()*fh*1.1;
          if (!inHair(px,py)) continue;
          const c=['#a855f7','#7c3aed','#c084fc','#8b5cf6'][Math.floor(rng()*4)];
          parts.push(mk(px,py,c,.25+rng()*.55,.08+rng()*.22,'hair')); cnt++;
        }
        // Eyes
        eyes.forEach((eye,ei) => {
          for (let i=0;i<220;i++) {
            const a=rng()*Math.PI*2, r=Math.sqrt(rng())*eye.r;
            const px=eye.cx+Math.cos(a)*r, py=eye.cy+Math.sin(a)*r*.55;
            const core=r<eye.r*.38;
            parts.push(mk(px,py,core?'#ffffff':(ei===0?'#22d3ee':'#f97316'),
              core?.7+rng()*.8:.3+rng()*.5, core?.65+rng()*.3:.25+rng()*.35,'eye',
              {speed:1.2+rng()*2,wSpeed:.5+rng()}));
          }
        });
        // Lips
        for (let i=0;i<260;i++) {
          const a=rng()*Math.PI*2, r=Math.sqrt(rng());
          parts.push(mk(lip.cx+Math.cos(a)*lip.rx*r, lip.cy+Math.sin(a)*lip.ry*r,
            rng()<.55?'#f472b6':'#ec4899',.4+rng()*.65,.25+rng()*.4,'lip'));
        }
        // Stars
        const sc=['#DAAA00','#d946ef','#22d3ee','#a855f7','#f97316','#22c55e','#60a5fa'];
        for (let i=0;i<500;i++) {
          parts.push(mk(rng()*W,rng()*H,sc[Math.floor(rng()*sc.length)],
            .15+rng()*.9,.04+rng()*.18,'star',{vx:(rng()-.5)*.18,vy:-.04-rng()*.14}));
        }
        partsRef.current = parts;

        // 4D Tesseract
        const V4=[];
        for(let a=-1;a<=1;a+=2)for(let b=-1;b<=1;b+=2)for(let c=-1;c<=1;c+=2)for(let d=-1;d<=1;d+=2)V4.push([a,b,c,d]);
        const EG=[];
        for(let i=0;i<16;i++)for(let j=i+1;j<16;j++){let d=0;for(let k=0;k<4;k++)if(V4[i][k]!==V4[j][k])d++;if(d===1)EG.push([i,j]);}
        const p4=(v,rXY,rZW,rXZ)=>{
          let x=v[0]*Math.cos(rXY)-v[1]*Math.sin(rXY),y=v[0]*Math.sin(rXY)+v[1]*Math.cos(rXY);
          let z=v[2]*Math.cos(rZW)-v[3]*Math.sin(rZW),w=v[2]*Math.sin(rZW)+v[3]*Math.cos(rZW);
          let x2=x*Math.cos(rXZ)-z*Math.sin(rXZ),z2=x*Math.sin(rXZ)+z*Math.cos(rXZ);x=x2;z=z2;
          const w4=3/(3-w),px3=x*w4,py3=y*w4,pz3=z*w4,z3=4/(4-pz3);
          return[cx+px3*z3*32,cy+py3*z3*32,w];
        };

        let scanX=-80,scanOn=false,scanT=0,t=0;
        const frame = () => {
          ctx.clearRect(0,0,W,H); t+=.011;
          const target=modeRef.current==='scatter'?1:0;
          transRef.current+=(target-transRef.current)*.030;
          const tr=transRef.current;

          // Background
          const gbg=ctx.createLinearGradient(0,0,W,H);
          gbg.addColorStop(0,'#060010');gbg.addColorStop(.5,'#04000c');gbg.addColorStop(1,'#07001c');
          ctx.fillStyle=gbg;ctx.fillRect(0,0,W,H);

          // Nebula halos
          [{x:W*.14,y:H*.5,r:190,c:'#a855f7',a:.065+Math.sin(t*.6)*.02},
           {x:W*.82,y:H*.4,r:155,c:'#22d3ee',a:.055+Math.sin(t*.8+1)*.018},
           {x:W*.5, y:H*.5,r:210,c:'#DAAA00',a:.038+Math.sin(t*.5+2)*.012},
           {x:W*.65,y:H*.75,r:125,c:'#d946ef',a:.038+Math.sin(t*1.1+3)*.014},
          ].forEach(g=>{
            const gr=ctx.createRadialGradient(g.x,g.y,0,g.x,g.y,g.r);
            gr.addColorStop(0,g.c+'BB');gr.addColorStop(1,g.c+'00');
            ctx.save();ctx.globalAlpha=g.a;ctx.fillStyle=gr;
            ctx.beginPath();ctx.arc(g.x,g.y,g.r,0,Math.PI*2);ctx.fill();ctx.restore();
          });

          // Tesseract
          const pts4=V4.map(v=>p4(v,t*.18,t*.13,t*.09));
          ctx.save();ctx.globalAlpha=.055;
          EG.forEach(([i,j])=>{
            const p1=pts4[i],p2=pts4[j],wA=(p1[2]+p2[2])/2,h=(wA+1)/2;
            const R=Math.round(34+h*183),G2=Math.round(211-h*141),B=Math.round(238+h);
            ctx.strokeStyle=`rgb(${R},${G2},${B})`;ctx.lineWidth=.6;
            ctx.beginPath();ctx.moveTo(p1[0],p1[1]);ctx.lineTo(p2[0],p2[1]);ctx.stroke();
          });ctx.restore();

          // Particles
          const ps=partsRef.current;
          if(ps) ps.forEach(p=>{
            if(p.region==='star'){
              p.px+=p.vx;p.py+=p.vy;
              if(p.py<-5){p.py=H+5;p.px=Math.random()*W;}
              if(p.px<-5)p.px=W+5;else if(p.px>W+5)p.px=-5;
            }
            const tx=p.px+(p.sx-p.px)*tr, ty=p.py+(p.sy-p.py)*tr;
            const drift=(1-tr)*1.5;
            const ox=Math.sin(t*.5+p.phase)*drift, oy=Math.cos(t*.38+p.phase*1.1)*drift*.7;
            const pulse=.87+.13*Math.sin(t*p.speed+p.phase);
            const wp=.78+.22*Math.sin(t*p.wSpeed+p.phase*1.7);
            ctx.save();ctx.globalAlpha=p.alpha*pulse*wp;
            if(p.region==='bolt'||p.region==='eye'){ctx.shadowColor=p.col;ctx.shadowBlur=p.region==='bolt'?7:4;}
            ctx.fillStyle=p.col;
            ctx.beginPath();ctx.arc(tx+ox,ty+oy,p.size*pulse*wp,0,Math.PI*2);ctx.fill();
            ctx.restore();
          });

          // Bolt glow overlay
          const ba=(1-tr)*(.28+.09*Math.sin(t*2.1));
          if(ba>.01){
            ctx.save();ctx.globalAlpha=ba;ctx.shadowColor='#DAAA00';ctx.shadowBlur=28+Math.sin(t*1.8)*9;
            ctx.fillStyle='#DAAA00';ctx.beginPath();
            ctx.moveTo(cx+bs*-.18,cy+bs*-.50);ctx.lineTo(cx+bs* .14,cy+bs*-.50);
            ctx.lineTo(cx+bs* .05,cy+bs*-.02);ctx.lineTo(cx+bs* .22,cy+bs*  .00);
            ctx.lineTo(cx+bs*-.05,cy+bs*  .50);ctx.lineTo(cx+bs*-.22,cy+bs*  .50);
            ctx.lineTo(cx+bs*-.10,cy+bs*  .04);ctx.lineTo(cx+bs*-.28,cy+bs*  .00);
            ctx.closePath();ctx.fill();
            ctx.globalAlpha=ba*.28;ctx.fillStyle='#ffffff';ctx.shadowBlur=10;
            ctx.beginPath();
            ctx.moveTo(cx+bs*-.08,cy+bs*-.38);ctx.lineTo(cx+bs* .06,cy+bs*-.38);
            ctx.lineTo(cx+bs* .01,cy+bs*  .02);ctx.lineTo(cx+bs*-.01,cy+bs*  .02);
            ctx.closePath();ctx.fill();ctx.restore();
          }

          // Scatter axes
          if(tr>.05){
            const axPad=52;
            ctx.save();ctx.globalAlpha=Math.min(1,tr*1.5);
            ctx.strokeStyle='rgba(56,100,140,0.5)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
            ctx.beginPath();ctx.moveTo(axPad,H-axPad);ctx.lineTo(W-20,H-axPad);ctx.stroke();
            ctx.beginPath();ctx.moveTo(axPad,H-axPad);ctx.lineTo(axPad,20);ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle='#475569';ctx.font='10px monospace';ctx.textAlign='left';
            ctx.fillText('m/z →',W-56,H-axPad+16);
            ctx.save();ctx.translate(axPad-16,H*.45);ctx.rotate(-Math.PI/2);ctx.fillText('1/K₀ ↑',0,0);ctx.restore();
            ctx.font='8px monospace';
            for(let mz=500;mz<=1300;mz+=200){
              const x=axPad+(mz-400)/1000*(W-axPad-20);
              ctx.textAlign='center';ctx.fillStyle='rgba(71,85,105,0.7)';
              ctx.fillText(mz,x,H-axPad+14);
              ctx.strokeStyle='rgba(56,100,140,0.4)';ctx.lineWidth=.7;
              ctx.beginPath();ctx.moveTo(x,H-axPad);ctx.lineTo(x,H-axPad+4);ctx.stroke();
            }
            for(let k0=0.7;k0<=1.4;k0+=0.15){
              const y=H-axPad-(k0-.6)/(.85)*(H-axPad-20);
              ctx.textAlign='right';ctx.fillStyle='rgba(71,85,105,0.7)';
              ctx.fillText(k0.toFixed(2),axPad-6,y+3);
              ctx.strokeStyle='rgba(56,100,140,0.4)';ctx.lineWidth=.7;
              ctx.beginPath();ctx.moveTo(axPad-3,y);ctx.lineTo(axPad,y);ctx.stroke();
            }
            ctx.textAlign='left';ctx.restore();
          }

          // PASEF scan (portrait only)
          if(tr<.8){
            scanT++;
            if(scanT>185){scanOn=true;scanX=-80;scanT=0;}
            if(scanOn){
              scanX+=3.5;
              const sa=.28*(1-tr)*Math.max(0,1-scanX/(W+80));
              if(sa>.01){
                ctx.save();
                const sg=ctx.createLinearGradient(scanX-70,0,scanX+15,0);
                sg.addColorStop(0,'#22d3ee00');
                sg.addColorStop(.6,'#22d3ee'+Math.floor(sa*255).toString(16).padStart(2,'0'));
                sg.addColorStop(1,'#22d3ee00');
                ctx.fillStyle=sg;ctx.fillRect(scanX-70,0,85,H);ctx.restore();
              }
              if(scanX>W+80)scanOn=false;
            }
          }

          // Corner labels
          ctx.save();ctx.globalAlpha=.45;
          ctx.fillStyle='#DAAA00';ctx.font='bold 9px monospace';
          ctx.fillText('⚡ ION PORTRAIT · ALADDIN SANE',12,18);
          ctx.fillStyle='#334155';ctx.font='9px monospace';
          ctx.fillText('m/z × 1/K₀ × Intensity',W-144,18);
          ctx.fillStyle='rgba(71,85,105,0.5)';ctx.font='8px monospace';
          ctx.fillText('[click: portrait ↔ scatter]',12,H-8);
          ctx.restore();

          rafRef.current=requestAnimationFrame(frame);
        };
        rafRef.current=requestAnimationFrame(frame);
        return ()=>cancelAnimationFrame(rafRef.current);
      }, []);

      // Assign scatter targets when heroIons changes
      const CHARGE_COL = {1:'#DAAA00',2:'#22d3ee',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
      useEffect(()=>{
        const parts=partsRef.current; if(!parts) return;
        const cv=cvRef.current; if(!cv) return;
        const W=cv.width||900, H=cv.height||400, axPad=52;
        const xS=mz=>axPad+(mz-400)/1000*(W-axPad-20);
        const yS=k0=>H-axPad-(k0-.6)/.85*(H-axPad-20);
        const nonStar=parts.filter(p=>p.region!=='star');

        const mzArr    = Array.isArray(heroIons?.mz) ? heroIons.mz : null;
        const k0Arr    = Array.isArray(heroIons?.k0) ? heroIons.k0 : null;
        const chargeArr= heroIons?.charge ?? null;

        if(!mzArr || mzArr.length===0 || !k0Arr || k0Arr.length===0){
          // No usable data: demo realistic IM distribution
          let ds=0xBEEF4321;
          const dr=()=>{ds^=ds<<13;ds^=ds>>17;ds^=ds<<5;return(ds>>>0)/4294967295;};
          nonStar.forEach(p=>{
            const mz=450+Math.pow(dr(),1.5)*950;
            const k0=0.65+Math.sqrt(mz/1400)*0.7+(dr()-.5)*.08;
            p.sx=xS(Math.min(1390,mz)); p.sy=yS(Math.max(.62,Math.min(1.43,k0)));
          });
        } else {
          const n=mzArr.length;
          nonStar.forEach((p,i)=>{
            const idx=Math.min(Math.floor(i/nonStar.length*n), n-1);
            p.sx=xS(mzArr[idx]??600) + (Math.random()-.5)*1.2;
            p.sy=yS(k0Arr[idx]??0.9) + (Math.random()-.5)*1.2;
            const z=chargeArr?.[idx] ?? 2;
            p.col=CHARGE_COL[z] ?? '#94a3b8';
          });
        }
      },[heroIons]);

      const toggle=()=>{
        const next=modeRef.current==='portrait'?'scatter':'portrait';
        modeRef.current=next; setMode(next);
      };

      const runName = selRun ? (runs.find(r=>String(r.id)===String(selRun))?.run_name ?? selRun) : null;

      return (
        <div style={{marginBottom:'1rem',borderRadius:'.75rem',overflow:'hidden',
                     border:'1px solid rgba(218,170,0,0.2)',
                     boxShadow:'0 0 50px rgba(218,170,0,0.07),0 0 100px rgba(168,85,247,0.04)'}}>
          {/* Canvas */}
          <div style={{position:'relative'}}>
            <canvas ref={cvRef}
              style={{width:'100%',height:'400px',display:'block',cursor:'pointer'}}
              onClick={toggle}/>
            {/* Mode badge */}
            <div style={{position:'absolute',bottom:'1rem',right:'1rem',
                         background:'rgba(6,0,16,0.8)',
                         border:`1px solid ${mode==='scatter'?'rgba(34,211,238,0.4)':'rgba(218,170,0,0.35)'}`,
                         borderRadius:'.35rem',padding:'.2rem .6rem',
                         color:mode==='scatter'?'#22d3ee':'#DAAA00',
                         fontSize:'.68rem',fontWeight:700,letterSpacing:'.12em',pointerEvents:'none'}}>
              {mode==='scatter'?'⊕ ION SCATTER':'⚡ PORTRAIT'}
            </div>
            {/* Run name badge */}
            {runName && (
              <div style={{position:'absolute',top:'1rem',right:'1rem',
                           background:'rgba(6,0,16,0.8)',border:'1px solid rgba(34,211,238,0.3)',
                           borderRadius:'.35rem',padding:'.2rem .7rem',
                           color:'#94a3b8',fontSize:'.7rem',fontWeight:600,pointerEvents:'none',
                           maxWidth:'260px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {runName}
              </div>
            )}
            {/* Loading spinner */}
            {loading && (
              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
                           justifyContent:'center',background:'rgba(4,0,12,0.55)'}}>
                <div style={{color:'#22d3ee',fontSize:'0.9rem',fontWeight:700,letterSpacing:'.15em',
                             animation:'spin 1s linear infinite',display:'inline-block'}}>⟳</div>
                <span style={{color:'#94a3b8',fontSize:'0.8rem',marginLeft:'0.5rem'}}>Loading ions…</span>
              </div>
            )}
          </div>

          {/* ── Selector bar ── */}
          <div style={{display:'flex',alignItems:'center',gap:'0.75rem',
                       padding:'0.6rem 1rem',
                       background:'rgba(6,0,16,0.9)',
                       borderTop:'1px solid rgba(218,170,0,0.15)'}}>
            <span style={{color:'#DAAA00',fontSize:'0.68rem',fontWeight:800,
                          letterSpacing:'.14em',textTransform:'uppercase',flexShrink:0}}>
              ⚡ View Run
            </span>
            <select
              value={selRun}
              onChange={e=>{ setSelRun(e.target.value); loadRun(e.target.value); }}
              style={{flex:1,background:'#04000c',color:'#e2e8f0',
                      border:'1px solid rgba(218,170,0,0.25)',borderRadius:'.35rem',
                      padding:'.3rem .6rem',fontSize:'.8rem',minWidth:0}}>
              <option value="">— select a run to view its ion cloud —</option>
              {runs.map(r=>(
                <option key={r.id} value={r.id}>{r.run_name} — {r.instrument}</option>
              ))}
            </select>
            {selRun && (
              <button onClick={()=>{setSelRun('');setHeroIons(null);modeRef.current='portrait';setMode('portrait');}}
                style={{background:'transparent',border:'1px solid rgba(100,116,139,0.4)',
                        borderRadius:'.3rem',padding:'.25rem .55rem',color:'#64748b',
                        fontSize:'.75rem',cursor:'pointer',flexShrink:0}}>
                ✕ clear
              </button>
            )}
            {/* Charge legend */}
            {heroIons && (
              <div style={{display:'flex',gap:'0.5rem',flexShrink:0,alignItems:'center'}}>
                {[[1,'#DAAA00','z1'],[2,'#22d3ee','z2'],[3,'#22c55e','z3'],[4,'#f97316','z4'],[5,'#a855f7','z5+']].map(([z,c,l])=>(
                  <span key={z} style={{fontSize:'.65rem',color:c,fontWeight:700,letterSpacing:'.05em'}}>{l}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

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

          <ZiggyIonHero allRuns={runs} />

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

