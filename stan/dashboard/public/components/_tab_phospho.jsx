    /* ── Phosphoproteomics Tab ───────────────────────────────────────── */

    const PHOSPHO_EXAMPLES = [
      {
        label: 'ATAAETpS7/pS9 (Oliinyk 2023)',
        sequence: 'ATAAETASEPAESK',
        charge: 2,
        desc: 'Canonical phosphoisomer pair from Oliinyk, Brunner & Meier 2023 — Fig 4. ~5% Δ1/K₀.',
        cite: 'Oliinyk et al. Proteomics 2023, 23(7-8):e2200032 · PXD033904',
      },
      {
        label: 'RLpS/pT isomers (generic)',
        sequence: 'RLSSTSESK',
        charge: 2,
        desc: 'Classic dual-site: pSer vs pThr resolution.',
        cite: '',
      },
    ];

    const ISOMER_COLORS = ['#DAAA00', '#22d3ee', '#d946ef', '#34d399', '#f97316', '#f472b6'];

    function stripMods(seq) {
      return (seq || '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/[^A-Za-z]/g, '').toUpperCase();
    }

    function FormatModSeq({ seq }) {
      if (!seq) return null;
      const tokens = seq.replace(/^_|_$/g, '').split(/(\[[^\]]*\]|\([^)]*\))/);
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

        const TL = 112, TR = W - 32, TW = TR - TL;
        const TTOP = 44, TBOT = 262, TH = TBOT - TTOP;
        const STOP = 292, SBOT = 428, SH = SBOT - STOP;

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

        const CYCLE = 420;
        const REL_START = 0.18, REL_END = 0.52;
        const k0ToRel = k0 => REL_START + (k0 - k0Min) / k0Rng * (REL_END - REL_START);

        let s = 0xBEEF1234;
        const rng = () => { s^=s<<13; s^=s>>17; s^=s<<5; return (s>>>0)/4294967295; };
        const gauss = () => {
          const u=rng()+1e-9, v=rng();
          return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
        };

        const NP = 700;
        const parts = [];
        for (let i = 0; i < NP; i++) {
          const isoIdx = Math.floor(rng() * isos.length);
          const iso = isos[isoIdx];
          const targetK0 = iso.median + gauss() * iso.std;
          parts.push({
            isoIdx, col: iso.col,
            targetX: k0ToX(targetK0), targetK0,
            baseY: TTOP + TH * 0.12 + rng() * TH * 0.76,
            phase: rng() * Math.PI * 2,
            size: 1.0 + rng() * 1.4,
            alpha: 0.45 + rng() * 0.45,
            t: Math.floor(rng() * CYCLE),
            releaseNorm: k0ToRel(targetK0),
          });
        }

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

          ctx.fillStyle = '#040010';
          ctx.fillRect(0, 0, W, H);

          [{x:W*.1,y:H*.4,r:170,c:'#a855f7',a:.05+Math.sin(t*.008)*.015},
           {x:W*.9,y:H*.5,r:140,c:'#22d3ee',a:.04+Math.sin(t*.006+1)*.012},
           {x:W*.5,y:H*.3,r:190,c:'#d946ef',a:.025+Math.sin(t*.007+2)*.01},
          ].forEach(g => {
            const gr = ctx.createRadialGradient(g.x,g.y,0,g.x,g.y,g.r);
            gr.addColorStop(0,g.c+'99'); gr.addColorStop(1,g.c+'00');
            ctx.save(); ctx.globalAlpha=g.a; ctx.fillStyle=gr;
            ctx.beginPath(); ctx.arc(g.x,g.y,g.r,0,Math.PI*2); ctx.fill(); ctx.restore();
          });

          ctx.save();
          ctx.shadowColor='#d946ef'; ctx.shadowBlur=18;
          ctx.strokeStyle='rgba(217,70,239,0.3)'; ctx.lineWidth=1.5;
          ctx.beginPath(); ctx.roundRect(TL-1,TTOP-1,TW+2,TH+2,6); ctx.stroke();
          ctx.restore();

          const fieldGrad = ctx.createLinearGradient(TL, 0, TR, 0);
          fieldGrad.addColorStop(0,   'rgba(217,70,239,0.18)');
          fieldGrad.addColorStop(0.35,'rgba(34,211,238,0.09)');
          fieldGrad.addColorStop(1,   'rgba(6,0,26,0.95)');
          ctx.fillStyle = fieldGrad;
          ctx.beginPath(); ctx.roundRect(TL, TTOP, TW, TH, 5); ctx.fill();

          ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.025)'; ctx.lineWidth=0.5;
          for (let row=1; row<4; row++) {
            const y = TTOP + row*(TH/4);
            ctx.beginPath(); ctx.moveTo(TL,y); ctx.lineTo(TR,y); ctx.stroke();
          }
          ctx.restore();

          ctx.save(); ctx.globalAlpha=0.12+0.04*Math.sin(t*.04);
          ctx.strokeStyle='#d946ef'; ctx.lineWidth=0.8;
          for (let ax=TL+20; ax<TR-20; ax+=55) {
            const ay = TTOP + TH*0.5;
            ctx.beginPath(); ctx.moveTo(ax+8,ay); ctx.lineTo(ax,ay); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(ax+4,ay-3); ctx.moveTo(ax,ay); ctx.lineTo(ax+4,ay+3); ctx.stroke();
          }
          ctx.restore();

          parts.forEach(p => {
            p.t = (p.t + 1) % CYCLE;
            const pr = p.t / CYCLE;
            let px, py;
            if (pr < p.releaseNorm) {
              const jitter = Math.sin(p.phase + p.t * 0.18) * 5;
              const jitterY = Math.cos(p.phase*1.3 + p.t * 0.12) * (TH*0.35);
              px = TL + 10 + Math.abs(jitter);
              py = TTOP + TH*0.5 + jitterY * 0.4;
            } else {
              const driftP = (pr - p.releaseNorm) / (1.0 - p.releaseNorm);
              const eased  = 1 - Math.pow(1 - Math.min(driftP, 1), 2);
              px = TL + eased * TW;
              py = p.baseY + Math.sin(p.phase + p.t * 0.06) * 2.5;
            }
            if (pr >= p.releaseNorm) {
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
            ctx.shadowColor = p.col; ctx.shadowBlur = pr >= p.releaseNorm ? 5 : 3;
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(px, py, p.size*pulse, 0, Math.PI*2); ctx.fill();
            ctx.restore();
          });

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
            ctx.shadowBlur=6; ctx.globalAlpha=0.4;
            ctx.beginPath(); ctx.moveTo(sx,STOP); ctx.lineTo(sx,SBOT+4); ctx.stroke();
            ctx.restore();
          }

          isos.forEach((iso) => {
            const bx = k0ToX(iso.median);
            ctx.save();
            ctx.strokeStyle = iso.col + '55'; ctx.lineWidth = 1;
            ctx.setLineDash([3,3]);
            ctx.beginPath(); ctx.moveTo(bx, TBOT+2); ctx.lineTo(bx, STOP-2); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
            ctx.save(); ctx.globalAlpha=0.85;
            ctx.fillStyle=iso.col; ctx.font='bold 9px monospace'; ctx.textAlign='center';
            ctx.shadowColor=iso.col; ctx.shadowBlur=6;
            const labelX = Math.max(TL+30, Math.min(TR-30, bx));
            ctx.fillText(iso.median.toFixed(4), labelX, TBOT+14);
            ctx.restore();
          });

          ctx.save(); ctx.globalAlpha=0.65;
          ctx.fillStyle='#d946ef'; ctx.font='bold 8px monospace'; ctx.textAlign='right';
          ctx.fillText('INLET', TL-6, TTOP+12);
          ctx.fillStyle='#64748b'; ctx.font='8px monospace';
          ctx.fillText('trapped', TL-6, TTOP+24);
          ctx.fillText('ions', TL-6, TTOP+34);
          ctx.fillStyle='rgba(217,70,239,0.7)'; ctx.font='7px monospace';
          ctx.fillText('E-field ↓', TL-6, TBOT-10);
          ctx.fillText('ramp', TL-6, TBOT-2);
          ctx.restore();

          ctx.save(); ctx.globalAlpha=0.65;
          ctx.fillStyle='#22d3ee'; ctx.font='bold 8px monospace'; ctx.textAlign='left';
          ctx.fillText('DETECTOR', TR+4, TTOP+12);
          ctx.fillStyle='#64748b'; ctx.font='8px monospace';
          ctx.fillText('ion current', TR+4, TTOP+24);
          ctx.restore();

          ctx.save(); ctx.globalAlpha=0.55;
          ctx.fillStyle='#475569'; ctx.font='8px monospace'; ctx.textAlign='left';
          ctx.fillText('TIMS SEPARATION TUBE  ·  trapped ion mobility spectrometry', TL, TTOP-6);
          ctx.restore();

          ctx.save();
          ctx.strokeStyle='rgba(100,116,139,0.4)'; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(TL, SBOT); ctx.lineTo(TR, SBOT); ctx.stroke();
          ctx.restore();

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

          const kdeAlpha = prog > REL_END ? 1.0 : Math.max(0, (prog - REL_START) / (REL_END - REL_START + 0.05));
          kdeCurves.forEach(({ xs, ys, iso }) => {
            const peakH = SH * 0.82;
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
            ctx.globalAlpha = kdeAlpha * 0.9;
            ctx.strokeStyle = iso.col; ctx.lineWidth = 1.8;
            ctx.shadowColor = iso.col; ctx.shadowBlur = 8;
            ctx.beginPath();
            xs.forEach((x, i) => i===0 ? ctx.moveTo(x, SBOT-ys[i]*peakH) : ctx.lineTo(x, SBOT-ys[i]*peakH));
            ctx.stroke();
            const peakI = ys.indexOf(Math.max(...ys));
            ctx.globalAlpha = kdeAlpha * 0.9;
            ctx.fillStyle = iso.col; ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center'; ctx.shadowBlur = 6;
            const truncLabel = iso.label.length > 22 ? iso.label.slice(0,22)+'…' : iso.label;
            ctx.fillText(truncLabel, xs[peakI], SBOT - ys[peakI]*peakH - 10);
            ctx.restore();
          });

          if (kdeAlpha > 0.6) {
            isos.forEach((iso) => {
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
            if (result?.resolution?.[0]) {
              const R = result.resolution[0].resolution;
              const Rcol = R >= 1.0 ? '#34d399' : R >= 0.5 ? '#DAAA00' : '#f87171';
              ctx.fillStyle = Rcol; ctx.font = 'bold 10px monospace';
              ctx.shadowColor = Rcol; ctx.shadowBlur = 8;
              ctx.fillText(`R = ${R.toFixed(2)}`, (x1+x2)/2, ry-20);
            }
            ctx.restore();
          }

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

    /* ── Small comparison Gaussian canvas ───────────────────────────── */
    function GaussCompareCanvas({ peaks, label, width, height }) {
      const cvRef = useRef(null);
      useEffect(() => {
        const cv = cvRef.current; if (!cv) return;
        const W = width || 260, H = height || 110;
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#040010';
        ctx.fillRect(0, 0, W, H);

        const AXIS_Y = H - 18;
        const PL = 12, PR = W - 8;
        const PW = PR - PL;

        ctx.strokeStyle = 'rgba(100,116,139,0.25)';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(PL, AXIS_Y); ctx.lineTo(PR, AXIS_Y); ctx.stroke();

        const toX = t => PL + t * PW;
        const N = 300;

        peaks.forEach(({ mu, sigma, color }) => {
          // compute normalised y values
          const pts = [];
          let yMax = 0;
          for (let i = 0; i <= N; i++) {
            const t = i / N;
            const y = Math.exp(-0.5 * ((t - mu) / sigma) ** 2);
            pts.push({ x: toX(t), y });
            if (y > yMax) yMax = y;
          }
          const maxH = AXIS_Y - 8;
          // filled area
          ctx.beginPath();
          ctx.moveTo(pts[0].x, AXIS_Y);
          pts.forEach(p => ctx.lineTo(p.x, AXIS_Y - (p.y / yMax) * maxH));
          ctx.lineTo(pts[N].x, AXIS_Y);
          ctx.closePath();
          ctx.fillStyle = color + '28';
          ctx.fill();
          // stroke
          ctx.beginPath();
          pts.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, AXIS_Y - (p.y / yMax) * maxH);
            else ctx.lineTo(p.x, AXIS_Y - (p.y / yMax) * maxH);
          });
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.6;
          ctx.shadowColor = color; ctx.shadowBlur = 6;
          ctx.stroke();
          ctx.shadowBlur = 0;
        });

        if (label) {
          ctx.fillStyle = '#334155';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(label, W / 2, H - 4);
        }
      }, [peaks, width, height, label]);
      return <canvas ref={cvRef} style={{ width:'100%', height:`${height||110}px`, borderRadius:'.3rem', display:'block' }} />;
    }

    /* ── Isomer density profiles (Plotly) ───────────────────────────── */
    function IsoProfilePlot({ result }) {
      const divRef = useRef(null);

      useEffect(() => {
        if (!divRef.current || !result?.groups?.length) return;

        const groups = result.groups;
        const N = 300;

        // find global range across all isomers
        const allMins = groups.map(g => g.median - g.std * 5.5);
        const allMaxs = groups.map(g => g.median + g.std * 5.5);
        const xMin = Math.min(...allMins);
        const xMax = Math.max(...allMaxs);

        const traces = groups.map((g, i) => {
          const col = ISOMER_COLORS[i % ISOMER_COLORS.length];
          const xs = [], ys = [];
          for (let j = 0; j <= N; j++) {
            const x = xMin + (j / N) * (xMax - xMin);
            const y = Math.exp(-0.5 * ((x - g.median) / Math.max(g.std, 1e-6)) ** 2);
            xs.push(parseFloat(x.toFixed(5)));
            ys.push(parseFloat(y.toFixed(5)));
          }
          const label = (g.modified_sequence || `Isomer ${i+1}`).replace(/^_|_$/g, '');
          return {
            x: xs, y: ys,
            mode: 'lines',
            fill: 'tozeroy',
            fillcolor: col + '22',
            line: { color: col, width: 2 },
            name: label,
            hovertemplate: `1/K₀: %{x:.4f}<br>${label}<br>n=${g.n.toLocaleString()}<extra></extra>`,
          };
        });

        // annotations: Δ1/K₀ rulers between pairs
        const annotations = [];
        if (groups.length >= 2 && result.resolution?.length) {
          const rp = result.resolution[0];
          const g1 = groups[0], g2 = groups[1];
          const midX = (g1.median + g2.median) / 2;
          const arrowY = 0.65;
          const Rcol = rp.resolution >= 1.0 ? '#34d399' : rp.resolution >= 0.5 ? '#DAAA00' : '#f87171';
          annotations.push(
            { x: g1.median, y: arrowY, xref:'x', yref:'y', ax: g2.median, ay: arrowY, axref:'x', ayref:'y',
              arrowhead:2, arrowsize:1, arrowwidth:1.2, arrowcolor:'#64748b', showarrow:true },
            { x: g2.median, y: arrowY, xref:'x', yref:'y', ax: g1.median, ay: arrowY, axref:'x', ayref:'y',
              arrowhead:2, arrowsize:1, arrowwidth:1.2, arrowcolor:'#64748b', showarrow:true },
            { x: midX, y: arrowY + 0.09, xref:'x', yref:'y',
              text: `Δ1/K₀ = ${rp.delta_im.toFixed(4)}  ·  R = ${rp.resolution.toFixed(2)}`,
              showarrow:false, font:{ color: Rcol, size:11, family:'monospace' },
              bgcolor:'rgba(0,0,0,0.45)', bordercolor:Rcol+'60', borderwidth:1, borderpad:4 },
          );
        }

        const layout = {
          paper_bgcolor: 'transparent',
          plot_bgcolor: '#040010',
          margin: { l: 48, r: 16, t: 28, b: 52 },
          xaxis: {
            title: { text: '1/K₀  (Vs/cm²)', font:{ color:'#64748b', size:11 } },
            color:'#334155', gridcolor:'rgba(255,255,255,0.03)',
            zeroline:false, tickfont:{ size:9, color:'#475569' },
          },
          yaxis: {
            title: { text: 'Relative intensity', font:{ color:'#64748b', size:11 } },
            color:'#334155', gridcolor:'rgba(255,255,255,0.03)',
            zeroline:false, showticklabels:false, range:[0, 1.2],
          },
          legend: {
            bgcolor:'rgba(0,0,0,0.4)', bordercolor:'rgba(61,16,96,0.5)', borderwidth:1,
            font:{ color:'#94a3b8', size:9, family:'monospace' }, x:0.01, y:0.99,
          },
          font:{ family:'monospace', color:'#94a3b8' },
          annotations,
          shapes: groups.map((g, i) => ({
            type:'line', x0:g.median, x1:g.median, y0:0, y1:1.05,
            xref:'x', yref:'y',
            line:{ color: ISOMER_COLORS[i % ISOMER_COLORS.length] + '60', width:1, dash:'dot' },
          })),
        };

        window.Plotly.react(divRef.current, traces, layout, { responsive:true, displayModeBar:false });
      }, [result]);

      if (!result?.groups?.length) return null;
      return (
        <div>
          <div style={{ fontSize:'.68rem', color:'#f472b6', fontWeight:700, textTransform:'uppercase',
                        letterSpacing:'.1em', marginBottom:'.4rem' }}>
            ⬡ Ion Mobility Distribution — {result.sequence}
          </div>
          <div ref={divRef} style={{ height:'260px', width:'100%' }} />
        </div>
      );
    }

    /* ── Resolution gauge ───────────────────────────────────────────── */
    function ResolutionGauge({ pairs }) {
      if (!pairs?.length) return null;
      return (
        <div>
          <div style={{ fontSize:'.68rem', color:'#22d3ee', fontWeight:700, textTransform:'uppercase',
                        letterSpacing:'.1em', marginBottom:'.6rem' }}>⬡ Separation Quality</div>
          {pairs.map((rp, i) => {
            const R   = rp.resolution;
            const col = R >= 1.0 ? '#34d399' : R >= 0.5 ? '#DAAA00' : '#f87171';
            const pct = Math.min(R / 1.5 * 100, 100);
            const label = R >= 1.0 ? 'Baseline resolved' : R >= 0.5 ? 'Partial' : 'Unresolved';
            return (
              <div key={i} style={{ marginBottom:'.85rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'.25rem' }}>
                  <span style={{ fontSize:'.7rem', color:'#64748b', fontFamily:'monospace',
                                 overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'65%' }}>
                    {(rp.seq_a||'').replace(/^_|_$/g,'')} ↔ {(rp.seq_b||'').replace(/^_|_$/g,'')}
                  </span>
                  <span style={{ fontSize:'.78rem', fontWeight:800, color:col }}>
                    R = {R.toFixed(2)}
                  </span>
                </div>
                {/* Track */}
                <div style={{ position:'relative', height:'14px', background:'rgba(0,0,0,0.4)',
                              borderRadius:'7px', border:'1px solid rgba(61,16,96,0.4)', overflow:'hidden' }}>
                  {/* Zones */}
                  <div style={{ position:'absolute', top:0, left:0, width:'33.3%', height:'100%',
                                background:'rgba(248,113,113,0.12)', borderRight:'1px solid rgba(248,113,113,0.15)' }} />
                  <div style={{ position:'absolute', top:0, left:'33.3%', width:'33.3%', height:'100%',
                                background:'rgba(218,170,0,0.1)', borderRight:'1px solid rgba(218,170,0,0.15)' }} />
                  <div style={{ position:'absolute', top:0, left:'66.6%', width:'33.4%', height:'100%',
                                background:'rgba(52,211,153,0.08)' }} />
                  {/* Fill */}
                  <div style={{ position:'absolute', top:'2px', left:'2px', bottom:'2px',
                                width:`calc(${pct}% - 4px)`, background:`${col}60`,
                                borderRadius:'5px', transition:'width .4s ease',
                                boxShadow:`0 0 8px ${col}80` }} />
                </div>
                {/* Zone labels */}
                <div style={{ display:'flex', justifyContent:'space-between',
                              fontSize:'.6rem', color:'#334155', marginTop:'.15rem' }}>
                  <span>Unresolved</span><span>Partial</span><span>Baseline</span>
                </div>
                <div style={{ textAlign:'center', marginTop:'.2rem' }}>
                  <span style={{ fontSize:'.72rem', padding:'.1rem .5rem', borderRadius:'.25rem',
                                 background:`${col}18`, border:`1px solid ${col}40`, color:col, fontWeight:700 }}>
                    {label}
                  </span>
                </div>
                <div style={{ display:'flex', gap:'.5rem', marginTop:'.35rem', flexWrap:'wrap' }}>
                  {[
                    ['Δ1/K₀', rp.delta_im?.toFixed(4)],
                    ['FWHM avg', rp.fwhm_avg?.toFixed(4)],
                    ['Δ/FWHM', R.toFixed(3)],
                  ].map(([k,v]) => (
                    <div key={k} style={{ flex:'1', background:'rgba(0,0,0,0.3)', borderRadius:'.3rem',
                                          border:'1px solid rgba(61,16,96,0.3)', padding:'.25rem .4rem',
                                          textAlign:'center' }}>
                      <div style={{ fontSize:'.6rem', color:'#475569' }}>{k}</div>
                      <div style={{ fontSize:'.8rem', fontFamily:'monospace', color:'#94a3b8' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    /* ── IM Advantage Infographic (always visible) ───────────────────── */
    function IMAdvantagePanel() {
      return (
        <div style={{ marginBottom:'1rem' }}>
          <div style={{ fontSize:'.7rem', color:'#DAAA00', fontWeight:700, textTransform:'uppercase',
                        letterSpacing:'.12em', marginBottom:'.65rem', display:'flex', alignItems:'center', gap:'.5rem' }}>
            <span>⬡ Why Ion Mobility Changes Phosphoproteomics</span>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'.75rem' }}>

            {/* Card 1 — The Problem */}
            <div className="card" style={{ border:'1px solid rgba(248,113,113,0.2)', padding:'.85rem 1rem' }}>
              <div style={{ fontSize:'.72rem', color:'#f87171', fontWeight:700,
                            textTransform:'uppercase', letterSpacing:'.08em', marginBottom:'.5rem' }}>
                ✗ Mass alone fails
              </div>
              <GaussCompareCanvas
                peaks={[
                  { mu:0.5, sigma:0.055, color:'#DAAA00' },
                  { mu:0.5, sigma:0.05,  color:'#22d3ee' },
                ]}
                label="m/z (both isomers identical)"
                height={100}
              />
              <div style={{ fontSize:'.72rem', color:'#64748b', lineHeight:1.5, marginTop:'.5rem' }}>
                pSer-7 and pSer-9 share the same elemental composition. Same m/z. Same fragment ions.
                Conventional LC-MS/MS collapses them into one broadened, unassignable peak.
              </div>
              <div style={{ marginTop:'.5rem', fontFamily:'monospace', fontSize:'.72rem',
                            color:'#f87171', background:'rgba(248,113,113,0.06)',
                            border:'1px solid rgba(248,113,113,0.15)', borderRadius:'.3rem', padding:'.3rem .5rem' }}>
                Result → ambiguous phosphosite assignment
              </div>
            </div>

            {/* Card 2 — The Solution */}
            <div className="card" style={{ border:'1px solid rgba(52,211,153,0.2)', padding:'.85rem 1rem' }}>
              <div style={{ fontSize:'.72rem', color:'#34d399', fontWeight:700,
                            textTransform:'uppercase', letterSpacing:'.08em', marginBottom:'.5rem' }}>
                ✓ TIMS resolves
              </div>
              <GaussCompareCanvas
                peaks={[
                  { mu:0.32, sigma:0.042, color:'#DAAA00' },
                  { mu:0.68, sigma:0.038, color:'#22d3ee' },
                ]}
                label="1/K₀  (Vs/cm²) — separated"
                height={100}
              />
              <div style={{ fontSize:'.72rem', color:'#64748b', lineHeight:1.5, marginTop:'.5rem' }}>
                Phosphorylation shifts the peptide's 3D gas-phase conformation. TIMS traps by shape —
                pSer-7 vs pSer-9 separate by ~5% Δ1/K₀ before reaching the mass analyser.
              </div>
              <div style={{ marginTop:'.5rem', display:'flex', gap:'.3rem', flexWrap:'wrap' }}>
                {[['Δ1/K₀ ≈ 0.045','#34d399'],['σ ≈ 0.004','#22d3ee'],['FWHM ≈ 0.009','#DAAA00']].map(([t,c])=>(
                  <span key={t} style={{ fontSize:'.66rem', padding:'.08rem .38rem', borderRadius:'.2rem',
                                         background:`${c}15`, border:`1px solid ${c}40`, color:c }}>{t}</span>
                ))}
              </div>
            </div>

            {/* Card 3 — The Impact */}
            <div className="card" style={{ border:'1px solid rgba(218,170,0,0.2)', padding:'.85rem 1rem' }}>
              <div style={{ fontSize:'.72rem', color:'#DAAA00', fontWeight:700,
                            textTransform:'uppercase', letterSpacing:'.08em', marginBottom:'.5rem' }}>
                ⬡ Oliinyk 2023 · impact
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'.4rem' }}>
                {[
                  { n:'727', label:'phosphoisomer pairs', sub:'resolved by dia-PASEF', col:'#22d3ee' },
                  { n:'58',  label:'pairs', sub:'resolved only by ion mobility — invisible to MS2', col:'#f472b6' },
                  { n:'R=0.6', label:'median resolution', sub:'half the pairs are baseline-resolved', col:'#34d399' },
                  { n:'~5%', label:'typical Δ1/K₀', sub:'pSer ↔ pThr / different site positions', col:'#DAAA00' },
                ].map(s => (
                  <div key={s.n} style={{ display:'flex', gap:'.6rem', alignItems:'flex-start',
                                           background:'rgba(0,0,0,0.25)', borderRadius:'.3rem',
                                           padding:'.3rem .5rem', border:`1px solid ${s.col}18` }}>
                    <div style={{ fontSize:'1.25rem', fontWeight:900, color:s.col, lineHeight:1,
                                  flexShrink:0, fontFamily:'monospace', minWidth:'3.2rem' }}>{s.n}</div>
                    <div>
                      <div style={{ fontSize:'.7rem', fontWeight:700, color:'#94a3b8' }}>{s.label}</div>
                      <div style={{ fontSize:'.64rem', color:'#475569', lineHeight:1.3 }}>{s.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:'.5rem', fontSize:'.64rem', color:'#3d1060', fontStyle:'italic' }}>
                Oliinyk, Brunner &amp; Meier · Proteomics 2023 · PXD033904
              </div>
            </div>

          </div>
        </div>
      );
    }

    /* ── Phospho Landscape scatter ───────────────────────────────────── */
    function PhosphoLandscape({ runId, runName }) {
      const { data } = useFetch(runId ? `/api/runs/${runId}/phospho-landscape` : null);
      const divRef = useRef(null);

      useEffect(() => {
        if (!divRef.current || !data?.peptides?.length) return;

        const peptides = data.peptides;
        const singles  = peptides.filter(p => p.n_isomers === 1 && p.median_mz > 0);
        const multi2   = peptides.filter(p => p.n_isomers === 2 && p.median_mz > 0);
        const multi3p  = peptides.filter(p => p.n_isomers >= 3 && p.median_mz > 0);

        const mkTrace = (pts, color, name, size, symbol) => ({
          x: pts.map(p => p.median_mz),
          y: pts.map(p => p.median_im),
          mode: 'markers',
          type: 'scattergl',
          marker: { color, size, opacity: symbol === 'circle-open' ? 0.9 : 0.55,
                    symbol: symbol || 'circle',
                    line: { color, width: symbol === 'circle-open' ? 1.5 : 0 } },
          name,
          text: pts.map(p => `${p.bare_seq}<br>${p.n_isomers} isomer${p.n_isomers>1?'s':''} · ${p.n_psms} PSMs`),
          hovertemplate: '%{text}<extra></extra>',
        });

        const traces = [
          mkTrace(singles,  '#334155', 'Single isomer', 3, 'circle'),
          mkTrace(multi2,   '#DAAA00', '2 isomers (IM resolved)', 6, 'circle-open'),
          mkTrace(multi3p,  '#d946ef', '3+ isomers',   8, 'circle-open'),
        ];

        const layout = {
          paper_bgcolor: 'transparent',
          plot_bgcolor:  '#040010',
          margin: { l:52, r:20, t:36, b:56 },
          xaxis: {
            title:{ text:'Precursor m/z', font:{ color:'#64748b', size:11 } },
            color:'#334155', gridcolor:'rgba(255,255,255,0.025)', zeroline:false,
            tickfont:{ size:9, color:'#475569' },
          },
          yaxis: {
            title:{ text:'1/K₀  (Vs/cm²)', font:{ color:'#64748b', size:11 } },
            color:'#334155', gridcolor:'rgba(255,255,255,0.025)', zeroline:false,
            tickfont:{ size:9, color:'#475569' },
          },
          legend:{
            bgcolor:'rgba(0,0,0,0.4)', bordercolor:'rgba(61,16,96,0.5)', borderwidth:1,
            font:{ color:'#94a3b8', size:9, family:'monospace' },
          },
          font:{ family:'monospace', color:'#94a3b8' },
          title:{ text:'', font:{ color:'#DAAA00', size:11 } },
        };

        window.Plotly.react(divRef.current, traces, layout, { responsive:true, displayModeBar:false });
      }, [data]);

      if (!runId) return null;

      return (
        <div className="card" style={{ border:'1px solid rgba(218,170,0,0.2)', marginBottom:'1rem',
                                        padding:'.85rem 1rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                        marginBottom:'.6rem', flexWrap:'wrap', gap:'.5rem' }}>
            <div style={{ fontSize:'.7rem', color:'#DAAA00', fontWeight:700,
                          textTransform:'uppercase', letterSpacing:'.1em' }}>
              ⬡ Phospho Landscape — {runName || runId}
            </div>
            {data && (
              <div style={{ display:'flex', gap:'.4rem' }}>
                {[
                  { val: data.n_phospho?.toLocaleString(), label:'phospho peptides', col:'#64748b' },
                  { val: data.n_multi_isomer?.toLocaleString(), label:'multi-isomer (gold)', col:'#DAAA00' },
                ].map(s => (
                  <div key={s.label} style={{ padding:'.2rem .6rem', borderRadius:'.3rem',
                                               background:`${s.col}12`, border:`1px solid ${s.col}30`,
                                               fontSize:'.7rem', color:s.col }}>
                    <b>{s.val}</b> {s.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          {!data && (
            <div style={{ height:'300px', display:'flex', alignItems:'center', justifyContent:'center',
                          color:'#334155', fontSize:'.78rem' }}>Loading landscape…</div>
          )}
          {data?.peptides?.length === 0 && (
            <div style={{ height:'120px', display:'flex', alignItems:'center', justifyContent:'center',
                          color:'#334155', fontSize:'.78rem' }}>
              No phospho peptides at 1% FDR in this run.
            </div>
          )}
          {data?.peptides?.length > 0 && (
            <>
              <div ref={divRef} style={{ height:'340px', width:'100%' }} />
              <div style={{ fontSize:'.68rem', color:'#334155', marginTop:'.35rem', textAlign:'center' }}>
                Gold circles = phosphoisomers resolved only by ion mobility.
                Each gold dot is a phosphosite assignment that LC-MS/MS alone would miss.
              </div>
            </>
          )}
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

      const selRunObj = runList.find(r => String(r.id) === String(selRun));

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
          if (!r.ok)    { setError(d.detail || 'Query failed'); }
          else if (d.error) { setError(d.error); }
          else          { setResult(d); }
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
        <div style={{ maxWidth:'960px', margin:'0 auto' }}>

          {/* ── Hero canvas ── */}
          <PhosphoSepCanvas result={result} />

          {/* ── Controls row ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' }}>

            {/* Run selector */}
            <div className="card" style={{ border:'1px solid rgba(244,114,182,0.2)', padding:'.85rem 1rem' }}>
              <div style={{ fontSize:'.7rem', color:'#f472b6', fontWeight:700, textTransform:'uppercase',
                            letterSpacing:'.1em', marginBottom:'.5rem' }}>⬡ Run with phospho results</div>
              <select value={selRun} onChange={e=>{ setSelRun(e.target.value); setResult(null); setError(''); }}
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
                            letterSpacing:'.1em', marginBottom:'.5rem' }}>⬡ Peptide sequence (bare AA)</div>
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
                  style={{ padding:'.38rem 1rem',
                           background:(!selRun||!seqInput.trim()||loading)?'var(--border)':'#22d3ee',
                           color:(!selRun||!seqInput.trim()||loading)?'var(--muted)':'#04000c',
                           border:'none', borderRadius:'.4rem', fontWeight:700, fontSize:'.82rem',
                           cursor:(!selRun||!seqInput.trim()||loading)?'default':'pointer' }}>
                  {loading ? '…' : 'Query'}
                </button>
              </div>
              {error && (
                <div style={{ marginTop:'.4rem', fontSize:'.76rem', color:'#f87171',
                              background:'rgba(248,113,113,0.06)', borderRadius:'.3rem',
                              padding:'.25rem .45rem', border:'1px solid rgba(248,113,113,0.2)' }}>
                  {error}
                </div>
              )}
              {!selRun && (
                <div style={{ marginTop:'.35rem', fontSize:'.7rem', color:'#475569' }}>
                  ↑ Select a run first, then enter any phosphopeptide bare sequence
                </div>
              )}
            </div>
          </div>

          {/* ── Examples ── */}
          <div className="card" style={{ marginBottom:'.75rem', padding:'.75rem 1rem',
                                         border:'1px solid rgba(244,114,182,0.12)' }}>
            <div style={{ fontSize:'.68rem', color:'#f472b6', fontWeight:700, textTransform:'uppercase',
                          letterSpacing:'.1em', marginBottom:'.4rem' }}>⬡ Literature examples</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'.5rem' }}>
              {PHOSPHO_EXAMPLES.map((ex, i) => (
                <div key={i} onClick={()=>loadExample(ex)} style={{
                  flex:'1 1 260px', padding:'.5rem .75rem', cursor:'pointer',
                  background: activeEx===ex ? 'rgba(244,114,182,0.08)' : 'rgba(0,0,0,0.2)',
                  border:`1px solid ${activeEx===ex ? '#f472b6' : 'rgba(61,16,96,0.4)'}`,
                  borderRadius:'.5rem', transition:'border-color .12s',
                }}>
                  <div style={{ fontWeight:700, fontSize:'.8rem', color:'#f472b6', marginBottom:'.1rem' }}>{ex.label}</div>
                  <div style={{ fontFamily:'monospace', fontSize:'.76rem', color:'#DAAA00' }}>
                    {ex.sequence} <span style={{ color:'#64748b' }}>z={ex.charge}</span>
                  </div>
                  <div style={{ fontSize:'.69rem', color:'var(--muted)', marginTop:'.1rem', lineHeight:1.35 }}>{ex.desc}</div>
                  {ex.cite && <div style={{ fontSize:'.63rem', color:'#3d1060', marginTop:'.05rem', fontStyle:'italic' }}>{ex.cite}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* ── Results: no hits ── */}
          {result && result.groups && result.groups.length === 0 && (
            <div className="card" style={{ textAlign:'center', padding:'1.5rem',
                                            color:'var(--muted)', marginBottom:'.75rem',
                                            border:'1px solid rgba(61,16,96,0.3)' }}>
              <div style={{ fontSize:'.9rem', marginBottom:'.4rem' }}>
                No PSMs found for <code style={{ color:'#DAAA00' }}>{result.sequence}</code> at 1% FDR
              </div>
              <div style={{ fontSize:'.72rem', color:'#334155' }}>
                Try a different charge state, or check that this run has phospho results (Phospho preset).
              </div>
            </div>
          )}

          {/* ── Results: isomer profiles + resolution ── */}
          {result && result.groups && result.groups.length > 0 && (
            <>
              {/* Stat badges */}
              <div style={{ display:'flex', gap:'.5rem', flexWrap:'wrap', marginBottom:'.75rem' }}>
                {[
                  { val:result.groups.length, label:'Isomers detected', col:'#22d3ee' },
                  { val:result.n_total?.toLocaleString(), label:'Total PSMs', col:'#DAAA00' },
                  bestRes !== null && { val:`R = ${bestRes.toFixed(2)}`,
                    label:'Best resolution',
                    col: bestRes>=1?'#34d399':bestRes>=0.5?'#DAAA00':'#f87171' },
                  resPairs[0] && { val:resPairs[0].delta_im.toFixed(4), label:'Δ1/K₀', col:'#a855f7' },
                  result.source && { val:result.source.toUpperCase(), label:'Engine', col:'#475569' },
                ].filter(Boolean).map((s,i) => (
                  <div key={i} style={{ padding:'.4rem .85rem', borderRadius:'.4rem',
                                        background:`${s.col}10`, border:`1px solid ${s.col}35` }}>
                    <div style={{ fontSize:'.61rem', color:'var(--muted)', textTransform:'uppercase',
                                  letterSpacing:'.07em' }}>{s.label}</div>
                    <div style={{ fontWeight:900, fontSize:'1.3rem', color:s.col, lineHeight:1,
                                  fontFamily:'monospace' }}>{s.val}</div>
                  </div>
                ))}
              </div>

              {/* Isomer density + resolution gauge side by side */}
              <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1fr', gap:'.75rem', marginBottom:'.75rem' }}>
                <div className="card" style={{ border:'1px solid rgba(217,70,239,0.2)', padding:'.85rem 1rem' }}>
                  <IsoProfilePlot result={result} />
                </div>
                <div className="card" style={{ border:'1px solid rgba(34,211,238,0.2)', padding:'.85rem 1rem' }}>
                  <ResolutionGauge pairs={resPairs} />
                </div>
              </div>

              {/* Per-isomer table */}
              <div className="card" style={{ border:'1px solid rgba(61,16,96,0.4)',
                                              marginBottom:'.75rem', padding:'.85rem 1rem' }}>
                <div style={{ fontSize:'.68rem', color:'#a855f7', fontWeight:700, textTransform:'uppercase',
                              letterSpacing:'.1em', marginBottom:'.5rem' }}>⬡ Per-isomer statistics</div>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'.78rem' }}>
                  <thead>
                    <tr style={{ borderBottom:'1px solid var(--border)' }}>
                      {['#','Modified sequence','PSMs','Median 1/K₀','σ','FWHM'].map(h=>(
                        <th key={h} style={{ textAlign:'left', padding:'.3rem .5rem', color:'var(--muted)',
                                             fontSize:'.62rem', textTransform:'uppercase', letterSpacing:'.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.groups.map((g,i)=>(
                      <tr key={i} style={{ borderBottom:'1px solid rgba(61,16,96,0.25)' }}>
                        <td style={{ padding:'.35rem .5rem' }}>
                          <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%',
                                         background:ISOMER_COLORS[i%ISOMER_COLORS.length], marginRight:4 }} />
                        </td>
                        <td style={{ padding:'.35rem .5rem' }}><FormatModSeq seq={g.modified_sequence} /></td>
                        <td style={{ padding:'.35rem .5rem', color:'#DAAA00', fontWeight:700 }}>{g.n.toLocaleString()}</td>
                        <td style={{ padding:'.35rem .5rem', fontFamily:'monospace',
                                     color:ISOMER_COLORS[i%ISOMER_COLORS.length] }}>{g.median.toFixed(4)}</td>
                        <td style={{ padding:'.35rem .5rem', fontFamily:'monospace', color:'#64748b' }}>{g.std.toFixed(4)}</td>
                        <td style={{ padding:'.35rem .5rem', fontFamily:'monospace', color:'#64748b' }}>{g.fwhm.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── IM Advantage (always visible) ── */}
          <div className="card" style={{ border:'1px solid rgba(218,170,0,0.15)',
                                          padding:'.85rem 1rem', marginBottom:'.75rem' }}>
            <IMAdvantagePanel />
          </div>

          {/* ── Phospho Landscape (auto-loads when run selected) ── */}
          <PhosphoLandscape runId={selRun} runName={selRunObj?.run_name} />

          {/* ── Download hint ── */}
          <div className="card" style={{ border:'1px solid rgba(100,116,139,0.15)',
                                          padding:'.75rem 1rem', marginBottom:'1rem' }}>
            <div style={{ fontWeight:700, color:'#64748b', fontSize:'.82rem', marginBottom:'.25rem' }}>
              📥 Get PXD033904 (Oliinyk 2023 — HeLa diaPASEF)
            </div>
            <div style={{ fontFamily:'monospace', fontSize:'.72rem', color:'#22d3ee', background:'#000814',
                          borderRadius:'.3rem', padding:'.4rem .6rem', marginBottom:'.25rem',
                          border:'1px solid var(--border)', overflowX:'auto', whiteSpace:'nowrap' }}>
              wget -r ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2022/10/PXD033904/
            </div>
            <div style={{ fontSize:'.68rem', color:'#475569' }}>
              Run the Phospho preset in Search → return here to query any phosphopeptide.
            </div>
          </div>

        </div>
      );
    }
