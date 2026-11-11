import { apiGroup, identity, knownScope, type Scope } from './identity'
import { parseAllDocuments, LineCounter, isMap, isSeq, isScalar, type Document, type YAMLMap } from 'yaml'
import type { Diagnostic, Range, Resource } from './types'

export const CLUSTER_SCOPED = new Set([
  'Namespace', 'Node', 'PersistentVolume', 'StorageClass', 'ClusterRole', 'ClusterRoleBinding',
  'CustomResourceDefinition', 'PriorityClass', 'IngressClass', 'APIService', 'ClusterIssuer',
  'MutatingWebhookConfiguration', 'ValidatingWebhookConfiguration', 'GatewayClass', 'CSIDriver',
  'RuntimeClass', 'PodSecurityPolicy',
])

export interface ParseResult {
  resources: Resource[]
  diagnostics: Diagnostic[]
  syntaxErrors: number
  docCount: number
  looksLikeHelmTemplate: boolean
}

let dseq = 0
const did = () => `d${++dseq}`

export function parseManifests(text: string): ParseResult {
  const lc = new LineCounter()
  const docs = parseAllDocuments(text, { lineCounter: lc, prettyErrors: false, uniqueKeys: true })
  const resources: Resource[] = []
  const diagnostics: Diagnostic[] = []
  const scopes = new Map<string, Scope>()
  const inspectScope = (obj: any) => {
    if (obj?.kind === 'CustomResourceDefinition' && apiGroup(String(obj.apiVersion)) === 'apiextensions.k8s.io' && obj.spec?.group && obj.spec?.names?.kind && ['Namespaced','Cluster'].includes(obj.spec.scope)) scopes.set(`${obj.spec.group}/${obj.spec.names.kind}`, obj.spec.scope)
    if (obj?.kind === 'List') for (const it of obj.items ?? []) inspectScope(it)
  }
  for (const doc of docs) if (!doc.errors.length) { try { inspectScope(doc.toJS({maxAliasCount:100})) } catch {} }
  const seen = new Map<string, Resource>()
  let syntaxErrors = 0
  let docCount = 0
  const looksLikeHelmTemplate = /\{\{-?\s*[.\w$]/.test(text)

  const add = (severity: Diagnostic['severity'], message: string, range?: Range, resourceId?: string) =>
    diagnostics.push({ id: did(), severity, message, range, line: range ? lc.linePos(range[0]).line : undefined, resourceId })

  const addResource = (doc: Document, node: YAMLMap) => {
    let obj: any
    try { obj = node.toJSON() } catch { add('error', 'Cannot expand this YAML document (invalid alias).', [node.range![0], node.range![1]]); syntaxErrors++; return }
    const kind = obj?.kind
    const meta = obj?.metadata ?? {}
    const range: Range = [node.range![0], node.range![1]]
    if (typeof kind !== 'string' || !kind) {
      add('warning', 'Document has no "kind" - skipped.', range)
      return
    }
    if (!obj.apiVersion) add('warning', `${kind}: missing "apiVersion".`, range)
    if (meta.name != null && typeof meta.name !== 'string') { add('warning', `${kind}: metadata.name must be a string.`, range); return }
    let name: string = meta.name ?? ''
    if (!name && meta.generateName) name = `${meta.generateName}*`
    const nameNode = node.getIn(['metadata', 'name'], true) as any
    const nameRange: Range = nameNode?.range ? [nameNode.range[0], nameNode.range[1]] : range
    if (!name) {
      add('warning', `${kind}: missing metadata.name - skipped.`, range)
      return
    }
    const group = apiGroup(String(obj.apiVersion ?? ''))
    const scope = scopes.get(`${group}/${kind}`) ?? knownScope(group,kind)
    const namespace = scope === 'Cluster' ? '' : scope === 'Unknown' && meta.namespace == null ? '?' : String(meta.namespace ?? 'default')
    const id = identity(group, kind, namespace, name)
    if (scope === 'Unknown') add('info', `${kind} ${name}: scope is unknown (no supplied CRD). ${meta.namespace == null ? 'No namespace assumed; scope unresolved.' : 'Using the explicit metadata.namespace only.'}`, nameRange, id)
    const labels: Record<string, string> = {}
    for (const [k, v] of Object.entries(meta.labels ?? {})) labels[k] = String(v)
    const r: Resource = { id, group, scope, apiVersion: String(obj.apiVersion ?? ''), kind, name, namespace, labels, obj, node, range, nameRange }
    if (seen.has(id)) {
      add('warning', `Duplicate resource ${kind} "${name}"${namespace ? ` in namespace "${namespace}"` : ''}. The later one is ignored in the map.`, nameRange, id)
      return
    }
    seen.set(id, r)
    resources.push(r)
    void doc
  }

  for (const doc of docs) {
    for (const e of doc.errors) {
      syntaxErrors++
      add('error', e.message.split('\n')[0], [e.pos[0], Math.max(e.pos[1], e.pos[0] + 1)])
    }
    for (const w of doc.warnings) add('warning', w.message.split('\n')[0], [w.pos[0], w.pos[1]])
    if (doc.errors.length) continue
    const c = doc.contents
    if (c == null) continue
    docCount++
    if (!isMap(c)) {
      add('warning', 'Document is not a YAML mapping - skipped.', c.range ? [c.range[0], c.range[1]] : undefined)
      continue
    }
    const kind = c.get('kind') as unknown
    const items = c.get('items', true)
    if (typeof kind === 'string' && (kind as string).endsWith('List') && isSeq(items)) {
      for (const it of items.items) if (isMap(it)) addResource(doc, it)
    } else if (!c.has('kind') && c.items.length > 0 && !isScalar(c.items[0].key)) {
      add('warning', 'Unrecognised document - skipped.', [c.range![0], c.range![1]])
    } else addResource(doc, c)
  }
  if (looksLikeHelmTemplate) {
    add('info', 'This text contains Helm template syntax ({{ ... }}). Render it first with "helm template" (see Helm hints) and paste the output.')
  }
  return { resources, diagnostics, syntaxErrors, docCount, looksLikeHelmTemplate }
}
