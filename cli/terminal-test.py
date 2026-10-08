"""Drive a real terminal for CLI regression tests; no third-party dependencies."""
import errno
import json
import os
import pty
import select
import subprocess
import sys
import time

steps = json.loads(sys.argv[1])
master, slave = pty.openpty()
process = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = b""
cursor = 0
deadline = time.monotonic() + 15
try:
    while time.monotonic() < deadline:
        if steps and steps[0][0].encode() in output[cursor:]:
            prompt, answer = steps.pop(0)
            cursor = output.index(prompt.encode(), cursor) + len(prompt.encode())
            os.write(master, answer.encode())
        if select.select([master], [], [], 0.05)[0]:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
            if not data:
                break
            output += data
        elif process.poll() is not None:
            break
    else:
        raise RuntimeError("Terminal test timed out")
    code = process.wait(timeout=2)
    if steps:
        raise RuntimeError("Process exited before expected prompts: " + output.decode())
    print(json.dumps({"code": code, "output": output.decode()}))
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)
