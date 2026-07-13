const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function success(data) {
  return { code: 0, message: "success", data };
}

function fail(code, message) {
  return { code, message, data: null };
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeReminder(value) {
  if (!value || typeof value !== "object") return value || "none";
  const reminder = Object.assign({}, value);
  reminder.enabled = !!reminder.enabled;
  reminder.minutesBefore = reminder.enabled ? Number(reminder.minutesBefore || 0) : null;
  reminder.remindAt = reminder.enabled ? cleanText(reminder.remindAt, 40) : "";
  reminder.sent = !!reminder.sent;
  reminder.subscribed = !!reminder.subscribed;
  reminder.templateId = cleanText(reminder.templateId, 80);
  reminder.lastSentAt = cleanText(reminder.lastSentAt, 40);
  reminder.lastCheckedAt = cleanText(reminder.lastCheckedAt, 40);
  reminder.label = cleanText(reminder.label, 40);
  return reminder;
}

function readEnv(name) {
  return process.env[name] || "";
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDate(dateKey) {
  const parts = dateKey.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function toDateTime(dateKey, time, allDay) {
  if (!isDateKey(dateKey)) return null;
  return new Date(`${dateKey}T${allDay ? "00:00" : (time || "00:00")}:00+08:00`);
}

function normalizeType(value) {
  const allowed = ["course", "task", "exam", "meeting", "habit", "personal", "schedule"];
  return allowed.includes(value) ? value : "schedule";
}

function requestJson(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        let payload = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch (error) {
          reject(new Error("invalid DeepSeek response"));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error((payload && payload.error && payload.error.message) || `DeepSeek status ${res.statusCode}`));
          return;
        }
        resolve(payload);
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("DeepSeek request timeout"));
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

function extractJsonObject(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("empty DeepSeek content");
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

function normalizeParsedSchedule(parsed) {
  const allowedTypes = ["meeting", "task", "course", "reminder", "other"];
  const reminder = parsed.reminder && typeof parsed.reminder === "object" ? parsed.reminder : {};
  const repeat = parsed.repeat && typeof parsed.repeat === "object" ? parsed.repeat : {};
  return {
    title: cleanText(parsed.title, 80),
    type: allowedTypes.includes(parsed.type) ? parsed.type : "other",
    date: isDateKey(parsed.date) ? parsed.date : null,
    startTime: /^\d{2}:\d{2}$/.test(String(parsed.startTime || "")) ? parsed.startTime : null,
    endTime: /^\d{2}:\d{2}$/.test(String(parsed.endTime || "")) ? parsed.endTime : null,
    location: cleanText(parsed.location, 120),
    participants: Array.isArray(parsed.participants) ? parsed.participants.map((item) => cleanText(item, 30)).filter(Boolean) : [],
    description: cleanText(parsed.description, 1000),
    reminder: {
      enabled: !!reminder.enabled,
      minutesBefore: reminder.minutesBefore === null || reminder.minutesBefore === undefined ? null : Number(reminder.minutesBefore)
    },
    repeat: {
      enabled: !!repeat.enabled,
      rule: cleanText(repeat.rule, 30)
    },
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields.map((item) => cleanText(item, 40)).filter(Boolean) : []
  };
}

async function findOwnSchedule(openid, id) {
  if (!id) return null;
  const byDoc = await db.collection("schedules").doc(id).get().catch(() => null);
  if (byDoc && byDoc.data && byDoc.data.openid === openid) return byDoc.data;
  const byClient = await db.collection("schedules").where({ openid, clientId: id }).limit(1).get();
  return byClient.data[0] || null;
}

async function handleCreate(event, openid) {
  const title = cleanText(event.title, 80);
  if (!title) return fail(400, "title is required");

  const startDateKey = event.startDateKey || event.dateKey || event.date;
  const endDateKey = event.endDateKey || startDateKey;
  if (!isDateKey(startDateKey) || !isDateKey(endDateKey)) {
    return fail(400, "valid startDateKey and endDateKey are required");
  }

  const allDay = !!(event.isAllDay || event.allDay);
  const startAt = toDateTime(startDateKey, event.startTime, allDay);
  const endAt = toDateTime(endDateKey, event.endTime, allDay);
  if (!allDay && startAt && endAt && endAt.getTime() < startAt.getTime()) {
    return fail(400, "end time cannot be earlier than start time");
  }

  const parts = startDateKey.split("-").map(Number);
  const now = db.serverDate();
  const payload = {
    openid,
    userId: openid,
    clientId: cleanText(event.clientId || event.id, 80),
    title,
    type: normalizeType(event.type),
    status: event.status || "todo",
    priority: event.priority || "medium",
    location: cleanText(event.location, 120),
    date: startDateKey,
    dateKey: startDateKey,
    year: parts[0],
    month: parts[1],
    day: parts[2],
    startDateKey,
    endDateKey,
    startTime: allDay ? "" : cleanText(event.startTime, 10),
    endTime: allDay ? "" : cleanText(event.endTime, 10),
    startAt,
    endAt,
    isAllDay: allDay,
    allDay,
    repeatRule: event.repeatRule && typeof event.repeatRule === "object" ? event.repeatRule : { type: "never" },
    excludedDates: Array.isArray(event.excludedDates) ? event.excludedDates : [],
    reminder: normalizeReminder(event.reminder || event.remindAt || "none"),
    reminderLabel: cleanText(event.reminderLabel || (event.reminder && event.reminder.label), 40),
    url: cleanText(event.url, 300),
    note: cleanText(event.note || event.longText, 1000),
    source: event.source || "manual",
    color: cleanText(event.color || "#ef4444", 30),
    focusRequired: !!event.focusRequired,
    focusMinutes: Number(event.focusMinutes || 0),
    isCountdown: !!event.isCountdown,
    isDeleted: false,
    createdAt: now,
    updatedAt: now
  };

  const existed = payload.clientId
    ? await db.collection("schedules").where({ openid, clientId: payload.clientId }).limit(1).get()
    : { data: [] };
  if (existed.data.length) {
    await db.collection("schedules").doc(existed.data[0]._id).update({ data: payload });
    return success({ id: existed.data[0]._id, schedule: Object.assign({ _id: existed.data[0]._id }, payload), updated: true });
  }

  const res = await db.collection("schedules").add({ data: payload });
  return success({ id: res._id, schedule: Object.assign({ _id: res._id }, payload), created: true });
}

async function handleUpdate(event, openid) {
  const id = String(event.id || event._id || event.clientId || "").trim();
  if (!id) return fail(400, "id is required");

  const existed = await findOwnSchedule(openid, id);
  if (!existed) return fail(404, "schedule not found");

  const updates = { updatedAt: db.serverDate() };
  const allowedStatus = ["todo", "doing", "done", "postponed", "pending"];
  const allowedPriority = ["low", "medium", "high"];

  if (event.status !== undefined) {
    if (!allowedStatus.includes(event.status)) return fail(400, "invalid status");
    updates.status = event.status;
    if (event.status === "done") updates.completedAt = db.serverDate();
  }
  if (event.priority !== undefined) {
    if (!allowedPriority.includes(event.priority)) return fail(400, "invalid priority");
    updates.priority = event.priority;
  }
  if (event.title !== undefined) updates.title = cleanText(event.title, 80);
  if (event.location !== undefined) updates.location = cleanText(event.location, 120);
  if (event.note !== undefined) updates.note = cleanText(event.note, 1000);
  if (event.startDateKey !== undefined || event.dateKey !== undefined || event.date !== undefined) {
    const startDateKey = event.startDateKey || event.dateKey || event.date;
    if (!isDateKey(startDateKey)) return fail(400, "valid startDateKey is required");
    const parts = startDateKey.split("-").map(Number);
    updates.date = startDateKey;
    updates.dateKey = startDateKey;
    updates.startDateKey = startDateKey;
    updates.endDateKey = startDateKey;
    updates.year = parts[0];
    updates.month = parts[1];
    updates.day = parts[2];
  }
  if (event.repeatRule !== undefined && event.repeatRule && typeof event.repeatRule === "object") {
    updates.repeatRule = event.repeatRule;
  }
  if (event.excludedDates !== undefined) {
    updates.excludedDates = Array.isArray(event.excludedDates) ? event.excludedDates : [];
  }
  if (event.startTime !== undefined) updates.startTime = cleanText(event.startTime, 10);
  if (event.endTime !== undefined) updates.endTime = cleanText(event.endTime, 10);
  if (event.reminder !== undefined || event.remindAt !== undefined) {
    updates.reminder = normalizeReminder(event.reminder || event.remindAt || "none");
    updates.reminderLabel = cleanText(event.reminderLabel || (event.reminder && event.reminder.label), 40);
  }
  if (event.isDeleted !== undefined) updates.isDeleted = !!event.isDeleted;
  if (event.focusMinutesDelta !== undefined) updates.focusMinutes = _.inc(Number(event.focusMinutesDelta) || 0);

  await db.collection("schedules").doc(existed._id).update({ data: updates });
  return success({ id: existed._id, updated: true });
}

async function handleDelete(event, openid) {
  const id = String(event.id || event._id || event.clientId || "").trim();
  if (!id) return fail(400, "id is required");

  const existed = await findOwnSchedule(openid, id);
  if (!existed) return fail(404, "schedule not found");

  await db.collection("schedules").doc(existed._id).update({
    data: { isDeleted: true, updatedAt: db.serverDate() }
  });
  return success({ id: existed._id, deleted: true });
}

function isRepeatHit(item, dateKey) {
  const rule = item.repeatRule || {};
  if (!rule.type || rule.type === "never") return false;
  if (Array.isArray(item.excludedDates) && item.excludedDates.includes(dateKey)) return false;
  const startKey = item.startDateKey || item.dateKey;
  if (!isDateKey(startKey) || dateKey < startKey) return false;
  if (rule.endDate && dateKey > rule.endDate) return false;

  const target = toDate(dateKey);
  const start = toDate(startKey);
  const diffDays = Math.floor((target - start) / 86400000);
  if (diffDays < 0) return false;
  if (rule.type === "daily") return diffDays % Number(rule.interval || 1) === 0;
  if (rule.type === "weekly" || rule.type === "biweekly") {
    const interval = rule.type === "biweekly" ? 2 : Number(rule.interval || 1);
    return diffDays % (7 * interval) === 0;
  }
  if (rule.type === "monthly") return target.getDate() === start.getDate();
  if (rule.type === "yearly") return target.getMonth() === start.getMonth() && target.getDate() === start.getDate();
  return false;
}

function mapSchedule(item, source) {
  const searchIndexId = item._id || item.clientId || "";
  const startDateKey = item.startDateKey || item.dateKey || item.date || "";
  const endDateKey = item.endDateKey || startDateKey;
  return {
    id: item.clientId || item._id,
    cloudId: item._id,
    _id: item._id,
    clientId: item.clientId || "",
    searchIndexId,
    title: item.title || item.courseName || item.name || "Untitled",
    type: item.type || source,
    status: item.status || "todo",
    priority: item.priority || "medium",
    date: startDateKey,
    dateKey: startDateKey,
    startDateKey,
    endDateKey,
    repeatRule: item.repeatRule || { type: "never", interval: 1, endDate: "" },
    excludedDates: Array.isArray(item.excludedDates) ? item.excludedDates : [],
    timeText: item.isAllDay || item.allDay ? "All day" : `${item.startTime || ""}${item.endTime ? ` - ${item.endTime}` : ""}`,
    startTime: item.startTime || "",
    endTime: item.endTime || "",
    location: item.location || item.classroom || "",
    reminder: item.reminder || "none",
    reminderLabel: item.reminderLabel || "",
    color: item.color || "#ef4444",
    source
  };
}

async function handleListByDate(event, openid) {
  const date = event.date || event.dateKey;
  if (!isDateKey(date)) return fail(400, "valid date is required");

  const direct = await db.collection("schedules")
    .where({ openid, dateKey: date, isDeleted: false })
    .orderBy("startTime", "asc")
    .get();
  const repeatCandidates = await db.collection("schedules")
    .where({ openid, isDeleted: false, dateKey: _.lt(date) })
    .limit(100)
    .get();
  const courses = await db.collection("courses")
    .where({ openid, dateKey: date, isDeleted: false })
    .orderBy("startTime", "asc")
    .get()
    .catch(() => ({ data: [] }));

  const repeated = (repeatCandidates.data || []).filter((item) => isRepeatHit(item, date));
  const items = (direct.data || [])
    .concat(repeated)
    .concat(courses.data || [])
    .map((item) => mapSchedule(item, item.courseName ? "course" : "schedule"))
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  return success(items);
}

async function handleListByMonth(event, openid) {
  const year = Number(event.year);
  const month = Number(event.month);
  if (!year || month < 1 || month > 12) return fail(400, "valid year and month are required");
  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;

  const schedules = await db.collection("schedules")
    .where({ openid, year, month, isDeleted: false })
    .orderBy("day", "asc")
    .get();
  const repeatCandidates = await db.collection("schedules")
    .where({ openid, isDeleted: false, dateKey: _.lte(monthEnd) })
    .limit(200)
    .get();
  const courses = await db.collection("courses")
    .where({ openid, year, month, isDeleted: false })
    .orderBy("day", "asc")
    .get()
    .catch(() => ({ data: [] }));

  const daysMap = {};
  function pushDayItem(item, date, source) {
    const startDateKey = item.startDateKey || item.dateKey || item.date || "";
    if (!daysMap[date]) daysMap[date] = { date, count: 0, items: [] };
    daysMap[date].count += 1;
    daysMap[date].items.push({
      id: item._id,
      _id: item._id,
      clientId: item.clientId || "",
      cloudId: item._id,
      title: item.title || item.courseName || item.name || "Untitled",
      type: item.type || source || (item.courseName ? "course" : "schedule"),
      dateKey: startDateKey,
      startDateKey,
      endDateKey: item.endDateKey || startDateKey,
      occurrenceDateKey: date,
      repeatRule: item.repeatRule || { type: "never", interval: 1, endDate: "" },
      excludedDates: Array.isArray(item.excludedDates) ? item.excludedDates : [],
      color: item.color || "#ef4444",
      status: item.status || "todo",
      startTime: item.startTime || "",
      endTime: item.endTime || "",
      reminder: item.reminder || "none",
      reminderLabel: item.reminderLabel || ""
    });
  }

  const scheduleById = {};
  (schedules.data || []).concat(repeatCandidates.data || []).forEach((item) => {
    scheduleById[item._id] = item;
  });

  Object.keys(scheduleById).forEach((id) => {
    const item = scheduleById[id];
    for (let day = 1; day <= new Date(year, month, 0).getDate(); day += 1) {
      const date = `${year}-${pad(month)}-${pad(day)}`;
      if (date < monthStart || date > monthEnd) continue;
      const directDate = item.dateKey || `${item.year}-${pad(Number(item.month))}-${pad(Number(item.day))}`;
      if (directDate === date || isRepeatHit(item, date)) {
        pushDayItem(item, date, "schedule");
      }
    }
  });

  (courses.data || []).forEach((item) => {
    const date = item.dateKey || `${year}-${pad(month)}-${pad(item.day)}`;
    pushDayItem(item, date, "course");
  });

  return success({ days: Object.keys(daysMap).sort().map((date) => daysMap[date]) });
}

function normalizeKeyword(value) {
  return String(value || "").trim().slice(0, 40);
}

function buildMatcher(keyword) {
  return db.RegExp({
    regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    options: "i"
  });
}

async function searchCollection(openid, collectionName, keyword, source) {
  const matcher = buildMatcher(keyword);
  const conditions = [
    { openid, title: matcher },
    { openid, name: matcher },
    { openid, courseName: matcher },
    { openid, type: matcher },
    { openid, location: matcher },
    { openid, classroom: matcher },
    { openid, date: matcher },
    { openid, dateKey: matcher },
    { openid, note: matcher }
  ];

  try {
    const res = await db.collection(collectionName).where(_.or(conditions)).limit(20).get();
    return (res.data || [])
      .filter((item) => !item.isDeleted)
      .map((item) => mapSchedule(item, source));
  } catch (error) {
    console.error(`search ${collectionName} failed`, error);
    return [];
  }
}

async function handleSearch(event, openid) {
  const keyword = normalizeKeyword(event.keyword);
  if (!keyword) return success({ keyword, count: 0, results: [] });
  const results = (await searchCollection(openid, "schedules", keyword, "schedule"))
    .concat(await searchCollection(openid, "courses", keyword, "course"));
  return success({ keyword, count: results.length, results });
}

async function handleParse(event) {
  const text = String(event.text || event.voiceText || "").trim().slice(0, 1000);
  if (!text) return fail(400, "text is required");
  const apiKey = readEnv("DEEPSEEK_API_KEY");
  if (!apiKey) return fail(500, "DEEPSEEK_API_KEY is not configured");

  const currentDate = isDateKey(event.currentDate) ? event.currentDate : toDateKey(new Date());
  const systemPrompt = "你是一个日程解析助手。你的任务是把用户输入的一句话日程描述解析成标准 JSON。你只能返回 JSON，不能返回 Markdown、解释文字或多余内容。如果字段无法确定，请填 null、空字符串或空数组，并在 missingFields 中说明。日期必须转换为 YYYY-MM-DD，时间必须转换为 HH:mm。请基于当前日期解析“今天、明天、后天、下周一、下个月”等相对时间。不要编造用户没有提供或无法合理推断的信息。";
  const userPrompt = `当前日期：${currentDate}
用户输入：${text}

请返回以下 JSON 格式：

{
  "title": "",
  "type": "meeting | task | course | reminder | other",
  "date": "",
  "startTime": "",
  "endTime": "",
  "location": "",
  "participants": [],
  "description": "",
  "reminder": {
    "enabled": false,
    "minutesBefore": null
  },
  "repeat": {
    "enabled": false,
    "rule": ""
  },
  "confidence": 0,
  "missingFields": []
}`;

  try {
    const response = await requestJson("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    }, {
      model: event.model || "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    });
    const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
    const parsed = normalizeParsedSchedule(extractJsonObject(content));
    return success(parsed);
  } catch (error) {
    console.error("DeepSeek schedule parse failed", error);
    return fail(500, "解析失败，请手动填写或稍后重试");
  }
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
      case "update":
        return await handleUpdate(event, openid);
      case "delete":
        return await handleDelete(event, openid);
      case "listByDate":
        return await handleListByDate(event, openid);
      case "listByMonth":
        return await handleListByMonth(event, openid);
      case "search":
        return await handleSearch(event, openid);
      case "parse":
        return await handleParse(event, openid);
      default:
        return fail(404, `unknown action: ${action || ""}`);
    }
  } catch (error) {
    console.error("scheduleService error", action, error);
    return fail(500, "server error");
  }
};
