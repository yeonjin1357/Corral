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

echo "== 터미널 창 안에서 띄운 가짜 에이전트(창으로 가기 확인용)"
cat > "$ROOT/agent-in-terminal.command" <<EOF
#!/bin/bash
cd "$ROOT/shop-web"
exec "$ROOT/bin/claude" -e 'setInterval(()=>{},1000)' corral-terminal-agent
EOF
chmod +x "$ROOT/agent-in-terminal.command"
open -a Terminal "$ROOT/agent-in-terminal.command" || true
TERMINAL_AGENT_PID=
for _ in $(seq 1 30); do
  TERMINAL_AGENT_PID=$(pgrep -f corral-terminal-agent | head -1 || true)
  [ -n "$TERMINAL_AGENT_PID" ] && break
  sleep 0.5
done
echo "터미널 에이전트 pid: ${TERMINAL_AGENT_PID:-없음}"

# osascript 가 답을 기다리며 멈추지 않게 시간 제한을 둔다(macOS 에는 timeout 명령이 없다).
limited() {
  local secs=$1
  shift
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
}

# 탭까지 고르는지 보려고: 에이전트가 있는 창에 탭을 하나 더 열고(에이전트 탭이 뒤로 간다), 다른 창도 하나 띄운다.
limited 20 osascript -e 'tell application "Terminal" to activate' > /dev/null 2>&1 || true
sleep 1
limited 20 osascript -e 'tell application "System Events" to keystroke "t" using command down' > /dev/null 2>&1 || true
sleep 1
open -a Terminal "$ROOT" || true
sleep 1
limited 20 osascript -e 'tell application "Terminal" to get {count of windows, count of tabs of window 1}' || true

echo "== iTerm2 안에서 띄운 가짜 에이전트(탭 고르기 확인용, 되는 만큼)"
ITERM_AGENT_PID=
if [ "${SMOKE_ITERM:-1}" = 1 ]; then
  set +e
  brew install --cask iterm2 > "$OUT/iterm-install.log" 2>&1
  tail -2 "$OUT/iterm-install.log"
  if [ -d /Applications/iTerm.app ]; then
    # 내려받은 앱을 처음 열 때 묻는 창이 뜨지 않게.
    xattr -dr com.apple.quarantine /Applications/iTerm.app
    # iTerm2 에 넘기는 명령은 공백이 없는 경로로.
    LAUNCHER="$RUNNER_TEMP/agent-in-iterm.sh"
    cat > "$LAUNCHER" <<EOF
#!/bin/bash
cd "$ROOT/shop-web"
exec "$ROOT/bin/claude" -e 'setInterval(()=>{},1000)' corral-iterm-agent
EOF
    chmod +x "$LAUNCHER"
    limited 90 osascript -e "tell application \"iTerm2\" to create window with default profile command \"$LAUNCHER\"" > "$OUT/iterm-launch.log" 2>&1
    for _ in $(seq 1 40); do
      ITERM_AGENT_PID=$(pgrep -f corral-iterm-agent | head -1 || true)
      [ -n "$ITERM_AGENT_PID" ] && break
      sleep 0.5
    done
    # 에이전트 창이 뒤로 가게 창을 하나 더 띄운다.
    limited 30 osascript -e 'tell application "iTerm2" to create window with default profile' >> "$OUT/iterm-launch.log" 2>&1
    cat "$OUT/iterm-launch.log"
  fi
  set -e
fi
echo "iTerm2 에이전트 pid: ${ITERM_AGENT_PID:-없음}"

echo "== 한글 폴더 이름이 자소 분리형(NFD)인 저장소 — Finder 로 만든 한글 폴더가 이렇게 저장된다"
NFD_DIR="$ROOT/$(printf '프로젝트' | iconv -f UTF-8 -t UTF-8-MAC)"
mkdir -p "$NFD_DIR"
(
  cd "$NFD_DIR"
  git -c init.defaultBranch=main init -q --bare remote.git
  git clone -q remote.git blog 2> /dev/null
  cd blog
  git symbolic-ref HEAD refs/heads/main
  printf 'node_modules/\n' > .gitignore
  cp "$ROOT/shop-web/server.js" .
  git add -A
  git commit -qm 'init'
  git push -q -u origin main
  git remote set-head origin main
  # 끝난 워크트리인데(원격 브랜치가 지워짐) 그 안에서 서버가 아직 돈다 → 디스크 정리는 "사용 중"으로 봐야 한다.
  git worktree add -q ../blog-done -b feature/blog-done
  cd ../blog-done
  echo done > done.txt
  git add -A
  git commit -qm 'done'
  git push -q -u origin feature/blog-done
  git push -q origin --delete feature/blog-done
  git fetch -q --prune
  mkdir -p node_modules/pkg
  dd if=/dev/zero of=node_modules/pkg/blob bs=1048576 count=3 2> /dev/null
  echo "git 이 보는 워크트리:"
  git worktree list
  git config --get core.precomposeunicode || true
)
start server-nfd "$NFD_DIR/blog-done" node server.js 5176

for port in 5173 5174 5176; do
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

REAL_CLAUDE=$REAL_CLAUDE REAL_CODEX=$REAL_CODEX TERMINAL_AGENT_PID=$TERMINAL_AGENT_PID \
  ITERM_AGENT_PID=$ITERM_AGENT_PID NFD_DIR=$NFD_DIR \
  node - "$OUT" "$ROOT" <<'EOF'
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
  terminalAgent: { pid: Number(process.env.TERMINAL_AGENT_PID) || null },
  itermAgent: { pid: Number(process.env.ITERM_AGENT_PID) || null },
  // realpath 는 디스크에 저장된 이름(자소 분리형) 그대로 돌려준다.
  nfd: {
    pid: pid('server-nfd'),
    port: 5176,
    doneRoot: fs.realpathSync(`${process.env.NFD_DIR}/blog-done`)
  },
  realClaude: process.env.REAL_CLAUDE === 'yes',
  realCodex: process.env.REAL_CODEX === 'yes'
}
fs.writeFileSync(`${out}/fixtures.json`, JSON.stringify(fixtures, null, 2))
console.log(JSON.stringify(fixtures, null, 2))
EOF
