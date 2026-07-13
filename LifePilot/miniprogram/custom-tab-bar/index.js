Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: "/pages/home/home",
        iconPath: "/assets/tabbar/today.png",
        selectedIconPath: "/assets/tabbar/today-selected.png"
      },
      {
        pagePath: "/pages/calendar/calendar",
        iconPath: "/assets/tabbar/calendar.png",
        selectedIconPath: "/assets/tabbar/calendar-selected.png"
      },
      {
        pagePath: "/pages/discover/discover",
        iconPath: "/assets/tabbar/discover.png",
        selectedIconPath: "/assets/tabbar/discover-selected.png"
      },
      {
        pagePath: "/pages/mine/mine",
        iconPath: "/assets/tabbar/mine.png",
        selectedIconPath: "/assets/tabbar/mine-selected.png"
      }
    ]
  },

  methods: {
    switchTab(e) {
      const path = e.currentTarget.dataset.path;
      if (path) {
        wx.switchTab({ url: path });
      }
    }
  }
});
