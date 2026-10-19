import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const serverScript = fileURLToPath(new URL("./index.js", import.meta.url));
let api;
let apiProcess;
let dataDirectory;
let port;

async function availablePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port: available } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return available;
}

async function request(route, { method = "GET", body, token } = {}) {
  const response = await fetch(`${api}${route}`, {
    method,
    signal: AbortSignal.timeout(5000),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { response, payload };
}

before(async () => {
  port = await availablePort();
  api = `http://127.0.0.1:${port}/api`;
  dataDirectory = await mkdtemp(path.join(tmpdir(), "saferoute-api-test-"));
  apiProcess = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      API_PORT: String(port),
      DATA_DIR: dataDirectory,
      ADMIN_EMAIL: "officer@example.test",
      ADMIN_PASSWORD: "Officer-test-123",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let startupError = "";
  apiProcess.stderr.on("data", (chunk) => { startupError += chunk; });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (apiProcess.exitCode !== null) throw new Error(`API exited during startup: ${startupError}`);
    try {
      const response = await fetch(`${api}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`API did not become ready: ${startupError}`);
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    const exited = once(apiProcess, "exit");
    apiProcess.kill();
    await exited;
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

test("registers accounts, persists profiles and verifies only uploaded documents", async () => {
  const password = "Driver-test-123";
  const email = `driver-${Date.now()}@example.test`;
  let result = await request("/register", {
    method: "POST",
    body: {
      name: "Test Driver",
      email,
      password,
      phone: "5550100",
      idNumber: "12345",
      role: "driver",
    },
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.application.status, "Incomplete");
  assert(result.payload.application.documents.every((document) => document.status === "Missing"));
  assert.equal("token" in result.payload, false);
  assert.equal((await request("/me")).response.status, 401);

  result = await request("/login", { method: "POST", body: { email, password: "wrong-pass", role: "driver" } });
  assert.equal(result.response.status, 401);
  result = await request("/login", { method: "POST", body: { email, password, role: "driver" } });
  assert.equal(result.response.status, 200);
  const driverToken = result.payload.token;
  const application = result.payload.application;

  result = await request("/profile", {
    method: "PUT",
    token: driverToken,
    body: { ...result.payload.user.profile, name: "Updated Driver", phone: "5550199" },
  });
  assert.equal(result.payload.user.profile.name, "Updated Driver");
  assert.equal(result.payload.application.phone, "5550199");

  const fileContent = Buffer.from("%PDF-1.4\nSafeRoute test document\n");
  const encodedFile = fileContent.toString("base64");
  result = await request(`/applications/${application.id}/documents`, {
    method: "POST",
    token: driverToken,
    body: {
      documentName: application.documents[0].name,
      fileName: "licence.pdf",
      contentType: "application/pdf",
      content: encodedFile,
    },
  });
  assert.equal(result.payload.application.status, "Under review");
  assert.equal(result.payload.application.documents[0].status, "Under review");
  const updatedApplication = result.payload.application;

  const officerLogin = await request("/login", {
    method: "POST",
    body: { email: "officer@example.test", password: "Officer-test-123", role: "admin" },
  });
  assert.equal(officerLogin.response.status, 200);
  const officerToken = officerLogin.payload.token;
  result = await request(`/admin/applications/${application.id}`, {
    method: "PATCH",
    token: officerToken,
    body: { documentName: application.documents[1].name, documentStatus: "Verified" },
  });
  assert.equal(result.response.status, 409);

  for (const document of updatedApplication.documents.slice(1)) {
    result = await request(`/applications/${application.id}/documents`, {
      method: "POST",
      token: driverToken,
      body: {
        documentName: document.name,
        fileName: `${document.name.replace(/[^a-z]/gi, "-")}.pdf`,
        contentType: "application/pdf",
        content: encodedFile,
      },
    });
    assert.equal(result.response.status, 200);
  }

  let currentApplication = result.payload.application;
  for (const document of currentApplication.documents) {
    result = await request(`/admin/applications/${application.id}`, {
      method: "PATCH",
      token: officerToken,
      body: { documentName: document.name, documentStatus: "Verified" },
    });
    assert.equal(result.response.status, 200);
    currentApplication = result.payload.application;
  }
  assert(currentApplication.documents.every((document) => document.status === "Verified" && document.fileId));

  result = await request(`/admin/applications/${application.id}`, {
    method: "PATCH",
    token: officerToken,
    body: { status: "Approved" },
  });
  assert.equal(result.payload.application.status, "Approved");

  result = await request(`/documents/${currentApplication.documents[0].fileId}`, { token: officerToken });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, fileContent);

  const schoolEmail = `school-${Date.now()}@example.test`;
  result = await request("/register", {
    method: "POST",
    body: { name: "Test School", email: schoolEmail, password, role: "school", phone: "5550200" },
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.application, null);
  const school = await request("/login", { method: "POST", body: { email: schoolEmail, password, role: "school" } });
  assert.equal(school.response.status, 200);
  result = await request("/school/drivers", { token: school.payload.token });
  const approvedDriver = result.payload.applications.find((entry) => entry.id === application.id);
  assert(approvedDriver);
  assert.equal("fileId" in approvedDriver.documents[0], false);
  result = await request("/profile", {
    method: "PUT",
    token: school.payload.token,
    body: { ...school.payload.user.profile, name: "Updated School Contact" },
  });
  assert.equal(result.payload.user.profile.name, "Updated School Contact");
});
