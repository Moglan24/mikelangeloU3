const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-test-"));
process.env.DATA_DIR = dataDir;
process.env.AUTH_SECRET = "test-only-auth-secret-with-at-least-32-characters";
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.ADMIN_PASSWORD = "StrongAdminPass1!";
process.env.NODE_ENV = "test";

const { createServer, db } = require("../server");
const server = createServer();
let baseUrl;
let adminToken;
let userToken;
let secondDeviceToken;
let thirdDeviceToken;
let userId;
const password = "StrongMemberPass1!";

function headers(token, device = "device-0123456789abcdef") {
  const result = { "X-Device-ID": device };
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

async function request(url, { token, device, method = "GET", body } = {}) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...headers(token, device),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("Fieldnotes API covers auth, role checks, sessions, saved research, and recovery", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const health = await request("/api/health");
  assert.equal(health.status, 200);
  const publicTopics = await request("/topics.json");
  assert.equal(publicTopics.status, 200);
  assert.match(publicTopics.headers.get("content-type"), /application\/json/);
  assert.equal((await publicTopics.json()).length, 5);
  const publicDiscussions = await request("/discussions.json");
  assert.equal(publicDiscussions.status, 200);
  const publicMedia = await request("/api/media/egyptian-blue?topic=egyptian-blue");
  assert.equal(publicMedia.status, 401);
  const publicDiscussion = await request("/api/topics/egyptian-blue/discussions");
  assert.equal(publicDiscussion.status, 401);

  const registration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Riley Researcher", email: "riley@example.test", password },
  });
  assert.equal(registration.status, 201);
  userId = db.prepare("SELECT id FROM users WHERE email = ?").get("riley@example.test").id;
  const storedPassword = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId).password_hash;
  assert.match(storedPassword, /^scrypt\$/);
  assert.notEqual(storedPassword, password);

  const adminLogin = await request("/api/auth/login", {
    method: "POST", device: "admin-device-00000001",
    body: { email: "admin@example.test", password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(adminLogin.status, 200);
  adminToken = (await adminLogin.json()).token;

  const firstLogin = await request("/api/auth/login", {
    method: "POST", device: "first-device-000000000001",
    body: { email: "riley@example.test", password },
  });
  assert.equal(firstLogin.status, 200);
  const firstSession = await firstLogin.json();
  userToken = firstSession.token;
  assert.equal(firstSession.user.id, userId);
  const claims = JSON.parse(Buffer.from(userToken.split(".")[1], "base64url").toString("utf8"));
  assert.equal(claims.userId, userId);
  assert.ok(claims.exp > Math.floor(Date.now() / 1000));
  const signedParts = userToken.split(".");
  signedParts[2] = `${signedParts[2][0] === "A" ? "B" : "A"}${signedParts[2].slice(1)}`;
  const tampered = await request("/api/media/egyptian-blue?topic=egyptian-blue", {
    token: signedParts.join("."),
  });
  assert.equal(tampered.status, 401);

  const topics = await (await request("/api/topics")).json();
  assert.ok(topics.topics.length >= 5);
  const addFavorite = await request("/api/topics/egyptian-blue/bookmarks", {
    method: "POST", token: userToken, body: { kind: "favorite" },
  });
  assert.equal(addFavorite.status, 201);
  const saved = await request("/api/auth/bookmarks", { token: userToken });
  assert.equal((await saved.json()).bookmarks[0].kind, "favorite");
  await request("/api/topics/egyptian-blue/bookmarks", {
    method: "POST", token: userToken, body: { kind: "bookmark" },
  });
  const removeBookmark = await request("/api/topics/egyptian-blue/bookmarks/bookmark", {
    method: "DELETE", token: userToken,
  });
  assert.equal(removeBookmark.status, 200);
  assert.deepEqual((await removeBookmark.json()).bookmarks.map((item) => item.kind), ["favorite"]);

  const discussion = await request("/api/topics/egyptian-blue/discussions", {
    method: "POST", token: userToken,
    body: { title: "Where was the pigment made?", body: "Which evidence supports the workshop locations?" },
  });
  assert.equal(discussion.status, 201);
  const discussionData = await discussion.json();
  const comment = await request(`/api/discussions/${discussionData.discussion.id}/comments`, {
    method: "POST", token: userToken, body: { body: "The museum catalogue cites material analysis." },
  });
  assert.equal(comment.status, 201);
  const savedDiscussion = await request("/api/topics/egyptian-blue/discussions", { token: userToken });
  assert.equal((await savedDiscussion.json()).discussions[0].comments.length, 1);
  const protectedMedia = await request("/api/media/egyptian-blue?topic=egyptian-blue", { token: userToken });
  assert.equal(protectedMedia.status, 200);
  assert.match(protectedMedia.headers.get("content-type"), /image\/svg\+xml/);

  const standardCreate = await request("/api/topics", {
    method: "POST", token: userToken,
    body: { title: "A new topic", category: "Research", theme: "history", summary: "A sufficiently long summary for this topic.", content: "A sufficiently long body of research notes for a new topic, including context and evidence.", source: "Test source" },
  });
  assert.equal(standardCreate.status, 403);
  const standardAdminRoute = await request("/api/admin/users", { token: userToken });
  assert.equal(standardAdminRoute.status, 403);

  const secondLogin = await request("/api/auth/login", {
    method: "POST", device: "second-device-000000002",
    body: { email: "riley@example.test", password },
  });
  assert.equal(secondLogin.status, 200);
  const secondData = await secondLogin.json();
  secondDeviceToken = secondData.token;
  assert.equal(secondData.sessions.length, 2);

  const thirdLoginRejected = await request("/api/auth/login", {
    method: "POST", device: "third-device-00000000003",
    body: { email: "riley@example.test", password },
  });
  assert.equal(thirdLoginRejected.status, 409);

  const revoked = await request(`/api/auth/sessions/${secondData.sessions.find((session) => session.current).id}`, {
    method: "DELETE", token: userToken,
  });
  assert.equal(revoked.status, 200);
  const thirdLogin = await request("/api/auth/login", {
    method: "POST", device: "third-device-00000000003",
    body: { email: "riley@example.test", password },
  });
  assert.equal(thirdLogin.status, 200);
  thirdDeviceToken = (await thirdLogin.json()).token;

  const roleChange = await request(`/api/admin/users/${userId}/role`, {
    method: "PATCH", token: adminToken, body: { role: "investigator" },
  });
  assert.equal(roleChange.status, 200);
  const investigatorAdminRoute = await request("/api/admin/users", { token: userToken });
  assert.equal(investigatorAdminRoute.status, 403);
  const roleUpdated = await request("/api/topics", {
    method: "POST", token: userToken,
    body: { title: "A new research thread", category: "Research", theme: "ocean", summary: "A sufficiently long summary for this topic.", content: "A sufficiently long body of research notes for a new topic, including context, evidence, and useful citations.", source: "Test source" },
  });
  assert.equal(roleUpdated.status, 201);

  const settingUpdate = await request("/api/admin/settings", {
    method: "PATCH", token: adminToken, body: { announcement: "Follow the sources." },
  });
  assert.equal(settingUpdate.status, 200);
  const publicSetting = await request("/api/settings/announcement");
  assert.equal((await publicSetting.json()).announcement, "Follow the sources.");

  const passwordUpdate = await request("/api/auth/password/change", {
    method: "POST", token: userToken,
    body: { currentPassword: password, newPassword: "FreshMemberPass2!" },
  });
  assert.equal(passwordUpdate.status, 200);
  const invalidOldPassword = await request("/api/auth/login", {
    method: "POST", device: "first-device-000000000001",
    body: { email: "riley@example.test", password },
  });
  assert.equal(invalidOldPassword.status, 401);

  const originalLog = console.log;
  const resetLogs = [];
  console.log = (...args) => resetLogs.push(args.join(" "));
  try {
    const forgot = await request("/api/auth/forgot", {
      method: "POST", body: { email: "riley@example.test" },
    });
    assert.equal(forgot.status, 200);
    assert.match((await forgot.json()).message, /If an account matches/);
  } finally {
    console.log = originalLog;
  }
  const resetToken = resetLogs[0]?.match(/#reset=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(resetToken);
  const unknownForgot = await request("/api/auth/forgot", {
    method: "POST", body: { email: "not-registered@example.test" },
  });
  assert.equal(unknownForgot.status, 200);
  assert.equal((await unknownForgot.json()).message, "If an account matches that email, a secure reset link will be available shortly.");
  const previousEnvironment = process.env.NODE_ENV;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESET_FROM_EMAIL;
  process.env.NODE_ENV = "production";
  try {
    const unavailableForKnown = await request("/api/auth/forgot", {
      method: "POST", body: { email: "riley@example.test" },
    });
    const unavailableForUnknown = await request("/api/auth/forgot", {
      method: "POST", body: { email: "not-registered@example.test" },
    });
    assert.equal(unavailableForKnown.status, 503);
    assert.equal(unavailableForUnknown.status, 503);
  } finally {
    process.env.NODE_ENV = previousEnvironment;
  }
  const reset = await request("/api/auth/reset", {
    method: "POST", body: { token: resetToken, password: "ResetMemberPass3!" },
  });
  assert.equal(reset.status, 200);
  const replay = await request("/api/auth/reset", {
    method: "POST", body: { token: resetToken, password: "AnotherMemberPass4!" },
  });
  assert.equal(replay.status, 400);
  const loginAfterReset = await request("/api/auth/login", {
    method: "POST", device: "after-reset-device-000000",
    body: { email: "riley@example.test", password: "ResetMemberPass3!" },
  });
  assert.equal(loginAfterReset.status, 200);
  assert.ok(userToken && secondDeviceToken && thirdDeviceToken);
});
