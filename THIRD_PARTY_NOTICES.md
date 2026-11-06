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
