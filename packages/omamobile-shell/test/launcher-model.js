// SPDX-License-Identifier: MIT
// Node tests for the app drawer's list, rail, hidden apps, calculator and
// search (LauncherModel.js). Run by test/all.
"use strict"
const assert = require("assert")
const path = require("path")
const L = require(path.join(__dirname, "../plugins/omamobile.launcher/LauncherModel.js"))

const tests = []
const test = (name, fn) => tests.push([name, fn])
const app = (id, name) => ({ id, name })
const nameOf = (e) => e.name

test("letters: accents dropped, anything else under #", () => {
  assert.strictEqual(L.letterOf("chromium"), "C")
  assert.strictEqual(L.letterOf("Écran"), "E")
  assert.strictEqual(L.letterOf("2048"), "#")
  assert.strictEqual(L.letterOf(""), "#")
  assert.strictEqual(L.letterOf("  zed"), "Z")
})

test("rows: apps in rows of the columns, a header and a new row per letter", () => {
  const apps = [app("a1", "Aether"), app("a2", "Agent"), app("b1", "Browser"), app("c1", "Camera"), app("c2", "Chat"), app("c3", "Clock")]
  const rows = L.drawerRows(apps, nameOf, 2, true)
  assert.deepStrictEqual(rows.map((r) => r.kind === "header" ? r.label : r.entries.map((e) => e.id).join(",")),
    ["A", "a1,a2", "B", "b1", "C", "c1,c2", "c3"])
  assert.strictEqual(rows[3].start, 2, "a row knows its first app's index")
  const flat = L.drawerRows(apps, nameOf, 4, false)
  assert.deepStrictEqual(flat.map((r) => r.entries.length), [4, 2], "without headers, plain rows")
  assert.deepStrictEqual(L.drawerRows([], nameOf, 4, true), [])
})

test("rail: each letter once, with its row; a finger picks one", () => {
  const rows = L.drawerRows([app("a", "Ant"), app("b", "Bee"), app("c", "Cat")], nameOf, 4, true)
  assert.deepStrictEqual(L.railLetters(rows), [{ letter: "A", row: 0 }, { letter: "B", row: 2 }, { letter: "C", row: 4 }])
  assert.strictEqual(L.railPick(0, 300, 3), 0)
  assert.strictEqual(L.railPick(150, 300, 3), 1)
  assert.strictEqual(L.railPick(299, 300, 3), 2)
  assert.strictEqual(L.railPick(-40, 300, 3), 0, "above the rail: the first")
  assert.strictEqual(L.railPick(900, 300, 3), 2, "below it: the last")
  assert.strictEqual(L.railPick(10, 300, 0), -1, "no letters")
})

test("rail filter: the letters there are, and only one letter's apps", () => {
  const apps = [app("a", "Ant"), app("b", "bee"), app("e", "Écran"), app("a2", "Axe"), app("n", "2048")]
  assert.deepStrictEqual(L.appLetters(apps, nameOf).map((l) => l.letter), ["A", "B", "E", "#"], "each once, in order")
  assert.deepStrictEqual(L.byLetter(apps, nameOf, "A").map((e) => e.id), ["a", "a2"])
  assert.deepStrictEqual(L.byLetter(apps, nameOf, "E").map((e) => e.id), ["e"], "accents folded")
  assert.deepStrictEqual(L.byLetter(apps, nameOf, "#").map((e) => e.id), ["n"])
  assert.deepStrictEqual(L.byLetter(apps, nameOf, "").map((e) => e.id), ["a", "b", "e", "a2", "n"], "no letter: all")
  assert.deepStrictEqual(L.byLetter(apps, nameOf, "Q"), [])
})

test("tabs: Linux apps and the Android apps Waydroid made entries for", () => {
  const apps = [app("chromium", "Chromium"), app("waydroid.org.fdroid.fdroid", "F-Droid"), app("foot", "Foot"), app("waydroid.com.aurora.store", "Aurora Store")]
  assert.deepStrictEqual(L.byTab(apps, "linux").map((e) => e.id), ["chromium", "foot"])
  assert.deepStrictEqual(L.byTab(apps, "android").map((e) => e.id), ["waydroid.org.fdroid.fdroid", "waydroid.com.aurora.store"])
  assert.strictEqual(L.countAndroid(apps), 2)
  assert.strictEqual(L.countAndroid([app("x", "X")]), 0)
  assert.strictEqual(L.isAndroidApp({ id: "org.waydroid.thing" }), false, "only Waydroid's own entries")
})

