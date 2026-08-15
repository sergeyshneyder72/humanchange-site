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

// TZ section 3.4, 11.08.2026: self-rated stress, collected at onboarding
// and daily — data collection only, no formula (causality between
// perceived stress and mortality is contested in the literature; a
// formula is an explicit future task, not this one).
const STRESS_LEVEL_OPTIONS = [
  { value: "1", label: "1 — низкий" },
  { value: "2", label: "2" },
  { value: "3", label: "3 — средний" },
  { value: "4", label: "4" },
  { value: "5", label: "5 — высокий" },
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
    body: "Каждая выкуренная сигарета в среднем стоит около 20 минут ожидаемой продолжительности жизни. Статус «курит» отдельно учитывается один раз при расчёте стартового капитала (около 5.7–7 лет разницы в ожидаемой продолжительности жизни у курящих, по данным когортного исследования). Отдельно от этого число сигарет в день, указанное при онбординге, становится точкой отсчёта для ежедневного портфеля: списание или депозит считается от отклонения от неё — курите сегодня меньше обычного, получаете плюс, больше — минус.",
    source: "Источники: UCL, журнал Addiction (2024/2025); Tsai et al., Aging (Albany NY), 2021 — годы жизни по статусу курения.",
    sourceKeys: ["ucl-smoking", "tsai-aging"],
  },
  {
    key: "sport",
    name: "Физическая активность",
    active: true,
    body: "Час умеренной активности добавляет примерно 6 часов капитала — по данным акселерометров, объективное измерение для наименее активного квартиля населения (эффект вдвое сильнее более ранних оценок именно за счёт точности измерения). Положительный эффект перестаёт расти после 90 минут активности в день. Отдельно недостаточная активность (менее ~150 минут в неделю) сама по себе связана с повышенным на 20–30% риском смерти по сравнению с достаточно активными людьми. Считается только активность, где пульс поднимается минимум на 50% выше уровня покоя — тест разговором: можете говорить, но не петь (или сложнее говорить) — засчитывается; свободно поёте на ходу — нет. Медленная прогулка не в счёт, быстрая ходьба, физический труд или тренировка — да.",
    source: "Источники: Veerman et al., BJSM (2024); D. Spiegelhalter, BMJ (2012); WHO (по риску недостаточной активности); Cleveland Clinic (порог интенсивности, тест разговором).",
    sourceKeys: ["veerman-bjsm", "webmd-walking", "lee-lancet", "spiegelhalter-bmj", "cleveland-clinic", "tsai-aging"],
  },
  {
    key: "sleep",
    name: "Сон",
    active: true,
    body: "Наименьший риск смертности связан со сном 7–8 часов в сутки; как более короткий, так и более длинный сон связаны с повышенным риском. Ежедневно: отклонение от окна 7–8ч даёт грубую дельту капитала, отдельно нормированную для короткого и для длинного сна (три ступени вниз от окна, две вверх) — приблизительная оценка, точная ежедневная методология для сна пока уточняется, в отличие от курения и спорта.",
    source: "Источники: метаанализ Cappuccio и соавт. (~1.3–1.5 млн участников); Tsai et al., Aging (Albany NY), 2021.",
    sourceKeys: ["cappuccio-sleep", "tsai-aging"],
  },
  {
    key: "alcohol",
    name: "Алкоголь",
    active: true,
    body: "Риск, связанный с алкоголем, зависит от дозы и растёт с количеством потребляемого этанола в неделю; безопасного уровня, одинакового для всех, не существует. Ежедневно: сам факт употребления сегодня (источник не даёт дозозависимых дневных данных) даёт грубую дельту капитала — приблизительная оценка, точная ежедневная методология для алкоголя пока уточняется, в отличие от курения и спорта.",
    source: "Источники: обзоры WHO и Lancet (Global Burden of Disease, 2018); Tsai et al., Aging (Albany NY), 2021.",
    sourceKeys: ["tsai-aging"],
  },
  {
    key: "nutrition",
    name: "Питание",
    active: false,
    body: "Раздел в разработке — появится вместе с добавлением фактора питания в капитал здоровья. Отдельно, только как культурный ориентир (не влияет на расчёт капитала): использование БАДов — массовая, нормализованная практика, не маргинальная — например, в Японии пищевые добавки регулярно принимают около 60% здоровых взрослых, 55–70% взрослых пациентов и 32% студентов, по национальным опросам.",
    source: "Источник: национальные опросы по Японии.",
  },
  {
    key: "stress",
    name: "Стресс",
    active: false,
    body: "Раздел в разработке — появится вместе с добавлением фактора стресса в капитал здоровья.",
    source: "Скоро.",
  },
];

// Canonical source list (TZ section 9, 11.08.2026: "обязательная, отдельно
// видимая страница/подраздел Базы знаний... каждый фактор должен вести на
// соответствующий источник"). Implemented as a subsection of the existing
// Knowledge Base screen (TZ explicitly allows "страница/подраздел" — a
// subsection satisfies that), with direct links from this list AND from
// each KNOWLEDGE_BASE card's sourceKeys.
const SOURCES = [
  {
    key: "ucl-smoking",
    label: "Курение (20 мин/сигарету)",
    citation: "Jackson S. et al., UCL, редакционная статья в Addiction (2024/2025)",
    url: "https://www.rcp.ac.uk/news-and-media/news-and-opinion/rcp-responds-to-ucl-research-showing-a-single-cigarette-can-take-20-minutes-off-life-expectancy/",
  },
  {
    key: "lee-lancet",
    label: "Физическая активность и продолжительность жизни",
    citation: "Lee I-M. et al., The Lancet (2012), «Effect of physical inactivity on major non-communicable diseases worldwide»",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3645500/",
  },
  {
    key: "spiegelhalter-bmj",
    label: "Microlife — концепция и методология",
    citation: "Spiegelhalter D., BMJ (2012), «Using speed of ageing and 'microlives'»",
    url: "https://pubmed.ncbi.nlm.nih.gov/23247978/",
  },
  {
    key: "cappuccio-sleep",
    label: "Сон и смертность (метаанализ)",
    citation: "Cappuccio F.P. et al., Sleep (2010); плюс dose-response метаанализ, ~1.5 млн участников (2016)",
    url: "https://pubmed.ncbi.nlm.nih.gov/20469800/",
    url2: "https://www.nature.com/articles/srep21480",
  },
  {
    key: "cleveland-clinic",
    label: "Критерий умеренной физической активности (пульс)",
    citation: "Cleveland Clinic, «What Does Moderate Exercise Mean, Anyway?»",
    url: "https://health.clevelandclinic.org/what-does-moderate-exercise-mean-anyway",
  },
  {
    key: "tsai-aging",
    label: "Перевод hazard ratio в годы жизни (Chiang's life table method) + таблица по 30 факторам риска",
    citation: "Tsai S.P. et al., Aging (2021), «Converting health risks into loss of life years»",
    url: "https://www.aging-us.com/article/203491/text",
  },
  {
    key: "veerman-bjsm",
    label: "Соотношение активность → капитал, 1:6 (основной источник)",
    citation: "Veerman L. et al., British Journal of Sports Medicine (2024), «Physical activity and life expectancy: a life-table analysis» (Griffith University) — данные акселерометра",
    url: "https://www.sciencedaily.com/releases/2024/11/241126215133.htm",
  },
  {
    key: "webmd-walking",
    label: "Дополнительное подтверждение соотношения активности",
    citation: "WebMD (2024), обзор исследования по ходьбе — аналогичное соотношение ≈1:6",
    url: "https://www.webmd.com/fitness-exercise/news/20241115/cm/how-walking-more-could-add-11-years-to-your-life",
  },
];

