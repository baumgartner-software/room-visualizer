/**
 * Rendert die WebXR-Anwendung headless und legt die Bilder unter docs/preview/ ab.
 *
 *   npm run screenshot
 *
 * Die Seite wird dafür mit `?reset=1&ui=0&view=…` geladen: `reset` erzwingt den
 * Auslieferungszustand (Grundriss + Standardküche), `ui=0` blendet die
 * Bedienoberfläche aus. `window.__roomVisualizer.ready` meldet, dass die ersten
 * Frames gerendert sind.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, process.env.SCREENSHOT_DIR ?? 'docs/preview')
const PORT = Number(process.env.SCREENSHOT_PORT ?? 4183)

const SHOTS = [
  { file: 'kitchen.png', query: 'view=kitchen', width: 1600, height: 900 },
  { file: 'isometrisch.png', query: 'view=isometric', width: 1600, height: 1000 },
  { file: 'grundriss.png', query: 'view=top', width: 1400, height: 1000 },
]

await mkdir(outDir, { recursive: true })

const server = await preview({
  root,
  // `base: './'` (siehe vite.config.ts) macht den Vorschau-Server sonst zickig.
  preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
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
    await page.goto(`${baseUrl}?reset=1&ui=0&${shot.query}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__roomVisualizer?.ready === true, null, { timeout: 60_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: resolve(outDir, shot.file) })
    await page.close()
    console.log(`✓ ${shot.file}`)
  }
} finally {
  await browser.close()
  await server.close()
}

if (problems.length > 0) {
  console.error('Fehler beim Rendern:\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`Bilder liegen in ${outDir}`)
