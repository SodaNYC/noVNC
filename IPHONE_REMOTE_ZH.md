# noVNC iPhone 远程控制版中文说明

本分支是在官方 **noVNC v1.7.0** 基础上，为“iPhone 远程控制 macOS”这一固定场景做的定制。

当前分支：

```text
iphone-custom-v1.7
```

主要目标：

- iPhone 上更自然地缩放、拖动、滚动 Mac 桌面
- 增加 macOS Space / 全屏手势
- 断线后在当前页面生命周期内自动复用用户名和密码重新认证
- 优化 iPhone Chrome / iOS 密码自动填充和 Face ID 使用
- 提供 iPhone ↔ Mac 双向文字剪贴板
- 绕过 Apple Screen Sharing 与 noVNC 标准剪贴板兼容问题
- 通过独立 tsnet gateway 提供 Tailscale HTTPS 入口
- 保持改动尽量集中，方便以后从新的官方 noVNC tag 迁移

---

## 1. 整体架构

```text
iPhone Safari / Chrome
        │
        │ HTTPS / WSS
        ▼
Shadowrocket 内置 Tailscale
        │
        ▼
novnc-gateway.<tailnet>.ts.net:443
        │
        │ tsnet + HTTPS reverse proxy
        ▼
http://127.0.0.1:6080
        │
        ▼
noVNC / websockify
        │
        ▼
localhost:5900
        │
        ▼
macOS Screen Sharing
```

gateway 是单独的私有仓库：

```text
SodaNYC/novnc-tsnet-gateway
```

noVNC 本身不保存 Tailscale Auth Key、证书私钥或 tsnet 身份文件。

**不要删除：**

```text
~/.novnc-tsnet-gateway
```

这是 gateway 的 tsnet 身份和状态目录。

---

## 2. 相比官方 noVNC v1.7.0 做了哪些改造

### 2.1 双指捏合改为本地连续缩放

官方 noVNC 的 pinch 手势会转换成远端 `Ctrl + 滚轮`。

本分支改成：

```text
双指捏合
→ 只缩放本地 noVNC Canvas / viewport
→ 不向 Mac 发送 Ctrl+滚轮
```

特点：

- 连续缩放，不是一级一级跳
- 最小缩放到“完整桌面刚好适配屏幕”
- 最大缩放为 1:1
- 尽量保持双指中心对应的远端位置不漂移
- 放大后自动允许拖动画面
- iPhone 横竖屏切换、浏览器尺寸变化后会保留当前手动缩放比例

相关实现集中在：

```text
core/rfb.js
```

---

### 2.2 放大后的单指拖动画面加速

新增：

```js
VIEWPORT_DRAG_SENS = 2.2
```

在 viewport 已放大的情况下，单指拖动画面时会将位移乘以 2.2，使 iPhone 上移动大桌面更省手。

注意：

- 没有进入 viewport drag 状态时，单指仍用于正常远端鼠标操作
- 该参数是按当前 iPhone 实机手感调出来的，不建议无理由继续调大

---

### 2.3 双指上下滚动灵敏度提高

官方：

```js
GESTURE_SCRLSENS = 50
```

当前：

```js
GESTURE_SCRLSENS = 2
```

因此双指上下滑动会更快地产生远端滚轮事件，适合手机触屏。

---

### 2.4 双指左右滑切换 macOS Space / 全屏桌面

双指横向滑动不再发送水平滚轮，而是发送 macOS 快捷键：

```text
双指向左滑
→ Control + Right Arrow
→ 切换到右侧 Space / 全屏应用

双指向右滑
→ Control + Left Arrow
→ 切换到左侧 Space / 全屏应用
```

当前识别参数：

```js
SPACE_SWIPE_THRESHOLD = 90
SPACE_SWIPE_AXIS_RATIO = 1.4
```

含义：

- 横向累计移动约 90px 后才触发
- 必须明显更像横滑而不是竖滑
- 每次双指手势最多触发一次 Space 切换

