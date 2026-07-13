function canUseCloud() {
  return !!(wx.cloud && wx.cloud.callFunction);
}

function normalizeResult(result) {
  const payload = result || {};
  if (typeof payload.code === "number") {
    if (payload.code !== 0) {
      const error = new Error(payload.message || payload.msg || "cloud function failed");
      error.code = payload.code;
      error.data = payload.data || null;
      throw error;
    }
    return payload;
  }
  return {
    code: 0,
    message: "success",
    data: payload.data !== undefined ? payload.data : payload
  };
}

function callCloud(name, data) {
  if (!canUseCloud()) {
    return Promise.reject(new Error("cloud is not available"));
  }
  return wx.cloud.callFunction({ name, data: data || {} }).then((res) => normalizeResult(res.result));
}

function withAction(action, data) {
  return Object.assign({ action }, data || {});
}

const api = {
  user: {
    login(data) {
      return callCloud("userService", withAction("login", data));
    },
    init(data) {
      return callCloud("userService", withAction("init", data));
    },
    updateProfile(data) {
      return callCloud("userService", withAction("updateProfile", data));
    },
    getProfile() {
      return callCloud("userService", withAction("getProfile"));
    }
  },
  schedule: {
    create(data) {
      return callCloud("scheduleService", withAction("create", data));
    },
    update(data) {
      return callCloud("scheduleService", withAction("update", data));
    },
    delete(id) {
      return callCloud("scheduleService", withAction("delete", { id }));
    },
    listByDate(date) {
      return callCloud("scheduleService", withAction("listByDate", { date }));
    },
    listByMonth(year, month) {
      return callCloud("scheduleService", withAction("listByMonth", { year, month }));
    },
    search(keyword) {
      return callCloud("scheduleService", withAction("search", { keyword }));
    },
    parse(data) {
      return callCloud("scheduleService", withAction("parse", data));
    }
  },
  record: {
    create(data) {
      return callCloud("recordService", withAction("createRecord", data));
    },
    createPomodoro(data) {
      return callCloud("recordService", withAction("createPomodoro", data));
    },
    deletePomodoro(id, extra) {
      return callCloud("recordService", withAction("deletePomodoro", Object.assign({ id }, extra || {})));
    },
    listPomodoro(data) {
      return callCloud("recordService", withAction("listPomodoro", data));
    },
    listRecords(data) {
      return callCloud("recordService", withAction("listRecords", data));
    },
    getOverview(data) {
      return callCloud("recordService", withAction("getOverview", data));
    },
    getWeeklyReport(data) {
      return callCloud("recordService", withAction("getWeeklyReport", data));
    }
  },
  note: {
    create(data) {
      return callCloud("noteService", withAction("create", data));
    },
    delete(id, extra) {
      return callCloud("noteService", withAction("delete", Object.assign({ id }, extra || {})));
    },
    listByDate(date) {
      return callCloud("noteService", withAction("listByDate", { date }));
    },
    list(data) {
      return callCloud("noteService", withAction("list", data));
    }
  },
  reminder: {
    scanDueReminders(data) {
      return callCloud("reminderService", withAction("scanDueReminders", data));
    },
    markReminderSent(id) {
      return callCloud("reminderService", withAction("markReminderSent", { id }));
    }
  },
  report: {
    generateWeeklyReport(data) {
      return callCloud("reportService", withAction("generateWeeklyReport", data));
    },
    generateShareSummary(data) {
      return callCloud("reportService", withAction("generateShareSummary", data));
    }
  },
  speech: {
    recognize(data) {
      return callCloud("speechService", withAction("recognize", data));
    }
  },
  courseOCR: {
    parseImage(data) {
      return callCloud("ocrCourseService", data);
    }
  }
};

module.exports = {
  callCloud,
  api,
  canUseCloud,
  normalizeResult
};
