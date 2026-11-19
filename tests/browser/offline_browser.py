import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width':390,'height':800}, service_workers='allow')
        pg = await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:250]))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1500)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const pe = await import('/js/services/peopleService.js');
          const as = await import('/js/services/assessmentService.js'); const T = await import('/js/services/teacherService.js');
          const r = a.register({name:'Head', schoolName:'Off School', email:'head@o.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:20, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@o.co','secret-pass-1'); sc.saveSchool({name:'Off School', setupComplete:true});
          const g4 = ac.classRepo.create({name:'Grade 4', order:4}), g5 = ac.classRepo.create({name:'Grade 5', order:5}); ac.termRepo.create({name:'Term 1', isCurrent:true});
          ['Amy','Ben','Cy'].forEach((n,i)=>st.studentRepo.create({admissionNumber:'O'+i,firstName:n,lastName:'K',classId:g4.id,admissionDate:'2026-01-05',status:'active',parentIds:[]}));
          st.studentRepo.create({admissionNumber:'Z1',firstName:'Zed',lastName:'K',classId:g5.id,admissionDate:'2026-01-05',status:'active',parentIds:[]});
          as.assessmentRepo.create({name:'CAT 1', classId:g4.id, maxScore:50, date:'2026-02-01'});
          const t = pe.teacherRepo.create({firstName:'Tina',lastName:'T',email:'tina@o.co',category:'teaching'});
          a.createStaffAccount({name:'Tina T', email:'tina@o.co', role:'teacher', password:'secret-pass-1'});
          await T.allocate(t.id, g4.id, '');
          a.logout(); a.login('tina@o.co','secret-pass-1'); }""")
        await pg.reload(); await pg.wait_for_timeout(2500)
        sw = await pg.evaluate("""async () => { const reg = await navigator.serviceWorker.ready; const keys = await caches.keys(); const c = await caches.open(keys[0]); return {active: !!reg.active, caches: keys, cached: (await c.keys()).length}; }""")
        print('SERVICE WORKER:', sw)
        await pg.goto(BASE+'#/attendance'); await pg.wait_for_timeout(800)
        await pg.click('#tab-mobile'); await pg.wait_for_timeout(800)
        print('CLASS OPTIONS (teacher scope):', await pg.locator('#rg-class option').all_inner_texts())
        # ---- go offline and mark
        await ctx.set_offline(True); await pg.wait_for_timeout(300)
        amy = pg.locator('[data-stu]').nth(0); ben = pg.locator('[data-stu]').nth(1)
        await amy.locator('[data-set=absent]').click(); await pg.wait_for_timeout(300)
        await pg.locator('[data-stu]').nth(1).locator('[data-set=present]').click(); await pg.wait_for_timeout(500)
        t = await pg.inner_text('#reg-sync'); print('OFFLINE PANEL:', t[:140].replace('\n',' | '))
        n = await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); return StorageManager.all('attendance').length; }""")
        print('Attendance records in school data while offline:', n, '(expected 0: nothing claimed synced)')
        print('Row badge:', (await pg.locator('[data-stu]').nth(0).inner_text()).replace('\n',' | ')[:80])
        # ---- refresh while OFFLINE: app must still open, marks must still be there
        await pg.reload(); await pg.wait_for_timeout(2500)
        print('OFFLINE RELOAD app loaded:', await pg.locator('#sidebar-nav, .bottom-nav, #app').count() > 0, '| title:', await pg.title())
        await pg.goto(BASE+'#/attendance'); await pg.wait_for_timeout(800); await pg.click('#tab-mobile'); await pg.wait_for_timeout(1000)
        print('AFTER OFFLINE RELOAD pending badges:', await pg.locator('text=Waiting to sync').count(), '| Amy absent pressed:', await pg.locator('[data-stu]').nth(0).locator('[data-set=absent]').get_attribute('aria-pressed'))
        # ---- back online
        await ctx.set_offline(False); await pg.evaluate("window.dispatchEvent(new Event('online'))"); await pg.wait_for_timeout(2500)
        n = await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); return StorageManager.all('attendance').map(r=>[r.status, r.version]); }""")
        print('ONLINE: attendance records:', n, '| "Synchronized" badges:', await pg.locator('[data-stu] >> text=Synchronized').count())
        # ---- conflict: another device changes Amy while this phone is offline
        await ctx.set_offline(True)
        await pg.locator('[data-stu]').nth(0).locator('[data-set=late]').click(); await pg.wait_for_timeout(400)
        await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); const r = StorageManager.all('attendance').find(x=>x.status==='absent'); StorageManager.update('attendance', r.id, {status:'present', version:(r.version??1)+1, updatedBy:'Other phone'}); }""")
        await ctx.set_offline(False); await pg.evaluate("window.dispatchEvent(new Event('online'))"); await pg.wait_for_timeout(2500)
        panel = await pg.inner_text('#reg-sync'); print('CONFLICT shown:', 'Conflict' in panel, '| mentions other device:', 'Other phone' in panel)
        rec = await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); return StorageManager.all('attendance').filter(x=>x.status!=='x').map(r=>[r.status,r.version]); }""")
        print('Server record untouched by conflicting phone:', rec)
        await pg.click('[data-keep]'); await pg.wait_for_timeout(2500)
        rec = await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); return StorageManager.all('attendance').map(r=>[r.status,r.version]); }""")
        print('After "Keep mine":', rec)
        await pg.screenshot(path='/tmp/offline_register.png')
        # ---- marks
        await pg.goto(BASE+'#/assessments'.replace('assessments','exams')); await pg.wait_for_timeout(800)
        await pg.click('#tab-mobile'); await pg.wait_for_timeout(600)
        await pg.select_option('#mk-target', index=1); await pg.wait_for_timeout(600)
        inp = pg.locator('[data-mark]'); await inp.nth(0).fill('60'); await pg.wait_for_timeout(500)
        print('INVALID 60/50:', (await pg.locator('.field-error').first.inner_text()), '| submit:', (await pg.locator('#mk-submit').inner_text()), '| disabled:', await pg.locator('#mk-submit').is_disabled())
        await inp.nth(0).fill('42'); await inp.nth(1).fill('abc'); await pg.wait_for_timeout(600)
        await inp.nth(1).fill('35'); await pg.wait_for_timeout(700)
        await pg.reload(); await pg.wait_for_timeout(1800)
        await pg.goto(BASE+'#/exams'); await pg.wait_for_timeout(600); await pg.click('#tab-mobile'); await pg.wait_for_timeout(600); await pg.select_option('#mk-target', index=1); await pg.wait_for_timeout(900)
        print('DRAFT restored after reload:', await pg.locator('text=Restored your unsubmitted marks').count(), '| values:', await pg.eval_on_selector_all('[data-mark]','els=>els.map(e=>e.value)'))
        await ctx.set_offline(True); await pg.click('#mk-submit'); await pg.wait_for_timeout(800)
        print('OFFLINE SUBMIT flash:', (await pg.locator('.notice[role=status]').first.inner_text())[:80], '| badges waiting:', await pg.locator('text=Waiting to sync').count())
        s = await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); return StorageManager.all('assessmentScores').length; }""")
        print('Scores in school data while offline:', s)
        await ctx.set_offline(False); await pg.evaluate("window.dispatchEvent(new Event('online'))"); await pg.wait_for_timeout(2500)
        s = await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); return StorageManager.all('assessmentScores').map(r=>[r.score, r.version]); }""")
        print('ONLINE: scores:', s)
        dbg = await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); const O = await import('/js/offline/offlineService.js');
          const names = Object.fromEntries(StorageManager.all('students').map(s=>[s.id,s.firstName]));
          return { scores: StorageManager.all('assessmentScores').map(r=>[names[r.studentId], r.score, r.version, r.lastOpId?.slice(0,6)]),
                   ops: (await O.getEngine().list()).filter(o=>o.kind==='assessmentScore').map(o=>[names[o.payload.studentId], o.payload.score, o.status, o.opId.slice(0,6), o.baseVersion]) }; }""")
        print('DEBUG', dbg)
        print('ERR', errs); await b.close()
asyncio.run(main())
