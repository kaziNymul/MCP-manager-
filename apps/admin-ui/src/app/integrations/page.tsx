'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3001';
const DEV_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdXRoMHxhZG1pbjEyMyIsImlzcyI6Im1jcC1tYW5hZ2VyLWRldiIsImF1ZCI6Im1jcC1tYW5hZ2VyIiwiaWF0IjoxNzAzMTU0MDAwfQ.placeholder';

const fetcher = async (url: string) => {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${DEV_TOKEN}` },
  });
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

export default function IntegrationsPage() {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  const { data: statusData, error: statusError } = useSWR(
    `${CONTROL_PLANE_URL}/api/servers/sync/github-copilot/status`,
    fetcher
  );

  const { data: serversData } = useSWR(`${CONTROL_PLANE_URL}/api/servers`, fetcher);
  const servers = serversData?.data || [];
  const approvedServers = servers.filter((s: any) => 
    s.versions?.some((v: any) => v.status === 'APPROVED')
  );

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${CONTROL_PLANE_URL}/api/servers/sync/github-copilot`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${DEV_TOKEN}` },
      });
      const data = await res.json();
      setSyncResult(data);
      mutate(`${CONTROL_PLANE_URL}/api/servers/sync/github-copilot/status`);
    } catch (e) {
      setSyncResult({ error: 'Sync failed' });
    }
    setSyncing(false);
  };

  return (
    <div className="container page">
      <h1 className="mb-4">Integrations</h1>

      <p className="text-muted mb-4">
        Connect MCP Manager to external services to sync your approved MCP server allowlist.
      </p>

      {/* GitHub Copilot Enterprise Card */}
      <div className="card mb-4">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <span style={{ fontSize: '2rem' }}>🐙</span>
            <div>
              <h2 className="card-title" style={{ marginBottom: '0.25rem' }}>GitHub Copilot Enterprise</h2>
              <p className="text-muted text-sm">
                Sync approved MCP servers to your GitHub organization's Copilot allowlist
              </p>
            </div>
          </div>
          <StatusBadge status={statusData} error={statusError} />
        </div>

        <div className="p-4">
          {/* How it works */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2">How it works</h3>
            <div className="grid grid-3">
              <div className="text-sm">
                <div className="font-semibold" style={{ color: 'var(--accent-blue)' }}>1. Register</div>
                <p className="text-muted">Users submit MCP servers through MCP Manager</p>
              </div>
              <div className="text-sm">
                <div className="font-semibold" style={{ color: 'var(--accent-green)' }}>2. Approve</div>
                <p className="text-muted">Admins review and approve after security scan</p>
              </div>
              <div className="text-sm">
                <div className="font-semibold" style={{ color: 'var(--accent-purple)' }}>3. Sync</div>
                <p className="text-muted">Approved servers sync to GitHub Copilot's allowlist</p>
              </div>
            </div>
          </div>

          {/* Status Details */}
          {statusData?.configured ? (
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2">Connection Status</h3>
              <div className="grid grid-2">
                <div>
                  <span className="text-muted">Organization:</span>
                  <span className="ml-2 font-semibold">{statusData.orgName}</span>
                </div>
                <div>
                  <span className="text-muted">Copilot Enabled:</span>
                  <span className={`ml-2 badge ${statusData.copilotEnabled ? 'badge-success' : 'badge-danger'}`}>
                    {statusData.copilotEnabled ? 'Yes' : 'No'}
                  </span>
                </div>
                <div>
                  <span className="text-muted">MCP Feature:</span>
                  <span className={`ml-2 badge ${statusData.mcpEnabled ? 'badge-success' : 'badge-warning'}`}>
                    {statusData.mcpEnabled ? 'Available' : 'Not Available'}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Servers to sync:</span>
                  <span className="ml-2 font-semibold">{approvedServers.length}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-4 p-4" style={{ background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
              <h3 className="text-sm font-semibold mb-2">⚠️ Not Configured</h3>
              <p className="text-sm text-muted mb-2">
                To enable GitHub Copilot integration, add these environment variables:
              </p>
              <pre className="text-sm" style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '4px' }}>
{`GITHUB_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_ORG=your-enterprise-org
GITHUB_API_URL=https://api.github.com
GITHUB_AUTO_SYNC=true`}
              </pre>
            </div>
          )}

          {/* Sync Button */}
          <div className="flex items-center gap-4">
            <button
              className="btn btn-primary"
              onClick={handleSync}
              disabled={syncing || !statusData?.configured || !statusData?.valid}
            >
              {syncing ? 'Syncing...' : '🔄 Sync Now'}
            </button>
            {statusData?.configured && (
              <span className="text-sm text-muted">
                {approvedServers.length} approved server{approvedServers.length !== 1 ? 's' : ''} will be synced
              </span>
            )}
          </div>

          {/* Sync Result */}
          {syncResult && (
            <div className={`mt-4 p-4 ${syncResult.error ? 'text-danger' : ''}`} 
                 style={{ background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
              {syncResult.error ? (
                <p>❌ {syncResult.error}: {syncResult.message}</p>
              ) : (
                <>
                  <p className="font-semibold mb-2">✅ {syncResult.message}</p>
                  <div className="grid grid-4 text-sm">
                    <div>
                      <span className="text-muted">Added:</span>
                      <span className="ml-2" style={{ color: 'var(--accent-green)' }}>
                        {syncResult.data?.added?.length || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">Removed:</span>
                      <span className="ml-2" style={{ color: 'var(--accent-red)' }}>
                        {syncResult.data?.removed?.length || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">Unchanged:</span>
                      <span className="ml-2">{syncResult.data?.unchanged?.length || 0}</span>
                    </div>
                    <div>
                      <span className="text-muted">Errors:</span>
                      <span className="ml-2" style={{ color: syncResult.data?.errors?.length ? 'var(--accent-red)' : undefined }}>
                        {syncResult.data?.errors?.length || 0}
                      </span>
                    </div>
                  </div>
                  {syncResult.data?.added?.length > 0 && (
                    <div className="mt-2 text-sm">
                      <span className="text-muted">Added: </span>
                      {syncResult.data.added.join(', ')}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Servers that will be synced */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Approved Servers ({approvedServers.length})</h3>
        </div>
        {approvedServers.length === 0 ? (
          <div className="empty-state">
            <p>No approved servers to sync</p>
            <p className="text-muted mt-2">
              Approved servers will automatically sync to GitHub Copilot's allowlist
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Server</th>
                <th>Endpoint</th>
                <th>Version</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {approvedServers.map((server: any) => {
                const version = server.versions?.[0];
                return (
                  <tr key={server.id}>
                    <td>
                      <div className="font-semibold">{server.displayName}</div>
                      <div className="text-sm text-muted">{server.name}</div>
                    </td>
                    <td>
                      <code className="text-sm">{server.endpoint}</code>
                    </td>
                    <td>{version?.version || '-'}</td>
                    <td>
                      <span className={`risk-${version?.riskLevel?.toLowerCase()}`}>
                        {version?.riskLevel || '-'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Other integrations placeholder */}
      <div className="card mt-4" style={{ opacity: 0.6 }}>
        <div className="card-header">
          <div className="flex items-center gap-3">
            <span style={{ fontSize: '2rem' }}>🔮</span>
            <div>
              <h2 className="card-title" style={{ marginBottom: '0.25rem' }}>More Integrations Coming</h2>
              <p className="text-muted text-sm">
                Future integrations: GitLab, Azure DevOps, Slack notifications, SIEM export
              </p>
            </div>
          </div>
          <span className="badge badge-info">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: any; error: any }) {
  if (error) {
    return <span className="badge badge-danger">Error</span>;
  }
  if (!status) {
    return <span className="badge badge-info">Loading...</span>;
  }
  if (!status.configured) {
    return <span className="badge badge-warning">Not Configured</span>;
  }
  if (!status.valid) {
    return <span className="badge badge-danger">Connection Failed</span>;
  }
  return <span className="badge badge-success">Connected</span>;
}
