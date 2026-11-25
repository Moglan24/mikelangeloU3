const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "fieldnotes.sqlite");
const SESSION_MS = 8 * 60 * 60 * 1000;
const RESET_MS = 15 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 2;
const ROLES = ["standard", "investigator", "admin"];
const THEMES = {
  egypt: { label: "Ancient worlds", color: "#b57a38" },
  ocean: { label: "Ocean studies", color: "#387b83" },
  space: { label: "Space science", color: "#7663b2" },
  forest: { label: "Ecology", color: "#568265" },
  history: { label: "History", color: "#ab6650" },
};

fs.mkdirSync(DATA_DIR, { recursive: true });
if (process.env.NODE_ENV === "production" && (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)) {
  throw new Error("AUTH_SECRET must contain at least 32 characters in production.");
}
let AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  const secretPath = path.join(DATA_DIR, ".auth-secret");
  try {
    AUTH_SECRET = fs.readFileSync(secretPath, "utf8").trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    AUTH_SECRET = crypto.randomBytes(48).toString("base64url");
    try {
      fs.writeFileSync(secretPath, AUTH_SECRET, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      AUTH_SECRET = fs.readFileSync(secretPath, "utf8").trim();
    }
  }
}
if (AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('standard', 'investigator', 'admin')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_label TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_active ON sessions(user_id, expires_at);
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    theme TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    read_minutes INTEGER NOT NULL,
    source TEXT NOT NULL,
    featured INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookmarks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('favorite', 'bookmark')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, topic_id, kind)
  );
  CREATE TABLE IF NOT EXISTS discussions (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const seedTopics = [
  {
    id: "egyptian-blue",
    title: "The blue that outlasted an empire",
    category: "Material culture",
    theme: "egypt",
    summary: "How a brilliant synthetic pigment traveled from ancient Egyptian workshops into the art and architecture of the Mediterranean.",
    content: "Egyptian blue is one of the earliest known synthetic pigments. Artisans combined silica, lime, copper, and an alkali, then fired the mixture to create a vivid, durable blue. The pigment appeared on statues, wall paintings, coffins, and everyday objects. Its production reveals the close relationship between craft knowledge, trade, and visual culture in the ancient world.\n\nResearchers study tiny pigment samples with non-invasive imaging and chemical analysis. The evidence can help identify workshop practices, restoration history, and the movement of materials between regions. Even a small fragment can hold clues about the people who made and used it.",
    read_minutes: 6,
    source: "The Metropolitan Museum of Art · Heilbrunn Timeline of Art History",
    featured: 1,
  },
  {
    id: "coral-archives",
    title: "Coral reefs as living archives",
    category: "Marine science",
    theme: "ocean",
    summary: "Reading the rings inside coral skeletons to reconstruct ocean temperatures and environmental change.",
    content: "Like trees, many corals build repeating growth bands. Their skeletons preserve chemical signals from the water in which they grew. By comparing these signals with modern measurements, researchers can estimate past sea-surface temperatures and investigate how reef environments changed over time.\n\nA coral core is only one part of the evidence. Field observations, satellite records, and local ecological knowledge help researchers understand what those chemical patterns mean and how reefs respond to stress.",
    read_minutes: 8,
    source: "NOAA Ocean Service · Coral Reef Conservation Program",
    featured: 1,
  },
  {
    id: "moon-water",
    title: "Following water across the Moon",
    category: "Planetary science",
    theme: "space",
    summary: "What lunar orbiters and landers have taught scientists about water ice in permanently shadowed regions.",
    content: "The Moon's poles contain craters whose interiors receive little or no direct sunlight. Instruments on orbiting spacecraft have detected evidence consistent with water ice in these cold traps. Mapping where the signals appear—and how strong they are—helps scientists form better questions about the origin and distribution of lunar volatiles.\n\nRemote sensing is an indirect method: instruments measure reflected light or particles rather than collecting every sample. Mission teams combine multiple measurements and ground-truthing to test competing explanations.",
    read_minutes: 7,
    source: "NASA Science · Moon: Water and Ice",
    featured: 1,
  },
  {
    id: "forest-mycorrhiza",
    title: "The hidden partnerships beneath a forest",
    category: "Ecology",
    theme: "forest",
    summary: "Exploring the intricate relationships between tree roots and mycorrhizal fungi.",
    content: "Many plants associate with mycorrhizal fungi that extend the reach of their roots. These relationships can help plants acquire nutrients and water, while fungi receive carbon compounds from their hosts. The details vary by species and ecosystem, so the familiar image of a single, cooperative 'wood-wide web' can oversimplify a much more complex picture.\n\nField ecologists combine soil sampling, experiments, and molecular tools to understand which organisms interact, under what conditions, and with what consequences for forest communities.",
    read_minutes: 5,
    source: "Smithsonian Environmental Research Center · Forest Ecology",
    featured: 0,
  },
  {
    id: "alexandria-library",
    title: "The Library of Alexandria: evidence and legend",
    category: "History of knowledge",
    theme: "history",
    summary: "Separating what ancient sources tell us from the popular story of one catastrophic fire.",
    content: "The ancient Library of Alexandria has become a symbol of knowledge lost. Historical accounts, however, describe several events and institutions across different periods rather than one simple moment of destruction. Scholars compare classical texts, archaeological evidence, and later retellings to understand how the library functioned and why its story changed over time.\n\nGood historical investigation makes uncertainty visible. Where sources conflict or go silent, careful researchers identify what can be supported, what remains debated, and whose perspectives have been preserved.",
    read_minutes: 9,
    source: "World History Encyclopedia · Library of Alexandria",
    featured: 0,
  },
];

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const toB64Url = (value) => Buffer.from(value).toString("base64url");
const fromB64Url = (value) => Buffer.from(value, "base64url").toString("utf8");

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [algorithm, saltHex, keyHex] = String(stored).split("$");
  if (algorithm !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function makeJwt(payload) {
  const header = toB64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = toB64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function readJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new HttpError(401, "Please sign in to continue.");
  const [header, payload, signature] = parts;
  let decoded;
  try {
    decoded = JSON.parse(fromB64Url(header));
    if (decoded.alg !== "HS256" || decoded.typ !== "JWT") throw new Error("Unsupported token.");
  } catch {
    throw new HttpError(401, "Your session is invalid. Please sign in again.");
  }
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(`${header}.${payload}`).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    throw new HttpError(401, "Your session is invalid. Please sign in again.");
  }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    throw new HttpError(401, "Your session is invalid. Please sign in again.");
  }
  let claims;
  try {
    claims = JSON.parse(fromB64Url(payload));
  } catch {
    throw new HttpError(401, "Your session is invalid. Please sign in again.");
  }
  if (!claims.userId || !claims.sessionId || !Number.isInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }
  return claims;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function userView(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at };
}

