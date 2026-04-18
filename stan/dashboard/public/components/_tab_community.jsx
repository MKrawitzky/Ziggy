    function CommunityTab() {
      const { data: submissions, mutate: refetchSubs } = useFetch('/api/community/submissions');
      const [withdrawing, setWithdrawing] = useState(null);   // run_id being confirmed
      const [withdrawMsg, setWithdrawMsg] = useState(null);   // success/info message
      const [sampleFilter, setSampleFilter] = useState('all');
      const [columnFilter, setColumnFilter] = useState('all');

      const SAMPLE_TYPES = ['all','HeLa','K562','HEK293','Jurkat','Yeast','E. coli','Other'];
      const COLUMN_TYPES  = ['all','PepSep Ultra','PepSep Advance','Aurora Series','Evosep EV-1106','Evosep EV-1107','Evosep EV-1108','nanoViper','Other'];

      async function doWithdraw(runId) {
        setWithdrawing(null);
        try {
          const r = await fetch(API + `/api/community/withdraw/${runId}`, {method:'POST'});
          const d = await r.json();
          setWithdrawMsg(d.message || 'Withdrawn.');
          if (typeof refetchSubs === 'function') refetchSubs();
        } catch {
          setWithdrawMsg('Error withdrawing — check server logs.');
        }
      }

      return (
        <div>
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Community Benchmark</h3>
            <p style={{marginBottom:'0.75rem'}}>
              Compare your instrument against labs worldwide. The community dashboard
              is live at:
            </p>
            <a href="https://community.stan-proteomics.org" target="_blank"
               style={{display:'inline-block', padding:'0.6rem 1.2rem', background:'var(--accent)',
                       color:'var(--bg)', borderRadius:'0.5rem', fontWeight:700, fontSize:'1rem',
                       textDecoration:'none', marginBottom:'0.75rem'}}>
              community.stan-proteomics.org
            </a>
            <p style={{color:'var(--muted)', fontSize:'0.85rem', marginTop:'0.5rem'}}>
              For valid cross-lab comparisons, filter by the same sample type and column —
              comparing HeLa on an Evosep column vs K562 on a PepSep column is not meaningful.
            </p>
          </div>

          {/* Column + Sample filter for benchmark context */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Benchmark Filter Context</h3>
            <p style={{color:'var(--muted)', fontSize:'0.82rem', marginBottom:'0.75rem'}}>
              Select your sample type and column so your data is compared against equivalent setups.
              Mixing sample types or column chemistries will skew rankings.
            </p>
            <div style={{display:'flex', gap:'1rem', flexWrap:'wrap', alignItems:'center'}}>
              <div>
                <label style={{fontSize:'0.8rem', color:'var(--muted)', display:'block', marginBottom:'0.25rem'}}>Sample Type</label>
                <select value={sampleFilter} onChange={e => setSampleFilter(e.target.value)}
                  style={{background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)',
                          borderRadius:'0.4rem', padding:'0.35rem 0.6rem', fontSize:'0.85rem', cursor:'pointer'}}>
                  {SAMPLE_TYPES.map(s => <option key={s} value={s}>{s === 'all' ? 'All Samples' : s}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:'0.8rem', color:'var(--muted)', display:'block', marginBottom:'0.25rem'}}>Column</label>
                <select value={columnFilter} onChange={e => setColumnFilter(e.target.value)}
                  style={{background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)',
                          borderRadius:'0.4rem', padding:'0.35rem 0.6rem', fontSize:'0.85rem', cursor:'pointer'}}>
                  {COLUMN_TYPES.map(c => <option key={c} value={c}>{c === 'all' ? 'All Columns' : c}</option>)}
                </select>
              </div>
              {(sampleFilter !== 'all' || columnFilter !== 'all') && (
                <div style={{fontSize:'0.78rem', color:'var(--accent)', marginTop:'1rem'}}>
                  Filtering: {sampleFilter !== 'all' ? sampleFilter : 'any sample'} · {columnFilter !== 'all' ? columnFilter : 'any column'}
                </div>
              )}
            </div>
          </div>

          {/* Shared runs + withdraw */}
          <div className="card" style={{marginBottom:'1rem'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem'}}>
              <h3 style={{margin:0}}>Your Shared Runs</h3>
              <span style={{fontSize:'0.8rem', color:'var(--muted)'}}>
                {Array.isArray(submissions) ? submissions.length : 0} submitted
              </span>
            </div>

            {withdrawMsg && (
              <div style={{background:'rgba(234,179,8,0.1)', border:'1px solid rgba(234,179,8,0.3)', borderRadius:'0.4rem',
                           padding:'0.6rem 0.9rem', marginBottom:'0.75rem', fontSize:'0.82rem', color:'var(--warn)'}}>
                {withdrawMsg}
                <button onClick={() => setWithdrawMsg(null)}
                  style={{marginLeft:'0.75rem', background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:'0.8rem'}}>
                  Dismiss
                </button>
              </div>
            )}

            {!Array.isArray(submissions) || submissions.length === 0 ? (
              <div style={{color:'var(--muted)', fontSize:'0.85rem', padding:'1rem 0'}}>
                No runs submitted yet. Run <code style={{color:'var(--accent)'}}>stan baseline</code> to share your first run.
              </div>
            ) : (
              <div style={{display:'flex', flexDirection:'column', gap:'0.4rem'}}>
                {submissions.map(run => (
                  <div key={run.id} style={{display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.5rem 0.75rem',
                       background:'var(--bg)', borderRadius:'0.4rem', border:'1px solid var(--border)'}}>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:'0.82rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{run.run_name}</div>
                      <div style={{fontSize:'0.72rem', color:'var(--muted)', marginTop:'0.1rem'}}>
                        {run.instrument} · {new Date(run.run_date).toLocaleDateString([],{month:'short',day:'numeric',year:'2-digit'})}
                        {run.n_precursors ? ` · ${run.n_precursors.toLocaleString()} precursors` : run.n_psms ? ` · ${run.n_psms.toLocaleString()} PSMs` : ''}
                      </div>
                    </div>
                    {run.submission_id && (
                      <div style={{fontSize:'0.7rem', color:'var(--muted)', fontFamily:'monospace', flexShrink:0}}>
                        {run.submission_id.slice(0,8)}
                      </div>
                    )}
                    {withdrawing === run.id ? (
                      <div style={{display:'flex', gap:'0.4rem', alignItems:'center', flexShrink:0}}>
                        <span style={{fontSize:'0.75rem', color:'var(--warn)'}}>Stop sharing?</span>
                        <button onClick={() => doWithdraw(run.id)}
                          style={{padding:'0.25rem 0.6rem', background:'rgba(239,68,68,0.15)', color:'#ef4444',
                                  border:'1px solid rgba(239,68,68,0.4)', borderRadius:'0.3rem', cursor:'pointer', fontSize:'0.75rem', fontWeight:600}}>
                          Confirm
                        </button>
                        <button onClick={() => setWithdrawing(null)}
                          style={{padding:'0.25rem 0.5rem', background:'var(--surface)', color:'var(--muted)',
                                  border:'1px solid var(--border)', borderRadius:'0.3rem', cursor:'pointer', fontSize:'0.75rem'}}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setWithdrawing(run.id)}
                        style={{padding:'0.25rem 0.6rem', background:'rgba(234,179,8,0.08)', color:'var(--warn)',
                                border:'1px solid rgba(234,179,8,0.3)', borderRadius:'0.3rem', cursor:'pointer',
                                fontSize:'0.75rem', fontWeight:600, flexShrink:0, whiteSpace:'nowrap'}}>
                        Stop sharing
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{marginTop:'0.75rem', fontSize:'0.75rem', color:'var(--muted)', borderTop:'1px solid var(--border)', paddingTop:'0.6rem'}}>
              "Stop sharing" removes the run from your local list immediately. To permanently delete it from the
              public dataset, email <a href="mailto:bsphinney@ucdavis.edu" style={{color:'var(--accent)'}}>bsphinney@ucdavis.edu</a> with the submission ID.
            </div>
          </div>

          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Learn Proteomics</h3>
            <p style={{marginBottom:'0.5rem'}}>
              Want hands-on training with the instruments and techniques behind STAN?
            </p>
            <a href="https://proteomics.ucdavis.edu/events/hands-proteomics-short-course" target="_blank"
               style={{color:'var(--accent)', textDecoration:'none', fontWeight:600}}>
              UC Davis Hands-on Proteomics Short Course →
            </a>
            <p style={{color:'var(--muted)', fontSize:'0.8rem', marginTop:'0.3rem'}}>
              Annual course covering sample prep, LC-MS, DIA, data analysis, and more.
            </p>
          </div>
        </div>
      );
    }

    /* ── De Novo Tab ──────────────────────────────────────────────────── */

