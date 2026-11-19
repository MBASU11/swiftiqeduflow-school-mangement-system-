# Student profile tabs and the refreshed landing page in a real browser (demo mode). Last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1500); t = await pg.inner_text('body')
        print('1 landing lists the newer modules:', all(x in t for x in ['Inventory', 'Reports Center', "Principal's view", 'Parent & learner portals', 'Hostel & boarding', 'Clubs & activities']))
        print('2 stale line gone, health marked coming soon:', 'Coming soon: Inventory' not in t and 'school health records' in t)
        print('3 no comparison table on the landing page:', await pg.locator('.cmp-table').count() == 0 and 'Compare packages' not in t)
        await pg.evaluate("""async () => { const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js'); const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js');
          const fi = await import('/js/services/financeService.js'); const at = await import('/js/services/attendanceService.js'); const ex = await import('/js/services/examService.js');
          const r = a.register({name:'Head', schoolName:'PF School', email:'h@pf.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'}); a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('h@pf.co','secret-pass-1'); sc.saveSchool({name:'PF School', setupComplete:true});
          const g = ac.classRepo.create({name:'Grade 4', order:4}); const term = ac.termRepo.create({name:'T1', isCurrent:true}); const m = ac.subjectRepo.create({name:'Maths', classIds:[g.id]});
          const amy = st.studentRepo.create({admissionNumber:'1',firstName:'Amy',lastName:'K',classId:g.id,admissionDate:'2026-01-05',status:'active',parentIds:[]}); window.__id = amy.id;
          const gs = ex.gradingSystemRepo.create({name:'S', isDefault:true}); ex.gradeBandRepo.create({gradingSystemId:gs.id, grade:'A', min:0, max:100});
          const e = ex.examinationRepo.create({name:'Mid Term', termId:term.id, classIds:[g.id], startDate:'2026-03-01'}); ex.examScoreRepo.create({examinationId:e.id, subjectId:m.id, studentId:amy.id, score:81});
          at.attendanceRepo.create({studentId:amy.id, classId:g.id, date:new Date().toISOString().slice(0,10), status:'present'});
          const inv = fi.invoiceRepo.create({studentId:amy.id, totalAmount:5000, status:'unpaid', items:[{name:'T',amount:5000}], createdAt:'2026-01-01', dueDate:'2026-02-01'}); fi.recordPayment({studentId:amy.id, invoiceId:inv.id, amount:2000, method:'mpesa', reference:'R77', date:'2026-01-05'}); }""")
        sid = await pg.evaluate("(async () => { const st = await import('/js/services/studentService.js'); return st.studentRepo.getAll()[0].id; })()")
        await pg.goto(BASE+'#/students/'+sid); await pg.reload(); await pg.wait_for_timeout(1500)
        async def tab(name):
            await pg.click(f'[data-tab="{name}"]'); await pg.wait_for_timeout(500); return await pg.inner_text('#tab-content')
        t = await tab('Academics'); print('4 Academics shows marks:', 'Mid Term' in t and '81' in t and 'Maths' in t)
        t = await tab('Attendance'); print('5 Attendance shows 100% today:', '100%' in t)
        t = await tab('Finance'); print('6 Finance shows balance and payment:', 'KES 3,000' in t and 'R77' in t)
        t = await tab('Discipline'); print('7 Discipline honest empty state:', 'No discipline records' in t)
        t = await tab('Transport'); print('8 Transport honest empty state:', 'does not use school transport' in t)
        t = await tab('Activities'); print('9 Activities honest empty state:', 'not in any club' in t)
        t = await tab('Health'); print('10 Health summary opens for the administrator, logged:', 'Health summary' in t and 'Allergies' in t)
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('11 no sideways scroll:', w <= 392, w)
        print('ERR', errs); await b.close()
asyncio.run(main())
