# -*- coding: utf-8 -*-
"""
Чистильщик диска — локальный сервер на 127.0.0.1 + веб-интерфейс (папка ui/), только стандартная библиотека.

Разделы: очистка системы (категории программ), мусор и копии, дубликаты, бесполезные файлы,
старые игры, анализ места, диски, результаты, журнал. Адрес интерфейса печатается в консоли.

Запуск:  python cleaner.py                       (сервер + браузер)
         python cleaner.py --port 8770 --no-browser
         python cleaner.py --selftest            (проверка без удаления, в консоль)
Портатив: python build.py — подписанный python.exe + .bat, без PyInstaller.
"""
import csv
import ctypes
import glob
import hashlib
import json
import os
import queue
import re
import shutil
import stat
import string
import subprocess
import sys
import tempfile
import threading
import time
from ctypes import wintypes
from pathlib import Path

APP_TITLE = "Чистильщик диска"
APP_VERSION = "2.1"

# --------------------------------------------------------------------------
# Пути
# --------------------------------------------------------------------------
ENV = os.environ
HOME = Path.home()
LOCAL = Path(ENV.get("LOCALAPPDATA", HOME / "AppData" / "Local"))
ROAMING = Path(ENV.get("APPDATA", HOME / "AppData" / "Roaming"))
WINDIR = Path(ENV.get("WINDIR", r"C:\Windows"))
PROGDATA = Path(ENV.get("PROGRAMDATA", r"C:\ProgramData"))
USER_TEMP = Path(tempfile.gettempdir())
DOWNLOADS = HOME / "Downloads"

FILE_ATTRIBUTE_REPARSE_POINT = 0x400
CREATE_NO_WINDOW = 0x08000000

# Куда поиск мусора не лезет никогда (системные и программные папки).
PROTECTED_ROOTS = [
    WINDIR,
    Path(ENV.get("ProgramFiles", r"C:\Program Files")),
    Path(ENV.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
    PROGDATA,
]
SKIP_DIR_NAMES = {
    "$recycle.bin", "system volume information", "$windows.~bt", "$windows.~ws",
    "windows.old", "recovery", "config.msi", "msocache",
    ".git", ".svn", ".hg", "node_modules", ".venv", "venv", "env",
    "__pycache__", ".gradle", ".m2", ".cargo", ".rustup", ".nuget",
    "site-packages", ".idea", ".vs", "appdata",
}


def norm(p):
    return os.path.normcase(os.path.abspath(str(p)))


PROTECTED_NORM = [norm(p) for p in PROTECTED_ROOTS]


def is_protected(path):
    n = norm(path)
    for root in PROTECTED_NORM:
        if n == root or n.startswith(root + os.sep):
            return True
    # корень диска сам по себе
    return len(n) <= 3


# --------------------------------------------------------------------------
# Утилиты
# --------------------------------------------------------------------------
def human(n):
    n = float(n or 0)
    for unit in ("Б", "КБ", "МБ", "ГБ", "ТБ"):
        if abs(n) < 1024 or unit == "ТБ":
            return f"{n:.0f} {unit}" if unit == "Б" else f"{n:.2f} {unit}"
        n /= 1024


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_as_admin():
    exe = sys.executable
    # новый экземпляр сам откроет браузер и покажет адрес в своём окне консоли
    args, skip = [], False
    for a in sys.argv[1:]:
        if skip:
            skip = False
            continue
        if a == "--port":
            skip = True
            continue
        if a != "--no-browser":
            args.append(a)
    if getattr(sys, "frozen", False):  # собранный .exe
        params = " ".join(f'"{a}"' for a in args)
    else:
        exe = os.path.join(os.path.dirname(exe), "python.exe") if exe.lower().endswith("pythonw.exe") else exe
        params = " ".join(f'"{a}"' for a in [os.path.abspath(sys.argv[0])] + args)
    rc = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, params or None, None, 1)
    return rc > 32


def is_reparse(st):
    return bool(getattr(st, "st_file_attributes", 0) & FILE_ATTRIBUTE_REPARSE_POINT)


def force_unlink(path):
    try:
        os.unlink(path)
    except PermissionError:
        os.chmod(path, stat.S_IWRITE)
        os.unlink(path)


def clean_dir(root, cutoff=None, stop=None, dry=False, delete_root=False):
    """Удаляет содержимое папки (сам корень оставляет, если delete_root=False).
    cutoff — unix-время: файлы новее не трогаем. Ссылки/junction не обходятся.
    Возвращает (байт, файлов, ошибок)."""
    freed = count = errs = 0
    dirs = []
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            entries = list(os.scandir(d))
        except OSError:
            errs += 1
            continue
        for e in entries:
            if stop is not None and stop.is_set():
                return freed, count, errs
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                errs += 1
                continue
            if is_reparse(st):
                # ссылку удаляем как ссылку, внутрь не идём
                if cutoff and st.st_mtime > cutoff:
                    continue
                if not dry:
                    try:
                        os.rmdir(e.path)
                    except OSError:
                        try:
                            os.unlink(e.path)
                        except OSError:
                            errs += 1
                            continue
                count += 1
                continue
            if stat.S_ISDIR(st.st_mode):
                stack.append(e.path)
                dirs.append((e.path, st.st_mtime))
                continue
            if cutoff and st.st_mtime > cutoff:
                continue
            if not dry:
                try:
                    force_unlink(e.path)
                except OSError:
                    errs += 1
                    continue
            freed += st.st_size
            count += 1
    if not dry:
        for d, mt in reversed(dirs):  # дети раньше родителей
            if cutoff and mt > cutoff:
                continue
            try:
                os.rmdir(d)
            except OSError:
                pass
        if delete_root:
            try:
                os.rmdir(root)
            except OSError:
                pass
    return freed, count, errs


def dir_size(root, stop=None):
    """(байт, файлов) без обхода ссылок."""
    total = files = 0
    stack = [root]
    while stack:
        if stop is not None and stop.is_set():
            break
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        st = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if is_reparse(st):
                        continue
                    if stat.S_ISDIR(st.st_mode):
                        stack.append(e.path)
                    else:
                        total += st.st_size
                        files += 1
        except OSError:
            pass
    return total, files


# ---- Корзина (Shell API) --------------------------------------------------
class SHQUERYRBINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD),
                ("i64Size", ctypes.c_longlong),
                ("i64NumItems", ctypes.c_longlong)]


class SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [("hwnd", wintypes.HWND),
                ("wFunc", wintypes.UINT),
                ("pFrom", wintypes.LPCWSTR),
                ("pTo", wintypes.LPCWSTR),
                ("fFlags", ctypes.c_ushort),
                ("fAnyOperationsAborted", wintypes.BOOL),
                ("hNameMappings", ctypes.c_void_p),
                ("lpszProgressTitle", wintypes.LPCWSTR)]


FO_DELETE = 3
FOF_SILENT = 0x4
FOF_NOCONFIRMATION = 0x10
FOF_ALLOWUNDO = 0x40
FOF_NOERRORUI = 0x400


def recycle_bin_info():
    info = SHQUERYRBINFO()
    info.cbSize = ctypes.sizeof(info)
    try:
        if ctypes.windll.shell32.SHQueryRecycleBinW(None, ctypes.byref(info)) == 0:
            return info.i64Size, info.i64NumItems
    except Exception:
        pass
    return 0, 0


def empty_recycle_bin():
    # SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND
    try:
        ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, 0x7)
    except Exception:
        pass


def send_to_recycle_bin(paths):
    """Удаляет в Корзину пачкой. Возвращает True, если операция не прервана."""
    if not paths:
        return True
    ok = True
    for i in range(0, len(paths), 200):
        chunk = paths[i:i + 200]
        op = SHFILEOPSTRUCTW()
        op.wFunc = FO_DELETE
        op.pFrom = "\0".join(os.path.abspath(p) for p in chunk) + "\0\0"
        op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
        rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
        if rc != 0 or op.fAnyOperationsAborted:
            ok = False
    return ok


# ---- Ярлыки .lnk (минимальный парсер формата MS-SHLLINK) ------------------
def lnk_target(path):
    try:
        with open(path, "rb") as f:
            data = f.read(1 << 16)
    except OSError:
        return None
    if len(data) < 0x4C or data[:4] != b"\x4c\x00\x00\x00":
        return None
    u32 = lambda o: int.from_bytes(data[o:o + 4], "little")
    flags = u32(0x14)
    off = 0x4C
    if flags & 0x1:  # HasLinkTargetIDList
        off += 2 + int.from_bytes(data[off:off + 2], "little")
    if not flags & 0x2:  # HasLinkInfo
        return None
    li = off
    if li + 28 > len(data):
        return None
    hdr = u32(li + 4)
    li_flags = u32(li + 8)
    if not li_flags & 0x1:  # VolumeIDAndLocalBasePath
        return None

    def cstr(o, wide):
        if wide:
            end = o
            while end + 1 < len(data) and data[end:end + 2] != b"\0\0":
                end += 2
            return data[o:end].decode("utf-16-le", "ignore")
        end = data.find(b"\0", o)
        return data[o:end if end >= 0 else None].decode("mbcs", "ignore")

    if hdr >= 0x24:
        base = cstr(li + u32(li + 28), True)
        suffix = cstr(li + u32(li + 32), True)
    else:
        base = cstr(li + u32(li + 16), False)
        suffix = cstr(li + u32(li + 24), False)
    return (base + suffix) if base else None


def drive_is_fixed(path):
    drive = os.path.splitdrive(path)[0]
    if not drive:
        return False
    try:
        return ctypes.windll.kernel32.GetDriveTypeW(drive + "\\") == 3  # DRIVE_FIXED
    except Exception:
        return False


def fixed_drives():
    out = []
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    for i, letter in enumerate(string.ascii_uppercase):
        if mask & (1 << i):
            root = f"{letter}:\\"
            if ctypes.windll.kernel32.GetDriveTypeW(root) == 3:
                out.append(root)
    return out


# --------------------------------------------------------------------------
# Категории системной очистки
# --------------------------------------------------------------------------
def P(*parts):
    return str(Path(*parts))


