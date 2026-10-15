# 咫尺 消息协议

三端（网页 `web/`、中继 `relay/`、识别端 `sensor/`）之间只有一条 WebSocket，所有消息都是一行 JSON，
必有字段 `t`（类型）。常量在 [`constants.json`](constants.json)。

## 连接

```
ws(s)://<relay>/ws?user=<好友码>&kind=web|board&name=<名字>&room=<房间>&since=<序号>
```

- `user`：好友码，6 位，字母表见 `friend_code.alphabet`。一个人可以有多条连接（网页 + 板子）。
- `kind`：`web` 网页，`board` 识别端。点名消息只投给 `web`；`join{all:true}` 会把这个人的 `board` 一起搬进房间。
- `room`：不带时进 `u:<好友码>`（自己的房间）。会话房间叫 `s-<随机>`，由发起方生成。
- `since`：重连时带上收到的最后一个 `seq`，服务端补发之后的慢通路消息。
- 服务端给每条房间内消息打上 `seat`：网页是好友码，板子是 `好友码#board`。客户端据此过滤自己发的、区分自己的板子。

## 两条通路

| | 慢通路（可靠） | 快通路（转发即忘） |
|---|---|---|
| 哪些 | 不在 `fast` 集里的房间消息 | `constants.fast`：`frame ink ping pong cursor point icon calib` |
| 序号 | 服务端分配房间内递增 `seq` | 无 |
| 日志 | 进房间日志（最多 500 条），`state`/`reset` 变成快照并清日志（`role`、`game` 保留进快照） | 不记 |
| 断线 | `since` 补发 | 丢了就丢了 |

点名消息（带 `to`）不走房间：跨房间按好友码投递，不记日志，不重放。

## 服务端发出

| t | 字段 | 说明 |
|---|---|---|
| `_joined` | `room seat head peers replayed` | 进房间第一条。客户端据此清零 `lastSeq` 再收补发 |
| `_peers` | `n seats[]` | 房内人数变化 |
| `_undelivered` | `to of` | 点名消息没人收（对方不在线） |
| `presence` | `code online desk name busy` | 订阅的人状态变了。`desk` = 这个人的板子在线 |
| `rtctoken` | `channel appId token ttl` 或 `error` | 对 `rtctoken` 请求的回复。只签给在该会话房间里的人 |
| `pong` | | 对 `ping` 的回复 |

## 客户端 → 服务端

| t | 字段 | 说明 |
|---|---|---|
| `who` | `codes[]` | 订阅这些人的在线状态，立刻各回一条 `presence`，之后变化再推 |
| `join` | `room all?` | 换房间。`all` 时这个人的所有连接一起搬 |
| `busy` | `on` | 在通话中 / 结束 |
| `rtctoken` | `channel` | 要声网 token |
| `ping` | | 应用层心跳（服务端另有 WebSocket 层心跳 5s） |

## 人对人（带 `to`，服务端填 `from` 和 `name`）

| t | 字段 | 说明 |
|---|---|---|
| `friend` | | 我加了你，你也加上我 |
| `invite` | `game room` | 邀请。`room` 由发起方生成 |
| `accepting` | | 我点了接受，正在开摄像头（对方把 45s 倒计时换成 120s） |
| `accept` | `room` | 接受。发起方执黑（color 1），接受方执白（2） |
| `reject` | `busy?` | 拒绝 / 忙 |
| `cancel` | | 发起方不等了 |
| `hangup` | | 挂断 |
| `rtc` | `sdp` / `ice` / `fallback` | 原生 WebRTC 信令；`fallback:1` = 我从声网退回原生了，你也退 |

## 会话房间内

| t | 字段 | 发 | 收 | 通路 |
|---|---|---|---|---|
| `role` | `code color` | 网页进会话时 | 自己的板子：这局认什么色 | 慢（进快照） |
| `game` | `g` | 切换场景的一方 | 对方网页、两边板子 | 慢（进快照） |
| `move` | `i j c` | 网页（遥控器落子）或板子（识别到真棋子）。`c` 为 0 表示拿走 | 对方网页、对方板子 | 慢 |
| `undo` | | 网页 | 网页 | 慢 |
| `reset` | | 网页 | 网页、板子 | 慢（成为快照） |
| `state` | `moves[[i,j,c]] N` | 网页或板子，回答 `req` 或重连对账 | 所有人 | 慢（成为快照） |
| `req` | | 重连后想要全量 | 网页回 `state` | 慢 |
| `step` | `n` | 折纸翻页的一方 | 对方 | 慢 |
| `point` | `x y` | 折纸指一指 | 对方 | 快 |
| `icon` | `k` | 表情 | 对方 | 快 |
| `calib` | `code on` | 板子（标定页点了显示/关闭标定图） | **只有 `code` 等于自己好友码的网页**响应 | 快 |

## 已知限制

- 没有鉴权：知道好友码就能以这个人连上来。之后要加每人一把密钥。
- `rename`、`hello` 已删除；`frame`、`ink`、`cursor` 预留给画画和桌面画面，尚未使用。
