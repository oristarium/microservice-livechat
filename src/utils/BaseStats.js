const EventEmitter = require('events');

class BaseStats extends EventEmitter {
    constructor(channelId) {
        super();
        this.channelId = channelId;
    }

    async updateStats(author) {
        throw new Error('updateStats must be implemented');
    }

    async getStats() {
        throw new Error('getStats must be implemented');
    }

    async getTopUsers(limit = 10) {
        const stats = await this.getStats();
        return stats.uniqueUsers
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, limit);
    }

    async cleanup() {
        throw new Error('cleanup must be implemented');
    }

    reset() {
        throw new Error('reset must be implemented');
    }
}

module.exports = BaseStats; 