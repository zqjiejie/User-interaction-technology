const { api } = require("../../utils/cloud");

const LOGIN_STATUS_KEY = "lifepilot_login_status";

Page({
  data: {
    loading: false,
    avatarUrl: "",
    nickName: ""
  },

  onLoad() {
    const loginStatus = wx.getStorageSync(LOGIN_STATUS_KEY);
    if (loginStatus && loginStatus.openid) {
      wx.switchTab({ url: loginStatus.profileCompleted === false ? "/pages/mine/mine" : "/pages/home/home" });
    }
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl;
    if (avatarUrl) {
      this.setData({ avatarUrl });
    }
  },

  onNicknameInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  onNicknameBlur(e) {
    this.setData({ nickName: e.detail.value });
  },

  async handleLogin() {
    if (this.data.loading) return;

    this.setData({ loading: true });

    try {
      const result = await api.user.login({
        avatarUrl: this.data.avatarUrl,
        nickName: this.data.nickName
      });

      if (result.code !== 0 || !result.data || !result.data.user) {
        throw new Error(result.message || "登录失败");
      }

      const user = result.data.user;
      const isNewUser = !!result.data.isNewUser;
      const profileCompleted = user.profileCompleted === true;

      wx.setStorageSync(LOGIN_STATUS_KEY, {
        openid: user.openid,
        userId: user.userId,
        isNewUser,
        profileCompleted,
        loginTime: Date.now()
      });

      const app = getApp();
      app.syncUserData(user, isNewUser);

      wx.showToast({
        title: isNewUser ? "欢迎使用" : "登录成功",
        icon: "success",
        duration: 1200
      });

      setTimeout(() => {
        wx.switchTab({ url: (!profileCompleted || isNewUser) ? "/pages/mine/mine" : "/pages/home/home" });
      }, 500);
    } catch (error) {
      console.error("login failed", error);
      wx.showToast({
        title: "登录失败，请稍后重试",
        icon: "none",
        duration: 2000
      });
    } finally {
      this.setData({ loading: false });
    }
  }
});
