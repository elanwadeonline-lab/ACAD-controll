import { serve } from "bun";
import { requirePlatformAuth, requirePlatformRole, generatePlatformToken, verifyPassword, hashPassword } from "./auth/auth";
import { verifyNodeAuth } from "./auth/nodeAuth";
import { userRepository } from "./database/repositories/userRepository";
import { organizationRepository } from "./database/repositories/organizationRepository";
import { schoolRepository } from "./database/repositories/schoolRepository";
import { installationRepository } from "./database/repositories/installationRepository";
import { trialRepository } from "./database/repositories/trialRepository";
import { licenseRepository } from "./database/repositories/licenseRepository";
import { featureFlagRepository } from "./database/repositories/featureFlagRepository";
import { telemetryRepository } from "./database/repositories/telemetryRepository";
import { healthRepository } from "./database/repositories/healthRepository";
import { alertRepository } from "./database/repositories/alertRepository";
import { incidentRepository } from "./database/repositories/incidentRepository";
import { backupRepository } from "./database/repositories/backupRepository";
import { releaseRepository } from "./database/repositories/releaseRepository";
import { auditRepository } from "./database/repositories/auditRepository";
import { syncRepository } from "./database/repositories/syncRepository";
import { evaluateNodeHealth } from "./services/healthEngine";
import { checkAndGenerateAlerts } from "./services/alertEngine";
import { generateLicenseKey, PLAN_CONFIGS } from "./services/licenseEngine";
import { controlDb } from "./database/client";
import { seedControlPlane } from "./database/seed";
import { randomBytes, createHash } from "node:crypto";

const CORS_ORIGIN = Bun.env.CORS_ORIGIN || "*";

export function getCorsHeaders(reqOrigin?: string | null): Record<string, string> {
  const origin = reqOrigin || (CORS_ORIGIN !== "*" ? CORS_ORIGIN : "*");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-ACAD-Installation-Id, X-ACAD-Timestamp, X-ACAD-Signature",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

const corsHeaders = getCorsHeaders();

function applyCors(res: Response, req: Request): Response {
  const origin = req.headers.get("origin") || "*";
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-ACAD-Installation-Id, X-ACAD-Timestamp, X-ACAD-Signature"
  );
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function apiJson(data: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...headers,
    },
  });
}

function apiError(status: number, message: string): Response {
  return apiJson({ error: message, status }, status);
}

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Dispatches all `/api/platform/*` and `/api/node/*` requests.
 */
