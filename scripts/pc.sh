#!/usr/bin/env bash
# ============================================================
#  咫尺 · 电脑版：一台笔记本 + 一只朝下的摄像头 + 一台投影仪 = 一端
#
#  起三样东西：中继（node relay）、识别端（byside-sensor）、投影窗口（Chrome 打开 /app/?surface=table）
#
#  用法：
#    scripts/pc.sh --name 奶奶 --camera auto               第一次自动生成好友码；Mac 上按名字找影石
#    scripts/pc.sh --name 奶奶 --camera 0                  用自带摄像头
#    scripts/pc.sh --camera http://手机IP:8081/video        用手机当摄像头
#    scripts/pc.sh --server ws://甲的IP:8778/ws            不起本机中继，连另一台电脑的（同一 Wi-Fi）
#    scripts/pc.sh --server wss://你的域名/ws              连云上的
#    scripts/pc.sh --build                                  强制重新构建网页和中继
#
#  两台电脑同一个 Wi-Fi：甲先跑（它起中继，终端最后会打印乙要用的命令），乙带 --server 跑。
#  乙的浏览器会走 https://甲的IP:8443/app/ —— 不是 localhost 的页面必须 HTTPS 才能开摄像头，
#  甲那边要有 cert.pem/key.pem（README 里有一行 openssl 生成）。
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME=""; CAMERA=""; SERVER=""; PORT=8778; CTRL=8080; USER_CODE=""; BROWSER=1; BUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --name)   NAME="$2"; shift 2;;
    --camera) CAMERA="$2"; shift 2;;
    --server) SERVER="$2"; shift 2;;
    --user)   USER_CODE="$2"; shift 2;;
    --port)   PORT="$2"; shift 2;;
    --no-browser) BROWSER=0; shift;;
    --build)  BUILD=1; shift;;
    -h|--help) sed -n '2,17p' "$0"; exit 0;;
    *) echo "不认识的参数：$1"; exit 1;;
  esac
done

# ---------- 摄像头：要「朝下看桌子」的那只 ----------
if [ -z "$CAMERA" ]; then
  if [ "$(uname)" = Darwin ]; then CAMERA=1; CAM_NOTE="（默认用外接的 1 号；0 号是自带的）"; else CAMERA=0; CAM_NOTE=""; fi
fi
if [ "$CAMERA" = auto ]; then
  if [ "$(uname)" = Darwin ]; then
    # OpenCV 的索引顺序和 system_profiler 列出来的顺序一致
    CAMERA="$(system_profiler SPCameraDataType -json 2>/dev/null | python3 -c '
import json,sys,re
cams=[c.get("_name","") for c in json.load(sys.stdin).get("SPCameraDataType",[])]
hit=[i for i,n in enumerate(cams) if re.search(r"insta\s*360|影石|link", n, re.I)]
print(hit[0] if hit else 1)
print("  相机列表: "+" | ".join(f"{i}:{n}" for i,n in enumerate(cams)), file=sys.stderr)')"
    CAM_NOTE="（auto：按名字找到影石；不对就 --camera 0/1/2 换）"
  else CAMERA=0; CAM_NOTE="（auto 只在 Mac 上按名字找，Linux 用 0）"; fi
fi

# ---------- 身份：好友码存在本机，下次自动用 ----------
ID_FILE="$ROOT/.byside-id"
if [ -z "$USER_CODE" ] && [ -f "$ID_FILE" ]; then USER_CODE="$(cut -d' ' -f1 "$ID_FILE")"; [ -z "$NAME" ] && NAME="$(cut -d' ' -f2- "$ID_FILE")"; fi
if [ -z "$USER_CODE" ]; then
  USER_CODE="$(python3 -c "import secrets;a='23456789ABCDEFGHJKMNPQRSTUVWXYZ';print(''.join(secrets.choice(a) for _ in range(6)))")"
fi
USER_CODE="$(echo "$USER_CODE" | tr '[:lower:]' '[:upper:]')"
[ -n "$NAME" ] || { echo "第一次跑要告诉我名字：scripts/pc.sh --name 奶奶"; exit 1; }
echo "$USER_CODE $NAME" > "$ID_FILE"

