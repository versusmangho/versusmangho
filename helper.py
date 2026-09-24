"""버망호 도우미 로컬 서버 — `python -m http.server` 대신 쓴다 (표준 라이브러리만 쓴다).

두 가지로 쓴다
  - python helper.py (start.bat): 이 폴더를 서빙하고 /helper/*도 연다. 로컬에서 개발·사용할 때.
  - vmh-helper.exe (build-helper.bat로 만들어 download/에 둔다, 웹 페이지가 내려받게 한다): /helper/*만 연다.
    콘솔 창 없이 트레이(시계 옆) 아이콘으로 뜬다 (run_tray). 로그는 임시 폴더의 vmh-helper.log.
    파일은 서빙하지 않는다 — exe가 놓인 폴더(보통 다운로드 폴더)를 열어 두면 안 되니까.
    웹(GitHub Pages·onrender)의 성과 스캔이 http://127.0.0.1:8777 로 부른다.

하는 일
  1. (python helper.py일 때만) 이 폴더를 http://localhost:PORT 로 서빙한다.
  2. POST /helper/key    — 게임에 키 입력을 보낸다 (성과 스캔이 곡을 넘길 때). Windows 전용.
                           맨 앞 창이 DJMAX가 아니면 누르지 않고 거절한다 — 사용자가 브라우저를 누르면 스캔이 멈추는 원리.
                           자동 방장 봇은 activate를 붙여 보낸다 — 그때는 게임 창을 앞으로 불러온 뒤 누른다.
  2-1. POST /helper/clipboard — 클립보드에 한 줄을 넣는다 (자동 방장 봇의 채팅 안내). 같은 포그라운드 검사를 받는다.
  2-2. POST /helper/restore — 봇이 게임을 불러오기 전에 앞에 있던 창으로 돌려놓는다.
  3. POST /helper/upload — V-ARCHIVE에 기록 하나를 올린다. 그 API는 브라우저 페이지에서 부를 수 없어서(CORS) 여기서 대신 보낸다.
  4. GET  /helper/status — 떠 있는지, 지금 맨 앞 창 제목이 무엇인지.
  5. (exe일 때만) vmh:// 주소를 자기 앞으로 등록해 둔다 — 웹 페이지의 '도우미 켜기'가 이 주소로 프로그램을 켠다.

안전장치
  - 127.0.0.1에만 붙는다 (python -m http.server는 0.0.0.0이라 같은 네트워크에서도 열렸다).
  - 모든 요청은 Host가 localhost/127.0.0.1이어야 한다 (DNS 리바인딩을 거른다).
  - /helper/* 는 X-VMH 헤더가 붙어 있고, Origin이 있으면 ALLOWED_ORIGINS 중 하나여야 한다.
    X-VMH 헤더 때문에 다른 사이트의 요청은 반드시 CORS 사전 확인(OPTIONS)을 거치고, 허용된 출처에만 답한다.
  - 업로드는 v-archive.net의 기록 등록 주소 하나로만 보낸다. 계정 파일은 저장하지 않는다.

실행: python helper.py [포트]   (기본 8777, start.bat이 부른다)
"""
import ctypes
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VERSION = 7                              # 2: 웹에서 부를 수 있게 CORS·exe / 3: onrender 출처, exe는 트레이로 / 4: vmh:// 로 웹에서 켜기 / 5: 자동 방장 봇용 키·붙여넣기·클립보드 / 6: 방 다시 만들기용 F3·Backspace / 7: 봇이 게임 창을 앞으로 불러온다(activate·restore)
HOST = '127.0.0.1'
DEFAULT_PORT = 8777                      # 웹 페이지가 http://127.0.0.1:8777 로 부른다 — 바꾸면 scan/app.js의 HELPER_URL도
FROZEN = getattr(sys, 'frozen', False)   # PyInstaller로 만든 exe
# /helper/*를 부를 수 있는 페이지 — 웹 버전 + 로컬(start.bat·개발 서버)
ALLOWED_ORIGINS = re.compile(r'^(https://versusmangho\.(github\.io|onrender\.com)|http://(localhost|127\.0\.0\.1)(:\d+)?)$')
SITE_DEFAULT = 'https://versusmangho.github.io/versusmangho/'
site_seen = {'url': None}                # 마지막으로 이 프로그램을 부른 웹 페이지 — 트레이의 '성과 스캔 열기'가 연다
GAME_TITLE = 'DJMAX'                     # 맨 앞 창 제목에 이게 들어 있어야 키를 보낸다
UPLOAD_URL = 'https://v-archive.net/client/open/{}/score'
UUID_RE = re.compile(r'^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')
CLIP_MAX = 200                           # 게임 채팅 한 줄 — 이보다 길면 잘라서 넣는다
PATTERNS = ('NORMAL', 'HARD', 'MAXIMUM', 'SC')

