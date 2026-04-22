
    // ─── Metaproteomics Analysis Tab ─────────────────────────────────────────────
    // Standard:     Taxonomic-Functional Biplot · COG Functional Landscape ·
    //               Protein Co-Abundance Network · Functional Redundancy Heatmap
    // Novel:        Metabolic Handoff Cascade · Dark Metaproteome Emergence ·
    //               PhyloFunc Terrain
    // Out of world: Microbiome Metabolic Cinema · 4D Metaproteomic Ion Globe
    //
    // Demo data modeled on:
    //   Kleiner et al. Nat Methods 2017 — benchmarking metaproteomics
    //   Tanca et al. Microbiome 2016 — gut community structure & function
    //   Rechenberger et al. J Proteome Res 2019 — SIHUMI community
    //   Petriz & Franco Front Microbiol 2017 — exercise microbiome shift
    // ─────────────────────────────────────────────────────────────────────────────

    // ── Seeded RNG ───────────────────────────────────────────────────────────────
    function mkMetaRng(seed) {
      let s = seed >>> 0;
      return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
    }

    // ── Shared demo data ─────────────────────────────────────────────────────────
    const META_SAMPLES = [
      {id:'H1', label:'Healthy-1', group:'healthy', col:'#22d3ee'},
      {id:'H2', label:'Healthy-2', group:'healthy', col:'#22d3ee'},
      {id:'H3', label:'Healthy-3', group:'healthy', col:'#22c55e'},
      {id:'H4', label:'Healthy-4', group:'healthy', col:'#22c55e'},
      {id:'I1', label:'IBD-1',     group:'ibd',     col:'#ef4444'},
      {id:'I2', label:'IBD-2',     group:'ibd',     col:'#ef4444'},
      {id:'I3', label:'IBD-3',     group:'ibd',     col:'#f97316'},
      {id:'I4', label:'IBD-4',     group:'ibd',     col:'#f97316'},
    ];

    const META_TAXA = [
      {name:'Faecalibacterium',  phylum:'Firmicutes',       col:'#22c55e',  role:'butyrate producer'},
      {name:'Ruminococcus',      phylum:'Firmicutes',       col:'#86efac',  role:'cellulose degrader'},
      {name:'Lachnospiraceae',   phylum:'Firmicutes',       col:'#4ade80',  role:'SCFA producer'},
      {name:'Bacteroides',       phylum:'Bacteroidetes',    col:'#22d3ee',  role:'polysaccharide degrader'},
      {name:'Prevotella',        phylum:'Bacteroidetes',    col:'#67e8f9',  role:'mucosal colonizer'},
      {name:'Akkermansia',       phylum:'Verrucomicrobia',  col:'#a855f7',  role:'mucin degrader'},
      {name:'Bifidobacterium',   phylum:'Actinobacteria',   col:'#DAAA00',  role:'lactate producer'},
      {name:'Escherichia',       phylum:'Proteobacteria',   col:'#ef4444',  role:'opportunistic'},
      {name:'Clostridium',       phylum:'Firmicutes',       col:'#f97316',  role:'gas producer'},
      {name:'Roseburia',         phylum:'Firmicutes',       col:'#34d399',  role:'butyrate producer'},
    ];

    // COG functional categories (abbreviated for display)
    const META_COGS = [
      {id:'C', name:'Energy production',        col:'#f97316'},
      {id:'G', name:'Carbohydrate metabolism',  col:'#DAAA00'},
      {id:'E', name:'Amino acid metabolism',    col:'#22c55e'},
      {id:'J', name:'Translation / ribosomes',  col:'#22d3ee'},
      {id:'K', name:'Transcription',            col:'#60a5fa'},
      {id:'O', name:'Protein turnover',         col:'#a855f7'},
      {id:'M', name:'Cell wall / membrane',     col:'#d946ef'},
      {id:'P', name:'Inorganic ion transport',  col:'#f59e0b'},
      {id:'L', name:'DNA replication / repair', col:'#38bdf8'},
      {id:'T', name:'Signal transduction',      col:'#818cf8'},
      {id:'V', name:'Defense mechanisms',       col:'#fb7185'},
      {id:'H', name:'Coenzyme metabolism',      col:'#34d399'},
    ];

    // PCA coordinates (pre-computed) for biplot
    const META_PCA = [
      {pc1:-1.8, pc2: 0.4, pc1_b:-1.9, pc2_b: 0.2},  // H1
      {pc1:-1.6, pc2:-0.5, pc1_b:-1.7, pc2_b:-0.4},  // H2
      {pc1:-1.4, pc2: 0.6, pc1_b:-1.3, pc2_b: 0.7},  // H3
      {pc1:-1.2, pc2:-0.3, pc1_b:-1.4, pc2_b:-0.5},  // H4
      {pc1: 1.3, pc2: 0.8, pc1_b: 1.2, pc2_b: 0.9},  // I1
      {pc1: 1.5, pc2:-0.6, pc1_b: 1.6, pc2_b:-0.7},  // I2
      {pc1: 1.7, pc2: 0.5, pc1_b: 1.8, pc2_b: 0.4},  // I3
      {pc1: 1.4, pc2:-0.9, pc1_b: 1.3, pc2_b:-1.0},  // I4
    ];

    // Functional arrows for biplot
    const META_ARROWS = [
      {name:'Butyrate production', dx:-0.95, dy: 0.25, col:'#22c55e'},
      {name:'LPS biosynthesis',    dx: 0.85, dy: 0.40, col:'#ef4444'},
      {name:'Mucin degradation',   dx: 0.60, dy:-0.70, col:'#a855f7'},
      {name:'SCFA output',         dx:-0.70, dy:-0.30, col:'#DAAA00'},
    ];

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 1: Taxonomic-Functional Biplot
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaBiplot() {
      const cvRef = React.useRef(null);
      const [hov, setHov] = React.useState(null);
      const ptsRef = React.useRef([]);

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const PAD = {l:70, r:160, t:40, b:55};
        const CX = (W - PAD.l - PAD.r) / 2 + PAD.l;
        const CY = (H - PAD.t - PAD.b) / 2 + PAD.t;
        const SC = Math.min(W - PAD.l - PAD.r, H - PAD.t - PAD.b) / 5;

        ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

        // Grid + axes
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
        for (let v = -2.5; v <= 2.5; v += 0.5) {
          ctx.beginPath(); ctx.moveTo(CX + v*SC, PAD.t); ctx.lineTo(CX + v*SC, H - PAD.b); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(PAD.l, CY + v*SC); ctx.lineTo(W - PAD.r, CY + v*SC); ctx.stroke();
        }
        // Main axes
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD.l, CY); ctx.lineTo(W - PAD.r, CY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(CX, PAD.t); ctx.lineTo(CX, H - PAD.b); ctx.stroke();

        // Axis labels
        ctx.fillStyle = '#475569'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('PC1 — Healthy ←→ IBD (38.4% var)', CX, H - 8);
        ctx.save(); ctx.translate(14, CY); ctx.rotate(-Math.PI/2);
        ctx.fillText('PC2 — Taxonomy axis (22.1% var)', 0, 0); ctx.restore();

        // Functional arrows
        META_ARROWS.forEach(a => {
          const ex = CX + a.dx * SC * 2.1, ey = CY - a.dy * SC * 2.1;
          ctx.save();
          ctx.strokeStyle = a.col + '99'; ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.setLineDash([]);
          // arrowhead
          const ang = Math.atan2(ey - CY, ex - CX);
          ctx.fillStyle = a.col + 'bb';
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - 9*Math.cos(ang-0.4), ey - 9*Math.sin(ang-0.4));
          ctx.lineTo(ex - 9*Math.cos(ang+0.4), ey - 9*Math.sin(ang+0.4));
          ctx.closePath(); ctx.fill();
          // label
          ctx.fillStyle = a.col + 'cc'; ctx.font = 'bold 8px system-ui';
          ctx.textAlign = 'center';
          const lx = CX + a.dx * SC * 2.5, ly = CY - a.dy * SC * 2.5;
          ctx.fillText(a.name, lx, ly);
          ctx.restore();
        });

        // Confidence ellipses (per group)
        [['healthy', '#22d3ee'], ['ibd', '#ef4444']].forEach(([grp, col]) => {
          const pts = META_SAMPLES.filter(s => s.group === grp).map((_, i) => {
            const pca = META_PCA[META_SAMPLES.indexOf(META_SAMPLES.find(s => s.group === grp && META_SAMPLES.indexOf(s) === i + (grp === 'ibd' ? 4 : 0)))];
            return pca;
          });
          const gpts = META_SAMPLES.map((s, i) => s.group === grp ? META_PCA[i] : null).filter(Boolean);
          const mx = gpts.reduce((a, p) => a + p.pc1, 0) / gpts.length;
          const my = gpts.reduce((a, p) => a + p.pc2, 0) / gpts.length;
          const rx = Math.sqrt(gpts.reduce((a, p) => a + (p.pc1 - mx)**2, 0) / gpts.length) * SC * 1.6 + 22;
          const ry = Math.sqrt(gpts.reduce((a, p) => a + (p.pc2 - my)**2, 0) / gpts.length) * SC * 1.6 + 18;
          ctx.save();
          ctx.strokeStyle = col + '33'; ctx.lineWidth = 1.5;
          ctx.fillStyle = col + '0a';
          ctx.beginPath(); ctx.ellipse(CX + mx*SC, CY - my*SC, rx, ry, 0, 0, Math.PI*2);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = col + '55'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(grp === 'healthy' ? 'Healthy cohort' : 'IBD cohort', CX + mx*SC, CY - my*SC - ry - 5);
          ctx.restore();
        });

        // Sample dots
        const pts = [];
        META_SAMPLES.forEach((s, i) => {
          const p = META_PCA[i];
          const x = CX + p.pc1 * SC, y = CY - p.pc2 * SC;
          const isHov = hov === i;
          const r = isHov ? 9 : 6.5;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
          ctx.fillStyle = s.col + (isHov ? 'ff' : 'cc');
          ctx.fill();
          if (isHov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
          ctx.fillStyle = '#e2e8f0'; ctx.font = `${isHov ? 'bold ' : ''}8.5px system-ui`; ctx.textAlign = 'center';
          ctx.fillText(s.id, x, y + 3);
          pts.push({i, x, y});
        });
        ptsRef.current = pts;

        // Hover tooltip
        if (hov !== null) {
          const s = META_SAMPLES[hov]; const p = META_PCA[hov];
          const x = CX + p.pc1*SC, y = CY - p.pc2*SC;
          const rng = mkMetaRng(hov * 31337);
          const topTaxon = META_TAXA[Math.floor(rng() * 4)];
          const tw = 178, th = 62;
          const tx = Math.min(x + 12, W - PAD.r - tw - 2);
          const ty = Math.max(y - th - 8, PAD.t + 2);
          ctx.fillStyle = 'rgba(14,0,24,0.96)';
          ctx.strokeStyle = s.col + '99'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 5); ctx.fill(); ctx.stroke();
          ctx.fillStyle = s.col; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(s.label, tx+7, ty+14);
          ctx.fillStyle = '#94a3b8'; ctx.font = '8px system-ui';
          ctx.fillText(`PC1: ${p.pc1.toFixed(2)}  PC2: ${p.pc2.toFixed(2)}`, tx+7, ty+28);
          ctx.fillStyle = topTaxon.col;
          ctx.fillText(`Dominant: ${topTaxon.name} (${Math.round(20 + rng()*30)}%)`, tx+7, ty+42);
          ctx.fillStyle = '#64748b'; ctx.font = 'italic 7.5px system-ui';
          ctx.fillText(topTaxon.role, tx+7, ty+56);
        }

        // Legend (right panel)
        const LX = W - PAD.r + 10;
        ctx.fillStyle = '#64748b'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'left';
        ctx.fillText('Cohort', LX, PAD.t + 10);
        [{col:'#22d3ee',lbl:'Healthy'},{col:'#ef4444',lbl:'IBD'}].forEach(({col,lbl},i) => {
          ctx.beginPath(); ctx.arc(LX+5, PAD.t + 25 + i*18, 5, 0, Math.PI*2);
          ctx.fillStyle = col+'cc'; ctx.fill();
          ctx.fillStyle = '#94a3b8'; ctx.font = '8px system-ui';
          ctx.fillText(lbl, LX+14, PAD.t + 29 + i*18);
        });
        ctx.fillStyle = '#64748b'; ctx.font = 'bold 8px system-ui';
        ctx.fillText('Functions', LX, PAD.t + 75);
        META_ARROWS.forEach((a, i) => {
          ctx.strokeStyle = a.col + '99'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(LX, PAD.t + 90 + i*18); ctx.lineTo(LX+12, PAD.t + 90 + i*18); ctx.stroke();
          ctx.fillStyle = '#94a3b8'; ctx.font = '7.5px system-ui';
          ctx.fillText(a.name, LX+16, PAD.t + 94 + i*18);
        });
      }, [hov]);

      const handleMove = e => {
        const cv = cvRef.current; if (!cv) return;
        const rect = cv.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (cv.width / rect.width);
        const my = (e.clientY - rect.top) * (cv.height / rect.height);
        let best = null, bestD = 16;
        ptsRef.current.forEach(pt => {
          const d = Math.hypot(mx - pt.x, my - pt.y);
          if (d < bestD) { bestD = d; best = pt.i; }
        });
        setHov(best);
      };

      return (
        <div className="card" style={{marginBottom:'1rem'}}>
          <h3 style={{marginBottom:'0.2rem',background:'linear-gradient(90deg,#22d3ee,#a855f7)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            Taxonomic-Functional Biplot
          </h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.5rem',lineHeight:1.5}}>
            PCA of protein abundance profiles. Samples cluster by disease state (PC1) and taxonomic composition (PC2).
            Functional gradient arrows show which metabolic activities drive separation. Hover samples for details.
          </p>
          <canvas ref={cvRef} width={820} height={420}
            onMouseMove={handleMove} onMouseLeave={() => setHov(null)}
            style={{width:'100%',display:'block',borderRadius:'0.4rem',cursor:'crosshair'}}/>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 2: COG Functional Landscape
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaCOGLandscape() {
      const cvRef = React.useRef(null);
      const [sortBy, setSortBy] = React.useState('energy');

      const COG_DATA = React.useMemo(() => {
        const rng = mkMetaRng(4242);
        // Base abundances per COG per sample; healthy enriches energy/SCFA, IBD enriches stress/defense
        const base = {
          C:[0.18,0.17,0.19,0.18, 0.09,0.10,0.08,0.09],
          G:[0.16,0.15,0.17,0.16, 0.10,0.09,0.10,0.11],
          E:[0.12,0.13,0.12,0.13, 0.14,0.13,0.15,0.14],
          J:[0.14,0.14,0.13,0.14, 0.14,0.15,0.14,0.14],
          K:[0.07,0.07,0.07,0.07, 0.07,0.07,0.07,0.07],
          O:[0.06,0.06,0.06,0.06, 0.10,0.11,0.10,0.10],
          M:[0.08,0.08,0.08,0.08, 0.10,0.10,0.10,0.10],
          P:[0.06,0.07,0.06,0.07, 0.07,0.07,0.07,0.07],
          L:[0.04,0.04,0.04,0.04, 0.07,0.07,0.07,0.07],
          T:[0.04,0.04,0.04,0.04, 0.06,0.06,0.06,0.06],
          V:[0.03,0.03,0.03,0.03, 0.06,0.05,0.06,0.05],
          H:[0.02,0.02,0.02,0.02, 0.01,0.01,0.01,0.01],
        };
        // Add small noise
        const out = {};
        META_COGS.forEach(c => {
          out[c.id] = base[c.id].map(v => Math.max(0.005, v + (rng() - 0.5) * 0.01));
        });
        // Normalize each sample to 1
        for (let i = 0; i < 8; i++) {
          const sum = META_COGS.reduce((a, c) => a + out[c.id][i], 0);
          META_COGS.forEach(c => { out[c.id][i] /= sum; });
        }
        return out;
      }, []);

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const PAD = {l:110, r:14, t:60, b:30};
        const BAR_H = Math.floor((H - PAD.t - PAD.b) / META_SAMPLES.length) - 2;

        ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

        // Sort COGs
        const orderedCogs = [...META_COGS].sort((a, b) => {
          if (sortBy === 'energy') return (b.id === 'C' || b.id === 'G') ? 1 : -1;
          if (sortBy === 'healthy') return COG_DATA[b.id][0] - COG_DATA[a.id][0];
          if (sortBy === 'ibd')    return COG_DATA[b.id][4] - COG_DATA[a.id][4];
          return 0;
        });

        // Column headers (COG categories)
        const barW = W - PAD.l - PAD.r;

        // Draw bars
        META_SAMPLES.forEach((s, si) => {
          const y = PAD.t + si * (BAR_H + 2);
          let x = PAD.l;
          // Sample label
          ctx.fillStyle = s.col; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'right';
          ctx.fillText(s.label, PAD.l - 6, y + BAR_H/2 + 3);
          // Group indicator
          ctx.fillStyle = s.col + '33';
          ctx.fillRect(4, y - 1, 4, BAR_H + 2);

          orderedCogs.forEach(cog => {
            const val = COG_DATA[cog.id][si];
            const bw = val * barW;
            ctx.fillStyle = cog.col + 'cc';
            ctx.fillRect(x, y, bw, BAR_H);
            if (bw > 18) {
              ctx.fillStyle = '#000a'; ctx.font = 'bold 7px system-ui'; ctx.textAlign = 'center';
              ctx.fillText(cog.id, x + bw/2, y + BAR_H/2 + 2.5);
            }
            x += bw;
          });
        });

        // Healthy / IBD divider
        const divY = PAD.t + 4 * (BAR_H + 2) - 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(PAD.l, divY); ctx.lineTo(W - PAD.r, divY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#22d3ee44'; ctx.font = '7px system-ui'; ctx.textAlign = 'left';
        ctx.fillText('Healthy', PAD.l + 2, divY - 3);
        ctx.fillStyle = '#ef444444';
        ctx.fillText('IBD', PAD.l + 2, divY + 10);

        // Legend at top
        let lx = PAD.l;
        orderedCogs.forEach(cog => {
          const bw = COG_DATA[cog.id].reduce((a, v) => a + v, 0) / 8 * barW;
          ctx.fillStyle = cog.col + 'cc';
          ctx.fillRect(lx, 12, bw, 14);
          if (bw > 14) {
            ctx.fillStyle = '#000a'; ctx.font = 'bold 7px system-ui'; ctx.textAlign = 'center';
            ctx.fillText(cog.id, lx + bw/2, 23);
          }
          lx += bw;
        });
        ctx.fillStyle = '#475569'; ctx.font = '8px system-ui'; ctx.textAlign = 'left';
        ctx.fillText('COG category (mean abundance)', PAD.l, 9);

        // X axis label
        ctx.fillStyle = '#64748b'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Relative protein abundance', PAD.l + barW/2, H - 4);
      }, [COG_DATA, sortBy]);

      return (
        <div className="card" style={{marginBottom:'1rem'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.4rem'}}>
            <div>
              <h3 style={{marginBottom:'0.15rem',background:'linear-gradient(90deg,#DAAA00,#f97316)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
                COG Functional Landscape
              </h3>
              <p style={{color:'var(--muted)',fontSize:'0.76rem',lineHeight:1.5}}>
                Functional category breakdown per sample. Healthy gut is enriched in energy (C) and carbohydrate (G) metabolism.
                IBD shifts toward protein turnover (O), cell wall stress (M), and DNA repair (L).
              </p>
            </div>
            <div style={{display:'flex',gap:'0.35rem',flexShrink:0}}>
              {[['energy','Sort: Energy'],['healthy','Sort: Healthy↑'],['ibd','Sort: IBD↑']].map(([k,l]) => (
                <button key={k} onClick={() => setSortBy(k)}
                  style={{padding:'0.2rem 0.55rem',fontSize:'0.72rem',fontWeight:600,borderRadius:'0.3rem',border:'none',cursor:'pointer',
                    background: sortBy===k?'var(--accent)':'var(--surface)',color:sortBy===k?'var(--bg)':'var(--muted)'}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <canvas ref={cvRef} width={820} height={290}
            style={{width:'100%',display:'block',borderRadius:'0.4rem'}}/>
          <div style={{display:'flex',flexWrap:'wrap',gap:'0.3rem',marginTop:'0.5rem'}}>
            {META_COGS.map(c => (
              <span key={c.id} style={{fontSize:'0.68rem',color:'#94a3b8',display:'flex',alignItems:'center',gap:'0.2rem'}}>
                <span style={{display:'inline-block',width:'8px',height:'8px',borderRadius:'1px',background:c.col}}/>
                <strong style={{color:c.col}}>{c.id}</strong> {c.name}
              </span>
            ))}
          </div>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 3: Protein Co-Abundance Network
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaNetwork() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);
      const simRef = React.useRef(null);
      const [hovNode, setHovNode] = React.useState(null);
      const [running, setRunning] = React.useState(true);

      const PROTEIN_FAMILIES = [
        {name:'Glucokinase',          tax:0, grp:'glycolysis'},
        {name:'Pyruvate kinase',      tax:0, grp:'glycolysis'},
        {name:'Lactate dehydrogenase',tax:0, grp:'glycolysis'},
        {name:'Butyryl-CoA synthase', tax:0, grp:'butyrate'},
        {name:'Butyrate kinase',      tax:0, grp:'butyrate'},
        {name:'β-glucosidase',        tax:1, grp:'polysac'},
        {name:'Xylanase',             tax:1, grp:'polysac'},
        {name:'Cellulosome',          tax:1, grp:'polysac'},
        {name:'Sus outer membrane',   tax:3, grp:'polysac'},
        {name:'Sus lipoproteins',     tax:3, grp:'polysac'},
        {name:'Mucin glycosidase',    tax:5, grp:'mucin'},
        {name:'Mucin sulfatase',      tax:5, grp:'mucin'},
        {name:'Flagellin',            tax:7, grp:'motility'},
        {name:'Chemoreceptors',       tax:7, grp:'motility'},
        {name:'GroEL chaperone',      tax:2, grp:'stress'},
        {name:'DnaK heat shock',      tax:2, grp:'stress'},
        {name:'RecA DNA repair',      tax:7, grp:'stress'},
        {name:'Ribosomal L1',         tax:9, grp:'core'},
        {name:'Ribosomal S1',         tax:9, grp:'core'},
        {name:'EF-Tu',                tax:9, grp:'core'},
        {name:'DNA gyrase',           tax:4, grp:'core'},
        {name:'RNA polymerase',       tax:4, grp:'core'},
      ];

      const GRP_COL = {
        glycolysis:'#DAAA00', butyrate:'#22c55e', polysac:'#22d3ee',
        mucin:'#a855f7', motility:'#f97316', stress:'#ef4444', core:'#94a3b8'
      };

      // Correlation edges (r > 0.65)
      const EDGES = [
        [0,1,0.94],[0,2,0.81],[1,2,0.88],[0,3,0.72],[3,4,0.91],
        [5,6,0.87],[5,7,0.79],[6,7,0.83],[8,9,0.92],[5,8,0.68],
        [10,11,0.89],[10,5,0.71],[11,8,0.66],
        [12,13,0.76],[14,15,0.85],[14,16,0.68],[15,16,0.72],
        [17,18,0.95],[17,19,0.91],[18,19,0.88],[20,21,0.82],
        [0,17,0.70],[5,17,0.68],[14,17,0.65],
      ];

      React.useEffect(() => {
        const rng = mkMetaRng(9999);
        const N = PROTEIN_FAMILIES.length;
        const nodes = PROTEIN_FAMILIES.map((p, i) => ({
          id: i, x: 120 + rng() * 580, y: 60 + rng() * 320,
          vx: 0, vy: 0,
          mass: 0.8 + rng() * 0.4,
        }));
        simRef.current = nodes;

        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;

        const tick = () => {
          // Force-directed simulation: repulsion + spring + centering
          const ns = simRef.current;
          for (let i = 0; i < N; i++) {
            ns[i].vx *= 0.85; ns[i].vy *= 0.85;
            // Center pull
            ns[i].vx += (W/2 - ns[i].x) * 0.0006;
            ns[i].vy += (H/2 - ns[i].y) * 0.0006;
            // Repulsion from all other nodes
            for (let j = 0; j < N; j++) {
              if (i === j) continue;
              const dx = ns[i].x - ns[j].x, dy = ns[i].y - ns[j].y;
              const d2 = dx*dx + dy*dy + 1;
              const f = 1800 / d2;
              ns[i].vx += dx * f; ns[i].vy += dy * f;
            }
          }
          // Spring forces along edges
          EDGES.forEach(([a, b, r]) => {
            const dx = ns[b].x - ns[a].x, dy = ns[b].y - ns[a].y;
            const d = Math.sqrt(dx*dx + dy*dy) || 1;
            const rest = 70 + (1-r)*60;
            const f = (d - rest) * 0.04;
            const fx = dx/d * f, fy = dy/d * f;
            ns[a].vx += fx; ns[a].vy += fy;
            ns[b].vx -= fx; ns[b].vy -= fy;
          });
          // Update positions with boundary
          ns.forEach(n => {
            n.x = Math.max(28, Math.min(W-28, n.x + n.vx));
            n.y = Math.max(28, Math.min(H-28, n.y + n.vy));
          });

          // Draw
          ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

          // Edges
          EDGES.forEach(([a, b, r]) => {
            const na = ns[a], nb = ns[b];
            const col = GRP_COL[PROTEIN_FAMILIES[a].grp];
            ctx.strokeStyle = col + Math.round(r * 120).toString(16).padStart(2,'0');
            ctx.lineWidth = r * 2.5;
            ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();
          });

          // Nodes
          ns.forEach((n, i) => {
            const pf = PROTEIN_FAMILIES[i];
            const tx = META_TAXA[pf.tax];
            const col = GRP_COL[pf.grp];
            const isHov = hovNode === i;
            const r = isHov ? 12 : 8;
            // Glow
            const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r*2.5);
            g.addColorStop(0, col+'55'); g.addColorStop(1, col+'00');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, r*2.5, 0, Math.PI*2); ctx.fill();
            // Node
            ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI*2);
            ctx.fillStyle = col + (isHov ? 'ff' : 'cc'); ctx.fill();
            if (isHov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
            // Label
            ctx.fillStyle = isHov ? '#e2e8f0' : '#64748b';
            ctx.font = `${isHov ? 'bold ' : ''}7.5px system-ui`; ctx.textAlign = 'center';
            ctx.fillText(pf.name.slice(0, 14), n.x, n.y + r + 10);
            if (isHov) {
              ctx.fillStyle = tx.col + 'cc'; ctx.font = '7px system-ui';
              ctx.fillText(tx.name, n.x, n.y + r + 21);
            }
          });

          rafRef.current = requestAnimationFrame(tick);
        };

        if (running) {
          rafRef.current = requestAnimationFrame(tick);
        }
        return () => cancelAnimationFrame(rafRef.current);
      }, [running, hovNode]);

      const handleMove = e => {
        const cv = cvRef.current; if (!cv || !simRef.current) return;
        const rect = cv.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (cv.width / rect.width);
        const my = (e.clientY - rect.top) * (cv.height / rect.height);
        let best = null, bestD = 18;
        simRef.current.forEach((n, i) => {
          const d = Math.hypot(mx - n.x, my - n.y);
          if (d < bestD) { bestD = d; best = i; }
        });
        setHovNode(best);
      };

      return (
        <div className="card" style={{marginBottom:'1rem'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.4rem'}}>
            <div>
              <h3 style={{marginBottom:'0.15rem',background:'linear-gradient(90deg,#a855f7,#22d3ee)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
                Protein Co-Abundance Network
              </h3>
              <p style={{color:'var(--muted)',fontSize:'0.76rem',lineHeight:1.5}}>
                Force-directed network of protein families (Pearson r &gt; 0.65 across samples). Clusters reveal
                functional guilds operating together across the microbiome. Edge thickness = correlation strength.
              </p>
            </div>
            <button onClick={() => setRunning(r => !r)}
              style={{padding:'0.25rem 0.65rem',fontSize:'0.75rem',fontWeight:600,borderRadius:'0.3rem',
                border:'none',cursor:'pointer',background:'var(--surface)',color:'var(--muted)',flexShrink:0}}>
              {running ? '⏸ Pause' : '▶ Play'}
            </button>
          </div>
          <canvas ref={cvRef} width={820} height={420}
            onMouseMove={handleMove} onMouseLeave={() => setHovNode(null)}
            style={{width:'100%',display:'block',borderRadius:'0.4rem',cursor:'crosshair'}}/>
          <div style={{display:'flex',flexWrap:'wrap',gap:'0.4rem',marginTop:'0.5rem'}}>
            {Object.entries(GRP_COL).map(([g, c]) => (
              <span key={g} style={{fontSize:'0.68rem',color:'#94a3b8',display:'flex',alignItems:'center',gap:'0.2rem'}}>
                <span style={{display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:c}}/>
                {g}
              </span>
            ))}
          </div>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 4: Functional Redundancy Heatmap
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaRedundancy() {
      const cvRef = React.useRef(null);
      const [hovCell, setHovCell] = React.useState(null);

      const FUNCTIONS = [
        'Butyrate synthesis',  'Propionate synthesis', 'Acetate synthesis',
        'Lactate production',  'Cellulose degradation','Pectin degradation',
        'Mucin degradation',   'Bile acid conversion', 'Vitamin B12 synth.',
        'Tryptophan catab.',   'LPS biosynthesis',     'Flagella assembly',
        'DNA repair (recA)',   'Sporulation',          'H₂ production',
      ];

      const REDUNDANCY = React.useMemo(() => {
        const rng = mkMetaRng(12345);
        // Rows = functions, cols = samples
        // Healthy samples have higher redundancy for beneficial functions
        // IBD samples have higher redundancy for stress/virulence
        const base = [
          [7,8,7,8, 2,2,3,2],  // butyrate
          [6,6,7,6, 3,3,3,4],  // propionate
          [8,8,8,7, 5,5,6,5],  // acetate
          [5,5,5,5, 4,5,4,5],  // lactate
          [6,7,6,7, 2,2,2,3],  // cellulose
          [5,5,6,5, 3,3,3,3],  // pectin
          [3,3,3,3, 6,7,6,7],  // mucin — IBD enriched
          [4,4,5,4, 2,2,2,2],  // bile
          [4,5,4,4, 2,2,2,2],  // B12
          [3,3,3,3, 4,4,4,4],  // trp
          [2,2,2,2, 7,7,8,7],  // LPS — IBD
          [3,3,3,3, 5,6,5,6],  // flagella — IBD
          [2,2,2,2, 6,6,7,6],  // recA — IBD
          [1,1,1,1, 4,4,4,5],  // sporulation
          [4,4,4,4, 6,6,7,6],  // H2
        ];
        return base.map(row => row.map(v => Math.max(1, Math.min(10, v + Math.round((rng()-0.5)*1.2)))));
      }, []);

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const PAD = {l:152, r:14, t:42, b:14};
        const CELL_W = Math.floor((W - PAD.l - PAD.r) / 8);
        const CELL_H = Math.floor((H - PAD.t - PAD.b) / FUNCTIONS.length);
        const NF = FUNCTIONS.length;

        ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

        // Column headers
        META_SAMPLES.forEach((s, j) => {
          const x = PAD.l + j * CELL_W + CELL_W/2;
          ctx.fillStyle = s.col; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(s.id, x, PAD.t - 6);
          // Health indicator bar
          ctx.fillStyle = s.col + '44';
          ctx.fillRect(PAD.l + j * CELL_W + 1, PAD.t - 18, CELL_W - 2, 10);
        });

        // Healthy/IBD header bands
        ctx.fillStyle = '#22d3ee22'; ctx.fillRect(PAD.l, PAD.t - 22, CELL_W * 4, 4);
        ctx.fillStyle = '#ef444422'; ctx.fillRect(PAD.l + CELL_W*4, PAD.t - 22, CELL_W * 4, 4);
        ctx.fillStyle = '#22d3ee66'; ctx.font = '7px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Healthy', PAD.l + CELL_W*2, PAD.t - 25);
        ctx.fillStyle = '#ef444466';
        ctx.fillText('IBD', PAD.l + CELL_W*6, PAD.t - 25);

        // Divider line between healthy and IBD
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(PAD.l + CELL_W*4, PAD.t); ctx.lineTo(PAD.l + CELL_W*4, PAD.t + NF*CELL_H); ctx.stroke();

        // Cells
        FUNCTIONS.forEach((fn, fi) => {
          // Row label
          ctx.fillStyle = '#64748b'; ctx.font = '8px system-ui'; ctx.textAlign = 'right';
          ctx.fillText(fn, PAD.l - 5, PAD.t + fi*CELL_H + CELL_H/2 + 3);

          REDUNDANCY[fi].forEach((val, si) => {
            const x = PAD.l + si * CELL_W, y = PAD.t + fi * CELL_H;
            const isHov = hovCell && hovCell.fi === fi && hovCell.si === si;
            // Color: green=high redundancy, red=low
            const t = (val - 1) / 9;
            const r = Math.round(255 * (1-t) * 0.8);
            const g = Math.round(255 * t * 0.8);
            const b = Math.round(60 * t);
            ctx.fillStyle = `rgba(${r},${g},${b},0.75)`;
            ctx.fillRect(x+1, y+1, CELL_W-2, CELL_H-2);
            if (isHov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x+1, y+1, CELL_W-2, CELL_H-2); }
            ctx.fillStyle = val > 5 ? '#000a' : '#ffffffcc';
            ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center';
            ctx.fillText(val, x + CELL_W/2, y + CELL_H/2 + 3);
          });
        });

        // Hover tooltip
        if (hovCell && REDUNDANCY[hovCell.fi]) {
          const val = REDUNDANCY[hovCell.fi][hovCell.si];
          const s = META_SAMPLES[hovCell.si];
          const fn = FUNCTIONS[hovCell.fi];
          const x = PAD.l + hovCell.si * CELL_W;
          const y = PAD.t + hovCell.fi * CELL_H;
          const tw = 180, th = 52;
          const tx = Math.min(x + CELL_W + 4, W - tw - 2);
          const ty = Math.max(y - 4, PAD.t);
          ctx.fillStyle = 'rgba(14,0,24,0.96)'; ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 5); ctx.fill(); ctx.stroke();
          ctx.fillStyle = s.col; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(`${s.label} — ${fn}`, tx+6, ty+14);
          ctx.fillStyle = val >= 6 ? '#22c55e' : val >= 4 ? '#f97316' : '#ef4444';
          ctx.font = '8px system-ui';
          ctx.fillText(`Redundancy: ${val} organisms`, tx+6, ty+28);
          ctx.fillStyle = '#64748b';
          ctx.fillText(val >= 6 ? 'High — resilient to species loss' : val >= 4 ? 'Moderate redundancy' : 'Low — vulnerable function', tx+6, ty+42);
        }
      }, [REDUNDANCY, hovCell]);

      const handleMove = e => {
        const cv = cvRef.current; if (!cv) return;
        const W = cv.width, H = cv.height;
        const PAD = {l:152, r:14, t:42, b:14};
        const CELL_W = Math.floor((W - PAD.l - PAD.r) / 8);
        const CELL_H = Math.floor((H - PAD.t - PAD.b) / FUNCTIONS.length);
        const rect = cv.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (cv.width / rect.width);
        const my = (e.clientY - rect.top) * (cv.height / rect.height);
        const si = Math.floor((mx - PAD.l) / CELL_W);
        const fi = Math.floor((my - PAD.t) / CELL_H);
        if (si >= 0 && si < 8 && fi >= 0 && fi < FUNCTIONS.length) setHovCell({si, fi});
        else setHovCell(null);
      };

      return (
        <div className="card" style={{marginBottom:'1rem'}}>
          <h3 style={{marginBottom:'0.15rem',background:'linear-gradient(90deg,#22c55e,#DAAA00)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            Functional Redundancy Heatmap
          </h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.5rem',lineHeight:1.5}}>
            Number of organisms per sample that can perform each ecosystem function.
            <span style={{color:'#22c55e'}}> Green = high redundancy</span> (community resilient to species loss) ·
            <span style={{color:'#ef4444'}}> Red = low redundancy</span> (single point of failure).
            IBD microbiomes lose butyrate-producing redundancy — a clinically relevant collapse.
          </p>
          <canvas ref={cvRef} width={820} height={380}
            onMouseMove={handleMove} onMouseLeave={() => setHovCell(null)}
            style={{width:'100%',display:'block',borderRadius:'0.4rem',cursor:'crosshair'}}/>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 5 (NOVEL): Metabolic Handoff Cascade
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaHandoff() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);
      const [mode, setMode] = React.useState('healthy');

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;

        // Pathway steps — each performed by a different organism
        const HEALTHY_STEPS = [
          {label:'Cellulose',     sub:'polysaccharide',  col:'#e2e8f0', isSubstrate:true},
          {org:'Ruminococcus',    enzyme:'Cellulosome',  col:'#22d3ee', product:'Glucose'},
          {label:'Glucose',       sub:'monosaccharide',  col:'#DAAA00', isSubstrate:true},
          {org:'Bacteroides',     enzyme:'Glycolysis',   col:'#22d3ee', product:'Acetate/Lactate'},
          {label:'Acetate',       sub:'SCFA',            col:'#60a5fa', isSubstrate:true},
          {org:'Faecalibacterium',enzyme:'Butyryl-CoA',  col:'#22c55e', product:'Butyrate'},
          {label:'Butyrate',      sub:'→ colonocyte fuel', col:'#22c55e', isSubstrate:true, final:true},
        ];

        const IBD_STEPS = [
          {label:'Cellulose',     sub:'polysaccharide',  col:'#e2e8f0', isSubstrate:true},
          {org:'Ruminococcus',    enzyme:'Cellulosome',  col:'#22d3ee', product:'Glucose', reduced:true},
          {label:'Glucose',       sub:'monosaccharide',  col:'#DAAA00', isSubstrate:true},
          {org:'Escherichia',     enzyme:'LPS + toxins', col:'#ef4444', product:'Acetate + ROS'},
          {label:'Acetate+ROS',   sub:'inflammation',    col:'#ef4444', isSubstrate:true},
          {org:'Faecalibacterium',enzyme:'(depleted)',   col:'#4b5563', product:'↓ Butyrate', reduced:true},
          {label:'↓ Butyrate',    sub:'colonocyte starved', col:'#ef4444', isSubstrate:true, final:true, bad:true},
        ];

        const STEPS = mode === 'healthy' ? HEALTHY_STEPS : IBD_STEPS;

        // Positions
        const substrates = STEPS.filter(s => s.isSubstrate);
        const orgs = STEPS.filter(s => s.org);
        const N_STEPS = substrates.length;
        const STEP_W = (W - 60) / (N_STEPS - 1);
        const SUB_Y = H * 0.35, ORG_Y = H * 0.72;

        let substIdx = 0, orgIdx = 0;
        const nodes = STEPS.map(s => {
          if (s.isSubstrate) {
            const x = 30 + substIdx * STEP_W;
            substIdx++;
            return {...s, x, y: SUB_Y};
          } else {
            const x = 30 + (orgIdx + 0.5) * STEP_W;
            orgIdx++;
            return {...s, x, y: ORG_Y};
          }
        });

        // Particles
        const parts = [];
        const rng = mkMetaRng(mode === 'healthy' ? 1 : 2);
        let t = 0;

        function spawnParticle(fromNode, toNode, col, delay) {
          parts.push({
            x: fromNode.x, y: fromNode.y,
            tx: toNode.x, ty: toNode.y,
            col, prog: -delay, alpha: 0,
            sz: 2.5 + rng() * 1.5,
          });
        }

        // Initial spawn
        nodes.forEach((n, i) => {
          if (!n.org) return;
          const prev = nodes[i-1]; // substrate going in
          const next = nodes[i+1]; // product going out
          if (prev && next) {
            for (let p = 0; p < (n.reduced ? 2 : 5); p++) {
              spawnParticle(prev, n, n.col, rng() * 1.5);
              spawnParticle(n, next, next.col, 0.5 + rng() * 1.5);
            }
          }
        });

        const frame = () => {
          t += 0.016;
          ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

          // Grid
          ctx.strokeStyle = 'rgba(218,170,0,0.025)'; ctx.lineWidth = 0.5;
          for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
          for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

          // Connection arrows between organism and adjacent substrates
          nodes.forEach((n, i) => {
            if (!n.org) return;
            const prev = nodes[i-1], next = nodes[i+1];
            if (prev) {
              ctx.strokeStyle = n.col + '55'; ctx.lineWidth = 1.5;
              ctx.setLineDash([3,5]);
              ctx.beginPath(); ctx.moveTo(prev.x, prev.y + 22); ctx.lineTo(n.x, n.y - 22); ctx.stroke();
              ctx.setLineDash([]);
            }
            if (next) {
              ctx.strokeStyle = next.col + '55'; ctx.lineWidth = 1.5;
              ctx.setLineDash([3,5]);
              ctx.beginPath(); ctx.moveTo(n.x, n.y - 22); ctx.lineTo(next.x, next.y + 22); ctx.stroke();
              ctx.setLineDash([]);
            }
          });

          // Nodes
          nodes.forEach(n => {
            if (n.isSubstrate) {
              // Substrate pill
              const pw = 90, ph = 36;
              const pulse = 1 + 0.04 * Math.sin(t * 1.8 + n.x * 0.02);
              ctx.fillStyle = 'rgba(14,0,24,0.9)';
              ctx.strokeStyle = n.col + (n.final ? 'ff' : '88');
              ctx.lineWidth = n.final ? 2.5 : 1.5;
              ctx.beginPath(); ctx.roundRect(n.x - pw/2, n.y - ph/2, pw, ph, 8); ctx.fill(); ctx.stroke();
              ctx.fillStyle = n.col; ctx.font = `bold ${n.final ? 11 : 10}px system-ui`; ctx.textAlign = 'center';
              ctx.fillText(n.label, n.x, n.y + 3);
              ctx.fillStyle = n.col + '88'; ctx.font = '7.5px system-ui';
              ctx.fillText(n.sub, n.x, n.y + 15);
            } else {
              // Organism box
              const bw = 112, bh = 52;
              const pulse = n.reduced ? 0 : 0.06 * Math.sin(t * 2.2 + n.x * 0.03);
              ctx.fillStyle = n.reduced ? 'rgba(20,10,30,0.9)' : 'rgba(14,0,36,0.9)';
              ctx.strokeStyle = n.col + (n.reduced ? '44' : '99');
              ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.roundRect(n.x - bw/2, n.y - bh/2, bw, bh, 6);
              ctx.fill(); ctx.stroke();
              // Organism glow
              if (!n.reduced) {
                const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, bw*0.8);
                g.addColorStop(0, n.col + '15'); g.addColorStop(1, n.col + '00');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, bw*0.8, 0, Math.PI*2); ctx.fill();
              }
              ctx.fillStyle = n.col + (n.reduced ? '55' : 'dd');
              ctx.font = `bold 9px system-ui`; ctx.textAlign = 'center';
              ctx.fillText(n.org, n.x, n.y - 8);
              ctx.fillStyle = n.col + (n.reduced ? '44' : '88'); ctx.font = '8px system-ui';
              ctx.fillText(n.enzyme, n.x, n.y + 5);
              ctx.fillStyle = n.col + (n.reduced ? '33' : '66'); ctx.font = 'italic 7.5px system-ui';
              ctx.fillText(n.product || '', n.x, n.y + 18);
            }
          });

          // Particles
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.prog += 0.016 / 1.2;
            if (p.prog < 0) continue;
            if (p.prog >= 1) {
              // Respawn
              p.prog = -(rng() * 1.2);
              continue;
            }
            const prog = Math.min(1, Math.max(0, p.prog));
            p.x = p.x + (p.tx - p.x) * 0.04;
            p.y = p.y + (p.ty - p.y) * 0.04;
            // Actually lerp properly
            const lx = p.x + (p.tx - p.x) * prog * 0.15;
            const ly = p.y + (p.ty - p.y) * prog * 0.15;
            p.alpha = Math.sin(prog * Math.PI);
            ctx.beginPath(); ctx.arc(
              p.x + (p.tx - p.x) * prog,
              p.y + (p.ty - p.y) * prog,
              p.sz, 0, Math.PI*2);
            ctx.fillStyle = p.col + Math.round(p.alpha * 200).toString(16).padStart(2,'0');
            ctx.fill();
          }

          // Spawn new
          if (Math.random() < 0.25) {
            nodes.forEach((n, i) => {
              if (!n.org) return;
              const prev = nodes[i-1], next = nodes[i+1];
              if (prev && next && Math.random() < 0.3) {
                spawnParticle(prev, n, n.col, 0);
                spawnParticle(n, next, next.col, 0.2);
              }
            });
          }

          // Title
          ctx.fillStyle = mode === 'healthy' ? '#22c55e' : '#ef4444';
          ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'right';
          ctx.fillText(mode === 'healthy' ? '✓ Healthy microbiome — butyrate cascade complete' : '⚠ IBD dysbiosis — cascade disrupted by Escherichia bloom', W - 12, 16);

          rafRef.current = requestAnimationFrame(frame);
        };

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
      }, [mode]);

      return (
        <div className="card" style={{marginBottom:'1rem',border:'1px solid rgba(218,170,0,0.2)',background:'linear-gradient(160deg,rgba(14,0,24,0.98),rgba(1,15,35,0.9))'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.5rem'}}>
            <div>
              <h3 style={{marginBottom:'0.15rem',background:'linear-gradient(90deg,#22c55e,#DAAA00)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
                ★ Metabolic Handoff Cascade
              </h3>
              <p style={{color:'var(--muted)',fontSize:'0.76rem',lineHeight:1.5,maxWidth:'580px'}}>
                Novel visualization of cross-species enzyme hand-offs along a metabolic pathway.
                Each organism picks up where the last left off — the microbiome as a relay race.
                Switch to IBD to see how a single bloom breaks the chain.
              </p>
            </div>
            <div style={{display:'flex',gap:'0.35rem',flexShrink:0}}>
              {[['healthy','Healthy'],['ibd','IBD dysbiosis']].map(([k,l]) => (
                <button key={k} onClick={() => setMode(k)}
                  style={{padding:'0.25rem 0.65rem',fontSize:'0.75rem',fontWeight:600,borderRadius:'0.3rem',
                    border:'none',cursor:'pointer',
                    background: mode===k ? (k==='healthy'?'#22c55e':'#ef4444') : 'var(--surface)',
                    color: mode===k ? '#fff' : 'var(--muted)'}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <canvas ref={cvRef} width={820} height={360}
            style={{width:'100%',display:'block',borderRadius:'0.4rem'}}/>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 6 (NOVEL): Dark Metaproteome Emergence
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaDarkEmergence() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);
      const [sensitivity, setSensitivity] = React.useState(0.05);
      const [animating, setAnimating] = React.useState(false);
      const animRef = React.useRef(false);
      const sensRef = React.useRef(0.05);

      React.useEffect(() => { sensRef.current = sensitivity; }, [sensitivity]);

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const rng = mkMetaRng(77777);

        // Generate protein universe — 5000 proteins with discovery thresholds
        const PROTEINS = Array.from({length: 5000}, () => {
          const abundance = Math.pow(10, -4 + rng() * 6); // 1e-4 to 1e2
          const tax = META_TAXA[Math.floor(rng() * META_TAXA.length)];
          const x = 20 + rng() * (W - 40);
          const y = 20 + rng() * (H - 70);
          const dark = rng() > 0.3; // 70% "dark" — unclassified in databases
          return { x, y, abundance, col: dark ? '#64748b' : tax.col, dark, tax, r: 0.8 + Math.log10(abundance + 0.001) * 0.4 };
        });

        const frame = () => {
          const sens = sensRef.current;
          ctx.fillStyle = '#0a0015'; ctx.fillRect(0, 0, W, H);

          // Starfield background
          for (let i = 0; i < 200; i++) {
            const sx = (i * 137.5) % W, sy = (i * 97.3) % H;
            ctx.fillStyle = `rgba(255,255,255,${0.02 + (i%7)*0.005})`;
            ctx.fillRect(sx, sy, 1, 1);
          }

          let visible = 0, dark = 0, classified = 0;
          PROTEINS.forEach(p => {
            const detectable = p.abundance * 10000 * sens;
            if (detectable < 0.01) return;
            visible++;
            if (p.dark) dark++; else classified++;
            const alpha = Math.min(1, detectable * 0.4);
            const r = Math.max(0.5, p.r * Math.min(1, detectable * 0.3));

            // Glow for bright proteins
            if (alpha > 0.4 && r > 2) {
              const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r*4);
              g.addColorStop(0, p.col + Math.round(alpha * 60).toString(16).padStart(2,'0'));
              g.addColorStop(1, p.col + '00');
              ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r*4, 0, Math.PI*2); ctx.fill();
            }
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2);
            ctx.fillStyle = p.col + Math.round(alpha * 255).toString(16).padStart(2,'0');
            ctx.fill();
          });

          // Stats overlay
          const pct = (visible / 5000 * 100).toFixed(1);
          const darkPct = visible > 0 ? (dark / visible * 100).toFixed(0) : 0;
          ctx.fillStyle = 'rgba(14,0,24,0.82)';
          ctx.beginPath(); ctx.roundRect(14, H - 58, 340, 52, 8); ctx.fill();
          ctx.fillStyle = '#DAAA00'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(`${pct}% of metaproteome detected  ·  ${visible.toLocaleString()} proteins`, 22, H - 40);
          ctx.fillStyle = '#64748b'; ctx.font = '9px system-ui';
          ctx.fillText(`${classified.toLocaleString()} classified  ·  ${dark.toLocaleString()} dark (unclassified in databases)`, 22, H - 24);
          ctx.fillStyle = '#475569'; ctx.font = 'italic 8px system-ui';
          ctx.fillText(`Sensitivity: ${(sens*100).toFixed(0)}×  ·  Equivalent to uMetaP ${sens > 0.8 ? '5000×' : sens > 0.3 ? '1000×' : sens > 0.1 ? '100×' : '5×'} enrichment`, 22, H - 10);

          // Sensitivity scale
          ctx.fillStyle = '#22d3ee'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'right';
          ctx.fillText(`Sensitivity: ${(sens*100).toFixed(0)}×`, W - 14, 18);

          if (animating || animRef.current) {
            rafRef.current = requestAnimationFrame(frame);
          }
        };

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
      }, [sensitivity, animating]);

      React.useEffect(() => {
        if (!animating) return;
        animRef.current = true;
        let s = sensitivity;
        const iv = setInterval(() => {
          s = Math.min(1, s + 0.008);
          setSensitivity(s);
          sensRef.current = s;
          if (s >= 1) { clearInterval(iv); setAnimating(false); animRef.current = false; }
        }, 50);
        return () => clearInterval(iv);
      }, [animating]);

      return (
        <div className="card" style={{marginBottom:'1rem',border:'1px solid rgba(168,85,247,0.2)',background:'linear-gradient(160deg,rgba(10,0,21,0.99),rgba(1,5,25,0.95))'}}>
          <h3 style={{marginBottom:'0.2rem',background:'linear-gradient(90deg,#a855f7,#60a5fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            ★ Dark Metaproteome Emergence
          </h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.6rem',lineHeight:1.5}}>
            The "dark metaproteome" — proteins from organisms that exist in the sample but evade detection at standard sensitivity.
            As analytical sensitivity increases (uMetaP, deep enrichment), the microbial universe emerges from darkness.
            Grey dots = unclassified proteins with no database match. Drag the slider or click Animate.
          </p>
          <div style={{display:'flex',gap:'0.75rem',alignItems:'center',marginBottom:'0.5rem'}}>
            <input type="range" min={1} max={100} value={Math.round(sensitivity*100)}
              onChange={e => { setSensitivity(e.target.value / 100); setAnimating(false); }}
              style={{flex:1,accentColor:'#a855f7'}}/>
            <button onClick={() => { setSensitivity(0.01); setAnimating(true); }}
              style={{padding:'0.25rem 0.75rem',fontSize:'0.78rem',fontWeight:700,borderRadius:'0.3rem',
                border:'none',cursor:'pointer',background:'rgba(168,85,247,0.2)',color:'#a855f7',flexShrink:0}}>
              ▶ Animate
            </button>
            <button onClick={() => { setSensitivity(0.05); setAnimating(false); }}
              style={{padding:'0.25rem 0.6rem',fontSize:'0.75rem',borderRadius:'0.3rem',
                border:'none',cursor:'pointer',background:'var(--surface)',color:'var(--muted)',flexShrink:0}}>
              Reset
            </button>
          </div>
          <canvas ref={cvRef} width={820} height={380}
            style={{width:'100%',display:'block',borderRadius:'0.4rem'}}/>
          <div style={{marginTop:'0.5rem',fontSize:'0.72rem',color:'#475569',lineHeight:1.7}}>
            Based on the concept of the "microbial dark matter" and deep metaproteomics enrichment strategies (Tanca et al. 2016; Zhang et al. 2018).
            The uMetaP approach achieves 5,000× sensitivity improvement through fractionation and low-input MS2 triggering.
          </div>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 7 (NOVEL): PhyloFunc Terrain — 3D functional diversity landscape
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaPhyloFuncTerrain() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);
      const angleRef = React.useRef(0);

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const rng = mkMetaRng(31415);

        // Build a 28×28 terrain grid
        const GRID = 28;
        const terrain = [];
        for (let gy = 0; gy < GRID; gy++) {
          terrain.push([]);
          for (let gx = 0; gx < GRID; gx++) {
            // Functional diversity "mountains":
            // Peak at (8,8) = Firmicutes functional hub (butyrate, glycolysis)
            // Peak at (20,6) = Bacteroidetes polysaccharide cluster
            // Peak at (14,20) = Proteobacteria stress response
            const d1 = Math.hypot(gx-8, gy-8);
            const d2 = Math.hypot(gx-20, gy-6);
            const d3 = Math.hypot(gx-14, gy-20);
            const d4 = Math.hypot(gx-6, gy-20);
            let h = Math.exp(-d1*d1/18) * 0.9  // Firmicutes peak
                  + Math.exp(-d2*d2/14) * 0.75 // Bacteroidetes peak
                  + Math.exp(-d3*d3/12) * 0.55 // Proteobacteria
                  + Math.exp(-d4*d4/10) * 0.45 // Verrucomicrobia
                  + rng() * 0.1;
            terrain[gy].push(Math.min(1, h));
          }
        }

        const LABELS = [
          {gx:8,  gy:8,  name:'Firmicutes\nhub',       col:'#22c55e'},
          {gx:20, gy:6,  name:'Bacteroidetes\ncluster', col:'#22d3ee'},
          {gx:14, gy:20, name:'Proteobacteria\nstress', col:'#ef4444'},
          {gx:6,  gy:20, name:'Verrucomicrobia',        col:'#a855f7'},
        ];

        // 3D projection parameters
        const CX = W * 0.5, CY = H * 0.42;
        const TILE_W = (W * 0.7) / GRID;
        const TILE_D = (H * 0.45) / GRID;
        const HEIGHT_SCALE = H * 0.28;

        const project = (gx, gy, h, angle) => {
          const rx = (gx - GRID/2) * Math.cos(angle) - (gy - GRID/2) * Math.sin(angle);
          const rz = (gx - GRID/2) * Math.sin(angle) + (gy - GRID/2) * Math.cos(angle);
          return {
            x: CX + rx * TILE_W,
            y: CY + rz * TILE_D - h * HEIGHT_SCALE,
            depth: rz,
          };
        };

        const frame = () => {
          angleRef.current += 0.004;
          const angle = angleRef.current;

          ctx.fillStyle = '#06000f'; ctx.fillRect(0, 0, W, H);

          // Collect all quads sorted by depth
          const quads = [];
          for (let gy = 0; gy < GRID-1; gy++) {
            for (let gx = 0; gx < GRID-1; gx++) {
              const h00 = terrain[gy][gx];
              const h10 = terrain[gy][gx+1];
              const h01 = terrain[gy+1][gx];
              const h11 = terrain[gy+1][gx+1];
              const avgH = (h00+h10+h01+h11)/4;
              const p00 = project(gx,   gy,   h00, angle);
              const p10 = project(gx+1, gy,   h10, angle);
              const p11 = project(gx+1, gy+1, h11, angle);
              const p01 = project(gx,   gy+1, h01, angle);
              const depth = (p00.depth + p10.depth + p11.depth + p01.depth) / 4;
              // Color by height: valley=dark, mid=gold, peak=cyan
              const t = avgH;
              let r, g, b;
              if (t < 0.3) { r=14; g=0; b=24; }
              else if (t < 0.6) {
                const f = (t - 0.3) / 0.3;
                r = Math.round(14 + f * (218-14));
                g = Math.round(0  + f * (170-0));
                b = Math.round(24 + f * (0-24));
              } else {
                const f = (t - 0.6) / 0.4;
                r = Math.round(218 + f * (34-218));
                g = Math.round(170 + f * (211-170));
                b = Math.round(0   + f * (238-0));
              }
              quads.push({ pts:[p00,p10,p11,p01], r, g, b, depth, h:avgH });
            }
          }
          quads.sort((a, b) => b.depth - a.depth);

          quads.forEach(q => {
            ctx.beginPath();
            ctx.moveTo(q.pts[0].x, q.pts[0].y);
            ctx.lineTo(q.pts[1].x, q.pts[1].y);
            ctx.lineTo(q.pts[2].x, q.pts[2].y);
            ctx.lineTo(q.pts[3].x, q.pts[3].y);
            ctx.closePath();
            ctx.fillStyle = `rgba(${q.r},${q.g},${q.b},0.88)`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${q.r},${q.g},${q.b},0.3)`;
            ctx.lineWidth = 0.3; ctx.stroke();
          });

          // Label peaks
          LABELS.forEach(lb => {
            const h = terrain[lb.gy][lb.gx];
            const p = project(lb.gx, lb.gy, h + 0.05, angle);
            ctx.fillStyle = lb.col + 'dd'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center';
            lb.name.split('\n').forEach((line, li) => ctx.fillText(line, p.x, p.y - 8 + li*11));
            ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2);
            ctx.fillStyle = lb.col; ctx.fill();
          });

          // Title
          ctx.fillStyle = '#DAAA00'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left';
          ctx.fillText('PhyloFunc Terrain — Functional Diversity Landscape', 12, 18);
          ctx.fillStyle = '#475569'; ctx.font = '8px system-ui';
          ctx.fillText('x/y axes = phylogenetic PCoA  ·  height = functional diversity index  ·  color = ecosystem function density', 12, 30);

          rafRef.current = requestAnimationFrame(frame);
        };
        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
      }, []);

      return (
        <div className="card" style={{marginBottom:'1rem',border:'1px solid rgba(218,170,0,0.2)'}}>
          <h3 style={{marginBottom:'0.2rem',background:'linear-gradient(90deg,#DAAA00,#22d3ee)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            ★ PhyloFunc Terrain
          </h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.5rem',lineHeight:1.5}}>
            Novel 3D landscape where x/y = phylogenetic distance (PCoA) and height = functional diversity score.
            Peaks are functional hubs — groups of organisms providing disproportionate metabolic richness.
            Valleys are phylogenetic dead zones. The terrain rotates to reveal structure invisible in 2D ordinations.
          </p>
          <canvas ref={cvRef} width={820} height={400}
            style={{width:'100%',display:'block',borderRadius:'0.4rem'}}/>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 8 (OUT OF THIS WORLD): Microbiome Metabolic Cinema
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaCinema() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const rng = mkMetaRng(54321);

        // 12 microbial cells as living organisms
        const MICROBES = [
          {name:'Faecalibacterium', col:'#22c55e',  rx:28, produce:'Butyrate', consume:'Acetate',  x:0,y:0,vx:0,vy:0,energy:0.8},
          {name:'Ruminococcus',     col:'#86efac',  rx:22, produce:'Glucose',  consume:'Cellulose', x:0,y:0,vx:0,vy:0,energy:0.7},
          {name:'Bacteroides',      col:'#22d3ee',  rx:30, produce:'Acetate',  consume:'Polysacc.', x:0,y:0,vx:0,vy:0,energy:0.9},
          {name:'Akkermansia',      col:'#a855f7',  rx:20, produce:'Mucate',   consume:'Mucin',     x:0,y:0,vx:0,vy:0,energy:0.6},
          {name:'Bifidobacterium',  col:'#DAAA00',  rx:20, produce:'Lactate',  consume:'Glucose',   x:0,y:0,vx:0,vy:0,energy:0.75},
          {name:'Lachnospiraceae',  col:'#4ade80',  rx:25, produce:'Butyrate', consume:'Lactate',   x:0,y:0,vx:0,vy:0,energy:0.65},
          {name:'Prevotella',       col:'#67e8f9',  rx:22, produce:'Propionate',consume:'Polysacc.',x:0,y:0,vx:0,vy:0,energy:0.7},
          {name:'Roseburia',        col:'#34d399',  rx:20, produce:'Butyrate', consume:'Acetate',   x:0,y:0,vx:0,vy:0,energy:0.7},
        ];

        // Init positions in a loose cluster
        MICROBES.forEach(m => {
          m.x = W*0.2 + rng() * W*0.6;
          m.y = H*0.2 + rng() * H*0.55;
          m.vx = (rng()-0.5) * 0.35;
          m.vy = (rng()-0.5) * 0.35;
          m.phase = rng() * Math.PI * 2;
          m.glowTimer = 0;
        });

        // Metabolite particles flowing between organisms
        const METABOLITES = {
          Butyrate:   '#22c55e',
          Acetate:    '#60a5fa',
          Glucose:    '#DAAA00',
          Lactate:    '#f97316',
          Propionate: '#22d3ee',
          Mucate:     '#a855f7',
        };

        const particles = [];
        const spawnMetabolite = (fromM, toM, type) => {
          if (particles.length > 180) return;
          particles.push({
            x: fromM.x, y: fromM.y,
            tx: toM.x + (rng()-0.5)*40,
            ty: toM.y + (rng()-0.5)*40,
            col: METABOLITES[type] || '#94a3b8',
            type, alpha: 1, sz: 2 + rng()*1.5,
            prog: 0, speed: 0.006 + rng()*0.008,
            wobble: (rng()-0.5)*0.4,
          });
        };

        // Initial metabolite seeding
        MICROBES.forEach((m, i) => {
          const consumer = MICROBES.find(n => n !== m && n.consume === m.produce);
          if (consumer) for (let k = 0; k < 4; k++) spawnMetabolite(m, consumer, m.produce);
        });

        let t = 0;
        const frame = () => {
          t += 0.016;
          ctx.fillStyle = '#0a0015'; ctx.fillRect(0, 0, W, H);

          // Background — deep space gradient
          const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.7);
          bg.addColorStop(0, 'rgba(14,0,48,0.6)');
          bg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

          // Soft background stars
          for (let i = 0; i < 80; i++) {
            ctx.fillStyle = `rgba(255,255,255,${0.01+0.03*(i%5)/5})`;
            ctx.fillRect((i*97.5)%W, (i*53.3)%H, 1, 1);
          }

          // Move microbes — slow random walk + gentle centering
          MICROBES.forEach(m => {
            m.vx += (rng()-0.5)*0.03 + (W*0.5 - m.x)*0.00015;
            m.vy += (rng()-0.5)*0.03 + (H*0.48 - m.y)*0.00015;
            m.vx *= 0.985; m.vy *= 0.985;
            m.x += m.vx; m.y += m.vy;
            m.x = Math.max(m.rx+10, Math.min(W - m.rx-10, m.x));
            m.y = Math.max(m.rx+10, Math.min(H - m.rx-60, m.y));
            m.glowTimer = Math.max(0, m.glowTimer - 0.016);
          });

          // Spawn new metabolites periodically
          if (Math.random() < 0.18) {
            const m = MICROBES[Math.floor(Math.random() * MICROBES.length)];
            const consumer = MICROBES.find(n => n !== m && n.consume === m.produce);
            if (consumer) {
              spawnMetabolite(m, consumer, m.produce);
              m.glowTimer = 0.4;
            }
          }

          // Update + draw metabolite particles
          for (let i = particles.length-1; i >= 0; i--) {
            const p = particles[i];
            p.prog += p.speed;
            if (p.prog >= 1) { particles.splice(i, 1); continue; }
            // Smooth arc trajectory with wobble
            const ease = p.prog < 0.5 ? 2*p.prog*p.prog : -1+(4-2*p.prog)*p.prog;
            const wx = Math.sin(p.prog * Math.PI * 3 + p.wobble) * 15;
            const wy = Math.cos(p.prog * Math.PI * 2 + p.wobble) * 10;
            const px = p.x + (p.tx - p.x) * ease + wx;
            const py = p.y + (p.ty - p.y) * ease + wy;
            p.alpha = Math.sin(p.prog * Math.PI) * 0.9;
            // Glow
            const g = ctx.createRadialGradient(px, py, 0, px, py, p.sz*3);
            g.addColorStop(0, p.col + Math.round(p.alpha*120).toString(16).padStart(2,'0'));
            g.addColorStop(1, p.col + '00');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, p.sz*3, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(px, py, p.sz, 0, Math.PI*2);
            ctx.fillStyle = p.col + Math.round(p.alpha*255).toString(16).padStart(2,'0');
            ctx.fill();
          }

          // Draw microbes
          MICROBES.forEach((m, mi) => {
            const pulse = 1 + 0.06 * Math.sin(t*1.4 + m.phase);
            const glow = m.glowTimer > 0 ? m.glowTimer / 0.4 : 0;

            // Outer glow
            const radius = m.rx * pulse;
            const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, radius * (2.2 + glow));
            g.addColorStop(0, m.col + Math.round((0.12 + glow*0.25)*255).toString(16).padStart(2,'0'));
            g.addColorStop(1, m.col + '00');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, radius*(2.2+glow), 0, Math.PI*2); ctx.fill();

            // Cell membrane
            ctx.beginPath(); ctx.arc(m.x, m.y, radius, 0, Math.PI*2);
            ctx.fillStyle = 'rgba(14,0,24,0.85)'; ctx.fill();
            ctx.strokeStyle = m.col + (glow > 0 ? 'ff' : 'aa');
            ctx.lineWidth = 1.8 + glow; ctx.stroke();

            // Inner organelle dots
            for (let d = 0; d < 3; d++) {
              const da = t*0.8 + d * Math.PI*2/3 + m.phase;
              const dr = radius * 0.38;
              ctx.beginPath(); ctx.arc(m.x + Math.cos(da)*dr, m.y + Math.sin(da)*dr, 2.2, 0, Math.PI*2);
              ctx.fillStyle = m.col + '88'; ctx.fill();
            }

            // Label
            ctx.fillStyle = m.col; ctx.font = 'bold 7.5px system-ui'; ctx.textAlign = 'center';
            ctx.fillText(m.name.split(' ')[0], m.x, m.y + radius + 10);
            ctx.fillStyle = m.col + '66'; ctx.font = '6.5px system-ui';
            ctx.fillText(`→ ${m.produce}`, m.x, m.y + radius + 20);
          });

          // Metabolite legend (bottom right)
          const LX = W - 130, LY = H - 95;
          ctx.fillStyle = 'rgba(14,0,24,0.8)'; ctx.beginPath(); ctx.roundRect(LX-8,LY-10,130,98,6); ctx.fill();
          ctx.fillStyle = '#64748b'; ctx.font = 'bold 7.5px system-ui'; ctx.textAlign = 'left';
          ctx.fillText('Metabolites', LX, LY+2);
          Object.entries(METABOLITES).slice(0,6).forEach(([name, col], i) => {
            ctx.beginPath(); ctx.arc(LX+5, LY+15+i*13, 3.5, 0, Math.PI*2);
            ctx.fillStyle = col; ctx.fill();
            ctx.fillStyle = '#94a3b8'; ctx.font = '7px system-ui';
            ctx.fillText(name, LX+14, LY+19+i*13);
          });

          rafRef.current = requestAnimationFrame(frame);
        };

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
      }, []);

      return (
        <div className="card" style={{marginBottom:'1rem',border:'1px solid rgba(168,85,247,0.3)',background:'linear-gradient(160deg,rgba(10,0,21,0.99),rgba(0,5,30,0.97))'}}>
          <h3 style={{marginBottom:'0.2rem',background:'linear-gradient(90deg,#d946ef,#a855f7,#22d3ee)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            ★★ Microbiome Metabolic Cinema
          </h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.5rem',lineHeight:1.5}}>
            Live animated ecosystem. Each glowing cell is a microbial species; colored particles are metabolites flowing between producers and consumers.
            Watch butyrate, acetate, and lactate shuttle between organisms in real time — the microbiome as a living city, not a static bar chart.
          </p>
          <canvas ref={cvRef} width={820} height={440}
            style={{width:'100%',display:'block',borderRadius:'0.4rem'}}/>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Panel 9 (OUT OF THIS WORLD): 4D Metaproteomic Ion Globe
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaIonGlobe() {
      const cvRef = React.useRef(null);
      const rafRef = React.useRef(null);
      const [hovTax, setHovTax] = React.useState(null);

      React.useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const rng = mkMetaRng(99991);
        const CX = W * 0.52, CY = H * 0.5;
        const R = Math.min(W, H) * 0.36;

        // Generate ~280 proteins distributed on sphere surface
        // using Fibonacci lattice for uniform distribution
        const N = 280;
        const PROTEINS = Array.from({length: N}, (_, i) => {
          const phi = Math.acos(1 - 2*(i+0.5)/N);
          const theta = Math.PI * (1 + Math.sqrt(5)) * i;
          const tax = META_TAXA[Math.floor(rng() * META_TAXA.length)];
          const abundance = 0.3 + rng() * 0.7;
          // Cluster by taxon: offset lat/lon slightly per taxon
          const taxOffset = META_TAXA.indexOf(tax) * 0.3;
          const fPhi = (phi + taxOffset * 0.5) % Math.PI;
          const fTheta = (theta + taxOffset * 2) % (Math.PI*2);
          return {phi:fPhi, theta:fTheta, tax, abundance, r: 2.2 + abundance * 3};
        });

        let angle = 0;

        const frame = () => {
          angle += 0.006;
          ctx.fillStyle = '#060010'; ctx.fillRect(0, 0, W, H);

          // Globe base glow
          const gg = ctx.createRadialGradient(CX, CY, 0, CX, CY, R*1.15);
          gg.addColorStop(0, 'rgba(168,85,247,0.07)');
          gg.addColorStop(0.7,'rgba(34,211,238,0.03)');
          gg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(CX, CY, R*1.15, 0, Math.PI*2); ctx.fill();

          // Globe wireframe (latitude/longitude lines)
          ctx.strokeStyle = 'rgba(168,85,247,0.12)'; ctx.lineWidth = 0.5;
          // Latitude circles
          for (let lat = -60; lat <= 60; lat += 30) {
            const y0 = CY + Math.sin(lat * Math.PI/180) * R;
            const rx = Math.cos(lat * Math.PI/180) * R;
            ctx.beginPath(); ctx.ellipse(CX, y0, rx, rx*0.08, 0, 0, Math.PI*2); ctx.stroke();
          }
          // Longitude lines
          for (let lon = 0; lon < 360; lon += 45) {
            const a = (lon + angle * 180/Math.PI) * Math.PI/180;
            ctx.beginPath();
            for (let lat2 = -90; lat2 <= 90; lat2 += 5) {
              const phi2 = (90 - lat2) * Math.PI/180;
              const theta2 = a;
              const x3d = Math.sin(phi2)*Math.cos(theta2)*R;
              const z3d = Math.cos(phi2)*R;
              const px = CX + x3d;
              const py = CY - z3d;
              lat2 === -90 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
            }
            ctx.stroke();
          }

          // Sort proteins by depth (z coordinate)
          const rendered = PROTEINS.map(p => {
            const phi2 = p.phi;
            const theta2 = p.theta + angle;
            const x3d = Math.sin(phi2)*Math.cos(theta2)*R;
            const y3d = Math.sin(phi2)*Math.sin(theta2)*R;
            const z3d = Math.cos(phi2)*R;
            const depth = y3d; // + is near side
            const sx = CX + x3d;
            const sy = CY - z3d;
            const onFront = depth > -R * 0.1;
            return {...p, sx, sy, depth, onFront};
          }).sort((a,b) => a.depth - b.depth);

          // Draw back-side proteins (dimmed)
          rendered.filter(p => !p.onFront).forEach(p => {
            const alpha = 0.08 + (p.depth + R) / (2*R) * 0.1;
            ctx.beginPath(); ctx.arc(p.sx, p.sy, p.r * 0.6, 0, Math.PI*2);
            ctx.fillStyle = p.tax.col + Math.round(alpha*255).toString(16).padStart(2,'0');
            ctx.fill();
          });

          // Globe outline
          ctx.strokeStyle = 'rgba(168,85,247,0.25)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI*2); ctx.stroke();

          // Front proteins
          rendered.filter(p => p.onFront).forEach(p => {
            const depthFactor = (p.depth + R) / (2*R);
            const alpha = 0.4 + depthFactor * 0.6;
            const r = p.r * (0.7 + depthFactor * 0.5);
            const isHovTax = hovTax === META_TAXA.indexOf(p.tax);

            // Glow
            const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r*3.5);
            g.addColorStop(0, p.tax.col + Math.round(alpha*80).toString(16).padStart(2,'0'));
            g.addColorStop(1, p.tax.col + '00');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.sx, p.sy, r*3.5, 0, Math.PI*2); ctx.fill();

            ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI*2);
            ctx.fillStyle = p.tax.col + Math.round(alpha*(isHovTax?1.0:0.85)*255).toString(16).padStart(2,'0');
            ctx.fill();
          });

          // Labels for taxon clusters — project centroid
          META_TAXA.forEach((tax, ti) => {
            const taxProteins = rendered.filter(p => p.tax === tax && p.onFront);
            if (taxProteins.length === 0) return;
            const cx2 = taxProteins.reduce((a,p)=>a+p.sx,0)/taxProteins.length;
            const cy2 = taxProteins.reduce((a,p)=>a+p.sy,0)/taxProteins.length;
            const deepest = taxProteins.reduce((a,p)=>p.depth>a.depth?p:a, taxProteins[0]);
            if (deepest.depth < R * 0.3) return;
            ctx.fillStyle = tax.col + 'cc'; ctx.font = 'bold 7.5px system-ui'; ctx.textAlign = 'center';
            ctx.fillText(tax.name, cx2, cy2 - deepest.r - 4);
          });

          // Legend (left panel)
          const LX = 14, LY = 50;
          ctx.fillStyle = 'rgba(14,0,24,0.85)';
          ctx.beginPath(); ctx.roundRect(LX-4, LY-20, 145, META_TAXA.length*18+30, 8); ctx.fill();
          ctx.fillStyle = '#64748b'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'left';
          ctx.fillText('Taxonomic origin', LX+2, LY-4);
          META_TAXA.forEach((tax, i) => {
            const isHov = hovTax === i;
            ctx.beginPath(); ctx.arc(LX+7, LY+10+i*18, isHov ? 6 : 4.5, 0, Math.PI*2);
            ctx.fillStyle = tax.col + (isHov ? 'ff' : 'cc'); ctx.fill();
            ctx.fillStyle = isHov ? tax.col : '#94a3b8'; ctx.font = `${isHov?'bold ':''}7.5px system-ui`;
            ctx.fillText(tax.name, LX+18, LY+14+i*18);
          });

          // Title
          ctx.fillStyle = '#a855f7'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'right';
          ctx.fillText('4D Metaproteomic Ion Globe', W-14, 18);
          ctx.fillStyle = '#475569'; ctx.font = '8px system-ui';
          ctx.fillText('Position = phylogeny + CCS  ·  Size = abundance  ·  Color = taxonomy', W-14, 30);

          rafRef.current = requestAnimationFrame(frame);
        };

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
      }, [hovTax]);

      return (
        <div className="card" style={{marginBottom:'1rem',border:'1px solid rgba(168,85,247,0.35)',background:'linear-gradient(160deg,rgba(6,0,16,0.99),rgba(0,0,20,0.98))'}}>
          <h3 style={{marginBottom:'0.2rem',background:'linear-gradient(90deg,#a855f7,#d946ef,#60a5fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            ★★ 4D Metaproteomic Ion Globe
          </h3>
          <p style={{color:'var(--muted)',fontSize:'0.76rem',marginBottom:'0.5rem',lineHeight:1.5}}>
            Every protein family in the metagenome, plotted on a sphere whose surface encodes phylogenetic + ion mobility position.
            Size = protein abundance. Color = taxonomic origin. The globe rotates to show how different organisms' proteomes
            occupy distinct structural niches in 4D space — a portrait of the invisible ecosystem.
          </p>
          <div style={{display:'flex',flexWrap:'wrap',gap:'0.35rem',marginBottom:'0.5rem'}}>
            {META_TAXA.map((t, i) => (
              <button key={t.name} onMouseEnter={() => setHovTax(i)} onMouseLeave={() => setHovTax(null)}
                style={{padding:'0.15rem 0.5rem',fontSize:'0.68rem',fontWeight:600,borderRadius:'0.3rem',border:`1px solid ${t.col}44`,
                  background: hovTax===i ? t.col+'22' : 'transparent', color:t.col, cursor:'default'}}>
                {t.name}
              </button>
            ))}
          </div>
          <canvas ref={cvRef} width={820} height={420}
            style={{width:'100%',display:'block',borderRadius:'0.4rem'}}/>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // Main MetaproteomicsTab
    // ══════════════════════════════════════════════════════════════════════════════
    function MetaproteomicsTab() {
      const [view, setView] = React.useState('overview');

      const VIEWS = [
        {group:'Standard', items:[
          ['biplot',     '⊕ Biplot'],
          ['cog',        '⊞ COG Landscape'],
          ['network',    '⬡ Co-Abundance Network'],
          ['redundancy', '⊟ Redundancy Heatmap'],
        ]},
        {group:'Novel', items:[
          ['handoff',    '★ Metabolic Handoff'],
          ['emergence',  '★ Dark Metaproteome'],
          ['terrain',    '★ PhyloFunc Terrain'],
        ]},
        {group:'Out of this world', items:[
          ['cinema',     '★★ Metabolic Cinema'],
          ['globe',      '★★ Ion Globe'],
        ]},
      ];

      return (
        <div>
          {/* Header */}
          <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(135deg,rgba(14,0,24,0.98),rgba(1,15,35,0.92))',border:'1px solid rgba(34,211,238,0.18)'}}>
            <h3 style={{marginBottom:'0.3rem',background:'linear-gradient(90deg,#22d3ee,#DAAA00,#a855f7)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',fontSize:'1.05rem'}}>
              Metaproteomics — The Proteome of Ecosystems
            </h3>
            <p style={{color:'#94a3b8',fontSize:'0.8rem',lineHeight:1.7,marginBottom:'0.5rem'}}>
              Metaproteomics identifies and quantifies proteins directly from complex microbial communities — no culturing, no single-species isolation.
              Unlike metagenomics (DNA) or metatranscriptomics (RNA), it captures <strong style={{color:'#DAAA00'}}>what the community is actually doing</strong> right now.
              timsTOF ion mobility separates isobaric microbial peptides that Orbitrap alone cannot resolve.
            </p>
            <div style={{display:'flex',flexWrap:'wrap',gap:'0.5rem',fontSize:'0.72rem',color:'#475569'}}>
              {[
                ['Demo data','8-sample gut IBD cohort (Kleiner et al. 2017 framework)'],
                ['Reference taxa','10 key gut commensals (Firmicutes, Bacteroidetes, Verrucomicrobia)'],
                ['Proteins modeled','~280 protein families across 12 COG categories'],
                ['Upload coming soon','Drag & drop your DIA-NN report.parquet for real community analysis'],
              ].map(([k,v]) => (
                <span key={k} style={{padding:'0.2rem 0.5rem',background:'rgba(255,255,255,0.04)',borderRadius:'0.3rem'}}>
                  <strong style={{color:'#64748b'}}>{k}:</strong> {v}
                </span>
              ))}
            </div>
          </div>

          {/* Tab selector */}
          <div style={{marginBottom:'1rem'}}>
            {VIEWS.map(grp => (
              <div key={grp.group} style={{marginBottom:'0.4rem',display:'flex',alignItems:'center',gap:'0.4rem',flexWrap:'wrap'}}>
                <span style={{fontSize:'0.67rem',fontWeight:700,color:'#475569',letterSpacing:'0.1em',
                  textTransform:'uppercase',minWidth:'90px',textAlign:'right',flexShrink:0}}>
                  {grp.group}
                </span>
                {grp.items.map(([k,l]) => (
                  <button key={k} onClick={() => setView(k)}
                    style={{padding:'0.28rem 0.7rem',borderRadius:'0.4rem',border:'none',cursor:'pointer',
                      fontWeight:600,fontSize:'0.79rem',
                      background: view===k ? 'var(--accent)' : 'var(--surface)',
                      color: view===k ? 'var(--bg)' : 'var(--muted)'}}>
                    {l}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Panels */}
          {view === 'biplot'     && <MetaBiplot/>}
          {view === 'cog'        && <MetaCOGLandscape/>}
          {view === 'network'    && <MetaNetwork/>}
          {view === 'redundancy' && <MetaRedundancy/>}
          {view === 'handoff'    && <MetaHandoff/>}
          {view === 'emergence'  && <MetaDarkEmergence/>}
          {view === 'terrain'    && <MetaPhyloFuncTerrain/>}
          {view === 'cinema'     && <MetaCinema/>}
          {view === 'globe'      && <MetaIonGlobe/>}

          {/* Reference footer */}
          <div className="card" style={{marginTop:'0.5rem',padding:'0.6rem 0.9rem',background:'rgba(0,0,0,0.3)',border:'1px solid rgba(255,255,255,0.05)'}}>
            <div style={{fontSize:'0.71rem',color:'#374151',lineHeight:1.8}}>
              <strong style={{color:'#475569'}}>References:</strong>{' '}
              Kleiner et al. <em>Nat Methods</em> 2017 (benchmarking) ·
              Tanca et al. <em>Microbiome</em> 2016 (gut metaproteomics) ·
              Rechenberger et al. <em>J Proteome Res</em> 2019 (SIHUMI community) ·
              Zhang et al. <em>Nat Commun</em> 2018 (IBD metaproteomics) ·
              Petriz &amp; Franco <em>Front Microbiol</em> 2017 (exercise microbiome) ·
              Herbst et al. <em>Mol Syst Biol</em> 2024 (timsTOF metaproteomics)
            </div>
          </div>
        </div>
      );
    }
