import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow, ReactFlowProvider, useNodesInitialized,
  type Node, type Edge as RFEdge, type NodeProps,
} from '@xyflow/react'
import Editor, { type Focus } from './Editor'
import { analyze } from './core/relations'
import { SAMPLE } from './core/sample'
import { fetchUrls, parseUrlList } from './core/importer'
import { defaultHelm, helmCommands, helmCaveats, type HelmOpts } from './core/helm'
import type { Analysis, EdgeType, Resource } from './core/types'
import { layout, nsLabel, NODE_H, NODE_W, type LayoutResult } from './layout'
import { iconFor } from './icons'

const EDGE_STYLE: Record<EdgeType, { color: string; name: string; help: string }> = {
  owns: { color: '#7c3aed', name: 'owns', help: 'explicit metadata.ownerReferences' },
  selects: { color: '#0891b2', name: 'selects', help: 'label selector match (inferred from labels)' },
  references: { color: '#64748b', name: 'references', help: 'named reference in the spec' },
  routes: { color: '#ea580c', name: 'routes to', help: 'Ingress / Gateway API backend' },
}

type Dlg = null | 'import' | 'helm' | 'help'

function ResNode({ data }: NodeProps) {
  const r = data.res as Resource
  const icon = iconFor(r.kind)
  return (
    <div className={`rnode ${r.ghost ? 'ghost' : ''} ${data.dim ? 'dim' : ''} ${data.selected ? 'sel' : ''} ${data.problem ? 'prob-' + data.problem : ''}`}
      title={`${r.apiVersion} ${r.kind}/${r.name}${r.ghost ? ' (referenced, not in input)' : ''}`}>
      <Handle type="target" position={Position.Left} />
      {icon ? <img src={icon} alt="" className="ricon" draggable={false} /> : <div className="ricon generic" title="Custom or unrecognised kind">{r.kind.slice(0, 2)}</div>}
      <div className="rtext">
        <div className="rkind">{r.kind}{r.ghost ? ' · not in input' : ''}</div>
        <div className="rname">{r.name}</div>
      </div>
      {data.problem ? <span className={`pbadge ${data.problem}`}>{data.problem === 'info' ? 'i' : '!'}</span> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
function GroupNode({ data }: NodeProps) {
  return <div className="gnode"><span>{String(data.label)}</span></div>
}
const nodeTypes = { res: ResNode, group: GroupNode }

function Graph(props: {
  a: Analysis; lay: LayoutResult | null; hidden: Set<string>; selected: string | null; search: string;
  onSelect: (id: string | null) => void; fitKey: number
}) {
  const { a, lay, hidden, selected, search, onSelect, fitKey } = props
  const rf = useReactFlow()
  const byId = useMemo(() => new Map(a.resources.map((r) => [r.id, r])), [a])
  const problems = useMemo(() => {
    const m = new Map<string, string>()
    const rank: Record<string, number> = { info: 1, warning: 2, error: 3 }
    for (const d of a.diagnostics) if (d.resourceId) {
      const cur = m.get(d.resourceId)
      if (!cur || rank[d.severity] > rank[cur]) m.set(d.resourceId, d.severity)
    }
    return m
  }, [a])
  const neighbours = useMemo(() => {
    const s = new Set<string>()
    if (selected) { s.add(selected); for (const e of a.edges) { if (e.source === selected) s.add(e.target); if (e.target === selected) s.add(e.source) } }
    return s
  }, [a, selected])
  const q = search.trim().toLowerCase()

  const nodes: Node[] = useMemo(() => {
    if (!lay) return []
    const out: Node[] = lay.groups.map((g) => ({
      id: g.id, type: 'group', position: { x: g.x, y: g.y }, data: { label: nsLabel(g.id.slice(3)) },
      style: { width: g.w, height: g.h }, selectable: false, draggable: false, zIndex: 0,
    }))
    for (const n of lay.nodes) {
      const r = byId.get(n.id)
      if (!r) continue
      const match = !q || `${r.kind} ${r.name}`.toLowerCase().includes(q)
      out.push({
        id: n.id, type: 'res', parentId: n.parent, position: { x: n.x, y: n.y }, width: NODE_W, height: NODE_H, zIndex: 2,
        data: { res: r, selected: selected === n.id, dim: (selected && !neighbours.has(n.id)) || !match, problem: problems.get(n.id) },
      })
    }
    return out
  }, [lay, byId, selected, neighbours, q, problems])

  const edges: RFEdge[] = useMemo(() => {
    const ids = new Set(lay?.nodes.map((n) => n.id))
    return a.edges.filter((e) => !hidden.has(e.type) && ids.has(e.source) && ids.has(e.target)).map((e) => {
      const st = EDGE_STYLE[e.type]
      const active = !selected || e.source === selected || e.target === selected
      return {
        id: e.id, source: e.source, target: e.target, label: e.label, type: 'default', zIndex: 1,
        style: { stroke: st.color, strokeWidth: active ? 2 : 1, strokeDasharray: e.inferred ? '6 4' : undefined, opacity: active ? 1 : 0.15 },
        labelStyle: { fontSize: 10, fill: st.color, opacity: active ? 1 : 0.15 },
        labelBgStyle: { fill: '#fff', fillOpacity: 0.85 },
        markerEnd: { type: MarkerType.ArrowClosed, color: st.color, width: 16, height: 16 },
        data: { edge: e },
      }
    })
  }, [a, hidden, lay, selected])

  const ready = useNodesInitialized()
  useEffect(() => { if (lay && ready) { const t = setTimeout(() => rf.fitView({ padding: 0.08, duration: 200 }), 60); return () => clearTimeout(t) } }, [fitKey, ready, lay === null]) // eslint-disable-line
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.1} maxZoom={2} nodesDraggable={false} nodesConnectable={false}
      onNodeClick={(_, n) => n.type === 'res' && onSelect(n.id)} onPaneClick={() => onSelect(null)} onEdgeClick={(_, e) => onSelect((e.data as any).edge.source)}
      fitView proOptions={{ hideAttribution: false }}>
      <Background gap={20} color="#e2e8f0" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'group' ? '#f1f5f9' : '#94a3b8')} />
    </ReactFlow>
  )
}

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return <button className="btn sm" onClick={async () => {
    try { await navigator.clipboard.writeText(text) } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove() }
    setOk(true); setTimeout(() => setOk(false), 1500)
  }}>{ok ? 'Copied' : 'Copy'}</button>
}

