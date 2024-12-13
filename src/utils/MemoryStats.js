const BaseStats = require('./BaseStats');

class MemoryStats extends BaseStats {
    constructor(channelId) {
        super(channelId);
        this.reset();
    }

    reset() {
        this.userStats = new Map();
        this.totalMessages = 0;
    }

    async updateStats(author) {
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

    async getStats() {
        return {
            uniqueUsers: Array.from(this.userStats.values()),
            totalMessages: this.totalMessages
        };
    }

    async cleanup() {
        this.reset();
    }
}

module.exports = MemoryStats; 