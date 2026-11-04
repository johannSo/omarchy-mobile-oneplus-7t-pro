<!-- SPDX-License-Identifier: MIT -->
# Fingerprint plan (hotdog / SM8150): fingerprint unlock on the lock screen

**Status (2026-11-04): theoretical. Written and compile-checked on the
laptop; nothing has run on the phone, and nothing may until the owner
approves each step below.** Kernel branch `omamobile-hotdog-fingerprint`
(worktree `~/omamobile-kernel/wt-hotdog-fingerprint`, output
`~/omamobile-kernel/out-hotdog-fingerprint`), on top of `omamobile-hotdog`
@ `970d093a4`. Userspace staging in [`fingerprint/`](fingerprint/), not
packaged. Overlays in [`overlays/`](overlays/).

The phone itself is not ready for this yet: [BRINGUP-M1](BRINGUP-M1.md) H2-H4
(the Arch root on userdata, booted from `boot_a`) come first. Every step
below assumes a phone that boots Omarchy Mobile with USB SSH.

**Goal.** Omarchy's lock screen accepts a finger on the under-display sensor
as an alternative to the PIN, exactly as on the Pixel 7 Pro
([cheetah FINGERPRINT-PLAN](../cheetah/FINGERPRINT-PLAN.md)). The top of the
chain is the same: Omarchy's lock runs `pam_fprintd` when
`fprintd-list $USER` shows a finger, fprintd uses libfprint's
`omamobile_udfps` driver, and that driver speaks a line protocol to a bridge.
Everything below the bridge is new for this phone:

```
Omarchy lock (PAM "omarchy-lock-fingerprint") / sudo / polkit
  -> fprintd -> libfprint omamobile_udfps            packages/libfprint (unchanged)
       | /run/omamobile-fp/sock/bridge.sock (root only, the cheetah line protocol)
  -> omamobile-fp-hotdog-bridge (bionic, in the chroot)  fingerprint/omamobile-fp-hotdog-bridge.cpp
       | HIDL android.hardware.biometrics.fingerprint@2.1 over hwbinder
  -> OnePlus's Goodix HAL, qseecomd (from the owner's own OxygenOS vendor image)
       | libQSEEComAPI: /dev/qseecom + /dev/ion        | /dev/goodix_fp, netlink 25
       |   ion -> omamobile-fp-ion-shim (LD_PRELOAD)   |
  -> qcom_qseecom_compat (kernel, NEW)               goodix-fp (kernel, existing + hotdog compatible)
       | SCM calls (QSEE app manager, listeners)       | gpio101 supply, gpio131 reset, gpio118 IRQ
  -> QSEE: the Goodix trusted app (capture, matching, templates) -> secure SPI -> sensor
       + the panel lit at full brightness above the sensor (panel driver "hbm")
```

---

## 0. Facts, from our own captures

All from the stock DT in `~/android/reference/hotdog` (`dtbo_b.img.gz`
entry 0, `dtb/lineage17-base-0.dtb`), decoded on the laptop. Nothing below
came from the phone at runtime.

