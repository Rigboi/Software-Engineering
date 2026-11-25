// HTTPS endpoints for Feature 06 (served over HTTPS by the UWI server). JSON in, JSON out.
const fs = require('fs');
const path = require('path');
const { ValidationError, NotFoundError } = require('./maintenanceService');

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new SyntaxError('Request body must be valid JSON.')); } });
  });
}

function createHandler(service, authorize) {
  const send = (res, status, data, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      }
      const m0 = url.pathname === '/api/maintenance/assets';
      const m = m0 ? null : url.pathname.match(/^\/api\/maintenance(?:\/(\d+))?$/);
      if (!m && !m0) return send(res, 404, { message: 'Not found.' });

      const auth = authorize(req);                       // checked before every action
      if (!auth.ok) return send(res, auth.status, { message: auth.message });
      if (m0) return req.method === 'GET' ? send(res, 200, { assets: service.listAssets() }) : send(res, 405, { message: 'Method not allowed.' });
      const id = m[1] ? Number(m[1]) : null;

      if (!id && req.method === 'GET') return send(res, 200, service.listTasks());
      if (!id && req.method === 'POST') return send(res, 201, service.createTask(await readJson(req)));
      if (id && req.method === 'GET') return send(res, 200, service.getTask(id));
      if (id && req.method === 'PATCH') return send(res, 200, service.updateTask(id, await readJson(req)));
      return send(res, 405, { message: 'Method not allowed.' });
    } catch (e) {
      if (e instanceof ValidationError) return send(res, 400, { message: e.message, errors: e.errors });
      if (e instanceof NotFoundError) return send(res, 404, { message: e.message });
      if (e instanceof SyntaxError) return send(res, 400, { message: e.message });
      console.error(e);
      return send(res, 500, { message: 'The save failed. Nothing was changed.' });
    }
  };
}
module.exports = { createHandler };
