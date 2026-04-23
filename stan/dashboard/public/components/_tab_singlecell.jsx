    // ══════════════════════════════════════════════════════════════════════════
    // Single-Cell Proteomics Explorer  ·  Powered by real K562 dilution series
    // Panels: Coverage Arcs · Ion Storm · Charge Helix · Depth Projection ·
    //         Surfaceome Atlas · Quality Radar
    // ══════════════════════════════════════════════════════════════════════════

    const _SC = {
      gold:    '#DAAA00', violet:  '#d946ef', cyan:    '#22d3ee',
      green:   '#4ade80', orange:  '#f97316', purple:  '#a855f7',
      indigo:  '#818cf8', rose:    '#f43f5e', bg:      '#0e0018',
      surface: '#1a0030', border:  '#3d1060', text:    '#f0e6ff',
      muted:   '#b899d4',
    };

    function _scParseAmountPg(runName) {
      const m = runName && runName.match(/K562_([0-9.]+)(ng|pg)/i);
      if (!m) return null;
      const val = parseFloat(m[1]);
      return m[2].toLowerCase() === 'ng' ? val * 1000 : val;
    }
    function _scFmtAmt(pg) {
      if (pg >= 1000) return `${(pg/1000).toFixed(pg>=10000?0:1)}ng`;
      if (pg >= 1)    return `${pg >= 10 ? Math.round(pg) : pg.toFixed(1)}pg`;
      return `${pg.toFixed(2)}pg`;
    }
    function _scRand(seed) {
      let s = (seed >>> 0) || 1;
      const r  = () => { s = Math.imul(s,1664525)+1013904223|0; return (s>>>0)/4294967296; };
      const rN = () => { const u=Math.max(1e-10,r()),v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
      return { r, rN };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 1 — COVERAGE ARCS
    // Circular progress arcs — each arc = one dilution level, fill = depth fraction
    // ═══════════════════════════════════════════════════════════════════════════
    function SCSensitivityArc({ runs }) {
      const canvasRef = useRef(null);
      const animRef   = useRef(null);

      const withData = useMemo(()=>
        runs.filter(r=>r.n_proteins&&r.inputPg).sort((a,b)=>a.inputPg-b.inputPg),
      [runs]);

      useEffect(()=>{
        if (!canvasRef.current || !withData.length) return;
        const cv = canvasRef.current;
        const dpr = window.devicePixelRatio||1;
        cv.width  = cv.offsetWidth*dpr;
        cv.height = cv.offsetHeight*dpr;
        const ctx = cv.getContext('2d');
        ctx.scale(dpr,dpr);
        const W=cv.offsetWidth, H=cv.offsetHeight;
        const maxProt = Math.max(...withData.map(r=>r.n_proteins));
        const CELL_PG = 150;

        let start=null;
        const animate=ts=>{
          if(!start) start=ts;
          const progress = Math.min(1,(ts-start)/1400);
          const ease = 1-Math.pow(1-progress,3);

          ctx.clearRect(0,0,W,H);
          const bg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,H*0.6);
          bg.addColorStop(0,'rgba(45,0,96,0.35)'); bg.addColorStop(1,'rgba(14,0,24,0)');
          ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

          const N=withData.length;
          const spacing=Math.min(110,(W-80)/N);
          const startX=W/2-(N-1)*spacing/2;
          const cy=H*0.50, baseR=Math.min(46,spacing*0.40);

          withData.forEach((run,i)=>{
            const cx=startX+i*spacing;
            const frac=Math.min(1,run.n_proteins/maxProt);
            const isCell=run.inputPg>=CELL_PG*0.5&&run.inputPg<=CELL_PG*2.5;

            // Glow
            const hue=260+frac*100;
            const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,baseR*2);
            glow.addColorStop(0,`hsla(${hue},90%,65%,${0.18*ease})`);
            glow.addColorStop(1,'transparent');
            ctx.fillStyle=glow;
            ctx.beginPath();ctx.arc(cx,cy,baseR*2,0,Math.PI*2);ctx.fill();

            // Track
            ctx.beginPath();ctx.arc(cx,cy,baseR,-Math.PI/2,Math.PI*1.5);
            ctx.strokeStyle='rgba(180,100,255,0.1)';ctx.lineWidth=7;ctx.lineCap='round';ctx.stroke();

            // Fill
            const grad=ctx.createLinearGradient(cx-baseR,cy,cx+baseR,cy);
            if(i/N<0.25){grad.addColorStop(0,'#DAAA00');grad.addColorStop(1,'#f97316');}
            else if(i/N<0.6){grad.addColorStop(0,'#a855f7');grad.addColorStop(1,'#d946ef');}
            else{grad.addColorStop(0,'#22d3ee');grad.addColorStop(1,'#4ade80');}
            ctx.beginPath();ctx.arc(cx,cy,baseR,-Math.PI/2,-Math.PI/2+frac*ease*Math.PI*2);
            ctx.strokeStyle=grad;ctx.lineWidth=7;ctx.lineCap='round';ctx.stroke();

            // Center text
            ctx.fillStyle=`rgba(240,230,255,${0.95*ease})`;
            ctx.font=`bold ${baseR*0.37}px monospace`;
            ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillText((run.n_proteins/1000).toFixed(1)+'k',cx,cy);

            // Sub-label
            ctx.fillStyle=`rgba(184,153,212,${0.88*ease})`;
            ctx.font=`${baseR*0.26}px sans-serif`;
            ctx.textBaseline='top';
            ctx.fillText(_scFmtAmt(run.inputPg),cx,cy+baseR+9);

            if(isCell){
              ctx.fillStyle=`rgba(218,170,0,${0.85*ease})`;
              ctx.font=`bold ${baseR*0.22}px sans-serif`;
              ctx.fillText('≈ 1 CELL',cx,cy+baseR+22);
              // Starburst
              ctx.save();ctx.translate(cx,cy-baseR-14);
              for(let a=0;a<8;a++){
                const ang=a*Math.PI/4;
                ctx.beginPath();
                ctx.moveTo(Math.cos(ang)*4,Math.sin(ang)*4);
                ctx.lineTo(Math.cos(ang)*11*ease,Math.sin(ang)*11*ease);
                ctx.strokeStyle=`rgba(218,170,0,${0.7*ease})`;ctx.lineWidth=1.5;ctx.stroke();
              }
              ctx.restore();
            }
          });

          // Title
          ctx.fillStyle=`rgba(240,230,255,${ease})`;
          ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
          ctx.fillText('Detection Coverage · Each arc = fraction of plateau depth  ('+maxProt.toLocaleString()+' proteins max)',W/2,8);

          if(progress<1) animRef.current=requestAnimationFrame(animate);
        };
        animRef.current=requestAnimationFrame(animate);
        return()=>cancelAnimationFrame(animRef.current);
      },[withData]);

      return React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:4}},
        React.createElement('canvas',{ref:canvasRef,style:{width:'100%',height:260,display:'block'}}),
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 2 — ION STORM  (real 4D API data, canvas streaks)
    // Ions as glowing streaks, z-colored, animated reveal
    // ═══════════════════════════════════════════════════════════════════════════
    function SCIonStorm({ runs }) {
      const canvasRef = useRef(null);
      const [selId, setSelId]     = useState(null);
      const [ions,  setIons]      = useState(null);
      const [loading,setLoading]  = useState(false);
      const animRef = useRef(null);

      useEffect(()=>{
        if(runs.length&&!selId){
          const best=[...runs].filter(r=>r.n_proteins).sort((a,b)=>(b.n_proteins||0)-(a.n_proteins||0))[0];
          if(best) setSelId(best.id);
        }
      },[runs]);

      useEffect(()=>{
        if(!selId) return;
        setLoading(true);
        fetch(`/api/runs/${selId}/mobility-3d?max_features=5000`)
          .then(r=>r.json()).then(d=>{setIons(d);setLoading(false);}).catch(()=>setLoading(false));
      },[selId]);

      useEffect(()=>{
        if(!canvasRef.current||!ions?.mz) return;
        const cv=canvasRef.current;
        const dpr=window.devicePixelRatio||1;
        cv.width=cv.offsetWidth*dpr; cv.height=cv.offsetHeight*dpr;
        const ctx=cv.getContext('2d');
        ctx.scale(dpr,dpr);
        const W=cv.offsetWidth, H=cv.offsetHeight;

        const n=ions.mz.length;
        const mzMin=Math.min(...ions.mz), mzMax=Math.max(...ions.mz);
        const k0Min=Math.min(...ions.mobility), k0Max=Math.max(...ions.mobility);
        const liMin=Math.min(...ions.log_int), liMax=Math.max(...ions.log_int);
        const rtMin=Math.min(...ions.rt), rtMax=Math.max(...ions.rt);

        const px=i=>44+(ions.mz[i]-mzMin)/(mzMax-mzMin)*(W-88);
        const py=i=>H-38-(ions.mobility[i]-k0Min)/(k0Max-k0Min)*(H-76);
        const order=[...Array(n).keys()].sort((a,b)=>ions.rt[a]-ions.rt[b]);

        const chargeColors={1:'#DAAA00',2:'#d946ef',3:'#22d3ee',4:'#f97316',5:'#f43f5e'};

        let frame=0;
        const TOTAL=90;
        const draw=()=>{
          ctx.fillStyle=_SC.bg; ctx.fillRect(0,0,W,H);
          // Grid
          ctx.strokeStyle='rgba(61,16,96,0.3)'; ctx.lineWidth=0.4;
          for(let gx=44;gx<W-44;gx+=(W-88)/8){ctx.beginPath();ctx.moveTo(gx,38);ctx.lineTo(gx,H-38);ctx.stroke();}
          for(let gy=38;gy<H-38;gy+=(H-76)/5){ctx.beginPath();ctx.moveTo(44,gy);ctx.lineTo(W-44,gy);ctx.stroke();}

          const showN=Math.floor(n*Math.min(1,frame/TOTAL));
          for(let ii=0;ii<showN;ii++){
            const i=order[ii];
            const x=px(i),y=py(i);
            const rt_f=(ions.rt[i]-rtMin)/(rtMax-rtMin||1);
            const li_f=(ions.log_int[i]-liMin)/(liMax-liMin||1);
            const z=ions.charge[i]||2;
            const col=chargeColors[z]||_SC.muted;
            const alpha=0.2+li_f*0.7;
            const r2=1.0+li_f*4;
            // Streak
            const dx=(rt_f-0.5)*10;
            ctx.beginPath();ctx.moveTo(x-dx*.4,y+.8);ctx.lineTo(x+dx*.4,y-.8);
            ctx.strokeStyle=col+'55'; ctx.lineWidth=r2*.5;ctx.lineCap='round';ctx.stroke();
            // Glow
            const grd=ctx.createRadialGradient(x,y,0,x,y,r2*2.5);
            grd.addColorStop(0,col+(Math.round(alpha*255).toString(16).padStart(2,'0')));
            grd.addColorStop(1,'transparent');
            ctx.fillStyle=grd; ctx.beginPath();ctx.arc(x,y,r2*2.5,0,Math.PI*2);ctx.fill();
          }

          // Axes
          ctx.fillStyle=_SC.muted; ctx.font='10px monospace';
          ctx.textAlign='center'; ctx.fillText('m/z',W/2,H-6);
          ctx.save();ctx.translate(12,H/2);ctx.rotate(-Math.PI/2);ctx.fillText('1/K₀',0,0);ctx.restore();

          // Legend
          [2,3,4].forEach((z,zi)=>{
            const lx=W-100,ly=48+zi*20;
            ctx.fillStyle=chargeColors[z];ctx.beginPath();ctx.arc(lx,ly,4,0,Math.PI*2);ctx.fill();
            ctx.fillStyle=_SC.muted;ctx.font='10px sans-serif';ctx.textAlign='left';
            ctx.textBaseline='middle';ctx.fillText(`z=${z}`,lx+9,ly);
          });

          // Stats
          const run=runs.find(r=>r.id===selId);
          ctx.fillStyle='rgba(184,153,212,0.6)';ctx.font='10px monospace';
          ctx.textAlign='right';ctx.textBaseline='bottom';
          if(run) ctx.fillText(`${(ions.n_shown||0).toLocaleString()} ions · ${_scFmtAmt(run.inputPg||0)}`,W-8,H-6);

          if(frame<TOTAL){frame++;animRef.current=requestAnimationFrame(draw);}
          else{
            // After reveal, draw static
          }
        };
        cancelAnimationFrame(animRef.current);
        frame=0;
        animRef.current=requestAnimationFrame(draw);
        return()=>cancelAnimationFrame(animRef.current);
      },[ions,selId]);

      const sortedRuns=runs.filter(r=>r.n_proteins).sort((a,b)=>a.inputPg-b.inputPg);
      return React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:8}},
        React.createElement('div',{style:{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}},
          React.createElement('span',{style:{color:_SC.muted,fontSize:11}},'Sample:'),
          ...sortedRuns.map(r=>
            React.createElement('button',{key:r.id,onClick:()=>setSelId(r.id),
              style:{padding:'3px 10px',borderRadius:4,fontSize:11,cursor:'pointer',
                background:selId===r.id?_SC.violet:_SC.surface,
                color:selId===r.id?'#fff':_SC.muted,
                border:`1px solid ${selId===r.id?_SC.violet:_SC.border}`}
            },_scFmtAmt(r.inputPg))
          ),
          loading&&React.createElement('span',{style:{color:_SC.gold,fontSize:11}},'Loading…'),
        ),
        React.createElement('canvas',{ref:canvasRef,style:{width:'100%',height:420,display:'block',borderRadius:8,border:`1px solid ${_SC.border}`}}),
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 3 — CHARGE HELIX  (real data, animated canvas)
    // Charge state distribution — neon stacked bars, z=2 wave, floating particles
    // ═══════════════════════════════════════════════════════════════════════════
    function SCChargeHelix({ runs }) {
      const canvasRef = useRef(null);

      const withData = useMemo(()=>
        runs.filter(r=>r.n_proteins&&r.inputPg&&r.pct_charge_2!=null)
            .sort((a,b)=>a.inputPg-b.inputPg),
      [runs]);

      const animRef  = useRef(null);
      const hovRef   = useRef(-1);
      const entryRef = useRef(0);
      const partsRef = useRef([]);

      // Charge colours: z1 dim purple, z2 magenta, z3 cyan, z4+ orange
      const CSEG=[
        {key:'c1',col:'#7c3aed',glow:'#a78bfa',label:'z=1'},
        {key:'c2',col:'#d946ef',glow:'#f0abfc',label:'z=2'},
        {key:'c3',col:'#22d3ee',glow:'#67e8f9',label:'z=3'},
        {key:'c4',col:'#f97316',glow:'#fb923c',label:'z≥4'},
      ];

      const getFrags=(run)=>{
        const c1=(run.pct_charge_1||0)*100;
        const c2=(run.pct_charge_2||0)*100;
        const c3=(run.pct_charge_3||0)*100;
        const c4=Math.max(0,100-c1-c2-c3);
        return [c1,c2,c3,c4];
      };

      useEffect(()=>{
        if(!canvasRef.current||!withData.length) return;
        const cv=canvasRef.current;
        const dpr=window.devicePixelRatio||1;
        cv.width=cv.offsetWidth*dpr; cv.height=cv.offsetHeight*dpr;
        const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
        const W=cv.offsetWidth, H=cv.offsetHeight;
        const PAD={l:50,r:22,t:52,b:50};
        const PW=W-PAD.l-PAD.r, PH=H-PAD.t-PAD.b;
        const N=withData.length;
        const colW=PW/N;
        const barW=Math.min(colW*0.60, 52);

        // Init particles
        entryRef.current=0;
        const rng=_scRand(555);
        partsRef.current=withData.flatMap((run,ci)=>
          getFrags(run).flatMap((frac,si)=>{
            if(frac<2) return [];
            return Array.from({length:Math.max(1,Math.round(frac/9))},()=>({
              ci,si,
              xOff:0.1+rng.r()*0.8,
              yOff:rng.r(),
              vy:0.05+rng.r()*0.09,
            }));
          })
        );

        let last=null;
        const eo=t=>1-(1-t)**3;

        const frame=(ts)=>{
          if(!last) last=ts;
          const dt=(ts-last)/1000; last=ts;
          entryRef.current=Math.min(1,entryRef.current+dt*0.75);
          const entry=eo(entryRef.current);

          // ── Background ──────────────────────────────────────────────────
          ctx.fillStyle='#040010'; ctx.fillRect(0,0,W,H);

          // Synthwave horizontal grid lines
          for(let pct=0;pct<=100;pct+=25){
            const y=H-PAD.b-(pct/100)*PH;
            ctx.strokeStyle=pct===0?'rgba(255,0,204,0.18)':'rgba(255,0,204,0.06)';
            ctx.lineWidth=pct===0?1:0.5;
            ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(W-PAD.r,y); ctx.stroke();
          }

          // Scanline sweep — thin glowing bar moving top→bottom
          const scanY=PAD.t+((ts%3200)/3200)*PH;
          const sg=ctx.createLinearGradient(0,scanY-10,0,scanY+10);
          sg.addColorStop(0,'transparent');
          sg.addColorStop(0.5,'rgba(180,255,255,0.07)');
          sg.addColorStop(1,'transparent');
          ctx.fillStyle=sg; ctx.fillRect(PAD.l,scanY-10,PW,20);

          // ── Bars ─────────────────────────────────────────────────────────
          const c2Tops=[];

          withData.forEach((run,i)=>{
            const fracs=getFrags(run);
            const barX=PAD.l+i*colW+(colW-barW)/2;
            const isHov=hovRef.current===i;
            const isCell=run.inputPg>=80&&run.inputPg<=300;

            // Gold column tint for ~1-cell depth
            if(isCell){
              const cg=ctx.createLinearGradient(0,PAD.t,0,H-PAD.b);
              cg.addColorStop(0,'rgba(218,170,0,0)');
              cg.addColorStop(0.5,'rgba(218,170,0,0.055)');
              cg.addColorStop(1,'rgba(218,170,0,0.01)');
              ctx.fillStyle=cg; ctx.fillRect(barX-3,PAD.t,barW+6,PH);
            }

            let cumY=H-PAD.b;
            fracs.forEach((frac,si)=>{
              if(frac<0.5) return;
              const segH=(frac/100)*PH*entry;
              const segY=cumY-segH;
              const {col,glow}=CSEG[si];

              // Fill gradient — brighter on right side
              const fg=ctx.createLinearGradient(barX,0,barX+barW,0);
              fg.addColorStop(0,col+'bb'); fg.addColorStop(0.5,col+'ee'); fg.addColorStop(1,col+'bb');
              ctx.fillStyle=fg; ctx.fillRect(barX,segY,barW,segH);

              // Left/right edge glow strips
              const eg=ctx.createLinearGradient(barX,0,barX+barW,0);
              eg.addColorStop(0,glow+'55'); eg.addColorStop(0.12,'transparent');
              eg.addColorStop(0.88,'transparent'); eg.addColorStop(1,glow+'55');
              ctx.fillStyle=eg; ctx.fillRect(barX,segY,barW,segH);

              // Top neon edge — the brightest part of each segment
              ctx.shadowBlur=10; ctx.shadowColor=glow;
              ctx.fillStyle=glow; ctx.fillRect(barX,segY,barW,1.5);
              ctx.shadowBlur=0;

              // Segment % label
              if(segH>16&&frac>=4){
                ctx.fillStyle=si===0?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.88)';
                ctx.font=`bold ${Math.min(11,segH*0.35)|0}px monospace`;
                ctx.textAlign='center'; ctx.textBaseline='middle';
                ctx.fillText(`${frac.toFixed(0)}%`,barX+barW/2,segY+segH/2);
              }

              if(si===1) c2Tops.push({x:barX+barW/2,y:segY}); // track z=2 top
              cumY=segY;
            });

            // Hover outline
            if(isHov){
              ctx.strokeStyle='rgba(255,255,255,0.45)'; ctx.lineWidth=1.5;
              const bh=PH*entry;
              ctx.strokeRect(barX-1,H-PAD.b-bh-1,barW+2,bh+2);
            }

            // X-axis label
            ctx.fillStyle=isCell?'#DAAA00':_SC.muted;
            ctx.font=`${isCell?'bold ':''}9px monospace`;
            ctx.textAlign='center'; ctx.textBaseline='top';
            ctx.fillText(_scFmtAmt(run.inputPg),barX+barW/2,H-PAD.b+5);
            if(isCell){
              ctx.fillStyle='rgba(218,170,0,0.6)';
              ctx.font='8px sans-serif';
              ctx.fillText('≈1 cell',barX+barW/2,H-PAD.b+16);
            }
          });

          // ── z=2 connection wave ───────────────────────────────────────────
          if(c2Tops.length>=2&&entry>0.55){
            const wa=Math.min(1,(entry-0.55)*2.5);
            // Glow pass
            ctx.shadowBlur=14; ctx.shadowColor='#d946ef';
            ctx.strokeStyle=`rgba(217,70,239,${0.45*wa})`; ctx.lineWidth=4;
            ctx.beginPath();
            c2Tops.forEach((p,i)=>{
              if(i===0){ctx.moveTo(p.x,p.y);return;}
              const prev=c2Tops[i-1],mx=(prev.x+p.x)/2;
              ctx.bezierCurveTo(mx,prev.y,mx,p.y,p.x,p.y);
            });
            ctx.stroke();
            // Sharp bright pass
            ctx.strokeStyle=`rgba(240,171,252,${0.9*wa})`; ctx.lineWidth=1.8;
            ctx.shadowBlur=0;
            ctx.beginPath();
            c2Tops.forEach((p,i)=>{
              if(i===0){ctx.moveTo(p.x,p.y);return;}
              const prev=c2Tops[i-1],mx=(prev.x+p.x)/2;
              ctx.bezierCurveTo(mx,prev.y,mx,p.y,p.x,p.y);
            });
            ctx.stroke();
            // Dots at each node
            c2Tops.forEach(p=>{
              ctx.shadowBlur=8; ctx.shadowColor='#f0abfc';
              ctx.fillStyle='#f0abfc'; ctx.beginPath(); ctx.arc(p.x,p.y,3.5,0,Math.PI*2); ctx.fill();
              ctx.shadowBlur=0;
              ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.arc(p.x,p.y,1.4,0,Math.PI*2); ctx.fill();
            });
          }

          // ── Floating particles ────────────────────────────────────────────
          partsRef.current.forEach(p=>{
            if(p.ci>=withData.length) return;
            const run=withData[p.ci];
            const fracs=getFrags(run);
            const frac=fracs[p.si]; if(frac<1) return;
            const segH=(frac/100)*PH*entry; if(segH<2) return;
            const botFrac=fracs.slice(0,p.si).reduce((a,b)=>a+b,0);
            const segBot=H-PAD.b-(botFrac/100)*PH*entry;
            const segTop=segBot-segH;
            const bx=PAD.l+p.ci*colW+(colW-barW)/2;
            const px=bx+p.xOff*barW;
            p.yOff=(p.yOff-p.vy*dt+1)%1;
            const py=segBot-p.yOff*segH;
            if(py<segTop||py>segBot) return;
            ctx.fillStyle=CSEG[p.si].glow; ctx.globalAlpha=0.55;
            ctx.beginPath(); ctx.arc(px,py,1,0,Math.PI*2); ctx.fill();
            ctx.globalAlpha=1;
          });

          // ── Y axis + labels ───────────────────────────────────────────────
          ctx.strokeStyle='rgba(200,150,240,0.25)'; ctx.lineWidth=0.8;
          ctx.beginPath(); ctx.moveTo(PAD.l,PAD.t); ctx.lineTo(PAD.l,H-PAD.b); ctx.stroke();
          [0,25,50,75,100].forEach(pct=>{
            const y=H-PAD.b-(pct/100)*PH;
            ctx.fillStyle='rgba(180,130,220,0.55)'; ctx.font='9px monospace';
            ctx.textAlign='right'; ctx.textBaseline='middle';
            ctx.fillText(`${pct}%`,PAD.l-5,y);
          });

          // ── Legend ────────────────────────────────────────────────────────
          const lgW=PW/4;
          CSEG.forEach(({col,glow,label},i)=>{
            const lx=PAD.l+i*lgW+lgW/2-22;
            const ly=14;
            ctx.shadowBlur=6; ctx.shadowColor=glow;
            ctx.fillStyle=col; ctx.fillRect(lx,ly-5,14,10);
            ctx.fillStyle=glow; ctx.fillRect(lx,ly-5,14,2);
            ctx.shadowBlur=0;
            ctx.fillStyle='rgba(230,210,255,0.85)'; ctx.font='9px monospace';
            ctx.textAlign='left'; ctx.textBaseline='middle';
            ctx.fillText(label,lx+17,ly);
          });

          // Title
          ctx.fillStyle='rgba(210,185,255,0.6)'; ctx.font='bold 10px sans-serif';
          ctx.textAlign='center'; ctx.textBaseline='top';
          ctx.fillText('CHARGE STATE DISTRIBUTION  ·  precursor % by charge  ·  z=2 wave  ·  hover to inspect',W/2,PAD.t-38);

          // ── Hover tooltip ─────────────────────────────────────────────────
          const hi=hovRef.current;
          if(hi>=0&&hi<N){
            const run=withData[hi];
            const fracs=getFrags(run);
            const bx=PAD.l+hi*colW+colW/2;
            const lines=[[`${_scFmtAmt(run.inputPg)}`,'#f0e8ff'],...CSEG.map(({label,glow},si)=>[`${label}: ${fracs[si].toFixed(1)}%`,glow])];
            ctx.font='10px monospace';
            const tw=Math.max(...lines.map(([l])=>ctx.measureText(l).width))+22;
            const th=lines.length*15+12;
            const tx=Math.min(Math.max(bx-tw/2,PAD.l+2),W-PAD.r-tw-2);
            const ty=PAD.t+8;
            ctx.fillStyle='rgba(4,0,18,0.93)';
            ctx.strokeStyle='rgba(217,70,239,0.65)'; ctx.lineWidth=1;
            ctx.beginPath(); ctx.roundRect(tx,ty,tw,th,6); ctx.fill(); ctx.stroke();
            lines.forEach(([text,col],li)=>{
              ctx.fillStyle=col;
              ctx.font=li===0?'bold 10px monospace':'9px monospace';
              ctx.textAlign='left'; ctx.textBaseline='top';
              ctx.fillText(text,tx+10,ty+7+li*15);
            });
          }

          animRef.current=requestAnimationFrame(frame);
        };
        animRef.current=requestAnimationFrame(frame);
        return()=>cancelAnimationFrame(animRef.current);
      },[withData]);

      const handleMouseMove=useCallback((e)=>{
        if(!canvasRef.current||!withData.length) return;
        const rect=canvasRef.current.getBoundingClientRect();
        const mx=e.clientX-rect.left;
        const PL=50, PR=22;
        const colW=(canvasRef.current.offsetWidth-PL-PR)/withData.length;
        const ci=Math.floor((mx-PL)/colW);
        hovRef.current=(ci>=0&&ci<withData.length)?ci:-1;
      },[withData]);

      return React.createElement('canvas',{ref:canvasRef,
        onMouseMove:handleMouseMove,
        onMouseLeave:()=>{hovRef.current=-1;},
        style:{width:'100%',height:380,display:'block',borderRadius:8,
          border:`1px solid ${_SC.border}`,cursor:'crosshair'}});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 4 — DEPTH PROJECTION  (real data + MM model, Plotly neon)
    // ═══════════════════════════════════════════════════════════════════════════
    function SCCoverageProjection({ runs }) {
      const ref = useRef(null);

      useEffect(()=>{
        if(!ref.current||!runs.length) return;
        const pts=runs.filter(r=>r.n_proteins&&r.inputPg).sort((a,b)=>a.inputPg-b.inputPg);
        if(pts.length<2) return;

        // MM fit (linearized)
        const iy=pts.map(r=>1/r.n_proteins),ix=pts.map(r=>1/r.inputPg);
        const n=pts.length,sX=ix.reduce((a,b)=>a+b,0),sY=iy.reduce((a,b)=>a+b,0);
        const sXY=ix.reduce((s,v,i)=>s+v*iy[i],0),sX2=ix.reduce((s,v)=>s+v*v,0);
        const sl=(n*sXY-sX*sY)/(n*sX2-sX**2),ic=(sY-sl*sX)/n;
        const Vmax=1/Math.max(ic,1e-8), Km=sl*Vmax;
        const mm=x=>Vmax*x/(Km+x);

        const xArr=[],yArr=[];
        for(let lx=-0.3;lx<=5.2;lx+=0.04){const x=Math.pow(10,lx);xArr.push(x);yArr.push(mm(x));}

        const cellPg=150, cellProt=Math.round(mm(cellPg));

        const traces=[
          // Band
          {x:[...xArr,...[...xArr].reverse()],
           y:[...yArr.map(v=>v*1.07),...[...yArr].map(v=>v*0.93).reverse()],
           fill:'toself',fillcolor:'rgba(168,85,247,0.07)',line:{color:'transparent'},
           hoverinfo:'skip',showlegend:false},
          // Glow layers
          {x:xArr,y:yArr,mode:'lines',showlegend:false,hoverinfo:'skip',line:{color:'rgba(217,70,239,0.07)',width:20}},
          {x:xArr,y:yArr,mode:'lines',showlegend:false,hoverinfo:'skip',line:{color:'rgba(217,70,239,0.14)',width:10}},
          {x:xArr,y:yArr,mode:'lines',name:'MM model',line:{color:_SC.violet,width:2.5},
           hovertemplate:'%{x:.0f}pg → %{y:,.0f} proteins<extra>Model</extra>'},
          // Crosshairs
          {x:[cellPg,cellPg],y:[0,cellProt],mode:'lines',showlegend:false,hoverinfo:'skip',
           line:{color:'rgba(218,170,0,0.35)',width:1.5,dash:'dot'}},
          {x:[0.3,cellPg],y:[cellProt,cellProt],mode:'lines',showlegend:false,hoverinfo:'skip',
           line:{color:'rgba(218,170,0,0.35)',width:1.5,dash:'dot'}},
          // Data points
          {x:pts.map(r=>r.inputPg),y:pts.map(r=>r.n_proteins),mode:'markers',name:'Observed',
           marker:{
             size:pts.map(r=>10+Math.sqrt(r.n_precursors||1)/130),
             color:pts.map(r=>r.n_proteins),
             colorscale:[[0,'#DAAA00'],[0.25,'#f97316'],[0.6,'#a855f7'],[1,'#22d3ee']],
             showscale:false,
             line:{color:'rgba(255,255,255,0.25)',width:1.5},
           },
           hovertemplate:'%{x:.0f}pg → %{y:,} proteins<extra>Observed</extra>'},
        ];

        const layout={
          paper_bgcolor:_SC.bg, plot_bgcolor:'rgba(26,0,48,0.6)',
          margin:{t:50,r:30,b:58,l:72},
          title:{text:`Single-Cell Projection · ~<b>${cellProt.toLocaleString()}</b> proteins at 150pg`,
                 font:{color:_SC.text,size:13},x:0.5},
          xaxis:{title:{text:'Input Amount (pg)',font:{color:_SC.muted,size:11}},
                 type:'log',tickfont:{color:_SC.muted},gridcolor:'rgba(61,16,96,0.35)',zeroline:false,
                 tickvals:[1,8,40,150,500,1000,5000,25000,125000],
                 ticktext:['1pg','8pg','40pg','150pg','500pg','1ng','5ng','25ng','125ng']},
          yaxis:{title:{text:'Proteins Identified',font:{color:_SC.muted,size:11}},
                 tickfont:{color:_SC.muted},gridcolor:'rgba(61,16,96,0.35)',zeroline:false},
          legend:{font:{color:_SC.text},bgcolor:'transparent'},
          annotations:[
            {x:Math.log10(cellPg)+0.06,y:cellProt,xref:'x',yref:'y',
             text:`  1 cell ≈ ${cellProt.toLocaleString()} proteins`,
             font:{color:_SC.gold,size:11},showarrow:false,xanchor:'left'},
          ],
          shapes:[
            {type:'rect',x0:80,x1:300,y0:0,y1:1,yref:'paper',
             fillcolor:'rgba(218,170,0,0.04)',line:{color:'rgba(218,170,0,0.12)',width:1,dash:'dot'}},
          ],
        };

        window.Plotly.react(ref.current,traces,layout,{responsive:true,displayModeBar:false});
      },[runs]);

      return React.createElement('div',{ref,style:{height:430}});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 5 — SURFACEOME ATLAS  (real ion cloud background, canvas)
    // ═══════════════════════════════════════════════════════════════════════════
    // [name, mz, mobility, log_int, pathway, uniprot, gene, full_name, description]
    const _SC_SURFACE_MARKERS = [
      ['CD34',  490, 0.78,6.8,'Stem',    'P28906','CD34',  'CD34 antigen',                   'Hematopoietic progenitor marker; critical for stem cell niche adhesion and self-renewal. Classic LSC marker in CML.'],
      ['CD43',  720, 0.88,7.1,'Stem',    'P16150','SPN',   'Leukosialin / CD43',              'Heavily O-glycosylated sialoglycoprotein; anti-adhesion role; elevated in CML blast crisis.'],
      ['CD117', 960, 1.02,6.5,'Stem',    'P10721','KIT',   'Mast/stem cell growth factor receptor KIT', 'Receptor tyrosine kinase; stem cell factor receptor. Highly expressed on K562; key survival signal.'],
      ['CD33',  820, 0.82,7.4,'Myeloid', 'P20138','CD33',  'Myeloid cell surface antigen CD33','Sialic acid–binding lectin; myeloid differentiation marker. Therapeutic target (gemtuzumab).'],
      ['CD13',  680, 0.80,7.2,'Myeloid', 'P15144','ANPEP', 'Aminopeptidase N / CD13',         'Zinc metalloprotease; myeloid marker; cleaves N-terminal amino acids from peptides/proteins.'],
      ['CD15',  540, 0.70,6.9,'Myeloid', 'Q9UMX9','FUT4',  'Lewis x trisaccharide / CD15',    'Fucosylated carbohydrate antigen; expressed on myeloid cells and some CML populations.'],
      ['CD71',  750, 0.91,7.6,'TfR',     'P02786','TFRC',  'Transferrin receptor 1 / CD71',   'Iron uptake receptor. Massively upregulated in K562 due to high iron demand for rapid proliferation.'],
      ['TfR1',  840, 0.97,7.5,'TfR',     'P02786','TFRC',  'Transferrin receptor 1 (glycoform)','Glycosylated form; dimeric transmembrane protein. Direct readout of cellular iron demand.'],
      ['CD29',  680, 0.83,7.0,'Integrin','P05556','ITGB1', 'Integrin β1 / CD29',              'Forms heterodimers with α-integrins; mediates K562 adhesion to fibronectin. Anti-apoptotic signaling.'],
      ['ITGAV', 870, 0.99,6.8,'Integrin','P06756','ITGAV', 'Integrin αV',                     'Partners with β3/β5/β8; mediates vitronectin binding. Expressed on K562; involved in survival signaling.'],
      ['HLA-A', 900, 0.93,7.3,'MHC-I',  'P04439','HLA-A', 'HLA class I histocompatibility antigen A','Peptide-presenting MHC-I molecule. K562 expresses low MHC-I — key to NK-cell susceptibility.'],
      ['HLA-B', 910, 0.94,7.2,'MHC-I',  'P01889','HLA-B', 'HLA class I histocompatibility antigen B','Second classical MHC-I locus. Low expression on K562 contributes to immune evasion model.'],
      ['β2M',   610, 0.64,7.8,'MHC-I',  'P61769','B2M',   'Beta-2 microglobulin',            'Invariant MHC-I light chain. Small protein (11.7 kDa); high abundance in plasma and on cell surface.'],
      ['CD45', 1080, 1.12,7.5,'Pan',     'P08575','PTPRC', 'Receptor-type tyrosine-protein phosphatase C / CD45','Pan-leukocyte marker. Largest surface glycoprotein; tyrosine phosphatase regulating lymphocyte activation.'],
      ['CD44',  930, 1.01,7.3,'Pan',     'P16070','CD44',  'CD44 antigen',                    'Hyaluronan receptor; adhesion, migration, and survival. Highly expressed on K562; multiple isoforms.'],
      ['CD47',  830, 0.88,7.6,'Pan',     'Q08722','CD47',  'Leukocyte surface antigen CD47',  '"Don\'t eat me" signal; ligand for SIRPα on macrophages. Overexpressed on K562; immune checkpoint.'],
      ['ABL1',  560, 0.76,6.2,'BCR-ABL','P00519','ABL1',  'Tyrosine-protein kinase ABL1',    'Non-receptor tyrosine kinase. Forms oncogenic BCR-ABL fusion in CML (t9;22). Target of imatinib.'],
      ['BCR',   780, 0.90,6.3,'BCR-ABL','P11274','BCR',   'Breakpoint cluster region protein','Forms BCR-ABL oncofusion. GTPase-activating and serine kinase domains drive constitutive ABL activation.'],
    ];
    const _SC_PW_COL={
      'Stem':_SC.gold,'Myeloid':_SC.violet,'TfR':_SC.cyan,
      'Integrin':_SC.green,'MHC-I':_SC.orange,'Pan':_SC.indigo,'BCR-ABL':_SC.rose,
    };

    function SCSurfaceomeAtlas({ runs }) {
      const canvasRef  = useRef(null);
      const markerPts  = useRef([]);   // [{name, mx, my, marker, col}]
      const [selId,    setSelId]    = useState(null);
      const [ions,     setIons]     = useState(null);
      const [hovered,  setHovered]  = useState(null);  // marker name
      const [selected, setSelected] = useState(null);  // full marker array

      useEffect(()=>{
        if(runs.length&&!selId){
          const best=[...runs].filter(r=>r.n_proteins).sort((a,b)=>(b.n_proteins||0)-(a.n_proteins||0))[0];
          if(best) setSelId(best.id);
        }
      },[runs]);

      useEffect(()=>{
        if(!selId) return;
        fetch(`/api/runs/${selId}/mobility-3d?max_features=4000`)
          .then(r=>r.json()).then(setIons).catch(()=>{});
      },[selId]);

      useEffect(()=>{
        if(!canvasRef.current) return;
        const cv=canvasRef.current;
        const dpr=window.devicePixelRatio||1;
        cv.width=cv.offsetWidth*dpr; cv.height=cv.offsetHeight*dpr;
        const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
        const W=cv.offsetWidth, H=cv.offsetHeight;
        const PAD={l:60,r:24,t:36,b:40};
        const PW=W-PAD.l-PAD.r, PH=H-PAD.t-PAD.b;
        const MZ0=400,MZ1=1200,K00=0.45,K01=1.52;
        const tx=mz=>PAD.l+(mz-MZ0)/(MZ1-MZ0)*PW;
        const ty=k0=>PAD.t+(K01-k0)/(K01-K00)*PH;
        const {rN}=_scRand(9001);

        // Slightly lighter background so dots and lines read clearly
        ctx.fillStyle='#130028'; ctx.fillRect(0,0,W,H);

        // Subtle grid
        ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=0.4;
        [500,600,700,800,900,1000,1100].forEach(mz=>{
          const x=tx(mz);
          ctx.beginPath();ctx.moveTo(x,PAD.t);ctx.lineTo(x,H-PAD.b);ctx.stroke();
        });
        [0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5].forEach(k0=>{
          const y=ty(k0);
          ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(W-PAD.r,y);ctx.stroke();
        });

        // Ion field — brighter so the cloud is actually visible
        if(ions?.mz){
          ions.mz.forEach((mz,i)=>{
            const x=tx(mz),y=ty(ions.mobility[i]);
            const alpha=0.18+((ions.log_int[i]-6.5)/1.5)*0.30;
            ctx.fillStyle=`rgba(168,85,247,${Math.min(0.65,Math.max(0.08,alpha))})`;
            ctx.fillRect(x,y,1.8,1.8);
          });
        }

        // CCS corridors — more visible dashed lines
        [2,3,4].forEach(z=>{
          ctx.beginPath();
          for(let mz=400;mz<=1200;mz+=10){
            const k0=_lsCcsExpected(mz,z), x=tx(mz),y=ty(k0);
            if(mz===400) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          }
          ctx.strokeStyle='rgba(255,255,255,0.28)';ctx.lineWidth=0.9;
          ctx.setLineDash([5,6]);ctx.stroke();ctx.setLineDash([]);
          const lmz=1150;
          ctx.fillStyle='rgba(255,255,255,0.65)';ctx.font='bold 9px monospace';
          ctx.textAlign='center';ctx.textBaseline='bottom';
          ctx.fillText(`z=${z}`,tx(lmz),ty(_lsCcsExpected(lmz,z))-3);
        });

        // Pathway constellations — brighter dots, more opaque lines, larger halos
        const pathways=[...new Set(_SC_SURFACE_MARKERS.map(m=>m[4]))];
        const pts=[];
        pathways.forEach(pw=>{
          const grp=_SC_SURFACE_MARKERS.filter(m=>m[4]===pw);
          const col=_SC_PW_COL[pw]||_SC.muted;
          // Connection lines
          for(let a=0;a<grp.length-1;a++){
            ctx.beginPath();
            ctx.moveTo(tx(grp[a][1]+rN()*7),ty(grp[a][2]+rN()*0.012));
            ctx.lineTo(tx(grp[a+1][1]+rN()*7),ty(grp[a+1][2]+rN()*0.012));
            ctx.strokeStyle=col+'55'; ctx.lineWidth=1.0; ctx.stroke();
          }
          grp.forEach(m=>{
            const mx=tx(m[1]+rN()*7), my=ty(m[2]+rN()*0.012);
            const isHov = hovered===m[0];
            const isSel = selected&&selected[0]===m[0];
            const sz=(2.8+(m[3]-6)*1.1)*(isHov||isSel?1.7:1);
            // Glow halo — larger for selected
            const haloR=sz*(isSel?8:isHov?7:5);
            const grd=ctx.createRadialGradient(mx,my,0,mx,my,haloR);
            grd.addColorStop(0,col+(isSel?'cc':isHov?'aa':'99')); grd.addColorStop(1,'transparent');
            ctx.fillStyle=grd; ctx.beginPath();ctx.arc(mx,my,haloR,0,Math.PI*2);ctx.fill();
            // Dot
            ctx.fillStyle=col; ctx.beginPath();ctx.arc(mx,my,sz,0,Math.PI*2);ctx.fill();
            // Selected ring
            if(isSel){
              ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
              ctx.beginPath();ctx.arc(mx,my,sz+3,0,Math.PI*2);ctx.stroke();
            }
            // White core
            ctx.fillStyle='rgba(255,255,255,0.7)';ctx.beginPath();ctx.arc(mx,my,sz*0.4,0,Math.PI*2);ctx.fill();
            // Label — brighter on hover/selected
            ctx.fillStyle=isHov||isSel?'#fff':col;
            ctx.font=`bold ${isHov||isSel?9.5:8.5}px sans-serif`;
            ctx.textAlign='center';ctx.textBaseline='bottom';
            ctx.fillText(m[0],mx,my-sz-2);
            pts.push({name:m[0], mx, my, marker:m, col, r:Math.max(sz+10,16)});
          });
        });
        markerPts.current=pts;

        // Axes
        ctx.strokeStyle='rgba(200,160,240,0.4)'; ctx.lineWidth=0.8;
        ctx.beginPath();ctx.moveTo(PAD.l,PAD.t);ctx.lineTo(PAD.l,H-PAD.b);ctx.stroke();
        ctx.beginPath();ctx.moveTo(PAD.l,H-PAD.b);ctx.lineTo(W-PAD.r,H-PAD.b);ctx.stroke();
        ctx.fillStyle='#c4b5d4'; ctx.font='10px monospace';
        [500,700,900,1100].forEach(mz=>{ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(mz,tx(mz),H-PAD.b+4);});
        [0.6,0.8,1.0,1.2,1.4].forEach(k0=>{ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(k0.toFixed(1),PAD.l-5,ty(k0));});
        ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('m/z',W/2,H);
        ctx.save();ctx.translate(11,H/2);ctx.rotate(-Math.PI/2);ctx.textBaseline='middle';ctx.fillText('1/K₀',0,0);ctx.restore();

        // Legend
        pathways.forEach((pw,i)=>{
          const col=_SC_PW_COL[pw]||_SC.muted;
          ctx.fillStyle=col+'cc';ctx.beginPath();ctx.arc(PAD.l+8,PAD.t+12+i*15,4,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#e0d0f0';ctx.font='8.5px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
          ctx.fillText(pw,PAD.l+16,PAD.t+12+i*15);
        });

        // Title
        ctx.fillStyle='#e8d8ff';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
        ctx.fillText('K562 Surfaceome Atlas · m/z × 1/K₀ · CCS corridors',W/2,4);
      },[ions,runs,selId,hovered,selected]);

      // Hit detection helpers
      const findNearest = useCallback((e)=>{
        const cv=canvasRef.current; if(!cv) return null;
        const rect=cv.getBoundingClientRect();
        const px=e.clientX-rect.left, py=e.clientY-rect.top;
        let best=null, bestD=Infinity;
        markerPts.current.forEach(pt=>{
          const d=Math.hypot(px-pt.mx, py-pt.my);
          if(d<pt.r && d<bestD){ bestD=d; best=pt; }
        });
        return best;
      },[]);

      const handleMouseMove = useCallback((e)=>{
        const pt=findNearest(e);
        setHovered(pt?pt.name:null);
        canvasRef.current.style.cursor=pt?'pointer':'default';
      },[findNearest]);

      const handleClick = useCallback((e)=>{
        const pt=findNearest(e);
        if(!pt){ setSelected(null); return; }
        setSelected(s=>s&&s[0]===pt.name?null:pt.marker);
      },[findNearest]);

      const handleLeave = useCallback(()=>{ setHovered(null); },[]);

      const sortedRuns=runs.filter(r=>r.n_proteins).sort((a,b)=>a.inputPg-b.inputPg);

      // Detail panel for selected marker
      const detailPanel = selected && React.createElement('div',{
        style:{background:_SC.surface,border:`1.5px solid ${_SC_PW_COL[selected[4]]||_SC.border}`,
          borderRadius:10,padding:'14px 18px',display:'flex',gap:20,alignItems:'flex-start',
          boxShadow:`0 0 24px ${(_SC_PW_COL[selected[4]]||'#888')+'44'}`}},
        // Left — identity block
        React.createElement('div',{style:{flex:'0 0 auto',minWidth:120}},
          React.createElement('div',{style:{fontSize:22,fontWeight:700,color:_SC_PW_COL[selected[4]]||_SC.text,
            letterSpacing:1,textShadow:`0 0 12px ${_SC_PW_COL[selected[4]]||'#fff'}`}},selected[0]),
          React.createElement('div',{style:{fontSize:11,color:_SC.muted,marginTop:2}},selected[6]),
          React.createElement('span',{style:{display:'inline-block',marginTop:6,padding:'2px 8px',
            borderRadius:12,fontSize:10,fontWeight:600,letterSpacing:0.5,
            background:(_SC_PW_COL[selected[4]]||_SC.border)+'33',
            color:_SC_PW_COL[selected[4]]||_SC.muted}},selected[4]),
          React.createElement('div',{style:{marginTop:10,fontSize:10,color:_SC.muted}},
            React.createElement('div',null,`m/z  ${selected[1]}`),
            React.createElement('div',null,`1/K₀  ${selected[2].toFixed(2)}`),
          ),
          React.createElement('a',{
            href:`https://www.uniprot.org/uniprot/${selected[5]}`,
            target:'_blank',rel:'noopener noreferrer',
            style:{display:'block',marginTop:8,fontSize:10,color:_SC.cyan,textDecoration:'underline'}},
            `UniProt: ${selected[5]}`),
        ),
        // Right — name + description
        React.createElement('div',{style:{flex:1}},
          React.createElement('div',{style:{fontSize:13,fontWeight:600,color:_SC.text,marginBottom:6}},selected[7]),
          React.createElement('div',{style:{fontSize:12,color:_SC.muted,lineHeight:1.6}},selected[8]),
        ),
        // Close button
        React.createElement('button',{onClick:()=>setSelected(null),
          style:{background:'none',border:'none',color:_SC.muted,fontSize:16,cursor:'pointer',
            padding:'0 0 0 8px',alignSelf:'flex-start',lineHeight:1}},'✕'),
      );

      return React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:8}},
        React.createElement('div',{style:{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}},
          React.createElement('span',{style:{color:_SC.muted,fontSize:11}},'Ion background:'),
          ...sortedRuns.map(r=>
            React.createElement('button',{key:r.id,onClick:()=>setSelId(r.id),
              style:{padding:'3px 10px',borderRadius:4,fontSize:11,cursor:'pointer',
                background:selId===r.id?_SC.purple:_SC.surface,
                color:selId===r.id?'#fff':_SC.muted,
                border:`1px solid ${selId===r.id?_SC.purple:_SC.border}`}
            },_scFmtAmt(r.inputPg))
          ),
          React.createElement('span',{style:{color:_SC.muted,fontSize:10,marginLeft:8}},
            'Click a marker label to explore'),
        ),
        React.createElement('canvas',{ref:canvasRef,
          onMouseMove:handleMouseMove, onClick:handleClick, onMouseLeave:handleLeave,
          style:{width:'100%',height:450,display:'block',borderRadius:8,
            border:`1px solid ${_SC.border}`,cursor:'default'}}),
        detailPanel,
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 6 — QUALITY RADAR  (real data, animated canvas spider chart)
    // ═══════════════════════════════════════════════════════════════════════════
    function SCDepthRadar({ runs }) {
      const canvasRef = useRef(null);
      const animRef   = useRef(null);

      const withData = useMemo(()=>
        runs.filter(r=>r.n_proteins&&r.inputPg&&r.n_precursors)
            .sort((a,b)=>a.inputPg-b.inputPg),
      [runs]);

      useEffect(()=>{
        if(!canvasRef.current||!withData.length) return;
        const cv=canvasRef.current;
        const dpr=window.devicePixelRatio||1;
        cv.width=cv.offsetWidth*dpr; cv.height=cv.offsetHeight*dpr;
        const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
        const W=cv.offsetWidth, H=cv.offsetHeight;

        const AXES=[
          {label:'Proteins',        key:'n_proteins'},
          {label:'Precursors',      key:'n_precursors'},
          {label:'z=2 %',           key:'pct_charge_2', scale:100},
          {label:'Peak Width⁻¹',    key:'median_peak_width_sec', invert:true},
          {label:'Points / Peak',   key:'median_points_across_peak'},
        ];
        const N=AXES.length;
        const maxVals=AXES.map(ax=>Math.max(...withData.map(r=>((r[ax.key]||0)*(ax.scale||1)))));
        const norm=(val,ai)=>{
          if(!maxVals[ai]) return 0;
          const v=(val||0)*(AXES[ai].scale||1)/maxVals[ai];
          return AXES[ai].invert?Math.max(0,1-v*0.5):v;
        };

        const cx=W/2, cy=H/2, R=Math.min(W,H)*0.36;
        const ang=i=>-Math.PI/2+i*Math.PI*2/N;
        const COLORS=[_SC.gold,_SC.orange,_SC.violet,_SC.cyan,_SC.green,_SC.indigo];

        let t=0;
        const draw=()=>{
          ctx.clearRect(0,0,W,H);
          ctx.fillStyle=_SC.bg; ctx.fillRect(0,0,W,H);

          // Rings
          [0.25,0.5,0.75,1].forEach(f=>{
            ctx.beginPath();
            AXES.forEach((_,i)=>{
              const a=ang(i);
              const x=cx+Math.cos(a)*R*f, y=cy+Math.sin(a)*R*f;
              i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
            });
            ctx.closePath();
            ctx.strokeStyle=`rgba(61,16,96,${0.3+f*0.25})`;
            ctx.lineWidth=0.6+f*0.3; ctx.stroke();
            if(f<1){ctx.fillStyle='rgba(61,16,96,0.06)';ctx.fill();}
          });

          // Spokes + labels
          AXES.forEach((ax,i)=>{
            const a=ang(i);
            const ex=cx+Math.cos(a)*R, ey=cy+Math.sin(a)*R;
            ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ex,ey);
            ctx.strokeStyle='rgba(180,153,212,0.2)';ctx.lineWidth=0.5;ctx.stroke();
            const lx=cx+Math.cos(a)*(R+20), ly=cy+Math.sin(a)*(R+20);
            ctx.fillStyle=_SC.muted;ctx.font='10px sans-serif';
            ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ax.label,lx,ly);
          });

          // Run polygons
          withData.forEach((run,ri)=>{
            const col=COLORS[ri%COLORS.length];
            const pulse=0.88+Math.sin(t+ri*0.8)*0.12;
            ctx.beginPath();
            AXES.forEach((ax,i)=>{
              const a=ang(i), v=norm(run[ax.key],i)*pulse;
              const x=cx+Math.cos(a)*R*v, y=cy+Math.sin(a)*R*v;
              i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
            });
            ctx.closePath();
            ctx.fillStyle=col+'25'; ctx.fill();
            ctx.strokeStyle=col+'aa'; ctx.lineWidth=1.8; ctx.stroke();
          });

          // Legend
          withData.forEach((run,ri)=>{
            const col=COLORS[ri%COLORS.length];
            ctx.fillStyle=col;ctx.beginPath();ctx.arc(16,16+ri*17,4.5,0,Math.PI*2);ctx.fill();
            ctx.fillStyle=col;ctx.font='9.5px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
            ctx.fillText(_scFmtAmt(run.inputPg),26,16+ri*17);
          });

          ctx.fillStyle=_SC.text;ctx.font='bold 12px sans-serif';
          ctx.textAlign='center';ctx.textBaseline='top';
          ctx.fillText('Quality Radar · Multi-Metric Comparison Across Dilutions',W/2,4);

          t+=0.012;
          animRef.current=requestAnimationFrame(draw);
        };
        animRef.current=requestAnimationFrame(draw);
        return()=>cancelAnimationFrame(animRef.current);
      },[withData]);

      return React.createElement('canvas',{ref:canvasRef,
        style:{width:'100%',height:430,display:'block',borderRadius:8,border:`1px solid ${_SC.border}`}});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Panel 7 — 3D CELL GLOBE
    // Plotly scatter3d + surface · proteins placed in biological compartments
    // Dilution buttons illuminate compartments progressively as depth increases
    // ═══════════════════════════════════════════════════════════════════════════

    function _scMakeSphere(cx, cy, cz, R, steps) {
      const xs=[], ys=[], zs=[];
      for (let i=0; i<=steps; i++) {
        const phi = Math.PI * i / steps;
        xs.push([]); ys.push([]); zs.push([]);
        for (let j=0; j<=steps; j++) {
          const theta = 2*Math.PI * j / steps;
          xs[i].push(cx + R*Math.sin(phi)*Math.cos(theta));
          ys[i].push(cy + R*Math.sin(phi)*Math.sin(theta));
          zs[i].push(cz + R*Math.cos(phi));
        }
      }
      return {x:xs, y:ys, z:zs};
    }

    function _scDetectFrac(inputPg, threshPg, fullPg) {
      if (!inputPg || inputPg <= 0) return 0;
      const t = (Math.log10(Math.max(inputPg, 0.01)) - Math.log10(threshPg)) /
                (Math.log10(fullPg) - Math.log10(threshPg));
      return Math.max(0, Math.min(1, t));
    }

    const _SC_COMPS = [
      { id:'cyto',  name:'Cytoplasm',        color:'#a855f7', rMin:0.40, rMax:0.84, n:130, detect:{t:2,   f:200},
        proteins:['ACTB','TUBA1B','HSP90AA1','UBB','PKM','GAPDH','ENO1','LDHA','PGK1','YWHAZ','CFL1','VIM','MYH9','HSPB1'] },
      { id:'er',    name:'ER / Ribosome',    color:'#d946ef', rMin:0.38, rMax:0.58, n:70,  detect:{t:4,   f:400},
        proteins:['HSPA5','CANX','P4HB','RPS3','RPL7','RPSA','EEF2','EEF1A1','CALR','RPN1','SEC61B','HSP47','DNAJB11'] },
      { id:'mito',  name:'Mitochondria',     color:'#f97316', rMin:0,    rMax:0,    n:60,  detect:{t:3,   f:300}, isMito:true,
        proteins:['VDAC1','VDAC2','TOM20','SDHA','UQCRC1','ATP5A1','CYCS','SOD2','MFN1','PINK1','OPA1','TOMM40'] },
      { id:'nuc',   name:'Nucleus',          color:'#DAAA00', rMin:0.0,  rMax:0.28, n:100, detect:{t:10,  f:1000},
        proteins:['BCR','ABL1','GATA1','MYC','TP53','PCNA','H3.1','H2A','NF-κB','MYB','RUNX1','NPM1','FUS','HNRNPA1'] },
      { id:'nenv',  name:'Nuclear Envelope', color:'#818cf8', rMin:0.28, rMax:0.38, n:30,  detect:{t:30,  f:3000},
        proteins:['LMNA','LMNB1','NUP98','NUP88','NUP153','EMD','SUN1','SUN2','TPR','NUP214'] },
      { id:'memb',  name:'Plasma Membrane',  color:'#22d3ee', rMin:0.88, rMax:1.0,  n:80,  detect:{t:50,  f:8000},
        proteins:['CD44','CD45','CD47','CD71','CD34','HLA-A','HLA-B','β2M','CD33','CD13','CD29','ITGAV','CD117','CD43'] },
    ];

    const _SC_MITO_CENTERS = [
      [ 0.55,  0.20,  0.35], [-0.40,  0.55,  0.20], [ 0.25, -0.55,  0.40],
      [-0.35, -0.30,  0.55], [ 0.50,  0.45, -0.30], [-0.50,  0.15, -0.45],
    ];

    function SCCellGlobe({ runs }) {
      const ref        = useRef(null);
      const animRef    = useRef(null);
      const angleRef   = useRef(0);
      const [rotating,    setRotating]    = useState(true);
      const [selPg,       setSelPg]       = useState(null);
      const [selComp,     setSelComp]     = useState(null);   // compartment isolation
      const [xray,        setXray]        = useState(false);  // membrane transparency
      const [selProtein,  setSelProtein]  = useState(null);   // clicked protein

      const levels = useMemo(()=>
        [...runs].filter(r=>r.n_proteins&&r.inputPg).sort((a,b)=>a.inputPg-b.inputPg),
      [runs]);

      useEffect(()=>{
        if (levels.length && !selPg) setSelPg(levels[levels.length-1].inputPg);
      }, [levels.length]);

      const traces = useMemo(()=>{
        const out = [];

        // Cell membrane surface
        const cell = _scMakeSphere(0,0,0,1.0,20);
        out.push({
          type:'surface', ...cell, name:'Cell Membrane', showlegend:false,
          colorscale:[[0,'rgba(34,211,238,0.02)'],[1,'rgba(34,211,238,0.07)']],
          showscale:false, opacity: xray ? 0.03 : 0.16, hoverinfo:'skip',
          lighting:{ambient:1.0,diffuse:0.0,specular:0.0,fresnel:0.0},
          contours:{x:{show:false},y:{show:false},z:{show:false}},
        });

        // Nucleus surface
        const nuc = _scMakeSphere(0,0,0,0.30,14);
        out.push({
          type:'surface', ...nuc, name:'Nucleus shell', showlegend:false,
          colorscale:[[0,'rgba(218,170,0,0.04)'],[1,'rgba(218,170,0,0.18)']],
          showscale:false, opacity:0.38, hoverinfo:'skip',
          lighting:{ambient:1.0,diffuse:0.0,specular:0.0,fresnel:0.0},
          contours:{x:{show:false},y:{show:false},z:{show:false}},
        });

        const visComps = selComp ? _SC_COMPS.filter(c=>c.id===selComp) : _SC_COMPS;
        visComps.forEach(comp=>{
          const frac   = _scDetectFrac(selPg, comp.detect.t, comp.detect.f);
          const nDet   = Math.round(comp.n * frac);
          const nGhost = comp.n - nDet;
          const seed   = comp.id.split('').reduce((a,c)=>a+c.charCodeAt(0), 0);
          const rand   = _scRand(seed);
          const allX=[], allY=[], allZ=[], allText=[];

          for (let i=0; i<comp.n; i++) {
            let x, y, z;
            if (comp.isMito) {
              const mc = _SC_MITO_CENTERS[i % _SC_MITO_CENTERS.length];
              x = mc[0]+rand.rN()*0.065; y = mc[1]+rand.rN()*0.038; z = mc[2]+rand.rN()*0.038;
            } else {
              const r=comp.rMin+rand.r()*(comp.rMax-comp.rMin);
              const phi=Math.acos(2*rand.r()-1), theta=rand.r()*2*Math.PI;
              x=r*Math.sin(phi)*Math.cos(theta); y=r*Math.sin(phi)*Math.sin(theta); z=r*Math.cos(phi);
            }
            allX.push(x); allY.push(y); allZ.push(z);
            allText.push(comp.proteins[i % comp.proteins.length]);
          }

          if (nDet > 0) out.push({
            type:'scatter3d', mode:'markers', name:comp.name,
            x:allX.slice(0,nDet), y:allY.slice(0,nDet), z:allZ.slice(0,nDet),
            text:allText.slice(0,nDet),
            marker:{ size:comp.id==='memb'?4:comp.id==='nuc'?3:2.5, color:comp.color, opacity:0.88, line:{width:0} },
            hovertemplate:`<b>%{text}</b><br>${comp.name}<extra></extra>`,
          });

          if (nGhost > 0) out.push({
            type:'scatter3d', mode:'markers', name:comp.name+' (ghost)', showlegend:false,
            x:allX.slice(nDet), y:allY.slice(nDet), z:allZ.slice(nDet),
            marker:{ size:1.0, color:'#2a0848', opacity:0.25, line:{width:0} }, hoverinfo:'skip',
          });
        });

        return out;
      }, [selPg, selComp, xray]);

      // Render chart + attach click handler
      useEffect(()=>{
        if (!ref.current || !window.Plotly) return;
        const selRun = levels.find(r=>r.inputPg===selPg);
        window.Plotly.react(ref.current, traces, {
          paper_bgcolor: _SC.bg,
          scene:{
            bgcolor: _SC.bg,
            xaxis:{visible:false, range:[-1.3,1.3]},
            yaxis:{visible:false, range:[-1.3,1.3]},
            zaxis:{visible:false, range:[-1.3,1.3]},
            aspectmode:'cube',
            camera:{eye:{x:2.2,y:0.6,z:0.9}, up:{x:0,y:0,z:1}},
          },
          margin:{l:0,r:0,t:36,b:0},
          title:{
            text: selComp
              ? `${_SC_COMPS.find(c=>c.id===selComp)?.name} · isolated view`
              : `K562 Proteome Globe · ${selPg?_scFmtAmt(selPg)+' · '+(selRun?.n_proteins||'?').toLocaleString()+' proteins':'loading…'}`,
            font:{color:_SC.text,size:12}, x:0.5,
          },
          legend:{font:{color:_SC.text,size:9},bgcolor:'rgba(14,0,24,0.88)',
            bordercolor:_SC.border,borderwidth:1,x:0.01,y:0.99,xanchor:'left',yanchor:'top'},
          showlegend:true,
        }, {responsive:true, displayModeBar:false});

        // Click handler
        try { ref.current.removeAllListeners('plotly_click'); } catch(e){}
        ref.current.on('plotly_click', data=>{
          if(!data?.points?.length) return;
          const pt=data.points[0];
          const name=Array.isArray(pt.data.text)?pt.data.text[pt.pointNumber]:pt.data.text;
          if(name) setSelProtein({name, comp:pt.data.name});
        });
      }, [traces, selPg, selComp]);

      // Camera rotation
      useEffect(()=>{
        if (!rotating || !ref.current) return;
        const step = ()=>{
          angleRef.current += 0.004;
          const a = angleRef.current;
          window.Plotly.relayout(ref.current, {
            'scene.camera':{ eye:{x:2.2*Math.cos(a), y:2.2*Math.sin(a), z:0.9}, up:{x:0,y:0,z:1} },
          }).catch(()=>{});
          animRef.current = requestAnimationFrame(step);
        };
        animRef.current = requestAnimationFrame(step);
        return ()=>cancelAnimationFrame(animRef.current);
      }, [rotating]);

      useEffect(()=>()=>{
        cancelAnimationFrame(animRef.current);
        if(ref.current&&window.Plotly) window.Plotly.purge(ref.current);
      }, []);

      return React.createElement('div', {style:{display:'flex',flexDirection:'column',gap:10}},

        // Controls row
        React.createElement('div', {style:{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}},
          React.createElement('button', {onClick:()=>setRotating(r=>!r),
            style:{padding:'4px 12px',borderRadius:6,fontSize:11,cursor:'pointer',
              background:rotating?_SC.violet:_SC.surface, color:rotating?'#fff':_SC.muted,
              border:`1px solid ${rotating?_SC.violet:_SC.border}`}},
            rotating?'⏸ Pause':'▶ Rotate'),
          React.createElement('button', {onClick:()=>setXray(x=>!x),
            style:{padding:'4px 12px',borderRadius:6,fontSize:11,cursor:'pointer',
              background:xray?_SC.cyan:_SC.surface, color:xray?'#000':_SC.muted,
              border:`1px solid ${xray?_SC.cyan:_SC.border}`}},
            xray?'◉ X-Ray ON':'◎ X-Ray'),
          React.createElement('span',{style:{color:_SC.muted,fontSize:10,margin:'0 4px'}},'|'),
          React.createElement('span',{style:{color:_SC.muted,fontSize:10}},'Isolate:'),
          React.createElement('button',{onClick:()=>setSelComp(null),
            style:{padding:'3px 8px',borderRadius:4,fontSize:10,cursor:'pointer',
              background:!selComp?_SC.surface:'transparent',
              color:!selComp?_SC.text:_SC.muted,
              border:`1px solid ${!selComp?_SC.border:'#2a1040'}`}},'All'),
          ..._SC_COMPS.map(c=>React.createElement('button',{key:c.id,onClick:()=>setSelComp(s=>s===c.id?null:c.id),
            style:{padding:'3px 8px',borderRadius:4,fontSize:10,cursor:'pointer',
              background:selComp===c.id?c.color+'22':'transparent',
              color:selComp===c.id?c.color:_SC.muted,
              border:`1px solid ${selComp===c.id?c.color:'#2a1040'}`}},c.name)),
          React.createElement('span',{style:{color:_SC.muted,fontSize:10,margin:'0 4px'}},'|'),
          React.createElement('span',{style:{color:_SC.muted,fontSize:10}},'Depth:'),
          ...levels.map(r=>React.createElement('button',{key:r.id,onClick:()=>setSelPg(r.inputPg),
            style:{padding:'3px 8px',borderRadius:4,fontSize:10,cursor:'pointer',
              background:selPg===r.inputPg?_SC.cyan:_SC.surface,
              color:selPg===r.inputPg?'#000':_SC.muted,
              border:`1px solid ${selPg===r.inputPg?_SC.cyan:_SC.border}`}},_scFmtAmt(r.inputPg))),
        ),

        // Protein click panel
        selProtein && React.createElement('div',{style:{
          padding:'8px 14px',borderRadius:8,display:'flex',gap:14,alignItems:'center',
          background:_SC.surface,border:`1px solid ${_SC_COMPS.find(c=>c.name===selProtein.comp)?.color||_SC.border}`,
          boxShadow:`0 0 16px ${(_SC_COMPS.find(c=>c.name===selProtein.comp)?.color||'#888')}33`}},
          React.createElement('span',{style:{fontSize:18,fontWeight:800,
            color:_SC_COMPS.find(c=>c.name===selProtein.comp)?.color||_SC.cyan,
            textShadow:`0 0 10px currentColor`}},selProtein.name),
          React.createElement('span',{style:{fontSize:11,color:_SC.muted}},'in'),
          React.createElement('span',{style:{fontSize:12,color:_SC.text,fontWeight:600}},selProtein.comp),
          React.createElement('button',{onClick:()=>setSelProtein(null),
            style:{marginLeft:'auto',background:'none',border:'none',color:_SC.muted,cursor:'pointer',fontSize:14}},'✕'),
        ),

        // 3D globe
        React.createElement('div', {ref,
          style:{height:500,borderRadius:8,border:`1px solid ${_SC.border}`,overflow:'hidden'}}),

        // Compartment detection grid
        React.createElement('div', {style:{
          display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:5,marginTop:2}},
          _SC_COMPS.map(comp=>{
            const pct = Math.round(_scDetectFrac(selPg, comp.detect.t, comp.detect.f)*100);
            const isIso = selComp===comp.id;
            return React.createElement('div', {key:comp.id,
              onClick:()=>setSelComp(s=>s===comp.id?null:comp.id),
              style:{padding:'7px 10px',borderRadius:6,cursor:'pointer',userSelect:'none',
                background:isIso?comp.color+'20':comp.color+'10',
                border:`1px solid ${pct>0?(isIso?comp.color:comp.color+'44'):'#2a1040'}`,
                transition:'all 0.15s'}},
              React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}},
                React.createElement('span',{style:{color:pct>0?comp.color:'#4a2060',fontSize:10,fontWeight:700}},comp.name),
                React.createElement('span',{style:{color:pct>0?comp.color:'#4a2060',fontSize:12,fontWeight:800}},`${pct}%`),
              ),
              React.createElement('div',{style:{height:3,borderRadius:2,background:'#2a0848',overflow:'hidden',marginBottom:3}},
                React.createElement('div',{style:{height:'100%',width:`${pct}%`,
                  background:`linear-gradient(90deg,${comp.color}88,${comp.color})`,transition:'width 0.5s'}}),
              ),
              React.createElement('div',{style:{fontSize:9,color:'#6a3880'}},
                pct===0?`Detects at ~${_scFmtAmt(comp.detect.t)}+`:
                pct===100?'Fully sampled':`${Math.round(comp.n*pct/100)} / ${comp.n} detected`),
            );
          })
        ),
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROTEOME ORIGIN — Big Bang: proteins emerge from the nuclear singularity
    // ═══════════════════════════════════════════════════════════════════════════
    function SCProteomeBigBang({ runs }) {
      const canvasRef = useRef(null);
      const animRef   = useRef(null);
      const phRef     = useRef(0);
      const playRef   = useRef(true);
      const [playing, setPlaying] = useState(true);
      const [selPg,   setSelPg]   = useState(null);

      const levels = useMemo(()=>
        [...runs].filter(r=>r.n_proteins&&r.inputPg).sort((a,b)=>a.inputPg-b.inputPg),
      [runs]);
      useEffect(()=>{ if(levels.length&&!selPg) setSelPg(levels[levels.length-1].inputPg); },[levels.length]);
      useEffect(()=>{ playRef.current=playing; },[playing]);

      // Background stars — static
      const bgStars = useMemo(()=>{
        const rng=_scRand(9999);
        return Array.from({length:380},()=>({
          rx:rng.r(),ry:rng.r(),r:rng.r()*1.5+0.2,
          alpha:rng.r()*0.5+0.07,freq:rng.r()*1.5+0.4,ph:rng.r()*Math.PI*2,
        }));
      },[]);

      // Pre-compute particle final positions (virtual offsets from center, in px at 800-wide canvas)
      const particles = useMemo(()=>{
        if(!selPg) return [];
        const pts=[];
        _SC_COMPS.forEach(comp=>{
          const frac=_scDetectFrac(selPg,comp.detect.t,comp.detect.f);
          const nDet=Math.round(comp.n*frac);
          const seed=comp.id.split('').reduce((s,c)=>s+c.charCodeAt(0),0);
          const rand=_scRand(seed);
          for(let i=0;i<comp.n;i++){
            let dx=0,dy=0;
            if(comp.id==='nuc'){
              const r=rand.r()*58,a=rand.r()*Math.PI*2; dx=r*Math.cos(a); dy=r*Math.sin(a);
            } else if(comp.id==='nenv'){
              const r=68+rand.rN()*5,a=rand.r()*Math.PI*2; dx=r*Math.cos(a); dy=r*Math.sin(a);
            } else if(comp.id==='er'){
              const r=rand.r()*72,a=rand.r()*Math.PI*2;
              dx=82+r*Math.cos(a); dy=-58+r*Math.sin(a)*0.75;
            } else if(comp.id==='cyto'){
              const r=85+rand.r()*118,a=rand.r()*Math.PI*2; dx=r*Math.cos(a); dy=r*Math.sin(a)*0.80;
            } else if(comp.id==='mito'){
              const mc=_SC_MITO_CENTERS[i%_SC_MITO_CENTERS.length];
              dx=mc[0]*192+rand.rN()*15; dy=mc[1]*192+rand.rN()*15;
            } else { // memb
              const r=222+rand.rN()*7,a=rand.r()*Math.PI*2; dx=r*Math.cos(a); dy=r*Math.sin(a)*0.74;
            }
            pts.push({dx,dy,comp,detected:i<nDet,
              protein:comp.proteins[i%comp.proteins.length],
              delay:rand.r()*0.28, bAng:rand.r()*Math.PI*2});
          }
        });
        return pts;
      },[selPg]);

      useEffect(()=>{
        if(!canvasRef.current||!particles.length) return;
        const cv=canvasRef.current;
        const dpr=window.devicePixelRatio||1;
        cv.width=cv.offsetWidth*dpr; cv.height=cv.offsetHeight*dpr;
        const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
        const W=cv.offsetWidth, H=cv.offsetHeight;
        const cx=W/2, cy=H/2, SC=W/800;
        const CYCLE=6000;
        let last=null;
        const eo=t=>1-(1-t)**3;

        const frame=(ts)=>{
          if(!last) last=ts;
          const dt=ts-last; last=ts;
          if(playRef.current) phRef.current=(phRef.current+dt/CYCLE)%1;
          // Breathing expansion: 0→1→0
          const ph=phRef.current;
          const expansion=0.5-0.5*Math.cos(ph*Math.PI*2);
          const eExp=eo(expansion);

          ctx.clearRect(0,0,W,H);
          // Deep space background
          ctx.fillStyle='#01000c'; ctx.fillRect(0,0,W,H);

          // Background stars
          bgStars.forEach(s=>{
            const tw=0.5+0.5*Math.sin(ts*0.001*s.freq+s.ph);
            ctx.fillStyle=`rgba(210,195,255,${s.alpha*tw})`;
            ctx.beginPath(); ctx.arc(s.rx*W,s.ry*H,s.r,0,Math.PI*2); ctx.fill();
          });

          // Nebula clouds (build as expansion increases)
          const nbA=Math.min(1,expansion*2.5);
          if(nbA>0.05){
            _SC_COMPS.forEach(comp=>{
              const frac=_scDetectFrac(selPg,comp.detect.t,comp.detect.f);
              if(!frac) return;
              let sx=0,sy=0,cnt=0;
              particles.forEach(p=>{ if(p.comp.id===comp.id&&p.detected){sx+=p.dx;sy+=p.dy;cnt++;} });
              if(!cnt) return;
              const gx=cx+(sx/cnt)*SC*eExp, gy=cy+(sy/cnt)*SC*eExp;
              const nr=(comp.id==='cyto'?160:comp.id==='memb'?85:58)*SC;
              const g=ctx.createRadialGradient(gx,gy,0,gx,gy,nr);
              g.addColorStop(0,comp.color+'28'); g.addColorStop(0.55,comp.color+'0e'); g.addColorStop(1,'transparent');
              ctx.globalAlpha=nbA*Math.min(1,frac*2); ctx.fillStyle=g;
              ctx.beginPath(); ctx.arc(gx,gy,nr,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
            });
          }

          // Singularity core glow (brightest when expansion=0)
          const singA=Math.max(0,(1-expansion*3.5));
          if(singA>0.01){
            const sg=ctx.createRadialGradient(cx,cy,0,cx,cy,90*SC);
            sg.addColorStop(0,`rgba(255,255,200,${singA*0.95})`);
            sg.addColorStop(0.18,`rgba(255,50,255,${singA*0.75})`);
            sg.addColorStop(0.55,`rgba(60,0,200,${singA*0.3})`);
            sg.addColorStop(1,'transparent');
            ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(cx,cy,90*SC,0,Math.PI*2); ctx.fill();
            ctx.fillStyle=`rgba(255,255,255,${singA})`;
            ctx.beginPath(); ctx.arc(cx,cy,5*SC*singA,0,Math.PI*2); ctx.fill();
          }

          // Particles
          particles.forEach(p=>{
            const t0=p.delay;
            const t=Math.max(0,(expansion-t0)/(1-t0));
            if(t<=0.001) return;
            const e=eo(Math.min(t,1));
            // Slight arc outward then back (transverse to radial direction)
            const arcAmt=Math.sin(expansion*Math.PI)*0.35;
            const px=cx+(p.dx*SC*e)+(Math.cos(p.bAng)*50*SC*arcAmt);
            const py=cy+(p.dy*SC*e)+(Math.sin(p.bAng)*50*SC*arcAmt);
            const col=p.detected?p.comp.color:'#2a0848';
            const alpha=p.detected?0.88:0.18;
            const sz=p.detected?(p.comp.id==='memb'?2.6:p.comp.id==='nuc'?2.2:1.7):0.9;
            // Trail
            if(t<0.95&&e>0.03){
              const pt0=Math.max(0,t-0.07);
              const pe=eo(Math.min(pt0,1));
              const arcP=Math.sin(expansion*Math.PI)*0.35*(pt0/Math.max(t,0.001));
              const ppx=cx+(p.dx*SC*pe)+(Math.cos(p.bAng)*50*SC*arcP);
              const ppy=cy+(p.dy*SC*pe)+(Math.sin(p.bAng)*50*SC*arcP);
              ctx.strokeStyle=col+'55'; ctx.lineWidth=0.8;
              ctx.beginPath(); ctx.moveTo(ppx,ppy); ctx.lineTo(px,py); ctx.stroke();
            }
            // Glow
            if(p.detected&&e>0.4){
              const gr=ctx.createRadialGradient(px,py,0,px,py,sz*4.5);
              gr.addColorStop(0,col+'77'); gr.addColorStop(1,'transparent');
              ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(px,py,sz*4.5,0,Math.PI*2); ctx.fill();
            }
            ctx.fillStyle=col; ctx.globalAlpha=alpha;
            ctx.beginPath(); ctx.arc(px,py,sz,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
          });

          // Status text
          ctx.fillStyle='rgba(170,130,210,0.45)'; ctx.font='bold 10px monospace';
          ctx.textAlign='center'; ctx.textBaseline='bottom';
          const visN=particles.filter(p=>{const t=(expansion-p.delay)/(1-p.delay);return t>0;}).length;
          const detN=particles.filter(p=>p.detected).length;
          ctx.fillText(
            `PROTEOME ORIGIN STORY · ${selPg?_scFmtAmt(selPg)+' input · ':''}${visN}/${detN} proteins materialized · expansion ${(expansion*100).toFixed(0)}%`,
            cx, H-6);

          animRef.current=requestAnimationFrame(frame);
        };
        animRef.current=requestAnimationFrame(frame);
        return()=>cancelAnimationFrame(animRef.current);
      },[particles,bgStars,selPg]);

      return React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:8}},
        React.createElement('div',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}},
          React.createElement('button',{onClick:()=>setPlaying(p=>!p),
            style:{padding:'4px 14px',borderRadius:6,fontSize:11,cursor:'pointer',
              background:playing?_SC.rose:_SC.surface, color:playing?'#fff':_SC.muted,
              border:`1px solid ${playing?_SC.rose:_SC.border}`}},
            playing?'⏸ Pause':'▶ Play'),
          React.createElement('span',{style:{color:_SC.muted,fontSize:10,marginLeft:4}},
            'Proteome breathes from singularity → full expansion → collapse → repeat'),
          React.createElement('span',{style:{color:_SC.muted,fontSize:11,marginLeft:8}},'Depth:'),
          ...levels.map(r=>React.createElement('button',{key:r.id,onClick:()=>setSelPg(r.inputPg),
            style:{padding:'3px 10px',borderRadius:4,fontSize:11,cursor:'pointer',
              background:selPg===r.inputPg?_SC.gold:_SC.surface,
              color:selPg===r.inputPg?'#000':_SC.muted,
              border:`1px solid ${selPg===r.inputPg?_SC.gold:_SC.border}`}},_scFmtAmt(r.inputPg))),
        ),
        React.createElement('canvas',{ref:canvasRef,
          style:{width:'100%',height:520,display:'block',borderRadius:8,border:`1px solid ${_SC.border}`}}),
        React.createElement('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:4}},
          _SC_COMPS.map(comp=>{
            const n=Math.round(comp.n*_scDetectFrac(selPg,comp.detect.t,comp.detect.f));
            return React.createElement('div',{key:comp.id,style:{
              padding:'5px 9px',borderRadius:5,display:'flex',alignItems:'center',gap:6,
              background:comp.color+'0d',border:`1px solid ${n>0?comp.color+'44':'#2a1040'}`}},
              React.createElement('div',{style:{width:7,height:7,borderRadius:'50%',
                background:n>0?comp.color:'#3a1060',flexShrink:0,
                boxShadow:n>0?`0 0 6px ${comp.color}`:'none'}}),
              React.createElement('span',{style:{fontSize:9,color:n>0?comp.color:'#5a3070',flex:1}},comp.name),
              React.createElement('span',{style:{fontSize:9,color:n>0?'#c0a0e0':'#4a2060',fontWeight:700}},n?`${n}/${comp.n}`:'—'),
            );
          })
        ),
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROTEIN COSMOS — cell as deep space nebula, proteins as stars
    // ═══════════════════════════════════════════════════════════════════════════
    const _COSMOS_NEBULAE = {
      cyto: {fx:0.50,fy:0.50,fr:0.38,diffuse:true},
      er:   {fx:0.64,fy:0.33,fr:0.13},
      mito: {clusters:true,fr:0.06},
      nenv: {fx:0.50,fy:0.50,fr:0.145,ring:true},
      nuc:  {fx:0.50,fy:0.50,fr:0.09},
      memb: {fx:0.50,fy:0.50,fr:0.445,ring:true,thin:true},
    };

    function SCProteinCosmos({ runs }) {
      const canvasRef = useRef(null);
      const animRef   = useRef(null);
      const protPts   = useRef([]);
      const shooters  = useRef([]);
      const hovRef    = useRef(null);
      const [hovered, setHovered] = useState(null);
      const [selPg,   setSelPg]   = useState(null);

      const levels = useMemo(()=>
        [...runs].filter(r=>r.n_proteins&&r.inputPg).sort((a,b)=>a.inputPg-b.inputPg),
      [runs]);
      useEffect(()=>{ if(levels.length&&!selPg) setSelPg(levels[levels.length-1].inputPg); },[levels.length]);

      // Static distant background stars
      const bgStars = useMemo(()=>{
        const rng=_scRand(31415);
        return Array.from({length:420},()=>({
          rx:rng.r(),ry:rng.r(),r:rng.r()*1.1+0.15,
          alpha:rng.r()*0.28+0.04,freq:rng.r()*2+0.5,ph:rng.r()*Math.PI*2,
        }));
      },[]);

      // Protein star positions (fractional, stable per selPg)
      const proteinStars = useMemo(()=>{
        if(!selPg) return [];
        const stars=[];
        _SC_COMPS.forEach(comp=>{
          const frac=_scDetectFrac(selPg,comp.detect.t,comp.detect.f);
          const nDet=Math.round(comp.n*frac);
          const seed=comp.id.split('').reduce((s,c)=>s+c.charCodeAt(0),0)+13;
          const rand=_scRand(seed);
          const nb=_COSMOS_NEBULAE[comp.id]; if(!nb) return;
          for(let i=0;i<comp.n;i++){
            let rx,ry;
            if(nb.clusters){
              const mc=_SC_MITO_CENTERS[i%_SC_MITO_CENTERS.length];
              rx=0.50+mc[0]*nb.fr*2+rand.rN()*nb.fr*0.45;
              ry=0.50+mc[1]*nb.fr*2+rand.rN()*nb.fr*0.45;
            } else if(nb.ring){
              const a=rand.r()*Math.PI*2;
              const rr=nb.fr+(nb.thin?rand.rN()*0.008:rand.rN()*nb.fr*0.07);
              rx=nb.fx+rr*Math.cos(a); ry=nb.fy+rr*Math.sin(a)*0.77;
            } else if(nb.diffuse){
              const a=rand.r()*Math.PI*2, r=rand.r()*nb.fr;
              rx=nb.fx+r*Math.cos(a); ry=nb.fy+r*Math.sin(a)*0.78;
            } else {
              const a=rand.r()*Math.PI*2, r=rand.r()*nb.fr;
              rx=nb.fx+r*Math.cos(a); ry=nb.fy+r*Math.sin(a);
            }
            stars.push({rx,ry,comp,detected:i<nDet,
              protein:comp.proteins[i%comp.proteins.length],
              sz:rand.r()*2.0+0.7,freq:rand.r()*2.5+0.5,ph0:rand.r()*Math.PI*2});
          }
        });
        return stars;
      },[selPg]);

      useEffect(()=>{
        if(!canvasRef.current||!proteinStars.length) return;
        const cv=canvasRef.current;
        const dpr=window.devicePixelRatio||1;
        cv.width=cv.offsetWidth*dpr; cv.height=cv.offsetHeight*dpr;
        const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
        const W=cv.offsetWidth, H=cv.offsetHeight;
        let lastShoot=0;

        const hexAlpha=(n)=>Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0');

        const frame=(ts)=>{
          ctx.clearRect(0,0,W,H);
          ctx.fillStyle='#000008'; ctx.fillRect(0,0,W,H);

          // Dim background stars
          bgStars.forEach(s=>{
            const tw=0.4+0.6*Math.sin(ts*0.001*s.freq+s.ph);
            ctx.fillStyle=`rgba(200,185,255,${s.alpha*tw})`;
            ctx.beginPath(); ctx.arc(s.rx*W,s.ry*H,s.r,0,Math.PI*2); ctx.fill();
          });

          // Nebula clouds per compartment
          _SC_COMPS.forEach(comp=>{
            const frac=_scDetectFrac(selPg,comp.detect.t,comp.detect.f); if(!frac) return;
            const nb=_COSMOS_NEBULAE[comp.id]; if(!nb) return;
            if(nb.ring){
              const cx2=nb.fx*W, cy2=nb.fy*H;
              const r=nb.fr*Math.min(W,H);
              const bw=nb.thin?0.018*Math.min(W,H):0.055*Math.min(W,H);
              [-bw,0,bw].forEach(dr=>{
                const g=ctx.createRadialGradient(cx2,cy2,Math.max(0,r+dr-3),cx2,cy2,r+dr+3);
                g.addColorStop(0,'transparent');
                g.addColorStop(0.5,comp.color+hexAlpha(32*frac));
                g.addColorStop(1,'transparent');
                ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx2,cy2,r+dr+4,0,Math.PI*2);
                const inner=r+dr-4; if(inner>0) ctx.arc(cx2,cy2,inner,0,Math.PI*2,true);
                ctx.fill();
              });
            } else if(nb.clusters){
              _SC_MITO_CENTERS.forEach(mc=>{
                const gx=(0.50+mc[0]*nb.fr*2)*W, gy=(0.50+mc[1]*nb.fr*2)*H;
                const gr=nb.fr*1.8*Math.min(W,H);
                const g=ctx.createRadialGradient(gx,gy,0,gx,gy,gr);
                g.addColorStop(0,comp.color+hexAlpha(55*frac)); g.addColorStop(1,'transparent');
                ctx.fillStyle=g; ctx.beginPath(); ctx.arc(gx,gy,gr,0,Math.PI*2); ctx.fill();
              });
            } else if(nb.diffuse){
              // Cytoplasm: multi-layer diffuse
              [[0.38,24],[0.60,16],[0.85,10]].forEach(([rf,a])=>{
                const g=ctx.createRadialGradient(nb.fx*W,nb.fy*H,0,nb.fx*W,nb.fy*H,nb.fr*rf*Math.min(W,H));
                g.addColorStop(0,comp.color+hexAlpha(a*frac)); g.addColorStop(1,'transparent');
                ctx.fillStyle=g; ctx.beginPath(); ctx.arc(nb.fx*W,nb.fy*H,nb.fr*rf*Math.min(W,H),0,Math.PI*2); ctx.fill();
              });
            } else {
              const gx=nb.fx*W, gy=nb.fy*H, gr=nb.fr*1.5*Math.min(W,H);
              const g=ctx.createRadialGradient(gx,gy,0,gx,gy,gr);
              g.addColorStop(0,comp.color+hexAlpha(42*frac)); g.addColorStop(0.5,comp.color+hexAlpha(16*frac)); g.addColorStop(1,'transparent');
              ctx.fillStyle=g; ctx.beginPath(); ctx.arc(gx,gy,gr,0,Math.PI*2); ctx.fill();
            }
          });

          // Nucleus quasar core
          const qx=0.50*W, qy=0.50*H;
          const qfrac=_scDetectFrac(selPg,_SC_COMPS.find(c=>c.id==='nuc').detect.t,_SC_COMPS.find(c=>c.id==='nuc').detect.f);
          if(qfrac>0){
            const qg=ctx.createRadialGradient(qx,qy,0,qx,qy,0.05*Math.min(W,H));
            qg.addColorStop(0,`rgba(255,230,100,${0.9*qfrac})`);
            qg.addColorStop(0.4,`rgba(200,130,0,${0.4*qfrac})`);
            qg.addColorStop(1,'transparent');
            ctx.fillStyle=qg; ctx.beginPath(); ctx.arc(qx,qy,0.05*Math.min(W,H),0,Math.PI*2); ctx.fill();
            // Quasar spikes
            [[1,0],[0,1],[0.7,0.7],[-0.7,0.7]].forEach(([dx,dy])=>{
              ctx.strokeStyle=`rgba(255,240,120,${0.25*qfrac})`;
              ctx.lineWidth=0.8;
              const slen=0.06*Math.min(W,H);
              ctx.beginPath(); ctx.moveTo(qx-dx*slen,qy-dy*slen); ctx.lineTo(qx+dx*slen,qy+dy*slen); ctx.stroke();
            });
          }

          // Shooting stars
          if(ts-lastShoot>3800){
            lastShoot=ts;
            const a=(Math.random()-0.5)*0.5;
            const sy2=Math.random()*H*0.6+H*0.1;
            shooters.current.push({
              x:-10,y:sy2,angle:a,spd:600+Math.random()*400,
              len:90+Math.random()*110,born:ts,life:700+Math.random()*400,
            });
          }
          shooters.current=shooters.current.filter(s=>ts-s.born<s.life);
          shooters.current.forEach(s=>{
            const age=(ts-s.born)/s.life;
            const dist=s.spd*(ts-s.born)/1000;
            const ex=s.x+Math.cos(s.angle)*dist, ey=s.y+Math.sin(s.angle)*dist;
            const sx2=ex-Math.cos(s.angle)*s.len, sy2=ey-Math.sin(s.angle)*s.len;
            const g=ctx.createLinearGradient(sx2,sy2,ex,ey);
            g.addColorStop(0,'transparent');
            g.addColorStop(0.7,`rgba(255,245,220,${(1-age)*0.7})`);
            g.addColorStop(1,`rgba(255,255,255,${(1-age)*0.9})`);
            ctx.strokeStyle=g; ctx.lineWidth=1.8;
            ctx.beginPath(); ctx.moveTo(sx2,sy2); ctx.lineTo(ex,ey); ctx.stroke();
          });

          // Protein stars
          const pts=[];
          proteinStars.forEach(s=>{
            if(!s.detected) return;
            const x=s.rx*W, y=s.ry*H;
            const tw=0.5+0.5*Math.sin(ts*0.001*s.freq+s.ph0);
            const isHov=hovRef.current&&hovRef.current.protein===s.protein&&hovRef.current.comp===s.comp.id;
            const sz=isHov?s.sz*3.5:s.sz;
            const alpha=tw*(isHov?1.0:0.80);
            // Glow halo
            const gr=ctx.createRadialGradient(x,y,0,x,y,sz*(isHov?8:5));
            gr.addColorStop(0,s.comp.color+(isHov?'cc':'88')); gr.addColorStop(1,'transparent');
            ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(x,y,sz*(isHov?8:5),0,Math.PI*2); ctx.fill();
            // Star dot
            ctx.fillStyle=s.comp.color; ctx.globalAlpha=alpha;
            ctx.beginPath(); ctx.arc(x,y,sz,0,Math.PI*2); ctx.fill();
            ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.globalAlpha=alpha*0.8;
            ctx.beginPath(); ctx.arc(x,y,sz*0.38,0,Math.PI*2); ctx.fill();
            ctx.globalAlpha=1;
            // Hover crosshair + label
            if(isHov){
              ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=0.8;
              ctx.beginPath(); ctx.moveTo(x-12,y); ctx.lineTo(x+12,y); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(x,y-12); ctx.lineTo(x,y+12); ctx.stroke();
              const label=`${s.protein}`;
              ctx.font='bold 11px sans-serif'; ctx.textAlign='center';
              const tw2=ctx.measureText(label).width;
              const lx=Math.min(Math.max(x,tw2/2+6),W-tw2/2-6), ly=Math.max(y-sz*8-6,20);
              ctx.fillStyle='rgba(5,0,18,0.88)';
              ctx.beginPath(); ctx.roundRect(lx-tw2/2-5,ly-14,tw2+10,17,3); ctx.fill();
              ctx.fillStyle=s.comp.color; ctx.textBaseline='bottom';
              ctx.fillText(label,lx,ly);
            }
            pts.push({x,y,protein:s.protein,comp:s.comp.id,r:Math.max(sz*7,12)});
          });
          protPts.current=pts;

          // Corner caption
          ctx.fillStyle='rgba(160,120,200,0.35)'; ctx.font='9px monospace';
          ctx.textAlign='left'; ctx.textBaseline='top';
          ctx.fillText('PROTEIN COSMOS  ·  K562 cell as nebula  ·  hover stars to identify',8,5);

          animRef.current=requestAnimationFrame(frame);
        };
        animRef.current=requestAnimationFrame(frame);
        return()=>cancelAnimationFrame(animRef.current);
      },[proteinStars,bgStars,selPg]);

      const handleMouseMove=useCallback((e)=>{
        const cv=canvasRef.current; if(!cv) return;
        const rect=cv.getBoundingClientRect();
        const mx=e.clientX-rect.left, my=e.clientY-rect.top;
        let best=null, bestD=Infinity;
        protPts.current.forEach(pt=>{
          const d=Math.hypot(mx-pt.x,my-pt.y);
          if(d<pt.r&&d<bestD){bestD=d; best=pt;}
        });
        hovRef.current=best;
        setHovered(best);
      },[]);

      return React.createElement('div',{style:{display:'flex',flexDirection:'column',gap:8}},
        React.createElement('div',{style:{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}},
          React.createElement('span',{style:{color:_SC.muted,fontSize:11}},'Depth:'),
          ...levels.map(r=>React.createElement('button',{key:r.id,onClick:()=>setSelPg(r.inputPg),
            style:{padding:'3px 10px',borderRadius:4,fontSize:11,cursor:'pointer',
              background:selPg===r.inputPg?_SC.violet:_SC.surface,
              color:selPg===r.inputPg?'#fff':_SC.muted,
              border:`1px solid ${selPg===r.inputPg?_SC.violet:_SC.border}`}},_scFmtAmt(r.inputPg))),
          React.createElement('span',{style:{color:_SC.muted,fontSize:10,marginLeft:8}},
            '✦ Hover a star to identify its protein'),
        ),
        React.createElement('canvas',{ref:canvasRef,
          onMouseMove:handleMouseMove, onMouseLeave:()=>{hovRef.current=null;setHovered(null);},
          style:{width:'100%',height:520,display:'block',borderRadius:8,
            border:`1px solid ${_SC.border}`,cursor:'crosshair'}}),
        hovered&&React.createElement('div',{style:{
          padding:'8px 16px',borderRadius:8,display:'flex',gap:14,alignItems:'center',
          background:_SC.surface,border:`1px solid ${_SC_COMPS.find(c=>c.id===hovered.comp)?.color||_SC.border}`,
          boxShadow:`0 0 18px ${(_SC_COMPS.find(c=>c.id===hovered.comp)?.color||'#888')}33`}},
          React.createElement('span',{style:{
            fontSize:17,fontWeight:800,letterSpacing:0.5,
            color:_SC_COMPS.find(c=>c.id===hovered.comp)?.color||_SC.cyan,
            textShadow:`0 0 10px currentColor`}},hovered.protein),
          React.createElement('span',{style:{color:_SC.muted,fontSize:11}},'·'),
          React.createElement('span',{style:{fontSize:11,color:_SC.text}},
            _SC_COMPS.find(c=>c.id===hovered.comp)?.name||hovered.comp),
        ),
        React.createElement('div',{style:{display:'flex',gap:8,flexWrap:'wrap',marginTop:2}},
          _SC_COMPS.map(comp=>{
            const n=Math.round(comp.n*_scDetectFrac(selPg,comp.detect.t,comp.detect.f));
            return React.createElement('div',{key:comp.id,style:{
              display:'flex',alignItems:'center',gap:5,padding:'3px 8px',borderRadius:4,
              background:comp.color+'0f',border:`1px solid ${n>0?comp.color+'44':'#1e0838'}`}},
              React.createElement('div',{style:{width:6,height:6,borderRadius:'50%',
                background:n>0?comp.color:'#2a0848',
                boxShadow:n>0?`0 0 5px ${comp.color}`:'none'}}),
              React.createElement('span',{style:{fontSize:9,color:n>0?comp.color:'#4a2060'}},comp.name),
              React.createElement('span',{style:{fontSize:9,color:'#7a4890',marginLeft:2}},`${n}★`),
            );
          })
        ),
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Main Tab
    // ═══════════════════════════════════════════════════════════════════════════
    function SingleCellTab() {
      const [panel, setPanel] = useState('arcs');
      const { data: allRuns } = useFetch('/api/runs');

      const k562Runs = useMemo(()=>{
        if(!allRuns) return [];
        return allRuns
          .filter(r=>r.run_name&&r.run_name.includes('K562'))
          .map(r=>({...r,inputPg:_scParseAmountPg(r.run_name)}))
          .filter(r=>r.inputPg!==null);
      },[allRuns]);

      const withData=k562Runs.filter(r=>r.n_proteins);
      const amtGroups=[...new Set(withData.map(r=>r.inputPg))].sort((a,b)=>a-b);
      const maxProt=Math.max(...withData.map(r=>r.n_proteins||0),0);

      const cellProt=(()=>{
        const pts=withData.sort((a,b)=>a.inputPg-b.inputPg);
        if(pts.length<2) return '—';
        const iy=pts.map(r=>1/r.n_proteins),ix=pts.map(r=>1/r.inputPg);
        const n=pts.length,sX=ix.reduce((a,b)=>a+b,0),sY=iy.reduce((a,b)=>a+b,0);
        const sXY=ix.reduce((s,v,i)=>s+v*iy[i],0),sX2=ix.reduce((s,v)=>s+v*v,0);
        const sl=(n*sXY-sX*sY)/(n*sX2-sX**2),ic=(sY-sl*sX)/n;
        if(!ic||ic<=0) return '—';
        return Math.round((1/ic)*150/((sl/ic)+150)).toLocaleString();
      })();

      const PANELS=[
        {id:'arcs',    label:'Coverage Arcs',   icon:'◉'},
        {id:'storm',   label:'Ion Storm',        icon:'⚡'},
        {id:'helix',   label:'Charge States',    icon:'⚛'},
        {id:'model',   label:'Depth Projection', icon:'📐'},
        {id:'surface', label:'Surfaceome',       icon:'🔮'},
        {id:'radar',   label:'Quality Radar',    icon:'🕸'},
        {id:'globe',   label:'3D Cell Globe',    icon:'🌐'},
        {id:'bigbang', label:'Origin Story',     icon:'💥'},
        {id:'cosmos',  label:'Protein Cosmos',   icon:'🌌'},
      ];

      return React.createElement('div',{style:{padding:16,display:'flex',flexDirection:'column',gap:14}},

        // Header
        React.createElement('div',{style:{
          background:'linear-gradient(135deg,#1a0030 0%,#3d0080 50%,#1a0030 100%)',
          border:`1px solid ${_SC.border}`,borderRadius:12,padding:'18px 24px',
          display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12,
          boxShadow:'0 0 40px rgba(217,70,239,0.12)',
        }},
          React.createElement('div',null,
            React.createElement('div',{style:{
              fontSize:24,fontWeight:900,letterSpacing:5,
              background:`linear-gradient(90deg,${_SC.gold},${_SC.violet},${_SC.cyan})`,
              WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',
              filter:'drop-shadow(0 0 8px rgba(217,70,239,0.4))',
            }},'SINGLE CELL PROTEOMICS'),
            React.createElement('div',{style:{color:_SC.muted,fontSize:12,marginTop:4}},
              `K562 CML · ${k562Runs.length} runs · ${amtGroups.length} dilution levels · timsTOF Ultra`),
          ),
          React.createElement('div',{style:{display:'flex',gap:10,flexWrap:'wrap'}},
            [['Runs w/ Data',withData.length,_SC.violet],['Max Depth',maxProt.toLocaleString(),_SC.cyan],
             ['~1 Cell',cellProt,_SC.gold],
             ['Range',amtGroups.length?`${_scFmtAmt(amtGroups[0])}–${_scFmtAmt(amtGroups[amtGroups.length-1])}`:'—',_SC.green],
            ].map(([lbl,val,col])=>
              React.createElement('div',{key:lbl,style:{
                background:'rgba(14,0,24,0.7)',border:`1px solid ${col}33`,
                borderRadius:10,padding:'10px 16px',textAlign:'center',
                boxShadow:`0 0 12px ${col}22`,
              }},
                React.createElement('div',{style:{color:col,fontWeight:800,fontSize:18,letterSpacing:1}},val),
                React.createElement('div',{style:{color:_SC.muted,fontSize:10,marginTop:2}},lbl),
              )
            ),
          ),
        ),

        // Panel nav
        React.createElement('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
          PANELS.map(p=>
            React.createElement('button',{key:p.id,onClick:()=>setPanel(p.id),
              style:{
                padding:'7px 16px',borderRadius:8,fontSize:12,cursor:'pointer',
                background:panel===p.id?`linear-gradient(135deg,${_SC.violet},${_SC.purple})`:_SC.surface,
                color:panel===p.id?'#fff':_SC.muted,
                border:`1px solid ${panel===p.id?_SC.violet:_SC.border}`,
                boxShadow:panel===p.id?`0 0 12px ${_SC.violet}44`:'none',
                transition:'all 0.15s',fontWeight:panel===p.id?700:400,
              }
            },`${p.icon} ${p.label}`)
          ),
        ),

        allRuns&&!k562Runs.length&&React.createElement('div',{style:{
          background:_SC.surface,border:`1px solid ${_SC.border}`,
          borderRadius:10,padding:48,textAlign:'center',color:_SC.muted,
        }},
          React.createElement('div',{style:{fontSize:40,marginBottom:12}},'🔬'),
          React.createElement('div',{style:{fontSize:16,color:_SC.text,marginBottom:8}},'No K562 runs found'),
          React.createElement('div',{style:{fontSize:12}},'Run names must contain "K562" to appear here'),
        ),

        k562Runs.length>0&&React.createElement('div',{style:{
          background:_SC.surface,border:`1px solid ${_SC.border}`,
          borderRadius:12,padding:20,
          boxShadow:'0 0 30px rgba(61,16,96,0.4)',
        }},
          panel==='arcs'    && React.createElement(SCSensitivityArc,    {runs:k562Runs}),
          panel==='storm'   && React.createElement(SCIonStorm,          {runs:k562Runs}),
          panel==='helix'   && React.createElement(SCChargeHelix,       {runs:k562Runs}),
          panel==='model'   && React.createElement(SCCoverageProjection, {runs:k562Runs}),
          panel==='surface' && React.createElement(SCSurfaceomeAtlas,   {runs:k562Runs}),
          panel==='radar'   && React.createElement(SCDepthRadar,        {runs:k562Runs}),
          panel==='globe'   && React.createElement(SCCellGlobe,         {runs:k562Runs}),
          panel==='bigbang' && React.createElement(SCProteomeBigBang,   {runs:k562Runs}),
          panel==='cosmos'  && React.createElement(SCProteinCosmos,     {runs:k562Runs}),
        ),
      );
    }
