import mongoose from 'mongoose';
import { app, connectDatabase } from '../server/src/server.js';

const state = globalThis[Symbol.for('muniyasamy.vercel.database')] ||= { connection: null };

function restoreRewrittenPath(req) {
  const requestUrl = new URL(req.url || '/', `https://${req.headers.host || 'vercel.invalid'}`);
  const requestedPath = requestUrl.searchParams.get('__path');
  if (!requestedPath) return;

  const isApiPath = requestedPath === '/api' || requestedPath.startsWith('/api/');
  const isPortalPath = requestedPath === '/portal' || requestedPath.startsWith('/portal/');
  if (!isApiPath && !isPortalPath) {
    const error = new Error('Invalid rewritten path.');
    error.status = 400;
    throw error;
  }

  requestUrl.searchParams.delete('__path');
  req.url = requestedPath + (requestUrl.search ? requestUrl.search : '');
}

export default async function handler(req, res) {
  try {
    restoreRewrittenPath(req);
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (!state.connection || mongoose.connection.readyState === 0) {
        state.connection = connectDatabase().catch(error => {
          state.connection = null;
          throw error;
        });
      }
      await state.connection;
    }
    return app(req, res);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'vercel_request_setup_failed', name: error.name || 'Error' }));
    const status = error.status === 400 ? 400 : 503;
    return res.status(status).json({ error: status === 400 ? error.message : 'Service temporarily unavailable. Please try again.' });
  }
}