# ── Windows 키 입력 (SendInput) ─────────────────
# 게임은 스캔 코드로 키를 읽는 경우가 많아 가상 키가 아니라 스캔 코드로 보낸다.
# 방향키는 확장 키라 EXTENDEDKEY를 같이 켠다.
KEYS = {'down': (0x50, True), 'up': (0x48, True), 'left': (0x4B, True), 'right': (0x4D, True),
        'enter': (0x1C, False), 'esc': (0x01, False), 'tab': (0x0F, False), 'shift': (0x2A, False),
        'backspace': (0x0E, False), 'f3': (0x3D, False), 'f5': (0x3F, False), 'f9': (0x43, False)}
# 조합 키 — 앞의 것을 누른 채 뒤의 것을 치고 거꾸로 둔다. 지금은 붙여넣기(Ctrl+V) 하나뿐이다.
COMBOS = {'paste': [(0x1D, False), (0x2F, False)]}
IS_WIN = sys.platform == 'win32'

if IS_WIN:
    from ctypes import wintypes

    ULONG_PTR = ctypes.c_size_t
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x1, 0x2, 0x8

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('mouseData', wintypes.DWORD),
                    ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ULONG_PTR)]

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD),
                    ('time', wintypes.DWORD), ('dwExtraInfo', ULONG_PTR)]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [('uMsg', wintypes.DWORD), ('wParamL', wintypes.WORD), ('wParamH', wintypes.WORD)]

    class _INPUTUNION(ctypes.Union):
        # 가장 큰 MOUSEINPUT까지 넣어야 INPUT 크기가 Windows가 기대하는 값과 같아진다
        _fields_ = [('mi', MOUSEINPUT), ('ki', KEYBDINPUT), ('hi', HARDWAREINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [('type', wintypes.DWORD), ('u', _INPUTUNION)]

    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    user32.SendInput.restype = wintypes.UINT
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)

    def window_title(hwnd):
        if not hwnd:
            return ''
        buf = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(hwnd, buf, 512)
        return buf.value

    def foreground_title():
        return window_title(user32.GetForegroundWindow())

    # ── 게임 창을 앞으로 (자동 방장 봇) ─────────────────
    # SendInput은 맨 앞 창으로만 간다. 봇을 돌리는 동안 사용자가 다른 창을 쓰고 있어도 키가 게임에 들어가게,
    # 누르기 직전에 게임 창을 앞으로 불러오고(activate) 일이 끝나면 원래 창으로 돌려놓는다(restore).
    # 창에 키 메시지를 직접 보내는(PostMessage) 길은 게임이 포커스 없는 창의 입력을 무시하므로 쓰지 않는다.
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = (WNDENUMPROC, wintypes.LPARAM)
    user32.IsWindowVisible.argtypes = (wintypes.HWND,)
    user32.IsWindow.argtypes = (wintypes.HWND,)
    user32.IsIconic.argtypes = (wintypes.HWND,)
    user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
    user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
    user32.BringWindowToTop.argtypes = (wintypes.HWND,)
    user32.GetClassNameW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.AttachThreadInput.argtypes = (wintypes.DWORD, wintypes.DWORD, wintypes.BOOL)
    _k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    _k32.OpenProcess.restype = wintypes.HANDLE
    _k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    _k32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))
    _k32.CloseHandle.argtypes = (wintypes.HANDLE,)
    # 제목에 DJMAX가 들어간 브라우저 탭(V-ARCHIVE 등)을 게임으로 잘못 부르지 않게 — 실행 파일 이름을 먼저 본다
    BROWSER_CLASSES = ('Chrome_WidgetWin', 'MozillaWindowClass')
    focus_saved = {'prev': None}   # 게임을 불러오기 전에 앞에 있던 창 — restore가 돌려놓는다

    def window_exe(hwnd):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        h = _k32.OpenProcess(0x1000, False, pid.value)   # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ''
        try:
            buf, size = ctypes.create_unicode_buffer(520), wintypes.DWORD(520)
            return buf.value if _k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)) else ''
        finally:
            _k32.CloseHandle(h)

    def find_game():
        by_exe, by_title = [], []

        def each(hwnd, _):
            if user32.IsWindowVisible(hwnd) and is_game(window_title(hwnd)):
                if 'djmax' in os.path.basename(window_exe(hwnd)).lower():
                    by_exe.append(hwnd)
                else:
                    cls = ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(hwnd, cls, 256)
                    if not cls.value.startswith(BROWSER_CLASSES):
                        by_title.append(hwnd)
            return True
        user32.EnumWindows(WNDENUMPROC(each), 0)
        return (by_exe or by_title or [None])[0]

    def bring_to_front(hwnd):
        """hwnd를 맨 앞으로. 윈도우는 뒤에 있는 프로그램이 포커스를 가져가는 것을 막으므로
        지금 앞 창의 입력 스레드에 잠깐 붙어서(AttachThreadInput) 부르고, 그래도 안 되면 Alt를 누른 채로 부른다"""
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)   # SW_RESTORE
        fg = user32.GetForegroundWindow()
        me = _k32.GetCurrentThreadId()
        fg_tid = user32.GetWindowThreadProcessId(fg, None) if fg else 0
        attached = bool(fg_tid and fg_tid != me and user32.AttachThreadInput(me, fg_tid, True))
        try:
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(me, fg_tid, False)
        if user32.GetForegroundWindow() != hwnd:
            # Alt를 누르고 있는 동안은 포커스 전환이 허용된다. 뗄 때는 이미 새 창이 앞이라 원래 창에 메뉴가 열리지 않는다
            send_scan(0x38, False, False)
            user32.SetForegroundWindow(hwnd)
            send_scan(0x38, False, True)
        for _ in range(25):   # 전환이 실제로 끝날 때까지 (전체화면 게임은 조금 걸린다)
            if user32.GetForegroundWindow() == hwnd:
                return True
            time.sleep(0.02)
        return False

    def activate_game():
        """게임 창이 앞에 있으면 True. 아니면 불러와 보고 된 경우만 True — 원래 앞에 있던 창은 기억해 둔다"""
        if is_game(foreground_title()):
            return True
        game = find_game()
        if not game:
            return False
        prev = user32.GetForegroundWindow()
        if not bring_to_front(game):
            return False
        if focus_saved['prev'] is None and prev and prev != game:
            focus_saved['prev'] = prev
        time.sleep(0.12)   # 앞으로 온 직후 첫 키를 게임이 흘리지 않게
        return True

    def restore_focus():
        """activate_game 전에 앞에 있던 창으로 돌려놓는다 — 그새 사용자가 직접 다른 창으로 옮겼으면 그대로 둔다"""
        prev, focus_saved['prev'] = focus_saved['prev'], None
        if not prev or not user32.IsWindow(prev) or not is_game(foreground_title()):
            return False
        return bring_to_front(prev)

    def send_scan(scan, extended, up):
        flags = KEYEVENTF_SCANCODE | (KEYEVENTF_EXTENDEDKEY if extended else 0) | (KEYEVENTF_KEYUP if up else 0)
        inp = INPUT(type=1, u=_INPUTUNION(ki=KEYBDINPUT(wVk=0, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=0)))
        return user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT)) == 1

    def press(key, hold_ms):
        if key in COMBOS:
            keys = COMBOS[key]
            for scan, ext in keys:
                if not send_scan(scan, ext, False):
                    return False
                time.sleep(0.02)
            time.sleep(hold_ms / 1000)
            ok = True
            for scan, ext in reversed(keys):   # 누른 반대로 뗴다 — Ctrl을 먼저 떼면 V가 맨 글자로 들어간다
                ok = send_scan(scan, ext, True) and ok
            return ok
        scan, ext = KEYS[key]
        if not send_scan(scan, ext, False):
            return False
        time.sleep(hold_ms / 1000)
        return send_scan(scan, ext, True)

    # ── 클립보드 ───────────────
    # 자동 방장 봇이 인게임 채팅에 붙여넣기로 안내문을 보낸다. 게임 채팅은 한 글자씩 치는 것보다
    # 붙여넣는 것이 훨씬 빠르고(한글 입력기를 거치지 않는다), 중간에 끊겨도 즐 내용이 반씩 나가지 않는다.
    CF_UNICODETEXT, GMEM_MOVEABLE = 13, 0x0002
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalAlloc.argtypes = (wintypes.UINT, ctypes.c_size_t)
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalLock.argtypes = (wintypes.HGLOBAL,)
    kernel32.GlobalUnlock.argtypes = (wintypes.HGLOBAL,)
    kernel32.GlobalFree.argtypes = (wintypes.HGLOBAL,)
    user32.OpenClipboard.argtypes = (wintypes.HWND,)
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.SetClipboardData.argtypes = (wintypes.UINT, wintypes.HANDLE)

    def set_clipboard(text):
        buf = ctypes.create_unicode_buffer(text)
        size = ctypes.sizeof(buf)
        handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        if not handle:
            return False
        ptr = kernel32.GlobalLock(handle)
        if not ptr:
            kernel32.GlobalFree(handle)
            return False
        ctypes.memmove(ptr, buf, size)
        kernel32.GlobalUnlock(handle)
        # 다른 프로그램이 클립보드를 잠긐 잡고 있을 수 있다 — 몇 번 다시 두드린다
        for _ in range(5):
            if user32.OpenClipboard(None):
                break
            time.sleep(0.02)
        else:
            kernel32.GlobalFree(handle)
            return False
        try:
            user32.EmptyClipboard()
            if not user32.SetClipboardData(CF_UNICODETEXT, handle):
                kernel32.GlobalFree(handle)
                return False
        finally:
            user32.CloseClipboard()
        return True                            # 성공하면 메모리는 클립보드가 가져간다 (GlobalFree 금지)
