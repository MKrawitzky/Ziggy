    function AboutTab() {
      const { data: ver } = useFetch('/api/version');
      const [factIdx, setFactIdx] = React.useState(0);
      const [ziggyClix, setZiggyClix] = React.useState(0);
      const [konamiActive, setKonamiActive] = React.useState(false);
      const konamiSeq = React.useRef([]);
      const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

      const FACTS = [
        "The average tryptic peptide is 8–15 amino acids. Your instrument sees thousands of them per second.",
        "1/K₀, inverse reduced ion mobility, separates things that weigh the same but are shaped differently.",
        "HeLa cells have been dividing in labs since 1951. They will outlast us all.",
        "A timsTOF Pro accumulates ions in ~100ms TIMS steps. That's 10 full 4D scans per second.",
        "Charge state z is the Z in ZIGGY. Every ion carries it. Every ion is it.",
        "The first mass spectrum was recorded in 1912. J.J. Thomson measured neon isotopes.",
        "DIA-NN can identify >10,000 proteins from a single 30-minute gradient. In 2015, that was a year's work.",
        "A CCS value is reproducible across labs, instruments, and time. It is a fingerprint that does not age.",
        "The human proteome has ~20,000 genes. With PTMs and isoforms: probably 1 million+ unique proteoforms.",
        "PASEF stands for Parallel Accumulation Serial Fragmentation. It's why timsTOF sees so much, so fast.",
        "The first peptide sequenced by mass spec was insulin B-chain in 1958. Sixty-six residues. Revolutionary.",
        "Stardust is literally true. The carbon in your peptides was forged in dying stars.",
        "Ion mobility separates in microseconds. Chromatography in minutes. The timsTOF does both simultaneously.",
        "A fragment ion carries the sequence. A charge state carries the story. Together they tell you everything.",
      ];

      React.useEffect(() => {
        console.log('%c\u{1F9AC} ZIGGY \u2014 The Proteomics Rockstar', 'font-size:22px;font-weight:900;color:#a855f7;letter-spacing:0.05em;');
        console.log('%c Hey. You opened dev tools. We respect that energy entirely. \u{1F44B}', 'font-size:13px;color:#60a5fa;');
        console.log('%c The ion endpoint lives at: /api/runs/{id}/mobility-3d', 'font-size:12px;color:#22c55e;font-family:monospace;');
        console.log('%c z = charge state. Z = ZIGGY. Both are real.', 'font-size:12px;color:#DAAA00;font-style:italic;');
        console.log('%c Try the Konami code on this page. \u2191\u2191\u2193\u2193\u2190\u2192\u2190\u2192 B A', 'font-size:11px;color:#f78166;');
        const iv = setInterval(() => setFactIdx(i => (i + 1) % FACTS.length), 5000);
        return () => clearInterval(iv);
      }, []);

      React.useEffect(() => {
        const handler = (e) => {
          konamiSeq.current = [...konamiSeq.current, e.key].slice(-10);
          if (konamiSeq.current.join(',') === KONAMI.join(',')) {
            setKonamiActive(true);
            konamiSeq.current = [];
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, []);

      const handleZiggyClick = () => {
        const n = ziggyClix + 1;
        setZiggyClix(n);
        if (n === 5) alert('\u26A1 Five clicks. The Starman approves.\n\n\u201CZiggy played guitar, jamming good with Weird and Gilly\nAnd the spiders from Mars\u2026\u201D\n\nYou played peptides. Keep going.');
        if (n === 10) alert('\u{1F31F} Ten clicks. You found the ion mobility easter egg.\n\nm/z is where you are.\n1/K\u2080 is who you are.\nRT is when you are.\nIntensity is how much you care.');
        if (n === 42) alert('\u{1F52C} 42 clicks.\n\nThe answer to life, the universe, and proteomics\nis still: run more replicates.');
      };

      return (
        <div>
          {/* Konami overlay */}
          {konamiActive && (
            <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.93)',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'1.5rem'}}
                 onClick={() => setKonamiActive(false)}>
              <div style={{fontSize:'2.8rem',letterSpacing:'0.12em',fontWeight:900,background:'linear-gradient(135deg,#DAAA00,#f78166,#a855f7,#60a5fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',textAlign:'center'}}>
                STARMAN MODE
              </div>
              <div style={{color:'#e2e8f0',fontSize:'1.05rem',textAlign:'center',maxWidth:'500px',lineHeight:1.9,fontStyle:'italic'}}>
                "There's a starman waiting in the sky<br/>
                He'd like to come and meet us<br/>
                But he thinks he'd blow our minds"
              </div>
              <div style={{color:'#a855f7',fontSize:'0.88rem'}}>David Bowie, 1972</div>
              <div style={{color:'#94a3b8',fontSize:'0.85rem',marginTop:'0.5rem',maxWidth:'440px',textAlign:'center',lineHeight:1.75}}>
                You found the Konami code. In proteomics that's the equivalent of finding a +6 charge state
                on a 40 kDa intact protein, theoretically possible, breathtaking in practice.
              </div>
              <div style={{color:'#60a5fa',fontSize:'0.8rem',marginTop:'0.25rem'}}>click anywhere to return to your ions</div>
            </div>
          )}

          {/* Project info */}
          <div className="card" style={{marginBottom:'1rem', background:'linear-gradient(135deg, rgba(2,40,81,0.95) 0%, rgba(31,6,107,0.4) 100%)', border:'1px solid #3b1f8f55'}}>
            <div style={{display:'flex', alignItems:'baseline', gap:'0.75rem', marginBottom:'0.5rem'}}>
              <h2 onClick={handleZiggyClick} title="Try clicking this a few times." style={{fontSize:'1.8rem',fontWeight:900,letterSpacing:'0.05em',background:'linear-gradient(135deg, #DAAA00, #f78166, #a855f7)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',cursor:'pointer',userSelect:'none'}}>ZIGGY</h2>
              <span style={{color:'var(--muted)', fontSize:'0.85rem'}}>The Proteomics Rockstar</span>
              {ver && <span style={{color:'var(--muted)', fontSize:'0.8rem', marginLeft:'auto'}}>v{ver.version}</span>}
            </div>
            <p style={{marginBottom:'0.75rem', lineHeight:1.7}}>
              <strong style={{color:'var(--accent)'}}>ZIGGY</strong> is Michael Krawitzky's 4D ion mobility visualization and analysis platform,
              built on the <strong>STAN</strong> QC engine but reaching far beyond pass/fail metrics
              into novel territory: rotatable ion landscapes, differential ion cloud comparison,
              breathing proteome animation, CCS corridor analysis, and interactive educational tools
              that make ion mobility understood by everyone.
            </p>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', lineHeight:1.6}}>
              Named after Ziggy Stardust. Because proteomics should be as exciting as a Bowie album.
              The <em>Z</em> is not a coincidence: <em>z</em> is charge state. Every ion has it.
            </p>
          </div>

          {/* Rotating facts ticker */}
          <div className="card" style={{marginBottom:'1rem',padding:'0.65rem 1rem',background:'rgba(96,165,250,0.06)',border:'1px solid rgba(96,165,250,0.2)',display:'flex',alignItems:'center',gap:'0.75rem',minHeight:'3rem'}}>
            <span style={{color:'#60a5fa',fontSize:'0.72rem',fontWeight:700,flexShrink:0,letterSpacing:'0.1em'}}>DID YOU KNOW</span>
            <span style={{color:'var(--muted)',fontSize:'0.85rem',lineHeight:1.5,fontStyle:'italic'}}>{FACTS[factIdx]}</span>
          </div>

          {/* Manifesto */}
          <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(160deg,rgba(2,40,81,0.7) 0%,rgba(31,6,107,0.2) 60%,rgba(15,23,42,0.9) 100%)',border:'1px solid rgba(168,85,247,0.25)'}}>
            <h3 style={{marginBottom:'0.85rem',background:'linear-gradient(90deg,#a855f7,#60a5fa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>A Letter to the Unsung</h3>
            <div style={{fontSize:'0.9rem',lineHeight:2.05,color:'#cbd5e1'}}>
              <p style={{marginBottom:'1.1rem'}}>
                Some of us didn't choose science.<br/>
                Science chose us, in the quiet of a dark room, watching a spectrum unfold,
                understanding for one electric second that we were measuring the weight of life itself.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                We showed up early and stayed late, not for the salary line, not for the tenure clock,
                but because the gradient was still running and the data didn't care what time it was.
                We named our columns with love. We argued about FDR cutoffs at midnight.
                We celebrated a 4% improvement in precursor IDs like it was a moon landing.
                Because it was.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                This software is for the people who shared their code without being asked.
                Who wrote the README at 11pm after a twelve-hour instrument day.
                Who answered the forum post from a grad student in a country they've never visited.
                Who published the tool, the library, the algorithm, and asked for nothing back
                but a citation they'll never see in their inbox.
              </p>
              <p style={{marginBottom:'1.1rem'}}>
                Science is not a job.<br/>
                It is a calling that doesn't pay enough, doesn't sleep enough, and doesn't stop.<br/>
                It is a love language spoken in peptide sequences and charge states and fragmentation patterns
                that only a few hundred humans on earth can read fluently.
              </p>
              <p style={{marginBottom:'0'}}>
                If you are one of those humans:<br/>
                <strong style={{color:'#a855f7'}}>you are not alone. you are seen. this software is yours.</strong>
              </p>
            </div>
          </div>

          {/* Feature highlights */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Feature Highlights</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginTop:'0.5rem'}}>
              {[
                {
                  icon:'📊', title:'QC Dashboard',
                  items:['Precursor, peptide & protein counts @ 1% FDR','Pass / Warn / Fail gating with HOLD flag',
                         'Longitudinal trend charts','Column lifetime & maintenance log'],
                },
                {
                  icon:'🔵', title:'Ion Mobility (timsTOF)',
                  items:['4D feature map: m/z × 1/K₀ × RT × intensity','PEAKS-style waterfall (m/z × 1/K₀ × intensity)',
                         'RT × 1/K₀ heatmap with axis ticks','Charge-state filter & m/z / RT sliders',
                         'Immunopeptidomics & peptidomics z=+1 support'],
                },
                {
                  icon:'🔬', title:'Spectrum Viewer',
                  items:['Theoretical b/y ion series from DIA-NN Modified.Sequence','UniMod annotation (Oxidation, Phospho, CAM, …)',
                         'Head-to-head mirror comparison across ≤ 3 runs','Peptide search within any DIA-NN report'],
                },
                {
                  icon:'🧬', title:'Enzyme & PTM Tab',
                  items:['Missed cleavage distribution (0 / 1 / 2 / 3+)','Modification frequency table per run',
                         'Peptide & unique precursor counts','Pulls live from DIA-NN report.parquet'],
                },
                {
                  icon:'🤖', title:'Automated Search',
                  items:['DIA-NN for DIA (timsTOF diaPASEF + Orbitrap)','Sage for DDA (timsTOF ddaPASEF + Orbitrap)',
                         'Auto mode-detection from raw metadata','SLURM submission on Hive HPC'],
                },
                {
                  icon:'🌐', title:'Community Benchmark',
                  items:['HeLa community leaderboard (Track A DDA + Track B DIA)','Radar fingerprint when both tracks submitted',
                         'No HF token required, relay handles auth','CC BY 4.0 community dataset'],
                },
                {
                  icon:'🔮', title:'Single Cell Proteomics',
                  items:['K562 dilution series: 8pg → 40pg → single-cell → 25ng','Michaelis-Menten coverage model → projects 1-cell depth',
                         'Real 4D ion cloud from any K562 run (live API)','Charge state evolution vs input amount',
                         'K562 surfaceome atlas in m/z × 1/K₀ space'],
                },
                {
                  icon:'⚡', title:'Sneaky Peaky',
                  items:['4D scatter3d: m/z × 1/K₀ × RT differential ion cloud','Joy Division K₀ ridgeline (Unknown Pleasures style)',
                         'CCS conformational density map with charge corridors','MA plot, shift map, dynamic range + charge bars',
                         'm/z target finder across run pairs'],
                },
              ].map(({icon, title, items}) => (
                <div key={title} style={{padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)'}}>
                  <div style={{fontWeight:700, fontSize:'0.95rem', marginBottom:'0.4rem'}}>{icon} {title}</div>
                  <ul style={{color:'var(--muted)', fontSize:'0.8rem', paddingLeft:'1.1rem', lineHeight:1.75, margin:0}}>
                    {items.map(it => <li key={it}>{it}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* What's New */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>What's New · ZIGGY · April 2026</h3>
            <div style={{display:'flex', flexDirection:'column', gap:'0.5rem', marginTop:'0.4rem'}}>
              {[
                {tag:'NEW', color:'var(--pass)', text:'🔮 Single Cell Proteomics tab: real K562 dilution series (8pg–125ng), Michaelis-Menten coverage model, live 4D ion cloud, charge-state evolution, surfaceome atlas in ion mobility space'},
                {tag:'NEW', color:'var(--pass)', text:'⚡ Sneaky Peaky reborn: 4D scatter3d ion cloud, Joy Division K₀ ridgeline, CCS conformational density map, MA plot, shift map, dynamic range — full David Bowie flair'},
                {tag:'NEW', color:'var(--pass)', text:'🏗 Self-contained build: node_modules now in E:/ziggy — edit components/, run node stan/dashboard/build.js, done. No more cross-folder sync.'},
                {tag:'ZIGGY', color:'#a855f7', text:'🗻 Landscape Viewer: compare 2–3 runs as Melanie-style rotatable 3D surfaces (m/z × 1/K₀ × intensity); linked cameras, differential A−B surface with Pearson similarity, peak inspector'},
                {tag:'ZIGGY', color:'#a855f7', text:'⬡ 4D Advantage tab: 5 live-data visualizations, Mobility Corridor (per-charge R²), Chimera Probability Map, Breathing Proteome animation, Orthogonality Index, 4D Run Fingerprint'},
                {tag:'ZIGGY', color:'#a855f7', text:'+1 & unassigned ions everywhere: charge toggles in CCS tab now include z=0 (?) and z=+1; immunopeptidomics dropdown extended to z=0–6'},
                {tag:'UPD', color:'var(--accent)', text:'Super Bowie theme: --bg #0e0018, gold accent #DAAA00, Aladdin Sane lightning bolt favicon'},
                {tag:'UPD', color:'var(--accent)', text:'Ion Mobility 3D filter: charge toggles, m/z, RT & 1/K₀ range; scroll-zoom + box-select on ion cloud charts'},
              ].map(({tag, color, text}) => (
                <div key={text} style={{display:'flex', gap:'0.6rem', alignItems:'flex-start', fontSize:'0.85rem'}}>
                  <span style={{flexShrink:0, padding:'0.15rem 0.45rem', borderRadius:'0.3rem',
                                background: tag === 'ZIGGY' ? 'rgba(168,85,247,0.15)' : tag === 'NEW' ? 'rgba(34,197,94,0.12)' : 'rgba(96,165,250,0.12)',
                                color, fontWeight:700, fontSize:'0.75rem', marginTop:'0.05rem'}}>{tag}</span>
                  <span style={{color:'var(--muted)'}}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Authors */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Authors</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginTop:'0.25rem'}}>
              <div style={{padding:'0.75rem', background:'linear-gradient(135deg,rgba(2,40,81,0.8),rgba(31,6,107,0.3))', borderRadius:'0.5rem', border:'1px solid #a855f755'}}>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem'}}>
                  <span style={{fontSize:'1.4rem'}}>⚡</span>
                  <div style={{fontWeight:800, fontSize:'1rem', background:'linear-gradient(135deg, #DAAA00, #a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}
                       title="He measures things smaller than thought. The Peptide Wizard.">Michael Krawitzky</div>
                </div>
                <div style={{color:'var(--muted)', fontSize:'0.82rem', marginBottom:'0.2rem'}}>The Peptide Wizard · Bruker Daltonics</div>
                <div style={{color:'#a855f7', fontSize:'0.8rem', marginBottom:'0.5rem', fontStyle:'italic'}}>Creator of ZIGGY</div>
                <a href="https://github.com/MKrawitzky/ziggy" target="_blank"
                   style={{color:'var(--accent)', fontSize:'0.82rem', textDecoration:'none', display:'block', marginBottom:'0.2rem'}}>
                  github.com/MKrawitzky/ziggy →
                </a>
                <a href="https://github.com/MKrawitzky/Nats" target="_blank"
                   style={{color:'var(--muted)', fontSize:'0.78rem', textDecoration:'none'}}>
                  github.com/MKrawitzky/Nats →
                </a>
              </div>
              <div style={{padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)'}}>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem'}}>
                  <span style={{fontSize:'1.2rem'}}>🔬</span>
                  <div style={{fontWeight:700, fontSize:'1rem'}}
                       title="Stayed up until 3am once fixing a DIA-NN flag. It was a tab character. We've all been there.">Brett Stanley Phinney</div>
                </div>
                <div style={{color:'var(--muted)', fontSize:'0.82rem', marginBottom:'0.2rem'}}>UC Davis Proteomics Core</div>
                <div style={{color:'var(--accent)', fontSize:'0.8rem', marginBottom:'0.5rem', fontStyle:'italic'}}>Creator of STAN (QC engine)</div>
                <a href="https://github.com/bsphinney/stan" target="_blank"
                   style={{color:'var(--muted)', fontSize:'0.82rem', textDecoration:'none'}}>
                  github.com/bsphinney/stan →
                </a>
                <div style={{color:'var(--muted)', fontSize:'0.78rem', marginTop:'0.2rem'}}>bsphinney@ucdavis.edu</div>
              </div>
            </div>
            <div style={{marginTop:'0.75rem',padding:'0.65rem 0.85rem',background:'rgba(168,85,247,0.07)',borderRadius:'0.4rem',border:'1px solid rgba(168,85,247,0.15)',fontSize:'0.82rem',color:'var(--muted)',lineHeight:1.75}}>
              <strong style={{color:'#a855f7'}}>Standing on shoulders:</strong>{' '}
              ZIGGY exists because of the open-source proteomics community, the people who built
              DIA-NN, Sage, timsrust, timsplot, Carafe, MsBackendTimsTof, and thousands of R packages
              and Python wheels without ever asking for anything back but a citation.
              They are the unsung. They are the whole song.
            </div>
          </div>

          {/* License */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>License</h3>
            <div style={{marginBottom:'0.75rem'}}>
              <span style={{fontWeight:600}}>ZIGGY / STAN Academic License</span>
              <span style={{color:'var(--muted)', marginLeft:'0.75rem', fontSize:'0.85rem'}}>
                Copyright &copy; 2024&#8211;2026 Brett Stanley Phinney &amp; The Peptide Wizard
              </span>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', fontSize:'0.85rem'}}>
              <div style={{padding:'0.6rem', background:'rgba(34,197,94,0.08)', borderRadius:'0.4rem', border:'1px solid rgba(34,197,94,0.2)'}}>
                <div style={{color:'var(--pass)', fontWeight:600, marginBottom:'0.3rem'}}>Free to use</div>
                <ul style={{color:'var(--muted)', paddingLeft:'1.1rem', lineHeight:1.7}}>
                  <li>Academic research</li>
                  <li>Non-profit organizations</li>
                  <li>Educational purposes</li>
                  <li>Government-funded research</li>
                  <li>Core facility internal QC</li>
                </ul>
              </div>
              <div style={{padding:'0.6rem', background:'rgba(234,179,8,0.08)', borderRadius:'0.4rem', border:'1px solid rgba(234,179,8,0.2)'}}>
                <div style={{color:'var(--warn)', fontWeight:600, marginBottom:'0.3rem'}}>Commercial use requires a license</div>
                <ul style={{color:'var(--muted)', paddingLeft:'1.1rem', lineHeight:1.7}}>
                  <li>For-profit companies</li>
                  <li>CROs &amp; pharma</li>
                  <li>Fee-for-service work</li>
                  <li>Commercial products</li>
                </ul>
                <div style={{marginTop:'0.4rem', color:'var(--muted)', fontSize:'0.8rem'}}>
                  Contact: <a href="mailto:bsphinney@ucdavis.edu" style={{color:'var(--accent)'}}>bsphinney@ucdavis.edu</a>
                </div>
              </div>
            </div>
            <div style={{marginTop:'0.75rem', color:'var(--muted)', fontSize:'0.8rem'}}>
              Community benchmark data is separately licensed under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" style={{color:'var(--accent)'}}>CC BY 4.0</a>.
              Full license text at{' '}
              <a href="https://github.com/MKrawitzky/ziggy/blob/main/LICENSE" target="_blank" style={{color:'var(--accent)'}}>github.com/MKrawitzky/ziggy</a>.
            </div>
          </div>

          {/* Carafe */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Carafe2: Experiment-Specific Spectral Libraries</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              Carafe2 trains deep-learning models (RT, fragment intensity, ion mobility) directly on
              your DIA data and outputs a DIA-NN-compatible TSV spectral library tuned to your
              instrument and sample prep, improving precursor IDs on future runs.
              Published in <em>Nature Communications</em> 2025.
            </p>
            <div style={{background:'var(--bg)', borderRadius:'0.4rem', padding:'0.6rem 0.9rem', fontFamily:'monospace', fontSize:'0.8rem', marginBottom:'0.75rem', border:'1px solid var(--border)'}}>
              <div style={{color:'var(--muted)', marginBottom:'0.2rem'}}># Download Carafe v2.0.0 (207 MB, requires Java 21+)</div>
              <div style={{color:'var(--accent)'}}>stan carafe --install</div>
              <div style={{color:'var(--muted)', marginTop:'0.4rem', marginBottom:'0.2rem'}}># Build experiment-specific library for a run</div>
              <div style={{color:'var(--accent)'}}>stan carafe --run &lt;RUN_ID&gt; --fasta proteome.fasta</div>
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/Noble-Lab/Carafe" target="_blank"
                 style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                         borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem', fontWeight:600}}>
                GitHub →
              </a>
              <a href="https://github.com/Noble-Lab/Carafe/releases/tag/v2.0.0" target="_blank"
                 style={{color:'var(--accent)', fontSize:'0.85rem', textDecoration:'none'}}>
                Download v2.0.0 →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>Requires Java 21+</span>
            </div>
          </div>

          {/* MsBackendTimsTof */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>MsBackendTimsTof: Raw Spectrum Access (R)</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              A Bioconductor/R backend that reads Bruker TimsTOF <code style={{color:'var(--accent)'}}>.d</code> directories
              directly as <code style={{color:'var(--accent)'}}>Spectra</code> objects, giving access to raw spectra,
              ion mobility dimensions, and peak-level data for deep MS analysis, custom filtering, and export.
            </p>
            <div style={{background:'var(--bg)', borderRadius:'0.4rem', padding:'0.6rem 0.9rem', fontFamily:'monospace', fontSize:'0.8rem', marginBottom:'0.75rem', border:'1px solid var(--border)'}}>
              <div style={{color:'var(--muted)', marginBottom:'0.2rem'}}># Install R dependencies (once)</div>
              <div style={{color:'var(--accent)'}}>stan msbackend --install</div>
              <div style={{color:'var(--muted)', marginTop:'0.4rem', marginBottom:'0.2rem'}}># Generate analysis script pre-filled with your .d paths</div>
              <div style={{color:'var(--accent)'}}>stan msbackend</div>
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/rformassspectrometry/MsBackendTimsTof" target="_blank"
                 style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                         borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem', fontWeight:600}}>
                GitHub →
              </a>
              <a href="https://rformassspectrometry.github.io/MsBackendTimsTof/" target="_blank"
                 style={{color:'var(--accent)', fontSize:'0.85rem', textDecoration:'none'}}>
                Documentation →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>Requires R ≥ 4.1 + Bruker SDK</span>
            </div>
          </div>

          {/* timsplot */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>timsplot: Publication-Ready Proteomics Figures</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              timsplot is an external interactive Shiny web app for proteomics figure generation.
              Load DIA-NN <code style={{color:'var(--accent)'}}>report.parquet</code>, Spectronaut exports,
              Sage results, or FragPipe PSMs to produce publication-ready plots: charge distributions,
              volcano plots, PCA, ion mobility, PTM heatmaps, and more.
            </p>
            <div style={{background:'rgba(234,179,8,0.08)', border:'1px solid rgba(234,179,8,0.25)', borderRadius:'0.4rem',
                         padding:'0.6rem 0.9rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'var(--muted)'}}>
              <strong style={{color:'var(--warn)'}}>External app, requires separate setup.</strong>{' '}
              timsplot needs R ≥ 4.1 + the <code style={{color:'var(--accent)'}}>shiny</code> package.
              On instrument PCs running Bruker ProteoScape, use the R version bundled with ProteoScape
              or install R separately to avoid Python version conflicts.
              Once running it serves on <code style={{color:'var(--accent)'}}>localhost:8422</code>.
            </div>
            <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://github.com/zack-kirsch/timsplot" target="_blank"
                 style={{padding:'0.5rem 1.1rem', background:'var(--accent)', color:'var(--bg)',
                         borderRadius:'0.4rem', fontWeight:700, textDecoration:'none', fontSize:'0.9rem'}}>
                timsplot on GitHub →
              </a>
              <span style={{color:'var(--muted)', fontSize:'0.8rem'}}>
                Install: <code style={{color:'var(--accent)'}}>Rscript -e "shiny::runGitHub('timsplot','zack-kirsch')"</code>
              </span>
            </div>
          </div>

          {/* Links */}
          {/* 4 Dimensions explainer */}
          <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(135deg,rgba(1,26,58,0.8),rgba(2,40,81,0.6))'}}>
            <h3 style={{marginBottom:'0.6rem',color:'#60a5fa'}}>The 4 Dimensions of timsTOF Data</h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:'0.6rem',marginBottom:'0.75rem'}}>
              {[
                {dim:'1',name:'Retention Time',unit:'minutes',icon:'⏱',color:'#94a3b8',
                  desc:'When the peptide elutes from the LC column. Every LC-MS instrument has this.',
                  orbi:true, tims:true},
                {dim:'2',name:'m/z',unit:'Th (Thomson)',icon:'⚖',color:'#94a3b8',
                  desc:'Mass-to-charge ratio. Identifies the peptide by mass. Every LC-MS instrument has this.',
                  orbi:true, tims:true},
                {dim:'3',name:'Intensity',unit:'counts / a.u.',icon:'📶',color:'#94a3b8',
                  desc:'Signal strength. Proportional to peptide abundance. Every LC-MS instrument has this.',
                  orbi:true, tims:true},
                {dim:'4',name:'Ion Mobility (1/K₀)',unit:'Vs/cm²',icon:'🌀',color:'#60a5fa',
                  desc:'How fast an ion drifts through a gas under an electric field — determined by its 3D shape and charge. timsTOF unique.',
                  orbi:false, tims:true},
              ].map(d=>(
                <div key={d.dim} style={{background:d.tims&&!d.orbi?'rgba(96,165,250,0.08)':'rgba(255,255,255,0.02)',
                  border:`1px solid ${d.tims&&!d.orbi?'rgba(96,165,250,0.3)':'rgba(255,255,255,0.06)'}`,
                  borderRadius:'0.5rem',padding:'0.7rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.3rem'}}>
                    <span style={{fontSize:'1.4rem'}}>{d.icon}</span>
                    <span style={{fontSize:'0.62rem',fontWeight:700,padding:'0.1rem 0.35rem',borderRadius:'0.25rem',
                      background:d.tims&&!d.orbi?'rgba(96,165,250,0.2)':'rgba(255,255,255,0.05)',
                      color:d.tims&&!d.orbi?'#60a5fa':'#475569'}}>
                      {d.tims&&!d.orbi?'timsTOF ONLY':'All platforms'}
                    </span>
                  </div>
                  <div style={{fontSize:'0.85rem',fontWeight:700,color:d.tims&&!d.orbi?'#60a5fa':'#94a3b8',marginBottom:'0.2rem'}}>
                    Dim {d.dim}: {d.name}
                  </div>
                  <div style={{fontSize:'0.68rem',color:'#4a6070',marginBottom:'0.3rem'}}>{d.unit}</div>
                  <div style={{fontSize:'0.72rem',color:'#64748b',lineHeight:1.5}}>{d.desc}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:'0.78rem',color:'#4a6070',lineHeight:1.7,borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:'0.6rem'}}>
              <strong style={{color:'#60a5fa'}}>Why does the 4th dimension matter?</strong> Ion mobility separates
              co-eluting, isobaric peptides that are identical in RT and m/z but differ in 3D shape.
              It also allows PASEF multiplexing — the instrument fragments multiple co-isolated precursors
              in a single TIMS scan cycle, boosting sensitivity and speed by ~10× compared to traditional DDA.
              The 1/K₀ value can be converted to a calibration-independent CCS (Å²) that is
              reproducible across labs — a molecular fingerprint.
            </div>
          </div>

          <div className="card">
            <h3>Resources</h3>
            <div style={{display:'flex', flexWrap:'wrap', gap:'0.5rem', marginTop:'0.25rem'}}>
              {[
                ['GitHub (ZIGGY)', 'https://github.com/MKrawitzky/ziggy'],
                ['Community Dashboard', 'https://community.stan-proteomics.org'],
                ['HF Dataset', 'https://huggingface.co/datasets/brettsp/stan-benchmark'],
                ['timsplot', 'https://github.com/zack-kirsch/timsplot'],
                ['MsBackendTimsTof', 'https://github.com/rformassspectrometry/MsBackendTimsTof'],
                ['Carafe2', 'https://github.com/Noble-Lab/Carafe'],
                ['API Docs', '/docs'],
                ['4D Landscape Viewer', '/static/landscape_viewer.html'],
                ['Ion Mobility Explainer', '/static/ion_mobility_explainer.html'],
                ['Beyond IDs', '/static/beyond_ids.html'],
              ].map(([label, href]) => (
                <a key={label} href={href} target={href.startsWith('http') ? '_blank' : '_self'}
                   style={{padding:'0.4rem 0.9rem', background:'var(--surface)', border:'1px solid var(--border)',
                           borderRadius:'0.4rem', color:'var(--accent)', textDecoration:'none', fontSize:'0.85rem',
                           fontWeight:600}}>
                  {label} →
                </a>
              ))}
            </div>
          </div>
        </div>
      );
    }

