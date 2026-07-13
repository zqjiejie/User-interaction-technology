function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatDate(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getWeekdayText(index) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][index];
}

function getTodayLabel() {
  const d = new Date();
  return `${formatDate(d)} ${getWeekdayText(d.getDay())}`;
}

module.exports = {
  formatDate,
  getTodayLabel,
  getWeekdayText
};

