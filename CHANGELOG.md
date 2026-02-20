# Changelog

All notable changes to DevWatch will be documented in this file.

## [0.1.0] - 2026-02-21

### Initial Pre-Release

DevWatch brings comprehensive process and port management to VS Code and compatible editors (Cursor, VSCodium, Windsurf).

#### Features

**Process Monitoring**
- Real-time process tree with workspace filtering
- CPU and memory usage tracking
- Process status indicators (running, sleeping, zombie, stopped)
- Orphan process detection and cleanup
- Parent-child process relationships

**Port Management**
- Port scanning with bidirectional PID mapping
- Protocol detection (TCP/UDP)
- Workspace vs. external port grouping
- Custom port labeling
- Built-in labels for common services

**Process Actions**
- Kill process (SIGTERM with auto-escalation to SIGKILL)
- Force kill (immediate SIGKILL)
- Kill process tree (recursive termination)
- Restart process with last known command
- Auto-restart with exponential backoff
- Bulk operations (kill all workspace, kill all on port, clean up orphans)

**Monitoring & Alerts**
- CPU and memory threshold alerts
- Crash detection (distinguishes from user kills)
- Port conflict notifications
- Configurable notification verbosity (minimal/moderate/comprehensive)
- Alert cooldown to prevent spam

**History & Persistence**
- NDJSON-based history logging
- Event tracking (start, stop, crash, port bind/release, threshold breaches, orphans)
- Searchable timeline panel with filtering
- Resource snapshot aggregates (30s intervals)
- Session summary with anomaly detection
- 14-day retention with automatic cleanup

**Docker Integration**
- Container tree view with Compose project grouping
- Stop and kill container operations
- Stop entire Compose projects
- Automatic detection of Docker availability

**Claude Code Integration**
- MCP (Model Context Protocol) server for AI-powered process management
- Tools: list processes/ports, get details, kill, restart, scan ports
- Opt-in via `devwatch.mcp.enabled` setting

**Public API**
- Extension API for third-party integrations
- Process and port registry access
- External process registration

**Cross-Platform Support**
- macOS: Full support (lsof, ps, kill)
- Linux: ss/netstat, /proc filesystem, kill
- Windows: PowerShell Get-NetTCPConnection, tasklist, taskkill

#### Configuration

- `devwatch.pollingPreset`: Polling interval preset (fast/normal/battery/custom)
- `devwatch.customPortLabels`: Custom port labels
- `devwatch.showInfraProcesses`: Show infrastructure processes
- `devwatch.skipKillConfirmation`: Skip kill confirmations
- `devwatch.alertThresholdCpu`: CPU alert threshold (default: 80%)
- `devwatch.alertThresholdMemoryMB`: Memory alert threshold (default: 500MB)
- `devwatch.notificationVerbosity`: Notification level
- `devwatch.alertCooldownSeconds`: Alert cooldown period
- `devwatch.historyRetentionDays`: History retention (default: 14 days)
- `devwatch.sessionSummary.enabled`: Session summary on close
- `devwatch.mcp.enabled`: Enable MCP server integration
- `devwatch.docker.enabled`: Enable Docker monitoring

#### Keyboard Shortcuts

- `Cmd+Shift+K` (macOS) / `Ctrl+Shift+K` (Windows/Linux): Quick Kill Process
- `Cmd+Shift+R` (macOS) / `Ctrl+Shift+R` (Windows/Linux): Restart Last Killed
- `Cmd+Shift+H` (macOS) / `Ctrl+Shift+H` (Windows/Linux): Open History

#### Requirements

- VS Code 1.96.0 or higher
- Optional: Docker (for container management)