# ---------- 依赖：node 工作区 + Python 包 ----------
command -v node >/dev/null || { echo "没装 node（≥ 20）。brew install node"; exit 1; }
if [ "$BUILD" = 1 ] || [ ! -d node_modules ] || [ ! -f web/dist/index.html ] || [ ! -f relay/dist/index.js ]; then
  echo "· 构建网页和中继（第一次要一两分钟）…"
  npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null
fi
PY="$ROOT/sensor/.venv/bin/python"
if [ ! -x "$PY" ] || [ "$BUILD" = 1 ]; then
  echo "· 建 Python 环境（装 opencv、numpy）…"
  python3 -m venv sensor/.venv && "$PY" -m pip install -q --upgrade pip && "$PY" -m pip install -q -e sensor
fi

PIDS=()
cleanup(){ trap - EXIT INT TERM; echo; echo "· 收工"; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# ---------- 中继 ----------
CHROME_EXTRA=""
if [ -z "$SERVER" ]; then
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "· 本机 $PORT 已经有中继在跑，直接用"
  else
    HTTP_PORT="$PORT" node relay/dist/index.js > /tmp/byside-relay.log 2>&1 & PIDS+=($!)
    sleep 1
    echo "· 中继已启动  http://localhost:$PORT   （日志 /tmp/byside-relay.log）"
  fi
  SERVER="ws://127.0.0.1:$PORT/ws"
  WEB="http://localhost:$PORT"
else
  WEB="$(echo "$SERVER" | sed -e 's#^ws://#http://#' -e 's#^wss://#https://#' -e 's#/ws$##')"
  # 连的是局域网里另一台电脑的明文中继：识别端走 ws 没问题，
  # 但浏览器页面不是 localhost 就必须 HTTPS 才给开摄像头/麦克风 —— 换到那台机器的 8443
  case "$WEB" in
    http://localhost*|http://127.0.0.1*) ;;
    http://*) WEB="https://$(echo "$WEB" | sed -e 's#^http://##' -e 's#:[0-9]*$##'):8443"; CHROME_EXTRA="--ignore-certificate-errors";;
  esac
fi

# ---------- 识别端（和板子上是同一个程序） ----------
"$ROOT/sensor/.venv/bin/byside-sensor" --source "$CAMERA" --server "$SERVER" --user "$USER_CODE" --port "$CTRL" \
  > /tmp/byside-sensor.log 2>&1 & PIDS+=($!)
echo "· 识别已启动  摄像头 $CAMERA ${CAM_NOTE:-}"
echo "             标定页 http://localhost:$CTRL/   （日志 /tmp/byside-sensor.log）"

# ---------- 投影窗口 ----------
Q="surface=table&user=$USER_CODE&name=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$NAME")"
URL="$WEB/app/?$Q"
[ "$BROWSER" = 1 ] && case "$(uname)" in
  Darwin)
    if [ -d "/Applications/Google Chrome.app" ]; then
      open -na "Google Chrome" --args --new-window --app="$URL" --autoplay-policy=no-user-gesture-required $CHROME_EXTRA
    else open "$URL"; fi;;
  Linux)
    B="$(command -v chromium-browser || command -v chromium || command -v google-chrome || echo xdg-open)"
    "$B" --app="$URL" $CHROME_EXTRA >/dev/null 2>&1 & ;;
  *) echo "用浏览器打开：$URL";;
esac
[ "$BROWSER" = 0 ] && echo "· 没开浏览器（--no-browser）。投影窗口：$URL"

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

  ─────────────────────────────────────────────
   咫尺 · 电脑版   我是 $NAME   好友码 $USER_CODE
  ─────────────────────────────────────────────
   1. 把刚打开的窗口拖到【投影仪那块屏】上，按 ⌃⌘F（Mac）或 F11 全屏
   2. 手机打开标定页，点「显示标定图」，桌上出现四个标记，认出后四个角自动对上，点「开始游戏」：
        http://$LAN_IP:$CTRL/
      （投影窗口里按 C 也能开关标定图）
   3. 键盘方向键 + 回车 + Esc 就是遥控器
   4. 把好友码 $USER_CODE 告诉家人$( [ -z "${SERVER##ws://127.0.0.1*}" ] && echo "
   5. 另一台电脑：scripts/pc.sh --name 名字 --camera auto --server ws://$LAN_IP:$PORT/ws" )

   Ctrl+C 结束
EOF
wait