这样可以减少和“双指上下滚动”的冲突。

---

### 2.5 三指轻点切换当前 Mac 应用全屏

官方 noVNC 的三指轻点对应中键点击。

本分支改为：

```text
三指轻点
→ Control + Command + F
→ 当前 macOS 应用进入 / 退出全屏
```

因此当前版本不再保留“三指轻点 = 中键”的行为。

---

### 2.6 双向文字剪贴板：iPhone ↔ Mac

Apple Screen Sharing 在当前环境里无法可靠使用 noVNC 的标准 `ClientCutText` / `ServerCutText` 剪贴板方案。

因此本分支绕开 Apple VNC clipboard，实现了自己的双向文字剪贴板。

#### iPhone → Mac

```text
iPhone 文本
→ noVNC Clipboard 面板
→ HTTPS POST /api/paste
→ tsnet gateway
→ /usr/bin/pbcopy
→ macOS pasteboard
→ noVNC 自动发送 Command + V
→ 粘贴到当前远端输入位置
```

Paste 成功后，手机页面中的 textarea 会立即清空，避免敏感文本继续留在输入框里。

#### Mac → iPhone

当 VNC 已连接时，noVNC 会建立：

```text
GET /api/clipboard/events
```

的 Server-Sent Events（SSE）连接。

gateway 只在这个 SSE 客户端存在时读取 macOS pasteboard：

```text
Mac Command + C
→ gateway 每 400 ms 检查一次 /usr/bin/pbpaste
→ 检测到变化
→ SSE 立即推送最新文字给 noVNC 页面
→ Clipboard 图标高亮
→ iPhone 点一次 “Copy Mac Clipboard to iPhone”
→ navigator.clipboard.writeText(...)
→ 写入 iPhone 系统剪贴板
```

通常从 Mac 复制到 iPhone 页面收到提示的延迟约为 **0～0.4 秒 + 网络延迟**。

iOS/WebKit 不允许网页在没有用户操作时静默改写系统剪贴板，所以最后一步必须由用户点一次按钮。这是浏览器安全限制，不是 noVNC 或 Tailscale 的限制。

隐私设计：

- 只处理文字
- 单条上限 64 KiB
- 不保存剪贴板历史
- 不写入磁盘
- 不打印剪贴板正文到日志
- noVNC 断开时关闭 SSE，并清掉页面内存中的 Mac 剪贴板
- gateway 在执行 iPhone → Mac 的 `pbcopy` 前会建立 3 秒短期 echo window，避免并发检测把同一段文字误报成新的 “Mac copied” 通知
- SSE 使用 `Cache-Control: no-store`
- 浏览器的 cross-site / cross-origin SSE 请求会被拒绝；真正的网络访问边界仍然是 tailnet / ACL

---

### 2.7 临时调试 / Turbo Refresh 已全部移除

开发过程中曾经加入过：

- 顶部 debug overlay
- ENC 编码显示
- FBU fps 统计
- Turbo Refresh / 高频 framebuffer 请求

最终版本已经全部删除。

原因是 Apple Screen Sharing 实际 framebuffer 更新速度有限，强制堆积 update request 反而会造成卡顿，并影响双指滚动响应。

当前保持官方 noVNC 的 framebuffer 请求机制。


---

### 2.8 自动重连时复用当前页面内存中的登录凭据

Apple Screen Sharing 使用的 ARD 认证要求同时提供：

```text
username
password
```

官方 noVNC 每建立一个新的 RFB 连接都需要重新完成认证。此前本分支只缓存了 password，导致自动重连时缺少 username，服务器再次弹出 Credentials 对话框。

当前改为：

```text
第一次手动登录成功
→ username + password 保存到当前网页的 JavaScript 内存
→ WebSocket / RFB 意外断开
→ 等待 reconnect delay
→ 创建新的 RFB 连接
→ 自动重新提交 username + password
```

这些凭据只存在于当前页面内存中：

