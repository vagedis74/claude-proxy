const http = require('http');
const { spawn } = require('child_process');

const PORT = 3456;

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude CLI Proxy running on http://0.0.0.0:${PORT}`);
});
