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

// Region select for onboarding (TZ section 1: "регион (страна/город
// регистрации)"). Kept as a closed list rather than free text so the
// value is both validated at input time and directly usable as a lookup
// key for the actuarial adjustment below. "other" is the explicit
// catch-all for anything not in the list.
const REGION_OPTIONS = [
  { value: "us", label: "США" },
  { value: "ru", label: "Россия" },
  { value: "by", label: "Беларусь" },
  { value: "ua", label: "Украина" },
  { value: "kz", label: "Казахстан" },
  { value: "de", label: "Германия" },
  { value: "gb", label: "Великобритания" },
  { value: "fr", label: "Франция" },
  { value: "es", label: "Испания" },
  { value: "it", label: "Италия" },
  { value: "pl", label: "Польша" },
  { value: "il", label: "Израиль" },
  { value: "ca", label: "Канада" },
  { value: "au", label: "Австралия" },
  { value: "other", label: "Другая страна" },
];

// Region adjustment to the starting-capital baseline (TZ section 1:
// "Источник — актуарная таблица: SSA Period Life Table (US) либо WHO
// Global Health Observatory. Fallback на глобальные показатели WHO при
// отсутствии данных по региону."). LIFE_EXPECTANCY_TABLE above already
// IS the US SSA-magnitude table, so "us" gets no adjustment; every other
// region falls back to an illustrative WHO-global-average discount vs.
// that US baseline. This is a placeholder ratio, not a verified
// per-country dataset — TODO: replace with real WHO GHO country tables.
const REGION_GLOBAL_FALLBACK_PCT = -0.07;

function regionAdjustmentPct(region) {
  return region === "us" ? 0 : REGION_GLOBAL_FALLBACK_PCT;
}

// Range-picker options for onboarding (TZ section 1, 10.08.2026 update:
// "везде, где не требуется точное число для формулы — выбор из диапазона
// вместо свободного ввода/точной цифры"). Age and cigarettes/day stay
// exact numbers (formula needs precision there); everything else below
// is a bucket. Where a bucket feeds a formula that wants one number
// (activity minutes/week, sleep hours, alcohol ml/week), `midpoint*`
// gives the bucket's midpoint — an explicit, disclosed approximation,
// not a value stated by the spec itself.

// WHO activity thresholds (TZ section 3.2 / section 1 step 2), required.
const ACTIVITY_RANGE_OPTIONS = [
  { value: "lt150", label: "менее 150 мин/нед", midpointMinutes: 75 },
  { value: "150to300", label: "150–300 мин/нед", midpointMinutes: 225 },
  { value: "gt300", label: "более 300 мин/нед", midpointMinutes: 400 },
];

// Not fed into any formula (waist isn't used in the calc) — thresholds
// taken as-is from the TZ text. TZ itself flags these as "ориентировочные,
// скорректировать под пол при реализации" but doesn't give gender-split
// numbers, so this is a single unisex set until that's specified.
const WAIST_RANGE_OPTIONS = [
  { value: "lt80", label: "до 80 см" },
  { value: "80to95", label: "80–95 см" },
  { value: "95to110", label: "95–110 см" },
  { value: "gt110", label: "более 110 см" },
];

// Cappuccio meta-analysis buckets (TZ section 1 step 3) — feeds sleepAdjustmentPct.
const SLEEP_HOURS_RANGE_OPTIONS = [
  { value: "lt5", label: "менее 5ч", midpointHours: 4.5 },
  { value: "5to6", label: "5–6ч", midpointHours: 5.5 },
  { value: "6to7", label: "6–7ч", midpointHours: 6.5 },
  { value: "7to8", label: "7–8ч", midpointHours: 7.5 },
  { value: "8to9", label: "8–9ч", midpointHours: 8.5 },
  { value: "gt9", label: "более 9ч", midpointHours: 9.5 },
];

// Descriptive only, not used in any formula.
const BEDTIME_RANGE_OPTIONS = [
  { value: "before22", label: "до 22:00" },
  { value: "22to24", label: "22:00–24:00" },
  { value: "afterMidnight", label: "после полуночи" },
  { value: "varies", label: "когда как" },
  { value: "custom", label: "свой вариант" },
];

// TZ section 1 step 3: "на MVP-этапе фиксировать только факт
// использования" — booleans, no coefficient. "other" also feeds the
// Idea Fund signal (repeated free-text mentions become a factor
// candidate), so it gets a short text field alongside the checkbox.
const RECOVERY_PRACTICES = [
  { key: "yoga", label: "Йога" },
  { key: "breathing", label: "Дыхательные практики" },
  { key: "hardening", label: "Закаливание" },
  { key: "nailBoard", label: "Гвоздестояние" },
  { key: "banya", label: "Баня" },
  { key: "massage", label: "Массаж" },
];

// Nutrition step (TZ section 1 step 4) — all descriptive/collected for
// future use, none feed the current formula (nutrition factor is
// disabled, see KNOWLEDGE_BASE below).
const WATER_RANGE_OPTIONS = [
  { value: "0to500", label: "0–500 мл" },
  { value: "500to1500", label: "0.5–1.5 л" },
  { value: "gt1500", label: "более 1.5 л" },
];

const LAST_MEAL_TIME_OPTIONS = [
  { value: "before18", label: "до 18:00" },
  { value: "18to20", label: "18:00–20:00" },
  { value: "after20", label: "после 20:00" },
  { value: "varies", label: "когда как" },
];

const MEALS_PER_DAY_OPTIONS = [
  { value: "1to2", label: "1–2" },
  { value: "3", label: "3" },
  { value: "4to5", label: "4–5" },
  { value: "moreIrregular", label: "больше, нерегулярно" },
];

