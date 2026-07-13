const { api } = require("../../utils/cloud");
const { buildWeeklyReportData, buildFallback } = require("../../utils/weeklyReportData");

function formatMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}min` : `${hours}h`;
  }
  return `${minutes}min`;
}

function metricCards(input) {
  const stats = input.stats || {};
  return [
    { label: "总时长", value: formatMinutes(stats.totalMinutes) },
    { label: "番茄钟", value: formatMinutes(stats.pomodoroMinutes) },
    { label: "日程", value: `${stats.scheduleCount || 0}` },
    { label: "无边记", value: `${stats.noteCount || 0}` }
  ];
}

function moduleCards(input) {
  const stats = input.stats || {};
  return [
    { label: "学习", value: formatMinutes(stats.studyMinutes), cls: "study" },
    { label: "运动", value: formatMinutes(stats.sportMinutes), cls: "sport" },
    { label: "睡眠", value: `${stats.sleepAverageHours || 0}h`, cls: "sleep" },
    { label: "娱乐", value: formatMinutes(stats.entertainmentMinutes), cls: "entertainment" },
    { label: "日程", value: `${stats.scheduleCount || 0} 项`, cls: "schedule" },
    { label: "无边记", value: `${stats.noteCount || 0} 条`, cls: "note" },
    { label: "番茄钟", value: `${stats.pomodoroCount || 0} 次`, cls: "focus" }
  ];
}

function buildShareText(input, report) {
  const stats = input.stats || {};
  return [
    `本周周报 ${input.weekStart} - ${input.weekEnd}`,
    `总时长：${formatMinutes(stats.totalMinutes)}`,
    `日程：${stats.scheduleCount || 0} 个，无边记：${stats.noteCount || 0} 条`,
    `番茄钟：${formatMinutes(stats.pomodoroMinutes)}`,
    report.shareText || report.summary || ""
  ].filter(Boolean).join("\n");
}

function listOrFallback(list, fallback) {
  return Array.isArray(list) && list.length ? list : [fallback];
}

function buildReportSlides(input, report) {
  const stats = input.stats || {};
  const daily = input.daily || [];
  const bestDay = daily.slice().sort((a, b) => {
    const left = Number(a.studyMinutes || 0) + Number(a.sportMinutes || 0);
    const right = Number(b.studyMinutes || 0) + Number(b.sportMinutes || 0);
    return right - left;
  })[0] || {};
  return [
    {
      key: "overview",
      eyebrow: "Overview",
      title: "这一周的整体节奏",
      summary: report.summary || "本周数据已经整理完成，可以从学习、日程和专注三个角度回看。",
      items: [
        `总记录时长 ${formatMinutes(stats.totalMinutes)}`,
        `日程 ${stats.scheduleCount || 0} 项，无边记 ${stats.noteCount || 0} 条`,
        `番茄钟 ${formatMinutes(stats.pomodoroMinutes)}`
      ]
    },
    {
      key: "study",
      eyebrow: "Study",
      title: "学习与专注",
      summary: "把投入时间和番茄钟放在一起看，更容易判断这一周是否真的进入了学习状态。",
      items: listOrFallback(report.focusInsights, `学习 ${formatMinutes(stats.studyMinutes)}，番茄钟 ${stats.pomodoroCount || 0} 次`)
    },
    {
      key: "schedule",
      eyebrow: "Schedule",
      title: "日程安排",
      summary: "这一页帮助你回看安排是否过密、是否有临时任务挤压了原计划。",
      items: listOrFallback(report.scheduleInsights, `本周共有 ${stats.scheduleCount || 0} 个日程`)
    },
    {
      key: "note",
      eyebrow: "Notes",
      title: "无边记线索",
      summary: "无边记更像真实想法的切片，适合用来发现情绪、任务和灵感的重复主题。",
      items: listOrFallback(report.noteInsights, `本周留下 ${stats.noteCount || 0} 条无边记`)
    },
    {
      key: "next",
      eyebrow: "Next",
      title: "写给下周",
      summary: report.nextWeekFocus || "下周可以选择一个最重要的方向，先做小而明确的推进。",
      items: [
        bestDay.date ? `本周相对活跃的一天：${bestDay.date}` : "继续记录后会出现更清晰的高峰日",
        ...listOrFallback(report.suggestions, "保持今天优先，减少一次性安排过多任务")
      ]
    }
  ];
}

Page({
  data: {
    rangeText: "",
    aiInput: {},
    report: {},
    metricCards: [],
    moduleCards: [],
    reportSlides: [],
    reportOpened: false,
    reportRevealClass: "",
    activeSlide: 0,
    daily: [],
    generating: false,
    shareText: "",
    decoImage: "/assets/report/weekly-report-deco.svg"
  },

  onShow() {
    this.loadLocalReport();
  },

  loadLocalReport() {
    const data = buildWeeklyReportData(new Date());
    const report = data.fallback || buildFallback(data.aiInput);
    this.setData({
      rangeText: data.range.rangeText,
      aiInput: data.aiInput,
      report,
      metricCards: metricCards(data.aiInput),
      moduleCards: moduleCards(data.aiInput),
      reportSlides: buildReportSlides(data.aiInput, report),
      daily: data.aiInput.daily,
      shareText: buildShareText(data.aiInput, report)
    });
  },

  openWeeklyReport() {
    if (this.data.generating) return;
    this.setData({
      reportOpened: true,
      reportRevealClass: "is-revealing",
      activeSlide: 0
    });
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => {
      this.setData({ reportRevealClass: "" });
    }, 520);
  },

  generateAIReport() {
    if (this.data.generating) return;
    this.setData({ generating: true });
    wx.showLoading({ title: "正在生成周报..." });
    api.report.generateWeeklyReport(this.data.aiInput).then((res) => {
      const report = (res && res.data) || {};
      if (report.success === false) {
        throw new Error(report.message || "generate failed");
      }
      this.setData({
        report,
        shareText: buildShareText(this.data.aiInput, report),
        reportSlides: buildReportSlides(this.data.aiInput, report)
      });
      wx.showToast({ title: "已生成", icon: "success" });
    }).catch((error) => {
      console.warn("AI weekly report fallback", error.message);
      wx.showToast({ title: "周报生成失败，请稍后重试", icon: "none" });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ generating: false });
    });
  },

  generateShareText() {
    if (this.data.shareText) {
      wx.showToast({ title: "分享文案已生成", icon: "none" });
      return;
    }
    const text = buildShareText(this.data.aiInput, this.data.report || {});
    this.setData({ shareText: text });
  },

  copyShareText() {
    const text = this.data.shareText || buildShareText(this.data.aiInput, this.data.report || {});
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: "已复制", icon: "success" });
      }
    });
  },

  onSlideChange(e) {
    this.setData({ activeSlide: e.detail.current || 0 });
  },

  prevSlide() {
    this.setData({ activeSlide: Math.max(0, this.data.activeSlide - 1) });
  },

  nextSlide() {
    const max = Math.max(0, this.data.reportSlides.length - 1);
    this.setData({ activeSlide: Math.min(max, this.data.activeSlide + 1) });
  },

  shareCurrentReport() {
    wx.showShareMenu && wx.showShareMenu({ withShareTicket: true });
    wx.showToast({ title: "请使用右上角或底部分享", icon: "none" });
  },

  saveReportPoster() {
    const text = this.data.shareText || buildShareText(this.data.aiInput, this.data.report || {});
    const ctx = wx.createCanvasContext("reportPoster", this);
    const width = 320;
    const height = 520;
    ctx.setFillStyle("#ffffff");
    ctx.fillRect(0, 0, width, height);
    ctx.setFillStyle("#ef4444");
    ctx.setFontSize(24);
    ctx.fillText("CampusMind 本周周报", 24, 48);
    ctx.setFillStyle("#64748b");
    ctx.setFontSize(13);
    ctx.fillText(this.data.rangeText || "", 24, 76);
    ctx.setFillStyle("#111827");
    ctx.setFontSize(15);
    const lines = String(text || "").split("\n").join(" ").match(/.{1,21}/g) || [];
    lines.slice(0, 18).forEach((line, index) => {
      ctx.fillText(line, 24, 116 + index * 24);
    });
    ctx.setFillStyle("#fff7d6");
    ctx.fillRect(24, 460, 272, 36);
    ctx.setFillStyle("#a16207");
    ctx.setFontSize(13);
    ctx.fillText("保存自 CampusMind", 88, 483);
    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: "reportPoster",
        width,
        height,
        destWidth: 640,
        destHeight: 1040,
        success: (res) => {
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => wx.showToast({ title: "已保存图片", icon: "success" }),
            fail: () => wx.showToast({ title: "请允许保存到相册", icon: "none" })
          });
        },
        fail: () => wx.showToast({ title: "图片生成失败", icon: "none" })
      }, this);
    });
  },

  onShareAppMessage() {
    return {
      title: "我的 CampusMind 本周周报",
      path: "/pages/report/report",
      imageUrl: this.data.decoImage
    };
  }
});
