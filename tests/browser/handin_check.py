# Learner homework hand-in in a real browser (demo mode), driven through the screens. Last line should be "ERR []".
import asyncio, base64
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
async def login(pg, user, pw):
    await pg.goto(BASE+'#/login'); await pg.wait_for_timeout(600)
    await pg.fill('#li-email', user); await pg.fill('#li-password', pw); await pg.click('#li-submit'); await pg.wait_for_timeout(1500)
async def main():
    open('/tmp/work.png','wb').write(PNG); open('/tmp/bad.exe','wb').write(b'MZ')
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const R = await import('/js/storage/Repository.js');
          const r = a.register({name:'Head', schoolName:'HI School', email:'head@hi.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@hi.co','secret-pass-1'); sc.saveSchool({name:'HI School', setupComplete:true});
          const g = ac.classRepo.create({name:'Grade 4', order:4}); const m = ac.subjectRepo.create({name:'Maths', classIds:[g.id]});
          const amy = st.studentRepo.create({admissionNumber:'A100',firstName:'Amy',lastName:'Mwangi',classId:g.id,admissionDate:'2026-01-05',status:'active',parentIds:[]});
          const d = (n)=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
          new R.LocalStorageRepository('homework','homework').create({classId:g.id, subjectId:m.id, title:'Fractions practice', instructions:'Do page 4', dueDate:d(3), maxMarks:10, status:'published'});
          a.createFamilyAccount({role:'student', linkedId:amy.id, name:'Amy Mwangi', username:'A100', password:'learner-pass-1'}); a.logout();
        }""")
        await login(pg, 'A100', 'learner-pass-1'); t = await pg.inner_text('body')
        print('1 homework listed with a Hand in button:', 'Fractions practice' in t and 'Not handed in' in t and await pg.locator('[data-handin]').count() == 1)
        await pg.click('[data-handin]'); await pg.wait_for_timeout(300); await pg.click('#hi-save'); await pg.wait_for_timeout(300)
        print('2 empty answer refused:', 'Write your answer' in await pg.inner_text('body'))
        await pg.fill('#hi-text', 'x = 3/4'); await pg.set_input_files('#hi-file', '/tmp/bad.exe'); await pg.click('#hi-save'); await pg.wait_for_timeout(400)
        print('3 bad file type refused, answer text kept:', 'PNG or JPEG' in await pg.inner_text('body'), '|', await pg.input_value('#hi-text'))
        await pg.set_input_files('#hi-file', '/tmp/work.png'); await pg.click('#hi-save'); await pg.wait_for_timeout(700)
        t = await pg.inner_text('body'); print('4 handed in:', 'Handed in. Your teacher can now see it' in t and 'Handed in' in t, '| button now says Change:', 'Change hand-in' in t)
        await pg.click('[data-handin]'); await pg.wait_for_timeout(300); print('5 edit form is pre-filled:', await pg.input_value('#hi-text') == 'x = 3/4', '| shows current file:', 'work.png' in await pg.inner_text('body'))
        await pg.fill('#hi-text', 'x = 3/4 (corrected)'); await pg.click('#hi-save'); await pg.wait_for_timeout(600)
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('6 no sideways scroll:', w <= 392, w)
        before = list(errs)
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }"); await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(700)
        await login(pg, 'head@hi.co', 'secret-pass-1')
        await pg.goto(BASE+'#/academics'); await pg.wait_for_timeout(1200)
        tab = pg.locator('button, .pill', has_text='Homework').first
        if await tab.count():
            await tab.click(); await pg.wait_for_timeout(500); await pg.locator('[data-open]').first.click(); await pg.wait_for_timeout(500)
            t = await pg.inner_text('body'); print('6b teacher sees the answer and file link:', "Learner's answer" in t, '| download link:', await pg.locator('a[download="work.png"]').count() == 1)
            await pg.locator('summary').first.click(); print('6c answer text shown:', 'x = 3/4 (corrected)' in await pg.inner_text('body'))
        else: print('6b Homework tab not found')
        r = await pg.evaluate("""async () => { const R = await import('/js/storage/Repository.js'); const T = await import('/js/services/teacherService.js');
          const hw = new R.LocalStorageRepository('homework','homework').getAll()[0]; const s = new R.LocalStorageRepository('homeworkSubmissions','submission').getAll()[0];
          await T.saveSubmission({ homework: hw, studentId: s.studentId, status: 'marked', marks: 9, feedback: 'Well done' });
          const after = new R.LocalStorageRepository('homeworkSubmissions','submission').getAll()[0];
          return { text: after.text, file: after.attachment?.name, status: after.status, published: after.feedbackPublished ?? false, id: after.id }; }""")
        print('7 teacher marks; answer and file survive:', r['text'] == 'x = 3/4 (corrected)' and r['file'] == 'work.png' and r['status'] == 'marked', '| feedback not yet published:', not r['published'])
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }"); await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(700)
        await login(pg, 'A100', 'learner-pass-1'); t = await pg.inner_text('body'); print('8 learner sees no marks yet, cannot edit:', 'Well done' not in t and await pg.locator('[data-handin]').count() == 0)
        await pg.evaluate("async () => { const R = await import('/js/storage/Repository.js'); const T = await import('/js/services/teacherService.js'); const s = new R.LocalStorageRepository('homeworkSubmissions','submission').getAll()[0]; await T.publishFeedback(s.id, true); }")
        await pg.reload(); await pg.wait_for_timeout(1200); t = await pg.inner_text('body'); print('9 after publishing: marks and feedback visible:', 'Well done' in t and '9' in t and 'Marked' in t)
        print('ERR', before); await b.close()
asyncio.run(main())
