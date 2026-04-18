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
    // Rotating helices — thickness = charge fraction at each dilution level
    // ═══════════════════════════════════════════════════════════════════════════
    function SCChargeHelix({ runs }) {
      const canvasRef = useRef(null);
      const animRef   = useRef(null);

      const withData = useMemo(()=>
        runs.filter(r=>r.n_proteins&&r.inputPg&&r.pct_charge_2!=null)
            .sort((a,b)=>a.inputPg-b.inputPg),
      [runs]);

      useEffect(()=>{
        if(!canvasRef.current||!withData.length) return;
        const cv=canvasRef.current;
        const dpr=window.devicePixelRatio||1;
        cv.width=cv.offsetWidth*dpr; cv.height=cv.offsetHeight*dpr;
        const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
        const W=cv.offsetWidth, H=cv.offsetHeight;
        let t=0;

        const draw=()=>{
          ctx.fillStyle=_SC.bg; ctx.fillRect(0,0,W,H);
          const N=withData.length;
          const bandW=(W-80)/N;

          withData.forEach((run,i)=>{
            const cx=40+bandW*i+bandW/2;
            const c2=run.pct_charge_2||0;
            const c3=run.pct_charge_3||0;
            const c4=Math.max(0,1-c2-c3-(run.pct_charge_1||0));

            // Helix for each charge
            [[c2,'#d946ef',2],[c3,'#22d3ee',1.4],[c4,'#f97316',0.8]].forEach(([frac,col,baseLW],ci)=>{
              if(frac<0.01) return;
              ctx.beginPath();
              for(let step=0;step<=80;step++){
                const yFrac=step/80;
                const y=44+yFrac*(H-88);
                const angle=(yFrac*3*Math.PI*2)+t+ci*Math.PI*0.6;
                const x=cx+Math.sin(angle)*bandW*0.38*frac;
                if(step===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
              }
              ctx.strokeStyle=col+'bb';
              ctx.lineWidth=baseLW+frac*2.5;
              ctx.lineCap='round'; ctx.lineJoin='round';
              ctx.stroke();
            });

            // Center axis
            ctx.strokeStyle='rgba(61,16,96,0.45)'; ctx.lineWidth=0.5;
            ctx.setLineDash([3,5]);
            ctx.beginPath();ctx.moveTo(cx,44);ctx.lineTo(cx,H-44);ctx.stroke();
            ctx.setLineDash([]);

            // Labels
            ctx.fillStyle=_SC.muted; ctx.font='10px monospace'; ctx.textAlign='center';
            ctx.textBaseline='bottom';
            ctx.fillText(_scFmtAmt(run.inputPg),cx,H-10);
            ctx.fillStyle=_SC.violet; ctx.font='bold 10px monospace';
            ctx.textBaseline='top';
            ctx.fillText(`${(c2*100).toFixed(0)}%`,cx,14);
          });

          // Legend
          [[_SC.violet,'z=2'],[_SC.cyan,'z=3'],[_SC.orange,'z≥4']].forEach(([col,lbl],i)=>{
            const lx=W-95,ly=46+i*18;
            ctx.strokeStyle=col; ctx.lineWidth=2;
            ctx.beginPath();ctx.moveTo(lx-8,ly);ctx.lineTo(lx+2,ly);ctx.stroke();
            ctx.fillStyle=col;ctx.font='9px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
            ctx.fillText(lbl,lx+5,ly);
          });

          ctx.fillStyle=_SC.text; ctx.font='bold 12px sans-serif';
          ctx.textAlign='center'; ctx.textBaseline='top';
          ctx.fillText('Charge Helix · Helix width ∝ charge fraction · Top = z=2 %',W/2,2);

          t+=0.008;
          animRef.current=requestAnimationFrame(draw);
        };
        animRef.current=requestAnimationFrame(draw);
        return()=>cancelAnimationFrame(animRef.current);
      },[withData]);

      return React.createElement('canvas',{ref:canvasRef,
        style:{width:'100%',height:340,display:'block',borderRadius:8,border:`1px solid ${_SC.border}`}});
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
    const _SC_SURFACE_MARKERS = [
      ['CD34', 490,0.78,6.8,'Stem'],    ['CD43', 720,0.88,7.1,'Stem'],    ['CD117',960,1.02,6.5,'Stem'],
      ['CD33', 820,0.82,7.4,'Myeloid'], ['CD13', 680,0.80,7.2,'Myeloid'], ['CD15', 540,0.70,6.9,'Myeloid'],
      ['CD71', 750,0.91,7.6,'TfR'],     ['TfR1', 840,0.97,7.5,'TfR'],
      ['CD29', 680,0.83,7.0,'Integrin'],['ITGAV',870,0.99,6.8,'Integrin'],
      ['HLA-A',900,0.93,7.3,'MHC-I'],  ['HLA-B',910,0.94,7.2,'MHC-I'],   ['β2M', 610,0.64,7.8,'MHC-I'],
      ['CD45',1080,1.12,7.5,'Pan'],     ['CD44', 930,1.01,7.3,'Pan'],      ['CD47', 830,0.88,7.6,'Pan'],
      ['ABL1', 560,0.76,6.2,'BCR-ABL'],['BCR',  780,0.90,6.3,'BCR-ABL'],
    ];
    const _SC_PW_COL={
      'Stem':_SC.gold,'Myeloid':_SC.violet,'TfR':_SC.cyan,
      'Integrin':_SC.green,'MHC-I':_SC.orange,'Pan':_SC.indigo,'BCR-ABL':_SC.rose,
    };

    function SCSurfaceomeAtlas({ runs }) {
      const canvasRef = useRef(null);
      const [selId, setSelId] = useState(null);
      const [ions, setIons]   = useState(null);

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

        ctx.fillStyle=_SC.bg; ctx.fillRect(0,0,W,H);

        // Ion field
        if(ions?.mz){
          ions.mz.forEach((mz,i)=>{
            const x=tx(mz),y=ty(ions.mobility[i]);
            const alpha=0.05+((ions.log_int[i]-6.5)/1.5)*0.09;
            ctx.fillStyle=`rgba(168,85,247,${Math.max(0.03,alpha)})`;
            ctx.fillRect(x,y,1.3,1.3);
          });
        }

        // CCS corridors
        [2,3,4].forEach(z=>{
          ctx.beginPath();
          for(let mz=400;mz<=1200;mz+=12){
            const k0=_lsCcsExpected(mz,z), x=tx(mz),y=ty(k0);
            if(mz===400) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          }
          ctx.strokeStyle='rgba(255,255,255,0.07)';ctx.lineWidth=0.6;
          ctx.setLineDash([4,7]);ctx.stroke();ctx.setLineDash([]);
          // Label
          const lmz=1150;
          ctx.fillStyle='rgba(255,255,255,0.2)';ctx.font='9px monospace';
          ctx.textAlign='center';ctx.textBaseline='bottom';
          ctx.fillText(`z=${z}`,tx(lmz),ty(_lsCcsExpected(lmz,z))-2);
        });

        // Pathway constellations
        const pathways=[...new Set(_SC_SURFACE_MARKERS.map(m=>m[4]))];
        pathways.forEach(pw=>{
          const grp=_SC_SURFACE_MARKERS.filter(m=>m[4]===pw);
          const col=_SC_PW_COL[pw]||_SC.muted;
          // Connection lines
          for(let a=0;a<grp.length-1;a++){
            ctx.beginPath();
            ctx.moveTo(tx(grp[a][1]+rN()*7),ty(grp[a][2]+rN()*0.012));
            ctx.lineTo(tx(grp[a+1][1]+rN()*7),ty(grp[a+1][2]+rN()*0.012));
            ctx.strokeStyle=col+'1a'; ctx.lineWidth=0.8; ctx.stroke();
          }
          grp.forEach(m=>{
            const mx=tx(m[1]+rN()*7), my=ty(m[2]+rN()*0.012);
            const sz=2.2+(m[3]-6)*1.0;
            // Glow halo
            const grd=ctx.createRadialGradient(mx,my,0,mx,my,sz*4.5);
            grd.addColorStop(0,col+'70'); grd.addColorStop(1,'transparent');
            ctx.fillStyle=grd; ctx.beginPath();ctx.arc(mx,my,sz*4.5,0,Math.PI*2);ctx.fill();
            // Dot
            ctx.fillStyle=col; ctx.beginPath();ctx.arc(mx,my,sz,0,Math.PI*2);ctx.fill();
            // Label
            ctx.fillStyle=col; ctx.font=`bold 8px sans-serif`;
            ctx.textAlign='center';ctx.textBaseline='bottom';
            ctx.fillText(m[0],mx,my-sz-1);
          });
        });

        // Axes
        ctx.strokeStyle='rgba(180,150,212,0.25)'; ctx.lineWidth=0.5;
        ctx.beginPath();ctx.moveTo(PAD.l,PAD.t);ctx.lineTo(PAD.l,H-PAD.b);ctx.stroke();
        ctx.beginPath();ctx.moveTo(PAD.l,H-PAD.b);ctx.lineTo(W-PAD.r,H-PAD.b);ctx.stroke();
        ctx.fillStyle=_SC.muted; ctx.font='10px monospace';
        [500,700,900,1100].forEach(mz=>{ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(mz,tx(mz),H-PAD.b+4);});
        [0.6,0.8,1.0,1.2,1.4].forEach(k0=>{ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(k0.toFixed(1),PAD.l-5,ty(k0));});
        ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('m/z',W/2,H);
        ctx.save();ctx.translate(11,H/2);ctx.rotate(-Math.PI/2);ctx.textBaseline='middle';ctx.fillText('1/K₀',0,0);ctx.restore();

        // Legend
        pathways.forEach((pw,i)=>{
          const col=_SC_PW_COL[pw]||_SC.muted;
          ctx.fillStyle=col;ctx.beginPath();ctx.arc(PAD.l+8,PAD.t+12+i*15,3.5,0,Math.PI*2);ctx.fill();
          ctx.font='8.5px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
          ctx.fillText(pw,PAD.l+15,PAD.t+12+i*15);
        });

        // Title
        ctx.fillStyle=_SC.text;ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
        ctx.fillText('K562 Surfaceome Atlas · m/z × 1/K₀ · CCS corridors',W/2,4);
      },[ions,runs,selId]);

      const sortedRuns=runs.filter(r=>r.n_proteins).sort((a,b)=>a.inputPg-b.inputPg);
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
        ),
        React.createElement('canvas',{ref:canvasRef,
          style:{width:'100%',height:450,display:'block',borderRadius:8,border:`1px solid ${_SC.border}`}}),
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
        {id:'helix',   label:'Charge Helix',     icon:'🧬'},
        {id:'model',   label:'Depth Projection', icon:'📐'},
        {id:'surface', label:'Surfaceome',       icon:'🔮'},
        {id:'radar',   label:'Quality Radar',    icon:'🕸'},
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
          panel==='arcs'    && React.createElement(SCSensitivityArc,     {runs:k562Runs}),
          panel==='storm'   && React.createElement(SCIonStorm,           {runs:k562Runs}),
          panel==='helix'   && React.createElement(SCChargeHelix,        {runs:k562Runs}),
          panel==='model'   && React.createElement(SCCoverageProjection,  {runs:k562Runs}),
          panel==='surface' && React.createElement(SCSurfaceomeAtlas,    {runs:k562Runs}),
          panel==='radar'   && React.createElement(SCDepthRadar,         {runs:k562Runs}),
        ),
      );
    }
