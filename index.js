// ── Keep-alive HTTP server (Render.com requer porta aberta) ─────────────────
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(PORT);
// ─────────────────────────────────────────────────────────────────────────────