function getUserFromRequest(req) {
  const value = req.headers.authorization || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Please sign in to continue.");
  const claims = readJwt(match[1]);
  const session = db.prepare(`
    SELECT s.id, s.user_id, s.device_id, s.device_label, s.user_agent, s.ip_address,
           s.created_at, s.last_seen_at, s.expires_at, u.id AS uid, u.name, u.email, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.user_id = ? AND s.expires_at > ?
  `).get(claims.sessionId, claims.userId, nowIso());
  if (!session) throw new HttpError(401, "Your session has ended. Please sign in again.");
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), session.id);
  return {
    id: session.uid,
    name: session.name,
    email: session.email,
    role: session.role,
    sessionId: session.id,
  };
}

function requireRole(user, allowed) {
  if (!allowed.includes(user.role)) throw new HttpError(403, "You do not have permission to do that.");
}

function parseDeviceLabel(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  const browser = ua.includes("edg/") ? "Edge" : ua.includes("firefox/") ? "Firefox" : ua.includes("chrome/") ? "Chrome" : ua.includes("safari/") ? "Safari" : "Browser";
  const platform = ua.includes("windows") ? "Windows" : ua.includes("mac") ? "Mac" : ua.includes("android") ? "Android" : ua.includes("iphone") || ua.includes("ipad") ? "iOS" : ua.includes("linux") ? "Linux" : "Device";
  return `${browser} on ${platform}`;
}

function productionAppOrigin() {
  const configuredUrl = process.env.APP_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "");
  try {
    const appUrl = new URL(configuredUrl);
    return appUrl.protocol === "https:" ? appUrl.origin : "";
  } catch {
    return "";
  }
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 12 && password.length <= 128 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function validateText(value, label, min, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) throw new HttpError(400, `${label} must be between ${min} and ${max} characters.`);
  return text;
}

