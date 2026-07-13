const { buildModuleDetail } = require("../../utils/activityStats");
const { getSafeAreaLayout } = require("../../utils/safeArea");
const { api } = require("../../utils/cloud");
const { mergeRecordsToStorage } = require("../../utils/storage");

Page({
  data: {
    detail: {
      label: "",
      metrics: [],
      chart: { points: [], segments: [] },
      records: []
    },
    module: "study",
    topBarStyle: "",
    leftActionStyle: ""
  },

  onLoad(query) {
    const layout = getSafeAreaLayout();
    this.setData({
      module: query.module || "study",
      topBarStyle: layout.topBarStyle,
      leftActionStyle: layout.leftActionStyle
    });
    this.refreshDetail();
  },

  onShow() {
    this.refreshDetail();
  },

  refreshDetail() {
    const detail = buildModuleDetail(this.data.module);
    this.setData({ detail });
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
      this.setData({ detail: buildModuleDetail(this.data.module) });
    }).catch((error) => {
      console.warn("module record cloud list fallback to local", error.message);
    });
  },

  goBack() {
    wx.navigateBack();
  },

  goRecord() {
    wx.navigateTo({ url: `/pages/recordModule/recordModule?module=${this.data.module}` });
  }
});
