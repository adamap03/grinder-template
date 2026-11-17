// The first-run page (served by setup.server.ts until Notion is connected). Plain HTML so it works before the app can.
export const SETUP_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Set up Grinder</title>
<style>
  :root { --bg: oklch(0.985 0.012 85); --fg: oklch(0.26 0.01 60); --muted: oklch(0.5 0.015 60); --line: oklch(0.88 0.02 70 / 0.7); --primary: oklch(0.32 0.012 60); --bad: oklch(0.55 0.2 25); --good: oklch(0.5 0.13 150); }
  @media (prefers-color-scheme: dark) { :root { --bg: oklch(0.2 0.01 60); --fg: oklch(0.94 0.01 85); --muted: oklch(0.72 0.015 70); --line: oklch(0.4 0.02 70 / 0.7); --primary: oklch(0.9 0.012 85); } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 48px 16px 64px; }
  h1 { font-size: 28px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 0 0 6px; }
  p, li { color: var(--muted); } a { color: inherit; }
  ol { padding-left: 20px; } li { margin: 4px 0; } b { color: var(--fg); }
  section { border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; margin-top: 16px; }
  label { display: block; margin-top: 12px; font-weight: 600; font-size: 13px; }
  label span { font-weight: 400; color: var(--muted); }
  input { width: 100%; margin-top: 4px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
  button { margin-top: 16px; padding: 9px 16px; border: 0; border-radius: 8px; background: var(--primary); color: var(--bg); font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  code { font-size: 13px; background: var(--line); padding: 1px 5px; border-radius: 4px; }
  #msg { margin-top: 12px; min-height: 1.5em; } .bad { color: var(--bad); } .good { color: var(--good); }
</style></head>
<body><main>
  <h1>Set up Grinder</h1>
  <p>Grinder keeps all your data in your own Notion workspace. Connect it once (about 3 minutes); nothing works until this is done.</p>

  <section><h2>1. Create a Notion integration</h2><ol>
    <li>Open <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">notion.so/profile/integrations</a> and choose <b>New integration</b>.</li>
    <li>Name it <b>Grinder</b>, pick your workspace, type <b>Internal</b>, and save.</li>
    <li>Copy the <b>Internal Integration Secret</b> (it starts with <code>ntn_</code>).</li>
  </ol></section>

  <section><h2>2. Give it a page</h2><ol>
    <li>In Notion, create an empty page, for example <b>Grinder</b>. Grinder puts its tables there.</li>
    <li>On that page open the <b>•••</b> menu (top right), choose <b>Connections</b> and add <b>Grinder</b>.</li>
    <li>Copy the page link: <b>Share</b>, then <b>Copy link</b>.</li>
  </ol></section>

  <section><h2>3. Connect</h2>
    <p>The setup code is in the server log (it appears once this page has been opened): in Docker Desktop open the container's <b>Logs</b>, or run
      <code>docker compose -f napi.compose.yml logs app</code>. A new code is made each time the server restarts.</p>
    <form id="f">
      <label for="code">Setup code</label><input id="code" required autocomplete="off" maxlength="8">
      <label for="token">Notion integration secret</label><input id="token" type="password" required autocomplete="off" placeholder="ntn_…">
      <label for="page">Notion page link</label><input id="page" required autocomplete="off" placeholder="https://www.notion.so/…">
      <label for="anthropic">Claude API key <span>(optional, for the AI features; from console.anthropic.com)</span></label>
      <input id="anthropic" type="password" autocomplete="off" placeholder="sk-ant-…">
      <button id="go">Connect</button>
      <p id="msg" role="status" aria-live="polite"></p>
    </form>
  </section>
</main>
<script>
  const f = document.getElementById('f'), msg = document.getElementById('msg'), go = document.getElementById('go');
  const say = (t, cls) => { msg.textContent = t; msg.className = cls || ''; };
  const val = (id) => document.getElementById(id).value;
  async function wait() {
    const s = await fetch('/api/setup').then((r) => r.json()).catch(() => ({}));
    if (s.error) return say('Connected, but the tables could not be created: ' + s.error, 'bad');
    if (s.ready) { say('Done. Opening Grinder: create your account there (the first account is the admin).', 'good'); setTimeout(() => location.assign('/'), 2000); return; }
    setTimeout(wait, 3000);
  }
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); go.disabled = true; say('Checking…');
    const r = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: val('code'), token: val('token'), page: val('page'), anthropic: val('anthropic') }) })
      .then((r) => r.json()).catch(() => ({ error: 'The server did not answer. Is it still running?' }));
    if (!r.ok) { go.disabled = false; return say(r.error || 'Something went wrong.', 'bad'); }
    say('Connected. Creating your tables in Notion, about a minute…'); wait();
  });
</script>
</body></html>`;