function safeSession(row, currentId) {
  return {
    id: row.id,
    device: row.device_label,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    current: row.id === currentId,
  };
}

function seedDatabase() {
  const insertTopic = db.prepare(`
    INSERT OR IGNORE INTO topics
    (id, title, category, theme, summary, content, read_minutes, source, featured, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  const timestamp = nowIso();
  for (const topic of seedTopics) {
    insertTopic.run(topic.id, topic.title, topic.category, topic.theme, topic.summary, topic.content, topic.read_minutes, topic.source, topic.featured, timestamp, timestamp);
  }
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('announcement', '')").run();

  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (adminEmail || adminPassword) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || !validatePassword(adminPassword)) {
      throw new Error("Set a valid ADMIN_EMAIL and a strong ADMIN_PASSWORD together to bootstrap an administrator.");
    }
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
    if (!existing) {
      db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
        .run(uuid(), adminEmail, "Platform administrator", hashPassword(adminPassword), timestamp);
      console.log(`Bootstrapped administrator account for ${adminEmail}.`);
    }
  }
}
seedDatabase();

const loginAttempts = new Map();
function checkRateLimit(key) {
  const current = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((time) => current - time < 15 * 60 * 1000);
  if (recent.length >= 8) throw new HttpError(429, "Too many sign-in attempts. Please wait a few minutes and try again.");
  recent.push(current);
  loginAttempts.set(key, recent);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function topicView(row) {
  return {
    id: row.id, title: row.title, category: row.category, theme: row.theme,
    themeLabel: THEMES[row.theme]?.label || "Research",
    summary: row.summary, content: row.content, readMinutes: row.read_minutes,
    source: row.source, featured: Boolean(row.featured), createdAt: row.created_at,
  };
}

function topics() {
  return db.prepare("SELECT * FROM topics ORDER BY featured DESC, title COLLATE NOCASE").all().map(topicView);
}

function getTopic(id) {
  const row = db.prepare("SELECT * FROM topics WHERE id = ?").get(id);
  if (!row) throw new HttpError(404, "Research topic not found.");
  return row;
}

function getBookmarks(userId) {
  return db.prepare(`
    SELECT b.kind, t.* FROM bookmarks b JOIN topics t ON t.id = b.topic_id
    WHERE b.user_id = ? ORDER BY b.created_at DESC
  `).all(userId).map((row) => ({ ...topicView(row), kind: row.kind }));
}

function getDiscussions(topicId) {
  const rows = db.prepare(`
    SELECT d.id, d.topic_id, d.title, d.body, d.created_at, u.id AS author_id, u.name AS author_name, u.role AS author_role
    FROM discussions d JOIN users u ON u.id = d.user_id
    WHERE d.topic_id = ? ORDER BY d.created_at DESC
  `).all(topicId);
  const getComments = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.name AS author_name, u.role AS author_role
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.discussion_id = ? ORDER BY c.created_at ASC
  `);
  return rows.map((row) => ({
    id: row.id, topicId: row.topic_id, title: row.title, body: row.body,
    createdAt: row.created_at, author: { id: row.author_id, name: row.author_name, role: row.author_role },
    comments: getComments.all(row.id),
  }));
}

