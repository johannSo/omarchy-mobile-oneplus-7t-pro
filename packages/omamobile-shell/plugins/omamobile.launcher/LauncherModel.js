// SPDX-License-Identifier: MIT
// Pure helpers for the phone launcher: settings merging and the rule that
// decides whether the bottom bar's text is an app search or a prompt for the
// coding agent.

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// Manifest defaults, overlaid with the plugin's entry in shell.json
// (`plugins: [{ "id": "omamobile.launcher", "columns": 5, ... }]`).
// The drawer's columns (TOUCH-PLAN 2.4): the configured count across the
// screen's shorter side, and on a grid wider than that (the phone on its
// side) as many columns of the same width as fit, so the icons keep their
// size: 4 upright on the Pixel 7 Pro, 8 on its side. `margin` is the grid's
// inset from each screen edge.
function drawerColumns(columns, gridWidth, shortSide, margin) {
  var base = Math.max(3, Math.min(6, Math.round(Number(columns) || 4)))
  var portraitGrid = (Number(shortSide) || 0) - 2 * (Number(margin) || 0)
  if (!(gridWidth > portraitGrid) || portraitGrid <= 0) return base
  return Math.max(base, Math.floor(base * gridWidth / portraitGrid))
}

function mergedSettings(defaults, config, pluginId) {
  var out = {}
  var base = isPlainObject(defaults) ? defaults : {}
  for (var key in base) out[key] = base[key]
  var plugins = isPlainObject(config) && Array.isArray(config.plugins) ? config.plugins : []
  for (var i = 0; i < plugins.length; i++) {
    var entry = plugins[i]
    if (!isPlainObject(entry) || entry.id !== pluginId) continue
    for (var k in entry) if (k !== "id") out[k] = entry[k]
  }
  return out
}

function argv(value, fallback) {
  if (Array.isArray(value)) return value.map(function(part) { return String(part) })
  if (typeof value === "string" && value.trim()) return value.trim().split(/\s+/)
  return fallback.slice()
}

function wordCount(query) {
  var text = String(query || "").trim()
  return text ? text.split(/\s+/).length : 0
}

// A short query that names an app is a search. Text reads as a prompt once it
// has enough words to be a sentence, ends like one, or matches no app at all.
function looksLikePrompt(query, appMatches, sentenceWords) {
  var text = String(query || "").trim()
  if (!text) return false
  if (wordCount(text) >= Math.max(2, sentenceWords || 3)) return true
  if (/[?.!]$/.test(text)) return true
  return appMatches === 0
}

// Display names for the agents omarchy-default-agent knows, as Omarchy
// names them. Anything else shows its id.
var AGENT_NAMES = {
  pi: "Pi", omp: "Oh My Pi", opencode: "OpenCode", claude: "Claude Code",
  codex: "Codex", crush: "Crush", grok: "Grok", gemini: "Gemini",
  openclaw: "OpenClaw", hermes: "Hermes", copilot: "GitHub Copilot",
  muse: "Muse Code", "cursor-agent": "Cursor CLI"
}

// The agent id from ~/.config/omarchy/defaults/agent (first line), or "".
function agentId(fileText) {
  return String(fileText || "").split("\n")[0].trim()
}

function agentName(id) {
  return id ? (AGENT_NAMES[id] || id) : ""
}

// Every launch goes through omamobile-launch (bin/), which gives what it
// starts a new empty workspace of its own, or focuses an app that is already
// open there: one app per screen, as on Android.
var LAUNCH = "omamobile-launch"

