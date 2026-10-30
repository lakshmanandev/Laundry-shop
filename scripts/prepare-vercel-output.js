import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'vercel-output');
const portalBuild = path.join(root, 'client', 'dist');

if (!existsSync(path.join(portalBuild, 'index.html'))) {
  throw new Error('Build the React portal before preparing the Vercel output.');
}

// This directory is generated for deployment and intentionally contains only
// the public website, approved static assets, and the built React portal.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of ['index.html', 'privacy.html', 'robots.txt']) {
  cpSync(path.join(root, file), path.join(output, file));
}

function copyWebFiles(source, destination, { skipBlog = false } = {}) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (entry.endsWith('.md') || (skipBlog && entry === 'blog')) continue;
    const from = path.join(source, entry);
    const to = path.join(destination, entry);
    if (statSync(from).isDirectory()) copyWebFiles(from, to, { skipBlog });
    else cpSync(from, to);
  }
}

copyWebFiles(path.join(root, 'assets'), path.join(output, 'assets'), { skipBlog: true });
copyWebFiles(path.join(root, 'css'), path.join(output, 'css'));
copyWebFiles(path.join(root, 'js'), path.join(output, 'js'));
cpSync(portalBuild, path.join(output, 'portal'), { recursive: true });

console.log('Prepared Vercel static output in vercel-output/.');
