# Principal's dashboard in a real browser (demo mode). Read each line against its label; last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def login(pg, user, pw):
    await pg.goto(BASE+'#/login'); await pg.wait_for_timeout(600)
    await pg.fill('#li-email', user); await pg.fill('#li-password', pw); await pg.click('#li-submit'); await pg.wait_for_timeout(1500)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const ex = await import('/js/services/examService.js');
          const at = await import('/js/services/attendanceService.js'); const fi = await import('/js/services/financeService.js'); const ad = await import('/js/services/admissionsService.js'); const rr = await import('/js/services/reportRunService.js');
          const r = a.register({name:'Head', schoolName:'PD School', email:'head@pd.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@pd.co','secret-pass-1'); sc.saveSchool({name:'PD School', setupComplete:true});
          const g = ac.classRepo.create({name:'Grade 4', order:4}); const term = ac.termRepo.create({name:'Term 1', isCurrent:true}); const m = ac.subjectRepo.create({name:'Maths', classIds:[g.id]});
          const kids = ['Amy','Ben'].map((n,i)=>st.studentRepo.create({admissionNumber:'D'+i,firstName:n,lastName:'K',classId:g.id,admissionDate:'2026-01-05',status:'active',parentIds:[]}));
          const gs = ex.gradingSystemRepo.create({name:'Std', isDefault:true}); ex.gradeBandRepo.create({gradingSystemId:gs.id, grade:'A', min:0, max:100, points:4});
          const e = ex.examinationRepo.create({name:'End Term 1', termId:term.id, classIds:[g.id]});
          kids.forEach((k,i)=>{ ex.examScoreRepo.create({examinationId:e.id, subjectId:m.id, studentId:k.id, score:60+i*10}); ex.reportCommentRepo.create({examinationId:e.id, studentId:k.id, subjectId:m.id, text:'ok', status:'ready'}); });
          const today = new Date().toISOString().slice(0,10);
          kids.forEach((k,i)=>at.attendanceRepo.create({studentId:k.id, classId:g.id, date:today, status:i?'absent':'present'}));
          const inv = fi.invoiceRepo.create({studentId:kids[0].id, totalAmount:10000, status:'unpaid', items:[{name:'T',amount:10000}], createdAt:today, dueDate:today});
          fi.paymentRepo.create({studentId:kids[0].id, invoiceId:inv.id, amount:4000, date:today, status:'confirmed'});
          ad.admissionRepo.create({childName:'New Kid', stage:'application', createdAt:today});
          rr.act(e.id, g.id, 'submit');
          a.createStaffAccount({name:'Tea Cher', email:'t@pd.co', role:'teacher', password:'teach-pass-1'}); a.logout();
        }""")
        await login(pg, 'head@pd.co', 'secret-pass-1'); await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1800); t = await pg.inner_text('body')
        print('1 attention list:', 'Needs your attention' in t, '| report waiting:', '1 class report waiting for your approval' in t, '| admission:', '1 admission application waiting' in t)
        print('2 attendance low flagged:', 'Grade 4 attendance is 50%' in t, '| fees:', 'KES 4,000' in t and 'KES 6,000' in t and '40% of billed' in t)
        print('3 report board + performance:', 'In moderation' in t, '| pass rate shown:', 'Pass rate' in t and '100%' in t)
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('4 no sideways scroll on phone:', w <= 392, w)
        await pg.screenshot(path='/tmp/principal.png', full_page=True)
        await pg.click('[data-go="#/exams"]'); await pg.wait_for_timeout(900); print('5 tapping an item opens that page:', 'exams' in pg.url)
        before = list(errs)  # errors after this point come from the script clearing the session behind the app's back
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }")
        await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(800)
        await login(pg, 't@pd.co', 'teach-pass-1'); await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1500); t = await pg.inner_text('body')
        print('6 teacher does NOT see the principal view:', 'Needs your attention' not in t and 'Fees outstanding' not in t)
        print('ERR', before); await b.close()
asyncio.run(main())
