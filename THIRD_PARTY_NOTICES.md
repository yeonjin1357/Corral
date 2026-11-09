# Third-party notices

pitwall 은 아래 오픈소스 프로젝트의 일부(스타일·컴포넌트)를 가져와 변형해 사용합니다.

## Uptime Kuma

- 출처: https://github.com/louislam/uptime-kuma
- 기준 커밋: c4f983a457e4ccb18e0836890b0dd80f11c2739a
- 가져온 것: `src/assets/vars.scss`, `src/assets/app.scss` 일부, `src/components/Status.vue` 의 배지 마크업
- 라이선스: MIT

```
MIT License

Copyright (c) 2021 Louis Lam

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

## Font Awesome Free

- 출처: https://fontawesome.com (`@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`, `@fortawesome/vue-fontawesome`)
- 쓰는 것: 아이콘(설정 톱니바퀴 등). Uptime Kuma 와 같은 아이콘 세트다.
- 라이선스: 아이콘 CC BY 4.0, 코드 MIT — https://fontawesome.com/license/free

## jsonc-parser

- 출처: https://github.com/microsoft/node-jsonc-parser (`jsonc-parser` 3.3.1)
- 쓰는 것: Claude 설정 파일(settings.json)을 주석·후행 쉼표가 있어도 읽고, 고칠 위치를 찾는 데 쓴다.
- 라이선스: MIT, Copyright (c) Microsoft

## 함께 배포되는 라이브러리

화면 코드에 묶여 들어가거나(번들) 앱과 함께 설치되는 라이브러리입니다. 모두 MIT 라이선스이며, 위 Uptime Kuma 항목과 같은 MIT 허가 문구가 적용됩니다. 앱과 함께 설치되는 라이브러리(`electron-updater`, `@electron-toolkit/utils`, `jsonc-parser` 와 그 의존성)는 각 패키지 폴더에 원래 라이선스 파일이 들어 있습니다.

| 라이브러리                                                                | 버전 | 쓰는 곳               | 저작권                                        |
| ------------------------------------------------------------------------- | ---- | --------------------- | --------------------------------------------- |
| [Vue](https://github.com/vuejs/core)                                      | 3.5  | 화면                  | Copyright (c) 2018-present, Yuxi (Evan) You   |
| [Bootstrap](https://github.com/twbs/bootstrap)                            | 5.3  | 화면 스타일           | Copyright (c) 2011-2025 The Bootstrap Authors |
| [Chart.js](https://github.com/chartjs/Chart.js)                           | 4.6  | 추이 그래프           | Copyright (c) 2014-2024 Chart.js Contributors |
| [vue-chartjs](https://github.com/apertureless/vue-chartjs)                | 5.3  | 추이 그래프           | Copyright (c) 2016 Jakub Juszczak             |
| [electron-updater](https://github.com/electron-userland/electron-builder) | 6.8  | Windows 자동 업데이트 | Copyright (c) 2015 Loopline Systems           |
| [@electron-toolkit/utils](https://github.com/alex8088/electron-toolkit)   | 4.0  | 메인 프로세스 도우미  | Copyright (c) 2022-present, Alex.Wei          |

Electron 과 Chromium 의 라이선스는 설치 폴더의 `LICENSE.electron.txt`, `LICENSES.chromium.html` 에 있습니다.
