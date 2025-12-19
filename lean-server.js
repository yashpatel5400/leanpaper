#!/usr/bin/env node
/**
 * Minimal Lean check server.
 * Runs `lake env lean --check <file>` inside contextual_robust_optimization/lean
 * and returns stdout/stderr as JSON.
 */
const http = require('http');
const { execFile } = require('child_process');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const ROOT = path.join(__dirname, 'contextual_robust_optimization', 'lean');
const LEAN_PATH = (() => {
  const raw = process.env.LEAN_PATH || `${process.env.HOME}/.elan/bin:${process.env.PATH}`;
  return raw.replace(/\$PATH/g, process.env.PATH || '');
})();

function safePath(relPath) {
  const cleaned = relPath.replace(/^\/+/, '');
  const full = path.normalize(path.join(ROOT, cleaned));
  if (!full.startsWith(ROOT)) {
    throw new Error('Invalid path');
  }
  return full;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function handleCheck(req, res) {
  const parsed = url.parse(req.url, true);
  const file = parsed.query.file;
  if (!file) {
    return sendJson(res, 400, { error: 'Missing file query parameter' });
  }

  let fullPath;
  try {
    fullPath = safePath(file);
  } catch (err) {
    return sendJson(res, 400, { error: 'Invalid file path' });
  }

  const relPath = path.relative(ROOT, fullPath);
  if (!relPath || relPath.startsWith('..')) {
    return sendJson(res, 400, { error: 'File must be inside Lean project root' });
  }
  const cmd = 'lake';
  // Lean 4: use --json to get structured output; bare lean will typecheck the file.
  const args = ['env', 'lean', '--json', relPath];
  const start = Date.now();

  execFile(
    cmd,
    args,
    {
      cwd: ROOT,
      env: { ...process.env, PATH: LEAN_PATH, LEAN_ABORT_ON_PANIC: 'false' },
      maxBuffer: 10 * 1024 * 1024
    },
    (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      if (error) {
        return sendJson(res, 500, {
          error: error.message,
          code: error.code,
          stdout,
          stderr,
          durationMs
        });
      }
      return sendJson(res, 200, { stdout, stderr, durationMs });
    }
  );
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  if (parsed.pathname === '/lean/check') {
    return handleCheck(req, res);
  }
  if (parsed.pathname === '/lean/health') {
    return sendJson(res, 200, { status: 'ok' });
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Lean server listening on http://localhost:${PORT}`);
});
