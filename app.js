const USERS = ["Дима", "Илья", "Саша", "Саша GMC", "Паша", "Андрей"];

const TEAMS = [
  { name: "Канада", tier: 2 },
  { name: "Бразилия", tier: 1 },
  { name: "Парагвай", tier: 2 },
  { name: "Марокко", tier: 2 },
  { name: "Норвегия", tier: 2 },
  { name: "Франция", tier: 1 },
  { name: "Мексика", tier: 2 },
  { name: "Англия", tier: 1 },
  { name: "Бельгия", tier: 1 },
  { name: "США", tier: 2 },
  { name: "Испания", tier: 1 },
  { name: "Португалия", tier: 1 },
  { name: "Швейцария", tier: 2 },
];

const WIN_SCORE = 5;
const MAX_ATTEMPTS = 3;
const ATTEMPT_SECONDS = 5.5;
const STORAGE_KEY = "draft-kick-state-v3";
const PICKS_API_URL = "https://script.google.com/macros/s/AKfycbwOHGgV7KQnqzGkGhnGEUAFgT0gGQ5kI5MHz_vlppkpghWen_7BGy8-Y3Xzjj2lapqg/exec";

const POWER_LEVELS = [
  { min: 0, name: "Удар уставшего защитника", tone: "Нога еще не проснулась." },
  { min: 2, name: "Дворовый бомбардир", tone: "Уже похоже на футбол." },
  { min: 4, name: "Хороший форвард", tone: "Мяч летит плотно." },
  { min: 5, name: "Erling Haaland mode", tone: "Tier 1 открыт." },
  { min: 10, name: "Roberto Carlos", tone: "Пушка с левой. Это топ." },
];

const app = document.querySelector("#app");

let state = loadState();
let game = createGameState();
let timerId = null;
let syncState = {
  loading: false,
  saving: false,
  error: "",
};

function createGameState() {
  return {
    screen: state.currentUser ? "game" : "login",
    attempts: [],
    active: false,
    clicks: 0,
    timeLeft: ATTEMPT_SECONDS,
    message: "",
    lastLevel: null,
  };
}

function loadState() {
  const fallback = {
    currentUser: "",
    users: createEmptyUsers(),
  };

  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== "object") return fallback;

    return {
      currentUser: USERS.includes(parsed.currentUser) ? parsed.currentUser : "",
      users: Object.fromEntries(
        USERS.map((name) => [
          name,
          {
            bestScore: Number.isFinite(parsed.users?.[name]?.bestScore)
              ? parsed.users[name].bestScore
              : null,
            team: TEAMS.some((team) => team.name === parsed.users?.[name]?.team)
              ? parsed.users[name].team
              : "",
            tierOverride: Boolean(parsed.users?.[name]?.tierOverride),
          },
        ]),
      ),
    };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createEmptyUsers() {
  return Object.fromEntries(
    USERS.map((name) => [name, { bestScore: null, team: "", tierOverride: false }]),
  );
}

function isRemotePicksEnabled() {
  return PICKS_API_URL.startsWith("https://");
}

