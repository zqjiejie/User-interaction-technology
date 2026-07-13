const storage = require("../../utils/storage");
const { api } = require("../../utils/cloud");
const { normalizeScheduleItem, isScheduleOnDate } = require("../../utils/scheduleIndex");
const { showDueLocalReminder } = require("../../utils/reminder");
const KEYS = storage.KEYS;
const readList = storage.readList;
const writeList = storage.writeList;
const appendItem = storage.appendItem;
const removeItem = storage.removeItem;
const getItemById = storage.getItemById;
const updateItem = storage.updateItem;
const mergeSchedulesToStorage = storage.mergeSchedulesToStorage;
const createBoundlessNote = storage.createBoundlessNote;
const updateBoundlessNote = storage.updateBoundlessNote;
const deleteBoundlessNote = storage.deleteBoundlessNote;
const getBoundlessNoteById = storage.getBoundlessNoteById;
const listBoundlessNotesByDate = storage.listBoundlessNotesByDate;
const todayKey = storage.todayKey;

const LUNAR = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七",
  "初八", "初九", "初十", "十一", "十二", "十三", "十四",
  "十五", "十六", "十七", "十八", "十九", "二十", "廿一",
  "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八",
  "廿九", "三十", "四月"
];
const LUNAR_BY_MONTH = {
  "2026-5": [
    "十五", "十六", "十七", "十八", "十九", "二十", "廿一",
    "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八",
    "廿九", "三十", "四月", "初二", "初三", "初四", "初五",
    "初六", "初七", "初八", "初九", "初十", "十一", "十二",
    "十三", "十四", "十五"
  ]
};

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function monthMeta(year, month) {
  return {
    first: new Date(year, month - 1, 1).getDay(),
    count: new Date(year, month, 0).getDate()
  };
}

function formatMonth(year, month) {
  return `${year}年${month}月`;
}

function lunarLabel(year, month, day) {
  const exact = LUNAR_BY_MONTH[`${year}-${month}`];
  return exact ? exact[day - 1] : LUNAR[(day - 1) % LUNAR.length];
}

function chromeLayout() {
  const fallback = {
    monthLineStyle: "min-height:78px;padding-top:29px;",
    prevButtonStyle: "left:14px;top:39px;",
    nextButtonStyle: "right:6px;top:39px;"
  };
  try {
    if (!wx.getMenuButtonBoundingClientRect) return fallback;
    const menu = wx.getMenuButtonBoundingClientRect();
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375 };
    if (!menu || !menu.top || !menu.left) return fallback;
    const buttonSize = 44;
    const buttonTop = menu.top + (menu.height - buttonSize) / 2;
    const right = Math.max(6, windowInfo.windowWidth - menu.left -80);
    return {
      monthLineStyle: `min-height:${menu.bottom + 18}px;padding-top:${menu.top}px;`,
      prevButtonStyle: `left:16px;top:${buttonTop}px;`,
      nextButtonStyle: `right:${right}px;top:${buttonTop}px;`
    };
  } catch (error) {
    return fallback;
  }
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return { year, month, day, dateKey: `${year}-${pad(month)}-${pad(day)}` };
}

