const { KEYS, readList, writeList, removeItem, todayKey } = require("./storage");

const MODULES = [
  { key: "study", label: "学习", color: "#ef4444", bg: "module-study" },
  { key: "sport", label: "运动", color: "#22c55e", bg: "module-sport" },
  { key: "entertainment", label: "娱乐", color: "#f59e0b", bg: "module-entertainment" },
  { key: "sleep", label: "睡眠", color: "#6366f1", bg: "module-sleep" }
];

const MODULE_ALIASES = {
  study: ["study", "learn", "learning", "focus", "pomodoro", "学习"],
  sport: ["sport", "exercise", "workout", "运动", "锻炼"],
  entertainment: ["entertainment", "game", "leisure", "play", "娱乐"],
  sleep: ["sleep", "rest", "睡眠", "休息"]
};

function pad(value) {
  return Number(value) < 10 ? `0${Number(value)}` : `${Number(value)}`;
}

function toDateKey(value) {
  if (!value) return todayKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayKey();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateAdd(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function lastDays(count) {
  const today = new Date();
  const start = dateAdd(today, -(count - 1));
  return Array.from({ length: count }).map((_, index) => {
    const date = dateAdd(start, index);
    const key = toDateKey(date);
    return {
      key,
      label: `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
    };
  });
}

function currentWeekRange(days) {
  const first = days[0] || {};
  const last = days[days.length - 1] || {};
  return `${String(first.key || "").slice(5).replace("-", ".")} - ${String(last.key || "").slice(5).replace("-", ".")}`;
}

function normalizeModule(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const match = MODULES.find((module) => MODULE_ALIASES[module.key].includes(raw));
  return match ? match.key : "";
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function valueToMinutes(item) {
  const unit = String(item.unit || "").toLowerCase();
  const value = numberValue(item.duration || item.minutes || item.value || item.focusMinutes || item.durationMinutes);
  if (unit === "hour" || unit === "hours" || unit === "h" || unit === "小时") return value * 60;
  return value;
}

function formatMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}min` : `${hours}h`;
  }
  return `${minutes}min`;
}

function createBuckets(days) {
  const buckets = {};
  MODULES.forEach((module) => {
    buckets[module.key] = {};
    days.forEach((day) => {
      buckets[module.key][day.key] = {
        module: module.key,
        date: day.key,
        pomodoroMinutes: 0,
        manualMinutes: 0,
        totalMinutes: 0,
        records: []
      };
    });
  });
  return buckets;
}

function addMinutes(buckets, moduleKey, dateKey, minutes, source, record) {
  if (!buckets[moduleKey] || !buckets[moduleKey][dateKey] || !minutes) return;
  const bucket = buckets[moduleKey][dateKey];
  if (source === "pomodoro") bucket.pomodoroMinutes += minutes;
  else bucket.manualMinutes += minutes;
  bucket.totalMinutes += minutes;
  bucket.records.push(Object.assign({}, record, {
    module: moduleKey,
    date: dateKey,
    source,
    durationMinutes: minutes
  }));
}

function addManualAggregate(buckets, record, dateKey) {
  addMinutes(buckets, "study", dateKey, numberValue(record.studyMinutes), "manual", record);
  addMinutes(buckets, "sport", dateKey, numberValue(record.sportMinutes || record.exerciseMinutes), "manual", record);
  addMinutes(buckets, "entertainment", dateKey, numberValue(record.entertainmentMinutes), "manual", record);
  addMinutes(buckets, "sleep", dateKey, numberValue(record.sleepMinutes || numberValue(record.sleepHours) * 60), "manual", record);
}

function collectStats(dayCount) {
  const days = lastDays(dayCount || 7);
  const buckets = createBuckets(days);
  const daySet = {};
  days.forEach((day) => { daySet[day.key] = true; });

  const records = readList(KEYS.records, []);
  const manualDetailDates = {};
  records.forEach((record) => {
    const source = String(record.source || "").toLowerCase();
    if (source === "pomodoro" || source === "manualaggregate") return;
    const dateKey = toDateKey(record.dateKey || record.date || record.endedAt || record.createdAt);
    if (!daySet[dateKey]) return;
    if (normalizeModule(record.module || record.category || record.type)) manualDetailDates[dateKey] = true;
  });

  records.forEach((record) => {
    const dateKey = toDateKey(record.dateKey || record.date || record.endedAt || record.createdAt);
    if (!daySet[dateKey]) return;
    const source = String(record.source || "").toLowerCase() === "pomodoro" ? "pomodoro" : "manual";
    if (String(record.source || "").toLowerCase() === "manualaggregate" && manualDetailDates[dateKey]) return;
    if (source === "pomodoro") {
      const moduleKey = normalizeModule(record.module || record.category || record.type);
      addMinutes(buckets, moduleKey, dateKey, valueToMinutes(record), "pomodoro", record);
      return;
    }
    const directModule = normalizeModule(record.module || record.category || record.type);
    if (directModule) {
      addMinutes(buckets, directModule, dateKey, valueToMinutes(record), "manual", record);
      return;
    }
    addManualAggregate(buckets, record, dateKey);
  });

  return { days, buckets };
}

function makeLine(values, width, height, padding) {
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const max = Math.max.apply(null, values.concat([1]));
  const step = values.length > 1 ? chartWidth / (values.length - 1) : chartWidth;
  const points = values.map((value, index) => {
    const x = padding + index * step;
    const y = padding + chartHeight - (value / max) * chartHeight;
    return {
      id: `p-${index}`,
      left: `${Math.round(x)}rpx`,
      top: `${Math.round(y)}rpx`,
      value
    };
  });
  const segments = points.slice(1).map((point, index) => {
    const prev = points[index];
    const x1 = parseInt(prev.left, 10);
    const y1 = parseInt(prev.top, 10);
    const x2 = parseInt(point.left, 10);
    const y2 = parseInt(point.top, 10);
    const dx = x2 - x1;
    const dy = y2 - y1;
    return {
      id: `s-${index}`,
      left: `${x1}rpx`,
      top: `${y1}rpx`,
      width: `${Math.round(Math.sqrt(dx * dx + dy * dy))}rpx`,
      rotate: `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`
    };
  });
  return { points, segments };
}

function buildModuleCard(module, days, buckets) {
  const values = days.map((day) => buckets[module.key][day.key].totalMinutes);
  const today = values[values.length - 1] || 0;
  const yesterday = values[values.length - 2] || 0;
  const weeklyTotal = values.reduce((total, value) => total + value, 0);
  const delta = today - yesterday;
  const trend = !weeklyTotal ? "暂无记录" : delta === 0 ? "本周稳定" : `较昨日 ${delta > 0 ? "+" : ""}${Math.round(delta)}min`;
  return Object.assign({}, module, {
    today,
    weeklyTotal,
    todayText: formatMinutes(today),
    weeklyText: formatMinutes(weeklyTotal),
    trend,
    values,
    chart: makeLine(values, 236, 96, 10)
  });
}

function buildDiscoverData() {
  const { days, buckets } = collectStats(7);
  const modules = MODULES.map((module) => buildModuleCard(module, days, buckets));
  const total = modules.reduce((sum, item) => sum + item.weeklyTotal, 0);
  const active = modules.slice().sort((a, b) => b.weeklyTotal - a.weeklyTotal)[0] || MODULES[0];
  return {
    days,
    modules,
    overview: {
      weekRange: currentWeekRange(days),
      totalMinutes: total,
      totalText: formatMinutes(total),
      activeLabel: total ? active.label : "暂无",
      summary: total ? `本周最活跃模块：${active.label}` : "添加记录后会生成本周趋势"
    }
  };
}

function recordId(item) {
  return item.id || item.clientId || item._id || item.cloudId || "";
}

function pomodoroRecords() {
  return readList(KEYS.records, [])
    .filter((item) => String(item.source || "").toLowerCase() === "pomodoro")
    .map((item) => {
      const moduleKey = normalizeModule(item.module || item.category || item.type) || "study";
      const module = MODULES.find((entry) => entry.key === moduleKey) || MODULES[0];
      const date = toDateKey(item.dateKey || item.date || item.endedAt || item.createdAt);
      const minutes = valueToMinutes(item);
      return Object.assign({}, item, {
        id: recordId(item),
        cloudId: item.cloudId || item._id || "",
        module: moduleKey,
        moduleLabel: module.label,
        date,
        durationMinutes: minutes,
        durationText: formatMinutes(minutes),
        statusText: item.completed === false ? "未完成" : "已完成",
        title: item.title || `${module.label}番茄钟`
      });
    })
    .sort((a, b) => `${b.endedAt || b.createdAt || b.date}`.localeCompare(`${a.endedAt || a.createdAt || a.date}`));
}

function deletePomodoroRecord(id) {
  return removeItem(KEYS.records, id);
}

function buildModuleDetail(moduleKey) {
  const key = normalizeModule(moduleKey) || "study";
  const module = MODULES.find((item) => item.key === key) || MODULES[0];
  const { days, buckets } = collectStats(7);
  const values = days.map((day) => buckets[key][day.key].totalMinutes);
  const today = values[values.length - 1] || 0;
  const weekTotal = values.reduce((total, value) => total + value, 0);
  const records = [];
  days.forEach((day) => {
    buckets[key][day.key].records.forEach((record) => {
      records.push(Object.assign({}, record, {
        id: recordId(record) || `${record.source}-${day.key}-${records.length}`,
        sourceLabel: record.source === "pomodoro" ? "番茄钟" : "手动记录",
        durationText: formatMinutes(record.durationMinutes),
        title: record.title || (record.source === "pomodoro" ? `${module.label}番茄钟` : `${module.label}记录`)
      }));
    });
  });
  records.sort((a, b) => `${b.endedAt || b.createdAt || b.date}`.localeCompare(`${a.endedAt || a.createdAt || a.date}`));
  return {
    module: module.key,
    label: module.label,
    color: module.color,
    days,
    metrics: [
      { label: "今日时长", value: formatMinutes(today) },
      { label: "本周累计", value: formatMinutes(weekTotal) },
      { label: "本月累计", value: formatMinutes(weekTotal) },
      { label: "记录数", value: `${records.length}` }
    ],
    chart: makeLine(values, 640, 260, 22),
    records
  };
}

module.exports = {
  MODULES,
  buildDiscoverData,
  buildModuleDetail,
  pomodoroRecords,
  deletePomodoroRecord,
  formatMinutes,
  toDateKey
};
