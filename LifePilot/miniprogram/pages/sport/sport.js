const { KEYS, readList } = require("../../utils/storage");

function buildSport() {
  const app = getApp();
  const user = app.globalData.user || {};
  const sportGoal = Number(user.sportGoal || 3);
  const records = readList(KEYS.records, []).slice(0, 7);
  const today = records[0] || {};
  const weeklyTimes = records.filter((item) => Number(item.exerciseMinutes || 0) > 0).length;
  const total = records.reduce((sum, item) => sum + Number(item.exerciseMinutes || 0), 0);
  const types = [...new Set(records.filter((item) => Number(item.exerciseMinutes || 0) > 0).map((item) => item.exerciseType).filter(Boolean))];
  return {
    todayMinutes: Number(today.exerciseMinutes || 0),
    weeklyTimes,
    goalTimes: sportGoal,
    calories: Math.round(total * 7.5),
    types: types.length ? types : [],
    advice: weeklyTimes < sportGoal
      ? `本周已运动 ${weeklyTimes} 次，距离目标还差 ${sportGoal - weeklyTimes} 次。`
      : "本周运动目标已达成，注意拉伸和恢复。"
  };
}

function buildTrend() {
  return readList(KEYS.records, []).slice(0, 7).reverse().map((item) => ({
    label: item.date,
    value: Math.min(100, Math.round((Number(item.exerciseMinutes || 0) / 60) * 100))
  }));
}

Page({
  data: {
    sport: buildSport(),
    trend: buildTrend()
  },

  onShow() {
    this.setData({
      sport: buildSport(),
      trend: buildTrend()
    });
  },

  addSport() {
    wx.navigateTo({ url: "/pages/record/record" });
  }
});