// A desktop entry that runs omarchy-shell opens a shell surface (the
// Updates entry summons the update sheet), never a window, so Omarchy's
// launch toast would wait for a toplevel that doesn't come and sit over the
// sheet until it times out: no toast for it.
function opensShellSurface(entry) {
  var command = entry && entry.command ? entry.command : []
  return command.length > 0 && String(command[0]).replace(/^.*\//, "") === "omarchy-shell"
}

function appArgv(desktopId) {
  return [LAUNCH, "app", String(desktopId || "")]
}

// Omarchy launches the user's chosen agent, in its own terminal, with the
// prompt as one argument. Without a chosen agent, open Omarchy's picker.
function promptArgv(prompt) {
  return [LAUNCH, "cmd", "--", "omarchy-agent-prompt", String(prompt || "").trim()]
}

var PICK_AGENT_ARGV = ["omarchy", "menu", "summon", "setup.default.agent"]

// ---------------------------------------------------------------- drawer gestures
//
// The drawer follows a finger both ways: up from anywhere on the home
// screen (omamobile.home drives it through DrawerLink.js) and down from the
// drawer itself or its handle. Its position is `progress`, 0 closed to 1
// open, a share of its own height, so the sheet's top stays under the
// finger whatever the window's size.

// A release this fast (logical px/s) decides by its direction alone.
var DRAWER_FLING = 350
// A slower release opens the drawer past a quarter of the way up, and
// closes an open one pulled down a tenth of the way (about 90-100 px on the
// phone, near the 80 px pull that closed it before).
var DRAWER_OPEN_AT = 0.25
var DRAWER_CLOSE_AT = 0.1

// Whether the drawer ends open: velocity in px/s along the screen's y axis
// (negative is up, toward open); fromOpen says which way the finger started.
function drawerEndsOpen(progress, velocity, fromOpen) {
  var v = Number(velocity) || 0
  if (v <= -DRAWER_FLING) return true
  if (v >= DRAWER_FLING) return false
  var p = Number(progress) || 0
  return fromOpen ? p > 1 - DRAWER_CLOSE_AT : p >= DRAWER_OPEN_AT
}

// How long a settle takes (ms) for `distance` px of a `span` px travel:
// 120 ms plus up to 140 ms with the distance (half the way, about 190 ms),
// and no slower than the finger was moving, so a fling carries on at its
// own speed (Easing.OutCubic starts at three times its average speed).
function settleMs(distance, span, speed) {
  var d = Math.abs(Number(distance) || 0)
  if (d < 0.5) return 0
  var byDistance = 120 + 140 * Math.min(1, d / Math.max(1, Number(span) || 1))
  var v = Math.abs(Number(speed) || 0)
  var bySpeed = v > 0 ? 3 * d / v * 1000 : Infinity
  return Math.round(Math.max(120, Math.min(byDistance, bySpeed)))
}

// A finger's speed from its recent positions: samples are { t (ms), pos
// (px) }, newest last. Only the last 100 ms count, so a finger that stopped
// before it let go has no speed (no fling), and one sample is no speed.
var SAMPLE_WINDOW_MS = 100
function addSample(samples, t, pos) {
  var out = []
  for (var i = 0; i < (samples || []).length; i++)
    if (t - samples[i].t <= SAMPLE_WINDOW_MS * 2) out.push(samples[i])
  out.push({ t: t, pos: pos })
  return out
}
function speedOf(samples, now) {
  var recent = []
  for (var i = 0; i < (samples || []).length; i++)
    if (now - samples[i].t <= SAMPLE_WINDOW_MS) recent.push(samples[i])
  if (recent.length < 2) return 0
  var a = recent[0], b = recent[recent.length - 1]
  var dt = b.t - a.t
  return dt >= 8 ? (b.pos - a.pos) / dt * 1000 : 0
}

// ---------------------------------------------------------------- the list
//
// The drawer is a list of rows: app rows (one cell per column), letter
// headers while browsing, and in a search the calculator, contacts and
// settings that match. Each row is { kind, ... }:
//   { kind: "header", label, letter }
//   { kind: "apps", entries: [entry...], start: index of entries[0], letter }
//   { kind: "calc", expression, value, display }
//   { kind: "contact", name, number, label }
//   { kind: "setting", id, label, path, icon, iconFont, argv }

// The letter an app files under: its name's first letter, accents dropped
// (É under E), anything that isn't A-Z under "#".
function letterOf(name) {
  var s = String(name || "").trim()
  if (!s) return "#"
  var c = s.charAt(0)
  try { c = c.normalize("NFD").charAt(0) } catch (e) { }
  c = c.toUpperCase()
  return c >= "A" && c <= "Z" ? c : "#"
}

// Rows of `columns` apps, in the order given; with headers, each letter
// starts with its header and a new row.
function drawerRows(entries, nameOf, columns, headers) {
  var cols = Math.max(1, Math.floor(Number(columns) || 1))
  var list = entries || []
  var rows = []
  var run = null
  var letter = null
  for (var i = 0; i < list.length; i++) {
    if (headers) {
      var l = letterOf(nameOf ? nameOf(list[i]) : list[i] && list[i].name)
      if (l !== letter) {
        letter = l
        rows.push({ kind: "header", label: l, letter: l })
        run = null
      }
    }
    if (!run || run.entries.length >= cols) {
      run = { kind: "apps", entries: [], start: i, letter: letter }
      rows.push(run)
    }
    run.entries.push(list[i])
  }
  return rows
}

// The rail's letters: each header's letter once, with the row it is on.
function railLetters(rows) {
  var out = []
  var seen = {}
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i]
    if (!r || r.kind !== "header" || seen[r.letter]) continue
    seen[r.letter] = true
    out.push({ letter: r.letter, row: i })
  }
  return out
}

