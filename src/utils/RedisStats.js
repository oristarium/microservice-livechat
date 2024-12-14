const Redis = require('ioredis');
const BaseStats = require('./BaseStats');
const v8 = require('v8');

class RedisStats extends BaseStats {
    constructor(channelId) {
        super(channelId);
        this.redis = new Redis(process.env.REDIS_URL, {
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            reconnectOnError: function(err) {
                const targetError = 'READONLY';
                if (err.message.includes(targetError)) {
                    return true;
                }
                return false;
            }
        });

        this.redis.on('error', (error) => {
            console.error('Redis connection error:', error);
        });

        this.redis.on('connect', () => {
            console.log('Connected to Redis');
        });

        this.cacheTimeout = 5000;
        this.lastUpdate = 0;
        this.cachedStats = null;

        this.MAX_USERS = 1000;
        this.CLEANUP_INTERVAL = 3600000;

        setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
        setInterval(() => {
            this.cachedStats = null;
        }, this.cacheTimeout);
    }

    async updateStats(author) {
        const now = Date.now();
        const key = `stats:${this.channelId}`;
        
        const userKeys = await this.redis.keys(`stats:${this.channelId}:users:*`);
        if (userKeys.length >= this.MAX_USERS) {
            const oldestKey = userKeys[0];
            await this.redis.del(oldestKey);
        }
        
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
            roles: JSON.stringify(author.roles),
            lastUpdate: Date.now()
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

        // Add memory stats
        const heapStats = v8.getHeapStatistics();
        this.cachedStats.memoryUsage = {
            used: Math.round(heapStats.used_heap_size / (1024 * 1024)),
            total: Math.round(heapStats.heap_size_limit / (1024 * 1024)),
            percentage: Math.round((heapStats.used_heap_size / heapStats.heap_size_limit) * 100)
        };

        return this.cachedStats;
    }

    async cleanup() {
        try {
            if (this.redis && this.redis.status !== 'end') {
                const key = `stats:${this.channelId}`;
                const userKeys = await this.redis.keys(`${key}:users:*`);
                
                const yesterday = Date.now() - (24 * 60 * 60 * 1000);
                for (const userKey of userKeys) {
                    const lastUpdate = await this.redis.hget(userKey, 'lastUpdate');
                    if (lastUpdate && parseInt(lastUpdate) < yesterday) {
                        await this.redis.del(userKey);
                    }
                }
                
                if (userKeys.length > this.MAX_USERS) {
                    const toDelete = userKeys.slice(this.MAX_USERS);
                    await Promise.all(toDelete.map(key => this.redis.del(key)));
                }
            }
        } catch (error) {
            console.error('Error during Redis cleanup:', error);
        }
    }

    reset() {
        this.cachedStats = null;
    }
}

module.exports = RedisStats; 