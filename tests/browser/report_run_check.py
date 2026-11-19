# Report-run workflow in a real browser (demo mode). Read the printed lines against each label; last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def openReports(pg):
    t = pg.locator('#tab-exams')
    if await t.count(): await t.click(); await pg.wait_for_timeout(500)
    await pg.locator('.pill', has_text='Report cards').first.click()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('wrong mark') if d.type=='prompt' else d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const ex = await import('/js/services/examService.js');
          const r = a.register({name:'Head', schoolName:'RR School', email:'head@rr.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@rr.co','secret-pass-1'); sc.saveSchool({name:'RR School', setupComplete:true});
          const g = ac.classRepo.create({name:'Grade 4', order:4}); const term = ac.termRepo.create({name:'Term 1', isCurrent:true});
          const m = ac.subjectRepo.create({name:'Maths', classIds:[g.id]});
          const s1 = st.studentRepo.create({admissionNumber:'R1',firstName:'Amy',lastName:'K',classId:g.id,admissionDate:'2026-01-05',status:'active',parentIds:[]});
          const gs = ex.gradingSystemRepo.create({name:'Std', isDefault:true}); ex.gradeBandRepo.create({gradingSystemId:gs.id, grade:'A', min:0, max:100, points:4});
          ex.examinationRepo.create({name:'End Term 1', termId:term.id, classIds:[g.id], startDate:'2026-03-01', endDate:'2026-03-10'});
          window.__ids = {m:m.id, s:s1.id};
        }""")
        await pg.goto(BASE+'#/exams'); await pg.reload(); await pg.wait_for_timeout(1200)
        await openReports(pg); await pg.wait_for_timeout(800)
        txt = lambda: pg.inner_text('body')
        t = await txt(); print('1 panel shows Draft + blocker:', 'Report approval' in t, 'Draft' in t, 'missing marks' in t)
        print('2 submit disabled:', await pg.locator('[data-run=submit]').is_disabled(), '| share disabled:', await pg.locator('#share-btn').is_disabled())
        await pg.evaluate("""async () => { const ex = await import('/js/services/examService.js'); const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js');
          const s = st.studentRepo.getAll()[0], sub = ac.subjectRepo.getAll()[0], e = ex.examinationRepo.getAll()[0];
          ex.saveExamScores(e.id, sub.id, {[s.id]:'80'}); ex.reportCommentRepo.create({examinationId:e.id, studentId:s.id, subjectId:sub.id, text:'Good', status:'ready'}, 'seed'); }""")
        await pg.reload(); await pg.wait_for_timeout(1200); await openReports(pg); await pg.wait_for_timeout(800)
        print('3 submit enabled:', not await pg.locator('[data-run=submit]').is_disabled())
        await pg.click('[data-run=submit]'); await pg.wait_for_timeout(600)
        t = await txt(); print('4 now In moderation + locked:', 'In moderation' in t, 'locked' in t)
        print('5 card shows draft banner:', 'not yet approved' in t.lower())
        print('6 approve blocked for same person:', await pg.locator('[data-run=approve]').is_disabled())
        await pg.evaluate("""async () => { const ex = await import('/js/services/examService.js'); ex.reportPolicyRepo.create({separateApprover:false}, 'test'); }""")
        await pg.reload(); await pg.wait_for_timeout(1200); await openReports(pg); await pg.wait_for_timeout(800)
        await pg.click('[data-run=approve]'); await pg.wait_for_timeout(600)
        t = await txt(); print('7 approved, name stamped:', 'Approved by' in t and 'Head' in t, '| share still disabled:', await pg.locator('#share-btn').is_disabled())
        await pg.click('[data-run=publish]'); await pg.wait_for_timeout(600)
        t = await txt(); print('8 published, banner gone, share enabled:', 'Published' in t, 'not yet approved' not in t.lower(), not await pg.locator('#share-btn').is_disabled())
        await pg.click('[data-run=unpublish]'); await pg.wait_for_timeout(600)
        print('9 unpublish with reason -> Approved:', 'Approved' in await txt(), '| share disabled again:', await pg.locator('#share-btn').is_disabled())
        await pg.screenshot(path='/tmp/run_panel.png')
        print('ERR', errs); await b.close()
asyncio.run(main())
