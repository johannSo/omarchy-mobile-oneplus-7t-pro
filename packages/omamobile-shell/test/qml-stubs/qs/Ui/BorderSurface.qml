// SPDX-License-Identifier: MIT
import QtQuick

// Omarchy's BorderSurface is a Rectangle with border specs; no input.
Rectangle {
  property var borderSpec: ({})
  property real borderLeft: 0
  property real borderRight: 0
  property real padding: 0
  readonly property real contentTopInset: padding
  readonly property real contentRightInset: padding
  readonly property real contentBottomInset: padding
  readonly property real contentLeftInset: padding
}
