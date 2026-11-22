import { redisService } from '../services/redis.service.js';
import { fetchLiveVehiclesFromStride } from '../services/stride.service.js';

const POLL_INTERVAL_MS = 15_000;

export class ActiveRoutePollingWorker {
  private timer: NodeJS.Timeout | null = null;
  private isTickRunning = false;

  async runCycle(): Promise<number> {
    if (this.isTickRunning) {
      return 0;
    }

    this.isTickRunning = true;
    try {
      const activeRoutes = await redisService.pruneAndGetActiveRoutes(Date.now());
      if (activeRoutes.length === 0) {
        return 0;
      }

      // allSettled: one failing route (Stride timeout, bad line ref) must not block the others.
      const results = await Promise.allSettled(
        activeRoutes.map(async ({ routeId, directionId }) => {
          const freshState = await fetchLiveVehiclesFromStride(routeId, directionId);
          await redisService.setBusState(routeId, directionId, freshState);
        })
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`[PollingWorker] ${failed}/${activeRoutes.length} route refreshes failed`);
      }

      return activeRoutes.length;
    } catch (error) {
      console.error('[PollingWorker] Cycle failed:', (error as Error).message);
      return 0;
    } finally {
      this.isTickRunning = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runCycle();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
    console.log(`[PollingWorker] Started Active Route Tracking loop (${POLL_INTERVAL_MS / 1000}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const pollingWorker = new ActiveRoutePollingWorker();
