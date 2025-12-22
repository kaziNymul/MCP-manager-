/**
 * Source Code Scanner
 * 
 * Enterprise-grade static analysis for MCP server source code.
 * Scans for security vulnerabilities, secrets, and dangerous patterns.
 * 
 * Supported repository providers:
 * - GitHub (github.com, GitHub Enterprise)
 * - GitLab (gitlab.com, self-hosted)
 * - Bitbucket (bitbucket.org, Bitbucket Server)
 * - Azure DevOps
 * 
 * Permission requirements per provider:
 * - GitHub: Personal Access Token with `repo` scope, or GitHub App with `contents: read`
 * - GitLab: Personal Access Token with `read_repository` scope
 * - Bitbucket: App Password with `repository:read`
 * - Azure DevOps: PAT with `Code (Read)`
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('source-code-scanner');

// ============================================================================
// TYPES
// ============================================================================

export type RepositoryProvider = 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'AZURE_DEVOPS' | 'CUSTOM';

export interface RepositoryConfig {
  provider: RepositoryProvider;
  url: string;
  branch: string;
  path: string;
  token: string;  // Access token for reading repository
}

export interface SourceCodeScanResult {
  success: boolean;
  scanType: 'SOURCE_CODE' | 'DEPENDENCY' | 'SECRET_DETECTION' | 'FULL';
  startedAt: Date;
  completedAt: Date;
  
  // Repository info
  repository: {
    url: string;
    branch: string;
    commitHash?: string;
    path: string;
  };
  
  // Files scanned
  filesScanned: number;
  linesScanned: number;
  
  // Vulnerabilities
  vulnerabilities: Vulnerability[];
  vulnerabilityCounts: VulnerabilityCounts;
  
  // Dependencies
  dependencies?: DependencyInfo[];
  dependencyVulnerabilities?: DependencyVulnerability[];
  
  // Secrets detected
  secretsDetected?: SecretFinding[];
  
  // Overall risk
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  
  // Error if failed
  error?: string;
}

export interface Vulnerability {
  id: string;
  type: VulnerabilityType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'INFO';
  title: string;
  description: string;
  file: string;
  line: number;
  column?: number;
  code?: string;
  cwe?: string;
  remediation?: string;
}

export type VulnerabilityType =
  | 'SQL_INJECTION'
  | 'COMMAND_INJECTION'
  | 'CODE_INJECTION'
  | 'PATH_TRAVERSAL'
  | 'SSRF'
  | 'XSS'
  | 'HARDCODED_SECRET'
  | 'INSECURE_CRYPTO'
  | 'INSECURE_RANDOM'
  | 'INSECURE_DESERIALIZATION'
  | 'BUFFER_OVERFLOW'
  | 'RACE_CONDITION'
  | 'UNVALIDATED_INPUT'
  | 'DANGEROUS_FUNCTION'
  | 'MISSING_AUTH'
  | 'SENSITIVE_DATA_EXPOSURE'
  | 'DEPENDENCY_VULNERABILITY'
  | 'MISCONFIGURATION';

export interface VulnerabilityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'npm' | 'pip' | 'go' | 'cargo' | 'maven' | 'gradle' | 'nuget';
  isDev: boolean;
  hasVulnerabilities: boolean;
}

export interface DependencyVulnerability {
  package: string;
  version: string;
  vulnerableVersions: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cve?: string;
  ghsa?: string;
  title: string;
  description: string;
  fixedIn?: string;
  url?: string;
}

export interface SecretFinding {
  type: SecretType;
  file: string;
  line: number;
  match: string;  // Redacted match (e.g., "sk-***...***")
  severity: 'HIGH' | 'CRITICAL';
  description: string;
}

export type SecretType =
  | 'AWS_ACCESS_KEY'
  | 'AWS_SECRET_KEY'
  | 'GITHUB_TOKEN'
  | 'GITLAB_TOKEN'
  | 'SLACK_TOKEN'
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'PRIVATE_KEY'
  | 'DATABASE_URL'
  | 'GENERIC_SECRET'
  | 'GENERIC_API_KEY'
  | 'GENERIC_PASSWORD';

// ============================================================================
// SECURITY PATTERNS
// ============================================================================

/**
 * Dangerous code patterns to detect in source code
 */
