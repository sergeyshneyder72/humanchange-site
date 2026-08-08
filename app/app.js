/*
 * "Капитал здоровья" — MVP core loop (client-only prototype).
 *
 * No backend in this pass: state lives in localStorage under one browser.
 * Everywhere a real backend/API would eventually be needed (idea fund
 * submission, cross-user vote aggregation, auth), it's marked with
 * "TODO(backend)" so the architecture seam is visible later.
 *
 * Numeric model coefficients (life-expectancy baseline, sleep U-curve,
 * smoking/alcohol/illness adjustments) are approximate, literature-based
 * placeholders for this experimental MVP — see comments at each constant.
 * They are NOT a verified clinical dataset and should be reviewed before
 * any real launch.
 */

/* ---------------------------------------------------------------------
 * Data / constants
 * ------------------------------------------------------------------- */

// Age multiplier for the smoking active factor — TZ section 3.1, linear
// interpolation between the given points, clamped outside [30, 60].
const AGE_MULTIPLIER_POINTS = [
  [30, 1.0],
  [40, 1.2],
  [50, 1.5],
  [60, 1.8],
];

// Approximate remaining-life-expectancy-in-years table, illustrative of
// SSA Period Life Table (US) magnitudes. TODO: replace with a real
// SSA/WHO GHO data source before this number is shown as authoritative.
const LIFE_EXPECTANCY_TABLE = {
  male: { 30: 47.4, 40: 38.1, 50: 29.3, 60: 21.3, 70: 14.3, 80: 8.6 },
  female: { 30: 51.4, 40: 41.6, 50: 32.6, 60: 24.0, 70: 16.4, 80: 9.8 },
};

const KNOWLEDGE_BASE = [
  {
    key: "smoking",
    name: "Курение",
    active: true,
    body: "Каждая выкуренная сигарета в среднем стоит около 20 минут ожидаемой продолжительности жизни; с возрастом цена растёт. Именно поэтому в приложении списание за сигарету увеличивается с возрастом.",
    source: "Источник: UCL, журнал Addiction (2024/2025).",
  },
  {
    key: "sport",
    name: "Физическая активность",
    active: true,
    body: "Около 20 минут умеренной активности добавляют примерно 1 час капитала (модель microlife). Положительный эффект перестаёт расти после 90 минут активности в день — дальше это уже другие цели, не капитал здоровья.",
    source: "Источник: D. Spiegelhalter, BMJ (2012).",
  },
  {
    key: "sleep",
    name: "Сон",
    active: false,
    body: "Наименьший риск смертности связан со сном 7–8 часов в сутки; как более короткий, так и более длинный сон связаны с повышенным риском. У людей с высокой физической нагрузкой оптимальное окно немного смещается в сторону более долгого сна.",
    source: "Источник: метаанализ Cappuccio и соавт., ~1.3–1.5 млн участников.",
  },
  {
    key: "alcohol",
    name: "Алкоголь",
    active: false,
    body: "Риск, связанный с алкоголем, зависит от дозы и растёт с количеством потребляемого этанола в неделю; безопасного уровня, одинакового для всех, не существует.",
    source: "Источник: обзоры WHO и Lancet (Global Burden of Disease, 2018).",
  },
  {
    key: "nutrition",
    name: "Питание",
    active: false,
    body: "Раздел в разработке — появится вместе с добавлением фактора питания в капитал здоровья.",
    source: "Скоро.",
  },
  {
    key: "stress",
    name: "Стресс",
    active: false,
    body: "Раздел в разработке — появится вместе с добавлением фактора стресса в капитал здоровья.",
    source: "Скоро.",
  },
];

const READING_LIST = [
  "UCL — Addiction (2024/2025): цена одной сигареты в минутах ожидаемой продолжительности жизни.",
  "D. Spiegelhalter — BMJ (2012): концепция microlife для оценки риска в повседневных единицах.",
  "Cappuccio F. P. и соавт. — метаанализ продолжительности сна и смертности (~1.3–1.5 млн участников).",
  "WHO Global Health Observatory — таблицы дожития для базового расчёта капитала.",
];

