"use strict";
// Credentials exist only in the launching process environment and isolated page.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url"),
  { createHash } = require("node:crypto");
const { chromium } = require("./helpers/playwright.cjs");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  file = path.join(root, "MotionBench.html");
const out = path.join(root, "output/ai");
fs.mkdirSync(out, { recursive: true });
const replay = process.env.RINGSIDE_AI_REPLAY
  ? JSON.parse(
      fs.readFileSync(
        path.resolve(root, process.env.RINGSIDE_AI_REPLAY),
        "utf8",
      ),
    )
  : null;
const results = {
  sourceHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  service: "https://api.apikey.fan",
  model: process.env.RINGSIDE_AI_MODEL || "gpt-5.6-sol",
  cases: [],
  transport: replay
    ? "recorded-response-replay"
    : process.env.RINGSIDE_AI_TRANSPORT || "browser-direct",
};
const resultFile = path.join(
  out,
  replay ? "recorded-response-replay.json" : "live-verification.json",
);
if (replay) results.responseSourceHash = replay.sourceHash;
if (replay) results.replayIgnoresGeneratedRowIds = true;
const comparableRequest = (body) =>
  JSON.stringify(body).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "[generated-row-id]",
  );
const key = replay
  ? "recorded-response-no-credential"
  : process.env.RINGSIDE_AI_KEY;