function sourceLinksHtml(keys) {
  return keys
    .map((k) => SOURCES.find((s) => s.key === k))
    .filter(Boolean)
    .map((s) => {
      const links = [`<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a>`];
      if (s.url2) links.push(`<a href="${escapeHtml(s.url2)}" target="_blank" rel="noopener noreferrer">доп. источник</a>`);
      return links.join(" / ");
    })
    .join(", ");
}

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

// TZ section 12: separate from the Idea Fund — product suggestions go
// there, technical problems and questions to the team go here.
const CARE_CATEGORIES = ["Техническая проблема", "Вопрос к команде"];

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
  const illnessPct = illnessAdjustmentPct(ob);
  const yearsLostPct = baselineYears > 0 ? tsaiYearsLostTotal(ob) / baselineYears : 0;
  const combinedPct = (1 + illnessPct) * (1 - yearsLostPct) - 1;
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
    onboardingWelcomeAccepted: false, // gates the pre-step-1 welcome/consent screen, TZ section 1 item 6
    startingCapitalDays: null,
    smokingWaterline: 0, // reference point for the daily smoking factor, set once at onboarding
    createdAt: null,
    ledger: {}, // { 'YYYY-MM-DD': { cigarettes, activityMinutes } }
    ideas: [],
    careRequests: [], // TZ section 12: technical problems / questions to the team, separate from Идея Fund
    nav: "dashboard",
    ideasTab: "new",
    careTab: "new",
    careSection: "support", // outer tab within the merged "Забота" screen, TZ section 11, 13.08.2026
    recalcMode: false, // true while re-running onboarding from the Profile screen's "official recalc" (TZ section 7, 11.08.2026)
    decayCharges: [], // append-only inactivity-decay events against sphere dividends, see applyInactivityDecay
    historyMonth: null, // "YYYY-MM" currently viewed in the История calendar, defaults to the current month when unset
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

function illnessAdjustmentPct(ob) {
  return ob.illnessHas === true ? -0.15 : 0;
}

// TODO(methodology, flagged 11.08.2026): illnessAdjustmentPct still
// applies a literature relative-risk figure as a direct percentage of
// remaining life-expectancy years, which isn't how RR actually converts
// into a life-expectancy change (needs actuarial recalculation via
// survival curves, not linear multiplication). Smoking and activity don't
// have this problem — see tsaiYearsLostTotal() below, sourced from real
// years-of-life-lost data (Tsai et al. 2021) instead of a converted RR.
// Sleep and alcohol don't either, but for a different reason: they moved
// to the daily bucket-coefficient/binary mechanic (TZ section 3.3, see
// dailySleepDelta/dailyAlcoholDelta below) — its own disclosed rough
// approximation, not this issue. Region (regionAdjustmentPct) was never
// the same issue — it scales by an actual life-expectancy-YEARS ratio
// between countries. Do not invent the illness conversion yourself — no
// sourced years-lost figure for it yet.

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

// Smoking and activity are the only factors left here (TZ section 3.3,
// 11.08.2026): sleep and alcohol's one-time onboarding contribution was
// REMOVED, not kept alongside their new daily mechanic — replaces,
// doesn't add, same principle as smoking's onboarding value being a pure
// reference point rather than a separate standing penalty. See
// dailySleepDelta/dailyAlcoholDelta below for where they live now.
function tsaiYearsLostTotal(ob) {
  const smokingYears = Number(ob.cigarettesPerDay) > 0 ? yearsLostForGender("smoking", ob.gender) : 0;
  // Approximation, NOT from the source: the paper measures inactivity in
  // MET-hours/week (<3.75 vs a >=7.5 reference); we only collect WHO
  // minutes/week buckets. "lt150" is used as a working proxy for the
  // paper's inactivity threshold, not a verified unit conversion.
  const activityProvided = ACTIVITY_RANGE_OPTIONS.some((o) => o.value === ob.activityRange);
  const activityYears = activityProvided && ob.activityRange === "lt150" ? yearsLostForGender("activity", ob.gender) : 0;
  return smokingYears + activityYears;
}