function dateKeyOf(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDateKey(dateKey) {
  const parts = String(dateKey || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((value) => !value)) return null;
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function formatDateLabel(dateKey) {
  const parts = parseDateKey(dateKey);
  return parts ? `${parts.year}年${parts.month}月${parts.day}日` : "";
}

function formatMoveToast(dateKey) {
  const parts = parseDateKey(dateKey);
  return parts ? `已移动到 ${parts.month}月${parts.day}日` : "已移动";
}

function dragGhostStyleOf(x, y) {
  return `transform: translate(${x - 80}px, ${y - 26}px) scale(1.04); opacity: 0.96;`;
}

function adjacentMonth(year, month, delta) {
  let nextYear = year;
  let nextMonth = month + delta;
  if (nextMonth < 1) {
    nextYear -= 1;
    nextMonth = 12;
  }
  if (nextMonth > 12) {
    nextYear += 1;
    nextMonth = 1;
  }
  return { year: nextYear, month: nextMonth };
}

function adjacentMonthLabel(year, month, delta) {
  const next = adjacentMonth(year, month, delta);
  return `${next.month}月`;
}

function buildDatePatch(dateKey) {
  const parts = parseDateKey(dateKey);
  if (!parts) return null;
  return {
    date: formatDateLabel(dateKey),
    dateKey,
    startDateKey: dateKey,
    endDateKey: dateKey,
    startDate: formatDateLabel(dateKey),
    endDate: formatDateLabel(dateKey),
    year: parts.year,
    month: parts.month,
    day: parts.day
  };
}

function createScheduleId(prefix) {
  return `${prefix || "s"}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

function scheduleCloudId(schedule) {
  return schedule && (schedule.cloudId || schedule._id || schedule.clientId || schedule.id);
}

function isRepeatingSchedule(schedule) {
  if (!schedule) return false;
  const rule = schedule.repeatRule || {};
  if (rule.type && rule.type !== "never") return true;
  const repeat = String(schedule.repeat || "").trim();
  return !!repeat && repeat !== "永不重复" && repeat !== "不重复" && repeat !== "never";
}

function cloneSingleSchedule(schedule, targetDateKey, sourceDateKey) {
  const newId = createScheduleId("s");
  const single = Object.assign({}, schedule, buildDatePatch(targetDateKey), {
    id: newId,
    clientId: newId,
    searchIndexId: "",
    repeat: "永不重复",
    repeatRule: { type: "never", interval: 1, endDate: "" },
    excludedDates: [],
    recurringParentId: "",
    parentId: "",
    originalRepeatId: "",
    derivedFrom: schedule.clientId || schedule.id || schedule._id || "",
    originalOccurrenceDateKey: sourceDateKey,
    updatedAt: new Date().toISOString()
  });
  delete single._id;
  delete single.cloudId;
  return single;
}

function compactTitle(title) {
  const value = title || "未命名";
  return value.length > 4 ? `${value.slice(0, 4)}...` : value;
}

function eventLocationText(item, normalized) {
  return String(
    (normalized && normalized.location)
    || (item && (item.location || item.classroom || item.locationName || item.locationDetail || item.address || item.place))
    || (normalized && normalized.note)
    || ""
  ).trim();
}

function displayNoteDate(date) {
  const parts = String(date || "").split("-");
  if (parts.length !== 3) return "";
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function itemToEvent(item, occurrenceDateKey) {
  const normalized = normalizeScheduleItem(item, item.type || "schedule");
  const title = normalized.title || "未命名";
  const id = item.clientId || item.id || item._id || item.cloudId || normalized.id || normalized.searchIndexId;
  const location = eventLocationText(item, normalized);
  return {
    id,
    storageId: id,
    searchIndexId: normalized.searchIndexId,
    cloudId: item._id || item.cloudId || "",
    occurrenceDateKey,
    startDateKey: occurrenceDateKey,
    displayStartDateKey: occurrenceDateKey,
    originalStartDateKey: item.startDateKey || item.dateKey || item.date || "",
    title,
    displayTitle: compactTitle(title),
    location,
    displayLocation: location,
    start: normalized.startTime || "",
    end: normalized.endTime || "",
    open: false
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
  const dateKey = dateKeyOf(year, month, day);
  return readList(KEYS.schedules, [])
    .filter((item) => isScheduleOnDate(item, dateKey))
    .map((item) => itemToEvent(item, dateKey));
}

function withSwipeState(events, swipedId) {
  return events.map((item) => Object.assign({}, item, { open: item.id === swipedId }));
}

function notesForDate(date) {
  return listBoundlessNotesByDate(date).map((item) => ({
    id: item.id,
    cloudId: item.cloudId || "",
    date: item.date || date,
    updatedAt: `${item.updatedAt || item.createdAt || ""}`.slice(5, 16).replace("T", " "),
    preview: (item.content || "空白笔记").slice(0, 48),
    content: item.content || ""
  }));
}

function sheetHeightLabel(value) {
  const labels = {
    full: "全屏",
    "three-quarter": "舒展",
    half: "半屏"
  };
  return labels[value] || "舒展";
}

function buildMonth(year, month, selectedDay, today, swipedId) {
  const meta = monthMeta(year, month);
  const totalSlots = Math.ceil((meta.first + meta.count) / 7) * 7;
  const days = [];
  for (let slot = 0; slot < totalSlots; slot += 1) {
    const day = slot - meta.first + 1;
    const valid = day >= 1 && day <= meta.count;
    const events = valid ? withSwipeState(eventsFor(year, month, day), swipedId || "") : [];
    days.push({
      id: `${year}-${month}-${slot}`,
      day: valid ? day : 0,
      lunar: valid ? lunarLabel(year, month, day) : "",
      disabled: !valid,
      selected: valid && day === selectedDay,
      isToday: valid && year === today.year && month === today.month && day === today.day,
      events,
      hasCourse: events.length > 0
    });
  }
  return days;
}

const today = getToday();
const DRAG_EDGE_SIZE = 68;
const DRAG_EDGE_SCROLL_STEP = 12;
const DRAG_EDGE_SCROLL_INTERVAL = 48;
const DRAG_MONTH_HOLD_MS = 720;

Page({
  data: {
    year: today.year,
    month: today.month,
    monthTitle: formatMonth(today.year, today.month),
    todayKey: today.dateKey,
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
    selectedDay: today.day,
    days: buildMonth(today.year, today.month, today.day, today, ""),
    popupEvents: [],
    selectedDateKey: today.dateKey,
    selectedNotes: [],
    swipedId: "",
    calendarScrollLeft: 0,
    dragActive: false,
    dragSourceId: "",
    dragSourceDateKey: "",
    dragTargetDateKey: "",
    dragTargetDay: 0,
    dragGhostTitle: "",
    dragGhostTime: "",
    dragGhostStyle: "transform: translate(0px, 0px); opacity: 0;",
    dragHintText: "拖到日期格后松手",
    dragEdgeVisible: false,
    dragEdgeSide: "",
    dragEdgeMode: "",
    dragEdgeLabel: "",
    dragEdgeProgressStyle: "transform: scaleX(0);",
    dragViewYear: 0,
    dragViewMonth: 0,
    dragViewMonthTitle: "",
    dragViewDays: [],
    dragViewScrollLeft: 0,
    dragViewTargetDateKey: "",
    dragViewTargetDay: 0,
    agendaTouchStartX: 0,
    agendaTouchStartY: 0,
    sheetVisible: false,
    sheetOpen: false,
    sheetHeightClass: "three-quarter",
    sheetHeightLabel: sheetHeightLabel("three-quarter"),
    sheetTab: "schedule",
    sheetTouchStartX: 0,
    sheetTouchStartY: 0,
    sheetSwipeLocked: false,
    sheetDragStartY: 0,
    noteSheetVisible: false,
    noteSheetOpen: false,
    noteSheetMode: "view",
    noteSheetHeightClass: "three-quarter",
    noteSheetDragStartY: 0,
    selectedNote: {},
    editingNoteId: "",
    editingNoteDate: "",
    editingNoteContent: "",
    noteSavedContent: "",
    noteDirty: false,
    monthLineStyle: "min-height:78px;padding-top:29px;",
    prevButtonStyle: "left:14px;top:39px;",
    nextButtonStyle: "right:6px;top:39px;"
  },

  onLoad() {
    this.setData(chromeLayout());
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.refreshCalendar({ skipCloud: true }, () => {
      this.afterCalendarRender(() => this.measureCalendarScroll());
    });
    this.loadCloudSchedules(this.data.year, this.data.month, this.data.selectedDay);
    showDueLocalReminder();
  },

  onHide() {
    this.stopDragEdge();
  },

  onUnload() {
    this.stopDragEdge();
  },

  refreshCalendar(options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const skipCloud = !!(options && options.skipCloud);
    const currentToday = getToday();
    const year = this.data.year;
    const month = this.data.month;
    const selectedDay = this.data.selectedDay;
    this.setData({
      todayKey: currentToday.dateKey,
      days: buildMonth(year, month, selectedDay, currentToday, this.data.swipedId),
      popupEvents: withSwipeState(eventsFor(year, month, selectedDay), this.data.swipedId),
      selectedNotes: notesForDate(this.data.selectedDateKey || dateKeyOf(year, month, selectedDay))
    }, () => {
      if (!skipCloud) this.loadCloudSchedules(year, month, selectedDay);
      if (callback) callback();
    });
  },

  loadCloudSchedules(year, month, selectedDay) {
    const dateKey = dateKeyOf(year, month, selectedDay);
    const requestToken = `${year}-${month}-${selectedDay}-${Date.now()}-${Math.random()}`;
    this.calendarCloudLoadToken = requestToken;
    Promise.all([
      api.schedule.listByDate(dateKey),
      api.schedule.listByMonth(year, month)
    ]).then((results) => {
      if (this.calendarCloudLoadToken !== requestToken) return;
      if (this.data.year !== year || this.data.month !== month) return;
      const dateRes = results[0];
      const monthRes = results[1];
      const dayItems = {};
      const cloudSchedules = listFromDateResult(dateRes).concat(listFromMonthResult(monthRes));
      if (cloudSchedules.length) {
        mergeSchedulesToStorage(cloudSchedules);
      }
      if (this.data.dragActive) return;
      ((monthRes.data && monthRes.data.days) || []).forEach((day) => {
        const dayNumber = Number(String(day.date).slice(8, 10));
        const items = withSwipeState((day.items || []).map((item) => itemToEvent(item, day.date)), this.data.swipedId);
        if (items.length) {
          dayItems[dayNumber] = items;
        }
      });
      const dateItems = listFromDateResult(dateRes).map((item) => itemToEvent(item, dateKey));
      const updates = {
        days: this.data.days.map((item) => {
          if (!item.day || !dayItems[item.day]) return item;
          return Object.assign({}, item, {
            events: dayItems[item.day],
            hasCourse: dayItems[item.day].length > 0
          });
        })
      };
      if (dateItems.length) {
        updates.popupEvents = withSwipeState(dateItems, this.data.swipedId);
      }
      this.setData(updates, () => {
        if (this.calendarCloudLoadToken !== requestToken) return;
        if (this.data.year !== year || this.data.month !== month) return;
        if (cloudSchedules.length) {
          this.refreshCalendar({ skipCloud: true }, () => {
            if (!this.data.dragActive) return;
            this.afterCalendarRender(() => {
              this.cacheDragViewDropRects();
              const touch = this.dragCurrent;
              if (touch) {
                this.updateDragGhostPosition(touch.x, touch.y, null, true);
                this.updateDragViewTargetFromPoint(touch.x, touch.y);
              }
            });
          });
        }
      });
    }).catch((error) => {
      console.warn("calendar cloud load fallback to local", error.message);
    });
  },

  loadCloudNotes(date) {
    api.note.listByDate(date).then((res) => {
      const cloudNotes = ((res.data && res.data.notes) || []).map((item) => ({
        id: item.clientId || item.id,
        cloudId: item.id,
        date: item.date,
        content: item.content || "",
        attachments: item.assets || [],
        createdAt: item.createdAt || "",
        updatedAt: item.updatedAt || ""
      }));
      if (!cloudNotes.length) return;
      const local = readList(KEYS.boundlessNotes, []);
      const byId = {};
      local.concat(cloudNotes).forEach((item) => {
        byId[item.id] = item;
      });
      writeList(KEYS.boundlessNotes, Object.keys(byId).map((id) => byId[id]));
      if (this.data.selectedDateKey === date) {
        this.setData({ selectedNotes: notesForDate(date) });
      }
    }).catch((error) => {
      console.warn("noteService listByDate fallback to local", error.message);
    });
  },

  changeMonth(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    let year = this.data.year;
    let month = this.data.month + delta;
    if (month < 1) {
      year -= 1;
      month = 12;
    }
    if (month > 12) {
      year += 1;
      month = 1;
    }
    const selectedDay = year === today.year && month === today.month ? today.day : 1;
    this.calendarScrollLeft = 0;
    this.setData({ year, month, selectedDay, monthTitle: formatMonth(year, month), swipedId: "", calendarScrollLeft: 0 }, () => {
      this.refreshCalendar(null, () => {
        this.afterCalendarRender(() => this.measureCalendarScroll());
      });
    });
  },

  openDay(e) {
    const day = Number(e.currentTarget.dataset.day);
    if (!day) return;
    const selectedDateKey = dateKeyOf(this.data.year, this.data.month, day);
    this.setData({
      selectedDay: day,
      selectedDateKey,
      selectedNotes: notesForDate(selectedDateKey),
      popupEvents: withSwipeState(eventsFor(this.data.year, this.data.month, day), ""),
      swipedId: "",
      sheetVisible: true,
      sheetTab: "schedule",
      sheetHeightClass: "three-quarter",
      sheetHeightLabel: sheetHeightLabel("three-quarter")
    }, () => {
      this.refreshCalendar({ skipCloud: true });
      this.loadCloudSchedules(this.data.year, this.data.month, day);
      this.loadCloudNotes(selectedDateKey);
      setTimeout(() => this.setData({ sheetOpen: true }), 20);
    });
  },

  closeDaySheet() {
    this.setData({ sheetOpen: false });
    setTimeout(() => this.setData({ sheetVisible: false }), 220);
  },

  onSheetDragStart(e) {
    this.setData({ sheetDragStartY: e.touches[0].clientY });
  },

  onSheetDragEnd(e) {
    const deltaY = e.changedTouches[0].clientY - this.data.sheetDragStartY;
    const order = ["full", "three-quarter", "half"];
    let index = order.indexOf(this.data.sheetHeightClass);
    if (deltaY < -35) index = Math.max(0, index - 1);
    if (deltaY > 35) index = Math.min(order.length - 1, index + 1);
    const nextHeight = order[index];
    this.setData({ sheetHeightClass: nextHeight, sheetHeightLabel: sheetHeightLabel(nextHeight) });
  },

  setSheetTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.sheetTab) return;
    this.setData({
      sheetTab: tab,
      swipedId: "",
      popupEvents: withSwipeState(this.data.popupEvents, "")
    });
  },

  createScheduleForSelected() {
    const dateKey = this.data.selectedDateKey || dateKeyOf(this.data.year, this.data.month, this.data.selectedDay);
    wx.navigateTo({ url: `/pages/scheduleAdd/scheduleAdd?dateKey=${dateKey}` });
  },

  onSheetSwipeStart(e) {
    if (this.data.sheetSwipeLocked) return;
    this.setData({ sheetTouchStartX: e.touches[0].clientX, sheetTouchStartY: e.touches[0].clientY });
  },

  onSheetSwipeEnd(e) {
    if (this.data.sheetSwipeLocked) {
      this.setData({ sheetSwipeLocked: false });
      return;
    }
    const deltaX = e.changedTouches[0].clientX - this.data.sheetTouchStartX;
    const deltaY = e.changedTouches[0].clientY - this.data.sheetTouchStartY;
    if (Math.abs(deltaX) < 46 || Math.abs(deltaY) > Math.abs(deltaX)) return;
    this.setData({ sheetTab: deltaX < 0 ? "notes" : "schedule", swipedId: "", popupEvents: withSwipeState(this.data.popupEvents, "") });
  },

  onAgendaTouchStart(e) {
    const touch = e.touches[0];
    const id = e.currentTarget.dataset.id;
    const date = e.currentTarget.dataset.date || this.data.selectedDateKey;
    clearTimeout(this.agendaLongPressTimer);
    this.agendaLongPressFired = false;
    this.agendaLongPressMoved = false;
    this.setData({ agendaTouchStartX: touch.clientX, agendaTouchStartY: touch.clientY, sheetSwipeLocked: true });
    this.agendaLongPressTimer = setTimeout(() => {
      if (this.agendaLongPressMoved || this.data.dragActive || !id) return;
      this.agendaLongPressFired = true;
      clearTimeout(this.dragTimer);
      this.openScheduleEditorByData(id, date);
      this.preventScheduleTapUntil = Date.now() + 360;
    }, 420);
  },

  onAgendaTouchMove(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - this.data.agendaTouchStartX;
    const deltaY = touch.clientY - this.data.agendaTouchStartY;
    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
      this.agendaLongPressMoved = true;
      clearTimeout(this.agendaLongPressTimer);
    }
  },

  onAgendaTouchEnd(e) {
    clearTimeout(this.agendaLongPressTimer);
    if (this.agendaLongPressFired) {
      this.agendaLongPressFired = false;
      this.setData({ sheetSwipeLocked: false });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - this.data.agendaTouchStartX;
    const deltaY = touch.clientY - this.data.agendaTouchStartY;
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      this.setData({ sheetSwipeLocked: false });
      return;
    }
    if (deltaX < -42) {
      this.setData({ swipedId: id, popupEvents: withSwipeState(this.data.popupEvents, id), sheetSwipeLocked: false }, () => this.refreshCalendar());
      return;
    }
    if (deltaX > 32 || Math.abs(deltaX) < 8) {
      this.setData({ swipedId: "", popupEvents: withSwipeState(this.data.popupEvents, ""), sheetSwipeLocked: false }, () => this.refreshCalendar());
    }
  },

  onAgendaTouchCancel() {
    clearTimeout(this.agendaLongPressTimer);
    this.agendaLongPressFired = false;
    this.agendaLongPressMoved = false;
    this.setData({ sheetSwipeLocked: false });
  },

  onCalendarScroll(e) {
    const scrollLeft = Number(e.detail && e.detail.scrollLeft) || 0;
    this.calendarScrollLeft = scrollLeft;
    if (!this.lastCalendarScrollSync || Date.now() - this.lastCalendarScrollSync > 80) {
      this.lastCalendarScrollSync = Date.now();
      this.setData({ calendarScrollLeft: scrollLeft });
    }
  },

  afterCalendarRender(callback) {
    const run = () => {
      if (callback) callback();
    };
    if (wx.nextTick) {
      wx.nextTick(() => setTimeout(run, 20));
      return;
    }
    setTimeout(run, 40);
  },

  measureCalendarScroll(callback) {
    wx.createSelectorQuery()
      .in(this)
      .select(".calendar-x-scroll")
      .boundingClientRect()
      .select(".calendar-wide-inner")
      .boundingClientRect()
      .exec((res) => {
        const viewport = res && res[0];
        const inner = res && res[1];
        this.calendarViewportRect = viewport || null;
        this.calendarInnerWidth = inner && inner.width ? inner.width : 0;
        this.calendarMaxScrollLeft = viewport && inner ? Math.max(0, inner.width - viewport.width) : 0;
        if (callback) callback();
      });
  },

  measureDragViewScroll(callback) {
    wx.createSelectorQuery()
      .in(this)
      .select(".drag-calendar-scroll")
      .boundingClientRect()
      .select(".drag-calendar-inner")
      .boundingClientRect()
      .exec((res) => {
        const viewport = res && res[0];
        const inner = res && res[1];
        this.dragViewViewportRect = viewport || null;
        this.dragViewInnerWidth = inner && inner.width ? inner.width : 0;
        this.dragViewMaxScrollLeft = viewport && inner ? Math.max(0, inner.width - viewport.width) : 0;
        if (callback) callback();
      });
  },

  updateDragGhostPosition(x, y, extraUpdates, force) {
    if (typeof x !== "number" || typeof y !== "number") return;
    this.dragCurrent = { x, y };
    const nextStyle = dragGhostStyleOf(x, y);
    const updates = Object.assign({}, extraUpdates || {});
    if (force || this.data.dragGhostStyle !== nextStyle) {
      updates.dragGhostStyle = nextStyle;
    }
    if (Object.keys(updates).length) {
      this.setData(updates);
    }
  },

  findScheduleForDrag(id) {
    if (!id) return null;
    return getItemById(KEYS.schedules, id);
  },

  cacheCalendarDropRects() {
    wx.createSelectorQuery()
      .in(this)
      .selectAll(".wide-day")
      .boundingClientRect((rects) => {
        this.dragDayRects = (rects || []).map((rect, index) => {
          const day = this.data.days[index] || {};
          return Object.assign({}, rect, {
            day: day.day || 0,
            dateKey: day.day ? dateKeyOf(this.data.year, this.data.month, day.day) : "",
            disabled: !!day.disabled
          });
        });
      })
      .exec();
  },

  cacheDragViewDropRects() {
    wx.createSelectorQuery()
      .in(this)
      .selectAll(".drag-calendar-layer .wide-day")
      .boundingClientRect((rects) => {
        this.dragViewDayRects = (rects || []).map((rect, index) => {
          const day = this.data.dragViewDays[index] || {};
          return Object.assign({}, rect, {
            day: day.day || 0,
            dateKey: day.day ? dateKeyOf(this.data.dragViewYear, this.data.dragViewMonth, day.day) : "",
            disabled: !!day.disabled
          });
        });
      })
      .exec();
  },

  beginScheduleDrag(e) {
    const touch = e.touches && e.touches[0];
    const id = e.currentTarget.dataset.id;
    const sourceDateKey = e.currentTarget.dataset.date || this.data.selectedDateKey;
    const schedule = this.findScheduleForDrag(id);
    if (!touch || !id || !schedule) return;
    clearTimeout(this.dragTimer);
    this.dragStart = { x: touch.clientX, y: touch.clientY };
    this.dragCurrent = { x: touch.clientX, y: touch.clientY };
    this.dragSchedule = schedule;
    this.dragEvent = {
      id,
      sourceDateKey,
      title: schedule.title || schedule.name || schedule.courseName || "未命名",
      time: schedule.startTime || schedule.start || ""
    };
    this.dragTimer = setTimeout(() => {
      const currentToday = getToday();
      const dragViewDays = buildMonth(this.data.year, this.data.month, this.data.selectedDay, currentToday, "");
      this.dragViewScrollLeft = this.data.calendarScrollLeft || 0;
      this.updateDragGhostPosition(touch.clientX, touch.clientY, {
        dragActive: true,
        dragSourceId: id,
        dragSourceDateKey: sourceDateKey,
        dragTargetDateKey: "",
        dragTargetDay: 0,
        dragViewYear: this.data.year,
        dragViewMonth: this.data.month,
        dragViewMonthTitle: formatMonth(this.data.year, this.data.month),
        dragViewDays,
        dragViewScrollLeft: this.data.calendarScrollLeft || 0,
        dragViewTargetDateKey: "",
        dragViewTargetDay: 0,
        dragGhostTitle: this.dragEvent.title,
        dragGhostTime: this.dragEvent.time,
        dragHintText: "拖到日期格后松手",
        swipedId: "",
        popupEvents: withSwipeState(this.data.popupEvents, ""),
        sheetSwipeLocked: true
      }, true);
      this.afterCalendarRender(() => {
        this.measureDragViewScroll(() => this.cacheDragViewDropRects());
      });
    }, 260);
  },

  trackSchedulePressMove(e) {
    if (this.data.dragActive) {
      this.moveScheduleDrag(e);
      return;
    }
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    this.dragCurrent = { x: touch.clientX, y: touch.clientY };
    if (!this.dragStart) return;
    const deltaX = touch.clientX - this.dragStart.x;
    const deltaY = touch.clientY - this.dragStart.y;
    if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) {
      clearTimeout(this.dragTimer);
    }
  },

  cancelSchedulePress(e) {
    if (this.data.dragActive) {
      this.endScheduleDrag(e);
      return;
    }
    clearTimeout(this.dragTimer);
    this.dragStart = null;
    this.dragEvent = null;
    this.dragSchedule = null;
    this.dragCurrent = null;
    this.setData({ sheetSwipeLocked: false });
  },

  cancelScheduleTouch() {
    clearTimeout(this.dragTimer);
    if (this.data.dragActive) {
      this.cancelScheduleDrag();
      return;
    }
    this.dragStart = null;
    this.dragEvent = null;
    this.dragSchedule = null;
    this.dragCurrent = null;
    this.setData({ sheetSwipeLocked: false });
  },

  moveScheduleDrag(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (this.data.dragActive && e.timeStamp && this.lastDragMoveStamp === e.timeStamp) return;
    if (this.data.dragActive && e.timeStamp) this.lastDragMoveStamp = e.timeStamp;
    if (!this.data.dragActive) {
      this.dragCurrent = { x: touch.clientX, y: touch.clientY };
      if (!this.dragStart) return;
      const deltaX = touch.clientX - this.dragStart.x;
      const deltaY = touch.clientY - this.dragStart.y;
      if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) {
        clearTimeout(this.dragTimer);
      }
      return;
    }
    this.updateDragGhostPosition(touch.clientX, touch.clientY);
    this.updateDragViewTargetFromPoint(touch.clientX, touch.clientY);
    this.updateDragEdge(touch.clientX);
  },

  endScheduleDrag(e) {
    if (e && e.timeStamp && this.lastDragEndStamp === e.timeStamp) return;
    if (e && e.timeStamp) this.lastDragEndStamp = e.timeStamp;
    clearTimeout(this.dragTimer);
    if (!this.data.dragActive) {
      this.dragStart = null;
      this.dragEvent = null;
      this.dragSchedule = null;
      this.setData({ sheetSwipeLocked: false });
      return;
    }
    const touch = (e.changedTouches && e.changedTouches[0]) || this.dragCurrent;
    const touchX = touch && (typeof touch.clientX === "number" ? touch.clientX : touch.x);
    const touchY = touch && (typeof touch.clientY === "number" ? touch.clientY : touch.y);
    const finalTarget = touch ? this.findDragViewDropDate(touchX, touchY) : null;
    const targetDateKey = (finalTarget && finalTarget.dateKey) || this.data.dragViewTargetDateKey || this.data.dragTargetDateKey;
    if (!targetDateKey) {
      this.resetScheduleDrag(() => {
        wx.showToast({ title: "未选择有效日期", icon: "none" });
      });
      return;
    }
    this.moveScheduleToDate(this.dragSchedule, this.dragEvent, targetDateKey);
  },

  cancelScheduleDrag() {
    clearTimeout(this.dragTimer);
    this.resetScheduleDrag();
  },

  onCalendarRootTouchMove(e) {
    if (!this.data.dragActive) return;
    this.moveScheduleDrag(e);
  },

  onCalendarRootTouchEnd(e) {
    if (!this.data.dragActive) return;
    this.endScheduleDrag(e);
  },

  onCalendarRootTouchCancel() {
    if (!this.data.dragActive) return;
    this.cancelScheduleDrag();
  },

  onGlobalDragMove(e) {
    if (!this.data.dragActive) return;
    this.moveScheduleDrag(e);
  },

  onGlobalDragEnd(e) {
    if (!this.data.dragActive) return;
    this.endScheduleDrag(e);
  },

  onGlobalDragCancel() {
    if (!this.data.dragActive) return;
    this.cancelScheduleDrag();
  },

  findDropDate(x, y) {
    const rects = this.dragDayRects || [];
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      if (rect.disabled || !rect.dateKey) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return rect;
      }
    }
    return null;
  },

  findDragViewDropDate(x, y) {
    const rects = this.dragViewDayRects || [];
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      if (rect.disabled || !rect.dateKey) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return rect;
      }
    }
    return null;
  },

  updateDragTargetFromPoint(x, y) {
    const target = this.findDropDate(x, y);
    const nextDateKey = target ? target.dateKey : "";
    if (nextDateKey === this.data.dragTargetDateKey && (!target || target.day === this.data.dragTargetDay)) {
      return target;
    }
    this.setData({
      dragTargetDateKey: nextDateKey,
      dragTargetDay: target ? target.day : 0,
      dragHintText: target ? "松手移动到该日期" : "拖到日期格后松手"
    });
    return target;
  },

  updateDragViewTargetFromPoint(x, y) {
    const target = this.findDragViewDropDate(x, y);
    const nextDateKey = target ? target.dateKey : "";
    if (nextDateKey === this.data.dragViewTargetDateKey && (!target || target.day === this.data.dragViewTargetDay)) {
      return target;
    }
    this.setData({
      dragViewTargetDateKey: nextDateKey,
      dragViewTargetDay: target ? target.day : 0,
      dragTargetDateKey: nextDateKey,
      dragTargetDay: target ? target.day : 0,
      dragHintText: target ? "松手移动到该日期" : "拖到日期格后松手"
    });
    return target;
  },

  updateDragEdge(x) {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375 };
    const width = windowInfo.windowWidth || 375;
    let direction = 0;
    if (x <= DRAG_EDGE_SIZE) direction = -1;
    if (x >= width - DRAG_EDGE_SIZE) direction = 1;
    if (!direction) {
      this.stopDragEdge();
      this.setData({
        dragHintText: this.data.dragViewTargetDateKey ? "松手移动到该日期" : "拖到日期格后松手"
      });
      return;
    }
    const maxScrollLeft = this.dragViewMaxScrollLeft || 0;
    const currentLeft = this.dragViewScrollLeft || this.data.dragViewScrollLeft || 0;
    const canScrollMonth = direction > 0 ? currentLeft < maxScrollLeft - 2 : currentLeft > 2;
    if (canScrollMonth) {
      this.stopDragMonthHold();
      this.startDragEdgeScroll(direction);
      this.setData({
        dragEdgeVisible: true,
        dragEdgeSide: direction > 0 ? "right" : "left",
        dragEdgeMode: "scroll",
        dragEdgeLabel: direction > 0 ? "继续浏览本月" : "浏览本月",
        dragEdgeProgressStyle: "transform: scaleX(0);",
        dragHintText: direction > 0 ? "右侧自动浏览本月" : "左侧自动浏览本月"
      });
      return;
    }
    this.stopDragEdgeScroll();
    this.startDragMonthHold(direction);
  },

  startDragEdgeScroll(direction) {
    if (this.dragEdgeScrollDirection === direction && this.dragEdgeScrollTimer) return;
    this.stopDragEdgeScroll();
    this.dragEdgeScrollDirection = direction;
    this.dragEdgeScrollTimer = setInterval(() => {
      const maxScrollLeft = this.dragViewMaxScrollLeft || 0;
      const currentLeft = this.dragViewScrollLeft || this.data.dragViewScrollLeft || 0;
      const nextLeft = Math.max(0, Math.min(maxScrollLeft, currentLeft + direction * DRAG_EDGE_SCROLL_STEP));
      this.dragViewScrollLeft = nextLeft;
      this.setData({ dragViewScrollLeft: nextLeft }, () => {
        this.afterCalendarRender(() => {
          this.cacheDragViewDropRects();
          const touch = this.dragCurrent;
          if (touch) {
            this.updateDragGhostPosition(touch.x, touch.y);
            this.updateDragViewTargetFromPoint(touch.x, touch.y);
          }
        });
      });
      if (nextLeft <= 0 || nextLeft >= maxScrollLeft) {
        this.stopDragEdgeScroll();
        const touch = this.dragCurrent;
        if (touch) this.updateDragEdge(touch.x);
      }
    }, DRAG_EDGE_SCROLL_INTERVAL);
  },

  startDragMonthHold(direction) {
    if (this.dragMonthHoldDirection === direction && this.dragMonthHoldTimer) return;
    this.stopDragMonthHold();
    this.dragMonthHoldDirection = direction;
    this.dragMonthHoldStartedAt = Date.now();
    this.setData({
      dragEdgeVisible: true,
      dragEdgeSide: direction > 0 ? "right" : "left",
      dragEdgeMode: "month",
      dragEdgeLabel: direction > 0 ? `前往 ${adjacentMonthLabel(this.data.dragViewYear || this.data.year, this.data.dragViewMonth || this.data.month, 1)}` : `返回 ${adjacentMonthLabel(this.data.dragViewYear || this.data.year, this.data.dragViewMonth || this.data.month, -1)}`,
      dragEdgeProgressStyle: "transform: scaleX(0);",
      dragHintText: "继续停留可切换月份"
    });
    this.dragMonthHoldTimer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - this.dragMonthHoldStartedAt) / DRAG_MONTH_HOLD_MS);
      this.setData({ dragEdgeProgressStyle: `transform: scaleX(${progress});` });
      if (progress >= 1) {
        const nextDirection = this.dragMonthHoldDirection;
        this.stopDragMonthHold();
        this.switchDragPreviewMonth(nextDirection);
      }
    }, 48);
  },

  stopDragEdge() {
    this.stopDragEdgeScroll();
    this.stopDragMonthHold();
    if (this.data.dragEdgeVisible) {
      this.setData({
        dragEdgeVisible: false,
        dragEdgeSide: "",
        dragEdgeMode: "",
        dragEdgeLabel: "",
        dragEdgeProgressStyle: "transform: scaleX(0);"
      });
    }
  },

  stopDragEdgeScroll() {
    if (this.dragEdgeScrollTimer) {
      clearInterval(this.dragEdgeScrollTimer);
      this.dragEdgeScrollTimer = null;
    }
    this.dragEdgeScrollDirection = 0;
  },

  stopDragMonthHold() {
    if (this.dragMonthHoldTimer) {
      clearInterval(this.dragMonthHoldTimer);
      this.dragMonthHoldTimer = null;
    }
    this.dragMonthHoldDirection = 0;
    this.dragMonthHoldStartedAt = 0;
  },

  switchDragPreviewMonth(direction) {
    if (!direction || this.dragMonthSwitching) return;
    this.dragMonthSwitching = true;
    const latestDragCurrent = this.dragCurrent ? Object.assign({}, this.dragCurrent) : null;
    const baseYear = this.data.dragViewYear || this.data.year;
    const baseMonth = this.data.dragViewMonth || this.data.month;
    const next = adjacentMonth(baseYear, baseMonth, direction);
    const currentToday = getToday();
    const selectedDay = next.year === currentToday.year && next.month === currentToday.month ? currentToday.day : 1;
    const dragViewDays = buildMonth(next.year, next.month, selectedDay, currentToday, "");
    this.dragViewScrollLeft = 0;
    this.setData({
      dragViewYear: next.year,
      dragViewMonth: next.month,
      dragViewMonthTitle: formatMonth(next.year, next.month),
      dragViewDays,
      dragViewScrollLeft: 0,
      dragViewTargetDateKey: "",
      dragViewTargetDay: 0,
      dragTargetDateKey: "",
      dragTargetDay: 0,
      dragEdgeVisible: false,
      dragEdgeProgressStyle: "transform: scaleX(0);",
      dragHintText: "拖到日期格后松手"
    }, () => {
      const finishMonthSwitch = () => {
        this.cacheDragViewDropRects();
        const touch = latestDragCurrent || this.dragCurrent;
        if (touch) {
          this.updateDragGhostPosition(touch.x, touch.y, null, true);
          this.updateDragViewTargetFromPoint(touch.x, touch.y);
        }
        this.dragMonthSwitching = false;
        if (touch) this.updateDragEdge(touch.x);
      };
      const syncScrollAndRects = () => {
        this.afterCalendarRender(() => {
          this.measureDragViewScroll(() => {
            const targetLeft = direction < 0 ? (this.dragViewMaxScrollLeft || 0) : 0;
            this.dragViewScrollLeft = targetLeft;
            this.setData({ dragViewScrollLeft: targetLeft }, () => {
              this.afterCalendarRender(() => {
                this.measureDragViewScroll(finishMonthSwitch);
              });
            });
          });
        });
      };
      syncScrollAndRects();
    });
  },

  resetScheduleDrag(callback) {
    this.stopDragEdge();
    if (this.data.dragActive) this.preventScheduleTapUntil = Date.now() + 360;
    this.dragStart = null;
    this.dragCurrent = null;
    this.dragEvent = null;
    this.dragSchedule = null;
    this.dragDayRects = [];
    this.dragViewDayRects = [];
    this.dragViewScrollLeft = 0;
    this.dragViewMaxScrollLeft = 0;
    this.setData({
      dragActive: false,
      dragSourceId: "",
      dragSourceDateKey: "",
      dragTargetDateKey: "",
      dragTargetDay: 0,
      dragViewYear: 0,
      dragViewMonth: 0,
      dragViewMonthTitle: "",
      dragViewDays: [],
      dragViewScrollLeft: 0,
      dragViewTargetDateKey: "",
      dragViewTargetDay: 0,
      dragGhostTitle: "",
      dragGhostTime: "",
      dragGhostStyle: "transform: translate(0px, 0px); opacity: 0;",
      dragHintText: "拖到日期格后松手",
      dragEdgeVisible: false,
      dragEdgeSide: "",
      dragEdgeMode: "",
      dragEdgeLabel: "",
      dragEdgeProgressStyle: "transform: scaleX(0);",
      sheetSwipeLocked: false
    }, callback);
  },

  moveScheduleToDate(schedule, dragEvent, targetDateKey) {
    const sourceDateKey = dragEvent && dragEvent.sourceDateKey;
    const id = dragEvent && dragEvent.id;
    if (!schedule || !id || !sourceDateKey || !targetDateKey) {
      this.resetScheduleDrag(() => wx.showToast({ title: "移动失败", icon: "none" }));
      return;
    }
    if (sourceDateKey === targetDateKey) {
      this.resetScheduleDrag(() => wx.showToast({ title: "已在当前日期", icon: "none" }));
      return;
    }
    const patch = buildDatePatch(targetDateKey);
    if (!patch) {
      this.resetScheduleDrag(() => wx.showToast({ title: "日期无效", icon: "none" }));
      return;
    }
    if (isRepeatingSchedule(schedule)) {
      this.moveRepeatingOccurrence(schedule, id, sourceDateKey, targetDateKey);
      return;
    }
    const updated = updateItem(KEYS.schedules, id, Object.assign({}, patch, {
      updatedAt: new Date().toISOString()
    }));
    if (!updated) {
      this.resetScheduleDrag(() => wx.showToast({ title: "移动失败", icon: "none" }));
      return;
    }
    api.schedule.update(Object.assign({ id: scheduleCloudId(schedule), clientId: schedule.clientId || schedule.id }, patch)).catch((error) => {
      console.warn("schedule drag update pending local only", error.message);
    });
    this.finishScheduleDragMove(targetDateKey);
  },

  moveRepeatingOccurrence(schedule, id, sourceDateKey, targetDateKey) {
    const excludedDates = Array.isArray(schedule.excludedDates) ? schedule.excludedDates.slice() : [];
    if (!excludedDates.includes(sourceDateKey)) excludedDates.push(sourceDateKey);
    const single = cloneSingleSchedule(schedule, targetDateKey, sourceDateKey);
    updateItem(KEYS.schedules, id, { excludedDates, updatedAt: new Date().toISOString() });
    appendItem(KEYS.schedules, single);
    api.schedule.update({ id: scheduleCloudId(schedule), clientId: schedule.clientId || schedule.id, excludedDates }).catch((error) => {
      console.warn("schedule drag repeat update pending local only", error.message);
    });
    api.schedule.create(single).catch((error) => {
      console.warn("schedule drag single create pending local only", error.message);
    });
    // TODO: add an undo snapshot here by deleting the split item and removing sourceDateKey from excludedDates.
    this.finishScheduleDragMove(targetDateKey);
  },

  finishScheduleDragMove(targetDateKey) {
    const selected = parseDateKey(targetDateKey);
    if (!selected) {
      this.resetScheduleDrag(() => {
        wx.showToast({ title: formatMoveToast(targetDateKey), icon: "success" });
      });
      return;
    }
    this.resetScheduleDrag(() => {
      this.calendarScrollLeft = 0;
      this.setData({
        year: selected.year,
        month: selected.month,
        selectedDay: selected.day,
        selectedDateKey: targetDateKey,
        selectedNotes: notesForDate(targetDateKey),
        monthTitle: formatMonth(selected.year, selected.month),
        calendarScrollLeft: 0,
        swipedId: "",
        popupEvents: []
      }, () => {
        this.refreshCalendar({ skipCloud: true }, () => {
          this.afterCalendarRender(() => this.measureCalendarScroll());
        });
        this.loadCloudSchedules(selected.year, selected.month, selected.day);
        wx.showToast({ title: formatMoveToast(targetDateKey), icon: "success" });
      });
    });
  },

  openScheduleEditorByData(id, occurrenceDateKey) {
    occurrenceDateKey = occurrenceDateKey || this.data.selectedDateKey;
    if (!id) return;
    this.setData({
      swipedId: "",
      popupEvents: withSwipeState(this.data.popupEvents, "")
    }, () => this.refreshCalendar({ skipCloud: true }));
    wx.navigateTo({ url: `/pages/scheduleAdd/scheduleAdd?id=${id}&mode=edit&dateKey=${occurrenceDateKey}` });
  },

  openScheduleEditor(e) {
    const id = e.currentTarget.dataset.id;
    const occurrenceDateKey = e.currentTarget.dataset.date || this.data.selectedDateKey;
    this.openScheduleEditorByData(id, occurrenceDateKey);
  },

  editSchedule(e) {
    if (this.preventScheduleTapUntil && Date.now() < this.preventScheduleTapUntil) return;
    this.openScheduleEditor(e);
  },

  longPressEditSchedule(e) {
    if (this.data.dragActive) return;
    clearTimeout(this.dragTimer);
    this.openScheduleEditor(e);
    this.preventScheduleTapUntil = Date.now() + 360;
  },

  deleteSchedule(e) {
    const id = e.currentTarget.dataset.id;
    const occurrenceDateKey = e.currentTarget.dataset.date || this.data.selectedDateKey;
    if (!id) return;
    const schedule = getItemById(KEYS.schedules, id);
    const repeatRule = schedule && schedule.repeatRule;
    const isRepeating = repeatRule && repeatRule.type && repeatRule.type !== "never";
    const closeSwipe = () => this.setData({
      swipedId: "",
      popupEvents: withSwipeState(this.data.popupEvents, "")
    }, () => this.refreshCalendar({ skipCloud: true }));
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
      title: "删除日程",
      content: "删除后该日期中的此日程将不再显示。",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        deleteAll("已删除");
      }
    });
  },

  openNoteEntry(e) {
    const id = e.currentTarget.dataset.id;
    const date = e.currentTarget.dataset.date || this.data.selectedDateKey || todayKey();
    const note = getBoundlessNoteById(id);
    if (!id) return;
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?id=${id}&date=${(note && note.date) || date}` });
  },

  createNoteEntry() {
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?date=${this.data.selectedDateKey || todayKey()}` });
  },

  openNoteSheet(note, mode) {
    if (!note || !note.id) return;
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?id=${note.id}&date=${note.date || this.data.selectedDateKey || todayKey()}` });
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
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?id=${note.id}&date=${note.date || this.data.selectedDateKey || todayKey()}` });
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
    if (!content.trim()) {
      wx.showToast({ title: "笔记为空", icon: "none" });
      return;
    }
    const note = this.data.editingNoteId
      ? updateBoundlessNote(this.data.editingNoteId, { content })
      : createBoundlessNote(this.data.editingNoteDate, { content });
    if (!note) return;
    api.note.create({
      id: note.cloudId || "",
      clientId: note.id,
      date: note.date,
      type: "boundless",
      content: note.content,
      attachments: note.attachments || []
    }).catch(() => {});
    this.setData({
      noteSheetMode: "view",
      selectedNote: note,
      editingNoteId: note.id,
      editingNoteDate: note.date,
      editingNoteContent: note.content || "",
      noteSavedContent: note.content || "",
      noteDirty: false,
      selectedNotes: notesForDate(this.data.selectedDateKey)
    }, () => this.refreshCalendar());
    wx.showToast({ title: "已保存", icon: "success" });
  },

  deleteNoteEntry(e) {
    const id = e.currentTarget.dataset.id;
    const note = getBoundlessNoteById(id) || { id };
    this.confirmDeleteNote(note);
  },

  deleteNoteSheet() {
    const note = this.data.selectedNote || {};
    if (!note.id) return;
    this.confirmDeleteNote(note);
  },

  confirmDeleteNote(note) {
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
        this.setData({
          selectedNotes: notesForDate(this.data.selectedDateKey),
          selectedNote: {}
        }, () => this.refreshCalendar());
        this.hideNoteSheet();
        wx.showToast({ title: "已删除", icon: "success" });
      }
    });
  }
});
