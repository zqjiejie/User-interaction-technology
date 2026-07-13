const { api } = require("../../utils/cloud");
const { pomodoroRecords, deletePomodoroRecord } = require("../../utils/activityStats");
const { mergeRecordsToStorage } = require("../../utils/storage");

Page({
  data: {
    records: [],
    loading: false,
    touchStartX: 0,
    touchStartY: 0
  },

  skipNextTap: false,

  onLoad() {
    this.refreshRecords();
  },

  onShow() {
    this.refreshRecords();
  },

  refreshList() {
    this.setData({ records: pomodoroRecords() });
  },

  refreshRecords() {
    this.refreshList();
    api.record.listPomodoro({ limit: 100 }).then((res) => {
      const records = (res && res.data && res.data.records) || [];
      if (!records.length) return;
      mergeRecordsToStorage(records);
      this.refreshList();
    }).catch((error) => {
      console.warn("pomodoro cloud list fallback to local", error.message);
    });
  },

  onRecordTouchStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    this.setData({
      touchStartX: touch.clientX,
      touchStartY: touch.clientY
    });
  },

  onRecordTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - this.data.touchStartX;
    const deltaY = touch.clientY - this.data.touchStartY;
    if (deltaX < -60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.8) {
      this.skipNextTap = true;
      this.confirmDeleteRecord(e.currentTarget.dataset.id, e.currentTarget.dataset.cloudId);
    }
  },

  confirmDeleteRecord(id, cloudId) {
    if (!id) {
      wx.showToast({ title: "未找到记录", icon: "none" });
      return;
    }
    wx.showModal({
      title: "删除番茄钟记录",
      content: "删除后该记录将无法恢复，是否继续？",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        this.deleteRecord(id, cloudId);
      }
    });
  },

  deleteRecord(id, cloudId) {
    try {
      deletePomodoroRecord(id);
      api.record.deletePomodoro(cloudId || id, { clientId: id }).catch((error) => {
        console.warn("pomodoro delete pending local only", error.message);
      });
      this.refreshList();
      wx.showToast({ title: "已删除", icon: "success" });
    } catch (error) {
      console.warn("delete pomodoro failed", error);
      wx.showToast({ title: "删除失败，请稍后重试", icon: "none" });
    }
  },

  openRecord() {
    if (this.skipNextTap) {
      this.skipNextTap = false;
    }
  },

  goPomodoro() {
    wx.navigateTo({ url: "/pages/pomodoroSelect/pomodoroSelect" });
  }
});
