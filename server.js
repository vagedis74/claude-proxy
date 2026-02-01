const http = require('http');
const https = require('https');

const PORT = 3456;

// You need to set this environment variable or replace with your API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
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

server.listen(PORT, () => {
  console.log(`Claude API Proxy running on http://localhost:${PORT}`);
  console.log(`API Key configured: ${ANTHROPIC_API_KEY ? 'Yes' : 'No - set ANTHROPIC_API_KEY env var'}`);
  console.log('POST /  - Send { "prompt": "...", "systemPrompt": "..." }');
});
