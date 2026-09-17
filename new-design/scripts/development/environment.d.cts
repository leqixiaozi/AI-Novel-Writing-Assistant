import type { DockerTargetConfig } from './docker-target.cjs';
export interface DevelopmentRuntimeConfig extends DockerTargetConfig { password: string; }
export function parseDevelopmentEnvironment(text: string): DevelopmentRuntimeConfig;
export function serializeDevelopmentEnvironment(config: DevelopmentRuntimeConfig): string;
export function readDevelopmentConfig(root: string): Promise<DevelopmentRuntimeConfig>;
export function dockerEnvironment(config: DevelopmentRuntimeConfig, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
