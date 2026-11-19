# The simplified Super Admin: Packages screen, school package card, one-click change. Phone-sized. Last line should be "ERR []".
import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE+'#/'); await pg.wait_for_timeout(800)
        await pg.evaluate("""async () => { const a = await import('/js/services/authService.js'); const m = await import('/js/services/platformService.js'); const AU = await import('/js/services/platformAutomation.js');
          const r = a.register({name:'Pat', schoolName:'Hill Academy', email:'p@h.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'starter', billing:'annual', studentCount:100}); a.logout();
          m.registerAdmin({name:'Super', email:'s@t.co', password:'a-long-passphrase-1', confirmPassword:'a-long-passphrase-1'}); AU.approveAndAllocate(r.id, 'Super'); }""")
        await pg.goto(BASE+'#/admin'); await pg.reload(); await pg.wait_for_timeout(1500)
        await pg.locator('.pill', has_text='Packages').first.click(); await pg.wait_for_timeout(800); t = await pg.inner_text('body')
        print('1 Packages opens the simple view: one explanation, no module or feature switches:', 'This runs by itself' in t and 'Student limit' in t and await pg.locator('[data-cat-bool]').count() == 0 and await pg.locator('[data-cat-tab]').count() == 0)
        print('2 each package shows included / not included in plain words:', 'Included:' in t and 'Not included:' in t and 'school on this package' in t)
        await pg.fill('#sp-annual-starter', '9000'); await pg.fill('#sp-annual-micro', '9500'); await pg.click('#sp-save'); await pg.wait_for_timeout(500); t = await pg.inner_text('body')
        print('3 a price that puts Starter below Micro is refused with a clear message:', 'Starter costs less than Micro' in t)
        await pg.fill('#sp-annual-micro', '6000'); await pg.fill('#sp-annual-starter', '11000'); await pg.fill('#sp-lim-starter', '320'); await pg.click('#sp-save'); await pg.wait_for_timeout(800); t = await pg.inner_text('body')
        print('4 valid change saved:', 'Saved.' in t and await pg.input_value('#sp-annual-starter') == '11000' and await pg.input_value('#sp-lim-starter') == '320')
        w = await pg.evaluate("document.documentElement.scrollWidth"); print('5 no sideways scroll:', w <= 392, w)
        await pg.click('#sp-adv'); await pg.wait_for_timeout(700); t = await pg.inner_text('body'); print('6 advanced editor is one tap away, with a way back:', 'advanced settings' in t.lower() and await pg.locator('[data-cc-tab]').count() >= 3 and await pg.locator('#cc-simple').count() == 1)
        await pg.click('#cc-simple'); await pg.wait_for_timeout(500)
        await pg.locator('.pill', has_text='Schools').first.click(); await pg.wait_for_timeout(800); await pg.click('[data-open]') if await pg.locator('[data-open]').count() else await pg.locator('[data-open-school], table button').first.click(); await pg.wait_for_timeout(900); t = await pg.inner_text('body')
        print('7 school card: package, students of limit, subscription state, how it works:', 'Package & students' in t and 'of 320' in t and 'Trial' in t and 'Moving up applies now' in t)
        print('8 old manual controls are folded away:', 'Manual overrides (rarely needed)' in t and not await pg.locator('#sub-activate').is_visible())
        await pg.select_option('#sd-change-pkg', 'professional'); await pg.click('#sd-change-apply'); await pg.wait_for_timeout(900); t = await pg.inner_text('body')
        print('9 one click change before payment: invoice reissued:', 'Professional' in t and 'New invoice' in t and 'cancelled' in t)
        sub = await pg.evaluate("async () => { const s = await import('/js/services/subscriptionService.js'); const a = await import('/js/services/authService.js'); const x = s.localSubscriptionOf(a.listAccounts()[0].id); return [x.packageId, x.status]; }"); print('10 stored:', sub)
        print('ERR', errs); await b.close()
asyncio.run(main())
