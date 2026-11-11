import { describe, expect, it } from 'vitest'
import { analyze } from './relations'
import { SAMPLE } from './sample'
import { helmCommands, defaultHelm } from './helm'

const has = (a: ReturnType<typeof analyze>, s: string, t: string, type: string) =>
  a.edges.some((e) => e.source === s && e.target === t && e.type === type)

describe('analyze', () => {
  const a = analyze(SAMPLE)
  it('parses all sample resources', () => {
    expect(a.syntaxErrors).toBe(0)
    expect(a.resources.filter((r) => !r.ghost).length).toBe(10)
  })
  it('Service selects Deployment via labels (inferred)', () => {
    expect(has(a, 'Service/shop/web', 'Deployment/shop/web', 'selects')).toBe(true)
    expect(a.edges.find((e) => e.type === 'selects')!.inferred).toBe(true)
  })
  it('Ingress routes to Service and missing api Service becomes a dashed ghost', () => {
    expect(has(a, 'Ingress/shop/web', 'Service/shop/web', 'routes')).toBe(true)
    const g = a.resources.find((r) => r.id === 'Service/shop/api')
    expect(g?.ghost).toBe(true)
  })
  it('workload references config, secret, pvc, sa; HPA scales deployment', () => {
    for (const t of ['ConfigMap/shop/web-config', 'Secret/shop/db-credentials', 'PersistentVolumeClaim/shop/web-data', 'ServiceAccount/shop/web'])
      expect(has(a, 'Deployment/shop/web', t, 'references')).toBe(true)
    expect(has(a, 'HorizontalPodAutoscaler/shop/web', 'Deployment/shop/web', 'references')).toBe(true)
  })
  it('evidence ranges point at the source text', () => {
    const e = a.edges.find((x) => x.source === 'Service/shop/web' && x.type === 'selects')!
    expect(SAMPLE.slice(...e.evidenceRange!)).toContain('app: web')
  })
  it('explicit ownerReferences produce owns edges; no invented Pods', () => {
    const y = `apiVersion: apps/v1
kind: ReplicaSet
metadata: { name: rs1, namespace: d, ownerReferences: [{ apiVersion: apps/v1, kind: Deployment, name: dep1 }] }
spec: { selector: { matchLabels: { a: b } }, template: { metadata: { labels: { a: b } } } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: dep1, namespace: d }
spec: { selector: { matchLabels: { a: b } }, template: { metadata: { labels: { a: b } } } }`
    const r = analyze(y)
    expect(has(r, 'Deployment/d/dep1', 'ReplicaSet/d/rs1', 'owns')).toBe(true)
    expect(r.resources.some((x) => x.kind === 'Pod')).toBe(false)
  })
  it('unknown CRs stay as plain nodes', () => {
    const r = analyze('apiVersion: foo.io/v1\nkind: Widget\nmetadata: { name: w }')
    expect(r.resources[0].kind).toBe('Widget')
    expect(r.edges.length).toBe(0)
  })
  it('syntax errors are reported per document and valid docs still map', () => {
    const r = analyze('apiVersion: v1\nkind: ConfigMap\nmetadata: { name: ok }\n---\nkind: [unclosed\n')
    expect(r.syntaxErrors).toBeGreaterThan(0)
    expect(r.resources.map((x) => x.name)).toEqual(['ok'])
  })
  it('flags Service with unmatched selector and helm templates', () => {
    const r = analyze('apiVersion: v1\nkind: Service\nmetadata: { name: s }\nspec: { selector: { x: y } }')
    expect(r.diagnostics.some((d) => /matches no workload/.test(d.message))).toBe(true)
    expect(analyze('name: {{ .Values.x }}').looksLikeHelmTemplate).toBe(true)
  })
  it('List kind is flattened', () => {
    const r = analyze('apiVersion: v1\nkind: List\nitems:\n  - {apiVersion: v1, kind: ConfigMap, metadata: {name: a}}\n  - {apiVersion: v1, kind: ConfigMap, metadata: {name: b}}')
    expect(r.resources.length).toBe(2)
  })
})
describe('helm', () => {
  it('has per-OS clipboard commands', () => {
    const c = helmCommands({ ...defaultHelm, release: 'r', chart: 'bitnami/nginx', repoName: 'bitnami', repoUrl: 'https://charts.bitnami.com/bitnami' })
    expect(c.find((x) => x.id === 'linux-x11')!.command).toContain('xclip')
    expect(c.find((x) => x.id === 'linux-wayland')!.command).toContain('wl-copy')
    expect(c.find((x) => x.id === 'windows')!.command).toContain('Set-Clipboard')
    expect(c.find((x) => x.id === 'windows')!.command).not.toContain('&&')
  })
})

it('owner evidence belongs to the child ownerReferences', () => {
  const text = 'apiVersion: v1\nkind: Pod\nmetadata: {name: p, ownerReferences: [{kind: ReplicaSet, name: rs}]}'; const r = analyze(text)
  expect(text.slice(...r.edges[0].evidenceRange!)).toContain('ReplicaSet')
})
it('rejects duplicate YAML keys instead of silently overwriting', () => {
  expect(analyze('kind: Pod\nkind: Service\nmetadata: {name: p}').syntaxErrors).toBeGreaterThan(0)
})
it('policy/v1 empty PDB selector selects all templates in its namespace', () => {
  const r = analyze('apiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata: {name: pdb}\nspec: {selector: {}}\n---\napiVersion: v1\nkind: Pod\nmetadata: {name: p}')
  expect(r.edges.some(e => e.type === 'selects')).toBe(true)
})
