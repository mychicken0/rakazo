# Login shells source /etc/profile, and Debian replaces PATH for non-root users
# before this directory runs. That drops ~/.local/bin even when the supervisor
# put it first. The persistent home is a volume, so /etc/skel/.profile never
# shows up there. Restore the sandbox home bin for every login shell, including
# the agent shell (`bash -lc`).
if [ -n "${HOME:-}" ]; then
  rakazo_local_bin="${HOME}/.local/bin"
  case ":${PATH:-}:" in
    *":${rakazo_local_bin}:"*) ;;
    *) PATH="${rakazo_local_bin}${PATH:+:$PATH}" ;;
  esac
  export PATH
  unset rakazo_local_bin
fi

# Apps started from the agent shell join the desktop session's bus, so their controls reach the
# accessibility tree the computer tools read. Qt and Chrome expose controls only when asked.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -r /tmp/rakazo/dbus-session ]; then
  . /tmp/rakazo/dbus-session
fi
export QT_ACCESSIBILITY=1 QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 ACCESSIBILITY_ENABLED=1
