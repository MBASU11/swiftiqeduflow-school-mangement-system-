# CBC competency screens in a real browser (demo mode), phone-sized. Last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def login(pg, user, pw):
    await pg.goto(BASE+'#/login'); await pg.wait_for_timeout(600)
    await pg.fill('#li-email', user); await pg.fill('#li-password', pw); await pg.click('#li-submit'); await pg.wait_for_timeout(1800)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js'); const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const pe = await import('/js/services/peopleService.js'); const T = await import('/js/services/teacherService.js');
          const r = a.register({name:'Head', schoolName:'CB School', email:'h@cb.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'}); a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('h@cb.co','secret-pass-1'); sc.saveSchool({name:'CB School', setupComplete:true});
          const cur = ac.curriculumRepo.create({name:'CBC', type:'cbc'}); const g4 = ac.classRepo.create({name:'Grade 4', order:4, curriculumId:cur.id}); const g5 = ac.classRepo.create({name:'Grade 5', order:5, curriculumId:cur.id});
          ac.termRepo.create({name:'Term 1', isCurrent:true}); const m = ac.subjectRepo.create({name:'Maths', classIds:[g4.id,g5.id]}); const e = ac.subjectRepo.create({name:'English', classIds:[g4.id,g5.id]});
          ['Amy','Ben'].forEach((n,i)=>st.studentRepo.create({admissionNumber:'C'+i,firstName:n,lastName:'K',classId:g4.id,admissionDate:'2026-01-05',status:'active',parentIds:[]}));
          st.studentRepo.create({admissionNumber:'C9',firstName:'Zed',lastName:'K',classId:g5.id,admissionDate:'2026-01-05',status:'active',parentIds:[]});
          const t = pe.teacherRepo.create({firstName:'Tea',lastName:'Cher',email:'tea@cb.co',isActive:true}); await T.allocate(t.id, g4.id, m.id);
          a.createStaffAccount({name:'Tea Cher', email:'tea@cb.co', role:'teacher', password:'teach-pass-1'}); }""")
        await pg.goto(BASE+'#/academics'); await pg.reload(); await pg.wait_for_timeout(1500)
        await pg.click('[data-tab="competencies"]'); await pg.wait_for_timeout(800)
        await pg.click('[data-view="outcomes"]'); await pg.wait_for_timeout(400)
        await pg.fill('#cb-bulk', 'Numbers | Whole numbers | Read and write numbers to 10,000\nNumbers | Whole numbers | Add and subtract\nMeasurement | Tell the time'); await pg.click('#cb-add'); await pg.wait_for_timeout(600); t = await pg.inner_text('body')
        print('1 outcomes added and grouped by strand:', '3 outcomes added' in t and 'Numbers › Whole numbers' in t and 'Measurement' in t)
        await pg.fill('#cb-bulk', 'Measurement | Tell the time'); await pg.click('#cb-add'); await pg.wait_for_timeout(500); print('2 duplicate refused, nothing added:', 'already exists' in await pg.inner_text('body'))
        await pg.click('[data-view="rate"]'); await pg.wait_for_timeout(500)
        row = pg.locator('.cbc-row', has_text='Amy K'); await row.locator('button[data-level=exceeding]').click(); await pg.wait_for_timeout(500)
        print('3 tap rates Amy; button marked pressed:', await pg.locator('.cbc-row', has_text='Amy K').locator('button[data-level=exceeding]').get_attribute('aria-pressed') == 'true', '| summary:', '1 of 2 rated' in await pg.inner_text('#cb-sum'))
        await pg.locator('.cbc-row', has_text='Amy K').locator('button[data-level=approaching]').click(); await pg.wait_for_timeout(400)
        print('4 changing the level moves the highlight:', await pg.locator('.cbc-row', has_text='Amy K').locator('button[data-level=approaching]').get_attribute('aria-pressed') == 'true' and await pg.locator('.cbc-row', has_text='Amy K').locator('button[data-level=exceeding]').get_attribute('aria-pressed') == 'false')
        h = await pg.locator('.cbc-btn').first.bounding_box(); print('5 tap targets are finger-sized:', h['height'] >= 44 and h['width'] >= 44, round(h['width']), round(h['height']))
        await pg.locator('.cbc-row', has_text='Ben K').locator('button[data-level=below]').click(); await pg.wait_for_timeout(400)
        await pg.click('[data-view="learner"]'); await pg.wait_for_timeout(500); await pg.select_option('#cb-learner', label='Amy K'); await pg.wait_for_timeout(300)
        t = await pg.inner_text('body'); print('6 by learner: Maths outcomes with reached count:', 'Read and write numbers' in t and 'reached 0 of 3' in t)
        await pg.click('#cb-report'); await pg.wait_for_timeout(400); t = await pg.inner_text('#cbc-report'); print('7 printable report: school, learner, term, levels:', 'CB School' in t and 'Amy K' in t and 'Term 1' in t and 'Approaching expectation' in t and 'Not yet rated' in t)
        await pg.click('#cb-back'); await pg.click('[data-view="overview"]'); await pg.wait_for_timeout(500); t = await pg.inner_text('body')
        print('8 overview + support list:', 'rated below Meeting' in t and 'Ben K' in t and 'Learners needing support' in t)
        await pg.click('[data-view="coverage"]'); await pg.wait_for_timeout(500); print('9 coverage shows outcomes not covered:', 'not covered' in await pg.inner_text('body') and 'Outcomes taught' in await pg.inner_text('body'))
        await pg.goto(BASE+'#/academics'); await pg.wait_for_timeout(800); await pg.click('[data-tab="lessons"]'); await pg.wait_for_timeout(600); await pg.click('#lp-new'); await pg.wait_for_timeout(400)
        sel = pg.locator('[data-f="subjectId"]'); await sel.select_option(label='Maths'); await pg.wait_for_timeout(400); t = await pg.inner_text('body'); print('10 lesson plan offers the outcomes to tick:', 'Learning outcomes this lesson covers' in t and 'Add and subtract' in t)
        await pg.locator('[data-oc]').nth(1).check(); await pg.fill('[data-f="topic"]', 'Addition'); await pg.fill('[data-f="objectives"]', 'Add two numbers up to 1000'); await pg.click('#lp-save'); await pg.wait_for_timeout(800)
        await pg.click('[data-tab="competencies"]'); await pg.wait_for_timeout(600); await pg.click('[data-view="coverage"]'); await pg.wait_for_timeout(500); t = await pg.inner_text('body'); print('11 coverage now shows it planned:', '1 planned' in t)
        sid = await pg.evaluate("(async () => { const st = await import('/js/services/studentService.js'); return st.studentRepo.getAll().find((s) => s.firstName === 'Amy').id; })()")
        await pg.goto(BASE+'#/students/'+sid); await pg.wait_for_timeout(900); await pg.click('[data-tab="Competencies"]'); await pg.wait_for_timeout(600); t = await pg.inner_text('#tab-content'); print('12 student profile tab:', 'Competencies, Term 1' in t and 'Maths' in t)
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('13 no sideways scroll:', w <= 392, w)
        before = list(errs)
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }"); await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(700)
        await login(pg, 'tea@cb.co', 'teach-pass-1'); await pg.goto(BASE+'#/academics'); await pg.wait_for_timeout(1200)
        if await pg.locator('[data-tab="competencies"]').count(): await pg.click('[data-tab="competencies"]'); await pg.wait_for_timeout(900)
        classes = await pg.locator('#cb-class option').all_inner_texts(); subs = await pg.locator('#cb-subject option').all_inner_texts()
        print('14 teacher sees only their own class and subject:', classes, subs)
        print('ERR', before); await b.close()
asyncio.run(main())