async function loadRemotePicks() {
  if (!isRemotePicksEnabled()) return;

  syncState.loading = true;
  syncState.error = "";
  render();

  try {
    const response = await fetch(`${PICKS_API_URL}?t=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    mergeRemotePicks(data);
    saveState();
  } catch (error) {
    syncState.error = "Не удалось загрузить выборы из Google Sheet.";
  } finally {
    syncState.loading = false;
    render();
  }
}

function mergeRemotePicks(data) {
  const remoteUsers = data?.users;
  if (!remoteUsers || typeof remoteUsers !== "object") return;

  USERS.forEach((user) => {
    const remoteProfile = remoteUsers[user];
    if (!remoteProfile || typeof remoteProfile !== "object") return;

    state.users[user] = {
      ...state.users[user],
      bestScore: Number.isFinite(Number(remoteProfile.bestScore))
        ? Number(remoteProfile.bestScore)
        : state.users[user].bestScore,
      team: TEAMS.some((team) => team.name === remoteProfile.team)
        ? remoteProfile.team
        : state.users[user].team,
      tierOverride:
        remoteProfile.tierOverride === true ||
        remoteProfile.tierOverride === "true" ||
        state.users[user].tierOverride,
    };
  });
}

async function saveRemotePick(user, profile) {
  if (!isRemotePicksEnabled()) return true;

  syncState.saving = true;
  syncState.error = "";
  render();

  try {
    const payload = new URLSearchParams({
      user,
      team: profile.team,
      bestScore: String(profile.bestScore ?? ""),
      tierOverride: String(Boolean(profile.tierOverride)),
    });

    const response = await fetch(PICKS_API_URL, {
      method: "POST",
      body: payload,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data?.ok === false) throw new Error(data.error || "Save failed");
    mergeRemotePicks(data);
    saveState();
    return true;
  } catch (error) {
    syncState.error = "Не удалось сохранить выбор в Google Sheet.";
    return false;
  } finally {
    syncState.saving = false;
    render();
  }
}

async function resetRemotePicks() {
  if (!isRemotePicksEnabled()) return true;

  syncState.saving = true;
  syncState.error = "";
  render();

  try {
    const payload = new URLSearchParams({ action: "reset" });
    const response = await fetch(PICKS_API_URL, {
      method: "POST",
      body: payload,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data?.ok === false) throw new Error(data.error || "Reset failed");
    mergeRemotePicks(data);
    saveState();
    return true;
  } catch (error) {
    syncState.error = "Не удалось сбросить выборы в Google Sheet.";
    return false;
  } finally {
    syncState.saving = false;
    render();
  }
}

function currentProfile() {
  return state.users[state.currentUser];
}

function bestAttempt() {
  return game.attempts.length
    ? Math.max(...game.attempts.map((attempt) => attempt.score))
    : null;
}

function selectedTeams() {
  return Object.entries(state.users)
    .filter(([, profile]) => profile.team)
    .map(([user, profile]) => ({ user, team: profile.team }));
}

function isTeamTaken(teamName) {
  return selectedTeams().find(
    (entry) => entry.team === teamName && entry.user !== state.currentUser,
  );
}

function availableTier() {
  const profile = currentProfile();
  const currentBest = bestAttempt();
  const score = currentBest ?? 0;
  return profile.tierOverride || score >= WIN_SCORE ? 1 : 2;
}

function getPowerLevel(score) {
  return POWER_LEVELS.reduce((best, level) => {
    return score >= level.min ? level : best;
  }, POWER_LEVELS[0]);
}

function calculateScore(clicks) {
  return clicks;
}

function clearAttemptTimer() {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function render() {
  clearAttemptTimer();

  if (game.screen === "login") {
    renderLogin();
    return;
  }

  if (game.screen === "pick") {
    renderPick();
    return;
  }

  if (game.screen === "board") {
    renderBoard();
    return;
  }

  renderGame();
}

function renderLogin() {
  app.innerHTML = `
    <section class="login-layout">
      <div class="hero">
        <div class="hero-copy">
          <p class="eyebrow">World Cup 26 Draft</p>
          <h1>4Taps World cup</h1>
          <p class="muted">За 3 попытки выбей лучший удар. 5+ очков открывают все команды, меньше 5 - только Tier 2.</p>
        </div>
      </div>
      <form class="panel login-panel" data-login-form>
        <div>
        </div>
        <div class="field">
          <select id="user" name="user" required>
            <option value="">Выбери игрока</option>
            ${USERS.map((user) => {
              const team = state.users[user].team;
              return `<option value="${user}">${user}${team ? ` - ${team}` : ""}</option>`;
            }).join("")}
          </select>
        </div>
        <button class="primary" type="submit">Играть</button>
      </form>
    </section>
  `;

  app.querySelector("[data-login-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const user = new FormData(event.currentTarget).get("user");
    if (!USERS.includes(user)) return;
    state.currentUser = user;
    saveState();
    game = createGameState();
    render();
  });

  const resetButton = app.querySelector("[data-reset]");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      game = createGameState();
      render();
    });
  }
}

function renderTopbar() {
  const profile = currentProfile();
  return `
    <header class="topbar">
      <div class="brand">
        <button class="brand-ball-button" type="button" data-reset-picks aria-label="Сбросить выборы">
          <img class="brand-ball" src="./assets/world-cup-ball.png" alt="" />
        </button>
        <div>
          <h3>4Taps World cup</h3>
          <p class="muted">${state.currentUser}${profile.team ? ` выбрал: ${profile.team}` : ""}</p>
        </div>
      </div>
      <div class="row">
        ${syncState.loading ? `<span class="pill">Загрузка выборов...</span>` : ""}
        ${syncState.saving ? `<span class="pill">Сохранение...</span>` : ""}
        <span class="pill">Порог: ${WIN_SCORE}</span>
        <button class="ghost" type="button" data-board>Выборы</button>
      </div>
    </header>
    ${syncState.error ? `<div class="sync-error">${syncState.error}</div>` : ""}
  `;
}

function renderGame() {
  const profile = currentProfile();
  const best = bestAttempt();
  const displayBest = Math.max(profile.bestScore ?? 0, best ?? 0);
  const currentRunBest = best ?? 0;
  const hasTierAccess = profile.tierOverride || currentRunBest >= WIN_SCORE;
  const finished = game.attempts.length >= MAX_ATTEMPTS;
  const attemptsLeft = MAX_ATTEMPTS - game.attempts.length;
  const liveScore = calculateScore(game.clicks);

  app.innerHTML = `
    <section class="shell">
      ${renderTopbar()}
      <div class="game-grid">
        <div class="game-area ${game.active ? "is-active" : ""}" data-game-area>
          <div class="wc-mark">
            <span>26</span>
            <strong>WORLD CUP</strong>
          </div>
          <div class="keeper-card">
            <img src="./assets/keeper.jpeg" alt="" />
          </div>
          <button class="click-ball" data-ball ${!game.active ? "disabled" : ""} aria-label="Кликнуть по мячу">
            <img src="./assets/world-cup-ball.png" alt="" />
          </button>
          <div class="click-hud">
            <div>
              <span class="hud-label">Время</span>
              <strong>${game.timeLeft.toFixed(1)}s</strong>
            </div>
            <div>
              <span class="hud-label">Клики</span>
              <strong>${game.clicks}</strong>
            </div>
            <div>
              <span class="hud-label">Live score</span>
              <strong>${liveScore}</strong>
            </div>
          </div>
          <div class="controls">
            <button class="primary" data-start ${game.active || finished ? "disabled" : ""}>
              ${game.attempts.length ? "Следующая попытка" : "Начать попытку"}
            </button>
            ${finished ? `<button class="secondary" data-pick>Выбрать команду</button>` : ""}
          </div>
        </div>

        <aside class="side-stack">
          <div class="score-card accent-card">
            <p class="muted">Лучший удар</p>
            <div class="score-number">${displayBest}</div>
            <p class="${hasTierAccess ? "" : "muted"}">
              ${hasTierAccess ? "Открыт Tier 1 и Tier 2" : "Пока доступен только Tier 2"}
            </p>
          </div>

          <div class="score-card">
            <h3>Попытки</h3>
            <div class="attempts">
              ${Array.from({ length: MAX_ATTEMPTS }, (_, index) => {
                const attempt = game.attempts[index];
                const isBest = attempt && attempt.score === best;
                return `
                  <div class="attempt-row ${isBest ? "best" : ""}">
                    <span>Попытка ${index + 1}</span>
                    <strong>${attempt ? `${attempt.score} · ${attempt.clicks} кликов` : "..."}</strong>
                  </div>
                `;
              }).join("")}
            </div>
            <p class="muted">Осталось попыток: ${attemptsLeft}</p>
            ${game.lastLevel ? `<p><strong>${game.lastLevel.name}</strong><br><span class="muted">${game.lastLevel.tone}</span></p>` : ""}
            ${game.message ? `<p>${game.message}</p>` : ""}
          </div>

          <div class="score-card">
            <h3>Правила</h3>
            <p class="muted">Нажми старт и быстро кликай именно по мячу 5.5 секунды. Засчитываются только попадания по мячу.</p>
          </div>
        </aside>
      </div>
    </section>
  `;

  bindCommonActions();

  const startButton = app.querySelector("[data-start]");
  if (startButton) startButton.addEventListener("click", startAttempt);

  const gameArea = app.querySelector("[data-game-area]");
  if (gameArea) gameArea.addEventListener("pointerdown", registerKick);

  const pickButton = app.querySelector("[data-pick]");
  if (pickButton) {
    pickButton.addEventListener("click", () => {
      game.screen = "pick";
      render();
    });
  }

  if (game.active) startAttemptTimer();
}

function startAttempt() {
  if (game.active || game.attempts.length >= MAX_ATTEMPTS) return;
  game.active = true;
  game.clicks = 0;
  game.timeLeft = ATTEMPT_SECONDS;
  game.message = "Кликай по мячу как можно быстрее.";
  game.lastLevel = null;
  render();
}

function startAttemptTimer() {
  const startedAt = Date.now();

  timerId = window.setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    game.timeLeft = Math.max(0, ATTEMPT_SECONDS - elapsed);

    const timeNode = app.querySelector("[data-live-time]");
    if (timeNode) timeNode.textContent = `${game.timeLeft.toFixed(1)}s`;

    const hudValues = app.querySelectorAll(".click-hud strong");
    if (hudValues[0]) hudValues[0].textContent = `${game.timeLeft.toFixed(1)}s`;

    if (game.timeLeft <= 0) finishAttempt();
  }, 80);
}

function registerKick(event) {
  if (!game.active) return;

  if (event?.target?.closest(".controls")) return;

  const ball = app.querySelector(".click-ball");
  if (event && ball && !isKickOnBall(event, ball)) return;

  event?.preventDefault();
  game.clicks += 1;

  const liveScore = calculateScore(game.clicks);
  const hudValues = app.querySelectorAll(".click-hud strong");
  if (hudValues[1]) hudValues[1].textContent = String(game.clicks);
  if (hudValues[2]) hudValues[2].textContent = String(liveScore);

  if (ball) {
    ball.classList.remove("hit");
    void ball.offsetWidth;
    ball.classList.add("hit");
  }
}

function isKickOnBall(event, ball) {
  const rect = ball.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const hitRadius = Math.max(rect.width, rect.height) * 0.62;

  return Math.hypot(dx, dy) <= hitRadius;
}

function finishAttempt() {
  clearAttemptTimer();

  const score = calculateScore(game.clicks);
  const level = getPowerLevel(score);
  const profile = currentProfile();

  game.active = false;
  game.timeLeft = 0;
  game.lastLevel = level;
  game.attempts = [...game.attempts, { score, clicks: game.clicks, level: level.name }];
  game.message =
    game.attempts.length >= MAX_ATTEMPTS
      ? "Три попытки сыграны. Можно выбирать команду."
      : "Попытка записана. Запускай следующую.";

  profile.bestScore = Math.max(profile.bestScore ?? 0, score);
  saveState();
  render();
}

function renderPick() {
  const profile = currentProfile();
  const unlockedTier = availableTier();
  const best = bestAttempt() ?? 0;
  const pickedTeam = profile.team;
  const hasOverride = Boolean(profile.tierOverride);

  app.innerHTML = `
    <section class="shell">
      ${renderTopbar()}
      <div class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Team Draft</p>
            <h2>Выбор команды</h2>
            <p class="muted">Лучший результат: ${best}. ${unlockedTier === 1 ? "Можно выбрать любую свободную команду." : "Доступны только свободные команды Tier 2."}</p>
          </div>
          <div class="pick-actions">
            ${!pickedTeam && !hasOverride ? `<button class="loser-button" data-unlock-all>я лох</button>` : ""}
            <button class="ghost" data-back>Назад к игре</button>
          </div>
        </div>

        ${hasOverride && !pickedTeam ? `<div class="notice">Все команды разблокированы кнопкой "я лох".</div>` : ""}
        ${pickedTeam ? `<div class="notice">Ты уже выбрал команду: <strong>${pickedTeam}</strong>. Выбор сохранен.</div>` : ""}

        <div class="teams-grid">
          ${TEAMS.map((team) => {
            const taken = isTeamTaken(team.name);
            const lockedByTier = unlockedTier !== 1 && team.tier === 1;
            const own = pickedTeam === team.name;
            const disabled = Boolean(pickedTeam || taken || lockedByTier);
            const className = disabled ? (lockedByTier ? "locked" : "unavailable") : "available";
            const status = own
              ? "Твой выбор"
              : taken
                ? `Занято: ${taken.user}`
                : lockedByTier
                  ? `Нужно ${WIN_SCORE}+ очков`
                  : "Свободна";

            return `
              <button class="team-card ${className}" data-team="${team.name}" ${disabled ? "disabled" : ""}>
                <span class="tier ${team.tier === 2 ? "tier-2" : ""}">Tier ${team.tier}</span>
                <span class="team-name">${team.name}</span>
                <span class="status">${status}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    </section>
  `;

  bindCommonActions();

  app.querySelector("[data-back]").addEventListener("click", () => {
    game.screen = "game";
    render();
  });

  const unlockAllButton = app.querySelector("[data-unlock-all]");
  if (unlockAllButton) {
    unlockAllButton.addEventListener("click", () => {
      profile.tierOverride = true;
      saveState();
      render();
    });
  }

  app.querySelectorAll("[data-team]").forEach((button) => {
    button.addEventListener("click", async () => {
      const teamName = button.dataset.team;
      const team = TEAMS.find((candidate) => candidate.name === teamName);
      if (!team || profile.team || isTeamTaken(teamName)) return;
      if (availableTier() !== 1 && team.tier === 1) return;

      profile.team = teamName;
      saveState();
      await saveRemotePick(state.currentUser, profile);
      game.screen = "board";
      render();
    });
  });
}

function renderBoard() {
  app.innerHTML = `
    <section class="shell">
      ${renderTopbar()}
      <div class="panel">
        <div class="section-head">
          <div>
            <h2>Победитель получит 1 775 000 Иранских Реалов!</h2>
          </div>
          <button class="primary" data-pick-open>К выбору команды</button>
        </div>

        <div class="draft-table">
          ${USERS.map((user) => {
            const profile = state.users[user];
            const score = profile.bestScore ?? "-";
            return `
              <div class="draft-row ${user === state.currentUser ? "current" : ""}">
                <strong>${user}</strong>
                <span>${profile.team || "Еще не выбрал"}</span>
                <small>${score === "-" ? "без результата" : `${score} очков`}</small>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </section>
  `;

  bindCommonActions();

  app.querySelector("[data-pick-open]").addEventListener("click", () => {
    game.screen = "pick";
    render();
  });
}

function bindCommonActions() {
  const logout = app.querySelector("[data-logout]");
  if (logout) {
    logout.addEventListener("click", () => {
      state.currentUser = "";
      saveState();
      game = createGameState();
      render();
    });
  }

  const board = app.querySelector("[data-board]");
  if (board) {
    board.addEventListener("click", () => {
      game.screen = "board";
      render();
    });
  }

  const resetPicks = app.querySelector("[data-reset-picks]");
  if (resetPicks) {
    resetPicks.addEventListener("click", handleResetPicks);
  }
}

render();
loadRemotePicks();

async function handleResetPicks() {
  const confirmed = window.confirm("Вы точно хотите сбросить все выборы?");
  if (!confirmed) return;

  state.users = createEmptyUsers();
  game = createGameState();
  saveState();
  render();

  const saved = await resetRemotePicks();
  if (saved) {
    state.users = createEmptyUsers();
    saveState();
    render();
  }
}
