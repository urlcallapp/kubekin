import { expect, it } from 'vitest'
import { toRawUrl, parseUrlList, fetchUrls } from './importer'
it('converts blob urls', () => {
  expect(toRawUrl('https://github.com/a/b/blob/main/k/x.yaml')).toBe('https://raw.githubusercontent.com/a/b/main/k/x.yaml')
  expect(toRawUrl('https://gitlab.com/g/p/-/blob/main/x.yaml')).toBe('https://gitlab.com/g/p/-/raw/main/x.yaml')
  expect(toRawUrl('https://raw.githubusercontent.com/a/b/main/x.yaml')).toBe('https://raw.githubusercontent.com/a/b/main/x.yaml')
})
it('parses lists', () => { expect(parseUrlList('https://x/a.yaml\n junk \nhttps://x/b.yaml').length).toBe(2) })
it('reports fetch failures with CORS guidance and joins successes', async () => {
  const f = (async (u: string) => { if (u.includes('bad')) throw new TypeError('x'); return new Response('kind: A', { status: 200 }) }) as any
  const r = await fetchUrls(['https://x/ok', 'https://x/bad'], f)
  expect(r.text).toContain('# source: https://x/ok')
  expect(r.errors[0]).toMatch(/CORS/)
})
