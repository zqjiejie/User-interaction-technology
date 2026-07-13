const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const DEFAULT_CONFIG = {
  studyGoal: 25,
  sportGoal: 3,
  sleepGoal: 8,
  entertainmentLimit: 600
};

function success(data) {
  return { code: 0, message: "success", data };
}

function fail(code, message) {
  return { code, message, data: null };
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateKeyFrom(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function sum(list, key) {
  return list.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function getSportMinutes(item) {
  return Number(item.sportMinutes || item.exerciseMinutes || 0);
}

function getSportMinutesFromList(list) {
  return list.reduce((total, item) => total + getSportMinutes(item), 0);
}

function average(list, key) {
  return list.length ? sum(list, key) / list.length : 0;
}

function percent(value, target) {
  if (!target) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

function formatHours(minutes) {
  return `${(Number(minutes || 0) / 60).toFixed(1)}h`;
}

function defaultWeekRange() {
  const now = new Date();
  const day = now.getDay() || 7;
  const start = new Date(now);
  start.setDate(now.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10)
  };
}

async function getUserGoals(openid) {
  const userRes = await db.collection("users").where({ openid }).limit(1).get();
  const user = userRes.data[0] || {};
  const sleepGoalNum = Number(user.sleepGoal);
  return {
    studyGoal: user.studyGoal !== null && user.studyGoal !== undefined ? Number(user.studyGoal) : DEFAULT_CONFIG.studyGoal,
    sportGoal: user.sportGoal !== null && user.sportGoal !== undefined ? Number(user.sportGoal) : DEFAULT_CONFIG.sportGoal,
    sleepGoal: Number.isFinite(sleepGoalNum) ? sleepGoalNum : DEFAULT_CONFIG.sleepGoal,
    entertainmentLimit: user.entertainmentLimit !== null && user.entertainmentLimit !== undefined ? Number(user.entertainmentLimit) : DEFAULT_CONFIG.entertainmentLimit
  };
}

async function findOwnSchedule(openid, id) {
  if (!id) return null;
  const byDoc = await db.collection("schedules").doc(id).get().catch(() => null);
  if (byDoc && byDoc.data && byDoc.data.openid === openid) return byDoc.data;
  const byClient = await db.collection("schedules").where({ openid, clientId: id }).limit(1).get();
  return byClient.data[0] || null;
}

async function handleCreateRecord(event, openid) {
  const date = event.date || new Date().toISOString().slice(0, 10);
  if (!isDateKey(date)) return fail(400, "valid date is required");

  const now = db.serverDate();
  const existed = await db.collection("records").where({ openid, date }).limit(1).get();
  const current = existed.data[0] || {};
  const studyDelta = numberValue(event.studyMinutesDelta, 0);
  const sportDelta = numberValue(event.sportMinutesDelta, 0);
  const entertainmentDelta = numberValue(event.entertainmentMinutesDelta, 0);
  const sportValue = numberValue(event.sportMinutes || event.exerciseMinutes, current.sportMinutes || current.exerciseMinutes || 0);

  const payload = {
    openid,
    userId: openid,
    date,
    studyMinutes: studyDelta ? _.inc(studyDelta) : numberValue(event.studyMinutes, current.studyMinutes || 0),
    entertainmentMinutes: entertainmentDelta ? _.inc(entertainmentDelta) : numberValue(event.entertainmentMinutes, current.entertainmentMinutes || 0),
    exerciseMinutes: sportDelta ? _.inc(sportDelta) : sportValue,
    sportMinutes: sportDelta ? _.inc(sportDelta) : sportValue,
    sleepHours: numberValue(event.sleepHours, current.sleepHours || 0),
    mood: String(event.mood || current.mood || "").slice(0, 80),
    note: String(event.note || current.note || "").slice(0, 1000),
    updatedAt: now
  };

  if (existed.data.length) {
    await db.collection("records").doc(existed.data[0]._id).update({ data: payload });
    return success({ id: existed.data[0]._id, updated: true });
  }

  const createPayload = Object.assign({}, payload, {
    studyMinutes: studyDelta || numberValue(event.studyMinutes, 0),
    entertainmentMinutes: entertainmentDelta || numberValue(event.entertainmentMinutes, 0),
    exerciseMinutes: sportDelta || numberValue(event.sportMinutes || event.exerciseMinutes, 0),
    sportMinutes: sportDelta || numberValue(event.sportMinutes || event.exerciseMinutes, 0),
    createdAt: now
  });
  const res = await db.collection("records").add({ data: createPayload });
  return success({ id: res._id, created: true });
}

async function handleCreatePomodoro(event, openid) {
  const category = event.category || event.type;
  if (!["study", "sport", "entertainment", "sleep"].includes(category)) return fail(400, "invalid category");

  const durationMinutes = Math.max(0, Math.round(Number(event.durationMinutes || 0)));
  if (!durationMinutes) return fail(400, "durationMinutes is required");

  const startedAt = event.startedAt ? new Date(event.startedAt) : new Date(Date.now() - durationMinutes * 60000);
  const endedAt = event.endedAt ? new Date(event.endedAt) : new Date();
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return fail(400, "invalid time");

  const clientId = String(event.clientId || "").slice(0, 80);
  if (clientId) {
    const existed = await db.collection("pomodoroSessions").where({ openid, clientId }).limit(1).get();
    if (existed.data[0]) return success({ id: existed.data[0]._id, clientId, existed: true });
  }

  const schedule = await findOwnSchedule(openid, event.scheduleId);
  const res = await db.collection("pomodoroSessions").add({
    data: {
      openid,
      userId: openid,
      clientId,
      scheduleId: schedule ? schedule._id : "",
      category,
      durationMinutes,
      startedAt,
      endedAt,
      completed: event.completed !== false,
      exitReason: event.exitReason || "ended_by_user",
      createdAt: db.serverDate()
    }
  });

  const date = event.date || dateKeyFrom(endedAt);
  const delta = { date };
  if (category === "study") delta.studyMinutesDelta = durationMinutes;
  if (category === "sport") delta.sportMinutesDelta = durationMinutes;
  if (category === "entertainment") delta.entertainmentMinutesDelta = durationMinutes;
  if (delta.studyMinutesDelta || delta.sportMinutesDelta || delta.entertainmentMinutesDelta) {
    await handleCreateRecord(delta, openid);
  }

  if (schedule) {
    await db.collection("schedules").doc(schedule._id).update({
      data: { focusMinutes: _.inc(durationMinutes), updatedAt: db.serverDate() }
    });
  }

  return success({ id: res._id });
}

async function findOwnPomodoro(openid, id, clientId) {
  const target = String(id || clientId || "");
  if (!target) return null;
  const byDoc = await db.collection("pomodoroSessions").doc(target).get().catch(() => null);
  if (byDoc && byDoc.data && byDoc.data.openid === openid) return byDoc.data;
  const byClient = await db.collection("pomodoroSessions")
    .where({ openid, clientId: target })
    .limit(1)
    .get();
  return byClient.data[0] || null;
}

async function handleDeletePomodoro(event, openid) {
  const session = await findOwnPomodoro(openid, event.id, event.clientId);
  if (!session || !session._id) return fail(404, "pomodoro not found");
  await db.collection("pomodoroSessions").doc(session._id).update({
    data: {
      isDeleted: true,
      deletedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  });
  return success({ id: session._id, deleted: true });
}

async function handleListPomodoro(event, openid) {
  const limit = Math.min(100, Math.max(1, Number(event.limit || 80)));
  const res = await db.collection("pomodoroSessions")
    .where({ openid })
    .orderBy("endedAt", "desc")
    .limit(limit)
    .get();

  return success({
    records: (res.data || []).filter((item) => item.isDeleted !== true).map((item) => ({
      id: item._id,
      _id: item._id,
      clientId: item.clientId || "",
      cloudId: item._id,
      source: "pomodoro",
      module: item.category || item.type || "",
      category: item.category || item.type || "",
      title: item.title || "",
      date: item.date || dateKeyFrom(item.endedAt || item.createdAt),
      durationMinutes: item.durationMinutes || 0,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      completed: item.completed !== false,
      exitReason: item.exitReason || "",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  });
}

async function handleListRecords(event, openid) {
  const limit = Math.min(120, Math.max(1, Number(event.limit || 80)));
  const res = await db.collection("records")
    .where({ openid })
    .orderBy("date", "desc")
    .limit(limit)
    .get();

  return success({
    records: (res.data || []).map((item) => ({
      id: item._id,
      _id: item._id,
      cloudId: item._id,
      clientId: item.clientId || "",
      source: "manualAggregate",
      type: "manual",
      date: item.date,
      studyMinutes: item.studyMinutes || 0,
      sportMinutes: item.sportMinutes || item.exerciseMinutes || 0,
      exerciseMinutes: item.exerciseMinutes || item.sportMinutes || 0,
      entertainmentMinutes: item.entertainmentMinutes || 0,
      sleepHours: item.sleepHours || 0,
      mood: item.mood || "",
      note: item.note || "",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  });
}

function buildScores(stats, goals) {
  const study = percent(stats.studyMinutes, goals.studyGoal * 60);
  const sport = percent(stats.sportMinutes, goals.sportGoal * 30);
  const sleep = percent(stats.sleepAvg, goals.sleepGoal);
  const discipline = Math.max(0, Math.min(100, 100 - Math.round(Math.max(0, stats.entertainmentMinutes - goals.entertainmentLimit) / 6)));
  return {
    study,
    health: Math.round((sleep * 0.6) + (sport * 0.4)),
    discipline,
    balance: Math.round((study + sport + sleep + discipline) / 4),
    growth: stats.studyMinutes > 0 ? 82 : 0
  };
}

function buildOverview(records, goals, music) {
  const list = records || [];
  const studyMinutes = sum(list, "studyMinutes");
  const entertainmentMinutes = sum(list, "entertainmentMinutes");
  const sportMinutes = getSportMinutesFromList(list);
  const avgSleep = average(list, "sleepHours");
  const sportCount = list.filter((item) => getSportMinutes(item) > 0).length;
  const stats = {
    studyMinutes,
    entertainmentMinutes,
    sportMinutes,
    exerciseMinutes: sportMinutes,
    sleepAvg: Number(avgSleep.toFixed(1))
  };
  const scores = buildScores(stats, goals);

  return {
    totalScore: Math.round((scores.study + scores.health + scores.discipline + scores.balance) / 4),
    studyMinutes,
    entertainmentMinutes,
    sportMinutes,
    sleepAvg: stats.sleepAvg,
    summary: list.length ? "Your week is visible now. Keep recording small changes daily." : "No records yet. Add one record to start the weekly review.",
    cards: {
      study: {
        title: "Study",
        totalMinutes: studyMinutes,
        value: formatHours(studyMinutes),
        suggestion: studyMinutes ? "Keep fixed focus blocks for course review." : "Start with one 25-minute focus block."
      },
      entertainment: {
        title: "Play",
        totalMinutes: entertainmentMinutes,
        value: formatHours(entertainmentMinutes),
        suggestion: entertainmentMinutes > goals.entertainmentLimit ? "Entertainment is over target. Add a night cutoff." : "Entertainment is still within target."
      },
      sleep: {
        title: "Sleep",
        avgHours: stats.sleepAvg,
        value: `${stats.sleepAvg}h`,
        score: scores.health,
        suggestion: avgSleep < goals.sleepGoal ? "Sleep is below target. Move intense tasks earlier." : "Sleep is stable."
      },
      sport: {
        title: "Sport",
        totalMinutes: sportMinutes,
        count: sportCount,
        targetRate: percent(sportMinutes, goals.sportGoal * 30),
        value: `${sportCount}/${goals.sportGoal}`,
        suggestion: sportCount < goals.sportGoal ? "Add a light workout session." : "Sport goal is on track."
      },
      music: {
        title: "Music",
        relaxMinutes: Number(music.todayMinutes || 0),
        focusMinutes: Number(music.focusMinutes || 0),
        value: `${music.todayMinutes || 0}m`,
        suggestion: music.advice || "Use focus music before deep work."
      }
    }
  };
}

async function readWeekRecords(openid, range) {
  const res = await db.collection("records")
    .where({ openid, date: _.gte(range.weekStart).and(_.lte(range.weekEnd)) })
    .orderBy("date", "desc")
    .get();
  return res.data || [];
}

async function handleGetOverview(event, openid) {
  const range = Object.assign(defaultWeekRange(), event || {});
  const goals = await getUserGoals(openid);
  const records = await readWeekRecords(openid, range);
  return success(Object.assign({ weekRange: `${range.weekStart.slice(5)} - ${range.weekEnd.slice(5)}` }, buildOverview(records, goals, event.music || {})));
}

async function handleGetWeeklyReport(event, openid) {
  const range = Object.assign(defaultWeekRange(), event || {});
  let records = Array.isArray(event.records) ? event.records : [];
  if (!records.length) records = await readWeekRecords(openid, range);

  const goals = await getUserGoals(openid);
  const stats = {
    studyMinutes: sum(records, "studyMinutes"),
    entertainmentMinutes: sum(records, "entertainmentMinutes"),
    exerciseMinutes: getSportMinutesFromList(records),
    sportMinutes: getSportMinutesFromList(records),
    sleepAvg: records.length ? Number(average(records, "sleepHours").toFixed(1)) : 0
  };
  const scores = buildScores(stats, goals);
  const advice = records.length
    ? "Keep the rhythm visible with daily records and adjust one habit at a time."
    : "Add records this week to generate a useful report.";
  const suggestions = [
    "Keep lightweight daily records.",
    "Adjust one habit at a time across study, play, sport, and sleep."
  ];

  if (records.length) {
    await db.collection("reports").add({
      data: {
        openid,
        userId: openid,
        weekStart: range.weekStart,
        weekEnd: range.weekEnd,
        studyTotal: stats.studyMinutes,
        entertainmentTotal: stats.entertainmentMinutes,
        sportTotal: stats.sportMinutes,
        avgSleep: stats.sleepAvg,
        scores,
        aiSummary: advice,
        suggestions,
        createdAt: db.serverDate()
      }
    }).catch(() => {});
  }

  return success({
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    stats,
    scores,
    aiSummary: advice,
    suggestions,
    advice
  });
}

exports.main = async (event) => {
  const action = event && event.action;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) return fail(401, "login required");

  try {
    switch (action) {
      case "createRecord":
        return await handleCreateRecord(event, openid);
      case "createPomodoro":
        return await handleCreatePomodoro(event, openid);
      case "deletePomodoro":
        return await handleDeletePomodoro(event, openid);
      case "listPomodoro":
        return await handleListPomodoro(event, openid);
      case "listRecords":
        return await handleListRecords(event, openid);
      case "getOverview":
        return await handleGetOverview(event, openid);
      case "getWeeklyReport":
        return await handleGetWeeklyReport(event, openid);
      default:
        return fail(404, `unknown action: ${action || ""}`);
    }
  } catch (error) {
    console.error("recordService error", action, error);
    return fail(500, "server error");
  }
};
