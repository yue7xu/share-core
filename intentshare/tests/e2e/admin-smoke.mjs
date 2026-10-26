import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1400,height:900}}); const errs=[];
p.on('pageerror', e=>errs.push(String(e))); p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto('http://localhost:3100/admin'); await p.fill('#tok','local-admin'); await p.click('#tokgo');
await p.waitForSelector('#app:not([hidden])');
await p.selectOption('#origin','');
for (const t of ['Pairs','Live','Shares','Receiver','Fidelity','Daily','AI & eval','Coding','Export','Data quality']) {
  await p.click(`#tabs button:text-is("${t}")`); await p.waitForTimeout(700);
  if (t==='Shares'){ await p.screenshot({path:'test-results/admin-shares.png'}); await p.click('tbody tr.click >> nth=0'); await p.waitForTimeout(700); await p.screenshot({path:'test-results/admin-share-detail.png', fullPage:false}); }
  if (t==='AI & eval'){ await p.click('text=Run evaluation'); await p.waitForSelector('text=intent = expected (samples) >> nth=1', {timeout:120000}); await p.screenshot({path:'test-results/admin-eval.png'}); }
  if (t==='Coding'){ await p.fill('input[placeholder^="Your coder"]','C1'); await p.press('input[placeholder^="Your coder"]','Tab'); await p.waitForTimeout(500); const s = p.locator('tbody select').first(); await s.selectOption('PROPOSE·activity'); await p.waitForTimeout(300); }
}
console.log('errors', errs); await b.close();
