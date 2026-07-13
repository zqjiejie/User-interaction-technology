const { KEYS, readList, writeList, getItemById, listBoundlessNotes } = require("../../utils/storage");
const { api } = require("../../utils/cloud");
const { normalizeScheduleItem, dedupeByTypeAndSearchIndex } = require("../../utils/scheduleIndex");
const { getSafeAreaLayout } = require("../../utils/safeArea");

function includesKeyword(item, keyword) {
  const target = [
    item.title,
    item.name,
    item.type,
    item.location,
    item.date,
    item.startTime,
    item.endTime,
    item.remindAt,
    item.note,
    item.content
  ].filter(Boolean).join(" ").toLowerCase();
  return target.includes(keyword.toLowerCase());
}

function normalizeNoteItem(item) {
  const searchIndexId = item.cloudId || item._id || item.id || item.clientId || `${item.date}-${item.updatedAt || item.createdAt || ""}`;
  return Object.assign({}, item, {
    id: item.id || searchIndexId,
    title: (item.content || "无边记").slice(0, 28) || "无边记",
    source: "无边记",
    resultType: "note",
    searchIndexId,
    date: item.date || "",
    startTime: "",
    location: ""
  });
}

function ensureEditableSchedule(item) {
  const id = item.id || item.clientId || item._id || item.cloudId || item.searchIndexId;
  if (!id || getItemById(KEYS.schedules, id)) return id;
  const schedules = readList(KEYS.schedules, []);
  const dateKey = item.startDateKey || item.dateKey || item.date || "";
  const editable = Object.assign({}, item, {
    id,
    clientId: item.clientId || id,
    cloudId: item.cloudId || item._id || "",
    title: item.title || item.name || item.courseName || "未命名日程",
    date: item.date || dateKey,
    dateKey,
    startDateKey: dateKey,
    endDateKey: item.endDateKey || dateKey,
    startTime: item.startTime || item.start || "",
    endTime: item.endTime || item.end || "",
    location: item.location || item.classroom || "",
    repeatRule: item.repeatRule || { type: "never", interval: 1, endDate: "" },
    excludedDates: Array.isArray(item.excludedDates) ? item.excludedDates : []
  });
  writeList(KEYS.schedules, [editable].concat(schedules));
  return id;
}

Page({
  data: {
    keyword: "",
    results: [],
    searched: false,
    loading: false,
    topBarStyle: "",
    leftActionStyle: ""
  },

  onLoad() {
    const layout = getSafeAreaLayout();
    this.setData({
      topBarStyle: layout.topBarStyle,
      leftActionStyle: layout.leftActionStyle
    });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/pages/home/home" });
    }
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onConfirm() {
    this.search();
  },

  async search() {
    const keyword = this.data.keyword.trim();
    if (!keyword) {
      this.setData({ results: [], searched: false });
      return;
    }

    const localSchedules = readList(KEYS.schedules, []);
    const localCourses = readList(KEYS.courses, []);
    const localResults = localSchedules
      .map((item) => normalizeScheduleItem(item, "schedule"))
      .concat(localCourses.map((item) => normalizeScheduleItem(Object.assign({}, item, { title: item.title || item.name }), "course")))
      .filter((item) => includesKeyword(item, keyword));
    const localNotes = listBoundlessNotes()
      .map(normalizeNoteItem)
      .filter((item) => includesKeyword(item, keyword));

    this.setData({ loading: true, searched: true });

    let cloudResults = [];
    try {
      const res = await api.schedule.search(keyword);
      cloudResults = ((res.data && res.data.results) || []).map((item) => normalizeScheduleItem(item, item.type || "schedule"));
    } catch (error) {
      console.warn("scheduleService search fallback to local", error.message);
    }

    const results = dedupeByTypeAndSearchIndex(localResults.concat(cloudResults, localNotes));

    this.setData({ results, loading: false });
  },

  clearKeyword() {
    this.setData({ keyword: "", results: [], searched: false });
  },

  openResult(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.results[index];
    if (!item) return;
    if (item.resultType === "note") {
      const id = item.id || item.clientId || item.searchIndexId;
      const date = item.date || "";
      if (!id) {
        wx.showToast({ title: "未找到无边记", icon: "none" });
        return;
      }
      wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?id=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}` });
      return;
    }

    const id = ensureEditableSchedule(item);
    const dateKey = item.startDateKey || item.dateKey || item.date || "";
    if (!id) {
      wx.showToast({ title: "未找到日程", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/scheduleAdd/scheduleAdd?id=${encodeURIComponent(id)}&mode=edit&dateKey=${encodeURIComponent(dateKey)}` });
  }
});