function ImportDialog({ onClose, onLoad }: { onClose: () => void; onLoad: (text: string, source: string) => void }) {
  const [tab, setTab] = useState<'paste' | 'url' | 'file'>('paste')
  const [text, setText] = useState('')
  const [urls, setUrls] = useState('')
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState<string[]>([])
  const file = useRef<HTMLInputElement>(null)
  const go = async () => {
    if (tab === 'paste') { onLoad(text, 'pasted text'); return }
    const list = parseUrlList(urls)
    if (!list.length) { setErrs(['Enter at least one http(s) URL.']); return }
    setBusy(true)
    const r = await fetchUrls(list)
    setBusy(false); setErrs(r.errors)
    if (r.text) { onLoad(r.text, list.join(', ')); }
  }
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Import manifests">
        <h2>Load manifests</h2>
        <div className="tabs">
          {(['paste', 'url', 'file'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'paste' ? 'Paste text' : t === 'url' ? 'From URL' : 'Open file'}</button>)}
        </div>
        {tab === 'paste' && <textarea autoFocus placeholder="Paste one or more Kubernetes YAML documents (--- separated)..." value={text} onChange={(e) => setText(e.target.value)} />}
        {tab === 'url' && <>
          <textarea autoFocus placeholder={'One public raw URL per line, e.g.\nhttps://raw.githubusercontent.com/user/repo/main/deploy.yaml\n(GitHub/GitLab "blob" links are converted to raw automatically)'} value={urls} onChange={(e) => setUrls(e.target.value)} />
          <p className="muted">Fetched by your browser, so the server must allow cross-origin requests (raw.githubusercontent.com does). Private repos are not supported here.</p>
        </>}
        {tab === 'file' && <div className="filebox">
          <input ref={file} type="file" accept=".yaml,.yml,.json,.txt" multiple onChange={async (e) => {
            const fs = [...(e.target.files ?? [])]
            const parts = await Promise.all(fs.map(async (f) => `# source: ${f.name}\n${await f.text()}`))
            if (parts.length) onLoad(parts.join('\n---\n'), fs.map((f) => f.name).join(', '))
          }} />
          <p className="muted">Files are read in your browser only. Nothing is uploaded.</p>
        </div>}
        {errs.length > 0 && <div className="errbox">{errs.map((e, i) => <div key={i}>{e}</div>)}</div>}
        <div className="row end">
          <button className="btn" onClick={onClose}>Cancel</button>
          {tab !== 'file' && <button className="btn primary" disabled={busy || (tab === 'paste' ? !text.trim() : !urls.trim())} onClick={go}>{busy ? 'Loading...' : 'Show map'}</button>}
        </div>
      </div>
    </div>
  )
}

