const { listBoundlessNoteGroups, getBoundlessNoteById, deleteBoundlessNote, mergeBoundlessNotesToStorage } = require("../../utils/storage");
const { api } = require("../../utils/cloud");

function previewText(item) {
  const value = item.content || item.text || item.note || "";
  return value.trim() || "空白无边记";
}

Page({
  data: {
    groups: [],
    touchStartX: 0,
    touchStartY: 0
  },

  onLoad() {
    this.refreshNotes();
  },

  onShow() {
    this.refreshNotes();
  },

  loadNotes() {
    const groups = listBoundlessNoteGroups().map((group) => ({
      date: group.date,
      items: group.items.map((item) => ({
        id: item.id,
        cloudId: item.cloudId || item._id || "",
        date: item.date,
        preview: previewText(item),
        attachmentCount: (item.attachments || []).length,
        updatedAt: `${item.updatedAt || item.createdAt || ""}`.slice(11, 16)
      }))
    }));
    this.setData({ groups });
  },

  refreshCloudNotes() {
    api.note.list({ limit: 100 }).then((res) => {
      const notes = (res && res.data && res.data.notes) || [];
      if (!notes.length) return;
      mergeBoundlessNotesToStorage(notes);
      this.loadNotes();
    }).catch((error) => {
      console.warn("note cloud list fallback to local", error.message);
    });
  },

  refreshNotes() {
    this.loadNotes();
    this.refreshCloudNotes();
  },

  createNote() {
    wx.navigateTo({ url: "/pages/boundlessNote/boundlessNote" });
  },

  editNote(e) {
    if (this.skipNextNoteTap) {
      this.skipNextNoteTap = false;
      return;
    }
    const id = e.currentTarget.dataset.id;
    const date = e.currentTarget.dataset.date || "";
    if (!id) return;
    const note = getBoundlessNoteById(id);
    const targetDate = (note && note.date) || date;
    wx.navigateTo({ url: `/pages/boundlessNote/boundlessNote?id=${id}&date=${targetDate}` });
  },

  onNoteTouchStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    this.setData({
      touchStartX: touch.clientX,
      touchStartY: touch.clientY
    });
  },

  onNoteTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - this.data.touchStartX;
    const deltaY = touch.clientY - this.data.touchStartY;
    if (deltaX < -60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.8) {
      this.skipNextNoteTap = true;
      this.confirmDeleteNote(e);
    }
  },

  confirmDeleteNote(e) {
    const id = e.currentTarget.dataset.id;
    const cloudId = e.currentTarget.dataset.cloudId || "";
    if (!id) return;
    wx.showModal({
      title: "删除无边记",
      content: "删除后该无边记将无法恢复，是否继续？",
      confirmText: "删除",
      cancelText: "取消",
      confirmColor: "#ef4444",
      success: (res) => {
        if (!res.confirm) return;
        this.deleteNote(id, cloudId);
      }
    });
  },

  deleteNote(id, cloudId) {
    try {
      deleteBoundlessNote(id);
      api.note.delete(cloudId || id, { clientId: id }).catch((error) => {
        console.warn("note delete pending local only", error.message);
      });
      this.loadNotes();
      wx.showToast({ title: "已删除", icon: "success" });
    } catch (error) {
      console.warn("delete note failed", error);
      wx.showToast({ title: "删除失败，请稍后重试", icon: "none" });
    }
  }
});
