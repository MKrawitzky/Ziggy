    /* ── Phosphoproteomics Tab ───────────────────────────────────────── */

    const PHOSPHO_EXAMPLES = [
      {
        label: 'ATAAETpS7/pS9 (Oliinyk 2023)',
        sequence: 'ATAAETASEPAESK',
        charge: 2,
        desc: 'Canonical example from Oliinyk, Brunner & Meier Proteomics 2023 — Fig 4. ~5% Δ1/K₀.',
        cite: 'Oliinyk et al. Proteomics 2023, 23(7-8):e2200032 · PXD033904',
      },
      {
        label: 'RLpS/pT isomers (generic)',
        sequence: 'RLSSTSESK',
        charge: 2,
        desc: 'Classic dual-site phospho target: pSer vs pThr resolution.',
        cite: '',
      },
    ];

    const ISOMER_COLORS = ['#DAAA00', '#22d3ee', '#d946ef', '#34d399', '#f97316', '#f472b6'];

    function stripMods(seq) {
      return (seq || '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/[^A-Za-z]/g, '').toUpperCase();
    }

    function FormatModSeq({ seq }) {
      if (!seq) return null;
      const tokens = seq.split(/(\[[^\]]*\]|\([^)]*\))/);
      return React.createElement('span', { style: { fontFamily: 'monospace', fontSize: '0.82rem' } },
        ...tokens.map((tok, k) => {
          const isPhospho = (tok.startsWith('[') || tok.startsWith('(')) &&
            (tok.includes('79.9') || tok.toLowerCase().includes('phospho') || tok.includes('21'));
          return React.createElement('span', {
            key: k,
            style: isPhospho ? { color: '#f472b6', fontWeight: 800, background: 'rgba(244,114,182,0.15)', borderRadius: '2px' } : {}
          }, tok);
        })
      );
    }

    /* ── TIMS Separation Theatre Canvas ─────────────────────────────── */
    function PhosphoSepCanvas({ result }) {
      const cvRef  = useRef(null);
      const rafRef = useRef(null);

      useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.offsetWidth || 880, H = 450;
        cv.width = W; cv.height = H;

        // ── Layout ─────────────────────────────────────────────────
        const TL = 112, TR = W - 32, TW = TR - TL;
        const TTOP = 44, TBOT = 262, TH = TBOT - TTOP;
        const STOP = 292, SBOT = 428, SH = SBOT - STOP;

        // ── Isomer definitions ─────────────────────────────────────
        let isos;
        if (result?.groups?.length > 0) {
          isos = result.groups.map((g, i) => ({
            col: ISOMER_COLORS[i % ISOMER_COLORS.length],
            median: g.median, std: g.std, fwhm: g.fwhm,
            label: g.modified_sequence || `Isomer ${i+1}`, n: g.n,
          }));
        } else {
          isos = [
            { col:'#DAAA00', median:0.8952, std:0.0042, fwhm:0.0095, label:'ATAAETpS₇EPAESK', n:847 },
            { col:'#22d3ee', median:0.9403, std:0.0038, fwhm:0.0089, label:'ATAAETASEpS₉AESK', n:623 },
          ];
        }

        const maxStd = Math.max(...isos.map(i => i.std));
        const k0Min  = Math.min(...isos.map(i => i.median)) - maxStd * 6;
        const k0Max  = Math.max(...isos.map(i => i.median)) + maxStd * 6;
        const k0Rng  = k0Max - k0Min;
        const k0ToX  = k0 => TL + (k0 - k0Min) / k0Rng * TW;

        // Release timing: higher k0 = higher CCS = later release (real TIMS physics)
        const CYCLE = 420;
        const REL_START = 0.18, REL_END = 0.52;
        const k0ToRel = k0 => REL_START + (k0 - k0Min) / k0Rng * (REL_END - REL_START);

        // ── Seeded RNG ─────────────────────────────────────────────
        let s = 0xBEEF1234;
        const rng = () => { s^=s<<13; s^=s>>17; s^=s<<5; return (s>>>0)/4294967295; };
        const gauss = () => {
          const u=rng()+1e-9, v=rng();
          return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
        };

        // ── Particles ──────────────────────────────────────────────
        const NP = 700;
        const parts = [];
        for (let i = 0; i < NP; i++) {
          const isoIdx = Math.floor(rng() * isos.length);
          const iso = isos[isoIdx];
          const targetK0 = iso.median + gauss() * iso.std;
          parts.push({
            isoIdx, col: iso.col,
            targetX: k0ToX(targetK0),
            targetK0,
            baseY: TTOP + TH * 0.12 + rng() * TH * 0.76,
            phase: rng() * Math.PI * 2,
            size: 1.0 + rng() * 1.4,
            alpha: 0.45 + rng() * 0.45,
            t: Math.floor(rng() * CYCLE), // stagger
            releaseNorm: k0ToRel(targetK0),
          });
        }

        // ── Gaussian KDE for spectrum ───────────────────────────────
        const KDE_N = 400;
        const kdeCurves = isos.map(iso => {
          const xs = [], ys = [];
          let yMax = 0;
          for (let i = 0; i < KDE_N; i++) {
            const k0 = k0Min + (i / (KDE_N-1)) * k0Rng;
            const y = Math.exp(-0.5 * ((k0 - iso.median) / iso.std) ** 2);
            xs.push(k0ToX(k0)); ys.push(y);
            if (y > yMax) yMax = y;
          }
          return { xs, ys: ys.map(y => y / yMax), iso };
        });

        // ── Scan line ─────────────────────────────────────────────
        // Scan sweeps TL→TR over the REL_START→REL_END fraction of the cycle
        const scanX = (t) => {
          const prog = (t % CYCLE) / CYCLE;
          if (prog < REL_START) return TL;
          if (prog > REL_END + 0.1) return TR;
          const sp = (prog - REL_START) / (REL_END + 0.1 - REL_START);
          return TL + sp * TW;
        };

        let t = 0;
        const frame = () => {
          ctx.clearRect(0, 0, W, H);
          t++;
          const cycleT = t % CYCLE;
          const prog   = cycleT / CYCLE;

          // ── Background ────────────────────────────────────────
          ctx.fillStyle = '#040010';
          ctx.fillRect(0, 0, W, H);

          // Nebula halos
          [{x:W*.1,y:H*.4,r:170,c:'#a855f7',a:.05+Math.sin(t*.008)*.015},
           {x:W*.9,y:H*.5,r:140,c:'#22d3ee',a:.04+Math.sin(t*.006+1)*.012},
           {x:W*.5,y:H*.3,r:190,c:'#d946ef',a:.025+Math.sin(t*.007+2)*.01},
          ].forEach(g => {
            const gr = ctx.createRadialGradient(g.x,g.y,0,g.x,g.y,g.r);
            gr.addColorStop(0,g.c+'99'); gr.addColorStop(1,g.c+'00');
            ctx.save(); ctx.globalAlpha=g.a; ctx.fillStyle=gr;
            ctx.beginPath(); ctx.arc(g.x,g.y,g.r,0,Math.PI*2); ctx.fill(); ctx.restore();
          });

          // ── TIMS tube structure ───────────────────────────────
          // Outer glow
          ctx.save();
          ctx.shadowColor='#d946ef'; ctx.shadowBlur=18;
          ctx.strokeStyle='rgba(217,70,239,0.3)'; ctx.lineWidth=1.5;
          ctx.beginPath(); ctx.roundRect(TL-1,TTOP-1,TW+2,TH+2,6); ctx.stroke();
          ctx.restore();

          // Tube fill (dark with field gradient)
          const fieldGrad = ctx.createLinearGradient(TL, 0, TR, 0);
          fieldGrad.addColorStop(0,   'rgba(217,70,239,0.18)');  // inlet: strong field (violet)
          fieldGrad.addColorStop(0.35,'rgba(34,211,238,0.09)');   // mid: ramping
          fieldGrad.addColorStop(1,   'rgba(6,0,26,0.95)');       // outlet: field ≈ 0
          ctx.fillStyle = fieldGrad;
          ctx.beginPath(); ctx.roundRect(TL, TTOP, TW, TH, 5); ctx.fill();

          // Grid lines (horizontal, inside tube)
          ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.025)'; ctx.lineWidth=0.5;
          for (let row=1; row<4; row++) {
            const y = TTOP + row*(TH/4);
            ctx.beginPath(); ctx.moveTo(TL,y); ctx.lineTo(TR,y); ctx.stroke();
          }
          ctx.restore();

          // Electric field arrows (right→left, subtle)
          ctx.save(); ctx.globalAlpha=0.12+0.04*Math.sin(t*.04);
          ctx.strokeStyle='#d946ef'; ctx.lineWidth=0.8;
          for (let ax=TL+20; ax<TR-20; ax+=55) {
            const ay = TTOP + TH*0.5;
            ctx.beginPath(); ctx.moveTo(ax+8,ay); ctx.lineTo(ax,ay); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(ax+4,ay-3); ctx.moveTo(ax,ay); ctx.lineTo(ax+4,ay+3); ctx.stroke();
          }
          ctx.restore();

          // ── Particles ────────────────────────────────────────
          parts.forEach(p => {
            p.t = (p.t + 1) % CYCLE;
            const pr = p.t / CYCLE;
            let px, py;

            if (pr < p.releaseNorm) {
              // TRAPPED: oscillate at inlet cluster
              const jitter = Math.sin(p.phase + p.t * 0.18) * 5;
              const jitterY = Math.cos(p.phase*1.3 + p.t * 0.12) * (TH*0.35);
              px = TL + 10 + Math.abs(jitter);
              py = TTOP + TH*0.5 + jitterY * 0.4;
            } else {
              // RELEASED: drift right toward detector
              const driftP = (pr - p.releaseNorm) / (1.0 - p.releaseNorm);
              const eased  = 1 - Math.pow(1 - Math.min(driftP, 1), 2); // ease-out
              px = TL + eased * TW;
              py = p.baseY + Math.sin(p.phase + p.t * 0.06) * 2.5;
            }

            // Trail for released particles
            if (pr >= p.releaseNorm) {
              const trailLen = 18;
              const driftP = (pr - p.releaseNorm) / (1.0 - p.releaseNorm);
              const eased  = 1 - Math.pow(1 - Math.min(driftP, 1), 2);
              const prevX  = TL + Math.max(0, eased - 0.025) * TW;
              if (px - prevX > 1) {
                const tg = ctx.createLinearGradient(prevX, py, px, py);
                tg.addColorStop(0, p.col+'00');
                tg.addColorStop(1, p.col+'44');
                ctx.save(); ctx.strokeStyle=tg; ctx.lineWidth=p.size*0.7;
                ctx.beginPath(); ctx.moveTo(prevX,py); ctx.lineTo(px,py); ctx.stroke();
                ctx.restore();
              }
            }

            const pulse = 0.88 + 0.12*Math.sin(t*0.05+p.phase);
            ctx.save();
            ctx.globalAlpha = p.alpha * pulse;
            ctx.shadowColor = p.col;
            ctx.shadowBlur = pr >= p.releaseNorm ? 5 : 3;
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(px, py, p.size*pulse, 0, Math.PI*2); ctx.fill();
            ctx.restore();
          });

          // ── Scan line (field ramp cursor) ─────────────────────
          const sx = scanX(t);
          if (sx > TL && sx < TR) {
            ctx.save();
            const slg = ctx.createLinearGradient(sx-25,0,sx+8,0);
            slg.addColorStop(0,'#22d3ee00');
            slg.addColorStop(0.7,'rgba(34,211,238,0.55)');
            slg.addColorStop(1,'#22d3ee00');
            ctx.fillStyle=slg; ctx.fillRect(sx-25,TTOP,33,TH);
            ctx.strokeStyle='rgba(34,211,238,0.9)'; ctx.lineWidth=1.2;
            ctx.shadowColor='#22d3ee'; ctx.shadowBlur=12;
            ctx.beginPath(); ctx.moveTo(sx,TTOP-4); ctx.lineTo(sx,TBOT+4); ctx.stroke();
            // Extend scan line into spectrum
            ctx.shadowBlur=6; ctx.globalAlpha=0.4;
            ctx.beginPath(); ctx.moveTo(sx,STOP); ctx.lineTo(sx,SBOT+4); ctx.stroke();
            ctx.restore();
          }

          // ── Isomer band labels (right edge of tube) ───────────
          isos.forEach((iso, i) => {
            const bx = k0ToX(iso.median);
            // Vertical band marker
            ctx.save();
            ctx.strokeStyle = iso.col + '55'; ctx.lineWidth = 1;
            ctx.setLineDash([3,3]);
            ctx.beginPath(); ctx.moveTo(bx, TBOT+2); ctx.lineTo(bx, STOP-2); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
            // Label above tube
            ctx.save(); ctx.globalAlpha=0.85;
            ctx.fillStyle=iso.col; ctx.font='bold 9px monospace';
            ctx.textAlign='center';
            ctx.shadowColor=iso.col; ctx.shadowBlur=6;
            const labelX = Math.max(TL+30, Math.min(TR-30, bx));
            ctx.fillText(iso.median.toFixed(4), labelX, TBOT+14);
            ctx.restore();
          });

          // ── Left-side tube annotations ────────────────────────
          ctx.save(); ctx.globalAlpha=0.65;
          ctx.fillStyle='#d946ef'; ctx.font='bold 8px monospace';
          ctx.textAlign='right';
          ctx.fillText('INLET', TL-6, TTOP+12);
          ctx.fillStyle='#64748b'; ctx.font='8px monospace';
          ctx.fillText('trapped', TL-6, TTOP+24);
          ctx.fillText('ions', TL-6, TTOP+34);
          // Field ramp indicator
          ctx.fillStyle='rgba(217,70,239,0.7)'; ctx.font='7px monospace';
          ctx.fillText('E-field ↓', TL-6, TBOT-10);
          ctx.fillText('ramp', TL-6, TBOT-2);
          ctx.restore();

          ctx.save(); ctx.globalAlpha=0.65;
          ctx.fillStyle='#22d3ee'; ctx.font='bold 8px monospace';
          ctx.textAlign='left';
          ctx.fillText('DETECTOR', TR+4, TTOP+12);
          ctx.fillStyle='#64748b'; ctx.font='8px monospace';
          ctx.fillText('ion current', TR+4, TTOP+24);
          ctx.restore();

          // Top label: TIMS header
          ctx.save(); ctx.globalAlpha=0.55;
          ctx.fillStyle='#475569'; ctx.font='8px monospace'; ctx.textAlign='left';
          ctx.fillText('TIMS SEPARATION TUBE  ·  trapped ion mobility spectrometry', TL, TTOP-6);
          ctx.restore();

          // ── Spectrum (KDE) section ────────────────────────────
          // Axis line
          ctx.save();
          ctx.strokeStyle='rgba(100,116,139,0.4)'; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(TL, SBOT); ctx.lineTo(TR, SBOT); ctx.stroke();
          ctx.restore();

          // Axis ticks and labels
          ctx.save(); ctx.fillStyle='#374151'; ctx.font='8px monospace'; ctx.textAlign='center';
          const tickCount = 6;
          for (let ti=0; ti<=tickCount; ti++) {
            const k0 = k0Min + (ti/tickCount)*k0Rng;
            const x  = k0ToX(k0);
            ctx.strokeStyle='rgba(100,116,139,0.3)'; ctx.lineWidth=0.7;
            ctx.beginPath(); ctx.moveTo(x,SBOT); ctx.lineTo(x,SBOT+4); ctx.stroke();
            ctx.fillText(k0.toFixed(3), x, SBOT+13);
          }
          ctx.fillStyle='#475569'; ctx.font='8px monospace'; ctx.textAlign='center';
          ctx.fillText('1/K₀  (Vs/cm²)', TL + TW*0.5, SBOT+24);
          ctx.restore();

          // KDE curves — build opacity based on how far along the cycle we are
          // After REL_END, peaks should be fully visible
          const kdeAlpha = prog > REL_END ? 1.0 : Math.max(0, (prog - REL_START) / (REL_END - REL_START + 0.05));
          kdeCurves.forEach(({ xs, ys, iso }) => {
            const peakH = SH * 0.82;
            // Filled area
            ctx.save();
            ctx.globalAlpha = kdeAlpha * 0.35;
            const fillGrad = ctx.createLinearGradient(0, STOP, 0, SBOT);
            fillGrad.addColorStop(0, iso.col + 'CC');
            fillGrad.addColorStop(1, iso.col + '00');
            ctx.fillStyle = fillGrad;
            ctx.beginPath();
            ctx.moveTo(xs[0], SBOT);
            xs.forEach((x, i) => ctx.lineTo(x, SBOT - ys[i] * peakH));
            ctx.lineTo(xs[xs.length-1], SBOT);
            ctx.closePath(); ctx.fill();
            // Stroke
            ctx.globalAlpha = kdeAlpha * 0.9;
            ctx.strokeStyle = iso.col;
            ctx.lineWidth = 1.8;
            ctx.shadowColor = iso.col; ctx.shadowBlur = 8;
            ctx.beginPath();
            xs.forEach((x, i) => i===0 ? ctx.moveTo(x, SBOT-ys[i]*peakH) : ctx.lineTo(x, SBOT-ys[i]*peakH));
            ctx.stroke();
            // Peak label
            const peakI = ys.indexOf(Math.max(...ys));
            ctx.globalAlpha = kdeAlpha * 0.9;
            ctx.fillStyle = iso.col; ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center'; ctx.shadowBlur = 6;
            const truncLabel = iso.label.length > 22 ? iso.label.slice(0,22)+'…' : iso.label;
            ctx.fillText(truncLabel, xs[peakI], SBOT - ys[peakI]*peakH - 10);
            ctx.restore();
          });

          // FWHM brackets
          if (kdeAlpha > 0.6) {
            isos.forEach((iso, i) => {
              const bx = k0ToX(iso.median);
              const hw = (iso.fwhm / k0Rng) * TW * 0.5;
              const by = SBOT - SH * 0.28;
              ctx.save(); ctx.globalAlpha = kdeAlpha * 0.6;
              ctx.strokeStyle = iso.col + '99'; ctx.lineWidth = 1;
              ctx.setLineDash([2,2]);
              ctx.beginPath();
              ctx.moveTo(bx-hw, by+5); ctx.lineTo(bx-hw, by-5);
              ctx.moveTo(bx-hw, by); ctx.lineTo(bx+hw, by);
              ctx.moveTo(bx+hw, by+5); ctx.lineTo(bx+hw, by-5);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = iso.col + 'aa'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
              ctx.fillText('FWHM', bx, by - 8);
              ctx.restore();
            });
          }

          // Δ1/K₀ ruler between peaks (if 2+ isomers)
          if (isos.length >= 2 && kdeAlpha > 0.7) {
            const x1 = k0ToX(isos[0].median);
            const x2 = k0ToX(isos[1].median);
            const ry  = STOP + SH * 0.15;
            const deltaK0 = Math.abs(isos[1].median - isos[0].median);
            ctx.save(); ctx.globalAlpha = kdeAlpha * 0.8;
            ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, ry); ctx.lineTo(x2, ry);
            ctx.moveTo(x1, ry-4); ctx.lineTo(x1, ry+4);
            ctx.moveTo(x2, ry-4); ctx.lineTo(x2, ry+4);
            ctx.stroke();
            ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
            ctx.fillText(`Δ1/K₀ = ${deltaK0.toFixed(4)}`, (x1+x2)/2, ry-7);
            // Resolution badge
            if (result?.resolution?.[0]) {
              const R = result.resolution[0].resolution;
              const Rcol = R >= 1.0 ? '#34d399' : R >= 0.5 ? '#DAAA00' : '#f87171';
              ctx.fillStyle = Rcol; ctx.font = 'bold 10px monospace';
              ctx.shadowColor = Rcol; ctx.shadowBlur = 8;
              ctx.fillText(`R = ${R.toFixed(2)}`, (x1+x2)/2, ry-20);
            }
            ctx.restore();
          }

          // Corner label
          ctx.save(); ctx.globalAlpha=0.4;
          ctx.fillStyle='#f472b6'; ctx.font='bold 9px monospace'; ctx.textAlign='left';
          ctx.fillText('⬡ PHOSPHOISOMER SEPARATION THEATRE', 10, 16);
          ctx.fillStyle='#334155'; ctx.font='9px monospace';
          const demoLabel = result ? `${isos.length} isomers · ${result.n_total?.toLocaleString()} PSMs` : 'demo · ATAAETpS7/pS9';
          ctx.fillText(demoLabel, W-10-ctx.measureText(demoLabel).width, 16);
          ctx.restore();

          rafRef.current = requestAnimationFrame(frame);
        };
        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
      }, [result]);

      return (
        <div style={{ borderRadius:'.75rem', overflow:'hidden', marginBottom:'1rem',
                      border:'1px solid rgba(244,114,182,0.2)',
                      boxShadow:'0 0 60px rgba(217,70,239,0.08), 0 0 120px rgba(34,211,238,0.04)' }}>
          <canvas ref={cvRef} style={{ width:'100%', height:'450px', display:'block' }} />
        </div>
      );
    }

    /* ── Main Tab ────────────────────────────────────────────────────── */
    function PhosphoTab() {
      const { data: runs } = useFetch('/api/runs');
      const runList = Array.isArray(runs) ? runs.filter(r => r.result_path) : [];

      const [selRun,      setSelRun]      = useState('');
      const [seqInput,    setSeqInput]    = useState('');
      const [chargeInput, setChargeInput] = useState(2);
      const [loading,     setLoading]     = useState(false);
      const [result,      setResult]      = useState(null);
      const [error,       setError]       = useState('');
      const [activeEx,    setActiveEx]    = useState(null);

      const query = async (seq, chg, runId) => {
        const rid = runId ?? selRun;
        const s   = seq   ?? seqInput;
        const z   = chg   ?? chargeInput;
        if (!rid || !s.trim()) return;
        setLoading(true); setError(''); setResult(null);
        try {
          const url = `/api/runs/${rid}/phosphoisomer?sequence=${encodeURIComponent(stripMods(s))}&charge=${z}&mz_tol_ppm=20`;
          const r = await fetch(url);
          const d = await r.json();
          if (!r.ok) { setError(d.detail || 'Query failed'); }
          else       { setResult(d); }
        } catch(e) { setError(String(e)); }
        setLoading(false);
      };

      const loadExample = ex => {
        setSeqInput(ex.sequence); setChargeInput(ex.charge); setActiveEx(ex);
        if (selRun) query(ex.sequence, ex.charge, selRun);
      };

      const resPairs = result?.resolution || [];
      const bestRes  = resPairs.length ? Math.max(...resPairs.map(r => r.resolution)) : null;

      const inp = { background:'var(--bg)', color:'var(--text)', border:'1px solid var(--border)',
                    borderRadius:'.4rem', padding:'.35rem .6rem', fontSize:'.82rem' };

      return (
        <div style={{ maxWidth:'920px', margin:'0 auto' }}>

          {/* ── Hero canvas ── */}
          <PhosphoSepCanvas result={result} />

          {/* ── Controls row ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' }}>

            {/* Run selector */}
            <div className="card" style={{ border:'1px solid rgba(244,114,182,0.2)', padding:'.85rem 1rem' }}>
              <div style={{ fontSize:'.7rem', color:'#f472b6', fontWeight:700, textTransform:'uppercase',
                            letterSpacing:'.1em', marginBottom:'.5rem' }}>⬡ Run with phospho results</div>
              <select value={selRun} onChange={e=>{ setSelRun(e.target.value); setResult(null); }}
                style={{ ...inp, width:'100%' }}>
                <option value="">— select a run —</option>
                {runList.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.run_name}{r.n_proteins ? ` · ${r.n_proteins.toLocaleString()}p` : ''}
                  </option>
                ))}
              </select>
              {runList.length === 0 && (
                <div style={{ fontSize:'.73rem', color:'var(--muted)', marginTop:'.35rem' }}>
                  No runs with results. Run the Phospho preset in Search first.
                </div>
              )}
            </div>

            {/* Sequence input */}
            <div className="card" style={{ border:'1px solid rgba(34,211,238,0.2)', padding:'.85rem 1rem' }}>
              <div style={{ fontSize:'.7rem', color:'#22d3ee', fontWeight:700, textTransform:'uppercase',
                            letterSpacing:'.1em', marginBottom:'.5rem' }}>⬡ Peptide sequence</div>
              <div style={{ display:'flex', gap:'.4rem', alignItems:'center' }}>
                <input type="text" value={seqInput} placeholder="e.g. ATAAETASEPAESK"
                  onChange={e=>setSeqInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&query()}
                  style={{ ...inp, flex:1, fontFamily:'monospace' }} />
                <select value={chargeInput} onChange={e=>setChargeInput(+e.target.value)}
                  style={{ ...inp, width:'56px' }}>
                  {[1,2,3,4].map(z=><option key={z} value={z}>+{z}</option>)}
                </select>
                <button onClick={()=>query()}
                  disabled={!selRun||!seqInput.trim()||loading}
                  style={{ padding:'.38rem 1rem', background:(!selRun||!seqInput.trim()||loading)?'var(--border)':'#22d3ee',
                           color:(!selRun||!seqInput.trim()||loading)?'var(--muted)':'#04000c',
                           border:'none', borderRadius:'.4rem', fontWeight:700, fontSize:'.82rem',
                           cursor:(!selRun||!seqInput.trim()||loading)?'default':'pointer' }}>
                  {loading ? '…' : 'Query'}
                </button>
              </div>
              {error && <div style={{ marginTop:'.4rem', fontSize:'.76rem', color:'#f87171' }}>{error}</div>}
            </div>
          </div>

          {/* ── Examples ── */}
          <div className="card" style={{ marginBottom:'.75rem', padding:'.85rem 1rem',
                                         border:'1px solid rgba(244,114,182,0.15)' }}>
            <div style={{ fontSize:'.7rem', color:'#f472b6', fontWeight:700, textTransform:'uppercase',
                          letterSpacing:'.1em', marginBottom:'.5rem' }}>⬡ Literature examples</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'.5rem' }}>
              {PHOSPHO_EXAMPLES.map((ex, i) => (
                <div key={i} onClick={()=>loadExample(ex)} style={{
                  flex:'1 1 300px', padding:'.6rem .85rem', cursor:'pointer',
                  background: activeEx===ex ? 'rgba(244,114,182,0.08)' : 'rgba(0,0,0,0.2)',
                  border:`1px solid ${activeEx===ex ? '#f472b6' : 'rgba(61,16,96,0.5)'}`,
                  borderRadius:'.5rem', transition:'border-color .12s',
                }}>
                  <div style={{ fontWeight:700, fontSize:'.82rem', color:'#f472b6', marginBottom:'.15rem' }}>{ex.label}</div>
                  <div style={{ fontFamily:'monospace', fontSize:'.79rem', color:'#DAAA00' }}>
                    {ex.sequence} <span style={{ color:'#64748b' }}>z={ex.charge}</span>
                  </div>
                  <div style={{ fontSize:'.71rem', color:'var(--muted)', marginTop:'.15rem', lineHeight:1.4 }}>{ex.desc}</div>
                  {ex.cite && <div style={{ fontSize:'.66rem', color:'#3d1060', marginTop:'.1rem', fontStyle:'italic' }}>{ex.cite}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* ── Results ── */}
          {result && result.groups && result.groups.length === 0 && (
            <div className="card" style={{ textAlign:'center', padding:'2rem', color:'var(--muted)' }}>
              No PSMs found for <code style={{ color:'#DAAA00' }}>{result.sequence}</code> at 1% FDR.
            </div>
          )}

          {result && result.groups && result.groups.length > 0 && (
            <div className="card" style={{ border:'1px solid rgba(217,70,239,0.2)', marginBottom:'.75rem', padding:'.85rem 1rem' }}>
              {/* Stat badges */}
              <div style={{ display:'flex', gap:'.5rem', flexWrap:'wrap', marginBottom:'.75rem' }}>
                {[
                  { val:result.groups.length, label:'Isomers', col:'#22d3ee' },
                  { val:result.n_total?.toLocaleString(), label:'PSMs', col:'#DAAA00' },
                  bestRes !== null && { val:`R=${bestRes.toFixed(2)}`, label:'Best resolution',
                    col: bestRes>=1?'#34d399':bestRes>=0.5?'#DAAA00':'#f87171' },
                  resPairs[0] && { val:resPairs[0].delta_im.toFixed(4), label:'Δ1/K₀', col:'#a855f7' },
                ].filter(Boolean).map((s,i) => (
                  <div key={i} style={{ padding:'.4rem .85rem', borderRadius:'.4rem',
                                        background:`${s.col}10`, border:`1px solid ${s.col}35` }}>
                    <div style={{ fontSize:'.63rem', color:'var(--muted)', textTransform:'uppercase',
                                  letterSpacing:'.07em' }}>{s.label}</div>
                    <div style={{ fontWeight:900, fontSize:'1.35rem', color:s.col, lineHeight:1 }}>{s.val}</div>
                  </div>
                ))}
              </div>

              {/* Per-isomer table */}
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'.78rem', marginBottom:'.65rem' }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--border)' }}>
                    {['Isomer','PSMs','Median 1/K₀','σ','FWHM'].map(h=>(
                      <th key={h} style={{ textAlign:'left', padding:'.3rem .5rem', color:'var(--muted)',
                                           fontSize:'.63rem', textTransform:'uppercase', letterSpacing:'.06em', fontWeight:600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.groups.map((g,i)=>(
                    <tr key={i} style={{ borderBottom:'1px solid rgba(61,16,96,0.3)' }}>
                      <td style={{ padding:'.35rem .5rem' }}>
                        <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%',
                                       background:ISOMER_COLORS[i%ISOMER_COLORS.length], marginRight:6 }} />
                        <FormatModSeq seq={g.modified_sequence} />
                      </td>
                      <td style={{ padding:'.35rem .5rem', color:'#DAAA00', fontWeight:700 }}>{g.n}</td>
                      <td style={{ padding:'.35rem .5rem', fontFamily:'monospace', color:ISOMER_COLORS[i%ISOMER_COLORS.length] }}>{g.median.toFixed(4)}</td>
                      <td style={{ padding:'.35rem .5rem', fontFamily:'monospace', color:'var(--muted)' }}>{g.std.toFixed(4)}</td>
                      <td style={{ padding:'.35rem .5rem', fontFamily:'monospace', color:'var(--muted)' }}>{g.fwhm.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Resolution pairs */}
              {resPairs.length > 0 && (
                <div style={{ background:'rgba(0,0,0,0.3)', borderRadius:'.4rem', padding:'.55rem .75rem',
                              border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:'.63rem', color:'var(--muted)', textTransform:'uppercase',
                                letterSpacing:'.08em', fontWeight:700, marginBottom:'.35rem' }}>
                    Pairwise resolution  R = Δ1/K₀ / FWHM_avg
                  </div>
                  {resPairs.map((rp,i)=>{
                    const col = rp.baseline_resolved ? '#34d399' : rp.resolution>=0.5 ? '#DAAA00' : '#f87171';
                    return (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:'.5rem',
                                            marginBottom:'.2rem', fontSize:'.76rem' }}>
                        <span style={{ fontFamily:'monospace', color:'#64748b', fontSize:'.68rem',
                                       flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {rp.seq_a} ↔ {rp.seq_b}
                        </span>
                        <span style={{ fontWeight:800, color:col, flexShrink:0 }}>R={rp.resolution.toFixed(2)}</span>
                        <span style={{ fontSize:'.66rem', padding:'.05rem .4rem', borderRadius:'.25rem', flexShrink:0,
                                       background:`${col}18`, border:`1px solid ${col}40`, color:col }}>
                          {rp.baseline_resolved ? '✓ baseline' : 'partial'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Literature + download ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'.75rem', marginBottom:'1rem' }}>
            <div className="card" style={{ border:'1px solid rgba(244,114,182,0.15)', padding:'.85rem 1rem' }}>
              <div style={{ fontWeight:700, color:'#f472b6', fontSize:'.85rem', marginBottom:'.35rem' }}>
                Oliinyk, Brunner &amp; Meier · Proteomics 2023
              </div>
              <div style={{ fontSize:'.74rem', color:'#64748b', lineHeight:1.6, marginBottom:'.4rem' }}>
                Ion mobility-resolved phosphoproteomics with dia-PASEF and short gradients
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'.3rem' }}>
                {[['727 pairs resolved','#22d3ee'],['58 IM-only pairs','#f472b6'],['Median R=0.6','#DAAA00'],['PXD033904','#64748b']].map(([t,c])=>(
                  <span key={t} style={{ fontSize:'.67rem', padding:'.08rem .38rem', borderRadius:'.2rem',
                                         background:`${c}15`, border:`1px solid ${c}40`, color:c }}>{t}</span>
                ))}
              </div>
            </div>
            <div className="card" style={{ border:'1px solid rgba(100,116,139,0.2)', padding:'.85rem 1rem' }}>
              <div style={{ fontWeight:700, color:'#64748b', fontSize:'.85rem', marginBottom:'.35rem' }}>📥 PXD033904 data</div>
              <div style={{ fontFamily:'monospace', fontSize:'.72rem', color:'#22d3ee', background:'#000814',
                            borderRadius:'.3rem', padding:'.45rem .65rem', marginBottom:'.3rem',
                            border:'1px solid var(--border)', overflowX:'auto', whiteSpace:'nowrap' }}>
                wget -r ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2022/10/PXD033904/
              </div>
              <div style={{ fontSize:'.7rem', color:'#475569', lineHeight:1.5 }}>
                HeLa diaPASEF · timsTOF Pro · search with Phospho preset → return here.
              </div>
            </div>
          </div>

        </div>
      );
    }
