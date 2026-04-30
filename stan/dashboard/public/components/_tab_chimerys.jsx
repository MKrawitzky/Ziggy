/*
 * _tab_chimerys.jsx — Chimerys Deep-Learning Search Analysis Tab
 *
 * Chimerys (MSAID) deconvolutes chimeric MS2 spectra on timsTOF data, identifying
 * multiple peptides per co-fragmented spectrum.  On timsTOF, chimeric spectra arise
 * when precursors overlap in BOTH m/z AND 1/K₀ (ion mobility) — the 4D space where
 * TIMS separation fails.
 *
 * Panels:
 *   1. Stats Summary         — PSMs, chimeric PSMs, rescued peptides, multiplicity, scan rate
 *   2. Chimeric Collision Landscape — Plotly scatter (m/z × 1/K₀), coloured by n co-IDs
 *   3. TIMS Separation Efficiency  — Horizontal stacked bar: chimeric rate per 1/K₀ bin
 *   4. Peptide Length Distribution — Bar chart (MHC-I / MHC-II band annotations)
 *
 * API:
 *   GET /api/runs/{id}/chimerys-collision  → collision_map, mobility_profile, stats
 *   GET /api/runs/{id}/chimerys-stats      → peptide_stats, charge_dist
 */

function ChimerysTab({ navigateTo }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [allRuns,      setAllRuns]      = useState([]);
  const [selRun,       setSelRun]       = useState('');
  const [colData,      setColData]      = useState(null);   // chimerys-collision
  const [statsData,    setStatsData]    = useState(null);   // chimerys-stats
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);

  // Chart refs
  const landscapeRef  = useRef(null);
  const timsBarRef    = useRef(null);
  const lengthBarRef  = useRef(null);

  // ── Load run list ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/runs?limit=1000')
      .then(r => r.json())
      .then(d => setAllRuns(Array.isArray(d) ? d : []))
      .catch(() => setAllRuns([]));
  }, []);

  // ── Filtered run list: .d files only ──────────────────────────────────────
  const timsRuns = allRuns.filter(r =>
    r.raw_path && r.raw_path.endsWith('.d')
  );

  // ── Chimerys availability badge for a run ─────────────────────────────────
  function chimerysAvailable(run) {
    // comparisons.chimerys present and truthy, or check via colData after load
    return run?.comparisons?.chimerys != null;
  }

  // ── Load data when run changes ────────────────────────────────────────────
  useEffect(() => {
    if (!selRun) { setColData(null); setStatsData(null); setError(null); return; }
    setLoading(true);
    setColData(null);
    setStatsData(null);
    setError(null);

    Promise.all([
      fetch(`/api/runs/${selRun}/chimerys-collision`).then(r => r.json()),
      fetch(`/api/runs/${selRun}/chimerys-stats`).then(r => r.json()),
    ])
      .then(([col, st]) => {
        setColData(col);
        setStatsData(st);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selRun]);

  // ── CCS ridgeline helper (globally defined, but also inline for safety) ───
  function ccsExpected(mz, z) {
    return 0.3 + z * 0.12 + mz * (0.00015 + z * 0.00008);
  }

  // ── Panel 2: Chimeric Collision Landscape ─────────────────────────────────
  useEffect(() => {
    const el = landscapeRef.current;
    if (!el || !window.Plotly) return;
    if (!colData?.collision_map) { window.Plotly.purge(el); return; }

    const map = colData.collision_map;

    // Split into 4 groups by count
    const g1 = map.filter(d => d.count === 1);
    const g2 = map.filter(d => d.count === 2);
    const g3 = map.filter(d => d.count === 3);
    const g4 = map.filter(d => d.count >= 4);

    const makeTrace = (pts, name, color, size, opacity) => ({
      type: 'scatter',
      mode: 'markers',
      name,
      x: pts.map(d => d.mz),
      y: pts.map(d => d.mobility),
      marker: { color, size, opacity, line: { width: 0 } },
      hovertemplate: `${name}<br>m/z: %{x:.2f}<br>1/K₀: %{y:.4f}<br>Co-IDs: %{customdata}<extra></extra>`,
      customdata: pts.map(d => d.count),
    });

    const traces = [
      makeTrace(g1, 'Singleton (×1)',   '#64748b', 3, 0.35),
      makeTrace(g2, 'Doublet (×2)',     '#f59e0b', 4, 0.70),
      makeTrace(g3, 'Triplet (×3)',     '#f97316', 5, 0.70),
      makeTrace(g4, 'Highly chimeric (×4+)', '#ef4444', 6, 0.80),
    ];

    // Theoretical CCS ridgelines for z=2,3,4
    const mzRange = [];
    for (let mz = 300; mz <= 1400; mz += 50) mzRange.push(mz);

    const chargeColors = { 2: '#60a5fa', 3: '#a78bfa', 4: '#34d399' };
    [2, 3, 4].forEach(z => {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: `z=${z} CCS`,
        x: mzRange,
        y: mzRange.map(mz => ccsExpected(mz, z)),
        line: { color: chargeColors[z], dash: 'dash', width: 1.2 },
        opacity: 0.6,
        hovertemplate: `z=${z} theoretical CCS<br>m/z %{x:.0f} → 1/K₀ %{y:.3f}<extra></extra>`,
      });
    });

    const layout = {
      paper_bgcolor: '#0e0018',
      plot_bgcolor:  '#1a0030',
      font:  { color: '#94a3b8', size: 11 },
      margin: { l: 60, r: 16, t: 50, b: 55 },
      height: 420,
      title: {
        text: 'Chimeric Collision Landscape',
        font: { color: '#e2e8f0', size: 13, weight: 700 },
        x: 0.04,
      },
      xaxis: {
        title: { text: 'Precursor m/z', font: { size: 11 } },
        gridcolor: '#3d1060', color: '#a0b4cc', zeroline: false,
      },
      yaxis: {
        title: { text: '1/K₀ (Vs/cm²)', font: { size: 11 } },
        gridcolor: '#3d1060', color: '#a0b4cc', zeroline: false,
      },
      legend: {
        bgcolor: 'rgba(14,0,24,0.75)',
        bordercolor: '#3d1060',
        borderwidth: 1,
        font: { size: 10 },
        x: 1.01, y: 1, xanchor: 'left',
      },
      annotations: [{
        text: 'Gray = singleton · Amber/Orange/Red = 2/3/4+ peptides per spectrum',
        xref: 'paper', yref: 'paper',
        x: 0.04, y: -0.13,
        showarrow: false,
        font: { size: 9.5, color: '#64748b' },
        xanchor: 'left',
      }],
      hoverlabel: { bgcolor: '#1a0030', font: { size: 11 } },
    };

    window.Plotly.react(el, traces, layout, { displayModeBar: false, responsive: true });
    return () => { try { window.Plotly.purge(el); } catch(e) {} };
  }, [colData]);

  // ── Panel 3: TIMS Chimeric Rate stacked horizontal bar ────────────────────
  useEffect(() => {
    const el = timsBarRef.current;
    if (!el || !window.Plotly) return;
    if (!colData?.mobility_profile || colData.mobility_profile.length === 0) {
      window.Plotly.purge(el); return;
    }

    const prof = colData.mobility_profile;
    const bins = prof.map(p => p.bin_center.toFixed(3));
    const nSingleton = prof.map(p => p.n_total - p.n_chimeric);
    const nChimeric  = prof.map(p => p.n_chimeric);

    const customHover = prof.map(p =>
      `1/K₀: ${p.bin_center.toFixed(3)}<br>Chimeric: ${(p.chimeric_rate * 100).toFixed(1)}% (${p.n_chimeric} PSMs)`
    );

    const traces = [
      {
        type: 'bar',
        orientation: 'h',
        name: 'Singleton',
        x: nSingleton,
        y: bins,
        marker: { color: '#64748b' },
        hovertemplate: '1/K₀: %{y}<br>Singleton: %{x} PSMs<extra></extra>',
      },
      {
        type: 'bar',
        orientation: 'h',
        name: 'Chimeric',
        x: nChimeric,
        y: bins,
        marker: { color: '#f472b6' },
        hovertemplate: '%{customdata}<extra></extra>',
        customdata: customHover,
      },
    ];

    const layout = {
      barmode: 'stack',
      paper_bgcolor: '#0e0018',
      plot_bgcolor:  '#1a0030',
      font:  { color: '#94a3b8', size: 11 },
      margin: { l: 58, r: 16, t: 50, b: 45 },
      height: 420,
      title: {
        text: 'TIMS Chimeric Rate by Mobility',
        font: { color: '#e2e8f0', size: 13, weight: 700 },
        x: 0.04,
      },
      xaxis: {
        title: { text: 'PSM count', font: { size: 11 } },
        gridcolor: '#3d1060', color: '#a0b4cc', zeroline: false,
      },
      yaxis: {
        title: { text: '1/K₀ bin', font: { size: 11 } },
        gridcolor: '#3d1060', color: '#a0b4cc', zeroline: false,
        automargin: true,
      },
      legend: {
        bgcolor: 'rgba(14,0,24,0.75)',
        bordercolor: '#3d1060',
        borderwidth: 1,
        font: { size: 10 },
      },
      hoverlabel: { bgcolor: '#1a0030', font: { size: 11 } },
    };

    window.Plotly.react(el, traces, layout, { displayModeBar: false, responsive: true });
    return () => { try { window.Plotly.purge(el); } catch(e) {} };
  }, [colData]);

  // ── Panel 4: Peptide Length Distribution ──────────────────────────────────
  useEffect(() => {
    const el = lengthBarRef.current;
    if (!el || !window.Plotly) return;
    const ld = statsData?.peptide_stats?.length_dist;
    if (!ld || Object.keys(ld).length === 0) { window.Plotly.purge(el); return; }

    const lengths = Object.keys(ld).map(Number).sort((a, b) => a - b);
    const counts  = lengths.map(l => ld[l]);

    // Gradient: blue for MHC-I range (8-12), violet for MHC-II range (13-25)
    const colors = lengths.map(l => {
      if (l <= 12) return '#60a5fa';
      if (l <= 25) {
        const t = (l - 13) / 12; // 0→1
        // interpolate #60a5fa → #d946ef
        const r = Math.round(0x60 + t * (0xd9 - 0x60));
        const g = Math.round(0xa5 + t * (0x46 - 0xa5));
        const b = Math.round(0xfa + t * (0xef - 0xfa));
        return `rgb(${r},${g},${b})`;
      }
      return '#d946ef';
    });

    const traces = [{
      type: 'bar',
      x: lengths,
      y: counts,
      marker: { color: colors, line: { width: 0 } },
      hovertemplate: 'Length %{x} aa<br>%{y} peptides<extra></extra>',
    }];

    const layout = {
      paper_bgcolor: '#0e0018',
      plot_bgcolor:  '#1a0030',
      font:  { color: '#94a3b8', size: 11 },
      margin: { l: 55, r: 16, t: 50, b: 45 },
      height: 200,
      title: {
        text: 'Chimeric Peptide Length Distribution',
        font: { color: '#e2e8f0', size: 13, weight: 700 },
        x: 0.04,
      },
      xaxis: {
        title: { text: 'Peptide length (aa)', font: { size: 11 } },
        gridcolor: '#3d1060', color: '#a0b4cc', dtick: 1,
      },
      yaxis: {
        title: { text: 'Count', font: { size: 11 } },
        gridcolor: '#3d1060', color: '#a0b4cc', zeroline: false,
      },
      shapes: [
        // MHC-I band 8–12
        {
          type: 'rect', xref: 'x', yref: 'paper',
          x0: 7.5, x1: 12.5, y0: 0, y1: 1,
          fillcolor: 'rgba(96,165,250,0.08)',
          line: { color: 'rgba(96,165,250,0.25)', width: 1 },
        },
        // MHC-II band 13–25
        {
          type: 'rect', xref: 'x', yref: 'paper',
          x0: 12.5, x1: 25.5, y0: 0, y1: 1,
          fillcolor: 'rgba(217,70,239,0.06)',
          line: { color: 'rgba(217,70,239,0.2)', width: 1 },
        },
      ],
      annotations: [
        {
          text: 'MHC-I',
          xref: 'x', yref: 'paper',
          x: 10, y: 0.97,
          showarrow: false,
          font: { size: 9, color: '#60a5fa' },
          xanchor: 'center',
        },
        {
          text: 'MHC-II',
          xref: 'x', yref: 'paper',
          x: 18.5, y: 0.97,
          showarrow: false,
          font: { size: 9, color: '#d946ef' },
          xanchor: 'center',
        },
      ],
      hoverlabel: { bgcolor: '#1a0030', font: { size: 11 } },
    };

    window.Plotly.react(el, traces, layout, { displayModeBar: false, responsive: true });
    return () => { try { window.Plotly.purge(el); } catch(e) {} };
  }, [statsData]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const stats = colData?.stats ?? null;
  const hasData = colData?.available === true;
  const hasLengthDist = statsData?.peptide_stats?.length_dist
    && Object.keys(statsData.peptide_stats.length_dist).length > 0;

  const selectedRun = timsRuns.find(r => String(r.id) === String(selRun)) ?? null;

  // ── Shared style tokens ────────────────────────────────────────────────────
  const surface = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '0.6rem',
    padding: '1rem',
  };

  const cardRow = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    marginBottom: '1rem',
  };

  // ── Stat card ─────────────────────────────────────────────────────────────
  function StatCard({ label, value, sub, accent }) {
    return (
      <div style={{
        flex: '1 1 160px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${accent}`,
        borderRadius: '0.5rem',
        padding: '0.75rem 1rem',
        minWidth: '140px',
      }}>
        <div style={{ fontSize: '1.55rem', fontWeight: 800, color: '#f1f5f9', lineHeight: 1.1 }}>
          {value ?? <span style={{ color: '#475569' }}>—</span>}
        </div>
        {sub && (
          <div style={{ fontSize: '0.78rem', color: accent, fontWeight: 600, marginTop: '0.1rem' }}>
            {sub}
          </div>
        )}
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem', lineHeight: 1.3 }}>
          {label}
        </div>
      </div>
    );
  }

  // ── Run selector badge ─────────────────────────────────────────────────────
  function ChimerysBadge({ run }) {
    if (!run) return null;
    const ok = chimerysAvailable(run);
    return (
      <span style={{
        display: 'inline-block',
        padding: '0.15rem 0.55rem',
        borderRadius: '0.9rem',
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)',
        border: `1px solid ${ok ? 'rgba(34,197,94,0.4)' : 'rgba(100,116,139,0.3)'}`,
        color: ok ? '#22c55e' : '#64748b',
        marginLeft: '0.5rem',
        verticalAlign: 'middle',
      }}>
        {ok ? '✓ Chimerys' : 'no Chimerys data'}
      </span>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0.75rem' }}>

      {/* ── Header ── */}
      <div style={{ ...surface, marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#f1f5f9', marginBottom: '0.2rem' }}>
              Chimerys Analysis
            </div>
            <div style={{ color: '#64748b', fontSize: '0.78rem', lineHeight: 1.5 }}>
              Deep-learning deconvolution of chimeric MS2 spectra · identifies multiple peptides
              per co-fragmented timsTOF precursor · quantifies TIMS separation efficiency
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto', minWidth: '320px' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Run (timsTOF .d)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <select
                value={selRun}
                onChange={e => setSelRun(e.target.value)}
                style={{
                  flex: 1,
                  background: 'var(--bg)',
                  color: '#e2e8f0',
                  border: '1px solid var(--border)',
                  borderRadius: '0.35rem',
                  padding: '0.3rem 0.6rem',
                  fontSize: '0.8rem',
                }}
              >
                <option value="">— select a run —</option>
                {timsRuns.map(r => (
                  <option key={r.id} value={r.id}>{r.run_name}</option>
                ))}
              </select>
              {selectedRun && <ChimerysBadge run={selectedRun} />}
            </div>
            {timsRuns.length === 0 && allRuns.length > 0 && (
              <div style={{ fontSize: '0.72rem', color: '#f59e0b' }}>
                No .d runs found — Chimerys requires timsTOF raw folders
              </div>
            )}
            {allRuns.length === 0 && (
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>No runs in database</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div style={{ ...surface, textAlign: 'center', padding: '3rem', marginBottom: '1rem' }}>
          <div style={{ fontSize: '1.5rem', color: '#22d3ee', marginBottom: '0.5rem', opacity: 0.8 }}>⟳</div>
          <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Loading Chimerys analysis…</div>
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div style={{ ...surface, marginBottom: '1rem', borderColor: 'rgba(239,68,68,0.4)' }}>
          <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: '0.3rem' }}>Error loading data</div>
          <div style={{ color: '#94a3b8', fontSize: '0.82rem' }}>{error}</div>
        </div>
      )}

      {/* ── No Chimerys data available ── */}
      {!loading && !error && colData && !hasData && selRun && (
        <div style={{
          ...surface,
          marginBottom: '1rem',
          borderColor: 'rgba(218,170,0,0.3)',
          background: 'rgba(218,170,0,0.04)',
        }}>
          <div style={{ fontWeight: 700, color: '#DAAA00', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
            No Chimerys results found for this run
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.83rem', lineHeight: 1.65, marginBottom: '0.75rem' }}>
            Chimerys results must be downloaded and linked via <strong style={{ color: '#e2e8f0' }}>Config → Chimerys Connect</strong>.
            Once you upload a Chimerys result parquet for this run, the analysis will appear here automatically.
          </div>
          {navigateTo && (
            <button
              onClick={() => navigateTo('config')}
              style={{
                padding: '0.4rem 1rem',
                background: 'rgba(218,170,0,0.12)',
                border: '1px solid rgba(218,170,0,0.45)',
                borderRadius: '0.4rem',
                color: '#DAAA00',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              Go to Config
            </button>
          )}
        </div>
      )}

      {/* ── Main content (only when data available) ── */}
      {!loading && !error && hasData && (

        <React.Fragment>

          {/* ── Panel 1: Stats Summary ── */}
          <div style={cardRow}>
            <StatCard
              label="PSMs Identified"
              value={stats?.n_psms?.toLocaleString()}
              accent="var(--accent)"
            />
            <StatCard
              label="Chimeric PSMs"
              value={stats?.n_chimeric_psms?.toLocaleString()}
              sub={stats?.chimeric_rate != null
                ? `${(stats.chimeric_rate * 100).toFixed(1)}% of PSMs`
                : null}
              accent="var(--violet)"
            />
            <StatCard
              label="Rescued Peptides"
              value={stats?.n_rescued_peptides?.toLocaleString()}
              sub="additional IDs from chimeric spectra"
              accent="var(--accent)"
            />
            <StatCard
              label="Max Co-ID Multiplicity"
              value={stats?.max_multiplicity != null ? `×${stats.max_multiplicity}` : null}
              sub="peptides from one spectrum (max)"
              accent="var(--violet)"
            />
            <StatCard
              label="Chimeric Scan Rate"
              value={stats?.chimeric_scan_rate != null
                ? `${(stats.chimeric_scan_rate * 100).toFixed(1)}%`
                : null}
              sub={stats?.n_chimeric_scans != null
                ? `${stats.n_chimeric_scans?.toLocaleString()} chimeric scans`
                : null}
              accent="var(--accent)"
            />
          </div>

          {/* ── Panels 2 + 3: Landscape + TIMS bar — side by side ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '60fr 40fr', gap: '0.75rem', marginBottom: '0.75rem' }}>

            {/* Panel 2: Chimeric Collision Landscape */}
            <div style={surface}>
              <div ref={landscapeRef} style={{ height: '420px' }} />
            </div>

            {/* Panel 3: TIMS Separation Efficiency */}
            <div style={surface}>
              <div ref={timsBarRef} style={{ height: '420px' }} />
            </div>
          </div>

          {/* ── Panel 4: Peptide Length Distribution ── */}
          {hasLengthDist && (
            <div style={{ ...surface, marginBottom: '0.75rem' }}>
              <div ref={lengthBarRef} style={{ height: '200px' }} />
            </div>
          )}

          {/* ── Top sequences (if available) ── */}
          {statsData?.peptide_stats?.top_sequences?.length > 0 && (
            <div style={{ ...surface, marginBottom: '0.75rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#e2e8f0', marginBottom: '0.65rem' }}>
                Top Chimeric Sequences
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Sequence', 'PSMs', 'Length'].map(h => (
                        <th key={h} style={{
                          padding: '0.3rem 0.6rem',
                          textAlign: 'left',
                          color: '#64748b',
                          fontWeight: 600,
                          fontSize: '0.72rem',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {statsData.peptide_stats.top_sequences.slice(0, 20).map((seq, i) => (
                      <tr key={i} style={{
                        borderBottom: '1px solid rgba(61,16,96,0.4)',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}>
                        <td style={{ padding: '0.25rem 0.6rem', fontFamily: 'monospace', color: '#e2e8f0', letterSpacing: '0.05em' }}>
                          {seq.sequence}
                        </td>
                        <td style={{ padding: '0.25rem 0.6rem', color: 'var(--accent)', fontWeight: 700 }}>
                          {seq.count?.toLocaleString()}
                        </td>
                        <td style={{ padding: '0.25rem 0.6rem', color: seq.length <= 12 ? '#60a5fa' : '#a78bfa' }}>
                          {seq.length} aa
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Charge distribution ── */}
          {statsData?.charge_dist && Object.keys(statsData.charge_dist).length > 0 && (
            <div style={{ ...surface, marginBottom: '0.75rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#e2e8f0', marginBottom: '0.65rem' }}>
                Charge State Distribution
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                {Object.entries(statsData.charge_dist)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([z, n]) => {
                    const chargeColors = {
                      1: '#DAAA00', 2: '#22d3ee', 3: '#22c55e',
                      4: '#f97316', 5: '#a855f7', 6: '#ef4444',
                    };
                    const col = chargeColors[z] ?? '#94a3b8';
                    const total = Object.values(statsData.charge_dist).reduce((s, v) => s + v, 0);
                    const pct = total > 0 ? (n / total * 100).toFixed(1) : '?';
                    return (
                      <div key={z} style={{
                        padding: '0.45rem 0.85rem',
                        borderRadius: '0.4rem',
                        background: `${col}18`,
                        border: `1px solid ${col}44`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        minWidth: '75px',
                      }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: 800, color: col }}>
                          +{z}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#e2e8f0', fontWeight: 700 }}>
                          {pct}%
                        </span>
                        <span style={{ fontSize: '0.67rem', color: '#64748b' }}>
                          {n?.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

        </React.Fragment>
      )}

      {/* ── Empty state (no run selected) ── */}
      {!selRun && !loading && (
        <div style={{ ...surface, textAlign: 'center', padding: '4rem 2rem' }}>
          <div style={{ fontSize: '2.8rem', marginBottom: '0.75rem', opacity: 0.25 }}>◈</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.4rem' }}>
            Select a timsTOF run to explore Chimerys results
          </div>
          <div style={{ fontSize: '0.83rem', color: '#64748b', maxWidth: '500px', margin: '0 auto', lineHeight: 1.65 }}>
            Chimerys deconvolutes chimeric MS2 spectra — identifying multiple peptides per
            co-fragmented precursor. On timsTOF, this reveals where in 4D space
            (RT × 1/K₀ × m/z) the TIMS dimension fails to separate co-eluting ions.
          </div>
        </div>
      )}

    </div>
  );
}
