const cloud = require("wx-server-sdk");
const https = require("https");
const tencentcloud = require("tencentcloud-sdk-nodejs");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 请在微信云开发控制台或云函数环境变量中配置：
// TENCENT_SECRET_ID
// TENCENT_SECRET_KEY
// DEEPSEEK_API_KEY
const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID || "";
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY || "";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

const OCR_ACTIONS = {
  printed: "GeneralBasicOCR",
  accurate: "GeneralAccurateOCR",
  handwriting: "GeneralHandwritingOCR"
};

function success(data) {
  return { code: 0, message: "success", data };
}

function fail(code, message) {
  return { code, message, data: null };
}

function pad(value) {
  const number = Number(value);
  return number < 10 ? `0${number}` : `${number}`;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function weekdayFromDateKey(dateKey) {
  if (!isDateKey(dateKey)) return 0;
  const parts = String(dateKey).split("-").map(Number);
  const weekday = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  return weekday === 0 ? 7 : weekday;
}

function isTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

function requestJson(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const target = new URL(url);
    const req = https.request({
      method: "POST",
      hostname: target.hostname,
      path: `${target.pathname}${target.search || ""}`,
      headers: Object.assign({
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }, headers || {})
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (error) {
          reject(new Error(`DeepSeek returned non-json: ${text.slice(0, 120)}`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(data.error && data.error.message ? data.error.message : `DeepSeek status ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function extractOcrText(result) {
  const detections = result && (result.TextDetections || result.TextDetection || result.TextDetectionsOCR);
  if (Array.isArray(detections)) {
    return detections.map((item) => item.DetectedText || item.Text || "").filter(Boolean).join("\n");
  }
  if (Array.isArray(result && result.TextDetections)) {
    return result.TextDetections.map((item) => item.DetectedText || "").join("\n");
  }
  return "";
}

function normalizeOcrLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function callTencentOCR(imageBase64, mode) {
  const action = OCR_ACTIONS[mode] || OCR_ACTIONS.accurate;
  const OcrClient = tencentcloud.ocr.v20181119.Client;
  const client = new OcrClient({
    credential: {
      secretId: TENCENT_SECRET_ID,
      secretKey: TENCENT_SECRET_KEY
    },
    region: "ap-guangzhou",
    profile: {
      httpProfile: {
        endpoint: "ocr.tencentcloudapi.com"
      }
    }
  });
  if (typeof client[action] !== "function") {
    throw new Error(`不支持的 OCR Action: ${action}`);
  }
  return client[action]({ ImageBase64: imageBase64 });
}

function buildPrompt(ocrText, currentYear) {
  return [
    "你是课程表解析器。请从 OCR 文本中提取课程并返回严格 JSON。",
    "只返回 JSON，不要返回 Markdown，不要解释，不要编造不存在的课程。",
    "无法确定的字段使用空字符串，并在 warnings 中说明。",
    `如果没有明确年份，默认年份使用 ${currentYear}。`,
    "日期必须为 yyyy-mm-dd，时间必须为 HH:mm。",
    "当前项目按单日日程处理，endDateKey 必须等于 startDateKey。",
    "weekday 是必填字段，使用 1-7 表示周一到周日。",
    "必须根据课程表中的周几列、周几行、星期文字或日期推断 weekday；例如周二返回 2，周五返回 5。",
    "如果只能识别日期但没有星期文字，请根据 startDateKey 计算 weekday，不要省略。",
    "返回结构：",
    "{\"courses\":[{\"title\":\"\",\"location\":\"\",\"weekday\":3,\"startDateKey\":\"2026-06-03\",\"endDateKey\":\"2026-06-03\",\"startTime\":\"13:30\",\"endTime\":\"15:05\",\"repeatRule\":{\"type\":\"weekly\",\"interval\":1,\"endDate\":\"2026-07-04\"},\"confidence\":0.8,\"rawText\":\"\"}],\"warnings\":[]}",
    "OCR 文本：",
    ocrText
  ].join("\n");
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("DeepSeek 返回为空");
  try {
    return JSON.parse(value);
  } catch (error) {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }
    throw error;
  }
}

async function callDeepSeek(ocrText, currentYear) {
  const response = await requestJson(DEEPSEEK_API_URL, {
    model: "deepseek-chat",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "你只输出可解析 JSON。"
      },
      {
        role: "user",
        content: buildPrompt(ocrText, currentYear)
      }
    ],
    temperature: 0.1
  }, {
    Authorization: `Bearer ${DEEPSEEK_API_KEY}`
  });
  const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
  return extractJsonObject(content);
}

function normalizeCourse(course, currentYear) {
  const startDateKey = isDateKey(course.startDateKey) ? course.startDateKey : "";
  const repeatRule = course.repeatRule && typeof course.repeatRule === "object" ? course.repeatRule : {};
  const endDate = isDateKey(repeatRule.endDate) ? repeatRule.endDate : startDateKey;
  const weekday = Number(course.weekday || 0) || weekdayFromDateKey(startDateKey);
  return {
    title: String(course.title || "").trim(),
    location: String(course.location || "").trim(),
    weekday: weekday >= 1 && weekday <= 7 ? weekday : 0,
    startDateKey,
    endDateKey: startDateKey,
    startTime: isTime(course.startTime) ? course.startTime : "",
    endTime: isTime(course.endTime) ? course.endTime : "",
    repeatRule: {
      type: "weekly",
      interval: Math.max(1, Number(repeatRule.interval || 1)),
      endDate
    },
    confidence: Number(course.confidence || 0),
    rawText: String(course.rawText || "").slice(0, 1000),
    currentYear: Number(currentYear)
  };
}

exports.main = async (event) => {
  const fileID = event && event.fileID;
  const action = event && event.action;
  const mode = event && event.mode ? event.mode : "accurate";
  const currentYear = Number((event && event.currentYear) || new Date().getFullYear());

  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    return fail(500, "OCR API Key 未配置");
  }
  if (!fileID) return fail(400, "fileID is required");

  try {
    const file = await cloud.downloadFile({ fileID });
    const imageBase64 = Buffer.from(file.fileContent).toString("base64");
    const ocrResult = await callTencentOCR(imageBase64, mode);
    const ocrText = extractOcrText(ocrResult);
    if (!ocrText) return fail(500, "OCR 未识别到文字");

    if (action === "recognizeText") {
      return success({
        text: normalizeOcrLines(ocrText),
        fileID,
        warnings: []
      });
    }

    if (!DEEPSEEK_API_KEY) {
      return fail(500, "DeepSeek API Key 未配置");
    }

    const parsed = await callDeepSeek(ocrText, currentYear);
    const courses = ((parsed && parsed.courses) || []).map((item) => normalizeCourse(item, currentYear));
    const warnings = Array.isArray(parsed && parsed.warnings) ? parsed.warnings : [];

    courses.forEach((course) => {
      if (!course.title) warnings.push("存在未识别课程名的条目");
      if (!course.startDateKey) warnings.push(`${course.title || "某课程"} 缺少开始日期`);
      if (!course.startTime || !course.endTime) warnings.push(`${course.title || "某课程"} 缺少上课时间`);
      if (!course.repeatRule.endDate) warnings.push(`${course.title || "某课程"} 缺少重复结束日期`);
      if (course.startDateKey && course.repeatRule.endDate && course.repeatRule.endDate < course.startDateKey) {
        course.repeatRule.endDate = course.startDateKey;
        warnings.push(`${course.title || "某课程"} 的重复结束日期早于开始日期，已按开始日期处理`);
      }
    });

    return success({ ocrText, courses, warnings });
  } catch (error) {
    console.error("ocrCourseService failed", error);
    return fail(500, error.message || "课程识别失败");
  }
};
