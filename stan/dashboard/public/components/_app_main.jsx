    function App() {
      const [tab, setTab] = useState('live');
      const { data: ver } = useFetch('/api/version');
      // Pinned run IDs — persists across tab switches, shared between RunHistory/Trends/Health
      const [pinnedRunIds, setPinnedRunIds] = useState(new Set());

      const pinCount = pinnedRunIds.size;

      // Tab label badges when pins are active
      const trendLabel  = pinCount > 0 ? `Trends [${pinCount}]` : 'Trends';
      const healthLabel = pinCount > 0 ? `Health [${pinCount}]` : 'Health';

      // Pending spectrum jump — set by MIA tab's ★ click, consumed by SpectraTab
      const [pendingSpectrum, setPendingSpectrum] = useState(null);

      const handleSpectrumJump = useCallback((spec) => {
        setPendingSpectrum(spec);
        setTab('spectra');
      }, []);

      // Unsearched run count badge for Search Assistant
      const { data: unsearchedRuns } = useFetch('/api/search/unsearched');
      const unsearchedCount = Array.isArray(unsearchedRuns) ? unsearchedRuns.length : 0;
      const searchLabel = unsearchedCount > 0
        ? React.createElement('span', null,
            'Search ',
            React.createElement('span', {
              style: {
                display: 'inline-block',
                background: '#DAAA00',
                color: '#0e0018',
                borderRadius: '0.9rem',
                padding: '0 0.45rem',
                fontSize: '0.68rem',
                fontWeight: 700,
                lineHeight: '1.4',
                verticalAlign: 'middle',
                marginLeft: '0.2rem',
              }
            }, unsearchedCount)
          )
        : 'Search';

      return (
        <div className="container">
          <header>
            <h1><span>ZIGGY</span> &mdash; The Proteomics Rockstar</h1>
            <span className="version">{ver ? `v${ver.version}` : ''}</span>
          </header>
          <div className="tabs">
            {/* Row 1 — Core QC & monitoring */}
            <div className="tab-group">
              <div className="tab-group-label">QC</div>
              <div className="tab-row">
                {[
                  ['live',      "Today's Runs"],
                  ['history',   'Run History'],
                  ['trends',    trendLabel],
                  ['health',    healthLabel],
                ].map(([k, label]) =>
                  <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
                )}
              </div>
            </div>

            {/* Row 2 — timsTOF 4D analysis tools */}
            <div className="tab-group">
              <div className="tab-group-label">4D</div>
              <div className="tab-row">
                {[
                  ['mobility',   'Ion Mobility'],
                  ['landscape',  'Landscape'],
                  ['advantage',  '4D Advantage'],
                  ['ccs',        'CCS'],
                  ['lc',         'LC Traces'],
                  ['spectra',    'Spectra'],
                  ['enzyme',     'Enzyme'],
                ].map(([k, label]) =>
                  <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
                )}
              </div>
            </div>

            {/* Row 3 — Advanced research & search workflows */}
            <div className="tab-group">
              <div className="tab-group-label">Research</div>
              <div className="tab-row">
                {[
                  ['immuno',    'Immunopeptidomics'],
                  ['discovery', 'HLA Discovery'],
                  ['denovo',    'De Novo'],
                  ['searches',  'Searches'],
                  ['search',    searchLabel],
                  ['sneaky',    'Sneaky Peaky'],
                  ['mia',       'MIA'],
                  ['singlecell','Single Cell'],
                ].map(([k, label]) =>
                  <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
                )}
              </div>
            </div>

            {/* Row 4 — System / community (compact, muted) */}
            <div className="tab-group">
              <div className="tab-group-label">System</div>
              <div className="tab-row">
                {[
                  ['config',     'Config'],
                  ['community',  'Community'],
                  ['about',      'About'],
                ].map(([k, label]) =>
                  <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
                )}
              </div>
            </div>
          </div>
          <ErrorBoundary key={tab}>
            {tab === 'live' && <LiveRuns />}
            {tab === 'history' && <RunHistory pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} navigateTo={setTab} />}
            {tab === 'trends' && <TrendCharts pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} />}
            {tab === 'health' && <HealthTab pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} />}
            {tab === 'mobility' && <MobilityTab />}
            {tab === 'landscape' && <LandscapeViewerTab />}
            {tab === 'advantage' && <AdvantageTab />}
            {tab === 'ccs' && <CCSTab />}
            {tab === 'lc' && <LcTracesTab />}
            {tab === 'spectra' && <SpectraTab pendingSpectrum={pendingSpectrum} onPendingConsumed={() => setPendingSpectrum(null)} />}
            {tab === 'enzyme' && <EnzymeTab />}
            {tab === 'immuno'     && <ImmunopeptidomicsTab />}
            {tab === 'discovery' && <ImmunoDiscoveryTab />}
            {tab === 'denovo' && <DeNovoTab />}
            {tab === 'searches' && <SearchesTab />}
            {tab === 'search'   && <SearchAssistantTab />}
            {tab === 'sneaky' && <SneakyPeakyTab />}
            {tab === 'mia'        && <MiaTab onSpectrumJump={handleSpectrumJump} navigateTo={setTab} />}
            {tab === 'singlecell' && <SingleCellTab />}
            {tab === 'config' && <ConfigEditor />}
            {tab === 'community' && <CommunityTab />}
            {tab === 'about' && <AboutTab />}
          </ErrorBoundary>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  