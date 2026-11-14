<!-- SPDX-License-Identifier: MIT -->
# Modem plan (hotdog / SM8150): the radio, SMS, data and calls

**Status (2026-11-14): calls and SMS work with the owner's SIM, from a RAM
boot of the voice kernel. SMS both ways; calls both ways with audio on the
speaker and the earpiece (R4, R5, R7, V1-V4); the radio ran 24 minutes
without a SIM before that without a crash (R2). Open: echo and a crackle on
the uplink (no echo canceller yet), the earpiece's level, five modem crashes
40 s apart after some boots; mobile data works from the quick settings
(R6, with `omamobile-shell` 0.2.129 and the patched ModemManager); Kernel branch
`omamobile-hotdog-voice` (worktree `~/omamobile-kernel/wt-hotdog-voice`,
output `~/omamobile-kernel/out-hotdog-voice`) @ `bcfa573612aa` on
`boot_a` since 2026-11-14 (V5), overlay
[`overlays/voice.dtso`](overlays/voice.dtso), services
`omamobile-hotdog-call-audio` and `omamobile-hotdog-sim-select` in
`omamobile-device-hotdog` 0.1.8. MMS is installed (mmsd-tng, patched
omatel-agent and omamessages; R8) and waits for the owner's send and
receive test; the earpiece is quieter and plays alone from kernel `gbcfa573612aa`
and `omamobile-device-hotdog` 0.1.9 (V4b); both echo cancellers left the
uplink silent (V3b), so calls run without one and the echo stays open.**

```
modem DSP (MPSS, remoteproc "modem", qcom/sm8150/oneplus/hotdog/modem.mbn)
  EFS:       rmtfs -r -P -s  <- modemst1, modemst2, fsg, fsc, oem_stanvbk, oem_dycnvbk  (read-only)
  files:     tqftpserv       <- /usr/lib/firmware/qcom/sm8150/oneplus/hotdog/modem_pr (MCFG)
  control:   QMI over QRTR (node 0)  -> ModemManager (qcom-soc plugin, port qrtr0)
  data:      IPA, rmnet_ipa0         -> ModemManager bearer -> NetworkManager (device qrtr0)
  SMS:       QMI WMS                 -> ModemManager Messaging -> omatel-agent -> Messages
  calls:     QMI voice               -> ModemManager Voice     -> omatel-agent -> Phone
  call audio: ADSP voice (MVM/CVS/CVP), VoiceMMode1 front end
               downlink -> QUAT_MI2S_RX -> TFA9874 top (earpiece) or bottom (speaker)
               uplink   <- SLIMBUS_0_TX <- WCD9340 AMIC4 (voice mic)
             opened by omamobile-hotdog-call-audio (callaudiod's D-Bus API) during a call
```

---

## 0. Facts, from our own captures

- **Firmware:** `MPSS.HE.1.0.c11.1-00007-SM8150_GEN_PACK-2.320290.2.328393.1`
  (from QMI DMS). Two physical SIM slots, both reported `absent` with no SIM
  in the tray. LTE bands 1-5, 7, 8, 12, 13, 17-20, 25, 26, 28, 29, 30, 32,
  34, 38-41, 46, 48; WCDMA; GSM.
- **QMI services** on node 0 (the modem) after boot: WDS 1, DMS 2, NAS 3,
  QOS 4, WMS 5, voice 9, UIM 11, LOC 16, WDA 26 and others; the ADSP is node
  5, the CDSP node 10.
- **The modem comes up in `shutting-down`** (QMI operating mode) when nothing
  has asked anything of it; `low-power` (radio off) and `online` were both
  accepted at once.
- **OnePlus's NV backups** `oem_stanvbk` and `oem_dycnvbk` (the modem asks for
  `/oem/nvbk/static` and `/oem/nvbk/dynamic`) are on `sda`, whose partitions
  udev can't name (the initramfs removes `/dev/sda`), so rmtfs found no
  `/dev/disk/by-partlabel` link for them at any boot before 0.1.7.