if (!key) throw Error("Set RINGSIDE_AI_KEY for live verification");
const redact = (value) => String(value).replaceAll(key, "[redacted]");
function vendorRequest(body) {
  // urllib errors never include request headers; credentials remain in memory.
  return new Promise((resolve) => {
    const child = spawn(
      "python",
      [
        "-c",
        `
import json, os, sys, urllib.request, urllib.error
body = sys.stdin.buffer.read()
request = urllib.request.Request("https://api.apikey.fan/v1/chat/completions", data=body,
    headers={"Authorization": "Bearer " + os.environ["RINGSIDE_AI_KEY"], "Content-Type": "application/json"})
try:
    with urllib.request.urlopen(request, timeout=55) as response:
        result = {"status": response.status, "body": response.read().decode("utf-8")}
except urllib.error.HTTPError as error:
    result = {"status": error.code, "body": error.read().decode("utf-8", errors="replace")}
except Exception as error:
    result = {"status": 504, "body": json.dumps({"error": type(error).__name__})}
sys.stdout.buffer.write(json.dumps(result, ensure_ascii=True).encode("utf-8"))
`,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", () => {});
    child.on("error", () =>
      resolve({ status: 502, body: '{"error":"test transport unavailable"}' }),
    );
    child.on("close", () => {
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve({ status: 502, body: '{"error":"test transport failed"}' });
      }
    });
    child.stdin.end(JSON.stringify(body));
  });
}
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const id of ["sample", "power-context", "pain-partial"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        locale: "zh-CN",
      });
      const page = await context.newPage();
      const pendingRequests = new Set();
      if (replay) {
        const recorded = replay.cases.find((item) => item.id === id);
        assert.ok(recorded?.response?.choices?.[0]?.message?.content);
        await page.route(
          results.service + "/v1/chat/completions",
          async (route) => {
            if (
              comparableRequest(route.request().postDataJSON()) !==
              comparableRequest(recorded.requestBody)
            ) {
              return route.fulfill({
                status: 409,
                contentType: "application/json",
                body: '{"error":"Replay request differs from captured input"}',
              });
            }
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify(recorded.response),
            });
          },
        );
      }
      if (results.transport === "http-test-bridge") {
        // Genuine vendor request through the test runner; explicitly NOT proof
        // that an ordinary file:// page can bypass the provider's CORS policy.
        await page.route(
          results.service + "/v1/chat/completions",
          async (route) => {
            if (route.request().method() === "OPTIONS")
              return route.fulfill({
                status: 204,
                headers: {
                  "access-control-allow-origin": "*",
                  "access-control-allow-headers": "authorization,content-type",
                  "access-control-allow-methods": "POST,OPTIONS",
                },
              });
            const job = vendorRequest(route.request().postDataJSON());
            pendingRequests.add(job);
            try {
              const response = await job;
              await route
                .fulfill({
                  status: response.status,
                  headers: {
                    "access-control-allow-origin": "*",
                    "content-type": "application/json",
                  },
                  body: redact(response.body),
                })
                .catch(() => {});
            } finally {
              pendingRequests.delete(job);
            }
          },
        );
      }
      const errors = [];
      const responses = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", async (response) => {
        if (response.url().endsWith("/chat/completions")) {
          responses.push({
            status: response.status(),
            json: await response.json().catch(() => null),
          });
        }
      });
      const item = { id, pass: false, errors, requestFailures: [] };
      page.on("request", (request) => {
        if (
          request.url().endsWith("/chat/completions") &&
          request.method() === "POST"
        )
          item.requestBody = request.postDataJSON();
      });
      item.consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") item.consoleErrors.push(message.text());
      });
      const started = Date.now();
      page.on("requestfailed", (r) =>
        item.requestFailures.push({
          url: r.url(),
          error: r.failure()?.errorText,
        }),
      );
      try {
        await page.goto(pathToFileURL(file).href);
        await page.waitForFunction(() => window.App);
        await page.evaluate((id) => {
          const r = App.getState();
          r.athlete.name = "AI合成验收";
          r.narrative = { html: "", text: "", revision: 0 };
          if (id !== "sample") {
            r.athlete.sport = "篮球";
            r.trainingContext = {
              experienceYears: 2,
              weeklySessions: 1,
              equipment: "仅自重，没有杠铃或药球",
              weeklySchedule: "周二与周四球场训练，周六一次体能训练",
            };
            for (const key of Object.keys(r.enabled))
              r.enabled[key] = ["cmj", "sj", "imtp", "fms"].includes(key);
            r.data.fms.forEach((x) => {
              x.score = "";
              x.left = "";
              x.right = "";
              x.pain = false;
            });
            r.data.cmj = [{ id: "one", height: 20, force: 1000 }];
            r.data.sj = [{ id: "sj", height: 18 }];
            r.data.imtp = [
              {
                id: "partial",
                peakForce: 2000,
                timePoints: [{ id: "time", timeMs: 150, force: "", rfd: 4321 }],
              },
            ];
            if (id === "pain-partial") {
              r.data.fms[0].pain = true;
              r.data.fms[0].location = "knee_l";
            }
          }
          App.renderReport();
        }, id);
        item.plan = await page.evaluate(() =>
          RingsideInterventions.build(App.getState()),
        );
        await page.locator('[data-settings-open="app"]').click();
        await page.locator('#settingsTabs [data-settings-tab="ai"]').click();
        await page.locator("#apiURL").fill(results.service);
        await page.locator("#apiKey").fill(key);
        await page.locator("#apiModel").fill(results.model);
        await page.locator("#workspaceBack").click();
        await page.locator("#editButton").click();
        await page.locator('#entryNav button[onclick*="narrative"]').click();
        await page.locator('[data-ai-generate]').click();
        await page.waitForFunction(
          () =>
            document
              .querySelector("#previewModal")
              .classList.contains("show") ||
            (document.querySelector("#toast")?.textContent &&
              /失败|返回|方案|超时|解读|剂量|fetch|密钥|未收到/.test(
                document.querySelector("#toast").textContent,
              )),
          null,
          { timeout: 75000 },
        );
        item.responses = responses;
        assert.equal(
          await page.locator("#previewModal").isVisible(),
          true,
          await page.locator("#toast").textContent(),
        );
        item.text = await page.locator("#aiPreview").innerText();
        assert.ok(item.text.length > 50);
        assert.ok(
          responses.some(
            (x) => x.status === 200 && x.json?.choices?.[0]?.message?.content,
          ),
        );
        await page.locator("#applyDraftButton").click();
        item.applied = await page.evaluate(() => ({
          origin: App.getState().narrative.origin,
          text: App.getState().narrative.text,
          html: App.getState().narrative.html,
          plainText: RingsideModel.htmlToText(App.getState().narrative.html),
        }));
        assert.equal(item.applied.origin, "AI");
        await page.reload();
        await page.waitForFunction(() => window.App);
        assert.equal(
          await page.evaluate(() => App.getState().narrative.text),
          item.applied.plainText,
        );
        assert.equal(
          await page.evaluate(() => App.getState().narrative.html),
          item.applied.html,
        );
        assert.deepEqual(errors, []);
        item.pass = true;
        console.log("PASS " + results.transport + " " + id);
      } catch (e) {
        item.error = redact(e.message);
        item.responses = responses;
        item.toast = await page.locator("#toast").textContent();
        console.log(
          "FAIL " + results.transport + " " + id + ": " + redact(e.message),
        );
      } finally {
        item.elapsedMs = Date.now() - started;
        results.cases.push(item);
        await Promise.allSettled([...pendingRequests]);
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.close();
        fs.writeFileSync(resultFile, redact(JSON.stringify(results, null, 2)));
      }
      if (!item.pass && !responses.length) break;
    }
  } finally {
    await browser.close();
    results.pass =
      results.cases.length === 3 && results.cases.every((x) => x.pass);
    fs.writeFileSync(resultFile, redact(JSON.stringify(results, null, 2)));
    if (!results.pass) process.exitCode = 1;
  }
})().catch((e) => {
  console.error(redact(e.message));
  process.exitCode = 1;
});
