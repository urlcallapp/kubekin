import { apiGroup, identity, knownScope, knownGroup } from './identity'
import type { Analysis, Diagnostic, Edge, EdgeType, Range, Resource } from './types'
import { CLUSTER_SCOPED, parseManifests } from './parse'

type Path = (string | number)[]

export const WORKLOADS = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'ReplicationController', 'Job', 'CronJob']

export function podSpecPath(kind: string): Path | null {
  switch (kind) {
    case 'Pod': return ['spec']
    case 'Deployment': case 'StatefulSet': case 'DaemonSet': case 'ReplicaSet':
    case 'ReplicationController': case 'Job': return ['spec', 'template', 'spec']
    case 'CronJob': return ['spec', 'jobTemplate', 'spec', 'template', 'spec']
  }
  return null
}
function podLabelsOf(r: Resource): Record<string, string> | null {
  const o = r.obj
  let l: any
  switch (r.kind) {
    case 'Pod': l = o?.metadata?.labels; break
    case 'CronJob': l = o?.spec?.jobTemplate?.spec?.template?.metadata?.labels; break
    case 'Deployment': case 'StatefulSet': case 'DaemonSet': case 'ReplicaSet':
    case 'ReplicationController': case 'Job': l = o?.spec?.template?.metadata?.labels; break
    default: return null
  }
  return l && typeof l === 'object' ? l : {}
}
function get(o: any, p: Path): any { return p.reduce((a, k) => (a == null ? undefined : a[k]), o) }

function matchSelector(sel: any, labels: Record<string, string>): boolean {
  if (!sel || typeof sel !== 'object') return false
  const ml = sel.matchLabels ?? (sel.matchExpressions ? {} : sel)
  const exprs = Array.isArray(sel.matchExpressions) ? sel.matchExpressions : []
  const entries = Object.entries(ml)
  if (entries.length === 0 && exprs.length === 0) return false
  for (const [k, v] of entries) if (labels[k] !== String(v)) return false
  for (const e of exprs) {
    if (!['In', 'NotIn', 'Exists', 'DoesNotExist'].includes(e.operator)) return false
    const has = e.key in labels
    const val = labels[e.key]
    if (e.operator === 'In' && !(has && (e.values ?? []).map(String).includes(val))) return false
    if (e.operator === 'NotIn' && has && (e.values ?? []).map(String).includes(val)) return false
    if (e.operator === 'Exists' && !has) return false
    if (e.operator === 'DoesNotExist' && has) return false
  }
  return true
}

