import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1200,'height':800})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)+' @ '+(e.stack or '')[:200]))
        await pg.goto('http://localhost:8765/index.html#/'); await pg.wait_for_timeout(1200)
        print('DEMO BANNER:', (await pg.inner_text('#demo-mode-banner'))[:60])
        await pg.goto('http://localhost:8765/index.html#/login'); await pg.wait_for_timeout(500)
        print('LOGIN forgot text:', 'Forgot your password' in await pg.inner_text('body'))
        await pg.goto('http://localhost:8765/index.html#/forgot'); await pg.wait_for_timeout(500)
        print('FORGOT (demo):', (await pg.inner_text('body'))[:110].replace('\n',' | '))
        # old default admin no longer works; first-run admin setup is shown
        await pg.goto('http://localhost:8765/index.html#/admin'); await pg.wait_for_timeout(600)
        t = await pg.inner_text('body'); print('ADMIN first-run setup shown:', 'Create' in t or 'set up' in t.lower() or 'administrator' in t.lower(), '|', t[:90].replace('\n',' | '))
        r = await pg.evaluate("""async () => { const m = await import('/js/services/platformService.js'); return {exists: m.adminExists(), old: m.adminLogin('swiftiqenterprise@gmail.com','12345').ok}; }""")
        print('DEFAULT ADMIN:', r)
        # school session expiry in the browser
        await pg.evaluate("""async () => {
          const a = await import('/js/services/authService.js'); const sc = await import('/js/services/schoolService.js');
          const r = a.register({name:'H', schoolName:'Exp School', email:'exp@x.co', password:'secret-pass-1', confirmPassword:'secret-pass-1', planId:'micro', billing:'annual', studentCount:20, acceptedTerms:true});
          a.updateAccount(r.id,{status:'approved'}); a.logout(); a.login('exp@x.co','secret-pass-1'); sc.saveSchool({name:'Exp', setupComplete:true}); }""")
        await pg.reload(); await pg.wait_for_timeout(1200)
        print('LOGGED IN shows app nav:', await pg.locator('#sidebar-nav').count() > 0)
        await pg.evaluate("""async () => { const {StorageManager} = await import('/js/storage/StorageManager.js'); const s = StorageManager.getGlobal('session'); StorageManager.setGlobal('session', {...s, lastActive: Date.now() - 61*60*1000}); }""")
        await pg.reload(); await pg.wait_for_timeout(1200)
        print('AFTER 61 MIN IDLE shows app nav:', await pg.locator('#sidebar-nav').count() > 0, '| back to public site:', 'Log in' in await pg.inner_text('body'))
        print('ERR', errs); await b.close()
asyncio.run(main())
