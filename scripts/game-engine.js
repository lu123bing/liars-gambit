(function initGameEngine(global){
    class GameEngine {
        constructor(net){
            this.net=net;
            this.myPlayerId=localStorage.getItem('lg_playerId')||uuid();
            localStorage.setItem('lg_playerId',this.myPlayerId);
            this.myName=localStorage.getItem('lg_playerName')||'';

            this.fullState=null; // host only, full data
            this.state=null;     // sanitized, all clients
            this.myHand=[];

            // Callbacks
            this.onStateUpdate=null; this.onHandUpdate=null;
            this.onChallengeResult=null; this.onGameOver=null;
            this.onLog=null; this.onRequestDeclare=null;
            this.onRequestRoundContinue=null;
            this._challengeWindowTimer=null;
            this._challengeRoundId=0;
            this._challengeCandidates=[];
            this._roundDecisionTimer=null;

            this._bind();
        }
        _clearRoundDecisionTimer(){
            if(this._roundDecisionTimer){
                clearTimeout(this._roundDecisionTimer);
                this._roundDecisionTimer=null;
            }
        }
        _resetChallengeWindow(){
            if(this._challengeWindowTimer){
                clearTimeout(this._challengeWindowTimer);
                this._challengeWindowTimer=null;
            }
            this._challengeCandidates=[];
        }

        _finalizeChallengeWindow(roundId){
            const fs=this.fullState;
            if(!fs) return;
            if(roundId!==this._challengeRoundId) return;
            if(!this._challengeCandidates.length){
                this._resetChallengeWindow();
                if(fs.phase==='RESOLVING'){
                    fs.phase='TURN';
                    fs.seq++;
                    this._broadcastState();
                }
                return;
            }
            const sorted=[...this._challengeCandidates].sort((a,b)=>{
                if(a.hostRecvTs!==b.hostRecvTs) return a.hostRecvTs-b.hostRecvTs;
                return String(a.challengerId).localeCompare(String(b.challengerId));
            });
            const winner=sorted[0];
            const challenger=this._pById(winner.challengerId);
            this._resetChallengeWindow();
            if(!challenger||!challenger.connected) return;
            this._resolveChallenge(challenger,{
                challengeId:winner.challengeId,
                clientTs:winner.clientTs,
                hostRecvTs:winner.hostRecvTs,
                winnerPeerId:winner.fromPeer,
                challengeRoundId:roundId
            });
        }

        _bind(){
            const n=this.net;
            // HOST receives
            n.on('JOIN',(d,from)=>{if(n.isHost)this._onJoin(d,from);});
            n.on('REJOIN',(d,from)=>{if(n.isHost)this._onRejoin(d,from);});
            n.on('DECLARE',(d,from)=>{if(n.isHost)this._onDeclare(d,from);});
            n.on('PLAY_CARDS',(d,from)=>{if(n.isHost)this._onPlayCards(d,from);});
            n.on('PASS',(d,from)=>{if(n.isHost)this._onPass(d,from);});
            n.on('CHALLENGE',(d,from)=>{if(n.isHost)this._onChallenge(d,from);});
            n.on('ROUND_CONTINUE_DECISION',(d,from)=>{if(n.isHost)this._onRoundContinueDecision(d,from);});
            n.on('DECK_COUNT',(d,from)=>{
                if(!n.isHost||!this.fullState)return;
                this.fullState.deckCount=Math.max(1,Math.min(3,d.count));
                this._broadcastState();
            });
            n.on('CHALLENGE_MODE',(d,from)=>{
                if(!n.isHost||!this.fullState||this.fullState.phase!=='LOBBY')return;
                this.fullState.challengeMode=d.mode==='freeforall'?'freeforall':'sequential';
                this._broadcastState();
            });
            n.on('SHOW_PLAY_LOG',(d,from)=>{
                if(!n.isHost||!this.fullState)return;
                this.fullState.showPlayLog=!!d.value;
                this._broadcastState();
            });
            n.on('KICK_PLAYER',(d,from)=>{
                if(!n.isHost||!this.fullState)return;
                const p=this._pById(d.playerId);
                if(p){
                    this.net.send(p.peerId,{type:'KICKED'});
                    this.fullState.players=this.fullState.players.filter(x=>x.id!==d.playerId);
                    this._log(`${p.name} 被踢出房间`);
                    this._broadcastState();
                }
            });
            n.on('START_GAME',()=>{if(n.isHost)this._startGame();});
            n.on('PLAY_AGAIN',()=>{if(n.isHost)this._startGame();});
            n.on('SKIP_DC_WAIT',()=>{if(n.isHost)this.hostContinueDc();});

            // CLIENT receives
            n.on('WELCOME',d=>{this.myPlayerId=d.playerId;localStorage.setItem('lg_playerId',d.playerId);});
            n.on('STATE_UPDATE',d=>{this.state=d.state;this._saveState();if(this.onStateUpdate)this.onStateUpdate(this.state);});
            n.on('HAND_UPDATE',d=>{this.myHand=d.hand||[];this._saveHand();if(this.onHandUpdate)this.onHandUpdate(this.myHand);});
            n.on('CHALLENGE_RESULT',d=>{if(this.onChallengeResult)this.onChallengeResult(d);});
            n.on('GAME_OVER',d=>{if(this.onGameOver)this.onGameOver(d);});
            n.on('LOG',d=>{if(this.onLog)this.onLog(d.message,d.important,d.isPlayInfo);});
            n.on('LOG_CLEAR',()=>{if(this.onLogClear)this.onLogClear();});
            n.on('REQUEST_DECLARE',()=>{if(this.onRequestDeclare)this.onRequestDeclare();});
            n.on('REQUEST_ROUND_CONTINUE',d=>{if(this.onRequestRoundContinue)this.onRequestRoundContinue(d);});
            n.on('PLAYER_DC',d=>{if(this.onPlayerDC)this.onPlayerDC(d);});
            n.on('PLAYER_RC',d=>{if(this.onPlayerRC)this.onPlayerRC(d);});
            n.on('DC_CONTINUE',()=>{if(this.onDCContinue)this.onDCContinue();});
            n.on('FULL_STATE_SYNC',d=>{
                if(n.isHost)return;
                if(!d||!d.fullState)return;
                this.fullState=d.fullState;
                this._saveFullState();
            });
            n.on('KICKED',()=>{
                alert('你已被房主踢出房间');
                location.reload();
            });
        }

        // ─── HOST: Init lobby ───
        initLobby(deckCount=1){
            this.fullState={
                phase:'LOBBY', players:[], currentPlayerIndex:-1, dealerIndex:-1,
                declaredRank:null, challengeMode:'sequential',
                tableCards:[], tablePlayLog:[], lastPlayerId:null, lastPlayCount:0,
                passCount:0, deckCount, discardPile:[], seq:0, showPlayLog:true,
                maxPlayers:_getRoomMaxPlayers(),
                pendingContinuePlayerId:null
            };
            this._addPlayer(this.myPlayerId,this.myName,this.net.myPeerId);
            this._broadcastState();
        }

        _addPlayer(id,name,peerId){
            const fs=this.fullState; if(!fs)return null;
            const ex=fs.players.find(p=>p.id===id);
            if(ex){ex.connected=true;ex.peerId=peerId;return ex;}
            const maxPlayers=fs.maxPlayers||_getRoomMaxPlayers();
            if(fs.players.length>=maxPlayers)return null;
            const p={id,name:name||('玩家'+(fs.players.length+1)),peerId,hand:[],handCount:0,connected:true,joinOrder:fs.players.length};
            fs.players.push(p); return p;
        }
        _pByPeer(pid){return this.fullState?.players.find(p=>p.peerId===pid);}
        _pById(id){return this.fullState?.players.find(p=>p.id===id);}

        // ─── HOST: Join ───
        _onJoin(d,from){
            const p=this._addPlayer(d.playerId,d.name,from);
            if(!p){this.net.send(from,{type:'ERROR',message:'房间已满'});return;}
            this.net.send(from,{type:'WELCOME',playerId:p.id});
            // If game in progress, send hand too
            if(this.fullState.phase!=='LOBBY'){
                this.net.send(from,{type:'HAND_UPDATE',hand:p.hand});
            }
            this._log(`${p.name} 加入了房间`);
            this._broadcastState();
        }

        // ─── HOST: Rejoin ───
        _onRejoin(d,from){
            // Try match by ID first, then by name
            let p=this._pById(d.playerId);
            if(!p && d.name){
                p=this.fullState.players.find(pp=>!pp.connected && pp.name===d.name);
            }
            if(!p){this._onJoin({playerId:d.playerId,name:d.name||'???'},from);return;}
            p.connected=true;p.peerId=from;
            // Update playerId if it changed (new browser session)
            if(p.id!==d.playerId){p.id=d.playerId;}
            this.net.send(from,{type:'WELCOME',playerId:p.id});
            this.net.send(from,{type:'HAND_UPDATE',hand:p.hand});
            this._log(`${p.name} 重新连接了`);
            // Notify all: player reconnected
            this.net.broadcastAndSelf({type:'PLAYER_RC',playerName:p.name});
            const hasDisconnected=(this.fullState.players||[]).some(pp=>!pp.connected&&!(this.fullState.winners||[]).includes(pp.id));
            if(!hasDisconnected){
                this._clearRoundDecisionTimer();
                if(this._dcTimer){clearTimeout(this._dcTimer);this._dcTimer=null;}
                this.net.broadcastAndSelf({type:'DC_CONTINUE'});
            }
            this._broadcastState();
        }

        // ─── HOST: Start game ───
        _startGame(){
            const fs=this.fullState;
            if(!fs||fs.players.filter(p=>p.connected).length<2)return;
            this._resetChallengeWindow();

            const deck=CardEngine.shuffle(CardEngine.createDecks(fs.deckCount));
            const active=fs.players.filter(p=>p.connected);
            const hands=CardEngine.deal(deck,active.length);
            active.forEach((p,i)=>{p.hand=sortCards(hands[i]);p.handCount=p.hand.length;});
            // Disconnected players get empty hands
            fs.players.filter(p=>!p.connected).forEach(p=>{p.hand=[];p.handCount=0;});

            fs.phase='DECLARING'; fs.tableCards=[]; fs.tablePlayLog=[]; fs.discardPile=[];
            fs.lastPlayerId=null; fs.lastPlayCount=0; fs.passCount=0;
            fs.pendingContinuePlayerId=null;
            fs.winners=[];
            fs.dealerIndex=rng(0,fs.players.length-1);
            // Make sure dealer is connected
            while(!fs.players[fs.dealerIndex].connected) fs.dealerIndex=(fs.dealerIndex+1)%fs.players.length;
            fs.currentPlayerIndex=fs.dealerIndex;
            fs.declaredRank=null; fs.seq++;

            // Clear logs for new game
            this.net.broadcastAndSelf({type:'LOG_CLEAR'});

            // Send each player their hand
            for(const p of fs.players){
                if(p.peerId===this.net.myPeerId){
                    this.myHand=[...p.hand]; this._saveHand();
                    if(this.onHandUpdate)this.onHandUpdate(this.myHand);
                } else if(p.connected){
                    this.net.send(p.peerId,{type:'HAND_UPDATE',hand:p.hand});
                }
            }

            this._log('游戏开始！发牌中...');
            this._broadcastState();

            // Request dealer to declare
            const dealer=fs.players[fs.dealerIndex];
            if(dealer.peerId===this.net.myPeerId){if(this.onRequestDeclare)this.onRequestDeclare();}
            else this.net.send(dealer.peerId,{type:'REQUEST_DECLARE'});
        }

        // ─── HOST: Declare ───
        _onDeclare(d,from){
            const fs=this.fullState;
            if(!fs||fs.phase!=='DECLARING')return;
            const dealer=fs.players[fs.dealerIndex];
            const p=this._pByPeer(from);
            if(!p||p.id!==dealer.id)return;
            fs.declaredRank=d.rank;
            fs.phase='TURN'; fs.seq++;
            this._log(`庄家 ${dealer.name} 宣言: 目标【${d.rank}】(${fs.challengeMode==='sequential'?'顺序质疑':'乱序质疑'})`,false,true);
            this._broadcastState();
        }

        // ─── HOST: Play cards ───
        _onPlayCards(d,from){
            const fs=this.fullState;
            if(!fs||fs.phase!=='TURN')return;
            const p=this._pByPeer(from); if(!p)return;
            const cur=fs.players[fs.currentPlayerIndex];
            if(p.id!==cur.id)return;
            const ids=d.cardIds; if(!ids||!ids.length)return;

            // Validate & extract cards
            const played=[];
            for(const cid of ids){
                const idx=p.hand.findIndex(c=>c.id===cid);
                if(idx===-1)return;
                played.push(p.hand[idx]);
            }
            // Remove from hand
            for(const cid of ids){
                const idx=p.hand.findIndex(c=>c.id===cid);
                if(idx!==-1)p.hand.splice(idx,1);
            }
            p.handCount=p.hand.length;

            fs.tableCards.push(...played);
            fs.tablePlayLog.push({playerId:p.id,cards:[...played]});
            fs.lastPlayerId=p.id; fs.lastPlayCount=played.length;
            fs.passCount=0; fs.seq++;

            // Send updated hand
            this._sendHand(p);
            this._log(`${p.name} 打出了 ${played.length} 张牌 (声称是 ${fs.declaredRank})`,false,true);
            this._advanceTurn();
            this._broadcastState();
        }

        // ─── HOST: Pass ───
        _onPass(d,from){
            const fs=this.fullState;
            if(!fs||fs.phase!=='TURN')return;
            const p=this._pByPeer(from); if(!p)return;
            const cur=fs.players[fs.currentPlayerIndex];
            if(p.id!==cur.id)return;

            fs.passCount++; fs.seq++;
            this._log(`${p.name} 跳过了`,false,true);

            const active=fs.players.filter(p=>p.connected&&!(fs.winners||[]).includes(p.id));
            if(fs.lastPlayerId && fs.passCount>=active.length-1){
                this._roundEnd();
            } else {
                this._advanceTurn();
                this._broadcastState();
            }
        }

        // ─── HOST: Challenge ───
        _onChallenge(d,from){
            const fs=this.fullState;
            if(!fs||!fs.lastPlayerId)return;
            if(fs.phase!=='TURN' && !(fs.phase==='RESOLVING'&&this._challengeWindowTimer)) return;
            const challenger=this._pByPeer(from); if(!challenger)return;
            if(challenger.id===fs.lastPlayerId)return;

            if(fs.challengeMode==='sequential'){
                const cur=fs.players[fs.currentPlayerIndex];
                if(challenger.id!==cur.id)return;
            }

            const challengeId=d.challengeId||(`${challenger.id}-${Date.now()}-${Math.random().toString(16).slice(2,6)}`);
            if(this._challengeCandidates.some(c=>c.challengerId===challenger.id)) return;

            if(!this._challengeWindowTimer){
                this._challengeRoundId++;
                fs.phase='RESOLVING'; fs.seq++;
                this._broadcastState();
                this._challengeWindowTimer=setTimeout(()=>this._finalizeChallengeWindow(this._challengeRoundId),CHALLENGE_WINDOW_MS);
            }
            this._challengeCandidates.push({
                challengerId:challenger.id,
                fromPeer:from,
                challengeId,
                clientTs:typeof d.clientTs==='number'?d.clientTs:null,
                hostRecvTs:Date.now()
            });
        }

        _onRoundContinueDecision(d,from){
            const fs=this.fullState;
            if(!fs||fs.phase!=='ROUND_DECISION')return;
            const p=this._pByPeer(from);
            if(!p||p.id!==fs.pendingContinuePlayerId)return;
            this._clearRoundDecisionTimer();
            this._applyRoundContinueDecision(!!d.continueRound);
        }

        _requestRoundContinueDecision(last,lastIdx){
            const fs=this.fullState;
            this._clearRoundDecisionTimer();
            fs.phase='ROUND_DECISION';
            fs.currentPlayerIndex=lastIdx;
            fs.dealerIndex=lastIdx;
            fs.pendingContinuePlayerId=last.id;
            fs.seq++;
            this._broadcastState();

            const payload={
                type:'REQUEST_ROUND_CONTINUE',
                declaredRank:fs.declaredRank,
                tableCardCount:fs.tableCards.length
            };
            if(last.peerId===this.net.myPeerId){
                if(this.onRequestRoundContinue)this.onRequestRoundContinue(payload);
            }else{
                this.net.send(last.peerId,payload);
            }

            this._roundDecisionTimer=setTimeout(()=>{
                if(this.fullState&&this.fullState.phase==='ROUND_DECISION'&&this.fullState.pendingContinuePlayerId===last.id){
                    this._applyRoundContinueDecision(false);
                }
            },12000);
        }

        _applyRoundContinueDecision(continueRound){
            const fs=this.fullState;
            if(!fs||fs.phase!=='ROUND_DECISION')return;
            const last=this._pById(fs.pendingContinuePlayerId);
            this._clearRoundDecisionTimer();
            fs.pendingContinuePlayerId=null;
            if(!last){
                fs.phase='TURN';
                fs.seq++;
                this._broadcastState();
                return;
            }

            if(continueRound){
                fs.phase='TURN';
                fs.currentPlayerIndex=fs.players.indexOf(last);
                fs.passCount=0;
                fs.seq++;
                this._log(`${last.name} 选择继续沿用宣言【${fs.declaredRank}】，牌池保留并继续累计`);
                this._broadcastState();
                return;
            }

            fs.discardPile.push(...fs.tableCards);
            this._log(`所有人都跳过了，${fs.tableCards.length} 张牌进入弃牌堆`);

            let lastIdx=fs.players.indexOf(last);
            fs.tableCards=[]; fs.tablePlayLog=[];
            fs.lastPlayerId=null; fs.lastPlayCount=0; fs.passCount=0;
            if((fs.winners||[]).includes(last.id)){
                const rem=fs.players.filter(p=>p.connected&&p.handCount>0&&!(fs.winners||[]).includes(p.id));
                if(rem.length>0) lastIdx=fs.players.indexOf(rem[0]);
            }
            fs.dealerIndex=lastIdx; fs.currentPlayerIndex=lastIdx;
            fs.phase='DECLARING'; fs.declaredRank=null; fs.seq++;

            const newDealer=fs.players[lastIdx];
            this._broadcastState();
            if(newDealer.peerId===this.net.myPeerId){if(this.onRequestDeclare)this.onRequestDeclare();}
            else this.net.send(newDealer.peerId,{type:'REQUEST_DECLARE'});
        }

        _resolveChallenge(challenger,meta={}){
            const fs=this.fullState;
            if(!fs||!fs.lastPlayerId) return;
            const lastPlay=fs.tablePlayLog[fs.tablePlayLog.length-1];
            if(!lastPlay)return;
            const target=this._pById(fs.lastPlayerId);
            if(!target)return;
            const revealed=lastPlay.cards;
            const isLiar=revealed.some(c=>c.rank!==fs.declaredRank&&!c.isJoker);

            const loserId=isLiar?target.id:challenger.id;
            const loser=this._pById(loserId);
            const totalCards=fs.tableCards.length;

            // Loser gets all table cards
            loser.hand.push(...fs.tableCards);
            loser.hand=sortCards(loser.hand);
            loser.handCount=loser.hand.length;
            this._sendHand(loser);

            // Broadcast result
            const result={
                type:'CHALLENGE_RESULT',
                challengerId:challenger.id, challengerName:challenger.name,
                targetId:target.id, targetName:target.name,
                cards:revealed, declaredRank:fs.declaredRank,
                isLiar, loserId, loserName:loser.name, totalCards,
                winningChallengeId:meta.challengeId||null,
                challengeRoundId:meta.challengeRoundId||null,
                winnerPeerId:meta.winnerPeerId||null,
                hostRecvTs:meta.hostRecvTs||null,
                clientTs:meta.clientTs||null,
                arbitrationWindowMs:CHALLENGE_WINDOW_MS
            };
            this.net.broadcastAndSelf(result);

            this._log(
                isLiar ? `🎯 ${challenger.name} 质疑成功！${target.name} 是骗子！收走 ${totalCards} 张牌`
                       : `❌ ${challenger.name} 质疑失败！${target.name} 是诚实的！${challenger.name} 收走 ${totalCards} 张牌`,
                true
            );

            // Check win — find player with 0 cards who hasn't already won
            const winner=fs.players.find(p=>p.connected&&p.handCount===0&&!(fs.winners||[]).includes(p.id));
            if(winner){this._gameOver(winner);return;}

            // Clear table, new round — winner of challenge becomes dealer
            fs.tableCards=[]; fs.tablePlayLog=[];
            fs.lastPlayerId=null; fs.lastPlayCount=0; fs.passCount=0;
            let nextDealer=isLiar?challenger:target;
            // If next dealer already won, pick next active player
            if((fs.winners||[]).includes(nextDealer.id)){
                const rem=fs.players.filter(p=>p.connected&&p.handCount>0&&!(fs.winners||[]).includes(p.id));
                if(rem.length>0) nextDealer=rem[0];
            }
            const nextDealerIdx=fs.players.indexOf(nextDealer);
            fs.dealerIndex=nextDealerIdx; fs.currentPlayerIndex=nextDealerIdx;
            fs.phase='DECLARING'; fs.declaredRank=null; fs.seq++;

            // Delay for UI
            setTimeout(()=>{
                this._broadcastState();
                if(nextDealer.peerId===this.net.myPeerId){if(this.onRequestDeclare)this.onRequestDeclare();}
                else this.net.send(nextDealer.peerId,{type:'REQUEST_DECLARE'});
            },3500);
        }

        // ─── HOST: Round end ───
        _roundEnd(){
            const fs=this.fullState;
            this._resetChallengeWindow();
            const last=this._pById(fs.lastPlayerId);
            if(last&&last.handCount===0&&!(fs.winners||[]).includes(last.id)){this._gameOver(last);return;}
            if(!last){
                fs.tableCards=[]; fs.tablePlayLog=[];
                fs.lastPlayerId=null; fs.lastPlayCount=0; fs.passCount=0;
                fs.phase='DECLARING'; fs.declaredRank=null; fs.seq++;
                this._broadcastState();
                return;
            }
            this._requestRoundContinueDecision(last,fs.players.indexOf(last));
        }

        // ─── HOST: Game over (or winner continue) ───
        _gameOver(winner){
            const fs=this.fullState;
            this._resetChallengeWindow();
            if(!fs.winners)fs.winners=[];
            fs.winners.push(winner.id);
            this._log(`🏆 ${winner.name} 获胜！率先打光了所有手牌！`,true);

            // Count remaining active players (connected, have cards, not yet won)
            const remaining=fs.players.filter(p=>p.connected&&p.handCount>0&&!fs.winners.includes(p.id));
            if(remaining.length<=1){
                // True game over
                fs.phase='GAME_OVER'; fs.seq++;
                this.net.broadcastAndSelf({type:'GAME_OVER',winnerId:winner.id,winnerName:winner.name,isFinal:true,isFirstWinner:fs.winners.length===1,winners:fs.winners.map(wid=>{const wp=this._pById(wid);return wp?wp.name:'?';})});
                this._broadcastState();
                return;
            }

            // Winner exits the round, game continues for rest
            this.net.broadcastAndSelf({type:'GAME_OVER',winnerId:winner.id,winnerName:winner.name,isFinal:false,isFirstWinner:fs.winners.length===1,remainCount:remaining.length});

            // Clear table, start new round
            fs.tableCards=[]; fs.tablePlayLog=[];
            fs.lastPlayerId=null; fs.lastPlayCount=0; fs.passCount=0;
            // Pick next dealer from remaining players
            let nd=fs.players.indexOf(remaining[rng(0,remaining.length-1)]);
            fs.dealerIndex=nd; fs.currentPlayerIndex=nd;
            fs.phase='DECLARING'; fs.declaredRank=null; fs.seq++;

            setTimeout(()=>{
                this._broadcastState();
                const dealer=fs.players[fs.dealerIndex];
                if(dealer.peerId===this.net.myPeerId){if(this.onRequestDeclare)this.onRequestDeclare();}
                else this.net.send(dealer.peerId,{type:'REQUEST_DECLARE'});
            },2500);
        }

        // ─── HOST: Advance turn ───
        _advanceTurn(){
            const fs=this.fullState;
            const n=fs.players.length;
            let next=(fs.currentPlayerIndex+1)%n, att=0;
            while(att<n){
                const p=fs.players[next];
                if(p.connected && p.handCount>0 && !(fs.winners||[]).includes(p.id)) break;
                next=(next+1)%n; att++;
            }
            fs.currentPlayerIndex=next;
        }

        // ─── HOST: Send hand to player ───
        _sendHand(p){
            if(p.peerId===this.net.myPeerId){
                this.myHand=[...p.hand]; this._saveHand();
                if(this.onHandUpdate)this.onHandUpdate(this.myHand);
            } else {
                this.net.send(p.peerId,{type:'HAND_UPDATE',hand:p.hand});
            }
        }

        // ─── HOST: Broadcast sanitized state ───
        _broadcastState(){
            const fs=this.fullState; if(!fs)return;
            const s={
                phase:fs.phase,
                players:fs.players.map(p=>{
                    const dc=Array(fs.deckCount).fill(0);
                    for(const c of (p.hand||[]))if(c.deck<fs.deckCount)dc[c.deck]++;
                    return {id:p.id,name:p.name,handCount:p.handCount,connected:p.connected,joinOrder:p.joinOrder,deckHandCounts:dc};
                }),
                currentPlayerIndex:fs.currentPlayerIndex, dealerIndex:fs.dealerIndex,
                declaredRank:fs.declaredRank, challengeMode:fs.challengeMode,
                tableCardCount:fs.tableCards.length,
                tablePlayLog:(fs.tablePlayLog||[]).map(e=>({playerId:e.playerId,count:e.cards.length})),
                lastPlayerId:fs.lastPlayerId, lastPlayCount:fs.lastPlayCount,
                passCount:fs.passCount, deckCount:fs.deckCount,
                maxPlayers:fs.maxPlayers||_getRoomMaxPlayers(),
                discardCount:(fs.discardPile||[]).length, seq:fs.seq,
                showPlayLog:fs.showPlayLog!==false,
                winners:fs.winners||[],
                pendingContinuePlayerId:fs.pendingContinuePlayerId||null
            };
            this.net.broadcastAndSelf({type:'STATE_UPDATE',state:s});
            this.net.broadcastAndSelf({type:'FULL_STATE_SYNC',fullState:JSON.parse(JSON.stringify(fs))});
            this._saveFullState();
        }

        _log(msg,imp=false,isPlayInfo=false){this.net.broadcastAndSelf({type:'LOG',message:msg,important:imp,isPlayInfo});}

        // ─── HOST: Handle disconnect ───
        handleDisconnect(peerId){
            if(!this.fullState)return;
            const p=this._pByPeer(peerId); if(!p)return;
            p.connected=false;
            this._log(`${p.name} 断线了`);

            // In LOBBY phase, just update state
            if(this.fullState.phase==='LOBBY'){
                this._broadcastState(); return;
            }

            // Notify all players about disconnect (triggers pause overlay)
            this.net.broadcastAndSelf({type:'PLAYER_DC',playerName:p.name,playerId:p.id});
            this._broadcastState();

            // Set a timer — auto-continue after 30s if player doesn't reconnect
            if(this._dcTimer)clearTimeout(this._dcTimer);
            this._dcTimer=setTimeout(()=>this._forceResumeDc(p),30000);
        }

        // HOST: Force resume after disconnect (called by timer or host button)
        _forceResumeDc(dcPlayer){
            if(this._dcTimer){clearTimeout(this._dcTimer);this._dcTimer=null;}
            if(!this.fullState||!dcPlayer)return;
            const fs=this.fullState;
            const cur=fs.players[fs.currentPlayerIndex];
            if(cur&&cur.id===dcPlayer.id&&!cur.connected){
                if(fs.phase==='TURN'){
                    fs.passCount++;
                    const active=fs.players.filter(p=>p.connected&&!(fs.winners||[]).includes(p.id));
                    if(fs.lastPlayerId&&fs.passCount>=active.length){
                        this._roundEnd();
                    } else {this._advanceTurn();this._broadcastState();}
                } else if(fs.phase==='DECLARING'){
                    const r=RANKS[rng(0,RANKS.length-1)];
                    fs.declaredRank=r;
                    fs.phase='TURN'; fs.seq++;
                    this._log(`${dcPlayer.name} 断线，自动宣言: ${r}`);
                    this._advanceTurn(); this._broadcastState();
                }
            }
            // Dismiss pause overlay for everyone
            this.net.broadcastAndSelf({type:'DC_CONTINUE'});
        }

        // HOST: Called when host clicks "continue" button
        hostContinueDc(){
            if(!this.fullState)return;
            // Find the disconnected player who caused the pause
            const dc=this.fullState.players.find(p=>!p.connected);
            this._forceResumeDc(dc);
        }

        // ─── LOCAL state persistence ───
        _saveState(){try{localStorage.setItem('lg_gameState',JSON.stringify(this.state));localStorage.setItem('lg_roomCode',this.net.roomCode);localStorage.setItem('lg_hostPeerId',this.net.hostPeerId);}catch(e){}}
        _saveHand(){try{localStorage.setItem('lg_myHand',JSON.stringify(this.myHand));}catch(e){}}
        _saveFullState(){try{if(this.fullState)localStorage.setItem('lg_fullState',JSON.stringify(this.fullState));}catch(e){}}

        // ─── Client actions ───
        sendJoin(name){this.myName=name;localStorage.setItem('lg_playerName',name);this.net.sendToHost({type:'JOIN',playerId:this.myPlayerId,name});}
        sendDeclare(rank){this.net.sendToHost({type:'DECLARE',rank});}
        sendPlayCards(ids){this.net.sendToHost({type:'PLAY_CARDS',cardIds:ids});}
        sendPass(){this.net.sendToHost({type:'PASS'});}
        sendRoundContinueDecision(continueRound){this.net.sendToHost({type:'ROUND_CONTINUE_DECISION',continueRound:!!continueRound});}
        sendChallenge(){
            this.net.sendToHost({
                type:'CHALLENGE',
                challengeId:`${this.myPlayerId}-${Date.now()}-${Math.random().toString(16).slice(2,6)}`,
                clientTs:Date.now()
            });
        }
        sendDeckCount(c){this.net.sendToHost({type:'DECK_COUNT',count:c});}
        sendStartGame(){this.net.sendToHost({type:'START_GAME'});}
        sendPlayAgain(){this.net.sendToHost({type:'PLAY_AGAIN'});}

        // Helpers
        isMyTurn(){if(!this.state||this.state.phase!=='TURN')return false;const c=this.state.players[this.state.currentPlayerIndex];return c&&c.id===this.myPlayerId;}
        isMyDeclare(){if(!this.state||this.state.phase!=='DECLARING')return false;const d=this.state.players[this.state.dealerIndex];return d&&d.id===this.myPlayerId;}
        canChallenge(){
            if(!this.state||this.state.phase!=='TURN'||!this.state.lastPlayerId)return false;
            if(this.state.lastPlayerId===this.myPlayerId)return false;
            return this.state.challengeMode==='sequential' ? this.isMyTurn() : true;
        }
    }

    const { uuid, rng, sortCards } = global.LG_RUNTIME_UTILS;
    const { CardEngine } = global.LG_CARD_ENGINE;
    const {
        CHALLENGE_WINDOW_MS,
        _getRoomMaxPlayers,
        RANKS,
    } = global.LG_RUNTIME_CONFIG;

    global.LG_GAME_ENGINE = { GameEngine };
})(window);
