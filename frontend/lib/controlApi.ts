/**
 * ACAD Control Plane Frontend API Client
 * Connects to the Control API (/api/platform/* endpoints).
 */

export interface PlatformUser {
  id: number;
  name: string;
  email: string;
  role: "owner" | "admin" | "ops_engineer" | "support_agent" | "auditor";
}

const rawBase =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CONTROL_API_URL) || "";
const CONTROL_API_BASE = rawBase.replace(/\/+$/, "");

function resolveUrl(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (!CONTROL_API_BASE && typeof window !== "undefined") {
    console.warn(
      `⚠️ [ACAD CONTROL] NEXT_PUBLIC_CONTROL_API_URL is not set! Request will hit relative path: ${cleanEndpoint}`
    );
  }
  return `${CONTROL_API_BASE}${cleanEndpoint}`;
}

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("acad_platform_token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as any),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = resolveUrl(endpoint);
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err: any) {
    const errorMsg =
      !CONTROL_API_BASE
        ? `API URL is not configured. Please set NEXT_PUBLIC_CONTROL_API_URL in Vercel settings and redeploy.`
        : `Cannot connect to API at ${url}. Please verify your Render service is awake and active.`;
    throw new Error(errorMsg);
  }

  if (res.status === 401) {
    if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
      localStorage.removeItem("acad_platform_token");
      window.location.href = "/login";
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data;
}

