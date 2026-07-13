const { KEYS, readList, mergeRecordsToStorage } = require("../../utils/storage");
const { formatDate } = require("../../utils/date");
const { api } = require("../../utils/cloud");

const modules = [
  { key: "study", label: "学习", desc: "课程、作业、阅读与复习", cls: "study" },
  { key: "sleep", label: "睡眠", desc: "睡眠时长与休息状态", cls: "sleep" },
  { key: "sport", label: "运动", desc: "跑步、球类和日常活动", cls: "sport" },
  { key: "entertainment", label: "娱乐", desc: "音乐、游戏、电影和放松", cls: "entertainment" }
];

function recordTitle(item) {
  if (item.title) return item.title;
  if (item.source === "pomodoro") return "番茄钟";
  return item.mood || "生活记录";
}

function recordMeta(item) {
  if (item.module || item.type) {
    const value = item.module || item.type;
    const label = modules.find((module) => module.key === value);
    return label ? label.label : value;
  }
  return [
    item.studyMinutes ? `学习 ${item.studyMinutes} 分钟` : "",
    item.exerciseMinutes || item.sportMinutes ? `运动 ${item.exerciseMinutes || item.sportMinutes} 分钟` : "",
    item.entertainmentMinutes ? `娱乐 ${item.entertainmentMinutes} 分钟` : "",
    item.sleepHours ? `睡眠 ${item.sleepHours} 小时` : ""
  ].filter(Boolean).join(" · ");
}

Page({
  data: {
    modules,
    today: formatDate(new Date()),
    recent: []
  },

  onShow() {
    this.refreshRecords();
  },

  refreshRecent() {
    const recent = readList(KEYS.records, []).slice(0, 8).map((item) => Object.assign({}, item, {
      displayTitle: recordTitle(item),
      displayMeta: recordMeta(item),
      displayDate: item.date || item.dateKey || String(item.createdAt || "").slice(0, 10)
    }));
    this.setData({ recent });
  },

  refreshRecords() {
    this.refreshRecent();
    Promise.all([
      api.record.listRecords({ limit: 120 }),
      api.record.listPomodoro({ limit: 100 })
    ]).then((results) => {
      const manual = (results[0] && results[0].data && results[0].data.records) || [];
      const pomodoro = (results[1] && results[1].data && results[1].data.records) || [];
      if (!manual.length && !pomodoro.length) return;
      mergeRecordsToStorage(manual.concat(pomodoro));
      this.refreshRecent();
    }).catch((error) => {
      console.warn("record cloud list fallback to local", error.message);
    });
  },

  openModule(e) {
    const module = e.currentTarget.dataset.module;
    wx.navigateTo({ url: `/pages/recordModule/recordModule?module=${module}` });
  }
});
