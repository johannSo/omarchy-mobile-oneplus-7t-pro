<!-- SPDX-License-Identifier: MIT -->
# mmsd-tng (Omarchy Mobile build)

[mmsd-tng](https://gitlab.com/kop316/mmsd) (GPL-2.0), the MMS daemon for
ModemManager, built from upstream's git (2.6.4 plus two later commits,
pinned). Arch Linux ARM doesn't carry it.

- It runs per user (`mmsd-tng.service`, a user unit) and serves
  `org.ofono.mms` on the session bus; omatel-agent stores what it receives
  and sends MMS through it.
- It handles the WAP push SMS that announces an MMS itself
  (`AutoProcessSMSWAP`), fetches over the connected mobile data bearer
  only, and supports one bearer: the carrier must carry MMS on the internet
  APN. Carriers with a separate MMS APN don't work yet.
- Carrier settings live in `~/.mms/modemmanager/mms` (`CarrierMMSC`,
  `CarrierMMSProxy`, `MMS_APN`); mmsd-tng fills them from
  mobile-broadband-provider-info on its first start, and Messages' settings
  page edits them. Change the file only while mmsd-tng is stopped.
- Device packages whose modem is ModemManager's (the OnePlus 7T Pro's
  `omamobile-device-hotdog`) turn the unit on with a user wants link.
