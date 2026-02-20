import Docker from 'dockerode';
import * as vscode from 'vscode';
import type { ContainerInfo, ComposeProject } from './types';

/**
 * Service for managing Docker containers
 */
export class DockerManager implements vscode.Disposable {
  private docker: Docker | null = null;
  private available: boolean = false;
  private containers: ContainerInfo[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    // Lazy initialization - don't check availability in constructor
    try {
      this.docker = new Docker(); // Auto-detects socket
    } catch (err) {
      this.outputChannel.appendLine(`[DockerManager] Failed to create Docker client: ${err}`);
    }
  }

  /**
   * Check if Docker is available by pinging the daemon
   */
  async checkAvailability(): Promise<boolean> {
    if (this.docker === null) {
      try {
        this.docker = new Docker();
      } catch (err) {
        this.outputChannel.appendLine(`[DockerManager] Failed to create Docker client: ${err}`);
        this.available = false;
        return false;
      }
    }

    try {
      // Ping with timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Docker ping timeout')), 3000)
      );
      const pingPromise = this.docker.ping();
      await Promise.race([pingPromise, timeoutPromise]);

      this.available = true;
      this.outputChannel.appendLine('[DockerManager] Docker is available');
      return true;
    } catch (err: any) {
      this.available = false;
      if (err.code === 'ENOENT') {
        this.outputChannel.appendLine('[DockerManager] Docker socket not found - Docker not installed?');
      } else if (err.code === 'ECONNREFUSED') {
        this.outputChannel.appendLine('[DockerManager] Docker daemon not running');
      } else {
        this.outputChannel.appendLine(`[DockerManager] Docker not available: ${err.message || err}`);
      }
      return false;
    }
  }

  /**
   * Refresh container list from Docker daemon
   */
  async refresh(): Promise<void> {
    if (!this.available) {
      const isAvailable = await this.checkAvailability();
      if (!isAvailable) {
        return;
      }
    }

    try {
      // List only running containers
      const containerList = await this.docker!.listContainers({ all: false });

      // Map to ContainerInfo
      this.containers = containerList.map(container => {
        const info: ContainerInfo = {
          id: container.Id.substring(0, 12), // First 12 chars for display
          name: (container.Names[0] || '').replace(/^\//, ''), // Remove leading /
          image: container.Image,
          state: container.State as ContainerInfo['state'],
          status: container.Status,
          ports: (container.Ports || [])
            .filter(p => p.PublicPort) // Only include mapped ports
            .map(p => ({
              hostPort: p.PublicPort!,
              containerPort: p.PrivatePort,
              protocol: p.Type || 'tcp',
            })),
          composeProject: container.Labels['com.docker.compose.project'],
          composeService: container.Labels['com.docker.compose.service'],
        };
        return info;
      });

      this._onDidChange.fire();
    } catch (err: any) {
      this.outputChannel.appendLine(`[DockerManager] Failed to list containers: ${err.message || err}`);
      this.containers = [];
    }
  }

  /**
   * Get all containers
   */
  getContainers(): ContainerInfo[] {
    return this.containers;
  }

  /**
   * Get containers grouped by Compose project
   */
  getComposeProjects(): ComposeProject[] {
    const projectMap = new Map<string, ContainerInfo[]>();

    for (const container of this.containers) {
      if (container.composeProject) {
        const existing = projectMap.get(container.composeProject) || [];
        existing.push(container);
        projectMap.set(container.composeProject, existing);
      }
    }

    return Array.from(projectMap.entries()).map(([name, containers]) => ({
      name,
      containers,
    }));
  }

  /**
   * Get standalone containers (not part of a Compose project)
   */
  getStandaloneContainers(): ContainerInfo[] {
    return this.containers.filter(c => !c.composeProject);
  }

  /**
   * Stop a container gracefully
   */
  async stopContainer(id: string): Promise<void> {
    try {
      const container = this.docker!.getContainer(id);
      await container.stop({ t: 10 }); // 10 second timeout before SIGKILL
      this.outputChannel.appendLine(`[DockerManager] Stopped container: ${id}`);
      await this.refresh();
    } catch (err: any) {
      this.outputChannel.appendLine(`[DockerManager] Failed to stop container ${id}: ${err.message || err}`);
      throw err;
    }
  }

  /**
   * Kill a container immediately
   */
  async killContainer(id: string): Promise<void> {
    try {
      const container = this.docker!.getContainer(id);
      await container.kill();
      this.outputChannel.appendLine(`[DockerManager] Killed container: ${id}`);
      await this.refresh();
    } catch (err: any) {
      this.outputChannel.appendLine(`[DockerManager] Failed to kill container ${id}: ${err.message || err}`);
      throw err;
    }
  }

  /**
   * Stop all containers in a Compose project
   */
  async stopComposeProject(projectName: string): Promise<void> {
    const project = this.getComposeProjects().find(p => p.name === projectName);
    if (!project) {
      this.outputChannel.appendLine(`[DockerManager] Compose project not found: ${projectName}`);
      return;
    }

    try {
      // Stop all containers in parallel
      await Promise.all(project.containers.map(c => this.stopContainer(c.id)));
      this.outputChannel.appendLine(`[DockerManager] Stopped Compose project: ${projectName} (${project.containers.length} containers)`);
    } catch (err: any) {
      this.outputChannel.appendLine(`[DockerManager] Failed to stop Compose project ${projectName}: ${err.message || err}`);
      throw err;
    }
  }

  /**
   * Check if Docker is available
   */
  get isAvailable(): boolean {
    return this.available;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
