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
 * Icons (TZ section 7, 13.08.2026: outline/line-style, not colored
 * emoji — hand-drawn minimal SVGs, stroke=currentColor so each icon
 * picks up its button's color for active/inactive states).
 * ------------------------------------------------------------------- */

function iconSvg(inner) {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function gearIconInner() {
  const ticks = [];
  for (let i = 0; i < 8; i++) {
    ticks.push(`<line x1="12" y1="2.6" x2="12" y2="5.4" transform="rotate(${i * 45} 12 12)"/>`);
  }
  return `<circle cx="12" cy="12" r="6.3"/><circle cx="12" cy="12" r="2.2"/>${ticks.join("")}`;
}

const ICONS = {
  home: iconSvg(`<path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9"/><path d="M9.5 20v-6h5v6"/>`),
  calendar: iconSvg(`<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 9.7h17"/><path d="M8 3.5v4"/><path d="M16 3.5v4"/>`),
  book: iconSvg(`<path d="M12 6.8c-2.3-1.5-5.2-1.9-8.5-1v13c3.3-0.9 6.2-0.5 8.5 1c2.3-1.5 5.2-1.9 8.5-1v-13c-3.3-0.9-6.2-0.5-8.5 1z"/><path d="M12 6.8v13"/>`),
  chat: iconSvg(`<path d="M4 5.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9.5L5 21.5V17.5H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/>`),
  gear: iconSvg(gearIconInner()),
  bell: iconSvg(`<path d="M6.5 10.2a5.5 5.5 0 0 1 11 0c0 4.1 1.4 5.5 2 6.2a.6.6 0 0 1-.4 1H4.9a.6.6 0 0 1-.4-1c.6-.7 2-2.1 2-6.2z"/><path d="M9.6 19.6a2.5 2.5 0 0 0 4.8 0"/>`),
  user: iconSvg(`<circle cx="12" cy="8.3" r="3.7"/><path d="M4.5 20c0.6-4.2 4-6.3 7.5-6.3s6.9 2.1 7.5 6.3"/>`),
};

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

// Nutrition step (TZ section 1 step 4) used to ask 6 separate range
// questions here (water/last-meal-time/meals-per-day/hours-between-meals/
// eating-window/supplements-regularity) that never matched the daily
// 6-tile nutrition tracker added 20.08.2026 (see nutritionRowHtml) —
// confirmed 24.08.2026 that none of those old fields were read anywhere
// else in the file at all, not even the one-time formula. Removed; the
// onboarding "nutrition" step now renders nutritionRowHtml("f", draft)
// directly, so onboarding and daily tracking share one field set instead
// of two disconnected ones. See collectStepFields below for the matching
// save-side fix.

// Daily fields for the new collection-only factors added 19.08.2026
// (focus-group review pass, TZ taxonomy doc 17.08.2026) — same pattern
// as stress: no formula, plain data collection, "" is the neutral/
// unanswered value throughout.
const YES_NO_OPTIONS = [
  { value: "yes", label: "Да" },
  { value: "no", label: "Нет" },
];

// Nutrition redesign, 20.08.2026 (replaces the earlier 2-dropdown
// "Питание сегодня"/"Сладкое сегодня" version): six separate tiles —
// count, protein, water, flour products, sugar sources, supplements.
// Still collection-only, no formula.
const NUTRITION_FLOUR_OPTIONS = [
  { value: "none", label: "Не было" },
  { value: "wholegrainSourdough", label: "Цельнозерновой хлеб на закваске" },
  { value: "wholegrainPasta", label: "Паста из твёрдых сортов" },
  { value: "white", label: "Белый хлеб" },
];

// Checkbox groups (multi-select) — "Нет" is mutually exclusive with the
// other sugar sources, wired in wireNutritionExclusiveCheckboxes.
const NUTRITION_SUGAR_SOURCES = [
  { key: "none", label: "Не было" },
  { key: "inProducts", label: "В составе продуктов" },
  { key: "juices", label: "Соки" },
  { key: "sweetDrinks", label: "Сладкие напитки" },
  { key: "added", label: "Добавленный (в чай, кофе и т.п.)" },
];

const NUTRITION_SUPPLEMENT_TYPES = [
  { key: "vitamins", label: "Витамины" },
  { key: "minerals", label: "Минералы" },
  { key: "other", label: "Другое" },
];

// Meals-per-day switched from an exact 1..6 count to ranges (25.08.2026,
// user feedback) — precision here wasn't meaningful (no formula reads
// this field, see FACTOR_NEUTRAL_VALUES/nutrition), and a range is an
// easier, less fussy tap than picking one exact number.
const NUTRITION_MEALS_RANGE_OPTIONS = [
  { value: "1-2", label: "1-2" },
  { value: "3-4", label: "3-4" },
  { value: "5+", label: "5+" },
];

// Options in every dropdown below are ordered best-first, descending to
// worst (20.08.2026 UI pass) — matches STRESS_LEVEL_OPTIONS/
// WAIST_RANGE_OPTIONS/NUTRITION_QUALITY_OPTIONS above, which already
// followed this convention.
const SOCIAL_QUALITY_OPTIONS = [
  { value: "full", label: "Полноценное общение" },
  { value: "some", label: "Немного" },
  { value: "none", label: "Не было" },
];

const PURPOSE_OPTIONS = [
  { value: "yes", label: "Да" },
  { value: "somewhat", label: "Отчасти" },
  { value: "no", label: "Нет" },
];

const COGNITIVE_ACTIVITY_OPTIONS = [
  { value: "full", label: "Насыщенно" },
  { value: "some", label: "Немного" },
  { value: "none", label: "Не было" },
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

const KNOWLEDGE_BASE = {
  ru: [
    {
      key: "smoking",
      name: "Курение",
      active: true,
      body: "Мы опираемся на научные исследования о влиянии курения на продолжительность жизни. Статус «курит» учитывается один раз при расчёте стартового капитала. Отдельно от этого число сигарет в день, указанное при онбординге, становится точкой отсчёта для ежедневного портфеля: списание или депозит считается от отклонения от неё — курите сегодня меньше обычного, получаете плюс, больше — минус.",
      source: "Источники: UCL, журнал Addiction (2024/2025); Tsai et al., Aging (Albany NY), 2021 — годы жизни по статусу курения.",
      sourceKeys: ["ucl-smoking", "tsai-aging"],
    },
    {
      key: "sport",
      name: "Физическая активность",
      active: true,
      body: "Мы опираемся на научные исследования о влиянии физической активности на продолжительность жизни, основанные на объективных измерениях (акселерометры), а не на самоотчётах. Положительный эффект не растёт бесконечно — у него есть верхний предел. Отдельно недостаточная активность сама по себе связана с повышенным риском смерти по сравнению с достаточно активными людьми. Считается только активность, где пульс заметно поднимается выше уровня покоя — тест разговором: можете говорить, но не петь — засчитывается; свободно поёте на ходу — нет. Медленная прогулка не в счёт, быстрая ходьба, физический труд или тренировка — да.",
      source: "Источники: Veerman et al., BJSM (2024); D. Spiegelhalter, BMJ (2012); WHO (по риску недостаточной активности); Cleveland Clinic (порог интенсивности, тест разговором).",
      sourceKeys: ["veerman-bjsm", "webmd-walking", "lee-lancet", "spiegelhalter-bmj", "cleveland-clinic", "tsai-aging"],
    },
    {
      key: "sleep",
      name: "Сон",
      active: true,
      body: "Наименьший риск смертности связан со сном 7–8 часов в сутки; как более короткий, так и более длинный сон связаны с повышенным риском, причём нелинейно и несимметрично — пересып несёт больший риск на каждый лишний час, чем недосып на каждый недостающий. Вместо разового дневного штрафа приложение ведёт накопительный «долг сна»: недосып одного дня не компенсируется одной «лишней» ночью сна один к одному, организм восстанавливается постепенно — долг затухает со временем, а штраф в капитал растёт ускоренно (нелинейно) с размером накопленного долга, а не с разовым отклонением. Отдельно и независимо — штраф за нерегулярное время отхода ко сну (если это поле заполняется 7+ дней подряд), даже при нормальном количестве часов. С 25.08.2026: сон в норме (7–8ч) и стабильное время отхода ко сну дают небольшой положительный прирост капитала, а не только отсутствие штрафа — величина рассчитана как доля доли населения, не досыпающей норму (30,5%, CDC/NHIS 2024), от уже откалиброванного штрафа модели, а не произвольное число. Модель «долг сна + регулярность» — собственная интерпретация проекта, собранная из нескольких независимых исследований (модель гомеостатического давления сна, дозозависимый метаанализ смертности, Sleep Regularity Index UK Biobank), а не прямая цитата единой признанной методологии.",
      source: "Источники: Yin J. et al., JAHA (2017, дозозависимая связь смертности со сном); Borbély A.A. (1982/2016, two-process model); Van Dongen et al. (2003) и Belenky et al. (2003, динамика восстановления после ограничения сна); Sleep Regularity Index, UK Biobank; метаанализ Cappuccio и соавт. (~1.3–1.5 млн участников, фоновая U-образная связь).",
      sourceKeys: ["yin-jaha-sleep", "borbely-two-process", "vandongen-dinges-2003", "belenky-2003", "sri-ukbiobank", "cappuccio-sleep", "cdc-nhis-sleep-2024"],
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
    {
      key: "social",
      name: "Социальные связи",
      active: false,
      body: "Раздел в разработке — появится вместе с добавлением фактора социальных связей в капитал здоровья.",
      source: "Скоро.",
    },
    {
      key: "weight",
      name: "Вес",
      active: false,
      body: "Раздел в разработке — появится вместе с добавлением фактора веса в капитал здоровья.",
      source: "Скоро.",
    },
    {
      key: "purpose",
      name: "Смысл и цель",
      active: false,
      body: "Раздел в разработке — появится вместе с добавлением фактора смысла и цели в капитал здоровья.",
      source: "Скоро.",
    },
    {
      key: "cognitive",
      name: "Когнитивная активность",
      active: false,
      body: "Раздел в разработке — появится вместе с добавлением фактора когнитивной активности в капитал здоровья.",
      source: "Скоро.",
    },
  ],
  en: [
    {
      key: "smoking",
      name: "Smoking",
      active: true,
      body: "We rely on published research on how smoking affects life expectancy. Smoking status is factored in once, when your starting capital is calculated. Separately, the number of cigarettes per day you gave during onboarding becomes the baseline for your daily portfolio: each day's charge or deposit is based on how much you deviate from it — smoke less than usual today and you gain, smoke more and you lose.",
      source: "Sources: UCL, Addiction journal (2024/2025); Tsai et al., Aging (Albany NY), 2021 — years of life lost by smoking status.",
      sourceKeys: ["ucl-smoking", "tsai-aging"],
    },
    {
      key: "sport",
      name: "Physical activity",
      active: true,
      body: "We rely on published research on how physical activity affects life expectancy, based on objective measurements (accelerometers) rather than self-reports. The benefit doesn't grow indefinitely — it has an upper ceiling. Separately, insufficient activity is itself linked to a higher risk of death compared with sufficiently active people. Only activity where your heart rate is noticeably raised above resting level counts — the talk test: you can talk but not sing = counts; you can sing freely while moving = doesn't. A slow walk doesn't count; brisk walking, physical labor, or a workout does.",
      source: "Sources: Veerman et al., BJSM (2024); D. Spiegelhalter, BMJ (2012); WHO (on the risk of insufficient activity); Cleveland Clinic (intensity threshold, talk test).",
      sourceKeys: ["veerman-bjsm", "webmd-walking", "lee-lancet", "spiegelhalter-bmj", "cleveland-clinic", "tsai-aging"],
    },
    {
      key: "sleep",
      name: "Sleep",
      active: true,
      body: "The lowest mortality risk is associated with 7–8 hours of sleep a night; both shorter and longer sleep are linked to higher risk, and the relationship is non-linear and asymmetric — oversleeping carries a bigger risk per extra hour than undersleeping carries per missing hour. Instead of a one-off daily penalty, the app tracks a cumulative 'sleep debt': one night's shortfall isn't offset one-to-one by a single 'extra' night — the body recovers gradually, so the debt decays over time while the charge to your capital grows faster than linearly as the accumulated debt grows, rather than reacting to a single day's deviation. Separately and independently, there's a penalty for an irregular bedtime (once that field has 7+ consecutive days of data), even with a normal number of hours. As of 25.08.2026: sleep in range (7–8h) and a stable bedtime now earn a small positive capital gain, not just the absence of a penalty — sized as the share of the population that falls short of that target (30.5%, CDC/NHIS 2024) applied to the model's own already-calibrated penalty, not an arbitrary figure. The 'sleep debt + regularity' model is the project's own synthesis, built from several independent lines of research (the homeostatic sleep-pressure model, a dose-response mortality meta-analysis, and the UK Biobank Sleep Regularity Index) — not a direct quote of one single recognized methodology.",
      source: "Sources: Yin J. et al., JAHA (2017, dose-response relationship between sleep and mortality); Borbély A.A. (1982/2016, two-process model); Van Dongen et al. (2003) and Belenky et al. (2003, recovery dynamics after sleep restriction); Sleep Regularity Index, UK Biobank; Cappuccio et al. meta-analysis (~1.3–1.5 million participants, background U-shaped relationship).",
      sourceKeys: ["yin-jaha-sleep", "borbely-two-process", "vandongen-dinges-2003", "belenky-2003", "sri-ukbiobank", "cappuccio-sleep", "cdc-nhis-sleep-2024"],
    },
    {
      key: "alcohol",
      name: "Alcohol",
      active: true,
      body: "Alcohol-related risk is dose-dependent and rises with the amount of ethanol consumed per week; there's no safe level that's the same for everyone. Daily: the mere fact of drinking today (the source doesn't provide dose-dependent daily data) produces a rough capital delta — an approximate estimate; unlike smoking and activity, the exact daily methodology for alcohol is still being refined.",
      source: "Sources: WHO and Lancet reviews (Global Burden of Disease, 2018); Tsai et al., Aging (Albany NY), 2021.",
      sourceKeys: ["tsai-aging"],
    },
    {
      key: "nutrition",
      name: "Nutrition",
      active: false,
      body: "Section in progress — will appear once the nutrition factor is added to health capital. Separately, purely as cultural context (it doesn't affect the capital calculation): taking supplements is a mainstream, normalized practice, not a fringe one — for example, in Japan roughly 60% of healthy adults, 55–70% of adult patients, and 32% of students regularly take dietary supplements, according to national surveys.",
      source: "Source: national surveys in Japan.",
    },
    {
      key: "stress",
      name: "Stress",
      active: false,
      body: "Section in progress — will appear once the stress factor is added to health capital.",
      source: "Coming soon.",
    },
    {
      key: "social",
      name: "Social connections",
      active: false,
      body: "Section in progress — will appear once the social connections factor is added to health capital.",
      source: "Coming soon.",
    },
    {
      key: "weight",
      name: "Weight",
      active: false,
      body: "Section in progress — will appear once the weight factor is added to health capital.",
      source: "Coming soon.",
    },
    {
      key: "purpose",
      name: "Purpose",
      active: false,
      body: "Section in progress — will appear once the purpose factor is added to health capital.",
      source: "Coming soon.",
    },
    {
      key: "cognitive",
      name: "Cognitive activity",
      active: false,
      body: "Section in progress — will appear once the cognitive activity factor is added to health capital.",
      source: "Coming soon.",
    },
  ],
};

function localizedKnowledgeBase() {
  return KNOWLEDGE_BASE[getLang()] || KNOWLEDGE_BASE.ru;
}

// Canonical source list (TZ section 9, 11.08.2026: "обязательная, отдельно
// видимая страница/подраздел Базы знаний... каждый фактор должен вести на
// соответствующий источник"). Implemented as a subsection of the existing
// Knowledge Base screen (TZ explicitly allows "страница/подраздел" — a
// subsection satisfies that), with direct links from this list AND from
// each KNOWLEDGE_BASE card's sourceKeys.
const SOURCES = {
  ru: [
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
    {
      key: "yin-jaha-sleep",
      label: "Дозозависимая связь сна со смертностью (+6%/недосып, +13%/пересып на час)",
      citation: "Yin J. et al., Journal of the American Heart Association (2017), «Relationship of Sleep Duration With All-Cause Mortality and Cardiovascular Events: A Systematic Review and Dose-Response Meta-Analysis of Prospective Cohort Studies»",
      url: "https://pubmed.ncbi.nlm.nih.gov/28889101/",
    },
    {
      key: "borbely-two-process",
      label: "Two-process model сна (гомеостатическое давление)",
      citation: "Borbély A.A., Human Neurobiology (1982), «A two process model of sleep regulation»",
      url: "https://pubmed.ncbi.nlm.nih.gov/7185792/",
      url2: "https://pubmed.ncbi.nlm.nih.gov/26762182/",
    },
    {
      key: "vandongen-dinges-2003",
      label: "Накопительный эффект хронического ограничения сна",
      citation: "Van Dongen H.P.A. et al., Sleep (2003), «The Cumulative Cost of Additional Wakefulness»",
      url: "https://pubmed.ncbi.nlm.nih.gov/12683469/",
    },
    {
      key: "belenky-2003",
      label: "Динамика восстановления после ограничения сна",
      citation: "Belenky G. et al., Journal of Sleep Research (2003), «Patterns of performance degradation and restoration during sleep restriction and subsequent recovery»",
      url: "https://pubmed.ncbi.nlm.nih.gov/12603781/",
    },
    {
      key: "sri-ukbiobank",
      label: "Sleep Regularity Index — методология регулярности сна",
      citation: "Windred D.P. et al., UK Biobank (2024), «Sleep regularity and mortality: a prospective analysis in the UK Biobank»",
      url: "https://pubmed.ncbi.nlm.nih.gov/37995126/",
    },
    {
      key: "cdc-nhis-sleep-2024",
      label: "Доля взрослых, недосыпающих норму (для бонуса за хороший сон)",
      citation: "CDC/NCHS, National Health Interview Survey (2024), Data Brief №559 «Short Sleep Duration and Sleep Difficulties Among Adults: United States, 2024» — 30,5% взрослых спят в среднем менее 7ч/сутки",
      url: "https://www.cdc.gov/nchs/products/databriefs/db559.htm",
    },
  ],
  en: [
    {
      key: "ucl-smoking",
      label: "Smoking (20 min per cigarette)",
      citation: "Jackson S. et al., UCL, editorial in Addiction (2024/2025)",
      url: "https://www.rcp.ac.uk/news-and-media/news-and-opinion/rcp-responds-to-ucl-research-showing-a-single-cigarette-can-take-20-minutes-off-life-expectancy/",
    },
    {
      key: "lee-lancet",
      label: "Physical activity and life expectancy",
      citation: "Lee I-M. et al., The Lancet (2012), \"Effect of physical inactivity on major non-communicable diseases worldwide\"",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3645500/",
    },
    {
      key: "spiegelhalter-bmj",
      label: "Microlife — concept and methodology",
      citation: "Spiegelhalter D., BMJ (2012), \"Using speed of ageing and 'microlives'\"",
      url: "https://pubmed.ncbi.nlm.nih.gov/23247978/",
    },
    {
      key: "cappuccio-sleep",
      label: "Sleep and mortality (meta-analysis)",
      citation: "Cappuccio F.P. et al., Sleep (2010); plus a dose-response meta-analysis, ~1.5 million participants (2016)",
      url: "https://pubmed.ncbi.nlm.nih.gov/20469800/",
      url2: "https://www.nature.com/articles/srep21480",
    },
    {
      key: "cleveland-clinic",
      label: "Moderate-intensity activity threshold (heart rate)",
      citation: "Cleveland Clinic, \"What Does Moderate Exercise Mean, Anyway?\"",
      url: "https://health.clevelandclinic.org/what-does-moderate-exercise-mean-anyway",
    },
    {
      key: "tsai-aging",
      label: "Converting hazard ratios into years of life (Chiang's life table method) + a table of 30 risk factors",
      citation: "Tsai S.P. et al., Aging (2021), \"Converting health risks into loss of life years\"",
      url: "https://www.aging-us.com/article/203491/text",
    },
    {
      key: "veerman-bjsm",
      label: "Activity-to-capital ratio, 1:6 (primary source)",
      citation: "Veerman L. et al., British Journal of Sports Medicine (2024), \"Physical activity and life expectancy: a life-table analysis\" (Griffith University) — accelerometer data",
      url: "https://www.sciencedaily.com/releases/2024/11/241126215133.htm",
    },
    {
      key: "webmd-walking",
      label: "Additional confirmation of the activity ratio",
      citation: "WebMD (2024), coverage of a walking study — a similar ≈1:6 ratio",
      url: "https://www.webmd.com/fitness-exercise/news/20241115/cm/how-walking-more-could-add-11-years-to-your-life",
    },
    {
      key: "yin-jaha-sleep",
      label: "Dose-response relationship between sleep and mortality (+6%/hr under, +13%/hr over)",
      citation: "Yin J. et al., Journal of the American Heart Association (2017), \"Relationship of Sleep Duration With All-Cause Mortality and Cardiovascular Events: A Systematic Review and Dose-Response Meta-Analysis of Prospective Cohort Studies\"",
      url: "https://pubmed.ncbi.nlm.nih.gov/28889101/",
    },
    {
      key: "borbely-two-process",
      label: "Two-process model of sleep (homeostatic pressure)",
      citation: "Borbély A.A., Human Neurobiology (1982), \"A two process model of sleep regulation\"",
      url: "https://pubmed.ncbi.nlm.nih.gov/7185792/",
      url2: "https://pubmed.ncbi.nlm.nih.gov/26762182/",
    },
    {
      key: "vandongen-dinges-2003",
      label: "Cumulative effect of chronic sleep restriction",
      citation: "Van Dongen H.P.A. et al., Sleep (2003), \"The Cumulative Cost of Additional Wakefulness\"",
      url: "https://pubmed.ncbi.nlm.nih.gov/12683469/",
    },
    {
      key: "belenky-2003",
      label: "Recovery dynamics after sleep restriction",
      citation: "Belenky G. et al., Journal of Sleep Research (2003), \"Patterns of performance degradation and restoration during sleep restriction and subsequent recovery\"",
      url: "https://pubmed.ncbi.nlm.nih.gov/12603781/",
    },
    {
      key: "sri-ukbiobank",
      label: "Sleep Regularity Index — sleep regularity methodology",
      citation: "Windred D.P. et al., UK Biobank (2024), \"Sleep regularity and mortality: a prospective analysis in the UK Biobank\"",
      url: "https://pubmed.ncbi.nlm.nih.gov/37995126/",
    },
    {
      key: "cdc-nhis-sleep-2024",
      label: "Share of adults not meeting the sleep target (for the good-sleep bonus)",
      citation: "CDC/NCHS, National Health Interview Survey (2024), Data Brief No. 559, \"Short Sleep Duration and Sleep Difficulties Among Adults: United States, 2024\" — 30.5% of adults average under 7h of sleep a night",
      url: "https://www.cdc.gov/nchs/products/databriefs/db559.htm",
    },
  ],
};

function localizedSources() {
  return SOURCES[getLang()] || SOURCES.ru;
}

function sourceLinksHtml(keys) {
  return keys
    .map((k) => localizedSources().find((s) => s.key === k))
    .filter(Boolean)
    .map((s) => {
      const links = [`<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a>`];
      if (s.url2) links.push(`<a href="${escapeHtml(s.url2)}" target="_blank" rel="noopener noreferrer">${t("knowledge.additionalSource")}</a>`);
      return links.join(" / ");
    })
    .join(", ");
}

const READING_LIST = {
  ru: [
    "UCL — Addiction (2024/2025): цена одной сигареты в минутах ожидаемой продолжительности жизни.",
    "D. Spiegelhalter — BMJ (2012): концепция microlife для оценки риска в повседневных единицах.",
    "Cappuccio F. P. и соавт. — метаанализ продолжительности сна и смертности (~1.3–1.5 млн участников).",
    "WHO Global Health Observatory — таблицы дожития для базового расчёта капитала.",
    "WHO — рекомендации по физической активности: риск недостаточной активности против достаточной.",
    "Cleveland Clinic — определение умеренной и высокой интенсивности активности, тест разговором.",
  ],
  en: [
    "UCL — Addiction (2024/2025): the cost of one cigarette in minutes of life expectancy.",
    "D. Spiegelhalter — BMJ (2012): the microlife concept for measuring risk in everyday units.",
    "Cappuccio F. P. et al. — meta-analysis of sleep duration and mortality (~1.3–1.5 million participants).",
    "WHO Global Health Observatory — life tables used for the baseline capital calculation.",
    "WHO — physical activity guidelines: the risk of insufficient vs. sufficient activity.",
    "Cleveland Clinic — defining moderate- and vigorous-intensity activity, the talk test.",
  ],
};

function localizedReadingList() {
  return READING_LIST[getLang()] || READING_LIST.ru;
}

// Team-confirmed upcoming factors (added directly, no voting) vs.
// illustrative example of user-proposed factors going through the Idea
// Fund voting threshold. Vote counts here are EXAMPLE data — real
// aggregation is manual, done by the team (TZ section 10), not live.
const UPCOMING_FACTORS = {
  ru: [
    { name: "Питание", status: "team", note: "в разработке" },
    { name: "Стресс", status: "team", note: "в разработке" },
  ],
  en: [
    { name: "Nutrition", status: "team", note: "in progress" },
    { name: "Stress", status: "team", note: "in progress" },
  ],
};

function localizedUpcomingFactors() {
  return UPCOMING_FACTORS[getLang()] || UPCOMING_FACTORS.ru;
}

const UPCOMING_VOTED_EXAMPLE = {
  ru: [
    { name: "Качество воздуха дома/на работе", votes: 34, threshold: 100 },
    { name: "Регулярные медосмотры", votes: 61, threshold: 100 },
  ],
  en: [
    { name: "Air quality at home/work", votes: 34, threshold: 100 },
    { name: "Regular medical checkups", votes: 61, threshold: 100 },
  ],
};

function localizedUpcomingVotedExample() {
  return UPCOMING_VOTED_EXAMPLE[getLang()] || UPCOMING_VOTED_EXAMPLE.ru;
}

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
// 23.08.2026: pools widened per-tier (tone audit — identity framing,
// "вы — тот, кто...", not checklist completion) so the same phrase
// doesn't repeat every time someone lands in a tier. Register matches
// the app's own established voice (investment vocabulary + elite-sport
// comparisons, not casual gamification) — see STRATEGY_DIARY.
const ONBOARDING_RESULT_PHRASES = {
  ru: {
    top: [
      "Редкий профиль",
      "Статистическая аномалия — в хорошем смысле",
      "Потенциальный долгожитель",
      "Вы — из той небольшой выборки, на которую равняются исследования",
    ],
    good: [
      "Сильный старт",
      "Выше среднего по всем фронтам",
      "Стартовая позиция, за которую другие бы боролись",
      "Фундамент, на котором уже приятно строить",
    ],
    medium: [
      "Крепкая база — и есть, куда расти",
      "Прочная основа — рост уже в ваших руках",
      "Хорошая точка старта для того, кто решил считать",
    ],
    low: [
      "Точка отсчёта, а не приговор",
      "Отсюда есть куда расти — и это хорошая новость",
      "Лучшее время начать — сегодня",
      "Каждый долгожитель когда-то начинал с этой же точки",
      "Здесь нет драмы — есть только следующий шаг",
    ],
  },
  en: {
    top: [
      "A rare profile",
      "A statistical outlier — in a good way",
      "A potential long-liver",
      "You're in the small sample studies point to",
    ],
    good: [
      "A strong start",
      "Above average on every front",
      "A starting position others would fight for",
      "A foundation that's already good to build on",
    ],
    medium: [
      "A solid base — with room to grow",
      "A solid foundation — the growth is in your hands now",
      "A good starting point for someone who decided to start counting",
    ],
    low: [
      "A starting point, not a verdict",
      "There's room to grow from here — and that's good news",
      "The best time to start is today",
      "Every long-liver once started from this exact point",
      "No drama here — just the next step",
    ],
  },
};

function localizedResultPhrases(tier) {
  const lang = getLang();
  const pool = ONBOARDING_RESULT_PHRASES[lang]?.[tier];
  return pool && pool.length ? pool : ONBOARDING_RESULT_PHRASES.ru[tier];
}

const DAILY_GOOD_PHRASES = {
  ru: [
    "Депозит принят",
    "Капитал растёт",
    "Ещё один кирпичик",
    "Вклад засчитан",
    "Вы — из тех, кто не пропускает день",
    "Так выглядит день человека, который играет вдолгую",
    "Ещё один голос в пользу будущего себя",
  ],
  en: [
    "Deposit accepted",
    "Your capital is growing",
    "Another brick laid",
    "Contribution recorded",
    "You're one of the people who doesn't skip a day",
    "This is what a day looks like for someone playing the long game",
    "Another vote for your future self",
  ],
};
const DAILY_BAD_PHRASES = {
  ru: [
    "Не идеально, но это данные, а не приговор",
    "Списание учтено — здесь никто не считает идеальные дни",
    "Бывает и так — важно вернуться завтра",
  ],
  en: [
    "Not perfect, but it's data, not a verdict",
    "Charge recorded — nobody here expects perfect days",
    "It happens — what matters is coming back tomorrow",
  ],
};
const DAILY_RECORD_PHRASE = { ru: "Лучший результат за всё время", en: "Best result yet" };

function localizedDailyGoodPhrases() {
  return DAILY_GOOD_PHRASES[getLang()] || DAILY_GOOD_PHRASES.ru;
}
function localizedDailyBadPhrases() {
  return DAILY_BAD_PHRASES[getLang()] || DAILY_BAD_PHRASES.ru;
}
function localizedDailyRecordPhrase() {
  return DAILY_RECORD_PHRASE[getLang()] || DAILY_RECORD_PHRASE.ru;
}

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

/* ---------------------------------------------------------------------
 * i18n — added 24.08.2026, first checkpoint of the EN localization
 * scoped in 2026-08-24-anglijskaya-lokalizaciya-obyom-raboty.md. Scope
 * of THIS checkpoint: language storage/helper + the onboarding "basics"
 * step only, as a proof of the mechanism before translating the rest.
 * Everything else in the app still renders Russian-only regardless of
 * `hc_lang` — that's expected for now, not a bug, until the remaining
 * steps/screens are translated in the same pattern.
 *
 * Separate localStorage key (not part of the main `state` object/
 * STORAGE_KEY blob) so the switcher works even before onboarding starts
 * and doesn't require touching the rest of the state shape. Same bare
 * `localStorage` global already used by STORAGE_KEY above — works in
 * both the browser and the app.test.js vm sandbox without a
 * `typeof window` guard, confirmed by the existing pattern.
 * ------------------------------------------------------------------- */

const LANG_STORAGE_KEY = "hc_lang";

const STRINGS = {
  ru: {
    onboarding: {
      stepCounter: (n) => `Вопрос ${n} из 6`,
      back: "Назад",
      next: "Далее",
      calculate: "Рассчитать",
      basicsTitle: "Основные данные",
      ageLabel: "Возраст",
      genderLabel: "Пол",
      selectPlaceholder: "Выбрать...",
      genderMale: "Мужской",
      genderFemale: "Женский",
      genderOther: "Другое / не указывать",
      regionLabel: "Регион (страна)",
      basicsAlert: "Возраст, пол и регион обязательны для продолжения.",
      activityFormTitle: "Активность и форма",
      activityLabel: "Физическая активность, мин/нед",
      activityHint:
        "Считается только активность, поднимающая пульс минимум на 50% выше уровня покоя — тест разговором: можете говорить, но не петь — считается, свободно поёте — нет. Медленная прогулка не в счёт.",
      activityGoalLabel: "Хотите начать регулярно двигаться?",
      goalYes: "Да, хочу",
      goalNo: "Не сейчас",
      weightLabel: "Вес, кг",
      heightLabel: "Рост, см",
      waistLabel: "Объём талии",
      waistExactPlaceholder: "или точное значение, см",
      activityAlert: "Физическая активность обязательна для продолжения.",
      activityGoalAlert: "Пожалуйста, ответьте на вопрос про цель по активности.",
      recoveryTitle: "Восстановление",
      sleepHoursLabel: "Среднее количество часов сна",
      bedtimeLabel: "Обычное время отхода ко сну",
      recoveryPracticesLabel: "Практики восстановления",
      otherLabel: "Другое",
      otherTextPlaceholder: "Что именно?",
      stressLevelLabel: "Уровень стресса",
      nutritionStepTitle: "Питание",
      habitsTitle: "Вредные привычки",
      cigarettesLabel: "Сигарет в день (0, если не курите)",
      smokingGoalLabel: "Хотите бросить курить?",
      vapeLabel: "Вейп / кальян — используете?",
      yesLabel: "Да",
      noLabel: "Нет",
      alcoholSummaryLabel: "Алкоголь",
      alcoholSpiritsLabel: "Крепкий алкоголь, мл/нед",
      alcoholWineLabel: "Вино, мл/нед",
      alcoholBeerLabel: "Пиво и слабоалкогольные коктейли, л/нед",
      alcoholSpiritsPrefix: "крепкий",
      alcoholWinePrefix: "вино",
      alcoholBeerPrefix: "пиво",
      cigarettesAlert: "Сигарет в день обязательно для продолжения (0, если не курите).",
      smokingGoalAlert: "Пожалуйста, ответьте на вопрос про цель по курению.",
      healthTitle: "Здоровье",
      illnessHasLabel: "Есть ли серьёзные заболевания?",
      illnessDetailLabel: "Уточнение",
      revealTitle: "Это уже ваш капитал:",
      finishButton: "Перейти в приложение",
      finishButtonRecalc: "Сохранить пересчёт",
      shareButton: "Поделиться результатом",
      shareText: (days, word) => `Мой стартовый капитал здоровья — ${days} ${word}. Считаю каждый день в «Капитал здоровья»: humanchange.app/app/`,
      averageComparisonAbove: (pct) => `Это на ${pct}% больше среднего для вашего возраста, пола и региона.`,
      averageComparisonNear: "Это примерно на уровне среднего для вашего возраста, пола и региона — и это только отправная точка.",
      averageComparisonBelow: (pct) => `Это на ${pct}% меньше среднего для вашего возраста, пола и региона. Не приговор — отправная точка, с которой можно расти уже сегодня.`,
    },
    common: {
      copied: "Скопировано!",
      copyFailed: "Не удалось скопировать",
      save: "Сохранить",
    },
    dashboard: {
      title: "Портфель",
      trendSuffix: "за 7 дней",
      periodWeek: "Неделя",
      periodMonth: "Месяц",
      periodYear: "Год",
      todaySummaryTitle: "Итог дня",
      markTodayTitle: "Отметить сегодня",
      daysAbbrev: "дн.",
      chartEmpty: "Пока нет данных — отметьте первый день ниже.",
    },
    history: {
      calendarTitle: "История",
      editingUnavailable: "Редактирование недоступно",
      transactionsTitle: (date) => `Транзакции за ${date}`,
      noOperations: "Операций в этот день не было.",
      editButton: "Изменить",
      changeDayTitle: "Изменить день",
      fillDayTitle: "Заполнить день",
      editWindowNote: "Редактирование доступно только для последних 7 дней и не раньше даты регистрации.",
      personalSavingsLabel: "Личные накопления",
      dividendsLabel: "Дивиденды",
      chargesLabel: "Списания",
      weeklySportBonusLabel: (weekStart, date) => `Недельная доплата за спорт (неделя ${weekStart}–${date})`,
      weeklySportBonusShortLabel: "Недельная доплата за спорт",
      sleepDebtLabel: "Долг сна",
      sleepRegularityLabel: "Регулярность сна",
      inactivityChargeLabel: (sphere, days, pct) => `Бездействие (${sphere}): ${days}+ дней, −${pct}% от Дивидендов`,
      sportSphere: "спорт",
      activitySphereFallback: "активность",
      summaryCardTitle: "Вложения и дивиденды",
      summaryCardHint: "Разбивка капитала по источникам за всё время",
      summaryTitle: "Сводка вложений",
      summaryEmpty: "Пока нет данных — отметьте хотя бы один день.",
      summaryDividendsAggregateLabel: (weeks) => `Недельные доплаты за активность (${weeks} нед.)`,
      summaryInactivityAggregateLabel: (sphere) => `Бездействие (${sphere}), всего`,
    },
    knowledge: {
      title: "База знаний",
      comingSoon: "скоро",
      readingListTitle: "Что почитать",
      sourcesTitle: "Источники",
      sourcesNote: "Полный список научных источников, на которых основана модель — с прямыми ссылками. Пополняется по мере добавления новых факторов.",
      additionalLink: "доп. ссылка",
      additionalSource: "доп. источник",
      upcomingTitle: "Что впереди",
      upcomingNote: "Счётчики голосов ниже — пример визуализации; реальная агрегация предложений ведётся командой вручную.",
    },
    daily: {
      summaryLowActivity: "Добавьте 30 минут активности сегодня — это ощутимый плюс к капиталу.",
      summaryLessThanUsual: "Меньше обычного — засчитано.",
      summaryMoreThanUsual: "Больше обычного — бывает, завтра продолжим.",
      summaryGood: "Активность есть — вы уже из тех, кто двигается каждый день, а не разово.",
    },
    factorLabels: {
      sport: "Активность",
      sleep: "Сон",
      nutrition: "Питание",
      smoking: "Курение",
      alcohol: "Алкоголь",
      stress: "Стресс",
      weight: "Вес",
      social: "Социальные связи",
      cognitive: "Когнитивная активность",
      purpose: "Смысл и цель",
    },
    factorFields: {
      smokingLabelToday: "Сигарет сегодня",
      smokingLabel: "Сигарет",
      smokingWaterlineHint: (n) => `Ваша обычная норма: ${n} шт. — от неё считается отклонение.`,
      activityLabelToday: "Минут активности сегодня",
      activityLabel: "Минут активности",
      activityHint: "Не считается медленная прогулка — подробнее в Базе знаний.",
      sleepLabelToday: "Сон прошлой ночью",
      sleepLabel: "Сон (за прошедшую ночь)",
      sleepHoursPlaceholder: "Например, 7.5",
      sleepHoursHint: "В часах, можно дробно.",
      bedtimeLabelEdit: "Во сколько легли спать накануне",
      bedtimeLabelToday: "Во сколько легли спать вчера",
      alcoholLabelToday: "Алкоголь сегодня",
      alcoholLabel: "Алкоголь",
      alcoholSpiritsLabel: "Крепкий алкоголь",
      alcoholWineLabel: "Вино",
      alcoholBeerLabel: "Пиво/слабоалкогольное",
      socialLabel: "Общение с близкими сегодня",
      socialHint: "Считается вовлечённое общение вживую или по звонку — разговор, время вместе. Переписка по работе не в счёт.",
      weightLabel: "Вес сегодня, кг (необязательно)",
      bodyFatLabel: "% жира (необязательно)",
      bodyFatHint: "Точнее отражает состав тела, чем вес сам по себе.",
      purposeLabel: "Чувствовали сегодня смысл в своих делах?",
      cognitiveLabel: "Учились сегодня новому или решали непростую задачу?",
      cognitiveHint: "Такая нагрузка формирует новые нейронные связи — работает как тренировка для мозга.",
      stressLabelToday: "Уровень стресса сегодня",
      stressLabel: "Уровень стресса",
    },
    socialQualityOptions: {
      full: "Полноценное общение", some: "Немного", none: "Не было",
    },
    purposeOptions: {
      yes: "Да", somewhat: "Отчасти", no: "Нет",
    },
    cognitiveActivityOptions: {
      full: "Насыщенно", some: "Немного", none: "Не было",
    },
    settings: {
      title: "Настройки",
      accountRowLoggedIn: (email) => `Аккаунт — ${email}`,
      accountRowLoggedOut: "Войти / Зарегистрироваться",
      referralRow: "Пригласить друга",
      careRow: "Служба заботы и Фонд идей",
      factorsRow: "Факторы на главном экране",
      billingRow: "Тарифы и оплата",
      billingTitle: "Тарифы и оплата",
      billingIntro: "Новым пользователям доступен бесплатный пробный период. После пробного периода: 990–1490 ₽ в месяц. Founding member — 9 900 ₽/год (около 825 ₽/мес), закреплено навсегда, пока подписка активна.",
      billingNoAutopayHint: "Автоматической оплаты в приложении пока нет — платёжные системы ещё не подключены. Нажмите кнопку ниже, мы откроем письмо с запросом, отправьте его — и мы вручную вышлем вам ссылку на оплату.",
      billingRequestButton: "Запросить ссылку на оплату",
      billingRequestedHint: (date) => `Запрос отправлен ${date}. Если письмо не открылось само — напишите нам напрямую: `,
      billingEmailSubject: "Запрос ссылки на оплату — Капитал здоровья",
      billingEmailBody: (email) => `Здравствуйте!\n\nПрошу выслать ссылку на оплату подписки «Капитал здоровья».\n${email ? `Мой email в приложении: ${email}\n` : ""}\nСпасибо!`,
      back: "← Назад",
      referralTitle: "Пригласить друга",
      referralHint: "Скопируйте и отправьте — без ссылок и кодов, просто короткое приглашение.",
      referralShareText: "Я считаю дни своего здоровья в приложении «Капитал здоровья» — попробуй: humanchange.app/app/",
      copyButton: "Скопировать",
      languageLabel: "Язык",
      fitnessTrackersRow: "Обмен данными с фитнес-трекерами",
      accountTitle: "Аккаунт",
      accountLoggedInHint: (email) => `Вы вошли как ${email}.`,
      signOut: "Выйти",
      accountOptionalHint: "Аккаунт нужен только для оплаты и синхронизации между устройствами — без него приложение продолжает работать как раньше, все данные остаются на этом устройстве.",
      emailLabel: "Email",
      passwordLabel: "Пароль",
      signUp: "Зарегистрироваться",
      signIn: "Войти",
      haveAccount: "У меня уже есть аккаунт",
      needAccount: "Ещё нет аккаунта — зарегистрироваться",
      fillEmailPassword: "Заполните email и пароль.",
      genericAuthError: "Не получилось. Проверьте данные и попробуйте снова.",
      factorsTitle: "Факторы на главном экране",
      notificationsTitle: "Уведомления",
      notificationsEmpty: "Уведомлений пока нет.",
    },
    recoveryPractices: {
      yoga: "Йога",
      breathing: "Дыхательные практики",
      hardening: "Закаливание",
      nailBoard: "Гвоздестояние",
      banya: "Баня",
      massage: "Массаж",
    },
    sleepHoursOptions: {
      lt5: "менее 5ч", "5to6": "5–6ч", "6to7": "6–7ч", "7to8": "7–8ч", "8to9": "8–9ч", gt9: "более 9ч",
    },
    bedtimeOptions: {
      before22: "до 22:00", "22to24": "22:00–24:00", afterMidnight: "после полуночи", varies: "когда как", custom: "свой вариант",
    },
    stressLevelOptions: {
      "1": "1 — низкий", "2": "2", "3": "3 — средний", "4": "4", "5": "5 — высокий",
    },
    nutrition: {
      quantityTitle: "Количество",
      mealsLabel: "Приёмов пищи",
      snacksLabel: "Перекусов",
      proteinTitle: "Белок",
      proteinTimesLabel: "Раз в день",
      proteinEveryMeal: "В каждом приёме пищи",
      proteinGramsLabel: "Граммы/день",
      proteinGramsPlaceholder: "г",
      waterLabel: "Вода",
      waterHint: "Считается только чистая вода — чай, кофе и другие напитки не считаются.",
      sugarHint: "Не считается, если было за час до/после интенсивной тренировки или во время неё — в этом случае сахар усваивается иначе.",
      waterAmountPlaceholder: "Количество",
      unitMl: "мл",
      unitL: "л",
      flourLabel: "Мучное",
      sugarLabel: "Сахар",
      supplementsLabel: "БАДы",
    },
    nutritionFlourOptions: {
      none: "Нет",
      wholegrainSourdough: "Цельнозерновой хлеб на закваске",
      wholegrainPasta: "Паста из твёрдых сортов",
      white: "Белый хлеб",
    },
    nutritionSugarOptions: {
      none: "Нет",
      inProducts: "В составе продуктов",
      juices: "Соки",
      sweetDrinks: "Сладкие напитки",
      added: "Добавленный (в чай, кофе и т.п.)",
    },
    nutritionSupplementOptions: {
      vitamins: "Витамины",
      minerals: "Минералы",
      other: "Другое",
    },
    alcoholSpiritsOptions: {
      "0": "0", lt100: "до 100 мл/нед", "100to350": "100–350 мл/нед", gt350: "более 350 мл/нед",
    },
    alcoholWineOptions: {
      "0": "0", lt350: "до 350 мл/нед", "350to1000": "350–1000 мл/нед", gt1000: "более 1000 мл/нед",
    },
    alcoholBeerOptions: {
      "0": "0", lt700: "до 0.7 л/нед", "700to2000": "0.7–2 л/нед", gt2000: "более 2 л/нед",
    },
    welcome: {
      title: "Добро пожаловать в «Капитал здоровья»",
      intro: "Пять обязательных вопросов, и ещё несколько — по желанию. Чем больше заполните, тем точнее будет результат.",
      dataNote: "Мы собираем эти данные, чтобы рассчитать Ваш персональный капитал здоровья. Сейчас всё хранится локально на Вашем устройстве и никуда не передаётся.",
      disclaimer:
        "Усреднённая статистическая оценка по данным людей схожего профиля — возраст, пол, регион и другие показатели (не точный расчёт для Вас лично) — на основе научных исследований, не медицинский диагноз и не персональная рекомендация.",
      consent: "Я прочитал(а) и согласен(на)",
      start: "Начать →",
    },
    regions: {
      us: "США", ru: "Россия", by: "Беларусь", ua: "Украина", kz: "Казахстан",
      de: "Германия", gb: "Великобритания", fr: "Франция", es: "Испания",
      it: "Италия", pl: "Польша", il: "Израиль", ca: "Канада", au: "Австралия",
      other: "Другая страна",
    },
    activityOptions: {
      lt150: "менее 150 мин/нед",
      "150to300": "150–300 мин/нед",
      gt300: "более 300 мин/нед",
    },
    waistOptions: {
      lt80: "до 80 см",
      "80to95": "80–95 см",
      "95to110": "95–110 см",
      gt110: "более 110 см",
    },
  },
  en: {
    onboarding: {
      stepCounter: (n) => `Question ${n} of 6`,
      back: "Back",
      next: "Next",
      calculate: "Calculate",
      basicsTitle: "Basic info",
      ageLabel: "Age",
      genderLabel: "Gender",
      selectPlaceholder: "Select...",
      genderMale: "Male",
      genderFemale: "Female",
      genderOther: "Other / prefer not to say",
      regionLabel: "Region (country)",
      basicsAlert: "Age, gender, and region are required to continue.",
      activityFormTitle: "Activity & body stats",
      activityLabel: "Physical activity, min/week",
      activityHint:
        "Only activity that raises your heart rate at least 50% above resting counts — talk test: you can talk but not sing along = counts, can sing freely = doesn't. A slow walk doesn't count.",
      activityGoalLabel: "Want to start moving regularly?",
      goalYes: "Yes, I want to",
      goalNo: "Not right now",
      weightLabel: "Weight, kg",
      heightLabel: "Height, cm",
      waistLabel: "Waist size",
      waistExactPlaceholder: "or exact value, cm",
      activityAlert: "Physical activity is required to continue.",
      activityGoalAlert: "Please answer the question about your activity goal.",
      recoveryTitle: "Recovery",
      sleepHoursLabel: "Average hours of sleep",
      bedtimeLabel: "Usual bedtime",
      recoveryPracticesLabel: "Recovery practices",
      otherLabel: "Other",
      otherTextPlaceholder: "What exactly?",
      stressLevelLabel: "Stress level",
      nutritionStepTitle: "Nutrition",
      habitsTitle: "Bad habits",
      cigarettesLabel: "Cigarettes per day (0 if you don't smoke)",
      smokingGoalLabel: "Want to quit smoking?",
      vapeLabel: "Do you vape / use hookah?",
      yesLabel: "Yes",
      noLabel: "No",
      alcoholSummaryLabel: "Alcohol",
      alcoholSpiritsLabel: "Spirits, ml/week",
      alcoholWineLabel: "Wine, ml/week",
      alcoholBeerLabel: "Beer & low-alcohol cocktails, l/week",
      alcoholSpiritsPrefix: "spirits",
      alcoholWinePrefix: "wine",
      alcoholBeerPrefix: "beer",
      cigarettesAlert: "Cigarettes per day is required to continue (0 if you don't smoke).",
      smokingGoalAlert: "Please answer the question about your smoking goal.",
      healthTitle: "Health",
      illnessHasLabel: "Do you have any serious medical conditions?",
      illnessDetailLabel: "Details",
      revealTitle: "This is already your capital:",
      finishButton: "Go to the app",
      finishButtonRecalc: "Save recalculation",
      shareButton: "Share result",
      shareText: (days, word) => `My starting health capital — ${days} ${word}. Counting every day in Health Capital: humanchange.app/app/`,
      averageComparisonAbove: (pct) => `That's ${pct}% above the average for your age, sex, and region.`,
      averageComparisonNear: "That's about average for your age, sex, and region — and this is just the starting point.",
      averageComparisonBelow: (pct) => `That's ${pct}% below the average for your age, sex, and region. Not a verdict — a starting point you can grow from today.`,
    },
    common: {
      copied: "Copied!",
      copyFailed: "Couldn't copy",
      save: "Save",
    },
    dashboard: {
      title: "Portfolio",
      trendSuffix: "over 7 days",
      periodWeek: "Week",
      periodMonth: "Month",
      periodYear: "Year",
      todaySummaryTitle: "Today's summary",
      markTodayTitle: "Log today",
      daysAbbrev: "days",
      chartEmpty: "No data yet — log your first day below.",
    },
    history: {
      calendarTitle: "History",
      editingUnavailable: "Editing unavailable",
      transactionsTitle: (date) => `Transactions for ${date}`,
      noOperations: "No activity this day.",
      editButton: "Edit",
      changeDayTitle: "Edit day",
      fillDayTitle: "Fill in day",
      editWindowNote: "Editing is only available for the last 7 days, and not before your signup date.",
      personalSavingsLabel: "Personal savings",
      dividendsLabel: "Dividends",
      chargesLabel: "Charges",
      weeklySportBonusLabel: (weekStart, date) => `Weekly sport bonus (week ${weekStart}–${date})`,
      weeklySportBonusShortLabel: "Weekly sport bonus",
      sleepDebtLabel: "Sleep debt",
      sleepRegularityLabel: "Sleep regularity",
      inactivityChargeLabel: (sphere, days, pct) => `Inactivity (${sphere}): ${days}+ days, −${pct}% of dividends`,
      sportSphere: "sport",
      activitySphereFallback: "activity",
      summaryCardTitle: "Investments & dividends",
      summaryCardHint: "Your capital broken down by source, all-time",
      summaryTitle: "Investment summary",
      summaryEmpty: "No data yet — log at least one day.",
      summaryDividendsAggregateLabel: (weeks) => `Weekly activity top-ups (${weeks} wk.)`,
      summaryInactivityAggregateLabel: (sphere) => `Inactivity (${sphere}), total`,
    },
    knowledge: {
      title: "Knowledge Base",
      comingSoon: "coming soon",
      readingListTitle: "Further reading",
      sourcesTitle: "Sources",
      sourcesNote: "The full list of scientific sources the model is based on, with direct links. Grows as new factors are added.",
      additionalLink: "additional link",
      additionalSource: "additional source",
      upcomingTitle: "What's ahead",
      upcomingNote: "The vote counters below are an example visualization; actual suggestion aggregation is done manually by the team.",
    },
    daily: {
      summaryLowActivity: "Add 30 minutes of activity today — that's a real boost to your capital.",
      summaryLessThanUsual: "Less than usual — recorded.",
      summaryMoreThanUsual: "More than usual — it happens, let's continue tomorrow.",
      summaryGood: "You're active today — you're already one of the people who move every day, not just occasionally.",
    },
    factorLabels: {
      sport: "Activity",
      sleep: "Sleep",
      nutrition: "Nutrition",
      smoking: "Smoking",
      alcohol: "Alcohol",
      stress: "Stress",
      weight: "Weight",
      social: "Social connections",
      cognitive: "Cognitive activity",
      purpose: "Purpose",
    },
    factorFields: {
      smokingLabelToday: "Cigarettes today",
      smokingLabel: "Cigarettes",
      smokingWaterlineHint: (n) => `Your usual baseline: ${n}. The change is measured against it.`,
      activityLabelToday: "Minutes of activity today",
      activityLabel: "Minutes of activity",
      activityHint: "A slow walk doesn't count — see the Knowledge Base for details.",
      sleepLabelToday: "Sleep last night",
      sleepLabel: "Sleep (last night)",
      sleepHoursPlaceholder: "E.g., 7.5",
      sleepHoursHint: "In hours, decimals allowed.",
      bedtimeLabelEdit: "What time did you go to sleep the night before",
      bedtimeLabelToday: "What time did you go to sleep last night",
      alcoholLabelToday: "Alcohol today",
      alcoholLabel: "Alcohol",
      alcoholSpiritsLabel: "Spirits",
      alcoholWineLabel: "Wine",
      alcoholBeerLabel: "Beer/low-alcohol",
      socialLabel: "Time with loved ones today",
      socialHint: "Counts as engaged in-person or call time — a real conversation, time together. Work messaging doesn't count.",
      weightLabel: "Weight today, kg (optional)",
      bodyFatLabel: "Body fat % (optional)",
      bodyFatHint: "A more precise picture of body composition than weight alone.",
      purposeLabel: "Did you feel a sense of purpose in what you did today?",
      cognitiveLabel: "Did you learn something new or tackle a hard problem today?",
      cognitiveHint: "This kind of load builds new neural connections — it works like a workout for the brain.",
      stressLabelToday: "Stress level today",
      stressLabel: "Stress level",
    },
    socialQualityOptions: {
      full: "Fully engaged", some: "A little", none: "None",
    },
    purposeOptions: {
      yes: "Yes", somewhat: "Somewhat", no: "No",
    },
    cognitiveActivityOptions: {
      full: "A lot", some: "A little", none: "None",
    },
    settings: {
      title: "Settings",
      accountRowLoggedIn: (email) => `Account — ${email}`,
      accountRowLoggedOut: "Sign in / Sign up",
      referralRow: "Invite a friend",
      careRow: "Care & Idea Fund",
      factorsRow: "Home screen factors",
      billingRow: "Plans & billing",
      billingTitle: "Plans & billing",
      billingIntro: "New users get a free trial period. After the trial: 990–1490 RUB/month (Russian card/bank payment). Founding member: 9,900 RUB/year (about 825 RUB/month), locked in for as long as the subscription stays active.",
      billingNoAutopayHint: "There's no automatic in-app payment yet — payment processing isn't connected. Tap the button below to open a pre-filled email; send it and we'll manually send you a payment link.",
      billingRequestButton: "Request a payment link",
      billingRequestedHint: (date) => `Request sent ${date}. If the email didn't open automatically, write to us directly: `,
      billingEmailSubject: "Payment link request — Health Capital",
      billingEmailBody: (email) => `Hello!\n\nPlease send me a payment link for the Health Capital subscription.\n${email ? `My email in the app: ${email}\n` : ""}\nThank you!`,
      back: "← Back",
      referralTitle: "Invite a friend",
      referralHint: "Copy and send — no links or codes, just a short invitation.",
      referralShareText: "I track my health days in the Health Capital app — try it: humanchange.app/app/",
      copyButton: "Copy",
      languageLabel: "Language",
      fitnessTrackersRow: "Fitness tracker sync",
      accountTitle: "Account",
      accountLoggedInHint: (email) => `Signed in as ${email}.`,
      signOut: "Sign out",
      accountOptionalHint: "An account is only needed for billing and syncing across devices — without one the app keeps working as before, and all data stays on this device.",
      emailLabel: "Email",
      passwordLabel: "Password",
      signUp: "Sign up",
      signIn: "Sign in",
      haveAccount: "I already have an account",
      needAccount: "Don't have an account — sign up",
      fillEmailPassword: "Fill in your email and password.",
      genericAuthError: "That didn't work. Check your details and try again.",
      factorsTitle: "Home screen factors",
      notificationsTitle: "Notifications",
      notificationsEmpty: "No notifications yet.",
    },
    recoveryPractices: {
      yoga: "Yoga",
      breathing: "Breathing exercises",
      hardening: "Cold exposure / hardening",
      nailBoard: "Nail board (sadhu board)",
      banya: "Sauna / banya",
      massage: "Massage",
    },
    sleepHoursOptions: {
      lt5: "less than 5h", "5to6": "5–6h", "6to7": "6–7h", "7to8": "7–8h", "8to9": "8–9h", gt9: "more than 9h",
    },
    bedtimeOptions: {
      before22: "before 10pm", "22to24": "10pm–midnight", afterMidnight: "after midnight", varies: "it varies", custom: "custom",
    },
    stressLevelOptions: {
      "1": "1 — low", "2": "2", "3": "3 — medium", "4": "4", "5": "5 — high",
    },
    nutrition: {
      quantityTitle: "Quantity",
      mealsLabel: "Meals",
      snacksLabel: "Snacks",
      proteinTitle: "Protein",
      proteinTimesLabel: "Times a day",
      proteinEveryMeal: "With every meal",
      proteinGramsLabel: "Grams/day",
      proteinGramsPlaceholder: "g",
      waterLabel: "Water",
      waterHint: "Only plain water counts — tea, coffee, and other drinks don't count.",
      sugarHint: "Doesn't count if it was within an hour before/after intense exercise, or during it — sugar is metabolized differently in that window.",
      waterAmountPlaceholder: "Amount",
      unitMl: "ml",
      unitL: "l",
      flourLabel: "Flour/grain foods",
      sugarLabel: "Sugar",
      supplementsLabel: "Supplements",
    },
    nutritionFlourOptions: {
      none: "None",
      wholegrainSourdough: "Whole-grain sourdough bread",
      wholegrainPasta: "Durum wheat pasta",
      white: "White bread",
    },
    nutritionSugarOptions: {
      none: "None",
      inProducts: "In food products",
      juices: "Juices",
      sweetDrinks: "Sweet drinks",
      added: "Added (to tea, coffee, etc.)",
    },
    nutritionSupplementOptions: {
      vitamins: "Vitamins",
      minerals: "Minerals",
      other: "Other",
    },
    alcoholSpiritsOptions: {
      "0": "0", lt100: "under 100 ml/wk", "100to350": "100–350 ml/wk", gt350: "over 350 ml/wk",
    },
    alcoholWineOptions: {
      "0": "0", lt350: "under 350 ml/wk", "350to1000": "350–1000 ml/wk", gt1000: "over 1000 ml/wk",
    },
    alcoholBeerOptions: {
      "0": "0", lt700: "under 0.7 l/wk", "700to2000": "0.7–2 l/wk", gt2000: "over 2 l/wk",
    },
    welcome: {
      title: "Welcome to Health Capital",
      intro: "Five required questions, plus a few optional ones. The more you fill in, the more accurate the result.",
      dataNote: "We collect this data to calculate your personal health capital. Right now everything is stored locally on your device and isn't sent anywhere.",
      disclaimer:
        "An averaged statistical estimate based on data from people with a similar profile — age, gender, region, and other factors (not a precise calculation for you personally) — based on scientific research, not a medical diagnosis or personal recommendation.",
      consent: "I have read and agree",
      start: "Start →",
    },
    regions: {
      us: "USA", ru: "Russia", by: "Belarus", ua: "Ukraine", kz: "Kazakhstan",
      de: "Germany", gb: "United Kingdom", fr: "France", es: "Spain",
      it: "Italy", pl: "Poland", il: "Israel", ca: "Canada", au: "Australia",
      other: "Other country",
    },
    activityOptions: {
      lt150: "less than 150 min/wk",
      "150to300": "150–300 min/wk",
      gt300: "more than 300 min/wk",
    },
    waistOptions: {
      lt80: "under 80 cm",
      "80to95": "80–95 cm",
      "95to110": "95–110 cm",
      gt110: "over 110 cm",
    },
  },
};

function getLang() {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  return saved === "en" ? "en" : "ru"; // ru is the default for anything else, including unset
}

function setLang(lang) {
  localStorage.setItem(LANG_STORAGE_KEY, lang === "en" ? "en" : "ru");
}

// t("onboarding.next") -> STRINGS[currentLang].onboarding.next, falling
// back to the ru value (never to the raw key) if the current language is
// missing that key — so a partially-translated screen degrades to
// Russian text instead of showing "onboarding.next" literally.
function t(key) {
  const lang = getLang();
  const lookup = (dict) => key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), dict);
  const value = lookup(STRINGS[lang]);
  return value !== undefined ? value : lookup(STRINGS.ru);
}

function localizedRegionOptions() {
  return REGION_OPTIONS.map((o) => ({ value: o.value, label: t(`regions.${o.value}`) }));
}

// Same pattern as localizedRegionOptions: canonical option lists
// (ACTIVITY_RANGE_OPTIONS/WAIST_RANGE_OPTIONS) keep their extra fields
// (e.g. midpointMinutes, still used by the formula) untouched — these
// helpers only produce a value/label pair for rendering the <select>.
function localizedActivityRangeOptions() {
  return ACTIVITY_RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(`activityOptions.${o.value}`) }));
}

