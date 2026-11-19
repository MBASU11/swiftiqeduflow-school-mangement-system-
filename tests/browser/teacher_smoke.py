import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1300,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:300]))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto('http://localhost:8765/index.html'); await pg.wait_for_timeout(1000)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const p = await import('/js/services/platformService.js');
          const s = await import('/js/services/subscriptionService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const pe = await import('/js/services/peopleService.js');
          const at = await import('/js/services/attendanceService.js');
          
          const r = a.register({name:'Head', schoolName:'Teach School', email:'head@t.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:50, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@t.co','secret-pass-1'); sc.saveSchool({name:'Teach School', setupComplete:true});
          await s.adminSetSubscription(r.id,{status:'active',packageId:'professional',billing:'annual',addons:['teacher-pack'],startDate:'2026-10-01',expiryDate:'2027-09-30'},'smoke');
          const c1 = ac.classRepo.create({name:'Grade 4', order:4}), c2 = ac.classRepo.create({name:'Grade 5', order:5});
          const math = ac.subjectRepo.create({name:'Mathematics', classIds:[c1.id,c2.id]});
          ac.termRepo.create({name:'Term 1', isCurrent:true});
          const mk=(n,cl,pid)=>st.studentRepo.create({admissionNumber:n+cl.name,firstName:n,lastName:'K',classId:cl.id,admissionDate:'2026-01-05',status:'active',parentIds:pid});
          const amy = mk('Amy',c1,['p1']); mk('Ben',c1,[]); mk('Zed',c2,[]);
          const t = pe.teacherRepo.create({firstName:'Tina',lastName:'Teach',email:'tina@t.co',category:'teaching'});
          a.createStaffAccount({name:'Tina Teach', email:'tina@t.co', role:'teacher', password:'secret-pass-1'});
          a.createStaffAccount({name:'Tom Teach', email:'tom@t.co', role:'teacher', password:'secret-pass-1'});
          const T = await import('/js/services/teacherService.js');
          await T.allocate(t.id, c1.id, math.id);   // Tina teaches Grade 4 only
          at.attendanceRepo.create({studentId:amy.id, classId:c1.id, date:new Date().toISOString().slice(0,10), status:'absent'});
        }""")
        # --- admin view
        await pg.goto('http://localhost:8765/index.html#/academics'); await pg.reload(); await pg.wait_for_timeout(1500)
        print('ADMIN tabs:', [t for t in await pg.locator('.pill').all_inner_texts() if t in ('My teaching','Lesson plans','Schemes of work','Homework','eLearning','Live lessons','Student welfare','Academic reports','Class allocation')])
        # grant nobody welfare yet; log in as Tina
        await pg.evaluate("""async () => { const a = await import('/js/services/authService.js'); a.logout(); const r = a.login('tina@t.co','secret-pass-1'); }""")
        await pg.goto('http://localhost:8765/index.html#/academics'); await pg.reload(); await pg.wait_for_timeout(1500)
        tabs = await pg.locator('.pill').all_inner_texts(); print('TINA tabs:', [t for t in tabs if t in ('My teaching','Lesson plans','Homework','Student welfare','Class allocation','eLearning','Live lessons')])
        # scoped lists
        out = await pg.evaluate("""async () => {
          const T = await import('/js/services/teacherService.js'); await T.refreshClassScope();
          const d = await T.loadTeacher();
          const sc = await import('/js/services/classScope.js'); const st = await import('/js/services/studentService.js');
          const res = {};
          res.myClasses = d.myClasses.map(c=>c.name); res.myStudents = d.myStudents.map(s=>s.firstName);
          res.scopedStudentsList = sc.scopedStudents(st.studentRepo.getAll()).map(s=>s.firstName);
          // lesson plan: allowed for Grade 4, refused for Grade 5
          const g4 = d.classes.find(c=>c.name==='Grade 4'), g5 = d.classes.find(c=>c.name==='Grade 5'), math = d.subjects[0];
          await T.saveLessonPlan({classId:g4.id, subjectId:math.id, date:'2026-10-20', topic:'Fractions', objectives:'Add fractions', termId:d.currentTerm.id});
          try { await T.saveLessonPlan({classId:g5.id, subjectId:math.id, date:'2026-10-20', topic:'X', objectives:'Y'}); res.g5='ALLOWED(BAD)'; } catch(e){ res.g5 = e.message.slice(0,50); }
          // homework
          const hw = await T.saveHomework({classId:g4.id, subjectId:math.id, title:'Fractions sheet', dueDate:'2026-10-25', maxMarks:20, instructions:'Do 1-10'});
          const amy = d.students.find(s=>s.firstName==='Amy');
          await T.saveSubmission({homework:hw, studentId:amy.id, status:'submitted'});
          try { await T.saveSubmission({homework:hw, studentId:amy.id, status:'marked', marks:25}); res.over='ALLOWED(BAD)'; } catch(e){ res.over = e.message; }
          await T.saveSubmission({homework:hw, studentId:amy.id, status:'marked', marks:18, feedback:'Well done'});
          // welfare: no permission
          res.welfareAccess = T.hasWelfareAccess();
          try { await T.saveWelfare({studentId:amy.id, observation:'x'}); res.welfareWrite='ALLOWED(BAD)'; } catch(e){ res.welfareWrite = e.message.slice(0,45); }
          // absence notices (queued only)
          const made = await T.queueAbsenceNotices(new Date().toISOString().slice(0,10), g4.id);
          res.notices = made.map(m=>[m.queuedStatus, m.noContact]);
          try { await T.queueAbsenceNotices(new Date().toISOString().slice(0,10), g5.id); res.g5notice='ALLOWED(BAD)'; } catch(e){ res.g5notice = e.message.slice(0,40); }
          // live lesson validations
          try { await T.saveLiveLesson({classId:g4.id, subjectId:math.id, title:'Live', date:'2026-10-21', startTime:'09:00', meetingLink:'javascript:alert(1)'}); res.link='ALLOWED(BAD)'; } catch(e){ res.link = e.message.slice(0,40); }
          return res; }""")
        for k,v in out.items(): print(' ', k, '=', v)
        # Welfare grant by admin then Tina can write
        await pg.evaluate("""async () => { const a = await import('/js/services/authService.js'); a.logout(); a.login('head@t.co','secret-pass-1'); }""")
        await pg.reload(); await pg.wait_for_timeout(1200)
        out2 = await pg.evaluate("""async () => {
          const T = await import('/js/services/teacherService.js'); const a = await import('/js/services/authService.js');
          const tina = a.listTeam().find(m=>m.email==='tina@t.co'); await T.setWelfareGrant(tina.id,'Tina',true);
          a.logout(); a.login('tina@t.co','secret-pass-1');
          const d = await T.loadTeacher(); const amy = d.students.find(s=>s.firstName==='Amy'), zed = d.students.find(s=>s.firstName==='Zed');
          const r = {access: T.hasWelfareAccess()};
          await T.saveWelfare({studentId:amy.id, observation:'Quiet this week', category:'behaviour'});
          try { await T.saveWelfare({studentId:zed.id, observation:'x'}); r.otherClass='ALLOWED(BAD)'; } catch(e){ r.otherClass=e.message.slice(0,50); }
          r.notes = (await T.listWelfare()).length;
          // Tom (no grant) cannot see notes
          a.logout(); a.login('tom@t.co','secret-pass-1'); r.tom = [T.hasWelfareAccess(), (await T.listWelfare()).length];
          a.logout(); a.login('tina@t.co','secret-pass-1');
          return r; }""")
        print('WELFARE:', out2)
        await pg.reload(); await pg.wait_for_timeout(1500)
        for t in ['teaching','lessons','schemes','homework','elearning','live','welfare','areports']:
            await pg.goto('http://localhost:8765/index.html#/academics'); await pg.wait_for_timeout(300)
            loc = pg.locator(f'[data-tab="{t}"]')
            if await loc.count()==0: print(t.upper(),'-> (tab hidden)'); continue
            await loc.click(); await pg.wait_for_timeout(700)
            txt=(await pg.inner_text('#academics-body'))[:100].replace('\n',' | ') if await pg.locator('#academics-body').count() else 'no body'
            print(t.upper(),'->',txt)
        await pg.goto('http://localhost:8765/index.html#/attendance'); await pg.wait_for_timeout(700)
        print('ATT tabs:', await pg.locator('.pill').all_inner_texts(), '| class options:', await pg.locator('#class-select option').all_inner_texts())
        print('ERR', errs); await b.close()
asyncio.run(main())
