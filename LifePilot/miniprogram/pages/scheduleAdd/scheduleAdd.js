const { KEYS, appendItem, getItemById, removeItem, updateItem, readList, writeList } = require("../../utils/storage");
const { api } = require("../../utils/cloud");
const { getSafeAreaLayout } = require("../../utils/safeArea");
const {
  withNormalizedReminder,
  requestScheduleReminderSubscription,
  reminderLabel
} = require("../../utils/reminder");

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(dateKey, days) {
  const parts = dateKey.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function daysBetween(startDateKey, endDateKey) {
  const start = toDateTime(startDateKey, "00:00");
  const end = toDateTime(endDateKey, "00:00");
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function shiftDateByDays(dateKey, days) {
  return addDays(dateKey, days || 0);
}

function formatDateLabel(dateKey) {
  const parts = (dateKey || toDateKey(new Date())).split("-").map(Number);
  return `${parts[0]}年${parts[1]}月${parts[2]}日`;
}

function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roundUpToHalfHour(date) {
  const rounded = new Date(date.getTime());
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const nextMinutes = minutes === 0 || minutes === 30 ? minutes : minutes < 30 ? 30 : 60;
  if (nextMinutes === 60) {
    rounded.setHours(rounded.getHours() + 1, 0, 0, 0);
  } else {
    rounded.setMinutes(nextMinutes, 0, 0);
  }
  return rounded;
}

function toDateTime(dateKey, time) {
  if (!dateKey || !time) return null;
  const dateParts = dateKey.split("-").map(Number);
  const timeParts = time.split(":").map(Number);
  if (dateParts.length !== 3 || timeParts.length !== 2) return null;
  return new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1], 0, 0);
}

function addHoursToDateTime(dateKey, time, hours) {
  const date = toDateTime(dateKey, time);
  date.setHours(date.getHours() + hours);
  return {
    dateKey: toDateKey(date),
    time: formatTime(date)
  };
}

function isEndAfterStart(startDateKey, startTime, endDateKey, endTime) {
  const startAt = toDateTime(startDateKey, startTime);
  const endAt = toDateTime(endDateKey, endTime);
  return !!startAt && !!endAt && endAt.getTime() > startAt.getTime();
}

function getDefaultDateTime(dateKey) {
  const startAt = roundUpToHalfHour(new Date());
  const startDateKey = dateKey || toDateKey(startAt);
  const startTime = formatTime(startAt);
  const end = addHoursToDateTime(startDateKey, startTime, 1);
  return {
    startDateKey,
    startTime,
    endDateKey: end.dateKey,
    endTime: end.time
  };
}

function getEndOneHourAfterStart(startDateKey, startTime) {
  const end = addHoursToDateTime(startDateKey, startTime, 1);
  const endTime = end.dateKey === startDateKey ? end.time : "23:59";
  return {
    endDateKey: startDateKey,
    endDate: formatDateLabel(startDateKey),
    endTime
  };
}

function normalizeSingleDayRange(dateKey) {
  return {
    endDateKey: dateKey,
    endDate: formatDateLabel(dateKey)
  };
}

function createId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

const repeatOptions = [
  { label: "永不重复", value: "never" },
  { label: "每天", value: "daily" },
  { label: "每周", value: "weekly" },
  { label: "每两周", value: "biweekly" },
  { label: "每月", value: "monthly" },
  { label: "每年", value: "yearly" }
];

const repeatLabels = repeatOptions.reduce((result, item) => {
  result[item.value] = item.label;
  return result;
}, {});

const scheduleTypeMap = {
  meeting: "meeting",
  task: "task",
  course: "course",
  reminder: "schedule",
  other: "schedule"
};

const missingFieldLabels = {
  title: "标题",
  type: "类型",
  date: "日期",
  startTime: "开始时间",
  endTime: "结束时间",
  location: "地点",
  participants: "参与人",
  description: "备注",
  reminder: "提醒",
  repeat: "重复"
};

const defaultDateKey = toDateKey(new Date());
const defaultDateTime = getDefaultDateTime(defaultDateKey);
const RECENT_SCHEDULE_KEY = "campusmind_recent_schedule_id";

function findRepeatOption(value) {
  return repeatOptions.find((item) => item.value === value) || repeatOptions[0];
}

