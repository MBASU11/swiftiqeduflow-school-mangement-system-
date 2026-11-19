# Hostel / boarding in a real browser (demo mode), driven through the screens. Last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def login(pg, user, pw):
    await pg.goto(BASE+'#/login'); await pg.wait_for_timeout(600)
    await pg.fill('#li-email', user); await pg.fill('#li-password', pw); await pg.click('#li-submit'); await pg.wait_for_timeout(1500)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('Not this weekend') if d.type=='prompt' else d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js'); const se = await import('/js/services/settingsService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js');
          const r = a.register({name:'Head', schoolName:'HB School', email:'head@hb.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@hb.co','secret-pass-1'); sc.saveSchool({name:'HB School', setupComplete:true});
          const g = ac.classRepo.create({name:'Form 1', order:1});
          [['Ben','male'],['Cy','male'],['Amy','female']].forEach(([n,sx],i)=>st.studentRepo.create({admissionNumber:'B'+i,firstName:n,lastName:'K',classId:g.id,gender:sx,admissionDate:'2026-01-05',status:'active',parentIds:[]}));
          a.createStaffAccount({name:'Acc Ountant', email:'ac@hb.co', role:'accountant', password:'acct-pass-1'}); a.logout();
        }""")
        await login(pg, 'head@hb.co', 'secret-pass-1'); await pg.goto(BASE+'#/hostel'); await pg.wait_for_timeout(1200)
        await pg.click('#new-h'); await pg.fill('#h-name', 'Simba House'); await pg.select_option('#h-gender', 'boys'); await pg.click('#h-save'); await pg.wait_for_timeout(500)
        t = await pg.inner_text('body'); print('1 hostel created and opened:', 'Simba House' in t and 'No rooms yet' in t)
        await pg.click('#new-room'); await pg.fill('#r-name', 'Room 1'); await pg.fill('#r-cap', '1'); await pg.click('#r-save'); await pg.wait_for_timeout(400)
        await pg.click('#new-room'); await pg.fill('#r-name', 'Room 2'); await pg.fill('#r-cap', '2'); await pg.click('#r-save'); await pg.wait_for_timeout(400)
        t = await pg.inner_text('body'); print('2 rooms added:', '0 of 1 beds' in t and '0 of 2 beds' in t)
        sel = pg.locator('select[data-who]').first; opts = await sel.locator('option').all_inner_texts(); print('3 girl not offered for boys hostel:', not any('Amy' in o for o in opts), opts)
        await sel.select_option(label='Ben K (Form 1)'); await pg.locator('[data-allocate]').first.click(); await pg.wait_for_timeout(400)
        t = await pg.inner_text('body'); print('4 Ben has a bed, room 1 full:', 'Ben K' in t and '1 of 1 beds' in t)
        await pg.click('[data-tab=exeats]'); await pg.wait_for_timeout(300); await pg.click('#new-x'); await pg.select_option('#x-who', label='Ben K'); await pg.fill('#x-reason', 'Family wedding'); await pg.click('#x-save'); await pg.wait_for_timeout(300)
        t = await pg.inner_text('body'); print('5 missing guardian refused:', 'parent or guardian' in t)
        await pg.fill('#x-guard', 'Mum 0700 111 222'); await pg.click('#x-save'); await pg.wait_for_timeout(400); t = await pg.inner_text('body'); print('6 requested:', 'Exeat requested' in t and 'Requested' in t)
        await pg.click('[data-xact=approve]'); await pg.wait_for_timeout(300); await pg.click('[data-xact=checkout]'); await pg.wait_for_timeout(400)
        t = await pg.inner_text('body'); print('7 approved and released:', 'Out of school' in t)
        await pg.click('[data-tab=roll]'); await pg.wait_for_timeout(400); await pg.click('#rc-save'); await pg.wait_for_timeout(400)
        t = await pg.inner_text('body'); print('8 roll call: Ben on exeat, nobody unaccounted:', '1 on exeat' in t and 'Everyone is accounted for' in t)
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('9 no sideways scroll:', w <= 392, w)
        before = list(errs)
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }"); await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(700)
        await login(pg, 'ac@hb.co', 'acct-pass-1'); await pg.goto(BASE+'#/hostel'); await pg.wait_for_timeout(1200); t = await pg.inner_text('body')
        print('10 accountant cannot see boarding:', 'Simba House' not in t and 'New hostel' not in t)
        print('ERR', before); await b.close()
asyncio.run(main())
