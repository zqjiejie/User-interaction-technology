const { KEYS, readList } = require("../../utils/storage");

function buildEntertainment() {
  const app = getApp();
  const user = app.globalData.user || {};
  const entertainmentLimit = Number(user.entertainmentLimit || 600);
  const dailyLimit = Math.round(entertainmentLimit / 7);
  const records = readList(KEYS.records, []).slice(0, 7);
  const today = records[0] || {};
  const total = records.reduce((sum, item) => sum + Number(item.entertainmentMinutes || 0), 0);
  const types = [...new Set(records.map((item) => item.entertainmentType).filter(Boolean))];
  const peakRecord = records.reduce((current, item) =>
    Number(item.entertainmentMinutes || 0) > Number(current.entertainmentMinutes || 0) ? item : current
  , {});
  return {
    todayMinutes: Number(today.entertainmentMinutes || 0),
    limitMinutes: dailyLimit,
    weeklyMinutes: total,
    peak: peakRecord.date || "暂无",
    types: types.length ? types : [],
    advice: total > entertainmentLimit
      ? "本周娱乐时长偏高，建议把睡前娱乐提前结束。"
      : "娱乐时长仍在目标范围内，注意保持睡前缓冲。"
  };
}

function buildDistribution() {
  const records = readList(KEYS.records, []).slice(0, 7);
  const typeMap = {};
  records.forEach((item) => {
    const t = item.entertainmentType;
    if (t) {
      typeMap[t] = (typeMap[t] || 0) + Number(item.entertainmentMinutes || 0);
    }
  });
  const entries = Object.entries(typeMap);
  if (entries.length === 0) return [];
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  return entries.map(([label, value]) => ({
    label,
    value: Math.round((value / total) * 100)
  }));
}

Page({
  data: {
    entertainment: buildEntertainment(),
    distribution: buildDistribution()
  },

  onShow() {
    this.setData({
      entertainment: buildEntertainment(),
      distribution: buildDistribution()
    });
  },

  addEntertainment() {
    wx.navigateTo({ url: "/pages/record/record" });
  }
});
