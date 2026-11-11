import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:8080'
await mkdir('smoke-artifacts', { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const failed = [], pageErrors = [], external = []
// Offline runtime test: internet requests are refused; localhost container traffic remains permitted.
await context.route('**/*', async route => {
  const u = new URL(route.request().url())
  if (u.origin === new URL(url).origin || ['blob:', 'data:'].includes(u.protocol)) await route.continue()
  else { external.push(u.href); await route.abort() }
})
const page = await context.newPage()
page.on('requestfailed', r => failed.push(`${r.url()}: ${r.failure()?.errorText}`))
page.on('pageerror', e => pageErrors.push(e.message))
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })
try {
  const res = await page.goto(url, { waitUntil: 'networkidle' })
  assert.equal(res.status(), 200)
  await page.locator('.rnode').first().waitFor()
  assert.equal(await page.locator('.rnode').count(), 15)
  assert.ok(await page.locator('img').evaluateAll(imgs => imgs.every(i => i.complete && i.naturalWidth > 0)))
  await context.grantPermissions(['clipboard-read','clipboard-write'])
  await page.screenshot({ path: 'smoke-artifacts/container-sample.png' })
  await page.locator('.rnode:not(.ghost)').first().click()
  await page.locator('.rnode.sel').waitFor()
  assert.match(await page.locator('.panel').innerText(), /Relationships/)
  await page.keyboard.press('Control+c')
  const selectedSource = await page.evaluate(() => navigator.clipboard.readText())
  assert.match(selectedSource, /kind: ServiceAccount/)
  assert.match(selectedSource, /namespace: shop/)
  await page.keyboard.press('Control+Home')
  await page.locator('.cm-line').filter({ hasText: 'kind: Namespace' }).click()
  await page.waitForFunction(() => document.querySelector('.rnode.sel')?.innerText.includes('Namespace'))
  console.log('PASS source navigation: graph selects exact resource YAML; YAML cursor highlights Namespace.')

  await page.getByRole('button', { name: 'Load manifests', exact: true }).click()
  await page.locator('textarea').fill('apiVersion: v1\nkind: ConfigMap\nmetadata: {name: offline-paste}\ndata: {hello: world}')
  await page.getByRole('button', { name: 'Show map', exact: true }).click()
  await page.getByText('offline-paste', { exact: true }).first().waitFor()
  assert.equal(await page.locator('.rnode').count(), 1)
  await page.screenshot({ path: 'smoke-artifacts/container-offline-paste.png' })

  await page.getByRole('button', { name: 'Load manifests', exact: true }).click()
  await page.getByRole('button', { name: 'Open file', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'offline.yaml', mimeType: 'application/yaml', buffer: Buffer.from('apiVersion: v1\nkind: Secret\nmetadata: {name: offline-file}') })
  await page.getByText('offline-file', { exact: true }).first().waitFor()
  assert.equal(await page.locator('.rnode').count(), 1)
  assert.match(await page.locator('.srcline').innerText(), /offline.yaml/)
  await page.screenshot({ path: 'smoke-artifacts/container-offline-file.png' })

  await page.getByRole('button', { name: 'Helm hints', exact: true }).click()
  assert.match(await page.locator('.modal').innerText(), /Set-Clipboard/)
  assert.equal(await page.locator('.cmd').count(), 5)
  await page.screenshot({ path: 'smoke-artifacts/container-helm.png' })
  assert.deepEqual(external, [], 'Runtime attempted unexpected external requests')
  assert.deepEqual(failed, [], 'Container asset requests failed')
  assert.deepEqual(pageErrors, [], 'Browser errors')
  console.log('PASS: site HTTP, sample, local icons, selection, offline paste/file and Helm; no external requests or page errors.')
} finally { await browser.close() }