function localizedWaistRangeOptions() {
  return WAIST_RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(`waistOptions.${o.value}`) }));
}

function localizedSleepHoursRangeOptions() {
  return SLEEP_HOURS_RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(`sleepHoursOptions.${o.value}`) }));
}

function localizedBedtimeRangeOptions() {
  return BEDTIME_RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(`bedtimeOptions.${o.value}`) }));
}

function localizedStressLevelOptions() {
  return STRESS_LEVEL_OPTIONS.map((o) => ({ value: o.value, label: t(`stressLevelOptions.${o.value}`) }));
}

function localizedSocialQualityOptions() {
  return SOCIAL_QUALITY_OPTIONS.map((o) => ({ value: o.value, label: t(`socialQualityOptions.${o.value}`) }));
}

function localizedPurposeOptions() {
  return PURPOSE_OPTIONS.map((o) => ({ value: o.value, label: t(`purposeOptions.${o.value}`) }));
}

function localizedCognitiveActivityOptions() {
  return COGNITIVE_ACTIVITY_OPTIONS.map((o) => ({ value: o.value, label: t(`cognitiveActivityOptions.${o.value}`) }));
}

// RECOVERY_PRACTICES isn't a <select> (rendered as checkboxes), so unlike
// the helpers above this returns objects with the same "key" property
// the checkbox-rendering template already reads, not "value".
function localizedRecoveryPractices() {
  return RECOVERY_PRACTICES.map((p) => ({ key: p.key, label: t(`recoveryPractices.${p.key}`) }));
}

