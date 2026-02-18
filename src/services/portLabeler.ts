import * as vscode from 'vscode';

interface BuiltInLabel {
  port: number;
  processPattern: string;
  label: string;
}

interface CustomLabel {
  port: number;
  label: string;
}

/**
 * Port labeling service with built-in web-dev focused defaults and custom label support
 */
export class PortLabeler {
  private static readonly BUILT_IN_LABELS: BuiltInLabel[] = [
    { port: 3000, processPattern: 'node', label: 'React/Next.js' },
    { port: 3000, processPattern: 'python', label: 'Python HTTP' },
    { port: 3001, processPattern: 'node', label: 'React/Next.js' },
    { port: 4200, processPattern: 'node', label: 'Angular' },
    { port: 5173, processPattern: 'node', label: 'Vite' },
    { port: 5174, processPattern: 'node', label: 'Vite' },
    { port: 8000, processPattern: 'python', label: 'Django/FastAPI' },
    { port: 8000, processPattern: 'node', label: 'Node HTTP' },
    { port: 8080, processPattern: 'node', label: 'HTTP Server' },
    { port: 8080, processPattern: 'java', label: 'Java/Tomcat' },
    { port: 8888, processPattern: 'python', label: 'Jupyter' },
    { port: 5432, processPattern: 'postgres', label: 'PostgreSQL' },
    { port: 3306, processPattern: 'mysql', label: 'MySQL' },
    { port: 27017, processPattern: 'mongod', label: 'MongoDB' },
    { port: 6379, processPattern: 'redis', label: 'Redis' },
    { port: 9200, processPattern: 'java', label: 'Elasticsearch' },
    { port: 5000, processPattern: 'node', label: 'Express/Node API' },
    { port: 5000, processPattern: 'python', label: 'Flask/FastAPI' },
    { port: 4000, processPattern: 'node', label: 'GraphQL' },
    { port: 9229, processPattern: 'node', label: 'Node Debugger' },
  ];

  /**
   * Get label for a port with process name context
   * Priority: custom labels (port match only) > built-in labels (port + process pattern) > fallback port-only built-in
   */
  getLabel(port: number, processName: string): string | undefined {
    // Check custom labels first (port match only)
    const customLabels = this.getCustomLabels();
    const customMatch = customLabels.find(l => l.port === port);
    if (customMatch) {
      return customMatch.label;
    }

    // Check built-in labels with process pattern match
    const processNameLower = processName.toLowerCase();
    const builtInMatch = PortLabeler.BUILT_IN_LABELS.find(
      l => l.port === port && processNameLower.includes(l.processPattern.toLowerCase())
    );
    if (builtInMatch) {
      return builtInMatch.label;
    }

    // Fallback to port-only built-in match (first match for that port)
    const portOnlyMatch = PortLabeler.BUILT_IN_LABELS.find(l => l.port === port);
    return portOnlyMatch?.label;
  }

  /**
   * Get default label for a port without process name context
   * Returns first built-in match for that port number
   */
  getDefaultLabel(port: number): string | undefined {
    const match = PortLabeler.BUILT_IN_LABELS.find(l => l.port === port);
    return match?.label;
  }

  /**
   * Read custom port labels from VS Code configuration
   */
  private getCustomLabels(): CustomLabel[] {
    const config = vscode.workspace.getConfiguration('devwatch');
    return config.get<CustomLabel[]>('customPortLabels', []);
  }
}
