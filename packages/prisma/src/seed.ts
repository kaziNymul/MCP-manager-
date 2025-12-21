import { PrismaClient, PlanType, OrgRole, ServerStatus, TransportType, VersionStatus, RiskLevel, PolicyType, UserStatus } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding MCP Manager database...\n');

  // Clean existing data
  console.log('Cleaning existing data...');
  await prisma.auditEvent.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.scanJob.deleteMany();
  await prisma.toolSchema.deleteMany();
  await prisma.teamServerAccess.deleteMany();
  await prisma.serverVersion.deleteMany();
  await prisma.server.deleteMany();
  await prisma.policy.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.organization.deleteMany();

  // ============================================================================
  // Create Organizations
  // ============================================================================
  console.log('Creating organizations...');
  
  const acmeCorp = await prisma.organization.create({
    data: {
      name: 'acme-corp',
      displayName: 'Acme Corporation',
      slug: 'acme',
      plan: PlanType.ENTERPRISE,
      settings: {
        autoApproveThreshold: 30,
        requireApprovalForWrites: true,
        defaultEnvironment: 'development',
      },
    },
  });

  const startupInc = await prisma.organization.create({
    data: {
      name: 'startup-inc',
      displayName: 'Startup Inc',
      slug: 'startup',
      plan: PlanType.TEAM,
      settings: {
        autoApproveThreshold: 50,
        requireApprovalForWrites: false,
      },
    },
  });

  console.log(`  ✓ Created org: ${acmeCorp.displayName}`);
  console.log(`  ✓ Created org: ${startupInc.displayName}`);

  // ============================================================================
  // Create Users
  // ============================================================================
  console.log('\nCreating users...');

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@acme.com',
      name: 'Alice Admin',
      orgId: acmeCorp.id,
      role: OrgRole.OWNER,
      externalId: 'auth0|admin123',
      status: UserStatus.ACTIVE,
    },
  });

  const devUser = await prisma.user.create({
    data: {
      email: 'dev@acme.com',
      name: 'Bob Developer',
      orgId: acmeCorp.id,
      role: OrgRole.MEMBER,
      externalId: 'auth0|dev456',
      status: UserStatus.ACTIVE,
    },
  });

  const securityUser = await prisma.user.create({
    data: {
      email: 'security@acme.com',
      name: 'Carol Security',
      orgId: acmeCorp.id,
      role: OrgRole.ADMIN,
      externalId: 'auth0|sec789',
      status: UserStatus.ACTIVE,
    },
  });

  console.log(`  ✓ Created user: ${adminUser.name}`);
  console.log(`  ✓ Created user: ${devUser.name}`);
  console.log(`  ✓ Created user: ${securityUser.name}`);

  // ============================================================================
  // Create Teams
  // ============================================================================
  console.log('\nCreating teams...');

  const platformTeam = await prisma.team.create({
    data: {
      name: 'platform',
      displayName: 'Platform Team',
      description: 'Infrastructure and platform engineering',
      orgId: acmeCorp.id,
      environment: 'production',
      settings: {
        maxRatePerMinute: 100,
        allowDestructiveTools: false,
      },
    },
  });

  const devTeam = await prisma.team.create({
    data: {
      name: 'developers',
      displayName: 'Development Team',
      description: 'Application developers',
      orgId: acmeCorp.id,
      environment: 'development',
      settings: {
        maxRatePerMinute: 200,
        allowDestructiveTools: false,
      },
    },
  });

  console.log(`  ✓ Created team: ${platformTeam.displayName}`);
  console.log(`  ✓ Created team: ${devTeam.displayName}`);

  // Add team memberships
  await prisma.teamMember.createMany({
    data: [
      { userId: adminUser.id, teamId: platformTeam.id, role: 'LEAD' },
      { userId: securityUser.id, teamId: platformTeam.id, role: 'MEMBER' },
      { userId: devUser.id, teamId: devTeam.id, role: 'MEMBER' },
      { userId: adminUser.id, teamId: devTeam.id, role: 'LEAD' },
    ],
  });

  // ============================================================================
  // Create MCP Servers
  // ============================================================================
  console.log('\nCreating MCP servers...');

  // GitHub Integration Server (Approved)
  const githubServer = await prisma.server.create({
    data: {
      name: 'acme/github-integration',
      displayName: 'GitHub Integration',
      description: 'Read-only GitHub repository access for code context',
      orgId: acmeCorp.id,
      endpoint: 'https://github-mcp.internal.acme.com',
      transport: TransportType.HTTP_SSE,
      status: ServerStatus.ACTIVE,
      isPublic: false,
      homepage: 'https://wiki.acme.com/mcp/github',
      maintainer: 'platform@acme.com',
      tags: ['github', 'vcs', 'read-only'],
    },
  });

  const githubVersion = await prisma.serverVersion.create({
    data: {
      serverId: githubServer.id,
      version: '1.2.0',
      status: VersionStatus.APPROVED,
      riskScore: 15,
      riskLevel: RiskLevel.LOW,
      scannedAt: new Date(),
      approvedAt: new Date(),
      evidenceBundle: {
        scannedAt: new Date().toISOString(),
        toolCount: 5,
        capabilities: ['read'],
        dangerousTools: [],
        passedChecks: ['no-exec', 'no-shell', 'read-only'],
      },
    },
  });

  // Create tool schemas for GitHub server
  await prisma.toolSchema.createMany({
    data: [
      {
        versionId: githubVersion.id,
        name: 'get_file_contents',
        displayName: 'Get File Contents',
        description: 'Retrieve contents of a file from a repository',
        inputSchema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository name (owner/repo)' },
            path: { type: 'string', description: 'File path' },
            ref: { type: 'string', description: 'Branch or commit SHA' },
          },
          required: ['repo', 'path'],
        },
        capabilities: ['read'],
        isDangerous: false,
      },
      {
        versionId: githubVersion.id,
        name: 'search_code',
        displayName: 'Search Code',
        description: 'Search for code across repositories',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            repo: { type: 'string', description: 'Limit to repository' },
          },
          required: ['query'],
        },
        capabilities: ['read'],
        isDangerous: false,
      },
      {
        versionId: githubVersion.id,
        name: 'list_pull_requests',
        displayName: 'List Pull Requests',
        description: 'List pull requests in a repository',
        inputSchema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository name' },
            state: { type: 'string', enum: ['open', 'closed', 'all'] },
          },
          required: ['repo'],
        },
        capabilities: ['read'],
        isDangerous: false,
      },
    ],
  });

  // Database Tools Server (Pending Review - has write capabilities)
  const dbServer = await prisma.server.create({
    data: {
      name: 'acme/database-tools',
      displayName: 'Database Tools',
      description: 'Database query and management tools',
      orgId: acmeCorp.id,
      endpoint: 'https://db-mcp.internal.acme.com',
      transport: TransportType.HTTP_SSE,
      status: ServerStatus.PENDING,
      isPublic: false,
      maintainer: 'dba@acme.com',
      tags: ['database', 'sql', 'postgres'],
    },
  });

  const dbVersion = await prisma.serverVersion.create({
    data: {
      serverId: dbServer.id,
      version: '0.5.0',
      status: VersionStatus.PENDING_REVIEW,
      riskScore: 65,
      riskLevel: RiskLevel.HIGH,
      scannedAt: new Date(),
      evidenceBundle: {
        scannedAt: new Date().toISOString(),
        toolCount: 4,
        capabilities: ['read', 'write', 'delete'],
        dangerousTools: ['execute_sql', 'drop_table'],
        passedChecks: ['no-shell'],
        failedChecks: ['has-destructive-ops', 'has-write-ops'],
        warnings: [
          'Tool execute_sql allows arbitrary SQL execution',
          'Tool drop_table can delete database tables',
        ],
      },
    },
  });

  await prisma.toolSchema.createMany({
    data: [
      {
        versionId: dbVersion.id,
        name: 'query',
        displayName: 'Query Database',
        description: 'Execute a read-only SQL query',
        inputSchema: {
          type: 'object',
          properties: {
            database: { type: 'string' },
            sql: { type: 'string', description: 'SELECT query only' },
          },
          required: ['database', 'sql'],
        },
        capabilities: ['read'],
        isDangerous: false,
      },
      {
        versionId: dbVersion.id,
        name: 'execute_sql',
        displayName: 'Execute SQL',
        description: 'Execute arbitrary SQL statement',
        inputSchema: {
          type: 'object',
          properties: {
            database: { type: 'string' },
            sql: { type: 'string' },
          },
          required: ['database', 'sql'],
        },
        capabilities: ['read', 'write', 'delete'],
        riskFlags: ['arbitrary-sql', 'data-mutation'],
        isDangerous: true,
      },
      {
        versionId: dbVersion.id,
        name: 'drop_table',
        displayName: 'Drop Table',
        description: 'Drop a database table',
        inputSchema: {
          type: 'object',
          properties: {
            database: { type: 'string' },
            table: { type: 'string' },
          },
          required: ['database', 'table'],
        },
        capabilities: ['delete'],
        riskFlags: ['destructive', 'data-loss'],
        isDangerous: true,
      },
    ],
  });

  // Slack Server (Approved)
  const slackServer = await prisma.server.create({
    data: {
      name: 'acme/slack-integration',
      displayName: 'Slack Integration',
      description: 'Send messages and read channels from Slack',
      orgId: acmeCorp.id,
      endpoint: 'https://slack-mcp.internal.acme.com',
      transport: TransportType.HTTP_SSE,
      status: ServerStatus.ACTIVE,
      isPublic: false,
      tags: ['slack', 'messaging', 'notifications'],
    },
  });

  const slackVersion = await prisma.serverVersion.create({
    data: {
      serverId: slackServer.id,
      version: '2.0.1',
      status: VersionStatus.APPROVED,
      riskScore: 25,
      riskLevel: RiskLevel.LOW,
      scannedAt: new Date(),
      approvedAt: new Date(),
      evidenceBundle: {
        scannedAt: new Date().toISOString(),
        toolCount: 3,
        capabilities: ['read', 'write'],
        dangerousTools: [],
        passedChecks: ['no-exec', 'no-shell', 'scoped-write'],
      },
    },
  });

  await prisma.toolSchema.createMany({
    data: [
      {
        versionId: slackVersion.id,
        name: 'send_message',
        displayName: 'Send Message',
        description: 'Send a message to a Slack channel',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['channel', 'message'],
        },
        capabilities: ['write'],
        isDangerous: false,
      },
      {
        versionId: slackVersion.id,
        name: 'read_channel',
        displayName: 'Read Channel',
        description: 'Read recent messages from a channel',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            limit: { type: 'number', default: 10 },
          },
          required: ['channel'],
        },
        capabilities: ['read'],
        isDangerous: false,
      },
    ],
  });

  console.log(`  ✓ Created server: ${githubServer.displayName} (APPROVED)`);
  console.log(`  ✓ Created server: ${dbServer.displayName} (PENDING_REVIEW)`);
  console.log(`  ✓ Created server: ${slackServer.displayName} (APPROVED)`);

  // ============================================================================
  // Create Team Server Access
  // ============================================================================
  console.log('\nCreating team server access...');

  await prisma.teamServerAccess.createMany({
    data: [
      {
        teamId: platformTeam.id,
        serverId: githubServer.id,
        accessLevel: 'MANAGE',
        allowedTools: [],
        deniedTools: [],
      },
      {
        teamId: platformTeam.id,
        serverId: slackServer.id,
        accessLevel: 'USE',
        allowedTools: ['send_message', 'read_channel'],
        deniedTools: [],
      },
      {
        teamId: devTeam.id,
        serverId: githubServer.id,
        accessLevel: 'USE',
        allowedTools: ['get_file_contents', 'search_code'],
        deniedTools: [],
      },
    ],
  });

  console.log('  ✓ Configured team access permissions');

  // ============================================================================
  // Create Policies
  // ============================================================================
  console.log('\nCreating policies...');

  // Global deny list for dangerous tools
  await prisma.policy.create({
    data: {
      name: 'global-deny-dangerous',
      description: 'Block dangerous tool patterns across all teams',
      orgId: acmeCorp.id,
      priority: 1000,
      type: PolicyType.TOOL_DENYLIST,
      rules: {
        patterns: [
          'exec*',
          'shell*',
          'eval*',
          'run_command',
          'execute_command',
          '*_delete_all*',
          'drop_*',
          'truncate_*',
        ],
        reason: 'Dangerous tools are blocked by default',
      },
      isEnabled: true,
    },
  });

  // Rate limiting policy
  await prisma.policy.create({
    data: {
      name: 'global-rate-limit',
      description: 'Default rate limits for all tool calls',
      orgId: acmeCorp.id,
      priority: 500,
      type: PolicyType.RATE_LIMIT,
      rules: {
        globalLimit: {
          windowMs: 60000,
          maxRequests: 100,
        },
        perToolLimit: {
          windowMs: 60000,
          maxRequests: 20,
        },
        burstLimit: {
          windowMs: 1000,
          maxRequests: 10,
        },
      },
      isEnabled: true,
    },
  });

  // Capability gate for write operations
  await prisma.policy.create({
    data: {
      name: 'write-approval-required',
      description: 'Require explicit approval for write operations',
      orgId: acmeCorp.id,
      priority: 800,
      type: PolicyType.CAPABILITY_GATE,
      rules: {
        capabilities: ['write', 'delete'],
        action: 'require_approval',
        message: 'Write operations require explicit approval',
      },
      isEnabled: true,
    },
  });

  // Dev team specific allowlist
  await prisma.policy.create({
    data: {
      name: 'dev-team-allowlist',
      description: 'Allowed tools for development team',
      orgId: acmeCorp.id,
      teamId: devTeam.id,
      priority: 100,
      type: PolicyType.TOOL_ALLOWLIST,
      rules: {
        servers: {
          'acme/github-integration': {
            tools: ['get_file_contents', 'search_code', 'list_pull_requests'],
          },
        },
      },
      isEnabled: true,
    },
  });

  console.log('  ✓ Created global deny policy');
  console.log('  ✓ Created rate limit policy');
  console.log('  ✓ Created capability gate policy');
  console.log('  ✓ Created dev team allowlist');

  // ============================================================================
  // Create Approvals
  // ============================================================================
  console.log('\nCreating approval records...');

  await prisma.approval.create({
    data: {
      versionId: githubVersion.id,
      userId: securityUser.id,
      decision: 'APPROVED',
      notes: 'Reviewed tool schemas. All read-only operations. Approved for production.',
      isAutomatic: false,
    },
  });

  await prisma.approval.create({
    data: {
      versionId: slackVersion.id,
      userId: securityUser.id,
      decision: 'APPROVED',
      notes: 'Scoped write permissions to specific channels. Approved.',
      isAutomatic: false,
    },
  });

  console.log('  ✓ Created approval records');

  // ============================================================================
  // Create API Keys
  // ============================================================================
  console.log('\nCreating API keys...');

  const devApiKey = randomBytes(32).toString('hex');
  const devKeyHash = createHash('sha256').update(devApiKey).digest('hex');

  await prisma.apiKey.create({
    data: {
      name: 'Development API Key',
      keyHash: devKeyHash,
      keyPrefix: devApiKey.substring(0, 8),
      orgId: acmeCorp.id,
      scopes: ['read:servers', 'read:policies', 'read:audit'],
      isActive: true,
    },
  });

  console.log(`  ✓ Created API key: ${devApiKey.substring(0, 8)}...`);
  console.log(`    Full key (save this): ${devApiKey}`);

  // ============================================================================
  // Create Sample Audit Events
  // ============================================================================
  console.log('\nCreating sample audit events...');

  const correlationId = randomBytes(8).toString('hex');

  await prisma.auditEvent.createMany({
    data: [
      {
        orgId: acmeCorp.id,
        userId: devUser.id,
        actorType: 'USER',
        eventType: 'tools.call',
        action: 'invoke',
        resourceType: 'tool',
        resourceId: 'get_file_contents',
        resourceName: 'get_file_contents',
        correlationId,
        toolName: 'get_file_contents',
        serverName: 'acme/github-integration',
        arguments: { repo: 'acme/app', path: 'README.md' },
        status: 'SUCCESS',
        durationMs: 234,
        ipAddress: '10.0.0.100',
        userAgent: 'GitHub-Copilot/1.0',
      },
      {
        orgId: acmeCorp.id,
        userId: devUser.id,
        actorType: 'USER',
        eventType: 'tools.call',
        action: 'invoke',
        resourceType: 'tool',
        resourceId: 'search_code',
        resourceName: 'search_code',
        correlationId,
        toolName: 'search_code',
        serverName: 'acme/github-integration',
        arguments: { query: 'function authenticate' },
        status: 'SUCCESS',
        durationMs: 567,
        ipAddress: '10.0.0.100',
        userAgent: 'GitHub-Copilot/1.0',
      },
      {
        orgId: acmeCorp.id,
        userId: devUser.id,
        actorType: 'USER',
        eventType: 'tools.call',
        action: 'invoke',
        resourceType: 'tool',
        resourceId: 'drop_table',
        resourceName: 'drop_table',
        toolName: 'drop_table',
        serverName: 'acme/database-tools',
        arguments: { database: 'prod', table: 'users' },
        status: 'BLOCKED',
        errorMessage: 'Tool blocked by policy: global-deny-dangerous',
        durationMs: 5,
        ipAddress: '10.0.0.100',
        userAgent: 'GitHub-Copilot/1.0',
      },
    ],
  });

  console.log('  ✓ Created sample audit events');

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Seed completed successfully!');
  console.log('='.repeat(60));
  console.log('\nCreated:');
  console.log(`  • 2 Organizations`);
  console.log(`  • 3 Users`);
  console.log(`  • 2 Teams`);
  console.log(`  • 3 MCP Servers (2 approved, 1 pending review)`);
  console.log(`  • 8 Tool Schemas`);
  console.log(`  • 4 Policies`);
  console.log(`  • 2 Approvals`);
  console.log(`  • 1 API Key`);
  console.log(`  • 3 Audit Events`);
  console.log('\nTest credentials:');
  console.log(`  • Admin: admin@acme.com (Org: acme)`);
  console.log(`  • Dev: dev@acme.com (Org: acme)`);
  console.log(`  • Security: security@acme.com (Org: acme)`);
  console.log(`  • API Key: ${devApiKey.substring(0, 8)}... (see above for full key)`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