test("search rows: the answer first, then apps, contacts and settings under their headers", () => {
  const rows = L.searchRows([app("x", "X"), app("y", "Y"), app("z", "Z")], 2, { expression: "6*7", value: 42, display: "42" },
    [{ name: "Ada", number: "+1 555 0100", label: "Mobile" }], [{ id: "setup", label: "Setup", argv: ["omarchy-menu", "summon", "setup"] }])
  assert.deepStrictEqual(rows.map((r) => r.kind), ["calc", "apps", "apps", "contact", "header", "setting", "header"])
  assert.strictEqual(rows[4].label, "Contacts")
  assert.strictEqual(rows[6].label, "Settings")
  assert.strictEqual(rows[3].name, "Ada")
  assert.deepStrictEqual(L.searchRows([], 4, null, [], []), [])
})

test("hidden apps: a list of ids, dropped while browsing, found by a search", () => {
  const set = L.parseIdList("chromium\nfoot.desktop\n\n  \n")
  assert.deepStrictEqual(set, { chromium: true, foot: true })
  assert.strictEqual(L.idListText(set), "chromium\nfoot\n")
  assert.strictEqual(L.idListText({}), "")
  const shown = L.withId(set, "foot", false)
  assert.deepStrictEqual(shown, { chromium: true })
  assert.deepStrictEqual(set, { chromium: true, foot: true }, "the old set is left alone")
  assert.deepStrictEqual(L.withId(shown, "zed", true), { chromium: true, zed: true })
  const apps = [app("chromium", "Chromium"), app("foot", "Foot"), app("zed", "Zed")]
  assert.deepStrictEqual(L.visibleEntries(apps, set, false).map((e) => e.id), ["zed"])
  assert.deepStrictEqual(L.visibleEntries(apps, set, true).map((e) => e.id), ["chromium", "foot", "zed"])
})

test("calculator: arithmetic gets an answer, a plain number or a word doesn't", () => {
  const v = (q) => { const r = L.calculate(q); return r ? r.display : null }
  assert.strictEqual(v("6*7"), "42")
  assert.strictEqual(v("2 + 3 * 4"), "14", "precedence")
  assert.strictEqual(v("(2 + 3) * 4"), "20")
  assert.strictEqual(v("2^10"), "1024")
  assert.strictEqual(v("2**8"), "256")
  assert.strictEqual(v("-2^2"), "-4", "a power binds tighter than a minus")
  assert.strictEqual(v("10 / 4"), "2.5")
  assert.strictEqual(v("1/3"), "0.333333333333")
  assert.strictEqual(v("0.1+0.2"), "0.3")
  assert.strictEqual(v("200*15%"), "30")
  assert.strictEqual(v("3 × 4 ÷ 2"), "6")
  assert.strictEqual(v("sqrt 16"), "4")
  assert.strictEqual(v("√(9)+1"), "4")
  assert.strictEqual(v("log 1000"), "3")
  assert.strictEqual(v("2pi"), "6.28318530718")
  assert.strictEqual(v("=42"), "42", "= asks for the answer anyway")
  assert.strictEqual(v("=pi"), "3.14159265359")
  for (const q of ["42", "-5", "pi", "e", "chromium", "log", "1/0", "2 3", "(1+2", "1+", "", "rm -rf"])
    assert.strictEqual(v(q), null, JSON.stringify(q))
})

test("calculator: a phone number is a contact search", () => {
  assert.strictEqual(L.calculate("555-1234"), null)
  assert.strictEqual(L.calculate("+49 151 2345678"), null)
  assert.strictEqual(L.calculate("100-25").display, "75")
})

test("calculator: never eval", () => {
  assert.strictEqual(L.calculate("constructor"), null)
  assert.strictEqual(L.calculate("this.x"), null)
  assert.strictEqual(L.calculate("1;2"), null)
  assert.strictEqual(L.calculate("1".repeat(300) + "+1"), null, "too long")
})

const book = [
  { name: "Ada Lovelace", numbers: [{ label: "Mobile", number: "+44 20 7946 0001" }, { label: "Work", number: "+44 20 7946 0999" }] },
  { name: "Grace Hopper", numbers: [{ label: "", number: "+1 202 555 0143" }] },
  { name: "Élodie Martin", numbers: [{ label: "Home", number: "+33 1 23 45 67 89" }] },
  { name: "No Number", numbers: [] },
]

