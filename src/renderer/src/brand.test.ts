import { appBrand, brandColor, devServerBrand, heavyBrand, leftoverBrand } from './brand'

describe('개발 서버: 명령줄로 프레임워크·런타임 로고를 고른다', () => {
  test.each([
    [
      '"C:\\Program Files\\nodejs\\node.exe" C:\\work\\shop-web\\node_modules\\.bin\\..\\vite\\bin\\vite.js --port 3001',
      'Vite'
    ],
    ['node C:\\work\\a\\node_modules\\next\\dist\\bin\\next dev', 'Next.js'],
    ['node /work/a/node_modules/nuxi/bin/nuxi.mjs dev', 'Nuxt'],
    ['node node_modules/@angular/cli/bin/ng serve', 'Angular'],
    ['node node_modules/webpack-dev-server/bin/webpack-dev-server.js', 'Webpack'],
    ['node node_modules/storybook/bin/index.cjs dev -p 6006', 'Storybook'],
    ['"C:\\jdk\\bin\\java.exe" -jar shop-api.jar --spring.profiles.active=local', 'Spring Boot'],
    ['"C:\\jdk\\bin\\java.exe" -cp app.jar com.example.Main', 'OpenJDK'],
    ['python manage.py runserver 8000', 'Django'],
    ['python -m uvicorn main:app --reload', 'FastAPI'],
    ['python app.py', 'Python'],
    ['go run ./cmd/server', 'Go'],
    ['node server.js', 'Node.js']
  ])('%s → %s', (cmd, title) => {
    expect(devServerBrand(cmd)?.title).toBe(title)
  })

  test('알아볼 수 없으면 null(OS 앱 아이콘·기본 아이콘을 쓴다)', () => {
    expect(devServerBrand('"C:\\work\\gateway\\gateway.exe" --port 8080')).toBeNull()
    expect(devServerBrand('')).toBeNull()
  })

  test('경로 속 낱말에 속지 않는다(폴더 이름 go·next 등)', () => {
    expect(devServerBrand('node C:\\work\\go-shop\\server.js')?.title).toBe('Node.js')
    expect(devServerBrand('node /work/next-admin/server.js')?.title).toBe('Node.js')
  })
})

test('무거운 작업: 명령 패턴으로 고른다(vue-tsc 는 TypeScript)', () => {
  expect(heavyBrand('vue-tsc', 'node vue-tsc.js --noEmit')?.title).toBe('TypeScript')
  expect(heavyBrand('tsc', 'node tsc -b')?.title).toBe('TypeScript')
  expect(heavyBrand('vite build', 'node vite.js build')?.title).toBe('Vite')
  expect(heavyBrand('gradle build', 'gradlew build')?.title).toBe('Gradle')
  expect(heavyBrand('mvn', 'mvn package')?.title).toBe('Apache Maven')
  expect(heavyBrand('cargo build', 'cargo build')?.title).toBe('Rust')
})

test('남은 프로세스: 이름표·명령줄로 고른다', () => {
  expect(
    leftoverBrand('Gradle 데몬', 'java org.gradle.launcher.daemon.bootstrap.GradleDaemon')?.title
  ).toBe('Gradle')
  expect(leftoverBrand('Kotlin 데몬', 'java KotlinCompileDaemon')?.title).toBe('Kotlin')
  expect(leftoverBrand('TypeScript 서버', 'node tsserver.js')?.title).toBe('TypeScript')
  expect(leftoverBrand('esbuild', 'esbuild --service=0.21.5')?.title).toBe('esbuild')
  expect(leftoverBrand('Vitest', 'node vitest.mjs')?.title).toBe('Vitest')
  expect(leftoverBrand('Playwright 브라우저', 'chrome.exe --remote-debugging-pipe')).toBeNull()
})

test('다른 앱: 이름으로 고른다(OS 아이콘이 없을 때만 쓴다)', () => {
  expect(appBrand('chrome.exe')?.title).toBe('Google Chrome')
  expect(appBrand('Google Chrome Helper')?.title).toBe('Google Chrome')
  expect(appBrand('Figma.exe')?.title).toBe('Figma')
  expect(appBrand('mystery.exe')).toBeNull()
})

test('검은 로고(Next.js 등)는 글자색을 따라 어두운 테마에서도 보이고, 색 있는 로고는 제 색', () => {
  expect(brandColor('000000')).toBe('currentColor')
  expect(brandColor('0F0F11')).toBe('currentColor')
  expect(brandColor('646CFF')).toBe('#646CFF')
})
