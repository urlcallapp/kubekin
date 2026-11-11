import ELK from 'elkjs/lib/elk.bundled.js'
import type { Analysis, Resource } from './core/types'

export const NODE_W = 200
export const NODE_H = 64
const elk = new ELK()

export interface Placed { id: string; x: number; y: number; w: number; h: number; parent?: string }
export interface LayoutResult { nodes: Placed[]; groups: Placed[] }

export const nsLabel = (ns: string) => (ns === '' ? 'cluster-scoped' : ns)

export async function layout(a: Analysis, hiddenEdgeTypes: Set<string>): Promise<LayoutResult> {
  const byNs = new Map<string, Resource[]>()
  for (const r of a.resources) {
    const arr = byNs.get(r.namespace) ?? []
    arr.push(r)
    byNs.set(r.namespace, arr)
  }
  const children = [...byNs.entries()].sort(([x], [y]) => (x === '' ? -1 : y === '' ? 1 : x.localeCompare(y))).map(([ns, rs]) => ({
    id: `ns:${ns}`,
    layoutOptions: { 'elk.padding': '[top=44,left=20,bottom=20,right=20]', 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '24', 'elk.layered.spacing.nodeNodeBetweenLayers': '70' },
    children: rs.map((r) => ({ id: r.id, width: NODE_W, height: NODE_H })),
  }))
  const ids = new Set(a.resources.map((r) => r.id))
  const edges = a.edges.filter((e) => !hiddenEdgeTypes.has(e.type) && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
  const g = await elk.layout({
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '40', 'elk.layered.spacing.nodeNodeBetweenLayers': '70', 'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.aspectRatio': '1.8' },
    children, edges,
  } as any)
  const nodes: Placed[] = []
  const groups: Placed[] = []
  for (const c of (g.children ?? []) as any[]) {
    groups.push({ id: c.id, x: c.x, y: c.y, w: c.width, h: c.height })
    for (const n of c.children ?? []) nodes.push({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height, parent: c.id })
  }
  return { nodes, groups }
}
