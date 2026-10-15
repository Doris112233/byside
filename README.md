# BySide 咫尺

两台可交互投影，连接两张异地的桌子。老人和孙辈在各自家中的桌面上看见对方的动作，
共同游戏、创作和分享。桌上移动的每一颗真棋子被摄像头认成坐标，经网络转发，
由对面的投影在同一位置还原。传的是位置，不是画面。

介绍页：https://doris112233.github.io/byside/ · 网页应用：https://doris112233.github.io/byside/app/

## 需要什么

**设备**（每一端）

- 一只朝下拍桌子的摄像头（影石 Insta360 Link、USB 摄像头，或手机当 IP 摄像头）
- 一台投影仪，投到桌面
- 跑识别端的机器：笔记本，或 RDK X5 板子
- 遥控器或键盘（投影界面用方向键和确定键操作）

未来形态是一体化吸顶设备：计算模块、三只广角摄像头、短焦投影和灯环装在一起。代码里采集、标定、
检测、投影面各是一层，换硬件只换对应那一层。

**技术**

| 模块 | 技术 |
|---|---|
| 网页（桌面界面、通话、场景） | TypeScript + Vite，无框架 |
| 中继（信令、坐标同步、在线状态） | Node.js + `ws`，TypeScript |
| 识别端（摄像头 → 棋子坐标） | Python 3.10+，OpenCV，numpy |
| 自动标定 | 投影 ArUco 标记，`cv2.aruco` 检测，单应变换 |
| 音视频 | 声网 Agora Web SDK（token 由中继签发）；原生 WebRTC 作备用 |
| 协议 | 一条 WebSocket，JSON 消息，见 `protocol/PROTOCOL.md` |

**环境**

- Node ≥ 22，Python ≥ 3.10，Chrome
- 网页必须在 `localhost` 或 HTTPS 下打开才能用摄像头和麦克风
- 声网账号（App ID 和证书）；没有也能跑，退回原生 WebRTC

## 目录

```
web/        网页：src/scenes 是各个玩法（下棋、折纸、聊天），加场景只改这一个目录
relay/      中继
sensor/     识别端 Python 包（byside_sensor）：capture 采集 · calib 标定 · detect 检测 · scenes 板端场景
protocol/   三端共用的常量和消息说明
scripts/    pc.sh 电脑版 · rdk-setup.sh 板子版 · server-setup.sh 云服务器
deploy/     systemd 单元和 Caddyfile 模板
docs/       介绍页（GitHub Pages）
```

## 开发

```bash
npm install                      # web + relay
npm run dev                      # 网页热更新，/ws 代理到本机中继
npm run relay                    # 中继（先 npm run build）
npm test && npm run typecheck

cd sensor && python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest                 # 含合成数据集的准确率门槛
.venv/bin/byside-sensor --source synth --server ws://127.0.0.1:8778/ws --user K7M2QX
```

## 部署

电脑版 `scripts/pc.sh --name 奶奶 --camera auto`；板子 `scripts/rdk-setup.sh`；云服务器 `scripts/server-setup.sh`。
`rdk` 分支是板子上验过的稳定版，开发都在 `main`。

## 许可

待定。