// The letters the apps start with, each once, in the apps' order: the rail.
function appLetters(entries, nameOf) {
  var out = []
  var seen = {}
  for (var i = 0; i < (entries || []).length; i++) {
    var l = letterOf(nameOf ? nameOf(entries[i]) : entries[i] && entries[i].name)
    if (seen[l]) continue
    seen[l] = true
    out.push({ letter: l })
  }
  return out
}

// Only the apps under one letter ("" keeps them all): the rail's filter.
function byLetter(entries, nameOf, letter) {
  if (!letter) return (entries || []).slice()
  var out = []
  for (var i = 0; i < (entries || []).length; i++)
    if (letterOf(nameOf ? nameOf(entries[i]) : entries[i] && entries[i].name) === letter) out.push(entries[i])
  return out
}

// The drawer's tabs: Linux apps and Android apps. An Android app is one
// Waydroid made a desktop entry for (waydroid.<package>).
function isAndroidApp(entry) {
  return String((entry && entry.id) || "").indexOf("waydroid.") === 0
}

function byTab(entries, tab) {
  var android = tab === "android"
  var out = []
  for (var i = 0; i < (entries || []).length; i++)
    if (isAndroidApp(entries[i]) === android) out.push(entries[i])
  return out
}

function countAndroid(entries) {
  var n = 0
  for (var i = 0; i < (entries || []).length; i++) if (isAndroidApp(entries[i])) n++
  return n
}

// Which of `count` letters a finger at `y` on a rail of `height` points at.
function railPick(y, height, count) {
  if (!(count > 0) || !(height > 0)) return -1
  return Math.max(0, Math.min(count - 1, Math.floor(Number(y) / height * count)))
}

// A search's rows, first row first (the drawer stacks them upward from the
// input, so the first sits by the thumb): the calculator's answer, the apps,
// then contacts and settings, each under its header.
function searchRows(apps, columns, calc, contacts, settings) {
  var rows = []
  if (calc) rows.push({ kind: "calc", expression: calc.expression, value: calc.value, display: calc.display })
  var appRows = drawerRows(apps, null, columns, false)
  for (var i = 0; i < appRows.length; i++) rows.push(appRows[i])
  var groups = [["Contacts", contacts, "contact"], ["Settings", settings, "setting"]]
  for (var g = 0; g < groups.length; g++) {
    var items = groups[g][1] || []
    if (items.length === 0) continue
    for (var j = 0; j < items.length; j++) {
      var row = { kind: groups[g][2] }
      for (var k in items[j]) row[k] = items[j][k]
      row.kind = groups[g][2]
      rows.push(row)
    }
    // After its rows: stacked upward, a header shows above them.
    rows.push({ kind: "header", label: groups[g][0], letter: "" })
  }
  return rows
}