- 不写入 Git 仓库
- 不写入 gateway
- 不写入 URL
- 本定制代码不会主动写入 localStorage

如果 iOS 杀掉页面、手动刷新页面、关闭 Chrome/Safari 或手机重启，内存凭据就会消失，下一次仍需重新认证一次。

这时建议通过 iPhone 的密码管理器 + Face ID 自动填充，而不是把 Mac 密码硬编码进 noVNC。

当前定制分支的新配置默认值：

```text
Automatic reconnect = ON
Reconnect delay = 3000 ms
```

浏览器已经保存过旧设置时，旧值会优先保留，因此升级后第一次测试请在 Settings 中确认一次。

相比 1000 ms，它给蜂窝网络、Shadowrocket 和 Tailscale 更多恢复时间；相比原版默认 5000 ms，回到远控页面后的等待感更低。

---

### 2.9 登录框针对 iPhone 密码自动填充优化

Credentials 表单现在使用标准浏览器字段提示：

```html
autocomplete="username"
autocomplete="current-password"
```

因此 Chrome / iOS 密码自动填充更容易识别这是用户名和密码登录表单。

推荐体验：

```text
页面首次打开或被 iOS 重载
→ Chrome / iOS 密码自动填充
→ Face ID
→ 登录一次

之后只是 WebSocket / RFB 断线
→ noVNC 自动重新认证
→ 不再人工输入用户名密码
```

注意：是否弹出 Face ID、使用 Google Password Manager 还是 Apple 密码，取决于 iPhone 自己的“自动填充与密码”设置。

---

## 3. iPhone 手势操作表

| iPhone 操作 | 远端行为 |
| --- | --- |
| 单指轻点 | Mac 左键点击 |
| 单指快速轻点两次 | Mac 左键双击；可打开桌面项目，或触发 macOS 的标题栏双击动作 |
| 两指轻点 | Mac 右键点击 |
| 单指拖动 | 正常鼠标左键按住拖动；放大 viewport 后默认用于移动桌面，可用工具栏 Drag/Pan 按钮切换为左键拖动模式 |
| 双指上下滑 | Mac 滚轮上下滚动 |
| 双指向左滑 | 切到右侧 Space / 全屏应用 |
| 双指向右滑 | 切到左侧 Space / 全屏应用 |
| 双指捏合 | noVNC 本地连续缩放 |
| 三指轻点 | 当前 Mac 应用进入 / 退出全屏 |
| 长按 | 保留 noVNC 原有长按行为 |

### 双指横滑与上下滚动的区别

开始双指移动后，noVNC 会先判断主要方向：

```text
明显横向
→ 锁定为 Space swipe

明显纵向
→ 锁定为普通滚动
```

一次手势确定方向后，中途不会在“滚动”和“切 Space”之间反复切换。

### iPhone 切出 / 返回时的自动恢复

iOS / iPadOS 会主动冻结甚至回收后台网页。为了避免 Safari / Chrome 在后台继续保留大块 VNC framebuffer、WebSocket 和剪贴板 SSE 连接，当前版本会主动管理页面生命周期：

```text
切出 noVNC
→ 暂停普通 reconnect timer
→ 关闭 Mac Clipboard EventSource
→ 对旧 RFB 做同步 hard dispose
→ 立即把可见 canvas + 隐藏 framebuffer 都缩到 0×0
→ 释放 WebSocket 4 MiB 接收队列并切断浏览器回调链
→ 当前页面不再等待 WebSocket close event

重新回到 noVNC
→ 立即使用当前会话保存的认证信息创建全新的 RFB
→ 重启 Mac Clipboard EventSource
→ 回到当前 iPhone 的 fit-to-screen 视图
```