| What | Stock | Used here |
| --- | --- | --- |
| Sensor node | `goodix_fp`, `compatible = "goodix,fingerprint"`, no SPI parent | `fingerprint` node, `oneplus,hotdog-udfps`, goodix-fp driver |
| IRQ | `fp-gpio-irq` tlmm 118; `fp_irq_init`: gpio, 2 mA, no bias, input | `interrupts-extended = <&tlmm 118 IRQ_TYPE_EDGE_RISING>` |
| Reset | `fp-gpio-reset` tlmm 131; `fp_reset_init`: 8 mA, pull-up | `reset-gpios = <&tlmm 131 GPIO_ACTIVE_LOW>` |
| Supply | `fp-gpio-enable` tlmm 101; `fp_vdd_init` output-high pull-up, `fp_vdd_dis_init` output-low pull-down | `regulator-fixed` `fp_vdd` on gpio101 |
| Sensor ID | `fingerprint_detect` (`oneplus,fpdetect`): tlmm 90 and PM8150 GPIO 3 | not used (one sensor type assumed; F2 reads them) |
| SPI | not in Linux's DT: owned by QSEE | nothing; **which QUP serial engine it is, is unknown** (§2) |
| QSEECOM | `qseecom@87900000`: `qcom,commonlib64-loaded-by-uefi`, `qcom,appsbl-qseecom-support`, `qcom,qsee-reentrancy-support = <2>`, `qcom,no-clock-support` | cmnlib is never loaded and no app-region notification is sent; re-entrancy phase 2 handling |
| Shared buffers | `qseecom_region` 0x9e400000, 0x1400000, no-map | mainline's `qseecom_mem` (same address), the compat driver's pool |
| smcinvoke | `smcinvoke@87900000` exists | mainline's `qcomtee` probes smcinvoke itself; not used by this design (§2) |
| Panel HBM | `hbm-on-command-5` (ends `51 0f ff`), `hbm-off-command` | replayed byte for byte by the panel driver's `hbm` attribute |

The command line already has `clk_ignore_unused pd_ignore_unused`
([device.conf](device.conf)), so the QUP clock that QSEE's SPI uses is not
turned off as unused. A Linux node that claims that QUP would still take it
(§2, U2).

## 1. What is reused, what is new

| Piece | State | Where |
| --- | --- | --- |
| fprintd, PAM, Omarchy lock | reused | stock packages, `packages/omamobile-fingerprint/vendor/pam.d` |
| libfprint `omamobile_udfps` | reused unchanged | `packages/libfprint` |
| Shell target (`omamobile.fingerprint`) | reused; reads the bridge's `state.json` | `packages/omamobile-shell` |
| goodix-fp kernel driver | **changed**: `oneplus,hotdog-udfps` compatible, root-only `notify` attribute for the HAL's display/touch events (event numbers are module parameters, unconfirmed) | `drivers/misc/goodix-fp.c` |
| Panel HBM | **new**: `hbm` attribute on the DSI device (`/sys/bus/mipi-dsi/devices/*/hbm`), stock sequences, off by itself after `hbm_timeout_ms` (3 s), refused while the panel is off, backlight restored after | `drivers/gpu/drm/panel/panel-samsung-oneplus-dsc.c` |
| `/dev/qseecom` | **new**: `qcom_qseecom_compat`, a subset of downstream's ioctl ABI on mainline SCM calls, buffers from `qseecom_mem` as dma-bufs; allow-lists for TAs and listeners, empty by default; RPMB listener refused unless `allow_rpmb` | `drivers/firmware/qcom/qcom_qseecom_compat.c`, `qcom_scm.c` (raw call export) |
| DT | **new**, all `disabled` | `sm8150-oneplus-hotdog.dts`; enabled by [`overlays/fp-sensor.dtso`](overlays/fp-sensor.dtso) and [`overlays/qseecom-compat.dtso`](overlays/qseecom-compat.dtso) |
| ion | **new**: LD_PRELOAD shim, `/dev/ion` allocations become compat dma-bufs | `fingerprint/omamobile-fp-ion-shim.c` |
| Bridge | **new**: HIDL 2.1 client, same line protocol and `state.json` as cheetah's | `fingerprint/omamobile-fp-hotdog-bridge.cpp` |
| Runner, unit | **new**, staged, enabled nowhere | `fingerprint/omamobile-fp-hotdog-chroot`, `fingerprint/omamobile-fp-hotdog.service` |
| Vendor files | **missing**: the HAL, qseecomd, libQSEEComAPI, the Goodix TA, from the owner's own OxygenOS image | F1 |

## 2. Unknowns (each one can sink the design; resolved read-only first)

- **U1. The vendor files and their names.** The HAL binary, its libraries,
  the TA's name and files (`.mdt` + `.bNN`), qseecomd and its listener set.
  The `.ops` in `~/android/reference/hotdog/msm/` is encrypted; the
  vendor image is on the phone's `super` partition (read-only copy) or in an
  OTA zip of the same build. F1.