def _steam_root():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
            return os.path.normpath(winreg.QueryValueEx(k, "SteamPath")[0])
    except OSError:
        p = Path(ENV.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Steam"
        return str(p) if p.exists() else None


def _steam_libraries(root):
    libs = [root] if root else []
    if root:
        try:
            with open(os.path.join(root, "steamapps", "libraryfolders.vdf"), encoding="utf-8",
                      errors="ignore") as f:
                for m in re.findall(r'"path"\s+"([^"]+)"', f.read()):
                    libs.append(os.path.normpath(m.replace("\\\\", "\\")))
        except OSError:
            pass
    out, seen = [], set()
    for x in libs:
        if norm(x) not in seen:
            seen.add(norm(x))
            out.append(x)
    return out


STEAM = _steam_root()
STEAM_LIBS = _steam_libraries(STEAM)
SYSDRIVE = ENV.get("SystemDrive", "C:") + "\\"

# короткие имена для таблицы программ
L, R, PD, H, W, SD = str(LOCAL), str(ROAMING), str(PROGDATA), str(HOME), str(WINDIR), SYSDRIVE
LL = str(HOME / "AppData" / "LocalLow")
DOCS = str(HOME / "Documents")
PF86 = ENV.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
PKG = P(L, "Packages")


def chromium(user_data):
    """Кэши Chromium/WebView2 (все профили). Логины, история, закладки не трогаются."""
    per_profile = ("Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache",
                   os.path.join("Service Worker", "CacheStorage"),
                   os.path.join("Service Worker", "ScriptCache"))
    shared = ("ShaderCache", "GrShaderCache", "GraphiteDawnCache", os.path.join("Crashpad", "reports"))
    return [P(user_data, "*", s) for s in per_profile] + [P(user_data, s) for s in shared]


def electron(app_dir):
    """Кэши Electron-приложения (Discord, Slack, VS Code …)."""
    subs = ("Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache",
            os.path.join("Service Worker", "CacheStorage"),
            os.path.join("Service Worker", "ScriptCache"), os.path.join("Crashpad", "reports"))
    return [P(app_dir, s) for s in subs]


def gecko(profiles):
    """Кэши Firefox-подобных браузеров."""
    return [P(profiles, "*", s) for s in ("cache2", "startupCache", "thumbnails", "jumpListCache",
                                          "OfflineCache")]


def C_(cid, group, name, paths, on=True, note="", **kw):
    d = dict(id=cid, group=group, name=name, paths=[str(p) for p in paths], on=on, note=note)
    d.update(kw)
    return d


TG_UWP = P(PKG, "TelegramMessengerLLP.TelegramDesktop_*", "LocalCache", "Roaming", "Telegram Desktop UWP")

GROUPS = ["Windows", "Браузеры", "Мессенджеры", "Игры и лаунчеры", "Драйверы и железо",
          "Медиа и стриминг", "Офис, облака, утилиты", "Разработка", "Прочее"]

G_WIN, G_BR, G_MSG, G_GAME, G_HW, G_MEDIA, G_OFF, G_DEV, G_ETC = GROUPS
CLOSE_BR = "Закройте браузер. Логины, история и вкладки не трогаются"

CATEGORIES = [
    # ======================= Windows =======================
    C_("user_temp", G_WIN, "Временные файлы пользователя (%TEMP%)", [USER_TEMP], age=True,
       note="Файлы старше заданного возраста; занятые программами пропускаются"),
    C_("win_temp", G_WIN, "Временные файлы Windows", [P(W, "Temp")], age=True, admin=True),
    C_("inetcache", G_WIN, "Временные файлы Интернета (INetCache)",
       [P(L, "Microsoft", "Windows", "INetCache"), P(L, "Microsoft", "Windows", "INetCookies", "Low")]),
    C_("evtlog", G_WIN, "Системные журналы событий (Event Log)", [P(W, "System32", "winevt", "Logs")],
       kind="evtlog", admin=True, on=False, note="Очищаются все журналы через EventLogSession"),
    C_("win_logs", G_WIN, "Логи Windows (CBS, DISM, установка, обновления)",
       [P(W, "Logs"), P(W, "Panther"), P(W, "System32", "LogFiles", "setupcln"),
        P(W, "SoftwareDistribution", "DataStore", "Logs"), P(W, "debug")], age=True, admin=True),
    C_("wu", G_WIN, "Кэш загрузок Windows Update", [P(W, "SoftwareDistribution", "Download")], admin=True,
       note="Уже установленные обновления; Windows скачает заново при нужде"),
    C_("delivery", G_WIN, "Кэш оптимизации доставки",
       [P(W, "ServiceProfiles", "NetworkService", "AppData", "Local", "Microsoft", "Windows",
          "DeliveryOptimization", "Cache")], admin=True),
    C_("dumps", G_WIN, "Дампы памяти и отчёты об ошибках (WER)",
       [P(L, "CrashDumps"), P(W, "Minidump"), P(W, "MEMORY.DMP"), P(L, "Microsoft", "Windows", "WER"),
        P(PD, "Microsoft", "Windows", "WER", "ReportArchive"),
        P(PD, "Microsoft", "Windows", "WER", "ReportQueue"), P(PD, "Microsoft", "Windows", "WER", "Temp")]),
    C_("livekernel", G_WIN, "Отчёты о зависаниях ядра/видеодрайвера (LiveKernelReports)",
       [P(W, "LiveKernelReports")], admin=True, note="Бывают по несколько ГБ после вылетов драйвера"),
    C_("win_setup", G_WIN, "Остатки обновления / установки Windows",
       [P(SD, "ESD"), P(SD, "Windows10Upgrade"), P(SD, "$GetCurrent"), P(SD, "$SysReset"),
        P(W, "SoftwareDistribution", "PostRebootEventCache.V2")], admin=True),
    C_("thumbs", G_WIN, "Кэш эскизов и значков (thumbcache)",
       [P(L, "Microsoft", "Windows", "Explorer", "thumbcache_*.db"),
        P(L, "Microsoft", "Windows", "Explorer", "iconcache_*.db")],
       on=False, note="Занятые Проводником файлы пропускаются"),
    C_("fontcache", G_WIN, "Кэш шрифтов", [P(W, "ServiceProfiles", "LocalService", "AppData", "Local",
                                           "FontCache")], admin=True, on=False),
    C_("store_apps", G_WIN, "Кэш приложений Microsoft Store (INetCache/Temp)",
       [P(PKG, "*", "AC", "INetCache"), P(PKG, "*", "AC", "Temp"),
        P(PKG, "Microsoft.WindowsStore_*", "LocalCache")]),
    C_("defender", G_WIN, "Защитник Windows — история проверок",
       [P(PD, "Microsoft", "Windows Defender", "Scans", "History", "Service"),
        P(PD, "Microsoft", "Windows Defender", "Support")], admin=True, on=False),
    C_("prefetch", G_WIN, "Prefetch", [P(W, "Prefetch")], admin=True, on=False,
       note="Windows восстановит; первые запуски программ чуть медленнее"),
    C_("recycle", G_WIN, "Корзина (все диски)", [], kind="recycle"),

    # ======================= Браузеры =======================
    C_("chrome", G_BR, "Google Chrome (+Beta/Canary)", chromium(P(L, "Google", "Chrome*", "User Data")),
       note=CLOSE_BR),
    C_("edge", G_BR, "Microsoft Edge", chromium(P(L, "Microsoft", "Edge*", "User Data"))),
    C_("yandex", G_BR, "Яндекс Браузер", chromium(P(L, "Yandex", "YandexBrowser", "User Data"))),
    C_("opera", G_BR, "Opera / Opera GX",
       [P(L, "Opera Software", "*", s) for s in ("Cache", "Code Cache", "GPUCache")]
       + [P(R, "Opera Software", "*", s) for s in
          ("Code Cache", "GPUCache", "ShaderCache", os.path.join("Service Worker", "CacheStorage"))]),
    C_("brave", G_BR, "Brave", chromium(P(L, "BraveSoftware", "Brave-Browser*", "User Data"))),
    C_("vivaldi", G_BR, "Vivaldi", chromium(P(L, "Vivaldi", "User Data"))),
    C_("chromium", G_BR, "Chromium / Thorium / Supermium",
       chromium(P(L, "Chromium", "User Data")) + chromium(P(L, "Thorium", "User Data"))
       + chromium(P(L, "Supermium", "User Data"))),
    C_("arc", G_BR, "Arc", chromium(P(PKG, "TheBrowserCompany.Arc_*", "LocalCache", "Local", "Arc", "User Data"))),
    C_("atom", G_BR, "Atom (VK) / Амиго / Спутник",
       chromium(P(L, "VK", "Atom", "User Data")) + chromium(P(L, "Mail.Ru", "Atom", "User Data"))
       + chromium(P(L, "Amigo", "User Data"))),
    C_("firefox", G_BR, "Firefox", gecko(P(L, "Mozilla", "Firefox", "Profiles"))),
    C_("gecko_forks", G_BR, "LibreWolf / Waterfox / Floorp / Zen / Pale Moon",
       gecko(P(L, "librewolf", "Profiles")) + gecko(P(L, "Waterfox", "Profiles"))
       + gecko(P(L, "Floorp", "Profiles")) + gecko(P(L, "zen", "Profiles"))
       + gecko(P(L, "Moonchild Productions", "Pale Moon", "Profiles"))),

    # ======================= Мессенджеры =======================
    C_("tg_cache", G_MSG, "Telegram — кэш (фото, видео, стикеры)",
       [P(R, "Telegram Desktop", "tdata", "user_data*", s) for s in ("cache", "media_cache")]
       + [P(TG_UWP, "tdata", "user_data*", s) for s in ("cache", "media_cache")]
       + [P(R, "AyuGram Desktop", "tdata", "user_data*", s) for s in ("cache", "media_cache")]
       + [P(R, "64Gram Desktop", "tdata", "user_data*", s) for s in ("cache", "media_cache")],
       note="Закройте Telegram. Переписка в облаке, медиа подгрузится заново"),
    C_("tg_downloads", G_MSG, "Telegram — скачанные файлы",
       [DOWNLOADS / "Telegram Desktop", P(DOCS, "Telegram Desktop")], to_bin=True, on=False,
       note="Ваши файлы из чатов — в Корзину (место освободится после её очистки)"),
    C_("whatsapp", G_MSG, "WhatsApp",
       chromium(P(PKG, "5319275A.WhatsAppDesktop_*", "LocalState", "EBWebView"))
       + electron(P(R, "WhatsApp")) + [P(PKG, "5319275A.WhatsAppDesktop_*", "LocalCache")]),
    C_("discord", G_MSG, "Discord (+PTB/Canary)",
       [p for a in ("discord", "discordcanary", "discordptb") for p in electron(P(R, a))],
       note="Закройте Discord"),
    C_("vesktop", G_MSG, "Vesktop / Vencord / Legcord",
       electron(P(R, "vesktop")) + electron(P(R, "vesktop", "sessionData")) + electron(P(R, "legcord"))
       + electron(P(R, "ArmCord"))),
    C_("viber", G_MSG, "Viber — кэш и логи",
       [P(R, "ViberPC", "*", "Thumbnails"), P(L, "Viber Media S.à r.l", "ViberPC", "*", "QtWebEngine"),
        P(R, "ViberPC", "*.log")]),
    C_("skype", G_MSG, "Skype", electron(P(R, "Microsoft", "Skype for Desktop"))
       + [P(PKG, "Microsoft.SkypeApp_*", "LocalCache")]),
    C_("teams", G_MSG, "Microsoft Teams",
       electron(P(R, "Microsoft", "Teams"))
       + chromium(P(PKG, "MSTeams_*", "LocalCache", "Microsoft", "MSTeams", "EBWebView"))
       + [P(PKG, "MSTeams_*", "LocalCache", "Microsoft", "MSTeams", "Logs")]),
    C_("slack", G_MSG, "Slack", electron(P(R, "Slack")) + [P(R, "Slack", "logs")]),
    C_("zoom", G_MSG, "Zoom — логи", [P(R, "Zoom", "logs"), P(R, "Zoom", "data", "Emojis")]),
    C_("signal", G_MSG, "Signal / Element / Session",
       electron(P(R, "Signal")) + [P(R, "Signal", "logs")] + electron(P(R, "Element"))
       + electron(P(R, "Session"))),
    C_("teamspeak", G_MSG, "TeamSpeak 3 / 5",
       [P(R, "TeamSpeak 3 Client", "cache"), P(R, "TeamSpeak 3 Client", "logs")]
       + electron(P(R, "TeamSpeak")) + [P(R, "TeamSpeak", "logs")]),
    C_("guilded", G_MSG, "Guilded / Revolt / Mattermost / Rocket.Chat",
       electron(P(R, "Guilded")) + electron(P(R, "Revolt")) + electron(P(R, "Mattermost"))
       + electron(P(R, "Rocket.Chat"))),
    C_("vkmsg", G_MSG, "VK Мессенджер / MAX", electron(P(R, "VK Messenger")) + electron(P(R, "vk-messenger"))
       + electron(P(R, "MAX")) + electron(P(L, "MAX", "User Data"))),

    # ======================= Игры и лаунчеры =======================
    C_("steam_web", G_GAME, "Steam — веб-кэш, логи, дампы",
       [P(L, "Steam", "htmlcache")]
       + ([P(STEAM, "appcache", "httpcache"), P(STEAM, "logs"), P(STEAM, "dumps"),
           P(STEAM, "depotcache")] if STEAM else []),
       note="Магазин и оверлей подгрузятся заново"),
    C_("steam_shaders", G_GAME, "Steam — кэш шейдеров игр (все библиотеки)",
       [P(lib, "steamapps", "shadercache") for lib in STEAM_LIBS], on=False,
       note="Пересоберутся; первые запуски игр могут подлагивать"),
    C_("steam_temp", G_GAME, "Steam — недокачанные и временные файлы",
       [P(lib, "steamapps", s) for lib in STEAM_LIBS for s in ("downloading", "temp")], on=False,
       note="Не включайте во время загрузки/обновления игры"),
    C_("epic", G_GAME, "Epic Games Launcher",
       [P(L, "EpicGamesLauncher", "Saved", s) for s in ("webcache*", "Logs", "Crashes")]
       + [P(PD, "Epic", "EpicGamesLauncher", "Data", "Logs")]),
    C_("battlenet", G_GAME, "Battle.net",
       [P(L, "Battle.net", "Cache"), P(L, "Battle.net", "BrowserCaches"), P(R, "Battle.net", "Logs"),
        P(L, "Blizzard Entertainment", "Battle.net", "Cache"), P(PD, "Battle.net", "Setup", "*", "Logs")]),
    C_("ea", G_GAME, "EA app / Origin",
       [P(L, "Electronic Arts", "EA Desktop", "CEF"), P(L, "Electronic Arts", "EA Desktop", "Logs"),
        P(PD, "EA Desktop", "Logs"), P(PD, "Origin", "Logs"), P(R, "Origin", "Logs"),
        P(L, "Origin", "QtWebEngine")]),
    C_("ubisoft", G_GAME, "Ubisoft Connect",
       [P(PF86, "Ubisoft", "Ubisoft Game Launcher", "cache", "http"),
        P(PF86, "Ubisoft", "Ubisoft Game Launcher", "logs"), P(L, "Ubisoft Game Launcher", "logs"),
        P(L, "Ubisoft Game Launcher", "cache")], admin=True),
    C_("gog", G_GAME, "GOG Galaxy", [P(PD, "GOG.com", "Galaxy", "webcache"), P(PD, "GOG.com", "Galaxy", "logs"),
                                    P(L, "GOG.com", "Galaxy", "Applications", "*", "Storage", "Cache")]),
    C_("riot", G_GAME, "Riot Client / League of Legends / VALORANT",
       [P(L, "Riot Games", "Riot Client", "Logs"), P(L, "Riot Games", "Riot Client", "Cache"),
        P(SD, "Riot Games", "League of Legends", "Logs"), P(L, "VALORANT", "Saved", "Logs"),
        P(L, "VALORANT", "Saved", "Crashes"), P(L, "VALORANT", "Saved", "webcache*")]),
    C_("rockstar", G_GAME, "Rockstar Games Launcher / Social Club",
       [P(L, "Rockstar Games", "Launcher", "webcache"), P(DOCS, "Rockstar Games", "Launcher", "*.log"),
        P(DOCS, "Rockstar Games", "Social Club", "*.log"), P(L, "Rockstar Games", "Social Club", "cache")]),
    C_("wargaming", G_GAME, "Wargaming / Lesta Game Center (Танки, Корабли)",
       [P(PD, v, "GameCenter", s) for v in ("Wargaming.net", "Lesta") for s in ("logs", "cache", "dumps")]
       + [P(L, v, "GameCenter", "cef_cache") for v in ("Wargaming.net", "Lesta")]),
    C_("xbox", G_GAME, "Xbox / Game Bar", [P(PKG, "Microsoft.GamingApp_*", "LocalCache"),
                                         P(PKG, "Microsoft.XboxApp_*", "LocalCache"),
                                         P(PKG, "Microsoft.XboxGamingOverlay_*", "LocalCache")]),
    C_("faceit", G_GAME, "FACEIT", electron(P(R, "FACEIT")) + [P(R, "FACEIT", "logs"), P(L, "FACEIT", "logs")]),
    C_("bsg", G_GAME, "Escape from Tarkov (BSG Launcher)",
       [P(R, "Battlestate Games", "BsgLauncher", "Logs"), P(L, "Battlestate Games", "BsgLauncher", "Logs"),
        P(R, "Battlestate Games", "BsgLauncher", "CefCache")]),
    C_("hoyo", G_GAME, "HoYoPlay / Genshin / Honkai / ZZZ — логи и веб-кэш",
       [P(R, "Cognosphere", "HYP", "*", "logs"), P(R, "Cognosphere", "HYP", "*", "webview2", "*", "Cache"),
        P(LL, "miHoYo", "*", "*.log"), P(LL, "Cognosphere", "*", "*.log")]),
    C_("unreal_games", G_GAME, "Игры на Unreal Engine — логи и краш-дампы",
       [P(L, "*", "Saved", "Logs"), P(L, "*", "Saved", "Crashes"), P(L, "*", "Saved", "webcache*")],
       note="Сохранения и настройки игр не трогаются (Fortnite, PUBG, Apex, Tarkov Arena…)"),
    C_("unity_games", G_GAME, "Игры на Unity — логи (Player.log)",
       [P(LL, "*", "*", "Player.log"), P(LL, "*", "*", "Player-prev.log"),
        P(LL, "*", "*", "output_log.txt")]),
    C_("roblox", G_GAME, "Roblox / Bloxstrap / Fishstrap",
       [P(L, "Roblox", "logs"), P(L, "Roblox", "Downloads"), P(L, "Roblox", "rbx-storage"),
        P(L, "Bloxstrap", "Logs"), P(L, "Fishstrap", "Logs"), P(L, "Bloxstrap", "Downloads")]),
    C_("minecraft", G_GAME, "Minecraft — логи, краш-репорты, веб-кэш",
       [P(R, ".minecraft", "logs"), P(R, ".minecraft", "crash-reports"), P(R, ".minecraft", "webcache2"),
        P(R, ".minecraft", "launcher_log*.txt"), P(R, ".minecraft", "debug")],
       note="Миры, моды и настройки не трогаются"),
    C_("mc_launchers", G_GAME, "Лаунчеры Minecraft (Lunar, Badlion, Feather, TLauncher, Prism…)",
       [P(H, ".lunarclient", "logs")] + electron(P(R, "lunarclient"))
       + [P(R, "Badlion Client", "logs")] + electron(P(R, "Badlion Client"))
       + electron(P(R, "feather")) + [P(R, ".feather", "logs")]
       + [P(R, ".tlauncher", "logs"), P(R, ".tlauncher", "cache")]
       + [P(R, "PrismLauncher", "logs"), P(R, "PrismLauncher", "cache"),
          P(R, "MultiMC", "logs"), P(R, "ModrinthApp", "caches"), P(R, "com.modrinth.theseus", "caches")]
       + [P(H, "curseforge", "minecraft", "Install", "logs")]),
    C_("overwolf", G_GAME, "Overwolf / CurseForge", [P(L, "Overwolf", "BrowserCache"), P(L, "Overwolf", "Log"),
                                                    P(L, "Overwolf", "ProcessCache")] + electron(P(R, "CurseForge"))),
    C_("medal", G_GAME, "Medal.tv / Outplayed", electron(P(R, "Medal")) + [P(L, "Medal", "logs")]
       + [P(L, "Overwolf", "Extensions", "*", "*", "logs")]),
    C_("shaders", G_GAME, "Кэш шейдеров видеокарты (DirectX / NVIDIA / AMD / Intel)",
       [P(L, "D3DSCache"), P(L, "NVIDIA", "DXCache"), P(L, "NVIDIA", "GLCache"),
        P(L, "NVIDIA Corporation", "NV_Cache"), P(L, "AMD", "DxCache"), P(L, "AMD", "DxcCache"),
        P(L, "AMD", "GLCache"), P(L, "AMD", "VkCache"), P(LL, "Intel", "ShaderCache")],
       on=False, note="Игры пересоберут шейдеры — первый запуск может подлагивать"),

    # ======================= Драйверы и железо =======================
    C_("drivers", G_HW, "Распакованные установщики драйверов (NVIDIA / AMD / Intel)",
       [P(SD, "NVIDIA"), P(SD, "AMD"), P(SD, "Intel", "Logs"), P(PD, "NVIDIA Corporation", "Downloader")],
       on=False, note="Остатки после установки драйверов, сами драйверы не трогаются"),
    C_("nvidia_app", G_HW, "NVIDIA App / GeForce Experience — кэш и логи",
       [P(L, "NVIDIA Corporation", "NVIDIA app", "CefCache"), P(L, "NVIDIA Corporation", "GeForceExperience", "CefCache"),
        P(PD, "NVIDIA Corporation", "NVIDIA app", "Logs"), P(PD, "NVIDIA Corporation", "GeForce Experience", "Logs"),
        P(PD, "NVIDIA Corporation", "umdlogs"), P(PD, "NVIDIA Corporation", "NvTelemetry")]),
    C_("amd_sw", G_HW, "AMD Adrenalin — логи и кэш",
       [P(L, "AMD", "CN", "*.log"), P(L, "AMD", "CN", "NewsFeed"), P(L, "AMD", "Radeonsoftware", "cache"),
        P(PD, "AMD", "PPC", "*.log")]),
    C_("logitech", G_HW, "Logitech G HUB — кэш и логи", [P(L, "LGHUB", "cache"), P(L, "LGHUB", "logs"),
                                                         P(PD, "LGHUB", "logs")]),
    C_("razer", G_HW, "Razer Synapse / Cortex — логи",
       [P(L, "Razer", "Synapse3", "Log"), P(PD, "Razer", "Synapse3", "Log"), P(PD, "Razer", "Synapse", "Logs"),
        P(L, "Razer", "Razer Cortex", "Logs"), P(PD, "Razer", "Installer", "Logs")]),
    C_("steelseries", G_HW, "SteelSeries GG / Corsair iCUE / HyperX — логи",
       [P(PD, "SteelSeries", "GG", "logs"), P(PD, "SteelSeries", "SteelSeries Engine 3", "logs"),
        P(L, "Corsair", "CUE*", "logs"), P(PD, "Corsair", "CUE*", "logs"), P(L, "HyperX", "logs")]),
    C_("asus_msi", G_HW, "ASUS Armoury Crate / MSI Center — логи",
       [P(PD, "ASUS", "ARMOURY CRATE Diagnosis"), P(PD, "ASUS", "ARMOURY CRATE Service", "Logs"),
        P(PD, "MSI", "MSI Center", "Logs"), P(PD, "MSI", "One Dragon Center", "Logs")], admin=True),

    # ======================= Медиа и стриминг =======================
    C_("spotify", G_MEDIA, "Spotify — кэш музыки",
       [P(L, "Spotify", "Storage"), P(L, "Spotify", "Data"), P(L, "Spotify", "Browser", "Cache"),
        P(PKG, "SpotifyAB.SpotifyMusic_*", "LocalCache", "Spotify", "Data")],
       on=False, note="Скачанные для офлайна треки придётся скачать заново"),
    C_("yamusic", G_MEDIA, "Яндекс Музыка / VK Музыка",
       electron(P(R, "YandexMusic")) + electron(P(R, "yandex-music")) + [P(PKG, "A025C540.Yandex.Music_*", "LocalCache")]
       + electron(P(R, "VK Music"))),
    C_("music_other", G_MEDIA, "Apple Music / iTunes / Deezer / Tidal / SoundCloud",
       [P(PKG, "AppleInc.AppleMusic*", "LocalCache"), P(L, "Apple Computer", "iTunes", "SubscriptionPlayCache")]
       + electron(P(R, "deezer-desktop")) + electron(P(R, "TIDAL")) + electron(P(R, "SoundCloud"))),
    C_("obs", G_MEDIA, "OBS Studio — логи и краш-отчёты",
       [P(R, "obs-studio", "logs"), P(R, "obs-studio", "crashes"), P(R, "obs-studio", "updates"),
        P(R, "obs-studio", "plugin_config", "obs-browser", "Cache"),
        P(R, "obs-studio", "plugin_config", "obs-browser", "GPUCache")]),
    C_("streamlabs", G_MEDIA, "Streamlabs / Twitch Studio",
       electron(P(R, "slobs-client")) + [P(R, "slobs-client", "node-obs", "logs"), P(R, "slobs-client", "logs")]
       + electron(P(R, "Twitch"))),
    C_("capcut", G_MEDIA, "CapCut — кэш", [P(L, "CapCut", "User Data", "Cache"), P(L, "CapCut", "User Data", "Log"),
                                          P(L, "JianyingPro", "User Data", "Cache")],
       note="Проекты и черновики не трогаются"),
    C_("adobe", G_MEDIA, "Adobe — медиа-кэш и логи",
       [P(R, "Adobe", "Common", "Media Cache Files"), P(R, "Adobe", "Common", "Media Cache"),
        P(L, "Adobe", "*", "Cache"), P(L, "Adobe", "OOBE", "*.log"), P(L, "Temp", "Adobe")],
       on=False, note="Premiere/After Effects пересоздадут при открытии проектов"),
    C_("davinci", G_MEDIA, "DaVinci Resolve — логи", [P(R, "Blackmagic Design", "DaVinci Resolve", "Support", "logs")]),
    C_("design", G_MEDIA, "Figma / Canva / Krita / Blender — кэш",
       electron(P(R, "Figma")) + [P(L, "Figma", "Cache"), P(L, "Figma", "DesktopProfile", "*", "Cache")]
       + electron(P(R, "Canva")) + [P(L, "krita.log"), P(R, "Blender Foundation", "Blender", "*", "cache")]),
    C_("players", G_MEDIA, "VLC / Kodi / Plex / Stremio — кэш",
       [P(R, "vlc", "art"), P(R, "Kodi", "temp"), P(R, "Kodi", "userdata", "Thumbnails"),
        P(L, "Plex Media Server", "Cache"), P(L, "Plex Media Server", "Logs"), P(L, "Plex", "Cache")]
       + electron(P(R, "stremio")) + [P(R, "stremio", "stremio-server", "stremio-cache")]),
    C_("screens", G_MEDIA, "ShareX / Lightshot / Bandicam — логи",
       [P(DOCS, "ShareX", "Logs"), P(L, "Skillbrains", "lightshot", "*.log"), P(DOCS, "Bandicam", "*.log")]),

    # ======================= Офис, облака, утилиты =======================
    C_("office", G_OFF, "Microsoft Office — телеметрия и кэш надстроек",
       [P(L, "Microsoft", "Office", "OTele"), P(L, "Microsoft", "Office", "16.0", "Wef"),
        P(L, "Microsoft", "Office", "16.0", "Floodgate")]),
    C_("onedrive", G_OFF, "OneDrive / Google Drive / Dropbox / Яндекс Диск — логи",
       [P(L, "Microsoft", "OneDrive", "logs"), P(L, "Microsoft", "OneDrive", "setup", "logs"),
        P(L, "Google", "DriveFS", "Logs"), P(L, "Google", "DriveFS", "crash_dumps"),
        P(H, "Dropbox", ".dropbox.cache"), P(R, "Yandex", "YandexDisk*", "log*")]),
    C_("notes", G_OFF, "Notion / Obsidian / Evernote / Todoist",
       electron(P(R, "Notion")) + [P(R, "Notion", "logs")] + electron(P(R, "obsidian"))
       + electron(P(R, "Evernote")) + electron(P(R, "Todoist"))),
    C_("acrobat", G_OFF, "Adobe Acrobat / Foxit — кэш",
       [P(L, "Adobe", "Acrobat", "DC", "Cache"), P(LL, "Adobe", "Acrobat", "DC", "Cache"),
        P(L, "Adobe", "AcroCef", "DC", "Acrobat", "Cache"), P(L, "Foxit Software", "*", "Cache")]),
    C_("onec", G_OFF, "1С:Предприятие — кэш",
       [P(L, "1C", "1cv8", "*-*-*-*-*"), P(R, "1C", "1cv8", "*-*-*-*-*")], on=False,
       note="Закройте 1С. Кэш метаданных пересоздастся, базы не трогаются"),
    C_("remote", G_OFF, "AnyDesk / TeamViewer / Parsec / RustDesk — логи",
       [P(R, "AnyDesk", "thumbnails"), P(R, "AnyDesk", "*.trace"), P(R, "TeamViewer", "*.log"),
        P(R, "Parsec", "log*.txt"), P(R, "RustDesk", "log")]),
    C_("torrents", G_OFF, "qBittorrent / uTorrent / BitTorrent — логи и мусор",
       [P(L, "qBittorrent", "logs"), P(R, "uTorrent", "updates"), P(R, "uTorrent", "dlimagecache"),
        P(R, "BitTorrent", "updates"), P(R, "BitTorrent", "dlimagecache")]),
    C_("java", G_OFF, "Java — кэш апплетов и логи",
       [P(LL, "Sun", "Java", "Deployment", "cache"), P(LL, "Sun", "Java", "Deployment", "log")]),
    C_("password", G_OFF, "Bitwarden / 1Password / KeePassXC — кэш интерфейса",
       electron(P(R, "Bitwarden")) + [P(L, "1Password", "logs")]),
    C_("archivers", G_OFF, "WinRAR / 7-Zip / Bandizip — временные папки",
       [P(USER_TEMP, "Rar$*"), P(USER_TEMP, "7z*"), P(L, "Bandizip", "Temp")], age=True),

    # ======================= Разработка =======================
    C_("vscode", G_DEV, "VS Code / Cursor / Windsurf — кэш и логи",
       [p for a in ("Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium") for p in
        electron(P(R, a)) + [P(R, a, "CachedData"), P(R, a, "CachedExtensionVSIXs"), P(R, a, "logs")]],
       note="Настройки и расширения не трогаются"),
    C_("jetbrains", G_DEV, "JetBrains IDE / Android Studio — кэши и логи",
       [P(L, "JetBrains", "*", s) for s in ("caches", "log", "tmp")]
       + [P(L, "Google", "AndroidStudio*", s) for s in ("caches", "log", "tmp")] + [P(H, ".android", "cache")],
       on=False, note="IDE заново проиндексирует проекты"),
    C_("visualstudio", G_DEV, "Visual Studio — кэш компонентов и телеметрия",
       [P(L, "Microsoft", "VisualStudio", "*", "ComponentModelCache"),
        P(L, "Microsoft", "VisualStudio", "*", "Designer", "ShadowCache"),
        P(L, "Microsoft", "VSApplicationInsights"), P(L, "Microsoft", "VSCommon", "*", "SQM"),
        P(PD, "Microsoft", "VisualStudio", "Packages", "_bootstrapper")]),
    C_("dev", G_DEV, "pip / npm / yarn / pnpm / NuGet http / go-build",
       [P(L, "pip", "cache"), P(L, "npm-cache"), P(L, "Yarn", "Cache"), P(L, "NuGet", "v3-cache"),
        P(L, "pnpm-cache"), P(L, "pnpm", "store"), P(L, "go-build")],
       on=False, note="Пакеты скачаются заново при следующей установке"),
    C_("py_tools", G_DEV, "uv / Poetry / pipenv / conda pkgs",
       [P(L, "uv", "cache"), P(L, "pypoetry", "Cache"), P(L, "pipenv", "Cache"),
        P(H, "anaconda3", "pkgs"), P(H, "miniconda3", "pkgs"), P(H, ".conda", "pkgs")], on=False),
    C_("js_tools", G_DEV, "Bun / Deno / Electron / node-gyp кэши",
       [P(H, ".bun", "install", "cache"), P(L, "deno"), P(L, "electron", "Cache"),
        P(L, "electron-builder", "Cache"), P(L, "node-gyp", "Cache"), P(H, ".npm", "_cacache")], on=False),
    C_("gradle", G_DEV, "Gradle — кэши и логи демона",
       [P(H, ".gradle", "caches"), P(H, ".gradle", "daemon"), P(H, ".gradle", "wrapper", "dists")],
       on=False, note="Следующая сборка скачает зависимости заново (долго)"),
    C_("maven", G_DEV, "Maven — локальный репозиторий (.m2)", [P(H, ".m2", "repository")], on=False,
       note="Зависимости скачаются заново при сборке"),
    C_("cargo", G_DEV, "Rust Cargo — кэш реестра", [P(H, ".cargo", "registry", "cache"),
                                                    P(H, ".cargo", "git", "db")], on=False),
    C_("go_mod", G_DEV, "Go — кэш модулей", [P(H, "go", "pkg", "mod", "cache")], on=False),
    C_("nuget_pkgs", G_DEV, ".NET NuGet — глобальные пакеты", [P(H, ".nuget", "packages")], on=False),
    C_("browsers_test", G_DEV, "Playwright / Puppeteer / Cypress — браузеры для тестов",
       [P(L, "ms-playwright"), P(H, ".cache", "puppeteer"), P(L, "Cypress", "Cache")], on=False),
    C_("ml_models", G_DEV, "Hugging Face / PyTorch / Ollama — кэш моделей",
       [P(H, ".cache", "huggingface"), P(H, ".cache", "torch")], on=False,
       note="Модели скачаются заново — бывают десятки ГБ"),
    C_("unity_dev", G_DEV, "Unity Editor / Unity Hub — кэш и логи",
       [P(L, "Unity", "cache"), P(L, "Unity", "Editor", "*.log"), P(R, "UnityHub", "logs")]
       + electron(P(R, "UnityHub"))),
    C_("unreal_ddc", G_DEV, "Unreal Engine — DerivedDataCache", [P(L, "UnrealEngine", "Common", "DerivedDataCache")],
       on=False, note="Шейдеры проектов пересоберутся (долго)"),
    C_("dev_apps", G_DEV, "Postman / GitHub Desktop / Insomnia / Docker — кэш и логи",
       electron(P(R, "Postman")) + electron(P(R, "GitHub Desktop")) + [P(R, "GitHub Desktop", "logs")]
       + electron(P(R, "Insomnia")) + [P(L, "Docker", "log"), P(L, "Docker", "wsl", "main", "log")]),
    C_("pkg_managers", G_DEV, "Scoop / winget / Chocolatey — кэш загрузок",
       [P(H, "scoop", "cache"), P(PKG, "Microsoft.DesktopAppInstaller_*", "LocalState", "DiagOutputDir"),
        P(PD, "chocolatey", "logs"), P(L, "Temp", "chocolatey")]),
    C_("composer", G_DEV, "Composer / Gem / CocoaPods-подобные кэши",
       [P(L, "Composer"), P(H, ".gem", "specs"), P(L, "vcpkg", "archives")], on=False),

    # ======================= Прочее =======================
    C_("electron_other", G_ETC, "Прочие Electron/Chromium-программы — кэш",
       [P(R, "*", s) for s in ("Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache")]
       + [P(R, "*", "Crashpad", "reports"), P(L, "*", "User Data", "*", "Cache"),
          P(L, "*", "User Data", "*", "Code Cache")],
       exclude_claimed=True, on=False,
       note="Всё, что не попало в списки выше; найдено автоматически"),
    C_("crashpad", G_ETC, "Краш-отчёты программ (Crashpad / CrashReports)",
       [P(L, "*", "Crashpad", "reports"), P(L, "*", "CrashReports"), P(R, "*", "CrashReports"),
        P(L, "*", "*", "Crashpad", "reports")], exclude_claimed=True),
]


def resolve_paths(patterns):
    out, seen = [], set()
    for p in patterns:
        found = glob.glob(p) if any(c in p for c in "*?[") else ([p] if os.path.exists(p) else [])
        for f in found:
            k = norm(f)
            if k not in seen:
                seen.add(k)
                out.append(f)
    return out


def cat_paths(cat):
    """Реальные пути категории. exclude_claimed — без путей, уже занятых другими категориями
    и без папок внутри защищённых/системных мест, которые ведут другие категории."""
    paths = resolve_paths(cat["paths"])
    if cat.get("exclude_claimed") and paths:
        claimed = set()
        for other in CATEGORIES:
            if other is not cat and not other.get("exclude_claimed"):
                claimed.update(norm(p) for p in resolve_paths(other["paths"]))
        paths = [p for p in paths if norm(p) not in claimed
                 and not any(norm(p).startswith(c + os.sep) for c in claimed)]
    return paths


def cat_found(cat):
    return cat.get("kind") in ("recycle", "evtlog") or bool(cat_paths(cat))


def category_process(cat, cutoff, stop, dry):
    """Считает (dry=True) или чистит категорию. Возвращает (байт, файлов, ошибок, примечание)."""
    kind = cat.get("kind", "dir")
    if kind == "recycle":
        size, items = recycle_bin_info()
        if not dry and items:
            empty_recycle_bin()
            after, _ = recycle_bin_info()
            return size - after, items, 0, ""
        return size, items, 0, ""
    if kind == "evtlog":
        logs = cat["paths"][0]
        before, n = dir_size(logs)
        if dry:
            note = "" if before or is_admin() else "нужны права администратора для подсчёта"
            return before, n, 0, note
        ps = ("$s=[System.Diagnostics.Eventing.Reader.EventLogSession]::GlobalSession;"
              "$ok=0;$bad=0;foreach($n in $s.GetLogNames()){try{$s.ClearLog($n);$ok++}catch{$bad++}};"
              "Write-Output \"$ok $bad\"")
        try:
            r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                               capture_output=True, text=True, timeout=600,
                               creationflags=CREATE_NO_WINDOW)
            parts = (r.stdout.strip().split() + ["0", "0"])[:2]
            ok, bad = int(parts[0]), int(parts[1])
        except Exception as ex:
            return 0, 0, 1, f"ошибка: {ex}"
        after, _ = dir_size(logs)
        return max(0, before - after), ok, bad, f"очищено журналов: {ok}, пропущено: {bad}"

    if cat.get("to_bin"):
        # личные файлы: верхний уровень папки целиком в Корзину (можно вернуть)
        items = []
        for p in cat_paths(cat):
            try:
                entries = list(os.scandir(p)) if os.path.isdir(p) else []
            except OSError:
                continue
            for e in entries:
                try:
                    if e.is_dir(follow_symlinks=False):
                        sz, n = dir_size(e.path, stop)
                    else:
                        sz, n = e.stat(follow_symlinks=False).st_size, 1
                except OSError:
                    continue
                items.append((e.path, sz, n))
        total = sum(s for _, s, _ in items)
        files = sum(n for _, _, n in items)
        if dry or not items:
            return total, files, 0, ""
        send_to_recycle_bin([p for p, _, _ in items])
        freed = sum(s for p, s, _ in items if not os.path.lexists(p))
        failed = sum(1 for p, _, _ in items if os.path.lexists(p))
        return freed, files, failed, "перемещено в Корзину"

    freed = count = errs = 0
    use_cutoff = cutoff if cat.get("age") else None
    for p in cat_paths(cat):
        if stop.is_set():
            break
        if os.path.isdir(p):
            f, c, e = clean_dir(p, use_cutoff, stop, dry)
        else:
            try:
                st = os.stat(p)
                if use_cutoff and st.st_mtime > use_cutoff:
                    continue
                if not dry:
                    force_unlink(p)
                f, c, e = st.st_size, 1, 0
            except OSError:
                f, c, e = 0, 0, 1
        freed += f
        count += c
        errs += e
    note = ""
    if cat.get("admin") and not is_admin() and errs:
        note = "часть недоступна без прав администратора"
    return freed, count, errs, note


