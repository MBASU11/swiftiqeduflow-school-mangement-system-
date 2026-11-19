import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1200,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:250]))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1000)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const ex = await import('/js/services/examService.js'); const as = await import('/js/services/assessmentService.js');
          const r = a.register({name:'Head', schoolName:'RS School', email:'head@rs.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:20, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@rs.co','secret-pass-1'); sc.saveSchool({name:'RS School', setupComplete:true});
          const g4 = ac.classRepo.create({name:'Grade 4', order:4}); const term = ac.termRepo.create({name:'Term 1', isCurrent:true, startDate:'2026-01-01', endDate:'2026-04-30'});
          const math = ac.subjectRepo.create({name:'Maths', classIds:[g4.id]});
          const gs = ex.gradingSystemRepo.create({name:'Default', isDefault:true});
          [['A',80,100],['B',70,79],['C',50,69]].forEach(([g,mn,mx])=>ex.gradeBandRepo.create({gradingSystemId:gs.id, grade:g, min:mn, max:mx, points:1})); // deliberately no 0-49 band
          const mk=(n,i)=>st.studentRepo.create({admissionNumber:'R'+i,firstName:n,lastName:'K',classId:g4.id,admissionDate:'2026-01-05',status:'active',parentIds:[]});
          const s1=mk('Amy',1), s2=mk('Ben',2);
          const e = ex.examinationRepo.create({name:'End Term 1', termId:term.id, classIds:[g4.id], startDate:'2026-03-01', endDate:'2026-03-10'});
          ex.examScoreRepo.create({examinationId:e.id, subjectId:math.id, studentId:s1.id, score:90}); ex.examScoreRepo.create({examinationId:e.id, subjectId:math.id, studentId:s2.id, score:60});
          const cat = as.assessmentRepo.create({name:'CAT 1', classId:g4.id, subjectId:math.id, type:'cat', maxScore:50, date:'2026-02-10'});
          as.assessmentScoreRepo.create({assessmentId:cat.id, studentId:s1.id, score:40}); as.assessmentScoreRepo.create({assessmentId:cat.id, studentId:s2.id, score:25});
        }""")
        await pg.goto(BASE+'#/exams'); await pg.reload(); await pg.wait_for_timeout(1500)
        await pg.click('#tab-rsettings'); await pg.wait_for_timeout(600)
        t = await pg.inner_text('body'); print('GRADE SCALE check flags the missing 0–49 band:', 'have no grade' in t, '|', [l for l in t.split('\n') if 'no grade' in l][:1])
        await pg.select_option('#p-rank','none'); await pg.click('#p-save'); await pg.wait_for_timeout(600); print('POLICY saved:', 'Policy saved' in await pg.inner_text('body'))
        await pg.click('#s-new'); await pg.wait_for_timeout(300)
        await pg.fill('[data-comp="1"] [data-c=weight]','30'); await pg.dispatch_event('[data-comp="1"] [data-c=weight]','change'); await pg.wait_for_timeout(300)
        print('INVALID weights show error:', 'not 100' in await pg.inner_text('body'))
        await pg.fill('[data-comp="1"] [data-c=weight]','40'); await pg.dispatch_event('[data-comp="1"] [data-c=weight]','change'); await pg.wait_for_timeout(300)
        await pg.select_option('[data-s=subjectId]', index=1); await pg.click('#s-save'); await pg.wait_for_timeout(600); print('SCHEME saved:', 'Scheme saved' in await pg.inner_text('body'))
        # report card now: ranking off, weighted maths for Amy = 0.6*90 + 0.4*80 = 86
        card = await pg.evaluate("""async () => { const RC = await import('/js/services/reportCardService.js'); const d = await RC.loadReportData(); const r = RC.buildClassResults(d, d.examinations[0].id, d.classes[0].id);
          const amy = d.students.find(s=>s.firstName==='Amy'); const m = RC.buildReportModel(d, d.examinations[0].id, d.classes[0].id, amy.id);
          return { amyMaths: r.reports.get(amy.id).rows[0].score, positions: r.positions.size, modelPosition: m.position }; }""")
        print('ENGINE USED:', card, '(expected Maths 86, positions 0, position null)')
        print('ERR', errs); await b.close()
asyncio.run(main())
