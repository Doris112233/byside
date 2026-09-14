#!/usr/bin/env bash
# 扫本网段找 IP 摄像头，找到就写进配置并重启服务。
# 手机每次重连 Wi-Fi 都可能换 IP，mDNS 又被扩展器挡着，所以直接扫。
#   ./findcam.sh            用默认 admin:admin
#   ./findcam.sh 用户名 密码
set -u
USER="${1:-admin}"; PASS="${2:-admin}"
NET=$(ip -4 -br addr show wlan0 | awk '{print $3}' | cut -d/ -f1 | cut -d. -f1-3)
echo "扫 ${NET}.0/24 的 8081 端口 ..."

FOUND=""
for i in $(seq 2 254); do
  ( timeout 1 bash -c "cat < /dev/null > /dev/tcp/${NET}.${i}/8081" 2>/dev/null && echo "${NET}.${i}" ) &
done > /tmp/_cams.txt
wait
sort -u /tmp/_cams.txt -o /tmp/_cams.txt

while read -r ip; do
  [ -z "$ip" ] && continue
  CT=$(curl -s -m 5 -o /dev/null -w "%{content_type}" "http://${USER}:${PASS}@${ip}:8081/video" 2>/dev/null)
  case "$CT" in
    *multipart*) echo "  ✓ ${ip}:8081/video  →  MJPEG"; FOUND="$ip"; break ;;
    *) echo "    ${ip}:8081  →  ${CT:-无响应}" ;;
  esac
done < /tmp/_cams.txt

if [ -z "$FOUND" ]; then
  echo; echo "没找到。检查：App 在前台？没锁屏？跟板子同一个 Wi-Fi？"
  exit 1
fi

URL="http://${USER}:${PASS}@${FOUND}:8081/video"
sudo sed -i "s|^BYSIDE_SOURCE=.*|BYSIDE_SOURCE=${URL}|" /etc/byside.conf
sudo chmod 600 /etc/byside.conf
sudo systemctl restart byside
echo; echo "已切到 ${FOUND}，等服务起来 ..."
sleep 13
curl -s -m 8 http://127.0.0.1:8080/state | python3 -c "
import json,sys
s=json.load(sys.stdin)
print('  相机 %s' % s['cam'])
print('  %.1f fps | 识别 %.0f ms | 格距 %.1f px | 温度 %dC' % (s['fps'], s['ms'], s['cell'], s['temp']))
print('  ✓ 好了' if s['fps'] > 3 else '  ✗ 还有问题，看 journalctl -u byside -n 20')
"
