    function WelcomeTab({ navigateTo }) {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);
      const { data: runs } = useFetch('/api/runs');
      const { data: ver }  = useFetch('/api/version');
      const [factIdx, setFactIdx] = React.useState(() => Math.floor(Math.random() * GLOBAL_FACTS.length));
      const [titleGlow, setTitleGlow] = React.useState(0);

      // Rotate facts
      React.useEffect(() => {
        const iv = setInterval(() => setFactIdx(i => (i + 1) % GLOBAL_FACTS.length), 6000);
        return () => clearInterval(iv);
      }, []);

      // Title pulse
      React.useEffect(() => {
        let t = 0;
        const iv = setInterval(() => { t += 0.05; setTitleGlow(Math.sin(t) * 0.5 + 0.5); }, 50);
        return () => clearInterval(iv);
      }, []);

      // Derived stats
      const runList    = Array.isArray(runs) ? runs : [];
      const totalRuns  = runList.length;
      const now        = Date.now();
      const weekMs     = 7 * 24 * 3600 * 1000;
      const recentRuns = runList.filter(r => r.acquired_at && (now - new Date(r.acquired_at).getTime() < weekMs)).length;
      const withData   = runList.filter(r => r.result_path).length;
      const lastRun    = runList.length ? runList[0] : null;

      // ── Canvas: 4D Ziggy Stardust animation ─────────────────────────────
      React.useEffect(() => {
        const cv = cvRef.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.offsetWidth || 900;
        const H = 280;
        cv.width  = W;
        cv.height = H;

        const GOLD = '#DAAA00', VIO = '#d946ef', CYAN = '#22d3ee', PUR = '#a855f7';
        const RED  = '#f97316';
        const COLORS = [GOLD, VIO, CYAN, PUR, RED, '#22c55e'];

        // ── Aladdin Sane bolt (centred, large) ──
        // Points defined as fractions of a bounding box, then scaled/translated
        // The classic Ziggy/Aladdin Sane bolt: two diagonal stripes
        function drawBolt(cx, cy, size, alpha, hue) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(cx, cy);
          // Outer fill  (colour shifts with hue 0-1: gold → red → violet)
          const r = Math.round(218 + (hue < 0.5 ? (249-218)*(hue*2) : (217-249)*((hue-0.5)*2)));
          const g = Math.round(170 + (hue < 0.5 ? (115-170)*(hue*2) : (70-115)*((hue-0.5)*2)));
          const b = Math.round(0   + (hue < 0.5 ? (22-0)*(hue*2)    : (239-22)*((hue-0.5)*2)));
          const col = `rgb(${r},${g},${b})`;
          // bolt outline (filled solid)
          ctx.shadowColor = col;
          ctx.shadowBlur  = size * 0.5;
          ctx.fillStyle   = col;
          ctx.beginPath();
          // top-left → top notch → mid notch → tip, then back
          ctx.moveTo(-size*0.18, -size*0.5);   // top-left
          ctx.lineTo( size*0.14, -size*0.5);   // top-right
          ctx.lineTo( size*0.05, -size*0.02);  // inner mid-right
          ctx.lineTo( size*0.22,  size*0.0);   // spike out right
          ctx.lineTo(-size*0.05,  size*0.5);   // bottom tip
          ctx.lineTo(-size*0.22,  size*0.5);   // bottom-left
          ctx.lineTo(-size*0.10,  size*0.04);  // inner mid-left
          ctx.lineTo(-size*0.28,  size*0.0);   // spike out left
          ctx.closePath();
          ctx.fill();
          // inner highlight (white core)
          ctx.globalAlpha = alpha * 0.35;
          ctx.fillStyle = '#fff';
          ctx.shadowBlur = size * 0.2;
          ctx.beginPath();
          ctx.moveTo(-size*0.08, -size*0.38);
          ctx.lineTo( size*0.06, -size*0.38);
          ctx.lineTo( size*0.01,  size*0.02);
          ctx.lineTo(-size*0.01,  size*0.02);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // ── Stardust particles ───────────────────────────────────────────
        const NSTARS = 140;
        const stars = Array.from({ length: NSTARS }, () => ({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 0.4 + Math.random() * 2.0,
          col: COLORS[Math.floor(Math.random() * COLORS.length)],
          alpha: 0.2 + Math.random() * 0.7,
          phase: Math.random() * Math.PI * 2,
          speed: 0.008 + Math.random() * 0.025,
          vx: (Math.random() - 0.5) * 0.35,
          vy: -0.1 - Math.random() * 0.3,  // drift upward = falling stardust
          trail: [],
        }));

        // ── Comets ────────────────────────────────────────────────────────
        function makeComet() {
          return {
            x: Math.random() * W,
            y: -10,
            angle: Math.PI / 4 + (Math.random() - 0.5) * 0.4,
            speed: 3 + Math.random() * 5,
            len: 60 + Math.random() * 80,
            col: COLORS[Math.floor(Math.random() * COLORS.length)],
            life: 1.0,
          };
        }
        const comets = [];
        let cometTimer = 0;

        // ── 4D hypercube (tesseract) projected to 2D ─────────────────────
        // 16 vertices of a 4D unit cube: (±1, ±1, ±1, ±1)
        const VERTS4 = [];
        for (let a = -1; a <= 1; a += 2)
          for (let b = -1; b <= 1; b += 2)
            for (let c = -1; c <= 1; c += 2)
              for (let d = -1; d <= 1; d += 2)
                VERTS4.push([a, b, c, d]);

        // Edges: connect vertices that differ in exactly one coordinate
        const EDGES = [];
        for (let i = 0; i < 16; i++)
          for (let j = i + 1; j < 16; j++) {
            let diff = 0;
            for (let k = 0; k < 4; k++) if (VERTS4[i][k] !== VERTS4[j][k]) diff++;
            if (diff === 1) EDGES.push([i, j]);
          }

        function project4Dto2D(v, rotXY, rotZW, rotXZ, fov4, fov3, scale, cx, cy) {
          // Rotate in XY plane
          let x = v[0] * Math.cos(rotXY) - v[1] * Math.sin(rotXY);
          let y = v[0] * Math.sin(rotXY) + v[1] * Math.cos(rotXY);
          let z = v[2] * Math.cos(rotZW) - v[3] * Math.sin(rotZW);
          let w = v[2] * Math.sin(rotZW) + v[3] * Math.cos(rotZW);
          // XZ
          let x2 = x * Math.cos(rotXZ) - z * Math.sin(rotXZ);
          let z2 = x * Math.sin(rotXZ) + z * Math.cos(rotXZ);
          x = x2; z = z2;
          // 4D → 3D perspective (project away W)
          const w4 = fov4 / (fov4 - w);
          const px3 = x * w4, py3 = y * w4, pz3 = z * w4;
          // 3D → 2D perspective (project away Z)
          const z3 = fov3 / (fov3 - pz3);
          return [cx + px3 * z3 * scale, cy + py3 * z3 * scale, w]; // carry w for colouring
        }

        // ── PASEF scan ────────────────────────────────────────────────────
        let scanX = -60, scanActive = false, scanTimer = 0;

        let t = 0;

        function frame() {
          ctx.clearRect(0, 0, W, H);
          t += 0.013;

          // Deep space background
          const bg = ctx.createLinearGradient(0, 0, W, H);
          bg.addColorStop(0,   '#080015');
          bg.addColorStop(0.5, '#04000c');
          bg.addColorStop(1,   '#06001a');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, W, H);

          // Nebula halos
          [
            { x: W*0.12, y: H*0.5, r: 180, col: '#a855f7', a: 0.08 + Math.sin(t*0.6)*0.03 },
            { x: W*0.75, y: H*0.4, r: 150, col: '#22d3ee', a: 0.07 + Math.sin(t*0.8+1)*0.025 },
            { x: W*0.42, y: H*0.65, r: 140, col: '#DAAA00', a: 0.055 + Math.sin(t*1.0+2)*0.022 },
            { x: W*0.6,  y: H*0.25, r: 100, col: '#d946ef', a: 0.045 + Math.sin(t*1.2+3)*0.02 },
          ].forEach(g => {
            const gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
            gr.addColorStop(0, g.col + 'BB');
            gr.addColorStop(1, g.col + '00');
            ctx.save(); ctx.globalAlpha = g.a;
            ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI*2); ctx.fill();
            ctx.restore();
          });

          // 4D Tesseract (background layer)
          const cx4 = W * 0.5, cy4 = H * 0.5;
          const rotXY = t * 0.22, rotZW = t * 0.17, rotXZ = t * 0.11;
          const pts = VERTS4.map(v => project4Dto2D(v, rotXY, rotZW, rotXZ, 3.0, 4.0, 38, cx4, cy4));
          ctx.save();
          ctx.globalAlpha = 0.12;
          EDGES.forEach(([i, j]) => {
            const p1 = pts[i], p2 = pts[j];
            const wAvg = (p1[2] + p2[2]) / 2; // -1..1
            const hue = (wAvg + 1) / 2;
            const r = Math.round(34  + hue * (217-34));
            const g2 = Math.round(211 + hue * (70-211));
            const b = Math.round(238 + hue * (239-238));
            ctx.strokeStyle = `rgb(${r},${g2},${b})`;
            ctx.lineWidth = 0.8;
            ctx.shadowColor = `rgb(${r},${g2},${b})`;
            ctx.shadowBlur = 4;
            ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
          });
          // Vertices
          pts.forEach(p => {
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = '#22d3ee';
            ctx.beginPath(); ctx.arc(p[0], p[1], 1.2, 0, Math.PI*2); ctx.fill();
          });
          ctx.restore();

          // PASEF scan sweep
          scanTimer++;
          if (scanTimer > 200) { scanActive = true; scanX = -80; scanTimer = 0; }
          if (scanActive) {
            scanX += 3.0;
            const sa = 0.35 * Math.max(0, 1 - scanX / (W + 80));
            ctx.save();
            const sg = ctx.createLinearGradient(scanX - 70, 0, scanX + 15, 0);
            sg.addColorStop(0,   '#22d3ee00');
            sg.addColorStop(0.6, '#22d3ee' + Math.floor(sa * 255).toString(16).padStart(2,'0'));
            sg.addColorStop(1,   '#22d3ee00');
            ctx.fillStyle = sg; ctx.fillRect(scanX - 70, 0, 85, H);
            ctx.restore();
            if (scanX > W + 80) scanActive = false;
          }

          // Stardust
          stars.forEach(p => {
            p.x += p.vx + Math.sin(t * 0.25 + p.phase) * 0.1;
            p.y += p.vy;
            if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
            if (p.x < -5) p.x = W + 5;
            if (p.x > W + 5) p.x = -5;

            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > 8) p.trail.shift();

            // trail
            if (p.trail.length > 1) {
              ctx.beginPath();
              ctx.moveTo(p.trail[0].x, p.trail[0].y);
              for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
              ctx.strokeStyle = p.col + '33';
              ctx.lineWidth = p.r * 0.5;
              ctx.stroke();
            }
            // twinkling dot
            const tw = 0.5 + 0.5 * Math.sin(t * 2.2 * p.speed * 60 + p.phase);
            ctx.save();
            ctx.globalAlpha = p.alpha * (0.5 + tw * 0.5);
            ctx.shadowColor = p.col; ctx.shadowBlur = p.r * 4;
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.8 + tw * 0.4), 0, Math.PI*2); ctx.fill();
            ctx.restore();
          });

          // Comets
          cometTimer++;
          if (cometTimer > 220 + Math.random() * 200) { comets.push(makeComet()); cometTimer = 0; }
          for (let ci = comets.length - 1; ci >= 0; ci--) {
            const c = comets[ci];
            const dx = Math.cos(c.angle) * c.speed;
            const dy = Math.sin(c.angle) * c.speed;
            c.x += dx; c.y += dy; c.life -= 0.012;
            if (c.life <= 0 || c.x > W + 20 || c.y > H + 20) { comets.splice(ci, 1); continue; }
            ctx.save();
            ctx.globalAlpha = c.life * 0.8;
            const cg = ctx.createLinearGradient(c.x, c.y, c.x - dx * c.len / c.speed, c.y - dy * c.len / c.speed);
            cg.addColorStop(0, c.col + 'FF');
            cg.addColorStop(0.3, c.col + '88');
            cg.addColorStop(1, c.col + '00');
            ctx.strokeStyle = cg; ctx.lineWidth = 1.5;
            ctx.shadowColor = c.col; ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(c.x - dx * c.len / c.speed, c.y - dy * c.len / c.speed);
            ctx.stroke();
            ctx.restore();
          }

          // ── Aladdin Sane bolt — large, centred, pulsing ───────────────
          const boltH   = t * 0.4;               // hue cycle
          const boltHue = (boltH % 1 + 1) % 1;
          const boltPulse = 0.55 + 0.2 * Math.sin(t * 1.8);
          const boltSize  = H * 0.78 * (0.95 + 0.05 * Math.sin(t * 2.3));
          drawBolt(W * 0.5, H * 0.5, boltSize, boltPulse * 0.65, boltHue);

          // outer ring / corona around bolt
          ctx.save();
          ctx.globalAlpha = 0.06 + 0.04 * Math.sin(t * 1.5);
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = 1.5;
          ctx.shadowColor = GOLD; ctx.shadowBlur = 30;
          ctx.beginPath();
          ctx.ellipse(W * 0.5, H * 0.5, boltSize * 0.22, boltSize * 0.52, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          // subtle m/z labels drifting near bottom
          if (Math.floor(t * 10) % 35 === 0) {
            const lx = Math.random() * W * 0.9 + W * 0.05;
            const ly = H * 0.7 + Math.random() * H * 0.22;
            ctx.save();
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = CYAN;
            ctx.font = '8px monospace';
            ctx.fillText((400 + Math.random() * 800).toFixed(3), lx, ly);
            ctx.restore();
          }

          rafRef.current = requestAnimationFrame(frame);
        }

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
      }, []);

      // ── Quick-nav section data ───────────────────────────────────────────
      const NAV = [
        { tab:'history',    icon:'📋', label:'Run History',        desc:'Browse all runs, pin, annotate',      col:'#22c55e',  bg:'rgba(34,197,94,0.08)',  border:'rgba(34,197,94,0.3)' },
        { tab:'mobility',   icon:'🌀', label:'Ion Mobility',       desc:'4D feature map · m/z × 1/K₀ × RT',   col:'#22d3ee',  bg:'rgba(34,211,238,0.08)', border:'rgba(34,211,238,0.3)' },
        { tab:'landscape',  icon:'🗻', label:'Landscape Viewer',   desc:'Rotatable 3D ion surfaces across runs',col:'#60a5fa', bg:'rgba(96,165,250,0.08)', border:'rgba(96,165,250,0.3)' },
        { tab:'immuno',     icon:'🧬', label:'Immunopeptidomics',  desc:'HLA peptide QC · DIA-NN or Sage',     col:'#d946ef',  bg:'rgba(217,70,239,0.08)', border:'rgba(217,70,239,0.3)' },
        { tab:'discovery',  icon:'🔭', label:'HLA Discovery',      desc:'Atlas novelty · volcano · motifs',     col:'#f472b6', bg:'rgba(244,114,182,0.08)',border:'rgba(244,114,182,0.3)' },
        { tab:'search',     icon:'🤖', label:'Search Assistant',   desc:'DIA-NN + Sage launcher · SLURM',       col:'#DAAA00', bg:'rgba(218,170,0,0.08)',  border:'rgba(218,170,0,0.3)' },
        { tab:'sneaky',     icon:'⚡', label:'Sneaky Peaky',       desc:'Differential 4D ion cloud · Joy Division', col:'#f97316', bg:'rgba(249,115,22,0.08)', border:'rgba(249,115,22,0.3)' },
        { tab:'singlecell', icon:'🔮', label:'Single Cell',        desc:'K562 dilution series · CCS atlas',     col:'#a855f7', bg:'rgba(168,85,247,0.08)', border:'rgba(168,85,247,0.3)' },
        { tab:'histone',    icon:'🧫', label:'Histones',           desc:'PTM crosstalk · 4D TIMS Storm',        col:'#f87171', bg:'rgba(248,113,113,0.08)',border:'rgba(248,113,113,0.3)' },
      ];

      const titleShadow = `0 0 ${20 + titleGlow * 30}px rgba(218,170,0,${0.3 + titleGlow * 0.4}), 0 0 ${40 + titleGlow * 60}px rgba(168,85,247,${0.2 + titleGlow * 0.3})`;

      return (
        <div style={{ padding: '0 0 2rem 0' }}>

          {/* ── Hero Canvas ────────────────────────────────────────────── */}
          <div style={{ position: 'relative', marginBottom: '0' }}>
            <canvas ref={cvRef}
              style={{ width: '100%', height: '280px', display: 'block', borderRadius: '0' }} />
            {/* Overlaid title */}
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              pointerEvents: 'none',
            }}>
              <div style={{
                fontSize: 'clamp(3rem, 8vw, 5.5rem)',
                fontWeight: 900,
                letterSpacing: '0.12em',
                lineHeight: 1,
                background: 'linear-gradient(135deg, #DAAA00 0%, #f78166 30%, #d946ef 60%, #22d3ee 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: `drop-shadow(0 0 ${8 + titleGlow * 16}px rgba(218,170,0,0.6))`,
                userSelect: 'none',
              }}>ZIGGY</div>
              <div style={{
                fontSize: 'clamp(0.75rem, 2vw, 0.95rem)',
                color: '#94a3b8',
                letterSpacing: '0.25em',
                textTransform: 'uppercase',
                fontWeight: 600,
                textShadow: '0 0 12px rgba(34,211,238,0.5)',
              }}>The Proteomics Rockstar &nbsp;·&nbsp; 4D Ion Mobility Dashboard</div>
              {ver && (
                <div style={{ fontSize: '0.72rem', color: '#4a5568', letterSpacing: '0.1em', marginTop: '0.2rem' }}>
                  v{ver.version}
                </div>
              )}
            </div>
          </div>

          {/* ── Live Stats Bar ─────────────────────────────────────────── */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '1px', background: 'rgba(218,170,0,0.15)',
            borderTop: '1px solid rgba(218,170,0,0.25)',
            borderBottom: '1px solid rgba(168,85,247,0.2)',
            marginBottom: '1.5rem',
          }}>
            {[
              { val: totalRuns,  label: 'Total Runs',        col: '#22d3ee' },
              { val: recentRuns, label: 'Runs This Week',    col: '#DAAA00' },
              { val: withData,   label: 'Runs with Results', col: '#22c55e' },
              { val: lastRun ? (lastRun.run_name || '—').slice(0, 22) : '—',
                label: 'Last Acquired', col: '#d946ef' },
            ].map(s => (
              <div key={s.label} style={{
                padding: '0.85rem 1rem', background: 'rgba(14,0,24,0.9)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
                <div style={{
                  fontSize: typeof s.val === 'number' ? '2rem' : '0.95rem',
                  fontWeight: 900, color: s.col,
                  lineHeight: 1, marginBottom: '0.25rem',
                  textShadow: `0 0 12px ${s.col}88`,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}>{s.val}</div>
                <div style={{ fontSize: '0.7rem', color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* ── Quick Nav Grid ─────────────────────────────────────────── */}
          <div style={{ padding: '0 1rem' }}>
            <div style={{
              fontSize: '0.65rem', color: '#3d1060', letterSpacing: '0.18em',
              textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.75rem',
            }}>Quick Navigation</div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '0.65rem',
              marginBottom: '1.5rem',
            }}>
              {NAV.map(n => (
                <div key={n.tab}
                  onClick={() => navigateTo && navigateTo(n.tab)}
                  style={{
                    background: n.bg,
                    border: `1px solid ${n.border}`,
                    borderRadius: '0.6rem',
                    padding: '0.9rem 1rem',
                    cursor: 'pointer',
                    transition: 'transform 0.12s, box-shadow 0.12s',
                    boxShadow: `0 0 0px ${n.col}00`,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = `0 4px 24px ${n.col}44`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = `0 0 0px ${n.col}00`;
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '1.3rem' }}>{n.icon}</span>
                    <span style={{
                      fontWeight: 700, fontSize: '0.9rem', color: n.col,
                      textShadow: `0 0 8px ${n.col}66`,
                    }}>{n.label}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>{n.desc}</div>
                </div>
              ))}
            </div>

            {/* ── Feature Pillars ─────────────────────────────────────── */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{
                fontSize: '0.65rem', color: '#3d1060', letterSpacing: '0.18em',
                textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.75rem',
              }}>What ZIGGY Does</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                {[
                  {
                    title: '4D Ion Mobility',
                    col: '#22d3ee',
                    icon: '🌀',
                    lines: [
                      'm/z × 1/K₀ × RT × Intensity',
                      'CCS corridor analysis',
                      'Chimera probability maps',
                      'Breathing proteome animation',
                      'Rotatable 3D landscape viewer',
                    ],
                  },
                  {
                    title: 'Immunopeptidomics',
                    col: '#d946ef',
                    icon: '🧬',
                    lines: [
                      'HLA-I & HLA-II pep length filter',
                      'GRAVY hydrophobicity cloud',
                      'Binding motif matrix (9-mer)',
                      'DIA-NN or Sage as input',
                      'HLA atlas novelty discovery',
                    ],
                  },
                  {
                    title: 'QC & Search',
                    col: '#DAAA00',
                    icon: '🤖',
                    lines: [
                      'Pass / Warn / Fail gating',
                      'Longitudinal trend charts',
                      'Mobility calibration QC',
                      'DIA-NN + Sage auto-routing',
                      'SLURM HPC submission',
                    ],
                  },
                ].map(p => (
                  <div key={p.title} style={{
                    background: 'rgba(0,0,0,0.4)',
                    border: `1px solid ${p.col}33`,
                    borderRadius: '0.6rem',
                    padding: '0.85rem 1rem',
                    borderTop: `2px solid ${p.col}`,
                  }}>
                    <div style={{
                      fontWeight: 800, fontSize: '0.95rem', color: p.col,
                      marginBottom: '0.55rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
                    }}>
                      <span>{p.icon}</span> {p.title}
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', listStyle: 'disc' }}>
                      {p.lines.map(l => (
                        <li key={l} style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.75 }}>{l}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Rotating Fact Ticker ────────────────────────────────── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.85rem',
              padding: '0.75rem 1rem',
              background: 'rgba(218,170,0,0.04)',
              border: '1px solid rgba(218,170,0,0.18)',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              marginBottom: '1.5rem',
            }} onClick={() => setFactIdx(i => (i + 1) % GLOBAL_FACTS.length)}
               title="Click for next fact">
              <span style={{
                color: '#DAAA00', fontSize: '0.65rem', fontWeight: 800,
                letterSpacing: '0.15em', flexShrink: 0,
                textShadow: '0 0 8px rgba(218,170,0,0.6)',
              }}>★ FACT</span>
              <span style={{ color: '#94a3b8', fontSize: '0.83rem', lineHeight: 1.6, fontStyle: 'italic' }}>
                {GLOBAL_FACTS[factIdx]}
              </span>
              <span style={{ color: '#3d1060', fontSize: '0.75rem', flexShrink: 0 }}>→</span>
            </div>

            {/* ── Manifesto pull-quote ────────────────────────────────── */}
            <div style={{
              padding: '1.2rem 1.4rem',
              background: 'linear-gradient(135deg, rgba(31,6,107,0.35) 0%, rgba(14,0,24,0.8) 100%)',
              border: '1px solid rgba(168,85,247,0.2)',
              borderLeft: '3px solid #a855f7',
              borderRadius: '0 0.5rem 0.5rem 0',
              marginBottom: '1rem',
            }}>
              <div style={{ fontSize: '0.92rem', color: '#cbd5e1', lineHeight: 2, fontStyle: 'italic' }}>
                "Science is not a job. It is a calling that doesn't pay enough, doesn't sleep enough, and doesn't stop.
                It is a love language spoken in peptide sequences and charge states and fragmentation patterns
                that only a few hundred humans on earth can read fluently."
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#a855f7', fontWeight: 600 }}>
                — From the ZIGGY About page
                <span
                  onClick={() => navigateTo && navigateTo('about')}
                  style={{ color: '#DAAA00', marginLeft: '0.75rem', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                  Read more →
                </span>
              </div>
            </div>

          </div>
        </div>
      );
    }