function normalizeRepeatRule(rule) {
  const value = String(rule || "").toLowerCase();
  if (["daily", "weekly", "biweekly", "monthly", "yearly"].includes(value)) return value;
  if (value.includes("day") || value.includes("每天")) return "daily";
  if (value.includes("week") || value.includes("每周")) return "weekly";
  if (value.includes("month") || value.includes("每月")) return "monthly";
  if (value.includes("year") || value.includes("每年")) return "yearly";
  return "never";
}

function reminderLabelFromParsed(reminder) {
  if (!reminder || !reminder.enabled) return "不提醒";
  const minutes = Number(reminder.minutesBefore);
  if (!minutes) return "开始时";
  if (minutes <= 10) return "提前 10 分钟";
  if (minutes <= 30) return "提前 30 分钟";
  return "提前 1 小时";
}

function formatMissingFields(fields) {
  return (fields || [])
    .map((field) => missingFieldLabels[field] || field)
    .filter(Boolean)
    .join("、");
}

function formDataFromSchedule(schedule, occurrenceDateKey) {
  const originalStartDateKey = schedule.startDateKey || schedule.dateKey || schedule.date || defaultDateKey;
  const startDateKey = occurrenceDateKey || originalStartDateKey;
  const endDateKey = startDateKey;
  const repeatRule = schedule.repeatRule || {};
  const repeatOption = findRepeatOption(repeatRule.type || "never");
  const repeatEndDateKey = repeatRule.endDate || addDays(originalStartDateKey, 31);
  return {
    title: schedule.title || schedule.name || schedule.courseName || "",
    location: schedule.location || "",
    allDay: !!schedule.allDay,
    startDateKey,
    endDateKey,
    startDate: formatDateLabel(startDateKey),
    endDate: formatDateLabel(endDateKey),
    startTime: schedule.startTime || schedule.start || defaultDateTime.startTime,
    endTime: schedule.endTime || schedule.end || defaultDateTime.endTime,
    hasManualEndTime: true,
    repeatValue: repeatOption.value,
    repeatLabel: repeatOption.label,
    repeatEndDateKey,
    repeatEndDate: formatDateLabel(repeatEndDateKey),
    reminder: reminderLabel(schedule.reminder || schedule.remindAt || "不提醒"),
    url: schedule.url || "",
    note: schedule.note || "",
    longText: schedule.longText || ""
  };
}

function refreshPreviousPage() {
  const pages = getCurrentPages();
  const prevPage = pages[pages.length - 2];
  if (!prevPage) return;
  if (typeof prevPage.setData === "function") {
    prevPage.setData({ swipedId: "" });
  }
  if (typeof prevPage.refreshCalendar === "function") {
    prevPage.refreshCalendar({ skipCloud: true });
  }
  if (typeof prevPage.refreshNotes === "function") {
    prevPage.refreshNotes({ skipCloud: true });
  }
  if (typeof prevPage.loadNotes === "function") {
    prevPage.loadNotes({ skipCloud: true });
  }
}

