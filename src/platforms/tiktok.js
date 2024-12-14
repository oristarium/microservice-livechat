const { WebcastPushConnection } = require('tiktok-live-connector');

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
                
                onChat(transformedMessage);
            });

            // Handle stream end
            this.liveChat.on('streamEnd', () => {
                onEnd();
            });

            // Handle errors
            this.liveChat.on('error', onError);

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
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    async cleanup() {
        await this.stop();
    }
}

module.exports = {
    TikTokChatHandler
}; 