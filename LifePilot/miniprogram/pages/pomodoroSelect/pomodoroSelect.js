const { getSafeAreaLayout } = require("../../utils/safeArea");

const OPTIONS = {
  study: { category: "study", title: "学习番茄钟", durationMinutes: 25 },
  sport: { category: "sport", title: "运动番茄钟", durationMinutes: 20 },
  entertainment: { category: "entertainment", title: "娱乐番茄钟", durationMinutes: 15 },
  sleep: { category: "sleep", title: "睡眠番茄钟", durationMinutes: 30 }
};

Page({
  data: {
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
    wx.navigateBack();
  },

  startTimer(e) {
    const type = e.currentTarget.dataset.type;
    const option = OPTIONS[type];
    if (!option) {
      wx.showToast({ title: "模式不存在", icon: "none" });
      return;
    }
    wx.redirectTo({
      url: `/pages/pomodoroTimer/pomodoroTimer?category=${option.category}&title=${encodeURIComponent(option.title)}&durationMinutes=${option.durationMinutes}`
    });
  }
});