else:
    def foreground_title():
        return ''

    def activate_game():
        return False

    def restore_focus():
        return False

    def press(key, hold_ms):
        return False

    def set_clipboard(text):
        return False


def is_game(title):
    return GAME_TITLE.lower() in (title or '').lower()


key_lock = threading.Lock()   # 서버는 요청마다 스레드를 띄운다 — 창 불러오기와 키 입력이 서로 끼어들지 않게


class Server(ThreadingHTTPServer):
    # 윈도우에서는 SO_REUSEADDR이 켜져 있으면 이미 쓰는 포트에도 그냥 붙는다 — 도우미가 둘 뜨면 요청이 갈려서
    # 어떤 키는 먹고 어떤 키는 안 먹는다. 그래서 윈도우에서는 끄고, 붙기 실패로 '이미 켜져 있음'을 가린다.
    # (유닉스는 껐다 켰을 때 TIME_WAIT 때문에 한동안 못 붙으므로 그대로 둔다)
    allow_reuse_address = not IS_WIN


class Handler(SimpleHTTPRequestHandler):
    # 서빙하는 파일은 캐시하지 않는다 — 코드를 고친 뒤 새로고침하면 바로 반영되도록
    def end_headers(self):
        if not self.path.startswith('/helper/'):
            self.send_header('Cache-Control', 'no-store')
        else:
            origin = self.headers.get('Origin')
            if origin and ALLOWED_ORIGINS.match(origin):
                if origin.startswith('https://'):
                    site_seen['url'] = origin + ('/versusmangho/' if origin.endswith('github.io') else '/')
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
        super().end_headers()

    def _host_ok(self):
        return (self.headers.get('Host') or '').split(':')[0] in ('localhost', '127.0.0.1')

    # CORS 사전 확인 — 웹 페이지(https)가 X-VMH 헤더를 붙여 부르면 브라우저가 먼저 보낸다.
    # Access-Control-Allow-Private-Network: 공개 사이트가 127.0.0.1을 부를 때 Chrome(PNA)이 요구하는 답
    def do_OPTIONS(self):
        origin = self.headers.get('Origin') or ''
        ok = self.path.startswith('/helper/') and self._host_ok() and ALLOWED_ORIGINS.match(origin)
        self.send_response(204 if ok else 403)
        if ok:
            self.send_header('Access-Control-Allow-Methods', 'GET, POST')
            self.send_header('Access-Control-Allow-Headers', 'X-VMH, Content-Type')
            self.send_header('Access-Control-Max-Age', '600')
            if self.headers.get('Access-Control-Request-Private-Network') == 'true':
                self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, fmt, *args):
        # 스캔 중에는 초당 몇 번씩 /helper/key가 불린다 — 그 줄은 찍지 않는다
        if '/helper/key' in (self.path or ''):
            return
        super().log_message(fmt, *args)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _allowed(self):
        if not self._host_ok() or self.headers.get('X-VMH') != '1':
            return False
        origin = self.headers.get('Origin')
        return not origin or bool(ALLOWED_ORIGINS.match(origin))

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 64 * 1024:
            return None
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except ValueError:
            return None

    def do_GET(self):
        if not self._host_ok():
            return self._json(403, {'ok': False, 'error': 'forbidden'})
        if self.path.startswith('/helper/'):
            if not self._allowed():
                return self._json(403, {'ok': False, 'error': 'forbidden'})
            if self.path == '/helper/status':
                return self._json(200, {'ok': True, 'version': VERSION, 'windows': IS_WIN, 'exe': bool(FROZEN),
                                        'foreground': foreground_title()})
            return self._json(404, {'ok': False, 'error': 'not found'})
        if FROZEN:   # exe는 파일을 서빙하지 않는다 — 켜져 있는지만 알려 준다
            body = '버망호 도우미 프로그램이 켜져 있습니다. 웹 페이지의 성과 스캔 탭에서 쓰세요.'.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_HEAD(self):
        if FROZEN or not self._host_ok():
            return self._json(403, {'ok': False, 'error': 'forbidden'})
        return super().do_HEAD()

    def do_POST(self):
        if not self.path.startswith('/helper/') or not self._allowed():
            return self._json(403, {'ok': False, 'error': 'forbidden'})
        data = self._body()
        if not isinstance(data, dict):
            return self._json(400, {'ok': False, 'error': 'bad json'})
        if self.path == '/helper/key':
            return self._key(data)
        if self.path == '/helper/clipboard':
            return self._clipboard(data)
        if self.path == '/helper/restore':
            return self._restore()
        if self.path == '/helper/upload':
            return self._upload(data)
        return self._json(404, {'ok': False, 'error': 'not found'})

    def _key(self, data):
        key = data.get('key')
        hold = data.get('hold', 40)
        if (key not in KEYS and key not in COMBOS) or not isinstance(hold, (int, float)) or not 10 <= hold <= 500:
            return self._json(400, {'ok': False, 'error': 'bad key'})
        if not IS_WIN:
            return self._json(200, {'ok': False, 'error': 'windows-only'})
        with key_lock:
            err = self._focus(data)
            if err:
                return err
            if not press(key, hold):
                return self._json(200, {'ok': False, 'error': 'sendinput', 'code': ctypes.get_last_error()})
        return self._json(200, {'ok': True})

    # 맨 앞 창이 게임인지. activate가 참이면(자동 방장 봇) 게임 창을 앞으로 불러와 본다.
    # 성과 스캔은 activate를 안 보낸다 — 거기서는 '브라우저를 누르면 멈춘다'가 멈추는 방법이다.
    # 게임이면 None, 아니면 돌려줄 거절 답
    def _focus(self, data):
        if data.get('activate') is True and activate_game():
            return None
        title = foreground_title()
        if is_game(title):
            return None
        return self._json(200, {'ok': False, 'error': 'focus', 'foreground': title})

    # 자동 방장 봇이 한 가지 일을 마치면 부른다 — 게임을 불러오기 전에 앞에 있던 창으로 돌려놓는다
    def _restore(self):
        if not IS_WIN:
            return self._json(200, {'ok': False, 'error': 'windows-only'})
        with key_lock:
            return self._json(200, {'ok': True, 'restored': restore_focus()})

    # 자동 방장 봇의 채팅 안내 한 줄. 줄바꿈·탭은 지운다 — 게임 채팅에서는 엔터가 곧 전송이라
    # 줄바꿈이 섞이면 반 토막만 나간다. 길이도 채팅 한 줄에 맞춰 자른다.
    def _clipboard(self, data):
        text = data.get('text')
        if not isinstance(text, str):
            return self._json(400, {'ok': False, 'error': 'bad text'})
        text = re.sub(r'\s+', ' ', text).strip()[:CLIP_MAX]
        if not text:
            return self._json(400, {'ok': False, 'error': 'bad text'})
        if not IS_WIN:
            return self._json(200, {'ok': False, 'error': 'windows-only'})
        with key_lock:
            err = self._focus(data)
        if err:
            return err
        if not set_clipboard(text):
            return self._json(200, {'ok': False, 'error': 'clipboard'})
        return self._json(200, {'ok': True, 'text': text})

    def _upload(self, data):
        user_no, token, rec = data.get('userNo'), data.get('token'), data.get('record')
        if not isinstance(user_no, int) or user_no <= 0 or not isinstance(token, str) or not UUID_RE.match(token):
            return self._json(400, {'ok': False, 'error': 'bad account'})
        if not isinstance(rec, dict):
            return self._json(400, {'ok': False, 'error': 'bad record'})
        # 보내는 필드는 V-ARCHIVE 기록 등록 API가 받는 것만 골라 다시 만든다
        try:
            body = {'name': str(rec['name']), 'button': int(rec['button']), 'pattern': str(rec['pattern']),
                    'score': float(rec['score']), 'maxCombo': 1 if rec.get('maxCombo') else 0}
        except (KeyError, TypeError, ValueError):
            return self._json(400, {'ok': False, 'error': 'bad record'})
        if body['button'] not in (4, 5, 6, 8) or body['pattern'] not in PATTERNS or not 0 <= body['score'] <= 100:
            return self._json(400, {'ok': False, 'error': 'bad record'})
        if rec.get('composer'):
            body['composer'] = str(rec['composer'])
        req = urllib.request.Request(UPLOAD_URL.format(user_no), data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                                     method='POST', headers={'Content-Type': 'application/json', 'Authorization': token})
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                return self._json(200, {'ok': True, 'status': res.status, 'body': res.read().decode('utf-8', 'replace')})
        except urllib.error.HTTPError as e:
            return self._json(200, {'ok': False, 'status': e.code, 'body': e.read().decode('utf-8', 'replace')})
        except (urllib.error.URLError, OSError) as e:
            return self._json(200, {'ok': False, 'status': 0, 'body': str(e)})