因此短时间切换到其他 App 后再回来，不再依赖一个已经被 WebKit 冻结的旧 WebSocket。此前第一版 suspend 仍然要等待 WebSocket close event 才释放 UI 里的旧 RFB 引用；iOS 如果先冻结事件循环，完整 framebuffer 仍可能留在内存里。当前版本改为同步 hard dispose，不再等待 close event。若系统在 JavaScript 获得 pagehide / visibilitychange 机会之前就直接终止整个 WebContent 进程，浏览器仍只能重新加载页面，但这一路径已经把我们能主动释放的主要内存都提前释放。

### 启动时默认显示整个桌面

iPhone 每次重新进入 noVNC 时，当前页面会先使用 **Local scaling / fit-to-screen**，而不是直接进入 Left Drag 或 Pan：

```text
进入 noVNC
→ 整个 Mac 桌面缩放到 iPhone 当前可视区域
→ 左侧模式按钮显示置灰的普通箭头
→ 当前是 Normal pointer mode
```

这个启动行为只覆盖当前 iPhone 页面会话，不会改写其他浏览器保存的 noVNC 设置。之后 Pinch 放大并产生可平移区域时，才会按现有逻辑进入 **Viewport pan mode**。

### 指针 / Viewport Pan / Left Drag 三种图标状态

左侧同一个模式按钮会根据当前状态动态切换图标，避免只靠“选中 / 未选中”判断：

| 图标状态 | 当前模式 | 单指拖动行为 |
| --- | --- | --- |
| 箭头 | Normal pointer mode | 普通鼠标操作；当前画面不需要 viewport 平移 |
| 手掌 | Viewport pan mode | 移动放大后的 viewport |
| 鼠标左键按下 + 拖动箭头 | Left mouse drag mode | 向 Mac 发送真正的左键按住拖动 |

Pinch 放大并产生可平移区域后，默认进入 **Viewport pan mode**，按钮显示白色手掌并使用现有 noVNC 选中样式。

需要在放大画面下拖文件、拖窗口或框选文字时：

```text
点一下手掌图标
→ 图标切换为 Left Drag
→ 提示 Left mouse drag mode
→ 单指按住并拖动
→ Mac 收到左键按下 + 移动 + 松开
```

再点一次会切回 **Viewport pan mode**。当画面恢复为无需平移的普通状态时，按钮显示箭头，并回到 **Normal pointer mode**。

### 双击

当前代码已经支持触屏双击，不需要额外的双击按钮：

```text
在同一目标上快速单指轻点两次
→ Mac 收到两次左键点击
→ macOS 将其识别为双击
```

为了提高 iPhone 上的命中率，连续轻点在约 1 秒内且位置相差不超过约 50 px 时，后续点击会固定到第一次点击的位置。

这可以用于：

- 双击桌面上的应用、文件或文件夹
- Finder 中双击项目
- 双击窗口标题栏；具体是“缩放”还是“最小化”取决于 macOS 的标题栏双击设置

### Extra keys：Mac 精简布局

为了兼顾常用编辑操作和少数需要 modifier 的场景，Extra keys 现在保留三个独立 modifier：

```text
Control (⌃)
Option (⌥)
Command (⌘)
```

三者都可以单独切换为按住 / 释放状态。针对当前 Apple Screen Sharing / macOS VNC 行为，**Control 和 Option 都使用 keysym-only 路径**，避免走容易被 macOS 错误映射的 XT scancode：Control 发送 `XK_Control_L`，Option 发送 `XK_Meta_L`；Command 继续使用 `XK_Super_L`。原来的 **Ctrl+Alt+Del（三个方块）** 快捷按钮已经移除，因为在当前 Mac 远控场景里基本用不到。

面板里的常用按键与编辑操作继续提供独立图标：

```text
Tab
Esc
Return / Enter
Backspace
Select All
Copy
Paste
```

Control、Option、Command、Return、Backspace、Select All、Copy、Paste 都使用 25×25 SVG 画布，并统一围绕 **12.5 / 12.5** 做视觉居中；自定义图标控制在约 **18px 最大视觉跨度**，并统一使用 2px 圆角线条风格。Control / Option 因符号本身较扁，实际高度自然较小，但不会人为拉伸变形。

### 回车 / Return

