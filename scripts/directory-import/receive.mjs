// One-off local receiver: GET / serves a page that posts the tab's window.name (the firms JSON) back here; saved to
// fae/part-0.json, then the server exits.
import http from 'node:http';
import fs from 'node:fs';
const page = `<!doctype html><meta charset="utf-8"><title>import</title><p id="s">Saving…</p><script>
fetch('/save', { method: 'POST', body: window.name }).then((r) => r.text()).then((t) => { document.getElementById('s').textContent = t; window.name = ''; });
</script>`;
http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return; }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
  req.on('end', () => {
    try { const data = JSON.parse(body); fs.writeFileSync('fae/part-0.json', JSON.stringify(data)); res.end(`saved ${data.length}`); console.log(`saved ${data.length}`); setTimeout(() => process.exit(0), 300); }
    catch (e) { res.writeHead(400); res.end(String(e)); }
  });
}).listen(8798, '127.0.0.1', () => console.log('listening 8798'));
setTimeout(() => process.exit(1), 20 * 60 * 1000);