APP_NAME = '버망호 도우미'


def message_box(text, warn=False):
    if IS_WIN:
        ctypes.windll.user32.MessageBoxW(None, text, APP_NAME, 0x30 if warn else 0x40)   # MB_ICONWARNING / MB_ICONINFORMATION


# ── vmh:// 주소 등록 (exe 전용) ─────────────────
# 웹 페이지에서 단추 하나로 이 프로그램을 켜기 위한 것. 브라우저는 페이지가 프로그램을 직접 실행하게 두지 않지만,
# 등록된 주소 스킴은 "여시겠습니까?"를 한 번 물은 뒤 열어 준다 (줌·디스코드가 쓰는 방식).
# HKCU에만 쓰므로 관리자 권한이 필요 없고, 처음 한 번 실행해야 등록된다 — 그 전에는 웹의 '도우미 켜기'가 아무 일도 못 한다.
# 주소 내용(%1)은 일부러 넘기지 않는다: 아무 사이트나 vmh://를 걸 수 있으니 이 프로그램은 '켜기' 말고 아무것도 받지 않는다.
# 켜진 뒤에 실제로 키를 누르고 업로드하는 것은 그대로 X-VMH 헤더와 ALLOWED_ORIGINS가 막는다.
def register_scheme():
    if not (IS_WIN and FROZEN):
        return
    import winreg
    cmd = f'"{sys.executable}" --from-url'
    try:
        # 이미 같은 자리에 등록돼 있으면 건드리지 않는다 (exe를 옮기면 새 경로로 다시 쓴다)
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\vmh\shell\open\command') as k:
                if winreg.QueryValueEx(k, None)[0] == cmd:
                    return
        except OSError:
            pass
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\vmh') as k:
            winreg.SetValueEx(k, None, 0, winreg.REG_SZ, 'URL:' + APP_NAME)
            winreg.SetValueEx(k, 'URL Protocol', 0, winreg.REG_SZ, '')
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\vmh\DefaultIcon') as k:
            winreg.SetValueEx(k, None, 0, winreg.REG_SZ, f'"{sys.executable}",0')
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\vmh\shell\open\command') as k:
            winreg.SetValueEx(k, None, 0, winreg.REG_SZ, cmd)
        print('vmh:// 등록:', cmd)
    except OSError as e:
        print('vmh:// 등록 실패:', e)


