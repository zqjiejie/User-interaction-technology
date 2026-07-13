function sum(list, key) {
  return list.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function average(list, key) {
  return list.length ? sum(list, key) / list.length : 0;
}

function formatHours(minutes) {
  return `${(Number(minutes || 0) / 60).toFixed(1)} 小时`;
}

function percent(value, target) {
  if (!target) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

function sportMinutesOf(item) {
  return Number(item.sportMinutes || item.exerciseMinutes || 0);
}

function buildLocalOverview(records, user, music) {
  const list = (records || []).slice(0, 7);
  const studyMinutes = sum(list, "studyMinutes");
  const entertainmentMinutes = sum(list, "entertainmentMinutes");
  const sportMinutes = list.reduce((total, item) => total + sportMinutesOf(item), 0);
  const avgSleep = average(list, "sleepHours");
  const sportCount = list.filter((item) => sportMinutesOf(item) > 0).length;
  const studyGoalMinutes = Number(user.studyGoal || 25) * 60;
  const sportGoal = Number(user.sportGoal || 3);
  const sportGoalMinutes = sportGoal * 30;
  const sleepGoal = Number(user.sleepGoal || 8);
  const entertainmentLimit = Number(user.entertainmentLimit || 600);
  const sleepScore = percent(avgSleep, sleepGoal);
  const studyScore = percent(studyMinutes, studyGoalMinutes);
  const sportScore = percent(sportMinutes, sportGoalMinutes);
  const selfDiscipline = Math.max(0, 100 - Math.round(Math.max(0, entertainmentMinutes - entertainmentLimit) / 6));
  const totalScore = Math.round((studyScore * 0.28) + (sleepScore * 0.28) + (sportScore * 0.22) + (selfDiscipline * 0.22));

  return {
    weekRange: list.length ? `${list[list.length - 1].date} - ${list[0].date}` : "本周",
    totalScore,
    studyMinutes,
    entertainmentMinutes,
    sportMinutes,
    sleepAvg: Number(avgSleep.toFixed(1)),
    summary: list.length ? "本周状态已经可见，继续记录每天的小变化。" : "还没有记录，添加一条记录即可开始。",
    cards: {
      study: {
        title: "学习",
        totalMinutes: studyMinutes,
        value: formatHours(studyMinutes),
        suggestion: studyMinutes ? "保持固定专注时段，用来复习课程。" : "先从一段 25 分钟专注开始。"
      },
      entertainment: {
        title: "娱乐",
        totalMinutes: entertainmentMinutes,
        value: formatHours(entertainmentMinutes),
        suggestion: entertainmentMinutes > entertainmentLimit ? "娱乐已超过目标，建议设置夜间停止时间。" : "娱乐时长仍在目标范围内。"
      },
      sleep: {
        title: "睡眠",
        avgHours: Number(avgSleep.toFixed(1)),
        value: `${avgSleep.toFixed(1)} 小时`,
        score: Math.round(sleepScore),
        suggestion: avgSleep < sleepGoal ? "睡眠低于目标，建议把高强度任务提前。" : "睡眠状态较稳定。"
      },
      sport: {
        title: "运动",
        totalMinutes: sportMinutes,
        count: sportCount,
        targetRate: percent(sportMinutes, sportGoalMinutes),
        value: `${sportCount}/${sportGoal}`,
        suggestion: sportCount < sportGoal ? "可以补一次轻量运动。" : "运动目标进展良好。"
      },
      music: {
        title: "音乐",
        relaxMinutes: Number(music.todayMinutes || 0),
        focusMinutes: Number(music.focusMinutes || 0),
        value: `${music.todayMinutes || 0} 分钟`,
        suggestion: music.advice || "深度学习前可以使用专注音乐。"
      }
    }
  };
}

module.exports = {
  sum,
  average,
  buildLocalOverview
};
