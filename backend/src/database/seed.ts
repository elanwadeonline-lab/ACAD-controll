import { initializeControlPlaneSchema } from "./schema";
import { userRepository } from "./repositories/userRepository";
import { releaseRepository } from "./repositories/releaseRepository";
import { organizationRepository } from "./repositories/organizationRepository";
import { schoolRepository } from "./repositories/schoolRepository";
import { installationRepository } from "./repositories/installationRepository";
import { licenseRepository } from "./repositories/licenseRepository";
import { hashPassword } from "../auth/auth";

export async function seedControlPlane(): Promise<void> {
  initializeControlPlaneSchema();

  // 1. Seed or Synchronize Platform Operators
  const defaultEmail = (
    Bun.env.CONTROL_ADMIN_EMAIL ||
    Bun.env.ADMIN_EMAIL ||
    Bun.env.CONTROL_EMAIL ||
    "owner@acad.ng"
  ).toLowerCase().trim();
  const defaultPassword =
    Bun.env.CONTROL_ADMIN_PASSWORD ||
    Bun.env.CONTROL_PASSWORD ||
    Bun.env.ADMIN_PASSWORD ||
    "AdminPassword123!";
  const passwordHash = await hashPassword(defaultPassword);

  const existingConfigured = userRepository.findByEmail(defaultEmail);
  if (!existingConfigured) {
    userRepository.create("ACAD Platform Owner", defaultEmail, passwordHash, "owner");
    console.log(`[Seed] Created admin owner: ${defaultEmail}`);
  } else {
    userRepository.updatePassword(existingConfigured.id, passwordHash);
    console.log(`[Seed] Synchronized admin password for: ${defaultEmail}`);
  }

  // Also ensure owner@acad.ng always exists with active password
  if (defaultEmail !== "owner@acad.ng") {
    const existingOwner = userRepository.findByEmail("owner@acad.ng");
    if (!existingOwner) {
      userRepository.create("ACAD Default Owner", "owner@acad.ng", passwordHash, "owner");
    } else {
      userRepository.updatePassword(existingOwner.id, passwordHash);
    }
  }

  // Ensure other operator roles have synced password as well
  const opsUser = userRepository.findByEmail("ops@acad.ng");
  if (!opsUser) {
    userRepository.create("Chief Systems Engineer", "ops@acad.ng", passwordHash, "ops_engineer");
  } else {
    userRepository.updatePassword(opsUser.id, passwordHash);
  }

  const supportUser = userRepository.findByEmail("support@acad.ng");
  if (!supportUser) {
    userRepository.create("Customer Success Lead", "support@acad.ng", passwordHash, "support_agent");
  } else {
    userRepository.updatePassword(supportUser.id, passwordHash);
  }

  // 2. Ensure Initial Software Release Record exists
  const releases = releaseRepository.listAll();
  if (releases.length === 0) {
    releaseRepository.create({
      version: "5.3.0",
      release_channel: "stable",
      min_agent_version: "1.0.0",
      release_notes: "Production GA release featuring real-time supervisory telemetry, dynamic modular gating, and automated sync.",
      is_critical_security: false,
    });
  }

  // 3. Auto-seed default organization
  let org = organizationRepository.listAll()[0];
  if (!org) {
    org = organizationRepository.create({
      name: "ACAD Educational Network",
      slug: "acad-network",
      country: "Nigeria",
      city: "Lagos",
      contact_name: "Operations Team",
      contact_email: "ops@acad.ng",
      contact_phone: "+2348000000000",
    });
  }

  // 4. Default Demonstration School
  let school = schoolRepository.listAll()[0];
  if (!school) {
    school = schoolRepository.create({
      org_id: org.id,
      school_code: "ACAD-LAGOS-01",
      name: "ACAD Model International Academy",
      location: "Main Campus, Victoria Island, Lagos",
      status: "active",
      primary_admin_name: "Principal Administrator",
      primary_admin_email: "admin@acad.local",
      primary_admin_phone: "+2348000000001",
    });
  }

  // 5. Default Demonstration Node Installation
  let installation = installationRepository.findByInstallationId("INST-DEMO-01");
  if (!installation) {
    installation = installationRepository.create({
      school_id: school.id,
      installation_id: "INST-DEMO-01",
      node_id: "NODE-PRIMARY-01",
      secret_key_hash: "node_sec_demo_secret_key_acad_01",
      software_version: "5.3.0",
      agent_version: "1.0.0",
      release_channel: "stable",
    });
  }

  // 6. Ensure active license exists
  const existingLicense = licenseRepository.findBySchoolId(school.id);
  if (!existingLicense) {
    licenseRepository.create({
      school_id: school.id,
      license_key: `ACAD-ENT-${Date.now().toString(36).toUpperCase()}`,
      plan_tier: "enterprise",
      max_students: 2500,
      max_teachers: 150,
      max_installations: 5,
      enabled_modules: [
        "cbt_exam",
        "question_bank",
        "grading_center",
        "report_cards",
        "timetables",
        "guardian_portal",
        "attendance_tracker",
        "fee_management",
        "offline_assignments",
        "ai_learning_engine",
      ],
      valid_until: new Date(Date.now() + 365 * 86400000).toISOString(),
    });
  }

  // 7. Periodic stale-node sweeper (every 5 minutes) — marks heartbeat-timeout nodes as offline with real alerts
  if (Bun.env.NODE_ENV !== "test") {
    setInterval(() => {
      try {
        const count = installationRepository.sweepStaleToOffline();
        if (count > 0) console.log(`[Control Plane] Periodic sweep marked ${count} stale node(s) offline`);
      } catch (err) {
        console.error("[Control Plane] Stale sweep error:", err);
      }
    }, 5 * 60 * 1000);
    try { installationRepository.sweepStaleToOffline(); } catch {}
  }
}
