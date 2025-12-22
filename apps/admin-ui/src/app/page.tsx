'use client';

import useSWR from 'swr';
import { fetcher, CONTROL_PLANE_URL } from '@/lib/auth';

export default function DashboardPage() {
  const { data: orgsData } = useSWR(`${CONTROL_PLANE_URL}/api/orgs`, fetcher);
  const { data: serversData } = useSWR(`${CONTROL_PLANE_URL}/api/servers`, fetcher);
  const { data: policiesData } = useSWR(`${CONTROL_PLANE_URL}/api/policies`, fetcher);
  const { data: auditData } = useSWR(`${CONTROL_PLANE_URL}/api/audit?limit=10`, fetcher);

  const servers = serversData?.data || [];
  const policies = policiesData?.data || [];
  const auditEvents = auditData?.data || [];

  const approvedServers = servers.filter((s: any) => 
    s.versions?.some((v: any) => v.status === 'APPROVED')
  ).length;
  const pendingServers = servers.filter((s: any) => 
    s.versions?.some((v: any) => v.status === 'PENDING_REVIEW')
  ).length;

  return (
    <div className="container page">
      <h1 className="mb-4">Dashboard</h1>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{servers.length}</div>
          <div className="stat-label">Total Servers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>
            {approvedServers}
          </div>
          <div className="stat-label">Approved</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
            {pendingServers}
          </div>
          <div className="stat-label">Pending Review</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{policies.length}</div>
          <div className="stat-label">Active Policies</div>
        </div>
      </div>

      <div className="grid grid-2">
        {/* Recent Servers */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">MCP Servers</h3>
            <a href="/servers" className="btn btn-secondary btn-sm">View All</a>
          </div>
          {servers.length === 0 ? (
            <div className="empty-state">No servers registered</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {servers.slice(0, 5).map((server: any) => {
                  const latestVersion = server.versions?.[0];
                  return (
                    <tr key={server.id}>
                      <td>
                        <a href={`/servers/${server.id}`}>{server.displayName}</a>
                        <div className="text-sm text-muted">{server.name}</div>
                      </td>
                      <td>
                        <StatusBadge status={latestVersion?.status || server.status} />
                      </td>
                      <td>
                        <RiskBadge level={latestVersion?.riskLevel} score={latestVersion?.riskScore} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Audit Events */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Activity</h3>
            <a href="/audit" className="btn btn-secondary btn-sm">View All</a>
          </div>
          {auditEvents.length === 0 ? (
            <div className="empty-state">No recent activity</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.slice(0, 5).map((event: any) => (
                  <tr key={event.id}>
                    <td>
                      <div>{event.eventType}</div>
                      <div className="text-sm text-muted">
                        {event.toolName || event.resourceName || '-'}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={event.status} />
                    </td>
                    <td className="text-sm text-muted">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Architecture Info */}
      <div className="card mt-4">
        <h3 className="card-title mb-4">How MCP Manager Works</h3>
        <div className="grid grid-3">
          <div>
            <h4 style={{ color: 'var(--accent-blue)' }}>🏛️ Registry (Discovery)</h4>
            <p className="text-sm text-muted mt-2">
              Clients query the registry at discovery time to find approved MCP servers.
              The registry lists which servers exist and are allowed.
            </p>
          </div>
          <div>
            <h4 style={{ color: 'var(--accent-green)' }}>🚪 Gateway (Runtime)</h4>
            <p className="text-sm text-muted mt-2">
              All MCP traffic flows through the gateway. It authenticates users,
              enforces policies, and proxies requests to backend servers.
            </p>
          </div>
          <div>
            <h4 style={{ color: 'var(--accent-purple)' }}>🔍 Scanner (Analysis)</h4>
            <p className="text-sm text-muted mt-2">
              New servers are scanned for dangerous tools and capabilities.
              Low-risk servers can be auto-approved; high-risk require review.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { className: string; label: string }> = {
    APPROVED: { className: 'badge-success', label: 'Approved' },
    ACTIVE: { className: 'badge-success', label: 'Active' },
    SUCCESS: { className: 'badge-success', label: 'Success' },
    PENDING: { className: 'badge-warning', label: 'Pending' },
    PENDING_SCAN: { className: 'badge-warning', label: 'Pending Scan' },
    PENDING_REVIEW: { className: 'badge-warning', label: 'Pending Review' },
    SCANNING: { className: 'badge-info', label: 'Scanning' },
    REJECTED: { className: 'badge-danger', label: 'Rejected' },
    REVOKED: { className: 'badge-danger', label: 'Revoked' },
    BLOCKED: { className: 'badge-danger', label: 'Blocked' },
    FAILURE: { className: 'badge-danger', label: 'Failed' },
    SCAN_FAILED: { className: 'badge-danger', label: 'Scan Failed' },
  };

  const config = statusConfig[status] || { className: 'badge-info', label: status };

  return <span className={`badge ${config.className}`}>{config.label}</span>;
}

function RiskBadge({ level, score }: { level?: string; score?: number }) {
  if (!level && score === undefined) {
    return <span className="text-muted">-</span>;
  }

  const levelConfig: Record<string, string> = {
    LOW: 'risk-low',
    MEDIUM: 'risk-medium',
    HIGH: 'risk-high',
    CRITICAL: 'risk-critical',
  };

  const className = levelConfig[level || ''] || '';

  return (
    <span className={className}>
      {level || '-'} {score !== undefined && `(${score})`}
    </span>
  );
}
