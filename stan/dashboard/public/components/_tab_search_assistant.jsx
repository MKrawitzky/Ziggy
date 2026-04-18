    /* ── Search Assistant Tab ─────────────────────────────────────────── */

    const PRESET_META = {
      hela_digest:  { icon: '🧫', color: '#34d399' },
      single_cell:  { icon: '🔬', color: '#22d3ee' },
      mhc_class_i:  { icon: '🛡', color: '#f472b6' },
      mhc_class_ii: { icon: '🛡', color: '#a78bfa' },
      tmt:          { icon: '🏷', color: '#DAAA00' },
      phospho:      { icon: '⚡', color: '#fb923c' },
    };

    function SearchAssistantTab() {
      const { data: unsearched, loading: unsearchedLoading, refetch: refetchUnsearched } = useFetch('/api/search/unsearched');
      const { data: presets,    loading: presetsLoading  } = useFetch('/api/search/presets');
      const { data: fastas,     loading: fastasLoading   } = useFetch('/api/fasta');
      const { data: libraries,  loading: librariesLoading} = useFetch('/api/libraries');

      // wizard state
      const [step, setStep]               = useState(1);   // 1=select runs  2=preset  3=configure  4=review
      const [selected, setSelected]       = useState(new Set());
      const [chosenPreset, setChosenPreset] = useState(null);
      const [fastaPath, setFastaPath]     = useState('');
      const [libraryPath, setLibraryPath] = useState('');
      const [extraArgs, setExtraArgs]     = useState('');
      const [jobLabel, setJobLabel]       = useState('');
      const [submitting, setSubmitting]   = useState(false);
      const [submitError, setSubmitError] = useState('');

      // job tracking
      const [jobs, setJobs]               = useState([]);
      const [expandedJob, setExpandedJob] = useState(null);
      const [jobDetail, setJobDetail]     = useState(null);
      const jobPollRef                    = useRef(null);

      // Poll jobs list
      useEffect(() => {
        const poll = () => {
          fetch(API + '/api/search/jobs')
            .then(r => r.ok ? r.json() : [])
            .then(j => setJobs(j))
            .catch(() => {});
        };
        poll();
        jobPollRef.current = setInterval(poll, 3000);
        return () => clearInterval(jobPollRef.current);
      }, []);

      // Poll expanded job detail
      useEffect(() => {
        if (!expandedJob) { setJobDetail(null); return; }
        const poll = () => {
          fetch(API + `/api/search/jobs/${expandedJob}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => setJobDetail(d))
            .catch(() => {});
        };
        poll();
        const id = setInterval(poll, 2000);
        return () => clearInterval(id);
      }, [expandedJob]);

      const unsearchedList = Array.isArray(unsearched) ? unsearched : [];
      const presetList = presets ? Object.entries(presets) : [];
      const fastaList  = Array.isArray(fastas)    ? fastas    : [];
      const libList    = Array.isArray(libraries) ? libraries : [];

      // Group unsearched by instrument
      const byInstrument = useMemo(() => {
        const m = {};
        for (const r of unsearchedList) {
          const k = r.instrument || '(unknown)';
          if (!m[k]) m[k] = [];
          m[k].push(r);
        }
        return m;
      }, [unsearchedList]);

      const toggleRun = id => setSelected(s => {
        const ns = new Set(s);
        ns.has(id) ? ns.delete(id) : ns.add(id);
        return ns;
      });

      const toggleAll = () => {
        if (selected.size === unsearchedList.length) {
          setSelected(new Set());
        } else {
          setSelected(new Set(unsearchedList.map(r => r.id)));
        }
      };

      const handleSubmit = async () => {
        setSubmitting(true);
        setSubmitError('');
        try {
          const resp = await fetch(API + '/api/search/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              run_ids: [...selected],
              preset: chosenPreset,
              fasta_path: fastaPath,
              library_path: libraryPath,
              extra_args: extraArgs,
              label: jobLabel,
            }),
          });
          if (!resp.ok) {
            const err = await resp.json();
            setSubmitError(err.detail || 'Submission failed');
            setSubmitting(false);
            return;
          }
          const result = await resp.json();
          setExpandedJob(result.job_id);
          // Reset wizard
          setStep(1);
          setSelected(new Set());
          setChosenPreset(null);
          setFastaPath('');
          setLibraryPath('');
          setExtraArgs('');
          setJobLabel('');
          setSubmitting(false);
          refetchUnsearched && refetchUnsearched();
        } catch (e) {
          setSubmitError(String(e));
          setSubmitting(false);
        }
      };

      const runningJobs = jobs.filter(j => j.status === 'running');
      const doneJobs    = jobs.filter(j => j.status === 'done');

      // ── Notification banner ──────────────────────────────────────────
      const banner = unsearchedList.length > 0 && (
        <div style={{
          background: 'linear-gradient(90deg, #1a0830 0%, #0e1a30 100%)',
          border: '1px solid #DAAA00',
          borderRadius: '0.6rem',
          padding: '0.75rem 1.2rem',
          marginBottom: '1.2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}>
          <span style={{fontSize:'1.4rem'}}>📂</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700, color:'#DAAA00'}}>
              {unsearchedList.length} run{unsearchedList.length !== 1 ? 's' : ''} without search results
            </div>
            <div style={{fontSize:'0.8rem', color:'var(--muted)', marginTop:'0.15rem'}}>
              These raw files are registered in the database but have not been searched with DIA-NN yet.
              Use the wizard below to queue them.
            </div>
          </div>
          <button
            onClick={() => setStep(1)}
            style={{padding:'0.4rem 1rem', background:'#DAAA00', color:'#0e0018',
                    border:'none', borderRadius:'0.4rem', fontWeight:700, cursor:'pointer', fontSize:'0.85rem'}}
          >
            Search Now
          </button>
        </div>
      );

      // ── Active jobs panel ────────────────────────────────────────────
      const jobsPanel = jobs.length > 0 && (
        <div className="card" style={{marginBottom:'1.2rem'}}>
          <h3 style={{marginBottom:'0.75rem', display:'flex', alignItems:'center', gap:'0.5rem'}}>
            <span>Search Jobs</span>
            {runningJobs.length > 0 && (
              <span style={{background:'#22d3ee', color:'#0e0018', borderRadius:'0.9rem',
                           padding:'0.1rem 0.55rem', fontSize:'0.72rem', fontWeight:700}}>
                {runningJobs.length} running
              </span>
            )}
          </h3>
          {jobs.map(j => (
            <div
              key={j.job_id}
              onClick={() => setExpandedJob(expandedJob === j.job_id ? null : j.job_id)}
              style={{
                padding: '0.5rem 0.75rem',
                marginBottom: '0.4rem',
                borderRadius: '0.4rem',
                border: `1px solid ${j.status === 'running' ? '#22d3ee' : 'var(--border)'}`,
                background: expandedJob === j.job_id ? 'var(--surface)' : 'transparent',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.75rem',
              }}
            >
              <span style={{fontSize:'1.1rem'}}>
                {j.status === 'running' ? '⏳' : (j.n_failed > 0 ? '⚠️' : '✅')}
              </span>
              <div style={{flex:1}}>
                <div style={{fontWeight:600, fontSize:'0.85rem'}}>{j.label}</div>
                <div style={{fontSize:'0.75rem', color:'var(--muted)'}}>
                  {j.n_runs} run{j.n_runs !== 1 ? 's' : ''} · {j.n_done} done
                  {j.n_failed > 0 && <span style={{color:'#ef4444'}}> · {j.n_failed} failed</span>}
                  {j.status === 'running' && (
                    <span style={{color:'#22d3ee'}}> · {Math.round(j.n_done / j.n_runs * 100)}%</span>
                  )}
                </div>
              </div>
              <span style={{fontSize:'0.7rem', color:'var(--muted)'}}>
                {(j.started_at || '').slice(11,16)} UTC
              </span>
            </div>
          ))}

          {expandedJob && jobDetail && (
            <div style={{
              marginTop:'0.5rem', background:'#000814', borderRadius:'0.4rem',
              padding:'0.75rem', fontFamily:'monospace', fontSize:'0.73rem',
              maxHeight:'260px', overflowY:'auto', color:'#94a3b8',
              border:'1px solid var(--border)',
            }}>
              {jobDetail.log.map((line, i) => (
                <div key={i} style={{
                  color: line.startsWith('  ✓') ? '#34d399'
                       : line.startsWith('  ✗') ? '#ef4444'
                       : line.startsWith('▶')   ? '#DAAA00'
                       : line.startsWith('  ⚠') ? '#fbbf24'
                       : '#94a3b8',
                  whiteSpace: 'pre-wrap',
                }}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      );

      // ── Step progress bar ────────────────────────────────────────────
      const stepBar = (
        <div style={{display:'flex', gap:'0', marginBottom:'1.5rem'}}>
          {[
            [1, 'Select Runs'],
            [2, 'Choose Preset'],
            [3, 'Configure'],
            [4, 'Review & Submit'],
          ].map(([n, label]) => (
            <div
              key={n}
              onClick={() => n < step && setStep(n)}
              style={{
                flex: 1,
                padding: '0.5rem',
                textAlign: 'center',
                fontSize: '0.78rem',
                fontWeight: step === n ? 700 : 400,
                color: step >= n ? (step === n ? '#DAAA00' : 'var(--text)') : 'var(--muted)',
                borderBottom: `2px solid ${step === n ? '#DAAA00' : step > n ? '#34d399' : 'var(--border)'}`,
                cursor: n < step ? 'pointer' : 'default',
                transition: 'all 0.2s',
              }}
            >
              <span style={{
                display:'inline-block', width:'1.3rem', height:'1.3rem',
                borderRadius:'50%', lineHeight:'1.3rem', textAlign:'center',
                background: step > n ? '#34d399' : step === n ? '#DAAA00' : 'var(--border)',
                color: step >= n ? '#0e0018' : 'var(--muted)',
                fontSize:'0.72rem', fontWeight:700, marginRight:'0.4rem',
              }}>
                {step > n ? '✓' : n}
              </span>
              {label}
            </div>
          ))}
        </div>
      );

      // ── Step 1: Select runs ──────────────────────────────────────────
      const step1 = step === 1 && (
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem'}}>
            <h3>Select runs to search</h3>
            <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
              <span style={{fontSize:'0.8rem', color:'var(--muted)'}}>
                {selected.size} of {unsearchedList.length} selected
              </span>
              <button
                onClick={toggleAll}
                style={{padding:'0.25rem 0.65rem', fontSize:'0.78rem',
                        background:'var(--surface)', border:'1px solid var(--border)',
                        borderRadius:'0.35rem', color:'var(--text)', cursor:'pointer'}}
              >
                {selected.size === unsearchedList.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>

          {unsearchedLoading ? (
            <div style={{color:'var(--muted)', fontSize:'0.85rem'}}>Loading…</div>
          ) : unsearchedList.length === 0 ? (
            <div style={{textAlign:'center', padding:'2rem', color:'var(--muted)'}}>
              <div style={{fontSize:'1.5rem', marginBottom:'0.5rem'}}>🎉</div>
              All runs have been searched — nothing pending!
            </div>
          ) : (
            Object.entries(byInstrument).map(([inst, runs]) => (
              <div key={inst} style={{marginBottom:'1rem'}}>
                <div style={{
                  fontSize:'0.72rem', fontWeight:700, color:'var(--muted)',
                  letterSpacing:'0.08em', textTransform:'uppercase',
                  marginBottom:'0.35rem', paddingBottom:'0.25rem',
                  borderBottom:'1px solid var(--border)',
                }}>
                  {inst} — {runs.length} file{runs.length !== 1 ? 's' : ''}
                </div>
                {runs.map(r => (
                  <div
                    key={r.id}
                    onClick={() => toggleRun(r.id)}
                    style={{
                      display:'flex', alignItems:'center', gap:'0.6rem',
                      padding:'0.35rem 0.5rem',
                      borderRadius:'0.35rem', cursor:'pointer',
                      background: selected.has(r.id) ? 'rgba(218,170,0,0.08)' : 'transparent',
                      border: `1px solid ${selected.has(r.id) ? '#DAAA0060' : 'transparent'}`,
                      marginBottom:'0.2rem',
                    }}
                  >
                    <div style={{
                      width:'1rem', height:'1rem', borderRadius:'0.2rem', flexShrink:0,
                      background: selected.has(r.id) ? '#DAAA00' : 'var(--border)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:'0.65rem', color:'#0e0018',
                    }}>
                      {selected.has(r.id) ? '✓' : ''}
                    </div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:'0.82rem', fontWeight:500,
                                   overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {r.run_name}
                      </div>
                      <div style={{fontSize:'0.72rem', color:'var(--muted)'}}>
                        {r.acquisition_mode || '?'} · {(r.run_date||'').slice(0,10)} · {r.lc_system || 'LC unknown'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}

          <div style={{marginTop:'1rem', display:'flex', justifyContent:'flex-end'}}>
            <button
              onClick={() => setStep(2)}
              disabled={selected.size === 0}
              style={{
                padding:'0.5rem 1.5rem', fontWeight:700, fontSize:'0.85rem',
                background: selected.size > 0 ? '#DAAA00' : 'var(--border)',
                color: selected.size > 0 ? '#0e0018' : 'var(--muted)',
                border:'none', borderRadius:'0.4rem',
                cursor: selected.size > 0 ? 'pointer' : 'default',
              }}
            >
              Next →
            </button>
          </div>
        </div>
      );

      // ── Step 2: Choose preset ────────────────────────────────────────
      const step2 = step === 2 && (
        <div className="card">
          <h3 style={{marginBottom:'0.75rem'}}>Choose a search preset</h3>
          <div style={{
            display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))',
            gap:'0.65rem', marginBottom:'1rem',
          }}>
            {presetList.map(([key, p]) => {
              const meta = PRESET_META[key] || {};
              const isSelected = chosenPreset === key;
              return (
                <div
                  key={key}
                  onClick={() => setChosenPreset(key)}
                  style={{
                    padding:'0.85rem 1rem',
                    borderRadius:'0.6rem',
                    border: `2px solid ${isSelected ? (meta.color || '#DAAA00') : 'var(--border)'}`,
                    background: isSelected ? `${(meta.color || '#DAAA00')}18` : 'var(--surface)',
                    cursor:'pointer',
                    transition:'all 0.15s',
                  }}
                >
                  <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.35rem'}}>
                    <span style={{fontSize:'1.3rem'}}>{meta.icon || '🔍'}</span>
                    <span style={{fontWeight:700, fontSize:'0.88rem', color: isSelected ? (meta.color || '#DAAA00') : 'var(--text)'}}>
                      {p.label}
                    </span>
                  </div>
                  <div style={{fontSize:'0.76rem', color:'var(--muted)', lineHeight:'1.4'}}>
                    {p.description}
                  </div>
                  {isSelected && (
                    <div style={{
                      marginTop:'0.5rem', fontSize:'0.7rem', color:'var(--muted)',
                      fontFamily:'monospace', background:'#00000040',
                      padding:'0.35rem', borderRadius:'0.3rem',
                      wordBreak:'break-all',
                    }}>
                      {(p.diann_args || []).join(' ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{display:'flex', justifyContent:'space-between'}}>
            <button onClick={() => setStep(1)} style={{padding:'0.4rem 1rem', fontSize:'0.82rem',
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:'0.4rem', color:'var(--text)', cursor:'pointer'}}>
              ← Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!chosenPreset}
              style={{
                padding:'0.5rem 1.5rem', fontWeight:700, fontSize:'0.85rem',
                background: chosenPreset ? '#DAAA00' : 'var(--border)',
                color: chosenPreset ? '#0e0018' : 'var(--muted)',
                border:'none', borderRadius:'0.4rem',
                cursor: chosenPreset ? 'pointer' : 'default',
              }}
            >
              Next →
            </button>
          </div>
        </div>
      );

      // ── Step 3: Configure FASTA / library ───────────────────────────
      const step3 = step === 3 && (
        <div className="card">
          <h3 style={{marginBottom:'0.75rem'}}>Configure FASTA &amp; library</h3>

          {/* FASTA */}
          <div style={{marginBottom:'1.1rem'}}>
            <label style={{display:'block', fontSize:'0.82rem', fontWeight:600, marginBottom:'0.35rem', color:'#DAAA00'}}>
              FASTA database <span style={{color:'#ef4444'}}>*</span>
            </label>
            {fastaList.length > 0 ? (
              <select
                value={fastaPath}
                onChange={e => setFastaPath(e.target.value)}
                style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                        border:'1px solid var(--border)', borderRadius:'0.4rem',
                        color:'var(--text)', fontSize:'0.82rem'}}
              >
                <option value="">— select a FASTA file —</option>
                {fastaList.map(f => (
                  <option key={f.name} value={f.path || f.name}>{f.name} ({(f.size_mb||0).toFixed(1)} MB)</option>
                ))}
              </select>
            ) : (
              <div>
                <input
                  type="text"
                  value={fastaPath}
                  onChange={e => setFastaPath(e.target.value)}
                  placeholder="C:/path/to/proteome.fasta"
                  style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                          border:'1px solid var(--border)', borderRadius:'0.4rem',
                          color:'var(--text)', fontSize:'0.82rem', boxSizing:'border-box'}}
                />
                <div style={{fontSize:'0.74rem', color:'var(--muted)', marginTop:'0.25rem'}}>
                  No managed FASTA files found. Enter a full path, or upload one via the Config tab.
                </div>
              </div>
            )}
            {/* Also allow manual path override */}
            {fastaList.length > 0 && (
              <input
                type="text"
                value={fastaPath}
                onChange={e => setFastaPath(e.target.value)}
                placeholder="or paste a full path…"
                style={{marginTop:'0.4rem', width:'100%', padding:'0.35rem 0.5rem',
                        background:'var(--bg)', border:'1px solid var(--border)',
                        borderRadius:'0.4rem', color:'var(--text)', fontSize:'0.78rem',
                        boxSizing:'border-box'}}
              />
            )}
          </div>

          {/* Spectral library */}
          <div style={{marginBottom:'1.1rem'}}>
            <label style={{display:'block', fontSize:'0.82rem', fontWeight:600, marginBottom:'0.35rem', color:'#a78bfa'}}>
              Spectral library <span style={{fontSize:'0.75rem', fontWeight:400, color:'var(--muted)'}}>
                (optional — omit for library-free / directDIA)
              </span>
            </label>
            {libList.length > 0 && (
              <select
                value={libraryPath}
                onChange={e => setLibraryPath(e.target.value)}
                style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                        border:'1px solid var(--border)', borderRadius:'0.4rem',
                        color:'var(--text)', fontSize:'0.82rem', marginBottom:'0.4rem'}}
              >
                <option value="">— no library (directDIA) —</option>
                {libList.map(f => (
                  <option key={f.name} value={f.path || f.name}>{f.name} ({(f.size_mb||0).toFixed(1)} MB)</option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={libraryPath}
              onChange={e => setLibraryPath(e.target.value)}
              placeholder="C:/path/to/library.parquet  (or leave blank for directDIA)"
              style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                      border:'1px solid var(--border)', borderRadius:'0.4rem',
                      color:'var(--text)', fontSize:'0.82rem', boxSizing:'border-box'}}
            />
          </div>

          {/* Job label */}
          <div style={{marginBottom:'1.1rem'}}>
            <label style={{display:'block', fontSize:'0.82rem', fontWeight:600, marginBottom:'0.35rem', color:'var(--muted)'}}>
              Job label <span style={{fontWeight:400}}>(optional)</span>
            </label>
            <input
              type="text"
              value={jobLabel}
              onChange={e => setJobLabel(e.target.value)}
              placeholder={`${chosenPreset ? (PRESET_META[chosenPreset]?.icon || '') + ' ' : ''}${selected.size} runs`}
              style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                      border:'1px solid var(--border)', borderRadius:'0.4rem',
                      color:'var(--text)', fontSize:'0.82rem', boxSizing:'border-box'}}
            />
          </div>

          {/* Extra DIA-NN flags */}
          <div style={{marginBottom:'1.1rem'}}>
            <label style={{display:'block', fontSize:'0.82rem', fontWeight:600, marginBottom:'0.35rem', color:'var(--muted)'}}>
              Extra DIA-NN flags <span style={{fontWeight:400}}>(advanced, optional)</span>
            </label>
            <input
              type="text"
              value={extraArgs}
              onChange={e => setExtraArgs(e.target.value)}
              placeholder="--mass-acc 10 --window 0 ..."
              style={{width:'100%', padding:'0.4rem 0.5rem', background:'var(--bg)',
                      border:'1px solid var(--border)', borderRadius:'0.4rem',
                      color:'var(--text)', fontSize:'0.82rem', fontFamily:'monospace',
                      boxSizing:'border-box'}}
            />
          </div>

          <div style={{display:'flex', justifyContent:'space-between'}}>
            <button onClick={() => setStep(2)} style={{padding:'0.4rem 1rem', fontSize:'0.82rem',
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:'0.4rem', color:'var(--text)', cursor:'pointer'}}>
              ← Back
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={!fastaPath}
              style={{
                padding:'0.5rem 1.5rem', fontWeight:700, fontSize:'0.85rem',
                background: fastaPath ? '#DAAA00' : 'var(--border)',
                color: fastaPath ? '#0e0018' : 'var(--muted)',
                border:'none', borderRadius:'0.4rem',
                cursor: fastaPath ? 'pointer' : 'default',
              }}
            >
              Next →
            </button>
          </div>
        </div>
      );

      // ── Step 4: Review & submit ──────────────────────────────────────
      const presetData = chosenPreset && presets ? presets[chosenPreset] : null;
      const presetMeta = chosenPreset ? (PRESET_META[chosenPreset] || {}) : {};

      const step4 = step === 4 && (
        <div className="card">
          <h3 style={{marginBottom:'1rem'}}>Review &amp; Submit</h3>

          <div style={{display:'grid', gap:'0.65rem', marginBottom:'1.2rem'}}>
            <div style={{
              background:'var(--surface)', borderRadius:'0.5rem', padding:'0.75rem 1rem',
              border:`1px solid ${presetMeta.color || 'var(--border)'}`,
              display:'flex', alignItems:'center', gap:'0.75rem',
            }}>
              <span style={{fontSize:'1.5rem'}}>{presetMeta.icon || '🔍'}</span>
              <div>
                <div style={{fontWeight:700, color: presetMeta.color || 'var(--text)'}}>
                  {presetData?.label}
                </div>
                <div style={{fontSize:'0.75rem', color:'var(--muted)'}}>
                  {presetData?.description}
                </div>
              </div>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem'}}>
              <div style={{background:'var(--surface)', borderRadius:'0.4rem', padding:'0.6rem 0.75rem'}}>
                <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.2rem'}}>RUNS TO SEARCH</div>
                <div style={{fontWeight:700, fontSize:'1.2rem', color:'#DAAA00'}}>{selected.size}</div>
              </div>
              <div style={{background:'var(--surface)', borderRadius:'0.4rem', padding:'0.6rem 0.75rem'}}>
                <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.2rem'}}>EST. TIME</div>
                <div style={{fontWeight:700, fontSize:'1.2rem', color:'#22d3ee'}}>
                  ~{Math.round(selected.size * 6)} min
                </div>
              </div>
            </div>

            <div style={{background:'var(--surface)', borderRadius:'0.4rem', padding:'0.6rem 0.75rem'}}>
              <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.25rem'}}>FASTA</div>
              <div style={{fontSize:'0.82rem', fontFamily:'monospace', wordBreak:'break-all'}}>{fastaPath}</div>
            </div>

            {libraryPath && (
              <div style={{background:'var(--surface)', borderRadius:'0.4rem', padding:'0.6rem 0.75rem'}}>
                <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.25rem'}}>SPECTRAL LIBRARY</div>
                <div style={{fontSize:'0.82rem', fontFamily:'monospace', wordBreak:'break-all'}}>{libraryPath}</div>
              </div>
            )}

            <div style={{background:'var(--surface)', borderRadius:'0.4rem', padding:'0.6rem 0.75rem'}}>
              <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.25rem'}}>DIA-NN ARGS</div>
              <div style={{fontSize:'0.75rem', fontFamily:'monospace', color:'#94a3b8', wordBreak:'break-all'}}>
                {(presetData?.diann_args || []).join(' ')}
                {extraArgs && <span style={{color:'#fbbf24'}}> {extraArgs}</span>}
              </div>
            </div>

            <div style={{background:'var(--surface)', borderRadius:'0.4rem', padding:'0.6rem 0.75rem', maxHeight:'180px', overflowY:'auto'}}>
              <div style={{fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.25rem'}}>SELECTED RUNS</div>
              {unsearchedList.filter(r => selected.has(r.id)).map(r => (
                <div key={r.id} style={{fontSize:'0.77rem', color:'var(--text)', padding:'0.1rem 0'}}>
                  • {r.run_name}
                </div>
              ))}
            </div>
          </div>

          {submitError && (
            <div style={{
              padding:'0.6rem 0.75rem', background:'rgba(239,68,68,0.1)',
              border:'1px solid #ef4444', borderRadius:'0.4rem',
              color:'#ef4444', fontSize:'0.82rem', marginBottom:'0.75rem',
            }}>
              {submitError}
            </div>
          )}

          <div style={{display:'flex', justifyContent:'space-between', gap:'0.5rem'}}>
            <button onClick={() => setStep(3)} style={{padding:'0.4rem 1rem', fontSize:'0.82rem',
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:'0.4rem', color:'var(--text)', cursor:'pointer'}}>
              ← Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                padding:'0.6rem 2rem', fontWeight:700, fontSize:'0.9rem',
                background: submitting ? 'var(--border)' : 'linear-gradient(90deg, #DAAA00, #f59e0b)',
                color: submitting ? 'var(--muted)' : '#0e0018',
                border:'none', borderRadius:'0.4rem',
                cursor: submitting ? 'default' : 'pointer',
                boxShadow: submitting ? 'none' : '0 0 12px #DAAA0060',
              }}
            >
              {submitting ? '⏳ Submitting…' : '🚀 Launch Search'}
            </button>
          </div>
        </div>
      );

      // ── Why unsearched? Info card ────────────────────────────────────
      const whyCard = unsearchedList.length > 0 && jobs.length === 0 && step === 1 && (
        <div className="card" style={{marginTop:'1rem', opacity:0.8}}>
          <h3 style={{marginBottom:'0.4rem', fontSize:'0.85rem', color:'var(--muted)'}}>
            Why are files unsearched?
          </h3>
          <div style={{fontSize:'0.78rem', color:'var(--muted)', lineHeight:'1.6'}}>
            STAN's watcher picks up raw files and registers them in the database, but only runs DIA-NN
            automatically for files matching the configured QC pattern (typically HeLa / QC keywords).
            Research samples like K562, immunopeptidomics, phospho, or TMT experiments need to be
            searched explicitly — that's what this assistant is for.
          </div>
        </div>
      );

      return (
        <div style={{maxWidth:'860px', margin:'0 auto'}}>
          {banner}
          {jobsPanel}
          {unsearchedList.length > 0 && stepBar}
          {step1}
          {step2}
          {step3}
          {step4}
          {whyCard}
        </div>
      );
    }
