"""버망호 도우미 로컬 서버 — `python -m http.server` 대신 쓴다 (표준 라이브러리만 쓴다).

두 가지로 쓴다
  - python helper.py (start.bat): 이 폴더를 서빙하고 /helper/*도 연다. 로컬에서 개발·사용할 때.
  - vmh-helper.exe (build-helper.bat로 만들어 download/에 둔다, 웹 페이지가 내려받게 한다): /helper/*만 연다.
    파일은 서빙하지 않는다 — exe가 놓인 폴더(보통 다운로드 폴더)를 열어 두면 안 되니까.
    웹(GitHub Pages)의 성과 스캔이 http://127.0.0.1:8777 로 부른다.

하는 일
  1. (python helper.py일 때만) 이 폴더를 http://localhost:PORT 로 서빙한다.
  2. POST /helper/key    — 게임에 키 입력을 보낸다 (성과 스캔이 곡을 넘길 때). Windows 전용.
                           맨 앞 창이 DJMAX가 아니면 누르지 않고 거절한다 — 사용자가 브라우저를 누르면 스캔이 멈추는 원리.
  3. POST /helper/upload — V-ARCHIVE에 기록 하나를 올린다. 그 API는 브라우저 페이지에서 부를 수 없어서(CORS) 여기서 대신 보낸다.
  4. GET  /helper/status — 떠 있는지, 지금 맨 앞 창 제목이 무엇인지.

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
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VERSION = 2                              # 2: 웹(GitHub Pages)에서 부를 수 있게 CORS·exe
HOST = '127.0.0.1'
DEFAULT_PORT = 8777                      # 웹 페이지가 http://127.0.0.1:8777 로 부른다 — 바꾸면 scan/app.js의 HELPER_URL도
FROZEN = getattr(sys, 'frozen', False)   # PyInstaller로 만든 exe
# /helper/*를 부를 수 있는 페이지 — 웹 버전 + 로컬(start.bat·개발 서버)
ALLOWED_ORIGINS = re.compile(r'^(https://versusmangho\.github\.io|http://(localhost|127\.0\.0\.1)(:\d+)?)$')
GAME_TITLE = 'DJMAX'                     # 맨 앞 창 제목에 이게 들어 있어야 키를 보낸다
UPLOAD_URL = 'https://v-archive.net/client/open/{}/score'
UUID_RE = re.compile(r'^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')
PATTERNS = ('NORMAL', 'HARD', 'MAXIMUM', 'SC')

# ── Windows 키 입력 (SendInput) ─────────────────
# 게임은 스캔 코드로 키를 읽는 경우가 많아 가상 키가 아니라 스캔 코드로 보낸다.
# 방향키는 확장 키라 EXTENDEDKEY를 같이 켠다.
KEYS = {'down': (0x50, True), 'up': (0x48, True)}
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

    def foreground_title():
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ''
        buf = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(hwnd, buf, 512)
        return buf.value

    def send_scan(scan, extended, up):
        flags = KEYEVENTF_SCANCODE | (KEYEVENTF_EXTENDEDKEY if extended else 0) | (KEYEVENTF_KEYUP if up else 0)
        inp = INPUT(type=1, u=_INPUTUNION(ki=KEYBDINPUT(wVk=0, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=0)))
        return user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT)) == 1

    def press(key, hold_ms):
        scan, ext = KEYS[key]
        if not send_scan(scan, ext, False):
            return False
        time.sleep(hold_ms / 1000)
        return send_scan(scan, ext, True)
else:
    def foreground_title():
        return ''

    def press(key, hold_ms):
        return False


def is_game(title):
    return GAME_TITLE.lower() in (title or '').lower()


class Handler(SimpleHTTPRequestHandler):
    # 서빙하는 파일은 캐시하지 않는다 — 코드를 고친 뒤 새로고침하면 바로 반영되도록
    def end_headers(self):
        if not self.path.startswith('/helper/'):
            self.send_header('Cache-Control', 'no-store')
        else:
            origin = self.headers.get('Origin')
            if origin and ALLOWED_ORIGINS.match(origin):
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
        if self.path == '/helper/upload':
            return self._upload(data)
        return self._json(404, {'ok': False, 'error': 'not found'})

    def _key(self, data):
        key = data.get('key')
        hold = data.get('hold', 40)
        if key not in KEYS or not isinstance(hold, (int, float)) or not 10 <= hold <= 500:
            return self._json(400, {'ok': False, 'error': 'bad key'})
        if not IS_WIN:
            return self._json(200, {'ok': False, 'error': 'windows-only'})
        title = foreground_title()
        if not is_game(title):
            return self._json(200, {'ok': False, 'error': 'focus', 'foreground': title})
        if not press(key, hold):
            return self._json(200, {'ok': False, 'error': 'sendinput', 'code': ctypes.get_last_error()})
        return self._json(200, {'ok': True})

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


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    root = os.path.dirname(os.path.abspath(__file__))
    # 콘솔 코드 페이지(cp949)에 없는 글자(—)를 찍다가 죽지 않게 — exe를 파이프로 띄우면 실제로 죽었다
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass
    if IS_WIN:
        ctypes.windll.kernel32.SetConsoleTitleW('버망호 도우미')
    try:
        server = ThreadingHTTPServer((HOST, port), partial(Handler, directory=root))
    except OSError:
        print(f'{port}번 포트를 이미 쓰고 있습니다 — 도우미 프로그램(또는 start.bat)이 벌써 켜져 있는지 확인하세요.')
        if FROZEN:   # 더블클릭으로 켠 창이 바로 닫히면 무슨 일인지 못 본다
            try:
                input('Enter를 누르면 닫습니다.')
            except EOFError:
                pass
        return
    if FROZEN:
        print(f'버망호 도우미 프로그램 v{VERSION} — 켜져 있습니다.')
        print('웹 페이지의 성과 스캔 탭이 이 프로그램으로 곡을 넘기고 V-ARCHIVE에 기록을 올립니다.')
        print('브라우저가 "로컬 네트워크의 기기 접근"을 물으면 허용하세요.')
    else:
        print(f'버망호 도우미: http://localhost:{port}/index.html  (helper v{VERSION}{"" if IS_WIN else ", 키 입력 없음"})')
    print('이 창을 닫으면 꺼집니다.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
