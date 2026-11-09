// 앱 아이콘을 만든다: "피트월 모니터"(NeoHtop 아이콘처럼 검은 둥근 판 위 픽셀 그림). 그림은 src/main/pixelArt.ts 한 곳에 있다.
// 실행: npm run icon   (node --experimental-strip-types 로 TS 를 그대로 불러온다. Node 22.6 이상)
// 결과:
//   build/icon.png       1024 큰 아이콘 — macOS·설치 파일 원본
//   build/icon.ico       Windows: 16·32·48 은 작은 그림(흐려지지 않게 정수배), 64·128·256 은 큰 그림
//   resources/icon.png   512 큰 아이콘 — 앱 안(불러오는 화면·Linux 창)
//   resources/icon-small.png  80 작은 그림 — 화면 제목줄(20px, 1·2배 화면에서 또렷)
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_LINE,
  encodeIco,
  encodePng,
  renderAppIcon,
  renderSmallIcon
} from '../src/main/pixelArt.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const big = (size) => encodePng(renderAppIcon(size), size, size)
const small = (size) => encodePng(renderSmallIcon(APP_LINE, size), size, size)

writeFileSync(join(root, 'build', 'icon.png'), big(1024))
writeFileSync(join(root, 'resources', 'icon.png'), big(512))
writeFileSync(join(root, 'resources', 'icon-small.png'), small(80))
writeFileSync(
  join(root, 'build', 'icon.ico'),
  encodeIco([
    { size: 16, png: small(16) },
    { size: 32, png: small(32) },
    { size: 48, png: small(48) },
    { size: 64, png: big(64) },
    { size: 128, png: big(128) },
    { size: 256, png: big(256) }
  ])
)
console.log('icons written')
