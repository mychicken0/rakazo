"""Lists the on-screen controls of desktop apps from the AT-SPI accessibility tree.

Prints one JSON object: {"elements": [...], "truncated": bool}. Each element is
`[role] "name" (x,y)` with the integer screen center, plus optional flags.
"""
import json
import re
import subprocess
import sys
import time

MAX_ELEMENTS = 300
MAX_DEPTH = 40
MAX_CHILDREN = 200
MAX_SECONDS = 3
MAX_TEXT = 80
ACTION_ROLES = {
    "button", "push button", "toggle button", "check box", "radio button", "menu", "menu item",
    "check menu item", "radio menu item", "combo box", "list item", "entry", "text",
    "password text", "spin button", "slider", "tab", "page tab", "link", "tree item",
    "table cell", "icon",
}
LABEL_ROLES = {"label", "heading"}
EDITABLE_ROLES = {"entry", "text", "spin button"}


def short(text):
    return re.sub(r"\s+", " ", text or "").strip()[:MAX_TEXT]


def screen_size():
    out = subprocess.run(["xdotool", "getdisplaygeometry"], capture_output=True, text=True, timeout=1).stdout.split()
    return int(out[0]), int(out[1])


def main():
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi

    width, height = screen_size()
    deadline = time.monotonic() + MAX_SECONDS
    elements = []
    truncated = False

    class Full(Exception):
        pass

    def add(line):
        if len(elements) >= MAX_ELEMENTS:
            raise Full
        elements.append(line)

    def visible_center(node):
        states = node.get_state_set()
        if not (states.contains(Atspi.StateType.SHOWING) and states.contains(Atspi.StateType.VISIBLE)):
            return None
        box = node.get_extents(Atspi.CoordType.SCREEN)
        if box.width <= 0 or box.height <= 0:
            return None
        x, y = box.x + box.width // 2, box.y + box.height // 2
        return (x, y, states) if 0 <= x < width and 0 <= y < height else None

    def describe(node, role, x, y, states):
        name = short(node.get_name())
        if role in LABEL_ROLES and not name:
            return None
        line = f'[{role}] "{name}" ({x},{y})'
        for flag, state in (
            ("focused", Atspi.StateType.FOCUSED),
            ("checked", Atspi.StateType.CHECKED),
            ("selected", Atspi.StateType.SELECTED),
        ):
            if states.contains(state):
                line += " " + flag
        if not states.contains(Atspi.StateType.ENABLED) and not states.contains(Atspi.StateType.SENSITIVE):
            line += " disabled"
        # Password fields never expose a value.
        if role in EDITABLE_ROLES and states.contains(Atspi.StateType.EDITABLE):
            try:
                count = Atspi.Text.get_character_count(node)
                value = short(Atspi.Text.get_text(node, 0, min(count, 400)))
            except Exception:
                value = ""
            if value:
                line += f' value="{value}"'
        return line

    def children(node):
        count = node.get_child_count()
        for index in range(min(count, MAX_CHILDREN)):
            child = node.get_child_at_index(index)
            if child is not None:
                yield child

    def walk(node, depth):
        nonlocal truncated
        if time.monotonic() > deadline or depth > MAX_DEPTH:
            truncated = True
            return
        center = visible_center(node)
        if center is None:
            return
        role = node.get_role_name()
        if role in ACTION_ROLES or role in LABEL_ROLES:
            line = describe(node, role, *center)
            if line:
                add(line)
        if node.get_child_count() > MAX_CHILDREN:
            truncated = True
        for child in children(node):
            walk(child, depth + 1)

    def is_active(app):
        return any(window.get_state_set().contains(Atspi.StateType.ACTIVE) for window in children(app))

    desktop = Atspi.get_desktop(0)
    apps = sorted(children(desktop), key=lambda app: not is_active(app))
    try:
        for app in apps:
            for window in children(app):
                if visible_center(window) is None:
                    continue
                add(f'window "{short(window.get_name())}"')
                for child in children(window):
                    walk(child, 1)
    except Full:
        truncated = True
    print(json.dumps({"elements": elements, "truncated": truncated}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"elements": [], "error": short(f"{type(error).__name__}: {error}")[:60]}))
    sys.exit(0)
