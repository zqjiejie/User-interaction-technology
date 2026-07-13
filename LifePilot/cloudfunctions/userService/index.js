const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DEFAULT_CONFIG = {
  studyGoal: 25,
  sportGoal: 3,
  sleepGoal: 8,
  entertainmentLimit: 600
};

const SCHEMA_VERSION = "2026-05-31-cloud-schema-v1";
const COLLECTIONS = [
  "users",
  "courses",
  "schedules",
  "records",
  "pomodoroSessions",
  "notes",
  "reports",
  "schemaVersions"
];

function success(data) {
  return { code: 0, message: "success", data };
}

function fail(code, message) {
  return { code, message, data: null };
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildProfile(event, emptyValue) {
  return {
    school: cleanText(event.school, 60) || emptyValue,
    major: cleanText(event.major, 60) || emptyValue,
    grade: cleanText(event.grade, 30) || emptyValue,
    studyGoal: numberOrNull(event.studyGoal),
    sportGoal: numberOrNull(event.sportGoal),
    sleepGoal: cleanText(event.sleepGoal, 10) || emptyValue,
    entertainmentLimit: numberOrNull(event.entertainmentLimit)
  };
}

async function getUser(openid) {
  const res = await db.collection("users").where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function getUserGoals(openid) {
  const user = await getUser(openid) || {};
  const sleepGoalNum = Number(user.sleepGoal);
  return {
    studyGoal: user.studyGoal !== null && user.studyGoal !== undefined ? Number(user.studyGoal) : DEFAULT_CONFIG.studyGoal,
    sportGoal: user.sportGoal !== null && user.sportGoal !== undefined ? Number(user.sportGoal) : DEFAULT_CONFIG.sportGoal,
    sleepGoal: Number.isFinite(sleepGoalNum) ? sleepGoalNum : DEFAULT_CONFIG.sleepGoal,
    entertainmentLimit: user.entertainmentLimit !== null && user.entertainmentLimit !== undefined ? Number(user.entertainmentLimit) : DEFAULT_CONFIG.entertainmentLimit
  };
}

async function handleLogin(event, openid, wxContext) {
  const now = db.serverDate();
  const nickName = cleanText(event.nickName || event.nickname, 40);
  const avatarUrl = cleanText(event.avatarUrl, 300);
  const existed = await getUser(openid);

  if (existed) {
    const profile = buildProfile(event, undefined);
    const updateData = {
      appid: wxContext.APPID || "",
      unionid: wxContext.UNIONID || "",
      nickName: nickName || existed.nickName || "",
      avatarUrl: avatarUrl || existed.avatarUrl || "",
      updatedAt: now
    };

    Object.keys(profile).forEach((key) => {
      if (profile[key] !== undefined && profile[key] !== null && profile[key] !== "") {
        updateData[key] = profile[key];
      }
    });

    await db.collection("users").doc(existed._id).update({ data: updateData });
    return success({ user: Object.assign({}, existed, updateData), isNewUser: false });
  }

  const newUser = Object.assign({
    openid,
    userId: openid,
    appid: wxContext.APPID || "",
    unionid: wxContext.UNIONID || "",
    nickName,
    avatarUrl,
    allowDiaryAI: false,
    allowNoteAI: false,
    allowRecordAI: true,
    allowReportAI: true,
    theme: "campus-light",
    profileCompleted: false,
    createdAt: now,
    updatedAt: now
  }, buildProfile({}, ""));

  const res = await db.collection("users").add({ data: newUser });
  return success({ user: Object.assign({ _id: res._id }, newUser), isNewUser: true });
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
    return { name, created: true };
  } catch (error) {
    const message = String(error && (error.errMsg || error.message || ""));
    if (message.includes("already exist") || message.includes("collection already exists") || message.includes("exists")) {
      return { name, created: false };
    }
    return { name, created: false, warning: message || "create collection skipped" };
  }
}

async function upsertSchema(openid) {
  const existed = await db.collection("schemaVersions").where({ key: SCHEMA_VERSION }).limit(1).get().catch(() => ({ data: [] }));
  const payload = {
    key: SCHEMA_VERSION,
    collections: COLLECTIONS,
    updatedBy: openid,
    updatedAt: db.serverDate()
  };

  if (existed.data.length) {
    await db.collection("schemaVersions").doc(existed.data[0]._id).update({ data: payload });
    return { id: existed.data[0]._id, updated: true };
  }

  const res = await db.collection("schemaVersions").add({
    data: Object.assign({}, payload, { createdAt: db.serverDate() })
  });
  return { id: res._id, created: true };
}

async function ensureUser(openid, event, wxContext) {
  const existed = await getUser(openid);
  if (existed) return { id: existed._id, created: false };
  const result = await handleLogin(event || {}, openid, wxContext);
  return { id: result.data.user._id, created: true };
}

async function handleInit(event, openid, wxContext) {
  const collections = [];
  for (const name of COLLECTIONS) {
    collections.push(await ensureCollection(name));
  }
  const schema = await upsertSchema(openid);
  const user = await ensureUser(openid, event || {}, wxContext);
  return success({ schemaVersion: SCHEMA_VERSION, collections, schema, user });
}

async function handleUpdateProfile(event, openid) {
  const existed = await getUser(openid);
  if (!existed) return fail(404, "user not found");

  const profile = buildProfile(event, undefined);
  const updateData = { updatedAt: db.serverDate() };
  Object.keys(profile).forEach((key) => {
    if (profile[key] !== undefined) updateData[key] = profile[key];
  });
  ["allowDiaryAI", "allowNoteAI", "allowRecordAI", "allowReportAI"].forEach((key) => {
    if (event[key] !== undefined) updateData[key] = !!event[key];
  });
  if (event.profileCompleted !== undefined) updateData.profileCompleted = !!event.profileCompleted;
  if (event.theme !== undefined) updateData.theme = cleanText(event.theme, 30);

  await db.collection("users").doc(existed._id).update({ data: updateData });
  return success({ id: existed._id, updated: true, user: Object.assign({}, existed, updateData) });
}

async function handleGetProfile(openid) {
  const user = await getUser(openid);
  if (!user) return fail(404, "user not found");
  const goals = await getUserGoals(openid);
  return success({ user, goals });
}

exports.main = async (event) => {
  const action = event && event.action;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) return fail(401, "login required");

  try {
    switch (action) {
      case "login":
        return await handleLogin(event, openid, wxContext);
      case "init":
        return await handleInit(event, openid, wxContext);
      case "updateProfile":
        return await handleUpdateProfile(event, openid);
      case "getProfile":
        return await handleGetProfile(openid);
      default:
        return fail(404, `unknown action: ${action || ""}`);
    }
  } catch (error) {
    console.error("userService error", action, error);
    return fail(500, "server error");
  }
};
