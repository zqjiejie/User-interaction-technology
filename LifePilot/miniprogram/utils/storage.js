const KEYS = {
  courses: "lifepilot_courses",
  schedules: "lifepilot_schedules",
  records: "lifepilot_records",
  diaries: "lifepilot_diaries",
  boundlessNotes: "lifepilot_boundless_notes",
  userSettings: "lifepilot_user_settings"
};

function readList(key, fallback) {
  return wx.getStorageSync(key) || fallback || [];
}

function writeList(key, value) {
  wx.setStorageSync(key, value);
}

function appendItem(key, item) {
  const list = readList(key, []);
  const next = [Object.assign({ id: `${Date.now()}`, createdAt: new Date().toISOString() }, item)].concat(list);
  writeList(key, next);
  return next;
}

function removeItem(key, id) {
  const list = readList(key, []);
  const next = list.filter((item) => !matchesItemId(item, id));
  writeList(key, next);
  return next;
}

function matchesItemId(item, id) {
  const target = String(id || "");
  if (!target) return false;
  const fallbackSearchIndexId = [
    item.dateKey || item.date || "",
    item.startTime || item.start || "",
    item.endTime || item.end || "",
    item.title || item.name || item.courseName || ""
  ].join("|");
  return [item.id, item._id, item.clientId, item.cloudId, item.searchIndexId, fallbackSearchIndexId]
    .some((value) => String(value || "") === target);
}

function getItemById(key, id) {
  return readList(key, []).find((item) => matchesItemId(item, id)) || null;
}

function updateItem(key, id, patch) {
  const list = readList(key, []);
  const now = new Date().toISOString();
  let updated = null;
  const next = list.map((item) => {
    if (!matchesItemId(item, id)) return item;
    updated = Object.assign({}, item, patch || {}, {
      id: item.id || id,
      clientId: item.clientId || item.id || id,
      updatedAt: now
    });
    return updated;
  });
  writeList(key, next);
  return updated;
}

function scheduleMergeKey(item) {
  return String((item && (item.clientId || item.id || item._id || item.cloudId || item.searchIndexId)) || "").trim();
}

function normalizeScheduleForStorage(item) {
  const key = scheduleMergeKey(item);
  const id = item.clientId || item.id || key;
  const startDateKey = item.startDateKey || item.dateKey || item.date || "";
  const next = Object.assign({}, item, {
    id,
    clientId: item.clientId || item.id || id,
    cloudId: item._id || item.cloudId || "",
    searchIndexId: item.searchIndexId || key
  });
  if (startDateKey) {
    next.dateKey = startDateKey;
    next.startDateKey = startDateKey;
    next.endDateKey = startDateKey;
  }
  return next;
}

function mergeDateFields(previous, item) {
  const startDateKey = item.startDateKey || item.dateKey || item.date || previous.startDateKey || previous.dateKey || previous.date || "";
  if (!startDateKey) return {};
  return {
    dateKey: startDateKey,
    startDateKey,
    endDateKey: startDateKey
  };
}

function mergeSchedulesToStorage(cloudSchedules) {
  const incoming = (cloudSchedules || []).filter(Boolean).map(normalizeScheduleForStorage);
  if (!incoming.length) return readList(KEYS.schedules, []);
  const local = readList(KEYS.schedules, []);
  const byId = {};
  const order = [];
  local.forEach((item) => {
    const normalized = normalizeScheduleForStorage(item);
    const key = scheduleMergeKey(normalized);
    if (!key) return;
    if (!byId[key]) order.push(key);
    byId[key] = normalized;
  });
  incoming.forEach((item) => {
    const key = scheduleMergeKey(item);
    if (!key) return;
    const previous = byId[key] || {};
    if (!byId[key]) order.unshift(key);
    byId[key] = Object.assign({}, previous, item, {
      id: item.clientId || item.id || previous.id || key,
      clientId: item.clientId || item.id || previous.clientId || key,
      cloudId: item._id || item.cloudId || previous.cloudId || "",
      dateKey: previous.dateKey,
      startDateKey: previous.startDateKey,
      endDateKey: previous.endDateKey,
      excludedDates: Array.isArray(previous.excludedDates) ? previous.excludedDates : item.excludedDates || [],
      repeatRule: item.repeatRule || previous.repeatRule || { type: "never", interval: 1, endDate: "" },
      attachments: item.attachments || previous.attachments || []
    });
    byId[key] = Object.assign({}, byId[key], mergeDateFields(byId[key], item));
  });
  const next = order.map((key) => byId[key]).filter(Boolean);
  writeList(KEYS.schedules, next);
  return next;
}

