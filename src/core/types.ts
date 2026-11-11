import type { YAMLMap } from 'yaml'

export type Range = [number, number]
export type Severity = 'error' | 'warning' | 'info'

export interface Resource {
  id: string
  group: string
  scope: import('./identity').Scope
  apiVersion: string
  kind: string
  name: string
  namespace: string // '' for cluster-scoped
  labels: Record<string, string>
  obj: any
  node: YAMLMap | null
  range: Range // whole resource in the working text
  nameRange: Range
  ghost?: boolean // referenced but not present in the input
}

export interface Diagnostic {
  id: string
  severity: Severity
  message: string
  range?: Range
  line?: number
  resourceId?: string
}

export type EdgeType = 'owns' | 'selects' | 'references' | 'routes'

export interface Edge {
  id: string
  source: string
  target: string
  type: EdgeType
  label: string
  inferred: boolean // true when derived from label matching, not an explicit name reference
  evidenceRange?: Range
  evidencePath: string
}

export interface Analysis {
  resources: Resource[]
  edges: Edge[]
  diagnostics: Diagnostic[]
  syntaxErrors: number
  docCount: number
  looksLikeHelmTemplate: boolean
}