export const controlApi = {
  // Auth
  login: (email: string, password: string) =>
    request("/api/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/api/platform/auth/logout", { method: "POST" }),
  getMe: () => request<{ success: boolean; user: PlatformUser }>("/api/platform/auth/me"),

  // Command Center Overview
  getOverview: () => request("/api/platform/overview"),

  // Schools
  getSchools: async (params?: { status?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.search) q.set("search", params.search);
    const res = await request(`/api/platform/schools?${q.toString()}`);
    const list = Array.isArray(res) ? res : res?.schools || res?.data || [];
    return { schools: list, data: list, count: list.length };
  },
  getSchoolDetail: (id: number | string) => request(`/api/platform/schools/${id}`),
  createSchool: (data: any) => request("/api/platform/schools", { method: "POST", body: JSON.stringify(data) }),
  updateSchool: (id: number | string, data: any) =>
    request(`/api/platform/schools/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Organizations
  getOrganizations: async () => {
    const res = await request("/api/platform/organizations");
    const list = Array.isArray(res) ? res : res?.organizations || res?.data || [];
    return { organizations: list, data: list, count: list.length };
  },
  createOrganization: (data: any) =>
    request("/api/platform/organizations", { method: "POST", body: JSON.stringify(data) }),

  // Installations
  getInstallations: async (params?: { healthStatus?: string }) => {
    const q = new URLSearchParams();
    if (params?.healthStatus) q.set("healthStatus", params.healthStatus);
    const res = await request(`/api/platform/installations?${q.toString()}`);
    const list = Array.isArray(res) ? res : res?.installations || res?.data || [];
    return { installations: list, data: list, count: list.length };
  },
  provisionInstallation: (data: { school_id: number; node_id: string; release_channel?: string }) =>
    request("/api/platform/installations/provision", { method: "POST", body: JSON.stringify(data) }),
  revokeInstallation: (id: number) =>
    request(`/api/platform/installations/${id}/revoke`, { method: "POST" }),
  pushConfigToInstallation: (installationId: string, payload_type: string, payload?: any) =>
    request(`/api/platform/installations/${installationId}/push-config`, {
      method: "POST",
      body: JSON.stringify({ payload_type, payload }),
    }),
  pushConfigToSchool: (schoolId: number, payload_type: string) =>
    request(`/api/platform/schools/${schoolId}/push-config`, {
      method: "POST",
      body: JSON.stringify({ payload_type }),
    }),

  // Trials & Licenses
  getTrials: async (status?: string) => {
    const res = await request(`/api/platform/trials${status ? `?status=${status}` : ""}`);
    const list = Array.isArray(res) ? res : res?.trials || res?.data || [];
    return { trials: list, data: list, count: list.length };
  },
  extendTrial: (id: number, days: number) =>
    request(`/api/platform/trials/${id}/extend`, { method: "POST", body: JSON.stringify({ days }) }),
  convertTrial: (id: number, plan_tier: string) =>
    request(`/api/platform/trials/${id}/convert`, { method: "POST", body: JSON.stringify({ plan_tier }) }),
  getLicenses: async () => {
    const res = await request("/api/platform/licenses");
    const list = Array.isArray(res) ? res : res?.licenses || res?.data || [];
    return { licenses: list, data: list, count: list.length };
  },
  createLicense: (data: any) => request("/api/platform/licenses", { method: "POST", body: JSON.stringify(data) }),

  // Feature Flags
  getFeatureFlags: (schoolId: number) => request(`/api/platform/feature-flags/${schoolId}`),
  setFeatureFlag: (schoolId: number, flag_key: string, is_enabled: boolean) =>
    request(`/api/platform/feature-flags/${schoolId}`, { method: "POST", body: JSON.stringify({ flag_key, is_enabled }) }),

  // Alerts & Incidents
  getAlerts: async (params?: { status?: string; severity?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.severity) q.set("severity", params.severity);
    const res = await request(`/api/platform/alerts?${q.toString()}`);
    const list = Array.isArray(res) ? res : res?.alerts || res?.data || [];
    return { alerts: list, data: list, count: list.length };
  },
  acknowledgeAlert: (id: number) => request(`/api/platform/alerts/${id}/ack`, { method: "POST" }),
  resolveAlert: (id: number) => request(`/api/platform/alerts/${id}/resolve`, { method: "POST" }),
  getIncidents: async (status?: string) => {
    const res = await request(`/api/platform/incidents${status ? `?status=${status}` : ""}`);
    const list = Array.isArray(res) ? res : res?.incidents || res?.data || [];
    return { incidents: list, data: list, count: list.length };
  },
  createIncident: (data: any) => request("/api/platform/incidents", { method: "POST", body: JSON.stringify(data) }),
  updateIncident: (id: number, data: any) =>
    request(`/api/platform/incidents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  resolveIncident: (id: number, data: { root_cause: string; mitigation?: string }) =>
    request(`/api/platform/incidents/${id}`, { method: "PATCH", body: JSON.stringify({ status: "resolved", ...data }) }),

  // Backups, Releases, Audit Logs, Platform Users & Sync Queue
  getBackups: () => request("/api/platform/backups"),
  getReleases: async () => {
    const res = await request("/api/platform/releases");
    const list = Array.isArray(res) ? res : res?.releases || res?.data || [];
    return { releases: list, data: list, count: list.length };
  },
  createRelease: (data: any) => request("/api/platform/releases", { method: "POST", body: JSON.stringify(data) }),
  broadcastRelease: (data: { version: string; release_notes?: string; download_url?: string; sha256_hash?: string }) =>
    request("/api/platform/releases/broadcast", { method: "POST", body: JSON.stringify(data) }),
  getAuditLogs: async () => {
    const res = await request("/api/platform/audit-logs");
    const list = Array.isArray(res) ? res : res?.logs || res?.data || [];
    return { logs: list, data: list, count: list.length };
  },
  getUsers: async () => {
    const res = await request("/api/platform/users");
    const list = Array.isArray(res) ? res : res?.users || res?.data || [];
    return { users: list, data: list, count: list.length };
  },
  createUser: (data: any) => request("/api/platform/users", { method: "POST", body: JSON.stringify(data) }),
  getSyncQueue: () => request("/api/platform/sync-queue"),

  // Live Node Telemetry & Historical Data
  getSchoolLiveStats: (id: number | string) => request(`/api/platform/schools/${id}/live-stats`),
  getSchoolTelemetryHistory: (id: number | string, limit = 60) =>
    request(`/api/platform/schools/${id}/telemetry-history?limit=${limit}`),
  getInstallationHeartbeatHistory: (installationId: string, limit = 60) =>
    request(`/api/platform/installations/${installationId}/heartbeat-history?limit=${limit}`),
  getFleetTimeline: (hours = 24) => request(`/api/platform/monitoring/fleet-timeline?hours=${hours}`),
  getExamActivity: (limit = 50) => request(`/api/platform/monitoring/exam-activity?limit=${limit}`),

  // Node Live Monitor & Actions
  getLocalExamPoolLive: async () => {
    try {
      const res = await request("/api/platform/local-exam-pool/live");
      if (res && res.identity) return res;
    } catch {}
    const ov = await request("/api/platform/overview").catch(() => null);
    return ov?.localExamPool || null;
  },
  runLocalExamPoolAction: (action: string, payload?: any) =>
    request("/api/platform/sync-queue", {
      method: "POST",
      body: JSON.stringify({ action, payload }),
    }),
};
