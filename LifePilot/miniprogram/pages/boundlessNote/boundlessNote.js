const storage = require("../../utils/storage");
const { api } = require("../../utils/cloud");

const {
  KEYS,
  readList,
  removeItem,
  createBoundlessNote,
  updateBoundlessNote,
  deleteBoundlessNote,
  getBoundlessNoteById,
  getBoundlessDraftByDate,
  todayKey
} = storage;

function normalizeDate(value) {
  if (!value) return todayKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) {
    const parts = value.split("-");
    return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }
  return todayKey();
}

function displayDate(dateKey) {
  const target = normalizeDate(dateKey);
  const parts = target.split("-");
  if (target === todayKey()) return "今天";
  return `${Number(parts[0])}.${Number(parts[1])}.${Number(parts[2])}`;
}

function findLegacyNote(id) {
  return readList(KEYS.diaries, []).find((item) => String(item.id || "") === String(id || "")) || null;
}

function attachmentTitle(type) {
  const titles = {
    location: "关联地点",
    image: "图片",
    photo: "照片",
    audio: "录音",
    scanText: "扫描文本"
  };
  return titles[type] || "附件";
}

function normalizeAttachment(item) {
  const rawType = item && item.type;
  const type = rawType === "camera" ? "photo" : rawType === "record" ? "audio" : rawType === "scan" ? "scanText" : rawType;
  const title = (item && (item.title || item.label)) || attachmentTitle(type);
  return Object.assign({
    id: `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type: type || "",
    title,
    label: title,
    value: "",
    meta: {}
  }, item || {}, {
    type: type || "",
    title,
    label: title,
    meta: (item && item.meta) || {}
  });
}

function createAttachment(type, title, value, meta) {
  return normalizeAttachment({
    id: `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type,
    title: title || attachmentTitle(type),
    value: value || "",
    meta: meta || {}
  });
}

function attachmentSource(item) {
  return item && (item.tempFileURL || item.fileID || (String(item.value || "").indexOf("cloud://") === 0 ? item.value : "") || item.url || item.src || item.localPath || item.path || item.value || "");
}

function isImageAttachment(item) {
  const type = item && item.type;
  const title = String((item && (item.title || item.label)) || "");
  const src = attachmentSource(item);
  return ["image", "photo", "camera"].includes(type)
    || (!type && title.includes("图片"))
    || (!type && /\.(png|jpe?g|gif|webp|bmp)$/i.test(src));
}

function normalizeImageAttachment(item) {
  const normalized = normalizeAttachment(item);
  const src = attachmentSource(normalized);
  const value = String(normalized.value || "");
  return Object.assign({}, normalized, {
    src,
    fileID: normalized.fileID || (value.indexOf("cloud://") === 0 ? value : ""),
    localPath: normalized.localPath || normalized.path || (value.indexOf("cloud://") === 0 ? "" : value),
    title: normalized.title || "图片"
  });
}

function buildAttachmentView(items) {
  const imageAttachments = [];
  const otherAttachments = [];
  (items || []).map(normalizeAttachment).forEach((item) => {
    if (isImageAttachment(item)) {
      imageAttachments.push(normalizeImageAttachment(item));
    } else {
      otherAttachments.push(item);
    }
  });
  return {
    imageAttachments,
    otherAttachments,
    previewImageUrls: imageAttachments.map((item) => item.src).filter(Boolean)
  };
}

async function resolveCloudImageAttachments(imageAttachments) {
  const list = imageAttachments || [];
  const cloudFileIDs = list
    .map((item) => item.fileID || item.value || "")
    .filter((value) => String(value).indexOf("cloud://") === 0);
  if (!cloudFileIDs.length || !wx.cloud || !wx.cloud.getTempFileURL) return null;
  try {
    const res = await wx.cloud.getTempFileURL({
      fileList: cloudFileIDs.map((fileID) => ({ fileID }))
    });
    const tempMap = {};
    (res.fileList || []).forEach((item) => {
      if (item.fileID && item.tempFileURL) tempMap[item.fileID] = item.tempFileURL;
    });
    const nextImages = list.map((item) => {
      const fileID = item.fileID || item.value || "";
      return Object.assign({}, item, {
        src: tempMap[fileID] || item.localPath || item.src,
        tempFileURL: tempMap[fileID] || item.tempFileURL || ""
      });
    });
    return {
      imageAttachments: nextImages,
      previewImageUrls: nextImages.map((item) => item.src).filter(Boolean)
    };
  } catch (error) {
    console.warn("resolve cloud image attachments failed", error);
    return null;
  }
}

