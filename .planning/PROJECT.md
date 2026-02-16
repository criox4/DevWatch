# DevWatch

## What This Is

A VS Code extension that provides unified, real-time process and port management from within the editor. DevWatch monitors all workspace-related processes, maps them to ports, provides one-click kill/restart controls, logs historical activity, detects orphaned processes, and integrates with Claude Code workflows — all cross-platform (macOS, Linux, Windows).

## Core Value

Developers can instantly see what's running, kill what shouldn't be, and never lose time to orphaned processes or port conflicts again.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Real-time process and port monitoring with configurable polling (3s active, 30s background)
- [ ] Process tree view showing parent-child relationships rooted at VS Code process
- [ ] Bidirectional port-to-PID mapping across macOS, Linux, and Windows
- [ ] Orphaned process detection (PPID=1, stale terminal PID, Claude Code extension host children)
- [ ] Configurable alerts: new ports, port conflicts, orphans, resource thresholds, crashes
- [ ] Kill operations: graceful (SIGTERM→SIGKILL), force, tree kill, bulk kill
- [ ] Process restart with command replay, environment preservation, and auto-restart with exponential backoff
- [ ] Historical logging of all process lifecycle events with structured JSON storage
- [ ] Searchable/filterable history timeline and aggregate analytics
- [ ] Log rotation (10MB per file) and configurable retention (default 14 days)
- [ ] Sidebar TreeViews for Processes (hierarchical) and Ports (flat, labeled)
- [ ] Status bar summary with ambient awareness and alert indicators
- [ ] Webview panel for history/analytics with VS Code theme integration
- [ ] CPU and memory tracking per process with threshold alerts
- [ ] Command palette integration with `Process Manager:` prefix
- [ ] Keyboard shortcuts for quick kill (Ctrl+Shift+K) and restart (Ctrl+Shift+R)
- [ ] Claude Code MCP server exposing process management tools
- [ ] Claude Code hooks integration for tracking background-spawned processes
- [ ] Workspace process definition file (`.processmanager.json`) for team configs
- [ ] Compound process groups — define and launch multi-service stacks as a unit
- [ ] Port conflict auto-resolution with config file updates
- [ ] Docker container awareness
- [ ] Extension API for third-party process registration
- [ ] Open VSX Registry publication (VSCodium/Cursor/Windsurf compatibility)

### Out of Scope

- Remote SSH and Dev Container support — complexity too high for v1, revisit post-launch
- Multi-window VS Code cross-instance IPC — interesting but edge case, defer
- GUI process manager replacement (Task Manager/Activity Monitor) — we focus on dev-relevant processes only
- Mobile or web VS Code support — desktop only
- Telemetry dashboard for extension publishers — premature before adoption

## Context

**Market landscape:** The VS Code process/port management space has no dominant player. Existing tools collectively total under 40K installs and none combines monitoring + port management + history + orphan detection. JetBrains' Services Tool Window is the gold standard VS Code lacks.

**Closest competitors:** Task Kill (12K installs, kill only), Task Manager & Resource Monitor (5K, system-level), Ports Explorer (151, basic). All single-purpose, none handles orphan detection or history.

**Claude Code pain point:** Claude Code's background command system spawns dev servers and MCP servers that persist after context compaction. Documented cases of 40+ orphaned MCP servers and processes running 136+ minutes consuming 16GB RAM. The hooks system (`PostToolUse` on `Bash` tool) and MCP server integration are the primary integration paths.

**VS Code built-in gaps:** The Ports panel only manages Dev Tunnel forwarding. Process Explorer shows internal processes only. No built-in mechanism for detecting, mapping, or killing user processes on ports.

**Architecture approach:** Layered — platform abstraction (Darwin/Linux/Windows adapters), core services (ProcessRegistry, PortScanner, ProcessLifecycle, HistoryLogger), and UI layer (TreeViews, Status Bar, Webview). Strategy pattern selects platform adapter based on `process.platform`.

**ESM consideration:** Several candidate libraries (pid-port, fkill, get-port) are ESM-only in latest versions. The approach (dynamic import, pin CJS versions, or ESM build output) will be resolved during research.

**Library choices are starting points** — the PRD references pid-port, tree-kill, fkill, pino, detect-port, ps-tree, and find-process. Research should validate and potentially swap for better options. React for the webview panel is also flexible.

## Constraints

- **Platform**: Must work on macOS (Intel + ARM), Linux (Ubuntu primary), and Windows — all process/port commands differ per OS
- **Performance**: <1% CPU overhead during monitoring, <50MB memory including log caches, <100ms activation time
- **VS Code API**: Must use stable API only for marketplace compatibility; Workspace Trust must disable kill operations in untrusted workspaces
- **Privacy**: Process command lines may contain secrets — must sanitize logged commands. Telemetry strictly opt-in, respects VS Code's telemetry settings
- **Bundling**: esbuild for production bundling — fast build times and small output

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript for implementation | VS Code extension standard, type safety for complex cross-platform logic | — Pending |
| Platform strategy pattern (Darwin/Linux/Windows adapters) | Isolates OS-specific code, each adapter implements common interface | — Pending |
| File-based JSON logging (not SQLite) | Lightweight, no native dependencies, append-only is sufficient | — Pending |
| esbuild for bundling | Fastest bundler, well-supported for VS Code extensions | — Pending |
| Configurable polling (not pure event-driven) | Event-driven catches VS Code-spawned processes; polling catches externals | — Pending |
| Library choices TBD via research | pid-port, tree-kill, fkill, pino are starting points to validate | — Pending |
| ESM approach TBD via research | Multiple viable approaches, research will determine best fit | — Pending |
| Webview framework TBD via research | React mentioned in PRD but flexible — could be lighter alternative | — Pending |

---
*Last updated: 2026-02-17 after initialization*
