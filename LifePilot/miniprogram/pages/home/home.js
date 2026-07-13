const storage = require("../../utils/storage");
const { api } = require("../../utils/cloud");
const { normalizeScheduleItem, isScheduleOnDate } = require("../../utils/scheduleIndex");
const { showDueLocalReminder } = require("../../utils/reminder");
const KEYS = storage.KEYS;
const readList = storage.readList;
const removeItem = storage.removeItem;
const getItemById = storage.getItemById;
const updateItem = storage.updateItem;
const mergeSchedulesToStorage = storage.mergeSchedulesToStorage;
const createBoundlessNote = storage.createBoundlessNote;
const updateBoundlessNote = storage.updateBoundlessNote;
const deleteBoundlessNote = storage.deleteBoundlessNote;
const getBoundlessNoteById = storage.getBoundlessNoteById;
const listBoundlessNotesByDate = storage.listBoundlessNotesByDate;
const getBoundlessDraftByDate = storage.getBoundlessDraftByDate;
const todayKey = storage.todayKey;

const LUNAR = [
  "\u521d\u4e00", "\u521d\u4e8c", "\u521d\u4e09", "\u521d\u56db", "\u521d\u4e94", "\u521d\u516d", "\u521d\u4e03",
  "\u521d\u516b", "\u521d\u4e5d", "\u521d\u5341", "\u5341\u4e00", "\u5341\u4e8c", "\u5341\u4e09", "\u5341\u56db",
  "\u5341\u4e94", "\u5341\u516d", "\u5341\u4e03", "\u5341\u516b", "\u5341\u4e5d", "\u4e8c\u5341", "\u5eff\u4e00",
  "\u5eff\u4e8c", "\u5eff\u4e09", "\u5eff\u56db", "\u5eff\u4e94", "\u5eff\u516d", "\u5eff\u4e03", "\u5eff\u516b",
  "\u5eff\u4e5d", "\u4e09\u5341", "\u56db\u6708"
];
const LUNAR_BY_MONTH = {
  "2026-5": [
    "\u5341\u4e94", "\u5341\u516d", "\u5341\u4e03", "\u5341\u516b", "\u5341\u4e5d", "\u4e8c\u5341", "\u5eff\u4e00",
    "\u5eff\u4e8c", "\u5eff\u4e09", "\u5eff\u56db", "\u5eff\u4e94", "\u5eff\u516d", "\u5eff\u4e03", "\u5eff\u516b",
    "\u5eff\u4e5d", "\u4e09\u5341", "\u56db\u6708", "\u521d\u4e8c", "\u521d\u4e09", "\u521d\u56db", "\u521d\u4e94",
    "\u521d\u516d", "\u521d\u4e03", "\u521d\u516b", "\u521d\u4e5d", "\u521d\u5341", "\u5341\u4e00", "\u5341\u4e8c",
    "\u5341\u4e09", "\u5341\u56db", "\u5341\u4e94"
  ]
};

const SEARCH_TRIGGER_STYLE = "";
const ADD_TRIGGER_STYLE = "";
const SEARCH_ICON_STYLE = "";
const ADD_ICON_STYLE = "transform: translateY(-2rpx);";
const RECENT_SCHEDULE_KEY = "campusmind_recent_schedule_id";

function formatMonth(year, month) {
  return `${year}\u5e74${month}\u6708`;
}

function lunarLabel(year, month, day) {
  const exact = LUNAR_BY_MONTH[`${year}-${month}`];
  return exact ? exact[day - 1] : LUNAR[(day - 1) % LUNAR.length];
}

