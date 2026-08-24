"use strict";
/*
 * Plain-Node test for the retroactive-entry feature (TZ, 16.08.2026):
 * editable-window boundaries (isDateEditable) and the cascade recompute
 * (cascadeRecalcFrom). No test framework/dependency — the project has
 * none, and this is a small enough surface that adding one isn't
 * justified. Loads app.js into a vm sandbox with a minimal DOM/
 * localStorage/location shim (app.js is a browser-only script, not a
 * module) and appends the tests to the SAME script so they share
 * app.js's top-level `let state` and function declarations by ordinary
 * lexical scoping — no exports needed.
 *
 * Run: node app/app.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

function makeFakeElement() {
  return {
    value: "",
    checked: false,
    style: {},
    innerHTML: "",
    disabled: false,
    dataset: {},
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
  };
}

const fakeDocument = {
  getElementById() {
    return makeFakeElement();
  },
  querySelectorAll() {
    return [];
  },
  querySelector() {
    return null;
  },
};

let storedState = null;
const fakeLocalStorage = {
  getItem() {
    return storedState;
  },
  setItem(_key, value) {
    storedState = value;
  },
  removeItem() {
    storedState = null;
  },
};

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
  }
}

const sandbox = {
  document: fakeDocument,
  localStorage: fakeLocalStorage,
  location: { search: "", pathname: "/app/index.html", replace() {} },
  requestAnimationFrame() {},
  performance: { now: () => Date.now() },
  alert() {},
  URLSearchParams,
  console,
  assert,
  test,
};
vm.createContext(sandbox);

const testsSource = `
/* ---- isDateEditable boundary tests ---- */