const HOURS_BETWEEN_MEALS_OPTIONS = [
  { value: "lt3", label: "менее 3ч" },
  { value: "3to5", label: "3–5ч" },
  { value: "gt5", label: "более 5ч" },
  { value: "irregular", label: "нерегулярно" },
];

const EATING_WINDOW_OPTIONS = [
  { value: "lt10", label: "менее 10ч" },
  { value: "10to14", label: "10–14ч" },
  { value: "gt14", label: "более 14ч" },
  { value: "varies", label: "когда как" },
];

const SUPPLEMENTS_REGULARITY_OPTIONS = [
  { value: "daily", label: "Ежедневно" },
  { value: "fewPerWeek", label: "Несколько раз в неделю" },
  { value: "sometimes", label: "Иногда" },
  { value: "none", label: "Не принимаю" },
];

// Alcohol (TZ section 1 step 5, ranges finalized 11.08.2026) — each
// beverage type gets its own thresholds (a 100ml spirits pour and 100ml
// of beer aren't comparable volumes) rather than one shared scale.
// midpointMl is currently unused by the starting-capital calc (alcohol
// is a binary years-lost factor, see isRegularDrinkerApprox/
// tsaiYearsLostTotal below) — kept on the off chance a future factor
// wants a volume estimate; only the bucket value itself ("0" vs
// anything else) matters for the current formula.
const ALCOHOL_SPIRITS_RANGE_OPTIONS = [
  { value: "0", label: "0", midpointMl: 0 },
  { value: "lt100", label: "до 100 мл/нед", midpointMl: 50 },
  { value: "100to350", label: "100–350 мл/нед", midpointMl: 225 },
  { value: "gt350", label: "более 350 мл/нед", midpointMl: 450 },
];

const ALCOHOL_WINE_RANGE_OPTIONS = [
  { value: "0", label: "0", midpointMl: 0 },
  { value: "lt350", label: "до 350 мл/нед", midpointMl: 175 },
  { value: "350to1000", label: "350–1000 мл/нед", midpointMl: 675 },
  { value: "gt1000", label: "более 1000 мл/нед", midpointMl: 1300 },
];

const ALCOHOL_BEER_RANGE_OPTIONS = [
  { value: "0", label: "0", midpointMl: 0 },
  { value: "lt700", label: "до 0.7 л/нед", midpointMl: 350 },
  { value: "700to2000", label: "0.7–2 л/нед", midpointMl: 1350 },
  { value: "gt2000", label: "более 2 л/нед", midpointMl: 2500 },
];

function rangeLookup(options, value, field) {
  const opt = options.find((o) => o.value === value);
  return opt ? opt[field] : undefined;
}