// One-time starting capital, computed at the end of onboarding (TZ
// section 1-2, updated 11.08.2026 per Source_Chiang_Tsai_2021.md).
// Years-lost factors (smoking, activity) are subtracted directly from
// baseline years first — that's the Chiang/Tsai formula shape
// (Капитал(лет) = Базовая − Σyears_lost). Region and illness stay on the
// older percentage-multiplier mechanism (still on the methodology TODO
// above) and are applied to what's left after the years-lost subtraction.
function computeStartingCapitalDays(ob) {
  const baselineYears = interpolateLifeExpectancyYears(ob.gender, ob.age);

  const regionPct = regionAdjustmentPct(ob.region);
  const illnessPct = illnessAdjustmentPct(ob);

  const yearsLost = tsaiYearsLostTotal(ob);
  const yearsAfterLost = baselineYears - yearsLost;

  const days = yearsAfterLost * 365.25 * (1 + regionPct) * (1 + illnessPct);

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
// existing, only deviations from it do. No age multiplier (TZ section
// 3.1, 13.08.2026, per David Spiegelhalter: no age-specific source
// backed the old ×1.0-1.8 curve, and a Beijing cohort found the
// opposite direction — HR higher in younger smokers — so a flat rate
// is the honest choice, not invented age scaling). Activity ratio is
// 1:6 (TZ section 3.2, 13.08.2026, Veerman et al. BJSM 2024 accelerometer
// data — replaces the earlier temporary 1:3 Spiegelhalter estimate),
// daily cap 90 min / 9 hours.
function dailyDeltaDays(cigarettesToday, activityMinutesToday, smokingWaterline) {
  const waterline = Number(smokingWaterline) || 0;
  const today = Number(cigarettesToday) || 0;
  const smokingTerm = (waterline - today) * 0.014;
  const activityGain = Math.min((Number(activityMinutesToday) || 0) / 60 * 6, 9) / 24;
  return activityGain + smokingTerm;
}

// Sleep/alcohol daily deviation coefficients (TZ section 3.3, 11.08.2026,
// explicit numbers from product): bucket lookup, not hours directly —
// normalized SEPARATELY on each side of the 7-8h optimum (3 buckets
// below it, 2 above), not one symmetric curve.
const SLEEP_DAILY_COEFFICIENT = {
  lt5: 1.0,
  "5to6": 0.67,
  "6to7": 0.33,
  "7to8": 0,
  "8to9": 0.5,
  gt9: 1.0,
};

// Sleep and alcohol moved from a one-time onboarding contribution to a
// daily active factor (TZ section 3.3, 11.08.2026) — replacing that
// one-time contribution entirely (removed from tsaiYearsLostTotal above),
// not stacking with it. Explicitly a ROUGH approximation per the spec:
// divides the Tsai one-time years-lost anchor by 365 and scales by
// today's bucket coefficient — that anchor was never validated as a
// daily rate, this is a disclosed placeholder, not the same evidence
// grade as smoking/sport's per-cigarette/per-minute figures. Must ship
// with a visible UI warning, not buried in fine print — see the log-card
// hint in renderDashboard.
function dailySleepDelta(sleepHoursRangeToday, gender) {
  const coeff = SLEEP_DAILY_COEFFICIENT[sleepHoursRangeToday];
  if (!coeff) return 0;
  return -((yearsLostForGender("longSleep", gender) / 365) * coeff);
}

// Binary, not dose-scaled (TZ section 3.3): the Tsai source has no
// dose-response data for alcohol, so "drank today" (any of the 3 fields
// above its "0" bucket, same check as isRegularDrinkerApprox) applies the
// full daily-equivalent anchor; not drinking is neutral, no deposit.
// Same rough-approximation caveat as dailySleepDelta above.
function dailyAlcoholDelta(spiritsToday, wineToday, beerToday, gender) {
  const drankToday = isRegularDrinkerApprox({
    alcoholSpirits: spiritsToday,
    alcoholWine: wineToday,
    alcoholBeer: beerToday,
  });
  if (!drankToday) return 0;
  return -(yearsLostForGender("alcohol", gender) / 365);
}

// Monday of the ISO week containing dateStr ('YYYY-MM-DD'). Parses and
// formats entirely in UTC (not local time) — 'YYYY-MM-DD' here is an
// abstract calendar label, the same convention todayStr()'s
// toISOString()-based formatting already uses for ledger keys. Mixing a
// local-time parse with a UTC-formatted result shifts the date by a day
// for any user east of UTC (confirmed: Europe/Moscow, UTC+3) — this is
// the same class of local/UTC mismatch, just caught before it shipped.
function mondayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

function weekDatesFrom(mondayStr) {
  const start = new Date(mondayStr + "T00:00:00Z");
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// Weekly activity catch-up (TZ section 3.2, 10.08.2026): the daily 90-min
// cap loses minutes for someone who trains hard 2-3x/week rather than a
// little every day. On Sunday, compare the week's RAW (uncapped) activity
// minutes against what daily entries already credited (each still capped
// at 90 min/day) and pay out the difference, capped at 630 (=90×7) raw
// minutes for the week. Only triggers on Sunday saves — a week with no
// Sunday entry never gets its catch-up, an accepted limitation of this
// manual, once-per-save client-only app (no background job to run it
// retroactively). Always >= 0: the cap only ever trims, never inflates.
function weeklyActivityTopUpDays(sundayDateStr) {
  const monday = mondayOfWeek(sundayDateStr);
  let rawMinutes = 0;
  let creditedMinutes = 0;
  for (const date of weekDatesFrom(monday)) {
    const entry = state.ledger[date];
    if (!entry) continue;
    const minutes = Number(entry.activityMinutes) || 0;
    rawMinutes += minutes;
    creditedMinutes += Math.min(minutes, 90);
  }
  const weeklyEffective = Math.min(rawMinutes, 630);
  const topUpMinutes = Math.max(0, weeklyEffective - creditedMinutes);
  return ((topUpMinutes / 60) * 6) / 24;
}

function sortedLedgerDates() {
  return Object.keys(state.ledger).sort();
}

// Inactivity-decay charge on sphere dividends (TZ section 7, 11.08.2026,
// "Отчёт" — currently only sphere is "sport"). Design decision (12.08.2026,
// answering the open fork on how this should be recorded): append-only,
// one event per newly-crossed threshold, each holding the MARGINAL percentage
// since the last threshold reached in the current unbroken inactivity run —
// so a full 7→14→21→28-day run's events sum to exactly -50%, not -97%.
// Explicitly NOT folded into deltaDays/the main capital ledger — per TZ,
// this erodes the separately-tracked sphere dividends pool only, never the
// main "Портфель"/"Личные накопления" total.
const DECAY_TIERS = [
  { days: 7, pct: 7 },
  { days: 14, pct: 15 },
  { days: 21, pct: 25 },
  { days: 28, pct: 50 },
];

// Consecutive days up to and including uptoDateStr with no logged
// activityMinutes > 0, counting back no further than state.createdAt.
function daysSinceLastActivity(uptoDateStr) {
  let count = 0;
  let d = new Date(uptoDateStr + "T00:00:00Z");
  const minDate = new Date((state.createdAt || uptoDateStr) + "T00:00:00Z");
  while (d >= minDate) {
    const ds = d.toISOString().slice(0, 10);
    const entry = state.ledger[ds];
    if (entry && Number(entry.activityMinutes) > 0) break;
    count++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return count;
}

function sportDividendsLast30Days(uptoDateStr) {
  const cutoff = new Date(uptoDateStr + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 29);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return Object.entries(state.ledger)
    .filter(([date]) => date >= cutoffStr && date <= uptoDateStr)
    .reduce((sum, [, e]) => sum + (e.weeklyBonusDays || 0), 0);
}

// Called on every daily log save (mirrors how the weekly top-up is only
// evaluated at save time, not via a background job — same accepted
// limitation as weeklyActivityTopUpDays above). Appends zero or more new
// decayCharges rows for tiers newly crossed since the current streak began.
function applyInactivityDecay(today) {
  const streak = daysSinceLastActivity(today);
  if (streak === 0) return;
  const streakStart = new Date(today + "T00:00:00Z");
  streakStart.setUTCDate(streakStart.getUTCDate() - (streak - 1));
  const streakStartDate = streakStart.toISOString().slice(0, 10);

  const chargedThisStreak = state.decayCharges.filter((c) => c.sphere === "sport" && c.streakStartDate === streakStartDate);
  let highestChargedPct = chargedThisStreak.reduce((max, c) => Math.max(max, c.pct), 0);
  const dividendsBase = sportDividendsLast30Days(today);

  for (const tier of DECAY_TIERS) {
    if (streak >= tier.days && tier.pct > highestChargedPct) {
      const marginalPct = tier.pct - highestChargedPct;
      state.decayCharges.push({
        date: today,
        sphere: "sport",
        streakStartDate,
        days: tier.days,
        pct: tier.pct,
        marginalPct,
        amountDays: dividendsBase * (marginalPct / 100),
      });
      highestChargedPct = tier.pct;
    }
  }
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
  if (state.recalcMode) {
    // "Official recalc" (TZ section 7, 11.08.2026) re-runs the same 6-step
    // wizard pre-filled with the current answers — welcome/consent is
    // already accepted, so this bypasses it and goes straight to step 1.
    renderOnboarding();
  } else if (!state.onboarding) {
    if (!state.onboardingWelcomeAccepted) {
      renderWelcomeScreen();
    } else {
      renderOnboarding();
    }
  } else {
    renderApp();
  }
}

/* ---- Onboarding ---- */

// Pre-step-1 welcome/consent screen (TZ section 1, item 6, 11.08.2026).
// Not one of the 6 form steps — no progress dots — a plain text screen
// that covers three requirements in one place: welcome/question-count
// framing, data-collection consent (TZ section 13's minimal notice for
// this pilot), and the playful-number disclaimer (TZ section 5). Text is
// the TZ's own draft, not paraphrased. "Начать" stays disabled until the
// checkbox is checked — this is the only gate; nothing here is saved to
// state.onboarding, only the acceptance flag.
function renderWelcomeScreen() {
  root.innerHTML = `
    <div class="wrap">
      <div class="onboarding-header">
        <h1>Добро пожаловать в «Капитал здоровья»</h1>
        <p>Пять обязательных вопросов, и ещё несколько — по желанию. Чем больше заполните, тем точнее будет результат.</p>
      </div>
      <p>Мы собираем эти данные, чтобы рассчитать Ваш персональный капитал здоровья. Сейчас всё хранится локально на Вашем устройстве и никуда не передаётся.</p>
      <p>Это статистическая оценка на основе научных исследований — не медицинский диагноз и не прогноз лично для Вас.</p>
      <div class="field">
        <label class="checkbox-row"><input type="checkbox" id="welcome-consent"> Я прочитал(а) и согласен(на)</label>
      </div>
      <button class="btn" id="welcome-start" style="width:100%" disabled>Начать →</button>
    </div>
  `;
  const checkbox = document.getElementById("welcome-consent");
  const startBtn = document.getElementById("welcome-start");
  checkbox.addEventListener("change", () => {
    startBtn.disabled = !checkbox.checked;
  });
  startBtn.addEventListener("click", () => {
    state.onboardingWelcomeAccepted = true;
    saveState();
    render();
  });
}

// TZ section 1, 10.08.2026 restructure: 6 input steps (was 7) — "body"
// and "activity" merged into one step, "nutrition" is new, "smoking" and
// "alcohol" merged into one "habits" step — plus the "reveal" result.
const ONBOARDING_STEPS = ["basics", "activity_form", "recovery", "nutrition", "habits", "health", "reveal"];

function reqMark() {
  return `<span class="required-mark">*</span>`;
}

// TZ section 1, item 8 (11.08.2026): long field explanations stay
// collapsed behind an "ⓘ" by default, expand on tap — screen density fix
// so "Далее" fits without scrolling. Native <details>/<summary> gives
// expand/collapse for free, no JS wiring needed.
function collapsibleHint(text) {
  return `<details class="hint-details"><summary>ⓘ</summary><div class="hint">${text}</div></details>`;
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
        <h1>Основные данные</h1>
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
        ${collapsibleHint("Считается только активность, поднимающая пульс минимум на 50% выше уровня покоя (Cleveland Clinic) — тест разговором: можете говорить, но не петь — считается, свободно поёте — нет. Медленная прогулка не в счёт.")}
      </div>
      <div class="field" id="f_activityGoalBlock" style="display:${draft.activityRange === "lt150" ? "block" : "none"}">
        <label>Хотите начать регулярно двигаться? ${reqMark()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_activityGoal" value="yes" ${draft.activityGoalConfirmed === true ? "checked" : ""}> Да, хочу</label>
          <label><input type="radio" name="f_activityGoal" value="no" ${draft.activityGoalConfirmed === false ? "checked" : ""}> Не сейчас</label>
        </div>
      </div>
      <div class="field">
        <label>Вес, кг</label>
        <input type="number" id="f_weight" value="${escapeHtml(draft.weight ?? "")}">
      </div>
      <div class="field">
        <label>Рост, см</label>
        <input type="number" id="f_height" value="${escapeHtml(draft.height ?? "")}">
      </div>
      <div class="field">
        <label>Объём талии</label>
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
        <label>Среднее количество часов сна</label>
        <select id="f_sleepHoursRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(SLEEP_HOURS_RANGE_OPTIONS, draft.sleepHoursRange)}
        </select>
      </div>
      <div class="field">
        <label>Обычное время отхода ко сну</label>
        <select id="f_bedtimeRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(BEDTIME_RANGE_OPTIONS, draft.bedtimeRange)}
        </select>
        <input type="time" id="f_bedtimeExact" value="${escapeHtml(draft.bedtimeExact ?? "")}" style="margin-top:8px; display:${draft.bedtimeRange === "custom" ? "block" : "none"}">
      </div>
      <div class="field">
        <label>Практики восстановления</label>
        <div class="checkbox-list">
          ${RECOVERY_PRACTICES.map(
            (p) =>
              `<label class="checkbox-row"><input type="checkbox" id="f_recovery_${p.key}" ${draft.recoveryPractices?.[p.key] ? "checked" : ""}> ${p.label}</label>`
          ).join("")}
          <label class="checkbox-row"><input type="checkbox" id="f_recovery_other" ${draft.recoveryPractices?.other ? "checked" : ""}> Другое</label>
          <input type="text" id="f_recovery_otherText" placeholder="Что именно?" value="${escapeHtml(draft.recoveryPractices?.otherText ?? "")}">
        </div>
      </div>
      <div class="field">
        <label>Уровень стресса</label>
        <select id="f_stressLevel">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(STRESS_LEVEL_OPTIONS, draft.stressLevel)}
        </select>
      </div>
    `;
  } else if (step === "nutrition") {
    body = `
      <div class="onboarding-header">
        <h1>Питание</h1>
      </div>
      <div class="field">
        <label>Объём чистой воды в сутки</label>
        <select id="f_waterRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(WATER_RANGE_OPTIONS, draft.waterRange)}
        </select>
      </div>
      <div class="field">
        <label>Время последнего приёма пищи</label>
        <select id="f_lastMealTimeRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(LAST_MEAL_TIME_OPTIONS, draft.lastMealTimeRange)}
        </select>
      </div>
      <div class="field">
        <label>Количество приёмов пищи в день</label>
        <select id="f_mealsPerDayRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(MEALS_PER_DAY_OPTIONS, draft.mealsPerDayRange)}
        </select>
      </div>
      <div class="field">
        <label>Часы между приёмами пищи (в среднем)</label>
        <select id="f_hoursBetweenMealsRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(HOURS_BETWEEN_MEALS_OPTIONS, draft.hoursBetweenMealsRange)}
        </select>
      </div>
      <div class="field">
        <label>Окно между первым и последним приёмом пищи</label>
        <select id="f_eatingWindowRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(EATING_WINDOW_OPTIONS, draft.eatingWindowRange)}
        </select>
      </div>
      <div class="field">
        <label>Перекусы бывают?</label>
        <div class="radio-row">
          <label><input type="radio" name="f_snacksHas" value="yes" ${draft.snacksHas === true ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_snacksHas" value="no" ${draft.snacksHas === false ? "checked" : ""}> Нет</label>
        </div>
      </div>
      <div class="field">
        <label>БАДы — регулярность приёма</label>
        <select id="f_supplementsRegularity">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(SUPPLEMENTS_REGULARITY_OPTIONS, draft.supplementsRegularity)}
        </select>
      </div>
      <div class="field">
        <label>Считаете своё питание сбалансированным?</label>
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
        <label>Вейп / кальян — используете?</label>
        <div class="radio-row">
          <label><input type="radio" name="f_vape" value="yes" ${draft.vapeHookah === "yes" ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_vape" value="no" ${draft.vapeHookah === "no" ? "checked" : ""}> Нет</label>
        </div>
      </div>
      <div class="field">
        <label>Крепкий алкоголь, мл/нед</label>
        <select id="f_alcoholSpiritsRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(ALCOHOL_SPIRITS_RANGE_OPTIONS, draft.alcoholSpirits)}
        </select>
      </div>
      <div class="field">
        <label>Вино, мл/нед</label>
        <select id="f_alcoholWineRange">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(ALCOHOL_WINE_RANGE_OPTIONS, draft.alcoholWine)}
        </select>
      </div>
      <div class="field">
        <label>Пиво и слабоалкогольные коктейли</label>
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
        <label>Есть ли серьёзные заболевания?</label>
        <div class="radio-row">
          <label><input type="radio" name="f_illnessHas" value="yes" ${draft.illnessHas === true ? "checked" : ""}> Да</label>
          <label><input type="radio" name="f_illnessHas" value="no" ${draft.illnessHas === false ? "checked" : ""}> Нет</label>
        </div>
      </div>
      <div class="field">
        <label>Уточнение</label>
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
      <div class="disclaimer">Усреднённая статистическая оценка по данным людей схожего профиля — возраст, пол, регион и другие показатели (не точный расчёт для Вас лично) — на основе научных исследований, не медицинский диагноз и не персональная рекомендация. Если у Вас есть реальные проблемы со здоровьем — обратитесь к врачу.</div>
      <button class="btn" id="finish-onboarding" style="width:100%">${state.recalcMode ? "Сохранить пересчёт" : "Перейти в приложение"}</button>
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
      const wasRecalc = state.recalcMode;
      state.onboarding = draft;
      state.startingCapitalDays = revealDays;
      state.smokingWaterline = Number(draft.cigarettesPerDay) || 0;
      state.createdAt = state.createdAt || todayStr();
      state.onboardingStep = null;
      state.onboardingDraft = null;
      state.recalcMode = false;
      if (wasRecalc) state.nav = "profile";
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
    draft.stressLevel = val("f_stressLevel") || "";
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

// Same "count up/down" pattern as animateRevealNumber's onboarding
// reveal, applied to the dashboard capital number after a daily save
// (12.08.2026 fix) so it visibly rolls from the old total to the new
// one instead of jumping instantly.
function animateCapitalValue(el, from, to, duration = 1200) {
  if (!el) return;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = from + (to - from) * eased;
    el.textContent = formatDays(current);
    el.className = `capital-value ${current >= 0 ? "positive" : "negative"}`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---- Main app shell ---- */

// TZ section 7, 13.08.2026: navigation finalized, replaces every earlier
// draft (top tab bar, separate "Отчёт" tab, separate "Фонд идей" tab).
// Bottom nav is icon-only — the open section's own <h2> (already the
// existing pattern on every screen below) is what tells the user where
// they are, not a label on the nav button itself. Top-right keeps only
// the notification bell and profile icon; neither is a "tab" — clicking
// either just navigates on top of whatever bottom-nav section was last
// open, same non-active-highlighting behavior the profile icon already
// had before this restructuring.
const BOTTOM_NAV_ITEMS = [
  { nav: "dashboard", icon: "🏠", label: "Портфель" },
  { nav: "history", icon: "📅", label: "История" },
  { nav: "knowledge", icon: "📖", label: "База знаний" },
  { nav: "care", icon: "💬", label: "Забота" },
  { nav: "settings", icon: "⚙️", label: "Настройки" },
];

function renderApp() {
  const nav = state.nav || "dashboard";
  root.innerHTML = `
    <div class="top-bar">
      <div class="top-icons">
        <button class="icon-btn" id="bell-btn" aria-label="Уведомления" title="Уведомления">🔔</button>
        <button class="icon-btn" id="profile-btn" aria-label="Профиль" title="Профиль">👤</button>
      </div>
    </div>
    <div class="wrap" id="screen"></div>
    <nav class="bottom-nav">
      ${BOTTOM_NAV_ITEMS.map(
        (item) =>
          `<button data-nav="${item.nav}" class="icon-nav-btn ${nav === item.nav ? "active" : ""}" aria-label="${item.label}" title="${item.label}">${item.icon}</button>`
      ).join("")}
    </nav>
  `;
  root.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.nav = btn.dataset.nav;
      saveState();
      render();
    });
  });
  document.getElementById("profile-btn").addEventListener("click", () => {
    state.nav = "profile";
    saveState();
    render();
  });
  // Bell (TZ section 7, 13.08.2026): UI element only for now — what
  // generates notifications is an explicitly open future question (push
  // reminders are backlogged separately, TZ section 6). No fake unread
  // badge since there's no real source yet to count.
  document.getElementById("bell-btn").addEventListener("click", () => {
    state.nav = "notifications";
    saveState();
    render();
  });

  const screen = document.getElementById("screen");
  if (nav === "dashboard") renderDashboard(screen);
  else if (nav === "history") renderHistory(screen);
  else if (nav === "knowledge") renderKnowledge(screen);
  else if (nav === "care") renderCare(screen);
  else if (nav === "settings") renderSettings(screen);
  else if (nav === "profile") renderProfile(screen);
  else if (nav === "notifications") renderNotifications(screen);
  // Fallback for any stale state.nav value from before this
  // restructuring (e.g. old "report"/"ideas" persisted in a returning
  // user's localStorage) — those screens no longer exist as standalone
  // destinations, so land on the dashboard rather than render nothing.
  else renderDashboard(screen);
}

function renderSettings(screen) {
  screen.innerHTML = `<h2>Настройки</h2><div class="empty-state">Раздел в разработке.</div>`;
}

function renderNotifications(screen) {
  screen.innerHTML = `<h2>Уведомления</h2><div class="empty-state">Уведомлений пока нет.</div>`;
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
    <h2>Портфель</h2>
    <div class="capital-header">
      <div class="capital-value ${capitalValue >= 0 ? "positive" : "negative"}">${formatDays(capitalValue)}</div>
      <div class="capital-trend ${trend >= 0 ? "positive" : "negative"}">${trend >= 0 ? "▲" : "▼"} ${formatDays(Math.abs(trend))} за 7 дней</div>
    </div>
    <div class="disclaimer">Усреднённая статистическая оценка по данным людей схожего профиля — не точный расчёт для Вас лично, не медицинский диагноз.</div>

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
      <div class="kicker">Итог дня</div>
      <div>${todaySummary(todayEntry)}</div>
    </div>

    <div class="log-card">
      <h3>Отметить сегодня</h3>
      <div class="log-row">
        <div class="field">
          <label>Сигарет сегодня</label>
          <input type="number" min="0" id="log_cigarettes" value="${escapeHtml(todayEntry.cigarettes ?? "")}">
          <div class="hint">Ваша обычная норма: ${state.smokingWaterline ?? 0} шт.</div>
        </div>
        <div class="field">
          <label>Минут активности сегодня</label>
          <input type="number" min="0" id="log_activity" value="${escapeHtml(todayEntry.activityMinutes ?? "")}">
          <div class="hint">Считается активность, где можно говорить, но не петь (или сложнее) — не медленная прогулка.</div>
        </div>
      </div>
      <div class="field">
        <label>Сон прошлой ночью</label>
        <select id="log_sleep">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(SLEEP_HOURS_RANGE_OPTIONS, todayEntry.sleepHoursRange)}
        </select>
      </div>
      <div class="log-row">
        <div class="field">
          <label>Крепкий алкоголь сегодня</label>
          <select id="log_alcohol_spirits">
            <option value="">Выбрать...</option>
            ${selectOptionsHtml(ALCOHOL_SPIRITS_RANGE_OPTIONS, todayEntry.alcoholSpirits)}
          </select>
        </div>
        <div class="field">
          <label>Вино сегодня</label>
          <select id="log_alcohol_wine">
            <option value="">Выбрать...</option>
            ${selectOptionsHtml(ALCOHOL_WINE_RANGE_OPTIONS, todayEntry.alcoholWine)}
          </select>
        </div>
      </div>
      <div class="field">
        <label>Пиво/слабоалкогольное сегодня</label>
        <select id="log_alcohol_beer">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(ALCOHOL_BEER_RANGE_OPTIONS, todayEntry.alcoholBeer)}
        </select>
      </div>
      <div class="methodology-warning">Приблизительная оценка — точная ежедневная методология для сна и алкоголя пока уточняется, в отличие от курения и спорта, где методология уже проверена.</div>
      <div class="field">
        <label>Уровень стресса сегодня</label>
        <select id="log_stress">
          <option value="">Выбрать...</option>
          ${selectOptionsHtml(STRESS_LEVEL_OPTIONS, todayEntry.stressLevel)}
        </select>
        <div class="hint">Пока только сбор данных — на расчёт капитала не влияет.</div>
      </div>
      <button class="btn" id="log-save" style="width:100%">Сохранить</button>
    </div>

    ${
      engagement
        ? `<div class="engagement-card ${engagement.positive ? "positive" : "negative"}">${escapeHtml(engagement.text)}</div>`
        : ""
    }

    <div class="factor-grid">
      ${["Курение", "Спорт", "Сон", "Алкоголь"]
        .map(
          (n) => `<div class="factor-card">
            <div class="name">${n}</div>
            <div class="hint">Активный фактор</div>
          </div>`
        )
        .join("")}
      ${["Питание", "Стресс"]
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
    const seriesBefore = cumulativeSeries();
    const oldCapitalValue = seriesBefore.length ? seriesBefore[seriesBefore.length - 1].value : 0;
    const cigarettes = Number(document.getElementById("log_cigarettes").value) || 0;
    const activityMinutes = Number(document.getElementById("log_activity").value) || 0;
    const sleepHoursRange = document.getElementById("log_sleep").value;
    const alcoholSpirits = document.getElementById("log_alcohol_spirits").value;
    const alcoholWine = document.getElementById("log_alcohol_wine").value;
    const alcoholBeer = document.getElementById("log_alcohol_beer").value;
    const stressLevel = document.getElementById("log_stress").value;
    const gender = state.onboarding.gender;
    const baseDelta = dailyDeltaDays(cigarettes, activityMinutes, state.smokingWaterline);
    const sleepDelta = dailySleepDelta(sleepHoursRange, gender);
    const alcoholDelta = dailyAlcoholDelta(alcoholSpirits, alcoholWine, alcoholBeer, gender);
    const deltaDays = baseDelta + sleepDelta + alcoholDelta;
    state.ledger[today] = {
      cigarettes,
      activityMinutes,
      sleepHoursRange,
      alcoholSpirits,
      alcoholWine,
      alcoholBeer,
      stressLevel,
      deltaDays,
      sleepDelta,
      alcoholDelta,
    };
    // Weekly catch-up (TZ section 3.2) only evaluates on Sunday saves —
    // today's entry must already be in state.ledger (set above) so its
    // own minutes count toward the week's raw sum.
    if (new Date(today + "T00:00:00").getDay() === 0) {
      const bonus = weeklyActivityTopUpDays(today);
      if (bonus > 0) {
        state.ledger[today].weeklyBonusDays = bonus;
        state.ledger[today].deltaDays += bonus;
      }
    }
    // Inactivity-decay on sphere dividends (TZ section 7, "Отчёт") — does
    // NOT touch deltaDays/the main capital, see applyInactivityDecay.
    applyInactivityDecay(today);
    saveState();
    renderDashboard(screen);
    const seriesAfter = cumulativeSeries();
    const newCapitalValue = seriesAfter.length ? seriesAfter[seriesAfter.length - 1].value : 0;
    animateCapitalValue(screen.querySelector(".capital-value"), oldCapitalValue, newCapitalValue);
  });
}

