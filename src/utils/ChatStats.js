const Redis = require('ioredis');
const EventEmitter = require('events');

class ChatStats extends EventEmitter {
    constructor(channelId) {
        super();
        try {
            this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
            this.useRedis = true;
        } catch (error) {
            console.warn('Redis not available, falling back to in-memory storage');
            this.useRedis = false;
            this.userStats = new Map();
            this.totalMessages = 0;
        }
        this.channelId = channelId;
        this.cacheTimeout = 5000; // 5 seconds
        this.lastUpdate = 0;
        this.cachedStats = null;
    }

    async updateStats(author) {
        if (!this.useRedis) {
            // Fall back to original in-memory implementation
            const userId = author.id;
            if (!this.userStats.has(userId)) {
                this.userStats.set(userId, {
                    id: userId,
                    username: author.username,
                    display_name: author.display_name,
                    avatar_url: author.avatar_url,
                    roles: author.roles,
                    messageCount: 0
                });
            }
            const userStat = this.userStats.get(userId);
            userStat.messageCount++;
            this.totalMessages++;
            
            const stats = {
                uniqueUsers: Array.from(this.userStats.values()),
                totalMessages: this.totalMessages
            };
            this.emit('statsUpdated', stats);
            return stats;
        }

        // Redis implementation
        const now = Date.now();
        const key = `stats:${this.channelId}`;
        
        // Simple rate limiting - one update per 100ms per user
        const rateLimitKey = `ratelimit:${this.channelId}:${author.id}`;
        const canUpdate = await this.redis.set(rateLimitKey, '1', 'PX', 100, 'NX');
        if (!canUpdate) return;

        const multi = this.redis.multi();
        
        // Update total messages
        multi.hincrby(key, 'totalMessages', 1);
        
        // Update user stats
        const userKey = `${key}:users:${author.id}`;
        multi.hincrby(userKey, 'messageCount', 1);
        multi.hset(userKey, {
            username: author.username,
            display_name: author.display_name,
            roles: JSON.stringify(author.roles)
        });
        
        // Set expiry (e.g., 24 hours after last message)
        multi.expire(key, 86400);
        multi.expire(userKey, 86400);
        
        await multi.exec();
        
        // Invalidate cache
        this.cachedStats = null;
        
        // Emit updated stats
        const stats = await this.getStats();
        this.emit('statsUpdated', stats);
        return stats;
    }

    async getStats() {
        if (!this.useRedis) {
            return {
                uniqueUsers: Array.from(this.userStats.values()),
                totalMessages: this.totalMessages
            };
        }

        // Return cached stats if within timeout
        if (this.cachedStats && Date.now() - this.lastUpdate < this.cacheTimeout) {
            return this.cachedStats;
        }

        const key = `stats:${this.channelId}`;
        const totalMessages = await this.redis.hget(key, 'totalMessages') || 0;
        
        // Get all user keys
        const userKeys = await this.redis.keys(`${key}:users:*`);
        const users = await Promise.all(userKeys.map(async (userKey) => {
            const userData = await this.redis.hgetall(userKey);
            return {
                id: userKey.split(':').pop(), // Extract user ID from key
                ...userData,
                roles: JSON.parse(userData.roles),
                messageCount: parseInt(userData.messageCount)
            };
        }));

        // Cache the results
        this.cachedStats = {
            uniqueUsers: users,
            totalMessages: parseInt(totalMessages)
        };
        this.lastUpdate = Date.now();

        return this.cachedStats;
    }

    async getTopUsers(limit = 10) {
        const stats = await this.getStats();
        return stats.uniqueUsers
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, limit);
    }

    async cleanup() {
        if (this.useRedis) {
            // Clean up Redis connection when done
            await this.redis.quit();
        }
        // Clear in-memory data
        this.userStats = new Map();
        this.totalMessages = 0;
        this.cachedStats = null;
    }

    reset() {
        if (!this.useRedis) {
            this.userStats = new Map();
            this.totalMessages = 0;
            return;
        }
        // Redis cleanup will happen through expiry
        this.cachedStats = null;
    }
}

module.exports = ChatStats; 