function localizedAlcoholSpiritsOptions() {
  return ALCOHOL_SPIRITS_RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(`alcoholSpiritsOptions.${o.value}`) }));
}

function localizedAlcoholWineOptions() {
  return ALCOHOL_WINE_RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(`alcoholWineOptions.${o.value}`) }));
}

function localizedAlcoholBeerOptions() {
  return ALCOHOL_BEER_RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(`alcoholBeerOptions.${o.value}`) }));
}

/* ---------------------------------------------------------------------
 * Auth (Supabase) — added 22.08.2026. Fully optional layer: the app
 * works exactly as before with no account (local-only, per-device). An
 * account exists only so a user CAN pay and/or sync across devices —
 * it does not gate any existing screen or feature.
 *
 * TODO(backend): merging pre-existing local data into a freshly created
 * account is NOT handled yet (deliberately deferred — see chat log
 * 22.08.2026, risk of silently overwriting a user's local history).
 * Right now sign-up/sign-in only sets state.authEmail; local ledger
 * data stays local either way.
 * ------------------------------------------------------------------- */

const SUPABASE_URL = "https://srapibbfdhjpvjtkuzjb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qbue7KqQH5_UQ4hdQge9iw_spRCFCvn";

const sb =
  typeof window !== "undefined" && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

async function authSignUp(email, password) {
  if (!sb) return { error: { message: "Supabase недоступен (не загрузился SDK)." } };
  const { data, error } = await sb.auth.signUp({ email, password });
  if (!error && data.user) {
    state.authEmail = data.user.email;
    saveState();
  }
  return { data, error };
}

async function authSignIn(email, password) {
  if (!sb) return { error: { message: "Supabase недоступен (не загрузился SDK)." } };
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (!error && data.user) {
    state.authEmail = data.user.email;
    saveState();
  }
  return { data, error };
}

async function authSignOut() {
  if (sb) await sb.auth.signOut();
  state.authEmail = null;
  saveState();
}

// Restores a persisted Supabase session (SDK keeps it in its own
// localStorage key) after the first paint, so a returning logged-in
// user sees their email in Settings without needing to log in again.
// Fire-and-forget: does nothing if there's no session or SDK failed to
// load, and never blocks the initial render.
async function authRestoreSession() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  const email = data && data.session && data.session.user ? data.session.user.email : null;
  if (email && email !== state.authEmail) {
    state.authEmail = email;
    saveState();
    if (state.nav === "settings") render();
  }
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
    historyDetailDate: null, // date shown on the full-screen "Транзакции за день" view, TZ section 7, 13.08.2026
    historyDayEditMode: false, // whether that screen's fill/edit form is expanded, TZ section 7, 17.08.2026
    settingsView: "root", // "root" | "care" | "factors" | "account" — sub-screen open within Настройки, TZ section 7, 13.08.2026
    authEmail: null, // email of the logged-in Supabase account, or null if using the app locally without one (22.08.2026)
    dashboardEditFactor: null, // factor key whose full-screen entry page is open, or null for the normal dashboard, 20.08.2026
    // TEMP (19.08.2026): all factors on by default for the focus-group
    // review pass — trim per-user via Настройки → Факторы afterward.
    // Was a fixed subset (sport/sleep/nutrition/stress). Written out
    // literally (matching ALL_FACTORS' keys, defined further down)
    // rather than referencing ALL_FACTORS directly — this runs at
    // script top-level via `let state = loadState()` before that later
    // const is initialized, so referencing it here throws a
    // temporal-dead-zone ReferenceError.
    visibleFactors: ["smoking", "sport", "sleep", "alcohol", "nutrition", "stress", "social", "weight", "purpose", "cognitive"],
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

