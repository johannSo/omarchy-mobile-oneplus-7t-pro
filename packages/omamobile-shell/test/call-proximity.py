#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Tests for bin/omamobile-call-proximity: which call states want the
guard, the proximity switch found by its capabilities in a fake /sys, and
the blanking steps (panel off on near, back on far, a panel lit by hand
left alone) with the commands and the clock stubbed."""

import importlib.machinery
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "..", "bin", "omamobile-call-proximity")
failures = 0


def check(name, condition, detail=""):
    global failures
    print("%s - call-proximity: %s%s" % ("ok" if condition else "not ok", name, "" if condition else "  # " + str(detail)))
    if not condition:
        failures += 1


loader = importlib.machinery.SourceFileLoader("call_proximity", TOOL)
spec = importlib.util.spec_from_loader("call_proximity", loader)
cp = importlib.util.module_from_spec(spec)
loader.exec_module(cp)


def state(*calls, route="earpiece", agent=True):
    return {"agent": agent, "route": route, "calls": [{"state": c} for c in calls]}


check("an active call on the earpiece wants it", cp.wanted(state("active")))
check("dialling and ringing out want it", cp.wanted(state("dialing")) and cp.wanted(state("ringing-out")))
check("a ringing incoming call doesn't", not cp.wanted(state("ringing-in")))
check("a held call alone doesn't", not cp.wanted(state("held")))
check("one active call among others does", cp.wanted(state("held", "active")))
check("the speaker doesn't", not cp.wanted(state("active", route="speaker")))
check("Bluetooth doesn't", not cp.wanted(state("active", route="bluetooth")))
check("no agent, no call", not cp.wanted(state("active", agent=False)))
check("no calls, nothing", not cp.wanted(state()))

with tempfile.TemporaryDirectory() as root:
    def device(n, sw):
        d = os.path.join(root, "class/input/input%d" % n)
        os.makedirs(d + "/capabilities")
        os.makedirs(d + "/event%d" % (n + 3))
        with open(d + "/capabilities/sw", "w") as f:
            f.write(sw + "\n")
    device(4, "0")            # a device without switches
    device(2, "10")           # bit 4 only: SW_MICROPHONE_INSERT
    device(9, "800")          # bit 11: SW_FRONT_PROXIMITY
    check("the proximity switch is found by its capability",
          cp.find_proximity_switch(root) == "/dev/input/event12", cp.find_proximity_switch(root))

with tempfile.TemporaryDirectory() as run:
    os.environ["XDG_RUNTIME_DIR"] = run
    cp.find_touchscreen = lambda sysfs="/sys": None     # nothing to grab here
    ran, now = [], [100.0]
    b = cp.Blank(run=lambda argv, check=False: ran.append(argv[-1]), clock=lambda: now[0])
    flag = os.path.join(run, "omamobile-call-proximity")

    b.follow(False, False)
    check("far on a lit screen does nothing", ran == [] and not b.on)
    b.follow(True, False)
    check("near turns the panel off and marks it", ran == ["off"] and b.on and os.path.exists(flag), ran)
    now[0] += 0.3
    b.follow(True, False)
    check("a panel still reading lit just after does not count as lit by hand", b.on and ran == ["off"])
    b.follow(False, True)
    check("far turns it back on and clears the mark", ran == ["off", "on"] and not b.on and not os.path.exists(flag), ran)

    ran.clear()
    b.follow(True, True)
    check("near on a panel already dark (the power key) leaves it", ran == [] and not b.on)

    ran.clear()
    b.follow(True, False)
    now[0] += 2
    b.follow(True, False)
    check("lit by hand while near: kept lit, mark gone", ran == ["off"] and not b.on and not os.path.exists(flag), ran)
    b.follow(True, False)
    check("and not turned off again while still near", ran == ["off"] and not b.on, ran)
    b.follow(False, False)
    b.follow(True, False)
    check("after far, near turns it off again", ran == ["off", "off"] and b.on, ran)
    b.stop()

sys.exit(1 if failures else 0)
