const Redis = require('ioredis');
const BaseStats = require('./BaseStats');

class RedisStats extends BaseStats {
    constructor(channelId, redisUrl) {
        super(channelId);
        this.redis = new Redis(redisUrl);
        this.cacheTimeout = 5000;
        this.lastUpdate = 0;
        this.cachedStats = null;
    }

    async updateStats(author) {
        const now = Date.now();
        const key = `stats:${this.channelId}`;
        
        // Rate limiting
        const rateLimitKey = `ratelimit:${this.channelId}:${author.id}`;
        const canUpdate = await this.redis.set(rateLimitKey, '1', 'PX', 100, 'NX');
        if (!canUpdate) return;

        const multi = this.redis.multi();
        
        multi.hincrby(key, 'totalMessages', 1);
        
        const userKey = `${key}:users:${author.id}`;
        multi.hincrby(userKey, 'messageCount', 1);
        multi.hset(userKey, {
            username: author.username,
            display_name: author.display_name,
            roles: JSON.stringify(author.roles)
        });
        
        multi.expire(key, 86400);
        multi.expire(userKey, 86400);
        
        await multi.exec();
        
        this.cachedStats = null;
        const stats = await this.getStats();
        this.emit('statsUpdated', stats);
        return stats;
    }

    async getStats() {
        if (this.cachedStats && Date.now() - this.lastUpdate < this.cacheTimeout) {
            return this.cachedStats;
        }

        const key = `stats:${this.channelId}`;
        const totalMessages = await this.redis.hget(key, 'totalMessages') || 0;
        
        const userKeys = await this.redis.keys(`${key}:users:*`);
        const users = await Promise.all(userKeys.map(async (userKey) => {
            const userData = await this.redis.hgetall(userKey);
            return {
                id: userKey.split(':').pop(),
                ...userData,
                roles: JSON.parse(userData.roles),
                messageCount: parseInt(userData.messageCount)
            };
        }));

        this.cachedStats = {
            uniqueUsers: users,
            totalMessages: parseInt(totalMessages)
        };
        this.lastUpdate = Date.now();

        return this.cachedStats;
    }

    async cleanup() {
        await this.redis.quit();
    }

    reset() {
        this.cachedStats = null;
    }
}

module.exports = RedisStats; 