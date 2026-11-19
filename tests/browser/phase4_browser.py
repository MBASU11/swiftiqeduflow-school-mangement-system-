import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1300,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:250]))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1200)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js'); const s = await import('/js/services/subscriptionService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const pe = await import('/js/services/peopleService.js');
          const as = await import('/js/services/assessmentService.js'); const ex = await import('/js/services/examService.js'); const tt = await import('/js/services/timetableService.js');
          const T = await import('/js/services/teacherService.js'); const TL = await import('/js/services/teacherLogic.js');
          const r = a.register({name:'Head', schoolName:'P4 School', email:'head@p4.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:20, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@p4.co','secret-pass-1'); sc.saveSchool({name:'P4 School', setupComplete:true});
          await s.adminSetSubscription(r.id,{status:'active',packageId:'professional',billing:'annual',addons:['teacher-pack'],startDate:'2026-10-01',expiryDate:'2027-09-30'},'t');
          const cur = ac.curriculumRepo.create({name:'Competency curriculum'});
          const g4 = ac.classRepo.create({name:'Grade 4', order:4, curriculumId:cur.id}), g5 = ac.classRepo.create({name:'Grade 5', order:5});
          const term = ac.termRepo.create({name:'Term 1', isCurrent:true});
          const math = ac.subjectRepo.create({name:'Mathematics', classIds:[g4.id,g5.id]});
          const par = pe.parentRepo.create({firstName:'Ann', lastName:'Kamau', phone:'0711222333', relationship:'Mother'});
          const mk=(n,cl,pids)=>st.studentRepo.create({admissionNumber:n+'-'+cl.name,firstName:n,lastName:'K',classId:cl.id,admissionDate:'2026-01-05',status:'active',parentIds:pids});
          const amy = mk('Amy',g4,[par.id]); mk('Ben',g4,[]); mk('Zed',g5,[]);
          const tina = pe.teacherRepo.create({firstName:'Tina',lastName:'T',email:'tina@p4.co',category:'teaching'});
          a.createStaffAccount({name:'Tina T', email:'tina@p4.co', role:'teacher', password:'secret-pass-1'});
          await T.allocate(tina.id, g4.id, math.id, {classTeacher:true});
          const today = new Date().toISOString().slice(0,10);
          tt.timetableEntryRepo.create({classId:g4.id, subjectId:math.id, teacherId:tina.id, day: TL.dayCodeOf(today), startTime:'08:00', endTime:'09:00', kind:'lesson'});
          const asm = as.assessmentRepo.create({name:'CAT 1', classId:g4.id, subjectId:math.id, maxScore:50, date:'2026-01-20'});
          as.assessmentScoreRepo.create({assessmentId:asm.id, studentId:amy.id, score:40});
          ex.examinationRepo.create({name:'End Term 1', termId:term.id});
          const e = ex.examinationRepo.getAll()[0]; ex.examScoreRepo.create({examinationId:e.id, subjectId:math.id, studentId:amy.id, score:78});
        }""")
        # ---------- administrator: tabs, curriculum template
        await pg.goto(BASE+'#/academics'); await pg.reload(); await pg.wait_for_timeout(1500)
        body = await pg.inner_text('body'); print('ACADEMICS two rows:', 'TEACHER PACK' in body)
        await pg.click('[data-tab="frameworks"]'); await pg.wait_for_timeout(600)
        await pg.select_option('#fw-p', 'competency'); await pg.wait_for_timeout(500)
        print('TEMPLATE rows after preset:', await pg.locator('[data-row]').count())
        await pg.click('#fw-save'); await pg.wait_for_timeout(700); print('TEMPLATE saved:', 'Template saved' in await pg.inner_text('body'))
        # ---------- teacher
        await pg.evaluate("""async () => { const a = await import('/js/services/authService.js'); a.logout(); a.login('tina@p4.co','secret-pass-1'); }""")
        await pg.goto(BASE+'#/workspace'); await pg.reload(); await pg.wait_for_timeout(1800)
        print('NAV has My workspace:', 'My workspace' in await pg.inner_text('#sidebar-nav'))
        groups = await pg.locator('nav[aria-label=Workspace] p').all_inner_texts(); print('GROUPS:', groups)
        t = await pg.inner_text('#ws-body'); print('TODAY timetable shows lesson (bug fix):', '08:00' in t and 'Mathematics' in t)
        await pg.click('[data-ws="schedule"]'); await pg.wait_for_timeout(700); t = await pg.inner_text('#ws-body'); print('SCHEDULE deadlines + week:', 'Deadlines' in t and 'Weekly timetable' in t, '| marks-missing flagged:', 'mark(s) still missing' in t)
        await pg.click('[data-ws="classlist"]'); await pg.wait_for_timeout(700)
        print('CLASS options (only Grade 4):', await pg.locator('#cl-c option').all_inner_texts(), '| learners:', await pg.locator('[data-open]').count())
        await pg.locator('[data-open]').first.click(); await pg.wait_for_timeout(500); t = await pg.inner_text('#ws-body'); print('PROFILE shows parent phone + assessments:', '0711222333' in t and '80%' in t, '| fees hidden:', 'Fee, health and welfare details are not shown' in t)
        await pg.click('[data-ws="results"]'); await pg.wait_for_timeout(600); t = await pg.inner_text('#ws-body'); print('RESULTS shows 78 and class mean:', '78' in t and 'Class mean' in t)
        await pg.click('[data-ws="reportprep"]'); await pg.wait_for_timeout(700)
        ta = pg.locator('textarea[data-sub]').first; await ta.fill('Excellent progress in fractions'); await ta.dispatch_event('change'); await pg.wait_for_timeout(700)
        print('DRAFT saved:', 'draft' in (await pg.inner_text('#ws-body')).lower() or 'Draft saved' in await pg.inner_text('#ws-body'))
        pre = await pg.evaluate("""async () => { const T = await import('/js/services/teacherService.js'); const TL = await import('/js/services/teacherLogic.js'); const d = await T.loadTeacher(); return TL.readyCommentsFor(d.reportComments, d.examinations[0].id, d.students.find(s=>s.firstName==='Amy').id, d.subjectById).length; }""")
        print('Report card gets draft comment?', pre, '(expected 0)')
        await pg.locator('[data-ready]').first.click(); await pg.wait_for_timeout(900)
        await pg.locator('textarea[data-classcomment]').first.fill('A joy to teach'); await pg.locator('textarea[data-classcomment]').first.dispatch_event('change'); await pg.wait_for_timeout(600)
        model = await pg.evaluate("""async () => { const RC = await import('/js/services/reportCardService.js'); const T = await import('/js/services/teacherService.js'); const d = await T.loadTeacher();
          const m = RC.buildReportModel(await RC.loadReportData(), d.examinations[0].id, d.classes.find(c=>c.name==='Grade 4').id, d.students.find(s=>s.firstName==='Amy').id); return {sub: m.subjectComments, teacher: m.comments.teacher}; }""")
        print('Report card model after ready:', model)
        await pg.click('[data-ws="announce"]'); await pg.wait_for_timeout(600)
        await pg.fill('[data-f=title]','Trip on Friday'); await pg.fill('[data-f=body]','Bring a packed lunch.'); await pg.click('#an-go'); await pg.wait_for_timeout(800)
        t = await pg.inner_text('#ws-body'); print('ANNOUNCEMENT posted & listed:', 'Announcement posted' in t and 'Grade 4' in t)
        await pg.click('[data-ws="lessons"]'); await pg.wait_for_timeout(500); await pg.click('#lp-new'); await pg.wait_for_timeout(400)
        labels = await pg.locator('section label.label').all_inner_texts(); print('LESSON PLAN framework fields:', [l for l in labels if l in ('Strand','Sub-strand','Specific learning outcomes','Core competencies','Values','Key inquiry questions','Assessment')])
        await pg.fill('[data-f=topic]','Fractions'); await pg.fill('textarea[data-f=objectives]','Add fractions'); await pg.fill('[data-x=strand]','Numbers'); await pg.click('#lp-save'); await pg.wait_for_timeout(900)
        print('LESSON saved with strand shown:', 'Strand:' in await pg.inner_text('#ws-body') and 'Numbers' in await pg.inner_text('#ws-body'))
        for k in ['register','marks','homework','elearning','live']:
            loc = pg.locator(f'[data-ws="{k}"]')
            if await loc.count()==0: print(k.upper(),'-> hidden'); continue
            await loc.click(); await pg.wait_for_timeout(700); print(k.upper(),'ok:', len(await pg.inner_text('#ws-body')) > 40)
        print('Welfare hidden without permission:', await pg.locator('[data-ws="welfare"]').count() == 0, '| Set-up hidden for teacher:', await pg.locator('[data-ws="allocation"]').count() == 0)
        await pg.screenshot(path='/tmp/p4_ws.png')
        print('ERR', errs); await b.close()
asyncio.run(main())
