# WPS 表格「AI 助手」加载项

在 WPS 表格（et）中用**中文**提问，结合当前选区调用 **OpenAI 兼容** Chat Completions API。支持流式输出、多轮对话、快捷指令与本地历史。

**产品路径（v1.2.3）：侧栏轻对话 →「AI 工作区」逐格同意写入。**  
侧栏不再提供整表写入按钮；预览与确认写入在工作区完成，确认前不会自动覆盖单元格。

Mac 项目路径：`~/Desktop/wps-excel-ai-addon/`  
box 副本：`/workspace/wps-excel-ai-addon/`（以 Desktop 为准同步）。

当前版本：**v1.2.3**

---

## 怎么用

1. **侧栏「打开 AI 面板」**：看一行选区状态、点快捷芯片、多轮聊天（默认始终附带选区）。
2. **功能区 / 侧栏「打开 AI 工作区」**：对话 + 右侧单元格变更列表，**逐格勾选同意/拒绝**后「应用已选」。
3. 侧栏回复后若需改表，点「打开 AI 工作区」审查写入（不会强制弹窗）。

| 能力 | 说明 |
|------|------|
| **打开 AI 工作区** | 功能区大按钮；优先 `ShowDialog`；Mac 若 API 受限则加宽任务窗格加载 `dialog.html` |
| **双栏布局** | 左对话 / 右「单元格变更列表」：地址、类型、旧值→新值 |
| **逐格同意/拒绝** | 默认勾选「修改/新增」；支持全选变更 / 全选 / 全拒 |
| **应用已选** | 仅 `ExcelBridge.applySelectedCells` 写入勾选地址 |
| 侧栏 | 轻对话 + 选区一行状态 + 芯片；**无**六种整表写入按钮 |

已知限制：WPS JS 难以在格子上画绿/红 overlay，逐格勾选在对话框内完成即达标；Mac 国际版 `ShowDialog` 可能不可用，此时走宽侧栏兜底（见功能区「关于」）。

---

## 发给别人用哪个文件？（分发）

先在本机构建：

```bash
bash ~/Desktop/wps-excel-ai-addon/scripts/build-dist.sh
```

| 发给谁 | 文件 | 对方怎么装 | 装完如何验证 |
|--------|------|------------|--------------|
| **只给 Mac** | `dist/WpsExcelAI-macOS.zip` | 解压 → 双击 `安装-macOS.command` | `curl -sI http://127.0.0.1:13991/ribbon.xml` 与 `curl -s http://127.0.0.1:8787/health`；⌘Q 后重开表格见「AI 助手」 |
| **只给 Windows** | `dist/WpsExcelAI-Windows.zip` | 解压 → 双击 `install.bat` | 浏览器打开 `http://127.0.0.1:8787/health`；完全退出并重启 WPS 表格 |
| **两边都有（推荐）** | `dist/WpsExcelAI-分享包.zip` | 内含上述两个 zip + 说明 | 同上 |

安装包**不含 API Key**。对方在设置里自行填写。