function daysAgo(n) {
  const d = new Date(todayStr() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysAhead(n) {
  return daysAgo(-n);
}

test("onboarding date itself is editable", () => {
  state.createdAt = daysAgo(3);
  assert.strictEqual(isDateEditable(state.createdAt), true);
});

test("exactly 7 days ago is editable (onboarding well before that)", () => {
  state.createdAt = daysAgo(60);
  assert.strictEqual(isDateEditable(daysAgo(7)), true);
});

test("8 days ago is NOT editable (older than the 7-day window)", () => {
  state.createdAt = daysAgo(60);
  assert.strictEqual(isDateEditable(daysAgo(8)), false);
});

test("tomorrow is NOT editable", () => {
  state.createdAt = daysAgo(3);
  assert.strictEqual(isDateEditable(daysAhead(1)), false);
});

test("the day before onboarding is NOT editable", () => {
  state.createdAt = daysAgo(3);
  assert.strictEqual(isDateEditable(daysAgo(4)), false);
});

test("onboarding date older than 7 days is NOT editable (cutoff wins)", () => {
  state.createdAt = daysAgo(60);
  assert.strictEqual(isDateEditable(state.createdAt), false);
});

test("today is editable", () => {
  state.createdAt = daysAgo(3);
  assert.strictEqual(isDateEditable(todayStr()), true);
});

/* ---- cascadeRecalcFrom: weekly sport bonus ---- */

test("retroactive edit recomputes the week's Sunday top-up bonus", () => {
  state.createdAt = daysAgo(40);
  state.onboarding = { gender: "male" };
  state.smokingWaterline = 0;
  state.ledger = {};
  state.decayCharges = [];

  const monday = mondayOfWeek(daysAgo(10));
  const week = weekDatesFrom(monday); // Mon..Sun

  // Original chronological saves: nobody active all week.
  for (const date of week) {
    state.ledger[date] = {
      cigarettes: 0,
      activityMinutes: 0,
      sleepHoursRange: "",
      alcoholSpirits: "",
      alcoholWine: "",
      alcoholBeer: "",
    };
    cascadeRecalcFrom(date);
  }
  assert.strictEqual(state.ledger[week[6]].weeklyBonusDays || 0, 0);

  // Retroactive edit: Monday actually had 300 minutes of activity.
  state.ledger[week[0]].activityMinutes = 300;
  cascadeRecalcFrom(week[0]);

  // Monday's own delta: capped at the 9-hour/day gain ceiling.
  assert.strictEqual(state.ledger[week[0]].deltaDays, 9 / 24);
  // Week raw=300, credited=min(300,90)=90 -> top-up = 210 min = 0.875 days,
  // stored on the Sunday entry per the existing weekly-bonus mechanic.
  assert.strictEqual(state.ledger[week[6]].weeklyBonusDays, 0.875);
  assert.strictEqual(state.ledger[week[6]].deltaDays, 0.875);
});

/* ---- cascadeRecalcFrom: inactivity-decay replay ---- */

test("retroactive edit that breaks a streak removes the now-invalid decay charge", () => {
  state.createdAt = daysAgo(40);
  state.onboarding = { gender: "male" };
  state.smokingWaterline = 0;
  state.ledger = {};
  state.decayCharges = [];

  const end = daysAgo(15);
  const streakDates = [];
  for (let i = 6; i >= 0; i--) streakDates.push(daysAgo(15 + i)); // 7 inactive days ending at "end"
  // Anchor day right before the streak so daysSinceLastActivity's
  // backward walk stops there instead of running into the unseeded gap
  // back to createdAt and inflating the streak length.
  state.ledger[daysAgo(22)] = {
    cigarettes: 0,
    activityMinutes: 30,
    sleepHoursRange: "",
    alcoholSpirits: "",
    alcoholWine: "",
    alcoholBeer: "",
  };
  for (const date of streakDates) {
    state.ledger[date] = {
      cigarettes: 0,
      activityMinutes: 0,
      sleepHoursRange: "",
      alcoholSpirits: "",
      alcoholWine: "",
      alcoholBeer: "",
    };
  }
  cascadeRecalcFrom(streakDates[0]);
  assert.strictEqual(
    state.decayCharges.some((c) => c.date === end && c.days === 7),
    true,
    "7-day inactivity tier should have been charged on the streak's last day"
  );

  // Retroactively fill in activity on the middle day of the streak.
  const midDate = streakDates[3];
  state.ledger[midDate].activityMinutes = 60;
  cascadeRecalcFrom(midDate);

  assert.strictEqual(
    state.decayCharges.some((c) => c.date === end && c.days === 7),
    false,
    "the 7-day charge is no longer valid once the streak is broken partway through"
  );
});

test("cascadeRecalcFrom leaves decay charges recorded before fromDate untouched", () => {
  state.createdAt = daysAgo(60);
  state.onboarding = { gender: "male" };
  state.smokingWaterline = 0;
  state.ledger = {};
  state.decayCharges = [];

  const oldEnd = daysAgo(50);
  const oldStreak = [];
  for (let i = 6; i >= 0; i--) oldStreak.push(daysAgo(50 + i));
  // Same anchor-day fix as the previous test.
  state.ledger[daysAgo(57)] = {
    cigarettes: 0,
    activityMinutes: 30,
    sleepHoursRange: "",
    alcoholSpirits: "",
    alcoholWine: "",
    alcoholBeer: "",
  };
  for (const date of oldStreak) {
    state.ledger[date] = {
      cigarettes: 0,
      activityMinutes: 0,
      sleepHoursRange: "",
      alcoholSpirits: "",
      alcoholWine: "",
      alcoholBeer: "",
    };
  }
  cascadeRecalcFrom(oldStreak[0]);
  const chargeBefore = state.decayCharges.find((c) => c.date === oldEnd && c.days === 7);
  assert.ok(chargeBefore, "sanity check: old streak's charge exists before the later edit");

  // Unrelated, much-later edit — shouldn't touch the earlier charge.
  const laterDate = daysAgo(5);
  state.ledger[laterDate] = {
    cigarettes: 0,
    activityMinutes: 45,
    sleepHoursRange: "",
    alcoholSpirits: "",
    alcoholWine: "",
    alcoholBeer: "",
  };
  cascadeRecalcFrom(laterDate);

  const chargeAfter = state.decayCharges.find((c) => c.date === oldEnd && c.days === 7);
  assert.ok(chargeAfter, "earlier charge must survive an edit that starts well after it");
  assert.deepStrictEqual(chargeAfter, chargeBefore);
});

/* ---- Sleep debt + regularity (TZ 3.3.1, 16.08.2026) ---- */

test("sleepDebtPenalty is zero at zero debt", () => {
  assert.strictEqual(sleepDebtPenalty(0), 0);
});

test("sleepDebtPenalty is steeper for oversleep debt than undersleep debt (JAHA 13/6 ratio)", () => {
  const under = sleepDebtPenalty(4); // positive debt = net undersleep
  const over = sleepDebtPenalty(-4); // negative debt = net oversleep
  assert.ok(under < 0 && over < 0);
  assert.ok(Math.abs(over) > Math.abs(under));
  assert.ok(Math.abs(Math.abs(over) / Math.abs(under) - 13 / 6) < 1e-9);
});

test("sleep debt decays across a calendar gap between logged days", () => {
  state.createdAt = daysAgo(40);
  state.onboarding = { gender: "male" };
  state.smokingWaterline = 0;
  state.ledger = {};
  state.decayCharges = [];

  const first = daysAgo(20);
  const second = daysAgo(10);
  state.ledger[first] = {
    cigarettes: 0,
    activityMinutes: 0,
    sleepHoursRange: "lt5", // midpoint 4.5h vs norm 7.5h -> deviation of 3
    alcoholSpirits: "",
    alcoholWine: "",
    alcoholBeer: "",
  };
  cascadeRecalcFrom(first);
  assert.strictEqual(state.ledger[first].sleepDebt, 3);

  state.ledger[second] = {
    cigarettes: 0,
    activityMinutes: 0,
    sleepHoursRange: "7to8", // exactly the norm -> zero deviation
    alcoholSpirits: "",
    alcoholWine: "",
    alcoholBeer: "",
  };
  cascadeRecalcFrom(second);
  const expectedDebt = 3 * Math.pow(SLEEP_DEBT_DECAY_K, 10); // 10-day gap, decay only
  assert.ok(Math.abs(state.ledger[second].sleepDebt - expectedDebt) < 1e-9);
});

test("retroactive edit to an earlier day's sleep cascades into a later day's accumulated debt", () => {
  state.createdAt = daysAgo(40);
  state.onboarding = { gender: "male" };
  state.smokingWaterline = 0;
  state.ledger = {};
  state.decayCharges = [];

  const day1 = daysAgo(5);
  const day2 = daysAgo(4);
  state.ledger[day1] = { cigarettes: 0, activityMinutes: 0, sleepHoursRange: "7to8", alcoholSpirits: "", alcoholWine: "", alcoholBeer: "" };
  cascadeRecalcFrom(day1);
  state.ledger[day2] = { cigarettes: 0, activityMinutes: 0, sleepHoursRange: "7to8", alcoholSpirits: "", alcoholWine: "", alcoholBeer: "" };
  cascadeRecalcFrom(day2);
  assert.strictEqual(state.ledger[day2].sleepDebt, 0);

  // Retroactively fix day1: it was actually a short-sleep night.
  state.ledger[day1].sleepHoursRange = "lt5";
  cascadeRecalcFrom(day1);

  const expectedDay2Debt = 3 * SLEEP_DEBT_DECAY_K; // day1's fresh debt of 3, one day of decay, no new deviation
  assert.ok(Math.abs(state.ledger[day2].sleepDebt - expectedDay2Debt) < 1e-9);
  assert.ok(state.ledger[day2].sleepDebtDelta < 0, "day2's capital delta should now carry a sleep-debt penalty it didn't have before");
});

test("sleep regularity penalty is inactive with fewer than 7 bedtime samples", () => {
  state.createdAt = daysAgo(40);
  state.ledger = {};
  for (let i = 6; i >= 1; i--) {
    state.ledger[daysAgo(i)] = { bedtimeToday: "23:00" };
  }
  assert.strictEqual(sleepRegularityPenalty(daysAgo(1)), 0);
});

test("sleep regularity penalizes a widely scattered bedtime but rewards a consistent one", () => {
  state.createdAt = daysAgo(40);

  const consistentTimes = ["22:50", "23:00", "23:05", "22:55", "23:10", "23:00", "22:58"];
  state.ledger = {};
  for (let i = 0; i < 7; i++) {
    state.ledger[daysAgo(7 - i)] = { bedtimeToday: consistentTimes[i] };
  }
  // 25.08.2026: a consistent bedtime now earns a small positive bonus
  // (same reallocated-prevalence figure as sleepDebtPenalty's good-sleep
  // bonus) instead of just avoiding a penalty.
  assert.ok(sleepRegularityPenalty(daysAgo(1)) > 0, "a consistent bedtime schedule should earn a small bonus");

  const scatteredTimes = ["21:00", "01:30", "23:00", "03:00", "20:30", "00:15", "22:00"];
  state.ledger = {};
  for (let i = 0; i < 7; i++) {
    state.ledger[daysAgo(7 - i)] = { bedtimeToday: scatteredTimes[i] };
  }
  const penalty = sleepRegularityPenalty(daysAgo(1));
  assert.ok(penalty < 0, "a wildly scattered bedtime schedule should be penalized");
});

/* ---- Per-factor field visibility + neutral substitution (TZ, 17.08.2026) ---- */

test("resolvedFactorFields reads live form values when the factor is visible", () => {
  state.visibleFactors = ["smoking"];
  const result = resolvedFactorFields("smoking", undefined, () => ({ cigarettes: 7 }));
  assert.deepStrictEqual(result, { cigarettes: 7 });
});

test("resolvedFactorFields uses the neutral default for a hidden factor with no prior data", () => {
  state.visibleFactors = [];
  const result = resolvedFactorFields("alcohol", undefined, () => {
    throw new Error("must not read from the (hidden, unrendered) form");
  });
  assert.deepStrictEqual(result, { alcoholSpirits: "0", alcoholWine: "0", alcoholBeer: "0" });
});

test("resolvedFactorFields preserves a day's real historical value instead of overwriting it with neutral when the factor is later hidden", () => {
  state.visibleFactors = []; // smoking turned off after this day's real data was saved
  const existingEntry = { cigarettes: 12 }; // a real, previously-logged value
  const result = resolvedFactorFields("smoking", existingEntry, () => {
    throw new Error("must not read from the (hidden, unrendered) form");
  });
  assert.deepStrictEqual(result, { cigarettes: 12 }, "real past data must survive, not be silently zeroed out");
});

test("resolvedFactorFields treats an explicit 0 as real data, not as 'never answered'", () => {
  state.visibleFactors = [];
  const existingEntry = { cigarettes: 0 }; // user genuinely smoked zero that day
  const result = resolvedFactorFields("smoking", existingEntry, () => {
    throw new Error("must not read from the form");
  });
  assert.deepStrictEqual(result, { cigarettes: 0 });
});

test("resolvedFactorFields treats an empty-string select value as 'never answered', not as real data", () => {
  state.visibleFactors = [];
  // Legacy entry from before the 20.08.2026 exact-hours change: only the
  // old bucket field was ever set (and left blank); sleepHoursExact was
  // never written at all, so it must fall back to the neutral default.
  const existingEntry = { sleepHoursRange: "", bedtimeToday: "" };
  const result = resolvedFactorFields("sleep", existingEntry, () => {
    throw new Error("must not read from the form");
  });
  assert.deepStrictEqual(result, { sleepHoursExact: 7.5, bedtimeToday: "" });
});
`;

new vm.Script(`${appSource}\n${testsSource}`, { filename: "app.js+tests" }).runInContext(sandbox);

let failed = 0;
for (const r of results) {
  if (r.pass) {
    console.log(`PASS - ${r.name}`);
  } else {
    failed++;
    console.log(`FAIL - ${r.name}\n       ${r.error}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
