# School health in a real browser (demo mode), signed in as the school nurse. Last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def login(pg, user, pw):
    await pg.goto(BASE+'#/login'); await pg.wait_for_timeout(600)
    await pg.fill('#li-email', user); await pg.fill('#li-password', pw); await pg.click('#li-submit'); await pg.wait_for_timeout(1500)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('Child was asleep') if d.type=='prompt' else d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js'); const se = await import('/js/services/settingsService.js');
          const ac = await import('/js/services/academicService.js'); const st = await import('/js/services/studentService.js');
          const r = a.register({name:'Head', schoolName:'HL School', email:'head@hl.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual'});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('head@hl.co','secret-pass-1'); sc.saveSchool({name:'HL School', setupComplete:true}); se.updateModuleToggles({health:true});
          const g = ac.classRepo.create({name:'Grade 4', order:4});
          ['Amy','Ben'].forEach((n,i)=>st.studentRepo.create({admissionNumber:'H'+i,firstName:n,lastName:'Mwangi',classId:g.id,admissionDate:'2026-01-05',status:'active',parentIds:[]}));
          const n = a.createStaffAccount({name:'Nancy Nurse', email:'nurse@hl.co', role:'nurse', password:'nurse-pass-1'}); if (!n.ok) throw new Error(JSON.stringify(n));
          a.createStaffAccount({name:'Tea Cher', email:'t@hl.co', role:'teacher', password:'teach-pass-1'}); a.logout();
        }""")
        await login(pg, 'nurse@hl.co', 'nurse-pass-1'); await pg.goto(BASE+'#/health'); await pg.wait_for_timeout(1200); t = await pg.inner_text('body')
        print('1 nurse opens Health; confidentiality notice:', 'Confidential' in t, '| incomplete records flagged:', '2 of 2 learners have an incomplete' in t)
        await pg.click('[data-tab=learners]'); await pg.fill('#search', 'amy'); await pg.wait_for_timeout(300); t = await pg.inner_text('body'); print('2 search finds Amy only:', 'Amy Mwangi' in t and 'Ben Mwangi' not in t)
        await pg.click('[data-open]'); await pg.wait_for_timeout(400); await pg.click('#p-edit'); await pg.wait_for_timeout(300)
        await pg.select_option('#p-astat', 'listed'); await pg.wait_for_timeout(300); await pg.fill('[data-a-sub="0"]', 'Penicillin'); await pg.select_option('[data-a-sev="0"]', 'life_threatening'); await pg.fill('[data-a-rea="0"]', 'Anaphylaxis')
        await pg.fill('#p-cond', 'Asthma'); await pg.fill('#p-en', 'Pat Mwangi'); await pg.fill('#p-ep', 'abc'); await pg.check('#p-consent'); await pg.click('#p-save'); await pg.wait_for_timeout(400)
        t = await pg.inner_text('body'); print('3 bad phone refused, typed values kept:', 'phone number does not look right' in t, '|', await pg.input_value('[data-a-sub="0"]'))
        await pg.fill('#p-ep', '0700 111 222'); await pg.click('#p-save'); await pg.wait_for_timeout(500); t = await pg.inner_text('body')
        print('4 saved; severe allergy banner:', 'Severe allergy:' in t and 'Penicillin' in t, '| access logged:', 'Recently opened by: Nancy Nurse' in t)
        await pg.click('[data-sub=visits]'); await pg.click('#new-visit'); await pg.wait_for_timeout(300)
        await pg.fill('#v-complaint', 'Fever'); await pg.fill('#v-med', 'Amoxicillin'); await pg.fill('#v-dose', '250mg'); await pg.click('#v-save'); await pg.wait_for_timeout(400); t = await pg.inner_text('body')
        print('5 related antibiotic blocked, confirm box offered:', 'related to Penicillin' in t and await pg.locator('#v-allergy').count() == 1)
        await pg.fill('#v-med', 'Paracetamol'); await pg.fill('#v-dose', '500mg'); await pg.click('#v-save'); await pg.wait_for_timeout(500); t = await pg.inner_text('body'); print('6 safe medicine recorded:', 'Visit recorded' in t and 'Fever' in t and 'gave Paracetamol 500mg' in t)
        await pg.click('[data-sub=meds]'); await pg.click('#new-med'); await pg.fill('#m-name', 'Salbutamol inhaler'); await pg.fill('#m-dose', '2 puffs'); await pg.fill('#m-times', '00:01'); await pg.click('#m-save'); await pg.wait_for_timeout(400)
        print('7 medicine without authorisation refused:', 'authorised it' in await pg.inner_text('body'))
        await pg.fill('#m-auth', 'Mum (phone consent)'); await pg.click('#m-save'); await pg.wait_for_timeout(400); print('8 standing medication added:', 'Medication added' in await pg.inner_text('body'))
        await pg.click('[data-sub=vax]'); await pg.click('#new-vax'); await pg.select_option('#i-vac', 'HPV'); await pg.fill('#i-date', '2025-01-01'); await pg.fill('#i-next', '2025-07-01'); await pg.click('#i-save'); await pg.wait_for_timeout(400)
        print('9 immunisation recorded and flagged overdue:', 'OVERDUE' in await pg.inner_text('body'))
        await pg.click('[data-tab=today]'); await pg.wait_for_timeout(500); t = await pg.inner_text('body')
        print('10 today: severe allergy listed, dose overdue, 1 visit:', 'Severe allergies (1)' in t and 'OVERDUE' in t and 'Fever' in t)
        await pg.click('[data-give]'); await pg.wait_for_timeout(400); print('11 dose given:', '✓ given' in await pg.inner_text('body'))
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('12 no sideways scroll:', w <= 392, w)
        before = list(errs)
        await pg.evaluate("async () => { const a = await import('/js/services/authService.js'); a.logout(); }"); await pg.goto(BASE+'#/'); await pg.reload(); await pg.wait_for_timeout(700)
        await login(pg, 't@hl.co', 'teach-pass-1'); await pg.goto(BASE+'#/health'); await pg.wait_for_timeout(1200); t = await pg.inner_text('body')
        print('13 teacher sees nothing of Health:', 'Penicillin' not in t and 'Severe allergies' not in t and 'Confidential' not in t)
        print('ERR', before); await b.close()
asyncio.run(main())
