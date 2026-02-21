const http = require('http');
const { spawn } = require('child_process');

const PORT = 3456;
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';

// Proxy authentication — set PROXY_API_KEY in env or .env
const PROXY_API_KEY = process.env.PROXY_API_KEY;

// CORS — comma-separated list of allowed origins (default: none)
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean);

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length === 0) return undefined;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  return undefined;
}

const server = http.createServer((req, res) => {
  const corsOrigin = getCorsOrigin(req);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(corsOrigin ? 200 : 403);
    res.end();
    return;
  }

  // Authenticate requests
  if (PROXY_API_KEY) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${PROXY_API_KEY}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized — set Authorization: Bearer <PROXY_API_KEY>' }));
      return;
    }
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });

  req.on('end', () => {
    try {
      const { prompt, systemPrompt } = JSON.parse(body);

      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing prompt' }));
        return;
      }

      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${prompt}`
        : prompt;

      console.log(`[${new Date().toISOString()}] Received request`);
      console.log(`Prompt length: ${fullPrompt.length} chars`);

      // Use spawn with array args (no shell)
      const claude = spawn('claude', ['--print', '--model', 'haiku', fullPrompt], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: '/root' }
      });

      let stdout = '';
      let stderr = '';
      let finished = false;

      claude.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        if (!finished) {
          finished = true;
          claude.kill('SIGKILL');
          console.log(`[${new Date().toISOString()}] Timeout - killed process`);
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Timeout' }));
        }
      }, 120000);

      claude.on('close', (code) => {
        clearTimeout(timeout);
        if (finished) return;
        finished = true;

        console.log(`[${new Date().toISOString()}] Claude finished with code ${code}`);
        console.log(`stdout length: ${stdout.length}`);

        if (code !== 0) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed', code, stderr }));
          return;
        }

        let parsed = null;
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, output: stdout.trim(), parsed }));
      });

      claude.on('error', (err) => {
        clearTimeout(timeout);
        if (finished) return;
        finished = true;
        console.error(`[${new Date().toISOString()}] Spawn error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Spawn failed', message: err.message }));
      });

    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON', message: e.message }));
    }
  });
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`Claude CLI Proxy running on http://${BIND_HOST}:${PORT}`);
  console.log(`Proxy auth: ${PROXY_API_KEY ? 'ENABLED' : 'DISABLED (set PROXY_API_KEY to enable)'}`);
  console.log(`CORS origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'none (CORS disabled)'}`);
});
