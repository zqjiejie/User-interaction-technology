const { buildDiscoverData } = require("../../utils/activityStats");
const { api } = require("../../utils/cloud");
const { mergeRecordsToStorage } = require("../../utils/storage");

const MODULE_META = {
  study: { icon: "学", status: "专注投入", color: "#ef4444" },
  sport: { icon: "动", status: "保持活力", color: "#16a34a" },
  entertainment: { icon: "娱", status: "放松节奏", color: "#f59e0b" },
  sleep: { icon: "眠", status: "作息恢复", color: "#4f46e5" }
};

function enrichModules(modules) {
  return (modules || []).map((item) => {
    const meta = MODULE_META[item.key] || { icon: "记", status: "持续记录", color: "#64748b" };
    return Object.assign({}, item, meta);
  });
}

Page({
  data: {
    overview: {},
    modules: [],
    days: []
  },

  onLoad() {
    this.refreshStats();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.refreshStats();
  },

  onPullDownRefresh() {
    this.refreshStats();
    wx.stopPullDownRefresh();
  },

  refreshStats() {
    const data = buildDiscoverData();
    this.setData({
      overview: data.overview,
      modules: enrichModules(data.modules),
      days: data.days
    });
    this.syncCloudRecords();
  },

  syncCloudRecords() {
    Promise.all([
      api.record.listRecords({ limit: 120 }),
      api.record.listPomodoro({ limit: 100 })
    ]).then((results) => {
      const manual = (results[0] && results[0].data && results[0].data.records) || [];
      const pomodoro = (results[1] && results[1].data && results[1].data.records) || [];
      if (!manual.length && !pomodoro.length) return;
      mergeRecordsToStorage(manual.concat(pomodoro));
      const data = buildDiscoverData();
      this.setData({
        overview: data.overview,
        modules: enrichModules(data.modules),
        days: data.days
      });
    }).catch((error) => {
      console.warn("record cloud list fallback to local", error.message);
    });
  },

  goModule(e) {
    const module = e.currentTarget.dataset.module;
    if (!module) return;
    wx.navigateTo({ url: `/pages/discoverModule/discoverModule?module=${module}` });
  },

  goPomodoro() {
    wx.preloadSkylineView && wx.preloadSkylineView();
    wx.navigateTo({ url: "/pages/pomodoroSelect/pomodoroSelect" });
  }
});