export function analyze(text: string): Analysis {
  const pr = parseManifests(text)
  const resources = [...pr.resources]
  const diagnostics: Diagnostic[] = [...pr.diagnostics]
  const byId = new Map(resources.map((r) => [r.id, r]))
  const edges: Edge[] = []
  const edgeIds = new Set<string>()
  let n = 0
  let k = 0

  const scopeFor = (group:string,kind:string) => {
    const existing = resources.find(r => r.group === group && r.kind === kind && r.scope !== 'Unknown')
    return existing?.scope ?? knownScope(group,kind)
  }
  const resolve = (src:Resource, kind:string, name:string, ns:string, group:string|undefined, path:Path): Resource | undefined => {
    // A missing apiVersion/group in a reference is not permission to choose between API groups.
    const candidates = resources.filter(r => r.kind === kind && r.name === name && (group === undefined || r.group === group) && (r.scope === 'Cluster' || r.namespace === ns))
    if (candidates.length === 1 && candidates[0].scope !== 'Unknown') return candidates[0]
    const scope = group === undefined ? 'Unknown' : scopeFor(group,kind)
    if (candidates.length > 1 || scope === 'Unknown' || group === undefined || (scope === 'Namespaced' && ns === '?')) {
      diagnostics.push({id:`u${++k}`,severity:'info',message:`${src.kind} ${src.name}: ${kind} ${name} reference is unresolved (API group or scope is ambiguous/unknown); no link guessed.`,range:src.nameRange,resourceId:src.id})
      return undefined
    }
    const nsx = scope === 'Cluster' ? '' : ns
    const id = identity(group,kind,nsx,name)
    let g = byId.get(id)
    if (!g) {
      g = {id,group,scope,apiVersion:group ? `${group}/?` : 'v1',kind,name,namespace:nsx,labels:{},obj:{},node:null,range:src.range,nameRange:src.nameRange,ghost:true}
      resources.push(g); byId.set(id,g)
    }
    void path
    return g
  }
  const rangeOf = (r: Resource, p: Path): Range | undefined => {
    if (!r.node) return undefined
    let node: any = r.node.getIn(p, true)
    // fall back to the nearest existing parent path
    let q = [...p]
    while (!node?.range && q.length) { q.pop(); node = q.length ? r.node.getIn(q, true) : null }
    return node?.range ? [node.range[0], node.range[1]] : r.nameRange
  }
  const addEdge = (src: Resource, tgt: Resource, type: EdgeType, label: string, path: Path, inferred = false) => {
    if (src.id === tgt.id) return
    const id = `${src.id}|${type}|${tgt.id}|${label}`
    if (edgeIds.has(id)) return
    edgeIds.add(id)
    n++
    edges.push({ id: `e${n}`, source: src.id, target: tgt.id, type, label, inferred, evidenceRange: rangeOf(src, path), evidencePath: path.join('.') })
  }
  /** Reference by name to a kind; creates a ghost node (dashed) when absent from the input. */
  const ref = (src: Resource, kind: string, name: any, path: Path, type: EdgeType, label: string, ns?: string, group: string | undefined = knownGroup(kind)) => {
    if (typeof name !== 'string' || !name) return
    const t = resolve(src,kind,name,ns ?? src.namespace,group,path)
    if (t) addEdge(src,t,type,label,path)
  }
  const real = resources.filter((r) => !r.ghost)

  for (const r of real) {
    const o = r.obj
    // --- ownerReferences (explicit)
    const owners = o?.metadata?.ownerReferences
    if (Array.isArray(owners)) owners.forEach((ow: any, i: number) => {
      if (!ow?.kind || !ow?.name) return
      const t = resolve(r,ow.kind,ow.name,r.namespace,typeof ow.apiVersion === 'string' ? apiGroup(ow.apiVersion) : undefined,['metadata','ownerReferences',i])
      if (!t) return
      if (ow.uid && t.obj?.metadata?.uid && ow.uid !== t.obj.metadata.uid) { diagnostics.push({id:`u${++k}`,severity:'warning',message:'Owner reference UID does not match the loaded owner; no ownership link drawn.',resourceId:r.id,range:r.nameRange}); return }
      addEdge(t, r, 'owns', 'ownerReference', ['metadata', 'ownerReferences', i])
      const edge = edges[edges.length - 1]
      if (edge) edge.evidenceRange = rangeOf(r, ['metadata', 'ownerReferences', i])
    })

    // Only apply known-kind rules to the matching API group, never a same-kind custom resource.
    if (knownGroup(r.kind) !== r.group) continue
    // --- pod spec references
    const psp = podSpecPath(r.kind)
    if (psp) {
      const spec = get(o, psp)
      if (spec) {
        ref(r, 'ServiceAccount', spec.serviceAccountName ?? spec.serviceAccount, [...psp, 'serviceAccountName'], 'references', 'runs as')
        ;(spec.imagePullSecrets ?? []).forEach((s: any, i: number) => ref(r, 'Secret', s?.name, [...psp, 'imagePullSecrets', i], 'references', 'imagePullSecret'))
        ;(spec.volumes ?? []).forEach((v: any, i: number) => {
          const vp: Path = [...psp, 'volumes', i]
          ref(r, 'ConfigMap', v?.configMap?.name, [...vp, 'configMap'], 'references', 'mounts')
          ref(r, 'Secret', v?.secret?.secretName, [...vp, 'secret'], 'references', 'mounts')
          ref(r, 'PersistentVolumeClaim', v?.persistentVolumeClaim?.claimName, [...vp, 'persistentVolumeClaim'], 'references', 'mounts')
          ;(v?.projected?.sources ?? []).forEach((s: any, j: number) => {
            ref(r, 'ConfigMap', s?.configMap?.name, [...vp, 'projected', 'sources', j], 'references', 'mounts')
            ref(r, 'Secret', s?.secret?.name, [...vp, 'projected', 'sources', j], 'references', 'mounts')
          })
        })
        for (const key of ['containers', 'initContainers']) {
          ;(spec[key] ?? []).forEach((c: any, i: number) => {
            const cp: Path = [...psp, key, i]
            ;(c?.envFrom ?? []).forEach((e: any, j: number) => {
              ref(r, 'ConfigMap', e?.configMapRef?.name, [...cp, 'envFrom', j], 'references', 'env')
              ref(r, 'Secret', e?.secretRef?.name, [...cp, 'envFrom', j], 'references', 'env')
            })
            ;(c?.env ?? []).forEach((e: any, j: number) => {
              ref(r, 'ConfigMap', e?.valueFrom?.configMapKeyRef?.name, [...cp, 'env', j], 'references', 'env')
              ref(r, 'Secret', e?.valueFrom?.secretKeyRef?.name, [...cp, 'env', j], 'references', 'env')
            })
          })
        }
      }
    }

    switch (r.kind) {
      case 'StatefulSet':
        ref(r, 'Service', o?.spec?.serviceName, ['spec', 'serviceName'], 'references', 'governing service')
        break
      case 'PersistentVolumeClaim':
        ref(r, 'StorageClass', o?.spec?.storageClassName, ['spec', 'storageClassName'], 'references', 'class')
        ref(r, 'PersistentVolume', o?.spec?.volumeName, ['spec', 'volumeName'], 'references', 'bound to')
        break
      case 'PersistentVolume':
        ref(r, 'StorageClass', o?.spec?.storageClassName, ['spec', 'storageClassName'], 'references', 'class')
        break
      case 'HorizontalPodAutoscaler': {
        const t = o?.spec?.scaleTargetRef
        if (t?.kind && t?.name) ref(r, t.kind, t.name, ['spec', 'scaleTargetRef'], 'references', 'scales', undefined, typeof t.apiVersion === 'string' ? apiGroup(t.apiVersion) : undefined)
        break
      }
      case 'Ingress': {
        ref(r, 'IngressClass', o?.spec?.ingressClassName, ['spec', 'ingressClassName'], 'references', 'class')
        const be = (b: any, p: Path) => ref(r, 'Service', b?.service?.name, p, 'routes', b?.service?.port?.number ? `:${b.service.port.number}` : b?.service?.port?.name ? `:${b.service.port.name}` : 'routes')
        be(o?.spec?.defaultBackend, ['spec', 'defaultBackend'])
        ;(o?.spec?.rules ?? []).forEach((rule: any, i: number) =>
          (rule?.http?.paths ?? []).forEach((p: any, j: number) =>
            be(p?.backend, ['spec', 'rules', i, 'http', 'paths', j, 'backend'])))
        ;(o?.spec?.tls ?? []).forEach((t: any, i: number) => ref(r, 'Secret', t?.secretName, ['spec', 'tls', i], 'references', 'tls'))
        break
      }
      case 'HTTPRoute': case 'GRPCRoute': case 'TLSRoute': case 'TCPRoute': {
        ;(o?.spec?.parentRefs ?? []).forEach((p: any, i: number) =>
          ref(r, p?.kind ?? 'Gateway', p?.name, ['spec', 'parentRefs', i], 'references', 'attached to', p?.namespace, p?.group ?? 'gateway.networking.k8s.io'))
        ;(o?.spec?.rules ?? []).forEach((rule: any, i: number) =>
          (rule?.backendRefs ?? []).forEach((b: any, j: number) => {
            if ((b?.kind ?? 'Service') === 'Service') ref(r, 'Service', b?.name, ['spec', 'rules', i, 'backendRefs', j], 'routes', 'routes', b?.namespace, b?.group ?? '')
          }))
        break
      }
      case 'Gateway':
        ref(r, 'GatewayClass', o?.spec?.gatewayClassName, ['spec', 'gatewayClassName'], 'references', 'class')
        ;(o?.spec?.listeners ?? []).forEach((l: any, i: number) =>
          (l?.tls?.certificateRefs ?? []).forEach((c: any, j: number) =>
            ref(r, c?.kind ?? 'Secret', c?.name, ['spec', 'listeners', i, 'tls', 'certificateRefs', j], 'references', 'tls', c?.namespace, c?.group ?? '')))
        break
      case 'RoleBinding': case 'ClusterRoleBinding': {
        const rr = o?.roleRef
        if (rr?.kind && rr?.name) ref(r, rr.kind, rr.name, ['roleRef'], 'references', 'grants', undefined, rr.apiGroup ?? 'rbac.authorization.k8s.io')
        ;(o?.subjects ?? []).forEach((s: any, i: number) => {
          if (s?.kind === 'ServiceAccount' && s?.name) ref(r, 'ServiceAccount', s.name, ['subjects', i], 'references', 'subject', s.namespace ?? r.namespace)
        })
        break
      }
      case 'Certificate':
        ref(r, 'Secret', o?.spec?.secretName, ['spec', 'secretName'], 'references', 'writes')
        if (o?.spec?.issuerRef?.name) ref(r, o.spec.issuerRef.kind ?? 'Issuer', o.spec.issuerRef.name, ['spec', 'issuerRef'], 'references', 'issuer', undefined, o.spec.issuerRef.group ?? 'cert-manager.io')
        break
      case 'ServiceAccount':
        ;(o?.imagePullSecrets ?? []).forEach((s: any, i: number) => ref(r, 'Secret', s?.name, ['imagePullSecrets', i], 'references', 'imagePullSecret'))
        break
    }
  }

  // --- selector-based relations (inference from labels, not live pod evidence)
  const withPodLabels = real.filter(r => knownGroup(r.kind) === r.group).map((r) => ({ r, l: podLabelsOf(r) })).filter((x): x is { r: Resource; l: Record<string, string> } => x.l !== null)
  for (const s of real) {
    if (knownGroup(s.kind) !== s.group) continue
    if (s.kind === 'Service' && s.obj?.spec?.selector && Object.keys(s.obj.spec.selector).length) {
      let hits = 0
      for (const { r, l } of withPodLabels) {
        if (r.namespace === s.namespace && matchSelector(s.obj.spec.selector, l)) {
          addEdge(s, r, 'selects', 'selector', ['spec', 'selector'], true); hits++
        }
      }
      if (hits === 0) diagnostics.push(diag('warning', `Service "${s.name}" selector matches no workload pod template in this input (it may target pods defined elsewhere).`, rangeOf(s, ['spec', 'selector']), s.id))
    }
    if (s.kind === 'NetworkPolicy' || s.kind === 'PodDisruptionBudget') {
      const sel = s.kind === 'NetworkPolicy' ? s.obj?.spec?.podSelector : s.obj?.spec?.selector
      const path: Path = s.kind === 'NetworkPolicy' ? ['spec', 'podSelector'] : ['spec', 'selector']
      if (sel && typeof sel === 'object') {
        const empty = !Object.keys(sel.matchLabels ?? {}).length && !(sel.matchExpressions ?? []).length
        for (const { r, l } of withPodLabels) {
          if (r.namespace !== s.namespace || r.kind === 'ReplicaSet') continue
          if (empty ? (s.kind === 'NetworkPolicy' || s.apiVersion === 'policy/v1') : matchSelector(sel, l)) addEdge(s, r, 'selects', empty ? 'all pods' : 'podSelector', path, true)
        }
      }
    }
  }
  // dangling Service port-name hints etc. intentionally not guessed.

  // diagnostics for missing references
  for (const g of resources.filter((r) => r.ghost)) {
    const first = edges.find((e) => e.source === g.id || e.target === g.id)
    const referrer = first ? byId.get(first.source === g.id ? first.target : first.source) : undefined
    if (g.kind === 'ServiceAccount' && g.name === 'default') continue
    diagnostics.push(diag('info', `${g.kind} "${g.name}" is referenced${referrer ? ` by ${referrer.kind} "${referrer.name}"` : ''} but not defined in this input.`, first?.evidenceRange, g.id))
  }
  function diag(severity: Diagnostic['severity'], message: string, range?: Range, resourceId?: string): Diagnostic {
    return { id: `a${++k}`, severity, message, range, resourceId }
  }
  // drop ghost ServiceAccount "default" (implicit in every namespace)
  const dropIds = new Set(resources.filter((r) => r.ghost && r.kind === 'ServiceAccount' && r.name === 'default').map((r) => r.id))
  const outResources = resources.filter((r) => !dropIds.has(r.id))
  const outEdges = edges.filter((e) => !dropIds.has(e.source) && !dropIds.has(e.target))
  return { resources: outResources, edges: outEdges, diagnostics, syntaxErrors: pr.syntaxErrors, docCount: pr.docCount, looksLikeHelmTemplate: pr.looksLikeHelmTemplate }
}
