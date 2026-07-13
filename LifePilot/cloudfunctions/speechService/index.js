const cloud = require("wx-server-sdk");
const tencentcloud = require("tencentcloud-sdk-nodejs");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const AsrClient = tencentcloud.asr.v20190614.Client;

function success(data) {
  return { code: 0, message: "success", data };
}

function fail(code, message) {
  return { code, message, data: null };
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeVoiceFormat(value) {
  const raw = cleanText(value || "mp3", 20).toLowerCase().replace(/^\./, "");
  const aliases = {
    "x-m4a": "m4a",
    "mpeg": "mp3",
    "mpga": "mp3"
  };
  const normalized = aliases[raw] || raw;
  const supported = ["wav", "pcm", "ogg-opus", "speex", "silk", "mp3", "m4a", "aac", "amr"];
  return supported.includes(normalized) ? normalized : "mp3";
}

function getTencentAsrClient() {
  const secretId = process.env.ASR_SECRET_ID || process.env.TC_SECRET_ID || "";
  const secretKey = process.env.ASR_SECRET_KEY || process.env.TC_SECRET_KEY || "";
  if (!secretId || !secretKey) return null;

  return new AsrClient({
    credential: {
      secretId,
      secretKey
    },
    region: process.env.ASR_REGION || "",
    profile: {
      httpProfile: {
        endpoint: "asr.tencentcloudapi.com"
      }
    }
  });
}

function buildUserAudioKey(fileID) {
  const suffix = cleanText(fileID, 80).replace(/[^a-zA-Z0-9_-]/g, "_").slice(-48);
  return `schedule_voice_${Date.now()}_${suffix || "audio"}`;
}

async function getTempUrl(fileID) {
  const result = await cloud.getTempFileURL({ fileList: [fileID] });
  const item = result.fileList && result.fileList[0];
  if (!item || item.status !== 0 || !item.tempFileURL) {
    throw new Error("failed to get speech temp url");
  }
  return item.tempFileURL;
}

async function recognizeWithProvider(options) {
  const provider = (process.env.SPEECH_RECOGNITION_PROVIDER || "tencent").toLowerCase();
  if (provider !== "tencent") {
    return {
      configured: false,
      text: "",
      warnings: [`unsupported provider: ${provider}`]
    };
  }

  const client = getTencentAsrClient();
  if (!client) {
    return {
      configured: false,
      text: "",
      warnings: ["missing Tencent Cloud ASR credentials"]
    };
  }

  const params = {
    ProjectId: Number(process.env.ASR_PROJECT_ID || 0),
    SubServiceType: 2,
    EngSerViceType: process.env.ASR_ENGINE_MODEL || "16k_zh",
    SourceType: 0,
    Url: options.tempFileURL,
    VoiceFormat: normalizeVoiceFormat(options.format),
    UsrAudioKey: buildUserAudioKey(options.fileID),
    FilterDirty: 0,
    FilterModal: 0,
    FilterPunc: 0,
    ConvertNumMode: 1,
    WordInfo: 0
  };

  const response = await client.SentenceRecognition(params);
  return {
    configured: true,
    text: response && response.Result ? response.Result : "",
    raw: response
  };
}

async function handleRecognize(event) {
  const fileID = cleanText(event.fileID, 300);
  if (!fileID) return fail(400, "fileID is required");

  try {
    const tempFileURL = await getTempUrl(fileID);
    const result = await recognizeWithProvider({
      fileID,
      tempFileURL,
      format: cleanText(event.format || "mp3", 20),
      language: cleanText(event.language || "zh-CN", 20)
    });
    if (!result.configured) {
      return fail(501, "ASR is not configured. Please set ASR_SECRET_ID and ASR_SECRET_KEY in speechService.");
    }
    const text = cleanText(result.text, 1000);
    if (!text) return fail(204, "No speech text recognized.");
    return success({
      text,
      fileID,
      warnings: result.warnings || []
    });
  } catch (error) {
    console.error("speech recognize failed", error);
    return fail(500, "ASR recognition failed. Please check Tencent ASR settings and cloud function logs.");
  }
}

exports.main = async (event) => {
  const action = event && event.action;
  switch (action) {
    case "recognize":
      return handleRecognize(event || {});
    default:
      return fail(404, `unknown action: ${action || ""}`);
  }
};
