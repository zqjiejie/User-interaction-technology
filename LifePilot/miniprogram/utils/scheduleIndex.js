function scheduleIdentity(item) {
  const clientId = item && item.clientId;
  const id = item && (item.id || item._id || item.cloudId);
  return String(clientId || id || "").trim();
}

function buildScheduleSearchIndexId(item) {
  const identity = scheduleIdentity(item);
  if (identity) return identity;
  return [
    item && (item.dateKey || item.date || ""),
    item && (item.startTime || item.start || ""),
    item && (item.endTime || item.end || ""),
    item && (item.title || item.name || item.courseName || "")
  ].join("|");
}

function normalizeScheduleItem(item, source) {
  const date = item.startDateKey || item.dateKey || item.date || "";
  const title = item.title || item.name || item.courseName || "未命名日程";
  const id = item.clientId || item.id || item._id || buildScheduleSearchIndexId(item);
  return Object.assign({}, item, {
    id,
    clientId: item.clientId || "",
    title,
    type: item.type || source || "schedule",
    source: "日程",
    resultType: "schedule",
    date,
    dateKey: date,
    startTime: item.startTime || item.start || "",
    endTime: item.endTime || item.end || "",
    searchIndexId: buildScheduleSearchIndexId(item)
  });
}

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function composedDateKey(item) {
  if (item && item.year && item.month && item.day) {
    return `${item.year}-${pad(Number(item.month))}-${pad(Number(item.day))}`;
  }
  return "";
}

function toLocalDate(dateKey) {
  const parts = String(dateKey || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((value) => !value)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function dayDiff(fromDateKey, toDateKey) {
  const from = toLocalDate(fromDateKey);
  const to = toLocalDate(toDateKey);
  if (!from || !to) return NaN;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function monthDiff(fromDateKey, toDateKey) {
  const from = toLocalDate(fromDateKey);
  const to = toLocalDate(toDateKey);
  if (!from || !to) return NaN;
  return (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
}

function isScheduleOnDate(item, dateKey) {
  if (!item || item.isDeleted) return false;
  if (Array.isArray(item.excludedDates) && item.excludedDates.includes(dateKey)) {
    return false;
  }
  const startKey = item.startDateKey || item.dateKey || item.date || composedDateKey(item);
  const endKey = item.endDateKey && item.endDateKey >= startKey ? item.endDateKey : startKey;
  if (!startKey || !dateKey || dateKey < startKey) return false;

  const rule = item.repeatRule || {};
  const repeatType = rule.type || "never";
  if (!repeatType || repeatType === "never") {
    return dateKey >= startKey && dateKey <= endKey;
  }

  if (rule.endDate && dateKey > rule.endDate) return false;

  const diffDays = dayDiff(startKey, dateKey);
  if (Number.isNaN(diffDays) || diffDays < 0) return false;

  const interval = Math.max(1, Number(rule.interval || 1));
  if (repeatType === "daily") return diffDays % interval === 0;

  if (repeatType === "weekly" || repeatType === "biweekly") {
    const repeatInterval = repeatType === "biweekly" ? 2 : interval;
    return diffDays % (7 * repeatInterval) === 0;
  }

  if (repeatType === "monthly") {
    const start = toLocalDate(startKey);
    const target = toLocalDate(dateKey);
    const diffMonths = monthDiff(startKey, dateKey);
    return diffMonths >= 0 && diffMonths % interval === 0 && target.getDate() === start.getDate();
  }

  if (repeatType === "yearly") {
    const start = toLocalDate(startKey);
    const target = toLocalDate(dateKey);
    const diffYears = target.getFullYear() - start.getFullYear();
    return diffYears >= 0
      && diffYears % interval === 0
      && target.getMonth() === start.getMonth()
      && target.getDate() === start.getDate();
  }

  return dateKey === startKey;
}

function dedupeByTypeAndSearchIndex(items) {
  const seen = {};
  const seenClient = {};
  return (items || []).filter((item) => {
    const type = item.resultType || item.source || item.type || "item";
    const searchIndexId = item.searchIndexId || buildScheduleSearchIndexId(item);
    const clientId = item.clientId || "";
    const key = `${type}:${searchIndexId}`;
    const clientKey = clientId ? `${type}:client:${clientId}` : "";
    if (seen[key]) return false;
    if (clientKey && seenClient[clientKey]) return false;
    seen[key] = true;
    if (clientKey) seenClient[clientKey] = true;
    return true;
  });
}

module.exports = {
  buildScheduleSearchIndexId,
  normalizeScheduleItem,
  isScheduleOnDate,
  dedupeByTypeAndSearchIndex
};