function HelmDialog({ onClose }: { onClose: () => void }) {
  const [o, setO] = useState<HelmOpts>(() => { try { return { ...defaultHelm, ...JSON.parse(localStorage.getItem('kubekin.helm') ?? '{}') } } catch { return defaultHelm } })
  useEffect(() => { localStorage.setItem('kubekin.helm', JSON.stringify(o)) }, [o])
  const cmds = helmCommands(o)
  const f = (k: keyof HelmOpts, label: string, ph = '') => <label>{label}<input value={o[k] as string} placeholder={ph} onChange={(e) => setO({ ...o, [k]: e.target.value })} /></label>
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Helm hints">
        <h2>Helm charts: render, copy, paste</h2>
        <p className="muted">KubeKin reads rendered YAML, not chart templates. Fill in your chart, run one command below in a terminal, then paste (the command copies the output to your clipboard).</p>
        <div className="grid2">
          {f('release', 'Release name', 'my-release')}{f('chart', 'Chart (path, repo/name or oci://)', './chart')}
          {f('namespace', 'Namespace', 'default')}{f('values', 'Values file (-f)', 'values.yaml')}
          {f('repoName', 'Repo name (optional)', 'bitnami')}{f('repoUrl', 'Repo URL (optional)', 'https://charts.bitnami.com/bitnami')}
          {f('version', 'Chart version (optional)', '1.2.3')}
          <label className="chk"><input type="checkbox" checked={o.includeCrds} onChange={(e) => setO({ ...o, includeCrds: e.target.checked })} /> --include-crds</label>
        </div>
        {cmds.map((c) => (
          <div className="cmd" key={c.id}>
            <div className="row between"><strong>{c.title}</strong><Copy text={c.command} /></div>
            <pre>{c.command}</pre>
            <div className="muted">{c.note}</div>
          </div>
        ))}
        <ul className="muted">{helmCaveats.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="row end"><button className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  )
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>How to read the map</h2>
        <p>Boxes are resources, grouped by namespace. Arrows show how a manifest relates to another one. Everything is derived from the YAML text only; KubeKin never contacts a cluster.</p>
        <ul className="legend-list">
          {(Object.keys(EDGE_STYLE) as EdgeType[]).map((t) => <li key={t}><span className="swatch" style={{ background: EDGE_STYLE[t].color }} /> <strong>{EDGE_STYLE[t].name}</strong>: {EDGE_STYLE[t].help}</li>)}
          <li><span className="swatch dashed" /> <strong>Dashed line</strong>: inferred by matching labels. It says "this selector would match that pod template", not that a live Pod exists.</li>
          <li><span className="swatch ghostsw" /> <strong>Dashed box "not in input"</strong>: referenced by name but not defined in what you loaded (often in another file).</li>
        </ul>
        <p>Click a box or a problem to jump to the exact YAML. Click in the editor to highlight the resource. Edits update the map after a short pause. The Original tab keeps what you loaded; the Working copy is yours to edit.</p>
        <p className="muted">Custom resources without a built-in rule appear as plain boxes with no invented links. Kubernetes icons: Kubernetes community, Apache-2.0.</p>
        <div className="row end"><button className="btn primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  )
}

