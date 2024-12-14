const RedisStats = require('./RedisStats');
const MemoryStats = require('./MemoryStats');

class StatsFactory {
    static async createStats(channelId) {
        // Check if stats are enabled
        if (process.env.ENABLE_STATS === 'false') {
            return new NoOpStats(channelId);
        }

        const storageType = process.env.STATS_STORAGE || 'memory';
        
        try {
            if (storageType === 'redis') {
                const RedisStats = require('./RedisStats');
                const stats = new RedisStats(channelId);
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
            const MemoryStats = require('./MemoryStats');
            return new MemoryStats(channelId);
        }
    }
}

// Add a NoOp (no operation) stats class that does nothing
class NoOpStats extends require('./BaseStats') {
    async updateStats() { return { uniqueUsers: [], totalMessages: 0 }; }
    async getStats() { return { uniqueUsers: [], totalMessages: 0 }; }
    async cleanup() {}
    reset() {}
}

module.exports = StatsFactory; 