// ---------------------------------------------------------------- hidden apps
//
// Apps hidden from the drawer: desktop ids, one per line, in
// ~/.local/state/omamobile/launcher-hidden. A search still finds them, so
// their menu can show them again.

function parseIdList(text) {
  var out = {}
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var id = lines[i].trim()
    if (id.slice(-8) === ".desktop") id = id.slice(0, -8)
    if (id) out[id] = true
  }
  return out
}

function idListText(set) {
  var ids = []
  for (var id in (set || {})) if (set[id]) ids.push(id)
  ids.sort()
  return ids.length ? ids.join("\n") + "\n" : ""
}

function withId(set, id, on) {
  var out = {}
  for (var k in (set || {})) if (set[k]) out[k] = true
  if (on) out[String(id)] = true
  else delete out[String(id)]
  return out
}

// The drawer's apps: hidden ones only in a search.
function visibleEntries(entries, hidden, searching) {
  if (searching) return (entries || []).slice()
  var out = []
  for (var i = 0; i < (entries || []).length; i++)
    if (!(hidden && entries[i] && hidden[entries[i].id])) out.push(entries[i])
  return out
}

// ---------------------------------------------------------------- calculator
//
// Arithmetic typed into the search: numbers, + - * / ^, parentheses, a
// trailing % (a hundredth), sqrt/√, abs, ln, log (base 10), pi/π and e.
// Only text with an operation in it counts ("42" is a search, "6*7" a sum);
// a leading "=" asks for the answer anyway. Never eval: a parser of its own.
var CALC_FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log,
  log: function(x) { return Math.log10 ? Math.log10(x) : Math.log(x) / Math.LN10 }
}
var CALC_CONSTANTS = { pi: Math.PI, "π": Math.PI, e: Math.E }

function calcTokens(text) {
  var src = String(text).replace(/[×✕]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/\*\*/g, "^")
  var tokens = []
  var i = 0
  while (i < src.length) {
    var c = src.charAt(i)
    if (/\s/.test(c)) { i++; continue }
    var num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
    if (num) { tokens.push({ t: "num", v: parseFloat(num[0]) }); i += num[0].length; continue }
    var word = /^([a-zA-Z]+|π|√)/.exec(src.slice(i))
    if (word) {
      var w = word[0].toLowerCase()
      if (w === "√") tokens.push({ t: "fn", v: "sqrt" })
      else if (CALC_FUNCTIONS[w]) tokens.push({ t: "fn", v: w })
      else if (CALC_CONSTANTS[w] !== undefined) tokens.push({ t: "num", v: CALC_CONSTANTS[w], c: true })
      else return null
      i += word[0].length
      continue
    }
    if ("+-*/^%()".indexOf(c) >= 0) { tokens.push({ t: c }); i++; continue }
    return null
  }
  return tokens
}

// Recursive descent: sum := term (± term)*, term := unary (*|/ unary)*,
// unary := ± unary | power, power := postfix (^ unary)?, postfix := atom %*,
// atom := number | ( sum ) | fn atom.
function calculate(text) {
  var raw = String(text || "").trim()
  var forced = raw.charAt(0) === "="
  if (forced) raw = raw.slice(1).trim()
  if (!raw || raw.length > 200) return null
  // A phone number (555-1234, +49 151 2345678) is a contact search.
  if (!forced && /^\+?[0-9][0-9 ()-]*$/.test(raw) && raw.replace(/[^0-9]/g, "").length >= 7) return null
  var tokens = calcTokens(raw)
  if (!tokens || tokens.length === 0) return null
  var pos = 0
  var ops = 0
  function peek() { return tokens[pos] }
  function take(t) { if (tokens[pos] && tokens[pos].t === t) { pos++; return true } return false }
  function atom() {
    var tok = tokens[pos]
    if (!tok) throw "end"
    if (tok.t === "num") { pos++; return tok.v }
    if (tok.t === "fn") { pos++; ops++; return CALC_FUNCTIONS[tok.v](postfix()) }
    if (take("(")) { var v = sum(); if (!take(")")) throw "paren"; return v }
    throw "atom"
  }
  function postfix() {
    var v = atom()
    while (take("%")) { v = v / 100; ops++ }
    return v
  }
  function power() {
    var base = postfix()
    if (take("^")) { ops++; return Math.pow(base, unary()) }
    return base
  }
  function unary() {
    if (take("-")) return -unary()
    if (take("+")) return unary()
    return power()
  }
  function term() {
    var v = unary()
    for (;;) {
      if (take("*")) { ops++; v *= unary() }
      else if (take("/")) { ops++; v /= unary() }
      else if (peek() && (peek().t === "(" || peek().t === "fn" || (peek().t === "num" && peek().c))) { ops++; v *= unary() }
      else return v
    }
  }
  function sum() {
    var v = term()
    for (;;) {
      if (take("+")) { ops++; v += term() }
      else if (take("-")) { ops++; v -= term() }
      else return v
    }
  }
  var value
  try { value = sum() } catch (e) { return null }
  if (pos !== tokens.length || (!forced && ops === 0) || typeof value !== "number" || !isFinite(value)) return null
  return { expression: raw, value: value, display: formatNumber(value) }
}

