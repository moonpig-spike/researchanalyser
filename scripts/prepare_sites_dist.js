const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = process.cwd()
const distDir = path.join(root, 'dist')
const serverDir = path.join(distDir, 'server')
const clientDir = path.join(distDir, 'client')
const bundleDir = path.join(root, '.open-next', 'sites-bundle')
const openNextWorker = path.join(root, '.open-next', 'worker.js')
const openNextAssets = path.join(root, '.open-next', 'assets')
const hostingConfig = path.join(root, '.openai', 'hosting.json')

if (!fs.existsSync(openNextWorker)) {
  throw new Error('Missing .open-next/worker.js. Run opennextjs-cloudflare build first.')
}

if (!fs.existsSync(hostingConfig)) {
  throw new Error('Missing .openai/hosting.json.')
}

fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(serverDir, { recursive: true })
fs.mkdirSync(path.join(distDir, '.openai'), { recursive: true })

fs.copyFileSync(openNextWorker, path.join(serverDir, 'index.js'))
fs.copyFileSync(hostingConfig, path.join(distDir, '.openai', 'hosting.json'))

for (const entry of ['.build', 'cloudflare', 'middleware', 'server-functions']) {
  const source = path.join(root, '.open-next', entry)
  if (fs.existsSync(source)) {
    fs.cpSync(source, path.join(serverDir, entry), { recursive: true })
  }
}

fs.rmSync(path.join(serverDir, 'cloudflare', 'cache-assets-manifest.sql'), {
  force: true,
})
fs.rmSync(path.join(serverDir, 'server-functions', 'default', '.next', 'BUILD_ID'), {
  force: true,
})
fs.rmSync(
  path.join(
    serverDir,
    'server-functions',
    'default',
    'node_modules',
    'next',
    'dist',
    'lib',
    'server-external-packages.jsonc'
  ),
  { force: true }
)

if (fs.existsSync(openNextAssets)) {
  fs.cpSync(openNextAssets, clientDir, { recursive: true })
}

fs.rmSync(bundleDir, { recursive: true, force: true })
execFileSync(
  'npx',
  [
    'wrangler',
    'deploy',
    path.join(serverDir, 'index.js'),
    `--assets=${clientDir}`,
    '--compatibility-date=2026-06-08',
    '--compatibility-flag=nodejs_compat',
    '--dry-run',
    `--outdir=${bundleDir}`,
  ],
  { stdio: 'inherit' }
)

const bundledWorker = path.join(bundleDir, 'index.js')
if (!fs.existsSync(bundledWorker)) {
  throw new Error('Wrangler did not produce a bundled Worker index.js.')
}

fs.rmSync(serverDir, { recursive: true, force: true })
fs.mkdirSync(serverDir, { recursive: true })
fs.copyFileSync(bundledWorker, path.join(serverDir, 'index.js'))

console.log('Prepared Sites artifact in dist/')