test("contacts: by a name's words, accents folded, or by digits", () => {
  assert.deepStrictEqual(L.matchContacts(book, "ada", 3).map((c) => c.name), ["Ada Lovelace"])
  assert.deepStrictEqual(L.matchContacts(book, "hop", 3).map((c) => c.name), ["Grace Hopper"], "a later word")
  assert.deepStrictEqual(L.matchContacts(book, "elodie", 3).map((c) => c.name), ["Élodie Martin"])
  const work = L.matchContacts(book, "0999", 3)
  assert.strictEqual(work[0].number, "+44 20 7946 0999", "the number that matched")
  assert.strictEqual(work[0].label, "Work")
  assert.deepStrictEqual(L.matchContacts(book, "a", 3), [], "one letter is too little")
  assert.deepStrictEqual(L.matchContacts(book, "no number", 3), [], "a contact without a number")
  assert.strictEqual(L.matchContacts(book, "e", 3).length, 0)
  assert.strictEqual(L.matchContacts(book, "a", 1).length, 0)
})

const settings = [
  { id: "omamobile.wifi", label: "Wi-Fi", path: "Quick settings", terms: ["wifi", "wireless"], argv: ["x"] },
  { id: "update.hardware.wifi", label: "Wi-Fi", path: "Update › Hardware", terms: [], argv: ["y"] },
  { id: "appearance.theme", label: "Theme", path: "Appearance", terms: ["colors"], argv: ["z"] },
  { id: "setup.default.browser", label: "Browser", path: "Setup › Defaults", terms: [], argv: ["w"] },
  { id: "broken", label: "Broken" },
]

test("settings: the label first, the shorter path first, terms count less", () => {
  assert.deepStrictEqual(L.matchSettings(settings, "wi-fi", 4).map((s) => s.id), ["omamobile.wifi", "update.hardware.wifi"])
  assert.deepStrictEqual(L.matchSettings(settings, "colors", 4).map((s) => s.id), ["appearance.theme"], "by a term")
  assert.deepStrictEqual(L.matchSettings(settings, "browser", 4).map((s) => s.id), ["setup.default.browser"])
  assert.deepStrictEqual(L.matchSettings(settings, "broken", 4), [], "a row with nothing to run")
  assert.deepStrictEqual(L.matchSettings(settings, "t", 4), [], "one letter is too little")
  assert.strictEqual(L.matchSettings(settings, "wi", 1).length, 1)
})

test("a hyphen or a space never stands between a word and its match", () => {
  assert.strictEqual(L.matchScore("Wi-Fi", "wifi"), 3)
  assert.strictEqual(L.matchScore("WiFi", "wi fi"), 3)
  assert.strictEqual(L.matchScore("Update › Wi-Fi", "wifi"), 1)
  assert.strictEqual(L.matchScore("Theme", "wifi"), 0)
})

test("the header in a search says what it found", () => {
  assert.strictEqual(L.resultsSummary(7, null, 0, 2), "7 apps · 2 settings")
  assert.strictEqual(L.resultsSummary(1, null, 1, 0), "1 app · 1 contact")
  assert.strictEqual(L.resultsSummary(0, { display: "4" }, 0, 0), "Calculator")
  assert.strictEqual(L.resultsSummary(0, null, 0, 0), "No results")
})

test("Enter: a prompt asks, else the answer, the first app, contact or setting", () => {
  assert.strictEqual(L.enterAction(true, null, [1], [], []), "agent")
  assert.strictEqual(L.enterAction(false, { display: "4" }, [1], [], []), "calc")
  assert.strictEqual(L.enterAction(false, null, [1], [1], [1]), "app")
  assert.strictEqual(L.enterAction(false, null, [], [1], [1]), "contact")
  assert.strictEqual(L.enterAction(false, null, [], [], [1]), "setting")
  assert.strictEqual(L.enterAction(false, null, [], [], []), "agent")
})

test("launch paths: a contact, a desktop action, all through omamobile-launch", () => {
  assert.deepStrictEqual(L.contactArgv("+1 (202) 555-0143", false), ["omamobile-launch", "cmd", "--", "omaphone", "tel:+12025550143"])
  assert.deepStrictEqual(L.contactArgv("+1 202 555 0143", true), ["omamobile-launch", "cmd", "--", "omamessages", "sms:+12025550143"])
  assert.deepStrictEqual(L.actionArgv(["chromium", "--incognito", "%U"]), ["omamobile-launch", "cmd", "--", "chromium", "--incognito"])
  assert.deepStrictEqual(L.actionArgv([]), [])
  assert.deepStrictEqual(L.actionArgv(null), [])
})

let failed = 0
for (const [name, fn] of tests) {
  try { fn(); console.log("ok - launcher model: " + name) } catch (e) { failed++; console.log("not ok - launcher model: " + name + "\n  " + (e.stack || e)) }
}
process.exit(failed ? 1 : 0)
