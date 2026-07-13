const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function success(data) {
  return { code: 0, message: "success", data };
}

function fail(code, message) {
  return { code, message, data: null };
}

function cleanText(value, maxLength, fallback) {
  const text = String(value || fallback || "").trim();
  return text.slice(0, maxLength);
}

function scheduleId(item) {
  return item.clientId || item._id || item.id || "";
}

function startTimeText(item) {
  const date = item.startDateKey || item.dateKey || item.date || "";
  const time = item.allDay || item.isAllDay ? "全天" : (item.startTime || "");
  return `${date} ${time}`.trim();
}

function pageForSchedule(item) {
  const id = scheduleId(item);
  const dateKey = item.startDateKey || item.dateKey || item.date || "";
  return `/pages/scheduleAdd/scheduleAdd?id=${encodeURIComponent(id)}&mode=edit&dateKey=${encodeURIComponent(dateKey)}`;
}

function templateData(item) {
  return {
    thing1: { value: cleanText(item.title || item.name || item.courseName, 20, "日程提醒") },
    time2: { value: cleanText(startTimeText(item), 20, "即将开始") },
    thing3: { value: cleanText(item.location, 20, "未填写") },
    thing4: { value: cleanText(item.note || item.description, 20, "日程即将开始") }
  };
}

function isDue(item, now, windowStart) {
  const reminder = item && item.reminder;
  if (!reminder || typeof reminder !== "object") return false;
  if (!reminder.enabled || reminder.sent || !reminder.subscribed) return false;
  if (!reminder.templateId || !reminder.remindAt) return false;
  const remindAt = new Date(reminder.remindAt).getTime();
  if (Number.isNaN(remindAt)) return false;
  return remindAt <= now && remindAt >= windowStart;
}

async function sendScheduleReminder(item) {
  const reminder = item.reminder || {};
  await cloud.openapi.subscribeMessage.send({
    touser: item.openid,
    templateId: reminder.templateId,
    page: pageForSchedule(item),
    data: templateData(item)
  });
}

async function markReminderSent(item, patch) {
  await db.collection("schedules").doc(item._id).update({
    data: {
      reminder: Object.assign({}, item.reminder || {}, patch || {})
    }
  });
}

async function scanDueReminders() {
  const now = Date.now();
  const windowStart = now - 10 * 60000;
  const res = await db.collection("schedules")
    .where({ isDeleted: false })
    .limit(100)
    .get();
  const due = (res.data || []).filter((item) => isDue(item, now, windowStart));
  const sent = [];
  const failed = [];

  for (const item of due) {
    try {
      await sendScheduleReminder(item);
      const lastSentAt = new Date().toISOString();
      await markReminderSent(item, {
        sent: true,
        lastSentAt,
        lastCheckedAt: lastSentAt,
        lastError: ""
      });
      sent.push(item._id);
    } catch (error) {
      console.error("send schedule reminder failed", item._id, error);
      failed.push(item._id);
      await markReminderSent(item, {
        lastCheckedAt: new Date().toISOString(),
        lastError: cleanText(error.message, 120, "send failed")
      }).catch(() => {});
    }
  }

  return success({ scanned: res.data.length, due: due.length, sent, failed });
}

async function markReminderSentAction(event, openid) {
  const id = String(event.id || event._id || event.clientId || "").trim();
  if (!id) return fail(400, "id is required");
  const query = await db.collection("schedules").where({ openid, clientId: id }).limit(1).get();
  const item = query.data[0] || await db.collection("schedules").doc(id).get().then((res) => res.data).catch(() => null);
  if (!item || item.openid !== openid) return fail(404, "schedule not found");
  await markReminderSent(item, {
    sent: true,
    lastSentAt: new Date().toISOString()
  });
  return success({ id: item._id, sent: true });
}

exports.main = async (event) => {
  const action = (event && event.action) || "scanDueReminders";
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || "";

  try {
    switch (action) {
      case "scanDueReminders":
      case "timer":
        return await scanDueReminders();
      case "markReminderSent":
        if (!openid) return fail(401, "login required");
        return await markReminderSentAction(event, openid);
      default:
        return fail(404, `unknown action: ${action}`);
    }
  } catch (error) {
    console.error("reminderService error", action, error);
    return fail(500, "server error");
  }
};
