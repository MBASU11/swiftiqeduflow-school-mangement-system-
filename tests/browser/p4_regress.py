import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':800})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1000)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js'); const s = await import('/js/services/subscriptionService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const pe = await import('/js/services/peopleService.js'); const T = await import('/js/services/teacherService.js');
          const r = a.register({name:'Head', schoolName:'Rg School', email:'head@rg.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:20, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@rg.co','secret-pass-1'); sc.saveSchool({name:'Rg', setupComplete:true});
          await s.adminSetSubscription(r.id,{status:'active',packageId:'professional',billing:'annual',addons:['teacher-pack'],startDate:'2026-10-01',expiryDate:'2027-09-30'},'t');
          const g4 = ac.classRepo.create({name:'Grade 4', order:4}); const math = ac.subjectRepo.create({name:'Maths', classIds:[g4.id]}); ac.termRepo.create({name:'Term 1', isCurrent:true});
          st.studentRepo.create({admissionNumber:'A1',firstName:'Amy',lastName:'K',classId:g4.id,admissionDate:'2026-01-05',status:'active',parentIds:[]});
          const t = pe.teacherRepo.create({firstName:'Tina',lastName:'T',email:'tina@rg.co',category:'teaching'});
          a.createStaffAccount({name:'Tina T', email:'tina@rg.co', role:'teacher', password:'secret-pass-1'}); await T.allocate(t.id, g4.id, math.id);
          a.logout(); a.login('tina@rg.co','secret-pass-1'); }""")
        await pg.goto(BASE+'#/academics'); await pg.reload(); await pg.wait_for_timeout(1500)
        await pg.click('[data-tab="lessons"]'); await pg.wait_for_timeout(700)
        print('ACADEMICS as teacher — "New lesson plan" visible:', await pg.locator('#lp-new').is_visible())
        await pg.click('#lp-new'); await pg.wait_for_timeout(300); print('  form opens, Save visible:', await pg.locator('#lp-save').is_visible())
        await pg.click('[data-tab="homework"]'); await pg.wait_for_timeout(500); print('  homework "New homework" visible:', await pg.locator('#hw-new').is_visible())
        await pg.goto(BASE+'#/workspace'); await pg.wait_for_timeout(1200); await pg.screenshot(path='/tmp/p4_mobile.png')
        print('ERR', errs); await b.close()
asyncio.run(main())