# --------------------------------------------------------------------------
# Поиск мусора (эвристики)
# --------------------------------------------------------------------------
HIGH, MID, LOW = "высокая", "средняя", "низкая"
CONF_RANK = {HIGH: 0, MID: 1, LOW: 2}

EXT_TEMP = {".tmp", ".temp", ".chk", ".gid", ".~mp", "._mp", ".$$$", ".wbk", ".xlk",
            ".syd", ".dmp", ".mdmp", ".hdmp", ".fts", ".ftg"}
EXT_PARTIAL = {".crdownload", ".partial", ".part", ".download", ".opdownload"}
EXT_BACKUP = {".bak", ".old", ".prv", ".backup", ".bk", ".sav~"}
EXT_LOG = {".log", ".etl", ".err", ".trace"}
JUNK_NAMES = {"thumbs.db", "ehthumbs.db", "ehthumbs_vista.db", ".ds_store", "._.ds_store"}
EXT_INSTALLER = {".exe", ".msi", ".msix", ".msixbundle", ".appx", ".iso", ".zip", ".rar", ".7z"}
ZERO_OK_NAMES = {"__init__.py", "py.typed", ".gitkeep", ".keep", ".nomedia", "lock", ".lock"}
CODE_EXT = {".py", ".js", ".ts", ".java", ".kt", ".cs", ".c", ".h", ".cpp", ".rs", ".go",
            ".json", ".md", ".txt", ".cfg", ".ini", ".toml", ".yml", ".yaml", ".gitignore"}


