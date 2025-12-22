/**
 * Security module exports
 */

export * from './threat-detector.js';
export * from './anomaly-detector.js';
export * from './vulnerability-scanner.js';
export { SourceCodeScanner, getRepositoryAccessInfo, createSourceCodeScanner } from './source-code-scanner.js';
export type { 
  RepositoryProvider, 
  RepositoryConfig, 
  SourceCodeScanResult, 
  Vulnerability as CodeVulnerability, 
  SecretFinding, 
  DependencyVulnerability,
  VulnerabilityType as CodeVulnerabilityType,
  VulnerabilityCounts,
  DependencyInfo,
  SecretType
} from './source-code-scanner.js';
