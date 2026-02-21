const http = require('http');
const https = require('https');

const PORT = 3456;
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';

// You need to set this environment variable or replace with your API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Proxy authentication — set PROXY_API_KEY in env or .env
const PROXY_API_KEY = process.env.PROXY_API_KEY;

// CORS — comma-separated list of allowed origins (default: none)
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean);

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length === 0) return undefined; // no CORS at all
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

      if (!ANTHROPIC_API_KEY) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }));
        return;
      }

      console.log(`[${new Date().toISOString()}] Received request`);
      console.log(`Prompt length: ${prompt.length} chars`);

      const requestBody = JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4096,
        system: systemPrompt || 'You are a helpful assistant.',
        messages: [{ role: 'user', content: prompt }]
      });

      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };

      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => { data += chunk; });
        apiRes.on('end', () => {
          console.log(`[${new Date().toISOString()}] API response received`);

          try {
            const response = JSON.parse(data);

            if (apiRes.statusCode !== 200) {
              res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'API error', details: response }));
              return;
            }

            const output = response.content?.[0]?.text || '';

            // Try to parse JSON from response
            let parsed = null;
            try {
              const jsonMatch = output.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
              }
            } catch (e) {}

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              output: output.trim(),
              parsed
            }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Parse error', message: e.message }));
          }
        });
      });

      apiReq.on('error', (e) => {
        console.error(`API error: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API request failed', message: e.message }));
      });

      apiReq.setTimeout(120000, () => {
        apiReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Timeout' }));
      });

      apiReq.write(requestBody);
      apiReq.end();

    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body', message: e.message }));
    }
  });
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`Claude API Proxy running on http://${BIND_HOST}:${PORT}`);
  console.log(`API Key configured: ${ANTHROPIC_API_KEY ? 'Yes' : 'No - set ANTHROPIC_API_KEY env var'}`);
  console.log(`Proxy auth: ${PROXY_API_KEY ? 'ENABLED' : 'DISABLED (set PROXY_API_KEY to enable)'}`);
  console.log(`CORS origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'none (CORS disabled)'}`);
  console.log('POST /  - Send { "prompt": "...", "systemPrompt": "..." }');
});
