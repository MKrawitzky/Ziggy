    function fmtBytes(mb) {
      if (mb == null) return '';
      if (mb < 0.1)  return '<0.1 MB';
      if (mb >= 1000) return (mb/1024).toFixed(1) + ' GB';
      return mb.toFixed(1) + ' MB';
    }
    function fmtUploadDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleDateString([], {year:'numeric',month:'short',day:'numeric'}) +
             ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }

    // ── FASTA + Library Manager card ───────────────────────────────────────
    function LibraryManager({ instruments, onAssigned }) {
      const [fastas,       setFastas]       = useState([]);
      const [libs,         setLibs]         = useState([]);
      const [presets,      setPresets]      = useState([]);
      const [organisms,    setOrganisms]    = useState({});
      const [uploading,    setUploading]    = useState({});   // {fasta|lib: true}
      const [dlJobs,       setDlJobs]       = useState({});   // {organism → {status,progress,filename,error}}
      const [showDl,       setShowDl]       = useState(false);
      const [showLibSrc,   setShowLibSrc]   = useState(false);
      const [reviewedOnly, setReviewedOnly] = useState(true);
      const [libMsg,       setLibMsg]       = useState('');
      const [selInst,      setSelInst]      = useState(0);

      const instList = instruments?.instruments || [];

      function loadFastas() {
        fetch(API + '/api/fasta').then(r => r.ok ? r.json() : []).then(setFastas).catch(() => {});
      }
      function loadLibs() {
        fetch(API + '/api/libraries').then(r => r.ok ? r.json() : []).then(setLibs).catch(() => {});
      }
      useEffect(() => {
        loadFastas(); loadLibs();
        fetch(API + '/api/fasta/organisms').then(r => r.ok ? r.json() : {}).then(setOrganisms).catch(() => {});
        fetch(API + '/api/libraries/presets').then(r => r.ok ? r.json() : []).then(setPresets).catch(() => {});
      }, []);

      // Poll any in-progress download jobs every 2 s
      useEffect(() => {
        const running = Object.values(dlJobs).filter(j => j.status === 'queued' || j.status === 'downloading' || j.status === 'adding_decoys' || j.status === 'saving');
        if (!running.length) return;
        const t = setInterval(() => {
          Object.entries(dlJobs).forEach(([org, j]) => {
            if (!j.job_id || j.status === 'done' || j.status === 'failed') return;
            fetch(API + `/api/fasta/download/${j.job_id}`)
              .then(r => r.ok ? r.json() : null)
              .then(d => {
                if (!d) return;
                setDlJobs(prev => ({...prev, [org]: {...prev[org], ...d}}));
                if (d.status === 'done') loadFastas();
              })
              .catch(() => {});
          });
        }, 2000);
        return () => clearInterval(t);
      }, [dlJobs]);

      async function startDownload(organism) {
        setDlJobs(prev => ({...prev, [organism]: {status:'queued', progress:0}}));
        const r = await fetch(API + '/api/fasta/download', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({organism, reviewed_only: reviewedOnly}),
        });
        if (r.ok) {
          const d = await r.json();
          setDlJobs(prev => ({...prev, [organism]: {job_id: d.job_id, status:'queued', progress:0}}));
        } else {
          const err = await r.json().catch(() => ({}));
          setDlJobs(prev => ({...prev, [organism]: {status:'failed', error: err.detail || 'start failed'}}));
        }
      }

      async function handleUpload(e, kind) {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        setUploading(u => ({...u, [kind]: true}));
        setLibMsg('Uploading…');
        const fd = new FormData();
        fd.append('file', file);
        const endpoint = kind === 'fasta' ? '/api/fasta' : '/api/libraries';
        const r = await fetch(API + endpoint, { method: 'POST', body: fd });
        setUploading(u => ({...u, [kind]: false}));
        if (r.ok) {
          setLibMsg(`${file.name} uploaded.`);
          kind === 'fasta' ? loadFastas() : loadLibs();
        } else {
          const err = await r.json().catch(() => ({}));
          setLibMsg(`Upload failed: ${err.detail || r.status}`);
        }
      }

      async function handleDelete(name, kind) {
        if (!confirm(`Delete ${name}?\n\nInstruments using this file will need to be reassigned.`)) return;
        const endpoint = kind === 'fasta' ? `/api/fasta/${encodeURIComponent(name)}` : `/api/libraries/${encodeURIComponent(name)}`;
        const r = await fetch(API + endpoint, { method: 'DELETE' });
        if (r.ok) {
          setLibMsg(`${name} deleted.`);
          kind === 'fasta' ? loadFastas() : loadLibs();
          if (onAssigned) onAssigned();
        } else setLibMsg('Delete failed.');
      }

      async function assignToInstrument(fastaName, libName) {
        if (instList.length === 0) { setLibMsg('No instruments configured.'); return; }
        setLibMsg('Assigning…');
        const body = { instrument_index: selInst };
        if (fastaName !== undefined) body.fasta_path = fastaName || '';
        if (libName   !== undefined) body.lib_path   = libName   || '';
        const r = await fetch(API + '/api/config/assign', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body),
        });
        if (r.ok) {
          const d = await r.json();
          setLibMsg(`Assigned to ${d.instrument}. Takes effect on next search.`);
          if (onAssigned) onAssigned();
        } else {
          const err = await r.json().catch(() => ({}));
          setLibMsg(`Assign failed: ${err.detail || r.status}`);
        }
      }

      const selStyle = {padding:'0.3rem 0.5rem',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'0.4rem',color:'var(--text)',fontSize:'0.82rem'};
      const curInst  = instList[selInst] || {};
      const curFasta = curInst.fasta_path ? curInst.fasta_path.split(/[/\\]/).pop() : null;
      const curLib   = curInst.lib_path   ? curInst.lib_path.split(/[/\\]/).pop()   : null;

      // ── sub-components ────────────────────────────────────────────────────

      function FileRow({ entry, kind }) {
        const isActive = kind === 'fasta' ? entry.name === curFasta : entry.name === curLib;
        return (
          <tr style={{borderBottom:'1px solid var(--border)', background: isActive ? 'rgba(218,170,0,0.06)' : 'transparent'}}>
            <td style={{padding:'0.4rem 0.5rem', maxWidth:'260px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              <span title={entry.name} style={{fontFamily:'monospace', fontSize:'0.8rem', color: isActive ? 'var(--accent)' : 'var(--text)'}}>
                {entry.name}
              </span>
              {isActive && <span style={{marginLeft:'0.4rem',fontSize:'0.65rem',background:'rgba(218,170,0,0.2)',color:'var(--accent)',padding:'0.05rem 0.3rem',borderRadius:'999px',fontWeight:700}}>active</span>}
            </td>
            <td style={{padding:'0.4rem 0.5rem',color:'var(--muted)',fontSize:'0.75rem',whiteSpace:'nowrap'}}>{fmtBytes(entry.size_mb)}</td>
            <td style={{padding:'0.4rem 0.5rem',color:'var(--muted)',fontSize:'0.75rem',whiteSpace:'nowrap'}}>{fmtUploadDate(entry.uploaded)}</td>
            <td style={{padding:'0.4rem 0.5rem',whiteSpace:'nowrap'}}>
              {instList.length > 0 && (
                <button
                  onClick={() => kind === 'fasta' ? assignToInstrument(entry.name, undefined) : assignToInstrument(undefined, entry.name)}
                  title={`Assign to ${curInst.name || 'instrument'}`}
                  style={{padding:'0.15rem 0.45rem',fontSize:'0.72rem',borderRadius:'0.25rem',cursor:'pointer',marginRight:'0.3rem',
                          background: isActive ? 'rgba(218,170,0,0.15)' : 'var(--surface)',
                          color: isActive ? 'var(--accent)' : 'var(--muted)',
                          border:`1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`}}>
                  {isActive ? '✓ Active' : 'Use'}
                </button>
              )}
              <button onClick={() => handleDelete(entry.name, kind)}
                style={{padding:'0.15rem 0.4rem',fontSize:'0.72rem',borderRadius:'0.25rem',cursor:'pointer',
                        background:'none',color:'var(--fail)',border:'1px solid var(--fail)'}}>✕</button>
            </td>
          </tr>
        );
      }

      function DlStatusBadge({ job }) {
        if (!job) return null;
        if (job.status === 'done') return <span style={{color:'var(--pass)',fontSize:'0.7rem'}}>✓ saved</span>;
        if (job.status === 'failed') return <span style={{color:'var(--fail)',fontSize:'0.7rem'}} title={job.error}>✗ failed</span>;
        const label = {queued:'queued',downloading:'↓ downloading',adding_decoys:'building decoys',saving:'saving'}[job.status] || job.status;
        return (
          <span style={{color:'#60a5fa',fontSize:'0.7rem'}}>
            <span style={{display:'inline-block',animation:'spin 1.2s linear infinite',marginRight:'0.2rem'}}>↻</span>
            {label}{job.progress > 0 ? ` ${job.progress}%` : ''}
          </span>
        );
      }

      const ORGANISM_ORDER = ['human','mouse','yeast','ecoli','plasma','zebrafish','celegans','arabidopsis'];

      return (
        <div className="card" style={{marginBottom:'1rem'}}>
          <h3>FASTA Databases &amp; Spectral Libraries</h3>

          {/* Engine compatibility legend */}
          <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',fontSize:'0.75rem',color:'var(--muted)',marginBottom:'1rem',
                       padding:'0.6rem 0.75rem',background:'var(--bg)',borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
            <span style={{fontWeight:600,color:'var(--text)'}}>Used by each engine:</span>
            {[
              {e:'DIA-NN',   fasta:true,  lib:true,  note:'FASTA + library required'},
              {e:'Sage',     fasta:true,  lib:false, note:'FASTA only'},
              {e:'MSFragger',fasta:true,  lib:false, note:'FASTA only'},
              {e:'X!Tandem', fasta:true,  lib:false, note:'FASTA only'},
            ].map(({e,fasta,lib,note}) => (
              <span key={e} title={note}>
                <span style={{color:'var(--text)',fontWeight:500}}>{e}:</span>{' '}
                <span style={{color: fasta ? 'var(--pass)' : 'var(--muted)'}}>FASTA</span>{' '}
                <span style={{color: lib   ? 'var(--pass)' : 'var(--border)'}}>Library</span>
              </span>
            ))}
          </div>

          {/* Instrument selector */}
          {instList.length > 0 && (
            <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.85rem',flexWrap:'wrap'}}>
              <span style={{color:'var(--muted)',fontSize:'0.82rem'}}>Active instrument:</span>
              <select value={selInst} onChange={e => setSelInst(Number(e.target.value))} style={selStyle}>
                {instList.map((inst, i) => <option key={i} value={i}>{inst.name || `Instrument ${i+1}`}</option>)}
              </select>
              <span style={{fontSize:'0.75rem',color:'var(--muted)'}}>
                FASTA: <span style={{color:curFasta?'var(--accent)':'var(--muted)'}}>{curFasta || 'none'}</span>
                {' · '}
                Library: <span style={{color:curLib?'var(--accent)':'var(--muted)'}}>{curLib || 'none'}</span>
              </span>
            </div>
          )}

          {/* ── FASTA section ─────────────────────────────────────────────── */}
          <div style={{marginBottom:'1.25rem'}}>
            <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.6rem',flexWrap:'wrap'}}>
              <span style={{fontWeight:600,fontSize:'0.92rem',color:'var(--text)'}}>FASTA Databases</span>
              {/* UniProt download accordion toggle */}
              <button onClick={() => setShowDl(v => !v)}
                style={{padding:'0.2rem 0.65rem',fontSize:'0.78rem',borderRadius:'0.35rem',cursor:'pointer',
                        background: showDl ? 'rgba(218,170,0,0.15)' : 'var(--surface)',
                        color: showDl ? 'var(--accent)' : 'var(--muted)',
                        border:`1px solid ${showDl ? 'var(--accent)' : 'var(--border)'}`}}>
                {showDl ? '▼' : '▶'} Download from UniProt
              </button>
              <label style={{display:'inline-flex',alignItems:'center',gap:'0.35rem',padding:'0.2rem 0.65rem',
                             background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'0.35rem',
                             cursor:'pointer',fontSize:'0.78rem',color:'var(--muted)'}}>
                {uploading.fasta ? '↻ Uploading…' : '+ Upload .fasta'}
                <input type="file" accept=".fasta,.fa,.fas,.faa" style={{display:'none'}}
                       onChange={e => handleUpload(e, 'fasta')} disabled={!!uploading.fasta} />
              </label>
            </div>

            {/* UniProt download panel */}
            {showDl && (
              <div style={{marginBottom:'0.75rem',padding:'0.75rem',background:'var(--bg)',
                           borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.6rem',flexWrap:'wrap'}}>
                  <span style={{fontSize:'0.8rem',color:'var(--muted)'}}>
                    Downloads reviewed (Swiss-Prot) sequences from UniProt and appends{' '}
                    <code style={{color:'var(--accent)'}}>rev_</code> decoys automatically.
                    Human covers plasma proteome analysis.
                  </span>
                  <label style={{display:'flex',alignItems:'center',gap:'0.3rem',cursor:'pointer',fontSize:'0.78rem',color:'var(--muted)',marginLeft:'auto'}}>
                    <input type="checkbox" checked={reviewedOnly} onChange={e => setReviewedOnly(e.target.checked)}
                           style={{accentColor:'var(--accent)'}} />
                    Reviewed only (recommended)
                  </label>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:'0.4rem'}}>
                  {ORGANISM_ORDER.filter(k => organisms[k]).map(key => {
                    const org = organisms[key];
                    const job = dlJobs[key];
                    const busy = job && (job.status === 'queued' || job.status === 'downloading' || job.status === 'adding_decoys' || job.status === 'saving');
                    // Check if already downloaded today (file exists in fastas list)
                    const alreadyHave = fastas.some(f => f.name.startsWith(key + '_'));
                    return (
                      <div key={key} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'0.4rem',padding:'0.5rem 0.6rem'}}>
                        <div style={{fontWeight:600,fontSize:'0.82rem',color:'var(--text)',marginBottom:'0.1rem'}}>{org.label}</div>
                        <div style={{fontSize:'0.7rem',color:'var(--muted)',marginBottom:'0.35rem',fontStyle:'italic'}}>{org.taxon}</div>
                        <div style={{fontSize:'0.68rem',color:'var(--muted)',marginBottom:'0.4rem'}}>~{(org.n_reviewed/1000).toFixed(0)}k proteins</div>
                        {job ? <DlStatusBadge job={job} /> : alreadyHave ? (
                          <span style={{fontSize:'0.7rem',color:'var(--pass)'}}>✓ have file</span>
                        ) : null}
                        <button disabled={!!busy} onClick={() => startDownload(key)}
                          style={{marginTop:'0.3rem',display:'block',width:'100%',padding:'0.25rem 0',fontSize:'0.75rem',
                                  borderRadius:'0.3rem',cursor:busy?'wait':'pointer',fontWeight:600,
                                  background: busy ? 'var(--border)' : alreadyHave ? 'var(--surface)' : 'rgba(218,170,0,0.2)',
                                  color: busy ? 'var(--muted)' : 'var(--accent)',
                                  border:`1px solid ${busy ? 'var(--border)' : 'var(--accent)'}`,opacity: busy?0.6:1}}>
                          {busy ? 'Downloading…' : alreadyHave ? 'Re-download' : 'Download'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* FASTA file table */}
            {fastas.length === 0 ? (
              <div style={{color:'var(--muted)',fontSize:'0.82rem',padding:'0.4rem 0'}}>No FASTA databases yet — download one above or upload your own.</div>
            ) : (
              <div style={{overflowX:'auto',borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
                <table style={{width:'100%',fontSize:'0.82rem',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'rgba(2,40,81,0.8)'}}>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>File</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Size</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Downloaded / Uploaded</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Action</th>
                    </tr>
                  </thead>
                  <tbody>{fastas.map(f => <FileRow key={f.name} entry={f} kind="fasta" />)}</tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Spectral Library section ───────────────────────────────────── */}
          <div>
            <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.6rem',flexWrap:'wrap'}}>
              <span style={{fontWeight:600,fontSize:'0.92rem',color:'var(--text)'}}>Spectral Libraries</span>
              <button onClick={() => setShowLibSrc(v => !v)}
                style={{padding:'0.2rem 0.65rem',fontSize:'0.78rem',borderRadius:'0.35rem',cursor:'pointer',
                        background: showLibSrc ? 'rgba(218,170,0,0.15)' : 'var(--surface)',
                        color: showLibSrc ? 'var(--accent)' : 'var(--muted)',
                        border:`1px solid ${showLibSrc ? 'var(--accent)' : 'var(--border)'}`}}>
                {showLibSrc ? '▼' : '▶'} Where to get libraries
              </button>
              <label style={{display:'inline-flex',alignItems:'center',gap:'0.35rem',padding:'0.2rem 0.65rem',
                             background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'0.35rem',
                             cursor:'pointer',fontSize:'0.78rem',color:'var(--muted)'}}>
                {uploading.lib ? '↻ Uploading…' : '+ Upload library'}
                <input type="file" accept=".parquet,.speclib,.tsv,.csv,.txt" style={{display:'none'}}
                       onChange={e => handleUpload(e, 'lib')} disabled={!!uploading.lib} />
              </label>
              <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>
                .parquet · .speclib · .tsv · .csv — used by DIA-NN only
              </span>
            </div>

            {/* Library sources panel */}
            {showLibSrc && presets.length > 0 && (
              <div style={{marginBottom:'0.75rem',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'0.5rem'}}>
                {presets.map((p, i) => (
                  <div key={i} style={{padding:'0.65rem 0.75rem',background:'var(--bg)',borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
                    <div style={{fontWeight:600,fontSize:'0.82rem',color:'var(--accent)',marginBottom:'0.25rem'}}>{p.source}</div>
                    <div style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.35rem',lineHeight:1.4}}>{p.description}</div>
                    <div style={{fontSize:'0.7rem',color:'var(--muted)',marginBottom:'0.3rem'}}>
                      Format: <code style={{color:'var(--text)'}}>{p.format}</code>
                      {' · '}Instrument: <span style={{color:'var(--text)'}}>{p.instrument}</span>
                    </div>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                         style={{fontSize:'0.75rem',color:'#60a5fa',textDecoration:'none'}}>
                        ↗ {p.url_label}
                      </a>
                    ) : (
                      <span style={{fontSize:'0.75rem',color:'var(--pass)'}}>{p.url_label}</span>
                    )}
                    {p.how_to_get === 'browser_download' && (
                      <div style={{fontSize:'0.68rem',color:'var(--muted)',marginTop:'0.25rem'}}>
                        Download in browser → upload with button above
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {libs.length === 0 ? (
              <div style={{color:'var(--muted)',fontSize:'0.82rem',padding:'0.4rem 0'}}>No spectral libraries yet — download from one of the sources above and upload.</div>
            ) : (
              <div style={{overflowX:'auto',borderRadius:'0.4rem',border:'1px solid var(--border)'}}>
                <table style={{width:'100%',fontSize:'0.82rem',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'rgba(2,40,81,0.8)'}}>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>File</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Size</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Downloaded / Uploaded</th>
                      <th style={{padding:'0.35rem 0.5rem',textAlign:'left',color:'var(--muted)',fontWeight:600}}>Action</th>
                    </tr>
                  </thead>
                  <tbody>{libs.map(l => <FileRow key={l.name} entry={l} kind="lib" />)}</tbody>
                </table>
              </div>
            )}
          </div>

          {libMsg && (
            <div style={{marginTop:'0.75rem',fontSize:'0.82rem',
                         color: libMsg.includes('fail') || libMsg.includes('Error') ? 'var(--fail)' : 'var(--pass)'}}>
              {libMsg}
            </div>
          )}
        </div>
      );
    }

    function ConfigEditor() {
      const { data: instruments, reload: reloadInst } = useFetch('/api/instruments');
      const { data: thresholds, reload: reloadThr } = useFetch('/api/thresholds');
      const [instYaml, setInstYaml] = useState('');
      const [thrYaml, setThrYaml] = useState('');
      const [msg, setMsg] = useState('');
      const [showAdvanced, setShowAdvanced] = useState(false);

      useEffect(() => { if (instruments) setInstYaml(jsyaml(instruments)); }, [instruments]);
      useEffect(() => { if (thresholds) setThrYaml(jsyaml(thresholds)); }, [thresholds]);

      function jsyaml(obj) { return JSON.stringify(obj, null, 2); }

      async function saveInstruments() {
        setMsg('Saving...');
        const r = await fetch(API + '/api/instruments', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ yaml_content: instYaml }) });
        setMsg(r.ok ? 'Instruments saved.' : 'Error saving instruments.');
        reloadInst();
      }
      async function saveThresholds() {
        setMsg('Saving...');
        const r = await fetch(API + '/api/thresholds', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ yaml_content: thrYaml }) });
        setMsg(r.ok ? 'Thresholds saved.' : 'Error saving thresholds.');
        reloadThr();
      }

      // Parse instruments for a friendly summary
      const instList = instruments?.instruments || [];

      return (
        <div>
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Your Instruments</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              STAN auto-detects most settings from your raw files. The only things you configure
              are the watch directory, LC column, and HeLa amount. To change these, edit the
              values below or re-run <code style={{color:'var(--accent)'}}>stan setup</code>.
            </p>
            {instList.length === 0 ? (
              <p style={{color:'var(--warn)'}}>No instruments configured. Run <code>stan setup</code> to add one.</p>
            ) : (
              <div className="grid">
                {instList.map((inst, i) => (
                  <div key={i} style={{padding:'0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', position:'relative'}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem'}}>
                      <div style={{fontWeight:700, color:'var(--accent)'}}>
                        {inst.name || 'auto'}
                        {inst.model && <span style={{fontWeight:400, color:'var(--muted)'}}> ({inst.model})</span>}
                      </div>
                      {instList.length > 1 && (
                        <button onClick={async () => {
                          if (!confirm('Remove this instrument from config?')) return;
                          const r = await fetch(API + '/api/instruments/' + i, { method: 'DELETE' });
                          if (r.ok) { setMsg('Instrument removed.'); reloadInst(); }
                          else setMsg('Error removing instrument.');
                        }} style={{background:'none', border:'1px solid var(--fail)', color:'var(--fail)', borderRadius:'0.25rem', padding:'0.15rem 0.5rem', cursor:'pointer', fontSize:'0.75rem'}} title="Remove this instrument">Remove</button>
                      )}
                    </div>
                    <div className="metric"><span className="metric-label">Watch directory</span><span className="metric-value" style={{fontSize:'0.8rem', wordBreak:'break-all'}}>{inst.watch_dir || '(not set)'}</span></div>
                    <div className="metric"><span className="metric-label">LC Column</span><span className="metric-value">{[inst.column_vendor, inst.column_model].filter(Boolean).join(' ') || '(not set)'}</span></div>
                    <div className="metric"><span className="metric-label">HeLa amount</span><span className="metric-value">{inst.hela_amount_ng || 50} ng</span></div>
                    <div className="metric"><span className="metric-label">Community</span><span className="metric-value">{inst.community_submit ? 'Yes' : 'No'}</span></div>
                    {inst.spd && <div className="metric"><span className="metric-label">SPD</span><span className="metric-value">{inst.spd}</span></div>}
                    <div className="metric"><span className="metric-label">Status</span><span className="metric-value" style={{color: inst.enabled !== false ? 'var(--pass)' : 'var(--fail)'}}>{inst.enabled !== false ? 'Enabled' : 'Disabled'}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <LibraryManager instruments={instruments} onAssigned={reloadInst} />

          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Quick Actions</h3>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginBottom:'0.75rem'}}>
              Run these commands in a terminal on this machine.
            </p>
            <div style={{display:'flex', gap:'0.5rem', flexWrap:'wrap'}}>
              <div style={{padding:'0.5rem 0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', fontSize:'0.85rem'}}>
                <code style={{color:'var(--accent)'}}>stan setup</code>
                <span style={{color:'var(--muted)', marginLeft:'0.5rem'}}>- reconfigure instrument</span>
              </div>
              <div style={{padding:'0.5rem 0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', fontSize:'0.85rem'}}>
                <code style={{color:'var(--accent)'}}>stan baseline</code>
                <span style={{color:'var(--muted)', marginLeft:'0.5rem'}}>- build QC history from existing files</span>
              </div>
              <div style={{padding:'0.5rem 0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', fontSize:'0.85rem'}}>
                <code style={{color:'var(--accent)'}}>stan log Exploris column-change</code>
                <span style={{color:'var(--muted)', marginLeft:'0.5rem'}}>- record maintenance event</span>
              </div>
              <div style={{padding:'0.5rem 0.75rem', background:'var(--bg)', borderRadius:'0.5rem', border:'1px solid var(--border)', fontSize:'0.85rem'}}>
                <code style={{color:'var(--accent)'}}>stan email-report --test</code>
                <span style={{color:'var(--muted)', marginLeft:'0.5rem'}}>- send a test QC email</span>
              </div>
            </div>
          </div>

          <div style={{marginBottom:'0.5rem'}}>
            <span onClick={() => setShowAdvanced(!showAdvanced)} style={{cursor:'pointer', color:'var(--muted)', fontSize:'0.85rem'}}>
              {showAdvanced ? '▼' : '▶'} Advanced: edit raw YAML config files
            </span>
          </div>
          {showAdvanced && (
            <div className="grid">
              <div className="card">
                <h3>instruments.yml</h3>
                <p style={{color:'var(--muted)', fontSize:'0.75rem', marginBottom:'0.5rem'}}>Instrument watch directories and settings. Hot-reloaded every 30 seconds.</p>
                <textarea value={instYaml} onChange={e => setInstYaml(e.target.value)} />
                <button onClick={saveInstruments} style={{marginTop: '0.5rem'}}>Save Instruments</button>
              </div>
              <div className="card">
                <h3>thresholds.yml</h3>
                <p style={{color:'var(--muted)', fontSize:'0.75rem', marginBottom:'0.5rem'}}>QC pass/warn/fail thresholds per instrument model.</p>
                <textarea value={thrYaml} onChange={e => setThrYaml(e.target.value)} />
                <button onClick={saveThresholds} style={{marginTop: '0.5rem'}}>Save Thresholds</button>
              </div>
              {msg && <div className="status-msg">{msg}</div>}
            </div>
          )}
        </div>
      );
    }

    /* ── CCS Tab ────────────────────────────────────────────────────── */
