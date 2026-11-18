// Renders build/icon.png (1024x1024) with Electron: `npx electron scripts/make-icon.cjs`
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const icon = require('node:fs').readFileSync(join(__dirname, '..', 'src/renderer/src/assets/brand/spindle-icon.svg'), 'utf8')
// macOS icon grid: ~80% artwork on a transparent canvas
const html = `<!doctype html><html style="background:transparent;overflow:hidden"><body style="margin:0;background:transparent;overflow:hidden;display:flex;align-items:center;justify-content:center;width:1024px;height:1024px"><div style="width:824px;height:824px">${icon.replace('<svg ', '<svg width="824" height="824" ')}</div></body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, backgroundColor: '#00000000' })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
