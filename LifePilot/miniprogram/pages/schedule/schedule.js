const { KEYS, readList, writeList, removeItem, appendItem } = require("../../utils/storage");
const { api } = require("../../utils/cloud");

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function normalizeDateKey(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const parts = text.split("-");
    return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }
  if (/^\d+年\d+月\d+日$/.test(text)) {
    const parts = text.match(/\d+/g).map(Number);
    return `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`;
  }
  return "";
}

function formatDateLabel(dateKey) {
  const parts = String(dateKey || "").split("-");
  if (parts.length !== 3) return dateKey || "未定日期";
  return `${Number(parts[0])}年${Number(parts[1])}月${Number(parts[2])}日`;
}

function buildFallbackId(item) {
  return [
    item.dateKey || item.startDateKey || item.date || "",
    item.startTime || item.start || "",
    item.endTime || item.end || "",
    item.title || item.name || item.courseName || ""
  ].join("|");
}

function normalizeItem(item, sourceKey) {
  const rawDate = item.startDateKey || item.dateKey || item.date || "";
  const dateKey = normalizeDateKey(rawDate);
  const id = item.clientId || item.id || item._id || item.cloudId || item.searchIndexId || buildFallbackId(item);
  const title = item.title || item.courseName || item.name || "未命名日程";
  const startTime = item.startTime || item.start || "";
  const endTime = item.endTime || item.end || "";
  const location = item.location || item.classroom || item.note || "";
  return {
    id,
    sourceKey,
    raw: item,
    title,
    dateKey,
    startDateKey: dateKey,
    dateLabel: formatDateLabel(dateKey),
    startTime,
    endTime,
    timeText: startTime || endTime ? `${startTime || "--:--"}${endTime ? ` - ${endTime}` : ""}` : "未定时间",
    location,
    metaText: location || item.teacher || item.description || "暂无地点或备注"
  };
}

function courseToSchedule(course) {
  const dateKey = normalizeDateKey(course.startDateKey || course.dateKey || course.date);
  const parts = dateKey ? dateKey.split("-").map(Number) : [];
  const id = course.clientId || course.id || course._id || `s${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    id,
    clientId: id,
    title: course.title || course.courseName || course.name || "未命名日程",
    type: "schedule",
    date: dateKey,
    dateKey,
    year: parts[0] || "",
    month: parts[1] || "",
    day: parts[2] || "",
    startDateKey: dateKey,
    endDateKey: dateKey,
    startTime: course.startTime || course.start || "",
    endTime: course.endTime || course.end || "",
    location: course.location || course.classroom || "",
    note: course.note || course.teacher || "",
    reminder: course.reminder || "不提醒",
    repeat: course.repeat || "永不重复",
    repeatRule: course.repeatRule || { type: "never", interval: 1, endDate: "" },
    allDay: !!course.allDay,
    status: course.status || "todo",
    source: "all-schedules"
  };
}

function sortItems(a, b) {
  const dateCompare = String(a.dateKey || "9999-99-99").localeCompare(String(b.dateKey || "9999-99-99"));
  if (dateCompare) return dateCompare;
  return String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99"));
}

Page({
  data: {
    items: [],
    loading: false,
    touchStartX: 0,
    touchStartY: 0
  },

  onShow() {
    this.loadAllSchedules();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: "/pages/mine/mine" });
  },

  loadAllSchedules() {
    this.setData({ loading: true });
    const schedules = readList(KEYS.schedules, []).map((item) => normalizeItem(item, KEYS.schedules));
    const courses = readList(KEYS.courses, []).map((item) => normalizeItem(item, KEYS.courses));
    this.setData({
      items: schedules.concat(courses).filter((item) => !item.raw.isDeleted).sort(sortItems),
      loading: false
    });
  },

  onItemTouchStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    this.setData({
      touchStartX: touch.clientX,
      touchStartY: touch.clientY
    });
  },

  onItemTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - this.data.touchStartX;
    const deltaY = touch.clientY - this.data.touchStartY;
    if (deltaX < -60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.8) {
      this.confirmDeleteSchedule(e);
    }
  },

  editSchedule(e) {
    const id = e.currentTarget.dataset.id;
    const dateKey = e.currentTarget.dataset.date;
    const sourceKey = e.currentTarget.dataset.source;
    if (!id) {
      wx.showToast({ title: "未找到日程", icon: "none" });
      return;
    }
    const nextId = sourceKey === KEYS.courses ? this.promoteCourseToSchedule(id) : id;
    if (!nextId) {
      wx.showToast({ title: "未找到日程", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/scheduleAdd/scheduleAdd?id=${nextId}&mode=edit&dateKey=${dateKey || ""}` });
  },

  promoteCourseToSchedule(id) {
    const courses = readList(KEYS.courses, []);
    const course = courses.find((item) => String(item.clientId || item.id || item._id || item.cloudId || buildFallbackId(item)) === String(id));
    if (!course) return "";
    const schedule = courseToSchedule(course);
    appendItem(KEYS.schedules, schedule);
    writeList(KEYS.courses, courses.filter((item) => item !== course));
    api.schedule.create(schedule).catch((error) => {
      console.warn("course promote create pending local only", error.message);
    });
    this.loadAllSchedules();
    return schedule.id;
  },

  confirmDeleteSchedule(e) {
    const id = e.currentTarget.dataset.id;
    const sourceKey = e.currentTarget.dataset.source;
    if (!id) {
      wx.showToast({ title: "未找到日程", icon: "none" });
      return;
    }
    wx.showModal({
      title: "删除日程",
      content: "删除后该日程将不再显示，是否继续？",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        this.deleteScheduleById(id, sourceKey);
      }
    });
  },

  deleteScheduleById(id, sourceKey) {
    try {
      if (sourceKey === KEYS.courses) {
        removeItem(KEYS.courses, id);
      } else {
        removeItem(KEYS.schedules, id);
        api.schedule.delete(id).catch((error) => {
          console.warn("schedule delete pending local only", error.message);
        });
      }
      this.loadAllSchedules();
      wx.showToast({ title: "已删除", icon: "success" });
    } catch (error) {
      console.warn("delete schedule failed", error);
      wx.showToast({ title: "删除失败，请稍后重试", icon: "none" });
    }
  }
});
