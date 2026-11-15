<!-- SPDX-License-Identifier: MIT -->
# Suspend plan (hotdog / SM8150): sleep for battery life

**Status (2026-11-15, evening): S1-S5 pass. Suspend and resume work, and the power key, both volume keys, the alert slider, the RTC and an incoming call wake the phone (sleep kernel `-g123b049ba8f1`, RAM boot; `omamobile-device-hotdog` 0.1.13). Open: the SoC never reaches its deep state (S6: dropping `clk_ignore_unused` wedges the display at boot), an occasional modem wake with no call behind it, the SMS wake test, the drain measurement (S7) and turning it on (S8).**
Kernel: `omamobile-hotdog-keys` (worktree `~/omamobile-kernel/wt-hotdog-keys`,
output `~/omamobile-kernel/out-hotdog-keys`), running from a RAM boot as
`7.3.0-rc6-omamobile-push1-g00e3900120f0`. A kernel change for sleep goes on
a new branch `omamobile-hotdog-sleep` (worktree `wt-hotdog-sleep`, output
`out-hotdog-sleep`) on top of it. Userspace: `packages/omamobile-device-hotdog`.
Test tool: [`bringup/sleep-once`](bringup/sleep-once) (one measured cycle,
run detached on the phone).

**Goal.** With the screen off behind the lock the phone sleeps (s2idle) and
the SoC reaches its deepest state (RPMh `cxsd`: CX collapsed, XO off), so an
idle night costs a few percent of the battery. The power key, the volume
keys, the alert slider, an incoming call or SMS, an alarm (RTC) and the
charger wake it, and everything works again after the wake: the display,
touch, Wi-Fi, mobile data, the modem, sound, the fingerprint, UFS.

The shell side exists already: `omamobile-sleepd` (`omamobile-shell`)
sleeps 30 s after the screen goes off behind a secure lock, once the user
turns on the `omamobile-sleep` toggle (quick settings), and never with an
SSH session open, audio playing or a block-mode sleep inhibitor (a call,
GNSS). This plan is the device side: the kernel and drivers have to
suspend, wake and resume cleanly, and reach the deep state.

## 1. Facts (S0, read-only, 2026-11-15, `-g00e3900120f0`)

