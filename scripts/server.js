const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const PROJECT_DIR = path.resolve(__dirname, '..');

const server = http.createServer((req, res) => {
  // Set CORS headers so the extension background script can reach this server
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { filename, html } = payload;

        if (!filename || !html) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing filename or html parameter' }));
          return;
        }

        // Sanitize the filename to prevent directory traversal
        const safeFilename = path.basename(filename);
        const savePath = path.join(PROJECT_DIR, safeFilename);

        fs.writeFileSync(savePath, html, 'utf8');
        console.log(`[FormAI Server] Saved: ${safeFilename} -> ${savePath}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: savePath }));
      } catch (err) {
        console.error('[FormAI Server] Save error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to process request: ' + err.message }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, 'localhost', () => {
  console.log(`[FormAI Server] Running on http://localhost:${PORT}`);
  console.log(`[FormAI Server] Target project directory: ${PROJECT_DIR}`);
});
