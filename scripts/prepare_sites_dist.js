const fs = require('fs')
const path = require('path')

const root = process.cwd()
const distDir = path.join(root, 'dist')
const serverDir = path.join(distDir, 'server')
const clientDir = path.join(distDir, 'client')
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

console.log('Prepared Sites artifact in dist/')
