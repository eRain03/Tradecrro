import { Router } from 'express';
import rateLimitMonitor from '../../core/monitoring/RateLimitMonitor';

const router = Router();

/**
 * Get API rate limit status
 */
router.get('/rate-limits', (req, res) => {
  try {
    const health = rateLimitMonitor.getSystemHealth();
    const statuses = rateLimitMonitor.getAllStatuses();

    res.json({
      health,
      statuses,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get rate limit status' });
  }
});

export default router;