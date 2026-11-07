import json
import subprocess
import sys

process = subprocess.Popen([sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def send(sequence, kind, **fields):
    process.stdin.write(json.dumps(dict(version=1, sequence=sequence, type=kind, **fields)) + '\n')
    process.stdin.flush()

def event(sequence, kind):
    assert json.loads(process.stdout.readline()) == dict(version=1, sequence=sequence, type=kind)

try:
    send(0, 'open', id='valid')
    event(0, 'ready')
    send(1, 'play', wav='UklGRiYAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQIAAAAAAA==')
    event(1, 'started')
    send(2, 'pause')
    event(2, 'paused')
    process.stdin.close()
    event(3, 'canceled')
    event(4, 'retired')
    assert process.wait(timeout=3) == 0
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
