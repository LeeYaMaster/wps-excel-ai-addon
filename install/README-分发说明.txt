WpsExcelAI 发给别人用哪个文件？
================================

请把 dist/ 目录里对应平台的「单个 zip」发给对方：

1) macOS 用户
   文件：WpsExcelAI-macOS.zip
   对方：解压 → 双击「安装-macOS.command」（若提示安全，右键→打开）
   验证：
     curl -sI http://127.0.0.1:13991/ribbon.xml
     curl -s  http://127.0.0.1:8787/health
   然后 ⌘Q 退出 WPS，重开「表格」，应见「AI 助手」。
   在侧栏设置里填自己的 API Key（不要用别人的密钥）。

2) Windows 用户
   文件：WpsExcelAI-Windows.zip
   对方：解压 → 双击 install.bat（或 PowerShell 运行 install-windows.ps1）
   验证：浏览器打开 http://127.0.0.1:8787/health 应看到 ok
   完全退出并重启 WPS 表格，功能区「AI 助手」。
   需要本机有 Python 3 才能自动跑 CORS 代理；仅 file 模式加载插件可不依赖静态站，
   但直连 API 常遇 CORS，强烈建议装 Python 并保持代理任务。

开发者本机（你自己）仍可用仓库根目录：
  bash install-ours-standalone.sh

密钥：安装包不含任何 API Key。每人在设置页自行填写。
