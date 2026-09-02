import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const appDir = join(import.meta.dir, "../app");

async function processDir(dir: string) {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      await processDir(fullPath);
    } else if (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) {
      let content = await readFile(fullPath, "utf-8");

      // Replace imports
      content = content.replace(/from\s+["'].*\/lib\/controlApi["']/g, 'from "@/lib/controlApi"');
      content = content.replace(/from\s+["'].*\/lib\/controlStream["']/g, 'from "@/lib/controlStream"');
      content = content.replace(/from\s+["'].*\/components\/control\/ControlIcons["']/g, 'from "@/components/ControlIcons"');
      content = content.replace(/from\s+["'].*control\.module\.css["']/g, 'from "@/app/control.module.css"');

      // Replace route paths
      content = content.replace(/\/control\/schools/g, "/schools");
      content = content.replace(/\/control\/installations/g, "/installations");
      content = content.replace(/\/control\/trials/g, "/trials");
      content = content.replace(/\/control\/monitoring/g, "/monitoring");
      content = content.replace(/\/control\/alerts/g, "/alerts");
      content = content.replace(/\/control\/incidents/g, "/incidents");
      content = content.replace(/\/control\/backups/g, "/backups");
      content = content.replace(/\/control\/sync-queue/g, "/sync-queue");
      content = content.replace(/\/control\/licenses/g, "/licenses");
      content = content.replace(/\/control\/releases/g, "/releases");
      content = content.replace(/\/control\/feature-flags/g, "/feature-flags");
      content = content.replace(/\/control\/audit-logs/g, "/audit-logs");
      content = content.replace(/\/control\/settings/g, "/settings");
      content = content.replace(/\/control\/login/g, "/login");

      // Replace standalone /control with /
      content = content.replace(/href=["']\/control["']/g, 'href="/"');
      content = content.replace(/router\.push\(["']\/control["']\)/g, 'router.push("/")');
      content = content.replace(/window\.location\.href\s*=\s*["']\/control["']/g, 'window.location.href = "/"');
      content = content.replace(/pathname === ["']\/control["']/g, 'pathname === "/"');
      content = content.replace(/item\.href === ["']\/control["']/g, 'item.href === "/"');
      content = content.replace(/item\.href !== ["']\/control["']/g, 'item.href !== "/"');

      await writeFile(fullPath, content, "utf-8");
      console.log(`Normalized: ${fullPath}`);
    }
  }
}

await processDir(appDir);
console.log("Path normalization completed.");
