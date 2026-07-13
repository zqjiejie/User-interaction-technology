const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function success(data) {
  return { code: 0, message: "success", data };
}

function fail(code, message) {
  return { code, message, data: null };
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

async function findOwnNote(openid, id, clientId) {
  if (id) {
    const byDoc = await db.collection("notes").doc(id).get().catch(() => null);
    if (byDoc && byDoc.data && byDoc.data.openid === openid) return byDoc.data;
  }
  if (clientId) {
    const byClient = await db.collection("notes").where({ openid, clientId }).limit(1).get();
    return byClient.data[0] || null;
  }
  return null;
}

async function handleCreate(event, openid) {
  const date = event.date || event.dateKey;
  if (!isDateKey(date)) return fail(400, "valid date is required");

  const content = String(event.content || "").slice(0, 5000);
  const assets = Array.isArray(event.assets || event.attachments) ? (event.assets || event.attachments).slice(0, 20) : [];
  if (!content && !assets.length) return fail(400, "content or assets is required");

  const type = ["diary", "idea", "attachment", "scan", "audio", "boundless"].includes(event.type) ? event.type : "boundless";
  const clientId = String(event.clientId || event.id || "").slice(0, 80);
  const now = db.serverDate();
  const payload = {
    openid,
    userId: openid,
    date,
    type,
    clientId,
    content,
    assets,
    tags: Array.isArray(event.tags) ? event.tags.slice(0, 12) : [],
    visibleToAI: event.visibleToAI === true,
    updatedAt: now
  };

  const existed = await findOwnNote(openid, event._id || event.id, clientId);
  if (existed) {
    await db.collection("notes").doc(existed._id).update({ data: payload });
    return success({ id: existed._id, clientId, updated: true });
  }

  const res = await db.collection("notes").add({
    data: Object.assign({}, payload, { createdAt: now })
  });
  return success({ id: res._id, clientId, created: true });
}

async function handleDelete(event, openid) {
  const id = String(event.id || event._id || "").trim();
  const clientId = String(event.clientId || "").trim();
  if (!id && !clientId) return fail(400, "id or clientId is required");

  const target = await findOwnNote(openid, id, clientId);
  if (!target) return fail(404, "note not found");

  await db.collection("notes").doc(target._id).remove();
  return success({ id: target._id, clientId: target.clientId || clientId, deleted: true });
}

async function handleListByDate(event, openid) {
  const date = event.date || event.dateKey;
  if (!isDateKey(date)) return fail(400, "valid date is required");

  const res = await db.collection("notes")
    .where({ openid, date })
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();

  return success({
    date,
    notes: (res.data || []).map((item) => ({
      id: item._id,
      clientId: item.clientId || "",
      date: item.date,
      type: item.type,
      content: item.content || "",
      assets: item.assets || [],
      attachments: item.assets || [],
      tags: item.tags || [],
      visibleToAI: item.visibleToAI === true,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  });
}

async function handleList(event, openid) {
  const limit = Math.min(100, Math.max(1, Number(event.limit || 80)));
  const res = await db.collection("notes")
    .where({ openid, type: "boundless" })
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();

  return success({
    notes: (res.data || []).map((item) => ({
      id: item._id,
      _id: item._id,
      clientId: item.clientId || "",
      date: item.date,
      type: item.type,
      content: item.content || "",
      assets: item.assets || [],
      attachments: item.assets || [],
      tags: item.tags || [],
      visibleToAI: item.visibleToAI === true,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  });
}

exports.main = async (event) => {
  const action = event && event.action;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) return fail(401, "login required");

  try {
    switch (action) {
      case "create":
        return await handleCreate(event, openid);
      case "delete":
        return await handleDelete(event, openid);
      case "listByDate":
        return await handleListByDate(event, openid);
      case "list":
        return await handleList(event, openid);
      default:
        return fail(404, `unknown action: ${action || ""}`);
    }
  } catch (error) {
    console.error("noteService error", action, error);
    return fail(500, "server error");
  }
};
