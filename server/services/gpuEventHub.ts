import { EventEmitter } from 'node:events';
import type { GPUInfo } from '../types.js';
import { getGPUSnapshot } from './gpuMonitor.js';

export class GpuEventHub {
  private readonly emitter = new EventEmitter();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subscribers = 0;
  private running = false;
  private latest: GPUInfo[] | null = null;
  subscribe(callback: (data: GPUInfo[]) => void): () => void {
    this.emitter.on('gpu', callback); this.subscribers++;
    if (!this.running) { this.running = true; void this.tick(); }
    if (this.latest) callback(this.latest);
    return () => { this.emitter.off('gpu', callback); this.subscribers = Math.max(0, this.subscribers - 1); if (!this.subscribers) this.stop(); };
  }
  private async tick() {
    if (!this.running) return;
    try { this.latest = await getGPUSnapshot(); this.emitter.emit('gpu', this.latest); } catch (err) { console.error('GPU monitor error:', err); }
    if (this.running) this.timer = setTimeout(() => void this.tick(), 2000);
  }
  private stop() { this.running = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
}
export const gpuEventHub = new GpuEventHub();
