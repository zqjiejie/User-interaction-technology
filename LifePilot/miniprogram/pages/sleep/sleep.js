const { KEYS, readList } = require("../../utils/storage");

function buildSleep() {
  const app = getApp();
  const user = app.globalData.user || {};
  const sleepGoal = Number(user.sleepGoal || 8);
  const records = readList(KEYS.records, []).slice(0, 7);
  const today = records[0] || {};
  const avg = records.length
    ? records.reduce((sum, item) => sum + Number(item.sleepHours || 0), 0) / records.length
    : 0;
  return {
    lastNightHours: Number(today.sleepHours || 0),
    averageHours: Number(avg.toFixed(1)),
    score: Math.min(100, Math.round((avg / sleepGoal) * 100)),
    bedTime: today.bedTime || "--:--",
    wakeTime: today.wakeTime || "--:--",
    advice: avg < sleepGoal - 1
      ? `平均睡眠不足 ${sleepGoal - 1} 小时，建议固定入睡提醒。`
      : "本周睡眠较稳定，继续保持良好作息。"
  };
}

function buildTrend() {
  const app = getApp();
  const user = app.globalData.user || {};
  const sleepGoal = Number(user.sleepGoal || 8);
  return readList(KEYS.records, []).slice(0, 7).reverse().map((item) => ({
    label: item.date,
    value: Math.min(100, Math.round((Number(item.sleepHours || 0) / sleepGoal) * 100))
  }));
}

Page({
  data: {
    sleep: buildSleep(),
    trend: buildTrend()
  },

  onShow() {
    this.setData({
      sleep: buildSleep(),
      trend: buildTrend()
    });
  },

  addSleep() {
    wx.navigateTo({ url: "/pages/record/record" });
  }
});
