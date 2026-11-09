# Сборка портативного «Чистильщика диска» БЕЗ PyInstaller.
#
# Почему так: exe-файлы, собранные PyInstaller, Защитник Windows часто ложно помечает как троян
# (у нас было Trojan:Win32/Wacatac.B!ml — это эвристика «!ml», не настоящая сигнатура).
# Здесь программа запускается официальным python.exe с подписью Python Software Foundation,
# а сама она — открытый текст cleaner.py + ui/. Ничего не упаковывается и не распаковывается в temp.
#
# Результат: portable/Чистильщик диска/  и  Чистильщик-диска.zip
#   Запустить Чистильщик.bat
#   ПРОЧИТАЙ.txt
#   app/cleaner.py, app/ui/...
#   app/runtime/  python.exe, python3XX.dll, python3XX.zip (стандартная библиотека), *.pyd
import importlib.util
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.base_prefix
VER = f"{sys.version_info.major}{sys.version_info.minor}"
PORTABLE = os.path.join(HERE, "portable")
OUT = os.path.join(PORTABLE, "Чистильщик диска")
APP = os.path.join(OUT, "app")
RT = os.path.join(APP, "runtime")
ZIP_OUT = os.path.join(HERE, "Чистильщик-диска.zip")

SKIP_LIB_DIRS = {"test", "tests", "idlelib", "tkinter", "turtledemo", "ensurepip", "venv", "lib2to3", "site-packages",
                 "pydoc_data", "msilib", "sqlite3", "curses", "__pycache__", "__phello__", "Tools"}
SKIP_LIB_FILES = {"turtle.py", "antigravity.py", "this.py"}
SKIP_DLLS = {"_tkinter.pyd", "tcl86t.dll", "tk86t.dll", "_sqlite3.pyd", "sqlite3.dll", "_ssl.pyd", "libssl-3.dll",
             "libcrypto-3.dll", "_hashlib.pyd", "_msi.pyd", "_uuid.pyd", "xxlimited.pyd", "xxlimited_35.pyd"}
UI_SKIP = {"dev-models.html"}

BAT = "\r\n".join([
    "@echo off",
    "chcp 65001 >nul",
    "title Chistilshik diska",
    'cd /d "%~dp0app"',
    'if not exist "runtime\\python.exe" goto missing',
    '"runtime\\python.exe" cleaner.py %*',
    "if errorlevel 1 pause",
    "exit /b",
    ":missing",
    "echo Folder app\\runtime is missing. Unpack the WHOLE archive, not just this file.",
    "pause",
    "",
])


def step(msg):
    print("•", msg, flush=True)


def copy_runtime():
    os.makedirs(RT)
    for name in ("python.exe", "python3.dll", f"python{VER}.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
        shutil.copy2(os.path.join(SRC, name), RT)
    shutil.copy2(os.path.join(SRC, "LICENSE.txt"), os.path.join(RT, "PYTHON-LICENSE.txt"))
    n = 0
    for e in os.scandir(os.path.join(SRC, "DLLs")):
        low = e.name.lower()
        if not low.endswith((".pyd", ".dll")) or low in SKIP_DLLS or low.startswith(("_test", "_ctypes_test")):
            continue
        shutil.copy2(e.path, RT)
        n += 1
    step(f"рантайм: python.exe + {n} модулей из DLLs")


def build_stdlib_zip():
    lib = os.path.join(SRC, "Lib")
    dst = os.path.join(RT, f"python{VER}.zip")
    count = 0
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, dirs, files in os.walk(lib):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_LIB_DIRS)
            for f in sorted(files):
                if not f.endswith(".py") or f in SKIP_LIB_FILES:
                    continue
                src = os.path.join(root, f)
                rel = os.path.relpath(src, lib).replace(os.sep, "/")
                try:
                    code = compile(open(src, "rb").read(), rel, "exec", dont_inherit=True)
                except (SyntaxError, ValueError):
                    continue
                data = importlib.util.MAGIC_NUMBER + b"\x00\x00\x00\x00" + b"\x00" * 8
                import marshal
                z.writestr(rel[:-3] + ".pyc", data + marshal.dumps(code))
                count += 1
    with open(os.path.join(RT, f"python{VER}._pth"), "w", encoding="ascii", newline="\r\n") as f:
        f.write(f"python{VER}.zip\n.\n..\n")
    step(f"стандартная библиотека: {count} модулей, {os.path.getsize(dst) / 1048576:.1f} МБ")


def copy_app():
    shutil.copy2(os.path.join(HERE, "cleaner.py"), APP)
    shutil.copytree(os.path.join(HERE, "ui"), os.path.join(APP, "ui"), ignore=lambda d, names: [n for n in names if n in UI_SKIP])
    with open(os.path.join(OUT, "Запустить Чистильщик.bat"), "w", encoding="ascii", newline="") as f:
        f.write(BAT)
    shutil.copy2(os.path.join(PORTABLE, "ПРОЧИТАЙ.txt"), OUT)
    step("программа, интерфейс, .bat и инструкция скопированы")


def self_check():
    py = os.path.join(RT, "python.exe")
    r = subprocess.run([py, "cleaner.py", "--selftest"], cwd=APP, capture_output=True, timeout=600,
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    out = r.stdout.decode("utf-8", "ignore")
    if "SELFTEST OK" not in out:
        print(out[-3000:], r.stderr.decode("utf-8", "ignore")[-3000:])
        raise SystemExit("selftest в портативной сборке НЕ прошёл")
    step("selftest портативной сборки: OK")
    port = 8799
    p = subprocess.Popen([py, "cleaner.py", "--no-browser", "--port", str(port)], cwd=APP,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                ok = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=2).status == 200
                html = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2).read()
                js = urllib.request.urlopen(f"http://127.0.0.1:{port}/vendor/three.module.min.js", timeout=5).read()
                if ok and b"app.js" in html and len(js) > 100000:
                    step(f"сервер портативной сборки отвечает: интерфейс и 3D-библиотека отдаются (порт {port})")
                    break
            except OSError:
                time.sleep(0.5)
        else:
            raise SystemExit("сервер портативной сборки не ответил")
    finally:
        p.terminate()


def make_zip():
    if os.path.exists(ZIP_OUT):
        os.remove(ZIP_OUT)
    with zipfile.ZipFile(ZIP_OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, dirs, files in os.walk(OUT):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for f in files:
                if f == "cleaner_data.json":  # личная история не должна попасть в архив
                    continue
                full = os.path.join(root, f)
                z.write(full, os.path.join("Чистильщик диска", os.path.relpath(full, OUT)))
    with zipfile.ZipFile(ZIP_OUT) as z:
        bad = z.testzip()
        n = len(z.infolist())
    if bad:
        raise SystemExit(f"битый файл в архиве: {bad}")
    step(f"архив: {ZIP_OUT} — {n} файлов, {os.path.getsize(ZIP_OUT) / 1048576:.1f} МБ, CRC OK")


if __name__ == "__main__":
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    copy_runtime()
    build_stdlib_zip()
    copy_app()
    self_check()
    for leftover in ("__pycache__",):
        shutil.rmtree(os.path.join(APP, leftover), ignore_errors=True)
    make_zip()
    print("Готово:", OUT)
