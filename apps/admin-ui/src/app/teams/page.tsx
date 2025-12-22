'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { fetcher, CONTROL_PLANE_URL, getAuthHeaders } from '@/lib/auth';

export default function TeamsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<any>(null);

  const { data: orgsData } = useSWR(`${CONTROL_PLANE_URL}/api/orgs`, fetcher);
  const org = orgsData?.data;

  const { data: teamsData, error, isLoading } = useSWR(
    org ? `${CONTROL_PLANE_URL}/api/orgs/${org.id}/teams` : null,
    fetcher
  );

  const teams = teamsData?.data || [];

  const handleDelete = async (teamId: string) => {
    if (!confirm('Are you sure you want to delete this team?')) return;
    
    try {
      await fetch(`${CONTROL_PLANE_URL}/api/teams/${teamId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      mutate(`${CONTROL_PLANE_URL}/api/orgs/${org.id}/teams`);
    } catch (e) {
      alert('Failed to delete team');
    }
  };

  return (
    <div className="container page">
      <div className="flex items-center justify-between mb-4">
        <h1>Teams</h1>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + Create Team
        </button>
      </div>

      <p className="text-muted mb-4">
        Teams allow you to organize users and control access to MCP servers within your organization.
      </p>

      {/* Organization Info */}
      {org && (
        <div className="card mb-4">
          <div className="card-header">
            <h3 className="card-title">Organization</h3>
          </div>
          <div className="flex gap-8 p-4">
            <div>
              <span className="text-muted">Name:</span>
              <span className="ml-2 font-semibold">{org.displayName}</span>
            </div>
            <div>
              <span className="text-muted">Slug:</span>
              <code className="ml-2">{org.slug}</code>
            </div>
            <div>
              <span className="text-muted">Plan:</span>
              <span className={`ml-2 badge ${org.plan === 'ENTERPRISE' ? 'badge-success' : 'badge-info'}`}>
                {org.plan}
              </span>
            </div>
          </div>
        </div>
      )}

      {isLoading && <div className="empty-state">Loading...</div>}
      {error && <div className="text-danger">Failed to load teams</div>}

      {!isLoading && teams.length === 0 && (
        <div className="card empty-state">
          <p>No teams created yet.</p>
          <button className="btn btn-primary mt-4" onClick={() => setShowCreateModal(true)}>
            Create Your First Team
          </button>
        </div>
      )}

      {teams.length > 0 && (
        <div className="grid grid-3">
          {teams.map((team: any) => (
            <div key={team.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="card-title" style={{ marginBottom: 0 }}>{team.displayName}</h3>
                <span className="text-sm text-muted">{team.name}</span>
              </div>
              
              <p className="text-muted text-sm mb-4">
                {team.description || 'No description'}
              </p>

              <div className="flex gap-4 text-sm mb-4">
                <div>
                  <span className="text-muted">Members:</span>
                  <span className="ml-2">{team._count?.users || 0}</span>
                </div>
                <div>
                  <span className="text-muted">Servers:</span>
                  <span className="ml-2">{team._count?.servers || 0}</span>
                </div>
              </div>

              {team.settings && Object.keys(team.settings).length > 0 && (
                <div className="text-sm mb-4">
                  <span className="text-muted">Settings:</span>
                  <pre style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
                    {JSON.stringify(team.settings, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setEditingTeam(team)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(team.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingTeam) && org && (
        <TeamModal
          team={editingTeam}
          orgId={org.id}
          onClose={() => {
            setShowCreateModal(false);
            setEditingTeam(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setEditingTeam(null);
            mutate(`${CONTROL_PLANE_URL}/api/orgs/${org.id}/teams`);
          }}
        />
      )}
    </div>
  );
}

function TeamModal({
  team,
  orgId,
  onClose,
  onSuccess,
}: {
  team: any;
  orgId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!team;
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: team?.name || '',
    displayName: team?.displayName || '',
    description: team?.description || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const url = isEdit
        ? `${CONTROL_PLANE_URL}/api/teams/${team.id}`
        : `${CONTROL_PLANE_URL}/api/orgs/${orgId}/teams`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to save team');
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
          <h2 className="modal-title">{isEdit ? 'Edit Team' : 'Create Team'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Team Name (slug)</label>
              <input
                type="text"
                className="form-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="engineering"
                required
                pattern="[a-z0-9-]+"
                disabled={isEdit}
              />
              <span className="text-sm text-muted">Lowercase letters, numbers, and hyphens only</span>
            </div>

            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input
                type="text"
                className="form-input"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="Engineering Team"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What is this team responsible for?"
                rows={3}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : isEdit ? 'Update Team' : 'Create Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
