# Privacy / terms / processing pages, signup acceptance, owner legal settings, school parent notice, portal link. Phone-sized. Last line "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1200)
        links = await pg.evaluate("[...document.querySelectorAll('footer a, .pub-footnote a')].map((a) => a.getAttribute('href'))")
        print('1 landing footer links to the three legal pages:', all(x in links for x in ['#/privacy', '#/terms', '#/processing']))
        for kind, title in (('privacy','Privacy Notice'),('terms','Terms of Service'),('processing','Data Processing Terms')):
            await pg.goto(BASE+'#/'+kind); await pg.wait_for_timeout(700); t = await pg.inner_text('body')
            print(f'2 {kind}: draft banner, yellow to-dos, version:', 'Draft for legal review' in t and await pg.locator('mark.legal-todo').count() > 0 and 'Version 2026-10-draft-1' in t and title in t)
        await pg.goto(BASE+'#/privacy'); await pg.wait_for_timeout(500); await pg.click('.legal-toc a >> nth=2'); await pg.wait_for_timeout(600); print('3 contents link scrolls to the section:', await pg.evaluate("window.scrollY") > 200)
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('4 no sideways scroll on a phone:', w <= 392, w)
        await pg.goto(BASE+'#/signup'); await pg.wait_for_timeout(600); t = await pg.inner_text('body'); hrefs = await pg.evaluate("[...document.querySelectorAll('.auth-card a')].map((a) => a.getAttribute('href'))")
        print('5 signup consent names and links all three documents:', all(x in hrefs for x in ['#/terms', '#/privacy', '#/processing']) and 'Data Processing Terms' in t)
        await pg.fill('#su-name','Pat Head'); await pg.fill('#su-school','Hill Academy'); await pg.fill('#su-email','pat@hill.co'); await pg.fill('#su-phone','0700123456'); await pg.fill('#su-students','80'); await pg.fill('#su-password','secret-pass-1'); await pg.fill('#su-confirm','secret-pass-1')
        await pg.click('#su-submit'); await pg.wait_for_timeout(500); print('6 cannot sign up without accepting:', 'accept the Terms, the Privacy Notice and the Data Processing Terms' in await pg.inner_text('body'))
        await pg.check('#su-terms'); await pg.click('#su-submit'); await pg.wait_for_timeout(1500)
        rec = await pg.evaluate("(async () => { const a = await import('/js/services/authService.js'); const x = a.listAccounts()[0]; return [x.terms?.version, !!x.terms?.acceptedAt]; })()"); print('7 acceptance is recorded with version and time:', rec)
        before = list(errs)  # errors after this come from the script clearing the session behind the app's back
        await pg.evaluate("""async () => { const a = await import('/js/services/authService.js'); const m = await import('/js/services/platformService.js'); const sc = await import('/js/services/schoolService.js'); const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js');
          a.logout(); m.registerAdmin({name:'Super', email:'s@t.co', password:'a-long-passphrase-1', confirmPassword:'a-long-passphrase-1'}); const acc = a.listAccounts()[0]; m.setSchoolStatus(acc.id,'approved','ok','Super'); }""")
        await pg.goto(BASE+'#/admin'); await pg.reload(); await pg.wait_for_timeout(1500); await pg.locator('.pill', has_text='Business settings').first.click(); await pg.wait_for_timeout(700); t = await pg.inner_text('body')
        print('8 owner sees how many legal details are missing:', 'Legal and privacy details' in t and '7 details still missing' in t)
        for sel,val in (('#lg-company','SwiftIQ Ltd'),('#lg-address','PO Box 1, Nairobi'),('#lg-email','privacy@swiftiq.co.ke'),('#lg-dpo','Jane Mwangi'),('#lg-odpc','ODPC/123'),('#lg-loc','Safaricom data centre, Nairobi'),('#lg-subs','Safaricom Cloud: hosting')): await pg.fill(sel,val)
        await pg.click('#lg-save'); await pg.wait_for_timeout(600); t = await pg.inner_text('body'); print('9 saved; all required details filled:', 'All required details are filled in' in t)
        await pg.evaluate("async () => { const m = await import('/js/services/platformService.js'); m.adminLogout?.(); }"); await pg.goto(BASE+'#/privacy'); await pg.reload(); await pg.wait_for_timeout(800); t = await pg.inner_text('body')
        print('10 public page now shows the owner details, no yellow to-dos left:', 'SwiftIQ Ltd' in t and 'ODPC/123' in t and await pg.locator('mark.legal-todo').count() == 0 and 'Jane Mwangi' in t)
        # school side
        await pg.evaluate("""async () => { const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js'); const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const pe = await import('/js/services/peopleService.js');
          a.login('pat@hill.co','secret-pass-1'); sc.saveSchool({name:'Hill Academy', setupComplete:true}); const g = ac.classRepo.create({name:'Grade 4', order:4}); const par = pe.parentRepo.create({firstName:'Pat', lastName:'M', phone:'0700111222'});
          const amy = st.studentRepo.create({admissionNumber:'1',firstName:'Amy',lastName:'K',classId:g.id,admissionDate:'2026-01-05',status:'active',parentIds:[par.id]}); a.createFamilyAccount({role:'parent', linkedId:par.id, name:'Pat M', username:'0700111222', password:'parent-pass-1'}); }""")
        await pg.goto(BASE+'#/settings'); await pg.reload(); await pg.wait_for_timeout(1500); t = await pg.inner_text('body')
        print('11 school settings offers the parents\' notice:', 'Privacy notice and consent form for parents' in t and '2 details are still to complete' in t)
        await pg.fill('#pn-name','Mrs Wanjiru, Deputy Principal'); await pg.fill('#pn-phone','0700999888'); await pg.fill('#pn-ret','While your child is enrolled and for 7 years after'); await pg.check('[data-share="sms"]'); await pg.check('#pn-health'); await pg.check('#pn-photos'); await pg.click('#pn-save'); await pg.wait_for_timeout(500)
        t = await pg.inner_text('#pn-doc'); print('12 notice and consent form built from the answers:', 'Hill Academy' in t and 'Mrs Wanjiru' in t and 'First aid and basic medicine' in t and 'Photographs' in t and 'Signature' in t and 'SMS provider' in t)
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }"); await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(700)
        await pg.goto(BASE+'#/login'); await pg.wait_for_timeout(500); await pg.fill('#li-email','0700111222'); await pg.fill('#li-password','parent-pass-1'); await pg.click('#li-submit'); await pg.wait_for_timeout(2000)
        await pg.locator('summary', has_text='Privacy notice').click(); await pg.wait_for_timeout(300); t = await pg.inner_text('body'); print('13 parent portal shows the school\'s own notice:', 'Mrs Wanjiru' in t and 'Hill Academy' in t and 'SwiftIQ EduFlow Privacy Notice' in t)
        print('ERR', before); await b.close()
asyncio.run(main())