function svgForTopic(topic) {
  const title = topic.title.replace(/[<>&"']/g, "");
  const palette = {
    egypt: ["#172a28", "#dbad67", "#e7d3aa"],
    ocean: ["#102d38", "#6db1b0", "#d4ece7"],
    space: ["#15172b", "#9d8bd4", "#e3dafa"],
    forest: ["#1b3028", "#87a983", "#e0ead8"],
    history: ["#30231f", "#c58d6f", "#f0d7c5"],
  }[topic.theme] || ["#172a28", "#dbad67", "#e7d3aa"];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 420" role="img" aria-label="Research field illustration"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${palette[0]}"/><stop offset="1" stop-color="#293b39"/></linearGradient></defs><rect width="760" height="420" fill="url(#g)"/><circle cx="570" cy="145" r="95" fill="${palette[1]}" opacity=".82"/><path d="M0 315 Q155 230 285 316T560 290T760 300V420H0Z" fill="${palette[2]}" opacity=".24"/><path d="M0 354 Q160 285 310 352T610 338T760 326V420H0Z" fill="${palette[2]}" opacity=".35"/><path d="M82 287V161h114v126m-89 0v-83h63v83M260 290V195h42v95m-62-95 83-71 83 71m-47 95v-58h32v58" fill="none" stroke="${palette[2]}" stroke-width="8" opacity=".78"/><text x="54" y="376" fill="white" font-family="Georgia,serif" font-size="21" opacity=".92">${title}</text></svg>`;
}

function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = decodeURIComponent(url.pathname);
      const method = req.method || "GET";

      if (method === "GET" && pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, service: "fieldnotes" });
      }

      if (method === "POST" && pathname === "/api/auth/register") {
        const body = await readJson(req);
        const name = validateText(body.name, "Name", 2, 80);
        const email = validateText(body.email, "Email", 3, 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
        if (!validatePassword(body.password)) throw new HttpError(400, "Use at least 12 characters with uppercase and lowercase letters, a number, and a symbol.");
        const id = uuid();
        try {
          db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'standard', ?)")
            .run(id, email, name, hashPassword(body.password), nowIso());
        } catch (error) {
          if (String(error.message).includes("UNIQUE")) throw new HttpError(409, "An account with that email already exists.");
          throw error;
        }
        return sendJson(res, 201, { message: "Account created. Sign in to open your field notebook." });
      }

      if (method === "POST" && pathname === "/api/auth/login") {
        const body = await readJson(req);
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const key = `${req.socket.remoteAddress || "unknown"}:${email}`;
        checkRateLimit(key);
        const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (!user || !verifyPassword(String(body.password || ""), user.password_hash)) throw new HttpError(401, "Email or password is incorrect.");
        const deviceId = String(req.headers["x-device-id"] || "");
        if (!/^[A-Za-z0-9_-]{16,100}$/.test(deviceId)) throw new HttpError(400, "This browser could not be identified. Refresh and try again.");
        const createdAt = nowIso();
        const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
        const sessionId = uuid();
        const userAgent = String(req.headers["user-agent"] || "Unknown browser").slice(0, 300);
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt);
          db.prepare("DELETE FROM sessions WHERE user_id = ? AND device_id = ?").run(user.id, deviceId);
          const count = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND expires_at > ?").get(user.id, createdAt).count;
          if (count >= MAX_ACTIVE_SESSIONS) {
            db.exec("ROLLBACK");
            throw new HttpError(409, "This account already has two active devices. Sign out of one session before continuing.");
          }
          db.prepare(`
            INSERT INTO sessions (id, user_id, device_id, device_label, user_agent, ip_address, created_at, last_seen_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(sessionId, user.id, deviceId, parseDeviceLabel(userAgent), userAgent, req.socket.remoteAddress || "", createdAt, createdAt, expiresAt);
          db.exec("COMMIT");
        } catch (error) {
          if (!(error instanceof HttpError)) db.exec("ROLLBACK");
          throw error;
        }
        const token = makeJwt({ userId: user.id, sessionId, role: user.role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + SESSION_MS / 1000 });
        const sessions = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC").all(user.id, nowIso());
        return sendJson(res, 200, {
          token, user: userView(user),
          sessions: sessions.map((row) => safeSession(row, sessionId)),
        });
      }

      if (method === "POST" && pathname === "/api/auth/forgot") {
        const productionMailReady = process.env.RESEND_API_KEY && process.env.RESET_FROM_EMAIL;
        const appOrigin = process.env.NODE_ENV === "production" ? productionAppOrigin() : "";
        if (process.env.NODE_ENV === "production" && (!productionMailReady || !appOrigin)) {
          return sendJson(res, 503, { error: "Password recovery is not available until email delivery is configured." });
        }
        const body = await readJson(req);
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
        if (user) {
          const token = crypto.randomBytes(32).toString("base64url");
          const createdAt = nowIso();
          db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(createdAt, user.id);
          db.prepare("INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(uuid(), user.id, hash(token), new Date(Date.now() + RESET_MS).toISOString(), createdAt);
          if (process.env.NODE_ENV !== "production") {
            const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
            console.log(`Password reset link for ${user.email}: ${base}/#reset=${token}`);
          } else {
            let delivered = false;
            try {
              const response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: process.env.RESET_FROM_EMAIL,
                  to: [user.email],
                  subject: "Reset your Fieldnotes password",
                  html: `<p>A password reset was requested for your Fieldnotes account.</p><p><a href="${appOrigin}/#reset=${token}">Choose a new password</a></p><p>This one-time link expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
                }),
                signal: AbortSignal.timeout(10000),
              });
              if (!response.ok) {
                console.error("Password reset email delivery failed:", response.status, (await response.text()).slice(0, 500));
              } else {
                delivered = true;
              }
            } catch (error) {
              console.error("Password reset email delivery failed:", error);
            }
            if (!delivered) {
              db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(nowIso(), user.id);
            }
          }
        }
        return sendJson(res, 200, { message: "If an account matches that email, a secure reset link will be available shortly." });
      }

      if (method === "POST" && pathname === "/api/auth/reset") {
        const body = await readJson(req);
        const token = typeof body.token === "string" ? body.token : "";
        if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new HttpError(400, "This reset link is invalid or has expired.");
        if (!validatePassword(body.password)) throw new HttpError(400, "Use at least 12 characters with uppercase and lowercase letters, a number, and a symbol.");
        const reset = db.prepare("SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
          .get(hash(token), nowIso());
        if (!reset) throw new HttpError(400, "This reset link is invalid or has expired.");
        db.exec("BEGIN IMMEDIATE");
        try {
          const updated = db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?")
            .run(nowIso(), reset.id, nowIso());
          if (Number(updated.changes) !== 1) throw new HttpError(400, "This reset link is invalid or has expired.");
          db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(body.password), reset.user_id);
          db.prepare("DELETE FROM sessions WHERE user_id = ?").run(reset.user_id);
          db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(nowIso(), reset.user_id);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return sendJson(res, 200, { message: "Password updated. Sign in with your new password." });
      }

      const publicFiles = {
        "/": "index.html",
        "/styles.css": "styles.css",
        "/app.js": "app.js",
        "/topics.json": "topics.json",
        "/discussions.json": "discussions.json",
      };
      if (method === "GET" && publicFiles[pathname]) {
        const target = path.join(PUBLIC_DIR, publicFiles[pathname]);
        const contents = fs.readFileSync(target);
        const contentType = target.endsWith(".html") ? "text/html; charset=utf-8"
          : target.endsWith(".css") ? "text/css; charset=utf-8"
            : target.endsWith(".json") ? "application/json; charset=utf-8"
              : "text/javascript; charset=utf-8";
        res.writeHead(200, { "Content-Type": contentType, "Content-Length": contents.length, "Cache-Control": "no-cache" });
        return res.end(contents);
      }

      if (pathname.startsWith("/api/")) {
        let user = null;
        const needsAuth =
          (pathname === "/api/topics" && method === "POST") ||
          (pathname.startsWith("/api/topics/") && (pathname.endsWith("/discussions") || pathname.endsWith("/bookmarks") || pathname.includes("/bookmarks/") || method === "POST" || method === "PATCH")) ||
          pathname.startsWith("/api/discussions/") || pathname.startsWith("/api/media/") ||
          pathname.startsWith("/api/auth/") ||
          pathname.startsWith("/api/admin/");
        if (needsAuth) user = getUserFromRequest(req);

        if (method === "POST" && pathname === "/api/auth/logout") {
          db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(user.sessionId, user.id);
          return sendJson(res, 200, { message: "Signed out." });
        }

        if (method === "GET" && pathname === "/api/auth/me") {
          const rows = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC").all(user.id, nowIso());
          return sendJson(res, 200, {
            user: userView(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)),
            sessions: rows.map((row) => safeSession(row, user.sessionId)),
          });
        }

        if (method === "GET" && pathname === "/api/auth/bookmarks") {
          return sendJson(res, 200, { bookmarks: getBookmarks(user.id) });
        }

        if (method === "DELETE" && pathname.startsWith("/api/auth/sessions/")) {
          const sessionId = pathname.split("/").pop();
          const result = db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(sessionId, user.id);
          if (!Number(result.changes)) throw new HttpError(404, "Session not found.");
          return sendJson(res, 200, { message: sessionId === user.sessionId ? "This session was signed out." : "Session ended." });
        }

        if (method === "POST" && pathname === "/api/auth/password/change") {
          const body = await readJson(req);
          const current = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id);
          if (!verifyPassword(String(body.currentPassword || ""), current.password_hash)) throw new HttpError(400, "Current password is incorrect.");
          if (!validatePassword(body.newPassword)) throw new HttpError(400, "Use at least 12 characters with uppercase and lowercase letters, a number, and a symbol.");
          db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(body.newPassword), user.id);
          db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(user.id, user.sessionId);
          return sendJson(res, 200, { message: "Password updated. Other active sessions have been signed out." });
        }

        if (method === "GET" && pathname === "/api/topics") {
          return sendJson(res, 200, { topics: topics() });
        }

        const topicMatch = pathname.match(/^\/api\/topics\/([^/]+)$/);
        if (topicMatch && method === "GET") return sendJson(res, 200, { topic: topicView(getTopic(topicMatch[1])) });

        if (method === "POST" && pathname === "/api/topics") {
          requireRole(user, ["investigator", "admin"]);
          const body = await readJson(req);
          const title = validateText(body.title, "Title", 5, 120);
          const summary = validateText(body.summary, "Summary", 20, 320);
          const content = validateText(body.content, "Research notes", 50, 10000);
          const category = validateText(body.category, "Category", 2, 60);
          const source = validateText(body.source, "Source", 2, 180);
          const theme = THEMES[body.theme] ? body.theme : "history";
          const id = uuid();
          const timestamp = nowIso();
          db.prepare(`
            INSERT INTO topics (id, title, category, theme, summary, content, read_minutes, source, featured, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
          `).run(id, title, category, theme, summary, content, Math.max(1, Math.min(60, Math.round(content.length / 900))), source, user.id, timestamp, timestamp);
          return sendJson(res, 201, { topic: topicView(getTopic(id)) });
        }

        const topicUpdateMatch = pathname.match(/^\/api\/topics\/([^/]+)$/);
        if (topicUpdateMatch && method === "PATCH") {
          requireRole(user, ["investigator", "admin"]);
          const existing = getTopic(topicUpdateMatch[1]);
          const body = await readJson(req);
          const title = body.title === undefined ? existing.title : validateText(body.title, "Title", 5, 120);
          const summary = body.summary === undefined ? existing.summary : validateText(body.summary, "Summary", 20, 320);
          const content = body.content === undefined ? existing.content : validateText(body.content, "Research notes", 50, 10000);
          const category = body.category === undefined ? existing.category : validateText(body.category, "Category", 2, 60);
          const source = body.source === undefined ? existing.source : validateText(body.source, "Source", 2, 180);
          const theme = body.theme === undefined ? existing.theme : (THEMES[body.theme] ? body.theme : existing.theme);
          db.prepare("UPDATE topics SET title = ?, summary = ?, content = ?, category = ?, source = ?, theme = ?, updated_at = ? WHERE id = ?")
            .run(title, summary, content, category, source, theme, nowIso(), existing.id);
          return sendJson(res, 200, { topic: topicView(getTopic(existing.id)) });
        }

        const discussionsMatch = pathname.match(/^\/api\/topics\/([^/]+)\/discussions$/);
        if (discussionsMatch && method === "GET") {
          getTopic(discussionsMatch[1]);
          return sendJson(res, 200, { discussions: getDiscussions(discussionsMatch[1]) });
        }
        if (discussionsMatch && method === "POST") {
          getTopic(discussionsMatch[1]);
          const body = await readJson(req);
          const title = validateText(body.title, "Discussion title", 4, 140);
          const content = validateText(body.body, "Discussion", 5, 3000);
          const id = uuid();
          db.prepare("INSERT INTO discussions (id, topic_id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(id, discussionsMatch[1], user.id, title, content, nowIso());
          return sendJson(res, 201, { discussion: getDiscussions(discussionsMatch[1]).find((item) => item.id === id) });
        }

        const bookmarksMatch = pathname.match(/^\/api\/topics\/([^/]+)\/bookmarks$/);
        if (bookmarksMatch && method === "GET") {
          return sendJson(res, 200, { bookmarks: getBookmarks(user.id).filter((item) => item.id === bookmarksMatch[1]) });
        }
        if (bookmarksMatch && method === "POST") {
          getTopic(bookmarksMatch[1]);
          const body = await readJson(req);
          if (!["favorite", "bookmark"].includes(body.kind)) throw new HttpError(400, "Choose a favorite or bookmark.");
          db.prepare("INSERT OR IGNORE INTO bookmarks (user_id, topic_id, kind, created_at) VALUES (?, ?, ?, ?)")
            .run(user.id, bookmarksMatch[1], body.kind, nowIso());
          return sendJson(res, 201, { bookmarks: getBookmarks(user.id) });
        }
        const bookmarkDeleteMatch = pathname.match(/^\/api\/topics\/([^/]+)\/bookmarks\/(favorite|bookmark)$/);
        if (bookmarkDeleteMatch && method === "DELETE") {
          db.prepare("DELETE FROM bookmarks WHERE user_id = ? AND topic_id = ? AND kind = ?").run(user.id, bookmarkDeleteMatch[1], bookmarkDeleteMatch[2]);
          return sendJson(res, 200, { bookmarks: getBookmarks(user.id) });
        }

        const commentMatch = pathname.match(/^\/api\/discussions\/([^/]+)\/comments$/);
        if (commentMatch && method === "POST") {
          const discussion = db.prepare("SELECT * FROM discussions WHERE id = ?").get(commentMatch[1]);
          if (!discussion) throw new HttpError(404, "Discussion not found.");
          const body = await readJson(req);
          const comment = validateText(body.body, "Comment", 2, 2000);
          db.prepare("INSERT INTO comments (id, discussion_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(uuid(), discussion.id, user.id, comment, nowIso());
          return sendJson(res, 201, { discussions: getDiscussions(discussion.topic_id) });
        }

        const mediaMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
        if (mediaMatch && method === "GET") {
          const topic = getTopic(url.searchParams.get("topic") || mediaMatch[1]);
          const image = svgForTopic(topic);
          res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Content-Length": Buffer.byteLength(image), "Cache-Control": "private, no-store" });
          return res.end(image);
        }

        if (method === "GET" && pathname === "/api/admin/users") {
          requireRole(user, ["admin"]);
          const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map((row) => ({
            ...userView(row),
            activeSessions: db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND expires_at > ?").get(row.id, nowIso()).count,
          }));
          return sendJson(res, 200, { users });
        }

        const roleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
        if (roleMatch && method === "PATCH") {
          requireRole(user, ["admin"]);
          const body = await readJson(req);
          if (!ROLES.includes(body.role)) throw new HttpError(400, "Choose a supported role.");
          if (roleMatch[1] === user.id && body.role !== "admin") throw new HttpError(400, "You cannot remove your own administrator role.");
          const target = db.prepare("SELECT id, role FROM users WHERE id = ?").get(roleMatch[1]);
          if (!target) throw new HttpError(404, "User not found.");
          if (target.role === "admin" && body.role !== "admin") {
            const admins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
            if (admins <= 1) throw new HttpError(400, "At least one administrator must remain.");
          }
          db.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, target.id);
          return sendJson(res, 200, { user: userView(db.prepare("SELECT * FROM users WHERE id = ?").get(target.id)) });
        }

        if (method === "GET" && pathname === "/api/admin/settings") {
          requireRole(user, ["admin"]);
          const announcement = db.prepare("SELECT value FROM settings WHERE key = 'announcement'").get().value;
          return sendJson(res, 200, { announcement, maxDevices: MAX_ACTIVE_SESSIONS });
        }
        if (method === "PATCH" && pathname === "/api/admin/settings") {
          requireRole(user, ["admin"]);
          const body = await readJson(req);
          const announcement = typeof body.announcement === "string" ? body.announcement.trim() : "";
          if (announcement.length > 180) throw new HttpError(400, "Announcement must be 180 characters or fewer.");
          db.prepare("UPDATE settings SET value = ? WHERE key = 'announcement'").run(announcement);
          return sendJson(res, 200, { announcement, maxDevices: MAX_ACTIVE_SESSIONS });
        }

        if (method === "GET" && pathname === "/api/settings/announcement") {
          const announcement = db.prepare("SELECT value FROM settings WHERE key = 'announcement'").get().value;
          return sendJson(res, 200, { announcement });
        }

        throw new HttpError(404, "Route not found.");
      }
      throw new HttpError(404, "Page not found.");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error("Request failed:", error);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? "Something went wrong. Please try again." : error.message });
      else res.end();
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, "0.0.0.0", () => console.log(`Fieldnotes is ready on http://localhost:${port}`));
  const close = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

module.exports = { createServer, db, hashPassword, verifyPassword, validatePassword };
