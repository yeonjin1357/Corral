# pitwall

AI 코딩 에이전트(Claude Code, Codex)를 여러 워크트리에서 동시에 돌릴 때, 내 PC 에서 돌아가는 개발 작업 전체(에이전트·개발 서버 포트·RAM·디스크)를 한눈에 보고 그 자리에서 정리하는 트레이 앱입니다.

> 개발 중입니다. 설계: [docs/superpowers/specs/2026-11-06-pitwall-design.md](docs/superpowers/specs/2026-11-06-pitwall-design.md)

- 지원 OS: Windows, macOS(미검증)
- 라이선스: MIT — 디자인 일부는 [Uptime Kuma](https://github.com/louislam/uptime-kuma)(MIT)에서 가져왔습니다. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 개발

```bash
npm install
npm run dev        # 개발 실행
npm test           # 테스트
npm run typecheck  # 타입 검사
npm run build      # 빌드
```
