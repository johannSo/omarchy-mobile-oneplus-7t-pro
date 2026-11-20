// SPDX-License-Identifier: MIT
import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import "Readable.js" as Readable

// A folder on the home screen: its first four apps, small, in a square the
// size of an app's icon, with the folder's name under it. A tap opens it
// (the folder sheet: its apps, its name); in edit mode the cell's own touch
// does that and the drag. Made by dropping an app onto another in edit mode
// (HomeModel.dropOnto).
Item {
  id: tile

  property var home: null
  property var entry: null
  property bool editing: false

  readonly property var library: home ? home.appLibrary : null
  readonly property var apps: entry && entry.apps ? entry.apps : []

  // The icon's size, as AppTile works it out, so a folder lines up with the
  // apps beside it.
  readonly property real iconSize: tile.width > 128
    ? Math.max(Math.min(64, Math.max(40, Math.min(tile.width, tile.height) * 0.62)),
               Math.min(tile.width * 0.62, tile.height * 0.6))
    : Math.min(64, Math.max(40, Math.min(tile.width, tile.height) * 0.62))

  Rectangle {
    id: box
    objectName: "folderBox"
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.verticalCenter
    anchors.bottomMargin: -Math.round(width * 0.18)
    width: tile.iconSize + 8
    height: width
    radius: Math.min(Style.cornerRadius, width / 2)
    color: touch.pressed ? Util.alpha(Commons.Color.menu.background, 0.85) : Util.alpha(Commons.Color.menu.background, 0.62)
    border.width: 1
    border.color: Util.alpha(tile.home ? tile.home.foreground : "white", 0.18)

    Grid {
      anchors.centerIn: parent
      columns: 2
      spacing: Math.round(box.width * 0.06)

      Repeater {
        model: tile.apps.slice(0, 4)
        delegate: Image {
          required property var modelData
          readonly property var desktopEntry: tile.home ? tile.home.entryFor(modelData) : null
          width: Math.round(box.width * 0.36)
          height: width
          fillMode: Image.PreserveAspectFit
          asynchronous: true
          opacity: desktopEntry ? 1 : 0.45
          sourceSize.width: width * Screen.devicePixelRatio
          sourceSize.height: height * Screen.devicePixelRatio
          source: tile.library ? tile.library.iconSource(desktopEntry ? desktopEntry.icon : "") : ""
        }
      }
    }
  }

  Text {
    anchors.top: box.bottom
    anchors.topMargin: Style.spacing.md - 4
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.leftMargin: Style.spacing.xs
    anchors.rightMargin: Style.spacing.xs
    horizontalAlignment: Text.AlignHCenter
    textFormat: Text.PlainText
    text: tile.entry && tile.entry.name ? tile.entry.name : "Folder"
    color: tile.home ? tile.home.foreground : "white"
    style: Text.Outline
    styleColor: Util.alpha(Commons.Color.menu.background, 0.85)
    font.family: Style.font.family
    font.pixelSize: Readable.px(Style.font.caption + 3)
    font.weight: Font.DemiBold
    elide: Text.ElideRight
    maximumLineCount: 1
  }

  MouseArea {
    id: touch
    anchors.fill: parent
    enabled: !tile.editing
    // A hold is the long press for edit mode, as on an app (AppTile).
    pressAndHoldInterval: 500
    onPressAndHold: function(mouse) { mouse.accepted = true }
    onClicked: if (tile.home && tile.entry) tile.home.openFolder(tile.entry.id)
  }
}