- **U2. Which QUP serial engine QSEE's SPI uses,** and that no mainline
  node claims it. If Linux owns it, the TA's SPI transfers fail or collide.
  From the TA's strings or QSEE's log (`qcom_tzlog`), F1/F5.
- **U3. The downstream qseecom ABI as the owner's libQSEEComAPI uses it:**
  ioctl numbers, struct layouts (pointer sizes on arm64), which ioctls the
  HAL and qseecomd call. Every one is marked `VERIFY` in
  `qcom_qseecom_compat.c`. Disassembly of the owner's `libQSEEComAPI.so`,
  offline (F1).
- **U4. The SCM command IDs** for app start/shutdown and the listener
  calls (`VERIFY` in the driver), and how re-entrancy phase 2 answers.
  Only the phone can answer that, and a wrong call can wedge QSEE: F5 is
  one call per boot.
- **U5. Which listeners the TA needs.** The Goodix TA probably keeps its
  templates in QSEE's secure file system, through the file-system listener
  (files on userdata) and the RPMB listener (anti-rollback counters).
  F6 runs with every listener refused and records what the TA asks for.
- **U6. The HAL's netlink events** for touch down, touch up and "UI ready"
  (the panel lit). Defaults 4, 5, 6 in goodix-fp are guesses; the HAL's
  disassembly gives the real numbers (F1).
- **U7. The auth token.** Enrollment on Android carries a hardware auth
  token from Gatekeeper, signed by a key the HAL shares with KeyMaster in
  QSEE. Whether this HAL accepts a token with a zero HMAC is unknown; if
  not, the bridge needs the QSEE Gatekeeper and KeyMaster TAs as well (the
  same allow-list, more listeners). F8.
- **U8. The sensor position** on the panel. The bridge's 720/2700/110 is a
  placeholder; F9 measures it on the screen.
- **U9. smcinvoke.** SM8150's QSEE has smcinvoke, and mainline's
  `qcomtee` may bind it. The Goodix HAL uses the legacy qseecom path, so
  this design leaves smcinvoke alone; if `qcomtee` and the compat driver
  both talk to QSEE, their calls are not serialized against each other.
  Keep `qcomtee` unloaded during these steps (F4).

## 3. Rules for this subsystem

These are AGENTS.md section 1 applied to this stack.

- **Nothing in the chroot sees a real Android partition.** No bind mount of
  `/persist`, `/mnt/vendor/persist`, `/dev/block/*` or `/dev/sd*`. The TA's
  file-system listener gets a private state directory on userdata
  (`/var/lib/omamobile-fp-hotdog/{persist,data}`). If the TA needs
  calibration data from `persist`, it is copied **read-only, on the laptop,
  from the existing backup image** (`partitions/persist.img.gz`) and never
  written back.
- **RPMB is a one-way door.** A write through the RPMB listener changes
  counters that can't be rolled back, and stock Android on this phone
  depends on them. `allow_rpmb` defaults to N, the runner also refuses
  without `/etc/omamobile/fp-hotdog-allow-rpmb`, and turning either on is the
  owner's decision, recorded in §7 first (F7).
- **No TA loads and no listener registers by default.** `app_allowlist` and
  `listener_allowlist` are empty, and the module parameters are read-only
  after load, so only a human's `modprobe` line sets them.
- **One QSEE change per boot.** The first app start, the first listener
  registration and the first send each get their own boot, with a log
  stream to the laptop and `--watchdog` armed. QSEE errors often show up as
  a hang or a reset into the bootloader's crash dump mode. On this phone
  that means the Volume and Power keys, and **no stock slot to fall back
  to** ([BRINGUP-M1](BRINGUP-M1.md) §1).
- **Never unload `qcom_qseecom_compat` with a TA loaded or a listener
  registered.** Reboot instead. As on cheetah with storageproxyd: QSEE keeps
  its state until a reset.