- **The 2026-11-01 crashes** (pmOS-based test kernels r14 and r16, before this
  port; dumps in `~/android/reference/hotdog/logs/crashdump-*`): with the
  radio on, the modem's watchdog fired on `RFLM@qsf_hl_seq.c:118 Assertion
  (rflm_qlnk_ls_retry_cnt < 2)` (it couldn't reach its RF transceiver) at
  126 s and at 1014 s, and after a modem stop and start UFS reported `link is
  broken` and the SoC went to its crash dump. Our kernel has since gained the
  OnePlus project-info driver (2026-11-03), which sets the RF test-cable
  state the modem reads from SMEM (`rf cable state 0 -> 1` in the log): with
  it, R2 below ran clean. A modem stop/start has not been tried on our kernel
  (the five crash recoveries at the first boot on 2026-11-04 left UFS alone).
- **Stock's call path** (`mixer_paths_tavil.xml`, the owner's OxygenOS
  10.0.14): `voicemmode1-call` = `QUAT_MI2S_RX_Voice Mixer VoiceMMode1` and
  `VoiceMMode1_Tx Mixer SLIM_0_TX_MMode1`; `handset-mic` = AMIC4; handset =
  the TFA "receive" profile on chip selector 3, speaker = the mono speaker.

## 1. NV safety

Linux never writes the modem's partitions: the initramfs and
`10-omamobile-storage.rules` keep `modemst1`, `modemst2`, `fsg`, `fsc`,
`oem_stanvbk`, `oem_dycnvbk`, `persist` and the `mdm*` copies read-only in the
kernel (from 0.1.7 also matched by the kernel's `PARTNAME`, so the rule covers
`sda` too), and rmtfs runs with `-r`: every partition is read into RAM when the
modem opens it, and the modem's EFS writes change only that copy. They are
lost at the modem's stop, as on the Pixels before the NV overlay.

Backups (off-repo, they hold the IMEI): `~/android/reference/hotdog/partitions`
(2026-10-31, before Luma) and `~/android/reference/hotdog/nv-2026-11-14`
(today, `modemst1`, `modemst2`, `fsg`, `fsc`, `oem_stanvbk`, `oem_dycnvbk`,
`persist`, each checked against a second read on the phone). `modemst1`,
`modemst2` and `persist` differ between the two: Luma's modem stack (11-02 to
11-04) wrote them; our boots since have kept them `ro`. Check against the
11-14 set before radio work:

```sh
for p in modemst1 modemst2 fsg fsc oem_stanvbk oem_dycnvbk persist; do
  tools/phone-ssh "d=\$(grep -l '^PARTNAME=$p\$' /sys/class/block/*/uevent | head -1 | xargs dirname | xargs basename); sha256sum /dev/\$d" |
    awk -v p=$p '{print $1"  "p".img"}'
