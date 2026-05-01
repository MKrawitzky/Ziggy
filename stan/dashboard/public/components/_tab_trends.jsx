    function TrendCharts({ pinnedRunIds, setPinnedRunIds }) {
      // Pull instruments from actual runs in the DB, not from instruments.yml config
      const { data: allRuns } = useFetch('/api/runs?limit=1000');
      const [selected, setSelected] = useState(null);
      const [trends, setTrends] = useState(null);
      const [events, setEvents] = useState([]);
      const [timeFilter, setTimeFilter] = useState('all');

      const PINNED_KEY = '__pinned__';
      const hasPins = pinnedRunIds && pinnedRunIds.size > 0;

      const names = useMemo(() => {
        if (!allRuns) return [];
        return [...new Set(allRuns.map(r => r.instrument).filter(Boolean))];
      }, [allRuns]);

      // Auto-select "Pinned" when pins arrive; fall back to first instrument otherwise
      useEffect(() => {
        if (hasPins && selected !== PINNED_KEY) setSelected(PINNED_KEY);
        else if (!hasPins && selected === PINNED_KEY) setSelected(names[0] || null);
        else if (names.length && !selected) setSelected(names[0]);
      }, [hasPins, names]);

      // Fetch instrument trends (skip when in pinned mode)
      useEffect(() => {
        if (!selected || selected === PINNED_KEY) return;
        fetch(API + `/api/trends/${encodeURIComponent(selected)}?limit=500`).then(r => r.json()).then(setTrends);
        fetch(API + `/api/instruments/${encodeURIComponent(selected)}/events?limit=50`).then(r => r.json()).then(d => setEvents(d || []));
      }, [selected]);

      // In pinned mode, derive trends from allRuns filtered to pinned IDs
      const pinnedTrends = useMemo(() => {
        if (!hasPins || !allRuns) return null;
        return [...allRuns]
          .filter(r => pinnedRunIds.has(String(r.id)))
          .sort((a, b) => (a.run_date || '').localeCompare(b.run_date || ''));
      }, [hasPins, allRuns, pinnedRunIds]);

      // Filter trends by time range
      const filteredTrends = useMemo(() => {
        const source = selected === PINNED_KEY ? pinnedTrends : trends;
        if (!source) return null;
        if (timeFilter === 'all') return source;
        const now = new Date();
        const cutoffs = { week: 7, month: 30, '3month': 90, '6month': 180, year: 365 };
        const days = cutoffs[timeFilter] || 0;
        if (!days) return source;
        const cutoff = new Date(now.getTime() - days * 86400000);
        return source.filter(r => new Date(r.run_date) >= cutoff);
      }, [trends, pinnedTrends, selected, timeFilter]);

      // Merge events into trend data by finding the nearest run date for each event
      function findEventsBetween(runs, idx) {
        if (!events.length || !runs || !runs.length) return [];
        const runDate = new Date(runs[idx]?.run_date);
        const prevDate = idx > 0 ? new Date(runs[idx - 1]?.run_date) : new Date(0);
        return events.filter(e => {
          const ed = new Date(e.event_date);
          return ed > prevDate && ed <= runDate;
        });
      }

      return (
        <div>
          {/* Instrument selector tabs (+ Pinned virtual tab) */}
          <div className="tabs" style={{marginBottom:'0.6rem'}}>
            {hasPins && (
              <div
                className={`tab ${selected === PINNED_KEY ? 'active' : ''}`}
                onClick={() => setSelected(PINNED_KEY)}
                style={{borderColor: selected === PINNED_KEY ? '#DAAA00' : undefined, color: selected === PINNED_KEY ? '#DAAA00' : '#DAAA00', opacity: selected === PINNED_KEY ? 1 : 0.7}}
              >
                ☆ Pinned ({pinnedRunIds.size})
              </div>
            )}
            {names.length === 0 && !hasPins ? (
              <div style={{color:'var(--muted)'}}>No runs in database yet. Run a baseline first.</div>
            ) : names.map(n => <div key={n} className={`tab ${n === selected ? 'active' : ''}`} onClick={() => setSelected(n)}>{n}</div>)}
          </div>

          {/* Pin-mode banner */}
          {selected === PINNED_KEY && hasPins && (
            <div style={{display:'flex', gap:'0.5rem', alignItems:'center', padding:'0.4rem 0.7rem', marginBottom:'0.75rem', background:'rgba(218,170,0,0.08)', border:'1px solid rgba(218,170,0,0.3)', borderRadius:'0.4rem', fontSize:'0.83rem', flexWrap:'wrap'}}>
              <span style={{color:'#DAAA00', fontWeight:700}}>Pinned view — {pinnedRunIds.size} runs selected in Run History</span>
              <button onClick={() => setPinnedRunIds(new Set())} style={{padding:'0.15rem 0.45rem', fontSize:'0.78rem', background:'transparent', color:'var(--muted)', border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer'}}>Clear pins</button>
            </div>
          )}

          <div style={{display:'flex', gap:'0.5rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'center'}}>
            <span style={{fontSize:'0.85rem', color:'var(--muted)'}}>Time range:</span>
            {[['week','Week'], ['month','Month'], ['3month','3 Months'], ['6month','6 Months'], ['year','Year'], ['all','All']].map(([k, label]) => (
              <button key={k}
                onClick={() => setTimeFilter(k)}
                style={{
                  padding:'0.3rem 0.7rem',
                  background: timeFilter === k ? 'var(--accent)' : 'var(--bg)',
                  color: timeFilter === k ? '#000' : 'var(--text)',
                  border:'1px solid var(--border)',
                  borderRadius:'0.3rem',
                  cursor:'pointer',
                  fontSize:'0.8rem',
                }}>{label}</button>
            ))}
            {filteredTrends && <span style={{fontSize:'0.85rem', color:'var(--muted)', marginLeft:'auto'}}>{filteredTrends.length} runs</span>}
          </div>
          {!filteredTrends || filteredTrends.length === 0
            ? <div className="empty">No trend data for {selected === PINNED_KEY ? 'pinned runs' : (selected || 'this instrument')}.</div>
            : <TrendGraphs runs={filteredTrends} events={selected === PINNED_KEY ? [] : events} />
          }
        </div>
      );
    }

    // ── Shared baseline helpers (used by multiple components) ─────────────
    function trendBaseline(runs) {
      const baselineRuns = runs.length >= 5 ? runs.slice(0, -3) : runs.slice(0, -1);
      function med(arr) {
        if (!arr.length) return null;
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      }
      function bmed(key) {
        const vals = baselineRuns.map(r => r[key]).filter(v => v != null && !isNaN(v) && v > 0);
        return vals.length >= 1 ? med(vals) : null;
      }
      return bmed;
    }

    function trendIssues(runs) {
      if (!runs || runs.length < 2) return { issues: [], severity: 'ok' };
      const last = runs[runs.length - 1];
      const bmed = trendBaseline(runs);
      const issues = [];
      let severity = 'ok';
      function add(msg, sev, detail) {
        issues.push({ msg, sev, detail: detail || null });
        if (sev === 'critical' || (sev === 'warn' && severity === 'ok')) severity = sev;
      }
      const lastIds = last.n_precursors || last.n_psms || 0;
      const baseIds = bmed('n_precursors') || bmed('n_psms');
      if (baseIds && lastIds > 0) {
        const pct = (lastIds / baseIds) * 100;
        if (pct < 65) add(`IDs down ${Math.round(100 - pct)}%`, 'critical', 'LC, source, or search problem');
        else if (pct < 82) add(`IDs down ${Math.round(100 - pct)}%`, 'warn', 'check instrument condition');
      }
      if (last.ips_score != null) {
        if (last.ips_score < 28)      add(`IPS ${last.ips_score}/100`, 'critical', 'critically poor performance');
        else if (last.ips_score < 42) add(`IPS ${last.ips_score}/100`, 'warn',     'below expected performance');
      }
      if (last.pct_charge_1 != null) {
        const base1 = bmed('pct_charge_1');
        if (base1 != null && last.pct_charge_1 > base1 * 2.5 && last.pct_charge_1 > 4)
          add(`Charge-1 spike ${last.pct_charge_1.toFixed(1)}%`, 'critical', 'emitter blocked or source contamination');
        else if (last.pct_charge_1 > 12)
          add(`Charge-1 elevated ${last.pct_charge_1.toFixed(1)}%`, 'warn', 'check spray stability');
      }
      if (last.ms1_signal != null) {
        const baseSig = bmed('ms1_signal');
        if (baseSig && last.ms1_signal < baseSig * 0.45)
          add(`MS1 signal −${Math.round((1 - last.ms1_signal / baseSig) * 100)}%`, 'critical', 'check spray, column, mobile phase');
        else if (baseSig && last.ms1_signal < baseSig * 0.65)
          add(`MS1 signal −${Math.round((1 - last.ms1_signal / baseSig) * 100)}%`, 'warn', null);
      }
      if (last.fwhm_rt_min != null) {
        const baseFwhm = bmed('fwhm_rt_min');
        if (baseFwhm && last.fwhm_rt_min > baseFwhm * 1.6)
          add(`Peaks ${Math.round((last.fwhm_rt_min / baseFwhm - 1) * 100)}% wider`, 'warn', 'column likely degraded');
      }
      if (last.missed_cleavage_rate != null) {
        const baseMCR = bmed('missed_cleavage_rate');
        if (baseMCR != null && last.missed_cleavage_rate > baseMCR * 2.5 && last.missed_cleavage_rate > 0.12)
          add(`Missed cleavages ${(last.missed_cleavage_rate * 100).toFixed(0)}%`, 'warn', 'digestion problem');
      }
      return { issues, severity, last, bmed };
    }

    // ── IPS ring — animated SVG gauge ─────────────────────────────────────
    function IPSRing({ score, severity, size=110 }) {
      const r = size * 0.4;
      const circ = 2 * Math.PI * r;
      const filled = score != null ? Math.min(score / 100, 1) * circ : 0;
      const NEO = { ok: '#39ff14', warn: '#ff8c00', critical: '#ff2244' };
      const c = NEO[severity] || '#39ff14';
      const cx = size / 2, cy = size / 2;
      const isAlert = severity !== 'ok';
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
          style={{flexShrink:0, filter:`drop-shadow(0 0 ${isAlert ? 16 : 8}px ${c})`}}>
          {/* Ripple rings for warn/critical */}
          {isAlert && [1,2].map(n => (
            <circle key={n} cx={cx} cy={cy} r={r + 4} fill="none" stroke={c} strokeWidth="1.5"
              opacity="0" style={{animation:`glow-ripple ${1.6 + n * 0.4}s ease-out ${n * 0.5}s infinite`}} />
          ))}
          {/* Track */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
          {/* Arc */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${filled.toFixed(1)} ${(circ - filled).toFixed(1)}`}
            strokeDashoffset={(circ / 4).toFixed(1)}
            style={{transition:'stroke-dasharray 0.7s cubic-bezier(.4,0,.2,1)'}} />
          {/* Score */}
          <text x={cx} y={cy - 5} textAnchor="middle" fill={c}
            fontSize={score != null ? Math.round(size * 0.22) : Math.round(size * 0.18)}
            fontWeight="900" fontFamily="monospace">{score != null ? score : '—'}</text>
          <text x={cx} y={cy + size * 0.14} textAnchor="middle"
            fill="rgba(255,255,255,0.35)" fontSize={Math.round(size * 0.1)} fontFamily="sans-serif">IPS</text>
        </svg>
      );
    }

    // ── Run story bar — TikTok-style story bubbles ─────────────────────────
    function RunStoryBar({ runs }) {
      if (!runs || runs.length < 2) return null;
      const recent = [...runs].reverse().slice(0, 30);
      function ipsColor(ips, gateResult) {
        if (ips == null && !gateResult) return '#cc88ff';
        if (gateResult === 'fail') return '#ff2244';
        if (ips == null) return gateResult === 'pass' ? '#39ff14' : '#ff8c00';
        if (ips >= 70) return '#39ff14';
        if (ips >= 50) return '#ffe600';
        if (ips >= 35) return '#ff8c00';
        return '#ff2244';
      }
      return (
        <div style={{display:'flex', gap:'0.55rem', overflowX:'auto', paddingBottom:'0.4rem', marginBottom:'1rem', scrollbarWidth:'thin'}}>
          {recent.map((run, i) => {
            const ips = run.ips_score;
            const c = ipsColor(ips, run.gate_result);
            const ids = run.n_precursors || run.n_psms || 0;
            const date = run.run_date ? run.run_date.substring(5, 10) : '';
            const isLatest = i === 0;
            return (
              <div key={run.id || i} title={`${run.run_name || run.id}\nIPS: ${ips ?? '—'}\nIDs: ${ids.toLocaleString()}\n${run.gate_result || 'unrated'}`}
                style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'0.28rem',
                  minWidth:'52px', animation:`story-pop 0.3s ease ${Math.min(i * 0.04, 0.6)}s both`}}>
                <div style={{
                  width: isLatest ? '48px' : '40px',
                  height: isLatest ? '48px' : '40px',
                  borderRadius:'50%',
                  border:`${isLatest ? 3 : 2}px solid ${c}`,
                  boxShadow:`0 0 ${isLatest ? 18 : 10}px ${c}88`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  background:'rgba(17,0,40,0.85)',
                  fontSize: isLatest ? '0.72rem' : '0.62rem',
                  fontWeight:'800', color: c, fontFamily:'monospace',
                  cursor:'default', position:'relative',
                  ...(isLatest ? {animation:'neon-pulse 2.2s ease-in-out infinite'} : {}),
                }}>
                  {ips != null ? ips : '?'}
                  {isLatest && <div style={{
                    position:'absolute', top:'-4px', right:'-4px',
                    width:'10px', height:'10px', borderRadius:'50%',
                    background: c, boxShadow:`0 0 8px ${c}`,
                    border:'2px solid #06000f',
                  }} />}
                </div>
                <span style={{fontSize:'0.6rem', color: isLatest ? c : 'var(--muted)', fontWeight: isLatest ? 700 : 400, whiteSpace:'nowrap'}}>{isLatest ? 'LATEST' : date}</span>
              </div>
            );
          })}
        </div>
      );
    }

    // ── Stat delta cards — big numbers with ↑↓ vs baseline ────────────────
    function StatDeltaCards({ runs }) {
      if (!runs || runs.length < 2) return null;
      const last = runs[runs.length - 1];
      const bmed = trendBaseline(runs);
      const cards = [
        { label:'Last IDs',    key:'n_precursors', altKey:'n_psms', fmt: v => v > 1000 ? (v/1000).toFixed(1)+'k' : String(v), color:'#00ffff', higherBetter:true },
        { label:'IPS Score',   key:'ips_score',    fmt: v => `${v}/100`,                   color:'#ffe600', higherBetter:true },
        { label:'MS1 Signal',  key:'ms1_signal',   fmt: fmtSig,                            color:'#a855f7', higherBetter:true },
        { label:'Peak FWHM',   key:'fwhm_rt_min',  fmt: v => `${v.toFixed(2)}m`,           color:'#ff8c00', higherBetter:false },
        { label:'Charge-1 %',  key:'pct_charge_1', fmt: v => `${v.toFixed(1)}%`,           color:'#ff2244', higherBetter:false },
        { label:'Miss. Cleav', key:'missed_cleavage_rate', fmt: v => `${(v*100).toFixed(1)}%`, color:'#fb923c', higherBetter:false },
      ];
      const visible = cards.filter(c => {
        const v = last[c.key] ?? (c.altKey ? last[c.altKey] : null);
        return v != null && v > 0;
      });
      if (!visible.length) return null;
      return (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(130px, 1fr))', gap:'0.55rem', marginBottom:'1rem'}}>
          {visible.map(card => {
            const val = last[card.key] ?? (card.altKey ? last[card.altKey] : null);
            const base = bmed(card.key) ?? (card.altKey ? bmed(card.altKey) : null);
            const deltaPct = (val != null && base != null) ? ((val - base) / base) * 100 : null;
            const good = deltaPct == null ? null : card.higherBetter ? deltaPct >= 0 : deltaPct <= 0;
            const badMag = deltaPct != null && !good ? Math.abs(deltaPct) : 0;
            const dc = deltaPct == null ? 'var(--muted)'
              : good ? '#39ff14'
              : badMag > 25 ? '#ff2244'
              : '#ff8c00';
            const sign = deltaPct != null ? (deltaPct >= 0 ? '↑' : '↓') : '';
            return (
              <div key={card.label} style={{
                background:'rgba(17,0,40,0.88)',
                border:`1.5px solid ${card.color}55`,
                borderRadius:'0.6rem', padding:'0.7rem 0.75rem',
                boxShadow:`0 0 18px ${card.color}18`,
                display:'flex', flexDirection:'column', gap:'0.1rem',
              }}>
                <div style={{fontSize:'1.4rem', fontWeight:'900', color: card.color,
                  fontFamily:'monospace', letterSpacing:'-0.02em', lineHeight:1.1,
                  fontVariantNumeric:'tabular-nums', textShadow:`0 0 12px ${card.color}88`}}>
                  {val != null ? card.fmt(val) : '—'}
                </div>
                <div style={{fontSize:'0.68rem', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.06em'}}>{card.label}</div>
                {deltaPct != null && (
                  <div style={{fontSize:'0.75rem', color: dc, fontWeight:'700', marginTop:'0.2rem'}}>
                    {sign}{Math.abs(deltaPct).toFixed(1)}% vs baseline
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    // ── Vibe Check card — the big status banner ────────────────────────────
    function TrendAlertBanner({ runs }) {
      if (!runs || runs.length < 2) return null;
      const { issues, severity, last } = trendIssues(runs);

      const VIBE = {
        ok:       { bg:'rgba(57,255,20,0.05)',  border:'#39ff14', color:'#39ff14', label:'ALL CLEAR',        sub:'Last run within normal range' },
        warn:     { bg:'rgba(255,140,0,0.07)',  border:'#ff8c00', color:'#ff8c00', label:'LOOK INTO THIS',   sub:'Something needs your attention' },
        critical: { bg:'rgba(255,34,68,0.08)',  border:'#ff2244', color:'#ff2244', label:"SOMETHING'S WRONG", sub:'Act before your next injection' },
      };
      const v = VIBE[severity];
      const lastDate = last.run_date ? last.run_date.substring(0, 10) : '';
      const ips = last.ips_score;

      return (
        <div className="slide-in" style={{
          padding:'1rem 1.25rem', marginBottom:'0.75rem',
          background: v.bg,
          border:`2px solid ${v.border}`,
          borderRadius:'0.75rem',
          boxShadow:`0 0 32px ${v.border}28, inset 0 0 60px ${v.border}06`,
          display:'flex', gap:'1.25rem', alignItems:'center', flexWrap:'wrap',
        }}>
          {/* Animated IPS ring */}
          <IPSRing score={ips} severity={severity} size={100} />

          {/* Status text */}
          <div style={{flex:1, minWidth:'200px'}}>
            <div style={{
              fontWeight:'900', fontSize:'1.25rem', color: v.color,
              letterSpacing:'0.08em', textTransform:'uppercase',
              textShadow:`0 0 20px ${v.border}`,
              ...(severity !== 'ok' ? {animation:'neon-pulse 2s ease-in-out infinite'} : {}),
            }}>{v.label}</div>
            <div style={{fontSize:'0.78rem', color:'var(--muted)', marginTop:'0.15rem', marginBottom:'0.5rem'}}>
              {v.sub} · {last.run_name || last.id} · {lastDate}
            </div>
            {issues.length > 0 && (
              <div style={{display:'flex', flexWrap:'wrap', gap:'0.4rem'}}>
                {issues.map((iss, i) => (
                  <div key={i} style={{
                    display:'inline-flex', flexDirection:'column',
                    background: iss.sev === 'critical' ? 'rgba(255,34,68,0.12)' : 'rgba(255,140,0,0.10)',
                    border:`1px solid ${iss.sev === 'critical' ? '#ff2244' : '#ff8c00'}88`,
                    borderRadius:'0.4rem', padding:'0.3rem 0.55rem',
                  }}>
                    <span style={{fontSize:'0.8rem', fontWeight:'700', color: iss.sev === 'critical' ? '#ff2244' : '#ff8c00'}}>
                      {iss.sev === 'critical' ? '⛔' : '⚠'} {iss.msg}
                    </span>
                    {iss.detail && <span style={{fontSize:'0.7rem', color:'var(--muted)', marginTop:'0.1rem'}}>{iss.detail}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Simple SVG sparkline trend component
    // higherIsBetter: true = flag low values red (IDs, IPS, signal)
    //                 false = flag high values red (charge-1, missed cleavages, peak width)
    function Sparkline({ values, maintEvents, runs, label, color='#60a5fa', height=120, higherIsBetter=true }) {
      if (!values || values.length < 2) {
        return <div style={{color:'var(--muted)', fontSize:'0.8rem'}}>Not enough data</div>;
      }
      const validValues = values.map(v => v == null || isNaN(v) ? 0 : v);
      const nonZero = validValues.filter(v => v > 0);
      const min = Math.min(...validValues);
      const max = Math.max(...validValues);
      const range = max - min || 1;
      const width = 800;
      const padding = 10;
      const w = width - padding * 2;
      const h = height - padding * 2;
      const points = validValues.map((v, i) => {
        const x = padding + (validValues.length === 1 ? w/2 : (i / (validValues.length - 1)) * w);
        const y = padding + h - ((v - min) / range) * h;
        return [x, y];
      });
      const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

      // Stats for SD bands and dot coloring
      const mean = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
      const sd = nonZero.length >= 3 ? Math.sqrt(nonZero.reduce((a, b) => a + (b - mean) ** 2, 0) / nonZero.length) : 0;
      const meanY = mean > 0 ? padding + h - ((mean - min) / range) * h : null;
      const clamp = y => Math.max(padding, Math.min(padding + h, y));

      // SD band Y coordinates
      let sd1TopY, sd1BotY, sd2TopY, sd2BotY;
      if (sd > 0 && mean > 0) {
        sd1TopY = clamp(padding + h - ((mean + sd - min) / range) * h);
        sd1BotY = clamp(padding + h - ((mean - sd - min) / range) * h);
        sd2TopY = clamp(padding + h - ((mean + 2*sd - min) / range) * h);
        sd2BotY = clamp(padding + h - ((mean - 2*sd - min) / range) * h);
      }

      // Dot color: z-score relative to mean; direction depends on higherIsBetter
      function dotColor(v) {
        if (!v || sd === 0) return color;
        const z = higherIsBetter ? (v - mean) / sd : (mean - v) / sd;
        if (z < -2.5) return '#ef4444';
        if (z < -1.2) return '#eab308';
        return color;
      }

      // Find maintenance event positions
      const eventMarks = [];
      if (maintEvents && runs) {
        for (const ev of maintEvents) {
          const evDate = new Date(ev.event_date).getTime();
          let closestIdx = -1;
          let minDist = Infinity;
          runs.forEach((r, i) => {
            const rd = new Date(r.run_date).getTime();
            const dist = Math.abs(rd - evDate);
            if (dist < minDist) { minDist = dist; closestIdx = i; }
          });
          if (closestIdx >= 0 && runs.length > 1) {
            const x = padding + (closestIdx / (runs.length - 1)) * w;
            eventMarks.push({ x, event: ev });
          }
        }
      }

      return (
        <svg viewBox={`0 0 ${width} ${height}`} style={{width:'100%', height:`${height}px`}}>
          {/* ±2σ band */}
          {sd > 0 && sd2TopY != null && (
            <rect x={padding} y={sd2TopY} width={w} height={Math.max(0, sd2BotY - sd2TopY)} fill="rgba(234,179,8,0.04)" />
          )}
          {/* ±1σ band */}
          {sd > 0 && sd1TopY != null && (
            <rect x={padding} y={sd1TopY} width={w} height={Math.max(0, sd1BotY - sd1TopY)} fill="rgba(34,197,94,0.07)" />
          )}
          {/* Mean reference line */}
          {meanY != null && (
            <line x1={padding} y1={meanY} x2={width-padding} y2={meanY} stroke="var(--muted)" strokeDasharray="4,4" strokeWidth="1" opacity="0.45" />
          )}
          {/* Event markers */}
          {eventMarks.map((em, i) => {
            const evColors = {column_change:'#60a5fa', source_clean:'#22c55e', calibration:'#eab308', pm:'#a78bfa', lc_service:'#f472b6', other:'#94a3b8'};
            const c = evColors[em.event.event_type] || '#94a3b8';
            return (
              <g key={i}>
                <line x1={em.x} y1={padding} x2={em.x} y2={height-padding} stroke={c} strokeDasharray="3,3" strokeWidth="2" opacity="0.7">
                  <title>{em.event.event_type}: {em.event.notes || em.event.event_date}</title>
                </line>
              </g>
            );
          })}
          {/* Trend line */}
          <path d={pathD} fill="none" stroke={color} strokeWidth="1.8" opacity="0.55" />
          {/* Dots — color coded by z-score */}
          {points.map(([x, y], i) => {
            const dc = dotColor(validValues[i]);
            const isAlert = dc !== color;
            return (
              <circle key={i} cx={x} cy={y} r={isAlert ? 5 : 3.5} fill={dc} stroke={isAlert ? 'rgba(0,0,0,0.35)' : 'none'} strokeWidth="0.8">
                <title>{runs?.[i]?.run_name}: {validValues[i].toLocaleString()}</title>
              </circle>
            );
          })}
          {/* Labels */}
          <text x={padding} y={padding+4} fill="var(--muted)" fontSize="11">{label}</text>
          <text x={width-padding} y={padding+4} fill="var(--muted)" fontSize="11" textAnchor="end">
            min: {min.toLocaleString()} · max: {max.toLocaleString()}
          </text>
        </svg>
      );
    }

    function TrendGraphs({ runs, events }) {
      // Sort runs by date ascending for trend plotting
      const sorted = [...runs].sort((a, b) => new Date(a.run_date) - new Date(b.run_date));
      const hasCharge1 = sorted.some(r => r.pct_charge_1 != null && r.pct_charge_1 > 0);
      const hasMCR     = sorted.some(r => r.missed_cleavage_rate != null && r.missed_cleavage_rate > 0);
      const hasMassAcc = sorted.some(r => r.median_mass_acc_ms1_ppm != null && r.median_mass_acc_ms1_ppm > 0);

      return (
        <div className="grid" style={{gridTemplateColumns:'1fr'}}>
          {/* Story bubbles — 30 most recent runs, color-coded by IPS */}
          <RunStoryBar runs={sorted} />
          {/* Vibe check card */}
          <TrendAlertBanner runs={sorted} />
          {/* Stat delta cards */}
          <StatDeltaCards runs={sorted} />

          <div className="card">
            <h3>Precursors / PSMs over time</h3>
            <Sparkline
              values={sorted.map(r => r.n_precursors || r.n_psms || 0)}
              maintEvents={events}
              runs={sorted}
              label="Identifications"
              color="#60a5fa"
              higherIsBetter={true}
            />
          </div>
          <div className="card">
            <h3>IPS Score over time</h3>
            <Sparkline
              values={sorted.map(r => r.ips_score || 0)}
              maintEvents={events}
              runs={sorted}
              label="IPS (0-100)"
              color="#22c55e"
              higherIsBetter={true}
            />
          </div>
          <div className="card">
            <h3>MS1 Signal over time</h3>
            <Sparkline
              values={sorted.map(r => r.ms1_signal || 0)}
              maintEvents={events}
              runs={sorted}
              label="Total MS1 ion current"
              color="#a78bfa"
              higherIsBetter={true}
            />
          </div>
          <div className="card">
            <h3>Peak Width (FWHM) over time</h3>
            <Sparkline
              values={sorted.map(r => r.fwhm_rt_min || 0)}
              maintEvents={events}
              runs={sorted}
              label="FWHM in minutes — wider = degraded column"
              color="#eab308"
              higherIsBetter={false}
            />
          </div>

          {/* Diagnostic panels — only shown when data exists */}
          {hasCharge1 && (
            <div className="card">
              <h3>
                Singly-Charged Ions (%) over time
                <span style={{fontSize:'0.75rem', color:'#ef4444', fontWeight:400, marginLeft:'0.5rem'}}>source / emitter health</span>
              </h3>
              <Sparkline
                values={sorted.map(r => r.pct_charge_1 ?? 0)}
                maintEvents={events}
                runs={sorted}
                label="% charge-1 precursors (elevated = spray instability, contamination, or blocked emitter)"
                color="#f97316"
                higherIsBetter={false}
              />
              <div style={{fontSize:'0.72rem', color:'var(--muted)', marginTop:'0.3rem'}}>
                Normal: &lt;5%. Spike after samples → check emitter or source contamination. Persistently high → nano-spray tip worn or clogged.
              </div>
            </div>
          )}

          {hasMCR && (
            <div className="card">
              <h3>
                Missed Cleavage Rate over time
                <span style={{fontSize:'0.75rem', color:'#eab308', fontWeight:400, marginLeft:'0.5rem'}}>digestion quality</span>
              </h3>
              <Sparkline
                values={sorted.map(r => r.missed_cleavage_rate != null ? +(r.missed_cleavage_rate * 100).toFixed(2) : 0)}
                maintEvents={events}
                runs={sorted}
                label="% peptides with ≥1 missed cleavage (rising = incomplete digestion)"
                color="#f59e0b"
                higherIsBetter={false}
              />
              <div style={{fontSize:'0.72rem', color:'var(--muted)', marginTop:'0.3rem'}}>
                Sudden rise after sample prep batch → check trypsin activity, digestion time, or sample denaturation.
              </div>
            </div>
          )}

          {hasMassAcc && (
            <div className="card">
              <h3>
                MS1 Mass Accuracy over time
                <span style={{fontSize:'0.75rem', color:'#22d3ee', fontWeight:400, marginLeft:'0.5rem'}}>calibration</span>
              </h3>
              <Sparkline
                values={sorted.map(r => r.median_mass_acc_ms1_ppm != null ? +Math.abs(r.median_mass_acc_ms1_ppm).toFixed(3) : 0)}
                maintEvents={events}
                runs={sorted}
                label="|median MS1 ppm error| (drifting up = recalibration needed)"
                color="#22d3ee"
                higherIsBetter={false}
              />
              <div style={{fontSize:'0.72rem', color:'var(--muted)', marginTop:'0.3rem'}}>
                Orbitrap: expect &lt;2 ppm. Sudden jump → run calibration file before next injection.
              </div>
            </div>
          )}

          {sorted.some(r => r.mobility_cv != null) && (
            <div className="card">
              <h3>Ion Mobility CV % over time <span style={{fontSize:'0.75rem',color:'#22d3ee',fontWeight:400,marginLeft:'0.4rem'}}>timsTOF · TIMS</span></h3>
              <Sparkline
                values={sorted.map(r => r.mobility_cv ?? null)}
                maintEvents={events}
                runs={sorted}
                label="Mobility CV % (lower = tighter TIMS separation)"
                color="#22d3ee"
                higherIsBetter={false}
              />
              <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:'0.3rem'}}>
                CV = σ/μ of 1/K₀ across all precursors. Rising CV can signal TIMS calibration drift or degraded ion optics before protein counts drop.
              </div>
            </div>
          )}

          <div style={{fontSize:'0.75rem', color:'var(--muted)', padding:'0.5rem', display:'flex', gap:'1.2rem', flexWrap:'wrap'}}>
            <span>Dashed vertical lines = maintenance events. Hover dots for run details.</span>
            <span style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
              <svg width="30" height="10"><circle cx="5" cy="5" r="4.5" fill="#ef4444"/><circle cx="15" cy="5" r="3.5" fill="#eab308"/><circle cx="25" cy="5" r="3.5" fill="#60a5fa"/></svg>
              red &gt;2.5σ · yellow &gt;1.2σ from mean
            </span>
          </div>
        </div>
      );
    }

    // ── Shared file-upload helpers ─────────────────────────────────────────
