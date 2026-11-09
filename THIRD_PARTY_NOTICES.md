# Third-party notices

pitwall 은 아래 오픈소스 프로젝트의 일부(스타일·컴포넌트·글꼴)를 가져와 변형해 사용합니다.

## NeoHtop

- 출처: https://github.com/Abdenasser/neohtop
- 기준 커밋: dab34f5ccd2b1bf3df5d27be60d54301d9953bd2
- 가져온 것: 화면 디자인 전체 — `src/app.css`(색·표·카드 줄 규칙), 테마 "GitHub Light"·"Catppuccin" 의 색 값(`theme-tokens.js` 로 계산한 값),
  `TitleBar`·`stats/*Panel`·`ResourceTrend`·`ResourceDetails`·`toolbar/*`·`process/*`·`modals/ProcessDetailsModal`·`SettingsWindow` 의 마크업과 클래스,
  `ui/*`(shadcn-svelte 부품)의 클래스. Svelte 코드를 Vue 로 옮기면서 pitwall 의 데이터에 맞게 바꿨다.
- 라이선스: MIT

```
MIT License

Copyright (c) 2024 Abdenasser

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## shadcn-svelte

- 출처: https://github.com/huntabyte/shadcn-svelte (`shadcn-svelte` 1.7.1 의 `dist/tailwind.css`)
- 가져온 것: Tailwind 사용자 정의 variant(`data-open`, `data-checked` 등). NeoHtop 의 `ui/*` 부품도 shadcn-svelte 에서 온 것이다.
- 라이선스: MIT, Copyright (c) 2023 Hunter Johnston, Copyright (c) 2023 CokaKoala (위 NeoHtop 항목과 같은 MIT 허가 문구)

## Pretendard

- 출처: https://github.com/orioncactus/pretendard (`pretendard` 1.3.9, Pretendard Variable)
- 쓰는 것: 화면 글꼴(한글·영문·숫자). 앱에 넣어 Windows·macOS 에서 같게 보인다.
- 라이선스: SIL Open Font License 1.1, Copyright (c) 2021 Kil Hyung-jin, with Reserved Font Name Pretendard.
  라이선스 전문은 https://github.com/orioncactus/pretendard/blob/main/LICENSE 에 있다.

## Lucide

- 출처: https://github.com/lucide-icons/lucide (`@lucide/vue`)
- 쓰는 것: 화면 아이콘(NeoHtop 과 같은 아이콘 세트).
- 라이선스: ISC, Copyright (c) 2026 Lucide Icons and Contributors

## Simple Icons

- 출처: https://github.com/simple-icons/simple-icons (`simple-icons` 16.35.0)
- 쓰는 것: 표 행의 프레임워크·런타임·앱 로고(Vite, Spring Boot, Node.js, Chrome 등). NeoHtop 도 같은 패키지를 쓴다.
- 라이선스: CC0 1.0. 각 로고는 해당 회사·프로젝트의 상표이며, 무엇이 실행 중인지 알려 주는 용도로만 쓴다.

## Lobe Icons

- 출처: https://github.com/lobehub/lobe-icons (`@lobehub/icons-static-svg` 1.98.0 의 `claudecode-color.svg`, `codex-color.svg`)
- 쓰는 것: 에이전트 표의 Claude Code·Codex 로고(`src/renderer/src/assets/brands/`).
- 라이선스: MIT, Copyright (c) LobeHub. 로고는 Anthropic·OpenAI 의 상표이며, 어떤 에이전트인지 알려 주는 용도로만 쓴다.

## jsonc-parser

- 출처: https://github.com/microsoft/node-jsonc-parser (`jsonc-parser` 3.3.1)
- 쓰는 것: Claude 설정 파일(settings.json)을 주석·후행 쉼표가 있어도 읽고, 고칠 위치를 찾는 데 쓴다.
- 라이선스: MIT, Copyright (c) Microsoft

## 함께 배포되는 라이브러리

화면 코드에 묶여 들어가거나(번들) 앱과 함께 설치되는 라이브러리입니다. 아래는 모두 MIT 라이선스이며, 위 NeoHtop 항목과 같은 MIT 허가 문구가 적용됩니다. 앱과 함께 설치되는 라이브러리(`electron-updater`, `@electron-toolkit/utils`, `jsonc-parser` 와 그 의존성)는 각 패키지 폴더에 원래 라이선스 파일이 들어 있습니다.

| 라이브러리                                                                | 버전 | 쓰는 곳               | 저작권                                       |
| ------------------------------------------------------------------------- | ---- | --------------------- | -------------------------------------------- |
| [Vue](https://github.com/vuejs/core)                                      | 3.5  | 화면                  | Copyright (c) 2018-present, Yuxi (Evan) You  |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)               | 4.3  | 화면 스타일           | Copyright (c) Tailwind Labs, Inc.            |
| [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css)           | 1.4  | 화면 움직임           | Copyright (c) 2025 Wombosvideo               |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge)               | 3.7  | 화면 스타일 합치기    | Copyright (c) 2021 Dany Castillo             |
| [clsx](https://github.com/lukeed/clsx)                                    | 2.1  | 화면 스타일 합치기    | Copyright (c) Luke Edwards                   |
| [electron-updater](https://github.com/electron-userland/electron-builder) | 6.8  | Windows 자동 업데이트 | Copyright (c) 2015 Loopline Systems          |
| [@electron-toolkit/utils](https://github.com/alex8088/electron-toolkit)   | 4.0  | 메인 프로세스 도우미  | Copyright (c) 2022-present, Alex.Wei         |

Electron 과 Chromium 의 라이선스는 설치 폴더의 `LICENSE.electron.txt`, `LICENSES.chromium.html` 에 있습니다.
