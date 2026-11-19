# Activities in a real browser (demo mode), driven through the screens. Last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def login(pg, user, pw):
    await pg.goto(BASE+'#/login'); await pg.wait_for_timeout(600)
    await pg.fill('#li-email', user); await pg.fill('#li-password', pw); await pg.click('#li-submit'); await pg.wait_for_timeout(1500)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js');
          const r = a.register({name:'Head', schoolName:'AC School', email:'head@ac.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@ac.co','secret-pass-1'); sc.saveSchool({name:'AC School', setupComplete:true});
          const g = ac.classRepo.create({name:'Grade 4', order:4});
          ['Amy','Ben','Cy'].forEach((n,i)=>st.studentRepo.create({admissionNumber:'C'+i,firstName:n,lastName:'K',classId:g.id,admissionDate:'2026-01-05',status:'active',parentIds:[]}));
          a.createStaffAccount({name:'Tea Cher', email:'t@ac.co', role:'teacher', password:'teach-pass-1'});
          a.createStaffAccount({name:'Acc Ountant', email:'ac@ac.co', role:'accountant', password:'acct-pass-1'}); a.logout();
        }""")
        await login(pg, 'head@ac.co', 'secret-pass-1'); await pg.goto(BASE+'#/activities'); await pg.wait_for_timeout(1200)
        t = await pg.inner_text('body'); print('1 empty state:', 'Add the first club' in t)
        await pg.click('#new-act'); await pg.fill('#f-name', 'Chess Club'); await pg.fill('#f-cap', '2'); await pg.select_option('#f-day', 'Friday'); await pg.fill('#f-start', '16:00'); await pg.fill('#f-end', '17:00'); await pg.click('#f-save'); await pg.wait_for_timeout(500)
        t = await pg.inner_text('body'); print('2 created, opened:', 'Chess Club' in t and 'Friday 16:00–17:00' in t)
        for n in ('Amy','Ben','Cy'):
            await pg.select_option('#add-who', label=f'{n} K (Grade 4)'); await pg.click('#add-btn'); await pg.wait_for_timeout(300)
        t = await pg.inner_text('body'); print('3 two in, third refused as full:', 'Full: all 2 places are taken' in t and 'Amy K' in t and 'Ben K' in t)
        await pg.click('[data-tab=sessions]'); await pg.wait_for_timeout(300); await pg.check('[data-present]:nth-of-type(1)'); await pg.click('#s-save'); await pg.wait_for_timeout(400)
        t = await pg.inner_text('body'); print('4 session saved:', 'Session saved' in t and '1 present' in t)
        await pg.click('[data-tab=wins]'); await pg.fill('#w-title', 'Zone champions'); await pg.select_option('#w-level', 'zone'); await pg.click('#w-save'); await pg.wait_for_timeout(400)
        t = await pg.inner_text('body'); print('5 achievement saved:', 'Zone champions' in t)
        await pg.click('[data-tab=members]'); await pg.wait_for_timeout(300); t = await pg.inner_text('body'); print('6 attendance per member:', 'Attended 1 of 1 sessions (100%)' in t)
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('7 no sideways scroll:', w <= 392, w)
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1500); t = await pg.inner_text('body'); print('8 principal dashboard shows participation:', 'In activities' in t and '2 of 3 learners' in t)
        before = list(errs)
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }"); await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(700)
        await login(pg, 't@ac.co', 'teach-pass-1'); await pg.goto(BASE+'#/activities'); await pg.wait_for_timeout(1200); t = await pg.inner_text('body')
        print('9 teacher can open and add:', 'Chess Club' in t and 'New activity' in t)
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }"); await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(700)
        await login(pg, 'ac@ac.co', 'acct-pass-1'); await pg.goto(BASE+'#/activities'); await pg.wait_for_timeout(1200); t = await pg.inner_text('body')
        print('10 accountant cannot see Activities:', 'Chess Club' not in t and 'New activity' not in t)
        print('ERR', before); await b.close()
asyncio.run(main())
