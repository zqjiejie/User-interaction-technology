function getSafeAreaLayout() {
  const fallback = {
    statusBarHeight: 24,
    navBarHeight: 88,
    menuRight: 12,
    menuWidth: 0,
    contentTop: 112,
    topBarStyle: "padding-top:24px;min-height:88px;",
    leftActionStyle: "top:34px;",
    rightActionStyle: "right:12px;top:34px;"
  };

  try {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    const statusBarHeight = windowInfo.statusBarHeight || fallback.statusBarHeight;
    if (!menu || !menu.top || !menu.right) {
      const top = statusBarHeight + 10;
      return Object.assign({}, fallback, {
        statusBarHeight,
        contentTop: statusBarHeight + 88,
        topBarStyle: `padding-top:${statusBarHeight}px;min-height:${statusBarHeight + 56}px;`,
        leftActionStyle: `top:${top}px;`,
        rightActionStyle: `right:12px;top:${top}px;`
      });
    }

    const actionSize = 44;
    const navBarHeight = menu.bottom + 12;
    const actionTop = menu.top + (menu.height - actionSize) / 2;
    const menuRight = Math.max(12, (windowInfo.windowWidth || 375) - menu.right + 12);
    return {
      statusBarHeight,
      navBarHeight,
      menuRight,
      menuWidth: menu.width || 0,
      contentTop: navBarHeight,
      topBarStyle: `padding-top:${menu.top}px;min-height:${navBarHeight}px;`,
      leftActionStyle: `top:${actionTop}px;`,
      rightActionStyle: `right:${menuRight + (menu.width || 0) + 8}px;top:${actionTop}px;`
    };
  } catch (error) {
    return fallback;
  }
}

module.exports = {
  getSafeAreaLayout
};
