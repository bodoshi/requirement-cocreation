#!/usr/bin/env node
// rc-server.js — 本地代理服务器，用 Claude Code CLI 替代 API Key
// 用法: node rc-server.js
// 浏览器访问: http://localhost:3456

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.RC_PORT || 3456;
const HOST = '0.0.0.0'; // Listen on all interfaces for LAN access
const HTML_FILE = path.join(__dirname, 'public', 'index.html');
const RC_TOKEN = process.env.RC_TOKEN || ''; // Optional token for LAN auth

// 自动探测 CLI 路径
function findCLI() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@futupb', 'ft-claude-code', 'cli2.js'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findGitBash() {
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH && fs.existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) {
    return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  }
  const candidates = ['D:\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Git\\bin\\bash.exe'];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'bash'; // fallback to PATH
}

const CLI_JS = findCLI();
const GIT_BASH = findGitBash();

if (!CLI_JS) {
  console.error('\n  ❌ 找不到 Claude Code CLI。请确认已安装：');
  console.error('     npm install -g @futupb/ft-claude-code');
  console.error('     或 npm install -g @anthropic-ai/claude-code\n');
  process.exit(1);
}
console.log(`  📍 CLI: ${CLI_JS}`);
console.log(`  📍 Git Bash: ${GIT_BASH}`);

function getLanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) ips.push(cfg.address);
    }
  }
  return ips;
}

function checkToken(req, res) {
  if (!RC_TOKEN) return true;
  const auth = req.headers['x-rc-token'] || '';
  if (auth === RC_TOKEN) return true;
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Invalid token' }));
  return false;
}

const server = http.createServer((req, res) => {
  // CORS — allow any origin (Vercel, file://, localhost)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-RC-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/ping — health check
  if (req.method === 'GET' && req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, version: '1.0' }));
    return;
  }

  // GET / → serve HTML (for local direct access)
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end('Failed to read HTML: ' + e.message);
    }
    return;
  }

  // POST /api/claude — proxy to Claude CLI via stdin
  if (req.method === 'POST' && req.url === '/api/claude') {
    if (!checkToken(req, res)) return;

    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { systemPrompt, userMessage, model } = JSON.parse(body);

        const args = [
          CLI_JS,
          '--print',
          '--output-format', 'text',
          '--no-session-persistence',
        ];
        if (model) args.push('--model', model);

        // system prompt + user message combined via stdin
        const stdinContent = systemPrompt
          ? `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n${userMessage || ''}`
          : (userMessage || '');

        const env = { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH };
        const reqStart = Date.now();
        console.log(`[${new Date().toLocaleTimeString()}] API call: model=${model || 'default'}, prompt=${stdinContent.length} chars`);

        const proc = spawn('node', args, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        proc.stdin.write(stdinContent);
        proc.stdin.end();

        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);

        const TIMEOUT_MS = 300000; // 5 minutes
        const timer = setTimeout(() => {
          proc.kill();
          const elapsed = ((Date.now() - reqStart) / 1000).toFixed(1);
          console.log(`[${new Date().toLocaleTimeString()}] TIMEOUT after ${elapsed}s`);
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: `请求超时（${elapsed}s）` }));
          }
        }, TIMEOUT_MS);

        proc.on('close', code => {
          clearTimeout(timer);
          const elapsed = ((Date.now() - reqStart) / 1000).toFixed(1);
          console.log(`[${new Date().toLocaleTimeString()}] Done in ${elapsed}s, code=${code}, output=${stdout.length} chars`);
          if (res.headersSent) return;
          if (code !== 0) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: stderr || `claude exited with code ${code}` }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ text: stdout }));
          }
        });

        proc.on('error', e => {
          clearTimeout(timer);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Failed to spawn claude: ' + e.message }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request: ' + e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, HOST, () => {
  const lanIPs = getLanIPs();
  console.log(`\n  RC Proxy started`);
  console.log(`  Local:   http://localhost:${PORT}`);
  if (lanIPs.length) {
    lanIPs.forEach(ip => console.log(`  LAN:     http://${ip}:${PORT}`));
  }
  if (RC_TOKEN) {
    console.log(`  Token:   enabled (set X-RC-Token header)`);
  }
  console.log(`  Ping:    GET /api/ping\n`);
});