function chromeLayout() {
  const fallback = {
    topBarStyle: "min-height:79px;padding-top:31px;",
    topActionsStyle: "right:18px;top:39px;",
    searchTriggerStyle: SEARCH_TRIGGER_STYLE,
    addTriggerStyle: ADD_TRIGGER_STYLE,
    searchIconStyle: SEARCH_ICON_STYLE,
    addIconStyle: ADD_ICON_STYLE
  };
  try {
    if (!wx.getMenuButtonBoundingClientRect) return fallback;
    const menu = wx.getMenuButtonBoundingClientRect();
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375 };
    if (!menu || !menu.top || !menu.left) return fallback;
    const buttonSize = 44;
    const topBarHeight = menu.bottom + 18;
    const actionTop = menu.top + (menu.height - buttonSize) / 2;
    const actionRight = Math.max(18, windowInfo.windowWidth - menu.left + 8);
    return {
      topBarStyle: `min-height:${topBarHeight}px;padding-top:${menu.top}px;`,
      topActionsStyle: `right:${actionRight}px;top:${actionTop}px;`,
      searchTriggerStyle: SEARCH_TRIGGER_STYLE,
      addTriggerStyle: ADD_TRIGGER_STYLE,
      searchIconStyle: SEARCH_ICON_STYLE,
      addIconStyle: ADD_ICON_STYLE
    };
  } catch (error) {
    return fallback;
  }
}

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesNow(date) {
  const now = date || new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return {
    year,
    month,
    day,
    dateKey: `${year}-${pad(month)}-${pad(day)}`
  };
}

function displayNoteDate(date) {
  const parts = String(date || "").split("-");
  if (parts.length !== 3) return "";
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function selectedDateText(year, month, day, currentToday) {
  const dateKey = `${year}-${pad(month)}-${pad(day)}`;
  if (dateKey === currentToday.dateKey) return "\u4eca\u5929";
  return `${month}\u6708${day}\u65e5`;
}

function deriveAgendaStatus(item, occurrenceDateKey, now) {
  const currentToday = getToday().dateKey;
  if (occurrenceDateKey < currentToday) return "ended";
  if (occurrenceDateKey > currentToday) return "upcoming";
  const startMinutes = timeToMinutes(item.start);
  const endMinutes = timeToMinutes(item.end);
  const currentMinutes = minutesNow(now);
  if (startMinutes === null && endMinutes === null) return "upcoming";
  if (startMinutes !== null && currentMinutes < startMinutes) return "upcoming";
  if (endMinutes !== null && currentMinutes >= endMinutes) return "ended";
  if (endMinutes === null && startMinutes !== null && currentMinutes > startMinutes) return "ended";
  return "active";
}

function withAgendaStatus(events, occurrenceDateKey, now) {
  return (events || []).map((item) => {
    const status = deriveAgendaStatus(item, item.occurrenceDateKey || occurrenceDateKey, now);
    return Object.assign({}, item, { status });
  });
}

function buildAgendaSummary(events) {
  if (!events.length) {
    return {
      title: "\u4eca\u5929\u6ca1\u6709\u5b89\u6392",
      countText: "\u7a7a\u95f2"
    };
  }
  const active = events.find((item) => item.status === "active");
  const next = events.find((item) => item.status === "upcoming");
  if (active) {
    return {
      title: active.start ? `\u8fdb\u884c\u4e2d ${active.start} ${active.title}` : `\u8fdb\u884c\u4e2d ${active.title}`,
      countText: `${events.length} \u9879`
    };
  }
  if (!next) {
    return {
      title: "\u4eca\u65e5\u5df2\u5b8c\u6210",
      countText: `${events.length} \u9879`
    };
  }
  return {
    title: next.start ? `\u4e0b\u4e00\u9879 ${next.start} ${next.title}` : `\u4e0b\u4e00\u9879 ${next.title}`,
    countText: `${events.length} \u9879`
  };
}

function monthMeta(year, month) {
  const first = new Date(year, month - 1, 1).getDay();
  const count = new Date(year, month, 0).getDate();
  return { first, count };
}

function itemToEvent(item, occurrenceDateKey) {
  const normalized = normalizeScheduleItem(item, item.type || "schedule");
  const id = item.clientId || item.id || item._id || item.cloudId || normalized.id || normalized.searchIndexId;
  const location = String(
    normalized.location
    || item.location
    || item.classroom
    || item.locationName
    || item.locationDetail
    || item.address
    || item.place
    || ""
  ).trim();
  return {
    id,
    storageId: id,
    searchIndexId: normalized.searchIndexId,
    cloudId: item._id || item.cloudId || "",
    occurrenceDateKey,
    startDateKey: occurrenceDateKey,
    displayStartDateKey: occurrenceDateKey,
    originalStartDateKey: item.startDateKey || item.dateKey || item.date || "",
    title: normalized.title,
    location,
    start: normalized.startTime || "",
    end: normalized.endTime || "",
    reminder: normalized.reminder || normalized.remindAt || ""
  };
}

function listFromDateResult(res) {
  const data = res && res.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.schedules)) return data.schedules;
  return [];
}

