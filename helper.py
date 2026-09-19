"""버망호 도우미 로컬 서버 — `python -m http.server` 대신 쓴다 (표준 라이브러리만 쓴다).

하는 일
  1. 이 폴더를 http://localhost:PORT 로 서빙한다 (예전과 같다).
  2. POST /helper/key    — 게임에 키 입력을 보낸다 (성과 스캔이 곡을 넘길 때). Windows 전용.
                           맨 앞 창이 DJMAX가 아니면 누르지 않고 거절한다 — 사용자가 브라우저를 누르면 스캔이 멈추는 원리.
  3. POST /helper/upload — V-ARCHIVE에 기록 하나를 올린다. 그 API는 브라우저 페이지에서 부를 수 없어서(CORS) 여기서 대신 보낸다.
  4. GET  /helper/status — 떠 있는지, 지금 맨 앞 창 제목이 무엇인지.

안전장치
  - 127.0.0.1에만 붙는다 (python -m http.server는 0.0.0.0이라 같은 네트워크에서도 열렸다).
  - /helper/* 는 Host가 localhost/127.0.0.1이고 X-VMH 헤더가 붙은 요청만 받는다.
    다른 사이트가 사용자 브라우저를 통해 몰래 보내는 요청(헤더를 못 붙이거나 사전 확인에서 막힌다)과
    DNS 리바인딩(Host가 다르다)을 거른다.
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

VERSION = 1
HOST = '127.0.0.1'
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
        super().end_headers()

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
        host = (self.headers.get('Host') or '').split(':')[0]
        if host not in ('localhost', '127.0.0.1'):
            return False
        if self.headers.get('X-VMH') != '1':
            return False
        origin = self.headers.get('Origin')
        if origin and not re.match(r'^http://(localhost|127\.0\.0\.1)(:\d+)?$', origin):
            return False
        return True

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 64 * 1024:
            return None
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except ValueError:
            return None

    def do_GET(self):
        if self.path.startswith('/helper/'):
            if not self._allowed():
                return self._json(403, {'ok': False, 'error': 'forbidden'})
            if self.path == '/helper/status':
                return self._json(200, {'ok': True, 'version': VERSION, 'windows': IS_WIN,
                                        'foreground': foreground_title()})
            return self._json(404, {'ok': False, 'error': 'not found'})
        return super().do_GET()

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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    root = os.path.dirname(os.path.abspath(__file__))
    server = ThreadingHTTPServer((HOST, port), partial(Handler, directory=root))
    print(f'버망호 도우미: http://localhost:{port}/index.html  (helper v{VERSION}{"" if IS_WIN else ", 키 입력 없음"})')
    print('이 창을 닫으면 서버가 꺼집니다.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
