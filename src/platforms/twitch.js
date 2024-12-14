const WebSocket = require('ws');
const StatsFactory = require('../utils/StatsFactory');

// Helper functions
function transformBadges(badgesStr) {
    if (!badgesStr) return [];
    return badgesStr.split(',').map(badge => {
        const [type, version] = badge.split('/');
        return {
            type: type === 'moderator' ? 'moderator' : 
                  type === 'broadcaster' ? 'broadcaster' : 
                  type === 'subscriber' ? 'subscriber' : 'custom',
            label: type,
            image_url: null // Twitch badge URLs would need to be fetched separately
        };
    });
}

function parseIrcMessage(message) {
    const parts = message.split(":");
    const prefixStr = parts[0].startsWith("@") ? parts[0].slice(1) : parts[0];
    const commandData = parts[1].split(" ");
    const commandHostname = commandData[0];
    const commandId = commandData[1];
    const roomName = commandData[2];
    const commandValue = parts[2];

    const tagData = {};
    prefixStr.split(";").forEach((pair) => {
        const [key, value] = pair.split("=");
        if (key.length > 0) {
            const keyAsCamelCase = key.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            tagData[keyAsCamelCase] = value;
        }
    });

    return {
        raw: message,
        tags: tagData,
        commandHostname,
        commandId,
        roomName,
        commandValue
    };
}

function transformTwitchMessage(ircMessage) {
    // Pre-render the message as HTML
    const rawHtml = `<span class="text">${ircMessage.commandValue}</span>`;

    return {
        type: 'chat',
        platform: 'twitch',
        timestamp: ircMessage.tags.tmiSentTs,
        message_id: ircMessage.tags.id || crypto.randomUUID(),
        room_id: ircMessage.tags.roomId,
        data: {
            author: {
                id: ircMessage.tags.userId,
                username: ircMessage.tags.displayName?.toLowerCase(),
                display_name: ircMessage.tags.displayName,
                avatar_url: null, // Would need separate API call to get this
                roles: {
                    broadcaster: ircMessage.tags.badges?.includes('broadcaster'),
                    moderator: ircMessage.tags.mod === '1',
                    subscriber: ircMessage.tags.subscriber === '1',
                    verified: false // Twitch doesn't have verified status
                },
                badges: transformBadges(ircMessage.tags.badges)
            },
            content: {
                raw: ircMessage.commandValue,
                formatted: ircMessage.commandValue,
                sanitized: ircMessage.commandValue,
                elements: [{
                    type: 'text',
                    value: ircMessage.commandValue,
                    position: [0, ircMessage.commandValue.length]
                }],
                rawHtml: rawHtml
            },
            metadata: {
                type: 'chat'
            }
        }
    };
}

class TwitchChatHandler {
    constructor(identifier) {
        this.channelName = identifier.toLowerCase();
        this.wsConnectUrl = 'wss://irc-ws.chat.twitch.tv';
        this.pingInterval = 1000 * 60; // 1 minute
        this.socket = null;
        this.pingTimeout = null;
        this.chatStats = StatsFactory.createStats(identifier, {
            storage: process.env.STATS_STORAGE || 'memory',
            redisUrl: process.env.REDIS_URL
        });
    }

    async start(onStart, onChat, onEnd, onError, onStatsUpdate) {
        try {
            await this.connect();
            
            // Set up message handler
            this.socket.on('message', (data) => {
                const messages = data.toString().trim().split("\r\n");
                
                for (const message of messages) {
                    // Handle PING messages
                    if (message === 'PING :tmi.twitch.tv') {
                        this.socket.send('PONG :tmi.twitch.tv');
                        continue;
                    }

                    // Parse and handle chat messages
                    const parsedMessage = parseIrcMessage(message);
                    
                    if (parsedMessage.commandId === 'PRIVMSG') {
                        const transformedMessage = transformTwitchMessage(parsedMessage);
                        
                        // Update stats
                        this.chatStats.updateStats(transformedMessage.data.author)
                            .then(stats => {
                                if (onStatsUpdate) {
                                    onStatsUpdate(stats);
                                }
                            });
                        
                        onChat(transformedMessage);
                    }
                }
            });

            // Call onStart with basic room info
            onStart({ roomId: this.channelName });

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

    async connect() {
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket(this.wsConnectUrl);

            this.socket.on('open', () => {
                // Anonymously authenticate to Twitch
                this.socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
                this.socket.send(`PASS SCHMOOPIIE`);
                this.socket.send("NICK justinfan12345");
                this.socket.send("USER justinfan23334 8 * :justinfan23334");

                // Join the channel
                this.socket.send(`JOIN #${this.channelName}`);

                // Start ping interval
                this.pingTimeout = setInterval(() => {
                    if (this.socket?.readyState === WebSocket.OPEN) {
                        this.socket.send("PING");
                    }
                }, this.pingInterval);

                resolve();
            });

            this.socket.on('error', reject);
            this.socket.on('close', () => {
                clearInterval(this.pingTimeout);
                this.socket = null;
            });
        });
    }

    async stop() {
        try {
            // Clear ping interval
            if (this.pingTimeout) {
                clearInterval(this.pingTimeout);
                this.pingTimeout = null;
            }

            // Close socket
            if (this.socket) {
                this.socket.close();
                this.socket = null;
            }

            // Cleanup stats
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
    TwitchChatHandler
}; 