function listFromMonthResult(res) {
  const days = (res && res.data && res.data.days) || [];
  const items = [];
  days.forEach((day) => {
    (day.items || day.schedules || []).forEach((item) => {
      items.push(Object.assign({}, item, {
        occurrenceDateKey: day.date,
        dateKey: item.dateKey || item.date || "",
        startDateKey: item.startDateKey || item.dateKey || item.date || ""
      }));
    });
  });
  return items;
}

function eventsFor(year, month, day) {
  const dateKey = `${year}-${pad(month)}-${pad(day)}`;
  return readList(KEYS.schedules, [])
    .filter((item) => isScheduleOnDate(item, dateKey))
    .map((item) => itemToEvent(item, dateKey))
    .sort((a, b) => String(a.start || "99:99").localeCompare(String(b.start || "99:99")));
}

function withSwipeState(events, swipedId, highlightedId) {
  return events.map((item) => Object.assign({}, item, {
    open: item.id === swipedId,
    highlight: !!highlightedId && item.id === highlightedId
  }));
}

function buildMonth(year, month, selectedDay, today) {
  const meta = monthMeta(year, month);
  const first = meta.first;
  const count = meta.count;
  const totalSlots = Math.ceil((first + count) / 7) * 7;
  const days = [];
  for (let slot = 0; slot < totalSlots; slot += 1) {
    const day = slot - first + 1;
    const valid = day >= 1 && day <= count;
    const hasCourse = valid && eventsFor(year, month, day).length > 0;
    days.push({
      id: `${year}-${month}-${slot}`,
      day: valid ? day : 0,
      lunar: valid ? lunarLabel(year, month, day) : "",
      disabled: !valid,
      isToday: valid && year === today.year && month === today.month && day === today.day,
      selected: valid && day === selectedDay,
      hasCourse
    });
  }
  return days;
}

const today = getToday();

