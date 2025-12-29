'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import { fetcher, CONTROL_PLANE_URL, getAuthHeaders } from '@/lib/auth';

export default function ServerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.id as string;
  
  const [actionLoading, setActionLoading] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  const { data, error, isLoading } = useSWR(
    `${CONTROL_PLANE_URL}/api/servers/${serverId}`,
    fetcher
  );

  const server = data?.data;

  const handleApprove = async (versionId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(
        `${CONTROL_PLANE_URL}/api/servers/${serverId}/versions/${versionId}/approve`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ approved: true }),
        }
      );
      if (!res.ok) throw new Error('Failed to approve');
      mutate(`${CONTROL_PLANE_URL}/api/servers/${serverId}`);
      setShowApproveModal(false);
    } catch (e) {
      alert('Failed to approve server');
    }
    setActionLoading(false);
  };

  const handleRevoke = async (versionId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(
        `${CONTROL_PLANE_URL}/api/servers/${serverId}/versions/${versionId}/revoke`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: revokeReason }),
        }
      );
      if (!res.ok) throw new Error('Failed to revoke');
      mutate(`${CONTROL_PLANE_URL}/api/servers/${serverId}`);
      setShowRevokeModal(false);
      setRevokeReason('');
    } catch (e) {
      alert('Failed to revoke server');
    }
    setActionLoading(false);
  };

  const handleTriggerScan = async (versionId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(
        `${CONTROL_PLANE_URL}/api/servers/${serverId}/versions/${versionId}/scan`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
        }
      );
      if (!res.ok) throw new Error('Failed to trigger scan');
      mutate(`${CONTROL_PLANE_URL}/api/servers/${serverId}`);
      alert('Scan triggered successfully');
    } catch (e) {
      alert('Failed to trigger scan');
    }
    setActionLoading(false);
  };

  if (isLoading) {
    return (
      <div className="container page">
        <div className="empty-state">Loading...</div>
      </div>
    );
  }

  if (error || !server) {
    return (
      <div className="container page">
        <div className="text-danger">Failed to load server details</div>
        <button className="btn btn-secondary mt-4" onClick={() => router.push('/servers')}>
          Back to Servers
        </button>
      </div>
    );
  }

  const latestVersion = server.versions?.[0];

  return (
    <div className="container page">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <button className="btn btn-secondary btn-sm mb-2" onClick={() => router.push('/servers')}>
            ← Back to Servers
          </button>
          <h1>{server.displayName}</h1>
          <div className="text-muted">{server.name}</div>
        </div>
        <div className="flex gap-2">
          {latestVersion?.status === 'PENDING_REVIEW' && (
            <button
              className="btn btn-success"
              onClick={() => setShowApproveModal(true)}
              disabled={actionLoading}
            >
              ✓ Approve
            </button>
          )}
          {latestVersion?.status === 'APPROVED' && (
            <button
              className="btn btn-danger"
              onClick={() => setShowRevokeModal(true)}
              disabled={actionLoading}
            >
              Revoke
            </button>
          )}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="stats-grid mb-4">
        <div className="stat-card">
          <div className="stat-label">Status</div>
          <div className="stat-value">
            <StatusBadge status={latestVersion?.status || server.status} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Risk Score</div>
          <div className="stat-value">
            <RiskBadge level={latestVersion?.riskLevel} score={latestVersion?.riskScore} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Version</div>
          <div className="stat-value">{latestVersion?.version || '-'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Transport</div>
          <div className="stat-value">{server.transport}</div>
        </div>
      </div>

      <div className="grid grid-2">
        {/* Server Details */}
        <div className="card">
          <h3 className="card-title">Server Details</h3>
          <div className="mt-4 space-y-3">
            <div>
              <div className="text-sm text-muted">Description</div>
              <div>{server.description || 'No description'}</div>
            </div>
            <div>
              <div className="text-sm text-muted">Endpoint</div>
              <code>{server.endpoint}</code>
            </div>
            <div>
              <div className="text-sm text-muted">Gateway URL</div>
              <code>http://localhost:3003/mcp/{server.name?.split('/')[0]}/{server.name?.split('/')[1]}</code>
            </div>
            <div>
              <div className="text-sm text-muted">Created</div>
              <div>{new Date(server.createdAt).toLocaleString()}</div>
            </div>
            {latestVersion?.approvedAt && (
              <div>
                <div className="text-sm text-muted">Approved At</div>
                <div>{new Date(latestVersion.approvedAt).toLocaleString()}</div>
              </div>
            )}
          </div>
        </div>

        {/* Tools */}
        <div className="card">
          <h3 className="card-title">
            Tools ({latestVersion?.toolSchemas?.length || 0})
          </h3>
          {(!latestVersion?.toolSchemas || latestVersion.toolSchemas.length === 0) ? (
            <div className="empty-state mt-4">No tools discovered yet</div>
          ) : (
            <div className="mt-4 space-y-3">
              {latestVersion.toolSchemas.map((tool: any) => (
                <div key={tool.id} className="p-3 bg-card rounded border">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{tool.name}</div>
                    {tool.isDangerous && (
                      <span className="badge badge-danger">⚠ Dangerous</span>
                    )}
                  </div>
                  <div className="text-sm text-muted mt-1">
                    {tool.description || 'No description'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scan Evidence */}
      {latestVersion?.evidenceBundle && (
        <div className="card mt-4">
          <h3 className="card-title">Scan Evidence</h3>
          <div className="mt-4">
            <pre className="bg-card p-4 rounded overflow-auto text-sm">
              {JSON.stringify(latestVersion.evidenceBundle, null, 2)}
            </pre>
          </div>
          <div className="mt-4">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleTriggerScan(latestVersion.id)}
              disabled={actionLoading}
            >
              Re-scan Server
            </button>
          </div>
        </div>
      )}

      {/* Team Access */}
      <div className="card mt-4">
        <h3 className="card-title">Team Access</h3>
        {(!server.teamAccess || server.teamAccess.length === 0) ? (
          <div className="empty-state mt-4">No teams have access to this server</div>
        ) : (
          <table className="table mt-4">
            <thead>
              <tr>
                <th>Team</th>
                <th>Access Level</th>
                <th>Granted</th>
              </tr>
            </thead>
            <tbody>
              {server.teamAccess.map((access: any) => (
                <tr key={access.id}>
                  <td>
                    <div className="font-semibold">{access.team?.displayName}</div>
                    <div className="text-sm text-muted">{access.team?.name}</div>
                  </td>
                  <td>
                    <span className="badge badge-info">{access.accessLevel}</span>
                  </td>
                  <td className="text-sm text-muted">
                    {new Date(access.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Versions History */}
      <div className="card mt-4">
        <h3 className="card-title">Version History</h3>
        {(!server.versions || server.versions.length === 0) ? (
          <div className="empty-state mt-4">No versions</div>
        ) : (
          <table className="table mt-4">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {server.versions.map((version: any) => (
                <tr key={version.id}>
                  <td>{version.version}</td>
                  <td>
                    <StatusBadge status={version.status} />
                  </td>
                  <td>
                    <RiskBadge level={version.riskLevel} score={version.riskScore} />
                  </td>
                  <td className="text-sm text-muted">
                    {new Date(version.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Approve Modal */}
      {showApproveModal && latestVersion && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Approve Server Version</h3>
            <p className="text-muted mt-2">
              You are about to approve <strong>{server.displayName}</strong> version{' '}
              <strong>{latestVersion.version}</strong>.
            </p>
            <p className="text-muted mt-2">
              This will make the server available through the Gateway.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="btn btn-secondary"
                onClick={() => setShowApproveModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-success"
                onClick={() => handleApprove(latestVersion.id)}
                disabled={actionLoading}
              >
                {actionLoading ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Modal */}
      {showRevokeModal && latestVersion && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Revoke Server Version</h3>
            <p className="text-muted mt-2">
              You are about to revoke <strong>{server.displayName}</strong> version{' '}
              <strong>{latestVersion.version}</strong>.
            </p>
            <p className="text-danger mt-2">
              This will immediately block all access to this server!
            </p>
            <div className="mt-4">
              <label className="block text-sm text-muted mb-1">Reason (required)</label>
              <textarea
                className="input w-full"
                rows={3}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Enter reason for revocation..."
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowRevokeModal(false);
                  setRevokeReason('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => handleRevoke(latestVersion.id)}
                disabled={actionLoading || !revokeReason.trim()}
              >
                {actionLoading ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { className: string; label: string }> = {
    APPROVED: { className: 'badge-success', label: 'Approved' },
    ACTIVE: { className: 'badge-success', label: 'Active' },
    PENDING: { className: 'badge-warning', label: 'Pending' },
    PENDING_SCAN: { className: 'badge-warning', label: 'Pending Scan' },
    PENDING_REVIEW: { className: 'badge-warning', label: 'Pending Review' },
    SCANNING: { className: 'badge-info', label: 'Scanning' },
    REJECTED: { className: 'badge-danger', label: 'Rejected' },
    REVOKED: { className: 'badge-danger', label: 'Revoked' },
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
