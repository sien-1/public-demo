// ====== 数据与状态 ======
const STORAGE_KEY = "tomato-custom-goal-v1";

// 正常模式：专注 25 分钟、休息 5 分钟
// 测试模式：网址后加 ?test=1 时变成专注 10 秒、休息 5 秒，方便验证流程
const TEST_MODE = new URLSearchParams(location.search).get("test") === "1";
const FOCUS_SECONDS = TEST_MODE ? 10 : 25 * 60;
const BREAK_SECONDS = TEST_MODE ? 5 : 5 * 60;

let state = loadState();
if (typeof state.continuous !== "boolean") state.continuous = true;
let timerId = null;
let phase = "focus"; // focus = 专注，break = 休息
let secondsLeft = FOCUS_SECONDS;

// 读取本地存档；没有存档时给默认值
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch (error) {
    // 存档坏了就当没有
  }
  return {
    pomodoros: 0,
    goal: null,          // { reward, target, unit, progress }
    history: [],         // 已完成的目标
    tasks: [],           // { text, done }
    continuous: true     // 是否自动进入休息并开始下一轮
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ====== 倒计时 ======
const timerDisplay = document.getElementById("timer-display");
const startBtn = document.getElementById("timer-start");
const pauseBtn = document.getElementById("timer-pause");
const resetBtn = document.getElementById("timer-reset");
const phaseLabel = document.getElementById("phase-label");
const continuousCheckbox = document.getElementById("continuous-mode");
const skipBreakBtn = document.getElementById("skip-break");

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

function renderTimer() {
  timerDisplay.textContent = formatTime(secondsLeft);
}

function renderPhase() {
  phaseLabel.textContent = phase === "focus" ? "专注中" : "休息中";
  skipBreakBtn.classList.toggle("hidden", phase !== "break");
}

function tick() {
  secondsLeft -= 1;
  renderTimer();
  if (secondsLeft <= 0) {
    if (phase === "focus") {
      completePomodoro();
    } else {
      completeBreak();
    }
  }
}

function startTimer() {
  if (timerId !== null || secondsLeft <= 0) return;
  timerId = setInterval(tick, 1000);
  startBtn.disabled = true;
}

function pauseTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
    startBtn.disabled = false;
  }
}

function resetTimer() {
  pauseTimer();
  secondsLeft = phase === "focus" ? FOCUS_SECONDS : BREAK_SECONDS;
  renderTimer();
}

function completePomodoro() {
  pauseTimer();

  state.pomodoros += 1;

  let finishedGoalReward = null;
  // 如果当前目标是“番茄数”，自动累计
  if (state.goal && state.goal.unit === "pomodoro") {
    finishedGoalReward = state.goal.reward;
    const finished = addGoalProgress(1);
    if (finished) {
      showOverlay("🎉 目标达成！", "奖励「" + finishedGoalReward + "」快去兑现吧！");
    } else {
      showOverlay("✅ 完成一个番茄", "又完成了一个番茄！🍅");
    }
  } else {
    showOverlay("✅ 完成一个番茄", "又完成了一个番茄！🍅");
  }

  saveState();
  renderAll();

  if (state.continuous) {
    startBreak();
  } else {
    phase = "focus";
    secondsLeft = FOCUS_SECONDS;
    renderPhase();
    renderTimer();
  }
}

function startBreak() {
  phase = "break";
  secondsLeft = BREAK_SECONDS;
  renderPhase();
  renderTimer();
  if (state.continuous) startTimer();
}

function completeBreak() {
  pauseTimer();
  phase = "focus";
  secondsLeft = FOCUS_SECONDS;
  renderPhase();
  renderTimer();
  if (state.continuous) startTimer();
}

function skipBreak() {
  pauseTimer();
  phase = "focus";
  secondsLeft = FOCUS_SECONDS;
  renderPhase();
  renderTimer();
  startTimer();
}

// ====== 自定义目标 ======
const goalRewardInput = document.getElementById("goal-reward");
const goalTargetInput = document.getElementById("goal-target");
const goalUnitSelect = document.getElementById("goal-unit");
const goalSetBtn = document.getElementById("goal-set");
const goalCancelBtn = document.getElementById("goal-cancel");
const goalAddCardBtn = document.getElementById("goal-add-card");
const goalActiveBox = document.getElementById("goal-active");

function addGoalProgress(count) {
  if (!state.goal) return false;
  state.goal.progress = Math.min(state.goal.progress + count, state.goal.target);

  if (state.goal.progress >= state.goal.target) {
    state.history.unshift({
      reward: state.goal.reward,
      target: state.goal.target,
      unit: state.goal.unit,
      finishedAt: new Date().toLocaleString()
    });
    state.goal = null;
    return true;
  }
  return false;
}

