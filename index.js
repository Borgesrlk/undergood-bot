

// ── Keep-alive HTTP server (necessario para Render.com) ─────────────────────
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Undergood Bot Online');
}).listen(PORT, () => console.log('[HTTP] Keep-alive server na porta ' + PORT));