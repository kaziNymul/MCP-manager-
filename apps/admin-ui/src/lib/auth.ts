/**
 * Authentication configuration for Admin UI
 * 
 * In production, this should integrate with your SSO provider (Okta, Auth0, Azure AD)
 * For local development, set the AUTH_TOKEN environment variable or use the token generator
 */

// API endpoint configuration
export const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || 'http://localhost:3001';

/**
 * Get the authentication token
 * In production: This would come from your SSO session
 * In development: Set via NEXT_PUBLIC_AUTH_TOKEN environment variable
 */
export function getAuthToken(): string | null {
  // Check for environment variable (works in both server and client with NEXT_PUBLIC_ prefix)
  if (typeof window !== 'undefined') {
    // Client-side: check localStorage first, then env var
    const storedToken = localStorage.getItem('mcp_auth_token');
    if (storedToken) return storedToken;
  }
  
  // Fall back to environment variable
  const envToken = process.env.NEXT_PUBLIC_AUTH_TOKEN;
  if (envToken) return envToken;
  
  return null;
}

/**
 * Set authentication token (for development/testing)
 */
export function setAuthToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('mcp_auth_token', token);
  }
}

/**
 * Clear authentication token
 */
export function clearAuthToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mcp_auth_token');
  }
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

/**
 * Create headers with authentication
 */
export function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  if (!token) {
    console.warn('No authentication token available');
    return { 'Content-Type': 'application/json' };
  }
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * User info from token
 */
export interface UserInfo {
  userId: string;
  email: string;
  name?: string;
  orgId: string;
  orgSlug: string;
  role: string;
  isAdmin: boolean;
  permissions: string[];
  adGroups: string[];
}

/**
 * Decode JWT token to get user info (client-side only)
 */
export function getUserFromToken(): UserInfo | null {
  const token = getAuthToken();
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    return {
      userId: payload.userId || payload.sub,
      email: payload.email,
      name: payload.name,
      orgId: payload.orgId,
      orgSlug: payload.orgSlug,
      role: payload.role,
      isAdmin: payload.isAdmin || false,
      permissions: payload.permissions || [],
      adGroups: payload.groups || [],
    };
  } catch {
    return null;
  }
}

/**
 * Check if current user has a specific permission
 */
export function hasPermission(permission: string): boolean {
  const user = getUserFromToken();
  if (!user) return false;
  if (user.isAdmin) return true;
  return user.permissions.includes(permission) || user.permissions.includes('*');
}

/**
 * Logout - clear token and optionally redirect to Azure AD logout
 */
export async function logout(): Promise<void> {
  const token = getAuthToken();
  clearAuthToken();
  
  if (token) {
    try {
      const response = await fetch(`${CONTROL_PLANE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      const data = await response.json();
      
      // If Azure AD logout URL is returned, redirect to it
      if (data.logoutUrl) {
        window.location.href = data.logoutUrl;
        return;
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  }
  
  // Redirect to login page
  window.location.href = '/login';
}

/**
 * Authenticated fetch wrapper
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  
  if (!token) {
    throw new Error('Authentication required. Please set NEXT_PUBLIC_AUTH_TOKEN or login.');
  }
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
    },
  });
  
  // If unauthorized, redirect to login
  if (response.status === 401) {
    clearAuthToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }
  
  return response;
}

/**
 * SWR fetcher with authentication
 */
export const fetcher = async (url: string) => {
  const res = await authFetch(url);
  if (!res.ok) {
    const error = new Error('Failed to fetch') as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
};
