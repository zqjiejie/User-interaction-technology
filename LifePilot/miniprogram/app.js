const { api } = require("./utils/cloud");

const LOGIN_STATUS_KEY = "lifepilot_login_status";
const CLOUD_ENV = "cloud1-d0gqsqpco88878b2f";

App({
  globalData: {
    user: {
      openid: "",
      userId: "",
      nickname: "",
      avatarUrl: "",
      school: "",
      major: "",
      grade: "",
      studyGoal: null,
      sportGoal: null,
      sleepGoal: null,
      entertainmentLimit: null,
      profileCompleted: false
    },
    isLoggedIn: false,
    isNewUser: false
  },

  onLaunch() {
    const loginStatus = wx.getStorageSync(LOGIN_STATUS_KEY);
    const isLoggedIn = !!(loginStatus && loginStatus.openid);
    this.globalData.isLoggedIn = isLoggedIn;

    if (!wx.cloud) return;
    wx.cloud.init({ env: CLOUD_ENV, traceUser: true });

    if (!isLoggedIn) {
      setTimeout(() => {
        wx.reLaunch({ url: "/pages/login/login" });
      }, 300);
      return;
    }

    api.user.init().catch((error) => {
      console.warn("cloud init skipped", error.message);
    });

    api.user.login().then((result) => {
      if (result.data && result.data.user) {
        this.syncUserData(result.data.user, result.data.isNewUser);
      }
    }).catch((error) => {
      console.warn("user sync skipped", error.message);
    });
  },

  syncUserData(cloudUser, isNewUser) {
    const user = this.globalData.user;
    Object.assign(user, {
      openid: cloudUser.openid || user.openid,
      userId: cloudUser.userId || cloudUser.openid || user.userId,
      nickname: cloudUser.nickName || cloudUser.nickname || user.nickname || "",
      avatarUrl: cloudUser.avatarUrl || user.avatarUrl,
      school: cloudUser.school !== undefined ? cloudUser.school : user.school,
      major: cloudUser.major !== undefined ? cloudUser.major : user.major,
      grade: cloudUser.grade !== undefined ? cloudUser.grade : user.grade,
      studyGoal: cloudUser.studyGoal !== undefined ? cloudUser.studyGoal : user.studyGoal,
      sportGoal: cloudUser.sportGoal !== undefined ? cloudUser.sportGoal : user.sportGoal,
      sleepGoal: cloudUser.sleepGoal !== undefined ? cloudUser.sleepGoal : user.sleepGoal,
      entertainmentLimit: cloudUser.entertainmentLimit !== undefined ? cloudUser.entertainmentLimit : user.entertainmentLimit,
      profileCompleted: cloudUser.profileCompleted === true
    });
    this.globalData.isLoggedIn = true;
    if (isNewUser !== undefined) {
      this.globalData.isNewUser = !!isNewUser;
    }
  }
});
