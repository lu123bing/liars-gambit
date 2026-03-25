(function initAppController(global){
    class App {
        constructor(){
            this.net=null; this.game=null; this.selectedCards=new Set();
            this.selectedDeckCount=1; this.selectedRank=null;
            this.selectedChallengeMode='sequential';
            this._prevPhase=null;
            this._poolSfxRound=0;
            this._poolSfxPrevCount=0;
            this._poolSfxTriggeredBase=false;
            this._poolSfxTriggeredHigh=false;
            this._poolPressureLevel='none';
            this._poolVisualPrevCount=0;
            this._poolPressureBurstTimer=null;
            this._bindHome(); this._initRankGrid(); this._checkUrlParams();
        }

        _applyPoolPressureVisual(){
            const pool=document.querySelector('.card-pool');
            if(!pool) return;
            pool.classList.remove('pool-pressure-base','pool-pressure-high');
            if(this._poolPressureLevel==='base') pool.classList.add('pool-pressure-base');
            else if(this._poolPressureLevel==='high') pool.classList.add('pool-pressure-high');
        }

        _pulsePoolPressure(level){
            const pool=document.querySelector('.card-pool');
            if(!pool) return;
            const pulseCls=level==='high'?'pool-pressure-burst-high':'pool-pressure-burst-base';
            if(this._poolPressureBurstTimer){
                clearTimeout(this._poolPressureBurstTimer);
                this._poolPressureBurstTimer=null;
            }
            pool.classList.remove('pool-pressure-burst-base','pool-pressure-burst-high');
            void pool.offsetWidth;
            pool.classList.add(pulseCls);
            this._poolPressureBurstTimer=setTimeout(()=>{
                pool.classList.remove('pool-pressure-burst-base','pool-pressure-burst-high');
                this._poolPressureBurstTimer=null;
            },700);
        }

        _setPoolPressure(level){
            if(level!=='base'&&level!=='high') return;
            if(level==='high'||this._poolPressureLevel==='none'){
                this._poolPressureLevel=level;
            }
            this._applyPoolPressureVisual();
            this._pulsePoolPressure(level);
        }

        _clearPoolPressure(){
            this._poolPressureLevel='none';
            if(this._poolPressureBurstTimer){
                clearTimeout(this._poolPressureBurstTimer);
                this._poolPressureBurstTimer=null;
            }
            const pool=document.querySelector('.card-pool');
            if(pool){
                pool.classList.remove('pool-pressure-base','pool-pressure-high','pool-pressure-burst-base','pool-pressure-burst-high');
            }
        }

        _resetPoolSfxRound(count=0){
            this._poolSfxRound++;
            this._poolSfxPrevCount=count;
            this._poolSfxTriggeredBase=false;
            this._poolSfxTriggeredHigh=false;
        }

        _maybePlayPoolOverflowSfx(state){
            const ct=state?.tableCardCount||0;
            if(this._poolSfxRound===0){
                this._resetPoolSfxRound(ct);
                return;
            }
            const deckCount=Math.max(1,state?.deckCount||1);
            const baseLimit=deckCount*5+1.5; // base threshold scales with number of decks, plus a small buffer to avoid triggering on normal early-game plays
            const highLimit=baseLimit*1.5;
            const prev=this._poolSfxPrevCount;

            const crossedBase=(!this._poolSfxTriggeredBase)&&(prev<=baseLimit)&&(ct>baseLimit);
            const crossedHigh=(!this._poolSfxTriggeredHigh)&&(prev<=highLimit)&&(ct>highLimit);

            if(crossedHigh){
                // 冲突时优先高阈值音效
                try{SFX.laugh2();}catch(e){}
                this._setPoolPressure('high');
                this._poolSfxTriggeredHigh=true;
                this._poolSfxTriggeredBase=true;
            }else if(crossedBase){
                try{SFX.shortjokerlaugh();}catch(e){}
                this._setPoolPressure('base');
                this._poolSfxTriggeredBase=true;
            }

            this._poolSfxPrevCount=ct;
        }

        // ─── Home ───
        _bindHome(){
            $('btn-create').onclick=()=>this._create();
            $('btn-join').onclick=()=>this._join();
            $('btn-toggle-turn-panel').onclick=()=>this.toggleTurnPanel();
            $('btn-save-turn').onclick=()=>this.saveCustomTurnConfig();
            $('btn-clear-turn').onclick=()=>this.clearCustomTurnConfig();
            $('input-room-code').addEventListener('keyup',e=>{if(e.key==='Enter')this._join();});
            $('input-name').addEventListener('keyup',e=>{if(e.key==='Enter')$('btn-create').focus();});
            $('btn-start').onclick=()=>this.game?.sendStartGame();
            $('btn-leave-room').onclick=()=>this.leaveRoom();
            $('btn-share-room').onclick=()=>{
                const code=$('lobby-room-code').textContent;
                if(code==='----')return;
                const url=BASE_URL+'?room='+code;
                if(navigator.share){
                    navigator.share({
                        title:'骗子博弈 - Liar\'s Gambit',
                        text:'快来加入我的骗子博弈房间！房间号：'+code,
                        url:url
                    }).catch(e=>console.log('Share failed:',e));
                }else{
                    navigator.clipboard.writeText(url).then(()=>alert('链接已复制到剪贴板！')).catch(()=>alert('复制失败，请手动复制链接：'+url));
                }
            };
            $('btn-play').onclick=()=>this._playCards();
            $('btn-pass').onclick=()=>this.game?.sendPass();
            $('btn-ffa-challenge').onclick=()=>this.game?.sendChallenge();
            $('btn-declare-confirm').onclick=()=>this._confirmDeclare();
            $('btn-play-again').onclick=()=>this.game?.sendPlayAgain();
            $('btn-back-home').onclick=()=>this._backHome();
            const sn=localStorage.getItem('lg_playerName');
            if(sn)$('input-name').value=sn;
            this._applyRemoteOnlineToggleUI();
            this._applyCustomTurnUI();
        }

        leaveRoom(){
            if(!confirm('确定要退出当前房间吗？')) return;
            if(this.net){this.net.destroy();this.net=null;}
            this.game=null;
            this.selectedCards.clear();
            showScreen('home');
            this._resetHomeStamp();
            showToast('已退出房间');
        }

        kickPlayer(playerId){
            if(this.game && this.net && this.net.isHost){
                if(confirm('确定要踢出该玩家吗？')){
                    this.net.broadcastAndSelf({type:'KICK_PLAYER', playerId});
                }
            }
        }

        _applyRemoteOnlineToggleUI(){
            const el=$('toggle-remote-online');
            if(el){
                const isOn=!!NET_CONFIG.remoteOnlineEnabled;
                el.classList.toggle('active',isOn);
                el.setAttribute('aria-checked', isOn.toString());
            }
        }

        toggleRemoteOnline(){
            const next=!NET_CONFIG.remoteOnlineEnabled;
            _setRemoteOnlineEnabled(next);
            this._applyRemoteOnlineToggleUI();
            showToast(next?'已开启远程联机：可使用 TURN':'已关闭远程联机：不使用 TURN');
        }

        _applyCustomTurnUI(){
            const cfg=_readCustomTurnConfig();
            const urls=(cfg?.urls||[]).join('\n');
            $('input-turn-urls').value=urls;
            $('input-turn-username').value=cfg?.username||'';
            $('input-turn-credential').value=cfg?.credential||'';
            const useCustom=!!(cfg&&cfg.urls?.length&&cfg.username&&cfg.credential);
            $('turn-config-status').textContent=useCustom
                ? `当前：使用自定义 TURN（${cfg.urls.length} 个地址）`
                : '当前：使用内置 TURN 配置';
        }

        toggleTurnPanel(){
            const p=$('turn-panel');
            if(!p) return;
            p.classList.toggle('hidden');
        }

        saveCustomTurnConfig(){
            const urls=_normalizeTurnUrls($('input-turn-urls').value);
            const username=$('input-turn-username').value.trim();
            const credential=$('input-turn-credential').value.trim();
            if(!urls.length||!username||!credential){
                showToast('请完整填写 TURN URLs / 用户名 / 密码');
                return;
            }
            _setCustomTurnConfig({urls,username,credential});
            this._applyCustomTurnUI();
            showToast('已保存自定义 TURN 配置');
        }

        clearCustomTurnConfig(){
            _clearCustomTurnConfig();
            this._applyCustomTurnUI();
            showToast('已清空自定义 TURN，恢复内置配置');
        }

        _getName(){
            let n=$('input-name').value.trim();
            if(!n)n='玩家'+rng(1,999);
            $('input-name').value=n;
            localStorage.setItem('lg_playerName',n);
            return n;
        }

        _slamHomeStamp(){
            const joker=$('home-joker'), stamp=$('home-liar-stamp');
            if(joker) joker.classList.remove('wobble');
            if(stamp){stamp.classList.remove('slam');void stamp.offsetWidth;stamp.classList.add('slam');}
            if(navigator.vibrate) navigator.vibrate(50);
            try{SFX.boxcrash();}catch(e){}
        }

        _resetHomeStamp(){
            const joker=$('home-joker'), stamp=$('home-liar-stamp');
            if(joker) joker.classList.add('wobble');
            if(stamp) stamp.classList.remove('slam');
        }

        async _create(){
            const name=this._getName();
            this._slamHomeStamp();
            try{
                $('btn-create').disabled=true; $('btn-create').textContent='创建中...';
                this.net=new NetworkManager();
                const code=await this.net.createRoom();
                this.game=new GameEngine(this.net);
                this.game.myName=name;
                this._bindCallbacks();
                this.game.initLobby(this.selectedDeckCount);
                this._showLobby(code,true);
                showToast('房间已创建: '+code);
            }catch(e){
                showToast('创建失败: '+e.message);
                if(this.net){this.net.destroy();this.net=null;}
            }finally{
                $('btn-create').disabled=false; $('btn-create').textContent='✏️ 创建房间';
            }
        }

        async _join(){
            const name=this._getName();
            const code=$('input-room-code').value.trim().toUpperCase();
            if(code.length<2){showToast('请输入房间号');return;}
            this._slamHomeStamp();
            try{
                $('btn-join').disabled=true; $('btn-join').textContent='...';
                this.net=new NetworkManager();
                await this.net.joinRoom(code);
                this.game=new GameEngine(this.net);
                this.game.myName=name;
                this._bindCallbacks();
                this.game.sendJoin(name);
                this._showLobby(code,false);
                showToast('已加入房间: '+code);
            }catch(e){
                showToast('加入失败: '+e.message);
                if(this.net){this.net.destroy();this.net=null;}
            }finally{
                $('btn-join').disabled=false; $('btn-join').textContent='加入';
            }
        }

        _checkUrlParams(){
            // Support both ?room=XXXX and #room=XXXX
            const params=new URLSearchParams(window.location.search);
            let code=params.get('room');
            if(!code){
                const h=window.location.hash;
                if(h&&h.includes('room=')) code=h.split('room=')[1]?.substring(0,4);
            }
            if(code){
                code=code.trim().toUpperCase().substring(0,4);
                $('input-room-code').value=code;
                // Clean URL without reloading
                history.replaceState(null,'',window.location.pathname);
                // Auto-join after a brief delay to let PeerJS CDN load
                setTimeout(()=>this._autoJoin(code),600);
            }
        }

        async _autoJoin(code){
            const name=this._getName();
            this._slamHomeStamp();
            showToast('正在自动加入房间 '+code+'...');
            try{
                $('btn-join').disabled=true; $('btn-join').textContent='加入中...';
                this.net=new NetworkManager();
                await this.net.joinRoom(code);
                this.game=new GameEngine(this.net);
                this.game.myName=name;
                this._bindCallbacks();
                this.game.sendJoin(name);
                this._showLobby(code,false);
                showToast('已自动加入房间: '+code);
            }catch(e){
                showToast('自动加入失败: '+e.message);
                if(this.net){this.net.destroy();this.net=null;}
            }finally{
                $('btn-join').disabled=false; $('btn-join').textContent='🚪 加入房间';
            }
        }

        // ─── Lobby ───
        _showLobby(code,isHost){
            showScreen('lobby');
            $('lobby-room-code').textContent=code;
            $('lobby-player-max').textContent=_getRoomMaxPlayers();
            const qr=$('lobby-qr'); qr.innerHTML='';
            try{
                const url=BASE_URL+'?room='+code;
                new QRCode(qr,{text:url,width:100,height:100,correctLevel:QRCode.CorrectLevel.L});
            }catch(e){qr.textContent='📷';}
            $('deck-selector').classList.toggle('disabled',!isHost);
            $('lobby-settings')?.classList.toggle('disabled',!isHost);
            $('btn-start').style.display=isHost?'':'none';
            $('btn-leave-room').style.display=isHost?'none':'';
            $('lobby-status').textContent=isHost?'等待玩家加入后开始':'等待房主开始游戏...';
        }

        _updateLobby(state){
            if(!state)return;
            const ps=state.players;
            $('lobby-player-count').textContent=ps.length;
            $('lobby-player-max').textContent=state.maxPlayers||_getRoomMaxPlayers();
            let h='';
            for(const p of ps){
                const isH=p.joinOrder===0, isMe=p.id===this.game.myPlayerId;
                let kickBtn='';
                if(this.net.isHost && !isMe){
                    kickBtn=`<button class="doodle-btn btn-sm btn-red" style="padding:2px 6px; font-size:0.7rem; margin-left:auto;" onclick="app.kickPlayer('${p.id}')">踢出</button>`;
                }
                h+=`<div class="player-slot"><div class="player-dot ${p.connected?'':'offline'}"></div><span>${p.name}${isMe?' (我)':''}</span>${isH?'<span class="player-host-badge">房主</span>':''}${kickBtn}</div>`;
            }
            $('lobby-player-list').innerHTML=h;
            const cpp=Math.floor((state.deckCount*54)/Math.max(ps.length,1));
            $('deck-hint').textContent=`每人约 ${cpp} 张牌`;
            this.selectedDeckCount=state.deckCount;
            $$('.deck-option').forEach(el=>el.classList.toggle('selected',parseInt(el.dataset.count)===state.deckCount));
            // Sync settings
            const cm=state.challengeMode||'sequential';
            $('lobby-mode-seq')?.classList.toggle('selected',cm==='sequential');
            $('lobby-mode-ffa')?.classList.toggle('selected',cm==='freeforall');
            const sl=state.showPlayLog!==false;
            const toggleLog=$('toggle-play-log');
            if(toggleLog){
                toggleLog.classList.toggle('active',sl);
                toggleLog.setAttribute('aria-checked', sl.toString());
            }
            $('btn-start').disabled=ps.filter(p=>p.connected).length<2;
        }

        selectDeckCount(c){
            if(!this.net?.isHost)return;
            this.selectedDeckCount=c;
            if(this.game)this.game.sendDeckCount(c);
            $$('.deck-option').forEach(el=>el.classList.toggle('selected',parseInt(el.dataset.count)===c));
        }

        // ─── Game callbacks ───
        _bindCallbacks(){
            this.game.onStateUpdate=s=>this._onState(s);
            this.game.onHandUpdate=h=>this._onHand(h);
            this.game.onChallengeResult=d=>this._onChResult(d);
            this.game.onGameOver=d=>this._onGameOver(d);
            this.game.onLog=(m,i,p)=>this._addLog(m,i,p);
            this.game.onLogClear=()=>{$('game-log').innerHTML='';};
            this.game.onRequestDeclare=()=>this._showDeclareModal();
            this.game.onPlayerDC=d=>this._showDcPause(d);
            this.game.onPlayerRC=d=>this._hideDcPause(d);
            this.game.onDCContinue=()=>this._hideDcPause();
            this.net.onPeerConnect=(pid)=>{};
            this.net.onPeerDisconnect=(pid)=>{
                if(this.net.isHost&&this.game)this.game.handleDisconnect(pid);
                else if(pid===this.net.hostPeerId)this._hostLost();
            };
        }

        _onState(state){
            const prevPhase=this._prevPhase;
            const ct=state?.tableCardCount||0;
            if(ct===0&&this._poolVisualPrevCount>0){
                this._clearPoolPressure();
            }
            this._poolVisualPrevCount=ct;
            // 新一轮（宣言阶段）重置触发器：每个宣言对应出牌周期只触发一次
            if(state.phase==='DECLARING'&&prevPhase!=='DECLARING'){
                this._resetPoolSfxRound(state.tableCardCount||0);
            }

            if(state.phase==='LOBBY'){
                this._poolSfxPrevCount=0;
                this._poolSfxTriggeredBase=false;
                this._poolSfxTriggeredHigh=false;
                this._clearPoolPressure();
                this._updateLobby(state);
                const active=$$('.screen.active')[0]?.id;
                if(!active||active==='screen-home')showScreen('lobby');
                this._prevPhase=state.phase;
                return;
            }
            if(state.phase!=='GAME_OVER'){
                const active=$$('.screen.active')[0]?.id;
                if(active!=='screen-game'){
                    showScreen('game');
                    try{SFX.cardmixing();}catch(e){} // dealing sound on game start
                }
            }

            if(state.phase==='TURN'){
                this._maybePlayPoolOverflowSfx(state);
            }

            this._renderGame(state);
            this._prevPhase=state.phase;
        }

        _renderGame(s){
            $('game-declared-rank').textContent=s.declaredRank||'-';
            $('game-room-tag').textContent=this.net.roomCode;
            const cur=s.players[s.currentPlayerIndex];
            const dealer=s.players[s.dealerIndex];

            const ti=$('game-turn-info');
            const isMyTurn=s.phase==='TURN'&&cur?.id===this.game.myPlayerId;
            if(s.phase==='DECLARING')
                ti.textContent=`${dealer?.name||'?'} 正在宣言...`;
            else if(s.phase==='TURN')
                ti.textContent=isMyTurn?'💡 轮到你了！':`等待 ${cur?.name||'?'}`;
            else if(s.phase==='RESOLVING')
                ti.textContent='⚡ 质疑中...';
            else ti.textContent='';
            ti.classList.toggle('my-turn',isMyTurn);

            this._renderOpponents(s);
            this._renderTable(s);
            this._renderActions(s);
            this._updateFFA(s);
            // Detect opponent action → shake their frame
            this._detectOpponentAction(s);
        }

        _renderOpponents(s){
            let h='';
            for(let i=0;i<s.players.length;i++){
                const p=s.players[i];
                if(p.id===this.game.myPlayerId)continue;
                const isTurn=i===s.currentPlayerIndex&&s.phase==='TURN';
                const isD=i===s.dealerIndex;
                let handVis='';
                const dcs=p.deckHandCounts||[p.handCount];
                for(let d=0;d<dcs.length;d++){
                    if(dcs[d]>0) handVis+=`<span class="opp-deck"><span class="mini-card-back" data-deck="${d}"></span>\u00d7${dcs[d]}</span>`;
                }
                if(!handVis) handVis='<span style="font-size:.8rem;color:#aaa;">0</span>';
                const isW=(s.winners||[]).includes(p.id);
                // Random rotation for sketchy feel (stable per render not ideal, preferably use stored hash)
                // But we can just use player ID to determine rotation to keep it stable
                const rot = (parseInt(p.id.slice(-4),16)%6 - 3);
                h+=`<div class="opponent-card ${isTurn?'is-turn':''} ${isD?'is-dealer':''} ${isW?'is-winner':''} ${!p.connected?'disconnected':''}" data-pid="${p.id}" style="--opp-rot:${rot}deg">
                    <div class="opponent-name">${p.name}</div><div class="opponent-hand-vis">${handVis}</div></div>`;
            }
            $('opponents-area').innerHTML=h;
        }

        _renderTable(s){
            const row=$('pool-cards-row');
            const ct=s.tableCardCount;
            const cw=40, ch=56; // card-sm dimensions
            let h=''; 
            
            // Generate distinct visual layers based on card count to keep DOM manageable while looking full
            // Up to ~50 cards we can render them all. If it goes extreme (e.g. 150+), 
            // cap visually at 80 to save performance, but 80 is plenty to look scattered and thick.
            const visualLimit = 80;
            const mx=Math.min(ct, visualLimit); 

            const rw=Math.max(220,row?.clientWidth||0);
            const rh=Math.max(86,row?.clientHeight||0);
            // 放牌范围：覆盖整张浅棕牌桌，允许轻微越界
            // 底部额外放宽，让牌能更靠近文字区（文字层级仍在上方，不会被遮挡）
            const spillX=12, spillTop=10, spillBottom=38;
            const placeMinX=-spillX;
            const placeMaxX=Math.max(placeMinX,rw-cw+spillX);
            const placeMinY=-spillTop;
            const placeMaxY=Math.max(placeMinY,rh-ch+spillBottom);

            const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

            const centerX=(placeMinX+placeMaxX)/2;
            const centerY=(placeMinY+placeMaxY)/2;
            const radiusX=Math.max(10,(placeMaxX-placeMinX)/2);
            const radiusY=Math.max(6,(placeMaxY-placeMinY)/2);
            
            for(let i=0;i<mx;i++){
                const rot=rng(-50,50);
                const angle=Math.random()*Math.PI*2;
                // 低开销重尾分布：多数在中心，少量远离中心，整体仍保持中间密四周疏
                // core: 58%, mid: 30%, tail: 12%
                const u=Math.random();
                const radial = u<0.58
                    ? Math.pow(Math.random(),1.95)
                    : u<0.88
                        ? Math.pow(Math.random(),0.8)
                        : Math.min(1,0.78 + 0.22*Math.pow(Math.random(),0.22));
                let cx=centerX+Math.cos(angle)*radiusX*radial+rng(-7,7);
                let cy=centerY+Math.sin(angle)*radiusY*radial+rng(-5,5);

                cx=clamp(cx,placeMinX,placeMaxX);
                cy=clamp(cy,placeMinY,placeMaxY);
                
                let dk=0, accum=0;
                for(const entry of (s.tablePlayLog||[])){
                    if(i<accum+entry.count){break;}
                    accum+=entry.count; dk=(dk+1)%3;
                }
                h+=`<div class="card card-sm face-down pool-card" data-deck="${dk%(this.selectedDeckCount||1)}" style="transform:rotate(${rot}deg);left:${cx}px;top:${cy}px;"></div>`;
            }
            row.innerHTML=h;
            $('pool-count').textContent=ct>0?`牌池: ${ct} 张`:'- 空 -';
            if(s.lastPlayerId&&s.lastPlayCount>0){
                const lp=s.players.find(p=>p.id===s.lastPlayerId);
                $('pool-last-play').textContent=`${lp?.name||'?'} 出了 ${s.lastPlayCount} 张`;
            }else $('pool-last-play').textContent='';
        }

        // Detect when an opponent plays cards or triggers a challenge → shake their frame
        _detectOpponentAction(s){
            const prevSeq=this._prevSeq||0;
            const prevLastPlayer=this._prevLastPlayerId||null;
            this._prevSeq=s.seq; this._prevLastPlayerId=s.lastPlayerId;
            if(s.seq<=prevSeq)return;
            // Someone acted — figure out who
            let actorId=null;
            if(s.lastPlayerId && s.lastPlayerId!==prevLastPlayer) actorId=s.lastPlayerId;
            else if(s.phase==='RESOLVING') actorId=s.players[s.currentPlayerIndex]?.id; // challenger
            if(!actorId||actorId===this.game.myPlayerId)return;
            // Play sound for opponent action
            try{
                if(s.phase==='RESOLVING') SFX.boxcrash(); // opponent challenged
                else SFX.flipcard(); // opponent played cards
            }catch(e){}
            const el=document.querySelector(`.opponent-card[data-pid="${actorId}"]`);
            if(!el)return;
            el.classList.remove('opp-acted');
            void el.offsetWidth; // reflow
            el.classList.add('opp-acted');
            el.addEventListener('animationend',()=>el.classList.remove('opp-acted'),{once:true});
        }

        _renderActions(s){
            const myTurn=this.game.isMyTurn();

            $('btn-play').disabled=!(myTurn&&s.phase==='TURN'&&this.selectedCards.size>0);
            $('btn-pass').disabled=!(myTurn&&s.phase==='TURN');
        }

        _updateFFA(s){
            const btn=$('btn-ffa-challenge');
            const canCh=this.game.canChallenge();
            if(s.phase==='TURN'&&s.lastPlayerId&&canCh)
                btn.classList.add('visible');
            else btn.classList.remove('visible');
        }

        // ─── Hand ───
        _onHand(hand){
            this.selectedCards.clear();
            this._renderHand(hand);
            this._renderHandStats(hand);
        }

        _renderHand(hand){
            const area=$('hand-area');
            if(!hand||!hand.length){area.innerHTML='<div style="color:#aaa;font-size:.9rem;padding:20px;">没有手牌</div>';return;}
            const sorted=sortCards(hand);
            // Stacking density: 3 tiers
            const nc=sorted.length;
            const ml=nc<=10?-3:nc<=25?-17:-28;
            area.style.setProperty('--card-ml',ml+'px');
            let h='';
            for(let i=0;i<sorted.length;i++){
                const c=sorted[i];
                const rot=((i-sorted.length/2)*1.2).toFixed(1);
                const sel=this.selectedCards.has(c.id)?'selected':'';
                const isRed=RED_SUITS.has(c.suit), isJ=c.rank==='JOKER';
                const sc=isJ?'card-joker':(isRed?'suit-red':'suit-black');
                const sym=DECK_COLORS[c.deck]?.symbol||'';
                const dr=isJ?(c.jokerType==='big'?'大王':'小王'):c.rank;
                const ds=isJ?'🃏':c.suit;
                h+=`<div class="card ${sc} ${sel}" data-id="${c.id}" data-deck="${c.deck}" style="--card-rot:${rot}deg" onclick="app.toggleCard('${c.id}')">
                    <span class="card-corner">${sym}</span><span class="card-rank">${dr}</span><span class="card-suit">${ds}</span></div>`;
            }
            area.innerHTML=h;
            this._updatePlayBtn();
        }

        _renderHandStats(hand){
            const box=$('hand-stats');
            if(!box) return;
            const cards=Array.isArray(hand)?hand:[];
            const counts={};
            for(const c of cards){
                if(!c) continue;
                const key=this._rankKeyOfCard(c);
                counts[key]=(counts[key]||0)+1;
            }

            const order=[...RANKS,'🃏'];
            const chips=order
                .filter(k=>counts[k]>0)
                .map(k=>`<button class="hs-chip" data-rank="${k}" data-total="${counts[k]}" onclick="app.selectCardsByRank(this.dataset.rank)"><span class="hs-rank">${k}</span><span class="hs-count">×${counts[k]}</span></button>`)
                .join('');

            box.innerHTML=`
                <div class="hand-stats-head">
                    <div class="hand-stats-title">🧮 手牌统计</div>
                    <div class="hand-stats-total">总数 ${cards.length}</div>
                </div>
                <div class="hand-stats-grid">${chips||'<div style="font-size:.82rem;color:#8f7f6a;">暂无手牌</div>'}</div>
            `;
            this._updateHandStatsSelectionState();
        }

        toggleCard(id){
            try{SFX.click();}catch(e){}
            if(this.selectedCards.has(id))this.selectedCards.delete(id);
            else this.selectedCards.add(id);
            this._syncHandSelectionUI();
        }

        selectCardsByRank(rankKey){
            const hand=this.game?.myHand;
            if(!Array.isArray(hand)||!hand.length) return;

            const rankIds=[];
            for(const c of hand){
                if(!c) continue;
                if(this._rankKeyOfCard(c)===rankKey) rankIds.push(c.id);
            }

            if(!rankIds.length) return;
            const allSelected=rankIds.every(id=>this.selectedCards.has(id));
            if(allSelected){
                rankIds.forEach(id=>this.selectedCards.delete(id));
            }else{
                rankIds.forEach(id=>this.selectedCards.add(id));
            }

            try{SFX.click();}catch(e){}
            this._syncHandSelectionUI();
        }

        _syncHandSelectionUI(){
            $$('.hand-area .card').forEach(el=>el.classList.toggle('selected',this.selectedCards.has(el.dataset.id)));
            this._updateHandStatsSelectionState();
            this._updatePlayBtn();
        }

        _rankKeyOfCard(card){
            return card?.rank==='JOKER' ? '🃏' : card?.rank;
        }

        _updateHandStatsSelectionState(){
            const chips=$$('#hand-stats .hs-chip');
            if(!chips.length) return;
            const hand=this.game?.myHand;
            if(!Array.isArray(hand)||!hand.length){
                chips.forEach(chip=>chip.classList.remove('is-selected'));
                return;
            }

            const totalByRank={};
            const selectedByRank={};
            for(const c of hand){
                if(!c) continue;
                const key=this._rankKeyOfCard(c);
                totalByRank[key]=(totalByRank[key]||0)+1;
                if(this.selectedCards.has(c.id)) selectedByRank[key]=(selectedByRank[key]||0)+1;
            }

            chips.forEach(chip=>{
                const rank=chip.dataset.rank;
                const total=totalByRank[rank]||0;
                const selected=selectedByRank[rank]||0;
                chip.classList.toggle('is-selected',total>0&&selected===total);
            });
        }

        _updatePlayBtn(){
            const canPlay=this.game?.isMyTurn()&&this.selectedCards.size>0;
            const btn=$('btn-play');
            btn.disabled=!canPlay;
            const n=this.selectedCards.size;
            $('sel-count').textContent=n>0?`×${n}`:'';
            // Wiggle animation on selection change
            if(n>0){
                btn.classList.remove('has-sel');void btn.offsetWidth;
                btn.classList.add('has-sel');
            } else btn.classList.remove('has-sel');
        }

        _playCards(){
            if(!this.selectedCards.size)return;
            this.game.sendPlayCards([...this.selectedCards]);
            this.selectedCards.clear();
            try{SFX.flipcard();}catch(e){}
        }

        // ─── Declare modal ───
        _initRankGrid(){
            let h='';
            for(const r of RANKS)h+=`<button class="rank-btn" data-rank="${r}" onclick="app.selectRank('${r}')">${r}</button>`;
            $('rank-grid').innerHTML=h;
        }

        _showDeclareModal(){
            this.selectedRank=null;
            $$('.rank-btn').forEach(b=>b.classList.remove('selected'));
            $('btn-declare-confirm').disabled=true;
            // Render hand preview in declare modal
            this._renderDeclareHandPreview();
            $('modal-declare').classList.add('active');
        }

        _renderDeclareHandPreview(){
            const scroll=$('declare-hand-scroll');
            if(!scroll)return;
            const hand=this.game?.myHand;
            if(!hand||!hand.length){scroll.innerHTML='<span style="color:#aaa;font-size:.85rem;">暂无手牌</span>';return;}
            const sorted=sortCards(hand);
            let h='';
            for(const c of sorted){
                const isRed=RED_SUITS.has(c.suit), isJ=c.rank==='JOKER';
                const sc=isJ?'card-joker':(isRed?'suit-red':'suit-black');
                const sym=DECK_COLORS[c.deck]?.symbol||'';
                const dr=isJ?(c.jokerType==='big'?'大王':'小王'):c.rank;
                const ds=isJ?'🃏':c.suit;
                h+=`<div class="card card-sm ${sc}" data-deck="${c.deck}"><span class="card-corner">${sym}</span><span class="card-rank">${dr}</span><span class="card-suit">${ds}</span></div>`;
            }
            scroll.innerHTML=h;
        }

        selectRank(r){
            this.selectedRank=r;
            $$('.rank-btn').forEach(b=>b.classList.toggle('selected',b.dataset.rank===r));
            $('btn-declare-confirm').disabled=false;
        }

        selectChallengeMode(m){
            if(!this.net?.isHost)return;
            this.selectedChallengeMode=m;
            if(this.game)this.game.net.sendToHost({type:'CHALLENGE_MODE',mode:m});
        }

        togglePlayLog(){
            if(!this.net?.isHost)return;
            const el=$('toggle-play-log');
            const val=!el.classList.contains('active');
            if(this.game)this.game.net.sendToHost({type:'SHOW_PLAY_LOG',value:val});
        }

        _confirmDeclare(){
            if(!this.selectedRank)return;
            this.game.sendDeclare(this.selectedRank);
            $('modal-declare').classList.remove('active');
        }

        // ─── Challenge result ───
        _onChResult(d){
            this._clearPoolPressure();
            try{SFX.boxcrash();}catch(e){}
            const overlay=$('overlay-liar'), stamp=$('stamp-text');
            stamp.classList.remove('animate','honest');
            stamp.textContent=d.isLiar?'LIAR!':'HONEST!';
            if(!d.isLiar)stamp.classList.add('honest');
            overlay.classList.add('active');
            void stamp.offsetWidth;
            stamp.classList.add('animate');
            if(navigator.vibrate)navigator.vibrate([100,50,100]);
            $('screen-game')?.classList.add('shake');
            setTimeout(()=>$('screen-game')?.classList.remove('shake'),300);

            setTimeout(()=>{
                overlay.classList.remove('active'); stamp.classList.remove('animate');

                // --- NEW: Card flying animation ---
                const poolCards = document.querySelectorAll('.pool-card');
                let targetEl = null;

                // Determine target: local player's hand or opponent's avatar
                if (d.loserId === this.game.myPlayerId) {
                    targetEl = $('hand-area');
                } else {
                    targetEl = document.querySelector(`.opponent-card[data-pid="${d.loserId}"]`);
                }

                if (poolCards.length > 0 && targetEl) {
                    const targetRect = targetEl.getBoundingClientRect();
                    const targetX = targetRect.left + targetRect.width / 2;
                    const targetY = targetRect.top + targetRect.height / 2;

                    poolCards.forEach((card, i) => {
                        const rect = card.getBoundingClientRect();
                        const clone = card.cloneNode(true);

                        // Calculate center of the original card
                        const startX = rect.left + rect.width / 2;
                        const startY = rect.top + rect.height / 2;

                        // Append to body to avoid overflow clipping
                        clone.style.position = 'fixed';
                        clone.style.left = `${startX - card.offsetWidth / 2}px`;
                        clone.style.top = `${startY - card.offsetHeight / 2}px`;
                        clone.style.margin = '0';
                        clone.style.zIndex = '9999';
                        clone.style.transition = 'all 0.5s cubic-bezier(0.25, 0.1, 0.25, 1)';

                        document.body.appendChild(clone);
                        card.style.opacity = '0'; // Hide original

                        // Trigger fly animation with slight stagger
                        setTimeout(() => {
                            clone.style.left = `${targetX - card.offsetWidth / 2}px`;
                            clone.style.top = `${targetY - card.offsetHeight / 2}px`;
                            clone.style.transform = `rotate(0deg) scale(0.2)`;
                            clone.style.opacity = '0';
                        }, i * 20 + 10);

                        // Cleanup clone
                        setTimeout(() => {
                            clone.remove();
                        }, i * 20 + 600);
                    });

                    // Trigger penalty animation on the target
                    if (d.loserId !== this.game.myPlayerId) {
                        targetEl.classList.add('opp-penalty');
                        targetEl.addEventListener('animationend', () => targetEl.classList.remove('opp-penalty'), {once: true});
                    } else {
                        $('screen-game')?.classList.add('shake');
                        setTimeout(()=>$('screen-game')?.classList.remove('shake'), 400);
                    }

                    // Wait for the longest animation to finish before showing detail overlay
                    const maxDelay = poolCards.length * 20 + 500;
                    setTimeout(() => {
                        this._showChDetail(d);
                    }, maxDelay + 100);
                } else {
                    // Fallback if no cards or target found
                    this._showChDetail(d);
                }
            },1200);
        }

        _showChDetail(d){
            $('challenge-title').textContent=d.isLiar?'🎯 抓到骗子了！':'❌ 质疑失败！';
            $('challenge-detail').textContent=`${d.challengerName} 质疑了 ${d.targetName}`;
            let h='<div style="font-size:.85rem;color:#888;margin-bottom:6px;">翻开的牌 (声称是 '+d.declaredRank+'):</div><div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;">';
            let hasJoker = false;
            for(const c of d.cards){
                const match=c.rank===d.declaredRank||c.isJoker;
                if(c.isJoker) hasJoker = true;
                if (c.isJoker && !d.isLiar) {
                    h += `<div class="card-sm joker-shake" style="font-size: 40px; display: inline-flex; align-items: center; justify-content: center; background: white; border: 1px solid #333; border-radius: 4px; width: 40px; height: 60px; margin: 0 2px; vertical-align: top;">🃏</div>`;
                } else {
                    h += cardToHTML(c, 'card-sm');
                }
            }
            h+='</div>';
            $('challenge-reveal-cards').innerHTML=h;
            $('challenge-verdict').textContent=d.isLiar?`${d.targetName} 的牌里有假的！`:`${d.targetName} 的牌全是真的！`;
            $('challenge-verdict').style.color=d.isLiar?'#2E7D32':'var(--stamp-red)';
            $('challenge-penalty').textContent=`${d.loserName} 收走 ${d.totalCards||'所有'} 张牌`;
            $('overlay-challenge').classList.add('active');
            
            if (!d.isLiar && hasJoker) {
                try{SFX.joker();}catch(e){}
            }
            
            this._chDismissTimer=setTimeout(()=>$('overlay-challenge').classList.remove('active'),6000);
        }

        dismissChallenge(e){
            // Click outside the box dismisses
            if(this._chDismissTimer)clearTimeout(this._chDismissTimer);
            $('overlay-challenge').classList.remove('active');
        }

        // ─── Disconnect pause overlay ───
        _showDcPause(d){
            const ol=$('overlay-dc-pause');
            ol.querySelector('.dc-pause-text').textContent=`玩家 ${d.playerName} 断线了，等待重连中…`;
            const btn=ol.querySelector('.dc-pause-btn');
            btn.style.display=this.net&&this.net.isHost?'inline-block':'none';
            const rcSpan = ol.querySelector('#dc-pause-room-code');
            const roomCode=this.net ? this.net.roomCode : '';
            if(rcSpan) rcSpan.textContent = roomCode;
            const qrEl=ol.querySelector('#dc-pause-qr');
            if(qrEl){
                qrEl.innerHTML='';
                if(roomCode){
                    try{
                        const url=BASE_URL+'?room='+roomCode;
                        new QRCode(qrEl,{text:url,width:112,height:112,correctLevel:QRCode.CorrectLevel.L});
                    }catch(e){
                        qrEl.textContent='📷';
                    }
                }
            }
            ol.classList.add('active');
        }
        _hideDcPause(d){
            const ol=$('overlay-dc-pause');
            const qrEl=ol?.querySelector('#dc-pause-qr');
            if(qrEl) qrEl.innerHTML='';
            ol.classList.remove('active');
        }
        dismissDcPause(){
            // Host clicks "skip waiting" → tell engine to force continue
            if(this.game && this.net && this.net.isHost){
                this.game.hostContinueDc();
            } else if(this.game){
                this.game.net.sendToHost({type:'SKIP_DC_WAIT'});
            }
            $('overlay-dc-pause').classList.remove('active');
        }

        // ─── Game over ───
        _onGameOver(d){
            if(d.isFirstWinner) {
                this._triggerFireworks();
            }
            if(d.isFinal){
                // True end of game — show result screen
                setTimeout(()=>{
                    showScreen('result');
                    const ranks=d.winners||[d.winnerName];
                    $('result-winner-name').textContent=`🎉 ${ranks.join(' > ')} 🎉`;
                    const isMe=d.winners?.some?d.winners.some((_,i)=>i===0&&d.winnerId===this.game.myPlayerId):d.winnerId===this.game.myPlayerId;
                    $('result-detail').textContent=`游戏结束！排名: ${ranks.join(' › ')}`;
                    $('btn-play-again').style.display=this.net?.isHost?'':'none';
                },1500);
            } else {
                // Someone won but game continues
                const isMe=d.winnerId===this.game.myPlayerId;
                if(isMe){
                    showToast('🏆 你赢了！等待其他人继续对局...',3000);
                } else {
                    showToast(`🏆 ${d.winnerName} 获胜！剩余 ${d.remainCount} 人继续`,3000);
                }
            }
        }

        _triggerFireworks() {
            try{SFX.laugh();}catch(e){}
            const suits = ['♥️', '♦️', '♠️', '♣️', '🃏'];
            const colors = ['#e53935', '#e53935', '#1e1e1e', '#1e1e1e', '#8e24aa'];
            for (let i = 0; i < 40; i++) {
                const fw = document.createElement('div');
                fw.className = 'suit-firework';
                const suitIdx = Math.floor(Math.random() * suits.length);
                fw.textContent = suits[suitIdx];
                fw.style.color = colors[suitIdx];
                
                // Randomize trajectory
                const angle = Math.random() * Math.PI * 2;
                const velocity = 100 + Math.random() * 300;
                const txMid = Math.cos(angle) * velocity;
                const tyMid = Math.sin(angle) * velocity - 150; // initial upward burst
                
                const txEnd = txMid + (Math.random() - 0.5) * 100;
                const tyEnd = tyMid + 400 + Math.random() * 200; // gravity fall
                
                const rotMid = (Math.random() - 0.5) * 360;
                const rotEnd = rotMid + (Math.random() - 0.5) * 720;
                
                const scale = 0.8 + Math.random() * 1.2;
                
                fw.style.setProperty('--tx-mid', `${txMid}px`);
                fw.style.setProperty('--ty-mid', `${tyMid}px`);
                fw.style.setProperty('--tx-end', `${txEnd}px`);
                fw.style.setProperty('--ty-end', `${tyEnd}px`);
                fw.style.setProperty('--rot-mid', `${rotMid}deg`);
                fw.style.setProperty('--rot-end', `${rotEnd}deg`);
                fw.style.setProperty('--scale', `${scale}`);
                
                // Randomize animation duration slightly
                fw.style.animationDuration = `${1.2 + Math.random() * 0.8}s`;
                
                document.body.appendChild(fw);
                
                // Cleanup
                setTimeout(() => {
                    if (fw.parentNode) fw.parentNode.removeChild(fw);
                }, 2500);
            }
        }

        _backHome(){
            if(this.net){this.net.destroy();this.net=null;}
            this.game=null; this.selectedCards.clear();
            this._prevPhase=null;
            this._poolSfxRound=0;
            this._poolSfxPrevCount=0;
            this._poolSfxTriggeredBase=false;
            this._poolSfxTriggeredHigh=false;
            this._poolVisualPrevCount=0;
            this._clearPoolPressure();
            $('btn-ffa-challenge').classList.remove('visible');
            $('overlay-challenge').classList.remove('active');
            $('overlay-liar').classList.remove('active');
            $('overlay-reconnect').classList.remove('active');
            $('overlay-dc-pause').classList.remove('active');
            $('modal-declare').classList.remove('active');
            $('modal-rules').classList.remove('active');
            $('game-log').innerHTML='';
            if($('hand-stats'))$('hand-stats').innerHTML='';
            showScreen('home');
            this._resetHomeStamp();
        }

        showRules(){
            $('modal-rules').classList.add('active');
        }

        // ─── Log ───
        _addLog(msg,imp=false,isPlayInfo=false){
            // Filter play info if disabled
            if(isPlayInfo&&this.game?.state?.showPlayLog===false)return;
            const log=$('game-log');
            const e=document.createElement('div');
            e.className='log-entry'+(imp?' important':''); e.textContent=msg;
            log.appendChild(e); log.scrollTop=log.scrollHeight;
            while(log.children.length>50)log.removeChild(log.firstChild);
        }

        // ─── Host migration ───
        _hostLost(){
            showToast('房主已断线');
            $('overlay-reconnect').classList.add('active');
            $('reconnect-text').textContent='房主已断线，正在迁移...';
            const state=this.game?.state;
            const mirroredFull=this.game?.fullState||(()=>{try{return JSON.parse(localStorage.getItem('lg_fullState')||'null');}catch(e){return null;}})();
            if(!state&&!mirroredFull){
                $('reconnect-text').textContent='无法恢复';
                setTimeout(()=>{$('overlay-reconnect').classList.remove('active');this._backHome();},3000);
                return;
            }
            const players=(state?.players||mirroredFull?.players||[]);
            const me=players.find(p=>p.id===this.game.myPlayerId);
            if(!me){$('overlay-reconnect').classList.remove('active');this._backHome();return;}

            // Highest joinOrder (excluding old host joinOrder=0) becomes new host
            const candidates=players
                .filter(p=>p.joinOrder>0&&p.connected!==false)
                .sort((a,b)=>b.joinOrder-a.joinOrder);
            const selectedHost=candidates[0]||null;
            const shouldBeHost=!!selectedHost&&selectedHost.id===this.game.myPlayerId;

            if(shouldBeHost&&me.joinOrder>0){
                setTimeout(()=>this._becomeHost(),2000);
            } else {
                setTimeout(()=>this._reconnectNewHost(),5500);
            }
        }

        async _becomeHost(){
            $('reconnect-text').textContent='正在接管房间...';
            try{
                const oldState=this.game.state;
                const oldHand=this.game.myHand;
                const oldFull=this.game.fullState||(()=>{try{return JSON.parse(localStorage.getItem('lg_fullState')||'null');}catch(e){return null;}})();
                const code=this.net.roomCode;
                this.net.destroy();
                this.net=new NetworkManager();
                this.net.isHost=true; this.net.roomCode=code;
                const pid='lg-'+code+'-m'; this.net.hostPeerId=pid;

                await new Promise((res,rej)=>{
                    this.net.peer=new Peer(pid,this.net._peerOptions(!!NET_CONFIG.hostUseTurnIfConfigured));
                    this.net.peer.on('open',id=>{
                        this.net.myPeerId=id;
                        this.net.peer.on('connection',c=>this.net._setupConn(c));
                        this.net._startHB(); res();
                    });
                    this.net.peer.on('error',rej);
                    setTimeout(()=>rej(new Error('timeout')),5000);
                });

                this.game=new GameEngine(this.net);
                this.game.myName=localStorage.getItem('lg_playerName')||'玩家';
                this._bindCallbacks();

                const fullSnapshot=oldFull||{
                    phase:oldState?.phase||'LOBBY',
                    players:(oldState?.players||[]).map(p=>({...p,hand:[],handCount:p.handCount||0})),
                    currentPlayerIndex:oldState?.currentPlayerIndex??-1,
                    dealerIndex:oldState?.dealerIndex??-1,
                    declaredRank:oldState?.declaredRank||null,
                    challengeMode:oldState?.challengeMode||'sequential',
                    tableCards:[],
                    tablePlayLog:[],
                    lastPlayerId:oldState?.lastPlayerId||null,
                    lastPlayCount:oldState?.lastPlayCount||0,
                    passCount:oldState?.passCount||0,
                    deckCount:oldState?.deckCount||1,
                    discardPile:[],
                    seq:(oldState?.seq||0),
                    showPlayLog:oldState?.showPlayLog!==false,
                    winners:oldState?.winners||[],
                    maxPlayers:oldState?.maxPlayers||_getRoomMaxPlayers()
                };
                this.game.fullState=JSON.parse(JSON.stringify(fullSnapshot));
                this.game.fullState.seq=(this.game.fullState.seq||0)+1;
                this.game.fullState.players=(this.game.fullState.players||[]).map(p=>({
                    ...p,
                    connected:p.id===this.game.myPlayerId,
                    peerId:p.id===this.game.myPlayerId?this.net.myPeerId:(p.peerId||null),
                    hand:Array.isArray(p.hand)?p.hand:[]
                }));
                const myP=this.game.fullState.players.find(p=>p.id===this.game.myPlayerId);
                if(myP){
                    myP.peerId=this.net.myPeerId;
                    myP.hand=(Array.isArray(myP.hand)&&myP.hand.length)?myP.hand:oldHand;
                    myP.handCount=(myP.hand||[]).length;
                }
                this.game.myHand=(myP?.hand||oldHand||[]);
                this.game._broadcastState();

                showToast('你已成为新房主');
                setTimeout(()=>$('overlay-reconnect').classList.remove('active'),2000);
            }catch(e){
                console.error('[MIGRATE]',e);
                $('reconnect-text').textContent='迁移失败';
                setTimeout(()=>{$('overlay-reconnect').classList.remove('active');this._backHome();},3000);
            }
        }

        async _reconnectNewHost(){
            $('reconnect-text').textContent='正在寻找新房主...';
            const code=this.net.roomCode;
            const newPid='lg-'+code+'-m';
            const oldPlayerId=this.game?.myPlayerId||localStorage.getItem('lg_playerId');
            const maxRetries=3;
            for(let attempt=0;attempt<maxRetries;attempt++){
                try{
                    if(attempt>0){
                        $('reconnect-text').textContent=`重连中... (${attempt+1}/${maxRetries})`;
                        await new Promise(r=>setTimeout(r,2500));
                    }
                    if(this.net)this.net.destroy();
                    this.net=new NetworkManager();
                    this.net.isHost=false; this.net.roomCode=code; this.net.hostPeerId=newPid;
                    await new Promise((res,rej)=>{
                        this.net.peer=new Peer(undefined,this.net._peerOptions(false));
                        this.net.peer.on('open',id=>{
                            this.net.myPeerId=id;
                            const conn=this.net.peer.connect(newPid,{reliable:true});
                            conn.on('open',()=>{this.net.hostConn=conn;this.net._setupHostConn(conn);this.net._startHB();res();});
                            conn.on('error',rej);
                            setTimeout(()=>rej(new Error('timeout')),8000);
                        });
                        this.net.peer.on('error',rej);
                    });
                    this.game=new GameEngine(this.net);
                    this.game.myName=localStorage.getItem('lg_playerName')||'玩家';
                    if(oldPlayerId){this.game.myPlayerId=oldPlayerId;localStorage.setItem('lg_playerId',oldPlayerId);}
                    this._bindCallbacks();
                    // Use REJOIN to restore identity
                    this.net.sendToHost({type:'REJOIN',playerId:this.game.myPlayerId,name:this.game.myName});
                    showToast('已重新连接');
                    $('overlay-reconnect').classList.remove('active');
                    return;
                }catch(e){
                    console.error(`[REJOIN attempt ${attempt+1}]`,e);
                }
            }
            $('reconnect-text').textContent='重连失败';
            setTimeout(()=>{$('overlay-reconnect').classList.remove('active');this._backHome();},3000);
        }
    }

    const {
        $,
        $$,
        rng,
        showToast,
        showScreen,
        sortCards,
        cardToHTML,
    } = global.LG_RUNTIME_UTILS;

    const {
        BASE_URL,
        NET_CONFIG,
        RANKS,
        RED_SUITS,
        DECK_COLORS,
        _setRemoteOnlineEnabled,
        _normalizeTurnUrls,
        _readCustomTurnConfig,
        _setCustomTurnConfig,
        _clearCustomTurnConfig,
        _getRoomMaxPlayers,
    } = global.LG_RUNTIME_CONFIG;

    const { NetworkManager } = global.LG_NETWORK_MANAGER;
    const { GameEngine } = global.LG_GAME_ENGINE;

    global.LG_APP_CONTROLLER = { App };
})(window);
