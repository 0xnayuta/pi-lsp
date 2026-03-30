# pi-coding-agent 的 LSP 扩展

[English](./README.md) | [中文](./README.zh.md)

为 **pi-coding-agent** 提供 Language Server Protocol（LSP）集成能力。

> 本项目同时提供：
> - **Hook 扩展**（`lsp.ts`）：自动诊断
> - **Tool 扩展**（`lsp-tool.ts`）：按需 LSP 查询

---

## 目录

- [功能特性](#功能特性)
- [支持语言](#支持语言)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用方式](#使用方式)
  - [Hook（自动诊断）](#hook自动诊断)
  - [Tool（`lsp`）](#toollsp)
- [配置](#配置)
- [近期核心改进](#近期核心改进)
- [项目结构](#项目结构)
- [测试](#测试)
- [已知限制](#已知限制)
- [许可证](#许可证)

---

## 功能特性

- **自动诊断**（`lsp.ts`）
  - 默认模式：在 **agent 响应结束** 时统一诊断
  - 可选模式：每次 `write`/`edit` 后立即诊断
- **按需 LSP 工具**（`lsp-tool.ts`）
  - definition、references、hover、signature、symbols
  - diagnostics、workspace-diagnostics
  - rename、codeAction
- **多语言支持**（含 C/C++、Rust、Swift、Kotlin、TS/JS 等）
- **高效运行机制**
  - 每个项目根目录维护一个 LSP 服务实例
  - 跨轮次复用服务
  - 空闲文件清理 + 打开文件数 LRU 限制
  - 空闲服务自动关闭、按需重启
- **稳健诊断策略**
  - 同时支持推送诊断（`publishDiagnostics`）与拉取诊断（`textDocument/diagnostic`、`workspace/diagnostic`）

---

## 支持语言

| 语言 | LSP 服务 | 根目录识别标记 |
|---|---|---|
| TypeScript / JavaScript | `typescript-language-server` | `package.json`, `tsconfig.json`, `jsconfig.json` |
| Vue | `vue-language-server` | `package.json`, `vite.config.ts`, `vite.config.js` |
| Svelte | `svelteserver` | `package.json`, `svelte.config.js` |
| Dart / Flutter | `dart language-server` | `pubspec.yaml`, `analysis_options.yaml` |
| Python | `pyright-langserver` | `pyproject.toml`, `setup.py`, `requirements.txt`, `pyrightconfig.json` |
| Go | `gopls` | `go.work`, `go.mod` |
| Kotlin | `kotlin-lsp`（推荐）/ `kotlin-language-server` | `settings.gradle(.kts)`, `build.gradle(.kts)`, `pom.xml`, `gradlew` |
| Swift | `sourcekit-lsp` | `Package.swift`, `*.xcodeproj`, `*.xcworkspace` |
| Rust | `rust-analyzer` | `Cargo.toml` |
| C / C++ | `clangd` | `compile_commands.json`, `CMakeLists.txt`, `Makefile`, `.git` 等 |

---

## 环境要求

按需安装对应语言服务器（示例）：

```bash
# TypeScript/JavaScript
npm i -g typescript-language-server typescript

# Vue
npm i -g @vue/language-server

# Svelte
npm i -g svelte-language-server

# Python
npm i -g pyright

# Go
go install golang.org/x/tools/gopls@latest

# Kotlin（推荐）
# 请参考 Kotlin/kotlin-lsp 的发布说明

# Swift（macOS）
xcrun sourcekit-lsp --help

# Rust
rustup component add rust-analyzer

# C/C++
# macOS
brew install llvm
# Ubuntu/Debian
sudo apt install clangd
# Arch
sudo pacman -S clang
# Windows
# 安装 LLVM / clangd，并确保 clangd 在 PATH 中
```

> 扩展通过系统 `PATH` 查找并启动语言服务器。

---

## 安装

```bash
pi install npm:lsp-pi
pi config
```

`package.json` 中注册了两个扩展入口：

- `./lsp.ts`
- `./lsp-tool.ts`

---

## 使用方式

### Hook（自动诊断）

`lsp.ts` 会自动分析 `write`/`edit` 触及的文件。

流程：

1. `session_start` 时按项目类型预热 LSP。
2. 记录本轮 agent 执行中被修改的文件。
3. 默认 `agent_end` 模式下，在整轮响应结束后统一诊断。
4. `edit_write` 模式下，每次 `write`/`edit` 后立即附加诊断结果。
5. 自动进行资源管理（LRU、空闲关闭、空闲服务停止）。

### Tool（`lsp`）

`lsp` 工具提供按需语言能力查询。

| 动作 | 说明 | 必需参数 |
|---|---|---|
| `definition` | 跳转定义 | `file` + (`line`/`column` 或 `query`) |
| `references` | 查找引用 | `file` + (`line`/`column` 或 `query`) |
| `hover` | 类型/文档信息 | `file` + (`line`/`column` 或 `query`) |
| `signature` | 函数签名帮助 | `file` + (`line`/`column` 或 `query`) |
| `symbols` | 文档符号列表 | `file`（可选 `query`） |
| `diagnostics` | 单文件诊断 | `file`（可选 `severity`） |
| `workspace-diagnostics` | 多文件诊断 | `files[]`（可选 `severity`） |
| `rename` | 符号重命名 | `file` + (`line`/`column` 或 `query`) + `newName` |
| `codeAction` | 快速修复/重构建议 | `file` + `line`/`column`（范围终点可选） |

`severity` 可选值：

- `all`（默认）
- `error`
- `warning`
- `info`
- `hint`

示例：

```bash
# 检查单文件
lsp action=diagnostics file=src/main.cpp severity=error

# 检查多文件
lsp action=workspace-diagnostics files=["src/a.ts","src/b.ts"] severity=warning

# 使用 query 按符号名定位
lsp action=definition file=lsp-core.ts query=getOrCreateManager
```

---

## 配置

在 UI 中使用 `/lsp` 配置 Hook 模式：

- `agent_end`（默认）
- `edit_write`
- `disabled`

作用域：

- `session`（仅当前会话）
- `global`（全局，写入 `~/.pi/agent/settings.json`）

全局配置示例：

```json
{
  "lsp": {
    "hookMode": "disabled"
  }
}
```

> 关闭 Hook 不会影响 `lsp` 工具本身。

---

## 近期核心改进

### `lsp.ts`（Hook）

- 默认行为优化为 `agent_end`，减少每次编辑的噪声输出。
- 增加 `/lsp` 的模式 + 作用域配置流程。
- 增加按语言定制诊断等待时间（含 C/C++、Rust、Kotlin、Swift）。
- 扩展更多项目预热标记（含 C/C++）。
- 生命周期更稳健（可中断批处理、空闲关闭调度）。

### `lsp-core.ts`（管理器）

- 完善 Kotlin / Swift / Rust / C/C++ 的服务与根目录识别逻辑。
- 增加更安全的进程启动与回退探测策略。
- 采用推送 + 拉取组合诊断策略，提升可靠性。
- 引入内存边界控制（最大打开文件数、LRU 淘汰、空闲关闭）。
- 改进跨平台文件 URI 到路径映射（优先 `fileURLToPath`）。
- clangd 启动参数增加 `--compile-commands-dir=<root>`，更稳定识别编译数据库。

### `lsp-tool.ts`（工具）

- 补强并优化 `workspace-diagnostics`、`rename`、`codeAction`、`signature`。
- 诊断增加 `severity` 过滤与基于 `query` 的位置解析。
- 兼容不同 pi runtime 的 execute 签名。
- 增强取消中断处理与结果渲染体验。

---

## 项目结构

| 文件 | 作用 |
|---|---|
| `lsp.ts` | Hook 扩展（自动诊断） |
| `lsp-tool.ts` | Tool 扩展（交互式 LSP 查询） |
| `lsp-core.ts` | 共享核心：LSP 管理、服务配置、工具函数 |
| `package.json` | 扩展注册与依赖定义 |

---

## 测试

```bash
# 根目录/配置/单元测试
npm test

# 工具相关测试
npm run test:tool

# 集成测试（真实语言服务器）
npm run test:integration
```

---

## 已知限制

- **rust-analyzer** 在复杂项目中的首次初始化可能较慢。
- **clangd** 在有 `compile_commands.json` 时效果最佳。
- 大型仓库首次索引可能耗时较明显。

---

## 许可证

MIT