function formatDays(value) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)} дн.`;
}

// "Итог дня" (renamed from "Следующий шаг", TZ section 8, 11.08.2026):
// this was always a reaction to today's already-entered data, not a
// forward-looking recommendation — the old name didn't match the
// content. Smoking branches now react to deviation from the waterline
// (never named to the user, see dailyDeltaDays) instead of an absolute
// count: below it is praised, above it gets a no-blame note, and AT it
// — including 0=0 for non-smokers — smoking isn't mentioned at all, per
// TZ's explicit fix for the old "курение на обычном уровне" phrasing
// that read oddly for someone who's never smoked.
function todaySummary(todayEntry) {
  const activity = Number(todayEntry.activityMinutes) || 0;
  const cigarettes = Number(todayEntry.cigarettes) || 0;
  const waterline = Number(state.smokingWaterline) || 0;
  if (activity < 30) {
    return "Добавьте 30 минут активности сегодня (в темпе, когда можно говорить, но не петь) — это ощутимый плюс к капиталу, а прирост не теряется вплоть до 90 минут.";
  }
  if (cigarettes < waterline) {
    return "Меньше обычного — засчитано.";
  }
  if (cigarettes > waterline) {
    return "Больше обычного — бывает, завтра продолжим.";
  }
  return "Активность отмечена — так держать.";
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
        const smokingTerm = (waterline - (Number(e.cigarettes) || 0)) * 0.014;
        if (smokingTerm !== 0) {
          const sign = smokingTerm > 0 ? "positive" : "negative";
          const arrow = smokingTerm > 0 ? "+" : "−";
          items.push(
            `<li class="feed-item"><span class="badge"><span class="icon smoke">К</span>Курение: ${e.cigarettes} шт.</span><span class="amount ${sign}">${arrow}${Math.abs(smokingTerm).toFixed(2)} дн.</span></li>`
          );
        }
        if (e.activityMinutes > 0) {
          const gain = Math.min((e.activityMinutes / 60) * 6, 9) / 24;
          items.push(
            `<li class="feed-item"><span class="badge"><span class="icon sport">С</span>Активность: ${e.activityMinutes} мин.</span><span class="amount positive">+${gain.toFixed(2)} дн.</span></li>`
          );
        }
        if (e.weeklyBonusDays > 0) {
          items.push(
            `<li class="feed-item"><span class="badge"><span class="icon sport">С</span>Недельная доплата за спорт</span><span class="amount positive">+${e.weeklyBonusDays.toFixed(2)} дн.</span></li>`
          );
        }
        if (e.sleepDelta) {
          const sleepLabel = rangeLookup(SLEEP_HOURS_RANGE_OPTIONS, e.sleepHoursRange, "label") || "";
          items.push(
            `<li class="feed-item"><span class="badge"><span class="icon sleep">Сн</span>Сон: ${escapeHtml(sleepLabel)}</span><span class="amount negative">−${Math.abs(e.sleepDelta).toFixed(2)} дн.</span></li>`
          );
        }
        if (e.alcoholDelta) {
          items.push(
            `<li class="feed-item"><span class="badge"><span class="icon alcohol">А</span>Алкоголь сегодня</span><span class="amount negative">−${Math.abs(e.alcoholDelta).toFixed(2)} дн.</span></li>`
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
      <div class="kb-card ${item.active || item.note ? "" : "disabled"}">
        <div class="name">${item.name}${
          item.active
            ? ""
            : item.note
            ? ` <span class="optional-badge">${escapeHtml(item.note)}</span>`
            : ' <span class="optional-badge">скоро</span>'
        }</div>
        <div>${item.body}</div>
        <div class="source">${item.source}</div>
        ${item.sourceKeys ? `<div class="source">${sourceLinksHtml(item.sourceKeys)}</div>` : ""}
      </div>`
    ).join("")}

    <h2>Что почитать</h2>
    <ul class="reading-list">
      ${READING_LIST.map((r) => `<li>${r}</li>`).join("")}
    </ul>

    <h2>Источники</h2>
    <div class="note">Полный список научных источников, на которых основана модель — с прямыми ссылками. Пополняется по мере добавления новых факторов.</div>
    <ul class="reading-list">
      ${SOURCES.map(
        (s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a> — ${escapeHtml(s.citation)}${
          s.url2 ? ` (<a href="${escapeHtml(s.url2)}" target="_blank" rel="noopener noreferrer">доп. ссылка</a>)` : ""
        }</li>`
      ).join("")}
    </ul>

    <h2>Что впереди</h2>
    <div class="note">Счётчики голосов ниже — пример визуализации; реальная агрегация предложений ведётся командой вручную (см. «Забота» → «Предложить идею»).</div>
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

// TZ section 11, 13.08.2026: "Фонд идей" and "Служба заботы" merged into
// one nav entry ("Забота") with two sections inside — 5 separate nav
// entries felt like one too many. Mechanics (voting, authorship privacy,
// local-only storage) are unchanged, only the navigation container
// changed, so renderCareIdeas/renderCareSupport below are the same
// new/mine tab logic that used to live directly in renderIdeas/renderCare.
function renderCareIdeas(container) {
  const tab = state.ideasTab || "new";
  container.innerHTML = `
    <div class="section-tabs">
      <button data-tab="new" class="${tab === "new" ? "active" : ""}">Новая идея</button>
      <button data-tab="mine" class="${tab === "mine" ? "active" : ""}">Ваши идеи</button>
    </div>
    <div id="ideas-content"></div>
  `;
  container.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.ideasTab = btn.dataset.tab;
      saveState();
      renderCareIdeas(container);
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
      renderCareIdeas(container);
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

// Deliberately separate storage from the ideas above: product
// suggestions go through "Предложить идею" (TZ section 11), technical
// problems and questions to the team go here — own category list, own
// history tab, not shared state with ideas.
function renderCareSupport(container) {
  const tab = state.careTab || "new";
  container.innerHTML = `
    <div class="section-tabs">
      <button data-tab="new" class="${tab === "new" ? "active" : ""}">Новое обращение</button>
      <button data-tab="mine" class="${tab === "mine" ? "active" : ""}">Ваши обращения</button>
    </div>
    <div id="care-content"></div>
  `;
  container.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.careTab = btn.dataset.tab;
      saveState();
      renderCareSupport(container);
    });
  });

  const content = document.getElementById("care-content");
  if (tab === "new") {
    content.innerHTML = `
      <div class="field">
        <label>Категория</label>
        <select id="care_category">
          ${CARE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Текст</label>
        <textarea id="care_text" placeholder="Опишите проблему или вопрос..."></textarea>
      </div>
      <div class="hint" style="margin-bottom:16px;">Обращение видите только Вы и команда.</div>
      <button class="btn" id="care-submit" style="width:100%">Отправить</button>
    `;
    document.getElementById("care-submit").addEventListener("click", () => {
      const text = document.getElementById("care_text").value.trim();
      if (!text) return;
      const category = document.getElementById("care_category").value;
      // TODO(backend): submit to a real endpoint instead of local-only storage,
      // so the team can actually see and respond to submissions across users.
      state.careRequests.push({ id: Date.now(), date: todayStr(), category, text });
      saveState();
      state.careTab = "mine";
      saveState();
      renderCareSupport(container);
    });
  } else {
    if (state.careRequests.length === 0) {
      content.innerHTML = `<div class="empty-state">Вы ещё не отправляли обращений.</div>`;
    } else {
      content.innerHTML = state.careRequests
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

// TZ section 11, 13.08.2026: single "Забота" nav entry, two sections
// inside via an outer tab switch — "Вопрос в поддержку" (support,
// previously its own "Служба заботы" tab) and "Предложить идею"
// (previously its own "Фонд идей" tab). Each keeps its own inner
// new/mine tab state (state.careTab / state.ideasTab) untouched by
// switching the outer section.
function renderCare(screen) {
  const section = state.careSection || "support";
  screen.innerHTML = `
    <h2>Забота</h2>
    <div class="section-tabs">
      <button data-section="support" class="${section === "support" ? "active" : ""}">Вопрос в поддержку</button>
      <button data-section="ideas" class="${section === "ideas" ? "active" : ""}">Предложить идею</button>
    </div>
    <div id="care-outer-content"></div>
  `;
  screen.querySelectorAll("[data-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.careSection = btn.dataset.section;
      saveState();
      renderCare(screen);
    });
  });
  const container = document.getElementById("care-outer-content");
  if (section === "support") renderCareSupport(container);
  else renderCareIdeas(container);
}

/* ---- Profile ---- */

// TZ section 7, 11.08.2026: the starting-capital number lives only here
// now, not on the main dashboard. "Изменить ответы и пересчитать" is the
// "official recalc" tool from TZ section 1's "two tools" split — the
// scenario simulator (sandbox "what if", nothing saved) is the other
// tool and is a separate, not-yet-built feature.
function renderProfile(screen) {
  screen.innerHTML = `
    <h2>Профиль</h2>
    <div class="reveal-number" style="padding: 24px 0;">
      <div class="value" style="font-size:36px;">${(state.startingCapitalDays ?? 0).toLocaleString("ru-RU")}</div>
      <div class="label">дней стартового капитала (из онбординга)</div>
    </div>
    <p class="note" style="margin-top:0;">Число не пересчитывается автоматически — только когда Вы сами обновите ответы анкеты. Имеет смысл делать это не чаще раза в месяц, по мере реальных изменений привычек.</p>
    <button class="btn secondary" id="profile-recalc" style="width:100%">Изменить ответы и пересчитать</button>
  `;
  document.getElementById("profile-recalc").addEventListener("click", () => {
    state.onboardingDraft = { ...state.onboarding };
    state.onboardingStep = ONBOARDING_STEPS[0];
    state.recalcMode = true;
    saveState();
    render();
  });
}

/* ---- History (calendar heatmap) ---- */


// "Личные накопления" is the net day total already used for the main
// chart (deposits minus regular per-factor charges) — this just breaks
// it down for display. "Дивиденды" surfaces the periodic bonuses
// (currently only the weekly sport top-up) already folded into that
// day's total. "Списания" isolates the negative regular per-factor
// charges (smoking above baseline, sleep, alcohol) for the same day —
// the inactivity-decay charge (see applyInactivityDecay/DECAY_TIERS)
// is NOT computed here since it never touches the main capital, only
// the separately-tracked sphere dividends pool; it's merged into the
// "Списания" display per-day via dayDecayChargeItems below instead
// (TZ section 7, 13.08.2026: "меняется только визуальное
// представление данных", not the underlying mechanics).
function dailyFactorBreakdown(entry) {
  const waterline = Number(state.smokingWaterline) || 0;
  const smokingTerm = (waterline - (Number(entry.cigarettes) || 0)) * 0.014;
  const items = [];
  if (smokingTerm) items.push({ label: "Курение", amount: smokingTerm });
  if (Number(entry.activityMinutes) > 0) {
    items.push({ label: "Активность", amount: Math.min((Number(entry.activityMinutes) / 60) * 6, 9) / 24 });
  }
  if (entry.weeklyBonusDays) items.push({ label: "Недельная доплата за спорт", amount: entry.weeklyBonusDays });
  if (entry.sleepDelta) items.push({ label: "Сон", amount: entry.sleepDelta });
  if (entry.alcoholDelta) items.push({ label: "Алкоголь", amount: entry.alcoholDelta });
  return items;
}

// Inactivity-decay events recorded on this specific date (TZ section 7,
// 13.08.2026 display change: shown inside that day's "Списания" in the
// "Транзакции за день" popup instead of a standalone always-visible
// section). Storage/computation in applyInactivityDecay is unchanged.
function dayDecayChargeItems(date) {
  return state.decayCharges
    .filter((c) => c.date === date)
    .map((c) => ({
      label: `Бездействие (${c.sphere === "sport" ? "спорт" : c.sphere}): ${c.days}+ дней, −${c.marginalPct}% от Дивидендов`,
      amount: -c.amountDays,
    }));
}

// Tappable amount (TZ, 12.08.2026 pattern, reused 13.08.2026 outside a
// table for the "Транзакции за день" popup): the number itself is the
// <summary> of a <details> block — tapping it expands the per-factor
// breakdown underneath.
function reportClickableAmount(amount, cssClass, items) {
  if (!amount || items.length === 0) return `<span class="${cssClass}">—</span>`;
  const detail = items.map((i) => `<div class="decay-detail-row">${escapeHtml(i.label)}: ${formatDays(i.amount)}</div>`).join("");
  return `<details class="report-cell"><summary class="${cssClass}">${formatDays(amount)}</summary>${detail}</details>`;
}

// Minimal modal system (TZ section 7, 13.08.2026: "Транзакции за день"
// popup on tapping a calendar date) — appended to <body> rather than
// #screen since it needs to overlay the fixed bottom nav too. Click
// outside the box or the ✕ closes it.
function showModal(bodyHtml) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modal-overlay";
  overlay.innerHTML = `<div class="modal-box">${bodyHtml}</div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
  document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
}

function closeModal() {
  document.getElementById("modal-overlay")?.remove();
}

function dayTransactionsModalHtml(date) {
  const entry = state.ledger[date];
  if (!entry) {
    return `
      <div class="modal-header"><h3>${escapeHtml(date)}</h3><button class="modal-close" id="modal-close-btn">✕</button></div>
      <div class="empty-state">Операций в этот день не было.</div>
    `;
  }
  const savings = entry.deltaDays || 0;
  const dividends = entry.weeklyBonusDays || 0;
  const breakdown = dailyFactorBreakdown(entry);
  const chargeItems = [...breakdown.filter((i) => i.amount < 0), ...dayDecayChargeItems(date)];
  const charges = chargeItems.reduce((sum, i) => sum + i.amount, 0);
  const dividendItems = dividends
    ? [{ label: `Недельная доплата за спорт (неделя ${mondayOfWeek(date)}–${date})`, amount: dividends }]
    : [];

  return `
    <div class="modal-header"><h3>Транзакции за ${escapeHtml(date)}</h3><button class="modal-close" id="modal-close-btn">✕</button></div>
    <div class="modal-row">
      <span>Личные накопления</span>
      ${reportClickableAmount(savings, savings >= 0 ? "amount positive" : "amount negative", breakdown)}
    </div>
    <div class="modal-row">
      <span>Дивиденды</span>
      ${reportClickableAmount(dividends, "amount positive", dividendItems)}
    </div>
    <div class="modal-row">
      <span>Списания</span>
      ${reportClickableAmount(charges, "amount negative", chargeItems)}
    </div>
  `;
}

const RU_MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const RU_WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

// 4-tier intensity bucket, GitHub-heatmap style — relative to the
// largest single-day magnitude seen across the whole ledger (not just
// the visible month), so color intensity stays comparable as the user
// navigates between months instead of recalibrating each time.
function intensityTier(value, max) {
  if (max <= 0) return 1;
  const ratio = Math.abs(value) / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// TZ section 7, 13.08.2026: "История" — calendar grid replacing the old
// table-based report. Cell color reflects that day's real deltaDays
// only (green=positive/red=negative/gray=no data), matching the main
// Портфель chart; the balance number itself is deliberately not shown
// on the grid. Tapping a date opens "Транзакции за день" with the full
// breakdown, same clickable-amount pattern as before.
function renderHistory(screen) {
  const monthStr = state.historyMonth || todayStr().slice(0, 7);
  const [year, mon] = monthStr.split("-").map(Number);

  const firstOfMonth = new Date(Date.UTC(year, mon - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const firstWeekday = firstOfMonth.getUTCDay(); // 0=Sun..6=Sat
  const leadingPad = firstWeekday === 0 ? 6 : firstWeekday - 1; // Monday-first grid

  const maxAbsDelta = Object.values(state.ledger).reduce((max, e) => Math.max(max, Math.abs(e.deltaDays || 0)), 0);

  const cells = [];
  for (let i = 0; i < leadingPad; i++) cells.push(`<div class="day-cell pad"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = state.ledger[dateStr];
    let cls = "empty";
    if (entry) {
      const delta = entry.deltaDays || 0;
      if (delta > 0) cls = `positive tier-${intensityTier(delta, maxAbsDelta)}`;
      else if (delta < 0) cls = `negative tier-${intensityTier(delta, maxAbsDelta)}`;
      else cls = "neutral";
    }
    cells.push(`<button class="day-cell ${cls}" data-date="${dateStr}">${d}</button>`);
  }
  const trailingPad = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailingPad; i++) cells.push(`<div class="day-cell pad"></div>`);

  const isCurrentMonth = monthStr === todayStr().slice(0, 7);

  screen.innerHTML = `
    <h2>История</h2>
    <div class="history-nav">
      <button class="btn secondary" id="month-prev">‹</button>
      <div class="month-label">${RU_MONTH_NAMES[mon - 1]} ${year}</div>
      <button class="btn secondary" id="month-next" ${isCurrentMonth ? "disabled" : ""}>›</button>
    </div>
    <div class="history-grid history-weekdays">
      ${RU_WEEKDAY_LABELS.map((w) => `<div class="weekday-label">${w}</div>`).join("")}
    </div>
    <div class="history-grid">${cells.join("")}</div>
    <div class="history-legend">
      <span class="legend-swatch negative tier-4"></span><span class="legend-swatch negative tier-2"></span><span class="legend-swatch neutral"></span><span class="legend-swatch positive tier-2"></span><span class="legend-swatch positive tier-4"></span>
      <span class="hint" style="margin:0 0 0 8px;">Меньше — больше капитала за день</span>
    </div>
  `;

  document.getElementById("month-prev").addEventListener("click", () => {
    const prev = new Date(Date.UTC(year, mon - 2, 1));
    state.historyMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    saveState();
    renderHistory(screen);
  });
  document.getElementById("month-next").addEventListener("click", () => {
    if (isCurrentMonth) return;
    const next = new Date(Date.UTC(year, mon, 1));
    state.historyMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    saveState();
    renderHistory(screen);
  });
  screen.querySelectorAll(".day-cell[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showModal(dayTransactionsModalHtml(btn.dataset.date));
    });
  });
}

/* ---------------------------------------------------------------------
 * Init
 * ------------------------------------------------------------------- */

render();
