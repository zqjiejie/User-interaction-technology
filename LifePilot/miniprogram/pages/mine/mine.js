const storage = require("../../utils/storage");
const { api } = require("../../utils/cloud");

const { KEYS, appendItem, listBoundlessNotes, deleteBoundlessNote } = storage;

const LOGIN_STATUS_KEY = "lifepilot_login_status";

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function pad(value) {
  const number = Number(value);
  return number < 10 ? `0${number}` : `${number}`;
}

function createId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function formatDateLabel(dateKey) {
  const parts = String(dateKey || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((item) => !item)) return "";
  return `${parts[0]}年${parts[1]}月${parts[2]}日`;
}

function parseDateParts(dateKey) {
  const parts = String(dateKey || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((item) => !item)) return null;
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function weekdayFromDateKey(dateKey) {
  const parts = parseDateParts(dateKey);
  if (!parts) return 0;
  const weekday = new Date(parts.year, parts.month - 1, parts.day).getDay();
  return weekday === 0 ? 7 : weekday;
}

function normalizeCourse(course) {
  const startDateKey = course.startDateKey || course.dateKey || "";
  const repeatRule = course.repeatRule || {};
  const repeatEndDate = repeatRule.endDate || course.repeatEndDateKey || startDateKey;
  const weekday = Number(course.weekday || 0) || weekdayFromDateKey(startDateKey);
  return Object.assign({}, course, {
    title: String(course.title || "").trim(),
    location: String(course.location || "").trim(),
    weekday: weekday >= 1 && weekday <= 7 ? weekday : 0,
    startDateKey,
    endDateKey: startDateKey,
    startTime: course.startTime || "",
    endTime: course.endTime || "",
    repeatRule: {
      type: repeatRule.type || "weekly",
      interval: Number(repeatRule.interval || 1),
      endDate: repeatEndDate
    },
    rawText: course.rawText || ""
  });
}

function courseSummary(course) {
  const endDate = course.repeatRule && course.repeatRule.endDate ? course.repeatRule.endDate : course.startDateKey;
  const weekdayLabels = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const weekday = weekdayLabels[Number(course.weekday || 0)] || "未识别周几";
  return `${course.startDateKey || "未识别日期"} 至 ${endDate || "未识别结束"} ${weekday} 每周`;
}

function isImportableCourse(course) {
  return !!(
    course.title
    && /^\d{4}-\d{2}-\d{2}$/.test(course.startDateKey || "")
    && /^\d{2}:\d{2}$/.test(course.startTime || "")
    && /^\d{2}:\d{2}$/.test(course.endTime || "")
    && course.repeatRule
    && /^\d{4}-\d{2}-\d{2}$/.test(course.repeatRule.endDate || "")
  );
}

Page({
  data: {
    user: {},
    noteCount: 0,
    latestPreview: "暂无无边记",
    latestNote: null,
    aiDiaryAllowed: false,
    profileItems: [],
    isLoggedIn: false,
    editMode: false,
    saving: false,
    importingCourses: false,
    recognizedCourses: [],
    recognitionWarnings: [],
    ocrText: "",
    courseConfirmVisible: false,
    formSchool: "",
    formMajor: "",
    formGrade: "",
    formStudyGoal: "",
    formSportGoal: "",
    formSleepGoal: "",
    formEntertainmentLimit: "",
    noteTouchStartX: 0,
    noteTouchStartY: 0
  },

  onLoad() {
    this.refreshUser();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    this.refreshUser();
  },

  refreshUser() {
    const app = getApp();
    const user = app.globalData.user || {};
    const loginStatus = wx.getStorageSync(LOGIN_STATUS_KEY);
    const isLoggedIn = !!(app.globalData.isLoggedIn || (loginStatus && loginStatus.openid));
    const profileCompleted = user.profileCompleted === true || (loginStatus && loginStatus.profileCompleted === true);
    const settings = wx.getStorageSync(KEYS.userSettings) || {};
    const notes = listBoundlessNotes();
    const latest = notes[0] || {};
    const items = [];

    if (user.school) items.push({ label: "学校", value: user.school });
    if (user.major) items.push({ label: "专业", value: user.major });
    if (user.grade) items.push({ label: "年级", value: user.grade });
    if (hasValue(user.studyGoal)) items.push({ label: "学习目标", value: `${user.studyGoal} 小时/周` });
    if (hasValue(user.sportGoal)) items.push({ label: "运动目标", value: `${user.sportGoal} 次/周` });
    if (user.sleepGoal) items.push({ label: "睡眠目标", value: user.sleepGoal });
    if (hasValue(user.entertainmentLimit)) items.push({ label: "娱乐上限", value: `${user.entertainmentLimit} 分钟/天` });

    this.setData({
      user,
      isLoggedIn,
      editMode: !profileCompleted,
      aiDiaryAllowed: !!settings.allowDiaryAI,
      profileItems: items,
      noteCount: notes.length,
      latestPreview: latest.content ? latest.content.slice(0, 32) : "暂无无边记",
      latestNote: latest.id ? {
        id: latest.id || latest.clientId || latest._id || latest.cloudId || "",
        cloudId: latest.cloudId || latest._id || "",
        date: latest.date || "",
        preview: latest.content ? latest.content.slice(0, 32) : "暂无无边记"
      } : null,
      formSchool: user.school || "",
      formMajor: user.major || "",
      formGrade: user.grade || "",
      formStudyGoal: hasValue(user.studyGoal) ? String(user.studyGoal) : "",
      formSportGoal: hasValue(user.sportGoal) ? String(user.sportGoal) : "",
      formSleepGoal: user.sleepGoal || "",
      formEntertainmentLimit: hasValue(user.entertainmentLimit) ? String(user.entertainmentLimit) : ""
    });
  },

  refreshNotes() {
    this.refreshUser();
  },

  onSchoolInput(e) { this.setData({ formSchool: e.detail.value }); },
  onMajorInput(e) { this.setData({ formMajor: e.detail.value }); },
  onGradeInput(e) { this.setData({ formGrade: e.detail.value }); },
  onStudyGoalInput(e) { this.setData({ formStudyGoal: e.detail.value }); },
  onSportGoalInput(e) { this.setData({ formSportGoal: e.detail.value }); },
  onSleepGoalInput(e) { this.setData({ formSleepGoal: e.detail.value }); },
  onEntertainmentLimitInput(e) { this.setData({ formEntertainmentLimit: e.detail.value }); },

  enableEdit() {
    this.setData({ editMode: true });
  },

  async handleSaveProfile() {
    if (this.data.saving) return;
    this.setData({ saving: true });

    try {
      const result = await api.user.updateProfile({
        school: this.data.formSchool.trim(),
        major: this.data.formMajor.trim(),
        grade: this.data.formGrade.trim(),
        studyGoal: this.data.formStudyGoal.trim(),
        sportGoal: this.data.formSportGoal.trim(),
        sleepGoal: this.data.formSleepGoal.trim(),
        entertainmentLimit: this.data.formEntertainmentLimit.trim(),
        profileCompleted: true
      });

      if (result.code !== 0 || !result.data || !result.data.user) {
        throw new Error(result.message || "保存失败");
      }

      const app = getApp();
      app.syncUserData(result.data.user, false);
      app.globalData.isNewUser = false;

      const loginStatus = wx.getStorageSync(LOGIN_STATUS_KEY) || {};
      loginStatus.isNewUser = false;
      loginStatus.profileCompleted = true;
      wx.setStorageSync(LOGIN_STATUS_KEY, loginStatus);

      wx.showToast({ title: "已保存", icon: "success", duration: 1200 });
      setTimeout(() => this.refreshUser(), 250);
    } catch (error) {
      console.error("saveProfile failed", error);
      wx.showToast({ title: "保存失败，请稍后重试", icon: "none", duration: 2000 });
    } finally {
      this.setData({ saving: false });
    }
  },

  toggleDiaryAuth(e) {
    const allowDiaryAI = e.detail.value;
    const settings = wx.getStorageSync(KEYS.userSettings) || {};
    wx.setStorageSync(KEYS.userSettings, Object.assign({}, settings, { allowDiaryAI }));
    this.setData({ aiDiaryAllowed: allowDiaryAI });
  },

  openNotes() {
    if (this.skipNextNoteTap) {
      this.skipNextNoteTap = false;
      return;
    }
    wx.navigateTo({ url: "/pages/noteList/noteList" });
  },

  onNoteTouchStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    this.setData({
      noteTouchStartX: touch.clientX,
      noteTouchStartY: touch.clientY
    });
  },

  onNoteTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - this.data.noteTouchStartX;
    const deltaY = touch.clientY - this.data.noteTouchStartY;
    if (deltaX < -60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.8) {
      this.skipNextNoteTap = true;
      this.confirmDeleteLatestNote();
    }
  },

  confirmDeleteLatestNote() {
    const note = this.data.latestNote || {};
    const id = note.id || "";
    const cloudId = note.cloudId || "";
    if (!id) {
      wx.showToast({ title: "暂无无边记", icon: "none" });
      return;
    }
    wx.showModal({
      title: "删除无边记",
      content: "删除后该无边记将无法恢复，是否继续？",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        try {
          deleteBoundlessNote(id);
          api.note.delete(cloudId || id, { clientId: id }).catch((error) => {
            console.warn("note delete pending local only", error.message);
          });
          this.refreshUser();
          wx.showToast({ title: "已删除", icon: "success" });
        } catch (error) {
          console.warn("delete note failed", error);
          wx.showToast({ title: "删除失败，请稍后重试", icon: "none" });
        }
      }
    });
  },

  goPage(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.path });
  },

  importCoursesFromImage() {
    if (this.data.importingCourses) return;
    wx.showActionSheet({
      itemList: ["普通印刷体", "高精度识别", "手写识别"],
      success: (res) => {
        const modes = ["printed", "accurate", "handwriting"];
        this.chooseCourseImage(modes[res.tapIndex] || "accurate");
      }
    });
  },

  chooseCourseImage(mode) {
    const handlePath = (path) => {
      if (!path) return;
      this.uploadAndParseCourseImage(path, mode || "accurate");
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: (res) => handlePath(res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath)
      });
      return;
    }
    wx.chooseImage({
      count: 1,
      sourceType: ["album", "camera"],
      success: (res) => handlePath(res.tempFilePaths && res.tempFilePaths[0])
    });
  },

  async uploadAndParseCourseImage(filePath, mode) {
    this.setData({ importingCourses: true });
    wx.showLoading({ title: "识别课程中" });
    try {
      const ext = String(filePath).split(".").pop() || "jpg";
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `course-ocr/${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`,
        filePath
      });
      const result = await api.courseOCR.parseImage({
        fileID: uploadRes.fileID,
        mode: mode || "accurate",
        currentYear: new Date().getFullYear()
      });
      const data = result.data || {};
      const courses = (data.courses || []).map((course, index) => {
        const normalized = normalizeCourse(course);
        return Object.assign({}, normalized, {
          id: `recognized-${index}`,
          summary: courseSummary(normalized),
          importable: isImportableCourse(normalized)
        });
      });
      this.setData({
        recognizedCourses: courses,
        recognitionWarnings: data.warnings || [],
        ocrText: data.ocrText || "",
        courseConfirmVisible: true
      });
      if (!courses.length) {
        wx.showToast({ title: "未识别到课程", icon: "none" });
      }
    } catch (error) {
      console.error("course OCR failed", error);
      wx.showToast({ title: error.message || "识别失败", icon: "none", duration: 2200 });
    } finally {
      wx.hideLoading();
      this.setData({ importingCourses: false });
    }
  },

  closeCourseConfirm() {
    this.setData({
      courseConfirmVisible: false,
      recognizedCourses: [],
      recognitionWarnings: [],
      ocrText: ""
    });
  },

  confirmImportCourses() {
    const courses = this.data.recognizedCourses.filter(isImportableCourse);
    if (!courses.length) {
      wx.showToast({ title: "没有可导入课程", icon: "none" });
      return;
    }
    courses.forEach((course) => {
      const schedule = this.courseToSchedule(course);
      appendItem(KEYS.schedules, schedule);
      api.schedule.create(schedule).catch(() => {});
    });
    wx.showToast({ title: `已导入 ${courses.length} 门课程`, icon: "success" });
    this.closeCourseConfirm();
  },

  courseToSchedule(course) {
    const startDateKey = course.startDateKey;
    const dateParts = parseDateParts(startDateKey);
    const id = createId("s");
    return {
      id,
      clientId: id,
      title: course.title,
      type: "schedule",
      date: formatDateLabel(startDateKey),
      dateKey: startDateKey,
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      startDateKey,
      endDateKey: startDateKey,
      startTime: course.startTime,
      endTime: course.endTime,
      location: course.location || "",
      weekday: Number(course.weekday || 0),
      reminder: "不提醒",
      repeat: "每周",
      repeatRule: {
        type: "weekly",
        interval: Number((course.repeatRule && course.repeatRule.interval) || 1),
        endDate: course.repeatRule && course.repeatRule.endDate ? course.repeatRule.endDate : startDateKey
      },
      allDay: false,
      status: "todo",
      source: "course-ocr",
      rawText: course.rawText || ""
    };
  },

  handleLogout() {
    wx.showModal({
      title: "退出登录",
      content: "只会清理本机登录态，不会删除云端历史数据。",
      confirmText: "退出",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;

        wx.removeStorageSync(LOGIN_STATUS_KEY);

        const app = getApp();
        app.globalData.isLoggedIn = false;
        app.globalData.isNewUser = false;
        Object.assign(app.globalData.user, {
          openid: "",
          userId: "",
          nickname: "",
          avatarUrl: "",
          school: "",
          major: "",
          grade: "",
          studyGoal: null,
          sportGoal: null,
          sleepGoal: null,
          entertainmentLimit: null,
          profileCompleted: false
        });

        wx.showToast({ title: "已退出登录", icon: "none", duration: 1200 });
        setTimeout(() => {
          wx.reLaunch({ url: "/pages/login/login" });
        }, 500);
      }
    });
  }
});
