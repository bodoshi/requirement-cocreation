#!/usr/bin/env node
// rc-server.js — 本地代理服务器，用 Claude Code CLI 替代 API Key
// 用法: node rc-server.js
// 浏览器访问: http://localhost:3456

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3456;
const HTML_FILE = path.join(__dirname, 'requirement-cocreation.html');

const CLI_JS = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@futupb', 'ft-claude-code', 'cli2.js');
const GIT_BASH = process.env.CLAUDE_CODE_GIT_BASH_PATH || 'D:\\Git\\bin\\bash.exe';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET / → 返回 HTML
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

  // POST /api/claude → 通过 stdin 传入内容，避免命令行长度超限
  if (req.method === 'POST' && req.url === '/api/claude') {
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

        // system prompt + user message 合并通过 stdin 传入
        // claude --print 从 stdin 读取用户消息
        const stdinContent = systemPrompt
          ? `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n${userMessage || ''}`
          : (userMessage || '');

        const env = { ...process.env, CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH };
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

        const timer = setTimeout(() => {
          proc.kill();
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '请求超时（120s）' }));
          }
        }, 120000);

        proc.on('close', code => {
          clearTimeout(timer);
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

server.listen(PORT, () => {
  console.log(`\n  🚀 需求共创 本地代理已启动`);
  console.log(`  📎 打开浏览器访问: http://localhost:${PORT}`);
  console.log(`  💡 无需 API Key，使用你的 Claude Code 订阅\n`);
});
