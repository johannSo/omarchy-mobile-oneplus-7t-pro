#!/usr/bin/python3
# SPDX-License-Identifier: MIT
"""omamobile-launcher-index (the drawer's settings, contacts and app info)
against a made-up Omarchy menu, address book and desktop entries. Run by
test/all; prints TAP lines, exits 1 on a failure."""
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
loader = importlib.machinery.SourceFileLoader("index", os.path.join(HERE, "../bin/omamobile-launcher-index"))
spec = importlib.util.spec_from_loader("index", loader)
index = importlib.util.module_from_spec(spec)
loader.exec_module(index)

failed = 0


def check(name, good, detail=""):
    global failed
    print("%s - launcher index: %s%s" % ("ok" if good else "not ok", name, "" if good else "\n  " + str(detail)))
    failed += 0 if good else 1


tmp = tempfile.mkdtemp()
omarchy = os.path.join(tmp, "omarchy")
home = os.path.join(tmp, "home")
os.makedirs(os.path.join(omarchy, "default/omarchy"))
os.makedirs(os.path.join(home, ".config/omarchy/extensions"))
os.environ.update(OMARCHY_PATH=omarchy, HOME=home, XDG_DATA_HOME=os.path.join(home, ".local/share"),
                  XDG_DATA_DIRS=os.path.join(tmp, "usr/share"))

with open(os.path.join(omarchy, "default/omarchy/omarchy-menu.jsonc"), "w") as f:
    f.write('''{
  // The roots.
  "setup": {"icon": "S", "label": "Setup"},
  "setup.network": {"label": "Network", "description": "DNS and more"},
  "setup.network.dns": {"label": "DNS", "aliases": ["resolver"],},
  "setup.gone": {"label": "Gone", "when": "false"},
  "setup.gone.child": {"label": "Child of gone"},
  "setup.shell": {"label": "Shell test", "when": "test -n \\"$HOME\\""},
  "setup.url": {"label": "A // not a comment", "action": "xdg-open https://example.org/a//b"},
  "install": {"label": "Install"},
  "install.thing": {"label": "Thing"},
  "system": {"label": "System"},
  "system.shutdown": {"label": "Shutdown", "action": "systemctl poweroff"},
  /* a block comment */
  "appearance": {"label": "Appearance"},
  "appearance.theme": {"label": "Theme", "searchTerms": ["colors"]},
}''')
with open(os.path.join(home, ".config/omarchy/extensions/omarchy-menu.jsonc"), "w") as f:
    f.write('''{
  "appearance.theme": {"when": "false"},
  "setup.mobile": {"label": "Mobile network", "action": "omarchy-shell shell summon omamobile.mobilenetwork '{}'"},
}''')

rows = index.settings()["settings"]
ids = [r["id"] for r in rows]
check("the phone's pages come first", ids[:2] == ["omamobile.wifi", "omamobile.bluetooth"], ids[:3])
check("the setup tree is there, with its path", "setup.network.dns" in ids and
      next(r for r in rows if r["id"] == "setup.network.dns")["path"] == "Setup › Network", rows)
check("aliases and descriptions are search terms",
      "resolver" in next(r for r in rows if r["id"] == "setup.network.dns")["terms"]
      and "DNS and more" in next(r for r in rows if r["id"] == "setup.network")["terms"])
check("a row whose condition fails is left out, and its children", "setup.gone" not in ids and "setup.gone.child" not in ids, ids)
check("a shell condition that holds keeps its row", "setup.shell" in ids, ids)
check("the user's extension overrides and adds rows", "appearance.theme" not in ids and "setup.mobile" in ids, ids)
check("no installing, removing or powering off from a search",
      not any(i.split(".")[0] in ("install", "remove", "system") for i in ids), ids)
check("each row opens through omarchy-menu summon",
      next(r for r in rows if r["id"] == "setup.network")["argv"] == ["omarchy-menu", "summon", "setup.network"])
check("// inside a string is no comment", next(r for r in rows if r["id"] == "setup.url")["label"] == "A // not a comment")
check("a broken menu file reads as nothing", index.read_menu(os.path.join(tmp, "missing.jsonc")) == {})

# ---------------------------------------------------------------- contacts
book = os.path.join(home, ".local/share/contacts/default")
os.makedirs(book)
with open(os.path.join(book, "a.vcf"), "w") as f:
    f.write("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada Love\r\n lace\r\nN:Lovelace;Ada;;;\r\n"
            "TEL;TYPE=CELL:+44 20 7946 0001\r\nitem1.TEL;type=WORK,VOICE:tel:+44 20 7946 0999\r\nEND:VCARD\r\n")
with open(os.path.join(book, "b.vcf"), "w") as f:
    f.write("BEGIN:VCARD\nVERSION:4.0\nN:Hopper;Grace;;;\nTEL:+1 202 555 0143\nEND:VCARD\n"
            "BEGIN:VCARD\nVERSION:4.0\nFN:Nobody\nEND:VCARD\n"
            "BEGIN:VCARD\nVERSION:4.0\nORG:ACME\\, Inc.;Sales\nTEL;TYPE=work:+1 202 555 0100\nEND:VCARD\n")
people = index.contacts()["contacts"]
names = [p["name"] for p in people]
check("vCards: folded names, N when there is no FN, ORG when there is neither", names == ["ACME, Inc.", "Ada Lovelace", "Grace Hopper"], names)
ada = next(p for p in people if p["name"] == "Ada Lovelace")
check("every number, with its label, a tel: URI's too",
      ada["numbers"] == [{"label": "Mobile", "number": "+44 20 7946 0001"}, {"label": "Work", "number": "+44 20 7946 0999"}], ada)
check("a card without a number is left out", "Nobody" not in names)

# ---------------------------------------------------------------- app info
apps = os.path.join(tmp, "usr/share/applications")
os.makedirs(apps)
with open(os.path.join(apps, "org.example.App.desktop"), "w") as f:
    f.write("[Desktop Entry]\nName=App\nExec=example-app %U\n\n[Desktop Action new]\nExec=example-app --new\n")
user_apps = os.path.join(home, ".local/share/applications")
os.makedirs(user_apps)
with open(os.path.join(user_apps, "Site.desktop"), "w") as f:
    f.write("[Desktop Entry]\nName=Site\nExec=omarchy-launch-webapp https://example.org\n")
os.environ["PATH"] = tmp  # no pacman, no flatpak
info = index.app_info("org.example.App.desktop")
check("app info: the entry's file and its Exec, not an action's",
      info["file"] == os.path.join(apps, "org.example.App.desktop") and info["exec"] == "example-app %U", info)
check("app info: a web app", index.app_info("Site")["source"] == "Web app")
check("app info: an Android app", index.app_info("waydroid.org.example")["package"] == "org.example")
check("app info: an unknown id", index.app_info("nope")["file"] == "")
check("the CLI prints one line of JSON", json.loads(json.dumps(info)) == info)

sys.exit(1 if failed else 0)
