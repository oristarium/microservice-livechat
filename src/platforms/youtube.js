const { LiveChat } = require('youtube-chat');

// Helper functions
function transformBadges(badge) {
    if (!badge) return [];
    return [{
        type: 'custom',
        label: badge.label,
        image_url: badge.thumbnail.url
    }];
}

function getRawMessage(messageArray) {
    return messageArray.map(element => 
        element.text || element.emojiText || ''
    ).join('');
}

function getFormattedMessage(messageArray) {
    return messageArray.map(element => {
        if (element.text) return element.text;
        if (element.emojiText) return `:${element.emojiText}:`;
        return '';
    }).join('');
}

function getSanitizedMessage(messageArray) {
    return messageArray
        .filter(element => element.text)
        .map(element => element.text)
        .join('');
}

function transformMessageElements(message) {
    let position = 0;
    return message.map(element => {
        const length = element.text?.length || element.emojiText?.length || 0;
        const result = {
            type: element.text ? 'text' : 'emote',
            value: element.text || element.emojiText,
            position: [position, position + length]
        };
        
        if (element.emojiText) {
            result.metadata = {
                url: element.url,
                alt: element.alt,
                is_custom: element.isCustomEmoji
            };
        }
        
        position += length;
        return result;
    });
}

function transformYouTubeMessage(ytMessage) {
    return {
        type: 'chat',
        platform: 'youtube',
        timestamp: ytMessage.timestamp.toISOString(),
        message_id: ytMessage.id || crypto.randomUUID(),
        room_id: ytMessage.channelId,
        data: {
            author: {
                id: ytMessage.author.channelId,
                username: ytMessage.author.name,
                display_name: ytMessage.author.name,
                avatar_url: ytMessage.author.thumbnail?.url,
                roles: {
                    broadcaster: ytMessage.isOwner,
                    moderator: ytMessage.isModerator,
                    subscriber: ytMessage.isMembership,
                    verified: ytMessage.isVerified
                },
                badges: transformBadges(ytMessage.author.badge)
            },
            content: {
                raw: getRawMessage(ytMessage.message),
                formatted: getFormattedMessage(ytMessage.message),
                sanitized: getSanitizedMessage(ytMessage.message),
                elements: transformMessageElements(ytMessage.message)
            },
            metadata: {
                type: ytMessage.superchat ? 'super_chat' : 'chat',
                monetary_data: ytMessage.superchat ? {
                    amount: ytMessage.superchat.amount,
                    formatted: ytMessage.superchat.amount,
                    color: ytMessage.superchat.color
                } : null,
                sticker: ytMessage.superchat?.sticker ? {
                    url: ytMessage.superchat.sticker.url,
                    alt: ytMessage.superchat.sticker.alt
                } : null
            }
        }
    };
}

class YouTubeChatHandler {
    constructor(identifier, identifierType) {
        let liveChatOptions = {};
        switch (identifierType) {
            case 'channelId':
                liveChatOptions.channelId = identifier;
                break;
            case 'username':
                liveChatOptions.handle = identifier;
                break;
            case 'liveId':
                liveChatOptions.liveId = identifier;
                break;
            default:
                throw new Error('Invalid identifier type');
        }
        this.liveChat = new LiveChat(liveChatOptions);
    }

    async start(onStart, onChat, onEnd, onError) {
        // Set up event handlers
        this.liveChat.on('start', onStart);
        this.liveChat.on('chat', (chatItem) => {
            const transformedMessage = transformYouTubeMessage(chatItem);
            onChat(transformedMessage);
        });
        this.liveChat.on('end', onEnd);
        this.liveChat.on('error', onError);

        // Start the chat
        return await this.liveChat.start();
    }

    stop() {
        this.liveChat.stop();
    }
}

module.exports = {
    YouTubeChatHandler
}; 