// Team-confirmed upcoming factors (added directly, no voting) vs.
// illustrative example of user-proposed factors going through the Idea
// Fund voting threshold. Vote counts here are EXAMPLE data — real
// aggregation is manual, done by the team (TZ section 10), not live.
const UPCOMING_FACTORS = [
  { name: "Сон", status: "team", note: "в разработке" },
  { name: "Алкоголь", status: "team", note: "в разработке" },
  { name: "Питание", status: "team", note: "в разработке" },
  { name: "Стресс", status: "team", note: "в разработке" },
];

const UPCOMING_VOTED_EXAMPLE = [
  { name: "Качество воздуха дома/на работе", votes: 34, threshold: 100 },
  { name: "Регулярные медосмотры", votes: 61, threshold: 100 },
];

const IDEA_CATEGORIES = [
  "Техническое неудобство",
  "Идея нового фактора",
  "Общая идея",
];

/* ---------------------------------------------------------------------
 * Storage
 * ------------------------------------------------------------------- */

const STORAGE_KEY = "hc_state_v1";

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function defaultState() {
  return {
    onboarding: null, // filled once onboarding completes
    startingCapitalDays: null,
    createdAt: null,
    ledger: {}, // { 'YYYY-MM-DD': { cigarettes, activityMinutes } }
    ideas: [],
    nav: "dashboard",
    ideasTab: "new",
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

/* ---------------------------------------------------------------------
 * Calculation engine
 * ------------------------------------------------------------------- */

function ageMultiplier(age) {
  const pts = AGE_MULTIPLIER_POINTS;
  if (age <= pts[0][0]) return pts[0][1];
  if (age >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, m0] = pts[i];
    const [a1, m1] = pts[i + 1];
    if (age >= a0 && age <= a1) {
      const t = (age - a0) / (a1 - a0);
      return m0 + t * (m1 - m0);
    }
  }
  return 1.0;
}

function interpolateLifeExpectancyYears(gender, age) {
  const table =
    gender === "male" || gender === "female"
      ? LIFE_EXPECTANCY_TABLE[gender]
      : null;
  const source =
    table ||
    // Non-binary / prefer-not-to-say: average of the two tables (MVP simplification).
    Object.fromEntries(
      Object.keys(LIFE_EXPECTANCY_TABLE.male).map((k) => [
        k,
        (LIFE_EXPECTANCY_TABLE.male[k] + LIFE_EXPECTANCY_TABLE.female[k]) / 2,
      ])
    );
  const ages = Object.keys(source)
    .map(Number)
    .sort((a, b) => a - b);
  if (age <= ages[0]) return source[ages[0]];
  if (age >= ages[ages.length - 1]) return source[ages[ages.length - 1]];
  for (let i = 0; i < ages.length - 1; i++) {
    const a0 = ages[i];
    const a1 = ages[i + 1];
    if (age >= a0 && age <= a1) {
      const t = (age - a0) / (a1 - a0);
      return source[a0] + t * (source[a1] - source[a0]);
    }
  }
  return source[ages[ages.length - 1]];
}

function activityLevelFromOnboarding(ob) {
  let minutesPerWeek = 0;
  if (ob.activityUnit === "minutes") minutesPerWeek = Number(ob.activityValue) || 0;
  else if (ob.activityUnit === "workouts") minutesPerWeek = (Number(ob.activityValue) || 0) * 45;
  if (minutesPerWeek < 90) return "low";
  if (minutesPerWeek <= 300) return "moderate";
  return "high";
}

// U-shaped sleep risk curve (TZ section 1): minimum risk at 7-8h, window
// shifts right for higher habitual activity level.
function sleepWindow(activityLevel) {
  if (activityLevel === "high") return [7.5, 9];
  if (activityLevel === "moderate") return [7, 8.5];
  return [7, 8];
}

function sleepAdjustmentPct(sleepHours, activityLevel) {
  if (!sleepHours) return 0;
  const [lo, hi] = sleepWindow(activityLevel);
  if (sleepHours < lo) {
    const pct = -0.12 * ((lo - sleepHours) / lo);
    return Math.max(pct, -0.3);
  }
  if (sleepHours > hi) {
    const pct = -0.3 * ((sleepHours - hi) / hi);
    return Math.max(pct, -0.35);
  }
  return 0;
}

// Baseline smoking-status penalty (separate from the daily per-cigarette
// active factor in section 3.1) — approximate tiers reflecting the
// well-documented ~10-year life expectancy gap for heavy lifelong smokers.
function smokingStatusPct(cigsPerDay) {
  if (!cigsPerDay || cigsPerDay <= 0) return 0;
  if (cigsPerDay <= 10) return -0.05;
  if (cigsPerDay <= 20) return -0.11;
  return -0.18;
}

function alcoholGramsPerWeek(ob) {
  const spirits = Number(ob.alcoholSpirits) || 0;
  const wine = Number(ob.alcoholWine) || 0;
  const beer = Number(ob.alcoholBeer) || 0;
  const density = 0.789; // g/ml ethanol
  return (
    spirits * 0.4 * density +
    wine * 0.12 * density +
    beer * 0.05 * density
  );
}

function alcoholAdjustmentPct(gramsPerWeek) {
  if (gramsPerWeek <= 100) return 0;
  if (gramsPerWeek <= 200) return -0.05;
  if (gramsPerWeek <= 350) return -0.1;
  return -0.18;
}

function illnessAdjustmentPct(ob) {
  return ob.illnessHas ? -0.15 : 0;
}

// One-time starting capital, computed at the end of onboarding (TZ
// section 1-2). Multiplicative combination of independent adjustments
// keeps the result bounded and avoids a single field dominating the
// number.
function computeStartingCapitalDays(ob) {
  const baselineYears = interpolateLifeExpectancyYears(ob.gender, ob.age);
  const baselineDays = baselineYears * 365.25;

  const activityLevel = activityLevelFromOnboarding(ob);
  const sleepPct = sleepAdjustmentPct(Number(ob.sleepHours), activityLevel);
  const smokingPct = smokingStatusPct(Number(ob.cigarettesPerDay));
  const alcoholPct = alcoholAdjustmentPct(alcoholGramsPerWeek(ob));
  const illnessPct = illnessAdjustmentPct(ob);

  const days =
    baselineDays *
    (1 + sleepPct) *
    (1 + smokingPct) *
    (1 + alcoholPct) *
    (1 + illnessPct);

  return Math.round(days);
}

// Daily active-factor delta for the "Портфель здоровья" ledger — TZ
// section 4, exact formula.
function dailyDeltaDays(cigarettesToday, activityMinutesToday, age) {
  const smokingCost = (Number(cigarettesToday) || 0) * 0.014 * ageMultiplier(age);
  const activityGain = Math.min((Number(activityMinutesToday) || 0) / 60 * 3, 4.5) / 24;
  return activityGain - smokingCost;
}

function sortedLedgerDates() {
  return Object.keys(state.ledger).sort();
}

function cumulativeSeries() {
  const dates = sortedLedgerDates();
  let running = 0;
  return dates.map((date) => {
    const entry = state.ledger[date];
    running += entry.deltaDays;
    return { date, value: running, entry };
  });
}

function sevenDayTrend() {
  const series = cumulativeSeries();
  if (series.length === 0) return 0;
  const last = series[series.length - 1].value;
  const idx = series.length - 8; // 7 days back from the last entry
  const prior = idx >= 0 ? series[idx].value : 0;
  return last - prior;
}

/* ---------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------- */

const root = document.getElementById("app");

function render() {
  if (!state.onboarding) {
    renderOnboarding();
  } else {
    renderApp();
  }
}

/* ---- Onboarding ---- */

const ONBOARDING_STEPS = ["basics", "body", "sleep", "smoking", "alcohol", "activity", "illness", "reveal"];

function renderOnboarding() {
  const step = state.onboardingStep || ONBOARDING_STEPS[0];
  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const draft = state.onboardingDraft || {};

  const dots = ONBOARDING_STEPS.slice(0, -1)
    .map((_, i) => `<span class="${i <= stepIndex ? "done" : ""}"></span>`)
    .join("");

  let body = "";
  let revealDays = null;
  if (step === "basics") {
    body = `
      <div class="onboarding-header">
        <h1>Добро пожаловать</h1>
        <p>Сначала — три обязательных вопроса, дальше всё по желанию.</p>
      </div>
      <div class="field">
        <label>Возраст</label>
        <input type="number" min="1" max="120" id="f_age" value="${draft.age ?? ""}">
      </div>
      <div class="field">
        <label>Пол</label>
        <select id="f_gender">
          <option value="">Выбрать...</option>
          <option value="male" ${draft.gender === "male" ? "selected" : ""}>Мужской</option>
          <option value="female" ${draft.gender === "female" ? "selected" : ""}>Женский</option>
          <option value="other" ${draft.gender === "other" ? "selected" : ""}>Другое / не указывать</option>
        </select>
      </div>
      <div class="field">
        <label>Регион (страна/город)</label>
        <input type="text" id="f_region" placeholder="Например: Россия, Москва" value="${draft.region ?? ""}">
      </div>
    `;
  } else if (step === "body") {
    body = `
      <div class="onboarding-header">
        <h1>Тело <span class="optional-badge">необязательно</span></h1>
        <p>Уточняет стартовый расчёт капитала. Можно пропустить.</p>
      </div>
      <div class="field">
        <label>Вес, кг</label>
        <input type="number" id="f_weight" value="${draft.weight ?? ""}">
      </div>
      <div class="field">
        <label>Рост, см</label>
        <input type="number" id="f_height" value="${draft.height ?? ""}">
      </div>
      <div class="field">
        <label>Объём талии, см</label>
        <input type="number" id="f_waist" value="${draft.waist ?? ""}">
      </div>
    `;
  } else if (step === "sleep") {
    body = `
      <div class="onboarding-header">
        <h1>Сон <span class="optional-badge">необязательно</span></h1>
      </div>
      <div class="field">
        <label>Среднее количество часов сна</label>
        <input type="number" step="0.5" id="f_sleepHours" value="${draft.sleepHours ?? ""}">
      </div>
      <div class="field">
        <label>Обычное время отхода ко сну (если есть устойчивый режим)</label>
        <input type="time" id="f_bedtime" value="${draft.bedtime ?? ""}">
      </div>
    `;
  } else if (step === "smoking") {
    body = `
      <div class="onboarding-header">
        <h1>Курение <span class="optional-badge">необязательно</span></h1>
      </div>
      <div class="field">
        <label>Сигарет в день (0, если не курите)</label>
        <input type="number" min="0" id="f_cigarettesPerDay" value="${draft.cigarettesPerDay ?? ""}">
      </div>
      <div class="field">
        <label>Вейп / кальян — используете?</label>
        <div class="radio-row">
          <label><input type="radio" name="f_vape" value="yes" ${draft.vapeHookah === "yes" ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_vape" value="no" ${draft.vapeHookah === "no" ? "checked" : ""}> Нет</label>
        </div>
        <div class="hint">Пока фиксируем только факт использования, без влияния на расчёт.</div>
      </div>
    `;
  } else if (step === "alcohol") {
    body = `
      <div class="onboarding-header">
        <h1>Алкоголь <span class="optional-badge">необязательно</span></h1>
        <p>Объём в мл в неделю, по категориям.</p>
      </div>
      <div class="field">
        <label>Крепкий алкоголь, мл/нед</label>
        <input type="number" min="0" id="f_alcoholSpirits" value="${draft.alcoholSpirits ?? ""}">
      </div>
      <div class="field">
        <label>Вино, мл/нед</label>
        <input type="number" min="0" id="f_alcoholWine" value="${draft.alcoholWine ?? ""}">
      </div>
      <div class="field">
        <label>Пиво и слабоалкогольные коктейли, мл/нед</label>
        <input type="number" min="0" id="f_alcoholBeer" value="${draft.alcoholBeer ?? ""}">
      </div>
    `;
  } else if (step === "activity") {
    body = `
      <div class="onboarding-header">
        <h1>Физическая активность <span class="optional-badge">необязательно</span></h1>
      </div>
      <div class="field">
        <label>Как удобнее указать?</label>
        <div class="radio-row">
          <label><input type="radio" name="f_activityUnit" value="minutes" ${draft.activityUnit !== "workouts" ? "checked" : ""}> Минуты в неделю</label>
          <label><input type="radio" name="f_activityUnit" value="workouts" ${draft.activityUnit === "workouts" ? "checked" : ""}> Тренировок в неделю</label>
        </div>
      </div>
      <div class="field">
        <label id="f_activityValueLabel">Значение</label>
        <input type="number" min="0" id="f_activityValue" value="${draft.activityValue ?? ""}">
      </div>
    `;
  } else if (step === "illness") {
    body = `
      <div class="onboarding-header">
        <h1>Здоровье <span class="optional-badge">необязательно</span></h1>
      </div>
      <div class="field">
        <label>Есть ли серьёзные заболевания?</label>
        <div class="radio-row">
          <label><input type="radio" name="f_illnessHas" value="yes" ${draft.illnessHas === true ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_illnessHas" value="no" ${draft.illnessHas === false ? "checked" : ""}> Нет</label>
        </div>
      </div>
      <div class="field">
        <label>Уточнение (по желанию)</label>
        <input type="text" id="f_illnessDetail" value="${draft.illnessDetail ?? ""}">
        <div class="hint">Этот пункт всегда можно пропустить.</div>
      </div>
    `;
  } else if (step === "reveal") {
    revealDays = computeStartingCapitalDays(draft);
    body = `
      <div class="onboarding-header">
        <h1>Ваш стартовый капитал готов</h1>
      </div>
      <div class="reveal-number">
        <div class="value" id="reveal-value">0</div>
        <div class="label">дней ожидаемого капитала здоровья</div>
      </div>
      <div class="disclaimer">Статистическая оценка на основе научных исследований, не медицинский прогноз для конкретного человека.</div>
      <button class="btn" id="finish-onboarding" style="width:100%">Перейти в приложение</button>
    `;
  }

  root.innerHTML = `
    <div class="wrap">
      <div class="progress-dots">${dots}</div>
      ${body}
      ${
        step !== "reveal"
          ? `<div class="step-nav">
              <button class="btn secondary" id="ob-back" ${stepIndex === 0 ? "disabled" : ""}>Назад</button>
              <button class="btn" id="ob-next">${stepIndex === ONBOARDING_STEPS.length - 2 ? "Рассчитать" : "Далее"}</button>
            </div>`
          : ""
      }
    </div>
  `;

  if (step === "reveal") {
    animateRevealNumber(revealDays);
    document.getElementById("finish-onboarding").addEventListener("click", () => {
      state.onboarding = draft;
      state.startingCapitalDays = revealDays;
      state.createdAt = state.createdAt || todayStr();
      state.onboardingStep = null;
      state.onboardingDraft = null;
      saveState();
      render();
    });
  } else {
    document.getElementById("ob-next").addEventListener("click", () => {
      collectStepFields(step, draft);
      if (step === "basics" && (!draft.age || !draft.gender || !draft.region)) {
        alert("Возраст, пол и регион обязательны для продолжения.");
        return;
      }
      state.onboardingDraft = draft;
      state.onboardingStep = ONBOARDING_STEPS[stepIndex + 1];
      saveState();
      render();
    });
    const backBtn = document.getElementById("ob-back");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        collectStepFields(step, draft);
        state.onboardingDraft = draft;
        state.onboardingStep = ONBOARDING_STEPS[Math.max(0, stepIndex - 1)];
        saveState();
        render();
      });
    }
  }
}

