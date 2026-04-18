    /* ── Ion Mobility Tab ───────────────────────────────────────────── */

    function MobilityTab() {
      const { data: allRuns, loading: runsLoading } = useFetch('/api/runs?limit=1000');
      const [selectedRun, setSelectedRun] = useState(null);
      const [searchTerm, setSearchTerm] = useState('');
      const [mapData, setMapData] = useState(null);
      const [statsData, setStatsData] = useState(null);
      const [windowData, setWindowData] = useState(null);
      const [data3d, setData3d] = useState(null);
      const [pasefData, setPasefData] = useState(null);
      const [panelLoading, setPanelLoading] = useState(false);
      const [showWindowOverlay, setShowWindowOverlay] = useState(false);
      const [showPasefOverlay, setShowPasefOverlay] = useState(false);
      const canvasRef       = useRef(null);
      const plot3dRef       = useRef(null);
      const mzLandscapeRef  = useRef(null);
      const waterfallRef    = useRef(null);
      const cloudMzRef      = useRef(null);   // m/z vs 1/K₀ (Tenzer style)
      const cloudRtRef      = useRef(null);   // RT vs 1/K₀ (Kulej style)
      const coverageRef     = useRef(null);   // coverage: inside vs outside windows
      const pasefPolygonRef = useRef(null);   // PASEF polygon view
      const corridorMapRef  = useRef(null);   // 1/K₀ vs m/z charge-state corridor map
      const ridgelineRef    = useRef(null);   // per-charge 1/K₀ KDE ridgeline
      const isolationHistRef = useRef(null);  // Δ(1/K₀) histogram for co-isolating pairs
      const [isolationScore, setIsolationScore] = useState(null); // {pct, totalPairs, resolvedPairs, hist}
      const [isoMzWindow, setIsoMzWindow]     = useState(1.0);   // Th
      const [isoRtWindow, setIsoRtWindow]     = useState(30);    // seconds

      // Ion detail panel (click-to-inspect)
      const [ionTarget, setIonTarget]       = useState(null);  // {mz, rt, ook0, charge}
      const [ionDetail, setIonDetail]       = useState(null);
      const [ionLoading, setIonLoading]     = useState(false);
      const xicRef                          = useRef(null);
      const mobilogramRef                   = useRef(null);
      const frameHeatmapRef                 = useRef(null);
      const frameSpectrumRef                = useRef(null);
      const [frameHeatmap, setFrameHeatmap] = useState(null);
      const [frameSpectrum, setFrameSpectrum] = useState(null);
      // Refs that let Plotly event handlers read latest React state without stale closures
      const filteredData3dRef               = useRef(null);
      const selectedRunRef                  = useRef(null);

      // Window group → colour (cycles through palette)
      const WIN_PALETTE = ['#3b82f6','#22c55e','#f97316','#a855f7','#06b6d4','#f59e0b','#ec4899','#14b8a6'];
      const winColor = (groupIdx) => WIN_PALETTE[groupIdx % WIN_PALETTE.length];

      // Charge colours — 0=unassigned (gold), 1=teal, 2=blue, 3=green, 4=orange, 5=purple, 6=red
      const CHARGE_COLORS = {0:'#eab308',1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',6:'#ef4444'};
      const CHARGE_LABEL  = {0:'?',1:'+1',2:'+2',3:'+3',4:'+4',5:'+5',6:'+6'};
      const CHARGE_TITLE  = {0:'Unassigned — charge state could not be determined during acquisition',1:'+1 singly-charged',2:'+2',3:'+3',4:'+4',5:'+5',6:'+6'};

      // ── 3D filter state ──────────────────────────────────────────────
      const [filterCharges, setFilterCharges] = useState(new Set()); // empty = all
      const [filterMzMin, setFilterMzMin] = useState('');
      const [filterMzMax, setFilterMzMax] = useState('');
      const [filterRtMin, setFilterRtMin] = useState('');
      const [filterRtMax, setFilterRtMax] = useState('');
      const [filterOok0Min, setFilterOok0Min] = useState('');
      const [filterOok0Max, setFilterOok0Max] = useState('');
      const [showFilters, setShowFilters] = useState(false);
      const [autoRotate, setAutoRotate]   = useState(true);
      const rotateAnimRef     = useRef(null);
      const rotateAngleRef    = useRef(0);
      const rotateLastTimeRef = useRef(0);

      const dRuns = useMemo(() => {
        if (!Array.isArray(allRuns)) return [];
        return allRuns.filter(r => r.raw_path && r.raw_path.endsWith('.d'));
      }, [allRuns]);

      const filtered = useMemo(() => {
        if (!searchTerm) return dRuns;
        const q = searchTerm.toLowerCase();
        return dRuns.filter(r =>
          (r.run_name || '').toLowerCase().includes(q) ||
          (r.instrument || '').toLowerCase().includes(q)
        );
      }, [dRuns, searchTerm]);

      // ── Purge all Plotly charts when this tab unmounts ───────────────
      useEffect(() => {
        return () => {
          [plot3dRef, mzLandscapeRef, waterfallRef, cloudMzRef, cloudRtRef, coverageRef, pasefPolygonRef,
           xicRef, mobilogramRef, frameHeatmapRef, frameSpectrumRef, corridorMapRef, ridgelineRef, isolationHistRef].forEach(r => {
            if (r.current && window.Plotly) window.Plotly.purge(r.current);
          });
          if (rotateAnimRef.current) cancelAnimationFrame(rotateAnimRef.current);
        };
      }, []);

      // Derived: reset filters + overlays when run changes
      useEffect(() => {
        setFilterCharges(new Set());
        setFilterMzMin(''); setFilterMzMax('');
        setFilterRtMin(''); setFilterRtMax('');
        setFilterOok0Min(''); setFilterOok0Max('');
        setShowWindowOverlay(false);
        setShowPasefOverlay(false);
        setAutoRotate(true);
        rotateAngleRef.current = 0;
        rotateLastTimeRef.current = 0;
      }, [selectedRun?.id]);

      // Filtered 3D data (client-side, no re-fetch needed)
      // filterCharges = set of HIDDEN charge states (empty = show all)
      const filteredData3d = useMemo(() => {
        if (!data3d) return null;
        const mzMin = filterMzMin !== '' ? parseFloat(filterMzMin) : -Infinity;
        const mzMax = filterMzMax !== '' ? parseFloat(filterMzMax) : Infinity;
        // RT filter inputs are in minutes; data3d.rt is in seconds → multiply by 60
        const rtMinSec = filterRtMin !== '' ? parseFloat(filterRtMin) * 60 : -Infinity;
        const rtMaxSec = filterRtMax !== '' ? parseFloat(filterRtMax) * 60 : Infinity;
        const ook0Min = filterOok0Min !== '' ? parseFloat(filterOok0Min) : -Infinity;
        const ook0Max = filterOok0Max !== '' ? parseFloat(filterOok0Max) : Infinity;

        const keep = data3d.rt.map((_, i) => {
          if (filterCharges.has(data3d.charge[i])) return false;
          if (data3d.mz[i] < mzMin || data3d.mz[i] > mzMax) return false;
          if (data3d.rt[i] < rtMinSec || data3d.rt[i] > rtMaxSec) return false;
          if (data3d.mobility[i] < ook0Min || data3d.mobility[i] > ook0Max) return false;
          return true;
        });
        let idxs = keep.reduce((a, v, i) => { if (v) a.push(i); return a; }, []);
        if (idxs.length === 0) return null;
        // When auto-rotating, subsample to ≤2500 points for smooth GL performance.
        // Stratified subsample: sort by log_int descending so brightest ions are kept.
        const ROT_CAP = 2500;
        if (autoRotate && idxs.length > ROT_CAP) {
          idxs.sort((a, b) => data3d.log_int[b] - data3d.log_int[a]);
          idxs = idxs.slice(0, ROT_CAP);
        }
        return {
          ...data3d,
          rt:       idxs.map(i => data3d.rt[i]),
          mz:       idxs.map(i => data3d.mz[i]),
          mobility: idxs.map(i => data3d.mobility[i]),
          log_int:  idxs.map(i => data3d.log_int[i]),
          charge:   idxs.map(i => data3d.charge[i]),
          n_shown:  idxs.length,
        };
      }, [data3d, filterCharges, filterMzMin, filterMzMax, filterRtMin, filterRtMax, filterOok0Min, filterOok0Max, autoRotate]);

      // ── Per-feature coverage: is each ion inside any isolation window? ────────
      const windowCoverage = useMemo(() => {
        if (!filteredData3d) return null;
        const diaWins = (windowData?.windows || []).filter(w => w.oneoverk0_lower > 0 && w.oneoverk0_upper > 0);
        const pasefEvts = (pasefData?.events || []).filter(e => e.oneoverk0_lower > 0 && e.oneoverk0_upper > 0);
        if (!diaWins.length && !pasefEvts.length) return null;
        const n = filteredData3d.mz.length;
        const flags = new Uint8Array(n); // 0=outside, 1=inside DIA, 2=inside PASEF
        for (let i = 0; i < n; i++) {
          const mz = filteredData3d.mz[i], k0 = filteredData3d.mobility[i];
          for (const w of diaWins) {
            if (mz >= w.mz_lower && mz <= w.mz_upper && k0 >= w.oneoverk0_lower && k0 <= w.oneoverk0_upper) {
              flags[i] = 1; break;
            }
          }
          if (flags[i] === 0) {
            for (const e of pasefEvts) {
              if (mz >= e.mz_lower && mz <= e.mz_upper && k0 >= e.oneoverk0_lower && k0 <= e.oneoverk0_upper) {
                flags[i] = 2; break;
              }
            }
          }
        }
        let nDia = 0, nPasef = 0;
        for (let i = 0; i < n; i++) { if (flags[i] === 1) nDia++; else if (flags[i] === 2) nPasef++; }
        return { flags, n_dia: nDia, n_pasef: nPasef, n_out: n - nDia - nPasef, n_total: n };
      }, [filteredData3d, windowData, pasefData]);

      // ── Auto-rotate animation for 4D Feature Map ────────────────────────
      // Uses Plotly.animate with transition:0 instead of relayout — avoids
      // full scene recalculation on every frame; ~2× faster on large clouds.
      useEffect(() => {
        if (!autoRotate || !plot3dRef.current || !window.Plotly || !filteredData3d) {
          if (rotateAnimRef.current) { cancelAnimationFrame(rotateAnimRef.current); rotateAnimRef.current = null; }
          return;
        }
        const FPS = 15, r = 2.3;   // 15 FPS = visually smooth, half the CPU load of 24
        const step = (ts) => {
          if (ts - rotateLastTimeRef.current >= 1000 / FPS) {
            rotateAngleRef.current += 1.1;  // slightly larger step to compensate lower FPS
            const rad = rotateAngleRef.current * Math.PI / 180;
            const eye = { x: r * Math.cos(rad), y: r * Math.sin(rad), z: 0.8 };
            try {
              // Plotly.animate with duration:0 skips layout diffing — pure GL camera update
              window.Plotly.animate(plot3dRef.current,
                { layout: { 'scene.camera.eye': eye } },
                { transition: { duration: 0 }, frame: { duration: 0, redraw: false } }
              );
            } catch (_) {
              // Fall back to relayout if animate is unavailable (older Plotly)
              window.Plotly.relayout(plot3dRef.current, { 'scene.camera.eye': eye });
            }
            rotateLastTimeRef.current = ts;
          }
          rotateAnimRef.current = requestAnimationFrame(step);
        };
        rotateAnimRef.current = requestAnimationFrame(step);
        return () => { if (rotateAnimRef.current) { cancelAnimationFrame(rotateAnimRef.current); rotateAnimRef.current = null; } };
      }, [autoRotate, filteredData3d]);

      useEffect(() => {
        if (!selectedRun) {
          setMapData(null); setStatsData(null); setWindowData(null); setData3d(null);
          if (plot3dRef.current && window.Plotly) window.Plotly.purge(plot3dRef.current);
          return;
        }
        const ac = new AbortController();
        setPanelLoading(true);
        setMapData(null); setStatsData(null); setWindowData(null); setData3d(null); setPasefData(null);
        Promise.all([
          fetch(API + `/api/runs/${selectedRun.id}/mobility-map`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/mobility-stats`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/dia-windows`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/mobility-3d?max_features=5000`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${selectedRun.id}/pasef-windows`, {signal:ac.signal}).then(r => r.ok ? r.json() : {}),
        ]).then(([map, stats, wins, d3, pasef]) => {
          setMapData(map && map.grid ? map : null);
          setStatsData(stats && Object.keys(stats).length > 0 ? stats : null);
          setWindowData(wins && wins.windows && wins.windows.length > 0 ? wins : null);
          setData3d(d3 && d3.rt && d3.rt.length > 0 ? d3 : null);
          setPasefData(pasef && pasef.events && pasef.events.length > 0 ? pasef : null);
          setPanelLoading(false);
        }).catch(e => { if (e.name !== 'AbortError') setPanelLoading(false); });
        return () => ac.abort();
      }, [selectedRun?.id]);

      useEffect(() => {
        if (!mapData || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        // Margins for axes
        const PAD_L = 58, PAD_B = 38, PAD_T = 10, PAD_R = 10;
        const plotW = W - PAD_L - PAD_R;
        const plotH = H - PAD_T - PAD_B;

        const grid = mapData.grid;
        const rtBins = grid.length, mobBins = grid[0].length;
        let maxVal = 0;
        for (const row of grid) for (const v of row) if (v > maxVal) maxVal = v;

        const stops = [[0,[9,9,121]],[0.25,[0,108,180]],[0.5,[0,173,183]],[0.75,[100,200,100]],[1.0,[218,170,0]]];
        function valToRgb(v) {
          const t = maxVal > 0 ? v / maxVal : 0;
          for (let i = 0; i < stops.length - 1; i++) {
            const [t0,c0] = stops[i], [t1,c1] = stops[i+1];
            if (t >= t0 && t <= t1) {
              const f = (t-t0)/(t1-t0);
              return [Math.round(c0[0]+f*(c1[0]-c0[0])),Math.round(c0[1]+f*(c1[1]-c0[1])),Math.round(c0[2]+f*(c1[2]-c0[2]))];
            }
          }
          return stops[stops.length-1][1];
        }

        // Clear background
        ctx.fillStyle = '#011a3a';
        ctx.fillRect(0, 0, W, H);

        // Draw grid cells
        const cw = plotW / mobBins, ch = plotH / rtBins;
        for (let ri = 0; ri < rtBins; ri++) {
          for (let mi = 0; mi < mobBins; mi++) {
            const v = grid[ri][mi];
            if (v < 0.001) continue;
            const [r,g,b] = valToRgb(v);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            // ri=0 is lowest RT → bottom of plot; flip so low RT is left
            const px = PAD_L + mi * cw;
            const py = PAD_T + (rtBins - 1 - ri) * ch;
            ctx.fillRect(px, py, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
          }
        }

        // ── Axes ─────────────────────────────────────────────────────
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_L, PAD_T); ctx.lineTo(PAD_L, PAD_T + plotH);
        ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
        ctx.stroke();

        ctx.fillStyle = '#a0b4cc';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';

        // X-axis ticks (RT) — use rt_edges
        const rtEdges = mapData.rt_edges || [];
        const nXTicks = 7;
        const xStep = Math.max(1, Math.floor(rtEdges.length / nXTicks));
        for (let i = 0; i <= rtBins; i += xStep) {
          const px = PAD_L + (i / rtBins) * plotW;
          const py = PAD_T + plotH;
          ctx.strokeStyle = 'rgba(30,58,95,0.7)';
          ctx.beginPath(); ctx.moveTo(px, PAD_T); ctx.lineTo(px, py + 4); ctx.stroke();
          if (rtEdges[i] != null) {
            const label = `${(rtEdges[i] / 60).toFixed(1)}`;
            ctx.fillStyle = '#a0b4cc';
            ctx.fillText(label, px, py + 14);
          }
        }
        // X-axis label
        ctx.fillStyle = '#7090a8';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('Retention Time (min)', PAD_L + plotW / 2, H - 4);

        // Y-axis ticks (1/K₀) — use mobility_edges
        const mobEdges = mapData.mobility_edges || [];
        const nYTicks = 5;
        const yStep = Math.max(1, Math.floor(mobEdges.length / nYTicks));
        ctx.textAlign = 'right';
        for (let i = 0; i <= mobBins; i += yStep) {
          // i=0 → bottom of plot (low mobility), i=mobBins → top (high mobility)
          const py = PAD_T + plotH - (i / mobBins) * plotH;
          ctx.strokeStyle = 'rgba(30,58,95,0.7)';
          ctx.beginPath(); ctx.moveTo(PAD_L - 4, py); ctx.lineTo(PAD_L + plotW, py); ctx.stroke();
          if (mobEdges[i] != null) {
            ctx.fillStyle = '#a0b4cc';
            ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillText(mobEdges[i].toFixed(3), PAD_L - 6, py + 3);
          }
        }
        // Y-axis label (rotated)
        ctx.save();
        ctx.translate(12, PAD_T + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7090a8';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('1/K₀ (Vs/cm²)', 0, 0);
        ctx.restore();
      }, [mapData]);

      // Render Plotly 3D scatter when filteredData3d changes
      useEffect(() => {
        if (!plot3dRef.current || !window.Plotly) return;
        if (!filteredData3d) { window.Plotly.purge(plot3dRef.current); return; }

        const charges = [...new Set(filteredData3d.charge)].sort((a,b) => a-b);
        const hasCoverage = windowCoverage && (showWindowOverlay || showPasefOverlay);

        let traces;
        if (hasCoverage) {
          // Coverage mode: colour by inside/outside window instead of charge
          const { flags } = windowCoverage;
          const n = filteredData3d.mz.length;
          const insideIdx = [], outsideIdx = [];
          for (let i = 0; i < n; i++) { if (flags[i] > 0) insideIdx.push(i); else outsideIdx.push(i); }
          const li = filteredData3d.log_int;
          const liAll = [...li]; const liMin = Math.min(...liAll), liMax = Math.max(...liAll);
          const norm = i => liMax > liMin ? (li[i]-liMin)/(liMax-liMin) : 0.5;
          traces = [];
          // Outside ions: split z=1 so they're never lost in the dark background
          const outsideZ1   = outsideIdx.filter(i => filteredData3d.charge[i] === 1);
          const outsideRest = outsideIdx.filter(i => filteredData3d.charge[i] !== 1);
          if (outsideRest.length) traces.push({
            type:'scatter3d', mode:'markers', name:'Outside window',
            x:outsideRest.map(i=>+(filteredData3d.rt[i]/60).toFixed(3)),
            y:outsideRest.map(i=>filteredData3d.mz[i]),
            z:outsideRest.map(i=>filteredData3d.mobility[i]),
            marker:{size:outsideRest.map(i=>1+norm(i)*2), color:'#1e3a5f', opacity:0.45, line:{width:0}},
            hovertemplate:'Outside<br>m/z %{y:.3f}<br>RT %{x:.2f}min<br>1/K₀ %{z:.4f}<extra></extra>',
          });
          if (outsideZ1.length) traces.push({
            type:'scatter3d', mode:'markers', name:'Outside · z=+1',
            x:outsideZ1.map(i=>+(filteredData3d.rt[i]/60).toFixed(3)),
            y:outsideZ1.map(i=>filteredData3d.mz[i]),
            z:outsideZ1.map(i=>filteredData3d.mobility[i]),
            marker:{size:outsideZ1.map(i=>2+norm(i)*2.5), color:'#2dd4bf', opacity:0.75, line:{width:0}},
            hovertemplate:'Outside · z=+1<br>m/z %{y:.3f}<br>RT %{x:.2f}min<br>1/K₀ %{z:.4f}<extra></extra>',
          });
          // Inside — split by window type
          const diaInside = insideIdx.filter(i => flags[i] === 1);
          const pasefInside = insideIdx.filter(i => flags[i] === 2);
          if (diaInside.length) {
            const chargesIn = [...new Set(diaInside.map(i=>filteredData3d.charge[i]))].sort((a,b)=>a-b);
            chargesIn.forEach(z => {
              const zIdx = diaInside.filter(i=>filteredData3d.charge[i]===z);
              traces.push({
                type:'scatter3d', mode:'markers', name: z===0?'Inside DIA · ?':`Inside DIA · z=${z}`,
                x:zIdx.map(i=>+(filteredData3d.rt[i]/60).toFixed(3)),
                y:zIdx.map(i=>filteredData3d.mz[i]),
                z:zIdx.map(i=>filteredData3d.mobility[i]),
                marker:{size:zIdx.map(i=>1.8+norm(i)*3.2), color:CHARGE_COLORS[z]||'#94a3b8', opacity:0.85, line:{width:0}},
                text:zIdx.map(i=>`INSIDE window · z=${z}<br>m/z ${filteredData3d.mz[i].toFixed(4)}<br>RT ${(filteredData3d.rt[i]/60).toFixed(2)} min<br>1/K₀ ${filteredData3d.mobility[i].toFixed(4)}`),
                hovertemplate:'%{text}<extra></extra>',
              });
            });
          }
          if (pasefInside.length) traces.push({
            type:'scatter3d', mode:'markers', name:'Inside PASEF',
            x:pasefInside.map(i=>+(filteredData3d.rt[i]/60).toFixed(3)),
            y:pasefInside.map(i=>filteredData3d.mz[i]),
            z:pasefInside.map(i=>filteredData3d.mobility[i]),
            marker:{size:pasefInside.map(i=>1.8+norm(i)*3), color:'#fbbf24', opacity:0.85, line:{width:0}},
            hovertemplate:'INSIDE PASEF<br>m/z %{y:.3f}<br>RT %{x:.2f}min<br>1/K₀ %{z:.4f}<extra></extra>',
          });
        } else {
          // Default: colour by charge
          traces = charges.map(z => {
            const idx = filteredData3d.charge.reduce((acc,c,i) => { if (c===z) acc.push(i); return acc; }, []);
            const li = idx.map(i => filteredData3d.log_int[i]);
            const liMin = Math.min(...li), liMax = Math.max(...li);
            const norm = liMax > liMin ? li.map(v => (v-liMin)/(liMax-liMin)) : li.map(()=>0.5);
            return {
              type: 'scatter3d', mode: 'markers',
              name: z === 0 ? 'Unassigned (?)' : `z = ${z}`,
              x: idx.map(i => +(filteredData3d.rt[i] / 60).toFixed(3)),
              y: idx.map(i => filteredData3d.mz[i]),
              z: idx.map(i => filteredData3d.mobility[i]),
              marker: {
                size: norm.map(v => (z === 0 ? 1.2 : 1.5) + v * 3.5),
                color: CHARGE_COLORS[z] || '#eab308',
                opacity: 0.72,
                line: { width: 0 },
              },
              text: idx.map(i =>
                `${z === 0 ? 'Unassigned' : `z=${z}`}  m/z ${filteredData3d.mz[i].toFixed(4)}<br>` +
                `RT ${(filteredData3d.rt[i] / 60).toFixed(2)} min<br>` +
                `1/K₀ ${filteredData3d.mobility[i].toFixed(4)} Vs/cm²<br>` +
                `log₁₀I ${filteredData3d.log_int[i].toFixed(2)}`
              ),
              hovertemplate: '%{text}<extra></extra>',
            };
          });
        }

        // ── diaPASEF 3D window boxes ─────────────────────────────────────────
        if (showWindowOverlay && windowData?.windows?.length) {
          const groups = [...new Set(windowData.windows.map(w => w.window_group))];
          const rtMin = filteredData3d ? Math.min(...filteredData3d.rt) / 60 : 0;
          const rtMax = filteredData3d ? Math.max(...filteredData3d.rt) / 60 : 60;

          windowData.windows.forEach(ww => {
            const col = winColor(groups.indexOf(ww.window_group));
            // Use per-window RT if available, else fall back to full run span
            const rt0 = ww.rt_begin_sec > 0 ? ww.rt_begin_sec / 60 : rtMin;
            const rt1 = ww.rt_end_sec   > 0 ? ww.rt_end_sec   / 60 : rtMax;
            const mz0 = ww.mz_lower, mz1 = ww.mz_upper;
            const k0  = ww.oneoverk0_lower, k1 = ww.oneoverk0_upper;
            if (k0 <= 0 || k1 <= 0) return;

            // 8 box vertices: x=RT, y=m/z, z=1/K₀
            const bx = [rt0,rt1,rt1,rt0, rt0,rt1,rt1,rt0];
            const by = [mz0,mz0,mz1,mz1, mz0,mz0,mz1,mz1];
            const bz = [k0, k0, k0, k0,  k1, k1, k1, k1 ];

            // Semi-transparent filled box (mesh3d)
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            traces.push({
              type: 'mesh3d',
              x: bx, y: by, z: bz,
              // 12 triangles covering all 6 faces
              i: [0,0, 4,4, 0,0, 2,2, 0,0, 1,1],
              j: [1,3, 5,7, 1,5, 3,7, 3,7, 2,5],
              k: [2,2, 6,6, 5,4, 7,6, 7,4, 6,6],
              color: col,
              opacity: 0.10,
              name: `Group ${ww.window_group}`,
              showlegend: false,
              hoverinfo: 'none',
            });

            // Wireframe edges (scatter3d lines)
            const ex = [], ey = [], ez = [];
            [[0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4], [0,4],[1,5],[2,6],[3,7]].forEach(([a,bb]) => {
              ex.push(bx[a], bx[bb], null);
              ey.push(by[a], by[bb], null);
              ez.push(bz[a], bz[bb], null);
            });
            traces.push({
              type: 'scatter3d', mode: 'lines',
              name: `Group ${ww.window_group}`,
              x: ex, y: ey, z: ez,
              line: { color: `rgba(${r},${g},${b},0.70)`, width: 1.5 },
              showlegend: false,
              hovertemplate:
                `<b>diaPASEF group ${ww.window_group}</b><br>` +
                `m/z ${mz0.toFixed(1)}–${mz1.toFixed(1)} Da<br>` +
                `1/K₀ ${k0.toFixed(3)}–${k1.toFixed(3)} Vs/cm²<br>` +
                `RT ${rt0.toFixed(1)}–${rt1.toFixed(1)} min<extra></extra>`,
            });
          });
        }

        // ── ddaPASEF event boxes (PASEF overlay) ─────────────────────────────
        if (showPasefOverlay && pasefData?.events?.length) {
          const xs = [], ys = [], zs = [];
          pasefData.events.forEach(ev => {
            const rt = ev.rt_sec / 60;
            if (ev.oneoverk0_lower <= 0) return;
            // Thin box: RT dimension is essentially a line (no RT width per event)
            // Show as a vertical line segment at the event RT
            xs.push(rt, rt, null);
            ys.push((ev.mz_lower + ev.mz_upper) / 2, (ev.mz_lower + ev.mz_upper) / 2, null);
            zs.push(ev.oneoverk0_lower, ev.oneoverk0_upper, null);
          });
          traces.push({
            type: 'scatter3d', mode: 'lines',
            name: 'PASEF events',
            x: xs, y: ys, z: zs,
            line: { color: 'rgba(251,191,36,0.45)', width: 1.0 },
            showlegend: true,
            hoverinfo: 'none',
          });
        }

        const darkBg = '#011a3a', axisColor = '#a0b4cc', gridColor = '#1e3a5f';
        const axisStyle = {
          color: axisColor, gridcolor: gridColor, zerolinecolor: gridColor,
          backgroundcolor: '#022851', showbackground: true,
        };
        const layout = {
          paper_bgcolor: darkBg,
          plot_bgcolor: darkBg,
          font: { color: axisColor, size: 11, family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' },
          margin: { l: 0, r: 0, t: 0, b: 0 },
          legend: { bgcolor: 'rgba(1,26,58,0.8)', bordercolor: gridColor, borderwidth: 1, font: { size: 11 } },
          scene: {
            xaxis: { ...axisStyle, title: { text: 'RT (min)', font: { color: axisColor } } },
            yaxis: { ...axisStyle, title: { text: 'm/z (Th)', font: { color: axisColor } } },
            zaxis: { ...axisStyle, title: { text: '1/K₀ (Vs/cm²)', font: { color: axisColor } } },
            camera: { eye: { x: 1.5, y: -1.5, z: 0.8 } },
          },
        };
        const config = { displayModeBar: true, modeBarButtonsToRemove: ['toImage'], responsive: true };
        window.Plotly.react(plot3dRef.current, traces, layout, config);

        // ── Click-to-inspect on 3D scatter ──────────────────────────────────
        // pt.x = RT (min), pt.y = m/z, pt.z = 1/K₀ (as set in trace arrays)
        const div3d = plot3dRef.current;
        div3d.removeAllListeners?.('plotly_click');
        div3d.on('plotly_click', (evt) => {
          if (!evt.points?.length) return;
          const pt = evt.points[0];
          const rtSec = pt.x * 60;
          const mz    = pt.y;
          const ook0  = pt.z;
          // Parse charge from trace name "z = 2" or "Unassigned (?)"
          const nameMatch = (pt.data?.name || '').match(/z\s*=\s*(\d+)/);
          const charge = nameMatch ? Number(nameMatch[1]) : 0;
          setIonTarget({ mz, rt: rtSec, ook0, charge });
          setAutoRotate(false);   // pause rotation so detail panel is easy to use
        });

        // Stop auto-rotation when user drags (mousedown on the plot div)
        const onPlot3dMouseDown = () => setAutoRotate(false);
        div3d.addEventListener('mousedown', onPlot3dMouseDown);
        return () => {
          div3d.removeAllListeners?.('plotly_click');
          div3d.removeEventListener('mousedown', onPlot3dMouseDown);
        };
      }, [filteredData3d, showWindowOverlay, windowData, showPasefOverlay, pasefData]);

      // ── m/z × 1/K₀ landscape (PEAKS-style surface) ──────────────────
      useEffect(() => {
        if (!mzLandscapeRef.current || !window.Plotly) return;
        if (!filteredData3d) { window.Plotly.purge(mzLandscapeRef.current); return; }

        const MZ_BINS = 70, MOB_BINS = 55;
        const mzArr = filteredData3d.mz, mobArr = filteredData3d.mobility;
        const liArr = filteredData3d.log_int, chArr = filteredData3d.charge;

        const mzMin = Math.min(...mzArr), mzMax = Math.max(...mzArr);
        const mobMin = Math.min(...mobArr), mobMax = Math.max(...mobArr);
        if (mzMax <= mzMin || mobMax <= mobMin) return;

        const mzStep  = (mzMax  - mzMin)  / MZ_BINS;
        const mobStep = (mobMax - mobMin) / MOB_BINS;

        // Build intensity surface grid (max log_int per bin)
        const grid = Array.from({length: MOB_BINS}, () => new Array(MZ_BINS).fill(0));
        mzArr.forEach((mz, i) => {
          const mi = Math.min(Math.floor((mz       - mzMin)  / mzStep),  MZ_BINS  - 1);
          const ki = Math.min(Math.floor((mobArr[i] - mobMin) / mobStep), MOB_BINS - 1);
          grid[ki][mi] = Math.max(grid[ki][mi], liArr[i]);
        });

        const xLabels = Array.from({length: MZ_BINS},  (_, i) => +(mzMin  + (i + 0.5) * mzStep).toFixed(1));
        const yLabels = Array.from({length: MOB_BINS}, (_, i) => +(mobMin + (i + 0.5) * mobStep).toFixed(4));

        // Surface trace — intensity landscape
        const surface = {
          type: 'surface',
          x: xLabels, y: yLabels, z: grid,
          colorscale: [
            [0.00, '#011a3a'], [0.12, '#062d6e'], [0.30, '#0d6ea8'],
            [0.50, '#00b4b4'], [0.70, '#7dda58'], [0.88, '#daa900'], [1.00, '#ff5500'],
          ],
          showscale: true,
          colorbar: {
            title: { text: 'log₁₀(I)', font: { color: '#a0b4cc', size: 10 } },
            thickness: 12, len: 0.65,
            tickfont: { color: '#a0b4cc', size: 9 },
          },
          lighting: { ambient: 0.6, diffuse: 0.85, specular: 0.15, roughness: 0.6, fresnel: 0.1 },
          hovertemplate: 'm/z %{x:.1f} Th<br>1/K₀ %{y:.4f} Vs/cm²<br>log₁₀I %{z:.2f}<extra></extra>',
          opacity: 0.92,
        };

        // Scatter overlay — charge-coloured points on the surface
        const chargeOverlay = [...new Set(chArr)].sort((a,b)=>a-b).map(z => {
          const idx = chArr.reduce((a,c,i) => { if(c===z) a.push(i); return a; }, []);
          return {
            type: 'scatter3d', mode: 'markers',
            name: z === 0 ? 'Unassigned (?)' : `z = ${z}`,
            x: idx.map(i => mzArr[i]),
            y: idx.map(i => mobArr[i]),
            z: idx.map(i => liArr[i] + 0.05),  // slightly above surface
            marker: { size: 1.8, color: CHARGE_COLORS[z] || '#94a3b8', opacity: z === 0 ? 0.3 : 0.55, line:{width:0} },
            hovertemplate: `${z === 0 ? 'Unassigned' : `z=${z}`}  m/z %{x:.4f}<br>1/K₀ %{y:.4f}<br>log₁₀I %{z:.2f}<extra></extra>`,
            showlegend: true,
          };
        });

        const darkBg = '#011a3a', axisColor = '#a0b4cc', gridColor = '#1e3a5f';
        const axisStyle = {
          color: axisColor, gridcolor: gridColor, zerolinecolor: gridColor,
          backgroundcolor: '#022851', showbackground: true,
        };
        const layout = {
          paper_bgcolor: darkBg, plot_bgcolor: darkBg,
          font: { color: axisColor, size: 11, family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' },
          margin: { l: 0, r: 0, t: 0, b: 0 },
          legend: { bgcolor: 'rgba(1,26,58,0.8)', bordercolor: gridColor, borderwidth: 1, font:{size:10} },
          scene: {
            xaxis: { ...axisStyle, title: { text: 'm/z (Th)',        font:{color:axisColor} } },
            yaxis: { ...axisStyle, title: { text: '1/K₀ (Vs/cm²)',   font:{color:axisColor} } },
            zaxis: { ...axisStyle, title: { text: 'log₁₀(Intensity)', font:{color:axisColor} } },
            camera: { eye: { x: 1.6, y: -1.8, z: 1.1 } },
            aspectmode: 'manual',
            aspectratio: { x: 1.4, y: 0.9, z: 0.65 },
          },
        };
        const config = { displayModeBar: true, modeBarButtonsToRemove: ['toImage'], responsive: true };
        window.Plotly.react(mzLandscapeRef.current, [surface, ...chargeOverlay], layout, config);
      }, [filteredData3d]);

      // ── Waterfall spectrum (PEAKS-style: vertical spikes stacked by mobility) ──
      useEffect(() => {
        if (!waterfallRef.current || !window.Plotly) return;
        if (!filteredData3d) { window.Plotly.purge(waterfallRef.current); return; }

        const { mz: mzArr, mobility: mobArr, log_int: liArr, charge: chArr } = filteredData3d;

        // Normalise intensities to 0-100 within each mobility layer so
        // every layer has comparable spike heights (like PEAKS)
        const MOB_LAYERS = 60;
        const mobMin = Math.min(...mobArr), mobMax = Math.max(...mobArr);
        if (mobMax <= mobMin) return;
        const mobStep = (mobMax - mobMin) / MOB_LAYERS;

        // Group by layer
        const layers = Array.from({length: MOB_LAYERS}, () => []);
        mzArr.forEach((mz, i) => {
          const li = Math.min(Math.floor((mobArr[i] - mobMin) / mobStep), MOB_LAYERS - 1);
          layers[li].push(i);
        });

        // Build one scatter3d per charge state (so legend/colours work)
        const charges = [...new Set(chArr)].sort((a,b) => a-b);

        const traces = charges.map(z => {
          const xs = [], ys = [], zs = [];
          layers.forEach((idxs, li) => {
            const layerIdxs = idxs.filter(i => chArr[i] === z);
            if (!layerIdxs.length) return;
            const layerMob = mobMin + (li + 0.5) * mobStep;
            // Max intensity in this layer (for normalisation)
            const layerMax = Math.max(...layerIdxs.map(i => liArr[i]));
            // Sort by m/z so spikes are in order
            layerIdxs.sort((a,b) => mzArr[a] - mzArr[b]);
            layerIdxs.forEach(i => {
              const normH = layerMax > 0 ? (liArr[i] / layerMax) * 100 : 0;
              xs.push(mzArr[i], mzArr[i], null);
              ys.push(layerMob,  layerMob,  null);
              zs.push(0,         normH,     null);
            });
          });
          return {
            type: 'scatter3d', mode: 'lines',
            name: z === 0 ? 'Unassigned (?)' : `z = ${z}`,
            x: xs, y: ys, z: zs,
            line: { color: CHARGE_COLORS[z] || '#94a3b8', width: z === 0 ? 1.0 : 1.5 },
            opacity: z === 0 ? 0.45 : 1,
            hoverinfo: 'skip',
          };
        });

        // Flat base-plane outline at z=0 (gives the PEAKS "floor" look)
        const mzMin2 = Math.min(...mzArr), mzMax2 = Math.max(...mzArr);
        const floorTrace = {
          type: 'scatter3d', mode: 'lines',
          name: 'base', showlegend: false,
          x: [mzMin2, mzMax2, mzMax2, mzMin2, mzMin2],
          y: [mobMin,  mobMin,  mobMax,  mobMax,  mobMin],
          z: [0,       0,       0,       0,       0],
          line: { color: 'rgba(100,140,180,0.25)', width: 1 },
          hoverinfo: 'skip',
        };

        // Mobility "wall" lines — faint grid lines along Y at fixed mz positions
        const gridMz = Array.from({length: 7}, (_, i) => mzMin2 + (i/(6)) * (mzMax2-mzMin2));
        const gridTraces = gridMz.map(gMz => ({
          type: 'scatter3d', mode: 'lines', showlegend: false,
          x: [gMz, gMz], y: [mobMin, mobMax], z: [0, 0],
          line: { color: 'rgba(100,140,180,0.12)', width: 1 },
          hoverinfo: 'skip',
        }));

        const darkBg = '#011a3a', axisColor = '#a0b4cc', gridColor = '#0d2b5e';
        const axisStyle = {
          color: axisColor, gridcolor: gridColor, zerolinecolor: gridColor,
          backgroundcolor: '#011f4a', showbackground: true,
        };
        const layout = {
          paper_bgcolor: darkBg, plot_bgcolor: darkBg,
          font: { color: axisColor, size: 11, family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' },
          margin: { l: 0, r: 0, t: 0, b: 0 },
          legend: { bgcolor: 'rgba(1,26,58,0.85)', bordercolor: '#1e3a5f', borderwidth: 1, font:{size:10} },
          scene: {
            xaxis: { ...axisStyle, title: { text: 'm/z (Th)',          font:{color:axisColor} } },
            yaxis: { ...axisStyle, title: { text: '1/K₀ (Vs/cm²)',     font:{color:axisColor} } },
            zaxis: { ...axisStyle, title: { text: 'Relative intensity', font:{color:axisColor} },
                     range: [0, 110] },
            camera: { eye: { x: 2.0, y: -2.2, z: 0.85 },
                      up:  { x: 0,   y: 0,    z: 1   } },
            aspectmode: 'manual',
            aspectratio: { x: 1.6, y: 1.0, z: 0.55 },
          },
        };
        const config = { displayModeBar: true, modeBarButtonsToRemove: ['toImage'], responsive: true };
        window.Plotly.react(waterfallRef.current, [floorTrace, ...gridTraces, ...traces], layout, config);
      }, [filteredData3d]);

      // ── Ion cloud: m/z vs 1/K₀ (Tenzer / Gomez-Zepeda style) ────────────
      useEffect(() => {
        if (!cloudMzRef.current || !window.Plotly) return;
        if (!filteredData3d || filteredData3d.n_shown === 0) { window.Plotly.purge(cloudMzRef.current); return; }
        const { mz, mobility, charge: chArr, n_shown } = filteredData3d;
        const idx = Array.from({length:n_shown}, (_,i)=>i);
        const chargeSet = [...new Set(chArr)].sort((a,b)=>a-b);
        const traces = chargeSet.map(z => {
          const ii = idx.filter(i => chArr[i] === z);
          return {
            type:'scatter', mode:'markers', name: z === 0 ? 'Unassigned (?)' : `z=${z}`,
            x: ii.map(i => mz[i]),
            y: ii.map(i => mobility[i]),
            marker:{size: z === 0 ? 2 : 2.5, color:CHARGE_COLORS[z]||'#eab308', opacity:0.55},
            hovertemplate:`m/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>${z===0?'Unassigned':`z=${z}`}<extra></extra>`,
          };
        });

        // ── Method overlay ────────────────────────────────────────────────────
        // Invisible scatter trace at window centres → hover shows window info
        if (showWindowOverlay && windowData?.windows?.length) {
          traces.push({
            type:'scatter', mode:'markers',
            name:'diaPASEF windows',
            x: windowData.windows.map(ww => (ww.mz_lower + ww.mz_upper) / 2),
            y: windowData.windows.map(ww =>
              ww.oneoverk0_lower > 0
                ? (ww.oneoverk0_lower + ww.oneoverk0_upper) / 2
                : 1.1
            ),
            marker:{ size:14, opacity:0, color:'transparent' },
            hovertemplate: windowData.windows.map(ww => {
              const k0str = ww.oneoverk0_lower > 0
                ? `1/K₀ ${ww.oneoverk0_lower.toFixed(3)}–${ww.oneoverk0_upper.toFixed(3)} Vs/cm²<br>`
                : '';
              return `<b>Window group ${ww.window_group}</b><br>m/z ${ww.mz_lower.toFixed(1)}–${ww.mz_upper.toFixed(1)} Da<br>${k0str}<extra>diaPASEF</extra>`;
            }),
            showlegend: true,
          });
        }

        // Rectangle shapes — one per diaPASEF window, coloured by window group
        const cleanShapes = [];
        if (showWindowOverlay && windowData?.windows?.length) {
          const groups = [...new Set(windowData.windows.map(w => w.window_group))];
          windowData.windows.forEach(ww => {
            const col = winColor(groups.indexOf(ww.window_group));
            const hasK0 = ww.oneoverk0_lower > 0 || ww.oneoverk0_upper > 0;
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            cleanShapes.push({
              type:'rect',
              x0: ww.mz_lower, x1: ww.mz_upper,
              y0: hasK0 ? ww.oneoverk0_lower : 0.55,
              y1: hasK0 ? ww.oneoverk0_upper : 1.65,
              fillcolor: `rgba(${r},${g},${b},0.10)`,
              line:{ color: `rgba(${r},${g},${b},0.75)`, width: 1.2 },
            });
          });
        }

        // PASEF event rectangles — each precursor isolation box in m/z × 1/K₀
        if (showPasefOverlay && pasefData?.events?.length) {
          pasefData.events.forEach(ev => {
            cleanShapes.push({
              type:'rect',
              x0: ev.mz_lower, x1: ev.mz_upper,
              y0: ev.oneoverk0_lower > 0 ? ev.oneoverk0_lower : 0.6,
              y1: ev.oneoverk0_upper > 0 ? ev.oneoverk0_upper : 1.6,
              fillcolor: 'rgba(251,191,36,0.04)',
              line:{ color: 'rgba(251,191,36,0.50)', width: 0.8 },
            });
          });
        }

        Plotly.react(cloudMzRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.3)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes: cleanShapes,
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage','sendDataToCloud','editInChartStudio']});

        // ── Click-to-inspect: attach after every Plotly.react so handler is fresh ──
        // (useEffect deps on ref.current are not reactive — must wire here)
        const div = cloudMzRef.current;
        div.removeAllListeners?.('plotly_click');
        div.removeAllListeners?.('plotly_selected');
        div.on('plotly_click', (evt) => {
          if (!evt.points?.length) return;
          const pt = evt.points[0];
          // pt.x = m/z, pt.y = 1/K₀ from the scatter trace
          const clickMz  = pt.x;
          const clickOok0 = pt.y;
          const d3  = filteredData3dRef.current;
          let rt = 0, charge = 2;
          if (d3?.mz?.length) {
            let best = Infinity;
            for (let i = 0; i < d3.mz.length; i++) {
              // normalised distance: ppm on m/z + scaled distance on 1/K₀
              const dm = Math.abs(d3.mz[i] - clickMz) / clickMz;
              const dk = Math.abs(d3.mobility[i] - clickOok0) * 3;
              const dist = dm + dk;
              if (dist < best) { best = dist; rt = d3.rt[i]; charge = d3.charge ? d3.charge[i] : 2; }
            }
          }
          setIonTarget({ mz: clickMz, rt, ook0: clickOok0, charge });
        });
        // Box-select to filter: drag a selection rectangle → update m/z + 1/K₀ filter state
        div.on('plotly_selected', (evt) => {
          if (!evt?.range) return;
          const [x0, x1] = evt.range.x.map(v => +v.toFixed(2));
          const [y0, y1] = evt.range.y.map(v => +v.toFixed(4));
          setFilterMzMin(String(Math.min(x0, x1)));
          setFilterMzMax(String(Math.max(x0, x1)));
          setFilterOok0Min(String(Math.min(y0, y1)));
          setFilterOok0Max(String(Math.max(y0, y1)));
          setShowFilters(true);
        });
      }, [filteredData3d, showWindowOverlay, windowData, showPasefOverlay, pasefData]);

      // ── Ion cloud: RT vs 1/K₀ (Kulej / MSKCC style) ─────────────────────
      useEffect(() => {
        if (!cloudRtRef.current || !window.Plotly) return;
        if (!filteredData3d || filteredData3d.n_shown === 0) { window.Plotly.purge(cloudRtRef.current); return; }
        const { rt, mobility, charge: chArr, n_shown } = filteredData3d;
        const idx = Array.from({length:n_shown}, (_,i)=>i);
        const chargeSet = [...new Set(chArr)].sort((a,b)=>a-b);
        const traces = chargeSet.map(z => {
          const ii = idx.filter(i => chArr[i] === z);
          return {
            type:'scatter', mode:'markers', name: z === 0 ? 'Unassigned (?)' : `z=${z}`,
            x: ii.map(i => +(rt[i] / 60).toFixed(3)),
            y: ii.map(i => mobility[i]),
            marker:{size:2.5, color:CHARGE_COLORS[z]||'#94a3b8', opacity: z === 0 ? 0.35 : 0.55},
            hovertemplate:`RT %{x:.2f} min<br>1/K₀ %{y:.4f}<br>${z===0?'Unassigned':`z=${z}`}<extra></extra>`,
          };
        });

        // ── Window overlay: horizontal bands (1/K₀ range) per window group ──
        // In RT×1/K₀ space, diaPASEF windows appear as horizontal strips
        const rtShapes = [];
        if (showWindowOverlay && windowData?.windows?.length) {
          const groups = [...new Set(windowData.windows.map(w => w.window_group))];
          windowData.windows.forEach(ww => {
            if (ww.oneoverk0_lower <= 0) return;
            const col = winColor(groups.indexOf(ww.window_group));
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            const hasRt = ww.rt_begin_sec > 0 && ww.rt_end_sec > 0;
            rtShapes.push({
              type: 'rect',
              xref: hasRt ? 'x' : 'paper',
              x0: hasRt ? ww.rt_begin_sec / 60 : 0,
              x1: hasRt ? ww.rt_end_sec   / 60 : 1,
              yref: 'y',
              y0: ww.oneoverk0_lower, y1: ww.oneoverk0_upper,
              fillcolor: `rgba(${r},${g},${b},0.09)`,
              line: { color: `rgba(${r},${g},${b},0.55)`, width: 1 },
            });
          });
        }

        // ── PASEF overlay: event dots in RT×1/K₀ space ───────────────────────
        if (showPasefOverlay && pasefData?.events?.length) {
          traces.push({
            type:'scatter', mode:'markers',
            name:'PASEF events',
            x: pasefData.events.map(e => e.rt_sec / 60),
            y: pasefData.events.map(e => (e.oneoverk0_lower + e.oneoverk0_upper) / 2),
            marker:{ size:3, color:'rgba(251,191,36,0.45)', symbol:'line-ns', line:{color:'rgba(251,191,36,0.70)',width:1} },
            hovertemplate:'RT %{x:.2f} min<br>1/K₀ %{y:.3f}<br>PASEF event<extra></extra>',
          });
        }

        Plotly.react(cloudRtRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:45},
          xaxis:{title:{text:'RT (min)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.3)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes: rtShapes,
        }, {responsive:true, scrollZoom:true, modeBarButtonsToRemove:['toImage','sendDataToCloud','editInChartStudio']});

        // ── Click-to-inspect on RT × 1/K₀ chart ────────────────────────────────
        const divRt = cloudRtRef.current;
        divRt.removeAllListeners?.('plotly_click');
        divRt.removeAllListeners?.('plotly_selected');
        divRt.on('plotly_click', (evt) => {
          if (!evt.points?.length) return;
          const pt = evt.points[0];
          const clickRtSec = pt.x * 60;   // x axis is RT in minutes
          const clickOok0  = pt.y;
          const d3 = filteredData3dRef.current;
          let mz = 800, charge = 2;
          if (d3?.rt?.length) {
            let best = Infinity;
            for (let i = 0; i < d3.rt.length; i++) {
              const dr = Math.abs(d3.rt[i] - clickRtSec) / (d3.rt[d3.rt.length-1] || 3600);
              const dk = Math.abs(d3.mobility[i] - clickOok0) * 3;
              const dist = dr + dk;
              if (dist < best) { best = dist; mz = d3.mz[i]; charge = d3.charge ? d3.charge[i] : 2; }
            }
          }
          setIonTarget({ mz, rt: clickRtSec, ook0: clickOok0, charge });
        });
        // Box-select to filter: drag a selection rectangle → update RT + 1/K₀ filter state
        divRt.on('plotly_selected', (evt) => {
          if (!evt?.range) return;
          const [x0, x1] = evt.range.x.map(v => +v.toFixed(2));  // RT in min
          const [y0, y1] = evt.range.y.map(v => +v.toFixed(4));
          setFilterRtMin(String(Math.min(x0, x1)));
          setFilterRtMax(String(Math.max(x0, x1)));
          setFilterOok0Min(String(Math.min(y0, y1)));
          setFilterOok0Max(String(Math.max(y0, y1)));
          setShowFilters(true);
        });
      }, [filteredData3d, showWindowOverlay, windowData, showPasefOverlay, pasefData]);

      // ── Coverage chart: inside vs outside windows in m/z × 1/K₀ ─────────────
      useEffect(() => {
        if (!coverageRef.current || !window.Plotly) return;
        if (!filteredData3d || !windowCoverage) { window.Plotly.purge(coverageRef.current); return; }
        const { flags, n_total } = windowCoverage;
        const diaIdx = [], pasefIdx = [], outIdx = [];
        for (let i = 0; i < n_total; i++) {
          if (flags[i] === 1) diaIdx.push(i);
          else if (flags[i] === 2) pasefIdx.push(i);
          else outIdx.push(i);
        }
        const { mz, mobility, charge: chArr } = filteredData3d;

        const traces = [];
        // Outside ions — dim gray behind, but z=1 always shown in teal so they're never lost
        const outZ1  = outIdx.filter(i => chArr[i] === 1);
        const outRest = outIdx.filter(i => chArr[i] !== 1);
        if (outRest.length) traces.push({
          type:'scatter', mode:'markers', name:'Outside window',
          x: outRest.map(i => mz[i]), y: outRest.map(i => mobility[i]),
          marker:{ size:2, color:'#2a3a4a', opacity:0.5, line:{width:0} },
          hovertemplate:'Outside<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra></extra>',
        });
        // +1 ions outside window — always visible in teal regardless of window coverage
        if (outZ1.length) traces.push({
          type:'scatter', mode:'markers', name:'Outside · z=+1',
          x: outZ1.map(i => mz[i]), y: outZ1.map(i => mobility[i]),
          marker:{ size:4, color:'#2dd4bf', opacity:0.75, line:{width:0} },
          hovertemplate:'Outside window · z=+1<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra></extra>',
        });
        // DIA inside — teal, by charge
        if (diaIdx.length) {
          const chargesPresent = [...new Set(diaIdx.map(i => chArr[i]))].sort((a,b)=>a-b);
          chargesPresent.forEach(z => {
            const ii = diaIdx.filter(i => chArr[i] === z);
            const col = CHARGE_COLORS[z] || '#94a3b8';
            traces.push({
              type:'scatter', mode:'markers', name: z===0?'Inside · Unassigned':`Inside · z=${z}`,
              x: ii.map(i=>mz[i]), y: ii.map(i=>mobility[i]),
              marker:{ size: z===1?4:3, color:col, opacity:0.8, line:{width:0} },
              hovertemplate:`Inside window<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>${z===0?'z=?':`z=${z}`}<extra></extra>`,
            });
          });
        }
        // PASEF inside — amber
        if (pasefIdx.length) traces.push({
          type:'scatter', mode:'markers', name:'Inside PASEF event',
          x: pasefIdx.map(i=>mz[i]), y: pasefIdx.map(i=>mobility[i]),
          marker:{ size:3, color:'#fbbf24', opacity:0.8, line:{width:0} },
          hovertemplate:'Inside PASEF<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra></extra>',
        });

        // Window rectangles as shapes
        const shapes = [];
        const hasWins = windowData?.windows?.length > 0;
        if (hasWins) {
          const groups = [...new Set(windowData.windows.map(w => w.window_group))];
          windowData.windows.forEach(ww => {
            if (ww.oneoverk0_lower <= 0) return;
            const col = winColor(groups.indexOf(ww.window_group));
            const [r,g,b] = [parseInt(col.slice(1,3),16), parseInt(col.slice(3,5),16), parseInt(col.slice(5,7),16)];
            shapes.push({
              type:'rect', x0:ww.mz_lower, x1:ww.mz_upper, y0:ww.oneoverk0_lower, y1:ww.oneoverk0_upper,
              fillcolor:`rgba(${r},${g},${b},0.08)`, line:{color:`rgba(${r},${g},${b},0.90)`,width:1.5},
            });
          });
        }
        // PASEF event shapes
        if (pasefData?.events?.length) {
          pasefData.events.forEach(ev => {
            if (ev.oneoverk0_lower <= 0) return;
            shapes.push({
              type:'rect', x0:ev.mz_lower, x1:ev.mz_upper, y0:ev.oneoverk0_lower, y1:ev.oneoverk0_upper,
              fillcolor:'rgba(251,191,36,0.03)', line:{color:'rgba(251,191,36,0.55)',width:0.7},
            });
          });
        }

        window.Plotly.react(coverageRef.current, traces, {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:10,t:10,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          legend:{bgcolor:'rgba(0,0,0,0.4)',bordercolor:'#1e3a5f',borderwidth:1,font:{size:10}},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes,
        }, {responsive:true, displayModeBar:false});

        // ── Click-to-inspect on coverage m/z × 1/K₀ chart ──────────────────────
        const divCov = coverageRef.current;
        divCov.removeAllListeners?.('plotly_click');
        divCov.on('plotly_click', (evt) => {
          if (!evt.points?.length) return;
          const pt = evt.points[0];
          const clickMz   = pt.x;
          const clickOok0 = pt.y;
          const d3 = filteredData3dRef.current;
          let rt = 0, charge = 2;
          if (d3?.mz?.length) {
            let best = Infinity;
            for (let i = 0; i < d3.mz.length; i++) {
              const dm = Math.abs(d3.mz[i] - clickMz) / clickMz;
              const dk = Math.abs(d3.mobility[i] - clickOok0) * 3;
              const dist = dm + dk;
              if (dist < best) { best = dist; rt = d3.rt[i]; charge = d3.charge ? d3.charge[i] : 2; }
            }
          }
          setIonTarget({ mz: clickMz, rt, ook0: clickOok0, charge });
        });
      }, [filteredData3d, windowCoverage, windowData, pasefData]);

      // ── PASEF polygon view: all events in 1/K₀ × m/z space ──────────────────
      useEffect(() => {
        if (!pasefPolygonRef.current || !window.Plotly) return;
        if (!pasefData?.events?.length) { window.Plotly.purge(pasefPolygonRef.current); return; }
        const evts = pasefData.events;
        // Each event: point at (isolation_mz, k0_centre) — forms the characteristic diagonal band
        const polygon = {
          type:'scatter', mode:'markers', name:'PASEF events',
          x: evts.map(e => e.isolation_mz),
          y: evts.map(e => (e.oneoverk0_lower + e.oneoverk0_upper) / 2),
          marker:{ size:3, color:evts.map(e => e.rt_sec / 60),
                   colorscale:[[0,'#062d6e'],[0.33,'#0d6ea8'],[0.66,'#00b4b4'],[1,'#daa900']],
                   showscale:true, colorbar:{title:{text:'RT (min)',font:{color:'#94a3b8',size:9}},
                   thickness:10,len:0.7,tickfont:{color:'#94a3b8',size:9}}, opacity:0.65 },
          hovertemplate:'m/z %{x:.1f}<br>1/K₀ %{y:.4f}<br>RT %{customdata:.1f} min<extra>PASEF</extra>',
          customdata: evts.map(e => e.rt_sec / 60),
        };
        // Also show isolation width as error bars in x
        const rectangles = evts.map(ev => ({
          type:'rect', x0:ev.mz_lower, x1:ev.mz_upper,
          y0:ev.oneoverk0_lower, y1:ev.oneoverk0_upper,
          fillcolor:'rgba(251,191,36,0.04)', line:{color:'rgba(251,191,36,0.30)',width:0.6},
        }));
        window.Plotly.react(pasefPolygonRef.current, [polygon], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:55,r:60,t:10,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes: rectangles,
        }, {responsive:true, displayModeBar:false});
      }, [pasefData]);

      // ── Keep refs in sync with latest React state (for Plotly event handlers) ──
      useEffect(() => { filteredData3dRef.current = filteredData3d; }, [filteredData3d]);
      useEffect(() => { selectedRunRef.current    = selectedRun;    }, [selectedRun]);

      // ── Fetch ion detail whenever ionTarget changes ───────────────────────────
      useEffect(() => {
        if (!ionTarget) return;
        const run = selectedRunRef.current;
        if (!run) return;
        setIonLoading(true);
        setIonDetail(null);
        setFrameHeatmap(null);
        setFrameSpectrum(null);
        const { mz, rt, ook0 } = ionTarget;
        const id = run.id;
        Promise.all([
          fetch(API + `/api/runs/${id}/ion-detail?mz=${mz}&rt=${rt}&ook0=${ook0}`).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${id}/frame-heatmap?rt=${rt}`).then(r => r.ok ? r.json() : {}),
          fetch(API + `/api/runs/${id}/frame-spectrum?rt=${rt}`).then(r => r.ok ? r.json() : {}),
        ]).then(([detail, heatmap, spectrum]) => {
          setIonDetail(detail?.xic   ? detail   : null);
          setFrameHeatmap(heatmap?.grid ? heatmap : null);
          setFrameSpectrum(spectrum?.mz ? spectrum : null);
          setIonLoading(false);
        }).catch(() => setIonLoading(false));
      }, [ionTarget]);

      // Clear ion detail when run changes
      useEffect(() => {
        setIonTarget(null); setIonDetail(null);
        setFrameHeatmap(null); setFrameSpectrum(null);
      }, [selectedRun?.id]);

      // ── Draw XIC ─────────────────────────────────────────────────────────────
      useEffect(() => {
        const el = xicRef.current;
        if (!el || !window.Plotly) return;
        if (!ionDetail?.xic?.rt_sec?.length) { window.Plotly.purge(el); return; }
        const { rt_sec, intensity } = ionDetail.xic;
        const rtMin = rt_sec.map(v => v / 60);
        const peakRtMin = (ionDetail.peak_rt || 0) / 60;
        window.Plotly.react(el, [{
          x: rtMin, y: intensity,
          type: 'scatter', mode: 'lines',
          line: { color: '#60a5fa', width: 1.5 },
          fill: 'tozeroy', fillcolor: 'rgba(96,165,250,0.10)',
          hovertemplate: 'RT %{x:.2f} min<br>Intensity %{y:,.0f}<extra>XIC</extra>',
        }], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          font: { color: '#94a3b8', size: 11 },
          margin: { l: 60, r: 10, t: 8, b: 45 },
          xaxis: { title: { text: 'RT (min)', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          yaxis: { title: { text: 'Intensity', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          hoverlabel: { bgcolor: '#0d1e36', font: { size: 11 } },
          shapes: [{
            type: 'line', x0: peakRtMin, x1: peakRtMin, y0: 0, y1: 1, yref: 'paper',
            line: { color: '#fbbf24', width: 1.5, dash: 'dash' },
          }],
        }, { responsive: true, displayModeBar: false });
      }, [ionDetail]);

      // ── Draw mobilogram ───────────────────────────────────────────────────────
      useEffect(() => {
        const el = mobilogramRef.current;
        if (!el || !window.Plotly) return;
        if (!ionDetail?.mobilogram?.ook0?.length) { window.Plotly.purge(el); return; }
        const { ook0, intensity } = ionDetail.mobilogram;
        const peakOok0 = ionDetail.peak_ook0 || 0;
        window.Plotly.react(el, [{
          x: ook0, y: intensity,
          type: 'scatter', mode: 'lines',
          line: { color: '#22c55e', width: 1.5 },
          fill: 'tozeroy', fillcolor: 'rgba(34,197,94,0.10)',
          hovertemplate: '1/K₀ %{x:.4f}<br>Intensity %{y:,.0f}<extra>Mobilogram</extra>',
        }], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          font: { color: '#94a3b8', size: 11 },
          margin: { l: 60, r: 10, t: 8, b: 45 },
          xaxis: { title: { text: '1/K₀ (Vs/cm²)', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          yaxis: { title: { text: 'Intensity', font: { size: 11 } }, gridcolor: '#1e3a5f', color: '#a0b4cc' },
          hoverlabel: { bgcolor: '#0d1e36', font: { size: 11 } },
          shapes: [{
            type: 'line', x0: peakOok0, x1: peakOok0, y0: 0, y1: 1, yref: 'paper',
            line: { color: '#fbbf24', width: 1.5, dash: 'dash' },
          }],
        }, { responsive: true, displayModeBar: false });
      }, [ionDetail]);

      // ── Draw frame heatmap (mzmine panel 5) ──────────────────────────────────
      useEffect(() => {
        const el = frameHeatmapRef.current;
        if (!el || !window.Plotly) return;
        if (!frameHeatmap?.grid) { window.Plotly.purge(el); return; }
        const { mz_edges, ook0_edges, grid } = frameHeatmap;
        const mzCentres  = mz_edges.slice(0,-1).map((v,i)  => (v+mz_edges[i+1])/2);
        const ook0Centres = ook0_edges.slice(0,-1).map((v,i) => (v+ook0_edges[i+1])/2);
        // Shapes: crosshairs at the clicked ion position
        const shapes = [];
        if (ionTarget) {
          shapes.push(
            { type:'line', x0:ionTarget.mz, x1:ionTarget.mz, y0:ook0_edges[0], y1:ook0_edges[ook0_edges.length-1],
              line:{color:'rgba(251,191,36,0.7)',width:1,dash:'dot'} },
            { type:'line', x0:mz_edges[0], x1:mz_edges[mz_edges.length-1], y0:ionTarget.ook0, y1:ionTarget.ook0,
              line:{color:'rgba(251,191,36,0.7)',width:1,dash:'dot'} },
          );
        }
        window.Plotly.react(el, [{
          type: 'heatmap',
          x: mzCentres, y: ook0Centres, z: grid,
          colorscale: [
            [0,    '#020c1b'],
            [0.15, '#06204a'],
            [0.35, '#0d6ea8'],
            [0.55, '#00b4b4'],
            [0.75, '#64c832'],
            [0.88, '#daa900'],
            [1.0,  '#ffffff'],
          ],
          showscale: true,
          colorbar: { title:{text:'log₁₀(I)',font:{color:'#94a3b8',size:9}}, thickness:10, len:0.85,
                      tickfont:{color:'#94a3b8',size:9}, outlinewidth:0 },
          hovertemplate: 'm/z %{x:.3f}<br>1/K₀ %{y:.4f}<br>log(I) %{z:.2f}<extra>Frame</extra>',
          zsmooth: false,
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:55,t:8,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'1/K₀ (Vs/cm²)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes,
        }, {responsive:true, displayModeBar:false});
      }, [frameHeatmap, ionTarget]);

      // ── Draw frame spectrum (mzmine panel 1) ─────────────────────────────────
      useEffect(() => {
        const el = frameSpectrumRef.current;
        if (!el || !window.Plotly) return;
        if (!frameSpectrum?.mz?.length) { window.Plotly.purge(el); return; }
        const { mz, intensity } = frameSpectrum;
        const shapes = ionTarget ? [{
          type:'line', x0:ionTarget.mz, x1:ionTarget.mz, y0:0, y1:1, yref:'paper',
          line:{color:'rgba(251,191,36,0.7)',width:1.5,dash:'dash'},
        }] : [];
        window.Plotly.react(el, [{
          x: mz, y: intensity,
          type: 'bar', marker: { color:'#a78bfa', line:{width:0} },
          hovertemplate: 'm/z %{x:.3f}<br>%{y:,.0f}<extra>Σ Frame</extra>',
        }], {
          paper_bgcolor:'transparent', plot_bgcolor:'transparent',
          font:{color:'#94a3b8',size:11},
          margin:{l:60,r:10,t:8,b:45},
          xaxis:{title:{text:'m/z (Th)',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          yaxis:{title:{text:'Intensity',font:{size:11}},gridcolor:'#1e3a5f',color:'#a0b4cc'},
          bargap:0, hoverlabel:{bgcolor:'#0d1e36',font:{size:11}},
          shapes,
        }, {responsive:true, displayModeBar:false});
      }, [frameSpectrum, ionTarget]);

      // ── Corridor Map: 1/K₀ vs m/z, coloured by charge, with linear fits ──────
      // NOTE: must be declared before any early returns to satisfy Rules of Hooks
      useEffect(() => {
        if (!corridorMapRef.current || !window.Plotly) return;
        if (!data3d || !data3d.mz || data3d.mz.length < 20) {
          window.Plotly.purge(corridorMapRef.current); return;
        }
        const COLORS = {1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7',0:'#94a3b8'};
        const charges = [...new Set(data3d.charge)].filter(z => z > 0).sort((a,b)=>a-b);

        // Simple linear regression helper
        const linReg = (xs, ys) => {
          const n = xs.length; if (n < 5) return null;
          const mx = xs.reduce((s,v)=>s+v,0)/n, my = ys.reduce((s,v)=>s+v,0)/n;
          let num = 0, den = 0;
          for (let i=0;i<n;i++){const dx=xs[i]-mx; num+=dx*(ys[i]-my); den+=dx*dx;}
          const slope = den>0?num/den:0, inter = my - slope*mx;
          // std dev of residuals
          const resid = ys.map((y,i)=>y-(slope*xs[i]+inter));
          const sigma = Math.sqrt(resid.reduce((s,r)=>s+r*r,0)/n);
          return {slope, inter, sigma};
        };

        const traces = [];
        // Scatter points first (background layer)
        charges.forEach(z => {
          const idx = data3d.charge.reduce((a,c,i)=>{if(c===z)a.push(i);return a;},[]);
          if (idx.length < 2) return;
          traces.push({
            type:'scatter', mode:'markers',
            name:`z = +${z}`,
            x: idx.map(i=>data3d.mz[i]),
            y: idx.map(i=>data3d.mobility[i]),
            marker:{size:2.5, color:COLORS[z]||'#94a3b8', opacity:0.35, line:{width:0}},
            hovertemplate:`z=+${z}<br>m/z %{x:.3f}<br>1/K₀ %{y:.4f}<extra></extra>`,
          });
        });
        // Corridor fit lines on top
        charges.forEach(z => {
          const idx = data3d.charge.reduce((a,c,i)=>{if(c===z)a.push(i);return a;},[]);
          if (idx.length < 20) return;
          const xs = idx.map(i=>data3d.mz[i]), ys = idx.map(i=>data3d.mobility[i]);
          const fit = linReg(xs, ys);
          if (!fit) return;
          const xMin = Math.min(...xs), xMax = Math.max(...xs);
          const lineX = [xMin, xMax];
          const lineY = lineX.map(x => fit.slope*x + fit.inter);
          const hiY   = lineX.map(x => fit.slope*x + fit.inter + 1.5*fit.sigma);
          const loY   = lineX.map(x => fit.slope*x + fit.inter - 1.5*fit.sigma);
          const col = COLORS[z]||'#94a3b8';
          // ±1.5σ shaded band
          traces.push({
            type:'scatter', mode:'lines', name:`z=+${z} corridor`,
            x:[...lineX, ...lineX.slice().reverse()],
            y:[...hiY, ...loY.slice().reverse()],
            fill:'toself', fillcolor:`${col}22`, line:{width:0},
            hoverinfo:'skip', showlegend:false,
          });
          // Center line
          traces.push({
            type:'scatter', mode:'lines', name:`z=+${z} fit`,
            x:lineX, y:lineY,
            line:{color:col, width:2, dash:'dot'},
            hovertemplate:`z=+${z} corridor<br>slope: ${fit.slope.toFixed(5)}<extra></extra>`,
            showlegend:false,
          });
        });

        const layout = {
          paper_bgcolor:'transparent', plot_bgcolor:'rgba(1,26,58,0.6)',
          font:{color:'#a0b4cc', size:11},
          margin:{l:52,r:16,t:10,b:48},
          xaxis:{title:'m/z',gridcolor:'rgba(30,58,95,0.7)',zerolinecolor:'rgba(30,58,95,0.5)'},
          yaxis:{title:'1/K₀ (Vs/cm²)',gridcolor:'rgba(30,58,95,0.7)',zerolinecolor:'rgba(30,58,95,0.5)'},
          legend:{orientation:'h',y:-0.22,font:{size:10}},
          hovermode:'closest',
        };
        window.Plotly.react(corridorMapRef.current, traces, layout, {responsive:true,displayModeBar:false});
      }, [data3d]);

      // ── Ridgeline: per-charge KDE of 1/K₀ values ──────────────────────────
      useEffect(() => {
        if (!ridgelineRef.current || !window.Plotly) return;
        if (!data3d || !data3d.mobility || data3d.mobility.length < 20) {
          window.Plotly.purge(ridgelineRef.current); return;
        }
        const COLORS = {1:'#2dd4bf',2:'#60a5fa',3:'#22c55e',4:'#f97316',5:'#a855f7'};
        const charges = [...new Set(data3d.charge)].filter(z=>z>0).sort((a,b)=>a-b);

        // Gaussian KDE
        const kde = (vals, bw, pts) => pts.map(x => {
          const s = vals.reduce((sum,v)=>sum+Math.exp(-0.5*((x-v)/bw)**2),0);
          return s / (vals.length * bw * Math.sqrt(2*Math.PI));
        });

        const NPTS = 200;
        const allMob = data3d.mobility;
        const globalMin = Math.min(...allMob), globalMax = Math.max(...allMob);
        const pts = Array.from({length:NPTS},(_,i)=>globalMin + (globalMax-globalMin)*i/(NPTS-1));

        const traces = [];
        charges.forEach((z, zi) => {
          const vals = data3d.charge.reduce((a,c,i)=>{if(c===z)a.push(data3d.mobility[i]);return a;},[]);
          if (vals.length < 10) return;
          const bw = 1.06 * (Math.max(...vals)-Math.min(...vals)) / Math.cbrt(vals.length) * 0.4;
          const density = kde(vals, Math.max(bw, 0.005), pts);
          const maxD = Math.max(...density);
          const normD = density.map(v=>v/maxD);   // normalise 0-1 per charge so ridges are comparable
          const col = COLORS[z]||'#94a3b8';
          // Filled area (offset vertically by charge index for ridgeline effect)
          const OFFSET = zi * 0.35;
          traces.push({
            type:'scatter', mode:'lines',
            name:`z = +${z}  (n=${vals.length.toLocaleString()})`,
            x: pts,
            y: normD.map(v=>v*0.3 + OFFSET),
            fill:'tozeroy',
            fillcolor:`${col}33`,
            line:{color:col, width:2},
            hovertemplate:`z=+${z}<br>1/K₀: %{x:.3f}<extra></extra>`,
          });
        });

        const tickVals = charges.map((z,i)=>i*0.35+0.06);
        const tickText = charges.map(z=>`z = +${z}`);
        const layout = {
          paper_bgcolor:'transparent', plot_bgcolor:'rgba(1,26,58,0.6)',
          font:{color:'#a0b4cc', size:11},
          margin:{l:80,r:16,t:10,b:48},
          xaxis:{title:'1/K₀ (Vs/cm²)',gridcolor:'rgba(30,58,95,0.7)'},
          yaxis:{showgrid:false,tickvals:tickVals,ticktext:tickText,zeroline:false},
          legend:{orientation:'h',y:-0.22,font:{size:10}},
          hovermode:'x unified',
        };
        window.Plotly.react(ridgelineRef.current, traces, layout, {responsive:true,displayModeBar:false});
      }, [data3d]);

      // ── Isolation Score: % of co-isolating pairs resolved in mobility ──
      useEffect(() => {
        if (!data3d || !data3d.mz || data3d.mz.length < 10) { setIsolationScore(null); return; }
        // Only meaningful when we have true mobility FWHM (4DFF .d source, no label = K0 units)
        const mobilityFwhm = statsData?.fwhm_hist?.median_fwhm;
        if (!mobilityFwhm || statsData?.fwhm_hist?.label) { setIsolationScore(null); return; }

        // Sort indices by m/z for sliding-window pair search
        const n = data3d.mz.length;
        const order = Array.from({length: n}, (_, i) => i).sort((a, b) => data3d.mz[a] - data3d.mz[b]);
        const sortedMz = order.map(i => data3d.mz[i]);
        const mzW = isoMzWindow, rtW = isoRtWindow;

        let totalPairs = 0, resolvedPairs = 0;
        const deltaMobs = []; // |Δ(1/K₀)| for every co-isolating pair (capped for histogram)

        for (let a = 0; a < n; a++) {
          const ia = order[a];
          const mzA = data3d.mz[ia], rtA = data3d.rt[ia], mobA = data3d.mobility[ia];
          for (let b = a + 1; b < n; b++) {
            if (sortedMz[b] - mzA > mzW) break;          // beyond m/z window
            const ib = order[b];
            if (Math.abs(data3d.rt[ib] - rtA) > rtW) continue; // not co-eluting
            totalPairs++;
            const dMob = Math.abs(data3d.mobility[ib] - mobA);
            if (dMob >= mobilityFwhm) resolvedPairs++;
            if (deltaMobs.length < 20000) deltaMobs.push(dMob);
          }
        }

        // Build histogram of |Δ(1/K₀)|
        const maxD = mobilityFwhm * 6;
        const BINS = 40;
        const step = maxD / BINS;
        const histCounts = new Array(BINS).fill(0);
        const histEdges = Array.from({length: BINS + 1}, (_, i) => +(i * step).toFixed(5));
        deltaMobs.forEach(d => {
          const bi = Math.min(Math.floor(d / step), BINS - 1);
          histCounts[bi]++;
        });

        setIsolationScore({
          pct: totalPairs > 0 ? +(resolvedPairs / totalPairs * 100).toFixed(1) : 0,
          totalPairs, resolvedPairs,
          mobilityFwhm,
          histCounts, histEdges,
        });
      }, [data3d, statsData, isoMzWindow, isoRtWindow]);

      // Render isolation histogram
      useEffect(() => {
        const el = isolationHistRef.current;
        if (!el || !window.Plotly) return;
        if (!isolationScore) { window.Plotly.purge(el); return; }
        const { histEdges, histCounts, mobilityFwhm } = isolationScore;
        const xs = histEdges.slice(0, -1).map((e, i) => (e + histEdges[i + 1]) / 2);
        window.Plotly.react(el, [{
          type: 'bar',
          x: xs, y: histCounts,
          marker: { color: xs.map(x => x >= mobilityFwhm ? '#22c55e' : '#ef4444'), opacity: 0.85 },
          hovertemplate: 'Δ1/K₀ %{x:.4f}<br>%{y} pairs<extra></extra>',
        }], {
          paper_bgcolor: 'transparent', plot_bgcolor: 'rgba(2,40,81,0.25)',
          xaxis: { title: { text: '|Δ(1/K₀)| Vs/cm²', font: { color: '#a0b4cc', size: 10 } },
            tickfont: { color: '#a0b4cc', size: 9 }, gridcolor: '#1e3a5f' },
          yaxis: { title: { text: 'pairs', font: { color: '#a0b4cc', size: 9 } },
            tickfont: { color: '#a0b4cc', size: 9 }, gridcolor: '#1e3a5f' },
          shapes: [{ type: 'line', xref: 'x', yref: 'paper',
            x0: mobilityFwhm, x1: mobilityFwhm, y0: 0, y1: 1,
            line: { color: '#DAAA00', width: 2, dash: 'dash' } }],
          annotations: [{ x: mobilityFwhm, y: 0.97, xref: 'x', yref: 'paper',
            text: `FWHM ${mobilityFwhm.toFixed(4)}`, showarrow: false,
            font: { color: '#DAAA00', size: 9 }, xanchor: 'left' }],
          margin: { l: 50, r: 12, t: 10, b: 46 },
          showlegend: false,
        }, { responsive: true, displayModeBar: false });
      }, [isolationScore]);

      const nInstruments = useMemo(() => new Set(dRuns.map(r => r.instrument)).size, [dRuns]);

      // ── Derived display values — plain assignments, no hooks below this line ──
      const fwhm = statsData?.fwhm_hist;
      const charge = statsData?.charge_dist;
      const intHist = statsData?.intensity_hist;

      if (runsLoading) return <div className="empty">Loading runs…</div>;

      if (dRuns.length === 0) return (
        <div className="card">
          <h3>Ion Mobility</h3>
          <p style={{color:'var(--muted)',marginTop:'0.5rem'}}>
            No Bruker .d runs found in the database yet. This tab shows ion mobility data for
            timsTOF acquisitions — it will populate automatically once runs are processed.
          </p>
        </div>
      );

      return (
        <div>
          {/* Summary bar */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.75rem 1.25rem'}}>
            <div style={{display:'flex',gap:'2.5rem',alignItems:'center',flexWrap:'wrap'}}>
              <div>
                <span style={{color:'var(--accent)',fontWeight:700,fontSize:'1.2rem'}}>{dRuns.length}</span>
                {' '}<span style={{color:'var(--muted)',fontSize:'0.85rem'}}>timsTOF run{dRuns.length !== 1 ? 's' : ''}</span>
              </div>
              <div>
                <span style={{color:'var(--accent)',fontWeight:700,fontSize:'1.2rem'}}>{nInstruments}</span>
                {' '}<span style={{color:'var(--muted)',fontSize:'0.85rem'}}>instrument{nInstruments !== 1 ? 's' : ''}</span>
              </div>
              <div style={{color:'var(--muted)',fontSize:'0.8rem',flexShrink:1}}>
                Select a run · all panels auto-populate from DIA-NN <code style={{background:'rgba(255,255,255,0.07)',padding:'0 0.2rem',borderRadius:'0.2rem'}}>report.parquet</code> &nbsp;·&nbsp;
                4DFF <code style={{background:'rgba(255,255,255,0.07)',padding:'0 0.2rem',borderRadius:'0.2rem'}}>.features</code> used when available &nbsp;·&nbsp;
                all charge states z=1–6 shown · click a charge button to hide/show
              </div>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'270px 1fr',gap:'1rem',alignItems:'start'}}>
            {/* Run list */}
            <div className="card" style={{padding:'0.75rem',position:'sticky',top:'1rem'}}>
              <div style={{fontWeight:600,fontSize:'0.85rem',color:'var(--accent)',marginBottom:'0.5rem'}}>timsTOF Runs</div>
              <input
                type="text"
                placeholder="Filter by name or instrument…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.3rem 0.5rem',fontSize:'0.8rem',marginBottom:'0.5rem'}}
              />
              <div style={{maxHeight:'68vh',overflowY:'auto'}}>
                {filtered.length === 0 && (
                  <div style={{color:'var(--muted)',fontSize:'0.8rem',textAlign:'center',padding:'1rem'}}>No matching runs</div>
                )}
                {filtered.map(r => {
                  const sel = selectedRun?.id === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRun(r)}
                      style={{
                        padding:'0.4rem 0.5rem',borderRadius:'0.3rem',cursor:'pointer',marginBottom:'0.1rem',
                        background: sel ? 'rgba(218,170,0,0.1)' : 'transparent',
                        borderLeft: sel ? '2px solid var(--accent)' : '2px solid transparent',
                      }}
                    >
                      <div style={{fontSize:'0.78rem',fontWeight:600,color:sel?'var(--accent)':'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={r.run_name}>
                        {r.run_name}
                      </div>
                      <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.1rem',display:'flex',gap:'0.35rem',alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{padding:'0.05rem 0.22rem',background:isDia(r.mode)?'#1e3a5f':'#3b1f1f',color:isDia(r.mode)?'#93c5fd':'#fca5a5',borderRadius:'0.2rem',fontSize:'0.65rem',fontWeight:700}}>{r.mode||'?'}</span>
                        <span>{new Date(r.run_date).toLocaleDateString([],{month:'short',day:'numeric',year:'2-digit'})}</span>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'100px'}}>{r.instrument}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right panel */}
            <div>
              {!selectedRun && (
                <div className="card" style={{textAlign:'center',padding:'5rem 2rem',color:'var(--muted)'}}>
                  <div style={{fontSize:'3rem',marginBottom:'0.75rem',opacity:0.4}}>⬡</div>
                  <div style={{fontSize:'1rem',fontWeight:600,marginBottom:'0.4rem'}}>Select a run</div>
                  <div style={{fontSize:'0.85rem'}}>Choose a timsTOF run from the list to view its ion mobility data</div>
                </div>
              )}

              {selectedRun && panelLoading && (
                <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--muted)'}}>
                  Loading ion mobility data…
                </div>
              )}

              {selectedRun && !panelLoading && !mapData && !statsData && !windowData && (
                <div className="card">
                  <h3>No ion mobility data</h3>
                  <p style={{color:'var(--muted)',marginTop:'0.5rem',fontSize:'0.85rem',lineHeight:'1.6'}}>
                    No 4DFF .features file found and no diaPASEF windows in analysis.tdf for <strong>{selectedRun.run_name}</strong>.<br/>
                    Run 4DFF feature finding on the .d directory to populate the feature map and histograms.
                    DIA acquisitions show the window layout automatically without needing 4DFF.
                  </p>
                </div>
              )}

              {selectedRun && !panelLoading && (mapData || statsData || windowData) && (
                <div>
                  {/* Run header card */}
                  <div className="card" style={{padding:'0.6rem 1rem',marginBottom:'0.75rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'0.5rem'}}>
                      <div>
                        <span style={{fontWeight:700,fontSize:'0.95rem'}}>{selectedRun.run_name}</span>
                        <span style={{color:'var(--muted)',fontSize:'0.8rem',marginLeft:'0.75rem'}}>{selectedRun.instrument}</span>
                        <span style={{color:'var(--muted)',fontSize:'0.8rem',marginLeft:'0.5rem'}}>
                          {new Date(selectedRun.run_date).toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'})}
                        </span>
                      </div>
                      <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                        {/* Prominent overlay toggles — always visible when data available */}
                        {windowData?.windows?.length > 0 && (
                          <button
                            onClick={() => setShowWindowOverlay(v => !v)}
                            title={showWindowOverlay ? 'Hide diaPASEF window overlay on all charts' : 'Show diaPASEF isolation windows on all charts'}
                            style={{
                              display:'flex',alignItems:'center',gap:'0.3rem',
                              padding:'0.28rem 0.7rem', fontSize:'0.8rem', fontWeight: 600,
                              background: showWindowOverlay ? 'rgba(0,174,183,0.18)' : 'rgba(0,174,183,0.07)',
                              color: showWindowOverlay ? '#00d4e0' : '#4a8cbb',
                              border: `1px solid ${showWindowOverlay ? '#00d4e0' : 'rgba(0,174,183,0.3)'}`,
                              borderRadius:'0.4rem', cursor:'pointer',
                              transition:'all 0.15s',
                            }}
                          >
                            <span style={{fontSize:'0.9rem'}}>⊞</span>
                            {showWindowOverlay ? 'Windows ON' : 'Windows'}
                            <span style={{fontSize:'0.68rem',opacity:0.75,marginLeft:'0.1rem'}}>
                              {windowData.windows.length}w·{windowData.n_window_groups}g
                            </span>
                          </button>
                        )}
                        {pasefData?.events?.length > 0 && (
                          <button
                            onClick={() => setShowPasefOverlay(v => !v)}
                            title={showPasefOverlay ? 'Hide PASEF events' : 'Show ddaPASEF precursor isolation events'}
                            style={{
                              display:'flex',alignItems:'center',gap:'0.3rem',
                              padding:'0.28rem 0.7rem', fontSize:'0.8rem', fontWeight: 600,
                              background: showPasefOverlay ? 'rgba(217,119,6,0.18)' : 'rgba(217,119,6,0.07)',
                              color: showPasefOverlay ? '#fbbf24' : '#a07020',
                              border: `1px solid ${showPasefOverlay ? '#fbbf24' : 'rgba(217,119,6,0.3)'}`,
                              borderRadius:'0.4rem', cursor:'pointer',
                            }}
                          >
                            <span style={{fontSize:'0.9rem'}}>◈</span>
                            {showPasefOverlay ? 'PASEF ON' : 'PASEF'}
                          </button>
                        )}
                        <div style={{display:'flex',gap:'0.3rem',alignItems:'center',marginLeft:'0.2rem'}}>
                          {mapData && mapData.source !== 'diann' && <span style={{padding:'0.1rem 0.45rem',background:'#1e3a5f',color:'#bfdbfe',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>4DFF ✓</span>}
                          {mapData && mapData.source === 'diann' && <span style={{padding:'0.1rem 0.45rem',background:'#1a2e3a',color:'#93c5fd',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>DIA-NN ✓</span>}
                          {windowData && <span style={{padding:'0.1rem 0.45rem',background:'#1a2e1a',color:'#86efac',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>diaPASEF ✓</span>}
                          {pasefData && <span style={{padding:'0.1rem 0.45rem',background:'#2d1f0a',color:'#fcd34d',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700}}>ddaPASEF ✓</span>}
                          {selectedRun.gate_result && <GateBadge result={selectedRun.gate_result} />}
                        </div>
                      </div>
                    </div>
                    {/* Window overlay summary strip */}
                    {showWindowOverlay && windowData?.windows?.length > 0 && (
                      <div style={{marginTop:'0.4rem',padding:'0.25rem 0.4rem',background:'rgba(0,174,183,0.07)',borderRadius:'0.3rem',fontSize:'0.73rem',color:'#4a9ab0',display:'flex',gap:'1rem',flexWrap:'wrap'}}>
                        <span>⊞ diaPASEF overlay active</span>
                        <span>m/z {windowData.mz_range[0].toFixed(0)}–{windowData.mz_range[1].toFixed(0)} Da</span>
                        {windowData.mobility_range[0] > 0 && <span>1/K₀ {windowData.mobility_range[0].toFixed(2)}–{windowData.mobility_range[1].toFixed(2)} Vs/cm²</span>}
                        {windowData.rt_range?.[1] > 0 && <span>RT {(windowData.rt_range[0]/60).toFixed(1)}–{(windowData.rt_range[1]/60).toFixed(1)} min</span>}
                        <span style={{color:'var(--muted)'}}>Overlay shown on all 2D and 3D charts below</span>
                      </div>
                    )}
                  </div>

                  {/* 3D scatter — RT × m/z × 1/K0 coloured by charge */}
                  {data3d && (() => {
                    // Always show z=1–6 buttons so immunopeptidomics +1 ions are always accessible
                    // even if current run was searched with min-pr-charge 2
                    const dataCharges = new Set(data3d.charge);
                    const allCharges = [0,1,2,3,4,5,6];
                    const rtRange = data3d.rt.length ? [Math.min(...data3d.rt), Math.max(...data3d.rt)] : [0,1];
                    const mzRange = data3d.mz.length ? [Math.min(...data3d.mz), Math.max(...data3d.mz)] : [0,1];
                    return (
                      <div className="card" style={{marginBottom:'0.75rem'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem',gap:'0.5rem',flexWrap:'wrap'}}>
                          <h3 style={{margin:0}}>4D Feature Map — RT × m/z × 1/K₀</h3>
                          <div style={{display:'flex',alignItems:'center',gap:'0.4rem',flexWrap:'wrap'}}>
                            {windowData?.windows?.length > 0 && (
                              <button
                                onClick={() => setShowWindowOverlay(v => !v)}
                                title={showWindowOverlay ? 'Hide diaPASEF window boxes' : 'Overlay diaPASEF isolation windows as 3D boxes'}
                                style={{
                                  padding:'0.2rem 0.55rem', fontSize:'0.78rem',
                                  background: showWindowOverlay ? '#0d6ea8' : 'var(--surface)',
                                  color: showWindowOverlay ? '#fff' : 'var(--muted)',
                                  border:`1px solid ${showWindowOverlay ? '#0d6ea8' : 'var(--border)'}`,
                                  borderRadius:'0.35rem', cursor:'pointer', fontWeight: showWindowOverlay ? 700 : 400,
                                }}
                              >{showWindowOverlay ? '⬡ DIA ON' : '⬡ DIA'}</button>
                            )}
                            {pasefData?.events?.length > 0 && (
                              <button
                                onClick={() => setShowPasefOverlay(v => !v)}
                                title={showPasefOverlay ? 'Hide PASEF events' : 'Overlay ddaPASEF precursor selection events'}
                                style={{
                                  padding:'0.2rem 0.55rem', fontSize:'0.78rem',
                                  background: showPasefOverlay ? '#d97706' : 'var(--surface)',
                                  color: showPasefOverlay ? '#fff' : 'var(--muted)',
                                  border:`1px solid ${showPasefOverlay ? '#d97706' : 'var(--border)'}`,
                                  borderRadius:'0.35rem', cursor:'pointer', fontWeight: showPasefOverlay ? 700 : 400,
                                }}
                              >{showPasefOverlay ? '◈ PASEF ON' : '◈ PASEF'}</button>
                            )}
                            <ExportBtn plotRef={plot3dRef} filename={`${selectedRun?.run_name||'run'}-4d-scatter`} />
                            <button
                              onClick={() => setAutoRotate(v => !v)}
                              title={autoRotate ? 'Stop auto-rotation (or drag the plot)' : 'Start auto-rotation'}
                              style={{
                                padding:'0.2rem 0.55rem', fontSize:'0.78rem',
                                background: autoRotate ? 'rgba(96,165,250,0.18)' : 'var(--surface)',
                                color: autoRotate ? '#60a5fa' : 'var(--muted)',
                                border:`1px solid ${autoRotate ? '#60a5fa66' : 'var(--border)'}`,
                                borderRadius:'0.35rem', cursor:'pointer', fontWeight: autoRotate ? 700 : 400,
                              }}
                            >{autoRotate ? '⏸ Rotate ON' : '▶ Auto Rotate'}</button>
                            <button
                              onClick={() => setShowFilters(f => !f)}
                              style={{background:'transparent',border:'1px solid var(--border)',color:'var(--accent)',borderRadius:'0.3rem',padding:'0.2rem 0.6rem',cursor:'pointer',fontSize:'0.78rem'}}
                            >
                              {showFilters ? '▲ Hide filters' : '▼ m/z, RT & 1/K₀ filters'}
                            </button>
                          </div>
                        </div>

                        {/* Charge state toggles — always visible */}
                        <div style={{display:'flex',gap:'0.3rem',flexWrap:'wrap',alignItems:'center',marginBottom:'0.5rem'}}>
                          <span style={{color:'var(--muted)',fontSize:'0.72rem',marginRight:'0.1rem'}}>Charge:</span>
                          {allCharges.map(z => {
                            const active = !filterCharges.has(z);
                            const inData = dataCharges.has(z);
                            const col = CHARGE_COLORS[z] || '#94a3b8';
                            const lbl = CHARGE_LABEL[z] || `+${z}`;
                            const tip = inData
                              ? `${CHARGE_TITLE[z]||`z=${z}`}: click to hide`
                              : `${CHARGE_TITLE[z]||`z=${z}`}: not present in this dataset`;
                            return (
                              <button key={z}
                                onClick={() => setFilterCharges(prev => {
                                  const next = new Set(prev);
                                  if (next.has(z)) next.delete(z); else next.add(z);
                                  if (next.size >= allCharges.length) return new Set();
                                  return next;
                                })}
                                title={tip}
                                style={{
                                  padding:'0.2rem 0.55rem',borderRadius:'0.3rem',cursor:'pointer',fontSize:'0.82rem',fontWeight:700,
                                  background: active && inData ? col+'33' : active && !inData ? col+'0d' : 'transparent',
                                  color: active ? (inData ? col : col+'66') : '#3a4a5a',
                                  border:`1px solid ${active && inData ? col+'88' : active && !inData ? col+'33' : '#1e3a5f'}`,
                                  opacity: inData ? 1 : 0.45,
                                  transition:'all 0.12s',
                                }}
                              >{lbl}{!inData ? ' ·' : ''}</button>
                            );
                          })}
                          {filterCharges.size > 0 && (
                            <button onClick={() => setFilterCharges(new Set())}
                              style={{padding:'0.2rem 0.5rem',borderRadius:'0.3rem',cursor:'pointer',fontSize:'0.72rem',background:'transparent',color:'var(--muted)',border:'1px solid var(--border)'}}>
                              show all
                            </button>
                          )}
                        </div>

                        {/* m/z, RT, and 1/K₀ range filters — collapsible */}
                        {showFilters && (() => {
                          const ook0Range = data3d?.mobility?.length ? [Math.min(...data3d.mobility), Math.max(...data3d.mobility)] : [0.6, 1.6];
                          const inpSt = {width:'70px',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'0.3rem',padding:'0.2rem 0.3rem',fontSize:'0.78rem'};
                          const hasAnyRange = filterMzMin || filterMzMax || filterRtMin || filterRtMax || filterOok0Min || filterOok0Max;
                          return (
                            <div style={{background:'rgba(1,26,58,0.6)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.75rem',marginBottom:'0.6rem',display:'flex',flexWrap:'wrap',gap:'1.25rem',alignItems:'flex-end'}}>
                              {/* m/z range */}
                              <div>
                                <div style={{color:'var(--muted)',fontSize:'0.72rem',marginBottom:'0.3rem'}}>m/z range (Th)</div>
                                <div style={{display:'flex',gap:'0.3rem',alignItems:'center'}}>
                                  <input type="number" placeholder={mzRange[0].toFixed(0)} value={filterMzMin}
                                    onChange={e => setFilterMzMin(e.target.value)} step="1" style={inpSt} />
                                  <span style={{color:'var(--muted)'}}>–</span>
                                  <input type="number" placeholder={mzRange[1].toFixed(0)} value={filterMzMax}
                                    onChange={e => setFilterMzMax(e.target.value)} step="1" style={inpSt} />
                                </div>
                              </div>
                              {/* RT range */}
                              <div>
                                <div style={{color:'var(--muted)',fontSize:'0.72rem',marginBottom:'0.3rem'}}>RT range (min)</div>
                                <div style={{display:'flex',gap:'0.3rem',alignItems:'center'}}>
                                  <input type="number" placeholder={(rtRange[0]/60).toFixed(1)} value={filterRtMin}
                                    onChange={e => setFilterRtMin(e.target.value)} step="0.5" style={inpSt} />
                                  <span style={{color:'var(--muted)'}}>–</span>
                                  <input type="number" placeholder={(rtRange[1]/60).toFixed(1)} value={filterRtMax}
                                    onChange={e => setFilterRtMax(e.target.value)} step="0.5" style={inpSt} />
                                </div>
                              </div>
                              {/* 1/K₀ range */}
                              <div>
                                <div style={{color:'var(--muted)',fontSize:'0.72rem',marginBottom:'0.3rem'}}>1/K₀ range (Vs/cm²)</div>
                                <div style={{display:'flex',gap:'0.3rem',alignItems:'center'}}>
                                  <input type="number" placeholder={ook0Range[0].toFixed(3)} value={filterOok0Min}
                                    onChange={e => setFilterOok0Min(e.target.value)} step="0.01" style={inpSt} />
                                  <span style={{color:'var(--muted)'}}>–</span>
                                  <input type="number" placeholder={ook0Range[1].toFixed(3)} value={filterOok0Max}
                                    onChange={e => setFilterOok0Max(e.target.value)} step="0.01" style={inpSt} />
                                </div>
                              </div>
                              {hasAnyRange && (
                                <button onClick={() => { setFilterMzMin(''); setFilterMzMax(''); setFilterRtMin(''); setFilterRtMax(''); setFilterOok0Min(''); setFilterOok0Max(''); }}
                                  style={{alignSelf:'flex-end',padding:'0.2rem 0.5rem',background:'transparent',color:'var(--muted)',border:'1px solid var(--border)',borderRadius:'0.3rem',cursor:'pointer',fontSize:'0.72rem'}}>
                                  Clear ranges
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        <div style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.5rem'}}>
                          {filteredData3d
                            ? <>{filteredData3d.n_shown.toLocaleString()} of {data3d.n_total.toLocaleString()} features</>
                            : <span style={{color:'#f97316'}}>No features match the current filters</span>
                          }
                          &nbsp;·&nbsp; colour = charge &nbsp;·&nbsp; size = intensity &nbsp;·&nbsp;
                          <span style={{color:'var(--accent)'}}>drag to rotate · scroll to zoom</span>
                        </div>
                        <div ref={plot3dRef} style={{width:'100%',height:'520px',borderRadius:'0.4rem',overflow:'hidden',border:'1px solid var(--border)',background:'var(--bg)'}} />
                      </div>
                    );
                  })()}

                  {/* m/z × 1/K₀ intensity landscape (PEAKS-style surface) */}
                  {data3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.3rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>m/z × 1/K₀ Intensity Landscape</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.2rem'}}>
                            Surface height = log₁₀(intensity) &nbsp;·&nbsp; scatter overlay coloured by charge &nbsp;·&nbsp;
                            <span style={{color:'var(--accent)'}}>drag to rotate · scroll to zoom</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.4rem',alignItems:'center',flexWrap:'wrap'}}>
                          <ExportBtn plotRef={mzLandscapeRef} filename={`${selectedRun?.run_name||'run'}-landscape`} />
                          {[...new Set(data3d.charge)].sort((a,b)=>a-b).map(z => (
                            <span key={z} title={CHARGE_TITLE[z]||`z=${z}`} style={{
                              padding:'0.1rem 0.4rem',borderRadius:'0.25rem',fontSize:'0.72rem',fontWeight:700,
                              background: (CHARGE_COLORS[z]||'#94a3b8')+'22',
                              color: CHARGE_COLORS[z]||'#94a3b8',
                              border:`1px solid ${(CHARGE_COLORS[z]||'#94a3b8')}55`,
                            }}>{CHARGE_LABEL[z]||`+${z}`}</span>
                          ))}
                        </div>
                      </div>
                      <div ref={mzLandscapeRef} style={{width:'100%',height:'500px',borderRadius:'0.4rem',overflow:'hidden',border:'1px solid var(--border)',background:'var(--bg)'}} />
                    </div>
                  )}

                  {/* Waterfall spectrum — PEAKS Studio style */}
                  {data3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.3rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Waterfall Spectrum — m/z × 1/K₀</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.2rem'}}>
                            Vertical spikes = relative intensity per mobility layer &nbsp;·&nbsp;
                            {filteredData3d?.n_shown?.toLocaleString()} ions across {60} mobility layers &nbsp;·&nbsp;
                            <span style={{color:'var(--accent)'}}>drag to rotate · scroll to zoom</span>
                          </div>
                        </div>
                        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'0.3rem'}}>
                          <ExportBtn plotRef={waterfallRef} filename={`${selectedRun?.run_name||'run'}-waterfall`} />
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',textAlign:'right'}}>
                            <div>normalised per layer</div>
                            <div style={{color:'#4a8cbb'}}>like PEAKS Studio</div>
                          </div>
                        </div>
                      </div>
                      <div ref={waterfallRef} style={{width:'100%',height:'500px',borderRadius:'0.4rem',overflow:'hidden',border:'1px solid var(--border)',background:'var(--bg)'}} />
                    </div>
                  )}

                  {/* Ion cloud — m/z vs 1/K₀ (Tenzer / Gomez-Zepeda style) */}
                  {filteredData3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.35rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Ion Cloud — m/z × 1/K₀</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.15rem'}}>
                            Charge-state lanes in m/z × ion mobility space · Tenzer / Gomez-Zepeda style (PMC10937930) · filters above apply
                            &nbsp;·&nbsp; <span style={{color:'#60a5fa'}}>click → inspect · box select → filter · scroll to zoom</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                          {windowData?.windows?.length > 0 && (
                            <button
                              onClick={() => setShowWindowOverlay(v => !v)}
                              title={showWindowOverlay ? 'Hide diaPASEF isolation windows' : 'Overlay diaPASEF isolation windows from method'}
                              style={{
                                padding:'0.25rem 0.65rem',
                                fontSize:'0.78rem',
                                background: showWindowOverlay ? 'var(--accent)' : 'var(--surface)',
                                color:      showWindowOverlay ? 'var(--bg)'     : 'var(--muted)',
                                border:`1px solid ${showWindowOverlay ? 'var(--accent)' : 'var(--border)'}`,
                                borderRadius:'0.4rem',
                                cursor:'pointer',
                                fontWeight: showWindowOverlay ? 700 : 400,
                                whiteSpace:'nowrap',
                              }}
                            >
                              {showWindowOverlay ? '⊞ Method ON' : '⊞ Method'}
                            </button>
                          )}
                          {pasefData?.events?.length > 0 && (
                            <button
                              onClick={() => setShowPasefOverlay(v => !v)}
                              title={showPasefOverlay ? 'Hide PASEF events' : 'Overlay ddaPASEF precursor selection events'}
                              style={{
                                padding:'0.25rem 0.65rem', fontSize:'0.78rem',
                                background: showPasefOverlay ? '#d97706' : 'var(--surface)',
                                color: showPasefOverlay ? '#fff' : 'var(--muted)',
                                border:`1px solid ${showPasefOverlay ? '#d97706' : 'var(--border)'}`,
                                borderRadius:'0.4rem', cursor:'pointer',
                                fontWeight: showPasefOverlay ? 700 : 400, whiteSpace:'nowrap',
                              }}
                            >
                              {showPasefOverlay ? '◈ PASEF ON' : '◈ PASEF'}
                            </button>
                          )}
                          <ExportBtn plotRef={cloudMzRef} filename={`${selectedRun?.run_name||'run'}-cloud-mz`} />
                        </div>
                      </div>
                      {(showWindowOverlay && windowData?.windows?.length > 0) && (
                        <div style={{fontSize:'0.73rem',color:'var(--muted)',marginBottom:'0.2rem',paddingLeft:'0.1rem'}}>
                          {windowData.windows.length} diaPASEF windows
                          · m/z {windowData.mz_range[0].toFixed(0)}–{windowData.mz_range[1].toFixed(0)} Da
                          {windowData.mobility_range[0] > 0 && ` · 1/K₀ ${windowData.mobility_range[0].toFixed(2)}–${windowData.mobility_range[1].toFixed(2)} Vs/cm²`}
                          · {windowData.n_window_groups} group{windowData.n_window_groups !== 1 ? 's' : ''}
                          &nbsp;·&nbsp; hover for details · coloured by group
                        </div>
                      )}
                      {(showPasefOverlay && pasefData?.events?.length > 0) && (
                        <div style={{fontSize:'0.73rem',color:'#fbbf24',marginBottom:'0.2rem',paddingLeft:'0.1rem'}}>
                          {pasefData.n_events.toLocaleString()} PASEF events · rectangles show precursor isolation boxes in m/z × 1/K₀
                        </div>
                      )}
                      <div ref={cloudMzRef} style={{height:'340px'}} />
                    </div>
                  )}

                  {/* Ion cloud — RT vs 1/K₀ (Kulej / MSKCC style) */}
                  {filteredData3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.35rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Ion Cloud — RT × 1/K₀</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.15rem'}}>
                            Retention time × ion mobility coloured by charge · Kulej / MSKCC style (biorxiv 2025.08.23) · filters above apply
                            &nbsp;·&nbsp; <span style={{color:'#60a5fa'}}>click → inspect · box select → filter · scroll to zoom</span>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
                          {(windowData?.windows?.length > 0 || pasefData?.events?.length > 0) && (
                            <div style={{display:'flex',gap:'0.35rem'}}>
                              {windowData?.windows?.length > 0 && (
                                <button onClick={() => setShowWindowOverlay(v => !v)}
                                  style={{padding:'0.2rem 0.5rem',fontSize:'0.76rem',
                                    background:showWindowOverlay?'var(--accent)':'var(--surface)',
                                    color:showWindowOverlay?'var(--bg)':'var(--muted)',
                                    border:`1px solid ${showWindowOverlay?'var(--accent)':'var(--border)'}`,
                                    borderRadius:'0.35rem',cursor:'pointer',fontWeight:showWindowOverlay?700:400}}>
                                  {showWindowOverlay ? '⊞ ON' : '⊞'}
                                </button>
                              )}
                              {pasefData?.events?.length > 0 && (
                                <button onClick={() => setShowPasefOverlay(v => !v)}
                                  style={{padding:'0.2rem 0.5rem',fontSize:'0.76rem',
                                    background:showPasefOverlay?'#d97706':'var(--surface)',
                                    color:showPasefOverlay?'#fff':'var(--muted)',
                                    border:`1px solid ${showPasefOverlay?'#d97706':'var(--border)'}`,
                                    borderRadius:'0.35rem',cursor:'pointer',fontWeight:showPasefOverlay?700:400}}>
                                  {showPasefOverlay ? '◈ ON' : '◈'}
                                </button>
                              )}
                            </div>
                          )}
                          <ExportBtn plotRef={cloudRtRef} filename={`${selectedRun?.run_name||'run'}-cloud-rt`} />
                        </div>
                      </div>
                      <div ref={cloudRtRef} style={{height:'320px'}} />
                    </div>
                  )}

                  {/* ── Ion Detail Panel ─────────────────────────────────────── */}
                  {ionTarget && (
                    <div className="card" style={{marginBottom:'0.75rem',borderColor:'rgba(96,165,250,0.35)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.75rem'}}>
                        <div>
                          <div style={{display:'flex',alignItems:'center',gap:'0.75rem',flexWrap:'wrap'}}>
                            <span style={{fontWeight:700,fontSize:'0.9rem',color:'var(--accent)'}}>Ion Detail</span>
                            <span style={{fontFamily:'monospace',fontSize:'0.85rem',color:'#e2e8f0'}}>m/z {ionTarget.mz.toFixed(4)}</span>
                            <span style={{fontSize:'0.8rem',color:'var(--muted)'}}>RT {(ionTarget.rt/60).toFixed(2)} min</span>
                            <span style={{fontSize:'0.8rem',color:'var(--muted)'}}>1/K₀ {ionTarget.ook0.toFixed(4)} Vs/cm²</span>
                            {ionTarget.charge > 0 && (
                              <span style={{padding:'0.1rem 0.35rem',background:({'1':'rgba(251,191,36,0.15)','2':'rgba(96,165,250,0.15)','3':'rgba(34,197,94,0.15)','4':'rgba(249,115,22,0.15)'}[ionTarget.charge]||'rgba(148,163,184,0.1)'),color:({'1':'#fbbf24','2':'#60a5fa','3':'#22c55e','4':'#f97316'}[ionTarget.charge]||'#94a3b8'),borderRadius:'0.25rem',fontSize:'0.75rem',fontWeight:700}}>
                                z={ionTarget.charge}
                              </span>
                            )}
                            <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>± 10 ppm · dashed line = reported value</span>
                          </div>
                          {ionLoading && <div style={{fontSize:'0.75rem',color:'var(--muted)',marginTop:'0.3rem'}}>Extracting from raw .d data…</div>}
                          {!ionLoading && !ionDetail && !frameHeatmap && !frameSpectrum && (
                            <div style={{fontSize:'0.75rem',color:'#f97316',marginTop:'0.3rem'}}>
                              No raw signal found — the timsdata DLL may be unavailable, or this run has no MS1 frames at this m/z. Check that timsdata.dll is present in stan/tools/timsdata/libs/.
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setIonTarget(null); setIonDetail(null);
                            setFrameHeatmap(null); setFrameSpectrum(null);
                          }}
                          style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:'0.3rem',padding:'0.2rem 0.5rem',cursor:'pointer',fontSize:'0.8rem',flexShrink:0}}
                        >
                          ✕ Close
                        </button>
                      </div>

                      {(ionDetail || frameHeatmap || frameSpectrum) && (
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>

                          {/* Row 1 — left: XIC · right: Summed Frame Spectrum */}
                          <div>
                            <div style={{fontSize:'0.78rem',color:'#60a5fa',fontWeight:600,marginBottom:'0.3rem'}}>
                              Extracted Ion Chromatogram (XIC)
                              <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'0.4rem',fontSize:'0.72rem'}}>full run · dashed = reported RT</span>
                            </div>
                            <div ref={xicRef} style={{height:'220px',background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)'}} />
                          </div>
                          <div>
                            <div style={{fontSize:'0.78rem',color:'#a78bfa',fontWeight:600,marginBottom:'0.3rem'}}>
                              Summed Frame Spectrum
                              {frameSpectrum && <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'0.4rem',fontSize:'0.72rem'}}>RT {(frameSpectrum.rt_sec/60).toFixed(2)} min · all mobility scans summed</span>}
                            </div>
                            <div ref={frameSpectrumRef} style={{height:'220px',background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)'}} />
                          </div>

                          {/* Row 2 — left: EIM mobilogram · right: Frame Heatmap */}
                          <div>
                            <div style={{fontSize:'0.78rem',color:'#22c55e',fontWeight:600,marginBottom:'0.3rem'}}>
                              Extracted Ion Mobilogram (EIM)
                              <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'0.4rem',fontSize:'0.72rem'}}>±20 s RT window · dashed = reported 1/K₀</span>
                            </div>
                            <div ref={mobilogramRef} style={{height:'280px',background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)'}} />
                          </div>
                          <div>
                            <div style={{fontSize:'0.78rem',color:'#38bdf8',fontWeight:600,marginBottom:'0.3rem'}}>
                              Frame Heatmap — raw m/z × 1/K₀
                              {frameHeatmap && <span style={{fontWeight:400,color:'var(--muted)',marginLeft:'0.4rem',fontSize:'0.72rem'}}>{frameHeatmap.n_peaks?.toLocaleString()} peaks · crosshairs = clicked ion</span>}
                            </div>
                            <div ref={frameHeatmapRef} style={{height:'280px',background:'var(--bg)',borderRadius:'0.3rem',border:'1px solid var(--border)'}} />
                          </div>

                        </div>
                      )}
                    </div>
                  )}

                  {/* RT × 1/K0 feature density heatmap */}
                  {mapData && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.4rem'}}>
                        <h3 style={{margin:0}}>RT × 1/K₀ Feature Density Map</h3>
                        <ExportBtn plotRef={canvasRef} filename={`${selectedRun?.run_name||'run'}-mobility-heatmap`} isCanvas={true} />
                      </div>
                      <div style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.5rem'}}>
                        log₁₀(Σ intensity) &nbsp;·&nbsp; {mapData.n_features?.toLocaleString()} features &nbsp;·&nbsp;
                        RT {(mapData.rt_range[0]/60).toFixed(1)}–{(mapData.rt_range[1]/60).toFixed(1)} min &nbsp;·&nbsp;
                        1/K₀ {mapData.mobility_range[0]}–{mapData.mobility_range[1]} Vs/cm²
                      </div>
                      <div style={{background:'var(--bg)',borderRadius:'0.4rem',overflow:'hidden',border:'1px solid var(--border)'}}>
                        <canvas ref={canvasRef} width={760} height={320} style={{width:'100%',height:'auto',display:'block'}}/>
                      </div>
                    </div>
                  )}

                  {/* Feature statistics histograms */}
                  {statsData && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <h3 style={{marginBottom:'0.6rem'}}>Feature Statistics</h3>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1.4fr 1.4fr',gap:'1rem'}}>
                        <div>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>Charge State Distribution</div>
                          <ChargeChart data={charge} />
                        </div>
                        <div>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>1/K₀ FWHM Distribution</div>
                          <BarChart
                            edges={fwhm?.edges} counts={fwhm?.counts}
                            color="#38bdf8" xLabel="1/K₀ FWHM (Vs/cm²)" yLabel="Features"
                            markerVal={fwhm?.median_fwhm}
                            markerLabel={fwhm?.median_fwhm != null ? `med=${fwhm.median_fwhm.toFixed(4)}` : null}
                          />
                        </div>
                        <div>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginBottom:'0.25rem'}}>Feature Intensity (log₁₀)</div>
                          <BarChart
                            edges={intHist?.edges} counts={intHist?.counts}
                            color="#a78bfa" xLabel="log₁₀(Intensity)" yLabel="Features"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Method Coverage — ions inside vs outside windows ── */}
                  {windowCoverage && filteredData3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.5rem',flexWrap:'wrap',gap:'0.5rem'}}>
                        <div>
                          <h3 style={{margin:0}}>Method Coverage — m/z × 1/K₀</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.2rem'}}>
                            Which ions fall inside the isolation windows?
                            {windowData?.windows?.length > 0 && ' · diaPASEF windows'}
                            {pasefData?.events?.length > 0 && ' · ddaPASEF events'}
                            &nbsp;·&nbsp; <span style={{color:'#60a5fa'}}>click any point → XIC + mobilogram</span>
                          </div>
                        </div>
                        {/* Coverage stats badges */}
                        <div style={{display:'flex',gap:'0.6rem',alignItems:'center',flexWrap:'wrap'}}>
                          {windowCoverage.n_dia > 0 && (
                            <div style={{textAlign:'center',background:'rgba(0,174,183,0.1)',border:'1px solid rgba(0,174,183,0.3)',borderRadius:'0.4rem',padding:'0.25rem 0.6rem'}}>
                              <div style={{fontWeight:700,fontSize:'1rem',color:'#00d4e0'}}>{windowCoverage.n_dia.toLocaleString()}</div>
                              <div style={{fontSize:'0.65rem',color:'var(--muted)'}}>inside DIA ({(windowCoverage.n_dia/windowCoverage.n_total*100).toFixed(1)}%)</div>
                            </div>
                          )}
                          {windowCoverage.n_pasef > 0 && (
                            <div style={{textAlign:'center',background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.3)',borderRadius:'0.4rem',padding:'0.25rem 0.6rem'}}>
                              <div style={{fontWeight:700,fontSize:'1rem',color:'#fbbf24'}}>{windowCoverage.n_pasef.toLocaleString()}</div>
                              <div style={{fontSize:'0.65rem',color:'var(--muted)'}}>inside PASEF ({(windowCoverage.n_pasef/windowCoverage.n_total*100).toFixed(1)}%)</div>
                            </div>
                          )}
                          <div style={{textAlign:'center',background:'rgba(148,163,184,0.07)',border:'1px solid rgba(148,163,184,0.15)',borderRadius:'0.4rem',padding:'0.25rem 0.6rem'}}>
                            <div style={{fontWeight:700,fontSize:'1rem',color:'#94a3b8'}}>{windowCoverage.n_out.toLocaleString()}</div>
                            <div style={{fontSize:'0.65rem',color:'var(--muted)'}}>outside ({(windowCoverage.n_out/windowCoverage.n_total*100).toFixed(1)}%)</div>
                          </div>
                        </div>
                      </div>
                      <div ref={coverageRef} style={{height:'380px'}} />
                      <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.3rem',paddingLeft:'0.2rem'}}>
                        Coloured ions = inside window (by charge) · Gray = outside · Rectangles = isolation windows
                        {pasefData?.events?.length > 0 && ' · Amber outlines = individual PASEF events'}
                      </div>
                    </div>
                  )}

                  {/* ── PASEF Polygon — ddaPASEF event coverage in m/z × 1/K₀ ── */}
                  {pasefData?.events?.length > 0 && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.35rem',flexWrap:'wrap',gap:'0.4rem'}}>
                        <div>
                          <h3 style={{margin:0}}>PASEF Polygon — ddaPASEF Coverage</h3>
                          <div style={{color:'var(--muted)',fontSize:'0.75rem',marginTop:'0.15rem'}}>
                            {pasefData.n_events.toLocaleString()} precursor isolation events · each point = one MS2 frame event
                            · colour = retention time · diagonal band = ion mobility–m/z correlation
                          </div>
                        </div>
                        <div style={{fontSize:'0.72rem',color:'var(--muted)',textAlign:'right',lineHeight:'1.5'}}>
                          <div>y: 1/K₀ centre of scan range</div>
                          <div style={{color:'#fbbf24'}}>like Bruker timsControl</div>
                        </div>
                      </div>
                      <div ref={pasefPolygonRef} style={{height:'320px'}} />
                    </div>
                  )}

                  {/* ── Corridor Map ─── */}
                  {data3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{marginBottom:'0.4rem'}}>
                        <h3 style={{margin:0}}>Charge-State Mobility Corridors</h3>
                        <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                          1/K₀ vs m/z · each charge state forms a distinct diagonal band · fitted corridors ± 1.5σ
                          · <span style={{color:'#60a5fa'}}>this separation does not exist in 2D Orbitrap data</span>
                        </div>
                      </div>
                      <div ref={corridorMapRef} style={{height:'280px'}} />
                    </div>
                  )}

                  {/* ── Charge Ridgeline ─── */}
                  {data3d && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{marginBottom:'0.4rem'}}>
                        <h3 style={{margin:0}}>1/K₀ Distribution by Charge State</h3>
                        <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                          KDE of ion mobility per charge state · higher z = larger peptide = higher 1/K₀ at same m/z
                          · peak widths reflect TIMS resolving power
                        </div>
                      </div>
                      <div ref={ridgelineRef} style={{height:'240px'}} />
                    </div>
                  )}

                  {/* ── PASEF Isolation Score ─── */}
                  {isolationScore && (
                    <div className="card" style={{marginBottom:'0.75rem'}}>
                      <div style={{marginBottom:'0.5rem'}}>
                        <h3 style={{margin:0}}>PASEF Isolation Score</h3>
                        <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.15rem'}}>
                          Of all co-eluting precursor pairs within the m/z isolation window, what fraction does TIMS separate by ≥1 FWHM in 1/K₀?
                          · <span style={{color:'#22c55e'}}>green = resolved</span> · <span style={{color:'#ef4444'}}>red = chimeric risk</span>
                        </div>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'1.25rem',alignItems:'start'}}>
                        {/* KPI + controls */}
                        <div style={{minWidth:'160px'}}>
                          <div style={{textAlign:'center',padding:'0.75rem',background:'rgba(0,0,0,0.2)',borderRadius:'0.5rem',
                            border:`2px solid ${isolationScore.pct >= 80 ? '#22c55e' : isolationScore.pct >= 60 ? '#eab308' : '#ef4444'}44`}}>
                            <div style={{fontSize:'2.2rem',fontWeight:800,fontVariantNumeric:'tabular-nums',lineHeight:1,
                              color: isolationScore.pct >= 80 ? '#22c55e' : isolationScore.pct >= 60 ? '#eab308' : '#ef4444'}}>
                              {isolationScore.pct}%
                            </div>
                            <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:'0.3rem'}}>mobility-resolved pairs</div>
                            <div style={{fontSize:'0.65rem',color:'#4a6070',marginTop:'0.2rem'}}>
                              {isolationScore.resolvedPairs.toLocaleString()} / {isolationScore.totalPairs.toLocaleString()} pairs
                            </div>
                          </div>
                          <div style={{marginTop:'0.75rem',display:'flex',flexDirection:'column',gap:'0.4rem'}}>
                            <label style={{fontSize:'0.72rem',color:'var(--muted)'}}>
                              m/z window ±{isoMzWindow} Th
                              <input type="range" min="0.5" max="25" step="0.5" value={isoMzWindow}
                                onChange={e => setIsoMzWindow(+e.target.value)}
                                style={{width:'100%',marginTop:'0.15rem',accentColor:'#22d3ee'}} />
                            </label>
                            <label style={{fontSize:'0.72rem',color:'var(--muted)'}}>
                              RT window ±{isoRtWindow}s
                              <input type="range" min="5" max="120" step="5" value={isoRtWindow}
                                onChange={e => setIsoRtWindow(+e.target.value)}
                                style={{width:'100%',marginTop:'0.15rem',accentColor:'#22d3ee'}} />
                            </label>
                            <div style={{fontSize:'0.67rem',color:'#4a6070',lineHeight:'1.4',marginTop:'0.2rem'}}>
                              TIMS FWHM threshold: {isolationScore.mobilityFwhm.toFixed(4)} Vs/cm²
                            </div>
                          </div>
                        </div>
                        {/* Histogram */}
                        <div>
                          <div style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:'0.2rem'}}>
                            |Δ(1/K₀)| distribution for co-isolating pairs · <span style={{color:'#DAAA00'}}>dashed = 1 FWHM threshold</span>
                          </div>
                          <div ref={isolationHistRef} style={{height:'200px'}} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* diaPASEF window layout */}
                  {windowData && (
                    <div className="card">
                      <h3 style={{marginBottom:'0.4rem'}}>diaPASEF Window Layout</h3>
                      <div style={{color:'var(--muted)',fontSize:'0.78rem',marginBottom:'0.5rem'}}>
                        m/z × 1/K₀ isolation grid &nbsp;·&nbsp;
                        m/z {windowData.mz_range[0].toFixed(0)}–{windowData.mz_range[1].toFixed(0)} Da
                        {windowData.mobility_range[0] > 0 && ` · 1/K₀ ${windowData.mobility_range[0].toFixed(2)}–${windowData.mobility_range[1].toFixed(2)} Vs/cm²`}
                        &nbsp;·&nbsp; {windowData.n_window_groups} group{windowData.n_window_groups !== 1 ? 's' : ''}
                        &nbsp;·&nbsp; {windowData.windows.length} sub-window{windowData.windows.length !== 1 ? 's' : ''}
                      </div>
                      <div style={{background:'var(--bg)',borderRadius:'0.4rem',padding:'0.25rem',border:'1px solid var(--border)'}}>
                        <DiaWindowChart data={windowData} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      );
    }