class JunkItem:
    __slots__ = ("path", "size", "reason", "conf", "is_dir", "checked", "group", "mtime")

    def __init__(self, path, size, reason, conf, is_dir=False, group="", mtime=None):
        self.path, self.size, self.reason, self.conf = path, size, reason, conf
        self.is_dir, self.group, self.mtime = is_dir, group, mtime
        self.checked = conf == HIGH


def file_hash(path, stop, partial=False):
    h = hashlib.blake2b(digest_size=20)
    try:
        with open(path, "rb") as f:
            if partial:
                h.update(f.read(65536))
                try:
                    f.seek(-65536, os.SEEK_END)
                except OSError:
                    pass
                h.update(f.read(65536))
            else:
                while True:
                    if stop.is_set():
                        return None
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


# ---- копии вида «файл (2)», «файл - Копия», «Copy of файл», «файл — копія» … ----
COPY_WORDS = [
    "copy", "копия", "копiя", "копія", "копіа", "копија", "копие", "копі", "kopie", "copie", "copia",
    "cópia", "còpia", "kopia", "kopya", "kopio", "kopi", "kopija", "kópia", "másolat", "αντίγραφο",
    "副本", "复制", "複製", "コピー", "복사본", "salinan", "bản sao", "สำเนา", "نسخة", "העתק", "rücksicherung",
]
_CW = "|".join(re.escape(w) for w in sorted(COPY_WORDS, key=len, reverse=True))
RE_COPY_SUFFIX = re.compile(rf"^(?P<base>.+?)(?:\s*[-_–—.]\s*|\s+)\(?(?:{_CW})\)?(?:\s*\(?\d{{1,3}}\)?)?$", re.I)
RE_COPY_PREFIX = re.compile(
    rf"^(?:{_CW})(?:\s*\(\d{{1,3}}\))?(?:\s+(?:of|de|von|di|van|du|da|z|ze|от|з|із|из|на))?\s+(?P<base>.+)$", re.I)
RE_COPY_NUM = re.compile(r"^(?P<base>.+?)\s?\((?P<n>\d{1,3})\)$")
RE_COPY_CJK = re.compile(rf"^(?P<base>.+?)\s*[-_ ]?(?:{_CW})(?:\s*\(?\d{{1,3}}\)?)?$", re.I)


def copy_base(stem):
    """Имя оригинала для «похоже на копию» или None."""
    for rx in (RE_COPY_SUFFIX, RE_COPY_PREFIX, RE_COPY_NUM):
        m = rx.match(stem)
        if m:
            base = m.group("base").strip(" -_.")
            if base:
                return base
    m = RE_COPY_CJK.match(stem)  # 副本 / コピー пишутся слитно
    if m and any(ord(ch) > 0x2E80 for ch in stem[len(m.group("base")):]):
        base = m.group("base").strip(" -_.")
        if base:
            return base
    return None


def classify_copy(path, name, size, stop):
    stem, ext = os.path.splitext(name)
    base = copy_base(stem)
    if not base:
        return None
    d = os.path.dirname(path)
    orig = os.path.join(d, base + ext)
    if os.path.normcase(orig) != os.path.normcase(path) and os.path.isfile(orig):
        try:
            osz = os.path.getsize(orig)
        except OSError:
            osz = -1
        if osz == size:
            big = size > 512 * 1024 * 1024
            if file_hash(orig, stop, partial=big) == file_hash(path, stop, partial=big):
                return JunkItem(path, size, f"точная копия файла «{base + ext}» (лежит рядом)", HIGH if not big else MID)
        return JunkItem(path, size, f"копия «{base + ext}», но содержимое отличается", LOW)
    return JunkItem(path, size, "похоже на копию (оригинала рядом нет)", LOW)


