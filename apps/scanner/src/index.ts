import 'dotenv/config';
import { prisma } from '@mcp-manager/prisma';
import { createLogger, AUDIT_EVENT_TYPES } from '@mcp-manager/shared';
import { Scanner } from './services/scanner.js';

const logger = createLogger('scanner');

const SCAN_INTERVAL_MS = parseInt(process.env.SCANNER_INTERVAL_MS || '30000', 10);
const AUTO_APPROVE_THRESHOLD = parseInt(process.env.AUTO_APPROVE_THRESHOLD || '30', 10);

let isRunning = false;

async function processQueue() {
  if (isRunning) {
    logger.debug('Scanner already running, skipping');
    return;
  }

  isRunning = true;

  try {
    // Find pending scan jobs
    const pendingJobs = await prisma.scanJob.findMany({
      where: { status: 'PENDING' },
      include: {
        version: {
          include: {
            server: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 5, // Process up to 5 jobs at a time
    });

    if (pendingJobs.length === 0) {
      // Also check for versions that need scanning but don't have jobs
      const pendingVersions = await prisma.serverVersion.findMany({
        where: {
          status: 'PENDING_SCAN',
          scanJobs: { none: {} },
        },
        include: { server: true },
        take: 5,
      });

      for (const version of pendingVersions) {
        await prisma.scanJob.create({
          data: {
            versionId: version.id,
            status: 'PENDING',
          },
        });
        logger.info({ serverId: version.server.name, version: version.version }, 'Created scan job');
      }
    }

    // Process each job
    const scanner = new Scanner();

    for (const job of pendingJobs) {
      logger.info(
        { jobId: job.id, server: job.version.server.name, version: job.version.version },
        'Processing scan job'
      );

      try {
        // Update job status
        await prisma.scanJob.update({
          where: { id: job.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        });

        // Update version status
        await prisma.serverVersion.update({
          where: { id: job.version.id },
          data: { status: 'SCANNING' },
        });

        // Run scan
        const result = await scanner.scanServer(
          job.version.endpoint || job.version.server.endpoint,
          job.version.id
        );

        // Store tool schemas
        if (result.tools.length > 0) {
          // Delete existing schemas for this version
          await prisma.toolSchema.deleteMany({
            where: { versionId: job.version.id },
          });

          // Create new schemas
          await prisma.toolSchema.createMany({
            data: result.tools.map((tool: any) => ({
              versionId: job.version.id,
              name: tool.name,
              displayName: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema as any,
              capabilities: tool.capabilities || [],
              riskFlags: tool.riskFlags || [],
              isDangerous: tool.isDangerous || false,
            })),
          });
        }

        // Determine final status based on risk score
        const shouldAutoApprove =
          result.riskAssessment.score <= AUTO_APPROVE_THRESHOLD &&
          result.riskAssessment.level === 'LOW';

        const finalStatus = shouldAutoApprove ? 'APPROVED' : 'PENDING_REVIEW';

        // Update version with results
        await prisma.serverVersion.update({
          where: { id: job.version.id },
          data: {
            status: finalStatus,
            riskScore: result.riskAssessment.score,
            riskLevel: result.riskAssessment.level as any,
            evidenceBundle: {
              scannedAt: result.scannedAt,
              toolCount: result.tools.length,
              capabilities: result.riskAssessment.capabilities,
              dangerousTools: result.tools.filter((t: any) => t.isDangerous).map((t: any) => t.name),
              riskFlags: result.riskAssessment.flags,
              warnings: result.riskAssessment.warnings,
            },
            scannedAt: new Date(result.scannedAt),
            approvedAt: shouldAutoApprove ? new Date() : null,
          },
        });

        // If auto-approved, activate the server
        if (shouldAutoApprove) {
          await prisma.server.update({
            where: { id: job.version.server.id },
            data: { status: 'ACTIVE' },
          });

          // Create approval record
          await prisma.approval.create({
            data: {
              versionId: job.version.id,
              decision: 'APPROVED',
              notes: `Auto-approved: risk score ${result.riskAssessment.score} below threshold ${AUTO_APPROVE_THRESHOLD}`,
              isAutomatic: true,
            },
          });
        }

        // Update scan job
        await prisma.scanJob.update({
          where: { id: job.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            results: result as any,
          },
        });

        // Audit event
        await prisma.auditEvent.create({
          data: {
            orgId: job.version.server.orgId,
            actorType: 'SYSTEM',
            eventType: AUDIT_EVENT_TYPES.VERSION_SCANNED,
            action: 'scan',
            resourceType: 'server_version',
            resourceId: job.version.id,
            resourceName: `${job.version.server.name}@${job.version.version}`,
            serverName: job.version.server.name,
            status: 'SUCCESS',
            metadata: {
              riskScore: result.riskAssessment.score,
              riskLevel: result.riskAssessment.level,
              toolCount: result.tools.length,
              autoApproved: shouldAutoApprove,
            },
          },
        });

        logger.info(
          {
            jobId: job.id,
            server: job.version.server.name,
            riskScore: result.riskAssessment.score,
            riskLevel: result.riskAssessment.level,
            autoApproved: shouldAutoApprove,
          },
          'Scan completed'
        );
      } catch (err) {
        logger.error({ err, jobId: job.id }, 'Scan failed');

        // Update job with error
        await prisma.scanJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            error: err instanceof Error ? err.message : 'Unknown error',
          },
        });

        // Update version status
        await prisma.serverVersion.update({
          where: { id: job.version.id },
          data: { status: 'SCAN_FAILED' },
        });

        // Audit event
        await prisma.auditEvent.create({
          data: {
            orgId: job.version.server.orgId,
            actorType: 'SYSTEM',
            eventType: AUDIT_EVENT_TYPES.VERSION_SCANNED,
            action: 'scan',
            resourceType: 'server_version',
            resourceId: job.version.id,
            resourceName: `${job.version.server.name}@${job.version.version}`,
            serverName: job.version.server.name,
            status: 'FAILURE',
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
          },
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Queue processing failed');
  } finally {
    isRunning = false;
  }
}

async function main() {
  logger.info('Scanner worker starting...');
  logger.info(`Scan interval: ${SCAN_INTERVAL_MS}ms`);
  logger.info(`Auto-approve threshold: ${AUTO_APPROVE_THRESHOLD}`);

  // Process queue immediately on start
  await processQueue();

  // Then poll periodically
  const interval = setInterval(processQueue, SCAN_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    clearInterval(interval);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Scanner worker running');
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