Page({
  data: {
    title: "",
    location: "",
    allDay: false,
    startDateKey: defaultDateTime.startDateKey,
    endDateKey: defaultDateTime.startDateKey,
    startDate: formatDateLabel(defaultDateTime.startDateKey),
    startTime: defaultDateTime.startTime,
    endDate: formatDateLabel(defaultDateTime.startDateKey),
    endTime: defaultDateTime.endTime,
    hasManualEndTime: false,
    repeatValue: "never",
    repeatLabel: "永不重复",
    repeatEndMode: "指定日期",
    repeatEndDateKey: addDays(defaultDateKey, 31),
    repeatEndDate: formatDateLabel(addDays(defaultDateKey, 31)),
    repeatOptionLabels: repeatOptions.map((item) => item.label),
    reminder: "不提醒",
    reminderOptions: ["不提醒", "开始时", "提前 10 分钟", "提前 30 分钟", "提前 1 小时"],
    url: "",
    note: "",
    longText: "",
    scheduleType: "schedule",
    isParsingSchedule: false,
    isRecognizingVoice: false,
    isRecordingVoice: false,
    parseTip: "",
    missingFields: [],
    formErrorTitle: "",
    formErrorTime: "",
    activeField: "",
    pageMode: "create",
    editId: "",
    editDateKey: "",
    originalStartDateKey: "",
    originalEndDateKey: "",
    isEditingOccurrence: false,
    originalSchedule: null,
    pageTitle: "新增日程",
    actionText: "添加",
    topBarStyle: "",
    leftActionStyle: "",
    rightActionStyle: ""
  },

  onLoad(options) {
    const isEdit = options && options.mode === "edit" && options.id;
    const existing = isEdit ? getItemById(KEYS.schedules, options.id) : null;
    if (isEdit && !existing) {
      wx.showToast({ title: "未找到日程", icon: "none" });
    }
    const todayDateKey = toDateKey(new Date());
    const dateKey = options && (options.startDateKey || options.dateKey) ? options.startDateKey || options.dateKey : todayDateKey;
    const defaults = getDefaultDateTime(dateKey);
    const startTime = options && options.startTime ? options.startTime : defaults.startTime;
    const defaultEnd = getEndOneHourAfterStart(dateKey, startTime);
    const endDateKey = dateKey;
    const endTime = options && options.endTime ? options.endTime : defaultEnd.endTime;
    const repeatEndDateKey = addDays(dateKey, 31);
    const layout = getSafeAreaLayout();
    const nextData = {
      topBarStyle: layout.topBarStyle,
      leftActionStyle: layout.leftActionStyle,
      rightActionStyle: layout.rightActionStyle,
      startDateKey: dateKey,
      endDateKey,
      startDate: formatDateLabel(dateKey),
      startTime,
      endDate: formatDateLabel(endDateKey),
      endTime,
      hasManualEndTime: !!(options && (options.endDateKey || options.endTime)),
      repeatEndDateKey,
      repeatEndDate: formatDateLabel(repeatEndDateKey)
    };
    if (existing) {
      const originalStartDateKey = existing.startDateKey || existing.dateKey || existing.date || dateKey;
      const originalEndDateKey = originalStartDateKey;
      const occurrenceDateKey = options.dateKey || originalStartDateKey;
      Object.assign(nextData, {
        pageMode: "edit",
        editId: options.id,
        editDateKey: occurrenceDateKey,
        originalStartDateKey,
        originalEndDateKey,
        isEditingOccurrence: occurrenceDateKey !== originalStartDateKey,
        originalSchedule: existing,
        pageTitle: "编辑日程",
        actionText: "完成"
      }, formDataFromSchedule(existing, occurrenceDateKey));
    }
    this.setData(nextData);
    this.setupRecorder();
  },

  onUnload() {
    this.unloaded = true;
    if (this.data.isRecordingVoice && wx.getRecorderManager) {
      wx.getRecorderManager().stop();
    }
  },

  updateField(e) {
    const key = e.currentTarget.dataset.key;
    const updates = { [key]: e.detail.value };
    if (key === "title" && String(e.detail.value || "").trim()) updates.formErrorTitle = "";
    this.setData(updates);
  },

  setActiveField(e) {
    const field = e.currentTarget.dataset.field || "";
    if (!field) return;
    this.setData({ activeField: field });
  },

  clearActiveField() {
    this.setData({ activeField: "" });
  },

  onLongTextBlur() {
    this.clearActiveField();
    this.parseLongText();
  },

  setupRecorder() {
    if (!wx.getRecorderManager || this.recorderReady) return;
    this.recorderReady = true;
    const recorder = wx.getRecorderManager();
    recorder.onStop((res) => {
      this.handleVoiceStop(res);
    });
    recorder.onError((error) => {
      console.warn("voice record failed", error);
      this.setData({ isRecordingVoice: false, isRecognizingVoice: false });
      wx.showToast({ title: "录音失败，请重试", icon: "none" });
    });
  },

  getCurrentDateKey() {
    return toDateKey(new Date());
  },

  parseLongText() {
    const text = String(this.data.longText || "").trim();
    if (!text || this.data.isParsingSchedule) return;
    this.parseScheduleText(text);
  },

  parseScheduleText(text) {
    const content = String(text || "").trim();
    if (!content) {
      wx.showToast({ title: "请先输入日程描述", icon: "none" });
      return Promise.resolve(null);
    }
    this.setData({
      isParsingSchedule: true,
      parseTip: "正在解析日程...",
      missingFields: []
    });
    return api.schedule.parse({
      text: content,
      currentDate: this.getCurrentDateKey()
    }).then((res) => {
      const parsed = res && res.data;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("empty parsed schedule");
      }
      this.applyParsedSchedule(parsed);
      return parsed;
    }).catch((error) => {
      console.warn("schedule parse failed", error);
      this.setData({ parseTip: "" });
      wx.showToast({ title: "解析失败，请手动填写或稍后重试", icon: "none" });
      return null;
    }).finally(() => {
      this.setData({ isParsingSchedule: false });
    });
  },

  applyParsedSchedule(parsed) {
    const updates = {};
    const dateKey = parsed.date || parsed.dateKey;
    const startTime = parsed.startTime;
    const endTime = parsed.endTime;
    if (parsed.title) updates.title = parsed.title;
    if (parsed.location) updates.location = parsed.location;
    if (dateKey) {
      updates.startDateKey = dateKey;
      updates.endDateKey = dateKey;
      updates.startDate = formatDateLabel(dateKey);
      updates.endDate = formatDateLabel(dateKey);
    }
    if (startTime) updates.startTime = startTime;
    if (endTime) {
      updates.endTime = endTime;
      updates.hasManualEndTime = true;
    } else if (dateKey || startTime) {
      Object.assign(updates, getEndOneHourAfterStart(dateKey || this.data.startDateKey, startTime || this.data.startTime));
      updates.hasManualEndTime = false;
    }
    if (parsed.type) updates.scheduleType = scheduleTypeMap[parsed.type] || "schedule";
    const repeatValue = parsed.repeat && parsed.repeat.enabled ? normalizeRepeatRule(parsed.repeat.rule) : "never";
    const repeatOption = findRepeatOption(repeatValue);
    updates.repeatValue = repeatOption.value;
    updates.repeatLabel = repeatOption.label;
    updates.reminder = reminderLabelFromParsed(parsed.reminder);

    const noteParts = [];
    if (parsed.description) noteParts.push(parsed.description);
    if (Array.isArray(parsed.participants) && parsed.participants.length) {
      noteParts.push(`参与人：${parsed.participants.join("、")}`);
    }
    if (noteParts.length) updates.note = noteParts.join("\n");

    const missingFields = Array.isArray(parsed.missingFields) ? parsed.missingFields : [];
    const missingText = formatMissingFields(missingFields);
    updates.missingFields = missingFields;
    updates.parseTip = missingText ? `已解析，请补全：${missingText}` : "已解析并填入表单，请确认后保存";
    this.setData(updates);
    wx.showToast({ title: missingText ? "请补充缺失信息" : "已填入表单", icon: "none" });
  },

  toggleAllDay(e) {
    const allDay = e.detail.value;
    const updates = { allDay, formErrorTime: "" };
    if (allDay) {
      updates.endDateKey = this.data.startDateKey;
      updates.endDate = this.data.startDate;
    } else if (!this.data.hasManualEndTime) {
      Object.assign(updates, getEndOneHourAfterStart(this.data.startDateKey, this.data.startTime));
    }
    this.setData(updates);
  },

  adjustInvalidEnd(updates, toastTitle) {
    const nextData = Object.assign({}, this.data, updates);
    nextData.endDateKey = nextData.startDateKey;
    nextData.endDate = formatDateLabel(nextData.startDateKey);
    updates.endDateKey = nextData.startDateKey;
    updates.endDate = nextData.endDate;
    if (nextData.allDay || isEndAfterStart(nextData.startDateKey, nextData.startTime, nextData.endDateKey, nextData.endTime)) {
      return updates;
    }
    if (toastTitle) wx.showToast({ title: toastTitle, icon: "none" });
    return Object.assign(updates, getEndOneHourAfterStart(nextData.startDateKey, nextData.startTime));
  },

  onStartDateChange(e) {
    const value = e.detail.value;
    const updates = {
      startDateKey: value,
      startDate: formatDateLabel(value),
      endDateKey: value,
      endDate: formatDateLabel(value),
      formErrorTime: ""
    };
    if (this.data.allDay) {
      this.setData(updates);
      return;
    } else if (!this.data.hasManualEndTime) {
      Object.assign(updates, getEndOneHourAfterStart(value, this.data.startTime));
    } else {
      this.adjustInvalidEnd(updates, "已自动调整结束时间");
    }
    this.setData(updates);
  },

  onStartTimeChange(e) {
    if (this.data.allDay) return;
    const value = e.detail.value;
    const updates = { startTime: value, formErrorTime: "" };
    if (!this.data.hasManualEndTime) {
      Object.assign(updates, getEndOneHourAfterStart(this.data.startDateKey, value));
    } else {
      this.adjustInvalidEnd(updates, "已自动调整结束时间");
    }
    this.setData(updates);
  },

  onEndDateChange(e) {
    if (this.data.allDay) return;
    const updates = this.adjustInvalidEnd({
      hasManualEndTime: true,
      endDateKey: this.data.startDateKey,
      endDate: formatDateLabel(this.data.startDateKey),
      formErrorTime: ""
    }, "结束时间必须晚于开始时间，已自动调整");
    this.setData(updates);
  },

  onEndTimeChange(e) {
    if (this.data.allDay) return;
    const updates = this.adjustInvalidEnd({
      hasManualEndTime: true,
      endTime: e.detail.value,
      formErrorTime: ""
    }, "结束时间必须晚于开始时间，已自动调整");
    this.setData(updates);
  },

  onRepeatEndDateChange(e) {
    const value = e.detail.value;
    this.setData({
      repeatEndDateKey: value,
      repeatEndDate: formatDateLabel(value)
    });
  },

  onReminderChange(e) {
    const reminder = this.data.reminderOptions[Number(e.detail.value)] || "不提醒";
    this.setData({ reminder });
  },

  onRepeatChange(e) {
    const option = repeatOptions[Number(e.detail.value)] || repeatOptions[0];
    this.setData({
      repeatValue: option.value,
      repeatLabel: repeatLabels[option.value] || "永不重复"
    });
  },

  navigateBack() {
    wx.navigateBack();
  },

  buildSchedulePatch(id) {
    const startDateKey = this.data.startDateKey;
    const dateParts = startDateKey.split("-").map(Number);
    const patch = {
      id,
      clientId: id,
      title: this.data.title.trim(),
      type: this.data.scheduleType || "schedule",
      date: formatDateLabel(startDateKey),
      dateKey: startDateKey,
      year: dateParts[0],
      month: dateParts[1],
      day: dateParts[2],
      startDateKey,
      endDateKey: startDateKey,
      startTime: this.data.allDay ? "" : this.data.startTime,
      endTime: this.data.allDay ? "" : this.data.endTime,
      location: this.data.location.trim(),
      reminder: this.data.reminder,
      repeat: this.data.repeatLabel,
      repeatRule: {
        type: this.data.repeatValue,
        interval: this.data.repeatValue === "biweekly" ? 2 : 1,
        endDate: this.data.repeatValue === "never" ? "" : this.data.repeatEndDateKey
      },
      url: this.data.url.trim(),
      note: this.data.note || this.data.longText,
      allDay: this.data.allDay,
      source: this.data.longText ? "natural-language" : "manual",
      status: "todo"
    };
    return withNormalizedReminder(patch);
  },

  validateForm() {
    this.setData({ formErrorTitle: "", formErrorTime: "" });
    if (!this.data.title.trim()) {
      this.setData({ formErrorTitle: "请输入日程标题，保存前必须填写。" });
      wx.showToast({ title: "请输入标题", icon: "none" });
      return false;
    }
    if (!this.data.allDay) {
      if (!this.data.startDateKey || !this.data.startTime || !this.data.endDateKey || !this.data.endTime) {
        this.setData({ formErrorTime: "请完善开始和结束时间。" });
        wx.showToast({ title: "请完善开始和结束时间", icon: "none" });
        return false;
      }
      if (!isEndAfterStart(this.data.startDateKey, this.data.startTime, this.data.startDateKey, this.data.endTime)) {
        this.setData({ formErrorTime: "结束时间必须晚于开始时间。" });
        wx.showToast({ title: "结束时间必须晚于开始时间", icon: "none" });
        return false;
      }
    }
    return true;
  },

  finishSave(toastTitle) {
    refreshPreviousPage();
    wx.showToast({ title: toastTitle, icon: "success" });
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: "/pages/home/home" });
      }
    }, 450);
  },

  prepareReminderForSave(schedule) {
    const normalized = withNormalizedReminder(schedule);
    if (!normalized.reminder || !normalized.reminder.enabled) {
      return Promise.resolve(normalized);
    }
    return requestScheduleReminderSubscription(normalized).then((subscription) => {
      const prepared = withNormalizedReminder(normalized, {
        subscribed: !!subscription.subscribed,
        templateId: subscription.templateId || ""
      });
      if (subscription.subscribed) {
        wx.showToast({ title: "提醒已开启", icon: "none" });
      } else if (subscription.missingTemplate) {
        wx.showToast({ title: "已保存日程，但未配置微信提醒", icon: "none" });
      } else {
        wx.showToast({ title: "已保存日程，但不会收到微信提醒", icon: "none" });
      }
      return prepared;
    });
  },

  saveSchedule() {
    if (!this.validateForm()) return;
    if (this.data.pageMode === "edit" && this.data.editId) {
      this.saveEditedSchedule();
      return;
    }
    const id = createId("s");
    const schedule = this.buildSchedulePatch(id);
    this.prepareReminderForSave(schedule).then((prepared) => {
      appendItem(KEYS.schedules, prepared);
      try {
        wx.setStorageSync(RECENT_SCHEDULE_KEY, id);
      } catch (error) {}
      api.schedule.create(prepared).catch((error) => {
        console.warn("schedule create pending local only", error.message);
      });
      this.finishSave("已添加");
    });
  },

  saveEditedSchedule() {
    const id = this.data.editId;
    const original = getItemById(KEYS.schedules, id) || this.data.originalSchedule;
    if (!original) {
      wx.showToast({ title: "未找到日程", icon: "none" });
      return;
    }
    const repeatRule = original.repeatRule || {};
    const isRepeating = repeatRule.type && repeatRule.type !== "never";
    const storageId = original.id || original.clientId || id;
    const patch = this.buildSchedulePatch(storageId);
    if (!isRepeating) {
      this.prepareReminderForSave(patch).then((prepared) => {
        const updated = updateItem(KEYS.schedules, id, prepared);
        api.schedule.update(Object.assign({}, updated || prepared, { id })).catch((error) => {
          console.warn("schedule update pending local only", error.message);
        });
        this.finishSave("已保存");
      });
      return;
    }
    wx.showActionSheet({
      itemList: ["仅修改当天", "修改全部重复日程"],
      success: (res) => {
        if (res.tapIndex === 0) this.saveSingleOccurrence(original, patch);
        if (res.tapIndex === 1) this.saveAllRepeating(id, patch, original);
      }
    });
  },

  saveAllRepeating(id, patch, original) {
    const shouldKeepOriginalDates = this.data.isEditingOccurrence
      && this.data.editDateKey
      && patch.startDateKey === this.data.editDateKey;
    const originalStartDateKey = this.data.originalStartDateKey || original.startDateKey || original.dateKey || patch.startDateKey;
    const originalEndDateKey = originalStartDateKey;
    const nextPatch = Object.assign({}, patch, shouldKeepOriginalDates ? {
      date: formatDateLabel(originalStartDateKey),
      dateKey: originalStartDateKey,
      startDateKey: originalStartDateKey,
      endDateKey: originalEndDateKey,
      year: Number(originalStartDateKey.slice(0, 4)),
      month: Number(originalStartDateKey.slice(5, 7)),
      day: Number(originalStartDateKey.slice(8, 10))
    } : {}, {
      excludedDates: Array.isArray(original.excludedDates) ? original.excludedDates.slice() : []
    });
    this.prepareReminderForSave(nextPatch).then((prepared) => {
      const updated = updateItem(KEYS.schedules, id, prepared);
      api.schedule.update(Object.assign({}, updated || prepared, { id })).catch((error) => {
        console.warn("schedule update pending local only", error.message);
      });
      this.finishSave("已保存");
    });
  },

  saveSingleOccurrence(original, patch) {
    const sourceDateKey = this.data.editDateKey || original.startDateKey || original.dateKey || patch.startDateKey;
    const excludedDates = Array.isArray(original.excludedDates) ? original.excludedDates.slice() : [];
    if (!excludedDates.includes(sourceDateKey)) excludedDates.push(sourceDateKey);
    updateItem(KEYS.schedules, this.data.editId, { excludedDates });
    api.schedule.update({ id: this.data.editId, excludedDates }).catch(() => {});

    const newId = createId("s");
    const single = Object.assign({}, patch, {
      id: newId,
      clientId: newId,
      repeat: "永不重复",
      repeatRule: { type: "never", interval: 1, endDate: "" },
      excludedDates: []
    });
    this.prepareReminderForSave(single).then((prepared) => {
      appendItem(KEYS.schedules, prepared);
      api.schedule.create(prepared).catch((error) => {
        console.warn("schedule create occurrence pending local only", error.message);
      });
      this.finishSave("已保存");
    });
  },

  navigateBackAfterDelete() {
    refreshPreviousPage();
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: "/pages/home/home" });
      }
    }, 350);
  },

  deleteCurrentSchedule() {
    const id = this.data.editId;
    if (!id) {
      wx.showToast({ title: "未找到日程", icon: "none" });
      return;
    }
    const schedule = getItemById(KEYS.schedules, id);
    if (!schedule) {
      wx.showToast({ title: "未找到日程", icon: "none" });
      return;
    }
    const repeatRule = schedule.repeatRule || {};
    const isRepeating = repeatRule.type && repeatRule.type !== "never";
    const deleteAll = (toastTitle) => {
      removeItem(KEYS.schedules, id);
      api.schedule.delete(id).catch(() => {});
      wx.showToast({ title: toastTitle, icon: "success" });
      this.navigateBackAfterDelete();
    };
    const deleteOccurrence = () => {
      const occurrenceDateKey = this.data.editDateKey || this.data.startDateKey;
      const excludedDates = Array.isArray(schedule.excludedDates) ? schedule.excludedDates.slice() : [];
      if (!excludedDates.includes(occurrenceDateKey)) excludedDates.push(occurrenceDateKey);
      updateItem(KEYS.schedules, id, { excludedDates });
      api.schedule.update({ id, excludedDates }).catch(() => {});
      wx.showToast({ title: "已删除当天日程", icon: "success" });
      this.navigateBackAfterDelete();
    };

    if (isRepeating) {
      wx.showActionSheet({
        itemList: ["仅删除当天", "删除全部重复日程"],
        itemColor: "#ef4444",
        success: (res) => {
          if (res.tapIndex === 0) deleteOccurrence();
          if (res.tapIndex === 1) deleteAll("已删除全部重复日程");
        }
      });
      return;
    }

    wx.showModal({
      title: "删除日程",
      content: "删除后该日程将不再显示。",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        deleteAll("已删除");
      }
    });
  },

  startVoice() {
    if (this.data.isParsingSchedule || this.data.isRecognizingVoice) return;
    if (!wx.getRecorderManager) {
      wx.showToast({ title: "当前环境不支持录音", icon: "none" });
      return;
    }
    const recorder = wx.getRecorderManager();
    if (this.data.isRecordingVoice) {
      recorder.stop();
      this.setData({ isRecordingVoice: false, isRecognizingVoice: true, parseTip: "正在识别语音..." });
      return;
    }
    this.setupRecorder();
    this.setData({ isRecordingVoice: true, parseTip: "正在录音，再次点击结束" });
    recorder.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: "mp3"
    });
  },

  handleVoiceStop(res) {
    if (this.unloaded) return;
    this.setData({ isRecordingVoice: false, isRecognizingVoice: true, parseTip: "正在识别语音..." });
    this.speechToText(res.tempFilePath).then((text) => {
      const content = String(text || "").trim();
      if (!content) {
        wx.showToast({ title: "未识别到语音内容", icon: "none" });
        this.setData({ parseTip: "" });
        return null;
      }
      this.setData({ longText: content });
      return this.parseScheduleText(content);
    }).catch((error) => {
      console.warn("speech to text failed", error);
      this.setData({ parseTip: "" });
      const title = error && error.code === 501
        ? "语音识别服务未配置"
        : "语音识别失败，请稍后重试";
      wx.showToast({ title, icon: "none" });
    }).finally(() => {
      this.setData({ isRecognizingVoice: false });
    });
  },

  speechToText(tempFilePath) {
    const filePath = String(tempFilePath || "");
    if (!filePath) return Promise.reject(new Error("voice file is empty"));
    if (!wx.cloud || !wx.cloud.uploadFile) {
      return Promise.reject(new Error("cloud upload is not available"));
    }
    const ext = filePath.split(".").pop() || "mp3";
    const cloudPath = `speech/schedule-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
    return wx.cloud.uploadFile({
      cloudPath,
      filePath
    }).then((uploadRes) => {
      if (!uploadRes.fileID) throw new Error("voice upload failed");
      return api.speech.recognize({
        fileID: uploadRes.fileID,
        format: ext,
        language: "zh-CN"
      });
    }).then((res) => {
      const data = res && res.data;
      return data && data.text ? data.text : "";
    });
  }
});