const CODE_VULNERABILITY_PATTERNS: Array<{
  type: VulnerabilityType;
  pattern: RegExp;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  cwe?: string;
  languages: string[];
}> = [
  // -------------------------------------------------------------------------
  // COMMAND INJECTION
  // -------------------------------------------------------------------------
  {
    type: 'COMMAND_INJECTION',
    pattern: /child_process\s*\.\s*(exec|execSync|spawn|spawnSync)\s*\([^)]*\$\{/g,
    severity: 'CRITICAL',
    title: 'Command Injection via Template Literal',
    description: 'User input may be passed to shell command without sanitization',
    cwe: 'CWE-78',
    languages: ['javascript', 'typescript'],
  },
  {
    type: 'COMMAND_INJECTION',
    pattern: /subprocess\.(call|run|Popen)\s*\(\s*[^\]]*\+.*shell\s*=\s*True/g,
    severity: 'CRITICAL',
    title: 'Command Injection with shell=True',
    description: 'Using shell=True with string concatenation allows command injection',
    cwe: 'CWE-78',
    languages: ['python'],
  },
  {
    type: 'COMMAND_INJECTION',
    pattern: /os\.(system|popen)\s*\([^)]*(\+|%|f['"])/g,
    severity: 'CRITICAL',
    title: 'OS Command Injection',
    description: 'User input in os.system/popen call',
    cwe: 'CWE-78',
    languages: ['python'],
  },
  {
    type: 'COMMAND_INJECTION',
    pattern: /`.*\$\{.*\}`/g,
    severity: 'HIGH',
    title: 'Potential Shell Command Interpolation',
    description: 'Template literal may contain shell command with user input',
    cwe: 'CWE-78',
    languages: ['javascript', 'typescript'],
  },
  
  // -------------------------------------------------------------------------
  // SQL INJECTION
  // -------------------------------------------------------------------------
  {
    type: 'SQL_INJECTION',
    pattern: /(?:execute|query|raw)\s*\(\s*[`'"].*\$\{/g,
    severity: 'CRITICAL',
    title: 'SQL Injection via String Interpolation',
    description: 'SQL query built with template literals may allow injection',
    cwe: 'CWE-89',
    languages: ['javascript', 'typescript'],
  },
  {
    type: 'SQL_INJECTION',
    pattern: /(?:execute|cursor\.execute)\s*\(\s*[f'"]+.*%[sdf]/g,
    severity: 'CRITICAL',
    title: 'SQL Injection via String Formatting',
    description: 'SQL query built with f-strings or % formatting',
    cwe: 'CWE-89',
    languages: ['python'],
  },
  {
    type: 'SQL_INJECTION',
    pattern: /\.query\s*\(\s*['"`].*\+/g,
    severity: 'HIGH',
    title: 'SQL Injection via String Concatenation',
    description: 'SQL query built with string concatenation',
    cwe: 'CWE-89',
    languages: ['javascript', 'typescript', 'python'],
  },
  
  // -------------------------------------------------------------------------
  // CODE INJECTION
  // -------------------------------------------------------------------------
  {
    type: 'CODE_INJECTION',
    pattern: /\beval\s*\([^)]*(?:req|request|input|body|query|params)/gi,
    severity: 'CRITICAL',
    title: 'Code Injection via eval()',
    description: 'User input passed to eval() function',
    cwe: 'CWE-94',
    languages: ['javascript', 'typescript', 'python'],
  },
  {
    type: 'CODE_INJECTION',
    pattern: /new\s+Function\s*\([^)]*(?:req|request|input|body|query|params)/gi,
    severity: 'CRITICAL',
    title: 'Code Injection via Function Constructor',
    description: 'User input passed to Function constructor',
    cwe: 'CWE-94',
    languages: ['javascript', 'typescript'],
  },
  {
    type: 'CODE_INJECTION',
    pattern: /exec\s*\(\s*compile\s*\(/g,
    severity: 'CRITICAL',
    title: 'Code Injection via exec(compile())',
    description: 'Dynamic code execution',
    cwe: 'CWE-94',
    languages: ['python'],
  },
  
  // -------------------------------------------------------------------------
  // PATH TRAVERSAL
  // -------------------------------------------------------------------------
  {
    type: 'PATH_TRAVERSAL',
    pattern: /(?:readFile|writeFile|createReadStream|createWriteStream)\s*\([^)]*(?:req|request|input|body|query|params)/gi,
    severity: 'HIGH',
    title: 'Path Traversal in File Operations',
    description: 'User input used in file path without sanitization',
    cwe: 'CWE-22',
    languages: ['javascript', 'typescript'],
  },
  {
    type: 'PATH_TRAVERSAL',
    pattern: /open\s*\([^)]*(?:request|input|args)/gi,
    severity: 'HIGH',
    title: 'Path Traversal in File Open',
    description: 'User input used in file path',
    cwe: 'CWE-22',
    languages: ['python'],
  },
  
  // -------------------------------------------------------------------------
  // SSRF
  // -------------------------------------------------------------------------
  {
    type: 'SSRF',
    pattern: /(?:fetch|axios|request|got|http\.get|https\.get)\s*\([^)]*(?:req|request|input|body|query|params)/gi,
    severity: 'HIGH',
    title: 'Server-Side Request Forgery (SSRF)',
    description: 'User input used in URL for server-side request',
    cwe: 'CWE-918',
    languages: ['javascript', 'typescript'],
  },
  {
    type: 'SSRF',
    pattern: /requests?\.(get|post|put|delete|head)\s*\([^)]*(?:request|input|args)/gi,
    severity: 'HIGH',
    title: 'SSRF in Python Requests',
    description: 'User input used in requests library call',
    cwe: 'CWE-918',
    languages: ['python'],
  },
  
  // -------------------------------------------------------------------------
  // INSECURE CRYPTO
  // -------------------------------------------------------------------------
  {
    type: 'INSECURE_CRYPTO',
    pattern: /crypto\.createCipher\s*\(\s*['"](?:des|rc4|md5)/gi,
    severity: 'HIGH',
    title: 'Weak Cryptographic Algorithm',
    description: 'Using deprecated/weak encryption algorithm',
    cwe: 'CWE-327',
    languages: ['javascript', 'typescript'],
  },
  {
    type: 'INSECURE_CRYPTO',
    pattern: /hashlib\.(?:md5|sha1)\s*\(/g,
    severity: 'MEDIUM',
    title: 'Weak Hash Algorithm',
    description: 'Using MD5 or SHA1 for hashing (not for checksums)',
    cwe: 'CWE-328',
    languages: ['python'],
  },
  
  // -------------------------------------------------------------------------
  // INSECURE RANDOM
  // -------------------------------------------------------------------------
  {
    type: 'INSECURE_RANDOM',
    pattern: /Math\.random\s*\(\s*\).*(?:token|secret|password|key|auth|session)/gi,
    severity: 'HIGH',
    title: 'Insecure Random for Security Purpose',
    description: 'Math.random() is not cryptographically secure',
    cwe: 'CWE-330',
    languages: ['javascript', 'typescript'],
  },
  {
    type: 'INSECURE_RANDOM',
    pattern: /random\.(?:random|randint|choice)\s*\(.*(?:token|secret|password|key)/gi,
    severity: 'HIGH',
    title: 'Insecure Random for Security Purpose',
    description: 'random module is not cryptographically secure',
    cwe: 'CWE-330',
    languages: ['python'],
  },
  
  // -------------------------------------------------------------------------
  // DANGEROUS FUNCTIONS
  // -------------------------------------------------------------------------
  {
    type: 'DANGEROUS_FUNCTION',
    pattern: /\bpickle\.load/g,
    severity: 'HIGH',
    title: 'Insecure Deserialization with pickle',
    description: 'pickle.load can execute arbitrary code',
    cwe: 'CWE-502',
    languages: ['python'],
  },
  {
    type: 'DANGEROUS_FUNCTION',
    pattern: /yaml\.load\s*\([^)]*(?!Loader)/g,
    severity: 'HIGH',
    title: 'Insecure YAML Loading',
    description: 'yaml.load without safe Loader can execute code',
    cwe: 'CWE-502',
    languages: ['python'],
  },
  {
    type: 'DANGEROUS_FUNCTION',
    pattern: /dangerouslySetInnerHTML/g,
    severity: 'MEDIUM',
    title: 'Potential XSS via dangerouslySetInnerHTML',
    description: 'React dangerouslySetInnerHTML can lead to XSS',
    cwe: 'CWE-79',
    languages: ['javascript', 'typescript'],
  },
  
  // -------------------------------------------------------------------------
  // UNVALIDATED INPUT
  // -------------------------------------------------------------------------
  {
    type: 'UNVALIDATED_INPUT',
    pattern: /JSON\.parse\s*\(\s*(?:req|request)\.body/g,
    severity: 'MEDIUM',
    title: 'Unvalidated JSON Parsing',
    description: 'Request body parsed without validation',
    cwe: 'CWE-20',
    languages: ['javascript', 'typescript'],
  },
  
  // -------------------------------------------------------------------------
  // SENSITIVE DATA EXPOSURE
  // -------------------------------------------------------------------------
  {
    type: 'SENSITIVE_DATA_EXPOSURE',
    pattern: /console\.(log|info|debug|warn|error)\s*\([^)]*(?:password|secret|token|key|credential)/gi,
    severity: 'MEDIUM',
    title: 'Sensitive Data in Logs',
    description: 'Potentially logging sensitive information',
    cwe: 'CWE-532',
    languages: ['javascript', 'typescript'],
  },
  {
    type: 'SENSITIVE_DATA_EXPOSURE',
    pattern: /print\s*\([^)]*(?:password|secret|token|key|credential)/gi,
    severity: 'MEDIUM',
    title: 'Sensitive Data in Print Statement',
    description: 'Potentially printing sensitive information',
    cwe: 'CWE-532',
    languages: ['python'],
  },
];

/**
 * Secret detection patterns
 */
const SECRET_PATTERNS: Array<{
  type: SecretType;
  pattern: RegExp;
  severity: 'HIGH' | 'CRITICAL';
  description: string;
}> = [
  {
    type: 'AWS_ACCESS_KEY',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'CRITICAL',
    description: 'AWS Access Key ID',
  },
  {
    type: 'AWS_SECRET_KEY',
    pattern: /[A-Za-z0-9/+=]{40}(?=.*aws|.*secret)/gi,
    severity: 'CRITICAL',
    description: 'AWS Secret Access Key',
  },
  {
    type: 'GITHUB_TOKEN',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    severity: 'CRITICAL',
    description: 'GitHub Personal Access Token',
  },
  {
    type: 'GITLAB_TOKEN',
    pattern: /glpat-[A-Za-z0-9\-_]{20,}/g,
    severity: 'CRITICAL',
    description: 'GitLab Personal Access Token',
  },
  {
    type: 'SLACK_TOKEN',
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    severity: 'CRITICAL',
    description: 'Slack Token',
  },
  {
    type: 'OPENAI_API_KEY',
    pattern: /sk-[A-Za-z0-9]{32,}/g,
    severity: 'CRITICAL',
    description: 'OpenAI API Key',
  },
  {
    type: 'ANTHROPIC_API_KEY',
    pattern: /sk-ant-[A-Za-z0-9-]{32,}/g,
    severity: 'CRITICAL',
    description: 'Anthropic API Key',
  },
  {
    type: 'PRIVATE_KEY',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    severity: 'CRITICAL',
    description: 'Private Key',
  },
  {
    type: 'DATABASE_URL',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/gi,
    severity: 'CRITICAL',
    description: 'Database Connection String with Credentials',
  },
  {
    type: 'GENERIC_API_KEY',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/gi,
    severity: 'HIGH',
    description: 'Generic API Key',
  },
  {
    type: 'GENERIC_PASSWORD',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    severity: 'HIGH',
    description: 'Hardcoded Password',
  },
  {
    type: 'GENERIC_SECRET',
    pattern: /(?:secret|token|auth)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi,
    severity: 'HIGH',
    description: 'Hardcoded Secret or Token',
  },
];

// ============================================================================
// REPOSITORY ACCESS
// ============================================================================

/**
 * Get repository access configuration per provider
 */
export function getRepositoryAccessInfo(provider: RepositoryProvider): {
  tokenName: string;
  requiredScopes: string[];
  setupUrl: string;
  instructions: string;
} {
  switch (provider) {
    case 'GITHUB':
      return {
        tokenName: 'Personal Access Token (Classic) or Fine-grained Token',
        requiredScopes: ['repo (full control)', 'or contents:read for fine-grained'],
        setupUrl: 'https://github.com/settings/tokens',
        instructions: `
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate new token (classic) or Fine-grained token
3. For classic token: Select 'repo' scope (or 'public_repo' for public repos only)
4. For fine-grained token: 
   - Select repository access (specific repos or all)
   - Under "Repository permissions", set "Contents" to "Read-only"
5. Copy the token and use it as REPOSITORY_ACCESS_TOKEN
        `.trim(),
      };
    
    case 'GITLAB':
      return {
        tokenName: 'Personal Access Token',
        requiredScopes: ['read_repository'],
        setupUrl: 'https://gitlab.com/-/profile/personal_access_tokens',
        instructions: `
1. Go to GitLab User Settings → Access Tokens
2. Create a new personal access token
3. Select scope: 'read_repository'
4. Set expiration date (recommended: 90 days)
5. Copy the token and use it as REPOSITORY_ACCESS_TOKEN
        `.trim(),
      };
    
    case 'BITBUCKET':
      return {
        tokenName: 'App Password',
        requiredScopes: ['repository:read'],
        setupUrl: 'https://bitbucket.org/account/settings/app-passwords/',
        instructions: `
1. Go to Bitbucket Settings → App passwords
2. Create an app password
3. Select permission: 'Repositories: Read'
4. Copy the password and use it as REPOSITORY_ACCESS_TOKEN
5. For authentication, use: username:app_password
        `.trim(),
      };
    
    case 'AZURE_DEVOPS':
      return {
        tokenName: 'Personal Access Token (PAT)',
        requiredScopes: ['Code (Read)'],
        setupUrl: 'https://dev.azure.com/{organization}/_usersSettings/tokens',
        instructions: `
1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Create new token
3. Set scope: 'Code: Read'
4. Set organization access (specific org or all accessible)
5. Copy the token and use it as REPOSITORY_ACCESS_TOKEN
        `.trim(),
      };
    
    case 'CUSTOM':
      return {
        tokenName: 'Bearer Token or Basic Auth',
        requiredScopes: ['read access to repository'],
        setupUrl: 'Contact your Git administrator',
        instructions: `
For custom/self-hosted Git servers:
1. Obtain read access credentials from your administrator
2. Use Bearer token or Basic auth (username:password)
3. Ensure the token has read access to repository contents
        `.trim(),
      };
  }
}

// ============================================================================
// SOURCE CODE SCANNER CLASS
// ============================================================================

export class SourceCodeScanner {
  private repoConfig: RepositoryConfig;
  
  constructor(config: RepositoryConfig) {
    this.repoConfig = config;
  }
  
  /**
   * Fetch file content from repository
   */
  private async fetchFileContent(filePath: string): Promise<string | null> {
    const { provider, url, branch, token } = this.repoConfig;
    
    let apiUrl: string;
    let headers: Record<string, string> = {};
    
    // Parse owner/repo from URL
    const urlMatch = url.match(/(?:github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com)[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!urlMatch) {
      throw new Error(`Invalid repository URL: ${url}`);
    }
    const [, owner, repo] = urlMatch;
    
    switch (provider) {
      case 'GITHUB':
        // GitHub API: GET /repos/{owner}/{repo}/contents/{path}
        apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
        headers = {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3.raw',
          'User-Agent': 'MCP-Manager-Scanner/1.0',
        };
        break;
      
      case 'GITLAB':
        // GitLab API: GET /projects/{id}/repository/files/{path}/raw
        const encodedPath = encodeURIComponent(filePath);
        apiUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/files/${encodedPath}/raw?ref=${branch}`;
        headers = {
          'PRIVATE-TOKEN': token,
        };
        break;
      
      case 'BITBUCKET':
        // Bitbucket API: GET /repositories/{workspace}/{repo}/src/{commit}/{path}
        apiUrl = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/src/${branch}/${filePath}`;
        headers = {
          'Authorization': `Bearer ${token}`,
        };
        break;
      
      case 'AZURE_DEVOPS':
        // Azure DevOps API: GET /{org}/{project}/_apis/git/repositories/{repo}/items
        apiUrl = `https://dev.azure.com/${owner}/${repo}/_apis/git/repositories/${repo}/items?path=${filePath}&versionDescriptor.version=${branch}&api-version=7.0`;
        headers = {
          'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
        };
        break;
      
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
    
    try {
      const response = await fetch(apiUrl, { headers });
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to fetch file: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to fetch file content');
      return null;
    }
  }
  
  /**
   * List files in repository
   */
  private async listFiles(path: string = ''): Promise<Array<{ path: string; type: 'file' | 'dir' }>> {
    const { provider, url, branch, token } = this.repoConfig;
    
    const urlMatch = url.match(/(?:github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com)[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!urlMatch) {
      throw new Error(`Invalid repository URL: ${url}`);
    }
    const [, owner, repo] = urlMatch;
    
    let apiUrl: string;
    let headers: Record<string, string> = {};
    
    switch (provider) {
      case 'GITHUB':
        apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
        headers = {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MCP-Manager-Scanner/1.0',
        };
        break;
      
      case 'GITLAB':
        const encodedPath = path ? `&path=${encodeURIComponent(path)}` : '';
        apiUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/tree?ref=${branch}${encodedPath}&recursive=true`;
        headers = {
          'PRIVATE-TOKEN': token,
        };
        break;
      
      default:
        // For other providers, implement as needed
        return [];
    }
    
    try {
      const response = await fetch(apiUrl, { headers });
      if (!response.ok) {
        throw new Error(`Failed to list files: ${response.status}`);
      }
      
      const data = await response.json() as any;
      
      if (provider === 'GITHUB') {
        if (!Array.isArray(data)) {
          return [{ path: data.path, type: data.type === 'file' ? 'file' : 'dir' }];
        }
        return data.map((item: any) => ({
          path: item.path,
          type: item.type === 'file' ? 'file' : 'dir',
        }));
      }
      
      if (provider === 'GITLAB') {
        return data.map((item: any) => ({
          path: item.path,
          type: item.type === 'blob' ? 'file' : 'dir',
        }));
      }
      
      return [];
    } catch (error) {
      logger.error({ error, path }, 'Failed to list files');
      return [];
    }
  }
  
  /**
   * Scan source code for vulnerabilities
   */
  async scanSourceCode(): Promise<SourceCodeScanResult> {
    const startedAt = new Date();
    const vulnerabilities: Vulnerability[] = [];
    const secretsDetected: SecretFinding[] = [];
    let filesScanned = 0;
    let linesScanned = 0;
    
    logger.info({ url: this.repoConfig.url }, 'Starting source code scan');
    
    try {
      // Get list of files
      const files = await this.listFiles(this.repoConfig.path);
      const codeFiles = files.filter((f) => 
        f.type === 'file' && 
        /\.(js|ts|jsx|tsx|py|go|java|cs|rb|php|rs|c|cpp|h|hpp)$/.test(f.path)
      );
      
      logger.info({ fileCount: codeFiles.length }, 'Found code files to scan');
      
      // Scan each file
      for (const file of codeFiles) {
        const content = await this.fetchFileContent(file.path);
        if (!content) continue;
        
        filesScanned++;
        const lines = content.split('\n');
        linesScanned += lines.length;
        
        // Detect language
        const language = this.detectLanguage(file.path);
        
        // Scan for code vulnerabilities
        const fileVulns = this.scanFileForVulnerabilities(file.path, content, language);
        vulnerabilities.push(...fileVulns);
        
        // Scan for secrets
        const fileSecrets = this.scanFileForSecrets(file.path, content);
        secretsDetected.push(...fileSecrets);
      }
      
      // Calculate vulnerability counts
      const vulnerabilityCounts = this.calculateVulnerabilityCounts(vulnerabilities, secretsDetected);
      
      // Calculate risk score
      const riskScore = this.calculateRiskScore(vulnerabilityCounts);
      const riskLevel = this.getRiskLevel(riskScore);
      
      const completedAt = new Date();
      
      logger.info({
        filesScanned,
        linesScanned,
        vulnerabilities: vulnerabilities.length,
        secrets: secretsDetected.length,
        riskScore,
      }, 'Source code scan completed');
      
      return {
        success: true,
        scanType: 'SOURCE_CODE',
        startedAt,
        completedAt,
        repository: {
          url: this.repoConfig.url,
          branch: this.repoConfig.branch,
          path: this.repoConfig.path,
        },
        filesScanned,
        linesScanned,
        vulnerabilities,
        vulnerabilityCounts,
        secretsDetected,
        riskScore,
        riskLevel,
      };
    } catch (error) {
      const completedAt = new Date();
      logger.error({ error }, 'Source code scan failed');
      
      return {
        success: false,
        scanType: 'SOURCE_CODE',
        startedAt,
        completedAt,
        repository: {
          url: this.repoConfig.url,
          branch: this.repoConfig.branch,
          path: this.repoConfig.path,
        },
        filesScanned,
        linesScanned,
        vulnerabilities: [],
        vulnerabilityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
        riskScore: 0,
        riskLevel: 'LOW',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Detect programming language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'go': 'go',
      'java': 'java',
      'cs': 'csharp',
      'rb': 'ruby',
      'php': 'php',
      'rs': 'rust',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
    };
    return languageMap[ext || ''] || 'unknown';
  }
  
  /**
   * Scan a single file for code vulnerabilities
   */
  private scanFileForVulnerabilities(
    filePath: string,
    content: string,
    language: string
  ): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    const lines = content.split('\n');
    
    for (const pattern of CODE_VULNERABILITY_PATTERNS) {
      // Check if pattern applies to this language
      if (!pattern.languages.includes(language)) continue;
      
      // Reset regex
      pattern.pattern.lastIndex = 0;
      
      let match;
      while ((match = pattern.pattern.exec(content)) !== null) {
        // Find line number
        const linesBefore = content.substring(0, match.index).split('\n');
        const lineNumber = linesBefore.length;
        
        vulnerabilities.push({
          id: `vuln-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: pattern.type,
          severity: pattern.severity,
          title: pattern.title,
          description: pattern.description,
          file: filePath,
          line: lineNumber,
          code: lines[lineNumber - 1]?.trim().substring(0, 100),
          cwe: pattern.cwe,
          remediation: this.getRemediation(pattern.type),
        });
      }
    }
    
    return vulnerabilities;
  }
  
  /**
   * Scan a single file for secrets
   */
  private scanFileForSecrets(filePath: string, content: string): SecretFinding[] {
    const secrets: SecretFinding[] = [];
    const lines = content.split('\n');
    
    // Skip common non-code files
    if (/\.(md|txt|json|yaml|yml|lock)$/.test(filePath) && 
        !filePath.includes('.env')) {
      return [];
    }
    
    for (const pattern of SECRET_PATTERNS) {
      // Reset regex
      pattern.pattern.lastIndex = 0;
      
      let match;
      while ((match = pattern.pattern.exec(content)) !== null) {
        const linesBefore = content.substring(0, match.index).split('\n');
        const lineNumber = linesBefore.length;
        
        // Redact the secret
        const secret = match[0];
        const redacted = secret.length > 8
          ? secret.substring(0, 4) + '***...' + secret.substring(secret.length - 4)
          : '***';
        
        secrets.push({
          type: pattern.type,
          file: filePath,
          line: lineNumber,
          match: redacted,
          severity: pattern.severity,
          description: pattern.description,
        });
      }
    }
    
    return secrets;
  }
  
  /**
   * Calculate vulnerability counts
   */
  private calculateVulnerabilityCounts(
    vulnerabilities: Vulnerability[],
    secrets: SecretFinding[]
  ): VulnerabilityCounts {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
    
    for (const v of vulnerabilities) {
      switch (v.severity) {
        case 'CRITICAL': counts.critical++; break;
        case 'HIGH': counts.high++; break;
        case 'MEDIUM': counts.medium++; break;
        case 'LOW': counts.low++; break;
        case 'INFO': counts.info++; break;
      }
    }
    
    for (const s of secrets) {
      if (s.severity === 'CRITICAL') counts.critical++;
      else counts.high++;
    }
    
    counts.total = vulnerabilities.length + secrets.length;
    return counts;
  }
  
  /**
   * Calculate overall risk score (0-100)
   */
  private calculateRiskScore(counts: VulnerabilityCounts): number {
    // Weighted formula
    const score = 
      counts.critical * 25 +
      counts.high * 15 +
      counts.medium * 5 +
      counts.low * 1 +
      counts.info * 0;
    
    // Cap at 100
    return Math.min(100, score);
  }
  
  /**
   * Get risk level from score
   */
  private getRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score <= 10) return 'LOW';
    if (score <= 40) return 'MEDIUM';
    if (score <= 70) return 'HIGH';
    return 'CRITICAL';
  }
  
  /**
   * Get remediation advice for vulnerability type
   */
  private getRemediation(type: VulnerabilityType): string {
    const remediations: Record<VulnerabilityType, string> = {
      SQL_INJECTION: 'Use parameterized queries or prepared statements. Never concatenate user input into SQL strings.',
      COMMAND_INJECTION: 'Avoid shell commands with user input. Use libraries with proper argument escaping or whitelist allowed commands.',
      CODE_INJECTION: 'Never use eval() or Function() with user input. Use safe alternatives like JSON.parse() for data.',
      PATH_TRAVERSAL: 'Validate and sanitize file paths. Use path.resolve() and check if resolved path is within allowed directory.',
      SSRF: 'Validate and whitelist allowed URLs/hosts. Block internal IP ranges and metadata endpoints.',
      XSS: 'Escape user input before rendering. Use framework-provided sanitization. Set Content-Security-Policy headers.',
      HARDCODED_SECRET: 'Move secrets to environment variables or a secrets manager. Never commit secrets to version control.',
      INSECURE_CRYPTO: 'Use modern algorithms like AES-256-GCM for encryption and SHA-256/SHA-3 for hashing.',
      INSECURE_RANDOM: 'Use crypto.randomBytes() in Node.js or secrets module in Python for security-sensitive random values.',
      INSECURE_DESERIALIZATION: 'Avoid deserializing untrusted data. Use safe formats like JSON with schema validation.',
      BUFFER_OVERFLOW: 'Use safe string handling functions. Check buffer sizes before operations.',
      RACE_CONDITION: 'Use proper synchronization primitives. Implement atomic operations where needed.',
      UNVALIDATED_INPUT: 'Validate all user input against expected schemas. Use libraries like Zod or Joi.',
      DANGEROUS_FUNCTION: 'Replace with safer alternatives. Consult security best practices for your language.',
      MISSING_AUTH: 'Implement proper authentication and authorization checks on all endpoints.',
      SENSITIVE_DATA_EXPOSURE: 'Never log sensitive data. Mask or redact credentials in logs.',
      DEPENDENCY_VULNERABILITY: 'Update to patched version. If no patch available, consider alternative packages.',
      MISCONFIGURATION: 'Review security configuration. Follow security hardening guides for your framework.',
    };
    return remediations[type] || 'Review and fix the identified security issue.';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a source code scanner from environment variables
 */
export function createSourceCodeScanner(
  repositoryUrl: string,
  provider: RepositoryProvider,
  options?: {
    branch?: string;
    path?: string;
    token?: string;
  }
): SourceCodeScanner | null {
  // Try to get token from environment
  const token = options?.token || 
    process.env.REPOSITORY_ACCESS_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GITLAB_TOKEN ||
    process.env.BITBUCKET_TOKEN;
  
  if (!token) {
    logger.warn('Source code scanning disabled: No repository access token configured');
    return null;
  }
  
  return new SourceCodeScanner({
    provider,
    url: repositoryUrl,
    branch: options?.branch || 'main',
    path: options?.path || '/',
    token,
  });
}
