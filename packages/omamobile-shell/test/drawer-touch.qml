// SPDX-License-Identifier: MIT
// The app drawer under a finger (test/drawer-touch runs this): the drawer
// window's content and its position, open, close and gesture functions
// from Launcher.qml (launcher/DrawerHarness.qml, cut out by the script).
import QtQuick
import QtTest
import "launcher"

Item {
  id: view
  width: 412
  height: 892

  // The clock finger speeds are measured by: advanced by the tests with
  // each move, so a speed never depends on how busy the machine is.
  property real now: 1000
  DrawerHarness { id: harness; anchors.fill: parent; clock: function() { return view.now } }

  TestCase {
    id: test
    name: "DrawerTouch"
    when: windowShown

    property Item sheet: null
    property Item grid: null
    property Item handle: null
    property Item input: null
    property var baseApps: []

    function initTestCase() {
      var apps = []
      for (var i = 0; i < 40; i++) apps.push({ id: "app" + (i < 10 ? "0" : "") + i, name: "App " + i, icon: "" })
      harness.apps = apps
      baseApps = apps
      sheet = findChild(harness, "drawer")
      grid = findChild(harness, "drawerGrid")
      handle = findChild(harness, "drawerHandle")
      input = findChild(harness, "inputRow").children[0]
      verify(sheet && grid && handle && input)
    }

    function init() {
      harness.apps = baseApps
      harness.hiddenIds = ({})
      harness.appTab = "linux"
      harness.close()
      tryCompare(harness, "progress", 0, 3000)
      harness.calls = []
      harness.launched = []
      grid.contentY = 0
    }

    function openSettled() {
      harness.open("{}")
      tryCompare(harness, "progress", 1, 3000)
      harness.calls = []
      waitForRendering(sheet)
    }

    // A finger from p, moved by dy in `steps` moves `ms` apart, then held
    // `hold` ms and lifted (lift: false leaves it down).
    function drag(t, p, dy, steps, ms) {
      for (var i = 1; i <= steps; i++) {
        wait(ms)
        view.now += ms
        t.move(0, view, p.x, p.y + dy * i / steps).commit()
      }
    }

    function handleCentre() { return handle.mapToItem(view, handle.width / 2, handle.height / 2) }

    // A tap on the dock opens the drawer with the field waiting for a tap
    // (no keyboard); a field focused before the drawer had the keyboard
    // focus raised the keyboard at the first touch, as a pull down closed it.
    function test_open_settles_with_the_field_waiting_for_a_tap() {
      openSettled()
      verify(harness.opened)
      verify(!input.activeFocus, "the field waits for a tap")
      verify(sheet.activeFocus, "the sheet has the focus (typed keys still search)")
      compare(sheet.y, 0)
    }

    function test_an_open_that_asks_focuses_the_field() {
      harness.open(JSON.stringify({ focus: true }))
      tryCompare(harness, "progress", 1, 3000)
      verify(input.activeFocus)
    }

    function test_closing_never_holds_a_focused_field() {
      openSettled()
      input.forceActiveFocus()
      verify(input.activeFocus, "the user tapped the field")
      var c = handleCentre()
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      drag(t, c, 200, 10, 20)
      wait(150)
      view.now += 150
      t.release(0, view, c.x, c.y + 200).commit()
      compare(harness.calls, ["hide"])
      harness.close()
      verify(!input.activeFocus, "the field gave the focus back as the drawer closed")
      tryCompare(harness, "progress", 0, 3000)
      verify(!input.activeFocus, "and doesn't take it back")
    }

    function test_the_handle_is_a_centred_pill_with_a_full_target() {
      openSettled()
      verify(handle.height >= 44 && handle.width >= 44, "handle " + handle.width + "x" + handle.height)
      fuzzyCompare(handleCentre().x, view.width / 2, 1, "centred")
      verify(handleCentre().y < 50, "at the top")
      compare(findChild(harness, "collapse"), null, "no chevron any more")
    }

    function test_tap_on_the_handle_closes() {
      openSettled()
      var c = handleCentre()
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      t.release(0, view, c.x, c.y).commit()
      compare(harness.calls, ["hide"])
      verify(!harness.opened)
      tryCompare(harness, "progress", 0, 3000)
    }

    function test_handle_drag_follows_and_springs_back() {
      openSettled()
      var c = handleCentre()
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      drag(t, c, 200, 10, 20)
      tryVerify(function() { return harness.pulling }, 5000, "the handle pulls the drawer")
      tryVerify(function() { return harness.progress < 0.85 && harness.progress > 0.7 }, 5000, "it follows the finger: " + harness.progress)
      fuzzyCompare(sheet.y, (1 - harness.progress) * sheet.height, 1)
      // Back up, held still, lifted: it stays open.
      for (var i = 1; i <= 10; i++) { wait(20); view.now += 20; t.move(0, view, c.x, c.y + 200 - i * 19).commit() }
      tryVerify(function() { return harness.progress > 0.97 }, 5000, "and back up with it: " + harness.progress)
      wait(150)
      view.now += 150
      t.release(0, view, c.x, c.y + 10).commit()
      compare(harness.calls, [])
      tryCompare(harness, "progress", 1, 3000)
      verify(harness.opened)
    }

    function test_slow_pull_past_a_tenth_closes() {
      openSettled()
      var c = handleCentre()
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      drag(t, c, 200, 10, 20)
      wait(150)
      view.now += 150
      t.release(0, view, c.x, c.y + 200).commit()
      compare(harness.calls, ["hide"])
      tryCompare(harness, "progress", 0, 3000)
    }

    function test_short_slow_pull_springs_back() {
      openSettled()
      var c = Qt.point(300, 120)
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      drag(t, c, 50, 5, 30)
      tryVerify(function() { return harness.progress < 1 }, 5000, "the grid at its top pulls the drawer")
      wait(150)
      view.now += 150
      t.release(0, view, c.x, c.y + 50).commit()
      compare(harness.calls, [])
      tryCompare(harness, "progress", 1, 3000)
    }

    function test_flick_down_on_the_grid_closes() {
      openSettled()
      var c = Qt.point(300, 120)
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      drag(t, c, 60, 5, 16)
      t.release(0, view, c.x, c.y + 60).commit()
      compare(harness.calls, ["hide"], "a short flick down closes")
      tryCompare(harness, "progress", 0, 3000)
    }

    function test_a_scrolled_grid_scrolls_first() {
      openSettled()
      grid.contentY = 150
      var c = Qt.point(200, 300)
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      drag(t, c, 100, 5, 20)
      compare(harness.progress, 1, "the grid scrolls, the drawer stays")
      verify(grid.contentY < 150 && grid.contentY > 0, "grid at " + grid.contentY)
      for (var i = 1; i <= 15; i++) { wait(20); view.now += 20; t.move(0, view, c.x, c.y + 100 + i * 20).commit() }
      tryCompare(grid, "contentY", 0, 5000, "the grid reached its top")
      tryVerify(function() { return harness.progress < 0.95 }, 5000, "and the pull took over: " + harness.progress)
      wait(150)
      view.now += 150
      t.release(0, view, c.x, c.y + 400).commit()
      tryCompare(harness, "progress", 0, 3000)
    }

    function test_an_app_still_takes_its_tap() {
      openSettled()
      var t = touchEvent(view)
      t.press(0, view, 60, 110).commit()
      t.release(0, view, 60, 110).commit()
      tryCompare(harness, "launched", ["app00"])
    }

    // Apps under every letter from A to Z, three each, for the rail and the
    // headers.
    function lettered() {
      var apps = []
      for (var c = 0; c < 26; c++)
        for (var i = 0; i < 3; i++) {
          var name = String.fromCharCode(65 + c) + "pp " + i
          apps.push({ id: "l" + String.fromCharCode(97 + c) + i, name: name, icon: "" })
        }
      return apps
    }

    function centreOf(item) { return item.mapToItem(view, item.width / 2, item.height / 2) }

    function hold(item) {
      var c = centreOf(item)
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      wait(700)
      t.release(0, view, c.x, c.y).commit()
    }

    function tap(item) {
      // A page that just changed lays out on the next frame.
      waitForRendering(sheet)
      wait(50)
      var c = centreOf(item)
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      t.release(0, view, c.x, c.y).commit()
    }

    function test_browsing_shows_every_app_without_headers() {
      harness.apps = lettered()
      openSettled()
      compare(findChild(grid, "section-A"), null, "no letter headers")
      compare(grid.shownApps, 78, "every app")
      var a = findChild(grid, "app-la0"), b = findChild(grid, "app-la1")
      compare(a.mapToItem(sheet, 0, 0).y, b.mapToItem(sheet, 0, 0).y, "side by side in the first row")
    }

    function test_a_hold_opens_the_app_menu_and_hide_hides() {
      openSettled()
      var cell = findChild(grid, "app-app01")
      hold(cell)
      tryVerify(function() { return harness.menuEntry && harness.menuEntry.id === "app01" }, 3000, "the menu is the app's")
      compare(harness.launched, [], "a hold launches nothing")
      var card = findChild(harness, "appMenuCard")
      verify(card.visible && card.height >= 44 * 4, "the card shows its rows: " + card.height)
      verify(card.y >= cell.mapToItem(sheet, 0, cell.height).y - 1 || card.y + card.height <= cell.mapToItem(sheet, 0, 0).y + 1, "by the app, not over it")
      tap(findChild(harness, "menuHide"))
      verify(harness.hiddenIds["app01"], "hidden")
      compare(harness.menuEntry, null, "the menu closed")
      waitForRendering(sheet)
      compare(findChild(grid, "app-app01"), null, "gone from the drawer")
      harness.query = "App 1"
      waitForRendering(sheet)
      verify(findChild(grid, "app-app01"), "a search still finds it")
    }

    function test_a_tap_outside_or_back_closes_the_menu_not_the_drawer() {
      openSettled()
      hold(findChild(grid, "app-app02"))
      tryVerify(function() { return harness.menuEntry !== null }, 3000)
      var t = touchEvent(view)
      t.press(0, view, 20, view.height - 20).commit()
      t.release(0, view, 20, view.height - 20).commit()
      compare(harness.menuEntry, null, "a tap on the scrim closes it")
      verify(harness.opened, "the drawer stays")
      hold(findChild(grid, "app-app02"))
      tryVerify(function() { return harness.menuEntry !== null }, 3000)
      sheet.forceActiveFocus()
      keyClick(Qt.Key_Escape)
      compare(harness.menuEntry, null, "Back closes the menu")
      verify(harness.opened, "and only the menu")
      compare(harness.calls, [])
    }

    function test_a_pull_under_the_menu_moves_nothing() {
      openSettled()
      hold(findChild(grid, "app-app00"))
      tryVerify(function() { return harness.menuEntry !== null }, 3000)
      var c = Qt.point(300, 60)
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      drag(t, c, 200, 10, 20)
      t.release(0, view, c.x, c.y + 200).commit()
      compare(harness.progress, 1, "the drawer stayed")
      compare(harness.calls, [])
    }

    function test_uninstall_asks_first() {
      openSettled()
      hold(findChild(grid, "app-app03"))
      tryVerify(function() { return harness.menuEntry !== null }, 3000)
      tap(findChild(harness, "menuUninstall"))
      compare(harness.menuPage, "uninstall", "a question first")
      compare(harness.calls, [], "nothing removed yet")
      tap(findChild(harness, "uninstallCancel"))
      compare(harness.menuPage, "main", "Cancel goes back")
      tap(findChild(harness, "menuUninstall"))
      tap(findChild(harness, "uninstallConfirm"))
      compare(harness.calls, ["uninstall app03", "hide"])
    }

    function test_app_info_and_add_to_home() {
      openSettled()
      hold(findChild(grid, "app-app04"))
      tryVerify(function() { return harness.menuEntry !== null }, 3000)
      tap(findChild(harness, "menuInfo"))
      compare(harness.menuPage, "info")
      harness.menuPage = "main"
      tap(findChild(harness, "menuAddToHome"))
      compare(harness.calls, ["addToHome app04", "hide"])
    }

    // Where the rail's letter `letter` is, in the view.
    function railPoint(rail, letter) {
      var top = rail.mapToItem(view, rail.width / 2, 0)
      var i = rail.letters.map(function(l) { return l.letter }).indexOf(letter)
      return Qt.point(top.x, top.y + (rail.height - rail.step * rail.letters.length) / 2 + rail.step * (i + 0.5))
    }

    function test_the_rail_shows_only_a_letters_apps() {
      harness.apps = lettered()
      openSettled()
      var rail = findChild(harness, "drawerRail")
      verify(rail.visible, "a rail with 26 letters")
      compare(rail.letters.length, 26)
      verify(rail.width >= 24, "rail " + rail.width)
      // The rail covers no app: the grid ends where it starts.
      verify(grid.mapToItem(sheet, grid.width, 0).x <= rail.mapToItem(sheet, 0, 0).x + 1, "beside the grid")
      var m = railPoint(rail, "M")
      var t = touchEvent(view)
      t.press(0, view, m.x, m.y).commit()
      tryCompare(rail, "current", "M")
      compare(harness.letterFilter, "M", "only M's apps")
      verify(findChild(harness, "railBubble").visible, "the letter in a bubble")
      waitForRendering(sheet)
      compare(grid.shownApps, 3)
      verify(findChild(grid, "app-lm0") && !findChild(grid, "app-la0"), "M's apps, nothing else")
      var lm = findChild(grid, "app-lm0")
      fuzzyCompare(lm.mapToItem(grid, 0, lm.height).y, grid.height, 2, "at the bottom, by the thumb")
      compare(findChild(grid, "app-lm1").mapToItem(grid, 0, 0).y, lm.mapToItem(grid, 0, 0).y, "in one row")
      compare(rail.letters.length, 26, "the rail keeps every letter")
      // Down the rail: further letters.
      for (var i = 1; i <= 4; i++) { wait(20); t.move(0, view, m.x, m.y + rail.step * i).commit() }
      tryCompare(harness, "letterFilter", "Q")
      t.release(0, view, m.x, m.y + rail.step * 4).commit()
      compare(rail.current, "", "let go")
      compare(harness.letterFilter, "Q", "the letter stays chosen")
      verify(findChild(harness, "showAll").visible, "with a way back to every app")
      compare(harness.progress, 1, "a drag on the rail never pulls the drawer")
      compare(harness.launched, [])
      // The same letter again: every app.
      var q = railPoint(rail, "Q")
      t.press(0, view, q.x, q.y).commit()
      t.release(0, view, q.x, q.y).commit()
      compare(harness.letterFilter, "", "a tap on the chosen letter shows all")
      waitForRendering(sheet)
      compare(grid.shownApps, 78)
    }

    function test_show_all_back_and_a_search_clear_the_letter() {
      harness.apps = lettered()
      openSettled()
      var rail = findChild(harness, "drawerRail")
      var c = railPoint(rail, "C")
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      t.release(0, view, c.x, c.y).commit()
      compare(harness.letterFilter, "C")
      tap(findChild(harness, "showAll"))
      compare(harness.letterFilter, "", "Show all")
      t.press(0, view, c.x, c.y).commit()
      t.release(0, view, c.x, c.y).commit()
      sheet.forceActiveFocus()
      keyClick(Qt.Key_Escape)
      compare(harness.letterFilter, "", "Back clears the letter")
      verify(harness.opened, "and leaves the drawer open")
      t.press(0, view, c.x, c.y).commit()
      t.release(0, view, c.x, c.y).commit()
      compare(harness.letterFilter, "C")
      harness.close()
      compare(harness.letterFilter, "", "closing the drawer clears it")
    }

    // Linux apps and five Android ones (Waydroid's entries).
    function mixed() {
      var apps = baseApps.slice()
      for (var i = 0; i < 5; i++) apps.push({ id: "waydroid.org.example.a" + i, name: "Droid " + i, icon: "" })
      return apps
    }

    function test_no_tabs_without_android_apps() {
      openSettled()
      verify(!findChild(harness, "drawerTabs").visible, "only Linux apps: no tabs")
      compare(grid.shownApps, 40)
    }

    function test_tabs_split_linux_and_android_apps() {
      harness.apps = mixed()
      openSettled()
      var tabs = findChild(harness, "drawerTabs")
      verify(tabs.visible, "tabs with Android apps")
      verify(tabs.height >= 44, "a whole touch target")
      compare(grid.shownApps, 40, "Linux first")
      verify(findChild(grid, "app-app00") && !findChild(grid, "app-waydroid.org.example.a0"))
      tap(findChild(harness, "tab-android"))
      compare(harness.appTab, "android")
      waitForRendering(sheet)
      compare(grid.shownApps, 5)
      verify(findChild(grid, "app-waydroid.org.example.a0") && !findChild(grid, "app-app00"), "only Android apps")
      var rail = findChild(harness, "drawerRail")
      compare(rail.letters.length, 1, "the rail has the tab's letters: " + JSON.stringify(rail.letters))
      tap(findChild(harness, "tab-linux"))
      compare(harness.appTab, "linux")
      compare(harness.launched, [], "a tab tap launches nothing")
    }

    function test_a_sideways_swipe_changes_the_tab_and_launches_nothing() {
      harness.apps = mixed()
      openSettled()
      var cell = findChild(grid, "app-app05")
      var c = cell.mapToItem(view, cell.width / 2, cell.height / 2)
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      for (var i = 1; i <= 8; i++) { wait(16); view.now += 16; t.move(0, view, c.x - i * 15, c.y + i).commit() }
      t.release(0, view, c.x - 120, c.y + 8).commit()
      compare(harness.appTab, "android", "a swipe left: Android")
      compare(harness.launched, [], "the app under the finger didn't start")
      compare(harness.progress, 1, "nor did the drawer move")
      waitForRendering(sheet)
      cell = findChild(grid, "app-waydroid.org.example.a1")
      c = cell.mapToItem(view, cell.width / 2, cell.height / 2)
      t.press(0, view, c.x, c.y).commit()
      for (var j = 1; j <= 8; j++) { wait(16); view.now += 16; t.move(0, view, c.x + j * 15, c.y).commit() }
      t.release(0, view, c.x + 120, c.y).commit()
      compare(harness.appTab, "linux", "a swipe right: Linux")
    }

    function test_home_swipe_opens_from_under_the_finger() {
      verify(harness.gestureBegin(), "a closed drawer takes the swipe")
      harness.gestureMove(300)
      fuzzyCompare(harness.progress, 300 / sheet.height, 0.001)
      fuzzyCompare(sheet.y, sheet.height - 300, 1, "the sheet's top is where the finger has brought it")
      verify(harness.gestureEnd(-800), "a flick up opens it")
      compare(harness.calls, ["summon {\"gesture\":true}"], "through the host")
      verify(harness.opened)
      tryCompare(harness, "progress", 1, 3000)
      verify(!input.activeFocus, "no keyboard after a swipe")
      keyClick(Qt.Key_A)
      compare(harness.query, "a", "typing on a keyboard still searches")
      verify(input.activeFocus)
    }

    function test_home_swipe_falls_back() {
      harness.gestureBegin()
      harness.gestureMove(100)
      verify(!harness.gestureEnd(0), "a short slow swipe doesn't open it")
      compare(harness.calls, [])
      verify(!harness.opened)
      tryCompare(harness, "progress", 0, 3000)
    }

    // Where the grid, its first cell, the header and the search row sit on
    // the sheet, and the sheet's size: none of it may change as the drawer
    // moves (only the sheet's y does), or the first row jumps at the start
    // of a pull or the end of a slide.
    function layoutOf() {
      var cell = findChild(grid, "app-app00")
      var inputRow = findChild(harness, "inputRow")
      return JSON.stringify({
        sheet: [sheet.width, sheet.height],
        grid: [grid.x, grid.y, grid.width, grid.height],
        cell: cell ? [cell.mapToItem(sheet, 0, 0).x, cell.mapToItem(sheet, 0, 0).y] : null,
        header: findChild(harness, "drawerHeader").height,
        input: [inputRow.y, inputRow.height, inputRow.opacity, inputRow.visible]
      })
    }

    function test_nothing_moves_on_the_sheet_but_the_sheet() {
      var closed = layoutOf()
      harness.gestureBegin()
      harness.gestureMove(300)
      compare(layoutOf(), closed, "mid-swipe")
      harness.gestureEnd(-800)
      compare(layoutOf(), closed, "settling open")
      tryCompare(harness, "progress", 1, 3000)
      wait(200)
      compare(layoutOf(), closed, "open and settled")
      var c = handleCentre()
      var t = touchEvent(view)
      t.press(0, view, c.x, c.y).commit()
      compare(layoutOf(), closed, "a finger on the handle")
      drag(t, c, 120, 6, 20)
      tryVerify(function() { return harness.pulling }, 5000)
      compare(layoutOf(), closed, "mid-pull")
      view.now += 150
      t.release(0, view, c.x, c.y + 120).commit()
      tryCompare(harness, "progress", 0, 3000)
      compare(layoutOf(), closed, "closed again")
    }

    function test_no_home_swipe_while_open() {
      openSettled()
      verify(!harness.gestureBegin(), "an open drawer ignores the home screen's swipe")
    }
  }
}
