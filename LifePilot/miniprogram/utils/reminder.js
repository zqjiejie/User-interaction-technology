const { KEYS, readList, writeList } = require("./storage");
const { SCHEDULE_REMINDER_TEMPLATE_ID } = require("./reminderConfig");
const { isScheduleOnDate } = require("./scheduleIndex");

const SHOWN_KEY = "lifepilot_local_reminder_shown";

function pad(value) {
  return Number(value) < 10 ? `0${Number(value)}` : `${Number(value)}`;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function scheduleId(schedule) {
  return String((schedule && (schedule.clientId || schedule.id || schedule._id || schedule.cloudId)) || "").trim();
}

function getScheduleDateKey(schedule) {
  return schedule.occurrenceDateKey || schedule.startDateKey || schedule.dateKey || schedule.date || "";
}

function getScheduleStartAt(schedule, occurrenceDateKey) {
  const dateKey = occurrenceDateKey || getScheduleDateKey(schedule);
  if (!isDateKey(dateKey)) return null;
  if (schedule.allDay || schedule.isAllDay) return new Date(`${dateKey}T00:00:00+08:00`);
  const time = schedule.startTime || schedule.start || "";
  if (!/^\d{2}:\d{2}$/.test(String(time))) return null;
  return new Date(`${dateKey}T${time}:00+08:00`);
}

function minutesFromReminder(value) {
  if (value && typeof value === "object") {
    if (value.enabled === false) return null;
    const minutes = Number(value.minutesBefore);
    return Number.isFinite(minutes) ? Math.max(0, minutes) : null;
  }
  const text = String(value || "").trim();
  if (!text || /none|no|不提醒/.test(text)) return null;
  if (/30/.test(text)) return 30;
  if (/10/.test(text)) return 10;
  if (/1|小时|hour/i.test(text)) return 60;
  return 0;
}

function reminderLabel(value) {
  if (value && typeof value === "object") {
    if (!value.enabled) return "不提醒";
    const minutes = Number(value.minutesBefore || 0);
    if (minutes <= 0) return "开始时";
    if (minutes === 10) return "提前 10 分钟";
    if (minutes === 30) return "提前 30 分钟";
    if (minutes === 60) return "提前 1 小时";
    return `提前 ${minutes} 分钟`;
  }
  return String(value || "不提醒");
}

function computeRemindAt(schedule, occurrenceDateKey) {
  const source = schedule.reminder !== undefined ? schedule.reminder : schedule.reminderMinutes || schedule.remindBefore;
  const minutes = minutesFromReminder(source);
  if (minutes === null) return "";
  const startAt = getScheduleStartAt(schedule, occurrenceDateKey);
  if (!startAt) return "";
  return new Date(startAt.getTime() - minutes * 60000).toISOString();
}

function normalizeReminder(schedule, patch) {
  const source = schedule.reminder !== undefined ? schedule.reminder : schedule.reminderMinutes || schedule.remindBefore;
  const previous = source && typeof source === "object" ? source : {};
  const minutes = minutesFromReminder(source);
  const enabled = minutes !== null;
  const remindAt = enabled ? computeRemindAt(schedule) : "";
  const changed = previous.remindAt && previous.remindAt !== remindAt;
  return Object.assign({}, previous, patch || {}, {
    enabled,
    minutesBefore: enabled ? minutes : null,
    remindAt,
    sent: enabled ? (changed ? false : !!previous.sent) : false,
    subscribed: enabled ? !!((patch && patch.subscribed) || previous.subscribed) : false,
    templateId: enabled ? ((patch && patch.templateId) || previous.templateId || SCHEDULE_REMINDER_TEMPLATE_ID || "") : "",
    label: reminderLabel(enabled ? { enabled, minutesBefore: minutes } : { enabled: false })
  });
}

function withNormalizedReminder(schedule, patch) {
  const next = Object.assign({}, schedule);
  next.reminder = normalizeReminder(next, patch);
  next.reminderLabel = next.reminder.label;
  return next;
}

function requestScheduleReminderSubscription(schedule) {
  const normalized = normalizeReminder(schedule);
  if (!normalized.enabled) return Promise.resolve({ subscribed: false, templateId: "", skipped: true });
  if (!SCHEDULE_REMINDER_TEMPLATE_ID) {
    console.warn("SCHEDULE_REMINDER_TEMPLATE_ID is not configured");
    return Promise.resolve({ subscribed: false, templateId: "", skipped: true, missingTemplate: true });
  }
  if (!wx.requestSubscribeMessage) {
    console.warn("wx.requestSubscribeMessage is not available");
    return Promise.resolve({ subscribed: false, templateId: SCHEDULE_REMINDER_TEMPLATE_ID, unavailable: true });
  }
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [SCHEDULE_REMINDER_TEMPLATE_ID],
      success(res) {
        resolve({
          subscribed: res[SCHEDULE_REMINDER_TEMPLATE_ID] === "accept",
          templateId: SCHEDULE_REMINDER_TEMPLATE_ID,
          result: res
        });
      },
      fail(error) {
        console.warn("requestSubscribeMessage failed", error);
        resolve({ subscribed: false, templateId: SCHEDULE_REMINDER_TEMPLATE_ID, error });
      }
    });
  });
}