def junk_scan(roots, opts, stop, report, progress):
    """report(JunkItem), progress(text). opts — dict настроек."""
    now = time.time()
    day = 86400
    by_size = {}
    dup_min = opts["dup_min_mb"] * 1024 * 1024
    big_min = opts["big_min_mb"] * 1024 * 1024
    inst_age = opts["installer_days"] * day
    downloads_n = norm(DOWNLOADS)
    lnk_files = []
    tree = {}  # dir -> [файлов, [поддиректории]]
    root_set = {norm(r) for r in roots}
    home_n = norm(HOME)
    scanned = 0
    last_tick = 0

    stack = [r for r in roots if os.path.isdir(r) and not is_protected(r)]
    while stack:
        if stop.is_set():
            return
        d = stack.pop()
        node = tree.setdefault(d, [0, []])
        try:
            entries = list(os.scandir(d))
        except OSError:
            node[0] += 1  # недоступна — не считаем пустой
            continue
        for e in entries:
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                node[0] += 1
                continue
            if is_reparse(st):
                node[0] += 1
                continue
            name_l = e.name.lower()
            if stat.S_ISDIR(st.st_mode):
                if name_l in SKIP_DIR_NAMES or is_protected(e.path):
                    node[0] += 1
                    continue
                node[1].append(e.path)
                stack.append(e.path)
                continue
            node[0] += 1
            scanned += 1
            if scanned - last_tick >= 2000:
                last_tick = scanned
                progress(f"Просмотрено файлов: {scanned:,}  ·  {d}".replace(",", " "))
            size = st.st_size
            ext = os.path.splitext(name_l)[1]
            age = now - st.st_mtime
            days = int(age // day)
            item = None

            if opts["temp"]:
                if ext in EXT_TEMP or name_l in JUNK_NAMES:
                    item = JunkItem(e.path, size, "временный/служебный файл", HIGH)
                elif name_l.startswith("~$") and age > day:
                    item = JunkItem(e.path, size, "забытый lock-файл Office", HIGH)
                elif ext in EXT_PARTIAL and age > 2 * day:
                    item = JunkItem(e.path, size, f"недокачанная загрузка ({days} дн.)", HIGH)
            if item is None and opts.get("copies"):
                item = classify_copy(e.path, e.name, size, stop)
            if item is None and opts["backup"]:
                if ext in EXT_BACKUP or name_l.endswith("~"):
                    item = JunkItem(e.path, size, "резервная копия / старая версия", MID)
                elif ext in EXT_LOG and age > 7 * day:
                    item = JunkItem(e.path, size, f"старый лог ({days} дн.)", MID)
            if item is None and opts["zero"] and size == 0:
                if not (name_l in ZERO_OK_NAMES or name_l.startswith(".") or ext in CODE_EXT):
                    item = JunkItem(e.path, size, "пустой файл (0 байт)", LOW)
            if item is None and opts["installers"] and ext in EXT_INSTALLER and age > inst_age:
                if norm(d).startswith(downloads_n):
                    item = JunkItem(e.path, size, f"старый установщик/архив в Загрузках ({days} дн.)", MID)
            if item is None and opts["lnk"] and ext == ".lnk":
                lnk_files.append(e.path)
            if item is None and opts["big"] and size >= big_min:
                item = JunkItem(e.path, size, "большой файл — проверьте, нужен ли", LOW)

            if item is not None:
                report(item)
            elif opts["dups"] and size >= dup_min:
                by_size.setdefault(size, []).append((e.path, st.st_mtime))

    # ---- пустые папки (снизу вверх; отмечаем только верхнюю пустую) ----
    if opts["empty"] and not stop.is_set():
        progress("Ищу пустые папки…")
        empty = {}
        for dpath in sorted(tree, key=len):  # родители раньше детей
            pn = norm(dpath)
            if pn in root_set or norm(os.path.dirname(dpath)) == home_n:
                continue
            parent = os.path.dirname(dpath)
            if empty.get(parent) and norm(parent) not in root_set:
                empty[dpath] = True
                continue
            # итеративно, чтобы не упереться в рекурсию
            order, st_ = [], [dpath]
            while st_:
                x = st_.pop()
                if x in empty:
                    continue
                order.append(x)
                st_.extend(tree.get(x, [0, []])[1])
            for x in reversed(order):
                node = tree.get(x)
                empty[x] = node is not None and node[0] == 0 and all(empty.get(c, False) for c in node[1])
            if empty[dpath]:
                report(JunkItem(dpath, 0, "пустая папка", MID, is_dir=True))

    # ---- битые ярлыки ----
    if opts["lnk"] and not stop.is_set():
        progress("Проверяю ярлыки…")
        extra = [ROAMING / "Microsoft" / "Windows" / "Start Menu",
                 PROGDATA / "Microsoft" / "Windows" / "Start Menu",
                 Path(ENV.get("PUBLIC", r"C:\Users\Public")) / "Desktop"]
        seen = {norm(x) for x in lnk_files}
        for root in extra:
            for x in glob.glob(str(root / "**" / "*.lnk"), recursive=True):
                if norm(x) not in seen:
                    seen.add(norm(x))
                    lnk_files.append(x)
        for x in lnk_files:
            if stop.is_set():
                return
            t = lnk_target(x)
            if t and drive_is_fixed(t) and os.path.exists(os.path.splitdrive(t)[0] + "\\") \
                    and not os.path.exists(t):
                try:
                    sz = os.path.getsize(x)
                except OSError:
                    sz = 0
                report(JunkItem(x, sz, f"битый ярлык → {t}", HIGH))

    # ---- дубликаты: размер → частичный хэш → полный хэш ----
    if opts["dups"] and not stop.is_set():
        groups = [v for v in by_size.values() if len(v) > 1]
        total = len(groups)
        gid = 0
        for gi, files in enumerate(groups):
            if stop.is_set():
                return
            if gi % 20 == 0:
                progress(f"Сравниваю дубликаты: группа {gi + 1}/{total}")
            part = {}
            for p, mt in files:
                hsh = file_hash(p, stop, partial=True)
                if hsh:
                    part.setdefault(hsh, []).append((p, mt))
            for cand in part.values():
                if len(cand) < 2:
                    continue
                full = {}
                for p, mt in cand:
                    hsh = file_hash(p, stop)
                    if hsh:
                        full.setdefault(hsh, []).append((p, mt))
                for same in full.values():
                    if len(same) < 2:
                        continue
                    gid += 1
                    same.sort(key=lambda t: (t[1], len(t[0])))  # оригинал — самый старый
                    keep = same[0][0]
                    size = os.path.getsize(keep)
                    for p, _ in same[1:]:
                        report(JunkItem(p, size, f"дубликат: {keep}", MID, group=f"#{gid}"))
    progress(f"Готово. Просмотрено файлов: {scanned:,}".replace(",", " "))


# --------------------------------------------------------------------------
# Бесполезные файлы (давно не открывались)
# --------------------------------------------------------------------------
FILE_TYPES = {
    "video": ("Видео", {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg", ".ts",
                        ".3gp", ".vob"}),
    "audio": ("Музыка и звук", {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".opus", ".aiff"}),
    "images": ("Картинки", {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".heic", ".raw",
                            ".cr2", ".nef", ".psd", ".svg", ".ico"}),
    "docs": ("Документы", {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".txt",
                           ".rtf", ".epub", ".djvu", ".fb2", ".csv"}),
    "archives": ("Архивы и образы", {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso", ".img", ".cab",
                                     ".vhd", ".vhdx"}),
    "installers": ("Установщики", {".exe", ".msi", ".msix", ".msixbundle", ".appx", ".apk", ".jar"}),
    "torrents": ("Торренты", {".torrent"}),
}


def file_type(ext):
    for key, (_, exts) in FILE_TYPES.items():
        if ext in exts:
            return key
    return "other"


def last_access_state():
    """True — Windows обновляет дату последнего открытия, False — нет, None — неизвестно."""
    try:
        r = subprocess.run(["fsutil", "behavior", "query", "disablelastaccess"], capture_output=True,
                           text=True, timeout=5, creationflags=CREATE_NO_WINDOW)
        m = re.search(r"=\s*(\d)", r.stdout)
        if m:
            return int(m.group(1)) in (0, 2)
    except Exception:
        pass
    return None


def unused_scan(roots, opts, stop, report, progress):
    now = time.time()
    days = max(1, int(opts.get("days", 180)))
    cutoff = now - days * 86400
    min_size = max(0, float(opts.get("min_mb", 10))) * 1024 * 1024
    types = set(opts.get("types") or FILE_TYPES.keys())
    use_atime = opts.get("use_atime", True)
    scanned = 0
    stack = [r for r in roots if os.path.isdir(r) and not is_protected(r)]
    while stack:
        if stop.is_set():
            return
        d = stack.pop()
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        for e in entries:
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            if is_reparse(st):
                continue
            if stat.S_ISDIR(st.st_mode):
                if e.name.lower() not in SKIP_DIR_NAMES and not is_protected(e.path):
                    stack.append(e.path)
                continue
            scanned += 1
            if scanned % 3000 == 0:
                progress(f"Просмотрено файлов: {scanned:,}  ·  {d}".replace(",", " "))
            if st.st_size < min_size:
                continue
            t = file_type(os.path.splitext(e.name)[1].lower())
            if t not in types:
                continue
            last = max(st.st_atime, st.st_mtime) if use_atime else st.st_mtime
            if last >= cutoff:
                continue
            ago = int((now - last) // 86400)
            label = FILE_TYPES[t][0] if t in FILE_TYPES else "Файл"
            when = time.strftime("%d.%m.%Y", time.localtime(last))
            verb = "не открывался" if use_atime else "не менялся"
            it = JunkItem(e.path, st.st_size, f"{label}: {verb} {ago} дн. (с {when})",
                          MID if ago > days * 2 else LOW)
            it.checked = False
            report(it)
    progress(f"Готово. Просмотрено файлов: {scanned:,}".replace(",", " "))


# --------------------------------------------------------------------------
# Диски
# --------------------------------------------------------------------------
def volume_info(root):
    name = ctypes.create_unicode_buffer(261)
    fs = ctypes.create_unicode_buffer(261)
    try:
        ok = ctypes.windll.kernel32.GetVolumeInformationW(root, name, 261, None, None, None, fs, 261)
        if ok:
            return name.value, fs.value
    except Exception:
        pass
    return "", ""


_PHYS_CACHE = {}


def physical_info():
    """Буква -> модель, тип (SSD/HDD), шина, состояние. Через Storage-модуль PowerShell."""
    if _PHYS_CACHE.get("t", 0) > time.time() - 60:
        return _PHYS_CACHE["v"]
    ps = ("[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
          "$r=@(); foreach($p in (Get-Partition | Where-Object DriveLetter)){"
          "$d=Get-Disk -Number $p.DiskNumber;"
          "$ph=Get-PhysicalDisk | Where-Object DeviceId -eq ([string]$p.DiskNumber);"
          "$t=$null; $w=$null; try{$c=$ph|Get-StorageReliabilityCounter; $t=$c.Temperature; $w=$c.Wear}catch{};"
          "$r+=[pscustomobject]@{L=[string]$p.DriveLetter;Model=$d.FriendlyName;Media=[string]$ph.MediaType;"
          "Bus=[string]$d.BusType;Health=[string]$d.HealthStatus;Size=$d.Size;Temp=$t;Wear=$w}};"
          "$r | ConvertTo-Json -Compress")
    out = {}
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True,
                           timeout=40, creationflags=CREATE_NO_WINDOW)
        data = json.loads(r.stdout.decode("utf-8", "ignore") or "[]")
        if isinstance(data, dict):
            data = [data]
        for x in data:
            media = (x.get("Media") or "")
            bus = (x.get("Bus") or "")
            kind = "SSD" if media == "SSD" or bus == "NVMe" else ("HDD" if media == "HDD" else
                                                                ("USB" if bus == "USB" else "Диск"))
            if bus == "NVMe":
                kind = "SSD NVMe"
            health = {"Healthy": "Исправен", "Warning": "Есть предупреждения",
                      "Unhealthy": "Неисправен"}.get(x.get("Health") or "", x.get("Health") or "—")
            out[(x.get("L") or "").upper()] = dict(model=x.get("Model") or "", kind=kind, bus=bus,
                                                   health=health, temp=x.get("Temp"), wear=x.get("Wear"))
    except Exception:
        pass
    _PHYS_CACHE.update(t=time.time(), v=out)
    return out


def drives_quick():
    out = []
    for root in fixed_drives():
        try:
            u = shutil.disk_usage(root)
        except OSError:
            continue
        out.append(dict(root=root, letter=root[0], total=u.total, free=u.free, used=u.used))
    return out


def disks_info():
    phys = physical_info()
    out = []
    for d in drives_quick():
        label, fs = volume_info(d["root"])
        p = phys.get(d["letter"], {})
        d.update(label=label, fs=fs, model=p.get("model", ""), kind=p.get("kind", "Диск"),
                 bus=p.get("bus", ""), health=p.get("health", "—"), temp=p.get("temp"), wear=p.get("wear"),
                 system=norm(d["root"]) == norm(SYSDRIVE))
        out.append(d)
    return out


# --------------------------------------------------------------------------
# Хранилище: настройки и история (рядом с exe — портативно)
# --------------------------------------------------------------------------
def app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def resource_dir():
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def _data_file():
    for d in (app_dir(), str(LOCAL / "Chistilshik")):
        try:
            os.makedirs(d, exist_ok=True)
            test = os.path.join(d, ".write_test")
            with open(test, "w") as f:
                f.write("1")
            os.remove(test)
            return os.path.join(d, "cleaner_data.json")
        except OSError:
            continue
    return None


class Store:
    def __init__(self):
        self.path = _data_file()
        self.lock = threading.Lock()
        self.data = {"settings": {"show_wizard": True}, "history": [], "first_run": time.time()}
        if self.path and os.path.exists(self.path):
            try:
                with open(self.path, encoding="utf-8") as f:
                    loaded = json.load(f)
                self.data.update(loaded)
                self.data.setdefault("settings", {}).setdefault("show_wizard", True)
            except Exception:
                pass
        self.session_freed = 0
        self.session_binned = 0

    def save(self):
        if not self.path:
            return
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
        except OSError:
            pass

    def record(self, source, what, freed, binned=False, files=0):
        if freed <= 0:
            return
        with self.lock:
            self.data["history"].append(dict(t=time.time(), source=source, what=what, bytes=int(freed),
                                             binned=bool(binned), files=int(files)))
            self.data["history"] = self.data["history"][-5000:]
            if binned:
                self.session_binned += freed
            else:
                self.session_freed += freed
            self.save()

    def stats(self):
        h = self.data["history"]
        freed = [x for x in h if not x.get("binned")]
        by = {}
        for x in freed:
            by[x["what"]] = by.get(x["what"], 0) + x["bytes"]
        by_day = {}
        for x in freed:
            k = time.strftime("%Y-%m-%d", time.localtime(x["t"]))
            by_day[k] = by_day.get(k, 0) + x["bytes"]
        sessions = len({time.strftime("%Y-%m-%d %H", time.localtime(x["t"])) for x in h})
        return dict(total=sum(x["bytes"] for x in freed), binned=sum(x["bytes"] for x in h if x.get("binned")),
                    files=sum(x.get("files", 0) for x in h), runs=sessions,
                    session=self.session_freed, session_binned=self.session_binned,
                    by_what=sorted(({"what": k, "bytes": v} for k, v in by.items()), key=lambda z: -z["bytes"])[:12],
                    by_day=sorted(({"day": k, "bytes": v} for k, v in by_day.items()))[-30:],
                    history=list(reversed(h[-300:])), first_run=self.data.get("first_run"))

    def reset(self):
        with self.lock:
            self.data["history"] = []
            self.session_freed = self.session_binned = 0
            self.save()


# --------------------------------------------------------------------------
# Фоновые задачи + события для веб-интерфейса
# --------------------------------------------------------------------------
class Tasks:
    def __init__(self):
        self.lock = threading.Lock()
        self.events = []
        self.seq = 0
        self.running = None
        self.stop = threading.Event()
        self.lists = {"junk": {}, "unused": {}, "dups": {}}
        self.next_id = 0
        self.found = None

    def emit(self, _etype, **data):
        with self.lock:
            self.seq += 1
            data["type"] = _etype
            data["seq"] = self.seq
            self.events.append(data)
            if len(self.events) > 30000:
                self.events = self.events[-20000:]

    def log(self, text):
        self.emit("log", text=time.strftime("[%H:%M:%S] ") + text)

    def status(self, text):
        self.emit("status", text=text[:200])

    def poll(self, since, limit=1500):
        with self.lock:
            ev = [e for e in self.events if e["seq"] > since][:limit]
            return dict(events=ev, seq=self.seq, running=self.running)

    def start(self, label, fn):
        with self.lock:
            if self.running:
                return False
            self.running = label
        self.stop.clear()
        self.emit("task", state="start", label=label)

        def wrap():
            try:
                fn()
            except Exception as ex:
                self.log(f"Ошибка: {ex!r}")
            finally:
                with self.lock:
                    self.running = None
                self.emit("task", state="end", label=label, stopped=self.stop.is_set())
        threading.Thread(target=wrap, daemon=True).start()
        return True

    def add_items(self, list_name, items):
        out = []
        with self.lock:
            for it in items:
                self.next_id += 1
                iid = str(self.next_id)
                self.lists[list_name][iid] = it
                out.append(dict(id=iid, path=it.path, name=os.path.basename(it.path.rstrip("\\")) or it.path,
                                dir=os.path.dirname(it.path), size=it.size, reason=it.reason, conf=it.conf,
                                is_dir=it.is_dir, checked=it.checked, group=it.group, mtime=it.mtime))
        self.emit("items", list=list_name, items=out)

    def categories_found(self, refresh=False):
        if self.found is None or refresh:
            self.found = {c["id"]: cat_found(c) for c in CATEGORIES}
        return self.found


STORE = None
TASKS = Tasks()
DRIVE_START = {}


def _cutoff_from_hours(h):
    try:
        h = max(0, int(h))
    except (TypeError, ValueError):
        h = 24
    return time.time() - h * 3600 if h else None


def api_scan_system(body):
    cutoff = _cutoff_from_hours(body.get("age_h", 24))
    ids = body.get("ids")
    cats = [c for c in CATEGORIES if (not ids or c["id"] in ids)]

    def work():
        found = TASKS.categories_found(refresh=True)
        for c in cats:
            if TASKS.stop.is_set():
                break
            if not found.get(c["id"]):
                TASKS.emit("cat", id=c["id"], size=0, count=0, note="", found=False)
                continue
            TASKS.status(f"Считаю: {c['name']}")
            size, cnt, errs, note = category_process(c, cutoff, TASKS.stop, dry=True)
            TASKS.emit("cat", id=c["id"], size=size, count=cnt, note=note, found=True)
        TASKS.log("Сканирование системы завершено")
        TASKS.emit("done", kind="scan_system")
    return TASKS.start("Сканирование системы", work)


def api_clean_system(body):
    cutoff = _cutoff_from_hours(body.get("age_h", 24))
    dry = bool(body.get("dry"))
    ids = set(body.get("ids") or [])
    cats = [c for c in CATEGORIES if c["id"] in ids]

    def work():
        total = 0
        before = {d["root"]: d["free"] for d in drives_quick()}
        for c in cats:
            if TASKS.stop.is_set():
                break
            TASKS.status(("Пробно: " if dry else "Чищу: ") + c["name"])
            freed, cnt, errs, note = category_process(c, cutoff, TASKS.stop, dry=dry)
            total += freed
            msg = f"{'[пробно] ' if dry else ''}{c['name']}: {human(freed)}, файлов {cnt}"
            if errs:
                msg += f", пропущено (заняты/нет прав) {errs}"
            if note:
                msg += f" — {note}"
            TASKS.log(msg)
            if not dry:
                STORE.record("Очистка системы", c["name"], freed, binned=bool(c.get("to_bin")), files=cnt)
            left, lc, _, _ = category_process(c, cutoff, TASKS.stop, dry=True)
            TASKS.emit("cat", id=c["id"], size=left, count=lc, found=True,
                       note=f"освобождено {human(freed)}" + (f"; пропущено {errs}" if errs else ""))
        after = {d["root"]: d["free"] for d in drives_quick()}
        real = sum(max(0, after.get(k, 0) - v) for k, v in before.items())
        TASKS.log(f"ИТОГО {'(пробно) ' if dry else ''}освобождено: {human(total)}"
                  + ("" if dry else f" (свободное место на дисках выросло на {human(real)})"))
        TASKS.emit("done", kind="clean_system", dry=dry, freed=total, real=real)
    return TASKS.start("Очистка системы", work)


def _roots_expand(roots):
    out = []
    for r in roots:
        r = os.path.normpath(r)
        if len(norm(r)) <= 3:
            try:
                out += [e.path for e in os.scandir(r) if e.is_dir(follow_symlinks=False)
                        and e.name.lower() not in SKIP_DIR_NAMES and not is_protected(e.path)]
            except OSError:
                pass
        elif os.path.isdir(r) and not is_protected(r):
            out.append(r)
    # убрать вложенные корни, чтобы файлы не считались дважды
    out = sorted({norm(x): x for x in out}.values(), key=lambda x: len(norm(x)))
    kept = []
    for r in out:
        if not any(norm(r).startswith(norm(k).rstrip(os.sep) + os.sep) for k in kept):
            kept.append(r)
    return kept


def _batched_reporter(list_name):
    batch = []
    lock = threading.Lock()

    def report(it):
        with lock:
            batch.append(it)
            if len(batch) >= 150:
                TASKS.add_items(list_name, batch[:])
                batch.clear()

    def flush():
        with lock:
            if batch:
                TASKS.add_items(list_name, batch[:])
                batch.clear()
    return report, flush


def api_junk_scan(body):
    roots = body.get("roots") or [str(HOME)]
    defaults = dict(temp=True, copies=True, backup=True, zero=True, empty=True, lnk=True, installers=True,
                    dups=True, big=False, dup_min_mb=1, big_min_mb=500, installer_days=30)
    opts = {**defaults, **(body.get("opts") or {})}
    for k in ("dup_min_mb", "big_min_mb", "installer_days"):
        try:
            opts[k] = max(0, float(opts[k]))
        except (TypeError, ValueError):
            opts[k] = defaults[k]

    def work():
        with TASKS.lock:
            TASKS.lists["junk"].clear()
        TASKS.emit("clear", list="junk")
        report, flush = _batched_reporter("junk")
        junk_scan(_roots_expand(roots), opts, TASKS.stop, report, TASKS.status)
        flush()
        n = len(TASKS.lists["junk"])
        TASKS.log(f"Поиск мусора: найдено {n} объектов")
        TASKS.emit("done", kind="junk_scan", count=n)
    return TASKS.start("Поиск мусора", work)


def dup_scan(roots, opts, stop, report, progress):
    """Повторяющиеся файлы. mode=content — точное совпадение содержимого, name — одинаковые имя и размер."""
    min_size = max(1.0, float(opts.get("min_mb", 1)) * 1024 * 1024)
    types = set(opts.get("types") or []) or None
    mode = opts.get("mode", "content")
    by_key, scanned = {}, 0
    stack = [r for r in roots if os.path.isdir(r) and not is_protected(r)]
    while stack:
        if stop.is_set():
            return
        d = stack.pop()
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        for e in entries:
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            if is_reparse(st):
                continue
            if stat.S_ISDIR(st.st_mode):
                if e.name.lower() not in SKIP_DIR_NAMES and not is_protected(e.path):
                    stack.append(e.path)
                continue
            scanned += 1
            if scanned % 3000 == 0:
                progress(f"Просмотрено файлов: {scanned:,}  ·  {d}".replace(",", " "))
            if st.st_size < min_size:
                continue
            if types and file_type(os.path.splitext(e.name)[1].lower()) not in types:
                continue
            key = st.st_size if mode == "content" else (e.name.lower(), st.st_size)
            by_key.setdefault(key, []).append((e.path, st.st_mtime))

    def unique_inodes(files):
        out, seen = [], set()
        for p, mt in files:
            try:
                s = os.stat(p)
                k = (s.st_dev, s.st_ino) if s.st_ino else p
            except OSError:
                continue
            if k not in seen:  # жёсткие ссылки — это один и тот же файл
                seen.add(k)
                out.append((p, mt))
        return out

    candidates = [v for v in by_key.values() if len(v) > 1]
    gid = 0
    for gi, files in enumerate(candidates):
        if stop.is_set():
            return
        if gi % 25 == 0:
            progress(f"Сравниваю: группа {gi + 1} из {len(candidates)}")
        files = unique_inodes(files)
        if len(files) < 2:
            continue
        if mode == "content":
            part = {}
            for p, mt in files:
                h = file_hash(p, stop, partial=True)
                if h:
                    part.setdefault(h, []).append((p, mt))
            sets = []
            for cand in part.values():
                if len(cand) < 2:
                    continue
                full = {}
                for p, mt in cand:
                    h = file_hash(p, stop)
                    if h:
                        full.setdefault(h, []).append((p, mt))
                sets += [s for s in full.values() if len(s) > 1]
        else:
            sets = [files]
        for same in sets:
            gid += 1
            same.sort(key=lambda t: (t[1], len(t[0]), t[0].lower()))
            size = os.path.getsize(same[0][0]) if os.path.exists(same[0][0]) else 0
            for i, (p, mt) in enumerate(same):
                it = JunkItem(p, size, "оригинал (самый старый)" if i == 0 else
                              ("одинаковое содержимое" if mode == "content" else "то же имя и размер"),
                              HIGH if mode == "content" else MID, group=f"g{gid}", mtime=mt)
                it.checked = i > 0 and mode == "content"
                report(it)
    progress(f"Готово. Просмотрено файлов: {scanned:,}".replace(",", " "))


def api_dup_scan(body):
    roots = body.get("roots") or [str(HOME)]
    opts = body.get("opts") or {}

    def work():
        with TASKS.lock:
            TASKS.lists["dups"].clear()
        TASKS.emit("clear", list="dups")
        report, flush = _batched_reporter("dups")
        dup_scan(_roots_expand(roots), opts, TASKS.stop, report, TASKS.status)
        flush()
        items = list(TASKS.lists["dups"].values())
        groups = len({i.group for i in items})
        extra = sum(i.size for i in items if not i.reason.startswith("оригинал"))
        TASKS.log(f"Дубликаты: {groups} групп, лишние копии занимают {human(extra)}")
        TASKS.emit("done", kind="dup_scan", groups=groups, extra=extra)
    return TASKS.start("Поиск дубликатов", work)


def api_unused_scan(body):
    roots = body.get("roots") or [str(DOWNLOADS)]
    opts = body.get("opts") or {}

    def work():
        with TASKS.lock:
            TASKS.lists["unused"].clear()
        TASKS.emit("clear", list="unused")
        report, flush = _batched_reporter("unused")
        unused_scan(_roots_expand(roots), opts, TASKS.stop, report, TASKS.status)
        flush()
        n = len(TASKS.lists["unused"])
        TASKS.log(f"Бесполезные файлы: найдено {n}")
        TASKS.emit("done", kind="unused_scan", count=n)
    return TASKS.start("Поиск бесполезных файлов", work)


def api_delete(body):
    list_name = body.get("list")
    if list_name not in TASKS.lists:
        return False
    ids = [str(i) for i in body.get("ids") or []]
    permanent = bool(body.get("permanent"))
    dry = bool(body.get("dry"))
    source = {"junk": "Поиск мусора", "unused": "Бесполезные файлы", "dups": "Дубликаты"}[list_name]

    def work():
        with TASKS.lock:
            items = [(i, TASKS.lists[list_name][i]) for i in ids if i in TASKS.lists[list_name]]
            if list_name == "dups":
                # в каждой группе дубликатов хотя бы одна копия должна остаться
                total, chosen = {}, {}
                for it in TASKS.lists["dups"].values():
                    total[it.group] = total.get(it.group, 0) + 1
                for i, it in items:
                    chosen.setdefault(it.group, []).append((i, it))
                keep = set()
                for g, lst in chosen.items():
                    if len(lst) >= total.get(g, 0):
                        lst.sort(key=lambda x: (x[1].mtime or 0, len(x[1].path)))
                        keep.add(lst[0][0])
                if keep:
                    TASKS.log(f"Дубликаты: в {len(keep)} группах были отмечены все копии — по одной оставлено")
                items = [(i, it) for i, it in items if i not in keep]
        items = [(i, it) for i, it in items if not is_protected(it.path)]
        size = sum(it.size for _, it in items)
        if dry:
            TASKS.log(f"[пробно] {source}: удалилось бы {len(items)} объектов, {human(size)}")
            TASKS.emit("done", kind="delete", dry=True, freed=size, count=len(items))
            return
        done, fail, freed = [], 0, 0
        if permanent:
            for i, it in items:
                if TASKS.stop.is_set():
                    break
                try:
                    if it.is_dir:
                        clean_dir(it.path, None, TASKS.stop, False, delete_root=True)
                        if os.path.exists(it.path):
                            raise OSError
                    else:
                        force_unlink(it.path)
                    done.append(i)
                    freed += it.size
                except OSError:
                    fail += 1
        else:
            TASKS.status("Перемещаю в Корзину…")
            send_to_recycle_bin([it.path for _, it in items])
            for i, it in items:
                if not os.path.lexists(it.path):
                    done.append(i)
                    freed += it.size
                else:
                    fail += 1
        with TASKS.lock:
            for i in done:
                TASKS.lists[list_name].pop(i, None)
        how = "удалено навсегда" if permanent else "перемещено в Корзину"
        STORE.record(source, f"{source}: {len(done)} файлов", freed, binned=not permanent, files=len(done))
        TASKS.log(f"{source}: {how} {len(done)} объектов, {human(freed)}" + (f"; не удалось {fail}" if fail else ""))
        TASKS.emit("removed", list=list_name, ids=done)
        TASKS.emit("done", kind="delete", freed=freed, count=len(done), failed=fail, permanent=permanent)
    return TASKS.start("Удаление", work)


def api_analyze(body):
    path = os.path.normpath((body.get("path") or str(HOME)).strip().strip('"'))
    if len(path) == 2 and path[1] == ":":
        path += "\\"
    if not os.path.isdir(path):
        return False

    def work():
        rows, loose, loose_n = [], 0, 0
        try:
            entries = list(os.scandir(path))
        except OSError as ex:
            TASKS.log(f"Анализ: нет доступа к {path}: {ex}")
            TASKS.emit("analyze", path=path, rows=[], total=0)
            return
        for e in entries:
            if TASKS.stop.is_set():
                break
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            if is_reparse(st):
                continue
            if stat.S_ISDIR(st.st_mode):
                TASKS.status(f"Считаю: {e.path}")
                sz, n = dir_size(e.path, TASKS.stop)
                rows.append(dict(name=e.name, path=e.path, size=sz, files=n, dir=True))
            elif st.st_size >= 50 * 1024 * 1024:
                rows.append(dict(name=e.name, path=e.path, size=st.st_size, files=1, dir=False))
            else:
                loose += st.st_size
                loose_n += 1
        if loose_n:
            rows.append(dict(name=f"Файлы в этой папке ({loose_n})", path=path, size=loose, files=loose_n,
                             dir=False, loose=True))
        rows.sort(key=lambda r: -r["size"])
        total = sum(r["size"] for r in rows)
        parent = os.path.dirname(path.rstrip("\\/"))
        if len(parent) == 2:
            parent += "\\"
        TASKS.emit("analyze", path=path, parent=parent if norm(parent) != norm(path) else None,
                   rows=rows[:80], total=total)
        TASKS.log(f"Анализ {path}: {human(total)}")
    return TASKS.start("Анализ места", work)


def api_disk_action(body):
    letter = (body.get("letter") or "")[:1].upper()
    action = body.get("action")
    if letter not in string.ascii_uppercase or action not in ("optimize", "chkdsk", "cleanmgr"):
        return False
    if action == "cleanmgr":
        subprocess.Popen(["cleanmgr", "/d", letter])
        TASKS.log(f"Открыта «Очистка диска» Windows для {letter}:")
        return True
    cmd = (["defrag", f"{letter}:", "/O", "/U", "/V"] if action == "optimize"
           else ["chkdsk", f"{letter}:"])
    label = "Оптимизация диска" if action == "optimize" else "Проверка диска (только чтение)"

    def work():
        TASKS.status(f"{label} {letter}: …")
        TASKS.log(f"{label} {letter}: — запуск {' '.join(cmd)}")
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 creationflags=CREATE_NO_WINDOW)
            for raw in iter(p.stdout.readline, b""):
                if TASKS.stop.is_set():
                    p.terminate()
                    break
                line = raw.decode("cp866", "ignore").strip()
                if line:
                    TASKS.status(line)
                    if not re.match(r"^[\d\s.%]+$", line):
                        TASKS.log("   " + line)
            p.wait()
            TASKS.log(f"{label} {letter}: завершено, код {p.returncode}"
                      + ("" if is_admin() else " (без прав администратора команда может отказать)"))
        except Exception as ex:
            TASKS.log(f"{label}: ошибка {ex}")
        TASKS.emit("done", kind="disk_action")
    return TASKS.start(label, work)


