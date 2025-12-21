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

export default function PoliciesPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);

  const { data, error, isLoading } = useSWR(`${CONTROL_PLANE_URL}/api/policies`, fetcher);
  const { data: serversData } = useSWR(`${CONTROL_PLANE_URL}/api/servers`, fetcher);

  const policies = data?.data || [];
  const servers = serversData?.data || [];

  const handleDelete = async (policyId: string) => {
    if (!confirm('Are you sure you want to delete this policy?')) return;
    
    try {
      await fetch(`${CONTROL_PLANE_URL}/api/policies/${policyId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${DEV_TOKEN}` },
      });
      mutate(`${CONTROL_PLANE_URL}/api/policies`);
    } catch (e) {
      alert('Failed to delete policy');
    }
  };

  const handleToggle = async (policy: any) => {
    try {
      await fetch(`${CONTROL_PLANE_URL}/api/policies/${policy.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${DEV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...policy, isActive: !policy.isActive }),
      });
      mutate(`${CONTROL_PLANE_URL}/api/policies`);
    } catch (e) {
      alert('Failed to update policy');
    }
  };

  return (
    <div className="container page">
      <div className="flex items-center justify-between mb-4">
        <h1>Policies</h1>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + Create Policy
        </button>
      </div>

      <p className="text-muted mb-4">
        Policies control what tools can be called and under what conditions. They are evaluated at runtime by the gateway.
      </p>

      {/* Policy Types Info */}
      <div className="grid grid-3 mb-4">
        <div className="card" style={{ padding: '1rem' }}>
          <h4 style={{ color: 'var(--accent-green)' }}>ALLOW</h4>
          <p className="text-sm text-muted">Explicitly permit a tool call</p>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <h4 style={{ color: 'var(--accent-red)' }}>DENY</h4>
          <p className="text-sm text-muted">Block a tool call entirely</p>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <h4 style={{ color: 'var(--accent-yellow)' }}>REQUIRE_APPROVAL</h4>
          <p className="text-sm text-muted">Require human approval first</p>
        </div>
      </div>

      {isLoading && <div className="empty-state">Loading...</div>}
      {error && <div className="text-danger">Failed to load policies</div>}

      {!isLoading && policies.length === 0 && (
        <div className="card empty-state">
          <p>No policies configured yet.</p>
          <p className="text-muted mt-2">
            By default, all approved servers can be accessed. Create policies to add restrictions.
          </p>
          <button className="btn btn-primary mt-4" onClick={() => setShowCreateModal(true)}>
            Create Your First Policy
          </button>
        </div>
      )}

      {policies.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Effect</th>
                <th>Scope</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy: any) => (
                <tr key={policy.id}>
                  <td>
                    <div className="font-semibold">{policy.name}</div>
                    <div className="text-sm text-muted">{policy.description || 'No description'}</div>
                  </td>
                  <td>
                    <EffectBadge effect={policy.effect} />
                  </td>
                  <td>
                    <div className="text-sm">
                      {policy.serverPattern && (
                        <div>Server: <code>{policy.serverPattern}</code></div>
                      )}
                      {policy.toolPattern && (
                        <div>Tool: <code>{policy.toolPattern}</code></div>
                      )}
                      {!policy.serverPattern && !policy.toolPattern && (
                        <span className="text-muted">All</span>
                      )}
                    </div>
                  </td>
                  <td>{policy.priority}</td>
                  <td>
                    <span className={`badge ${policy.isActive ? 'badge-success' : 'badge-info'}`}>
                      {policy.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-secondary mr-2"
                      onClick={() => handleToggle(policy)}
                    >
                      {policy.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="btn btn-sm btn-secondary mr-2"
                      onClick={() => setEditingPolicy(policy)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(policy.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Example Policies */}
      <div className="card mt-4">
        <h3 className="card-title mb-4">Example Policy Patterns</h3>
        <div className="grid grid-2">
          <div>
            <h4 className="text-sm font-semibold">Block dangerous tools</h4>
            <pre className="text-sm mt-1" style={{ background: 'var(--bg-tertiary)', padding: '0.5rem', borderRadius: '4px' }}>
{`Effect: DENY
Tool Pattern: *execute*|*shell*|*system*
Priority: 100`}
            </pre>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Require approval for file writes</h4>
            <pre className="text-sm mt-1" style={{ background: 'var(--bg-tertiary)', padding: '0.5rem', borderRadius: '4px' }}>
{`Effect: REQUIRE_APPROVAL
Tool Pattern: *write*|*delete*|*create*
Priority: 50`}
            </pre>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingPolicy) && (
        <PolicyModal
          policy={editingPolicy}
          servers={servers}
          onClose={() => {
            setShowCreateModal(false);
            setEditingPolicy(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setEditingPolicy(null);
            mutate(`${CONTROL_PLANE_URL}/api/policies`);
          }}
        />
      )}
    </div>
  );
}

function PolicyModal({
  policy,
  servers,
  onClose,
  onSuccess,
}: {
  policy: any;
  servers: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!policy;
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: policy?.name || '',
    description: policy?.description || '',
    effect: policy?.effect || 'DENY',
    serverPattern: policy?.serverPattern || '',
    toolPattern: policy?.toolPattern || '',
    priority: policy?.priority || 0,
    isActive: policy?.isActive ?? true,
    conditions: policy?.conditions || {},
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const url = isEdit
        ? `${CONTROL_PLANE_URL}/api/policies/${policy.id}`
        : `${CONTROL_PLANE_URL}/api/policies`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${DEV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to save policy');
      }
      onSuccess();
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Edit Policy' : 'Create Policy'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Policy Name</label>
              <input
                type="text"
                className="form-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="block-dangerous-tools"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What does this policy do?"
                rows={2}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Effect</label>
              <select
                className="form-select"
                value={formData.effect}
                onChange={(e) => setFormData({ ...formData, effect: e.target.value })}
              >
                <option value="ALLOW">ALLOW - Permit the action</option>
                <option value="DENY">DENY - Block the action</option>
                <option value="REQUIRE_APPROVAL">REQUIRE_APPROVAL - Need human approval</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Server Pattern (glob)</label>
              <input
                type="text"
                className="form-input"
                value={formData.serverPattern}
                onChange={(e) => setFormData({ ...formData, serverPattern: e.target.value })}
                placeholder="* for all, or specific pattern like db-*"
              />
              <span className="text-sm text-muted">Leave empty to match all servers</span>
            </div>

            <div className="form-group">
              <label className="form-label">Tool Pattern (glob)</label>
              <input
                type="text"
                className="form-input"
                value={formData.toolPattern}
                onChange={(e) => setFormData({ ...formData, toolPattern: e.target.value })}
                placeholder="* for all, or pattern like *execute*|*shell*"
              />
              <span className="text-sm text-muted">Use | for OR, * for wildcard</span>
            </div>

            <div className="form-group">
              <label className="form-label">Priority</label>
              <input
                type="number"
                className="form-input"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                min={0}
                max={1000}
              />
              <span className="text-sm text-muted">Higher priority policies are evaluated first</span>
            </div>

            <div className="form-group">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                />
                <span>Policy is active</span>
              </label>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : isEdit ? 'Update Policy' : 'Create Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EffectBadge({ effect }: { effect: string }) {
  const config: Record<string, { className: string; label: string }> = {
    ALLOW: { className: 'badge-success', label: 'ALLOW' },
    DENY: { className: 'badge-danger', label: 'DENY' },
    REQUIRE_APPROVAL: { className: 'badge-warning', label: 'REQUIRE_APPROVAL' },
  };

  const cfg = config[effect] || { className: 'badge-info', label: effect };
  return <span className={`badge ${cfg.className}`}>{cfg.label}</span>;
}
