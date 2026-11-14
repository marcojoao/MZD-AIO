#!/usr/bin/env python3
"""Run a reviewed command in a prepared macOS scratch copy (no downloads).
Usage: python3 scripts/run-isolated.py SCRATCH WORKDIR COMMAND [ARG ...]
Task 6 can reuse this runner; it does not launch an application itself.
"""
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import time


def main():
    scratch = Path(sys.argv[1]).resolve(strict=True)
    cwd = Path(sys.argv[2]).resolve(strict=True)
    home = Path.home().resolve()
    approved = (home / '.hermes/cache/scratch').resolve()
    if not scratch.is_relative_to(approved) or scratch == approved:
        raise SystemExit('SCRATCH must be a dedicated directory below Hermes scratch')
    if not cwd.is_relative_to(scratch):
        raise SystemExit('WORKDIR must be within SCRATCH')
    for name in ('home', 'tmp', 'cache'):
        (scratch / name).mkdir(exist_ok=True)
    for name in ('user.npmrc', 'global.npmrc'):
        (scratch / name).write_text('')
    profile = scratch / 'execution.sb'
    profile.write_text('''(version 1)
(deny default)
(allow process-fork process-exec)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read*)
(deny file-read* (subpath (param "PRIVATE_HOME")))
(allow file-read-metadata)
(allow file-read* (subpath (param "SCRATCH")))
(allow file-write* (subpath (param "SCRATCH")))
(allow file-write-data (literal "/dev/null"))
''')
    env = {'PATH': str(scratch / 'bin') + ':/usr/bin:/bin',
           'HOME': str(scratch / 'home'), 'TMPDIR': str(scratch / 'tmp'),
           'XDG_CACHE_HOME': str(scratch / 'cache'), 'CI': '1',
           'ELECTRON_SKIP_BINARY_DOWNLOAD': '1', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD': '1',
           'npm_config_cache': str(scratch / 'cache/npm'),
           'npm_config_userconfig': str(scratch / 'user.npmrc'),
           'npm_config_globalconfig': str(scratch / 'global.npmrc'),
           'npm_config_ignore_scripts': 'true', 'npm_config_audit': 'false',
           'npm_config_fund': 'false', 'npm_config_offline': 'true'}
    process_count = len(subprocess.check_output(['/bin/ps', '-U', str(os.getuid()), '-o', 'pid=']).splitlines())

    def limits():
        resource.setrlimit(resource.RLIMIT_CPU, (300, 300))
        resource.setrlimit(resource.RLIMIT_FSIZE, (200 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
        soft, hard = resource.getrlimit(resource.RLIMIT_NPROC)
        cap = process_count + 300
        if hard != resource.RLIM_INFINITY:
            cap = min(cap, hard)
        resource.setrlimit(resource.RLIMIT_NPROC, (cap, hard))

    command = ['/usr/bin/sandbox-exec', '-f', str(profile), '-D', 'SCRATCH=' + str(scratch),
               '-D', 'PRIVATE_HOME=' + str(home)] + sys.argv[3:]
    def interrupted(signum, frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, interrupted)
    child = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True, preexec_fn=limits)
    try:
        start = time.monotonic()
        # macOS does not enforce RLIMIT_AS; enforce an aggregate process-group RSS cap.
        while child.poll() is None:
            rows = subprocess.check_output(['/bin/ps', '-axo', 'pgid=,rss='], text=True).splitlines()
            rss = sum(int(row.split()[1]) for row in rows if row.split()[0] == str(child.pid))
            if rss > 2 * 1024 * 1024 or time.monotonic() - start > 600:
                raise SystemExit('Isolation watchdog: memory/time limit exceeded')
            time.sleep(0.1)
    finally:
        # Reap only the process group owned by this runner, on every exit path.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
    return child.returncode


if __name__ == '__main__':
    sys.exit(main())
