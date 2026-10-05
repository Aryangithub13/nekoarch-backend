"""Exercise release-runner failure propagation without running external gates."""
import contextlib
import io
import json
import pathlib
import runpy
import subprocess
import tempfile
from unittest.mock import patch

main=runpy.run_path('scripts/verify-phase23.py')['main']
namespace=main.__globals__
results=[]
for mode in ['success','failed_gate','source_drift','missing_executable']:
    calls=[0]
    def run(*args, **kwargs):
        calls[0]+=1
        if mode=='missing_executable' and calls[0]==2:
            raise FileNotFoundError('synthetic missing gate')
        return subprocess.CompletedProcess(args[0],1 if mode=='failed_gate' and calls[0]==2 else 0)
    def manifest():
        return {'fixture.ts':'changed' if mode=='source_drift' and calls[0]>=2 else 'original'}
    with tempfile.TemporaryDirectory(prefix='phase23-runner-control-') as temporary:
        namespace['out']=pathlib.Path(temporary)
        namespace['manifest']=manifest
        with patch.object(subprocess,'run',run),contextlib.redirect_stdout(io.StringIO()):
            status=main()
        rows=json.loads((pathlib.Path(temporary)/'verification.json').read_text())
        assert status==(0 if mode=='success' else 1),mode
        assert calls[0]==len(rows) and calls[0]>=29,'Runner failed to record remaining gates'
        if mode=='failed_gate':assert rows[1]['exitCode']==1
        if mode=='missing_executable':assert rows[1]['exitCode']==127
        if mode=='source_drift':assert not rows[-1]['sourceUnchanged']
        results.append({'control':mode,'exitCode':status,'recordedGates':len(rows)})
print(json.dumps(results,indent=2))