done | diff - ~/android/reference/hotdog/nv-2026-11-14/SHA256SUMS && echo same
```

## 2. What was built

| Where | What |
| --- | --- |
| `omamobile-device-hotdog` 0.1.7 | `omamobile-hotdog-sim-select` (activates the USIM as the primary subscription at boot and after modem restarts); ModemManager unmasked, started at boot after rmtfs and tqftpserv (drop-in, `depends` on `modemmanager`); `oem_stanvbk`/`oem_dycnvbk` named in `/dev/disk/by-partlabel` from `PARTNAME` (only those two); the read-only rule also by `PARTNAME`; `omamobile-hotdog-call-audio` (user unit) |
| kernel `omamobile-hotdog-voice` | the q6voice series from the postmarketOS SDM845 kernel (`sdm845/7.1-dev`: shared sessions, MVM, CVP, CVS, voice DAI with SLIMbus and MI2S ports, CVD 2.3 init and topology controls, 18 commits by Stephan Gerhold, Vincent Knecht, Richard Acayan, Otto Pflüger and Joel Selvaraj, applied unchanged); the voice services and a `VoiceMMode1` link in our DT, disabled; `tfa9872`: an `Amp Switch` per amplifier (`Top Amp Switch`, `Bottom Amp Switch`) |
| `packages/modemmanager` 1.24.2-2.1 | Arch's ModemManager with upstream `9317cbc4` (the netlink use-after-free that crashed every data reconnect) |
| `omamobile-shell` 0.2.129 | `omamobile-mobile-network`'s ModemManager/NetworkManager path; the Mobile data tile uses it without `omamobile-sit` |
| `omamobile-device-hotdog` 0.1.8 | `depends` on `mmsd-tng` and starts it in the user's session (vendor wants link); `omamobile-hotdog-call-audio` reads `/etc/omamobile/call-audio.conf` (`tx_topology`, `mics` 1 or 2, `earpiece_gain`) and sets the kernel's optional `VoiceMMode1 TX Channels` and `Top Speaker Gain` when they exist |
| `packages/mmsd-tng` 2.6.4.r2 | the MMS daemon (`org.ofono.mms` on the session bus), with a user unit |
| `packages/omatel` 0.2.4-3, `packages/omamessages` 0.2.2-2 | the 0.2.4 and 0.2.2 releases plus our patches: the agent also follows ModemManager's `EmergencyOnly`; MMS and group messages through mmsd-tng (pictures and attachments both ways, `MmsReady`, the MMS settings page); omamessages builds against the patched omatel crates |
| kernel `omamobile-hotdog-voice` @ `bcfa573612aa` | `tfa9872`: `Speaker Gain` (TDMSPKG, `TDM_CFG8` bits 9:6; NXP's container profiles use 4 for the speaker and 13 for the receiver); q6voice (hack): `VoiceMMode1 TX Channels` (1-3, the CVP channel info and media format of the CVD 2.3 sequence) and `cvd_v2_3_override` (module parameter, -1 = the DT) |
| `device/hotdog/kernel-voice.config` | `CONFIG_SND_SOC_QDSP6_Q6VOICE=m`, appended for the test kernel only |
| `overlays/voice.dtso` | turns on MVM, CVS, CVP and the `VoiceMMode1` link |

Not done: VoLTE
(the modem's carrier configurations, MCFG, are served but none is selected:
`qmicli --pdc-list-configs` once a SIM is in), call audio over Bluetooth or
USB.

## 3. Rules for this plan

- The radio goes on only with the owner's yes (given for R2 on 2026-11-14).
- Never `rmtfs` read-write, never a write to any partition in §1, never a
  `qmicli --dms-set-...` that writes NV (`--dms-set-user-data`,
  `--dms-restore-factory-defaults`, `--nas-set-...` with persistence).
  Operating-mode changes are not persistent.
- A modem stop/start (restarting `omamobile-rmtfs` does one, through `-s`) is
  untested on this kernel and broke UFS on the 11-01 kernel: reboot instead.
- New kernels RAM-boot first (`fastboot boot`, no slot-A try spent); `boot_a`
  is written only by the owner, by fastboot, after a RAM boot passed.

## 4. Runbook and results

Each step: Expect / Pass, Stop, Rollback, Risk.

**R0. Read-only state.** `qmicli -d qrtr://0 -p --dms-get-operating-mode
--uim-get-card-status`, `--nas-get-serving-system`. Risk: none.
*2026-11-14, `7.3.0-rc6-omamobile-push1-g8da458f2d9a9`:* modem up, mode
`shutting-down`, both slots `absent` (no SIM in the tray, owner confirmed).

**R1. The modem's own NV backup.** Bring-up udev rule (the line 0.1.7 ships)
in `/etc/udev/rules.d`, `udevadm trigger --action=change` on `sda8`, `sda9`.
Pass: `/dev/disk/by-partlabel/oem_stanvbk`, `oem_dycnvbk`, both still `ro`.
Risk: low. *2026-11-14: pass.* rmtfs uses them from the next modem start.

**R2. Radio on, no SIM.** Kernel log streamed to `logs/` first;
`qmicli -d qrtr://0 -p --dms-set-operating-mode=online`. Expect: the modem
finds a cell (limited service). Stop: a `remoteproc` crash, `ufshcd` error,
or the phone going black (hold Power 30 s). Rollback:
`--dms-set-operating-mode=low-power`. Risk: medium (the 11-01 history).
*2026-11-14: pass.* Online at 13:27 for 2 minutes, then again from 13:31
until the owner rebooted the phone into fastboot on purpose at about 13:55
(24 minutes; the streamed kernel log covers the first 21): a GSM 900 cell of a local network, RSSI -96 to -100 dBm indoors,
`not-registered-searching` (no SIM), no remoteproc, UFS or watchdog message,
`modem`, `adsp`, `cdsp` running throughout. The 11-01 crashes came at 126 s
and 1014 s; a longer soak with a SIM is still worth one run.

