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

export default function ServersPage() {
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { data, error, isLoading } = useSWR(`${CONTROL_PLANE_URL}/api/servers`, fetcher);

  const servers = data?.data || [];

  const handleApprove = async (serverId: string, versionId: string) => {
    setActionLoading(true);
    try {
      await fetch(`${CONTROL_PLANE_URL}/api/servers/${serverId}/versions/${versionId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${DEV_TOKEN}` },
      });
      mutate(`${CONTROL_PLANE_URL}/api/servers`);
      setSelectedVersion(null);
    } catch (e) {
      alert('Failed to approve');
    }
    setActionLoading(false);
  };

  const handleReject = async (serverId: string, versionId: string, reason: string) => {
    setActionLoading(true);
    try {
      await fetch(`${CONTROL_PLANE_URL}/api/servers/${serverId}/versions/${versionId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
      });
      mutate(`${CONTROL_PLANE_URL}/api/servers`);
      setSelectedVersion(null);
    } catch (e) {
      alert('Failed to reject');
    }
    setActionLoading(false);
  };

  const handleRevoke = async (serverId: string, versionId: string, reason: string) => {
    setActionLoading(true);
    try {
      await fetch(`${CONTROL_PLANE_URL}/api/servers/${serverId}/versions/${versionId}/revoke`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
      });
      mutate(`${CONTROL_PLANE_URL}/api/servers`);
      setSelectedVersion(null);
    } catch (e) {
      alert('Failed to revoke');
    }
    setActionLoading(false);
  };

  return (
    <div className="container page">
      <div className="flex items-center justify-between mb-4">
        <h1>MCP Servers</h1>
        <button className="btn btn-primary" onClick={() => setShowRegisterModal(true)}>
          + Register Server
        </button>
      </div>

      <p className="text-muted mb-4">
        Manage MCP servers that can be discovered and accessed through the gateway.
      </p>

      {isLoading && <div className="empty-state">Loading...</div>}
      {error && <div className="text-danger">Failed to load servers</div>}

      {!isLoading && servers.length === 0 && (
        <div className="card empty-state">
          <p>No MCP servers registered yet.</p>
          <button className="btn btn-primary mt-4" onClick={() => setShowRegisterModal(true)}>
            Register Your First Server
          </button>
        </div>
      )}

      {servers.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Server</th>
                <th>Endpoint</th>
                <th>Latest Version</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((server: any) => {
                const latestVersion = server.versions?.[0];
                return (
                  <tr key={server.id}>
                    <td>
                      <div className="font-semibold">{server.displayName}</div>
                      <div className="text-sm text-muted">{server.name}</div>
                    </td>
                    <td>
                      <code className="text-sm">{server.endpoint}</code>
                      <div className="text-sm text-muted">{server.transport}</div>
                    </td>
                    <td>{latestVersion?.version || '-'}</td>
                    <td>
                      <StatusBadge status={latestVersion?.status || 'UNKNOWN'} />
                    </td>
                    <td>
                      <RiskBadge level={latestVersion?.riskLevel} score={latestVersion?.riskScore} />
                    </td>
                    <td>
                      {latestVersion?.status === 'PENDING_REVIEW' && (
                        <button
                          className="btn btn-sm btn-success mr-2"
                          onClick={() => setSelectedVersion({ server, version: latestVersion, action: 'review' })}
                        >
                          Review
                        </button>
                      )}
                      {latestVersion?.status === 'APPROVED' && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => setSelectedVersion({ server, version: latestVersion, action: 'revoke' })}
                        >
                          Revoke
                        </button>
                      )}
                      {latestVersion?.status === 'PENDING_SCAN' && (
                        <span className="text-muted text-sm">Awaiting scan...</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Register Modal */}
      {showRegisterModal && (
        <RegisterServerModal
          onClose={() => setShowRegisterModal(false)}
          onSuccess={() => {
            setShowRegisterModal(false);
            mutate(`${CONTROL_PLANE_URL}/api/servers`);
          }}
        />
      )}

      {/* Review Modal */}
      {selectedVersion?.action === 'review' && (
        <ReviewModal
          server={selectedVersion.server}
          version={selectedVersion.version}
          loading={actionLoading}
          onApprove={() => handleApprove(selectedVersion.server.id, selectedVersion.version.id)}
          onReject={(reason) => handleReject(selectedVersion.server.id, selectedVersion.version.id, reason)}
          onClose={() => setSelectedVersion(null)}
        />
      )}

      {/* Revoke Modal */}
      {selectedVersion?.action === 'revoke' && (
        <RevokeModal
          server={selectedVersion.server}
          version={selectedVersion.version}
          loading={actionLoading}
          onRevoke={(reason) => handleRevoke(selectedVersion.server.id, selectedVersion.version.id, reason)}
          onClose={() => setSelectedVersion(null)}
        />
      )}
    </div>
  );
}

function RegisterServerModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    description: '',
    endpoint: '',
    transport: 'HTTP_SSE',
    version: '1.0.0',
    // Source code scanning fields
    repositoryUrl: '',
    repositoryBranch: 'main',
    repositoryProvider: 'GITHUB',
    repositoryPath: '/',
    sourceCodeScanEnabled: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${CONTROL_PLANE_URL}/api/servers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to register');
      }
      onSuccess();
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Register MCP Server</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="form-group">
              <label className="form-label">Server Name (slug)</label>
              <input
                type="text"
                className="form-input"
                placeholder="my-mcp-server"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                pattern="[a-z0-9-]+"
              />
              <span className="text-sm text-muted">Lowercase letters, numbers, and hyphens only</span>
            </div>
            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="My MCP Server"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                placeholder="What does this server do?"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Backend Endpoint</label>
              <input
                type="url"
                className="form-input"
                placeholder="http://localhost:8080"
                value={formData.endpoint}
                onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Transport</label>
              <select
                className="form-select"
                value={formData.transport}
                onChange={(e) => setFormData({ ...formData, transport: e.target.value })}
              >
                <option value="HTTP_SSE">HTTP + SSE</option>
                <option value="HTTP">HTTP only</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Version</label>
              <input
                type="text"
                className="form-input"
                placeholder="1.0.0"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                required
              />
            </div>

            {/* Source Code Scanning Section */}
            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '1rem', paddingTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ marginBottom: '1rem' }}
              >
                {showAdvanced ? '▼' : '▶'} Source Code Scanning (Optional)
              </button>

              {showAdvanced && (
                <>
                  <div className="form-group">
                    <label className="form-label">
                      <input
                        type="checkbox"
                        checked={formData.sourceCodeScanEnabled}
                        onChange={(e) => setFormData({ ...formData, sourceCodeScanEnabled: e.target.checked })}
                        style={{ marginRight: '0.5rem' }}
                      />
                      Enable Source Code Scanning
                    </label>
                    <p className="text-sm text-muted">
                      Scan the repository for security vulnerabilities, secrets, and dangerous patterns
                    </p>
                  </div>

                  {formData.sourceCodeScanEnabled && (
                    <>
                      <div className="form-group">
                        <label className="form-label">Repository Provider</label>
                        <select
                          className="form-select"
                          value={formData.repositoryProvider}
                          onChange={(e) => setFormData({ ...formData, repositoryProvider: e.target.value })}
                        >
                          <option value="GITHUB">GitHub</option>
                          <option value="GITLAB">GitLab</option>
                          <option value="BITBUCKET">Bitbucket</option>
                          <option value="AZURE_DEVOPS">Azure DevOps</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Repository URL</label>
                        <input
                          type="url"
                          className="form-input"
                          placeholder="https://github.com/org/repo"
                          value={formData.repositoryUrl}
                          onChange={(e) => setFormData({ ...formData, repositoryUrl: e.target.value })}
                        />
                        <span className="text-sm text-muted">
                          Full URL to the repository containing the MCP server code
                        </span>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Branch</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="main"
                          value={formData.repositoryBranch}
                          onChange={(e) => setFormData({ ...formData, repositoryBranch: e.target.value })}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Path within Repository</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="/"
                          value={formData.repositoryPath}
                          onChange={(e) => setFormData({ ...formData, repositoryPath: e.target.value })}
                        />
                        <span className="text-sm text-muted">
                          Path to the MCP server code within the repository (default: root)
                        </span>
                      </div>

                      <div className="card" style={{ background: 'var(--bg-secondary)', padding: '1rem', marginTop: '1rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>🔐 Repository Access Token Required</h4>
                        <p className="text-sm text-muted" style={{ margin: 0 }}>
                          To scan source code, you'll need to provide a repository access token after registration.
                          The token needs <strong>read</strong> access to repository contents.
                        </p>
                        <ul className="text-sm text-muted" style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
                          <li><strong>GitHub:</strong> Personal Access Token with <code>repo</code> or <code>contents:read</code> scope</li>
                          <li><strong>GitLab:</strong> Personal Access Token with <code>read_repository</code> scope</li>
                          <li><strong>Bitbucket:</strong> App Password with <code>repository:read</code></li>
                          <li><strong>Azure DevOps:</strong> PAT with <code>Code (Read)</code></li>
                        </ul>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            </div>
            <div className="form-group">
              <label className="form-label">Version</label>
              <input
                type="text"
                className="form-input"
                placeholder="1.0.0"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Registering...' : 'Register Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReviewModal({
  server,
  version,
  loading,
  onApprove,
  onReject,
  onClose,
}: {
  server: any;
  version: any;
  loading: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onClose: () => void;
}) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const tools = version.toolSchemas || [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '700px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Review: {server.displayName} v{version.version}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="flex gap-4 mb-4">
            <div>
              <span className="text-muted">Risk Level:</span>{' '}
              <RiskBadge level={version.riskLevel} score={version.riskScore} />
            </div>
            <div>
              <span className="text-muted">Scanned:</span>{' '}
              {version.scannedAt ? new Date(version.scannedAt).toLocaleString() : 'Not scanned'}
            </div>
          </div>

          <h3 className="mb-2">Tools ({tools.length})</h3>
          {tools.length === 0 ? (
            <p className="text-muted">No tools detected</p>
          ) : (
            <div className="mb-4" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {tools.map((tool: any, idx: number) => (
                <div key={idx} className="card mb-2" style={{ padding: '0.75rem' }}>
                  <div className="flex items-center justify-between">
                    <strong>{tool.name}</strong>
                    {tool.isDangerous && (
                      <span className="badge badge-danger">⚠️ Dangerous</span>
                    )}
                  </div>
                  <p className="text-sm text-muted mt-1">{tool.description || 'No description'}</p>
                  {tool.dangerousPatterns?.length > 0 && (
                    <div className="text-sm text-danger mt-1">
                      Patterns: {tool.dangerousPatterns.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {version.scanNotes && (
            <div className="mb-4">
              <h4>Scan Notes</h4>
              <pre className="text-sm" style={{ background: 'var(--bg-tertiary)', padding: '0.5rem', borderRadius: '4px' }}>
                {version.scanNotes}
              </pre>
            </div>
          )}

          {showRejectForm && (
            <div className="form-group">
              <label className="form-label">Rejection Reason</label>
              <textarea
                className="form-input"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this server is being rejected..."
                rows={3}
              />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {showRejectForm ? (
            <button
              className="btn btn-danger"
              onClick={() => onReject(rejectReason)}
              disabled={loading || !rejectReason}
            >
              {loading ? 'Rejecting...' : 'Confirm Rejection'}
            </button>
          ) : (
            <>
              <button
                className="btn btn-danger"
                onClick={() => setShowRejectForm(true)}
                disabled={loading}
              >
                Reject
              </button>
              <button className="btn btn-success" onClick={onApprove} disabled={loading}>
                {loading ? 'Approving...' : 'Approve'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RevokeModal({
  server,
  version,
  loading,
  onRevoke,
  onClose,
}: {
  server: any;
  version: any;
  loading: boolean;
  onRevoke: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Revoke: {server.displayName} v{version.version}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="text-warning mb-4">
            ⚠️ Revoking this server version will immediately block all access through the gateway.
          </p>
          <div className="form-group">
            <label className="form-label">Reason for Revocation</label>
            <textarea
              className="form-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this server is being revoked..."
              rows={3}
              required
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => onRevoke(reason)} disabled={loading || !reason}>
            {loading ? 'Revoking...' : 'Revoke Access'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { className: string; label: string }> = {
    APPROVED: { className: 'badge-success', label: 'Approved' },
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
  if (!level && score === undefined) return <span className="text-muted">-</span>;

  const levelConfig: Record<string, string> = {
    LOW: 'risk-low',
    MEDIUM: 'risk-medium',
    HIGH: 'risk-high',
    CRITICAL: 'risk-critical',
  };

  return (
    <span className={levelConfig[level || ''] || ''}>
      {level || '-'} {score !== undefined && `(${score})`}
    </span>
  );
}
