import { describe, it, expect } from 'vitest';
import { parseThrottleReasons } from '../server/services/gpuMonitor.js';

const SAMPLE_SMI_Q = `
==============NVSMI LOG==============
Timestamp                                 : Sun Aug 21 12:00:00 2026
Driver Version                           : 550.54.15
CUDA Version                              : 12.4

Attached GPUs                             : 2
GPU 0
    Name                                  : NVIDIA GeForce RTX 4090
   温度                                    : 55 C
    ...
    Clocks Throttle Reasons
        Idle                                : Not Active
        Sw Power Cap                        : Active
        Hw Power Brake                      : Not Active
        Sw Thermal Slowdown                 : Not Active
        Hw Thermal Slowdown                 : Not Active
        Sw Power Brake                      : Not Active
        Sync Boost                          : Not Active
        Sw Thermal Violation                : Not Active
        Hw Thermal Violation                : Not Active

GPU 1
    Name                                  : NVIDIA GeForce RTX 4090
   温度                                    : 50 C
    ...
    Clocks Throttle Reasons
        Idle                                : Active
        Sw Power Cap                        : Not Active
        Hw Power Brake                      : Not Active
        Sw Thermal Slowdown                 : Not Active
        Hw Thermal Slowdown                 : Not Active
        Sw Power Brake                      : Not Active
        Sync Boost                          : Not Active
        Sw Thermal Violation                : Not Active
        Hw Thermal Violation                : Not Active
`;

describe('parseThrottleReasons', () => {
  it('returns active throttle reasons for GPU 0', () => {
    const reasons = parseThrottleReasons(SAMPLE_SMI_Q, 0);
    expect(reasons).toEqual(['Sw Power Cap']);
  });

  it('returns active throttle reasons for GPU 1', () => {
    const reasons = parseThrottleReasons(SAMPLE_SMI_Q, 1);
    expect(reasons).toEqual(['Idle']);
  });

  it('returns empty array for non-existent GPU', () => {
    const reasons = parseThrottleReasons(SAMPLE_SMI_Q, 99);
    expect(reasons).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const reasons = parseThrottleReasons('', 0);
    expect(reasons).toEqual([]);
  });

  it('returns empty when no throttle section present', () => {
    const input = 'GPU 0\n    Name: RTX 4090\n    Temperature: 55 C\n';
    const reasons = parseThrottleReasons(input, 0);
    expect(reasons).toEqual([]);
  });

  it('handles multiple active reasons', () => {
    const input = `
GPU 0
    Clocks Throttle Reasons
        Idle                : Active
        Sw Power Cap        : Active
        Hw Thermal Slowdown : Active
`;
    const reasons = parseThrottleReasons(input, 0);
    expect(reasons).toEqual(['Idle', 'Sw Power Cap', 'Hw Thermal Slowdown']);
  });
});
