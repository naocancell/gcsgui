# GCSGUI 项目脚本维护手册（Gitea + 纯 Windows 环境专属）

本目录 (`scripts/`) 包含用于 GCSGUI 项目日常开发、版本控制、多语言管理以及本地 Windows 便携绿色版构建的辅助脚本。
本项目针对自建 Gitea 和 Windows 桌面系统做了专门适配，所有脚本均可在 Windows 办公/开发电脑本地一键运行。

---

## 🛠️ 脚本分类与使用说明

### 1. 版本控制与发布管理 (对接 Gitea)

| 脚本文件 | 对应的 `package.json` 命令 | 功能说明 |
| :--- | :--- | :--- |
| **`release-version.mjs`** | `pnpm release-version <版本号>` | **统一同步版本号**：自动化修改并同步 `package.json`、`src-tauri/Cargo.toml` 以及 `src-tauri/tauri.conf.json` 中的应用版本号。支持传入语义化版本（如 `0.1.2`）或预发标签（如 `alpha`、`autobuild`）。 |
| **`publish-version.mjs`** | `pnpm publish-version <版本号>` | **本地发布并打 Tag**：先同步版本号，随后自动执行 Git Commit 并创建本地和远程 Git Tag（如 `v0.1.2`），完美支持推送到公司的自建 Gitea 服务器。 |
| **`fix-alpha_version.mjs`** | *(预发内部调用)* | **测试版本号追加**：在构建测试版 / Alpha 版时，自动向当前版本号末尾追加本地短 Git Commit 哈希校验码。 |

#### 常用命令示例：
```bash
# 1. 准备发布 0.1.2 版本（修改项目所有配置文件的版本号）
pnpm release-version 0.1.2

# 2. 自动提交并创建 Git 标签 v0.1.2 推送到 Gitea
pnpm publish-version 0.1.2
```

---

### 2. 本地便携版 ZIP 构建 (Windows 专属)

在你的 Windows 本机执行 `pnpm tauri build` 编译打包出 EXE/MSI 产物后，如果想要快速制作绿色免安装的 ZIP 压缩包，可以直接运行：

| 脚本文件 | 使用命令 | 功能说明 |
| :--- | :--- | :--- |
| **`portable.mjs`** | `node scripts/portable.mjs` | **生成常规便携版 ZIP**：自动读取 `src-tauri/target/release` 目录下的主程序和资源，打包为免安装便携包 `GCSGUI_x.x.x_x64_portable.zip`。 |
| **`portable-fixed-webview2.mjs`** | `node scripts/portable-fixed-webview2.mjs` | **生成带离线 WebView2 运行时的便携包**：将可执行文件与内置的 Microsoft WebView2 离线环境打包在一起，特别适合公司内部无法访问公网下载组件的内网工控机部署。 |

---

### 3. 多语言 (i18n) 管理

| 脚本文件 | 对应的 `package.json` 命令 | 功能说明 |
| :--- | :--- | :--- |
| **`generate-i18n-keys.mjs`** | `pnpm i18n:generate` | **自动提取多语言键**：扫描 `src/` 目录下 Vue 和 TypeScript 源码中的翻译函数调用，向多语言 JSON 字典里自动补充缺失词条。 |
| **`cleanup-unused-i18n.mjs`** | `pnpm i18n:cleanup` | **清理冗余多语言词条**：对比源码实际使用到的词条，将从未用过或已废弃的脏词条从 JSON 文件中彻底清除。 |

---

### 4. 开发环境辅助

| 脚本文件 | 对应的 `package.json` 命令 | 功能说明 |
| :--- | :--- | :--- |
| **`dev.js`** | `pnpm tauri:dev` | **启动调试环境**：启动并转发 Tauri 的本地开发调试进程。 |
| **`preinstall.js`** | `npm run preinstall` | **包管理器检查**：安装依赖时的前置环境验证。 |
| **`utils.mjs`** / **`updatelog.mjs`** | *(公共工具模块)* | **日志与控制台辅助**：为上述各类脚本提供终端彩色日志高亮和 Changelog 读取能力。 |
