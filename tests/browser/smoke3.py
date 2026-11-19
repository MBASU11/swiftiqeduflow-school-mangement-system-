import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1300,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:400]))
        await pg.goto('http://localhost:8765/index.html'); await pg.wait_for_timeout(1200)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const p = await import('/js/services/platformService.js');
          const s = await import('/js/services/subscriptionService.js'); const sc = await import('/js/services/schoolService.js');
          
          const r = a.register({name:'Head', schoolName:'Cap School', email:'cap2@x.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:90, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'});
          a.logout(); a.login('cap2@x.co','secret-pass-1');
          sc.saveSchool({name:'Cap School', setupComplete:true});
          await s.adminSetSubscription(r.id,{status:'active',packageId:'micro',billing:'annual',addons:[],startDate:'2026-10-01',expiryDate:'2027-09-30',limits:{paidLimit:3,overflow:2},overrides:{modules:{finance:false},features:{}}},'smoke');
        }""")
        await pg.reload(); await pg.wait_for_timeout(1500)
        nav = await pg.inner_text('#sidebar-nav'); print('NAV has Finance:', 'Finance' in nav, '| has Subscription:', 'Subscription' in nav)
        await pg.goto('http://localhost:8765/index.html#/finance'); await pg.wait_for_timeout(700)
        print('FINANCE GATED:', (await pg.inner_text('#app'))[:140].replace('\n',' | ') if 'Not included' in await pg.inner_text('#app') else 'NOT GATED')
        # add students through the real repository up to the max (3+2=5), then try a 6th
        res = await pg.evaluate("""async () => {
          const {studentRepo} = await import('/js/services/studentService.js'); const out=[];
          for (let i=1;i<=6;i++){ try{ studentRepo.create({admissionNumber:'N'+i,firstName:'A',lastName:'B'+i,classId:'c',admissionDate:'2026-10-01',status:'active',parentIds:[]}); out.push('ok'+i);}catch(e){ out.push(e.name+': '+e.message);} }
          return out; }""")
        print('ENROL:', res)
        await pg.goto('http://localhost:8765/index.html#/subscription'); await pg.wait_for_timeout(900)
        t = await pg.inner_text('#app'); print('SUB PAGE:', t[t.find('Subscription'):][:700].replace('\n',' | '))
        await pg.goto('http://localhost:8765/index.html#/students'); await pg.wait_for_timeout(900)
        print('BANNER:', (await pg.inner_text('#capacity-banner'))[:220])
        await pg.screenshot(path='/tmp/school.png')
        print('ERR', errs); await b.close()
asyncio.run(main())