function collectStepFields(step, draft) {
  const val = (id) => document.getElementById(id)?.value;
  if (step === "basics") {
    draft.age = Number(val("f_age")) || null;
    draft.gender = val("f_gender") || null;
    draft.region = val("f_region") || "";
  } else if (step === "body") {
    draft.weight = val("f_weight");
    draft.height = val("f_height");
    draft.waist = val("f_waist");
  } else if (step === "sleep") {
    draft.sleepHours = val("f_sleepHours");
    draft.bedtime = val("f_bedtime");
  } else if (step === "smoking") {
    draft.cigarettesPerDay = val("f_cigarettesPerDay");
    const checked = document.querySelector('input[name="f_vape"]:checked');
    draft.vapeHookah = checked ? checked.value : draft.vapeHookah;
  } else if (step === "alcohol") {
    draft.alcoholSpirits = val("f_alcoholSpirits");
    draft.alcoholWine = val("f_alcoholWine");
    draft.alcoholBeer = val("f_alcoholBeer");
  } else if (step === "activity") {
    const unitChecked = document.querySelector('input[name="f_activityUnit"]:checked');
    draft.activityUnit = unitChecked ? unitChecked.value : "minutes";
    draft.activityValue = val("f_activityValue");
  } else if (step === "illness") {
    const checked = document.querySelector('input[name="f_illnessHas"]:checked');
    draft.illnessHas = checked ? checked.value === "yes" : undefined;
    draft.illnessDetail = val("f_illnessDetail");
  }
}

