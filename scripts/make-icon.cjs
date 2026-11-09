// 앱 아이콘을 만든다: 화면 머리의 로고와 같은 모양(초록 원 + Font Awesome flag-checkered).
// 실행: npx electron scripts/make-icon.cjs
// 결과: build/icon.png(1024, 설치 파일·macOS·Windows 아이콘의 원본), resources/icon.png(512)
// .ico/.icns 는 electron-builder 가 build/icon.png 에서 만든다.
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { join } = require('path')
const { faFlagCheckered } = require('@fortawesome/free-solid-svg-icons')

// Uptime Kuma vars.scss 의 $primary(화면 로고와 같은 색).
const PRIMARY = '#5cdd8b'

function svg(size) {
  const [w, h, , , d] = faFlagCheckered.icon
  const circle = size * 0.92
  // 화면 로고(지름 40px, 글자 18px)와 같은 비율.
  const glyph = circle * 0.45
  const scale = glyph / Math.max(w, h)
  const x = (size - w * scale) / 2
  const y = (size - h * scale) / 2
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<circle cx="${size / 2}" cy="${size / 2}" r="${circle / 2}" fill="${PRIMARY}"/>`,
    `<g transform="translate(${x} ${y}) scale(${scale})"><path fill="#ffffff" d="${d}"/></g>`,
    '</svg>'
  ].join('')
}

async function render(win, size) {
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg(size)).toString('base64'))}
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = ${size}
    canvas.height = ${size}
    canvas.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
    return canvas.toDataURL('image/png')
  })()`)
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const root = join(__dirname, '..')
  writeFileSync(join(root, 'build', 'icon.png'), await render(win, 1024))
  writeFileSync(join(root, 'resources', 'icon.png'), await render(win, 512))
  console.log('icons written')
  app.quit()
})