- **HBM is announced before it is used.** It lights the whole panel at full
  brightness. It turns off by itself after 3 s, but tell the owner first.
- **No vendor file is committed,** and no identifier: no partition dumps,
  no TA, no HAL, no `getprop`.

## 4. Decisions for the owner

1. **Where the vendor files come from** (F1): a read-only copy of `super`
   from the phone, or an OTA of the same build.
2. **RPMB** (F7): whether the TA may write it at all. Without it,
   fingerprint unlock may simply be impossible on this phone under Linux.
3. **Persist calibration** (F6): whether the TA may read a copy of
   `persist`'s fingerprint files, taken from the backup image.

## 5. Kernel build

From the omarchy-mobile checkout:

```sh
KERNEL_DIR=~/omamobile-kernel/wt-hotdog-fingerprint \
KERNEL_OUT=~/omamobile-kernel/out-hotdog-fingerprint \
  DEVICE=hotdog bin/omamobile kernel
```

The two modules aren't in `device/hotdog/kernel.config`. Until the plan
passes they come from [`kernel-fingerprint.config`](kernel-fingerprint.config),
merged into `$KERNEL_OUT/.config` by hand before that build's `olddefconfig`
(the file says how).

The DT nodes are `disabled`, so this kernel without the overlays boots
like `omamobile-hotdog`. The compat module binds nothing without
`qseecom-compat.dtso`, and goodix-fp binds nothing without `fp-sensor.dtso`.

## 6. Runbook

Each step is the owner's to run or approve. Read-only first. Each has
Expect/Pass, a **Stop** condition, a Rollback and a risk level. Results go in
§7 with the date and `uname -r`.

### F0: preconditions (read-only; risk none)

- BRINGUP-M1 H4 done: Omarchy Mobile boots from `boot_a`, USB SSH works.
- The partition backups in `~/android/reference/hotdog/partitions/` check
  against `SHA256SUMS` (`sha256sum -c`), `persist` among them.
- **Stop** if either fails.

### F1: vendor files, offline (laptop; risk none for the phone)