function animateRevealNumber(target) {
  const el = document.getElementById("reveal-value");
  if (!el) return;
  const duration = 900;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased).toLocaleString("ru-RU");
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---- Main app shell ---- */

function renderApp() {
  const nav = state.nav || "dashboard";
  root.innerHTML = `
    <nav class="app-nav">
      <button data-nav="dashboard" class="${nav === "dashboard" ? "active" : ""}">Портфель</button>
      <button data-nav="knowledge" class="${nav === "knowledge" ? "active" : ""}">База знаний</button>
      <button data-nav="ideas" class="${nav === "ideas" ? "active" : ""}">Фонд идей</button>
    </nav>
    <div class="wrap" id="screen"></div>
  `;
  root.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.nav = btn.dataset.nav;
      saveState();
      render();
    });
  });

  const screen = document.getElementById("screen");
  if (nav === "dashboard") renderDashboard(screen);
  else if (nav === "knowledge") renderKnowledge(screen);
  else if (nav === "ideas") renderIdeas(screen);
}

/* ---- Dashboard ---- */

function renderDashboard(screen) {
  const period = state.chartPeriod || "month";
  const series = cumulativeSeries();
  const trend = sevenDayTrend();
  const capitalValue = series.length ? series[series.length - 1].value : 0;

  const today = todayStr();
  const todayEntry = state.ledger[today] || { cigarettes: "", activityMinutes: "" };

  screen.innerHTML = `
    <div class="capital-header">
      <div class="capital-value ${capitalValue >= 0 ? "positive" : "negative"}">${formatDays(capitalValue)}</div>
      <div class="capital-trend ${trend >= 0 ? "positive" : "negative"}">${trend >= 0 ? "▲" : "▼"} ${formatDays(Math.abs(trend))} за 7 дней</div>
    </div>
    <div class="starting-ref">Стартовый капитал из онбординга: ${state.startingCapitalDays?.toLocaleString("ru-RU")} дней (справочно, не пересчитывается)</div>
    <div class="disclaimer">Статистическая оценка на основе научных исследований, не медицинский прогноз для конкретного человека.</div>

    <div class="period-switch">
      ${["week", "month", "year"]
        .map(
          (p) =>
            `<button data-period="${p}" class="${period === p ? "active" : ""}">${
              p === "week" ? "Неделя" : p === "month" ? "Месяц" : "Год"
            }</button>`
        )
        .join("")}
    </div>

    <div class="chart-card">${renderChartSvg(series, period)}</div>

    <div class="next-step-card">
      <div class="kicker">Следующий шаг</div>
      <div>${nextStepRecommendation(todayEntry)}</div>
    </div>

    <div class="log-card">
      <h3>Отметить сегодня</h3>
      <div class="log-row">
        <div class="field">
          <label>Сигарет сегодня</label>
          <input type="number" min="0" id="log_cigarettes" value="${todayEntry.cigarettes ?? ""}">
        </div>
        <div class="field">
          <label>Минут активности сегодня</label>
          <input type="number" min="0" id="log_activity" value="${todayEntry.activityMinutes ?? ""}">
        </div>
      </div>
      <button class="btn" id="log-save" style="width:100%">Сохранить</button>
    </div>

    <div class="factor-grid">
      <div class="factor-card">
        <div class="name">Курение</div>
        <div class="hint">Активный фактор</div>
      </div>
      <div class="factor-card">
        <div class="name">Спорт</div>
        <div class="hint">Активный фактор</div>
      </div>
      ${["Сон", "Алкоголь", "Питание", "Стресс"]
        .map(
          (n) => `<div class="factor-card disabled">
            <div class="name">${n}</div>
            <div class="soon">скоро</div>
          </div>`
        )
        .join("")}
      <div class="factor-card disabled">
        <div class="name">Экономия на медицине</div>
        <div class="soon">скоро</div>
      </div>
    </div>

    <h3>Последние операции</h3>
    ${renderFeed()}
  `;

  screen.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.chartPeriod = btn.dataset.period;
      saveState();
      renderDashboard(screen);
    });
  });

  document.getElementById("log-save").addEventListener("click", () => {
    const cigarettes = Number(document.getElementById("log_cigarettes").value) || 0;
    const activityMinutes = Number(document.getElementById("log_activity").value) || 0;
    const age = Number(state.onboarding.age);
    const deltaDays = dailyDeltaDays(cigarettes, activityMinutes, age);
    state.ledger[today] = { cigarettes, activityMinutes, deltaDays };
    saveState();
    renderDashboard(screen);
  });
}

