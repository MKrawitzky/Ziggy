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

    // Simple SVG sparkline trend component
    function Sparkline({ values, maintEvents, runs, label, color='#60a5fa', height=120 }) {
      if (!values || values.length < 2) {
        return <div style={{color:'var(--muted)', fontSize:'0.8rem'}}>Not enough data</div>;
      }
      const validValues = values.map(v => v == null || isNaN(v) ? 0 : v);
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

      // Compute mean for the reference line
      const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;
      const meanY = padding + h - ((mean - min) / range) * h;

      // Find maintenance event positions
      const eventMarks = [];
      if (maintEvents && runs) {
        for (const ev of maintEvents) {
          const evDate = new Date(ev.event_date).getTime();
          // Find the run closest to this event
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
          {/* Mean reference line */}
          <line x1={padding} y1={meanY} x2={width-padding} y2={meanY} stroke="var(--muted)" strokeDasharray="4,4" strokeWidth="1" opacity="0.4" />
          {/* Event markers */}
          {eventMarks.map((em, i) => {
            const colors = {column_change:'#60a5fa', source_clean:'#22c55e', calibration:'#eab308', pm:'#a78bfa', lc_service:'#f472b6', other:'#94a3b8'};
            const c = colors[em.event.event_type] || '#94a3b8';
            return (
              <g key={i}>
                <line x1={em.x} y1={padding} x2={em.x} y2={height-padding} stroke={c} strokeDasharray="3,3" strokeWidth="2" opacity="0.7">
                  <title>{em.event.event_type}: {em.event.notes || em.event.event_date}</title>
                </line>
              </g>
            );
          })}
          {/* Trend line */}
          <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
          {/* Points */}
          {points.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3" fill={color}>
              <title>{runs?.[i]?.run_name}: {validValues[i].toLocaleString()}</title>
            </circle>
          ))}
          {/* Label */}
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
      return (
        <div className="grid" style={{gridTemplateColumns:'1fr'}}>
          <div className="card">
            <h3>Precursors / PSMs over time</h3>
            <Sparkline
              values={sorted.map(r => r.n_precursors || r.n_psms || 0)}
              maintEvents={events}
              runs={sorted}
              label="Identifications"
              color="#60a5fa"
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
            />
          </div>
          <div className="card">
            <h3>Peak Width (FWHM) over time</h3>
            <Sparkline
              values={sorted.map(r => r.fwhm_rt_min || 0)}
              maintEvents={events}
              runs={sorted}
              label="FWHM in minutes"
              color="#eab308"
            />
          </div>
          <div style={{fontSize:'0.75rem', color:'var(--muted)', padding:'0.5rem'}}>
            Dashed vertical lines = maintenance events. Hover for details.
          </div>
        </div>
      );
    }

    // ── Shared file-upload helpers ─────────────────────────────────────────
