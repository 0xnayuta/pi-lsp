# LSP Extension for pi-coding-agent

[English](./README.md) | [中文](./README.zh.md)

Language Server Protocol integration for **pi-coding-agent**.

> Provides both:
> - a **Hook extension** (`lsp.ts`) for automatic diagnostics, and
> - a **Tool extension** (`lsp-tool.ts`) for on-demand LSP queries.

---

## Table of Contents

- [Features](#features)
- [Supported Languages](#supported-languages)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
  - [Hook (Auto Diagnostics)](#hook-auto-diagnostics)
  - [Tool (`lsp`)](#tool-lsp)
- [Settings](#settings)
- [Recent Core Improvements](#recent-core-improvements)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Features

- **Automatic diagnostics** via hook (`lsp.ts`)
  - Default mode: run diagnostics at **agent end**
  - Optional mode: run diagnostics after each `write`/`edit`
- **On-demand LSP tool** (`lsp-tool.ts`)
  - definition, references, hover, signature, symbols
  - diagnostics, workspace diagnostics
  - rename, code actions
- **Multi-language support** including C/C++, Rust, Swift, Kotlin, TS/JS, etc.
- **Efficient runtime behavior**
  - one LSP server per project root
  - server reuse across turns
  - idle file cleanup + LRU open-file cap
  - idle server shutdown and lazy restart
- **Robust diagnostics retrieval**
  - supports both push diagnostics (`publishDiagnostics`) and pull diagnostics (`textDocument/diagnostic`, `workspace/diagnostic`)

---

## Supported Languages

| Language | LSP Server | Root Detection Markers |
|---|---|---|
| TypeScript / JavaScript | `typescript-language-server` | `package.json`, `tsconfig.json`, `jsconfig.json` |
| Vue | `vue-language-server` | `package.json`, `vite.config.ts`, `vite.config.js` |
| Svelte | `svelteserver` | `package.json`, `svelte.config.js` |
| Dart / Flutter | `dart language-server` | `pubspec.yaml`, `analysis_options.yaml` |
| Python | `pyright-langserver` | `pyproject.toml`, `setup.py`, `requirements.txt`, `pyrightconfig.json` |
| Go | `gopls` | `go.work`, `go.mod` |
| Kotlin | `kotlin-lsp` (preferred) / `kotlin-language-server` | `settings.gradle(.kts)`, `build.gradle(.kts)`, `pom.xml`, `gradlew` |
| Swift | `sourcekit-lsp` | `Package.swift`, `*.xcodeproj`, `*.xcworkspace` |
| Rust | `rust-analyzer` | `Cargo.toml` |
| C / C++ | `clangd` | `compile_commands.json`, `CMakeLists.txt`, `Makefile`, `.git`, etc. |

---

## Requirements

Install the language servers you need (examples):

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

# Kotlin (preferred)
# See Kotlin/kotlin-lsp release/docs for your platform

# Swift (macOS)
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
# Install LLVM / clangd and ensure clangd is in PATH
```

> The extension resolves binaries from `PATH`.

---

## Installation

```bash
pi install npm:lsp-pi
pi config
```

`package.json` includes both extensions:

- `./lsp.ts`
- `./lsp-tool.ts`

---

## Usage

### Hook (Auto Diagnostics)

The hook extension (`lsp.ts`) automatically checks files touched by `write`/`edit`.

Behavior:

1. On `session_start`, it warms up LSP for detected project type.
2. It tracks touched files during agent execution.
3. In default mode (`agent_end`), it runs diagnostics once after the response is complete.
4. In `edit_write` mode, it appends diagnostics immediately after each `write`/`edit`.
5. It manages resources automatically (LRU file eviction, idle close, idle server shutdown).

### Tool (`lsp`)

The `lsp` tool provides on-demand language intelligence.

| Action | Description | Required Parameters |
|---|---|---|
| `definition` | Go to definition | `file` + (`line`/`column` or `query`) |
| `references` | Find references | `file` + (`line`/`column` or `query`) |
| `hover` | Hover info (type/docs) | `file` + (`line`/`column` or `query`) |
| `signature` | Signature help | `file` + (`line`/`column` or `query`) |
| `symbols` | List document symbols | `file` (optional `query`) |
| `diagnostics` | Diagnostics for one file | `file` (optional `severity`) |
| `workspace-diagnostics` | Diagnostics for multiple files | `files[]` (optional `severity`) |
| `rename` | Rename symbol | `file` + (`line`/`column` or `query`) + `newName` |
| `codeAction` | Quick fixes/refactors | `file` + `line`/`column` (optional range end) |

Severity filter values:

- `all` (default)
- `error`
- `warning`
- `info`
- `hint`

Examples:

```bash
# Check one file
lsp action=diagnostics file=src/main.cpp severity=error

# Check multiple files
lsp action=workspace-diagnostics files=["src/a.ts","src/b.ts"] severity=warning

# Find symbol position by name (query-based)
lsp action=definition file=lsp-core.ts query=getOrCreateManager
```

---

## Settings

Use `/lsp` in the UI to configure hook mode:

- `agent_end` (default)
- `edit_write`
- `disabled`

Scope:

- `session` only
- `global` (`~/.pi/agent/settings.json`)

Global config example:

```json
{
  "lsp": {
    "hookMode": "disabled"
  }
}
```

> Disabling hook mode does **not** disable the `lsp` tool.

---

## Recent Core Improvements

### `lsp.ts` (Hook)

- Default behavior optimized to `agent_end` for cleaner output.
- Added `/lsp` mode + scope configuration flow.
- Added per-language diagnostics wait tuning (including C/C++, Rust, Kotlin, Swift).
- Added warm-up markers for more project types (including C/C++).
- Improved lifecycle robustness (abort-aware batching, idle shutdown scheduling).

### `lsp-core.ts` (Manager)

- Expanded and hardened server/root handling for Kotlin, Swift, Rust, C/C++.
- Added safer process startup with fallback probes.
- Combined push + pull diagnostics strategy for better reliability.
- Added bounded memory strategy (max open files, LRU eviction, idle close).
- Improved cross-platform file URI mapping (`fileURLToPath` first).
- Improved clangd startup with `--compile-commands-dir=<root>`.

### `lsp-tool.ts` (Tool)

- Added and refined actions: `workspace-diagnostics`, `rename`, `codeAction`, `signature`.
- Added severity filtering and query-based position resolution.
- Added runtime execute-signature compatibility shim.
- Added cancellation-safe execution and improved rendering.

---

## Project Structure

| File | Purpose |
|---|---|
| `lsp.ts` | Hook extension (automatic diagnostics) |
| `lsp-tool.ts` | Tool extension (interactive LSP actions) |
| `lsp-core.ts` | Shared LSP manager + server configuration + utilities |
| `package.json` | Extension registration and dependencies |

---

## Testing

```bash
# Root/config/unit tests
npm test

# Tool-focused tests
npm run test:tool

# Integration tests (real language servers)
npm run test:integration
```

---

## Known Limitations

- **rust-analyzer** can be slow to initialize for non-trivial projects.
- **clangd** works best with `compile_commands.json`.
- For very large repositories, first-run indexing may take noticeable time.

---

## License

MIT