function formatDays(value) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)} дн.`;
}

function nextStepRecommendation(todayEntry) {
  const activity = Number(todayEntry.activityMinutes) || 0;
  const cigarettes = Number(todayEntry.cigarettes) || 0;
  if (activity < 30) {
    return "Добавьте 30 минут активности сегодня — это ощутимый плюс к капиталу, а прирост не теряется вплоть до 90 минут.";
  }
  if (cigarettes > 0) {
    return "Попробуйте сегодня выкурить на одну сигарету меньше, чем вчера.";
  }
  return "Хороший день — активность отмечена, курение под контролем. Так держать.";
}

function periodCutoffDate(period) {
  const now = new Date();
  const d = new Date(now);
  if (period === "week") d.setDate(d.getDate() - 7);
  else if (period === "month") d.setDate(d.getDate() - 30);
  else d.setDate(d.getDate() - 365);
  return todayStr(d);
}

function renderChartSvg(series, period) {
  if (series.length === 0) {
    return `<div class="empty-state">Пока нет данных — отметьте первый день ниже.</div>`;
  }
  const cutoff = periodCutoffDate(period);
  const visible = series.filter((p) => p.date >= cutoff);
  const points = visible.length >= 2 ? visible : series.slice(-2).length === 2 ? series.slice(-2) : series;

  const width = 640;
  const height = 200;
  const padding = 12;
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = points.length === 1 ? width / 2 : padding + (i / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((p.value - min) / range) * (height - padding * 2);
    return [x, y];
  });

  const zeroY = height - padding - ((0 - min) / range) * (height - padding * 2);
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <line x1="0" y1="${zeroY.toFixed(1)}" x2="${width}" y2="${zeroY.toFixed(1)}" stroke="#e3e1db" stroke-width="1" />
      <path d="${path}" fill="none" stroke="#1f6f4a" stroke-width="2.5" />
    </svg>
  `;
}

