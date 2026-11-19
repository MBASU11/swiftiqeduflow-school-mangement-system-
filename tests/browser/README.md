# Browser tests (Playwright, Chromium)

These click through the real screens in a real browser, in demo mode. They are separate from the Node tests
(`node tests/run-all.mjs`) because they need a browser.

```
pip install playwright && playwright install chromium
cd swiftiq-vanilla && python3 -m http.server 8765 &      # serve the app
python3 tests/browser/phase4_browser.py                   # each script prints results; the last line is "ERR []" when no page errors occurred
```
Scripts: `phase1_browser` (demo banner, no default admin, session expiry) · `pkg_flow` (landing prices, sign-up, Super Admin invoice/activate/suspend) · `teacher_smoke` (Teacher Pack as a real teacher) · `bursar_ui` and `phase3_browser` (Bursar Pack) · `offline_browser` (offline attendance/marks, restart, conflict) · `phase4_browser` and `p4_regress` (teacher workspace).
They are checks to read, not pass/fail assertions: read the printed lines against the expectation shown in each label.
They run against `http://localhost:8765/index.html` and create their own throw-away data in that browser profile.
