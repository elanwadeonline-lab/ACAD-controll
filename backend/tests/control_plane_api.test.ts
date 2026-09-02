import { describe, test, expect, beforeAll } from "bun:test";
import { handleControlPlaneApi } from "../src/server";
import { seedControlPlane } from "../src/database/seed";
import { createHmac } from "node:crypto";

const baseUrl = "http://localhost:8002";

describe("ACAD-CONTROL Standalone Backend API Tests", () => {
  let platformToken: string = "";

  beforeAll(async () => {
    await seedControlPlane();

    // Login as owner to acquire platformToken
    const loginReq = new Request(`${baseUrl}/api/platform/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@acad.ng",
        password: "AdminPassword123!",
      }),
    });
    const loginRes = await handleControlPlaneApi(loginReq, new URL(loginReq.url));
    expect(loginRes?.status).toBe(200);
    const loginData = (await loginRes?.json()) as any;
    expect(loginData.success).toBe(true);
    platformToken = loginData.token;
  });

  test("1. GET /health returns 200 with service status", async () => {
    const req = new Request(`${baseUrl}/health`);
    const res = await handleControlPlaneApi(req, new URL(req.url));
    expect(res?.status).toBe(200);
    const data = (await res?.json()) as any;
    expect(data.status).toBe("ok");
    expect(data.service).toBe("acad-control-api");
  });

  test("2. GET /api/platform/overview returns live fleet metrics", async () => {
    const req = new Request(`${baseUrl}/api/platform/overview`, {
      headers: { Authorization: `Bearer ${platformToken}` },
    });
    const res = await handleControlPlaneApi(req, new URL(req.url));
    expect(res?.status).toBe(200);
    const data = (await res?.json()) as any;
    expect(data.metrics).toBeDefined();
    expect(typeof data.metrics.totalSchools).toBe("number");
  });

  test("3. GET /api/platform/schools lists registered campuses", async () => {
    const req = new Request(`${baseUrl}/api/platform/schools`, {
      headers: { Authorization: `Bearer ${platformToken}` },
    });
    const res = await handleControlPlaneApi(req, new URL(req.url));
    expect(res?.status).toBe(200);
    const data = (await res?.json()) as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  test("4. POST /api/node/heartbeat accepts signed edge node vitals", async () => {
    const installationId = "INST-DEMO-01";
    const secretKey = "node_sec_demo_secret_key_acad_01";
    const timestamp = Math.floor(Date.now() / 1000);

    const payload = {
      installationId,
      nodeId: "NODE-PRIMARY-01",
      softwareVersion: "5.3.0",
      agentVersion: "1.0.0",
      system: {
        cpuUsagePercent: 25.4,
        memoryUsagePercent: 42.1,
        storageUsagePercent: 33.0,
      },
      database: { status: "healthy" },
      operational: {
        connectedClients: 80,
        activeExamSessions: 2,
        totalStudents: 450,
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha256", secretKey)
      .update(`${installationId}:${timestamp}:${rawBody}`)
      .digest("hex");

    const req = new Request(`${baseUrl}/api/node/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ACAD-Installation-Id": installationId,
        "X-ACAD-Timestamp": String(timestamp),
        "X-ACAD-Signature": signature,
      },
      body: rawBody,
    });

    const res = await handleControlPlaneApi(req, new URL(req.url));
    expect(res?.status).toBe(200);
    const data = (await res?.json()) as any;
    expect(data.status).toBe("acknowledged");
    expect(data.health_status).toBe("healthy");
  });
});
