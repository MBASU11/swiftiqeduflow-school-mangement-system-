import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1300,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:300]))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('Seen on M-Pesa statement')))
        await pg.goto('http://localhost:8765/index.html'); await pg.wait_for_timeout(1000)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const p = await import('/js/services/platformService.js');
          const s = await import('/js/services/subscriptionService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const fin = await import('/js/services/financeService.js');
          
          const r = a.register({name:'B', schoolName:'UI School', email:'ui@x.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:50, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('ui@x.co','secret-pass-1'); sc.saveSchool({name:'UI School', currency:'KES', setupComplete:true});
          await s.adminSetSubscription(r.id,{status:'active',packageId:'professional',billing:'annual',addons:['bursar-pack'],startDate:'2026-10-01',expiryDate:'2027-09-30'},'smoke');
          const cls = ac.classRepo.create({name:'Grade 5', order:5}); ac.termRepo.create({name:'Term 1', isCurrent:true});
          ['A','B'].forEach((n,i)=>st.studentRepo.create({admissionNumber:'U'+i,firstName:n,lastName:'Z',classId:cls.id,admissionDate:'2026-01-05',status:'active',parentIds:[]}));
          fin.feeStructureRepo.create({name:'G5', classId:cls.id, items:[{id:'1',name:'Tuition',amount:10000}]});
        }""")
        await pg.goto('http://localhost:8765/index.html#/finance'); await pg.reload(); await pg.wait_for_timeout(1500)
        await pg.click('[data-tab="invoices"]'); await pg.wait_for_timeout(500)
        await pg.click('#gen-open'); await pg.wait_for_timeout(300)
        await pg.select_option('#g-struct', index=1); await pg.select_option('#g-mode','all'); await pg.wait_for_timeout(200)
        await pg.click('#g-preview'); await pg.wait_for_timeout(600)
        print('PREVIEW rows:', await pg.locator('#bt table tbody tr').count(), '| create btn:', await pg.locator('#g-create').inner_text())
        await pg.click('#g-create'); await pg.wait_for_timeout(900)
        print('AFTER GEN:', (await pg.inner_text('#finance-body'))[:110].replace('\n',' | '))
        # record mpesa payment via UI
        await pg.click('[data-tab="payments"]'); await pg.wait_for_timeout(500)
        await pg.click('#p-new'); await pg.fill('#np-amt','4000'); await pg.select_option('#np-m','mpesa'); await pg.fill('#np-ref','UI777'); await pg.click('#np-save'); await pg.wait_for_timeout(800)
        print('PAY:', (await pg.inner_text('#finance-body'))[:80].replace('\n',' | '), '| pending badge:', await pg.locator('text=Pending verification').count())
        # reconcile with a statement
        await pg.click('[data-tab="reconcile"]'); await pg.wait_for_timeout(400)
        await pg.fill('#rc-text','Date,Transaction Code,Amount\n2026-10-15,UI777,"4,000"\n2026-10-15,NOPE1,50'); await pg.click('#rc-run'); await pg.wait_for_timeout(400)
        print('MATCH:', await pg.locator('text=Matches').count(), 'unmatched:', await pg.locator('text=No pending payment').count())
        await pg.click('[data-cf="0"]'); await pg.wait_for_timeout(900)
        print('CONFIRMED:', (await pg.inner_text('#finance-body'))[:80].replace('\n',' | '))
        await pg.click('[data-tab="bursar"]'); await pg.wait_for_timeout(500)
        t = await pg.inner_text('#finance-body'); print('DASH:', t[:200].replace('\n',' | '))
        # existing legacy Student Accounts tab still works with the new payment route
        await pg.click('[data-tab="accounts"]'); await pg.wait_for_timeout(600); print('ACCOUNTS ok:', len(await pg.inner_text('#finance-body'))>20)
        print('ERR', errs); await b.close()
asyncio.run(main())
