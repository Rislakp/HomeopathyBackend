import urllib.request
import re

url = 'https://admin.whitecoat.academy/version.json'
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        print('version.json:', resp.read().decode('utf-8'))
except Exception as e:
    print('version.json error:', e)

url2 = 'https://admin.whitecoat.academy/'
try:
    req = urllib.request.Request(url2, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        content = resp.read().decode('utf-8')
        print('index.html length:', len(content))
        for line in content.splitlines():
            if 'flutter.js' in line or 'main.dart.js' in line:
                print('HTML script line:', line.strip())
except Exception as e:
    print('index.html error:', e)

