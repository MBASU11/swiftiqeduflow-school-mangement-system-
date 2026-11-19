import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1300,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:250]))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('Seen on statement')))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1200)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js'); const s = await import('/js/services/subscriptionService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const fin = await import('/js/services/financeService.js'); const B = await import('/js/services/bursarService.js');
          const r = a.register({name:'Bursar', schoolName:'P3 School', email:'p3@x.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:20, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('p3@x.co','secret-pass-1'); sc.saveSchool({name:'P3 School', currency:'KES', setupComplete:true});
          await s.adminSetSubscription(r.id,{status:'active',packageId:'professional',billing:'annual',addons:['bursar-pack'],startDate:'2026-10-01',expiryDate:'2027-09-30'},'test');
          const cls = ac.classRepo.create({name:'Grade 4', order:4}); const term = ac.termRepo.create({name:'Term 1', isCurrent:true});
          ['Amy','Ben'].forEach((n,i)=>st.studentRepo.create({admissionNumber:'ADM-'+(i+1),firstName:n,lastName:'K',classId:cls.id,admissionDate:'2026-01-05',status:'active',parentIds:[]}));
          const fs = fin.feeStructureRepo.create({name:'G4', classId:cls.id, termId:term.id, items:[{id:'1',name:'Tuition',amount:30000}]});
          await B.generateInvoices({scope:{mode:'all'}, structureId:fs.id, termId:term.id, dueDate:'2026-12-01'});
          const d = await B.loadBursar(); await B.submitPayment({studentId:d.students[0].id, invoiceId:d.invoices.find(i=>i.studentId===d.students[0].id).id, amount:12000, method:'cash', date:'2026-03-02'});
        }""")
        await pg.goto(BASE+'#/finance'); await pg.reload(); await pg.wait_for_timeout(1800)
        tabs = await pg.locator('[data-tab]').all_inner_texts(); print('TABS:', tabs)
        async def go(t):
            await pg.click(f'[data-tab="{t}"]'); await pg.wait_for_timeout(700)
            return await pg.inner_text('#finance-body')
        t = await go('bursar'); print('DASH has collection rate + unmatched:', 'Collection rate' in t and 'Unmatched payments' in t, '|', [x for x in t.split('\n') if '%' in x][:3])
        # credit note via UI
        await go('credits'); await pg.select_option('[data-f=invoiceId]', index=2); await pg.fill('[data-f=amount]','5000'); await pg.fill('[data-f=reason]','Lunch not taken'); await pg.click('#cn-go'); await pg.wait_for_timeout(800)
        print('CREDIT requested:', 'CN-' in await pg.inner_text('#finance-body'), '| awaiting:', 'Awaiting approval' in await pg.inner_text('#finance-body'))
        await pg.click('[data-ap$=":1"]'); await pg.wait_for_timeout(800); print('CREDIT approved:', 'Approved' in await pg.inner_text('#finance-body'))
        # plan via UI
        await go('plans'); await pg.select_option('[data-f=invoiceId]', index=1); await pg.fill('[data-f=firstDue]','2026-04-01'); await pg.dispatch_event('[data-f=firstDue]','change'); await pg.wait_for_timeout(300)
        prev = await pg.inner_text('#finance-body'); print('PLAN preview shows installments:', 'Due' in prev and '2026-04-01' in prev)
        await pg.click('#pl-save'); await pg.wait_for_timeout(900); print('PLAN created:', 'Installment plan created' in await pg.inner_text('#finance-body') or 'upcoming' in await pg.inner_text('#finance-body'))
        # statement
        await go('statements'); await pg.select_option('#sx-s', index=1); await pg.wait_for_timeout(500); s = await pg.inner_text('#finance-body'); print('STATEMENT:', ('Amount due' in s or 'Credit balance' in s or 'Fully paid' in s), '|', [l for l in s.split('\n') if 'Amount due' in l])
        # cashbook
        c = await go('cashbook'); print('CASHBOOK has receipt and closing:', 'Receipt' in c and 'Closing balance' in c)
        await pg.fill('[data-f=from]','2026-01-01'); await pg.dispatch_event('[data-f=from]','change'); await pg.wait_for_timeout(400); print('  cashbook (from Jan):', 'Receipt' in await pg.inner_text('#finance-body'))
        # reconcile: unmatched line -> queue -> assign
        await go('reconcile'); await pg.fill('#rc-text','Date,Transaction Code,Amount,Account\n2026-03-05,TXUI1,"4,000",ADM-2 fees\n2026-03-05,TXUI2,700,mystery'); await pg.click('#rc-run'); await pg.wait_for_timeout(1000)
        q = await pg.inner_text('#finance-body'); print('QUEUE:', 'Review queue (2)' in q, '| suggestion preselected:', await pg.eval_on_selector('[data-tx] [data-stu]','e=>e.selectedOptions[0].text'))
        await pg.click('[data-assign]'); await pg.wait_for_timeout(1000); q = await pg.inner_text('#finance-body'); print('ASSIGNED:', 'Review queue (1)' in q, '| recent decided shows:', 'TXUI1' in q)
        # awards
        await go('charges'); await pg.select_option('[data-a=studentId]', index=1); await pg.fill('[data-a=value]','50'); await pg.click('#aw-go'); await pg.wait_for_timeout(900)
        a = await pg.inner_text('#finance-body'); print('AWARD pending then approve:', 'pending' in a)
        await pg.click('[data-aw$=":1"]'); await pg.wait_for_timeout(800); print('  approved:', 'approved' in await pg.inner_text('#finance-body'))
        # rules
        await go('pay'); await pg.select_option('#pr-over','yes'); await pg.click('#pr-save'); await pg.wait_for_timeout(700); print('RULES saved:', 'Payment rules saved' in await pg.inner_text('#finance-body'))
        # audit
        au = await go('faudit'); print('AUDIT rows mention credit notes & awards:', 'creditNotes' in au and 'awards' in au)
        # existing tabs still work
        for t in ['invoices','payments','refunds','breports']:
            x = await go(t); print(t.upper(), 'ok:', len(x) > 40)
        await pg.screenshot(path='/tmp/p3_dash.png')
        print('ERR', errs); await b.close()
asyncio.run(main())
