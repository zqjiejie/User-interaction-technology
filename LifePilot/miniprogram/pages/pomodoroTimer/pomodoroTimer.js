const { api } = require("../../utils/cloud");
const { getSafeAreaLayout } = require("../../utils/safeArea");
const { KEYS, appendItem } = require("../../utils/storage");

const THEMES = {
  study: { hint: "保持一段完整的专注时间。", cls: "theme-study" },
  sport: { hint: "跟随节奏，唤醒身体。", cls: "theme-sport" },
  entertainment: { hint: "适度放松，守住边界。", cls: "theme-entertainment" },
  sleep: { hint: "放缓呼吸，让夜晚沉静下来。", cls: "theme-sleep" }
};

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatElapsed(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

Page({
  data: {
    category: "",
    title: "",
    durationMinutes: 0,
    theme: {},
    elapsedText: "00:00",
    locked: true,
    error: "",
    topBarStyle: "",
    leftActionStyle: ""
  },

  timer: null,
  startedAt: 0,
  ending: false,

  onLoad(query) {
    const layout = getSafeAreaLayout();
    this.setData({
      topBarStyle: layout.topBarStyle,
      leftActionStyle: layout.leftActionStyle
    });
    const category = query.category || query.type || "";
    const title = decodeURIComponent(query.title || "");
    const durationMinutes = Number(query.durationMinutes);
    if (!THEMES[category] || !title || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      this.setData({
        locked: false,
        error: "番茄钟参数缺失，请返回重新选择模式。"
      });
      return;
    }
    this.startedAt = Date.now();
    this.setData({
      category,
      title,
      durationMinutes,
      theme: Object.assign({ title }, THEMES[category])
    });
    wx.hideHomeButton && wx.hideHomeButton();
    if (wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: "计时器运行中，退出前请确认。" });
    }
    this.startTick();
  },

  onShow() {
    this.updateElapsed();
  },

  onUnload() {
    this.stopTick();
  },

  startTick() {
    this.stopTick();
    this.timer = setInterval(() => this.updateElapsed(), 1000);
  },

  stopTick() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  updateElapsed() {
    const elapsed = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
    this.setData({ elapsedText: formatElapsed(elapsed) });
  },

  endTimer() {
    this.ending = true;
    this.stopTick();
    const durationMinutes = Math.max(1, Math.round((Date.now() - this.startedAt) / 60000));
    const now = new Date();
    const id = `pomodoro-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const localRecord = {
      id,
      clientId: id,
      source: "pomodoro",
      module: this.data.category,
      category: this.data.category,
      title: this.data.title,
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      durationMinutes,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: now.toISOString(),
      completed: true,
      exitReason: "ended_by_user"
    };
    appendItem(KEYS.records, localRecord);
    api.record.createPomodoro({
      clientId: id,
      category: this.data.category,
      durationMinutes,
      startedAt: localRecord.startedAt,
      endedAt: localRecord.endedAt,
      completed: true,
      exitReason: "ended_by_user"
    }).then((res) => {
      const cloudId = res && res.data && res.data.id;
      if (!cloudId) return;
      const records = wx.getStorageSync(KEYS.records) || [];
      wx.setStorageSync(KEYS.records, records.map((item) => (
        item.id === id ? Object.assign({}, item, { cloudId }) : item
      )));
    }).catch((error) => {
      console.warn("recordService createPomodoro pending local only", error.message);
    });
    if (wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload();
    }
    this.setData({ locked: false });
    wx.showToast({ title: "计时结束", icon: "success" });
    setTimeout(() => wx.navigateBack(), 450);
  },

  confirmExit() {
    if (this.data.error) {
      this.returnToSelect();
      return;
    }
    wx.showModal({
      title: "退出专注",
      content: "当前仍在专注计时，确定要退出吗？",
      confirmText: "退出",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        this.ending = true;
        this.stopTick();
        if (wx.disableAlertBeforeUnload) {
          wx.disableAlertBeforeUnload();
        }
        this.setData({ locked: false });
        this.returnToSelect();
      }
    });
  },

  returnToSelect() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: "/pages/pomodoroSelect/pomodoroSelect" });
    }
  }
});
