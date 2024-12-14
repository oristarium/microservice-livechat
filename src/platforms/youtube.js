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
    if (!messageArray || !Array.isArray(messageArray)) return '';
    return messageArray.map(element => 
        element?.text || element?.emojiText || ''
    ).join('');
}

function getFormattedMessage(messageArray) {
    if (!messageArray || !Array.isArray(messageArray)) return '';
    return messageArray.map(element => {
        if (element?.text) return element.text;
        if (element?.emojiText) return `:${element.emojiText}:`;
        return '';
    }).join('');
}

function getSanitizedMessage(messageArray) {
    if (!messageArray || !Array.isArray(messageArray)) return '';
    return messageArray
        .filter(element => element?.text)
        .map(element => element.text)
        .join('');
}

function transformMessageElements(message) {
    if (!message || !Array.isArray(message)) return [];
    
    let position = 0;
    return message.map(element => {
        if (!element) return null;
        
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
    }).filter(Boolean); // Remove any null results
}

function transformYouTubeMessage(ytMessage) {
    // First transform message elements to build both elements array and HTML
    const messageElements = transformMessageElements(ytMessage.message);
    const rawHtml = messageElements.map(element => {
        if (element.type === 'text') {
            return `<span class="text">${element.value}</span>`;
        } else if (element.type === 'emote') {
            return `<img 
                class="emote" 
                src="${element.metadata.url}" 
                alt="${element.metadata.alt}" 
                title="${element.metadata.alt}"
                ${element.metadata.is_custom ? 'data-custom="true"' : ''}
            >`;
        }
        return '';
    }).join('');

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
                elements: messageElements,
                rawHtml: rawHtml
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
    constructor(identifier, identifierType = 'username') {
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

    async start(onStart, onChat, onEnd, onError, onStatsUpdate) {
        // Set up event handlers
        this.liveChat.on('start', onStart);
        this.liveChat.on('chat', (chatItem) => {
            const transformedMessage = transformYouTubeMessage(chatItem);
            
            onChat(transformedMessage);
        });
        this.liveChat.on('end', () => {
            onEnd();
        });
        this.liveChat.on('error', onError);

        // Start the chat
        return await this.liveChat.start();
    }

    async stop() {
        try {
            // Stop the chat first
            if (this.liveChat) {
                this.liveChat.stop();
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
    YouTubeChatHandler
}; 