function attachmentSignature(items) {
  return JSON.stringify((items || []).map((item) => normalizeAttachment(item)));
}

function cloudSafeAttachment(item) {
  const next = normalizeAttachment(item);
  const value = String(next.value || "");
  if (next.fileID || value.indexOf("cloud://") === 0) {
    return Object.assign({}, next, {
      value: next.fileID || value,
      fileID: next.fileID || value,
      localPath: "",
      path: "",
      src: "",
      tempFileURL: ""
    });
  }
  return next;
}

function refreshPreviousPage() {
  const pages = getCurrentPages ? getCurrentPages() : [];
  const prevPage = pages[pages.length - 2];
  if (!prevPage) return;
  if (typeof prevPage.refreshCalendar === "function") prevPage.refreshCalendar({ skipCloud: true });
  if (typeof prevPage.refreshNotes === "function") prevPage.refreshNotes({ skipCloud: true });
  if (typeof prevPage.loadNotes === "function") prevPage.loadNotes({ skipCloud: true });
  if (typeof prevPage.refreshUser === "function") prevPage.refreshUser();
}

Page({
  data: {
    pageMode: "create",
    editingNoteId: "",
    editingNoteDate: todayKey(),
    editingNoteDateText: displayDate(todayKey()),
    editingNoteContent: "",
    editingNoteAttachments: [],
    imageAttachments: [],
    otherAttachments: [],
    previewImageUrls: [],
    noteSavedContent: "",
    noteSavedAttachments: [],
    noteDirty: false,
    attachmentPanelOpen: false,
    recognizingText: false,
    recording: false,
    playingAudioId: "",
    attachmentOptions: [
      { type: "location", label: "关联地点" },
      { type: "image", label: "添加图片" },
      { type: "audio", label: "录音" },
      { type: "photo", label: "拍照" },
      { type: "scanText", label: "扫描文本" }
    ]
  },

  onLoad(query) {
    const id = query && query.id ? query.id : "";
    const date = normalizeDate(query && (query.date || query.dateKey));
    const isWrite = query && query.mode === "write";
    const note = id ? (getBoundlessNoteById(id) || findLegacyNote(id)) : null;
    const draft = isWrite && !note ? getBoundlessDraftByDate(date) : null;

    if (id && !note) {
      wx.showToast({ title: "未找到无边记", icon: "none" });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }

    const initial = note || draft || {
      id: "",
      date,
      content: query && query.content ? decodeURIComponent(query.content) : "",
      attachments: [],
      status: isWrite ? "draft" : "done"
    };
    this.loadNote(initial, isWrite ? "write" : note ? "edit" : "write");
  },

  onUnload() {
    if (this.audioContext) {
      this.audioContext.stop();
      this.audioContext.destroy();
      this.audioContext = null;
    }
  },

  loadNote(note, mode) {
    const date = normalizeDate(note.date || note.dateKey || todayKey());
    const content = note.content || note.text || note.note || "";
    const attachments = (note.attachments || note.assets || []).map(normalizeAttachment);
    const view = buildAttachmentView(attachments);
    this.setData(Object.assign({
      pageMode: mode,
      editingNoteId: note.id || note.clientId || "",
      editingNoteDate: date,
      editingNoteDateText: displayDate(date),
      editingNoteContent: content,
      editingNoteAttachments: attachments,
      noteSavedContent: content,
      noteSavedAttachments: attachments,
      noteDirty: false,
      attachmentPanelOpen: false,
      recognizingText: false,
      recording: false,
      playingAudioId: ""
    }, view));
    this.resolveAndSetImageViews(view.imageAttachments);
  },

  updateNoteContent(e) {
    const content = e.detail.value;
    this.setData({
      editingNoteContent: content,
      noteDirty: content !== this.data.noteSavedContent
        || attachmentSignature(this.data.editingNoteAttachments) !== attachmentSignature(this.data.noteSavedAttachments)
    });
  },

  onDateChange(e) {
    const date = normalizeDate(e.detail.value);
    this.setData({
      editingNoteDate: date,
      editingNoteDateText: displayDate(date),
      noteDirty: true
    });
  },

  toggleAttachmentPanel() {
    this.setData({ attachmentPanelOpen: !this.data.attachmentPanelOpen });
  },

  closeAttachmentPanel() {
    if (this.data.attachmentPanelOpen) {
      this.setData({ attachmentPanelOpen: false });
    }
  },

  handleAttachmentOption(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ attachmentPanelOpen: false });
    if (type === "location") {
      this.chooseLocation();
      return;
    }
    if (type === "image") {
      this.chooseImages(["album"], "image");
      return;
    }
    if (type === "photo") {
      this.chooseImages(["camera"], "photo");
      return;
    }
    if (type === "audio") {
      this.startRecording();
      return;
    }
    if (type === "scanText") {
      this.scanText();
    }
  },

  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.addAttachments([createAttachment("location", res.name || "关联地点", res.address || "", {
          name: res.name || "",
          address: res.address || "",
          latitude: res.latitude,
          longitude: res.longitude
        })]);
        wx.showToast({ title: "已关联地点", icon: "success" });
      }
    });
  },

  chooseImages(sourceType, type) {
    const imageCount = this.data.editingNoteAttachments.filter((item) => item.type === "image" || item.type === "photo").length;
    const count = Math.max(1, 9 - imageCount);
    const addFiles = (files) => {
      const attachments = (files || []).map((file) => {
        const path = file.tempFilePath || file.path || file;
        return createAttachment(type, attachmentTitle(type), path, {
          localPath: path,
          size: file.size || 0,
          width: file.width || 0,
          height: file.height || 0
        });
      }).filter((item) => item.value);
      if (!attachments.length) return;
      this.addAttachments(attachments);
      this.uploadLocalImageAttachments(attachments);
      wx.showToast({ title: type === "photo" ? "已添加照片" : "已添加图片", icon: "success" });
    };

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count,
        mediaType: ["image"],
        sourceType,
        success: (res) => addFiles(res.tempFiles || [])
      });
      return;
    }

    wx.chooseImage({
      count,
      sourceType,
      success: (res) => {
        const files = (res.tempFilePaths || []).map((path, index) => Object.assign({
          tempFilePath: path
        }, (res.tempFiles || [])[index] || {}));
        addFiles(files);
      }
    });
  },

  startRecording() {
    if (!wx.getRecorderManager) {
      wx.showToast({ title: "当前环境不支持录音", icon: "none" });
      return;
    }
    const recorder = wx.getRecorderManager();
    if (!this.recorderBound) {
      recorder.onStop((res) => {
        this.setData({ recording: false });
        if (this.cancelRecording) {
          this.cancelRecording = false;
          return;
        }
        if (!res.tempFilePath) return;
        this.addAttachments([createAttachment("audio", "录音", res.tempFilePath, { duration: res.duration || 0 })]);
        wx.showToast({ title: "已添加录音", icon: "success" });
      });
      recorder.onError(() => {
        this.setData({ recording: false });
        wx.showToast({ title: "请允许录音权限", icon: "none" });
      });
      this.recorderBound = true;
    }
    this.setData({ recording: true });
    recorder.start({ duration: 60000, format: "mp3" });
    wx.showModal({
      title: "正在录音",
      content: "点击停止保存本次录音。",
      confirmText: "停止",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        this.cancelRecording = !res.confirm;
        recorder.stop();
      }
    });
  },

  scanText() {
    const addScan = (path) => {
      if (!path) return;
      this.recognizeTextFromImage(path);
    };

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: (res) => addScan(res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath)
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sourceType: ["album", "camera"],
      success: (res) => addScan(res.tempFilePaths && res.tempFilePaths[0])
    });
  },

  async recognizeTextFromImage(path) {
    if (this.data.recognizingText) return;
    this.setData({ recognizingText: true });
    wx.showLoading({ title: "识别文字中..." });
    try {
      const fileID = await this.uploadAttachmentFile(path, "scan-text");
      const result = await api.courseOCR.parseImage({
        action: "recognizeText",
        fileID,
        mode: "accurate"
      });
      const data = result && result.data ? result.data : {};
      const text = String(data.text || data.ocrText || "").trim();
      if (!text) {
        wx.showToast({ title: "未识别到文字", icon: "none" });
        return;
      }
      const separator = this.data.editingNoteContent.trim() ? "\n" : "";
      const nextContent = `${this.data.editingNoteContent}${separator}${text}`;
      const attachment = createAttachment("scanText", "扫描文本", text, {
        fileID,
        imagePath: path,
        recognizedText: text,
        warnings: data.warnings || []
      });
      this.addAttachments([attachment], {
        editingNoteContent: nextContent
      });
      wx.showToast({ title: "已识别文本", icon: "success" });
    } catch (error) {
      console.warn("scan text OCR failed", error);
      wx.showToast({ title: "识别失败，请稍后重试", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ recognizingText: false });
    }
  },

  uploadAttachmentFile(path, prefix) {
    if (!wx.cloud || !wx.cloud.uploadFile) {
      return Promise.reject(new Error("cloud upload is not available"));
    }
    const ext = String(path || "").split("?")[0].split(".").pop() || "jpg";
    return wx.cloud.uploadFile({
      cloudPath: `boundless/${prefix || "attachment"}/${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`,
      filePath: path
    }).then((res) => res.fileID);
  },

  uploadLocalImageAttachments(items) {
    if (!wx.cloud || !wx.cloud.uploadFile) return;
    (items || []).forEach((item) => {
      const localPath = item.localPath || item.value || "";
      if (!localPath || String(localPath).indexOf("cloud://") === 0) return;
      this.uploadAttachmentFile(localPath, "images").then((fileID) => {
        const attachments = (this.data.editingNoteAttachments || []).map((attachment) => {
          if (attachment.id !== item.id) return attachment;
          return Object.assign({}, attachment, {
            value: fileID,
            fileID,
            localPath
          });
        });
        const view = buildAttachmentView(attachments);
        this.setData(Object.assign({
          editingNoteAttachments: attachments,
          noteDirty: true
        }, view));
        this.resolveAndSetImageViews(view.imageAttachments);
      }).catch((error) => {
        console.warn("image upload pending local only", error.message);
      });
    });
  },

  async ensureCloudImageAttachments(attachments) {
    const list = (attachments || []).map(normalizeAttachment);
    if (!wx.cloud || !wx.cloud.uploadFile) return list;
    const next = [];
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const value = String(item.value || "");
      const localPath = item.localPath || item.path || (!value.startsWith("cloud://") ? value : "");
      if (!isImageAttachment(item) || item.fileID || value.startsWith("cloud://") || !localPath) {
        next.push(item);
        continue;
      }
      try {
        const fileID = await this.uploadAttachmentFile(localPath, "images");
        next.push(Object.assign({}, item, {
          value: fileID,
          fileID,
          localPath
        }));
      } catch (error) {
        console.warn("image upload before save failed, keep local fallback", error.message);
        next.push(item);
      }
    }
    return next;
  },

  addAttachments(items, extraUpdates) {
    const attachments = this.data.editingNoteAttachments.concat((items || []).map(normalizeAttachment));
    const view = buildAttachmentView(attachments);
    this.setData(Object.assign({
      editingNoteAttachments: attachments,
      noteDirty: true
    }, view, extraUpdates || {}));
    this.resolveAndSetImageViews(view.imageAttachments);
  },

  async resolveAndSetImageViews(imageAttachments) {
    const resolved = await resolveCloudImageAttachments(imageAttachments);
    if (resolved) this.setData(resolved);
  },

  async resolvePreviewImageUrls(urls) {
    const list = (urls || []).filter(Boolean);
    const cloudUrls = list.filter((url) => String(url).indexOf("cloud://") === 0);
    if (!cloudUrls.length || !wx.cloud || !wx.cloud.getTempFileURL) return list;
    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: cloudUrls.map((fileID) => ({ fileID }))
      });
      const tempMap = {};
      (res.fileList || []).forEach((item) => {
        if (item.fileID && item.tempFileURL) tempMap[item.fileID] = item.tempFileURL;
      });
      return list.map((url) => tempMap[url] || url);
    } catch (error) {
      console.warn("resolve preview image urls failed", error);
      return list;
    }
  },

  async previewAttachmentImage(e) {
    const src = e.currentTarget.dataset.src || "";
    const index = Number(e.currentTarget.dataset.index || 0);
    const rawUrls = this.data.previewImageUrls || [];
    const urls = await this.resolvePreviewImageUrls(rawUrls);
    if (!urls.length) return;
    const rawIndex = rawUrls.indexOf(src);
    const current = rawIndex >= 0 ? urls[rawIndex] : (urls[index] || urls[0]);
    wx.previewImage({
      current,
      urls
    });
  },

  previewAttachment(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.editingNoteAttachments.find((attachment) => attachment.id === id);
    if (!item) return;
    if (item.type === "audio") this.playAudio(item);
  },

  playAudio(item) {
    if (!item.value || !wx.createInnerAudioContext) return;
    if (this.audioContext) {
      this.audioContext.stop();
      this.audioContext.destroy();
      this.audioContext = null;
      if (this.data.playingAudioId === item.id) {
        this.setData({ playingAudioId: "" });
        return;
      }
    }
    const audio = wx.createInnerAudioContext();
    audio.src = item.value;
    audio.onEnded(() => this.setData({ playingAudioId: "" }));
    audio.onError(() => {
      this.setData({ playingAudioId: "" });
      wx.showToast({ title: "录音播放失败", icon: "none" });
    });
    this.audioContext = audio;
    this.setData({ playingAudioId: item.id });
    audio.play();
  },

  confirmRemoveAttachment(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.editingNoteAttachments.find((attachment) => attachment.id === id);
    if (!item) return;
    wx.showModal({
      title: "删除附件",
      content: `是否删除“${item.title || "附件"}”？`,
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (res.confirm) this.removeAttachmentById(id);
      }
    });
  },

  removeAttachment(e) {
    this.removeAttachmentById(e.currentTarget.dataset.id);
  },

  removeAttachmentById(id) {
    const attachments = this.data.editingNoteAttachments.filter((item) => item.id !== id);
    const view = buildAttachmentView(attachments);
    this.setData(Object.assign({
      editingNoteAttachments: attachments,
      noteDirty: true
    }, view));
    this.resolveAndSetImageViews(view.imageAttachments);
    wx.showToast({ title: "已移除附件", icon: "success" });
  },

  cancelEdit() {
    if (!this.data.noteDirty) {
      this.leavePage();
      return;
    }
    wx.showModal({
      title: "取消编辑",
      content: "本次修改尚未保存，是否放弃？",
      confirmText: "放弃",
      cancelText: "继续编辑",
      confirmColor: "#ef4444",
      success: (res) => {
        if (res.confirm) this.leavePage();
      }
    });
  },

  saveDraftAndExit() {
    if (this.data.pageMode !== "write") return;
    this.persistNote("draft", "已保存");
  },

  finishEdit() {
    this.persistNote("done", "已完成");
  },

  async persistNote(status, toastTitle) {
    const content = this.data.editingNoteContent;
    const attachments = await this.ensureCloudImageAttachments(this.data.editingNoteAttachments || []);
    if (!content.trim() && !attachments.length) {
      wx.showToast({ title: "请写下内容", icon: "none" });
      return;
    }
    const safeAttachments = attachments.map(cloudSafeAttachment);
    const patch = {
      date: this.data.editingNoteDate,
      content,
      attachments: safeAttachments,
      status
    };
    const note = this.data.editingNoteId
      ? updateBoundlessNote(this.data.editingNoteId, patch)
      : createBoundlessNote(this.data.editingNoteDate, patch);
    if (!note) {
      wx.showToast({ title: "保存失败", icon: "none" });
      return;
    }
    if (status !== "draft") {
      api.note.create({
        id: note.cloudId || "",
        clientId: note.id,
        date: note.date,
        type: "boundless",
        content: note.content,
        attachments: safeAttachments,
        assets: safeAttachments
      }).then((res) => {
        const cloudId = res && res.data && res.data.id;
        if (cloudId) updateBoundlessNote(note.id, { cloudId });
      }).catch((error) => {
        console.warn("note save pending local only", error.message);
      });
    }
    const view = buildAttachmentView(attachments);
    this.setData({
      editingNoteId: note.id,
      noteSavedContent: note.content || "",
      noteSavedAttachments: safeAttachments,
      editingNoteAttachments: safeAttachments,
      noteDirty: false
    }, () => this.resolveAndSetImageViews(view.imageAttachments));
    wx.showToast({ title: toastTitle, icon: "success" });
    setTimeout(() => this.leavePage(true), 320);
  },

  deleteCurrentNote() {
    if (this.data.pageMode !== "edit") return;
    const id = this.data.editingNoteId;
    if (!id) {
      wx.showToast({ title: "未找到无边记", icon: "none" });
      return;
    }
    const note = getBoundlessNoteById(id) || findLegacyNote(id);
    if (!note) {
      wx.showToast({ title: "未找到无边记", icon: "none" });
      return;
    }
    wx.showModal({
      title: "删除无边记",
      content: "删除后该无边记将不再显示。",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        if (getBoundlessNoteById(id)) {
          deleteBoundlessNote(id);
        } else {
          removeItem(KEYS.diaries, id);
        }
        api.note.delete(note.cloudId || note._id || id, { clientId: id }).catch(() => {});
        wx.showToast({ title: "已删除", icon: "success" });
        setTimeout(() => this.leavePage(true), 320);
      }
    });
  },

  leavePage(shouldRefresh) {
    if (shouldRefresh) refreshPreviousPage();
    const pages = getCurrentPages ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/pages/home/home" });
    }
  }
});
