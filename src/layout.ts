import ELK from 'elkjs/lib/elk.bundled.js'
import type { Analysis, Resource } from './core/types'

export const NODE_W = 216
export const NODE_H = 64
const elk = new ELK()

export interface Placed { id: string; x: number; y: number; w: number; h: number; parent?: string }
export interface LayoutResult { nodes: Placed[]; groups: Placed[] }

export const nsLabel = (ns: string) => (ns === '' ? 'cluster-scoped' : ns)

/**
 * Each namespace is laid out on its own (layered, left to right), then the namespace boxes are shelf-packed
 * so the whole map matches the visible pane's aspect ratio. Cross-namespace links are still drawn by the renderer.
 */
interface Box { id: string; w: number; h: number }
/** Shelf-pack boxes into rows aiming at the given aspect ratio. Returns positions and the total size. */
function shelfPack<T extends Box>(items: T[], aspect: number, gap: number) {
  const area = items.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0)
  const maxW = Math.max(...items.map((b) => b.w), 0)
  const rowW = Math.max(maxW, Math.sqrt(area * aspect))
  const placed: { item: T; x: number; y: number }[] = []
  let x = 0, y = 0, rowH = 0, totalW = 0
  for (const it of items) {
    if (x > 0 && x + it.w > rowW) { x = 0; y += rowH + gap; rowH = 0 }
    placed.push({ item: it, x, y })
    x += it.w + gap
    totalW = Math.max(totalW, x - gap)
    rowH = Math.max(rowH, it.h)
  }
  return { placed, w: totalW, h: y + rowH }
}

function components(rs: Resource[], edges: { source: string; target: string }[]): Resource[][] {
  const parent = new Map(rs.map((r) => [r.id, r.id]))
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)! } return x }
  for (const e of edges) if (parent.has(e.source) && parent.has(e.target)) parent.set(find(e.source), find(e.target))
  const m = new Map<string, Resource[]>()
  for (const r of rs) { const k = find(r.id); m.set(k, [...(m.get(k) ?? []), r]) }
  return [...m.values()].sort((x, y) => y.length - x.length)
}

export async function layout(a: Analysis, hiddenEdgeTypes: Set<string>, aspect = 1.6): Promise<LayoutResult> {
  const byNs = new Map<string, Resource[]>()
  for (const r of a.resources) {
    const arr = byNs.get(r.namespace) ?? []
    arr.push(r)
    byNs.set(r.namespace, arr)
  }
  const order = [...byNs.keys()].sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y)))
  const PAD = { top: 40, left: 16, bottom: 16, right: 16 }
  const groupsOut: { id: string; w: number; h: number; nodes: Placed[] }[] = []
  for (const ns of order) {
    const rs = byNs.get(ns)!
    const ids = new Set(rs.map((r) => r.id))
    const allEdges = a.edges.filter((e) => !hiddenEdgeTypes.has(e.type) && ids.has(e.source) && ids.has(e.target))
    const comps: { id: string; w: number; h: number; nodes: Placed[] }[] = []
    for (const [i, comp] of components(rs, allEdges).entries()) {
      const cids = new Set(comp.map((r) => r.id))
      const g: any = await elk.layout({
        id: `c${i}`,
        layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.padding': '[top=0,left=0,bottom=0,right=0]',
          'elk.spacing.nodeNode': '16', 'elk.layered.spacing.nodeNodeBetweenLayers': '56', 'elk.layered.spacing.edgeNodeBetweenLayers': '20',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP' },
        children: comp.map((r) => ({ id: r.id, width: NODE_W, height: NODE_H })),
        edges: allEdges.filter((e) => cids.has(e.source) && cids.has(e.target)).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      } as any)
      comps.push({ id: `c${i}`, w: g.width, h: g.height, nodes: (g.children ?? []).map((n: any) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height })) })
    }
    const packed = shelfPack(comps, Math.max(1.2, aspect), 24)
    const nodes: Placed[] = []
    for (const { item, x, y } of packed.placed) for (const n of item.nodes) nodes.push({ ...n, x: n.x + x + PAD.left, y: n.y + y + PAD.top, parent: `ns:${ns}` })
    groupsOut.push({ id: `ns:${ns}`, w: packed.w + PAD.left + PAD.right, h: packed.h + PAD.top + PAD.bottom, nodes })
  }
  const top = shelfPack(groupsOut, aspect, 36)
  const groups: Placed[] = []
  const nodes: Placed[] = []
  for (const { item, x, y } of top.placed) { groups.push({ id: item.id, x, y, w: item.w, h: item.h }); nodes.push(...item.nodes) }
  return { nodes, groups }
}
