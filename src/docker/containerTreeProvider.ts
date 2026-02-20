import * as vscode from 'vscode';
import type { DockerManager } from './dockerManager';
import type { ContainerInfo } from './types';

/**
 * TreeItem for container or compose project node
 */
class ContainerTreeItem extends vscode.TreeItem {
  public readonly containerInfo?: ContainerInfo;
  public readonly composeProject?: string;
  public readonly isProject: boolean;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options: {
      containerInfo?: ContainerInfo;
      composeProject?: string;
      isProject?: boolean;
      contextValue?: string;
      description?: string;
      tooltip?: string | vscode.MarkdownString;
    } = {}
  ) {
    super(label, collapsibleState);

    this.containerInfo = options.containerInfo;
    this.composeProject = options.composeProject;
    this.isProject = options.isProject || false;
    this.contextValue = options.contextValue;
    this.description = options.description;
    this.tooltip = options.tooltip;

    // Set icons
    if (this.isProject) {
      this.iconPath = new vscode.ThemeIcon('package');
    } else if (this.containerInfo) {
      // Icon based on container state
      const state = this.containerInfo.state;
      switch (state) {
        case 'running':
          this.iconPath = new vscode.ThemeIcon('debug-start', new vscode.ThemeColor('charts.green'));
          break;
        case 'paused':
          this.iconPath = new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.yellow'));
          break;
        case 'exited':
          this.iconPath = new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('descriptionForeground'));
          break;
        default:
          this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('descriptionForeground'));
          break;
      }
    }
  }
}

/**
 * TreeDataProvider for Docker containers
 */
export class ContainerTreeProvider implements vscode.TreeDataProvider<ContainerTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ContainerTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly dockerManager: DockerManager) {}

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ContainerTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ContainerTreeItem): vscode.ProviderResult<ContainerTreeItem[]> {
    // Check Docker availability
    if (!this.dockerManager.isAvailable) {
      if (!element) {
        // Show hint at root level
        const item = new ContainerTreeItem(
          'Docker not detected',
          vscode.TreeItemCollapsibleState.None,
          {
            contextValue: 'dockerNotFound',
            description: 'Click to refresh',
            tooltip: 'Docker is not installed or not running. Click refresh to retry.',
          }
        );
        item.command = {
          command: 'devwatch.refreshContainers',
          title: 'Refresh',
        };
        return [item];
      }
      return [];
    }

    // Root level: show compose projects and standalone containers
    if (!element) {
      const projects = this.dockerManager.getComposeProjects();
      const standalone = this.dockerManager.getStandaloneContainers();

      if (projects.length === 0 && standalone.length === 0) {
        const item = new ContainerTreeItem(
          'No running containers',
          vscode.TreeItemCollapsibleState.None,
          {
            contextValue: 'emptyState',
            description: 'Start a container',
            tooltip: 'No running containers detected',
          }
        );
        return [item];
      }

      const items: ContainerTreeItem[] = [];

      // Add compose projects
      for (const project of projects) {
        const item = new ContainerTreeItem(
          project.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          {
            composeProject: project.name,
            isProject: true,
            contextValue: 'composeProject',
            description: `(${project.containers.length})`,
            tooltip: `Docker Compose project: ${project.name}`,
          }
        );
        items.push(item);
      }

      // Add standalone containers
      for (const container of standalone) {
        items.push(this.createContainerItem(container));
      }

      return items;
    }

    // Compose project level: show containers in project
    if (element.isProject && element.composeProject) {
      const project = this.dockerManager.getComposeProjects().find(p => p.name === element.composeProject);
      if (!project) {
        return [];
      }

      return project.containers.map(c => this.createContainerItem(c));
    }

    return [];
  }

  /**
   * Create a ContainerTreeItem for a container
   */
  private createContainerItem(container: ContainerInfo): ContainerTreeItem {
    // Build description: image · status
    const description = `${container.image} · ${container.status}`;

    // Build tooltip with full details
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**ID:** ${container.id}\n\n`);
    tooltip.appendMarkdown(`**Image:** ${container.image}\n\n`);
    tooltip.appendMarkdown(`**State:** ${container.state}\n\n`);
    tooltip.appendMarkdown(`**Status:** ${container.status}\n\n`);

    if (container.ports.length > 0) {
      const portList = container.ports
        .map(p => `${p.hostPort}:${p.containerPort}/${p.protocol}`)
        .join(', ');
      tooltip.appendMarkdown(`**Ports:** ${portList}\n\n`);
    }

    if (container.composeService) {
      tooltip.appendMarkdown(`**Compose Service:** ${container.composeService}\n\n`);
    }

    return new ContainerTreeItem(
      container.name,
      vscode.TreeItemCollapsibleState.None,
      {
        containerInfo: container,
        contextValue: 'container',
        description,
        tooltip,
      }
    );
  }
}
