#!/usr/bin/env bash
# 设置摄像头来源并重启服务。
#   ./setcam.sh 192.168.1.21:8081              # 无密码
#   ./setcam.sh 192.168.1.21:8081 用户名 密码   # 有密码
# 密码只落在板子本机的 /etc/byside.conf（权限 600），不会出现在别处。
set -eu
HOST="${1:?用法: ./setcam.sh 主机:端口 [用户名 密码]}"
HOST="${HOST#http://}"; HOST="${HOST%/}"
USER="${2:-}"; PASS="${3:-}"

if [ -n "$USER" ]; then AUTH="${USER}:${PASS}@"; else AUTH=""; fi
BASE="http://${AUTH}${HOST}"

echo "探测 ${HOST} ..."
FOUND=""
for p in /live /video /videofeed /stream /mjpeg /live.mjpg /video.mjpg /snapshot /shot.jpg; do
  CT=$(curl -s -m 4 -o /dev/null -w "%{content_type}" "${BASE}${p}" 2>/dev/null || true)
  CODE=$(curl -s -m 4 -o /dev/null -w "%{http_code}" "${BASE}${p}" 2>/dev/null || true)
  case "$CT" in
    *multipart*) echo "  ✓ $p  →  MJPEG 流"; FOUND="$p"; break ;;
    *image/jpeg*) echo "  ✓ $p  →  单帧 JPEG"; [ -z "$FOUND" ] && FOUND="$p" ;;
    *) echo "    $p  →  HTTP $CODE $CT" ;;
  esac
done

if [ -z "$FOUND" ]; then
  echo
  echo "没找到可用路径。检查：App 在前台？密码对不对？手机没锁屏？"
  exit 1
fi

echo
echo "选用: http://${HOST}${FOUND}"
sudo sed -i "s|^BYSIDE_SOURCE=.*|BYSIDE_SOURCE=${BASE}${FOUND}|" /etc/byside.conf
sudo chmod 600 /etc/byside.conf
sudo systemctl restart byside
sleep 6
echo "服务状态: $(systemctl is-active byside)"
curl -s -m 5 http://127.0.0.1:8080/state | python3 -c "
import json,sys
s=json.load(sys.stdin)
print(f\"相机帧率 {s['fps']:.1f} fps   识别耗时 {s['ms']:.0f} ms   温度 {s['temp']}C\")
print('✓ 摄像头接通了' if s['fps']>1 else '✗ 还没拿到帧，看 journalctl -u byside -n 20')
"
