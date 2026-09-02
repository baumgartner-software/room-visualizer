/**
 * Rendert die WebXR-Anwendung headless und legt die Bilder unter docs/preview/ ab.
 *
 *   npm run build && npm run screenshot
 *
 * Die Seite wird mit `?reset=1&ui=0&view=…` geladen: `reset` erzwingt den
 * Auslieferungszustand (Grundriss + Standardküche), `ui=0` blendet die
 * Bedienoberfläche aus. `window.__roomVisualizer.ready` meldet, dass die ersten
 * Frames gerendert sind.
 *
 * Ausgeliefert wird `dist/` über einen kleinen eigenen Server – der ist
 * berechenbarer als ein Dev-/Preview-Server und lässt sich sauber beenden.
 */
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const outDir = resolve(root, process.env.SCREENSHOT_DIR ?? 'docs/preview')
const PORT = Number(process.env.SCREENSHOT_PORT ?? 4183)
const TIMEOUT_MS = Number(process.env.SCREENSHOT_TIMEOUT_MS ?? 240_000)

const SHOTS = [
  { file: 'kitchen.png', query: 'view=kitchen', width: 1600, height: 900 },
  { file: 'isometrisch.png', query: 'view=isometric', width: 1600, height: 1000 },
  { file: 'grundriss.png', query: 'view=top', width: 1400, height: 1000 },
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

// Notbremse: lieber ein roter Build als ein Job, der stundenlang hängt.
const watchdog = setTimeout(() => {
  console.error(`Zeitüberschreitung nach ${TIMEOUT_MS / 1000}s – Rendern abgebrochen.`)
  process.exit(1)
}, TIMEOUT_MS)
watchdog.unref()

await mkdir(outDir, { recursive: true })

const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
  const file = path === '/' ? '/index.html' : path
  readFile(join(dist, file))
    .then((data) => {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(data)
    })
    .catch(() => {
      res.writeHead(404)
      res.end('not found')
    })
})
await new Promise((ok, fail) => {
  server.once('error', fail)
  server.listen(PORT, '127.0.0.1', ok)
})
const baseUrl = `http://127.0.0.1:${PORT}/`

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  // SwiftShader liefert WebGL auf CI-Runnern ohne GPU.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

const problems = []
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
    })
    page.on('pageerror', (err) => problems.push(`${shot.file}: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`${shot.file}: ${msg.text()}`)
    })
    await page.goto(`${baseUrl}?reset=1&ui=0&${shot.query}`, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => window.__roomVisualizer?.ready === true, null, {
      timeout: 60_000,
      polling: 250,
    })
    await page.waitForTimeout(500)
    await page.screenshot({ path: resolve(outDir, shot.file) })
    await page.close()
    console.log(`✓ ${shot.file}`)
  }
} catch (err) {
  problems.push(String(err))
} finally {
  await browser.close().catch(() => undefined)
  server.close()
}

if (problems.length > 0) {
  console.error('Fehler beim Rendern:\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`Bilder liegen in ${outDir}`)
// Explizit beenden: offene Handles sollen den Job nicht blockieren.
process.exit(0)