function renderFeed() {
  const dates = sortedLedgerDates().slice(-14).reverse();
  if (dates.length === 0) {
    return `<div class="empty-state">Операций пока нет.</div>`;
  }
  return `<ul class="feed-list">
    ${dates
      .map((date) => {
        const e = state.ledger[date];
        const items = [];
        if (e.cigarettes > 0) {
          const cost = e.cigarettes * 0.014 * ageMultiplier(Number(state.onboarding.age));
          items.push(
            `<li class="feed-item"><span class="badge"><span class="icon smoke">К</span>Курение: ${e.cigarettes} шт.</span><span class="amount negative">−${cost.toFixed(2)} дн.</span></li>`
          );
        }
        if (e.activityMinutes > 0) {
          const gain = Math.min((e.activityMinutes / 60) * 3, 4.5) / 24;
          items.push(
            `<li class="feed-item"><span class="badge"><span class="icon sport">С</span>Активность: ${e.activityMinutes} мин.</span><span class="amount positive">+${gain.toFixed(2)} дн.</span></li>`
          );
        }
        return items.join("");
      })
      .join("")}
  </ul>`;
}

/* ---- Knowledge base ---- */

function renderKnowledge(screen) {
  screen.innerHTML = `
    <h2>База знаний</h2>
    ${KNOWLEDGE_BASE.map(
      (item) => `
      <div class="kb-card ${item.active ? "" : "disabled"}">
        <div class="name">${item.name}${item.active ? "" : ' <span class="optional-badge">скоро</span>'}</div>
        <div>${item.body}</div>
        <div class="source">${item.source}</div>
      </div>`
    ).join("")}

    <h2>Что почитать</h2>
    <ul class="reading-list">
      ${READING_LIST.map((r) => `<li>${r}</li>`).join("")}
    </ul>

    <h2>Что впереди</h2>
    <div class="note">Счётчики голосов ниже — пример визуализации; реальная агрегация предложений ведётся командой вручную (см. Фонд идей).</div>
    ${UPCOMING_FACTORS.map(
      (f) => `<div class="ahead-item"><span>${f.name}</span><span class="optional-badge">${f.note}</span></div>`
    ).join("")}
    ${UPCOMING_VOTED_EXAMPLE.map(
      (f) => `<div class="ahead-item">
        <span>${f.name}</span>
        <span style="display:flex;align-items:center;">${f.votes}/${f.threshold}
          <span class="vote-bar"><span class="fill" style="width:${Math.min(100, (f.votes / f.threshold) * 100)}%"></span></span>
        </span>
      </div>`
    ).join("")}
  `;
}