function todayKey(date) {
  const target = date ? new Date(date) : new Date();
  const year = target.getFullYear();
  const month = `${target.getMonth() + 1}`.padStart(2, "0");
  const day = `${target.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeNoteDate(value) {
  if (!value || value === "今天" || value === "刚刚") return todayKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) {
    const parts = value.split("-");
    return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }
  return todayKey();
}

function normalizeBoundlessAttachment(item) {
  const rawType = item && item.type;
  const type = rawType === "camera" ? "photo" : rawType === "record" ? "audio" : rawType === "scan" ? "scanText" : rawType || "";
  const title = (item && (item.title || item.label)) || "附件";
  return Object.assign({
    id: `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type,
    title,
    label: title,
    value: "",
    meta: {}
  }, item || {}, {
    type,
    title,
    label: title,
    meta: (item && item.meta) || {}
  });
}

function normalizeBoundlessAttachments(value) {
  return (Array.isArray(value) ? value : []).map(normalizeBoundlessAttachment);
}

function noteMergeKey(item) {
  return String((item && (item.clientId || item.id || item._id || item.cloudId)) || "").trim();
}

function normalizeBoundlessNoteForStorage(item) {
  const key = noteMergeKey(item);
  const id = item.clientId || item.id || key;
  return Object.assign({}, item, {
    id,
    clientId: item.clientId || item.id || id,
    cloudId: item._id || item.cloudId || item.id || "",
    date: normalizeNoteDate(item.date || item.dateKey || item.createdAt),
    content: item.content || item.text || item.note || "",
    status: item.status || "done",
    attachments: normalizeBoundlessAttachments(item.attachments || item.assets)
  });
}

function mergeBoundlessNotesToStorage(cloudNotes) {
  const incoming = (cloudNotes || []).filter(Boolean).map(normalizeBoundlessNoteForStorage);
  if (!incoming.length) return readList(KEYS.boundlessNotes, []);
  const local = readList(KEYS.boundlessNotes, []).map(normalizeBoundlessNoteForStorage);
  const byId = {};
  const order = [];
  local.forEach((item) => {
    const key = noteMergeKey(item);
    if (!key) return;
    if (!byId[key]) order.push(key);
    byId[key] = item;
  });
  incoming.forEach((item) => {
    const key = noteMergeKey(item);
    if (!key) return;
    const previous = byId[key] || {};
    if (!byId[key]) order.unshift(key);
    byId[key] = Object.assign({}, previous, item, {
      id: item.clientId || previous.clientId || item.id || previous.id || key,
      clientId: item.clientId || previous.clientId || item.id || previous.id || key,
      cloudId: item._id || item.cloudId || previous.cloudId || "",
      attachments: normalizeBoundlessAttachments(item.attachments || item.assets || previous.attachments || previous.assets)
    });
  });
  const next = order.map((key) => byId[key]).filter(Boolean)
    .sort((a, b) => `${b.updatedAt || b.createdAt || b.date}`.localeCompare(`${a.updatedAt || a.createdAt || a.date}`));
  writeList(KEYS.boundlessNotes, next);
  return next;
}

function recordMergeKey(item) {
  return String((item && (item.clientId || item.id || item._id || item.cloudId)) || "").trim();
}

function normalizeRecordForStorage(item) {
  const key = recordMergeKey(item);
  const id = item.clientId || item.id || key;
  return Object.assign({}, item, {
    id,
    clientId: item.clientId || item.id || id,
    cloudId: item._id || item.cloudId || item.id || "",
    source: item.source || (item.category || item.durationMinutes ? "pomodoro" : "manual"),
    module: item.module || item.category || item.type || "",
    category: item.category || item.module || item.type || "",
    date: item.date || item.dateKey || todayKey(item.endedAt || item.createdAt),
    durationMinutes: Number(item.durationMinutes || item.minutes || item.duration || 0)
  });
}