function readShownMap() {
  return wx.getStorageSync(SHOWN_KEY) || {};
}

function reminderKey(schedule, occurrenceDateKey) {
  const reminder = normalizeReminder(schedule);
  return `${scheduleId(schedule)}|${occurrenceDateKey || getScheduleDateKey(schedule)}|${reminder.remindAt || ""}`;
}

function markLocalReminderShown(schedule, occurrenceDateKey) {
  const key = reminderKey(schedule, occurrenceDateKey);
  if (!key) return;
  const shown = readShownMap();
  shown[key] = new Date().toISOString();
  wx.setStorageSync(SHOWN_KEY, shown);
}

function isLocalReminderShown(schedule, occurrenceDateKey) {
  return !!readShownMap()[reminderKey(schedule, occurrenceDateKey)];
}

function findDueLocalReminders(schedules) {
  const now = Date.now();
  const currentDate = toDateKey(new Date());
  const result = [];
  (schedules || []).forEach((schedule) => {
    if (!schedule || schedule.isDeleted) return;
    if (!isScheduleOnDate(schedule, currentDate)) return;
    const reminder = normalizeReminder(schedule);
    const occurrenceRemindAt = computeRemindAt(schedule, currentDate);
    const occurrence = Object.assign({}, schedule, {
      reminder: Object.assign({}, reminder, { remindAt: occurrenceRemindAt })
    });
    if (!reminder.enabled || !occurrenceRemindAt || isLocalReminderShown(occurrence, currentDate)) return;
    const remindTime = new Date(occurrenceRemindAt).getTime();
    const startAt = getScheduleStartAt(schedule, currentDate);
    if (!startAt || Number.isNaN(remindTime)) return;
    if (remindTime <= now && startAt.getTime() >= now) {
      result.push(Object.assign({}, occurrence, {
        occurrenceDateKey: currentDate,
        minutesUntilStart: Math.max(0, Math.round((startAt.getTime() - now) / 60000))
      }));
    }
  });
  return result;
}

function showDueLocalReminder() {
  try {
    const due = findDueLocalReminders(readList(KEYS.schedules, []))[0];
    if (!due) return false;
    const title = due.title || due.name || due.courseName || "日程";
    wx.showModal({
      title: "日程提醒",
      content: `${title} 将在 ${due.minutesUntilStart} 分钟后开始`,
      confirmText: "知道了",
      showCancel: false,
      success() {
        markLocalReminderShown(due, due.occurrenceDateKey);
      }
    });
    return true;
  } catch (error) {
    console.warn("show local reminder failed", error);
    return false;
  }
}

function updateStoredReminder(id, reminderPatch) {
  const list = readList(KEYS.schedules, []);
  const next = list.map((item) => {
    const itemId = scheduleId(item);
    if (itemId !== String(id || "")) return item;
    return withNormalizedReminder(item, reminderPatch);
  });
  writeList(KEYS.schedules, next);
  return next;
}

module.exports = {
  SCHEDULE_REMINDER_TEMPLATE_ID,
  computeRemindAt,
  normalizeReminder,
  withNormalizedReminder,
  requestScheduleReminderSubscription,
  findDueLocalReminders,
  markLocalReminderShown,
  showDueLocalReminder,
  updateStoredReminder,
  reminderLabel
};