function renderGoal() {
  const goal = state.goal;
  if (goal) {
    goalActiveBox.classList.remove("hidden");
    document.getElementById("goal-reward-text").textContent = goal.reward;
    const percent = Math.round((goal.progress / goal.target) * 100);
    document.getElementById("goal-progress-fill").style.width = percent + "%";
    const unitName = goal.unit === "pomodoro" ? "个番茄" : "张学习卡";
    document.getElementById("goal-progress-text").textContent =
      "进度：" + goal.progress + " / " + goal.target + " " + unitName;
    goalAddCardBtn.classList.toggle("hidden", goal.unit !== "card");
  } else {
    goalActiveBox.classList.add("hidden");
  }
}

function setGoal() {
  const reward = goalRewardInput.value.trim();
  const target = Number(goalTargetInput.value);
  if (reward === "") {
    alert("先写一个想要的奖励吧！");
    return;
  }
  if (!Number.isInteger(target) || target < 1) {
    alert("目标数量要填大于 0 的整数。");
    return;
  }

  state.goal = {
    reward: reward,
    target: target,
    unit: goalUnitSelect.value,
    progress: 0
  };
  goalRewardInput.value = "";
  goalTargetInput.value = 4;
  saveState();
  renderGoal();
}

function cancelGoal() {
  if (!state.goal) return;
  if (window.confirm("确定放弃当前目标吗？进度会清零。")) {
    state.goal = null;
    saveState();
    renderGoal();
  }
}

// ====== 已完成目标历史 ======
function renderHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";
  if (state.history.length === 0) {
    const li = document.createElement("li");
    li.textContent = "还没有完成过目标，设一个吧！";
    li.style.border = "none";
    list.appendChild(li);
    return;
  }

  state.history.forEach(item => {
    const li = document.createElement("li");
    const unitName = item.unit === "pomodoro" ? "个番茄" : "张学习卡";
    li.innerHTML =
      `<span>🎁 ${escapeHtml(item.reward)}（${item.target} ${unitName}）</span>` +
      `<small class="hint">${escapeHtml(item.finishedAt)}</small>`;
    list.appendChild(li);
  });
}

// ====== 今日任务 ======
const taskInput = document.getElementById("task-input");
const taskAddBtn = document.getElementById("task-add-btn");
const taskList = document.getElementById("task-list");

function addTask() {
  const text = taskInput.value.trim();
  if (text === "") return;
  state.tasks.push({ text: text, done: false });
  taskInput.value = "";
  saveState();
  renderTasks();
}

function toggleTask(index) {
  state.tasks[index].done = !state.tasks[index].done;
  saveState();
  renderTasks();
}

function removeTask(index) {
  state.tasks.splice(index, 1);
  saveState();
  renderTasks();
}

function renderTasks() {
  taskList.innerHTML = "";
  state.tasks.forEach((task, index) => {
    const li = document.createElement("li");
    if (task.done) li.classList.add("done");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => toggleTask(index));

    const span = document.createElement("span");
    span.textContent = task.text;

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.addEventListener("click", () => removeTask(index));

    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(del);
    taskList.appendChild(li);
  });
}

// ====== 弹窗与工具 ======
function showOverlay(title, message) {
  document.getElementById("overlay-title").textContent = title;
  document.getElementById("overlay-message").textContent = message;
  document.getElementById("overlay").classList.remove("hidden");
}

function closeOverlay() {
  document.getElementById("overlay").classList.add("hidden");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderAll() {
  document.getElementById("pomodoro-count").textContent = state.pomodoros;
  continuousCheckbox.checked = state.continuous;
  renderPhase();
  renderTimer();
  renderGoal();
  renderHistory();
  renderTasks();
}

// ====== 事件绑定 ======
startBtn.addEventListener("click", startTimer);
pauseBtn.addEventListener("click", pauseTimer);
resetBtn.addEventListener("click", resetTimer);
skipBreakBtn.addEventListener("click", skipBreak);
continuousCheckbox.addEventListener("change", () => {
  state.continuous = continuousCheckbox.checked;
  saveState();
});

goalSetBtn.addEventListener("click", setGoal);
goalCancelBtn.addEventListener("click", cancelGoal);
goalAddCardBtn.addEventListener("click", () => {
  const rewardName = state.goal ? state.goal.reward : "";
  const finished = addGoalProgress(1);
  if (finished) {
    showOverlay("🎉 目标达成！", "奖励「" + rewardName + "」快去兑现吧！");
  }
  saveState();
  renderGoal();
});

taskAddBtn.addEventListener("click", addTask);
taskInput.addEventListener("keydown", event => {
  if (event.key === "Enter") addTask();
});

document.getElementById("overlay-close").addEventListener("click", closeOverlay);

renderAll();
