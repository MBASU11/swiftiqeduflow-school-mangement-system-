# Learner and parent portals in a real browser (demo mode). Read each line against its label; last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def login(pg, user, pw):
    await pg.goto(BASE+'#/login'); await pg.wait_for_timeout(700)
    await pg.fill('#li-email', user); await pg.fill('#li-password', pw); await pg.click('#li-submit'); await pg.wait_for_timeout(1500)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const ex = await import('/js/services/examService.js');
          const pe = await import('/js/services/peopleService.js'); const fi = await import('/js/services/financeService.js'); const rr = await import('/js/services/reportRunService.js');
          const r = a.register({name:'Head', schoolName:'PT School', email:'head@pt.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@pt.co','secret-pass-1'); sc.saveSchool({name:'PT School', setupComplete:true});
          const g = ac.classRepo.create({name:'Grade 4', order:4}); const term = ac.termRepo.create({name:'Term 1', isCurrent:true});
          const m = ac.subjectRepo.create({name:'Maths', classIds:[g.id]});
          const par = pe.parentRepo.create({firstName:'Pat', lastName:'Mwangi', phone:'0700111222'});
          const s1 = st.studentRepo.create({admissionNumber:'A100',firstName:'Amy',lastName:'Mwangi',classId:g.id,admissionDate:'2026-01-05',status:'active',parentIds:[par.id]});
          const gs = ex.gradingSystemRepo.create({name:'Std', isDefault:true}); ex.gradeBandRepo.create({gradingSystemId:gs.id, grade:'A', min:0, max:100, points:4});
          const e = ex.examinationRepo.create({name:'End Term 1', termId:term.id, classIds:[g.id]});
          ex.examScoreRepo.create({examinationId:e.id, subjectId:m.id, studentId:s1.id, score:82}); ex.reportCommentRepo.create({examinationId:e.id, studentId:s1.id, subjectId:m.id, text:'Great', status:'ready'});
          fi.invoiceRepo.create({studentId:s1.id, totalAmount:10000, status:'unpaid', items:[{name:'Tuition',amount:10000}], createdAt:'2026-01-01', dueDate:'2026-02-01'});
          ex.reportPolicyRepo.create({separateApprover:false});
          rr.act(e.id,g.id,'submit'); rr.act(e.id,g.id,'approve'); rr.act(e.id,g.id,'publish');
          a.createFamilyAccount({role:'student', linkedId:s1.id, name:'Amy Mwangi', username:'A100', password:'learner-pass-1'});
          a.createFamilyAccount({role:'parent', linkedId:par.id, name:'Pat Mwangi', username:'0700111222', password:'parent-pass-1'});
          a.logout();
        }""")
        await login(pg, 'A100', 'learner-pass-1'); t = await pg.inner_text('body')
        print('1 learner portal:', 'Learner portal' in t, '| sees own name:', 'Amy Mwangi' in t, '| report card listed:', 'End Term 1' in t, '| NO fees:', 'Fees' not in t and 'Balance' not in t)
        await pg.click('[data-open-card]'); await pg.wait_for_timeout(500); t = await pg.inner_text('body'); print('2 card opens, approver stamp:', 'Approved by' in t and 'Head' in t, '| no draft banner:', 'not yet approved' not in t.lower())
        await pg.screenshot(path='/tmp/learner.png')
        await pg.click('#pp-logout'); await pg.wait_for_timeout(1200)
        await login(pg, 'wrong', 'x'); t = await pg.inner_text('body'); print('3 bad login refused:', 'incorrect' in t)
        await login(pg, '0700111222', 'parent-pass-1'); t = await pg.inner_text('body')
        print('4 parent portal:', 'Parent portal' in t, '| fees shown:', 'Balance' in t and '10,000' in t, '| report card listed:', 'End Term 1' in t)
        print('5 cannot reach staff screens:', 'Dashboard' not in t)
        await pg.goto(BASE+'#/students'); await pg.wait_for_timeout(1200); t = await pg.inner_text('body'); print('6 #/students still shows only the portal:', 'Parent portal' in t)
        await pg.reload(); await pg.wait_for_timeout(1200); print('7 survives reload:', 'Parent portal' in await pg.inner_text('body'))
        await pg.click('#pp-logout'); await pg.wait_for_timeout(1200)
        await login(pg, 'head@pt.co', 'secret-pass-1'); await pg.goto(BASE+'#/settings'); await pg.wait_for_timeout(1500); t = await pg.inner_text('body')
        print('8 admin sees Learner and parent logins:', 'Learner and parent logins' in t, '| lists A100:', 'A100' in t)
        print('ERR', errs); await b.close()
asyncio.run(main())
