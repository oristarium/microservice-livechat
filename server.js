const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { YouTubeChatHandler } = require('./src/platforms/youtube');
const { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } = require('./src/constants/messageTypes');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store active streams and their clients
const activeStreams = new Map();

// Cleanup function for inactive streams
function cleanupStream(channelId, sendEndedMessage = true) {
    const streamData = activeStreams.get(channelId);
    if (streamData) {
        // Remove from map first to prevent duplicate cleanup
        activeStreams.delete(channelId);
        
        streamData.chatHandler.stop();
        
        // Only send ended message if requested and not during unsubscribe
        if (sendEndedMessage) {
            streamData.clients.forEach(client => {
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ 
                        type: SERVER_MESSAGE_TYPES.ERROR, 
                        error: 'Stream has ended',
                        code: 'STREAM_ENDED'
                    }));
                }
            });
        }
        
        console.log(`Cleaned up stream for channel ${channelId}`);
    }
}

// Add these routes before the WebSocket setup
app.use('/test', express.static(path.join(__dirname, 'public')));

// Handle WebSocket connections
wss.on('connection', (ws) => {
    let currentChannelId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case CLIENT_MESSAGE_TYPES.SUBSCRIBE:
                    // Clean up previous subscription if it exists
                    if (currentChannelId) {
                        cleanupStream(currentChannelId, false);
                    }

                    const identifier = data.identifier;
                    const identifierType = data.identifierType || 'username';
                    const platform = data.platform || 'youtube';
                    
                    currentChannelId = identifier;

                    let streamData = activeStreams.get(identifier);

                    if (!streamData) {
                        // Create new chat handler based on platform
                        let chatHandler;
                        switch (platform) {
                            case 'youtube':
                                chatHandler = new YouTubeChatHandler(identifier, identifierType);
                                break;
                            // Add other platforms here
                            default:
                                throw new Error('Unsupported platform');
                        }

                        streamData = {
                            chatHandler,
                            clients: new Set(),
                            isActive: false
                        };
                        activeStreams.set(identifier, streamData);

                        try {
                            const ok = await chatHandler.start(
                                // onStart
                                (liveId) => {
                                    const status = { type: SERVER_MESSAGE_TYPES.STATUS, status: 'started', liveId };
                                    streamData.clients.forEach(client => {
                                        if (client.readyState === 1) {
                                            client.send(JSON.stringify(status));
                                        }
                                    });
                                },
                                // onChat
                                (transformedMessage) => {
                                    const message = { type: SERVER_MESSAGE_TYPES.CHAT, data: transformedMessage };
                                    streamData.clients.forEach(client => {
                                        if (client.readyState === 1) {
                                            client.send(JSON.stringify(message));
                                        }
                                    });
                                },
                                // onEnd
                                () => {
                                    // Only send end message if not already cleaning up
                                    if (activeStreams.has(identifier)) {
                                        cleanupStream(identifier);
                                    }
                                },
                                // onError
                                (error) => {
                                    streamData.clients.forEach(client => {
                                        if (client.readyState === 1) {
                                            client.send(JSON.stringify({ 
                                                type: SERVER_MESSAGE_TYPES.ERROR, 
                                                error: error.message 
                                            }));
                                        }
                                    });
                                },
                                // onStatsUpdate
                                (stats) => {
                                    streamData.clients.forEach(client => {
                                        if (client.readyState === 1) {
                                            client.send(JSON.stringify({
                                                type: SERVER_MESSAGE_TYPES.STATS,
                                                data: stats
                                            }));
                                        }
                                    });
                                }
                            );

                            if (!ok) {
                                ws.send(JSON.stringify({ 
                                    type: SERVER_MESSAGE_TYPES.ERROR, 
                                    error: 'Stream is not live',
                                    code: 'STREAM_NOT_LIVE'
                                }));
                                cleanupStream(identifier);
                                return;
                            }
                            streamData.isActive = true;
                        } catch (error) {
                            ws.send(JSON.stringify({ 
                                type: SERVER_MESSAGE_TYPES.ERROR, 
                                error: 'Failed to start chat',
                                details: error.message
                            }));
                            cleanupStream(identifier);
                            return;
                        }
                    }

                    // Add client to the stream's client list
                    streamData.clients.add(ws);
                    ws.send(JSON.stringify({ type: SERVER_MESSAGE_TYPES.STATUS, status: 'subscribed', identifier }));
                    break;

                case CLIENT_MESSAGE_TYPES.UNSUBSCRIBE:
                    if (currentChannelId) {
                        // Send unsubscribe status first
                        ws.send(JSON.stringify({ 
                            type: SERVER_MESSAGE_TYPES.STATUS, 
                            status: 'unsubscribed' 
                        }));
                        
                        // Then cleanup without sending end message
                        cleanupStream(currentChannelId, false);
                        currentChannelId = null;
                    }
                    break;

                case CLIENT_MESSAGE_TYPES.GET_STATS:
                    if (currentChannelId) {
                        const streamData = activeStreams.get(currentChannelId);
                        if (streamData) {
                            ws.send(JSON.stringify({
                                type: SERVER_MESSAGE_TYPES.STATS,
                                data: streamData.chatHandler.getCurrentStats()
                            }));
                        } else {
                            ws.send(JSON.stringify({
                                type: SERVER_MESSAGE_TYPES.ERROR,
                                error: "Stream data not found",
                                code: "STREAM_NOT_FOUND"
                            }));
                        }
                    } else {
                        ws.send(JSON.stringify({
                            type: SERVER_MESSAGE_TYPES.ERROR,
                            error: "No active chat connection",
                            code: "NO_ACTIVE_CHAT"
                        }));
                    }
                    break;

                default:
                    ws.send(JSON.stringify({ 
                        type: SERVER_MESSAGE_TYPES.ERROR, 
                        error: 'Unknown message type',
                        code: 'INVALID_MESSAGE_TYPE'
                    }));
            }
        } catch (error) {
            ws.send(JSON.stringify({ 
                type: SERVER_MESSAGE_TYPES.ERROR, 
                error: error.message 
            }));
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
