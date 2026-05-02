    /* ── Landscape Tab — 4D Advantage Showcase ─────────────────────────── */
    /*
     * Three modes:
     *   story   — animated visual explainer, no data needed
     *   scanner — live 2D heatmap (m/z × 1/K₀) with RT sweep
     *   compare — side-by-side heatmaps for two runs
     */

    // ── Module-level style constants ──────────────────────────────────────
    const _LS_SEL = {
      background:'var(--bg)', color:'var(--text)',
      border:'1px solid var(--border)', borderRadius:'0.35rem',
      padding:'0.3rem 0.6rem', fontSize:'0.8rem', minWidth:'220px',
    };
    const _lsBtn = (active, col) => ({
      padding:'0.35rem 0.85rem', borderRadius:'0.35rem', cursor:'pointer',
      fontSize:'0.8rem', fontWeight: active ? 700 : 400,
      background: active ? `${col||'#1f6feb'}22` : 'transparent',
      border: `1px solid ${active ? (col||'var(--accent)') : 'var(--border)'}`,
      color: active ? (col||'var(--accent)') : 'var(--muted)',
      transition:'all 0.15s',
    });
    // Empirical CCS model: 1/K₀ ∝ (z·mz)^0.6 / z  →  z+1 highest, z+4 lowest at same m/z
    // Calibrated to typical timsTOF tryptic digest values (z+2 @ mz=500 → ~0.86 Vs/cm²)
    const _lsCcsExpected = (mz, z) => 0.37 + 0.0175 * Math.pow(mz, 0.6) / Math.pow(z, 0.57);

    function _lsInjectStyles() {
      if (document.getElementById('ls-anim-styles')) return;
      const s = document.createElement('style');
      s.id = 'ls-anim-styles';
      s.textContent = `
        @keyframes ls-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes ls-pulse-glow { 0%,100%{opacity:.7} 50%{opacity:1} }
        @keyframes ls-shimmer {
          0%{background-position:-200% center} 100%{background-position:200% center}
        }
        @keyframes ls-pop {
          0%{transform:scale(0.6);opacity:0} 70%{transform:scale(1.05)} 100%{transform:scale(1);opacity:1}
        }
        @keyframes ls-slide-up {
          from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1}
        }
        @keyframes ls-spin-slow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .ls-gold-shimmer {
          background:linear-gradient(90deg,#DAAA00 0%,#fff8 40%,#DAAA00 60%,#f97316 100%);
          background-size:200% auto;
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
          background-clip:text;
          animation:ls-shimmer 3s linear infinite;
        }
        .ls-float { animation:ls-float 3s ease-in-out infinite; }
        .ls-pulse { animation:ls-pulse-glow 2s ease-in-out infinite; }
        .ls-pop { animation:ls-pop .5s cubic-bezier(.34,1.56,.64,1) forwards; }
        .ls-slide-up { animation:ls-slide-up .5s ease forwards; }
      `;
      document.head.appendChild(s);
    }

    // ── Seeded PRNG for deterministic procedural art ─────────────────────
    function _lsRand(seed) {
      let s = seed;
      return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    }

    // ── Shared 2D canvas heatmap draw (m/z × 1/K₀) ──────────────────────
    function _lsDrawHeatmap(canvas, flat, W, H, opts = {}) {
      if (!canvas || !flat) return;
      const ctx = canvas.getContext('2d');
      const cw = canvas.width, ch = canvas.height;
      const {
        mzLo = 300, mzHi = 1500, K0_LO = 0.48, K0_HI = 1.82,
        palette = 'blue', showCorridors = true,
      } = opts;

      ctx.fillStyle = '#060b14'; ctx.fillRect(0, 0, cw, ch);

      let maxV = 0;
      for (let i = 0; i < flat.length; i++) if (flat[i] > maxV) maxV = flat[i];
      if (maxV === 0) return;

      const blueStops  = [[0,[2,8,24]],[.2,[15,50,110]],[.5,[28,78,180]],[.8,[88,166,255]],[1,[200,230,255]]];
      const redStops   = [[0,[20,4,4]],[.2,[100,20,10]],[.5,[180,50,30]],[.8,[247,129,102]],[1,[255,210,200]]];
      const goldStops  = [[0,[20,14,2]],[.2,[80,50,5]],[.5,[160,110,0]],[.8,[218,170,0]],[1,[255,245,180]]];
      const stops = palette === 'red' ? redStops : palette === 'gold' ? goldStops : blueStops;

      function valToRgb(v) {
        const t = Math.pow(v, 0.42);
        for (let i = 0; i < stops.length - 1; i++) {
          const [t0,c0] = stops[i], [t1,c1] = stops[i+1];
          if (t >= t0 && t <= t1) {
            const f = (t - t0) / (t1 - t0);
            return [c0[0]+f*(c1[0]-c0[0]), c0[1]+f*(c1[1]-c0[1]), c0[2]+f*(c1[2]-c0[2])];
          }
        }
        return stops[stops.length - 1][1];
      }

      const imgD = ctx.createImageData(cw, ch);
      const scaleX = cw / W, scaleY = ch / H;
      // yi=0 = K0_LO (lowest mobility) → must appear at BOTTOM of canvas (py near ch).
      // Flip: fy = H-1-y so that yi=0 → fy=H-1 → py≈ch (bottom), matching the corridor overlay.
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const fy = H - 1 - y;
        const v = flat[fy * W + x] / maxV;
        if (v <= 0.004) continue;
        const [r,g,b] = valToRgb(v);
        const a = Math.round(25 + v * 230);
        for (let py = Math.floor(y*scaleY); py < Math.ceil((y+1)*scaleY) && py < ch; py++)
          for (let px = Math.floor(x*scaleX); px < Math.ceil((x+1)*scaleX) && px < cw; px++) {
            const idx = (py*cw + px) * 4;
            imgD.data[idx]=r; imgD.data[idx+1]=g; imgD.data[idx+2]=b; imgD.data[idx+3]=a;
          }
      }
      ctx.putImageData(imgD, 0, 0);

      if (showCorridors) {
        [[1,[45,212,191],'1️⃣'],[2,[96,165,250],'⚡'],[3,[34,197,94],'💪'],[4,[249,115,22],'🚀']].forEach(([z,[r,g,b],emoji])=>{
          const pts = [];
          for (let mx = mzLo; mx <= mzHi; mx += 8) {
            const k0 = _lsCcsExpected(mx, z);
            if (k0 < K0_LO || k0 > K0_HI) continue;
            pts.push([(mx-mzLo)/(mzHi-mzLo)*cw, ch-(k0-K0_LO)/(K0_HI-K0_LO)*ch]);
          }
          if (pts.length < 2) return;
          ctx.strokeStyle=`rgba(${r},${g},${b},0.1)`; ctx.lineWidth=14; ctx.setLineDash([]);
          ctx.beginPath(); pts.forEach(([px,py],i)=>i===0?ctx.moveTo(px,py):ctx.lineTo(px,py)); ctx.stroke();
          ctx.strokeStyle=`rgba(${r},${g},${b},0.75)`; ctx.lineWidth=1.2; ctx.setLineDash([5,4]);
          ctx.beginPath(); pts.forEach(([px,py],i)=>i===0?ctx.moveTo(px,py):ctx.lineTo(px,py)); ctx.stroke();
          ctx.setLineDash([]);
          const lp = pts[Math.floor(pts.length*0.78)];
          ctx.fillStyle=`rgba(${r},${g},${b},0.9)`; ctx.font='bold 9px monospace';
          ctx.fillText(`${emoji}z+${z}`, lp[0]+3, lp[1]-5);
        });
      }

      // Axis labels
      ctx.fillStyle='rgba(100,130,160,0.55)'; ctx.font='9px monospace';
      ctx.textAlign='center'; ctx.fillText('m/z →', cw/2, ch-3);
      ctx.save(); ctx.translate(10,ch/2); ctx.rotate(-Math.PI/2);
      ctx.fillText('1/K₀ →', 0, 0); ctx.restore();
      ctx.textAlign='left';
      ctx.fillText(`${mzLo}`, 14, ch-12); ctx.fillText(`${mzHi}`, cw-34, ch-12);
      ctx.fillText(`${K0_HI.toFixed(1)}`, 14, 12); ctx.fillText(`${K0_LO.toFixed(1)}`, 14, ch-15);
    }

    // ── Shared run selector ───────────────────────────────────────────────
    function LsRunSelector({ label, color, value, onChange, opts, loading }) {
      return (
        <div style={{display:'flex',flexDirection:'column',gap:'3px',borderLeft:`3px solid ${color}`,paddingLeft:'8px'}}>
          <div style={{fontSize:'0.65rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px'}}>
            {label}
          </div>
          <select value={value} onChange={e=>onChange(e.target.value)} style={_LS_SEL}>
            <option value="">— select run —</option>
            {opts}
          </select>
          {loading && (
            <div style={{fontSize:'0.67rem',color:'#f0883e',display:'flex',alignItems:'center',gap:'4px'}}>
              <span style={{animation:'spin 1s linear infinite',display:'inline-block'}}>⟳</span> Loading…
            </div>
          )}
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // STORY MODE — The visual explainer
    // ══════════════════════════════════════════════════════════════════════

    // Hero comparison canvas: 2D (flat) vs 4D (timsTOF)
    function LSHeroCanvas() {
      const ref2D = useRef(null);
      const ref4D = useRef(null);

      useEffect(() => {
        draw2D(ref2D.current);
        draw4D(ref4D.current);
      }, []);

      function draw2D(canvas) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.fillStyle = '#050a12'; ctx.fillRect(0,0,W,H);
        const rand = _lsRand(42);

        // 14 peptide blobs — all grey, heavily overlapping in centre
        const bases = Array.from({length:14}, ()=>({
          cx: 55 + rand()*(W-110), cy: 35 + rand()*(H-70),
          r: 12 + rand()*28,
        }));

        bases.forEach(({cx,cy,r})=>{
          const grd = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
          grd.addColorStop(0,'rgba(90,110,130,0.7)');
          grd.addColorStop(1,'rgba(40,60,80,0)');
          ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
        });

        // Three clusters piled on top of each other — the "problem"
        [[W*.38,H*.48,35],[W*.43,H*.52,30],[W*.40,H*.44,28]].forEach(([cx,cy,r])=>{
          const grd = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
          grd.addColorStop(0,'rgba(140,150,160,0.9)');
          grd.addColorStop(1,'rgba(70,80,90,0)');
          ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
        });

        // X mark on the pile
        ctx.strokeStyle='rgba(239,68,68,0.6)'; ctx.lineWidth=2.5;
        const [px,py]=[W*.41,H*.49];
        ctx.beginPath(); ctx.moveTo(px-9,py-9); ctx.lineTo(px+9,py+9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px+9,py-9); ctx.lineTo(px-9,py+9); ctx.stroke();

        // Axes
        ctx.strokeStyle='rgba(60,80,100,0.35)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(25,H-20); ctx.lineTo(W-10,H-20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(25,8); ctx.lineTo(25,H-20); ctx.stroke();
        ctx.fillStyle='rgba(80,100,120,0.6)'; ctx.font='9px monospace'; ctx.textAlign='center';
        ctx.fillText('m/z →', W/2, H-6);
        ctx.save(); ctx.translate(12,H/2); ctx.rotate(-Math.PI/2);
        ctx.fillText('RT →', 0, 0); ctx.restore();
      }

      function draw4D(canvas) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.fillStyle = '#050a12'; ctx.fillRect(0,0,W,H);
        const rand = _lsRand(42); // same seed = same positions
        const COLS = ['#58a6ff','#22c55e','#f97316','#d946ef','#facc15',
                      '#2dd4bf','#f87171','#a78bfa','#60a5fa','#34d399',
                      '#fb923c','#e879f9','#4ade80','#fb7185'];

        // Regenerate positions matching 2D
        const bases = Array.from({length:14}, ()=>({
          cx: 55 + rand()*(W-110), cy: 35 + rand()*(H-70), r: 12 + rand()*28,
        }));
        // Displace three overlapping blobs to separate positions using mobility
        bases[5].cy = H*0.15; bases[5].r = 11;
        bases[6].cy = H*0.58; bases[6].r = 10;
        bases[7].cy = H*0.82; bases[7].r = 12;

        bases.forEach(({cx,cy,r},i)=>{
          const col = COLS[i % COLS.length];
          // Glow
          const grd = ctx.createRadialGradient(cx,cy,0,cx,cy,r*2.2);
          grd.addColorStop(0,col+'55'); grd.addColorStop(1,'rgba(0,0,0,0)');
          ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(cx,cy,r*2.2,0,Math.PI*2); ctx.fill();
          // Core
          const grd2 = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
          grd2.addColorStop(0,col+'ee'); grd2.addColorStop(1,col+'44');
          ctx.fillStyle=grd2; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
        });

        // Charge corridors overlay — z+1 top, z+2 below (correct Bruker orientation)
        const mzLo=300,mzHi=1400,K0_LO=0.5,K0_HI=1.8;
        [[1,[45,212,191],'z+1'],[2,[96,165,250],'z+2']].forEach(([z,[r,g,b],lbl])=>{
          const pts=[];
          for(let mx=mzLo;mx<=mzHi;mx+=20){
            const k0=_lsCcsExpected(mx,z);
            if(k0<K0_LO||k0>K0_HI)continue;
            pts.push([(mx-mzLo)/(mzHi-mzLo)*W, H-(k0-K0_LO)/(K0_HI-K0_LO)*H]);
          }
          if(pts.length<2)return;
          ctx.strokeStyle=`rgba(${r},${g},${b},0.6)`; ctx.lineWidth=1.4; ctx.setLineDash([5,4]);
          ctx.beginPath(); pts.forEach(([px,py],i)=>i===0?ctx.moveTo(px,py):ctx.lineTo(px,py));
          ctx.stroke(); ctx.setLineDash([]);
          const lp=pts[Math.floor(pts.length*0.75)];
          ctx.fillStyle=`rgba(${r},${g},${b},0.85)`; ctx.font='bold 8px monospace';
          ctx.fillText(lbl, lp[0]+3, lp[1]-4);
        });

        // Axes
        ctx.strokeStyle='rgba(30,60,100,0.4)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(25,H-20); ctx.lineTo(W-10,H-20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(25,8); ctx.lineTo(25,H-20); ctx.stroke();
        ctx.fillStyle='rgba(88,166,255,0.7)'; ctx.font='9px monospace'; ctx.textAlign='center';
        ctx.fillText('m/z →', W/2, H-6);
        ctx.save(); ctx.translate(12,H/2); ctx.rotate(-Math.PI/2);
        ctx.fillText('1/K₀ →', 0, 0); ctx.restore();
      }

      const cardStyle = {borderRadius:'0.5rem', display:'block', width:'100%'};
      return (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
          <div>
            <canvas ref={ref2D} width={260} height={170}
              style={{...cardStyle, border:'1px solid rgba(100,100,120,0.25)'}}/>
            <div style={{textAlign:'center',marginTop:'0.35rem',fontSize:'0.72rem',color:'#64748b',lineHeight:1.4}}>
              ❌ Standard MS — 3 dimensions<br/>
              <span style={{fontSize:'0.67rem',color:'#3a4a5a'}}>Peptides pile on top of each other</span>
            </div>
          </div>
          <div>
            <canvas ref={ref4D} width={260} height={170}
              style={{...cardStyle,border:'1px solid rgba(88,166,255,0.3)',
                boxShadow:'0 0 18px rgba(88,166,255,0.08)'}}/>
            <div style={{textAlign:'center',marginTop:'0.35rem',fontSize:'0.72rem',color:'#58a6ff',lineHeight:1.4}}>
              ✅ timsTOF — 4 dimensions<br/>
              <span style={{fontSize:'0.67rem',color:'#3a5a7a'}}>Every peptide gets its own lane</span>
            </div>
          </div>
        </div>
      );
    }

    // Animated TIMS marble tube
    function LSTIMSTube() {
      const [tick, setTick] = useState(0);
      useEffect(()=>{
        const id = setInterval(()=>setTick(t=>(t+1)%200),16);
        return ()=>clearInterval(id);
      },[]);

      const W=480, H=130;
      const TUBE_X0=70, TUBE_X1=380, TUBE_CY=65;
      const IONS = [
        {color:'#60a5fa',r:5, exitY:25,  label:'z+4  small, fast'},
        {color:'#22c55e',r:7, exitY:45,  label:'z+3'},
        {color:'#DAAA00',r:9, exitY:65,  label:'z+2  ⭐'},
        {color:'#f97316',r:11,exitY:85,  label:'z+2  large'},
        {color:'#a855f7',r:13,exitY:105, label:'z+1  biggest, slow'},
      ];

      const t = tick / 200;
      return (
        <div style={{textAlign:'center'}}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:'520px',height:'120px'}}>
            <defs>
              <filter id="ls-glow2" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <linearGradient id="ls-tube-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(10,20,50,0)"/>
                <stop offset="15%" stopColor="rgba(5,15,40,0.95)"/>
                <stop offset="85%" stopColor="rgba(5,15,40,0.95)"/>
                <stop offset="100%" stopColor="rgba(10,20,50,0)"/>
              </linearGradient>
            </defs>

            {/* Tube body */}
            <rect x={TUBE_X0} y="10" width={TUBE_X1-TUBE_X0} height={H-20} rx="8"
              fill="url(#ls-tube-grad)" stroke="rgba(30,80,150,0.35)" strokeWidth="1.5"/>

            {/* Gas flow hint */}
            {[22,37,52,67,82,97,112].map(y=>(
              <text key={y} x={TUBE_X0+8} y={y} fontSize="7"
                fill="rgba(30,70,150,0.2)" fontFamily="monospace">→ → →</text>
            ))}

            {/* "Separate by shape" zone */}
            <line x1={(TUBE_X0+TUBE_X1)/2} y1="12" x2={(TUBE_X0+TUBE_X1)/2} y2={H-12}
              stroke="rgba(88,166,255,0.1)" strokeWidth="1" strokeDasharray="3,4"/>
            <text x={(TUBE_X0+TUBE_X1)/2} y="9" textAnchor="middle" fontSize="7"
              fill="rgba(88,166,255,0.4)" fontFamily="monospace">electric field gradient</text>

            {/* Animated ions */}
            {IONS.map((ion,i)=>{
              const phase = (t + i*0.2) % 1;
              // eased x
              const ease = phase < 0.5 ? 2*phase*phase : -1+(4-2*phase)*phase;
              const x = TUBE_X0 + ease*(TUBE_X1-TUBE_X0);
              // y: stays at centre until 40% through, then diverges
              const yFrac = Math.max(0, (phase-0.35)/0.45);
              const y = TUBE_CY + yFrac*(ion.exitY - TUBE_CY);
              const alpha = phase < 0.06 ? phase/0.06 : phase > 0.92 ? (1-phase)/0.08 : 1;
              return (
                <g key={i} opacity={Math.max(0,Math.min(1,alpha))}>
                  <circle cx={x} cy={y} r={ion.r*1.8} fill={ion.color} opacity="0.1" filter="url(#ls-glow2)"/>
                  <circle cx={x} cy={y} r={ion.r}     fill={ion.color} opacity="0.92"/>
                </g>
              );
            })}

            {/* Exit labels */}
            {IONS.map((ion,i)=>(
              <text key={i} x={TUBE_X1+8} y={ion.exitY+4} fontSize="8.5"
                fill={ion.color} fontFamily="monospace" opacity="0.85">{ion.label}</text>
            ))}

            {/* Entry label */}
            <text x="8" y={TUBE_CY+4} fontSize="9" fill="rgba(200,200,200,0.35)">all ions →</text>
          </svg>
          <div style={{fontSize:'0.7rem',color:'#475569',marginTop:'0.2rem',fontStyle:'italic'}}>
            All ions enter at the same time → TIMS separates by 3D shape in microseconds
          </div>
        </div>
      );
    }

    // Animated corridor canvas (no real data — pure art)
    function LSCorridorArt() {
      const ref = useRef(null);
      useEffect(()=>{
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.fillStyle='#050a12'; ctx.fillRect(0,0,W,H);

        // Background heatmap blobs
        const rand = _lsRand(77);
        for (let i=0;i<25;i++){
          const cx=rand()*W, cy=rand()*H, r=25+rand()*90, int=0.04+rand()*0.12;
          const hue=190+rand()*80;
          const grd=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
          grd.addColorStop(0,`hsla(${hue},65%,45%,${int})`);
          grd.addColorStop(1,'hsla(0,0%,0%,0)');
          ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
        }

        // Corridors with heavy glow
        const mzLo=300,mzHi=1400,K0_LO=0.48,K0_HI=1.82;
        [
          {z:1,r:45,g:212,b:191,emoji:'1️⃣ z+1'},
          {z:2,r:96,g:165,b:250,emoji:'⚡ z+2'},
          {z:3,r:34,g:197,b:94, emoji:'💪 z+3'},
          {z:4,r:249,g:115,b:22,emoji:'🚀 z+4'},
        ].forEach(({z,r,g,b,emoji})=>{
          const pts=[];
          for(let mx=mzLo;mx<=mzHi;mx+=8){
            const k0=_lsCcsExpected(mx,z);
            if(k0<K0_LO||k0>K0_HI)continue;
            pts.push([(mx-mzLo)/(mzHi-mzLo)*W, H-(k0-K0_LO)/(K0_HI-K0_LO)*H]);
          }
          if(pts.length<2)return;
          const draw=(lw,alpha)=>{
            ctx.strokeStyle=`rgba(${r},${g},${b},${alpha})`; ctx.lineWidth=lw;
            ctx.beginPath(); pts.forEach(([px,py],i)=>i===0?ctx.moveTo(px,py):ctx.lineTo(px,py));
            ctx.stroke();
          };
          ctx.setLineDash([]); draw(22,0.07); draw(10,0.12); draw(3,0.25);
          ctx.setLineDash([6,4]); draw(1.5,0.9); ctx.setLineDash([]);
          const lp=pts[Math.floor(pts.length*.72)];
          ctx.fillStyle=`rgba(${r},${g},${b},0.95)`; ctx.font='bold 11px -apple-system,sans-serif';
          ctx.fillText(emoji, lp[0]+5, lp[1]-8);
        });

        // Axes
        ctx.fillStyle='rgba(80,110,140,0.5)'; ctx.font='9px monospace'; ctx.textAlign='center';
        ctx.fillText('m/z →', W/2, H-4);
        ctx.save(); ctx.translate(10,H/2); ctx.rotate(-Math.PI/2);
        ctx.fillText('1/K₀ (ion mobility) →', 0, 0); ctx.restore();
      },[]);

      return (
        <canvas ref={ref} width={520} height={200}
          style={{width:'100%',borderRadius:'0.5rem',display:'block',
            border:'1px solid rgba(88,166,255,0.12)',
            boxShadow:'0 0 30px rgba(88,166,255,0.04)'}}/>
      );
    }

    // Animated stat counter card
    function LSCounter({ target, suffix='', prefix='', color, label, icon, delay=0 }) {
      const [val, setVal] = useState(0);
      const [vis, setVis]  = useState(false);
      useEffect(()=>{
        const t0 = setTimeout(()=>{
          setVis(true);
          let step=0; const steps=45, ms=1300/steps;
          const id=setInterval(()=>{
            step++;
            const ease=1-Math.pow(1-step/steps,3);
            setVal(Math.round(target*ease));
            if(step>=steps) clearInterval(id);
          },ms);
          return ()=>clearInterval(id);
        }, delay);
        return ()=>clearTimeout(t0);
      },[target, delay]);

      return (
        <div style={{
          textAlign:'center', padding:'1.1rem 0.75rem',
          background:`${color}09`, border:`1px solid ${color}28`,
          borderRadius:'0.75rem',
          opacity: vis?1:0, transform: vis?'scale(1)':'scale(0.85)',
          transition:'all 0.45s cubic-bezier(.34,1.56,.64,1)',
        }}>
          <div style={{fontSize:'1.75rem',marginBottom:'0.15rem'}}>{icon}</div>
          <div style={{
            fontSize:'2rem',fontWeight:900,color,fontFamily:'monospace',
            lineHeight:1,letterSpacing:'-1px',
            textShadow:`0 0 25px ${color}55`,
          }}>{prefix}{val.toLocaleString()}{suffix}</div>
          <div style={{fontSize:'0.68rem',color:'var(--muted)',marginTop:'0.3rem',lineHeight:1.45}}>
            {label}
          </div>
        </div>
      );
    }

    // Main story component
    // Live corridor panel — uses real run data when available, art otherwise
    function LSLiveCorridorPanel({ runs, ionsRef, loadIons }) {
      const K0_LO=0.48, K0_HI=1.82, W=200, H=120;
      const mzLo=300, mzHi=1400;
      const canvasRef = useRef(null);
      const [runName, setRunName] = useState(null);
      const [loading, setLoading] = useState(false);
      const [loaded, setLoaded] = useState(false);

      useEffect(()=>{
        // Auto-load the first available run (silently)
        if (!runs||!runs.length) { drawArt(); return; }
        const first = runs[0];
        if (!first?.id) { drawArt(); return; }
        setLoading(true);
        setRunName(first.run_name||first.id);
        fetch(`/api/runs/${first.id}/mobility-3d?max_features=8000`)
          .then(r=>r.json())
          .then(d=>{
            d._runId=first.id;
            ionsRef.current._story=d;
            drawLive(d);
            setLoaded(true);
          })
          .catch(()=>drawArt())
          .finally(()=>setLoading(false));
      },[runs]);

      function drawLive(ions) {
        const canvas=canvasRef.current; if(!canvas||!ions?.mz)return;
        const mzStep=(mzHi-mzLo)/W, k0Step=(K0_HI-K0_LO)/H;
        const flat=new Float64Array(W*H);
        for(let i=0;i<ions.mz.length;i++){
          if(ions.mz[i]<mzLo||ions.mz[i]>mzHi)continue;
          if(ions.mobility[i]<K0_LO||ions.mobility[i]>K0_HI)continue;
          const xi=Math.min(W-1,Math.floor((ions.mz[i]-mzLo)/mzStep));
          const yi=Math.min(H-1,Math.floor((ions.mobility[i]-K0_LO)/k0Step));
          flat[yi*W+xi]+=ions.log_int[i];
        }
        _lsDrawHeatmap(canvas, flat, W, H, {mzLo,mzHi,K0_LO,K0_HI,palette:'blue',showCorridors:true});
      }

      // Procedural art: generate fake ions clustered along charge corridors,
      // then render via _lsDrawHeatmap so it looks identical to real data.
      function drawArt() {
        const canvas=canvasRef.current; if(!canvas)return;
        const rand=_lsRand(77);
        const mzStep=(mzHi-mzLo)/W, k0Step=(K0_HI-K0_LO)/H;
        const flat=new Float64Array(W*H);
        // Distribute fake ions along each charge corridor with realistic scatter
        const corridors=[
          {z:1, n:600,  scatter:0.045},
          {z:2, n:2800, scatter:0.055},
          {z:3, n:2000, scatter:0.06},
          {z:4, n:1000, scatter:0.065},
        ];
        corridors.forEach(({z,n,scatter})=>{
          for(let i=0;i<n;i++){
            const mz=mzLo+rand()*(mzHi-mzLo);
            const k0=_lsCcsExpected(mz,z)+(rand()-0.5)*scatter*2;
            if(k0<K0_LO||k0>K0_HI)continue;
            const xi=Math.min(W-1,Math.floor((mz-mzLo)/mzStep));
            const yi=Math.min(H-1,Math.floor((k0-K0_LO)/k0Step));
            flat[yi*W+xi]+=1.5+rand()*3;
          }
        });
        // Add background noise
        for(let i=0;i<500;i++){
          const xi=Math.floor(rand()*W), yi=Math.floor(rand()*H);
          flat[yi*W+xi]+=rand()*0.4;
        }
        _lsDrawHeatmap(canvas, flat, W, H, {mzLo,mzHi,K0_LO,K0_HI,palette:'blue',showCorridors:true});
      }

      return (
        <div>
          <div style={{position:'relative'}}>
            <canvas ref={canvasRef} width={900} height={380}
              style={{width:'100%',borderRadius:'0.5rem',display:'block',
                border:'1px solid rgba(88,166,255,0.15)',
                boxShadow:'0 0 30px rgba(88,166,255,0.06)'}}/>
            {loading && (
              <div style={{position:'absolute',top:'6px',left:'8px',
                fontSize:'0.65rem',color:'#f0883e',display:'flex',gap:'4px',alignItems:'center'}}>
                <span style={{animation:'spin 1s linear infinite',display:'inline-block'}}>⟳</span>
                Loading your data…
              </div>
            )}
            {loaded && runName && (
              <div style={{position:'absolute',top:'6px',right:'8px',
                background:'rgba(88,166,255,0.12)',border:'1px solid rgba(88,166,255,0.3)',
                borderRadius:'0.3rem',padding:'2px 8px',fontSize:'0.62rem',color:'#58a6ff'}}>
                📡 Live: {runName.length>28?runName.slice(0,25)+'…':runName}
              </div>
            )}
          </div>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // TRON HYPER-GRID — animated perspective corridor with charge-state lanes
    // ══════════════════════════════════════════════════════════════════════
    function LSHyperGrid() {
      const ref = useRef(null);
      useEffect(() => {
        const canvas = ref.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const VP_Y = H * 0.30; // vanishing point height
        let raf;

        const LANES = [
          { col:[45,212,191],  label:'z+1', sub:'HIGH 1/K₀', lx:-0.74 },
          { col:[96,165,250],  label:'z+2', sub:'DOMINANT',  lx:-0.24 },
          { col:[34,197,94],   label:'z+3', sub:'',          lx: 0.24 },
          { col:[249,115,22],  label:'z+4', sub:'LOW 1/K₀',  lx: 0.74 },
        ];

        // Pre-generate particles per lane
        const rand = _lsRand(133);
        const particles = LANES.flatMap((ln, li) =>
          Array.from({length:9}, (_,i) => ({
            li, p:(i/9 + li*0.23)%1, jitter:(rand()-0.5)*0.06, speed:0.0028+rand()*0.0012,
          }))
        );

        let t = 0;
        function frame() {
          t += 0.007;
          // Background gradient
          const bg = ctx.createLinearGradient(0,0,0,H);
          bg.addColorStop(0,'#00050f'); bg.addColorStop(1,'#000306');
          ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

          // ── floor grid ─────────────────────��────────────────────────
          const scroll = (t*5)%1;
          for (let r=0; r<=26; r++) {
            const frac = ((r+scroll)/26); if(frac>=1) continue;
            const depth = Math.pow(frac,2.1);
            const y = VP_Y + (H-VP_Y)*depth;
            const hw = depth*W*0.53;
            const a = Math.min(depth*0.75,0.45);
            ctx.strokeStyle=`rgba(0,190,255,${a.toFixed(2)})`; ctx.lineWidth=0.3+depth*1.3;
            ctx.beginPath(); ctx.moveTo(W/2-hw,y); ctx.lineTo(W/2+hw,y); ctx.stroke();
          }
          for (let c=-7; c<=7; c++) {
            const f = c/7;
            const a = (1-Math.abs(f)*0.65)*0.22;
            ctx.strokeStyle=`rgba(0,160,255,${a.toFixed(2)})`; ctx.lineWidth=0.5;
            ctx.beginPath();
            ctx.moveTo(W/2+f*W*0.04, VP_Y);
            ctx.lineTo(W/2+f*W*0.55, H);
            ctx.stroke();
          }

          // ── horizon glow ────────────────────────────────────────────
          const hg = ctx.createRadialGradient(W/2,VP_Y,0,W/2,VP_Y,W*0.48);
          hg.addColorStop(0,'rgba(0,100,255,0.22)'); hg.addColorStop(1,'rgba(0,0,0,0)');
          ctx.fillStyle=hg; ctx.fillRect(0,0,W,H);

          // ── corridor beams ──────────────────────────────────��────────
          LANES.forEach(({col:[r,g,b],label,sub,lx}) => {
            const xFar  = W/2 + lx*W*0.045;
            const xNear = W/2 + lx*W*0.76;

            // beam fill
            const bgrad = ctx.createLinearGradient(0,VP_Y,0,H);
            bgrad.addColorStop(0,`rgba(${r},${g},${b},0.0)`);
            bgrad.addColorStop(0.5,`rgba(${r},${g},${b},0.07)`);
            bgrad.addColorStop(1,`rgba(${r},${g},${b},0.02)`);
            const hw = W*0.062;
            ctx.beginPath();
            ctx.moveTo(xFar-1,VP_Y); ctx.lineTo(xNear-hw,H);
            ctx.lineTo(xNear+hw,H); ctx.lineTo(xFar+1,VP_Y);
            ctx.fillStyle=bgrad; ctx.fill();

            // dashed centerline with glow
            ctx.save();
            ctx.shadowColor=`rgb(${r},${g},${b})`; ctx.shadowBlur=8;
            ctx.strokeStyle=`rgba(${r},${g},${b},0.85)`; ctx.lineWidth=1.6;
            ctx.setLineDash([11,7]);
            ctx.beginPath(); ctx.moveTo(xFar,VP_Y); ctx.lineTo(xNear,H-28); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // lane label
            ctx.save();
            ctx.shadowColor=`rgb(${r},${g},${b})`; ctx.shadowBlur=12;
            ctx.fillStyle=`rgba(${r},${g},${b},0.95)`;
            ctx.font='bold 11px monospace'; ctx.textAlign='center';
            ctx.fillText(label, xNear, H-14);
            if (sub) {
              ctx.fillStyle=`rgba(${r},${g},${b},0.45)`;
              ctx.font='7.5px monospace';
              ctx.fillText(sub, xNear, H-5);
            }
            ctx.restore();
          });

          // ── animated ions ────────────────────────────────────────────
          particles.forEach(ion => {
            ion.p = (ion.p + ion.speed)%1;
            const {col:[r,g,b],lx} = LANES[ion.li];
            const depth = Math.pow(ion.p,1.8);
            const y  = VP_Y + (H-VP_Y)*depth;
            const xF = W/2+(lx+ion.jitter*0.3)*W*0.045;
            const xN = W/2+(lx+ion.jitter)*W*0.76;
            const x  = xF + (xN-xF)*ion.p;
            const sz = 1.2+depth*4.8;
            const fade = Math.min(ion.p*5,1)*Math.min((1-ion.p)*5,1);
            ctx.save();
            ctx.shadowColor=`rgb(${r},${g},${b})`; ctx.shadowBlur=16;
            ctx.fillStyle=`rgba(${r},${g},${b},${(fade*0.92).toFixed(2)})`;
            ctx.beginPath(); ctx.arc(x,y,sz,0,Math.PI*2); ctx.fill();
            ctx.restore();
            // trail
            const p0=Math.max(0,ion.p-0.055), d0=Math.pow(p0,1.8);
            const y0=VP_Y+(H-VP_Y)*d0, x0=xF+(xN-xF)*p0;
            const tg=ctx.createLinearGradient(x0,y0,x,y);
            tg.addColorStop(0,`rgba(${r},${g},${b},0)`);
            tg.addColorStop(1,`rgba(${r},${g},${b},${(fade*0.38).toFixed(2)})`);
            ctx.strokeStyle=tg; ctx.lineWidth=sz*0.55;
            ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x,y); ctx.stroke();
          });

          // ── scanline ─────────────────────────────────────────────────
          const sy = ((t*0.28)%1)*H;
          ctx.fillStyle='rgba(0,210,255,0.028)'; ctx.fillRect(0,sy-1,W,3);

          // ── HUD text ─────────────────────────────────────────────────
          ctx.fillStyle='rgba(0,180,255,0.2)'; ctx.font='8.5px monospace';
          ctx.textAlign='left';
          ctx.fillText('// PASEF CHARGE CORRIDOR ARRAY — 4D ION MOBILITY //', 10, H-8);

          raf = requestAnimationFrame(frame);
        }
        frame();
        return () => cancelAnimationFrame(raf);
      }, []);

      return (
        <canvas ref={ref} width={900} height={270} style={{
          width:'100%', display:'block', borderRadius:'0.6rem',
          border:'1px solid rgba(0,180,255,0.2)',
          boxShadow:'0 0 50px rgba(0,100,255,0.18), 0 0 12px rgba(0,0,0,0.8)',
        }}/>
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // HOLOGRAM RING — Star Wars holotable circular corridor fingerprint
    // ══════════════════════════════════════════════════════════════════════
    function LSCcsHologram() {
      const ref = useRef(null);
      useEffect(() => {
        const canvas = ref.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const cx = W/2, cy = H/2;
        const R = Math.min(W,H)*0.41;
        let raf, t=0;

        // Charge corridors mapped to radial bands
        // Each charge state = an arc band at a given radius fraction
        const ARCS = [
          { z:1, rf:0.88, col:[45,212,191],  label:'z+1', k0:'HIGH 1/K₀' },
          { z:2, rf:0.70, col:[96,165,250],  label:'z+2', k0:'~0.85–1.1' },
          { z:3, rf:0.52, col:[34,197,94],   label:'z+3', k0:'~0.65–0.9' },
          { z:4, rf:0.35, col:[249,115,22],  label:'z+4', k0:'LOW 1/K₀'  },
        ];

        function frame() {
          t += 0.006;
          ctx.fillStyle='#010408'; ctx.fillRect(0,0,W,H);

          // base glow
          const bg=ctx.createRadialGradient(cx,cy,0,cx,cy,R*1.1);
          bg.addColorStop(0,'rgba(0,60,180,0.18)');
          bg.addColorStop(0.5,'rgba(0,40,120,0.06)');
          bg.addColorStop(1,'rgba(0,0,0,0)');
          ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

          // outer decorative rings
          [1.02,1.0,0.12].forEach((rf,i)=>{
            ctx.strokeStyle=`rgba(0,200,255,${[0.12,0.2,0.3][i]})`;
            ctx.lineWidth=[0.5,1,0.5][i];
            ctx.beginPath(); ctx.arc(cx,cy,R*rf,0,Math.PI*2); ctx.stroke();
          });

          // tick marks on outer ring
          for(let i=0;i<72;i++){
            const a=i/72*Math.PI*2;
            const len=i%6===0?0.06:0.03;
            const r0=R*1.0, r1=R*(1.0-len);
            ctx.strokeStyle=`rgba(0,200,255,${i%6===0?0.5:0.2})`;
            ctx.lineWidth=0.6;
            ctx.beginPath();
            ctx.moveTo(cx+r0*Math.cos(a),cy+r0*Math.sin(a));
            ctx.lineTo(cx+r1*Math.cos(a),cy+r1*Math.sin(a));
            ctx.stroke();
          }

          // Charge corridor arcs (dashed partial arcs representing m/z ranges)
          ARCS.forEach(({rf,col:[r,g,b],label,k0,z})=>{
            const R2 = R*rf;
            const arcStart = -Math.PI*0.9;
            const arcEnd   =  Math.PI*0.9;

            // Arc glow band
            ctx.save();
            ctx.strokeStyle=`rgba(${r},${g},${b},0.12)`;
            ctx.lineWidth=14;
            ctx.beginPath(); ctx.arc(cx,cy,R2,arcStart,arcEnd); ctx.stroke();
            // Arc center line
            ctx.shadowColor=`rgb(${r},${g},${b})`; ctx.shadowBlur=8;
            ctx.strokeStyle=`rgba(${r},${g},${b},0.8)`;
            ctx.lineWidth=1.4; ctx.setLineDash([8,5]);
            ctx.beginPath(); ctx.arc(cx,cy,R2,arcStart,arcEnd); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // Label at right end of arc
            const lAngle = arcEnd + 0.08;
            const lx=cx+R2*Math.cos(lAngle), ly=cy+R2*Math.sin(lAngle);
            ctx.fillStyle=`rgba(${r},${g},${b},0.9)`;
            ctx.font='bold 9px monospace'; ctx.textAlign='left';
            ctx.fillText(label, lx+4, ly+3);
            ctx.fillStyle=`rgba(${r},${g},${b},0.45)`;
            ctx.font='7px monospace';
            ctx.fillText(k0, lx+4, ly+12);
          });

          // Rotating scan arm
          const scanA = t*0.7;
          const sg = ctx.createLinearGradient(cx,cy,cx+R*Math.cos(scanA),cy+R*Math.sin(scanA));
          sg.addColorStop(0,'rgba(0,220,255,0.6)');
          sg.addColorStop(1,'rgba(0,220,255,0)');
          ctx.save();
          ctx.shadowColor='rgba(0,220,255,0.8)'; ctx.shadowBlur=12;
          ctx.strokeStyle=sg; ctx.lineWidth=1.5;
          ctx.beginPath(); ctx.moveTo(cx,cy);
          ctx.lineTo(cx+R*Math.cos(scanA), cy+R*Math.sin(scanA));
          ctx.stroke();
          ctx.restore();

          // Scan sweep trailing wedge
          ctx.save();
          const sweepGrad = ctx.createConicalGradient
            ? null // not available in 2d context
            : null;
          // Use manual fill instead
          ctx.globalAlpha=0.06;
          ctx.fillStyle='rgba(0,220,255,1)';
          ctx.beginPath();
          ctx.moveTo(cx,cy);
          ctx.arc(cx,cy,R,scanA-0.45,scanA);
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha=1;
          ctx.restore();

          // Center orb
          const orb=ctx.createRadialGradient(cx,cy,0,cx,cy,R*0.08);
          orb.addColorStop(0,'rgba(100,220,255,0.9)');
          orb.addColorStop(0.5,'rgba(0,140,255,0.4)');
          orb.addColorStop(1,'rgba(0,60,180,0)');
          ctx.fillStyle=orb;
          ctx.beginPath(); ctx.arc(cx,cy,R*0.08,0,Math.PI*2); ctx.fill();

          // Axis labels
          ctx.fillStyle='rgba(0,180,255,0.35)'; ctx.font='8px monospace';
          ctx.textAlign='center';
          ctx.fillText('m/z ──────────────── →', cx, H-6);
          ctx.save();
          ctx.translate(11, cy); ctx.rotate(-Math.PI/2);
          ctx.fillText('1/K₀ ────── →', 0, 0);
          ctx.restore();

          // "timsTOF fingerprint" watermark
          ctx.fillStyle='rgba(0,180,255,0.18)'; ctx.font='7.5px monospace';
          ctx.textAlign='center';
          ctx.fillText('CCS FINGERPRINT', cx, 14);

          raf = requestAnimationFrame(frame);
        }
        frame();
        return () => cancelAnimationFrame(raf);
      }, []);

      return (
        <canvas ref={ref} width={340} height={340} style={{
          display:'block', borderRadius:'50%',
          border:'1px solid rgba(0,180,255,0.15)',
          boxShadow:'0 0 40px rgba(0,120,255,0.2)',
        }}/>
      );
    }

    function LandscapeStory({ setMode, runs, ionsRef }) {
      useEffect(()=>{ _lsInjectStyles(); },[]);

      const ACT = {
        background:'rgba(255,255,255,0.015)',
        border:'1px solid var(--border)',
        borderRadius:'0.75rem',
        padding:'1.25rem',
        marginBottom:'0.85rem',
      };
      const BADGE = {
        display:'inline-block', fontSize:'0.68rem', fontWeight:700,
        padding:'0.2rem 0.6rem', borderRadius:'2rem',
        textTransform:'uppercase', letterSpacing:'0.5px',
        marginBottom:'0.5rem',
      };

      return (
        <div>
          {/* ── Cinematic TRON opener ─────────────────────────────────── */}
          <LSHyperGrid />

          {/* ── Hero ─────────────────────────────────────────────────── */}
          <div style={{
            ...ACT,
            background:'linear-gradient(135deg,rgba(14,0,24,0.95),rgba(26,0,48,0.8))',
            border:'1px solid rgba(218,170,0,0.25)',
            textAlign:'center', padding:'1.5rem 1.5rem',
            marginTop:'0.6rem',
          }}>
            <div style={{fontSize:'2.2rem',marginBottom:'0.3rem'}} className="ls-float">⚡</div>
            <h2 className="ls-gold-shimmer" style={{
              fontSize:'1.5rem', fontWeight:900, margin:'0 0 0.5rem',
              lineHeight:1.2,
            }}>
              Your mass spec just unlocked a new dimension
            </h2>
            <p style={{fontSize:'0.88rem',color:'#94a3b8',lineHeight:1.8,maxWidth:'560px',margin:'0 auto 1.25rem'}}>
              Every other instrument hands you a <strong style={{color:'#cbd5e1'}}>flat photograph</strong>.
              timsTOF hands you a <strong style={{color:'#DAAA00'}}>4D hologram</strong>.
              This tab shows you exactly what that means — from zero to breakthrough.
            </p>
            {/* Big dimension badges */}
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'center',flexWrap:'wrap',marginBottom:'1.25rem'}}>
              {[
                {n:'3D',lbl:'Standard MS',col:'#64748b',sub:'RT · m/z · Intensity'},
                {n:'+1',lbl:'timsTOF adds',col:'#DAAA00',sub:'Ion Mobility (1/K₀)'},
                {n:'4D',lbl:'Total dimensions',col:'#58a6ff',sub:'Shape-resolved data'},
              ].map(({n,lbl,col,sub})=>(
                <div key={n} style={{
                  background:`${col}10`,border:`1px solid ${col}35`,
                  borderRadius:'0.6rem',padding:'0.7rem 1rem',minWidth:'120px',
                }}>
                  <div style={{fontSize:'1.6rem',fontWeight:900,color:col,fontFamily:'monospace',
                    textShadow:`0 0 20px ${col}55`}}>{n}</div>
                  <div style={{fontSize:'0.72rem',fontWeight:700,color:col,marginTop:'0.1rem'}}>{lbl}</div>
                  <div style={{fontSize:'0.63rem',color:'#475569'}}>{sub}</div>
                </div>
              ))}
            </div>
            <LSHeroCanvas />
          </div>

          {/* ── Your Data Teaser (shown when runs exist) ─────────────── */}
          {runs && runs.length > 0 && (
            <div style={{
              ...ACT,
              border:'1px solid rgba(34,197,94,0.3)',
              background:'linear-gradient(135deg,rgba(34,197,94,0.05),rgba(88,166,255,0.05))',
              padding:'1rem 1.25rem',
            }}>
              <div style={{display:'flex',gap:'0.75rem',alignItems:'center',flexWrap:'wrap'}}>
                <div style={{fontSize:'1.6rem'}} className="ls-float">🔭</div>
                <div style={{flex:1,minWidth:'200px'}}>
                  <div style={{fontSize:'0.82rem',fontWeight:700,color:'#22c55e',marginBottom:'0.2rem'}}>
                    We found {runs.length} run{runs.length>1?'s':''} in your instrument database
                  </div>
                  <div style={{fontSize:'0.73rem',color:'var(--muted)',lineHeight:1.6}}>
                    The charge-corridor map in Act 3 below is drawn from your <em>actual data</em> —
                    the diagonal lanes you'll see are real peptides from your instrument.
                    Jump to <strong style={{color:'#58a6ff'}}>Scan My Run</strong> at any time to explore them interactively.
                  </div>
                </div>
                <button onClick={()=>setMode('scanner')} style={{
                  padding:'0.5rem 1.1rem',borderRadius:'0.4rem',cursor:'pointer',fontWeight:700,
                  background:'rgba(34,197,94,0.12)',border:'1px solid rgba(34,197,94,0.4)',
                  color:'#22c55e',fontSize:'0.82rem',whiteSpace:'nowrap',
                }}>Go to Scanner →</button>
              </div>
              <div style={{marginTop:'0.7rem',fontSize:'0.68rem',color:'#2a4a3a',
                display:'flex',flexWrap:'wrap',gap:'0.5rem'}}>
                {runs.slice(0,6).map(r=>(
                  <div key={r.id} style={{
                    background:'rgba(34,197,94,0.06)',border:'1px solid rgba(34,197,94,0.15)',
                    borderRadius:'0.3rem',padding:'2px 8px',color:'#22c55e',fontSize:'0.64rem',
                  }}>📁 {(r.run_name||r.id).slice(0,30)}</div>
                ))}
                {runs.length>6&&<div style={{color:'#2a4a3a',alignSelf:'center'}}>+{runs.length-6} more</div>}
              </div>
            </div>
          )}

          {/* ── Act 1: The Problem ───────────────────────────────────── */}
          <div style={ACT}>
            <div style={{...BADGE, background:'rgba(239,68,68,0.1)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.25)'}}>
              🚨 The Problem
            </div>
            <h3 style={{fontSize:'1.05rem',margin:'0 0 0.6rem',color:'var(--text)'}}>
              Without mobility: peptides crash each other's party
            </h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'0.6rem',marginBottom:'1rem'}}>
              {[
                {icon:'😵',title:'Up to 60% chimeric',col:'#ef4444',
                  body:"When two peptides have similar m/z AND RT, the instrument can't tell them apart. They both appear in the same spectrum. This is called a 'chimeric' spectrum."},
                {icon:'🔍',title:'3D is a flat map',col:'#f97316',
                  body:'Retention time separates peptides in time. m/z separates by mass. But in a complex sample both dimensions are packed — peptides overlap and contaminate each other.'},
                {icon:'❓',title:'Wrong IDs',col:'#eab308',
                  body:'Chimeric spectra lead to incorrect peptide identifications, missed proteins, and false quantitation. A hidden source of noise in every 2D/3D experiment.'},
              ].map(m=>(
                <div key={m.title} style={{background:`${m.col}08`,border:`1px solid ${m.col}22`,
                  borderRadius:'0.55rem',padding:'0.8rem'}}>
                  <div style={{fontSize:'1.4rem',marginBottom:'0.25rem'}}>{m.icon}</div>
                  <div style={{fontSize:'0.82rem',fontWeight:700,color:m.col,marginBottom:'0.3rem'}}>{m.title}</div>
                  <div style={{fontSize:'0.71rem',color:'#64748b',lineHeight:1.6}}>{m.body}</div>
                </div>
              ))}
            </div>
            {/* Visual: overlapping bar chart analogy */}
            <div style={{background:'rgba(0,0,0,0.3)',borderRadius:'0.5rem',padding:'0.75rem',textAlign:'center'}}>
              <div style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:'0.5rem'}}>
                Two peptides. Same mass. Same retention time. Standard MS → completely overlapping:
              </div>
              <div style={{display:'flex',justifyContent:'center',alignItems:'flex-end',gap:'2px',height:'60px',position:'relative'}}>
                {/* Peptide A spectrum */}
                {[10,25,60,100,80,45,20,8,3].map((h,i)=>(
                  <div key={`a${i}`} style={{
                    width:'18px',
                    background:'rgba(88,166,255,0.6)',
                    height:`${h*0.55}px`,
                    borderRadius:'2px 2px 0 0',
                    position:'absolute',
                    left:`calc(50% + ${(i-4)*20}px)`,
                    bottom:0,
                  }}/>
                ))}
                {/* Peptide B spectrum — offset, overlapping */}
                {[5,15,45,90,100,70,35,12,4].map((h,i)=>(
                  <div key={`b${i}`} style={{
                    width:'18px',
                    background:'rgba(249,115,22,0.55)',
                    height:`${h*0.55}px`,
                    borderRadius:'2px 2px 0 0',
                    position:'absolute',
                    left:`calc(50% + ${(i-3.5)*20}px)`,
                    bottom:0,
                  }}/>
                ))}
              </div>
              <div style={{fontSize:'0.68rem',color:'#ef4444',marginTop:'0.6rem'}}>
                🔵 Peptide A + 🟠 Peptide B = impossible to deconvolute
              </div>
            </div>
          </div>

          {/* ── Act 2: The Solution — TIMS ──────────────────────────── */}
          <div style={ACT}>
            <div style={{...BADGE, background:'rgba(34,197,94,0.1)', color:'#22c55e', border:'1px solid rgba(34,197,94,0.25)'}}>
              ✅ The Solution
            </div>
            <h3 style={{fontSize:'1.05rem',margin:'0 0 0.35rem',color:'var(--text)'}}>
              TIMS: the world's fastest molecular shape-sorter
            </h3>
            <p style={{fontSize:'0.8rem',color:'var(--muted)',lineHeight:1.7,margin:'0 0 0.85rem'}}>
              TIMS stands for <strong style={{color:'var(--text)'}}>Trapped Ion Mobility Spectrometry</strong>.
              Before ions hit the mass analyser, they're trapped in a gas-filled cell and released
              in order of their <strong style={{color:'#22c55e'}}>3D shape</strong>.
              Like a bouncer who checks everyone's size before letting them through the door.
            </p>

            <LSTIMSTube />

            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'0.55rem',marginTop:'0.85rem'}}>
              {[
                {icon:'⚡',col:'#22c55e',title:'Microsecond separation',
                  body:'The entire TIMS separation happens in ~100ms — fast enough to run thousands of times per LC gradient.'},
                {icon:'🎯',col:'#60a5fa',title:'Shape = 1/K₀',
                  body:"Compact ions drift fast → low 1/K₀ (bottom of plot). Extended ions drift slow → high 1/K₀ (top of plot). This is the ion's Collision Cross Section (CCS)."},
                {icon:'🧬',col:'#DAAA00',title:'CCS is reproducible',
                  body:'CCS values are stable across labs, instruments, and years. Like a molecular barcode — use it to confirm you found the right peptide.'},
              ].map(m=>(
                <div key={m.title} style={{background:`${m.col}09`,border:`1px solid ${m.col}22`,
                  borderRadius:'0.55rem',padding:'0.8rem'}}>
                  <div style={{fontSize:'1.3rem',marginBottom:'0.2rem'}}>{m.icon}</div>
                  <div style={{fontSize:'0.8rem',fontWeight:700,color:m.col,marginBottom:'0.25rem'}}>{m.title}</div>
                  <div style={{fontSize:'0.7rem',color:'#64748b',lineHeight:1.6}}>{m.body}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Act 3: The Map — Charge Corridors ───────────────────── */}
          <div style={ACT}>
            <div style={{...BADGE, background:'rgba(88,166,255,0.1)', color:'#58a6ff', border:'1px solid rgba(88,166,255,0.25)'}}>
              🗺️ The 4D Map
            </div>
            <h3 style={{fontSize:'1.05rem',margin:'0 0 0.35rem',color:'var(--text)'}}>
              Every peptide has a zip code — and only timsTOF can read it
            </h3>
            <p style={{fontSize:'0.8rem',color:'var(--muted)',lineHeight:1.7,margin:'0 0 0.85rem'}}>
              Plot every ion as <strong style={{color:'#58a6ff'}}>m/z (horizontal)</strong> vs&nbsp;
              <strong style={{color:'#60a5fa'}}>1/K₀ ion mobility (vertical)</strong>.
              Peptides don't scatter randomly — they fall along <strong style={{color:'#DAAA00'}}>diagonal charge corridors</strong>.
              z+1 sits <strong style={{color:'var(--text)'}}>highest</strong> (largest at same m/z → slowest → high 1/K₀).
              z+4 sits <strong style={{color:'var(--text)'}}>lowest</strong>. This structure is <em>invisible</em> to standard MS.
            </p>
            {/* Heatmap + hologram side by side */}
            <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'0.85rem',alignItems:'start',marginBottom:'0.75rem'}}>
              <div style={{minWidth:0}}>
                <LSLiveCorridorPanel runs={runs} ionsRef={ionsRef} loadIons={null}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'0.35rem'}}>
                <LSCcsHologram />
                <div style={{fontSize:'0.65rem',color:'rgba(0,180,255,0.45)',textAlign:'center',fontFamily:'monospace'}}>
                  CCS fingerprint<br/>radar scan
                </div>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:'0.5rem',marginTop:'0'}}>
              {[
                {col:'#2dd4bf',emoji:'1️⃣',title:'z+1 — top',
                  body:'Singly charged ions sit highest on the plot. At the same m/z they represent the largest peptide mass → slowest → highest 1/K₀.'},
                {col:'#60a5fa',emoji:'⚡',title:'z+2 — middle',
                  body:'Most tryptic peptides are doubly charged (+2). The dominant corridor in any tryptic digest — sits just below z+1.'},
                {col:'#22c55e',emoji:'💪',title:'z+3 — lower',
                  body:'Longer peptides with more basic residues. At the same m/z they carry three charges, pulling them below the z+2 corridor.'},
                {col:'#f97316',emoji:'🚀',title:'z+4 — bottom',
                  body:'Highly charged large peptides, phosphopeptides, cross-linked species. Lowest 1/K₀ — compact charge-to-size ratio puts them at the bottom.'},
              ].map(m=>(
                <div key={m.title} style={{background:`${m.col}08`,border:`1px solid ${m.col}20`,
                  borderRadius:'0.5rem',padding:'0.65rem'}}>
                  <div style={{fontSize:'0.78rem',fontWeight:700,color:m.col,marginBottom:'0.2rem'}}>
                    {m.emoji} {m.title}
                  </div>
                  <div style={{fontSize:'0.69rem',color:'#64748b',lineHeight:1.55}}>{m.body}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Act 4: The Numbers ──────────────────────────────────── */}
          <div style={ACT}>
            <div style={{...BADGE, background:'rgba(217,70,239,0.1)', color:'#d946ef', border:'1px solid rgba(217,70,239,0.25)'}}>
              📊 By the Numbers
            </div>
            <h3 style={{fontSize:'1.05rem',margin:'0 0 0.85rem',color:'var(--text)'}}>
              The advantage, quantified
            </h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(145px,1fr))',gap:'0.65rem'}}>
              <LSCounter icon="🌊" target={10}    suffix="M+"  color="#58a6ff" delay={0}
                label="ions detected per typical timsTOF run"/>
              <LSCounter icon="📐" target={4}     suffix=""    color="#22c55e" delay={150}
                label="independent dimensions — RT · m/z · 1/K₀ · Intensity"/>
              <LSCounter icon="🚀" target={10}    suffix="×"   color="#DAAA00" delay={300}
                label="more peak capacity vs 2D LC-MS alone"/>
              <LSCounter icon="✂️"  target={60}   suffix="%"   color="#f97316" delay={450} prefix="−"
                label="fewer chimeric spectra thanks to PASEF fragmentation"/>
              <LSCounter icon="🔬" target={6000}  suffix="+"   color="#a855f7" delay={600}
                label="proteins identified in a single 60-min gradient on K562"/>
              <LSCounter icon="🎯" target={99}    suffix="%"   color="#2dd4bf" delay={750}
                label="CCS reproducibility across instruments and labs"/>
            </div>
          </div>

          {/* ── Act 5: CTA ──────────────────────────────────────────── */}
          <div style={{
            ...ACT,
            background:'linear-gradient(135deg,rgba(218,170,0,0.06),rgba(88,166,255,0.06))',
            border:'1px solid rgba(218,170,0,0.2)',
            textAlign:'center', padding:'1.5rem',
          }}>
            <div style={{fontSize:'1.6rem',marginBottom:'0.5rem'}} className="ls-float">🔭</div>
            <h3 style={{margin:'0 0 0.5rem',color:'var(--text)',fontSize:'1.05rem'}}>
              Ready to explore your own data?
            </h3>
            <p style={{fontSize:'0.8rem',color:'var(--muted)',margin:'0 0 1rem',lineHeight:1.7}}>
              Pick a timsTOF run and see these corridors — live — from your actual instrument data.
            </p>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'center',flexWrap:'wrap'}}>
              <button onClick={()=>setMode('scanner')} style={{
                padding:'0.65rem 1.5rem', borderRadius:'0.45rem', cursor:'pointer',
                background:'linear-gradient(135deg,rgba(88,166,255,0.25),rgba(88,166,255,0.1))',
                border:'1px solid rgba(88,166,255,0.4)', color:'#58a6ff',
                fontSize:'0.9rem', fontWeight:700,
                boxShadow:'0 0 20px rgba(88,166,255,0.15)',
              }}>📡 Scan My Run →</button>
              <button onClick={()=>setMode('compare')} style={{
                padding:'0.65rem 1.5rem', borderRadius:'0.45rem', cursor:'pointer',
                background:'rgba(218,170,0,0.1)', border:'1px solid rgba(218,170,0,0.35)',
                color:'#DAAA00', fontSize:'0.9rem', fontWeight:700,
              }}>⚔️ Compare Two Runs →</button>
            </div>
          </div>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // SCANNER MODE — live 2D heatmap with RT sweep
    // ══════════════════════════════════════════════════════════════════════
    function LandscapeScanner({ selA, setSelA, ionsRef, loadIons, ionsLoading, runOpts }) {
      const K0_LO = 0.48, K0_HI = 1.82;
      const W = 160, H = 100;  // grid resolution
      const [mzLo, setMzLo]     = useState(300);
      const [mzHi, setMzHi]     = useState(1500);
      const [rtCenter, setRtCenter] = useState(30);
      const [rtWidth, setRtWidth]   = useState(4);
      const [ionCount, setIonCount] = useState(null);
      const [ticData, setTicData]   = useState(null);
      const [charging, setCharging] = useState({});
      const canvasRef  = useRef(null);
      const ticRef     = useRef(null);

      function buildFlat(ions, rtLo, rtHi) {
        if (!ions?.mz) return null;
        const mzStep = (mzHi-mzLo)/W, k0Step = (K0_HI-K0_LO)/H;
        const flat = new Float64Array(W*H);
        const cMap = {};
        let kept = 0;
        const rtLoS = rtLo*60, rtHiS = rtHi*60;
        for (let i=0;i<ions.mz.length;i++) {
          if (ions.rt[i]<rtLoS||ions.rt[i]>rtHiS) continue;
          if (ions.mz[i]<mzLo||ions.mz[i]>mzHi)  continue;
          if (ions.mobility[i]<K0_LO||ions.mobility[i]>K0_HI) continue;
          const xi = Math.min(W-1,Math.floor((ions.mz[i]-mzLo)/mzStep));
          const yi = Math.min(H-1,Math.floor((ions.mobility[i]-K0_LO)/k0Step));
          flat[yi*W+xi] += ions.log_int[i]; kept++;
          const z = ions.charge[i]||0;
          cMap[z] = (cMap[z]||0)+1;
        }
        return {flat, kept, cMap};
      }

      function buildTic(ions) {
        if (!ions?.mz) return null;
        const BINS = 200;
        const rtArr = ions.rt.map(r=>r/60);
        const rtMin = Math.min(...rtArr), rtMax = Math.max(...rtArr);
        const step = (rtMax-rtMin)/BINS;
        const tic = new Float64Array(BINS);
        for (let i=0;i<rtArr.length;i++) {
          const b = Math.min(BINS-1,Math.floor((rtArr[i]-rtMin)/step));
          tic[b] += Math.pow(10, ions.log_int[i]);
        }
        return {x:Array.from({length:BINS},(_,i)=>rtMin+i*step),
                y:Array.from(tic), rtMin, rtMax};
      }

      function drawTic(canvas, tic, lo, hi) {
        if (!canvas||!tic||!window.Plotly) return;
        const maxY = Math.max(...tic.y, 1);
        window.Plotly.react(canvas,[
          {type:'scatter',mode:'lines',x:tic.x,y:tic.y,
           fill:'tozeroy',fillcolor:'rgba(88,166,255,0.12)',
           line:{color:'rgba(88,166,255,0.7)',width:1.5},
           hovertemplate:'RT:%{x:.1f} min<extra></extra>'},
          {type:'scatter',mode:'lines',showlegend:false,hoverinfo:'skip',
           x:[lo,lo,hi,hi,lo],y:[0,maxY*1.05,maxY*1.05,0,0],
           fill:'toself',fillcolor:'rgba(88,166,255,0.1)',
           line:{color:'rgba(88,166,255,0.5)',width:1,dash:'dot'}},
        ],{
          paper_bgcolor:'transparent',plot_bgcolor:'transparent',
          margin:{l:30,r:5,t:4,b:24},
          font:{color:'#64748b',size:8},
          xaxis:{title:{text:'RT (min)',font:{size:8}},gridcolor:'rgba(30,58,95,0.3)',
            tickfont:{size:7},range:[tic.rtMin,tic.rtMax]},
          yaxis:{showgrid:false,showticklabels:false,zeroline:false},
          showlegend:false,hovermode:'x',
        },{responsive:true,displayModeBar:false});
      }

      function redraw() {
        const ions = ionsRef.current.A;
        const lo = rtCenter - rtWidth/2, hi = rtCenter + rtWidth/2;
        const res = buildFlat(ions, lo, hi);
        if (res) {
          setIonCount(res.kept);
          setCharging(res.cMap);
          _lsDrawHeatmap(canvasRef.current, res.flat, W, H,
            {mzLo, mzHi, K0_LO, K0_HI, palette:'blue', showCorridors:true});
        } else {
          setIonCount(null);
        }
        const td = ticData;
        if (td) drawTic(ticRef.current, td, lo, hi);
      }

      useEffect(()=>{ redraw(); },[rtCenter,rtWidth,mzLo,mzHi,ticData]);

      async function loadAndScan() {
        await loadIons('A', selA);
        const ions = ionsRef.current.A;
        if (ions) {
          const td = buildTic(ions);
          setTicData(td);
          if (td) setRtCenter((td.rtMin+td.rtMax)/2);
        }
      }

      const CHARGE_COL = {1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7'};

      return (
        <div>
          {/* Top explainer */}
          <div style={{fontSize:'0.79rem',color:'var(--muted)',marginBottom:'0.75rem',lineHeight:1.75,
            background:'rgba(88,166,255,0.04)',border:'1px solid rgba(88,166,255,0.12)',
            borderRadius:'0.5rem',padding:'0.65rem 0.85rem'}}>
            📡 <strong style={{color:'#58a6ff'}}>The Scanner</strong> — a live 2D heatmap of your actual timsTOF run.
            Horizontal axis = <strong style={{color:'var(--text)'}}>m/z</strong>.
            Vertical axis = <strong style={{color:'var(--text)'}}>ion mobility (1/K₀)</strong>.
            Each glowing blob is a cluster of peptides.
            The <strong style={{color:'#DAAA00'}}>diagonal lines</strong> are charge-state corridors — only timsTOF can see them.
            Drag the <strong style={{color:'var(--text)'}}>RT slider</strong> to sweep through the gradient like a time machine.
          </div>

          {/* Run selector + load button */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.7rem 1rem'}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:'0.75rem',alignItems:'flex-end'}}>
              <LsRunSelector label="timsTOF Run" color="#58a6ff"
                value={selA} onChange={v=>{setSelA(v); ionsRef.current.A=null; setTicData(null); setIonCount(null);}}
                opts={runOpts} loading={ionsLoading.A}/>
              <button onClick={loadAndScan} disabled={!selA||ionsLoading.A}
                style={{
                  padding:'0.45rem 1.2rem', borderRadius:'0.4rem', cursor: selA?'pointer':'not-allowed',
                  background: selA?'linear-gradient(135deg,rgba(88,166,255,0.25),rgba(88,166,255,0.1))':'transparent',
                  border:`1px solid ${selA?'rgba(88,166,255,0.5)':'var(--border)'}`,
                  color: selA?'#58a6ff':'var(--muted)',fontWeight:700,
                  boxShadow: selA?'0 0 14px rgba(88,166,255,0.15)':'none',
                }}>
                {ionsLoading.A ? '⟳ Loading…' : '📡 Scan'}
              </button>
              {ionCount !== null && (
                <div style={{
                  display:'flex',gap:'0.5rem',alignItems:'center',
                  background:'rgba(88,166,255,0.06)',border:'1px solid rgba(88,166,255,0.2)',
                  borderRadius:'0.4rem',padding:'0.35rem 0.7rem',
                }}>
                  <span style={{fontSize:'0.85rem',fontWeight:700,color:'#58a6ff',fontFamily:'monospace'}}>
                    {ionCount.toLocaleString()}
                  </span>
                  <span style={{fontSize:'0.68rem',color:'var(--muted)'}}>ions in window</span>
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          {ticData && (
            <div className="card" style={{marginBottom:'0.6rem',padding:'0.7rem 1rem'}}>
              <div style={{display:'flex',flexWrap:'wrap',gap:'1rem',alignItems:'flex-end'}}>
                <div style={{flex:'1 1 280px'}}>
                  <div style={{fontSize:'0.68rem',color:'var(--muted)',marginBottom:'4px',letterSpacing:'.4px'}}>
                    ⏱ RT window: <strong style={{color:'var(--text)'}}>{rtCenter.toFixed(1)} min</strong>
                    &nbsp;(±{(rtWidth/2).toFixed(1)} min)
                  </div>
                  <input type="range" min={ticData.rtMin} max={ticData.rtMax} step="0.25"
                    value={rtCenter} onChange={e=>setRtCenter(+e.target.value)}
                    style={{width:'100%',accentColor:'#58a6ff'}}/>
                </div>
                <div>
                  <div style={{fontSize:'0.68rem',color:'var(--muted)',marginBottom:'4px'}}>Window width</div>
                  <div style={{display:'flex',gap:'4px'}}>
                    {[1,2,4,8].map(w=>(
                      <button key={w} onClick={()=>setRtWidth(w)} style={_lsBtn(rtWidth===w,'#58a6ff')}>
                        {w} min
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:'0.68rem',color:'var(--muted)',marginBottom:'4px'}}>m/z range</div>
                  <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                    <input type="number" value={mzLo} onChange={e=>setMzLo(+e.target.value)}
                      style={{...{background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',
                        borderRadius:'0.3rem',padding:'0.25rem 0.4rem',fontSize:'0.78rem',width:'72px'}}}/>
                    <span style={{color:'var(--muted)'}}>–</span>
                    <input type="number" value={mzHi} onChange={e=>setMzHi(+e.target.value)}
                      style={{...{background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',
                        borderRadius:'0.3rem',padding:'0.25rem 0.4rem',fontSize:'0.78rem',width:'72px'}}}/>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Heatmap */}
          <div className="card" style={{padding:'0',overflow:'hidden',marginBottom:'0.5rem',position:'relative'}}>
            {!selA && (
              <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',
                alignItems:'center',justifyContent:'center',background:'rgba(6,11,20,0.7)',zIndex:2}}>
                <div style={{fontSize:'2.5rem',marginBottom:'0.5rem',opacity:0.3}}>📡</div>
                <div style={{color:'var(--muted)',fontSize:'0.85rem'}}>Select a run and click Scan</div>
              </div>
            )}
            <canvas ref={canvasRef} width={900} height={420}
              style={{width:'100%',display:'block',minHeight:'280px'}}/>
            {/* Charge key overlay */}
            {Object.keys(charging).length>0 && (
              <div style={{position:'absolute',bottom:'8px',right:'8px',
                display:'flex',gap:'6px',flexWrap:'wrap',justifyContent:'flex-end'}}>
                {[1,2,3,4,5].filter(z=>charging[z]).map(z=>(
                  <div key={z} style={{
                    background:`${CHARGE_COL[z]}22`,border:`1px solid ${CHARGE_COL[z]}55`,
                    borderRadius:'0.3rem',padding:'2px 7px',fontSize:'0.67rem',
                    color:CHARGE_COL[z],fontFamily:'monospace',fontWeight:700,
                  }}>z+{z} · {((charging[z]||0)/Object.values(charging).reduce((a,b)=>a+b,0)*100).toFixed(0)}%</div>
                ))}
              </div>
            )}
          </div>

          {/* TIC */}
          {ticData && (
            <div className="card" style={{padding:'0.4rem',height:'80px'}}>
              <div ref={ticRef} style={{height:'72px'}}/>
            </div>
          )}

          {/* Legend */}
          <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',marginTop:'0.5rem'}}>
            {[
              {col:'#2dd4bf',emoji:'1️⃣',label:'z+1 corridor'},
              {col:'#60a5fa',emoji:'⚡',label:'z+2 corridor'},
              {col:'#22c55e',emoji:'💪',label:'z+3 corridor'},
              {col:'#f97316',emoji:'🚀',label:'z+4 corridor'},
            ].map(({col,emoji,label})=>(
              <div key={label} style={{
                display:'flex',gap:'5px',alignItems:'center',fontSize:'0.7rem',
                color:col,padding:'3px 8px',
                background:`${col}0a`,border:`1px solid ${col}22`,borderRadius:'0.3rem',
              }}><span>{emoji}</span><span>{label}</span></div>
            ))}
            <div style={{fontSize:'0.68rem',color:'#3a5060',alignSelf:'center',paddingLeft:'0.5rem'}}>
              Diagonal lines = predicted charge state positions (invisible on standard MS)
            </div>
          </div>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // COMPARE MODE — side-by-side 2D heatmaps
    // ══════════════════════════════════════════════════════════════════════
    function LandscapeCompare({ selA, setSelA, selB, setSelB, ionsRef, loadIons, ionsLoading, runOpts }) {
      const K0_LO = 0.48, K0_HI = 1.82;
      const W = 130, H = 80;
      const [mzLo, setMzLo] = useState(300);
      const [mzHi, setMzHi] = useState(1500);
      const [rtLo,  setRtLo]  = useState(10);
      const [rtHi,  setRtHi]  = useState(50);
      const [stats, setStats] = useState({A:null,B:null,sim:null});
      const canvasA = useRef(null);
      const canvasB = useRef(null);

      function buildFlat(ions) {
        if (!ions?.mz) return null;
        const mzStep=(mzHi-mzLo)/W, k0Step=(K0_HI-K0_LO)/H;
        const flat=new Float64Array(W*H); let kept=0;
        const rtLoS=rtLo*60, rtHiS=rtHi*60;
        for (let i=0;i<ions.mz.length;i++){
          if(ions.rt[i]<rtLoS||ions.rt[i]>rtHiS)continue;
          if(ions.mz[i]<mzLo||ions.mz[i]>mzHi)continue;
          if(ions.mobility[i]<K0_LO||ions.mobility[i]>K0_HI)continue;
          const xi=Math.min(W-1,Math.floor((ions.mz[i]-mzLo)/mzStep));
          const yi=Math.min(H-1,Math.floor((ions.mobility[i]-K0_LO)/k0Step));
          flat[yi*W+xi]+=ions.log_int[i]; kept++;
        }
        return {flat,kept};
      }

      function pearson(fA, fB) {
        let mA=0,mB=0;
        const n=fA.length;
        for(let i=0;i<n;i++){mA+=fA[i];mB+=fB[i];}
        mA/=n; mB/=n;
        let cov=0,sA2=0,sB2=0;
        for(let i=0;i<n;i++){const a=fA[i]-mA,b=fB[i]-mB;cov+=a*b;sA2+=a*a;sB2+=b*b;}
        return (sA2>0&&sB2>0)?cov/Math.sqrt(sA2*sB2):0;
      }

      async function doCompare() {
        await Promise.all([loadIons('A',selA),loadIons('B',selB)]);
        const rA = buildFlat(ionsRef.current.A);
        const rB = buildFlat(ionsRef.current.B);
        _lsDrawHeatmap(canvasA.current, rA?.flat||null, W, H,
          {mzLo,mzHi,K0_LO,K0_HI,palette:'blue'});
        _lsDrawHeatmap(canvasB.current, rB?.flat||null, W, H,
          {mzLo,mzHi,K0_LO,K0_HI,palette:'red'});
        const sim = (rA?.flat && rB?.flat)
          ? Math.max(0,Math.min(1,pearson(rA.flat,rB.flat)))
          : null;
        setStats({
          A: rA ? rA.kept : null,
          B: rB ? rB.kept : null,
          sim,
        });
      }

      const SimDial = ({sim}) => {
        const pct=Math.round(sim*100);
        const col=pct>90?'#22c55e':pct>70?'#eab308':pct>50?'#f97316':'#ef4444';
        const r=36,cx=48,cy=48;
        const angle=(sim*180-90)*Math.PI/180;
        const nx=cx+r*Math.cos(angle),ny=cy+r*Math.sin(angle);
        const la=sim>0.5?1:0;
        return (
          <svg width="96" height="60">
            <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1e3a5f" strokeWidth="7"/>
            <path d={`M ${cx} ${cx-r} A ${r} ${r} 0 ${la} 1 ${nx} ${ny}`}
              fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"/>
            <text x={cx} y={cx+6} textAnchor="middle" fontSize="15" fontWeight="900" fill={col}>{pct}%</text>
            <text x={cx} y={cx+18} textAnchor="middle" fontSize="8" fill="#475569">similarity</text>
          </svg>
        );
      };

      return (
        <div>
          <div style={{fontSize:'0.79rem',color:'var(--muted)',marginBottom:'0.75rem',lineHeight:1.75,
            background:'rgba(218,170,0,0.04)',border:'1px solid rgba(218,170,0,0.12)',
            borderRadius:'0.5rem',padding:'0.65rem 0.85rem'}}>
            ⚔️ <strong style={{color:'#DAAA00'}}>Compare Runs</strong> — put two timsTOF runs side-by-side
            in the same 4D space. Identical charge corridors and peptide clouds prove your instrument
            is rock-solid. Shifts reveal what changed between conditions.
          </div>

          {/* Selectors */}
          <div className="card" style={{marginBottom:'0.75rem',padding:'0.7rem 1rem'}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:'0.75rem',alignItems:'flex-end'}}>
              <LsRunSelector label="Run A (blue)" color="#58a6ff"
                value={selA} onChange={v=>{setSelA(v);ionsRef.current.A=null;}}
                opts={runOpts} loading={ionsLoading.A}/>
              <LsRunSelector label="Run B (red)" color="#f78166"
                value={selB} onChange={v=>{setSelB(v);ionsRef.current.B=null;}}
                opts={runOpts} loading={ionsLoading.B}/>
              <div>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',marginBottom:'3px'}}>RT range (min)</div>
                <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                  <input type="number" value={rtLo} onChange={e=>setRtLo(+e.target.value)}
                    style={{background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',
                      borderRadius:'0.3rem',padding:'0.25rem 0.4rem',fontSize:'0.78rem',width:'60px'}}/>
                  <span style={{color:'var(--muted)'}}>–</span>
                  <input type="number" value={rtHi} onChange={e=>setRtHi(+e.target.value)}
                    style={{background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',
                      borderRadius:'0.3rem',padding:'0.25rem 0.4rem',fontSize:'0.78rem',width:'60px'}}/>
                </div>
              </div>
              <button onClick={doCompare} disabled={!selA||!selB||ionsLoading.A||ionsLoading.B}
                style={{
                  padding:'0.45rem 1.2rem',borderRadius:'0.4rem',fontWeight:700,
                  cursor:(selA&&selB)?'pointer':'not-allowed',
                  background:(selA&&selB)?'linear-gradient(135deg,rgba(218,170,0,0.2),rgba(218,170,0,0.08))':'transparent',
                  border:`1px solid ${(selA&&selB)?'rgba(218,170,0,0.5)':'var(--border)'}`,
                  color:(selA&&selB)?'#DAAA00':'var(--muted)',
                }}>⚔️ Compare</button>
            </div>
          </div>

          {/* Stats bar */}
          {(stats.A!==null||stats.B!==null) && (
            <div className="card" style={{marginBottom:'0.65rem',padding:'0.6rem 1rem',
              display:'flex',flexWrap:'wrap',gap:'1.5rem',alignItems:'center'}}>
              {[['A','#58a6ff',stats.A],['B','#f78166',stats.B]].map(([k,col,n])=>n!==null&&(
                <div key={k} style={{borderLeft:`3px solid ${col}`,paddingLeft:'8px'}}>
                  <div style={{fontSize:'0.65rem',color:'var(--muted)',textTransform:'uppercase'}}>Run {k}</div>
                  <div style={{fontSize:'0.9rem',fontWeight:700,color:col,fontFamily:'monospace'}}>
                    {n.toLocaleString()} <span style={{fontSize:'0.65rem',fontWeight:400,color:'var(--muted)'}}>ions</span>
                  </div>
                </div>
              ))}
              {stats.sim!==null && (
                <div style={{marginLeft:'auto'}}>
                  <SimDial sim={stats.sim}/>
                  <div style={{fontSize:'0.65rem',color:'var(--muted)',textAlign:'center',marginTop:'2px'}}>
                    {stats.sim>0.9?'✅ Near-identical':stats.sim>0.7?'⚠ Small shift':'❌ Different'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Side-by-side canvases */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem'}}>
            {[['A',canvasA,'#58a6ff','blue'],['B',canvasB,'#f78166','red']].map(([k,ref,col])=>(
              <div key={k}>
                <div style={{fontSize:'0.72rem',color:col,fontWeight:700,marginBottom:'4px',
                  paddingLeft:'4px',borderLeft:`3px solid ${col}`,paddingLeft:'6px'}}>
                  Run {k}
                </div>
                <div style={{position:'relative',borderRadius:'0.45rem',overflow:'hidden',
                  border:`1px solid ${col}22`}}>
                  <canvas ref={ref} width={520} height={300}
                    style={{width:'100%',display:'block'}}/>
                </div>
              </div>
            ))}
          </div>
          {stats.sim!==null && (
            <div style={{fontSize:'0.75rem',color:'var(--muted)',marginTop:'0.5rem',textAlign:'center',lineHeight:1.6}}>
              Charge corridors (⚡💪🚀) should land in exactly the same diagonal positions in both runs —
              that's the power of CCS reproducibility.
            </div>
          )}
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // Main orchestrator
    // ══════════════════════════════════════════════════════════════════════
    function LandscapeViewerTab() {
      const { data: allRuns } = useFetch('/api/runs?limit=300');
      const [mode, setMode]   = useState('story');
      const [selA, setSelA]   = useState('');
      const [selB, setSelB]   = useState('');
      const ionsRef            = useRef({A:null, B:null});
      const [ionsLoading, setIonsLoading] = useState({A:false,B:false});

      useEffect(()=>{ _lsInjectStyles(); },[]);

      const runs   = Array.isArray(allRuns) ? allRuns : [];
      const runOpts = runs.map(r =>
        <option key={r.id} value={r.id}>{r.run_name||r.id} — {r.instrument||''}</option>
      );

      async function loadIons(key, runId) {
        if (!runId) { ionsRef.current[key]=null; return; }
        if (ionsRef.current[key]?._runId===runId) return;
        setIonsLoading(l=>({...l,[key]:true}));
        try {
          const r = await fetch(`/api/runs/${runId}/mobility-3d?max_features=8000`);
          const d = await r.json();
          d._runId = runId;
          ionsRef.current[key] = d;
        } catch(e) { ionsRef.current[key]=null; }
        setIonsLoading(l=>({...l,[key]:false}));
      }

      const shared = {selA,setSelA,selB,setSelB,ionsRef,loadIons,ionsLoading,runOpts};

      const MODES = [
        {k:'story',   lbl:'📖 What is This?', col:'#94a3b8'},
        {k:'scanner', lbl:'📡 Scan My Run',   col:'#58a6ff'},
        {k:'compare', lbl:'⚔️ Compare Runs',  col:'#DAAA00'},
      ];

      return (
        <div style={{padding:'0.5rem'}}>
          {/* Mode tabs */}
          <div style={{display:'flex',gap:'0.4rem',marginBottom:'0.85rem',flexWrap:'wrap',
            borderBottom:'1px solid var(--border)',paddingBottom:'0.5rem'}}>
            {MODES.map(({k,lbl,col})=>(
              <button key={k} onClick={()=>setMode(k)} style={{
                ..._lsBtn(mode===k,col),
                padding:'0.45rem 1.1rem', fontSize:'0.85rem',
                borderRadius:'0.4rem 0.4rem 0 0',
                marginBottom:'-1px',
                borderBottom: mode===k ? `2px solid ${col}` : '1px solid transparent',
              }}>{lbl}</button>
            ))}
            <div style={{marginLeft:'auto',alignSelf:'center',fontSize:'0.7rem',color:'#2a3a4a',
              fontStyle:'italic',paddingBottom:'2px'}}>
              4D Ion Mobility Landscape
            </div>
          </div>

          {mode==='story'   && <LandscapeStory   setMode={setMode} runs={runs} ionsRef={ionsRef}/>}
          {mode==='scanner' && <LandscapeScanner  {...shared}/>}
          {mode==='compare' && <LandscapeCompare  {...shared}/>}
        </div>
      );
    }
