const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function success(data) {
  return { success: true, data };
}

function fail(message) {
  return { success: false, message: message || "周报生成失败，请稍后重试" };
}

function truncate(value, max) {
  return String(value || "").trim().slice(0, max);
}

function safeArray(value, max, itemMax) {
  return (Array.isArray(value) ? value : [])
    .map((item) => truncate(item, itemMax || 80))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeReport(value) {
  const report = value && typeof value === "object" ? value : {};
  return {
    title: truncate(report.title || "本周周报", 20),
    summary: truncate(report.summary, 100),
    highlights: safeArray(report.highlights, 3, 80),
    risks: safeArray(report.risks, 3, 80),
    suggestions: safeArray(report.suggestions, 4, 90),
    scheduleInsights: safeArray(report.scheduleInsights, 3, 90),
    noteInsights: safeArray(report.noteInsights, 3, 90),
    focusInsights: safeArray(report.focusInsights, 3, 90),
    nextWeekFocus: truncate(report.nextWeekFocus, 40),
    shareText: truncate(report.shareText, 120)
  };
}

function requestJson(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let payload = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch (error) {
          reject(new Error("invalid model response"));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error((payload && payload.error && payload.error.message) || `model status ${res.statusCode}`));
          return;
        }
        resolve(payload);
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("model request timeout")));
    req.write(JSON.stringify(body));
    req.end();
  });
}

function extractJson(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("empty model content");
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

function compactPayload(event) {
  const stats = event.stats || {};
  return {
    weekStart: truncate(event.weekStart, 10),
    weekEnd: truncate(event.weekEnd, 10),
    stats,
    daily: Array.isArray(event.daily) ? event.daily.slice(0, 7) : [],
    schedules: Array.isArray(event.schedules) ? event.schedules.slice(0, 30) : [],
    notes: Array.isArray(event.notes) ? event.notes.slice(0, 20) : [],
    pomodoro: Array.isArray(event.pomodoro) ? event.pomodoro.slice(0, 30) : []
  };
}

async function callDeepSeek(payload) {
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
  const systemPrompt = "你是一个大学生生活周报助手。你的任务是根据用户一周的日程、无边记、附件摘要、学习、运动、睡眠、娱乐和番茄钟数据，生成简洁、真诚、可执行的周报总结。你只能返回 JSON，不能返回 Markdown、解释文字或多余内容。不要夸大，不要编造不存在的数据。如果无边记包含图片或语音附件，但没有内容摘要，请只根据附件数量和类型进行温和推断，不要猜测具体内容。如果数据不足，请说明“本周记录较少”，并鼓励用户继续记录。建议必须具体、温和、可执行。";
  const userPrompt = `本周日期范围：${payload.weekStart} - ${payload.weekEnd}

本周统计：
${JSON.stringify(payload.stats)}

每日趋势：
${JSON.stringify(payload.daily)}

本周日程：
${JSON.stringify(payload.schedules)}

本周无边记与附件摘要：
${JSON.stringify(payload.notes)}

本周番茄钟：
${JSON.stringify(payload.pomodoro)}

请返回 JSON：
{
  "title": "本周周报",
  "summary": "",
  "highlights": [],
  "risks": [],
  "suggestions": [],
  "scheduleInsights": [],
  "noteInsights": [],
  "focusInsights": [],
  "nextWeekFocus": "",
  "shareText": ""
}`;
  const response = await requestJson("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    }
  }, {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.4,
    response_format: { type: "json_object" }
  });
  const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
  return normalizeReport(extractJson(content));
}

async function generateWeeklyReport(event) {
  const payload = compactPayload(event || {});
  try {
    const report = await callDeepSeek(payload);
    return success(report);
  } catch (error) {
    console.error("generate weekly report failed", error);
    return fail("周报生成失败，请稍后重试");
  }
}

async function generateShareSummary(event) {
  const report = await generateWeeklyReport(event);
  if (!report.success) return report;
  return success({ shareText: report.data.shareText || "" });
}

exports.main = async (event) => {
  const action = event && event.action;
  switch (action) {
    case "generateWeeklyReport":
      return generateWeeklyReport(event);
    case "generateShareSummary":
      return generateShareSummary(event);
    default:
      return fail(`unknown action: ${action || ""}`);
  }
};
