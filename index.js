#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execSync, spawn } from "child_process";
import fs from "fs";
import { globSync } from "glob";
import http from "http";
import path from "path";
import { z } from "zod";

const server = new McpServer({
  name: "Just-Check-It",
  version: "4.0.0",
});

// --- STATE MANAGEMENT ---
const activeProcesses = new Map();
const backupFiles = new Map();

// --- HELPERS ---
async function waitForUrl(url, maxTimeout = 30000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 500) resolve(true);
          else retry();
        })
        .on("error", retry);
    };
    const retry = () => {
      if (Date.now() - startTime > maxTimeout)
        reject(
          new Error(
            `Timeout: ${url} did not respond within ${maxTimeout / 1000} seconds.`,
          ),
        );
      else setTimeout(check, 1000);
    };
    check();
  });
}

function killProcess(pid) {
  try {
    process.kill(-pid);
  } catch (e) {
    try {
      process.kill(pid);
    } catch (err) {
      /* Ignore */
    }
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png"; // Default fallback
}

// ============================================================================
// TOOL 1: DEEP DISCOVERY (Codebase, Routes, Selectors, Credentials)
// ============================================================================
server.tool(
  "discover_project_context",
  "Deeply analyzes the project to automatically find routes, Playwright selectors, and extract hardcoded seed/env credentials.",
  { targetPath: z.string().describe("Absolute path to the project directory") },
  async ({ targetPath }) => {
    try {
      if (!fs.existsSync(targetPath)) throw new Error("Directory not found!");

      const pkgPath = path.join(targetPath, "package.json");
      if (!fs.existsSync(pkgPath)) throw new Error("package.json not found.");

      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      let logs = ["=== DEEP CODEBASE DISCOVERY REPORT ==="];

      // 1. Playwright Setup
      const hasPlaywright =
        pkg.dependencies?.playwright ||
        pkg.devDependencies?.playwright ||
        pkg.devDependencies?.["@playwright/test"];
      if (!hasPlaywright) {
        logs.push("[SETUP] Playwright missing. Installing silently...");
        execSync("npm install -D playwright @playwright/test", {
          cwd: targetPath,
          stdio: "ignore",
        });
        execSync("npx playwright install chromium", {
          cwd: targetPath,
          stdio: "ignore",
        });
        logs.push("[SETUP] Playwright installation complete.");
      } else {
        logs.push("[SETUP] Playwright already exists.");
      }

      // 2. Port & Command Discovery
      let port = "3000";
      const startCmd = pkg.scripts?.dev
        ? "npm run dev"
        : pkg.scripts?.start
          ? "npm run start"
          : "node index.js";

      const envFiles = globSync(".env*", { cwd: targetPath });
      let envContent = "";
      for (const envFile of envFiles) {
        envContent +=
          fs.readFileSync(path.join(targetPath, envFile), "utf8") + "\n";
      }

      const portMatch = envContent.match(/PORT\s*=\s*(\d+)/i);
      if (portMatch) port = portMatch[1];
      logs.push(
        `[SERVER] Suggested Command: ${startCmd} | URL: http://localhost:${port}`,
      );

      // 3. Credential Discovery (Seeds, Fixtures, Env)
      logs.push("\n[CREDENTIALS] Hunting for test accounts/seeds...");
      let foundCredentials = [];

      // Look in typical seed files or env
      const seedFiles = globSync("**/{seed,seeder,fixtures}*.{js,ts,json}", {
        cwd: targetPath,
        ignore: "node_modules/**",
      });
      const filesToGrep = [
        ...envFiles.map((f) => path.join(targetPath, f)),
        ...seedFiles.map((f) => path.join(targetPath, f)),
      ];

      for (const file of filesToGrep) {
        if (fs.existsSync(file)) {
          const content = fs.readFileSync(file, "utf8");
          const emailMatches = content.match(
            /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
          );
          const passMatches = content.match(
            /(?:password|pass|secret)['"\s]*[:=]['"\s]*([^'"\n]+)/gi,
          );

          if (emailMatches || passMatches) {
            foundCredentials.push(`File: ${path.basename(file)}`);
            if (emailMatches)
              foundCredentials.push(
                `  Emails found: ${[...new Set(emailMatches)].slice(0, 3).join(", ")}`,
              );
            if (passMatches)
              foundCredentials.push(
                `  Potential passwords/secrets found: ${passMatches.slice(0, 3).join(" | ")}`,
              );
          }
        }
      }

      if (foundCredentials.length > 0) {
        logs.push(...foundCredentials);
      } else {
        logs.push(
          "  No explicit credentials found. If login is required, please ask the user for them.",
        );
      }

      // 4. Route & Selector Discovery (Planning Playwright)
      logs.push("\n[UI/ROUTES] Hunting for routes and DOM selectors...");
      const sourceFiles = globSync("**/*.{jsx,tsx,vue,html}", {
        cwd: targetPath,
        ignore: "node_modules/**",
      });

      let testIds = new Set();
      let inputNames = new Set();

      sourceFiles.slice(0, 50).forEach((file) => {
        // Limit to 50 files to avoid massive overhead
        const content = fs.readFileSync(path.join(targetPath, file), "utf8");

        // Find data-testid="..."
        const testIdMatches = content.match(/data-testid=['"]([^'"]+)['"]/g);
        if (testIdMatches)
          testIdMatches.forEach((m) =>
            testIds.add(m.replace(/data-testid=|['"]/g, "")),
          );

        // Find name="..." (useful for inputs)
        const nameMatches = content.match(/name=['"]([^'"]+)['"]/g);
        if (nameMatches)
          nameMatches.forEach((m) =>
            inputNames.add(m.replace(/name=|['"]/g, "")),
          );
      });

      logs.push(
        `  Discovered Test IDs: ${[...testIds].slice(0, 20).join(", ") || "None"}`,
      );
      logs.push(
        `  Discovered Input Names: ${[...inputNames].slice(0, 20).join(", ") || "None"}`,
      );
      logs.push(
        `  Discovered Pages: ${sourceFiles
          .slice(0, 10)
          .map((f) => path.basename(f))
          .join(", ")}`,
      );

      return { content: [{ type: "text", text: logs.join("\n") }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Discovery Error: ${e.message}` }],
      };
    }
  },
);

// ============================================================================
// TOOL 2: START PROJECT
// ============================================================================
server.tool(
  "start_project",
  "Starts the local server and waits for it to respond successfully.",
  {
    targetPath: z.string().describe("Project directory path"),
    command: z.string().describe("Start command (e.g., npm run dev)"),
    expectedUrl: z
      .string()
      .describe("URL to poll (e.g., http://localhost:3000)"),
  },
  async ({ targetPath, command, expectedUrl }) => {
    try {
      if (activeProcesses.has(targetPath)) {
        killProcess(activeProcesses.get(targetPath).pid);
        activeProcesses.delete(targetPath);
      }

      const [cmd, ...args] = command.split(" ");
      const proc = spawn(cmd, args, {
        cwd: targetPath,
        shell: true,
        detached: true,
      });
      activeProcesses.set(targetPath, proc);

      await waitForUrl(expectedUrl, 30000);
      return {
        content: [
          {
            type: "text",
            text: `SUCCESS: Project started and is responding at ${expectedUrl}.`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          { type: "text", text: `ERROR starting project: ${e.message}` },
        ],
      };
    }
  },
);

// ============================================================================
// TOOL 3: DYNAMIC PLAYWRIGHT JOURNEY (For Login, E2E, Validation)
// ============================================================================
server.tool(
  "execute_playwright_journey",
  "Executes a complex series of browser actions (navigate, fill forms, click, wait) and returns a final screenshot and logs. Essential for handling logins and multi-step UI verification.",
  {
    targetPath: z.string().describe("Project directory"),
    actions: z
      .array(
        z.object({
          type: z.enum([
            "goto",
            "fill",
            "click",
            "wait_for_selector",
            "wait_for_timeout",
          ]),
          url: z.string().optional().describe("Used for 'goto'"),
          selector: z
            .string()
            .optional()
            .describe("Used for 'fill', 'click', 'wait_for_selector'"),
          value: z.string().optional().describe("Used for 'fill'"),
          timeout: z
            .number()
            .optional()
            .describe("Used for 'wait_for_timeout' (in milliseconds)"),
        }),
      )
      .describe("Array of sequential browser actions to execute"),
  },
  async ({ targetPath, actions }) => {
    let playwright;
    try {
      playwright = await import(
        path.join(targetPath, "node_modules", "playwright", "index.js")
      );
    } catch (e) {
      playwright = await import("playwright");
    }

    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    let consoleLogs = [],
      networkErrors = [],
      jsErrors = [];
    page.on("console", (msg) =>
      consoleLogs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`),
    );
    page.on("pageerror", (err) => jsErrors.push(err.message));
    page.on("response", (response) => {
      if (!response.ok())
        networkErrors.push(`[${response.status()}] ${response.url()}`);
    });

    let actionTrace = [];
    try {
      for (const action of actions) {
        actionTrace.push(`Executing: ${action.type}`);
        if (action.type === "goto")
          await page.goto(action.url, { waitUntil: "networkidle" });
        else if (action.type === "fill")
          await page.fill(action.selector, action.value);
        else if (action.type === "click") await page.click(action.selector);
        else if (action.type === "wait_for_selector")
          await page.waitForSelector(action.selector);
        else if (action.type === "wait_for_timeout")
          await page.waitForTimeout(action.timeout);
      }

      // Always capture the final state
      await page.waitForTimeout(1000); // Allow render settlement
      const finalScreenshot = await page.screenshot({ fullPage: true });
      await browser.close();

      const report = `=== JOURNEY COMPLETED ===\nActions Executed: ${actionTrace.length}\nJS Errors: ${jsErrors.join(" | ")}\nNetwork Errors: ${networkErrors.join(" | ")}\nConsole: ${consoleLogs.join("\n")}`;

      return {
        content: [
          { type: "text", text: report },
          {
            type: "image",
            data: finalScreenshot.toString("base64"),
            mimeType: "image/png",
          },
        ],
      };
    } catch (error) {
      const errorScreenshot = await page
        .screenshot({ fullPage: true })
        .catch(() => null);
      await browser.close();
      const report = `JOURNEY FAILED at step [${actionTrace[actionTrace.length - 1]}]: ${error.message}\nJS Errors: ${jsErrors.join(" | ")}\nNetwork: ${networkErrors.join(" | ")}`;

      const res = [{ type: "text", text: report }];
      if (errorScreenshot)
        res.push({
          type: "image",
          data: errorScreenshot.toString("base64"),
          mimeType: "image/png",
        });
      return { content: res };
    }
  },
);

// ============================================================================
// TOOL 4: UI/UX DESIGN COMPARISON
// ============================================================================
server.tool(
  "verify_ui_against_design",
  "Captures a screenshot of the live application and loads a local design mockup image. Returns BOTH to the AI for visual pixel-perfect comparison.",
  {
    targetPath: z.string().describe("Project directory"),
    url: z.string().describe("URL of the live page to check"),
    designImagePath: z
      .string()
      .describe(
        "Absolute path to the user's design/mockup image file (.png, .jpg)",
      ),
  },
  async ({ targetPath, url, designImagePath }) => {
    if (!fs.existsSync(designImagePath)) {
      return {
        content: [
          {
            type: "text",
            text: `ERROR: Design image not found at ${designImagePath}`,
          },
        ],
      };
    }

    let playwright;
    try {
      playwright = await import(
        path.join(targetPath, "node_modules", "playwright", "index.js")
      );
    } catch (e) {
      playwright = await import("playwright");
    }

    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      const liveScreenshotBuffer = await page.screenshot({ fullPage: true });
      await browser.close();

      const designImageBuffer = fs.readFileSync(designImagePath);
      const designMimeType = getMimeType(designImagePath);

      return {
        content: [
          {
            type: "text",
            text: `UI Comparison Request:\nImage 1: The Live Rendered Website\nImage 2: The Original Design Mockup\n\nPlease analyze both images and report discrepancies in layout, colors, typography, or missing elements.`,
          },
          {
            type: "image",
            data: liveScreenshotBuffer.toString("base64"),
            mimeType: "image/png",
          },
          {
            type: "image",
            data: designImageBuffer.toString("base64"),
            mimeType: designMimeType,
          },
        ],
      };
    } catch (error) {
      await browser.close();
      return {
        content: [
          { type: "text", text: `Failed to capture live UI: ${error.message}` },
        ],
      };
    }
  },
);

// ============================================================================
// TOOL 5: DEBUG INJECTION
// ============================================================================
server.tool(
  "inject_debug_logs",
  "Injects console.log statements into a target file to trace variables. Backs up the original file for cleanup.",
  {
    filePath: z.string().describe("Absolute path of the file to modify"),
    searchString: z.string().describe("The exact code snippet to find"),
    replacementString: z
      .string()
      .describe("The new code including console.log statements"),
  },
  async ({ filePath, searchString, replacementString }) => {
    try {
      if (!fs.existsSync(filePath)) throw new Error("File not found.");
      const content = fs.readFileSync(filePath, "utf8");

      if (!backupFiles.has(filePath)) backupFiles.set(filePath, content);
      if (!content.includes(searchString))
        throw new Error("Search string not found in the file.");

      const updatedContent = content.replace(searchString, replacementString);
      fs.writeFileSync(filePath, updatedContent, "utf8");

      return {
        content: [
          { type: "text", text: `SUCCESS: Injected logs into ${filePath}.` },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `INJECTION ERROR: ${e.message}` }],
      };
    }
  },
);

// ============================================================================
// TOOL 6: CLEANUP
// ============================================================================
server.tool(
  "cleanup_session",
  "Reverts all injected code modifications and aggressively kills all background server processes.",
  {},
  async () => {
    let logs = ["=== TEARDOWN SEQUENCE INITIATED ==="];

    for (const [filePath, originalContent] of backupFiles.entries()) {
      try {
        fs.writeFileSync(filePath, originalContent, "utf8");
        logs.push(`Reverted file: ${filePath}`);
      } catch (e) {
        logs.push(`Failed to revert ${filePath}: ${e.message}`);
      }
    }
    backupFiles.clear();

    for (const [targetPath, proc] of activeProcesses.entries()) {
      killProcess(proc.pid);
      logs.push(`Terminated processes for: ${targetPath}`);
    }
    activeProcesses.clear();

    logs.push("Session cleanly terminated. Zero footprint remaining.");
    return { content: [{ type: "text", text: logs.join("\n") }] };
  },
);

const transport = new StdioServerTransport();
server.connect(transport);
