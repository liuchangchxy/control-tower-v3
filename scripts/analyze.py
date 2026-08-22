import re, statistics
text = open('/tmp/gpuburn.out').read()

samples = [tuple(int(x) for x in m.groups()) for m in re.finditer(r'temps: (\d+) C - (\d+) C - (\d+) C', text)]
print(f'Total samples: {len(samples)}')
for i, name in enumerate(['GPU 0 (CMP 50HX)', 'GPU 1 (2080 Ti)', 'GPU 2 (2080 Ti)']):
    col = [r[i] for r in samples]
    print(f'  {name}: min={min(col)} max={max(col)} avg={statistics.mean(col):.1f} stdev={statistics.stdev(col):.2f}')

# GFLOPS - require >0 to filter out DIED
gf_pattern = re.compile(r"proc'd: \d+ \((\d+) Gflop/s\) - \d+ \((\d+) Gflop/s\) - \d+ \((\d+) Gflop/s\)")
gf = [tuple(int(x) for x in m.groups()) for m in gf_pattern.finditer(text)]
print(f'\nTotal GFLOPs samples: {len(gf)}')
for i, name in enumerate(['GPU 0 (CMP 50HX)', 'GPU 1 (2080 Ti)', 'GPU 2 (2080 Ti)']):
    col = [r[i] for r in gf if r[i] > 0]
    if col:
        print(f'  {name}: avg={statistics.mean(col):.0f} GFLOPs min={min(col)} max={max(col)}')

# Check OK/FAULTY verdict line
verdict = re.findall(r'GPU \d+: (OK|FAULTY)', text)
print(f'\nVerdicts: {verdict}')

# Peak temp timestamps - derive time of peak
peak_gpu1 = max(r[1] for r in samples)
print(f'\nPeak temp 2080 Ti #1: {peak_gpu1} C')
peak_gpu2 = max(r[2] for r in samples)
print(f'Peak temp 2080 Ti #2: {peak_gpu2} C')