| What | Source |
| --- | --- |
| `/sys/power/state` `freeze mem disk`, `mem_sleep` offers only `[s2idle]`: the firmware's PSCI has no SYSTEM_SUSPEND, so there is no `deep` to choose by mistake | phone |
| The phone has never suspended this boot (`suspend_stats/success` 0) | phone |
| CPU idle: `psci_idle` in OS-initiated mode, per-CPU `cpu-sleep-0-0`/`cpu-sleep-1-0` and the cluster's `cluster-sleep-0` (`0x4100c244`, the RSC hands over to AOSS) through `power-domain-cpu-cluster0`; in 2 h 13 min awake with the screen on the cluster state was entered 75 times (36 rejected) | `/sys/kernel/debug/pm_genpd/*/idle_states` |
| RPMh sleep stats: `aosd`, `cxsd`, `ddr` all count 0 since boot; `modem` 11, `adsp` 67. The SoC has never reached a deep state | `/sys/kernel/debug/qcom_stats` |
| Command line has `clk_ignore_unused pd_ignore_unused` (from bring-up): unused clocks and GDSCs stay on (e.g. `ufs_card_gdsc` is on with no consumer). Expected to block `cxsd`: an enabled branch clock keeps XO requested | `/proc/cmdline`, `pm_genpd_summary` |
| Wake-enabled: PM8150 `pon` power key, PM8150 RTC (+ alarmtimer), PM8150B charger, `gpio-keys` (volume keys on PM8150 GPIO6/7, alert slider on TLMM 27/125/134), the fingerprint IRQ, IPA, the modem, ADSP and CDSP remoteprocs, the two thermal sensors, the debug UART | `/sys/class/wakeup`, `power/wakeup` |
| Not wake sources: touch (`s6sy761`), USB, Wi-Fi (`ath10k_snoc`), Bluetooth | same |
| The PMIC's interrupts (power key, RTC, volume keys, charger) all arrive through the SPMI arbiter's `periph_irq`, which `sm8150.dtsi` wires to the GIC directly (`GIC_SPI 481`). From SM8250 on the dtsi routes it through the PDC (`<&pdc 1 …>`, SPI 481 is PDC pin 1 in `qcom,pdc-ranges`). An interrupt the PDC isn't told about may not wake the SoC out of AOSS sleep: the first suspect if the power key can't wake it | `sm8150.dtsi`, `sm8250.dtsi`, `sc7180.dtsi` |
| TLMM has `wakeup-parent = <&pdc>`: GPIO wakes (alert slider, fingerprint, touch) go through the PDC already | `sm8150.dtsi` |
| `smp2p` is wakeup-capable but disabled until user space enables it; `qcom_glink_smem` requests its IRQ `IRQF_NO_SUSPEND` (the modem's GLINK messages, so SMS and calls, can wake) | `drivers/soc/qcom/smp2p.c`, `drivers/rpmsg/qcom_glink_smem.c` |
| UFS `spm_lvl` 3, `rpm_lvl` 3 | `/sys/bus/platform/devices/1d84000.ufshc` |
| `qcom_wdt` is a module and stops in suspend: no watchdog covers a sleep that never wakes, only the buttons (Power held until it resets, about 15 s; [BRINGUP-M1](BRINGUP-M1.md) §2) | `drivers/watchdog/qcom-wdt.c` |
| Up at the time: Wi-Fi (connected), mobile data (`qrtr0` connected), ModemManager, the fingerprint stack, sound. Sleep inhibitors (delay): ModemManager ("needs to reset devices"), NetworkManager, UPower, Omarchy's lock | `nmcli`, `systemd-inhibit --list` |
| Gauge `bq27411`: `charge_now` (µAh), `current_now` (µA); no `charge_counter`. `tools/power-ab` reads `charge_now` | `/sys/class/power_supply/bq27411-0` |
| `logind` ignores the power key (`10-omamobile-power-key.conf`): the key is Hyprland's and `omamobile-keys`', which asks `omamobile-sleepd now` | package |

## 2. Approach

One change per step, read-only first, attended. Every live step runs
`sleep-once` detached (`systemd-run`), with the cable in, because the USB
link drops while the phone sleeps; after it, a fresh SSH login reads the log
in `/var/log/omamobile/sleep-test/`. The owner is by the phone for every
live step, ready to hold Power (about 15 s) if it doesn't come back.

The order:

1. **Does it suspend and resume at all** (S1 `pm_test devices`, S2 a 30 s
   RTC sleep). Fix every driver that fails or breaks.
2. **Does every wake source wake it** (S3: power key, volume keys, slider,
   charger, a call and an SMS). Expected fix: the SPMI arbiter through the
   PDC (K1 below).
3. **How deep does it go** (S4: `cxsd`, `ddr`, `aosd` counts after a
   10-minute sleep). Expected fixes, one boot each: drop `pd_ignore_unused`,
   then `clk_ignore_unused` (K2, K3), after checking which consumer relied
   on them (the fingerprint's QUP0 SE3 clocks are the first suspect).
4. **Through `systemctl suspend`** (S5): the hooks, ModemManager and
   NetworkManager across sleep, a device sleep hook for whatever needs one.
5. **Measure** (S6: `tools/power-ab s2idle`, cable out, detached): mA asleep
   against awake with the screen off.
6. **Turn it on** (S7): the owner's `omamobile-sleep` toggle, a day of use.

## 3. Runbook

Copy the tool once (and after every change to it):

```sh
tools/phone-ssh 'cat > /root/sleep-once && chmod +x /root/sleep-once' < device/hotdog/bringup/sleep-once
```

Read a result (after any step):

```sh
tools/phone-ssh --fresh 'ls -t /var/log/omamobile/sleep-test/*.log | head -1 | xargs cat'
```

### S1: drivers suspend and resume (`pm_test devices`) - risk low

Announce: the screen goes black for about 5 s, USB drops and comes back.

```sh
tools/phone-ssh 'systemd-run -q --collect --unit=x-sleep-once -E MODE=devices /root/sleep-once'
# about 15 s later:
tools/phone-ssh --fresh 'ls -t /var/log/omamobile/sleep-test/*.log | head -1 | xargs cat'
```

- **Expect:** `suspend_stats` success +1, fail 0; no `returned -` line;
  health: root `rw`, no UFS errors, remoteprocs `running`, `wlan0` up, MM 1
  modem; the screen and touch work, mobile data still connected.
- **Stop if:** SSH doesn't come back within 60 s, or a device fails:
  record `last_failed_dev`, don't go on to S2.
- **Rollback:** none needed (nothing is changed); a stuck driver: reboot.

### S2: one real s2idle, woken by the RTC after 30 s - risk medium

Announce: the screen goes off for 30 s. If it isn't back after 2 minutes,
the owner holds Power until it resets, about 15 s (it boots `boot_a`, the voice kernel,
without the volume keys until the next RAM boot of the keys kernel).

```sh
tools/phone-ssh 'systemd-run -q --collect --unit=x-sleep-once -E MODE=freeze -E SECS=30 /root/sleep-once'
# about 45 s later:
tools/phone-ssh --fresh 'ls -t /var/log/omamobile/sleep-test/*.log | head -1 | xargs cat'
```

- **Expect:** back after about 30 s, woken by the `pm8xxx_rtc_alarm` IRQ;
  the cluster's `S2idle` column grew; health as S1.
- **Pass:** S1's checks, and the screen, touch, Wi-Fi and data work.
- **Stop if:** no wake (forced restart), an early wake that repeats, or a
  UFS error: record and don't repeat before it's understood.
- **Note:** `aosd`/`cxsd` staying 0 here is expected (cable in, and
  `clk_ignore_unused`): that is S4's question.

### S3: wake sources - risk medium

`MODE=freeze SECS=120`: the RTC is the backstop. One source per run: the
sleep starts, a ping confirms it, then the owner is told to act. Pass: back
within seconds, woken by the matching IRQ; woken by the RTC at 120 s means
the source can't wake the phone.

### S4: the sleep kernel (RAM boot) - risk medium

Kernel `omamobile-hotdog-sleep` = `omamobile-hotdog-keys` +
- "rpmsg: qcom: glink: support waking up on channel rx" (Casey Connolly,
  from the sdm845-mainline tree: every GLINK channel wakeup-capable, waking
  off until user space turns it on for a channel);
- "arm64: dts: qcom: sm8150-oneplus-hotdog: Let the alert slider wake the
  phone" (`wakeup-source` on the three switches).

Build (laptop), as KEYS-PLAN K0 with `wt-hotdog-sleep`/`out-hotdog-sleep`
and `DTB_OVERLAYS="mic torch camera popup camera-main camera-af voice"`.
Then, with the owner's go, as [MODEM-PLAN](MODEM-PLAN.md) R9d:
`DEVICE=hotdog KERNEL_OUT=~/omamobile-kernel/out-hotdog-sleep bin/omamobile modules-push`
(installs the new release's modules beside the others), the owner puts the
phone in fastboot by the buttons, then `fastboot -s <serial> boot
~/omamobile-kernel/out-hotdog-sleep/images/boot.img`. A RAM boot spends no
slot-A try and leaves `boot_a` as it is.

- **Pass:** Arch up as before (cameras, fingerprint, mics, modem, keys);
  `/sys/bus/rpmsg/devices/4080000.remoteproc:glink-edge.IPCRTR.-1.-1/power/wakeup`
  exists and reads `disabled`; `/sys/devices/platform/alert-slider/power/wakeup`
  reads `enabled`.
- **Stop:** no SSH in 2 minutes (bad RAM boots happen: retry once, then
  hold Power: `boot_a` comes back).
- **Then:** S3 for the slider (`MODE=freeze`, expect the `Silent`/
  `Vibrate`/`Ring` IRQ).

### S5: calls and SMS wake it, through `systemctl suspend` - risk medium

Install `omamobile-device-hotdog` 0.1.13 (sleep hook, `sleep.conf`,
ModemManager `--test-quick-suspend-resume`; ModemManager restarts, the
modem stays up). `MODE=systemd SECS=120`: logind runs the hook (arms the
modem's IPCRTR channel only) and ModemManager sets the modem terse.
Omarchy's lock engages before the sleep. One run for a call, one for an SMS.

- **Pass:** back within seconds of the call or SMS; the journal shows
  `omamobile-hotdog-sleep: the modem's QRTR channel can wake the phone`,
  then "no wake IRQ recorded (latest wakeup source: …IPCRTR…)"; the call
  rings (omatel), the SMS arrives; mobile data comes back.
- **Also:** a plain `MODE=systemd SECS=600` with nothing sent: count the
  wakes (`suspend_stats/success`) to see whether terse mode keeps the
  modem quiet.
- **Rollback:** reinstall 0.1.12.

### S6: depth: `pd_ignore_unused`, then `clk_ignore_unused` off - risk medium

The sleep kernel's image again, with `CMDLINE` without `pd_ignore_unused`
(one RAM boot), then without `clk_ignore_unused` as well (another). With
`clk_ignore_unused` the AP keeps sleep-set votes on four RPMh XO buffers
nobody uses (`ln_bb_clk2`, `ln_bb_clk3`, `rf_clk1`, `rf_clk3`), so AOSS can
never turn the crystal off (`cxsd` stays 0). Of the other unclaimed clocks,
QUP0 SE7 is stock's AW8697 haptics I2C (no driver here yet) and QUP1 SE4
stock's debug console UART: neither is TrustZone's. The fingerprint's QUP0
SE3 is claimed by its DT node.

- **Pass:** boots as S4; display, touch, Wi-Fi, Bluetooth, sound, cameras,
  fingerprint, modem work; then a 10-minute `MODE=freeze SECS=600` with the
  cable **out** (owner unplugs after the start, plugs back after): `cxsd`
  and `ddr` counts grow.
- **Stop:** a black screen or a hang at boot: hold Power (`boot_a`).

### S7: measure, S8: turn it on

`tools/power-ab s2idle --suspend systemd` (cable out, detached), then the
owner's `omamobile-sleep` toggle and a day of use. Flash `boot_a` and
re-mark slot A ([BRINGUP-M1](BRINGUP-M1.md)) only after that day.

## 4. Kernel changes

- **K1** (not needed) route the SPMI arbiter interrupt through the PDC, as
  SM8250 and later do. The power key, the volume keys and the RTC all wake
  the phone without it (S3): the arbiter's GIC interrupt reaches the CPUs
  from s2idle as it is.
- **K2** drop `pd_ignore_unused` from `CMDLINE` (S6).
- **K3** drop `clk_ignore_unused` (S6): **blocked**. Without it the boot
  wedged the display twice (see S6 in section 5); the display's clocks
  have to be handed over from the bootloader's splash first (K6).
- **K6** (to write) keep the display's clocks through `clk_disable_unused`
  until `msm` takes the splash over, or claim them earlier: the DSI0 PLL,
  byte and pixel clocks and `disp_cc_mdss_rscc_*` are among the "unused"
  clocks that are on at late init. Alternatively, release only the four
  RPMh XO-buffer votes (`ln_bb_clk2`, `ln_bb_clk3`, `rf_clk1`, `rf_clk3`) if
  they turn out to be what holds XO on.
- **K4** GLINK channel wakeup (S4, on `omamobile-hotdog-sleep`).
- **K5** the alert slider as a wakeup source (S4, on `omamobile-hotdog-sleep`).

## 5. Results

All on `7.3.0-rc6-omamobile-push1-g00e3900120f0` (RAM boot), cable in,
2026-11-15.

- **S1 pass** (15:32). Every device suspended and resumed, back after
  8.9 s; root `rw`, no UFS error, modem/ADSP/CDSP `running`, MM sees the
  modem. Wi-Fi: `wiphy_suspend` took 3.2 s (the station deauthenticates
  for the sleep, then removing its key times out, `-110`); it reassociates
  about 2 s after resume. `lc898217xc 7-0072: status still 0x20 after
  power-up` at resume (the main camera's focus driver; the camera wasn't in
  use).
- **S2 pass** (15:33). 27.8 s in s2idle, woken by IRQ `pm8xxx_rtc_alarm`;
  the cluster's `S2idle` count went 0 → 1 (the whole cluster powered down
  for the sleep); resume of devices 409 ms. `aosd`, `cxsd`, `ddr` stayed 0.
- **S3** (15:47-15:54):

  | Source | Wakes it | IRQ |
  | --- | --- | --- |
  | Power key | yes, 16.7 s | `pm8941_pwrkey` |
  | Volume Up | yes | `spmi-gpio 5 Volume Up` |
  | Volume Down | yes | `spmi-gpio 6 Volume Down` |
  | Alert slider | **no**: all three lines latched an edge, the RTC woke it at 120 s | (no `wakeup-source`: K5) |
  | Incoming call | **no**: `glink-smem` fired 50 times (16 in a quiet sleep), the RTC woke it | (GLINK reports no wakeup: K4, and ModemManager must keep the modem: S5) |

- **Shell:** `omamobile-sleepd` lit the PIN pad only for a wake IRQ named
  `KEY_POWER` or `Power`; here it is `pm8941_pwrkey`, so a power-key wake
  would have gone straight back to sleep. Fixed in `omamobile-shell`
  0.2.130.

On `7.3.0-rc6-omamobile-push1-g123b049ba8f1` (the sleep kernel, RAM boot),
`omamobile-device-hotdog` 0.1.13, cable in, 2026-11-15 evening.

- **S4 pass** (16:17, second RAM boot; the first was a bad boot, see the
  display note below). Everything up as on `boot_a`; the modem's IPCRTR
  channel is wakeup-capable (`disabled` until armed), the slider reads
  `enabled`. Slider wake (17:12): back after 15.6 s, woken by IRQ
  `msmgpio 125 Edge Silent`.
- **S5, the way to a clean sleep through `systemctl suspend`** (17:13-17:22),
  each found by a run that aborted (`suspend of devices aborted`, `-16`,
  `last_failed_dev` empty: a hard wakeup event, which the PM core doesn't
  name):
  1. the transition's own modem traffic (119 messages on the channel in one
     attempt: ModemManager's terse mode, NetworkManager taking mobile data
     down, their replies) still in flight when the hook armed the channel:
     the hook now waits until the channel has been quiet for 1.5 s (at most
     8 s);
  2. Wi-Fi: NetworkManager leaves `wlan0` up (disconnected) for the sleep, so
     mac80211 stopped the radio in `wiphy_suspend`, and ath10k's exchange
     with its firmware's QMI service, which is on the modem's QRTR node,
     aborted the sleep ~100 ms in, every time: the hook takes wireless links
     down before the quiet wait (it also avoids the 3.2 s key-removal
     timeout inside the device suspend). NetworkManager raises it at wake;
  3. `omamobile-hotdog-sim-select` asked the modem for the card status every
     10 s forever: now every 60 s once the session exists.
  With all three: a 120 s, a 300 s and a 600 s sleep with the channel armed
  ran to the RTC with no early wake; Wi-Fi and mobile data reconnect at wake.
- **S5 call: pass** (17:54). The call came 1.4 s into s2idle
  (`Timekeeping suspended for 1.380 seconds`), woke the phone (latest
  wakeup source `4080000.remoteproc:glink-edge.IPCRTR.-1.-1`), ModemManager
  reported `ringing-in` 0.1 s after the wake, the phone lit up and rang, the
  owner declined it.
- **Spurious modem wakes:** twice (17:34 after 40 s, 17:56 after 45 s) the
  modem channel woke the phone with no call and nothing for ModemManager (it
  read nothing before its own resume sync), in about 25 minutes of sleep;
  the 120, 300 and 600 s sleeps had none. The sender is unknown: no ftrace
  in this kernel, and the channel carries every QRTR service. Next: a debug
  print of the QRTR header (source node:port, type) for packets that arrive
  while suspended.
- **SMS wake:** not run yet.
- **S6** (18:0x-21:0x):
  - without `pd_ignore_unused` (`clk_ignore_unused panic=10 console=tty0`):
    boots and everything works; the kernel turns off the unused power
    domains (`ufs_card_gdsc` among them);
  - without `clk_ignore_unused` too: **hung twice** (the second time with
    `panic=10 splash`). Ping answered at 0.2-2.8 s and neither SSH nor the
    USB serial shell answered;
  - in between, four boots in a row (two of the no-`pd` image, `boot_a`'s
    voice kernel, after warm and a cold restart) came up wedged the same way,
    with `[dpu error]enc35 ctl 1 reset failure`, `frame done timeout`,
    `kickoff timeout` and `drm_crtc_wait_one_vblank` traces in the log, the
    init's `tee /dev/kmsg` in D state and the CPUs 95 % idle: every console
    line waits for a display frame that never completes. This is the
    intermittent "bad RAM boot" of CAMERA-PLAN; here it came in a streak
    right after the first no-`clk` boot, and ended after a cold start and a
    RAM boot with `splash` instead of `console=tty0` (whether the console
    change helped is not known: that boot had no DPU error at all).
  The working explanation: `clk_disable_unused` turns off the display's
  clocks (DSI0 PLL, byte/pixel, `disp_cc_mdss_rscc_*`) while the
  bootloader's splash is still on and before `msm` claims them, and the
  display stays wedged. K6.

## 6. Next

1. SMS wake (`MODE=systemd SECS=600`, an SMS from another phone).
2. Find the spurious modem wakes (QRTR debug print).
3. K6, then S6 again without `clk_ignore_unused`.
4. S7: `tools/power-ab s2idle --suspend systemd` cable out, now and after K6.
5. S8: `omamobile-shell` 0.2.130 on the phone (the power-key wake lights the
   PIN pad), the owner's `omamobile-sleep` toggle, a day of use; then flash
   the sleep kernel to `boot_a` and mark slot A again ([BRINGUP-M1](BRINGUP-M1.md)).