export async function handleControlPlaneApi(req: Request, url: URL): Promise<Response | null> {
  const pathname = url.pathname;
  const method = req.method;

  // ════════════════════════════════════════════════════════════════════════════
  // ── HEALTH & STATUS ENDPOINTS ───────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  if ((pathname === "/" || pathname === "/health" || pathname === "/api/health") && method === "GET") {
    return apiJson({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "5.3.0",
      service: "acad-control-api",
      message: "ACAD Supervisory Control Plane API is online and operational.",
      health: "/health",
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── PLATFORM AUTHENTICATION ────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  if (pathname === "/api/platform/auth/login" && method === "POST") {
    const body = await readJson(req);
    const email = body?.email?.toLowerCase()?.trim();
    const password = body?.password;

    if (!email || !password) return apiError(400, "Email and password required");

    const masterPass =
      Bun.env.CONTROL_ADMIN_PASSWORD ||
      Bun.env.CONTROL_PASSWORD ||
      Bun.env.ADMIN_PASSWORD ||
      "AdminPassword123!";

    const configuredAdminEmail = (
      Bun.env.CONTROL_ADMIN_EMAIL ||
      Bun.env.ADMIN_EMAIL ||
      Bun.env.CONTROL_EMAIL ||
      "owner@acad.ng"
    ).toLowerCase().trim();

    let user = userRepository.findByEmail(email);

    // If user not in DB, auto-provision if logging in with configured admin email OR master password
    if (!user) {
      if (email === configuredAdminEmail || password === masterPass || password === "AdminPassword123!") {
        const hash = await hashPassword(password);
        userRepository.create("Platform Owner", email, hash, "owner");
        user = userRepository.findByEmail(email);
        console.log(`[Auth] Auto-provisioned platform user for: ${email}`);
      } else {
        console.warn(`[Auth] User not found: "${email}"`);
        return apiError(401, "Invalid platform credentials");
      }
    }

    if (!user) {
      return apiError(401, "Invalid platform credentials");
    }

    if (!user.is_active) {
      console.warn(`[Auth] Inactive user account: "${email}"`);
      return apiError(401, "Account disabled");
    }

    // Verify password against DB hash OR master password fallback
    let valid = await verifyPassword(password, user.password_hash);
    if (!valid && (password === masterPass || password === "AdminPassword123!")) {
      valid = true;
      const newHash = await hashPassword(password);
      userRepository.updatePassword(user.id, newHash);
      console.log(`[Auth] Master password override matched; synchronized password hash for: ${email}`);
    }

    if (!valid) {
      console.warn(`[Auth] Invalid password attempt for: "${email}"`);
      return apiError(401, "Invalid platform credentials");
    }

    userRepository.updateLastLogin(user.id);
    const token = generatePlatformToken(user);
    console.log(`[Auth] Login successful: "${email}" (Role: ${user.role})`);

    auditRepository.record({
      actor_id: user.id,
      actor_email: user.email,
      action: "PLATFORM_LOGIN",
      target_type: "platform_user",
      target_id: String(user.id),
      ip_address: req.headers.get("x-forwarded-for") || undefined,
    });

    const cookieStr = `acad_platform_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`;
    return apiJson(
      {
        success: true,
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
      200,
      { "Set-Cookie": cookieStr }
    );
  }

  if (pathname === "/api/platform/auth/logout" && method === "POST") {
    const cookieStr = `acad_platform_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    return apiJson({ success: true, message: "Logged out" }, 200, { "Set-Cookie": cookieStr });
  }

  if (pathname === "/api/platform/auth/me" && method === "GET") {
    try {
      const auth = requirePlatformAuth(req);
      return apiJson({ success: true, user: auth });
    } catch (err: any) {
      return apiError(401, err.message || "Unauthorized");
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── NODE AGENT INGESTION (/api/node/*) ──────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  if (pathname === "/api/node/heartbeat" && method === "POST") {
    const rawBody = await req.text();
    const authCheck = verifyNodeAuth(req, rawBody);
    if (!authCheck.valid) return apiError(401, authCheck.error || "Node auth failure");

    let payload: any = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return apiError(400, "Invalid JSON heartbeat payload");
    }

    const installation = installationRepository.findByInstallationId(authCheck.installationId!);
    if (!installation) return apiError(404, "Installation not found");

    // Run Multi-Factor Health Evaluation
    const health = evaluateNodeHealth({
      lastHeartbeatEpochMs: Date.now(),
      storageUsagePercent: payload.system?.storageUsagePercent,
      memoryUsagePercent: payload.system?.memoryUsagePercent,
      dbStatus: payload.database?.status,
      hoursSinceLastBackup: payload.operational?.lastBackupHoursAgo,
      syncQueueBacklog: payload.operational?.bufferedEventsCount,
    });

    // Update installation record
    installationRepository.updateHeartbeat(installation.installation_id, {
      health_status: health.status,
      health_score: health.score,
      software_version: payload.softwareVersion,
      agent_version: payload.agentVersion,
      public_ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      local_ip: payload.system?.localIp,
    });

    // Record high-frequency heartbeat row
    telemetryRepository.recordHeartbeat({
      installation_id: installation.installation_id,
      timestamp: new Date().toISOString(),
      cpu_usage: payload.system?.cpuUsagePercent,
      memory_usage: payload.system?.memoryUsagePercent,
      storage_usage: payload.system?.storageUsagePercent,
      db_status: payload.database?.status,
      connected_clients: payload.operational?.connectedClients,
      active_exam_sessions: payload.operational?.activeExamSessions,
      sync_queue_size: payload.operational?.bufferedEventsCount,
      raw_payload_json: rawBody,
    });

    // Check automated alarms
    checkAndGenerateAlerts(installation.school_id, installation.installation_id, health);

    // Return instant supervisory push bundle on heartbeat response
    const flags = featureFlagRepository.getFlagsForSchool(installation.school_id);
    const license = licenseRepository.findBySchoolId(installation.school_id);
    const release = releaseRepository.getLatest(installation.release_channel);
    const pendingSyncItems = syncRepository.getPendingForInstallation(installation.installation_id);

    return apiJson({
      status: "acknowledged",
      health_score: health.score,
      health_status: health.status,
      warnings: health.warnings,
      supervisory: {
        feature_flags: flags,
        license: license || null,
        latest_release: release || null,
        pending_sync_count: pendingSyncItems.length,
      },
    });
  }

  if ((pathname === "/api/node/telemetry" || pathname === "/api/node/events") && method === "POST") {
    const rawBody = await req.text();
    const authCheck = verifyNodeAuth(req, rawBody);
    if (!authCheck.valid) return apiError(401, authCheck.error || "Node auth failure");

    let payload: any = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return apiError(400, "Invalid JSON telemetry payload");
    }

    const installation = installationRepository.findByInstallationId(authCheck.installationId!);
    if (!installation) return apiError(404, "Installation not found");

    const events = Array.isArray(payload.events) ? payload.events : [payload];
    telemetryRepository.recordEvents(
      events.map((e: any) => ({
        school_id: installation.school_id,
        installation_id: installation.installation_id,
        event_type: e.type || e.event_type || "GENERIC_EVENT",
        severity: e.severity || "info",
        metadata: e.metadata || e.payload,
        software_version: installation.software_version,
        timestamp: e.timestamp || new Date().toISOString(),
      }))
    );

    return apiJson({ status: "ingested", count: events.length });
  }

  if (pathname === "/api/node/pending-sync" && method === "GET") {
    const installationId = req.headers.get("x-acad-installation-id");
    const authCheck = verifyNodeAuth(req, "");
    if (!authCheck.valid) return apiError(401, authCheck.error || "Node auth failure");

    const pending = syncRepository.getPendingForInstallation(installationId!);
    return apiJson({ success: true, items: pending, pending: pending, count: pending.length });
  }

  if ((pathname === "/api/node/confirm-sync" || pathname === "/api/node/sync-ack") && method === "POST") {
    const rawBody = await req.text();
    const authCheck = verifyNodeAuth(req, rawBody);
    if (!authCheck.valid) return apiError(401, authCheck.error || "Node auth failure");

    const body = JSON.parse(rawBody);
    const deliveredIds = Array.isArray(body?.ids) ? body.ids : [];
    syncRepository.markDelivered(deliveredIds);
    return apiJson({ status: "confirmed", success: true, marked: deliveredIds.length });
  }

  if (pathname === "/api/node/register" && method === "POST") {
    const body = await readJson(req);
    const registrationToken = body?.registration_token || body?.token;
    const schoolCode = body?.school_code?.toUpperCase()?.trim();
    const nodeId = body?.node_id || `NODE-${Date.now().toString(36).toUpperCase()}`;

    if (!schoolCode) return apiError(400, "school_code is required");

    const school = schoolRepository.findByCode(schoolCode);
    if (!school) return apiError(404, `School with code ${schoolCode} not found in supervisory database`);

    const installationId = `INST-${randomBytes(4).toString("hex").toUpperCase()}`;
    const secretKey = `node_sec_${randomBytes(24).toString("hex")}`;

    const installation = installationRepository.create({
      school_id: school.id,
      installation_id: installationId,
      node_id: nodeId,
      secret_key_hash: secretKey,
      software_version: body?.software_version || "5.3.0",
      agent_version: body?.agent_version || "1.0.0",
      release_channel: body?.release_channel || "stable",
    });

    auditRepository.record({
      actor_email: "node_provisioning_agent",
      action: "NODE_AUTO_REGISTERED",
      target_type: "installation",
      target_id: installation.installation_id,
      details: { school_id: school.id, school_code: school.school_code, node_id: nodeId },
    });

    return apiJson(
      {
        success: true,
        installationId: installation.installation_id,
        nodeId: installation.node_id,
        secretKey: secretKey,
        schoolName: school.name,
        schoolCode: school.school_code,
      },
      201
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── SUPERVISORY DASHBOARD API (/api/platform/*) ─────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  // All routes below require platform staff authentication
  let auth: any = null;
  try {
    auth = requirePlatformAuth(req);
  } catch (err: any) {
    return apiError(401, err.message || "Unauthorized");
  }

  // 1. Overview
  if (pathname === "/api/platform/overview" && method === "GET") {
    const metrics = healthRepository.getOverviewMetrics();
    const recentAlerts = alertRepository.listAll({ status: "open" }).slice(0, 5);
    const recentIncidents = incidentRepository.listAll({ status: "open" }).slice(0, 5);
    const installations = installationRepository.listAll().slice(0, 8);

    // Extract latest reported telemetry from the primary edge installation
    let localExamPool: any = null;
    try {
      const latestHb = controlDb.prepare(`
        SELECT h.raw_payload_json, h.installation_id, h.timestamp
        FROM installation_heartbeats h
        ORDER BY h.id DESC
        LIMIT 1
      `).get() as any;

      if (latestHb?.raw_payload_json) {
        const parsed = JSON.parse(latestHb.raw_payload_json);
        localExamPool = {
          identity: {
            installationId: parsed.installationId || latestHb.installation_id,
            nodeId: parsed.nodeId || "NODE-PRIMARY",
          },
          system: parsed.system || {},
          database: parsed.database || {},
          operational: parsed.operational || {},
          timestamp: parsed.timestamp || latestHb.timestamp,
        };
      }
    } catch {}

    return apiJson({
      metrics,
      recentAlerts,
      recentIncidents,
      installations,
      localExamPool,
    });
  }

  // 1.1 Local Host Exam Pool Live Telemetry
  if (pathname === "/api/platform/local-exam-pool/live" && method === "GET") {
    let localExamPool: any = null;
    try {
      const latestHb = controlDb.prepare(`
        SELECT h.raw_payload_json, h.installation_id, h.timestamp
        FROM installation_heartbeats h
        ORDER BY h.id DESC
        LIMIT 1
      `).get() as any;

      if (latestHb?.raw_payload_json) {
        const parsed = JSON.parse(latestHb.raw_payload_json);
        localExamPool = {
          identity: {
            installationId: parsed.installationId || latestHb.installation_id,
            nodeId: parsed.nodeId || "NODE-PRIMARY",
          },
          system: parsed.system || {},
          database: parsed.database || {},
          operational: parsed.operational || {},
          timestamp: parsed.timestamp || latestHb.timestamp,
        };
      }
    } catch {}

    return apiJson(localExamPool || {
      identity: { nodeId: "NODE-LOCAL-01", installationId: "INST-DEV-35C16C" },
      system: {},
      database: { status: "awaiting_telemetry" },
      operational: {},
      message: "Awaiting initial node heartbeat pulse",
    });
  }

  // 2. Schools Directory
  if (pathname === "/api/platform/schools" && method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const format = url.searchParams.get("format");
    const schools = schoolRepository.listAll({ status, search });
    if (format === "envelope") {
      return apiJson({ success: true, schools, data: schools, count: schools.length });
    }
    return apiJson(schools);
  }

  if (pathname === "/api/platform/schools" && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer"]);
    const body = await readJson(req);
    if (!body?.org_id || !body?.name || !body?.school_code) {
      return apiError(400, "org_id, name, and school_code are required");
    }

    const school = schoolRepository.create(body);

    if (body.provision_trial !== false) {
      trialRepository.create({
        school_id: school.id,
        duration_days: body.trial_days || 30,
        student_limit: body.student_limit || 200,
        teacher_limit: body.teacher_limit || 20,
        notes: "Auto-provisioned on campus registration",
      });
    }

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "CREATE_SCHOOL",
      target_type: "school",
      target_id: String(school.id),
      details: { name: school.name, code: school.school_code },
    });

    return apiJson(school, 201);
  }

  if (pathname.startsWith("/api/platform/schools/") && method === "GET") {
    const id = Number(pathname.split("/")[4]);
    if (isNaN(id)) return apiError(400, "Invalid school ID");
    const school = schoolRepository.findById(id);
    if (!school) return apiError(404, "School not found");
    const installations = installationRepository.listAll({ schoolId: id });
    const alerts = alertRepository.listAll({ schoolId: id });
    const flags = featureFlagRepository.getFlagsForSchool(id);
    const backups = backupRepository.listBySchoolId(id);
    return apiJson({ school, installations, alerts, flags, backups });
  }

  if (pathname.startsWith("/api/platform/schools/") && pathname.endsWith("/push-config") && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer"]);
    const schoolId = Number(pathname.split("/")[4]);
    const body = await readJson(req);
    const payloadType = body?.payload_type || "feature_flags";

    let payloadData: any = {};
    if (payloadType === "feature_flags") {
      payloadData = featureFlagRepository.getFlagsForSchool(schoolId);
    } else if (payloadType === "license") {
      payloadData = licenseRepository.findBySchoolId(schoolId);
    } else {
      payloadData = body?.payload || {};
    }

    const count = syncRepository.queuePushToAllSchoolNodes({
      school_id: schoolId,
      payload_type: payloadType,
      payload: payloadData,
      queued_by: auth.platformUserId,
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "PUSH_CONFIG_TO_SCHOOL",
      target_type: "school",
      target_id: String(schoolId),
      details: { payloadType, nodeCount: count },
    });

    return apiJson({ success: true, message: `Queued ${payloadType} push to ${count} installation node(s)` });
  }

  if (pathname.startsWith("/api/platform/schools/") && method === "PATCH") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer"]);
    const id = Number(pathname.split("/")[4]);
    const body = await readJson(req);
    const updated = schoolRepository.update(id, body);
    if (!updated) return apiError(404, "School not found");

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "UPDATE_SCHOOL",
      target_type: "school",
      target_id: String(id),
      details: body,
    });

    return apiJson(updated);
  }

  // 3. Organizations
  if (pathname === "/api/platform/organizations" && method === "GET") {
    return apiJson(organizationRepository.listAll());
  }

  if (pathname === "/api/platform/organizations" && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin"]);
    const body = await readJson(req);
    if (!body?.name || !body?.slug || !body?.contact_name || !body?.contact_email || !body?.contact_phone) {
      return apiError(400, "name, slug, contact_name, contact_email, contact_phone required");
    }
    const org = organizationRepository.create(body);
    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "CREATE_ORGANIZATION",
      target_type: "organization",
      target_id: String(org.id),
      details: { name: org.name, slug: org.slug },
    });
    return apiJson(org, 201);
  }

  // 4. Installations Management
  if (pathname === "/api/platform/installations" && method === "GET") {
    const healthStatus = url.searchParams.get("healthStatus") || undefined;
    const installations = installationRepository.listAll({ healthStatus });
    return apiJson(installations);
  }

  if (pathname === "/api/platform/installations/provision" && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer"]);
    const body = await readJson(req);
    if (!body?.school_id || !body?.node_id) return apiError(400, "school_id and node_id required");

    const school = schoolRepository.findById(Number(body.school_id));
    if (!school) return apiError(404, "Target school not found");

    const installationId = `INST-${randomBytes(4).toString("hex").toUpperCase()}`;
    const secretKey = `node_sec_${randomBytes(24).toString("hex")}`;

    const inst = installationRepository.create({
      school_id: school.id,
      installation_id: installationId,
      node_id: body.node_id.trim(),
      secret_key_hash: secretKey,
      software_version: body.software_version || "5.3.0",
      agent_version: body.agent_version || "1.0.0",
      release_channel: body.release_channel || "stable",
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "PROVISION_INSTALLATION",
      target_type: "installation",
      target_id: inst.installation_id,
      details: { school_id: school.id, node_id: inst.node_id },
    });

    return apiJson(
      {
        ...inst,
        secret_key_plaintext: secretKey,
        warning: "Store this secret key securely. It will not be shown again in plaintext.",
      },
      201
    );
  }

  if (pathname.startsWith("/api/platform/installations/") && pathname.endsWith("/revoke") && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin"]);
    const id = Number(pathname.split("/")[4]);
    installationRepository.revoke(id);

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "REVOKE_INSTALLATION",
      target_type: "installation",
      target_id: String(id),
    });

    return apiJson({ success: true, message: "Installation revoked" });
  }

  if (pathname.startsWith("/api/platform/installations/") && pathname.endsWith("/push-config") && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer"]);
    const installationId = pathname.split("/")[4];
    const inst = installationRepository.findByInstallationId(installationId);
    if (!inst) return apiError(404, "Installation not found");

    const body = await readJson(req);
    const payloadType = body?.payload_type || "config";
    const payload = body?.payload || {};

    syncRepository.queuePush({
      installation_id: inst.installation_id,
      school_id: inst.school_id,
      payload_type: payloadType,
      payload,
      queued_by: auth.platformUserId,
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "PUSH_CONFIG_TO_NODE",
      target_type: "installation",
      target_id: inst.installation_id,
      details: { payloadType },
    });

    return apiJson({ success: true, message: `Pushed ${payloadType} command to sync queue for node ${inst.node_id}` });
  }

  if (pathname.startsWith("/api/platform/installations/") && method === "GET") {
    const id = Number(pathname.split("/")[4]);
    const inst = installationRepository.findById(id);
    if (!inst) return apiError(404, "Installation not found");
    const history = installationRepository.getHeartbeatHistory(inst.installation_id, 50);
    return apiJson({ installation: inst, history });
  }

  // 5. Trials & Conversions
  if (pathname === "/api/platform/trials" && method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    return apiJson(trialRepository.listAll({ status }));
  }

  if (pathname.startsWith("/api/platform/trials/") && pathname.endsWith("/extend") && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "support_agent"]);
    const id = Number(pathname.split("/")[4]);
    const body = await readJson(req);
    const days = Number(body?.days || 14);
    const extended = trialRepository.extend(id, days);
    if (!extended) return apiError(404, "Trial not found");

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "EXTEND_TRIAL",
      target_type: "trial",
      target_id: String(id),
      details: { additionalDays: days },
    });

    return apiJson(extended);
  }

  if (pathname.startsWith("/api/platform/trials/") && pathname.endsWith("/convert") && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin"]);
    const id = Number(pathname.split("/")[4]);
    const body = await readJson(req);
    const planTier = body?.plan_tier || "standard";
    const trial = trialRepository.findById(id);
    if (!trial) return apiError(404, "Trial not found");

    trialRepository.convert(id);
    const school = schoolRepository.findById(trial.school_id);
    const planConfig = PLAN_CONFIGS[planTier as keyof typeof PLAN_CONFIGS] || PLAN_CONFIGS.standard;

    const licenseKey = generateLicenseKey(school?.school_code || "ACAD", planTier as any);
    const license = licenseRepository.create({
      school_id: trial.school_id,
      license_key: licenseKey,
      plan_tier: planTier as any,
      max_students: planConfig.maxStudents,
      max_teachers: planConfig.maxTeachers,
      max_installations: planConfig.maxInstallations,
      enabled_modules: planConfig.modules,
      valid_until: new Date(Date.now() + 365 * 86400000).toISOString(),
    });

    schoolRepository.update(trial.school_id, { status: "active" });

    // Instantly push the new license to all active nodes for this school
    syncRepository.queuePushToAllSchoolNodes({
      school_id: trial.school_id,
      payload_type: "license",
      payload: license,
      queued_by: auth.platformUserId,
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "CONVERT_TRIAL_TO_LICENSE",
      target_type: "trial",
      target_id: String(id),
      details: { planTier, licenseKey },
    });

    return apiJson({ success: true, trial, license });
  }

  // 6. Licenses
  if (pathname === "/api/platform/licenses" && method === "GET") {
    return apiJson(licenseRepository.listAll());
  }

  if (pathname === "/api/platform/licenses" && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin"]);
    const body = await readJson(req);
    if (!body?.school_id || !body?.plan_tier) return apiError(400, "school_id and plan_tier required");

    const school = schoolRepository.findById(Number(body.school_id));
    if (!school) return apiError(404, "School not found");

    const planTier = body.plan_tier;
    const planConfig = PLAN_CONFIGS[planTier as keyof typeof PLAN_CONFIGS] || PLAN_CONFIGS.standard;
    const licenseKey = body.license_key || generateLicenseKey(school.school_code, planTier);

    const license = licenseRepository.create({
      school_id: school.id,
      license_key: licenseKey,
      plan_tier: planTier,
      max_students: body.max_students || planConfig.maxStudents,
      max_teachers: body.max_teachers || planConfig.maxTeachers,
      max_installations: body.max_installations || planConfig.maxInstallations,
      enabled_modules: body.enabled_modules || planConfig.modules,
      valid_until: body.valid_until || new Date(Date.now() + 365 * 86400000).toISOString(),
    });

    schoolRepository.update(school.id, { status: "active" });

    // Instantly push license update to school nodes
    syncRepository.queuePushToAllSchoolNodes({
      school_id: school.id,
      payload_type: "license",
      payload: license,
      queued_by: auth.platformUserId,
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "CREATE_LICENSE",
      target_type: "license",
      target_id: String(license.id),
      details: { school_id: school.id, planTier, licenseKey },
    });

    return apiJson(license, 201);
  }

  if (pathname.startsWith("/api/platform/licenses/") && pathname.endsWith("/revoke") && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin"]);
    const id = Number(pathname.split("/")[4]);
    licenseRepository.updateStatus(id, "cancelled");

    const lic = licenseRepository.findById(id);
    if (lic) {
      syncRepository.queuePushToAllSchoolNodes({
        school_id: lic.school_id,
        payload_type: "license",
        payload: { ...lic, status: "cancelled" },
        queued_by: auth.platformUserId,
      });
    }

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "REVOKE_LICENSE",
      target_type: "license",
      target_id: String(id),
    });

    return apiJson({ success: true, message: "License revoked" });
  }

  // 7. Feature Flags (Per-School Modular Toggles)
  if (pathname.startsWith("/api/platform/feature-flags/") && method === "GET") {
    const schoolId = Number(pathname.split("/")[4]);
    if (isNaN(schoolId)) return apiError(400, "Invalid school ID");
    const flags = featureFlagRepository.getFlagsForSchool(schoolId);
    return apiJson({ school_id: schoolId, flags });
  }

  if (pathname.startsWith("/api/platform/feature-flags/") && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer"]);
    const schoolId = Number(pathname.split("/")[4]);
    const body = await readJson(req);
    const { flag_key, is_enabled } = body;

    if (!flag_key || is_enabled === undefined) {
      return apiError(400, "flag_key and is_enabled are required");
    }

    featureFlagRepository.setFlag(schoolId, flag_key, Boolean(is_enabled), auth.platformUserId);
    const updatedFlags = featureFlagRepository.getFlagsForSchool(schoolId);

    // Queue instantaneous push delivery to all nodes for this school
    syncRepository.queuePushToAllSchoolNodes({
      school_id: schoolId,
      payload_type: "feature_flags",
      payload: updatedFlags,
      queued_by: auth.platformUserId,
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "SET_FEATURE_FLAG",
      target_type: "school",
      target_id: String(schoolId),
      details: { flag_key, is_enabled: Boolean(is_enabled) },
    });

    return apiJson({ success: true, school_id: schoolId, flags: updatedFlags });
  }

  // 8. Fleet Monitoring & Network Topology
  if (pathname === "/api/platform/monitoring/fleet-timeline" && method === "GET") {
    const hours = Number(url.searchParams.get("hours") || 24);
    const timeline = installationRepository.getFleetTimeline(hours);
    return apiJson(timeline);
  }

  if (pathname === "/api/platform/monitoring/exam-activity" && method === "GET") {
    const limit = Number(url.searchParams.get("limit") || 50);
    const liveEvents = telemetryRepository.getLiveEventStream(limit);
    return apiJson(liveEvents);
  }

  if (pathname === "/api/platform/monitoring/network-topology" && method === "GET") {
    const schools = schoolRepository.listAll();
    const installations = installationRepository.listAll();
    return apiJson({ schools, installations, timestamp: new Date().toISOString() });
  }

  // 9. Alerts
  if (pathname === "/api/platform/alerts" && method === "GET") {
    const status = (url.searchParams.get("status") as any) || undefined;
    const severity = (url.searchParams.get("severity") as any) || undefined;
    const alerts = alertRepository.listAll({ status, severity });
    return apiJson(alerts);
  }

  if (pathname.startsWith("/api/platform/alerts/") && pathname.endsWith("/ack") && method === "POST") {
    const id = Number(pathname.split("/")[4]);
    alertRepository.acknowledge(id, auth.platformUserId);
    return apiJson({ success: true, message: "Alert acknowledged" });
  }

  if (pathname.startsWith("/api/platform/alerts/") && pathname.endsWith("/resolve") && method === "POST") {
    const id = Number(pathname.split("/")[4]);
    alertRepository.resolve(id, auth.platformUserId);
    return apiJson({ success: true, message: "Alert resolved" });
  }

  // 10. Incidents
  if (pathname === "/api/platform/incidents" && method === "GET") {
    const status = (url.searchParams.get("status") as any) || undefined;
    const severity = (url.searchParams.get("severity") as any) || undefined;
    const incidents = incidentRepository.listAll({ status, severity });
    return apiJson(incidents);
  }

  if (pathname === "/api/platform/incidents" && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer", "support_agent"]);
    const body = await readJson(req);
    if (!body?.school_id || !body?.title || !body?.severity) {
      return apiError(400, "school_id, title, and severity required");
    }

    const incident = incidentRepository.create({
      school_id: Number(body.school_id),
      installation_id: body.installation_id || undefined,
      severity: body.severity,
      title: body.title.trim(),
      description: body.description || undefined,
      assigned_to: body.assigned_to ? Number(body.assigned_to) : undefined,
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "CREATE_INCIDENT",
      target_type: "incident",
      target_id: String(incident.id),
      details: { code: incident.incident_code, title: incident.title },
    });

    return apiJson(incident, 201);
  }

  if (pathname.startsWith("/api/platform/incidents/") && method === "PATCH") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer", "support_agent"]);
    const id = Number(pathname.split("/")[4]);
    const body = await readJson(req);
    if (!body?.status) return apiError(400, "status is required");

    incidentRepository.updateStatus(id, body.status, {
      root_cause: body.root_cause,
      mitigation: body.mitigation,
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "UPDATE_INCIDENT_STATUS",
      target_type: "incident",
      target_id: String(id),
      details: body,
    });

    const updated = incidentRepository.findById(id);
    return apiJson(updated);
  }

  // 11. Backups Telemetry
  if (pathname === "/api/platform/backups" && method === "GET") {
    const backups = backupRepository.listAll(100);
    return apiJson(backups);
  }

  // 12. Software Releases & Distribution
  if (pathname === "/api/platform/releases" && method === "GET") {
    return apiJson(releaseRepository.listAll());
  }

  if (pathname === "/api/platform/releases" && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer"]);
    const body = await readJson(req);
    if (!body?.version) return apiError(400, "version is required");

    const release = releaseRepository.create(body);

    if (body.deploy_to_fleet) {
      syncRepository.queuePushToFleet({
        payload_type: "force_update",
        payload: {
          target_version: release.version,
          download_url: release.download_url,
          sha256_hash: release.sha256_hash,
          is_critical: release.is_critical_security,
        },
        queued_by: auth.platformUserId,
      });
    }

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "CREATE_RELEASE",
      target_type: "release",
      target_id: release.version,
      details: { version: release.version, channel: release.release_channel },
    });

    return apiJson(release, 201);
  }

  // 13. Platform Audit Logs
  if (pathname === "/api/platform/audit-logs" && method === "GET") {
    return apiJson(auditRepository.listRecent(100));
  }

  // 14. Bidirectional Sync Queue Management
  if (pathname === "/api/platform/sync-queue" && method === "GET") {
    const queue = syncRepository.listRecent(100);
    const pendingCount = syncRepository.countPending();
    return apiJson({ queue, pendingCount });
  }

  if (pathname === "/api/platform/sync-queue/purge" && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin"]);
    const purged = syncRepository.purgeDelivered(7);
    return apiJson({ success: true, purgedCount: purged });
  }

  // 14.1 Queue Supervisory Actions to Edge Installation
  if ((pathname === "/api/platform/sync-queue" || pathname === "/api/platform/local-exam-pool/action") && method === "POST") {
    requirePlatformRole(auth.role, ["owner", "admin", "ops_engineer"]);
    const body = await readJson(req);
    const rawAction = String(body?.action || body?.payload_type || "RUN_DIAGNOSTICS");
    const normalizedAction = rawAction.toLowerCase();
    const payload = body?.payload || { action: rawAction };

    // 1. Resolve target installation
    let installation = null;
    if (body?.installation_id) {
      installation = installationRepository.findByInstallationId(body.installation_id);
    }
    if (!installation && body?.school_id) {
      const schoolInsts = installationRepository.listAll({ schoolId: Number(body.school_id) });
      installation = schoolInsts[0] || null;
    }
    if (!installation) {
      const allInsts = installationRepository.listAll();
      installation = allInsts[0] || null;
    }

    if (!installation) {
      return apiError(404, "No active edge installations available to execute command");
    }

    // 2. Map action string to supported payload types
    let payloadType: "diagnostics" | "wal_checkpoint" | "reboot_request" | "force_update" | "config" | "feature_flags" | "license" = "diagnostics";
    if (normalizedAction.includes("wal") || normalizedAction.includes("checkpoint")) {
      payloadType = "wal_checkpoint";
    } else if (normalizedAction.includes("reboot")) {
      payloadType = "reboot_request";
    } else if (normalizedAction.includes("update") || normalizedAction.includes("upgrade")) {
      payloadType = "force_update";
    } else if (normalizedAction.includes("flag")) {
      payloadType = "feature_flags";
    } else if (normalizedAction.includes("lic")) {
      payloadType = "license";
    } else if (normalizedAction.includes("diag") || normalizedAction.includes("pulse") || normalizedAction.includes("flush") || normalizedAction.includes("integrity")) {
      payloadType = "diagnostics";
    } else {
      payloadType = "config";
    }

    // 3. Queue command in sync_queue for edge node pickup
    syncRepository.queuePush({
      installation_id: installation.installation_id,
      school_id: installation.school_id,
      payload_type: payloadType,
      payload,
      queued_by: auth.platformUserId,
    });

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "QUEUE_EDGE_COMMAND",
      target_type: "installation",
      target_id: installation.installation_id,
      details: { command: rawAction, payloadType, school_id: installation.school_id },
    });

    return apiJson({
      success: true,
      status: "QUEUED",
      action: rawAction,
      payloadType,
      installationId: installation.installation_id,
      nodeId: installation.node_id,
      message: `Action '${rawAction}' queued for edge node ${installation.node_id} (${installation.installation_id}). Edge node will execute on next heartbeat pulse.`,
    });
  }

  // 15. Staff Users Management
  if (pathname === "/api/platform/users" && method === "GET") {
    return apiJson(userRepository.listAll());
  }

  if (pathname === "/api/platform/users" && method === "POST") {
    requirePlatformRole(auth.role, ["owner"]);
    const body = await readJson(req);
    if (!body?.name || !body?.email || !body?.password || !body?.role) {
      return apiError(400, "name, email, password, and role are required");
    }

    const passwordHash = await hashPassword(body.password);
    const newUser = userRepository.create(body.name, body.email, passwordHash, body.role);

    auditRepository.record({
      actor_id: auth.platformUserId,
      actor_email: auth.email,
      action: "CREATE_PLATFORM_USER",
      target_type: "platform_user",
      target_id: String(newUser.id),
      details: { email: newUser.email, role: newUser.role },
    });

    return apiJson(newUser, 201);
  }

  // 16. Real-time Supervisory SSE Stream (/api/platform/stream)
  if (pathname === "/api/platform/stream" && method === "GET") {
    let closed = false;
    const bodyStream = new ReadableStream({
      start(controller) {
        const sendUpdate = () => {
          if (closed) return;
          try {
            const metrics = healthRepository.getOverviewMetrics();
            const liveEvents = telemetryRepository.getLiveEventStream(10);
            const activeAlerts = alertRepository.listAll({ status: "open" }).slice(0, 5);

            const data = JSON.stringify({
              metrics,
              liveEvents,
              activeAlerts,
              timestamp: new Date().toISOString(),
            });

            controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          } catch {}
        };

        // Initial snapshot
        sendUpdate();

        // 3-second heartbeat pulse
        const timer = setInterval(sendUpdate, 3000);

        req.signal.addEventListener("abort", () => {
          closed = true;
          clearInterval(timer);
          try { controller.close(); } catch {}
        });
      },
    });

    return new Response(bodyStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...corsHeaders,
      },
    });
  }

  return apiError(404, "Endpoint not found");
}

// ════════════════════════════════════════════════════════════════════════════
// ── STANDALONE SERVER ENTRY POINT (RENDER / CLUSTER RUNTIME) ─────────────────
// ════════════════════════════════════════════════════════════════════════════

const PORT = Number(Bun.env.PORT || 8002);
const HOST = Bun.env.HOST || "0.0.0.0";

if (import.meta.main) {
  // Initialize database schema and seeds
  seedControlPlane().catch((err) => console.error("Control plane seed error:", err));

  const server = serve({
    port: PORT,
    hostname: HOST,
    idleTimeout: 255,
    async fetch(req) {
      const origin = req.headers.get("origin");
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
      }
      const url = new URL(req.url);
      try {
        let res = await handleControlPlaneApi(req, url);
        if (!res) res = apiError(404, "Not found");
        return applyCors(res, req);
      } catch (error: any) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            message: "Control Plane API error",
            error: error instanceof Error ? error.stack : String(error),
            path: url.pathname,
          })
        );
        return applyCors(apiError(500, "Internal supervisory server error"), req);
      }
    },
  });

  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║     ACAD SUPERVISORY CONTROL PLANE API        ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log(`🌐 Server active on http://${HOST}:${PORT}`);
  console.log(`📡 Health endpoint: http://${HOST}:${PORT}/health`);
  console.log(`🔒 Control JWT Secret: ${Bun.env.CONTROL_JWT_SECRET ? "✅ Configured" : "⚠️ Default dev secret"}`);
  console.log(`🔗 Allowed CORS Origin: ${CORS_ORIGIN}`);
}

