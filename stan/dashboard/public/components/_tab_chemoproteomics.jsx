    /* ── Chemoproteomics Tab ─────────────────────────────────────────── */

    // ── Seeded RNG (Mulberry32) for consistent demo data ─────────────
    function _mulberry32(seed) {
      return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    function _randNorm(rng, mu=0, sigma=1) {
      // Box-Muller
      const u = 1 - rng(), v = rng();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // ── ABPP demo data (isoTOP / dual-probe cysteine profiling) ───────
    function _generateABPPDemo() {
      const rng = _mulberry32(42);
      const rows = [];

      // Known EGFR-family hit sites
      const KNOWN_HITS = [
        { gene:'EGFR',  protein:'P00533', site:'C797', peptide:'LGQGCFGEVWMGTWNGTTR',  log2R: 3.8,  pv: 6.2, label:'EGFR C797 (AZD9291 target)' },
        { gene:'EGFR',  protein:'P00533', site:'C805', peptide:'DPTQGDSFQAELCR',       log2R: 2.1,  pv: 4.4, label:'EGFR C805 (off-cysteine)' },
        { gene:'ERBB2', protein:'P04626', site:'C805', peptide:'LGEGAFGTVYK',           log2R: 1.9,  pv: 3.8, label:'HER2 C805' },
        { gene:'BTK',   protein:'Q06187', site:'C481', peptide:'VKDLIEQSGEVGK',        log2R: 3.2,  pv: 5.5, label:'BTK C481 (ibrutinib target)' },
        { gene:'JAK3',  protein:'P52333', site:'C909', peptide:'YQKPHGCFVKPLTK',       log2R: 2.7,  pv: 4.9, label:'JAK3 C909' },
        { gene:'KEAP1', protein:'Q14145', site:'C273', peptide:'QSICSVLENFGK',         log2R: 2.4,  pv: 4.3, label:'KEAP1 C273' },
        { gene:'GAPDH', protein:'P04406', site:'C152', peptide:'IISNASCTTNCLAPLAK',    log2R:-0.2,  pv: 0.4, label:'GAPDH C152 (common off-target)' },
        { gene:'ACT1',  protein:'P60709', site:'C374', peptide:'VAPEEHPVLLTEAPLNPK',   log2R: 0.1,  pv: 0.2, label:'Actin C374 (stable)' },
      ];

      // Background: ~500 uninhibited cysteines
      const GENES_BG = ['HSPA1A','HSP90AA1','TUB1A','VIM','PKM','LDHA','ENO1','GRP78',
        'PRDX1','TPI1','PGAM1','HNRNPA1','PCNA','YWHAZ','EIF4A1','SFPQ','FUS','HNRNPC',
        'RPS3','RPL5','NPM1','HIST1H2AB','TOP2A','ACTB','TUBB','LMNA','KRAS','NRAS',
        'BRAF','MAP2K1','AKT1','PIK3CA','PTEN','TP53','CDK2','CCND1','RB1','MYC',
        'MAX','SRC','ABL1','FYN','LCK','ZAP70','STAT3','STAT5A','NFkB1','RELA'];
      for (let i = 0; i < 520; i++) {
        const gene = GENES_BG[i % GENES_BG.length] + (i > GENES_BG.length ? `_${Math.floor(i/GENES_BG.length)}` : '');
        const log2R = _randNorm(rng, 0, 0.35);
        const pv    = Math.max(0.05, _randNorm(rng, 1.2, 0.6));
        const siteNum = 50 + Math.floor(rng() * 900);
        rows.push({ gene, site:`C${siteNum}`, log2R: +log2R.toFixed(3), pv: +pv.toFixed(3), isHit: false, label: null });
      }

      // Add known hits
      for (const h of KNOWN_HITS) {
        rows.push({ gene: h.gene, site: h.site, log2R: h.log2R, pv: h.pv, isHit: h.log2R > 1.5, label: h.label });
      }

      return rows;
    }

    // ── μMap demo data (proximity labeling enrichment) ────────────────
    function _generateMuMapDemo() {
      const rng = _mulberry32(99);
      const rows = [];

      // Bait: EGFR — its known proximal neighbors (inner complex, ~4 nm)
      const KNOWN_PROXIMAL = [
        { gene:'EGFR',   log2fc:6.8, pv:8.2, ux:-1.2, uy:2.8, loc:'Plasma membrane',   layer:'bait' },
        { gene:'ERBB2',  log2fc:4.1, pv:6.9, ux:-0.4, uy:2.1, loc:'Plasma membrane',   layer:'near' },
        { gene:'ERBB3',  log2fc:3.8, pv:6.1, ux: 0.3, uy:1.9, loc:'Plasma membrane',   layer:'near' },
        { gene:'GRB2',   log2fc:3.2, pv:5.8, ux: 0.8, uy:1.5, loc:'Cytoplasm',         layer:'near' },
        { gene:'SHC1',   log2fc:3.0, pv:5.4, ux: 1.2, uy:1.2, loc:'Cytoplasm',         layer:'near' },
        { gene:'SOS1',   log2fc:2.8, pv:5.0, ux: 1.6, uy:0.8, loc:'Cytoplasm',         layer:'near' },
        { gene:'GAB1',   log2fc:2.5, pv:4.8, ux: 2.0, uy:0.5, loc:'Cytoplasm',         layer:'near' },
        { gene:'CBL',    log2fc:2.4, pv:4.5, ux: 2.3, uy:0.2, loc:'Cytoplasm',         layer:'near' },
        { gene:'CRKL',   log2fc:2.2, pv:4.1, ux: 2.6, uy:-0.2, loc:'Cytoplasm',        layer:'near' },
        { gene:'PIK3R1', log2fc:2.0, pv:3.9, ux: 2.8, uy:-0.6, loc:'Cytoplasm',        layer:'mid' },
        { gene:'PIK3CA', log2fc:1.8, pv:3.5, ux: 3.0, uy:-1.0, loc:'Cytoplasm',        layer:'mid' },
        { gene:'AKT1',   log2fc:1.5, pv:3.1, ux: 3.2, uy:-1.5, loc:'Cytoplasm',        layer:'mid' },
        { gene:'KRAS',   log2fc:1.4, pv:2.8, ux: 1.5, uy:-2.0, loc:'Plasma membrane',  layer:'mid' },
        { gene:'BRAF',   log2fc:1.2, pv:2.5, ux: 1.0, uy:-2.5, loc:'Cytoplasm',        layer:'mid' },
        { gene:'MAP2K1', log2fc:1.0, pv:2.2, ux: 0.4, uy:-2.8, loc:'Cytoplasm',        layer:'mid' },
        { gene:'MAPK3',  log2fc:0.9, pv:2.0, ux:-0.3, uy:-3.0, loc:'Nucleus/Cytoplasm',layer:'far' },
        { gene:'MUC4',   log2fc:1.9, pv:3.7, ux:-0.9, uy:3.2, loc:'Plasma membrane',   layer:'near' },
        { gene:'CD44',   log2fc:1.7, pv:3.3, ux:-1.5, uy:3.5, loc:'Plasma membrane',   layer:'near' },
        { gene:'ITGB1',  log2fc:1.6, pv:3.0, ux:-2.1, uy:3.1, loc:'Plasma membrane',   layer:'mid' },
        { gene:'CAV1',   log2fc:2.1, pv:4.0, ux:-2.5, uy:2.5, loc:'Plasma membrane',   layer:'near' },
        { gene:'FLOT1',  log2fc:1.8, pv:3.4, ux:-3.0, uy:1.8, loc:'Plasma membrane',   layer:'near' },
        { gene:'FLOT2',  log2fc:1.7, pv:3.2, ux:-3.3, uy:1.0, loc:'Plasma membrane',   layer:'mid' },
      ];

      // Background proteins (nucleus, secreted, unrelated)
      const BG_GENES  = ['HIST1H2AB','H2AFX','TOP2A','PCNA','NPM1','NUP98','LMNA','SP1',
        'RPLP0','RPS3','RPS6','EIF4G1','HSPA5','CANX','CALR','P4HB','PDIA3',
        'ACTN1','ACTN4','VIM','FLNB','TLN1','PXN','FAK1','VASP','LIMK1',
        'DYNCH1','KIF5B','MYH9','MYH10','MYL6','TPM1','TUBB','TUBA1A',
        'ALDOA','GAPDH','PKM','PGAM1','ENO1','LDHA','MDH2','SDHA',
        'VDAC1','VDAC2','TOMM20','TOMM40','ANT1','ATP5B','COX4','CYTC'];
      const BG_LOCS   = ['Nucleus','Cytoplasm','ER','Mitochondria','Cytoskeleton'];

      for (let i = 0; i < 280; i++) {
        const gene = BG_GENES[i % BG_GENES.length];
        const log2fc = _randNorm(rng, 0, 0.4);
        const pv = Math.max(0.05, _randNorm(rng, 1.0, 0.5));
        // UMAP: scattered away from EGFR cluster
        const angle = rng() * Math.PI * 2;
        const dist  = 4 + rng() * 6;
        rows.push({
          gene: gene + (i >= BG_GENES.length ? `_${i}` : ''),
          log2fc: +log2fc.toFixed(3),
          pv:  +pv.toFixed(3),
          ux:  +(Math.cos(angle) * dist).toFixed(2),
          uy:  +(Math.sin(angle) * dist).toFixed(2),
          loc: BG_LOCS[Math.floor(rng() * BG_LOCS.length)],
          layer: 'bg',
          isKnown: false,
        });
      }

      for (const h of KNOWN_PROXIMAL) {
        rows.push({ ...h, isKnown: true });
      }

      return rows;
    }

    // ── Colour helpers ────────────────────────────────────────────────
    const LOC_COLORS = {
      'Plasma membrane': '#22d3ee',
      'Cytoplasm':       '#34d399',
      'Nucleus':         '#a855f7',
      'Nucleus/Cytoplasm': '#c084fc',
      'ER':              '#f97316',
      'Mitochondria':    '#fbbf24',
      'Cytoskeleton':    '#64748b',
      'Secreted':        '#e2e8f0',
    };
    function locColor(loc) {
      for (const [k, v] of Object.entries(LOC_COLORS)) if ((loc||'').includes(k.split('/')[0])) return v;
      return '#64748b';
    }

    // ── CSV parser (browser-side, comma or tab) ───────────────────────
    function parseCSV(text) {
      const lines  = text.trim().split(/\r?\n/);
      const sep    = lines[0].includes('\t') ? '\t' : ',';
      const header = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/[ .]/g,'_'));
      return lines.slice(1).filter(l => l.trim()).map(l => {
        const vals = l.split(sep);
        const obj  = {};
        header.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i].trim() : ''; });
        return obj;
      });
    }

    // ── Main component ────────────────────────────────────────────────
    function ChemoproteomicsTab() {
      const [mode, setMode]             = useState('abpp');  // 'abpp' | 'mumap'
      const [abppData, setAbppData]     = useState(() => _generateABPPDemo());
      const [mumapData, setMumapData]   = useState(() => _generateMuMapDemo());
      const [csvText, setCsvText]       = useState('');
      const [showImport, setShowImport] = useState(false);
      const [importError, setImportError] = useState('');

      // ABPP controls
      const [abppLog2Cut, setAbppLog2Cut]   = useState(1.5);
      const [abppPvCut,   setAbppPvCut]     = useState(3.0);
      const [abppColorBy, setAbppColorBy]   = useState('hit');  // 'hit' | 'gene'
      const [selSite, setSelSite]           = useState(null);

      // μMap controls
      const [mumapLog2Cut, setMumapLog2Cut] = useState(1.0);
      const [mumapPvCut,   setMumapPvCut]   = useState(2.0);
      const [mumapView,    setMumapView]    = useState('volcano');  // 'volcano' | 'umap' | 'radial'
      const [selProtein,   setSelProtein]   = useState(null);
      const [showDistRings, setShowDistRings] = useState(true);

      const abppVolcRef  = useRef(null);
      const abppSiteRef  = useRef(null);
      const mumapVolcRef = useRef(null);
      const mumapUmapRef = useRef(null);
      const mumapRadRef  = useRef(null);

      // ── ABPP Volcano ─────────────────────────────────────────────────
      useEffect(() => {
        if (mode !== 'abpp' || !abppVolcRef.current) return;
        const hits = abppData.filter(d => d.log2R >= abppLog2Cut && d.pv >= abppPvCut);
        const bg   = abppData.filter(d => !(d.log2R >= abppLog2Cut && d.pv >= abppPvCut));

        const mkTrace = (pts, name, col, sym='circle', size=5) => ({
          type: 'scatter', mode: 'markers', name,
          x: pts.map(d => d.log2R),
          y: pts.map(d => d.pv),
          text: pts.map(d => `${d.gene} ${d.site}${d.label ? `<br>${d.label}` : ''}`),
          hovertemplate: '%{text}<br>log₂R: %{x:.2f}<br>-log₁₀p: %{y:.2f}<extra></extra>',
          marker: { color: col, size, symbol: sym, opacity: sym === 'circle' ? 0.55 : 0.9,
                    line: { color: 'rgba(0,0,0,0.3)', width: 0.5 } },
        });

        const labelled = abppData.filter(d => d.label);
        const labelTrace = {
          type: 'scatter', mode: 'markers+text', name: 'Named sites', showlegend: false,
          x: labelled.map(d => d.log2R), y: labelled.map(d => d.pv),
          text: labelled.map(d => d.gene),
          textposition: 'top center',
          textfont: { size: 9, color: '#DAAA00' },
          hovertemplate: '%{customdata}<br>log₂R: %{x:.2f}<br>-log₁₀p: %{y:.2f}<extra></extra>',
          customdata: labelled.map(d => d.label || ''),
          marker: { color: labelled.map(d => d.log2R > 1.5 ? '#DAAA00' : '#64748b'),
                    size: 9, symbol: 'diamond', line: { color: '#fff', width: 0.8 } },
        };

        const shapes = [
          { type:'line', x0: abppLog2Cut, x1: abppLog2Cut, y0: 0, y1: 1, yref:'paper',
            line: { color: '#DAAA0066', width: 1, dash:'dot' } },
          { type:'line', x0: -abppLog2Cut, x1: -abppLog2Cut, y0: 0, y1: 1, yref:'paper',
            line: { color: '#22d3ee44', width: 1, dash:'dot' } },
          { type:'line', x0:-6, x1:6, y0: abppPvCut, y1: abppPvCut, xref:'paper',
            line: { color: '#a855f744', width: 1, dash:'dot' } },
        ];

        window.Plotly.react(abppVolcRef.current, [
          mkTrace(bg, 'Background', '#3d1060', 'circle', 4),
          mkTrace(hits, 'Hit sites', '#DAAA00', 'circle', 6),
          labelTrace,
        ], {
          paper_bgcolor:'transparent', plot_bgcolor:'#0a0018',
          font: { color:'#94a3b8', family:'monospace', size:11 },
          xaxis: { title:{ text:'log₂(R ratio)  ─  drug engaged →', font:{color:'#DAAA00',size:12} },
                   gridcolor:'#1a003066', color:'#64748b', zeroline:true, zerolinecolor:'#3d1060' },
          yaxis: { title:{ text:'-log₁₀(p-value)', font:{color:'#a855f7',size:12} },
                   gridcolor:'#1a003066', color:'#64748b' },
          legend: { bgcolor:'rgba(0,0,0,0.6)', bordercolor:'#3d1060', borderwidth:1,
                    font:{size:10}, x:0, y:1, xanchor:'left' },
          shapes,
          annotations: [
            { x: abppLog2Cut+0.1, y:0.98, xref:'x', yref:'paper', text:`${hits.length} hits`,
              font:{color:'#DAAA00',size:10}, showarrow:false, xanchor:'left' },
          ],
          margin:{ t:10, b:50, l:55, r:12 },
        }, { responsive:true, displayModeBar:false });
      }, [mode, abppData, abppLog2Cut, abppPvCut]);

      // ── ABPP Cysteine Reactivity Landscape ─────────────────────────
      // Shows all sites as bubble chart: x = log2R, y = site index sorted by prot MW proxy
      useEffect(() => {
        if (mode !== 'abpp' || !abppSiteRef.current) return;
        const sorted = [...abppData].sort((a,b) => a.gene.localeCompare(b.gene));
        const NBINS = 20;
        // Bin by log2R into a heatmap proxy: gene vs reactivity bucket
        // For now: just a density histogram
        const lo = -2, hi = 6, step = (hi-lo)/NBINS;
        const hist = Array(NBINS).fill(0);
        sorted.forEach(d => {
          const i = Math.min(NBINS-1, Math.max(0, Math.floor((d.log2R - lo) / step)));
          hist[i]++;
        });
        const binLabels = hist.map((_, i) => +((lo + (i+0.5)*step).toFixed(2)));

        window.Plotly.react(abppSiteRef.current, [{
          type: 'bar',
          x: binLabels,
          y: hist,
          marker: {
            color: binLabels.map(v => {
              const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
              const r = Math.round(61 + t*(218-61));
              const g = Math.round(16  + t*(170-16));
              const b = Math.round(96  + t*(0-96));
              return `rgb(${r},${g},${b})`;
            }),
          },
          hovertemplate: 'log₂R ≈ %{x:.2f}<br>Sites: %{y}<extra></extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'#0a0018',
          font:{ color:'#94a3b8', family:'monospace', size:11 },
          xaxis:{ title:{ text:'log₂(R ratio)', font:{color:'#DAAA00',size:11} },
                  gridcolor:'#1a003066', color:'#64748b' },
          yaxis:{ title:{ text:'# sites', font:{color:'#a855f7',size:11} },
                  gridcolor:'#1a003066', color:'#64748b' },
          shapes:[{ type:'line', x0:abppLog2Cut, x1:abppLog2Cut, y0:0, y1:1, yref:'paper',
                    line:{color:'#DAAA00',width:1.5,dash:'dot'} }],
          margin:{ t:8, b:46, l:48, r:8 },
        }, { responsive:true, displayModeBar:false });
      }, [mode, abppData, abppLog2Cut]);

      // ── μMap Volcano ─────────────────────────────────────────────────
      useEffect(() => {
        if (mode !== 'mumap' || mumapView !== 'volcano' || !mumapVolcRef.current) return;
        const hits = mumapData.filter(d => d.log2fc >= mumapLog2Cut && d.pv >= mumapPvCut);
        const bg   = mumapData.filter(d => !(d.log2fc >= mumapLog2Cut && d.pv >= mumapPvCut));

        const locGroups = {};
        hits.forEach(d => {
          const k = d.loc || 'Unknown';
          if (!locGroups[k]) locGroups[k] = [];
          locGroups[k].push(d);
        });

        const traces = [];
        // Background
        traces.push({
          type:'scatter', mode:'markers', name:'Background',
          x: bg.map(d=>d.log2fc), y: bg.map(d=>d.pv),
          text: bg.map(d=>d.gene),
          hovertemplate:'%{text}<br>log₂FC: %{x:.2f}<br>-log₁₀p: %{y:.2f}<extra></extra>',
          marker:{ color:'#3d1060', size:4, opacity:0.45 },
        });
        // Hits coloured by localisation
        for (const [loc, pts] of Object.entries(locGroups)) {
          traces.push({
            type:'scatter', mode:'markers', name: loc,
            x: pts.map(d=>d.log2fc), y: pts.map(d=>d.pv),
            text: pts.map(d=>`${d.gene}<br>${loc}`),
            hovertemplate:'%{text}<br>log₂FC: %{x:.2f}<br>-log₁₀p: %{y:.2f}<extra></extra>',
            marker:{ color: locColor(loc), size:7, opacity:0.85,
                     line:{color:'rgba(255,255,255,0.3)',width:0.8} },
          });
        }
        // Label bait + top hits
        const labelled = mumapData.filter(d => d.layer === 'bait' || (d.isKnown && d.pv > 3));
        traces.push({
          type:'scatter', mode:'markers+text', name:'', showlegend:false,
          x: labelled.map(d=>d.log2fc), y: labelled.map(d=>d.pv),
          text: labelled.map(d=>d.gene),
          textposition:'top center', textfont:{size:9,color:'#DAAA00'},
          hovertemplate:'%{text}<br>log₂FC: %{x:.2f}<extra></extra>',
          marker:{ color: labelled.map(d=>d.layer==='bait'?'#DAAA00':'#22d3ee'),
                   size: labelled.map(d=>d.layer==='bait'?13:8),
                   symbol: labelled.map(d=>d.layer==='bait'?'star':'diamond'),
                   line:{color:'#fff',width:1} },
        });

        window.Plotly.react(mumapVolcRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'#0a0018',
          font:{ color:'#94a3b8', family:'monospace', size:11 },
          xaxis:{ title:{text:'log₂(fold-change vs control)',font:{color:'#22d3ee',size:12}},
                  gridcolor:'#1a003066', color:'#64748b', zeroline:true, zerolinecolor:'#3d1060' },
          yaxis:{ title:{text:'-log₁₀(p-value)',font:{color:'#a855f7',size:12}},
                  gridcolor:'#1a003066', color:'#64748b' },
          legend:{ bgcolor:'rgba(0,0,0,0.6)', bordercolor:'#3d1060', borderwidth:1,
                   font:{size:10}, x:1, xanchor:'right', y:1 },
          shapes:[
            { type:'line', x0:mumapLog2Cut, x1:mumapLog2Cut, y0:0, y1:1, yref:'paper',
              line:{color:'#22d3ee66',width:1,dash:'dot'} },
            { type:'line', x0:-8, x1:8, y0:mumapPvCut, y1:mumapPvCut, xref:'paper',
              line:{color:'#a855f744',width:1,dash:'dot'} },
          ],
          annotations:[
            { x:mumapLog2Cut+0.1, y:0.97, xref:'x', yref:'paper',
              text:`${hits.length} enriched`, font:{color:'#22d3ee',size:10},
              showarrow:false, xanchor:'left' },
          ],
          margin:{ t:10, b:50, l:55, r:12 },
        }, { responsive:true, displayModeBar:false });
      }, [mode, mumapView, mumapData, mumapLog2Cut, mumapPvCut]);

      // ── μMap UMAP (Proximity Neighbourhood) ──────────────────────────
      useEffect(() => {
        if (mode !== 'mumap' || mumapView !== 'umap' || !mumapUmapRef.current) return;

        // Build traces: background, then by localisation for hits, then bait star
        const locMap = {};
        mumapData.forEach(d => {
          const k = d.loc || 'Unknown';
          if (!locMap[k]) locMap[k] = [];
          locMap[k].push(d);
        });

        const traces = [];
        // BG
        const bg = mumapData.filter(d => d.layer === 'bg');
        traces.push({
          type:'scatter', mode:'markers', name:'Background',
          x:bg.map(d=>d.ux), y:bg.map(d=>d.uy),
          text:bg.map(d=>d.gene),
          hovertemplate:'%{text}<br>UMAP: (%{x:.2f}, %{y:.2f})<extra></extra>',
          marker:{ color:'#1e0040', size:5, opacity:0.5,
                   line:{color:'#3d1060',width:0.5} },
        });
        // Hits by localisation
        const hits = mumapData.filter(d => d.layer !== 'bg' && d.layer !== 'bait');
        const hitByLoc = {};
        hits.forEach(d=>{ (hitByLoc[d.loc||'Unknown'] = hitByLoc[d.loc||'Unknown']||[]).push(d); });
        for (const [loc, pts] of Object.entries(hitByLoc)) {
          traces.push({
            type:'scatter', mode:'markers', name: loc,
            x:pts.map(d=>d.ux), y:pts.map(d=>d.uy),
            text:pts.map(d=>`${d.gene} [${loc}]<br>log₂FC: ${d.log2fc.toFixed(2)}`),
            hovertemplate:'%{text}<extra></extra>',
            marker:{ color: locColor(loc), size: pts.map(d=>5+d.log2fc*1.5),
                     opacity:0.85, line:{color:'rgba(255,255,255,0.2)',width:0.8} },
          });
        }
        // Bait (EGFR)
        const bait = mumapData.filter(d=>d.layer==='bait');
        traces.push({
          type:'scatter', mode:'markers+text', name:'Bait (EGFR)', showlegend:true,
          x:bait.map(d=>d.ux), y:bait.map(d=>d.uy),
          text:bait.map(d=>d.gene), textposition:'top center',
          textfont:{size:11,color:'#DAAA00',family:'monospace'},
          hovertemplate:'%{text}<br>Bait protein (antibody target)<extra></extra>',
          marker:{ color:'#DAAA00', size:18, symbol:'star',
                   line:{color:'#fff',width:1.5} },
        });
        // Label top neighbours
        const neighbours = mumapData.filter(d=>d.isKnown && d.layer!=='bait' && d.pv>4);
        traces.push({
          type:'scatter', mode:'markers+text', name:'', showlegend:false,
          x:neighbours.map(d=>d.ux), y:neighbours.map(d=>d.uy),
          text:neighbours.map(d=>d.gene), textposition:'top center',
          textfont:{size:8.5,color:'#22d3ee'},
          hovertemplate:'%{text}<extra></extra>',
          marker:{ color:'#22d3ee', size:7, symbol:'diamond',
                   line:{color:'rgba(255,255,255,0.4)',width:0.8} },
        });

        // Distance rings around bait (0,0 → bait at (-1.2, 2.8))
        const shapes = [];
        if (showDistRings) {
          const bx = bait[0]?.ux ?? 0, by = bait[0]?.uy ?? 0;
          // Rings: UMAP distance 1.5, 3.0, 5.0 = approx 4nm, 10nm, far
          const RING_LABELS = ['~4 nm', '~10 nm', '>20 nm'];
          [1.8, 3.5, 6.0].forEach((r, i) => {
            shapes.push({
              type:'circle', xref:'x', yref:'y',
              x0: bx-r, y0: by-r, x1: bx+r, y1: by+r,
              line:{ color: ['#DAAA0033','#22d3ee22','#a855f711'][i], width:1, dash:'dot' },
              fillcolor: 'rgba(0,0,0,0)',
            });
          });
        }

        window.Plotly.react(mumapUmapRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'#04000c',
          font:{ color:'#94a3b8', family:'monospace', size:11 },
          xaxis:{ title:{text:'UMAP 1',font:{color:'#64748b',size:11}},
                  gridcolor:'#0a0018', color:'#3d1060',
                  showgrid:false, zeroline:false },
          yaxis:{ title:{text:'UMAP 2',font:{color:'#64748b',size:11}},
                  gridcolor:'#0a0018', color:'#3d1060',
                  showgrid:false, zeroline:false },
          legend:{ bgcolor:'rgba(0,0,0,0.7)', bordercolor:'#3d1060', borderwidth:1,
                   font:{size:10}, x:1, xanchor:'right', y:1 },
          shapes,
          margin:{ t:10, b:46, l:46, r:12 },
        }, { responsive:true, displayModeBar:false });
      }, [mode, mumapView, mumapData, showDistRings, mumapLog2Cut]);

      // ── μMap Radial Distance Model ───────────────────────────────────
      // Shows expected enrichment vs distance, overlay with data points
      useEffect(() => {
        if (mode !== 'mumap' || mumapView !== 'radial' || !mumapRadRef.current) return;

        // Theoretical: enrichment ~ exp(-d/lambda), calibrated to μMap literature
        // ~4 nm radius → near-complete enrichment, falls off sharply
        // λ = 4 nm for carbene (short), 40 nm for Eosin Y (long-range)
        const distArr = Array.from({length:100},(_,i)=>i*0.6); // 0–60 nm
        const enrich_short = distArr.map(d => 6.0 * Math.exp(-d/4.0));
        const enrich_long  = distArr.map(d => 3.5 * Math.exp(-d/35.0));

        // Map proteins to approximate distance (demo: inverse of log2fc * calibration)
        const proxPts = mumapData.filter(d=>d.isKnown || d.layer==='bait');
        const estDist = proxPts.map(d => {
          // Calibrate: EGFR (bait)=0nm, FC=6→0nm, FC=1→8nm
          if (d.layer==='bait') return 0;
          return Math.max(0.5, (6.8 - d.log2fc) * 1.5);
        });

        window.Plotly.react(mumapRadRef.current, [
          { type:'scatter', mode:'lines', name:'Ir/carbene (λ≈4nm)', x:distArr, y:enrich_short,
            line:{color:'#DAAA00',width:2.5}, hovertemplate:'d: %{x:.1f} nm<br>Predicted FC: %{y:.1f}<extra></extra>' },
          { type:'scatter', mode:'lines', name:'Eosin Y (λ≈35nm)', x:distArr, y:enrich_long,
            line:{color:'#22d3ee',width:2, dash:'dash'}, hovertemplate:'d: %{x:.1f} nm<br>Predicted FC: %{y:.1f}<extra></extra>' },
          { type:'scatter', mode:'markers+text', name:'Proteins (estimated)',
            x: estDist, y: proxPts.map(d=>d.log2fc),
            text: proxPts.map(d=>d.gene),
            textposition:'top right', textfont:{size:8.5, color:'#f472b6'},
            hovertemplate:'%{text}<br>Est. dist: %{x:.1f} nm<br>log₂FC: %{y:.2f}<extra></extra>',
            marker:{ color: proxPts.map(d=>d.layer==='bait'?'#DAAA00':'#f472b6'),
                     size:  proxPts.map(d=>d.layer==='bait'?12:7),
                     symbol:proxPts.map(d=>d.layer==='bait'?'star':'circle'),
                     line:{color:'rgba(255,255,255,0.3)',width:0.8} } },
        ], {
          paper_bgcolor:'transparent', plot_bgcolor:'#0a0018',
          font:{ color:'#94a3b8', family:'monospace', size:11 },
          xaxis:{ title:{text:'Estimated distance from target (nm)',font:{color:'#22d3ee',size:12}},
                  gridcolor:'#1a003066', color:'#64748b',
                  range:[0,30] },
          yaxis:{ title:{text:'log₂(fold-change)',font:{color:'#f472b6',size:12}},
                  gridcolor:'#1a003066', color:'#64748b' },
          legend:{ bgcolor:'rgba(0,0,0,0.6)', bordercolor:'#3d1060', borderwidth:1,
                   font:{size:10}, x:1, xanchor:'right', y:1 },
          shapes:[
            { type:'rect', x0:0, x1:4, y0:-1, y1:8, fillcolor:'rgba(218,170,0,0.05)',
              line:{color:'rgba(218,170,0,0.2)',width:1}, layer:'below' },
          ],
          annotations:[
            { x:2, y:0.05, xref:'x', yref:'paper', text:'~4 nm core',
              font:{color:'#DAAA00',size:9}, showarrow:false },
          ],
          margin:{ t:10, b:50, l:55, r:12 },
        }, { responsive:true, displayModeBar:false });
      }, [mode, mumapView, mumapData]);

      // ── Import handler ───────────────────────────────────────────────
      const handleImport = () => {
        setImportError('');
        try {
          const rows = parseCSV(csvText);
          if (!rows.length) { setImportError('No rows parsed. Check your CSV format.'); return; }
          const first = rows[0];
          if (mode === 'abpp') {
            // Expect: gene, site, log2_r_ratio OR log2r, neg_log10_pval OR pval
            const log2col = Object.keys(first).find(k => k.includes('log2r') || k.includes('log2_r') || k.includes('ratio'));
            const pvcol   = Object.keys(first).find(k => k.includes('pval') || k.includes('p_val') || k.includes('neg_log'));
            if (!log2col || !pvcol) {
              setImportError(`Can't find ratio/pval columns. Found: ${Object.keys(first).join(', ')}`);
              return;
            }
            setAbppData(rows.map(r => ({
              gene: r.gene || r.protein || '?',
              site: r.site || r.cys || '?',
              log2R: parseFloat(r[log2col]) || 0,
              pv:    parseFloat(r[pvcol])   || 0,
              isHit: false, label: null,
            })));
          } else {
            const fccol = Object.keys(first).find(k => k.includes('log2fc') || k.includes('log2_fc') || k.includes('fold'));
            const pvcol = Object.keys(first).find(k => k.includes('pval') || k.includes('p_val') || k.includes('neg_log'));
            if (!fccol || !pvcol) {
              setImportError(`Can't find fc/pval columns. Found: ${Object.keys(first).join(', ')}`);
              return;
            }
            setMumapData(rows.map(r => ({
              gene: r.gene || r.protein || '?',
              log2fc: parseFloat(r[fccol]) || 0,
              pv:     parseFloat(r[pvcol]) || 0,
              ux: parseFloat(r.umap_x || r.ux || 0) || (_randNorm(_mulberry32(Math.random()*999|0))*4),
              uy: parseFloat(r.umap_y || r.uy || 0) || (_randNorm(_mulberry32(Math.random()*999|0))*4),
              loc: r.loc || r.localization || r.location || 'Unknown',
              layer: 'user', isKnown: false,
            })));
          }
          setShowImport(false); setCsvText('');
        } catch(e) { setImportError(String(e)); }
      };

      // ── Hit summary ──────────────────────────────────────────────────
      const abppHits  = abppData.filter(d => d.log2R >= abppLog2Cut && d.pv >= abppPvCut);
      const mumapHits = mumapData.filter(d => d.log2fc >= mumapLog2Cut && d.pv >= mumapPvCut);

      // ── Colour for ABPP R-ratio ──────────────────────────────────────
      const abppHeatColor = (log2R) => {
        const t = Math.min(1, Math.max(0, log2R / 4));
        const r = Math.round(61  + t*(218-61));
        const g = Math.round(16  + t*(170-16));
        const b = Math.round(96  + t*(0-96));
        return `rgb(${r},${g},${b})`;
      };

      // ────────────────────────────────────────────────────────────────
      return (
        <div style={{ maxWidth:'960px', margin:'0 auto' }}>

          {/* ── Lab hero banner ──────────────────────────────────────── */}
          <div style={{
            display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem', marginBottom:'1rem',
          }}>
            {[
              { name:'Zaro Lab', inst:'UCSF', pi:'Balyn Zaro', col:'#DAAA00',
                focus:'Activity-Based Protein Profiling · Covalent Inhibitor Selectivity · Innate Immunity',
                tech:'isoTOP-ABPP · PhosID-ABPP · Dual-probe ABPP · timsTOF HT',
                badge:'ABPP' },
              { name:'Geri Lab', inst:'Weill Cornell', pi:'Jacob Geri', col:'#22d3ee',
                focus:'Photocatalytic Proximity Labeling · Protein Interaction Discovery',
                tech:'μMap (Ir/diazirine, ~4 nm) · μMap-Red (650 nm) · Multi-scale Eosin Y (100–3000 Å)',
                badge:'μMap' },
            ].map(lab => (
              <div key={lab.name} style={{
                background:`linear-gradient(135deg,${lab.col}08 0%,var(--surface) 100%)`,
                border:`1px solid ${lab.col}30`, borderRadius:'0.6rem',
                padding:'0.75rem 0.9rem',
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.3rem' }}>
                  <span style={{ fontWeight:800, fontSize:'0.95rem', color:lab.col }}>{lab.name}</span>
                  <span style={{ fontSize:'0.68rem', color:'var(--muted)', fontStyle:'italic' }}>{lab.inst}</span>
                  <span style={{ marginLeft:'auto', fontSize:'0.65rem', fontWeight:700, padding:'0.05rem 0.4rem',
                                 background:`${lab.col}18`, border:`1px solid ${lab.col}40`,
                                 borderRadius:'0.2rem', color:lab.col }}>{lab.badge}</span>
                </div>
                <div style={{ fontSize:'0.72rem', color:'#94a3b8', lineHeight:1.6 }}>{lab.focus}</div>
                <div style={{ fontSize:'0.68rem', color:'#475569', marginTop:'0.2rem', fontFamily:'monospace' }}>{lab.tech}</div>
              </div>
            ))}
          </div>

          {/* ── Mode toggle ──────────────────────────────────────────── */}
          <div style={{
            display:'flex', borderRadius:'0.45rem', overflow:'hidden',
            border:'1px solid var(--border)', marginBottom:'1rem', width:'fit-content',
          }}>
            {[
              { key:'abpp',  label:'⚡ ABPP / isoTOP-ABPP', col:'#DAAA00' },
              { key:'mumap', label:'🔆 μMap Proximity Labeling', col:'#22d3ee' },
            ].map(m => (
              <button key={m.key} onClick={() => setMode(m.key)} style={{
                padding:'0.45rem 1.2rem', fontWeight: mode===m.key ? 700 : 400,
                background: mode===m.key ? `${m.col}18` : 'transparent',
                color: mode===m.key ? m.col : 'var(--muted)',
                border:'none', borderRight:'1px solid var(--border)',
                cursor:'pointer', fontSize:'0.85rem', transition:'all 0.15s',
              }}>
                {m.label}
              </button>
            ))}
            <button onClick={() => setShowImport(s=>!s)} style={{
              padding:'0.45rem 0.75rem', background:'transparent',
              color:'var(--muted)', border:'none', cursor:'pointer', fontSize:'0.8rem',
            }}>
              {showImport ? '✕' : '📂 Import CSV'}
            </button>
          </div>

          {/* ── CSV Import panel ──────────────────────────────────────── */}
          {showImport && (
            <div className="card" style={{ marginBottom:'1rem', border:'1px solid rgba(100,116,139,0.3)' }}>
              <div style={{ fontWeight:700, fontSize:'0.85rem', color:'var(--muted)', marginBottom:'0.4rem' }}>
                Paste {mode === 'abpp' ? 'isoTOP-ABPP CSV' : 'μMap proteomics CSV'}
              </div>
              <div style={{ fontSize:'0.72rem', color:'#475569', marginBottom:'0.4rem', fontFamily:'monospace' }}>
                {mode === 'abpp'
                  ? 'Required columns: gene, site, log2_R_ratio, neg_log10_pval  (comma or tab separated)'
                  : 'Required columns: gene, log2_FC, neg_log10_pval  +  optional: umap_x, umap_y, localization'}
              </div>
              <textarea
                value={csvText} onChange={e=>setCsvText(e.target.value)}
                rows={6}
                style={{ width:'100%', padding:'0.5rem', background:'#000814',
                         border:'1px solid var(--border)', borderRadius:'0.4rem',
                         color:'#94a3b8', fontFamily:'monospace', fontSize:'0.78rem',
                         boxSizing:'border-box', resize:'vertical' }}
                placeholder={mode==='abpp'
                  ? 'gene,site,log2_R_ratio,neg_log10_pval\nEGFR,C797,3.8,6.2\nBTK,C481,3.2,5.5\n...'
                  : 'gene,log2_FC,neg_log10_pval,localization\nERBB2,4.1,6.9,Plasma membrane\nGRB2,3.2,5.8,Cytoplasm\n...'}
              />
              {importError && <div style={{ color:'#fca5a5', fontSize:'0.75rem', marginTop:'0.25rem' }}>{importError}</div>}
              <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.4rem' }}>
                <button onClick={handleImport} style={{
                  padding:'0.3rem 0.9rem', background:'#22d3ee', color:'#0e0018',
                  border:'none', borderRadius:'0.35rem', fontWeight:700, cursor:'pointer', fontSize:'0.8rem' }}>
                  Load Data
                </button>
                <button onClick={() => { mode==='abpp' ? setAbppData(_generateABPPDemo()) : setMumapData(_generateMuMapDemo()); setShowImport(false); }}
                  style={{ padding:'0.3rem 0.9rem', background:'rgba(100,116,139,0.15)',
                           border:'1px solid var(--border)', borderRadius:'0.35rem',
                           color:'var(--muted)', cursor:'pointer', fontSize:'0.8rem' }}>
                  Reset to Demo
                </button>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              ABPP MODE
          ════════════════════════════════════════════════════════════ */}
          {mode === 'abpp' && (
            <div>
              {/* Controls */}
              <div style={{ display:'flex', gap:'1rem', alignItems:'center', flexWrap:'wrap',
                            padding:'0.5rem 0.75rem', background:'var(--surface)',
                            border:'1px solid var(--border)', borderRadius:'0.45rem', marginBottom:'0.75rem' }}>
                <span style={{ fontSize:'0.75rem', color:'var(--muted)', fontWeight:600 }}>Thresholds:</span>
                <label style={{ fontSize:'0.75rem', color:'#DAAA00', display:'flex', alignItems:'center', gap:'0.35rem' }}>
                  log₂R ≥
                  <input type="number" step="0.1" min="0" max="6" value={abppLog2Cut}
                    onChange={e=>setAbppLog2Cut(+e.target.value)}
                    style={{ width:'50px', padding:'0.15rem 0.35rem', background:'var(--bg)',
                             border:'1px solid var(--border)', borderRadius:'0.25rem',
                             color:'#DAAA00', fontSize:'0.8rem', textAlign:'center' }} />
                </label>
                <label style={{ fontSize:'0.75rem', color:'#a855f7', display:'flex', alignItems:'center', gap:'0.35rem' }}>
                  -log₁₀p ≥
                  <input type="number" step="0.1" min="0" max="10" value={abppPvCut}
                    onChange={e=>setAbppPvCut(+e.target.value)}
                    style={{ width:'50px', padding:'0.15rem 0.35rem', background:'var(--bg)',
                             border:'1px solid var(--border)', borderRadius:'0.25rem',
                             color:'#a855f7', fontSize:'0.8rem', textAlign:'center' }} />
                </label>
                <span style={{ marginLeft:'auto', fontSize:'0.78rem' }}>
                  <span style={{ color:'#DAAA00', fontWeight:700 }}>{abppHits.length}</span>
                  <span style={{ color:'var(--muted)' }}> / {abppData.length} sites enriched</span>
                </span>
              </div>

              {/* Stats row */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.4rem', marginBottom:'0.75rem' }}>
                {[
                  { label:'Total sites',  val: abppData.length, col:'#22d3ee' },
                  { label:'Hit sites',    val: abppHits.length, col:'#DAAA00' },
                  { label:'Hit proteins', val: new Set(abppHits.map(d=>d.gene)).size, col:'#34d399' },
                  { label:'Max log₂R',    val: abppData.length ? Math.max(...abppData.map(d=>d.log2R)).toFixed(2) : '—', col:'#f472b6' },
                ].map(s => (
                  <div key={s.label} style={{ padding:'0.4rem 0.6rem', background:'var(--surface)',
                    border:`1px solid ${s.col}25`, borderRadius:'0.4rem', textAlign:'center' }}>
                    <div style={{ fontWeight:800, fontSize:'1.2rem', color:s.col, lineHeight:1 }}>{s.val}</div>
                    <div style={{ fontSize:'0.65rem', color:'var(--muted)', marginTop:'0.1rem', textTransform:'uppercase', letterSpacing:'0.07em' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Two-panel layout: volcano + histogram */}
              <div style={{ display:'grid', gridTemplateColumns:'3fr 2fr', gap:'0.75rem', marginBottom:'0.75rem' }}>
                <div className="card" style={{ padding:'0.65rem' }}>
                  <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#DAAA00', marginBottom:'0.35rem' }}>
                    Competitive ABPP Volcano
                    <span style={{ fontWeight:400, color:'var(--muted)', marginLeft:'0.5rem' }}>
                      log₂(R ratio) vs -log₁₀p · each dot = one cysteine site
                    </span>
                  </div>
                  <div ref={abppVolcRef} style={{ width:'100%', height:'300px' }} />
                </div>
                <div className="card" style={{ padding:'0.65rem' }}>
                  <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#a855f7', marginBottom:'0.35rem' }}>
                    R-Ratio Distribution
                    <span style={{ fontWeight:400, color:'var(--muted)', marginLeft:'0.5rem' }}>
                      proteome-wide cysteine reactivity
                    </span>
                  </div>
                  <div ref={abppSiteRef} style={{ width:'100%', height:'300px' }} />
                  <div style={{ fontSize:'0.68rem', color:'#475569', marginTop:'0.25rem', lineHeight:1.5 }}>
                    log₂R &gt; {abppLog2Cut}: drug-engaged · log₂R ≈ 0: unaffected · log₂R &lt; −1: depleted
                  </div>
                </div>
              </div>

              {/* Hit table */}
              {abppHits.length > 0 && (
                <div className="card">
                  <div style={{ fontWeight:700, color:'#DAAA00', fontSize:'0.85rem', marginBottom:'0.5rem' }}>
                    Enriched Sites ({abppHits.length})
                  </div>
                  <div style={{ overflowX:'auto', maxHeight:'220px', overflowY:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
                      <thead>
                        <tr style={{ borderBottom:'1px solid var(--border)', position:'sticky', top:0, background:'var(--surface)' }}>
                          {['Gene','Site','log₂R','−log₁₀p','Note'].map(h=>(
                            <th key={h} style={{ textAlign:'left', padding:'0.25rem 0.5rem',
                                                 fontSize:'0.65rem', textTransform:'uppercase',
                                                 letterSpacing:'0.07em', color:'var(--muted)', fontWeight:600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...abppHits].sort((a,b)=>b.log2R-a.log2R).map((d,i)=>(
                          <tr key={i} style={{ borderBottom:'1px solid rgba(61,16,96,0.3)',
                                               background: i%2===0?'transparent':'rgba(0,0,0,0.15)' }}>
                            <td style={{ padding:'0.25rem 0.5rem', fontWeight:700, color:'#94a3b8' }}>{d.gene}</td>
                            <td style={{ padding:'0.25rem 0.5rem', fontFamily:'monospace', color:'#f472b6' }}>{d.site}</td>
                            <td style={{ padding:'0.25rem 0.5rem', fontFamily:'monospace',
                                         color: abppHeatColor(d.log2R), fontWeight:700 }}>
                              {d.log2R.toFixed(2)}
                            </td>
                            <td style={{ padding:'0.25rem 0.5rem', fontFamily:'monospace', color:'#a855f7' }}>
                              {d.pv.toFixed(2)}
                            </td>
                            <td style={{ padding:'0.25rem 0.5rem', fontSize:'0.72rem', color:'#475569',
                                         maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {d.label || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ABPP methodology explainer */}
              <div style={{ marginTop:'0.75rem', padding:'0.65rem 0.85rem',
                            background:'rgba(218,170,0,0.03)', border:'1px solid rgba(218,170,0,0.15)',
                            borderLeft:'3px solid #DAAA00', borderRadius:'0 0.4rem 0.4rem 0',
                            fontSize:'0.75rem', color:'#64748b', lineHeight:1.7 }}>
                <strong style={{ color:'#DAAA00' }}>isoTOP-ABPP / Dual-probe ABPP</strong> — activity-based probe covalently labels
                reactive cysteines; isotopic tags (light = vehicle, heavy = drug-treated) are cleaved by TEV protease
                and quantified by LC-MS. R ratio = I<sub>light</sub>/I<sub>heavy</sub>; high R = cysteine occupied by drug.
                PhosID-ABPP optimised on timsTOF HT for &gt;500 site-specific measurements per experiment.
                <span style={{ display:'block', marginTop:'0.2rem', color:'#3d1060' }}>
                  Zaro Lab · UCSF · pharm.ucsf.edu/zaro · 10.1021/acschembio.3c00637
                </span>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              μMAP MODE
          ════════════════════════════════════════════════════════════ */}
          {mode === 'mumap' && (
            <div>
              {/* Controls */}
              <div style={{ display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap',
                            padding:'0.5rem 0.75rem', background:'var(--surface)',
                            border:'1px solid var(--border)', borderRadius:'0.45rem', marginBottom:'0.75rem' }}>
                <span style={{ fontSize:'0.75rem', color:'var(--muted)', fontWeight:600 }}>View:</span>
                {[
                  { key:'volcano', label:'🌋 Volcano' },
                  { key:'umap',    label:'🗺 Neighbourhood UMAP' },
                  { key:'radial',  label:'📡 Radial Distance' },
                ].map(v => (
                  <button key={v.key} onClick={()=>setMumapView(v.key)} style={{
                    padding:'0.25rem 0.75rem', fontSize:'0.8rem',
                    background: mumapView===v.key ? 'rgba(34,211,238,0.15)' : 'transparent',
                    border: `1px solid ${mumapView===v.key ? '#22d3ee' : 'var(--border)'}`,
                    borderRadius:'0.3rem', color: mumapView===v.key ? '#22d3ee' : 'var(--muted)',
                    cursor:'pointer',
                  }}>{v.label}</button>
                ))}
                <span style={{ borderLeft:'1px solid var(--border)', paddingLeft:'0.75rem',
                               fontSize:'0.75rem', color:'#22d3ee', display:'flex', gap:'0.5rem', alignItems:'center' }}>
                  log₂FC ≥
                  <input type="number" step="0.1" min="0" max="8" value={mumapLog2Cut}
                    onChange={e=>setMumapLog2Cut(+e.target.value)}
                    style={{ width:'48px', padding:'0.1rem 0.3rem', background:'var(--bg)',
                             border:'1px solid var(--border)', borderRadius:'0.25rem',
                             color:'#22d3ee', fontSize:'0.78rem', textAlign:'center' }} />
                  &nbsp; -log₁₀p ≥
                  <input type="number" step="0.1" min="0" max="10" value={mumapPvCut}
                    onChange={e=>setMumapPvCut(+e.target.value)}
                    style={{ width:'48px', padding:'0.1rem 0.3rem', background:'var(--bg)',
                             border:'1px solid var(--border)', borderRadius:'0.25rem',
                             color:'#a855f7', fontSize:'0.78rem', textAlign:'center' }} />
                </span>
                {mumapView === 'umap' && (
                  <label style={{ fontSize:'0.75rem', color:'var(--muted)', display:'flex', alignItems:'center', gap:'0.3rem', marginLeft:'auto' }}>
                    <input type="checkbox" checked={showDistRings} onChange={e=>setShowDistRings(e.target.checked)} />
                    Distance rings
                  </label>
                )}
                <span style={{ marginLeft:'auto', fontSize:'0.78rem' }}>
                  <span style={{ color:'#22d3ee', fontWeight:700 }}>{mumapHits.length}</span>
                  <span style={{ color:'var(--muted)' }}> / {mumapData.length} enriched</span>
                </span>
              </div>

              {/* Stats row */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.4rem', marginBottom:'0.75rem' }}>
                {[
                  { label:'Total proteins', val: mumapData.length,              col:'#22d3ee' },
                  { label:'Enriched hits',  val: mumapHits.length,              col:'#DAAA00' },
                  { label:'Membrane hits',  val: mumapHits.filter(d=>(d.loc||'').includes('membrane')||d.loc?.includes('Plasma')).length, col:'#34d399' },
                  { label:'Labeling radius',val: '~4 nm',                       col:'#f472b6' },
                ].map(s => (
                  <div key={s.label} style={{ padding:'0.4rem 0.6rem', background:'var(--surface)',
                    border:`1px solid ${s.col}25`, borderRadius:'0.4rem', textAlign:'center' }}>
                    <div style={{ fontWeight:800, fontSize:'1.2rem', color:s.col, lineHeight:1 }}>{s.val}</div>
                    <div style={{ fontSize:'0.65rem', color:'var(--muted)', marginTop:'0.1rem', textTransform:'uppercase', letterSpacing:'0.07em' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Plot area */}
              <div className="card" style={{ padding:'0.65rem', marginBottom:'0.75rem' }}>
                {mumapView === 'volcano' && (
                  <>
                    <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#22d3ee', marginBottom:'0.35rem' }}>
                      μMap Proximity Volcano
                      <span style={{ fontWeight:400, color:'var(--muted)', marginLeft:'0.5rem' }}>
                        log₂(FC vs no-light control) · coloured by subcellular localisation · ★ = bait protein
                      </span>
                    </div>
                    <div ref={mumapVolcRef} style={{ width:'100%', height:'360px' }} />
                  </>
                )}
                {mumapView === 'umap' && (
                  <>
                    <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#22d3ee', marginBottom:'0.35rem' }}>
                      Proximity Neighbourhood UMAP
                      <span style={{ fontWeight:400, color:'var(--muted)', marginLeft:'0.5rem' }}>
                        Proteins embedded by enrichment profile across conditions · size = log₂FC · dashed rings = estimated distance from bait
                      </span>
                    </div>
                    <div ref={mumapUmapRef} style={{ width:'100%', height:'400px' }} />
                    {showDistRings && (
                      <div style={{ display:'flex', gap:'1rem', fontSize:'0.68rem', color:'#475569',
                                    marginTop:'0.3rem', justifyContent:'center' }}>
                        <span style={{ color:'#DAAA0066' }}>── ~4 nm (direct interactors)</span>
                        <span style={{ color:'#22d3ee44' }}>── ~10 nm (proximal complex)</span>
                        <span style={{ color:'#a855f733' }}>── >20 nm (neighbourhood)</span>
                      </div>
                    )}
                  </>
                )}
                {mumapView === 'radial' && (
                  <>
                    <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#f472b6', marginBottom:'0.35rem' }}>
                      Radial Distance Model
                      <span style={{ fontWeight:400, color:'var(--muted)', marginLeft:'0.5rem' }}>
                        Expected enrichment vs distance from target · calibrated to Ir-carbene (λ≈4nm) and Eosin Y (λ≈35nm)
                      </span>
                    </div>
                    <div ref={mumapRadRef} style={{ width:'100%', height:'340px' }} />
                    <div style={{ fontSize:'0.68rem', color:'#475569', marginTop:'0.25rem', lineHeight:1.5 }}>
                      Gold zone (0–4 nm): direct interactors and co-complex members. Ir(III)→DET→biotin-diazirine carbene t½≈2 ns.
                      Eosin Y multi-scale labeling (radii 100–3000 Å) for larger neighborhoods. · Geri Lab, Weill Cornell
                    </div>
                  </>
                )}
              </div>

              {/* μMap hit table */}
              {mumapHits.length > 0 && (
                <div className="card">
                  <div style={{ fontWeight:700, color:'#22d3ee', fontSize:'0.85rem', marginBottom:'0.5rem' }}>
                    Enriched Proteins ({mumapHits.length})
                  </div>
                  <div style={{ overflowX:'auto', maxHeight:'200px', overflowY:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
                      <thead>
                        <tr style={{ borderBottom:'1px solid var(--border)', position:'sticky', top:0, background:'var(--surface)' }}>
                          {['Gene','log₂FC','−log₁₀p','Localisation','Layer'].map(h=>(
                            <th key={h} style={{ textAlign:'left', padding:'0.25rem 0.5rem',
                                                 fontSize:'0.65rem', textTransform:'uppercase',
                                                 letterSpacing:'0.07em', color:'var(--muted)', fontWeight:600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...mumapHits].sort((a,b)=>b.log2fc-a.log2fc).map((d,i)=>(
                          <tr key={i} style={{ borderBottom:'1px solid rgba(61,16,96,0.3)',
                                               background: i%2===0?'transparent':'rgba(0,0,0,0.15)' }}>
                            <td style={{ padding:'0.25rem 0.5rem', fontWeight:700, color:'#94a3b8' }}>{d.gene}</td>
                            <td style={{ padding:'0.25rem 0.5rem', fontFamily:'monospace', fontWeight:700,
                                         color: locColor(d.loc) }}>{d.log2fc.toFixed(2)}</td>
                            <td style={{ padding:'0.25rem 0.5rem', fontFamily:'monospace', color:'#a855f7' }}>
                              {d.pv.toFixed(2)}
                            </td>
                            <td style={{ padding:'0.25rem 0.5rem', fontSize:'0.72rem',
                                         color: locColor(d.loc) }}>{d.loc || '—'}</td>
                            <td style={{ padding:'0.25rem 0.5rem', fontSize:'0.7rem',
                                         color: d.layer==='bait'?'#DAAA00':d.layer==='near'?'#22d3ee':d.layer==='mid'?'#a855f7':'#475569' }}>
                              {d.layer || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* μMap methodology */}
              <div style={{ marginTop:'0.75rem', padding:'0.65rem 0.85rem',
                            background:'rgba(34,211,238,0.03)', border:'1px solid rgba(34,211,238,0.15)',
                            borderLeft:'3px solid #22d3ee', borderRadius:'0 0.4rem 0.4rem 0',
                            fontSize:'0.75rem', color:'#64748b', lineHeight:1.7 }}>
                <strong style={{ color:'#22d3ee' }}>μMap photocatalytic proximity labeling</strong> — Ir(III) photocatalyst
                conjugated to targeting antibody/peptide/small molecule. Blue light (450 nm) excites Ir → triplet state →
                Dexter Energy Transfer to biotin-diazirine warhead → carbene (t½≈2–4 ns, diffusion radius ~4 nm) →
                covalently labels proximal proteins → streptavidin enrichment → LC-MS/MS.
                Multi-scale variant uses Eosin Y for tunable radii 100–3000 Å.
                <span style={{ display:'block', marginTop:'0.2rem', color:'#1e4060' }}>
                  Geri Lab · Weill Cornell · gerilab.weill.cornell.edu · Geri et al. Science 2020, 367:1091 · μMap-Red JACS 2022
                </span>
              </div>
            </div>
          )}

        </div>
      );
    }
