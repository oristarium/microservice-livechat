const RedisStats = require('./RedisStats');
const MemoryStats = require('./MemoryStats');

class StatsFactory {
    static async createStats(channelId) {
        const storageType = process.env.STATS_STORAGE || 'memory';
        
        try {
            if (storageType === 'redis') {
                const RedisStats = require('./RedisStats');
                const stats = new RedisStats(channelId);
                // Wait for Redis connection to be ready
                await new Promise((resolve, reject) => {
                    stats.redis.once('ready', resolve);
                    stats.redis.once('error', reject);
                });
                return stats;
            } else {
                const MemoryStats = require('./MemoryStats');
                return new MemoryStats(channelId);
            }
        } catch (error) {
            console.error(`Failed to create stats for ${storageType}:`, error);
            // Fallback to memory stats if Redis fails
            const MemoryStats = require('./MemoryStats');
            return new MemoryStats(channelId);
        }
    }
}

module.exports = StatsFactory; 