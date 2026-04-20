
    // ─── Histone PTM Tab ──────────────────────────────────────────────────────────
    // Panels: 4D Storm · Sequence Aligner · Tail Map · PTM Crosstalk · Ion Mobility · Workflow

    // ── Panel 1: Futuristic 4D TIMS Storm ────────────────────────────────────────
    function HistoneTimsStorm() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;

        const STARS = Array.from({length:190}, () => ({
          x: Math.random()*W, y: Math.random()*H,
          r: 0.4+Math.random()*1.8,
          phase: Math.random()*Math.PI*2,
          speed: 0.5+Math.random()*1.8,
        }));

        const NX = W*0.26, NY = H*0.50;

        const HIST8 = [
          {a:Math.PI*0,    r:38, col:'#d946ef', label:'H3'},
          {a:Math.PI*0.5,  r:38, col:'#d946ef', label:'H3'},
          {a:Math.PI*1,    r:38, col:'#DAAA00', label:'H4'},
          {a:Math.PI*1.5,  r:38, col:'#DAAA00', label:'H4'},
          {a:Math.PI*0.25, r:70, col:'#22c55e', label:'H2A'},
          {a:Math.PI*0.75, r:70, col:'#f97316', label:'H2B'},
          {a:Math.PI*1.25, r:70, col:'#22c55e', label:'H2A'},
          {a:Math.PI*1.75, r:70, col:'#f97316', label:'H2B'},
        ];

        const TX = W*0.68, TY1 = H*0.10, TY2 = H*0.90, TW = 68;

        // 12 streams — matching Orsburn 2026 (16 PTM combinations) and Cutler 2025 (25 PTMs)
        const STREAMS = [
          {label:'H4K9K13K17 tri-ac', k0:1.24, col:'#DAAA00', desc:'★ Top hit · mocetinostat target'},
          {label:'H3K9ac',            k0:1.18, col:'#f59e0b', desc:'Active chromatin'},
          {label:'H3K24ac',           k0:1.14, col:'#38bdf8', desc:'Orsburn 2026: mocetinostat up'},
          {label:'H3K4me3',           k0:1.10, col:'#22c55e', desc:'Active promoter'},
          {label:'H3K19+K24 di-ac',   k0:1.06, col:'#22d3ee', desc:'Double acetylation (Orsburn)'},
          {label:'H3K36me3',          k0:1.02, col:'#0891b2', desc:'Gene body elongation'},
          {label:'H4K16ac',           k0:0.97, col:'#86efac', desc:'Chromatin accessibility'},
          {label:'H3K27me3',          k0:0.93, col:'#ef4444', desc:'Polycomb silencing'},
          {label:'H3K9me3',           k0:0.87, col:'#a855f7', desc:'Constitutive heterochromatin'},
          {label:'H2BK24ac',          k0:0.82, col:'#f97316', desc:'H2B tail acetylation'},
          {label:'H4K20me1',          k0:0.78, col:'#60a5fa', desc:'Replication timing'},
          {label:'H3K4me1',           k0:0.72, col:'#818cf8', desc:'Enhancer mark'},
        ];
        const K0LO=0.58, K0HI=1.38;
        const sY = k0 => TY1 + (1-(k0-K0LO)/(K0HI-K0LO))*(TY2-TY1);

        const parts = [];
        const MAX_P = 72;
        let rngS = 7919;
        const rng = () => { rngS=(rngS*16807)%2147483647; return(rngS-1)/2147483646; };

        function spawnPart() {
          if (parts.length>=MAX_P) return;
          const stream = STREAMS[Math.floor(rng()*STREAMS.length)];
          const ang = rng()*Math.PI*2, rad = 18+rng()*62;
          parts.push({
            x:NX+Math.cos(ang)*rad, y:NY+Math.sin(ang)*rad,
            stream, phase:'fly',
            vx:2.4+rng()*2.2, vy:(rng()-0.5)*1.3,
            age:0, alpha:1, sz:1.8+rng()*2.4,
            entryX:TX-TW/2-4+rng()*8,
            targetY:sY(stream.k0)+(rng()-0.5)*10,
            sepTimer:0, trail:[],
          });
        }

        let ltTimer=0, ltActive=false, ltData=null;
        const floats=[]; let flTimer=0, scanOff=0, lt2=null;

        function frame(ts) {
          const dt = lt2!==null ? Math.min((ts-lt2)/1000,0.05) : 0.016;
          lt2=ts; scanOff=(scanOff+dt*0.55)%1;
          ctx.clearRect(0,0,W,H);

          // BG
          ctx.fillStyle='#0e0018'; ctx.fillRect(0,0,W,H);
          // grid
          ctx.strokeStyle='rgba(218,170,0,0.035)'; ctx.lineWidth=0.5;
          for(let gx=0;gx<W;gx+=44){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,H);ctx.stroke();}
          for(let gy=0;gy<H;gy+=44){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(W,gy);ctx.stroke();}

          // stars
          STARS.forEach(s=>{
            const twinkle=0.15+0.85*Math.abs(Math.sin(ts/1000*s.speed+s.phase));
            ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
            ctx.fillStyle=`rgba(255,255,255,${twinkle*0.65})`; ctx.fill();
          });

          // nebula
          const neb=ctx.createRadialGradient(NX,NY,0,NX,NY,170);
          neb.addColorStop(0,'rgba(217,70,239,0.13)');
          neb.addColorStop(0.55,'rgba(218,170,0,0.04)');
          neb.addColorStop(1,'rgba(217,70,239,0)');
          ctx.fillStyle=neb; ctx.beginPath(); ctx.arc(NX,NY,170,0,Math.PI*2); ctx.fill();
          // second nebula near TIMS
          const neb2=ctx.createRadialGradient(TX,H/2,0,TX,H/2,120);
          neb2.addColorStop(0,'rgba(34,211,238,0.07)');
          neb2.addColorStop(1,'rgba(34,211,238,0)');
          ctx.fillStyle=neb2; ctx.beginPath(); ctx.arc(TX,H/2,120,0,Math.PI*2); ctx.fill();

          // beam NX → TIMS
          const bGrd=ctx.createLinearGradient(NX+88,NY,TX-TW/2,NY);
          bGrd.addColorStop(0,'rgba(218,170,0,0.18)');
          bGrd.addColorStop(1,'rgba(34,211,238,0.18)');
          ctx.fillStyle=bGrd; ctx.fillRect(NX+88,NY-7,TX-TW/2-NX-88,14);
          ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1;
          ctx.setLineDash([6,9]);
          ctx.beginPath(); ctx.moveTo(NX+88,NY); ctx.lineTo(TX-TW/2,NY); ctx.stroke();
          ctx.setLineDash([]);

          // ── TIMS ─────────────────────────────────────────────────
          const tGrd=ctx.createLinearGradient(TX-TW/2,0,TX+TW/2,0);
          tGrd.addColorStop(0,'rgba(34,211,238,0)');
          tGrd.addColorStop(0.25,'rgba(34,211,238,0.14)');
          tGrd.addColorStop(0.75,'rgba(34,211,238,0.14)');
          tGrd.addColorStop(1,'rgba(34,211,238,0)');
          ctx.fillStyle=tGrd; ctx.fillRect(TX-TW/2,TY1,TW,TY2-TY1);
          // scan lines
          for(let i=0;i<28;i++){
            const fy=((i/28+scanOff)%1);
            const sy2=TY1+fy*(TY2-TY1);
            const a=Math.sin(fy*Math.PI)*0.38;
            ctx.strokeStyle=`rgba(34,211,238,${a})`; ctx.lineWidth=0.7;
            ctx.beginPath(); ctx.moveTo(TX-TW/2,sy2); ctx.lineTo(TX+TW/2,sy2); ctx.stroke();
          }
          // walls
          ctx.strokeStyle='#22d3ee66'; ctx.lineWidth=1.5;
          ctx.strokeRect(TX-TW/2,TY1,TW,TY2-TY1);
          ctx.strokeStyle='#22d3ee99'; ctx.lineWidth=3;
          ctx.beginPath(); ctx.moveTo(TX-TW/2,TY1); ctx.lineTo(TX+TW/2,TY1); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(TX-TW/2,TY2); ctx.lineTo(TX+TW/2,TY2); ctx.stroke();
          ctx.fillStyle='#22d3ee'; ctx.font='bold 12px system-ui'; ctx.textAlign='center';
          ctx.fillText('TIMS',TX,TY1-20);
          ctx.fillStyle='#22d3ee66'; ctx.font='8px system-ui';
          ctx.fillText('Trapped Ion Mobility',TX,TY1-8);
          // k0 ticks
          STREAMS.forEach(s=>{
            const sy2=sY(s.k0);
            ctx.strokeStyle=s.col+'66'; ctx.lineWidth=1;
            ctx.beginPath(); ctx.moveTo(TX+TW/2,sy2); ctx.lineTo(TX+TW/2+5,sy2); ctx.stroke();
            ctx.fillStyle=s.col+'88'; ctx.font='7.5px system-ui'; ctx.textAlign='left';
            ctx.fillText(s.k0.toFixed(2),TX+TW/2+7,sy2+3);
          });
          ctx.fillStyle='#22d3ee55'; ctx.font='8px system-ui'; ctx.textAlign='left';
          ctx.fillText('1/K₀',TX+TW/2+7,TY1-2);

          // ── Exit streams ──────────────────────────────────────────
          const exitX=TX+TW/2;
          STREAMS.forEach(s=>{
            const sy2=sY(s.k0);
            const pulse=0.55+0.45*Math.abs(Math.sin(ts/1000*1.2+s.k0*7));
            const endX=W-18;
            const sGrd=ctx.createLinearGradient(exitX,sy2,endX,sy2);
            sGrd.addColorStop(0,s.col+'dd');
            sGrd.addColorStop(0.3,s.col+'88');
            sGrd.addColorStop(1,s.col+'00');
            ctx.strokeStyle=sGrd; ctx.lineWidth=1.5;
            ctx.setLineDash([4,5]);
            ctx.beginPath(); ctx.moveTo(exitX,sy2); ctx.lineTo(endX,sy2); ctx.stroke();
            ctx.setLineDash([]);
            const lx=exitX+(endX-exitX)*0.22;
            ctx.globalAlpha=pulse;
            ctx.fillStyle=s.col; ctx.font='bold 9px system-ui'; ctx.textAlign='left';
            ctx.fillText(s.label,lx,sy2-5);
            ctx.fillStyle=s.col+'99'; ctx.font='7.5px system-ui';
            ctx.fillText(s.desc,lx,sy2+9);
            ctx.globalAlpha=1;
          });

          // ── Nucleosome ────────────────────────────────────────────
          const tc=ts/1000;
          // DNA double helix
          for(let strand=0;strand<2;strand++){
            ctx.beginPath();
            for(let i=0;i<=130;i++){
              const ang=(i/130)*Math.PI*4.8+tc*0.22+strand*Math.PI;
              const rx=NX+Math.cos(ang)*87;
              const ry=NY+Math.sin(ang)*25+Math.cos(ang*2)*11;
              i===0?ctx.moveTo(rx,ry):ctx.lineTo(rx,ry);
            }
            ctx.strokeStyle=strand===0?'#22d3ee2a':'#d946ef2a';
            ctx.lineWidth=1.6; ctx.stroke();
          }
          // base pairs (connecting dashes)
          for(let i=0;i<20;i++){
            const ang=(i/20)*Math.PI*4.8+tc*0.22;
            const x1=NX+Math.cos(ang)*87, y1=NY+Math.sin(ang)*25+Math.cos(ang*2)*11;
            const x2=NX+Math.cos(ang+Math.PI)*87, y2=NY+Math.sin(ang+Math.PI)*25+Math.cos((ang+Math.PI)*2)*11;
            ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=0.8;
            ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
          }
          // core glow
          const cg=ctx.createRadialGradient(NX,NY,0,NX,NY,52);
          cg.addColorStop(0,'rgba(217,70,239,0.28)');
          cg.addColorStop(0.6,'rgba(217,70,239,0.06)');
          cg.addColorStop(1,'rgba(217,70,239,0)');
          ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(NX,NY,52,0,Math.PI*2); ctx.fill();
          // 8 histones
          HIST8.forEach((h,i)=>{
            const rotSpeed=0.06*(i%2===0?1:-1);
            const ang=h.a+tc*rotSpeed;
            const hx=NX+Math.cos(ang)*h.r, hy=NY+Math.sin(ang)*h.r*0.52;
            const pulse=1+0.13*Math.sin(tc*1.5+i*0.95);
            const hg=ctx.createRadialGradient(hx,hy,0,hx,hy,17*pulse);
            hg.addColorStop(0,h.col+'ff'); hg.addColorStop(0.38,h.col+'55'); hg.addColorStop(1,h.col+'00');
            ctx.fillStyle=hg; ctx.beginPath(); ctx.arc(hx,hy,17*pulse,0,Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(hx,hy,7.5,0,Math.PI*2);
            ctx.fillStyle=h.col; ctx.fill();
            ctx.fillStyle='#fff'; ctx.font='bold 7px system-ui'; ctx.textAlign='center';
            ctx.fillText(h.label,hx,hy+2.5);
          });

          // ── Particles ─────────────────────────────────────────────
          for(let i=parts.length-1;i>=0;i--){
            const p=parts[i]; p.age+=dt;
            p.trail.push({x:p.x,y:p.y});
            if(p.trail.length>9) p.trail.shift();
            if(p.phase==='fly'){
              p.x+=p.vx*dt*60; p.y+=p.vy*dt*60;
              if(p.x>=p.entryX) p.phase='separate';
            } else if(p.phase==='separate'){
              p.sepTimer+=dt;
              const prog=Math.min(p.sepTimer*0.85,1);
              const destX=TX+TW/2+22;
              p.x+=(destX-p.x)*dt*3.2; p.y+=(p.targetY-p.y)*dt*4.5;
              if(p.sepTimer>1.5) p.phase='stream';
            } else {
              p.x+=dt*105; p.y+=(p.targetY-p.y)*dt*6;
              p.alpha=Math.max(0,p.alpha-dt*0.38);
            }
            if(p.alpha<=0.02||p.x>W+30){parts.splice(i,1);continue;}
            // trail
            p.trail.forEach((pt,ti)=>{
              const ta=(ti/p.trail.length)*p.alpha*0.35;
              ctx.beginPath(); ctx.arc(pt.x,pt.y,p.sz*0.55,0,Math.PI*2);
              ctx.fillStyle=p.stream.col+Math.round(ta*255).toString(16).padStart(2,'0');
              ctx.fill();
            });
            // particle
            ctx.beginPath(); ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);
            ctx.fillStyle=p.stream.col+Math.round(p.alpha*255).toString(16).padStart(2,'0');
            ctx.fill();
            // glow
            const pg=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.sz*4.5);
            pg.addColorStop(0,p.stream.col+Math.round(p.alpha*90).toString(16).padStart(2,'0'));
            pg.addColorStop(1,p.stream.col+'00');
            ctx.fillStyle=pg; ctx.beginPath(); ctx.arc(p.x,p.y,p.sz*4.5,0,Math.PI*2); ctx.fill();
          }
          if(Math.random()<dt*4) spawnPart();

          // ── Aladdin Sane lightning ────────────────────────────────
          ltTimer+=dt;
          if(!ltActive&&ltTimer>3+Math.random()*5){
            ltTimer=0; ltActive=true;
            const s=STREAMS[Math.floor(Math.random()*STREAMS.length)];
            const bx=NX+(Math.random()-0.5)*100, by=NY+(Math.random()-0.5)*85;
            ltData={x1:bx,y1:by,x2:bx+55+Math.random()*45,y2:by+50+Math.random()*55,col:s.col,age:0};
          }
          if(ltActive&&ltData){
            ltData.age+=dt;
            const la=Math.max(0,1-ltData.age*2.6);
            if(la<=0){ltActive=false;}
            else{
              const mx=(ltData.x1+ltData.x2)/2;
              const my=(ltData.y1+ltData.y2)/2+(ltData.x2-ltData.x1)*0.58;
              ctx.save(); ctx.globalAlpha=la;
              ctx.shadowBlur=18; ctx.shadowColor=ltData.col;
              ctx.strokeStyle=ltData.col; ctx.lineWidth=2.8;
              ctx.beginPath(); ctx.moveTo(ltData.x1,ltData.y1);
              ctx.lineTo(mx,my); ctx.lineTo(ltData.x2,ltData.y2); ctx.stroke();
              ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.globalAlpha=la*0.55;
              ctx.beginPath(); ctx.moveTo(ltData.x1,ltData.y1);
              ctx.lineTo(mx,my); ctx.lineTo(ltData.x2,ltData.y2); ctx.stroke();
              ctx.restore();
            }
          }

          // ── Floating PTM labels ───────────────────────────────────
          flTimer+=dt;
          if(flTimer>2.0){
            flTimer=0;
            const s=STREAMS[Math.floor(Math.random()*STREAMS.length)];
            floats.push({text:s.label,x:NX+(Math.random()-0.5)*95,y:NY-50-Math.random()*35,col:s.col,age:0,alpha:1});
          }
          for(let i=floats.length-1;i>=0;i--){
            const fl=floats[i]; fl.age+=dt; fl.y-=dt*17;
            fl.alpha=Math.max(0,1-fl.age/2.5);
            if(fl.alpha<=0){floats.splice(i,1);continue;}
            ctx.globalAlpha=fl.alpha; ctx.fillStyle=fl.col;
            ctx.font='bold 10px system-ui'; ctx.textAlign='center';
            ctx.fillText(fl.text,fl.x,fl.y); ctx.globalAlpha=1;
          }

          // ── HUD labels ────────────────────────────────────────────
          ctx.fillStyle='rgba(217,70,239,0.55)'; ctx.font='bold 10px system-ui'; ctx.textAlign='left';
          ctx.fillText('NUCLEOSOME CORE PARTICLE',14,18);
          ctx.fillStyle='rgba(34,211,238,0.55)';
          ctx.fillText('TIMS SEPARATOR',TX-TW/2,18);
          ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='8.5px system-ui'; ctx.textAlign='center';
          ctx.fillText('Histone peptides enter TIMS as a mixture → separated by 3D shape (1/K₀) in milliseconds → modification-specific streams',W/2,H-9);

          rafRef.current=requestAnimationFrame(frame);
        }
        rafRef.current=requestAnimationFrame(frame);
        return()=>cancelAnimationFrame(rafRef.current);
      },[]);

      return (
        <div className="card" style={{marginBottom:'1rem',background:'#0e0018',border:'1px solid rgba(217,70,239,0.3)',padding:0,overflow:'hidden',borderRadius:'0.6rem'}}>
          <canvas ref={cvRef} width={900} height={470} style={{width:'100%',borderRadius:'0.6rem',display:'block'}}/>
        </div>
      );
    }

    // ── Panel 2: Sequence Aligner ─────────────────────────────────────────────────
    function HistoneSequenceAligner() {
      const CANONICAL = {
        'H3.1':'ARTKQTARKSTGGKAPRKQLATKAARKSAPATGGVKKPHRYRPGTVALREIRRYQKSTELLIRKLPFQRLVREIAQDFKTDLRFQSSAVMALQEACEAYLVGLFEDTNLCAIHAKRVTIMPKDIQLARRIRGERA',
        'H3.3':'ARTKQTARKSTGGKAPRKQLASKAARKSGPATGGVKKPHRYRPGTVALREIRRYQKSTELLIRKLPFQRLVREIAQDFKTDLRFQSSAVMALQEACEAYLVGLFEDTNLCAIHAKRVTIMPKDIQLARRIRGERA',
        'H4':  'SGRGKGGKGLGKGGAKRHRKVLRDNIQGITKPAIRRLARRGGVKRISGLIYEETRGVLKVFLENVIRDAVTYTEHAKRKTVTAMDVVYALKRQGRTLYGFGG',
        'H2A': 'SGRGKQGGKTRAKAKTRSSRAGLQFPVGRVHRHLKSRTTSHGRVGATAAVYSAAILEYLTAEVLELAGNASKDLKVKRITPRHLQLAIRGDEELDSLIK',
        'H2B': 'PEPAKSAPAPKKGSKKAVTKAQKKDGKKRKRSRKESYSVYVYKVLKQVHPDTGISSKAMGIMNSFVNDIFERIAGEASRLAHYNKRSTITSREIQTAVRLLLPGELAKHAVSEGTKAVTKYTSSK',
      };
      const MOD_SITES = {
        'H3.1':new Set([4,9,14,18,19,23,24,27,36,56]), // +K19, K24 (Orsburn 2026)
        'H3.3':new Set([4,9,14,27,36]),
        'H4':  new Set([5,8,9,12,13,16,17,20]),        // +K9,K13,K17 (Orsburn tri-ac cluster)
        'H2A': new Set([5,15,119]),
        'H2B': new Set([5,12,15,20,24,120]),            // +K24 (Orsburn 2026)
      };
      const aaCol = aa => {
        if('KRH'.includes(aa)) return '#22d3ee';
        if('DE'.includes(aa))  return '#ef4444';
        if('FYWM'.includes(aa)) return '#d946ef';
        if('LIVM'.includes(aa)) return '#475569';
        return '#52525b';
      };

      const [histone, setHistone] = useState('H3.1');
      const [manualSeq, setManualSeq] = useState('');
      const [manualHits, setManualHits] = useState([]);
      const [selectedRun, setSelectedRun] = useState(null);
      const [dataPeps, setDataPeps] = useState([]);
      const [loading, setLoading] = useState(false);
      const { data: allRuns } = useFetch('/api/runs?limit=200');
      const runs = Array.isArray(allRuns) ? allRuns : [];

      const canonical = CANONICAL[histone] || '';
      const modSites  = MOD_SITES[histone]  || new Set();

      // Manual alignment
      React.useEffect(() => {
        const seq = manualSeq.trim().toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g,'');
        if(seq.length<4){setManualHits([]);return;}
        const hits=[]; let pos=canonical.indexOf(seq);
        while(pos!==-1){hits.push({start:pos,end:pos+seq.length,seq});pos=canonical.indexOf(seq,pos+1);}
        setManualHits(hits);
      },[manualSeq,canonical]);

      // Load from run
      React.useEffect(()=>{
        if(!selectedRun){setDataPeps([]);return;}
        setLoading(true); setDataPeps([]);
        fetch(API+`/api/runs/${selectedRun.id}/peptides?q=&limit=500`)
          .then(r=>r.ok?r.json():[])
          .then(peps=>{
            const hits=[]; const seen=new Set();
            (peps||[]).forEach(p=>{
              const seq=(p.stripped_sequence||p.sequence||'').toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g,'');
              if(!seq||seen.has(seq)||seq.length<5) return;
              for(const [h,canon] of Object.entries(CANONICAL)){
                const pos=canon.indexOf(seq);
                if(pos!==-1){
                  seen.add(seq);
                  hits.push({histone:h,start:pos,end:pos+seq.length,seq,mz:p.mz,charge:p.charge,im:p.im,intensity:p.intensity});
                  break;
                }
              }
            });
            hits.sort((a,b)=>(b.intensity||0)-(a.intensity||0));
            setDataPeps(hits); setLoading(false);
          }).catch(()=>setLoading(false));
      },[selectedRun?.id]);

      const alignedPeps = dataPeps.filter(p=>p.histone===histone);
      const PCOLS = ['#DAAA00','#22d3ee','#d946ef','#22c55e','#f97316','#60a5fa','#ef4444','#a855f7'];

      return (
        <div className="card" style={{marginBottom:'1rem'}}>
          <h3 style={{marginBottom:'0.5rem',background:'linear-gradient(90deg,#d946ef,#22d3ee)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            Histone Sequence Aligner
          </h3>

          {/* Histone selector + manual search */}
          <div style={{display:'flex',gap:'0.45rem',flexWrap:'wrap',marginBottom:'0.65rem',alignItems:'center'}}>
            {Object.keys(CANONICAL).map(h=>(
              <button key={h} onClick={()=>setHistone(h)}
                style={{padding:'0.28rem 0.65rem',borderRadius:'0.35rem',border:'none',cursor:'pointer',fontWeight:600,fontSize:'0.78rem',
                  background:histone===h?'var(--accent)':'var(--surface)',color:histone===h?'var(--bg)':'var(--muted)'}}>
                {h}
              </button>
            ))}
            <span style={{marginLeft:'0.75rem',color:'var(--muted)',fontSize:'0.76rem',flexShrink:0}}>Search:</span>
            <input value={manualSeq} onChange={e=>setManualSeq(e.target.value)}
              placeholder="paste a peptide sequence (≥4 aa)…"
              style={{flex:1,minWidth:'180px',padding:'0.28rem 0.55rem',background:'var(--bg)',border:'1px solid var(--border)',
                borderRadius:'0.3rem',color:'#e2e8f0',fontSize:'0.8rem',fontFamily:'monospace'}}/>
          </div>

          {/* Run selector */}
          <div style={{display:'flex',gap:'0.5rem',alignItems:'center',marginBottom:'0.75rem',flexWrap:'wrap'}}>
            <span style={{color:'var(--muted)',fontSize:'0.76rem',flexShrink:0}}>Load peptides from run:</span>
            <select onChange={e=>{const r=runs.find(r=>r.id===e.target.value);setSelectedRun(r||null);}}
              style={{flex:1,maxWidth:'380px',padding:'0.28rem 0.45rem',background:'var(--bg)',border:'1px solid var(--border)',
                borderRadius:'0.3rem',color:'#e2e8f0',fontSize:'0.78rem'}}>
              <option value="">— select a run —</option>
              {runs.map(r=><option key={r.id} value={r.id}>{r.run_name}</option>)}
            </select>
            {loading && <span style={{color:'var(--muted)',fontSize:'0.76rem'}}>loading…</span>}
            {!loading&&dataPeps.length>0&&<span style={{color:'#22c55e',fontSize:'0.76rem'}}>{dataPeps.length} histone peptide{dataPeps.length!==1?'s':''} found</span>}
          </div>

          {/* Sequence block display */}
          <div style={{marginBottom:'0.55rem'}}>
            <div style={{fontSize:'0.68rem',color:'#64748b',marginBottom:'0.2rem'}}>
              {histone} · {canonical.length} aa ·{' '}
              <span style={{color:'#22d3ee'}}>cyan=K/R/H</span>{' · '}
              <span style={{color:'#DAAA00'}}>gold=mod site</span>{' · '}
              <span style={{color:'#ef4444'}}>red=D/E</span>{' · '}
              <span style={{color:'#d946ef'}}>violet=aromatic</span>
            </div>
            <div style={{fontFamily:'monospace',display:'flex',flexWrap:'wrap',gap:'1px',lineHeight:1}}>
              {canonical.split('').map((aa,i)=>{
                const pos=i+1;
                const isMod=modSites.has(pos);
                const isMan=manualHits.some(h=>i>=h.start&&i<h.end);
                const isDat=alignedPeps.some(p=>i>=p.start&&i<p.end);
                let bg='transparent',bdr='transparent',tc=aaCol(aa),fw=400;
                if(isMod){bg='rgba(218,170,0,0.22)';bdr='#DAAA0088';tc='#DAAA00';fw=700;}
                if(isDat){bg='rgba(34,211,238,0.18)';bdr='#22d3ee77';}
                if(isMan){bg='rgba(217,70,239,0.38)';bdr='#d946efcc';tc='#fff';fw=700;}
                return(
                  <span key={i} title={`${aa}${pos}${isMod?' — modification site':''}`}
                    style={{display:'inline-block',width:'13px',height:'16px',lineHeight:'16px',
                      fontSize:'8px',textAlign:'center',cursor:'default',
                      background:bg,border:`1px solid ${bdr}`,borderRadius:'1px',
                      color:tc,fontWeight:fw}}>
                    {aa}
                  </span>
                );
              })}
            </div>
            {/* ruler */}
            <div style={{fontFamily:'monospace',fontSize:'6.5px',color:'#64748b',marginTop:'2px',display:'flex',flexWrap:'wrap',gap:'1px'}}>
              {canonical.split('').map((_,i)=>(
                <span key={i} style={{width:'13px',textAlign:'center',display:'inline-block'}}>
                  {(i+1)%10===0?(i+1):''}
                </span>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div style={{display:'flex',gap:'1rem',marginBottom:'0.65rem',fontSize:'0.7rem',color:'#64748b',flexWrap:'wrap'}}>
            {[
              {bg:'rgba(218,170,0,0.22)',bdr:'#DAAA0088',label:'Modification site'},
              {bg:'rgba(34,211,238,0.18)',bdr:'#22d3ee77',label:'Detected in run'},
              {bg:'rgba(217,70,239,0.38)',bdr:'#d946ef',label:'Manual search hit'},
            ].map(l=>(
              <span key={l.label} style={{display:'flex',alignItems:'center',gap:'0.3rem'}}>
                <span style={{display:'inline-block',width:'12px',height:'12px',background:l.bg,border:`1px solid ${l.bdr}`,borderRadius:'1px'}}/>
                {l.label}
              </span>
            ))}
          </div>

          {/* Manual search result */}
          {manualSeq.trim().length>=4&&(
            <div style={{marginBottom:'0.55rem',padding:'0.45rem 0.7rem',background:'rgba(217,70,239,0.08)',border:'1px solid rgba(217,70,239,0.22)',borderRadius:'0.4rem',fontSize:'0.78rem'}}>
              {manualHits.length===0
                ?<span style={{color:'#64748b'}}>"{manualSeq.trim()}" — not found in {histone}</span>
                :manualHits.map((h,i)=>(
                    <span key={i} style={{color:'#d946ef',fontFamily:'monospace',marginRight:'1rem'}}>
                      Found at position {h.start+1}–{h.end} &nbsp;({h.end-h.start} aa)
                    </span>
                  ))
              }
            </div>
          )}

          {/* Detected peptides table */}
          {alignedPeps.length>0&&(
            <div style={{overflowX:'auto'}}>
              <div style={{fontSize:'0.7rem',color:'#64748b',marginBottom:'0.3rem'}}>
                {alignedPeps.length} peptide{alignedPeps.length!==1?'s':''} mapped to {histone}
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.75rem'}}>
                <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                  {['Sequence','Position','m/z','z','1/K₀','Intensity'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'0.22rem 0.4rem',color:'var(--muted)',fontWeight:600}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {alignedPeps.slice(0,25).map((p,i)=>(
                    <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)',background:i%2===0?'rgba(255,255,255,0.01)':'transparent'}}>
                      <td style={{padding:'0.2rem 0.4rem',fontFamily:'monospace',color:PCOLS[i%PCOLS.length],fontWeight:600}}>{p.seq}</td>
                      <td style={{padding:'0.2rem 0.4rem',color:'#64748b'}}>{p.start+1}–{p.end}</td>
                      <td style={{padding:'0.2rem 0.4rem',color:'#94a3b8'}}>{p.mz?p.mz.toFixed(3):'—'}</td>
                      <td style={{padding:'0.2rem 0.4rem',color:'#94a3b8'}}>{p.charge?`+${p.charge}`:'—'}</td>
                      <td style={{padding:'0.2rem 0.4rem',color:'#22d3ee'}}>{p.im?p.im.toFixed(3):'—'}</td>
                      <td style={{padding:'0.2rem 0.4rem',color:'#64748b'}}>{p.intensity?p.intensity.toExponential(2):'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedRun&&!loading&&dataPeps.length===0&&(
            <div style={{color:'#64748b',fontSize:'0.78rem',fontStyle:'italic',marginTop:'0.4rem'}}>
              No histone-mapped peptides in this run — try a run from a propionylation / histone enrichment experiment.
            </div>
          )}
        </div>
      );
    }

    // ── Panel 3: Tail Map ─────────────────────────────────────────────────────────
    function HistoneTailMap() {
      const cvRef = React.useRef(null);
      const [selected, setSelected] = React.useState(null);

      const HISTONES = [
        {name:'H3.1',color:'#d946ef',sites:[
          {pos:4, label:'K4', mods:['me1','me2','me3','ac'],hot:'me3'},
          {pos:9, label:'K9', mods:['me1','me2','me3','ac'],hot:'me3'},
          {pos:14,label:'K14',mods:['ac','cr'],hot:'ac'},
          {pos:18,label:'K18',mods:['ac'],hot:'ac'},
          {pos:23,label:'K23',mods:['ac'],hot:'ac'},
          {pos:27,label:'K27',mods:['me1','me2','me3','ac'],hot:'me3'},
          {pos:36,label:'K36',mods:['me1','me2','me3'],hot:'me2'},
          {pos:56,label:'K56',mods:['ac'],hot:'ac'},
        ]},
        {name:'H3.3',color:'#22d3ee',sites:[
          {pos:4, label:'K4', mods:['me1','me2','me3'],hot:'me3'},
          {pos:9, label:'K9', mods:['me3'],hot:'me3'},
          {pos:27,label:'K27',mods:['me3'],hot:'me3'},
          {pos:36,label:'K36',mods:['me3'],hot:'me3'},
        ]},
        {name:'H4',  color:'#DAAA00',sites:[
          {pos:5, label:'K5', mods:['ac'],hot:'ac'},
          {pos:8, label:'K8', mods:['ac'],hot:'ac'},
          {pos:12,label:'K12',mods:['ac'],hot:'ac'},
          {pos:16,label:'K16',mods:['ac'],hot:'ac'},
          {pos:20,label:'K20',mods:['me1','me2','me3'],hot:'me1'},
        ]},
        {name:'H2A', color:'#22c55e',sites:[
          {pos:5,  label:'K5',  mods:['ac'],hot:'ac'},
          {pos:15, label:'K15', mods:['ac','ub'],hot:'ub'},
          {pos:119,label:'K119',mods:['ub'],hot:'ub'},
        ]},
        {name:'H2B', color:'#f97316',sites:[
          {pos:5,  label:'K5',  mods:['ac'],hot:'ac'},
          {pos:12, label:'K12', mods:['ac'],hot:'ac'},
          {pos:15, label:'K15', mods:['ac'],hot:'ac'},
          {pos:20, label:'K20', mods:['ac'],hot:'ac'},
          {pos:120,label:'K120',mods:['ub'],hot:'ub'},
        ]},
      ];
      const MOD_COLOR={me1:'#60a5fa',me2:'#3b82f6',me3:'#1d4ed8',ac:'#DAAA00',cr:'#22d3ee',ph:'#ef4444',ub:'#a855f7'};
      const MOD_LABEL={me1:'mono-me',me2:'di-me',me3:'tri-me',ac:'acetyl',cr:'crotonyl',ph:'phospho',ub:'ubiquitin'};

      React.useEffect(()=>{
        const cv=cvRef.current; if(!cv) return;
        const ctx=cv.getContext('2d');
        const W=cv.width,H=cv.height;
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle='#06000f'; ctx.fillRect(0,0,W,H);
        const ROW_H=H/HISTONES.length, LEFT=58, RIGHT=W-18, MAX_POS=130;

        HISTONES.forEach((h,hi)=>{
          const y=hi*ROW_H+ROW_H/2;
          ctx.fillStyle=h.color; ctx.font='bold 11px system-ui'; ctx.textAlign='right';
          ctx.fillText(h.name,LEFT-8,y+4);
          ctx.strokeStyle=h.color+'44'; ctx.lineWidth=2;
          ctx.beginPath(); ctx.moveTo(LEFT,y); ctx.lineTo(RIGHT,y); ctx.stroke();
          const coreX=LEFT+(60/MAX_POS)*(RIGHT-LEFT);
          ctx.fillStyle=h.color+'10'; ctx.beginPath(); ctx.arc(coreX,y,15,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle=h.color+'33'; ctx.lineWidth=1; ctx.stroke();
          ctx.fillStyle=h.color+'55'; ctx.font='7px system-ui'; ctx.textAlign='center'; ctx.fillText('core',coreX,y+3);

          h.sites.forEach(s=>{
            const sx=LEFT+(s.pos/MAX_POS)*(RIGHT-LEFT);
            const isSel=selected&&selected.h===h.name&&selected.s===s.label;
            const col=MOD_COLOR[s.hot];
            ctx.strokeStyle=col+(isSel?'ff':'88'); ctx.lineWidth=isSel?2:1;
            ctx.beginPath(); ctx.moveTo(sx,y-14); ctx.lineTo(sx,y+14); ctx.stroke();
            ctx.beginPath(); ctx.arc(sx,y,isSel?6.5:4.5,0,Math.PI*2);
            ctx.fillStyle=col+(isSel?'ff':'cc'); ctx.fill();
            ctx.fillStyle=isSel?'#fff':'#4a5568'; ctx.font=isSel?'bold 9px system-ui':'8px system-ui'; ctx.textAlign='center';
            ctx.fillText(s.label,sx,y-18);
          });
        });
        const LY=H-13;
        Object.entries(MOD_COLOR).forEach(([mod,col],i)=>{
          const x=LEFT+i*86;
          ctx.beginPath(); ctx.arc(x+5,LY,4,0,Math.PI*2); ctx.fillStyle=col; ctx.fill();
          ctx.fillStyle='#6b7280'; ctx.font='7.5px system-ui'; ctx.textAlign='left';
          ctx.fillText(MOD_LABEL[mod],x+12,LY+3);
        });
      },[selected]);

      const handleClick=e=>{
        const cv=cvRef.current; if(!cv) return;
        const rect=cv.getBoundingClientRect();
        const mx=(e.clientX-rect.left)*(cv.width/rect.width);
        const my=(e.clientY-rect.top)*(cv.height/rect.height);
        const ROW_H=cv.height/HISTONES.length, LEFT=58, RIGHT=cv.width-18, MAX_POS=130;
        for(const h of HISTONES){
          for(const s of h.sites){
            const sx=LEFT+(s.pos/MAX_POS)*(RIGHT-LEFT);
            const sy=HISTONES.indexOf(h)*ROW_H+ROW_H/2;
            if(Math.hypot(mx-sx,my-sy)<10){
              setSelected(prev=>prev?.h===h.name&&prev?.s===s.label?null:{h:h.name,s:s.label,site:s});
              return;
            }
          }
        }
        setSelected(null);
      };

      const MOD_COLOR2={me1:'#60a5fa',me2:'#3b82f6',me3:'#1d4ed8',ac:'#DAAA00',cr:'#22d3ee',ph:'#ef4444',ub:'#a855f7'};
      const selSite=selected?HISTONES.find(h=>h.name===selected.h)?.sites.find(s=>s.label===selected.s):null;

      return(
        <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(160deg,rgba(10,0,25,0.98),rgba(1,15,35,0.9))'}}>
          <h3 style={{marginBottom:'0.25rem',background:'linear-gradient(90deg,#a855f7,#DAAA00)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            Histone Tail Modification Map
          </h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.55rem',lineHeight:1.5}}>
            Click any modification site to inspect its full PTM repertoire.
          </p>
          <canvas ref={cvRef} width={860} height={220} onClick={handleClick}
            style={{width:'100%',borderRadius:'0.4rem',cursor:'pointer',display:'block'}}/>
          {selSite&&(
            <div style={{marginTop:'0.5rem',padding:'0.5rem 0.8rem',background:'rgba(168,85,247,0.08)',border:'1px solid rgba(168,85,247,0.22)',borderRadius:'0.4rem',fontSize:'0.8rem'}}>
              <span style={{color:'#a855f7',fontWeight:700}}>{selected.h} {selSite.label}</span>
              <span style={{color:'var(--muted)',marginLeft:'0.65rem'}}>known marks: </span>
              {selSite.mods.map(m=>(
                <span key={m} style={{display:'inline-block',marginLeft:'0.35rem',padding:'0.1rem 0.38rem',borderRadius:'0.25rem',
                  background:MOD_COLOR2[m]+'22',color:MOD_COLOR2[m],fontWeight:700,fontSize:'0.73rem'}}>{m}</span>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── Panel 4: PTM Crosstalk Matrix ─────────────────────────────────────────────
    function HistoneCrosstalkMatrix() {
      const cvRef=React.useRef(null);
      const [hovCell,setHovCell]=React.useState(null);
      // 14 marks — added H4K9ac, H4K13ac, H4K17ac (Orsburn 2026 tri-ac cluster)
      const MARKS=['H3K4me3','H3K4me1','H3K9ac','H3K9me3','H3K14ac','H3K27ac','H3K27me3','H3K36me3','H4K9ac','H4K13ac','H4K17ac','H4K16ac','H4K20me1','H3K24ac'];
      const MATRIX=React.useMemo(()=>{
        const M={};
        const s=(a,b,score,type)=>{M[`${a},${b}`]={score,type};M[`${b},${a}`]={score,type};};
        // Active marks
        s('H3K4me3','H3K9ac',0.87,'active');s('H3K4me3','H3K14ac',0.81,'active');
        s('H3K4me3','H3K27ac',0.72,'active');s('H3K4me1','H3K27ac',0.91,'active');
        s('H3K9ac','H3K14ac',0.78,'active');s('H3K36me3','H3K9ac',0.55,'active');
        s('H4K16ac','H3K4me3',0.65,'active');s('H4K16ac','H3K27ac',0.61,'active');
        s('H3K24ac','H3K9ac',0.74,'active');s('H3K24ac','H3K14ac',0.68,'active');
        // H4 tri-ac cluster — Orsburn 2026: co-regulated by class I HDACs
        s('H4K9ac','H4K13ac',0.92,'active');s('H4K9ac','H4K17ac',0.89,'active');
        s('H4K13ac','H4K17ac',0.93,'active');  // highest — co-acetylated in same peptide
        s('H4K9ac','H4K16ac',0.71,'active');s('H4K13ac','H4K16ac',0.66,'active');
        s('H4K9ac','H3K24ac',0.58,'active');   // mocetinostat co-response
        // Repressive
        s('H3K9me3','H3K27me3',0.62,'repressive');s('H4K20me1','H3K27me3',0.43,'repressive');
        // Bivalent
        s('H3K4me3','H3K27me3',0.58,'bivalent');s('H3K4me1','H3K27me3',0.39,'bivalent');
        // Conflict — mutually exclusive
        s('H3K9me3','H3K9ac',0.04,'conflict');s('H3K27me3','H3K27ac',0.03,'conflict');
        s('H3K36me3','H3K27me3',0.08,'conflict');
        s('H4K9ac','H3K9me3',0.05,'conflict');  // acetylation vs methylation competition
        return M;
      },[]);
      const TYPE_COL={active:'#22c55e',repressive:'#ef4444',bivalent:'#a855f7',conflict:'#f97316',neutral:'#1e293b'};

      React.useEffect(()=>{
        const cv=cvRef.current; if(!cv) return;
        const ctx=cv.getContext('2d');
        const W=cv.width,H=cv.height,N=MARKS.length,PAD=90;
        const CELL=Math.floor((Math.min(W,H)-PAD)/N);
        ctx.clearRect(0,0,W,H); ctx.fillStyle='#06000f'; ctx.fillRect(0,0,W,H);
        MARKS.forEach((m,i)=>{
          ctx.save(); ctx.translate(PAD+i*CELL+CELL/2,PAD-7); ctx.rotate(-Math.PI/4);
          ctx.fillStyle='#64748b'; ctx.font='8.5px system-ui'; ctx.textAlign='right'; ctx.fillText(m,0,0); ctx.restore();
          ctx.fillStyle='#64748b'; ctx.font='8.5px system-ui'; ctx.textAlign='right'; ctx.fillText(m,PAD-7,PAD+i*CELL+CELL/2+3);
        });
        MARKS.forEach((ma,i)=>MARKS.forEach((mb,j)=>{
          const x=PAD+j*CELL,y=PAD+i*CELL;
          const cell=MATRIX[`${ma},${mb}`];
          const isHov=hovCell&&hovCell.i===i&&hovCell.j===j;
          if(i===j){ctx.fillStyle='#DAAA0018';ctx.fillRect(x,y,CELL-1,CELL-1);ctx.fillStyle='#DAAA0055';ctx.font='bold 8px system-ui';ctx.textAlign='center';ctx.fillText('—',x+CELL/2,y+CELL/2+3);}
          else if(cell){
            const col=TYPE_COL[cell.type];
            const alpha=Math.round(cell.score*200).toString(16).padStart(2,'0');
            ctx.fillStyle=col+alpha; ctx.fillRect(x,y,CELL-1,CELL-1);
            if(isHov){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.strokeRect(x,y,CELL-1,CELL-1);}
            ctx.fillStyle='#fff';ctx.font='bold 7px system-ui';ctx.textAlign='center';
            ctx.fillText((cell.score*100).toFixed(0)+'%',x+CELL/2,y+CELL/2+3);
          } else {ctx.fillStyle='#0d0020';ctx.fillRect(x,y,CELL-1,CELL-1);}
        }));
        const LY=PAD+N*CELL+12;
        Object.entries(TYPE_COL).filter(([t])=>t!=='neutral').forEach(([type,col],li)=>{
          const lx=PAD+li*115;
          ctx.fillStyle=col+'88';ctx.fillRect(lx,LY,13,10);
          ctx.fillStyle='#94a3b8';ctx.font='8.5px system-ui';ctx.textAlign='left';
          ctx.fillText(type.charAt(0).toUpperCase()+type.slice(1),lx+17,LY+8);
        });
      },[hovCell,MATRIX]);

      const handleMove=e=>{
        const cv=cvRef.current;if(!cv) return;
        const rect=cv.getBoundingClientRect();
        const mx=(e.clientX-rect.left)*(cv.width/rect.width);
        const my=(e.clientY-rect.top)*(cv.height/rect.height);
        const N=MARKS.length,PAD=90,CELL=Math.floor((Math.min(cv.width,cv.height)-PAD)/N);
        const j=Math.floor((mx-PAD)/CELL),i=Math.floor((my-PAD)/CELL);
        if(i>=0&&i<N&&j>=0&&j<N&&i!==j)setHovCell({i,j});else setHovCell(null);
      };
      const hovInfo=hovCell?MATRIX[`${MARKS[hovCell.i]},${MARKS[hovCell.j]}`]:null;
      const TYPE_COL2={active:'#22c55e',repressive:'#ef4444',bivalent:'#a855f7',conflict:'#f97316'};

      return(
        <div className="card" style={{marginBottom:'1rem'}}>
          <h3 style={{marginBottom:'0.25rem',background:'linear-gradient(90deg,#22d3ee,#a855f7)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>PTM Crosstalk Matrix</h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.55rem',lineHeight:1.5}}>
            Co-occurrence and functional relationships between histone marks. Hover a cell for details.
          </p>
          <canvas ref={cvRef} width={700} height={760} onMouseMove={handleMove} onMouseLeave={()=>setHovCell(null)}
            style={{width:'100%',maxWidth:'700px',borderRadius:'0.4rem',cursor:'crosshair'}}/>
          {hovCell&&hovInfo&&(
            <div style={{marginTop:'0.45rem',padding:'0.45rem 0.7rem',background:'rgba(0,0,0,0.4)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:'0.4rem',fontSize:'0.78rem',color:'var(--muted)'}}>
              <strong style={{color:'#e2e8f0'}}>{MARKS[hovCell.i]}</strong>{' × '}<strong style={{color:'#e2e8f0'}}>{MARKS[hovCell.j]}</strong>
              <span style={{marginLeft:'0.65rem',color:TYPE_COL2[hovInfo.type]||'#94a3b8',fontWeight:700}}>{hovInfo.type}</span>
              <span style={{marginLeft:'0.55rem'}}>co-occurrence: {(hovInfo.score*100).toFixed(0)}%</span>
              {hovInfo.type==='bivalent'&&<span style={{marginLeft:'0.55rem',fontStyle:'italic',color:'#64748b'}}>— stem cell poised state</span>}
              {hovInfo.type==='conflict'&&<span style={{marginLeft:'0.55rem',fontStyle:'italic',color:'#64748b'}}>— mutually exclusive; writer enzymes compete</span>}
            </div>
          )}
        </div>
      );
    }

    // ── Panel 5: Ion Mobility Landscape ──────────────────────────────────────────
    function HistoneIonMobility() {
      const cvRef=React.useRef(null);
      const CLOUDS=[
        {label:'H3 tail (propionyl)',color:'#d946ef',mzRange:[550,900],k0Range:[0.78,0.95],n:120},
        {label:'H3 tail (propionyl)',color:'#d946ef',mzRange:[380,600],k0Range:[0.95,1.12],n:90},
        {label:'H4 tail (propionyl)',color:'#DAAA00',mzRange:[480,760],k0Range:[0.75,0.88],n:80},
        {label:'H4 tail (propionyl)',color:'#DAAA00',mzRange:[340,520],k0Range:[0.88,1.05],n:60},
        {label:'Bulk tryptic (ref)', color:'#64748b', mzRange:[400,1100],k0Range:[0.65,1.35],n:300},
        {label:'Bulk tryptic (ref)', color:'#64748b', mzRange:[300,700], k0Range:[0.95,1.45],n:200},
        {label:'H2B tail',           color:'#f97316', mzRange:[520,820],k0Range:[0.80,0.96],n:70},
        {label:'H2A tail',           color:'#22c55e', mzRange:[500,800],k0Range:[0.77,0.92],n:65},
      ];
      React.useEffect(()=>{
        const cv=cvRef.current;if(!cv) return;
        const ctx=cv.getContext('2d');
        const W=cv.width,H=cv.height;
        const PAD={l:55,r:18,t:20,b:38};
        const MZ_MIN=280,MZ_MAX=1150,K0_MIN=0.55,K0_MAX=1.55;
        const toX=mz=>PAD.l+(mz-MZ_MIN)/(MZ_MAX-MZ_MIN)*(W-PAD.l-PAD.r);
        const toY=k0=>H-PAD.b-(k0-K0_MIN)/(K0_MAX-K0_MIN)*(H-PAD.t-PAD.b);
        ctx.fillStyle='#06000f';ctx.fillRect(0,0,W,H);
        ctx.strokeStyle='#1e293b';ctx.lineWidth=1;
        for(let mz=400;mz<=1100;mz+=100){ctx.beginPath();ctx.moveTo(toX(mz),PAD.t);ctx.lineTo(toX(mz),H-PAD.b);ctx.stroke();ctx.fillStyle='#64748b';ctx.font='8.5px system-ui';ctx.textAlign='center';ctx.fillText(mz,toX(mz),H-PAD.b+12);}
        for(let k=0.6;k<=1.5;k+=0.1){ctx.beginPath();ctx.moveTo(PAD.l,toY(k));ctx.lineTo(W-PAD.r,toY(k));ctx.stroke();ctx.fillStyle='#64748b';ctx.font='8.5px system-ui';ctx.textAlign='right';ctx.fillText(k.toFixed(1),PAD.l-4,toY(k)+3);}
        [[2,'#60a5fa22',0.70,1.10],[3,'#22d3ee22',0.88,1.40]].forEach(([z,col,klo,khi])=>{
          ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(toX(280+(z-1)*100),toY(klo));ctx.lineTo(toX(1150-(z-1)*200),toY(klo));ctx.lineTo(toX(1150-(z-1)*200),toY(khi));ctx.lineTo(toX(280+(z-1)*100),toY(khi));ctx.closePath();ctx.fill();
        });
        const rng=(seed)=>{let x=seed;return()=>{x=(x*16807)%2147483647;return(x-1)/2147483646;};};
        CLOUDS.forEach((cloud,ci)=>{
          const r=rng(ci*997+17);
          for(let i=0;i<cloud.n;i++){
            const mz=cloud.mzRange[0]+r()*(cloud.mzRange[1]-cloud.mzRange[0]);
            const k0=cloud.k0Range[0]+r()*(cloud.k0Range[1]-cloud.k0Range[0]);
            ctx.beginPath();ctx.arc(toX(mz),toY(k0),cloud.label.includes('Bulk')?1.5:2.5,0,Math.PI*2);
            ctx.fillStyle=cloud.color+(cloud.label.includes('Bulk')?'33':'aa');ctx.fill();
          }
        });
        ctx.strokeStyle='#DAAA0055';ctx.lineWidth=1.5;ctx.setLineDash([4,4]);
        ctx.strokeRect(toX(340),toY(1.15),toX(920)-toX(340),toY(0.72)-toY(1.15));
        ctx.setLineDash([]);
        ctx.fillStyle='#DAAA0088';ctx.font='bold 8.5px system-ui';ctx.textAlign='left';
        ctx.fillText('Histone-enriched zone',toX(345),toY(1.14)-3);
        ctx.fillStyle='#94a3b8';ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText('m/z',W/2,H-4);
        ctx.save();ctx.translate(13,H/2);ctx.rotate(-Math.PI/2);ctx.fillText('1/K₀ (Vs/cm²)',0,0);ctx.restore();
      },[]);
      const LEGEND=[
        {label:'H3 tail (propionylated)',color:'#d946ef'},
        {label:'H4 tail (propionylated)',color:'#DAAA00'},
        {label:'H2B tail',color:'#f97316'},
        {label:'H2A tail',color:'#22c55e'},
        {label:'Bulk tryptic proteome (reference)',color:'#64748b'},
      ];
      return(
        <div className="card" style={{marginBottom:'1rem'}}>
          <h3 style={{marginBottom:'0.25rem',background:'linear-gradient(90deg,#DAAA00,#22d3ee)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Histone Peptide Ion Mobility Landscape</h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.55rem',lineHeight:1.5}}>
            Propionylated histone peptides cluster in a distinct zone of m/z × 1/K₀ space, separable from bulk tryptic background.
          </p>
          <canvas ref={cvRef} width={860} height={340} style={{width:'100%',borderRadius:'0.4rem',display:'block',marginBottom:'0.45rem'}}/>
          <div style={{display:'flex',flexWrap:'wrap',gap:'0.5rem'}}>
            {LEGEND.map(l=>(
              <div key={l.label} style={{display:'flex',alignItems:'center',gap:'0.3rem',fontSize:'0.73rem',color:'#64748b'}}>
                <span style={{width:'9px',height:'9px',borderRadius:'50%',background:l.color,flexShrink:0,display:'inline-block'}}/>
                {l.label}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ── Panel 6: Propionylation Workflow ──────────────────────────────────────────
    function HistonePropWorkflow() {
      const STEPS=[
        {n:1,title:'Isolate Histones',desc:'Extract with 0.4M H₂SO₄ or histone prep kit. Acid precipitation removes non-histone proteins. Enrichment is essential — standard lysis destroys modification patterns.',color:'#60a5fa'},
        {n:2,title:'Propionylation Round 1',desc:'Propionate unmodified K and peptide N-termini with propionic anhydride (+56 Da). Distinguishes unmod-K from acetyl-K (+42 Da). Also prevents trypsin from cutting at unmodified K residues.',color:'#DAAA00'},
        {n:3,title:'Trypsin Digest',desc:'Trypsin now cuts only at Arg. Produces longer peptides (6–20 aa) spanning multiple modification sites — enabling combinatorial PTM detection impossible with standard digestion.',color:'#22c55e'},
        {n:4,title:'Propionylation Round 2',desc:'Second round blocks newly exposed peptide N-termini. Equalizes ionization efficiency across peptides and improves LC retention of highly basic histone peptides on reversed-phase columns.',color:'#d946ef'},
        {n:5,title:'timsTOF LC-MS/MS',desc:'Reversed-phase LC (pH 2.5) + timsTOF. The 4th dimension (1/K₀) separates co-eluting peptides with identical mass but different methylation states — separations that require HPLC pre-fractionation on Orbitraps. Diagnostic ion 126.0913 m/z confirms acetyl-K independently of database search.',color:'#22d3ee'},
        {n:6,title:'Quantification',desc:'LFQ or SILAC heavy standards per modification site. Report relative abundance: me1/me2/me3/ac/unmod per site per condition. This matrix feeds directly into crosstalk analysis.',color:'#f97316'},
        {n:7,title:'Single-Cell Extension (Orsburn 2026)',desc:'For single-cell work: flow-sort individual cells → lyse on microplates → trypsin digest → label with TMTPro isobaric tags (18-plex) → pool → run on timsTOF SCP + EvoSep One in ddaPASEF mode. Achieves 342–453 proteins/cell at 210–700 cells/day. Detects 16 histone PTM combinations and full proteome changes (e.g. S100-A9) simultaneously.',color:'#a855f7'},
      ];
      return(
        <div className="card" style={{marginBottom:'1rem'}}>
          <h3 style={{marginBottom:'0.25rem',color:'#94a3b8'}}>Propionylation Workflow — Histone-Specific MS Sample Prep</h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.65rem',lineHeight:1.5}}>
            Standard proteomics destroys histone modification information. This derivatization strategy preserves and amplifies it.
          </p>
          <div style={{display:'flex',flexDirection:'column',gap:'0.4rem'}}>
            {STEPS.map(s=>(
              <div key={s.n} style={{display:'flex',gap:'0.7rem',alignItems:'flex-start',padding:'0.5rem 0.7rem',
                background:'rgba(0,0,0,0.3)',borderRadius:'0.4rem',border:`1px solid ${s.color}22`}}>
                <div style={{flexShrink:0,width:'22px',height:'22px',borderRadius:'50%',background:s.color+'22',
                  border:`1px solid ${s.color}55`,display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:'0.72rem',fontWeight:800,color:s.color}}>{s.n}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:'0.83rem',color:s.color,marginBottom:'0.15rem'}}>{s.title}</div>
                  <div style={{fontSize:'0.76rem',color:'#94a3b8',lineHeight:1.6}}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ── Panel: Live Data from real runs ──────────────────────────────────────────
    function HistoneLiveData() {
      const CANONICAL = {
        'H3.1':'ARTKQTARKSTGGKAPRKQLATKAARKSAPATGGVKKPHRYRPGTVALREIRRYQKSTELLIRKLPFQRLVREIAQDFKTDLRFQSSAVMALQEACEAYLVGLFEDTNLCAIHAKRVTIMPKDIQLARRIRGERA',
        'H3.3':'ARTKQTARKSTGGKAPRKQLASKAARKSGPATGGVKKPHRYRPGTVALREIRRYQKSTELLIRKLPFQRLVREIAQDFKTDLRFQSSAVMALQEACEAYLVGLFEDTNLCAIHAKRVTIMPKDIQLARRIRGERA',
        'H4':  'SGRGKGGKGLGKGGAKRHRKVLRDNIQGITKPAIRRLARRGGVKRISGLIYEETRGVLKVFLENVIRDAVTYTEHAKRKTVTAMDVVYALKRQGRTLYGFGG',
        'H2A': 'SGRGKQGGKTRAKAKTRSSRAGLQFPVGRVHRHLKSRTTSHGRVGATAAVYSAAILEYLTAEVLELAGNASKDLKVKRITPRHLQLAIRGDEELDSLIK',
        'H2B': 'PEPAKSAPAPKKGSKKAVTKAQKKDGKKRKRSRKESYSVYVYKVLKQVHPDTGISSKAMGIMNSFVNDIFERIAGEASRLAHYNKRSTITSREIQTAVRLLLPGELAKHAVSEGTKAVTKYTSSK',
      };
      const HIST_COL={'H3.1':'#d946ef','H3.3':'#a855f7','H4':'#DAAA00','H2A':'#22c55e','H2B':'#f97316'};

      // UniMod ID → PTM info
      const UNIMOD = {
        1:{name:'ac',  label:'Acetyl',          col:'#DAAA00', mass:42.011},
        21:{name:'ph', label:'Phospho',          col:'#ef4444', mass:79.966},
        34:{name:'me1',label:'Mono-methyl',      col:'#93c5fd', mass:14.016},
        36:{name:'me2',label:'Di-methyl',        col:'#60a5fa', mass:28.031},
        37:{name:'me3',label:'Tri-methyl',       col:'#2563eb', mass:42.047},
        121:{name:'ub',label:'GlyGly (ub)',      col:'#a855f7', mass:114.043},
        58:{name:'cr', label:'Crotonyl',         col:'#22d3ee', mass:68.026},
        2:{name:'prop',label:'Propionyl (prep)', col:'#475569', mass:56.026},
        4:{name:'cam', label:'Carbamidomethyl',  col:'#334155', mass:57.021},
      };
      const MASS_PTMS = [
        {name:'me1',mass:14.016,tol:0.020,col:'#93c5fd',label:'Mono-methyl'},
        {name:'me2',mass:28.031,tol:0.020,col:'#60a5fa',label:'Di-methyl'},
        {name:'me3',mass:42.047,tol:0.020,col:'#2563eb',label:'Tri-methyl'},
        {name:'ac', mass:42.011,tol:0.020,col:'#DAAA00',label:'Acetyl'},
        {name:'ph', mass:79.966,tol:0.020,col:'#ef4444',label:'Phospho'},
        {name:'ub', mass:114.043,tol:0.025,col:'#a855f7',label:'GlyGly (ub)'},
        {name:'cr', mass:68.026,tol:0.020,col:'#22d3ee',label:'Crotonyl'},
        {name:'prop',mass:56.026,tol:0.020,col:'#475569',label:'Propionyl (prep)'},
        {name:'cam',mass:57.021,tol:0.020,col:'#334155',label:'Carbamidomethyl'},
      ];

      // Parse DIA-NN Modified.Sequence → list of {aaIdx, aa, mod}
      function parseModSeq(modSeq) {
        if (!modSeq) return [];
        const s = modSeq.replace(/^_|_$/g,'');
        const out = []; let i=0, aaIdx=0;
        while(i<s.length) {
          const c=s[i];
          if(/[A-Z]/.test(c)) {
            const curIdx=aaIdx++; i++;
            if(i<s.length&&(s[i]==='['||s[i]==='(')) {
              const close=s[i]==='['?']':')';
              const end=s.indexOf(close,i);
              if(end!==-1) {
                const inner=s.slice(i+1,end);
                // identify mod
                const unimodM=inner.match(/UniMod:(\d+)/i);
                let modInfo=null;
                if(unimodM) { modInfo=UNIMOD[parseInt(unimodM[1])]||{name:'?',label:`UniMod:${unimodM[1]}`,col:'#64748b'}; }
                else {
                  const massM=inner.match(/\+([0-9.]+)/);
                  if(massM) {
                    const mv=parseFloat(massM[1]);
                    modInfo=MASS_PTMS.find(p=>Math.abs(mv-p.mass)<=p.tol)||{name:'novel',label:`+${mv.toFixed(3)} Da`,col:'#ff6b6b',novel:true};
                  }
                }
                if(modInfo&&modInfo.name!=='cam'&&modInfo.name!=='prop') out.push({aaIdx:curIdx,aa:c,mod:modInfo});
                i=end+1;
              }
            }
          } else { i++; }
        }
        return out;
      }

      const { data: allRuns } = useFetch('/api/runs?limit=200');
      const runs = Array.isArray(allRuns) ? allRuns : [];
      const [selectedRunId, setSelectedRunId] = useState('');
      const [histPeps, setHistPeps] = useState([]);
      const [loading, setLoading] = useState(false);
      const [hov, setHov] = useState(null);
      const cvRef = useRef(null);
      const ptsRef = useRef([]); // screen coords for hit-test

      // Load + map peptides when run changes
      useEffect(()=>{
        if(!selectedRunId){setHistPeps([]);return;}
        setLoading(true); setHistPeps([]);
        fetch(API+`/api/runs/${selectedRunId}/peptides?q=&limit=500`)
          .then(r=>r.ok?r.json():[])
          .then(peps=>{
            const hits=[]; const seen=new Set();
            (peps||[]).forEach(p=>{
              const stripped=(p.stripped||'').toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g,'');
              if(!stripped||stripped.length<5||seen.has(stripped)) return;
              for(const [h,canon] of Object.entries(CANONICAL)){
                const pos=canon.indexOf(stripped);
                if(pos!==-1){
                  seen.add(stripped);
                  hits.push({
                    histone:h, start:pos, end:pos+stripped.length,
                    stripped, mods:parseModSeq(p.sequence||''),
                    modSeqRaw:p.sequence||stripped,
                    mz:p.mz||0, charge:p.charge||2,
                    mobility:p.mobility||null,
                    rt:p.rt||0, intensity:p.intensity||0,
                  });
                  break;
                }
              }
            });
            hits.sort((a,b)=>(b.intensity||0)-(a.intensity||0));
            setHistPeps(hits); setLoading(false);
          }).catch(()=>setLoading(false));
      },[selectedRunId]);

      // Draw scatter when data changes
      useEffect(()=>{
        const cv=cvRef.current; if(!cv) return;
        const ctx=cv.getContext('2d');
        const W=cv.width, H=cv.height;
        const PAD={l:54,r:18,t:22,b:40};
        const MZ_MIN=280,MZ_MAX=1200,K0_MIN=0.52,K0_MAX=1.60;
        const toX=mz=>PAD.l+(mz-MZ_MIN)/(MZ_MAX-MZ_MIN)*(W-PAD.l-PAD.r);
        const toY=k0=>H-PAD.b-(k0-K0_MIN)/(K0_MAX-K0_MIN)*(H-PAD.t-PAD.b);

        ctx.fillStyle='#06000f'; ctx.fillRect(0,0,W,H);
        // grid
        ctx.strokeStyle='#1a1035'; ctx.lineWidth=1;
        for(let mz=400;mz<=1100;mz+=100){ctx.beginPath();ctx.moveTo(toX(mz),PAD.t);ctx.lineTo(toX(mz),H-PAD.b);ctx.stroke();ctx.fillStyle='#64748b';ctx.font='8.5px system-ui';ctx.textAlign='center';ctx.fillText(mz,toX(mz),H-PAD.b+12);}
        for(let k=0.6;k<=1.5;k+=0.1){ctx.beginPath();ctx.moveTo(PAD.l,toY(k));ctx.lineTo(W-PAD.r,toY(k));ctx.stroke();ctx.fillStyle='#64748b';ctx.font='8.5px system-ui';ctx.textAlign='right';ctx.fillText(k.toFixed(1),PAD.l-4,toY(k)+3);}
        // charge corridors
        [[2,'rgba(96,165,250,0.06)',0.68,1.12],[3,'rgba(34,211,238,0.06)',0.86,1.42]].forEach(([z,col,klo,khi])=>{
          ctx.fillStyle=col;ctx.fillRect(toX(280+(z-1)*100),toY(khi),toX(1150-(z-1)*200)-toX(280+(z-1)*100),toY(klo)-toY(khi));
          ctx.fillStyle='#64748b';ctx.font='7px system-ui';ctx.textAlign='left';ctx.fillText(`z+${z}`,toX(280+(z-1)*100)+2,toY(khi)+9);
        });
        // histone zone
        ctx.strokeStyle='rgba(218,170,0,0.35)'; ctx.lineWidth=1.2; ctx.setLineDash([4,4]);
        ctx.strokeRect(toX(340),toY(1.18),toX(950)-toX(340),toY(0.70)-toY(1.18));
        ctx.setLineDash([]);
        ctx.fillStyle='rgba(218,170,0,0.6)';ctx.font='bold 8px system-ui';ctx.textAlign='left';
        ctx.fillText('Histone-enriched zone',toX(345),toY(1.17)-3);

        // axis labels
        ctx.fillStyle='#94a3b8';ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText('m/z',W/2,H-4);
        ctx.save();ctx.translate(13,H/2);ctx.rotate(-Math.PI/2);ctx.fillText('1/K₀ (Vs/cm²)',0,0);ctx.restore();

        if(histPeps.length===0){
          ctx.fillStyle='#64748b';ctx.font='14px system-ui';ctx.textAlign='center';
          ctx.fillText('Select a run to plot your histone peptides here',W/2,H/2);
          ptsRef.current=[];
          return;
        }

        // intensity range for sizing
        const maxI=Math.max(...histPeps.map(p=>p.intensity||1));
        const pts=[];

        histPeps.forEach((p,i)=>{
          if(!p.mz||!p.mobility) return;
          const x=toX(p.mz), y=toY(p.mobility);
          if(x<PAD.l||x>W-PAD.r||y<PAD.t||y>H-PAD.b) return;
          const col=HIST_COL[p.histone]||'#94a3b8';
          const sz=3+Math.sqrt(p.intensity/maxI)*8;
          const isHov=hov===i;
          // glow
          if(isHov){
            const g=ctx.createRadialGradient(x,y,0,x,y,sz*4);
            g.addColorStop(0,col+'66'); g.addColorStop(1,col+'00');
            ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,sz*4,0,Math.PI*2); ctx.fill();
          }
          // mod ring
          if(p.mods.length>0){
            ctx.beginPath(); ctx.arc(x,y,sz+2.5,0,Math.PI*2);
            ctx.strokeStyle=p.mods[0].mod.col+'cc'; ctx.lineWidth=1.5; ctx.stroke();
          }
          // dot
          ctx.beginPath(); ctx.arc(x,y,isHov?sz*1.4:sz,0,Math.PI*2);
          ctx.fillStyle=col+(isHov?'ff':'cc'); ctx.fill();
          pts.push({i,x,y,p});
        });
        ptsRef.current=pts;

        // hov tooltip
        if(hov!==null){
          const pt=pts.find(pt=>pt.i===hov);
          if(pt){
            const {p,x,y}=pt;
            const col=HIST_COL[p.histone]||'#94a3b8';
            const tw=Math.max(180,p.stripped.length*7+20);
            const tx=Math.min(x+10,W-tw-4), ty=Math.max(y-60,PAD.t+2);
            ctx.fillStyle='rgba(14,0,24,0.92)';
            ctx.strokeStyle=col+'88'; ctx.lineWidth=1;
            const rr=(rx,ry,rw,rh,r)=>{ctx.beginPath();ctx.moveTo(rx+r,ry);ctx.arcTo(rx+rw,ry,rx+rw,ry+rh,r);ctx.arcTo(rx+rw,ry+rh,rx,ry+rh,r);ctx.arcTo(rx,ry+rh,rx,ry,r);ctx.arcTo(rx,ry,rx+rw,ry,r);ctx.closePath();};
            const th=p.mods.length>0?82:68;
            rr(tx,ty,tw,th,5); ctx.fill(); ctx.stroke();
            ctx.font='bold 10px system-ui'; ctx.textAlign='left'; ctx.fillStyle=col;
            ctx.fillText(`${p.histone} · pos ${p.start+1}–${p.end}`,tx+7,ty+14);
            ctx.font='9px monospace'; ctx.fillStyle='#e2e8f0';
            ctx.fillText(p.stripped,tx+7,ty+27);
            ctx.font='8.5px system-ui'; ctx.fillStyle='#94a3b8';
            ctx.fillText(`m/z ${p.mz.toFixed(3)}  z+${p.charge}  1/K₀ ${p.mobility.toFixed(3)}`,tx+7,ty+41);
            ctx.fillText(`RT ${p.rt.toFixed(1)} min  Intensity ${p.intensity.toExponential(2)}`,tx+7,ty+54);
            if(p.mods.length>0){
              const modStr=p.mods.map(m=>`${m.aa}${m.aaIdx+1}(${m.mod.label})`).join(', ');
              ctx.fillStyle='#DAAA00'; ctx.font='bold 8px system-ui';
              ctx.fillText('PTMs: '+modStr,tx+7,ty+67);
            }
          }
        }
      },[histPeps,hov]);

      const handleMouseMove=e=>{
        const cv=cvRef.current; if(!cv||!ptsRef.current.length) return;
        const rect=cv.getBoundingClientRect();
        const mx=(e.clientX-rect.left)*(cv.width/rect.width);
        const my=(e.clientY-rect.top)*(cv.height/rect.height);
        let best=null, bestD=18;
        ptsRef.current.forEach(pt=>{
          const d=Math.hypot(mx-pt.x,my-pt.y);
          if(d<bestD){bestD=d;best=pt.i;}
        });
        setHov(best);
      };

      // Stats
      const byHistone = React.useMemo(()=>{
        const m={};
        histPeps.forEach(p=>{m[p.histone]=(m[p.histone]||0)+1;});
        return m;
      },[histPeps]);

      const modCounts = React.useMemo(()=>{
        const m={};
        histPeps.forEach(p=>p.mods.forEach(mod=>{
          const k=mod.mod.label;
          m[k]=(m[k]||{count:0,col:mod.mod.col,name:mod.mod.name});
          m[k].count++;
        }));
        return Object.entries(m).sort((a,b)=>b[1].count-a[1].count);
      },[histPeps]);

      const novelPeps = histPeps.filter(p=>p.mods.some(m=>m.mod.novel));

      const withIM = histPeps.filter(p=>p.mobility&&p.mobility>0).length;

      return (
        <div>
          {/* Header + run selector */}
          <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(135deg,rgba(14,0,24,0.98),rgba(1,15,35,0.92))',border:'1px solid rgba(217,70,239,0.25)'}}>
            <h3 style={{marginBottom:'0.4rem',background:'linear-gradient(90deg,#d946ef,#DAAA00)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
              Live Histone Data — Your Runs
            </h3>
            <p style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.7rem',lineHeight:1.5}}>
              Select any run. ZIGGY searches the DIA-NN report for peptides that map to canonical histone sequences,
              parses their modifications (me1/2/3, ac, ph, ub, cr) from the Modified.Sequence field,
              and plots them in real m/z × 1/K₀ space.
            </p>
            <div style={{display:'flex',gap:'0.6rem',alignItems:'center',flexWrap:'wrap'}}>
              <select value={selectedRunId} onChange={e=>setSelectedRunId(e.target.value)}
                style={{flex:1,maxWidth:'460px',padding:'0.35rem 0.55rem',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'0.35rem',color:'#e2e8f0',fontSize:'0.82rem'}}>
                <option value="">— select a run —</option>
                {runs.map(r=><option key={r.id} value={r.id}>{r.run_name}</option>)}
              </select>
              {loading&&<span style={{color:'var(--muted)',fontSize:'0.78rem'}}>searching peptides…</span>}
              {!loading&&histPeps.length>0&&(
                <span style={{color:'#22c55e',fontSize:'0.78rem',fontWeight:600}}>
                  {histPeps.length} histone peptide{histPeps.length!==1?'s':''} · {withIM} with 1/K₀
                </span>
              )}
              {!loading&&selectedRunId&&histPeps.length===0&&(
                <span style={{color:'#64748b',fontSize:'0.78rem',fontStyle:'italic'}}>
                  No histone-mapping peptides found. Try a histone enrichment run (propionylation workflow).
                </span>
              )}
            </div>
          </div>

          {/* Stats row */}
          {histPeps.length>0&&(
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:'0.5rem',marginBottom:'1rem'}}>
              {Object.entries(byHistone).map(([h,n])=>(
                <div key={h} style={{background:'rgba(0,0,0,0.4)',border:`1px solid ${HIST_COL[h]||'#444'}33`,borderRadius:'0.4rem',padding:'0.5rem 0.7rem',textAlign:'center'}}>
                  <div style={{fontSize:'1.4rem',fontWeight:900,color:HIST_COL[h]||'#94a3b8'}}>{n}</div>
                  <div style={{fontSize:'0.72rem',color:'#64748b'}}>{h} peptides</div>
                </div>
              ))}
              {modCounts.slice(0,4).map(([label,info])=>(
                <div key={label} style={{background:'rgba(0,0,0,0.4)',border:`1px solid ${info.col}33`,borderRadius:'0.4rem',padding:'0.5rem 0.7rem',textAlign:'center'}}>
                  <div style={{fontSize:'1.4rem',fontWeight:900,color:info.col}}>{info.count}</div>
                  <div style={{fontSize:'0.72rem',color:'#64748b'}}>{label}</div>
                </div>
              ))}
              {novelPeps.length>0&&(
                <div style={{background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:'0.4rem',padding:'0.5rem 0.7rem',textAlign:'center'}}>
                  <div style={{fontSize:'1.4rem',fontWeight:900,color:'#ef4444'}}>{novelPeps.length}</div>
                  <div style={{fontSize:'0.72rem',color:'#ef4444'}}>novel mass shifts</div>
                </div>
              )}
            </div>
          )}

          {/* Live scatter */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem',background:'rgba(0,0,0,0.5)'}}>
            <div style={{fontSize:'0.75rem',color:'#64748b',marginBottom:'0.4rem',display:'flex',gap:'1rem',flexWrap:'wrap'}}>
              <span style={{fontWeight:700,color:'#94a3b8'}}>m/z × 1/K₀ — Real Histone Peptides</span>
              {Object.entries(HIST_COL).map(([h,col])=>(
                <span key={h} style={{display:'flex',alignItems:'center',gap:'0.25rem'}}>
                  <span style={{width:'8px',height:'8px',borderRadius:'50%',background:col,display:'inline-block'}}/>
                  <span style={{color:'#6b7280'}}>{h}</span>
                </span>
              ))}
              <span style={{color:'#6b7280',fontStyle:'italic'}}>ring = modified · size = intensity · hover for details</span>
            </div>
            <canvas ref={cvRef} width={860} height={380} onMouseMove={handleMouseMove} onMouseLeave={()=>setHov(null)}
              style={{width:'100%',borderRadius:'0.4rem',display:'block',cursor:'crosshair'}}/>
          </div>

          {/* Novel mass shifts */}
          {novelPeps.length>0&&(
            <div className="card" style={{marginBottom:'1rem',border:'1px solid rgba(239,68,68,0.25)',background:'rgba(239,68,68,0.04)'}}>
              <h4 style={{color:'#ef4444',marginBottom:'0.5rem'}}>⚑ Novel / Unrecognized Mass Shifts</h4>
              <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.6rem',lineHeight:1.5}}>
                These peptides carry mass modifications that do not match any known histone PTM.
                They may represent truly novel marks, chemical artifacts, or combinations not in the reference set.
              </p>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.76rem'}}>
                <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                  {['Histone','Position','Sequence','Novel mod','m/z','1/K₀'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'0.2rem 0.4rem',color:'var(--muted)',fontWeight:600}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {novelPeps.slice(0,15).map((p,i)=>{
                    const nm=p.mods.filter(m=>m.mod.novel);
                    return(
                      <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                        <td style={{padding:'0.2rem 0.4rem',color:HIST_COL[p.histone]||'#94a3b8',fontWeight:700}}>{p.histone}</td>
                        <td style={{padding:'0.2rem 0.4rem',color:'#64748b'}}>{p.start+1}–{p.end}</td>
                        <td style={{padding:'0.2rem 0.4rem',fontFamily:'monospace',color:'#e2e8f0',fontSize:'0.73rem'}}>{p.stripped}</td>
                        <td style={{padding:'0.2rem 0.4rem'}}>{nm.map(m=>(
                          <span key={m.aaIdx} style={{display:'inline-block',marginRight:'0.3rem',padding:'0.08rem 0.35rem',borderRadius:'0.25rem',background:'rgba(239,68,68,0.15)',color:'#ef4444',fontWeight:700,fontSize:'0.7rem'}}>
                            {m.aa}{m.aaIdx+1} {m.mod.label}
                          </span>
                        ))}</td>
                        <td style={{padding:'0.2rem 0.4rem',color:'#94a3b8'}}>{p.mz?p.mz.toFixed(3):'—'}</td>
                        <td style={{padding:'0.2rem 0.4rem',color:'#22d3ee'}}>{p.mobility?p.mobility.toFixed(3):'—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Full peptide table */}
          {histPeps.length>0&&(
            <div className="card" style={{marginBottom:'1rem'}}>
              <h4 style={{marginBottom:'0.5rem',color:'#94a3b8'}}>All Detected Histone Peptides</h4>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.74rem'}}>
                  <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
                    {['Histone','Pos','Sequence','Modifications','m/z','z','1/K₀','RT','Intensity'].map(h=>(
                      <th key={h} style={{textAlign:'left',padding:'0.22rem 0.4rem',color:'var(--muted)',fontWeight:600}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {histPeps.slice(0,40).map((p,i)=>(
                      <tr key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
                        style={{borderBottom:'1px solid rgba(255,255,255,0.03)',background:hov===i?'rgba(217,70,239,0.07)':'i%2===0?rgba(255,255,255,0.01):transparent',cursor:'default'}}>
                        <td style={{padding:'0.18rem 0.4rem',color:HIST_COL[p.histone],fontWeight:700}}>{p.histone}</td>
                        <td style={{padding:'0.18rem 0.4rem',color:'#6b7280'}}>{p.start+1}–{p.end}</td>
                        <td style={{padding:'0.18rem 0.4rem',fontFamily:'monospace',color:'#e2e8f0',fontSize:'0.7rem'}}>{p.stripped}</td>
                        <td style={{padding:'0.18rem 0.4rem'}}>
                          {p.mods.length===0
                            ?<span style={{color:'#64748b',fontSize:'0.68rem'}}>unmod</span>
                            :p.mods.map(m=>(
                              <span key={m.aaIdx} style={{display:'inline-block',marginRight:'0.25rem',padding:'0.06rem 0.3rem',borderRadius:'0.2rem',background:m.mod.col+'22',color:m.mod.col,fontSize:'0.68rem',fontWeight:700}}>
                                {m.aa}{m.aaIdx+1} {m.mod.name}
                              </span>
                            ))
                          }
                        </td>
                        <td style={{padding:'0.18rem 0.4rem',color:'#94a3b8'}}>{p.mz?p.mz.toFixed(3):'—'}</td>
                        <td style={{padding:'0.18rem 0.4rem',color:'#94a3b8'}}>{p.charge?`+${p.charge}`:'—'}</td>
                        <td style={{padding:'0.18rem 0.4rem',color:'#22d3ee'}}>{p.mobility?p.mobility.toFixed(3):'—'}</td>
                        <td style={{padding:'0.18rem 0.4rem',color:'#64748b'}}>{p.rt?p.rt.toFixed(1):'—'}</td>
                        <td style={{padding:'0.18rem 0.4rem',color:'#6b7280'}}>{p.intensity?p.intensity.toExponential(2):'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {histPeps.length>40&&<div style={{color:'#64748b',fontSize:'0.72rem',marginTop:'0.4rem'}}>Showing top 40 of {histPeps.length}</div>}
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── Panel: Single-Cell PTM Network (Cutler/Ctortecka Nat Commun 2025 + Sidoli) ──
    function HistoneSCNetwork() {
      // ── 17 marks — adds H1K25ac, H1K26ac (Cutler 2025: H1 fully profiled) ────────
      // and H4K9ac, H4K13ac, H4K17ac (Orsburn 2026 tri-ac cluster)
      // Cutler 2025: 67 peptidoforms · 25 PTMs · H1/H2A/H2B/H3/H4 · cellenONE + timsTOF Ultra
      const MODS = [
        {id:'H3K4me1', col:'#93c5fd', grp:'active'},
        {id:'H3K4me3', col:'#2563eb', grp:'active'},
        {id:'H3K9ac',  col:'#DAAA00', grp:'active'},
        {id:'H3K14ac', col:'#f59e0b', grp:'active'},
        {id:'H3K27ac', col:'#f97316', grp:'active'},
        {id:'H3K36me3',col:'#0891b2', grp:'active'},
        {id:'H4K9ac',  col:'#fde047', grp:'active'},      // Orsburn 2026 tri-ac
        {id:'H4K13ac', col:'#facc15', grp:'active'},      // Orsburn 2026 tri-ac
        {id:'H4K17ac', col:'#eab308', grp:'active'},      // Orsburn 2026 tri-ac
        {id:'H4K16ac', col:'#22c55e', grp:'active'},
        {id:'H1K25ac', col:'#f0abfc', grp:'h1'},          // Cutler 2025 — H1 linker
        {id:'H1K26ac', col:'#e879f9', grp:'h1'},          // Cutler 2025 — H1 linker
        {id:'H3K9me2', col:'#a78bfa', grp:'repressive'},
        {id:'H3K9me3', col:'#7c3aed', grp:'repressive'},
        {id:'H3K27me2',col:'#f87171', grp:'repressive'},
        {id:'H3K27me3',col:'#ef4444', grp:'repressive'},
        {id:'H4K20me1',col:'#60a5fa', grp:'replication'},
      ];

      const DEMO = React.useMemo(()=>{
        let s=12345;
        const rng=()=>{ s=(s*1664525+1013904223)&0xffffffff; return((s>>>0)/0xffffffff); };
        const gauss=()=>{
          let u=0,v=0;
          while(!u)u=rng(); while(!v)v=rng();
          return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
        };
        // 4 populations — reflects Cutler 2025 sodium butyrate experiment
        // means: H3K4me1 H3K4me3 H3K9ac H3K14ac H3K27ac H3K36me3
        //        H4K9ac H4K13ac H4K17ac H4K16ac H1K25ac H1K26ac
        //        H3K9me2 H3K9me3 H3K27me2 H3K27me3 H4K20me1
        const TYPES=[
          { n:12, name:'Active',    col:'#22c55e',
            means:[0.35,0.55,0.42,0.38,0.45,0.52, 0.22,0.20,0.18, 0.48, 0.08,0.06, 0.05,0.04,0.06,0.03,0.30]},
          { n:10, name:'Silenced',  col:'#ef4444',
            means:[0.10,0.06,0.05,0.06,0.04,0.05, 0.05,0.04,0.04, 0.05, 0.04,0.04, 0.42,0.55,0.38,0.62,0.28]},
          { n:8,  name:'Bivalent',  col:'#a855f7',
            means:[0.20,0.40,0.22,0.20,0.18,0.30, 0.10,0.10,0.09, 0.22, 0.07,0.06, 0.15,0.12,0.30,0.42,0.32]},
          // 4th pop: NaBu-treated (HDAC inhibitor response — Cutler 2025)
          { n:10, name:'NaBu-treated', col:'#DAAA00',
            means:[0.38,0.52,0.65,0.60,0.58,0.48, 0.72,0.70,0.68, 0.65, 0.35,0.32, 0.03,0.02,0.04,0.02,0.18]},
        ];
        const cells=[], labels=[];
        TYPES.forEach((t,ti)=>{
          for(let c=0;c<t.n;c++){
            const row=t.means.map(m=>Math.max(0,Math.min(1,m+gauss()*0.09)));
            const total=row.reduce((a,b)=>a+b,0)||1;
            cells.push(row.map(v=>v/total));
            labels.push({type:ti,name:t.name,col:t.col,id:`Cell_${labels.length+1}`});
          }
        });
        return {cells,labels,mods:MODS,types:TYPES};
      },[]);

      // State
      const [dataMode,setDataMode]=useState('demo'); // 'demo'|'csv'|'runs'
      const [csvText,setCsvText]=useState('');
      const [parsedData,setParsedData]=useState(null); // {cells,labels,mods}
      const [subView,setSubView]=useState('network');
      const [corrThresh,setCorrThresh]=useState(0.35);
      const [selectedNode,setSelectedNode]=useState(null);
      const [csvError,setCsvError]=useState('');

      // Multi-run loader
      const {data:allRuns}=useFetch('/api/runs?limit=200');
      const runs=Array.isArray(allRuns)?allRuns:[];
      const [selectedRunIds,setSelectedRunIds]=useState(new Set());
      const [runLoading,setRunLoading]=useState(false);
      const [runData,setRunData]=useState(null);

      const activeData = dataMode==='demo' ? DEMO : (parsedData||runData);

      // ── CSV parser (Sidoli pipeline format) ──────────────────────────────────
      function parseCSV(txt) {
        try {
          const lines=txt.trim().split('\n').filter(l=>l.trim());
          if(lines.length<2) throw new Error('Need header + at least 1 data row');
          const header=lines[0].split(',').map(h=>h.trim());
          const modCols=header.slice(1); // skip Cell_ID column
          const cells=[], labels=[];
          lines.slice(1).forEach((line,i)=>{
            const parts=line.split(',').map(p=>p.trim());
            const id=parts[0]||`Cell_${i+1}`;
            const vals=parts.slice(1).map(Number);
            if(vals.length!==modCols.length) return;
            const total=vals.reduce((a,b)=>a+Math.abs(b),0)||1;
            cells.push(vals.map(v=>v/total));
            labels.push({type:0,name:'Loaded',col:'#22d3ee',id});
          });
          const mods=modCols.map((id,i)=>({id,col:MODS[i%MODS.length]?.col||'#94a3b8',grp:'loaded'}));
          setCsvError('');
          return {cells,labels,mods,types:[{name:'Loaded',col:'#22d3ee',n:cells.length}]};
        } catch(e) { setCsvError(e.message); return null; }
      }

      // ── Load from multiple runs ───────────────────────────────────────────────
      const loadRuns=async()=>{
        if(selectedRunIds.size<2){setCsvError('Select at least 2 runs (each = one cell)');return;}
        setRunLoading(true);
        const CANONICAL={'H3.1':'ARTKQTARKSTGGKAPRKQLATKAARKSAPATGGVKKPHRYRPGTVALREIRRYQKSTELLIRKLPFQRLVREIAQDFKTDLRFQSSAVMALQEACEAYLVGLFEDTNLCAIHAKRVTIMPKDIQLARRIRGERA','H4':'SGRGKGGKGLGKGGAKRHRKVLRDNIQGITKPAIRRLARRGGVKRISGLIYEETRGVLKVFLENVIRDAVTYTEHAKRKTVTAMDVVYALKRQGRTLYGFGG'};
        const MOD_SITES={'H3K4me3':3,'H3K9ac':8,'H3K9me3':8,'H3K14ac':13,'H3K27me3':26,'H3K27ac':26,'H3K36me3':35,'H4K20me1':19,'H4K16ac':15};
        // Build pseudo-matrix: for each run, sum intensity of peptides covering each mod site
        const siteMods=Object.keys(MOD_SITES);
        const cells=[], labels=[];
        for(const rid of selectedRunIds){
          const run=runs.find(r=>r.id===rid);
          try{
            const peps=await fetch(API+`/api/runs/${rid}/peptides?q=&limit=500`).then(r=>r.json());
            const siteIntensity=new Array(siteMods.length).fill(0);
            (peps||[]).forEach(p=>{
              const seq=(p.stripped||'').toUpperCase();
              for(const [h,canon] of Object.entries(CANONICAL)){
                const pos=canon.indexOf(seq);
                if(pos!==-1){
                  siteMods.forEach((mod,mi)=>{
                    const site=MOD_SITES[mod];
                    if(pos<=site&&pos+seq.length>site) siteIntensity[mi]+=(p.intensity||0);
                  });
                  break;
                }
              }
            });
            const total=siteIntensity.reduce((a,b)=>a+b,0)||1;
            cells.push(siteIntensity.map(v=>v/total));
            labels.push({type:0,name:run?.run_name||rid,col:'#d946ef',id:run?.run_name||rid});
          } catch(e){ /* skip */ }
        }
        const mods=siteMods.map((id,i)=>({id,col:MODS.find(m=>m.id===id)?.col||'#94a3b8',grp:'detected'}));
        setRunData(cells.length>=2?{cells,labels,mods,types:[{name:'Run',col:'#d946ef',n:cells.length}]}:null);
        if(cells.length<2) setCsvError('Not enough histone coverage across runs. Try runs with histone enrichment.');
        setRunLoading(false);
        if(cells.length>=2) setDataMode('runs');
      };

      // ── Pearson correlation matrix ────────────────────────────────────────────
      const corrMatrix=React.useMemo(()=>{
        if(!activeData) return null;
        const {cells,mods}=activeData;
        const N=mods.length, M=cells.length;
        const matrix=Array.from({length:N},()=>new Array(N).fill(0));
        const col=i=>cells.map(r=>r[i]||0);
        const mean=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
        const pearson=(a,b)=>{
          const ma=mean(a),mb=mean(b);
          let num=0,da=0,db=0;
          for(let k=0;k<a.length;k++){const ra=a[k]-ma,rb=b[k]-mb;num+=ra*rb;da+=ra*ra;db+=rb*rb;}
          return da&&db?num/Math.sqrt(da*db):0;
        };
        for(let i=0;i<N;i++) for(let j=0;j<N;j++) matrix[i][j]=pearson(col(i),col(j));
        return matrix;
      },[activeData]);

      // ── Force-directed network ────────────────────────────────────────────────
      const netCvRef=useRef(null);
      const nodesRef=useRef([]);
      const rafRef2=useRef(null);
      const dragRef=useRef(null);
      const alphaRef=useRef(1);

      useEffect(()=>{
        if(!activeData||!corrMatrix) return;
        const {mods}=activeData;
        const cv=netCvRef.current; if(!cv) return;
        const W=cv.width, H=cv.height, CX=W/2, CY=H/2, R=Math.min(W,H)*0.33;

        // Init nodes in circle
        nodesRef.current=mods.map((m,i)=>{
          const angle=(i/mods.length)*Math.PI*2-Math.PI/2;
          return {x:CX+Math.cos(angle)*R, y:CY+Math.sin(angle)*R, vx:0, vy:0, mod:m, i};
        });
        alphaRef.current=1;

        const edges=[];
        for(let i=0;i<mods.length;i++) for(let j=i+1;j<mods.length;j++){
          const c=corrMatrix[i][j];
          if(Math.abs(c)>=corrThresh) edges.push({i,j,c});
        }

        function tick(){
          const alpha=alphaRef.current;
          const nodes=nodesRef.current;
          // repulsion
          for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
            const dx=nodes[j].x-nodes[i].x, dy=nodes[j].y-nodes[i].y;
            const d=Math.sqrt(dx*dx+dy*dy)+0.01;
            const f=alpha*2800/(d*d);
            const fx=f*dx/d, fy=f*dy/d;
            nodes[i].vx-=fx; nodes[i].vy-=fy;
            nodes[j].vx+=fx; nodes[j].vy+=fy;
          }
          // spring edges
          edges.forEach(e=>{
            const ni=nodes[e.i], nj=nodes[e.j];
            const dx=nj.x-ni.x, dy=nj.y-ni.y;
            const d=Math.sqrt(dx*dx+dy*dy)+0.01;
            const target=e.c>0?100:180;
            const f=(d-target)*0.04*alpha;
            const fx=f*dx/d, fy=f*dy/d;
            ni.vx+=fx; ni.vy+=fy; nj.vx-=fx; nj.vy-=fy;
          });
          // gravity to center
          nodes.forEach(n=>{
            n.vx+=(CX-n.x)*0.004*alpha;
            n.vy+=(CY-n.y)*0.004*alpha;
          });
          // integrate
          nodes.forEach((n,i)=>{
            if(dragRef.current===i) return;
            n.vx*=0.82; n.vy*=0.82;
            n.x+=n.vx; n.y+=n.vy;
            n.x=Math.max(40,Math.min(W-40,n.x));
            n.y=Math.max(40,Math.min(H-40,n.y));
          });
          alphaRef.current=Math.max(0.001,alpha*0.995);
        }

        function draw(){
          const ctx=cv.getContext('2d');
          const nodes=nodesRef.current;
          ctx.clearRect(0,0,W,H);
          ctx.fillStyle='#06000f'; ctx.fillRect(0,0,W,H);

          // background nebula
          const neb=ctx.createRadialGradient(CX,CY,0,CX,CY,R*1.2);
          neb.addColorStop(0,'rgba(217,70,239,0.05)'); neb.addColorStop(1,'rgba(0,0,0,0)');
          ctx.fillStyle=neb; ctx.beginPath(); ctx.arc(CX,CY,R*1.2,0,Math.PI*2); ctx.fill();

          // edges
          edges.forEach(e=>{
            const ni=nodes[e.i], nj=nodes[e.j];
            const absC=Math.abs(e.c);
            const col=e.c>0?'#22c55e':'#ef4444';
            const w=0.8+absC*3.5;
            ctx.strokeStyle=col+Math.round(absC*180).toString(16).padStart(2,'0');
            ctx.lineWidth=w;
            ctx.beginPath(); ctx.moveTo(ni.x,ni.y); ctx.lineTo(nj.x,nj.y); ctx.stroke();
            // correlation label at midpoint
            if(absC>0.65){
              const mx=(ni.x+nj.x)/2, my=(ni.y+nj.y)/2;
              ctx.fillStyle=col+'cc'; ctx.font='7px system-ui'; ctx.textAlign='center';
              ctx.fillText((e.c>0?'+':'')+e.c.toFixed(2),mx,my-3);
            }
          });

          // nodes
          nodes.forEach((n,i)=>{
            const isSel=selectedNode===i;
            const sz=isSel?18:13;
            const col=n.mod.col;
            // glow
            const g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,sz*2.5);
            g.addColorStop(0,col+(isSel?'88':'44')); g.addColorStop(1,col+'00');
            ctx.fillStyle=g; ctx.beginPath(); ctx.arc(n.x,n.y,sz*2.5,0,Math.PI*2); ctx.fill();
            // outer ring for group
            const ringCol=n.mod.grp==='active'?'#22c55e33':n.mod.grp==='repressive'?'#ef444433':'#60a5fa33';
            ctx.beginPath(); ctx.arc(n.x,n.y,sz+3,0,Math.PI*2);
            ctx.strokeStyle=isSel?col+'ff':col+'66'; ctx.lineWidth=isSel?2:1; ctx.stroke();
            // node
            ctx.beginPath(); ctx.arc(n.x,n.y,sz,0,Math.PI*2);
            ctx.fillStyle=col+(isSel?'ff':'cc'); ctx.fill();
            // label
            const label=n.mod.id.replace('H3','').replace('H4','').replace('H2','');
            ctx.fillStyle='#fff'; ctx.font=`${isSel?'bold ':''} 7.5px system-ui`; ctx.textAlign='center';
            ctx.fillText(n.mod.id,n.x,n.y+sz+11);
          });

          // selected node: show correlations in legend
          if(selectedNode!==null&&nodes[selectedNode]){
            const n=nodes[selectedNode];
            const partners=edges.filter(e=>e.i===selectedNode||e.j===selectedNode)
              .sort((a,b)=>Math.abs(b.c)-Math.abs(a.c)).slice(0,6);
            const lx=10, ly=10;
            ctx.fillStyle='rgba(14,0,24,0.88)'; ctx.strokeStyle='rgba(255,255,255,0.1)';
            ctx.lineWidth=1;
            const bh=18+partners.length*16;
            ctx.beginPath(); ctx.roundRect(lx,ly,200,bh,5); ctx.fill(); ctx.stroke();
            ctx.fillStyle=n.mod.col; ctx.font='bold 9px system-ui'; ctx.textAlign='left';
            ctx.fillText(n.mod.id,lx+8,ly+13);
            partners.forEach((e,pi)=>{
              const other=nodes[e.i===selectedNode?e.j:e.i];
              const col=e.c>0?'#22c55e':'#ef4444';
              ctx.fillStyle=col; ctx.font='8px system-ui';
              ctx.fillText(`${other.mod.id}  ${e.c>0?'+':''}${e.c.toFixed(3)}`,lx+8,ly+27+pi*16);
            });
          }

          // legend
          ctx.fillStyle='#22c55e44'; ctx.fillRect(W-130,H-54,12,4); ctx.fillStyle='#22c55e'; ctx.font='8px system-ui'; ctx.textAlign='left'; ctx.fillText('positive correlation',W-114,H-50);
          ctx.fillStyle='#ef444444'; ctx.fillRect(W-130,H-40,12,4); ctx.fillStyle='#ef4444'; ctx.fillText('negative correlation',W-114,H-36);
          ctx.fillStyle='#64748b'; ctx.font='7px system-ui'; ctx.fillText(`threshold: |r| ≥ ${corrThresh.toFixed(2)}  ·  ${edges.length} edges`,W-130,H-22);
          ctx.fillStyle='#64748b'; ctx.fillText('drag nodes · click to inspect',W-130,H-10);

          if(alphaRef.current>0.01) tick();
          rafRef2.current=requestAnimationFrame(draw);
        }
        cancelAnimationFrame(rafRef2.current);
        rafRef2.current=requestAnimationFrame(draw);
        return()=>cancelAnimationFrame(rafRef2.current);
      },[activeData,corrMatrix,corrThresh,selectedNode]);

      // Drag handlers
      const getNode=(e,cv)=>{
        const rect=cv.getBoundingClientRect();
        const mx=(e.clientX-rect.left)*(cv.width/rect.width);
        const my=(e.clientY-rect.top)*(cv.height/rect.height);
        let best=null,bestD=20;
        nodesRef.current.forEach((n,i)=>{ const d=Math.hypot(mx-n.x,my-n.y); if(d<bestD){bestD=d;best=i;} });
        return best;
      };
      const onNetMouseDown=e=>{ const i=getNode(e,netCvRef.current); if(i!==null){dragRef.current=i;setSelectedNode(i);alphaRef.current=0.5;} };
      const onNetMouseMove=e=>{
        if(dragRef.current===null) return;
        const cv=netCvRef.current; const rect=cv.getBoundingClientRect();
        nodesRef.current[dragRef.current].x=(e.clientX-rect.left)*(cv.width/rect.width);
        nodesRef.current[dragRef.current].y=(e.clientY-rect.top)*(cv.height/rect.height);
        alphaRef.current=Math.max(alphaRef.current,0.3);
      };
      const onNetMouseUp=()=>{ dragRef.current=null; };
      const onNetClick=e=>{ const i=getNode(e,netCvRef.current); setSelectedNode(prev=>prev===i?null:i); };

      // ── Cell × PTM heatmap ───────────────────────────────────────────────────
      const heatCvRef=useRef(null);
      const [heatHov,setHeatHov]=useState(null);
      const heatPtsRef=useRef([]);

      useEffect(()=>{
        if(!activeData) return;
        const cv=heatCvRef.current; if(!cv) return;
        const ctx=cv.getContext('2d');
        const {cells,labels,mods}=activeData;
        const W=cv.width, H=cv.height;
        const PAD={l:90,r:10,t:60,b:10};
        const CW=(W-PAD.l-PAD.r)/mods.length;
        const CH=Math.min(18,(H-PAD.t-PAD.b)/cells.length);
        ctx.clearRect(0,0,W,H); ctx.fillStyle='#06000f'; ctx.fillRect(0,0,W,H);

        // column headers (angled)
        mods.forEach((m,j)=>{
          const x=PAD.l+j*CW+CW/2;
          ctx.save(); ctx.translate(x,PAD.t-5); ctx.rotate(-Math.PI/4);
          ctx.fillStyle=m.col; ctx.font='7.5px system-ui'; ctx.textAlign='right';
          ctx.fillText(m.id,0,0); ctx.restore();
        });

        const pts=[];
        cells.forEach((row,i)=>{
          const y=PAD.t+i*CH;
          const lbl=labels[i];
          // row label
          ctx.fillStyle=lbl.col; ctx.font='7px system-ui'; ctx.textAlign='right';
          ctx.fillText(lbl.id.slice(-8),PAD.l-3,y+CH*0.7);
          // type color strip
          ctx.fillStyle=lbl.col+'88'; ctx.fillRect(PAD.l-10,y,5,CH-1);

          row.forEach((v,j)=>{
            const x=PAD.l+j*CW;
            const isHov=heatHov&&heatHov.i===i&&heatHov.j===j;
            // color: gold (high) → dark (low)
            const r=Math.round(v*218), g=Math.round(v*170), b=isHov?255:Math.round(v*30);
            ctx.fillStyle=`rgb(${r},${g},${b})`;
            ctx.fillRect(x,y,CW-1,CH-1);
            pts.push({i,j,x,y,w:CW-1,h:CH-1,v,seq:labels[i].id,mod:mods[j].id});
          });
        });
        heatPtsRef.current=pts;

        // tooltip
        if(heatHov){
          const pt=pts.find(p=>p.i===heatHov.i&&p.j===heatHov.j);
          if(pt){
            const tx=Math.min(pt.x+8,W-150), ty=Math.max(pt.y-30,2);
            ctx.fillStyle='rgba(14,0,24,0.9)'; ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1;
            ctx.beginPath(); ctx.roundRect(tx,ty,145,34,4); ctx.fill(); ctx.stroke();
            ctx.fillStyle='#e2e8f0'; ctx.font='bold 8px system-ui'; ctx.textAlign='left';
            ctx.fillText(`${pt.seq}  ×  ${pt.mod}`,tx+5,ty+13);
            ctx.fillStyle='#DAAA00'; ctx.font='8px system-ui';
            ctx.fillText(`Norm. abundance: ${(pt.v*100).toFixed(2)}%`,tx+5,ty+26);
          }
        }
      },[activeData,heatHov]);

      const onHeatMove=e=>{
        const cv=heatCvRef.current; if(!cv) return;
        const rect=cv.getBoundingClientRect();
        const mx=(e.clientX-rect.left)*(cv.width/rect.width);
        const my=(e.clientY-rect.top)*(cv.height/rect.height);
        const hit=heatPtsRef.current.find(p=>mx>=p.x&&mx<p.x+p.w&&my>=p.y&&my<p.y+p.h);
        setHeatHov(hit?{i:hit.i,j:hit.j}:null);
      };

      // ── Variance decomposition ───────────────────────────────────────────────
      const variance=React.useMemo(()=>{
        if(!activeData) return null;
        const {cells,mods}=activeData;
        return mods.map((m,j)=>{
          const vals=cells.map(r=>r[j]||0);
          const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
          const variance=vals.reduce((a,b)=>a+(b-mean)**2,0)/vals.length;
          const cv=mean>0?Math.sqrt(variance)/mean:0;
          return {mod:m,mean,variance,cv,sd:Math.sqrt(variance)};
        }).sort((a,b)=>b.cv-a.cv);
      },[activeData]);

      const varCvRef=useRef(null);
      useEffect(()=>{
        if(!variance) return;
        const cv=varCvRef.current; if(!cv) return;
        const ctx=cv.getContext('2d');
        const W=cv.width, H=cv.height;
        const PAD={l:110,r:20,t:20,b:30};
        ctx.clearRect(0,0,W,H); ctx.fillStyle='#06000f'; ctx.fillRect(0,0,W,H);
        const maxCV=Math.max(...variance.map(v=>v.cv));
        const barH=Math.min(24,(H-PAD.t-PAD.b)/variance.length);
        variance.forEach((v,i)=>{
          const y=PAD.t+i*barH;
          const bw=(v.cv/maxCV)*(W-PAD.l-PAD.r);
          // background
          ctx.fillStyle='#1a0030'; ctx.fillRect(PAD.l,y,W-PAD.l-PAD.r,barH-2);
          // bar
          const grad=ctx.createLinearGradient(PAD.l,y,PAD.l+bw,y);
          grad.addColorStop(0,v.mod.col+'dd'); grad.addColorStop(1,v.mod.col+'44');
          ctx.fillStyle=grad; ctx.fillRect(PAD.l,y,bw,barH-2);
          // label
          ctx.fillStyle=v.mod.col; ctx.font='8.5px system-ui'; ctx.textAlign='right';
          ctx.fillText(v.mod.id,PAD.l-4,y+barH*0.65);
          // CV value
          ctx.fillStyle='#94a3b8'; ctx.font='7.5px system-ui'; ctx.textAlign='left';
          ctx.fillText(`CV=${(v.cv*100).toFixed(1)}%  μ=${(v.mean*100).toFixed(2)}%`,PAD.l+bw+4,y+barH*0.65);
        });
        ctx.fillStyle='#64748b'; ctx.font='8px system-ui'; ctx.textAlign='center';
        ctx.fillText('Coefficient of Variation (CV) — cell-to-cell heterogeneity per modification',W/2,H-8);
      },[variance]);

      // ── Render ───────────────────────────────────────────────────────────────
      const canvasH=activeData?Math.max(380,Math.min(activeData.cells.length*18+70,520)):380;

      return(
        <div>
          {/* Header */}
          <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(135deg,rgba(14,0,24,0.98),rgba(1,15,35,0.92))',border:'1px solid rgba(34,211,238,0.2)'}}>
            <h3 style={{marginBottom:'0.3rem',background:'linear-gradient(90deg,#22d3ee,#d946ef)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
              Single-Cell Histone PTM Analysis
            </h3>
            <p style={{color:'var(--muted)',fontSize:'0.77rem',marginBottom:'0.7rem',lineHeight:1.55}}>
              Based on Sidoli lab single-cell MS pipeline (Cutler et al., Nature Comm. 2022). ZIGGY adds interactive force-directed correlation networks,
              live cell heatmaps, and CV analysis — replacing 11 static R scripts with a fully linked visual explorer.
              Use demo data, paste a cell×PTM matrix (CSV), or load multiple single-cell runs directly.
            </p>

            {/* Data source tabs */}
            <div style={{display:'flex',gap:'0.4rem',marginBottom:'0.65rem',flexWrap:'wrap'}}>
              {[['demo','Demo (30 cells)'],['csv','Paste CSV'],['runs','Load Runs']].map(([k,l])=>(
                <button key={k} onClick={()=>setDataMode(k)}
                  style={{padding:'0.28rem 0.7rem',borderRadius:'0.35rem',border:'none',cursor:'pointer',fontWeight:600,fontSize:'0.78rem',
                    background:dataMode===k?'#22d3ee':'var(--surface)',color:dataMode===k?'#0e0018':'var(--muted)'}}>
                  {l}
                </button>
              ))}
            </div>

            {dataMode==='csv'&&(
              <div>
                <div style={{color:'var(--muted)',fontSize:'0.73rem',marginBottom:'0.3rem'}}>
                  Paste a CSV: first column = Cell_ID, remaining columns = PTM names, values = relative abundance.
                  Compatible with Sidoli lab EpiProfile / pipeline output.
                </div>
                <textarea value={csvText} onChange={e=>setCsvText(e.target.value)}
                  rows={5} placeholder={'Cell_ID,H3K4me3,H3K9ac,H3K27me3,...\nCell_1,0.45,0.32,0.03,...'}
                  style={{width:'100%',boxSizing:'border-box',padding:'0.4rem',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'0.35rem',color:'#e2e8f0',fontSize:'0.76rem',fontFamily:'monospace',resize:'vertical'}}/>
                <button onClick={()=>{const d=parseCSV(csvText);if(d)setParsedData(d);}}
                  style={{marginTop:'0.4rem',padding:'0.3rem 0.8rem',background:'#22d3ee',color:'#0e0018',border:'none',borderRadius:'0.3rem',fontWeight:700,cursor:'pointer',fontSize:'0.8rem'}}>
                  Parse & Visualize
                </button>
                {csvError&&<span style={{color:'#ef4444',fontSize:'0.75rem',marginLeft:'0.6rem'}}>{csvError}</span>}
              </div>
            )}

            {dataMode==='runs'&&(
              <div>
                <div style={{color:'var(--muted)',fontSize:'0.73rem',marginBottom:'0.4rem'}}>
                  Select runs where each run = one single cell (histone enrichment experiment). ZIGGY maps detected histone peptides to modification sites and builds the cell × PTM matrix automatically.
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'0.3rem',marginBottom:'0.4rem',maxHeight:'120px',overflowY:'auto'}}>
                  {runs.map(r=>(
                    <label key={r.id} style={{display:'flex',alignItems:'center',gap:'0.3rem',fontSize:'0.75rem',cursor:'pointer',
                      padding:'0.2rem 0.45rem',borderRadius:'0.3rem',
                      background:selectedRunIds.has(r.id)?'rgba(217,70,239,0.15)':'var(--surface)',
                      border:selectedRunIds.has(r.id)?'1px solid rgba(217,70,239,0.4)':'1px solid var(--border)'}}>
                      <input type="checkbox" checked={selectedRunIds.has(r.id)}
                        onChange={e=>{
                          const s=new Set(selectedRunIds);
                          e.target.checked?s.add(r.id):s.delete(r.id);
                          setSelectedRunIds(s);
                        }} style={{accentColor:'#d946ef'}}/>
                      <span style={{color:'#94a3b8'}}>{r.run_name}</span>
                    </label>
                  ))}
                </div>
                <button onClick={loadRuns} disabled={runLoading||selectedRunIds.size<2}
                  style={{padding:'0.3rem 0.8rem',background:'#d946ef',color:'#fff',border:'none',borderRadius:'0.3rem',fontWeight:700,cursor:'pointer',fontSize:'0.8rem',opacity:selectedRunIds.size<2?0.4:1}}>
                  {runLoading?'Loading…':`Analyze ${selectedRunIds.size} cells`}
                </button>
                {csvError&&<span style={{color:'#ef4444',fontSize:'0.75rem',marginLeft:'0.6rem'}}>{csvError}</span>}
              </div>
            )}

            {activeData&&(
              <div style={{marginTop:'0.5rem',display:'flex',gap:'0.75rem',flexWrap:'wrap',fontSize:'0.75rem'}}>
                {activeData.types.map(t=>(
                  <span key={t.name} style={{display:'flex',alignItems:'center',gap:'0.3rem'}}>
                    <span style={{width:'10px',height:'10px',borderRadius:'50%',background:t.col,display:'inline-block'}}/>
                    <span style={{color:'#64748b'}}>{t.name}: {t.n} cells</span>
                  </span>
                ))}
                <span style={{color:'#64748b'}}>{activeData.mods.length} modifications · {activeData.cells.length} cells total</span>
              </div>
            )}
          </div>

          {/* Sub-view selector */}
          <div style={{display:'flex',gap:'0.35rem',marginBottom:'0.75rem'}}>
            {[['network','⬡ Correlation Network'],['heatmap','⊞ Cell Heatmap'],['variance','∿ Variance']].map(([k,l])=>(
              <button key={k} onClick={()=>setSubView(k)}
                style={{padding:'0.28rem 0.75rem',borderRadius:'0.35rem',border:'none',cursor:'pointer',fontWeight:600,fontSize:'0.78rem',
                  background:subView===k?'var(--accent)':'var(--surface)',color:subView===k?'var(--bg)':'var(--muted)'}}>
                {l}
              </button>
            ))}
            {subView==='network'&&corrMatrix&&(
              <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:'0.5rem'}}>
                <span style={{color:'var(--muted)',fontSize:'0.75rem'}}>threshold |r| ≥</span>
                <input type="range" min="0.1" max="0.9" step="0.05" value={corrThresh}
                  onChange={e=>setCorrThresh(parseFloat(e.target.value))}
                  style={{width:'100px',accentColor:'#22d3ee'}}/>
                <span style={{color:'#22d3ee',fontSize:'0.78rem',fontWeight:700}}>{corrThresh.toFixed(2)}</span>
              </div>
            )}
          </div>

          {subView==='network'&&(
            <div className="card" style={{padding:'0.5rem',background:'rgba(0,0,0,0.5)'}}>
              <canvas ref={netCvRef} width={860} height={500}
                style={{width:'100%',borderRadius:'0.4rem',cursor:'grab',display:'block'}}
                onMouseDown={onNetMouseDown} onMouseMove={onNetMouseMove}
                onMouseUp={onNetMouseUp} onMouseLeave={onNetMouseUp}
                onClick={onNetClick}/>
            </div>
          )}

          {subView==='heatmap'&&(
            <div className="card" style={{padding:'0.5rem',background:'rgba(0,0,0,0.5)'}}>
              <canvas ref={heatCvRef} width={860} height={canvasH}
                style={{width:'100%',borderRadius:'0.4rem',cursor:'crosshair',display:'block'}}
                onMouseMove={onHeatMove} onMouseLeave={()=>setHeatHov(null)}/>
            </div>
          )}

          {subView==='variance'&&(
            <div className="card" style={{padding:'0.5rem',background:'rgba(0,0,0,0.5)'}}>
              <canvas ref={varCvRef} width={860} height={Math.max(280,activeData?.mods.length*26+50||280)}
                style={{width:'100%',borderRadius:'0.4rem',display:'block'}}/>
            </div>
          )}

          {subView==='network'&&(
            <div style={{marginTop:'0.6rem',padding:'0.5rem 0.75rem',background:'rgba(0,0,0,0.3)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:'0.4rem',fontSize:'0.73rem',color:'#64748b',lineHeight:1.7}}>
              <strong style={{color:'#22d3ee'}}>Cutler, Corveleyn, Ctortecka et al. Nat. Commun. 2025:</strong> cellenONE + timsTOF Ultra → 67 histone peptidoforms · 25 PTMs · H1/H2A/H2B/H3/H4 per single cell. Demo now includes H1K25/K26ac (linker histone) and NaBu-treated population (sodium butyrate HDAC inhibitor). Their correlation networks are static igraph PNGs computed in R.
              This is the same analysis — Pearson correlations across single cells — live, draggable, filterable by threshold, and linked to your actual run data.
              <br/>
              <strong style={{color:'#DAAA00'}}>Known biology:</strong> H3K4me3 ↔ H3K9ac (strong positive, active promoters) · H3K27me3 ↔ H3K4me3 (negative, Polycomb vs active) · H3K27me3 ↔ H3K9me3 (positive, co-repressive).
            </div>
          )}
        </div>
      );
    }

    // ── Panel: Orsburn 2026 — Single-Cell HDAC Inhibitor Response ────────────────
    function HistoneOrsburn() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);

      // Seeded RNG
      const mkRng = seed => { let s=seed; return ()=>{ s=(s*16807)%2147483647; return(s-1)/2147483646; }; };

      // Mocetinostat experiment data (Orsburn Commun Biol 2026)
      // 562 cells: ~281 DMSO control, ~281 treated
      const PTMS = [
        {label:'H4 K9K13K17 tri-ac',    fc:3.82, pval:'<0.0001', col:'#DAAA00', note:'Top hit · tri-acetylation'},
        {label:'H4 K5ac',               fc:2.41, pval:'<0.0001', col:'#f59e0b', note:''},
        {label:'H3 K19+K24 double-ac',  fc:2.18, pval:'0.0002',  col:'#22d3ee', note:'Double acetylation'},
        {label:'H3 K24ac',              fc:1.94, pval:'0.0008',  col:'#38bdf8', note:''},
        {label:'H4 K12ac',              fc:1.76, pval:'0.0015',  col:'#fbbf24', note:''},
        {label:'H3 K18ac',              fc:1.55, pval:'0.0031',  col:'#93c5fd', note:''},
        {label:'H2B K20ac',             fc:1.38, pval:'0.011',   col:'#f97316', note:''},
        {label:'H3 K9ac',               fc:1.22, pval:'0.038',   col:'#86efac', note:''},
        {label:'S100-A9 protein',        fc:1.88, pval:'<0.0001', col:'#ef4444', note:'★ Non-histone surprise'},
        {label:'H3K27me3 (unchanged)',   fc:0.98, pval:'0.72',   col:'#475569', note:'Repressive mark stable'},
        {label:'H3K9me3 (unchanged)',    fc:0.97, pval:'0.81',   col:'#475569', note:'Repressive mark stable'},
      ];

      const STATS = [
        {label:'Cells analyzed',  val:'562',      col:'#22d3ee'},
        {label:'Method',          val:'420 CPD',  col:'#DAAA00'},
        {label:'Proteins / cell', val:'342–453',  col:'#22c55e'},
        {label:'Histone PTMs',    val:'16',       col:'#d946ef'},
        {label:'Ac sites (SC)',   val:'7',        col:'#DAAA00'},
        {label:'Coverage',        val:'41–47%',   col:'#22d3ee'},
        {label:'Throughput',      val:'210–700 CPD', col:'#f97316'},
        {label:'Labeling',        val:'TMTPro',   col:'#a855f7'},
      ];

      // Canvas: left = UMAP cell scatter, right = fold-change bars
      React.useEffect(()=>{
        const cv = cvRef.current; if(!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const rng = mkRng(7331);

        // ── Background
        ctx.fillStyle = '#06000f'; ctx.fillRect(0,0,W,H);
        // subtle grid
        ctx.strokeStyle = 'rgba(218,170,0,0.025)'; ctx.lineWidth = 0.5;
        for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
        for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

        const SPLIT = W * 0.46;

        // ── LEFT: UMAP scatter ─────────────────────────────────────────────────
        const CX = SPLIT * 0.5, CY = H * 0.5, RX = SPLIT * 0.38, RY = H * 0.36;
        // Label
        ctx.fillStyle = '#64748b'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('562 H358 Lung Cancer Cells', CX, 18);
        ctx.fillStyle = '#334155'; ctx.font = '8px system-ui';
        ctx.fillText('timsTOF SCP · EvoSep One · TMTPro · ddaPASEF', CX, 31);

        // two clusters (DMSO control, Treated) — slight separation
        const clusters = [
          {n:281, cx:CX-RX*0.22, cy:CY, rx:RX*0.72, ry:RY*0.82, label:'DMSO (control)', col:'#3b82f6', acScale:0.2},
          {n:281, cx:CX+RX*0.22, cy:CY, rx:RX*0.72, ry:RY*0.82, label:'Mocetinostat', col:'#DAAA00', acScale:0.85},
        ];
        // draw cells
        clusters.forEach(cl=>{
          // nebula
          const neb = ctx.createRadialGradient(cl.cx, cl.cy, 0, cl.cx, cl.cy, Math.max(cl.rx,cl.ry)*1.1);
          neb.addColorStop(0, cl.col+'14'); neb.addColorStop(1, cl.col+'00');
          ctx.fillStyle = neb; ctx.beginPath(); ctx.ellipse(cl.cx,cl.cy,cl.rx*1.1,cl.ry*1.1,0,0,Math.PI*2); ctx.fill();
          // cells
          for(let i=0;i<cl.n;i++){
            const angle = rng()*Math.PI*2;
            const rad = Math.sqrt(rng()); // uniform disk
            const jx = cl.cx + Math.cos(angle)*rad*cl.rx + (rng()-0.5)*8;
            const jy = cl.cy + Math.sin(angle)*rad*cl.ry + (rng()-0.5)*6;
            // acetylation level drives color intensity
            const acLvl = cl.acScale * (0.4 + rng()*0.6);
            const r = Math.floor(cl.col==='#DAAA00' ? 218 : 59);
            const g = Math.floor(cl.col==='#DAAA00' ? 170 : 130);
            const b = Math.floor(cl.col==='#DAAA00' ? 0 : 246);
            const alpha = 0.25 + acLvl * 0.65;
            const sz = 1.4 + acLvl * 1.4;
            ctx.beginPath(); ctx.arc(jx, jy, sz, 0, Math.PI*2);
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`; ctx.fill();
          }
          // cluster label
          ctx.fillStyle = cl.col; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(cl.label, cl.cx, cl.cy + cl.ry + 14);
          ctx.fillStyle = cl.col+'88'; ctx.font = '8px system-ui';
          ctx.fillText(`n = ${cl.n}`, cl.cx, cl.cy + cl.ry + 24);
        });

        // cluster boundary ellipses
        clusters.forEach(cl=>{
          ctx.strokeStyle = cl.col+'33'; ctx.lineWidth = 1;
          ctx.setLineDash([3,4]);
          ctx.beginPath(); ctx.ellipse(cl.cx,cl.cy,cl.rx,cl.ry,0,0,Math.PI*2); ctx.stroke();
          ctx.setLineDash([]);
        });

        // treatment arrow between clusters
        const ax1 = CX - RX*0.22 + RX*0.72 + 6;
        const ax2 = CX + RX*0.22 - RX*0.72 - 6;
        const ay = CY - 28;
        ctx.strokeStyle = '#DAAA0066'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
        ctx.beginPath(); ctx.moveTo(ax1,ay); ctx.lineTo(ax2,ay); ctx.stroke();
        ctx.setLineDash([]);
        // arrowhead
        ctx.fillStyle = '#DAAA0088';
        ctx.beginPath(); ctx.moveTo(ax2,ay); ctx.lineTo(ax2-8,ay-4); ctx.lineTo(ax2-8,ay+4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#DAAA00aa'; ctx.font = 'bold 8.5px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('mocetinostat', (ax1+ax2)/2, ay-5);
        ctx.fillStyle = '#47556988'; ctx.font = '7.5px system-ui';
        ctx.fillText('5µM · 24h · class I HDAC inhibitor', (ax1+ax2)/2, ay+12);

        // diagnostic ion callout
        ctx.fillStyle = 'rgba(218,170,0,0.55)'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'left';
        ctx.fillText('★ Kac diagnostic ion: 126.0913 m/z', 6, H-26);
        ctx.fillStyle = '#33415588'; ctx.font = '7.5px system-ui';
        ctx.fillText('present in ~22.9% of acetylated peptide spectra', 6, H-14);

        // divider
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(SPLIT, 10); ctx.lineTo(SPLIT, H-10); ctx.stroke();

        // ── RIGHT: Fold-change bar chart ───────────────────────────────────────
        const BAR_L = SPLIT + 14;
        const BAR_W = W - BAR_L - 10;
        const MAX_FC = 4.2;
        const ROW = (H - 50) / PTMS.length;
        const toBarX = fc => BAR_L + 2 + (fc / MAX_FC) * (BAR_W - 90);

        ctx.fillStyle = '#64748b'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left';
        ctx.fillText('Fold-change (treated vs control)', BAR_L, 18);
        ctx.fillStyle = '#334155'; ctx.font = '8px system-ui';
        ctx.fillText('Orsburn, Commun. Biol. 2026 · H358 · 562 single cells', BAR_L, 30);

        // gridlines at FC=1, 2, 3, 4
        [1,2,3,4].forEach(fc=>{
          const gx = toBarX(fc);
          ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.moveTo(gx,38); ctx.lineTo(gx,H-14); ctx.stroke();
          ctx.fillStyle = '#334155'; ctx.font = '7px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(fc+'×', gx, 37);
        });
        // FC=1 baseline
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([2,3]);
        const base = toBarX(1);
        ctx.beginPath(); ctx.moveTo(base,38); ctx.lineTo(base,H-14); ctx.stroke();
        ctx.setLineDash([]);

        PTMS.forEach((p,i)=>{
          const y = 40 + i * ROW;
          const bx = toBarX(1); // bar starts at FC=1
          const bw = Math.max(0,(p.fc-1)/(MAX_FC-1)) * (BAR_W - 90 - (toBarX(1)-BAR_L-2));
          const isSignificant = p.pval !== '0.72' && p.pval !== '0.81';

          // bar bg
          ctx.fillStyle = p.col + (isSignificant ? '18' : '08');
          ctx.fillRect(BAR_L+2, y+1, toBarX(p.fc)-BAR_L-2, ROW-2);
          // bar fill
          ctx.fillStyle = p.col + (isSignificant ? 'cc' : '44');
          ctx.fillRect(bx, y+3, toBarX(p.fc)-bx, ROW-6);

          // label
          ctx.fillStyle = isSignificant ? p.col : '#334155';
          ctx.font = (i===0 ? 'bold ' : '') + '8.5px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(p.label, toBarX(p.fc)+4, y+ROW/2+3);

          // p-value
          ctx.fillStyle = '#47556988'; ctx.font = '7px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(`p=${p.pval}`, toBarX(p.fc)+4, y+ROW/2+12);

          // special marker for top hit
          if(i===0){
            ctx.fillStyle = '#DAAA00'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'right';
            ctx.fillText('▶ '+p.fc.toFixed(2)+'×', bx-3, y+ROW/2+3);
          }
          if(p.note.startsWith('★')){
            ctx.fillStyle = '#ef4444cc'; ctx.font = 'bold 7.5px system-ui'; ctx.textAlign = 'left';
            ctx.fillText(p.note, toBarX(p.fc)+4, y+ROW*0.88+3);
          }
        });

        ctx.fillStyle = '#1e293b'; ctx.font = '7px system-ui'; ctx.textAlign = 'left';
        ctx.fillText('← no change  ·  enriched →', BAR_L+2, H-4);

      },[]);

      return (
        <div>
          {/* Stats bar */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:'0.4rem',marginBottom:'0.8rem'}}>
            {STATS.map(s=>(
              <div key={s.label} style={{background:'rgba(0,0,0,0.45)',border:`1px solid ${s.col}22`,borderRadius:'0.4rem',padding:'0.45rem 0.6rem',textAlign:'center'}}>
                <div style={{fontSize:'1.15rem',fontWeight:900,color:s.col,lineHeight:1.1}}>{s.val}</div>
                <div style={{fontSize:'0.67rem',color:'#64748b',marginTop:'0.15rem'}}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Main canvas */}
          <div className="card" style={{marginBottom:'0.8rem',padding:0,background:'#06000f',border:'1px solid rgba(218,170,0,0.18)',overflow:'hidden',borderRadius:'0.6rem'}}>
            <canvas ref={cvRef} width={900} height={460} style={{width:'100%',display:'block',borderRadius:'0.6rem'}}/>
          </div>

          {/* Context cards */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.6rem',marginBottom:'0.6rem'}}>
            <div className="card" style={{borderColor:'rgba(218,170,0,0.25)',background:'rgba(218,170,0,0.04)'}}>
              <div style={{fontSize:'0.78rem',fontWeight:700,color:'#DAAA00',marginBottom:'0.35rem'}}>★ Top Hit: H4 K9+K13+K17 tri-acetylation</div>
              <div style={{fontSize:'0.74rem',color:'#94a3b8',lineHeight:1.6}}>
                3.82× enriched in mocetinostat-treated cells (p&lt;0.0001). Class I HDACs (1, 2, 3) remove acetylation from H4 tail — blocking them floods these three sites simultaneously.
                The tri-ac peptide GGKGLGKGGAK appears with all three K residues acetylated in the majority of treated single cells.
              </div>
            </div>
            <div className="card" style={{borderColor:'rgba(239,68,68,0.25)',background:'rgba(239,68,68,0.04)'}}>
              <div style={{fontSize:'0.78rem',fontWeight:700,color:'#ef4444',marginBottom:'0.35rem'}}>★ Surprise: S100-A9 upregulation</div>
              <div style={{fontSize:'0.74rem',color:'#94a3b8',lineHeight:1.6}}>
                S100-A9 (calcium-binding protein, inflammatory mediator) was significantly upregulated in nearly all treated cells (p&lt;0.0001) — a previously unreported response to mocetinostat.
                Single-cell proteomics caught a non-epigenetic drug effect invisible to bulk histone analysis. 342–453 proteins per cell enables this breadth.
              </div>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.6rem'}}>
            <div className="card" style={{borderColor:'rgba(34,211,238,0.2)',background:'rgba(34,211,238,0.03)'}}>
              <div style={{fontSize:'0.78rem',fontWeight:700,color:'#22d3ee',marginBottom:'0.35rem'}}>Validation against bulk</div>
              <div style={{fontSize:'0.74rem',color:'#94a3b8',lineHeight:1.6}}>
                Bulk reanalysis (Chang et al.) found 52 unique histone acetylation sites. All 7 single-cell sites appeared in the bulk dataset — validating SC sensitivity.
                Diagnostic ion 126.0913 m/z (acetyl-lysine immonium) detected in 22.9% of Kac spectra, providing search-independent confirmation.
              </div>
            </div>
            <div className="card" style={{borderColor:'rgba(168,85,247,0.2)',background:'rgba(168,85,247,0.03)'}}>
              <div style={{fontSize:'0.78rem',fontWeight:700,color:'#a855f7',marginBottom:'0.35rem'}}>Cutler et al. Nature Commun. 2025</div>
              <div style={{fontSize:'0.74rem',color:'#94a3b8',lineHeight:1.6}}>
                Complementary sc-hPTM workflow: cellenONE dispensing + timsTOF Ultra identifies <strong style={{color:'#e2e8f0'}}>67 histone peptidoforms</strong> comprising <strong style={{color:'#e2e8f0'}}>25 unique PTMs</strong> per single cell across H1, H2A, H2B, H3, H4.
                Sub-populations with heterogeneous sodium butyrate (HDAC inhibitor) response resolved at single-cell resolution.
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Main Tab ──────────────────────────────────────────────────────────────────
    function HistoneTab() {
      const [view,setView]=useState('storm');
      const VIEWS=[
        ['storm',    '⚡ 4D Storm'],
        ['orsburn',  '★ SC Drug Response'],
        ['live',     '◎ Live Data'],
        ['scnet',    '⬡ SC Network'],
        ['sequences','◈ Sequences'],
        ['map',      '◉ Tail Map'],
        ['crosstalk','⊞ Crosstalk'],
        ['mobility', '∿ Ion Mobility'],
        ['workflow', '⬡ Workflow'],
      ];
      return(
        <div>
          <div style={{display:'flex',gap:'0.35rem',marginBottom:'1rem',flexWrap:'wrap',alignItems:'center'}}>
            {VIEWS.map(([k,label])=>(
              <button key={k} onClick={()=>setView(k)}
                style={{padding:'0.32rem 0.8rem',borderRadius:'0.4rem',border:'none',cursor:'pointer',fontWeight:600,fontSize:'0.8rem',
                  background:view===k?'var(--accent)':'var(--surface)',
                  color:view===k?'var(--bg)':'var(--muted)'}}>
                {label}
              </button>
            ))}
            <span style={{marginLeft:'auto',alignSelf:'center',fontSize:'0.72rem',color:'#64748b',fontStyle:'italic'}}>
              Histone PTM proteomics · propionylation · TIMS 4D
            </span>
          </div>
          {view==='storm'    &&<HistoneTimsStorm/>}
          {view==='orsburn'  &&<HistoneOrsburn/>}
          {view==='live'     &&<HistoneLiveData/>}
          {view==='scnet'    &&<HistoneSCNetwork/>}
          {view==='sequences'&&<HistoneSequenceAligner/>}
          {view==='map'      &&<HistoneTailMap/>}
          {view==='crosstalk'&&<HistoneCrosstalkMatrix/>}
          {view==='mobility' &&<HistoneIonMobility/>}
          {view==='workflow' &&<HistonePropWorkflow/>}
        </div>
      );
    }
