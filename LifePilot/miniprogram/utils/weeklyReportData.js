const { KEYS, readList, todayKey } = require("./storage");
const { isScheduleOnDate } = require("./scheduleIndex");

const MODULE_LABELS = {
  study: "学习",
  sport: "运动",
  entertainment: "娱乐",
  sleep: "睡眠"
};

function pad(value) {
  return Number(value) < 10 ? `0${Number(value)}` : `${Number(value)}`;
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const parts = String(value).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function weekRange(baseDate) {
  const base = baseDate || new Date();
  const weekday = base.getDay() || 7;
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  start.setDate(base.getDate() - weekday + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(dateKey(day));
  }
  return {
    weekStart: dateKey(start),
    weekEnd: dateKey(end),
    rangeText: `${dateKey(start).slice(5).replace("-", ".")} - ${dateKey(end).slice(5).replace("-", ".")}`,
    days
  };
}

function truncate(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeModule(value) {
  const raw = String(value || "").toLowerCase();
  if (["study", "learn", "learning", "focus"].includes(raw)) return "study";
  if (["sport", "exercise", "workout"].includes(raw)) return "sport";
  if (["entertainment", "game", "leisure", "play"].includes(raw)) return "entertainment";
  if (["sleep", "rest"].includes(raw)) return "sleep";
  return "";
}

function recordDate(item) {
  return String(item.date || item.dateKey || item.endedAt || item.createdAt || todayKey()).slice(0, 10);
}

function recordMinutes(item) {
  if (item.source === "pomodoro") return numberValue(item.durationMinutes || item.minutes || item.duration);
  const unit = String(item.unit || "").toLowerCase();
  const value = numberValue(item.minutes || item.duration || item.value);
  if (unit === "hour" || unit === "hours" || unit === "h") return value * 60;
  return value;
}

function addDaily(dailyMap, date, patch) {
  if (!dailyMap[date]) return;
  Object.keys(patch).forEach((key) => {
    dailyMap[date][key] += patch[key];
  });
}

function classifyAttachment(attachment) {
  const type = String((attachment && (attachment.type || attachment.kind)) || "").toLowerCase();
  const label = String((attachment && (attachment.title || attachment.label || "")) || "").toLowerCase();
  if (["image", "photo", "camera"].includes(type) || /图片|照片|image|photo/.test(label)) return "image";
  if (["audio", "record", "voice"].includes(type) || /语音|录音|audio|voice/.test(label)) return "audio";
  if (["location", "place"].includes(type) || /地点|位置|location/.test(label)) return "location";
  if (["scantext", "scan", "ocr"].includes(type) || /扫描|识别|ocr/.test(label)) return "scanText";
  return "file";
}

function attachmentText(attachment) {
  const meta = (attachment && attachment.meta) || {};
  return truncate(
    attachment && (attachment.text || attachment.value || attachment.content || meta.text || meta.ocrText || meta.address || meta.name),
    200
  );
}

function noteDate(item) {
  return String(item.date || item.dateKey || item.updatedAt || item.createdAt || todayKey()).slice(0, 10);
}

function buildFallback(aiInput) {
  const stats = aiInput.stats;
  const highlights = [];
  const risks = [];
  const suggestions = [];
  if (stats.studyMinutes || stats.pomodoroMinutes) highlights.push("本周已经留下了学习或专注记录，可以继续保持节奏。");
  if (stats.noteCount) highlights.push(`本周写下 ${stats.noteCount} 条无边记，回顾素材比较完整。`);
  if (stats.scheduleCount) highlights.push(`本周安排了 ${stats.scheduleCount} 个日程，生活节奏比较清晰。`);
  if (stats.entertainmentMinutes > 600) risks.push("娱乐时长偏高，可以给放松时间设一个结束点。");
  if (stats.sleepAverageHours && stats.sleepAverageHours < 7) risks.push("平均睡眠略低，建议把高强度任务前移。");
  if (stats.busyDays.length) risks.push(`这些日期日程较密：${stats.busyDays.join("、")}，记得预留缓冲。`);
  if (!stats.noteCount && !stats.scheduleCount && !stats.totalMinutes) risks.push("本周记录较少，周报参考信息有限。");
  suggestions.push("下周继续保持轻量记录，每天补一条最真实的生活片段。");
  if (stats.noteImageCount || stats.noteScanTextCount) suggestions.push("图片和扫描文本可以整理成课程资料或项目资料。");
  if (stats.noteAudioCount) suggestions.push("语音附件较多时，可以补充转写，方便复盘。");
  if (stats.sportMinutes < 90) suggestions.push("下周可以安排 2 到 3 次轻运动。");
  const activeLabel = MODULE_LABELS[stats.activeModule] || "生活";
  const summary = stats.totalMinutes || stats.scheduleCount || stats.noteCount
    ? `本周${activeLabel}最活跃，共记录 ${Math.round(stats.totalMinutes)} 分钟生活数据，另有 ${stats.scheduleCount} 个日程和 ${stats.noteCount} 条无边记。`
    : "本周记录较少，先从每天一条生活记录开始。";
  return {
    title: "本周周报",
    summary,
    highlights: highlights.slice(0, 3),
    risks: risks.slice(0, 3),
    suggestions: suggestions.slice(0, 4),
    scheduleInsights: stats.scheduleCount ? [`本周共有 ${stats.scheduleCount} 个日程，忙碌日为 ${stats.busyDays.join("、") || "暂无"}。`] : ["本周日程记录较少。"],
    noteInsights: stats.noteCount ? [`无边记包含图片 ${stats.noteImageCount} 个、语音 ${stats.noteAudioCount} 个、地点 ${stats.noteLocationCount} 个、扫描文本 ${stats.noteScanTextCount} 个。`] : ["本周无边记较少。"],
    focusInsights: stats.pomodoroMinutes ? [`番茄钟累计 ${Math.round(stats.pomodoroMinutes)} 分钟，专注节奏已经建立。`] : ["本周番茄钟记录较少。"],
    nextWeekFocus: stats.sleepAverageHours < 7 ? "优先保证睡眠和任务缓冲" : "保持记录和稳定节奏",
    shareText: `我的本周：${activeLabel}最活跃，累计 ${Math.round(stats.totalMinutes)} 分钟，完成 ${stats.scheduleCount} 个日程记录，写下 ${stats.noteCount} 条无边记。`
  };
}

function buildWeeklyReportData(baseDate) {
  const range = weekRange(baseDate || new Date());
  const daySet = {};
  const dailyMap = {};
  range.days.forEach((day) => {
    daySet[day] = true;
    dailyMap[day] = {
      date: day,
      studyMinutes: 0,
      sportMinutes: 0,
      entertainmentMinutes: 0,
      sleepHours: 0,
      pomodoroMinutes: 0,
      scheduleCount: 0,
      noteCount: 0
    };
  });

  const stats = {
    totalMinutes: 0,
    studyMinutes: 0,
    sportMinutes: 0,
    entertainmentMinutes: 0,
    sleepAverageHours: 0,
    pomodoroMinutes: 0,
    manualMinutes: 0,
    activeModule: "study",
    scheduleCount: 0,
    completedScheduleCount: 0,
    courseCount: 0,
    taskCount: 0,
    meetingCount: 0,
    busyDays: [],
    noteCount: 0,
    noteTextLength: 0,
    noteImageCount: 0,
    noteAudioCount: 0,
    noteLocationCount: 0,
    noteScanTextCount: 0,
    pomodoroCount: 0
  };

  const schedules = [];
  readList(KEYS.schedules, []).forEach((item) => {
    range.days.forEach((day) => {
      if (!isScheduleOnDate(item, day)) return;
      addDaily(dailyMap, day, { scheduleCount: 1 });
      schedules.push({
        title: truncate(item.title || item.name || item.courseName || "未命名日程", 40),
        date: day,
        time: truncate(`${item.startTime || ""}${item.endTime ? `-${item.endTime}` : ""}`, 20),
        type: item.type || "schedule",
        status: item.status || "",
        location: truncate(item.location || item.classroom, 40),
        note: truncate(item.note || item.description, 120),
        reminderEnabled: !!(item.reminder && item.reminder.enabled)
      });
      stats.scheduleCount += 1;
      if (item.status === "done" || item.status === "completed") stats.completedScheduleCount += 1;
      if (item.type === "course" || item.courseName) stats.courseCount += 1;
      if (item.type === "task") stats.taskCount += 1;
      if (item.type === "meeting") stats.meetingCount += 1;
    });
  });

  const records = readList(KEYS.records, []);
  const pomodoro = [];
  const sleepDays = [];
  records.forEach((item) => {
    const date = recordDate(item);
    if (!daySet[date]) return;
    if (String(item.source || "").toLowerCase() === "pomodoro") {
      const module = normalizeModule(item.module || item.category || item.type) || "study";
      const minutes = recordMinutes(item);
      stats.pomodoroMinutes += minutes;
      stats.pomodoroCount += 1;
      addDaily(dailyMap, date, { pomodoroMinutes: minutes });
      pomodoro.push({
        date,
        module,
        minutes,
        title: truncate(item.title || `${MODULE_LABELS[module] || "专注"}番茄钟`, 40)
      });
      return;
    }
    const module = normalizeModule(item.module || item.category || item.type);
    if (module) {
      const minutes = recordMinutes(item);
      stats.manualMinutes += minutes;
      if (module === "study") {
        stats.studyMinutes += minutes;
        addDaily(dailyMap, date, { studyMinutes: minutes });
      }
      if (module === "sport") {
        stats.sportMinutes += minutes;
        addDaily(dailyMap, date, { sportMinutes: minutes });
      }
      if (module === "entertainment") {
        stats.entertainmentMinutes += minutes;
        addDaily(dailyMap, date, { entertainmentMinutes: minutes });
      }
      if (module === "sleep") {
        const hours = item.unit === "hour" ? numberValue(item.duration) : minutes / 60;
        sleepDays.push(hours);
        dailyMap[date].sleepHours += hours;
      }
      return;
    }
    const study = numberValue(item.studyMinutes);
    const sport = numberValue(item.sportMinutes || item.exerciseMinutes);
    const entertainment = numberValue(item.entertainmentMinutes);
    const sleep = numberValue(item.sleepHours || item.sleepMinutes / 60);
    stats.studyMinutes += study;
    stats.sportMinutes += sport;
    stats.entertainmentMinutes += entertainment;
    stats.manualMinutes += study + sport + entertainment + sleep * 60;
    if (sleep) sleepDays.push(sleep);
    addDaily(dailyMap, date, {
      studyMinutes: study,
      sportMinutes: sport,
      entertainmentMinutes: entertainment
    });
    dailyMap[date].sleepHours += sleep;
  });
  stats.sleepAverageHours = sleepDays.length ? Number((sleepDays.reduce((sum, value) => sum + value, 0) / sleepDays.length).toFixed(1)) : 0;

  const notes = [];
  const noteList = readList(KEYS.boundlessNotes, []).concat(readList(KEYS.diaries, []));
  noteList.forEach((item) => {
    const date = noteDate(item);
    if (!daySet[date]) return;
    const attachments = Array.isArray(item.attachments || item.assets) ? (item.attachments || item.assets) : [];
    const summary = { imageCount: 0, audioCount: 0, locationCount: 0, scanTextCount: 0 };
    const scanTexts = [];
    const locations = [];
    attachments.forEach((attachment) => {
      const type = classifyAttachment(attachment);
      if (type === "image") summary.imageCount += 1;
      if (type === "audio") summary.audioCount += 1;
      if (type === "location") {
        summary.locationCount += 1;
        locations.push(attachmentText(attachment));
      }
      if (type === "scanText") {
        summary.scanTextCount += 1;
        scanTexts.push(attachmentText(attachment));
      }
    });
    stats.noteCount += 1;
    stats.noteTextLength += String(item.content || "").length;
    stats.noteImageCount += summary.imageCount;
    stats.noteAudioCount += summary.audioCount;
    stats.noteLocationCount += summary.locationCount;
    stats.noteScanTextCount += summary.scanTextCount;
    addDaily(dailyMap, date, { noteCount: 1 });
    notes.push({
      date,
      contentSummary: truncate(item.content, 120),
      attachmentSummary: summary,
      scanTextSummary: truncate(scanTexts.filter(Boolean).join(" / "), 200),
      locationSummary: truncate(locations.filter(Boolean).join(" / "), 120)
    });
  });

  Object.keys(dailyMap).forEach((day) => {
    if (dailyMap[day].scheduleCount > 4) stats.busyDays.push(day);
  });
  stats.totalMinutes = stats.studyMinutes + stats.sportMinutes + stats.entertainmentMinutes + stats.pomodoroMinutes;
  const activity = [
    ["study", stats.studyMinutes + stats.pomodoroMinutes],
    ["sport", stats.sportMinutes],
    ["entertainment", stats.entertainmentMinutes],
    ["sleep", stats.sleepAverageHours * 60]
  ].sort((a, b) => b[1] - a[1]);
  stats.activeModule = activity[0][0];

  const aiInput = {
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    stats,
    daily: range.days.map((day) => dailyMap[day]),
    schedules: schedules.slice(0, 30),
    notes: notes.slice(0, 20),
    pomodoro: pomodoro.slice(0, 30)
  };
  return {
    range,
    aiInput,
    fallback: buildFallback(aiInput)
  };
}

module.exports = {
  buildWeeklyReportData,
  buildFallback
};