const KNOWLEDGE_BASE = [
  {
    key: "smoking",
    name: "Курение",
    active: true,
    body: "Каждая выкуренная сигарета в среднем стоит около 20 минут ожидаемой продолжительности жизни; с возрастом цена растёт. Статус «курит» отдельно учитывается один раз при расчёте стартового капитала (около 5.7–7 лет разницы в ожидаемой продолжительности жизни у курящих, по данным когортного исследования). Отдельно от этого число сигарет в день, указанное при онбординге, становится Вашей личной «ватерлинией» — точкой отсчёта для ежедневного портфеля: списание или депозит считается от отклонения от неё — курите сегодня меньше обычного, получаете плюс, больше — минус.",
    source: "Источники: UCL, журнал Addiction (2024/2025); Tsai et al., Aging (Albany NY), 2021 — годы жизни по статусу курения.",
  },
  {
    key: "sport",
    name: "Физическая активность",
    active: true,
    body: "Около 20 минут умеренной активности добавляют примерно 1 час капитала (модель microlife). Положительный эффект перестаёт расти после 90 минут активности в день. Отдельно недостаточная активность (менее ~150 минут в неделю) сама по себе связана с повышенным на 20–30% риском смерти по сравнению с достаточно активными людьми — с возрастом этот разрыв увеличивается, поэтому в стартовом расчёте он учитывается сильнее у пользователей старшего возраста. Считается только активность, где пульс поднимается минимум на 50% выше уровня покоя — тест разговором: можете говорить, но не петь (или сложнее говорить) — засчитывается; свободно поёте на ходу — нет. Медленная прогулка не в счёт, быстрая ходьба, физический труд или тренировка — да.",
    source: "Источники: D. Spiegelhalter, BMJ (2012); WHO (по риску недостаточной активности); Cleveland Clinic (порог интенсивности, тест разговором).",
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
  "WHO — рекомендации по физической активности: риск недостаточной активности против достаточной.",
  "Cleveland Clinic — определение умеренной и высокой интенсивности активности, тест разговором.",
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

// "Фразы вовлечения" (TZ section 8, 10.08.2026) — base tone only, exactly
// the example phrases given in the spec (not invented copy). Style
// customization (дружеский/официально-деловой/с юмором/лаконичный) is
// explicitly out of scope for this pass — one neutral tone everywhere.
const ONBOARDING_RESULT_PHRASES = {
  top: ["Редкий профиль", "Статистическая аномалия — в хорошем смысле", "Потенциальный долгожитель"],
  good: ["Сильный старт", "Выше среднего по всем фронтам"],
  medium: ["Крепкая база — и есть, куда расти"],
  low: ["Точка отсчёта, а не приговор", "Отсюда есть куда расти — и это хорошая новость", "Лучшее время начать — сегодня"],
};

const DAILY_GOOD_PHRASES = ["Депозит принят", "Капитал растёт", "Ещё один кирпичик", "Вклад засчитан"];
const DAILY_BAD_PHRASES = ["Списание учтено — завтра наверстаем", "Не идеально, но это данные, а не приговор"];
const DAILY_RECORD_PHRASE = "Лучший результат за всё время";

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickPhrase(pool, seed) {
  return pool[simpleHash(seed) % pool.length];
}

// Which ONBOARDING_RESULT_PHRASES tier to show — TZ section 8 gives
// example phrases per tier ("спектр по силе") but no numeric cutoffs, so
// this heuristic is a disclosed placeholder, not a spec requirement.
// Recomputed the same way as computeStartingCapitalDays below (years-lost
// factors expressed as a fraction of baseline, combined with the two
// factors still on the old percentage mechanism) — deliberately excludes
// the region factor, which is demographic, not something to praise or
// blame the user for.
function onboardingResultTier(ob) {
  const baselineYears = interpolateLifeExpectancyYears(ob.gender, ob.age);
  const activityLevel = activityLevelFromOnboarding(ob);
  const sleepHours = rangeLookup(SLEEP_HOURS_RANGE_OPTIONS, ob.sleepHoursRange, "midpointHours");
  const shortSleepPct = sleepShortAdjustmentPct(sleepHours, activityLevel);
  const illnessPct = illnessAdjustmentPct(ob);
  const yearsLostPct = baselineYears > 0 ? tsaiYearsLostTotal(ob) / baselineYears : 0;
  const combinedPct = (1 + shortSleepPct) * (1 + illnessPct) * (1 - yearsLostPct) - 1;
  if (combinedPct >= 0) return "top";
  if (combinedPct >= -0.1) return "good";
  if (combinedPct >= -0.25) return "medium";
  return "low";
}

/* ---------------------------------------------------------------------
 * Storage
 * ------------------------------------------------------------------- */

const STORAGE_KEY = "hc_state_v1";

// Temporary dev/test-only reset hook — not a finished UX (no confirm
// dialog, nothing in the visible UI). Visiting the app with ?reset=true
// wipes all local state and drops back into onboarding from scratch.
// Deliberately NOT a button in the main interface: there's no backend
// yet, so a real user's accidental tap would be unrecoverable. TODO:
// replace with a proper settings-screen confirmation before launch.
if (new URLSearchParams(location.search).get("reset") === "true") {
  localStorage.removeItem(STORAGE_KEY);
  location.replace(location.pathname);
}

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function defaultState() {
  return {
    onboarding: null, // filled once onboarding completes
    startingCapitalDays: null,
    smokingWaterline: 0, // reference point for the daily smoking factor, set once at onboarding
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

// TODO(hardening, flagged 11.08.2026, not reachable via the current UI):
// `age` is used raw in the comparisons below, not Number()-coerced. A
// non-numeric age silently falls through every branch to the oldest
// bracket in the table (minimum remaining years) instead of failing
// loudly or staying neutral — same "invalid input reads as a worst-case
// answer" pattern as the activityRange/alcohol bugs fixed this session.
// Currently unreachable: collectStepFields always sets draft.age via
// `Number(val) || null`, and step 1 blocks onboarding on a falsy age.
// Revisit if an admin panel or any other path can write onboarding data
// without going through that UI validation (TZ section 16).
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

// Only activity clearing the "talk test" bar counts (TZ update): raises
// heart rate to ~50% above resting (Cleveland Clinic definition of
// moderate-or-above intensity) — can talk but not sing, or can't talk at
// all. A slow park walk doesn't qualify; brisk walking, manual labor,
// or a workout does. This is a self-reported range at onboarding (TZ
// section 1 step 2, WHO thresholds), converted to its bucket midpoint —
// see ACTIVITY_RANGE_OPTIONS.
function activityMinutesPerWeekFromOnboarding(ob) {
  return rangeLookup(ACTIVITY_RANGE_OPTIONS, ob.activityRange, "midpointMinutes") || 0;
}

// TODO(hardening, flagged 11.08.2026, not reachable via the current UI):
// unlike the "provided" guards added this session for the actual
// starting-capital penalty calculations, this function doesn't validate
// activityRange against ACTIVITY_RANGE_OPTIONS — an unrecognized value
// silently reads as "low" (0 minutes/week via the `|| 0` fallback in
// activityMinutesPerWeekFromOnboarding), which shifts sleepWindow()'s
// bounds and so the short-sleep percentage in sleepShortAdjustmentPct.
// Confirmed a real (non-worst-case, just inaccurate) discrepancy in
// testing. Not reachable normally: activityRange is a required field
// validated at onboarding step 2. Revisit alongside the age TODO above
// if an admin panel or other non-UI write path appears (TZ section 16).
function activityLevelFromOnboarding(ob) {
  const minutesPerWeek = activityMinutesPerWeekFromOnboarding(ob);
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

// Short-sleep side only (Cappuccio meta-analysis, unchanged from before).
// The long-sleep (>8h) side used to live here too as a symmetric percentage
// penalty; it's now a binary years-lost factor sourced from Tsai et al.
// 2021, see tsaiYearsLostTotal() below — kept separate per that source
// (see Source_Chiang_Tsai_2021.md), not merged into one curve.
function sleepShortAdjustmentPct(sleepHours, activityLevel) {
  if (!sleepHours) return 0;
  const [lo] = sleepWindow(activityLevel);
  if (sleepHours < lo) {
    const pct = -0.12 * ((lo - sleepHours) / lo);
    return Math.max(pct, -0.3);
  }
  return 0;
}

function illnessAdjustmentPct(ob) {
  return ob.illnessHas === true ? -0.15 : 0;
}

// TODO(methodology, flagged 11.08.2026): illnessAdjustmentPct and
// sleepShortAdjustmentPct (short-sleep side) still apply a literature
// relative-risk figure as a direct percentage of remaining life-expectancy
// years, which isn't how RR actually converts into a life-expectancy
// change (needs actuarial recalculation via survival curves, not linear
// multiplication). Smoking, alcohol, activity, and long-sleep no longer
// have this problem — see tsaiYearsLostTotal() below, sourced from real
// years-of-life-lost data (Tsai et al. 2021) instead of a converted RR.
// Region (regionAdjustmentPct) was never the same issue — it scales by an
// actual life-expectancy-YEARS ratio between countries. Do not invent the
// illness/short-sleep conversion yourself — no sourced years-lost figure
// for either yet.

// Binary years-of-life-lost factors from Tsai et al. 2021 ("Converting
// health risks into loss of life years", Aging (Albany NY) 13(17):21513-
// 21525 — see Source_Chiang_Tsai_2021.md for the full table and every
// approximation disclosed below). The source only reports BINARY,
// sex-specific figures (risk factor present/absent) — no dose grading —
// so these are applied as flat years subtracted from baseline, not scaled
// by dose or age (the source's HRs are already age-adjusted).
const TSAI_YEARS_LOST = {
  smoking: { male: 5.66, female: 7.02 }, // current smoker vs never smoker
  alcohol: { male: 6.86, female: 6.35 }, // "regular drinker" vs non-drinker
  activity: { male: 4.74, female: 5.07 }, // <3.75 MET-h/wk vs >=7.5 MET-h/wk
  longSleep: { male: 5.04, female: 5.34 }, // >8h/day vs 6-7h/day
};

function yearsLostForGender(factor, gender) {
  const v = TSAI_YEARS_LOST[factor];
  if (gender === "male") return v.male;
  if (gender === "female") return v.female;
  return (v.male + v.female) / 2; // non-binary/unspecified: same averaging as interpolateLifeExpectancyYears
}

// Approximation, NOT from the source (see Source_Chiang_Tsai_2021.md):
// the paper defines "regular drinker" as >=2 drinks, >=3x/week — a
// frequency, not a volume. Our onboarding only collects ml/week buckets
// per beverage type, so this maps "any beverage type above the '0'
// bucket" to "regular drinker". That's our own mapping rule, not a
// finding of the study.
function isRegularDrinkerApprox(ob) {
  // Same guard as ACTIVITY_RANGE_OPTIONS.some(...) elsewhere: validate
  // against each field's own real bucket list, not just "is this
  // non-empty and not literally '0'". An unrecognized string used to be
  // treated as "drinking" (full penalty) instead of neutral — confirmed
  // live: an invalid value produced the identical result to a genuine
  // "lt100"-equivalent answer instead of matching the empty/unanswered
  // case. Each beverage type now has its own options/thresholds (see
  // ALCOHOL_SPIRITS/WINE/BEER_RANGE_OPTIONS above), so each is checked
  // against its own list.
  const isDrinkingBucket = (options, v) => options.some((o) => o.value === v) && v !== "0";
  return (
    isDrinkingBucket(ALCOHOL_SPIRITS_RANGE_OPTIONS, ob.alcoholSpirits) ||
    isDrinkingBucket(ALCOHOL_WINE_RANGE_OPTIONS, ob.alcoholWine) ||
    isDrinkingBucket(ALCOHOL_BEER_RANGE_OPTIONS, ob.alcoholBeer)
  );
}

function tsaiYearsLostTotal(ob) {
  const smokingYears = Number(ob.cigarettesPerDay) > 0 ? yearsLostForGender("smoking", ob.gender) : 0;
  const alcoholYears = isRegularDrinkerApprox(ob) ? yearsLostForGender("alcohol", ob.gender) : 0;
  // Approximation, NOT from the source: the paper measures inactivity in
  // MET-hours/week (<3.75 vs a >=7.5 reference); we only collect WHO
  // minutes/week buckets. "lt150" is used as a working proxy for the
  // paper's inactivity threshold, not a verified unit conversion.
  const activityProvided = ACTIVITY_RANGE_OPTIONS.some((o) => o.value === ob.activityRange);
  const activityYears = activityProvided && ob.activityRange === "lt150" ? yearsLostForGender("activity", ob.gender) : 0;
  const sleepHours = rangeLookup(SLEEP_HOURS_RANGE_OPTIONS, ob.sleepHoursRange, "midpointHours");
  const longSleepYears = sleepHours !== undefined && sleepHours > 8 ? yearsLostForGender("longSleep", ob.gender) : 0;
  return smokingYears + alcoholYears + activityYears + longSleepYears;
}

// One-time starting capital, computed at the end of onboarding (TZ
// section 1-2, updated 11.08.2026 per Source_Chiang_Tsai_2021.md).
// Years-lost factors (smoking, alcohol, activity, long sleep) are
// subtracted directly from baseline years first — that's the Chiang/Tsai
// formula shape (Капитал(лет) = Базовая − Σyears_lost). Region, illness,
// and short-sleep stay on the older percentage-multiplier mechanism
// (still on the methodology TODO above) and are applied to what's left
// after the years-lost subtraction.
function computeStartingCapitalDays(ob) {
  const baselineYears = interpolateLifeExpectancyYears(ob.gender, ob.age);

  const regionPct = regionAdjustmentPct(ob.region);
  const illnessPct = illnessAdjustmentPct(ob);
  const activityLevel = activityLevelFromOnboarding(ob);
  const sleepHours = rangeLookup(SLEEP_HOURS_RANGE_OPTIONS, ob.sleepHoursRange, "midpointHours");
  const shortSleepPct = sleepShortAdjustmentPct(sleepHours, activityLevel);

  const yearsLost = tsaiYearsLostTotal(ob);
  const yearsAfterLost = baselineYears - yearsLost;

  const days =
    yearsAfterLost *
    365.25 *
    (1 + regionPct) *
    (1 + illnessPct) *
    (1 + shortSleepPct);

  // Defensive floor: at older ages (this app's stated audience is 30-60,
  // TZ section 6) combined years-lost can exceed the remaining baseline
  // for someone hitting every risk factor at once, going negative. Not a
  // sourced number — just preventing a nonsensical negative/zero result
  // from reaching the UI.
  return Math.max(Math.round(days), 0);
}

// Daily active-factor delta for the "Портфель здоровья" ledger — TZ
// section 4, updated formula. Smoking is no longer an absolute cost:
// the onboarding cigarettes/day figure is a personal "waterline"
// (reference point). Smoking less than the waterline today is a
// deposit, smoking more is a withdrawal, smoking exactly at the
// waterline is neutral — the waterline itself never costs anything by
// existing, only deviations from it do.
function dailyDeltaDays(cigarettesToday, activityMinutesToday, age, smokingWaterline) {
  const waterline = Number(smokingWaterline) || 0;
  const today = Number(cigarettesToday) || 0;
  const smokingTerm = (waterline - today) * 0.014 * ageMultiplier(age);
  const activityGain = Math.min((Number(activityMinutesToday) || 0) / 60 * 3, 4.5) / 24;
  return activityGain + smokingTerm;
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

// All free-text user input (onboarding text/number fields, idea fund
// submissions, etc.) must go through this before landing in innerHTML —
// whether as element content or inside a quoted attribute — so a value
// like `<iframe src="javascript:...">` renders as inert text instead of
// executing. Applied at render time (every value is untrusted again on
// each re-render, e.g. after loading from localStorage), not just once
// at submission time.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

const root = document.getElementById("app");

function render() {
  if (!state.onboarding) {
    renderOnboarding();
  } else {
    renderApp();
  }
}

/* ---- Onboarding ---- */

// TZ section 1, 10.08.2026 restructure: 6 input steps (was 7) — "body"
// and "activity" merged into one step, "nutrition" is new, "smoking" and
// "alcohol" merged into one "habits" step — plus the "reveal" result.
const ONBOARDING_STEPS = ["basics", "activity_form", "recovery", "nutrition", "habits", "health", "reveal"];

function reqMark() {
  return `<span class="required-mark">*</span>`;
}

function optHint() {
  return `<span class="optional-badge">необязательно</span>`;
}

function selectOptionsHtml(options, selectedValue) {
  return options
    .map((o) => `<option value="${o.value}" ${selectedValue === o.value ? "selected" : ""}>${o.label}</option>`)
    .join("");
}

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
        <p>Три обязательных вопроса.</p>
      </div>
      <div class="field">
        <label>Возраст ${reqMark()}</label>
        <input type="number" min="1" max="120" id="f_age" value="${escapeHtml(draft.age ?? "")}">
      </div>
      <div class="field">
        <label>Пол ${reqMark()}</label>
        <select id="f_gender">
          <option value="">Выбрать...</option>
          <option value="male" ${draft.gender === "male" ? "selected" : ""}>Мужской</option>
          <option value="female" ${draft.gender === "female" ? "selected" : ""}>Женский</option>
          <option value="other" ${draft.gender === "other" ? "selected" : ""}>Другое / не указывать</option>
        </select>
      </div>
      <div class="field">
        <label>Регион (страна) ${reqMark()}</label>
        <select id="f_region">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(REGION_OPTIONS, draft.region)}
        </select>
      </div>
    `;
  } else if (step === "activity_form") {
    body = `
      <div class="onboarding-header">
        <h1>Активность и форма</h1>
      </div>
      <div class="field">
        <label>Физическая активность, мин/нед ${reqMark()}</label>
        <select id="f_activityRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(ACTIVITY_RANGE_OPTIONS, draft.activityRange)}
        </select>
        <div class="hint">Считается только активность, поднимающая пульс минимум на 50% выше уровня покоя (Cleveland Clinic) — тест разговором: можете говорить, но не петь — считается, свободно поёте — нет. Медленная прогулка не в счёт.</div>
      </div>
      <div class="field" id="f_activityGoalBlock" style="display:${draft.activityRange === "lt150" ? "block" : "none"}">
        <label>Хотите начать регулярно двигаться? ${reqMark()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_activityGoal" value="yes" ${draft.activityGoalConfirmed === true ? "checked" : ""}> Да, хочу</label>
          <label><input type="radio" name="f_activityGoal" value="no" ${draft.activityGoalConfirmed === false ? "checked" : ""}> Не сейчас</label>
        </div>
      </div>
      <div class="field">
        <label>Вес, кг ${optHint()}</label>
        <input type="number" id="f_weight" value="${escapeHtml(draft.weight ?? "")}">
      </div>
      <div class="field">
        <label>Рост, см ${optHint()}</label>
        <input type="number" id="f_height" value="${escapeHtml(draft.height ?? "")}">
      </div>
      <div class="field">
        <label>Объём талии ${optHint()}</label>
        <select id="f_waistRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(WAIST_RANGE_OPTIONS, draft.waistRange)}
        </select>
        <input type="number" id="f_waistExact" placeholder="или точное значение, см" value="${escapeHtml(draft.waistExact ?? "")}" style="margin-top:8px">
      </div>
    `;
  } else if (step === "recovery") {
    body = `
      <div class="onboarding-header">
        <h1>Восстановление</h1>
      </div>
      <div class="field">
        <label>Среднее количество часов сна ${optHint()}</label>
        <select id="f_sleepHoursRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(SLEEP_HOURS_RANGE_OPTIONS, draft.sleepHoursRange)}
        </select>
      </div>
      <div class="field">
        <label>Обычное время отхода ко сну ${optHint()}</label>
        <select id="f_bedtimeRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(BEDTIME_RANGE_OPTIONS, draft.bedtimeRange)}
        </select>
        <input type="time" id="f_bedtimeExact" value="${escapeHtml(draft.bedtimeExact ?? "")}" style="margin-top:8px; display:${draft.bedtimeRange === "custom" ? "block" : "none"}">
      </div>
      <div class="field">
        <label>Практики восстановления ${optHint()}</label>
        <div class="checkbox-list">
          ${RECOVERY_PRACTICES.map(
            (p) =>
              `<label class="checkbox-row"><input type="checkbox" id="f_recovery_${p.key}" ${draft.recoveryPractices?.[p.key] ? "checked" : ""}> ${p.label}</label>`
          ).join("")}
          <label class="checkbox-row"><input type="checkbox" id="f_recovery_other" ${draft.recoveryPractices?.other ? "checked" : ""}> Другое</label>
          <input type="text" id="f_recovery_otherText" placeholder="Что именно?" value="${escapeHtml(draft.recoveryPractices?.otherText ?? "")}">
        </div>
      </div>
    `;
  } else if (step === "nutrition") {
    body = `
      <div class="onboarding-header">
        <h1>Питание</h1>
      </div>
      <div class="field">
        <label>Объём чистой воды в сутки ${optHint()}</label>
        <select id="f_waterRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(WATER_RANGE_OPTIONS, draft.waterRange)}
        </select>
      </div>
      <div class="field">
        <label>Время последнего приёма пищи ${optHint()}</label>
        <select id="f_lastMealTimeRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(LAST_MEAL_TIME_OPTIONS, draft.lastMealTimeRange)}
        </select>
      </div>
      <div class="field">
        <label>Количество приёмов пищи в день ${optHint()}</label>
        <select id="f_mealsPerDayRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(MEALS_PER_DAY_OPTIONS, draft.mealsPerDayRange)}
        </select>
      </div>
      <div class="field">
        <label>Часы между приёмами пищи (в среднем) ${optHint()}</label>
        <select id="f_hoursBetweenMealsRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(HOURS_BETWEEN_MEALS_OPTIONS, draft.hoursBetweenMealsRange)}
        </select>
      </div>
      <div class="field">
        <label>Окно между первым и последним приёмом пищи ${optHint()}</label>
        <select id="f_eatingWindowRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(EATING_WINDOW_OPTIONS, draft.eatingWindowRange)}
        </select>
      </div>
      <div class="field">
        <label>Перекусы бывают? ${optHint()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_snacksHas" value="yes" ${draft.snacksHas === true ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_snacksHas" value="no" ${draft.snacksHas === false ? "checked" : ""}> Нет</label>
        </div>
      </div>
      <div class="field">
        <label>БАДы — регулярность приёма ${optHint()}</label>
        <select id="f_supplementsRegularity">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(SUPPLEMENTS_REGULARITY_OPTIONS, draft.supplementsRegularity)}
        </select>
      </div>
      <div class="field">
        <label>Считаете своё питание сбалансированным? ${optHint()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_nutritionBalanceSelf" value="yes" ${draft.nutritionBalanceSelf === true ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_nutritionBalanceSelf" value="no" ${draft.nutritionBalanceSelf === false ? "checked" : ""}> Нет</label>
        </div>
      </div>
    `;
  } else if (step === "habits") {
    body = `
      <div class="onboarding-header">
        <h1>Вредные привычки</h1>
      </div>
      <div class="field">
        <label>Сигарет в день (0, если не курите) ${reqMark()}</label>
        <input type="number" min="0" id="f_cigarettesPerDay" value="${escapeHtml(draft.cigarettesPerDay ?? "")}">
      </div>
      <div class="field" id="f_smokingGoalBlock" style="display:${Number(draft.cigarettesPerDay) > 0 ? "block" : "none"}">
        <label>Хотите бросить курить? ${reqMark()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_smokingGoal" value="yes" ${draft.smokingGoalConfirmed === true ? "checked" : ""}> Да, хочу</label>
          <label><input type="radio" name="f_smokingGoal" value="no" ${draft.smokingGoalConfirmed === false ? "checked" : ""}> Не сейчас</label>
        </div>
      </div>
      <div class="field">
        <label>Вейп / кальян — используете? ${optHint()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_vape" value="yes" ${draft.vapeHookah === "yes" ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_vape" value="no" ${draft.vapeHookah === "no" ? "checked" : ""}> Нет</label>
        </div>
      </div>
      <div class="field">
        <label>Крепкий алкоголь, мл/нед ${optHint()}</label>
        <select id="f_alcoholSpiritsRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(ALCOHOL_SPIRITS_RANGE_OPTIONS, draft.alcoholSpirits)}
        </select>
      </div>
      <div class="field">
        <label>Вино, мл/нед ${optHint()}</label>
        <select id="f_alcoholWineRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(ALCOHOL_WINE_RANGE_OPTIONS, draft.alcoholWine)}
        </select>
      </div>
      <div class="field">
        <label>Пиво и слабоалкогольные коктейли ${optHint()}</label>
        <select id="f_alcoholBeerRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(ALCOHOL_BEER_RANGE_OPTIONS, draft.alcoholBeer)}
        </select>
      </div>
    `;
  } else if (step === "health") {
    body = `
      <div class="onboarding-header">
        <h1>Здоровье</h1>
      </div>
      <div class="field">
        <label>Есть ли серьёзные заболевания? ${optHint()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_illnessHas" value="yes" ${draft.illnessHas === true ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_illnessHas" value="no" ${draft.illnessHas === false ? "checked" : ""}> Нет</label>
        </div>
      </div>
      <div class="field">
        <label>Уточнение ${optHint()}</label>
        <input type="text" id="f_illnessDetail" value="${escapeHtml(draft.illnessDetail ?? "")}">
        <div class="hint">Этот пункт всегда можно пропустить.</div>
      </div>
    `;
  } else if (step === "reveal") {
    revealDays = computeStartingCapitalDays(draft);
    const tier = onboardingResultTier(draft);
    const resultPhrase = pickPhrase(ONBOARDING_RESULT_PHRASES[tier], JSON.stringify(draft));
    body = `
      <div class="onboarding-header">
        <h1>Ваш стартовый капитал готов</h1>
      </div>
      <div class="reveal-number">
        <div class="value" id="reveal-value">0</div>
        <div class="label">дней ожидаемого капитала здоровья</div>
        <div class="reveal-phrase">${escapeHtml(resultPhrase)}</div>
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
      state.smokingWaterline = Number(draft.cigarettesPerDay) || 0;
      state.createdAt = state.createdAt || todayStr();
      state.onboardingStep = null;
      state.onboardingDraft = null;
      saveState();
      render();
    });
  } else {
    // Goal-confirmation blocks (Evan Forman feedback, 08.08.2026): shown
    // only when relevant (insufficient activity / actually smokes), and
    // must react live to the triggering field without a full step
    // re-render, so the radio choice already made isn't lost mid-edit.
    if (step === "activity_form") {
      document.getElementById("f_activityRange").addEventListener("change", (e) => {
        document.getElementById("f_activityGoalBlock").style.display = e.target.value === "lt150" ? "block" : "none";
      });
    }
    if (step === "habits") {
      document.getElementById("f_cigarettesPerDay").addEventListener("input", (e) => {
        document.getElementById("f_smokingGoalBlock").style.display = Number(e.target.value) > 0 ? "block" : "none";
      });
    }
    if (step === "recovery") {
      document.getElementById("f_bedtimeRange").addEventListener("change", (e) => {
        document.getElementById("f_bedtimeExact").style.display = e.target.value === "custom" ? "block" : "none";
      });
    }
    document.getElementById("ob-next").addEventListener("click", () => {
      collectStepFields(step, draft);
      if (step === "basics" && (!draft.age || !draft.gender || !draft.region)) {
        alert("Возраст, пол и регион обязательны для продолжения.");
        return;
      }
      if (step === "activity_form" && !draft.activityRange) {
        alert("Физическая активность обязательна для продолжения.");
        return;
      }
      if (step === "activity_form" && draft.activityRange === "lt150" && draft.activityGoalConfirmed === undefined) {
        alert("Пожалуйста, ответьте на вопрос про цель по активности.");
        return;
      }
      if (step === "habits" && (draft.cigarettesPerDay === "" || draft.cigarettesPerDay === undefined || draft.cigarettesPerDay === null)) {
        alert("Сигарет в день обязательно для продолжения (0, если не курите).");
        return;
      }
      if (step === "habits" && Number(draft.cigarettesPerDay) > 0 && draft.smokingGoalConfirmed === undefined) {
        alert("Пожалуйста, ответьте на вопрос про цель по курению.");
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
  const checkedRadio = (name) => document.querySelector(`input[name="${name}"]:checked`);
  if (step === "basics") {
    draft.age = Number(val("f_age")) || null;
    draft.gender = val("f_gender") || null;
    draft.region = val("f_region") || "";
  } else if (step === "activity_form") {
    draft.activityRange = val("f_activityRange") || "";
    draft.weight = val("f_weight");
    draft.height = val("f_height");
    draft.waistRange = val("f_waistRange") || "";
    draft.waistExact = val("f_waistExact");
    if (draft.activityRange === "lt150") {
      const goalChecked = checkedRadio("f_activityGoal");
      draft.activityGoalConfirmed = goalChecked ? goalChecked.value === "yes" : draft.activityGoalConfirmed;
    } else {
      draft.activityGoalConfirmed = undefined;
    }
  } else if (step === "recovery") {
    draft.sleepHoursRange = val("f_sleepHoursRange") || "";
    draft.bedtimeRange = val("f_bedtimeRange") || "";
    draft.bedtimeExact = val("f_bedtimeExact");
    draft.recoveryPractices = {
      yoga: !!document.getElementById("f_recovery_yoga")?.checked,
      breathing: !!document.getElementById("f_recovery_breathing")?.checked,
      hardening: !!document.getElementById("f_recovery_hardening")?.checked,
      nailBoard: !!document.getElementById("f_recovery_nailBoard")?.checked,
      banya: !!document.getElementById("f_recovery_banya")?.checked,
      massage: !!document.getElementById("f_recovery_massage")?.checked,
      other: !!document.getElementById("f_recovery_other")?.checked,
      otherText: val("f_recovery_otherText") || "",
    };
  } else if (step === "nutrition") {
    draft.waterRange = val("f_waterRange") || "";
    draft.lastMealTimeRange = val("f_lastMealTimeRange") || "";
    draft.mealsPerDayRange = val("f_mealsPerDayRange") || "";
    draft.hoursBetweenMealsRange = val("f_hoursBetweenMealsRange") || "";
    draft.eatingWindowRange = val("f_eatingWindowRange") || "";
    const snacksChecked = checkedRadio("f_snacksHas");
    draft.snacksHas = snacksChecked ? snacksChecked.value === "yes" : undefined;
    draft.supplementsRegularity = val("f_supplementsRegularity") || "";
    const balanceChecked = checkedRadio("f_nutritionBalanceSelf");
    draft.nutritionBalanceSelf = balanceChecked ? balanceChecked.value === "yes" : undefined;
  } else if (step === "habits") {
    draft.cigarettesPerDay = val("f_cigarettesPerDay");
    const vapeChecked = checkedRadio("f_vape");
    draft.vapeHookah = vapeChecked ? vapeChecked.value : draft.vapeHookah;
    draft.alcoholSpirits = val("f_alcoholSpiritsRange") || "";
    draft.alcoholWine = val("f_alcoholWineRange") || "";
    draft.alcoholBeer = val("f_alcoholBeerRange") || "";
    if (Number(draft.cigarettesPerDay) > 0) {
      const goalChecked = checkedRadio("f_smokingGoal");
      draft.smokingGoalConfirmed = goalChecked ? goalChecked.value === "yes" : draft.smokingGoalConfirmed;
    } else {
      draft.smokingGoalConfirmed = undefined;
    }
  } else if (step === "health") {
    const checked = checkedRadio("f_illnessHas");
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

// "Активные годы" (renamed from "Экономия на медицине", TZ section 2
// update): the second chart's methodology is now QALY (Quality-Adjusted
// Life Year — 1.0 = a year in full health, 0 = death, fractional values
// in between), not a currency estimate. TODO: the formula converting
// tracked factors (smoking, activity, later sleep/alcohol) into a QALY
// increment is still an open question — needs real published QALY
// figures per factor, not an invented coefficient. Not implemented yet;
// only the "coming soon" placeholder card below exists until that
// formula is sourced.
// TZ section 8 daily-input category: "Хорошее действие / Плохое действие
// / Личный рекорд". Personal record takes priority over the good/bad
// framing. Phrase choice is seeded by the date (not Math.random()) so it
// stays stable across re-renders of the same day instead of flickering.
function dailyEngagementPhrase(today, todayEntry) {
  if (todayEntry.deltaDays === undefined) return null;
  const priorMax = Object.entries(state.ledger)
    .filter(([date]) => date !== today)
    .reduce((max, [, e]) => Math.max(max, e.deltaDays), -Infinity);
  if (priorMax !== -Infinity && todayEntry.deltaDays > priorMax) {
    return { text: DAILY_RECORD_PHRASE, positive: true };
  }
  const positive = todayEntry.deltaDays >= 0;
  const pool = positive ? DAILY_GOOD_PHRASES : DAILY_BAD_PHRASES;
  return { text: pickPhrase(pool, `${today}:${positive ? "g" : "b"}`), positive };
}

function renderDashboard(screen) {
  const period = state.chartPeriod || "month";
  const series = cumulativeSeries();
  const trend = sevenDayTrend();
  const capitalValue = series.length ? series[series.length - 1].value : 0;

  const today = todayStr();
  const todayEntry = state.ledger[today] || { cigarettes: "", activityMinutes: "" };
  const engagement = dailyEngagementPhrase(today, todayEntry);

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
          <input type="number" min="0" id="log_cigarettes" value="${escapeHtml(todayEntry.cigarettes ?? "")}">
          <div class="hint">Ваша ватерлиния: ${state.smokingWaterline ?? 0} шт.</div>
        </div>
        <div class="field">
          <label>Минут активности сегодня</label>
          <input type="number" min="0" id="log_activity" value="${escapeHtml(todayEntry.activityMinutes ?? "")}">
          <div class="hint">Считается активность, где можно говорить, но не петь (или сложнее) — не медленная прогулка.</div>
        </div>
      </div>
      <button class="btn" id="log-save" style="width:100%">Сохранить</button>
    </div>

    ${
      engagement
        ? `<div class="engagement-card ${engagement.positive ? "positive" : "negative"}">${escapeHtml(engagement.text)}</div>`
        : ""
    }

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
        <div class="name">Активные годы</div>
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
    const deltaDays = dailyDeltaDays(cigarettes, activityMinutes, age, state.smokingWaterline);
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
  const waterline = Number(state.smokingWaterline) || 0;
  if (activity < 30) {
    return "Добавьте 30 минут активности сегодня (в темпе, когда можно говорить, но не петь) — это ощутимый плюс к капиталу, а прирост не теряется вплоть до 90 минут.";
  }
  if (cigarettes > waterline) {
    return `Сегодня выше Вашей ватерлинии (${waterline} шт.) — попробуйте вернуться к ней или ниже, это уже плюс к капиталу.`;
  }
  if (cigarettes < waterline) {
    return "Вы уже ниже своей обычной нормы по курению — это доход в капитал, продолжайте в том же духе.";
  }
  return "Хороший день — активность отмечена, курение на обычном уровне. Так держать.";
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
        const waterline = Number(state.smokingWaterline) || 0;
        const smokingTerm = (waterline - (Number(e.cigarettes) || 0)) * 0.014 * ageMultiplier(Number(state.onboarding.age));
        if (smokingTerm !== 0) {
          const sign = smokingTerm > 0 ? "positive" : "negative";
          const arrow = smokingTerm > 0 ? "+" : "−";
          items.push(
            `<li class="feed-item"><span class="badge"><span class="icon smoke">К</span>Курение: ${e.cigarettes} шт. (ватерлиния ${waterline})</span><span class="amount ${sign}">${arrow}${Math.abs(smokingTerm).toFixed(2)} дн.</span></li>`
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
      <div class="hint" style="margin-bottom:16px;">Идею видите только Вы и команда. Авторство не раскрывается другим пользователям.</div>
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
            <span class="date">${escapeHtml(i.date)}</span>
            <div class="cat">${escapeHtml(i.category)}</div>
            <div>${escapeHtml(i.text)}</div>
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