// Lightweight funnel tracking (26.08.2026, switched from Plausible SaaS to
// self-hosted Umami same day — less privacy-policy overhead: no
// third-party processor to disclose/DPA, since it runs on infrastructure
// already ours, see TASKS.md). Loaded via a script tag in app/index.html
// pointed at our own Umami instance. Guarded because window.umami won't
// exist: in app.test.js's sandbox (no such global at all), before the
// deferred script has finished loading, or for any real visitor running an
// ad blocker — common for exactly this audience (privacy-conscious
// health-app users). That undercount is a disclosed, accepted limitation
// of using a client-side script for analytics, not something this guard
// can fix; it only prevents a hard crash when the function is missing.
function trackEvent(name) {
  if (typeof window !== "undefined" && window.umami && typeof window.umami.track === "function") {
    window.umami.track(name);
  }
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
// to daily active factors (TZ section 3.3 — alcohol's daily
// bucket-coefficient/binary mechanic, see dailyAlcoholDelta below; sleep's
// cumulative-debt mechanic, see sleepDebtPenalty/sleepRegularityPenalty
// further down, TZ section 3.3.1) — each its own disclosed
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

// Population prevalence of each risk factor (23.08.2026 — symmetric-
// correction methodology review, see chat). Confirmed by re-reading Tsai's
// own Methods (Table 3, "reference group" column) that the years-lost
// figures above are NOT "risk factor vs. population average" — they are
// "risk factor present vs. a specific named reference subgroup" (smoking:
// current smoker vs never smoker; activity: <3.75 vs >=7.5 MET-h/wk).
// Tsai's own Discussion states this explicitly: "different health risks
// based on different reference groups cannot be directly compared." Our
// baseline table (LIFE_EXPECTANCY_TABLE) is a general population average
// that already contains smokers/inactive people — so subtracting the full
// years-lost figure only from people WHO HAVE the risk factor, while
// giving a "clean" respondent a flat 0, silently (and incorrectly) treats
// that population-average baseline as if it were the risk-free reference
// group.
// Fix: if p = population share WITH the risk factor, keeping the
// population-weighted average anchored to the baseline table requires:
//   penalty (has risk factor)      = (1 - p) * Y
//   bonus   (reference/"clean")    = p * Y
// (derivation: avg = p*(baseline-penalty) + (1-p)*(baseline+bonus) =
// baseline  =>  p*penalty = (1-p)*bonus, and penalty+bonus = Y (Tsai's raw
// figure)  =>  penalty = (1-p)*Y, bonus = p*Y.)
// Only RU and US have sourced prevalence right now (project's current +
// planned future audience, per explicit user scope, 23.08.2026); other
// regions fall back to the RU figures — the same simplification already
// used by regionAdjustmentPct's flat non-US discount above. Alcohol is
// deliberately NOT symmetrized yet: Tsai's "regular drinker" definition is
// a compound frequency+quantity threshold (>=2 drinks, >=3x/week) that
// doesn't cleanly match the survey categories found so far (quantity-only
// or frequency-only breakdowns) — left as an open item, do not invent a
// number for it.
const RISK_FACTOR_PREVALENCE = {
  smoking: {
    // Current smoker: WHO/GSTHR 2024 (RU); CDC NHIS 2024 (US).
    ru: { male: 0.36, female: 0.12 },
    us: { male: 0.241, female: 0.139 },
  },
  activity: {
    // Below 150 min/week moderate activity ("insufficient") — our
    // ACTIVITY_RANGE_OPTIONS "lt150" bucket, used as the working proxy for
    // Tsai's own <3.75 MET-h/wk threshold (same disclosed approximation
    // as tsaiYearsLostTotal already made pre-23.08.2026). RU: Rosstat/
    // GPAQ STEPS 2018-2019, sex-specific. US: CDC combined estimate,
    // 2017-2020 — no sex-specific split found, so the same figure is used
    // for both sexes here (a disclosed simplification, not a sourced sex
    // difference).
    ru: { male: 0.25, female: 0.28 },
    us: { male: 0.25, female: 0.25 },
  },
};

function riskFactorPrevalence(factor, region, gender) {
  const table = RISK_FACTOR_PREVALENCE[factor];
  const regionTable = region === "us" ? table.us : table.ru;
  if (gender === "male") return regionTable.male;
  if (gender === "female") return regionTable.female;
  return (regionTable.male + regionTable.female) / 2; // same averaging convention as yearsLostForGender
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
// sleepDebtPenalty/dailyAlcoholDelta below for where they live now.
//
// 23.08.2026: smoking and activity are now symmetric (see
// RISK_FACTOR_PREVALENCE above for the full derivation) — someone WITH
// the risk factor gets a reduced penalty (1-p)*Y, someone WITHOUT it gets
// a real bonus p*Y (previously a flat 0), where p is the region+gender
// population prevalence of that risk factor. The return value can now be
// negative (net bonus, both factors clean) — computeStartingCapitalDays
// already handles this correctly since it just subtracts this value from
// baselineYears (subtracting a negative = adding).
function tsaiYearsLostTotal(ob) {
  const region = ob.region;
  const gender = ob.gender;

  const smokingY = yearsLostForGender("smoking", gender);
  const pSmoking = riskFactorPrevalence("smoking", region, gender);
  const smokingHasRisk = Number(ob.cigarettesPerDay) > 0;
  const smokingYears = smokingHasRisk ? (1 - pSmoking) * smokingY : -(pSmoking * smokingY);

  // Approximation, NOT from the source: the paper measures inactivity in
  // MET-hours/week (<3.75 vs a >=7.5 reference); we only collect WHO
  // minutes/week buckets. "lt150" is used as a working proxy for the
  // paper's inactivity threshold, not a verified unit conversion.
  const activityProvided = ACTIVITY_RANGE_OPTIONS.some((o) => o.value === ob.activityRange);
  const activityY = yearsLostForGender("activity", gender);
  const pActivity = riskFactorPrevalence("activity", region, gender);
  const activityHasRisk = activityProvided && ob.activityRange === "lt150";
  const activityYears = !activityProvided
    ? 0 // unanswered stays neutral, not bucketed into either group
    : activityHasRisk
      ? (1 - pActivity) * activityY
      : -(pActivity * activityY);

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

// "Средний капитал" для человека такого же возраста/пола/региона —
// добавлено 26.08.2026 по прямому запросу пользователя ("сравнивать надо
// со средним значением в этом регионе с таким возрастом и полом, то что у
// нас уже есть"). Намеренно НЕ процентиль/ранг ("топ X%") — для этого
// нужно было бы распределение по популяции, которого у нас нет; это
// сравнение с одной реальной опорной точкой. Использует ровно те же
// baselineYears/regionPct, что и computeStartingCapitalDays выше, но БЕЗ
// личных факторов человека (yearsLost, illnessPct) — иначе это было бы
// сравнение не со средним, а с самим собой.
function averageBaselineDaysForPeer(ob) {
  const baselineYears = interpolateLifeExpectancyYears(ob.gender, ob.age);
  const regionPct = regionAdjustmentPct(ob.region);
  return Math.max(Math.round(baselineYears * 365.25 * (1 + regionPct)), 0);
}

// Band around 0% treated as "about average" rather than forcing every
// tiny rounding difference into an "above"/"below" sentence. Own
// judgment call, not sourced — no methodology requires a specific
// threshold here.
const AVERAGE_COMPARISON_NEAR_BAND_PCT = 5;

// Reveal-screen comparison line (added 26.08.2026 per user request:
// "сравнивать надо со средним значением в этом регионе с таким возрастом
// и полом, то что у нас уже есть"). Deliberately factual/neutral, not
// praise or blame — same wellbeing principle already applied to
// onboardingResultTier's region exclusion above, just for a different
// (informational, not effort-framed) line. Never hides an unflattering
// number — that would contradict the app's own "open formula" stance —
// but pairs a below-average result with a non-shaming, forward-looking
// sentence instead of omitting it.
function onboardingComparisonHtml(ob, revealDays) {
  const averageDays = averageBaselineDaysForPeer(ob);
  if (averageDays <= 0) return "";
  const diffPct = Math.round(((revealDays - averageDays) / averageDays) * 100);
  let text;
  if (diffPct > AVERAGE_COMPARISON_NEAR_BAND_PCT) {
    text = t("onboarding.averageComparisonAbove")(diffPct);
  } else if (diffPct < -AVERAGE_COMPARISON_NEAR_BAND_PCT) {
    text = t("onboarding.averageComparisonBelow")(Math.abs(diffPct));
  } else {
    text = t("onboarding.averageComparisonNear");
  }
  return `<div class="reveal-comparison">${escapeHtml(text)}</div>`;
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
  const minutes = Number(activityMinutesToday) || 0;
  const activityGain = Math.min((minutes / 60) * 6, 9) / 24;
  return activityGain + smokingTerm;
}

// TZ section 3.3.1, 16.08.2026: replaces the old flat per-day bucket
// model above. Two independent mechanisms:
//
//   1. Nonlinear cumulative "sleep debt" (two-process-model-inspired):
//      долг(N) = долг(N-1) × k + (норма_сна − факт_сна(N)), penalized by
//      a convex (accelerating) function of the accumulated debt instead
//      of a flat per-day delta — a single bad night matters less than
//      the same deviation sustained for a week.
//   2. Bedtime regularity (simplified Sleep Regularity Index, UK
//      Biobank) — independent of the debt above; penalizes an unstable
//      bedtime even when average sleep duration is fine.
//
// TZ explicitly leaves k and the debt→penalty conversion "at the
// implementation's discretion" (only the 0.7-0.85 range for k, and the
// JAHA-sourced 13%/6% oversleep/undersleep steepness ratio, are given).
// The constants below are THIS implementation's disclosed choice, not a
// verified clinical calibration — see the Sleep card in the Knowledge
// Base and Source_* entries for the explicit "own interpretation, not a
// single cited methodology" disclosure TZ requires.

// Reference point for the debt recurrence — the same 7-8h optimum the
// old model centered on (SLEEP_HOURS_RANGE_OPTIONS' own bucket
// midpoints), not a separately chosen number.
const SLEEP_DEBT_NORM_HOURS = 7.5;
// Decay per calendar day; TZ range is 0.7-0.85, this is the midpoint.
const SLEEP_DEBT_DECAY_K = 0.8;
// Convex (quadratic) penalty per day of accumulated debt. Oversleep
// (debt < 0) is steeper than undersleep (debt > 0) by the JAHA 13%/6%
// ratio. Magnitude calibrated so a STEADY ~1h/day undersleep — which
// converges to a debt of 1/(1-k) = 5 at k=0.8 — costs roughly the same
// order of magnitude as the old flat model's worst bucket (~0.0138
// days/day), so the replacement doesn't jump to a wildly different
// scale; not itself a sourced target.
const SLEEP_DEBT_UNDER_COEFF = 0.0008;
const SLEEP_DEBT_OVER_COEFF = SLEEP_DEBT_UNDER_COEFF * (13 / 6);

// Small positive daily bonus for hitting the sleep target (25.08.2026,
// user request: "поощрять своевременный отход ко сну и количество сна
// минимальным приростом капитала" — until now this model only ever
// penalized, never rewarded; debt=0 was the best a day could score).
// Same "don't invent a number" principle as the smoking/activity
// symmetrization earlier this session, but reallocation math doesn't
// carry over directly — Yin et al. 2017's own RR values treat ~7h as
// the REFERENCE (RR=1.0), not a category with an extractable protective
// magnitude below that baseline, so there's no dose-response figure to
// split. Instead: reuse a real population-prevalence figure (CDC/NCHS
// NHIS 2024 Data Brief No. 559 — 30.5% of US adults average <7h sleep)
// as the share of the model's own already-calibrated steady-state
// undersleep penalty (~0.0138 days/day for a chronic 1h/day shortfall,
// see SLEEP_DEBT_UNDER_COEFF comment) that a good sleeper "gets back."
// Deliberately small per the user's own "минимальным" — at 2 decimal
// places this will often display as 0.00 rather than a visible +figure;
// flagged as a product/UX judgment call if a more visible number is
// wanted later (that would no longer be strictly derived from a source).
// Region-agnostic (unlike RU/US-split smoking/activity) because the rest
// of this sleep-debt model doesn't vary by region either.
const SLEEP_SHORT_PREVALENCE_US = 0.305;
const SLEEP_DEBT_STEADY_STATE_PENALTY_REF = 0.0138;
const SLEEP_DEBT_GOOD_BONUS = SLEEP_SHORT_PREVALENCE_US * SLEEP_DEBT_STEADY_STATE_PENALTY_REF;
// "On target" band = the user's own framing, "сон в норме (7-8ч)" —
// SLEEP_DEBT_NORM_HOURS (7.5h) ± 0.5h.
const SLEEP_DEBT_GOOD_BAND_HOURS = 0.5;

// 26.08.2026, user request: oversleep that's compensating for a recent
// sharp sleep debt, or for an extreme one-off exertion event (example
// given: an ultramarathon or Ironman), is recovery — not the same thing
// as ordinary oversleep — and shouldn't carry the (steeper) oversleep
// penalty. JUDGMENT CALL, not sourced: the thresholds below are the
// author's own choice of "how much counts as sharp/extreme", same
// category as SLEEP_DEBT_DECAY_K's midpoint choice above.
const SLEEP_RECOVERY_LOOKBACK_DAYS = 3; // user's own wording: "накануне (1-3 дня назад)"
// Debt carried INTO today (i.e. `decayed` in cascadeRecalcFrom, before
// today's own deviation is added) at/above this counts as "sharp recent
// insomnia" — roughly one clearly short night (~2-3h under norm) still
// weighing on today after one day of decay.
const SLEEP_RECOVERY_DEBT_THRESHOLD_HOURS = 2;
// No dedicated "extreme event" flag exists in the data model, so this
// uses the existing activityMinutes field as a proxy: normal daily
// activity gain already caps at 90 min (see dailyDeltaDays), so a
// logged value at/above this is well outside ordinary training and
// stands in for "ultramarathon/Ironman/etc.-scale" effort.
const SLEEP_RECOVERY_ACTIVITY_THRESHOLD_MIN = 240;

// Checks the SLEEP_RECOVERY_LOOKBACK_DAYS calendar days strictly BEFORE
// dateStr (not including dateStr itself — "накануне") for any single day
// at/above the extreme-exertion proxy threshold.
function hadRecentExtremeExertion(dateStr) {
  for (let back = 1; back <= SLEEP_RECOVERY_LOOKBACK_DAYS; back++) {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - back);
    const key = d.toISOString().slice(0, 10);
    const entry = state.ledger[key];
    if (entry && Number(entry.activityMinutes) >= SLEEP_RECOVERY_ACTIVITY_THRESHOLD_MIN) return true;
  }
  return false;
}

// hasTodayData guards the bonus specifically (25.08.2026 fix): debt can
// land at/near 0 just from decay or from a day with NO sleep hours
// logged at all (deviation defaults to 0 when factHours is undefined —
// see cascadeRecalcFrom) — that's an absence of data, not evidence of
// good sleep, and shouldn't be rewarded. Omitting the flag (e.g. direct
// unit-test calls) falls back to the plain quadratic, matching the
// original always-penalize-or-zero behavior exactly.
// isRecoveryContext (26.08.2026): when the day nets out as oversleep
// (debt < 0) AND recent sharp sleep debt or extreme exertion was
// detected, the oversleep penalty is suppressed (returns 0 — neutral,
// not bonused) rather than charged at the steeper SLEEP_DEBT_OVER_COEFF
// rate. Doesn't affect the undersleep side at all.
function sleepDebtPenalty(debt, hasTodayData, isRecoveryContext) {
  if (hasTodayData && Math.abs(debt) <= SLEEP_DEBT_GOOD_BAND_HOURS) return SLEEP_DEBT_GOOD_BONUS;
  if (debt < 0 && isRecoveryContext) return 0;
  const coeff = debt > 0 ? SLEEP_DEBT_UNDER_COEFF : SLEEP_DEBT_OVER_COEFF;
  return -(coeff * debt * debt) || 0; // avoid returning -0 at debt=0
}

// Whole calendar days between two 'YYYY-MM-DD' dates (b − a), UTC —
// same date-label convention as todayStr()/mondayOfWeek() elsewhere.
function daysBetweenDates(a, b) {
  const da = new Date(a + "T00:00:00Z");
  const db = new Date(b + "T00:00:00Z");
  return Math.round((db - da) / 86400000);
}

// Regularity subfactor (Mechanism 2) — minutes-from-midnight for a
// "HH:MM" bedtime, shifted so evening/past-midnight bedtimes stay on one
// continuous scale (00:10 becomes 24:10, comparable to 23:50) instead of
// wrapping around the literal clock. Assumes bedtimes cluster in the
// evening/early morning, not exactly at midday — true for this field.
function circularBedtimeMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  let mins = h * 60 + (m || 0);
  if (mins < 12 * 60) mins += 24 * 60;
  return mins;
}

const SLEEP_REGULARITY_WINDOW_DAYS = 14; // TZ: "за последние 7-14 дней"
const SLEEP_REGULARITY_MIN_SAMPLES = 7; // TZ: "в достаточном объёме"
const SLEEP_REGULARITY_THRESHOLD_MIN = 30; // SD below this = "regular enough", no penalty
const SLEEP_REGULARITY_SD_FOR_MAX_MIN = 120; // SD at/above this = full penalty
const SLEEP_REGULARITY_MAX_PENALTY_DAYS = 0.02;

// Simplified Sleep Regularity Index (TZ 3.3.1, mechanism 2): standard
// deviation of bedtime across the trailing window relative to the
// user's OWN average (not an abstract norm), among days that actually
// have a bedtime logged. Below SLEEP_REGULARITY_MIN_SAMPLES data points
// in the window, the mechanism is inactive — no penalty for not
// entering the optional field, per TZ.
function sleepRegularityPenalty(uptoDateStr) {
  const windowStart = new Date(uptoDateStr + "T00:00:00Z");
  windowStart.setUTCDate(windowStart.getUTCDate() - (SLEEP_REGULARITY_WINDOW_DAYS - 1));
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  const samples = [];
  for (const date of sortedLedgerDates()) {
    if (date < windowStartStr || date > uptoDateStr) continue;
    const entry = state.ledger[date];
    if (entry && entry.bedtimeToday) samples.push(circularBedtimeMinutes(entry.bedtimeToday));
  }
  if (samples.length < SLEEP_REGULARITY_MIN_SAMPLES) return 0;

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  const sd = Math.sqrt(variance);

  // Same small-bonus-for-good-behavior fix as sleepDebtPenalty
  // (25.08.2026): being regular enough used to just avoid a penalty
  // (return 0); now it earns the same reallocated share of the
  // penalty pool as the duration bonus (SLEEP_SHORT_PREVALENCE_US ×
  // this mechanism's own max penalty, not an invented figure) — this
  // one IS visible at 2dp (~0.006 days, rounds to +0.01).
  if (sd <= SLEEP_REGULARITY_THRESHOLD_MIN) return SLEEP_SHORT_PREVALENCE_US * SLEEP_REGULARITY_MAX_PENALTY_DAYS;
  const t = Math.min(
    1,
    (sd - SLEEP_REGULARITY_THRESHOLD_MIN) / (SLEEP_REGULARITY_SD_FOR_MAX_MIN - SLEEP_REGULARITY_THRESHOLD_MIN)
  );
  return -(t * SLEEP_REGULARITY_MAX_PENALTY_DAYS);
}

// Binary, not dose-scaled (TZ section 3.3): the Tsai source has no
// dose-response data for alcohol, so "drank today" (any of the 3 fields
// above its "0" bucket, same check as isRegularDrinkerApprox) applies the
// full daily-equivalent anchor; not drinking is neutral, no deposit.
// Same "disclosed rough approximation" caveat as the sleep mechanism above.
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

/* ---------------------------------------------------------------------
 * Retroactive entry (TZ, 16.08.2026): "История" tap opens a fill/edit
 * form for any day from onboarding through today, capped at 30 days
 * back. Editing a past day cascades — deltaDays, the weekly sport
 * bonus, and inactivity-decay charges are all re-derived for every
 * ledger entry from the edited date through today, same formulas as a
 * normal same-day save, just re-run over a range. See cascadeRecalcFrom.
 * ------------------------------------------------------------------- */

// Furthest-back editable date: 7 days before today, inclusive (today
// minus 7 days is still editable; today minus 8 is not). Was 30 days —
// narrowed 23.08.2026.
function retroCutoffDate(today = todayStr()) {
  const cutoff = new Date(today + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  return cutoff.toISOString().slice(0, 10);
}

function isDateEditable(dateStr) {
  const today = todayStr();
  if (dateStr > today) return false;
  if (!state.createdAt || dateStr < state.createdAt) return false;
  if (dateStr < retroCutoffDate(today)) return false;
  return true;
}

// Re-runs the same per-day/per-week/per-streak formulas the normal
// same-day save already used (dailyDeltaDays, the sleep-debt/regularity
// mechanism, dailyAlcoholDelta, weeklyActivityTopUpDays,
// applyInactivityDecay) for every EXISTING ledger entry from fromDate
// through today — none of those formulas change here, only the range
// they're applied to.
//
// Sleep debt is the one piece that's inherently sequential (each day's
// debt depends on the previous day's), not just per-day like the other
// factors — it's seeded from the last ledger entry strictly BEFORE
// fromDate (already-computed, untouched by this cascade) via
// daysBetweenDates, so a calendar-day gap with no entries still decays
// correctly without looping over empty days one by one
// (debt × k^gap === decaying once per empty day, since there's no
// deviation term to add on days with no entry).
//
// Order matters: deltaDays must be rebuilt first (weeklyBonusDays gets
// added on top of it in step 2), and decayCharges must be rebuilt last
// since its dividends base reads the just-recomputed weeklyBonusDays.
// decayCharges recorded on/after fromDate are discarded and replayed in
// chronological order — safe because a charge recorded for date D only
// ever depends on data up to and including D (see daysSinceLastActivity,
// which only looks backward), so charges before fromDate are unaffected
// by anything at or after it and don't need to move.
function cascadeRecalcFrom(fromDate) {
  const today = todayStr();
  const gender = state.onboarding.gender;
  const affectedDates = sortedLedgerDates().filter((d) => d >= fromDate && d <= today);

  const priorDates = sortedLedgerDates().filter((d) => d < fromDate);
  const seedDate = priorDates.length ? priorDates[priorDates.length - 1] : null;
  let runningDebt = seedDate ? state.ledger[seedDate].sleepDebt || 0 : 0;
  let runningDebtDate = seedDate || fromDate;

  for (const date of affectedDates) {
    const entry = state.ledger[date];
    const baseDelta = dailyDeltaDays(entry.cigarettes, entry.activityMinutes, state.smokingWaterline);

    const gapDays = Math.max(daysBetweenDates(runningDebtDate, date), 0);
    const decayed = runningDebt * Math.pow(SLEEP_DEBT_DECAY_K, gapDays);
    // Exact hours (20.08.2026, entered via sleepRowHtml's number input)
    // wins when present; falls back to the old bucket-midpoint lookup
    // for ledger entries saved before this change, which only have
    // sleepHoursRange.
    const factHours =
      entry.sleepHoursExact !== undefined && entry.sleepHoursExact !== null && entry.sleepHoursExact !== ""
        ? Number(entry.sleepHoursExact)
        : rangeLookup(SLEEP_HOURS_RANGE_OPTIONS, entry.sleepHoursRange, "midpointHours");
    const deviation = factHours !== undefined && !Number.isNaN(factHours) ? SLEEP_DEBT_NORM_HOURS - factHours : 0;
    const debt = decayed + deviation;
    entry.sleepDebt = debt;
    const hasTodaySleepData = factHours !== undefined && !Number.isNaN(factHours);
    const isRecoveryContext = decayed >= SLEEP_RECOVERY_DEBT_THRESHOLD_HOURS || hadRecentExtremeExertion(date);
    entry.sleepDebtDelta = sleepDebtPenalty(debt, hasTodaySleepData, isRecoveryContext);
    entry.sleepRegularityDelta = sleepRegularityPenalty(date);
    entry.sleepDelta = entry.sleepDebtDelta + entry.sleepRegularityDelta;
    runningDebt = debt;
    runningDebtDate = date;

    const alcoholDelta = dailyAlcoholDelta(entry.alcoholSpirits, entry.alcoholWine, entry.alcoholBeer, gender);
    entry.alcoholDelta = alcoholDelta;
    entry.deltaDays = baseDelta + entry.sleepDelta + alcoholDelta;
    delete entry.weeklyBonusDays;
  }

  for (const date of affectedDates) {
    if (new Date(date + "T00:00:00").getDay() !== 0) continue;
    const bonus = weeklyActivityTopUpDays(date);
    if (bonus > 0) {
      state.ledger[date].weeklyBonusDays = bonus;
      state.ledger[date].deltaDays += bonus;
    }
  }

  state.decayCharges = state.decayCharges.filter((c) => c.date < fromDate);
  for (const date of affectedDates) {
    applyInactivityDecay(date);
  }
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

// Shared "copy text, briefly confirm on the button itself" helper
// (23.08.2026) — used by the reveal screen's "Поделиться результатом"
// and Настройки → "Пригласить друга". No toast component in this app,
// so the confirmation is just the button's own label swapping to
// "Скопировано!" for a beat, then reverting — self-contained, no new UI
// primitive needed for two call sites.
function copyTextToClipboard(text, btn, originalLabel) {
  const revert = () => {
    btn.textContent = originalLabel;
  };
  const showCopied = () => {
    btn.textContent = t("common.copied");
    setTimeout(revert, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showCopied, () => {
      btn.textContent = t("common.copyFailed");
      setTimeout(revert, 1500);
    });
  } else {
    btn.textContent = t("common.copyFailed");
    setTimeout(revert, 1500);
  }
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
  // 24.08.2026: this is the very first screen anyone sees, before any
  // onboarding step — the language switcher belongs here even more than
  // on the steps that follow it (flagged by the user after checkpoint 2
  // shipped without it here). Same switcher markup/behavior as
  // renderOnboarding's, just re-rendering renderWelcomeScreen() instead
  // of the step flow on click.
  const langSwitcherHtml = `<div class="lang-switcher">
    <button class="lang-btn ${getLang() === "ru" ? "active" : ""}" data-lang="ru" ${getLang() === "ru" ? "disabled" : ""}>RU</button>
    <button class="lang-btn ${getLang() === "en" ? "active" : ""}" data-lang="en" ${getLang() === "en" ? "disabled" : ""}>EN</button>
  </div>`;
  root.innerHTML = `
    <div class="wrap">
      ${langSwitcherHtml}
      <div class="onboarding-header">
        <h1>${t("welcome.title")}</h1>
        <p>${t("welcome.intro")}</p>
      </div>
      <p>${t("welcome.dataNote")}</p>
      <p>${t("welcome.disclaimer")}</p>
      <div class="field">
        <label class="checkbox-row"><input type="checkbox" id="welcome-consent"> ${t("welcome.consent")}</label>
      </div>
      <button class="btn" id="welcome-start" style="width:100%" disabled>${t("welcome.start")}</button>
    </div>
  `;
  root.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLang(btn.dataset.lang);
      render();
    });
  });
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

