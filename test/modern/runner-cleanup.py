"""Bounded dummy-child regressions; no target application or external access."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
class Cleanup(unittest.TestCase):
    def test_owned_groups_reaped(self):
        for runner in ['run-isolated.py', 'run-hidden-isolated.py']:
            for failure in os.environ.get('RUNNER_FAILURES', 'exception,sigterm').split(','):
                with self.subTest(runner=runner, failure=failure), tempfile.TemporaryDirectory(dir=Path.home()/'.hermes/cache/scratch') as tmp:
                    home = Path(tmp); scratch = home/'.hermes/cache/scratch/test'; scratch.mkdir(parents=True)
                    spec = importlib.util.spec_from_file_location('runner', ROOT/'scripts'/runner)
                    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
                    real_popen = subprocess.Popen; children = []
                    def launch(*args, **kwargs):
                        child = real_popen([sys.executable, '-c', 'import time; time.sleep(30)'], start_new_session=True)
                        children.append(child); return child
                    def ps(args, **kwargs):
                        if '-U' in args:return b'1\n'
                        if failure == 'exception': raise RuntimeError('watchdog probe failure')
                        os.kill(os.getpid(), signal.SIGTERM)
                    old_handler = signal.getsignal(signal.SIGTERM)
                    try:
                        with patch.object(Path, 'home', return_value=home), patch.object(sys, 'argv', ['runner',str(scratch),str(scratch),'node']), patch.object(subprocess, 'Popen', side_effect=launch), patch.object(subprocess, 'check_output', side_effect=ps):
                            with self.assertRaises((RuntimeError,SystemExit)):module.main()
                        self.assertEqual(len(children),1)
                        self.assertIsNotNone(children[0].poll(), 'runner left owned child alive')
                        with self.assertRaises(ProcessLookupError):os.killpg(children[0].pid,0)
                    finally:
                        signal.signal(signal.SIGTERM,old_handler)
                        for child in children:
                            if child.poll() is None:os.killpg(child.pid,signal.SIGKILL)
                            child.wait()
if __name__ == '__main__':unittest.main()
