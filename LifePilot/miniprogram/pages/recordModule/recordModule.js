const { KEYS, appendItem } = require("../../utils/storage");
const { formatDate } = require("../../utils/date");
const { api } = require("../../utils/cloud");
const { getSafeAreaLayout } = require("../../utils/safeArea");

const MODULES = {
  study: {
    label: "学习",
    titlePlaceholder: "课程、任务或学习项目",
    durationLabel: "学习时长",
    unitLabel: "分钟",
    unit: "minute",
    image: "/assets/record/study-deco.svg",
    theme: "study"
  },
  sleep: {
    label: "睡眠",
    titlePlaceholder: "入睡情况或睡眠备注",
    durationLabel: "睡眠时长",
    unitLabel: "小时",
    unit: "hour",
    image: "/assets/record/sleep-deco.svg",
    theme: "sleep"
  },
  sport: {
    label: "运动",
    titlePlaceholder: "跑步、球类或运动项目",
    durationLabel: "运动时长",
    unitLabel: "分钟",
    unit: "minute",
    image: "/assets/record/sport-deco.svg",
    theme: "sport"
  },
  entertainment: {
    label: "娱乐",
    titlePlaceholder: "音乐、游戏、电影或休闲内容",
    durationLabel: "娱乐时长",
    unitLabel: "分钟",
    unit: "minute",
    image: "/assets/record/entertainment-deco.svg",
    theme: "entertainment"
  }
};

function createId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function cloudPayload(module, value) {
  const minutes = module === "sleep" ? 0 : Number(value.duration || 0);
  const sleepHours = module === "sleep" ? Number(value.duration || 0) : 0;
  const payload = {
    date: value.date,
    mood: value.title || value.note || ""
  };
  if (module === "study") payload.studyMinutes = minutes;
  if (module === "sport") {
    payload.exerciseMinutes = minutes;
    payload.sportMinutes = minutes;
  }
  if (module === "entertainment") payload.entertainmentMinutes = minutes;
  if (module === "sleep") payload.sleepHours = sleepHours;
  return payload;
}

Page({
  data: {
    module: "study",
    config: MODULES.study,
    title: "",
    duration: "",
    date: formatDate(new Date()),
    startTime: "",
    endTime: "",
    note: "",
    topBarStyle: "",
    leftActionStyle: ""
  },

  onLoad(query) {
    const module = MODULES[query.module] ? query.module : "study";
    const layout = getSafeAreaLayout();
    this.setData({
      module,
      config: MODULES[module],
      title: "",
      duration: "",
      date: formatDate(new Date()),
      startTime: "",
      endTime: "",
      note: "",
      topBarStyle: layout.topBarStyle,
      leftActionStyle: layout.leftActionStyle
    });
  },

  updateField(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  onStartTimeChange(e) {
    this.setData({ startTime: e.detail.value });
  },

  onEndTimeChange(e) {
    this.setData({ endTime: e.detail.value });
  },

  goBack() {
    wx.navigateBack();
  },

  saveRecord() {
    const duration = Number(this.data.duration);
    if (!this.data.title.trim()) {
      wx.showToast({ title: "请填写内容", icon: "none" });
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      wx.showToast({ title: "请填写有效时长", icon: "none" });
      return;
    }
    const id = createId("record-");
    const now = new Date().toISOString();
    const record = {
      id,
      clientId: id,
      module: this.data.module,
      type: this.data.module,
      title: this.data.title.trim(),
      minutes: this.data.module === "sleep" ? Math.round(duration * 60) : duration,
      duration,
      unit: this.data.config.unit,
      date: this.data.date,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      note: this.data.note.trim(),
      source: "manual",
      createdAt: now,
      updatedAt: now
    };
    appendItem(KEYS.records, record);
    api.record.create(cloudPayload(this.data.module, record)).catch((error) => {
      console.warn("record create pending local only", error.message);
    });
    wx.showToast({ title: "已保存", icon: "success" });
    this.setData({ title: "", duration: "", startTime: "", endTime: "", note: "" });
  }
});
