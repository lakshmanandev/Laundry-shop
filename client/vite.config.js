import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const workspaceRoot = path.resolve(here, '..');

function developmentRoutes() {
  const screens = new Set(['overview', 'orders', 'new-order', 'notifications', 'profile', 'my-messages', 'inbox', 'manage-orders', 'services', 'settings', 'customers', 'audit']);
  const pageAliases = new Map([
    ['/privacy', '/privacy.html']
  ]);
  return {
    name: 'laundry-frontend-development-routes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const pathname = requestUrl.pathname.replace(/\\/g, '/');
        if (pathname === '/portal.html') {
          res.statusCode = 308;
          res.setHeader('Location', '/portal/');
          return res.end();
        }
        if (pathname === '/portal' || pathname === '/portal/' || /^\/portal\/(admin|customer)(?:\/([a-z-]+))?\/?$/.test(pathname)) {
          const match = pathname.match(/^\/portal\/(admin|customer)(?:\/([a-z-]+))?\/?$/);
          if (match && match[2] && !screens.has(match[2])) {
            res.statusCode = 404;
            return res.end('Portal page not found.');
          }
          req.url = `/client/index.html${requestUrl.search}`;
          return next();
        }
        if (pathname.startsWith('/portal/')) {
          res.statusCode = 404;
          return res.end('Portal asset not found.');
        }
        if (/^\/(?:brunswick-east|maribyrnong|st-albans)(?:\.html)?\/?$/.test(pathname) || pathname === '/blog' || pathname.startsWith('/blog/')) {
          res.statusCode = 404;
          return res.end('Page not found.');
        }
        const alias = pageAliases.get(pathname.replace(/\/$/, '') || '/');
        if (alias) req.url = `${alias}${requestUrl.search}`;
        return next();
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (context.server && context.path.startsWith('/client/')) return html.replace('src="/src/main.jsx"', 'src="/client/src/main.jsx"');
        return html;
      }
    }
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, path.resolve(here, '..'), '');
  const isDevServer = command === 'serve';
  return {
    root: isDevServer ? workspaceRoot : here,
    base: isDevServer ? '/' : '/portal/',
    define: {
      __PUBLIC_SITE_URL__: JSON.stringify(isDevServer ? '/' : '')
    },
    plugins: [react(), ...(isDevServer ? [developmentRoutes()] : [])],
    build: {
      outDir: path.resolve(here, 'dist'),
      emptyOutDir: true,
      assetsDir: 'assets',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/react-router')) return 'router-vendor';
            if (id.includes('/node_modules/react-dom') || id.includes('/node_modules/react/') || id.includes('/node_modules/scheduler/')) return 'react-vendor';
          }
        }
      }
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_TARGET || `http://localhost:${env.PORT || 4000}`,
          changeOrigin: false
        }
      }
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true }
  };
});