# ── 트레이 아이콘 (exe 전용) ─────────────────
# exe는 콘솔 창 없이(--noconsole) 뜨고 알림 영역(시계 옆)에 아이콘만 둔다. 표준 라이브러리만 쓰려고 Win32를 ctypes로 부른다.
# 메뉴: 성과 스캔 열기 / 끄기. 아이콘을 두 번 누르면 성과 스캔을 연다. 탐색기가 다시 뜨면(TaskbarCreated) 아이콘을 다시 단다.
def run_tray(server, port):
    import threading
    import webbrowser
    from ctypes import wintypes

    u32, s32, k32 = ctypes.windll.user32, ctypes.windll.shell32, ctypes.windll.kernel32
    LRESULT = ctypes.c_ssize_t
    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    u32.DefWindowProcW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    u32.DefWindowProcW.restype = LRESULT
    u32.CreateWindowExW.restype = wintypes.HWND
    u32.CreateWindowExW.argtypes = (wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID)
    u32.CreatePopupMenu.restype = wintypes.HMENU
    u32.AppendMenuW.argtypes = (wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR)
    u32.TrackPopupMenu.argtypes = (wintypes.HMENU, wintypes.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.LPVOID)
    u32.PostMessageW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    s32.ExtractIconW.restype = wintypes.HICON
    s32.ExtractIconW.argtypes = (wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT)
    k32.GetModuleHandleW.restype = wintypes.HMODULE

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [('style', wintypes.UINT), ('lpfnWndProc', WNDPROC), ('cbClsExtra', ctypes.c_int), ('cbWndExtra', ctypes.c_int),
                    ('hInstance', wintypes.HINSTANCE), ('hIcon', wintypes.HICON), ('hCursor', wintypes.HANDLE),
                    ('hbrBackground', wintypes.HBRUSH), ('lpszMenuName', wintypes.LPCWSTR), ('lpszClassName', wintypes.LPCWSTR)]

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [('cbSize', wintypes.DWORD), ('hWnd', wintypes.HWND), ('uID', wintypes.UINT), ('uFlags', wintypes.UINT),
                    ('uCallbackMessage', wintypes.UINT), ('hIcon', wintypes.HICON), ('szTip', wintypes.WCHAR * 128),
                    ('dwState', wintypes.DWORD), ('dwStateMask', wintypes.DWORD), ('szInfo', wintypes.WCHAR * 256),
                    ('uVersion', wintypes.UINT), ('szInfoTitle', wintypes.WCHAR * 64), ('dwInfoFlags', wintypes.DWORD),
                    ('guidItem', ctypes.c_byte * 16), ('hBalloonIcon', wintypes.HICON)]

    WM_DESTROY, WM_COMMAND, WM_USER = 0x0002, 0x0111, 0x0400
    WM_TRAY = WM_USER + 20
    WM_LBUTTONDBLCLK, WM_RBUTTONUP, WM_LBUTTONUP = 0x0203, 0x0205, 0x0202
    NIM_ADD, NIM_DELETE = 0, 2
    NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 0x1, 0x2, 0x4, 0x10
    MF_STRING, MF_GRAYED, MF_SEPARATOR = 0x0, 0x1, 0x800
    TPM_RIGHTBUTTON, TPM_RETURNCMD = 0x2, 0x100
    CMD_OPEN, CMD_QUIT = 1, 2
    taskbar_created = u32.RegisterWindowMessageW('TaskbarCreated')
    tip = f'{APP_NAME} v{VERSION} — 켜져 있음 (127.0.0.1:{port})'

    def open_site():
        webbrowser.open((site_seen['url'] or SITE_DEFAULT) + '#scan')

    def icon_data(info=None):
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd, nid.uID = hwnd, 1
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | (NIF_INFO if info else 0)
        nid.uCallbackMessage, nid.hIcon, nid.szTip = WM_TRAY, hicon, tip[:127]
        if info:
            nid.szInfoTitle, nid.szInfo = APP_NAME, info
        return nid

    def show_menu():
        menu = u32.CreatePopupMenu()
        u32.AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, tip)
        u32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
        u32.AppendMenuW(menu, MF_STRING, CMD_OPEN, '성과 스캔 열기')
        u32.AppendMenuW(menu, MF_STRING, CMD_QUIT, '끄기')
        pt = wintypes.POINT()
        u32.GetCursorPos(ctypes.byref(pt))
        u32.SetForegroundWindow(hwnd)   # 이게 없으면 메뉴 밖을 눌러도 메뉴가 안 닫힌다
        cmd = u32.TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD, pt.x, pt.y, 0, hwnd, None)
        u32.PostMessageW(hwnd, 0, 0, 0)
        u32.DestroyMenu(menu)
        if cmd == CMD_OPEN:
            open_site()
        elif cmd == CMD_QUIT:
            u32.DestroyWindow(hwnd)

    def wndproc(h, msg, wp, lp):
        if msg == WM_TRAY:
            if lp == WM_RBUTTONUP or lp == WM_LBUTTONUP:
                show_menu()
            elif lp == WM_LBUTTONDBLCLK:
                open_site()
            return 0
        if msg == taskbar_created:
            s32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(icon_data()))
            return 0
        if msg == WM_DESTROY:
            s32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(icon_data()))
            u32.PostQuitMessage(0)
            return 0
        return u32.DefWindowProcW(h, msg, wp, lp)

    proc = WNDPROC(wndproc)   # 창이 사는 동안 참조를 잡아 둔다 (GC되면 죽는다)
    hinst = k32.GetModuleHandleW(None)
    wc = WNDCLASSW(lpfnWndProc=proc, hInstance=hinst, lpszClassName='VMHHelperTray')
    u32.RegisterClassW(ctypes.byref(wc))
    hwnd = u32.CreateWindowExW(0, 'VMHHelperTray', APP_NAME, 0, 0, 0, 0, 0, None, None, hinst, None)
    hicon = s32.ExtractIconW(hinst, sys.executable, 0) or u32.LoadIconW(None, ctypes.c_wchar_p(32512))

    threading.Thread(target=server.serve_forever, daemon=True).start()
    s32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(icon_data(
        '켜졌습니다. 이 아이콘(시계 옆)으로 끄거나 성과 스캔을 열 수 있습니다. 브라우저가 "이 기기의 다른 앱 및 서비스에 액세스"를 물으면 허용하세요.')))
    msg = wintypes.MSG()
    while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        u32.TranslateMessage(ctypes.byref(msg))
        u32.DispatchMessageW(ctypes.byref(msg))
    server.shutdown()


