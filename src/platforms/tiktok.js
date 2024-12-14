const { WebcastPushConnection } = require('tiktok-live-connector');
const StatsFactory = require('../utils/StatsFactory');

// Helper functions
function transformBadges(badges) {
    if (!badges || !Array.isArray(badges)) return [];
    return badges.map(badge => ({
        type: badge.type === 'pm_mt_moderator_im' ? 'moderator' : 'custom',
        label: badge.name || '',
        image_url: badge.url || null
    }));
}

function transformTikTokMessage(tikTokMessage) {
    // Pre-render the message as HTML
    const rawHtml = `<span class="text">${tikTokMessage.comment}</span>`;

    return {
        type: 'chat',
        platform: 'tiktok',
        timestamp: tikTokMessage.createTime,
        message_id: tikTokMessage.msgId || crypto.randomUUID(),
        room_id: tikTokMessage.userId,
        data: {
            author: {
                id: tikTokMessage.userId,
                username: tikTokMessage.uniqueId,
                display_name: tikTokMessage.nickname,
                avatar_url: tikTokMessage.profilePictureUrl,
                roles: {
                    broadcaster: false, // TikTok doesn't provide this in chat messages
                    moderator: tikTokMessage.isModerator,
                    subscriber: tikTokMessage.isSubscriber,
                    verified: false // TikTok doesn't provide this in chat messages
                },
                badges: transformBadges(tikTokMessage.userBadges)
            },
            content: {
                raw: tikTokMessage.comment,
                formatted: tikTokMessage.comment,
                sanitized: tikTokMessage.comment,
                elements: [{
                    type: 'text',
                    value: tikTokMessage.comment,
                    position: [0, tikTokMessage.comment.length]
                }],
                rawHtml: rawHtml
            },
            metadata: {
                type: 'chat'
            }
        }
    };
}

class TikTokChatHandler {
    constructor(identifier) {
        this.liveChat = new WebcastPushConnection(identifier);
        this.chatStats = StatsFactory.createStats(identifier, {
            storage: process.env.STATS_STORAGE || 'memory',
            redisUrl: process.env.REDIS_URL
        });
    }

    async start(onStart, onChat, onEnd, onError, onStatsUpdate) {
        try {
            // Connect to TikTok live chat
            await this.liveChat.connect();
            
            // Call onStart with room info
            const state = this.liveChat.getState();
            onStart(state);

            // Set up chat event handler
            this.liveChat.on('chat', (chatData) => {
                const transformedMessage = transformTikTokMessage(chatData);
                
                // Update stats when receiving a chat message
                this.chatStats.updateStats(transformedMessage.data.author)
                    .then(stats => {
                        if (onStatsUpdate) {
                            onStatsUpdate(stats);
                        }
                    });
                
                onChat(transformedMessage);
            });

            // Handle stream end
            this.liveChat.on('streamEnd', () => {
                this.chatStats.reset();
                onEnd();
            });

            // Handle errors
            this.liveChat.on('error', onError);

            // Set up stats update handler
            if (onStatsUpdate) {
                this.chatStats.on('statsUpdated', onStatsUpdate);
            }

            return true;
        } catch (error) {
            onError(error);
            return false;
        }
    }

    async stop() {
        try {
            // Stop the chat first
            if (this.liveChat) {
                this.liveChat.disconnect();
            }
            // Then cleanup stats
            if (this.chatStats) {
                await this.chatStats.cleanup();
            }
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    async cleanup() {
        await this.stop();
    }

    getCurrentStats() {
        return this.chatStats.getStats();
    }
}

module.exports = {
    TikTokChatHandler
}; 