1. Get the OxygenOS vendor image of the build the phone's firmware came from
   (owner's decision 1). Unpack it on the laptop under
   `~/android/reference/hotdog/vendor-fp/` (never in the repo).
2. Find: the fingerprint HAL service and its libraries, `qseecomd`,
   `libQSEEComAPI.so`, the Goodix TA (`*.mdt` + `*.b*`), its name as the
   HAL loads it, and any files the HAL reads from `/persist` or
   `/mnt/vendor/persist`.
3. Disassemble `libQSEEComAPI.so` and the HAL (REA, offline) for: the
   qseecom ioctls they issue (U3), the ion heap mask (shim), the netlink
   event numbers (U6), the TA name, the auth-token check (U7).
4. Fix every `VERIFY` the disassembly answers, in the driver, the shim and
   the bridge, and record what it said in §7.
- **Pass:** every name in `fingerprint/README.md`'s list is confirmed or
  corrected. **Stop** if the HAL needs an interface this design lacks
  (for example smcinvoke instead of qseecom: then the compat driver is the
  wrong tool, U9).

### F2: the sensor pins, read-only (risk low)

```sh
tools/phone-ssh 'cat /sys/kernel/debug/gpio | grep -E "gpio(90|101|118|131)\b"'
tools/phone-ssh 'grep -E "^ *(90|101|118|131):" /sys/kernel/debug/pinctrl/*tlmm*/pinmux-pins'
```

- **Expect:** none of the four is claimed. gpio101 is low (sensor
  unpowered).
- **Stop** if another driver owns one of them.

### F3: sensor power and goodix-fp (one boot; risk low)

Kernel of §5, `DTB_OVERLAYS=fp-sensor`, with `blacklist goodix_fp` in
`/etc/modprobe.d/omamobile-fp-hotdog-bringup.conf` before the boot. After
the boot, with a log stream to the laptop:

```sh
tools/phone-ssh 'modprobe goodix-fp && dmesg | tail -5 && ls -l /dev/goodix_fp'
tools/phone-ssh 'exec 3</dev/goodix_fp; sleep 2; cat /sys/kernel/debug/gpio | grep -E "gpio(101|131)\b"; exec 3<&-'
```

- **Expect:** `irq N, supply switched, netlink 25`; while the file is open,
  gpio101 high and gpio131 released; low and held after the close.
- **Stop** on any error, or if the IRQ storms (`/proc/interrupts`).
- **Rollback:** `rmmod goodix-fp` (nothing in the secure world is involved),
  then a boot without the overlay.

### F4: `/dev/qseecom` with nothing allowed (one boot; risk low)

`DTB_OVERLAYS="fp-sensor qseecom-compat"`, `blacklist qcom_qseecom_compat`
and `blacklist qcomtee` before the boot. Then:

```sh
tools/phone-ssh 'modprobe qcom_qseecom_compat && dmesg | tail -5 && ls -l /dev/qseecom'
tools/phone-ssh 'grep . /sys/module/qcom_qseecom_compat/parameters/*'
```

- **Expect:** the device exists, the version query worked (the dmesg line
  prints QSEE's version), every allow-list empty, `allow_rpmb` N.
- **Stop** on any SCM error, or if the version query hangs.
- **Rollback:** reboot (don't unload).

### F5: the first app lookup and start (IRREVERSIBLE only in that it starts QSEE code; one boot; risk medium)

Arm `--watchdog` and the log stream. A small test program (written in F1 from
what the disassembly showed) runs `APP_LOADED_QUERY` for the TA name, then
`LOAD_APP` with the TA's files, with
`modprobe qcom_qseecom_compat app_allowlist=<TA name>`. No listener is
allowed, no command is sent.

- **Expect:** an app id, and `qcom_tzlog` (if readable) shows the app
  loaded.
- **Stop** on a hang, a reset, `INCOMPLETE` at load (the TA wants a
  listener at start: record which), or any QSEE error code.
- **Rollback:** reboot. The TA is gone after the reset.

### F6: first commands, listeners still refused (one boot; risk medium)

The HAL in the chroot (runner `omamobile-fp-hotdog-chroot start hal`: qseecomd
and the HAL, no bridge), with the TA allowed and every listener refused, so
qseecomd's registrations fail by design. The HAL's init commands run.

- **Expect:** either the HAL's init completes (unlikely), or the driver logs
  which listener ids the TA asks for (`INCOMPLETE ... listener 0x...`) and
  answers each with a failure.
- **Record** the listener ids and what the HAL logged. **Stop** here and
  decide (owner) with that list: the file-system listener alone is low
  risk (files under `/var/lib/omamobile-fp-hotdog`); RPMB is F7.

### F7: RPMB (IRREVERSIBLE: needs the owner's written decision in §7)

Only if F6 showed the TA needs RPMB and the owner decided yes. Not written
out further until then.

### F8: the bridge and enrollment (announce: the panel goes to full brightness; risk medium)

Runner `omamobile-fp-hotdog-chroot start bridge`. `hbm` tested alone first:

```sh
tools/phone-ssh 'f=$(ls /sys/bus/mipi-dsi/devices/*/hbm); echo 1 > $f; sleep 1; echo 0 > $f'
```

Then an enrollment through the bridge socket (not fprintd yet), with the
auth-token mode from F1 (U7).

- **Pass:** `ENROLLED <id>`, then `AUTH` gives `MATCH <id>`.
- **Stop** on `ERROR` codes the HAL repeats, or HBM that doesn't turn off.

### F9: the sensor position (risk low)

Draw the target at the placeholder position, move it until the HAL reports
good captures in the middle, and record x, y and r in the bridge's options
and here.

### F10: fprintd and the lock screen

As cheetah F9-F10: `fprintd-enroll`, `fprintd-verify`, then the lock.
Packaging (a hotdog profile in `omamobile-fingerprint`, the unit enabled)
comes only after F10 passes.

## 7. Results

None yet: nothing has run on the phone.