**R3. ModemManager, NetworkManager, omatel.** Install 0.1.7
(`tools/phone-install-package packages/omamobile-device-hotdog`),
`systemctl start ModemManager`. Pass: `mmcli -L` lists `[QUALCOMM
INCORPORATED] 0` (plugin `qcom-soc`, ports `qrtr0 (qmi)`, `rmnet_ipa0 (net)`);
`nmcli device` shows `qrtr0` `gsm`; omatel-agent's `ModemState` reads
`no-sim`. Risk: low (without a SIM ModemManager stops at `failed:
sim-missing` and leaves the radio alone). *2026-11-14: pass.* Probing takes
about 30 s after ModemManager starts.

**R4. SIM (owner).** Power off is not needed for the tray, but insert the SIM
with the radio off (`--dms-set-operating-mode=low-power`). Expect: `mmcli -m
any` state `locked` (PIN) or `disabled`. A PIN is entered by the owner only,
in Phone or `mmcli -i any --pin=…` (three tries). Then `mmcli -m any -e`.
Pass: `registered`, the operator's name. Stop: a crash as in R2.
*2026-11-14, the owner's SIM, voice kernel `g963cd27012df` from RAM: pass.*
The card showed `present` in slot 1 (USIM, PIN disabled) but the modem had
no provisioning session (`Primary GW: session doesn't exist`, application
`detected`), and ModemManager stopped at `GW primary session index unknown`
(`failed: sim-missing`). `qmicli --uim-change-provisioning-session=
"slot=1,activate=yes,session-type=primary-gw-provisioning,aid=<the USIM
AID>"` made it `ready`; after a ModemManager restart, NetworkManager enabled
the modem and it registered: the owner's network, LTE, home, RSRP -111 dBm,
CS and PS attached (`csps-1`, so calls fall back to 2G/3G). From 0.1.7
`omamobile-hotdog-sim-select` does this at boot and after every modem
restart (checked by deactivating the session: re-registered in 12 s).
omatel-agent then kept `ModemState` at `emergency-only` (it reads
ModemManager's `EmergencyOnly` only on state changes, and that property
clears just after "registered"), which also holds Messages' `Ready` false;
restarting the agent clears it. `packages/omatel` 0.2.4-3 carries the fix
(the agent also watches `EmergencyOnly`); installed 2026-11-14, not yet
proposed upstream and not yet seen across a modem restart.

**R5. SMS.** Send from Messages to the owner's own number, then from another
phone. Pass: both arrive, in Messages and in `mmcli -m any --messaging-list-sms`.
*2026-11-14: pass, both directions (owner).*