macOS 安装会把插件与代理放到 `~/Library/Application Support/WpsExcelAI/`（代理），加载项同步到国际版 jsaddons，LaunchAgent **不依赖 Desktop**（避免 TCC）。  
Windows 复制到 `%APPDATA%\kingsoft\wps\jsaddons`，运行时在 `%APPDATA%\WpsExcelAI\`，并注册用户级计划任务跑静态+:8787 代理（需本机 Python 3）。

---

## 本机 Mac 安装（开发 / 自用）

```bash
bash ~/Desktop/wps-excel-ai-addon/install-ours-standalone.sh
```

或双击：`一键写入WPS加载项.command`  
然后 **⌘Q 完全退出 WPS**，再打开「表格」。

试用 AI 工作区：

1. 功能区 **AI 助手 → 打开 AI 工作区**（或侧栏顶部同名按钮）
2. 提问并等待解析出表格
3. 右侧勾选要接受的单元格 → **应用已选**
4. 未勾选格子不会被改写

单独修复服务：

```bash
bash ~/Desktop/wps-excel-ai-addon/install-launchagent.sh
bash ~/Desktop/wps-excel-ai-addon/install-proxy-launchagent.sh
```

日志：`~/Library/Logs/WpsExcelAI/`。
代理脚本：`~/Library/Application Support/WpsExcelAI/proxy-server.py`。
静态服务：`~/Library/Application Support/WpsExcelAI/addon-server.py`（:13991，含 `/api/settings`）。
API 配置持久化：`~/Library/Application Support/WpsExcelAI/settings.json`（Windows：`%APPDATA%\WpsExcelAI\settings.json`）。安装/更新**不会删除**该文件；侧栏保存设置会同时写 localStorage 与磁盘。

### 与 OfficeAI.Chat

Mac **et 同一时间大约只加载一个 et 加载项**。本方案独立 :13991，不依赖 OfficeAI :3889。官方卸载 OfficeAI 可能清掉 `publish.xml`，之后请重跑安装脚本。

---

## 功能一览

| 能力 | 说明 |
|------|------|
| AI 工作区 | 对话框/宽窗格；逐格同意；`applySelectedCells` / `applyGridWithMask` |
| 侧栏面板 | 选区一行 + 芯片 + 聊天；设置日常只显 Base/Key/模型（高级可折叠） |
| 测试连接 | 设置页；经代理打 chat completions |
| 流式 / 多轮 | `stream` + 最近 N 轮（默认 8，在「高级」） |
| 快捷指令 | 公式、清洗、汇总、整理成表、补全、假数据等 |
| 历史会话 | 本地列表；导出 Markdown / JSON |
| 写入确认 | 仅工作区逐格同意；不自动覆盖 |

---

## 目录结构

```
wps-excel-ai-addon/
├── README.md
├── install-ours-standalone.sh
├── install-launchagent.sh / install-proxy-launchagent.sh
├── addon/
│   ├── dialog.html / css/dialog.css / js/dialog.js   # AI 工作区（写入主路径）
│   ├── taskpane.html / js/taskpane.js                # 侧栏轻对话
│   ├── js/excel.js                                   # diff / applySelectedCells
│   └── ribbon.xml / js/ribbon.js
├── proxy/
├── install/
├── scripts/build-dist.sh
└── dist/
```

---

## 配置 API

1. 打开侧栏或工作区 → **设置**
2. Base URL / Key / 模型；建议勾选本地代理（代理 URL / 多轮 / 流式在「高级」）
3. **测试连接** → **保存设置**（提示「已保存到本机（更新加载项后仍保留）」）

保存会同时写入浏览器 `localStorage` 与本机磁盘：
- macOS：`~/Library/Application Support/WpsExcelAI/settings.json`
- Windows：`%APPDATA%\WpsExcelAI\settings.json`

更新/重装加载项后，若 WebView 清空了 localStorage，打开设置时会自动从磁盘回填。安装脚本**不会删除** `settings.json`。

DeepSeek 示例：Base `https://api.deepseek.com/v1`，模型 `deepseek-chat`。

---

## Word 版本（路线图 stub）

> **未实现。** Excel + dist 分发为本阶段范围。

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 无「AI 助手」 | 重跑安装；⌘Q / 完全退出后重启表格 |
| 工作区打不开独立窗 | 属 Mac API 限制时正常；应出现加宽侧栏 `dialog.html`；见「关于」 |
| ribbon 非 200 | `install-launchagent.sh`；`launchctl list | grep excelai` |
| 测试连接：代理未开 | Mac：`install-proxy-launchagent.sh`；Win：确认 Python 与计划任务 |
| 鉴权失败 | 检查 Key 与 Base URL 是否匹配 |
| Failed to fetch | 勾选本地代理并确认 :8787 `/health` |

```bash
curl -sI http://127.0.0.1:13991/ribbon.xml
curl -sI http://127.0.0.1:13991/dialog.html
curl -sI http://127.0.0.1:13991/taskpane.html
curl -s  http://127.0.0.1:13991/api/settings
curl -s  http://127.0.0.1:8787/health
launchctl list | grep excelai   # macOS
```

---

## 安全

- API Key 仅本机 `localStorage` + `settings.json`，**不要**提交仓库或打进分享 zip / README 样例。
- 本地 HTTP / 代理默认只绑 `127.0.0.1`。

---

## 许可

示例代码，可按需修改使用。
