# 骗子博弈 (Liar's Gambit)

单文件 HTML5 P2P 多人卡牌游戏。支持 2–8 人联机，基于 PeerJS WebRTC 点对点连接。游戏风格为“荒诞漫画手绘”，提供 1–3 副牌（每副 54 张）并以颜色区分。

## 特性

- **P2P 多人联机**：PeerJS + WebRTC DataChannel（星型拓扑，房主权威状态）
- **1–3 副牌**：每副 54 张，红/蓝/绿配色区分
- **胜利条件**：先打光手牌即胜
- **质疑机制**：顺序/乱序质疑（房主在大厅设置）
- **断线重联与房主迁移**：房主断线后自动迁移，玩家可重连
- **移动端友好**：安全区适配、底部手牌抬高

## 如何运行

本项目为纯前端静态文件，无需构建。推荐使用本地静态服务器（避免浏览器对 P2P 的限制）。

### 方式一：直接打开

双击 `index.html`  打开（部分浏览器可能限制 WebRTC 连接）。

### 方式二：网页链接（推荐）

访问：[`https://lu123bing.github.io/liars-gambit/`](https://lu123bing.github.io/liars-gambit/)

## 目录结构

- `index.html` ：单文件完整版（HTML/CSS/JS）
<!-- - `index2.html`：备份/实验版本（如存在） -->

## 开始游戏

1. 输入昵称，创建房间
2. 让玩家扫码或输入房间号加入
3. 设置牌组数量、质疑模式、出牌记录显示
4. 点击“开始游戏”

## 依赖

- [PeerJS](https://peerjs.com/)（CDN）
- [QRCode.js](https://davidshimjs.github.io/qrcodejs/)（CDN）
- Google Fonts: Patrick Hand

## 许可

仅供学习和交流使用。