def main():
    args = sys.argv[1:]
    from_url = '--from-url' in args                       # vmh:// 로 켜졌다 — 웹 페이지의 '도우미 켜기'
    nums = [a for a in args if a.isdigit()]
    port = int(nums[0]) if nums else DEFAULT_PORT
    root = os.path.dirname(os.path.abspath(__file__))
    if FROZEN and sys.stdout is None:
        # 창 없는 exe에는 stdout/stderr가 없다 — http.server가 요청마다 로그를 쓰다 죽지 않게 임시 폴더의 로그 파일로 보낸다
        import tempfile
        sys.stdout = sys.stderr = open(os.path.join(tempfile.gettempdir(), 'vmh-helper.log'), 'w', encoding='utf-8', buffering=1)
    # 콘솔 코드 페이지(cp949)에 없는 글자(—)를 찍다가 죽지 않게 — exe를 파이프로 띄우면 실제로 죽었다
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass
    try:
        server = Server((HOST, port), partial(Handler, directory=root))
    except OSError:
        if from_url:
            return                                        # 이미 켜져 있는데 웹에서 또 켜라고 한 것뿐이다 — 조용히 끝낸다
        text = f'{port}번 포트를 이미 쓰고 있습니다. 도우미 프로그램(트레이의 아이콘)이나 start.bat이 벌써 켜져 있는지 확인하세요.'
        print(text)
        if FROZEN:
            message_box(text, warn=True)
        return
    register_scheme()
    print(f'{APP_NAME} v{VERSION}: 127.0.0.1:{port}' + ('' if FROZEN else f'  →  http://localhost:{port}/index.html') + ('' if IS_WIN else ' (키 입력 없음)'))
    if FROZEN and IS_WIN:
        run_tray(server, port)
        return
    if IS_WIN:
        ctypes.windll.kernel32.SetConsoleTitleW(APP_NAME)
    print('이 창을 닫으면 꺼집니다.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
