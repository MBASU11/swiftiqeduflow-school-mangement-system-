import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1300,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:300]))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('Payment confirmed on bank statement')))
        await pg.goto('http://localhost:8765/index.html#/'); await pg.wait_for_timeout(1500)
        # 1. landing pricing
        cards = await pg.locator('[data-plan-card]').all_inner_texts()
        print('LANDING cards:', len(cards))
        for c in cards: print('  ', c.replace('\n',' | ')[:150])
        html = await pg.content()
        print('old plans gone:', not any(x in html for x in ['Bronze','Silver','onboarding','Private Primary']))
        # 2. signup with Starter, termly
        await pg.goto('http://localhost:8765/index.html#/signup?plan=starter'); await pg.wait_for_timeout(700)
        print('SIGNUP selected:', await pg.eval_on_selector('#su-plan','e=>e.value'), '| billing options:', await pg.locator('[name=su-billing]').count())
        await pg.check('[name=su-billing][value=termly]'); await pg.wait_for_timeout(300)
        print('SUMMARY:', (await pg.inner_text('.plan-summary'))[:120])
        await pg.fill('#su-name','Pat Head'); await pg.fill('#su-school','Hill Academy'); await pg.fill('#su-email','pat@hill.co'); await pg.fill('#su-phone','0700123456'); await pg.fill('#su-students','150')
        await pg.fill('#su-password','secret-pass-1'); await pg.fill('#su-confirm','secret-pass-1'); await pg.check('#su-terms') if await pg.locator('#su-terms').count() else None
        await pg.click('#su-submit') if await pg.locator('#su-submit').count() else None
        await pg.wait_for_timeout(1200)
        print('AFTER SIGNUP:', (await pg.inner_text('body'))[:100].replace('\n',' | '))
        # 3. super admin
        await pg.evaluate("""async () => { const a = await import('/js/services/authService.js'); a.logout(); const m = await import('/js/services/platformService.js'); m.registerAdmin({name:'Tester',email:'t@t.co',password:'a-long-passphrase-1',confirmPassword:'a-long-passphrase-1'}); m.adminLogin('t@t.co','a-long-passphrase-1'); }""")
        await pg.goto('http://localhost:8765/index.html#/'); await pg.reload(); await pg.wait_for_timeout(1500)
        # change the Starter termly price on the simple Packages screen
        await pg.locator('.pill', has_text='Packages').first.click(); await pg.wait_for_timeout(500)
        await pg.fill('#sp-termly-starter','4500'); await pg.click('#sp-save'); await pg.wait_for_timeout(800)
        # back to Schools tab (first nav)
        await pg.click('.pill >> nth=0'); await pg.wait_for_timeout(600)
        print('ADMIN tabs:', await pg.locator('.pill').all_inner_texts())
        print('ROW:', (await pg.inner_text('body'))[:400].replace('\n',' | ')); await pg.locator('tr', has_text='Hill Academy').locator('button').first.click(); await pg.wait_for_timeout(900)
        txt = await pg.inner_text('body'); i = txt.find('Package & students'); print('SCHOOL PKG CARD:', txt[i:i+330].replace('\n',' | '))
        # create invoice
        await pg.click('#new-invoice-btn'); await pg.wait_for_timeout(400)
        print('INVOICE lines:', await pg.eval_on_selector_all('[data-item-desc]','els=>els.map(e=>e.value)'), await pg.eval_on_selector_all('[data-item-amount]','els=>els.map(e=>e.value)'))
        await pg.select_option('#add-charge', index=1); await pg.wait_for_timeout(300)
        print('  + charge ->', await pg.eval_on_selector_all('[data-item-desc]','els=>els.map(e=>e.value)'))
        await pg.fill('[data-item-amount]:last-of-type','1500') if False else None
        await pg.click('#save-invoice-btn'); await pg.wait_for_timeout(900)
        print('INVOICE page:', (await pg.inner_text('body'))[:160].replace('\n',' | '))

        # --- activate / suspend / resume from the school screen
        await pg.click('text=← Back to school'); await pg.wait_for_timeout(700)
        async def sub_state():
            t = await pg.inner_text('body'); i = t.find('Subscription:'); return t[i:i+90].replace('\n',' | ')
        print('BEFORE:', await sub_state())
        await pg.click('#approve-btn'); await pg.wait_for_timeout(600)
        await pg.locator('summary', has_text='Manual overrides').click(); await pg.click('#sub-activate'); await pg.wait_for_timeout(900)
        print('AFTER ACTIVATE:', await sub_state())
        await pg.locator('summary', has_text='Manual overrides').click(); await pg.click('#sub-suspend'); await pg.wait_for_timeout(900)
        print('AFTER SUSPEND:', await sub_state())
        await pg.locator('summary', has_text='Manual overrides').click(); await pg.click('#sub-resume'); await pg.wait_for_timeout(900)
        print('AFTER RESUME:', await sub_state())
        await pg.locator('summary', has_text='Manual overrides').click(); await pg.click('#sub-suspend'); await pg.wait_for_timeout(900)
        # school side while subscription suspended
        res = await pg.evaluate("""async () => {
          const m = await import('/js/services/platformService.js'); m.adminLogout();
          const a = await import('/js/services/authService.js'); const r = a.login('pat@hill.co','secret-pass-1');
          const s = await import('/js/services/subscriptionService.js'); const sc = await import('/js/services/schoolService.js'); sc.saveSchool({name:'Hill', setupComplete:true});
          return {login: r.ok ?? r, financeOn: s.moduleEnabled('finance'), studentsOn: s.moduleEnabled('students'), status: s.currentSubscription()?.status, pkg: s.currentSubscription()?.packageId, expiry: s.currentSubscription()?.expiryDate};
        }""")
        print('SCHOOL (suspended):', res)
        audit = await pg.evaluate("""async () => { const s = await import('/js/services/subscriptionService.js'); return (await s.listAudit()).map(a=>a.action+' :: '+a.reason).slice(0,6); }""")
        print('AUDIT:', audit)
        await b.close(); print('ERR', errs)
asyncio.run(main())