class BROWSEINFOW(ctypes.Structure):
    _fields_ = [("hwndOwner", wintypes.HWND), ("pidlRoot", ctypes.c_void_p), ("pszDisplayName", ctypes.c_wchar_p),
                ("lpszTitle", ctypes.c_wchar_p), ("ulFlags", wintypes.UINT), ("lpfn", ctypes.c_void_p),
                ("lParam", wintypes.LPARAM), ("iImage", ctypes.c_int)]


def pick_folder():
    """Системный диалог выбора папки через WinAPI (без tkinter — работает и в портативной сборке)."""
    shell32, ole32 = ctypes.windll.shell32, ctypes.windll.ole32
    shell32.SHBrowseForFolderW.restype = ctypes.c_void_p
    shell32.SHBrowseForFolderW.argtypes = [ctypes.POINTER(BROWSEINFOW)]
    shell32.SHGetPathFromIDListW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED — нужен для нового стиля диалога
    try:
        name = ctypes.create_unicode_buffer(260)
        bi = BROWSEINFOW()
        bi.hwndOwner = ctypes.windll.user32.GetForegroundWindow()  # окно браузера — диалог появится поверх него
        bi.pszDisplayName = ctypes.cast(name, ctypes.c_wchar_p)
        bi.lpszTitle = "Выберите папку"
        bi.ulFlags = 0x0001 | 0x0040 | 0x0010  # только папки | новый стиль | строка ввода пути
        pidl = shell32.SHBrowseForFolderW(ctypes.byref(bi))
        if not pidl:
            return None
        path = ctypes.create_unicode_buffer(32768)
        ok = shell32.SHGetPathFromIDListW(pidl, path)
        ole32.CoTaskMemFree(pidl)
        return os.path.normpath(path.value) if ok and path.value else None
    finally:
        ole32.CoUninitialize()


