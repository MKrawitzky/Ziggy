    /* ── Lab Setup Tab ───────────────────────────────────────────────── */
    /* Column catalog, LC catalog, and run assignment                    */

    const LC_VENDORS  = ['Evosep', 'Bruker', 'Thermo Fisher', 'Waters', 'Agilent', 'Other'];
    const COL_VENDORS = ['PepSep', 'Evosep', 'Waters', 'Thermo Fisher', 'YMC', 'Phenomenex', 'Reprosil-Pur', 'Other'];
    const COL_CHEM    = ['C18', 'C8', 'C4', 'PhenylHexyl', 'CN', 'Other'];
    const MS_VENDORS  = ['Bruker', 'Thermo Fisher', 'Waters', 'Agilent', 'Sciex', 'Shimadzu'];

    const BLANK_COL = {
      name:'', vendor:'PepSep', chemistry:'C18', particle_um:'', pore_a:'',
      length_cm:'', id_um:'', max_pressure_bar:'', compatible_lc:'', gradient_name:'', notes:'',
    };
    const BLANK_LC = { name:'', vendor:'Evosep', flow_nl_min:'', gradient_type:'', notes:'' };

    /* ── Column form ────────────────────────────────────────────────── */
    function ColumnForm({ initial, onSave, onCancel }) {
      const [f, setF] = useState({ ...BLANK_COL, ...(initial || {}) });
      const set = (k, v) => setF(p => ({ ...p, [k]: v }));
      const [saving, setSaving] = useState(false);

      const save = async () => {
        if (!f.name.trim()) return;
        setSaving(true);
        const method = f.id ? 'PUT' : 'POST';
        const url    = f.id ? `/api/catalog/columns/${f.id}` : '/api/catalog/columns';
        const body   = { ...f };
        ['particle_um','pore_a','length_cm','id_um','max_pressure_bar'].forEach(k => {
          body[k] = body[k] === '' ? null : parseFloat(body[k]) || null;
        });
        await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        setSaving(false);
        onSave();
      };

      const inp = { background:'var(--bg)', color:'var(--text)', border:'1px solid var(--border)',
                    borderRadius:'.35rem', padding:'.3rem .5rem', fontSize:'.8rem', width:'100%' };
      const label = (t) => React.createElement('div', { style:{ fontSize:'.65rem', color:'#64748b',
        textTransform:'uppercase', letterSpacing:'.06em', marginBottom:'.15rem' } }, t);

      return (
        <div style={{ background:'rgba(0,0,0,0.3)', border:'1px solid rgba(34,211,238,0.25)',
                      borderRadius:'.5rem', padding:'.85rem 1rem', marginBottom:'.75rem' }}>
          <div style={{ fontWeight:700, color:'#22d3ee', fontSize:'.82rem', marginBottom:'.65rem' }}>
            {f.id ? 'Edit Column' : 'Add Column'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:'.5rem', marginBottom:'.5rem' }}>
            <div>
              {label('Name *')}
              <input style={inp} value={f.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. PepSep Pro C18 1.9µm 15cm" />
            </div>
            <div>
              {label('Vendor')}
              <select style={inp} value={f.vendor} onChange={e=>set('vendor',e.target.value)}>
                {COL_VENDORS.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              {label('Chemistry')}
              <select style={inp} value={f.chemistry} onChange={e=>set('chemistry',e.target.value)}>
                {COL_CHEM.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              {label('Gradient / Method')}
              <input style={inp} value={f.gradient_name} onChange={e=>set('gradient_name',e.target.value)}
                placeholder="e.g. Evosep 60 SPD" />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr 2fr', gap:'.5rem', marginBottom:'.5rem' }}>
            <div>
              {label('Particle (µm)')}
              <input style={inp} type="number" step="0.1" value={f.particle_um} onChange={e=>set('particle_um',e.target.value)} placeholder="1.9" />
            </div>
            <div>
              {label('Pore (Å)')}
              <input style={inp} type="number" value={f.pore_a} onChange={e=>set('pore_a',e.target.value)} placeholder="120" />
            </div>
            <div>
              {label('Length (cm)')}
              <input style={inp} type="number" step="0.5" value={f.length_cm} onChange={e=>set('length_cm',e.target.value)} placeholder="15" />
            </div>
            <div>
              {label('I.D. (µm)')}
              <input style={inp} type="number" value={f.id_um} onChange={e=>set('id_um',e.target.value)} placeholder="150" />
            </div>
            <div>
              {label('Max P (bar)')}
              <input style={inp} type="number" value={f.max_pressure_bar} onChange={e=>set('max_pressure_bar',e.target.value)} placeholder="800" />
            </div>
            <div>
              {label('Compatible LC')}
              <input style={inp} value={f.compatible_lc} onChange={e=>set('compatible_lc',e.target.value)}
                placeholder="Evosep One, nanoElute 2…" />
            </div>
          </div>
          <div style={{ marginBottom:'.5rem' }}>
            {label('Notes')}
            <input style={inp} value={f.notes} onChange={e=>set('notes',e.target.value)}
              placeholder="Part number, lot, special instructions…" />
          </div>
          <div style={{ display:'flex', gap:'.5rem' }}>
            <button onClick={save} disabled={!f.name.trim()||saving}
              style={{ padding:'.3rem .9rem', background: f.name.trim()&&!saving ? '#22d3ee' : 'var(--border)',
                       color: f.name.trim()&&!saving ? '#04000c' : 'var(--muted)',
                       border:'none', borderRadius:'.35rem', fontWeight:700, fontSize:'.8rem',
                       cursor: f.name.trim()&&!saving ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={onCancel}
              style={{ padding:'.3rem .9rem', background:'var(--surface)', color:'var(--muted)',
                       border:'1px solid var(--border)', borderRadius:'.35rem', fontSize:'.8rem', cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      );
    }

    /* ── LC form ─────────────────────────────────────────────────────── */
    function LcForm({ initial, onSave, onCancel }) {
      const [f, setF] = useState({ ...BLANK_LC, ...(initial || {}) });
      const set = (k, v) => setF(p => ({ ...p, [k]: v }));
      const [saving, setSaving] = useState(false);

      const save = async () => {
        if (!f.name.trim()) return;
        setSaving(true);
        const method = f.id ? 'PUT' : 'POST';
        const url    = f.id ? `/api/catalog/lc/${f.id}` : '/api/catalog/lc';
        const body   = { ...f, flow_nl_min: f.flow_nl_min === '' ? null : parseFloat(f.flow_nl_min) || null };
        await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        setSaving(false);
        onSave();
      };

      const inp = { background:'var(--bg)', color:'var(--text)', border:'1px solid var(--border)',
                    borderRadius:'.35rem', padding:'.3rem .5rem', fontSize:'.8rem', width:'100%' };
      const label = (t) => React.createElement('div', { style:{ fontSize:'.65rem', color:'#64748b',
        textTransform:'uppercase', letterSpacing:'.06em', marginBottom:'.15rem' } }, t);

      return (
        <div style={{ background:'rgba(0,0,0,0.3)', border:'1px solid rgba(168,85,247,0.25)',
                      borderRadius:'.5rem', padding:'.85rem 1rem', marginBottom:'.75rem' }}>
          <div style={{ fontWeight:700, color:'#a855f7', fontSize:'.82rem', marginBottom:'.65rem' }}>
            {f.id ? 'Edit LC System' : 'Add LC System'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:'.5rem', marginBottom:'.5rem' }}>
            <div>
              {label('Name *')}
              <input style={inp} value={f.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Evosep One" />
            </div>
            <div>
              {label('Vendor')}
              <select style={inp} value={f.vendor} onChange={e=>set('vendor',e.target.value)}>
                {LC_VENDORS.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              {label('Flow (nl/min)')}
              <input style={inp} type="number" step="10" value={f.flow_nl_min} onChange={e=>set('flow_nl_min',e.target.value)} placeholder="200" />
            </div>
            <div>
              {label('Gradient type')}
              <input style={inp} value={f.gradient_type} onChange={e=>set('gradient_type',e.target.value)} placeholder="SPD / linear / stepped" />
            </div>
          </div>
          <div style={{ marginBottom:'.5rem' }}>
            {label('Notes')}
            <input style={inp} value={f.notes} onChange={e=>set('notes',e.target.value)} placeholder="Serial, firmware, special config…" />
          </div>
          <div style={{ display:'flex', gap:'.5rem' }}>
            <button onClick={save} disabled={!f.name.trim()||saving}
              style={{ padding:'.3rem .9rem', background: f.name.trim()&&!saving ? '#a855f7' : 'var(--border)',
                       color: f.name.trim()&&!saving ? '#fff' : 'var(--muted)',
                       border:'none', borderRadius:'.35rem', fontWeight:700, fontSize:'.8rem',
                       cursor: f.name.trim()&&!saving ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={onCancel}
              style={{ padding:'.3rem .9rem', background:'var(--surface)', color:'var(--muted)',
                       border:'1px solid var(--border)', borderRadius:'.35rem', fontSize:'.8rem', cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      );
    }

    /* ── Column spec pill ────────────────────────────────────────────── */
    function ColSpecPills({ col }) {
      const specs = [
        col.particle_um   && `${col.particle_um}µm`,
        col.pore_a        && `${col.pore_a}Å`,
        col.length_cm     && `${col.length_cm}cm`,
        col.id_um         && `${col.id_um}µm ID`,
        col.chemistry     && col.chemistry !== 'C18' && col.chemistry,
      ].filter(Boolean);
      return (
        <span style={{ display:'inline-flex', gap:'.2rem', flexWrap:'wrap' }}>
          {specs.map(s => (
            <span key={s} style={{ fontSize:'.65rem', padding:'.05rem .3rem', borderRadius:'.2rem',
              background:'rgba(34,211,238,0.1)', border:'1px solid rgba(34,211,238,0.2)', color:'#64748b' }}>
              {s}
            </span>
          ))}
          {col.gradient_name && (
            <span style={{ fontSize:'.65rem', padding:'.05rem .3rem', borderRadius:'.2rem',
              background:'rgba(218,170,0,0.1)', border:'1px solid rgba(218,170,0,0.2)', color:'#DAAA00' }}>
              {col.gradient_name}
            </span>
          )}
        </span>
      );
    }

    /* ── Run Assignment panel ────────────────────────────────────────── */
    function RunAssignPanel({ columns, lcs }) {
      const { data: runs, reload } = useFetch('/api/runs?limit=500');
      const runsArr = Array.isArray(runs) ? runs : [];
      const [saving, setSaving] = useState({});
      const [edits, setEdits] = useState({});   // run_id → {column_id, lc_id}

      // Build maps for display
      const colMap = Object.fromEntries((columns||[]).map(c => [c.id, c]));
      const lcMap  = Object.fromEntries((lcs||[]).map(l => [l.id, l]));

      const getEdit = (r) => edits[r.id] ?? { column_id: r.column_id ?? '', lc_id: r.lc_id ?? '' };

      const setEdit = (runId, field, val) => setEdits(p => ({
        ...p,
        [runId]: { ...getEdit({ id: runId, column_id: null, lc_id: null }), ...p[runId], [field]: val },
      }));

      const save = async (r) => {
        const e = getEdit(r);
        setSaving(p => ({ ...p, [r.id]: true }));
        await fetch(`/api/runs/${r.id}/setup`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            column_id: e.column_id === '' ? null : parseInt(e.column_id) || null,
            lc_id:     e.lc_id     === '' ? null : parseInt(e.lc_id)     || null,
          }),
        });
        setSaving(p => ({ ...p, [r.id]: false }));
        setEdits(p => { const n = {...p}; delete n[r.id]; return n; });
        reload();
      };

      const inp = { background:'var(--bg)', color:'var(--text)', border:'1px solid var(--border)',
                    borderRadius:'.3rem', padding:'.22rem .4rem', fontSize:'.76rem' };

      // Show only recent 50 runs to keep it manageable
      const visible = runsArr.slice(0, 50);

      return (
        <div>
          <div style={{ fontSize:'.68rem', color:'#64748b', marginBottom:'.5rem' }}>
            Showing most recent {visible.length} of {runsArr.length} runs.
            Changes are saved immediately per row.
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'.78rem' }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--border)' }}>
                  {['Run name','Instrument','Date','Column','LC'].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'.3rem .5rem', color:'var(--muted)',
                                         fontSize:'.63rem', textTransform:'uppercase', letterSpacing:'.06em',
                                         fontWeight:600 }}>{h}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const e = getEdit(r);
                  const dirty = (String(e.column_id||'') !== String(r.column_id||''))
                             || (String(e.lc_id||'')     !== String(r.lc_id||''));
                  return (
                    <tr key={r.id} style={{ borderBottom:'1px solid rgba(61,16,96,0.25)' }}>
                      <td style={{ padding:'.3rem .5rem', maxWidth:'220px', overflow:'hidden',
                                   textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                          title={r.run_name}>{r.run_name}</td>
                      <td style={{ padding:'.3rem .5rem', color:'#64748b', fontSize:'.73rem' }}>{r.instrument}</td>
                      <td style={{ padding:'.3rem .5rem', color:'#64748b', fontSize:'.73rem', whiteSpace:'nowrap' }}>
                        {r.run_date ? r.run_date.slice(0,10) : '—'}
                      </td>
                      <td style={{ padding:'.3rem .5rem' }}>
                        <select value={e.column_id||''} onChange={ev=>setEdit(r.id,'column_id',ev.target.value)}
                          style={{ ...inp, maxWidth:'200px' }}>
                          <option value="">— none —</option>
                          {(columns||[]).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding:'.3rem .5rem' }}>
                        <select value={e.lc_id||''} onChange={ev=>setEdit(r.id,'lc_id',ev.target.value)}
                          style={{ ...inp, maxWidth:'160px' }}>
                          <option value="">— none —</option>
                          {(lcs||[]).map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding:'.3rem .5rem' }}>
                        {dirty && (
                          <button onClick={()=>save(r)} disabled={saving[r.id]}
                            style={{ padding:'.2rem .6rem', background:'#22d3ee', color:'#04000c',
                                     border:'none', borderRadius:'.3rem', fontWeight:700, fontSize:'.75rem',
                                     cursor:'pointer' }}>
                            {saving[r.id] ? '…' : 'Save'}
                          </button>
                        )}
                        {!dirty && (e.column_id||e.lc_id) && (
                          <span style={{ fontSize:'.65rem', color:'#334155' }}>✓</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    /* ── Main Tab ────────────────────────────────────────────────────── */
    function LabSetupTab() {
      const { data: columns, reload: reloadCols } = useFetch('/api/catalog/columns');
      const { data: lcs,     reload: reloadLcs  } = useFetch('/api/catalog/lc');

      const [addingCol,  setAddingCol]  = useState(false);
      const [editCol,    setEditCol]    = useState(null);
      const [addingLc,   setAddingLc]   = useState(false);
      const [editLc,     setEditLc]     = useState(null);
      const [activePane, setActivePane] = useState('columns'); // 'columns' | 'lc' | 'assign'

      const colArr = Array.isArray(columns) ? columns : [];
      const lcArr  = Array.isArray(lcs)     ? lcs     : [];

      const deleteCol = async (id) => {
        if (!confirm('Delete this column?')) return;
        await fetch(`/api/catalog/columns/${id}`, { method:'DELETE' });
        reloadCols();
      };
      const deleteLc = async (id) => {
        if (!confirm('Delete this LC system?')) return;
        await fetch(`/api/catalog/lc/${id}`, { method:'DELETE' });
        reloadLcs();
      };

      const tabBtn = (key, label, col) => (
        <div onClick={()=>setActivePane(key)} style={{
          padding:'.4rem .9rem', borderRadius:'.4rem', cursor:'pointer', fontSize:'.8rem', fontWeight:700,
          background: activePane===key ? `${col}20` : 'transparent',
          border: activePane===key ? `1px solid ${col}50` : '1px solid transparent',
          color: activePane===key ? col : 'var(--muted)',
        }}>{label}</div>
      );

      return (
        <div style={{ maxWidth:'1100px', margin:'0 auto' }}>

          {/* Header */}
          <div className="card" style={{ marginBottom:'.75rem', padding:'.85rem 1rem',
                                          border:'1px solid rgba(218,170,0,0.2)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start',
                          flexWrap:'wrap', gap:'.5rem' }}>
              <div>
                <div style={{ fontWeight:900, fontSize:'1.05rem', color:'#DAAA00', marginBottom:'.25rem' }}>
                  ⊛ Lab Setup — Columns, LC &amp; Instrument Catalog
                </div>
                <div style={{ fontSize:'.76rem', color:'#64748b', lineHeight:1.5 }}>
                  Build your consumables catalog, then tag each run with the column and LC used.
                  Filters in Run History become available once runs are tagged.
                </div>
              </div>
              <div style={{ display:'flex', gap:'.35rem', flexShrink:0, padding:'.15rem 0' }}>
                {tabBtn('columns', `Columns (${colArr.length})`, '#22d3ee')}
                {tabBtn('lc',      `LC Systems (${lcArr.length})`, '#a855f7')}
                {tabBtn('assign',  'Tag Runs', '#DAAA00')}
              </div>
            </div>
          </div>

          {/* ── Columns pane ── */}
          {activePane === 'columns' && (
            <div>
              {(addingCol || editCol) ? (
                <ColumnForm
                  initial={editCol}
                  onSave={()=>{ setAddingCol(false); setEditCol(null); reloadCols(); }}
                  onCancel={()=>{ setAddingCol(false); setEditCol(null); }}
                />
              ) : (
                <button onClick={()=>setAddingCol(true)}
                  style={{ marginBottom:'.65rem', padding:'.38rem 1rem', background:'rgba(34,211,238,0.15)',
                           color:'#22d3ee', border:'1px solid rgba(34,211,238,0.3)',
                           borderRadius:'.4rem', fontWeight:700, fontSize:'.82rem', cursor:'pointer' }}>
                  + Add Column
                </button>
              )}

              {colArr.length === 0 && !addingCol && (
                <div className="card" style={{ padding:'2rem', textAlign:'center', color:'#334155' }}>
                  No columns in catalog yet. Click <b>+ Add Column</b> to start,
                  or paste your PepSep list and save each entry.
                </div>
              )}

              {colArr.length > 0 && (
                <div className="card" style={{ border:'1px solid rgba(34,211,238,0.15)', padding:'.85rem 1rem' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'.78rem' }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--border)' }}>
                        {['Name','Vendor','Specs','Gradient / Method','Compatible LC','Notes',''].map(h=>(
                          <th key={h} style={{ textAlign:'left', padding:'.3rem .5rem', color:'var(--muted)',
                                               fontSize:'.63rem', textTransform:'uppercase', letterSpacing:'.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {colArr.map(c => (
                        <tr key={c.id} style={{ borderBottom:'1px solid rgba(61,16,96,0.25)' }}>
                          <td style={{ padding:'.35rem .5rem', fontWeight:600, color:'#e2e8f0' }}>{c.name}</td>
                          <td style={{ padding:'.35rem .5rem', color:'#64748b', whiteSpace:'nowrap' }}>{c.vendor}</td>
                          <td style={{ padding:'.35rem .5rem' }}><ColSpecPills col={c} /></td>
                          <td style={{ padding:'.35rem .5rem', color:'#DAAA00', fontSize:'.73rem' }}>{c.gradient_name||'—'}</td>
                          <td style={{ padding:'.35rem .5rem', color:'#64748b', fontSize:'.73rem' }}>{c.compatible_lc||'—'}</td>
                          <td style={{ padding:'.35rem .5rem', color:'#475569', fontSize:'.72rem',
                                       maxWidth:'160px', overflow:'hidden', textOverflow:'ellipsis',
                                       whiteSpace:'nowrap' }}>{c.notes||''}</td>
                          <td style={{ padding:'.35rem .5rem', whiteSpace:'nowrap' }}>
                            <button onClick={()=>{ setAddingCol(false); setEditCol(c); }}
                              style={{ marginRight:'.3rem', padding:'.18rem .5rem', fontSize:'.72rem',
                                       background:'var(--surface)', color:'#22d3ee', border:'1px solid rgba(34,211,238,0.3)',
                                       borderRadius:'.25rem', cursor:'pointer' }}>Edit</button>
                            <button onClick={()=>deleteCol(c.id)}
                              style={{ padding:'.18rem .5rem', fontSize:'.72rem',
                                       background:'var(--surface)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)',
                                       borderRadius:'.25rem', cursor:'pointer' }}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── LC pane ── */}
          {activePane === 'lc' && (
            <div>
              {(addingLc || editLc) ? (
                <LcForm
                  initial={editLc}
                  onSave={()=>{ setAddingLc(false); setEditLc(null); reloadLcs(); }}
                  onCancel={()=>{ setAddingLc(false); setEditLc(null); }}
                />
              ) : (
                <button onClick={()=>setAddingLc(true)}
                  style={{ marginBottom:'.65rem', padding:'.38rem 1rem', background:'rgba(168,85,247,0.15)',
                           color:'#a855f7', border:'1px solid rgba(168,85,247,0.3)',
                           borderRadius:'.4rem', fontWeight:700, fontSize:'.82rem', cursor:'pointer' }}>
                  + Add LC System
                </button>
              )}

              {lcArr.length === 0 && !addingLc && (
                <div className="card" style={{ padding:'2rem', textAlign:'center', color:'#334155' }}>
                  No LC systems in catalog yet. Click <b>+ Add LC System</b> to start.
                </div>
              )}

              {lcArr.length > 0 && (
                <div className="card" style={{ border:'1px solid rgba(168,85,247,0.15)', padding:'.85rem 1rem' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'.78rem' }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--border)' }}>
                        {['Name','Vendor','Flow (nl/min)','Gradient type','Notes',''].map(h=>(
                          <th key={h} style={{ textAlign:'left', padding:'.3rem .5rem', color:'var(--muted)',
                                               fontSize:'.63rem', textTransform:'uppercase', letterSpacing:'.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lcArr.map(l => (
                        <tr key={l.id} style={{ borderBottom:'1px solid rgba(61,16,96,0.25)' }}>
                          <td style={{ padding:'.35rem .5rem', fontWeight:600, color:'#e2e8f0' }}>{l.name}</td>
                          <td style={{ padding:'.35rem .5rem', color:'#64748b' }}>{l.vendor}</td>
                          <td style={{ padding:'.35rem .5rem', fontFamily:'monospace', color:'#a855f7' }}>
                            {l.flow_nl_min ? `${l.flow_nl_min} nl/min` : '—'}
                          </td>
                          <td style={{ padding:'.35rem .5rem', color:'#64748b' }}>{l.gradient_type||'—'}</td>
                          <td style={{ padding:'.35rem .5rem', color:'#475569', fontSize:'.72rem',
                                       maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis',
                                       whiteSpace:'nowrap' }}>{l.notes||''}</td>
                          <td style={{ padding:'.35rem .5rem', whiteSpace:'nowrap' }}>
                            <button onClick={()=>{ setAddingLc(false); setEditLc(l); }}
                              style={{ marginRight:'.3rem', padding:'.18rem .5rem', fontSize:'.72rem',
                                       background:'var(--surface)', color:'#a855f7', border:'1px solid rgba(168,85,247,0.3)',
                                       borderRadius:'.25rem', cursor:'pointer' }}>Edit</button>
                            <button onClick={()=>deleteLc(l.id)}
                              style={{ padding:'.18rem .5rem', fontSize:'.72rem',
                                       background:'var(--surface)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)',
                                       borderRadius:'.25rem', cursor:'pointer' }}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Assign pane ── */}
          {activePane === 'assign' && (
            <div className="card" style={{ border:'1px solid rgba(218,170,0,0.2)', padding:'.85rem 1rem' }}>
              <div style={{ fontSize:'.7rem', color:'#DAAA00', fontWeight:700, textTransform:'uppercase',
                            letterSpacing:'.1em', marginBottom:'.6rem' }}>
                ⊛ Tag runs with column &amp; LC
              </div>
              {colArr.length === 0 && lcArr.length === 0 ? (
                <div style={{ color:'#475569', fontSize:'.78rem', padding:'1rem 0' }}>
                  Add columns and LC systems in the Columns and LC tabs first,
                  then come back here to assign them to runs.
                </div>
              ) : (
                <RunAssignPanel columns={colArr} lcs={lcArr} />
              )}
            </div>
          )}

          {/* ── Guide ── */}
          <div className="card" style={{ marginTop:'.75rem', border:'1px solid rgba(61,16,96,0.3)',
                                          padding:'.75rem 1rem' }}>
            <div style={{ fontSize:'.68rem', color:'#a855f7', fontWeight:700, textTransform:'uppercase',
                          letterSpacing:'.1em', marginBottom:'.4rem' }}>⊛ How filtering works</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:'.5rem' }}>
              {[
                ['1. Build catalog', 'Add every column and LC you use. Include particle size, length, and gradient name so you can tell configurations apart at a glance.'],
                ['2. Tag your runs', 'In the "Tag Runs" pane, assign a column and LC to each run. This only needs to be done once per run.'],
                ['3. Filter Run History', 'Column and LC dropdowns appear in Run History once your catalog is populated. Filter to any combination of column + LC + mass spec.'],
                ['4. Compare methods', 'Use Trends/Health with pinned runs to compare ID counts, peak width, and mass accuracy across column types or gradient lengths.'],
              ].map(([title, body]) => (
                <div key={title} style={{ background:'rgba(0,0,0,0.2)', borderRadius:'.35rem',
                                           padding:'.5rem .7rem', border:'1px solid rgba(61,16,96,0.3)' }}>
                  <div style={{ fontSize:'.72rem', fontWeight:700, color:'#94a3b8', marginBottom:'.2rem' }}>{title}</div>
                  <div style={{ fontSize:'.7rem', color:'#475569', lineHeight:1.5 }}>{body}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      );
    }
