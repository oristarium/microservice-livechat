const express = require('express');
const { WebSocketServer } = require('ws');
const { LiveChat } = require('youtube-chat');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store active streams and their clients
const activeStreams = new Map();

// Cleanup function for inactive streams
function cleanupStream(channelId) {
    const streamData = activeStreams.get(channelId);
    if (streamData) {
        streamData.liveChat.stop();
        activeStreams.delete(channelId);
        console.log(`Cleaned up stream for channel ${channelId}`);
    }
}

// Add this helper function
function getSanitizedMessage(messageArray) {
    return messageArray
        .filter(element => element.text) // Only keep text elements
        .map(element => element.text)
        .join('');
}

// Update the transformYouTubeMessage function to include sanitized content
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

// Handle WebSocket connections
wss.on('connection', (ws) => {
    let currentChannelId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'subscribe') {
                // Extract the identifier and type
                const { identifier, identifierType } = data;
                currentChannelId = identifier; // We'll use this as a unique key

                let streamData = activeStreams.get(identifier);

                if (!streamData) {
                    // Create new LiveChat instance based on identifier type
                    let liveChatOptions = {};
                    
                    switch (identifierType) {
                        case 'channelId':
                            liveChatOptions.channelId = identifier;
                            break;
                        case 'handle':
                            liveChatOptions.handle = identifier;
                            break;
                        case 'liveId':
                            liveChatOptions.liveId = identifier;
                            break;
                        default:
                            throw new Error('Invalid identifier type');
                    }

                    const liveChat = new LiveChat(liveChatOptions);
                    streamData = {
                        liveChat,
                        clients: new Set(),
                        isActive: false
                    };
                    activeStreams.set(identifier, streamData);

                    // Set up LiveChat event handlers
                    liveChat.on('start', (liveId) => {
                        const status = { type: 'status', status: 'started', liveId };
                        streamData.clients.forEach(client => {
                            if (client.readyState === 1) {
                                client.send(JSON.stringify(status));
                            }
                        });
                    });

                    liveChat.on('chat', (chatItem) => {
                        const transformedMessage = transformYouTubeMessage(chatItem);
                        const message = { type: 'chat', data: transformedMessage };
                        streamData.clients.forEach(client => {
                            if (client.readyState === 1) {
                                client.send(JSON.stringify(message));
                            }
                        });
                    });

                    liveChat.on('error', (error) => {
                        const errorMsg = { type: 'error', error: error.message };
                        streamData.clients.forEach(client => {
                            if (client.readyState === 1) {
                                client.send(JSON.stringify(errorMsg));
                            }
                        });
                    });

                    // Start the LiveChat
                    const ok = await liveChat.start();
                    if (!ok) {
                        ws.send(JSON.stringify({ type: 'error', error: 'Failed to start LiveChat' }));
                        return;
                    }
                    streamData.isActive = true;
                }

                // Add client to the stream's client list
                streamData.clients.add(ws);
                ws.send(JSON.stringify({ type: 'status', status: 'subscribed', identifier }));
            }
        } catch (error) {
            ws.send(JSON.stringify({ type: 'error', error: error.message }));
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        if (currentChannelId) {
            const streamData = activeStreams.get(currentChannelId);
            if (streamData) {
                streamData.clients.delete(ws);
                
                // If no clients are connected, cleanup the stream
                if (streamData.clients.size === 0) {
                    cleanupStream(currentChannelId);
                }
            }
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', activeStreams: activeStreams.size });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Cleaning up...');
    for (const [channelId] of activeStreams) {
        cleanupStream(channelId);
    }
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
