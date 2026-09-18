#!/usr/bin/env bash
# ============================================================
#  咫尺 · 电脑版：一台笔记本 + 一个摄像头 + 一台投影仪 = 一端
#
#  和板子版是同一份代码，只是换了跑的地方：
#    中继      node server.js                    （本机，或者用云上的）
#    识别      python rdk/app.py --headless      （和板子上一模一样）
#    桌面界面  浏览器投影模式 app/?surface=table  （拖到投影仪那块屏上全屏）
#
#  用法：
#    scripts/pc.sh --name 奶奶                       第一次，自动生成好友码
#    scripts/pc.sh --name 奶奶 --camera 1            用第二个摄像头（0 通常是笔记本自带那个）
#    scripts/pc.sh --camera http://手机IP:8080/video 用手机当摄像头
#    scripts/pc.sh --server wss://你的域名/ws        不起本机中继，连云上的
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME=""; CAMERA=""; SERVER=""; PORT=8778; CTRL=8080; USER_CODE=""; BROWSER=1
while [ $# -gt 0 ]; do
  case "$1" in
    --name)   NAME="$2"; shift 2;;
    --camera) CAMERA="$2"; shift 2;;
    --server) SERVER="$2"; shift 2;;
    --user)   USER_CODE="$2"; shift 2;;
    --port)   PORT="$2"; shift 2;;
    --no-browser) BROWSER=0; shift;;
    -h|--help) sed -n '2,18p' "$0"; exit 0;;
    *) echo "不认识的参数：$1"; exit 1;;
  esac
done

# ---------- 摄像头 ----------
# 识别要的是「朝下看桌子」的那个。笔记本自带的摄像头朝着人脸 —— 它留给视频通话。
# Mac 上 0 几乎总是自带那个，所以默认用 1（第一个外接的）。不对就换 --camera 0 / 2 / 手机地址。
if [ -z "$CAMERA" ]; then
  if [ "$(uname)" = Darwin ]; then CAMERA=1; CAM_NOTE="（默认用外接的 1 号；0 号是笔记本自带那个、朝着你的脸，留给视频通话）"
  else CAMERA=0; CAM_NOTE=""; fi
fi

# ---------- 身份：好友码存在本机，下次自动用 ----------
ID_FILE="$ROOT/.byside-id"
if [ -z "$USER_CODE" ] && [ -f "$ID_FILE" ]; then USER_CODE="$(cut -d' ' -f1 "$ID_FILE")"; [ -z "$NAME" ] && NAME="$(cut -d' ' -f2- "$ID_FILE")"; fi
if [ -z "$USER_CODE" ]; then
  USER_CODE="$(python3 -c "import secrets;a='23456789ABCDEFGHJKMNPQRSTUVWXYZ';print(''.join(secrets.choice(a) for _ in range(6)))")"
fi
USER_CODE="$(echo "$USER_CODE" | tr '[:lower:]' '[:upper:]')"
if [ -z "$NAME" ]; then echo "第一次跑要告诉我名字：scripts/pc.sh --name 奶奶"; exit 1; fi
echo "$USER_CODE $NAME" > "$ID_FILE"

# ---------- Python 环境 ----------
PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "· 第一次运行，建 Python 环境（装 opencv、numpy）…"
  python3 -m venv "$ROOT/.venv" && "$ROOT/.venv/bin/pip" install -q --upgrade pip && "$ROOT/.venv/bin/pip" install -q opencv-python numpy
fi

PIDS=()
cleanup(){ echo; echo "· 收工"; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# ---------- 中继 ----------
if [ -z "$SERVER" ]; then
  command -v node >/dev/null || { echo "没装 node。装一个（brew install node），或者用 --server 连云上的中继"; exit 1; }
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "· 本机 $PORT 已经有中继在跑，直接用"
  else
    HTTP_PORT="$PORT" node server.js > /tmp/byside-relay.log 2>&1 & PIDS+=($!)
    sleep 1
    echo "· 中继已启动  http://localhost:$PORT   （日志 /tmp/byside-relay.log）"
  fi
  SERVER="ws://127.0.0.1:$PORT/ws"
  WEB="http://localhost:$PORT"
else
  WEB="$(echo "$SERVER" | sed -e 's#^ws://#http://#' -e 's#^wss://#https://#' -e 's#/ws$##')"
fi

# ---------- 识别（和板子上是同一个程序） ----------
"$PY" rdk/app.py --headless --source "$CAMERA" --server "$SERVER" --user "$USER_CODE" --port "$CTRL" \
  > /tmp/byside-sensor.log 2>&1 & PIDS+=($!)
echo "· 识别已启动  摄像头 $CAMERA ${CAM_NOTE:-}"
echo "             标定页 http://localhost:$CTRL/   （日志 /tmp/byside-sensor.log）"

# ---------- 桌面界面：浏览器投影模式 ----------
Q="surface=table&user=$USER_CODE&name=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$NAME")"
URL="$WEB/app/?$Q"
[ "$BROWSER" = 1 ] && case "$(uname)" in
  Darwin)
    if [ -d "/Applications/Google Chrome.app" ]; then
      open -na "Google Chrome" --args --new-window --app="$URL" --autoplay-policy=no-user-gesture-required
    else open "$URL"; fi;;
  Linux)
    (command -v chromium-browser || command -v chromium || command -v google-chrome || echo xdg-open) >/dev/null
    B="$(command -v chromium-browser || command -v chromium || command -v google-chrome || echo xdg-open)"
    "$B" --app="$URL" >/dev/null 2>&1 & ;;
  *) echo "用浏览器打开：$URL";;
esac
[ "$BROWSER" = 0 ] && echo "· 没开浏览器（--no-browser）。桌面界面：$URL"

cat <<EOF

  ─────────────────────────────────────────────
   咫尺 · 电脑版   我是 $NAME   好友码 $USER_CODE
  ─────────────────────────────────────────────
   1. 把刚打开的窗口拖到【投影仪那块屏】上，按 ⌃⌘F（Mac）或 F11 全屏
   2. 手机或另一台电脑打开标定页，拖四个角对准投影出来的棋盘：
        http://$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'):$CTRL/
   3. 键盘方向键 + 回车 + Esc 就是遥控器
   4. 把好友码 $USER_CODE 告诉家人

   Ctrl+C 结束
EOF
wait
