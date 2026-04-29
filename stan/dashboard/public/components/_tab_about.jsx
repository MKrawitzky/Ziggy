    function AboutIMSAdvantage() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);

      React.useEffect(() => {
        const cv = cvRef.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;

        function rr(x, y, w, h, r) {
          ctx.beginPath();
          ctx.moveTo(x+r, y);
          ctx.arcTo(x+w, y, x+w, y+h, r);
          ctx.arcTo(x+w, y+h, x, y+h, r);
          ctx.arcTo(x, y+h, x, y, r);
          ctx.arcTo(x, y, x+w, y, r);
          ctx.closePath();
        }

        function glow(cx, cy, rx, ry, col, alpha) {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
          g.addColorStop(0,   col + 'EE');
          g.addColorStop(0.3, col + '88');
          g.addColorStop(1,   col + '00');
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.scale(1, ry / rx);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy * (rx / ry), rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // 80 particles split between two "peptides"
        const N = 80;
        const pts = Array.from({length: N}, (_, i) => ({
          ion: i % 2,
          r:     5 + Math.random() * 42,
          theta: Math.random() * Math.PI * 2,
          dTheta: (0.4 + Math.random() * 0.6) * (Math.random() < 0.5 ? 1 : -1) * 0.012,
          ecc:   0.3 + Math.random() * 0.5,
          phase: Math.random() * Math.PI * 2,
        }));

        const GOLD = '#DAAA00', VIO = '#d946ef', CYAN = '#22d3ee', RED = '#ef4444', GRN = '#22c55e';

        let t = 0;

        function frame() {
          ctx.clearRect(0, 0, W, H);
          t += 0.018;

          // bg
          ctx.fillStyle = '#06000f';
          ctx.fillRect(0, 0, W, H);

          // ─── LEFT PANEL — no IMS ───────────────────────────────────────────
          const LX = 18, LY = 58, LW = W/2 - 26, LH = H - 82;
          const lCX = LX + LW/2, lCY = LY + LH/2 - 10;

          // border
          ctx.strokeStyle = RED + '55';
          ctx.lineWidth = 1.5;
          rr(LX-4, LY-44, LW+8, LH+58, 8);
          ctx.fillStyle = 'rgba(239,68,68,0.04)';
          ctx.fill();
          ctx.stroke();

          // header
          ctx.fillStyle = RED;
          ctx.font = 'bold 12px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('WITHOUT Ion Mobility', lCX, LY - 25);
          ctx.fillStyle = '#475569';
          ctx.font = '9.5px system-ui, sans-serif';
          ctx.fillText('Orbitrap / Astral  ·  3D: RT × m/z × intensity', lCX, LY - 10);

          // axis labels
          ctx.fillStyle = '#2d3748';
          ctx.font = '9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Retention Time (RT)  →', lCX, LY + LH + 10);
          ctx.save(); ctx.translate(LX + 6, lCY); ctx.rotate(-Math.PI/2);
          ctx.fillText('m/z  →', 0, 0); ctx.restore();

          // two peptides at EXACTLY the same point — they merge into one confused blob
          const pulse = 1 + Math.sin(t * 2.1) * 0.14;
          const jitter = Math.sin(t * 4.3) * 4;
          glow(lCX + jitter*0.3, lCY,          36*pulse, 22*pulse, GOLD, 0.75);
          glow(lCX - jitter*0.3, lCY + jitter, 36*pulse, 22*pulse, VIO,  0.75);

          // particles swarming same center
          pts.forEach(p => {
            p.theta += p.dTheta;
            const px = lCX + Math.cos(p.theta) * p.r;
            const py = lCY + Math.sin(p.theta) * p.r * p.ecc;
            ctx.beginPath();
            ctx.arc(px, py, 1.8, 0, Math.PI*2);
            ctx.fillStyle = (p.ion === 0 ? GOLD : VIO) + 'AA';
            ctx.fill();
          });

          // chimeric warning
          ctx.fillStyle = RED + 'BB';
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('⚠  CHIMERIC SPECTRUM', lCX, lCY - 52);
          ctx.fillStyle = '#4b1818';
          ctx.font = '9px system-ui, sans-serif';
          ctx.fillText('Peptide A and B inseparable', lCX, lCY - 38);

          // result badge
          rr(lCX - 110, LY + LH - 22, 220, 20, 4);
          ctx.fillStyle = 'rgba(239,68,68,0.12)'; ctx.fill();
          ctx.strokeStyle = RED + '66'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = RED;
          ctx.font = 'bold 9.5px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('✗  1 ambiguous ID  ·  PTM missed  ·  protein mis-assigned', lCX, LY + LH - 8);

          // ─── RIGHT PANEL — timsTOF 4D ──────────────────────────────────────
          const RX = W/2 + 8, RY = 58, RW = W/2 - 26, RH = H - 82;
          const rCX = RX + RW/2;

          ctx.strokeStyle = CYAN + '55';
          ctx.lineWidth = 1.5;
          rr(RX-4, RY-44, RW+8, RH+58, 8);
          ctx.fillStyle = 'rgba(34,211,238,0.03)';
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = CYAN;
          ctx.font = 'bold 12px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('WITH TIMS — timsTOF 4D', rCX, RY - 25);
          ctx.fillStyle = '#475569';
          ctx.font = '9.5px system-ui, sans-serif';
          ctx.fillText('m/z × 1/K₀  ·  adding the ion mobility dimension', rCX, RY - 10);

          // axis labels
          ctx.fillStyle = '#2d3748';
          ctx.font = '9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('m/z  →', rCX, RY + RH + 10);
          ctx.save(); ctx.translate(RX + 6, RY + RH/2); ctx.rotate(-Math.PI/2);
          ctx.fillText('1/K₀ (ion mobility)  →', 0, 0); ctx.restore();

          // two peptides now SEPARATED by 1/K₀
          const k0A = 0.987, k0B = 0.954;
          const k0Min = 0.92, k0Max = 1.02;
          const toY = k => RY + RH * (1 - (k - k0Min) / (k0Max - k0Min));
          const yA = toY(k0A), yB = toY(k0B);

          // dashed separation line
          ctx.save();
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = CYAN + '33';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(RX + 14, (yA+yB)/2);
          ctx.lineTo(RX + RW - 6, (yA+yB)/2);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = CYAN + '44';
          ctx.font = '8px system-ui, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText('TIMS separation', RX + RW - 8, (yA+yB)/2 - 3);

          // separated blobs
          const sA = 1 + Math.sin(t*1.4) * 0.04;
          const sB = 1 + Math.sin(t*1.7+1) * 0.04;
          glow(rCX, yA, 28*sA, 10*sA, GOLD, 0.9);
          glow(rCX, yB, 28*sB, 10*sB, VIO,  0.9);

          // peak labels
          ctx.fillStyle = GOLD;
          ctx.font = 'bold 9px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('Peptide A  ·  1/K₀ = 0.987  ·  CCS = 348 Å²', rCX + 32, yA + 4);
          ctx.fillStyle = VIO;
          ctx.fillText('Peptide B  ·  1/K₀ = 0.954  ·  CCS = 335 Å²', rCX + 32, yB + 4);

          // particles orbiting separate targets
          pts.forEach(p => {
            const tY = p.ion === 0 ? yA : yB;
            const px = rCX + Math.cos(p.theta * 0.9) * p.r;
            const py = tY  + Math.sin(p.theta * 0.9) * p.r * 0.25;
            ctx.beginPath();
            ctx.arc(px, py, 1.8, 0, Math.PI*2);
            ctx.fillStyle = (p.ion === 0 ? GOLD : VIO) + 'CC';
            ctx.fill();
          });

          // result badge
          rr(rCX - 110, RY + RH - 22, 220, 20, 4);
          ctx.fillStyle = 'rgba(34,197,94,0.12)'; ctx.fill();
          ctx.strokeStyle = GRN + '66'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = GRN;
          ctx.font = 'bold 9.5px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('✓  2 clean IDs  ·  PTM confirmed  ·  protein correctly assigned', rCX, RY + RH - 8);

          // ─── VS label ─────────────────────────────────────────────────────
          const vsGlow = 0.7 + Math.sin(t * 1.6) * 0.3;
          ctx.globalAlpha = vsGlow;
          ctx.fillStyle = '#a855f7';
          ctx.font = 'bold 17px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('VS', W/2, H/2 + 4);
          ctx.globalAlpha = 1;

          rafRef.current = requestAnimationFrame(frame);
        }

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
      }, []);

      const ROWS = [
        {feature:'Ion Mobility Dimension',    tims:'TIMS (1/K₀ native)',       astral:'None',                  exploris:'FAIMS only *'},
        {feature:'Structural info (CCS)',      tims:'Yes — Å² per peptide',     astral:'No',                    exploris:'No *'},
        {feature:'Isobaric / chimeric sep.',   tims:'Yes — IMS splits overlaps',astral:'Speed-based only',      exploris:'Partial (FAIMS CV)'},
        {feature:'PASEF multiplexing',         tims:'Yes — ~10× DDA boost',     astral:'No (speed instead)',    exploris:'No'},
        {feature:'Single-cell (carrier-free)', tims:'Yes — 1,000–2,000 prot.',  astral:'Emerging / limited',    exploris:'No'},
        {feature:'Proteome depth 1hr HeLa',    tims:'~8,000–10,000 proteins',   astral:'~10,000–12,000 proteins','exploris':'~6,000–8,000 proteins'},
        {feature:'Scan speed (DIA MS2)',       tims:'~100 Hz via diaPASEF',     astral:'~200 Hz (industry-leading)','exploris':'~40 Hz'},
        {feature:'Portable CCS fingerprint',   tims:'Yes (cross-lab, cross-inst.)','astral':'No','exploris':'No'},
        {feature:'Immunopeptidomics z=+1',     tims:'Yes — IMS resolves z=+1',  astral:'Difficult (chimera)',   exploris:'Difficult'},
        {feature:'Raw sensitivity (large amt)',tims:'Excellent',                 astral:'Best-in-class',         exploris:'Very good'},
      ];
      const TH = {color:'var(--muted)',fontSize:'0.75rem',padding:'0.3rem 0.5rem',fontWeight:600,borderBottom:'1px solid var(--border)',textAlign:'left'};
      const TD = {fontSize:'0.76rem',padding:'0.28rem 0.5rem',borderBottom:'1px solid rgba(255,255,255,0.04)',verticalAlign:'top'};

      const winTims    = new Set([0,1,2,3,4,7,8]);
      const winAstral  = new Set([5,6,9]);
      const neutralRow = new Set([]);

      return (
        <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(160deg,rgba(6,0,15,0.97) 0%,rgba(1,15,35,0.9) 100%)',border:'1px solid rgba(168,85,247,0.2)'}}>
          <h3 style={{marginBottom:'0.3rem',background:'linear-gradient(90deg,#22d3ee,#a855f7)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            Why 4D Ion Mobility Changes Everything
          </h3>
          <p style={{color:'var(--muted)',fontSize:'0.82rem',lineHeight:1.65,marginBottom:'0.85rem'}}>
            The scenario below is real: <strong style={{color:'#DAAA00'}}>Peptide A</strong> and{' '}
            <strong style={{color:'#d946ef'}}>Peptide B</strong> share <em>identical m/z and co-elute at the same retention time</em>.
            On an Orbitrap or Astral they produce a single chimeric spectrum — one mis-assigned ID, one missed PTM.
            timsTOF separates them in the 1/K₀ dimension in <strong style={{color:'#22d3ee'}}>milliseconds</strong>.
          </p>
          <canvas ref={cvRef} width={900} height={400}
            style={{width:'100%',borderRadius:'0.5rem',display:'block',marginBottom:'1rem'}} />

          {/* Key callout stats */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.6rem',marginBottom:'1rem'}}>
            {[
              {val:'~33%',label:'of DIA precursors are chimeric without IMS',color:'#ef4444',note:'IMS cuts chimeric co-isolation significantly'},
              {val:'10×',label:'more peptides sampled per unit time via PASEF',color:'#22d3ee',note:'vs traditional DDA at equivalent scan speed'},
              {val:'150 pg',label:'single K562 cell — resolved without carrier',color:'#DAAA00',note:'timsTOF Ultra enables true carrier-free single-cell'},
            ].map(s=>(
              <div key={s.val} style={{background:'rgba(0,0,0,0.4)',border:`1px solid ${s.color}33`,borderRadius:'0.5rem',padding:'0.7rem 0.85rem'}}>
                <div style={{fontSize:'1.6rem',fontWeight:900,color:s.color,lineHeight:1}}>{s.val}</div>
                <div style={{fontSize:'0.75rem',color:'#94a3b8',marginTop:'0.3rem',lineHeight:1.5}}>{s.label}</div>
                <div style={{fontSize:'0.68rem',color:'#4a5568',marginTop:'0.2rem',fontStyle:'italic'}}>{s.note}</div>
              </div>
            ))}
          </div>

          {/* Comparison table */}
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.78rem'}}>
              <thead>
                <tr>
                  <th style={{...TH,width:'28%'}}>Feature</th>
                  <th style={{...TH,color:'#22d3ee'}}>timsTOF Ultra 2  (Bruker)</th>
                  <th style={{...TH,color:'#f97316'}}>Orbitrap Astral  (Thermo)</th>
                  <th style={{...TH,color:'#94a3b8'}}>Exploris 480 + FAIMS  (Thermo)</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, i) => (
                  <tr key={i} style={{background: i%2===0?'rgba(255,255,255,0.01)':'transparent'}}>
                    <td style={{...TD,color:'#94a3b8',fontWeight:600}}>{row.feature}</td>
                    <td style={{...TD,color: winTims.has(i)?'#22d3ee':'#64748b'}}>
                      {winTims.has(i) && <span style={{color:'#22c55e',marginRight:'0.3rem'}}>✓</span>}
                      {row.tims}
                    </td>
                    <td style={{...TD,color: winAstral.has(i)?'#f97316':'#4a5568'}}>
                      {winAstral.has(i) && <span style={{color:'#f97316',marginRight:'0.3rem'}}>★</span>}
                      {row.astral}
                    </td>
                    <td style={{...TD,color:'#374151'}}>{row.exploris}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{marginTop:'0.6rem',fontSize:'0.72rem',color:'#374151',lineHeight:1.7}}>
            <strong style={{color:'#f97316'}}>★ Astral wins on raw speed and depth at high input.</strong>{' '}
            This table is intentionally honest: the Astral is the fastest proteomics instrument available and matches or beats timsTOF on total protein IDs with 200ng+ samples.
            The timsTOF advantage is structural — 1/K₀, CCS, chimera reduction, single-cell depth, and the PASEF multiplexing architecture that no other platform replicates.{' '}
            <strong style={{color:'#94a3b8'}}>* FAIMS</strong> on the Exploris uses a compensation voltage (CV) to filter ions by mobility, but does NOT report 1/K₀ or CCS — it provides selectivity, not structural measurement.
          </div>
        </div>
      );
    }

    function AboutTab() {
      const { data: ver } = useFetch('/api/version');
      const [factIdx, setFactIdx] = React.useState(0);
      const [ziggyClix, setZiggyClix] = React.useState(0);
      const [konamiActive, setKonamiActive] = React.useState(false);
      const konamiSeq = React.useRef([]);
      const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

      const FACTS = [
        "The average tryptic peptide is 8–15 amino acids. Your instrument sees thousands of them per second.",
        "1/K₀, inverse reduced ion mobility, separates things that weigh the same but are shaped differently.",
        "HeLa cells have been dividing in labs since 1951. They will outlast us all.",
        "A timsTOF Pro accumulates ions in ~100ms TIMS steps. That's 10 full 4D scans per second.",
        "Charge state z is the Z in ZIGGY. Every ion carries it. Every ion is it.",
        "The first mass spectrum was recorded in 1912. J.J. Thomson measured neon isotopes.",
        "DIA-NN can identify >10,000 proteins from a single 30-minute gradient. In 2015, that was a year's work.",
        "A CCS value is reproducible across labs, instruments, and time. It is a fingerprint that does not age.",
        "The human proteome has ~20,000 genes. With PTMs and isoforms: probably 1 million+ unique proteoforms.",
        "PASEF stands for Parallel Accumulation Serial Fragmentation. It's why timsTOF sees so much, so fast.",
        "The first peptide sequenced by mass spec was insulin B-chain in 1958. Sixty-six residues. Revolutionary.",
        "Stardust is literally true. The carbon in your peptides was forged in dying stars.",
        "Ion mobility separates in microseconds. Chromatography in minutes. The timsTOF does both simultaneously.",
        "A fragment ion carries the sequence. A charge state carries the story. Together they tell you everything.",
      ];

      React.useEffect(() => {
        console.log('%c\u{1F9AC} ZIGGY \u2014 The Proteomics Rockstar', 'font-size:22px;font-weight:900;color:#a855f7;letter-spacing:0.05em;');
        console.log('%c Hey. You opened dev tools. We respect that energy entirely. \u{1F44B}', 'font-size:13px;color:#60a5fa;');
        console.log('%c The ion endpoint lives at: /api/runs/{id}/mobility-3d', 'font-size:12px;color:#22c55e;font-family:monospace;');
        console.log('%c z = charge state. Z = ZIGGY. Both are real.', 'font-size:12px;color:#DAAA00;font-style:italic;');
        console.log('%c Try the Konami code on this page. \u2191\u2191\u2193\u2193\u2190\u2192\u2190\u2192 B A', 'font-size:11px;color:#f78166;');
        const iv = setInterval(() => setFactIdx(i => (i + 1) % FACTS.length), 5000);
        return () => clearInterval(iv);
      }, []);

      React.useEffect(() => {
        const handler = (e) => {
          konamiSeq.current = [...konamiSeq.current, e.key].slice(-10);
          if (konamiSeq.current.join(',') === KONAMI.join(',')) {
            setKonamiActive(true);
            konamiSeq.current = [];
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, []);

      const handleZiggyClick = () => {
        const n = ziggyClix + 1;
        setZiggyClix(n);
        if (n === 5) alert('\u26A1 Five clicks. The Starman approves.\n\n\u201CZiggy played guitar, jamming good with Weird and Gilly\nAnd the spiders from Mars\u2026\u201D\n\nYou played peptides. Keep going.');
        if (n === 10) alert('\u{1F31F} Ten clicks. You found the ion mobility easter egg.\n\nm/z is where you are.\n1/K\u2080 is who you are.\nRT is when you are.\nIntensity is how much you care.');
        if (n === 42) alert('\u{1F52C} 42 clicks.\n\nThe answer to life, the universe, and proteomics\nis still: run more replicates.');
      };

      return (
        <div>
          {/* Konami overlay */}
          {konamiActive && (
            <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.93)',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'1.5rem'}}
                 onClick={() => setKonamiActive(false)}>
              <div style={{fontSize:'2.8rem',letterSpacing:'0.12em',fontWeight:900,background:'linear-gradient(135deg,#DAAA00,#f78166,#a855f7,#60a5fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',textAlign:'center'}}>
                STARMAN MODE
              </div>
              <div style={{color:'#e2e8f0',fontSize:'1.05rem',textAlign:'center',maxWidth:'500px',lineHeight:1.9,fontStyle:'italic'}}>
                "There's a starman waiting in the sky<br/>
                He'd like to come and meet us<br/>
                But he thinks he'd blow our minds"
              </div>
              <div style={{color:'#a855f7',fontSize:'0.88rem'}}>David Bowie, 1972</div>
              <div style={{color:'#94a3b8',fontSize:'0.85rem',marginTop:'0.5rem',maxWidth:'440px',textAlign:'center',lineHeight:1.75}}>
                You found the Konami code. In proteomics that's the equivalent of finding a +6 charge state
                on a 40 kDa intact protein, theoretically possible, breathtaking in practice.
              </div>
              <div style={{color:'#60a5fa',fontSize:'0.8rem',marginTop:'0.25rem'}}>click anywhere to return to your ions</div>
            </div>
          )}

          {/* Project info */}
          <div className="card" style={{marginBottom:'1rem', background:'linear-gradient(135deg, rgba(2,40,81,0.95) 0%, rgba(31,6,107,0.4) 100%)', border:'1px solid #3b1f8f55'}}>
            <div style={{display:'flex', alignItems:'baseline', gap:'0.75rem', marginBottom:'0.5rem'}}>
              <h2 onClick={handleZiggyClick} title="Try clicking this a few times." style={{fontSize:'1.8rem',fontWeight:900,letterSpacing:'0.05em',background:'linear-gradient(135deg, #DAAA00, #f78166, #a855f7)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',cursor:'pointer',userSelect:'none'}}>ZIGGY</h2>
              <span style={{color:'var(--muted)', fontSize:'0.85rem'}}>The Proteomics Rockstar</span>
              {ver && <span style={{color:'var(--muted)', fontSize:'0.8rem', marginLeft:'auto'}}>v{ver.version}</span>}
            </div>
            <p style={{marginBottom:'0.75rem', lineHeight:1.7}}>
              <strong style={{color:'var(--accent)'}}>ZIGGY</strong> is Michael Krawitzky's 4D ion mobility visualization and analysis platform,
              built on the <strong>STAN</strong> QC engine but reaching far beyond pass/fail metrics
              into novel territory: rotatable ion landscapes, differential ion cloud comparison,
              breathing proteome animation, CCS corridor analysis, and interactive educational tools
              that make ion mobility understood by everyone.
            </p>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', lineHeight:1.6}}>
              Named after Ziggy Stardust. Because proteomics should be as exciting as a Bowie album.
              The <em>Z</em> is not a coincidence: <em>z</em> is charge state. Every ion has it.
            </p>
          </div>

          {/* Rotating facts ticker */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.65rem 1rem',background:'rgba(96,165,250,0.06)',border:'1px solid rgba(96,165,250,0.2)',display:'flex',alignItems:'center',gap:'0.75rem',minHeight:'3rem'}}>
            <span style={{color:'#60a5fa',fontSize:'0.72rem',fontWeight:700,flexShrink:0,letterSpacing:'0.1em'}}>DID YOU KNOW</span>
            <span style={{color:'var(--muted)',fontSize:'0.85rem',lineHeight:1.5,fontStyle:'italic'}}>{FACTS[factIdx]}</span>
          </div>

          {/* Manifesto */}
          <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(160deg,rgba(2,40,81,0.7) 0%,rgba(31,6,107,0.2) 60%,rgba(15,23,42,0.9) 100%)',border:'1px solid rgba(168,85,247,0.25)'}}>
            <h3 style={{marginBottom:'0.85rem',background:'linear-gradient(90deg,#a855f7,#60a5fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>A Letter to the Unsung</h3>
            <div style={{fontSize:'0.9rem',lineHeight:2.05,color:'#cbd5e1'}}>
              <p style={{marginBottom:'1.1rem'}}>
                Some of us didn't choose science.<br/>
                Science chose us, in the quiet of a dark room, watching a spectrum unfold,
                understanding for one electric second that we were measuring the weight of life itself.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                We showed up early and stayed late, not for the salary line, not for the tenure clock,
                but because the gradient was still running and the data didn't care what time it was.
                We named our columns with love. We argued about FDR cutoffs at midnight.
                We celebrated a 4% improvement in precursor IDs like it was a moon landing.
                Because it was.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                This software is for the people who shared their code without being asked.
                Who wrote the README at 11pm after a twelve-hour instrument day.
                Who answered the forum post from a grad student in a country they've never visited.
                Who published the tool, the library, the algorithm, and asked for nothing back
                but a citation they'll never see in their inbox.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                Science is not a job.<br/>
                It is a calling that doesn't pay enough, doesn't sleep enough, and doesn't stop.<br/>
                It is a love language spoken in peptide sequences and charge states and fragmentation patterns
                that only a few hundred humans on earth can read fluently.
              </p>
              <p style={{marginBottom:'0'}}>
                If you are one of those humans:<br/>
                <strong style={{color:'#a855f7'}}>you are not alone. you are seen. this software is yours.</strong>
              </p>
            </div>
          </div>

          {/* Feature highlights */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Feature Highlights</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginTop:'0.5rem'}}>
              {[
                {
                  icon:'📊', title:'QC Dashboard',
                  items:['Precursor, peptide & protein counts @ 1% FDR','Pass / Warn / Fail gating with HOLD flag',
                         'Longitudinal trend charts','Column lifetime & maintenance log',
                         '↺ Fill: back-populate blank metrics from existing report.parquet'],
                },
                {
                  icon:'∿', title:'Mobility Calibration QC',
                  items:['Per-run Δ1/K₀ scatter: observed vs predicted (DIA-NN Predicted.IM)',
                         'Histogram with ±0.025 WARN / ±0.050 ALERT thresholds',
                         'Trend across last 30 timsTOF runs — spot drift before it costs IDs',
                         'Converts Δ1/K₀ → estimated ΔP (mbar) — physics-backed QC',
                         'Based on Müller et al. J. Proteome Res. 2025'],
                },
                {
                  icon:'🔵', title:'Ion Mobility (TIMS / 1/K₀)',
                  items:['4D feature map: m/z × 1/K₀ × RT × intensity','PEAKS-style waterfall (m/z × 1/K₀ × intensity)',
                         'RT × 1/K₀ heatmap with axis ticks','Charge-state filter & m/z / RT sliders',
                         'Immunopeptidomics & peptidomics z=+1 support',
                         '1/K₀ is universal (TIMS/DTIMS/TWIMS); PASEF multiplexing is timsTOF-specific'],
                },
                {
                  icon:'🔬', title:'Spectrum Viewer',
                  items:['Theoretical b/y ion series from DIA-NN Modified.Sequence','UniMod annotation (Oxidation, Phospho, CAM, …)',
                         'Head-to-head mirror comparison across ≤ 3 runs','Peptide search within any DIA-NN report',
                         '★ Jump-to-spectrum from MIA tab with one click'],
                },
                {
                  icon:'🧬', title:'Enzyme & PTM Tab',
                  items:['Missed cleavage distribution (0 / 1 / 2 / 3+)','Modification frequency table per run',
                         'Peptide & unique precursor counts','Pulls live from DIA-NN report.parquet'],
                },
                {
                  icon:'🧫', title:'Histones',
                  items:['Interactive histone PTM Crosstalk Matrix (14 marks, H1–H4)',
                         '4D TIMS Storm: real-time ion cloud animation for histone ions',
                         'Sequence Aligner: H1/H2A/H2B/H3/H4 with modification sites',
                         'SC Network: single-cell PTM co-occurrence (17 marks, 4 populations)',
                         '★ SC Drug Response: Orsburn 2026 mocetinostat HDAC-inhibitor data',
                         'H4 K9+K13+K17 tri-acetylation as top hit (3.82×, p<0.0001)'],
                },
                {
                  icon:'🔭', title:'HLA Discovery',
                  items:['Immunopeptidomics HLA allele discovery workflow',
                         'Novel peptidoform detection from DIA-NN report',
                         'Integrates Cutler/Ctortecka 2025 single-cell HLA data'],
                },
                {
                  icon:'🤖', title:'Search Assistant',
                  items:['DIA-NN for DIA (timsTOF diaPASEF + Orbitrap)','Sage for DDA (timsTOF ddaPASEF + Orbitrap)',
                         'Auto mode-detection from raw metadata','SLURM submission on Hive HPC',
                         'Badge counts unsearched runs in tab header'],
                },
                {
                  icon:'🌐', title:'Community Benchmark',
                  items:['HeLa community leaderboard (Track A DDA + Track B DIA)','Radar fingerprint when both tracks submitted',
                         'No HF token required, relay handles auth','CC BY 4.0 community dataset'],
                },
                {
                  icon:'🔮', title:'Single Cell Proteomics',
                  items:['K562 dilution series: 8pg → 40pg → single-cell → 25ng','Michaelis-Menten coverage model → projects 1-cell depth',
                         'Real 4D ion cloud from any K562 run (live API)','Charge state evolution vs input amount',
                         'K562 surfaceome atlas in m/z × 1/K₀ space'],
                },
                {
                  icon:'⚡', title:'Sneaky Peaky',
                  items:['4D scatter3d: m/z × 1/K₀ × RT differential ion cloud','Joy Division K₀ ridgeline (Unknown Pleasures style)',
                         'CCS conformational density map with charge corridors','MA plot, shift map, dynamic range + charge bars',
                         'm/z target finder across run pairs'],
                },
              ].map(({icon, title, items}) => (
                <div key={title} style={{padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)'}}>
                  <div style={{fontWeight:700, fontSize:'0.95rem', marginBottom:'0.4rem'}}>{icon} {title}</div>
                  <ul style={{color:'var(--muted)', fontSize:'0.8rem', paddingLeft:'1.1rem', lineHeight:1.75, margin:0}}>
                    {items.map(it => <li key={it}>{it}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* What's New */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>What's New · ZIGGY · April 2026</h3>
            <div style={{display:'flex', flexDirection:'column', gap:'0.5rem', marginTop:'0.4rem'}}>
              {[
                {tag:'FIX', color:'#60a5fa', text:'MSFragger primary DDA engine for Bruker timsTOF: Sage 0.14.x crashes (STATUS_STACK_BUFFER_OVERRUN) when reading large .d files via timsrust. ZIGGY now auto-detects MSFragger (FragPipe at C:/Users/Admin/Desktop/Fragpipe/) and uses it as the primary engine for all Bruker DDA searches — reads .d natively via timsdata.dll, no mzML conversion needed. Falls back to Sage if MSFragger is unavailable. TSV output converted to Sage-compatible parquet with TDA q-values in-process.'},
                {tag:'NEW', color:'var(--pass)', text:'🔍 Comparison Search Engine Hub: every acquisition now auto-searches across MSFragger, X!Tandem, Comet, and MaxQuant in parallel — results appear in the Searches tab. Engines auto-skip when not installed (no configuration required).'},
                {tag:'NEW', color:'var(--pass)', text:'🎯 Workflow-aware search params: run names are pattern-matched to presets (hela_digest, phospho, mhc_class_i_dda/dia, mhc_class_ii_dda/dia, tmt, single_cell) — each engine gets the correct enzyme, mods, and peptide length window automatically.'},
                {tag:'NEW', color:'var(--pass)', text:'🤖 MaxQuant integration: full mqpar.xml generation with workflow-aware params (missed cleavages, enzyme, TMT/phospho mods). Auto-discovers MaxQuant at C:/MaxQuant and common install paths.'},
                {tag:'FIX', color:'#60a5fa', text:'MHC-I/II Sage OOM fix: fully non-specific digest (cleave_at: "") against a full proteome generates billions of candidates and crashes with OOM. Fixed in both local.py and community_params.py — now uses semi-enzymatic (cleave_at: "KR", semi_enzymatic: True) which recovers >95% of HLA ligands with ~200× fewer candidates.'},
                {tag:'FIX', color:'#60a5fa', text:'DIA-NN crash fix (WerFault.exe on timsTOF files): community search params were missing --mass-acc / --mass-acc-ms1. DIA-NN auto-optimization mode crashes on certain timsTOF acquisitions. Fixed by adding vendor-specific fixed mass accuracy (timsTOF: 15 ppm MS1+MS2; Orbitrap: 10/20 ppm).'},
                {tag:'FIX', color:'#60a5fa', text:'Search queue: replaced uncoordinated parallel search launches with a semaphore (1 primary DIA-NN/Sage at a time). Searching 5+ files no longer spawns 5 competing DIA-NN instances that saturate all CPU cores and exhaust RAM. Each run queues, starts automatically when the previous one finishes.'},
                {tag:'FIX', color:'#60a5fa', text:'File watcher now starts automatically when ZIGGY launches (FastAPI startup event). Previously the watcher daemon was never started — files dropped into E:/timsTOF were silently ignored.'},
                {tag:'FIX', color:'#60a5fa', text:'DIA run acq_mode crash: server.py was passing acq_mode= to run_diann_local() which has no such parameter — caused all DIA searches to fail with TypeError. Fixed by removing the invalid kwarg.'},
                {tag:'UPD', color:'var(--accent)', text:'qc_only: false in instruments.yml — previously the watcher only picked up HeLa/QC standards. Now all acquisitions (HLA, phospho, TMT, K562, single-cell) are watched and auto-searched.'},
                {tag:'NEW', color:'var(--pass)', text:'⊛ Lab Setup tab: column & LC system catalog with auto-seeded entries for PepSep (Ultra, Advance, Pro), Evosep (Endurance/Performance/Whisper), IonOpticks Aurora, and Thermo PepMap/EasySpray. Tag any run with the column and LC system used — enables cross-column, cross-instrument QC comparisons. Filter Run History by column, LC, or instrument.'},
                {tag:'NEW', color:'var(--pass)', text:'🧬 Phospho tab: full TIMS advantage showcase for phosphoproteomics — Gaussian isomer profiles with Δ1/K₀ annotation & resolution score R, ResolutionGauge (Unresolved/Partial/Baseline zones), IMAdvantagePanel (Oliinyk 2023: 727 phosphoisomer pairs, 58 IM-only, ~5% Δ1/K₀ shift), phospho landscape scatter (gold=2-isomer, magenta=3+). DIA-NN & Sage search results supported.'},
                {tag:'UPD', color:'var(--accent)', text:'⬡ Chimera map (4D Advantage): replaced continuous color scale with 3-category discrete — Clean (green), IM-rescued (gold), Still chimeric (red) — with explicit Δ1/K₀ threshold labels. Makes the IM rescue fraction immediately legible.'},
                {tag:'UPD', color:'var(--accent)', text:'🔽 Run History filters: column, LC system, and instrument dropdowns appear automatically when Lab Setup catalog is populated — filter to exactly "PepSep Ultra 25cm on nanoElute 2 on timsTOF Ultra 2". Column and LC pills shown on each run row.'},
                {tag:'NEW', color:'var(--pass)', text:'∿ Mobility Calibration QC tab: per-run Δ1/K₀ scatter, histogram, 30-run trend — catches barometric pressure drift before it tanks your IDs. Based on Müller et al. J. Proteome Res. 2025 (15 mbar → 0.025 Vs/cm² shift).'},
                {tag:'NEW', color:'var(--pass)', text:'🧫 Histones tab: Crosstalk Matrix (14 marks), 4D TIMS Storm, Sequence Aligner, SC Network (17 marks, 4 populations incl. NaBu-treated from Cutler/Ctortecka 2025), Workflow guide'},
                {tag:'NEW', color:'var(--pass)', text:'★ SC Drug Response panel (Histones): Orsburn 2026 — H4 K9+K13+K17 tri-acetylation as top mocetinostat hit (3.82×, p<0.0001) in single-cell HDAC inhibitor data. Includes non-histone surprise: S100-A9 (1.88×).'},
                {tag:'NEW', color:'var(--pass)', text:'🔭 HLA Discovery tab: immunopeptidomics allele discovery workflow with Cutler/Ctortecka 2025 single-cell HLA integration'},
                {tag:'NEW', color:'var(--pass)', text:'🔍 Search Assistant tab: DIA-NN / Sage search launcher with live unsearched-run badge counter in the tab header'},
                {tag:'UPD', color:'var(--accent)', text:'↺ Fill button in Run History: back-populates null QC fields (MS1/MS2 signal, FWHM, mass accuracy, mobility FWHM, charge fractions) from existing report.parquet — no re-acquisition needed'},
                {tag:'UPD', color:'var(--accent)', text:'★ Spectrum jump from MIA tab: click ★ on any MIA hit to jump directly into the Spectra viewer pre-loaded with that peptide'},
                {tag:'FIX', color:'#60a5fa', text:'Phospho query: fixed Sage path fallback (DIA-NN-only path was checked first), fixed DIA-NN underscore stripping (_PEPTIDE_ → PEPTIDE), fixed frontend silent-fail on API 200+error'},
                {tag:'FIX', color:'#60a5fa', text:'API: fixed sqlite3 connection pattern in recompute-metrics and annotate endpoints; fixed acquisition_mode → mode column in search/unsearched query'},
                {tag:'REM', color:'#f87171', text:'Removed "Today\'s Runs" tab — not relevant outside an instrument PC context. Run History and the QC group cover the same ground with richer context.'},
                {tag:'NEW', color:'var(--pass)', text:'🔮 Single Cell Proteomics tab: real K562 dilution series (8pg–125ng), Michaelis-Menten coverage model, live 4D ion cloud, charge-state evolution, surfaceome atlas in ion mobility space'},
                {tag:'NEW', color:'var(--pass)', text:'⚡ Sneaky Peaky reborn: 4D scatter3d ion cloud, Joy Division K₀ ridgeline, CCS conformational density map, MA plot, shift map, dynamic range — full David Bowie flair'},
                {tag:'ZIGGY', color:'#a855f7', text:'🗻 Landscape Viewer: compare 2–3 runs as Melanie-style rotatable 3D surfaces (m/z × 1/K₀ × intensity); linked cameras, differential A−B surface with Pearson similarity, peak inspector'},
                {tag:'ZIGGY', color:'#a855f7', text:'⬡ 4D Advantage tab: 5 live-data visualizations, Mobility Corridor (per-charge R²), Chimera Probability Map, Breathing Proteome animation, Orthogonality Index, 4D Run Fingerprint'},
                {tag:'UPD', color:'var(--accent)', text:'Super Bowie theme: --bg #0e0018, gold accent #DAAA00, Aladdin Sane lightning bolt favicon'},
              ].map(({tag, color, text}) => (
                <div key={text} style={{display:'flex', gap:'0.6rem', alignItems:'flex-start', fontSize:'0.85rem'}}>
                  <span style={{flexShrink:0, padding:'0.15rem 0.45rem', borderRadius:'0.3rem',
                                background: tag === 'ZIGGY' ? 'rgba(168,85,247,0.15)'
                                          : tag === 'NEW'   ? 'rgba(34,197,94,0.12)'
                                          : tag === 'FIX'   ? 'rgba(96,165,250,0.12)'
                                          : tag === 'REM'   ? 'rgba(248,113,113,0.12)'
                                          : 'rgba(218,170,0,0.12)',
                                color, fontWeight:700, fontSize:'0.75rem', marginTop:'0.05rem'}}>{tag}</span>
                  <span style={{color:'var(--muted)'}}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Authors */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Authors</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginTop:'0.25rem'}}>
              <div style={{padding:'0.75rem', background:'linear-gradient(135deg,rgba(2,40,81,0.8),rgba(31,6,107,0.3))', borderRadius:'0.5rem', border:'1px solid #a855f755'}}>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem'}}>
                  <span style={{fontSize:'1.4rem'}}>⚡</span>
                  <div style={{fontWeight:800, fontSize:'1rem', background:'linear-gradient(135deg, #DAAA00, #a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}
                       title="He measures things smaller than thought. The Peptide Wizard.">Michael Krawitzky</div>
                </div>
                <div style={{color:'var(--muted)', fontSize:'0.82rem', marginBottom:'0.2rem'}}>The Peptide Wizard · Bruker Daltonics</div>
                <div style={{color:'#a855f7', fontSize:'0.8rem', marginBottom:'0.5rem', fontStyle:'italic'}}>Creator of ZIGGY</div>
                <a href="https://github.com/MKrawitzky/ziggy" target="_blank"
                   style={{color:'var(--accent)', fontSize:'0.82rem', textDecoration:'none', display:'block', marginBottom:'0.2rem'}}>
                  github.com/MKrawitzky/ziggy →
                </a>
                <a href="https://github.com/MKrawitzky/Nats" target="_blank"
                   style={{color:'var(--muted)', fontSize:'0.78rem', textDecoration:'none'}}>
                  github.com/MKrawitzky/Nats →
                </a>
              </div>
              <div style={{padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)'}}>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem'}}>
                  <span style={{fontSize:'1.2rem'}}>🔬</span>
                  <div style={{fontWeight:700, fontSize:'1rem'}}
                       title="Stayed up until 3am once fixing a DIA-NN flag. It was a tab character. We've all been there.">Brett Stanley Phinney</div>
                </div>
                <div style={{color:'var(--muted)', fontSize:'0.82rem', marginBottom:'0.2rem'}}>UC Davis Proteomics Core</div>
                <div style={{color:'var(--accent)', fontSize:'0.8rem', marginBottom:'0.5rem', fontStyle:'italic'}}>Creator of STAN (QC engine)</div>
                <a href="https://github.com/bsphinney/stan" target="_blank"
                   style={{color:'var(--muted)', fontSize:'0.82rem', textDecoration:'none'}}>
                  github.com/bsphinney/stan →
                </a>
                <div style={{color:'var(--muted)', fontSize:'0.78rem', marginTop:'0.2rem'}}>bsphinney@ucdavis.edu</div>
              </div>
            </div>
            <div style={{marginTop:'0.75rem',padding:'0.65rem 0.85rem',background:'rgba(168,85,247,0.07)',borderRadius:'0.4rem',border:'1px solid rgba(168,85,247,0.15)',fontSize:'0.82rem',color:'var(--muted)',lineHeight:1.75}}>
              <strong style={{color:'#a855f7'}}>Standing on shoulders:</strong>{' '}
              ZIGGY exists because of the open-source proteomics community, the people who built
              DIA-NN, Sage, timsrust, timsplot, Carafe, MsBackendTimsTof, and thousands of R packages
              and Python wheels without ever asking for anything back but a citation.
              They are the unsung. They are the whole song.
            </div>
          </div>

          {/* License */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>License</h3>
            <div style={{marginBottom:'0.75rem'}}>
              <span style={{fontWeight:600}}>ZIGGY / STAN Academic License</span>
              <span style={{color:'var(--muted)', marginLeft:'0.75rem', fontSize:'0.85rem'}}>
                Copyright &copy; 2024&#8211;2026 Brett Stanley Phinney &amp; The Peptide Wizard
              </span>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', fontSize:'0.85rem'}}>
              <div style={{padding:'0.6rem', background:'rgba(34,197,94,0.08)', borderRadius:'0.4rem', border:'1px solid rgba(34,197,94,0.2)'}}>
                <div style={{color:'var(--pass)', fontWeight:600, marginBottom:'0.3rem'}}>Free to use</div>
                <ul style={{color:'var(--muted)', paddingLeft:'1.1rem', lineHeight:1.7}}>
                  <li>Academic research</li>
                  <li>Non-profit organizations</li>
                  <li>Educational purposes</li>
                  <li>Government-funded research</li>
                  <li>Core facility internal QC</li>
                </ul>
              </div>
              <div style={{padding:'0.6rem', background:'rgba(234,179,8,0.08)', borderRadius:'0.4rem', border:'1px solid rgba(234,179,8,0.2)'}}>
                <div style={{color:'var(--warn)', fontWeight:600, marginBottom:'0.3rem'}}>Commercial use requires a license</div>
                <ul style={{color:'var(--muted)', paddingLeft:'1.1rem', lineHeight:1.7}}>
                  <li>For-profit companies</li>
                  <li>CROs &amp; pharma</li>
                  <li>Fee-for-service work</li>
                  <li>Commercial products</li>
                </ul>
                <div style={{marginTop:'0.4rem', color:'var(--muted)', fontSize:'0.8rem'}}>
                  Contact: <a href="mailto:bsphinney@ucdavis.edu" style={{color:'var(--accent)'}}>bsphinney@ucdavis.edu</a>
                </div>
              </div>
            </div>
            <div style={{marginTop:'0.75rem', color:'var(--muted)', fontSize:'0.8rem'}}>
              Community benchmark data is separately licensed under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" style={{color:'var(--accent)'}}>CC BY 4.0</a>.
              Full license text at{' '}
              <a href="https://github.com/MKrawitzky/ziggy/blob/main/LICENSE" target="_blank" style={{color:'var(--accent)'}}>github.com/MKrawitzky/ziggy</a>.
            </div>
          </div>

          {/* Carafe */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Carafe2: Experiment-Specific Spectral Libraries</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              Carafe2 trains deep-learning models (RT, fragment intensity, ion mobility) directly on
              your DIA data and outputs a DIA-NN-compatible TSV spectral library tuned to your
              instrument and sample prep, improving precursor IDs on future runs.
              Published in <em>Nature Communications</em> 2025.
            </p>
            <div style={{background:'var(--bg)', borderRadius:'0.4rem', padding:'0.6rem 0.9rem', fontFamily:'monospace', fontSize:'0.8rem', marginBottom:'0.75rem', border:'1px solid var(--border)'}}>
              <div style={{color:'var(--muted)', marginBottom:'0.2rem'}}># Download Carafe v2.0.0 (207 MB, requires Java 21+)</div>
              <div style={{color:'var(--accent)'}}>stan carafe --install</div>
              <div style={{color:'var(--muted)', marginTop:'0.4rem', marginBottom:'0.2rem'}}># Build experiment-specific library for a run</div>
              <div style={{color:'var(--accent)'}}>stan carafe --run &lt;RUN_ID&gt; --fasta proteome.fasta</div>
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/Noble-Lab/Carafe" target="_blank"
                 style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                         borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem', fontWeight:600}}>
                GitHub →
              </a>
              <a href="https://github.com/Noble-Lab/Carafe/releases/tag/v2.0.0" target="_blank"
                 style={{color:'var(--accent)', fontSize:'0.85rem', textDecoration:'none'}}>
                Download v2.0.0 →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>Requires Java 21+</span>
            </div>
          </div>

          {/* MsBackendTimsTof */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>MsBackendTimsTof: Raw Spectrum Access (R)</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              A Bioconductor/R backend that reads Bruker TimsTOF <code style={{color:'var(--accent)'}}>.d</code> directories
              directly as <code style={{color:'var(--accent)'}}>Spectra</code> objects, giving access to raw spectra,
              ion mobility dimensions, and peak-level data for deep MS analysis, custom filtering, and export.
            </p>
            <div style={{background:'var(--bg)', borderRadius:'0.4rem', padding:'0.6rem 0.9rem', fontFamily:'monospace', fontSize:'0.8rem', marginBottom:'0.75rem', border:'1px solid var(--border)'}}>
              <div style={{color:'var(--muted)', marginBottom:'0.2rem'}}># Install R dependencies (once)</div>
              <div style={{color:'var(--accent)'}}>stan msbackend --install</div>
              <div style={{color:'var(--muted)', marginTop:'0.4rem', marginBottom:'0.2rem'}}># Generate analysis script pre-filled with your .d paths</div>
              <div style={{color:'var(--accent)'}}>stan msbackend</div>
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/rformassspectrometry/MsBackendTimsTof" target="_blank"
                 style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                         borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem', fontWeight:600}}>
                GitHub →
              </a>
              <a href="https://rformassspectrometry.github.io/MsBackendTimsTof/" target="_blank"
                 style={{color:'var(--accent)', fontSize:'0.85rem', textDecoration:'none'}}>
                Documentation →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>Requires R ≥ 4.1 + Bruker SDK</span>
            </div>
          </div>

          {/* timsplot */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>timsplot: Publication-Ready Proteomics Figures</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              timsplot is an external interactive Shiny web app for proteomics figure generation.
              Load DIA-NN <code style={{color:'var(--accent)'}}>report.parquet</code>, Spectronaut exports,
              Sage results, or FragPipe PSMs to produce publication-ready plots: charge distributions,
              volcano plots, PCA, ion mobility, PTM heatmaps, and more.
            </p>
            <div style={{background:'rgba(234,179,8,0.08)', border:'1px solid rgba(234,179,8,0.25)', borderRadius:'0.4rem',
                         padding:'0.6rem 0.9rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'var(--muted)'}}>
              <strong style={{color:'var(--warn)'}}>External app, requires separate setup.</strong>{' '}
              timsplot needs R ≥ 4.1 + the <code style={{color:'var(--accent)'}}>shiny</code> package.
              On instrument PCs running Bruker ProteoScape, use the R version bundled with ProteoScape
              or install R separately to avoid Python version conflicts.
              Once running it serves on <code style={{color:'var(--accent)'}}>localhost:8422</code>.
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/zack-kirsch/timsplot" target="_blank"
                 style={{padding:'0.5rem 1.1rem', background:'var(--accent)', color:'var(--bg)',
                         borderRadius:'0.4rem', fontWeight:700, textDecoration:'none', fontSize:'0.9rem'}}>
                timsplot on GitHub →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>
                Install: <code style={{color:'var(--accent)'}}>Rscript -e "shiny::runGitHub('timsplot','zack-kirsch')"</code>
              </span>
            </div>
          </div>

          {/* Links */}
          {/* 4 Dimensions explainer */}
          <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(135deg,rgba(1,26,58,0.8),rgba(2,40,81,0.6))'}}>
            <h3 style={{marginBottom:'0.6rem',color:'#60a5fa'}}>The 4 Dimensions of timsTOF Data</h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:'0.6rem',marginBottom:'0.75rem'}}>
              {[
                {dim:'1',name:'Retention Time',unit:'minutes',icon:'⏱',color:'#94a3b8',
                  desc:'When the peptide elutes from the LC column. Every LC-MS instrument has this.',
                  orbi:true, tims:true},
                {dim:'2',name:'m/z',unit:'Th (Thomson)',icon:'⚖',color:'#94a3b8',
                  desc:'Mass-to-charge ratio. Identifies the peptide by mass. Every LC-MS instrument has this.',
                  orbi:true, tims:true},
                {dim:'3',name:'Intensity',unit:'counts / a.u.',icon:'📶',color:'#94a3b8',
                  desc:'Signal strength. Proportional to peptide abundance. Every LC-MS instrument has this.',
                  orbi:true, tims:true},
                {dim:'4',name:'Ion Mobility (1/K₀)',unit:'Vs/cm²',icon:'🌀',color:'#60a5fa',
                  desc:'How fast an ion drifts through a gas under an electric field — determined by its 3D shape and charge. Measured by TIMS (Bruker), DTIMS (Agilent), and TWIMS (Waters). PASEF multiplexing is timsTOF-specific.',
                  orbi:false, tims:true},
              ].map(d=>(
                <div key={d.dim} style={{background:d.tims&&!d.orbi?'rgba(96,165,250,0.08)':'rgba(255,255,255,0.02)',
                  border:`1px solid ${d.tims&&!d.orbi?'rgba(96,165,250,0.3)':'rgba(255,255,255,0.06)'}`,
                  borderRadius:'0.5rem',padding:'0.7rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.3rem'}}>
                    <span style={{fontSize:'1.4rem'}}>{d.icon}</span>
                    <span style={{fontSize:'0.62rem',fontWeight:700,padding:'0.1rem 0.35rem',borderRadius:'0.25rem',
                      background:d.tims&&!d.orbi?'rgba(96,165,250,0.2)':'rgba(255,255,255,0.05)',
                      color:d.tims&&!d.orbi?'#60a5fa':'#475569'}}>
                      {d.tims&&!d.orbi?'IMS platforms':'All platforms'}
                    </span>
                  </div>
                  <div style={{fontSize:'0.85rem',fontWeight:700,color:d.tims&&!d.orbi?'#60a5fa':'#94a3b8',marginBottom:'0.2rem'}}>
                    Dim {d.dim}: {d.name}
                  </div>
                  <div style={{fontSize:'0.68rem',color:'#4a6070',marginBottom:'0.3rem'}}>{d.unit}</div>
                  <div style={{fontSize:'0.72rem',color:'#64748b',lineHeight:1.5}}>{d.desc}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:'0.78rem',color:'#4a6070',lineHeight:1.7,borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:'0.6rem'}}>
              <strong style={{color:'#60a5fa'}}>Why does the 4th dimension matter?</strong> Ion mobility separates
              co-eluting, isobaric peptides that are identical in RT and m/z but differ in 3D shape.
              It also enables PASEF multiplexing on timsTOF — the instrument fragments multiple co-isolated
              precursors in a single TIMS scan cycle, boosting sensitivity and speed by ~10× vs traditional DDA.
              The 1/K₀ value converts to a calibration-independent CCS (Å²) reproducible across labs — a molecular fingerprint.
            </div>
            <div style={{marginTop:'0.6rem',fontSize:'0.74rem',lineHeight:1.75,background:'rgba(96,165,250,0.05)',border:'1px solid rgba(96,165,250,0.12)',borderRadius:'0.4rem',padding:'0.55rem 0.8rem'}}>
              <strong style={{color:'#60a5fa'}}>Is 1/K₀ unique to TIMS?</strong> No.{' '}
              1/K₀ (inverse reduced mobility, V·s/cm²) is a <em>universal</em> physical quantity measured by all ion mobility technologies.
              What differs is the hardware implementation:
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.4rem',marginTop:'0.45rem'}}>
                {[
                  {vendor:'Bruker timsTOF',tech:'TIMS',note:'Ions trapped by opposing electric field; eluted by ramping voltage. Reports 1/K₀ natively. PASEF multiplexing is unique to TIMS.', color:'#60a5fa'},
                  {vendor:'Agilent 6560',tech:'DTIMS (Drift Tube)',note:'Ions drift under a uniform field through a tube of inert gas. Gold standard for absolute CCS — 1/K₀ measured directly, no calibration needed.', color:'#22d3ee'},
                  {vendor:'Waters SYNAPT / VION',tech:'TWIMS (Travelling Wave)',note:'Ions propelled by a travelling voltage wave. Requires calibration standards to convert to 1/K₀ or CCS, but fully compatible with the same unit.', color:'#a855f7'},
                ].map(r=>(
                  <div key={r.vendor} style={{background:'rgba(0,0,0,0.25)',borderRadius:'0.3rem',padding:'0.4rem 0.55rem',border:`1px solid ${r.color}22`}}>
                    <div style={{color:r.color,fontWeight:700,fontSize:'0.72rem',marginBottom:'0.15rem'}}>{r.vendor}</div>
                    <div style={{color:'#475569',fontSize:'0.68rem',marginBottom:'0.2rem',fontStyle:'italic'}}>{r.tech}</div>
                    <div style={{color:'#4a5568',fontSize:'0.67rem',lineHeight:1.5}}>{r.note}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:'0.45rem',color:'#374151'}}>
                <strong style={{color:'#60a5fa'}}>What IS timsTOF-specific:</strong> The TIMS trapping mechanism, PASEF/diaPASEF multiplexing, and the real-time 4D feature extraction at ~10 TIMS scans/sec. The <em>unit</em> (1/K₀) is shared across all three vendors — meaning CCS values are portable.
              </div>
            </div>
          </div>

          <AboutIMSAdvantage />

          <div className="card">
            <h3>Resources</h3>
            <div style={{display:'flex', flexWrap:'wrap', gap:'0.5rem', marginTop:'0.25rem'}}>
              {[
                ['GitHub (ZIGGY)', 'https://github.com/MKrawitzky/ziggy'],
                ['Community Dashboard', 'https://community.stan-proteomics.org'],
                ['HF Dataset', 'https://huggingface.co/datasets/brettsp/stan-benchmark'],
                ['timsplot', 'https://github.com/zack-kirsch/timsplot'],
                ['MsBackendTimsTof', 'https://github.com/rformassspectrometry/MsBackendTimsTof'],
                ['Carafe2', 'https://github.com/Noble-Lab/Carafe'],
                ['API Docs', '/docs'],
                ['4D Landscape Viewer', '/static/landscape_viewer.html'],
                ['Ion Mobility Explainer', '/static/ion_mobility_explainer.html'],
                ['Beyond IDs', '/static/beyond_ids.html'],
              ].map(([label, href]) => (
                <a key={label} href={href} target={href.startsWith('http') ? '_blank' : '_self'}
                   style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                           borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem',
                           fontWeight:600}}>
                  {label} →
                </a>
              ))}
            </div>
          </div>
        </div>
      );
    }

