// src/services/serviceRegistry.ts
// Logical service health registry. Each service module registers on boot
// and reports its operational status. Exposes a unified health endpoint.
export class ServiceRegistry {
    static services = new Map();
    /**
     * Register a service as starting. Called at the beginning of each service's boot sequence.
     */
    static register(name, metadata = {}) {
        this.services.set(name, {
            name,
            status: 'STARTING',
            startedAt: new Date(),
            lastHeartbeat: new Date(),
            metadata,
            errorCount: 0
        });
        console.log(`📋 ServiceRegistry: Registered [${name}]`);
    }
    /**
     * Mark a service as healthy. Called after successful boot sequence completion.
     */
    static markHealthy(name, metadata = {}) {
        const existing = this.services.get(name);
        if (existing) {
            existing.status = 'HEALTHY';
            existing.lastHeartbeat = new Date();
            existing.metadata = { ...existing.metadata, ...metadata };
        }
    }
    /**
     * Mark a service as degraded (still running but with reduced functionality).
     */
    static markDegraded(name, reason) {
        const existing = this.services.get(name);
        if (existing) {
            existing.status = 'DEGRADED';
            existing.lastHeartbeat = new Date();
            existing.lastError = reason;
            existing.errorCount++;
        }
        console.warn(`⚠️ ServiceRegistry: [${name}] marked DEGRADED — ${reason}`);
    }
    /**
     * Mark a service as unhealthy (critical failure, not processing requests).
     */
    static markUnhealthy(name, error) {
        const existing = this.services.get(name);
        if (existing) {
            existing.status = 'UNHEALTHY';
            existing.lastError = error;
            existing.errorCount++;
        }
        console.error(`❌ ServiceRegistry: [${name}] marked UNHEALTHY — ${error}`);
    }
    /**
     * Update heartbeat timestamp. Services should call this periodically to indicate liveness.
     */
    static heartbeat(name, metadata) {
        const existing = this.services.get(name);
        if (existing) {
            existing.lastHeartbeat = new Date();
            if (metadata) {
                existing.metadata = { ...existing.metadata, ...metadata };
            }
            // Auto-recover to HEALTHY if previously degraded and heartbeating again
            if (existing.status === 'DEGRADED') {
                existing.status = 'HEALTHY';
            }
        }
    }
    /**
     * Returns the full health status of all registered services.
     * Used by the /api/v1/system/health endpoint.
     */
    static getHealth() {
        const allServices = Array.from(this.services.values());
        const hasUnhealthy = allServices.some(s => s.status === 'UNHEALTHY');
        const hasDegraded = allServices.some(s => s.status === 'DEGRADED' || s.status === 'STARTING');
        const overallStatus = hasUnhealthy ? 'UNHEALTHY' : hasDegraded ? 'DEGRADED' : 'HEALTHY';
        return {
            status: overallStatus,
            services: allServices,
            timestamp: new Date()
        };
    }
    /**
     * Returns a summary suitable for the observability dashboard.
     */
    static getSummary() {
        const summary = {};
        for (const [name, reg] of this.services.entries()) {
            summary[name] = reg.status;
        }
        return summary;
    }
}
export default ServiceRegistry;
