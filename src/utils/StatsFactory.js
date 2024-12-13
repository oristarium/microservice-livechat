const RedisStats = require('./RedisStats');
const MemoryStats = require('./MemoryStats');

class StatsFactory {
    static createStats(channelId, options = {}) {
        const { storage = 'memory', redisUrl } = options;

        switch (storage) {
            case 'redis':
                if (!redisUrl) {
                    console.warn('Redis URL not provided, falling back to memory storage');
                    return new MemoryStats(channelId);
                }
                try {
                    return new RedisStats(channelId, redisUrl);
                } catch (error) {
                    console.warn('Redis connection failed, falling back to memory storage');
                    return new MemoryStats(channelId);
                }
            case 'memory':
            default:
                return new MemoryStats(channelId);
        }
    }
}

module.exports = StatsFactory; 