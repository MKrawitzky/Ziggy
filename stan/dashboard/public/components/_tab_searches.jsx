    // ══════════════════════════════════════════════════════════════════════════
    // Searches Tab
    // ══════════════════════════════════════════════════════════════════════════

    const SAMPLE_TYPES  = ['', 'QC', 'Sample', 'Blank', 'Standard', 'Pool'];
    const WORKFLOWS     = ['', 'Standard', 'Immunopeptidomics', 'Single Cell', 'Training', 'Phospho', 'Glyco', 'Crosslink'];
    const SAMPLE_COLORS = { QC:'#22d3ee', Sample:'#4ade80', Blank:'#94a3b8', Standard:'#DAAA00', Pool:'#a855f7' };
    const WORKFLOW_COLORS = {
      Standard:'#60a5fa', Immunopeptidomics:'#f97316', 'Single Cell':'#d946ef',
      Training:'#DAAA00', Phospho:'#f43f5e', Glyco:'#4ade80', Crosslink:'#a855f7',
    };
    const ENGINE_COLOR = { diann:'#60a5fa', sage:'#34d399', unknown:'#a0b4cc' };
    const MODE_COLOR   = { DIA:'#00d4e0', diaPASEF:'#a78bfa', DDA:'#fbbf24', ddaPASEF:'#fb923c' };

    function _sBadge(text, color) {
      if (!text) return null;
      return React.createElement('span',{style:{
        padding:'0.1rem 0.4rem',borderRadius:'0.25rem',fontSize:'0.68rem',fontWeight:700,
        background:color+'22',color,border:`1px solid ${color}44`,whiteSpace:'nowrap',
      }},text);
    }

    // ── Inline instrument name editor ─────────────────────────────────────────
    function InstrumentCell({ runId, value, onSaved }) {
      const [editing, setEditing] = React.useState(false);
      const [draft,   setDraft]   = React.useState(value || '');
      const [saving,  setSaving]  = React.useState(false);
      const inputRef = React.useRef(null);

      React.useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

      const isAuto = !value || ['auto','unknown','instrument','none',''].includes((value||'').toLowerCase().trim());

      const save = async () => {
        const name = draft.trim();
        if (!name || name === value) { setEditing(false); return; }
        setSaving(true);
        try {
          await fetch(`/api/runs/${runId}/instrument`, {
            method: 'PATCH',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({instrument: name}),
          });
          setEditing(false);
          if (onSaved) onSaved();
        } catch(e) { console.error(e); }
        setSaving(false);
      };

      if (editing) {
        return React.createElement('span', {style:{display:'inline-flex',gap:'0.2rem',alignItems:'center'}},
          React.createElement('input', {
            ref: inputRef, value: draft,
            onChange: e => setDraft(e.target.value),
            onKeyDown: e => { if (e.key==='Enter') save(); if (e.key==='Escape') setEditing(false); },
            style:{width:'130px',fontSize:'0.72rem',padding:'0.15rem 0.35rem',
              background:'var(--bg)',color:'var(--text)',border:'1px solid var(--accent)',
              borderRadius:'0.25rem',outline:'none'},
          }),
          React.createElement('button', {onClick:save, disabled:saving,
            style:{fontSize:'0.65rem',padding:'0.1rem 0.3rem',background:'var(--accent)',
              color:'#000',border:'none',borderRadius:'0.2rem',cursor:'pointer'}}, '✓'),
          React.createElement('button', {onClick:()=>setEditing(false),
            style:{fontSize:'0.65rem',padding:'0.1rem 0.3rem',background:'transparent',
              color:'var(--muted)',border:'1px solid var(--border)',borderRadius:'0.2rem',cursor:'pointer'}}, '✕'),
        );
      }

      return React.createElement('span', {
        onClick: () => { setDraft(value||''); setEditing(true); },
        title: 'Click to edit instrument name',
        style:{cursor:'pointer', color: isAuto ? '#f59e0b' : 'var(--muted)',
          fontSize:'0.72rem', whiteSpace:'nowrap',
          borderBottom: isAuto ? '1px dashed #f59e0b' : '1px dashed transparent',
          padding:'0.1rem 0'},
      }, isAuto ? '⚠ ' + (value||'auto') : value);
    }

    // ── Inline annotation dropdown ────────────────────────────────────────────
    function AnnotateCell({ runId, field, value, options, colors, onSaved }) {
      const [editing, setEditing] = React.useState(false);
      const [saving,  setSaving]  = React.useState(false);

      const save = async (val) => {
        setSaving(true);
        try {
          await fetch(`/api/runs/${runId}/annotate`, {
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({[field]: val}),
          });
          onSaved && onSaved(runId, field, val);
        } finally {
          setSaving(false);
          setEditing(false);
        }
      };

      const col = colors && colors[value] || (value ? '#b899d4' : 'var(--border)');

      if (editing) {
        return React.createElement('select',{
          autoFocus:true,
          value:value||'',
          onChange:e=>save(e.target.value),
          onBlur:()=>setEditing(false),
          style:{fontSize:'0.72rem',background:'var(--surface)',color:'var(--text)',
                 border:'1px solid var(--accent)',borderRadius:4,padding:'0.1rem 0.25rem'},
        }, options.map(o=>React.createElement('option',{key:o,value:o},o||'— none —')));
      }

      return React.createElement('span',{
        onClick:()=>setEditing(true),
        title:`Click to set ${field}`,
        style:{cursor:'pointer',display:'inline-block'},
      },
        saving
          ? React.createElement('span',{style:{color:'var(--muted)',fontSize:'0.68rem'}},'…')
          : value
            ? _sBadge(value, col)
            : React.createElement('span',{style:{color:'var(--border)',fontSize:'0.68rem',userSelect:'none'}},'+ set'),
      );
    }

    // ── Run comparison button (per-row) ──────────────────────────────────────
    function RunCompareBtn({ runId, onDone }) {
      const [state, setState] = React.useState('idle');  // idle | running | ok | err

      const run = async () => {
        setState('running');
        try {
          const r = await fetch(`/api/runs/${runId}/compare`, { method: 'POST' });
          const d = await r.json();
          setState(d.ok ? 'ok' : 'err');
          if (d.ok && onDone) setTimeout(onDone, 3000);
        } catch {
          setState('err');
        }
      };

      if (state === 'running') return React.createElement('span',{style:{color:'#60a5fa',fontSize:'0.7rem'}},'↻');
      if (state === 'ok')      return React.createElement('span',{style:{color:'#4ade80',fontSize:'0.7rem'}},'✓');
      if (state === 'err')     return React.createElement('span',{style:{color:'#ef4444',fontSize:'0.7rem'}},'✗');
      return React.createElement('button',{
        onClick: run,
        title: 'Re-run MSFragger, X!Tandem, MaxQuant comparisons for this run',
        style:{fontSize:'0.68rem',padding:'1px 5px',cursor:'pointer',borderRadius:3,
          background:'var(--surface)',color:'var(--muted)',border:'1px solid var(--border)'},
      },'⚡');
    }

    // ── Search parameter modal (for missing mods / enzyme / FASTA config) ────
    function SearchParamModal({ onClose }) {
      const [cfg, setCfg] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const [saved, setSaved] = React.useState(false);

      React.useEffect(() => {
        fetch('/api/search-params').then(r => r.ok ? r.json() : null).then(d => {
          if (d) setCfg(d);
          else setCfg({
            enzyme: 'Trypsin/P', missed_cleavages: 2,
            var_mods: 'Oxidation (M); Acetyl (Protein N-term)',
            fixed_mods: 'Carbamidomethyl (C)',
            min_pep_len: 7, max_pep_len: 30,
            min_charge: 2, max_charge: 4,
            ms1_tol_ppm: 20, ms2_tol_ppm: 20,
            fasta_path: '', spectral_lib: '',
          });
        }).catch(() => setCfg({
          enzyme: 'Trypsin/P', missed_cleavages: 2,
          var_mods: 'Oxidation (M); Acetyl (Protein N-term)',
          fixed_mods: 'Carbamidomethyl (C)',
          min_pep_len: 7, max_pep_len: 30,
          min_charge: 2, max_charge: 4,
          ms1_tol_ppm: 20, ms2_tol_ppm: 20,
          fasta_path: '', spectral_lib: '',
        }));
      }, []);

      const save = async () => {
        setSaving(true);
        try {
          const r = await fetch('/api/search-params', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify(cfg),
          });
          if (r.ok) { setSaved(true); setTimeout(onClose, 800); }
        } finally { setSaving(false); }
      };

      const inp = (field, label, type='text', opts={}) => React.createElement('label',{
        style:{display:'flex',flexDirection:'column',gap:3,fontSize:'0.8rem',color:'var(--muted)'}
      },
        label,
        React.createElement('input',{
          type, value: cfg?.[field] ?? '',
          onChange: e => setCfg(c => ({...c, [field]: type==='number' ? +e.target.value : e.target.value})),
          style:{background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',
                 borderRadius:4,padding:'4px 8px',fontSize:'0.82rem',...(opts.style||{})},
          ...opts,
        }),
      );

      const overlayStyle = {
        position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:9000,
        display:'flex',alignItems:'center',justifyContent:'center',
      };
      const boxStyle = {
        background:'var(--surface)',border:'1.5px solid var(--border)',borderRadius:10,
        padding:'1.5rem',width:560,maxWidth:'95vw',maxHeight:'85vh',overflowY:'auto',
      };

      return React.createElement('div',{style:overlayStyle,onClick:e=>{if(e.target===e.currentTarget)onClose();}},
        React.createElement('div',{style:boxStyle},
          React.createElement('div',{style:{display:'flex',alignItems:'center',marginBottom:'1rem'}},
            React.createElement('span',{style:{fontWeight:700,fontSize:'1rem',color:'var(--accent)',flex:1}},
              'Search Parameters'),
            React.createElement('span',{style:{fontSize:'0.75rem',color:'var(--muted)',marginRight:12}},
              'Used by all comparison engines when not overridden by Config tab'),
            React.createElement('button',{onClick:onClose,
              style:{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:'1.2rem'}},
              '×'),
          ),
          !cfg ? React.createElement('div',{style:{color:'var(--muted)'}},'Loading…')
          : React.createElement('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.9rem'}},
            React.createElement('div',{style:{gridColumn:'1/-1'}},
              React.createElement('div',{style:{fontSize:'0.72rem',color:'var(--muted)',background:'rgba(218,170,0,0.06)',
                border:'1px solid rgba(218,170,0,0.2)',borderRadius:6,padding:'6px 10px',marginBottom:8}},
                '⚙ These defaults apply when the Config tab has no instrument-specific FASTA / library assigned. ' +
                'MSFragger, X!Tandem, and MaxQuant use enzyme + mods from here. ' +
                'DIA-NN and Sage use community assets unless overridden per instrument.'),
            ),
            inp('enzyme', 'Enzyme'),
            inp('missed_cleavages', 'Missed cleavages', 'number', {min:0,max:4}),
            React.createElement('div',{style:{gridColumn:'1/-1'}},
              inp('var_mods', 'Variable modifications', 'text',
                {style:{width:'100%'}, placeholder:'Oxidation (M); Acetyl (Protein N-term)'})),
            React.createElement('div',{style:{gridColumn:'1/-1'}},
              inp('fixed_mods', 'Fixed modifications', 'text',
                {style:{width:'100%'}, placeholder:'Carbamidomethyl (C)'})),
            inp('min_pep_len', 'Min peptide length', 'number', {min:4,max:15}),
            inp('max_pep_len', 'Max peptide length', 'number', {min:15,max:60}),
            inp('min_charge', 'Min charge', 'number', {min:1,max:3}),
            inp('max_charge', 'Max charge', 'number', {min:2,max:6}),
            inp('ms1_tol_ppm', 'MS1 tolerance (ppm)', 'number', {min:1,max:50}),
            inp('ms2_tol_ppm', 'MS2 tolerance (ppm)', 'number', {min:1,max:50}),
            React.createElement('div',{style:{gridColumn:'1/-1'}},
              inp('fasta_path', 'Default FASTA path (optional — overrides community FASTA)',
                'text', {style:{width:'100%'}, placeholder:'C:/path/to/human.fasta'})),
            React.createElement('div',{style:{gridColumn:'1/-1'}},
              inp('spectral_lib', 'Spectral library path (DIA-NN --lib, optional)',
                'text', {style:{width:'100%'}, placeholder:'C:/path/to/library.parquet'})),
            React.createElement('div',{style:{gridColumn:'1/-1',display:'flex',gap:8,justifyContent:'flex-end',marginTop:4}},
              React.createElement('button',{onClick:onClose,
                style:{padding:'6px 16px',borderRadius:5,cursor:'pointer',fontSize:'0.82rem',
                  background:'var(--surface)',color:'var(--muted)',border:'1px solid var(--border)'}},
                'Cancel'),
              React.createElement('button',{onClick:save,disabled:saving||saved,
                style:{padding:'6px 20px',borderRadius:5,cursor:'pointer',fontSize:'0.82rem',fontWeight:700,
                  background:saved?'#4ade80':saving?'var(--surface)':'var(--accent)',
                  color:saved||saving?'var(--muted)':'var(--bg)',
                  border:`1px solid ${saved?'#4ade80':'var(--accent)'}`}},
                saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'),
            ),
          ),
        ),
      );
    }

    // ── Unsearched panel ─────────────────────────────────────────────────────
    function UnsearchedPanel({ onSearched }) {
      const [data, setData]   = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [queueing, setQueueing] = React.useState(false);
      const [result, setResult]   = React.useState(null);

      const load = () => {
        setLoading(true);
        fetch('/api/unsearched-runs').then(r=>r.json())
          .then(d=>{ setData(d); setLoading(false); })
          .catch(()=>setLoading(false));
      };

      React.useEffect(()=>{ load(); }, []);

      const queueAll = async () => {
        if (!window.confirm(`Queue ${data?.count} unsearched runs for DIA-NN / Sage search?\n\nThis will start search jobs in the background — it may slow the system. You can check status in the table below.`)) return;
        setQueueing(true);
        try {
          const r = await fetch('/api/process-all-new', {method:'POST'});
          const d = await r.json();
          setResult(d);
          load();
          onSearched && onSearched();
        } finally {
          setQueueing(false);
        }
      };

      const queueOne = async (runId) => {
        await fetch(`/api/runs/${runId}/process`, {method:'POST'});
        load();
        onSearched && onSearched();
      };

      const fmtAge = (min) => {
        if (min == null) return '?';
        if (min < 60) return `${min}m`;
        if (min < 1440) return `${(min/60).toFixed(1)}h`;
        return `${(min/1440).toFixed(1)}d`;
      };

      return React.createElement('div',{style:{
        background:'rgba(217,70,239,0.05)',border:'1px solid rgba(217,70,239,0.2)',
        borderRadius:8,padding:'12px 16px',marginBottom:12,
      }},
        React.createElement('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap'}},
          React.createElement('span',{style:{fontWeight:700,fontSize:13,color:'#d946ef'}},'Unsearched Runs'),
          data && React.createElement('span',{style:{
            background:'rgba(217,70,239,0.2)',color:'#d946ef',borderRadius:12,
            padding:'1px 8px',fontSize:11,fontWeight:700,
          }},data.count),
          React.createElement('span',{style:{fontSize:11,color:'var(--muted)',marginLeft:4}},
            'Files in DB with no search results yet'
          ),
          React.createElement('div',{style:{marginLeft:'auto',display:'flex',gap:6}},
            React.createElement('button',{onClick:load,
              style:{padding:'4px 10px',fontSize:11,cursor:'pointer',borderRadius:4,
                background:'var(--surface)',color:'var(--muted)',border:'1px solid var(--border)'}},
              '↻ Refresh'),
            data?.count > 0 && React.createElement('button',{
              onClick:queueAll, disabled:queueing,
              style:{padding:'4px 14px',fontSize:11,cursor:'pointer',borderRadius:4,fontWeight:700,
                background:queueing?'var(--surface)':'#d946ef',
                color:queueing?'var(--muted)':'#0e0018',
                border:'1px solid #d946ef'}},
              queueing ? '⋯ Queuing…' : `▶ Search All (${data?.count})`),
          ),
        ),

        result && React.createElement('div',{style:{fontSize:11,color:'#4ade80',marginBottom:8}},
          `✓ Queued ${result.queued} runs · ${result.skipped_no_file||0} skipped (file not found)`),

        loading && React.createElement('div',{style:{fontSize:11,color:'var(--muted)'}},'Loading…'),

        data?.runs?.length > 0 && React.createElement('div',{style:{overflowX:'auto',maxHeight:200}},
          React.createElement('table',{style:{fontSize:'0.75rem',width:'100%'}},
            React.createElement('thead',null,
              React.createElement('tr',{style:{color:'var(--muted)'}},
                React.createElement('th',{style:{textAlign:'left',paddingRight:12}},'Run'),
                React.createElement('th',{style:{textAlign:'left',paddingRight:8}},'Mode'),
                React.createElement('th',{style:{paddingRight:8}},'Age'),
                React.createElement('th',{style:{paddingRight:8}},'File'),
                React.createElement('th',{style:{paddingRight:8}},'Status'),
                React.createElement('th',null,''),
              ),
            ),
            React.createElement('tbody',null,
              data.runs.slice(0,30).map(r=>
                React.createElement('tr',{key:r.id,style:{borderBottom:'1px solid var(--border)'}},
                  React.createElement('td',{style:{maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:12,paddingTop:3,paddingBottom:3}},
                    r.run_name),
                  React.createElement('td',{style:{paddingRight:8}},
                    _sBadge(r.mode, MODE_COLOR[r.mode]||'#94a3b8')),
                  React.createElement('td',{style:{textAlign:'right',paddingRight:8,
                    color: r.age_minutes > 4320 ? '#f43f5e' : r.age_minutes > 1440 ? '#DAAA00' : 'var(--muted)'}},
                    fmtAge(r.age_minutes)),
                  React.createElement('td',{style:{paddingRight:8,textAlign:'center'}},
                    r.raw_exists ? '✓' : React.createElement('span',{style:{color:'#ef4444'}},'✗')),
                  React.createElement('td',{style:{paddingRight:8}},
                    r.status !== 'idle' ? _sBadge(r.status, r.status==='running'?'#60a5fa':r.status==='queued'?'#DAAA00':'#94a3b8') : null),
                  React.createElement('td',null,
                    r.raw_exists && r.status==='idle' && React.createElement('button',{
                      onClick:()=>queueOne(r.id),
                      style:{fontSize:10,padding:'1px 6px',cursor:'pointer',borderRadius:3,
                        background:'var(--surface)',color:'var(--accent)',border:'1px solid var(--accent)'}},
                      '▶')),
                )
              ),
              data.count > 30 && React.createElement('tr',null,
                React.createElement('td',{colSpan:6,style:{color:'var(--muted)',fontSize:11,padding:4}},
                  `… and ${data.count-30} more`))
            ),
          ),
        ),

        data?.count === 0 && !loading && React.createElement('div',{style:{fontSize:11,color:'#4ade80'}},
          '✓ All runs have been searched'),
      );
    }

    // ── Auto-search scheduler panel ──────────────────────────────────────────
    function AutoSearchPanel() {
      const [cfg, setCfg]     = React.useState(null);
      const [saving, setSaving] = React.useState(false);

      const load = () => {
        fetch('/api/auto-search/config').then(r=>r.json()).then(setCfg).catch(()=>{});
      };
      React.useEffect(()=>{ load(); }, []);

      const save = async (patch) => {
        setSaving(true);
        const r = await fetch('/api/auto-search/config',{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
        const d = await r.json();
        setCfg(d);
        setSaving(false);
      };

      if (!cfg) return null;

      const inpStyle = {
        background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',
        borderRadius:4,padding:'3px 8px',fontSize:12,width:60,
      };

      return React.createElement('div',{style:{
        background:'rgba(34,211,238,0.04)',border:'1px solid rgba(34,211,238,0.15)',
        borderRadius:8,padding:'10px 14px',marginBottom:12,
        display:'flex',alignItems:'center',gap:16,flexWrap:'wrap',
      }},
        React.createElement('span',{style:{fontWeight:700,fontSize:12,color:'#22d3ee'}},'Auto-Search Scheduler'),
        // Enable toggle
        React.createElement('label',{style:{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12}},
          React.createElement('input',{type:'checkbox',checked:cfg.enabled,
            onChange:e=>save({enabled:e.target.checked})}),
          React.createElement('span',{style:{color:cfg.enabled?'#4ade80':'var(--muted)'}},
            cfg.enabled ? 'Enabled' : 'Disabled'),
        ),
        cfg.enabled && React.createElement(React.Fragment,null,
          // Delay
          React.createElement('label',{style:{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--muted)'}},
            'Search files after',
            React.createElement('input',{type:'number',value:cfg.delay_minutes,min:5,max:1440,
              style:inpStyle,
              onChange:e=>save({delay_minutes:parseInt(e.target.value)||60})}),
            'min waiting'),
          // Quiet window
          React.createElement('label',{style:{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--muted)'}},
            'Quiet:',
            React.createElement('input',{type:'number',value:cfg.quiet_start??'',min:0,max:23,
              placeholder:'from',style:{...inpStyle,width:44},
              onChange:e=>save({quiet_start:e.target.value===''?null:parseInt(e.target.value)})}),
            '–',
            React.createElement('input',{type:'number',value:cfg.quiet_end??'',min:0,max:23,
              placeholder:'to',style:{...inpStyle,width:44},
              onChange:e=>save({quiet_end:e.target.value===''?null:parseInt(e.target.value)})}),
            React.createElement('span',{style:{fontSize:10}},'h (leave blank = always active)'),
          ),
        ),
        cfg.last_run && React.createElement('span',{style:{fontSize:10,color:'var(--muted)',marginLeft:'auto'}},
          `Last checked: ${new Date(cfg.last_run).toLocaleTimeString()} · queued: ${cfg.last_queued||0}`),
        saving && React.createElement('span',{style:{fontSize:10,color:'var(--muted)'}},'saving…'),
      );
    }

    // ── Main component ───────────────────────────────────────────────────────
    function SearchesTab() {
      const [view, setView]         = React.useState('compare');
      const [searches, setSearches] = React.useState(null);
      const [loading, setLoading]   = React.useState(true);
      const [localAnnotations, setLocalAnnotations] = React.useState({});  // runId → {sample_type, workflow}
      const [showParamModal, setShowParamModal] = React.useState(false);
      const [fixNamesState, setFixNamesState] = React.useState('idle');  // idle | running | done | err

      const fetchData = React.useCallback(() => {
        fetch('/api/searches?limit=2000')
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setSearches(d); setLoading(false); })
          .catch(() => setLoading(false));
      }, []);

      React.useEffect(() => { fetchData(); }, [fetchData]);

      // Poll while any comparison is in-flight
      React.useEffect(() => {
        const hasInFlight = (searches||[]).some(s => {
          const c = s.comparisons || {};
          return Object.values(c).some(v => v.status === 'running' || v.status === 'pending');
        });
        if (!hasInFlight) return;
        const t = setInterval(fetchData, 8000);
        return () => clearInterval(t);
      }, [searches, fetchData]);

      const onAnnotationSaved = React.useCallback((runId, field, val) => {
        setLocalAnnotations(prev => ({
          ...prev,
          [runId]: { ...(prev[runId]||{}), [field]: val },
        }));
      }, []);

      // ── filter / sort state ───────────────────────────────────────────────
      const [sortCol, setSortCol]     = React.useState('run_date');
      const [sortDir, setSortDir]     = React.useState(-1);
      const [filterMode, setFilterMode] = React.useState('all');
      const [filterInst, setFilterInst] = React.useState('all');
      const [filterStype, setFilterStype] = React.useState('all');
      const [filterWflow, setFilterWflow] = React.useState('all');
      const [search, setSearch]       = React.useState('');

      const [sortColD, setSortColD]   = React.useState('run_date');
      const [sortDirD, setSortDirD]   = React.useState(-1);
      const [showCols, setShowCols]   = React.useState({
        engine:true,version:false,library:true,threads:false,
        sampletype:true,workflow:true,
        precursors:true,peptides:true,proteins:true,
        ms1acc:true,ms2acc:false,fwhm:false,
        ms1sig:false,ms2sig:false,charge:false,mc:false,gate:true,date:true,
      });

      const modes  = React.useMemo(() => [...new Set((searches||[]).map(s=>s.mode).filter(Boolean))], [searches]);
      const insts  = React.useMemo(() => [...new Set((searches||[]).map(s=>s.instrument).filter(Boolean))], [searches]);
      const stypes = React.useMemo(() => [...new Set((searches||[]).map(s=>s.sample_type).filter(Boolean))], [searches]);
      const wflows = React.useMemo(() => [...new Set((searches||[]).map(s=>s.workflow).filter(Boolean))], [searches]);

      const selStyle = {padding:'0.3rem 0.5rem',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'0.4rem',color:'var(--text)',fontSize:'0.82rem'};

      function fmtN(v)    { return v != null ? (+v).toLocaleString() : '—'; }
      function fmtPpm(v)  { return v != null ? (v>=0?'+':'')+v.toFixed(2)+' ppm' : '—'; }
      function fmtFwhm(v) { return v != null ? (v*60).toFixed(0)+' s' : '—'; }
      function fmtSig(v)  {
        if (v==null) return '—';
        if (v>=1e12) return (v/1e12).toFixed(2)+'T';
        if (v>=1e9)  return (v/1e9).toFixed(2)+'G';
        if (v>=1e6)  return (v/1e6).toFixed(1)+'M';
        return (+v).toLocaleString();
      }
      function libShort(s) {
        if (!s) return '—';
        return s.replace(/\.(parquet|speclib|tsv)$/,'').replace('hela_','').replace('timstof_','timsTOF ').replace('orbitrap_','Orbitrap ');
      }

      // Merge server data with any local annotation changes
      const mergedSearches = React.useMemo(() => {
        if (!searches) return [];
        return searches.map(s => ({
          ...s,
          ...(localAnnotations[s.id] || {}),
        }));
      }, [searches, localAnnotations]);

      const filtered = React.useMemo(() => {
        let r = mergedSearches;
        if (filterMode  !== 'all') r = r.filter(s => (s.mode||'') === filterMode);
        if (filterInst  !== 'all') r = r.filter(s => (s.instrument||'') === filterInst);
        if (filterStype !== 'all') r = r.filter(s => (s.sample_type||'') === filterStype);
        if (filterWflow !== 'all') r = r.filter(s => (s.workflow||'') === filterWflow);
        if (search) {
          const q = search.toLowerCase();
          r = r.filter(s => (s.run_name||'').toLowerCase().includes(q) || (s.instrument||'').toLowerCase().includes(q));
        }
        return r;
      }, [mergedSearches, filterMode, filterInst, filterStype, filterWflow, search]);

      const sortedRows = React.useMemo(() => {
        const col = view === 'compare' ? sortCol : sortColD;
        const dir = view === 'compare' ? sortDir : sortDirD;
        return [...filtered].sort((a,b) => {
          const av = a[col] ?? (dir===-1 ? -Infinity : Infinity);
          const bv = b[col] ?? (dir===-1 ? -Infinity : Infinity);
          return dir * (av < bv ? -1 : av > bv ? 1 : 0);
        });
      }, [filtered, view, sortCol, sortDir, sortColD, sortDirD]);

      function makeTh(col, label, title, activeCol, setActive, dir, setDir) {
        const active = activeCol === col;
        return React.createElement('th',{key:col,
          onClick:()=>{ if(active) setDir(d=>-d); else{setActive(col);setDir(-1);} },
          title,style:{cursor:'pointer',whiteSpace:'nowrap',userSelect:'none',paddingRight:'0.9rem',
            color:active?'var(--accent)':'var(--muted)',
            background:active?'rgba(218,170,0,0.07)':'transparent'}},
          label+(active?(dir===-1?' ▼':' ▲'):''));
      }

      function CompCell({ entry, metric, color }) {
        if (!entry) return React.createElement('td',{style:{textAlign:'right',color:'var(--border)',fontSize:'0.75rem'}},'—');
        const {status, n_psms, n_peptides, n_proteins, n_precursors, error_msg} = entry;
        const primary = metric === 'precursors' ? (n_precursors ?? n_psms) : n_psms;
        if (status === 'not_applicable') return React.createElement('td',{style:{textAlign:'right',color:'var(--border)',fontSize:'0.72rem'},title:'Not compatible with this acquisition mode'},'N/A');
        if (status === 'not_installed') return React.createElement('td',{style:{textAlign:'right',color:'#f59e0b',fontSize:'0.72rem'},title:error_msg||'Tool not installed'},'⚠ —');
        if (status === 'pending') return React.createElement('td',{style:{textAlign:'right',color:'var(--muted)',fontSize:'0.75rem'}},
          React.createElement('span',{title:'queued'},'⋯'));
        if (status === 'running') return React.createElement('td',{style:{textAlign:'right'}},
          React.createElement('span',{style:{display:'inline-block',animation:'spin 1.2s linear infinite',color:'#60a5fa',fontSize:'0.85rem'},title:'running'},'↻'));
        if (status === 'failed') return React.createElement('td',{style:{textAlign:'right',color:'#ef4444',fontSize:'0.75rem'},title:error_msg||'failed'},'✗');
        if (status === 'done') return React.createElement('td',{style:{textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:600,color:color||'var(--text)'}},
          React.createElement('div',{title:`Primary: ${primary??0}  Pep: ${n_peptides??0}  PG: ${n_proteins??0}`},fmtN(primary)),
          React.createElement('div',{style:{fontSize:'0.65rem',color:'var(--muted)',fontWeight:400}},
            n_peptides!=null&&React.createElement('span',null,fmtN(n_peptides)+' pep'),
            n_proteins!=null&&React.createElement('span',null,' · '+fmtN(n_proteins)+' pg'),
          ),
        );
        return React.createElement('td',{style:{textAlign:'right',color:'var(--border)'}},'—');
      }

      const ColBtn = ({k, label}) => React.createElement('button',{
        onClick:()=>setShowCols(c=>({...c,[k]:!c[k]})),
        style:{padding:'0.15rem 0.45rem',fontSize:'0.71rem',borderRadius:'0.25rem',cursor:'pointer',
          background:showCols[k]?'var(--accent)':'var(--surface)',
          color:showCols[k]?'var(--bg)':'var(--muted)',
          border:`1px solid ${showCols[k]?'var(--accent)':'var(--border)'}`},
      }, label);

      const [fixNamesDetail, setFixNamesDetail] = React.useState(null);
      const fixInstrumentNames = async () => {
        setFixNamesState('running');
        setFixNamesDetail(null);
        try {
          const r = await fetch('/api/fix-instrument-names', { method: 'POST' });
          const d = await r.json();
          setFixNamesDetail(d);
          if (d.runs?.length) {
            console.group('[ZIGGY] Fix Instrument Names');
            d.runs.forEach(x => console.log(`  ${x.result.toUpperCase()} [${x.id}] ${x.run}: ${x.name || x.reason || ''}`));
            console.groupEnd();
          }
          setFixNamesState(d.updated > 0 ? 'done' : d.errors > 0 ? 'err' : 'none');
          if (d.updated > 0) setTimeout(fetchData, 400);
          setTimeout(() => { setFixNamesState('idle'); setFixNamesDetail(null); }, 12000);
        } catch {
          setFixNamesState('err');
          setTimeout(() => setFixNamesState('idle'), 3000);
        }
      };

      if (loading) return React.createElement('div',{className:'empty'},'Loading searches…');
      if (!searches?.length) return React.createElement('div',{className:'empty'},'No search results in database yet');

      const inFlight = (searches||[]).reduce((n,s) => {
        const c = s.comparisons || {};
        return n + Object.values(c).filter(v=>v.status==='running'||v.status==='pending').length;
      }, 0);
      const done = (searches||[]).reduce((n,s) => {
        const c = s.comparisons || {};
        return n + Object.values(c).filter(v=>v.status==='done').length;
      }, 0);

      // ── Auto-detect sample type from run name ─────────────────────────────
      const autoStype = (run) => {
        const n = (run.run_name||'').toLowerCase();
        if (n.includes('blank') || n.includes('blnk')) return 'Blank';
        if (n.includes('qc') || n.includes('hela') || n.includes('standard')) return 'QC';
        return '';
      };

      return React.createElement('div',null,

        // ── Search parameter modal ─────────────────────────────────────────
        showParamModal && React.createElement(SearchParamModal,{onClose:()=>setShowParamModal(false)}),

        // ── Unsearched runs panel ──────────────────────────────────────────
        React.createElement(UnsearchedPanel,{onSearched:fetchData}),

        // ── Auto-search scheduler ──────────────────────────────────────────
        React.createElement(AutoSearchPanel,null),

        // ── View toggle + status bar ───────────────────────────────────────
        React.createElement('div',{style:{display:'flex',gap:'0.5rem',alignItems:'center',marginBottom:'0.75rem',flexWrap:'wrap'}},
          ['compare','details'].map(v =>
            React.createElement('button',{key:v,onClick:()=>setView(v),
              style:{padding:'0.3rem 0.9rem',borderRadius:'0.4rem',cursor:'pointer',fontSize:'0.82rem',fontWeight:600,
                background:view===v?'var(--accent)':'var(--surface)',
                color:view===v?'var(--bg)':'var(--muted)',
                border:`1px solid ${view===v?'var(--accent)':'var(--border)'}`}},
              v==='compare'?'Engine Comparison':'Run Details')
          ),
          React.createElement('button',{onClick:fetchData,
            style:{padding:'0.3rem 0.7rem',borderRadius:'0.4rem',fontSize:'0.8rem',cursor:'pointer',
              background:'var(--surface)',color:'var(--muted)',border:'1px solid var(--border)'}},
            '↻'),
          React.createElement('button',{onClick:()=>setShowParamModal(true),
            title:'Configure mods, enzyme, FASTA, and library for comparison searches',
            style:{padding:'0.3rem 0.7rem',borderRadius:'0.4rem',fontSize:'0.8rem',cursor:'pointer',
              background:'var(--surface)',color:'var(--accent)',border:'1px solid var(--accent)'}},
            '⚙ Search Params'),
          React.createElement('div',{style:{position:'relative'}},
          React.createElement('button',{
            onClick: fixInstrumentNames,
            disabled: fixNamesState === 'running',
            title: 'Resolve "Auto"/"unknown" instrument names by reading analysis.tdf GlobalMetadata from each .d directory',
            style:{padding:'0.3rem 0.7rem',borderRadius:'0.4rem',fontSize:'0.8rem',cursor:'pointer',
              background:'var(--surface)',
              color: fixNamesState==='done' ? '#4ade80' : fixNamesState==='err' ? '#ef4444' : fixNamesState==='none' ? '#f59e0b' : 'var(--muted)',
              border:`1px solid ${fixNamesState==='done'?'#4ade80':fixNamesState==='err'?'#ef4444':fixNamesState==='none'?'#f59e0b':'var(--border)'}`},
          },
            fixNamesState==='running' ? React.createElement('span',{style:{display:'inline-block',animation:'spin 1.2s linear infinite'}},'↻')
            : fixNamesState==='done'  ? `✓ Fixed ${fixNamesDetail?.updated||''}`
            : fixNamesState==='err'   ? '✗ Error'
            : fixNamesState==='none'  ? `⚠ 0 fixed (${fixNamesDetail?.skipped||0} skipped)`
            : '🔬 Fix Instruments'),
          fixNamesDetail && fixNamesDetail.runs?.length > 0 && React.createElement('div',{
            style:{position:'absolute',top:'calc(100% + 4px)',left:0,minWidth:'420px',zIndex:50,
              background:'#0e0018',border:'1px solid var(--border)',borderRadius:'0.4rem',
              padding:'0.5rem 0.7rem',fontSize:'0.72rem',maxHeight:'220px',overflowY:'auto'}},
            fixNamesDetail.runs.map((x,i)=>React.createElement('div',{key:i,
              style:{display:'flex',gap:'0.6rem',padding:'0.15rem 0',
                color:x.result==='updated'?'#4ade80':x.result==='error'?'#ef4444':'#94a3b8'}},
              React.createElement('span',{style:{fontWeight:700,minWidth:'55px'}},x.result.toUpperCase()),
              React.createElement('span',{style:{color:'#60a5fa',minWidth:'130px',fontFamily:'monospace',fontSize:'0.68rem',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},x.run),
              React.createElement('span',{style:{color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}, x.name || x.reason || '')
            ))
          )
          ),  // end relative wrapper
          React.createElement('span',{style:{marginLeft:'auto',fontSize:'0.75rem',color:'var(--muted)'}},
            done>0 && React.createElement('span',{style:{color:'#34d399',marginRight:'0.5rem'}},done+' comparisons done'),
            inFlight>0 && React.createElement('span',{style:{color:'#60a5fa'}},
              React.createElement('span',{style:{display:'inline-block',animation:'spin 1.2s linear infinite'}},'↻'),
              ' '+inFlight+' running…'),
          ),
        ),

        // ── Shared filter bar ──────────────────────────────────────────────
        React.createElement('div',{style:{display:'flex',gap:'0.5rem',flexWrap:'wrap',alignItems:'center',marginBottom:'0.75rem'}},
          React.createElement('input',{placeholder:'Search runs…',value:search,onChange:e=>setSearch(e.target.value),
            style:{...selStyle,width:'160px'}}),
          React.createElement('select',{value:filterMode,onChange:e=>setFilterMode(e.target.value),style:selStyle},
            React.createElement('option',{value:'all'},'All modes'),
            modes.map(m=>React.createElement('option',{key:m,value:m},m))),
          React.createElement('select',{value:filterInst,onChange:e=>setFilterInst(e.target.value),style:selStyle},
            React.createElement('option',{value:'all'},'All instruments'),
            insts.map(i=>React.createElement('option',{key:i,value:i},i))),
          React.createElement('select',{value:filterStype,onChange:e=>setFilterStype(e.target.value),style:selStyle},
            React.createElement('option',{value:'all'},'All sample types'),
            stypes.map(s=>React.createElement('option',{key:s,value:s},s))),
          React.createElement('select',{value:filterWflow,onChange:e=>setFilterWflow(e.target.value),style:selStyle},
            React.createElement('option',{value:'all'},'All workflows'),
            wflows.map(w=>React.createElement('option',{key:w,value:w},w))),
          React.createElement('span',{style:{marginLeft:'auto',fontSize:'0.75rem',color:'var(--muted)'}},
            filtered.length+' of '+searches.length+' runs'),
        ),

        // ══ Engine Comparison View ════════════════════════════════════════
        view === 'compare' && React.createElement('div',null,
          React.createElement('div',{style:{fontSize:'0.73rem',color:'var(--muted)',marginBottom:'0.5rem',lineHeight:1.5}},
            'Comparison searches fire automatically after every primary DIA-NN / Sage search — no manual action needed. ',
            'Click the sample type or workflow cell to annotate a run. Stale runs (>3 days, orange/red age) can be re-queued from the panel above.'),
          React.createElement('div',{style:{overflowX:'auto',borderRadius:'0.5rem',border:'1px solid var(--border)'}},
            React.createElement('table',{style:{fontSize:'0.79rem',minWidth:'900px'}},
              React.createElement('thead',null,
                React.createElement('tr',{style:{background:'rgba(2,40,81,0.8)'}},
                  makeTh('run_name','Run','Run name',sortCol,setSortCol,sortDir,setSortDir),
                  makeTh('instrument','Instrument','Instrument',sortCol,setSortCol,sortDir,setSortDir),
                  React.createElement('th',{style:{color:'var(--muted)',paddingRight:'0.5rem'}},'Mode'),
                  React.createElement('th',{style:{color:'#22d3ee',paddingRight:'0.5rem'}},'Type'),
                  React.createElement('th',{style:{color:'#a855f7',paddingRight:'0.75rem'}},'Workflow'),
                  React.createElement('th',{style:{textAlign:'right',color:'#60a5fa',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'DIA-NN',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'prec · pep · pg')),
                  React.createElement('th',{style:{textAlign:'right',color:'#a78bfa',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'MSFragger-DIA',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'prec · pep · pg')),
                  React.createElement('th',{style:{textAlign:'right',color:'#34d399',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'Sage',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'PSMs · pep · pg')),
                  React.createElement('th',{style:{textAlign:'right',color:'#fb923c',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'MSFragger-DDA',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'PSMs · pep · pg')),
                  React.createElement('th',{style:{textAlign:'right',color:'#e879f9',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'X!Tandem',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'PSMs · pep · pg')),
                  React.createElement('th',{style:{textAlign:'right',color:'#4ade80',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'MaxQuant',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'PSMs · pep · pg')),
                  React.createElement('th',{style:{textAlign:'right',color:'#f0abfc',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'Comet',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'PSMs · pep · pg')),
                  React.createElement('th',{style:{textAlign:'right',color:'#f472b6',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'Chimerys',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'PSMs · pep')),
                  React.createElement('th',{style:{textAlign:'right',color:'#38bdf8',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'Andromeda',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'PSMs · pep · pg')),
                  React.createElement('th',{style:{textAlign:'right',color:'#fb7185',paddingRight:'0.75rem',whiteSpace:'nowrap'}},
                    'PrOLuCID',React.createElement('br'),React.createElement('span',{style:{fontSize:'0.65rem',fontWeight:400}},'PSMs · pep · pg')),
                  React.createElement('th',{style:{color:'var(--muted)',paddingRight:'0.5rem',whiteSpace:'nowrap'}},'Compare'),
                  makeTh('gate_result','Gate','QC gate',sortCol,setSortCol,sortDir,setSortDir),
                  makeTh('run_date','Date','Acquisition date',sortCol,setSortCol,sortDir,setSortDir),
                ),
              ),
              React.createElement('tbody',null,
                sortedRows.map(s => {
                  const comp = s.comparisons || {};
                  const isRowDia = isDia(s.mode);
                  const prec = s.stats_precursors ?? s.n_precursors;
                  const psms = s.n_psms;
                  const stype = s.sample_type || autoStype(s) || '';
                  const wflow = s.workflow || '';
                  return React.createElement('tr',{key:s.id,style:{borderBottom:'1px solid var(--border)'}},
                    React.createElement('td',{style:{maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:'0.75rem'},title:s.run_name},s.run_name),
                    React.createElement('td',{style:{paddingRight:'0.5rem'}},
                      React.createElement(InstrumentCell,{runId:s.id,value:s.instrument,onSaved:fetchData})),
                    React.createElement('td',{style:{whiteSpace:'nowrap',paddingRight:'0.5rem'}},
                      _sBadge(s.mode, MODE_COLOR[s.mode]||'#a0b4cc')),
                    // Sample type — inline editable
                    React.createElement('td',{style:{paddingRight:'0.5rem'}},
                      React.createElement(AnnotateCell,{runId:s.id,field:'sample_type',
                        value:stype,options:SAMPLE_TYPES,colors:SAMPLE_COLORS,onSaved:onAnnotationSaved})),
                    // Workflow — inline editable
                    React.createElement('td',{style:{paddingRight:'0.75rem'}},
                      React.createElement(AnnotateCell,{runId:s.id,field:'workflow',
                        value:wflow,options:WORKFLOWS,colors:WORKFLOW_COLORS,onSaved:onAnnotationSaved})),
                    // DIA-NN primary
                    React.createElement('td',{style:{textAlign:'right',fontVariantNumeric:'tabular-nums',
                      color:isRowDia?'#60a5fa':'var(--muted)',fontWeight:isRowDia?600:400,paddingRight:'0.75rem'}},
                      isRowDia ? React.createElement('div',null,
                        React.createElement('div',null,fmtN(prec)),
                        React.createElement('div',{style:{fontSize:'0.65rem',color:'var(--muted)',fontWeight:400}},
                          s.n_peptides!=null&&React.createElement('span',null,fmtN(s.n_peptides)+' pep'),
                          s.n_proteins!=null&&React.createElement('span',null,' · '+fmtN(s.n_proteins)+' pg'),
                        ),
                      ) : '—'),
                    isRowDia ? React.createElement(CompCell,{entry:comp.msfragger_dia,metric:'precursors',color:'#a78bfa'})
                              : React.createElement('td',{style:{textAlign:'right',color:'var(--border)'}},'—'),
                    // Sage primary
                    React.createElement('td',{style:{textAlign:'right',fontVariantNumeric:'tabular-nums',
                      color:!isRowDia?'#34d399':'var(--muted)',fontWeight:!isRowDia?600:400,paddingRight:'0.75rem'}},
                      !isRowDia ? React.createElement('div',null,
                        React.createElement('div',null,fmtN(psms)),
                        React.createElement('div',{style:{fontSize:'0.65rem',color:'var(--muted)',fontWeight:400}},
                          s.n_peptides_dda!=null&&React.createElement('span',null,fmtN(s.n_peptides_dda)+' pep'),
                          s.n_proteins!=null&&React.createElement('span',null,' · '+fmtN(s.n_proteins)+' pg'),
                        ),
                      ) : '—'),
                    React.createElement(CompCell,{entry:comp.msfragger_dda,metric:'psms',color:'#fb923c'}),
                    React.createElement(CompCell,{entry:comp.xtandem,metric:'psms',color:'#e879f9'}),
                    React.createElement(CompCell,{entry:comp.maxquant,metric:'psms',color:'#4ade80'}),
                    React.createElement(CompCell,{entry:comp.comet,metric:'psms',color:'#f0abfc'}),
                    React.createElement(CompCell,{entry:comp.chimerys,metric:'psms',color:'#f472b6'}),
                    React.createElement(CompCell,{entry:comp.andromeda,metric:'psms',color:'#38bdf8'}),
                    React.createElement(CompCell,{entry:comp.prolucid,metric:'psms',color:'#fb7185'}),
                    React.createElement('td',{style:{paddingRight:'0.5rem'}},
                      React.createElement(RunCompareBtn,{runId:s.id,onDone:fetchData})),
                    React.createElement('td',null,React.createElement(GateBadge,{result:s.gate_result})),
                    React.createElement('td',{style:{color:'var(--muted)',fontSize:'0.72rem',whiteSpace:'nowrap'}},
                      new Date(s.run_date).toLocaleString([],{month:'short',day:'numeric',year:'2-digit',hour:'2-digit',minute:'2-digit'})),
                  );
                }),
              ),
            ),
          ),
          React.createElement('div',{style:{marginTop:'0.4rem',fontSize:'0.7rem',color:'var(--muted)'}},
            'Comparison searches start automatically after each primary search. Click any Type or Workflow cell to annotate. ',
            'MSFragger requires FragPipe · X!Tandem requires tandem.exe · Bruker .d auto-converted via timsconvert. ',
            'Chimerys results are read from locally-cached MSAID Platform parquets — download via Config tab. ',
            'Andromeda requires MaxQuant 2.x standalone · PrOLuCID requires prolucid.jar + Java.'),
        ),

        // ══ Run Details View ══════════════════════════════════════════════
        view === 'details' && React.createElement('div',null,
          // Column toggles
          React.createElement('div',{style:{display:'flex',gap:'0.25rem',flexWrap:'wrap',alignItems:'center',marginBottom:'0.5rem'}},
            React.createElement('span',{style:{color:'var(--muted)',fontSize:'0.71rem',marginRight:'0.2rem'}},'Columns:'),
            [['engine','Engine'],['version','Version'],['library','Library'],['threads','Threads'],
             ['sampletype','Type'],['workflow','Workflow'],
             ['precursors','Precursors'],['peptides','Peptides'],['proteins','Proteins'],
             ['ms1acc','MS1 Acc'],['ms2acc','MS2 Acc'],['fwhm','FWHM'],
             ['ms1sig','MS1 Sig'],['ms2sig','MS2 Sig'],['charge','Avg z'],['mc','MC'],['gate','Gate'],['date','Date'],
            ].map(([k,l])=>React.createElement(ColBtn,{key:k,k,label:l})),
          ),

          React.createElement('div',{style:{overflowX:'auto',borderRadius:'0.5rem',border:'1px solid var(--border)'}},
            React.createElement('table',{style:{fontSize:'0.79rem',minWidth:'600px'}},
              React.createElement('thead',null,
                React.createElement('tr',{style:{background:'rgba(2,40,81,0.8)'}},
                  makeTh('run_name','Run','Run name',sortColD,setSortColD,sortDirD,setSortDirD),
                  makeTh('instrument','Instrument','Instrument',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.engine    && React.createElement('th',{style:{color:'var(--muted)'}},'Engine'),
                  showCols.version   && makeTh('diann_version','Ver','Engine version',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.library   && React.createElement('th',{style:{color:'var(--muted)'}},'Library'),
                  showCols.threads   && makeTh('diann_threads','Thr','CPU threads',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.sampletype && React.createElement('th',{style:{color:'#22d3ee'}},'Type'),
                  showCols.workflow  && React.createElement('th',{style:{color:'#a855f7'}},'Workflow'),
                  showCols.precursors && makeTh('stats_precursors','Precursors','Precursors @ 1% FDR',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.peptides  && makeTh('n_peptides','Peptides','Unique peptides',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.proteins  && makeTh('n_proteins','Proteins','Protein groups',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.ms1acc    && makeTh('stats_mass_acc_ms1','MS1 Acc','MS1 mass accuracy',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.ms2acc    && makeTh('stats_mass_acc_ms2','MS2 Acc','MS2 mass accuracy',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.fwhm      && makeTh('stats_fwhm_rt','FWHM','Peak FWHM',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.ms1sig    && makeTh('stats_ms1_signal','MS1 Sig','Total MS1 signal',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.ms2sig    && makeTh('stats_ms2_signal','MS2 Sig','Total MS2 signal',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.charge    && makeTh('stats_avg_charge','Avg z','Avg charge',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.mc        && makeTh('stats_missed_cleavages','MC','Missed cleavages',sortColD,setSortColD,sortDirD,setSortDirD),
                  showCols.gate      && React.createElement('th',{style:{color:'var(--muted)'}},'Gate'),
                  showCols.date      && makeTh('run_date','Date','Acquisition date',sortColD,setSortColD,sortDirD,setSortDirD),
                ),
              ),
              React.createElement('tbody',null,
                sortedRows.map(s => {
                  const prec   = s.stats_precursors ?? s.n_precursors;
                  const ms1acc = s.stats_mass_acc_ms1 ?? s.median_mass_acc_ms1_ppm;
                  const ms2acc = s.stats_mass_acc_ms2 ?? s.median_mass_acc_ms2_ppm;
                  const fwhm   = s.stats_fwhm_rt ?? s.fwhm_rt_min;
                  const stype  = s.sample_type || autoStype(s) || '';
                  const wflow  = s.workflow || '';
                  return React.createElement('tr',{key:s.id,style:{borderBottom:'1px solid var(--border)'}},
                    React.createElement('td',{style:{maxWidth:'220px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:'1rem'},title:s.run_name},s.run_name),
                    React.createElement('td',{style:{paddingRight:'0.75rem'}},
                      React.createElement(InstrumentCell,{runId:s.id,value:s.instrument,onSaved:fetchData})),
                    showCols.engine && React.createElement('td',{style:{whiteSpace:'nowrap'}},
                      _sBadge((s.search_engine||'?').toUpperCase(), ENGINE_COLOR[s.search_engine]||'#a0b4cc'),
                      s.mode&&React.createElement('span',{style:{marginLeft:3}},_sBadge(s.mode,MODE_COLOR[s.mode]||'#a0b4cc')),
                    ),
                    showCols.version  && React.createElement('td',{style:{color:'var(--muted)',fontSize:'0.73rem'}},s.diann_version||'—'),
                    showCols.library  && React.createElement('td',{style:{maxWidth:'140px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:'0.72rem',color:'var(--muted)'},title:s.diann_library},libShort(s.diann_library)),
                    showCols.threads  && React.createElement('td',{style:{textAlign:'right',color:'var(--muted)'}},s.diann_threads??'—'),
                    showCols.sampletype && React.createElement('td',null,
                      React.createElement(AnnotateCell,{runId:s.id,field:'sample_type',value:stype,options:SAMPLE_TYPES,colors:SAMPLE_COLORS,onSaved:onAnnotationSaved})),
                    showCols.workflow && React.createElement('td',null,
                      React.createElement(AnnotateCell,{runId:s.id,field:'workflow',value:wflow,options:WORKFLOWS,colors:WORKFLOW_COLORS,onSaved:onAnnotationSaved})),
                    showCols.precursors && React.createElement('td',{style:{textAlign:'right',fontWeight:600,fontVariantNumeric:'tabular-nums'}},fmtN(prec)),
                    showCols.peptides  && React.createElement('td',{style:{textAlign:'right',fontVariantNumeric:'tabular-nums'}},fmtN(s.n_peptides)),
                    showCols.proteins  && React.createElement('td',{style:{textAlign:'right',fontVariantNumeric:'tabular-nums'}},fmtN(s.n_proteins)),
                    showCols.ms1acc   && React.createElement('td',{style:{textAlign:'right',fontVariantNumeric:'tabular-nums',
                      color:ms1acc!=null&&Math.abs(ms1acc)>5?'var(--warn)':'inherit'}},fmtPpm(ms1acc)),
                    showCols.ms2acc   && React.createElement('td',{style:{textAlign:'right',fontVariantNumeric:'tabular-nums'}},fmtPpm(ms2acc)),
                    showCols.fwhm     && React.createElement('td',{style:{textAlign:'right',fontVariantNumeric:'tabular-nums'}},fmtFwhm(fwhm)),
                    showCols.ms1sig   && React.createElement('td',{style:{textAlign:'right',fontSize:'0.75rem',fontVariantNumeric:'tabular-nums'}},fmtSig(s.stats_ms1_signal??s.ms1_signal)),
                    showCols.ms2sig   && React.createElement('td',{style:{textAlign:'right',fontSize:'0.75rem',fontVariantNumeric:'tabular-nums'}},fmtSig(s.stats_ms2_signal??s.ms2_signal)),
                    showCols.charge   && React.createElement('td',{style:{textAlign:'right',color:'var(--muted)'}},s.stats_avg_charge?.toFixed(2)??'—'),
                    showCols.mc       && React.createElement('td',{style:{textAlign:'right',color:'var(--muted)'}},s.stats_missed_cleavages?.toFixed(3)??'—'),
                    showCols.gate     && React.createElement('td',null,React.createElement(GateBadge,{result:s.gate_result})),
                    showCols.date     && React.createElement('td',{style:{color:'var(--muted)',fontSize:'0.75rem',whiteSpace:'nowrap'}},
                      new Date(s.run_date).toLocaleString([],{year:'2-digit',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})),
                  );
                }),
              ),
            ),
          ),
        ),
      );
    }
