#!/bin/bash
# Corral 이 보여 줄 것들을 만든다(macOS 러너용): git 저장소·워크트리, 개발 서버 둘, 에이전트(가짜 하나 + 진짜 CLI).
# 경로에 한글과 공백을 넣는다. 만든 것은 $SMOKE_OUT/fixtures.json 에 적는다.
set -euo pipefail

OUT="${SMOKE_OUT:?SMOKE_OUT 이 필요하다}"
ROOT="${SMOKE_ROOT:?SMOKE_ROOT 가 필요하다}"
mkdir -p "$OUT" "$ROOT"
cd "$ROOT"

export GIT_AUTHOR_NAME=smoke GIT_AUTHOR_EMAIL=smoke@example.invalid
export GIT_COMMITTER_NAME=smoke GIT_COMMITTER_EMAIL=smoke@example.invalid

echo "== 저장소와 워크트리"
git -c init.defaultBranch=main init -q --bare remote.git
git clone -q remote.git shop-web 2> /dev/null
cd shop-web
git symbolic-ref HEAD refs/heads/main
printf 'node_modules/\n' > .gitignore
cat > server.js <<'EOF'
// 개발 서버 흉내: 주어진 포트를 연다.
const http = require('http')
const port = Number(process.argv[2])
http.createServer((req, res) => res.end('ok')).listen(port, '127.0.0.1', () => console.log('listening', port))
EOF
cat > stubborn.js <<'EOF'
// SIGTERM 을 무시하는 서버와 자식: Corral 이 3초 뒤 강제 종료(SIGKILL)까지 가는지 본다.
const http = require('http')
const { spawn } = require('child_process')
const { writeFileSync } = require('fs')
process.on('SIGTERM', () => console.log('SIGTERM ignored'))
const child = spawn(
  process.execPath,
  ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
  { stdio: 'ignore' }
)
writeFileSync(process.argv[3], String(child.pid))
http.createServer((req, res) => res.end('ok')).listen(Number(process.argv[2]), '127.0.0.1', () => console.log('listening', process.argv[2]))
EOF
git add -A
git commit -qm 'init'
git push -q -u origin main
git remote set-head origin main

# 에이전트가 일하는 워크트리.
git worktree add -q ../shop-web-login -b feature/login
# 끝난 워크트리: 원격에 올렸다가 원격 브랜치가 지워졌고, 의존성 폴더(5 MB)가 남았다.
git worktree add -q ../shop-web-done -b feature/done
(
  cd ../shop-web-done
  echo done > done.txt
  git add -A
  git commit -qm 'done'
  git push -q -u origin feature/done
  git push -q origin --delete feature/done
  git fetch -q --prune
  mkdir -p node_modules/pkg
  dd if=/dev/zero of=node_modules/pkg/blob bs=1048576 count=5 2> /dev/null
)
git worktree list

start() {
  # start <이름> <작업 폴더> <명령…>: 뒤에서 띄우고 pid 를 적는다.
  local name=$1 cwd=$2
  shift 2
  (
    cd "$cwd"
    nohup "$@" > "$OUT/fixture-$name.log" 2>&1 &
    echo $! > "$OUT/fixture-$name.pid"
  )
}

echo "== 개발 서버"
start server-a "$ROOT/shop-web" node server.js 5173
start server-b "$ROOT/shop-web-login" node stubborn.js 5174 "$OUT/fixture-server-b-child.pid"

echo "== 가짜 에이전트(이름이 claude 인 프로세스)"
mkdir -p "$ROOT/bin"
cp "$(command -v node)" "$ROOT/bin/claude"
start agent "$ROOT/shop-web-login" "$ROOT/bin/claude" -e 'setInterval(()=>{},1000)'

for port in 5173 5174; do
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "http://127.0.0.1:$port" && break
    sleep 0.5
  done
done

REAL_CLAUDE=no
REAL_CODEX=no
if [ "${SMOKE_REAL_AGENTS:-1}" = 1 ]; then
  set +e
  echo "== 진짜 Claude Code(로그인 없이 첫 화면에서 기다리게 둔다)"
  (curl -fsSL https://claude.ai/install.sh | bash) > "$OUT/real-claude-install.log" 2>&1
  tail -5 "$OUT/real-claude-install.log"
  CLAUDE_BIN="$HOME/.local/bin/claude"
  if [ -x "$CLAUDE_BIN" ]; then
    ls -la "$CLAUDE_BIN"
    (
      cd "$ROOT/shop-web"
      # 터미널(pty)이 있어야 화면을 띄우고 기다린다. 표준입력은 닫히지 않게 한다.
      tail -f /dev/null | nohup script -q /dev/null "$CLAUDE_BIN" > "$OUT/real-claude.log" 2>&1 &
    )
    REAL_CLAUDE=yes
  fi

  echo "== 진짜 Codex"
  npm install -g @openai/codex > "$OUT/real-codex-install.log" 2>&1
  tail -3 "$OUT/real-codex-install.log"
  if command -v codex > /dev/null; then
    (
      cd "$ROOT/shop-web"
      tail -f /dev/null | nohup script -q /dev/null codex > "$OUT/real-codex.log" 2>&1 &
    )
    REAL_CODEX=yes
  fi
  sleep 10
  set -e
fi

echo "== 에이전트 프로세스(ps 가 보는 이름·명령줄)"
/bin/ps -axww -o pid=,ppid=,comm= | grep -iE 'claude|codex' | grep -v grep | tee "$OUT/agents-ps-comm.txt" || true
/bin/ps -axww -o pid=,args= | grep -iE 'claude|codex' | grep -v grep | tee "$OUT/agents-ps-args.txt" || true

REAL_CLAUDE=$REAL_CLAUDE REAL_CODEX=$REAL_CODEX node - "$OUT" "$ROOT" <<'EOF'
const fs = require('fs')
const [out, root] = process.argv.slice(2)
const pid = (name) => {
  try {
    return Number(fs.readFileSync(`${out}/fixture-${name}.pid`, 'utf8').trim())
  } catch {
    return null
  }
}
const real = fs.realpathSync(root)
const fixtures = {
  root: real,
  mainRoot: `${real}/shop-web`,
  loginRoot: `${real}/shop-web-login`,
  doneRoot: `${real}/shop-web-done`,
  serverA: { pid: pid('server-a'), port: 5173 },
  serverB: { pid: pid('server-b'), port: 5174, childPid: pid('server-b-child') },
  agent: { pid: pid('agent') },
  realClaude: process.env.REAL_CLAUDE === 'yes',
  realCodex: process.env.REAL_CODEX === 'yes'
}
fs.writeFileSync(`${out}/fixtures.json`, JSON.stringify(fixtures, null, 2))
console.log(JSON.stringify(fixtures, null, 2))
EOF
