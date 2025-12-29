'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, CONTROL_PLANE_URL } from '@/lib/auth';

const EVENT_TYPES = [
  'TOOL_CALL',
  'POLICY_VIOLATION',
  'AUTH_SUCCESS',
  'AUTH_FAILURE',
  'SERVER_REGISTERED',
  'SERVER_APPROVED',
  'SERVER_REJECTED',
  'SERVER_REVOKED',
];

export default function AuditPage() {
  const [filters, setFilters] = useState({
    eventType: '',
    status: '',
    serverName: '',
    startDate: '',
    endDate: '',
    limit: 50,
  });

  const queryParams = new URLSearchParams();
  if (filters.eventType) queryParams.set('eventType', filters.eventType);
  if (filters.status) queryParams.set('status', filters.status);
  if (filters.serverName) queryParams.set('serverName', filters.serverName);
  if (filters.startDate) queryParams.set('startDate', filters.startDate);
  if (filters.endDate) queryParams.set('endDate', filters.endDate);
  queryParams.set('limit', String(filters.limit));

  const { data, error, isLoading } = useSWR(
    `${CONTROL_PLANE_URL}/api/audit?${queryParams.toString()}`,
    fetcher
  );
  const { data: serversData } = useSWR(`${CONTROL_PLANE_URL}/api/servers`, fetcher);

  const events = data?.data || [];
  const servers = serversData?.data || [];

  return (
    <div className="container page">
      <h1 className="mb-4">Audit Log</h1>

      <p className="text-muted mb-4">
        View all security-relevant events including tool calls, policy violations, and authentication attempts.
      </p>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex gap-4 flex-wrap">
          <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
            <label className="form-label">Event Type</label>
            <select
              className="form-select"
              value={filters.eventType}
              onChange={(e) => setFilters({ ...filters, eventType: e.target.value })}
            >
              <option value="">All Events</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0, minWidth: '120px' }}>
            <label className="form-label">Status</label>
            <select
              className="form-select"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILURE">Failure</option>
              <option value="BLOCKED">Blocked</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
            <label className="form-label">Server</label>
            <select
              className="form-select"
              value={filters.serverName}
              onChange={(e) => setFilters({ ...filters, serverName: e.target.value })}
            >
              <option value="">All Servers</option>
              {servers.map((server: any) => (
                <option key={server.id} value={server.name}>{server.displayName}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
            <label className="form-label">Start Date</label>
            <input
              type="datetime-local"
              className="form-input"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
            <label className="form-label">End Date</label>
            <input
              type="datetime-local"
              className="form-input"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0, minWidth: '80px' }}>
            <label className="form-label">Limit</label>
            <select
              className="form-select"
              value={filters.limit}
              onChange={(e) => setFilters({ ...filters, limit: parseInt(e.target.value) })}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0, alignSelf: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setFilters({
                eventType: '',
                status: '',
                serverId: '',
                startDate: '',
                endDate: '',
                limit: 50,
              })}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {isLoading && <div className="empty-state">Loading...</div>}
      {error && <div className="text-danger">Failed to load audit events</div>}

      {!isLoading && events.length === 0 && (
        <div className="card empty-state">
          <p>No audit events found matching your filters.</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event</th>
                <th>Details</th>
                <th>User</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event: any) => (
                <tr key={event.id}>
                  <td className="text-sm">
                    <div>{new Date(event.createdAt).toLocaleDateString()}</div>
                    <div className="text-muted">{new Date(event.createdAt).toLocaleTimeString()}</div>
                  </td>
                  <td>
                    <EventTypeBadge type={event.eventType} />
                  </td>
                  <td>
                    <EventDetails event={event} />
                  </td>
                  <td className="text-sm">
                    {event.userId ? (
                      <div>
                        <div>{event.userId.split('|')[1] || event.userId}</div>
                        {event.ipAddress && (
                          <div className="text-muted">{event.ipAddress}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={event.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stats Summary */}
      {events.length > 0 && (
        <div className="card mt-4">
          <h3 className="card-title mb-4">Summary</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{events.length}</div>
              <div className="stat-label">Total Events</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-green)' }}>
                {events.filter((e: any) => e.status === 'SUCCESS').length}
              </div>
              <div className="stat-label">Successful</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-red)' }}>
                {events.filter((e: any) => e.status === 'BLOCKED').length}
              </div>
              <div className="stat-label">Blocked</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
                {events.filter((e: any) => e.eventType === 'POLICY_VIOLATION').length}
              </div>
              <div className="stat-label">Policy Violations</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const config: Record<string, { className: string; icon: string }> = {
    TOOL_CALL: { className: 'badge-info', icon: '🔧' },
    POLICY_VIOLATION: { className: 'badge-danger', icon: '🚫' },
    AUTH_SUCCESS: { className: 'badge-success', icon: '🔓' },
    AUTH_FAILURE: { className: 'badge-danger', icon: '🔒' },
    SERVER_REGISTERED: { className: 'badge-info', icon: '📦' },
    SERVER_APPROVED: { className: 'badge-success', icon: '✅' },
    SERVER_REJECTED: { className: 'badge-warning', icon: '❌' },
    SERVER_REVOKED: { className: 'badge-danger', icon: '⛔' },
  };

  const cfg = config[type] || { className: 'badge-info', icon: '📝' };
  return (
    <span className={`badge ${cfg.className}`}>
      {cfg.icon} {type.replace(/_/g, ' ')}
    </span>
  );
}

function EventDetails({ event }: { event: any }) {
  const details: string[] = [];

  if (event.serverName) {
    details.push(`Server: ${event.serverName}`);
  }
  if (event.toolName) {
    details.push(`Tool: ${event.toolName}`);
  }
  if (event.resourceName) {
    details.push(`Resource: ${event.resourceName}`);
  }
  if (event.policyId) {
    details.push(`Policy: ${event.policyId.slice(0, 8)}...`);
  }

  if (details.length === 0) {
    return <span className="text-muted">-</span>;
  }

  return (
    <div className="text-sm">
      {details.map((detail, idx) => (
        <div key={idx}>{detail}</div>
      ))}
      {event.correlationId && (
        <div className="text-muted text-xs mt-1">
          Correlation: {event.correlationId.slice(0, 8)}...
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { className: string; label: string }> = {
    SUCCESS: { className: 'badge-success', label: 'Success' },
    FAILURE: { className: 'badge-danger', label: 'Failed' },
    BLOCKED: { className: 'badge-danger', label: 'Blocked' },
    PENDING: { className: 'badge-warning', label: 'Pending' },
  };

  const cfg = config[status] || { className: 'badge-info', label: status };
  return <span className={`badge ${cfg.className}`}>{cfg.label}</span>;
}
