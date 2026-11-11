/** Turn a GitHub/GitLab "blob" page URL into its raw URL. Other URLs pass through. */
export function toRawUrl(input: string): string {
  const u = input.trim()
  let m = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`
  m = u.match(/^(https:\/\/[^/]+\/.+?)\/-\/blob\/(.+)$/) // GitLab
  if (m) return `${m[1]}/-/raw/${m[2]}`
  m = u.match(/^(https:\/\/bitbucket\.org\/[^/]+\/[^/]+)\/src\/(.+)$/)
  if (m) return `${m[1]}/raw/${m[2]}`
  return u
}
export function parseUrlList(text: string): string[] {
  return text.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)).map(toRawUrl)
}
export interface FetchOutcome { text: string; errors: string[]; ok: string[] }
export async function fetchUrls(urls: string[], f: typeof fetch = fetch): Promise<FetchOutcome> {
  const parts: string[] = []
  const errors: string[] = []
  const ok: string[] = []
  for (const url of urls) {
    try {
      const res = await f(url)
      if (!res.ok) { errors.push(`${url}: HTTP ${res.status}${res.status === 404 ? ' (private repos need a token and are not supported; use a public raw URL or paste the text)' : ''}`); continue }
      parts.push(`# source: ${url}\n${await res.text()}`); ok.push(url)
    } catch {
      errors.push(`${url}: the browser could not fetch it (network error or the server blocks cross-origin requests - CORS). Open the URL, copy the text and paste it instead.`)
    }
  }
  return { text: parts.join('\n---\n'), errors, ok }
}
