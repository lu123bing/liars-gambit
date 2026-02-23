(function initRuntimeConfig(global){
    const BASE_URL = 'https://lu123bing.github.io/liars-gambit/';
    const SUITS = ['♠','♥','♦','♣'];
    const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const RED_SUITS = new Set(['♥','♦']);
    const REMOTE_ONLINE_STORAGE_KEY = 'lg_enable_remote_online';
    const CUSTOM_TURN_STORAGE_KEY = 'lg_custom_turn_config';
    const DEFAULT_NET_CONFIG = {
        maxPlayers: 8,
        heartbeatIntervalMs: 10000,
        heartbeatTimeoutMs: 30000,
        connectTimeoutMs: 8000,
        challengeWindowMs: 100,
        peerDebug: 0,
        remoteOnlineEnabled: false,
        hostUseTurnIfConfigured: true,
        ice: {
            stun: [{ urls: 'stun:stun.l.google.com:19302' }]
        },
        turn: {
            urls: [
                'turn:global.relay.metered.ca:80',
                'turn:global.relay.metered.ca:80?transport=tcp',
                'turn:global.relay.metered.ca:443',
                'turns:global.relay.metered.ca:443?transport=tcp'
            ],
            username: '9e2e5450e6f05266678650e7',
            credential: 'zwo+0bAQys8L6Zsl'
        }
    };

    function _readRuntimeNetConfig(){
        let fromStorage={};
        try{
            const raw=localStorage.getItem('lg_net_config');
            if(raw) fromStorage=JSON.parse(raw)||{};
        }catch(e){}
        const fromWindow=(typeof window!=='undefined'&&window.__LG_NET_CONFIG__&&typeof window.__LG_NET_CONFIG__==='object')
            ? window.__LG_NET_CONFIG__ : {};
        const merged={...DEFAULT_NET_CONFIG,...fromStorage,...fromWindow};
        merged.ice={
            ...DEFAULT_NET_CONFIG.ice,
            ...(fromStorage.ice||{}),
            ...(fromWindow.ice||{})
        };
        merged.turn={
            ...DEFAULT_NET_CONFIG.turn,
            ...(fromStorage.turn||{}),
            ...(fromWindow.turn||{})
        };
        return merged;
    }

    const NET_CONFIG = _readRuntimeNetConfig();

    function _readRemoteOnlineEnabled(){
        try{ localStorage.removeItem(REMOTE_ONLINE_STORAGE_KEY); }
        catch(e){}
        return false;
    }

    function _setRemoteOnlineEnabled(enabled){
        NET_CONFIG.remoteOnlineEnabled=!!enabled;
        // 不持久化远程开关，确保每次刷新默认关闭
        try{ localStorage.removeItem(REMOTE_ONLINE_STORAGE_KEY); }catch(e){}
    }

    function _normalizeTurnUrls(raw){
        if(Array.isArray(raw)) return raw.map(v=>String(v||'').trim()).filter(Boolean);
        return String(raw||'').split(/[\n,]+/).map(v=>v.trim()).filter(Boolean);
    }

    function _readCustomTurnConfig(){
        try{
            const raw=localStorage.getItem(CUSTOM_TURN_STORAGE_KEY);
            if(!raw) return null;
            const cfg=JSON.parse(raw)||{};
            return {
                urls:_normalizeTurnUrls(cfg.urls),
                username:String(cfg.username||'').trim(),
                credential:String(cfg.credential||'').trim()
            };
        }catch(e){
            return null;
        }
    }

    function _setCustomTurnConfig(cfg){
        try{
            localStorage.setItem(CUSTOM_TURN_STORAGE_KEY,JSON.stringify({
                urls:_normalizeTurnUrls(cfg?.urls),
                username:String(cfg?.username||'').trim(),
                credential:String(cfg?.credential||'').trim()
            }));
        }catch(e){}
    }

    function _clearCustomTurnConfig(){
        try{ localStorage.removeItem(CUSTOM_TURN_STORAGE_KEY); }catch(e){}
    }

    function _getEffectiveTurnConfig(){
        const c=_readCustomTurnConfig();
        if(c&&c.urls?.length&&c.username&&c.credential) return c;
        return NET_CONFIG.turn||{};
    }

    function _isCustomTurnConfigActive(){
        const c=_readCustomTurnConfig();
        return !!(c&&c.urls?.length&&c.username&&c.credential);
    }

    function _getRoomMaxPlayers(){
        if(!NET_CONFIG.remoteOnlineEnabled) return 9;
        return _isCustomTurnConfigActive()?9:6;
    }

    NET_CONFIG.remoteOnlineEnabled=_readRemoteOnlineEnabled();

    const HEARTBEAT_INTERVAL = NET_CONFIG.heartbeatIntervalMs;
    const HEARTBEAT_TIMEOUT = NET_CONFIG.heartbeatTimeoutMs;
    const CHALLENGE_WINDOW_MS = NET_CONFIG.challengeWindowMs;
    const DECK_COLORS = [
        { primary:'#B8453A', symbol:'●' },
        { primary:'#4A7C96', symbol:'◆' },
        { primary:'#6B7F4E', symbol:'▲' },
    ];

    global.LG_RUNTIME_CONFIG = {
        BASE_URL,
        SUITS,
        RANKS,
        RED_SUITS,
        REMOTE_ONLINE_STORAGE_KEY,
        CUSTOM_TURN_STORAGE_KEY,
        DEFAULT_NET_CONFIG,
        NET_CONFIG,
        HEARTBEAT_INTERVAL,
        HEARTBEAT_TIMEOUT,
        CHALLENGE_WINDOW_MS,
        DECK_COLORS,
        _readRuntimeNetConfig,
        _readRemoteOnlineEnabled,
        _setRemoteOnlineEnabled,
        _normalizeTurnUrls,
        _readCustomTurnConfig,
        _setCustomTurnConfig,
        _clearCustomTurnConfig,
        _getEffectiveTurnConfig,
        _isCustomTurnConfigActive,
        _getRoomMaxPlayers,
    };
})(window);