Extra keys 中新增 **Return / Enter** 图标（弯折回车箭头），点击后直接向远端 Mac 发送标准回车键：

```text
Return / Enter
→ XK_Return
→ DOM code: Enter
```

可用于提交输入框、执行终端命令、确认对话框，以及任何正常响应 macOS Return / Enter 键的界面。图标使用与其他自定义按钮相同的 25×25 画布、2px 圆角线条，并按 18px 最大视觉跨度居中。

### 退格 / Backspace

**Backspace** 位于同一个 Extra keys 面板中，紧跟在 Return 后面，图标为“向左删除键轮廓 + X”，点击后向远端 Mac 发送标准退格键：

```text
Backspace
→ XK_BackSpace
→ DOM code: Backspace
```

用于删除光标左侧字符，也适用于 Finder、表单以及正常响应 macOS Delete / Backspace 的应用。图标同样使用 25×25 SVG 画布、2px 圆角线条，并围绕 12.5 / 12.5 做视觉居中，与 Command、Return、Select All 等图标保持一致。

### 全选

打开左侧工具栏的 **Extra keys**，点击 **Select All** 图标（四角选择框 + A）：

```text
Select All
→ Command + A
→ 对当前 Mac 前台应用执行全选
```

适用于文本、Finder 文件列表以及支持 macOS 标准 `Command + A` 的应用。

### 复制

同一个 **Extra keys** 面板里还有 **Copy** 图标（两张重叠页面）：

```text
Copy
→ Command + C
→ 复制当前 Mac 前台应用中已经选中的内容
```

在文本、Finder 文件列表以及支持 macOS 标准 `Command + C` 的应用中都可以使用。复制成功后，Mac 系统剪贴板会更新；当前 gateway 的 Mac → iPhone 剪贴板监听会继续按既有逻辑检测这次更新并提示。

### 粘贴

**Paste** 图标使用“剪贴板 + 向下箭头”，点击后直接向远端 Mac 发送：

```text
Paste
→ Command + V
→ 把 Mac 当前剪贴板内容粘贴到当前焦点位置
```

它和 **Clipboard** 面板用途不同：

- **Paste 图标**：只是远程快捷键 `Command + V`，适合已经在 Mac 剪贴板里的内容。
- **Clipboard 面板**：负责 iPhone ↔ Mac 的跨端文字传递。

典型组合：

```text
Select All → Copy
Command + A → Command + C

切换到目标位置
Paste
→ Command + V
```

也可以先用 Clipboard 面板把 iPhone 文字送入 Mac 剪贴板，再点 **Paste** 图标直接粘贴。

---

## 4. 双向剪贴板怎么用

### 4.1 iPhone → Mac

1. 先在远端 Mac 上点击要输入文字的文本框，让它获得焦点。
2. 打开 noVNC 左侧工具栏。
3. 点击 **Clipboard**。
4. 在 “iPhone → Mac” 文本框中使用 iOS 原生“粘贴”。
5. 点击 **Paste to Mac**。
6. gateway 会把内容写入 Mac 系统剪贴板，然后 noVNC 自动发送 `Command + V`。

支持中文、英文、多行文本、引号、shell 特殊字符和代码片段。

gateway 不通过 shell 处理文本，所以类似：

```text
$HOME
;
&&
|
`command`
```

不会被当作 shell 命令执行。

### 4.2 Mac → iPhone

1. 保持 noVNC 已连接。
2. 在 Mac 远端桌面里正常按 `Command + C`。
3. 最迟通常约 0.4 秒后，noVNC 的 Clipboard 图标会高亮，并提示 **Mac clipboard updated**。
4. 打开 **Clipboard**。
5. 点击 **Copy Mac Clipboard to iPhone**。
6. iOS 允许网页写入剪贴板后，该文字已经进入 iPhone 系统剪贴板，可以切到微信、备忘录、Chrome 等 App 直接粘贴。