**R6. Data.** `nmcli connection add type gsm ifname '*' con-name mobile apn
<APN>`; Wi-Fi off; `nmcli connection up mobile`. Pass: an address on
`rmnet_ipa0` (or its `qmapmux` child), `ping -I` through it. Rollback:
`nmcli connection down mobile`.
*2026-11-14: pass, after two fixes.* The quick settings' Mobile data tile and
the Mobile network page said "No modem": they knew only the Pixels' modem
stack (`omamobile-sit`). `omamobile-shell` 0.2.129 gives
`omamobile-mobile-network` a ModemManager/NetworkManager path for phones
without it (status from ModemManager; data, roaming and APN as a
NetworkManager `gsm` profile owned by the phone's user, which polkit lets
the user change without a password; "auto" APN = the network's, from the
initial EPS bearer), and the tile's scripts use it. Then ModemManager 1.24.2
crashed (SIGSEGV, a call through freed memory right after `net link
qmapmux0.0 created`) on the second data connection of each run: the first
connection after it started worked, every reconnect killed it. Upstream
`9317cbc4` (netlink use-after-free, after 1.24.2) is that bug;
`packages/modemmanager` 1.24.2-2.1 carries it, and five scripted off/on
cycles, then the owner's tile cycles and page loads with Wi-Fi off, ran
with no ModemManager restart. Data: IPv4 and IPv6 on `qmapmux0.0`, Wi-Fi
keeps the default route while it is up (metric 600 against 700). An empty
APN (`gsm.apn ""`) also connected, but the crash was first seen on that
reconnect, so "auto" never means an empty APN.

**R8. MMS.** Install `mmsd-tng`, `omatel-agent` 0.2.4-3, `omamessages`
0.2.2-2 and `omamobile-device-hotdog` 0.1.8 (`libphonenumber` from the
distribution); mmsd-tng fills `~/.mms/modemmanager/mms` from
mobile-broadband-provider-info at its first start, and the carrier's MMSC,
proxy and APN are checked there by hand (the owner's values stay on the
phone). mmsd-tng uses the data connection's bearer, so MMS must run on the
internet APN. Pass: `MmsReady` true on `org.omamobile.Messages1`; a picture
from another phone arrives in Messages, and one sent from Messages arrives.
Stop: a send that fails with an HTTP error: try the provider database's
MMSC and proxy (kept as `mms.mbpi` beside the file).
*2026-11-14: installed, `MmsReady` true, mmsd-tng sees the modem
(`/org/ofono/mms/modemmanager`), LTE home. The database's entry for the
owner's carrier had a different MMSC and proxy than the network operator's
documented ones; the operator's are set. Send and receive: owner's test
open.*

**R7. Calls, signalling only.** Call the owner's other phone from Phone, and
back. Pass: it rings on both sides and hangs up from either. On the current
kernel there is no audio: the agent reports that call audio can't be routed.
LTE without VoLTE falls back to GSM/UMTS for calls (CSFB).
*2026-11-14: pass, outgoing and incoming (owner).*

**V0. Build (laptop, done 2026-11-14).**

```sh
cat device/hotdog/kernel-camera.config device/hotdog/kernel-voice.config >> device/hotdog/kernel.config
DEVICE=hotdog KERNEL_DIR=~/omamobile-kernel/wt-hotdog-voice \
  KERNEL_OUT=~/omamobile-kernel/out-hotdog-voice bin/omamobile kernel
git checkout device/hotdog/kernel.config
DEVICE=hotdog KERNEL_OUT=~/omamobile-kernel/out-hotdog-voice bin/omamobile modules
DEVICE=hotdog KERNEL_OUT=~/omamobile-kernel/out-hotdog-voice bin/omamobile initramfs
# DTB_OVERLAYS="mic torch camera popup camera-main camera-af voice" in device/hotdog/device.conf for this build only
DEVICE=hotdog KERNEL_OUT=~/omamobile-kernel/out-hotdog-voice bin/omamobile images
```