Page({
  data: {
    year: today.year,
    month: today.month,
    monthTitle: formatMonth(today.year, today.month),
    todayKey: today.dateKey,    weekdays: ["\u65e5", "\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d"],
    selectedDay: today.day,
    days: buildMonth(today.year, today.month, today.day, today),
    events: [],
    selectedDateLabel: "\u4eca\u5929",
    agendaSummary: buildAgendaSummary([]),
    refreshingAgenda: false,
    recentHighlightId: "",
    monthTransitionClass: "",
    touchStartY: 0,
    agendaTouchStartX: 0,
    agendaTouchStartY: 0,
    swipedId: "",
    noteSheetVisible: false,
    noteSheetOpen: false,
    noteSheetMode: "view",
    noteSheetHeightClass: "three-quarter",
    noteSheetDragStartY: 0,
    selectedNote: {},
    editingNoteId: "",
    editingNoteDate: "",
    editingNoteContent: "",
    editingNoteAttachments: [],
    noteSavedContent: "",
    noteDirty: false,
    noteIsToday: true,
    topBarStyle: "min-height:79px;padding-top:31px;",
    topActionsStyle: "right:18px;top:39px;",
    searchTriggerStyle: SEARCH_TRIGGER_STYLE,
    addTriggerStyle: ADD_TRIGGER_STYLE,
    searchIconStyle: SEARCH_ICON_STYLE,
    addIconStyle: ADD_ICON_STYLE
  },

  onLoad() {
    this.setData(chromeLayout());
  },

  onHide() {
    this.stopAgendaClock();
  },

  onUnload() {
    this.stopAgendaClock();
    clearTimeout(this.highlightTimer);
    clearTimeout(this.monthTransitionTimer);
  },

  refreshCalendar(options) {
    const skipCloud = !!(options && options.skipCloud);
    const year = this.data.year;
    const month = this.data.month;
    const selectedDay = this.data.selectedDay;
    const swipedId = this.data.swipedId;
    const currentToday = getToday();
    const dateKey = `${year}-${pad(month)}-${pad(selectedDay)}`;
    const events = withSwipeState(withAgendaStatus(eventsFor(year, month, selectedDay), dateKey, new Date()), swipedId, this.data.recentHighlightId);
    this.setData({
      todayKey: currentToday.dateKey,      monthTitle: formatMonth(year, month),
      days: buildMonth(year, month, selectedDay, currentToday),
      events,
      selectedDateLabel: selectedDateText(year, month, selectedDay, currentToday),
      agendaSummary: buildAgendaSummary(events)
    });
    if (!skipCloud) this.loadCloudSchedules(year, month, selectedDay);
  },

  refreshAgendaStatusTick() {
    const currentToday = getToday();
    if (this.data.todayKey !== currentToday.dateKey) {
      this.setData({
        year: currentToday.year,
        month: currentToday.month,
        selectedDay: currentToday.day,
        monthTitle: formatMonth(currentToday.year, currentToday.month),
        swipedId: ""
      }, () => this.refreshCalendar({ skipCloud: true }));
      return;
    }
    const dateKey = `${this.data.year}-${pad(this.data.month)}-${pad(this.data.selectedDay)}`;
    const events = withSwipeState(withAgendaStatus(this.data.events, dateKey, new Date()), this.data.swipedId, this.data.recentHighlightId);
    this.setData({
      events,
      agendaSummary: buildAgendaSummary(events)
    });
  },

  startAgendaClock() {
    this.stopAgendaClock();
    this.refreshAgendaStatusTick();
    this.agendaClockTimer = setInterval(() => {
      this.refreshAgendaStatusTick();
    }, 60000);
  },

  stopAgendaClock() {
    if (!this.agendaClockTimer) return;
    clearInterval(this.agendaClockTimer);
    this.agendaClockTimer = null;
  },

  onAgendaRefresh() {
    this.setData({ refreshingAgenda: true });
    this.refreshCalendar({ skipCloud: true });
    const cloudLoad = this.loadCloudSchedules(this.data.year, this.data.month, this.data.selectedDay);
    this.refreshAgendaStatusTick();
    if (cloudLoad && cloudLoad.then) {
      cloudLoad.then(() => {
        this.setData({ refreshingAgenda: false });
      });
      return;
    }
    this.setData({ refreshingAgenda: false });
  },

  loadCloudSchedules(year, month, selectedDay) {
    const dateKey = `${year}-${pad(month)}-${pad(selectedDay)}`;
    return Promise.all([
      api.schedule.listByDate(dateKey),
      api.schedule.listByMonth(year, month)
    ]).then((results) => {
      const dateRes = results[0];
      const monthRes = results[1];
      const activeDates = {};
      ((monthRes.data && monthRes.data.days) || []).forEach((item) => {
        activeDates[item.date] = true;
      });
      const cloudSchedules = listFromDateResult(dateRes).concat(listFromMonthResult(monthRes));
      if (cloudSchedules.length) {
        mergeSchedulesToStorage(cloudSchedules);
      }
      this.setData({
        days: this.data.days.map((item) => {
          const itemDate = item.day ? `${year}-${pad(month)}-${pad(item.day)}` : "";
          return itemDate && activeDates[itemDate] ? Object.assign({}, item, { hasCourse: true }) : item;
        })
      }, () => {
        if (cloudSchedules.length) this.refreshCalendar({ skipCloud: true });
      });
    }).catch((error) => {
      console.warn("schedule cloud load fallback to local", error.message);
    });
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    const currentToday = getToday();
    if (this.data.todayKey !== currentToday.dateKey) {
      this.setData({
        year: currentToday.year,
        month: currentToday.month,
        selectedDay: currentToday.day,
        monthTitle: formatMonth(currentToday.year, currentToday.month),        swipedId: ""
      });
    }
    let recentHighlightId = "";
    try {
      recentHighlightId = wx.getStorageSync(RECENT_SCHEDULE_KEY) || "";
      if (recentHighlightId) wx.removeStorageSync(RECENT_SCHEDULE_KEY);
    } catch (error) {
      recentHighlightId = "";
    }
    if (recentHighlightId) {
      this.setData({ recentHighlightId });
      clearTimeout(this.highlightTimer);
      this.highlightTimer = setTimeout(() => {
        this.setData({
          recentHighlightId: "",
          events: withSwipeState(this.data.events, this.data.swipedId, "")
        });
      }, 1400);
    }
    this.refreshCalendar({ skipCloud: true });
    this.loadCloudSchedules(this.data.year, this.data.month, this.data.selectedDay);
    this.startAgendaClock();
    showDueLocalReminder();
  },

  applyMonthDelta(delta) {
    let year = this.data.year;
    let month = this.data.month;
    month += delta;
    if (month < 1) {
      year -= 1;
      month = 12;
    }
    if (month > 12) {
      year += 1;
      month = 1;
    }
    const currentToday = getToday();
    const selectedDay = year === currentToday.year && month === currentToday.month ? currentToday.day : 1;
    this.setData({
      year,
      month,
      selectedDay,
      monthTitle: formatMonth(year, month),
      monthTransitionClass: delta > 0 ? "month-flip-next" : "month-flip-prev"
    }, () => {
      this.refreshCalendar();
      clearTimeout(this.monthTransitionTimer);
      this.monthTransitionTimer = setTimeout(() => {
        this.setData({ monthTransitionClass: "" });
      }, 240);
    });
  },

  onMonthTouchStart(e) {
    this.setData({ touchStartY: e.touches[0].clientY });
  },

  onMonthTouchEnd(e) {
    const endY = e.changedTouches[0].clientY;
    const deltaY = endY - this.data.touchStartY;
    if (Math.abs(deltaY) < 36) return;
    this.applyMonthDelta(deltaY < 0 ? 1 : -1);
  },

  selectDay(e) {
    const day = Number(e.currentTarget.dataset.day);
    if (!day) return;
    this.setData({ selectedDay: day, swipedId: "" }, () => this.refreshCalendar());
  },

  addSchedule() {
    const year = this.data.year;
    const month = this.data.month;
    const selectedDay = this.data.selectedDay;
    const dateKey = `${year}-${pad(month)}-${pad(selectedDay)}`;
    wx.navigateTo({ url: `/pages/scheduleAdd/scheduleAdd?dateKey=${dateKey}` });
  },

  goSearch() {
    wx.navigateTo({ url: "/pages/search/search" });
  },

  openTodayBoundless() {
    const currentToday = getToday();
    this.openNoteSheetByDate(currentToday.dateKey);
  },

  openSelectedBoundless() {
    const dateKey = `${this.data.year}-${pad(this.data.month)}-${pad(this.data.selectedDay)}`;
    this.openNoteSheetByDate(dateKey);
  },

  openNoteSheetByDate(date) {
    const targetDate = date || todayKey();
    const draft = getBoundlessDraftByDate(targetDate);
    if (draft) {
      wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?id=${draft.id}&date=${draft.date || targetDate}&mode=write` });
      return;
    }
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?date=${targetDate}&mode=write` });
  },

  openNoteSheet(note, mode) {
    if (!note || !note.id) return;
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?id=${note.id}&date=${note.date || todayKey()}` });
  },

  openCreateNoteSheet(date) {
    const targetDate = date || todayKey();
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?date=${targetDate}` });
  },

  closeNoteSheet() {
    if (this.data.noteSheetMode === "edit" && this.data.noteDirty) {
      wx.showModal({
        title: "退出无边记",
        content: "内容尚未保存，是否退出？",
        confirmText: "退出",
        cancelText: "取消",
        confirmColor: "#ef4444",
        success: (res) => {
          if (res.confirm) this.hideNoteSheet();
        }
      });
      return;
    }
    this.hideNoteSheet();
  },

  hideNoteSheet() {
    this.setData({ noteSheetOpen: false });
    setTimeout(() => {
      this.setData({
        noteSheetVisible: false,
        noteSheetMode: "view",
        selectedNote: {},
        editingNoteId: "",
        editingNoteContent: "",
        noteDirty: false
      });
    }, 220);
  },

  onNoteSheetDragStart(e) {
    this.setData({ noteSheetDragStartY: e.touches[0].clientY });
  },

  onNoteSheetDragEnd(e) {
    const deltaY = e.changedTouches[0].clientY - this.data.noteSheetDragStartY;
    const order = ["full", "three-quarter", "half"];
    let index = order.indexOf(this.data.noteSheetHeightClass);
    if (index < 0) index = 1;
    if (deltaY < -35) index = Math.max(0, index - 1);
    if (deltaY > 35) index = Math.min(order.length - 1, index + 1);
    this.setData({ noteSheetHeightClass: order[index] });
  },

  editNoteSheet() {
    const note = this.data.selectedNote || {};
    if (!note.id) return;
    this.hideNoteSheet();
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?id=${note.id}&date=${note.date || todayKey()}` });
  },

  updateNoteSheetContent(e) {
    const value = e.detail.value;
    this.setData({
      editingNoteContent: value,
      noteDirty: value !== this.data.noteSavedContent
    });
  },

  cancelNoteEdit() {
    if (this.data.noteDirty) {
      wx.showModal({
        title: "取消编辑",
        content: "内容尚未保存，是否退出？",
        confirmText: "退出",
        cancelText: "继续编辑",
        confirmColor: "#ef4444",
        success: (res) => {
          if (!res.confirm) return;
          if (this.data.editingNoteId) {
            this.setData({ noteSheetMode: "view", editingNoteContent: this.data.noteSavedContent, noteDirty: false });
          } else {
            this.hideNoteSheet();
          }
        }
      });
      return;
    }
    if (this.data.editingNoteId) {
      this.setData({ noteSheetMode: "view" });
    } else {
      this.hideNoteSheet();
    }
  },

  saveNoteSheet() {
    const content = this.data.editingNoteContent;
    if (!content.trim() && !this.data.editingNoteAttachments.length) {
      wx.showToast({ title: "笔记为空", icon: "none" });
      return;
    }
    const note = this.data.editingNoteId
      ? updateBoundlessNote(this.data.editingNoteId, {
        content,
        attachments: this.data.editingNoteAttachments
      })
      : createBoundlessNote(this.data.editingNoteDate, {
        content,
        attachments: this.data.editingNoteAttachments
      });
    if (!note) return;
    api.note.create({
      id: note.cloudId || "",
      clientId: note.id,
      date: note.date,
      type: "boundless",
      content,
      attachments: this.data.editingNoteAttachments
    }).catch((error) => {
      console.warn("noteService create pending local only", error.message);
    });
    this.setData({
      noteSheetMode: "view",
      selectedNote: note,
      editingNoteId: note.id,
      editingNoteDate: note.date,
      editingNoteContent: note.content || "",
      noteSavedContent: note.content || "",
      noteDirty: false
    });
    wx.showToast({ title: "\u5df2\u4fdd\u5b58", icon: "success" });
  },

  deleteNoteSheet() {
    const note = this.data.selectedNote || {};
    if (!note.id) return;
    wx.showModal({
      title: "确认删除",
      content: "这条无边记删除后将无法恢复。",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        deleteBoundlessNote(note.id);
        api.note.delete(note.cloudId, { clientId: note.id }).catch(() => {});
        this.hideNoteSheet();
        wx.showToast({ title: "已删除", icon: "success" });
      }
    });
  },

  onAgendaTouchStart(e) {
    const touch = e.touches[0];
    this.setData({
      agendaTouchStartX: touch.clientX,
      agendaTouchStartY: touch.clientY
    });
  },

  onAgendaTouchEnd(e) {
    const id = e.currentTarget.dataset.id;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - this.data.agendaTouchStartX;
    const deltaY = touch.clientY - this.data.agendaTouchStartY;
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;
    if (deltaX < -42) {
      this.setData({
        swipedId: id,
        events: withSwipeState(this.data.events, id, this.data.recentHighlightId)
      });
      return;
    }
    if (deltaX > 32 || Math.abs(deltaX) < 8) {
      this.setData({
        swipedId: "",
        events: withSwipeState(this.data.events, "", this.data.recentHighlightId)
      });
    }
  },

  editSchedule(e) {
    const id = e.currentTarget.dataset.id;
    const occurrenceDateKey = e.currentTarget.dataset.date || `${this.data.year}-${pad(this.data.month)}-${pad(this.data.selectedDay)}`;
    if (!id) return;
    this.setData({ swipedId: "", events: withSwipeState(this.data.events, "", this.data.recentHighlightId) });
    wx.navigateTo({ url: `/pages/scheduleAdd/scheduleAdd?id=${id}&mode=edit&dateKey=${occurrenceDateKey}` });
  },

  deleteSchedule(e) {
    const id = e.currentTarget.dataset.id;
    const occurrenceDateKey = e.currentTarget.dataset.date || `${this.data.year}-${pad(this.data.month)}-${pad(this.data.selectedDay)}`;
    if (!id) return;
    const schedule = getItemById(KEYS.schedules, id);
    const repeatRule = schedule && schedule.repeatRule;
    const isRepeating = repeatRule && repeatRule.type && repeatRule.type !== "never";
    const closeSwipe = () => this.setData({ swipedId: "", events: withSwipeState(this.data.events, "", this.data.recentHighlightId) }, () => this.refreshCalendar({ skipCloud: true }));
    const deleteAll = (toastTitle) => {
      removeItem(KEYS.schedules, id);
      api.schedule.delete(id).catch(() => {});
      closeSwipe();
      wx.showToast({ title: toastTitle || "已删除", icon: "success" });
    };
    const deleteOccurrence = () => {
      const excludedDates = Array.isArray(schedule.excludedDates) ? schedule.excludedDates.slice() : [];
      if (!excludedDates.includes(occurrenceDateKey)) excludedDates.push(occurrenceDateKey);
      updateItem(KEYS.schedules, id, { excludedDates });
      api.schedule.update({ id, excludedDates }).catch(() => {});
      closeSwipe();
      wx.showToast({ title: "已删除当天日程", icon: "success" });
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
      title: "\u5220\u9664\u65e5\u7a0b",
      content: "删除后该日期中的此日程将不再显示。",
      confirmText: "\u5220\u9664",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        deleteAll("已删除");
        wx.showToast({ title: "已删除", icon: "success" });
      }
    });
  }
});
