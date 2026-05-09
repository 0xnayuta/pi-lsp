/**
 * LSP Tool Extension for pi-coding-agent
 *
 * Provides Language Server Protocol tool for:
 * - definitions, references, hover, signature help
 * - document symbols, diagnostics, workspace diagnostics
 * - rename, code actions
 *
 * Supported languages:
 *   - Dart/Flutter (dart language-server)
 *   - TypeScript/JavaScript (typescript-language-server)
 *   - Vue (vue-language-server)
 *   - Svelte (svelteserver)
 *   - Python (pyright-langserver)
 *   - Go (gopls)
 *   - Kotlin (kotlin-ls)
 *   - Swift (sourcekit-lsp)
 *   - Rust (rust-analyzer)
 *   - C/C++ (clangd)
 *
 * Usage:
 *   pi --extension ./lsp-tool.ts
 *
 * Or use the combined lsp.ts extension for both hook and tool functionality.
 */
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { getOrCreateManager, shutdownManager, LSP_SERVERS, formatDiagnostic, filterDiagnosticsBySeverity, uriToPath, resolvePosition, collectSymbols, diagnosticsWaitMsForFile, getCppCompilationDbHint } from "./lsp-core.js";
const PREVIEW_LINES = 10;
const ACTIONS = ["definition", "references", "hover", "symbols", "diagnostics", "workspace-diagnostics", "signature", "rename", "codeAction", "restart", "servers"];
const SEVERITY_FILTERS = ["all", "error", "warning", "info", "hint"];
const SERVER_IDS = new Set(LSP_SERVERS.map((s) => s.id));
const LspParams = Type.Object({
    action: StringEnum(ACTIONS),
    file: Type.Optional(Type.String({ description: "File path (required for most actions)" })),
    files: Type.Optional(Type.Array(Type.String(), { description: "File paths for workspace-diagnostics" })),
    line: Type.Optional(Type.Number({ description: "Line (1-indexed). Required for position-based actions unless query provided." })),
    column: Type.Optional(Type.Number({ description: "Column (1-indexed). Required for position-based actions unless query provided." })),
    endLine: Type.Optional(Type.Number({ description: "End line for range-based actions (codeAction)" })),
    endColumn: Type.Optional(Type.Number({ description: "End column for range-based actions (codeAction)" })),
    query: Type.Optional(Type.String({ description: "Symbol name filter (for symbols) or to resolve position (for definition/references/hover/signature)" })),
    newName: Type.Optional(Type.String({ description: "New name for rename action" })),
    severity: Type.Optional(StringEnum(SEVERITY_FILTERS, { description: 'Filter diagnostics: "all"|"error"|"warning"|"info"|"hint"' })),
    server: Type.Optional(Type.String({ description: 'For action="restart": server id (e.g. "clangd") or "all" (default).' })),
});
function abortable(promise, signal) {
    if (!signal)
        return promise;
    if (signal.aborted)
        return Promise.reject(new Error("aborted"));
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            cleanup();
            reject(new Error("aborted"));
        };
        const cleanup = () => {
            signal.removeEventListener("abort", onAbort);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((value) => {
            cleanup();
            resolve(value);
        }, (err) => {
            cleanup();
            reject(err);
        });
    });
}
function isAbortedError(e) {
    return e instanceof Error && e.message === "aborted";
}
function cancelledToolResult() {
    return {
        content: [{ type: "text", text: "Cancelled" }],
        details: { cancelled: true },
    };
}
function isAbortSignalLike(value) {
    return !!value
        && typeof value === "object"
        && "aborted" in value
        && typeof value.aborted === "boolean"
        && typeof value.addEventListener === "function";
}
function isContextLike(value) {
    return !!value && typeof value === "object" && typeof value.cwd === "string";
}
function normalizeExecuteArgs(onUpdateArg, ctxArg, signalArg) {
    // Runtime >= 0.51: (signal, onUpdate, ctx)
    if (isContextLike(signalArg)) {
        return {
            signal: isAbortSignalLike(onUpdateArg) ? onUpdateArg : undefined,
            onUpdate: typeof ctxArg === "function" ? ctxArg : undefined,
            ctx: signalArg,
        };
    }
    // Runtime <= 0.50: (onUpdate, ctx, signal)
    if (isContextLike(ctxArg)) {
        return {
            signal: isAbortSignalLike(signalArg) ? signalArg : undefined,
            onUpdate: typeof onUpdateArg === "function" ? onUpdateArg : undefined,
            ctx: ctxArg,
        };
    }
    throw new Error("Invalid tool execution context");
}
function formatLocation(loc, cwd) {
    const abs = uriToPath(loc.uri);
    const display = cwd && path.isAbsolute(abs) ? path.relative(cwd, abs) : abs;
    const { line, character: col } = loc.range?.start ?? {};
    return typeof line === "number" && typeof col === "number" ? `${display}:${line + 1}:${col + 1}` : display;
}
function formatHover(contents) {
    if (typeof contents === "string")
        return contents;
    if (Array.isArray(contents))
        return contents.map(c => typeof c === "string" ? c : c?.value ?? "").filter(Boolean).join("\n\n");
    if (contents && typeof contents === "object" && "value" in contents)
        return String(contents.value);
    return "";
}
function formatSignature(help) {
    if (!help?.signatures?.length)
        return "No signature help available.";
    const sig = help.signatures[help.activeSignature ?? 0] ?? help.signatures[0];
    let text = sig.label ?? "Signature";
    if (sig.documentation)
        text += `\n${typeof sig.documentation === "string" ? sig.documentation : sig.documentation?.value ?? ""}`;
    if (sig.parameters?.length) {
        const params = sig.parameters.map((p) => typeof p.label === "string" ? p.label : Array.isArray(p.label) ? p.label.join("-") : "").filter(Boolean);
        if (params.length)
            text += `\nParameters: ${params.join(", ")}`;
    }
    return text;
}
function formatWorkspaceEdit(edit, cwd) {
    const lines = [];
    if (edit.documentChanges?.length) {
        for (const change of edit.documentChanges) {
            if (change.textDocument?.uri) {
                const fp = uriToPath(change.textDocument.uri);
                const display = cwd && path.isAbsolute(fp) ? path.relative(cwd, fp) : fp;
                lines.push(`${display}:`);
                for (const e of change.edits || []) {
                    const loc = `${e.range.start.line + 1}:${e.range.start.character + 1}`;
                    lines.push(`  [${loc}] → "${e.newText}"`);
                }
            }
        }
    }
    if (edit.changes) {
        for (const [uri, edits] of Object.entries(edit.changes)) {
            const fp = uriToPath(uri);
            const display = cwd && path.isAbsolute(fp) ? path.relative(cwd, fp) : fp;
            lines.push(`${display}:`);
            for (const e of edits) {
                const loc = `${e.range.start.line + 1}:${e.range.start.character + 1}`;
                lines.push(`  [${loc}] → "${e.newText}"`);
            }
        }
    }
    return lines.length ? lines.join("\n") : "No edits.";
}
function formatCodeActions(actions) {
    return actions.map((a, i) => {
        const title = a.title || a.command?.title || "Untitled action";
        const kind = a.kind ? ` (${a.kind})` : "";
        const isPreferred = a.isPreferred ? " ★" : "";
        return `${i + 1}. ${title}${kind}${isPreferred}`;
    });
}
export default function (pi) {
    pi.registerTool({
        name: "lsp",
        label: "LSP",
        description: `Query language server for definitions, references, types, symbols, diagnostics, rename, and code actions.

Actions: definition, references, hover, signature, rename (require file + line/column or query), symbols (file, optional query), diagnostics (file), workspace-diagnostics (files array), codeAction (file + position), restart (restart LSP servers; optional server="clangd"|...|"all"), servers (list server ids).
Use bash to find files: find src -name "*.ts" -type f`,
        parameters: LspParams,
        async execute(_toolCallId, params, signalArg, onUpdateArg, ctxArg) {
            const { signal, onUpdate, ctx } = normalizeExecuteArgs(onUpdateArg, ctxArg, signalArg);
            if (signal?.aborted)
                return cancelledToolResult();
            const manager = getOrCreateManager(ctx.cwd);
            const { action, file, files, line, column, endLine, endColumn, query, newName, severity, server } = params;
            const sevFilter = severity || "all";
            const needsFile = action !== "workspace-diagnostics" && action !== "restart" && action !== "servers";
            const needsPos = ["definition", "references", "hover", "signature", "rename", "codeAction"].includes(action);
            try {
                if (action === "servers") {
                    const ids = Array.from(SERVER_IDS).sort();
                    return {
                        content: [{ type: "text", text: `action: servers\n${ids.join("\n")}` }],
                        details: { servers: ids },
                    };
                }
                if (action === "restart") {
                    const target = (server || "all").trim();
                    if (target !== "all" && !SERVER_IDS.has(target)) {
                        throw new Error(`Unknown server "${target}". Use one of: all, ${Array.from(SERVER_IDS).join(", ")}`);
                    }
                    if (target === "all") {
                        await abortable(shutdownManager(), signal);
                        // Recreate manager immediately so follow-up actions are responsive.
                        getOrCreateManager(ctx.cwd);
                        return {
                            content: [{ type: "text", text: "action: restart\nserver: all\nLSP manager restarted." }],
                            details: { restarted: true, server: "all" },
                        };
                    }
                    const restartedCount = await abortable(manager.restartServers([target]), signal);
                    return {
                        content: [{ type: "text", text: `action: restart\nserver: ${target}\nRestarted ${restartedCount} client(s).` }],
                        details: { restarted: true, server: target, restartedCount },
                    };
                }
                if (needsFile && !file)
                    throw new Error(`Action "${action}" requires a file path.`);
                let rLine = line, rCol = column, fromQuery = false;
                if (needsPos && (rLine === undefined || rCol === undefined) && query && file) {
                    const resolved = await abortable(resolvePosition(manager, file, query), signal);
                    if (resolved) {
                        rLine = resolved.line;
                        rCol = resolved.column;
                        fromQuery = true;
                    }
                }
                if (needsPos && (rLine === undefined || rCol === undefined)) {
                    throw new Error(`Action "${action}" requires line/column or a query matching a symbol.`);
                }
                const qLine = query ? `query: ${query}\n` : "";
                const sevLine = sevFilter !== "all" ? `severity: ${sevFilter}\n` : "";
                const posLine = fromQuery && rLine && rCol ? `resolvedPosition: ${rLine}:${rCol}\n` : "";
                switch (action) {
                    case "definition": {
                        const results = await abortable(manager.getDefinition(file, rLine, rCol), signal);
                        const locs = results.map(l => formatLocation(l, ctx?.cwd));
                        const payload = locs.length ? locs.join("\n") : fromQuery ? `${file}:${rLine}:${rCol}` : "No definitions found.";
                        return { content: [{ type: "text", text: `action: definition\n${qLine}${posLine}${payload}` }], details: results };
                    }
                    case "references": {
                        const results = await abortable(manager.getReferences(file, rLine, rCol), signal);
                        const locs = results.map(l => formatLocation(l, ctx?.cwd));
                        return { content: [{ type: "text", text: `action: references\n${qLine}${posLine}${locs.length ? locs.join("\n") : "No references found."}` }], details: results };
                    }
                    case "hover": {
                        const result = await abortable(manager.getHover(file, rLine, rCol), signal);
                        const payload = result ? formatHover(result.contents) || "No hover information." : "No hover information.";
                        return { content: [{ type: "text", text: `action: hover\n${qLine}${posLine}${payload}` }], details: result ?? null };
                    }
                    case "symbols": {
                        const symbols = await abortable(manager.getDocumentSymbols(file), signal);
                        const lines = collectSymbols(symbols, 0, [], query);
                        const payload = lines.length ? lines.join("\n") : query ? `No symbols matching "${query}".` : "No symbols found.";
                        return { content: [{ type: "text", text: `action: symbols\n${qLine}${payload}` }], details: symbols };
                    }
                    case "diagnostics": {
                        const result = await abortable(manager.touchFileAndWait(file, diagnosticsWaitMsForFile(file)), signal);
                        const filtered = filterDiagnosticsBySeverity(result.diagnostics, sevFilter);
                        const hint = getCppCompilationDbHint(file, ctx.cwd);
                        const payload = result.unsupported
                            ? `Unsupported: ${result.error || "No LSP for this file."}`
                            : !result.receivedResponse
                                ? "Timeout: LSP server did not respond. Try again."
                                : filtered.length ? filtered.map(formatDiagnostic).join("\n") : "No diagnostics.";
                        const hintLine = hint ? `\n\n${hint}` : "";
                        return { content: [{ type: "text", text: `action: diagnostics\n${sevLine}${payload}${hintLine}` }], details: { ...result, diagnostics: filtered } };
                    }
                    case "workspace-diagnostics": {
                        if (!files?.length)
                            throw new Error('Action "workspace-diagnostics" requires a "files" array.');
                        const waitMs = Math.max(...files.map(diagnosticsWaitMsForFile));
                        const result = await abortable(manager.getDiagnosticsForFiles(files, waitMs), signal);
                        const out = [];
                        let errors = 0, warnings = 0, filesWithIssues = 0;
                        const hints = [];
                        for (const item of result.items) {
                            const display = ctx?.cwd && path.isAbsolute(item.file) ? path.relative(ctx.cwd, item.file) : item.file;
                            if (item.status !== 'ok') {
                                out.push(`${display}: ${item.error || item.status}`);
                                continue;
                            }
                            const filtered = filterDiagnosticsBySeverity(item.diagnostics, sevFilter);
                            if (filtered.length) {
                                filesWithIssues++;
                                out.push(`${display}:`);
                                for (const d of filtered) {
                                    if (d.severity === 1)
                                        errors++;
                                    else if (d.severity === 2)
                                        warnings++;
                                    out.push(`  ${formatDiagnostic(d)}`);
                                }
                            }
                            const hint = getCppCompilationDbHint(item.file, ctx.cwd);
                            if (hint && !hints.includes(hint))
                                hints.push(hint);
                        }
                        const summary = `Analyzed ${result.items.length} file(s): ${errors} error(s), ${warnings} warning(s) in ${filesWithIssues} file(s)`;
                        const hintBlock = hints.length ? `\n\n${hints.join("\n\n")}` : "";
                        return { content: [{ type: "text", text: `action: workspace-diagnostics\n${sevLine}${summary}\n\n${out.length ? out.join("\n") : "No diagnostics."}${hintBlock}` }], details: result };
                    }
                    case "signature": {
                        const result = await abortable(manager.getSignatureHelp(file, rLine, rCol), signal);
                        return { content: [{ type: "text", text: `action: signature\n${qLine}${posLine}${formatSignature(result)}` }], details: result ?? null };
                    }
                    case "rename": {
                        if (!newName)
                            throw new Error('Action "rename" requires a "newName" parameter.');
                        const result = await abortable(manager.rename(file, rLine, rCol, newName), signal);
                        if (!result)
                            return { content: [{ type: "text", text: `action: rename\n${qLine}${posLine}No rename available at this position.` }], details: null };
                        const edits = formatWorkspaceEdit(result, ctx?.cwd);
                        return { content: [{ type: "text", text: `action: rename\n${qLine}${posLine}newName: ${newName}\n\n${edits}` }], details: result };
                    }
                    case "codeAction": {
                        const result = await abortable(manager.getCodeActions(file, rLine, rCol, endLine, endColumn), signal);
                        const actions = formatCodeActions(result);
                        return { content: [{ type: "text", text: `action: codeAction\n${qLine}${posLine}${actions.length ? actions.join("\n") : "No code actions available."}` }], details: result };
                    }
                }
            }
            catch (e) {
                if (signal?.aborted || isAbortedError(e))
                    return cancelledToolResult();
                throw e;
            }
        },
        renderCall(args, theme) {
            const params = args;
            let text = theme.fg("toolTitle", theme.bold("lsp ")) + theme.fg("accent", params.action || "...");
            if (params.file)
                text += " " + theme.fg("muted", params.file);
            else if (params.files?.length)
                text += " " + theme.fg("muted", `${params.files.length} file(s)`);
            if (params.query)
                text += " " + theme.fg("dim", `query="${params.query}"`);
            else if (params.line !== undefined && params.column !== undefined)
                text += theme.fg("warning", `:${params.line}:${params.column}`);
            if (params.severity && params.severity !== "all")
                text += " " + theme.fg("dim", `[${params.severity}]`);
            if (params.server)
                text += " " + theme.fg("dim", `server=${params.server}`);
            return new Text(text, 0, 0);
        },
        renderResult(result, options, theme) {
            if (options.isPartial)
                return new Text("", 0, 0);
            const textContent = result.content?.find((c) => c.type === "text")?.text || "";
            const lines = textContent.split("\n");
            let headerEnd = 0;
            for (let i = 0; i < lines.length; i++) {
                if (/^(action|query|severity|resolvedPosition):/.test(lines[i]))
                    headerEnd = i + 1;
                else
                    break;
            }
            const header = lines.slice(0, headerEnd);
            const content = lines.slice(headerEnd);
            const maxLines = options.expanded ? content.length : PREVIEW_LINES;
            const display = content.slice(0, maxLines);
            const remaining = content.length - maxLines;
            let out = header.map((l) => theme.fg("muted", l)).join("\n");
            if (display.length) {
                if (out)
                    out += "\n";
                out += display.map((l) => theme.fg("toolOutput", l)).join("\n");
            }
            if (remaining > 0)
                out += theme.fg("dim", `\n... (${remaining} more lines)`);
            return new Text(out, 0, 0);
        },
    });
}