第一次打开连接时，如果 Mac clipboard 本来就有文字，面板会显示 “Mac clipboard ready”，但不会把旧内容当成一次新的复制操作弹提示。

如果 Mac 复制的是图片、文件或其他非文字类型，`pbpaste` 没有可用文字时按钮会保持不可用。

当前双向文字限制均为 **64 KiB**。

---

## 5. 启动方法

### 5.1 macOS Screen Sharing

先确保 macOS 的“屏幕共享”已经开启，并且本机 VNC 服务可通过：

```text
localhost:5900
```

访问。

---

### 5.2 启动 noVNC

```bash
cd ~/noVNC
git switch iphone-custom-v1.7
./utils/novnc_proxy --vnc localhost:5900 --listen 127.0.0.1:6080
```

这里故意监听：

```text
127.0.0.1:6080
```

不直接暴露到局域网。

---

### 5.3 启动 tsnet gateway

日常长期运行推荐先编译，再启动固定二进制：

```bash
cd ~/novnc-tsnet-gateway
go build -trimpath -o novnc-gateway .
./novnc-gateway
```

`go run .` 更适合开发调试；长期使用优先运行编译后的 `./novnc-gateway`。如果以后配置 LaunchAgent，也应让它启动这个编译后的二进制。

gateway 会：

```text
Tailscale HTTPS :443
→ reverse proxy 到 127.0.0.1:6080
```

并提供：

```text
POST /api/paste
GET  /api/clipboard/events
```

分别用于：

```text
iPhone → Mac：pbcopy + Command+V
Mac → iPhone：pbpaste 变化检测 + SSE 推送
```

---

### 5.4 iPhone 访问

必须使用完整的 Tailscale HTTPS 域名：

```text
https://novnc-gateway.<你的-tailnet>.ts.net/
```

不要使用：

```text
https://100.x.x.x/
https://novnc-gateway/
```

因为 TLS 证书签发给完整的 `.ts.net` FQDN。

---

## 6. Tailscale / Shadowrocket 注意事项

iPhone 和 iMac 都需要进入同一个 tailnet。

Shadowrocket 需要确保 Tailscale 地址走内置 Tailscale tunnel，例如：

```text
DOMAIN-SUFFIX,ts.net,TAILSCALE
IP-CIDR,100.64.0.0/10,TAILSCALE,no-resolve
IP-CIDR6,fd7a:115c:a1e0::/48,TAILSCALE,no-resolve
```

不要让 `100.64.0.0/10` 被更高优先级的 DIRECT / excluded route 抢走。

gateway 的 tsnet 机器是 tailnet 中一个独立设备：

```text
novnc-gateway
```

不要启用 Funnel。

---

## 7. 当前已知限制

### iOS 后台挂起

Safari / Chrome 切到后台后，iOS 可能暂停 WebSocket。

如果页面本身仍在内存中，本分支会在断线后自动重新建立 RFB 连接，并复用当前页面内存中的 username + password 完成 ARD 认证，通常不再需要人工输入。

如果 iOS 已经把整个网页进程杀掉、页面被刷新或浏览器被关闭，则内存凭据会丢失，需要再次通过密码管理器 / Face ID 填一次。

另外，如果 Mac 本身进入锁屏，远程桌面中仍可能需要解锁 macOS；这和 VNC 连接认证是两件事。

这是 iOS 生命周期限制，前端无法完全消除。

Mac → iPhone 剪贴板的 SSE 也会受到相同的 iOS 后台挂起限制；回到前台后 EventSource 会自动尝试恢复。由于 iOS 禁止网页无用户手势写入系统剪贴板，即使 SSE 已收到新文本，仍需点一次 **Copy Mac Clipboard to iPhone**。

---

### Latency Debug：定位延迟在哪一层

本分支提供一个默认关闭的两阶段延迟诊断模式。正常访问时不会做逐 FBU / 逐矩形统计。

在 noVNC URL 后增加：

```text
?latency_debug=1
```

如果原 URL 已经有查询参数，则追加：