**V1. RAM boot (owner: fastboot by the buttons).** Modules first
(`modules-push` of the voice release), then `fastboot -s <serial> boot
~/omamobile-kernel/out-hotdog-voice/images/boot.img`. Pass: speakers, mics,
cameras, fingerprint as on `boot_a`; `dmesg | grep -i -e q6voice -e q6mvm -e
q6cvp`: probed, no errors; `/proc/asound/card0/pcm*p/info` lists
`VoiceMMode1`; `amixer -c 0 controls | grep -e 'Amp Switch' -e 'Voice Mixer'`.
Rollback: a reboot (boot_a is unchanged). Risk: low (a RAM boot spends no
try; bad RAM boots are the known intermittent UFS/DPU ones: retry).
*2026-11-14, `7.3.0-rc6-omamobile-push1-g963cd27012df` (boot.img sha256
`e9ab7fe1…`): pass on the third RAM boot.* The first stopped in the
initramfs on UFS (`ufshcd_err_handler: reset and restore failed`, HBA state
error) with DPU frame-done timeouts, the second stayed black without SSH;
the known-good `boot_a` image then RAM-booted in 12 s (its DTB differs from
this one only by the voice nodes), the voice modules went on with
`modules-push`, and the third try reached Arch in 12 s. `q6mvm`, `q6cvs`,
`q6cvp`, `q6voice`, `q6voice_dai` loaded; PCM 4 is `VoiceMMode1` (playback
and capture); the voice mixers and `Top Amp Switch` / `Bottom Amp Switch`
are there; `systemctl --failed` empty. The modem crashed five times, 40 s
apart (48 to 210 s, `fatal error without message`), then ran on, as at H3
on 11-04; none in the three boots before it. UFS stayed clean through all
five restarts. Open: what the modem waits for in those 40 s.