// Russian pluralisation for the reveal-screen day count (21.08.2026
// onboarding redesign) — день/дня/дней, standard mod-10/mod-100 rule.
function dayWord(n) {
  const abs = Math.abs(Math.round(n || 0)) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

// English has no case system for this — just singular/plural (24.08.2026,
// i18n reveal-screen checkpoint).
function localizedDayWord(n) {
  if (getLang() === "en") {
    return Math.abs(Math.round(n || 0)) === 1 ? "day" : "days";
  }
  return dayWord(n);
}

// Required-field gate for the onboarding "Далее"/"Рассчитать" button
// (21.08.2026): mirrors the same conditions previously enforced only via
// alert() on click — now also drives a live-disabled pale button so the
// person can see before clicking whether they're done with a step.
// Steps not listed here (recovery, nutrition, health) have no required
// fields yet, so they're always valid.
function isStepValid(step, draft) {
  if (step === "basics") {
    return !!(draft.age && draft.gender && draft.region);
  }
  if (step === "activity_form") {
    if (!draft.activityRange) return false;
    if (draft.activityRange === "lt150" && draft.activityGoalConfirmed === undefined) return false;
    return true;
  }
  if (step === "habits") {
    if (draft.cigarettesPerDay === "" || draft.cigarettesPerDay === undefined || draft.cigarettesPerDay === null) return false;
    if (Number(draft.cigarettesPerDay) > 0 && draft.smokingGoalConfirmed === undefined) return false;
    return true;
  }
  return true;
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

// Bedtime picker (TZ, 17.08.2026) — two <select> dropdowns (hour,
// 15-minute increments) instead of a native <input type="time">.
// Native time inputs render fine on desktop Chrome, but some mobile
// browsers/webviews without full support for type="time" silently fall
// back to a plain text box with no picker UI at all, which is exactly
// the "empty rectangle" reported live. Two selects match the rest of
// this form's own component vocabulary (every other field here is
// already a <select> over a fixed set of options) and behave
// identically everywhere, no feature-detection needed. Stored/read as
// the same "HH:MM" string the sleep-regularity mechanism already
// expects (see circularBedtimeMinutes) — only the input widget changed.
const BEDTIME_MINUTE_OPTIONS = ["00", "15", "30", "45"];

function timePickerHtml(idPrefix, value) {
  const [h, m] = (value || "").split(":");
  const hourOptions = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
    .map((hh) => `<option value="${hh}" ${hh === h ? "selected" : ""}>${hh}</option>`)
    .join("");
  const minuteOptions = BEDTIME_MINUTE_OPTIONS.map(
    (mm) => `<option value="${mm}" ${mm === m ? "selected" : ""}>${mm}</option>`
  ).join("");
  return `
    <div class="time-picker-row">
      <select id="${idPrefix}_hour" aria-label="Часы"><option value="">--</option>${hourOptions}</select>
      <span class="time-picker-sep">:</span>
      <select id="${idPrefix}_minute" aria-label="Минуты"><option value="">--</option>${minuteOptions}</select>
    </div>
  `;
}

function timePickerValue(idPrefix) {
  const h = document.getElementById(`${idPrefix}_hour`).value;
  const m = document.getElementById(`${idPrefix}_minute`).value;
  return h && m ? `${h}:${m}` : "";
}

// Alcohol input (17.08.2026 audit fix) — three always-visible dropdowns
// collapsed into one <details> block, same collapsible pattern already
// used elsewhere in this form (hint-details, report-cell). Shared
// between the daily-log card and the retroactive edit form via
// idPrefix; storage/calc for the three fields is unchanged, only how
// they're shown.
function alcoholSummaryText(entry) {
  // 24.08.2026: prefixes and range labels localized (t()) instead of
  // hardcoded Russian — reads from the same localized*Options() helpers
  // used to build the <select> lists in the habits step, via
  // rangeLookup against those localized arrays instead of the raw
  // (Russian-only) ALCOHOL_*_RANGE_OPTIONS constants.
  const parts = [];
  const spirits = rangeLookup(localizedAlcoholSpiritsOptions(), entry.alcoholSpirits, "label");
  if (spirits) parts.push(`${t("onboarding.alcoholSpiritsPrefix")}: ${spirits}`);
  const wine = rangeLookup(localizedAlcoholWineOptions(), entry.alcoholWine, "label");
  if (wine) parts.push(`${t("onboarding.alcoholWinePrefix")}: ${wine}`);
  const beer = rangeLookup(localizedAlcoholBeerOptions(), entry.alcoholBeer, "label");
  if (beer) parts.push(`${t("onboarding.alcoholBeerPrefix")}: ${beer}`);
  return parts.join(", ");
}

function alcoholFieldsHtml(idPrefix, entry, summaryLabel) {
  if (!isFactorVisible("alcohol")) return "";
  const e = entry || {};
  const summary = alcoholSummaryText(e);
  return `
    <details class="field alcohol-details" ${summary ? "open" : ""}>
      <summary>${summaryLabel}${summary ? ` — ${escapeHtml(summary)}` : ""}</summary>
      <div class="log-row" style="margin-top:10px;">
        <div class="field">
          <label>${t("factorFields.alcoholSpiritsLabel")}</label>
          <select id="${idPrefix}_alcohol_spirits">
            <option value="">${t("onboarding.selectPlaceholder")}</option>
            ${selectOptionsHtml(localizedAlcoholSpiritsOptions(), e.alcoholSpirits)}
          </select>
        </div>
        <div class="field">
          <label>${t("factorFields.alcoholWineLabel")}</label>
          <select id="${idPrefix}_alcohol_wine">
            <option value="">${t("onboarding.selectPlaceholder")}</option>
            ${selectOptionsHtml(localizedAlcoholWineOptions(), e.alcoholWine)}
          </select>
        </div>
      </div>
      <div class="field">
        <label>${t("factorFields.alcoholBeerLabel")}</label>
        <select id="${idPrefix}_alcohol_beer">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          ${selectOptionsHtml(localizedAlcoholBeerOptions(), e.alcoholBeer)}
        </select>
      </div>
    </details>
  `;
}

// Smoking/sport/sleep field(s) for the daily-log and retroactive-edit
// forms — same "hidden when the factor is off in Настройки" gating as
// alcoholFieldsHtml above, and same idPrefix-sharing so both forms stay
// in sync from one definition (TZ, 17.08.2026).
function smokingFieldHtml(idPrefix, entry, label) {
  if (!isFactorVisible("smoking")) return "";
  return `
    <div class="field">
      <label>${label}</label>
      <input type="number" min="0" id="${idPrefix}_cigarettes" value="${escapeHtml(entry.cigarettes ?? "")}">
      <div class="hint">${t("factorFields.smokingWaterlineHint")(state.smokingWaterline ?? 0)}</div>
    </div>
  `;
}

function activityFieldHtml(idPrefix, entry, label, withHint) {
  if (!isFactorVisible("sport")) return "";
  return `
    <div class="field">
      <label>${label}</label>
      <input type="number" min="0" id="${idPrefix}_activity" value="${escapeHtml(entry.activityMinutes ?? "")}">
      ${withHint ? `<div class="hint">${t("factorFields.activityHint")}</div>` : ""}
    </div>
  `;
}

function smokingActivityRowHtml(idPrefix, entry, smokingLabel, activityLabel, withActivityHint) {
  const smoking = smokingFieldHtml(idPrefix, entry, smokingLabel);
  const activity = activityFieldHtml(idPrefix, entry, activityLabel, withActivityHint);
  if (!smoking && !activity) return "";
  return `<div class="log-row">${smoking}${activity}</div>`;
}

// Exact-hours input (20.08.2026 UI pass — replaces the bucket/range
// select; see sleepHoursExact in cascadeRecalcFrom for the matching
// formula-side change, which prefers this exact value when present and
// falls back to the old SLEEP_HOURS_RANGE_OPTIONS bucket for entries
// saved before this change).
function sleepRowHtml(idPrefix, entry, sleepLabel) {
  if (!isFactorVisible("sleep")) return "";
  const bedtimeLabel = idPrefix === "edit" ? t("factorFields.bedtimeLabelEdit") : t("factorFields.bedtimeLabelToday");
  return `
    <div class="log-row">
      <div class="field">
        <label>${sleepLabel}</label>
        <input type="number" min="0" max="24" step="0.25" placeholder="${t("factorFields.sleepHoursPlaceholder")}" id="${idPrefix}_sleep_hours" value="${escapeHtml(entry.sleepHoursExact ?? "")}">
        <div class="hint">${t("factorFields.sleepHoursHint")}</div>
      </div>
      <div class="field">
        <label>${bedtimeLabel}</label>
        ${timePickerHtml(`${idPrefix}_bedtime`, entry.bedtimeToday)}
      </div>
    </div>
  `;
}

// Small helper for the 1..N select fields below (приёмы пищи, перекусы,
// белок — раз в день) — values stored as strings, same convention as
// every other select in the app (selectOptionsHtml does a strict ===
// match against the stored string).
function numberOptionsHtml(max, selectedValue) {
  return Array.from({ length: max }, (_, i) => String(i + 1))
    .map((n) => `<option value="${n}" ${selectedValue === n ? "selected" : ""}>${n}</option>`)
    .join("");
}

// Nutrition redesign (20.08.2026) — replaces the earlier two-dropdown
// version with six separate tiles/cards, per the user's explicit list:
// Количество, Белок, Чистая вода, Мучное, Сахар, БАДы. Still
// collection-only (no formula) — see FACTOR_NEUTRAL_VALUES comment.
// Rendered as .nutrition-tile cards rather than inside the shared
// .log-card wrapper — renderFactorEditScreen skips that wrapper class
// for the "nutrition" key specifically so these read as 6 distinct
// tiles instead of one big card with 6 rows.
function nutritionRowHtml(idPrefix, entry) {
  if (!isFactorVisible("nutrition")) return "";
  const sugar = entry.nutritionSugarSources || {};
  const supplements = entry.nutritionSupplements || {};
  // 24.08.2026: translated as part of the onboarding "nutrition" step
  // checkpoint — this function is shared with the dashboard "modal" and
  // history "edit" forms, so those pick up the translation too, not just
  // onboarding. NUTRITION_FLOUR_OPTIONS/NUTRITION_SUGAR_SOURCES/
  // NUTRITION_SUPPLEMENT_TYPES themselves stay Russian-labeled (untouched
  // canonical lists); only a localized value/label or key/label
  // projection is built here for rendering, same pattern as
  // localizedRegionOptions et al.
  const flourOptions = NUTRITION_FLOUR_OPTIONS.map((o) => ({ value: o.value, label: t(`nutritionFlourOptions.${o.value}`) }));
  const sugarOptions = NUTRITION_SUGAR_SOURCES.map((s) => ({ key: s.key, label: t(`nutritionSugarOptions.${s.key}`) }));
  const supplementOptions = NUTRITION_SUPPLEMENT_TYPES.map((s) => ({ key: s.key, label: t(`nutritionSupplementOptions.${s.key}`) }));
  return `
    <div class="nutrition-tile">
      <h3>${t("nutrition.quantityTitle")}</h3>
      <div class="log-row">
        <div class="field">
          <label>${t("nutrition.mealsLabel")}</label>
          <select id="${idPrefix}_nutrition_meals">
            <option value="">${t("onboarding.selectPlaceholder")}</option>
            ${selectOptionsHtml(NUTRITION_MEALS_RANGE_OPTIONS, entry.nutritionMealsCount ?? "")}
          </select>
        </div>
        <div class="field">
          <label>${t("nutrition.snacksLabel")}</label>
          <select id="${idPrefix}_nutrition_snacks">
            <option value="">${t("onboarding.selectPlaceholder")}</option>
            ${numberOptionsHtml(3, entry.nutritionSnacksCount ?? "")}
          </select>
        </div>
      </div>
    </div>

    <div class="nutrition-tile">
      <h3>${t("nutrition.proteinTitle")}</h3>
      <div class="log-row">
        <div class="field">
          <label>${t("nutrition.proteinTimesLabel")}</label>
          <select id="${idPrefix}_nutrition_protein_times">
            <option value="">${t("onboarding.selectPlaceholder")}</option>
            ${numberOptionsHtml(6, entry.nutritionProteinTimes ?? "")}
            <option value="every_meal" ${entry.nutritionProteinTimes === "every_meal" ? "selected" : ""}>${t("nutrition.proteinEveryMeal")}</option>
          </select>
        </div>
        <div class="field">
          <label>${t("nutrition.proteinGramsLabel")}</label>
          <input type="number" id="${idPrefix}_nutrition_protein_grams" min="0" step="1" placeholder="${t("nutrition.proteinGramsPlaceholder")}" value="${entry.nutritionProteinGrams ?? ""}">
        </div>
      </div>
    </div>

    <div class="nutrition-tile">
      <h3>${t("nutrition.waterLabel")}</h3>
      <div class="field">
        ${collapsibleHint(t("nutrition.waterHint"))}
        <div class="log-row nutrition-water-row">
          <input type="number" id="${idPrefix}_nutrition_water_amount" min="0" step="1" placeholder="${t("nutrition.waterAmountPlaceholder")}" value="${entry.nutritionWaterAmount ?? ""}">
          <select id="${idPrefix}_nutrition_water_unit">
            <option value="ml" ${(entry.nutritionWaterUnit || "ml") === "ml" ? "selected" : ""}>${t("nutrition.unitMl")}</option>
            <option value="l" ${entry.nutritionWaterUnit === "l" ? "selected" : ""}>${t("nutrition.unitL")}</option>
          </select>
        </div>
      </div>
    </div>

    <div class="nutrition-tile">
      <h3>${t("nutrition.flourLabel")}</h3>
      <div class="field">
        <select id="${idPrefix}_nutrition_flour">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          ${selectOptionsHtml(flourOptions, entry.nutritionFlourType)}
        </select>
      </div>
    </div>

    <div class="nutrition-tile">
      <h3>${t("nutrition.sugarLabel")}</h3>
      <div class="field">
        ${collapsibleHint(t("nutrition.sugarHint"))}
        <div class="checkbox-list">
          ${sugarOptions
            .map(
              (s) =>
                `<label class="checkbox-row"><input type="checkbox" id="${idPrefix}_nutrition_sugar_${s.key}" ${sugar[s.key] ? "checked" : ""}> ${s.label}</label>`
            )
            .join("")}
        </div>
      </div>
    </div>

    <div class="nutrition-tile">
      <h3>${t("nutrition.supplementsLabel")}</h3>
      <div class="field">
        <div class="checkbox-list">
          ${supplementOptions
            .map(
              (s) =>
                `<label class="checkbox-row"><input type="checkbox" id="${idPrefix}_nutrition_supplements_${s.key}" ${supplements[s.key] ? "checked" : ""}> ${s.label}</label>`
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

// "Не было" is mutually exclusive with the other sugar-source checkboxes
// (checking one unchecks the other side) — otherwise the data reads as
// contradictory ("не было" + "соки" both checked). idPrefix-generic
// (23.08.2026) so it works for both the dashboard's "modal" popup and
// the retroactive "edit" form — see factorModalFieldsHtml.
function wireNutritionExclusiveCheckboxes(idPrefix) {
  const none = document.getElementById(`${idPrefix}_nutrition_sugar_none`);
  if (!none) return;
  const others = NUTRITION_SUGAR_SOURCES.filter((s) => s.key !== "none").map((s) =>
    document.getElementById(`${idPrefix}_nutrition_sugar_${s.key}`)
  );
  none.addEventListener("change", () => {
    if (none.checked) others.forEach((cb) => cb && (cb.checked = false));
  });
  others.forEach((cb) => {
    if (!cb) return;
    cb.addEventListener("change", () => {
      if (cb.checked) none.checked = false;
    });
  });
}

function socialRowHtml(idPrefix, entry) {
  if (!isFactorVisible("social")) return "";
  return `
    <div class="field">
      <label>${t("factorFields.socialLabel")}</label>
      ${collapsibleHint(t("factorFields.socialHint"))}
      <select id="${idPrefix}_social">
        <option value="">${t("onboarding.selectPlaceholder")}</option>
        ${selectOptionsHtml(localizedSocialQualityOptions(), entry.socialQualityToday)}
      </select>
    </div>
  `;
}

function weightRowHtml(idPrefix, entry) {
  if (!isFactorVisible("weight")) return "";
  return `
    <div class="field">
      <label>${t("factorFields.weightLabel")}</label>
      <input type="number" step="0.1" id="${idPrefix}_weight" value="${escapeHtml(entry.weightKg ?? "")}">
    </div>
    <div class="field">
      <label>${t("factorFields.bodyFatLabel")}</label>
      ${collapsibleHint(t("factorFields.bodyFatHint"))}
      <input type="number" step="0.1" min="0" max="100" id="${idPrefix}_body_fat" value="${escapeHtml(entry.bodyFatPercent ?? "")}">
    </div>
  `;
}

function purposeRowHtml(idPrefix, entry) {
  if (!isFactorVisible("purpose")) return "";
  return `
    <div class="field">
      <label>${t("factorFields.purposeLabel")}</label>
      <select id="${idPrefix}_purpose">
        <option value="">${t("onboarding.selectPlaceholder")}</option>
        ${selectOptionsHtml(localizedPurposeOptions(), entry.purposeToday)}
      </select>
    </div>
  `;
}

function cognitiveRowHtml(idPrefix, entry) {
  if (!isFactorVisible("cognitive")) return "";
  return `
    <div class="field">
      <label>${t("factorFields.cognitiveLabel")}</label>
      ${collapsibleHint(t("factorFields.cognitiveHint"))}
      <select id="${idPrefix}_cognitive">
        <option value="">${t("onboarding.selectPlaceholder")}</option>
        ${selectOptionsHtml(localizedCognitiveActivityOptions(), entry.cognitiveActivityToday)}
      </select>
    </div>
  `;
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
        <h1>${t("onboarding.basicsTitle")}</h1>
      </div>
      <div class="field">
        <label>${t("onboarding.ageLabel")} ${reqMark()}</label>
        <input type="number" min="1" max="120" id="f_age" value="${escapeHtml(draft.age ?? "")}">
      </div>
      <div class="field">
        <label>${t("onboarding.genderLabel")} ${reqMark()}</label>
        <select id="f_gender">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          <option value="male" ${draft.gender === "male" ? "selected" : ""}>${t("onboarding.genderMale")}</option>
          <option value="female" ${draft.gender === "female" ? "selected" : ""}>${t("onboarding.genderFemale")}</option>
          <option value="other" ${draft.gender === "other" ? "selected" : ""}>${t("onboarding.genderOther")}</option>
        </select>
      </div>
      <div class="field">
        <label>${t("onboarding.regionLabel")} ${reqMark()}</label>
        <select id="f_region">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          ${selectOptionsHtml(localizedRegionOptions(), draft.region)}
        </select>
      </div>
    `;
  } else if (step === "activity_form") {
    body = `
      <div class="onboarding-header">
        <h1>${t("onboarding.activityFormTitle")}</h1>
      </div>
      <div class="field">
        <label>${t("onboarding.activityLabel")} ${reqMark()}</label>
        <select id="f_activityRange">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          ${selectOptionsHtml(localizedActivityRangeOptions(), draft.activityRange)}
        </select>
        ${collapsibleHint(t("onboarding.activityHint"))}
      </div>
      <div class="field" id="f_activityGoalBlock" style="display:${draft.activityRange === "lt150" ? "block" : "none"}">
        <label>${t("onboarding.activityGoalLabel")} ${reqMark()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_activityGoal" value="yes" ${draft.activityGoalConfirmed === true ? "checked" : ""}> ${t("onboarding.goalYes")}</label>
          <label><input type="radio" name="f_activityGoal" value="no" ${draft.activityGoalConfirmed === false ? "checked" : ""}> ${t("onboarding.goalNo")}</label>
        </div>
      </div>
      <div class="field">
        <label>${t("onboarding.weightLabel")}</label>
        <input type="number" id="f_weight" value="${escapeHtml(draft.weight ?? "")}">
      </div>
      <div class="field">
        <label>${t("onboarding.heightLabel")}</label>
        <input type="number" id="f_height" value="${escapeHtml(draft.height ?? "")}">
      </div>
      <div class="field">
        <label>${t("onboarding.waistLabel")}</label>
        <select id="f_waistRange">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          ${selectOptionsHtml(localizedWaistRangeOptions(), draft.waistRange)}
        </select>
        <input type="number" id="f_waistExact" placeholder="${t("onboarding.waistExactPlaceholder")}" value="${escapeHtml(draft.waistExact ?? "")}" style="margin-top:8px">
      </div>
    `;
  } else if (step === "recovery") {
    body = `
      <div class="onboarding-header">
        <h1>${t("onboarding.recoveryTitle")}</h1>
      </div>
      <div class="field">
        <label>${t("onboarding.sleepHoursLabel")}</label>
        <select id="f_sleepHoursRange">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          ${selectOptionsHtml(localizedSleepHoursRangeOptions(), draft.sleepHoursRange)}
        </select>
      </div>
      <div class="field">
        <label>${t("onboarding.bedtimeLabel")}</label>
        <select id="f_bedtimeRange">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          ${selectOptionsHtml(localizedBedtimeRangeOptions(), draft.bedtimeRange)}
        </select>
        <input type="time" id="f_bedtimeExact" value="${escapeHtml(draft.bedtimeExact ?? "")}" style="margin-top:8px; display:${draft.bedtimeRange === "custom" ? "block" : "none"}">
      </div>
      <div class="field">
        <label>${t("onboarding.recoveryPracticesLabel")}</label>
        <div class="checkbox-list">
          ${localizedRecoveryPractices()
            .map(
              (p) =>
                `<label class="checkbox-row"><input type="checkbox" id="f_recovery_${p.key}" ${draft.recoveryPractices?.[p.key] ? "checked" : ""}> ${p.label}</label>`
            )
            .join("")}
          <label class="checkbox-row"><input type="checkbox" id="f_recovery_other" ${draft.recoveryPractices?.other ? "checked" : ""}> ${t("onboarding.otherLabel")}</label>
          <input type="text" id="f_recovery_otherText" placeholder="${t("onboarding.otherTextPlaceholder")}" value="${escapeHtml(draft.recoveryPractices?.otherText ?? "")}">
        </div>
      </div>
      <div class="field">
        <label>${t("onboarding.stressLevelLabel")}</label>
        <select id="f_stressLevel">
          <option value="">${t("onboarding.selectPlaceholder")}</option>
          ${selectOptionsHtml(localizedStressLevelOptions(), draft.stressLevel)}
        </select>
      </div>
    `;
  } else if (step === "nutrition") {
    // 24.08.2026: reuses the same nutritionRowHtml("f", draft) the daily
    // tracker/history-edit forms use (idPrefix "modal"/"edit") — see
    // comment above WATER_RANGE_OPTIONS' old home for why. "f" matches
    // this step's own id-prefix convention (f_age, f_gender, etc.).
    body = `
      <div class="onboarding-header">
        <h1>${t("onboarding.nutritionStepTitle")}</h1>
      </div>
      ${nutritionRowHtml("f", draft)}
    `;
  } else if (step === "habits") {
    body = `
      <div class="onboarding-header">
        <h1>${t("onboarding.habitsTitle")}</h1>
      </div>
      <div class="field">
        <label>${t("onboarding.cigarettesLabel")} ${reqMark()}</label>
        <input type="number" min="0" id="f_cigarettesPerDay" value="${escapeHtml(draft.cigarettesPerDay ?? "")}">
      </div>
      <div class="field" id="f_smokingGoalBlock" style="display:${Number(draft.cigarettesPerDay) > 0 ? "block" : "none"}">
        <label>${t("onboarding.smokingGoalLabel")} ${reqMark()}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_smokingGoal" value="yes" ${draft.smokingGoalConfirmed === true ? "checked" : ""}> ${t("onboarding.goalYes")}</label>
          <label><input type="radio" name="f_smokingGoal" value="no" ${draft.smokingGoalConfirmed === false ? "checked" : ""}> ${t("onboarding.goalNo")}</label>
        </div>
      </div>
      <div class="field">
        <label>${t("onboarding.vapeLabel")}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_vape" value="yes" ${draft.vapeHookah === "yes" ? "checked" : ""}> ${t("onboarding.yesLabel")}</label>
          <label><input type="radio" name="f_vape" value="no" ${draft.vapeHookah === "no" ? "checked" : ""}> ${t("onboarding.noLabel")}</label>
        </div>
      </div>
      <div class="field">
        <details class="alcohol-details" ${alcoholSummaryText(draft) || draft.alcoholOtherHas ? "open" : ""}>
          <summary>${t("onboarding.alcoholSummaryLabel")}${alcoholSummaryText(draft) ? ` — ${escapeHtml(alcoholSummaryText(draft))}` : ""}</summary>
          <div class="field">
            <label>${t("onboarding.alcoholSpiritsLabel")}</label>
            <select id="f_alcoholSpiritsRange">
              <option value="">${t("onboarding.selectPlaceholder")}</option>
              ${selectOptionsHtml(localizedAlcoholSpiritsOptions(), draft.alcoholSpirits)}
            </select>
          </div>
          <div class="field">
            <label>${t("onboarding.alcoholWineLabel")}</label>
            <select id="f_alcoholWineRange">
              <option value="">${t("onboarding.selectPlaceholder")}</option>
              ${selectOptionsHtml(localizedAlcoholWineOptions(), draft.alcoholWine)}
            </select>
          </div>
          <div class="field">
            <label>${t("onboarding.alcoholBeerLabel")}</label>
            <select id="f_alcoholBeerRange">
              <option value="">${t("onboarding.selectPlaceholder")}</option>
              ${selectOptionsHtml(localizedAlcoholBeerOptions(), draft.alcoholBeer)}
            </select>
          </div>
          <div class="field">
            <label class="checkbox-row"><input type="checkbox" id="f_alcoholOtherHas" ${draft.alcoholOtherHas ? "checked" : ""}> ${t("onboarding.otherLabel")}</label>
            <input type="text" id="f_alcoholOtherText" placeholder="${t("onboarding.otherTextPlaceholder")}" value="${escapeHtml(draft.alcoholOtherText ?? "")}">
          </div>
        </details>
      </div>
    `;
  } else if (step === "health") {
    body = `
      <div class="onboarding-header">
        <h1>${t("onboarding.healthTitle")}</h1>
      </div>
      <div class="field">
        <label>${t("onboarding.illnessHasLabel")}</label>
        <div class="radio-row">
          <label><input type="radio" name="f_illnessHas" value="yes" ${draft.illnessHas === true ? "checked" : ""}> ${t("onboarding.yesLabel")}</label>
          <label><input type="radio" name="f_illnessHas" value="no" ${draft.illnessHas === false ? "checked" : ""}> ${t("onboarding.noLabel")}</label>
        </div>
      </div>
      <div class="field">
        <label>${t("onboarding.illnessDetailLabel")}</label>
        <input type="text" id="f_illnessDetail" value="${escapeHtml(draft.illnessDetail ?? "")}">
      </div>
    `;
  } else if (step === "reveal") {
    revealDays = computeStartingCapitalDays(draft);
    // Funnel metric: "of everyone who reaches onboarding, how many get as
    // far as seeing their calculated capital" — recalcMode excluded, that's
    // an existing engaged user editing their profile, not new-user
    // acquisition funnel progress.
    if (!state.recalcMode) trackEvent("onboarding_reveal_reached");
    const tier = onboardingResultTier(draft);
    const resultPhrase = pickPhrase(localizedResultPhrases(tier), JSON.stringify(draft));
    const comparisonHtml = onboardingComparisonHtml(draft, revealDays);
    body = `
      <div class="onboarding-header">
        <h1 class="screen-title">${t("onboarding.revealTitle")}</h1>
      </div>
      <div class="reveal-number">
        <div class="value"><span id="reveal-value">0</span> <span id="reveal-day-word">${localizedDayWord(revealDays)}</span></div>
        <div class="disclaimer">${t("welcome.disclaimer")}</div>
        <div class="reveal-phrase">${escapeHtml(resultPhrase)}</div>
        ${comparisonHtml}
      </div>
      <div class="step-nav">
        <button class="btn secondary" id="ob-back">${t("onboarding.back")}</button>
      </div>
      <button class="btn" id="finish-onboarding" style="width:100%; margin-top:10px;">${state.recalcMode ? t("onboarding.finishButtonRecalc") : t("onboarding.finishButton")}</button>
      ${
        state.recalcMode
          ? ""
          : `<button class="btn secondary" id="share-reveal" style="width:100%; margin-top:10px;">${t("onboarding.shareButton")}</button>`
      }
    `;
  }

  // Language switcher (24.08.2026, checkpoint 1): shown on every
  // onboarding step per the agreed placement — after onboarding,
  // language only changes via Settings (not implemented yet, tracked in
  // TASKS.md). Only "basics" is actually translated so far; switching on
  // other steps will visibly still show Russian content — expected for
  // this checkpoint, not a bug.
  const langSwitcherHtml =
    step !== "reveal"
      ? `<div class="lang-switcher">
          <button class="lang-btn ${getLang() === "ru" ? "active" : ""}" data-lang="ru" ${getLang() === "ru" ? "disabled" : ""}>RU</button>
          <button class="lang-btn ${getLang() === "en" ? "active" : ""}" data-lang="en" ${getLang() === "en" ? "disabled" : ""}>EN</button>
        </div>`
      : "";

  root.innerHTML = `
    <div class="wrap">
      ${langSwitcherHtml}
      <div class="progress-dots">${dots}</div>
      ${step !== "reveal" ? `<div class="onboarding-step-counter">${t("onboarding.stepCounter")(stepIndex + 1)}</div>` : ""}
      ${body}
      ${
        step !== "reveal"
          ? `<div class="step-nav">
              <button class="btn secondary" id="ob-back" ${stepIndex === 0 ? "disabled" : ""}>${t("onboarding.back")}</button>
              <button class="btn" id="ob-next">${stepIndex === ONBOARDING_STEPS.length - 2 ? t("onboarding.calculate") : t("onboarding.next")}</button>
            </div>`
          : ""
      }
    </div>
  `;

  if (step !== "reveal") {
    root.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setLang(btn.dataset.lang);
        render();
      });
    });
  }

  if (step === "reveal") {
    animateRevealNumber(revealDays);
    document.getElementById("finish-onboarding").addEventListener("click", () => {
      const wasRecalc = state.recalcMode;
      if (!wasRecalc) trackEvent("onboarding_completed");
      state.onboarding = draft;
      state.startingCapitalDays = revealDays;
      state.smokingWaterline = Number(draft.cigarettesPerDay) || 0;
      state.createdAt = state.createdAt || todayStr();
      state.onboardingStep = null;
      state.onboardingDraft = null;
      state.recalcMode = false;
      if (wasRecalc) state.nav = "profile";
      saveState();
      cascadeRecalcFrom(state.createdAt || todayStr());
      saveState();
      render();
    });
    const shareBtn = document.getElementById("share-reveal");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        const text = t("onboarding.shareText")(revealDays, localizedDayWord(revealDays));
        copyTextToClipboard(text, shareBtn, t("onboarding.shareButton"));
      });
    }
    document.getElementById("ob-back").addEventListener("click", () => {
      state.onboardingDraft = draft;
      state.onboardingStep = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 2];
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
    if (step === "nutrition") wireNutritionExclusiveCheckboxes("f");
    // Pale/disabled "Далее" until required fields are filled (21.08.2026
    // onboarding redesign) — re-checks on every change within the step
    // without touching the fields themselves, so nothing typed is lost.
    const nextBtn = document.getElementById("ob-next");
    const wrapEl = document.querySelector(".wrap");
    const refreshNextState = () => {
      collectStepFields(step, draft);
      nextBtn.disabled = !isStepValid(step, draft);
    };
    wrapEl.addEventListener("input", refreshNextState);
    wrapEl.addEventListener("change", refreshNextState);
    refreshNextState();
    document.getElementById("ob-next").addEventListener("click", () => {
      collectStepFields(step, draft);
      if (step === "basics" && (!draft.age || !draft.gender || !draft.region)) {
        alert(t("onboarding.basicsAlert"));
        return;
      }
      if (step === "activity_form" && !draft.activityRange) {
        alert(t("onboarding.activityAlert"));
        return;
      }
      if (step === "activity_form" && draft.activityRange === "lt150" && draft.activityGoalConfirmed === undefined) {
        alert(t("onboarding.activityGoalAlert"));
        return;
      }
      if (step === "habits" && (draft.cigarettesPerDay === "" || draft.cigarettesPerDay === undefined || draft.cigarettesPerDay === null)) {
        alert(t("onboarding.cigarettesAlert"));
        return;
      }
      if (step === "habits" && Number(draft.cigarettesPerDay) > 0 && draft.smokingGoalConfirmed === undefined) {
        alert(t("onboarding.smokingGoalAlert"));
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
    // 24.08.2026: mirrors the daily save-side extraction for the same
    // nutritionRowHtml("f", ...) fields (compare resolvedFactorFields'
    // "nutrition" case below) — same field names as daily tracking now,
    // instead of the old disconnected 8 fields.
    draft.nutritionMealsCount = val("f_nutrition_meals") || "";
    draft.nutritionSnacksCount = val("f_nutrition_snacks") || "";
    draft.nutritionProteinTimes = val("f_nutrition_protein_times") || "";
    draft.nutritionProteinGrams = val("f_nutrition_protein_grams") || "";
    draft.nutritionWaterAmount = val("f_nutrition_water_amount") || "";
    draft.nutritionWaterUnit = val("f_nutrition_water_unit") || "ml";
    draft.nutritionFlourType = val("f_nutrition_flour") || "";
    draft.nutritionSugarSources = {
      none: !!document.getElementById("f_nutrition_sugar_none")?.checked,
      inProducts: !!document.getElementById("f_nutrition_sugar_inProducts")?.checked,
      juices: !!document.getElementById("f_nutrition_sugar_juices")?.checked,
      sweetDrinks: !!document.getElementById("f_nutrition_sugar_sweetDrinks")?.checked,
      added: !!document.getElementById("f_nutrition_sugar_added")?.checked,
    };
    draft.nutritionSupplements = {
      vitamins: !!document.getElementById("f_nutrition_supplements_vitamins")?.checked,
      minerals: !!document.getElementById("f_nutrition_supplements_minerals")?.checked,
      other: !!document.getElementById("f_nutrition_supplements_other")?.checked,
    };
  } else if (step === "habits") {
    draft.cigarettesPerDay = val("f_cigarettesPerDay");
    const vapeChecked = checkedRadio("f_vape");
    draft.vapeHookah = vapeChecked ? vapeChecked.value : draft.vapeHookah;
    draft.alcoholSpirits = val("f_alcoholSpiritsRange") || "";
    draft.alcoholWine = val("f_alcoholWineRange") || "";
    draft.alcoholBeer = val("f_alcoholBeerRange") || "";
    draft.alcoholOtherHas = !!document.getElementById("f_alcoholOtherHas")?.checked;
    draft.alcoholOtherText = val("f_alcoholOtherText") || "";
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
// TZ section 7, 13.08.2026: 4th icon renamed "Фонд идей + Забота" ->
// "Чат" — now a pure nav placeholder ("скоро"), full chat functionality
// stays in the backlog (section 10). "Служба заботы"/"Фонд идей" moved
// under "Настройки" instead (see renderSettings), same merged-screen
// mechanics, just reached through the gear icon now.
const BOTTOM_NAV_ITEMS = [
  { nav: "dashboard", icon: ICONS.home, label: "Портфель" },
  { nav: "history", icon: ICONS.calendar, label: "История" },
  { nav: "knowledge", icon: ICONS.book, label: "База знаний" },
  { nav: "chat", icon: ICONS.chat, label: "Чат" },
  { nav: "settings", icon: ICONS.gear, label: "Настройки" },
];

// TZ, 18.08.2026 fix: the app shell (top bar / .wrap / bottom nav) used
// to be torn down and rebuilt via root.innerHTML on EVERY navigation —
// including every time the user just tapped back onto Портфель. A
// freshly-inserted overflow-y:auto element (.wrap) isn't immediately
// promoted to its own scrolling compositor layer on mobile Safari/
// Chrome, so the first one or two touch-scroll gestures on a
// just-recreated .wrap were silently swallowed — "не скролится с первой
// попытки, только с третьей". Building the shell once and reusing the
// same .wrap node across navigations (only its CONTENTS change per
// screen) keeps that scroll layer alive, so it never needs to "warm up"
// again after the very first render.
function ensureAppShell() {
  if (document.querySelector(".bottom-nav")) return;
  root.innerHTML = `
    <div class="top-bar">
      <div class="top-icons">
        <button class="icon-btn" id="bell-btn" aria-label="Уведомления" title="Уведомления">${ICONS.bell}</button>
        <button class="icon-btn" id="profile-btn" aria-label="Профиль" title="Профиль">${ICONS.user}</button>
      </div>
    </div>
    <div class="wrap" id="screen"></div>
    <nav class="bottom-nav">
      ${BOTTOM_NAV_ITEMS.map(
        (item) => `<button data-nav="${item.nav}" class="icon-nav-btn" aria-label="${item.label}" title="${item.label}">${item.icon}</button>`
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
}

function renderApp() {
  const nav = state.nav || "dashboard";
  // Guarded by a DOM check, not a boolean flag, so it self-heals: if
  // something else (onboarding's "official recalc", etc.) wipes
  // root.innerHTML out from under the shell, the next renderApp() call
  // just rebuilds it instead of trusting stale in-memory state.
  ensureAppShell();
  root.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === nav);
  });

  const screen = document.getElementById("screen");
  // See .wrap.wrap-no-top-pad in app.css (20.08.2026, sticky-header fix
  // take 3) — only the dashboard's sticky header needs .wrap's own top
  // padding removed; every other screen keeps the normal 24px.
  screen.classList.toggle("wrap-no-top-pad", nav === "dashboard");
  if (nav === "dashboard") renderDashboard(screen);
  else if (nav === "history") renderHistory(screen);
  else if (nav === "history-day") renderHistoryDay(screen);
  else if (nav === "history-summary") renderHistorySummary(screen);
  else if (nav === "knowledge") renderKnowledge(screen);
  else if (nav === "chat") renderChat(screen);
  else if (nav === "settings") renderSettings(screen);
  else if (nav === "profile") renderProfile(screen);
  else if (nav === "notifications") renderNotifications(screen);
  // Fallback for any stale state.nav value from before this
  // restructuring (e.g. old "report"/"ideas"/"care" persisted in a
  // returning user's localStorage) — those screens no longer exist as
  // standalone bottom-nav destinations, so land on the dashboard rather
  // than render nothing.
  else renderDashboard(screen);
}

function renderChat(screen) {
  screen.innerHTML = `<h2 class="screen-title">Чат</h2><div class="empty-state">Скоро.</div>`;
}

// TZ section 7, 13.08.2026: "Служба заботы"/"Фонд идей" (renderCare,
// unchanged mechanics) and the factor-visibility checklist both live
// under Settings now, reached via a simple two-row list — not their own
// bottom-nav icons. state.settingsView tracks which sub-screen is open;
// resets to the root list on the "← Назад" button inside each.
function renderSettings(screen) {
  const view = state.settingsView || "root";
  if (view === "care") {
    renderCare(screen);
    return;
  }
  if (view === "factors") {
    renderFactorSettings(screen);
    return;
  }
  if (view === "account") {
    renderAccountSettings(screen);
    return;
  }
  if (view === "referral") {
    renderReferralSettings(screen);
    return;
  }
  if (view === "billing") {
    renderBillingSettings(screen);
    return;
  }
  screen.innerHTML = `
    <h2 class="screen-title">${t("settings.title")}</h2>
    <div class="field">
      <label>${t("settings.languageLabel")}</label>
      <div class="lang-switcher">
        <button class="lang-btn ${getLang() === "ru" ? "active" : ""}" data-lang="ru" ${getLang() === "ru" ? "disabled" : ""}>RU</button>
        <button class="lang-btn ${getLang() === "en" ? "active" : ""}" data-lang="en" ${getLang() === "en" ? "disabled" : ""}>EN</button>
      </div>
    </div>
    <div class="settings-list">
      <button class="settings-row" data-view="account">${state.authEmail ? t("settings.accountRowLoggedIn")(state.authEmail) : t("settings.accountRowLoggedOut")}</button>
      <button class="settings-row" data-view="referral">${t("settings.referralRow")}</button>
      <button class="settings-row" data-view="care">${t("settings.careRow")}</button>
      <button class="settings-row" data-view="factors">${t("settings.factorsRow")}</button>
      <div class="settings-row settings-row-disabled">${t("settings.fitnessTrackersRow")} <span class="optional-badge">${t("knowledge.comingSoon")}</span></div>
      <button class="settings-row" data-view="billing">${t("settings.billingRow")}</button>
    </div>
  `;
  screen.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLang(btn.dataset.lang);
      renderSettings(screen);
    });
  });
  screen.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settingsView = btn.dataset.view;
      saveState();
      renderSettings(screen);
    });
  });
}

function settingsBackButtonHtml() {
  return `<button class="btn secondary" id="settings-back" style="margin-bottom:16px;">${t("settings.back")}</button>`;
}

function wireSettingsBackButton(screen) {
  document.getElementById("settings-back").addEventListener("click", () => {
    state.settingsView = "root";
    saveState();
    renderSettings(screen);
  });
}

// Simplest possible referral step (23.08.2026) — a single prewritten
// text to copy and send yourself, no personal links/codes/tracking
// yet. Deliberately minimal: this is meant to be replaced by a real
// referral ladder later, not extended in place.
function renderReferralSettings(screen) {
  screen.innerHTML = `
    ${settingsBackButtonHtml()}
    <h2 class="screen-title">${t("settings.referralTitle")}</h2>
    <div class="field">
      <div class="hint">${t("settings.referralHint")}</div>
    </div>
    <div class="field">
      <textarea id="referral-text" readonly rows="3">${escapeHtml(t("settings.referralShareText"))}</textarea>
    </div>
    <button class="btn" id="referral-copy" style="width:100%">${t("settings.copyButton")}</button>
  `;
  wireSettingsBackButton(screen);
  const copyBtn = document.getElementById("referral-copy");
  copyBtn.addEventListener("click", () => {
    copyTextToClipboard(t("settings.referralShareText"), copyBtn, t("settings.copyButton"));
  });
}

// Payment link request (26.08.2026) — stand-in for real checkout: no
// payment processor is wired up yet (Stripe blocked pending a US LLC;
// RU side goes through a manual Т-Банк invoice link), so there's nothing
// for an in-app "Subscribe" button to actually call. A mailto: link is
// used instead of local-only storage on purpose — the existing
// state.careRequests pattern (see renderCareSupport above) only ever
// writes to this device's localStorage with a standing TODO to wire it
// to a real backend, which means a request logged that way would never
// actually reach the team. mailto guarantees the ask leaves the device
// (opens the user's own mail client addressed to support@humanchange.app)
// instead of silently vanishing the same way. state.paymentLinkRequestedAt
// is purely a local "you already asked" confirmation for the user, not
// the notification mechanism itself.
function renderBillingSettings(screen) {
  const requestedAt = state.paymentLinkRequestedAt;
  const email = state.authEmail || "";
  const mailBody = t("settings.billingEmailBody")(email);
  const mailtoHref = `mailto:support@humanchange.app?subject=${encodeURIComponent(t("settings.billingEmailSubject"))}&body=${encodeURIComponent(mailBody)}`;
  screen.innerHTML = `
    ${settingsBackButtonHtml()}
    <h2 class="screen-title">${t("settings.billingTitle")}</h2>
    <div class="field">
      <div class="hint">${t("settings.billingIntro")}</div>
    </div>
    <div class="field">
      <div class="hint">${t("settings.billingNoAutopayHint")}</div>
    </div>
    <a class="btn" id="billing-request-link" href="${mailtoHref}" style="width:100%; display:block; text-align:center; box-sizing:border-box;">${t("settings.billingRequestButton")}</a>
    ${
      requestedAt
        ? `<div class="hint" style="margin-top:12px;">${t("settings.billingRequestedHint")(escapeHtml(requestedAt))}<a href="mailto:support@humanchange.app">support@humanchange.app</a></div>`
        : ""
    }
  `;
  wireSettingsBackButton(screen);
  document.getElementById("billing-request-link").addEventListener("click", () => {
    // Best-effort receipt: fires whether or not the user's device actually
    // has a configured mail client, since we can't detect that — the
    // mailto link itself is still the real notification path.
    state.paymentLinkRequestedAt = todayStr();
    saveState();
    trackEvent("payment_link_requested");
  });
}

// Login/registration (email+password via Supabase) — fully optional,
// see the "Auth (Supabase)" block near the top of the file. Purely
// additive UI: nothing here blocks or reads from the local ledger.
// mode toggles the form between "Войти" and "Зарегистрироваться" copy;
// state itself (authEmail) decides whether we show the form at all or
// the logged-in view instead.
let accountFormMode = "signin"; // "signin" | "signup" — local UI toggle, not persisted

function renderAccountSettings(screen) {
  if (state.authEmail) {
    screen.innerHTML = `
      ${settingsBackButtonHtml()}
      <h2 class="screen-title">${t("settings.accountTitle")}</h2>
      <div class="field">
        <div class="hint">${t("settings.accountLoggedInHint")(escapeHtml(state.authEmail))}</div>
      </div>
      <button class="btn secondary" id="account-signout" style="width:100%">${t("settings.signOut")}</button>
    `;
    wireSettingsBackButton(screen);
    document.getElementById("account-signout").addEventListener("click", async () => {
      await authSignOut();
      renderSettings(screen);
    });
    return;
  }

  screen.innerHTML = `
    ${settingsBackButtonHtml()}
    <h2 class="screen-title">${t("settings.accountTitle")}</h2>
    <div class="hint" style="margin-bottom:16px;">${t("settings.accountOptionalHint")}</div>
    <div class="field">
      <label>${t("settings.emailLabel")}</label>
      <input type="email" id="account-email" autocomplete="email">
    </div>
    <div class="field">
      <label>${t("settings.passwordLabel")}</label>
      <input type="password" id="account-password" autocomplete="${accountFormMode === "signup" ? "new-password" : "current-password"}">
    </div>
    <div id="account-error" class="hint" style="color:var(--danger, #c0392b); display:none;"></div>
    <button class="btn" id="account-submit" style="width:100%">${accountFormMode === "signup" ? t("settings.signUp") : t("settings.signIn")}</button>
    <button class="btn secondary" id="account-toggle-mode" style="width:100%; margin-top:12px;">${accountFormMode === "signup" ? t("settings.haveAccount") : t("settings.needAccount")}</button>
  `;
  wireSettingsBackButton(screen);

  document.getElementById("account-toggle-mode").addEventListener("click", () => {
    accountFormMode = accountFormMode === "signup" ? "signin" : "signup";
    renderAccountSettings(screen);
  });

  document.getElementById("account-submit").addEventListener("click", async () => {
    const email = document.getElementById("account-email").value.trim();
    const password = document.getElementById("account-password").value;
    const errorEl = document.getElementById("account-error");
    errorEl.style.display = "none";
    if (!email || !password) {
      errorEl.textContent = t("settings.fillEmailPassword");
      errorEl.style.display = "block";
      return;
    }
    const submitBtn = document.getElementById("account-submit");
    submitBtn.disabled = true;
    const { error } = accountFormMode === "signup"
      ? await authSignUp(email, password)
      : await authSignIn(email, password);
    submitBtn.disabled = false;
    if (error) {
      errorEl.textContent = error.message || t("settings.genericAuthError");
      errorEl.style.display = "block";
      return;
    }
    renderSettings(screen);
  });
}

// TZ section 7, 13.08.2026: default visible dashboard cards (Активность/
// Sleep/Nutrition/Stress) are deliberately NOT the same set as the 4
// factors that actually run in the capital formula (Smoking/Sport/
// Sleep/Alcohol) — Nutrition/Stress show because they're broadly
// relevant even without a formula yet, Smoking/Alcohol are hidden by
// default since they're not relevant to everyone. Toggle list is flat,
// no categories (would be overkill at 6 factors).
// Order matters here — it drives both renderFactorSettings' checkbox
// list and the dashboard's factor-grid (23.08.2026 reorder), not just
// this list's own display. `active` (whether the factor runs in the
// capital formula) was dropped 23.08.2026 — the dashboard no longer
// visually distinguishes formula factors from collection-only ones
// (no more "скоро" badge/disabled styling), and nothing else in the
// codebase read this field.
// label is a live getter (24.08.2026, i18n Settings checkpoint) so every
// existing `f.label` call site across Settings/Dashboard/History picks up
// the current language automatically — no call site needed to change.
const ALL_FACTORS = [
  { key: "sport", get label() { return t("factorLabels.sport"); } },
  { key: "sleep", get label() { return t("factorLabels.sleep"); } },
  { key: "nutrition", get label() { return t("factorLabels.nutrition"); } },
  { key: "smoking", get label() { return t("factorLabels.smoking"); } },
  { key: "alcohol", get label() { return t("factorLabels.alcohol"); } },
  { key: "stress", get label() { return t("factorLabels.stress"); } },
  { key: "weight", get label() { return t("factorLabels.weight"); } },
  { key: "social", get label() { return t("factorLabels.social"); } },
  { key: "cognitive", get label() { return t("factorLabels.cognitive"); } },
  { key: "purpose", get label() { return t("factorLabels.purpose"); } },
];

function isFactorVisible(key) {
  return state.visibleFactors.includes(key);
}

// TZ, 17.08.2026: turning a factor off here now also removes its
// field(s) from both daily-input forms (Dashboard's "Отметить сегодня"
// and the retroactive "Изменить/Заполнить день" form), not just its
// dashboard card. One neutral-value table per factor, keyed the same
// as ALL_FACTORS — a future formula factor just needs an entry here,
// not a special case in the save handlers. Nutrition has no daily
// field yet, so it isn't listed.
const FACTOR_NEUTRAL_VALUES = {
  smoking: { cigarettes: 0 },
  sport: { activityMinutes: 0 },
  sleep: { sleepHoursExact: 7.5, bedtimeToday: "" },
  alcohol: { alcoholSpirits: "0", alcoholWine: "0", alcoholBeer: "0" },
  stress: { stressLevel: "" },
  nutrition: {
    nutritionMealsCount: "",
    nutritionSnacksCount: "",
    nutritionProteinTimes: "",
    nutritionProteinGrams: "",
    nutritionWaterAmount: "",
    nutritionWaterUnit: "ml",
    nutritionFlourType: "",
    nutritionSugarSources: {},
    nutritionSupplements: {},
  },
  social: { socialQualityToday: "" },
  weight: { weightKg: "", bodyFatPercent: "" },
  purpose: { purposeToday: "" },
  cognitive: { cognitiveActivityToday: "" },
};

// A field counts as "already answered for real" if it's not undefined
// (never saved) — for numeric fields that's the whole check, since 0 is
// itself a real answer; for the string/select fields "" is this app's
// existing convention for "not selected", same as every other select.
function hasRealFieldValue(entry, field, numeric) {
  if (!entry || entry[field] === undefined) return false;
  return numeric ? true : entry[field] !== "";
}

// Resolves one factor's field(s) for a save: reads live form values if
// the factor is currently visible; otherwise keeps whatever real value
// the day already had (so re-saving an unrelated field on a day with
// real historical data never silently overwrites it), or falls back to
// the fixed neutral default for a field that was never answered. This
// runs once, at save time — toggling the checkbox later never revisits
// or recomputes past ledger entries.
function resolvedFactorFields(factorKey, existingEntry, readFromDom) {
  if (isFactorVisible(factorKey)) return readFromDom();
  const neutral = FACTOR_NEUTRAL_VALUES[factorKey];
  const result = {};
  for (const field of Object.keys(neutral)) {
    const numeric = typeof neutral[field] === "number";
    result[field] = hasRealFieldValue(existingEntry, field, numeric) ? existingEntry[field] : neutral[field];
  }
  return result;
}

function renderFactorSettings(screen) {
  screen.innerHTML = `
    ${settingsBackButtonHtml()}
    <h2 class="screen-title">${t("settings.factorsTitle")}</h2>
    <div class="checkbox-list">
      ${ALL_FACTORS.map(
        (f) =>
          `<label class="checkbox-row"><input type="checkbox" data-factor="${f.key}" ${state.visibleFactors.includes(f.key) ? "checked" : ""}> ${f.label}</label>`
      ).join("")}
    </div>
  `;
  wireSettingsBackButton(screen);
  screen.querySelectorAll("[data-factor]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const key = cb.dataset.factor;
      state.visibleFactors = cb.checked
        ? [...new Set([...state.visibleFactors, key])]
        : state.visibleFactors.filter((k) => k !== key);
      saveState();
    });
  });
}

function renderNotifications(screen) {
  screen.innerHTML = `<h2 class="screen-title">${t("settings.notificationsTitle")}</h2><div class="empty-state">${t("settings.notificationsEmpty")}</div>`;
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
    return { text: localizedDailyRecordPhrase(), positive: true };
  }
  // Rounded, not the raw value (20.08.2026 fix): decaying sleep debt
  // asymptotically approaches but never exactly hits 0, so a run of
  // perfectly normal sleep can leave deltaDays at a real but
  // sub-cent value like -0.0001 forever. Rounding first means a day
  // that displays as 0.00 is never scored as "negative" for phrase
  // selection either — see formatDays for the matching display fix.
  const positive = Math.round(todayEntry.deltaDays * 100) / 100 >= 0;
  const pool = positive ? localizedDailyGoodPhrases() : localizedDailyBadPhrases();
  return { text: pickPhrase(pool, `${today}:${positive ? "g" : "b"}`), positive };
}

// Per-factor entry popup (20.08.2026, replaces the always-open
// "Отметить сегодня" form): each visible factor is a tappable tile in
// .factor-grid; tapping one opens just that factor's field(s) in an
// overlay instead of showing every factor's inputs on the dashboard at
// once. Reuses the same row/field-html functions the retroactive
// "Изменить/Заполнить день" screen uses, just with idPrefix "modal", and
// the same resolvedFactorFields/cascadeRecalcFrom save path the old
// single big form used — only scoped to one factor's fields per save
// instead of all of them at once.
// idPrefix-generic (23.08.2026 — was hardcoded to "modal", the
// dashboard's per-factor popup being the only caller at the time).
// Reused by dayEditFormHtml (idPrefix "edit") so the retroactive
// "Изменить/Заполнить день" form covers every visible factor via the
// same one dispatcher, not a hand-picked subset.
function factorModalFieldsHtml(idPrefix, key, entry) {
  const todayFlavor = idPrefix === "modal";
  switch (key) {
    case "smoking":
      return smokingFieldHtml(idPrefix, entry, todayFlavor ? t("factorFields.smokingLabelToday") : t("factorFields.smokingLabel"));
    case "sport":
      return activityFieldHtml(idPrefix, entry, todayFlavor ? t("factorFields.activityLabelToday") : t("factorFields.activityLabel"), todayFlavor);
    case "sleep":
      return sleepRowHtml(idPrefix, entry, todayFlavor ? t("factorFields.sleepLabelToday") : t("factorFields.sleepLabel"));
    case "alcohol":
      return alcoholFieldsHtml(idPrefix, entry, todayFlavor ? t("factorFields.alcoholLabelToday") : t("factorFields.alcoholLabel"));
    case "nutrition":
      return nutritionRowHtml(idPrefix, entry);
    case "social":
      return socialRowHtml(idPrefix, entry);
    case "weight":
      return weightRowHtml(idPrefix, entry);
    case "purpose":
      return purposeRowHtml(idPrefix, entry);
    case "cognitive":
      return cognitiveRowHtml(idPrefix, entry);
    case "stress":
      if (!isFactorVisible("stress")) return "";
      return `
        <div class="field">
          <label>${todayFlavor ? t("factorFields.stressLabelToday") : t("factorFields.stressLabel")}</label>
          <select id="${idPrefix}_stress">
            <option value="">${t("onboarding.selectPlaceholder")}</option>
            ${selectOptionsHtml(localizedStressLevelOptions(), entry.stressLevel)}
          </select>
        </div>`;
    default:
      return "";
  }
}

function readFactorModalFields(idPrefix, key) {
  switch (key) {
    case "smoking":
      return { cigarettes: Number(document.getElementById(`${idPrefix}_cigarettes`).value) || 0 };
    case "sport":
      return { activityMinutes: Number(document.getElementById(`${idPrefix}_activity`).value) || 0 };
    case "sleep": {
      const raw = document.getElementById(`${idPrefix}_sleep_hours`).value;
      return {
        sleepHoursExact: raw === "" ? undefined : Number(raw),
        bedtimeToday: timePickerValue(`${idPrefix}_bedtime`),
      };
    }
    case "alcohol":
      return {
        alcoholSpirits: document.getElementById(`${idPrefix}_alcohol_spirits`).value,
        alcoholWine: document.getElementById(`${idPrefix}_alcohol_wine`).value,
        alcoholBeer: document.getElementById(`${idPrefix}_alcohol_beer`).value,
      };
    case "stress":
      return { stressLevel: document.getElementById(`${idPrefix}_stress`).value };
    case "nutrition":
      return {
        nutritionMealsCount: document.getElementById(`${idPrefix}_nutrition_meals`).value,
        nutritionSnacksCount: document.getElementById(`${idPrefix}_nutrition_snacks`).value,
        nutritionProteinTimes: document.getElementById(`${idPrefix}_nutrition_protein_times`).value,
        nutritionProteinGrams: document.getElementById(`${idPrefix}_nutrition_protein_grams`).value,
        nutritionWaterAmount: document.getElementById(`${idPrefix}_nutrition_water_amount`).value,
        nutritionWaterUnit: document.getElementById(`${idPrefix}_nutrition_water_unit`).value,
        nutritionFlourType: document.getElementById(`${idPrefix}_nutrition_flour`).value,
        nutritionSugarSources: {
          none: !!document.getElementById(`${idPrefix}_nutrition_sugar_none`)?.checked,
          inProducts: !!document.getElementById(`${idPrefix}_nutrition_sugar_inProducts`)?.checked,
          juices: !!document.getElementById(`${idPrefix}_nutrition_sugar_juices`)?.checked,
          sweetDrinks: !!document.getElementById(`${idPrefix}_nutrition_sugar_sweetDrinks`)?.checked,
          added: !!document.getElementById(`${idPrefix}_nutrition_sugar_added`)?.checked,
        },
        nutritionSupplements: {
          vitamins: !!document.getElementById(`${idPrefix}_nutrition_supplements_vitamins`)?.checked,
          minerals: !!document.getElementById(`${idPrefix}_nutrition_supplements_minerals`)?.checked,
          other: !!document.getElementById(`${idPrefix}_nutrition_supplements_other`)?.checked,
        },
      };
    case "social":
      return { socialQualityToday: document.getElementById(`${idPrefix}_social`).value };
    case "weight":
      return {
        weightKg: document.getElementById(`${idPrefix}_weight`).value,
        bodyFatPercent: document.getElementById(`${idPrefix}_body_fat`).value,
      };
    case "purpose":
      return { purposeToday: document.getElementById(`${idPrefix}_purpose`).value };
    case "cognitive":
      return { cognitiveActivityToday: document.getElementById(`${idPrefix}_cognitive`).value };
    default:
      return {};
  }
}

// Full-screen factor entry page (20.08.2026, take 2 — replaces the
// bottom-sheet overlay from earlier the same day, which was unusable on
// real devices: the Save/Cancel row could end up unreachable behind the
// on-screen keyboard). Same page pattern as "Транзакции за день" —
// a plain screen reached via state.dashboardEditFactor, with a visible
// "← Назад" button and a full-width "Сохранить" button as normal page
// content, so there's no overlay/z-index/keyboard interaction to break.
function renderFactorEditScreen(screen, key) {
  const today = todayStr();
  const entry = state.ledger[today] || { cigarettes: "", activityMinutes: "" };
  const factor = ALL_FACTORS.find((f) => f.key === key);

  // Nutrition renders as 6 separate .nutrition-tile cards (see
  // nutritionRowHtml) rather than fields inside one big .log-card — the
  // wrapper below skips the "log-card" class for it so those tiles read
  // as distinct plates instead of one boxed card containing 6 rows.
  const wrapperClass = key === "nutrition" ? "factor-edit-screen" : "factor-edit-screen log-card";

  screen.innerHTML = `
    ${settingsBackButtonHtml()}
    <h2 class="screen-title">${factor ? escapeHtml(factor.label) : ""}</h2>
    <div class="${wrapperClass}">
      ${factorModalFieldsHtml("modal", key, entry)}
      <button class="btn factor-edit-save" id="factor-edit-save" type="button">${t("common.save")}</button>
    </div>
  `;

  if (key === "nutrition") wireNutritionExclusiveCheckboxes("modal");

  document.getElementById("settings-back").addEventListener("click", () => {
    state.dashboardEditFactor = null;
    saveState();
    renderDashboard(screen);
  });

  document.getElementById("factor-edit-save").addEventListener("click", () => {
    const existing = state.ledger[today];
    const fields = readFactorModalFields("modal", key);
    state.ledger[today] = { ...(existing || {}), ...fields };
    // Same cascade a retroactive edit uses (see cascadeRecalcFrom) — for
    // today alone this is equivalent to the old single-day computation,
    // it just goes through the shared path now.
    cascadeRecalcFrom(today);
    state.dashboardEditFactor = null;
    saveState();
    renderDashboard(screen);
  });
}

function renderDashboard(screen) {
  if (state.dashboardEditFactor) {
    renderFactorEditScreen(screen, state.dashboardEditFactor);
    return;
  }
  const period = state.chartPeriod || "month";
  const series = cumulativeSeries();
  const trend = sevenDayTrend();
  const capitalValue = series.length ? series[series.length - 1].value : 0;

  const today = todayStr();
  const todayEntry = state.ledger[today] || { cigarettes: "", activityMinutes: "" };
  const engagement = dailyEngagementPhrase(today, todayEntry);

  // Rounded before choosing the positive/negative color and the arrow
  // (20.08.2026 fix, same root cause as formatDays/reportClickableAmount/
  // the calendar's day-cell coloring): a cumulative value that displays
  // as 0.00 must not get colored/arrowed as if it were really negative.
  const capitalValueRounded = Math.round(capitalValue * 100) / 100;
  const trendRounded = Math.round(trend * 100) / 100;

  screen.innerHTML = `
    <div class="dashboard-sticky-top">
      <h2 class="screen-title">${t("dashboard.title")}</h2>
      <div class="capital-header">
        <div class="capital-value ${capitalValueRounded >= 0 ? "positive" : "negative"}">${formatDays(capitalValue)}</div>
        <div class="capital-trend ${trendRounded >= 0 ? "positive" : "negative"}">${trendRounded >= 0 ? "▲" : "▼"} ${formatDays(Math.abs(trend))} ${t("dashboard.trendSuffix")}</div>
      </div>
    </div>

    <div class="period-switch">
      ${["week", "month", "year"]
        .map(
          (p) =>
            `<button data-period="${p}" class="${period === p ? "active" : ""}">${
              p === "week" ? t("dashboard.periodWeek") : p === "month" ? t("dashboard.periodMonth") : t("dashboard.periodYear")
            }</button>`
        )
        .join("")}
    </div>

    <div class="chart-card">${renderChartSvg(series, period)}</div>

    <div class="next-step-card">
      <div class="kicker">${t("dashboard.todaySummaryTitle")}</div>
      <div>${todaySummary(todayEntry)}</div>
    </div>

    ${
      engagement
        ? `<div class="engagement-card ${engagement.positive ? "positive" : "negative"}">${escapeHtml(engagement.text)}</div>`
        : ""
    }

    <h3>${t("dashboard.markTodayTitle")}</h3>
    <div class="factor-grid">
      ${ALL_FACTORS.filter((f) => state.visibleFactors.includes(f.key))
        .map(
          (f) => `
            <button type="button" class="factor-card clickable" data-factor-key="${f.key}">
              <div class="name">${f.label}</div>
            </button>`
        )
        .join("")}
    </div>
  `;

  screen.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.chartPeriod = btn.dataset.period;
      saveState();
      renderDashboard(screen);
    });
  });

  screen.querySelectorAll("[data-factor-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dashboardEditFactor = btn.dataset.factorKey;
      saveState();
      renderDashboard(screen);
    });
  });
}

// Suppresses the display-only "−0.00" artifact (20.08.2026 fix): a
// value that rounds to 0.00 shows with no sign, even if the raw number
// is a tiny nonzero residual (e.g. slowly-decaying sleep debt after a
// run of normal sleep — see dailyEngagementPhrase for the matching
// phrase-selection fix). Real values still round normally.
function formatDays(value) {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  if (rounded === 0) return `0.00 ${t("dashboard.daysAbbrev")}`;
  const sign = value > 0 ? "+" : "−";
  return `${sign}${rounded.toFixed(2)} ${t("dashboard.daysAbbrev")}`;
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
    return t("daily.summaryLowActivity");
  }
  if (cigarettes < waterline) {
    return t("daily.summaryLessThanUsual");
  }
  if (cigarettes > waterline) {
    return t("daily.summaryMoreThanUsual");
  }
  return t("daily.summaryGood");
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
    return `<div class="empty-state">${t("dashboard.chartEmpty")}</div>`;
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

/* ---- Knowledge base ---- */

function renderKnowledge(screen) {
  screen.innerHTML = `
    <h2 class="screen-title">${t("knowledge.title")}</h2>
    ${localizedKnowledgeBase().map(
      (item) => `
      <details class="kb-card ${item.active || item.note ? "" : "disabled"}">
        <summary>
          <span class="name">${item.name}</span>${
            item.active
              ? ""
              : item.note
              ? ` <span class="optional-badge">${escapeHtml(item.note)}</span>`
              : ` <span class="optional-badge">${t("knowledge.comingSoon")}</span>`
          }
        </summary>
        <div class="kb-card-body">
          <div>${item.body}</div>
          <div class="source">${item.source}</div>
          ${item.sourceKeys ? `<div class="source">${sourceLinksHtml(item.sourceKeys)}</div>` : ""}
        </div>
      </details>`
    ).join("")}

    <h2>${t("knowledge.readingListTitle")}</h2>
    <ul class="reading-list">
      ${localizedReadingList().map((r) => `<li>${r}</li>`).join("")}
    </ul>

    <h2>${t("knowledge.sourcesTitle")}</h2>
    <div class="note">${t("knowledge.sourcesNote")}</div>
    <ul class="reading-list">
      ${localizedSources().map(
        (s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a> — ${escapeHtml(s.citation)}${
          s.url2 ? ` (<a href="${escapeHtml(s.url2)}" target="_blank" rel="noopener noreferrer">${t("knowledge.additionalLink")}</a>)` : ""
        }</li>`
      ).join("")}
    </ul>

    <h2>${t("knowledge.upcomingTitle")}</h2>
    <div class="note">${t("knowledge.upcomingNote")}</div>
    ${localizedUpcomingFactors().map(
      (f) => `<div class="ahead-item"><span>${f.name}</span><span class="optional-badge">${f.note}</span></div>`
    ).join("")}
    ${localizedUpcomingVotedExample().map(
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
    ${settingsBackButtonHtml()}
    <h2 class="screen-title">Забота</h2>
    <div class="section-tabs">
      <button data-section="support" class="${section === "support" ? "active" : ""}">Вопрос в поддержку</button>
      <button data-section="ideas" class="${section === "ideas" ? "active" : ""}">Предложить идею</button>
    </div>
    <div id="care-outer-content"></div>
  `;
  wireSettingsBackButton(screen);
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
    <h2 class="screen-title">Профиль</h2>
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
  if (smokingTerm) items.push({ label: t("factorLabels.smoking"), amount: smokingTerm });
  if (Number(entry.activityMinutes) > 0) {
    items.push({ label: t("factorLabels.sport"), amount: Math.min((Number(entry.activityMinutes) / 60) * 6, 9) / 24 });
  }
  if (entry.weeklyBonusDays) items.push({ label: t("history.weeklySportBonusShortLabel"), amount: entry.weeklyBonusDays, pinned: true });
  if (entry.sleepDebtDelta) items.push({ label: t("history.sleepDebtLabel"), amount: entry.sleepDebtDelta });
  if (entry.sleepRegularityDelta) items.push({ label: t("history.sleepRegularityLabel"), amount: entry.sleepRegularityDelta });
  if (entry.alcoholDelta) items.push({ label: t("factorLabels.alcohol"), amount: entry.alcoholDelta });
  return items;
}

// Human-readable sphere names (17.08.2026 audit fix) — an explicit
// mapping with a generic fallback, not a raw c.sphere passthrough, so
// adding a new sphere later can't leak its internal identifier straight
// into user-facing text before someone remembers to add a label for it.
const SPHERE_LABEL_KEYS = {
  sport: "sportSphere",
};

function sphereLabel(sphere) {
  return t(`history.${SPHERE_LABEL_KEYS[sphere] || "activitySphereFallback"}`);
}

// Inactivity-decay events recorded on this specific date (TZ section 7,
// 13.08.2026 display change: shown inside that day's "Списания" in the
// "Транзакции за день" popup instead of a standalone always-visible
// section). Storage/computation in applyInactivityDecay is unchanged.
function dayDecayChargeItems(date) {
  return state.decayCharges
    .filter((c) => c.date === date)
    .map((c) => ({
      label: t("history.inactivityChargeLabel")(sphereLabel(c.sphere), c.days, c.marginalPct),
      amount: -c.amountDays,
    }));
}

// Display-only rounding reconciliation (17.08.2026 fix): each breakdown
// line and the summary total are the same underlying deltaDays values,
// just rounded to 2dp independently for display — which can visibly
// disagree (e.g. +0.38 and +0.44 shown for a total that rounds to
// +0.81, not the +0.82 those two round-off figures appear to add to).
// The total itself is never touched here, only how the rounding
// "slack" is distributed across the displayed line items, so the
// summary keeps showing the same number it always did — this just
// makes the line items underneath add up to it on-screen. Working in
// integer cents avoids float drift; the leftover cent(s) go to the
// largest-magnitude line, where a ±0.01 nudge is least noticeable.
// "pinned" items (25.08.2026 fix — user-reported: the weekly sport bonus
// showed as +0.43 inside "Личные накопления"'s breakdown but +0.44 as its
// own "Дивиденды" line, same underlying entry.weeklyBonusDays value).
// Root cause: this function runs independently per breakdown array, and
// whichever array's slack-redistribution happens to land on the shared
// line item can round it differently than its OWN standalone array does.
// Fix: mark a shared item `pinned: true` so it's never chosen to absorb
// leftover cents — its rounded value is then guaranteed to match
// formatDays() of its own raw amount everywhere it's displayed. Falls
// back to picking a pinned item only if literally every item is pinned
// (never true today, but avoids a silent no-op diff in that edge case).
function reconcileBreakdownForDisplay(total, items) {
  if (items.length === 0) return items;
  const totalCents = Math.round(total * 100);
  const rounded = items.map((i) => ({ ...i, amount: Math.round(i.amount * 100) }));
  const diff = totalCents - rounded.reduce((sum, i) => sum + i.amount, 0);
  if (diff !== 0) {
    const candidates = rounded.some((i) => !i.pinned) ? rounded.filter((i) => !i.pinned) : rounded;
    let target = candidates[0];
    let maxAbs = -Infinity;
    candidates.forEach((i) => {
      if (Math.abs(i.amount) > maxAbs) {
        maxAbs = Math.abs(i.amount);
        target = i;
      }
    });
    target.amount += diff;
  }
  return rounded.map((i) => ({ ...i, amount: i.amount / 100 }));
}

// Tappable amount (TZ, 12.08.2026 pattern, reused 13.08.2026 outside a
// table for the "Транзакции за день" popup): the number itself is the
// <summary> of a <details> block. Was briefly open-by-default
// (23.08.2026, same pattern as .alcohol-details) to help people
// discover the click target; reverted 25.08.2026 per user feedback —
// collapsed by default, expand on tap, not the other way round.
//
// "No data" (—) is decided purely from whether there ARE any items, not
// from the rounded amount — a day whose factors happen to net to
// exactly 0.00 (e.g. an activity gain that cancels a smoking charge)
// used to fall through as "no data" and hide a real breakdown entirely.
// The 20.08.2026 fix folded in here: color class comes from the ROUNDED
// (displayed) value, not the raw one, so a tiny nonzero residual that
// displays as "0.00 дн." gets a neutral class instead of a misleading
// red one.
function reportClickableAmount(amount, items) {
  if (items.length === 0) return `<span class="amount">—</span>`;
  const roundedCents = Math.round(amount * 100);
  const cssClass = roundedCents > 0 ? "amount positive" : roundedCents < 0 ? "amount negative" : "amount";
  const reconciled = reconcileBreakdownForDisplay(amount, items);
  const detail = reconciled.map((i) => `<div class="decay-detail-row">${escapeHtml(i.label)}: ${formatDays(i.amount)}</div>`).join("");
  return `<details class="report-cell"><summary class="${cssClass}">${formatDays(amount)}</summary>${detail}</details>`;
}

// TZ section 7, 13.08.2026: tapping a date now navigates to a full
// screen ("Транзакции за [дата]") instead of opening a popup over the
// calendar — same breakdown content as the earlier modal version, just
// reached via state.nav="history-day" + state.historyDetailDate.
function dayTransactionsHtml(date) {
  const entry = state.ledger[date];
  if (!entry) {
    return `<div class="empty-state">${t("history.noOperations")}</div>`;
  }
  const savings = entry.deltaDays || 0;
  const dividends = entry.weeklyBonusDays || 0;
  const breakdown = dailyFactorBreakdown(entry);
  const chargeItems = [...breakdown.filter((i) => i.amount < 0), ...dayDecayChargeItems(date)];
  const charges = chargeItems.reduce((sum, i) => sum + i.amount, 0);
  const dividendItems = dividends
    ? [{ label: t("history.weeklySportBonusLabel")(mondayOfWeek(date), date), amount: dividends }]
    : [];

  return `
    <div class="modal-row">
      <span>${t("history.personalSavingsLabel")}</span>
      ${reportClickableAmount(savings, breakdown)}
    </div>
    <div class="modal-row">
      <span>${t("history.dividendsLabel")}</span>
      ${reportClickableAmount(dividends, dividendItems)}
    </div>
    <div class="modal-row">
      <span>${t("history.chargesLabel")}</span>
      ${reportClickableAmount(charges, chargeItems)}
    </div>
  `;
}

// "Сводка вложений" (26.08.2026, user request — an investment-statement
// style summary: same three buckets as the per-day "Транзакции"
// screen (Личные накопления / Дивиденды / Списания), but totalled
// across every logged day instead of drilling into one date at a time.
// Reuses dailyFactorBreakdown/state.decayCharges — the same numbers
// each day already shows — rather than a parallel calculation, so the
// aggregate is guaranteed to reconcile with what the calendar/day view
// already displays. v1 scope: whole history, no period picker (see
// TASKS.md if a month/year filter is wanted later).
function aggregateBreakdown() {
  const dates = sortedLedgerDates();
  const investBuckets = new Map(); // label -> summed positive, non-dividend days
  const chargeBuckets = new Map(); // label -> summed negative factor days
  const inactivityBuckets = new Map(); // sphere -> summed decay-charge days
  let savingsTotal = 0;
  let dividendsTotal = 0;
  let dividendWeeks = 0;

  for (const date of dates) {
    const entry = state.ledger[date];
    if (!entry) continue;
    savingsTotal += entry.deltaDays || 0;
    if (entry.weeklyBonusDays) {
      dividendsTotal += entry.weeklyBonusDays;
      dividendWeeks += 1;
    }
    for (const item of dailyFactorBreakdown(entry)) {
      if (item.pinned) continue; // weekly bonus — already folded into dividendsTotal above
      const bucket = item.amount >= 0 ? investBuckets : chargeBuckets;
      bucket.set(item.label, (bucket.get(item.label) || 0) + item.amount);
    }
  }
  for (const charge of state.decayCharges) {
    const label = sphereLabel(charge.sphere);
    inactivityBuckets.set(label, (inactivityBuckets.get(label) || 0) - charge.amountDays);
  }

  const investItems = [...investBuckets.entries()].map(([label, amount]) => ({ label, amount }));
  const dividendItems = dividendsTotal
    ? [{ label: t("history.summaryDividendsAggregateLabel")(dividendWeeks), amount: dividendsTotal }]
    : [];
  const chargeItems = [
    ...[...chargeBuckets.entries()].map(([label, amount]) => ({ label, amount })),
    ...[...inactivityBuckets.entries()].map(([label, amount]) => ({ label, amount })),
  ];
  const chargesTotal = chargeItems.reduce((sum, i) => sum + i.amount, 0);

  return { savingsTotal, investItems, dividendsTotal, dividendItems, chargesTotal, chargeItems };
}

// Reached via state.nav="history-summary" from the card at the bottom of
// the calendar screen. Same .modal-row / reportClickableAmount visual
// language as the per-day screen for consistency.
function renderHistorySummary(screen) {
  const hasAnyData = sortedLedgerDates().some((d) => state.ledger[d]);
  const { savingsTotal, investItems, dividendsTotal, dividendItems, chargesTotal, chargeItems } = aggregateBreakdown();

  screen.innerHTML = `
    ${settingsBackButtonHtml()}
    <h2 class="screen-title">${t("history.summaryTitle")}</h2>
    ${
      hasAnyData
        ? `
      <div class="modal-row">
        <span>${t("history.personalSavingsLabel")}</span>
        ${reportClickableAmount(savingsTotal, investItems)}
      </div>
      <div class="modal-row">
        <span>${t("history.dividendsLabel")}</span>
        ${reportClickableAmount(dividendsTotal, dividendItems)}
      </div>
      <div class="modal-row">
        <span>${t("history.chargesLabel")}</span>
        ${reportClickableAmount(chargesTotal, chargeItems)}
      </div>
    `
        : `<div class="empty-state">${t("history.summaryEmpty")}</div>`
    }
  `;
  document.getElementById("settings-back").addEventListener("click", () => {
    state.nav = "history";
    saveState();
    render();
  });
}

// Retroactive fill/edit form (23.08.2026 — was hardcoded to the 4
// formula factors, courение/спорт/сон/алкоголь; now covers every
// factor currently visible on the dashboard, same
// ALL_FACTORS.filter(isFactorVisible) list renderDashboard's
// factor-grid uses, via the same idPrefix-generic dispatcher the
// per-factor modal uses — see factorModalFieldsHtml). Nutrition renders
// as its own tiles outside the .log-card, matching
// renderFactorEditScreen's treatment of it.
function dayEditFormHtml(date, entry) {
  const e = entry || {};
  const visibleKeys = ALL_FACTORS.filter((f) => isFactorVisible(f.key)).map((f) => f.key);
  const nutritionVisible = visibleKeys.includes("nutrition");
  const otherFieldsHtml = visibleKeys
    .filter((key) => key !== "nutrition")
    .map((key) => factorModalFieldsHtml("edit", key, e))
    .join("");
  return `
    <div class="log-card">
      <h3>${entry ? t("history.changeDayTitle") : t("history.fillDayTitle")}</h3>
      ${otherFieldsHtml}
    </div>
    ${nutritionVisible ? factorModalFieldsHtml("edit", "nutrition", e) : ""}
    <button class="btn" id="day-edit-save" style="width:100%">${t("common.save")}</button>
  `;
}

// TZ, 17.08.2026: view/edit split (п.7-7.1) — a day that already has
// data opens in read-only summary by default; "Изменить" reveals the
// form on demand instead of it always sitting expanded underneath. A
// day with no data (but inside the editable window) still jumps
// straight to the form — there's nothing to view yet. state.
// historyDayEditMode tracks whether the form is currently open; reset
// to false whenever a new date is opened from the calendar (see the
// day-cell click handler in renderHistory) so re-entering a day always
// starts back in view mode.
function renderHistoryDay(screen) {
  const date = state.historyDetailDate;
  const entry = state.ledger[date];
  const editable = isDateEditable(date);
  const showForm = editable && (!entry || state.historyDayEditMode);

  screen.innerHTML = `
    ${settingsBackButtonHtml()}
    <h2 class="screen-title">${t("history.transactionsTitle")(escapeHtml(date || ""))}</h2>
    ${entry ? dayTransactionsHtml(date) : `<div class="empty-state">${t("history.noOperations")}</div>`}
    ${
      editable && entry && !showForm
        ? `<button class="btn secondary" id="day-edit-toggle" style="width:100%; margin-top:12px;">${t("history.editButton")}</button>`
        : ""
    }
    ${showForm ? dayEditFormHtml(date, entry) : ""}
    ${
      !editable && !entry
        ? `<div class="note">${t("history.editWindowNote")}</div>`
        : ""
    }
  `;
  document.getElementById("settings-back").addEventListener("click", () => {
    state.nav = "history";
    state.historyDayEditMode = false;
    saveState();
    render();
  });
  const toggleBtn = document.getElementById("day-edit-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      state.historyDayEditMode = true;
      saveState();
      renderHistoryDay(screen);
    });
  }
  if (showForm) {
    if (isFactorVisible("nutrition")) wireNutritionExclusiveCheckboxes("edit");
    document.getElementById("day-edit-save").addEventListener("click", () => {
      const existing = state.ledger[date];
      let fields = {};
      for (const factor of ALL_FACTORS) {
        fields = {
          ...fields,
          ...resolvedFactorFields(factor.key, existing, () => readFactorModalFields("edit", factor.key)),
        };
      }
      state.ledger[date] = { ...(existing || {}), ...fields };
      cascadeRecalcFrom(date);
      state.historyDayEditMode = false;
      saveState();
      renderHistoryDay(screen);
    });
  }
}

const MONTH_NAMES = {
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
const WEEKDAY_LABELS = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
function localizedMonthNames() {
  return MONTH_NAMES[getLang()] || MONTH_NAMES.ru;
}
function localizedWeekdayLabels() {
  return WEEKDAY_LABELS[getLang()] || WEEKDAY_LABELS.ru;
}

// TZ section 7, 13.08.2026: "История" — calendar grid. Legend is
// binary (replaces the earlier 4-tier intensity idea): green = day's
// balance positive, red = negative, no color = no data that day — no
// on-screen legend text, colors are meant to read as self-evident.
// Balance number itself is deliberately not shown on the grid. Tapping
// a date navigates to a full "Транзакции за [дата]" screen (was a
// popup) with the same per-factor breakdown as before.
function renderHistory(screen) {
  const monthStr = state.historyMonth || todayStr().slice(0, 7);
  const [year, mon] = monthStr.split("-").map(Number);

  const firstOfMonth = new Date(Date.UTC(year, mon - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const firstWeekday = firstOfMonth.getUTCDay(); // 0=Sun..6=Sat
  const leadingPad = firstWeekday === 0 ? 6 : firstWeekday - 1; // Monday-first grid

  const cells = [];
  for (let i = 0; i < leadingPad; i++) cells.push(`<div class="day-cell pad"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = state.ledger[dateStr];
    // Rounded before classifying (20.08.2026 fix, same root cause as
    // formatDays/reportClickableAmount): a tiny nonzero deltaDays that
    // displays as 0.00 — e.g. slowly-decaying sleep debt after a run of
    // normal sleep — must not paint the day red/green on the calendar.
    const delta = entry ? Math.round((entry.deltaDays || 0) * 100) / 100 : 0;
    const cls = delta > 0 ? "positive" : delta < 0 ? "negative" : "empty";
    const editable = isDateEditable(dateStr);
    // Locked days stay visible and, if they have data, still tappable
    // (opens a read-only view) — only the editing itself is blocked,
    // per TZ (не скрывать день, а заблокировать тап на редактирование).
    const locked = !editable ? " locked" : "";
    const disabled = !editable && !entry ? "disabled" : "";
    cells.push(`<button class="day-cell ${cls}${locked}" data-date="${dateStr}" ${disabled} title="${editable ? "" : t("history.editingUnavailable")}">${d}</button>`);
  }
  const trailingPad = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailingPad; i++) cells.push(`<div class="day-cell pad"></div>`);

  const isCurrentMonth = monthStr === todayStr().slice(0, 7);

  screen.innerHTML = `
    <h2 class="screen-title">${t("history.calendarTitle")}</h2>
    <div class="history-nav">
      <button class="btn secondary" id="month-prev">‹</button>
      <div class="month-label">${localizedMonthNames()[mon - 1]} ${year}</div>
      <button class="btn secondary" id="month-next" ${isCurrentMonth ? "disabled" : ""}>›</button>
    </div>
    <div class="history-grid history-weekdays">
      ${localizedWeekdayLabels().map((w) => `<div class="weekday-label">${w}</div>`).join("")}
    </div>
    <div class="history-grid">${cells.join("")}</div>
    <button type="button" class="factor-card clickable" id="history-summary-card" style="margin-top:20px;">
      <div class="name">${t("history.summaryCardTitle")}</div>
      <div class="hint">${t("history.summaryCardHint")}</div>
    </button>
  `;

  document.getElementById("history-summary-card").addEventListener("click", () => {
    state.nav = "history-summary";
    saveState();
    render();
  });
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
      state.historyDetailDate = btn.dataset.date;
      state.historyDayEditMode = false;
      state.nav = "history-day";
      saveState();
      render();
    });
  });
}

/* ---------------------------------------------------------------------
 * Init
 * ------------------------------------------------------------------- */

render();
authRestoreSession();