```text
&latency_debug=1
```

每次开始一次测试后，诊断窗口固定观察 **2 秒**。这 2 秒内后续按键 / 滚轮事件不会重新开始计时，因此可以完整观察窗口动画、Finder 更新和连续滚动。2 秒结束后，再进行下一次独立测试。

连接成功后，页面右上角会显示类似：

```text
Latency pointer
FB 2560×1440
first FBU    42.1 ms
payload wait 101.2 ms
decode CPU    17.5 ms
display        6.3 ms
present      10.5 ms
total       177.6 ms
FBU 2s      17 (8.5/s)
max gap     241.0 ms
WS rx       8.72 MiB
enc         ZRLE×31 Zlib×4
```

各指标含义：

- `FB`：当前 VNC framebuffer 的真实像素尺寸。它比 iPhone 上缩放后的 CSS 显示尺寸更重要，因为 Mac VNC Server 实际需要处理的是这个 framebuffer。
- `first FBU`：从 noVNC 发送鼠标按下 / 按键，到收到第一组 FramebufferUpdate 头部的时间。这里包含输入上行、Mac 响应以及第一批 VNC 更新开始返回的时间。
- `payload wait`：第一组 FBU 头部出现后，扣除实际 decoder 同步执行时间后剩余的等待时间。它主要反映等待后续 WebSocket / RFB payload 到达，但也包含少量 FBU/矩形头解析等没有单独计时的开销，因此是**近似的网络/服务器发送等待时间**。
- `decode CPU`：第一组 FBU 内所有数据矩形调用 noVNC decoder 时，同步 JavaScript 执行时间的累计值。当前 Apple Screen Sharing 如果使用 ZRLE，这一项主要反映 ZRLE 解码和像素展开的前端 CPU 成本。
- `display`：第一组 FBU 数据处理完成后，到 noVNC Display 渲染队列清空的时间。
- `present`：Display 队列完成后，到浏览器下一次 `requestAnimationFrame` 的时间，用于观察 Safari 最终呈现调度是否明显阻塞。
- `total`：从输入发送到第一组相关画面准备呈现的总时间。
- `FBU 2s`：这次输入后的 2 秒观察窗内收到多少组 FramebufferUpdate，以及平均每秒多少组。这里是 **FBU/s，不等同于视频意义上的真实 FPS**。
- `max gap`：2 秒内相邻两组 FBU 头部之间最大的间隔。数值很大时，说明更新流中存在明显停顿。
- `WS rx`：2 秒内 WebSocket 从服务器收到的总字节量。它包含少量 RFB 控制消息，但远程桌面活动时绝大多数通常是 framebuffer 数据，可用于比较不同场景的数据压力。
- `enc`：2 秒内实际 framebuffer 矩形使用的主要编码及矩形次数，例如 `ZRLE×31 Zlib×4`。

推荐逐项测试，每项之间必须等右上角 2 秒统计完成：

```text
A. TextEdit 输入一个 a，然后 2 秒不要操作
B. TextEdit 点一次 Backspace，然后 2 秒不要操作
C. TextEdit 点一次 Return，然后 2 秒不要操作
D. Finder 单击一个文件，然后 2 秒不要操作
E. Finder 点黄色最小化，然后 2 秒不要再操作
F. Finder 点绿色全屏，然后 2 秒不要再操作
G. Finder / Safari 开始连续滚动约 1.5 秒，然后停下
```

E / F / G 是新版诊断最重要的场景。旧版只看第一帧，无法反映最小化动画或滚动过程中后续 framebuffer update 是否持续卡顿；新版会把后续 2 秒一起统计。

测试结束后删除 `latency_debug=1` 即恢复正常模式。

---

### macOS VNC 动态画面帧率有限

当前 Apple Screen Sharing 实测主要使用：

```text
Zlib
ZRLE
```

快速滚动、大面积变化时，Apple VNC Server 本身可能只有较低的 framebuffer update 速度。

因此：