**V2. The voice session without a call.** `systemctl --user status
omamobile-hotdog-call-audio` (as the owner): `VoiceMMode1 at hw:0,N`. Then
`busctl --user call org.mobian_project.CallAudio /org/mobian_project/CallAudio
org.mobian_project.CallAudio SelectMode u 1`, read the journal, and
`SelectMode u 0`. Expect: `true` and "call audio on", or a q6mvm/q6cvp error
that shows which CVD sequence this ADSP wants: if the session fails, add
`qcom,cvd-v2.3;` to the voice `dais` node (overlay) and repeat. Stop: an ADSP
crash (`remoteproc remoteproc2: crash detected in adsp`): reboot. Risk: low.
*2026-11-14: pass, with the default (pre-2.3) CVD sequence.* `SelectMode 1`
answers `true`: the voice mixers on, earpiece (`Top` on, `Bottom` off),
capture `RUNNING`, playback `PREPARED` (the front end has no buffer: a write
is EINVAL, a start EPIPE; the ADSP's ports run from prepare). `EnableSpeaker
true` swaps the amplifiers, `MuteMic true` sets `AMIC MUX0` to ZERO and
`MicState` 0; `SelectMode 0` closes both PCMs and puts every control back.
No q6 error, ADSP, CDSP and modem running throughout. Whether audio flows
needs a call (V3).

**V3. A call on the speaker (SIM).** Phone: call the owner's other phone,
switch to speaker before it is answered, hold the phone away from the ear.
Pass: both directions audible. If one is silent: `amixer -c 0 cget` on the
two Voice Mixer controls and the Amp Switches during the call; for the
uplink, the AMIC4 path as in MIC-PLAN.
*2026-11-14: the downlink works on the speaker and the earpiece from the
first call; the uplink was silent.* During a voice session every codec
widget on the voice mic's path is on (AMIC4, MIC BIAS1, ADC4, AMIC MUX0, ADC
MUX0, CDC_IF TX0 MUX, AIF1_CAP Mixer, AIF1 CAP, the SLIMBUS_0_TX back end,
the VoiceMMode1 capture mixer), so the sound reached the ADSP. The driver's
default uplink topology is the single-mic echo canceller
(`VoiceMMode1 TX Topology` 69489, 0x10F71); with 69488 (0x10F70, none) the
far end heard the owner. They also heard themselves (no echo canceller) and
a crackle that eased during the call: the downlink plays at the amplifier's
speaker gain and the mic (ADC4 12, DEC0 0 dB, stock's own handset gains)
takes it back. `omamobile-hotdog-call-audio` sets 69488 at each call.
Next: stock runs the mic port as one channel (`SLIM_0_TX Channels One`),
our machine driver forces two on every back end; a mono `SLIMBUS_0_TX` is
the first suspect for the echo canceller's silence. Then a downlink gain
for the earpiece (V4).

**V4. Earpiece.** Only after V3, at the lowest call volume, the phone a hand's
width from the ear first: the downlink plays through the top amplifier at
its speaker gain (stock lowers it with a TFA profile we don't have). If it is
too loud, the next step is a downlink gain: CVS/CVP volume commands, or the
TFA9874's own gain bitfield.
*2026-11-14: works (owner), loud as expected; the echo above is worse on the
speaker.*

**V3b. Echo canceller (owner, RAM boot of `gbcfa573612aa`).** Modules are
on the phone. One short call per step, on the earpiece, then on the speaker;
`/etc/omamobile/call-audio.conf` changes take effect at the next call.
(a) `options q6voice cvd_v2_3_override=1` (reload the q6voice modules or set
`/sys/module/q6voice/parameters/cvd_v2_3_override`), `tx_topology=0x10F71`,
`mics=1`; (b) the same with `tx_topology=0x10F72`, `mics=2` (stock's dual-mic
handset topology, AMIC4 + AMIC3); (c) fallback `tx_topology=0x10F70`. Pass:
the far end hears the owner, without their own echo. Stop: an ADSP crash, or
silence in both directions: next step. The winner becomes the package's
default (and a modprobe.d option if it needs 2.3).
*2026-11-14, `gbcfa573612aa` from RAM (first try, 10 s), owner's calls:
(a) and (b) failed, the far end heard nothing; no q6 error in the log, only
the codec's TX port underflow/overflow at the call's end (as in every call).
(c) works, as before. The default stays 0x10F70, one mic, CVD as the DT says
(`cvd_v2_3_override` -1). Next for the echo: compare our CVP/CVS sequence
with stock's in an ADSP trace, or the topology's calibration (stock's ACDB
data, which we don't send).*

**V4b. Earpiece gain.** `Top Speaker Gain` at 4 and at 13 (the receiver
profile's value), a 1 kHz tone through the earpiece measured by the phone's
mic; announced first, the phone on the table. Pass: 13 measurably quieter,
no distortion. Then a call at 13 (the package default).
*2026-11-14: pass, with two findings.* The voice mic sits next to the bottom
speaker and hardly hears the earpiece, so the first runs measured the bottom
speaker and showed no change; with the tone on the left channel only (the
earpiece) at -20 dBFS: gain 4 -70.4 and -67.0 dBFS, 13 -77.2 dBFS, 13 with
INPLEV (reg 0x02 bit 4, which NXP's receiver profile also sets, with the
boost converter off) -81.1 dBFS against a -83 dBFS floor. A change during the
stream applies within 0.5 s. Second: the owner's first call at 13 played on
both speakers. An amplifier switched off before the stream starts comes up
running (`SYS_CTRL0` 0x0018 with `Bottom Amp Switch` off); one switched during
the stream stops. Likely there from the start, hidden by the loud earpiece.
`omamobile-device-hotdog` 0.1.9 switches the silent amplifier on and off once
more after opening the voice PCMs; then only the top one runs, the speaker
toggle swaps them, and the owner's call 3 was earpiece-only, quieter, with
the mic working. Open: the driver's cause (no regmap trace events in this
kernel), and an INPLEV control for stock's full receiver level.

**V5. To `boot_a` (owner).** After V1-V4, the owner flashes the voice image
to `boot_a` (tries reset to 7, `slot-successful:a` stays as it is).
*2026-11-14: done, `gbcfa573612aa` (boot.img sha256 `a7143fd7…`, kept as
`~/omamobile-kernel/boot-voice-gbcfa573612aa-2026-11-14.img`; rollback
`boot-int-g8da458f2d9a9-merge-2026-11-14.img`). First boot from `boot_a` up
in 10 s: no failed units, no modem crash or UFS error handler, LTE home,
data connected; the agent came up `ready` (not `emergency-only`) with
`MmsReady` true.*
