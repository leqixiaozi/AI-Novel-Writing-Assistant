export interface DockerTargetConfig {
  port: number;
  user: string;
  database: string;
  bindAddress?: '127.0.0.1' | '0.0.0.0';
  dataDirectory?: string;
}
export function resolveDockerTarget(config: DockerTargetConfig): { bindAddress: string; mountType: 'volume' | 'bind'; source: string };
export function matchesDockerTarget(container: unknown, config: DockerTargetConfig, requireRunning?: boolean): boolean;
export function assertNewDataDirectory(directory: string): Promise<void>;
