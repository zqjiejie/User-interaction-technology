# 济事楼 4-5 楼导览系统

本项目提供济事楼 4 楼和 5 楼房间、公共开放区域总览、地图导览、快速选择和关键词搜索。

## 在线访问

项目已部署到 GitHub Pages，访问地址：

```text
https://kinosakuraxuan.github.io/map_for_building_JISHI_L4L5/
```

## 数据来源

- 房间与公共区域信息：`room_information.xlsx`
- 房间图片：`room/`
- 公共开放区域图片：`open_area/`
- 楼层地图：`map/map_for_f4.png`、`map/map_for_f5.png`

页面会优先在运行时读取 `room_information.xlsx`。如果网络环境无法加载 Excel 解析库，会自动使用 `js/rooms-data.js` 中由该 Excel 生成的本地备份数据。

## 本地调试

如需在本机调试，在项目根目录运行：

```bash
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

旧地址 `http://localhost:8000/JishiBuilding_Guide/` 会自动跳转到根目录入口。