- 不做强制 30/60/120Hz 刷新
- 不再使用 Turbo Refresh
- JPEG quality 对当前 Apple VNC 路径基本不起作用
- compression 参数目前也没有观察到明显收益

---

### 没有隐私幕

远程操作的是 Mac 当前真实 console。

远端操作可能让物理显示器亮起，本方案没有类似商业远控软件的 privacy curtain。

---

### 横向滚轮被 Space swipe 占用

当前双指横向操作专门用于切换 macOS Space。

如果以后有应用确实需要水平滚轮，需要重新设计手势映射。

---

## 8. 代码维护

### noVNC fork

远程：

```text
upstream = 官方 novnc/noVNC
origin   = SodaNYC/noVNC
```

当前定制分支：

```text
iphone-custom-v1.7
```

开发原则：

- 尽量一个功能一个 commit
- 不要把临时 debug 长期留在正式分支
- 不要盲目 `git add .`
- 不要提交 Tailscale Auth Key、证书私钥、Shadowrocket 订阅或 tsnet state

---

### 将来升级 noVNC

例如官方发布 v1.8.x 后，不建议直接把现有分支强行 merge 到新版。

更适合：

```bash
git fetch upstream --tags
git switch -c iphone-custom-v1.8 <新的官方tag>
git cherry-pick <需要保留的自定义commit>
```

建议开启：

```bash
git config rerere.enabled true
```

方便后续重复解决类似冲突。

---

## 9. 当前自定义文件范围

相对官方 v1.7.0，核心修改集中在：

```text
core/rfb.js
app/ui.js
app/styles/base.css
vnc.html
```

另外新增本说明文件。

其中：

- `core/rfb.js`：缩放、滚动、viewport、Space、全屏手势，以及可选的输入 → framebuffer → render 延迟诊断
- `app/ui.js`：双向剪贴板、SSE、Paste to Mac、自动重连与凭据复用前端行为，以及 Latency Debug 浮层
- `app/styles/base.css`：Mac clipboard 新内容提示与 Latency Debug 浮层样式
- `vnc.html`：双向 Clipboard 面板与 iOS 密码自动填充字段提示

为让 GitHub Actions 与本定制版行为一致，还包含少量开发/测试辅助修改：

```text
tests/test.rfb.js
eslint.config.mjs
package.json
po/xgettext-html
```

这些文件用于测试、Lint 和翻译工具链，不改变实际远控操作逻辑。

gateway 的后端代码位于独立私有仓库，不放进 noVNC fork。

---

## 10. 建议的旅行前检查

出发前用 **iPhone 关闭 Wi-Fi，仅使用 5G** 做一次完整检查：

1. 能打开完整 `.ts.net` HTTPS 地址
2. Chrome / iOS 能识别 Credentials 表单并通过密码管理器 + Face ID 填入用户名密码
3. 能连接 VNC
4. 打开 Automatic reconnect，并确认 Reconnect delay 为 `3000 ms`
5. 单指点击正常
6. pinch zoom 正常
7. 放大后单指拖动画面正常
8. 双指上下滚动正常
9. 双指左右切 Space 正常
10. 三指轻点进入 / 退出全屏正常
11. iPhone → Mac：Paste to Mac 中文、多行文字正常
12. Mac → iPhone：Mac 上 Command+C 后约 0～0.4 秒出现 Clipboard 新内容提示，点一次后能在 iPhone 其他 App 粘贴
13. iPhone → Mac 后不会立刻收到同一内容的错误 “Mac clipboard updated” 回声提示
14. iPhone 短暂锁屏 / 切后台后回来，页面未被杀时能够自动重新连接且不再询问 Credentials
15. SSE 在回到前台后能够恢复，并继续收到 Mac clipboard 更新
16. 手动刷新页面后，密码管理器能够再次通过 Face ID 填充
17. Chrome Remote Desktop 仍可作为备用通道

通过后，再把当前 commit 打 tag 作为旅行冻结版本。