function mergeRecordsToStorage(cloudRecords) {
  const incoming = (cloudRecords || []).filter(Boolean).map(normalizeRecordForStorage);
  if (!incoming.length) return readList(KEYS.records, []);
  const local = readList(KEYS.records, []).map(normalizeRecordForStorage);
  const byId = {};
  const order = [];
  local.forEach((item) => {
    const key = recordMergeKey(item);
    if (!key) return;
    if (!byId[key]) order.push(key);
    byId[key] = item;
  });
  incoming.forEach((item) => {
    const key = recordMergeKey(item);
    if (!key) return;
    const previous = byId[key] || {};
    if (!byId[key]) order.unshift(key);
    byId[key] = Object.assign({}, previous, item, {
      id: item.clientId || previous.clientId || item.id || previous.id || key,
      clientId: item.clientId || previous.clientId || item.id || previous.id || key,
      cloudId: item._id || item.cloudId || previous.cloudId || "",
      source: item.source || previous.source || "pomodoro"
    });
  });
  const next = order.map((key) => byId[key]).filter(Boolean)
    .sort((a, b) => `${b.endedAt || b.updatedAt || b.createdAt || b.date}`.localeCompare(`${a.endedAt || a.updatedAt || a.createdAt || a.date}`));
  writeList(KEYS.records, next);
  return next;
}

function mergeLegacyNotes(date) {
  const legacy = readList(KEYS.diaries, []);
  return legacy
    .filter((item) => normalizeNoteDate(item.date || item.createdAt) === date)
    .map((item) => item.content)
    .filter(Boolean);
}

function readBoundlessNote(date) {
  const targetDate = normalizeNoteDate(date);
  const notes = readList(KEYS.boundlessNotes, []);
  const current = notes.find((item) => item.date === targetDate);
  if (current) {
    return Object.assign({ attachments: [] }, current, {
      content: current.content || "",
      date: targetDate,
      attachments: normalizeBoundlessAttachments(current.attachments || current.assets)
    });
  }
  const legacyContent = mergeLegacyNotes(targetDate).join("\n\n");
  const now = new Date().toISOString();
  return {
    id: `note-${targetDate}`,
    date: targetDate,
    content: legacyContent,
    attachments: [],
    createdAt: now,
    updatedAt: now
  };
}

function createBoundlessNote(date, patch) {
  const targetDate = normalizeNoteDate(date);
  const notes = readList(KEYS.boundlessNotes, []);
  const now = new Date().toISOString();
  const note = Object.assign({
    id: `note-${Date.now()}`,
    date: targetDate,
    content: "",
    attachments: [],
    createdAt: now,
    updatedAt: now
  }, patch || {}, {
    date: targetDate,
    attachments: normalizeBoundlessAttachments((patch && patch.attachments) || (patch && patch.assets) || []),
    updatedAt: now
  });
  writeList(KEYS.boundlessNotes, [note].concat(notes));
  return note;
}

function updateBoundlessNote(id, patch) {
  const notes = readList(KEYS.boundlessNotes, []);
  const now = new Date().toISOString();
  let updated = null;
  const next = notes.map((item) => {
    if (!matchesItemId(item, id)) return item;
    updated = Object.assign({}, item, patch || {}, {
      id: item.id || id,
      clientId: item.clientId || item.id || id,
      date: normalizeNoteDate((patch && patch.date) || item.date),
      attachments: normalizeBoundlessAttachments((patch && (patch.attachments || patch.assets)) || item.attachments || item.assets || []),
      updatedAt: now
    });
    return updated;
  });
  writeList(KEYS.boundlessNotes, next);
  return updated;
}

function deleteBoundlessNote(id) {
  const notes = readList(KEYS.boundlessNotes, []);
  const next = notes.filter((item) => !matchesItemId(item, id));
  writeList(KEYS.boundlessNotes, next);
  return next;
}