def reveal(path):
    if path and os.path.exists(path):
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        return True
    parent = os.path.dirname(path or "")
    if os.path.isdir(parent):
        os.startfile(parent)
        return True
    return False


def api_state():
    found = TASKS.categories_found()
    drives = drives_quick()
    for d in drives:
        d["start_free"] = DRIVE_START.get(d["root"], d["free"])
    known_roots = [str(p) for p in (HOME, DOWNLOADS, HOME / "Desktop", HOME / "Documents", HOME / "Videos",
                                    HOME / "Pictures", HOME / "Music") if p.exists()]
    return dict(
        admin=is_admin(), app=APP_TITLE, version=APP_VERSION, data_file=STORE.path,
        drives=drives, groups=GROUPS,
        categories=[dict(id=c["id"], group=c["group"], name=c["name"], note=c.get("note", ""),
                         on=c.get("on", False), admin=c.get("admin", False), to_bin=c.get("to_bin", False),
                         age=c.get("age", False), found=found.get(c["id"], False)) for c in CATEGORIES],
        settings=STORE.data.get("settings", {}), stats=STORE.stats(),
        last_access=last_access_state(), home=str(HOME), downloads=str(DOWNLOADS), known_roots=known_roots,
        file_types=[dict(id=k, name=v[0], exts=sorted(v[1])) for k, v in FILE_TYPES.items()]
        + [dict(id="other", name="Прочее", exts=[])],
        running=TASKS.running, seq=TASKS.seq)


# --------------------------------------------------------------------------
# Игры: поиск установленных, последний запуск, удаление через лаунчер
# --------------------------------------------------------------------------
def vdf_parse(text):
    """Минимальный разбор Valve KeyValues (.vdf/.acf)."""
    root, stack, key = {}, [], None
    stack.append(root)
    for s, brace in re.findall(r'"((?:[^"\\]|\\.)*)"|([{}])', text):
        if brace == "{":
            d = {}
            if key is not None:
                stack[-1][key] = d
            stack.append(d)
            key = None
        elif brace == "}":
            if len(stack) > 1:
                stack.pop()
            key = None
        else:
            s = s.replace("\\\\", "\\").replace('\\"', '"')
            if key is None:
                key = s
            else:
                stack[-1][key] = s
                key = None
    return root


def vget(d, *path):
    """Регистронезависимый доступ по пути ключей."""
    for p in path:
        if not isinstance(d, dict):
            return None
        pl = p.lower()
        d = next((v for k, v in d.items() if k.lower() == pl), None)
    return d


def _int(x, default=0):
    try:
        return int(x)
    except (TypeError, ValueError):
        return default


STEAM_SKIP_APPS = {228980, 1070560, 1391110, 1628350, 1493710, 1826330}  # редистрибутивы, рантаймы
EXE_SKIP = re.compile(r"unins|setup|install|redist|vc_?redist|crash|report|dxsetup|dotnet|prereq|easyanticheat|"
                      r"battleye|^be[a-z]*\.exe|cefprocess|helper|update|notification|overlay|launcher_?helper|"
                      r"uploader|elevate|7z|unitycrash|webview", re.I)


def steam_lastplayed():
    """appid -> (last_played_ts, playtime_min) из userdata/*/config/localconfig.vdf."""
    out = {}
    if not STEAM:
        return out
    for cfg in glob.glob(os.path.join(STEAM, "userdata", "*", "config", "localconfig.vdf")):
        try:
            with open(cfg, encoding="utf-8", errors="ignore") as f:
                data = vdf_parse(f.read())
        except OSError:
            continue
        apps = vget(data, "UserLocalConfigStore", "Software", "Valve", "Steam", "apps") or {}
        for appid, v in apps.items():
            if not isinstance(v, dict):
                continue
            lp, pt = _int(vget(v, "LastPlayed")), _int(vget(v, "Playtime"))
            a = _int(appid)
            old = out.get(a, (0, 0))
            out[a] = (max(old[0], lp), max(old[1], pt))
    return out


def prefetch_times():
    """ИМЯ.EXE -> время последнего запуска по Prefetch (нужны права администратора)."""
    out = {}
    try:
        for e in os.scandir(os.path.join(str(WINDIR), "Prefetch")):
            if e.name.lower().endswith(".pf"):
                exe = e.name.rsplit("-", 1)[0].upper()
                try:
                    out[exe] = max(out.get(exe, 0), e.stat().st_mtime)
                except OSError:
                    pass
    except OSError:
        pass
    return out


def game_exes(folder, limit=300):
    """Исполняемые файлы игры (до 3 уровней вглубь), без установщиков и служебных."""
    out = []
    stack = [(folder, 0)]
    while stack and len(out) < limit:
        d, depth = stack.pop()
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        for e in entries:
            try:
                if e.is_dir(follow_symlinks=False):
                    if depth < 3 and not e.name.startswith(("_", ".")) and e.name.lower() not in (
                            "redist", "_commonredist", "directx", "vcredist", "support", "installers"):
                        stack.append((e.path, depth + 1))
                elif e.name.lower().endswith(".exe") and not EXE_SKIP.search(e.name):
                    out.append((e.name, e.stat().st_atime))
            except OSError:
                continue
    return out


def estimate_last_played(folder, extra_exes, prefetch, la_enabled):
    exes = game_exes(folder) if folder and os.path.isdir(folder) else []
    names = {n.upper() for n, _ in exes} | {os.path.basename(x).upper() for x in extra_exes if x}
    pf = [prefetch[n] for n in names if n in prefetch]
    if pf:
        return max(pf), "по Prefetch Windows"
    if la_enabled and exes:
        return max(t for _, t in exes), "по последнему открытию файлов игры"
    return None, ""


def uninstall_entries():
    import winreg
    path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
    hives = [(winreg.HKEY_LOCAL_MACHINE, winreg.KEY_WOW64_64KEY), (winreg.HKEY_LOCAL_MACHINE, winreg.KEY_WOW64_32KEY),
             (winreg.HKEY_CURRENT_USER, 0)]
    seen, out = set(), []
    for hive, flag in hives:
        try:
            root = winreg.OpenKey(hive, path, 0, winreg.KEY_READ | flag)
        except OSError:
            continue
        i = 0
        while True:
            try:
                name = winreg.EnumKey(root, i)
            except OSError:
                break
            i += 1
            try:
                with winreg.OpenKey(root, name) as k:
                    vals = {}
                    j = 0
                    while True:
                        try:
                            vn, vv, _ = winreg.EnumValue(k, j)
                        except OSError:
                            break
                        vals[vn] = vv
                        j += 1
            except OSError:
                continue
            key = (vals.get("DisplayName"), vals.get("InstallLocation"))
            if key in seen:
                continue
            seen.add(key)
            vals["_key"] = name
            out.append(vals)
        winreg.CloseKey(root)
    return out


GAME_PUBLISHERS = re.compile(
    r"riot games|blizzard|electronic arts|^ea\b|ubisoft|rockstar|wargaming|lesta|mihoyo|hoyoverse|cognosphere|"
    r"cd projekt|gog\.com|bethesda|square enix|bandai namco|\bsega\b|capcom|paradox|\b2k\b|activision|netease|"
    r"krafton|nexon|gaijin|my\.games|mail\.ru games|innova|4game|garena|grinding gear|digital extremes|smilegate|"
    r"bungie|respawn|fromsoftware|warner bros\.? games|devolver|team17|focus entertainment|thq|deep silver|koei|"
    r"konami|embark|facepunch|battlestate|kuro games|level infinite|tencent games|pubg|xbox game studios|"
    r"microsoft studios|epic games|playstation|sony interactive|io interactive|remedy|larian|hello games|"
    r"coffee stain|saber interactive|11 bit|techland|4a games|gsc game world|frontier developments|creative assembly",
    re.I)
NOT_GAME = re.compile(
    r"launcher|game ?center|galaxy|^steam$|battle\.net|^ea app|ubisoft connect|^uplay$|^origin\b|riot client|"
    r"hoyoplay|redistributable|directx|visual c\+\+|physx|runtime|anti-?cheat|easyanticheat|battleye|vanguard|"
    r"overwolf|geforce|nvidia|\bamd\b|intel|driver|\bsdk\b|unreal engine|^xbox|gaming services|toolkit|"
    r"dedicated server|bootstrapper|prerequisites|\bupdate\b|helper|web ?view", re.I)
GAME_DIRS = re.compile(r"\\(epic games|gog galaxy\\games|gog games|riot games|ubisoft game launcher\\games|ea games|"
                       r"origin games|games|игры)\\", re.I)


def classify_source(vals):
    pub = (vals.get("Publisher") or "")
    us = (vals.get("UninstallString") or "")
    if "uplay://" in us.lower() or "ubisoft" in pub.lower():
        return "Ubisoft"
    for rx, name in ((r"gog", "GOG"), (r"electronic arts|^ea\b", "EA"), (r"blizzard", "Battle.net"),
                     (r"riot", "Riot"), (r"rockstar", "Rockstar"), (r"wargaming|lesta", "Wargaming/Лесты"),
                     (r"mihoyo|hoyoverse|cognosphere", "HoYoverse"), (r"epic", "Epic")):
        if re.search(rx, pub, re.I):
            return name
    return "Другие"


