#!/usr/bin/env bash
# ============================================================
#  咫尺 · 云服务器一次性部署（Ubuntu 22.04 新机器）
#
#  装好：node（中继）+ Caddy（自动 HTTPS 证书，天然支持 WebSocket）
#  之后：https://你的域名/app/  就是桌面界面，wss://你的域名/ws 就是中继
#
#  开跑之前，在云服务商控制台做两件事：
#    1. 域名解析：加一条 A 记录，把域名指到这台服务器的公网 IP
#    2. 防火墙：放行 TCP 80 和 443（腾讯云轻量在「防火墙」页签里）
#  Caddy 申请证书要走 80/443，这两件没做证书就申请不下来。
#
#  用法（登录服务器后）：
#    curl -fsSL https://raw.githubusercontent.com/Doris112233/byside/claude/charming-wilbur-abc0c7/scripts/server-setup.sh -o setup.sh
#    sudo bash setup.sh --domain byside.你的域名.com
# ============================================================
set -euo pipefail
DOMAIN=""; BRANCH="claude/charming-wilbur-abc0c7"; DIR="/opt/byside"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    *) echo "不认识的参数：$1"; exit 1;;
  esac
done
[ -n "$DOMAIN" ] || { echo "要域名：--domain byside.example.com"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "要 root：sudo bash $0 --domain $DOMAIN"; exit 1; }

say(){ echo; echo "· $*"; }

say "检查域名解析"
MYIP="$(curl -fsS -4 --max-time 8 https://api.ipify.org || true)"
DNSIP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
echo "  本机公网 IP：${MYIP:-未知}    $DOMAIN 解析到：${DNSIP:-（还没解析）}"
if [ -n "$MYIP" ] && [ "$MYIP" != "$DNSIP" ]; then
  echo "  ⚠️ 域名还没指到这台机器。先去控制台加 A 记录，等几分钟生效再跑。"
  echo "     （继续装也行，但证书要等解析对了才申请得下来）"
fi

say "装 node 20 和 Caddy"
apt-get update -q
apt-get install -y -q git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -q nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi
echo "  node $(node -v)   caddy $(caddy version | cut -d' ' -f1)"

say "拉代码到 $DIR（分支 $BRANCH）"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else git clone -q -b "$BRANCH" https://github.com/Doris112233/byside "$DIR"; fi
id byside >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin byside
chown -R byside:byside "$DIR"

say "声网证书（只放在这台机器上，不进仓库）"
if [ -f "$DIR/agora.env" ]; then echo "  已有 $DIR/agora.env，保留"
else
  read -r -p "  声网 App ID（直接回车 = 不用声网，退回浏览器原生通话）：" AID </dev/tty || AID=""
  if [ -n "$AID" ]; then
    read -r -s -p "  App 证书（输入时不显示）：" ACERT </dev/tty; echo
    umask 077; printf 'AGORA_APP_ID=%s\nAGORA_APP_CERT=%s\n' "$AID" "$ACERT" > "$DIR/agora.env"
    chown byside:byside "$DIR/agora.env"; chmod 600 "$DIR/agora.env"
  fi
fi

say "中继：systemd 服务，只听本机，外面经 Caddy 进来"
cat > /etc/systemd/system/byside-relay.service <<EOF
[Unit]
Description=咫尺 中继
After=network-online.target
[Service]
User=byside
WorkingDirectory=$DIR
Environment=HTTP_PORT=8778
Environment=BIND=127.0.0.1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable -q --now byside-relay && systemctl restart byside-relay

say "Caddy：自动 HTTPS + WebSocket 反代"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:8778
}
EOF
systemctl enable -q caddy && systemctl reload caddy || systemctl restart caddy

say "等证书（第一次要十几秒）"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/app/" || true)"
  [ "$code" = 200 ] && break; sleep 3
done
cat <<EOF

  ─────────────────────────────────────────────
   咫尺 · 服务器   $([ "${code:-}" = 200 ] && echo "✓ 就绪" || echo "⚠️ HTTPS 还没通")
  ─────────────────────────────────────────────
   桌面界面   https://$DOMAIN/app/
   中继       wss://$DOMAIN/ws
   中继状态   $(systemctl is-active byside-relay)    Caddy $(systemctl is-active caddy)
   日志       journalctl -u byside-relay -f
$([ "${code:-}" = 200 ] || echo "
   HTTPS 没通的话，九成是这两件之一：
     · 域名 A 记录没指到 ${MYIP:-这台机器} ，或者还没生效
     · 控制台防火墙没放行 80 / 443
   看 Caddy 怎么说：journalctl -u caddy -n 30")
   更新代码：sudo bash $DIR/scripts/server-setup.sh --domain $DOMAIN
EOF
