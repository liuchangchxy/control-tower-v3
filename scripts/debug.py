import sys
sys.path.insert(0, "/home/chang")
import stress_gpu
print("PYNVML_OK:", stress_gpu.PYNVML_OK)
print("throttle_reasons module attr:", stress_gpu.throttle_reasons)

import pynvml as n
try:
    n.nvmlInit()
    h = n.nvmlDeviceGetHandleByIndex(2)
    r = stress_gpu.throttle_reasons(h)
    print("throttle_reasons returned:", type(r), r)
except Exception as e:
    print("fail:", type(e).__name__, e)