function getBoundlessNoteById(id) {
  const note = readList(KEYS.boundlessNotes, []).find((item) => matchesItemId(item, id)) || null;
  return note ? Object.assign({}, note, {
    attachments: normalizeBoundlessAttachments(note.attachments || note.assets)
  }) : null;
}

function listBoundlessNotesByDate(date) {
  const targetDate = normalizeNoteDate(date);
  return readList(KEYS.boundlessNotes, [])
    .filter((item) => item.status !== "draft" && item.date === targetDate && (item.content || (item.attachments || []).length))
    .map((item) => Object.assign({}, item, {
      attachments: normalizeBoundlessAttachments(item.attachments || item.assets)
    }))
    .sort((a, b) => `${b.updatedAt || b.createdAt || ""}`.localeCompare(`${a.updatedAt || a.createdAt || ""}`));
}

function saveBoundlessNote(date, patch) {
  const targetDate = normalizeNoteDate(date);
  const notes = readList(KEYS.boundlessNotes, []);
  const now = new Date().toISOString();
  const index = notes.findIndex((item) => item.date === targetDate);
  const previous = index >= 0 ? notes[index] : readBoundlessNote(targetDate);
  const nextNote = Object.assign({}, previous, patch, {
    id: previous.id || `note-${targetDate}`,
    date: targetDate,
    attachments: normalizeBoundlessAttachments(patch.attachments || patch.assets || previous.attachments || previous.assets || []),
    createdAt: previous.createdAt || now,
    updatedAt: now
  });
  const next = index >= 0 ? notes.map((item, itemIndex) => (itemIndex === index ? nextNote : item)) : [nextNote].concat(notes);
  writeList(KEYS.boundlessNotes, next);
  return nextNote;
}

function listBoundlessNotes(limit) {
  const notes = readList(KEYS.boundlessNotes, []).filter((item) => item.status !== "draft").map((item) => Object.assign({}, item, {
    attachments: normalizeBoundlessAttachments(item.attachments || item.assets)
  }));
  const legacy = readList(KEYS.diaries, []).map((item) => ({
    id: item.id,
    date: normalizeNoteDate(item.date || item.createdAt),
    content: item.content || "",
    attachments: [],
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || item.createdAt || ""
  }));
  const merged = notes.concat(legacy)
    .filter((item) => item.content || (item.attachments || []).length)
    .sort((a, b) => `${b.updatedAt || b.createdAt || b.date}`.localeCompare(`${a.updatedAt || a.createdAt || a.date}`));
  return limit ? merged.slice(0, limit) : merged;
}

function getBoundlessDraftByDate(date) {
  const targetDate = normalizeNoteDate(date);
  const draft = readList(KEYS.boundlessNotes, [])
    .filter((item) => item.status === "draft" && item.date === targetDate)
    .sort((a, b) => `${b.updatedAt || b.createdAt || ""}`.localeCompare(`${a.updatedAt || a.createdAt || ""}`))[0] || null;
  return draft ? Object.assign({}, draft, {
    attachments: normalizeBoundlessAttachments(draft.attachments || draft.assets)
  }) : null;
}

function listBoundlessNoteGroups() {
  const groups = {};
  listBoundlessNotes().forEach((item) => {
    const date = normalizeNoteDate(item.date || item.dateKey || item.createdAt);
    if (!groups[date]) groups[date] = [];
    groups[date].push(Object.assign({}, item, { date }));
  });
  return Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .map((date) => ({
      date,
      items: groups[date].sort((a, b) => `${b.updatedAt || b.createdAt || ""}`.localeCompare(`${a.updatedAt || a.createdAt || ""}`))
    }));
}

module.exports = {
  KEYS,
  readList,
  writeList,
  appendItem,
  removeItem,
  getItemById,
  updateItem,
  mergeSchedulesToStorage,
  mergeBoundlessNotesToStorage,
  mergeRecordsToStorage,
  todayKey,
  readBoundlessNote,
  saveBoundlessNote,
  createBoundlessNote,
  updateBoundlessNote,
  deleteBoundlessNote,
  getBoundlessNoteById,
  getBoundlessDraftByDate,
  listBoundlessNotesByDate,
  listBoundlessNotes,
  listBoundlessNoteGroups
};