// 12 significant digits, no trailing zeros, no "-0".
function formatNumber(value) {
  if (value === 0) return "0"
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value)
  var s = Number(value.toPrecision(12)).toString()
  return s === "-0" ? "0" : s
}

// ---------------------------------------------------------------- search
//
// Contacts and settings in a search, besides apps. Folded for matching:
// lower case, accents dropped, punctuation as spaces.
function fold(text) {
  var s = String(text || "")
  try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, "") } catch (e) { }
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// How well text matches the query, 0 for not at all: the whole text starts
// with it (3), a word does (2), it is inside (1).
function matchScore(text, query) {
  var t = fold(text)
  var q = fold(query)
  if (!q || !t) return 0
  if (t.indexOf(q) === 0) return 3
  if ((" " + t).indexOf(" " + q) >= 0) return 2
  if (t.indexOf(q) >= 0) return 1
  // Without the spaces: "wifi" is "Wi-Fi", "wi fi" is "WiFi".
  var tc = t.replace(/ /g, "")
  var qc = q.replace(/ /g, "")
  if (tc.indexOf(qc) === 0) return 3
  return tc.indexOf(qc) >= 0 ? 1 : 0
}

// The drawer's header in a search: what it found ("7 apps · 2 settings").
function resultsSummary(apps, calc, contacts, settings) {
  var parts = []
  var count = function(n, one, many) { if (n > 0) parts.push(n + " " + (n === 1 ? one : many)) }
  count(apps, "app", "apps")
  count(contacts, "contact", "contacts")
  count(settings, "setting", "settings")
  if (parts.length === 0) return calc ? "Calculator" : "No results"
  return parts.join(" · ")
}

// contacts: [{ name, numbers: [{ label, number }] }]. A name matches by its
// words; a query of three or more digits matches inside a number. One row
// per contact: the number that matched, else the first.
function matchContacts(contacts, query, limit) {
  var q = String(query || "").trim()
  if (q.length < 2) return []
  var digits = q.replace(/[^0-9]/g, "")
  var byDigits = digits.length >= 3 && /^[0-9+()\s.-]+$/.test(q)
  var hits = []
  for (var i = 0; i < (contacts || []).length; i++) {
    var c = contacts[i]
    if (!c || !c.numbers || c.numbers.length === 0) continue
    var score = matchScore(c.name, q)
    var pick = c.numbers[0]
    if (byDigits) {
      for (var j = 0; j < c.numbers.length; j++) {
        if (String(c.numbers[j].number || "").replace(/[^0-9]/g, "").indexOf(digits) >= 0) { score = Math.max(score, 2); pick = c.numbers[j]; break }
      }
    }
    if (score > 0) hits.push({ score: score, name: String(c.name || pick.number), number: String(pick.number), label: String(pick.label || "") })
  }
  hits.sort(function(a, b) { return b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) })
  return hits.slice(0, Math.max(0, limit || 3)).map(function(h) { return { name: h.name, number: h.number, label: h.label } })
}

