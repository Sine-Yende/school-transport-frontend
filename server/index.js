import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(root, "..", "data"));
const databaseFile = path.join(dataDirectory, "database.json");
const uploadDirectory = path.join(dataDirectory, "uploads");
const port = Number(process.env.API_PORT || 3001);
const maxBodySize = 15 * 1024 * 1024;
const maxUploadSize = 10 * 1024 * 1024;
const documentTypes = [
  "Driver's Licence",
  "Professional Driving Permit (PrDP)",
  "Vehicle Registration",
  "Roadworthy Certificate",
  "Vehicle Insurance",
  "Police Clearance",
];

let database = { users: [], applications: [], sessions: [] };

function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function passwordMatches(password, salt, hash) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicUser(user) {
  return { id: user.id, role: user.role, profile: user.profile };
}

function applicationFor(userId) {
  return database.applications.find((application) => application.userId === userId);
}

async function saveDatabase() {
  const temporaryFile = `${databaseFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(database, null, 2), { mode: 0o600 });
  await rename(temporaryFile, databaseFile);
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodySize) {
      throw Object.assign(new Error("Request body is too large."), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(request) {
  const body = await readRequestBody(request);
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function respond(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function authenticate(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) throw fail(401, "Sign in to continue.");
  const tokenHash = Buffer.from(token).toString("base64url");
  const session = database.sessions.find((entry) => entry.tokenHash === tokenHash);
  const user = session && database.users.find((entry) => entry.id === session.userId);
  if (!user) throw fail(401, "Your session has expired. Please sign in again.");
  return { tokenHash, user };
}

function createApplication(user) {
  const documents = documentTypes.map((name) => ({ name, status: "Missing" }));
  return {
    id: `SRV-${randomBytes(3).toString("hex").toUpperCase()}`,
    userId: user.id,
    ...user.profile,
    status: "Incomplete",
    route: "",
    documents,
  };
}

async function createSession(user) {
  const token = randomBytes(32).toString("base64url");
  database.sessions.push({
    tokenHash: Buffer.from(token).toString("base64url"),
    userId: user.id,
  });
  await saveDatabase();
  return token;
}

function sessionResponse(user, token) {
  return { token, user: publicUser(user), application: applicationFor(user.id) || null };
}

async function initialize() {
  await mkdir(uploadDirectory, { recursive: true });
  try {
    database = JSON.parse(await readFile(databaseFile, "utf8"));
    if (!Array.isArray(database.users) || !Array.isArray(database.applications) || !Array.isArray(database.sessions)) {
      throw new Error("Database has an invalid structure.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveDatabase();
  }

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const existing = database.users.find((user) => user.email === email);
    const credentials = passwordHash(process.env.ADMIN_PASSWORD);
    if (existing) {
      existing.role = "admin";
      existing.salt = credentials.salt;
      existing.passwordHash = credentials.hash;
    } else {
      database.users.push({
        id: randomUUID(),
        role: "admin",
        email,
        salt: credentials.salt,
        passwordHash: credentials.hash,
        profile: { name: "Verification Officer", email, phone: "", idNumber: "", vehicle: "", plate: "" },
      });
    }
    await saveDatabase();
  }
}

async function handle(request, response) {
  const url = new URL(request.url, "http://localhost");
  const method = request.method;
  try {
    if (method === "GET" && url.pathname === "/api/health") {
      return respond(response, 200, { status: "ok" });
    }

    if (method === "POST" && url.pathname === "/api/register") {
      const input = await readJson(request);
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      const password = typeof input.password === "string" ? input.password : "";
      const role = input.role;
      if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw fail(400, "Enter a valid name and email address.");
      }
      if (!["driver", "school"].includes(role)) {
        throw fail(400, "Choose a supported account type.");
      }
      if (password.length < 8) throw fail(400, "Password must be at least 8 characters.");
      if (database.users.some((user) => user.email === email)) {
        throw fail(409, "An account with this email already exists.");
      }
      const credentials = passwordHash(password);
      const user = {
        id: randomUUID(),
        role,
        email,
        salt: credentials.salt,
        passwordHash: credentials.hash,
        profile: {
          name,
          email,
          phone: typeof input.phone === "string" ? input.phone.trim() : "",
          idNumber: typeof input.idNumber === "string" ? input.idNumber.trim() : "",
          vehicle: typeof input.vehicle === "string" ? input.vehicle.trim() : "",
          plate: typeof input.plate === "string" ? input.plate.trim() : "",
        },
      };
      database.users.push(user);
      if (role === "driver") database.applications.push(createApplication(user));
      await saveDatabase();
      return respond(response, 201, { user: publicUser(user), application: applicationFor(user.id) || null });
    }

    if (method === "POST" && url.pathname === "/api/login") {
      const input = await readJson(request);
      const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      const password = typeof input.password === "string" ? input.password : "";
      const user = database.users.find((entry) => entry.email === email);
      if (!user || !passwordMatches(password, user.salt, user.passwordHash)) {
        throw fail(401, "Email or password is incorrect.");
      }
      if (input.role && input.role !== user.role) throw fail(403, "This account has a different role.");
      const token = await createSession(user);
      return respond(response, 200, sessionResponse(user, token));
    }

    if (method === "GET" && url.pathname === "/api/me") {
      const { user } = authenticate(request);
      return respond(response, 200, sessionResponse(user, undefined));
    }

    if (method === "POST" && url.pathname === "/api/logout") {
      const { tokenHash } = authenticate(request);
      database.sessions = database.sessions.filter((session) => session.tokenHash !== tokenHash);
      await saveDatabase();
      return respond(response, 200, { status: "ok" });
    }

    if (method === "PUT" && url.pathname === "/api/profile") {
      const { user } = authenticate(request);
      if (!["driver", "school"].includes(user.role)) throw fail(403, "This account cannot update its profile.");
      const input = await readJson(request);
      const fields = ["name", "email", "phone", "idNumber", "vehicle", "plate"];
      const profile = Object.fromEntries(fields.map((field) => [
        field,
        typeof input[field] === "string" ? input[field].trim() : "",
      ]));
      profile.email = profile.email.toLowerCase();
      if (!profile.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
        throw fail(400, "Enter a valid name and email address.");
      }
      if (database.users.some((other) => other.id !== user.id && other.email === profile.email)) {
        throw fail(409, "An account with this email already exists.");
      }
      user.email = profile.email;
      user.profile = profile;
      const application = applicationFor(user.id);
      if (application) Object.assign(application, profile);
      await saveDatabase();
      return respond(response, 200, { user: publicUser(user), application });
    }

    if (method === "GET" && url.pathname === "/api/admin/applications") {
      const { user } = authenticate(request);
      if (user.role !== "admin") throw fail(403, "Verification officer access is required.");
      return respond(response, 200, { applications: database.applications });
    }

    if (method === "GET" && url.pathname === "/api/school/drivers") {
      const { user } = authenticate(request);
      if (user.role !== "school") throw fail(403, "School account access is required.");
      const applications = database.applications
        .filter((application) => application.status === "Approved")
        .map(({ userId, documents, ...application }) => ({
          ...application,
          documents: documents.map(({ name, status }) => ({ name, status })),
        }));
      return respond(response, 200, { applications });
    }

    const adminApplicationMatch = url.pathname.match(/^\/api\/admin\/applications\/([^/]+)$/);
    if (method === "PATCH" && adminApplicationMatch) {
      const { user } = authenticate(request);
      if (user.role !== "admin") throw fail(403, "Verification officer access is required.");
      const application = database.applications.find((entry) => entry.id === adminApplicationMatch[1]);
      if (!application) throw fail(404, "Application not found.");
      const input = await readJson(request);
      if (input.documentName) {
        const document = application.documents.find((entry) => entry.name === input.documentName);
        if (!document) throw fail(400, "Choose a required document type.");
        if (!["Verified", "Requested", "Under review"].includes(input.documentStatus)) {
          throw fail(400, "Choose a valid document status.");
        }
        if (input.documentStatus === "Verified" && (!document.fileId || document.status === "Requested")) {
          throw fail(409, "A current, uploaded document is required before verification.");
        }
        document.status = input.documentStatus;
      }
      if (input.status) {
        if (!["Approved", "Rejected", "Suspended", "Under review"].includes(input.status)) {
          throw fail(400, "Choose a valid application status.");
        }
        if (input.status === "Approved" && !application.documents.every((document) => document.status === "Verified" && document.fileId)) {
          throw fail(409, "All required documents must be uploaded and verified before approval.");
        }
        application.status = input.status;
      }
      await saveDatabase();
      return respond(response, 200, { application });
    }

    const uploadMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/documents$/);
    if (method === "POST" && uploadMatch) {
      const { user } = authenticate(request);
      if (user.role !== "driver") throw fail(403, "Only drivers can upload driver documents.");
      const application = applicationFor(user.id);
      if (!application || application.id !== uploadMatch[1]) throw fail(404, "Application not found.");
      const input = await readJson(request);
      const document = application.documents.find((entry) => entry.name === input.documentName);
      if (!document) throw fail(400, "Choose a required document type.");
      const fileName = typeof input.fileName === "string" ? path.basename(input.fileName) : "";
      const extension = path.extname(fileName).toLowerCase();
      const contentType = input.contentType;
      const allowedTypes = {
        ".pdf": ["application/pdf"],
        ".jpg": ["image/jpeg"],
        ".jpeg": ["image/jpeg"],
        ".png": ["image/png"],
      };
      if (!fileName || !allowedTypes[extension] || (contentType && !allowedTypes[extension].includes(contentType))) {
        throw fail(400, "Documents must be PDF, JPG or PNG files.");
      }
      if (typeof input.content !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.content)) {
        throw fail(400, "The uploaded file is invalid.");
      }
      const bytes = Buffer.from(input.content, "base64");
      if (!bytes.length || bytes.length > maxUploadSize) {
        throw fail(413, "Documents must be no larger than 10 MB.");
      }
      const fileId = randomUUID();
      await writeFile(path.join(uploadDirectory, fileId), bytes, { flag: "wx", mode: 0o600 });
      Object.assign(document, { status: "Under review", fileName, fileId, contentType: allowedTypes[extension][0] });
      application.status = application.documents.some((entry) => entry.fileId) ? "Under review" : "Incomplete";
      await saveDatabase();
      return respond(response, 200, { application });
    }

    const fileMatch = url.pathname.match(/^\/api\/documents\/([0-9a-f-]{36})$/i);
    if (method === "GET" && fileMatch) {
      const { user } = authenticate(request);
      const application = database.applications.find((entry) => entry.documents.some((doc) => doc.fileId === fileMatch[1]));
      const document = application?.documents.find((entry) => entry.fileId === fileMatch[1]);
      if (!document || (application.userId !== user.id && user.role !== "admin")) {
        throw fail(404, "Document not found.");
      }
      const bytes = await readFile(path.join(uploadDirectory, document.fileId));
      const safeFileName = document.fileName.replace(/["\r\n]/g, "_");
      response.writeHead(200, {
        "Content-Type": document.contentType,
        "Content-Length": bytes.length,
        "Content-Disposition": `attachment; filename="${safeFileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return response.end(bytes);
    }

    return respond(response, 404, { error: "Not found." });
  } catch (error) {
    if (error.code === "ENOENT") return respond(response, 404, { error: "Document file not found." });
    if (error.status) return respond(response, error.status, { error: error.message });
    console.error("API request failed:", error);
    return respond(response, 500, { error: "An unexpected server error occurred." });
  }
}

await initialize();
createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("API handler failed:", error);
    if (!response.headersSent) respond(response, 500, { error: "An unexpected server error occurred." });
    else response.destroy(error);
  });
}).listen(port, () => console.log(`SafeRoute API listening on port ${port}`));
