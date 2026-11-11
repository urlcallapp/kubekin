export interface HelmOpts { release: string; chart: string; namespace: string; values: string; repoName: string; repoUrl: string; version: string; includeCrds: boolean }
export const defaultHelm: HelmOpts = { release: 'my-release', chart: './chart', namespace: 'default', values: '', repoName: '', repoUrl: '', version: '', includeCrds: true }

const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)
const pq = (s: string) => (/^[\w@%+=:,./\\-]+$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`)

export function helmCore(o: HelmOpts, quote = q): string {
  const parts = ['helm template', quote(o.release), quote(o.chart)]
  if (o.namespace) parts.push('--namespace', quote(o.namespace))
  if (o.version) parts.push('--version', quote(o.version))
  if (o.values) parts.push('-f', quote(o.values))
  if (o.includeCrds) parts.push('--include-crds')
  return parts.join(' ')
}
export interface HelmCommand { id: string; title: string; note: string; command: string }
export function helmCommands(o: HelmOpts): HelmCommand[] {
  const repo = o.repoName && o.repoUrl ? `helm repo add ${q(o.repoName)} ${q(o.repoUrl)} && helm repo update\n` : ''
  const lin = helmCore(o)
  const win = helmCore(o, pq)
  return [
    { id: 'linux-x11', title: 'Linux (X11) - copy to clipboard', note: 'Needs helm and xclip (apt install xclip).', command: `${repo}${lin} | xclip -selection clipboard` },
    { id: 'linux-wayland', title: 'Linux (Wayland) - copy to clipboard', note: 'Needs helm and wl-clipboard (apt install wl-clipboard).', command: `${repo}${lin} | wl-copy` },
    { id: 'macos', title: 'macOS - copy to clipboard', note: 'pbcopy ships with macOS.', command: `${repo}${lin} | pbcopy` },
    { id: 'windows', title: 'Windows (PowerShell) - copy to clipboard', note: 'Needs helm on PATH (winget install Helm.Helm). Set-Clipboard is built in. Out-String joins the lines.', command: `${repo.replace(' && ', '; ')}${win} | Out-String | Set-Clipboard` },
    { id: 'file', title: 'Any OS - save to a file, then open it here', note: 'Use "Open file" in KubeKin to load out.yaml.', command: `${repo}${lin} > out.yaml` },
  ]
}
export const helmCaveats = [
  'helm template renders locally. It does not contact a cluster, so lookup() returns empty and .Capabilities uses defaults.',
  'Flags that change the output (-f, --set, --version, --namespace) must match what your Argo CD Application or release uses.',
  'Argo CD renders with helm template too, so this output is close to what it applies. Hooks and CRDs are included only with the flags above.',
]
