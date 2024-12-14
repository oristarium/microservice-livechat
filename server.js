const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { YouTubeChatHandler } = require('./src/platforms/youtube');
const { TikTokChatHandler } = require('./src/platforms/tiktok');
const { TwitchChatHandler } = require('./src/platforms/twitch');
const { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } = require('./src/constants/messageTypes');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ 
    server,
    path: '/',  // Accept WebSocket connections on any path
    verifyClient: (info, cb) => {
        console.log('Verifying client connection:', info.req.headers);
        cb(true);  // Accept all connections for now
    }
});

// Store active streams and their clients
const activeStreams = new Map();

// Cleanup function for inactive streams
async function cleanupStream(channelId, sendEndedMessage = true) {
    const streamData = activeStreams.get(channelId);
    if (streamData) {
        // Remove from map first to prevent duplicate cleanup
        activeStreams.delete(channelId);
        
        try {
            if (streamData.chatHandler) {
                // Use the new cleanup method
                await streamData.chatHandler.cleanup();
            }
            
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
        } catch (error) {
            console.error(`Error cleaning up stream ${channelId}:`, error);
        }
    }
}

// Add proper CORS and static file handling
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files with proper headers
app.use('/test', (req, res, next) => {
    if (req.path === '/' || req.path === '') {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        express.static(path.join(__dirname, 'public'))(req, res, next);
    }
});

// Add health check endpoint before WebSocket setup
app.get('/health', (req, res) => {
    res.json({ status: 'ok', activeStreams: activeStreams.size });
});

// Handle WebSocket connections
wss.on('connection', (ws) => {
    let currentChannelId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case CLIENT_MESSAGE_TYPES.SUBSCRIBE:
                    // Clean up previous subscription for this client
                    if (currentChannelId) {
                        const prevStreamData = activeStreams.get(currentChannelId);
                        if (prevStreamData) {
                            prevStreamData.clients.delete(ws);
                            // Only cleanup if no clients are left
                            if (prevStreamData.clients.size === 0) {
                                cleanupStream(currentChannelId, false);
                            }
                        }
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
                            case 'tiktok':
                                chatHandler = new TikTokChatHandler(identifier);
                                break;
                            case 'twitch':
                                chatHandler = new TwitchChatHandler(identifier);
                                break;
                            default:
                                throw new Error(`Unsupported platform: ${platform}`);
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
                    ws.send(JSON.stringify({ 
                        type: SERVER_MESSAGE_TYPES.STATUS, 
                        status: 'subscribed', 
                        identifier,
                        storage_type: process.env.STATS_STORAGE || 'memory'
                    }));
                    break;

                case CLIENT_MESSAGE_TYPES.UNSUBSCRIBE:
                    if (currentChannelId) {
                        const streamData = activeStreams.get(currentChannelId);
                        if (streamData) {
                            // Remove this client from the stream
                            streamData.clients.delete(ws);
                            
                            // Send unsubscribe status to this client
                            ws.send(JSON.stringify({ 
                                type: SERVER_MESSAGE_TYPES.STATUS, 
                                status: 'unsubscribed' 
                            }));

                            // Only cleanup if no clients are left
                            if (streamData.clients.size === 0) {
                                cleanupStream(currentChannelId, false);
                            }
                        }
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

// Function to handle graceful shutdown
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Cleaning up...`);

    // Clean up all active streams
    for (const [channelId] of activeStreams) {
        await cleanupStream(channelId);
    }

    // Close WebSocket server
    wss.close(() => {
        console.log('WebSocket server closed');
    });

    // Close HTTP server
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });

    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 5000);
}

// Handle different termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Handles Ctrl+C
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Handles nodemon restart

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
