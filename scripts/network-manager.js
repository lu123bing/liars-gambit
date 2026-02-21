(function initNetworkManager(global){
    class NetworkManager {
        constructor(){
            this.peer=null; this.connections=new Map();
            this.isHost=false; this.hostPeerId=null; this.hostConn=null;
            this.myPeerId=null; this.roomCode=''; this.handlers={};
            this.heartbeatTimer=null; this.onPeerConnect=null; this.onPeerDisconnect=null;
            this.destroyed=false; this._lastHostHB=0;
        }
        _pid(code){ return 'lg-'+code; }
        _hasTurnConfig(){
            if(!NET_CONFIG.remoteOnlineEnabled) return false;
            const t=_getEffectiveTurnConfig();
            return !!(t.urls&&t.urls.length&&t.username&&t.credential);
        }
        _peerOptions(useTurn=false){
            const stun=(NET_CONFIG.ice?.stun||[]).map(s=>({ ...s }));
            const servers=[...stun];
            if(useTurn&&this._hasTurnConfig()){
                const t=_getEffectiveTurnConfig();
                servers.push({
                    urls: t.urls,
                    username: t.username,
                    credential: t.credential
                });
            }
            return { debug:NET_CONFIG.peerDebug, config:{ iceServers:servers } };
        }

        async createRoom(){
            this.isHost=true; this.roomCode=mkRoomCode();
            const pid=this._pid(this.roomCode);
            return new Promise((res,rej)=>{
                this.peer=new Peer(pid,this._peerOptions(!!NET_CONFIG.hostUseTurnIfConfigured));
                this.peer.on('open',id=>{
                    this.myPeerId=id; this.hostPeerId=id;
                    this.peer.on('connection',c=>this._setupConn(c));
                    this._startHB(); res(this.roomCode);
                });
                this.peer.on('error',e=>{
                    if(e.type==='unavailable-id') rej(new Error('房间号冲突，请重试'));
                    else rej(e);
                });
                this.peer.on('disconnected',()=>{ if(!this.destroyed) this.peer.reconnect(); });
            });
        }

        async joinRoom(code){
            this.isHost=false; this.roomCode=code.toUpperCase();
            const hpid=this._pid(this.roomCode); this.hostPeerId=hpid;
            const _connectOnce=(useTurn)=>new Promise((res,rej)=>{
                this.peer=new Peer(undefined,this._peerOptions(useTurn));
                this.peer.on('open',id=>{
                    this.myPeerId=id;
                    const conn=this.peer.connect(hpid,{reliable:true});
                    conn.on('open',()=>{this.hostConn=conn;this._setupHostConn(conn);this._startHB();res();});
                    conn.on('error',()=>rej(new Error('无法连接到房间')));
                    setTimeout(()=>rej(new Error('连接超时')),NET_CONFIG.connectTimeoutMs);
                });
                this.peer.on('error',e=>rej(e));
                this.peer.on('disconnected',()=>{ if(!this.destroyed) this.peer.reconnect(); });
            });
            try{
                await _connectOnce(false);
            }catch(e){
                if(!this._hasTurnConfig()) throw e;
                try{ if(this.peer) this.peer.destroy(); }catch(_e){}
                await _connectOnce(true);
            }
        }

        // Setup for host receiving client connections
        _setupConn(conn){
            const pid=conn.peer;
            conn.on('open',()=>{
                this.connections.set(pid,{conn,lastHB:Date.now()});
                if(this.onPeerConnect) this.onPeerConnect(pid,conn);
            });
            conn.on('data',d=>{
                if(d&&d.type==='HEARTBEAT'){const e=this.connections.get(pid);if(e)e.lastHB=Date.now();return;}
                this._dispatch(d,pid);
            });
            conn.on('close',()=>{
                this.connections.delete(pid);
                if(this.onPeerDisconnect) this.onPeerDisconnect(pid);
            });
            conn.on('error',()=>{});
        }

        // Setup for client receiving from host
        _setupHostConn(conn){
            conn.on('data',d=>{
                if(d&&d.type==='HEARTBEAT'){this._lastHostHB=Date.now();return;}
                this._dispatch(d,conn.peer);
            });
            conn.on('close',()=>{
                if(this.onPeerDisconnect) this.onPeerDisconnect(this.hostPeerId);
            });
            this._lastHostHB=Date.now();
        }

        send(pid,msg){
            if(this.isHost){const e=this.connections.get(pid);if(e&&e.conn.open)e.conn.send(msg);}
            else if(this.hostConn&&this.hostConn.open) this.hostConn.send(msg);
        }
        sendToHost(msg){
            if(this.isHost) this._dispatch(msg,this.myPeerId);
            else if(this.hostConn&&this.hostConn.open) this.hostConn.send(msg);
        }
        broadcast(msg){for(const[,e]of this.connections)if(e.conn.open)e.conn.send(msg);}
        broadcastAndSelf(msg){this.broadcast(msg);this._dispatch(msg,this.myPeerId);}

        on(type,handler){if(!this.handlers[type])this.handlers[type]=[];this.handlers[type].push(handler);}
        off(type){delete this.handlers[type];}
        _dispatch(d,from){if(!d||!d.type)return;const hs=this.handlers[d.type];if(hs)hs.forEach(h=>h(d,from));}

        _startHB(){
            this.heartbeatTimer=setInterval(()=>{
                const hb={type:'HEARTBEAT',t:Date.now()};
                if(this.isHost){
                    this.broadcast(hb);
                    const now=Date.now();
                    for(const[pid,e]of this.connections){
                        if(now-e.lastHB>HEARTBEAT_TIMEOUT){
                            e.conn.close(); this.connections.delete(pid);
                            if(this.onPeerDisconnect)this.onPeerDisconnect(pid);
                        }
                    }
                } else {
                    if(this.hostConn&&this.hostConn.open) this.hostConn.send(hb);
                    if(this._lastHostHB && Date.now()-this._lastHostHB>HEARTBEAT_TIMEOUT){
                        if(this.onPeerDisconnect) this.onPeerDisconnect(this.hostPeerId);
                        this._lastHostHB = Date.now() + 60000; // prevent repeated fires
                    }
                }
            },HEARTBEAT_INTERVAL);
        }

        destroy(){
            this.destroyed=true; clearInterval(this.heartbeatTimer);
            if(this.peer)this.peer.destroy(); this.connections.clear();
        }
    }

    const {
        NET_CONFIG,
        HEARTBEAT_TIMEOUT,
        HEARTBEAT_INTERVAL,
        _getEffectiveTurnConfig,
    } = global.LG_RUNTIME_CONFIG;
    const { mkRoomCode } = global.LG_RUNTIME_UTILS;

    global.LG_NETWORK_MANAGER = { NetworkManager };
})(window);
