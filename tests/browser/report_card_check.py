import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1200,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:250]))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(1000)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js'); const ex = await import('/js/services/examService.js');
          const r = a.register({name:'Head', schoolName:'RC School', email:'head@rc.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:20, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@rc.co','secret-pass-1'); sc.saveSchool({name:'RC School', setupComplete:true});
          const g4 = ac.classRepo.create({name:'Grade 4', order:4}); const term = ac.termRepo.create({name:'Term 1', isCurrent:true});
          const math = ac.subjectRepo.create({name:'Maths', classIds:[g4.id]}), eng = ac.subjectRepo.create({name:'English', classIds:[g4.id]});
          const mk=(n,i)=>st.studentRepo.create({admissionNumber:'R'+i,firstName:n,lastName:'K',classId:g4.id,admissionDate:'2026-01-05',status:'active',parentIds:[]});
          const s1=mk('Amy',1), s2=mk('Ben',2), s3=mk('Cy',3);
          const e = ex.examinationRepo.create({name:'End Term 1', termId:term.id, classIds:[g4.id], startDate:'2026-03-01', endDate:'2026-03-10'});
          [[s1,90,70],[s2,60,60],[s3,60,null]].forEach(([s,m,en])=>{ ex.examScoreRepo.create({examinationId:e.id, subjectId:math.id, studentId:s.id, score:m}); if(en!==null) ex.examScoreRepo.create({examinationId:e.id, subjectId:eng.id, studentId:s.id, score:en}); });
        }""")
        await pg.goto(BASE+'#/exams'); await pg.reload(); await pg.wait_for_timeout(1500)
        await pg.click('#tab-exams'); await pg.wait_for_timeout(600)
        tabs = await pg.locator('.pill').all_inner_texts(); print('TABS:', [t for t in tabs][:10])
        rc = pg.locator('.pill', has_text='Report cards')
        if await rc.count(): await rc.first.click(); await pg.wait_for_timeout(1000)
        print('SELECTS:', await pg.eval_on_selector_all('select', 'els=>els.map(e=>e.id+":"+e.options.length)'))
        await pg.wait_for_timeout(800)
        txt = await pg.inner_text('body'); print('REPORT CARDS screen text has results:', any(k in txt for k in ['Amy','Maths','Position','Average']), '| contains NaN:', 'NaN' in txt)
        print('SAMPLE:', [l for l in txt.split(chr(10)) if any(k in l for k in ['Amy','Ben','Cy','Maths','English'])][:8]); print('ERR', errs); await b.close()
asyncio.run(main())
