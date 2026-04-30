    const GLOBAL_FACTS = [
      // Proteomics
      "The word 'protein' comes from Greek proteios — 'of the first rank'. Coined by Berzelius in 1838. He had no idea what was coming.",
      "A single microgram of human proteome contains roughly 100 million tryptic peptides. Your instrument sees thousands per second.",
      "Trypsin cuts at K and R because evolution made it so. Mass spec scientists have been grateful ever since.",
      "The human serum proteome spans 10 orders of magnitude in concentration — from albumin at mg/mL to cytokines at pg/mL. Dynamic range is the real boss.",
      "Every peptide you fragment in the mass spec is destroyed in the process. You read it by annihilating it. That's not a metaphor.",
      "'Proteomics' was coined as a word in 1994 by Marc Wilkins — the same year Netscape launched. Both changed how we navigate complexity.",
      "A typical timsTOF run generates 30–80 GB of raw data. In 2000, that was more than most hard drives could hold.",
      "The mass accuracy of a modern Orbitrap is < 1 ppm — equivalent to measuring a football field to within 0.1 mm.",
      "Post-translational modifications multiply the proteome: ~20,000 human genes become an estimated 1 million+ unique proteoforms.",
      "TIMS stands for Trapped Ion Mobility Spectrometry. It traps ions by balancing electric field against gas flow, then releases them by ramping voltage. Physics as a peptide sieve.",
      "Phosphorylation can switch a protein from 'off' to 'on' in milliseconds. Kinases write the message. Phosphatases erase it. The cell reads both.",
      "Ubiquitin is 76 amino acids long and tags proteins for destruction. It is the smallest most powerful sentence the cell knows how to write.",
      // Chemistry
      "Water expands when it freezes — almost every other liquid contracts. That anomaly is why fish survive winter and beer bottles explode in freezers.",
      "The smell of rain — petrichor — comes from geosmin, a molecule made by soil bacteria. You're smelling microbial chemistry at parts-per-trillion concentration.",
      "Diamonds and graphite are both pure carbon. The only difference is how the atoms are arranged. Pressure makes the difference.",
      "Hydrogen is the most abundant element in the universe: ~75% of all normal matter. The rest is mostly helium. Everything else — including you — is a trace contaminant.",
      "The periodic table had deliberate gaps when Mendeleev published it in 1869. He predicted three missing elements. All three were discovered within 17 years.",
      "Aspirin was synthesized in 1897, but willow bark containing its precursor salicin was used medicinally in ancient Egypt. Nature had the answer for millennia.",
      // Weird science
      "If you removed all the empty space from every atom in every human on Earth, the compressed matter would fit in a sugar cube.",
      "There are more atoms in a glass of water than there are glasses of water in all Earth's oceans.",
      "The mantis shrimp has 16 types of photoreceptors. Humans have 3. It can detect polarized light and UV. It has absolutely no use for our rainbow.",
      "A teaspoon of neutron star material weighs about 10 million tons. Neutron stars are so dense that a spoonful outweighs a mountain.",
      "Quantum tunneling lets particles pass through barriers that classical physics says are impossible to cross. It's why the sun fuses hydrogen at all.",
      "Tardigrades (water bears) can survive vacuum, radiation, and temperatures from -272°C to +150°C. They do this by turning into a glass-like state and waiting.",
      "The Voyager 1 spacecraft, launched in 1977, is now over 23 billion km from Earth. It still transmits data on 23 watts — less than a fridge light bulb.",
    ];

    function App() {
      const [tab, setTab] = useState('welcome');
      const { data: ver } = useFetch('/api/version');
      // Pinned run IDs — persists across tab switches, shared between RunHistory/Trends/Health
      const [pinnedRunIds, setPinnedRunIds] = useState(new Set());
      const [factIdx, setFactIdx] = useState(() => Math.floor(Math.random() * GLOBAL_FACTS.length));

      React.useEffect(() => {
        const iv = setInterval(() => setFactIdx(i => (i + 1) % GLOBAL_FACTS.length), 7000);
        return () => clearInterval(iv);
      }, []);

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
          <div style={{display:'flex',alignItems:'center',gap:'0.7rem',padding:'0.45rem 0.9rem',
                       background:'rgba(218,170,0,0.06)',borderBottom:'1px solid rgba(218,170,0,0.18)',
                       minHeight:'2.4rem',cursor:'pointer'}}
               onClick={() => setFactIdx(i => (i + 1) % GLOBAL_FACTS.length)}
               title="Click for next fact">
            <span style={{color:'#DAAA00',fontSize:'0.67rem',fontWeight:800,flexShrink:0,
                          letterSpacing:'0.12em',textTransform:'uppercase'}}>★ FACT</span>
            <span style={{color:'#94a3b8',fontSize:'0.8rem',lineHeight:1.5,fontStyle:'italic'}}>
              {GLOBAL_FACTS[factIdx]}
            </span>
          </div>
          <div className="tabs">
            {/* Row 1 — Core QC & monitoring */}
            <div className="tab-group">
              <div className="tab-group-label">QC</div>
              <div className="tab-row">
                {[
                  ['history',   'Run History'],
                  ['trends',    trendLabel],
                  ['health',    healthLabel],
                  ['mobcal',    '∿ Mob Calibration'],
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

            {/* Row 3a — Biology / omics sample types */}
            <div className="tab-group">
              <div className="tab-group-label">Omics</div>
              <div className="tab-row">
                {[
                  ['immuno',     'Immunopeptidomics'],
                  ['discovery',  'HLA Discovery'],
                  ['histone',    'Histones'],
                  ['phospho',    'Phospho'],
                  ['chemo',      'Chemoproteomics'],
                  ['meta',       'Metaproteomics'],
                  ['singlecell', 'Single Cell'],
                ].map(([k, label]) =>
                  <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
                )}
              </div>
            </div>

            {/* Row 3b — Search & analysis workflows */}
            <div className="tab-group">
              <div className="tab-group-label">Search</div>
              <div className="tab-row">
                {[
                  ['search',  searchLabel],
                  ['searches','Searches'],
                  ['denovo',  'De Novo'],
                  ['mia',     'MIA'],
                  ['sneaky',  'Sneaky Peaky'],
                  ['chimerys', 'Chimerys'],
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
                  ['welcome',    'Welcome'],
                  ['labsetup',   '⊛ Lab Setup'],
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
            {tab === 'history' && <RunHistory pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} navigateTo={setTab} />}
            {tab === 'trends' && <TrendCharts pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} />}
            {tab === 'health' && <HealthTab pinnedRunIds={pinnedRunIds} setPinnedRunIds={setPinnedRunIds} />}
            {tab === 'mobcal'  && <MobilityCalibrationTab />}
            {tab === 'mobility' && <MobilityTab />}
            {tab === 'landscape' && <LandscapeViewerTab />}
            {tab === 'advantage' && <AdvantageTab />}
            {tab === 'ccs' && <CCSTab />}
            {tab === 'lc' && <LcTracesTab />}
            {tab === 'spectra' && <SpectraTab pendingSpectrum={pendingSpectrum} onPendingConsumed={() => setPendingSpectrum(null)} />}
            {tab === 'enzyme' && <EnzymeTab />}
            {tab === 'immuno'     && <ImmunopeptidomicsTab />}
            {tab === 'discovery' && <ImmunoDiscoveryTab />}
            {tab === 'histone'   && <HistoneTab />}
            {tab === 'meta'      && <MetaproteomicsTab />}
            {tab === 'denovo' && <DeNovoTab />}
            {tab === 'searches' && <SearchesTab />}
            {tab === 'search'   && <SearchAssistantTab />}
            {tab === 'sneaky' && <SneakyPeakyTab />}
            {tab === 'chimerys' && <ChimerysTab navigateTo={setTab} />}
            {tab === 'mia'        && <MiaTab onSpectrumJump={handleSpectrumJump} navigateTo={setTab} />}
            {tab === 'singlecell' && <SingleCellTab />}
            {tab === 'chemo'      && <ChemoproteomicsTab />}
            {tab === 'phospho'    && <PhosphoTab />}
            {tab === 'welcome'    && <WelcomeTab navigateTo={setTab} />}
            {tab === 'labsetup'   && <LabSetupTab />}
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
  