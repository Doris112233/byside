#!/usr/bin/env bash
# ============================================================
#  咫尺 · 板子版（RDK X5）一次性配置。在板子上跑一次，之后插电开机全自动。
#
#  和电脑版是同一份代码，只是换了跑的地方：
#    识别      systemd 服务 byside（python rdk/app.py --headless）
#    桌面界面  桌面会话里自启的浏览器，投影模式全屏
#    中继      云上的（--server），或者板子自己跑一个（--local-relay）
#
#  用法（在板子上）：
#    scripts/rdk-setup.sh --name 奶奶 --server wss://你的域名/ws
#    scripts/rdk-setup.sh --name 奶奶 --local-relay                 局域网自测
#    scripts/rdk-setup.sh --name 奶奶 --camera http://手机IP:8081/video ...
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME=""; USER_CODE=""; SERVER=""; CAMERA="0"; LOCAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2;;  --user) USER_CODE="$2"; shift 2;;
    --server) SERVER="$2"; shift 2;;  --camera) CAMERA="$2"; shift 2;;
    --local-relay) LOCAL=1; shift;;
    -h|--help) sed -n '2,16p' "$0"; exit 0;;
    *) echo "不认识的参数：$1"; exit 1;;
  esac
done
[ -n "$NAME" ] || { echo "要名字：--name 奶奶"; exit 1; }
[ -n "$SERVER" ] || [ "$LOCAL" = 1 ] || { echo "要中继：--server wss://你的域名/ws，或者 --local-relay"; exit 1; }

ID_FILE="$ROOT/.byside-id"
if [ -z "$USER_CODE" ] && [ -f "$ID_FILE" ]; then USER_CODE="$(cut -d' ' -f1 "$ID_FILE")"; fi
[ -n "$USER_CODE" ] || USER_CODE="$(python3 -c "import secrets;a='23456789ABCDEFGHJKMNPQRSTUVWXYZ';print(''.join(secrets.choice(a) for _ in range(6)))")"
USER_CODE="$(echo "$USER_CODE" | tr '[:lower:]' '[:upper:]')"
echo "$USER_CODE $NAME" > "$ID_FILE"

# ---------- 本地中继（可选） ----------
if [ "$LOCAL" = 1 ]; then
  command -v node >/dev/null || sudo apt-get install -y -q nodejs
  sudo tee /etc/systemd/system/byside-relay.service >/dev/null <<EOF
[Unit]
Description=BySide 中继（板子本地；正式部署应放云上）
After=network-online.target
[Service]
User=$USER
WorkingDirectory=$ROOT
Environment=HTTP_PORT=8778
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload; sudo systemctl enable --now byside-relay
  SERVER="ws://127.0.0.1:8778/ws"; WEB="http://127.0.0.1:8778"
else
  WEB="$(echo "$SERVER" | sed -e 's#^ws://#http://#' -e 's#^wss://#https://#' -e 's#/ws$##')"
fi

# ---------- 识别服务：无头，只做传感器 ----------
sudo tee /etc/byside.conf >/dev/null <<EOF
# 咫尺 · 板子配置。改完 sudo systemctl restart byside
BYSIDE_SOURCE=$CAMERA
BYSIDE_SERVER=$SERVER
BYSIDE_USER=$USER_CODE
EOF
sudo chmod 600 /etc/byside.conf
sudo tee /etc/systemd/system/byside.service >/dev/null <<EOF
[Unit]
Description=BySide 咫尺 识别（摄像头 → 棋子坐标 → 中继）
After=network-online.target
[Service]
Type=simple
User=$USER
EnvironmentFile=/etc/byside.conf
Environment=PYTHONUNBUFFERED=1
WorkingDirectory=$ROOT/rdk
ExecStart=/usr/bin/python3 app.py --headless --source \${BYSIDE_SOURCE} --server \${BYSIDE_SERVER} --user \${BYSIDE_USER}
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload; sudo systemctl enable --now byside

# ---------- 桌面界面：登录桌面后自动开浏览器，投影模式全屏 ----------
# ⚠️ 这一步没在 RDK 上实测过。Ubuntu 22.04 的 Chromium / Firefox 都是 snap 包，
#    在 RDK 上能不能装、跑不跑得动视频通话，要开机实测。
B="$(command -v chromium-browser || command -v chromium || command -v google-chrome || command -v firefox || true)"
URL="$WEB/app/?surface=table&user=$USER_CODE&name=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$NAME")"
mkdir -p "$HOME/.config/autostart"
if [ -n "$B" ]; then
  case "$B" in
    *firefox*) CMD="$B --kiosk \"$URL\"";;
    *) CMD="$B --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream \"$URL\"";;
  esac
  cat > "$HOME/.config/autostart/byside-table.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=咫尺 桌面界面
Exec=sh -c 'sleep 6; $CMD'
X-GNOME-Autostart-enabled=true
EOF
  echo "· 桌面界面会在登录后自动打开：$B"
else
  echo "⚠️ 没找到浏览器。先试：sudo apt install -y chromium-browser（22.04 上是 snap，可能不行）"
  echo "   装好后重跑本脚本。桌面界面地址：$URL"
fi

cat <<EOF

  ─────────────────────────────────────────────
   咫尺 · 板子版   我是 $NAME   好友码 $USER_CODE
  ─────────────────────────────────────────────
   识别服务：$(systemctl is-active byside)      中继：$SERVER
   标定页：http://$(hostname -I | awk '{print $1}'):8080/
   重启一次板子，桌面界面会自动全屏出现在投影上。
EOF