function Inner() {
  const [original, setOriginal] = useState(SAMPLE)
  const [source, setSource] = useState('built-in sample')
  const [working, setWorking] = useState(SAMPLE)
  const [tab, setTab] = useState<'work' | 'orig'>('work')
  const [rtab, setRtab] = useState<'details' | 'problems'>('details')
  const [dlg, setDlg] = useState<Dlg>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [lay, setLay] = useState<LayoutResult | null>(null)
  const [fitKey, setFitKey] = useState(0)
  const [debounced, setDebounced] = useState(SAMPLE)
  const nonce = useRef(0)
  const [wide, setWide] = useState(false)

  useEffect(() => { const t = setTimeout(() => setDebounced(working), 300); return () => clearTimeout(t) }, [working])
  const a = useMemo(() => analyze(debounced), [debounced])
  const pending = debounced !== working

  // layout depends on structure only (not on selection)
  const structKey = useMemo(() => a.resources.map((r) => r.id).join('|') + '#' + a.edges.map((e) => e.source + e.target + e.type).join('|') + '#' + [...hidden].join(','), [a, hidden])
  const lastStruct = useRef('')
  useEffect(() => {
    let live = true
    layout(a, hidden).then((l) => { if (live) { setLay(l); if (lastStruct.current === '' ) setFitKey((k) => k + 1); lastStruct.current = structKey } }).catch(() => {})
    return () => { live = false }
  }, [structKey]) // eslint-disable-line

  const jump = useCallback((range?: [number, number]) => {
    if (!range) return
    setTab('work')
    setFocus({ from: range[0], to: range[1], nonce: ++nonce.current })
  }, [])
  const resById = useMemo(() => new Map(a.resources.map((r) => [r.id, r])), [a])
  const sel = selected ? resById.get(selected) : undefined
  useEffect(() => { if (selected && !resById.has(selected)) setSelected(null) }, [resById, selected])

  const onSelect = (id: string | null) => {
    setSelected(id)
    if (id) { setRtab('details'); const r = resById.get(id); if (r && !r.ghost) jump(r.range) }
  }
  const onCursor = (pos: number) => {
    const hit = a.resources.filter((r) => !r.ghost && r.range[0] <= pos && pos <= r.range[1]).sort((x, y) => (x.range[1] - x.range[0]) - (y.range[1] - y.range[0]))[0]
    setSelected(hit ? hit.id : null)
    if (hit) setRtab('details')
  }
  const load = (text: string, src: string) => { setOriginal(text); setWorking(text); setDebounced(text); setSource(src); setDlg(null); setSelected(null); setTab('work'); lastStruct.current = ''; setFitKey((k) => k + 1) }
  const modified = working !== original
  const errCount = a.diagnostics.filter((d) => d.severity === 'error').length
  const rels = sel ? a.edges.filter((e) => e.source === sel.id || e.target === sel.id) : []
  const empty = a.resources.length === 0

  return (
    <div className="app">
      <header>
        <div className="brand"><img src={`${import.meta.env.BASE_URL}icons/deploy.svg`} alt="" /> <b>KubeKin</b><span className="tag">manifest relationship map</span></div>
        <div className="row grow">
          <button className="btn primary" onClick={() => setDlg('import')}>Load manifests</button>
          <button className="btn" onClick={() => load(SAMPLE, 'built-in sample')}>Sample</button>
          <button className="btn" onClick={() => setDlg('helm')}>Helm hints</button>
          <input className="search" placeholder="Find kind or name..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn" onClick={() => { setWide(!wide); setFitKey((k) => k + 1) }}>{wide ? 'Show panels' : 'Focus map'}</button>
        <button className="btn" onClick={() => setDlg('help')}>How to read</button>
      </header>
      <main className={wide ? 'wide' : ''}>
        <section className="left">
          <div className="tabs">
            <button className={tab === 'work' ? 'on' : ''} onClick={() => setTab('work')}>Working copy{modified ? ' ●' : ''}</button>
            <button className={tab === 'orig' ? 'on' : ''} onClick={() => setTab('orig')}>Original</button>
            <span className="grow" />
            {modified && <button className="btn sm" onClick={() => { setWorking(original); setDebounced(original) }}>Reset to original</button>}
          </div>
          <div className="srcline">Source: {source}{tab === 'orig' ? ' (read-only)' : ''}</div>
          <div className="editorwrap">
            {tab === 'work'
              ? <Editor key="w" value={working} onChange={setWorking} onCursor={onCursor} focus={focus} diagnostics={a.diagnostics} />
              : <Editor key="o" value={original} readOnly />}
          </div>
        </section>
        <section className="mid">
          {a.syntaxErrors > 0 && (
            <div className="banner err">{a.syntaxErrors} YAML syntax error{a.syntaxErrors > 1 ? 's' : ''}: the affected document{a.syntaxErrors > 1 ? 's are' : ' is'} missing from this map. <button className="link" onClick={() => { setRtab('problems') }}>See problems</button></div>
          )}
          {a.looksLikeHelmTemplate && <div className="banner warn">This looks like a Helm template, not rendered YAML. <button className="link" onClick={() => setDlg('helm')}>Show how to render it</button></div>}
          {pending && <div className="banner info">Updating map...</div>}
          {empty ? (
            <div className="empty">
              <h3>{working.trim() ? 'No Kubernetes resources found' : 'Nothing loaded yet'}</h3>
              <p>Paste YAML, fetch a raw Git URL, or open a file. Helm chart? Render it first with helm template.</p>
              <div className="row"><button className="btn primary" onClick={() => setDlg('import')}>Load manifests</button><button className="btn" onClick={() => load(SAMPLE, 'built-in sample')}>Try the sample</button><button className="btn" onClick={() => setDlg('helm')}>Helm hints</button></div>
            </div>
          ) : <Graph a={a} lay={lay} hidden={hidden} selected={selected} search={search} onSelect={onSelect} fitKey={fitKey} />}
          <div className="legend">
            {(Object.keys(EDGE_STYLE) as EdgeType[]).map((t) => (
              <label key={t} title={EDGE_STYLE[t].help}><input type="checkbox" checked={!hidden.has(t)} onChange={() => { const n = new Set(hidden); n.has(t) ? n.delete(t) : n.add(t); setHidden(n) }} />
                <span className="swatch" style={{ background: EDGE_STYLE[t].color }} />{EDGE_STYLE[t].name}</label>
            ))}
            <span className="muted">dashed = inferred from labels</span>
            <button className="btn sm" onClick={() => setFitKey((k) => k + 1)}>Fit</button>
          </div>
        </section>
        <aside className="right">
          <div className="tabs">
            <button className={rtab === 'details' ? 'on' : ''} onClick={() => setRtab('details')}>Details</button>
            <button className={rtab === 'problems' ? 'on' : ''} onClick={() => setRtab('problems')}>Problems{a.diagnostics.length ? ` (${a.diagnostics.length})` : ''}{errCount ? ' ⚠' : ''}</button>
          </div>
          <div className="panel">
            {rtab === 'details' && (sel ? (
              <>
                <div className="dhead">{iconFor(sel.kind) && <img src={iconFor(sel.kind)!} alt="" />}<div><div className="rkind">{sel.kind}</div><h3>{sel.name}</h3></div></div>
                <dl><dt>Namespace</dt><dd>{nsLabel(sel.namespace)}</dd><dt>apiVersion</dt><dd>{sel.apiVersion || 'n/a'}</dd></dl>
                {sel.ghost ? <p className="muted">Referenced by name, but not defined in the loaded text.</p> : <button className="btn sm" onClick={() => jump(sel.range)}>Show in YAML</button>}
                <h4>Relationships ({rels.length})</h4>
                {rels.length === 0 && <p className="muted">No links found. Unknown custom resources are shown without guessing.</p>}
                <ul className="rels">
                  {rels.map((e) => {
                    const out = e.source === sel.id
                    const other = resById.get(out ? e.target : e.source)
                    return (
                      <li key={e.id}>
                        <button className="link" onClick={() => other && onSelect(other.id)}>{out ? '→' : '←'} {EDGE_STYLE[e.type].name} · {other?.kind} {other?.name}</button>
                        <div className="muted">{e.label}{e.inferred ? ' · inferred from labels' : ''} · <button className="link" onClick={() => jump(e.evidenceRange)}>evidence{e.evidencePath ? `: ${e.evidencePath}` : ''}</button></div>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : <div className="muted pad">Click a resource on the map or in the YAML to see its relationships and jump to the source lines.<div className="stats">{a.resources.filter((r) => !r.ghost).length} resources · {a.edges.length} links · {a.diagnostics.length} notes</div></div>)}
            {rtab === 'problems' && (a.diagnostics.length === 0 ? <div className="muted pad">No problems found.</div> : (
              <ul className="probs">
                {[...a.diagnostics].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : y.severity === 'error' ? 1 : x.severity === 'warning' ? -1 : 1)).map((d) => (
                  <li key={d.id} className={d.severity}>
                    <button className="plink" onClick={() => { if (d.resourceId) setSelected(d.resourceId); jump(d.range) }}>
                      <span className={`pbadge ${d.severity}`}>{d.severity === 'info' ? 'i' : '!'}</span>
                      <span>{d.message}{d.range ? <em> (line {d.line ?? '?'})</em> : null}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </aside>
      </main>
      {dlg === 'import' && <ImportDialog onClose={() => setDlg(null)} onLoad={load} />}
      {dlg === 'helm' && <HelmDialog onClose={() => setDlg(null)} />}
      {dlg === 'help' && <HelpDialog onClose={() => setDlg(null)} />}
    </div>
  )
}
export default function App() { return <ReactFlowProvider><Inner /></ReactFlowProvider> }
