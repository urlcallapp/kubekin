import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:8080'
await mkdir('smoke-artifacts', { recursive: true })
const browser = await (process.env.WEBKIT ? webkit : chromium).launch()
try {
for (const [width,height] of [[390,844],[320,568],[844,390],[667,375]]) {
 const p = await browser.newPage({ viewport:{width,height}, isMobile:true, hasTouch:true })
 const errors=[]; p.on('pageerror',e=>errors.push(e.message))
 await p.goto(url); await p.locator('.rnode').first().waitFor()
 const nav=p.getByRole('navigation',{name:'Workspace views'})
 const choose=async name=> nav.getByRole('button',{name,exact:true}).click()
 const assertFits=async selector=> { const r=await p.locator(selector).boundingBox(); assert.ok(r && r.height>100 && r.y>=0 && r.y+r.height<=height+1,`${selector} must have usable viewport space: ${JSON.stringify(r)}`); assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page horizontal overflow') }
 await choose('Details'); await assertFits('.panel'); assert.match(await p.locator('.panel').innerText(),/Click a resource/)
 await choose('Problems (5)'); await assertFits('.panel'); assert.equal(await p.locator('.probs li').count(),5)
 await p.screenshot({path:`smoke-artifacts/mobile-${width}-problems.png`})
 await p.locator('.plink').first().click(); await p.locator('main[data-mobile-view=yaml]').waitFor(); await assertFits('.editorwrap')
 await p.locator('.cm-selectionBackground').first().waitFor()
 assert.ok(await p.locator('.cm-selectionBackground').count()>0,'Problem selects source range')
 assert.equal(await p.locator('.cm-content').evaluate(el=>el===document.activeElement),false,'Source navigation should not summon phone keyboard')
 await choose('Map'); await p.getByRole('button',{name:'Fit',exact:true}).click()
  await p.locator('.rnode:not(.ghost)').first().click()
 await p.locator('main[data-mobile-view=details]').waitFor(); assert.match(await p.locator('.panel').innerText(),/Relationships/); await assertFits('.panel')
 await p.screenshot({path:`smoke-artifacts/mobile-${width}-details.png`})
 await p.locator('.rels .link').first().click(); assert.match(await p.locator('.panel').innerText(),/Relationships/);
 await p.getByRole('button',{name:'Show in YAML',exact:true}).click(); await p.locator('main[data-mobile-view=yaml]').waitFor()
 // Cursor and typing must keep the editor visible, not switch panels mid-edit.
 await p.locator('.cm-content').click(); await p.keyboard.press('Control+Home'); await p.keyboard.type('# phone edit\n');
 assert.equal(await p.locator('main').getAttribute('data-mobile-view'),'yaml')
 await choose('Map'); await p.getByRole('button',{name:'Load manifests',exact:true}).click()
 const docs=Array.from({length:35},(_,i)=>`apiVersion: v1\nkind: Pod\nmetadata: {name: pod-${i}}\nspec:\n  containers:\n  - name: app\n    image: nginx\n    envFrom:\n    - secretRef: {name: missing-${i}}`).join('\n---\n')
 await p.locator('textarea').fill(docs); await p.getByRole('button',{name:'Show map',exact:true}).click()
 await nav.getByRole('button',{name:/Problems \([3-9]\d/}).waitFor()
 await nav.getByRole('button',{name:/Problems/}).click();
 assert.ok(await p.locator('.probs li').count()>=35)
 const panel=p.locator('.panel'); await panel.evaluate(el=>el.scrollTop=el.scrollHeight)
 assert.ok(await panel.evaluate(el=>el.scrollTop>0),'Long problems list scrolls inside panel')
 assert.ok(await nav.isVisible(),'Navigation remains accessible while inspector scrolls')
 await p.locator('.plink').last().click(); await p.locator('main[data-mobile-view=yaml]').waitFor()
 await p.waitForFunction(()=>{const line=[...document.querySelectorAll('.cm-line')].find(el=>el.textContent.includes('missing-34')); const r=line?.getBoundingClientRect(), e=document.querySelector('.editorwrap').getBoundingClientRect(); return r && r.top>e.top+20 && r.bottom<e.bottom-20});
 await p.screenshot({path:`smoke-artifacts/mobile-${width}-source.png`})
 // Simulate the reduced visual space of an on-screen keyboard; actual iOS keyboard requires a device.
 await p.setViewportSize({width,height:Math.max(300,Math.floor(height*.6))}); await assertFits('.editorwrap')
 await nav.getByRole('button',{name:/Problems/}).click(); await assertFits('.panel')
 if(await p.locator('.mobile-tools').isVisible()){ await p.locator('.mobile-tools').click(); assert.ok(await p.getByRole('button',{name:'Load manifests',exact:true}).isVisible()); await p.locator('.mobile-tools').click() }
 assert.deepEqual(errors,[]); console.log(`PASS mobile ${width}x${height}: details, problems, source, edits, long list, reduced viewport`)
 await p.close()
}
const p=await browser.newPage({viewport:{width:1440,height:900}}); await p.goto(url); await p.locator('.rnode').first().waitFor();
assert.equal(await p.locator('.mobile-nav').isVisible(),false)
for(const s of ['section.left','section.mid','aside.right']) assert.ok(await p.locator(s).isVisible())
await p.locator('.rnode:not(.ghost)').first().click(); assert.match(await p.locator('.panel').innerText(),/Relationships/)
await p.screenshot({path:'smoke-artifacts/desktop-preserved.png'})
console.log('PASS desktop layout and source selection')
} finally {await browser.close()}