/* ---- Idea fund ---- */

function renderIdeas(screen) {
  const tab = state.ideasTab || "new";
  screen.innerHTML = `
    <h2>Фонд идей</h2>
    <div class="section-tabs">
      <button data-tab="new" class="${tab === "new" ? "active" : ""}">Новая идея</button>
      <button data-tab="mine" class="${tab === "mine" ? "active" : ""}">Ваши идеи</button>
    </div>
    <div id="ideas-content"></div>
  `;
  screen.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.ideasTab = btn.dataset.tab;
      saveState();
      renderIdeas(screen);
    });
  });

  const content = document.getElementById("ideas-content");
  if (tab === "new") {
    content.innerHTML = `
      <div class="field">
        <label>Категория</label>
        <select id="idea_category">
          ${IDEA_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Текст</label>
        <textarea id="idea_text" placeholder="Опишите идею или проблему..."></textarea>
      </div>
      <div class="hint" style="margin-bottom:16px;">Идею видите только вы и команда. Авторство не раскрывается другим пользователям.</div>
      <button class="btn" id="idea-submit" style="width:100%">Отправить</button>
    `;
    document.getElementById("idea-submit").addEventListener("click", () => {
      const text = document.getElementById("idea_text").value.trim();
      if (!text) return;
      const category = document.getElementById("idea_category").value;
      // TODO(backend): submit to a real endpoint instead of local-only storage,
      // so the team can actually see and aggregate submissions across users.
      state.ideas.push({ id: Date.now(), date: todayStr(), category, text });
      saveState();
      state.ideasTab = "mine";
      saveState();
      renderIdeas(screen);
    });
  } else {
    if (state.ideas.length === 0) {
      content.innerHTML = `<div class="empty-state">Вы ещё не отправляли идей.</div>`;
    } else {
      content.innerHTML = state.ideas
        .slice()
        .reverse()
        .map(
          (i) => `<div class="idea-item">
            <span class="date">${i.date}</span>
            <div class="cat">${i.category}</div>
            <div>${i.text}</div>
          </div>`
        )
        .join("");
    }
  }
}

/* ---------------------------------------------------------------------
 * Init
 * ------------------------------------------------------------------- */

render();