// settings: [{ id, label, path, icon, iconFont, terms: [...], argv }]. The
// label counts most; the menu path, aliases and description less.
function matchSettings(settings, query, limit) {
  var q = String(query || "").trim()
  if (fold(q).length < 2) return []
  var hits = []
  for (var i = 0; i < (settings || []).length; i++) {
    var s = settings[i]
    if (!s || !s.label || !s.argv) continue
    var score = matchScore(s.label, q) * 2
    var terms = s.terms || []
    for (var j = 0; score < 2 && j < terms.length; j++) score = Math.max(score, matchScore(terms[j], q) > 1 ? 1 : 0)
    if (score > 0) hits.push({ score: score, depth: String(s.path || "").length, s: s })
  }
  hits.sort(function(a, b) { return b.score - a.score || a.depth - b.depth })
  return hits.slice(0, Math.max(0, limit || 4)).map(function(h) {
    return { id: h.s.id, label: h.s.label, path: h.s.path || "", icon: h.s.icon || "", iconFont: h.s.iconFont || "", argv: h.s.argv }
  })
}

// What Enter does with the text typed: "agent" (a prompt), "calc" (copy the
// answer), "app" (the first app), "contact", "setting", or "" for nothing.
function enterAction(promptMode, calc, apps, contacts, settings) {
  if (promptMode) return "agent"
  if (calc) return "calc"
  if (apps && apps.length) return "app"
  if (contacts && contacts.length) return "contact"
  if (settings && settings.length) return "setting"
  return "agent"
}

// A contact's number opens Phone's dialpad filled in (it never dials by
// itself) or a Messages thread.
function contactArgv(number, messages) {
  var n = String(number || "").replace(/[^0-9+*#]/g, "")
  return [LAUNCH, "cmd", "--"].concat(messages ? ["omamessages", "sms:" + n] : ["omaphone", "tel:" + n])
}

// A desktop action (Chromium's New Incognito Window), through
// omamobile-launch, without the field codes (%u, %F) left for a launcher.
function actionArgv(command) {
  var words = (command || []).filter(function(w) { return !/^%[a-zA-Z]$/.test(String(w)) })
  return words.length ? [LAUNCH, "cmd", "--"].concat(words.map(String)) : []
}

if (typeof module !== "undefined") {
  module.exports = {
    letterOf: letterOf,
    drawerRows: drawerRows,
    railLetters: railLetters,
    appLetters: appLetters,
    isAndroidApp: isAndroidApp,
    byTab: byTab,
    countAndroid: countAndroid,
    byLetter: byLetter,
    railPick: railPick,
    searchRows: searchRows,
    parseIdList: parseIdList,
    idListText: idListText,
    withId: withId,
    visibleEntries: visibleEntries,
    calculate: calculate,
    formatNumber: formatNumber,
    fold: fold,
    matchScore: matchScore,
    resultsSummary: resultsSummary,
    matchContacts: matchContacts,
    matchSettings: matchSettings,
    enterAction: enterAction,
    contactArgv: contactArgv,
    actionArgv: actionArgv,
    drawerColumns: drawerColumns,
    mergedSettings: mergedSettings,
    argv: argv,
    wordCount: wordCount,
    looksLikePrompt: looksLikePrompt,
    agentId: agentId,
    agentName: agentName,
    LAUNCH: LAUNCH,
    appArgv: appArgv,
    opensShellSurface: opensShellSurface,
    promptArgv: promptArgv,
    PICK_AGENT_ARGV: PICK_AGENT_ARGV,
    DRAWER_FLING: DRAWER_FLING,
    DRAWER_OPEN_AT: DRAWER_OPEN_AT,
    DRAWER_CLOSE_AT: DRAWER_CLOSE_AT,
    drawerEndsOpen: drawerEndsOpen,
    settleMs: settleMs,
    addSample: addSample,
    speedOf: speedOf
  }
}