def scan_games(progress):
    games = []
    la = last_access_state()
    prefetch = prefetch_times()
    seen_paths = set()
    now = time.time()

    # ---- Steam ----
    if STEAM:
        progress("Читаю библиотеку Steam…")
        lp = steam_lastplayed()
        for lib in STEAM_LIBS:
            for mf in glob.glob(os.path.join(lib, "steamapps", "appmanifest_*.acf")):
                try:
                    with open(mf, encoding="utf-8", errors="ignore") as f:
                        st_ = vget(vdf_parse(f.read()), "AppState") or {}
                except OSError:
                    continue
                appid = _int(vget(st_, "appid"))
                name = vget(st_, "name") or f"App {appid}"
                if appid in STEAM_SKIP_APPS or re.search(r"redistributable|steamworks common|runtime", name, re.I):
                    continue
                path = os.path.join(lib, "steamapps", "common", vget(st_, "installdir") or "")
                size = _int(vget(st_, "SizeOnDisk"))
                if not size and os.path.isdir(path):
                    size = dir_size(path)[0]
                last, play = lp.get(appid, (0, 0))
                last = last or _int(vget(st_, "LastPlayed"))
                seen_paths.add(norm(path))
                games.append(dict(id=f"steam:{appid}", name=name, source="Steam", path=path, size=size,
                                  last=last or None, never=not last, last_how="по данным Steam", playtime=play,
                                  method="steam", appid=appid, image=True, alt_folder=False))

    # ---- Epic ----
    progress("Ищу игры Epic Games…")
    for mf in glob.glob(os.path.join(str(PROGDATA), "Epic", "EpicGamesLauncher", "Data", "Manifests", "*.item")):
        try:
            with open(mf, encoding="utf-8", errors="ignore") as f:
                m = json.load(f)
        except (OSError, ValueError):
            continue
        cats_ = [c.lower() for c in (m.get("AppCategories") or [])]
        app = m.get("AppName") or ""
        if app.startswith("UE_") or "plugins" in cats_ or "engines" in cats_ or m.get("bIsIncompleteInstall"):
            continue
        path = os.path.normpath(m.get("InstallLocation") or "")
        if not path or not os.path.isdir(path):
            continue
        exe = os.path.join(path, m.get("LaunchExecutable") or "")
        last, how = estimate_last_played(path, [exe], prefetch, la)
        seen_paths.add(norm(path))
        games.append(dict(id=f"epic:{app}", name=m.get("DisplayName") or app, source="Epic", path=path,
                          size=_int(m.get("InstallSize")) or dir_size(path)[0], last=last, never=False, last_how=how,
                          playtime=0, method="epic", app=app, image=False, alt_folder=True))

    # ---- реестр «Программы и компоненты» ----
    progress("Смотрю установленные программы…")
    for v in uninstall_entries():
        name = (v.get("DisplayName") or "").strip()
        us = (v.get("UninstallString") or "").strip()
        if not name or not us or v.get("SystemComponent") == 1 or v.get("ParentKeyName"):
            continue
        if "steam://uninstall" in us.lower() or (v.get("_key") or "").lower().startswith("steam app"):
            continue
        loc = os.path.normpath((v.get("InstallLocation") or "").strip().strip('"')) if v.get("InstallLocation") else ""
        pub = v.get("Publisher") or ""
        is_game = bool(GAME_PUBLISHERS.search(pub)) or "uplay://" in us.lower() or (loc and GAME_DIRS.search(loc + "\\"))
        if not is_game or NOT_GAME.search(name):
            continue
        if loc and norm(loc) in seen_paths:
            continue
        if loc and len(norm(loc)) <= 3:
            loc = ""
        icon = (v.get("DisplayIcon") or "").split(",")[0].strip('"')
        progress(f"Игра: {name}")
        size = _int(v.get("EstimatedSize")) * 1024
        if loc and os.path.isdir(loc) and size < 50 * 1024 * 1024:
            size = max(size, dir_size(loc)[0])
        last, how = estimate_last_played(loc, [icon], prefetch, la)
        if loc:
            seen_paths.add(norm(loc))
        games.append(dict(id=f"reg:{v.get('_key')}", name=name, source=classify_source(v), path=loc, size=size,
                          last=last, never=False, last_how=how, playtime=0, method="command", command=us,
                          image=False, alt_folder=bool(loc and os.path.isdir(loc))))

    # ---- Xbox / Microsoft Store (папки XboxGames) ----
    for root in fixed_drives():
        xg = os.path.join(root, "XboxGames")
        if not os.path.isdir(xg):
            continue
        for e in os.scandir(xg):
            if not e.is_dir() or e.name.lower() in ("gamesave", "gamingruntime"):
                continue
            progress(f"Xbox: {e.name}")
            last, how = estimate_last_played(os.path.join(e.path, "Content"), [], prefetch, la)
            games.append(dict(id=f"xbox:{e.name}", name=e.name, source="Xbox", path=e.path, size=dir_size(e.path)[0],
                              last=last, never=False, last_how=how, playtime=0, method="xbox", image=False,
                              alt_folder=False))

    for g in games:
        g["days"] = int((now - g["last"]) // 86400) if g.get("last") else None
        g["exists"] = bool(g["path"]) and os.path.isdir(g["path"])
    games.sort(key=lambda g: (g["last"] or 0))
    return games, dict(prefetch=bool(prefetch), last_access=la)


GAMES = {}


def api_games_scan(body):
    def work():
        games, info = scan_games(TASKS.status)
        GAMES.clear()
        GAMES.update({g["id"]: g for g in games})
        pub = [{k: v for k, v in g.items() if k not in ("command",)} for g in games]
        TASKS.emit("games", games=pub, info=info)
        TASKS.log(f"Игры: найдено {len(games)}, занимают {human(sum(g['size'] for g in games))}")
        TASKS.emit("done", kind="games_scan", count=len(games))
    return TASKS.start("Поиск игр", work)


def steam_image(appid, kind):
    if not STEAM or not str(appid).isdigit():
        return None
    base = os.path.join(STEAM, "appcache", "librarycache")
    a = str(appid)
    names = (["library_600x900_2x.jpg", "library_600x900.jpg", "library_capsule.jpg"] if kind == "portrait"
             else ["header.jpg", "library_header.jpg", "library_hero.jpg", "capsule_616x353.jpg"])
    cands = []
    for n in names:
        cands.append(os.path.join(base, f"{a}_{n}"))
        cands.append(os.path.join(base, a, n))
        cands += glob.glob(os.path.join(base, a, "*", n))
    for c in cands:
        full = os.path.normpath(c)
        if full.startswith(os.path.normpath(base) + os.sep) and os.path.isfile(full):
            return full
    return None


def _split_command(cmd):
    cmd = cmd.strip()
    if cmd.startswith('"'):
        end = cmd.find('"', 1)
        return cmd[1:end], cmd[end + 1:].strip()
    m = re.search(r"\.exe\b", cmd, re.I)
    if m:
        return cmd[:m.end()], cmd[m.end():].strip()
    parts = cmd.split(" ", 1)
    return parts[0], (parts[1] if len(parts) > 1 else "")


def _watch_removal(g):
    path, size = g.get("path"), g.get("size", 0)
    if not path:
        return

    def run():
        for i in range(900):  # до 45 минут
            time.sleep(3)
            gone = not os.path.exists(path)
            left = 0
            if not gone and i % 10 == 9:
                left = dir_size(path)[0]
                gone = size > 0 and left < size * 0.03
            if gone:
                freed = max(0, size - left)
                STORE.record("Удаление игр", g["name"], freed)
                TASKS.emit("game_removed", id=g["id"], freed=freed)
                TASKS.log(f"Игра удалена: {g['name']} — освобождено {human(freed)}")
                return
    threading.Thread(target=run, daemon=True).start()


def api_game_uninstall(body):
    g = GAMES.get(body.get("id") or "")
    if not g:
        return {"ok": False, "message": "Игра не найдена — обновите список"}
    mode = body.get("mode") or "launcher"
    try:
        if mode == "folder":
            p = g.get("path") or ""
            bad = [norm(x) for x in (WINDIR, PROGDATA, HOME, ENV.get("ProgramFiles", ""),
                                     ENV.get("ProgramFiles(x86)", ""))]
            if (not g.get("alt_folder") or not os.path.isdir(p) or len(norm(p)) <= 3 or norm(p) in bad
                    or any(b.startswith(norm(p) + os.sep) for b in bad if b)):
                return {"ok": False, "message": "Эту папку нельзя удалить отсюда"}

            def work():
                TASKS.status(f"Удаляю папку игры {g['name']}…")
                op = SHFILEOPSTRUCTW()
                op.wFunc = FO_DELETE
                op.pFrom = os.path.abspath(p) + "\0\0"
                op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | 0x4000  # FOF_WANTNUKEWARNING
                ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
                if not os.path.exists(p):
                    STORE.record("Удаление игр", g["name"], g["size"], binned=True)
                    TASKS.emit("game_removed", id=g["id"], freed=g["size"], binned=True)
                    TASKS.log(f"Папка игры {g['name']} перемещена в Корзину ({human(g['size'])})")
                else:
                    TASKS.log(f"Папку игры {g['name']} удалить не удалось (занята или отменено)")
                TASKS.emit("done", kind="game_folder")
            ok = TASKS.start("Удаление игры", work)
            return {"ok": ok, "message": "Удаляю папку…" if ok else f"Сейчас выполняется: {TASKS.running}"}
        if g["method"] == "steam":
            os.startfile(f"steam://uninstall/{g['appid']}")
            msg = "Steam покажет окно подтверждения удаления"
        elif g["method"] == "command":
            cmd = g.get("command") or ""
            if re.match(r"^[a-z][\w+.-]*://", cmd, re.I):
                os.startfile(cmd)
            else:
                exe, params = _split_command(cmd)
                rc = ctypes.windll.shell32.ShellExecuteW(None, "open", exe, params or None,
                                                         os.path.dirname(exe) or None, 1)
                if rc <= 32:
                    return {"ok": False, "message": f"Не удалось запустить деинсталлятор (код {rc})"}
            msg = "Запущен деинсталлятор игры — следуйте его шагам"
        elif g["method"] == "epic":
            launched = False
            for c in (os.path.join(ENV.get("ProgramFiles(x86)", ""), "Epic Games", "Launcher", "Portal", "Binaries",
                                   b, "EpicGamesLauncher.exe") for b in ("Win64", "Win32")):
                if os.path.isfile(c):
                    os.startfile(c)
                    launched = True
                    break
            if not launched:
                os.startfile("com.epicgames.launcher://store")
            msg = "Открыт Epic Games Launcher: Библиотека → «…» у игры → «Удалить»"
        elif g["method"] == "xbox":
            os.startfile("ms-settings:appsfeatures")
            msg = "Открыты Параметры → Приложения: найдите игру и нажмите «Удалить»"
        else:
            return {"ok": False, "message": "Неизвестный способ удаления"}
    except OSError as ex:
        return {"ok": False, "message": f"Не получилось: {ex}"}
    TASKS.log(f"Удаление игры {g['name']}: {msg}")
    _watch_removal(g)
    return {"ok": True, "message": msg}


# --------------------------------------------------------------------------
# HTTP-сервер (только 127.0.0.1)
# --------------------------------------------------------------------------
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
        ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2"}
SERVER = None
PORT = 0


class Handler(BaseHTTPRequestHandler):
    server_version = "Chistilshik"

    def log_message(self, *a):
        pass

    def _host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        if host not in ("localhost", "127.0.0.1", "[::1]"):
            return False
        origin = self.headers.get("Origin")
        if origin:
            o = urlparse(origin)
            if o.hostname not in ("localhost", "127.0.0.1") or (o.port or 80) != PORT:
                return False
        return True

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache=False):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=3600" if cache else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "forbidden"})
        u = urlparse(self.path)
        if u.path == "/api/state":
            return self._send(200, api_state())
        if u.path == "/api/poll":
            since = int((parse_qs(u.query).get("since") or ["0"])[0] or 0)
            return self._send(200, TASKS.poll(since))
        if u.path == "/api/disks":
            return self._send(200, {"disks": disks_info()})
        if u.path == "/api/game_image":
            q = parse_qs(u.query)
            gid = (q.get("id") or [""])[0]
            img = steam_image(gid.split(":", 1)[1], (q.get("kind") or ["header"])[0]) if gid.startswith("steam:") else None
            if not img:
                return self._send(404, {"error": "no image"})
            with open(img, "rb") as f:
                return self._send(200, f.read(), "image/png" if img.lower().endswith(".png") else "image/jpeg", cache=True)
        # статика из ui/
        rel = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
        base = os.path.join(resource_dir(), "ui")
        full = os.path.normpath(os.path.join(base, rel))
        if not full.startswith(os.path.normpath(base) + os.sep) or not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        with open(full, "rb") as f:
            data = f.read()
        self._send(200, data, MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream"),
                   cache="/vendor/" in u.path)

    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Cleaner") != "1":
            return self._send(403, {"error": "forbidden"})
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 4 * 1024 * 1024)
            body = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "bad json"})
        p = urlparse(self.path).path
        routes = {"/api/scan_system": api_scan_system, "/api/clean_system": api_clean_system,
                  "/api/junk_scan": api_junk_scan, "/api/unused_scan": api_unused_scan,
                  "/api/dup_scan": api_dup_scan,
                  "/api/delete": api_delete, "/api/analyze": api_analyze, "/api/disk_action": api_disk_action}
        if p in routes:
            ok = routes[p](body)
            return self._send(200, {"ok": bool(ok), "busy": TASKS.running if not ok else None})
        if p == "/api/games_scan":
            ok = api_games_scan(body)
            return self._send(200, {"ok": bool(ok), "busy": TASKS.running if not ok else None})
        if p == "/api/game_uninstall":
            return self._send(200, api_game_uninstall(body))
        if p == "/api/stop":
            TASKS.stop.set()
            return self._send(200, {"ok": True})
        if p == "/api/pick_folder":
            return self._send(200, {"path": pick_folder()})
        if p == "/api/reveal":
            return self._send(200, {"ok": reveal(body.get("path"))})
        if p == "/api/settings":
            with STORE.lock:
                STORE.data.setdefault("settings", {}).update(body or {})
                STORE.save()
            return self._send(200, {"ok": True})
        if p == "/api/stats_reset":
            STORE.reset()
            return self._send(200, {"ok": True})
        if p == "/api/elevate":
            ok = relaunch_as_admin()
            self._send(200, {"ok": ok})
            if ok:
                threading.Timer(0.5, lambda: os._exit(0)).start()
            return
        if p == "/api/quit":
            self._send(200, {"ok": True})
            threading.Timer(0.3, lambda: os._exit(0)).start()
            return
        self._send(404, {"error": "not found"})


def serve(port=8770, open_browser=True):
    global SERVER, PORT, STORE
    STORE = Store()
    for d in drives_quick():
        DRIVE_START[d["root"]] = d["free"]
    srv = None
    for p in [port] + list(range(port + 1, port + 40)) + [0]:
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            break
        except OSError:
            continue
    SERVER, PORT = srv, srv.server_address[1]
    url = f"http://localhost:{PORT}"
    line = "─" * 54
    if sys.stdout:
        print(f"\n  {line}\n   {APP_TITLE} {APP_VERSION}"
              f"{'  ·  администратор' if is_admin() else ''}\n  {line}\n"
              f"   Интерфейс открыт в браузере:  {url}\n"
              f"   Не закрывайте это окно — это и есть программа.\n"
              f"   Выход: закрыть окно или Ctrl+C.\n  {line}\n", flush=True)
    threading.Thread(target=TASKS.categories_found, daemon=True).start()
    if open_browser:
        import webbrowser
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


# --------------------------------------------------------------------------
def selftest():
    """Без удаления: считает категории, ищет мусор и копии, проверяет удаление на песочнице."""
    stop = threading.Event()
    cutoff = time.time() - 24 * 3600
    print("Админ:", is_admin(), "| категорий:", len(CATEGORIES))
    found = [c for c in CATEGORIES if cat_found(c)]
    total = 0
    for c in found:
        size, cnt, errs, note = category_process(c, cutoff, stop, dry=True)
        total += size
    print(f"Установлено/найдено: {len(found)}, можно освободить: {human(total)}")
    # копии
    cases = {"отчёт (2).docx": "отчёт", "photo - Копия.jpg": "photo", "Копия photo.jpg": "photo",
             "doc - копія (3).pdf": "doc", "Copy of plan.txt": "plan", "plan - Copy.txt": "plan",
             "Bild - Kopie.png": "Bild", "image副本.png": "image", "setup(1).exe": "setup",
             "notes_copy.md": "notes", "normal file.txt": None, "copyright.txt": None}
    for name, want in cases.items():
        got = copy_base(os.path.splitext(name)[0])
        assert got == want, (name, got, want)
    print("Распознавание копий: OK,", len(cases), "случаев")
    sandbox = tempfile.mkdtemp(prefix="cleaner_selftest_")
    os.makedirs(os.path.join(sandbox, "a", "b"))
    for name, data in (("x.tmp", b"1234"), ("a/y.bak", b"1234"), ("a/b/z.txt", b"1234"),
                       ("orig.txt", b"hello"), ("orig (2).txt", b"hello"), ("orig - Копия.txt", b"other")):
        with open(os.path.join(sandbox, name), "wb") as f:
            f.write(data)
    found_items = []
    opts = dict(temp=True, copies=True, backup=True, zero=True, empty=True, lnk=False, installers=False,
                dups=False, big=False, dup_min_mb=1, big_min_mb=500, installer_days=30)
    junk_scan([sandbox], opts, stop, found_items.append, lambda s: None)
    reasons = {os.path.basename(i.path): i.conf for i in found_items}
    assert reasons.get("orig (2).txt") == HIGH and reasons.get("orig - Копия.txt") == LOW, reasons
    print("Поиск копий в песочнице: OK", reasons)
    un = []
    unused_scan([sandbox], dict(days=1, min_mb=0, use_atime=False), stop, un.append, lambda s: None)
    print("Бесполезные (свежие файлы не должны попасть):", len(un))
    assert not un
    dd = []
    dup_scan([sandbox], dict(min_mb=0, mode="content"), stop, dd.append, lambda s: None)
    groups = {}
    for it in dd:
        groups.setdefault(it.group, []).append(it)
    sizes = sorted(len(v) for v in groups.values())
    print("Дубликаты в песочнице:", sizes, "отмечено к удалению:", sum(i.checked for i in dd))
    assert sizes == [2, 3] and sum(i.checked for i in dd) == 3
    games, ginfo = scan_games(lambda s: None)
    print(f"Игры: найдено {len(games)}", ginfo)
    freed, cnt, errs = clean_dir(sandbox, None, stop, dry=False)
    left = os.listdir(sandbox)
    os.rmdir(sandbox)
    print(f"Песочница clean_dir: {freed} Б, файлов {cnt}, ошибок {errs}, осталось {left}")
    assert cnt == 6 and left == []
    print("Диски:", [(d["root"], d["kind"], d["health"]) for d in disks_info()])
    print("SELFTEST OK")


if __name__ == "__main__":
    try:
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        ctypes.windll.kernel32.SetConsoleTitleW(APP_TITLE)
    except Exception:
        pass
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest()
    else:
        port = 8770
        if "--port" in args:
            try:
                port = int(args[args.index("--port") + 1])
            except (IndexError, ValueError):
                pass
        serve(port, open_browser="--no-browser" not in args)
